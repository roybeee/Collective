import {listRecords} from './server';
import {armsOf, collectGuardEnabled, type MeasurementDraft, type MeasurementSource} from './measurement-collection';
import {armDraftView, collectAlerts, sourceView, type MeasurementView} from './measurement-status';
import type {ViralExperiment} from './learning';

// loop-1: GET /api/learning이 싣는 실험별 수집 초안·자동 수집 대상 상태. 저장 레코드를 그대로 내보내지 않고 보기 형태로만 내보낸다(lib/measurement-status.ts).
export async function measurementViews(owner: string): Promise<MeasurementView[]> {
 const [drafts, sources, guard] = await Promise.all([listRecords<MeasurementDraft>(owner, 'measurement_draft'), listRecords<MeasurementSource>(owner, 'measurement_source'), collectGuardEnabled(owner)]);
 const ids = [...new Set([...drafts.map(d => d.experimentId), ...sources.map(s => s.experimentId)])].filter(Boolean);
 return ids.map(id => {
  const draft = drafts.find(d => d.experimentId === id) ?? null, own = sources.filter(s => s.experimentId === id), arms = armsOf(draft, own);
  const control = armDraftView(arms.control), treatment = armDraftView(arms.treatment);
  return {
   experimentId: id,
   channel: draft?.channel ?? own[0]?.channel ?? null,
   draft: draft ? {arms: {...(control ? {control} : {}), ...(treatment ? {treatment} : {})}, limitations: Array.isArray(draft.limitations) ? draft.limitations.filter(x => typeof x === 'string') : [], fetchedAt: draft.fetchedAt || null, updatedAt: draft.updatedAt || null, comparable: false} : null,
   sources: own.map(s => sourceView(s, guard)),
  };
 });
}

// 워크스페이스 첫 화면 알림(GET /api/learning?only=collect_alerts): 진행 중 실험에서 다시 연결해야 하는 자동 수집 대상.
export async function measurementAlerts(owner: string) {
 const [views, experiments] = await Promise.all([measurementViews(owner), listRecords<ViralExperiment>(owner, 'viral_experiment')]);
 return collectAlerts(views, experiments);
}
