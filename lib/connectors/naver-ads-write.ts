// C4 네이버 검색광고 쓰기(POST/PUT). 서명·호스트는 lib/connectors/naver-ads.ts를 그대로 쓰고(GET 동작 불변), 모든 쓰기는 lib/connectors/rate-queue.ts를 지난다.
// 규율: (1) 계정(Customer ID) 키마다 한도 큐. (2) 429는 Retry-After·지터 백오프로 재시도. (3) 보낸 뒤 결과를 모르는 쓰기(타임아웃·연결 끊김·5xx)는 'unknown'이며
// 절대 자동 재시도하지 않는다 — 읽기 대조(readBack)로만 결정한다. (4) 자동 입찰은 없다. 이 모듈은 요청을 만들고 보내기만 하며 무엇을 보낼지는 사람이 승인한 제안(lib/ads-proposals*.ts)이 정한다.
// 근거(2026-11-09 확인): 서명 식·엔드포인트·본문 형태는 github.com/naver/searchad-apidoc python-sample(ad_management_sample.py)과 wiki FAQ를 따른다.
// FAQ: 호출 속도 제한은 Customer ID 기준·초 단위 이하·숫자 비공개·초과 시 429. 플레이스 캠페인(PLACE)은 PLACE·LOCAL_AD 그룹 유형과 PLACE 사업 채널만 허용.
// 미확인(assumption): PLACE 캠페인·LOCAL_AD 그룹·LOCAL_AD 소재 생성이 API로 실제 허용되는지는 실계정으로 확인해야 한다(docs/NAVER-ADS-WRITE.ko.md).
import {call, signedRequest} from './naver-ads';
import {runWithBackoff, type AttemptResult, type BackoffPolicy, type QueueState, type RunDeps, type Outcome} from './rate-queue';
import type {ContractConnector, ContractOperation} from './contract-test';
import type {ConnectorCapability, NaverAdsCredential, RateLimit} from './types';

export class NaverAdsWriteError extends Error { constructor(message: string) { super(message); this.name = 'NaverAdsWriteError'; } }

export type CampaignType = 'WEB_SITE' | 'PLACE';
export type AdgroupType = 'WEB_SITE' | 'PLACE' | 'LOCAL_AD';
export type LockTarget = 'campaign' | 'adgroup' | 'keyword';
// TEXT_45: 파워링크 단일형 소재. LOCAL_AD: 플레이스 검색 소재(FAQ 'LOCAL_AD 플레이스 검색 소재'). PLACE_AD: 지역소상공인 소재(ad 본문 없음).
export type AdCreative =
 | {type: 'TEXT_45'; headline: string; description: string; pcFinalUrl: string; mobileFinalUrl: string}
 | {type: 'LOCAL_AD'; description: string; images?: readonly string[]}
 | {type: 'PLACE_AD'};
export type WriteOperation =
 | {op: 'create_campaign'; name: string; campaignType: CampaignType; dailyBudget?: number}
 | {op: 'create_adgroup'; campaignId: string; name: string; adgroupType: AdgroupType; pcChannelId: string; mobileChannelId: string; bidAmt?: number}
 | {op: 'create_keywords'; adgroupId: string; keywords: readonly {keyword: string; bidAmt?: number}[]}
 | {op: 'update_bid'; keywordIds: readonly string[]; bidAmt: number}
 | {op: 'set_user_lock'; target: LockTarget; ids: readonly string[]; userLock: boolean}
 | {op: 'create_ad'; adgroupId: string; creative: AdCreative};
export type WriteRequest = {method: 'POST' | 'PUT'; path: string; query: string; body: unknown};

// 네이버 입찰가 범위(원): 최소 70, 최대 100,000, 10원 단위.
export const MIN_BID = 70, MAX_BID = 100000, BID_STEP = 10;
export const MAX_BULK_KEYWORDS = 100;
export const WRITE_CAPABILITY_KEY = 'naver_ads.ncc.write';
// FAQ는 초당 한도를 공개하지 않는다. 운영 관측 전까지는 보수적으로 둔다(429를 받으면 큐가 Retry-After·백오프로 대기한다).
export const writeLimit: RateLimit = {perSecond: 5, perMinute: 120, perDay: 3000};
export const writePolicy: BackoffPolicy = {maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000};
const MAX_RESPONSE_BYTES = 200000;

const id = (value: unknown, label: string) => {
 if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new NaverAdsWriteError(`${label} ID 형식이 올바르지 않습니다.`);
 return value;
};
const ids = (values: readonly unknown[], label: string, max: number) => {
 if (!Array.isArray(values) || !values.length || values.length > max) throw new NaverAdsWriteError(`${label}은(는) 1~${max}개여야 합니다.`);
 return values.map(v => id(v, label));
};
const name = (value: unknown, label: string) => {
 if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) throw new NaverAdsWriteError(`${label}을(를) 1~100자로 입력하세요.`);
 return value.trim();
};
export function checkBid(value: unknown, label = '입찰가') {
 if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_BID || value > MAX_BID || value % BID_STEP !== 0) throw new NaverAdsWriteError(`${label}은(는) ${MIN_BID}~${MAX_BID.toLocaleString('ko-KR')}원, ${BID_STEP}원 단위여야 합니다.`);
 return value;
}
const url = (value: unknown, label: string) => {
 if (typeof value !== 'string' || !/^https?:\/\/[^\s]{1,500}$/.test(value)) throw new NaverAdsWriteError(`${label}은(는) http(s) 주소여야 합니다.`);
 return value;
};
const q = (params: Record<string, string>) => '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

function campaignRequest(op: Extract<WriteOperation, {op: 'create_campaign'}>, customerId: string): WriteRequest {
 if (op.campaignType !== 'WEB_SITE' && op.campaignType !== 'PLACE') throw new NaverAdsWriteError('캠페인 유형은 WEB_SITE(파워링크) 또는 PLACE(플레이스)입니다.');
 const budget = op.dailyBudget === undefined ? {} : {useDailyBudget: true, dailyBudget: checkBid(op.dailyBudget, '일 예산')};
 return {method: 'POST', path: '/ncc/campaigns', query: '', body: {name: name(op.name, '캠페인 이름'), campaignTp: op.campaignType, customerId: Number(customerId), useDailyBudget: false, ...budget}};
}
function adgroupRequest(op: Extract<WriteOperation, {op: 'create_adgroup'}>): WriteRequest {
 if (!['WEB_SITE', 'PLACE', 'LOCAL_AD'].includes(op.adgroupType)) throw new NaverAdsWriteError('광고그룹 유형은 WEB_SITE·PLACE·LOCAL_AD 중 하나입니다.');
 const bid = op.bidAmt === undefined ? {} : {bidAmt: checkBid(op.bidAmt), useKeywordPlus: false};
 return {method: 'POST', path: '/ncc/adgroups', query: '', body: {nccCampaignId: id(op.campaignId, '캠페인'), name: name(op.name, '광고그룹 이름'), adgroupType: op.adgroupType, pcChannelId: id(op.pcChannelId, 'PC 채널'), mobileChannelId: id(op.mobileChannelId, '모바일 채널'), useDailyBudget: false, ...bid}};
}
function keywordsRequest(op: Extract<WriteOperation, {op: 'create_keywords'}>): WriteRequest {
 if (!Array.isArray(op.keywords) || !op.keywords.length || op.keywords.length > MAX_BULK_KEYWORDS) throw new NaverAdsWriteError(`키워드는 한 번에 1~${MAX_BULK_KEYWORDS}개입니다.`);
 const body = op.keywords.map(k => ({keyword: name(k.keyword, '키워드'), ...(k.bidAmt === undefined ? {useGroupBidAmt: true} : {bidAmt: checkBid(k.bidAmt), useGroupBidAmt: false})}));
 return {method: 'POST', path: '/ncc/keywords', query: q({nccAdgroupId: id(op.adgroupId, '광고그룹')}), body};
}
function bidRequest(op: Extract<WriteOperation, {op: 'update_bid'}>): WriteRequest {
 const bid = checkBid(op.bidAmt);
 return {method: 'PUT', path: '/ncc/keywords', query: q({fields: 'bidAmt'}), body: ids(op.keywordIds, '키워드', MAX_BULK_KEYWORDS).map(nccKeywordId => ({nccKeywordId, bidAmt: bid, useGroupBidAmt: false}))};
}
function lockRequest(op: Extract<WriteOperation, {op: 'set_user_lock'}>): WriteRequest {
 if (typeof op.userLock !== 'boolean') throw new NaverAdsWriteError('userLock은 true(중지)·false(재개)입니다.');
 if (op.target === 'keyword') return {method: 'PUT', path: '/ncc/keywords', query: q({fields: 'userLock'}), body: ids(op.ids, '키워드', MAX_BULK_KEYWORDS).map(nccKeywordId => ({nccKeywordId, userLock: op.userLock}))};
 if (op.target !== 'campaign' && op.target !== 'adgroup') throw new NaverAdsWriteError('중지·재개 대상은 campaign·adgroup·keyword입니다.');
 // 캠페인·광고그룹은 공식 샘플이 보여 주는 단건 경로만 쓴다(목록 PUT은 미확인).
 const [one] = ids(op.ids, op.target === 'campaign' ? '캠페인' : '광고그룹', 1);
 return op.target === 'campaign'
  ? {method: 'PUT', path: `/ncc/campaigns/${one}`, query: q({fields: 'userLock'}), body: {nccCampaignId: one, userLock: op.userLock}}
  : {method: 'PUT', path: `/ncc/adgroups/${one}`, query: q({fields: 'userLock'}), body: {nccAdgroupId: one, userLock: op.userLock}};
}
function adRequest(op: Extract<WriteOperation, {op: 'create_ad'}>): WriteRequest {
 const adgroup = id(op.adgroupId, '광고그룹'), c = op.creative;
 if (c.type === 'TEXT_45') return {method: 'POST', path: '/ncc/ads', query: '', body: {nccAdgroupId: adgroup, type: 'TEXT_45', ad: {headline: name(c.headline, '제목'), description: name(c.description, '설명'), pc: {final: url(c.pcFinalUrl, 'PC 연결 주소')}, mobile: {final: url(c.mobileFinalUrl, '모바일 연결 주소')}}}};
 if (c.type === 'LOCAL_AD') return {method: 'POST', path: '/ncc/ads', query: '', body: {nccAdgroupId: adgroup, type: 'LOCAL_AD', ad: {description: name(c.description, '설명'), ...(c.images ? {images: c.images.map(i => url(i, '이미지 주소'))} : {})}}};
 if (c.type === 'PLACE_AD') return {method: 'POST', path: '/ncc/ads', query: '', body: {nccAdgroupId: adgroup, type: 'PLACE_AD', ad: {}}};
 throw new NaverAdsWriteError('소재 유형은 TEXT_45·LOCAL_AD·PLACE_AD 중 하나입니다.');
}

// 작업 → 서명 전 요청(순수). 잘못된 입력은 보내기 전에 NaverAdsWriteError로 막는다.
export function buildWriteRequest(op: WriteOperation, customerId: string): WriteRequest {
 switch (op.op) {
  case 'create_campaign': return campaignRequest(op, customerId);
  case 'create_adgroup': return adgroupRequest(op);
  case 'create_keywords': return keywordsRequest(op);
  case 'update_bid': return bidRequest(op);
  case 'set_user_lock': return lockRequest(op);
  case 'create_ad': return adRequest(op);
  default: throw new NaverAdsWriteError('지원하지 않는 쓰기 작업입니다.');
 }
}

export type WriteAttempt = AttemptResult & {value?: unknown; detail?: string};
const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
async function bodyOf(response: Response) {
 const text = await response.text().catch(() => '');
 if (text.length > MAX_RESPONSE_BYTES) return {value: undefined, detail: '응답이 200KB를 넘어 읽지 않았습니다.'};
 try { return {value: text ? JSON.parse(text) as unknown : undefined, detail: ''}; } catch { return {value: undefined, detail: text.slice(0, 300)}; }
}
// 한 번의 시도. fetch 예외는 모두 '보냈을 수 있음'(sent:true)으로 본다 — 워커 환경은 연결 전 실패와 응답 대기 중 끊김을 구분하지 못하므로 쓰기는 unknown이 안전하다.
export async function attemptWrite(credential: NaverAdsCredential, request: WriteRequest, deps: Pick<RunDeps, 'now'> & {timeoutMs?: number}): Promise<WriteAttempt> {
 let response: Response;
 try {
  response = await signedRequest(credential, request.method, request.path, {query: request.query, body: request.body, timeoutMs: deps.timeoutMs, now: deps.now});
 } catch (error) {
  return {kind: isTimeout(error) ? 'timeout' : 'network_error', sent: true};
 }
 const retryAfter = response.headers.get('retry-after');
 if (response.status === 429 || response.status >= 500) { await response.body?.cancel().catch(() => undefined); return {kind: 'response', status: response.status, retryAfter}; }
 const parsed = await bodyOf(response);
 const detail = response.ok ? '' : describeError(parsed.value) || parsed.detail;
 return {kind: 'response', status: response.status, retryAfter, value: parsed.value, detail};
}
// 네이버 오류 본문 {code,title,detail} 또는 {type,title,detail}에서 사람이 읽을 사유만 뽑는다(토큰·키 없음).
export function describeError(value: unknown) {
 if (!value || typeof value !== 'object') return '';
 const v = value as Record<string, unknown>;
 return [v.code, v.title, v.detail].filter(x => typeof x === 'string' || typeof x === 'number').map(String).join(' · ').slice(0, 300);
}

// 공급자가 돌려준 ID. 목록 응답은 모든 ID를 모은다.
export function providerIdsOf(op: WriteOperation, value: unknown): string[] {
 const key = op.op === 'create_campaign' ? 'nccCampaignId' : op.op === 'create_adgroup' ? 'nccAdgroupId' : op.op === 'create_ad' ? 'nccAdId' : 'nccKeywordId';
 const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
 return rows.map(r => (r as Record<string, unknown>)[key]).filter((v): v is string => typeof v === 'string');
}

export type WriteDeps = RunDeps & {timeoutMs?: number; onBeforeSend?: (attempt: number) => Promise<void>; state?: QueueState};
export type WriteResult = {outcome: Outcome; attempts: number; httpStatus: number | null; providerIds: string[]; value?: unknown; error: string | null; waits: number[]; state: QueueState};
export const liveDeps = (): RunDeps => ({now: () => Date.now(), random: () => Math.random(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms))});

// 작업 하나를 한도 큐·백오프·unknown 규율로 보낸다. 호출자는 보내기 전에 onBeforeSend로 '보냄'을 영속해 재시작 뒤 중복 전송을 막는다.
export async function executeWrite(credential: NaverAdsCredential, op: WriteOperation, deps: WriteDeps = liveDeps()): Promise<WriteResult> {
 const request = buildWriteRequest(op, credential.customerId);
 const run = await runWithBackoff<unknown>({
  key: `naver_ads:${credential.customerId}`, limit: writeLimit, write: true, policy: writePolicy, state: deps.state,
  send: () => attemptWrite(credential, request, deps),
  onBeforeSend: deps.onBeforeSend,
 }, deps);
 const last = run.last as WriteAttempt | undefined;
 const httpStatus = last?.kind === 'response' ? last.status : null;
 const error = run.outcome === 'success' ? null
  : run.outcome === 'unknown' ? '응답을 받지 못해 반영 여부를 모릅니다. 자동 재시도하지 않으며 읽기 대조로 확인합니다.'
  : run.outcome === 'rate_limited' ? '호출 속도 제한(429)이 계속되어 보내지 못했습니다. 잠시 후 다시 승인·반영하세요.'
  : `네이버 검색광고가 요청을 거절했습니다${httpStatus ? ` (${httpStatus})` : ''}${last?.detail ? `: ${last.detail}` : ''}`;
 return {outcome: run.outcome, attempts: run.attempts, httpStatus, providerIds: run.outcome === 'success' ? providerIdsOf(op, run.value) : [], ...(run.outcome === 'success' ? {value: run.value} : {}), error, waits: run.waits, state: run.state};
}

// ----- 읽기 대조(read-back): 쓰기 결과를 GET으로 다시 읽어 기대 상태와 비교한다. unknown 결과의 유일한 판정 수단이다. -----
export type ObservedRow = Record<string, unknown>;
const rowsOf = (raw: unknown): ObservedRow[] => Array.isArray(raw) ? raw.filter((r): r is ObservedRow => !!r && typeof r === 'object') : raw && typeof raw === 'object' ? [raw as ObservedRow] : [];
const MAX_READBACK_IDS = 20;

export async function readBack(credential: NaverAdsCredential, op: WriteOperation, providerIds: readonly string[]): Promise<ObservedRow[]> {
 switch (op.op) {
  case 'create_campaign': return providerIds.length ? rowsOf(await call(credential, `/ncc/campaigns/${providerIds[0]}`)) : rowsOf(await call(credential, '/ncc/campaigns'));
  case 'create_adgroup': return providerIds.length ? rowsOf(await call(credential, `/ncc/adgroups/${providerIds[0]}`)) : rowsOf(await call(credential, '/ncc/adgroups', q({nccCampaignId: op.campaignId})));
  case 'create_keywords': return rowsOf(await call(credential, '/ncc/keywords', q({nccAdgroupId: op.adgroupId})));
  case 'create_ad': return providerIds.length ? rowsOf(await call(credential, `/ncc/ads/${providerIds[0]}`)) : rowsOf(await call(credential, '/ncc/ads', q({nccAdgroupId: op.adgroupId})));
  case 'update_bid': return keywordRows(credential, op.keywordIds);
  case 'set_user_lock': return op.target === 'keyword' ? keywordRows(credential, op.ids) : rowsOf(await call(credential, `/ncc/${op.target === 'campaign' ? 'campaigns' : 'adgroups'}/${op.ids[0]}`));
  default: return [];
 }
}
async function keywordRows(credential: NaverAdsCredential, keywordIds: readonly string[]) {
 const rows: ObservedRow[] = [];
 for (const keywordId of keywordIds.slice(0, MAX_READBACK_IDS)) rows.push(...rowsOf(await call(credential, `/ncc/keywords/${keywordId}`)));
 return rows;
}

export type Verification = {status: 'verified' | 'mismatch'; details: string[]};
const same = (a: unknown, b: unknown) => a === b || (typeof a === 'number' && typeof b === 'number' && a === b) || String(a) === String(b);
// 기대 상태와 관측 행 비교(순수). 대상 행이 없으면 mismatch다(지웠거나 반영되지 않음).
export function verifyReadBack(op: WriteOperation, providerIds: readonly string[], observed: readonly ObservedRow[]): Verification {
 const details: string[] = [];
 const find = (key: string, value: string) => observed.find(r => same(r[key], value));
 if (op.op === 'update_bid') for (const k of op.keywordIds.slice(0, MAX_READBACK_IDS)) { const row = find('nccKeywordId', k); if (!row) details.push(`키워드 ${k}를 읽지 못했습니다.`); else if (!same(row.bidAmt, op.bidAmt)) details.push(`키워드 ${k} 입찰가 ${String(row.bidAmt)} ≠ 기대 ${op.bidAmt}`); }
 else if (op.op === 'set_user_lock') for (const i of op.ids.slice(0, MAX_READBACK_IDS)) { const key = op.target === 'keyword' ? 'nccKeywordId' : op.target === 'campaign' ? 'nccCampaignId' : 'nccAdgroupId'; const row = find(key, i); if (!row) details.push(`${i}를 읽지 못했습니다.`); else if (row.userLock !== op.userLock) details.push(`${i} userLock ${String(row.userLock)} ≠ 기대 ${op.userLock}`); }
 else if (op.op === 'create_keywords') for (const k of op.keywords) { if (!observed.some(r => same(r.keyword, k.keyword))) details.push(`키워드 '${k.keyword}'가 광고그룹에 없습니다.`); }
 else {
  const key = op.op === 'create_campaign' ? 'nccCampaignId' : op.op === 'create_adgroup' ? 'nccAdgroupId' : 'nccAdId';
  if (!providerIds.length) details.push('공급자 ID가 없어 생성 결과를 대조할 수 없습니다.');
  for (const p of providerIds) if (!find(key, p)) details.push(`${p}를 읽지 못했습니다.`);
 }
 return {status: details.length ? 'mismatch' : 'verified', details};
}

// ----- 계약 테스트 하네스용 커넥터: 실제 요청 빌더를 거쳐 transport(스크립트·모의)로 보낸다. 네트워크 없음. -----
export type WriteTransport = (request: WriteRequest | {method: 'GET'; path: string; query: string; body?: undefined}, op: ContractOperation, attempt: number) => Promise<AttemptResult & {value?: unknown}>;
export function naverAdsContractConnector(capabilities: readonly ConnectorCapability[], customerId: string, transport: WriteTransport): ContractConnector & {calls(): Record<string, number>} {
 const calls: Record<string, number> = {};
 return {
  capabilities,
  calls: () => ({...calls}),
  async execute(op, attempt) {
   calls[op.id] = (calls[op.id] ?? 0) + 1;
   const capability = capabilities.find(c => c.key === op.capability);
   const request = capability?.writes.length ? buildWriteRequest(op.payload as WriteOperation, customerId) : {method: 'GET' as const, path: '/ncc/campaigns', query: ''};
   return transport(request, op, attempt);
  },
 };
}
