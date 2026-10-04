import type {Campaign} from './agency';
import type {StoreOrder} from './store-operations';
import {parseMissionInput,missionReadiness,type MissionInput} from './growth-mission';
import {executionId,executionSafeText} from './growth-execution';
import {parseReconciliationInput,reconcileCommitment} from './growth-reconciliation';
import {prepareScopedMissionCommitment,type GrowthCommitmentRecord} from './growth-authority-server';
import {growthOperationsView,prepareEvent,type InventoryRow} from './growth-operations-server';
import {projectInventory,type InventoryEvent} from './growth-inventory';
import {requireGrowthRunning} from './growth-stop-server';
import {growthView} from './growth-workspace-server';
import {bundleAssessment} from './growth-bundle';
import type {BundleRecord} from './growth-bundle-server';
import {prepareBundleReservation,type BundleReservation} from './growth-bundle-reservation-server';
import {bundleOrderMoneyRows} from './growth-bundle-order-bridge';
import {validateOrderMoneyAllocations,type OrderMoneyAllocation} from './growth-order-bridge';
import {campaignRows,campaignCapacity,appendRow,inCampaign,versionedMutation,type Versioned} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,type Actor} from './server';
const kinds={mission:'growth_bundle_mission',missionHistory:'growth_bundle_mission_history',missionRequest:'growth_bundle_mission_request',order:'growth_bundle_order',orderHistory:'growth_bundle_order_history',orderRequest:'growth_bundle_order_request'} as const;
const missionKinds={current:kinds.mission,history:kinds.missionHistory,request:kinds.missionRequest},orderKinds={current:kinds.order,history:kinds.orderHistory,request:kinds.orderRequest};
export type BundleMission=Versioned&{storeId:string;bundleId:string;bundleVersion:number;input:Omit<MissionInput,'offerId'|'offerVersion'>;quantity:number;status:'prepared'|'unknown'|'failed'|'observed';commitmentId:string;reservation:BundleReservation;snapshot:BundleRecord['input'];evidenceRef:string;updatedAt:string;updatedBy:string;reconciliation?:unknown};
export type BundleOrder=Versioned&{storeId:string;input:OrderMoneyAllocation&{missionId:string;missionVersion:number;quantity:number;evidenceRef:string};components:{inventoryId:string;sku:string;unit:string;units:number;paidAllocation:number;refundAllocation:number;reservationId:string}[];reservationScope:string;missionSnapshot:BundleMission;updatedAt:string;updatedBy:string;lastOperation?:unknown};
const number=(v:unknown,label:string,min=0)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>1e12)throw new ApiError(400,`${label}: 안전한 정수 입력이 필요합니다.`);return v};
async function inventory(who:Actor,c:Campaign,id:string){const item=await readRecord<InventoryRow>(who.owner,'growth_inventory_item',id);if(item.brandId!==c.brandId||item.storeId!==c.storeId||item.input.locationId!==c.storeId)throw new ApiError(409,'재고 지점·브랜드 범위를 확인하세요.');const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_stock_event' AND parent_id=? LIMIT 5001").bind(who.owner,id).all<{data:string}>();if(rows.results.length>5000)throw new ApiError(409,'재고 사건 한도입니다.');const events=rows.results.map(x=>JSON.parse(x.data) as InventoryEvent&{brandId:string;storeId:string;inventoryId:string});if(events.some(e=>e.brandId!==c.brandId||e.storeId!==c.storeId||e.inventoryId!==id))throw new ApiError(409,'재고 사건 범위를 확인하세요.');const projection=projectInventory(item.input,events.sort((a,b)=>a.version-b.version));if(projection.version!==item.version)throw new ApiError(409,'현재 재고 판을 대사하세요.');return {item,projection}}
async function scoped<T extends Versioned&{storeId:string}>(who:Actor,c:Campaign,kind:string,id:string){const r=await readRecord<T>(who.owner,kind,id);if(!inCampaign(r,c)||r.storeId!==c.storeId)throw new ApiError(404,'현재 캠페인·지점의 기록이 아닙니다.');return r}
function selectedVersion(b:Record<string,unknown>,id:string){if(!Array.isArray(b.inventories))throw new ApiError(400,'전체 구성 재고 판을 선택하세요.');const rows=b.inventories as {inventoryId:string;version:number}[];if(rows.length>10||new Set(rows.map(r=>r?.inventoryId)).size!==rows.length)throw new ApiError(400,'재고 판 선택을 확인하세요.');const r=rows.find(x=>x?.inventoryId===id);if(!r)throw new ApiError(400,'전체 구성 재고를 선택하세요.');return number(r.version,'재고 판')}
const stockFields=(kind:InventoryEvent['kind'],quantity:number,scope:string,reservationId:string,orderId:string,at:string,evidenceRef:string)=>({kind,quantity,missionId:scope,reservationId,orderId,observedAt:at,evidenceRef,safeRelease:false,returnAccepted:false,disposition:'unknown' as const,restock:false});
const reservationId=async(scopeId:string,inventoryId:string)=>'bundle-'+(await storefrontDigest({scopeId,inventoryId})).slice(0,40);
function bundleUpdate(who:Actor,c:Campaign,bundle:BundleRecord,reservation:BundleReservation,at:string){const next={...bundle,reservation,version:bundle.version+1,updatedAt:at,updatedBy:who.id};return [recordStatement(who.owner,'growth_bundle',bundle.id,next,c.id),appendRow(who.owner,c,'growth_bundle_history',`${bundle.id}:${next.version}`,next,at)]}
async function prepareMission(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=executionId(b.id);if(!id.startsWith('bundle-mission-'))throw new ApiError(400,'번들 미션 ID를 확인하세요.');
 const parsed=parseMissionInput({...b.input as object,offerId:'bundle',offerVersion:1}),{offerId:_offerId,offerVersion:_offerVersion,...input}=parsed;void _offerId;void _offerVersion;
 const readiness=missionReadiness(parsed,[]);if(readiness.missing.length)throw new ApiError(409,readiness.missing.join(' '));
 return versionedMutation<BundleMission>(who,c,b,missionKinds,id,b,async(old,at)=>{
  if(old)throw new ApiError(409,'이미 준비한 번들 미션입니다.');
  await campaignCapacity(who.owner,c,'growth_bundle_history',2000);
  const bundle=await readRecord<BundleRecord>(who.owner,'growth_bundle',executionId(b.bundleId));if(!inCampaign(bundle,c)||bundle.version!==b.bundleVersion)throw new ApiError(409,'번들의 현재 판을 확인하세요.');
  const quantity=number(b.quantity,'번들 수량',1),view=await growthView(who.owner,c,true),catalogs=view.catalogs.map(x=>({...x,currentStock:x.currentStock??null}));
  const budget=await prepareScopedMissionCommitment(who,c,{id,version:1,input},executionId(b.authorityId),number(b.authorityVersion,'위임 판',1));if(budget.duplicate)throw new ApiError(409,'기존 예산 예약을 대사하세요.');
  let reservation:BundleReservation,writes:D1PreparedStatement[]=[];
  if(bundle.reservation?.status==='held'){
   if(bundle.reservation.linkedMissionId||bundle.reservation.quantity!==quantity||b.confirmed!==true)throw new ApiError(409,'기존 예약의 연결·수량을 확인하세요.');
   for(const comp of bundle.reservation.components){const {item,projection}=await inventory(who,c,comp.inventoryId); if(item.version!==selectedVersion(b,item.id))throw new ApiError(409,'현재 재고 판을 확인하세요.');if(item.input.sku!==comp.sku||item.input.unit!==comp.unit)throw new ApiError(409,'예약 재고 SKU·단위를 확인하세요.');const exact=await reservationId(bundle.reservation!.scopeId,item.id),hold=projection.reservations.find(r=>r.reservationId===exact&&r.missionId===bundle.reservation!.scopeId);if(!hold||hold.held!==comp.units||hold.allocated||hold.released)throw new ApiError(409,'미배정 전체 예약만 미션에 연결합니다.');}
   const adjusted=catalogs.map(cat=>({...cat,currentStock:cat.currentStock?.status==='known'?{...cat.currentStock,available:cat.currentStock.available!+(bundle.reservation!.components.find(x=>x.inventoryId===cat.currentStock?.inventoryId)?.units??0)}:cat.currentStock}));
   const missing=bundleAssessment({...bundle.input,plannedQuantity:quantity},adjusted).missing;if(missing.length)throw new ApiError(409,missing.join(' '));
   reservation=bundle.reservation;
  }else{const prepared=await prepareBundleReservation(who,c,bundle,{...b,action:'reserve_bundle'},catalogs,at);reservation=prepared.reservation;writes=prepared.writes;}
  reservation={...reservation,linkedMissionId:id};
  return {next:{id,version:1,brandId:c.brandId,campaignId:c.id,storeId:c.storeId!,bundleId:bundle.id,bundleVersion:bundle.version,input,quantity,status:'prepared',commitmentId:budget.record.id,reservation,snapshot:bundle.input,evidenceRef:executionId(b.evidenceRef),updatedAt:at,updatedBy:who.id},extra:[...budget.writes,...writes,...bundleUpdate(who,c,bundle,reservation,at)],limit:500};
 });
}
async function linkOrder(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=executionId(b.id);if(!id.startsWith('bundle-order-'))throw new ApiError(400,'번들 주문 ID를 확인하세요.');
 return versionedMutation<BundleOrder>(who,c,b,orderKinds,id,b,async(old,at)=>{
  const mission=await scoped<BundleMission>(who,c,missionKinds.current,executionId(b.missionId));if(mission.version!==b.missionVersion||(!old&&mission.status==='failed'))throw new ApiError(409,'현재 판매 미션을 확인하세요.');
  const order=await readRecord<StoreOrder>(who.owner,'store_order',executionId(b.orderId));if(order.storeId!==c.storeId||(order.campaignId&&order.campaignId!==c.id)||order.version!==b.orderVersion)throw new ApiError(409,'현재 지점·캠페인의 주문 판을 확인하세요.');
  const quantity=number(b.quantity,'주문 번들 수량',1),input={orderId:order.id,orderVersion:order.version,missionId:mission.id,missionVersion:mission.version,quantity,sourceKey:executionId(b.sourceKey),accountId:executionId(b.accountId),externalLineId:executionId(b.externalLineId),paidAllocation:number(b.paidAllocation,'결제 배분'),refundAllocation:number(b.refundAllocation,'환불 배분'),evidenceRef:executionId(b.evidenceRef)};
  if(old&&['missionId','quantity','orderId','sourceKey','accountId','externalLineId'].some(k=>old.input[k as keyof typeof input]!==input[k as keyof typeof input]))throw new ApiError(409,'이미 배정한 주문의 미션·수량·출처는 바꿀 수 없습니다.');
  const budget=await readRecord<GrowthCommitmentRecord>(who.owner,'growth_commitment',mission.commitmentId);if(!inCampaign(budget,c)||budget.missionId!==mission.id||budget.authoritySnapshot.accountId!==input.accountId)throw new ApiError(409,'준비한 위임 계정과 주문 계정이 일치해야 합니다.');
  if(input.refundAllocation>input.paidAllocation||!Array.isArray(b.components)||b.components.length!==mission.reservation.components.length)throw new ApiError(400,'구성별 전체 결제·환불 배분을 입력하세요.');
  const raw=b.components as {inventoryId:string;paidAllocation:number;refundAllocation:number}[];
  if(new Set(raw.map(x=>x?.inventoryId)).size!==raw.length)throw new ApiError(400,'같은 구성 상품의 배분이 중복되었습니다.');
  const components=await Promise.all(mission.reservation.components.map(async comp=>{const money=raw.find(x=>x?.inventoryId===comp.inventoryId);if(!money)throw new ApiError(400,'모든 구성의 금액 배분이 필요합니다.');const paidAllocation=number(money.paidAllocation,'구성 결제 배분'),refundAllocation=number(money.refundAllocation,'구성 환불 배분');if(refundAllocation>paidAllocation)throw new ApiError(400,'구성 환불은 결제 배분 이내여야 합니다.');return {...comp,units:comp.units/mission.quantity*quantity,paidAllocation,refundAllocation,reservationId:await reservationId(mission.reservation.scopeId,comp.inventoryId)}}));
  if(components.reduce((n,x)=>n+x.paidAllocation,0)!==input.paidAllocation||components.reduce((n,x)=>n+x.refundAllocation,0)!==input.refundAllocation)throw new ApiError(400,'구성별 배분 합계가 번들 배분과 같아야 합니다.');
  const bundles=await bundleOrderMoneyRows(who.owner,c),single=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_order_line' AND parent_id=? LIMIT 1001").bind(who.owner,c.storeId).all<{data:string}>();if(single.results.length>1000)throw new ApiError(409,'주문 품목 한도를 대사하세요.');
  const allocations=[...bundles.filter(x=>x.id!==id).map(x=>x.input),...single.results.map(x=>(JSON.parse(x.data) as {input:OrderMoneyAllocation}).input),input].filter(x=>x.orderId===order.id);
  const assessed=validateOrderMoneyAllocations(order,allocations);if(assessed.status==='invalid')throw new ApiError(409,assessed.reasons.join(' '));
  const all=await campaignRows<BundleOrder>(who.owner,c,orderKinds.current,1000);if(all.filter(x=>x.id!==id&&x.input.missionId===mission.id).reduce((n,x)=>n+x.input.quantity,quantity)>mission.quantity)throw new ApiError(409,'미션 예약 번들 수량을 초과합니다.');
  const writes:D1PreparedStatement[]=[];
  if(!old){if(['released','reconciled'].includes(budget.commitment.status))throw new ApiError(409,'최종 대사한 미션에는 새 주문을 배정할 수 없습니다.');await requireGrowthRunning(who.owner);if(c.status!=='active')throw new ApiError(409,'진행 중인 캠페인만 새 주문을 배정합니다.');if(order.status!=='paid'||order.paidAmount<=order.refundAmount)throw new ApiError(409,'취소·환불 완료 주문은 새 배정을 할 수 없습니다.');
   for(const comp of components){const {item,projection}=await inventory(who,c,comp.inventoryId),held=projection.reservations.find(r=>r.reservationId===comp.reservationId);if(item.version!==selectedVersion(b,item.id)||item.input.sku!==comp.sku||item.input.unit!==comp.unit||!held||held.missionId!==mission.reservation.scopeId||held.held<comp.units)throw new ApiError(409,'전체 구성 예약·재고 판과 미배정 수량을 확인하세요.');const eventId='bundle-allocate-'+(await storefrontDigest({id,inventoryId:item.id})).slice(0,32),fields=stockFields('allocate',comp.units,mission.reservation.scopeId,comp.reservationId,id,at,input.evidenceRef);const prepared=await prepareEvent(who,c,item,eventId,await storefrontDigest({id,fields}),fields,item.version);if(prepared.duplicate)throw new ApiError(409,'기존 배정 사건을 대사하세요.');writes.push(...prepared.writes);}
  }
  if(!old&&all.filter(x=>x.input.missionId===mission.id).reduce((n,x)=>n+x.input.quantity,quantity)===mission.quantity){const bundle=await readRecord<BundleRecord>(who.owner,'growth_bundle',mission.bundleId);if(bundle.reservation?.linkedMissionId===mission.id)writes.push(...bundleUpdate(who,c,bundle,{...bundle.reservation,status:'consumed'},at));}
  return {next:{id,brandId:c.brandId,campaignId:c.id,storeId:c.storeId!,version:(old?.version??0)+1,input,components,reservationScope:mission.reservation.scopeId,missionSnapshot:old?.missionSnapshot??mission,updatedAt:at,updatedBy:who.id},extra:writes,limit:1000,recovery:!!old};
 });
}
async function recordOperation(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=executionId(b.id);return versionedMutation<BundleOrder>(who,c,b,orderKinds,id,b,async(old,at)=>{
  if(!old||old.storeId!==c.storeId)throw new ApiError(404,'번들 주문을 찾지 못했습니다.');
  const kind=String(b.kind);if(!['ship','release','refund','return'].includes(kind))throw new ApiError(400,'지원하지 않는 번들 이행 사건입니다.');
  const comp=old.components.find(x=>x.inventoryId===b.inventoryId);if(!comp)throw new ApiError(404,'이 주문의 구성 재고가 아닙니다.');
  const {item}=await inventory(who,c,comp.inventoryId),order=await readRecord<StoreOrder>(who.owner,'store_order',old.input.orderId);
  if(order.storeId!==c.storeId||order.version!==old.input.orderVersion)throw new ApiError(409,'최신 주문 결제·환불 배분을 먼저 대사하세요.');
  if(kind==='ship')await requireGrowthRunning(who.owner);
  if(kind==='ship'&&(order.status!=='paid'||order.refundAmount>0))throw new ApiError(409,'취소·환불 주문은 출고할 수 없습니다.');
  const fields={...stockFields(kind as InventoryEvent['kind'],number(b.quantity,'이행 수량',1),old.reservationScope,comp.reservationId,id,executionSafeText(b.observedAt,'관측 시각',40),executionId(b.evidenceRef)),safeRelease:b.safeRelease===true,returnAccepted:b.returnAccepted===true,disposition:(b.disposition??'unknown') as InventoryEvent['disposition'],restock:b.restock===true};
  const prepared=await prepareEvent(who,c,item,'bundle-op-'+(await storefrontDigest({requestId:b.requestId,inventoryId:item.id})).slice(0,32),await storefrontDigest({id,fields}),fields,number(b.inventoryVersion,'재고 판'));
  if(prepared.duplicate)throw new ApiError(409,'기존 이행 사건을 대사하세요.');
  return {next:{...old,version:old.version+1,lastOperation:{...fields,inventoryId:item.id,recordedBy:who.id},updatedAt:at,updatedBy:who.id},extra:prepared.writes,limit:1000,recovery:true};
 });
}
async function reconcileMission(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=executionId(b.id);return versionedMutation<BundleMission>(who,c,b,missionKinds,id,b,async(old,at)=>{
  if(!old||old.storeId!==c.storeId)throw new ApiError(404,'번들 미션을 찾지 못했습니다.');
  const commitment=await readRecord<GrowthCommitmentRecord>(who.owner,'growth_commitment',old.commitmentId);if(!inCampaign(commitment,c))throw new ApiError(404,'예산 범위를 확인하세요.');
  if((commitment.version??1)!==b.commitmentVersion||commitment.missionId!==old.id)throw new ApiError(409,'현재 예산 판을 확인하세요.');
  const state=b.status;if(!['unknown','failed','observed'].includes(String(state)))throw new ApiError(400,'실제 운영 증빙의 상태를 선택하세요.');
  if(old.status==='observed'&&state!=='observed')throw new ApiError(409,'확인한 집행을 미확인·실패로 되돌릴 수 없습니다.');
  const input=parseReconciliationInput(b.input),after=reconcileCommitment(commitment.commitment,input,String(state)),writes:D1PreparedStatement[]=[];
  if(input.mode==='final'){
   let released=false,allocated=false;
   for(const comp of old.reservation.components){
    const awaitedId=await reservationId(old.reservation.scopeId,comp.inventoryId),{item,projection}=await inventory(who,c,comp.inventoryId),reservation=projection.reservations.find(r=>r.missionId===old.reservation.scopeId&&r.reservationId===awaitedId);
    if(!reservation)throw new ApiError(409,'미션 구성 예약의 원본을 확인하세요.');
    if(projection.orders.some(r=>r.missionId===old.reservation.scopeId&&r.held>0))throw new ApiError(409,'미출고 구성 재고를 먼저 이행 또는 해제하세요.');
    allocated ||= reservation.allocated>0;
    if(reservation.held>0){
     if(b.releaseUnallocated!==true)throw new ApiError(409,'미배정 구성 재고의 안전한 해제를 확인하세요.');
     const fields={...stockFields('release',reservation.held,old.reservation.scopeId,reservation.reservationId,'',at,input.evidenceRef),safeRelease:true};
     const event=await prepareEvent(who,c,item,'bundle-final-'+(await storefrontDigest({requestId:b.requestId,inventoryId:item.id})).slice(0,32),await storefrontDigest({id,fields}),fields,selectedVersion(b,item.id));if(event.duplicate)throw new ApiError(409,'기존 잔량 해제 사건을 대사하세요.');writes.push(...event.writes);released=true;
    }
   }
   if(released){const bundle=await readRecord<BundleRecord>(who.owner,'growth_bundle',old.bundleId);if(bundle.version!==b.bundleVersion||bundle.reservation?.linkedMissionId!==old.id)throw new ApiError(409,'현재 연결 번들 예약을 확인하세요.');writes.push(...bundleUpdate(who,c,bundle,{...bundle.reservation,status:allocated?'consumed':'released',releasedAt:at},at));}
  }
  if(input.mode==='release'){
   const orders=await campaignRows<BundleOrder>(who.owner,c,orderKinds.current,1000);if(orders.some(x=>x.input.missionId===old.id))throw new ApiError(409,'주문 배정 이력이 있는 미션은 무집행으로 해제할 수 없습니다.');
   const bundle=await readRecord<BundleRecord>(who.owner,'growth_bundle',old.bundleId);if(bundle.version!==b.bundleVersion||bundle.reservation?.linkedMissionId!==old.id)throw new ApiError(409,'현재 연결 번들 예약을 확인하세요.');
   const released=await prepareBundleReservation(who,c,bundle,{...b,action:'release_bundle',evidenceRef:input.evidenceRef,confirmed:true},[],at,old.id);writes.push(...released.writes,...bundleUpdate(who,c,bundle,released.reservation,at));
  }
  const nextCommitment={...commitment,version:(commitment.version??1)+1,commitment:{...after,...(input.mode==='final'?{reconciledAt:at}:{})}};writes.push(recordStatement(who.owner,'growth_commitment',commitment.id,nextCommitment,c.id));
  return {next:{...old,version:old.version+1,status:state as BundleMission['status'],reconciliation:{input,before:commitment.commitment,after:nextCommitment.commitment},updatedAt:at,updatedBy:who.id},extra:writes,limit:500,recovery:true};
 });
}
export async function growthBundleFulfillmentView(who:Actor,c:Campaign){
 const [missions,orders,operations,authority,commitments]=await Promise.all([campaignRows<BundleMission>(who.owner,c,missionKinds.current,500),campaignRows<BundleOrder>(who.owner,c,orderKinds.current,1000),growthOperationsView(who,c),campaignRows<{id:string;version:number;input:{status:string;accountId:string}}>(who.owner,c,'growth_authority',100),campaignRows<GrowthCommitmentRecord>(who.owner,c,'growth_commitment',1000)]);
 return {campaignId:c.id,campaignVersion:c.version,missions,orders,commitments,inventory:operations.inventory,canonicalOrders:operations.orders,authorities:authority,canEdit:who.role!=='member',mayExecute:false,notice:'실제 주문·출고·반품 증빙을 확인해 기록하는 내부 원장입니다. 외부 결제·발주·배송 API를 호출하지 않습니다.'};
}
export async function saveGrowthBundleFulfillment(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(who.role==='member')throw new ApiError(403,'관리자만 번들 이행을 기록합니다.');if(!c.storeId)throw new ApiError(409,'지점이 연결된 캠페인이 필요합니다.');
 if(b.action==='prepare_bundle_mission')return prepareMission(who,c,b);
 if(b.action==='link_bundle_order')return linkOrder(who,c,b);
 if(b.action==='record_bundle_operation')return recordOperation(who,c,b);
 if(b.action==='reconcile_bundle_mission')return reconcileMission(who,c,b);
 throw new ApiError(400,'지원하지 않는 번들 이행 작업입니다.');
}
export type GrowthBundleFulfillmentView=Awaited<ReturnType<typeof growthBundleFulfillmentView>>;
