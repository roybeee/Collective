import {requireGrowthRunning} from './growth-stop-server';
import type {Campaign} from './agency';
import type {StorefrontWebhook} from './storefront-webhook';
import type {StorefrontOrderLink} from './storefront-orders';
import type {GrowthExperimentRecord,GrowthExperimentUnit} from './growth-experiment-server';
import {checkExperimentRefs} from './growth-experiment-server';
import {assignUnit} from './growth-experiment';
import type {ExperimentEvent} from './growth-experiment-events';
import {storefrontDigest} from './storefront-orders';
import {appendRow,campaignCapacity,campaignRows,inCampaign,optionalRecord} from './growth-ledger-server';
import {ApiError,database,readRecord,recordStatement,stamp} from './server';
export type ExperimentIngestState={connectionId:string;sourceKey:string;revision:number;lastOccurredAt:string;exposedAt:string|null;trackingThrough:string|null;consent:ExperimentEvent['consent'];orderLinks:{id:string;orderId:string}[]};
type Receipt={id:string;campaignId:string;brandId:string;designId:string;unitHash:string;digest:string;action:ExperimentEvent['action'];revision:number;connectionId:string;credentialVersion:number;occurredAt:string;recordedAt:string;response:{recorded:true;unitHash:string;arm:'control'|'treatment';revision:number;unitVersion:number;mayExecute:false}};
type CanonicalOrder={id:string;storeId:string;campaignId?:string;version:number;orderDate:string};
async function currentDesign(owner:string,connection:StorefrontWebhook,event:ExperimentEvent){
 const c=await readRecord<Campaign>(owner,'campaign',event.campaignId),design=await readRecord<GrowthExperimentRecord>(owner,'growth_experiment',event.designId);
 const withdrawing=event.action==='withdraw';
 if((c.status==='archived'&&!withdrawing)||c.brandId!==connection.brandId||c.storeId!==connection.storeId||!inCampaign(design,c)||design.storeId!==connection.storeId)throw new ApiError(409,'실험·캠페인·연결 지점 범위가 일치하지 않습니다.');
 if(!design.registration||design.registration.digest!==event.registrationDigest)throw new ApiError(409,'단위가 배정된 사전등록 digest를 확인하세요.');
 if(!withdrawing&&(design.status!=='registered'||design.version!==event.designVersion||design.registration.digest!==await storefrontDigest({id:design.id,input:design.input})))throw new ApiError(409,'현재 사전등록 설계와 digest를 확인하세요.');
 if(design.input.channel!=='storefront'||design.input.assignmentUnit==='store_day')throw new ApiError(409,'판매처 가명 방문자·세션 실험만 수신합니다.');
 if(!withdrawing)await checkExperimentRefs(owner,c,design.input);
 return {c,design};
}
async function orderLinks(owner:string,c:Campaign,design:GrowthExperimentRecord,connection:StorefrontWebhook,event:ExperimentEvent,unit:GrowthExperimentUnit){
 const links=[...(unit.ingest?.orderLinks??[])];
 for(const reference of event.orders??[]){
  const id=await storefrontDigest([connection.storeId,connection.sourceKey,reference.externalId]),link=await optionalRecord<StorefrontOrderLink>(owner,'storefront_order_link',id);
  if(!link||link.brandId!==c.brandId||link.storeId!==connection.storeId||link.sourceKey!==connection.sourceKey||link.externalId!==reference.externalId||link.revision!==reference.revision)throw new ApiError(409,'현재 판매처 원본 주문 판을 먼저 수신하세요.');
  const order=await readRecord<CanonicalOrder>(owner,'store_order',link.orderId);
  if(order.storeId!==design.storeId||(order.campaignId&&order.campaignId!==c.id)||order.version!==link.orderVersion||order.orderDate<design.input.startAt.slice(0,10)||order.orderDate>design.input.endAt.slice(0,10))throw new ApiError(409,'정합성이 확인된 실험 기간·캠페인의 원본 주문만 연결합니다.');
  if(!links.some(l=>l.orderId===order.id))links.push({id,orderId:order.id});
 }
 if(links.length>20)throw new ApiError(409,'단위별 주문은 최대 20개입니다.');
 const others=await campaignRows<GrowthExperimentUnit>(owner,c,'growth_experiment_unit',5000);
 if(others.some(u=>u.designId===design.id&&u.id!==unit.id&&u.observation?.orderIds.some(id=>links.some(l=>l.orderId===id))))throw new ApiError(409,'이미 다른 단위에 연결된 주문입니다.');
 return links;
}
function checkWindow(design:GrowthExperimentRecord,event:ExperimentEvent,now:number){
 if(event.action==='withdraw')return;
 const start=Date.parse(design.input.startAt),end=Date.parse(design.input.endAt),occurred=Date.parse(event.occurredAt),last=end+design.input.maturityDays*86400000+86400000;
 if(event.action==='assign'||event.action==='exposure'){
  if(now<start||now>end||occurred<start||occurred>end)throw new ApiError(409,'등록된 관측 기간 안에서만 배정·노출합니다.');
 }else if(now<start||now>last||occurred<start||occurred>last)throw new ApiError(409,'관측·성숙 기간과 하루 수신 유예 안에서만 마감합니다.');
 if(event.action==='tracking_close'&&event.trackingComplete&&(now<end||Date.parse(event.trackingThrough!)<end))throw new ApiError(409,'관측 종료까지 추적한 뒤 비구매자를 포함해 마감하세요.');
}
async function nextUnit(owner:string,c:Campaign,design:GrowthExperimentRecord,connection:StorefrontWebhook,event:ExperimentEvent,unit:GrowthExperimentUnit,at:string){
 const state=unit.ingest;
 if(!state||state.connectionId!==connection.id||state.sourceKey!==connection.sourceKey)throw new ApiError(409,'수동 관측 또는 다른 수신 연결의 단위를 덮어쓸 수 없습니다.');
 if(!state.consent.granted)throw new ApiError(409,'측정 동의를 철회한 단위는 다시 관측하지 않습니다.');
 if(event.action==='assign')return unit;
 // Withdrawal supersedes uncertain in-flight tracking without replaying revoked data.
 const ordered=event.action==='withdraw'?event.revision>state.revision:event.revision===state.revision+1;
 if(!ordered||Date.parse(event.occurredAt)<Date.parse(state.lastOccurredAt))throw new ApiError(409,'단위 사건 순서가 맞지 않습니다. 누락된 이전 판부터 재전송하세요.');
 if(Date.parse(event.consent.observedAt)<Date.parse(state.consent.observedAt))throw new ApiError(409,'이전 동의 판으로 되돌릴 수 없습니다.');
 if(event.action==='tracking_close'&&!state.exposedAt)throw new ApiError(409,'실제 노출을 확인한 단위만 추적 마감합니다.');
 if(event.action==='exposure'&&state.trackingThrough)throw new ApiError(409,'마감한 단위는 다시 노출하지 않습니다.');
 const links=event.action==='tracking_close'?await orderLinks(owner,c,design,connection,event,unit):state.orderLinks;
 const trackingThrough=event.action==='tracking_close'?event.trackingThrough!:state.trackingThrough;
 if(state.trackingThrough&&trackingThrough&&Date.parse(trackingThrough)<Date.parse(state.trackingThrough))throw new ApiError(409,'추적 완료 구간을 이전으로 되돌릴 수 없습니다.');
 const exposedAt=event.action==='exposure'?(state.exposedAt??event.occurredAt):state.exposedAt;
 return {...unit,version:unit.version+1,ingest:{...state,revision:event.revision,lastOccurredAt:event.occurredAt,exposedAt,trackingThrough,consent:event.consent,orderLinks:links},observation:{exposed:!!exposedAt,trackingComplete:event.action==='tracking_close'?event.trackingComplete!:false,contaminated:event.action==='withdraw'||!!unit.observation?.contaminated||!!event.contaminated,orderIds:links.map(l=>l.orderId),evidenceRef:event.eventId,recordedAt:at,recordedBy:'storefront:'+connection.id}};
}
/** Caller holds the same owner lock as manual experiment mutations and revalidates the credential before calling. */
export async function ingestExperimentEvent(owner:string,connection:StorefrontWebhook,event:ExperimentEvent,now=Date.now()){
 const {c,design}=await currentDesign(owner,connection,event),digest=await storefrontDigest({connectionId:connection.id,event});
 const assignment=await assignUnit(design.seed,event.unitKey,design.input.treatmentShare);
 const withdrawn=await database().prepare("SELECT 1 FROM records WHERE owner=? AND kind='growth_experiment_ingest_event' AND parent_id=? AND json_extract(data,'$.designId')=? AND json_extract(data,'$.unitHash')=? AND json_extract(data,'$.action')='withdraw' LIMIT 1").bind(owner,c.id,design.id,assignment.unitHash).first();
 const previous=await optionalRecord<Receipt>(owner,'growth_experiment_ingest_event',event.eventId);
 if(withdrawn&&event.action!=='withdraw')throw new ApiError(409,'측정 동의를 철회한 단위는 다시 관측하지 않습니다.');
 if(previous){if(previous.digest!==digest||previous.campaignId!==c.id||previous.designId!==design.id)throw new ApiError(409,'같은 사건 ID의 내용·범위가 다릅니다.');return {...previous.response,duplicate:true}}
 if(withdrawn)throw new ApiError(409,'이미 측정 동의를 철회했습니다. 기존 철회 요청 번호로 조회하세요.');
 checkWindow(design,event,now);
 if(event.action==='assign'||event.action==='exposure')await requireGrowthRunning(owner);
 if(event.action==='assign'&&event.revision!==1)throw new ApiError(409,'최초 배정은 사건 판 1부터 시작합니다.');
 const id=design.id+':'+assignment.unitHash.slice(0,40),old=await optionalRecord<GrowthExperimentUnit>(owner,'growth_experiment_unit',id),at=stamp();
 if(old&&(!inCampaign(old,c)||old.designId!==design.id||old.unitHash!==assignment.unitHash||old.arm!==assignment.arm))throw new ApiError(409,'기존 단위 배정 범위를 확인하세요.');
 if(!old&&event.action==='withdraw'){
  const count=await database().prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='growth_experiment_ingest_event' AND parent_id=? AND json_extract(data,'$.designId')=? AND json_extract(data,'$.action')='withdraw' AND json_extract(data,'$.response.unitVersion')=0").bind(owner,c.id,design.id).first<{n:number}>();
  if((count?.n??0)>=5000)throw new ApiError(409,'미도달 배정의 철회 보관 한도를 대사하세요.');
  const response={recorded:true as const,...assignment,revision:event.revision,unitVersion:0,mayExecute:false as const};
  const receipt:Receipt={id:event.eventId,campaignId:c.id,brandId:c.brandId,designId:design.id,unitHash:assignment.unitHash,digest,action:event.action,revision:event.revision,connectionId:connection.id,credentialVersion:connection.version,occurredAt:event.occurredAt,recordedAt:at,response};
  await database().batch([appendRow(owner,c,'growth_experiment_ingest_event',event.eventId,receipt,at)]);
  return {...response,duplicate:false};
 }
 if(!old&&event.action!=='assign')throw new ApiError(409,'먼저 서버 배정을 받아야 합니다.');
 if(!old){const count=await database().prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='growth_experiment_unit' AND parent_id=? AND json_extract(data,'$.designId')=?").bind(owner,c.id,design.id).first<{n:number}>();if((count?.n??0)>=5000)throw new ApiError(409,'실험당 배정 단위는 5000개까지입니다.');}
 const next:GrowthExperimentUnit=old?await nextUnit(owner,c,design,connection,event,old,at):{id,designId:design.id,campaignId:c.id,brandId:c.brandId,...assignment,assignedAt:at,version:1,observation:null,ingest:{connectionId:connection.id,sourceKey:connection.sourceKey,revision:1,lastOccurredAt:event.occurredAt,exposedAt:null,trackingThrough:null,consent:event.consent,orderLinks:[]}};
 const response={recorded:true as const,...assignment,revision:next.ingest!.revision,unitVersion:next.version,mayExecute:false as const};
 const receipt:Receipt={id:event.eventId,campaignId:c.id,brandId:c.brandId,designId:design.id,unitHash:assignment.unitHash,digest,action:event.action,revision:event.revision,connectionId:connection.id,credentialVersion:connection.version,occurredAt:event.occurredAt,recordedAt:at,response};
 // Normal traffic cannot consume the per-unit safety slots: first close, completion, and one withdrawal.
 // Repeated incomplete/complete updates still consume the normal budget; a revoked unit rejects new events.
 const safetySlot=event.action==='withdraw'||(event.action==='tracking_close'&&(!old?.ingest?.trackingThrough||(!old.observation?.trackingComplete&&event.trackingComplete)));
 if(!safetySlot)await campaignCapacity(owner,c,'growth_experiment_ingest_event',10000);
 await database().batch([...(old===next?[]:[recordStatement(owner,'growth_experiment_unit',id,next,c.id)]),appendRow(owner,c,'growth_experiment_ingest_event',event.eventId,receipt,at)]);
 return {...response,duplicate:false};
}
