// E2E 서버 도구 e2e/wrangler-proxy-fix.mjs 회귀: wrangler 4.92.0 ProxyWorker 원문에 수정 조각 4개가 한 곳씩 들어가고, 결과가 문법상 유효하며,
// 다시 적용해도 그대로이고, 다른 버전·다른 원문에는 손대지 않는다. 근거: mocked(설치된 wrangler 원문을 임시 폴더에 복사해 변환, 네트워크 0회).
// 실제 멈춤이 사라졌는지는 CI E2E(e2e/artifacts/server-default.log의 'ProxyWorker: … retrying/recovered' 줄과 흔들림 빈도)로 본다.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {patchProxySource, applyProxyFix, REPLACEMENTS, MARKER, FIXED_VERSION} from '../e2e/wrangler-proxy-fix.mjs';

let passed = 0;
const check = (name, ok) => {assert.ok(ok, name); passed++};

const installed = JSON.parse(readFileSync('node_modules/wrangler/package.json', 'utf8')).version;
const live = readFileSync('node_modules/wrangler/wrangler-dist/ProxyWorker.js', 'utf8');
// 로컬에서 E2E를 한 번 돌렸으면 설치본은 이미 고쳐져 있다. 고친 조각을 원문으로 되돌려 원문을 얻는다.
const pristine = live.includes(MARKER) ? REPLACEMENTS.reduceRight((s, [original, fixed]) => s.replace(fixed, () => original), live) : live;

check('the installed wrangler is the version this fix targets (bump: delete the fix)', installed === FIXED_VERSION);
check('the pristine source has no marker and each original fragment exactly once', !pristine.includes(MARKER) && REPLACEMENTS.every(([original]) => pristine.split(original).length === 2));
check('the pristine source still has the href comparison bug the fix removes', pristine.includes('userWorkerUrl.href === newUserWorkerUrl?.href'));

const first = patchProxySource(pristine);
check('patch reports patched', first.status === 'patched');
check('patched source has the marker once and every fixed fragment once', first.source.split(MARKER).length === 2 && REPLACEMENTS.every(([, fixed]) => first.source.split(fixed).length === 2));
check('patched source compares origins, not full URLs', !first.source.includes('userWorkerUrl.href === newUserWorkerUrl?.href') && first.source.includes('userWorkerUrl.origin === urlFromParts(this.proxyData.userWorkerUrl).origin'));
check('patched source retries only GET/HEAD, at most twice, and drains the retry queue', first.source.includes('(request.method === "GET" || request.method === "HEAD") && attempt < 2') && first.source.includes('this.requestRetryQueue.set(request, deferredResponse);\n          this.processQueue();') && first.source.includes('}, attempt === 0 ? 0 : 250);'));
check('POST keeps the restart 503 branch', first.source.includes('Only GET or HEAD requests are retried automatically.'));
check('patched source starts the first attempt', first.source.includes('      attemptUserWorkerFetch();\n    }\n  }\n};\n'));
check('reversing the fragments restores the original byte-exactly', REPLACEMENTS.reduceRight((s, [original, fixed]) => s.replace(fixed, () => original), first.source) === pristine);

const dir = mkdtempSync(join(tmpdir(), 'proxy-fix-'));
try {
 const probe = join(dir, 'ProxyWorker.mjs');
 writeFileSync(probe, first.source);
 const syntax = spawnSync(process.execPath, ['--check', probe], {encoding: 'utf8'});
 check('patched ProxyWorker parses as a module (node --check)', syntax.status === 0);

 const again = patchProxySource(first.source);
 check('applying twice leaves the source unchanged', again.status === 'already' && again.source === first.source);
 check('a half-applied source is refused', (() => {try {patchProxySource(first.source.replace(REPLACEMENTS[2][1], () => REPLACEMENTS[2][0])); return false} catch {return true}})());
 check('a source missing an original fragment is refused, not silently skipped', (() => {try {patchProxySource(pristine.replace(REPLACEMENTS[1][0], () => '')); return false} catch {return true}})());
 check('a source with a duplicated fragment is refused', (() => {try {patchProxySource(pristine + REPLACEMENTS[3][0]); return false} catch {return true}})());
 check('non-string input is refused', (() => {try {patchProxySource(undefined); return false} catch {return true}})());

 // applyProxyFix: 임시 루트의 가짜 node_modules/wrangler에 적용한다. 설치본은 건드리지 않는다.
 const root = (version) => {
  const r = mkdtempSync(join(dir, 'root-'));
  mkdirSync(join(r, 'node_modules', 'wrangler', 'wrangler-dist'), {recursive: true});
  writeFileSync(join(r, 'node_modules', 'wrangler', 'package.json'), JSON.stringify({version}));
  writeFileSync(join(r, 'node_modules', 'wrangler', 'wrangler-dist', 'ProxyWorker.js'), pristine);
  return r;
 };
 const target = root(FIXED_VERSION), file = join(target, 'node_modules', 'wrangler', 'wrangler-dist', 'ProxyWorker.js');
 const applied = applyProxyFix(target);
 check('applyProxyFix patches 4.92.0 on disk', applied.status === 'patched' && applied.version === FIXED_VERSION && readFileSync(file, 'utf8') === first.source);
 check('applyProxyFix is idempotent on disk', applyProxyFix(target).status === 'already' && readFileSync(file, 'utf8') === first.source);
 const other = root('4.130.0'), otherFile = join(other, 'node_modules', 'wrangler', 'wrangler-dist', 'ProxyWorker.js');
 const skipped = applyProxyFix(other);
 check('another wrangler version is skipped and left untouched', skipped.status === 'skipped' && skipped.version === '4.130.0' && readFileSync(otherFile, 'utf8') === pristine);
} finally {
 rmSync(dir, {recursive: true, force: true});
}

check('the test did not modify the installed wrangler', readFileSync('node_modules/wrangler/wrangler-dist/ProxyWorker.js', 'utf8') === live);
check('e2e/serve.mjs applies the fix before starting wrangler dev', (() => {const s = readFileSync('e2e/serve.mjs', 'utf8'); return s.includes("import {applyProxyFix} from './wrangler-proxy-fix.mjs';") && s.indexOf('applyProxyFix()') > -1 && s.indexOf('applyProxyFix()') < s.indexOf("'dev', '--config'")})());

console.log(JSON.stringify({passed}));
