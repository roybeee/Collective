import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {SourceTextModule, SyntheticModule, createContext} from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import ts from 'typescript';

const outcomes=[];
async function test(name, run){try{await run();outcomes.push({name,passed:true})}catch(error){outcomes.push({name,passed:false});console.error(name,error.message)}}
const state={registered:0,revoked:0,dbCalls:0,secret:null,sessions:new Map(),audit:[]};
const runtime={
 AUTH_MODE:'legacy',
 AGENCY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),
 DB:{prepare(query){
  state.dbCalls++;
  return {
   values:[],
   bind(...values){this.values=values;return this},
   async run(){return {meta:{changes:1}}},
   async all(){return {results:query.includes('FROM records')&&this.values[1]==='worker_event'?state.audit.map(values=>({data:values[4]})).reverse():[]}},
   async first(){return query.startsWith('SELECT secret,model')?{secret:state.secret,model:'test'}:query.includes('FROM auth_sessions')?state.sessions.get(this.values[0])||null:null},
  };
 }},
};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,ReadableStream,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,process:{env:{NODE_ENV:'production'}}});
const modules=new Map();
const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
const workerModule=new SyntheticModule(['workerStatus','registerWorker','revokeWorker'],function(){
 this.setExport('workerStatus',async()=>({registered:true,activated:false}));
 this.setExport('registerWorker',async(owner,audit=[])=>{state.registered++;state.audit.push(...audit.map(s=>s.values));return 'owner-scoped-test-token'});
 this.setExport('revokeWorker',async(owner,audit=[])=>{state.revoked++;state.audit.push(...audit.map(s=>s.values))});
},{context:ctx});
function moduleFor(file){
 file=resolve(file);if(modules.has(file))return modules.get(file);
 const raw=file.endsWith('?raw');
 const vmModule=raw?new SyntheticModule(['default'],function(){this.setExport('default',readFileSync(file.slice(0,-4),'utf8'))},{context:ctx}):new SourceTextModule(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context:ctx,identifier:file});
 modules.set(file,vmModule);return vmModule;
}
async function load(file){
 const vmModule=moduleFor(file);
 if(vmModule.status==='unlinked')await vmModule.link((spec,ref)=>{
  if(spec==='cloudflare:workers')return envModule;
  if(spec==='@/lib/research-worker')return workerModule;
  const path=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);
  return moduleFor(path.endsWith('.ts')||path.endsWith('?raw')?path:path+'.ts');
 });
 if(vmModule.status==='linked')await vmModule.evaluate();return vmModule.namespace;
}
const server=await load('lib/server.ts');
const request=(body,headers={})=>new Request('https://agency.test/api/action',{method:'POST',headers,body});
await test('JSON size is bounded by UTF-8 bytes, not characters',async()=>{
 await assert.rejects(server.body(request(JSON.stringify({text:'가'.repeat(70000)}))),e=>e.status===413);
});
await test('small valid JSON remains supported',async()=>assert.equal((await server.body(request('{"value":1}'))).value,1));
for(const payload of ['null','[]','1','"text"'])await test('reject non-object JSON: '+payload,async()=>{
 await assert.rejects(server.body(request(payload)),e=>e.status===400);
});
await test('malformed JSON returns 400',async()=>assert.rejects(server.body(request('{broken')),e=>e.status===400));
await test('oversized unknown-length request cancels before draining',async()=>{
 let pulls=0,cancelled=false;
 const stream=new ReadableStream({pull(controller){pulls++;if(pulls>10)controller.close();else controller.enqueue(new Uint8Array(100000).fill(32))},cancel(){cancelled=true}},{highWaterMark:0});
 await assert.rejects(server.body(new Request('https://agency.test/api/action',{method:'POST',body:stream,duplex:'half'})),e=>e.status===413);
 assert.equal(cancelled,true);assert.equal(pulls,3);
});
await test('production identity rejects missing header',async()=>assert.rejects(()=>server.identity(new Request('https://agency.test')),e=>e.status===401));
await test('production identity bounds header length',async()=>assert.rejects(()=>server.identity(new Request('https://agency.test',{headers:{'oai-authenticated-user-id':'a'.repeat(201)}})),e=>e.status===401));
await test('production identity rejects control characters',async()=>assert.rejects(()=>server.identity(new Request('https://agency.test',{headers:{'oai-authenticated-user-id':'owner\tother'}})),e=>e.status===401));
await test('trusted owner header is preserved',async()=>assert.equal(await server.identity(new Request('https://agency.test',{headers:{'oai-authenticated-user-id':'owner-123'}})),'owner-123'));

await test('bounded response accepts JSON exactly at byte limit',async()=>{
 const limits=await load('lib/http-limits.ts');const body='{"value":"가"}';
 assert.equal((await limits.readBoundedJson(new Response(body),new TextEncoder().encode(body).length)).value,'가');
});
await test('UTF-8 sequences split across chunks retain their value',async()=>{
 const limits=await load('lib/http-limits.ts');const bytes=new TextEncoder().encode('{"value":"가"}');let offset=0;
 const source=new Response(new ReadableStream({pull(controller){if(offset===bytes.length)controller.close();else controller.enqueue(bytes.slice(offset,++offset))}},{highWaterMark:0}));
 assert.equal((await limits.readBoundedJson(source,bytes.length)).value,'가');
});
await test('bounded response rejects content-length before read',async()=>{
 const limits=await load('lib/http-limits.ts');let cancelled=false;
 const source=new Response(new ReadableStream({cancel(){cancelled=true}},{highWaterMark:0}),{headers:{'Content-Length':'101'}});
 await assert.rejects(limits.readBoundedText(source,100),e=>e.status===413);assert.equal(cancelled,true);
});
await test('bounded response cancels unknown-length overflow',async()=>{
 const limits=await load('lib/http-limits.ts');let cancelled=false,pulls=0;
 const source=new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(51))},cancel(){cancelled=true}},{highWaterMark:0}));
 await assert.rejects(limits.readBoundedText(source,100),e=>e.status===413);assert.equal(cancelled,true);assert.equal(pulls,2);
});
await test('declared overflow stays 413 when stream cancellation rejects',async()=>{
 const limits=await load('lib/http-limits.ts');
 const source=new Response(new ReadableStream({cancel(){throw new Error('private cancellation failure')}},{highWaterMark:0}),{headers:{'Content-Length':'101'}});
 await assert.rejects(limits.readBoundedText(source,100),e=>e.status===413&&!e.message.includes('private'));
 assert.equal(source.body.locked,false);
});
await test('streaming overflow stays 413 when stream cancellation rejects',async()=>{
 const limits=await load('lib/http-limits.ts');
 const source=new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(101))},cancel(){throw new Error('private cancellation failure')}},{highWaterMark:0}));
 await assert.rejects(limits.readBoundedText(source,100),e=>e.status===413&&!e.message.includes('private'));
 assert.equal(source.body.locked,false);
});
await test('input stream read failure becomes a safe 400',async()=>{
 const source=new Request('https://agency.test/api/action',{method:'POST',duplex:'half',body:new ReadableStream({pull(){throw new Error('private stream failure')}},{highWaterMark:0})});
 await assert.rejects(server.body(source),e=>e.status===400&&!e.message.includes('private'));
 assert.equal(source.body.locked,false);
});
await test('bounded JSON reports malformed provider data',async()=>{
 const limits=await load('lib/http-limits.ts');await assert.rejects(limits.readBoundedJson(new Response('not json'),100),e=>e.status===400);
});

const setup=await load('app/api/research-worker/setup/route.ts');
runtime.RESEARCH_WORKER_GATE_TOKEN='common-test-gate';runtime.RESEARCH_WORKER_SITE_ORIGIN='https://agency.test';
state.secret=await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'test-only-key'}));
const setupRequest=(action='download',owner='admin-owner')=>request(JSON.stringify({action}),{'oai-authenticated-user-id':owner});
await test('installer fails closed when admin allowlist is absent',async()=>{
 delete runtime.RESEARCH_WORKER_ADMIN_IDS;const before=state.registered;
 const response=await setup.POST(setupRequest());assert.equal(response.status,403);assert.equal(state.registered,before);assert.ok(!(await response.text()).includes(runtime.RESEARCH_WORKER_GATE_TOKEN));
});
await test('installer denies another owner even with valid connection',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='admin-owner';const before=state.registered;
 const response=await setup.POST(setupRequest('download','other-owner'));assert.equal(response.status,403);assert.equal(state.registered,before);
});
await test('installer allowlist uses exact identities',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='admin-owner';assert.equal((await setup.POST(setupRequest('download','admin'))).status,403);
});
await test('setup status does not offer installer to a non-admin',async()=>{
 const response=await setup.GET(new Request('https://agency.test/api/research-worker/setup',{headers:{'oai-authenticated-user-id':'other-owner'}}));
 assert.equal((await response.json()).canInstall,false);
});
await test('explicit administrator receives private installer',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS=' another-admin, admin-owner ';const response=await setup.POST(setupRequest());
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const source=await response.text();const config=JSON.parse(Buffer.from(source.match(/CONFIG_HEX = '([a-f0-9]+)'/)[1],'hex').toString());
 assert.equal(config.owner,'admin-owner');assert.equal(config.gate,runtime.RESEARCH_WORKER_GATE_TOKEN);
});
await test('owner can revoke own worker without installer privileges',async()=>{
 delete runtime.RESEARCH_WORKER_ADMIN_IDS;const before=state.revoked;
 const response=await setup.POST(setupRequest('revoke','other-owner'));assert.equal(response.status,200);assert.equal(state.revoked,before+1);
});

// 이메일 모드: 같은 워크스페이스(workspace-owner)의 대표·두 번째 관리자·직원. 설치 파일은 개인 단위로 판정한다.
for(const [token,id,role] of [['a','founder-id','owner'],['b','admin-b','admin'],['c','staff-id','member']])state.sessions.set(createHash('sha256').update(token.repeat(64)).digest('hex'),{id,email:id+'@test.invalid',role,owner:'workspace-owner',workspace_owner:'workspace-owner',status:'active'});
const emailRequest=(token,action)=>new Request('https://agency.test/api/research-worker/setup',{method:action?'POST':'GET',headers:{cookie:'__Host-collective_session='+token.repeat(64),origin:'https://agency.test','content-type':'application/json'},...(action?{body:JSON.stringify({action})}:{})});
const emailStatus=async token=>(await setup.GET(emailRequest(token))).json();
runtime.AUTH_MODE='email';runtime.AUTH_ORIGIN='https://agency.test';runtime.RESEARCH_WORKER_SSH_TARGET='deploy@research.example';
await test('email owner keeps installer access through the existing workspace-owner allowlist',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='workspace-owner';assert.equal((await setup.POST(emailRequest('a','download'))).status,200);
 const status=await emailStatus('a');assert.equal(status.canInstall,true);assert.equal(status.sshTarget,'deploy@research.example');
});
await test('second admin in the same workspace cannot download installer',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='workspace-owner';const before=state.registered;
 const response=await setup.POST(emailRequest('b','download'));assert.equal(response.status,403);assert.equal(state.registered,before);assert.ok(!(await response.text()).includes(runtime.RESEARCH_WORKER_GATE_TOKEN));
 const status=await emailStatus('b');assert.equal(status.canInstall,false);assert.equal('sshTarget' in status,false);
});
await test('admin listed by personal user ID receives installer',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='admin-b';assert.equal((await setup.POST(emailRequest('b','download'))).status,200);assert.equal((await emailStatus('b')).canInstall,true);
});
await test('personal allowlist entry does not extend to other workspace admins',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='admin-b';assert.equal((await setup.POST(emailRequest('a','download'))).status,403);assert.equal((await emailStatus('a')).canInstall,false);
});
await test('member cannot download installer or see SSH target even when listed',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='staff-id,workspace-owner';const before=state.registered;
 assert.equal((await setup.POST(emailRequest('c','download'))).status,403);assert.equal(state.registered,before);
 const status=await emailStatus('c');assert.equal(status.canInstall,false);assert.equal('sshTarget' in status,false);assert.equal(typeof status.registered,'boolean');
});
await test('member cannot revoke the workspace worker',async()=>{
 const before=state.revoked;assert.equal((await setup.POST(emailRequest('c','revoke'))).status,403);assert.equal(state.revoked,before);
});
// 연결 해제는 설치 목록과 무관하게 대표·관리자에게 열려 있으므로 화면에도 그 기준(canRevoke)을 내려준다. 발급·해제는 행위자와 함께 기록한다.
await test('unlisted admin may still revoke; member may not',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='workspace-owner';const admin=await emailStatus('b');assert.equal(admin.canInstall,false);assert.equal(admin.canRevoke,true);
 assert.equal((await emailStatus('c')).canRevoke,false);
 const gate=runtime.RESEARCH_WORKER_GATE_TOKEN;delete runtime.RESEARCH_WORKER_GATE_TOKEN;const owner=await emailStatus('a');runtime.RESEARCH_WORKER_GATE_TOKEN=gate;assert.equal(owner.canInstall,false);assert.equal(owner.canRevoke,true);
});
await test('installer issue and worker revoke are recorded with the acting user',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='admin-b';state.audit.length=0;
 assert.equal((await setup.POST(emailRequest('b','download'))).status,200);assert.equal((await setup.POST(emailRequest('a','revoke'))).status,200);
 const events=state.audit.map(values=>({kind:values[2],...JSON.parse(values[4])}));
 assert.deepEqual(events.map(e=>[e.kind,e.action,e.actor.id,e.actor.email]),[['worker_event','download','admin-b','admin-b@test.invalid'],['worker_event','revoke','founder-id','founder-id@test.invalid']]);
 const status=await emailStatus('a');assert.equal(status.lastIssued.email,'admin-b@test.invalid');assert.equal(status.lastRevoked.email,'founder-id@test.invalid');assert.ok(Date.parse(status.lastIssued.at));
 assert.equal('lastIssued' in await emailStatus('c'),false);
 const before=state.audit.length;assert.equal((await setup.POST(emailRequest('c','revoke'))).status,403);assert.equal(state.audit.length,before);
});
await test('malformed or missing SSH target falls back to placeholder',async()=>{
 runtime.RESEARCH_WORKER_ADMIN_IDS='workspace-owner';runtime.RESEARCH_WORKER_SSH_TARGET="deploy@host'; rm -rf ~";assert.equal((await emailStatus('a')).sshTarget,null);
 delete runtime.RESEARCH_WORKER_SSH_TARGET;assert.equal((await emailStatus('a')).sshTarget,null);
});
runtime.AUTH_MODE='legacy';delete runtime.AUTH_ORIGIN;
await test('worker panel and README contain no server address or root login',async()=>{
 for(const file of ['app/research-worker-panel.tsx','server/research-worker/README.md']){const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/\b\d{1,3}(?:\.\d{1,3}){3}\b/,file);assert.doesNotMatch(source,/root@|:\/root\//,file);assert.match(source,/<서버 접속 주소>/,file)}
});
// 공개 저장소의 소스·문서 전체에서 서버 주소를 찾는다. 점 표기 IPv4, 대시 표기(sslip.io·nip.io) 호스트명, root 로그인을 막는다.
// 허용 목록: 루프백·전체 주소와 문서 예시 대역(RFC 5737: 192.0.2.x, 198.51.100.x, 203.0.113.x).
await test('tracked sources and docs contain no server address, sslip host or root login',async()=>{
 const allowed=/^(?:127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.\d{1,3}|198\.51\.100\.\d{1,3}|203\.0\.113\.\d{1,3})$/;
 const files=['README.md','AGENTS.md','prompt_plan.md','.env.example',...['app','lib','server','scripts','docs','e2e'].flatMap(dir=>readdirSync(dir,{recursive:true}).map(f=>dir+'/'+f)).filter(f=>/\.(?:tsx?|mjs|js|md|json|py|css|sh|toml|ya?ml|txt)$/.test(f))];
 assert.ok(files.length>50);
 for(const file of files){const source=readFileSync(file,'utf8');
  for(const address of source.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)||[])assert.match(address,allowed,file);
  assert.doesNotMatch(source,/\b\d{1,3}(?:-\d{1,3}){3}\.(?:sslip|nip)\.io\b/,file);assert.doesNotMatch(source,/root@|:\/root\//,file);
 }
});

async function probeScript(env,status=401){
 let output='',calls=0;
 const context=createContext({URL,Headers,AbortSignal,process:{env,stdout:{write(value){output+=value}}},fetch:async(url,options)=>{
  calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(new URL(url).pathname,'/api/channels');
  return new Response('private-provider-body-do-not-print',{status});
 }});
 const vmModule=new SourceTextModule(readFileSync('scripts/probe-dispatcher-auth.mjs','utf8'),{context});await vmModule.link(()=>{throw new Error('Unexpected import')});await vmModule.evaluate();
 return {output,calls,result:JSON.parse(output),exitCode:context.process.exitCode};
}
await test('production probe cannot run without explicit target',async()=>{
 const result=await probeScript({});assert.equal(result.calls,0);assert.equal(result.result.status,'not_run');
});
await test('production probe rejects targets containing credentials or paths',async()=>{
 const result=await probeScript({COLLECTIVE_PROBE_ORIGIN:'https://user:secret@agency.test/private'});
 assert.equal(result.calls,0);assert.equal(result.result.status,'not_run');assert.ok(!result.output.includes('secret'));
});
await test('production probe records denial without printing response data',async()=>{
 const result=await probeScript({COLLECTIVE_PROBE_ORIGIN:'https://agency.test'});
 assert.equal(result.calls,3);assert.equal(result.result.results.filter(x=>x.status==='passed').length,3);assert.ok(!result.output.includes('private-provider-body'));
 assert.equal(result.result.results.find(x=>x.check==='authenticated_cross_owner_isolation').status,'not_run');
});
await test('production probe cannot call a public 200 response safe',async()=>{
 const result=await probeScript({COLLECTIVE_PROBE_ORIGIN:'https://agency.test'},200);
 assert.equal(result.exitCode,1);assert.equal(result.result.results.filter(x=>x.status==='failed').length,3);assert.ok(!result.output.includes('private-provider-body'));
});
const failed=outcomes.filter(x=>!x.passed);process.stdout.write(JSON.stringify({passed:outcomes.length-failed.length,failed:failed.length})+'\n');process.exitCode=failed.length?1:0;
