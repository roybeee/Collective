// C4 네이버 검색광고 제안 모델(순수). 저장·권한·네트워크를 모른다. 서버 적용은 lib/ads-proposals-server.ts다.
// 원칙: 자동 입찰 없음. 규칙은 '제안'만 만들고(라벨 '추정·규칙 기반, 자동 적용 없음'), 승인은 관리자, 반영은 승인된 제안 하나당 쓰기 1회, 반영 뒤 읽기 대조로 verified/mismatch를 판정한다.
// 상태: draft → approved → applied | failed | unknown ; applied → verified | mismatch ; unknown → applied | failed (읽기 대조로만) ; draft → rejected.
// 위험 등급(lib/growth-authority.ts 어휘): 입찰 변경 ≤20%·중지 T2, >20%·재개·새 지출(키워드·캠페인 생성) T3.
import type {WriteOperation} from './connectors/naver-ads-write';
import {BID_STEP, MAX_BID, MIN_BID} from './connectors/naver-ads-write';

export class ProposalError extends Error { constructor(message: string) { super(message); this.name = 'ProposalError'; } }

export const PROPOSAL_KINDS = ['bid', 'pause', 'resume', 'create_keywords', 'create_campaign'] as const;
export type ProposalKind = typeof PROPOSAL_KINDS[number];
export const PROPOSAL_STATUSES = ['draft', 'approved', 'rejected', 'applied', 'failed', 'unknown', 'verified', 'mismatch'] as const;
export type ProposalStatus = typeof PROPOSAL_STATUSES[number];
export type ProposalRisk = 'T2' | 'T3';
export const PROPOSAL_LABEL = '추정·규칙 기반, 자동 적용 없음';
export const STATS_WINDOW_DAYS = 14;
export const BID_CHANGE_T2_MAX_RATIO = 0.2;

export type StatsWindow = {from: string; to: string};
// /stats 14일 합계 + 키워드 현재 상태. 측정 못 한 값은 null(0과 구분).
export type KeywordStats = {keywordId: string; keyword: string; adgroupId: string; bidAmt: number | null; userLock: boolean; impCnt: number | null; clkCnt: number | null; salesAmt: number | null; ccnt: number | null; convAmt?: number | null; avgRnk?: number | null};
export type RuleTargets = {targetCpa?: number | null; targetRoas?: number | null};
export type RuleInput = {campaignId: string; storeId?: string | null; brandId?: string | null; window: StatsWindow; keywords: readonly KeywordStats[]; targets: RuleTargets};
export type ProposalEvidence = {ruleId: string; window: StatsWindow; metrics: Record<string, number | null>; learningRuleIds: string[]};
export type WriteJournal = {state: 'sent' | 'done' | 'unknown' | 'failed'; attempts: number; sentAt: string; finishedAt?: string; providerIds?: string[]; httpStatus?: number | null; error?: string | null};
export type ProposalTransition = {at: string; from: ProposalStatus | null; to: ProposalStatus; by: string; note?: string};
export type AdsProposal = {
 id: string; channel: 'naver_ads'; campaignId: string; storeId: string | null; brandId: string | null;
 kind: ProposalKind; riskTier: ProposalRisk; status: ProposalStatus; label: typeof PROPOSAL_LABEL;
 target: {type: 'keyword' | 'campaign' | 'adgroup'; ids: string[]; names: string[]};
 diff: {before: Record<string, unknown>; after: Record<string, unknown>};
 operation: WriteOperation;
 rationale: {text: string; evidence: ProposalEvidence};
 createdAt: string; createdBy: string; approvedAt?: string; approvedBy?: string; appliedAt?: string;
 write?: WriteJournal; verification?: {status: 'verified' | 'mismatch'; checkedAt: string; details: string[]};
 history: ProposalTransition[];
};
export type ProposalContext = {now: string; by: string; id: () => string};

export const RULES = [
 {id: 'cpa_above_target', label: 'CPA가 목표의 120%를 넘으면 입찰가 10% 인하', kind: 'bid' as const},
 {id: 'rank_low_efficient', label: '평균 순위가 3위보다 낮고 효율(ROAS·CPA)이 목표 안이면 입찰가 10% 인상', kind: 'bid' as const},
 {id: 'zero_clicks_14d', label: '14일 노출은 있는데 클릭 0이면 중지 제안', kind: 'pause' as const},
] as const;
export type RuleId = typeof RULES[number]['id'];

// 10원 단위 반올림, 범위 고정.
export const roundBid = (value: number) => Math.min(MAX_BID, Math.max(MIN_BID, Math.round(value / BID_STEP) * BID_STEP));
export function riskTierFor(kind: ProposalKind, before?: number | null, after?: number | null): ProposalRisk {
 if (kind === 'pause') return 'T2';
 if (kind !== 'bid') return 'T3';
 if (typeof before !== 'number' || typeof after !== 'number' || before <= 0) return 'T3';
 return Math.abs(after - before) / before <= BID_CHANGE_T2_MAX_RATIO + 1e-9 ? 'T2' : 'T3';
}

const n = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const cpaOf = (k: KeywordStats) => { const cost = n(k.salesAmt), conv = n(k.ccnt); return cost !== null && conv !== null && conv > 0 ? cost / conv : null; };
const roasOf = (k: KeywordStats) => { const cost = n(k.salesAmt), rev = n(k.convAmt); return cost !== null && rev !== null && cost > 0 ? rev / cost : null; };
const metricsOf = (k: KeywordStats): Record<string, number | null> => ({impCnt: n(k.impCnt), clkCnt: n(k.clkCnt), salesAmt: n(k.salesAmt), ccnt: n(k.ccnt), convAmt: n(k.convAmt), avgRnk: n(k.avgRnk), cpa: cpaOf(k), roas: roasOf(k), bidAmt: n(k.bidAmt)});

type Decision = {ruleId: RuleId; kind: 'bid' | 'pause'; newBid?: number; text: string};
// 키워드 하나에 적용할 규칙(우선순위: 중지 > 인하 > 인상). 여기서는 판단만 하고 제안 객체는 아래가 만든다.
export function decideForKeyword(k: KeywordStats, targets: RuleTargets): Decision | null {
 const imp = n(k.impCnt), clk = n(k.clkCnt), bid = n(k.bidAmt), cpa = cpaOf(k), roas = roasOf(k), rank = n(k.avgRnk), targetCpa = n(targets.targetCpa), targetRoas = n(targets.targetRoas) ?? 3;
 if (!k.userLock && imp !== null && imp > 0 && clk === 0) return {ruleId: 'zero_clicks_14d', kind: 'pause', text: `${STATS_WINDOW_DAYS}일 동안 노출 ${imp.toLocaleString('ko-KR')}회에 클릭 0회입니다. 비용은 없지만 노출만 소비하므로 중지를 제안합니다.`};
 if (bid === null || bid <= 0) return null;
 if (targetCpa !== null && cpa !== null && cpa > targetCpa * 1.2) return {ruleId: 'cpa_above_target', kind: 'bid', newBid: roundBid(bid * 0.9), text: `전환당 비용 ${Math.round(cpa).toLocaleString('ko-KR')}원이 목표 ${targetCpa.toLocaleString('ko-KR')}원의 120%를 넘습니다. 입찰가 10% 인하를 제안합니다.`};
 const efficient = (roas !== null && roas >= targetRoas) || (targetCpa !== null && cpa !== null && cpa <= targetCpa);
 if (rank !== null && rank > 3 && clk !== null && clk >= 10 && efficient) return {ruleId: 'rank_low_efficient', kind: 'bid', newBid: roundBid(bid * 1.1), text: `평균 순위 ${rank.toFixed(1)}위로 노출 점유가 낮은데 효율(${roas !== null ? `ROAS ${roas.toFixed(2)}` : `CPA ${Math.round(cpa ?? 0).toLocaleString('ko-KR')}원`})은 목표 안입니다. 입찰가 10% 인상을 제안합니다.`};
 return null;
}

function baseProposal(input: RuleInput, ctx: ProposalContext, k: KeywordStats, d: Decision): AdsProposal {
 const before = {bidAmt: k.bidAmt, userLock: k.userLock};
 const after = d.kind === 'pause' ? {bidAmt: k.bidAmt, userLock: true} : {bidAmt: d.newBid ?? k.bidAmt, userLock: k.userLock};
 const operation: WriteOperation = d.kind === 'pause' ? {op: 'set_user_lock', target: 'keyword', ids: [k.keywordId], userLock: true} : {op: 'update_bid', keywordIds: [k.keywordId], bidAmt: d.newBid ?? roundBid(k.bidAmt ?? MIN_BID)};
 return {
  id: ctx.id(), channel: 'naver_ads', campaignId: input.campaignId, storeId: input.storeId ?? null, brandId: input.brandId ?? null,
  kind: d.kind, riskTier: riskTierFor(d.kind, k.bidAmt, d.newBid), status: 'draft', label: PROPOSAL_LABEL,
  target: {type: 'keyword', ids: [k.keywordId], names: [k.keyword]}, diff: {before, after}, operation,
  rationale: {text: `${d.text} (${PROPOSAL_LABEL})`, evidence: {ruleId: d.ruleId, window: input.window, metrics: metricsOf(k), learningRuleIds: []}},
  createdAt: ctx.now, createdBy: ctx.by, history: [{at: ctx.now, from: null, to: 'draft', by: ctx.by, note: `규칙 ${d.ruleId}`}],
 };
}
// 14일 통계 → 제안 목록(결정론). 키워드마다 최대 1건. 입력 순서를 유지한다.
export function proposeFromStats(input: RuleInput, ctx: ProposalContext): AdsProposal[] {
 return input.keywords.flatMap(k => { const d = decideForKeyword(k, input.targets); return d ? [baseProposal(input, ctx, k, d)] : []; });
}

// 사람이 직접 적는 제안(새 지출, T3): 키워드 추가·캠페인 생성·재개. 서버가 입력을 검증한 WriteOperation을 넘긴다.
export function manualProposal(input: {campaignId: string; storeId?: string | null; brandId?: string | null; kind: Extract<ProposalKind, 'create_keywords' | 'create_campaign' | 'resume'>; operation: WriteOperation; rationale: string; names?: string[]}, ctx: ProposalContext): AdsProposal {
 const target = input.operation.op === 'create_keywords' ? {type: 'keyword' as const, ids: [input.operation.adgroupId], names: input.operation.keywords.map(k => k.keyword)}
  : input.operation.op === 'set_user_lock' ? {type: input.operation.target, ids: [...input.operation.ids], names: input.names ?? []}
  : {type: 'campaign' as const, ids: [], names: [input.operation.op === 'create_campaign' ? input.operation.name : input.campaignId]};
 if ((input.kind === 'create_keywords') !== (input.operation.op === 'create_keywords') || (input.kind === 'create_campaign') !== (input.operation.op === 'create_campaign') || (input.kind === 'resume') !== (input.operation.op === 'set_user_lock' && input.operation.userLock === false)) throw new ProposalError('제안 종류와 작업이 맞지 않습니다.');
 return {
  id: ctx.id(), channel: 'naver_ads', campaignId: input.campaignId, storeId: input.storeId ?? null, brandId: input.brandId ?? null,
  kind: input.kind, riskTier: 'T3', status: 'draft', label: PROPOSAL_LABEL, target,
  diff: {before: input.kind === 'resume' ? {userLock: true} : {}, after: input.kind === 'resume' ? {userLock: false} : {created: input.operation}}, operation: input.operation,
  rationale: {text: `${input.rationale} (${PROPOSAL_LABEL})`, evidence: {ruleId: 'manual', window: {from: '', to: ''}, metrics: {}, learningRuleIds: []}},
  createdAt: ctx.now, createdBy: ctx.by, history: [{at: ctx.now, from: null, to: 'draft', by: ctx.by, note: '사람이 직접 작성'}],
 };
}

const EDGES: Record<ProposalStatus, readonly ProposalStatus[]> = {
 draft: ['approved', 'rejected'], approved: ['applied', 'failed', 'unknown'], applied: ['verified', 'mismatch'], unknown: ['applied', 'failed', 'mismatch'],
 rejected: [], failed: [], verified: [], mismatch: [],
};
export const STATUS_LABELS: Record<ProposalStatus, string> = {draft: '제안', approved: '승인됨', rejected: '반려', applied: '반영됨(대조 전)', failed: '반영 실패', unknown: '결과 미확인', verified: '반영 확인', mismatch: '대조 불일치'};
// 상태 전이(새 객체). 허용되지 않은 전이는 ProposalError.
export function transitionProposal(p: AdsProposal, to: ProposalStatus, by: string, at: string, note?: string): AdsProposal {
 if (!EDGES[p.status].includes(to)) throw new ProposalError(`${STATUS_LABELS[p.status]} 상태에서는 ${STATUS_LABELS[to]}(으)로 바꿀 수 없습니다.`);
 return {...p, status: to, history: [...p.history, {at, from: p.status, to, by, ...(note ? {note} : {})}],
  ...(to === 'approved' ? {approvedAt: at, approvedBy: by} : {}), ...(to === 'applied' ? {appliedAt: at} : {})};
}
// 같은 대상·같은 규칙의 열린 제안(draft·approved·unknown·applied)이 있으면 중복이다.
export const isOpen = (p: AdsProposal) => p.status === 'draft' || p.status === 'approved' || p.status === 'unknown' || p.status === 'applied';
export function dedupeAgainst(existing: readonly AdsProposal[], fresh: readonly AdsProposal[]): AdsProposal[] {
 const keyOf = (p: AdsProposal) => `${p.campaignId}|${p.rationale.evidence.ruleId}|${p.target.type}|${p.target.ids.join(',')}`;
 const open = new Set(existing.filter(isOpen).map(keyOf));
 return fresh.filter(p => !open.has(keyOf(p)));
}
// 14일 창: 끝은 어제(UTC 날짜), 시작은 그로부터 13일 전. 집계 지연을 피하기 위해 오늘은 넣지 않는다.
export function statsWindow(nowMs: number, days = STATS_WINDOW_DAYS): StatsWindow {
 const day = 86400000, end = new Date(Math.floor(nowMs / day) * day - day), start = new Date(end.getTime() - (days - 1) * day);
 return {from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10)};
}
