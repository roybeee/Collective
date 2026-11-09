// C8 당근 광고 제안 서버. 같은 kind 'ads_proposal'(channel 'daangn_ads', parent_id=지점 또는 '')을 쓰고, 승인·반려·조회 진입점은 lib/ads-proposals-server.ts가 채널로 나눈다.
// 생성·반영은 스위치 daangn_ads가 켜져 있어야 한다(읽기 능력도 스위치에 묶여 있다). 미확인 대조(읽기)는 스위치와 무관하다.
// 반영은 제안 하나당 쓰기 1회: 보내기 전 '보냄'을 저장하고, 결과를 모르면 unknown으로 남겨 다시 보내지 않는다. 반영 뒤 GET으로 다시 읽어 verified/mismatch를 판정한다.
import {ApiError, listRecords, recordStatement, stamp, str, uid, type Actor} from './server';
import {buildDaangnRequest, daangnReader, executeDaangnWrite, listAdgroups, listCampaigns, liveDeps, performanceByDay, readBackDaangn, totalOf, verifyDaangnReadBack, DaangnAdsError, type DaangnDeps, type DaangnOperation, type DaangnUnit} from './connectors/daangn-ads';
import {dedupeAgainst, statsWindow, transitionProposal, ProposalError, type AnyAdsProposal, type DaangnAdsProposal} from './ads-proposals';
import {DAANGN_MANUAL_KINDS, daangnManualProposal, proposeDaangnFromStats, type DaangnManualKind, type DaangnUnitStats} from './ads-proposals-daangn';
import {loadDaangnCredential, requireDaangn, type DaangnScope} from './daangn-ads-server';

const MAX_ADGROUPS = 50;
const wrap = <T>(fn: () => T) => { try { return fn(); } catch (e) { if (e instanceof ProposalError || e instanceof DaangnAdsError) throw new ApiError(400, e.message); throw e; } };
async function save(owner: string, p: DaangnAdsProposal) { await recordStatement(owner, 'ads_proposal', p.id, p, p.storeId ?? '').run(); return p; }
const target = (v: unknown, label: string) => { if (v === undefined || v === null || v === '') return null; if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new ApiError(400, `${label}은(는) 0보다 큰 숫자여야 합니다.`); return v; };

// 14일 성과를 모은다: 캠페인(목록에서 찾음) + 광고그룹(최대 50) → 일별 성과 합계. 읽기만 한다.
export async function collectUnitStats(credential: Parameters<typeof listCampaigns>[1], campaignId: string, window: {from: string; to: string}, deps?: DaangnDeps): Promise<DaangnUnitStats[]> {
 const reader = daangnReader(credential, deps);
 const campaign = (await listCampaigns(reader, credential)).find(c => c.id === campaignId);
 if (!campaign) throw new ApiError(404, '당근 광고 캠페인을 찾지 못했습니다.');
 const adgroups = (await listAdgroups(reader, credential, campaignId)).slice(0, MAX_ADGROUPS);
 const statsFor = async (level: 'campaign' | 'adgroup', units: DaangnUnit[]) => {
  if (!units.length) return [];
  const rows = await performanceByDay(reader, credential, {level, ids: units.map(u => u.id), window});
  return units.map(u => ({...u, ...totalOf(rows.filter(r => r.id === u.id))}));
 };
 return [...await statsFor('campaign', [campaign]), ...await statsFor('adgroup', adgroups)];
}

export async function generateDaangnProposals(who: Actor, input: Record<string, unknown>, scope: DaangnScope, existing: readonly AnyAdsProposal[], now = Date.now(), deps?: DaangnDeps) {
 await requireDaangn(who.owner);
 const campaignId = str(input.campaignId, '당근 광고 캠페인 ID', 64, true);
 const targets = {targetCpa: target(input.targetCpa, '목표 CPA'), targetRoas: target(input.targetRoas, '목표 ROAS')};
 const window = statsWindow(now), {credential} = await loadDaangnCredential(who.owner, scope);
 const units = await collectUnitStats(credential, campaignId, window, deps);
 const fresh = proposeDaangnFromStats({campaignId, storeId: scope.storeId, brandId: scope.brandId, window, units, targets}, {now: stamp(), by: who.id, id: uid});
 const created = dedupeAgainst(existing, fresh);
 for (const p of created) await save(who.owner, p);
 return {created, skipped: fresh.length - created.length, units: units.length, window};
}

// 사람이 직접 적는 제안(T3). 작업 본문은 반영 때와 같은 빌더(buildDaangnRequest)로 미리 검증한다. 생성 작업은 모두 PAUSED로 만든다.
export async function createDaangnManualProposal(who: Actor, input: Record<string, unknown>, scope: DaangnScope) {
 const kind = input.kind;
 if (typeof kind !== 'string' || !(DAANGN_MANUAL_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, `당근 광고에 직접 작성할 수 있는 제안은 ${DAANGN_MANUAL_KINDS.join('·')}입니다.`);
 const campaignId = str(input.campaignId, '당근 광고 캠페인 ID', 64, true), rationale = str(input.rationale, '사유', 1000, true);
 if (!input.operation || typeof input.operation !== 'object') throw new ApiError(400, '작업(operation)을 입력하세요.');
 const operation = input.operation as DaangnOperation;
 wrap(() => buildDaangnRequest(operation, 'validate'));
 const proposal = wrap(() => daangnManualProposal({campaignId, storeId: scope.storeId, brandId: scope.brandId, kind: kind as DaangnManualKind, operation, rationale}, {now: stamp(), by: who.id, id: uid}));
 return save(who.owner, proposal);
}

// 승인된 제안을 반영한다. 호출자(lib/ads-proposals-server.ts)가 관리자·스위치·자율성(budget_change)을 먼저 확인한다. 저널이 있으면 다시 보내지 않는다.
export async function applyDaangnProposal(who: Actor, p: DaangnAdsProposal, deps?: DaangnDeps) {
 if (p.write) throw new ApiError(409, '이미 보낸 제안입니다. 결과를 모르면 대조(reconcile)로 확인하세요. 다시 보내지 않습니다.');
 if (p.status !== 'approved') throw new ApiError(409, '승인된 제안만 반영할 수 있습니다.');
 const {credential} = await loadDaangnCredential(who.owner, {brandId: p.brandId, storeId: p.storeId}), sentAt = stamp();
 const result = await executeDaangnWrite(credential, p.operation, {...(deps ?? liveDeps()), onBeforeSend: async attempts => { await save(who.owner, {...p, write: {state: 'sent', attempts, sentAt}}); }});
 const state = result.outcome === 'success' ? 'done' as const : result.outcome === 'unknown' ? 'unknown' as const : 'failed' as const;
 const write = {state, attempts: result.attempts, sentAt, finishedAt: stamp(), providerIds: result.providerIds, httpStatus: result.httpStatus, error: result.error};
 const next = transitionProposal({...p, write}, state === 'done' ? 'applied' : state, who.id, stamp(), result.error ?? undefined);
 if (next.status !== 'applied') return save(who.owner, next);
 return save(who.owner, await verify(credential, next, who.id, deps));
}
async function verify(credential: Awaited<ReturnType<typeof loadDaangnCredential>>['credential'], p: DaangnAdsProposal, by: string, deps?: DaangnDeps): Promise<DaangnAdsProposal> {
 let observed;
 try { observed = await readBackDaangn(credential, p.operation, p.write?.providerIds ?? [], deps); }
 catch (e) { return {...p, verification: {status: 'mismatch', checkedAt: stamp(), details: [`읽기 대조에 실패했습니다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`]}}; }
 const v = verifyDaangnReadBack(p.operation, p.write?.providerIds ?? [], observed);
 return transitionProposal({...p, verification: {status: v.status, details: v.details, checkedAt: stamp()}}, v.status, by, stamp(), v.details.join(' | ') || undefined);
}

// 결과 미확인(unknown 또는 sent로 멈춘) 제안을 읽기만으로 판정한다. 기대 상태면 applied→verified, 아니면 failed. 스위치 무관.
export async function reconcileDaangnProposal(who: Actor, p: DaangnAdsProposal, deps?: DaangnDeps) {
 const stuck = p.status === 'approved' && p.write?.state === 'sent';
 if (p.status !== 'unknown' && !stuck) throw new ApiError(409, '결과 미확인 상태의 제안만 대조할 수 있습니다.');
 const {credential} = await loadDaangnCredential(who.owner, {brandId: p.brandId, storeId: p.storeId});
 const base = stuck ? transitionProposal({...p, write: {...p.write!, state: 'unknown', error: '전송 뒤 프로세스가 끝나 결과를 모릅니다.'}}, 'unknown', who.id, stamp()) : p;
 let observed;
 try { observed = await readBackDaangn(credential, base.operation, base.write?.providerIds ?? [], deps); }
 catch (e) { return save(who.owner, {...base, verification: {status: 'mismatch', checkedAt: stamp(), details: [`읽기 대조에 실패했습니다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`]}}); }
 const v = verifyDaangnReadBack(base.operation, base.write?.providerIds ?? [], observed), checked = {status: v.status, details: v.details, checkedAt: stamp()};
 if (v.status === 'verified') return save(who.owner, transitionProposal(transitionProposal({...base, write: {...base.write!, state: 'done', providerIds: v.providerIds}, verification: checked}, 'applied', who.id, stamp(), '읽기 대조로 반영 확인'), 'verified', who.id, stamp()));
 return save(who.owner, transitionProposal({...base, write: {...base.write!, state: 'failed'}, verification: checked}, 'failed', who.id, stamp(), `읽기 대조: 반영되지 않음 — ${v.details.join(' | ')}`));
}

export async function listDaangnProposals(owner: string) {
 return (await listRecords<AnyAdsProposal>(owner, 'ads_proposal')).filter((p): p is DaangnAdsProposal => p.channel === 'daangn_ads');
}
