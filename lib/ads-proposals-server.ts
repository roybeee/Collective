// C4 네이버 검색광고 제안 서버. 저장은 소유자 범위 records(kind 'ads_proposal', parent_id=storeId 또는 '').
// 스위치 naver_ads_write(기본 꺼짐): 꺼져 있어도 제안 생성·조회·반려·미확인 대조(읽기)는 되고, 승인·반영만 409 '쓰기 스위치 꺼짐'이다.
// 승인·반영은 소유자·관리자만이며 자율성 규칙 budget_change(T3)를 지난다(never → 403). 반영은 제안 하나당 쓰기 1회: 보내기 전 '보냄'을 저장하고,
// 결과를 모르면 unknown으로 남겨 다시 보내지 않는다. 반영 뒤에는 GET으로 다시 읽어 verified/mismatch를 판정한다.
import {ApiError, listRecords, readRecord, recordStatement, stamp, str, uid, type Actor} from './server';
import {isEnabled} from './feature-flags';
import {assertAutonomy} from './autonomy-server';
import {loadCredential} from './channel-credentials';
import {call} from './connectors/naver-ads';
import {buildWriteRequest, executeWrite, liveDeps, readBack, verifyReadBack, NaverAdsWriteError, type WriteDeps, type WriteOperation} from './connectors/naver-ads-write';
import type {NaverAdsCredential} from './connectors/types';
import type {Store} from './store-marketing';
import {dedupeAgainst, manualProposal, proposeFromStats, statsWindow, transitionProposal, ProposalError, PROPOSAL_LABEL, type AdsProposal, type KeywordStats, type ProposalKind} from './ads-proposals';

export const FLAG_OFF = '쓰기 스위치 꺼짐: 기능 스위치 naver_ads_write를 켜야 승인·반영할 수 있습니다. 제안 생성·조회·대조는 계속됩니다.';
export const NOTICE = `네이버 검색광고 제안은 ${PROPOSAL_LABEL}. 승인은 소유자·관리자, 반영은 승인된 제안 하나당 1회, 반영 뒤 읽기 대조로 확인합니다. 자동 입찰은 없습니다.`;
const MAX_ADGROUPS = 10, STATS_BATCH = 100;
const STATS_FIELDS = ['impCnt', 'clkCnt', 'salesAmt', 'ccnt', 'convAmt', 'avgRnk'];

type Scope = {brandId: string | null; storeId: string | null};
const admin = (who: Actor) => who.role === 'owner' || who.role === 'admin';
function requireAdmin(who: Actor) { if (!admin(who)) throw new ApiError(403, '소유자·관리자만 광고 제안을 승인·반영할 수 있습니다.'); }
async function requireFlag(owner: string) { if (!(await isEnabled(owner, 'naver_ads_write'))) throw new ApiError(409, FLAG_OFF); }
const wrap = <T>(fn: () => T) => { try { return fn(); } catch (e) { if (e instanceof ProposalError || e instanceof NaverAdsWriteError) throw new ApiError(400, e.message); throw e; } };

// 지점은 이 워크스페이스의 지점이어야 하고 브랜드와 맞아야 한다. 없으면 워크스페이스 기본 자격증명을 쓴다.
async function scopeOf(owner: string, input: Record<string, unknown>): Promise<Scope> {
 const storeId = input.storeId === undefined || input.storeId === null || input.storeId === '' ? null : str(input.storeId, '지점', 100, true);
 const brandId = input.brandId === undefined || input.brandId === null || input.brandId === '' ? null : str(input.brandId, '브랜드', 100, true);
 if (!storeId) return {brandId, storeId: null};
 const store = await readRecord<Store>(owner, 'store', storeId);
 if (brandId && store.brandId !== brandId) throw new ApiError(400, '지점이 그 브랜드에 속하지 않습니다.');
 return {brandId: store.brandId, storeId};
}
async function credentialFor(owner: string, scope: Scope) {
 const {credential} = await loadCredential(owner, 'naver_ads', {brandId: scope.brandId, storeId: scope.storeId});
 return credential as NaverAdsCredential;
}
const rows = (raw: unknown): Record<string, unknown>[] => Array.isArray(raw) ? raw.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = (v: unknown) => typeof v === 'string' ? v : '';

export async function listProposals(owner: string, filter: {campaignId?: string | null; storeId?: string | null} = {}) {
 const all = await listRecords<AdsProposal>(owner, 'ads_proposal');
 return all.filter(p => (!filter.campaignId || p.campaignId === filter.campaignId) && (!filter.storeId || p.storeId === filter.storeId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
async function save(owner: string, p: AdsProposal) { await recordStatement(owner, 'ads_proposal', p.id, p, p.storeId ?? '').run(); return p; }
async function readProposal(owner: string, id: unknown) { return readRecord<AdsProposal>(owner, 'ads_proposal', str(id, '제안', 100, true)); }

// 14일 통계를 모은다: 캠페인의 광고그룹(최대 10) → 키워드 → /stats(id 100개씩). 읽기만 한다.
export async function collectKeywordStats(credential: NaverAdsCredential, campaignId: string, window: {from: string; to: string}): Promise<KeywordStats[]> {
 const adgroups = rows(await call(credential, '/ncc/adgroups', `?nccCampaignId=${encodeURIComponent(campaignId)}`)).slice(0, MAX_ADGROUPS);
 const keywords: KeywordStats[] = [];
 for (const g of adgroups) {
  const adgroupId = text(g.nccAdgroupId);
  if (!adgroupId) continue;
  for (const k of rows(await call(credential, '/ncc/keywords', `?nccAdgroupId=${encodeURIComponent(adgroupId)}`))) {
   const keywordId = text(k.nccKeywordId);
   if (keywordId) keywords.push({keywordId, keyword: text(k.keyword), adgroupId, bidAmt: num(k.bidAmt), userLock: k.userLock === true, impCnt: null, clkCnt: null, salesAmt: null, ccnt: null, convAmt: null, avgRnk: null});
  }
 }
 const stats = new Map<string, Record<string, unknown>>();
 for (let i = 0; i < keywords.length; i += STATS_BATCH) {
  const ids = keywords.slice(i, i + STATS_BATCH).map(k => `ids=${encodeURIComponent(k.keywordId)}`).join('&');
  const query = `?${ids}&fields=${encodeURIComponent(JSON.stringify(STATS_FIELDS))}&timeRange=${encodeURIComponent(JSON.stringify({since: window.from, until: window.to}))}`;
  const raw = await call(credential, '/stats', query);
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as {data?: unknown}).data) ? (raw as {data: unknown[]}).data : [];
  for (const row of rows(list)) if (typeof row.id === 'string') stats.set(row.id, row);
 }
 return keywords.map(k => { const s = stats.get(k.keywordId) ?? {}; return {...k, impCnt: num(s.impCnt), clkCnt: num(s.clkCnt), salesAmt: num(s.salesAmt), ccnt: num(s.ccnt), convAmt: num(s.convAmt), avgRnk: num(s.avgRnk)}; });
}

const target = (v: unknown, label: string) => { if (v === undefined || v === null || v === '') return null; if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new ApiError(400, `${label}은(는) 0보다 큰 숫자여야 합니다.`); return v; };
// 규칙 기반 제안 생성(스위치 무관, 읽기만). 같은 대상·규칙의 열린 제안은 다시 만들지 않는다.
export async function generateProposals(who: Actor, input: Record<string, unknown>, now = Date.now()) {
 const campaignId = str(input.campaignId, '네이버 캠페인 ID', 64, true), scope = await scopeOf(who.owner, input);
 const targets = {targetCpa: target(input.targetCpa, '목표 CPA'), targetRoas: target(input.targetRoas, '목표 ROAS')};
 const window = statsWindow(now), credential = await credentialFor(who.owner, scope);
 const keywords = await collectKeywordStats(credential, campaignId, window);
 const fresh = proposeFromStats({campaignId, storeId: scope.storeId, brandId: scope.brandId, window, keywords, targets}, {now: stamp(), by: who.id, id: uid});
 const created = dedupeAgainst(await listProposals(who.owner, {campaignId}), fresh);
 for (const p of created) await save(who.owner, p);
 return {created, skipped: fresh.length - created.length, keywords: keywords.length, window, notice: NOTICE};
}

const MANUAL_KINDS: readonly ProposalKind[] = ['create_keywords', 'create_campaign', 'resume'];
// 사람이 직접 적는 새 지출 제안(T3). 작업 본문은 반영 때와 같은 검증(buildWriteRequest)을 미리 거친다.
export async function createManualProposal(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who);
 const kind = input.kind;
 if (typeof kind !== 'string' || !MANUAL_KINDS.includes(kind as ProposalKind)) throw new ApiError(400, '직접 작성할 수 있는 제안은 create_keywords·create_campaign·resume입니다.');
 const campaignId = str(input.campaignId, '네이버 캠페인 ID', 64, true), scope = await scopeOf(who.owner, input), rationale = str(input.rationale, '사유', 1000, true);
 if (!input.operation || typeof input.operation !== 'object') throw new ApiError(400, '작업(operation)을 입력하세요.');
 const operation = input.operation as WriteOperation;
 wrap(() => buildWriteRequest(operation, '0'));
 const proposal = wrap(() => manualProposal({campaignId, storeId: scope.storeId, brandId: scope.brandId, kind: kind as 'create_keywords' | 'create_campaign' | 'resume', operation, rationale}, {now: stamp(), by: who.id, id: uid}));
 return save(who.owner, proposal);
}

export async function approveProposal(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who);
 await requireFlag(who.owner);
 const autonomy = await assertAutonomy(who.owner, 'budget_change');
 const p = await readProposal(who.owner, input.id);
 return {proposal: await save(who.owner, wrap(() => transitionProposal(p, 'approved', who.id, stamp()))), autonomy: autonomy.mode};
}
export async function rejectProposal(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who);
 const p = await readProposal(who.owner, input.id), note = typeof input.note === 'string' ? str(input.note, '사유', 500) : undefined;
 return save(who.owner, wrap(() => transitionProposal(p, 'rejected', who.id, stamp(), note)));
}

// 승인된 제안을 반영한다. 저널(write)이 이미 있으면 다시 보내지 않는다(sent/unknown → 대조만).
export async function applyProposal(who: Actor, input: Record<string, unknown>, deps?: WriteDeps) {
 requireAdmin(who);
 await requireFlag(who.owner);
 await assertAutonomy(who.owner, 'budget_change');
 const p = await readProposal(who.owner, input.id);
 if (p.write) throw new ApiError(409, '이미 보낸 제안입니다. 결과를 모르면 대조(reconcile)로 확인하세요. 다시 보내지 않습니다.');
 if (p.status !== 'approved') throw new ApiError(409, '승인된 제안만 반영할 수 있습니다.');
 const credential = await credentialFor(who.owner, {brandId: p.brandId, storeId: p.storeId});
 const sentAt = stamp();
 const result = await executeWrite(credential, p.operation, {...(deps ?? liveDeps()), onBeforeSend: async attempts => { await save(who.owner, {...p, write: {state: 'sent', attempts, sentAt}}); }});
 const write = {state: result.outcome === 'success' ? 'done' as const : result.outcome === 'unknown' ? 'unknown' as const : 'failed' as const, attempts: result.attempts, sentAt, finishedAt: stamp(), providerIds: result.providerIds, httpStatus: result.httpStatus, error: result.error};
 const next = transitionProposal({...p, write}, write.state === 'done' ? 'applied' : write.state === 'unknown' ? 'unknown' : 'failed', who.id, stamp(), result.error ?? undefined);
 if (next.status !== 'applied') return save(who.owner, next);
 return save(who.owner, await verify(credential, next, who.id));
}
async function verify(credential: NaverAdsCredential, p: AdsProposal, by: string): Promise<AdsProposal> {
 let observed;
 try { observed = await readBack(credential, p.operation, p.write?.providerIds ?? []); }
 catch (e) { return {...p, verification: {status: 'mismatch', checkedAt: stamp(), details: [`읽기 대조에 실패했습니다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`]}}; }
 const v = verifyReadBack(p.operation, p.write?.providerIds ?? [], observed);
 return transitionProposal({...p, verification: {...v, checkedAt: stamp()}}, v.status, by, stamp(), v.details.join(' | ') || undefined);
}

// 결과 미확인(unknown 또는 sent로 멈춘) 제안을 읽기만으로 판정한다. 기대 상태와 같으면 applied→verified, 아니면 failed(반영되지 않음)로 둔다. 스위치 무관.
export async function reconcileProposal(who: Actor, input: Record<string, unknown>) {
 requireAdmin(who);
 const p = await readProposal(who.owner, input.id);
 const stuck = p.status === 'approved' && p.write?.state === 'sent';
 if (p.status !== 'unknown' && !stuck) throw new ApiError(409, '결과 미확인 상태의 제안만 대조할 수 있습니다.');
 const credential = await credentialFor(who.owner, {brandId: p.brandId, storeId: p.storeId});
 const base = stuck ? transitionProposal({...p, write: {...p.write!, state: 'unknown', error: '전송 뒤 프로세스가 끝나 결과를 모릅니다.'}}, 'unknown', who.id, stamp()) : p;
 let observed;
 try { observed = await readBack(credential, base.operation, base.write?.providerIds ?? []); }
 catch (e) { return save(who.owner, {...base, verification: {status: 'mismatch', checkedAt: stamp(), details: [`읽기 대조에 실패했습니다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`]}}); }
 const v = verifyReadBack(base.operation, base.write?.providerIds ?? [], observed);
 if (v.status === 'verified') return save(who.owner, transitionProposal(transitionProposal({...base, write: {...base.write!, state: 'done'}, verification: {...v, checkedAt: stamp()}}, 'applied', who.id, stamp(), '읽기 대조로 반영 확인'), 'verified', who.id, stamp()));
 return save(who.owner, transitionProposal({...base, write: {...base.write!, state: 'failed'}, verification: {...v, checkedAt: stamp()}}, 'failed', who.id, stamp(), `읽기 대조: 반영되지 않음 — ${v.details.join(' | ')}`));
}

export async function proposalsView(who: Actor, filter: {campaignId?: string | null; storeId?: string | null}) {
 return {proposals: await listProposals(who.owner, filter), enabled: await isEnabled(who.owner, 'naver_ads_write'), canApprove: admin(who), notice: NOTICE, label: PROPOSAL_LABEL};
}
export type ProposalsView = Awaited<ReturnType<typeof proposalsView>>;
