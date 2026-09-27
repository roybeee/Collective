// loop-1·security-ops-5: 성과 수집을 화면에서 시작하고 자동 수집 실패를 보이게 한다.
// - POST /api/measurements collect가 measurement_source를 등록하고, GET /api/learning이 실험별 초안·수집 대상 상태를 싣는다.
// - lastError는 분류 코드와 정해진 한국어 사유만(토큰·URL·응답 원문 0건). 이전 레코드의 문구도 내보내지 않는다.
// - 인증 오류는 재연결 필요로 표시하고 워크스페이스 알림 1건. 스위치 collect_guard가 켜지면 즉시 멈추고 연속 실패 백오프(6→12→24시간).
// - 실패 사례: 직원 403, 다른 소유자 404, 진행 중 아닌 실험 409, 잘못된 기간·대상 400, 다른 브랜드 자격증명 미사용(F5).
// 근거: mocked(메모리 SQLite, 네이버·Instagram fetch 스텁, 주입한 시계, 로컬 인증 헤더·이메일 세션). 외부 네트워크 호출 0회.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {moduleRuntime} from '../scripts/eval/runtime.mjs';
import {testRuntime} from './helpers/runtime.mjs';

let now=Date.parse('2026-09-20T03:00:00.000Z');
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
const HOUR=3600000;
let naverAuthorized=true,naverDown=false,igAuthorized=true;
const naverCalls=[],igCalls=[];
const fakeFetch=async(url,options={})=>{
 if(url.startsWith('https://api.searchad.naver.com/')){
  naverCalls.push(url);
  if(naverDown)throw new Error('network lost https://api.searchad.naver.com/stats');
  if(!naverAuthorized)return new Response('{"message":"raw upstream auth failure"}',{status:401});
  if(url.includes('/ncc/campaigns'))return Response.json([]);
  if(url.includes('/stats'))return Response.json({data:[{id:'cmp-1',impCnt:4000,clkCnt:120,salesAmt:96000,ccnt:9}]});
  return new Response('',{status:404});
 }
 if(url.startsWith('https://graph.facebook.com/')){
  igCalls.push({url,auth:new Headers(options.headers).get('Authorization')});
  if(!igAuthorized)return Response.json({error:{message:'Invalid OAuth access token',code:190}},{status:400});
  if(url.includes('/insights'))return Response.json({data:[{name:'reach',values:[{value:900}]},{name:'shares',values:[{value:45}]}]});
  if(url.includes('fields=username'))return Response.json({username:'brand-b'});
  return Response.json({timestamp:'2026-08-01T09:00:00+0000',media_type:'VIDEO'});
 }
 throw new Error('Unexpected destination: '+url);
};
const rt=moduleRuntime(fakeFetch,{},{Date:Clock});
const server=await rt.load('lib/server.ts'),channels=await rt.load('app/api/channels/route.ts'),measurements=await rt.load('app/api/measurements/route.ts'),learn=await rt.load('app/api/learning/route.ts');
const collector=await rt.load('lib/measurement-collection.ts'),status=await rt.load('lib/measurement-status.ts'),flags=await rt.load('lib/feature-flags.ts');
const checks=[];const check=(label,v)=>{assert.ok(v,label);checks.push(label)};

async function req(mod,b,who,method='POST',query=''){const h={'content-type':'application/json','oai-authenticated-user-id':who};const r=await mod[method](new Request('https://agency.test/api/test'+query,{method,headers:h,...(method==='POST'?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json(),text:''}}
const naver={apiKey:'fixture-a',secretKey:'fixture-b',customerId:'1234567'};
const setup=async owner=>{
 await server.seedBrands(owner);
 await server.recordStatement(owner,'campaign','c1',{id:'c1',brandId:'ofd',title:'c1',version:1}).run();
 assert.equal((await req(channels,{action:'save_credential',channel:'naver_ads',data:naver},owner)).status,200);
};
const experiment=(owner,id,over={})=>server.recordStatement(owner,'viral_experiment',id,{id,brandId:'ofd',campaignId:'c1',title:'실험 '+id,channel:'네이버 검색광고',metric:'ctr',status:'running',version:1,...over},'c1').run();
const collect=(owner,experimentId,extra={})=>req(measurements,{action:'collect',experimentId,arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-09-01',to:'2026-09-07',...extra},owner);
const getLearning=async(owner,query='')=>{const r=await learn.GET(new Request('https://agency.test/api/learning'+query,{headers:{'oai-authenticated-user-id':owner}}));const text=await r.text();return {status:r.status,text,data:JSON.parse(text)}};
const sourceOf=(owner,id)=>server.readRecord(owner,'measurement_source',id);
const viewOf=async(owner,experimentId)=>(await getLearning(owner)).data.measurements.find(m=>m.experimentId===experimentId);
const tick=owner=>collector.collectDueMeasurements(owner);
const setGuard=(owner,enabled)=>flags.setFeatureFlag(owner,{flag:'collect_guard',enabled},{id:owner,email:null});

// --- 1) 수집 시작 → 수집 대상 등록, GET에 초안·대상 상태 ------------------------------------
const A='status-owner';await setup(A);
await experiment(A,'e-run');await experiment(A,'e-draft',{status:'draft'});await experiment(A,'e-done',{status:'evaluated'});
let r=await collect(A,'e-run');
check('collect on a running experiment succeeds',r.status===200&&r.data.draft.comparable===false);
let source=await sourceOf(A,'e-run:control');
check('collect registers the measurement source the worker repeats',source.target==='cmp-1'&&source.lastError===null&&source.window.from==='2026-09-01');
let learning=await getLearning(A);
let view=learning.data.measurements.find(m=>m.experimentId==='e-run');
check('learning GET carries the draft per experiment',view.draft.arms.control.value.denominator===4000&&view.draft.arms.control.value.numerator===120&&view.draft.arms.control.window.to==='2026-09-07'&&view.draft.arms.control.credential.level==='workspace');
check('the draft in the view never claims comparability',view.draft.comparable===false);
check('learning GET carries the source state',view.sources.length===1&&view.sources[0].arm==='control'&&view.sources[0].lastError===null&&view.sources[0].failures===0&&view.sources[0].stopped===false&&view.sources[0].reauthRequired===false);
check('the next attempt is 6 hours after the last fetch',Date.parse(view.sources[0].nextAttemptAt)-Date.parse(view.sources[0].lastFetchedAt)===6*HOUR);
check('the view does not carry store values or raw responses',!('storeValues' in view.draft.arms.control)&&!learning.text.includes('"raw"'));
check('no collect alert while collection works',learning.data.collectAlerts.length===0&&(await getLearning(A,'?only=collect_alerts')).data.collectAlerts.length===0);
// 결과 입력 미리 채우기: 수치·출처·한계는 옮기고 comparable은 false다.
const prefill=status.resultPrefill(view);
check('result prefill copies the collected numbers and source',prefill.control.denominator===4000&&prefill.control.numerator===120&&prefill.control.source.includes('2026-09-01~2026-09-07')&&prefill.treatment===null);
check('result prefill leaves comparable false for the human to confirm',prefill.comparable===false&&prefill.notes.includes('직접 확인'));
check('no prefill without a draft',status.resultPrefill(undefined)===null&&status.resultPrefill({experimentId:'x',channel:null,draft:null,sources:[]})===null);

// --- 5) 실패 사례 ------------------------------------------------------------------
const callsBefore=naverCalls.length;
check('another owner cannot collect on this experiment (404)',(await collect('someone-else','e-run')).status===404);
check('a draft experiment is a 409',(await collect(A,'e-draft')).status===409);
check('an evaluated experiment is a 409',(await collect(A,'e-done')).status===409);
check('a malformed date is a 400',(await collect(A,'e-run',{from:'2026/09/01'})).status===400);
check('an impossible window is a 400',(await collect(A,'e-run',{from:'2026-09-08',to:'2026-09-01'})).status===400);
check('a missing target is a 400',(await collect(A,'e-run',{target:''})).status===400);
check('an unknown arm is a 400',(await collect(A,'e-run',{arm:'both'})).status===400);
check('rejected requests never call the external API',naverCalls.length===callsBefore);
// F5 격리: 브랜드 oda에만 Instagram 연결이 있으면 브랜드 ofd의 Instagram 실험은 그 토큰을 쓰지 않는다.
assert.equal((await req(channels,{action:'save_credential',channel:'instagram',brandId:'oda',data:{accessToken:'ig-token-SECRET-oda',userId:'17841400000000000'}},A)).status,200);
await experiment(A,'e-ig',{channel:'Instagram',metric:'share_rate'});
const igBefore=igCalls.length;
r=await collect(A,'e-ig',{channel:'instagram',target:'17900000000000000'});
check('another brand credential is never used for this brand (F5)',r.status===409&&igCalls.length===igBefore);

// --- 2) 실패는 분류 코드·짧은 사유로만 -----------------------------------------------------
naverDown=true;now+=6*HOUR;
check('a due source that fails is retried later',(await tick(A)).status==='retry');
source=await sourceOf(A,'e-run:control');
check('a gateway failure is stored as its code and fixed reason, not the connector message',source.errorCode==='upstream_unavailable'&&source.lastError===status.collectErrorReasons.upstream_unavailable&&source.failures===1);
view=await viewOf(A,'e-run');
check('the view shows the failure code, reason and count',view.sources[0].lastError.code==='upstream_unavailable'&&view.sources[0].lastError.reason===status.collectErrorReasons.upstream_unavailable&&view.sources[0].failures===1&&view.sources[0].reauthRequired===false);
naverDown=false;
// 이 필드가 생기기 전 레코드(원문 문구가 lastError에 남음)도 원문을 내보내지 않는다.
const legacyRaw='Instagram 요청 실패 https://graph.facebook.com/v21.0/1?access_token=ig-token-SECRET-oda Invalid OAuth access token';
await server.recordStatement(A,'measurement_source','e-ig:treatment',{id:'e-ig:treatment',experimentId:'e-ig',channel:'instagram',arm:'treatment',target:'17900000000000001',window:{from:'2026-09-01',to:'2026-09-07'},lastFetchedAt:new Clock().toISOString(),lastError:legacyRaw},'e-ig').run();
learning=await getLearning(A);
const legacy=learning.data.measurements.find(m=>m.experimentId==='e-ig').sources[0];
check('a legacy raw lastError is shown only as the unknown code',legacy.lastError.code==='unknown'&&legacy.lastError.reason===status.collectErrorReasons.unknown&&legacy.failures===1);
const leaks=[naver.apiKey,naver.secretKey,'ig-token-SECRET','api.searchad.naver.com','graph.facebook.com','access_token','Invalid OAuth','raw upstream auth failure','network lost'];
check('learning GET carries no token, URL or raw response text',leaks.every(x=>!learning.text.includes(x)));
await server.database().prepare("DELETE FROM records WHERE owner=? AND kind='measurement_source' AND id LIKE ?").bind(A,`${A}:measurement_source:e-ig:%`).run();

// --- 4) 인증 오류: 재연결 필요·알림 1건, 스위치가 켜지면 즉시 멈춤 ------------------------------
check('collect_guard is a known switch, off by default, after b3_playbook_signals',await flags.isEnabled(A,'collect_guard')===false&&Object.keys(flags.FEATURE_FLAGS).indexOf('collect_guard')===Object.keys(flags.FEATURE_FLAGS).indexOf('b3_playbook_signals')+1&&/재연결 필요/.test(flags.FEATURE_FLAGS.collect_guard.description));
naverAuthorized=false;now+=6*HOUR;
check('switch off: an auth failure is a retry, not a stop',(await tick(A)).status==='retry');
source=await sourceOf(A,'e-run:control');
check('switch off: the auth failure is classified as reauth_required and kept running',source.errorCode==='reauth_required'&&source.stopped!==true&&source.failures===2);
view=await viewOf(A,'e-run');
check('switch off: the card shows reconnection is needed',view.sources[0].reauthRequired===true&&view.sources[0].lastError.code==='reauth_required'&&view.sources[0].stopped===false);
let alerts=(await getLearning(A,'?only=collect_alerts')).data.collectAlerts;
check('switch off: one workspace alert for the failing source',alerts.length===1&&alerts[0].experimentId==='e-run'&&alerts[0].brandId==='ofd'&&alerts[0].code==='reauth_required'&&alerts[0].arm==='control');
await setGuard(A,true);
now+=24*HOUR;
check('switch on: an auth failure stops the source',(await tick(A)).status==='retry');
source=await sourceOf(A,'e-run:control');
check('switch on: the stopped source records reauth as the reason',source.stopped===true&&source.stoppedFor==='reauth'&&source.stoppedReason===status.STOP_REASONS.reauth&&source.errorCode==='reauth_required');
view=await viewOf(A,'e-run');
check('switch on: the view says reconnection is needed and no next attempt',view.sources[0].stopped===true&&view.sources[0].reauthRequired===true&&view.sources[0].nextAttemptAt===null&&view.sources[0].stoppedReason===status.STOP_REASONS.reauth);
alerts=(await getLearning(A,'?only=collect_alerts')).data.collectAlerts;
check('switch on: still exactly one workspace alert',alerts.length===1&&alerts[0].experimentId==='e-run');
const stoppedCalls=naverCalls.length;now+=48*HOUR;
check('a source stopped for reauth is never called again by the worker',(await tick(A)).status==='idle'&&naverCalls.length===stoppedCalls);
// 다시 연결한 뒤 사람이 다시 가져오면 대상이 새로 쓰여 실패 수·멈춤이 풀린다.
naverAuthorized=true;
check('a manual collect after reconnecting succeeds',(await collect(A,'e-run')).status===200);
source=await sourceOf(A,'e-run:control');
check('the manual collect resets the source',source.stopped!==true&&!source.errorCode&&!source.failures&&source.lastError===null);
check('the alert disappears after the source recovers',(await getLearning(A,'?only=collect_alerts')).data.collectAlerts.length===0);
// 끝난 실험의 인증 실패 대상은 알림에 오르지 않는다.
await experiment(A,'e-run',{status:'evaluated',version:2});
await server.recordStatement(A,'measurement_source','e-run:control',{...source,lastError:status.collectErrorReasons.reauth_required,errorCode:'reauth_required',failures:1},'e-run').run();
check('a failing source of a finished experiment raises no alert',(await getLearning(A,'?only=collect_alerts')).data.collectAlerts.length===0);

// --- 4) 연속 실패 백오프(시계 주입) ----------------------------------------------------
const B='backoff-owner';await setup(B);await experiment(B,'e-b');
assert.equal((await collect(B,'e-b')).status,200);
await setGuard(B,true);naverDown=true;
const attempt=async hours=>{now+=hours*HOUR;const before=naverCalls.length;const res=await tick(B);return {status:res.status,called:naverCalls.length>before}};
let a=await attempt(6);
check('failure 1 happens at the normal 6 hour interval',a.status==='retry'&&a.called&&(await sourceOf(B,'e-b:control')).failures===1);
a=await attempt(6);
check('after one failure the next try is still 6 hours later',a.status==='retry'&&a.called&&(await sourceOf(B,'e-b:control')).failures===2);
a=await attempt(6);
check('after two failures 6 hours is not enough',a.status==='idle'&&!a.called);
a=await attempt(6);
check('after two failures the next try is 12 hours later',a.status==='retry'&&a.called&&(await sourceOf(B,'e-b:control')).failures===3);
a=await attempt(12);
check('after three failures 12 hours is not enough',a.status==='idle'&&!a.called);
view=await viewOf(B,'e-b');
check('the view shows the 24 hour backoff as the next attempt',Date.parse(view.sources[0].nextAttemptAt)-Date.parse(view.sources[0].lastFetchedAt)===24*HOUR&&view.sources[0].failures===3);
a=await attempt(12);
check('after three failures the next try is 24 hours later',a.status==='retry'&&a.called&&(await sourceOf(B,'e-b:control')).failures===4);
a=await attempt(24);
check('the backoff never exceeds 24 hours',a.status==='retry'&&a.called&&(await sourceOf(B,'e-b:control')).failures===5);
await setGuard(B,false);
a=await attempt(6);
check('switch off keeps the previous 6 hour retry',a.status==='retry'&&a.called&&(await sourceOf(B,'e-b:control')).failures===6);
naverDown=false;
check('the backoff schedule is 6, 6, 12, 24, 24 hours',JSON.stringify([0,1,2,3,9].map(n=>status.retryDelayMs(n)/HOUR))==='[6,6,12,24,24]');

// --- 5) 직원은 수집을 시작하지 못한다(이메일 세션) ---------------------------------------
const email=testRuntime(async url=>{throw new Error('외부 호출 금지: '+url)});Object.assign(email.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const emailMeasurements=await email.load('app/api/measurements/route.ts'),emailLearn=await email.load('app/api/learning/route.ts');
for(const [id,role,token] of [['admin','admin','a'.repeat(64)],['member','member','b'.repeat(64)]]){email.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid','workspace',role,'active',Date.now());email.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now())}
const emailCollect=token=>emailMeasurements.POST(new Request('https://app.test/api/measurements',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test',cookie:'__Host-collective_session='+token},body:JSON.stringify({action:'collect',experimentId:'missing',arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-09-01',to:'2026-09-07'})}));
check('a member cannot start collection (403)',(await emailCollect('b'.repeat(64))).status===403);
check('an admin passes the role check (404 for the missing experiment)',(await emailCollect('a'.repeat(64))).status===404);
const memberRead=await emailLearn.GET(new Request('https://app.test/api/learning?only=collect_alerts',{headers:{cookie:'__Host-collective_session='+'b'.repeat(64)}}));
check('a member still reads the collection alerts',memberRead.status===200&&Array.isArray((await memberRead.json()).collectAlerts));

console.log(JSON.stringify({passed:checks.length,checks},null,2));
