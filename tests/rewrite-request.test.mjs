// X6 선택 다시 쓰기(lib/rewrite-request.ts·lib/rewrite-request-server.ts·app/api/rewrite/route.ts).
// 확인: 입력 검사(방식·톤·길이·번호), 지시문에 고른 글만 실림, 출력 정리, 조각 바꿔 끼우기, 스위치 꺼짐 409, 직원 403, 자율성 금지 403, 토큰 예산 초과 409(보내지 않음),
// 시작 → 조회 → 완료 제안(캡션·발행·작업물 변경 없음), 멱등, 처리 중 중복 409, 형식 오류 실패, 접수 503 → 확인 불가 → 복구, 받기·버리기 한 번만.
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, HERMES fetch 스텁). 실제 HERMES 실행은 not_run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const hermes={bodies:[],runs:new Map(),mode:'good',submitFail:0,seq:0};
const outputFor=mode=>mode==='good'?'봄 한정 딸기 도넛이 나왔어요.':mode==='fenced'?'```\n수정본: "짧게 쓴 글"\n```':mode==='empty'?'   ':'';
const rt=testRuntime(async(url,init={})=>{
 url=String(url);
 if(!url.startsWith('https://hermes.example.com/'))throw new Error('모의 주소만: '+url);
 if(url.endsWith('/v1/runs')&&init.method==='POST'){if(hermes.submitFail>0){hermes.submitFail--;return new Response('{}',{status:503})}const id='rw_'+ ++hermes.seq;hermes.bodies.push(String(init.body));hermes.runs.set(id,hermes.mode);return Response.json({run_id:id})}
 const id=url.split('/').pop(),mode=hermes.runs.get(id);
 if(mode==='fail')return Response.json({object:'hermes.run',run_id:id,status:'failed',error:'합성 실패',usage:{total_tokens:10}});
 if(mode==='slow')return Response.json({object:'hermes.run',run_id:id,status:'running'});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:outputFor(mode),usage:{total_tokens:90},model:'mock-model'});
});
const {sql,env,load}=rt;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const server=await load('lib/server.ts'),route=await load('app/api/rewrite/route.ts'),flags=await load('lib/feature-flags.ts'),budget=await load('lib/token-budget.ts'),pure=await load('lib/rewrite-request.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const WS='rw-owner';
const far=()=>Date.now()+100*365*86400000;
const signIn=(id,role)=>{
 const token=createHash('sha256').update('rw-session:'+id).digest('hex');
 sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',WS,role,'active',1000);
 sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,far(),Date.now());
 return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'};
};
const boss=signIn('rw-boss','admin'),member=signIn('rw-member','member');
const call=async res=>({status:res.status,body:await res.json()});
const post=(session,input)=>route.POST(new Request('https://agency.test/api/rewrite',{method:'POST',headers:{'content-type':'application/json',...session},body:JSON.stringify(input)})).then(call);
const get=session=>route.GET(new Request('https://agency.test/api/rewrite',{headers:session})).then(call);
const by={id:'rw-boss',email:null};
const CAMPAIGN='rw-campaign';
await server.recordStatement(WS,'campaign',CAMPAIGN,{id:CAMPAIGN,brandId:'ofd',title:'다시 쓰기 캠페인',goal:'시험',status:'draft',version:1,createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z'}).run();
await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(WS,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES','2026-11-01T00:00:00.000Z');
const SELECTION='봄 신메뉴 딸기 도넛을 지금 바로 만나 보세요.';
const start=(id,extra={})=>post(boss,{action:'start',id,campaignId:CAMPAIGN,mode:'rewrite',selection:SELECTION,context:'대표 메뉴: 딸기 도넛',...extra});
const rows=kind=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=?').all(WS,kind).map(r=>JSON.parse(r.data));

// ── 1) 순수 검사 ──
const bad=input=>{try{pure.parseRewriteInput(input);return ''}catch(e){return e.name==='RewriteInputError'?e.message:'other'}};
const base={id:'rw-abcdef',campaignId:CAMPAIGN,mode:'rewrite',selection:'글'};
{const parsed=plain(pure.parseRewriteInput(base));check('valid input parses with default channel instagram',parsed.channel==='instagram'&&parsed.context===''&&parsed.selection==='글'&&parsed.mode==='rewrite'&&!('tone' in parsed))}
check('unknown mode is rejected',/하나를 고르세요/.test(bad({...base,mode:'expand'})));
check('tone mode requires a known tone',/톤/.test(bad({...base,mode:'tone'}))&&/톤/.test(bad({...base,mode:'tone',tone:'loud'}))&&pure.parseRewriteInput({...base,mode:'tone',tone:'friendly'}).tone==='friendly');
check('tone outside tone mode is rejected',/톤 바꾸기에서만/.test(bad({...base,tone:'firm'})));
check('empty selection is rejected',/먼저 고르세요/.test(bad({...base,selection:'   '})));
check('selection over 2,000 characters is rejected',/2,000자/.test(bad({...base,selection:'가'.repeat(2001)})));
check('bad request ids are rejected',/번호/.test(bad({...base,id:'x'}))&&/번호/.test(bad({...base,id:'rw-../../a'})));
check('unknown channel is rejected',/채널/.test(bad({...base,channel:'tiktok'})));
const sub=pure.rewriteSubmission({mode:'shorten',channel:'instagram',selection:SELECTION,context:'앞뒤'});
check('submission carries only the selection, context and task',JSON.stringify(Object.keys(JSON.parse(sub.input)))==='["channel","task","selection","context"]'&&/짧게 줄인다/.test(sub.instructions)&&/더하지 않는다/.test(sub.instructions));
check('token estimate adds the output allowance',pure.estimateRewriteTokens({mode:'rewrite',channel:'instagram',selection:SELECTION,context:''})>pure.REWRITE_OUTPUT_ALLOWANCE);
check('output cleanup strips fences, prefixes and quotes',pure.parseRewriteOutput('```\n수정본: "짧게 쓴 글"\n```')==='짧게 쓴 글'&&pure.parseRewriteOutput('  ')===null&&pure.parseRewriteOutput(7)===null&&pure.parseRewriteOutput('가'.repeat(7000))===null);
check('splice replaces only a matching range',pure.spliceSelection('앞 고른 뒤',{start:2,end:4,selection:'고른'},'바꾼')==='앞 바꾼 뒤'&&pure.spliceSelection('앞 고른 뒤',{start:0,end:2,selection:'고른'},'x')===null);
check('labels read in Korean',pure.rewriteLabel('tone','firm')==='톤 바꾸기(단정하게)'&&pure.rewriteLabel('shorten')==='줄이기');

// ── 2) 스위치 꺼짐·권한 ──
let r=await get(boss);
check('GET reports the switch off and that an admin can request',r.status===200&&r.body.enabled===false&&r.body.canRequest===true);
check('GET tells a member they cannot request',(await get(member)).body.canRequest===false);
r=await start('rw-flagoff1');
check('start is 409 while the switch is off and nothing is sent',r.status===409&&/스위치가 꺼져/.test(r.body.error)&&hermes.bodies.length===0&&rows('rewrite_request').length===0);
check('poll and decide are 409 while off',(await post(boss,{action:'poll',id:'rw-flagoff1',campaignId:CAMPAIGN})).status===409&&(await post(boss,{action:'decide',id:'rw-flagoff1',campaignId:CAMPAIGN,decision:'accepted'})).status===409);
await flags.setFeatureFlag(WS,{flag:'selection_rewrite',enabled:true},by);
r=await post(member,{action:'start',id:'rw-member01',campaignId:CAMPAIGN,mode:'rewrite',selection:SELECTION});
check('a member is 403',r.status===403&&hermes.bodies.length===0);
r=await route.POST(new Request('https://agency.test/api/rewrite',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).then(call);
check('no session is 401',r.status===401);
r=await post(boss,{action:'start',id:'rw-badmode',campaignId:CAMPAIGN,mode:'expand',selection:SELECTION});
check('invalid input is 400',r.status===400&&hermes.bodies.length===0);
r=await post(boss,{action:'start',id:'rw-nocamp01',campaignId:'missing',mode:'rewrite',selection:SELECTION});
check('a missing campaign is 404',r.status===404);
check('an unknown action is 400',(await post(boss,{action:'apply'})).status===400);

// ── 3) 자율성 금지 ──
await flags.setFeatureFlag(WS,{flag:'autonomy_rules',enabled:true},by);
await server.recordStatement(WS,'autonomy_settings','current',{id:'current',version:1,settings:{role_run:'never'},updatedAt:'2026-11-01T00:00:00.000Z',updatedBy:null}).run();
r=await start('rw-never001');
check('autonomy never for role runs is 403 and nothing is sent',r.status===403&&hermes.bodies.length===0);
await flags.setFeatureFlag(WS,{flag:'autonomy_rules',enabled:false},by);

// ── 4) 토큰 예산 초과 ──
await budget.setTokenBudget(server.database(),WS,{scope:'workspace',monthlyTokens:10},by);
r=await start('rw-budget01');
check('over the token budget is 409 and the request is not sent',r.status===409&&/토큰 예산 초과/.test(r.body.error)&&hermes.bodies.length===0);
check('the blocked request is recorded as failed with the reason',rows('rewrite_request').find(x=>x.id==='rw-budget01')?.status==='failed');
await budget.setTokenBudget(server.database(),WS,{scope:'workspace',monthlyTokens:null},by);

// ── 5) 시작 → 조회 → 제안 ──
const captionBefore=JSON.stringify(rows('execution_publication'))+JSON.stringify(rows('artifact'));
r=await start('rw-good0001');
check('start queues one HERMES run without leaking the provider id',r.status===200&&r.body.status==='queued'&&!('providerId' in r.body)&&hermes.bodies.length===1);
const sent=JSON.parse(hermes.bodies[0]),sentInput=JSON.parse(sent.input);
check('the HERMES body carries the selection and context only',sentInput.selection===SELECTION&&sentInput.context==='대표 메뉴: 딸기 도넛'&&sentInput.task==='rewrite');
const reservation=sql.prepare("SELECT data FROM records WHERE kind='token_reservation' AND id=?").get(`${WS}:token_reservation:rewrite-rw-good0001`);
check('a token reservation is made for the submission',!!reservation);
check('the same id returns the same request without a second call',(await start('rw-good0001')).body.id==='rw-good0001'&&hermes.bodies.length===1);
r=await start('rw-second01');
check('a second request while one is active is 409',r.status===409&&/처리 중인/.test(r.body.error)&&hermes.bodies.length===1);
check('deciding before completion is 409',(await post(boss,{action:'decide',id:'rw-good0001',campaignId:CAMPAIGN,decision:'accepted'})).status===409);
r=await post(boss,{action:'poll',id:'rw-good0001',campaignId:CAMPAIGN});
check('poll completes with the suggestion',r.status===200&&r.body.status==='completed'&&r.body.suggestion==='봄 한정 딸기 도넛이 나왔어요.'&&r.body.selection===SELECTION);
check('nothing in captions, publications or artifacts changed',JSON.stringify(rows('execution_publication'))+JSON.stringify(rows('artifact'))===captionBefore);
check('poll of another campaign id is 404',(await post(boss,{action:'poll',id:'rw-good0001',campaignId:'other'})).status===404);
check('poll of a malformed id is 400',(await post(boss,{action:'poll',id:'bad',campaignId:CAMPAIGN})).status===400);
check('decide needs accepted or discarded',(await post(boss,{action:'decide',id:'rw-good0001',campaignId:CAMPAIGN,decision:'apply'})).status===400);
r=await post(boss,{action:'decide',id:'rw-good0001',campaignId:CAMPAIGN,decision:'accepted'});
check('accept records the decision once',r.status===200&&r.body.decision==='accepted'&&typeof r.body.decidedAt==='string');
check('a second decision is 409',(await post(boss,{action:'decide',id:'rw-good0001',campaignId:CAMPAIGN,decision:'discarded'})).status===409);
check('a member cannot decide',(await post(member,{action:'decide',id:'rw-good0001',campaignId:CAMPAIGN,decision:'discarded'})).status===403);

// ── 6) 출력 정리·형식 오류·실패 ──
hermes.mode='fenced';
await start('rw-fenced01',{mode:'shorten'});
r=await post(boss,{action:'poll',id:'rw-fenced01',campaignId:CAMPAIGN});
check('fenced output is cleaned into the suggestion',r.body.status==='completed'&&r.body.suggestion==='짧게 쓴 글');
await post(boss,{action:'decide',id:'rw-fenced01',campaignId:CAMPAIGN,decision:'discarded'});
hermes.mode='empty';
await start('rw-empty001',{mode:'tone',tone:'friendly'});
r=await post(boss,{action:'poll',id:'rw-empty001',campaignId:CAMPAIGN});
check('an empty output fails without a suggestion',r.body.status==='failed'&&r.body.suggestion===null&&/저장하지 않았습니다/.test(r.body.error));
hermes.mode='fail';
await start('rw-fail0001');
r=await post(boss,{action:'poll',id:'rw-fail0001',campaignId:CAMPAIGN});
check('a provider failure is failed with a retry note',r.body.status==='failed'&&/다시 요청할 수 있습니다/.test(r.body.error));

// ── 7) 접수 503 → 확인 불가 → 복구 ──
hermes.mode='good';hermes.submitFail=1;
r=await start('rw-flaky001');
check('a 503 on submit leaves the request uncertain',r.status===200&&r.body.status==='uncertain');
r=await post(boss,{action:'poll',id:'rw-flaky001',campaignId:CAMPAIGN});
check('plain poll without a provider id stays uncertain',r.body.status==='uncertain');
r=await post(boss,{action:'poll',id:'rw-flaky001',campaignId:CAMPAIGN,mode:'recover'});
const flakyKey=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='hermes_submission' AND id=?").get(`${WS}:hermes_submission:rewrite-rw-flaky001`).data).key;
check('recover resubmits with the stored idempotency key and completes',r.body.status==='completed'&&JSON.parse(hermes.bodies.at(-1)).session_id===flakyKey);

// ── 8) 중지 ──
hermes.mode='slow';
await start('rw-slow0001');
check('a running request polls as in progress',(await post(boss,{action:'poll',id:'rw-slow0001',campaignId:CAMPAIGN})).body.status==='in_progress');
console.log(JSON.stringify({passed:passed.length}));
