import {getStoreOperations} from './store-operations-server';
import {ledgerSummary,diagnosisStatus,recentPeriod,type LedgerSnapshot} from './store-operations';
import {readRecord,listRecords,ApiError} from './server';
import type {ArchiveSource} from './archive';
import type {Store,StoreChannel,StoreExperiment,StoreMeasurement,StoreReport} from './store-marketing';
// 4.4 ②: 측정 기록의 주문 해시 id(ledgerSnapshot.orderRefs)는 모델 과업에 필요한 근거가 없어 모델 입력에서 뺀다. 집계 수치(values·operations.ledger)와 나머지 장부 스냅샷(확인 시각·비용 참조·비용 확정 여부)은 이름으로 골라 남긴다. 저장 기록은 장부 변경 감지에 쓰므로 바꾸지 않는다.
const withoutOrderRefs=(m:StoreMeasurement):Omit<StoreMeasurement,'ledgerSnapshot'>&{ledgerSnapshot?:Omit<LedgerSnapshot,'orderRefs'>}=>{if(!m.ledgerSnapshot)return m;const {capturedAt,spendRefs,costsConfirmed}=m.ledgerSnapshot;return {...m,ledgerSnapshot:{capturedAt,spendRefs,costsConfirmed}}};
// 저장된 점포 맥락 스냅샷(조사 시작 때 저장. 변경 전에 시작한 조사는 주문 해시를 담고 있다)도 보낼 때 같은 규칙으로 거른다(lib/research-execution.ts).
export const modelStoreContext=(ctx:unknown)=>{const c=ctx as {measurements?:unknown}|null|undefined;return c&&typeof c==='object'&&Array.isArray(c.measurements)?{...c,measurements:c.measurements.map(m=>m&&typeof m==='object'?withoutOrderRefs(m as StoreMeasurement):m)}:ctx};
export async function storeContext(owner:string,brandId:string,storeId?:string){
 if(!storeId)return null;
 const store=await readRecord<Store>(owner,'store',storeId);if(store.brandId!==brandId)throw new ApiError(400,'브랜드와 지점이 일치하지 않습니다.');
 const [channels,reports,experiments,measurements]=await Promise.all([listRecords<StoreChannel>(owner,'store_channel',storeId),listRecords<StoreReport>(owner,'store_report',storeId),listRecords<StoreExperiment>(owner,'store_experiment',storeId),listRecords<StoreMeasurement>(owner,'store_measurement',storeId)]);
 const sourceIds=new Set((await listRecords<ArchiveSource>(owner,'brand_source',brandId)).filter(s=>s.status!=='excluded'&&(!s.storeId||s.storeId===storeId)).map(s=>s.id));
 let operations:unknown;
 try{const p=recentPeriod(),data=await getStoreOperations(owner,storeId,p.from,p.to);operations={period:p,diagnostics:data.diagnostics.map(d=>({...d,effectiveStatus:diagnosisStatus(d,store)})),ledger:ledgerSummary(data.orders,data.spend),note:'최근 30일의 입력 주문·비용 요약. 전체 거래 수집 완료나 인과 효과를 의미하지 않습니다. 고객 개인정보와 개별 주문번호는 제공하지 않습니다.'}}catch(e){if(e instanceof ApiError)operations={unavailable:e.message};else throw e}
 return {store,channels,operations,researchDraft:reports.find(r=>r.storeVersion===store.version&&r.sourceIds.every(id=>sourceIds.has(id)))||null,experiments:experiments.slice(0,10),measurements:measurements.slice(0,12).map(withoutOrderRefs),omittedExperiments:Math.max(0,experiments.length-10),omittedMeasurements:Math.max(0,measurements.length-12),notice:'지점별 사용자 기록 및 미검증 AI 진단입니다. 계정 자동 수집이나 인과 효과로 간주하지 마세요. 각 수치의 기간·출처·집계 범위를 확인하고 다른 지점으로 일반화하지 마세요. 회고는 다음 실험의 가설로만 활용합니다.'};
}
