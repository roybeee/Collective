// E2E 전용: wrangler 4.92.0 `wrangler dev` 로컬 프록시(ProxyWorker)의 GET 멈춤을 고친다. 운영 Workers에는 ProxyWorker가 없다.
// 원인: 사용자 워커로의 전달이 네트워크 오류로 끊기면 전체 URL(href)과 origin만 만든 URL을 비교해 늘 '워커가 재시작됐다'고 잘못 보고,
// GET·HEAD를 재시도 큐에 넣기만 하고 처리하지 않는다. 다음 요청이 들어와야 풀려서, 요청이 하나뿐인 순간(workers:1 E2E)에는 60초 멈춘다
// (docs/STATUS.md 테스트 흔들림, e2e/meeting-quality.spec.ts:40). wrangler 4.114(origin 비교)와 4.130(끊긴 GET·HEAD 재시도)의 수정을 되돌려 넣는다.
// 정확히 wrangler 4.92.0일 때만, 원문이 한 곳씩 정확히 맞을 때만 고친다. 이미 고쳤으면 그대로 둔다. 맞지 않으면 조용히 넘기지 않고 멈춘다.
// wrangler를 4.130 이상으로 올리면 이 파일과 e2e/serve.mjs의 호출을 지운다. 의존성 파일(package.json·pnpm-lock.yaml·pnpm-workspace.yaml)은 바꾸지 않는다.
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const FIXED_VERSION = '4.92.0';
export const MARKER = '/* COLLECTIVE e2e proxy fix: wrangler 4.114 origin check + 4.130 GET/HEAD retry backport (e2e/wrangler-proxy-fix.mjs) */';

// [원문, 고친 문장]. 원문은 wrangler 4.92.0 wrangler-dist/ProxyWorker.js 그대로다.
export const REPLACEMENTS = Object.freeze([
 [
  '      void fetch(userWorkerUrl, new Request(request, { headers })).then(async (res) => {\n        res = new Response(res.body, res);\n',
  `      ${MARKER}\n` +
  '      const sameUserWorker = () => this.proxyData !== void 0 && userWorkerUrl.origin === urlFromParts(this.proxyData.userWorkerUrl).origin;\n' +
  '      const attemptUserWorkerFetch = (attempt = 0) => void fetch(userWorkerUrl, new Request(request, { headers })).then(async (res) => {\n' +
  '        if (attempt > 0) console.warn(`ProxyWorker: ${request.method} ${request.url} recovered on attempt ${attempt + 1} after a dropped connection to the UserWorker`);\n' +
  '        res = new Response(res.body, res);\n',
 ],
 [
  '        deferredResponse.resolve(res);\n      }).catch((error) => {\n        const newUserWorkerUrl = this.proxyData && urlFromParts(this.proxyData.userWorkerUrl);\n        if (userWorkerUrl.href === newUserWorkerUrl?.href) {\n',
  '        deferredResponse.resolve(res);\n' +
  '      }, (error) => {\n' +
  '        if (sameUserWorker() && (request.method === "GET" || request.method === "HEAD") && attempt < 2) {\n' +
  '          console.warn(`ProxyWorker: ${request.method} ${request.url} attempt ${attempt + 1} failed (${error.message}); retrying`);\n' +
  '          setTimeout(() => {\n' +
  '            if (this.proxyData !== proxyData) {\n' +
  '              this.requestRetryQueue.set(request, deferredResponse);\n' +
  '              this.processQueue();\n' +
  '              return;\n' +
  '            }\n' +
  '            attemptUserWorkerFetch(attempt + 1);\n' +
  '          }, attempt === 0 ? 0 : 250);\n' +
  '          return;\n' +
  '        }\n' +
  '        throw error;\n' +
  '      }).catch((error) => {\n' +
  '        if (sameUserWorker()) {\n',
 ],
 [
  '          this.requestRetryQueue.set(request, deferredResponse);\n        } else {\n',
  '          this.requestRetryQueue.set(request, deferredResponse);\n          this.processQueue();\n        } else {\n',
 ],
 [
  '          );\n        }\n      });\n    }\n  }\n};\n',
  '          );\n        }\n      });\n      attemptUserWorkerFetch();\n    }\n  }\n};\n',
 ],
]);

const count = (text, part) => text.split(part).length - 1;

// 순수 변환. 결과: {status:'patched'|'already', source}. 원문이 한 곳씩 정확히 맞지 않으면 던진다.
export function patchProxySource(source) {
 if (typeof source !== 'string') throw new Error('ProxyWorker 원문이 문자열이 아닙니다.');
 if (source.includes(MARKER)) {
  if (count(source, MARKER) !== 1 || REPLACEMENTS.some(([, fixed]) => count(source, fixed) !== 1)) throw new Error('ProxyWorker에 이 수정이 일부만 들어 있습니다. node_modules를 다시 설치하세요.');
  return {status: 'already', source};
 }
 let out = source;
 REPLACEMENTS.forEach(([original, fixed], i) => {
  const n = count(out, original);
  if (n !== 1) throw new Error(`ProxyWorker 원문 ${i + 1}번 조각이 ${n}곳에서 맞습니다(1곳이어야 함). wrangler 4.92.0 원문이 아닙니다.`);
  out = out.replace(original, () => fixed);
 });
 return {status: 'patched', source: out};
}

// node_modules의 wrangler에 적용한다. 결과: {status:'patched'|'already'|'skipped', version}.
export function applyProxyFix(root = process.cwd()) {
 const dir = join(root, 'node_modules', 'wrangler');
 const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
 if (version !== FIXED_VERSION) return {status: 'skipped', version};
 const file = join(dir, 'wrangler-dist', 'ProxyWorker.js');
 const result = patchProxySource(readFileSync(file, 'utf8'));
 if (result.status === 'patched') writeFileSync(file, result.source);
 return {status: result.status, version};
}
