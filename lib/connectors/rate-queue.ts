// C1 호출 한도 큐·429 백오프(순수). fetch·D1·시계를 모르고 모든 입력(now·random·sleep)을 받는다. 상태는 바꾸지 않고 새 객체를 돌려준다.
// 규율: (1) 계정 키마다 고정 창(초·분·일) 상한 안에서만 보낸다. (2) 429는 Retry-After를 따르고, 없으면 지터 있는 지수 백오프다.
// (3) 보낸 뒤 결과를 모르는 쓰기(타임아웃·연결 끊김·5xx)는 outcome 'unknown'이며 절대 자동 재시도하지 않는다(lib/meta-image-upload.ts와 같은 태도). 읽기는 재시도한다.
import type {RateLimit} from './types';

export type Outcome = 'success' | 'retryable' | 'rate_limited' | 'fatal' | 'unknown';
// 한 번의 시도 결과. sent: 요청 바이트가 상대에게 도달했을 수 있는지(연결 뒤 끊김·응답 대기 중 타임아웃은 true, DNS·연결 거부는 false).
export type AttemptResult =
 | {kind: 'response'; status: number; retryAfter?: string | null}
 | {kind: 'timeout'; sent: boolean}
 | {kind: 'network_error'; sent: boolean}
 | {kind: 'thrown'};
export type Window = 'second' | 'minute' | 'day';
export type WindowState = {readonly start: number; readonly count: number};
export type BucketState = Readonly<Partial<Record<Window, WindowState>>>;
export type QueueState = Readonly<Record<string, BucketState>>;
export type BackoffPolicy = {maxAttempts: number; baseDelayMs: number; maxDelayMs: number};
export type RetryDecision = {retry: boolean; reason: 'done' | 'fatal' | 'unknown_write' | 'max_attempts' | 'retry'};

const WINDOW_MS: Record<Window, number> = {second: 1000, minute: 60000, day: 86400000};
const LIMIT_KEY: Record<Window, keyof RateLimit> = {second: 'perSecond', minute: 'perMinute', day: 'perDay'};
export const emptyQueue: QueueState = {};

// 계정 키 하나에 대해 지금 보낼 수 있는지. allowed면 세어 둔 새 상태를, 아니면 가장 늦게 열리는 창까지의 대기 시간을 준다. 한도가 없는 창은 보지 않는다.
export function reserve(state: QueueState, key: string, limit: RateLimit, now: number): {state: QueueState; allowed: boolean; waitMs: number} {
 const bucket = state[key] ?? {};
 const windows = (Object.keys(WINDOW_MS) as Window[]).filter(w => typeof limit[LIMIT_KEY[w]] === 'number' && (limit[LIMIT_KEY[w]] as number) > 0);
 const current = Object.fromEntries(windows.map(w => {
  const prev = bucket[w];
  return [w, prev && now - prev.start < WINDOW_MS[w] ? prev : {start: now, count: 0}];
 })) as Record<Window, WindowState>;
 const waits = windows.filter(w => current[w].count >= (limit[LIMIT_KEY[w]] as number)).map(w => current[w].start + WINDOW_MS[w] - now);
 if (waits.length) return {state: {...state, [key]: current}, allowed: false, waitMs: Math.max(1, ...waits)};
 const next = Object.fromEntries(windows.map(w => [w, {start: current[w].start, count: current[w].count + 1}])) as Record<Window, WindowState>;
 return {state: {...state, [key]: next}, allowed: true, waitMs: 0};
}

// 시도 결과를 분류한다. write=true면 상대에 도달했을 수 있는 실패는 모두 unknown이다.
export function classifyOutcome(result: AttemptResult, write: boolean): Outcome {
 if (result.kind === 'response') {
  if (result.status >= 200 && result.status < 300) return 'success';
  if (result.status === 429) return 'rate_limited';
  if (result.status >= 500 || result.status === 408) return write ? 'unknown' : 'retryable';
  return 'fatal';
 }
 if (result.kind === 'thrown') return 'fatal';
 return result.sent && write ? 'unknown' : 'retryable';
}

// Retry-After 헤더: 초(정수) 또는 HTTP 날짜. 해석할 수 없으면 null. 음수·과거는 0이다.
export function retryAfterMs(value: string | null | undefined, now: number): number | null {
 if (typeof value !== 'string' || !value.trim()) return null;
 const text = value.trim();
 if (/^\d{1,7}$/.test(text)) return Number(text) * 1000;
 const at = Date.parse(text);
 return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

// 다음 대기 시간. Retry-After가 있으면 그 값(상한 안), 없으면 base·2^(attempt-1)에 0.5~1.5 지터(random은 [0,1)). attempt는 방금 실패한 시도 번호(1부터).
export function nextDelayMs(input: {attempt: number; policy: BackoffPolicy; retryAfterMs?: number | null; random: () => number}): number {
 const {policy} = input;
 if (typeof input.retryAfterMs === 'number') return Math.min(policy.maxDelayMs, Math.max(0, input.retryAfterMs));
 const exponential = policy.baseDelayMs * 2 ** Math.max(0, input.attempt - 1);
 const jitter = 0.5 + Math.min(Math.max(input.random(), 0), 0.999999);
 return Math.min(policy.maxDelayMs, Math.round(exponential * jitter));
}

export function retryDecision(input: {outcome: Outcome; attempt: number; policy: BackoffPolicy; write: boolean}): RetryDecision {
 if (input.outcome === 'success') return {retry: false, reason: 'done'};
 if (input.outcome === 'fatal') return {retry: false, reason: 'fatal'};
 if (input.outcome === 'unknown') return {retry: false, reason: 'unknown_write'};
 return input.attempt < input.policy.maxAttempts ? {retry: true, reason: 'retry'} : {retry: false, reason: 'max_attempts'};
}

export type RunDeps = {now: () => number; random: () => number; sleep: (ms: number) => Promise<void>};
export type RunInput<T> = {
 key: string;
 limit: RateLimit;
 write: boolean;
 policy: BackoffPolicy;
 state?: QueueState;
 send: (attempt: number) => Promise<AttemptResult & {value?: T}>;
 // 쓰기는 보내기 직전에 '보냄'을 영속해 두어야 재시작 뒤 중복 전송을 막는다. 호출자가 저널을 주면 시도마다 부른다.
 onBeforeSend?: (attempt: number) => Promise<void>;
};
export type RunResult<T> = {outcome: Outcome; attempts: number; state: QueueState; last: AttemptResult | null; value?: T; waits: number[]};

// 한도 예약 → 전송 → 분류 → 재시도 판단을 돈다. 한도에 막히면 그 시간을 자고 다시 예약한다(최대 대기 maxDelayMs씩).
export async function runWithBackoff<T>(input: RunInput<T>, deps: RunDeps): Promise<RunResult<T>> {
 let state = input.state ?? emptyQueue, last: AttemptResult | null = null, outcome: Outcome = 'retryable';
 const waits: number[] = [];
 for (let attempt = 1; ; attempt++) {
  for (;;) {
   const r = reserve(state, input.key, input.limit, deps.now());
   state = r.state;
   if (r.allowed) break;
   const wait = Math.min(r.waitMs, input.policy.maxDelayMs);
   waits.push(wait);
   await deps.sleep(wait);
  }
  if (input.onBeforeSend) await input.onBeforeSend(attempt);
  let result: AttemptResult & {value?: T};
  try { result = await input.send(attempt); } catch { result = {kind: 'thrown'}; }
  last = result;
  outcome = classifyOutcome(result, input.write);
  const decision = retryDecision({outcome, attempt, policy: input.policy, write: input.write});
  if (!decision.retry) return {outcome, attempts: attempt, state, last, waits, ...(outcome === 'success' && 'value' in result ? {value: result.value} : {})};
  const retryAfter = result.kind === 'response' ? retryAfterMs(result.retryAfter, deps.now()) : null;
  const delay = nextDelayMs({attempt, policy: input.policy, retryAfterMs: retryAfter, random: deps.random});
  waits.push(delay);
  await deps.sleep(delay);
 }
}
