import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const records=new Map();
const budgetCalls=[];let budgetBlock=false,budgetCreated=true;
globalThis.__hermesTest={
 ApiError:class extends Error{constructor(status,message){super(message);this.status=status}},
 database:()=>'db',
 // 토큰 예산 가드(lib/token-budget.ts) 자리표시. 호출 순서와 인자만 기록한다(실제 DB 가드는 tests/token-budget.test.mjs).
 reserveTokenBudget:async(db,owner,id,saved)=>{budgetCalls.push(['reserve',owner,id,saved.key]);if(budgetBlock)throw new globalThis.__hermesTest.ApiError(409,'토큰 예산 초과: 남은 예산 0토큰');return {warning:'미설정 경고',created:budgetCreated}},
 releaseTokenReservation:async(db,owner,id)=>{budgetCalls.push(['release',owner,id])},
 markTokenReservationRun:async(db,owner,id,runId)=>{budgetCalls.push(['run',owner,id,runId])},
 settleTokenReservation:async(db,owner,runId,submissionId)=>{budgetCalls.push(['settle',owner,runId,submissionId])},
 recordStatement:(owner,kind,id,value)=>({run:async()=>records.set(owner+':'+id,value)}),
 readRecord:async(owner,kind,id)=>{if(!records.has(owner+':'+id))throw new Error('not found');return records.get(owner+':'+id)}
};
const limitsCode=ts.transpileModule(await readFile(new URL('../lib/http-limits.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
globalThis.__hermesTest.readBoundedJson=(await import('data:text/javascript;base64,'+Buffer.from(limitsCode).toString('base64'))).readBoundedJson;
const source=(await readFile(new URL('../lib/hermes.ts',import.meta.url),'utf8')).replace(/^import .*from '.\/server';/m,'const {ApiError,database,recordStatement,readRecord}=globalThis.__hermesTest;').replace(/^import .*from '.\/token-budget';/m,'const {reserveTokenBudget,releaseTokenReservation,markTokenReservationRun,settleTokenReservation}=globalThis.__hermesTest;').replace(/^import .*from '.\/usage-ledger';/m,'const recordProviderUsage=async()=>{};').replace(/^import .*from '.\/http-limits';/m,'const {readBoundedJson}=globalThis.__hermesTest;');
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
// 가드 배선: 제출마다 요청 전에 예약하고, 접수되면 실행 번호를 붙이고, 확정 거절(4xx)이면 예약을 푼다. 409면 요청을 보내지 않는다.
const firstKey=records.get('owner:job').key;
assert.deepEqual(budgetCalls.slice(0,3),[['reserve','owner','job',firstKey],['reserve','owner','job',firstKey],['run','owner','job','run_123']]);
budgetBlock=true;const sentBefore=requests.length;
await assert.rejects(()=>submitHermes('owner','job',cfg),e=>e.status===409&&/토큰 예산 초과/.test(e.message));
assert.equal(requests.length,sentBefore);budgetBlock=false;
budgetCalls.length=0;globalThis.fetch=async()=>new Response('{}',{status:400});
await assert.rejects(()=>submitHermes('owner','job',cfg),e=>e.status===400);
assert.deepEqual(budgetCalls.map(c=>c[0]),['reserve','release']);
// 같은 키의 복구 재전송(이번 호출이 예약을 만들지 않음)은 원래 요청이 이미 접수됐을 수 있어 4xx여도 예약을 풀지 않는다.
budgetCalls.length=0;budgetCreated=false;
await assert.rejects(()=>submitHermes('owner','job',cfg),e=>e.status===400);
assert.deepEqual(budgetCalls.map(c=>c[0]),['reserve']);budgetCreated=true;
// 429는 미접수·재시도 예정이라 새 예약도 풀지 않는다(같은 키 재시도가 다시 가드되지 않게).
budgetCalls.length=0;globalThis.fetch=async()=>new Response('{}',{status:429});
await assert.rejects(()=>submitHermes('owner','job',cfg),e=>e.status===429);
assert.deepEqual(budgetCalls.map(c=>c[0]),['reserve']);
budgetCalls.length=0;globalThis.fetch=async()=>{throw new Error('lost again')};
await assert.rejects(()=>submitHermes('owner','job',cfg),e=>e.status===502);
assert.deepEqual(budgetCalls.map(c=>c[0]),['reserve']);
globalThis.fetch=async()=>Response.json({run_id:'run_124'});
assert.equal((await submitHermes('owner','job',cfg)).budgetWarning,'미설정 경고');
let state='running';
globalThis.fetch=async(url,init)=>Response.json({object:'hermes.run',run_id:'run_123',status:state,output:'completed draft'});
assert.equal((await pollHermes(cfg,'run_123')).status,'in_progress');
globalThis.fetch=async()=>Response.json({object:'hermes.run',run_id:'run_123',status:state,output:'completed draft',last_event:'tool.start',updated_at:1700000000});
const progress=await pollHermes(cfg,'run_123');assert.equal(progress.activity,'tool.start');assert.equal(progress.activityAt,'2023-11-14T22:13:20.000Z');
state='completed';assert.equal((await pollHermes(cfg,'run_123')).output[0].content[0].text,'completed draft');
budgetCalls.length=0;await pollHermes(cfg,'run_123',false,30000,'owner');assert.deepEqual(budgetCalls,[['settle','owner','run_123',undefined]]);
budgetCalls.length=0;await pollHermes(cfg,'run_123',false,30000,'owner',{kind:'role',submissionId:'job'});assert.deepEqual(budgetCalls,[['settle','owner','run_123','job']]);
state='running';budgetCalls.length=0;await pollHermes(cfg,'run_123',false,30000,'owner');assert.deepEqual(budgetCalls,[]);state='completed';
state='cancelled';assert.equal((await pollHermes(cfg,'run_123',true)).status,'cancelled');
state='unknown';await assert.rejects(()=>pollHermes(cfg,'run_123'));
globalThis.fetch=async()=>Response.json({object:'hermes.run',run_id:'wrong',status:'completed',output:'wrong'});
await assert.rejects(()=>pollHermes(cfg,'run_123'));
globalThis.fetch=async(url,init)=>{if(!init.headers)return new Response('',{status:401});if(url.endsWith('/v1/models'))return Response.json({data:[{id:'configured-model'}]});return Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true}}})};
assert.equal(await verifyHermes(cfg),'HERMES · configured-model');
globalThis.fetch=async()=>Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:false}}});
await assert.rejects(()=>verifyHermes(cfg));
console.log('PASS: endpoint validation, durable recovery, owner isolation, token budget wiring, status/output, cancellation, capabilities, no API fallback');
