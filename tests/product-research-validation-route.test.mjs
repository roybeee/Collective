import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
let failAudit=false,raceCas=false;
const rt=testRuntime(async()=>{throw new Error('network forbidden')},{beforeRun:s=>{
 if(failAudit&&s.query.startsWith('INSERT INTO records')&&s.values[2]==='pr_validation_audit')throw new Error('injected audit failure');
 if(raceCas&&s.query.startsWith('UPDATE records SET data=')){raceCas=false;rt.sql.prepare("UPDATE records SET data=json_set(data,'$.version',100) WHERE kind='pr_validation'").run()}
}});
const route=await rt.load('app/api/product-research/validation/route.ts');
const server=await rt.load('lib/product-research/server-validation.ts');
const owner='validation-api',headers={'oai-authenticated-user-id':owner,origin:'https://agency.test','content-type':'application/json'};
const post=(b,h=headers)=>route.POST(new Request('https://agency.test/api/product-research/validation',{method:'POST',headers:h,body:JSON.stringify(b)}));
const req=()=>({requestId:crypto.randomUUID(),expectedVersion:0,section:'legal',entries:[]});
let passed=0;const check=(x,m)=>{assert.ok(x,m);passed++};
check((await route.GET(new Request('https://agency.test/api/product-research/validation',{headers}))).status===200,'GET available flags OFF');
check((await post(req(),{...headers,origin:'https://evil.test'})).status===403,'CSRF fails');
check((await post({...req(),entries:null})).status===400,'invalid shape fails');
check((await route.POST(new Request('https://agency.test/api/product-research/validation',{method:'POST',headers,body:'{'}))).status===400,'invalid JSON fails');
check((await post({...req(),padding:'x'.repeat(500001)})).status===413,'body bounded');
const first=req();check((await post(first)).status===200,'save succeeds');
check((await post(first)).status===200,'idempotent API retry');
check((await post(req())).status===409,'stale API CAS');
failAudit=true;
const actor={owner,id:owner,role:'owner',email:null};
await assert.rejects(()=>server.saveValidation(actor,{...req(),expectedVersion:1}));passed++;
failAudit=false;
check((await server.validationView(actor)).version===1&&rt.sql.prepare("SELECT count(*) n FROM records WHERE kind='pr_validation_audit'").get().n===1,'audit failure rolls back state and receipt');
raceCas=true;
await assert.rejects(()=>server.saveValidation(actor,{...req(),expectedVersion:1}),e=>e.status===409);passed++;
check(rt.sql.prepare("SELECT count(*) n FROM records WHERE kind='pr_validation_audit'").get().n===1,'losing SQL CAS writes no audit');
rt.env.AUTH_MODE='email';rt.env.AUTH_ORIGIN='https://agency.test';
rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(owner,'owner@test.invalid',owner,'admin','active',0);
for(const role of ['admin','member']){
 const id=`validation-${role}`,token=createHash('sha256').update(id).digest('hex');
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,`${role}@test.invalid`,owner,role,'active',1);
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
 const h={origin:'https://agency.test',cookie:'__Host-collective_session='+token};
 check((await post(req(),h)).status===403,`${role} write denied`);
 check((await route.GET(new Request('https://agency.test/api/product-research/validation',{headers:h}))).status===403,`${role} read denied`);
}
console.log(JSON.stringify({passed,sqlite:'real',provider:'not_called'}));
