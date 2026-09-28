import type {MetaExecution} from './meta-execution';
import type {Campaign} from './agency';
import type {MetaPlan} from './meta-ads';
import {metaBudgetEnvelope} from './meta-budget-review';
import {optionalRecord} from './execution-server';
import {viewMetaAdBundle,requireVerifiedMetaAdBundle} from './meta-ad-bundle-server';
import {reservationIssues,type MetaReservation} from './meta-reservation';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str} from './server';

export async function reservationRecords(owner:string){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='meta_ads_reservation' ORDER BY updated_at DESC LIMIT 1001").bind(owner).all<{data:string}>();
 if(rows.results.length>1000)throw new ApiError(409,'예약 이력이 1,000건을 넘었습니다. 예약 조회 범위를 점검하세요.');
 return rows.results.map(r=>JSON.parse(r.data) as MetaReservation);
}
export async function metaReservationView(owner:string,c:Campaign,canEdit:boolean){
 const [bundle,records,plan]=await Promise.all([viewMetaAdBundle(owner,c),reservationRecords(owner),optionalRecord<MetaPlan>(owner,'meta_ads_plan',c.id)]);
 const executions=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='meta_ads_execution' AND parent_id=?").bind(owner,c.id).all<{data:string}>();
 const maySpend=executions.results.some(r=>(JSON.parse(r.data) as MetaExecution).maySpend);
 const envelope=metaBudgetEnvelope(plan),active=records.filter(r=>r.campaignId===c.id&&r.state!=='released'),reserved=active.reduce((sum,r)=>sum+r.amount,0);
 const issues=[...envelope.issues,...(bundle.verifiedScope?[]:['최신 외부 광고 구성 확인']),...(active.length?['기존 예약의 해제 또는 결과 확인']:[])];
 if(c.status==='archived')issues.push('보관되지 않은 캠페인');
 return {records:records.filter(r=>r.campaignId===c.id).map(r=>({...r,stale:!bundle.verifiedScope||r.scopeDigest!==bundle.verifiedScope.scopeDigest})),scopeDigest:bundle.verifiedScope?.scopeDigest??null,allocatable:envelope.allocatable,reserved,issues,canEdit,maySpend,executionBlockers:['실행 패널에서 별도 승인한 구성만 활성화하며, 외부 중단과 최종 광고비 대조까지 예약을 유지합니다.','예약은 앱의 계획 장부이며 실제 청구 상한이나 광고 중단을 보장하지 않습니다.']};
}
export async function reserveMetaBudget(owner:string,actorId:string,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관된 캠페인입니다.');
 const scope=await requireVerifiedMetaAdBundle(owner,c),plan=await readRecord<MetaPlan>(owner,'meta_ads_plan',c.id),p=plan.input,records=await reservationRecords(owner);
 if(b.expectedScopeDigest!==scope.scopeDigest||plan.campaignVersion!==c.version)throw new ApiError(409,'계획·광고 구성이 변경되었습니다. 다시 확인하세요.');
 const amount=Number(b.amount),note=str(b.note,'예약 근거',500,true);
 if(typeof b.amount!=='number')throw new ApiError(400,'예약액은 원화 정수로 입력하세요.');
 const id=await storefrontDigest({campaignId:c.id,scopeDigest:scope.scopeDigest,amount,note});
 const duplicate=records.find(r=>r.id===id);
 if(duplicate?.state==='reserved')return {...await metaReservationView(owner,c,true),duplicate:true};
 if(duplicate)throw new ApiError(409,'이미 해제한 예약입니다. 외부 구성을 다시 검토하세요.');
 if(records.length>=1000)throw new ApiError(409,'예약 이력이 한도에 도달했습니다. 기존 예약 조회·해제만 가능합니다.');
 const issues=[...metaBudgetEnvelope(plan).issues,...reservationIssues({scope,amount,totalBudget:p.totalBudget??0,safetyReserve:p.safetyReserve??0,lossLimit:p.lossLimit??0,stopRule:p.stopRule},records)];
 if(records.some(r=>r.campaignId===c.id&&r.state!=='released'))issues.push('기존 캠페인 예약을 먼저 확인하세요.');
 if(issues.length)throw new ApiError(409,issues.join(' '));
 const now=stamp(),record:MetaReservation={id,campaignId:c.id,brandId:c.brandId,accountId:scope.accountId,adsetId:scope.adsetId,scope,scopeDigest:scope.scopeDigest,amount,totalBudget:p.totalBudget!,safetyReserve:p.safetyReserve!,lossLimit:p.lossLimit!,stopRule:p.stopRule,state:'reserved',version:1,actorId,createdAt:now,updatedAt:now,releasedBy:null,maySpend:false,note};
 await recordStatement(owner,'meta_ads_reservation',id,record,c.id).run();
 return {...await metaReservationView(owner,c,true),duplicate:false};
}
export async function releaseMetaBudget(owner:string,actorId:string,c:Campaign,b:Record<string,unknown>){
 const r=await readRecord<MetaReservation>(owner,'meta_ads_reservation',str(b.id,'예약',100,true));
 if(r.campaignId!==c.id||r.brandId!==c.brandId)throw new ApiError(404,'이 캠페인의 예약이 아닙니다.');
 if(r.version!==b.expectedVersion||r.state!=='reserved')throw new ApiError(409,'예약 상태가 변경되었거나 외부 결과가 미확인입니다.');
 const executions=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='meta_ads_execution' AND parent_id=?").bind(owner,c.id).all<{data:string}>();
 if(executions.results.some(row=>{const e=JSON.parse(row.data) as MetaExecution;return e.reservationId===r.id&&!['settled','revoked'].includes(e.state)}))throw new ApiError(409,'외부 중단과 최종 광고비 대조를 마칠 때까지 예약을 유지합니다.');
 const next={...r,state:'released' as const,version:r.version+1,updatedAt:stamp(),releasedBy:actorId};
 const changed=await database().prepare("UPDATE records SET data=?,updated_at=? WHERE owner=? AND kind='meta_ads_reservation' AND id=? AND data=?").bind(JSON.stringify(next),next.updatedAt,owner,`${owner}:meta_ads_reservation:${r.id}`,JSON.stringify(r)).run();
 if(!changed.meta.changes)throw new ApiError(409,'다른 요청이 예약을 변경했습니다.');
 return metaReservationView(owner,c,true);
}
