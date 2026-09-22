import {ApiError, str, stamp, readRecord, listRecords, recordStatement, database} from './server';
import {connectorFor} from './connectors';
import {loadCredential} from './channel-credentials';
import {channelNameForConnector} from './channels';
import type {ConnectorKey, CollectionWindow, Collected} from './connectors/types';
import type {Arm, ViralExperiment} from './learning';
import type {StoreMetricKey} from './store-marketing';

// 워커가 같은 대상을 과도하게 다시 부르지 않도록 하는 최소 간격.
export const COLLECT_INTERVAL_MS = 6 * 3600000;

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
 comparable: false;
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
};

const arms = ['control', 'treatment'] as const;

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
 const draft: MeasurementDraft = {
  id: experimentId,
  experimentId,
  channel: connector.key,
  ...(previous?.control ? {control: previous.control} : {}),
  ...(previous?.treatment ? {treatment: previous.treatment} : {}),
  [arm]: collected.arm,
  ...(collected.storeValues ? {storeValues: {...previous?.storeValues, ...collected.storeValues}} : previous?.storeValues ? {storeValues: previous.storeValues} : {}),
  comparable: false,
  definition: collected.definition,
  window: collected.window,
  limitations: collected.limitations,
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

// 워커가 호출한다. 기한이 된 대상 하나만 진행하고, 실패는 기록만 하고 다음 tick에 다시 시도한다.
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
 try {
  await collectForExperiment(owner, {experimentId: source.experimentId, arm: source.arm, channel: source.channel, target: source.target, from: source.window.from, to: source.window.to});
  return {status: 'processed' as const};
 } catch (error) {
  await recordStatement(owner, 'measurement_source', source.id, {...source, lastFetchedAt: stamp(), lastError: error instanceof ApiError ? error.message : '성과를 가져오지 못했습니다.'}, source.experimentId).run();
  return {status: 'retry' as const};
 }
}
