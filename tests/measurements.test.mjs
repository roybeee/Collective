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
const igCalls=[];
const naverCalls=[];const destinations=[];
const fakeFetch=async(url,options={})=>{
 destinations.push(url);
 if(url.startsWith('https://api.searchad.naver.com/')){
  const headers=new Headers(options.headers);
  naverCalls.push({url,timestamp:headers.get('X-Timestamp'),apiKey:headers.get('X-API-KEY'),customer:headers.get('X-Customer'),signature:headers.get('X-Signature')});
  if(naverDown)throw new Error('network lost');
  if(!naverAuthorized)return new Response('',{status:401});
  if(url.includes('/ncc/campaigns'))return Response.json([{nccCampaignId:'cmp-1',name:'테스트 캠페인'}]);
  if(url.includes('/stats'))return Response.json({data:[{id:'cmp-1',...naverStats}]});
  return new Response('',{status:404});
 }
 if(url.startsWith('https://graph.facebook.com/')){
  igCalls.push(url);
  if(igDown)throw new Error('graph unavailable');
  if(!igAuthorized)return Response.json({error:{message:'Invalid OAuth access token',code:190}},{status:400});
  if(url.includes('/insights'))return Response.json({data:Object.entries(igInsights).map(([name,value])=>({name,values:[{value}]}))});
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
const mkExperiment=async(channel,url,metric)=>{
 const caseId=(await req(learn,{action:'add_case',data:{brandId:'ofd',title:'수집 사례',channel,url,scope:'테스트',observations:'테스트 관찰'}})).data.id;
 const analysisId=(await req(learn,{action:'save_analysis',caseId,data:{facts:'f',hook:'h',retention:'r',sharing:'s',context:'c',counterEvidence:'x',unknowns:'u',ideas:[{hypothesis:'h',variable:'v',control:'c',treatment:'t',metric}]}})).data.id;
 const id=(await req(learn,{action:'create_experiment',analysisId,campaignId:cid,data:{title:'수집 실험',hypothesis:'h',variable:'v',control:'c',treatment:'t',metric,minSample:1000,minHours:1,conditions:'동일 조건',minLift:10}})).data.id;
 await req(learn,{action:'start_experiment',id,version:1});
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

// --- 실패는 숫자를 지어내지 않는다 -------------------------------------------
naverDown=true;
r=await mz('collect',{experimentId:naverId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-08-08',to:'2026-08-14'});
check('gateway failure surfaces as an error, not as numbers',r.status>=500&&!JSON.stringify(r.data).includes('4000'));
naverDown=false;
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
igDown=true;
r=await mz('collect',{experimentId,arm:'treatment',channel:'instagram',target:'17900000000000000',from:'2026-08-15',to:'2026-08-21'});
check('instagram outage surfaces as an error, not as numbers',r.status>=500);
igDown=false;

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

console.log(JSON.stringify({passed:checks.length,checks},null,2));
