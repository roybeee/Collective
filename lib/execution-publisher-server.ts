// C3 발행 공급자 선택·직접 게시 전송(서버). 기능 스위치는 이 파일에서만 읽는다(구조 규칙: lib/execution-server.ts는 feature-flags를 직접 import하지 않는다).
// 선택 규칙: 스위치 instagram_direct_publish가 켜져 있고 브랜드에 instagram_direct 연결이 있으면 Instagram 직접 게시, 아니면 스위치 threads_publish와 threads 연결이 있으면 Threads, 둘 다 아니면 기존 Buffer 경로(불변).
// 보내는 시점은 기존과 같다: 사람이 승인(approve)한 발행을 사람이 실행(execute)했을 때만. 직접 게시는 예약이 아니라 실행 즉시 게시된다(Graph API에 예약 게시가 없다).
import {ApiError, readRecord, recordStatement, stamp, type Actor} from './server';
import {isEnabled} from './feature-flags';
import {loadPublisherCredential, publisherLabels, type PublisherCredentialMeta} from './channel-credentials';
import {instagramPublisher} from './connectors/instagram-publish';
import {threadsPublisher} from './connectors/threads';
import type {ContainerEntry, ContainerJournal} from './connectors/publish-core';
import type {DirectPublisherCredential, PublishDraft, Publisher, PublisherChannel, PublicationComment} from './connectors/types';
import type {Campaign} from './agency';
import type {Publication, PublisherStatus} from './execution';

export type DirectSelection = {kind: PublisherChannel; credential: DirectPublisherCredential; meta: PublisherCredentialMeta};
export const directChannelId = (channel: PublisherChannel, userId: string) => `${channel}:${userId}`;
export const isDirectChannelId = (channelId: string | undefined) => /^(instagram_direct|threads):\d+$/.test(channelId ?? '');
const flagOf: Record<PublisherChannel, 'instagram_direct_publish' | 'threads_publish'> = {instagram_direct: 'instagram_direct_publish', threads: 'threads_publish'};
async function flagOn(owner: string, channel: PublisherChannel) { try { return await isEnabled(owner, flagOf[channel]); } catch { return false; } }

// 스위치 켜짐 + 브랜드 연결이 있는 첫 채널(instagram_direct 우선). 없으면 null(Buffer 경로).
export async function selectDirectPublisher(owner: string, brandId: string): Promise<DirectSelection | null> {
 for (const kind of ['instagram_direct', 'threads'] as const) {
  if (!await flagOn(owner, kind)) continue;
  const loaded = await loadPublisherCredential(owner, kind, brandId);
  if (loaded) return {kind, credential: loaded.credential, meta: loaded.meta};
 }
 return null;
}
// 실행 화면·승인 게이트가 쓰는 발행 계정 모양(lib/execution-server.ts PublisherCredential과 같은 필드). secret은 비운다(토큰은 channel_credential에 있다).
export function directPublisherCredential(sel: DirectSelection) {
 return {secret: '', version: sel.meta.version, channelId: directChannelId(sel.kind, sel.credential.userId), account: `${sel.meta.account} · ${publisherLabels[sel.kind]}`};
}
export const directPublisherStatus = (sel: DirectSelection): PublisherStatus => ({connected: true, ...directPublisherCredential(sel)});

// 두 단계 저널을 records(kind publication_container, id=발행 id, parent 캠페인)에 둔다.
export function d1ContainerJournal(owner: string, campaignId: string): ContainerJournal {
 return {
  async get(id) { try { return await readRecord<ContainerEntry>(owner, 'publication_container', id); } catch (e) { if (e instanceof ApiError && e.status === 404) return undefined; throw e; } },
  async set(entry) { await recordStatement(owner, 'publication_container', entry.id, entry, campaignId).run(); },
 };
}
export function publisherFor(sel: DirectSelection, journal: ContainerJournal): Publisher {
 return sel.kind === 'threads' ? threadsPublisher({credential: sel.credential, journal}) : instagramPublisher({credential: sel.credential, journal});
}
// 발행 → 게시 초안. 캡션은 저장된 최종 캡션 그대로(AI 생성물·가상인물 표시 줄·게시 코드 줄 포함, lib/execution.ts composeCaption). 이미지는 승인 때 만든 공개 사본(표시 처리된 바이트의 해시 주소).
export const directDraftFor = (p: Pick<Publication, 'caption' | 'mediaUrl'>): PublishDraft => ({text: p.caption, imageUrl: p.mediaUrl, mediaType: 'IMAGE'});

const failed = (pending: Publication, error: string): Publication => ({...pending, status: 'failed', error});
// 접수 예약(reservePublication) 뒤 호출된다(attemptedAt·submitting은 이미 저장됐다). 보내지 않은 실패는 failed, 보낸 뒤 결과 불명은 uncertain, 게시 성공은 published다.
// 스위치·연결이 승인 뒤 바뀌었거나 준비 검사(캡션 길이·이미지 접근)·한도 사전 확인에 걸리면 보내지 않는다.
export async function dispatchDirect(owner: string, campaign: Campaign, pending: Publication): Promise<Publication> {
 const sel = await selectDirectPublisher(owner, campaign.brandId);
 if (!sel) return failed(pending, '직접 게시 스위치 또는 브랜드 연결이 실행 전에 꺼졌습니다. 보내지 않았습니다.');
 if (directChannelId(sel.kind, sel.credential.userId) !== pending.channelId) return failed(pending, '승인 때의 발행 계정과 지금 연결된 계정이 다릅니다. 보내지 않았습니다. 재확인 뒤 다시 승인하세요.');
 const publisher = publisherFor(sel, d1ContainerJournal(owner, campaign.id)), draft = directDraftFor(pending), label = publisherLabels[sel.kind];
 const prepared = await publisher.prepare(draft);
 if (!prepared.ok) return failed(pending, `${label} 준비 검사 실패: ${prepared.issues.join(' ')} 보내지 않았습니다.`);
 const limit = await publisher.limit();
 if (limit.remaining === 0) return failed(pending, `${label} 게시 한도 소진(24시간 ${limit.used}/${limit.total}). 보내지 않았습니다. 한도가 풀린 뒤 다시 준비하세요.`);
 const result = await publisher.submit(draft, pending.id);
 const container = result.containerId ? `container ${result.containerId}` : '';
 if (result.outcome === 'success' || result.outcome === 'cached') return {...pending, status: 'published', providerId: result.id, providerStatus: 'published', error: undefined};
 if (result.outcome === 'unknown') return {...pending, status: 'uncertain', providerStatus: container || undefined, error: `${label}: ${result.error ?? '결과를 확인하지 못했습니다.'} 자동 재전송하지 않습니다.`};
 return {...failed(pending, `${label}: ${result.error ?? '게시하지 못했습니다.'}`), providerStatus: container || undefined};
}
// 댓글·답글 수집(학습 실험실용, 추가만). 직접 게시한 발행(providerId·직접 채널)만 대상이다. 자동 답글은 없다.
export type StoredComment = PublicationComment & {publicationId: string; campaignId: string; channel: PublisherChannel; postId: string; collectedAt: string; collectedBy: string | null};
export async function collectPublicationComments(owner: string, campaign: Campaign, p: Publication, who?: Pick<Actor, 'id'> | null) {
 if (!p.providerId || !isDirectChannelId(p.channelId) || p.status !== 'published') throw new ApiError(409, '직접 게시로 게시 확인된 발행만 댓글을 수집할 수 있습니다.');
 const sel = await selectDirectPublisher(owner, campaign.brandId);
 if (!sel || directChannelId(sel.kind, sel.credential.userId) !== p.channelId) throw new ApiError(409, '이 발행을 게시한 계정의 연결과 스위치가 켜져 있어야 댓글을 수집할 수 있습니다.');
 const comments = await publisherFor(sel, d1ContainerJournal(owner, campaign.id)).collectComments(p.providerId);
 const at = stamp();
 for (const c of comments) {
  const row: StoredComment = {...c, publicationId: p.id, campaignId: campaign.id, channel: sel.kind, postId: p.providerId, collectedAt: at, collectedBy: who?.id ?? null};
  await recordStatement(owner, 'publication_comment', `${p.id}:${c.id}`, row, campaign.id).run();
 }
 return {publicationId: p.id, channel: sel.kind, collected: comments.length, collectedAt: at};
}
