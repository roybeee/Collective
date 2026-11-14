// C3 Instagram 직접 게시(Graph API). 두 단계: POST /{ig-user-id}/media(컨테이너) → POST /{ig-user-id}/media_publish(creation_id). 한도는 GET /{ig-user-id}/content_publishing_limit.
// 호스트: Facebook Login for Business는 graph.facebook.com, Instagram API with Instagram Login은 graph.instagram.com(자격증명 login 필드). 사용자가 URL을 입력하는 경로는 없다(고정 호스트, SSRF 표면 없음).
// 아무것도 자동으로 보내지 않는다: 승인된 발행을 사람이 '실행'했을 때만 submit이 불린다(lib/execution-publisher-server.ts). 결과 미확인은 unknown으로 남기고 재전송하지 않는다.
import {str, stamp} from '../server';
import {ConnectorAuthError} from './errors';
import {instagram} from './instagram';
import {attempt, captionIssues, imageReachable, parseComments, parsePublishLimit, parseRecentMedia, payloadError, payloadId, twoStepPublish, videoReachable, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES, type Attempt, type ContainerJournal, type PublishHttp} from './publish-core';
import {runWithBackoff, type BackoffPolicy, type RunDeps} from './rate-queue';
import type {Collected, DirectPublisherCredential, PublishDraft, PublishLimit, Publisher, PublishOutcome, PublishStatus, PrepareResult, PublicationComment, RateLimit, RecentMediaItem, VerifiedAccount} from './types';

export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_HASHTAG_MAX = 30;
// 초깃값. 실제 상한은 limit()이 읽는 content_publishing_limit(quota_total·quota_usage)이 정하고, 실행 전에 그 값을 먼저 본다(남은 수 0이면 보내지 않는다).
export const INSTAGRAM_PUBLISH_LIMIT: RateLimit = {perMinute: 10, perDay: 100};
export const INSTAGRAM_READ_LIMIT: RateLimit = {perMinute: 60, perDay: 4800};
// 캐러셀 2~10장, 릴스 영상 크기 상한(가정: Meta 콘텐츠 게시 가이드의 릴스 사양 300MB. 공식 문서 재확인 전 값이다, docs/INSTAGRAM-DIRECT.ko.md 6절).
export const CAROUSEL_MIN = 2, CAROUSEL_MAX = 10, REELS_MAX_BYTES = 300 * 1024 * 1024;
const API_VERSION = 'v21.0';
const CONTAINER_POLL = {attempts: 12, delayMs: 5000};

export const instagramHost = (credential: Pick<DirectPublisherCredential, 'login'>) => credential.login === 'instagram' ? `https://graph.instagram.com/${API_VERSION}` : `https://graph.facebook.com/${API_VERSION}`;
const idPath = (id: string) => '/' + encodeURIComponent(id);
const http = (partial?: Partial<PublishHttp>): PublishHttp => ({fetch: partial?.fetch ?? ((...a) => fetch(...a)), timeoutMs: partial?.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBytes: partial?.maxBytes ?? MAX_RESPONSE_BYTES});

// 컨테이너 본문. IMAGE(기본)·CAROUSEL(미리 만든 자식 컨테이너 id)·REELS(video_url). 캡션은 최종 문자열 그대로 보낸다(표시 줄 포함).
// childIds: 실행 경로가 방금 만든 캐러셀 자식 컨테이너 id(없으면 draft.children). 릴스 표지(coverUrl)가 있으면 cover_url로 보낸다.
export function containerBody(draft: PublishDraft, childIds?: readonly string[]): Record<string, string> {
 const type = draft.mediaType ?? 'IMAGE';
 if (type === 'CAROUSEL') return {media_type: 'CAROUSEL', children: (childIds?.length ? childIds : draft.children ?? []).join(','), caption: draft.text};
 if (type === 'REELS') return {media_type: 'REELS', video_url: draft.videoUrl ?? '', caption: draft.text, ...(draft.coverUrl ? {cover_url: draft.coverUrl} : {})};
 return {image_url: draft.imageUrl ?? '', caption: draft.text};
}
// HTTP 한 번짜리 원시 호출. 계약 테스트 하네스(contract-test.ts)가 이 단위를 execute로 쓴다.
export function instagramDirectRaw(credential: DirectPublisherCredential, partial?: Partial<PublishHttp>) {
 const h = http(partial), host = instagramHost(credential), token = credential.accessToken, user = idPath(credential.userId);
 return {
  createContainer: (draft: PublishDraft, childIds?: readonly string[]): Promise<Attempt> => attempt(h, `${host}${user}/media`, {method: 'POST', token, body: containerBody(draft, childIds)}),
  // 캐러셀 자식 컨테이너(게시물이 아니다). 부모 컨테이너의 children으로만 쓰인다.
  childContainer: (imageUrl: string): Promise<Attempt> => attempt(h, `${host}${user}/media`, {method: 'POST', token, body: {image_url: imageUrl, is_carousel_item: 'true'}}),
  // 결과 미확인 대조: 계정의 최근 게시물(읽기만).
  recentMedia: (): Promise<Attempt> => attempt(h, `${host}/me/media?fields=id,caption,timestamp,permalink&limit=25`, {token}),
  containerStatus: (containerId: string): Promise<Attempt> => attempt(h, `${host}${idPath(containerId)}?fields=status_code,status`, {token}),
  publish: (containerId: string): Promise<Attempt> => attempt(h, `${host}${user}/media_publish`, {method: 'POST', token, body: {creation_id: containerId}}),
  limit: (): Promise<Attempt> => attempt(h, `${host}${user}/content_publishing_limit?fields=quota_usage,config`, {token}),
  media: (id: string): Promise<Attempt> => attempt(h, `${host}${idPath(id)}?fields=id,permalink,timestamp,media_type`, {token}),
  comments: (id: string): Promise<Attempt> => attempt(h, `${host}${idPath(id)}/comments?fields=id,text,username,timestamp,like_count&limit=50`, {token}),
  me: (): Promise<Attempt> => attempt(h, `${host}/me?fields=id,username`, {token}),
  insights: (id: string): Promise<Attempt> => attempt(h, `${host}${idPath(id)}/insights?metric=reach,shares,saves,plays`, {token}),
  imageReachable: (url: string) => imageReachable(h, url),
  videoReachable: (url: string) => videoReachable(h, url),
 };
}
export type InstagramPublisherOptions = {credential: DirectPublisherCredential; journal: ContainerJournal; http?: Partial<PublishHttp>; deps?: RunDeps; policy?: BackoffPolicy; now?: () => string};

// 읽기 한 번(재시도 포함). 실패는 오류로 던지지 않고 null을 돌려준다(호출자가 '확인 못 함'으로 적는다).
async function read(raw: ReturnType<typeof instagramDirectRaw>, key: string, send: () => Promise<Attempt>, deps: RunDeps | undefined, policy: BackoffPolicy | undefined) {
 const r = await runWithBackoff<unknown>({key, limit: INSTAGRAM_READ_LIMIT, write: false, policy: policy ?? {maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 5000}, send: async () => { const a = await send(); return {...a, value: a.payload}; }}, deps ?? {now: () => Date.now(), random: () => Math.random(), sleep: ms => new Promise(r => setTimeout(r, ms))});
 return r.outcome === 'success' ? {payload: r.value, last: r.last} : {payload: null, last: r.last};
}
const insightValue = (payload: unknown, name: string) => {
 const rows = Array.isArray((payload as {data?: unknown} | null)?.data) ? (payload as {data: {name?: string; values?: {value?: unknown}[]}[]}).data : [];
 const value = rows.find(r => r.name === name)?.values?.[0]?.value;
 return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
};

// 캐러셀 준비 검사: 자식 이미지 2~10장(미리 만든 children 형식도 같은 수), 각 이미지가 로그인 없이 열려야 한다. 걸리면 보내지 않는다.
async function carouselIssues(raw: ReturnType<typeof instagramDirectRaw>, draft: PublishDraft): Promise<string[]> {
 const n = draft.items?.length ?? draft.children?.length ?? 0;
 if (n < CAROUSEL_MIN || n > CAROUSEL_MAX) return [`캐러셀은 이미지 ${CAROUSEL_MIN}~${CAROUSEL_MAX}장이 필요합니다(현재 ${n}장).`];
 const reach = await Promise.all((draft.items ?? []).map(u => raw.imageReachable(u)));
 return reach.flatMap((r, i) => r === false ? [`캐러셀 ${i + 1}번째 이미지 공개 주소에 로그인 없이 접근할 수 없습니다(HEAD 확인 실패).`] : []);
}
// 릴스 준비 검사: 영상 주소가 video/*로 열리고, 크기가 상한 안이며 승인 때 기록한 크기와 같아야 한다. 표지가 있으면 이미지로 열려야 한다.
async function reelsIssues(raw: ReturnType<typeof instagramDirectRaw>, draft: PublishDraft): Promise<string[]> {
 if (!draft.videoUrl) return ['릴스 영상 주소가 없습니다.'];
 const v = await raw.videoReachable(draft.videoUrl), issues: string[] = [];
 if (v.ok === false) issues.push('릴스 영상 공개 주소에 로그인 없이 접근할 수 없거나 영상(video/*)이 아닙니다(HEAD 확인 실패).');
 if (v.bytes !== null && v.bytes > REELS_MAX_BYTES) issues.push(`릴스 영상이 ${Math.round(REELS_MAX_BYTES / 1048576)}MB를 넘습니다.`);
 if (v.bytes !== null && draft.videoBytes && v.bytes !== draft.videoBytes) issues.push('릴스 영상 크기가 승인 때 기록한 크기와 다릅니다. 영상이 바뀌었을 수 있어 보내지 않습니다.');
 if (draft.coverUrl && await raw.imageReachable(draft.coverUrl) === false) issues.push('릴스 표지 이미지 공개 주소에 로그인 없이 접근할 수 없습니다.');
 return issues;
}
export function instagramPublisher(o: InstagramPublisherOptions): Publisher {
 const raw = instagramDirectRaw(o.credential, o.http), key = `instagram_direct:${o.credential.userId}`, deps = o.deps, policy = o.policy;
 // REELS는 영상 처리가 끝나야(status_code FINISHED) 게시할 수 있다. 이미지는 바로 게시한다.
 const containerReady = async (containerId: string) => {
  const d = deps ?? {now: () => Date.now(), random: () => Math.random(), sleep: (ms: number) => new Promise<void>(r => setTimeout(r, ms))};
  for (let i = 0; i < CONTAINER_POLL.attempts; i++) {
   const s = await read(raw, key + ':read', () => raw.containerStatus(containerId), deps, policy);
   const code = (s.payload as {status_code?: unknown} | null)?.status_code;
   if (code === 'FINISHED' || code === 'PUBLISHED') return true;
   if (code === 'ERROR' || code === 'EXPIRED') return false;
   await d.sleep(CONTAINER_POLL.delayMs);
  }
  return false;
 };
 return {
  key: 'instagram_direct',
  account: o.credential.userId,
  async prepare(draft): Promise<PrepareResult> {
   const type = draft.mediaType ?? 'IMAGE';
   const issues = captionIssues(draft.text, INSTAGRAM_CAPTION_MAX, INSTAGRAM_HASHTAG_MAX);
   if (type === 'IMAGE' && !draft.imageUrl) issues.push('공개 이미지 주소가 없습니다.');
   if (type === 'CAROUSEL') issues.push(...await carouselIssues(raw, draft));
   if (type === 'REELS') issues.push(...await reelsIssues(raw, draft));
   const reachable = type === 'IMAGE' && draft.imageUrl ? await raw.imageReachable(draft.imageUrl) : null;
   if (reachable === false) issues.push('공개 이미지 주소에 로그인 없이 접근할 수 없습니다(HEAD 확인 실패). Instagram이 이미지를 가져가지 못합니다.');
   return {ok: !issues.length, issues, imageReachable: reachable};
  },
  async submit(draft, idempotencyKey): Promise<PublishOutcome> {
   const type = draft.mediaType ?? 'IMAGE';
   return twoStepPublish({
    channel: 'instagram_direct', key, idempotencyKey, limit: INSTAGRAM_PUBLISH_LIMIT, journal: o.journal, deps, policy, now: o.now,
    createContainer: childIds => raw.createContainer(draft, childIds),
    ...(type === 'CAROUSEL' && draft.items?.length ? {children: draft.items.map(url => () => raw.childContainer(url))} : {}),
    publish: async containerId => type === 'REELS' && !(await containerReady(containerId)) ? {kind: 'response', status: 400, payload: {error: {message: '릴스 컨테이너가 준비되지 않았습니다(처리 실패 또는 만료).'}}} : raw.publish(containerId),
   });
  },
  async status(id): Promise<PublishStatus> {
   const r = await read(raw, key + ':read', () => raw.media(id), deps, policy);
   const payload = r.payload as {id?: unknown; permalink?: unknown} | null;
   if (!payload) return {id, status: 'unknown', raw: r.last};
   return {id, status: payloadId(payload) === id ? 'published' : 'not_found', ...(typeof payload.permalink === 'string' ? {permalink: payload.permalink} : {}), raw: payload};
  },
  async limit(): Promise<PublishLimit> {
   const r = await read(raw, key + ':read', () => raw.limit(), deps, policy);
   return parsePublishLimit(r.payload);
  },
  async recentMedia(): Promise<RecentMediaItem[] | null> {
   const r = await read(raw, key + ':read', () => raw.recentMedia(), deps, policy);
   return r.payload ? parseRecentMedia(r.payload, 'caption') : null;
  },
  async collect(postId, window): Promise<Collected> {
   // Facebook Login 호스트는 기존 수집 커넥터(lib/connectors/instagram.ts)를 그대로 쓴다(같은 지표·같은 한계 문구). Instagram Login 호스트만 여기서 읽는다.
   if (o.credential.login !== 'instagram') return instagram.collect({channel: 'instagram', accessToken: o.credential.accessToken, userId: o.credential.userId}, postId, window);
   const mediaId = str(postId, '게시물 ID', 60, true);
   const [media, insights] = await Promise.all([read(raw, key + ':read', () => raw.media(mediaId), deps, policy), read(raw, key + ':read', () => raw.insights(mediaId), deps, policy)]);
   const reach = insightValue(insights.payload, 'reach'), shares = insightValue(insights.payload, 'shares');
   const postedAt = typeof (media.payload as {timestamp?: unknown} | null)?.timestamp === 'string' ? String((media.payload as {timestamp: string}).timestamp) : '';
   const limitations = ['Instagram 미디어 인사이트는 게시 이후 누적값입니다. 요청한 기간만의 값이 아니므로 기간 비교에 그대로 쓸 수 없습니다.', ...(postedAt ? [`게시 시점 ${postedAt} 기준 누적입니다.`] : ['게시 시점을 확인하지 못해 경과 시간을 비교할 수 없습니다.']), ...(reach === null ? ['도달 수를 확인하지 못했습니다.'] : []), ...(shares === null ? ['공유 수를 확인하지 못했습니다.'] : [])];
   return {arm: {denominator: reach, numerator: shares, source: `Instagram(직접 게시) · @${o.credential.userId} · 게시물 ${mediaId}`}, account: o.credential.userId, definition: '도달 대비 공유 (reach를 분모, shares를 분자로 사용). 게시 이후 누적값.', window: {from: str(window.from, '수집 시작일', 20, true), to: str(window.to, '수집 종료일', 20, true)}, fetchedAt: stamp(), limitations, raw: {media: media.payload, insights: insights.payload}};
  },
  async collectComments(postId): Promise<PublicationComment[]> {
   const r = await read(raw, key + ':read', () => raw.comments(str(postId, '게시물 ID', 60, true)), deps, policy);
   return parseComments(r.payload);
  },
  async verify(): Promise<VerifiedAccount> {
   const r = await read(raw, key + ':read', () => raw.me(), deps, policy);
   const payload = r.payload as {id?: unknown; username?: unknown} | null;
   if (!payload) throw new ConnectorAuthError('Instagram 계정을 확인하지 못했습니다' + (r.last?.kind === 'response' ? ` (${payloadError((r.last as Attempt).payload, r.last.status)})` : '') + '. 토큰과 권한(instagram_business_content_publish)을 확인하세요.');
   const id = payloadId(payload);
   if (id && id !== o.credential.userId) throw new ConnectorAuthError(`토큰의 계정(${id})이 입력한 Instagram 계정 ID(${o.credential.userId})와 다릅니다.`);
   return {account: typeof payload.username === 'string' && payload.username ? payload.username : o.credential.userId, ...(o.credential.expiresAt ? {expiresAt: o.credential.expiresAt} : {})};
  },
 };
}
