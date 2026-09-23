import {ApiError, str, stamp, readRecord, listRecords, recordStatement, database} from './server';
import {connectorFor} from './connectors';
import {loadCredential} from './channel-credentials';
import {channelNameForConnector} from './channels';
import type {ConnectorKey, CollectionWindow, Collected} from './connectors/types';
import type {Arm, ViralExperiment} from './learning';
import type {StoreMetricKey} from './store-marketing';
import type {Campaign} from './agency';

// 워커가 같은 대상을 과도하게 다시 부르지 않도록 하는 최소 간격.
export const COLLECT_INTERVAL_MS = 6 * 3600000;

// arm 하나의 수집 기록. 두 arm이 서로 다른 기간·정의에서 왔는지 비교 전에 확인할 수 있도록 arm별로 보관한다.
export type MeasurementArmDraft = {value?: Arm; window: CollectionWindow; definition: string; limitations: string[]; fetchedAt: string};

// 자동 수집 결과는 초안으로만 남는다. comparable은 API가 주장할 수 없는 사람의 판단이므로
// 항상 false로 고정하고, 사용자가 save_results에서 직접 확정해야 evaluateExperiment가 판정한다.
export type MeasurementDraft = {
 id: string;
 experimentId: string;
 channel: ConnectorKey;
 control?: Arm;
 treatment?: Arm;
 // 커넥터가 돌려준 점포 지표(광고비·주문수 등). 응답으로만 나가고 사라지면 장부와 대조할 수 없다.
 storeValues?: Partial<Record<StoreMetricKey, number | null>>;
 // arm별 값·기간·정의·한계·수집 시각. 이 필드가 없는 이전 초안은 최상위 필드를 값이 있는 arm의 것으로 읽는다.
 arms?: Partial<Record<'control' | 'treatment', MeasurementArmDraft>>;
 comparable: false;
 // 최상위 정의·기간·수집 시각은 마지막으로 수집한 arm의 것이다. 한계에는 두 arm 기간이 다를 때와 당일 부분 집계일 때의 경고가 붙는다(Instagram 누적값 제외).
 definition: string;
 window: CollectionWindow;
 limitations: string[];
 fetchedAt: string;
 updatedAt: string;
};

// 최초 수동 수집이 이후 워커가 반복할 수집 대상을 등록한다.
export type MeasurementSource = {
 id: string;
 experimentId: string;
 channel: ConnectorKey;
 arm: 'control' | 'treatment';
 target: string;
 window: CollectionWindow;
 lastFetchedAt: string;
 lastError: string | null;
 // 실험이 끝나면 더 이상 수집하지 않는다. 종료 조건이 없으면 외부 API 호출이 무한히 누적된다.
 stopped?: boolean;
 stoppedReason?: string;
 // 워커 재수집 때 to를 마지막 완결일(어제, Asia/Seoul)까지 넓힌다. 실험 종료일이 있으면 그날까지, from은 유지한다.
 // 같은 실험의 롤링 arm은 같은 tick에 같은 to로 함께 다시 수집한다. 이 필드가 없는 이전 대상은 처음 기간을 그대로 다시 조회한다.
 rolling?: boolean;
};

const arms = ['control', 'treatment'] as const;
const armLabels = {control: '대조안', treatment: '실험안'} as const;
const seoulDay = (at: number | string) => new Date(at).toLocaleDateString('en-CA', {timeZone: 'Asia/Seoul'});
// 마지막 완결일(어제, Asia/Seoul). 오늘은 집계가 끝나지 않은 날이라 롤링 상한으로 쓰지 않는다(R5).
const lastCompleteDay = () => seoulDay(Date.now() - 86400000);
// Instagram 미디어 인사이트는 게시 이후 누적값이라 요청 기간이 값에 영향을 주지 않는다. 기간 불일치·당일 부분 집계 경고는 기간 집계 커넥터에만 붙인다.
const windowed = (channel: ConnectorKey) => channel !== 'instagram';
// 수집 기간이 수집일(Asia/Seoul)까지 닿으면 당일 부분 집계다. 기간 문자열이 같아도 수집 시각에 따라 값이 다르다.
const partialDay = (entry: Pick<MeasurementArmDraft, 'window' | 'fetchedAt'>) => entry.window.to >= seoulDay(entry.fetchedAt);

// 이전 초안은 기간·정의를 하나만 가졌다(마지막으로 수집한 arm의 것). 그 값을 값이 있는 arm의 기록으로 해석하되,
// 기간은 그 arm의 수집 대상(measurement_source)에 남은 기간을 우선 쓴다. 다른 arm의 기간이 붙어 불일치가 가려지지 않게 한다(R6).
function armsOf(draft: MeasurementDraft | null, sources: MeasurementSource[]): NonNullable<MeasurementDraft['arms']> {
 if (!draft) return {};
 if (draft.arms) return draft.arms;
 return Object.fromEntries(arms.filter(a => draft[a]).map(a => [a, {value: draft[a], window: sources.find(s => s.arm === a)?.window ?? draft.window, definition: draft.definition, limitations: draft.limitations, fetchedAt: draft.fetchedAt}]));
}

function windowWarning(entries: NonNullable<MeasurementDraft['arms']>, channel: ConnectorKey) {
 if (!windowed(channel)) return [];
 const c = entries.control?.window, t = entries.treatment?.window;
 const mismatch = c && t && (c.from !== t.from || c.to !== t.to) ? [`두 실험안의 수집 기간이 다릅니다(대조안 ${c.from}~${c.to}, 실험안 ${t.from}~${t.to}). 같은 기간으로 다시 수집하기 전에는 두 값을 비교하지 마세요.`] : [];
 const partial = arms.flatMap(a => {const e = entries[a]; return e && partialDay(e) ? [`${armLabels[a]} 값은 당일 부분 집계입니다(수집 기간 ~${e.window.to}, 수집일 ${seoulDay(e.fetchedAt)}). 완결된 날까지로 다시 수집하기 전에는 두 값을 비교하지 마세요.`] : [];});
 return [...mismatch, ...partial];
}

async function draftFor(owner: string, experimentId: string) {
 try {
  return await readRecord<MeasurementDraft>(owner, 'measurement_draft', experimentId);
 } catch (error) {
  if (error instanceof ApiError && error.status === 404) return null;
  throw error;
 }
}

export async function collectForExperiment(owner: string, input: Record<string, unknown>) {
 const experimentId = str(input.experimentId, '실험', 200, true);
 const experiment = await readRecord<ViralExperiment>(owner, 'viral_experiment', experimentId);
 const arm = arms.find(a => a === input.arm);
 if (!arm) throw new ApiError(400, '대조안 또는 실험안을 선택하세요.');
 const connector = connectorFor(input.channel);
 if (experiment.status !== 'running') throw new ApiError(400, '진행 중인 실험에만 성과를 수집할 수 있습니다.');
 // 다른 채널의 수치를 실험 arm에 넣으면 판정 자체가 무의미해진다. 저장소의 다른 비교 경로와 같은 기준이다.
 const channelName = channelNameForConnector(connector.key);
 if (channelName !== experiment.channel) throw new ApiError(400, `이 실험의 채널은 ${experiment.channel}입니다. ${connector.label} 성과는 넣을 수 없습니다.`);
 const target = str(input.target, '광고 대상 ID', 100, true);
 const window: CollectionWindow = {from: str(input.from, '수집 시작일', 20, true), to: str(input.to, '수집 종료일', 20, true)};

 const credential = await loadCredential(owner, connector.key);
 const collected: Collected = await connector.collect(credential, target, window);

 const previous = await draftFor(owner, experimentId);
 const legacySources = previous && !previous.arms ? await listRecords<MeasurementSource>(owner, 'measurement_source', experimentId) : [];
 const partial = windowed(connector.key) && partialDay(collected) ? [`수집 기간(~${collected.window.to})에 수집일이 포함돼 당일 부분 집계입니다. 하루가 지난 뒤 다시 수집한 값으로 비교하세요.`] : [];
 const entries = {...armsOf(previous, legacySources), [arm]: {value: collected.arm, window: collected.window, definition: collected.definition, limitations: [...collected.limitations, ...partial], fetchedAt: collected.fetchedAt}};
 const draft: MeasurementDraft = {
  id: experimentId,
  experimentId,
  channel: connector.key,
  ...(previous?.control ? {control: previous.control} : {}),
  ...(previous?.treatment ? {treatment: previous.treatment} : {}),
  [arm]: collected.arm,
  ...(collected.storeValues ? {storeValues: {...previous?.storeValues, ...collected.storeValues}} : previous?.storeValues ? {storeValues: previous.storeValues} : {}),
  arms: entries,
  comparable: false,
  definition: collected.definition,
  window: collected.window,
  limitations: [...collected.limitations, ...windowWarning(entries, connector.key)],
  fetchedAt: collected.fetchedAt,
  updatedAt: stamp(),
 } as MeasurementDraft;

 const source: MeasurementSource = {
  id: `${experimentId}:${arm}`,
  experimentId,
  channel: connector.key,
  arm,
  target,
  window: collected.window,
  lastFetchedAt: collected.fetchedAt,
  lastError: null,
  // 롤링은 요청하거나(rolling:true) 마지막 완결일 이후까지 수집을 요청했을 때만 켠다. 지정한 과거 기간은 고정 기간으로 둔다(R4).
  rolling: input.rolling === true || (input.rolling === undefined && collected.window.to >= lastCompleteDay()),
 };

 await database().batch([
  recordStatement(owner, 'measurement_draft', experimentId, draft, experiment.campaignId),
  recordStatement(owner, 'measurement_source', source.id, source, experimentId),
 ]);
 return {collected, draft};
}

async function stopReason(owner: string, experimentId: string) {
 try {
  const experiment = await readRecord<ViralExperiment>(owner, 'viral_experiment', experimentId);
  return experiment.status === 'running' ? null : '실험이 종료되어 수집을 멈췄습니다.';
 } catch (error) {
  if (error instanceof ApiError && error.status === 404) return '실험 기록이 없어 수집을 멈췄습니다.';
  throw error;
 }
}

// 바이럴 실험은 자체 종료일이 없고 캠페인 기간 안에서 진행된다. 캠페인 종료일을 실험 종료일로 쓴다.
async function experimentEnd(owner: string, experimentId: string) {
 const experiment = await readRecord<ViralExperiment>(owner, 'viral_experiment', experimentId);
 try {
  return (await readRecord<Campaign>(owner, 'campaign', experiment.campaignId)).endDate || null;
 } catch (error) {
  if (error instanceof ApiError && error.status === 404) return null;
  throw error;
 }
}

// 롤링 대상의 공통 to(loop-9): 마지막 완결일(어제, Asia/Seoul)까지 넓히되 실험 종료일을 넘지 않는다. 같은 실험의 롤링 arm 중 이미 더 뒤인 to는 줄이지 않는다.
async function rollingTo(owner: string, group: MeasurementSource[]) {
 const last = lastCompleteDay(), end = await experimentEnd(owner, group[0].experimentId);
 const bound = end && end < last ? end : last;
 return group.reduce((to, s) => s.window.to > to ? s.window.to : to, bound);
}

// 워커가 호출한다. 기한이 된 대상 하나(롤링 대상이면 같은 실험의 롤링 arm까지)만 진행하고, 실패는 기록만 하고 다음 tick에 다시 시도한다.
export async function collectDueMeasurements(owner: string) {
 const sources = await listRecords<MeasurementSource>(owner, 'measurement_source');
 const due = sources
  .filter(s => !s.stopped && Date.now() - Date.parse(s.lastFetchedAt) >= COLLECT_INTERVAL_MS)
  .sort((a, b) => a.lastFetchedAt.localeCompare(b.lastFetchedAt));
 const source = due[0];
 if (!source) return {status: 'idle' as const};
 const reason = await stopReason(owner, source.experimentId);
 if (reason) {
  await recordStatement(owner, 'measurement_source', source.id, {...source, stopped: true, stoppedReason: reason, lastFetchedAt: stamp()}, source.experimentId).run();
  return {status: 'stopped' as const};
 }
 const fail = (s: MeasurementSource, error: unknown) => recordStatement(owner, 'measurement_source', s.id, {...s, lastFetchedAt: stamp(), lastError: error instanceof ApiError ? error.message : '성과를 가져오지 못했습니다.'}, s.experimentId).run();
 // 롤링 대상은 같은 실험의 롤링 arm을 이번 tick에 같은 to로 함께 다시 수집한다. 수동 수집 시각이 달라도 두 arm의 기간이 어긋나지 않는다(loop-9).
 const group = source.rolling === true ? sources.filter(s => s.experimentId === source.experimentId && s.rolling === true && !s.stopped) : [source];
 let to: string;
 try {
  to = source.rolling === true ? await rollingTo(owner, group) : source.window.to;
 } catch (error) {
  await fail(source, error);
  return {status: 'retry' as const};
 }
 let failed = false;
 for (const s of group) {
  try {
   await collectForExperiment(owner, {experimentId: s.experimentId, arm: s.arm, channel: s.channel, target: s.target, from: s.window.from, to, rolling: s.rolling === true});
  } catch (error) {
   failed = true;
   await fail(s, error);
  }
 }
 return {status: failed ? 'retry' as const : 'processed' as const};
}
