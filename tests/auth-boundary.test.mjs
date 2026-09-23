import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const runtime=testRuntime(async()=>{throw new Error('No external calls expected');});
const server=await runtime.load('lib/server.ts');
const workspace=await runtime.load('app/api/workspace/route.ts');
let passed=0;
const request=(headers={})=>new Request('https://agency.test/api/workspace',{headers:{'oai-authenticated-user-id':'forged-owner',...headers}});
runtime.env.AUTH_MODE='email';
runtime.env.AUTH_ORIGIN='https://agency.test';
await assert.rejects(async()=>server.identity(request()),error=>error.status===401);passed++;
await assert.rejects(async()=>server.requireAdmin(request()),error=>error.status===401);passed++;
await assert.rejects(async()=>server.actor(request()),error=>error.status===401);passed++;
assert.throws(()=>server.secureMutation(request()),error=>error.status===403);passed++;
server.secureMutation(new Request('https://agency.test/api/action',{headers:{origin:'https://agency.test'}}));passed++;

// 소유자는 저장하지 않고 계산한다: 같은 workspace_owner의 관리자 중 가장 먼저 만든 계정이다.
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');runtime.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid','workspace',role,'active',createdAt);runtime.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return request({cookie:'__Host-collective_session='+token});};
const owner=signIn('first-admin','admin',1000),admin=signIn('later-admin','admin',2000),member=signIn('staff','member',500);
assert.deepEqual({...await server.actor(owner)},{owner:'workspace',id:'first-admin',email:'first-admin@test.invalid',role:'owner'});passed++;
assert.equal((await server.actor(admin)).role,'admin');passed++;
assert.equal((await server.actor(member)).role,'member');passed++;
assert.equal((await server.requireAdminActor(admin)).id,'later-admin');passed++;
assert.equal((await server.requireAdminActor(owner)).role,'owner');passed++;
await assert.rejects(async()=>server.requireAdminActor(member),error=>error.status===403&&error.message==='관리자만 변경할 수 있습니다.');passed++;
await assert.rejects(async()=>server.requireOwnerActor(admin),error=>error.status===403);passed++;
assert.equal((await server.requireOwnerActor(owner)).id,'first-admin');passed++;
assert.equal(await server.requireAdmin(owner),'workspace');passed++;
assert.equal(await server.isAdmin(owner),true);passed++;
assert.equal(await server.isAdmin(member),false);passed++;
await assert.rejects(async()=>server.requireAdmin(member),error=>error.status===403);passed++;
runtime.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('tie-a','tie-a@test.invalid','tied','admin','active',1);
runtime.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('tie-b','tie-b@test.invalid','tied','admin','active',1);
const {roleSql}=await runtime.load('lib/auth-session.ts');
assert.deepEqual(runtime.sql.prepare(`SELECT id,${roleSql('u')} AS role FROM auth_users u WHERE workspace_owner='tied' ORDER BY id`).all().map(r=>r.role),['owner','admin']);passed++;

// 이벤트는 선택 인자로 행위자를 남기고, 기존 호출은 그대로 동작한다.
await server.eventStatement('workspace','c1','승인했습니다.',{id:'first-admin',email:'first-admin@test.invalid'}).run();
await server.eventStatement('workspace','c1','기존 호출').run();
const events=runtime.sql.prepare("SELECT data FROM records WHERE kind='event' ORDER BY rowid").all().map(r=>JSON.parse(r.data));
assert.deepEqual(events[0].actor,{id:'first-admin',email:'first-admin@test.invalid'});passed++;
assert.equal('actor' in events[1],false);passed++;

// legacy는 명시해야 열린다. 헤더 id가 곧 소유자다.
runtime.env.AUTH_MODE='legacy';
assert.equal(await server.identity(request()),'forged-owner');passed++;
assert.deepEqual({...await server.actor(request())},{owner:'forged-owner',id:'forged-owner',email:null,role:'owner'});passed++;
assert.equal((await server.requireOwnerActor(request())).owner,'forged-owner');passed++;

// AUTH_MODE 미설정: 운영 빌드에서는 업무 API가 503으로 닫히고, 개발 서버에서만 legacy를 허용한다.
delete runtime.env.AUTH_MODE;
await assert.rejects(async()=>server.identity(request()),error=>error.status===503);passed++;
await assert.rejects(async()=>server.actor(request()),error=>error.status===503);passed++;
const closed=await workspace.GET(request());
assert.equal(closed.status,503);passed++;
assert.equal(JSON.stringify(await closed.json()).includes('forged-owner'),false);passed++;
runtime.processEnv.NODE_ENV='development';
assert.equal(await server.identity(request()),'forged-owner');passed++;
runtime.processEnv.NODE_ENV='production';
console.log(JSON.stringify({passed}));
