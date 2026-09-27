// loop-1·security-ops-5: 성과 자동 수집 상태를 화면과 API에 보여 주는 순수 모듈(서버 import 없음, 화면에서도 쓴다).
// 저장 레코드(measurement_draft·measurement_source)를 그대로 내보내지 않고 이 모듈의 보기 형태로만 내보낸다.
// 실패 사유는 정해진 분류 코드와 짧은 한국어 사유만 싣는다. 커넥터 오류 문구·응답 원문·토큰·URL은 싣지 않는다.
import type {Arm} from './learning';
import type {CollectionWindow, ConnectorKey} from './connectors/types';
import type {ResolvedScope} from './channel-credentials';
import type {MeasurementArmDraft, MeasurementSource} from './measurement-collection';

// 워커가 같은 대상을 과도하게 다시 부르지 않도록 하는 최소 간격.
export const COLLECT_INTERVAL_MS = 6 * 3600000;
// 연속 실패 백오프 상한(스위치 collect_guard가 켜졌을 때만).
export const MAX_RETRY_MS = 24 * 3600000;

export const COLLECT_ERROR_CODES = ['reauth_required', 'not_connected', 'upstream_unavailable', 'request_rejected', 'unknown'] as const;
export type CollectErrorCode = typeof COLLECT_ERROR_CODES[number];
export const collectErrorReasons: Record<CollectErrorCode, string> = {
 reauth_required: '인증 실패 · 토큰이 무효하거나 만료됐습니다. 연결 및 설정에서 다시 연결하세요.',
 not_connected: '연결 없음 · 이 브랜드에 쓸 채널 연결이 없습니다. 연결 및 설정에서 연결하세요.',
 upstream_unavailable: '채널 응답 없음 · 채널 API가 응답하지 않았습니다. 다음 시도에 다시 가져옵니다.',
 request_rejected: '요청 거절 · 광고 대상 ID와 기간을 확인하세요.',
 unknown: '성과를 가져오지 못했습니다.',
};
// 같은 자격증명으로 다시 시도해도 성공하지 않는 실패. 다시 연결한 뒤 '성과 가져오기'로 수집을 다시 시작한다.
export const REAUTH_CODES: readonly CollectErrorCode[] = ['reauth_required', 'not_connected'];
export const isCollectErrorCode = (value: unknown): value is CollectErrorCode => typeof value === 'string' && (COLLECT_ERROR_CODES as readonly string[]).includes(value);

// 자동 수집을 멈춘 이유. 저장 문구도 이 목록에서만 쓴다.
export const STOP_REASONS = {
 ended: '실험이 종료되어 수집을 멈췄습니다.',
 missing: '실험 기록이 없어 수집을 멈췄습니다.',
 reauth: '재연결 필요 · 인증 오류로 자동 수집을 멈췄습니다. 다시 연결한 뒤 성과 가져오기로 다시 시작하세요.',
} as const;
const stopReasonText = (value: unknown) => (Object.values(STOP_REASONS) as string[]).includes(value as string) ? value as string : '자동 수집을 멈췄습니다.';

// 연속 실패 백오프: 실패 0~1회는 기본 6시간, 2회 12시간, 3회 이상 24시간(상한).
export function retryDelayMs(failures: number) {
 const steps = Math.max(0, Math.min((Number.isFinite(failures) ? failures : 0) - 1, 2));
 return Math.min(COLLECT_INTERVAL_MS * 2 ** steps, MAX_RETRY_MS);
}

type ArmKey = 'control' | 'treatment';

export type SourceView = {
 id: string;
 arm: ArmKey;
 channel: ConnectorKey;
 target: string;
 window: CollectionWindow | null;
 rolling: boolean;
 lastFetchedAt: string | null;
 failures: number;
 lastError: {code: CollectErrorCode; reason: string} | null;
 reauthRequired: boolean;
 stopped: boolean;
 stoppedReason: string | null;
 nextAttemptAt: string | null;
};
export type ArmDraftView = {value: Arm | null; window: CollectionWindow | null; definition: string; limitations: string[]; fetchedAt: string | null; target: string | null; credential: ResolvedScope | null};
export type MeasurementView = {
 experimentId: string;
 channel: ConnectorKey | null;
 // 수집 초안. comparable은 항상 false다(비교 가능성은 사람이 결과 입력에서 확정한다).
 draft: {arms: Partial<Record<ArmKey, ArmDraftView>>; limitations: string[]; fetchedAt: string | null; updatedAt: string | null; comparable: false} | null;
 sources: SourceView[];
};

const text = (value: unknown) => typeof value === 'string' ? value : '';
const list = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
const windowOf = (value: unknown): CollectionWindow | null => {
 const w = value as CollectionWindow | undefined;
 return w && typeof w.from === 'string' && typeof w.to === 'string' ? {from: w.from, to: w.to} : null;
};

// 이전 레코드의 lastError 원문(커넥터 문구)은 내보내지 않는다. 코드가 없으면 '알 수 없음'으로만 보인다.
export function sourceView(s: MeasurementSource, backoff: boolean): SourceView {
 const failing = !!s.lastError || isCollectErrorCode(s.errorCode);
 const code: CollectErrorCode | null = failing ? isCollectErrorCode(s.errorCode) ? s.errorCode : 'unknown' : null;
 const failures = Number.isInteger(s.failures) && s.failures! > 0 ? s.failures! : failing ? 1 : 0;
 const stopped = s.stopped === true;
 const last = Date.parse(text(s.lastFetchedAt));
 const delay = backoff ? retryDelayMs(failures) : COLLECT_INTERVAL_MS;
 return {
  id: text(s.id),
  arm: s.arm,
  channel: s.channel,
  target: text(s.target),
  window: windowOf(s.window),
  rolling: s.rolling === true,
  lastFetchedAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
  failures,
  lastError: code ? {code, reason: collectErrorReasons[code]} : null,
  reauthRequired: !!code && REAUTH_CODES.includes(code) && (!stopped || s.stoppedFor === 'reauth'),
  stopped,
  stoppedReason: stopped ? stopReasonText(s.stoppedReason) : null,
  nextAttemptAt: stopped || !Number.isFinite(last) ? null : new Date(last + delay).toISOString(),
 };
}

export function armDraftView(entry: MeasurementArmDraft | undefined): ArmDraftView | undefined {
 if (!entry) return undefined;
 return {value: entry.value ?? null, window: windowOf(entry.window), definition: text(entry.definition), limitations: list(entry.limitations), fetchedAt: text(entry.fetchedAt) || null, target: text(entry.target) || null, credential: entry.credential ?? null};
}

// 실험 카드와 워크스페이스 알림: 다시 연결해야 하는 수집 대상(진행 중 실험만).
export type CollectAlert = {experimentId: string; brandId: string; title: string; channel: ConnectorKey; arm: ArmKey; code: CollectErrorCode; reason: string};
export function collectAlerts(views: readonly MeasurementView[], experiments: readonly {id: string; brandId: string; title: string; status: string}[]): CollectAlert[] {
 return views.flatMap(v => {
  const e = experiments.find(x => x.id === v.experimentId);
  if (!e || e.status !== 'running') return [];
  return v.sources.filter(s => s.reauthRequired && s.lastError).map(s => ({experimentId: e.id, brandId: e.brandId, title: e.title, channel: s.channel, arm: s.arm, code: s.lastError!.code, reason: s.lastError!.reason}));
 });
}

// 결과 입력 모달의 초안 채우기. 수치·출처·한계만 옮기고 비교 가능(comparable)은 항상 false로 둔다. 확정은 사람이 체크한다.
const clip = (value: string, max: number) => value.length > max ? value.slice(0, max - 1) + '…' : value;
export function resultPrefill(view: MeasurementView | undefined) {
 if (!view?.draft) return null;
 const arm = (key: ArmKey) => {
  const a = view.draft!.arms[key];
  if (!a?.value) return null;
  return {denominator: a.value.denominator, numerator: a.value.numerator, source: clip(`${a.value.source} · 자동 수집 ${a.window ? `${a.window.from}~${a.window.to}` : '기간 미확인'} · 수집 시각 ${a.fetchedAt ?? '미확인'}`, 3000)};
 };
 const control = arm('control'), treatment = arm('treatment');
 if (!control && !treatment) return null;
 return {control, treatment, comparable: false as const, notes: clip(['자동 수집 초안에서 채웠습니다. 두 안의 타깃·기간·배포 조건이 같은지 직접 확인한 뒤 비교 가능을 체크하세요.', ...view.draft.limitations].join('\n'), 6000)};
}
