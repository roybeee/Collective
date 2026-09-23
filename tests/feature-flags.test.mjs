// 서버 기능 스위치(F2a): 알려진 플래그·기본값(off)·소유자 범위 저장·캐시 없는 즉시 반영·소유자 전용 쓰기.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const {sql,env,load}=testRuntime(async url=>{throw new Error('외부 호출 금지: '+url)});
const flags=await load('lib/feature-flags.ts'),route=await load('app/api/feature-flags/route.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const owner='flag-owner',other='flag-other';
const known=['online_grading','b1_reason_required','a4_auto_attribution','a2_downgrade'];

// 1) 알려진 플래그와 기본값은 코드 상수다. 저장된 값이 없으면 모두 꺼져 있다.
const catalog=JSON.parse(JSON.stringify(flags.FEATURE_FLAGS));
check('the four known flags are declared in code',known.every(f=>f in catalog)&&Object.keys(catalog).length===known.length);
check('every known flag defaults to off',known.every(f=>catalog[f].defaultEnabled===false));
check('every flag is described in Korean',known.every(f=>/[가-힣]/.test(catalog[f].description)));
for(const f of known)check(`${f} reads its default without a stored row`,await flags.isEnabled(owner,f)===false);
await assert.rejects(()=>flags.isEnabled(owner,'unknown_flag'),e=>e.status===400);passed.push('reading an unknown flag is a 400');

// 2) 쓰기는 소유자 범위이고 캐시 없이 다음 읽기부터 반영된다(게시 불필요).
const by={id:'owner-account',email:null};
await flags.setFeatureFlag(owner,{flag:'online_grading',enabled:true},by);
check('owner write turns the flag on',await flags.isEnabled(owner,'online_grading')===true);
check('another owner keeps the default',await flags.isEnabled(other,'online_grading')===false);
check('other flags are untouched',await flags.isEnabled(owner,'a4_auto_attribution')===false);
await flags.setFeatureFlag(owner,{flag:'online_grading',enabled:false},by);
check('turning off applies on the very next read (no cache)',await flags.isEnabled(owner,'online_grading')===false);
check('stored row keeps who changed it and when',(()=>{const row=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='feature_flag' AND id=?").get(owner,`${owner}:feature_flag:online_grading`).data);return row.updatedBy.id==='owner-account'&&Number.isFinite(Date.parse(row.updatedAt))&&row.enabled===false})());
await assert.rejects(()=>flags.setFeatureFlag(owner,{flag:'made_up',enabled:true},by),e=>e.status===400);passed.push('unknown flag write is a 400');
await assert.rejects(()=>flags.setFeatureFlag(owner,{flag:'a2_downgrade',enabled:'yes'},by),e=>e.status===400);passed.push('non-boolean value is a 400');
check('rejected writes leave no row',sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='feature_flag' AND json_extract(data,'$.flag') IN ('made_up','a2_downgrade')").get().n===0);
await flags.setFeatureFlag(owner,{flag:'a2_downgrade',enabled:true},by);
await flags.resetFeatureFlag(owner,{flag:'a2_downgrade'});
check('reset returns to the code default',await flags.isEnabled(owner,'a2_downgrade')===false&&sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='feature_flag' AND id=?").get(owner,`${owner}:feature_flag:a2_downgrade`).n===0);
const listed=JSON.parse(JSON.stringify(await flags.listFeatureFlags(owner)));
check('list shows every known flag with source',listed.length===known.length&&listed.find(f=>f.flag==='online_grading').source==='override'&&listed.find(f=>f.flag==='a2_downgrade').source==='default');
// 저장소에 코드에서 사라진 플래그가 남아 있어도 목록·읽기에 나타나지 않는다.
sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:feature_flag:retired_flag`,owner,'feature_flag','',JSON.stringify({flag:'retired_flag',enabled:true}),new Date().toISOString());
check('stale stored flags are ignored',(await flags.listFeatureFlags(owner)).every(f=>f.flag!=='retired_flag'));

// 3) HTTP: 읽기는 로그인한 모든 역할, 쓰기는 소유자만. 다른 출처 403, 비로그인 401.
const call=async res=>({status:res.status,body:await res.json()});
const get=(headers)=>route.GET(new Request('https://agency.test/api/feature-flags',{headers})).then(call);
const post=(input,headers)=>route.POST(new Request('https://agency.test/api/feature-flags',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})).then(call);
let r=await get({'oai-authenticated-user-id':owner});
check('legacy owner reads the flag list',r.status===200&&r.body.flags.length===known.length);
r=await post({action:'set',flag:'b1_reason_required',enabled:true},{'oai-authenticated-user-id':owner,origin:'https://agency.test'});
check('legacy owner turns a flag on through the API',r.status===200&&r.body.flag.enabled===true&&await flags.isEnabled(owner,'b1_reason_required')===true);
r=await post({action:'set',flag:'b1_reason_required',enabled:false},{'oai-authenticated-user-id':owner,origin:'https://agency.test'});
check('the API turns it off again without publishing',r.status===200&&await flags.isEnabled(owner,'b1_reason_required')===false);
r=await post({action:'set',flag:'nope',enabled:true},{'oai-authenticated-user-id':owner,origin:'https://agency.test'});
check('unknown flag over HTTP is a 400',r.status===400);
r=await post({action:'toggle',flag:'a2_downgrade'},{'oai-authenticated-user-id':owner,origin:'https://agency.test'});
check('unknown action is a 400',r.status===400);
r=await post({action:'set',flag:'a2_downgrade',enabled:true},{'oai-authenticated-user-id':owner,origin:'https://evil.test'});
check('cross-origin write is a 403',r.status===403&&await flags.isEnabled(owner,'a2_downgrade')===false);
r=await get({});
check('unauthenticated read is a 401',r.status===401);

env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('ws-owner','admin',1000,owner),adminS=signIn('ws-admin','admin',2000,owner),memberS=signIn('ws-member','member',500,owner);
const set=s=>post({action:'set',flag:'a4_auto_attribution',enabled:true},s);
const [anonPost,memberPost,adminPost,memberGet]=await Promise.all([set({origin:'https://agency.test'}),set(memberS),set(adminS),get(memberS)]);
check('unauthenticated write is a 401',anonPost.status===401);
check('member and admin writes are 403',memberPost.status===403&&adminPost.status===403&&await flags.isEnabled(owner,'a4_auto_attribution')===false);
check('member reads flags without the audit author',memberGet.status===200&&memberGet.body.flags.every(f=>!('updatedBy' in f)));
r=await set(ownerS);
check('workspace owner writes',r.status===200&&await flags.isEnabled(owner,'a4_auto_attribution')===true);
r=await get(ownerS);
check('owner sees who changed a flag',r.body.flags.find(f=>f.flag==='a4_auto_attribution').updatedBy.id==='ws-owner');

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
