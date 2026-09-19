import {readRecord,listRecords,ApiError} from './server';
import type {ArchiveSource} from './archive';
import type {Store,StoreChannel,StoreExperiment,StoreMeasurement,StoreReport} from './store-marketing';
export async function storeContext(owner:string,brandId:string,storeId?:string){
 if(!storeId)return null;
 const store=await readRecord<Store>(owner,'store',storeId);if(store.brandId!==brandId)throw new ApiError(400,'브랜드와 지점이 일치하지 않습니다.');
 const [channels,reports,experiments,measurements]=await Promise.all([listRecords<StoreChannel>(owner,'store_channel',storeId),listRecords<StoreReport>(owner,'store_report',storeId),listRecords<StoreExperiment>(owner,'store_experiment',storeId),listRecords<StoreMeasurement>(owner,'store_measurement',storeId)]);
 const sourceIds=new Set((await listRecords<ArchiveSource>(owner,'brand_source',brandId)).filter(s=>s.status!=='excluded'&&(!s.storeId||s.storeId===storeId)).map(s=>s.id));
 return {store,channels,researchDraft:reports.find(r=>r.storeVersion===store.version&&r.sourceIds.every(id=>sourceIds.has(id)))||null,experiments:experiments.slice(0,10),measurements:measurements.slice(0,12),omittedExperiments:Math.max(0,experiments.length-10),omittedMeasurements:Math.max(0,measurements.length-12),notice:'지점별 사용자 기록 및 미검증 AI 진단입니다. 계정 자동 수집이나 인과 효과로 간주하지 마세요. 각 수치의 기간·출처·집계 범위를 확인하고 다른 지점으로 일반화하지 마세요. 회고는 다음 실험의 가설로만 활용합니다.'};
}
