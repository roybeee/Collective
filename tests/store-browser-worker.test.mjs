import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAsideAdapter, buildAsideCode } from '../scripts/lib/store-browser-aside.mjs';
import { main, runJob, validateConfig, validateApiUrl } from '../scripts/store-browser-worker.mjs';
let passed = 0;
const evidence = { managerUrl: 'https://new.smartplace.naver.com/bizes/place/7', managerBusinessId: '7', naverPlaceId: '8', storeName: '가게', hours: '09:00-18:00', capturedAt: new Date().toISOString(), source: 'mocked' };
const claim = { job: { id: 'j', version: 1, type: 'change_hours', beforeHours: evidence.hours, afterHours: '10:00-19:00' }, binding: {...evidence,profileId:'u0'}, attemptId: 'a', leaseToken: 'lease', executionMode: 'write' };
function fixture(options = {}) {
  const events = []; let saves = 0;
  return { events, get saves() { return saves; }, adapter: { observe: async () => ({ ...evidence, ...options.observed }), saveHours: async () => { saves++; if(options.saveError) throw Error('save uncertain'); }, verify: async () => ({ ...evidence, hours: claim.job.afterHours,...options.after }) }, report: async (action) => { events.push(action); if((action === 'begin_submit' && options.permitError)||action===options.reportError) throw Error('response lost'); return { job: { ...claim.job, version: events.length + 1 }, permitSubmit: action === 'begin_submit'&&!options.permitFalse };  } };
}
for (const [name, options, state, saveCount] of [ ['wrong target', { observed: { naverPlaceId: '999' } }, 'handoff', 0], ['permit denied', { permitError: true }, 'handoff', 0], ['save error', { saveError: true }, 'unknown', 1], ['success', {}, 'verified', 1] ]) {
 const f = fixture(options); assert.equal((await runJob(claim, f.adapter, f.report)).state, state, name); assert.equal(f.saves, saveCount, name); passed++;
}
const recon = fixture(); assert.equal((await runJob({ ...claim, executionMode: 'reconcile' }, recon.adapter, recon.report)).state, 'verified'); assert.equal(recon.saves, 0); assert.deepEqual(recon.events, ['verify']); passed++;
const blocked = fixture({observed:{blocked:true}}); assert.equal((await runJob(claim, blocked.adapter, blocked.report)).state, 'handoff'); assert.equal(blocked.saves, 0); passed++;
for(const [options,state,saves] of [
 [{permitFalse:true},'handoff',0],
 [{observed:{hours:'stale current value'}},'handoff',0],
 [{reportError:'submitted'},'unknown',1],
 [{reportError:'verify'},'unknown',1],
 [{after:{hours:'old value'}},'unknown',1],
 [{after:{managerBusinessId:'other store'}},'unknown',1]
]){const f=fixture(options);assert.equal((await runJob(claim,f.adapter,f.report)).state,state);assert.equal(f.saves,saves);passed++;}
const read=fixture();assert.equal((await runJob({...claim,job:{...claim.job,type:'read_hours'},executionMode:'read'},read.adapter,read.report)).state,'verified');assert.equal(read.saves,0);assert.deepEqual(read.events,['target_checked','verify']);passed++;
const wrongReconcile=fixture({after:{hours:'old'}});assert.equal((await runJob({...claim,executionMode:'reconcile'},wrongReconcile.adapter,wrongReconcile.report)).state,'unknown');assert.equal(wrongReconcile.saves,0);passed++;
const invalidMode=fixture();assert.equal((await runJob({...claim,executionMode:'untrusted'},invalidMode.adapter,invalidMode.report)).state,'handoff');assert.equal(invalidMode.saves,0);passed++;
assert.throws(() => validateConfig({ host: 'local', profile: 'x', locators: { hours: { css: 'button; malicious()' } } })); passed++;
assert.throws(() => validateApiUrl('http://example.com')); assert.throws(() => validateApiUrl('https://x.test/api?token=secret')); passed++;


const config = {host:'local', account:'u0', hoursReadMode:'input', locators:Object.fromEntries(['managerBusinessId','naverPlaceId','storeName','hours','save'].map(k => [k,{css:`[data-observed="${k}"]`}]))};
validateConfig(config); passed++;
const commandCalls = [];
const asideAdapter = createAsideAdapter(config, claim.binding, async (command,args,opts) => {
 commandCalls.push({command,args,opts}); return {stdout:'snapshot text\nCOLLECTIVE_BROWSER_EVIDENCE='+JSON.stringify(evidence)+'\n'};
});
assert.deepEqual(await asideAdapter.observe(), evidence);
assert.equal(commandCalls[0].command,'aside');
assert.deepEqual(commandCalls[0].args.slice(0,5),['repl','--host','local','--account','u0']);
assert.equal(commandCalls[0].opts.env.STORE_BROWSER_WORKER_TOKEN,undefined);
assert.ok(commandCalls[0].args.at(-1).includes('snapshot(page'));
assert.ok(buildAsideCode(config,claim.binding,'verify').includes('await page.reload()'));
assert.equal(buildAsideCode(config, claim.binding, 'save', '10:00-19:00', evidence.hours).match(/\.click\(/gu).length,1); passed++;
assert.throws(() => buildAsideCode(config,{...claim.binding,managerUrl:'https://evil.test/path'},'observe')); passed++;
const invalidOutput = createAsideAdapter(config,claim.binding, async () => ({stdout:'not evidence'}));
await assert.rejects(invalidOutput.observe(),/evidence/); passed++;
const secretFailure = createAsideAdapter(config,claim.binding,async () => {throw Error('stderr contains sb.secret.password');});
await assert.rejects(secretFailure.observe(), error => !error.message.includes('password')); passed++;
const temp = await mkdtemp(join(tmpdir(),'store-browser-worker-'));
try {
 const configPath = join(temp,'config.json'); await writeFile(configPath,JSON.stringify(config));
 const calls = []; const f = fixture();
 const result = await main(['--config',configPath,'--once','--allow-local-fixture'], {STORE_BROWSER_API_ORIGIN:'http://127.0.0.1:8787',STORE_BROWSER_WORKER_TOKEN:'sb.device.abcdefghijklmnopqrstuv'}, {adapter:f.adapter,fetch:async (url,init) => {
  assert.equal(url,'http://127.0.0.1:8787/api/store-browser/worker'); assert.equal(init.redirect,'error');
  const payload=JSON.parse(init.body); calls.push(payload);
  return Response.json(payload.action==='claim' ? claim : {job:{...claim.job,version:calls.length},permitSubmit:payload.action==='begin_submit'});
 }});
 assert.equal(result.state,'verified'); assert.equal(f.saves,1);
 assert.deepEqual(calls.map(x=>x.action),['claim','target_checked','prepared','begin_submit','submitted','verify']);
 assert.deepEqual(calls.slice(1).map(x=>x.expectedVersion),[1,2,3,4,5]); passed++;
 const wrongProfileCalls=[]; let browserUsed=false;
 const mismatch=await main(['--config',configPath,'--once','--allow-local-fixture'],{STORE_BROWSER_API_ORIGIN:'http://127.0.0.1:8787',STORE_BROWSER_WORKER_TOKEN:'sb.device.abcdefghijklmnopqrstuv'},{adapter:{observe:async()=>{browserUsed=true;}},fetch:async(url,init)=>{const payload=JSON.parse(init.body);wrongProfileCalls.push(payload);return Response.json(payload.action==='claim'?{...claim,binding:{...claim.binding,profileId:'u1'}}:{job:{...claim.job,version:2}});}});
 assert.equal(mismatch.state,'handoff');assert.equal(browserUsed,false);assert.deepEqual(wrongProfileCalls.map(x=>x.action),['claim','handoff']);passed++;
} finally {await rm(temp,{recursive:true,force:true});}
console.log(JSON.stringify({passed,failed:0,mode:'mocked'}));
