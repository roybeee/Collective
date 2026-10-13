#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createAsideAdapter } from './lib/store-browser-aside.mjs';

import { validateConfig } from './lib/store-browser-config.mjs';
import { preparePhotoAsset } from './lib/store-browser-photo.mjs';
import { probeBrowser, reportHealth } from './lib/store-browser-health.mjs';
import { acquireSingleton, readPrivateEnv, watchLoop } from './lib/store-browser-service.mjs';
import { normalizedEvidence } from './lib/store-browser-weekly.mjs';
export { validateConfig } from './lib/store-browser-config.mjs';
export function validateApiUrl(value, allowLocal = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('API origin only');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) throw Error('HTTPS required (local fixture requires explicit opt-in)');
  return url.origin;
}
function matches(evidence, binding) {
  return evidence && !evidence.blocked && ['managerUrl', 'managerBusinessId', 'naverPlaceId', 'storeName'].every(k => evidence[k] === binding[k]);
}
export async function runJob(claim, adapter, report) {
  const { job, binding, executionMode } = claim;
  let submitting = executionMode === 'reconcile';
  let evidence;let asset;
  const verified=async finalEvidence=>{await report('verify',{evidence:finalEvidence});if(binding.publicUrl){try{const publicEvidence=await adapter.publicReadback?.();await report('public_readback',{evidence:publicEvidence||{unavailable:true,note:'공개 읽기 adapter 미등록'}});}catch{try{await report('public_readback',{evidence:{unavailable:true,note:'공개 페이지 확인 불가'}});}catch{/* Manager result remains independently verified. */}}}return{state:'verified'};};
  try {
    if (!['read', 'write', 'reconcile'].includes(executionMode)) throw Error('unsupported execution mode');
    evidence = normalizedEvidence(await (executionMode === 'reconcile' ? (job.type==='upload_photo'?adapter.verifyPhoto():adapter.verify()) : adapter.observe()));
    if (!matches(evidence, binding)) throw Error('target mismatch or login/access block');
    if (executionMode === 'reconcile') {
      if (['change_hours','change_weekly_hours'].includes(job.type) && evidence.hours !== job.afterHours) throw Error('readback differs; manual reconciliation required');
      if(job.type==='upload_photo'&&(!evidence.photoId||evidence.photoSha256!==job.photo?.sha256))throw Error('photo identity/hash not confirmed');
      return await verified(evidence);
    }
    await report('target_checked', { evidence });
    if (executionMode === 'read') {
      if(job.type==='upload_photo'&&(!evidence.photoId||evidence.photoSha256!==job.photo?.sha256))throw Error('photo identity/hash not confirmed');
      return await verified(evidence);
    }
    if (!['change_hours','change_weekly_hours','upload_photo'].includes(job.type) || ['change_hours','change_weekly_hours'].includes(job.type)&&evidence.hours!==job.beforeHours) throw Error('current hours differ from approved before value');
    if(adapter.supportsWrite===false)throw Error('write adapter not registered');
    await adapter.prepare?.(job);
    if(job.type==='upload_photo') {if(!adapter.preparePhotoAsset||!adapter.uploadPhoto)throw Error('photo adapter unavailable');asset=await adapter.preparePhotoAsset();}
    await report('prepared', { evidence });
    if(adapter.signal?.aborted)throw Error('worker stop requested before submit');
    const permit = await report('begin_submit', { evidence });
    if (permit?.permitSubmit !== true) throw Error('explicit submit permit missing');
    submitting = true;
    if(job.type==='upload_photo')await adapter.uploadPhoto(asset);else await adapter.saveHours(job.afterHours, job.beforeHours);
    await report('submitted', {});
    const after = normalizedEvidence(await (job.type==='upload_photo'?adapter.verifyPhoto():adapter.verify()));
    if (!matches(after, binding) || (job.type==='upload_photo' ? !after.photoId||after.photoSha256!==job.photo.sha256 : after.hours!==job.afterHours)) throw Error('saved result not confirmed');
    return await verified(after);
  } catch {
    const state = submitting ? 'unknown' : 'handoff';
    // Never resend a save, including when the result-report transport fails.
    try { await report(state, { evidence, note: submitting ? '저장 결과 불명확: 읽기 확인 후 수동 조정 필요' : '매장·로그인·현장 설정 또는 승인 확인 필요' }); } catch { /* No retry of browser mutations. */ }
    return { state,auth:evidence?.auth||'unknown',browser:evidence?.blocked?'blocked':'ready' };
  } finally {await asset?.dispose?.();}
}
export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if(argv.includes('--watch'))return startWatch(argv,env,dependencies);
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/store-browser-worker.mjs --config <local.json> --once|--watch [--env-file <private.json>] [--allow-local-fixture]\nEnv: STORE_BROWSER_API_ORIGIN, STORE_BROWSER_WORKER_TOKEN. Locators must be registered from an observed live snapshot.');
    return;
  }
  const index = argv.indexOf('--config');
  if (index < 0 || !argv[index + 1] || !argv.includes('--once') || argv.some((x, i) => !['--config', '--once', '--allow-local-fixture'].includes(x) && i !== index + 1)) throw Error('use --config <path> --once');
  // Validate local setup before claiming work; no secrets are sent to Aside.
  const config = validateConfig(JSON.parse(await readFile(argv[index + 1], 'utf8')));
  if(config.adapter==='naver_smartplace')(await import('./lib/store-browser-smartplace.mjs')).validateSmartplaceConfig(config.native);
  const origin = validateApiUrl(env.STORE_BROWSER_API_ORIGIN, argv.includes('--allow-local-fixture'));
  const token = env.STORE_BROWSER_WORKER_TOKEN;
  if (!/^sb\.[a-zA-Z0-9-]+\.[a-zA-Z0-9_-]{20,}$/u.test(token || '')) throw Error('valid device token required');
  const request = dependencies.fetch || fetch;
  async function call(payload) {
    const response = await request(`${origin}/api/store-browser/worker`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    if (!response.ok) {const error=new Error('worker API request failed');error.status=response.status;try{const data=await response.json();error.code=typeof data.code==='string'?data.code:'';}catch{/* Unrecognized status remains a fault. */}throw error;}
    return response.json();
  }
  const claim = await call({ action: 'claim' });
  if (!claim.job || !claim.binding || !claim.attemptId || !claim.leaseToken) throw Error('invalid claim response');
  if ((config.host === 'local' ? config.account : config.profile) !== claim.binding.profileId) {
    await call({action:'handoff',jobId:claim.job.id,attemptId:claim.attemptId,leaseToken:claim.leaseToken,expectedVersion:claim.job.version,note:'등록된 프로필과 로컬 워커 프로필이 다름'});
    return {state:'handoff'};
  }
  let version = claim.job.version;
  const report = async (action, details) => {
    const result = await call({ action, jobId: claim.job.id, attemptId: claim.attemptId, leaseToken: claim.leaseToken, expectedVersion: version, ...details });
    if (!Number.isSafeInteger(result.job?.version)) throw Error('invalid phase response');
    version = result.job.version;
    return result;
  };
  const localFixture = argv.includes('--allow-local-fixture') && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  const adapter = dependencies.adapter || (config.adapter==='naver_smartplace' ? (await import('./lib/store-browser-smartplace.mjs')).createSmartplaceAdapter(config,claim.binding) : createAsideAdapter(config, claim.binding, undefined, localFixture));
  const currentAdapter={...adapter,signal:dependencies.signal};
  const runnable=claim.job.type==='upload_photo'?{...currentAdapter,preparePhotoAsset:()=>preparePhotoAsset(origin,token,claim,request)}:currentAdapter;
  const result = await runJob(claim, runnable, report);
  console.log(JSON.stringify({ jobId: claim.job.id, state: result.state, source: dependencies.adapter || localFixture ? 'mocked' : 'real' }));
  return result;
}

async function startWatch(argv,env,dependencies) {
 const index=argv.indexOf('--config'),envIndex=argv.indexOf('--env-file');
 if(index<0||!argv[index+1]||argv.includes('--once'))throw Error('watch requires config');
 const supplied=envIndex>=0?await readPrivateEnv(argv[envIndex+1]):{};
 const activeEnv={...env,...supplied};
 const config=validateConfig(JSON.parse(await readFile(argv[index+1],'utf8')));
 const origin=validateApiUrl(activeEnv.STORE_BROWSER_API_ORIGIN,argv.includes('--allow-local-fixture'));
 if(!/^sb\.[a-zA-Z0-9-]+\.[a-zA-Z0-9_-]{20,}$/u.test(activeEnv.STORE_BROWSER_WORKER_TOKEN||''))throw Error('valid device token required');
 const lockPath=`${argv[index+1]}.worker.lock`;
 const release=await acquireSingleton(lockPath);const controller=new AbortController();
 const stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const onceArgs=argv.filter((x,i)=>x!=='--watch'&&x!=='--env-file'&&(envIndex<0||i!==envIndex+1)).concat('--once');
 const tick=async()=>{const browser=await (dependencies.probeBrowser||probeBrowser)(config);await reportHealth(origin,activeEnv.STORE_BROWSER_WORKER_TOKEN,{process:'ready',browser,auth:'unknown'},dependencies.fetch);if(browser!=='ready')throw Error('browser offline');const result=await main(onceArgs,activeEnv,{...dependencies,signal:controller.signal});await reportHealth(origin,activeEnv.STORE_BROWSER_WORKER_TOKEN,{process:'ready',browser:result?.browser||'ready',auth:result?.auth||(result?.state==='verified'?'ready':'unknown')},dependencies.fetch);return result;};
 try {await watchLoop(tick,{signal:controller.signal,maxTicks:dependencies.maxTicks,sleep:dependencies.sleep,onHealth:state=>{console.log(JSON.stringify({worker:state}));}});}
 finally {process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await release();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('점포 브라우저 워커 중단: 설정·접속·작업 상태를 확인하세요. 저장 작업은 재시도하지 않습니다.'); process.exitCode = 1; });
}
