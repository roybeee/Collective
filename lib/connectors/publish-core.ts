// C3 직접 게시 공통 코어(순수에 가깝다: fetch·저널·시계를 모두 주입받는다). Instagram Graph(instagram-publish.ts)·Threads(threads.ts)가 함께 쓴다.
// 규율: (1) HTTP 한 번의 시도를 rate-queue의 AttemptResult로 바꾼다. (2) 두 단계 게시(컨테이너 → 게시)는 저널에 단계를 적어 두어 중간에 죽어도 다시 컨테이너를 만들지 않고 이어 간다.
// (3) 게시(2단계)는 외부에 보이는 쓰기라 보낸 뒤 결과를 모르면 unknown으로 남기고 절대 다시 보내지 않는다. 컨테이너 만들기(1단계)는 게시물이 아니라 재시도해도 중복 노출이 없다.
import {runWithBackoff, type AttemptResult, type BackoffPolicy, type RunDeps} from './rate-queue';
import type {PublishLimit, PublishOutcome, PublicationComment, RateLimit} from './types';

export type Attempt = AttemptResult & {payload?: unknown};
export type PublishHttp = {fetch: typeof fetch; timeoutMs: number; maxBytes: number};
export const DEFAULT_TIMEOUT_MS = 20000;
export const MAX_RESPONSE_BYTES = 200000;
export const defaultPublishPolicy: BackoffPolicy = {maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 30000};
export const realDeps: RunDeps = {now: () => Date.now(), random: () => Math.random(), sleep: ms => new Promise(r => setTimeout(r, ms))};

// 보내기 전 실패로 볼 수 있는 오류 코드(DNS·연결 거부). 그 밖의 fetch 예외는 상대에 도달했을 수 있으므로 sent:true(쓰기면 unknown)다.
const UNSENT_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);
function classifyThrown(error: unknown): Attempt {
 const name = (error as {name?: unknown} | null)?.name;
 if (name === 'TimeoutError' || name === 'AbortError') return {kind: 'timeout', sent: true};
 const code = (error as {cause?: {code?: unknown}} | null)?.cause?.code;
 return {kind: 'network_error', sent: !(typeof code === 'string' && UNSENT_CODES.has(code))};
}
// 응답 본문은 바이트 한도 안에서만 읽는다. JSON이 아니면 payload를 비운다(상태 코드로 분류한다).
async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
 const reader = response.body?.getReader();
 if (!reader) return undefined;
 const chunks: Uint8Array[] = [];
 let size = 0;
 try {
  for (;;) {
   const r = await reader.read();
   if (r.done) break;
   size += r.value.length;
   if (size > maxBytes) { await reader.cancel().catch(() => undefined); return undefined; }
   chunks.push(r.value);
  }
 } finally { reader.releaseLock(); }
 const bytes = new Uint8Array(size);
 let offset = 0;
 for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
 try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return undefined; }
}
// application/x-www-form-urlencoded 본문. (URLSearchParams 전역에 의존하지 않는다 — 모의 런타임 컨텍스트에 없다.)
export const formBody = (fields: Record<string, string>) => Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
// HTTP 한 번. 토큰은 헤더로만 보낸다(URL은 로그에 남는다). 리디렉션은 따르지 않는다.
export async function attempt(http: PublishHttp, url: string, init: {method?: 'GET' | 'POST'; token: string; body?: Record<string, string>}): Promise<Attempt> {
 let response: Response;
 try {
  response = await http.fetch(url, {
   method: init.method ?? 'GET',
   redirect: 'manual',
   headers: {Authorization: `Bearer ${init.token}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
   ...(init.body ? {body: formBody(init.body)} : {}),
   signal: AbortSignal.timeout(http.timeoutMs),
  });
 } catch (error) { return classifyThrown(error); }
 const payload = await boundedJson(response, http.maxBytes);
 return {kind: 'response', status: response.status, retryAfter: response.headers.get('retry-after'), payload};
}
// 공개 이미지 주소 도달 확인(HEAD). 로그인 리디렉션·오류·이미지가 아닌 응답은 false, 네트워크 실패는 null(판정 불가).
export async function imageReachable(http: PublishHttp, url: string): Promise<boolean | null> {
 try {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const r = await http.fetch(url, {method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(http.timeoutMs)});
  return r.ok && !!r.headers.get('content-type')?.startsWith('image/');
 } catch { return null; }
}
export const payloadId = (payload: unknown) => {
 const id = (payload as {id?: unknown} | null)?.id;
 return typeof id === 'string' && id ? id : typeof id === 'number' ? String(id) : null;
};
export const payloadError = (payload: unknown, status: number) => {
 const e = (payload as {error?: {message?: unknown; code?: unknown; error_subcode?: unknown}} | null)?.error;
 const message = typeof e?.message === 'string' ? e.message : '';
 return `${status}${e?.code !== undefined ? ` code ${String(e.code)}` : ''}${e?.error_subcode !== undefined ? `/${String(e.error_subcode)}` : ''}${message ? `: ${message.slice(0, 200)}` : ''}`;
};

// 두 단계 게시 저널. 같은 멱등 키(발행 id)는 한 번만 게시한다. D1 저널은 lib/execution-publisher-server.ts, 메모리 저널은 테스트가 쓴다.
// children: 캐러셀 자식 컨테이너를 만드는 중(childIds에 만든 것만 적는다). 자식 컨테이너도 게시물이 아니라 다시 만들어도 노출이 없지만, 재개 때 이미 만든 자식은 다시 만들지 않는다.
export type ContainerState = 'children' | 'created' | 'publishing' | 'published' | 'unknown' | 'failed';
export type ContainerEntry = {id: string; channel: string; state: ContainerState; containerId: string | null; publishedId: string | null; attempts: number; error: string | null; updatedAt: string; childIds?: (string | null)[]};
export type ContainerJournal = {get(id: string): Promise<ContainerEntry | undefined>; set(entry: ContainerEntry): Promise<void>};
export function memoryContainerJournal(seed: readonly ContainerEntry[] = []): ContainerJournal & {entries(): ContainerEntry[]} {
 const rows = new Map(seed.map(e => [e.id, e]));
 return {async get(id) { return rows.get(id); }, async set(entry) { rows.set(entry.id, entry); }, entries() { return [...rows.values()]; }};
}
export type TwoStepInput = {
 channel: string;
 key: string;               // 한도 큐 계정 키
 idempotencyKey: string;    // 저널 id(발행 id)
 limit: RateLimit;
 // childIds: 캐러셀 자식 컨테이너 id(자식이 없으면 빈 배열). 부모 컨테이너 본문의 children에 들어간다.
 createContainer: (childIds: readonly string[]) => Promise<Attempt>;
 publish: (containerId: string) => Promise<Attempt>;
 // 캐러셀 자식 컨테이너 만들기(순서대로 하나씩). 있으면 부모보다 먼저 모두 만든다.
 children?: readonly (() => Promise<Attempt>)[];
 journal: ContainerJournal;
 deps?: RunDeps;
 policy?: BackoffPolicy;
 now?: () => string;
};
const outcomeError = (last: AttemptResult | null) => last?.kind === 'response' ? payloadError((last as Attempt).payload, last.status) : last?.kind === 'timeout' ? '응답 시간 초과' : last?.kind === 'network_error' ? '네트워크 오류' : '예외';

// 캐러셀 자식 컨테이너를 순서대로 만든다. 하나 만들 때마다 저널(children)에 적어, 중간에 죽어도 다음 실행은 빈 칸만 만든다.
// 자식 하나라도 못 만들면 부모·게시로 가지 않는다(저널은 children으로 남아 다음 실행이 이어 간다).
async function createChildren(input: TwoStepInput, kids: readonly (() => Promise<Attempt>)[], start: (string | null)[], attempts0: number, base: {id: string; channel: string; publishedId: null; error: null}, deps: RunDeps, policy: BackoffPolicy, now: () => string): Promise<{childIds: (string | null)[]; attempts: number; failure?: PublishOutcome}> {
 let childIds = [...start], attempts = attempts0;
 for (let i = 0; i < kids.length; i++) {
  if (childIds[i]) continue;
  const made = await runWithBackoff<unknown>({key: input.key, limit: input.limit, write: false, policy, send: async () => { const a = await kids[i](); return {...a, value: a.payload}; }}, deps);
  attempts += made.attempts;
  const id = made.outcome === 'success' ? payloadId(made.value) : null;
  if (!id) {
   const error = `캐러셀 ${i + 1}번째 자식 컨테이너 생성 실패: ` + (made.outcome === 'success' ? '응답에 id가 없습니다' : outcomeError(made.last));
   await input.journal.set({...base, state: 'children', containerId: null, publishedId: null, childIds, attempts, error, updatedAt: now()});
   const outcome = made.outcome === 'success' || made.outcome === 'unknown' ? 'retryable' : made.outcome;
   return {childIds, attempts, failure: {outcome: outcome === 'fatal' ? 'fatal' : outcome, attempts, error: error + '. 게시하지 않았습니다. 다시 실행하면 만든 자식은 그대로 쓰고 나머지만 만듭니다.'}};
  }
  childIds = childIds.map((c, j) => j === i ? id : c);
  await input.journal.set({...base, state: 'children', containerId: null, publishedId: null, childIds, attempts, updatedAt: now()});
 }
 return {childIds, attempts};
}
// 컨테이너 → 게시. 저널 상태: created(컨테이너 있음, 게시 전) → publishing(게시 요청 직전) → published | unknown(보낸 뒤 결과 불명, 재전송 금지) | failed(거부됨).
// 재개: published면 cached, publishing·unknown이면 refuse(unknown), created면 컨테이너를 다시 만들지 않고 게시만 한다. failed는 처음부터 다시 한다(컨테이너는 게시물이 아니다).
export async function twoStepPublish(input: TwoStepInput): Promise<PublishOutcome> {
 const deps = input.deps ?? realDeps, policy = input.policy ?? defaultPublishPolicy, now = input.now ?? (() => new Date().toISOString());
 const existing = await input.journal.get(input.idempotencyKey);
 const base = {id: input.idempotencyKey, channel: input.channel, publishedId: null, error: null};
 if (existing?.state === 'published') return {outcome: 'cached', id: existing.publishedId ?? undefined, containerId: existing.containerId ?? undefined, attempts: 0};
 if (existing?.state === 'publishing' || existing?.state === 'unknown') {
  const entry: ContainerEntry = {...existing, state: 'unknown', updatedAt: now()};
  await input.journal.set(entry);
  return {outcome: 'unknown', containerId: existing.containerId ?? undefined, attempts: 0, error: '이전 게시 요청의 결과를 모릅니다. 계정에서 게시 여부를 확인하세요. 자동 재전송하지 않습니다.'};
 }
 let containerId = existing?.state === 'created' ? existing.containerId : null, attempts = existing?.attempts ?? 0;
 // 0단계(캐러셀): 자식 컨테이너. 재개(children·created)면 저장된 자식 id를 그대로 쓰고 빈 칸만 만든다. failed는 처음부터 다시 한다.
 const kids = input.children ?? [];
 let childIds: (string | null)[] = existing && (existing.state === 'children' || existing.state === 'created') && existing.childIds?.length === kids.length ? [...existing.childIds] : kids.map(() => null);
 if (!containerId && kids.length) {
  const made = await createChildren(input, kids, childIds, attempts, base, deps, policy, now);
  attempts = made.attempts; childIds = made.childIds;
  if (made.failure) return made.failure;
 }
 const childList = childIds.filter((c): c is string => !!c);
 const kidMeta = kids.length ? {childIds} : {};
 if (!containerId) {
  // 1단계: 컨테이너는 외부에 보이지 않으므로 읽기 규율(재시도 가능)로 보낸다. 성공해야만 저널에 created를 적는다.
  const created = await runWithBackoff<unknown>({key: input.key, limit: input.limit, write: false, policy, send: async () => { const a = await input.createContainer(childList); return {...a, value: a.payload}; }}, deps);
  attempts += created.attempts;
  containerId = created.outcome === 'success' ? payloadId(created.value) : null;
  if (!containerId) {
   const outcome = created.outcome === 'success' ? 'fatal' : created.outcome;
   await input.journal.set({...base, state: 'failed', containerId: null, attempts, error: '컨테이너 생성 실패: ' + (created.outcome === 'success' ? '응답에 id가 없습니다' : outcomeError(created.last)), updatedAt: now()});
   return {outcome: outcome === 'unknown' ? 'retryable' : outcome, attempts, error: '컨테이너를 만들지 못했습니다(' + (created.outcome === 'success' ? '응답에 id 없음' : outcomeError(created.last)) + ').'};
  }
  await input.journal.set({...base, ...kidMeta, state: 'created', containerId, attempts, updatedAt: now()});
 }
 // 2단계: 보이는 쓰기. 보내기 직전 publishing을 적고, 결과를 모르면 unknown으로 남긴다(재시도 없음).
 const id = containerId;
 const published = await runWithBackoff<unknown>({
  key: input.key, limit: input.limit, write: true, policy,
  onBeforeSend: async () => { await input.journal.set({...base, ...kidMeta, state: 'publishing', containerId: id, attempts: attempts + 1, updatedAt: now()}); },
  send: async () => { const a = await input.publish(id); return {...a, value: a.payload}; },
 }, deps);
 attempts += published.attempts;
 if (published.outcome === 'success') {
  const publishedId = payloadId(published.value);
  if (!publishedId) {
   await input.journal.set({...base, state: 'unknown', containerId: id, attempts, error: '게시 응답에 id가 없습니다.', updatedAt: now()});
   return {outcome: 'unknown', containerId: id, attempts, error: '게시 응답에 id가 없어 결과를 확정할 수 없습니다. 계정에서 확인하세요.'};
  }
  await input.journal.set({...base, ...kidMeta, state: 'published', containerId: id, publishedId, attempts, updatedAt: now()});
  return {outcome: 'success', id: publishedId, containerId: id, attempts};
 }
 const error = outcomeError(published.last);
 if (published.outcome === 'unknown') {
  await input.journal.set({...base, state: 'unknown', containerId: id, attempts, error, updatedAt: now()});
  return {outcome: 'unknown', containerId: id, attempts, error: '게시 요청을 보낸 뒤 결과를 받지 못했습니다(' + error + '). 계정에서 게시 여부를 확인하세요. 자동 재전송하지 않습니다.'};
 }
 // 거부(4xx)·한도(429 소진)·보내기 전 실패: 컨테이너는 남지만 게시물은 없다. 다음 실행은 처음부터 다시 한다.
 await input.journal.set({...base, state: 'failed', containerId: id, attempts, error, updatedAt: now()});
 return {outcome: published.outcome, containerId: id, attempts, error: (published.outcome === 'rate_limited' ? '게시 한도(429)에 막혔습니다' : '게시가 거부됐습니다') + '(' + error + ').'};
}

// {data:[{quota_usage, config:{quota_total, quota_duration}}]} 형태(Instagram content_publishing_limit·Threads threads_publishing_limit 공통). 없는 값은 null.
export function parsePublishLimit(payload: unknown): PublishLimit {
 const row = (Array.isArray((payload as {data?: unknown} | null)?.data) ? ((payload as {data: unknown[]}).data[0] as Record<string, unknown> | undefined) : undefined) ?? {};
 const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
 const config = (row.config ?? {}) as Record<string, unknown>;
 const used = n(row.quota_usage), total = n(config.quota_total), durationSeconds = n(config.quota_duration);
 return {used, total, durationSeconds, remaining: used !== null && total !== null ? Math.max(0, total - used) : null, raw: payload};
}
// {data:[{id,text,username,timestamp,like_count}]} 형태. 본문이 없는 항목은 뺀다. 자동 답글은 없다(수집만).
export function parseComments(payload: unknown): PublicationComment[] {
 const rows = Array.isArray((payload as {data?: unknown} | null)?.data) ? (payload as {data: unknown[]}).data : [];
 return rows.flatMap(r => {
  const c = r as Record<string, unknown>;
  const id = payloadId(c), text = typeof c.text === 'string' ? c.text : '';
  if (!id || !text) return [];
  return [{id, text: text.slice(0, 5000), username: typeof c.username === 'string' ? c.username : null, timestamp: typeof c.timestamp === 'string' ? c.timestamp : null, likeCount: typeof c.like_count === 'number' ? c.like_count : null}];
 });
}
// 캡션 공통 검사: 길이(공급자 한도)·해시태그 수(Instagram 30개). 비어 있으면 Instagram은 거부, Threads 텍스트는 본문이 필요하다.
export function captionIssues(text: string, max: number, maxHashtags: number | null): string[] {
 const issues: string[] = [];
 const length = [...text].length;
 if (length > max) issues.push(`캡션이 ${max.toLocaleString('ko-KR')}자를 넘습니다(현재 ${length.toLocaleString('ko-KR')}자).`);
 if (maxHashtags !== null) {
  const tags = (text.match(/(^|\s)#[^\s#]+/g) ?? []).length;
  if (tags > maxHashtags) issues.push(`해시태그가 ${maxHashtags}개를 넘습니다(현재 ${tags}개).`);
 }
 return issues;
}
// 공개 영상 주소 확인(HEAD, 릴스). 로그인 없이 video/*로 응답해야 하고 길이(content-length)를 돌려준다. 네트워크 실패는 ok:null(판정 불가).
export async function videoReachable(http: PublishHttp, url: string): Promise<{ok: boolean | null; bytes: number | null}> {
 try {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) return {ok: false, bytes: null};
  const r = await http.fetch(url, {method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(http.timeoutMs)});
  const length = Number(r.headers.get('content-length'));
  return {ok: r.ok && !!r.headers.get('content-type')?.startsWith('video/'), bytes: Number.isSafeInteger(length) && length > 0 ? length : null};
 } catch { return {ok: null, bytes: null}; }
}
// 계정의 최근 게시물(결과 미확인 대조용, 읽기만). Instagram /me/media(caption), Threads /me/threads(text). 본문이 없는 항목도 남긴다(대조에서 빠진다).
export type RecentMedia = {id: string; caption: string; timestamp: string | null; permalink: string | null};
export function parseRecentMedia(payload: unknown, textField: 'caption' | 'text' = 'caption'): RecentMedia[] {
 const rows = Array.isArray((payload as {data?: unknown} | null)?.data) ? (payload as {data: unknown[]}).data : [];
 return rows.flatMap(r => {
  const c = r as Record<string, unknown>, id = payloadId(c);
  if (!id) return [];
  return [{id, caption: typeof c[textField] === 'string' ? String(c[textField]) : '', timestamp: typeof c.timestamp === 'string' ? c.timestamp : null, permalink: typeof c.permalink === 'string' ? c.permalink : null}];
 });
}
