#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createAsideAdapter } from './lib/store-browser-aside.mjs';

const locatorKeys = ['managerBusinessId', 'naverPlaceId', 'storeName', 'hours', 'save'];
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function bounded(value, max = 200) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value); }
export function validateConfig(value) {
  if (!plain(value) || Object.keys(value).some(k => !['host', 'profile', 'account', 'locators', 'hoursReadMode'].includes(k))) throw Error('invalid local config');
  if (!bounded(value.host) || !/^[\w .-]+$/u.test(value.host)) throw Error('explicit host required');
  if (value.host === 'local' ? (!bounded(value.account) || value.profile !== undefined) : (!bounded(value.profile) || value.account !== undefined)) throw Error('explicit local account or remote profile required');
  const selector = value.host === 'local' ? value.account : value.profile;
  if (!/^[\w.-]+$/u.test(selector)) throw Error('invalid profile selector');
  if (!plain(value.locators) || Object.keys(value.locators).some(k => !locatorKeys.includes(k))) throw Error('invalid locators');
  for (const key of locatorKeys) {
    const locator = value.locators[key];
    if (!plain(locator)) throw Error(`observed locator required: ${key}`);
    if (Object.keys(locator).some(k => !['css', 'role', 'name'].includes(k))) throw Error('invalid locator properties');
    const css = bounded(locator.css, 300) && !/[;{}\n]/u.test(locator.css) && locator.role === undefined && locator.name === undefined;
    const role = bounded(locator.role, 30) && /^[a-z]+$/u.test(locator.role) && bounded(locator.name) && locator.css === undefined;
    if (!css && !role) throw Error(`invalid observed locator: ${key}`);
  }
  if (!['input', 'text'].includes(value.hoursReadMode)) throw Error('explicit hoursReadMode required');
  return value;
}
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
  let evidence;
  try {
    if (!['read', 'write', 'reconcile'].includes(executionMode)) throw Error('unsupported execution mode');
    evidence = await (executionMode === 'reconcile' ? adapter.verify() : adapter.observe());
    if (!matches(evidence, binding)) throw Error('target mismatch or login/access block');
    if (executionMode === 'reconcile') {
      if (job.type === 'change_hours' && evidence.hours !== job.afterHours) throw Error('readback differs; manual reconciliation required');
      await report('verify', { evidence });
      return { state: 'verified' };
    }
    await report('target_checked', { evidence });
    if (executionMode === 'read') {
      await report('verify', { evidence });
      return { state: 'verified' };
    }
    if (job.type !== 'change_hours' || evidence.hours !== job.beforeHours) throw Error('current hours differ from approved before value');
    await report('prepared', { evidence });
    const permit = await report('begin_submit', { evidence });
    if (permit?.permitSubmit !== true) throw Error('explicit submit permit missing');
    submitting = true;
    await adapter.saveHours(job.afterHours, job.beforeHours);
    await report('submitted', {});
    const after = await adapter.verify();
    if (!matches(after, binding) || after.hours !== job.afterHours) throw Error('saved hours not confirmed');
    await report('verify', { evidence: after });
    return { state: 'verified' };
  } catch {
    const state = submitting ? 'unknown' : 'handoff';
    // Never resend a save, including when the result-report transport fails.
    try { await report(state, { evidence, note: submitting ? '저장 결과 불명확: 읽기 확인 후 수동 조정 필요' : '매장·로그인·현장 설정 또는 승인 확인 필요' }); } catch { /* No retry of browser mutations. */ }
    return { state };
  }
}
export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/store-browser-worker.mjs --config <local.json> --once [--allow-local-fixture]\nEnv: STORE_BROWSER_API_ORIGIN, STORE_BROWSER_WORKER_TOKEN. Locators must be registered from an observed live snapshot.');
    return;
  }
  const index = argv.indexOf('--config');
  if (index < 0 || !argv[index + 1] || !argv.includes('--once') || argv.some((x, i) => !['--config', '--once', '--allow-local-fixture'].includes(x) && i !== index + 1)) throw Error('use --config <path> --once');
  // Validate local setup before claiming work; no secrets are sent to Aside.
  const config = validateConfig(JSON.parse(await readFile(argv[index + 1], 'utf8')));
  const origin = validateApiUrl(env.STORE_BROWSER_API_ORIGIN, argv.includes('--allow-local-fixture'));
  const token = env.STORE_BROWSER_WORKER_TOKEN;
  if (!/^sb\.[a-zA-Z0-9-]+\.[a-zA-Z0-9_-]{20,}$/u.test(token || '')) throw Error('valid device token required');
  const request = dependencies.fetch || fetch;
  async function call(payload) {
    const response = await request(`${origin}/api/store-browser/worker`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    if (!response.ok) throw Error(`worker API status ${response.status}`);
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
  const adapter = dependencies.adapter || createAsideAdapter(config, claim.binding, undefined, localFixture);
  const result = await runJob(claim, adapter, report);
  console.log(JSON.stringify({ jobId: claim.job.id, state: result.state, source: dependencies.adapter || localFixture ? 'mocked' : 'real' }));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('점포 브라우저 워커 중단: 설정·접속·작업 상태를 확인하세요. 저장 작업은 재시도하지 않습니다.'); process.exitCode = 1; });
}
