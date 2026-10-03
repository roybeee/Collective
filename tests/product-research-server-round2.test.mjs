// 상품 리서치 서버 평가 2회차 보강 검사. 근거: mocked — 메모리 SQLite(실제 SQL·json_each), 로컬 인증 헤더 주입, 공급자 API는 fetch 스텁, 시계는 주입. 실제 네트워크 0회.
// 덮는 것: 이상치 격리 단위(관측 한 점)·상대값 급등은 다른 출처가 반박할 때만 격리(M1), 데이터랩 묶음 보정 기준점 = 묶음 키워드 검색량 합·보정 보고(M3),
// 수집 실행 시간 상한·잠금 갱신·잠금을 잃으면 상태 저장 안 함(M4), 넘기기의 소싱 후보 초안(M6)과 출시 뒤 판매 결과(M5), 저장 실패는 성공률에 넣지 않음·손익 변환 메모 보존(낮음).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const DAY=86400000,kst=d=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10),ymd=t=>new Date(t).toISOString().slice(0,10);
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const stub=async(url,init={})=>{
 const u=new URL(String(url));
 if(u.host==='api.searchad.naver.com'){const hints=(u.searchParams.get('hintKeywords')||'').split(',').filter(Boolean);return json({keywordList:hints.map((h,i)=>({relKeyword:h,monthlyPcQcCnt:1200+i,monthlyMobileQcCnt:8800,compIdx:'중간'}))})}
 if(u.host==='openapi.naver.com'&&u.pathname==='/v1/datalab/search'){
  const b=JSON.parse(init.body);const out=[];
  for(const g of b.keywordGroups){const data=[];let t=Date.parse(b.startDate+'T00:00:00Z');const end=Date.parse(b.endDate+'T00:00:00Z');while(t<=end){data.push({period:new Date(t).toISOString().slice(0,10),ratio:30});t+=(b.timeUnit==='week'?7:1)*DAY}out.push({title:g.groupName,keywords:g.keywords,data})}
  return json({startDate:b.startDate,endDate:b.endDate,timeUnit:b.timeUnit,results:out});
 }
 if(u.host==='openapi.naver.com'&&u.pathname==='/v1/datalab/shopping/category/keywords'){
  const b=JSON.parse(init.body);const out=[];
  for(const k of b.keyword){const data=[];let t=Date.parse(b.startDate+'T00:00:00Z');const end=Date.parse(b.endDate+'T00:00:00Z');while(t<=end){data.push({period:new Date(t).toISOString().slice(0,10),ratio:40});t+=7*DAY}out.push({title:k.name,keyword:k.param,data})}
  return json({startDate:b.startDate,endDate:b.endDate,timeUnit:b.timeUnit,results:out});
 }
 if(u.host==='openapi.naver.com'&&u.pathname==='/v1/search/shop.json'){const q=u.searchParams.get('query');return json({total:1520,items:[1,2].map(n=>({title:`<b>${q}</b> ${n}호 500g`,link:`https://smartstore.naver.com/shop${n}/products/${q.length}${n}`,lprice:String(3000+n*100),mallName:`몰${n}`,productId:`${q.length}0${n}${q.charCodeAt(0)}`,brand:`브랜드${n}`,category1:'식품'}))})}
 if(u.host==='www.googleapis.com'){if(u.pathname.endsWith('/search'))return json({pageInfo:{totalResults:3},items:[{id:{videoId:'abcdefghijk'}}]});const ids=(u.searchParams.get('id')||'').split(',');return json({items:ids.map(id=>({id,snippet:{title:'영상'},statistics:{viewCount:'1000'}}))})}
 if(u.host==='api-gateway.coupang.com')return json({rCode:'0',data:[{productId:77,productName:'마라소스 500g',productPrice:3900,productUrl:'https://www.coupang.com/vp/products/77',rank:2}]});
 throw new Error('외부 호출 금지: '+String(url));
};
const {sql,load}=testRuntime(stub);
const server=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),route=await load('app/api/product-research/route.ts');
const srv=await load('lib/product-research/server.ts'),collect=await load('lib/product-research/server-collect.ts');
const PL=await load('lib/product-research/server-pipeline.ts'),SC=await load('lib/product-research/analytics/score.ts'),growth=await load('lib/growth-sourcing.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const plain=v=>JSON.parse(JSON.stringify(v));
const hdr=o=>({'oai-authenticated-user-id':o,origin:'https://agency.test','content-type':'application/json'});
const get=async o=>{const r=await route.GET(new Request('https://agency.test/api/product-research',{headers:hdr(o)}));return {status:r.status,body:await r.json()}};
const post=async(o,b)=>{const r=await route.POST(new Request('https://agency.test/api/product-research',{method:'POST',headers:hdr(o),body:JSON.stringify({requestId:randomUUID(),...b})}));return {status:r.status,body:await r.json()}};
const direct=async(o,b,deps)=>{try{return {status:200,body:plain(await srv.researchAction({owner:o,id:o,email:null,role:'owner'},{requestId:randomUUID(),...b},deps))}}catch(e){return {status:e.status??500,body:{error:e.message}}}};
const rec=(o,kind,id)=>{const r=sql.prepare('SELECT data FROM records WHERE id=?').get(`${o}:${kind}:${id}`);return r?JSON.parse(r.data):null};
const rows=(o,kind)=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=?').all(o,kind).map(x=>JSON.parse(x.data));
const count=(o,kind)=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(o,kind).n;
const on=async(o,...names)=>{for(const flag of names)await flags.setFeatureFlag(o,{flag,enabled:true},{id:o,email:null})};
const putSnap=(o,s)=>{sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${o}:pr_snapshot:${s.id}`,o,'pr_snapshot',s.sourceId,JSON.stringify(s),s.fetchedAt);return s.id};
const snap=(sourceId,fetchedAt,request,observations)=>({id:randomUUID(),sourceId,method:'api',request,fetchedAt,bodyDigest:'0'.repeat(64),bodyBytes:10,status:'ok',limitations:[],importedBy:null,observations});
const kwObs=(text,metric,value,from,to)=>({subject:{type:'keyword',text},metric,value,period:{from,to}});
const now=new Date(),todayT=Date.parse(kst(now)+'T00:00:00Z');
// 지난 일요일(주 끝)과 그 주들
const lastSunday=todayT-((new Date(todayT).getUTCDay()+7)%7||7)*DAY;
const weeks=(n,valueOf)=>Array.from({length:n},(_,i)=>{const end=lastSunday-(n-1-i)*7*DAY;return {from:ymd(end-6*DAY),to:ymd(end),value:valueOf(i,n)}});

// ── M1 이상치 격리 단위와 상대값 급등
const O1='r2-anomaly';await on(O1,'product_research');
const spikeWeeks=weeks(20,(i,n)=>i===n-1?100:20+(i%3));
const dl1=putSnap(O1,snap('naver_datalab_search',new Date(now.getTime()-2*DAY).toISOString(),{timeUnit:'week',keywordGroups:'급등소스:급등소스;반박소스:반박소스;조용소스:조용소스'},
 ['급등소스','반박소스','조용소스'].flatMap(k=>spikeWeeks.map(w=>kwObs(k,'search_trend',k==='조용소스'?20:w.value,w.from,w.to)))));
// 검색광고 30일 실측 6점: 급등소스는 마지막 점도 같이 오름(동의), 반박소스는 평소 수준(반박)
const E=lastSunday;
for(let i=0;i<6;i++){const at=E-(5-i)*DAY,to=ymd(at),from=ymd(at-29*DAY);
 putSnap(O1,snap('naver_searchad_keyword',new Date(at+DAY+3600000).toISOString(),{keywords:'급등소스,반박소스'},[kwObs('급등소스','search_volume_month',i===5?6000:1000,from,to),kwObs('반박소스','search_volume_month',1000+i,from,to)]))}
let r=await post(O1,{action:'recompute'});
const q1=rows(O1,'pr_quarantine'),flagged=q1.find(q=>q.subjectKey==='kw:급등소스'&&q.metric==='search_trend'),blocked=q1.find(q=>q.subjectKey==='kw:반박소스'&&q.metric==='search_trend');
check(r.status===200&&flagged&&flagged.status==='flagged'&&/함께 올라/.test(flagged.basis)&&flagged.periodTo===spikeWeeks[19].to,'relative trend spike that the searchad volume confirms is only flagged (status flagged, basis says the second source agrees)');
check(blocked&&blocked.status==='active'&&/반박/.test(blocked.basis),'relative spike that the searchad volume contradicts is quarantined (active)');
check(!q1.some(q=>q.subjectKey==='kw:조용소스'),'flat series are untouched');
let snaps=plain(await PL.loadRecomputeSnapshots(O1,now)),dl=snaps.find(s=>s.id===dl1);
const pts=k=>dl.observations.filter(o=>o.subject.text===k&&o.metric==='search_trend');
check(pts('급등소스').length===20&&pts('급등소스').some(o=>o.value===100),'a flagged spike stays in the scoring input (real risers are not hidden)');
check(pts('반박소스').length===19&&!pts('반박소스').some(o=>o.period.to===spikeWeeks[19].to),'quarantine removes only that one point (periodTo), not the whole 104-week series');
let v=await get(O1);
check(v.body.quarantines.some(q=>q.id===blocked.id&&q.status==='active')&&!v.body.quarantines.some(q=>q.id===flagged.id)&&v.body.anomalyFlags.some(q=>q.id===flagged.id&&q.status==='flagged'&&q.basis),'GET: quarantines lists the active one, anomalyFlags lists the flagged one');
// 다음 날 같은 주를 다시 받은 데이터랩 스냅샷: 새로 격리·표시하지 않고, 격리한 기간은 새 스냅샷에서도 뺀다
const dl2=putSnap(O1,snap('naver_datalab_search',new Date(now.getTime()-DAY).toISOString(),{timeUnit:'week',keywordGroups:'급등소스:급등소스;반박소스:반박소스'},['급등소스','반박소스'].flatMap(k=>spikeWeeks.map(w=>kwObs(k,'search_trend',w.value,w.from,w.to)))));
const qBefore=count(O1,'pr_quarantine');r=await post(O1,{action:'recompute'});
check(r.status===200&&count(O1,'pr_quarantine')===qBefore,'re-fetching the same week does not re-quarantine or re-flag it daily');
snaps=plain(await PL.loadRecomputeSnapshots(O1,now));dl=snaps.find(s=>s.id===dl2);
check(dl&&dl.observations.filter(o=>o.subject.text==='반박소스').length===19&&dl.observations.filter(o=>o.subject.text==='급등소스').length===20,'the quarantined relative period is also dropped from the re-fetched snapshot (same source, subject, metric, periodTo)');
// 사람이 해제하면 다시 점수에 들어가고, 다시 격리하지 않는다
r=await post(O1,{action:'clear_quarantine',quarantineId:blocked.id,reason:'방송 노출로 실제 급증을 확인했습니다.'});
r=await post(O1,{action:'recompute'});
snaps=plain(await PL.loadRecomputeSnapshots(O1,now));
check(r.status===200&&count(O1,'pr_quarantine')===qBefore&&snaps.find(s=>s.id===dl2).observations.filter(o=>o.subject.text==='반박소스').length===20,'cleared period re-enters scoring and is not re-quarantined');
// 옛 격리 행(periodTo 없음)은 예전처럼 그 스냅샷의 대상·지표 전체를 뺀다
const legacy={id:'prq_legacy',sourceId:'naver_datalab_search',snapshotId:dl1,subjectKey:'kw:조용소스',metric:'search_trend',value:1,median:1,robustZ:9,window:[],status:'active',createdAt:now.toISOString(),cleared:null};
sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${O1}:pr_quarantine:prq_legacy`,O1,'pr_quarantine','naver_datalab_search',JSON.stringify(legacy),now.toISOString());
snaps=plain(await PL.loadRecomputeSnapshots(O1,now));
check(!snaps.find(s=>s.id===dl1).observations.some(o=>o.subject.text==='조용소스'),'legacy rows without periodTo still drop the whole (snapshot, subject, metric)');

// ── M3 데이터랩 묶음 보정: 기준점 = 묶음 키워드 검색광고 실측 합, 보정 보고
const O2='r2-calib';await on(O2,'product_research');
const trend=weeks(30,()=>50);
putSnap(O2,snap('naver_datalab_search',new Date(now.getTime()-DAY).toISOString(),{timeUnit:'week',keywordGroups:'마라소스:마라소스|마라탕소스'},trend.map(w=>kwObs('마라소스','search_trend',w.value,w.from,w.to))));
for(const back of [0,40,80,120]){const at=E-back*DAY,to=ymd(at),from=ymd(at-29*DAY);
 putSnap(O2,snap('naver_searchad_keyword',new Date(at+DAY).toISOString(),{keywords:'마라소스'},[kwObs('마라소스','search_volume_month',1000,from,to)]));
 putSnap(O2,snap('naver_searchad_keyword',new Date(at+DAY+60000).toISOString(),{keywords:'마라탕소스'},[kwObs('마라탕소스','search_volume_month',3000,from,to)]))}
putSnap(O2,{...snap('coupang_ranking_manual',new Date(now.getTime()-DAY).toISOString(),{scope:'소스'},[{subject:{type:'listing',sourceId:'coupang_ranking_manual',externalId:'M1',title:'매운집 마라소스 500g',brand:null,price:3900,url:'https://www.coupang.com/vp/products/1',categoryPath:null},metric:'rank',value:1,period:{from:ymd(E),to:ymd(E)}}]),method:'manual',importedBy:{id:O2,email:null,fileName:'c.csv'}});
r=await post(O2,{action:'recompute'});
const mara=r.body.products.find(p=>/마라소스/.test(p.name)),demand=mara.score.subScores.find(s=>s.key==='demand');
check(r.status===200&&demand.value!==null&&/약 4,000회/.test(demand.reason),`group demand is calibrated against the sum of the group's keywords (1,000 + 3,000), not the representative keyword alone: ${demand.reason}`);
check(demand.evidence.length>=3,'demand cites both keywords\' searchad anchors and the trend snapshot');
v=await get(O2);
check(v.body.calibration&&v.body.calibration.groups===1&&v.body.calibration.mape!==null&&v.body.calibration.mape<0.01&&v.body.calibration.rows[0].label==='마라소스'&&typeof v.body.calibration.rows[0].error==='number'&&typeof v.body.calibration.at==='string','GET calibration: per-group error, overall MAPE and group count from the last recompute');
// 순수 확인: 대표 키워드만 기준점으로 쓰면 1,000이다(이전 동작 비교)
const m2=PL.material(plain(await PL.loadRecomputeSnapshots(O2,now))),d2=PL.computeProducts(m2,[],[],new Set(),now.toISOString()).drafts.find(d=>/마라소스/.test(d.product.name));
const solo=SC.buildScoreInput({...d2.bundle,trendMembers:undefined},d2.asOf),grouped=SC.buildScoreInput(d2.bundle,d2.asOf);
check(Math.round(solo.demand.monthlyVolume)===1000&&Math.round(grouped.demand.monthlyVolume)===4000,'(sanity) without the group composition the anchor is the representative keyword only (1,000); with it the sum (4,000)');
const CAL=await load('lib/product-research/analytics/calibrate.ts'),pt=(at,value,id)=>({at,value,snapshotId:id});
check(JSON.stringify(plain(CAL.sumAnchors([[pt('2026-09-01',10,'a'),pt('2026-09-02',11,'a2')],[pt('2026-09-01',5,'b')],[pt('2026-08-01',7,'c')]])))===JSON.stringify([pt('2026-09-01',15,'a')]),'sumAnchors adds only dates every kept keyword has (a keyword with no overlapping date is dropped, never counted as 0)');
check(CAL.sumAnchors([[pt('2026-09-01',null,'a')],[pt('2026-09-01',5,'b')]]).length===0,'a missing (null) value is not summed as 0');
check(PL.calibrationReport(m2,'x').rows.length===1&&PL.calibrationReport({...m2,trendMembers:new Map()},'x').rows.length===1,'calibration report works with or without a group composition');

// ── M4 실행 시간 상한(주입한 시계)과 잠금 갱신
const O3='r2-budget';await on(O3,'product_research','product_research_collect');
for(const [credentialKey,input] of [['naver_searchad',{apiKey:'searchadApiKey0123456789',secretKey:'SECRETsearchadsecret1234567',customerId:'1234567'}],['naver_developers',{clientId:'devClientId01',clientSecret:'SECRETdevsecret123'}]]){r=await post(O3,{action:'connect_source',credentialKey,input});assert.equal(r.status,200,r.body.error)}
let t=Date.now(),calls=0;const clock=()=>new Date(t),slow=async(u,i)=>{t+=20000;calls++;return stub(u,i)};
let st=await collect.runProductResearchQueue(O3,{fetch:slow,now:clock});
let state=rec(O3,'pr_collect_state','current');
check(st.status==='processed'&&calls===5&&state.cursor===5&&state.plan.length>12&&state.done===false&&typeof state.stoppedAt==='string','a worker tick stops after the 90 s budget (5 provider calls at 20 s each, not 12) and saves its cursor');
check(count(O3,'pr_product')===0,'a time-stopped tick defers the recompute');
calls=0;st=await collect.runProductResearchQueue(O3,{fetch:slow,now:clock});state=rec(O3,'pr_collect_state','current');
check(calls===5&&state.cursor===10,'the next tick resumes from the saved cursor');
// 단계마다 잠금을 갱신한다: 만료 직전으로 돌려 놔도 다음 단계 전에 다시 120초로 민다
const lockRow=()=>sql.prepare('SELECT token,expires_at FROM mutation_locks WHERE owner=?').get(O3+':product-research');
// 호출마다 만료를 1초 뒤로 당겨 두고, 다음 호출 때 120초 근처로 다시 밀려 있는지 본다(그 사이 단계 시작 때 갱신했다는 뜻).
const seen=[];const renewing=async(u,i)=>{const row=lockRow();seen.push(row?row.expires_at-Date.now():null);sql.prepare('UPDATE mutation_locks SET expires_at=? WHERE owner=?').run(Date.now()+1000,O3+':product-research');t+=1000;return stub(u,i)};
calls=0;await collect.runProductResearchQueue(O3,{fetch:renewing,now:clock});
check(seen.length>=3&&seen.every(ms=>ms!==null&&ms>100000),`the lock is renewed to ~120 s before every step of a running tick (${seen.length} steps)`);
// 잠금을 잃으면(만료 뒤 다른 실행이 가져감) 상태를 저장하지 않고 멈춘다
const before=rec(O3,'pr_collect_state','current'),marker={...before,cursor:999,lastRunAt:'other-run'};
let n2=0;const steal=async(u,i)=>{n2++;if(n2===2){sql.prepare('UPDATE mutation_locks SET token=? WHERE owner=?').run('other-run-token',O3+':product-research');sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(marker),`${O3}:pr_collect_state:current`)}t+=1000;return stub(u,i)};
st=await collect.runProductResearchQueue(O3,{fetch:steal,now:clock});
check(st.status==='idle'&&n2===2&&rec(O3,'pr_collect_state','current').cursor===999&&rec(O3,'pr_collect_state','current').lastRunAt==='other-run','after losing the lock the run stops and does not overwrite the other run\'s collect state');
sql.prepare('DELETE FROM mutation_locks WHERE owner=?').run(O3+':product-research');
sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(before),`${O3}:pr_collect_state:current`);
n2=0;r=await direct(O3,{action:'collect_now'},{fetch:steal,now:clock,lockWaitMs:0});
check(r.status===409&&/잠금이 만료/.test(r.body.error)&&rec(O3,'pr_collect_state','current').lastRunAt==='other-run','collect_now that loses the lock is 409 and leaves the other run\'s state');
sql.prepare('DELETE FROM mutation_locks WHERE owner=?').run(O3+':product-research');

// ── 낮음: 저장 실패는 30일 성공률에 성공으로 세지 않는다(스냅샷 한도를 채워 저장을 실패시킨다)
const O4='r2-storage';await on(O4,'product_research','product_research_collect');
r=await post(O4,{action:'connect_source',credentialKey:'naver_developers',input:{clientId:'devClientId01',clientSecret:'SECRETdevsecret123'}});assert.equal(r.status,200);
const fill=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');sql.exec('BEGIN');
for(let i=0;i<20000;i++){const at=new Date(now.getTime()-i*1000).toISOString();fill.run(`${O4}:pr_snapshot:f${i}`,O4,'pr_snapshot','naver_searchad_keyword',JSON.stringify({...snap('naver_searchad_keyword',at,{},[]),id:`f${i}`}),at)}
sql.exec('COMMIT');
r=await direct(O4,{action:'collect_now',sourceId:'naver_shop_search'},{fetch:stub,now:()=>new Date()});
const shopQuota=rows(O4,'pr_quota').find(q=>q.sourceId==='naver_shop_search');
check(r.status===200&&shopQuota.calls>0&&!(shopQuota.ok>0)&&/한도/.test(rec(O4,'pr_collect_state','current').errors.naver_shop_search.message),'provider answered but storage failed → call counted, success not counted');
v=await get(O4);check(v.body.freshness.find(f=>f.sourceId==='naver_shop_search').successRate30d===0,'30-day success rate shows 0 for storage failures (not 100%)');
sql.prepare("DELETE FROM records WHERE owner=? AND kind='pr_snapshot'").run(O4);

// ── M6 넘기기의 소싱 후보 초안, M5 출시 뒤 판매 결과
const O5='r2-launch';await on(O5,'product_research');
const header='rank,title,brand,price,review_count,rating,external_id,url',observedDate=kst(new Date(now.getTime()-2*DAY));
r=await post(O5,{action:'import_file',sourceId:'coupang_ranking_manual',fileName:'c.csv',text:[header,'1,매운집 마라소스 500g,매운집,3900,120,4.8,A1,https://www.coupang.com/vp/products/1001','2,매운집 떡볶이소스 300g,매운집,2500,80,4.6,A2,https://www.coupang.com/vp/products/1002'].join('\n'),scope:'소스',observedDate});
assert.equal(r.status,200,r.body.error);
const pMara=r.body.products.find(p=>/마라소스/.test(p.name)),pJjajang=r.body.products.find(p=>/떡볶이소스/.test(p.name));
const approve=async p=>{const x=await post(O5,{action:'decide',productId:p.id,scoreCardId:p.score.id,briefId:null,status:'approved',reason:'상표 위험을 확인했고 순위 근거로 승인합니다.',riskAcknowledged:true});assert.equal(x.status,200,x.body.error);return x.body.resultId};
const dMara=await approve(pMara),dJj=await approve(pJjajang);
await server.recordStatement(O5,'campaign','camp1',{id:'camp1',brandId:'b1',title:'가을 소스',version:3,status:'active',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'}).run();
await server.recordStatement(O5,'campaign','camp2',{id:'camp2',brandId:'b1',title:'빈 캠페인',version:1,status:'active',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'}).run();
await server.recordStatement(O5,'growth_catalog','cat1',{id:'cat1',brandId:'b1',campaignId:'camp1',version:2,campaignVersion:3,input:{sku:'SKU-MARA',title:'마라소스 500g'}},'camp1').run();
await server.recordStatement(O5,'growth_catalog','catX',{id:'catX',brandId:'b2',campaignId:'campX',version:1,campaignVersion:1,input:{sku:'X'}},'campX').run();
r=await post(O5,{action:'handoff',decisionId:dMara,campaignId:'camp1',campaignVersion:3,catalogId:'catX'});
check(r.status===404&&count(O5,'growth_signal')===0,'handoff with a catalog item of another campaign is 404 and writes nothing');
r=await post(O5,{action:'handoff',decisionId:dMara,campaignId:'camp1',campaignVersion:3});
const cand=rows(O5,'growth_sourcing_candidate')[0],decMara=rec(O5,'pr_decision',dMara);
check(r.status===200&&count(O5,'growth_sourcing_candidate')===1&&cand.status==='draft'&&cand.mayOrder===false&&cand.campaignId==='camp1'&&cand.brandId==='b1'&&cand.version===1,'handoff creates one growth_sourcing_candidate draft in the campaign (status draft, mayOrder false)');
check(cand.input.unitCost===null&&cand.input.moq===null&&cand.input.leadDays===null&&cand.input.taxBasis==='unknown'&&cand.input.catalogId==='cat1'&&cand.input.catalogVersion===2&&cand.productResearch.decisionId===dMara,'draft costs are unknown (null), linked to the only campaign catalog item, with provenance');
check(JSON.stringify(plain(growth.parseCandidateInput(cand.input)))===JSON.stringify(cand.input),'the draft passes the growth sourcing validator unchanged (parseCandidateInput)');
check(count(O5,'growth_sourcing_history')===1&&count(O5,'growth_catalog')===2&&count(O5,'store_order')===0,'history row written; no catalog or order is created');
const offer0=rows(O5,'growth_offer')[0];
check(count(O5,'growth_offer')===1&&offer0.input.priceApproved===false&&offer0.input.price===null&&offer0.input.catalogId==='cat1'&&offer0.input.needId===decMara.handoff.needId&&decMara.handoff.offerId===offer0.id,'(round 3 ⑩) handoff also creates one offer draft for the same catalog item: no price, price not approved, linked to the need draft');
check(decMara.handoff.candidateId===cand.id&&typeof decMara.handoff.at==='string'&&rec(O5,'pr_product',pMara.id).sourcing.candidateId===cand.id,'decision records the candidate and handoff time; the product is linked to the draft');
r=await post(O5,{action:'handoff',decisionId:dJj,campaignId:'camp2',campaignVersion:1});
const reqRow=rows(O5,'pr_request').find(x=>x.action==='handoff'&&x.status==='done'&&x.job?.signalId===r.body.resultId);
check(r.status===200&&count(O5,'growth_sourcing_candidate')===1&&/카탈로그 상품이 없어/.test(reqRow.job.candidateSkipped)&&rec(O5,'pr_decision',dJj).handoff.candidateId===null,'campaign without a catalog item: no draft, reason recorded on the request');
// 주문 장부: 넘긴 뒤 SKU-MARA 주문 2건(하나는 취소), 다른 SKU 1건
const day=kst(now);
const order=(id,status)=>server.recordStatement(O5,'store_order',id,{id,storeId:'s1',orderDate:day,status,paidAmount:20000,refundAmount:0},'s1').run();
const line=(id,orderId,sku,units,paid,refund)=>server.recordStatement(O5,'growth_order_line',id,{id,brandId:'b1',storeId:'s1',campaignId:'camp1',version:1,input:{orderId,units,paidAllocation:paid,refundAllocation:refund},snapshot:{catalog:{sku,title:sku}}},'s1').run();
await order('o1','paid');await order('o2','cancelled');await order('o3','paid');
await line('l1','o1','SKU-MARA',3,12000,0);await line('l2','o2','SKU-MARA',5,20000,0);await line('l3','o3','SKU-OTHER',1,9000,0);
r=await post(O5,{action:'recompute'});
v=await get(O5);
const oMara=v.body.launchOutcomes.find(x=>x.decisionId===dMara),oJj=v.body.launchOutcomes.find(x=>x.decisionId===dJj);
check(oMara&&oMara.sku==='SKU-MARA'&&oMara.reason===null&&oMara.windows.map(w=>w.weeks).join()==='4,8,12'&&oMara.windows.every(w=>w.complete===false),'launch outcome links the handed-off decision to the catalog SKU via the sourcing draft (4/8/12-week windows, not complete yet)');
check(oMara.windows[0].orders===1&&oMara.windows[0].units===3&&oMara.windows[0].revenue===12000,'post-launch units/revenue from the order ledger (cancelled order and other SKUs excluded)');
check(oJj&&oJj.sku===null&&oJj.windows.every(w=>w.orders===null&&w.units===null&&w.revenue===null)&&/소싱 후보/.test(oJj.reason),'no SKU link → values stay null (not 0) with a reason');

// ── 낮음: 소싱 견적의 손익 변환 메모(묶음 단위·세금 기준 미확인)를 버리지 않는다
const day0=ymd(E),lst={type:'listing',sourceId:'coupang_ranking_manual',externalId:'Q1',title:'매운집 고추장 500g',brand:'매운집',price:3900,url:null,categoryPath:null};
const m0=PL.material([{...snap('coupang_ranking_manual',new Date(E+DAY).toISOString(),{},[{subject:lst,metric:'rank',value:1,period:{from:day0,to:day0}},{subject:lst,metric:'price_min',value:3900,period:{from:day0,to:day0}}]),method:'manual',importedBy:{id:'op',email:null,fileName:'x.csv'}}]);
const p0=PL.computeProducts(m0,[],[],new Set(),now.toISOString()).drafts[0].product,link={campaignId:'camp1',candidateId:'c1',candidateVersion:1};
const quote=(unit,taxBasis)=>PL.quoteFrom(link,{campaignId:'camp1',version:1,input:{unitCost:1000,moq:100,leadDays:7,shippingCost:0,extraCost:0,taxBasis,unit,validUntil:''}},now);
const cardFor=q=>{const d=PL.computeProducts(m0,[{...p0,sourcing:link}],[],new Set(),now.toISOString(),{sourcing:new Map([[p0.id,q]])}).drafts[0];return PL.draftCard(d,now.toISOString())};
const noted=cardFor(quote('pack','unknown')),clean=cardFor(quote('piece','included')),prof=c=>c.subScores.find(s=>s.key==='profitability');
check(/견적 참고/.test(prof(noted).reason)&&/묶음\(pack\)/.test(prof(noted).reason)&&/세금 기준 미확인/.test(prof(noted).reason)&&!/견적 참고/.test(prof(clean).reason),`profit conversion notes are kept on the profitability sub-score: ${prof(noted).reason}`);
check(noted.id!==cardFor(quote('piece','unknown')).id,'different notes → different score-card version (notes are part of the input digest)');

console.log(JSON.stringify({passed,sqlite:'real',auth:'mocked',providers:'mocked',clock:'injected',external:0}));
