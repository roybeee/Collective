import {scanText} from './pii-scan';

/** Pure scope/cap decisions. Callers verify signatures/evidence and reserve atomically before executing. */
export type AuthorityOperation = 'read' | 'draft' | 'publish' | 'spend' | 'scale' | 'reconcile' | 'stop' | 'policy_change';
export type AuthorityTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';
export type AuthorityInput = {
  id: string; brandId: string; campaignId: string; accountId: string; channel: string;
  status: 'draft' | 'active' | 'revoked'; maxTier: Exclude<AuthorityTier, 'T4'>;
  allowedActions: AuthorityOperation[]; ownerApprovalId: string; ownerSignedAt: string;
  startsAt: string; expiresAt: string; periodStart: string; periodEnd: string;
  totalCap: number | null; dayCap: number | null; weekCap: number | null; lossCap: number | null;
};
export type AuthorityAction = {
  id: string; operationKey: string; brandId: string; campaignId: string; accountId: string; channel: string;
  operation: AuthorityOperation; amount: number | null; loss: number | null;
  budget: 'exploration' | 'confirmed'; previousBudget: number | null; nextBudget: number | null;
  evidence: {id: string; incremental: boolean; profitable: boolean; capacity: boolean} | null;
};
export type AuthorityCommitment = {
  authorityId: string; action: AuthorityAction; status: 'reserved' | 'reconciled' | 'unknown' | 'released';
  at: string; reservedAmount: number | null; reservedLoss: number | null;
  actualAmount: number | null; actualLoss: number | null;
  reconciledAt?: string;
};
export type AuthorityUsage = {total: number | null; day: number | null; week: number | null; loss: number | null};
export type AuthorityDecision = {allowed: boolean; reasons: string[]; tier: AuthorityTier; duplicate: boolean; usage: AuthorityUsage};

const OPERATIONS: AuthorityOperation[] = ['read', 'draft', 'publish', 'spend', 'scale', 'reconcile', 'stop', 'policy_change'];
const SCOPE = ['brandId', 'campaignId', 'accountId', 'channel'] as const;
const DAY = 86_400_000;
const KST = 9 * 3_600_000;

export class GrowthAuthorityError extends Error {
  constructor(message: string) { super(message); this.name = 'GrowthAuthorityError'; }
}

export function emptyAuthorityInput(): AuthorityInput {
  return {id: '', brandId: '', campaignId: '', accountId: '', channel: '', status: 'draft', maxTier: 'T0',
    allowedActions: [], ownerApprovalId: '', ownerSignedAt: '', startsAt: '', expiresAt: '',
    periodStart: '', periodEnd: '', totalCap: null, dayCap: null, weekCap: null, lossCap: null};
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GrowthAuthorityError('객체 입력이 필요합니다.');
  return value as Record<string, unknown>;
}

function identifier(value: unknown, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 160 || (value !== '' && !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) || (required && !value)) {
    throw new GrowthAuthorityError('식별자는 개인정보 없는 내부 ID여야 합니다.');
  }
  if (scanText(value).length) throw new GrowthAuthorityError('식별자에 직접 개인정보를 넣을 수 없습니다.');
  return value;
}

function money(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new GrowthAuthorityError('금액은 0 이상의 안전한 KRW 정수여야 합니다.');
  return value;
}

function enumeration<T extends string>(value: unknown, values: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!values.includes(value as T)) throw new GrowthAuthorityError('허용되지 않은 상태 또는 행동입니다.');
  return value as T;
}

function timestamp(value: unknown, required = false): string {
  if ((value === undefined || value === '') && !required) return '';
  if (typeof value !== 'string') throw new GrowthAuthorityError('시간대가 있는 ISO 일시가 필요합니다.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new GrowthAuthorityError('시간대가 있는 ISO 일시가 필요합니다.');
  const [, y, m, d, h, minute, s, zone] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  const zoneValid = zone === 'Z' || (Number(zone.slice(1, 3)) <= 14 && Number(zone.slice(4)) < 60 && (Number(zone.slice(1, 3)) < 14 || Number(zone.slice(4)) === 0));
  if (Number(y) < 1000 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}` || Number(h) > 23 || Number(minute) > 59 || Number(s) > 59 || !zoneValid) {
    throw new GrowthAuthorityError('실제 달력 날짜와 유효한 시각이 필요합니다.');
  }
  return value;
}

export function parseAuthorityInput(value: unknown): AuthorityInput {
  const input = record(value);
  const actions = input.allowedActions ?? [];
  if (!Array.isArray(actions) || actions.length > OPERATIONS.length) throw new GrowthAuthorityError('행동 목록이 유효하지 않습니다.');
  const result: AuthorityInput = {
    id: identifier(input.id), brandId: identifier(input.brandId), campaignId: identifier(input.campaignId),
    accountId: identifier(input.accountId), channel: identifier(input.channel),
    status: enumeration(input.status, ['draft', 'active', 'revoked'], 'draft'),
    maxTier: enumeration(input.maxTier, ['T0', 'T1', 'T2', 'T3'], 'T0'),
    allowedActions: [...new Set(actions.map(a => enumeration(a, OPERATIONS)))], ownerApprovalId: identifier(input.ownerApprovalId),
    ownerSignedAt: timestamp(input.ownerSignedAt), startsAt: timestamp(input.startsAt), expiresAt: timestamp(input.expiresAt),
    periodStart: timestamp(input.periodStart), periodEnd: timestamp(input.periodEnd),
    totalCap: money(input.totalCap), dayCap: money(input.dayCap), weekCap: money(input.weekCap), lossCap: money(input.lossCap),
  };
  if ((result.startsAt && result.expiresAt && Date.parse(result.startsAt) >= Date.parse(result.expiresAt)) ||
      (result.periodStart && result.periodEnd && Date.parse(result.periodStart) >= Date.parse(result.periodEnd))) {
    throw new GrowthAuthorityError('종료 시각은 시작 시각 뒤여야 합니다.');
  }
  return result;
}

function parseAction(value: unknown): AuthorityAction {
  const input = record(value);
  const proof = input.evidence === undefined || input.evidence === null ? null : record(input.evidence);
  if (proof && ['incremental', 'profitable', 'capacity'].some(key => typeof proof[key] !== 'boolean')) throw new GrowthAuthorityError('확대 근거 확인값이 유효하지 않습니다.');
  return {id: identifier(input.id, true), operationKey: identifier(input.operationKey, true),
    brandId: identifier(input.brandId, true), campaignId: identifier(input.campaignId, true),
    accountId: identifier(input.accountId, true), channel: identifier(input.channel, true),
    operation: enumeration(input.operation, OPERATIONS), amount: money(input.amount), loss: money(input.loss),
    budget: enumeration(input.budget, ['exploration', 'confirmed']), previousBudget: money(input.previousBudget), nextBudget: money(input.nextBudget),
    evidence: proof ? {id: identifier(proof.id, true), incremental: proof.incremental as boolean, profitable: proof.profitable as boolean, capacity: proof.capacity as boolean} : null};
}

function parseCommitment(value: unknown): AuthorityCommitment {
  const input = record(value);
  return {authorityId: identifier(input.authorityId, true), action: parseAction(input.action),
    status: enumeration(input.status, ['reserved', 'reconciled', 'unknown', 'released']), at: timestamp(input.at, true),
    reservedAmount: money(input.reservedAmount), reservedLoss: money(input.reservedLoss),
    actualAmount: money(input.actualAmount), actualLoss: money(input.actualLoss),...(input.reconciledAt!==undefined?{reconciledAt:timestamp(input.reconciledAt,true)}:{})};
}

function tier(operation: AuthorityOperation): AuthorityTier {
  if (operation === 'policy_change') return 'T4';
  if (operation === 'spend' || operation === 'scale') return 'T3';
  if (operation === 'publish') return 'T2';
  return operation === 'draft' ? 'T1' : 'T0';
}

function sum(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !Number.isSafeInteger(a + b)) return null;
  return a + b;
}

function held(reserved: number | null, observed: number | null): number | null {
  return reserved === null ? null : Math.max(reserved, observed ?? reserved);
}

function usageFor(authority: AuthorityInput, commitments: AuthorityCommitment[], now: number): AuthorityUsage {
  const local = new Date(now + KST);
  const dayStart = Math.floor((now + KST) / DAY) * DAY - KST;
  const weekStart = dayStart - ((local.getUTCDay() + 6) % 7) * DAY;
  const periodStart = Date.parse(authority.periodStart);
  return commitments.reduce<AuthorityUsage>((usage, entry) => {
    if (entry.status === 'released' || entry.action.accountId !== authority.accountId) return usage;
    const unresolved = entry.status !== 'reconciled';
    const amount = unresolved ? held(entry.reservedAmount, entry.actualAmount) : entry.actualAmount;
    const loss = unresolved ? held(entry.reservedLoss, entry.actualLoss) : entry.actualLoss;
    const at = Math.max(Date.parse(entry.at),entry.reconciledAt?Date.parse(entry.reconciledAt):0);
    // Unresolved reservations never expire out of capacity merely because a day/week/period changed.
    const inPeriod = unresolved || entry.authorityId === authority.id || at >= periodStart;
    return {total: inPeriod ? sum(usage.total, amount) : usage.total,
      day: unresolved || at >= dayStart ? sum(usage.day, amount) : usage.day,
      week: unresolved || at >= weekStart ? sum(usage.week, amount) : usage.week,
      loss: sum(usage.loss, loss)};
  }, {total: 0, day: 0, week: 0, loss: 0});
}

function scopeMatches(authority: AuthorityInput, action: AuthorityAction): boolean {
  return SCOPE.every(key => !!authority[key] && authority[key] === action[key]);
}

function mandateReasons(authority: AuthorityInput | null, action: AuthorityAction, now: number): string[] {
  if (!authority) return ['명시적인 소유자 위임이 필요합니다.'];
  return [!scopeMatches(authority, action) && '브랜드·캠페인·계정·채널 범위가 일치하지 않습니다.',
    authority.status !== 'active' && '활성 위임이 아닙니다.', !authority.id && '위임 ID가 필요합니다.',
    (!authority.ownerApprovalId || !authority.ownerSignedAt || Date.parse(authority.ownerSignedAt) > now) && '유효한 소유자 서명 근거가 필요합니다.',
    !authority.allowedActions.includes(action.operation) && '명시적으로 허용되지 않은 행동입니다.',
    Number(authority.maxTier.slice(1)) < Number(tier(action.operation).slice(1)) && '위임 등급을 초과합니다.',
    (!authority.startsAt || !authority.expiresAt || now < Date.parse(authority.startsAt) || now >= Date.parse(authority.expiresAt)) && '위임 유효기간 밖입니다.',
    (!authority.periodStart || !authority.periodEnd || now < Date.parse(authority.periodStart) || now >= Date.parse(authority.periodEnd)) && '예산 기간 밖입니다.',
  ].filter((r): r is string => typeof r === 'string');
}

function capReasons(authority: AuthorityInput, action: AuthorityAction, usage: AuthorityUsage, duplicate: boolean): string[] {
  const amount = duplicate ? 0 : action.amount;
  const loss = duplicate ? 0 : action.loss;
  const checks: [string, number | null, number | null, number | null][] = [
    ['총', authority.totalCap, usage.total, amount], ['일', authority.dayCap, usage.day, amount],
    ['주', authority.weekCap, usage.week, amount], ['손실', authority.lossCap, usage.loss, loss],
  ];
  return checks.flatMap(([name, cap, used, added]) => {
    const projected = sum(used, added);
    if (cap === null || projected === null) return [`${name} 한도 또는 미확인 비용을 확인하세요.`];
    return projected > cap ? [`${name} 한도를 초과합니다.`] : [];
  });
}

function evidenceReasons(action: AuthorityAction, authority: AuthorityInput): string[] {
  const proof = action.evidence;
  const verified = proof && proof.incremental && proof.profitable && proof.capacity;
  const reasons = action.budget === 'confirmed' && !verified ? ['확정 예산에는 증분·수익·운영 수용능력 근거가 필요합니다.'] : [];
  if (action.operation !== 'scale') return reasons;
  if (action.budget !== 'confirmed' || !verified) reasons.push('탐색 결과만으로 확대할 수 없습니다.');
  const before = action.previousBudget, after = action.nextBudget;
  if (before === null || after === null || before <= 0 || after <= before || after - before > Math.floor(before / 5)) {
    reasons.push('확대는 기존 예산 대비 1회 20% 이내여야 합니다.');
  }
  if (before !== null && after !== null && (action.amount === null || action.amount < after - before)) reasons.push('증액 전체의 비용 예약이 필요합니다.');
  if (after !== null && [authority.totalCap, authority.dayCap, authority.weekCap].some(cap => cap === null || after > cap)) reasons.push('확대가 서명된 예산 한도를 넓힐 수 없습니다.');
  return reasons;
}

function ledgerReasons(commitments: AuthorityCommitment[], action: AuthorityAction, authority: AuthorityInput, now: number): string[] {
  const keys = commitments.map(entry => entry.action.operationKey);
  const reasons = new Set(keys).size !== keys.length ? ['중복된 비용 예약 키를 대사하세요.'] : [];
  for (const entry of commitments) {
    if (Date.parse(entry.at) > now) reasons.push('미래 시각의 비용 기록을 확인하세요.');
    if (entry.reconciledAt&&Date.parse(entry.reconciledAt)>now) reasons.push('미래 시각의 대사 기록을 확인하세요.');
    if (entry.status==='released'&&(entry.actualAmount!==0||entry.actualLoss!==0)) reasons.push('해제된 예약의 실비·손실은 확인된 0이어야 합니다.');
    if (['reserved', 'unknown'].includes(entry.status) &&
      (entry.action.amount === null || entry.action.loss === null || entry.reservedAmount === null || entry.reservedLoss === null ||
        entry.reservedAmount < entry.action.amount || entry.reservedLoss < entry.action.loss)) reasons.push('미대사 실행의 전체 비용과 손실을 예약해야 합니다.');
    if (entry.action.operationKey === action.operationKey &&
      (entry.authorityId !== authority.id || JSON.stringify(entry.action) !== JSON.stringify(action))) reasons.push('같은 실행 키의 범위 또는 금액이 변경되었습니다.');
  }
  return reasons;
}

/** allowed+duplicate means reuse the existing operation, never dispatch or reserve again. */
export function evaluateAuthority(authority: AuthorityInput | null, action: AuthorityAction, commitments: AuthorityCommitment[], now = Date.now()): AuthorityDecision {
  const unknown: AuthorityUsage = {total: null, day: null, week: null, loss: null};
  const blocked = (reason: string): AuthorityDecision => ({allowed: false, reasons: [reason], tier: 'T4', duplicate: false, usage: unknown});
  try {
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) return blocked('평가 시각이 유효하지 않습니다.');
    const request = parseAction(action);
    const level = tier(request.operation);
    const mandate = authority === null ? null : parseAuthorityInput(authority);
    const safe = ['read', 'draft', 'reconcile', 'stop'].includes(request.operation);
    if (safe) {
      const reasons = [((request.amount ?? 0) !== 0 || (request.loss ?? 0) !== 0) && '안전 행동은 비용이나 손실을 발생시킬 수 없습니다.',
        ['reconcile', 'stop'].includes(request.operation) && (!mandate || !scopeMatches(mandate, request)) && '복구 행동도 기존 계정 범위 안이어야 합니다.',
      ].filter((r): r is string => typeof r === 'string');
      return {allowed: !reasons.length, reasons, tier: level, duplicate: false, usage: unknown};
    }
    if (level === 'T4') return blocked('T4 정책 변경은 항상 별도 사람 승인이 필요합니다.');
    const reasons = mandateReasons(mandate, request, now);
    if (!mandate) return {...blocked(reasons[0]), tier: level};
    if (!Array.isArray(commitments) || commitments.length > 100_000) return blocked('완전한 비용 예약 원장이 필요합니다.');
    const ledger = commitments.map(parseCommitment);
    const existing = ledger.find(entry => entry.action.operationKey === request.operationKey);
    const duplicate = !!existing;
    const usage = usageFor(mandate, ledger, now);
    reasons.push(...ledgerReasons(ledger, request, mandate, now), ...capReasons(mandate, request, usage, duplicate), ...evidenceReasons(request, mandate));
    if (existing && ['unknown', 'released'].includes(existing.status)) reasons.push('이 실행 키는 결과 대사 또는 새 승인 키가 필요합니다.');
    if (request.operation === 'publish' && (request.amount !== 0 || request.loss !== 0)) reasons.push('게시 위임에는 지출 권한이 포함되지 않습니다.');
    return {allowed: !reasons.length, reasons: [...new Set(reasons)], tier: level, duplicate, usage};
  } catch (error) {
    return blocked(error instanceof GrowthAuthorityError ? error.message : '권한 입력 또는 비용 원장을 확인하세요.');
  }
}
