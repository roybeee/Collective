// Cloudflare Workers 직접 배포 실행 시 판단(I1). deploy/worker-entry.ts가 쓰고, 의존성을 주입받으므로 tests/deploy-workers.test.mjs가 그대로 검사한다.
// 1) 요청 경계: Sites 앞단이 없으므로 GPT 로그인 헤더(oai-authenticated-user-*)는 누구나 위조할 수 있다. 항상 지우고, AUTH_MODE가 email이 아니면 앱을 열지 않는다.
// 2) 예약 tick(INTERNAL_CRON=1): 파이썬 워커 없이 돌 수 있는 큐만, 워커 tick과 같은 잠금(owner+':research-worker') 안에서 큐마다 한 번 부른다.

export const SPOOFABLE_HEADER_PREFIX = 'oai-authenticated-user-';
// 브라우저·HERMES가 필요 없는 큐. research·execution·meta_*·product_research·consumer_recovery·provider_catalog는 파이썬 워커 tick에만 남긴다.
export const CRON_QUEUES = Object.freeze(['scheduled_runs', 'digest', 'storefront_pull', 'pos_pull', 'measurement', 'growth_daily']);
export const CRON_LOCK_SUFFIX = ':research-worker';
// 한 번의 예약 실행에서 새 소유자를 시작하지 않는 경과 시간. 잠금 만료(lib/server.ts acquireLock 120초)보다 충분히 짧다.
export const CRON_BUDGET_MS = 20000;
export const CRON_OWNER_LIMIT = 50;
export const ACTIVE_OWNERS_SQL = `SELECT DISTINCT workspace_owner AS owner FROM auth_users WHERE status='active' ORDER BY workspace_owner LIMIT ${CRON_OWNER_LIMIT}`;

const closed = () => new Response(JSON.stringify({error: '인증 모드가 이메일로 설정되지 않아 이 배포를 열 수 없습니다. 관리자에게 문의해 주세요.'}), {
 status: 503,
 headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store'},
});

/**
 * 앱에 넘길 요청을 돌려주거나, 열 수 없으면 503 응답을 돌려준다.
 * @param {Request} request @param {{AUTH_MODE?: string}|undefined} env
 * @returns {{request: Request}|{response: Response}}
 */
export function guardRequest(request, env) {
 if (env?.AUTH_MODE !== 'email') return {response: closed()};
 const spoofable = [...request.headers.keys()].filter(name => name.toLowerCase().startsWith(SPOOFABLE_HEADER_PREFIX));
 if (!spoofable.length) return {request};
 const headers = new Headers(request.headers);
 for (const name of spoofable) headers.delete(name);
 return {request: new Request(request, {headers})};
}

/** @param {{INTERNAL_CRON?: string}|undefined} env */
export function cronEnabled(env) {
 return env?.INTERNAL_CRON === '1';
}

async function runOwnerQueues(owner, queues, onError) {
 const ran = [];
 for (const queue of CRON_QUEUES) {
  const run = queues[queue];
  if (typeof run !== 'function') continue;
  try {
   const result = await run(owner);
   ran.push({queue, status: typeof result?.status === 'string' ? result.status : 'idle'});
  } catch (error) {
   onError?.(queue, error);
   ran.push({queue, status: 'error'});
  }
 }
 return ran;
}

/**
 * 소유자마다 잠금을 잡고 CRON_QUEUES 순서대로 큐를 한 번씩 부른다. 잠금이 이미 잡혀 있으면(파이썬 워커 tick 진행 중) 그 소유자는 건너뛴다.
 * 큐 하나의 실패는 다음 큐를 막지 않는다. 경과 시간이 budgetMs를 넘으면 남은 소유자는 다음 예약 실행으로 미룬다.
 * @param {{owners: string[], queuesFor: (owner: string) => Promise<Record<string, ((owner: string) => Promise<{status: string}>)|undefined>>,
 *   acquire: (key: string) => Promise<string>, release: (key: string, token: string) => Promise<void>, now?: () => number, budgetMs?: number,
 *   onError?: (queue: string, error: unknown) => void}} deps
 */
export async function runInternalCron({owners, queuesFor, acquire, release, now = Date.now, budgetMs = CRON_BUDGET_MS, onError}) {
 const started = now(), results = [];
 for (const owner of owners) {
  if (now() - started > budgetMs) {
   results.push({owner, status: 'deferred'});
   continue;
  }
  const key = owner + CRON_LOCK_SUFFIX;
  let token;
  try {
   token = await acquire(key);
  } catch (error) {
   results.push({owner, status: error?.status === 409 ? 'busy' : 'lock_error'});
   if (error?.status !== 409) onError?.('lock', error);
   continue;
  }
  try {
   const queues = await queuesFor(owner);
   results.push({owner, status: 'ran', queues: await runOwnerQueues(owner, queues, onError)});
  } catch (error) {
   onError?.('queues', error);
   results.push({owner, status: 'error'});
  } finally {
   await release(key, token).catch(error => onError?.('release', error));
  }
 }
 return results;
}
