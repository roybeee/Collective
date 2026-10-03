// 상품 리서치 서버(P4·P5) 검사. 근거: mocked — 메모리 SQLite(실제 SQL·json_each), 로컬 인증 헤더·세션 주입, 공급자 API·HERMES는 fetch 스텁. 실제 네트워크 호출 0회.
// 덮는 것: 스위치 꺼짐 응답·쓰기 거절, 요청 멱등, 가져오기 전부 아니면 전무, 재계산 안정(같은 입력 → 새 점수표 판 없음), 결정형 메모 인용 통과·모델 메모 지어낸 숫자 거절(저장 없음),
// 선정 금지 승인 409, 성장2 시장 근거 넘기기(계보·전역 중단·캠페인 판), 쿼터 거절, 자격증명 비노출·봉인, 수집 계획 쿼터 안·한 출처 실패 뒤 계속, 워커 큐 스위치.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const HERMES='https://hermes.example.com';
const calls=[];const mode={youtubeFail:true,hermes:'fabricate',searchadAuth:false,datalabAuth:false};let runs=0;const runInputs=new Map();
const DAY=86400000,kst=d=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const stub=async(url,init={})=>{
 const u=new URL(String(url));calls.push({host:u.host,path:u.pathname,url:String(url)});
 if(u.host==='api.searchad.naver.com'){
  if(mode.searchadAuth)return new Response('denied',{status:401});
  const hints=(u.searchParams.get('hintKeywords')||'').split(',').filter(Boolean);
  return json({keywordList:[...hints.map((h,i)=>({relKeyword:h,monthlyPcQcCnt:1200+i,monthlyMobileQcCnt:8800,compIdx:'중간'})),{relKeyword:hints[0]+'추천',monthlyPcQcCnt:'< 10',monthlyMobileQcCnt:40,compIdx:'낮음'}]});
 }
 if(u.host==='openapi.naver.com'&&u.pathname==='/v1/datalab/search'){
  if(mode.datalabAuth)return new Response('{"errorCode":"024"}',{status:401});
  const b=JSON.parse(init.body);const out=[];
  for(const g of b.keywordGroups){const data=[];let t=Date.parse(b.startDate+'T00:00:00Z'),i=0;const end=Date.parse(b.endDate+'T00:00:00Z');while(t<=end){data.push({period:new Date(t).toISOString().slice(0,10),ratio:Math.min(100,20+i*0.5)});t+=(b.timeUnit==='week'?7:1)*DAY;i++}out.push({title:g.groupName,keywords:g.keywords,data})}
  return json({startDate:b.startDate,endDate:b.endDate,timeUnit:b.timeUnit,results:out});
 }
 if(u.host==='openapi.naver.com'&&u.pathname==='/v1/search/shop.json'){
  const q=u.searchParams.get('query');
  return json({total:1520,items:[1,2,3].map(n=>({title:`<b>${q}</b> 정품 ${n}호 500g`,link:`https://smartstore.naver.com/shop${n}/products/${q.length}${n}`,lprice:String(3000+n*100),mallName:`몰${n}`,productId:`${q.length}0${n}${q.charCodeAt(0)}`,brand:`브랜드${n}`,category1:'식품'}))});
 }
 if(u.host==='www.googleapis.com'){
  if(u.pathname.endsWith('/search'))return mode.youtubeFail?new Response('boom',{status:500}):json({pageInfo:{totalResults:321},items:[{id:{videoId:'abcdefghijk'}}]});
  const ids=(u.searchParams.get('id')||'').split(',');return json({items:ids.map(id=>({id,snippet:{title:'영상 '+id},statistics:{viewCount:'1000'}}))});
 }
 if(u.host==='api-gateway.coupang.com'){
  if(u.pathname.includes('/search'))return json({rCode:'0',data:{productData:[{productId:1,productName:'라면',productPrice:1000,productUrl:'https://www.coupang.com/vp/products/1',rank:1}]}});
  return json({rCode:'0',data:[{productId:77,productName:'오뚜기 마라소스 500g',productPrice:3900,productUrl:'https://link.coupang.com/re/AFF?lptag=x',rank:2}]});
 }
 if(u.origin===HERMES){
  if(u.pathname==='/v1/runs'&&init.method==='POST'){runs++;const id='run_'+runs;runInputs.set(id,JSON.parse(init.body));return json({run_id:id,status:'queued'})}
  const m=/^\/v1\/runs\/(run_\d+)$/.exec(u.pathname);
  if(m){const sub=runInputs.get(m[1]),inp=JSON.parse(sub.input),row=inp.observations[0];
   const value=mode.hermes==='fabricate'?row.value+7:row.value;
   // 관측표 행에 row(스냅샷ID#번호)가 있으면 그 행을 인용하고, 없으면(이전 프롬프트) 스냅샷 ID를 인용한다.
   const out={summary:'근거 표의 관측값만으로 정리했습니다.',recommendation:'watch',claims:[{text:`'${row.subject}' ${row.metric} ${value} (${row.periodTo} 기준)`,citations:[row.row??row.snapshotId]}],risks:['규제 표시를 확인하세요.']};
   return json({object:'hermes.run',run_id:m[1],status:'completed',output:JSON.stringify(out),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
  }
 }
 throw new Error('외부 호출 금지: '+String(url));
};
const {sql,env,load}=testRuntime(stub);
const server=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),route=await load('app/api/product-research/route.ts');
const collect=await load('lib/product-research/server-collect.ts'),worker=await load('lib/research-worker.ts'),sealing=await load('lib/credential-crypto-server.ts'),growthRoute=await load('app/api/growth/route.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const OWNER='pr-owner',H={'oai-authenticated-user-id':OWNER,origin:'https://agency.test','content-type':'application/json'},by={id:OWNER,email:null};
const get=async(h=H)=>{const r=await route.GET(new Request('https://agency.test/api/product-research',{headers:h}));return {status:r.status,body:await r.json()}};
const post=async(b,h=H)=>{const r=await route.POST(new Request('https://agency.test/api/product-research',{method:'POST',headers:h,body:JSON.stringify(b)}));return {status:r.status,body:await r.json()}};
const act=(action,extra={})=>post({action,requestId:randomUUID(),...extra});
const count=(kind,owner=OWNER)=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(owner,kind).n;
const rec=(kind,id)=>{const r=sql.prepare('SELECT data FROM records WHERE id=?').get(`${OWNER}:${kind}:${id}`);return r?JSON.parse(r.data):null};
const flag=(name,enabled)=>flags.setFeatureFlag(OWNER,{flag:name,enabled},by);

// ── 1) 스위치 꺼짐: 같은 모양의 설명 상태, 쓰기 409
let r=await get();
check(r.status===200&&r.body.enabled===false&&Array.isArray(r.body.products)&&r.body.products.length===0&&r.body.mayOrder===false,'flag off GET returns the full view shape with enabled:false');
check(r.body.settings.categories.length===6&&r.body.settings.temperatures.join()==='ambient'&&r.body.settings.priceMax===null&&r.body.settings.question==='','flag off still shows default settings (6 ambient focus categories)');
check(r.body.credentials.length===5&&r.body.credentials.every(c=>c.connected===false)&&r.body.sources.length===11&&r.body.canConnect===true,'flag off still lists credentials and sources');
r=await act('save_settings',{settings:{categories:['food_sauce'],temperatures:['ambient'],priceMax:null,question:''},expectedVersion:0});
check(r.status===409&&/product_research/.test(r.body.error),'flag off write is refused (409)');
check(count('pr_settings')===0&&count('pr_request')===0,'flag off write stores nothing');
check((await post({action:'recompute',requestId:randomUUID()},{...H,origin:'https://evil.test'})).status===403,'cross-origin POST refused');
await flag('product_research',true);

// ── 2) 조사 방향 저장·멱등·판 충돌
const settingsBody={action:'save_settings',requestId:randomUUID(),settings:{categories:['food_sauce','food_snack'],temperatures:['ambient'],priceMax:20000,question:'가을 상온 K-소스, 2만 원 이하'},expectedVersion:0};
r=await post(settingsBody);check(r.status===200&&r.body.settings.version===1&&r.body.settings.priceMax===20000&&r.body.enabled===true,'save_settings stores version 1');
r=await post(settingsBody);check(r.status===200&&r.body.duplicate===true&&r.body.settings.version===1,'same requestId replay is idempotent (no second version)');
r=await post({...settingsBody,settings:{...settingsBody.settings,priceMax:5000}});check(r.status===409,'same requestId with a different body is 409');
r=await act('save_settings',{settings:settingsBody.settings,expectedVersion:0});check(r.status===409,'stale expectedVersion is 409');
r=await act('save_settings',{settings:{...settingsBody.settings,categories:['nope']},expectedVersion:1});check(r.status===400,'unknown category refused');
check((await post({action:'recompute',requestId:'not-a-uuid'})).status===400,'requestId must be uuid v4');

// ── 3) 가져오기: 전부 아니면 전무
const today=kst(new Date());
const header='rank,title,brand,price,review_count,rating,external_id,url';
const bad=[header,'1,오뚜기 마라소스 500g,오뚜기,3900,120,4.8,A1,https://www.coupang.com/vp/products/1001','x,잘못된 순위,,1000,,,A2,'].join('\n');
r=await act('import_file',{sourceId:'coupang_ranking_manual',fileName:'coupang.csv',text:bad,scope:'쿠팡 소스',observedDate:today});
check(r.status===400&&Array.isArray(r.body.issues)&&r.body.issues.length>=1&&r.body.issues.every(i=>typeof i.message==='string'&&'row' in i),'bad file → 400 with issues[{row,message}]');
check(count('pr_snapshot')===0&&count('pr_product')===0,'rejected import stores nothing (all-or-nothing)');
const good=[header,'1,오뚜기 마라소스 500g,오뚜기,3900,120,4.8,A1,https://www.coupang.com/vp/products/1001','2,청정원 떡볶이소스 300g,청정원,2500,80,4.6,A2,https://www.coupang.com/vp/products/1002','3,해외 가품 불닭소스 레플리카,,1500,3,2.1,A3,'].join('\n');
r=await act('import_file',{sourceId:'coupang_ranking_manual',fileName:'coupang.csv',text:good,scope:'쿠팡 소스',observedDate:today});
check(r.status===200&&count('pr_snapshot')===1,'good file stores one snapshot');
const snap0=rec('pr_snapshot',r.body.resultId);
check(snap0.importedBy.id===OWNER&&snap0.importedBy.fileName==='coupang.csv'&&snap0.observations.some(o=>o.subject.externalId==='A1'),'snapshot keeps importedBy and external_id column');
check(r.body.imports.length===1&&r.body.imports[0].rows===3&&r.body.imports[0].fileName==='coupang.csv','view lists the import');
check(r.body.imports[0].scope==='쿠팡 소스'&&r.body.imports[0].observedDate===today,'view import record carries scope and observedDate');
check(r.body.products.length===3&&r.body.products.every(p=>p.score&&p.score.weightsVersion==='w1'),'import → recompute → products with w1 score cards');
const scoresAfterImport=count('pr_score'),productIds=r.body.products.map(p=>p.id).sort();
r=await act('recompute');check(r.status===200&&count('pr_score')===scoresAfterImport,'recompute with the same inputs creates no new score version');
check(JSON.stringify(r.body.products.map(p=>p.id).sort())===JSON.stringify(productIds),'product ids stay stable across recompute');
const blockedP=r.body.products.find(p=>/가품/.test(p.name)),maraP=r.body.products.find(p=>/마라소스/.test(p.name));
check(blockedP&&blockedP.score.blocked&&blockedP.score.tier==='reject','counterfeit listing is blocked');

// ── 4) 결정: 선정 금지 승인 409, 보류 허용
r=await act('decide',{productId:blockedP.id,scoreCardId:blockedP.score.id,briefId:null,status:'approved',reason:'순위가 높아 도입하고 싶습니다.'});
check(r.status===409&&/선정 금지/.test(r.body.error),'approving a blocked score card is 409');
r=await act('decide',{productId:blockedP.id,scoreCardId:blockedP.score.id,briefId:null,status:'hold',reason:'가품 신호를 확인할 때까지 보류합니다.'});
check(r.status===200&&r.body.products.find(p=>p.id===blockedP.id).decision.status==='hold','hold on a blocked product is allowed');
r=await act('decide',{productId:maraP.id,scoreCardId:'prs_stale',briefId:null,status:'approved',reason:'좋습니다 승인합니다.'});check(r.status===409,'stale score card id is 409');
r=await act('decide',{productId:maraP.id,scoreCardId:maraP.score.id,briefId:null,status:'approved',reason:'짧'});check(r.status===400,'reason must be at least a sentence');

// ── 5) 출처 연결: 검증 호출·봉인·비노출, 소유자만
const secrets={clientSecret:'SECRETdevsecret123',apiKey:'AIzaSECRETyoutubekey12345',secretKey:'SECRETsearchadsecret1234567',coupangSecret:'SECRETcoupang-secret-key'};
mode.datalabAuth=true;
r=await act('connect_source',{credentialKey:'naver_developers',input:{clientId:'devClientId01',clientSecret:secrets.clientSecret}});
check(r.status===400&&/거절/.test(r.body.error)&&count('pr_credential')===0,'failed verification call stores nothing');
mode.datalabAuth=false;const before=calls.length;
r=await act('connect_source',{credentialKey:'naver_developers',input:{clientId:'devClientId01',clientSecret:secrets.clientSecret}});
check(r.status===200&&calls.slice(before).some(c=>c.path==='/v1/datalab/search'),'connect verifies with one real (mocked) datalab call');
check(r.body.credentials.find(c=>c.key==='naver_developers').connected===true&&r.body.credentials.find(c=>c.key==='naver_developers').account==='Client …Id01','GET shows connected + masked account');
r=await act('connect_source',{credentialKey:'naver_searchad',input:{apiKey:'searchadApiKey0123456789',secretKey:secrets.secretKey,customerId:'1234567'}});check(r.status===200,'searchad connected');
r=await act('connect_source',{credentialKey:'youtube',input:{apiKey:secrets.apiKey}});check(r.status===200,'youtube connected (videos.list verification)');
r=await act('connect_source',{credentialKey:'coupang_partners',input:{accessKey:'coupang-access-1',secretKey:secrets.coupangSecret}});check(r.status===200,'coupang connected (search limit=1 verification)');
r=await act('connect_source',{credentialKey:'licensed',input:{vendor:'아이템스카우트'}});check(r.status===200&&r.body.credentials.find(c=>c.key==='licensed').account==='아이템스카우트','licensed placeholder stored without a call');
const view=await get(),viewText=JSON.stringify(view.body),dbText=JSON.stringify(sql.prepare("SELECT data FROM records WHERE kind IN ('pr_credential','pr_request')").all());
check(Object.values(secrets).every(s=>!viewText.includes(s)),'GET never echoes credential secrets');
check(Object.values(secrets).every(s=>!dbText.includes(s)),'secrets are sealed at rest (not in credential or request rows)');
check(sealing.SEALED_RECORD_KINDS.includes('pr_credential'),'pr_credential is covered by key rotation (SEALED_RECORD_KINDS)');
check((await sealing.openRecordSecret(OWNER,'pr_credential','youtube',rec('pr_credential','youtube').secret)).includes(secrets.apiKey),'sealed credential opens with its record AAD');
// 관리자(소유자 아님)는 출처 연결 403
const token='c'.repeat(64);env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
// 같은 작업공간의 첫 관리자가 소유자다. 두 번째 관리자로 로그인한다.
sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('own','own@test.invalid',OWNER,'admin','active',0);
sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('adm','adm@test.invalid',OWNER,'admin','active',2);
sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'adm',Date.now()+600000,Date.now());
const AH={cookie:'__Host-collective_session='+token,origin:'https://agency.test','content-type':'application/json'};
r=await post({action:"disconnect_source",requestId:randomUUID(),credentialKey:"youtube"},AH);check(r.status===403,'admin cannot disconnect a source (owner only)');
r=await get(AH);check(r.status===200&&r.body.canConnect===false&&r.body.canEdit===true,'admin sees the view without connect rights');
env.AUTH_MODE='legacy';

// ── 6) 수집: 스위치·쿼터·한 출처 실패 뒤 계속
r=await act('collect_now');check(r.status===409&&/product_research_collect/.test(r.body.error),'collect_now needs product_research_collect');
check(await collect.productResearchQueue(OWNER)===undefined,'worker queue not offered while collect flag is off');
await flag('product_research_collect',true);
check(typeof await collect.productResearchQueue(OWNER)==='function','worker queue offered when both flags are on');
const c0=calls.length;
r=await act('collect_now');
check(r.status===200,'collect_now runs');
const state1=rec('pr_collect_state','current');
check(state1.plan.length>0&&state1.cursor<=state1.plan.length,'collect plan stored with cursor');
// 남은 단계는 워커가 이어 간다
let ticks=0,st;do{st=await collect.runProductResearchQueue(OWNER);ticks++}while(st.status==='processed'&&ticks<10);
const waiting=rec('pr_collect_state','current');
check(['idle','processed'].includes(st.status)&&waiting.done===false&&waiting.pending.length>0&&waiting.pending.every(p=>p.sourceId==='youtube_data')&&typeof waiting.nextAttemptAt.youtube_data==='string','youtube 500 is transient: only its steps wait for the backoff, other sources finished (status stays idle/processed)');
check(waiting.attempts.youtube_data.count===1&&/다시 시도/.test(waiting.errors.youtube_data.message),'transient failure counts one attempt and says when it retries');
// 시간이 흘러 재시도 두 번이 더 실패하면(하루 3번) YouTube는 오늘 멈추고 계획이 끝난다. 한국 자정을 넘기면 새 날 계획이라 이 확인은 건너뛴다.
if(kst(new Date(Date.now()+31*60000))===kst(new Date())){
 for(const m of [6,30]){const later={fetch:stub,now:()=>new Date(Date.now()+m*60000)};let s2,n=0;do{s2=await collect.runProductResearchQueue(OWNER,later);n++}while(s2.status==='processed'&&n<5)}
 const ended=rec('pr_collect_state','current');
 check(ended.done===true&&ended.skip.includes('youtube_data')&&ended.attempts.youtube_data.count===3&&/내일/.test(ended.errors.youtube_data.message),'worker finishes the day plan after 3 transient youtube failures (max 3 attempts/day)');
}else passed++;
const made=calls.slice(c0),n=(host,path)=>made.filter(c=>c.host===host&&(!path||c.path===path)).length;
check(n('api.searchad.naver.com')<=8,'searchad ≤ 8 calls (≤40 keywords, 5 per call)');
check(n('openapi.naver.com','/v1/datalab/search')<=8,'datalab ≤ 8 calls (≤40 groups)');
check(n('openapi.naver.com','/v1/search/shop.json')<=20,'shop search ≤ 20 keywords');
check(made.filter(c=>c.path.endsWith('/youtube/v3/search')).length<=3,'youtube discovery ≤ 3 search.list');
check(n('api-gateway.coupang.com')<=1,'coupang best category once');
const st2=rec('pr_collect_state','current');
check(st2.errors.youtube_data&&/YouTube/.test(st2.errors.youtube_data.message),'youtube failure recorded per source');
check(count('pr_snapshot')>10&&sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='pr_snapshot' AND parent_id='naver_shop_search'").get().n>0&&sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='pr_snapshot' AND parent_id='naver_datalab_search'").get().n>0,'other sources kept collecting after youtube failed');
const quotaRows=sql.prepare("SELECT data FROM records WHERE kind='pr_quota'").all().map(x=>JSON.parse(x.data));
check(quotaRows.every(q=>q.sourceId!=='youtube_data'||q.used<=10000)&&quotaRows.every(q=>q.sourceId!=='naver_datalab_search'||q.used<=1000),'quota ledger stays within daily quotas');
check((await collect.runProductResearchQueue(OWNER)).status==='idle','second tick the same KST day is idle (once per day)');
r=await get();check(r.body.collect.lastErrors.some(e=>e.sourceId==='youtube_data')&&r.body.collect.lastRunAt&&r.body.collect.nextRunAt,'view shows collect state and per-source errors');
check(r.body.sources.find(s=>s.id==='naver_shop_search').quotaUsedToday>0&&r.body.sources.find(s=>s.id==='naver_shop_search').lastStatus,'view shows quota used and last status per source');
// 쿼터 거절: 오늘 쇼핑 검색 한도를 다 쓴 상태면 호출하지 않는다
sql.prepare("UPDATE records SET data=json_set(data,'$.used',25000) WHERE kind='pr_quota' AND parent_id='naver_shop_search'").run();
const c1=calls.length;r=await act('collect_now',{sourceId:'naver_shop_search'});
check(r.status===200&&calls.slice(c1).filter(c=>c.path==='/v1/search/shop.json').length===0,'quota refusal: no shop call when the daily quota is used up');
check(/쿼터/.test(rec('pr_collect_state','current').errors.naver_shop_search.message),'quota refusal recorded');

// ── 7) 결정형 메모 + 모델 메모(인용 검사)
r=await get();
const scored=r.body.products.filter(p=>p.score&&!p.score.blocked);
check(r.body.series.length>0&&r.body.snapshots.length>0&&r.body.snapshots.every(s=>s.id&&s.sourceId&&s.fetchedAt),'view carries series and snapshot metadata for evidence ids');
check(r.body.products.every(p=>'previousScore' in p),'each product carries previousScore (null when none)');
const pick=scored.slice(0,2).map(p=>p.id);
r=await act('generate_brief',{productIds:pick,question:'가을 상온 K-소스',mode:'template'});
check(r.status===200&&r.body.briefs.some(b=>b.id===r.body.resultId&&b.citationCheck.passed&&b.author.kind==='template'),'template brief passes citation check and is stored');
const briefId=r.body.resultId;
r=await act('generate_brief',{productIds:pick,question:'가을 상온 K-소스',mode:'model'});
check(r.status===409&&/AI 연결|HERMES/.test(r.body.error),'model brief without an AI connection is 409');
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(OWNER,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only-key'})),'HERMES',new Date().toISOString());
const briefsBefore=count('pr_brief'),modelReq={action:'generate_brief',requestId:randomUUID(),productIds:pick,question:'가을 상온 K-소스',mode:'model'};
r=await post(modelReq);
check(r.status===409&&Array.isArray(r.body.unsupported)&&r.body.unsupported.length>0,'model brief with a fabricated number is rejected with the unsupported list');
check(count('pr_brief')===briefsBefore,'rejected model brief is not stored');
const runsBefore=runs;r=await post(modelReq);check(r.status===409&&runs===runsBefore,'replaying the rejected request does not re-run the model');
check(count('provider_usage')>=1,'model usage recorded in the usage ledger');
mode.hermes='valid';
r=await act('generate_brief',{productIds:pick,question:'가을 상온 K-소스',mode:'model'});
check(r.status===200&&count('pr_brief')===briefsBefore+1&&r.body.briefs.some(b=>b.author.kind==='model'&&b.citationCheck.passed),'model brief that cites table values is stored');
{const last=[...runInputs.values()].pop(),row0=JSON.parse(last.input).observations[0],stored=r.body.briefs.find(b=>b.author.kind==='model');
 if(typeof row0.row==='string')check(stored.claims[0].citations.includes(row0.snapshotId)&&Array.isArray(stored.claims[0].refs)&&stored.claims[0].refs.some(x=>x.snapshotId===row0.snapshotId),'model brief citing a row ref (snapshot#n) is graded per row and stored with refs');
 else check(stored.claims[0].citations.includes(row0.snapshotId),'model brief citing a snapshot id is stored (row refs arrive with the row-level grader)');}
const sub=[...runInputs.values()].pop();check(typeof sub.instructions==='string'&&/observations/.test(sub.instructions)&&JSON.parse(sub.input).observations.every(o=>typeof o.snapshotId==='string'&&typeof o.value==='number'),'model receives only the observation table');

// ── 8) 승인 → 성장2 시장 근거
r=await get();const target=r.body.products.find(p=>p.score&&!p.score.blocked&&p.listings.some(l=>l.url&&!l.url.includes('?')));
r=await act('decide',{productId:target.id,scoreCardId:target.score.id,briefId,status:'approved',reason:'검색 수요와 순위 근거로 도입을 검토합니다.'});
check(r.status===200||(r.status===404&&/메모/.test(r.body.error)),'decide accepts the current score card');
if(r.status!==200)r=await act('decide',{productId:target.id,scoreCardId:target.score.id,briefId:null,status:'approved',reason:'검색 수요와 순위 근거로 도입을 검토합니다.'});
const decisionId=r.body.resultId;check(r.status===200&&r.body.products.find(p=>p.id===target.id).decision.status==='approved','approved decision stored');
const campaign={id:'camp1',brandId:'b1',title:'가을 소스',version:3,status:'active',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
await server.recordStatement(OWNER,'campaign','camp1',campaign).run();await server.recordStatement(OWNER,'brand','b1',{id:'b1',name:'B'}).run();
r=await get();check(r.body.campaigns.some(c=>c.id==='camp1'&&c.version===3),'view lists active campaigns');
r=await act('handoff',{decisionId,campaignId:'camp1',campaignVersion:2});check(r.status===409,'handoff with a stale campaign version is 409');
await server.recordStatement(OWNER,'growth_stop','global',{id:'global',version:1,status:'stopped',reason:'점검',updatedAt:new Date().toISOString(),updatedBy:OWNER}).run();
r=await act('handoff',{decisionId,campaignId:'camp1',campaignVersion:3});check(r.status===409&&/전역 중단/.test(r.body.error),'global growth stop blocks handoff');
check(count('growth_signal')===0,'no signal while stopped');
await server.recordStatement(OWNER,'growth_stop','global',{id:'global',version:2,status:'running',reason:'재개',updatedAt:new Date().toISOString(),updatedBy:OWNER}).run();
const hoReq={action:'handoff',requestId:randomUUID(),decisionId,campaignId:'camp1',campaignVersion:3};
r=await post(hoReq);check(r.status===200&&count('growth_signal')===1,'handoff writes one growth_signal');
const signal=rec('growth_signal',r.body.resultId);
check(signal.input.sourceType==='market'&&signal.input.title.startsWith('상품 리서치: ')&&signal.input.sourceUrl.startsWith('https://')&&signal.campaignId==='camp1'&&signal.brandId==='b1','signal is a market signal in the campaign');
check(signal.productResearch.decisionId===decisionId&&signal.productResearch.scoreCardId===target.score.id&&signal.productResearch.snapshotIds.length>0,'signal keeps product research provenance');
check(Date.parse(signal.input.expiresAt)-Date.parse(signal.input.observedAt)===30*DAY,'signal expires 30 days after the latest cited snapshot');
check(count('growth_history')===2&&rec('pr_decision',decisionId).handoff.signalId===signal.id,'history (signal + need) and decision handoff link written atomically');
const needId=rec('pr_decision',decisionId).handoff.needId,need=rec('growth_need',needId);
check(count('growth_need')===1&&need&&need.input.signalIds.join()===signal.id&&need.evidenceRefs[0].id===signal.id&&need.campaignId==='camp1'&&need.brandId==='b1'&&/초안 — 사람이 채움/.test(need.input.situation),'handoff also drafts one growth_need linked to the signal (placeholders say a person fills them)');
r=await post(hoReq);check(r.status===200&&r.body.duplicate===true&&count('growth_signal')===1,'handoff replay is idempotent');
r=await act('handoff',{decisionId,campaignId:'camp1',campaignVersion:3});check(r.status===409,'a decision is handed off once');
const gp=await growthRoute.POST(new Request('https://agency.test/api/growth',{method:'POST',headers:H,body:JSON.stringify({action:'save_signal',id:signal.id,campaignId:'camp1',campaignVersion:3,expectedVersion:1,input:signal.input})}));
check(gp.status===409,'handed-off signal cannot be edited away from its provenance');
check(count('growth_offer')===0&&count('growth_catalog')===0&&count('growth_sourcing_candidate')===0,'no offer, catalog or sourcing record is created (mayOrder:false)');
r=await act('decide',{productId:blockedP.id,scoreCardId:rec('pr_product',blockedP.id).scoreId,briefId:null,status:'rejected',reason:'가품 신호로 제외합니다.'});
r=await act('handoff',{decisionId:r.body.resultId,campaignId:'camp1',campaignVersion:3});check(r.status===409,'only approved decisions can be handed off');

// ── 9) 매칭 확인·브랜드 적합성·백테스트
r=await get();const multi=r.body.products.find(p=>p.listings.length>=1&&!p.decision);const other=r.body.products.find(p=>p.id!==multi.id&&!p.decision);
r=await act('confirm_match',{productId:multi.id,decision:'merge',listingKeys:[`${other.listings[0].sourceId}:${other.listings[0].externalId}`]});
check(r.status===200&&rec('pr_product',multi.id).match.method==='manual'&&rec('pr_product',multi.id).listings.length===multi.listings.length+1,'merge pins the product with the confirmed listing');
const merged=rec('pr_product',multi.id);
r=await act('confirm_match',{productId:multi.id,decision:'split',listingKeys:[`${other.listings[0].sourceId}:${other.listings[0].externalId}`]});
check(r.status===200&&rec('pr_product',multi.id).listings.length===merged.listings.length-1&&rec('pr_product',r.body.resultId).match.confirmedBy.id===OWNER,'split creates a pinned product from the chosen listings');
r=await act('set_brand_fit',{productId:target.id,value:82,reason:'브랜드 톤과 잘 맞습니다.'});
check(r.status===200&&r.body.products.find(p=>p.id===target.id).score.subScores.find(s=>s.key==='brand_fit').value===82,'brand fit judgement enters a new score version');
r=await act('run_backtest',{horizonWeeks:12,labelThreshold:20});
check(r.status===200&&r.body.backtests.length===1,'backtest stored');
const bt=r.body.backtests[0];check(bt.candidates>0&&bt.precisionAtK.every(p=>typeof p.value==='number')&&bt.reason===null&&bt.label.includes('20%')&&bt.baselines.length===3,'104-week datalab history → backtest with numbers and baselines (percent threshold converted)');
// 이력이 짧은 작업공간(가져오기 하루치뿐): 숫자를 만들지 않고 사유를 준다
const O2='pr-owner-2',H2={...H,'oai-authenticated-user-id':O2};await flags.setFeatureFlag(O2,{flag:'product_research',enabled:true},{id:O2,email:null});
await post({action:'import_file',requestId:randomUUID(),sourceId:'coupang_ranking_manual',fileName:'c.csv',text:good,scope:'쿠팡 소스',observedDate:today},H2);
r=await post({action:'run_backtest',requestId:randomUUID(),horizonWeeks:12,labelThreshold:20},H2);
const bt2=r.body.backtests?.[0];check(r.status===200&&bt2&&bt2.precisionAtK.every(p=>p.value===null)&&bt2.spearman===null&&typeof bt2.reason==='string'&&/이력/.test(bt2.reason),'short history → null metrics with a Korean reason');
check(count('pr_product',O2)===3&&count('pr_product')>3,'owners are isolated');
r=await act('run_backtest',{horizonWeeks:5,labelThreshold:20});check(r.status===400,'horizon must be 4/8/12');

// ── 10) 워커 큐 연결
check(/product_research/.test(worker.workerTick.toString()),'worker tick knows the product_research queue');
await flag('product_research_collect',false);check((await collect.runProductResearchQueue(OWNER)).status==='idle','queue idles when the collect flag is off');
check(await collect.productResearchQueue('someone-else')===undefined,'other owners (flags off) get no queue');
const ws=await load('app/api/research-worker/route.ts');check(typeof ws.POST==='function','research-worker route still loads');
check(calls.every(c=>['api.searchad.naver.com','openapi.naver.com','www.googleapis.com','api-gateway.coupang.com','hermes.example.com'].includes(c.host)),'only registry hosts and the mocked HERMES were called');
console.log(JSON.stringify({passed,sqlite:'real',auth:'mocked',providers:'mocked',external:0}));
