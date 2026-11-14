// C3 Threads 게시(Threads API, graph.threads.net). 두 단계: POST /{threads-user-id}/threads(컨테이너: TEXT 또는 IMAGE) → POST /{threads-user-id}/threads_publish(creation_id).
// 한도는 GET /{threads-user-id}/threads_publishing_limit(quota_usage·config, 안내 250건/24시간). 권한 threads_basic·threads_content_publish. 본문 500자.
// 아무것도 자동으로 보내지 않는다(승인 뒤 사람이 '실행'). 결과 미확인은 unknown으로 남기고 재전송하지 않는다. 답글은 수집만 하고 자동 답글은 없다.
import {str, stamp} from '../server';
import {ConnectorAuthError} from './errors';
import {attempt, captionIssues, imageReachable, parseComments, parsePublishLimit, parseRecentMedia, payloadError, payloadId, twoStepPublish, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES, type Attempt, type ContainerJournal, type PublishHttp} from './publish-core';
import {runWithBackoff, type BackoffPolicy, type RunDeps} from './rate-queue';
import type {Collected, DirectPublisherCredential, PublishDraft, PublishLimit, Publisher, PublishOutcome, PublishStatus, PrepareResult, PublicationComment, RateLimit, RecentMediaItem, VerifiedAccount} from './types';

export const THREADS_TEXT_MAX = 500;
export const THREADS_PUBLISH_LIMIT: RateLimit = {perMinute: 10, perDay: 250};
export const THREADS_READ_LIMIT: RateLimit = {perMinute: 60, perDay: 4800};
export const THREADS_HOST = 'https://graph.threads.net/v1.0';
const idPath = (id: string) => '/' + encodeURIComponent(id);
const http = (partial?: Partial<PublishHttp>): PublishHttp => ({fetch: partial?.fetch ?? ((...a) => fetch(...a)), timeoutMs: partial?.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBytes: partial?.maxBytes ?? MAX_RESPONSE_BYTES});
const defaultDeps = (): RunDeps => ({now: () => Date.now(), random: () => Math.random(), sleep: ms => new Promise(r => setTimeout(r, ms))});

// 컨테이너 본문: 이미지가 있으면 IMAGE+text, 없으면 TEXT. 캡션은 최종 문자열 그대로(표시 줄 포함).
export function threadsContainerBody(draft: PublishDraft): Record<string, string> {
 return draft.imageUrl ? {media_type: 'IMAGE', image_url: draft.imageUrl, text: draft.text} : {media_type: 'TEXT', text: draft.text};
}
export function threadsRaw(credential: DirectPublisherCredential, partial?: Partial<PublishHttp>) {
 const h = http(partial), token = credential.accessToken, user = idPath(credential.userId);
 return {
  createContainer: (draft: PublishDraft): Promise<Attempt> => attempt(h, `${THREADS_HOST}${user}/threads`, {method: 'POST', token, body: threadsContainerBody(draft)}),
  publish: (containerId: string): Promise<Attempt> => attempt(h, `${THREADS_HOST}${user}/threads_publish`, {method: 'POST', token, body: {creation_id: containerId}}),
  limit: (): Promise<Attempt> => attempt(h, `${THREADS_HOST}${user}/threads_publishing_limit?fields=quota_usage,config`, {token}),
  media: (id: string): Promise<Attempt> => attempt(h, `${THREADS_HOST}${idPath(id)}?fields=id,permalink,timestamp,media_type,status`, {token}),
  replies: (id: string): Promise<Attempt> => attempt(h, `${THREADS_HOST}${idPath(id)}/replies?fields=id,text,username,timestamp&limit=50`, {token}),
  insights: (id: string): Promise<Attempt> => attempt(h, `${THREADS_HOST}${idPath(id)}/insights?metric=views,likes,replies,reposts,quotes`, {token}),
  me: (): Promise<Attempt> => attempt(h, `${THREADS_HOST}/me?fields=id,username`, {token}),
  // 결과 미확인 대조: 계정의 최근 게시물(읽기만). 본문 필드는 text다.
  recentMedia: (): Promise<Attempt> => attempt(h, `${THREADS_HOST}/me/threads?fields=id,text,timestamp,permalink&limit=25`, {token}),
  imageReachable: (url: string) => imageReachable(h, url),
 };
}
export type ThreadsPublisherOptions = {credential: DirectPublisherCredential; journal: ContainerJournal; http?: Partial<PublishHttp>; deps?: RunDeps; policy?: BackoffPolicy; now?: () => string};

async function read(key: string, send: () => Promise<Attempt>, deps?: RunDeps, policy?: BackoffPolicy) {
 const r = await runWithBackoff<unknown>({key, limit: THREADS_READ_LIMIT, write: false, policy: policy ?? {maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 5000}, send: async () => { const a = await send(); return {...a, value: a.payload}; }}, deps ?? defaultDeps());
 return r.outcome === 'success' ? {payload: r.value, last: r.last} : {payload: null, last: r.last};
}
const insightValue = (payload: unknown, name: string) => {
 const rows = Array.isArray((payload as {data?: unknown} | null)?.data) ? (payload as {data: {name?: string; values?: {value?: unknown}[]}[]}).data : [];
 const value = rows.find(r => r.name === name)?.values?.[0]?.value;
 return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
};

export function threadsPublisher(o: ThreadsPublisherOptions): Publisher {
 const raw = threadsRaw(o.credential, o.http), key = `threads:${o.credential.userId}`, deps = o.deps, policy = o.policy;
 return {
  key: 'threads',
  account: o.credential.userId,
  async prepare(draft): Promise<PrepareResult> {
   const issues = captionIssues(draft.text, THREADS_TEXT_MAX, null);
   if (!draft.text.trim() && !draft.imageUrl) issues.push('본문 또는 이미지가 필요합니다.');
   if (draft.mediaType && draft.mediaType !== 'TEXT' && draft.mediaType !== 'IMAGE') issues.push('이 판은 Threads 텍스트·이미지 게시만 지원합니다.');
   const reachable = draft.imageUrl ? await raw.imageReachable(draft.imageUrl) : null;
   if (reachable === false) issues.push('공개 이미지 주소에 로그인 없이 접근할 수 없습니다(HEAD 확인 실패). Threads가 이미지를 가져가지 못합니다.');
   return {ok: !issues.length, issues, imageReachable: reachable};
  },
  submit(draft, idempotencyKey): Promise<PublishOutcome> {
   return twoStepPublish({channel: 'threads', key, idempotencyKey, limit: THREADS_PUBLISH_LIMIT, journal: o.journal, deps, policy, now: o.now, createContainer: () => raw.createContainer(draft), publish: containerId => raw.publish(containerId)});
  },
  async status(id): Promise<PublishStatus> {
   const r = await read(key + ':read', () => raw.media(id), deps, policy);
   const payload = r.payload as {permalink?: unknown; status?: unknown} | null;
   if (!payload) return {id, status: 'unknown', raw: r.last};
   const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : payloadId(payload) === id ? 'published' : 'not_found';
   return {id, status, ...(typeof payload.permalink === 'string' ? {permalink: payload.permalink} : {}), raw: payload};
  },
  async limit(): Promise<PublishLimit> {
   return parsePublishLimit((await read(key + ':read', () => raw.limit(), deps, policy)).payload);
  },
  async recentMedia(): Promise<RecentMediaItem[] | null> {
   const r = await read(key + ':read', () => raw.recentMedia(), deps, policy);
   return r.payload ? parseRecentMedia(r.payload, 'text') : null;
  },
  async collect(postId, window): Promise<Collected> {
   const mediaId = str(postId, '게시물 ID', 60, true);
   const [media, insights] = await Promise.all([read(key + ':read', () => raw.media(mediaId), deps, policy), read(key + ':read', () => raw.insights(mediaId), deps, policy)]);
   const views = insightValue(insights.payload, 'views'), reposts = insightValue(insights.payload, 'reposts'), quotes = insightValue(insights.payload, 'quotes'), likes = insightValue(insights.payload, 'likes');
   const shares = reposts === null && quotes === null ? null : (reposts ?? 0) + (quotes ?? 0);
   const postedAt = typeof (media.payload as {timestamp?: unknown} | null)?.timestamp === 'string' ? String((media.payload as {timestamp: string}).timestamp) : '';
   const limitations = ['Threads 인사이트는 게시 이후 누적값입니다. 요청한 기간만의 값이 아니므로 기간 비교에 그대로 쓸 수 없습니다.', ...(postedAt ? [`게시 시점 ${postedAt} 기준 누적입니다.`] : ['게시 시점을 확인하지 못해 경과 시간을 비교할 수 없습니다.']), ...(views === null ? ['조회 수를 확인하지 못했습니다.'] : []), ...(shares === null ? ['리포스트·인용 수를 확인하지 못했습니다.'] : [])];
   return {arm: {denominator: views, numerator: shares, source: `Threads · @${o.credential.userId} · 게시물 ${mediaId}`}, account: o.credential.userId, definition: `조회 대비 공유 (views를 분모, reposts+quotes를 분자로 사용). 게시 이후 누적값. 참고: likes ${likes ?? '미확인'}.`, window: {from: str(window.from, '수집 시작일', 20, true), to: str(window.to, '수집 종료일', 20, true)}, fetchedAt: stamp(), limitations, raw: {media: media.payload, insights: insights.payload}};
  },
  async collectComments(postId): Promise<PublicationComment[]> {
   return parseComments((await read(key + ':read', () => raw.replies(str(postId, '게시물 ID', 60, true)), deps, policy)).payload);
  },
  async verify(): Promise<VerifiedAccount> {
   const r = await read(key + ':read', () => raw.me(), deps, policy);
   const payload = r.payload as {id?: unknown; username?: unknown} | null;
   if (!payload) throw new ConnectorAuthError('Threads 계정을 확인하지 못했습니다' + (r.last?.kind === 'response' ? ` (${payloadError((r.last as Attempt).payload, r.last.status)})` : '') + '. 토큰과 권한(threads_basic·threads_content_publish)을 확인하세요.');
   const id = payloadId(payload);
   if (id && id !== o.credential.userId) throw new ConnectorAuthError(`토큰의 계정(${id})이 입력한 Threads 계정 ID(${o.credential.userId})와 다릅니다.`);
   return {account: typeof payload.username === 'string' && payload.username ? payload.username : o.credential.userId, ...(o.credential.expiresAt ? {expiresAt: o.credential.expiresAt} : {})};
  },
 };
}
