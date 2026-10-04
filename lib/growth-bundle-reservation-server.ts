import type {Campaign} from './agency';
import type {BundleRecord} from './growth-bundle-server';
import {bundleAssessment,type BundleCatalog} from './growth-bundle';
import {prepareEvent,type InventoryRow} from './growth-operations-server';
import {requireGrowthRunning} from './growth-stop-server';
import {storefrontDigest} from './storefront-orders';
import {optionalRecord} from './growth-ledger-server';
import {growthText} from './growth-mission';
import {ApiError,readRecord,type Actor} from './server';
export type BundleReservation={status:'held'|'released'|'consumed';linkedMissionId?:string;quantity:number;scopeId:string;reservedAt:string;releasedAt?:string;components:{inventoryId:string;inventoryVersion:number;sku:string;unit:string;units:number}[]};
export function parseBundleReservationRequest(b:Record<string,unknown>){
 if(b.confirmed!==true)throw new ApiError(400,'전체 구성 재고의 예약 또는 안전한 해제를 확인하세요.');
 if(!Array.isArray(b.inventories)||!b.inventories.length||b.inventories.length>10)throw new ApiError(400,'구성 재고의 현재 판을 선택하세요.');
 const inventories=b.inventories.map(raw=>{const x=raw as Record<string,unknown>;if(!x||typeof x.inventoryId!=='string'||!/^[-_A-Za-z0-9]{1,100}$/.test(x.inventoryId)||!Number.isSafeInteger(x.version)||Number(x.version)<0)throw new ApiError(400,'재고 ID와 판을 확인하세요.');return {inventoryId:x.inventoryId,version:Number(x.version)}});
 if(new Set(inventories.map(x=>x.inventoryId)).size!==inventories.length)throw new ApiError(400,'같은 공유 재고는 한 번만 선택하세요.');
 const quantity=b.action==='reserve_bundle'?b.quantity:null;
 if(b.action==='reserve_bundle'&&(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<1||quantity>1_000_000))throw new ApiError(400,'예약 번들 수량은 1~1000000 정수입니다.');
 return {quantity:quantity as number|null,inventories,evidenceRef:growthText(b.evidenceRef,'예약·해제 근거 ID',160,true),confirmed:true};
}
export async function prepareBundleReservation(who:Actor,c:Campaign,old:BundleRecord,b:Record<string,unknown>,catalogs:BundleCatalog[],at:string,linkedMissionId?:string){
 const input=parseBundleReservationRequest(b),release=b.action==='release_bundle';
 if(old.reservation?.status==='held'&&old.reservation.linkedMissionId&&old.reservation.linkedMissionId!==linkedMissionId)throw new ApiError(409,'판매 미션에 연결된 예약은 미션 예산 대사에서 해제하세요.');
 if(!release)await requireGrowthRunning(who.owner);
 if(release&&old.reservation?.status!=='held')throw new ApiError(409,'해제할 번들 예약이 없습니다.');
 if(!release&&old.reservation?.status==='held')throw new ApiError(409,'기존 번들 예약을 먼저 해제하세요.');
 const assessment=bundleAssessment({...old.input,plannedQuantity:input.quantity??old.input.plannedQuantity},catalogs);
 if(!release&&(assessment.missing.length||input.quantity!>old.input.plannedQuantity))throw new ApiError(409,assessment.missing.join(' ')||'승인된 계획 수량 이내로 예약하세요.');
 const components=release?old.reservation!.components:assessment.stockAllocation.map(s=>({inventoryId:s.inventoryId,inventoryVersion:s.inventoryVersion!,sku:s.sku,unit:s.unit,units:s.unitsPerBundle*input.quantity!}));
 if(input.inventories.length!==components.length||components.some(s=>!input.inventories.some(i=>i.inventoryId===s.inventoryId)))throw new ApiError(400,'전체 구성 상품의 정확한 공유 재고를 선택하세요.');
 const scopeId=release?old.reservation!.scopeId:'bundle-reservation-'+(await storefrontDigest({campaignId:c.id,bundleId:old.id,version:old.version})).slice(0,32);
 // This internal reservation scope is not a single-offer growth_mission and cannot authorize a sales execution.
 if(await optionalRecord(who.owner,'growth_mission',scopeId))throw new ApiError(409,'판매 미션과 번들 예약 식별자가 충돌합니다.');
 const writes:D1PreparedStatement[]=[];
 for(const component of components){
  const item=await readRecord<InventoryRow>(who.owner,'growth_inventory_item',component.inventoryId),version=input.inventories.find(i=>i.inventoryId===item.id)!.version;
  if(item.brandId!==c.brandId||item.storeId!==c.storeId||item.input.locationId!==c.storeId||item.input.sku!==component.sku||item.input.unit!==component.unit)throw new ApiError(409,'번들 재고의 브랜드·지점·SKU·단위를 대사하세요.');
  if(item.version!==version||(!release&&version!==component.inventoryVersion))throw new ApiError(409,'구성 재고가 변경되었습니다. 전체 최신 판을 다시 확인하세요.');
  const reservationId='bundle-'+(await storefrontDigest({scopeId,inventoryId:item.id})).slice(0,40),eventId='bundle-'+(await storefrontDigest({requestId:b.requestId,inventoryId:item.id})).slice(0,40);
  const fields={kind:release?'release' as const:'reserve' as const,quantity:component.units,reservationId,missionId:scopeId,orderId:'',observedAt:at,evidenceRef:input.evidenceRef,safeRelease:release,returnAccepted:false,disposition:'unknown' as const,restock:false};
  const prepared=await prepareEvent(who,c,item,eventId,await storefrontDigest({bundleId:old.id,fields}),fields,version);
  if(prepared.duplicate)throw new ApiError(409,'번들 예약과 재고 사건을 대사하세요.');
  writes.push(...prepared.writes);
 }
 const reservation:BundleReservation=release?{...old.reservation!,status:'released',releasedAt:at}:{status:'held',quantity:input.quantity!,scopeId,components,reservedAt:at};
 return {reservation,writes};
}
