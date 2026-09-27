import {HttpBodyError, readBoundedText} from '../http-limits';

// 트랙 R R7a 공정위 가맹정보 공개 API(공공데이터포털) 한 쪽 조회. 사람이 버튼을 눌렀을 때만 lib/franchise-benchmark-server.ts가 부른다(주기 호출 없음, 결정 19).
// 고정 호스트·경로만 호출한다. 사용자가 주소를 입력하는 경로가 없으므로 SSRF 표면이 없다. 키는 쿼리 serviceKey로만 보내고 주소·키를 로그·오류 문구에 남기지 않는다.
// 이 모듈은 가맹 리드·벤치마크 모듈을 import하지 않는다(모델 경계 tests/franchise-model-boundary.test.mjs: fetch를 쓰는 lib 모듈은 모델 경로 루트로 검사된다).
// 엔드포인트·파라미터 이름은 공공데이터포털 명세([D2] https://www.data.go.kr/data/15125467/openapi.do)에서 확인 필요다. 대표의 real 적재 1회로 확인한다.
const HOST = 'https://apis.data.go.kr';
const PATH = '/1130000/FftcBrandFrcsStatsService/getBrandFrcsStats';
// 호출당 20초, 응답 200KB(lib/connectors/naver-ads.ts 규율), 첫 시도 + 재시도 3회, 지수 백오프 250ms부터 두 배.
export const FTC_LIMITS = {timeoutMs: 20000, maxBytes: 200000, maxAttempts: 4, backoffMs: 250} as const;
export const ftcBackoffMs = (retry: number) => FTC_LIMITS.backoffMs * 2 ** (retry - 1);

export type FtcPageRequest = {serviceKey: string; year: number; pageNo: number; numOfRows: number; deadlineAt: number};
export type FtcFailureKind = 'blocked' | 'failed' | 'timeout';
export type FtcFailureCode = 'SERVICE_NOT_REGISTERED' | 'SERVICE_KEY_EXPIRED' | 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'TOO_LARGE' | 'NOT_JSON' | 'API_ERROR' | 'REQUEST_REJECTED' | 'UPSTREAM_5XX' | 'NETWORK' | 'TIMEOUT' | 'DEADLINE';
export type FtcPageResult =
 | {ok: true; text: string; json: unknown; attempts: number; lastModified: string | null}
 | {ok: false; kind: FtcFailureKind; code: FtcFailureCode; attempts: number; httpStatus: number | null};
type Failure = {kind: FtcFailureKind; code: FtcFailureCode; retry: boolean; httpStatus: number | null};
type Attempt = {ok: true; text: string; json: unknown; lastModified: string | null} | ({ok: false} & Failure);
export type FtcOptions = {wait?: (ms: number) => Promise<void>};

export function ftcPageUrl(req: Pick<FtcPageRequest, 'serviceKey' | 'year' | 'pageNo' | 'numOfRows'>) {
 const url = new URL(HOST + PATH);
 for (const [name, value] of [['serviceKey', req.serviceKey], ['pageNo', String(req.pageNo)], ['numOfRows', String(req.numOfRows)], ['resultType', 'json'], ['yr', String(req.year)]]) url.searchParams.set(name, value);
 return url.toString();
}

// 공공데이터포털 공통 오류(XML cmmMsgHeader 또는 JSON resultCode·resultMsg). 알려진 표지만 분류하고 그 밖은 null이다.
const MARKERS: readonly [RegExp, Omit<Failure, 'httpStatus'>][] = [
 [/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_NOT_REGISTERED|NO_OPENAPI_SERVICE|SERVICE_ACCESS_DENIED|UNREGISTERED_IP/, {kind: 'blocked', code: 'SERVICE_NOT_REGISTERED', retry: false}],
 [/DEADLINE_HAS_EXPIRED/, {kind: 'blocked', code: 'SERVICE_KEY_EXPIRED', retry: false}],
 [/LIMITED_NUMBER_OF_SERVICE_REQUESTS/, {kind: 'failed', code: 'QUOTA_EXCEEDED', retry: false}],
 [/SERVICE_?TIME_?OUT/, {kind: 'timeout', code: 'TIMEOUT', retry: true}],
 [/HTTP_ERROR|UNKNOWN_ERROR|DB_ERROR|APPLICATION_ERROR|TEMPORARILY_DISABLE/, {kind: 'failed', code: 'UPSTREAM_5XX', retry: true}],
];
function markerOf(text: string, httpStatus: number | null): Failure | null {
 const head = text.slice(0, 4000);
 for (const [pattern, failure] of MARKERS) if (pattern.test(head)) return {...failure, httpStatus};
 return null;
}
const OK_CODES = new Set(['00', '0', '000', '0000', 'INFO-000']);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function resultCodeOf(json: unknown): string | null {
 if (!record(json)) return null;
 const header = record(json.response) && record(json.response.header) ? json.response.header : json;
 const value = header.resultCode;
 return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}
function statusFailure(status: number): Failure | null {
 if (status === 401 || status === 403) return {kind: 'blocked', code: 'SERVICE_NOT_REGISTERED', retry: false, httpStatus: status};
 if (status === 429) return {kind: 'failed', code: 'RATE_LIMITED', retry: true, httpStatus: status};
 if (status >= 500) return {kind: 'failed', code: 'UPSTREAM_5XX', retry: true, httpStatus: status};
 if (status !== 200) return {kind: 'failed', code: 'REQUEST_REJECTED', retry: false, httpStatus: status};
 return null;
}

// 호출 시간 초과: 신호가 끝났거나 fetch가 TimeoutError·AbortError로 끝났다.
const timedOut = (signal: AbortSignal, error: unknown) => {
 const name = (error as {name?: unknown} | null)?.name;
 return signal.aborted || name === 'TimeoutError' || name === 'AbortError';
};

async function attempt(req: FtcPageRequest): Promise<Attempt> {
 const signal = AbortSignal.timeout(Math.max(1, Math.min(FTC_LIMITS.timeoutMs, req.deadlineAt - Date.now())));
 const target = ftcPageUrl(req);
 let response: Response;
 try {
  response = await fetch(target, {redirect: 'manual', headers: {accept: 'application/json'}, signal});
 } catch (error) {
  return timedOut(signal, error) ? {ok: false, kind: 'timeout', code: 'TIMEOUT', retry: true, httpStatus: null} : {ok: false, kind: 'failed', code: 'NETWORK', retry: true, httpStatus: null};
 }
 const byStatus = statusFailure(response.status);
 if (byStatus) {
  await response.body?.cancel().catch(() => undefined);
  return {ok: false, ...byStatus};
 }
 let text: string;
 try {
  text = await readBoundedText(response, FTC_LIMITS.maxBytes);
 } catch (error) {
  if (error instanceof HttpBodyError && error.status === 413) return {ok: false, kind: 'failed', code: 'TOO_LARGE', retry: false, httpStatus: response.status};
  return signal.aborted ? {ok: false, kind: 'timeout', code: 'TIMEOUT', retry: true, httpStatus: response.status} : {ok: false, kind: 'failed', code: 'NETWORK', retry: true, httpStatus: response.status};
 }
 let json: unknown;
 try {
  json = JSON.parse(text);
 } catch {
  return {ok: false, ...(markerOf(text, response.status) ?? {kind: 'failed', code: 'NOT_JSON', retry: false, httpStatus: response.status})};
 }
 const code = resultCodeOf(json);
 if (code !== null && !OK_CODES.has(code)) return {ok: false, ...(markerOf(text, response.status) ?? {kind: 'failed', code: 'API_ERROR', retry: false, httpStatus: response.status})};
 return {ok: true, text, json, lastModified: response.headers.get('last-modified')};
}

// 타이머가 없는 실행 환경(테스트 vm)에서는 기다리지 않고 바로 다시 시도한다. Workers와 Node에는 setTimeout이 있다.
const defaultWait = (ms: number) => typeof setTimeout === 'function' ? new Promise<void>(resolve => setTimeout(resolve, ms)) : Promise.resolve();

// 한 쪽을 읽는다. 재시도 대상(5xx·429·네트워크·호출 시간 초과)만 최대 3회 다시 시도하고, 전체 마감(deadlineAt)이 지나면 호출하지 않는다.
export async function ftcFetchPage(req: FtcPageRequest, options: FtcOptions = {}): Promise<FtcPageResult> {
 const wait = options.wait ?? defaultWait;
 let attempts = 0, last: Failure | null = null;
 while (attempts < FTC_LIMITS.maxAttempts) {
  if (attempts > 0) await wait(ftcBackoffMs(attempts));
  if (Date.now() >= req.deadlineAt) return {ok: false, kind: 'timeout', code: 'DEADLINE', attempts, httpStatus: null};
  attempts++;
  const result = await attempt(req);
  if (result.ok) return {ok: true, text: result.text, json: result.json, attempts, lastModified: result.lastModified};
  last = result;
  if (!result.retry) break;
 }
 const failure = last as Failure;
 return {ok: false, kind: failure.kind, code: failure.code, attempts, httpStatus: failure.httpStatus};
}
