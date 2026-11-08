// G3 자율성 규칙: 순수 평가 행렬(10 행동 × 3 모드, 고위험 auto 거부), 스위치 꺼짐=모두 ask, API(GET/PUT 권한·검증·출처), 4개 라우트의 never→403 가드와 auto 표시.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입, fetch 스텁). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const {sql,env,load}=testRuntime(async url=>{throw new Error('외부 호출 금지: '+url)});
const pure=await load('lib/autonomy.ts'),server=await load('lib/autonomy-server.ts'),flags=await load('lib/feature-flags.ts'),core=await load('lib/server.ts');
const route=await load('app/api/autonomy/route.ts'),meetings=await load('app/api/meetings/route.ts'),run=await load('app/api/run/route.ts'),execution=await load('app/api/execution/route.ts'),meta=await load('app/api/meta-ads/execution/route.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const owner='auto-owner';
const actions=[...pure.AUTONOMY_ACTIONS],modes=[...pure.AUTONOMY_MODES],high=['publish_submit','ad_activate','budget_change','customer_send','policy_change'];

// 1) 순수 행렬: 고위험 5개는 auto 거부(한국어 사유), 그 밖 25개 조합은 저장·평가가 그대로다.
check('ten actions and three modes are declared',actions.length===10&&modes.join()==='auto,ask,never');
check('defaults are ask for every action',actions.every(a=>pure.defaultAutonomySettings()[a]==='ask'));
check('tier mapping reuses T0~T4 and puts exactly five actions at T3 or above',actions.filter(a=>pure.isHighTier(a)).join()===high.join()&&pure.AUTONOMY_TIERS.policy_change==='T4'&&pure.AUTONOMY_TIERS.research_run==='T0');
let accepted=0,rejected=0;
for(const action of actions)for(const mode of modes){
 let settings=null,error=null;
 try{settings=pure.parseAutonomySettings({[action]:mode})}catch(e){error=e}
 if(high.includes(action)&&mode==='auto'){assert.ok(error&&/자동으로 실행할 수 없습니다/.test(error.message),`${action} auto rejected`);rejected++;continue}
 assert.ok(!error&&settings[action]===mode,`${action} ${mode} accepted`);
 const decision=pure.evaluateAutonomy(settings,action,{enabled:true});
 assert.equal(decision.mode,mode,`${action} ${mode} evaluated`);assert.equal(decision.tier,pure.AUTONOMY_TIERS[action]);assert.ok(/[가-힣]/.test(decision.reason));
 assert.equal(pure.evaluateAutonomy(settings,action,{enabled:false}).mode,'ask',`${action} ${mode} is ask when the switch is off`);
 accepted++;
}
check('matrix: 25 accepted combinations and 5 rejected high-tier auto settings',accepted===25&&rejected===5);
check('unknown action and unknown mode are rejected',(()=>{try{pure.parseAutonomySettings({fly:'auto'});return false}catch(e){return /알 수 없는 행동/.test(e.message)}})()&&(()=>{try{pure.parseAutonomySettings({role_run:'maybe'});return false}catch(e){return /모드는/.test(e.message)}})());
check('partial input keeps the base for the other actions',(()=>{const s=pure.parseAutonomySettings({role_run:'auto'},{...pure.defaultAutonomySettings(),meeting_start:'never'});return s.role_run==='auto'&&s.meeting_start==='never'&&s.brief_draft==='ask'})());
check('a corrupt stored high-tier auto reads back as ask',pure.sanitizeAutonomySettings({publish_submit:'auto',role_run:'auto',junk:1}).publish_submit==='ask'&&pure.sanitizeAutonomySettings({publish_submit:'auto',role_run:'auto'}).role_run==='auto');
check('never is the only blocking decision',pure.autonomyBlocked(pure.evaluateAutonomy({...pure.defaultAutonomySettings(),role_run:'never'},'role_run'))&&!pure.autonomyBlocked(pure.evaluateAutonomy(null,'role_run')));
check('action infos carry a disabled reason only for high tiers',pure.autonomyActionInfos().every(i=>(i.disabledReason!==null)===high.includes(i.action)&&(high.includes(i.action)?i.allowedModes.join()==='ask,never':i.allowedModes.length===3)));

// 2) 서버 읽기·쓰기는 스위치와 무관, 평가는 스위치가 켜졌을 때만 저장값을 쓴다.
const who={owner,id:'owner-account',email:null,role:'owner'};
check('empty record reads as defaults with version 0',plain(await server.readAutonomyRecord(owner)).version===0);
let view=plain(await server.saveAutonomySettings(who,{settings:{meeting_start:'never',role_run:'auto'}}));
check('owner write stores a new version',view.version===1&&view.settings.meeting_start==='never'&&view.settings.role_run==='auto'&&view.updatedBy==='owner-account');
check('switch off: evaluation is ask even though never is stored',(await server.evaluateAutonomyFor(owner,'meeting_start')).mode==='ask'&&(await server.assertAutonomy(owner,'meeting_start')).mode==='ask');
await flags.setFeatureFlag(owner,{flag:'autonomy_rules',enabled:true},{id:'owner-account',email:null});
check('switch on: never blocks with a 403 and the Korean reason',await server.assertAutonomy(owner,'meeting_start').then(()=>false,e=>e.status===403&&/금지되어/.test(e.message)));
check('switch on: auto is returned for a low tier',(await server.assertAutonomy(owner,'role_run')).mode==='auto');
await assert.rejects(()=>server.saveAutonomySettings(who,{settings:{publish_submit:'auto'}}),e=>e.status===400&&/자동으로 실행할 수 없습니다/.test(e.message));passed.push('server rejects high-tier auto with 400');
await assert.rejects(()=>server.saveAutonomySettings(who,{settings:{role_run:'ask'},expectedVersion:0}),e=>e.status===409);passed.push('stale expectedVersion is a 409');
await assert.rejects(()=>server.saveAutonomySettings({...who,role:'member'},{settings:{role_run:'ask'}}),e=>e.status===403);passed.push('member write is a 403');
const ok=new Response(JSON.stringify({id:'m1'}),{status:200,headers:{'content-type':'application/json'}});
check('markAutonomy adds autonomy:auto to a successful JSON response',(await (await server.markAutonomy(ok,{mode:'auto'})).json()).autonomy==='auto');
const bad=new Response(JSON.stringify({error:'x'}),{status:409,headers:{'content-type':'application/json'}});
check('markAutonomy leaves failures and ask decisions untouched',(await server.markAutonomy(bad,{mode:'auto'}))===bad&&(await server.markAutonomy(ok,{mode:'ask'}))===ok&&(await server.markAutonomy(ok,null))===ok);

// 3) HTTP: 읽기는 로그인한 모든 역할, PUT은 소유자·관리자만. 다른 출처 403, 비로그인 401, 검증 400.
const call=async res=>({status:res.status,body:await res.json()});
const get=headers=>route.GET(new Request('https://agency.test/api/autonomy',{headers})).then(call);
const put=(input,headers)=>route.PUT(new Request('https://agency.test/api/autonomy',{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})).then(call);
const legacy={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
let r=await get(legacy);
check('legacy owner reads settings, actions and the enabled state',r.status===200&&r.body.enabled===true&&r.body.actions.length===10&&r.body.settings.meeting_start==='never'&&r.body.canEdit===true);
r=await put({settings:{brief_draft:'auto'}},legacy);
check('legacy owner writes through the API',r.status===200&&r.body.settings.brief_draft==='auto'&&r.body.version===2);
r=await put({settings:{ad_activate:'auto'}},legacy);
check('high-tier auto over HTTP is a 400 with a Korean reason',r.status===400&&/자동으로 실행할 수 없습니다/.test(r.body.error));
r=await put({settings:'auto'},legacy);
check('non-object settings is a 400',r.status===400);
r=await put({settings:{role_run:'ask'}},{...legacy,origin:'https://evil.test'});
check('cross-origin write is a 403',r.status===403);
check('unauthenticated read is a 401',(await get({})).status===401);

// 4) 라우트 가드: never→403(캠페인·잠금 전), ask→기존 동작, 스위치 꺼짐→기존 동작.
await core.recordStatement(owner,'campaign','c',{id:'c',brandId:'b',version:1,status:'draft',title:'t'}).run();
const post=(mod,input,headers=legacy)=>mod.POST(new Request('https://agency.test/api/x',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})).then(call);
r=await post(meetings,{action:'start',id:'m',campaignId:'c',campaignVersion:1,agenda:'안건'});
check('meeting start is blocked by never with a Korean 403',r.status===403&&/금지되어/.test(r.body.error));
await server.saveAutonomySettings(who,{settings:{role_run:'never',publish_submit:'never',ad_activate:'never'}});
r=await post(run,{action:'start',campaignId:'c',role:'cmo'});
check('role start is blocked by never',r.status===403&&/역할 실행/.test(r.body.error));
r=await post(run,{action:'start_sequence',campaignId:'c'});
check('sequence start is blocked by never',r.status===403);
r=await post(execution,{action:'approve',campaignId:'nope',id:'p',version:1});
check('publication approve is blocked by never before the campaign is read',r.status===403&&/발행 접수/.test(r.body.error));
r=await post(meta,{action:'activate',campaignId:'nope',id:'e',expectedVersion:1});
check('meta activation is blocked by never before the campaign is read',r.status===403&&/광고 활성화/.test(r.body.error));
check('a never rule leaves no lock behind',sql.prepare('SELECT COUNT(*) n FROM mutation_locks WHERE owner=?').get(owner).n===0);
await server.saveAutonomySettings(who,{settings:{role_run:'ask',publish_submit:'ask',ad_activate:'ask',meeting_start:'ask'}});
r=await post(execution,{action:'approve',campaignId:'nope',id:'p',version:1});
check('ask keeps the existing behaviour (404 for a missing campaign)',r.status===404);
await server.saveAutonomySettings(who,{settings:{meeting_start:'never'}});
await flags.setFeatureFlag(owner,{flag:'autonomy_rules',enabled:false},{id:'owner-account',email:null});
r=await post(meetings,{action:'start',id:'m2',campaignId:'c',campaignVersion:1,agenda:'안건'});
check('switch off: a stored never no longer blocks (meeting start reaches the executor)',r.status!==403);

// 5) 이메일 인증: 직원 PUT 403, 관리자 PUT 200, 직원 GET은 변경자 없이 200.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',1000);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const adminS=signIn('ws-admin','admin'),memberS=signIn('ws-member','member');
r=await put({settings:{role_run:'auto'}},memberS);
check('member PUT is a 403',r.status===403);
r=await get(memberS);
check('member GET works without the author and without edit rights',r.status===200&&r.body.updatedBy===null&&r.body.canEdit===false);
r=await put({settings:{role_run:'auto'}},adminS);
check('admin PUT works and records the actor',r.status===200&&r.body.updatedBy==='ws-admin');
check('unauthenticated PUT is a 401',(await put({settings:{}},{origin:'https://agency.test'})).status===401);

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
