import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const records=new Map();
globalThis.__hermesTest={
 ApiError:class extends Error{constructor(status,message){super(message);this.status=status}},
 recordStatement:(owner,kind,id,value)=>({run:async()=>records.set(owner+':'+id,value)}),
 readRecord:async(owner,kind,id)=>{if(!records.has(owner+':'+id))throw new Error('not found');return records.get(owner+':'+id)}
};
const source=(await readFile(new URL('../lib/hermes.ts',import.meta.url),'utf8')).replace(/^import .*from '.\/server';/m,'const {ApiError,recordStatement,readRecord}=globalThis.__hermesTest;');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {hermesEndpoint,verifyHermes,submitHermes,pollHermes}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const cfg={provider:'hermes',endpoint:'https://hermes.example.com',key:'test-secret-not-real',model:'HERMES'};
for(const endpoint of ['http://example.com','https://127.0.0.1','https://localhost','https://example.com?key=x','https://x:secret@example.com','https://foo.internal','https://example.com:8080'])assert.throws(()=>hermesEndpoint(endpoint));
assert.equal(hermesEndpoint('https://hermes.example.com/profile/v1/'),'https://hermes.example.com/profile');
const requests=[];let loseAck=true;
globalThis.fetch=async(url,init)=>{requests.push({url,init});assert.ok(url.startsWith(cfg.endpoint));assert.equal(init.redirect,'manual');if(loseAck){loseAck=false;throw new Error('lost acknowledgement')}return Response.json({run_id:'run_123'})};
await assert.rejects(()=>submitHermes('owner','job',cfg,{input:'brief',instructions:'draft only'}));
assert.equal(records.size,1);
assert.equal((await submitHermes('owner','job',cfg)).id,'run_123');
assert.equal(requests[0].init.body,requests[1].init.body);
assert.equal(requests[0].init.headers['Idempotency-Key'],requests[1].init.headers['Idempotency-Key']);
await assert.rejects(()=>submitHermes('other-owner','job',cfg));
let state='running';
globalThis.fetch=async(url,init)=>Response.json({object:'hermes.run',run_id:'run_123',status:state,output:'completed draft'});
assert.equal((await pollHermes(cfg,'run_123')).status,'in_progress');
state='completed';assert.equal((await pollHermes(cfg,'run_123')).output[0].content[0].text,'completed draft');
state='cancelled';assert.equal((await pollHermes(cfg,'run_123',true)).status,'cancelled');
state='unknown';await assert.rejects(()=>pollHermes(cfg,'run_123'));
globalThis.fetch=async()=>Response.json({object:'hermes.run',run_id:'wrong',status:'completed',output:'wrong'});
await assert.rejects(()=>pollHermes(cfg,'run_123'));
globalThis.fetch=async(url,init)=>{if(!init.headers)return new Response('',{status:401});if(url.endsWith('/v1/models'))return Response.json({data:[{id:'configured-model'}]});return Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true}}})};
assert.equal(await verifyHermes(cfg),'HERMES · configured-model');
globalThis.fetch=async()=>Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:false}}});
await assert.rejects(()=>verifyHermes(cfg));
console.log('PASS: endpoint validation, durable recovery, owner isolation, status/output, cancellation, capabilities, no API fallback');
