// 상품 리서치 백테스트 읽기·누설 검사(평가 2회차 H3·H4). 근거: mocked — 메모리 SQLite에 90일치 일별 스냅샷(하루 38개 안팎, 3,400개)을 직접 넣는다. 공급자 호출 0회.
// 덮는 것: 최신 3,000개 합산 상한이 기준 시점 이전 관측을 잘라 내던 문제(출처별 계획으로 해결), 12주 백테스트의 후보·현재 1위 기준선이 비지 않음,
// 오늘 처음 수집한 키워드는 104주 소급 이력이 있어도 후보가 아님(생존 편향), 같은 대상의 기준 시점 이전 스냅샷이 있으면 특징은 그것만 씀, 재계산이 120일 창 전체를 읽음.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const DAY=86400000;
const {sql,load}=testRuntime(async url=>{throw new Error('외부 호출 금지: '+String(url))});
const flags=await load('lib/feature-flags.ts'),srv=await load('lib/product-research/server.ts');
const store=await load('lib/product-research/server-store.ts'),PL=await load('lib/product-research/server-pipeline.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const plain=v=>JSON.parse(JSON.stringify(v));
const O='bt-owner',who={owner:O,id:O,email:null,role:'owner'};
await flags.setFeatureFlag(O,{flag:'product_research',enabled:true},{id:O,email:null});

// ── 합성 세계: 오늘(day 89)까지 90일. 키워드 10개(절반은 기준 시점 뒤 상승), 쿠팡 순위 목록 20개, 채움 키워드 30개.
const now=new Date(),dayAt=i=>new Date(now.getTime()-(89-i)*DAY),iso=d=>d.toISOString(),ymd=t=>new Date(t).toISOString().slice(0,10);
const KW=['마라소스','떡볶이소스','불닭소스','굴소스','칠리소스','데리야끼소스','바베큐소스','스리라차','고추장','쌈장'],RISING=new Set(KW.slice(0,5));
const level=(k,t)=>RISING.has(k)?20*Math.exp(0.02*Math.max(0,t-10)):22+((k.length*7+Math.floor(t/7))%3);
const ins=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');
let made=0;const bySource={};
const put=(sourceId,fetchedAt,request,observations,method='api')=>{const id=randomUUID();made++;bySource[sourceId]=(bySource[sourceId]??0)+1;
 ins.run(`${O}:pr_snapshot:${id}`,O,'pr_snapshot',sourceId,JSON.stringify({id,sourceId,method,request,fetchedAt:iso(fetchedAt),bodyDigest:'0'.repeat(64),bodyBytes:100,status:'ok',limitations:[],importedBy:null,observations}),iso(fetchedAt));return id};
const kwObs=(text,metric,value,from,to)=>({subject:{type:'keyword',text},metric,value,period:{from,to}});
const listing=(sourceId,externalId,title,price)=>({type:'listing',sourceId,externalId,title,brand:null,price,url:`https://www.coupang.com/vp/products/${externalId.replace(/\D/g,'')||1}`,categoryPath:null});
// 데이터랩: 주 단위(월요일 시작) 40주 이력. 묶음 이름=키워드, 묶음 키워드=[키워드].
const weekly=(names,fetched,t0)=>{const end=Math.floor((fetched.getTime()-dayAt(0).getTime())/DAY)-1,obs=[];
 for(const n of names)for(let w=-40;w*7+6<=end;w++){const t=w*7;obs.push(kwObs(n,'search_trend',Math.round(level(n,t+3)*100)/100,ymd(dayAt(0).getTime()+t*DAY),ymd(dayAt(0).getTime()+(t+6)*DAY)))}
 return {request:{startDate:ymd(dayAt(0).getTime()-280*DAY),endDate:ymd(fetched.getTime()-DAY),timeUnit:'week',keywordGroups:names.map(n=>`${n}:${n}`).join(';')},obs,t0};
};
sql.exec('BEGIN');
for(let i=0;i<90;i++){
 const d=dayAt(i),to=ymd(d.getTime()-DAY),from=ymd(d.getTime()-30*DAY),at=k=>new Date(d.getTime()+k*60000);
 // 검색광고 하루 8번(실제 키워드 2번 + 채움 6번, 5개씩). 30일 검색량 = 50 × 수준.
 for(let c=0;c<2;c++){const ks=KW.slice(c*5,c*5+5);put('naver_searchad_keyword',at(c),{keywords:ks.join(',')},ks.flatMap(k=>[kwObs(k,'search_volume_month',Math.round(50*level(k,i)),from,to),kwObs(k,'search_volume_pc',Math.round(10*level(k,i)),from,to),kwObs(k,'ad_competition',0.5,from,to)]))}
 for(let c=0;c<6;c++){const ks=Array.from({length:5},(_,j)=>`채움키워드${c*5+j}`);put('naver_searchad_keyword',at(2+c),{keywords:ks.join(',')},ks.map(k=>kwObs(k,'search_volume_month',300,from,to)))}
 // 데이터랩 하루 2번(5개 묶음씩)
 for(let c=0;c<2;c++){const g=weekly(KW.slice(c*5,c*5+5),d);put('naver_datalab_search',at(10+c),g.request,g.obs)}
 // 쇼핑 검색 하루 20번(실제 10 + 채움 10)
 for(let c=0;c<20;c++){const q=c<10?KW[c]:`채움키워드${c}`;put('naver_shop_search',at(20+c),{query:q},[kwObs(q,'product_count',1000+i,to,to),kwObs(q,'seller_count',50,to,to),{subject:listing('naver_shop_search',`sh${c}x${i%3}`,`${q} 상품 ${i%3}`,3000),metric:'price_min',value:3000,period:{from:to,to}}])}
 // YouTube 하루 7번(작은 추적 묶음)
 for(let c=0;c<7;c++)put('youtube_data',at(40+c),{ids:`v${c}`},[{subject:{type:'listing',sourceId:'youtube_data',externalId:`vid${c}`,title:'영상',brand:null,price:null,url:null,categoryPath:null},metric:'video_views',value:1000+i*10,period:{from:to,to}}]);
 // 쿠팡 파트너스 하루 1번: 키워드마다 목록 2개(브랜드 둘), 순위 = 수준 순
 const rows=KW.flatMap((k,j)=>[{k,id:`${j*2+1}`,brand:'오뚜기',pop:level(k,i)},{k,id:`${j*2+2}`,brand:'청정원',pop:level(k,i)*0.8}]).sort((a,b)=>b.pop-a.pop);
 put('coupang_partners',at(50),{categoryId:'1012'},rows.flatMap((x,r)=>{const s=listing('coupang_partners',`cp${x.id}`,`${x.brand} ${x.k} 500g`,3900);return [{subject:s,metric:'rank',value:r+1,period:{from:ymd(d.getTime()),to:ymd(d.getTime())}},{subject:s,metric:'price_min',value:3900,period:{from:ymd(d.getTime()),to:ymd(d.getTime())}}]}));
}
// 오늘 처음 추적을 시작한 인기 키워드(H3): 데이터랩 40주 소급 이력 + 오늘 검색광고 + 오늘 쿠팡 1위.
const LATE='신상마라젤리',today=dayAt(89);
{const g=weekly([LATE],today);put('naver_datalab_search',new Date(today.getTime()+90*60000),g.request,g.obs.map(o=>({...o,value:Math.min(100,o.value*3)})))}
put('naver_searchad_keyword',new Date(today.getTime()+91*60000),{keywords:LATE},[kwObs(LATE,'search_volume_month',90000,ymd(today.getTime()-30*DAY),ymd(today.getTime()-DAY))]);
put('coupang_ranking_manual',new Date(today.getTime()+92*60000),{scope:'젤리'},[{subject:listing('coupang_ranking_manual','late99',`오뚜기 ${LATE} 100g`,2500),metric:'rank',value:1,period:{from:ymd(today.getTime()),to:ymd(today.getTime())}}],'manual');
sql.exec('COMMIT');
check(made>3300&&bySource.naver_searchad_keyword>=720&&bySource.coupang_partners===90,`synthetic world: ${made} snapshots over 90 days (~38/day)`);

// ── 원인 재현: 최신 3,000개(전 출처 합산)에는 12주 기준 시점 이전의 검색광고·순위 스냅샷이 없다
const asOfGuess=now.getTime()-84*DAY;
const newest=plain(await store.recentSnapshots(O,new Date(now.getTime()-800*DAY).toISOString(),3000));
check(newest.length===3000&&!newest.some(s=>(s.sourceId==='naver_searchad_keyword'||s.sourceId==='coupang_partners')&&Date.parse(s.fetchedAt)<=asOfGuess),'(cause) the newest-3,000 window holds no searchad/rank snapshot from before the 12-week as-of');

// ── H4: 출처별 계획으로 읽으면 기준 시점 이전 관측이 남는다
const latest=await store.latestSnapshotAt(O),plan=PL.backtestPlan(Date.parse(latest),12);
const snaps=plain(await store.loadPlanned(O,plan));
check(snaps.some(s=>s.sourceId==='naver_searchad_keyword'&&Date.parse(s.fetchedAt)<=asOfGuess)&&snaps.some(s=>s.sourceId==='coupang_partners'&&Date.parse(s.fetchedAt)<=asOfGuess),'backtest plan loads pre-as-of searchad and rank snapshots per source');
check(snaps.filter(s=>s.sourceId==='naver_searchad_keyword').every(s=>s.observations.every(o=>o.metric==='search_volume_month'||o.metric==='ad_competition')),'searchad rows are read with only the metrics the pipeline uses (SQL-side observation filter)');
const dl=snaps.filter(s=>s.sourceId==='naver_datalab_search');
check(dl.length<=6&&dl.some(s=>Date.parse(s.fetchedAt)<=asOfGuess)&&dl.some(s=>Date.parse(s.fetchedAt)>=today.getTime()),`datalab: latest snapshot per group plus the latest one before as-of (${dl.length} of ${bySource.naver_datalab_search}), not every daily copy`);
check(snaps.length<1500,`backtest reads a bounded set (${snaps.length} snapshots instead of ${made})`);
const AT=now.toISOString(),run=PL.backtestFromSnapshots(snaps,12,0.2,AT);
const withBaseline=run.rows.filter(r=>r.baselines.current_top!==null);
check(run.result.reason===null&&run.result.candidates>=10&&run.result.precisionAtK.every(p=>typeof p.value==='number'),`12-week backtest over ~90 days of daily snapshots has candidates (${run.result.candidates}) and numbers`);
check(withBaseline.length>=10,`'current #1' baseline is not all null (${withBaseline.length}/${run.rows.length} rows have an as-of value)`);
check(run.rows.some(r=>r.positive===true)&&run.rows.some(r=>r.positive===false),'the label separates risers from flat keywords');

// ── H3: 오늘 처음 추적한 키워드·목록은 104주 소급 이력이 있어도 과거 기준 시점의 후보가 아니다
const lateKey='kw:'+LATE;
check(!run.candidates.some(b=>b.keywordKeys.includes(lateKey)||b.listingKeys.some(k=>k.includes('late99'))),'a keyword first collected today (datalab backfill only) is not an as-of candidate');
check(!run.candidates.some(b=>b.series.some(s=>s.subjectKey===lateKey)),'its backfilled history feeds no candidate feature');
check(run.universe.notes.some(n=>/처음 수집된 대상 \d+개/.test(n)&&!/대상 0개/.test(n)),'universe notes state how many late-first-collected subjects were excluded');
// 같은 대상의 기준 시점 이전 스냅샷이 있으면 특징은 그것만(기준 시점 뒤 재정규화 값 무시)
const mk=(id,fetchedAt,value)=>({id,sourceId:'naver_datalab_search',method:'api',request:{},fetchedAt,bodyDigest:'0',bodyBytes:1,status:'ok',limitations:[],importedBy:null,observations:[{subject:{type:'keyword',text:'굴소스'},metric:'search_trend',value,period:{from:'2026-01-05',to:'2026-01-11'}}]});
const cut=plain(PL.asOfCut([mk('early','2026-02-01T00:00:00Z',40),mk('late','2026-05-01T00:00:00Z',80)],'2026-03-01T00:00:00Z'));
check(cut.snapshots.length===1&&cut.snapshots[0].id==='early'&&cut.backfilledSeries===0,'features use the pre-as-of snapshot of the same series, not the later re-normalised copy');
const back=plain(PL.asOfCut([mk('late','2026-05-01T00:00:00Z',80),{...mk('sa','2026-02-01T00:00:00Z',1),sourceId:'naver_searchad_keyword',observations:[{subject:{type:'keyword',text:'굴소스'},metric:'search_volume_month',value:500,period:{from:'2026-01-01',to:'2026-01-31'}}]}],'2026-03-01T00:00:00Z'));
check(!back.snapshots.some(s=>s.id==='late')&&back.backfilledSeries===1&&back.lateSubjects===0&&back.trend.backfilledOnly===1&&back.trend.early===0,'(H-2) a subject seen before as-of (searchad) gets no backfilled datalab history: the post-as-of snapshot is excluded and counted as backfilled-only');
const only=plain(PL.asOfCut([mk('late','2026-05-01T00:00:00Z',80)],'2026-03-01T00:00:00Z'));
check(only.snapshots.length===0&&only.lateSubjects===1,'a subject first fetched after as-of is dropped entirely');

// ── 서버 작업: run_backtest가 같은 계획으로 숫자를 낸다
const r=plain(await srv.researchAction(who,{action:'run_backtest',requestId:randomUUID(),horizonWeeks:12,labelThreshold:20},{fetch:async()=>{throw new Error('no network')},now:()=>now}));
const bt=r.backtests[0];
check(bt.reason===null&&bt.candidates>=10&&bt.precisionAtK.every(p=>typeof p.value==='number')&&bt.baselines.find(b=>b.name==='current_top').precisionAtK.every(p=>typeof p.value==='number'),'run_backtest stores a 12-week result with numbers from the per-source plan');
check(bt.universe&&bt.universe.notes.some(n=>/생존 편향/.test(n)),'stored result explains the survivorship rule in universe.notes');

// ── H4: 재계산은 120일 창 전체를 출처별로 읽는다(순위 12주 기울기가 잘리지 않음)
const rec=plain(await PL.loadRecomputeSnapshots(O,now)),cp=rec.filter(s=>s.sourceId==='coupang_partners').map(s=>Date.parse(s.fetchedAt));
check(cp.length===90&&Math.min(...cp)<=now.getTime()-84*DAY,'recompute plan keeps every daily rank snapshot of the last 90 days (12-week rank slope has its full window)');
check(rec.filter(s=>s.sourceId==='naver_datalab_search').length<=3,'recompute reads one datalab snapshot per group (it carries the history)');
const re=plain(await srv.researchAction(who,{action:'recompute',requestId:randomUUID()},{fetch:async()=>{throw new Error('no network')},now:()=>now}));
const withRank=re.products.filter(p=>p.score?.subScores.find(s=>s.key==='momentum')?.reason.includes('순위'));
check(withRank.length>0,'recomputed scores use the rank series');
console.log(JSON.stringify({passed,snapshots:made,backtest:{candidates:run.result.candidates,withBaseline:withBaseline.length,read:snaps.length},sqlite:'real',external:0}));
