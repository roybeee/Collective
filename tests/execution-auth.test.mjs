import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('External calls forbidden in auth regression')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/execution/route.ts'),factRoute=await rt.load('app/api/brand-facts/route.ts');
await server.seedBrands('workspace');
await server.recordStatement('workspace','campaign','c',{id:'c',brandId:'oda',version:1}).run();
for(const [id,role,token] of [['admin','admin','a'.repeat(64)],['member','member','b'.repeat(64)]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid','workspace',role,'active',Date.now());
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
const request=(token,data,origin='https://app.test')=>new Request('https://app.test/api/execution'+(data?'':'?campaignId=c'),{method:data?'POST':'GET',headers:{cookie:'__Host-collective_session='+token,'oai-authenticated-user-id':'forged-workspace',origin,'content-type':'application/json'},...(data?{body:JSON.stringify({campaignId:'c',...data})}:{})});
let passed=0;
for(const action of ['save_limits','connect_buffer','approve','execute','cancel']){assert.equal((await route.POST(request('b'.repeat(64),{action}))).status,403);passed++}
assert.equal((await route.GET(request('b'.repeat(64)))).status,200);passed++;
assert.equal((await route.GET(request('c'.repeat(64)))).status,401);passed++;
assert.equal((await route.POST(request('a'.repeat(64),{action:'save_limits',maxPublications:1,maxPlannedCostKRW:0}))).status,200);passed++;
assert.equal((await route.POST(request('a'.repeat(64),{action:'save_limits',version:1,maxPublications:1,maxPlannedCostKRW:0},'https://evil.test'))).status,403);passed++;
assert.equal((await factRoute.GET(new Request('https://app.test/api/brand-facts?brandId=oda',{headers:{cookie:'__Host-collective_session='+'b'.repeat(64)}}))).status,200);passed++;
console.log(JSON.stringify({passed,evidence:'real SQLite and cookie session lookup; fixture users/sessions; no provider calls'}));
