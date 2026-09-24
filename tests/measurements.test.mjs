import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
class Statement{constructor(query,values=[]){this.query=query;this.values=values}bind(...v){return new Statement(this.query,v)}async first(){return sql.prepare(this.query).get(...this.values)||null}async all(){return {results:sql.prepare(this.query).all(...this.values)}}async run(){const r=sql.prepare(this.query).run(...this.values);return {meta:{changes:Number(r.changes)}}}}
const DB={prepare:q=>new Statement(q),batch:async ss=>{sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
const runtime={AUTH_MODE:'legacy',DB,AGENCY_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')};

let now=Date.now();class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
// 네이버 검색광고 모의 게이트웨이. 실제 계정 없이 서명·매핑·실패 경로를 확인한다.
let naverAuthorized=true,naverStats={impCnt:4000,clkCnt:120,salesAmt:96000,ccnt:9},naverDown=false;
let igAuthorized=true,igDown=false,igInsights={reach:9000,shares:450,saves:120,plays:7000};
// security-ops-11: 커넥터 응답 한도(200KB) 확인용 채움 글자 수. 0이면 채우지 않는다.
let naverPad=0,igPad=0;const padded=pad=>pad?{pad:'x'.repeat(pad)}:{};
const igCalls=[];
const naverCalls=[];const destinations=[];
const fakeFetch=async(url,options={})=>{
 destinations.push(url);
 if(url.startsWith('https://api.searchad.naver.com/')){
  const headers=new Headers(options.headers);
  naverCalls.push({url,timestamp:headers.get('X-Timestamp'),apiKey:headers.get('X-API-KEY'),customer:headers.get('X-Customer'),signature:headers.get('X-Signature')});
  if(naverDown)throw new Error('network lost');
  if(!naverAuthorized)return new Response('',{status:401});
  if(url.includes('/ncc/campaigns'))return Response.json([{nccCampaignId:'cmp-1',name:'테스트 캠페인'},...(naverPad?[padded(naverPad)]:[])]);
  if(url.includes('/stats'))return Response.json({data:[{id:'cmp-1',...naverStats}],...padded(naverPad)});
  return new Response('',{status:404});
 }
 if(url.startsWith('https://graph.facebook.com/')){
  igCalls.push(url);
  if(igDown)throw new Error('graph unavailable');
  if(!igAuthorized)return Response.json({error:{message:'Invalid OAuth access token',code:190}},{status:400});
  if(url.includes('/insights'))return Response.json({data:Object.entries(igInsights).map(([name,value])=>({name,values:[{value}]})),...padded(igPad)});
  return Response.json({id:'ig-user-1',username:'oldferrydonut',timestamp:'2026-08-01T09:00:00+0000',permalink:'https://instagram.com/p/abc',media_type:'VIDEO'});
 }
 if(url.endsWith('/v1/capabilities')){if(!new Headers(options.headers).has('Authorization'))return new Response('',{status:401});return Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true}}})}
 if(url.endsWith('/v1/models'))return Response.json({data:[{id:'test'}]});
 if(options.method==='POST'&&url.endsWith('/v1/runs'))return Response.json({run_id:'run_'+destinations.length});
 if(url.includes('/v1/runs/'))return Response.json({object:'hermes.run',run_id:url.split('/').pop(),status:'completed',output:'모의 응답',usage:{total_tokens:1}});
 throw new Error('Unexpected destination: '+url);
};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date:Clock,URL,AbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
const afterModule=new SyntheticModule(['after'],function(){this.setExport('after',fn=>fn())},{context:ctx});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;if(spec==='next/server')return afterModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(f.endsWith('.ts')?f:f+'.ts')});return m}

const channels=await load('app/api/channels/route.ts');await channels.evaluate();
const measurements=await load('app/api/measurements/route.ts');await measurements.evaluate();
const learn=await load('app/api/learning/route.ts');await learn.evaluate();
const action=await load('app/api/action/route.ts');await action.evaluate();
const server=await load('lib/server.ts');await server.evaluate();
const credentials=await load('lib/channel-credentials.ts');await credentials.evaluate();
const worker=await load('lib/research-worker.ts');await worker.evaluate();
const collector=await load('lib/measurement-collection.ts');await collector.evaluate();

let owner='measurement-test-owner';await server.namespace.seedBrands(owner);
const checks=[];const check=(label,v)=>{assert.ok(v,label);checks.push(label)};
async function req(mod,b,who=owner,method='POST',origin){const h={'content-type':'application/json'};if(who)h['oai-authenticated-user-id']=who;if(origin)h.origin=origin;const r=await mod.namespace[method](new Request('https://agency.test/api/test',{method,headers:h,...(method==='POST'?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const ch=(action,data={})=>req(channels,{action,...data});
const chStatus=async()=>(await req(channels,null,owner,'GET')).data;
const mz=(action,data={})=>req(measurements,{action,...data});
const naver={apiKey:'test-api-key-0123456789',secretKey:'test-secret-key-0123456789',customerId:'1234567'};

// --- 인증 경계 -------------------------------------------------------------
check('anonymous channel read denied',(await req(channels,null,null,'GET')).status===401);
check('anonymous credential write denied',(await req(channels,{action:'save_credential',channel:'naver_ads',data:naver},null)).status===401);
check('cross-origin credential write denied',(await req(channels,{action:'save_credential',channel:'naver_ads',data:naver},owner,'POST','https://evil.test')).status===403);
check('unknown channel rejected',(await ch('save_credential',{channel:'tiktok_ads',data:naver})).status===400);

// --- 저장 전 실제 API 검증 --------------------------------------------------
naverAuthorized=false;
let r=await ch('save_credential',{channel:'naver_ads',data:naver});
check('bad credentials are rejected before storing',r.status>=400);
check('rejected credentials are not stored',!(await chStatus()).channels.some(c=>c.channel==='naver_ads'&&c.connected));
naverAuthorized=true;
r=await ch('save_credential',{channel:'naver_ads',data:naver});
check('verified credentials are stored',r.status===200);
check('verification calls the live account endpoint',naverCalls.some(c=>c.url.includes('/ncc/campaigns')));
check('request is signed with key, customer and signature',naverCalls.every(c=>c.apiKey===naver.apiKey&&c.customer===naver.customerId&&!!c.signature&&!!c.timestamp));
check('signature is not the raw secret',naverCalls.every(c=>c.signature!==naver.secretKey));
// 연결 확인은 인증(2xx)만 보고 캠페인 목록 본문은 읽지 않는다. 캠페인이 많아 목록이 200KB를 넘는 계정도 연결된다.
naverPad=200001;
r=await ch('save_credential',{channel:'naver_ads',data:naver});
check('verification succeeds for an account whose campaign list exceeds 200KB',r.status===200&&(await chStatus()).channels.some(c=>c.channel==='naver_ads'&&c.connected));
naverPad=0;

// --- 비밀값 노출 금지 -------------------------------------------------------
let status=await chStatus();
check('status reports connected account',status.channels.some(c=>c.channel==='naver_ads'&&c.connected&&c.account===naver.customerId));
check('status never returns secrets',!JSON.stringify(status).includes(naver.secretKey)&&!JSON.stringify(status).includes(naver.apiKey));
check('stored credential is encrypted at rest',!sql.prepare("SELECT data FROM records WHERE owner=? AND kind='channel_credential'").get(owner).data.includes(naver.secretKey));
check('other owners cannot see the credential',!(await req(channels,null,'someone-else','GET')).data.channels.some(c=>c.connected));

// --- 수집 ------------------------------------------------------------------
check('collection requires a known experiment',(await mz('collect',{experimentId:'missing',arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-01',to:'2026-08-07'})).status===404);
r=await req(action,{action:'save_campaign',data:{brandId:'ofd',title:'측정 캠페인',goal:'수집 검증',channels:'Instagram',budget:0}});const cid=r.data.id;
// 실험은 채널을 갖는다. 커넥터 수치는 같은 채널의 실험에만 들어갈 수 있다.
const mkExperiment=async(channel,url,metric,who=owner,campaignId=cid)=>{
 const caseId=(await req(learn,{action:'add_case',data:{brandId:'ofd',title:'수집 사례',channel,url,scope:'테스트',observations:'테스트 관찰'}},who)).data.id;
 const analysisId=(await req(learn,{action:'save_analysis',caseId,data:{facts:'f',hook:'h',retention:'r',sharing:'s',context:'c',counterEvidence:'x',unknowns:'u',ideas:[{hypothesis:'h',variable:'v',control:'c',treatment:'t',metric}]}},who)).data.id;
 const id=(await req(learn,{action:'create_experiment',analysisId,campaignId,data:{title:'수집 실험',hypothesis:'h',variable:'v',control:'c',treatment:'t',metric,minSample:1000,minHours:1,conditions:'동일 조건',minLift:10}},who)).data.id;
 await req(learn,{action:'start_experiment',id,version:1},who);
 return id;
};
const experimentId=await mkExperiment('Instagram','https://instagram.com/reel/collect1','share_rate');
const naverId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/collect1','click_rate');

check('another channel\u0027s numbers cannot enter an experiment arm',(await mz('collect',{experimentId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-01',to:'2026-08-07'})).status===400);

r=await mz('collect',{experimentId:naverId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-01',to:'2026-08-07'});
check('collection succeeds for a running experiment',r.status===200);
check('impressions and clicks map onto the metric arm',r.data.collected.arm.denominator===4000&&r.data.collected.arm.numerator===120);
check('collection records the account, definition and window',r.data.collected.account===naver.customerId&&!!r.data.collected.definition&&r.data.collected.window.from==='2026-08-01');
check('advertising cost is carried as a store value',r.data.collected.storeValues.adSpend===96000);
check('collection response carries no secrets',!JSON.stringify(r.data).includes(naver.secretKey));

const drafts=async()=>server.namespace.listRecords(owner,'measurement_draft');
check('collection stores one draft for the experiment',(await drafts()).filter(d=>d.experimentId===naverId).length===1);
check('the advertising cost is kept on the draft, not only in the response',(await drafts()).find(d=>d.experimentId===naverId).storeValues.adSpend===96000);
await mz('collect',{experimentId:naverId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-01',to:'2026-08-07'});
check('repeated collection of the same window stays idempotent',(await drafts()).filter(d=>d.experimentId===naverId).length===1);
await mz('collect',{experimentId:naverId,arm:'treatment',channel:'naver_ads',target:'cmp-1',from:'2026-08-01',to:'2026-08-07'});
let draft=(await drafts()).find(d=>d.experimentId===naverId);
check('both arms land in the same draft',!!draft.control&&!!draft.treatment);
check('draft never asserts comparability',draft.comparable===false||draft.comparable===undefined);
// PR 4b-2: 최상위 storeValues는 마지막으로 수집한 arm의 값으로 덮인다. 장부로 옮길 광고비는 arm마다 광고 대상·기간과 함께 남긴다.
check('each arm keeps its own ad spend and ad target for the ledger transfer',draft.arms.control.storeValues?.adSpend===96000&&draft.arms.control.target==='cmp-1'&&draft.arms.treatment.storeValues?.adSpend===96000&&draft.arms.treatment.target==='cmp-1');
// 수집한 초안은 같은 브랜드 지점의 비용 장부 옮기기 후보가 된다(tests/spend-transfer.test.mjs). 두 arm이 같은 광고 대상이면 같은 광고비라 한 번만 옮긴다.
const storeOps=await load('app/api/store-operations/route.ts');await storeOps.evaluate();
await server.namespace.recordStatement(owner,'store','ofd-s1',{id:'ofd-s1',brandId:'ofd',name:'측정 지점',status:'active',version:1},'ofd').run();
const so=async b=>{const res=await storeOps.namespace.POST(new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({storeId:'ofd-s1',...b})}));return {status:res.status,data:await res.json()}};
const transferOf=c=>({action:'transfer_spend',experimentId:naverId,arm:c.arm,adSpend:c.adSpend,from:c.window.from,to:c.window.to,fetchedAt:c.fetchedAt});
const preview=await so({action:'transfer_preview',experimentId:naverId}),collectedControl=preview.data.candidates?.find(c=>c.arm==='control'),collectedTreatment=preview.data.candidates?.find(c=>c.arm==='treatment');
check('a collected naver draft becomes a ledger transfer candidate with the collected amount, window and time',preview.status===200&&collectedControl?.adSpend===96000&&collectedControl.window.from==='2026-08-01'&&collectedControl.window.to==='2026-08-07'&&collectedControl.fetchedAt===draft.arms.control.fetchedAt&&!collectedControl.blocked);
const movedControl=await so(transferOf(collectedControl)),movedTreatment=await so(transferOf(collectedTreatment));
check('the collected spend is written once when both arms point at the same ad target',movedControl.status===200&&movedTreatment.status===409&&(await server.namespace.listRecords(owner,'store_spend')).length===1);

// --- 실패는 숫자를 지어내지 않는다 -------------------------------------------
naverDown=true;
r=await mz('collect',{experimentId:naverId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-08',to:'2026-08-14'});
check('gateway failure surfaces as an error, not as numbers',r.status>=500&&!JSON.stringify(r.data).includes('4000'));
naverDown=false;
// security-ops-11: 외부 응답은 200KB 한도 안에서만 읽는다. 넘으면 파싱하지 않고 명확한 오류로 끝나며, 한도 안의 큰 응답은 그대로 수집된다.
naverPad=200001;
r=await mz('collect',{experimentId:naverId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-08',to:'2026-08-14'});
check('an oversized naver response is refused with a clear error, not parsed',r.status===502&&r.data.error.includes('허용 크기(200KB)')&&!JSON.stringify(r.data).includes('4000'));
naverPad=190000;
r=await mz('collect',{experimentId:naverId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-08',to:'2026-08-14'});
check('a naver response under the limit is still collected',r.status===200&&r.data.collected.arm.denominator===4000&&r.data.collected.arm.numerator===120);
naverPad=0;
naverStats={impCnt:0,clkCnt:null,salesAmt:0,ccnt:null};
r=await mz('collect',{experimentId:naverId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-15',to:'2026-08-21'});
check('unknown values stay null and are distinguished from zero',r.data.collected.arm.numerator===null&&r.data.collected.arm.denominator===0);
check('missing values are reported as limitations',r.data.collected.limitations.length>0);
naverStats={impCnt:4000,clkCnt:120,salesAmt:96000,ccnt:9};

// --- 사람이 비교 가능성을 확정해야 판정된다 ----------------------------------
draft=(await drafts()).find(d=>d.experimentId===naverId);
now+=2*3600000; // 최소 관찰 시간을 넘긴 시점으로 이동한다.
r=await req(learn,{action:'save_results',id:naverId,version:2,data:{control:draft.control,treatment:draft.treatment,observedUntil:new Clock().toISOString(),comparable:false,notes:'자동 수집. 비교 조건 미확인.'}});
check('auto-collected numbers alone cannot qualify a result',r.data.assessment?.status==='insufficient');
check('the blocking reason is the unconfirmed comparison',r.data.assessment.reasons.some(x=>x.includes('비교')));
check('unqualified result cannot be adopted',(await req(learn,{action:'adopt_rule',id:naverId,version:3,guidance:'x'})).status===409);

// --- 워커 디스패치 ----------------------------------------------------------
const principal={owner,hash:'x'.repeat(64)};
await server.namespace.recordStatement(owner,'worker_credential','current',{hash:principal.hash,createdAt:new Clock().toISOString()}).run();
let researchRan=0,collectRan=0;
const fakeResearch=async()=>{researchRan++;return new Response('{}',{status:200})};
const fakeCollect=async()=>{collectRan++;return {status:'processed'}};
r=await worker.namespace.workerTick(principal,fakeResearch,fakeCollect);
check('worker collects when no research is due',collectRan===1&&researchRan===0&&['idle','processed','retry'].includes(r.status));
await server.namespace.recordStatement(owner,'brand_research','pending-job',{id:'pending-job',brandId:'ofd',status:'running',steps:[{id:'s',stage:'investigation',status:'pending'}],createdAt:new Clock().toISOString(),updatedAt:new Clock().toISOString(),mode:'deep',execution:'server',model:'m',stopRequested:false,tokens:0,snapshot:{brand:{id:'ofd'},observations:[]}},'ofd').run();
r=await worker.namespace.workerTick(principal,fakeResearch,fakeCollect);
check('research work still takes priority over collection',researchRan===1&&collectRan===1);
check('worker status stays within the installed python contract',['idle','processed','retry'].includes(r.status));

// --- Instagram 커넥터 ------------------------------------------------------
const ig={accessToken:'IGQVJXlong-lived-test-token-0123456789',userId:'17841400000000000'};
igAuthorized=false;
check('invalid instagram token is rejected before storing',(await ch('save_credential',{channel:'instagram',data:ig})).status>=400);
check('rejected instagram credential is not stored',!(await chStatus()).channels.some(c=>c.channel==='instagram'&&c.connected));
igAuthorized=true;
r=await ch('save_credential',{channel:'instagram',data:{...ig,expiresAt:new Clock(now+40*86400000).toISOString()}});
check('instagram credential is stored with the account handle',r.status===200&&r.data.account==='oldferrydonut');
check('access token never leaves the server',!JSON.stringify(await chStatus()).includes(ig.accessToken));
check('token is never placed in the query string',igCalls.length>0&&igCalls.every(u=>!u.includes(ig.accessToken)&&!u.includes('access_token=')));

status=await chStatus();
let igStatus=status.channels.find(c=>c.channel==='instagram');
check('token expiry is surfaced',!!igStatus.expiresAt&&igStatus.expiringSoon===false);
await ch('save_credential',{channel:'instagram',data:{...ig,expiresAt:new Clock(now+3*86400000).toISOString()}});
check('expiry within a week raises the warning',(await chStatus()).channels.find(c=>c.channel==='instagram').expiringSoon===true);

r=await mz('collect',{experimentId,arm:'treatment',channel:'instagram',target:'17900000000000000',from:'2026-08-01',to:'2026-08-07'});
check('instagram collection succeeds',r.status===200);
check('reach and shares map onto the metric arm',r.data.collected.arm.denominator===9000&&r.data.collected.arm.numerator===450);
check('cumulative nature of media insights is recorded',r.data.collected.limitations.some(x=>x.includes('누적')));
check('post time is captured so elapsed time can be compared',r.data.collected.definition.includes('2026-08-01')||JSON.stringify(r.data.collected.raw).includes('2026-08-01'));
igInsights={reach:9000,saves:120};
r=await mz('collect',{experimentId,arm:'treatment',channel:'instagram',target:'17900000000000000',from:'2026-08-01',to:'2026-08-07'});
check('missing share metric stays null rather than zero',r.data.collected.arm.numerator===null);
igInsights={reach:100,shares:250};
r=await mz('collect',{experimentId,arm:'treatment',channel:'instagram',target:'17900000000000000',from:'2026-08-01',to:'2026-08-07'});
check('shares above reach are reported, not silently accepted',r.data.collected.limitations.some(x=>x.includes('공유')));
igInsights={reach:9000,shares:450,saves:120,plays:7000};
// R5: Instagram 미디어 인사이트는 게시 이후 누적값이라 요청 기간이 값에 영향을 주지 않는다. 기간 불일치·당일 부분 집계 경고를 붙이지 않는다.
await mz('collect',{experimentId,arm:'control',channel:'instagram',target:'17900000000000001',from:'2026-08-02',to:new Clock().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'})});
const igDraft=(await drafts()).find(d=>d.experimentId===experimentId);
check('instagram arms with different windows carry no window warning',igDraft.arms.control.window.from!==igDraft.arms.treatment.window.from&&!igDraft.limitations.some(x=>x.includes('수집 기간이 다릅니다')||x.includes('당일 부분 집계'))&&!igDraft.arms.control.limitations.some(x=>x.includes('당일 부분 집계')));
igDown=true;
r=await mz('collect',{experimentId,arm:'treatment',channel:'instagram',target:'17900000000000000',from:'2026-08-15',to:'2026-08-21'});
check('instagram outage surfaces as an error, not as numbers',r.status>=500);
igDown=false;
igPad=200001;
r=await mz('collect',{experimentId,arm:'treatment',channel:'instagram',target:'17900000000000000',from:'2026-08-15',to:'2026-08-21'});
check('an oversized instagram response is refused with a clear error, not parsed',r.status===502&&r.data.error.includes('허용 크기(200KB)')&&!r.data.collected);
igPad=190000;
r=await mz('collect',{experimentId,arm:'treatment',channel:'instagram',target:'17900000000000000',from:'2026-08-15',to:'2026-08-21'});
check('an instagram response under the limit is still collected',r.status===200&&r.data.collected.arm.denominator===9000&&r.data.collected.arm.numerator===450);
igPad=0;

// --- 끝난 실험은 수집도 끝난다 ----------------------------------------------
// naverId는 위에서 save_results를 거쳐 running이 아니다.
check('a finished experiment no longer accepts collection',(await mz('collect',{experimentId:naverId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-09-01',to:'2026-09-07'})).status===400);
now+=7*3600000; // 수집 간격(6시간)을 넘긴 시점으로 이동한다.
r=await collector.namespace.collectDueMeasurements(owner);
check('the worker stops collecting for a finished experiment',r.status==='stopped');
const sources=async()=>server.namespace.listRecords(owner,'measurement_source');
check('the stopped source records why it stopped',(await sources()).some(x=>x.experimentId===naverId&&x.stopped===true&&!!x.stoppedReason));
const callsBefore=naverCalls.length;
now+=7*3600000;
await collector.namespace.collectDueMeasurements(owner);
check('a stopped source never calls the external API again',naverCalls.length===callsBefore);

// --- 폐기 ------------------------------------------------------------------
const naverLiveId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/collect2','click_rate');
check('revoking a channel succeeds',(await ch('revoke_credential',{channel:'naver_ads'})).status===200);
check('revoked channel reports disconnected',!(await chStatus()).channels.some(c=>c.channel==='naver_ads'&&c.connected));
check('collection stops after revocation',(await mz('collect',{experimentId:naverLiveId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-09-01',to:'2026-09-07'})).status===409);

// --- loop-9: 워커 재수집은 to를 오늘까지 넓히고, 초안은 arm별 기간·정의를 따로 보관한다 ---------
// 워커는 tick마다 기한이 된 대상 하나만 처리하므로 시나리오마다 소유자를 나눠 대상이 섞이지 않게 한다.
const seoulDay=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
const rollingOwner=async(who,campaign={})=>{await server.namespace.seedBrands(who);await req(channels,{action:'save_credential',channel:'naver_ads',data:naver},who);return (await req(action,{action:'save_campaign',data:{brandId:'ofd',title:'롤링 캠페인',goal:'기간 롤링 검증',channels:'네이버 검색광고',budget:0,...campaign}},who)).data.id};
const collectAs=(who,data)=>req(measurements,{action:'collect',channel:'naver_ads',target:'cmp-1',...data},who);
const sourceOf=async(who,id)=>(await server.namespace.listRecords(who,'measurement_source')).find(s=>s.id===id);
const draftOf=async(who,id)=>(await server.namespace.listRecords(who,'measurement_draft')).find(d=>d.experimentId===id);
const lastUntil=()=>JSON.parse(new URL(naverCalls.at(-1).url).searchParams.get('timeRange')).until;
const mismatch=x=>x.includes('수집 기간이 다릅니다'),partial=x=>x.includes('당일 부분 집계');
// R5: 롤링 상한은 마지막 완결일(어제, Asia/Seoul)이다. 오늘은 집계가 끝나지 않은 날이다.
const lastDay=t=>seoulDay(t-86400000);

let who='measurement-rolling-open',rollCampaign=await rollingOwner(who);
const rollId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/roll-open','click_rate',who,rollCampaign);
await collectAs(who,{experimentId:rollId,arm:'control',from:'2026-08-01',to:seoulDay(now-3*86400000),rolling:true});
check('an explicit rolling request registers a rolling source',(await sourceOf(who,rollId+':control')).rolling===true);
now+=7*3600000;
check('the worker recollects the rolling source',(await collector.namespace.collectDueMeasurements(who)).status==='processed');
let rolled=await sourceOf(who,rollId+':control');
check('the worker moves to up to the last complete day in Asia/Seoul and keeps from',rolled.window.to===lastDay(now)&&rolled.window.from==='2026-08-01');
check('the external call asks for the rolled window',lastUntil()===lastDay(now));
const firstTo=rolled.window.to;
now+=30*3600000;
await collector.namespace.collectDueMeasurements(who);
rolled=await sourceOf(who,rollId+':control');
check('the second worker tick advances to again',rolled.window.to===lastDay(now)&&rolled.window.to>firstTo&&rolled.rolling===true);

// arm별 보관과 기간 불일치 경고.
await collectAs(who,{experimentId:rollId,arm:'treatment',target:'cmp-2',from:'2026-08-01',to:'2026-08-07'});
let rollDraft=await draftOf(who,rollId);
check('the draft keeps each arm with its own value, window, definition, limitations and time',rollDraft.arms?.control?.window.to===lastDay(now)&&rollDraft.arms.treatment?.window.to==='2026-08-07'&&rollDraft.arms.control.value.denominator===4000&&!!rollDraft.arms.control.definition&&rollDraft.arms.treatment.limitations.length>0&&!!rollDraft.arms.control.fetchedAt);
check('different arm windows add a warning to the draft limitations',rollDraft.limitations.some(mismatch));
check('the arm values stay on the existing top-level fields',rollDraft.control.denominator===4000&&rollDraft.treatment.denominator===4000);
// R5: 수집일(오늘)까지 포함한 기간은 당일 부분 집계다. 문자열이 같아도 수집 시각에 따라 값이 다르므로 arm과 초안 한계에 적는다.
await collectAs(who,{experimentId:rollId,arm:'treatment',target:'cmp-2',from:'2026-08-01',to:seoulDay(now)});
rollDraft=await draftOf(who,rollId);
check('a window that reaches the collection day is a partial day on the arm and the draft',rollDraft.arms.treatment.limitations.some(partial)&&rollDraft.limitations.some(partial)&&!rollDraft.arms.control.limitations.some(partial));
await collectAs(who,{experimentId:rollId,arm:'treatment',target:'cmp-2',from:'2026-08-01',to:lastDay(now)});
check('matching complete arm windows carry no warning',!(await draftOf(who,rollId)).limitations.some(x=>mismatch(x)||partial(x)));

// 이전 형식 초안(arm별 기록 없음)은 최상위 기간·정의를 값이 있는 arm의 것으로 읽는다.
const legacyId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/roll-legacy','click_rate',who,rollCampaign);
await server.namespace.recordStatement(who,'measurement_draft',legacyId,{id:legacyId,experimentId:legacyId,channel:'naver_ads',control:{denominator:1000,numerator:30,source:'이전 수집'},comparable:false,definition:'이전 정의',window:{from:'2026-07-01',to:'2026-07-07'},limitations:['이전 한계'],fetchedAt:'2026-07-08T00:00:00.000Z',updatedAt:'2026-07-08T00:00:00.000Z'},rollCampaign).run();
await collectAs(who,{experimentId:legacyId,arm:'treatment',from:'2026-07-01',to:'2026-07-14'});
const legacy=await draftOf(who,legacyId);
check('a legacy draft is read as the arm it holds',legacy.arms?.control?.window.to==='2026-07-07'&&legacy.arms.control.definition==='이전 정의'&&legacy.arms.control.value.numerator===30&&legacy.arms.control.limitations[0]==='이전 한계'&&legacy.arms.control.fetchedAt==='2026-07-08T00:00:00.000Z');
check('a legacy arm keeps its value next to the new arm',legacy.control.numerator===30&&legacy.treatment.denominator===4000&&legacy.arms.treatment.window.to==='2026-07-14');
check('a legacy arm window that differs from the new arm is warned',legacy.limitations.some(mismatch));
// R6: 두 arm이 모두 있던 이전 초안의 최상위 기간은 마지막 수집 arm의 것이다. 다른 arm의 기간은 그 arm의 수집 대상에 남은 기간을 쓴다.
const legacyBothId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/roll-legacy-both','click_rate',who,rollCampaign);
await server.namespace.recordStatement(who,'measurement_draft',legacyBothId,{id:legacyBothId,experimentId:legacyBothId,channel:'naver_ads',control:{denominator:1000,numerator:30,source:'이전 수집'},treatment:{denominator:1200,numerator:40,source:'이전 수집'},comparable:false,definition:'이전 정의',window:{from:'2026-07-01',to:'2026-07-14'},limitations:['이전 한계'],fetchedAt:'2026-07-15T00:00:00.000Z',updatedAt:'2026-07-15T00:00:00.000Z'},rollCampaign).run();
for(const [arm,to] of [['control','2026-07-07'],['treatment','2026-07-14']])await server.namespace.recordStatement(who,'measurement_source',legacyBothId+':'+arm,{id:legacyBothId+':'+arm,experimentId:legacyBothId,channel:'naver_ads',arm,target:'cmp-1',window:{from:'2026-07-01',to},lastFetchedAt:new Clock().toISOString(),lastError:null},legacyBothId).run();
await collectAs(who,{experimentId:legacyBothId,arm:'treatment',from:'2026-07-01',to:'2026-07-14'});
const legacyBoth=await draftOf(who,legacyBothId);
check('a legacy arm takes its window from its own collection source',legacyBoth.arms.control.window.to==='2026-07-07'&&legacyBoth.arms.treatment.window.to==='2026-07-14');
check('re-collecting the last arm of a legacy draft keeps the mismatch warning',legacyBoth.limitations.some(mismatch));

// 실험 종료일(캠페인 종료일)이 있으면 그날까지만 넓힌다. 그 뒤에는 같은 기간을 다시 조회해 지연 반영분만 받는다.
who='measurement-rolling-ended';rollCampaign=await rollingOwner(who,{startDate:'2026-08-01',endDate:'2026-08-10'});
const endedId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/roll-ended','click_rate',who,rollCampaign);
await collectAs(who,{experimentId:endedId,arm:'control',from:'2026-08-01',to:'2026-08-07',rolling:true});
now+=7*3600000;await collector.namespace.collectDueMeasurements(who);
check('rolling stops at the experiment end date',(await sourceOf(who,endedId+':control')).window.to==='2026-08-10'&&lastUntil()==='2026-08-10');
now+=30*3600000;await collector.namespace.collectDueMeasurements(who);
check('after the end date to no longer advances',(await sourceOf(who,endedId+':control')).window.to==='2026-08-10'&&lastUntil()==='2026-08-10');

// 롤링을 끈 수집과 롤링 이전에 저장된 대상은 처음 기간을 그대로 다시 조회한다.
who='measurement-rolling-fixed';rollCampaign=await rollingOwner(who);
const fixedId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/roll-fixed','click_rate',who,rollCampaign);
await collectAs(who,{experimentId:fixedId,arm:'control',from:'2026-08-01',to:'2026-08-07',rolling:false});
now+=7*3600000;await collector.namespace.collectDueMeasurements(who);
check('a collection that opts out of rolling keeps its window',(await sourceOf(who,fixedId+':control')).window.to==='2026-08-07'&&lastUntil()==='2026-08-07');
const legacySource=Object.fromEntries(Object.entries(await sourceOf(who,fixedId+':control')).filter(([k])=>k!=='rolling'));
await server.namespace.recordStatement(who,'measurement_source',legacySource.id,legacySource,fixedId).run();
now+=7*3600000;await collector.namespace.collectDueMeasurements(who);
check('a source saved before rolling keeps its window',(await sourceOf(who,fixedId+':control')).window.to==='2026-08-07'&&lastUntil()==='2026-08-07');
// R10①: 두 번째 tick에서도 이전 대상은 롤링으로 바뀌지 않는다(첫 tick만 보면 롤링 전환 회귀를 잡지 못한다).
now+=7*3600000;await collector.namespace.collectDueMeasurements(who);
check('a source saved before rolling stays fixed on the next tick too',(await sourceOf(who,fixedId+':control')).window.to==='2026-08-07'&&lastUntil()==='2026-08-07'&&(await sourceOf(who,fixedId+':control')).rolling!==true);

// R4: 종료일 없는 캠페인에서 과거의 고정 기간을 지정하면(rolling 미지정) 그 기간을 유지한다. 마지막 완결일 이후까지 요청하면 롤링한다.
who='measurement-rolling-past';rollCampaign=await rollingOwner(who);
const pastId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/roll-past','click_rate',who,rollCampaign);
await collectAs(who,{experimentId:pastId,arm:'control',from:'2026-08-01',to:'2026-08-07'});
check('an explicit past window does not roll by default',(await sourceOf(who,pastId+':control')).rolling===false);
now+=60000;await collectAs(who,{experimentId:pastId,arm:'treatment',target:'cmp-2',from:'2026-08-01',to:lastDay(now)});
check('a window up to the last complete day rolls by default',(await sourceOf(who,pastId+':treatment')).rolling===true);
now+=7*3600000;await collector.namespace.collectDueMeasurements(who);
check('the worker keeps an explicit past window of an open-ended campaign',(await sourceOf(who,pastId+':control')).window.to==='2026-08-07'&&lastUntil()==='2026-08-07');

// R10②: 이미 더 뒤인 to(예: 앞으로의 종료일까지 요청)는 롤링이 줄이지 않는다.
who='measurement-rolling-ahead';rollCampaign=await rollingOwner(who);
const aheadId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/roll-ahead','click_rate',who,rollCampaign),aheadTo=seoulDay(now+10*86400000);
await collectAs(who,{experimentId:aheadId,arm:'control',from:'2026-08-01',to:aheadTo});
now+=7*3600000;await collector.namespace.collectDueMeasurements(who);
check('rolling never shortens a later to',(await sourceOf(who,aheadId+':control')).window.to===aheadTo&&lastUntil()===aheadTo&&(await sourceOf(who,aheadId+':control')).rolling===true);

// loop-9: 롤링은 실험 단위로 같은 to를 쓴다. 두 arm을 다른 시각에 수집하고 Asia/Seoul 자정을 넘긴 뒤 한 번 tick하면
// 기한이 된 arm뿐 아니라 같은 실험의 롤링 arm도 같은 창으로 다시 수집해 기간 불일치가 생기지 않는다.
who='measurement-rolling-sync';rollCampaign=await rollingOwner(who);
const syncId=await mkExperiment('네이버 검색광고','https://searchad.naver.com/report/roll-sync','click_rate',who,rollCampaign);
const nextSeoulMidnight=t=>Math.ceil((t+9*3600000)/86400000)*86400000-9*3600000,midnight=nextSeoulMidnight(now+7*3600000);
now=midnight-6.5*3600000;await collectAs(who,{experimentId:syncId,arm:'control',from:'2026-08-01',to:lastDay(now)});
now=midnight-3600000;await collectAs(who,{experimentId:syncId,arm:'treatment',target:'cmp-2',from:'2026-08-01',to:lastDay(now)});
const syncBefore=(await sourceOf(who,syncId+':treatment')).lastFetchedAt;
now=midnight+1800000;
check('only the earlier arm is due after midnight',(await collector.namespace.collectDueMeasurements(who)).status==='processed');
const syncDraft=await draftOf(who,syncId),syncControl=await sourceOf(who,syncId+':control'),syncTreatment=await sourceOf(who,syncId+':treatment');
check('one tick rolls both arms of the experiment to the same to',syncControl.window.to===lastDay(now)&&syncTreatment.window.to===lastDay(now)&&syncTreatment.lastFetchedAt>syncBefore);
check('arms rolled together carry no window mismatch',syncDraft.arms.control.window.to===syncDraft.arms.treatment.window.to&&!syncDraft.limitations.some(mismatch));

console.log(JSON.stringify({passed:checks.length,checks},null,2));
