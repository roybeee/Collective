// 상품 리서치 서버 평가 3회차 보강 검사. 근거: mocked — 메모리 SQLite(실제 SQL·json_each·트리거), 로컬 인증 헤더 주입, 공급자 API는 fetch 스텁, 시계는 주입. 실제 네트워크 0회.
// 덮는 것: H-2 백테스트 생존 편향(소급 데이터랩 이력이 후보·특징을 주지 않음, 소급 비율이 높으면 정밀도 null), M3 묶음 보정 기준점("< 10" 범위·잴 수 없는 키워드면 보정 안 함),
// M4 재계산 단계 사이 잠금 갱신(잃으면 저장 안 함), M6 넘기기 카탈로그 상품 고르기·화면 목록, ⑩ 판매 오퍼 초안·가중치 재보정 후보(제안만),
// ① 쇼핑인사이트 수집 계획, M2 경쟁 신규 진입의 범위별 관측 시작, 낮음: 출시 결과 집계 한도 초과는 null('집계 한도 초과').
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const DAY=86400000,ymd=t=>new Date(t).toISOString().slice(0,10),kst=d=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const calls=[];
const stub=async(url,init={})=>{
 const u=new URL(String(url));calls.push({host:u.host,path:u.pathname,body:init.body?JSON.parse(init.body):null});
 if(u.host==='api.searchad.naver.com'){const hints=(u.searchParams.get('hintKeywords')||'').split(',').filter(Boolean);return json({keywordList:hints.map((h,i)=>({relKeyword:h,monthlyPcQcCnt:1200+i,monthlyMobileQcCnt:8800,compIdx:'중간'}))})}
 if(u.host==='openapi.naver.com'&&(u.pathname==='/v1/datalab/search'||u.pathname==='/v1/datalab/shopping/category/keywords')){
  const b=JSON.parse(init.body),groups=u.pathname==='/v1/datalab/search'?b.keywordGroups.map(g=>g.groupName):b.keyword.map(k=>k.name),out=[];
  for(const title of groups){const data=[];let t=Date.parse(b.startDate+'T00:00:00Z');const end=Date.parse(b.endDate+'T00:00:00Z');while(t<=end){data.push({period:new Date(t).toISOString().slice(0,10),ratio:40});t+=(b.timeUnit==='week'?7:1)*DAY}out.push({title,data})}
  return json({startDate:b.startDate,endDate:b.endDate,timeUnit:b.timeUnit,results:out});
 }
 if(u.host==='openapi.naver.com'&&u.pathname==='/v1/search/shop.json'){const q=u.searchParams.get('query');return json({total:1520,items:[1,2].map(n=>({title:`<b>${q}</b> ${n}호 500g`,link:`https://smartstore.naver.com/shop${n}/products/${q.length}${n}`,lprice:String(3000+n*100),mallName:`몰${n}`,productId:`${q.length}0${n}${q.charCodeAt(0)}`,brand:`브랜드${n}`,category1:'식품'}))})}
 throw new Error('외부 호출 금지: '+String(url));
};
const {sql,load}=testRuntime(stub);
const server=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),route=await load('app/api/product-research/route.ts');
const collect=await load('lib/product-research/server-collect.ts'),ops=await load('lib/product-research/server-ops.ts'),store=await load('lib/product-research/server-store.ts');
const PL=await load('lib/product-research/server-pipeline.ts'),SC=await load('lib/product-research/analytics/score.ts'),CO=await load('lib/product-research/analytics/competition.ts'),S=await load('lib/product-research/analytics/series.ts');
const BT=await load('lib/product-research/analytics/backtest.ts'),catalogLib=await load('lib/growth-catalog.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const plain=v=>JSON.parse(JSON.stringify(v));
const hdr=o=>({'oai-authenticated-user-id':o,origin:'https://agency.test','content-type':'application/json'});
const get=async o=>{const r=await route.GET(new Request('https://agency.test/api/product-research',{headers:hdr(o)}));return {status:r.status,body:await r.json()}};
const post=async(o,b)=>{const r=await route.POST(new Request('https://agency.test/api/product-research',{method:'POST',headers:hdr(o),body:JSON.stringify({requestId:randomUUID(),...b})}));return {status:r.status,body:await r.json()}};
const rec=(o,kind,id)=>{const r=sql.prepare('SELECT data FROM records WHERE id=?').get(`${o}:${kind}:${id}`);return r?JSON.parse(r.data):null};
const rows=(o,kind)=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=?').all(o,kind).map(x=>JSON.parse(x.data));
const count=(o,kind)=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(o,kind).n;
const on=async(o,...names)=>{for(const flag of names)await flags.setFeatureFlag(o,{flag,enabled:true},{id:o,email:null})};
const put=(o,kind,id,data,parent='',at=new Date().toISOString())=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${o}:${kind}:${id}`,o,kind,parent,JSON.stringify(data),at);
let sn=0;const snap=(sourceId,fetchedAt,request,observations)=>({id:`s${sn++}`,sourceId,method:'api',request,fetchedAt:new Date(fetchedAt).toISOString(),bodyDigest:'0'.repeat(64),bodyBytes:1,status:'ok',limitations:[],importedBy:null,observations});
const kw=(text,metric,value,from,to)=>({subject:{type:'keyword',text},metric,value,period:{from,to}});

// ── H-2 재현: 30개 키워드 모두 기준 시점 전에 검색광고로 봤지만, 15개(상승)는 데이터랩 추적을 기준 시점 뒤에 시작했다.
// 고치기 전: 뒤에 받은 104주 소급 이력이 후보 자격·특징을 줘 상승 15개만 후보 상위를 채워 정밀도@10 = 1.0이었다.
{
 const now=Date.parse('2026-09-28T00:00:00Z'),H=8,T=now-H*7*DAY-3*DAY;
 const EARLY=Array.from({length:15},(_,i)=>`평탄소스${String.fromCharCode(44032+i*28)}`),LATE=Array.from({length:15},(_,i)=>`상승젤리${String.fromCharCode(45208+i*28)}`);
 const level=(k,w)=>LATE.includes(k)?10*Math.exp(0.06*w):30+(w%2);
 const weeksTo=end=>Array.from({length:40},(_,w)=>{const e=end-(39-w)*7*DAY;return {w,from:ymd(e-6*DAY),to:ymd(e)}});
 const world=(late)=>{const out=[];
  for(const k of [...EARLY,...LATE])out.push(snap('naver_searchad_keyword',T-10*DAY,{hintKeywords:k},[kw(k,'search_volume_month',3000,ymd(T-40*DAY),ymd(T-11*DAY)),kw(k,'ad_competition',0.5,ymd(T-40*DAY),ymd(T-11*DAY))]));
  for(const k of [...EARLY,...LATE.filter(k=>!late.includes(k))])out.push(snap('naver_datalab_search',T-6*DAY,{keywordGroups:`${k}:${k}`,timeUnit:'week'},weeksTo(T-7*DAY).map(x=>kw(k,'search_trend',level(k,x.w),x.from,x.to))));
  for(const k of [...EARLY,...LATE])out.push(snap('naver_datalab_search',now,{keywordGroups:`${k}:${k}`,timeUnit:'week'},weeksTo(now-DAY).map(x=>kw(k,'search_trend',level(k,x.w),x.from,x.to))));
  return out;
 };
 const r=PL.backtestFromSnapshots(world(LATE),H,0.2,new Date(now).toISOString());
 check(!r.candidates.some(b=>LATE.some(k=>b.keywords.includes(k))),'(H-2) keywords whose datalab tracking started after as-of are not candidates even though searchad saw them before');
 check(r.candidates.every(b=>b.series.every(s=>s.metric!=='search_trend'||s.points.every(p=>Date.parse(p.at)<=Date.parse(r.result.asOf)))),'(H-2) candidate features hold only pre-as-of points');
 check(r.result.precisionAtK.every(p=>p.value===null)&&r.result.spearman===null&&r.result.baselines.every(b=>b.precisionAtK.every(p=>p.value===null)),`(H-2) backfilled-only share 50% → precision/spearman/baselines null (was 1.0): ${JSON.stringify(r.result.precisionAtK)}`);
 check(/소급 이력만/.test(r.result.reason)&&r.universe.notes.some(n=>/소급 이력만 있는 비율 50%\(15\/30개\)/.test(n)),`(H-2) reason and universe notes state the backfilled share: ${r.result.reason}`);
 // 소급 비율이 낮으면(3/30 = 10%) 숫자를 낸다. 소급 키워드는 여전히 후보가 아니다.
 const few=PL.backtestFromSnapshots(world(LATE.slice(0,3)),H,0.2,new Date(now).toISOString());
 check(few.result.reason===null&&few.result.precisionAtK.every(p=>typeof p.value==='number')&&!few.candidates.some(b=>LATE.slice(0,3).some(k=>b.keywords.includes(k)))&&few.universe.notes.some(n=>/10%/.test(n)),'(H-2) low backfilled share (10%) → numbers, backfilled keywords still excluded');
}

// ── M2: 신규 진입 판단의 관측 시작은 범위(출처)별이다. 오래 본 다른 범위가 새 범위의 시작을 앞당기지 않는다.
{
 const ls=(src,id,rank,d)=>({subject:{type:'listing',sourceId:src,externalId:id,title:'상품'+id,brand:null,price:null,url:null,categoryPath:null},metric:'rank',value:rank,period:{from:d,to:d}});
 const old=[snap('coupang_ranking_manual','2026-03-01',{},[ls('coupang_ranking_manual','old1',30,'2026-03-01')]),snap('coupang_ranking_manual','2026-08-30',{},[ls('coupang_ranking_manual','old1',30,'2026-08-30')])];
 const fresh=d=>snap('musinsa_ranking_manual',d,{},Array.from({length:8},(_,i)=>ls('musinsa_ranking_manual','m'+i,i+1,d)));
 const cin=CO.competitionInputFromSeries(S.buildSeries([...old,fresh('2026-08-20'),fresh('2026-08-27')]),'kw:없음','2026-09-01');
 check(cin.historyStart==='2026-08-20'&&cin.historyStartByScope.coupang_ranking_manual==='2026-03-01'&&cin.historyStartByScope.musinsa_ranking_manual==='2026-08-20','(M2) history start is per listing scope: the newest ranked scope decides');
 check(CO.assessCompetition(cin).newEntrantShare===null,'(M2) a 2-week-old ranking scope gives no new-entrant share even though another scope was observed for 6 months (was 100% new)');
}

// ── M3: 묶음 기준점. "< 10"은 0~9(5로 계산)로 넣고, 월간 검색수를 잴 수 없는 키워드가 있으면 그 묶음은 보정하지 않는다(조용히 빼면 기준점이 낮다).
{
 const end=Date.parse('2026-09-27T00:00:00Z'),weeks=Array.from({length:20},(_,i)=>{const e=end-(19-i)*7*DAY;return {from:ymd(e-6*DAY),to:ymd(e)}});
 const dl=snap('naver_datalab_search',end+DAY,{timeUnit:'week',keywordGroups:'마라묶음:마라소스|마라샹궈;떡묶음:떡볶이소스|떡볶이양념'},[...weeks.map(w=>kw('마라묶음','search_trend',50,w.from,w.to)),...weeks.map(w=>kw('떡묶음','search_trend',50,w.from,w.to))]);
 // 검색광고 30일 창 3개(겹치지 않는 달): 마라샹궈는 PC "< 10"(합계 null, 모바일 40), 떡볶이양념은 관측이 없다.
 const sa=[];for(const k of [0,1,2]){const to=end-k*31*DAY,from=to-29*DAY,at=to+DAY;
  sa.push(snap('naver_searchad_keyword',at,{hintKeywords:'마라소스,마라샹궈,떡볶이소스'},[kw('마라소스','search_volume_month',1000,ymd(from),ymd(to)),kw('마라샹궈','search_volume_month',null,ymd(from),ymd(to)),kw('마라샹궈','search_volume_pc',null,ymd(from),ymd(to)),kw('마라샹궈','search_volume_mobile',40,ymd(from),ymd(to)),kw('떡볶이소스','search_volume_month',800,ymd(from),ymd(to))]))}
 const m=PL.material([dl,...sa]),rep=plain(PL.calibrationReport(m,'2026-09-28T00:00:00Z'));
 const mara=rep.rows.find(r=>r.label==='마라묶음'),tteok=rep.rows.find(r=>r.label==='떡묶음');
 check(mara&&mara.bounded===1&&mara.missing===0&&typeof mara.error==='number'&&/"< 10"/.test(mara.reason),`(M3) '< 10' keyword enters the group anchor as a bounded value (0~9 → 5) and the row says so: ${JSON.stringify(mara)}`);
 check(tteok&&tteok.error===null&&tteok.missing===1&&/떡볶이양념/.test(tteok.reason)&&/보정하지 않았습니다/.test(tteok.reason),`(M3) a group keyword with no searchad measurement → no calibration, reason names it: ${tteok?.reason}`);
 check(rep.groups===1&&rep.uncalibrated===1,'(M3) groups counts calibrated groups only; uncalibrated is reported');
 check(JSON.stringify(plain(m.trendMembers.get('kw:마라묶음')))==='["kw:마라소스","kw:마라샹궈"]','(M3) group members are the requested keywords only (the group name is not a search term)');
 const CA=await load('lib/product-research/analytics/calibrate.ts');
 const ga=plain(CA.groupAnchors([{key:'a',month:[{at:'2026-09-01',value:1000,snapshotId:'x'}]},{key:'b',month:[{at:'2026-09-01',value:null,snapshotId:'x'}],pc:[{at:'2026-09-01',value:null,snapshotId:'x'}],mobile:[{at:'2026-09-01',value:40,snapshotId:'x'}]}]));
 check(ga.points[0].value===1045&&ga.ranges[0].low===1040&&ga.ranges[0].high===1049&&ga.bounded.join()==='b'&&!ga.missing.length,'(M3) bounded anchor: 1000 + (5 + 40) = 1045, range 1040~1049 (not 1000)');
 const gm=plain(CA.groupAnchors([{key:'a',month:[{at:'2026-09-01',value:1000,snapshotId:'x'}]},{key:'c',month:null},{key:'d',month:[{at:'2026-09-01',value:null,snapshotId:'x'}]}]));
 check(gm.points.length===0&&gm.missing.join()==='c,d','(M3) no measurement, or a "< 10" total without PC/mobile values → missing, no anchor points');
 // 점수 입력: 잴 수 없는 키워드가 있는 묶음은 보정하지 않고 대표 키워드 실측으로 수요를 잡는다.
 const p={productId:'p',keywords:['떡묶음'],keywordKeys:['kw:떡묶음'],listingKeys:[],series:m.series,profit:null,feasibility:{moq:null,leadDays:null,needsCertification:null,temperature:'ambient'},risk:{regulatory:'food',regulatorySure:true,temperature:'ambient',titles:[]},brandFit:null,trendMembers:{'kw:떡묶음':['kw:떡볶이소스','kw:떡볶이양념']}};
 check(SC.buildScoreInput(p,'2026-09-28T00:00:00Z').demand===null,'(M3) score input: an uncalibratable group is not calibrated (no low anchor) and the group label has no own measurement → demand unknown');
 const pm={...p,keywords:['마라묶음'],keywordKeys:['kw:마라묶음'],trendMembers:{'kw:마라묶음':['kw:마라소스','kw:마라샹궈']}};
 check(SC.buildScoreInput(pm,'2026-09-28T00:00:00Z').demand?.monthlyVolume===1045,'(M3) score input: the bounded anchor (1,045) calibrates the group demand');
}
// 검색광고 읽기: 힌트 키워드만 PC·모바일까지 읽는다(연관 키워드는 쓰는 지표만).
{
 const O='r3-read';const at=new Date(Date.now()-2*DAY).toISOString(),f=ymd(Date.now()-32*DAY),t=ymd(Date.now()-3*DAY);
 const s=snap('naver_searchad_keyword',at,{hintKeywords:'마라소스,떡볶이소스',showDetail:true},['마라소스','떡볶이소스','연관키워드'].flatMap(k=>[kw(k,'search_volume_pc',10,f,t),kw(k,'search_volume_mobile',20,f,t),kw(k,'search_volume_month',30,f,t),kw(k,'ad_competition',0.5,f,t)]));
 put(O,'pr_snapshot',s.id,s,'naver_searchad_keyword',at);
 const got=plain(await PL.loadRecomputeSnapshots(O,new Date()))[0].observations;
 check(got.filter(o=>o.metric==='search_volume_pc').map(o=>o.subject.text).sort().join()==='떡볶이소스,마라소스'&&got.filter(o=>o.subject.text==='연관키워드').every(o=>o.metric==='search_volume_month'||o.metric==='ad_competition'),'(M3) recompute reads PC/mobile counts only for hint keywords (SQL-side), related keywords keep the two used metrics');
}

// ── ① 데이터랩 쇼핑인사이트 수집 계획
const O1='r3-plan';await on(O1,'product_research','product_research_collect');
let r=await post(O1,{action:'connect_source',credentialKey:'naver_developers',input:{clientId:'devClientId01',clientSecret:'SECRETdevsecret123'}});assert.equal(r.status,200,r.body.error);
const plan=plain(await collect.buildPlan(O1,collect.emptyCollectState()));
const shopping=plan.filter(s=>s.sourceId==='naver_datalab_shopping');
check(shopping.length===4&&shopping.every(s=>s.op==='datalab_shopping'&&s.categoryCode==='50000006'&&s.keywords.length===5),`(①) the daily plan has 4 shopping-insight steps (20 seed keywords of the selected food categories, 5 per call, food code): ${JSON.stringify(shopping.map(s=>s.keywords.length))}`);
calls.length=0;
r=await post(O1,{action:'collect_now',sourceId:'naver_datalab_shopping'});
const shopSnaps=rows(O1,'pr_snapshot').filter(s=>s.sourceId==='naver_datalab_shopping'),sent=calls.filter(c=>c.path==='/v1/datalab/shopping/category/keywords');
check(r.status===200&&shopSnaps.length===4&&shopSnaps.every(s=>s.request.endpoint==='category_keywords'&&s.observations.length>0&&s.observations.every(o=>o.metric==='shopping_click_trend')),'(①) collect_now stores shopping click trends per keyword');
check(sent.length===4&&sent.every(c=>new Date(c.body.startDate+'T00:00:00Z').getUTCDay()===1&&new Date(c.body.endDate+'T00:00:00Z').getUTCDay()===0&&c.body.timeUnit==='week'),'(①) shopping-insight requests use whole Monday–Sunday weeks (no daily drift)');
check(rows(O1,'pr_quota').find(q=>q.sourceId==='naver_datalab_shopping').used===4,'(①) the quota ledger counts the shopping-insight calls (cap 50)');
const loaded=plain(await PL.loadRecomputeSnapshots(O1,new Date()));
check(loaded.filter(s=>s.sourceId==='naver_datalab_shopping').length===4,'(①) recompute reads the latest shopping-insight snapshot per keyword group');

// ── M4: 재계산 단계 사이 잠금 갱신. 잃으면 남은 단계를 저장하지 않는다.
{
 let n=0;const renew=async()=>{n++};
 await ops.refreshScores(O1,new Date(),[],{renew});
 check(n>=5,`(M4) refreshScores renews the lock between stages (${n} renewals)`);
 const before=count(O1,'pr_product'),beforeIdx=count(O1,'pr_score_index'),state0=JSON.stringify(rec(O1,'pr_collect_state','current'));
 sql.prepare("DELETE FROM records WHERE owner=? AND kind IN ('pr_product','pr_score','pr_score_index','pr_keyword_group')").run(O1);
 let k=0;const lose=async()=>{k++;if(k>=2)throw new store.ResearchLockLost()};
 await assert.rejects(()=>ops.refreshScores(O1,new Date(),[],{renew:lose}),e=>e instanceof store.ResearchLockLost);
 check(count(O1,'pr_product')===0&&count(O1,'pr_score')===0&&count(O1,'pr_score_index')===0&&JSON.stringify(rec(O1,'pr_collect_state','current'))===state0,`(M4) lock lost before the recompute write → no products/scores/index/derived state saved (had ${before} products, ${beforeIdx} index rows)`);
}
// 작업자: 계획을 마친 뒤 수집 상태를 저장하자마자 다른 실행이 잠금을 가져간다(트리거). 재계산은 첫 단계에서 멈추고 아무것도 저장하지 않는다.
{
 const O='r3-lock';await on(O,'product_research','product_research_collect');
 r=await post(O,{action:'connect_source',credentialKey:'naver_developers',input:{clientId:'devClientId01',clientSecret:'SECRETdevsecret123'}});assert.equal(r.status,200,r.body.error);
 sql.exec(`CREATE TRIGGER steal_ins AFTER INSERT ON records WHEN NEW.owner='${O}' AND NEW.kind='pr_collect_state' AND json_extract(NEW.data,'$.done')=1 BEGIN UPDATE mutation_locks SET token='other-run' WHERE owner='${O}:product-research'; END;`);
 sql.exec(`CREATE TRIGGER steal_upd AFTER UPDATE ON records WHEN NEW.owner='${O}' AND NEW.kind='pr_collect_state' AND json_extract(NEW.data,'$.done')=1 BEGIN UPDATE mutation_locks SET token='other-run' WHERE owner='${O}:product-research'; END;`);
 let t=Date.now();const clock=()=>new Date(t),statuses=[];
 for(let i=0;i<6;i++){const st=await collect.runProductResearchQueue(O,{fetch:async(u,x)=>{t+=1000;return stub(u,x)},now:clock});statuses.push(st.status);if(rec(O,'pr_collect_state','current')?.done)break}
 const state=rec(O,'pr_collect_state','current');
 check(state.done===true&&statuses.at(-1)==='idle','(M4) the plan finished; the tick that lost the lock during recompute ends idle');
 check(count(O,'pr_product')===0&&count(O,'pr_score')===0&&!state.calibration&&!state.outcomes,'(M4) recompute after a lost lock saves no products, scores or derived state');
 sql.exec('DROP TRIGGER steal_ins;DROP TRIGGER steal_upd;');
 sql.prepare('DELETE FROM mutation_locks WHERE owner=?').run(O+':product-research');
}

// ── M6·⑩: 넘기기의 카탈로그 상품 고르기, 판매 오퍼 초안, 화면 목록
const O5='r3-handoff';await on(O5,'product_research');
const header='rank,title,brand,price,review_count,rating,external_id,url',observedDate=kst(new Date(Date.now()-2*DAY));
r=await post(O5,{action:'import_file',sourceId:'coupang_ranking_manual',fileName:'c.csv',text:[header,'1,매운집 마라소스 500g,매운집,3900,120,4.8,A1,https://www.coupang.com/vp/products/1001','2,매운집 떡볶이소스 300g,매운집,2500,80,4.6,A2,https://www.coupang.com/vp/products/1002'].join('\n'),scope:'소스',observedDate});
assert.equal(r.status,200,r.body.error);
const pMara=r.body.products.find(p=>/마라소스/.test(p.name)),pTteok=r.body.products.find(p=>/떡볶이소스/.test(p.name));
const approve=async p=>{const x=await post(O5,{action:'decide',productId:p.id,scoreCardId:p.score.id,briefId:null,status:'approved',reason:'상표 위험을 확인했고 순위 근거로 승인합니다.',riskAcknowledged:true});assert.equal(x.status,200,x.body.error);return x.body.resultId};
const dMara=await approve(pMara),dTteok=await approve(pTteok);
await server.recordStatement(O5,'campaign','camp1',{id:'camp1',brandId:'b1',title:'가을 소스',version:3,status:'active',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'}).run();
await server.recordStatement(O5,'growth_catalog','cat1',{id:'cat1',brandId:'b1',campaignId:'camp1',version:2,campaignVersion:3,input:{sku:'SKU-MARA',title:'마라소스 500g'}},'camp1').run();
await server.recordStatement(O5,'growth_catalog','cat2',{id:'cat2',brandId:'b1',campaignId:'camp1',version:1,campaignVersion:3,input:{sku:'SKU-TTEOK',title:'떡볶이소스 300g'}},'camp1').run();
await server.recordStatement(O5,'growth_catalog','catB',{id:'catB',brandId:'b2',campaignId:'camp1',version:1,campaignVersion:3,input:{sku:'X',title:'다른 브랜드'}},'camp1').run();
let v=await get(O5);
check(JSON.stringify(v.body.campaignCatalogs.camp1.map(x=>x.id).sort())==='["cat1","cat2"]'&&v.body.campaignCatalogs.camp1.find(x=>x.id==='cat2').sku==='SKU-TTEOK'&&v.body.campaignCatalogs.camp1.find(x=>x.id==='cat1').version===2,'(M6) GET lists the campaign catalog items (same campaign and brand only) with title, SKU and version');
r=await post(O5,{action:'handoff',decisionId:dMara,campaignId:'camp1',campaignVersion:3});
let req=rows(O5,'pr_request').find(x=>x.action==='handoff'&&x.status==='done'&&x.job?.signalId===r.body.resultId);
check(r.status===200&&count(O5,'growth_sourcing_candidate')===0&&count(O5,'growth_offer')===0&&/여러 개/.test(req.job.candidateSkipped)&&/판매 오퍼 초안/.test(req.job.offerSkipped),'(M6) two catalog items and no choice → signal/need only, both drafts skipped with a reason');
r=await post(O5,{action:'handoff',decisionId:dTteok,campaignId:'camp1',campaignVersion:3,catalogId:'catB'});
check(r.status===404&&count(O5,'growth_signal')===1,'(M6) a catalog item of another brand is 404 and writes nothing');
r=await post(O5,{action:'handoff',decisionId:dTteok,campaignId:'camp1',campaignVersion:3,catalogId:'cat2'});
const cand=rows(O5,'growth_sourcing_candidate')[0],offer=rows(O5,'growth_offer')[0],dec=rec(O5,'pr_decision',dTteok);
check(r.status===200&&cand.input.catalogId==='cat2'&&cand.input.catalogVersion===1&&cand.status==='draft'&&cand.mayOrder===false,'(M6) the chosen catalog item gets the sourcing draft');
check(offer&&offer.input.catalogId==='cat2'&&offer.input.catalogVersion===1&&offer.input.needId===dec.handoff.needId&&offer.input.price===null&&offer.input.priceApproved===false&&offer.input.landingUrl===''&&offer.campaignId==='camp1'&&offer.brandId==='b1'&&offer.version===1&&offer.productResearch.decisionId===dTteok&&dec.handoff.offerId===offer.id,'(⑩) handoff creates an offer draft for the same catalog item: no price, not approved, linked to the need, with provenance');
check(JSON.stringify(plain(catalogLib.parseOfferInput(offer.input)))===JSON.stringify(offer.input)&&rows(O5,'growth_history').some(h=>h.entity==='offer'&&h.id===offer.id),'(⑩) the offer draft passes the growth offer validator unchanged and has a history row');
const readiness=plain(catalogLib.offerReadiness(offer.input,{id:'cat2',version:1,input:{...catalogLib.emptyCatalogInput(),sku:'SKU-TTEOK',title:'떡볶이소스 300g'}},Date.now()));
check(readiness.missing.includes('오퍼 가격 승인이 필요합니다.')&&readiness.missing.includes('오퍼 단가를 확인하세요.'),'(⑩) the growth readiness check keeps the offer blocked until a person sets and approves the price');

// ── ⑩ 학습 고리: 가중치 재보정 후보(제안만). 순수 계산과 서버 경로.
{
 const base=SC.WEIGHT_SETS.w1,row=(m,rev)=>({subScores:{demand:50,momentum:m,durability:40,competition:null,profitability:null,feasibility:60,content:null,brand_fit:null,risk:90},revenue:rev});
 const few=plain(BT.proposeWeights([row(10,100),row(20,200)],base,{at:'x',baseVersion:'w1'}));
 check(few.proposed===null&&/2개/.test(few.reason)&&few.n===2&&few.minN===8,'(⑩) fewer than 8 complete outcomes → no proposal, reason states n');
 const many=plain(BT.proposeWeights(Array.from({length:10},(_,i)=>row(10+i*8,1000*(i+1))),base,{at:'x',baseVersion:'w1'}));
 const sum=Object.values(many.proposed).reduce((a,b)=>a+b,0);
 check(many.proposed&&Math.abs(sum-1)<1e-9&&many.proposed.momentum>base.momentum&&many.correlations.find(c=>c.key==='momentum').rho===1&&many.correlations.find(c=>c.key==='demand').rho===null,`(⑩) momentum perfectly ranks revenue → its weight goes up, weights sum to 1, constant sub-scores have no correlation: ${JSON.stringify(many.proposed)}`);
 check(many.caveats.some(c=>/적용하지 않습니다/.test(c))&&many.caveats.some(c=>/선택 편향/.test(c))&&JSON.stringify(SC.WEIGHT_SETS.w1)===JSON.stringify(base),'(⑩) caveats say it is only a proposal; the w1 weights are untouched');
 // 서버: 출시 뒤 8주가 지난 넘긴 결정 9개 → 결정 때 점수표 하위 점수와 순매출
 const O='r3-learn',now=new Date(),handedAt=new Date(now.getTime()-70*DAY).toISOString(),orderDay=kst(new Date(now.getTime()-60*DAY));
 for(let i=0;i<9;i++){
  const card={id:`sc${i}`,productId:`p${i}`,weightsVersion:'w1',computedAt:handedAt,subScores:[['demand',50],['momentum',20+i*5],['durability',40],['competition',null],['profitability',null],['feasibility',60],['content',null],['brand_fit',null],['risk',90]].map(([key,value])=>({key,value,evidence:[],reason:''})),total:50,confidence:0.5,missing:[],blocked:null,tier:'watch',inputDigest:'0'};
  put(O,'pr_score',card.id,card,card.productId);
  put(O,'pr_decision',`d${i}`,{id:`d${i}`,productId:`p${i}`,scoreCardId:card.id,briefId:null,status:'approved',reason:'승인합니다.',decidedBy:{id:O,email:null},decidedAt:handedAt,handoff:{campaignId:'c1',signalId:`s${i}`,needId:null,candidateId:`cand${i}`,at:handedAt}},`p${i}`);
  put(O,'growth_sourcing_candidate',`cand${i}`,{id:`cand${i}`,campaignId:'c1',input:{catalogId:`cat${i}`}},'c1');
  put(O,'growth_catalog',`cat${i}`,{id:`cat${i}`,campaignId:'c1',input:{sku:`SKU${i}`}},'c1');
  put(O,'store_order',`o${i}`,{id:`o${i}`,orderDate:orderDay,status:'paid'},'s1');
  put(O,'growth_order_line',`l${i}`,{id:`l${i}`,input:{orderId:`o${i}`,units:1,paidAllocation:1000*(i+1),refundAllocation:0},snapshot:{catalog:{sku:`SKU${i}`}}},'s1');
 }
 const outcomes=plain(await ops.launchOutcomes(O,now));
 check(outcomes.length===9&&outcomes.every(o=>o.windows.find(w=>w.weeks===8).complete&&o.windows.find(w=>w.weeks===8).revenue>0),'(⑩) nine handed-off decisions have complete 8-week revenue');
 const prop=plain(await ops.weightsCandidate(O,outcomes,now));
 check(prop.n===9&&prop.proposed&&prop.proposed.momentum>SC.WEIGHT_SETS.w1.momentum&&prop.baseVersion==='w1','(⑩) server proposal from decision-time score cards and realised revenue');
 const few2=plain(await ops.weightsCandidate(O,outcomes.slice(0,5),now));
 check(few2.proposed===null&&/5개/.test(few2.reason),'(⑩) server: too few complete windows → null with reason');
 // 낮음: 집계 한도 초과 — 한도를 넘으면 마지막 SKU와 못 읽은 SKU는 null(0 아님)과 '집계 한도 초과'
 const big=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');sql.exec('BEGIN');
 for(let j=0;j<ops.OUTCOME_MAX_LINES;j++)big.run(`${O}:growth_order_line:z${String(j).padStart(5,'0')}`,O,'growth_order_line','s1',JSON.stringify({input:{orderId:'o4',units:1,paidAllocation:1,refundAllocation:0},snapshot:{catalog:{sku:'SKU4'}}}),new Date().toISOString());
 sql.exec('COMMIT');
 const cut=plain(await ops.launchOutcomes(O,now)),o0=cut.find(o=>o.sku==='SKU0'),o4=cut.find(o=>o.sku==='SKU4'),o8=cut.find(o=>o.sku==='SKU8');
 check(o0.windows.every(w=>w.orders!==null)&&o0.reason===null,'(low) SKUs read in full before the limit keep their numbers');
 check([o4,o8].every(o=>o.windows.every(w=>w.orders===null&&w.units===null&&w.revenue===null)&&o.reason.startsWith('집계 한도 초과')),'(low) the partly read SKU and SKUs after the limit are null with "집계 한도 초과" (never 0)');
 const again=plain(await ops.launchOutcomes(O,now));
 check(JSON.stringify(again)===JSON.stringify(cut),'(low) truncated reads are deterministic (ORDER BY sku, id)');
}

// GET: 재보정 후보가 수집 상태에서 화면 응답으로 나온다(마지막 재계산 기준).
r=await post(O5,{action:'recompute'});assert.equal(r.status,200,r.body.error);
v=await get(O5);
check(v.body.weightsProposal&&v.body.weightsProposal.proposed===null&&/최소 8개/.test(v.body.weightsProposal.reason)&&v.body.weightsProposal.correlations.length===9,'(⑩) GET weightsProposal after recompute: no complete outcomes yet → null with reason, all 9 sub-scores listed');
console.log(JSON.stringify({passed,sqlite:'real',auth:'mocked',providers:'mocked',clock:'injected',external:0}));
