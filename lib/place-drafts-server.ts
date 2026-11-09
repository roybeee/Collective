// C5 플레이스 리뷰 답글·소식 초안 서버. 저장은 records kind place_draft(parent=지점), 장치 매핑 확인은 place_draft_mapping(id=지점, parent=지점).
// 스위치 place_drafts(기본 꺼짐): 꺼지면 쓰기는 409, 조회는 계속된다. 권한은 대표·관리자(직원 403). 승인은 자율성 규칙 publish_submit(T3, never → 403)을 지난다.
// 제출 경로: (a) 복사·제출 지원 — 승인 문안과 스마트플레이스 관리 주소를 돌려주고, 사람이 제출한 뒤 '제출 표시'를 누른다. (b) 점포 브라우저 작업 — store_browser_execution이 켜져 있고
// 관리자가 그 지점 장치에 리뷰 답글·소식 화면 매핑(registered_dom)이 있다고 확인했을 때만 store_browser_job(reply_review·post_news, 상태 draft)을 만든다. 그 작업은 점포 브라우저 화면에서 다시 승인해야 실행된다.
// 자동 제출은 없다. 네이버 스마트플레이스에는 공개 쓰기 API가 없고, native 어댑터는 조회 전용이다(docs/PLACE-DRAFTS.ko.md).
import {ApiError, database, listRecords, readRecord, recordStatement, stamp, str, uid, type Actor} from './server';
import {isEnabled} from './feature-flags';
import {assertAutonomy} from './autonomy-server';
import {readBrandVoice} from './brand-voice-server';
import {scopedBrandFacts, type BrandFact} from './brand-facts';
import {storeBrowserOn} from './store-browser-server';
import {checkPlaceDraft, newsPostDraft, reviewReplyDraft, sha256Hex, sourceOf, transitionDraft, NEWS_TOPICS, PLACE_DRAFT_KINDS, PLACE_DRAFT_LIMITS, PlaceDraftError, type DraftContext, type NewsInput, type NewsTopic, type PlaceDraft, type PlaceDraftKind} from './place-drafts';
import type {Store} from './store-marketing';
import type {BrowserBinding, BrowserDevice, BrowserJob, BrowserJobType} from './store-browser';

export const PLACE_DRAFT_MESSAGES = {
 off: '플레이스 초안 기능이 꺼져 있습니다. 소유자가 기능 스위치 place_drafts를 켜야 합니다.',
 adminOnly: '플레이스 답글·소식 초안은 대표·관리자만 작성·승인할 수 있습니다.',
 archived: '보관한 지점입니다.',
 stale: '초안이 그사이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.',
 blocking: '규정 점검에서 막는 항목이 있어 승인할 수 없습니다. 문안을 고치거나 확정 사실을 먼저 확인하세요.',
 changed: '승인한 문안과 저장된 문안이 다릅니다. 다시 승인하세요.',
 browserOff: '점포 브라우저 실행 기능(store_browser_execution)이 꺼져 있어 장치 작업을 만들 수 없습니다. 복사·제출 지원을 쓰세요.',
 noMapping: '이 지점 장치에 리뷰 답글·소식 화면 매핑(registered_dom)이 확인되지 않았습니다. 복사·제출 지원을 쓰거나 관리자가 매핑을 먼저 확인하세요.',
} as const;
export const SMARTPLACE_ADMIN_URL = 'https://new.smartplace.naver.com/';
const DEVICE_TYPES: Record<PlaceDraftKind, BrowserJobType> = {review_reply: 'reply_review', news_post: 'post_news'};
export type PlaceDraftMapping = {id: string; storeId: string; bindingVersion: number; deviceId: string; profileId: string; taskTypes: BrowserJobType[]; status: 'active' | 'revoked'; confirmedBy: string; confirmedAt: string; note?: string; version: number};

const conflict = (message: string): never => { throw new ApiError(409, message); };
const wrap = <T>(fn: () => T) => { try { return fn(); } catch (e) { if (e instanceof PlaceDraftError) throw new ApiError(409, e.message); throw e; } };
function requireAdmin(who: Pick<Actor, 'role'>) { if (who.role !== 'owner' && who.role !== 'admin') throw new ApiError(403, PLACE_DRAFT_MESSAGES.adminOnly); }
export async function placeDraftsOn(owner: string) { return isEnabled(owner, 'place_drafts').catch(() => false); }
async function requireOn(owner: string) { if (!(await placeDraftsOn(owner))) conflict(PLACE_DRAFT_MESSAGES.off); }
async function optional<T>(owner: string, kind: string, id: string) { try { return await readRecord<T>(owner, kind, id); } catch (e) { if (e instanceof ApiError && e.status === 404) return undefined; throw e; } }
async function activeStore(owner: string, raw: unknown) { const store = await readRecord<Store>(owner, 'store', str(raw, '지점', 100, true)); if (store.status !== 'active') conflict(PLACE_DRAFT_MESSAGES.archived); return store; }
const save = (owner: string, d: PlaceDraft) => recordStatement(owner, 'place_draft', d.id, d, d.storeId);
async function readDraft(owner: string, input: Record<string, unknown>, checkVersion = false) {
 const d = await readRecord<PlaceDraft>(owner, 'place_draft', str(input.id, '초안', 100, true));
 if ((checkVersion || input.expectedVersion !== undefined) && input.expectedVersion !== d.version) conflict(PLACE_DRAFT_MESSAGES.stale);
 return d;
}

// 초안 문맥: 확정 사실(지점 > 브랜드, 유효기간·출처 통과)·거절 사실(금지 표현)·확정 말투. 초안(미확정) 말투는 쓰지 않는다.
async function contextOf(owner: string, store: Store): Promise<DraftContext & {prohibited: BrandFact[]}> {
 const [facts, voiceRow] = await Promise.all([listRecords<BrandFact>(owner, 'brand_fact', store.brandId), readBrandVoice(owner, store.brandId)]);
 const scoped = scopedBrandFacts(facts, store.brandId, store.id), voice = voiceRow?.confirmedVoice ?? null;
 return {storeLabel: store.name, facts: scoped.confirmed, prohibited: scoped.prohibited, voice: voice ? {version: voice.version, tone: voice.tone, avoidTerms: voice.avoidTerms} : null};
}
const check = (d: Pick<PlaceDraft, 'kind' | 'news'>, text: string, ctx: Awaited<ReturnType<typeof contextOf>>) => checkPlaceDraft({kind: d.kind, text, news: d.news, facts: ctx.facts, prohibited: ctx.prohibited, avoidTerms: ctx.voice?.avoidTerms ?? [], now: stamp()});

const day = (v: unknown, label: string) => { const s = str(v, label, 20, true); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s))) throw new ApiError(400, `${label}을 YYYY-MM-DD 형식으로 입력하세요.`); return s; };
function newsInput(raw: unknown): NewsInput {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, '소식 입력(news)이 필요합니다.');
 const r = raw as Record<string, unknown>, topic = r.topic ?? 'notice';
 if (!(NEWS_TOPICS as readonly unknown[]).includes(topic)) throw new ApiError(400, `소식 종류는 ${NEWS_TOPICS.join('·')} 중 하나입니다.`);
 const L = PLACE_DRAFT_LIMITS, condition = r.condition ? str(r.condition, '조건', L.condition, true) : undefined, body = r.body ? str(r.body, '본문', L.body, true) : undefined;
 const period = r.period && typeof r.period === 'object' ? {from: day((r.period as Record<string, unknown>).from, '시작일'), to: day((r.period as Record<string, unknown>).to, '종료일')} : undefined;
 if (period && period.from > period.to) throw new ApiError(400, '기간을 확인하세요.');
 if (topic === 'promotion' && !condition) throw new ApiError(400, '프로모션 소식에는 조건(무엇을 어떻게)이 필요합니다.');
 return {topic: topic as NewsTopic, title: str(r.title, '소식 제목', L.title, true), ...(condition ? {condition} : {}), ...(body ? {body} : {}), ...(period ? {period} : {})};
}

export async function createPlaceDraft(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who); await requireOn(who.owner);
 const store = await activeStore(who.owner, input.storeId), kind = input.kind;
 if (!(PLACE_DRAFT_KINDS as readonly unknown[]).includes(kind)) throw new ApiError(400, '초안 종류는 review_reply(리뷰 답글) 또는 news_post(소식)입니다.');
 const rating = input.rating === undefined || input.rating === null || input.rating === '' ? null : input.rating;
 if (rating !== null && (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5)) throw new ApiError(400, '별점은 1~5 정수입니다.');
 const ctx = await contextOf(who.owner, store), now = stamp();
 const source = kind === 'review_reply' ? sourceOf({text: str(input.sourceText, '리뷰 원문', PLACE_DRAFT_LIMITS.source, true), ...(input.reviewRef ? {reviewRef: str(input.reviewRef, '리뷰 메모', PLACE_DRAFT_LIMITS.reviewRef, true)} : {}), rating: rating as number | null}) : null;
 const news = kind === 'news_post' ? newsInput(input.news) : null;
 const draft = source ? reviewReplyDraft(source, ctx) : newsPostDraft(news as NewsInput, ctx);
 const d: PlaceDraft = {id: uid(), storeId: store.id, brandId: store.brandId, kind: kind as PlaceDraftKind, status: 'draft', version: 1, source, news, draft, compliance: check({kind: kind as PlaceDraftKind, news}, draft.text, ctx), history: [{at: now, from: null, to: 'draft', by: who.id, note: `템플릿 ${draft.template}`}], createdAt: now, createdBy: who.id, updatedAt: now};
 await save(who.owner, d).run();
 return {draft: d};
}
// 사람이 문안을 고친다(초안 상태만). 규정 점검을 다시 돌린다. 템플릿에서 벗어난 문안은 edited로 표시한다.
export async function editPlaceDraft(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who); await requireOn(who.owner);
 const old = await readDraft(who.owner, input, true);
 if (old.status !== 'draft') conflict('초안 상태에서만 문안을 고칠 수 있습니다. 승인 뒤에는 취소하고 새로 만드세요.');
 const text = str(input.text, '문안', old.kind === 'review_reply' ? PLACE_DRAFT_LIMITS.reply : PLACE_DRAFT_LIMITS.news, true);
 const ctx = await contextOf(who.owner, await activeStore(who.owner, old.storeId)), now = stamp();
 const d: PlaceDraft = {...old, draft: {...old.draft, text, edited: true}, compliance: check(old, text, ctx), version: old.version + 1, updatedAt: now, history: [...old.history, {at: now, from: 'draft' as const, to: 'draft' as const, by: who.id, note: '문안 수정'}].slice(-PLACE_DRAFT_LIMITS.history)};
 await save(who.owner, d).run();
 return {draft: d};
}
// 승인: 그 순간의 확정 사실로 다시 점검하고, 막는 항목이 있으면 409. 승인 문안 해시를 고정한다.
export async function approvePlaceDraft(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who); await requireOn(who.owner);
 const autonomy = await assertAutonomy(who.owner, 'publish_submit');
 const old = await readDraft(who.owner, input);
 if (old.status !== 'draft') conflict('초안만 승인할 수 있습니다.');
 const compliance = check(old, old.draft.text, await contextOf(who.owner, await activeStore(who.owner, old.storeId)));
 if (compliance.blocking) { await save(who.owner, {...old, compliance}).run(); throw new ApiError(409, `${PLACE_DRAFT_MESSAGES.blocking} (${compliance.issues.filter(i => i.severity === 'block').map(i => i.title).join(' · ')})`); }
 const now = stamp(), d = wrap(() => transitionDraft({...old, compliance, approvedAt: now, approvedBy: who.id, approvedSha256: ''}, 'approved', who.id, now));
 const approved = {...d, approvedSha256: await sha256Hex(d.draft.text)};
 await save(who.owner, approved).run();
 return {draft: approved, submitHelp: await submitHelp(who.owner, approved), autonomy: autonomy.mode};
}
async function assertApprovedText(d: PlaceDraft) { if (d.status !== 'approved' || !d.approvedSha256 || d.approvedSha256 !== await sha256Hex(d.draft.text)) conflict(d.status !== 'approved' ? '승인된 초안만 제출할 수 있습니다.' : PLACE_DRAFT_MESSAGES.changed); }

// 복사·제출 지원: 승인 문안과 공식 관리 주소. 리뷰·소식 화면의 정확한 주소는 관찰하지 못해 공식 진입 주소와 메뉴 경로를 준다. 연결된 점포 브라우저가 있으면 관찰한 관리 주소(영업시간 화면)도 함께 준다.
export async function submitHelp(owner: string, d: PlaceDraft) {
 const binding = await optional<BrowserBinding>(owner, 'store_browser_binding', d.storeId);
 return {text: d.status === 'approved' || d.status === 'submitted' || d.status === 'verified' ? d.draft.text : null, adminUrl: SMARTPLACE_ADMIN_URL, observedManagerUrl: binding?.managerUrl ?? null,
  path: d.kind === 'review_reply' ? '스마트플레이스 관리 → 리뷰 → 해당 리뷰의 답글 쓰기' : '스마트플레이스 관리 → 소식 → 새 소식 쓰기',
  note: '네이버 스마트플레이스에는 공개 쓰기 API가 없어 COLLECTIVE가 직접 등록하지 않습니다. 승인한 문안을 그대로 붙여 넣고, 등록한 뒤 제출 표시를 눌러 주세요.'};
}
export async function markSubmitted(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who); await requireOn(who.owner);
 const old = await readDraft(who.owner, input);
 await assertApprovedText(old);
 if (old.deviceTask) conflict('점포 브라우저 작업이 있는 초안입니다. 장치 결과를 확인(sync_device)하세요.');
 const now = stamp(), note = input.note ? str(input.note, '제출 메모', PLACE_DRAFT_LIMITS.note) : undefined;
 const d = wrap(() => transitionDraft({...old, submission: {channel: 'manual', at: now, by: who.id, ...(note ? {note} : {})}}, 'submitted', who.id, now, '사람이 스마트플레이스에 직접 등록'));
 await save(who.owner, d).run();
 return {draft: d};
}
export async function markVerified(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who); await requireOn(who.owner);
 const old = await readDraft(who.owner, input), now = stamp(), note = input.note ? str(input.note, '확인 메모', PLACE_DRAFT_LIMITS.note) : undefined;
 const d = wrap(() => transitionDraft({...old, verification: {at: now, by: who.id, source: 'manual', ...(note ? {note} : {})}}, 'verified', who.id, now, '사람이 게시 화면에서 확인'));
 await save(who.owner, d).run();
 return {draft: d};
}
export async function cancelPlaceDraft(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who);
 const old = await readDraft(who.owner, input);
 if (old.deviceTask) { const job = await optional<BrowserJob>(who.owner, 'store_browser_job', old.deviceTask.jobId); if (job && !['cancelled', 'waiting_human', 'verified'].includes(job.status)) conflict('점포 브라우저 작업을 먼저 취소하세요.'); }
 const now = stamp(), d = wrap(() => transitionDraft(old, 'cancelled', who.id, now, input.note ? str(input.note, '취소 사유', PLACE_DRAFT_LIMITS.note) : undefined));
 await save(who.owner, d).run();
 return {draft: d};
}

// 관리자 확인: 이 지점 연결 장치의 로컬 설정에 리뷰 답글·소식 화면 매핑(registered_dom)을 관찰해 등록했다. 서버는 선택자를 받지 않고 확인 사실과 연결 판만 남긴다.
export async function declareMapping(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who); await requireOn(who.owner);
 if (!(await storeBrowserOn(who.owner))) conflict(PLACE_DRAFT_MESSAGES.browserOff);
 const store = await activeStore(who.owner, input.storeId), binding = await optional<BrowserBinding>(who.owner, 'store_browser_binding', store.id);
 if (!binding) conflict('점포 브라우저 연결(장치·관리 주소)이 먼저 필요합니다.');
 const types = Array.isArray(input.taskTypes) ? [...new Set(input.taskTypes)] : [];
 if (!types.length || types.some(t => t !== 'reply_review' && t !== 'post_news')) throw new ApiError(400, '작업 유형은 reply_review·post_news 중에서 고르세요.');
 const old = await optional<PlaceDraftMapping>(who.owner, 'place_draft_mapping', store.id);
 const mapping: PlaceDraftMapping = {id: store.id, storeId: store.id, bindingVersion: binding!.version, deviceId: binding!.deviceId, profileId: binding!.profileId, taskTypes: types as BrowserJobType[], status: 'active', confirmedBy: who.id, confirmedAt: stamp(), ...(input.note ? {note: str(input.note, '매핑 메모', PLACE_DRAFT_LIMITS.note)} : {}), version: (old?.version ?? 0) + 1};
 await recordStatement(who.owner, 'place_draft_mapping', mapping.id, mapping, store.id).run();
 return {mapping};
}
export async function revokeMapping(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who);
 const old = await readRecord<PlaceDraftMapping>(who.owner, 'place_draft_mapping', str(input.storeId, '지점', 100, true));
 const mapping = {...old, status: 'revoked' as const, version: old.version + 1};
 await recordStatement(who.owner, 'place_draft_mapping', mapping.id, mapping, mapping.storeId).run();
 return {mapping};
}

// 장치 작업 만들기: 승인 문안·지점 연결·장치·매핑 확인이 모두 맞을 때만. 작업은 draft로 만들어 점포 브라우저 승인(approve_job)을 한 번 더 거친다.
export async function createDeviceTask(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who); await requireOn(who.owner);
 if (!(await storeBrowserOn(who.owner))) conflict(PLACE_DRAFT_MESSAGES.browserOff);
 const old = await readDraft(who.owner, input);
 await assertApprovedText(old);
 if (old.deviceTask) conflict('이미 점포 브라우저 작업을 만든 초안입니다.');
 const store = await activeStore(who.owner, old.storeId), binding = await optional<BrowserBinding>(who.owner, 'store_browser_binding', store.id);
 const mapping = await optional<PlaceDraftMapping>(who.owner, 'place_draft_mapping', store.id), type = DEVICE_TYPES[old.kind];
 if (!binding || !mapping || mapping.status !== 'active' || mapping.bindingVersion !== binding.version || mapping.deviceId !== binding.deviceId || mapping.profileId !== binding.profileId || !mapping.taskTypes.includes(type)) conflict(PLACE_DRAFT_MESSAGES.noMapping);
 const device = await optional<BrowserDevice>(who.owner, 'store_browser_device', binding!.deviceId);
 if (!device || device.status !== 'active') conflict('지점 연결 장치가 회수되었거나 없습니다.');
 const now = stamp(), placeDraft = {draftId: old.id, draftVersion: old.version, kind: old.kind, text: old.draft.text, textSha256: old.approvedSha256!, ...(old.source?.reviewRef ? {reviewRef: old.source.reviewRef} : {})};
 const job: BrowserJob = {id: uid(), storeId: store.id, type, status: 'draft', bindingVersion: binding!.version, binding: binding!, beforeHours: '', afterHours: '', placeDraft, publicReadback: {state: 'not_checked'}, digest: await sha256Hex(JSON.stringify({binding, type, placeDraft})), deviceId: binding!.deviceId, version: 1, createdAt: now, updatedAt: now};
 const d: PlaceDraft = {...old, deviceTask: {jobId: job.id, createdAt: now, createdBy: who.id, jobStatus: job.status}, version: old.version + 1, updatedAt: now};
 await database().batch([recordStatement(who.owner, 'store_browser_job', job.id, job, store.id), recordStatement(who.owner, 'store_browser_event', uid(), {jobId: job.id, storeId: store.id, action: 'create_job', status: job.status, version: job.version, createdAt: now, source: 'place_draft'}, store.id), save(who.owner, d)]);
 return {draft: d, job: {id: job.id, type: job.type, status: job.status}};
}
// 장치 작업 결과를 초안에 옮긴다(읽기만). 저장 시작 이후면 제출 표시(device), 관리 화면 재조회 확인이면 게시 확인(device).
export async function syncDeviceTask(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who);
 const old = await readDraft(who.owner, input);
 if (!old.deviceTask) conflict('점포 브라우저 작업이 없는 초안입니다.');
 const job = await readRecord<BrowserJob>(who.owner, 'store_browser_job', old.deviceTask!.jobId), now = stamp();
 const started = ['submit_started', 'submitted', 'unknown', 'verified'].includes(job.status) || (job.status === 'waiting_human' && !!job.submissionStartedAt);
 let d: PlaceDraft = {...old, deviceTask: {...old.deviceTask!, jobStatus: job.status}};
 if (started && d.status === 'approved') d = wrap(() => transitionDraft({...d, submission: {channel: 'device', at: job.submissionStartedAt ?? now, by: who.id, deviceJobId: job.id}}, 'submitted', who.id, now, `점포 브라우저 작업 ${job.status}`));
 if (job.status === 'verified' && d.status === 'submitted') d = wrap(() => transitionDraft({...d, verification: {at: now, by: who.id, source: 'device'}}, 'verified', who.id, now, '장치가 관리 화면 재조회로 확인'));
 if (d.status === old.status) d = {...d, version: old.version + 1, updatedAt: now};
 await save(who.owner, d).run();
 return {draft: d, job: {id: job.id, type: job.type, status: job.status}};
}

export async function listPlaceDrafts(owner: string, storeId: string) {
 const store = await readRecord<Store>(owner, 'store', storeId);
 const [drafts, mapping, enabled, browser] = await Promise.all([listRecords<PlaceDraft>(owner, 'place_draft', store.id), optional<PlaceDraftMapping>(owner, 'place_draft_mapping', store.id), placeDraftsOn(owner), storeBrowserOn(owner)]);
 return {enabled, storeBrowserEnabled: browser, drafts: drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)), mapping: mapping ?? null, notice: '자동 제출은 없습니다. 네이버 스마트플레이스에는 공개 쓰기 API가 없어 승인한 문안을 사람이 등록하거나, 등록한 점포 브라우저 장치가 다시 승인된 작업으로만 저장합니다.'};
}
export async function placeDraftAction(who: Actor, input: Record<string, unknown>) {
 switch (input.action) {
  case 'create': return createPlaceDraft(who, input);
  case 'edit': return editPlaceDraft(who, input);
  case 'approve': return approvePlaceDraft(who, input);
  case 'mark_submitted': return markSubmitted(who, input);
  case 'mark_verified': return markVerified(who, input);
  case 'cancel': return cancelPlaceDraft(who, input);
  case 'create_device_task': return createDeviceTask(who, input);
  case 'sync_device': return syncDeviceTask(who, input);
  case 'declare_mapping': return declareMapping(who, input);
  case 'revoke_mapping': return revokeMapping(who, input);
  case 'submit_help': { requireAdmin(who); const d = await readDraft(who.owner, input); return {submitHelp: await submitHelp(who.owner, d)}; }
  default: throw new ApiError(400, '지원하지 않는 작업입니다. create·edit·approve·mark_submitted·mark_verified·cancel·create_device_task·sync_device·declare_mapping·revoke_mapping·submit_help 중 하나를 보내세요.');
 }
}
