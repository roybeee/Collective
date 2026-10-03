// 상품 리서치 화면 응답 규모 검사(평가 1회차 H6). 근거: mocked — 메모리 SQLite에 합성 자료(스냅샷 3,000개·점수표 5만 판·상품 300개)를 넣고
// D1 바인딩을 감싸 GET 화면 응답이 읽은 행 수·질의 수·시간을 센다. 실제 네트워크 0회.
// 기준: 전체 스냅샷·점수표를 읽지 않는다(이전 구현은 스냅샷 최대 3,000개 + 점수표 5만 행을 매번 읽었다).
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const DAY=86400000;
const {sql,env,load}=testRuntime(async url=>{throw new Error('외부 호출 금지: '+String(url))});
const flags=await load('lib/feature-flags.ts'),srv=await load('lib/product-research/server.ts'),ops=await load('lib/product-research/server-ops.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const O='scale-owner',who={owner:O,id:O,email:null,role:'owner'};
await flags.setFeatureFlag(O,{flag:'product_research',enabled:true},{id:O,email:null});

const SNAPSHOTS=3000,SCORES=50000,PRODUCTS=300,now=Date.now();
const ins=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');
sql.exec('BEGIN');
const snapIds=[];
for(let i=0;i<SNAPSHOTS;i++){
 const id=`snap${String(i).padStart(5,'0')}`,at=new Date(now-(SNAPSHOTS-i)*40*60000).toISOString(),d=at.slice(0,10);snapIds.push(id);
 const observations=Array.from({length:20},(_,k)=>({subject:{type:'keyword',text:`키워드${(i*7+k)%400}`},metric:'search_volume_month',value:1000+((i+k)%50),period:{from:d,to:d}}));
 ins.run(`${O}:pr_snapshot:${id}`,O,'pr_snapshot','naver_searchad_keyword',JSON.stringify({id,sourceId:'naver_searchad_keyword',method:'api',request:{keywords:'x'},fetchedAt:at,bodyDigest:'0'.repeat(64),bodyBytes:4000,status:'ok',limitations:[],importedBy:null,observations}),at);
}
const sub=(key,value,evidence)=>({key,value,evidence,reason:`${key} 합성`});
const card=(p,j,computedAt)=>({id:`prs_${p}_${j}`,productId:p,weightsVersion:'w1',computedAt,subScores:[sub('demand',50,[snapIds[(j*13)%SNAPSHOTS]]),sub('momentum',40+(j%30),[snapIds[(j*17+5)%SNAPSHOTS],snapIds[(j*19+9)%SNAPSHOTS]]),sub('durability',null,[]),sub('competition',null,[]),sub('profitability',null,[]),sub('feasibility',null,[]),sub('content',null,[]),sub('brand_fit',null,[]),sub('risk',90,[])],total:50+(j%40),confidence:0.6,missing:[],blocked:null,tier:j%3?'watch':'adopt',inputDigest:`d${j}`});
const per=Math.ceil(SCORES/PRODUCTS);let made=0;
for(let i=0;i<PRODUCTS;i++){
 const p=`prp_${String(i).padStart(4,'0')}`;let current=null;
 for(let j=0;j<per&&made<SCORES;j++,made++){
  const computedAt=new Date(now-(per-1-j)*DAY).toISOString(),c=card(p,j,computedAt);current=c;
  ins.run(`${O}:pr_score:${c.id}`,O,'pr_score',p,JSON.stringify(c),computedAt);
 }
 const product={id:p,name:`상품 ${i}`,brand:null,categoryId:null,temperature:'ambient',regulatory:'food',priceBand:{min:null,max:null},listings:[{sourceId:'coupang_ranking_manual',externalId:`x${i}`,title:`상품 ${i}`,url:null}],keywordGroupIds:[`kg_${i}`],match:{method:'brand_name_size',confidence:0.96,confirmedBy:null},createdAt:new Date(now-200*DAY).toISOString(),updatedAt:new Date(now).toISOString(),scoreId:current.id,brandFit:null};
 ins.run(`${O}:pr_product:${p}`,O,'pr_product','',JSON.stringify(product),new Date(now).toISOString());
 ins.run(`${O}:pr_keyword_group:kg_${i}`,O,'pr_keyword_group','',JSON.stringify({id:`kg_${i}`,label:`키워드${i}`,keywords:[`키워드${i}`],categoryId:null,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()}),new Date(now).toISOString());
}
sql.exec('COMMIT');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='pr_snapshot'").get(O).n===SNAPSHOTS&&sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='pr_score'").get(O).n===SCORES,'synthetic world: 3,000 snapshots and 50,000 score rows');

// 점수표 색인은 재계산(쓰기 경로)이 만든다. 배포 직후처럼 색인이 없을 때 한 번 채운다.
const idx=JSON.parse(JSON.stringify(await ops.updateScoreIndex(O)));
check(idx.updated===PRODUCTS&&sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='pr_score_index'").get(O).n===PRODUCTS,'score index bootstrapped once per product (current + newest version per day, ≤30 each)');

// D1 바인딩을 감싸 화면 응답이 읽은 행과 질의를 센다.
const real=env.DB;let rows=0,queries=0,maxRows=0;
const wrap=st=>({bind:(...a)=>wrap(st.bind(...a)),first:async()=>{queries++;const r=await st.first();if(r){rows++;maxRows=Math.max(maxRows,1)}return r},all:async()=>{queries++;const r=await st.all();rows+=r.results.length;maxRows=Math.max(maxRows,r.results.length);return r},run:()=>st.run()});
env.DB={prepare:q=>wrap(real.prepare(q)),batch:real.batch};
const t0=performance.now();
const view=JSON.parse(JSON.stringify(await srv.researchView(who,new Date(now))));
const ms=performance.now()-t0;
env.DB=real;
check(view.enabled&&view.products.length===PRODUCTS,'view lists every product');
check(rows<=2600,`view reads ≤ 2,600 rows (read ${rows}; the full scan would be ≥ ${SNAPSHOTS+SCORES})`);
check(maxRows<=1000,`no single query returns more than 1,000 rows (max ${maxRows})`);
check(queries<=120,`view issues ≤ 120 queries (issued ${queries})`);
check(ms<4000,`view stays under the 4 s budget in the test runtime (took ${Math.round(ms)} ms)`);
check(view.snapshots.length<=1050&&view.series.length>0,'snapshot metadata is capped (referenced ≤1,000 + latest 50) and series still render from cited snapshots');
check(view.series.some(x=>new Set(x.points.map(p=>p.snapshotId)).size>=2),'series also read older snapshots of the cited sources (trend bars get more than one point)');
check(view.snapshots.every(x=>Array.isArray(x.limitations)&&typeof x.rows==='number')&&view.snapshots.some(x=>x.request&&x.request.keywords==='x'&&x.rows===20),'snapshot metadata carries request scope, limitations and row count (no observation bodies)');
const p0=view.products.find(p=>p.id==='prp_0000'),cur=p0.score;
check(p0.previousScore&&Date.parse(cur.computedAt)-Date.parse(p0.previousScore.computedAt)>=6*DAY&&Date.parse(cur.computedAt)-Date.parse(p0.previousScore.computedAt)<7*DAY,'previousScore comes from the score index (the latest version ≥6 days older)');
// 하루에 판이 20번 바뀌어도(즉시 수집·재계산 반복) 색인에 지난주 판이 남는다.
const p1='prp_0001';let newest=null;
for(let k=20;k>=1;k--){const c=card(p1,1000+k,new Date(now+k*60000).toISOString());c.id=`prs_${p1}_burst${k}`;if(!newest)newest=c;sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${O}:pr_score:${c.id}`,O,'pr_score',p1,JSON.stringify(c),c.computedAt)}
sql.prepare("UPDATE records SET data=json_set(data,'$.scoreId',?) WHERE id=?").run(newest.id,`${O}:pr_product:${p1}`);
await ops.updateScoreIndex(O);
const entries=JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${O}:pr_score_index:${p1}`).data).entries;
const prev1=JSON.parse(JSON.stringify(ops.previousFromIndex(entries,newest)));
check(entries[0].id===newest.id&&entries.length<=30&&prev1&&Date.parse(newest.computedAt)-Date.parse(prev1.computedAt)>=6*DAY,'after 20 same-day versions the index still holds a ≥6-day-older version (one per day kept)');
console.log(JSON.stringify({passed,rows,queries,maxRows,ms:Math.round(ms),sqlite:'real',external:0}));
