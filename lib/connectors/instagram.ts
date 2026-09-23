import {ApiError, str, stamp} from '../server';
import {HttpBodyError, readBoundedJson} from '../http-limits';
import type {Connector, Collected, InstagramCredential} from './types';

// 고정 호스트만 호출한다. 사용자가 URL을 입력하는 경로가 없으므로 SSRF 표면이 없다.
const HOST = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 20000;
// 외부 공급자 응답은 명시적 바이트 한도 안에서만 읽는다(docs/SECURITY-BOUNDARIES.ko.md).
const MAX_RESPONSE_BYTES = 200000;
// 도달 대비 공유를 계산할 지표. plays/saves는 다음 실험 설계를 위한 참고값으로만 보존한다.
const METRICS = ['reach', 'shares', 'saves', 'plays'];

async function call(credential: InstagramCredential, path: string, query = '') {
 let response: Response;
 try {
  response = await fetch(HOST + path + query, {
   redirect: 'manual',
   // 토큰은 쿼리 문자열이 아니라 헤더로 보낸다. URL은 로그와 리퍼러에 남는다.
   headers: {Authorization: `Bearer ${credential.accessToken}`, 'Content-Type': 'application/json'},
   signal: AbortSignal.timeout(TIMEOUT_MS),
  });
 } catch {
  throw new ApiError(502, 'Instagram 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
 }
 let payload: Record<string, unknown>;
 try {
  payload = await readBoundedJson<Record<string, unknown>>(response, MAX_RESPONSE_BYTES);
 } catch (error) {
  if (error instanceof HttpBodyError && error.status === 413) throw new ApiError(502, 'Instagram 응답이 허용 크기(200KB)를 넘어 읽지 않았습니다. 잠시 후 다시 시도해 주세요.');
  throw new ApiError(502, 'Instagram 응답 형식이 올바르지 않습니다.');
 }
 const error = payload.error as {code?: number; message?: string} | undefined;
 if (error || !response.ok) {
  if (error?.code === 190 || response.status === 401 || response.status === 403) throw new ApiError(400, 'Instagram 액세스 토큰이 유효하지 않거나 만료됐습니다. 새 장수명 토큰을 발급해 등록하세요.');
  throw new ApiError(response.status >= 500 ? 502 : 400, `Instagram 요청을 처리하지 못했습니다 (${response.status}).`);
 }
 return payload;
}

// 인사이트는 지표별로 값이 없을 수 있다. 없으면 null로 남기고 0과 구분한다.
function insightValue(payload: Record<string, unknown>, name: string) {
 const rows = Array.isArray(payload.data) ? payload.data as {name?: string; values?: {value?: unknown}[]}[] : [];
 const value = rows.find(r => r.name === name)?.values?.[0]?.value;
 return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export const instagram: Connector = {
 key: 'instagram',
 label: 'Instagram',

 parse(input) {
  const credential: InstagramCredential = {
   channel: 'instagram',
   accessToken: str(input.accessToken, '액세스 토큰', 1000, true),
   userId: str(input.userId, 'Instagram 계정 ID', 40, true),
  };
  if (!/^\d{1,25}$/.test(credential.userId)) throw new ApiError(400, 'Instagram 비즈니스 계정 ID는 숫자입니다.');
  // 만료일은 토큰에서 읽을 수 없다. 사용자가 발급 시 확인한 값을 그대로 보관하고 경고에만 쓴다.
  const expiresAt = str(input.expiresAt ?? '', '토큰 만료일', 40);
  if (expiresAt) {
   if (!Number.isFinite(Date.parse(expiresAt))) throw new ApiError(400, '토큰 만료일을 확인해 주세요.');
   credential.expiresAt = new Date(expiresAt).toISOString();
  }
  return credential;
 },

 async verify(credential) {
  const cred = credential as InstagramCredential;
  const profile = await call(cred, '/' + encodeURIComponent(cred.userId), '?fields=username');
  const username = typeof profile.username === 'string' ? profile.username : cred.userId;
  return {account: username, ...(cred.expiresAt ? {expiresAt: cred.expiresAt} : {})};
 },

 async collect(credential, target, window): Promise<Collected> {
  const cred = credential as InstagramCredential;
  const mediaId = str(target, '게시물 ID', 60, true);
  if (!/^\d{1,30}$/.test(mediaId)) throw new ApiError(400, 'Instagram 게시물 ID는 숫자입니다.');

  const media = await call(cred, '/' + encodeURIComponent(mediaId), '?fields=timestamp,permalink,media_type');
  const insights = await call(cred, '/' + encodeURIComponent(mediaId) + '/insights', '?metric=' + METRICS.join(','));

  const reach = insightValue(insights, 'reach');
  const shares = insightValue(insights, 'shares');
  const saves = insightValue(insights, 'saves');
  const plays = insightValue(insights, 'plays');
  const postedAt = typeof media.timestamp === 'string' ? media.timestamp : '';

  const limitations: string[] = [
   // 기존 코드가 "공개 누적 스냅샷은 기간 비교에서 제외"를 강제한다. 이 값이 그 종류임을 분명히 남긴다.
   'Instagram 미디어 인사이트는 게시 이후 누적값입니다. 요청한 기간만의 값이 아니므로 기간 비교에 그대로 쓸 수 없습니다.',
   '두 안을 비교하려면 게시 후 경과 시간과 영상 길이 구간이 같아야 합니다.',
  ];
  if (postedAt) limitations.push(`게시 시점 ${postedAt} 기준 누적입니다.`);
  else limitations.push('게시 시점을 확인하지 못해 경과 시간을 비교할 수 없습니다.');
  if (reach === null) limitations.push('도달 수를 확인하지 못했습니다.');
  if (shares === null) limitations.push('공유 수를 확인하지 못했습니다. 계정 유형이나 게시물 형식이 이 지표를 제공하지 않을 수 있습니다.');
  // 공유는 이벤트 수, 도달은 사람 수라 초과가 가능하다. 거부하지 않고 사실만 남겨 판단에 넘긴다.
  if (reach !== null && shares !== null && shares > reach) limitations.push('공유 수가 도달 수를 초과합니다. 공유는 이벤트 수, 도달은 사람 수이므로 비율을 그대로 해석하지 마세요.');

  return {
   arm: {denominator: reach, numerator: shares, source: `Instagram · @${cred.userId} · 게시물 ${mediaId}${postedAt ? ' · 게시 ' + postedAt : ''}`},
   account: cred.userId,
   definition: `도달 대비 공유 (reach를 분모, shares를 분자로 사용). 게시 이후 누적값${postedAt ? `, 게시 시점 ${postedAt}` : ''}. 참고: saves ${saves ?? '미확인'}, plays ${plays ?? '미확인'}.`,
   window: {from: str(window.from, '수집 시작일', 20, true), to: str(window.to, '수집 종료일', 20, true)},
   fetchedAt: stamp(),
   limitations,
   raw: {media, insights},
  };
 },
};
