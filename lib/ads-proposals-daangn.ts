// C8 당근 광고 제안 규칙(순수). 저장·권한·네트워크를 모른다. 서버 적용은 lib/ads-proposals-daangn-server.ts, 공통 상태 전이·중복 제거는 lib/ads-proposals.ts다.
// 원칙(C4와 같다): 자동 적용 없음. 규칙은 '제안'만 만들고(라벨 '추정·규칙 기반, 자동 적용 없음'), 승인은 관리자, 반영은 승인된 제안 하나당 쓰기 1회, 반영 뒤 읽기 대조.
// 규칙(14일 창, 우선순위 중지 > 인하 > 인상, 단위마다 최대 1건):
//  - daangn_zero_clicks_14d: 노출이 있는데 클릭 0 → 중지(PAUSED) 제안, T2.
//  - daangn_cpa_above_target: 전환당 비용이 목표 CPA를 넘으면 일 예산 10% 인하, T3(예산 변경).
//  - daangn_roas_good: ROAS가 목표(기본 3) 이상이고 클릭 10회 이상이면 일 예산 10% 인상, T3(예산 변경).
import {BUDGET_STEP, MAX_BUDGET, MIN_BUDGET, type DaangnOperation, type DaangnUnit, type PerformanceTotal} from './connectors/daangn-ads';
import {PROPOSAL_LABEL, ProposalError, type DaangnAdsProposal, type ProposalContext, type ProposalEvidence, type RuleTargets, type StatsWindow} from './ads-proposals';

export const DAANGN_RULES = [
 {id: 'daangn_zero_clicks_14d', label: '14일 노출은 있는데 클릭 0이면 중지 제안', kind: 'pause' as const},
 {id: 'daangn_cpa_above_target', label: '전환당 비용이 목표 CPA를 넘으면 일 예산 10% 인하', kind: 'budget' as const},
 {id: 'daangn_roas_good', label: 'ROAS가 목표 이상(클릭 10회 이상)이면 일 예산 10% 인상', kind: 'budget' as const},
] as const;
export type DaangnRuleId = typeof DAANGN_RULES[number]['id'];
export const DEFAULT_TARGET_ROAS = 3, MIN_CLICKS_FOR_RAISE = 10, BUDGET_STEP_RATIO = 0.1;

export type DaangnUnitStats = DaangnUnit & PerformanceTotal;
export type DaangnRuleInput = {campaignId: string; storeId?: string | null; brandId?: string | null; window: StatsWindow; units: readonly DaangnUnitStats[]; targets: RuleTargets};

// 100원 단위 반올림, 범위 고정.
export const roundBudget = (value: number) => Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, Math.round(value / BUDGET_STEP) * BUDGET_STEP));
const n = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const cpaOf = (u: PerformanceTotal) => { const cost = n(u.spend), conv = n(u.conversions); return cost !== null && conv !== null && conv > 0 ? cost / conv : null; };
const roasOf = (u: PerformanceTotal) => { const cost = n(u.spend), rev = n(u.conversionValue); return cost !== null && rev !== null && cost > 0 ? rev / cost : null; };
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
const metricsOf = (u: DaangnUnitStats): Record<string, number | null> => ({impressions: n(u.impressions), clicks: n(u.clicks), spend: n(u.spend), conversions: n(u.conversions), conversionValue: n(u.conversionValue), cpa: cpaOf(u), roas: roasOf(u), dailyBudget: n(u.dailyBudget), days: u.days});

type Decision = {ruleId: DaangnRuleId; kind: 'pause' | 'budget'; newBudget?: number; text: string};
// 단위(캠페인·광고그룹) 하나에 적용할 규칙. 판단만 하고 제안 객체는 아래가 만든다.
export function decideForUnit(u: DaangnUnitStats, targets: RuleTargets): Decision | null {
 const imp = n(u.impressions), clk = n(u.clicks), budget = n(u.dailyBudget), cpa = cpaOf(u), roas = roasOf(u), targetCpa = n(targets.targetCpa), targetRoas = n(targets.targetRoas) ?? DEFAULT_TARGET_ROAS;
 if (u.status !== 'PAUSED' && imp !== null && imp > 0 && clk === 0) return {ruleId: 'daangn_zero_clicks_14d', kind: 'pause', text: `14일 동안 노출 ${imp.toLocaleString('ko-KR')}회에 클릭 0회입니다. 노출만 소비하므로 중지를 제안합니다.`};
 if (u.status === 'PAUSED' || budget === null || budget <= 0) return null;
 if (targetCpa !== null && cpa !== null && cpa > targetCpa) {
  const next = roundBudget(budget * (1 - BUDGET_STEP_RATIO));
  return next < budget ? {ruleId: 'daangn_cpa_above_target', kind: 'budget', newBudget: next, text: `전환당 비용 ${won(cpa)}이 목표 ${won(targetCpa)}를 넘습니다. 일 예산 10% 인하(${won(budget)} → ${won(next)})를 제안합니다.`} : null;
 }
 if (roas !== null && roas >= targetRoas && clk !== null && clk >= MIN_CLICKS_FOR_RAISE) {
  const next = roundBudget(budget * (1 + BUDGET_STEP_RATIO));
  return next > budget ? {ruleId: 'daangn_roas_good', kind: 'budget', newBudget: next, text: `ROAS ${roas.toFixed(2)}가 목표 ${targetRoas.toFixed(2)} 이상입니다(클릭 ${clk.toLocaleString('ko-KR')}회). 일 예산 10% 인상(${won(budget)} → ${won(next)})을 제안합니다.`} : null;
 }
 return null;
}

function proposalFor(input: DaangnRuleInput, ctx: ProposalContext, u: DaangnUnitStats, d: Decision): DaangnAdsProposal {
 const operation: DaangnOperation = d.kind === 'pause' ? {op: 'set_status', target: u.target, id: u.id, status: 'PAUSED'} : {op: 'set_daily_budget', target: u.target, id: u.id, dailyBudget: d.newBudget as number};
 const before = {status: u.status, dailyBudget: u.dailyBudget}, after = d.kind === 'pause' ? {status: 'PAUSED', dailyBudget: u.dailyBudget} : {status: u.status, dailyBudget: d.newBudget};
 const evidence: ProposalEvidence = {ruleId: d.ruleId, window: input.window, metrics: metricsOf(u), learningRuleIds: []};
 return {
  id: ctx.id(), channel: 'daangn_ads', campaignId: input.campaignId, storeId: input.storeId ?? null, brandId: input.brandId ?? null,
  kind: d.kind, riskTier: d.kind === 'pause' ? 'T2' : 'T3', status: 'draft', label: PROPOSAL_LABEL,
  target: {type: u.target, ids: [u.id], names: [u.name]}, diff: {before, after}, operation,
  rationale: {text: `${d.text} (${PROPOSAL_LABEL})`, evidence},
  createdAt: ctx.now, createdBy: ctx.by, history: [{at: ctx.now, from: null, to: 'draft', by: ctx.by, note: `규칙 ${d.ruleId}`}],
 };
}
// 14일 성과 → 제안(결정론, 입력 순서 유지). 캠페인을 중지 제안하면 그 아래 광고그룹 제안은 만들지 않는다(같은 효과 중복).
export function proposeDaangnFromStats(input: DaangnRuleInput, ctx: ProposalContext): DaangnAdsProposal[] {
 const decided = input.units.map(u => ({u, d: decideForUnit(u, input.targets)}));
 const pausedCampaigns = new Set(decided.filter(x => x.u.target === 'campaign' && (x.d?.kind === 'pause' || x.u.status === 'PAUSED')).map(x => x.u.id));
 return decided.flatMap(({u, d}) => !d || (u.target === 'adgroup' && pausedCampaigns.has(u.campaignId)) ? [] : [proposalFor(input, ctx, u, d)]);
}

export const DAANGN_MANUAL_KINDS = ['resume', 'create_campaign', 'create_adgroup', 'create_creative', 'update_creative'] as const;
export type DaangnManualKind = typeof DAANGN_MANUAL_KINDS[number];
const KIND_OPS: Record<DaangnManualKind, DaangnOperation['op']> = {resume: 'set_status', create_campaign: 'create_campaign', create_adgroup: 'create_adgroup', create_creative: 'create_creative', update_creative: 'update_creative'};
// 사람이 직접 적는 제안(T3): 재개·캠페인/광고그룹/소재 생성(모두 PAUSED로 생성)·소재 수정. 작업 본문 검증은 서버가 buildDaangnRequest로 먼저 한다.
export function daangnManualProposal(input: {campaignId: string; storeId?: string | null; brandId?: string | null; kind: DaangnManualKind; operation: DaangnOperation; rationale: string}, ctx: ProposalContext): DaangnAdsProposal {
 const op = input.operation;
 if (KIND_OPS[input.kind] !== op.op || (input.kind === 'resume' && !(op.op === 'set_status' && op.status === 'ACTIVE'))) throw new ProposalError('제안 종류와 작업이 맞지 않습니다.');
 const target = op.op === 'set_status' ? {type: op.target, ids: [op.id], names: []}
  : op.op === 'update_creative' ? {type: 'creative' as const, ids: [op.creativeId], names: []}
  : {type: op.op === 'create_creative' ? 'creative' as const : op.op === 'create_adgroup' ? 'adgroup' as const : 'campaign' as const, ids: [], names: [op.op === 'create_creative' ? op.title : (op as {name: string}).name]};
 return {
  id: ctx.id(), channel: 'daangn_ads', campaignId: input.campaignId, storeId: input.storeId ?? null, brandId: input.brandId ?? null,
  kind: input.kind, riskTier: 'T3', status: 'draft', label: PROPOSAL_LABEL, target,
  diff: {before: input.kind === 'resume' ? {status: 'PAUSED'} : {}, after: input.kind === 'resume' ? {status: 'ACTIVE'} : {operation: op}}, operation: op,
  rationale: {text: `${input.rationale} (${PROPOSAL_LABEL})`, evidence: {ruleId: 'manual', window: {from: '', to: ''}, metrics: {}, learningRuleIds: []}},
  createdAt: ctx.now, createdBy: ctx.by, history: [{at: ctx.now, from: null, to: 'draft', by: ctx.by, note: '사람이 직접 작성'}],
 };
}
