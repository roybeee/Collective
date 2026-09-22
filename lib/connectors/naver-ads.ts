import {ApiError, str, stamp} from '../server';
import type {Connector, Collected, NaverAdsCredential} from './types';

// 고정 호스트만 호출한다. 사용자가 URL을 입력하는 경로가 없으므로 SSRF 표면이 없다.
const HOST = 'https://api.searchad.naver.com';
const TIMEOUT_MS = 20000;

// 검색광고 API 서명: base64(HMAC-SHA256(secretKey, `${timestamp}.${method}.${path}`))
async function sign(secretKey: string, timestamp: string, method: string, path: string) {
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
 const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${method}.${path}`));
 return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

async function call(credential: NaverAdsCredential, path: string, query = '') {
 const timestamp = String(Date.now());
 const signature = await sign(credential.secretKey, timestamp, 'GET', path);
 let response: Response;
 try {
  response = await fetch(HOST + path + query, {
   redirect: 'manual',
   headers: {
    'X-Timestamp': timestamp,
    'X-API-KEY': credential.apiKey,
    'X-Customer': credential.customerId,
    'X-Signature': signature,
    'Content-Type': 'application/json',
   },
   signal: AbortSignal.timeout(TIMEOUT_MS),
  });
 } catch {
  throw new ApiError(502, '네이버 검색광고 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
 }
 if (response.status === 401 || response.status === 403) throw new ApiError(400, '네이버 검색광고 인증에 실패했습니다. API 키, 비밀키, Customer ID를 확인하세요.');
 if (!response.ok) throw new ApiError(response.status >= 500 ? 502 : 400, `네이버 검색광고 요청을 처리하지 못했습니다 (${response.status}).`);
 try {
  return await response.json() as Record<string, unknown> | unknown[];
 } catch {
  throw new ApiError(502, '네이버 검색광고 응답 형식이 올바르지 않습니다.');
 }
}

// 수치가 없으면 null로 남긴다. 0(측정됐고 값이 0)과 구분한다.
function metric(row: Record<string, unknown>, key: string) {
 const value = row[key];
 return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isoDate(value: string, label: string) {
 const day = str(value, label, 20, true);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))) throw new ApiError(400, `${label}을 YYYY-MM-DD 형식으로 입력하세요.`);
 return day;
}

export const naverAds: Connector = {
 key: 'naver_ads',
 label: '네이버 검색광고',

 parse(input) {
  const credential: NaverAdsCredential = {
   channel: 'naver_ads',
   apiKey: str(input.apiKey, 'API 키', 200, true),
   secretKey: str(input.secretKey, '비밀키', 400, true),
   customerId: str(input.customerId, 'Customer ID', 40, true),
  };
  if (!/^\d{1,20}$/.test(credential.customerId)) throw new ApiError(400, 'Customer ID는 숫자입니다. 광고시스템의 고객 ID를 확인하세요.');
  return credential;
 },

 // 계정 조회가 성공해야 키·비밀키·Customer ID 세 가지가 모두 맞는 것이다.
 async verify(credential) {
  await call(credential as NaverAdsCredential, '/ncc/campaigns');
  return {account: (credential as NaverAdsCredential).customerId};
 },

 async collect(credential, target, window): Promise<Collected> {
  const cred = credential as NaverAdsCredential;
  const id = str(target, '광고 대상 ID', 100, true);
  const from = isoDate(window.from, '수집 시작일');
  const to = isoDate(window.to, '수집 종료일');
  if (from > to) throw new ApiError(400, '수집 기간을 확인하세요.');

  const query = `?id=${encodeURIComponent(id)}&fields=${encodeURIComponent(JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ccnt']))}&timeRange=${encodeURIComponent(JSON.stringify({since: from, until: to}))}`;
  const raw = await call(cred, '/stats', query);
  const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw as Record<string, unknown>[] : Array.isArray((raw as {data?: unknown}).data) ? (raw as {data: Record<string, unknown>[]}).data : [];
  const row: Record<string, unknown> = rows[0] ?? {};

  const impressions = metric(row, 'impCnt');
  const clicks = metric(row, 'clkCnt');
  const cost = metric(row, 'salesAmt');
  const conversions = metric(row, 'ccnt');

  const limitations: string[] = [];
  if (!rows.length) limitations.push('해당 기간에 반환된 통계 행이 없습니다. 광고 대상 ID와 기간을 확인하세요.');
  if (impressions === null) limitations.push('노출 수를 확인하지 못했습니다.');
  if (clicks === null) limitations.push('클릭 수를 확인하지 못했습니다.');
  if (cost === null) limitations.push('광고비를 확인하지 못했습니다.');
  if (conversions === null) limitations.push('전환 수를 확인하지 못했습니다. 전환 추적 설정을 확인하세요.');
  limitations.push('네이버 검색광고 통계는 집계 지연이 있을 수 있습니다. 기간 종료 직후 값은 확정치가 아닙니다.');
  limitations.push('전환 정의는 광고 계정의 전환 추적 설정을 따릅니다. 매장 실제 구매와 일치하는지 확인해야 합니다.');

  return {
   arm: {denominator: impressions, numerator: clicks, source: `네이버 검색광고 · 고객 ${cred.customerId} · 대상 ${id} · ${from}~${to}`},
   storeValues: {adSpend: cost, orders: conversions},
   account: cred.customerId,
   definition: '노출 대비 클릭 (impCnt를 분모, clkCnt를 분자로 사용). 광고비는 salesAmt, 전환은 ccnt.',
   window: {from, to},
   fetchedAt: stamp(),
   limitations,
   raw,
  };
 },
};
