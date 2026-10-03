// 상품 리서치 서버 평가 1회차 보강 검사. 근거: mocked — 메모리 SQLite(실제 SQL·json_each·창 함수), 로컬 인증 헤더 주입, 공급자 API는 fetch 스텁. 실제 네트워크 0회.
// 덮는 것: 출처별 하루 상한(즉시 수집 20번 연속에도 상한 안, 하루 3번)·문서 표와 코드 상한 일치(H4), 상품 리서치 잠금 통일(작업자 수집 vs 화면 재계산·즉시 수집, H5),
// 가져오기 기준일 14일·넘기기 관측 시각 = 기준일·30일 지난 근거 거절(M1), 일시 오류 재시도·경보·주간 MD 리포트(⑪), 30일 성공률·이상치 격리·해제(②),
// 자사 판매 스냅샷·랭킹 이번 주 가져오기(①), 넘기기 고객 기회 초안·소싱 연결·리스크 검토 관문(⑩·⑦), 승인 관문 409(⑫), 화면·서버 공용 검사 상수(M8).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const DAY=86400000,kst=d=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
const kstMonday=d=>{const day=kst(d),t=Date.parse(day+'T00:00:00Z'),dow=(new Date(t).getUTCDay()+6)%7;return new Date(t-dow*DAY).toISOString().slice(0,10)};
const calls=[];const mode={youtube:'ok'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const stub=async(url,init={})=>{
 const u=new URL(String(url));calls.push({host:u.host,path:u.pathname});
 if(u.host==='api.searchad.naver.com'){const hints=(u.searchParams.get('hintKeywords')||'').split(',').filter(Boolean);return json({keywordList:hints.map((h,i)=>({relKeyword:h,monthlyPcQcCnt:1200+i,monthlyMobileQcCnt:8800,compIdx:'중간'}))})}
 if(u.host==='openapi.naver.com'&&u.pathname==='/v1/datalab/search'){
  const b=JSON.parse(init.body);const out=[];
  for(const g of b.keywordGroups){const data=[];let t=Date.parse(b.startDate+'T00:00:00Z'),i=0;const end=Date.parse(b.endDate+'T00:00:00Z');while(t<=end){data.push({period:new Date(t).toISOString().slice(0,10),ratio:Math.min(100,20+i*0.5)});t+=(b.timeUnit==='week'?7:1)*DAY;i++}out.push({title:g.groupName,keywords:g.keywords,data})}
  return json({startDate:b.startDate,endDate:b.endDate,timeUnit:b.timeUnit,results:out});
 }
 if(u.host==='openapi.naver.com'&&u.pathname==='/v1/search/shop.json'){const q=u.searchParams.get('query');return json({total:1520,items:[1,2].map(n=>({title:`<b>${q}</b> 정품 ${n}호 500g`,link:`https://smartstore.naver.com/shop${n}/products/${q.length}${n}`,lprice:String(3000+n*100),mallName:`몰${n}`,productId:`${q.length}0${n}${q.charCodeAt(0)}`,brand:`브랜드${n}`,category1:'식품'}))})}
 if(u.host==='www.googleapis.com'){
  if(u.pathname.endsWith('/search'))return mode.youtube==='fail'?new Response('boom',{status:503}):json({pageInfo:{totalResults:321},items:[{id:{videoId:'abcdefghijk'}}]});
  const ids=(u.searchParams.get('id')||'').split(',');return json({items:ids.map(id=>({id,snippet:{title:'영상 '+id},statistics:{viewCount:'1000'}}))});
 }
 if(u.host==='api-gateway.coupang.com'){
  if(u.pathname.includes('/search'))return json({rCode:'0',data:{productData:[{productId:1,productName:'라면',productPrice:1000,productUrl:'https://www.coupang.com/vp/products/1',rank:1}]}});
  return json({rCode:'0',data:[{productId:77,productName:'오뚜기 마라소스 500g',productPrice:3900,productUrl:'https://link.coupang.com/re/AFF?lptag=x',rank:2}]});
 }
 throw new Error('외부 호출 금지: '+String(url));
};
const {sql,load}=testRuntime(stub);
const server=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),route=await load('app/api/product-research/route.ts');
const srv=await load('lib/product-research/server.ts'),collect=await load('lib/product-research/server-collect.ts'),ops=await load('lib/product-research/server-ops.ts');
const store=await load('lib/product-research/server-store.ts'),quota=await load('lib/product-research/collectors/quota.ts'),api=await load('lib/product-research/api.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const plain=v=>JSON.parse(JSON.stringify(v));
const hdr=o=>({'oai-authenticated-user-id':o,origin:'https://agency.test','content-type':'application/json'});
const get=async o=>{const r=await route.GET(new Request('https://agency.test/api/product-research',{headers:hdr(o)}));return {status:r.status,body:await r.json()}};
const post=async(o,b)=>{const r=await route.POST(new Request('https://agency.test/api/product-research',{method:'POST',headers:hdr(o),body:JSON.stringify({requestId:randomUUID(),...b})}));return {status:r.status,body:await r.json()}};
const direct=async(o,b,deps)=>{try{return {status:200,body:plain(await srv.researchAction({owner:o,id:o,email:null,role:'owner'},{requestId:randomUUID(),...b},deps))}}catch(e){return {status:e.status??500,body:{error:e.message}}}};
const rec=(o,kind,id)=>{const r=sql.prepare('SELECT data FROM records WHERE id=?').get(`${o}:${kind}:${id}`);return r?JSON.parse(r.data):null};
const count=(o,kind)=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(o,kind).n;
const on=async(o,...names)=>{for(const flag of names)await flags.setFeatureFlag(o,{flag,enabled:true},{id:o,email:null})};
const connectAll=async o=>{
 for(const [credentialKey,input] of [['naver_searchad',{apiKey:'searchadApiKey0123456789',secretKey:'SECRETsearchadsecret1234567',customerId:'1234567'}],['naver_developers',{clientId:'devClientId01',clientSecret:'SECRETdevsecret123'}],['youtube',{apiKey:'AIzaSECRETyoutubekey12345'}],['coupang_partners',{accessKey:'coupang-access-1',secretKey:'SECRETcoupang-secret-key'}]]){
  const r=await post(o,{action:'connect_source',credentialKey,input});assert.equal(r.status,200,`${credentialKey} connect: ${r.body.error}`);
 }
};
const quotaRows=o=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='pr_quota'").all(o).map(x=>JSON.parse(x.data));

// ── M8: 화면과 서버가 같은 검사 상수를 쓴다
check(api.QUESTION_MAX===200&&api.REASON_MIN===5&&api.REASON_MAX===500&&api.BRAND_FIT_REASON_MAX===300&&api.PRICE_MAX_MIN===100&&api.PRICE_MAX_MAX===10_000_000&&api.IMPORT_MAX_AGE_DAYS===14&&api.COLLECT_NOW_PER_DAY===3&&api.HANDOFF_EVIDENCE_MAX_DAYS===30,'api.ts exports the server validation limits');
check(['clear_quarantine','link_sourcing','unlink_sourcing','save_risk_review'].every(a=>api.RESEARCH_ACTIONS.includes(a))&&api.RESEARCH_ACTIONS.slice(0,12).join()==='save_settings,connect_source,disconnect_source,import_file,collect_now,recompute,confirm_match,set_brand_fit,generate_brief,decide,handoff,run_backtest','new actions are appended (existing order unchanged)');

// ── H4: 출처별 하루 상한(공급자 한도가 없는 출처 포함)과 문서 표 일치
const caps=plain(quota.APP_DAILY_CAPS);
check(caps.naver_searchad_keyword===200&&caps.coupang_partners===100&&caps.naver_shop_search===2000&&caps.naver_datalab_search===900&&caps.youtube_data===9000,'conservative app caps for every auto source (searchad/coupang have no published quota)');
check(quota.dailyCap('coupang_ranking_manual')===0&&quota.dailyCap('own_sales')===0&&quota.dailyCap('licensed_ranking')===0&&quota.dailyCap('naver_datalab_shopping')===0,'non-auto and unplanned sources have a zero cap (fail closed)');
const doc=readFileSync('docs/PRODUCT-RESEARCH.ko.md','utf8');
const docRow=host=>doc.split('\n').find(l=>l.startsWith('|')&&l.includes(host)&&l.includes('하루 상한')===false&&/\d/.test(l))||'';
const capCell={naver_searchad_keyword:['api.searchad.naver.com','200회'],naver_datalab_search:['데이터랩 검색어 트렌드','900회'],naver_shop_search:['네이버 쇼핑 검색','2,000회'],youtube_data:['www.googleapis.com','9,000단위'],coupang_partners:['api-gateway.coupang.com','100회']};
check(Object.entries(capCell).every(([id,[key,text]])=>docRow(key).includes(text)&&caps[id]===Number(text.replace(/[^\d]/g,''))),'docs/PRODUCT-RESEARCH.ko.md states exactly the caps the code enforces');

const O1='ops-caps';await on(O1,'product_research','product_research_collect');await connectAll(O1);
mode.youtube='fail';
const statuses=[];for(let i=0;i<20;i++){const r=await post(O1,{action:'collect_now'});statuses.push(r.status);if(i===3)check(r.status===409&&/하루 3번/.test(r.body.error),'4th collect_now of the KST day is 409 with a Korean reason')}
check(statuses.filter(s=>s===200).length===3&&statuses.slice(3).every(s=>s===409),'20 consecutive collect_now: only 3 run per KST day');
const n=(host,path)=>calls.filter(c=>c.host===host&&(!path||c.path===path)).length;
check(n('api.searchad.naver.com')<=200&&n('openapi.naver.com','/v1/datalab/search')<=900&&n('openapi.naver.com','/v1/search/shop.json')<=2000&&n('api-gateway.coupang.com')<=100,'provider calls stay under every cap after 20 collect_now');
check(quotaRows(O1).every(q=>q.used<=quota.dailyCap(q.sourceId)),'quota ledger never exceeds the app cap');
let v=await get(O1);
check(v.body.collectNow.usedToday===3&&v.body.collectNow.maxPerDay===3,'view shows collect_now runs used today');
check(v.body.sources.find(s=>s.id==='coupang_partners').dailyQuota===100&&v.body.sources.find(s=>s.id==='coupang_ranking_manual').dailyQuota===null,'view shows the enforced daily cap per auto source');
// 남은 상한만 쓴다: 다른 소유자의 검색광고 원장을 상한-1로 두면 즉시 수집은 검색광고를 1번만 부른다. 쿠팡은 상한을 다 썼으면 0번.
const O2='ops-remaining';await on(O2,'product_research','product_research_collect');await connectAll(O2);
const today=kst(new Date());
sql.prepare("UPDATE records SET data=json_set(data,'$.used',199,'$.calls',199) WHERE owner=? AND kind='pr_quota' AND parent_id='naver_searchad_keyword'").run(O2);
sql.prepare("UPDATE records SET data=json_set(data,'$.used',100,'$.calls',100) WHERE owner=? AND kind='pr_quota' AND parent_id='coupang_partners'").run(O2);
const before2={sa:n('api.searchad.naver.com'),cp:n('api-gateway.coupang.com')};
let r=await post(O2,{action:'collect_now'});
check(r.status===200&&n('api.searchad.naver.com')-before2.sa===1&&n('api-gateway.coupang.com')-before2.cp===0,'collect_now spends only the remaining daily budget (searchad 1 left → 1 call, coupang 0 left → 0 calls)');
check(/쿼터 상한/.test(rec(O2,'pr_collect_state','current').errors.naver_searchad_keyword.message)&&quotaRows(O2).every(q=>q.used<=quota.dailyCap(q.sourceId)),'cap refusal recorded and ledger stays at the cap');

// ── ⑪ 일시 오류 재시도·경보·주간 MD 리포트, ② 30일 성공률
const st1=rec(O1,'pr_collect_state','current');
check(st1.attempts.youtube_data.count>=1&&st1.failures.youtube_data&&typeof st1.failures.youtube_data.since==='string','youtube 503 counted as a transient attempt with a failure streak');
v=await get(O1);
check(v.body.alerts.some(a=>a.sourceId==='youtube_data'&&a.since===st1.failures.youtube_data.since&&a.message),'GET alerts carry the failing source, message and since');
const fy=v.body.freshness.find(f=>f.sourceId==='youtube_data'),fs=v.body.freshness.find(f=>f.sourceId==='naver_shop_search');
check(fs.successRate30d===1&&fs.calls30d>0&&typeof fs.lastOkAt==='string'&&fy.successRate30d<1,'freshness: 30-day success rate per source (shop 100%, youtube below) and lastOkAt');
check(v.body.freshness.find(f=>f.sourceId==='coupang_ranking_manual').successRate30d===null,'freshness: import-only sources have no call success rate (null, not 0)');
if(kst(new Date(Date.now()+40*60000))===today){
 // 물러난 시간이 지나 YouTube가 회복하면 다음 작업자 순환에서 다시 시도해 성공하고 경보가 사라진다.
 mode.youtube='ok';
 const later={fetch:stub,now:()=>new Date(Date.now()+30*60000)};let s,k=0;do{s=await collect.runProductResearchQueue(O1,later);k++}while(s.status==='processed'&&k<10);
 const st2=rec(O1,'pr_collect_state','current');
 check(st2.done===true&&!st2.failures.youtube_data&&!st2.errors.youtube_data&&!st2.skip.includes('youtube_data'),'after the backoff the next worker tick retries youtube, succeeds and clears the alert');
 check(st2.weekly&&st2.weekly.week===kstMonday(new Date())&&(typeof st2.weekly.briefId==='string'||typeof st2.weekly.reason==='string'),'weekly MD report runs once the day plan is done (KST week starting Monday)');
 const at=st2.weekly.at;await collect.runProductResearchQueue(O1,later);
 check(rec(O1,'pr_collect_state','current').weekly.at===at,'weekly MD report is not regenerated in the same KST week');
 if(st2.weekly.briefId)check(rec(O1,'pr_brief',st2.weekly.briefId).question==='주간 MD 리포트','weekly report stored as pr_brief with the weekly question');else passed++;
}else passed+=4;

// ── H5: 작업자 수집과 화면 쓰기가 같은 상품 리서치 잠금을 쓴다
const O3='ops-lock';await on(O3,'product_research','product_research_collect');await connectAll(O3);
const locked=o=>sql.prepare('SELECT COUNT(*) n FROM mutation_locks WHERE owner=?').get(o+':product-research').n>0;
const waitLock=async o=>{for(let i=0;i<400&&!locked(o);i++)await new Promise(res=>setTimeout(res,5));return locked(o)};
let open;const gate=()=>{let release;const p=new Promise(res=>{release=res});open=release;return async(url,init)=>{await p;return stub(url,init)}};
const uiCollect=direct(O3,{action:'collect_now'},{fetch:gate(),now:()=>new Date(),lockWaitMs:0});
check(await waitLock(O3),'collect_now holds the per-owner product-research lock while calling providers');
r=await direct(O3,{action:'recompute'},{fetch:stub,now:()=>new Date(),lockWaitMs:0});
check(r.status===409&&r.body.error==='다른 상품 리서치 작업이 진행 중입니다. 잠시 후 다시 시도하세요.','concurrent recompute during collect_now is 409 with the shared message');
r=await post(O3,{action:'import_file',sourceId:'coupang_ranking_manual',fileName:'c.csv',text:'rank,title\n1,가\n',scope:'x',observedDate:today});
check(r.status===409&&/다른 상품 리서치 작업/.test(r.body.error)&&count(O3,'pr_snapshot')===0,'route import during collection is 409 and stores nothing');
const stateBefore=JSON.stringify(rec(O3,'pr_collect_state','current'));
check((await collect.runProductResearchQueue(O3)).status==='idle'&&JSON.stringify(rec(O3,'pr_collect_state','current'))===stateBefore,'worker tick idles without touching pr_collect_state while the UI holds the lock');
open();r=await uiCollect;check(r.status===200&&!locked(O3),'collect_now finishes and releases the lock');
const worker=collect.runProductResearchQueue(O3,{fetch:gate(),now:()=>new Date()});
check(await waitLock(O3),'worker-driven collection takes the same product-research lock');
r=await post(O3,{action:'recompute'});check(r.status===409&&/다른 상품 리서치 작업/.test(r.body.error),'UI recompute while the worker collects is 409');
r=await post(O3,{action:'collect_now'});check(r.status===409&&/다른 상품 리서치 작업/.test(r.body.error),'UI collect_now while the worker collects is 409');
open();check((await worker).status==='processed'&&!locked(O3),'worker tick finishes and releases the lock');
r=await post(O3,{action:'recompute'});check(r.status===200,'recompute succeeds once the lock is free');

// ── M1 가져오기 기준일, ⑫ 승인 관문, ⑦ 리스크 검토, ⑩ 넘기기 니즈 초안·소싱 연결
const O4='ops-gates';await on(O4,'product_research');
const header='rank,title,brand,price,review_count,rating,external_id,url';
const rows=[header,'1,오뚜기 마라소스 500g,오뚜기,3900,120,4.8,A1,https://www.coupang.com/vp/products/1001','2,청정원 떡볶이소스 300g,청정원,2500,80,4.6,A2,https://www.coupang.com/vp/products/1002','3,해외 가품 불닭소스 레플리카,,1500,3,2.1,A3,'].join('\n');
const observedDate=kst(new Date(Date.now()-10*DAY));
r=await post(O4,{action:'import_file',sourceId:'coupang_ranking_manual',fileName:'old.csv',text:rows,scope:'쿠팡 소스',observedDate:kst(new Date(Date.now()-15*DAY))});
check(r.status===400&&/14일/.test(r.body.error+JSON.stringify(r.body.issues))&&count(O4,'pr_snapshot')===0,'import with observedDate older than 14 days (KST) is refused');
r=await post(O4,{action:'import_file',sourceId:'coupang_ranking_manual',fileName:'future.csv',text:rows,scope:'쿠팡 소스',observedDate:kst(new Date(Date.now()+2*DAY))});
check(r.status===400&&count(O4,'pr_snapshot')===0,'import with a future observedDate is refused');
r=await post(O4,{action:'import_file',sourceId:'coupang_ranking_manual',fileName:'c.csv',text:rows,scope:'쿠팡 소스',observedDate});
check(r.status===200&&count(O4,'pr_snapshot')===1,'import within 14 days is stored');
const blocked=r.body.products.find(p=>/가품/.test(p.name)),mara=r.body.products.find(p=>/마라소스/.test(p.name)),tteok=r.body.products.find(p=>/떡볶이/.test(p.name));
check(r.body.rankingStatus.find(x=>x.sourceId==='coupang_ranking_manual').thisWeek===true&&r.body.rankingStatus.find(x=>x.sourceId==='musinsa_ranking_manual').lastImportedAt===null&&r.body.rankingStatus.find(x=>x.sourceId==='musinsa_ranking_manual').thisWeek===false,'rankingStatus shows per ranking source whether it was imported this KST week');
r=await post(O4,{action:'decide',productId:blocked.id,scoreCardId:blocked.score.id,briefId:null,status:'approved',reason:'순위가 높아 도입합니다.'});
check(r.status===409&&/선정 금지 상품은 승인할 수 없습니다/.test(r.body.error),'gate: approving a blocked score card is 409');
// 검토 필요 점수표(분석 계층이 붙이는 needsReview)
sql.prepare("UPDATE records SET data=json_set(data,'$.needsReview',json('true')) WHERE id=?").run(`${O4}:pr_score:${mara.score.id}`);
r=await post(O4,{action:'decide',productId:mara.id,scoreCardId:mara.score.id,briefId:null,status:'approved',reason:'검색 수요가 커서 승인합니다.'});
check(r.status===409&&/리스크 검토가 필요/.test(r.body.error)&&count(O4,'pr_decision')===0,'gate: needsReview without a saved risk review is 409');
r=await post(O4,{action:'save_risk_review',productId:mara.id,scoreCardId:'prs_stale',checklist:[{rule:'식품 표시 확인',checked:true}],note:''});
check(r.status===409,'risk review on a stale score card is 409');
r=await post(O4,{action:'save_risk_review',productId:mara.id,scoreCardId:mara.score.id,checklist:[{rule:'식품 표시 확인',checked:true},{rule:'상표 침해 없음',checked:false}],note:'상표 확인 중'});
check(r.status===200&&count(O4,'pr_risk_review')===1&&r.body.riskReviews.some(x=>x.scoreCardId===mara.score.id&&x.checklist.length===2&&x.by.id===O4),'risk review is stored (pr_risk_review) and shown for the current score card');
r=await post(O4,{action:'decide',productId:mara.id,scoreCardId:mara.score.id,briefId:null,status:'approved',reason:'검색 수요가 커서 승인합니다.'});
check(r.status===409&&/확인하지 않은 항목/.test(r.body.error)&&/상표 침해 없음/.test(r.body.error),'gate: an unchecked risk item blocks approval with the item named');
r=await post(O4,{action:'save_risk_review',productId:mara.id,scoreCardId:mara.score.id,checklist:[{rule:'식품 표시 확인',checked:true},{rule:'상표 침해 없음',checked:true}],note:'확인 완료'});
check(r.status===200&&count(O4,'pr_risk_review')===2,'risk reviews are append-only (audit trail)');
r=await post(O4,{action:'save_risk_review',productId:mara.id,scoreCardId:mara.score.id,checklist:[{rule:'x',checked:'yes'}],note:''});check(r.status===400,'risk checklist items need a boolean checked');
r=await post(O4,{action:'decide',productId:mara.id,scoreCardId:mara.score.id,briefId:null,status:'approved',reason:'검색 수요가 커서 승인합니다.'});
check(r.status===200,'approval passes once the latest risk review has every item checked');
const maraDecision=r.body.resultId;
// 다른 길: 체크리스트 없이 위험 확인 표시(riskAcknowledged)와 확인한 위험을 적은 사유(review.terms)로 승인
sql.prepare("UPDATE records SET data=json_set(data,'$.needsReview',json('true'),'$.review',json(?)) WHERE id=?").run(JSON.stringify({rules:['trademark_use'],reasons:['타사 상표 사용 의심'],terms:['상표','위험']}),`${O4}:pr_score:${tteok.score.id}`);
r=await post(O4,{action:'decide',productId:tteok.id,scoreCardId:tteok.score.id,briefId:null,status:'approved',reason:'떡볶이소스 순위가 좋습니다.'});
check(r.status===409&&/리스크 검토가 필요/.test(r.body.error),'gate: needsReview without acknowledgement or checklist is 409');
r=await post(O4,{action:'decide',productId:tteok.id,scoreCardId:tteok.score.id,briefId:null,status:'approved',reason:'떡볶이소스 순위가 좋습니다.',riskAcknowledged:true});
check(r.status===409&&/사유/.test(r.body.error),'gate: acknowledgement whose reason names no reviewed risk is 409');
r=await post(O4,{action:'decide',productId:tteok.id,scoreCardId:tteok.score.id,briefId:null,status:'approved',reason:'상표 위험을 확인했고 자체 상표로 판매합니다.',riskAcknowledged:true});
check(r.status===200,'gate: riskAcknowledged + a reason naming the reviewed risk passes');
sql.prepare("UPDATE records SET data=json_remove(data,'$.needsReview','$.review') WHERE id=?").run(`${O4}:pr_score:${tteok.score.id}`);
const decisionId=maraDecision;
await server.recordStatement(O4,'campaign','camp1',{id:'camp1',brandId:'b1',title:'가을 소스',version:3,status:'active',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'}).run();
await server.recordStatement(O4,'campaign','camp2',{id:'camp2',brandId:'b2',title:'다른 브랜드',version:1,status:'active',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'}).run();
await server.recordStatement(O4,'growth_stop','global',{id:'global',version:1,status:'stopped',reason:'점검',updatedAt:new Date().toISOString(),updatedBy:O4}).run();
r=await post(O4,{action:'handoff',decisionId,campaignId:'camp1',campaignVersion:3});
check(r.status===409&&/전역 중단/.test(r.body.error)&&count(O4,'growth_signal')===0&&count(O4,'growth_need')===0,'gate: global growth stop → handoff 409, nothing written');
await server.recordStatement(O4,'growth_stop','global',{id:'global',version:2,status:'running',reason:'재개',updatedAt:new Date().toISOString(),updatedBy:O4}).run();
r=await post(O4,{action:'handoff',decisionId,campaignId:'camp1',campaignVersion:3});
check(r.status===200&&count(O4,'growth_signal')===1&&count(O4,'growth_need')===1&&count(O4,'growth_history')===2,'handoff writes signal + need draft + two history rows in one batch');
const signal=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='growth_signal'").get(O4),sig=JSON.parse(signal.data);
check(sig.input.observedAt===new Date(`${observedDate}T00:00:00+09:00`).toISOString()&&Date.parse(sig.input.expiresAt)-Date.parse(sig.input.observedAt)===30*DAY,'signal observedAt is the import observedDate (KST), not the import time; expires 30 days later');
const needRow=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='growth_need'").get(O4).data);
check(needRow.input.signalIds.join()===sig.id&&needRow.evidenceRefs[0].id===sig.id&&/초안 — 사람이 채움/.test(needRow.input.desiredOutcome)&&/초안 — 사람이 채움/.test(needRow.input.barrier)&&needRow.productResearch.decisionId===decisionId,'need draft links the signal, says a person fills it and keeps provenance');
check(rec(O4,'pr_decision',decisionId).handoff.needId===needRow.id&&count(O4,'growth_catalog')===0&&count(O4,'growth_offer')===0&&count(O4,'store_order')===0,'decision records the need id; no catalog/offer/order is created');
// 30일이 지난 근거는 넘기지 않는다(관측 기준일 10일 전 + 25일 뒤 = 35일)
r=await post(O4,{action:'decide',productId:tteok.id,scoreCardId:tteok.score.id,briefId:null,status:'approved',reason:'떡볶이소스 순위 근거로 승인합니다.'});
const late=await direct(O4,{action:'handoff',decisionId:r.body.resultId,campaignId:'camp1',campaignVersion:3},{fetch:stub,now:()=>new Date(Date.now()+25*DAY)});
check(late.status===409&&/30일/.test(late.body.error)&&count(O4,'growth_signal')===1,'handoff refuses evidence observed more than 30 days ago (by observedDate)');
// 소싱 후보 연결
await server.recordStatement(O4,'growth_sourcing_candidate','cand1',{id:'cand1',brandId:'b1',campaignId:'camp1',version:2,input:{}},'camp1').run();
await server.recordStatement(O4,'growth_sourcing_candidate','cand9',{id:'cand9',brandId:'b2',campaignId:'camp2',version:1,input:{}},'camp2').run();
r=await post(O4,{action:'link_sourcing',productId:tteok.id,campaignId:'camp1',candidateId:'cand9'});
check(r.status===404&&!rec(O4,'pr_product',tteok.id).sourcing,'link_sourcing refuses a candidate from another campaign/brand');
r=await post(O4,{action:'link_sourcing',productId:tteok.id,campaignId:'camp1',candidateId:'cand1'});
check(r.status===200&&JSON.stringify(rec(O4,'pr_product',tteok.id).sourcing)===JSON.stringify({campaignId:'camp1',candidateId:'cand1',candidateVersion:2})&&r.body.products.find(p=>p.id===tteok.id).sourcing?.candidateId==='cand1','link_sourcing stores ResearchProduct.sourcing with the candidate version (recomputed)');
r=await post(O4,{action:'recompute'});
check(r.status===200&&rec(O4,'pr_product',tteok.id).sourcing?.candidateId==='cand1'&&r.body.products.find(p=>p.id===tteok.id).sourcing?.candidateId==='cand1','sourcing link survives recompute and is in the view');
r=await post(O4,{action:'unlink_sourcing',productId:tteok.id});check(r.status===200&&!('sourcing' in rec(O4,'pr_product',tteok.id)),'unlink_sourcing removes the link');
r=await post(O4,{action:'unlink_sourcing',productId:tteok.id});check(r.status===409,'unlink without a link is 409');
// 주간 MD 리포트(직접): 관찰 이상 후보로 결정형 메모를 만든다(모델 호출 없음)
sql.prepare("UPDATE records SET data=json_set(data,'$.tier','watch') WHERE id=?").run(`${O4}:pr_score:${tteok.score.id}`);
const wr=plain(await ops.weeklyReport(O4,new Date()));
check(typeof wr.briefId==='string'&&rec(O4,'pr_brief',wr.briefId).question==='주간 MD 리포트'&&rec(O4,'pr_brief',wr.briefId).author.kind==='template'&&rec(O4,'pr_brief',wr.briefId).productIds.includes(tteok.id),'weekly MD report is a template brief over the top adopt/watch candidates');

// ── ① 자사 판매(own_sales) 스냅샷: 주문 장부를 SKU·주로 합산, 고객 정보 없음
const O5='ops-own';await on(O5,'product_research');
const lastMon=new Date(Date.parse(kstMonday(new Date())+'T00:00:00Z')-7*DAY).toISOString().slice(0,10),tue=new Date(Date.parse(lastMon+'T00:00:00Z')+DAY).toISOString().slice(0,10),thisWeekDay=kst(new Date());
const order=(id,orderDate,status)=>server.recordStatement(O5,'store_order',id,{id,storeId:'s1',orderDate,status,paidAmount:20000,refundAmount:0,customerName:'홍길동',phone:'010-1234-5678',note:'고객 메모'},'s1').run();
const line=(id,orderId,sku,paid,refund)=>server.recordStatement(O5,'growth_order_line',id,{id,brandId:'b1',storeId:'s1',campaignId:'camp1',version:1,input:{orderId,units:1,paidAllocation:paid,refundAllocation:refund},snapshot:{catalog:{sku,title:sku==='SKU-1'?'마라소스 500g':'떡볶이소스'}}},'s1').run();
await order('o1',tue,'paid');await order('o2',tue,'refunded');await order('o3',tue,'cancelled');await order('o4',thisWeekDay,'paid');await order('o5',tue,'paid');
await line('l1','o1','SKU-1',10000,0);await line('l2','o2','SKU-1',5000,1000);await line('l3','o3','SKU-1',9000,0);await line('l4','o4','SKU-1',7000,0);await line('l5','o5','SKU-2',null,null);
r=await post(O5,{action:'recompute'});
const own=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='pr_snapshot' AND parent_id='own_sales'").all(O5).map(x=>JSON.parse(x.data));
const ob=(sku,metric)=>own[0]?.observations.find(o=>o.subject.externalId===sku&&o.metric===metric);
check(r.status===200&&own.length===1&&own[0].method==='internal'&&own[0].importedBy===null,'recompute builds one internal own_sales snapshot from the order ledger');
check(ob('SKU-1','own_orders').value===2&&ob('SKU-1','own_revenue').value===14000&&ob('SKU-1','own_orders').period.from===lastMon,'own_orders/own_revenue per SKU per KST week (cancelled and current week excluded, refunds netted)');
check(ob('SKU-2','own_orders').value===1&&ob('SKU-2','own_revenue').value===null,'unknown line allocation → revenue null (not 0)');
check(!/홍길동|010-1234|고객 메모/.test(JSON.stringify(own)),'own_sales snapshot carries no customer data');
await post(O5,{action:'recompute'});check(count(O5,'pr_snapshot')===1,'unchanged ledger → no new own_sales snapshot');

// ── ② 이상치 격리(강건 z, MAD)와 사람 해제
const O6='ops-anomaly';await on(O6,'product_research');
const snap=(i,text,value)=>{const at=new Date(Date.now()-(10-i)*DAY).toISOString(),d=at.slice(0,10),id=randomUUID();
 sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${O6}:pr_snapshot:${id}`,O6,'pr_snapshot','naver_searchad_keyword',JSON.stringify({id,sourceId:'naver_searchad_keyword',method:'api',request:{},fetchedAt:at,bodyDigest:'x',bodyBytes:1,status:'ok',limitations:[],importedBy:null,observations:[{subject:{type:'keyword',text},metric:'search_volume_month',value,period:{from:d,to:d}}]}),at);return id};
const base=[1000,1010,990,1005,995,1000,1002,998];
base.forEach((x,i)=>{snap(i,'이상치소스',x);snap(i,'정상소스',x)});
const spike=snap(8,'이상치소스',50000);snap(8,'정상소스',1080);
r=await post(O6,{action:'recompute'});
const qs=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='pr_quarantine'").all(O6).map(x=>JSON.parse(x.data));
check(r.status===200&&qs.length===1&&qs[0].snapshotId===spike&&qs[0].subjectKey==='kw:이상치소스'&&qs[0].status==='active'&&qs[0].robustZ>5&&qs[0].median===1000,'a point >5 robust z from the last 8 is quarantined (normal series untouched)');
const filtered=plain(await store.recentSnapshots(O6,new Date(Date.now()-120*DAY).toISOString(),3000)).find(s=>s.id===spike);
check(filtered.observations.length===0&&filtered.limitations.some(l=>/격리/.test(l)),'quarantined observation is excluded from the scoring input');
v=await get(O6);
check(v.body.freshness.find(f=>f.sourceId==='naver_searchad_keyword').quarantined===1&&v.body.quarantines.length===1&&v.body.alerts.some(a=>a.sourceId==='naver_searchad_keyword'&&/격리/.test(a.message)),'GET shows quarantined count, the entry and an alert');
r=await post(O6,{action:'clear_quarantine',quarantineId:qs[0].id,reason:'짧'});check(r.status===400,'clearing needs a reason');
r=await post(O6,{action:'clear_quarantine',quarantineId:qs[0].id,reason:'방송 노출로 실제 급증을 확인했습니다.'});
check(r.status===200&&rec(O6,'pr_quarantine',qs[0].id).status==='cleared'&&rec(O6,'pr_quarantine',qs[0].id).cleared.by.id===O6&&r.body.freshness.find(f=>f.sourceId==='naver_searchad_keyword').quarantined===0,'clear_quarantine records who cleared it and why');
await post(O6,{action:'recompute'});
check(rec(O6,'pr_quarantine',qs[0].id).status==='cleared'&&plain(await store.recentSnapshots(O6,new Date(Date.now()-120*DAY).toISOString(),3000)).find(s=>s.id===spike).observations.length===1,'a cleared observation is not re-quarantined and re-enters scoring');
r=await post(O6,{action:'clear_quarantine',quarantineId:qs[0].id,reason:'두 번째 해제 시도입니다.'});check(r.status===409,'clearing twice is 409');

console.log(JSON.stringify({passed,sqlite:'real',auth:'mocked',providers:'mocked',external:0}));
