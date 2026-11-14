// C8 당근 광고 OpenAPI 커넥터(읽기·쓰기·전환 이벤트). 모든 호출은 lib/connectors/rate-queue.ts를 지난다(광고 계정 키마다 관리·성과 분당 60회, 이벤트 초당 100회).
// 규율: (1) 429는 Retry-After·지터 백오프로 기다린다. (2) 보낸 뒤 결과를 모르는 쓰기(타임아웃·연결 끊김·5xx)는 'unknown'이며 자동 재시도하지 않는다 — 읽기 대조로만 판정한다.
// (3) 무엇을 보낼지는 사람이 승인한 제안(lib/ads-proposals-daangn*.ts)이 정한다. 이 모듈은 요청을 만들고 보내기만 한다.
// 근거(2026-11-09 조사, 원문 미열람): 공개 베타 2026-10-16(business.daangn.com/notice/detail/420), 문서 ads-openapi.kr.karrotmarket.com. 읽기 캠페인·광고그룹·소재·기간 성과,
// 쓰기 캠페인·광고그룹·소재 등록·수정과 전환 이벤트 전송, 광고주별 키(문의로 발급, 재발급 시 이전 키 폐기), 대행사 경로 v1/agency/business-rights, 한도 관리·성과 분당 60회(광고 계정)·이벤트 초당 100회, 초과 시 429.
// 미확인(assumption, docs/DAANGN-ADS.ko.md): 인증 헤더 방식(기본 x-api-key, Bearer 선택), API 호스트, 경로·필드 이름, 예산 단위·최솟값. 실계정으로 확인한 뒤 DAANGN_PATHS·필드 목록만 고친다.
import {ApiError, str, stamp} from '../server';
import {HttpBodyError, readBoundedJson} from '../http-limits';
import {ConnectorAuthError} from './errors';
import {emptyQueue, runWithBackoff, type AttemptResult, type BackoffPolicy, type Outcome, type QueueState, type RunDeps} from './rate-queue';
import type {ContractConnector, ContractOperation} from './contract-test';
import type {Collected, CollectionWindow, ConnectorCapability, RateLimit} from './types';

export class DaangnAdsError extends Error { constructor(message: string) { super(message); this.name = 'DaangnAdsError'; } }

// 고정 호스트만 호출한다(사용자가 주소를 넣는 경로 없음, SSRF 표면 없음). 호스트 자체가 미확인 가정이다.
export const DAANGN_HOST = 'https://ads-openapi.kr.karrotmarket.com';
export const AUTH_HEADERS = ['x-api-key', 'bearer'] as const;
export type DaangnAuthHeader = typeof AUTH_HEADERS[number];
export type DaangnAdsCredential = {channel: 'daangn_ads'; apiKey: string; adAccountId: string; authHeader: DaangnAuthHeader; agency?: boolean};

export const MANAGEMENT_LIMIT: RateLimit = {perMinute: 60};
export const EVENT_LIMIT: RateLimit = {perSecond: 100};
export const readPolicy: BackoffPolicy = {maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60000};
export const writePolicy: BackoffPolicy = {maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60000};
export const DAANGN_FLAG = 'daangn_ads';
export const CAPABILITY_KEYS = {read: 'daangn_ads.management.read', write: 'daangn_ads.management.write', events: 'daangn_ads.conversion.send'} as const;
const TIMEOUT_MS = 20000, MAX_RESPONSE_BYTES = 500000, MAX_EVENTS = 50, MAX_READBACK = 20;
// 전환 이벤트 한 번 전송 상한(주문 장부 전송 큐 lib/daangn-conversions-server.ts가 같은 값으로 묶는다).
export const DAANGN_MAX_EVENTS = MAX_EVENTS;
// 예산(원): 정수, 100원 단위, 1,000원~1억 원(미확인 가정: 공개 문서의 최소 일 예산을 확인하지 못했다).
export const MIN_BUDGET = 1000, MAX_BUDGET = 100000000, BUDGET_STEP = 100;

// 경로 표(미확인 가정). 실제 문서와 다르면 여기만 고친다. acct는 광고 계정 ID다.
export const DAANGN_PATHS = {
 campaigns: (acct: string) => `/v1/ad-accounts/${acct}/campaigns`,
 campaign: (acct: string, id: string) => `/v1/ad-accounts/${acct}/campaigns/${id}`,
 adgroups: (acct: string) => `/v1/ad-accounts/${acct}/ad-groups`,
 adgroup: (acct: string, id: string) => `/v1/ad-accounts/${acct}/ad-groups/${id}`,
 creatives: (acct: string) => `/v1/ad-accounts/${acct}/creatives`,
 creative: (acct: string, id: string) => `/v1/ad-accounts/${acct}/creatives/${id}`,
 performance: (acct: string) => `/v1/ad-accounts/${acct}/reports/performance`,
 events: (acct: string) => `/v1/ad-accounts/${acct}/conversion-events`,
 businessRights: () => '/v1/agency/business-rights',
} as const;

export type DaangnTarget = 'campaign' | 'adgroup' | 'creative';
export type DaangnStatus = 'ACTIVE' | 'PAUSED';
export type DaangnOperation =
 | {op: 'create_campaign'; name: string; objective?: string; dailyBudget?: number}
 | {op: 'update_campaign'; campaignId: string; name?: string}
 | {op: 'create_adgroup'; campaignId: string; name: string; dailyBudget?: number; bidAmount?: number}
 | {op: 'update_adgroup'; adGroupId: string; name?: string; bidAmount?: number}
 | {op: 'create_creative'; adGroupId: string; title: string; body: string; landingUrl: string; imageUrl?: string}
 | {op: 'update_creative'; creativeId: string; title?: string; body?: string; landingUrl?: string}
 | {op: 'set_status'; target: DaangnTarget; id: string; status: DaangnStatus}
 | {op: 'set_daily_budget'; target: 'campaign' | 'adgroup'; id: string; dailyBudget: number};
export type DaangnRequest = {method: 'GET' | 'POST' | 'PATCH'; path: string; query: string; body?: unknown};
// 전환 이벤트: 원문 개인정보는 받지 않는다(사용자 식별자는 SHA-256 해시만). eventId는 중복 제거 키다.
export type ConversionEvent = {eventId: string; eventName: string; eventTime: string; value?: number; currency?: 'KRW'; hashedUserId?: string};

const id = (value: unknown, label: string) => {
 if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new DaangnAdsError(`${label} ID 형식이 올바르지 않습니다.`);
 return value;
};
const name = (value: unknown, label: string, max = 100) => {
 if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new DaangnAdsError(`${label}을(를) 1~${max}자로 입력하세요.`);
 return value.trim();
};
const https = (value: unknown, label: string) => {
 if (typeof value !== 'string' || !/^https:\/\/[^\s]{1,500}$/.test(value)) throw new DaangnAdsError(`${label}은(는) https 주소여야 합니다.`);
 return value;
};
export function checkBudget(value: unknown, label = '일 예산') {
 if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_BUDGET || value > MAX_BUDGET || value % BUDGET_STEP !== 0) throw new DaangnAdsError(`${label}은(는) ${MIN_BUDGET.toLocaleString('ko-KR')}~${MAX_BUDGET.toLocaleString('ko-KR')}원, ${BUDGET_STEP}원 단위여야 합니다.`);
 return value;
}
const bid = (value: unknown) => {
 if (typeof value !== 'number' || !Number.isInteger(value) || value < 10 || value > 1000000) throw new DaangnAdsError('입찰가는 10~1,000,000원 정수여야 합니다.');
 return value;
};
const q = (params: Record<string, string>) => '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const optional = <T>(value: T | undefined, check: (v: T) => unknown, key: string) => value === undefined ? {} : {[key]: check(value)};
const collectionOf = (acct: string, target: DaangnTarget) => target === 'campaign' ? DAANGN_PATHS.campaigns(acct) : target === 'adgroup' ? DAANGN_PATHS.adgroups(acct) : DAANGN_PATHS.creatives(acct);
export const itemPath = (acct: string, target: DaangnTarget, itemId: string) => target === 'campaign' ? DAANGN_PATHS.campaign(acct, itemId) : target === 'adgroup' ? DAANGN_PATHS.adgroup(acct, itemId) : DAANGN_PATHS.creative(acct, itemId);
const nonEmpty = (body: Record<string, unknown>, extra: number) => { if (Object.keys(body).length <= extra) throw new DaangnAdsError('바꿀 항목이 없습니다.'); return body; };

// 작업 → 요청(순수). 잘못된 입력은 보내기 전에 DaangnAdsError로 막는다.
export function buildDaangnRequest(op: DaangnOperation, adAccountId: string): DaangnRequest {
 const acct = id(adAccountId, '광고 계정');
 switch (op.op) {
  case 'create_campaign': return {method: 'POST', path: collectionOf(acct, 'campaign'), query: '', body: {name: name(op.name, '캠페인 이름'), status: 'PAUSED', ...optional(op.objective, v => name(v, '캠페인 목표', 40), 'objective'), ...optional(op.dailyBudget, v => checkBudget(v), 'dailyBudget')}};
  case 'update_campaign': return {method: 'PATCH', path: itemPath(acct, 'campaign', id(op.campaignId, '캠페인')), query: '', body: nonEmpty({...optional(op.name, v => name(v, '캠페인 이름'), 'name')}, 0)};
  case 'create_adgroup': return {method: 'POST', path: collectionOf(acct, 'adgroup'), query: '', body: {campaignId: id(op.campaignId, '캠페인'), name: name(op.name, '광고그룹 이름'), status: 'PAUSED', ...optional(op.dailyBudget, v => checkBudget(v), 'dailyBudget'), ...optional(op.bidAmount, bid, 'bidAmount')}};
  case 'update_adgroup': return {method: 'PATCH', path: itemPath(acct, 'adgroup', id(op.adGroupId, '광고그룹')), query: '', body: nonEmpty({...optional(op.name, v => name(v, '광고그룹 이름'), 'name'), ...optional(op.bidAmount, bid, 'bidAmount')}, 0)};
  case 'create_creative': return {method: 'POST', path: collectionOf(acct, 'creative'), query: '', body: {adGroupId: id(op.adGroupId, '광고그룹'), title: name(op.title, '소재 제목', 40), body: name(op.body, '소재 본문', 500), landingUrl: https(op.landingUrl, '연결 주소'), status: 'PAUSED', ...optional(op.imageUrl, v => https(v, '이미지 주소'), 'imageUrl')}};
  case 'update_creative': return {method: 'PATCH', path: itemPath(acct, 'creative', id(op.creativeId, '소재')), query: '', body: nonEmpty({...optional(op.title, v => name(v, '소재 제목', 40), 'title'), ...optional(op.body, v => name(v, '소재 본문', 500), 'body'), ...optional(op.landingUrl, v => https(v, '연결 주소'), 'landingUrl')}, 0)};
  case 'set_status':
   if (!['campaign', 'adgroup', 'creative'].includes(op.target)) throw new DaangnAdsError('상태 변경 대상은 campaign·adgroup·creative입니다.');
   if (op.status !== 'ACTIVE' && op.status !== 'PAUSED') throw new DaangnAdsError('상태는 ACTIVE(재개)·PAUSED(중지)입니다.');
   return {method: 'PATCH', path: itemPath(acct, op.target, id(op.id, '대상')), query: '', body: {status: op.status}};
  case 'set_daily_budget':
   if (op.target !== 'campaign' && op.target !== 'adgroup') throw new DaangnAdsError('예산 변경 대상은 campaign·adgroup입니다.');
   return {method: 'PATCH', path: itemPath(acct, op.target, id(op.id, '대상')), query: '', body: {dailyBudget: checkBudget(op.dailyBudget)}};
  default: throw new DaangnAdsError('지원하지 않는 당근 광고 쓰기 작업입니다.');
 }
}

export function buildEventsRequest(events: readonly ConversionEvent[], adAccountId: string): DaangnRequest {
 if (!Array.isArray(events) || !events.length || events.length > MAX_EVENTS) throw new DaangnAdsError(`전환 이벤트는 한 번에 1~${MAX_EVENTS}건입니다.`);
 const body = events.map(e => {
  if (!e || typeof e !== 'object') throw new DaangnAdsError('전환 이벤트 형식이 올바르지 않습니다.');
  if (!Number.isFinite(Date.parse(String(e.eventTime)))) throw new DaangnAdsError('전환 시각(eventTime)은 ISO 시각이어야 합니다.');
  if (e.hashedUserId !== undefined && !/^[a-f0-9]{64}$/.test(String(e.hashedUserId))) throw new DaangnAdsError('사용자 식별자는 SHA-256 해시(소문자 64자)만 보낼 수 있습니다. 원문 개인정보는 보내지 않습니다.');
  if (e.value !== undefined && (typeof e.value !== 'number' || !Number.isFinite(e.value) || e.value < 0)) throw new DaangnAdsError('전환 금액은 0 이상의 숫자입니다.');
  return {eventId: id(e.eventId, '이벤트'), eventName: name(e.eventName, '이벤트 이름', 40), eventTime: new Date(String(e.eventTime)).toISOString(), ...(e.value !== undefined ? {value: e.value, currency: 'KRW'} : {}), ...(e.hashedUserId ? {hashedUserId: e.hashedUserId} : {})};
 });
 return {method: 'POST', path: DAANGN_PATHS.events(id(adAccountId, '광고 계정')), query: '', body: {events: body}};
}

export function authHeaders(credential: DaangnAdsCredential): Record<string, string> {
 const auth: Record<string, string> = credential.authHeader === 'bearer' ? {Authorization: `Bearer ${credential.apiKey}`} : {'x-api-key': credential.apiKey};
 return {...auth, Accept: 'application/json', 'Content-Type': 'application/json'};
}

export type DaangnAttempt = AttemptResult & {value?: unknown; detail?: string};
const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
async function bodyOf(response: Response): Promise<{value: unknown; detail: string}> {
 try { return {value: await readBoundedJson<unknown>(response, MAX_RESPONSE_BYTES), detail: ''}; }
 catch (error) { return {value: undefined, detail: error instanceof HttpBodyError && error.status === 413 ? '응답이 500KB를 넘어 읽지 않았습니다.' : '응답 형식을 읽지 못했습니다.'}; }
}
// 공급자 오류 본문에서 사람이 읽을 사유만 뽑는다(키·토큰 없음).
export function describeError(value: unknown) {
 if (!value || typeof value !== 'object') return '';
 const v = value as Record<string, unknown>, nested = v.error && typeof v.error === 'object' ? v.error as Record<string, unknown> : {};
 return [v.code ?? nested.code, v.message ?? nested.message, v.detail].filter(x => typeof x === 'string' || typeof x === 'number').map(String).join(' · ').slice(0, 300);
}
// 한 번의 시도. fetch 예외는 '보냈을 수 있음'(sent:true)으로 본다 — 쓰기는 unknown이 안전하다. 읽기는 큐가 재시도한다.
export async function attempt(credential: DaangnAdsCredential, request: DaangnRequest, timeoutMs = TIMEOUT_MS): Promise<DaangnAttempt> {
 let response: Response;
 try {
  response = await fetch(DAANGN_HOST + request.path + request.query, {method: request.method, redirect: 'manual', headers: authHeaders(credential), ...(request.body === undefined ? {} : {body: JSON.stringify(request.body)}), signal: AbortSignal.timeout(timeoutMs)});
 } catch (error) {
  return {kind: isTimeout(error) ? 'timeout' : 'network_error', sent: true};
 }
 const retryAfter = response.headers.get('retry-after');
 if (response.status === 429 || response.status >= 500) { await response.body?.cancel().catch(() => undefined); return {kind: 'response', status: response.status, retryAfter}; }
 const parsed = await bodyOf(response);
 return {kind: 'response', status: response.status, retryAfter, value: parsed.value, detail: response.ok ? '' : describeError(parsed.value) || parsed.detail};
}

export type DaangnDeps = RunDeps & {timeoutMs?: number; state?: QueueState; onBeforeSend?: (attempt: number) => Promise<void>};
export const liveDeps = (): RunDeps => ({now: () => Date.now(), random: () => Math.random(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms))});
const queueKey = (credential: DaangnAdsCredential, lane: 'mgmt' | 'events') => `daangn_ads:${credential.adAccountId}:${lane}`;

// 읽기 클라이언트: 한 요청 안에서 큐 상태를 이어 쓴다(관리·성과 분당 60회를 넘지 않는다). 상태는 새 객체로만 바뀌고 닫힌 변수에 다시 묶는다.
export function daangnReader(credential: DaangnAdsCredential, deps: DaangnDeps = liveDeps()) {
 let state: QueueState = deps.state ?? emptyQueue;
 async function get(path: string, query = ''): Promise<unknown> {
  const run = await runWithBackoff<unknown>({key: queueKey(credential, 'mgmt'), limit: MANAGEMENT_LIMIT, write: false, policy: readPolicy, state, send: () => attempt(credential, {method: 'GET', path, query}, deps.timeoutMs)}, deps);
  state = run.state;
  const last = run.last as DaangnAttempt | null, status = last?.kind === 'response' ? last.status : null;
  if (run.outcome === 'success') return run.value;
  if (status === 401 || status === 403) throw new ConnectorAuthError('당근 광고 인증에 실패했습니다. API 키·광고 계정 ID·인증 헤더 방식을 확인하세요(키를 재발급하면 이전 키는 폐기됩니다).');
  if (run.outcome === 'rate_limited') throw new ApiError(429, '당근 광고 호출 한도(광고 계정당 분당 60회)를 넘었습니다. 잠시 후 다시 시도하세요.');
  if (status === 404) throw new ApiError(404, '당근 광고에서 대상을 찾지 못했습니다.');
  throw new ApiError(status && status < 500 ? 400 : 502, `당근 광고 요청을 처리하지 못했습니다${status ? ` (${status})` : ''}${last?.detail ? `: ${last.detail}` : ''}.`);
 }
 return {get, state: () => state};
}

export type Row = Record<string, unknown>;
export const rowsOf = (raw: unknown): Row[] => {
 const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (['data', 'items', 'content', 'results'].map(k => (raw as Row)[k]).find(Array.isArray) as unknown[] | undefined) ?? [raw] : [];
 return list.filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r));
};
const pick = (row: Row, keys: readonly string[]) => keys.map(k => row[k]).find(v => v !== undefined && v !== null);
const textOf = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const metric = (row: Row, keys: readonly string[]) => { const v = pick(row, keys); const n = typeof v === 'string' && v.trim() ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null; };
export const ID_KEYS: Record<DaangnTarget, readonly string[]> = {campaign: ['campaignId', 'id'], adgroup: ['adGroupId', 'adgroupId', 'id'], creative: ['creativeId', 'id']};
export const idOf = (row: Row, target: DaangnTarget) => textOf(pick(row, ID_KEYS[target]));
export const statusOf = (row: Row) => { const s = textOf(pick(row, ['status', 'state'])).toUpperCase(); return s === 'ACTIVE' || s === 'ON' || s === 'RUNNING' ? 'ACTIVE' : s === 'PAUSED' || s === 'OFF' || s === 'STOPPED' ? 'PAUSED' : s || null; };
export const budgetOf = (row: Row) => metric(row, ['dailyBudget', 'budget', 'dailyBudgetAmount']);

export type DaangnUnit = {target: 'campaign' | 'adgroup'; id: string; name: string; campaignId: string; status: string | null; dailyBudget: number | null};
export type PerformanceRow = {date: string; id: string; impressions: number | null; clicks: number | null; spend: number | null; conversions: number | null; conversionValue: number | null};
export const PERF_KEYS = {impressions: ['impressions', 'impressionCount', 'impCnt'], clicks: ['clicks', 'clickCount', 'clkCnt'], spend: ['spend', 'cost', 'adSpend'], conversions: ['conversions', 'conversionCount'], conversionValue: ['conversionValue', 'conversionAmount', 'revenue']} as const;
const isoDay = (value: unknown, label: string) => { const day = str(value, label, 20, true); if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))) throw new ApiError(400, `${label}을 YYYY-MM-DD 형식으로 입력하세요.`); return day; };

export async function listCampaigns(reader: ReturnType<typeof daangnReader>, credential: DaangnAdsCredential): Promise<DaangnUnit[]> {
 return rowsOf(await reader.get(DAANGN_PATHS.campaigns(credential.adAccountId))).map(r => ({target: 'campaign' as const, id: idOf(r, 'campaign'), name: textOf(r.name), campaignId: idOf(r, 'campaign'), status: statusOf(r), dailyBudget: budgetOf(r)})).filter(u => !!u.id);
}
export async function listAdgroups(reader: ReturnType<typeof daangnReader>, credential: DaangnAdsCredential, campaignId: string): Promise<DaangnUnit[]> {
 return rowsOf(await reader.get(DAANGN_PATHS.adgroups(credential.adAccountId), q({campaignId: id(campaignId, '캠페인')}))).map(r => ({target: 'adgroup' as const, id: idOf(r, 'adgroup'), name: textOf(r.name), campaignId, status: statusOf(r), dailyBudget: budgetOf(r)})).filter(u => !!u.id);
}
export async function listCreatives(reader: ReturnType<typeof daangnReader>, credential: DaangnAdsCredential, adGroupId: string): Promise<Row[]> {
 return rowsOf(await reader.get(DAANGN_PATHS.creatives(credential.adAccountId), q({adGroupId: id(adGroupId, '광고그룹')})));
}
// 기간 성과(일 단위). level campaign·ad_group, ids는 최대 100개. 측정 못 한 값은 null(0과 구분).
export async function performanceByDay(reader: ReturnType<typeof daangnReader>, credential: DaangnAdsCredential, input: {level: 'campaign' | 'adgroup'; ids: readonly string[]; window: CollectionWindow}): Promise<PerformanceRow[]> {
 const from = isoDay(input.window.from, '시작일'), to = isoDay(input.window.to, '종료일');
 if (from > to) throw new ApiError(400, '조회 기간을 확인하세요.');
 if (!input.ids.length || input.ids.length > 100) throw new ApiError(400, '성과 조회 대상은 1~100개입니다.');
 const target = input.level === 'campaign' ? 'campaign' : 'adgroup';
 const raw = await reader.get(DAANGN_PATHS.performance(credential.adAccountId), q({level: input.level === 'campaign' ? 'CAMPAIGN' : 'AD_GROUP', ids: input.ids.map(i => id(i, '대상')).join(','), startDate: from, endDate: to, timeUnit: 'DAY'}));
 return rowsOf(raw).map(r => ({date: textOf(pick(r, ['date', 'day', 'statDate'])).slice(0, 10), id: idOf(r, target), impressions: metric(r, PERF_KEYS.impressions), clicks: metric(r, PERF_KEYS.clicks), spend: metric(r, PERF_KEYS.spend), conversions: metric(r, PERF_KEYS.conversions), conversionValue: metric(r, PERF_KEYS.conversionValue)}));
}
// 기간 합계. 행이 하나도 없거나 그 지표가 모든 행에서 비면 null이다.
export type PerformanceTotal = {impressions: number | null; clicks: number | null; spend: number | null; conversions: number | null; conversionValue: number | null; days: number};
export function totalOf(rows: readonly PerformanceRow[]): PerformanceTotal {
 const sum = (k: Exclude<keyof PerformanceRow, 'date' | 'id'>) => { const vs = rows.map(r => r[k]).filter((v): v is number => typeof v === 'number'); return vs.length ? vs.reduce((a, b) => a + b, 0) : null; };
 return {impressions: sum('impressions'), clicks: sum('clicks'), spend: sum('spend'), conversions: sum('conversions'), conversionValue: sum('conversionValue'), days: new Set(rows.map(r => r.date)).size};
}

// 측정 기록 모양(lib/connectors/types.ts Collected)으로 돌려준다. 저장은 호출자(lib/daangn-ads-server.ts)가 한다.
export async function collectPerformance(credential: DaangnAdsCredential, target: {level: 'campaign' | 'adgroup'; id: string}, window: CollectionWindow, deps?: DaangnDeps): Promise<Collected> {
 const reader = daangnReader(credential, deps), rows = await performanceByDay(reader, credential, {level: target.level, ids: [target.id], window});
 const mine = rows.filter(r => !r.id || r.id === target.id), total = totalOf(mine);
 const limitations = [
  ...(!mine.length ? ['해당 기간에 반환된 성과 행이 없습니다. 대상 ID와 기간을 확인하세요.'] : []),
  ...(total.impressions === null ? ['노출 수를 확인하지 못했습니다.'] : []),
  ...(total.clicks === null ? ['클릭 수를 확인하지 못했습니다.'] : []),
  ...(total.spend === null ? ['광고비를 확인하지 못했습니다.'] : []),
  ...(total.conversions === null ? ['전환 수를 확인하지 못했습니다. 전환 이벤트 연결을 확인하세요.'] : []),
  '당근 광고 성과는 집계 지연이 있을 수 있습니다. 기간 종료 직후 값은 확정치가 아닙니다.',
  '응답 필드 이름은 공개 베타 문서를 실계정으로 확인하기 전 가정입니다(docs/DAANGN-ADS.ko.md).',
 ];
 return {
  arm: {denominator: total.impressions, numerator: total.clicks, source: `당근 광고 · 계정 ${credential.adAccountId} · ${target.level} ${target.id} · ${window.from}~${window.to}`},
  storeValues: {adSpend: total.spend, orders: total.conversions},
  account: credential.adAccountId,
  definition: '노출 대비 클릭(노출을 분모, 클릭을 분자로 사용). 광고비는 spend, 전환은 conversions(당근 광고 전환 정의).',
  window: {from: window.from, to: window.to}, fetchedAt: stamp(), limitations, raw: mine,
 };
}

export type WriteResult = {outcome: Outcome; attempts: number; httpStatus: number | null; providerIds: string[]; value?: unknown; error: string | null; waits: number[]; state: QueueState};
const targetOfOp = (op: DaangnOperation): DaangnTarget => op.op.endsWith('campaign') ? 'campaign' : op.op.endsWith('adgroup') ? 'adgroup' : op.op.endsWith('creative') ? 'creative' : (op as {target: DaangnTarget}).target;
export function providerIdsOf(op: DaangnOperation, value: unknown): string[] {
 if (op.op === 'set_status' || op.op === 'set_daily_budget') return [op.id];
 if (op.op === 'update_campaign') return [op.campaignId];
 if (op.op === 'update_adgroup') return [op.adGroupId];
 if (op.op === 'update_creative') return [op.creativeId];
 return rowsOf(value).map(r => idOf(r, targetOfOp(op))).filter(Boolean);
}
async function send(credential: DaangnAdsCredential, request: DaangnRequest, lane: 'mgmt' | 'events', deps: DaangnDeps) {
 return runWithBackoff<unknown>({key: queueKey(credential, lane), limit: lane === 'mgmt' ? MANAGEMENT_LIMIT : EVENT_LIMIT, write: true, policy: writePolicy, state: deps.state, send: () => attempt(credential, request, deps.timeoutMs), onBeforeSend: deps.onBeforeSend}, deps);
}
function writeError(outcome: Outcome, httpStatus: number | null, detail?: string) {
 return outcome === 'success' ? null
  : outcome === 'unknown' ? '응답을 받지 못해 반영 여부를 모릅니다. 자동 재시도하지 않으며 읽기 대조로 확인합니다.'
  : outcome === 'rate_limited' ? '호출 한도(429)가 계속되어 보내지 못했습니다. 잠시 후 다시 승인·반영하세요.'
  : `당근 광고가 요청을 거절했습니다${httpStatus ? ` (${httpStatus})` : ''}${detail ? `: ${detail}` : ''}`;
}
// 작업 하나를 한도 큐·백오프·unknown 규율로 보낸다. 호출자는 onBeforeSend로 '보냄'을 먼저 저장해 재시작 뒤 중복 전송을 막는다.
export async function executeDaangnWrite(credential: DaangnAdsCredential, op: DaangnOperation, deps: DaangnDeps = liveDeps()): Promise<WriteResult> {
 const request = buildDaangnRequest(op, credential.adAccountId), run = await send(credential, request, 'mgmt', deps);
 const last = run.last as DaangnAttempt | null, httpStatus = last?.kind === 'response' ? last.status : null;
 return {outcome: run.outcome, attempts: run.attempts, httpStatus, providerIds: run.outcome === 'success' ? providerIdsOf(op, run.value) : [], ...(run.outcome === 'success' ? {value: run.value} : {}), error: writeError(run.outcome, httpStatus, last?.detail), waits: run.waits, state: run.state};
}
// 전환 이벤트 전송(초당 100회 큐). 결과를 모르면 unknown이며 다시 보내지 않는다(공급자 eventId 중복 제거에 기대지 않는다).
export async function sendConversionEvents(credential: DaangnAdsCredential, events: readonly ConversionEvent[], deps: DaangnDeps = liveDeps()) {
 const request = buildEventsRequest(events, credential.adAccountId), run = await send(credential, request, 'events', deps);
 const last = run.last as DaangnAttempt | null, httpStatus = last?.kind === 'response' ? last.status : null;
 return {outcome: run.outcome, attempts: run.attempts, httpStatus, sent: (request.body as {events: unknown[]}).events.length, error: writeError(run.outcome, httpStatus, last?.detail), state: run.state};
}

// ----- 읽기 대조: 쓰기 결과를 GET으로 다시 읽어 기대 상태와 비교한다. unknown의 유일한 판정 수단이다. -----
export async function readBackDaangn(credential: DaangnAdsCredential, op: DaangnOperation, providerIds: readonly string[], deps?: DaangnDeps): Promise<Row[]> {
 const reader = daangnReader(credential, deps), target = targetOfOp(op), acct = credential.adAccountId;
 // 변경 작업은 대상 ID를 작업 자체가 안다(결과 미확인이라 공급자 ID가 비어 있어도 대조할 수 있다).
 const known = providerIds.length ? providerIds : op.op.startsWith('create_') ? [] : providerIdsOf(op, undefined);
 if (known.length) {
  const rows: Row[] = [];
  for (const p of known.slice(0, MAX_READBACK)) rows.push(...rowsOf(await reader.get(itemPath(acct, target, id(p, '대상')))));
  return rows;
 }
 // 생성 결과 ID를 모르면(unknown) 부모 목록에서 이름으로 찾는다.
 if (op.op === 'create_campaign') return rowsOf(await reader.get(DAANGN_PATHS.campaigns(acct)));
 if (op.op === 'create_adgroup') return rowsOf(await reader.get(DAANGN_PATHS.adgroups(acct), q({campaignId: op.campaignId})));
 if (op.op === 'create_creative') return rowsOf(await reader.get(DAANGN_PATHS.creatives(acct), q({adGroupId: op.adGroupId})));
 return [];
}
export type Verification = {status: 'verified' | 'mismatch'; details: string[]; providerIds: string[]};
const same = (a: unknown, b: unknown) => a === b || String(a) === String(b);
// 기대 상태와 관측 행 비교(순수). 대상 행이 없으면 mismatch다.
export function verifyDaangnReadBack(op: DaangnOperation, providerIds: readonly string[], observed: readonly Row[]): Verification {
 const target = targetOfOp(op), details: string[] = [];
 if (op.op === 'create_campaign' || op.op === 'create_adgroup' || op.op === 'create_creative') {
  const label = op.op === 'create_creative' ? op.title : op.name, key = op.op === 'create_creative' ? 'title' : 'name';
  const found = providerIds.length ? observed.filter(r => providerIds.includes(idOf(r, target))) : observed.filter(r => same(r[key], label));
  if (!found.length) details.push(providerIds.length ? `${providerIds.join(',')}를 읽지 못했습니다.` : `'${label}'을(를) 찾지 못했습니다.`);
  return {status: details.length ? 'mismatch' : 'verified', details, providerIds: found.map(r => idOf(r, target)).filter(Boolean)};
 }
 const wantId = providerIdsOf(op, undefined)[0], row = observed.find(r => idOf(r, target) === wantId);
 if (!row) return {status: 'mismatch', details: [`${wantId}를 읽지 못했습니다.`], providerIds: []};
 if (op.op === 'set_status' && statusOf(row) !== op.status) details.push(`${wantId} 상태 ${String(statusOf(row))} ≠ 기대 ${op.status}`);
 if (op.op === 'set_daily_budget' && budgetOf(row) !== op.dailyBudget) details.push(`${wantId} 일 예산 ${String(budgetOf(row))} ≠ 기대 ${op.dailyBudget}`);
 const fields = op.op === 'update_campaign' ? {name: op.name} : op.op === 'update_adgroup' ? {name: op.name, bidAmount: op.bidAmount} : op.op === 'update_creative' ? {title: op.title, body: op.body, landingUrl: op.landingUrl} : {};
 for (const [k, v] of Object.entries(fields)) if (v !== undefined && !same(row[k], v)) details.push(`${wantId} ${k} ${String(row[k])} ≠ 기대 ${String(v)}`);
 return {status: details.length ? 'mismatch' : 'verified', details, providerIds: [wantId]};
}

// ----- 계약 테스트 하네스용 커넥터: 실제 요청 빌더를 거쳐 transport(스크립트·모의)로 보낸다. 네트워크 없음. -----
export type DaangnTransport = (request: DaangnRequest, op: ContractOperation, attempt: number) => Promise<AttemptResult & {value?: unknown}>;
export function daangnContractConnector(capabilities: readonly ConnectorCapability[], adAccountId: string, transport: DaangnTransport): ContractConnector & {calls(): Record<string, number>} {
 const calls: Record<string, number> = {};
 return {
  capabilities,
  calls: () => ({...calls}),
  async execute(op, n) {
   calls[op.id] = (calls[op.id] ?? 0) + 1;
   const request = op.capability === CAPABILITY_KEYS.events ? buildEventsRequest(op.payload as ConversionEvent[], adAccountId)
    : op.capability === CAPABILITY_KEYS.write ? buildDaangnRequest(op.payload as DaangnOperation, adAccountId)
    : {method: 'GET' as const, path: DAANGN_PATHS.campaigns(adAccountId), query: ''};
   return transport(request, op, n);
  },
 };
}

// 자격증명 입력 검증(저장 전). 키 원문은 응답·로그에 싣지 않는다.
export function parseDaangnCredential(input: Record<string, unknown>): DaangnAdsCredential {
 const authHeader = input.authHeader === undefined || input.authHeader === null || input.authHeader === '' ? 'x-api-key' : input.authHeader;
 if (!AUTH_HEADERS.includes(authHeader as DaangnAuthHeader)) throw new ApiError(400, "인증 헤더 방식은 'x-api-key'(기본) 또는 'bearer'입니다.");
 const adAccountId = str(input.adAccountId, '광고 계정 ID', 64, true);
 if (!/^[A-Za-z0-9_-]{1,64}$/.test(adAccountId)) throw new ApiError(400, '광고 계정 ID 형식을 확인하세요.');
 return {channel: 'daangn_ads', apiKey: str(input.apiKey, '당근 광고 API 키', 500, true), adAccountId, authHeader: authHeader as DaangnAuthHeader, ...(input.agency === true ? {agency: true} : {})};
}
// 연결 확인: 캠페인 목록 GET(본문은 개수만). 대행사 키면 business-rights도 읽어 이 광고 계정 권한을 확인한다.
export async function verifyDaangn(credential: DaangnAdsCredential, deps?: DaangnDeps): Promise<{account: string; campaigns: number; agencyRight: boolean | null}> {
 const reader = daangnReader(credential, deps), campaigns = rowsOf(await reader.get(DAANGN_PATHS.campaigns(credential.adAccountId))).length;
 if (!credential.agency) return {account: credential.adAccountId, campaigns, agencyRight: null};
 const rights = rowsOf(await reader.get(DAANGN_PATHS.businessRights()));
 return {account: credential.adAccountId, campaigns, agencyRight: rights.some(r => textOf(pick(r, ['adAccountId', 'accountId', 'id'])) === credential.adAccountId)};
}
