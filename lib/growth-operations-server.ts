import {bundleOrderMoneyRows} from './growth-bundle-order-bridge';
import {assertSettlementCashIdentity} from './growth-cash-server';
import {assertGrowthPublicationRelease} from './growth-publication-server';
import {buildOperationReview} from './growth-operation-review';
import type {ExecutionIntent} from './growth-execution-server';
import {catalogStocks,requireCatalogInventoryIdentity} from './growth-stock-readiness-server';
import {requireGrowthRunning} from './growth-stop-server';
import {parseSettlementEvidence,projectSettlements,type SettlementEvidence} from './growth-settlement';
import type {Campaign} from './agency';
import type {Store} from './store-marketing';
import type {StoreOrder} from './store-operations';
import {parseInventoryInput,projectInventory,transitionInventory,type InventoryInput,type InventoryEvent} from './growth-inventory';
import {parseOrderLineInput,validateOrderAllocations,validateOrderMoneyAllocations,type OrderLineInput} from './growth-order-bridge';
import {growthText,type MissionInput} from './growth-mission';
import type {GrowthRecord} from './growth-workspace-server';
import type {OfferInput,CatalogInput} from './growth-catalog';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';

type SettlementRow={id:string;brandId:string;storeId:string;campaignId:string;input:SettlementEvidence;requestDigest:string;recordedAt:string;recordedBy:string};
export type InventoryRow={id:string;brandId:string;storeId:string;input:InventoryInput;version:number;createdAt:string;createdBy:string};
type StockRow=InventoryEvent&{inventoryId:string;brandId:string;storeId:string;campaignId:string;requestDigest:string};
type LineRow={id:string;brandId:string;storeId:string;campaignId:string;version:number;input:OrderLineInput;requestDigest:string;updatedAt:string;updatedBy:string;snapshot:{mission:MissionInput;offer:OfferInput;catalog:CatalogInput}};
async function rows<T>(owner:string,kind:string,parentId:string,limit=1000):Promise<T[]>{
 const result=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT ?').bind(owner,kind,parentId,limit+1).all<{data:string}>();
 if(result.results.length>limit)throw new ApiError(409,'운영 기록 한도를 넘었습니다. 전체 이력 대사 전 새 작업을 중단합니다.');
 return result.results.map(r=>JSON.parse(r.data) as T);
}
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function id(value:unknown,label:string){const result=str(value,label,100,true);if(!/^[A-Za-z0-9_-]+$/.test(result))throw new ApiError(400,`${label} 형식을 확인하세요.`);return result}
async function storeFor(owner:string,c:Campaign){
 if(!c.storeId)throw new ApiError(409,'주문과 재고를 관리할 지점을 캠페인에 연결하세요.');
 const store=await readRecord<Store>(owner,'store',c.storeId);if(store.brandId!==c.brandId)throw new ApiError(404,'현재 브랜드의 지점을 찾지 못했습니다.');return store;
}
function scope(row:{brandId:string;storeId:string},c:Campaign){if(row.brandId!==c.brandId||row.storeId!==c.storeId)throw new ApiError(404,'현재 브랜드·지점의 운영 기록을 찾지 못했습니다.')}
async function inventoryFor(owner:string,c:Campaign,inventoryId:string){const row=await readRecord<InventoryRow>(owner,'growth_inventory_item',inventoryId);scope(row,c);return row}
async function stockEvents(owner:string,row:InventoryRow){
 const events=await rows<StockRow>(owner,'growth_stock_event',row.id,5000);
 if(events.some(e=>e.brandId!==row.brandId||e.storeId!==row.storeId||e.inventoryId!==row.id))throw new ApiError(409,'재고 이벤트 범위를 대사하세요.');
 return [...events].sort((a,b)=>a.version-b.version);
}
async function orderFor(owner:string,c:Campaign,orderId:string){const order=await readRecord<StoreOrder>(owner,'store_order',orderId);if(order.storeId!==c.storeId)throw new ApiError(404,'현재 지점의 주문을 찾지 못했습니다.');return order}
async function storeLines(owner:string,c:Campaign){const lines=await rows<LineRow>(owner,'growth_order_line',c.storeId!);for(const row of lines)scope(row,c);return lines}
export async function growthOperationsView(who:Actor,c:Campaign){
 if(!c.storeId)return {available:false,reason:'주문 장부의 지점을 캠페인에 연결하세요.',inventory:[],orders:[],orderLines:[],campaignVersion:c.version,canEdit:false,mayExecute:false};
 await storeFor(who.owner,c);
 const [items,orders,lines]=await Promise.all([rows<InventoryRow>(who.owner,'growth_inventory_item',c.storeId,500),rows<StoreOrder>(who.owner,'store_order',c.storeId),storeLines(who.owner,c)]);
 const inventory=await Promise.all(items.map(async row=>{scope(row,c);return {...row,projection:projectInventory(row.input,await stockEvents(who.owner,row))}}));
 const settlements=await rows<SettlementRow>(who.owner,'growth_settlement',c.storeId);for(const row of settlements)scope(row,c);
 const campaignSettlements=settlements.filter(r=>r.campaignId===c.id);
 const settlement=projectSettlements(orders.filter(o=>campaignSettlements.some(r=>r.input.orderId===o.id)),campaignSettlements.map(r=>r.input),stamp());
 const orderLines=lines.filter(l=>l.campaignId===c.id).map(row=>{const order=orders.find(o=>o.id===row.input.orderId&&o.storeId===c.storeId);return {...row,allocation:order?validateOrderAllocations(order,lines.filter(l=>l.input.orderId===order.id).map(l=>l.input)):{status:'reconciliation_required',netAllocated:null,reasons:['연결 주문을 찾지 못했습니다.']}}});
 return {available:true,review:buildOperationReview({campaignId:c.id,brandId:c.brandId,storeId:c.storeId,orders,orderLines,inventory},Date.now()),storeId:c.storeId,reason:'운영자가 근거를 확인해 기록한 내부 운영 장부입니다. 외부 판매자·배송·은행 조회는 수행하지 않습니다.',inventory,orderLines,settlement,orders:orders.filter(o=>o.storeId===c.storeId).map(o=>({id:o.id,version:o.version,orderDate:o.orderDate,status:o.status,paidAmount:o.paidAmount,refundAmount:o.refundAmount,campaignId:o.campaignId??null})),campaignVersion:c.version,canEdit:who.role!=='member',mayExecute:false};
}
function insert(who:Actor,kind:string,row:{id:string},parent:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:${kind}:${row.id}`,who.owner,kind,parent,JSON.stringify(row),stamp())}
type EventFields=Pick<InventoryEvent,'kind'|'quantity'|'reservationId'|'missionId'|'orderId'|'observedAt'|'evidenceRef'|'safeRelease'|'returnAccepted'|'disposition'|'restock'>;
export async function prepareEvent(who:Actor,c:Campaign,item:InventoryRow,eventId:string,requestDigest:string,fields:EventFields,expectedVersion?:unknown){
 const events=await stockEvents(who.owner,item),existing=events.find(e=>e.id===eventId);
 if(existing){if(existing.requestDigest!==requestDigest)throw new ApiError(409,'같은 운영 사건 ID의 내용이 다릅니다.');return {duplicate:true,writes:[],projection:projectInventory(item.input,events)}}
 if(expectedVersion!==undefined&&expectedVersion!==item.version)throw new ApiError(409,'재고가 변경되었습니다. 최신 수량을 다시 확인하세요.');
 if(await optional<StockRow>(who.owner,'growth_stock_event',eventId))throw new ApiError(409,'다른 재고에 사용한 사건 ID입니다.');
 if(events.length>=5000)throw new ApiError(409,'재고 이벤트 한도에 도달했습니다.');
 const at=stamp(),event:StockRow={...fields,id:eventId,digest:requestDigest,version:item.version+1,recordedAt:at,inventoryId:item.id,brandId:c.brandId,storeId:item.storeId,campaignId:c.id,requestDigest};
 let projection;try{projection=transitionInventory(item.input,events,event)}catch(e){throw new ApiError(409,(e as Error).message)}
 return {duplicate:false,projection,writes:[recordStatement(who.owner,'growth_inventory_item',item.id,{...item,version:event.version},item.storeId),insert(who,'growth_stock_event',event,item.id)]};
}
function quantity(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new ApiError(400,'수량은 0 이상의 정수여야 합니다.');return value}
function inventoryVersion(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new ApiError(400,'재고 판을 확인하세요.');return value}
function flag(value:unknown){if(value===undefined)return false;if(typeof value!=='boolean')throw new ApiError(400,'확인값은 참 또는 거짓이어야 합니다.');return value}
function basicEvent(kind:InventoryEvent['kind'],quantity:number,observedAt:string,evidenceRef:string):EventFields{return {kind,quantity,observedAt,evidenceRef,reservationId:'',missionId:'',orderId:'',safeRelease:false,returnAccepted:false,disposition:'unknown',restock:false}}
async function createInventory(who:Actor,c:Campaign,b:Record<string,unknown>){
 const input=parseInventoryInput(b.input);if(input.locationId!==c.storeId)throw new ApiError(400,'이번 지점의 재고 위치를 선택하세요.');
 const key='inv-'+(await storefrontDigest([c.brandId,c.storeId,input.sku])).slice(0,32),old=await optional<InventoryRow>(who.owner,'growth_inventory_item',key);
 if(old)throw new ApiError(409,'이 상품·위치의 공유 재고가 이미 있습니다. 재고 재확인으로 갱신하세요.');
 const siblings=await rows<InventoryRow>(who.owner,'growth_inventory_item',c.storeId!,500);if(siblings.some(i=>i.input.sku===input.sku))throw new ApiError(409,'같은 SKU의 공유 재고가 이미 있습니다. 기존 장부를 대사하세요.');
 if(siblings.length>=500)throw new ApiError(409,'지점별 재고 상품은 500개까지 등록할 수 있습니다.');
 const item:InventoryRow={id:key,brandId:c.brandId,storeId:c.storeId!,input:{...input,onHand:null},version:0,createdAt:stamp(),createdBy:who.id};
 if(input.onHand===null){await recordStatement(who.owner,'growth_inventory_item',key,item,c.storeId!).run();return growthOperationsView(who,c)}
 const observedAt=str(b.observedAt,'재고 확인 시각',40,true),evidenceRef=growthText(b.evidenceRef,'재고 근거',200,true),fields=basicEvent('stocktake',input.onHand,observedAt,evidenceRef),digest=await storefrontDigest({inventoryId:key,...fields});
 const prepared=await prepareEvent(who,c,item,'opening-'+key,digest,fields);await database().batch(prepared.writes);return growthOperationsView(who,c);
}
async function lineContext(who:Actor,c:Campaign,input:OrderLineInput){
 const [order,inventory,mission,offer]=await Promise.all([orderFor(who.owner,c,input.orderId),inventoryFor(who.owner,c,input.inventoryId),readRecord<GrowthRecord<MissionInput>>(who.owner,'growth_mission',input.missionId),readRecord<GrowthRecord<OfferInput>>(who.owner,'growth_offer',input.offerId)]);
 for(const row of [mission,offer])if(row.campaignId!==c.id||row.brandId!==c.brandId)throw new ApiError(404,'현재 캠페인의 판매 미션·오퍼를 선택하세요.');
 if(order.version!==input.orderVersion||mission.version!==input.missionVersion||offer.version!==input.offerVersion||mission.input.offerId!==offer.id||mission.input.offerVersion!==offer.version)throw new ApiError(409,'주문·미션·오퍼의 최신 판을 확인하세요.');
 const catalog=await readRecord<GrowthRecord<CatalogInput>>(who.owner,'growth_catalog',offer.input.catalogId);
 if(catalog.campaignId!==c.id||catalog.brandId!==c.brandId)throw new ApiError(404,'현재 캠페인의 상품을 찾지 못했습니다.');
 if(catalog.version!==offer.input.catalogVersion||catalog.input.sku!==inventory.input.sku)throw new ApiError(409,'상품의 SKU와 공유 재고 연결을 확인하세요.');
 return {order,inventory,mission,offer,catalog};
}
async function linkOrder(who:Actor,c:Campaign,b:Record<string,unknown>){
 const input=parseOrderLineInput({...b.input as Record<string,unknown>,source:'operator_attested'}),key='line-'+(await storefrontDigest([c.storeId,input.orderId,input.sourceKey,input.accountId,input.externalLineId])).slice(0,32);
 const digest=await storefrontDigest({input,expectedVersion:b.expectedVersion}),old=await optional<LineRow>(who.owner,'growth_order_line',key);
 if(old){scope(old,c);if(old.campaignId!==c.id)throw new ApiError(409,'이 품목은 다른 캠페인에 연결되어 있습니다.');if(old.requestDigest===digest)return {...await growthOperationsView(who,c),duplicate:true}}
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'품목 연결이 변경되었습니다.');
 if(old&&(['inventoryId','units','missionId','missionVersion','offerId','offerVersion'] as const).some(k=>old.input[k]!==input[k]))throw new ApiError(409,'이미 할당한 품목의 재고·수량·미션을 바꿀 수 없습니다. 이행 대사가 필요합니다.');
 const context=old?{order:await orderFor(who.owner,c,input.orderId),inventory:await inventoryFor(who.owner,c,input.inventoryId),mission:{input:old.snapshot.mission},offer:{input:old.snapshot.offer},catalog:{input:old.snapshot.catalog}}:await lineContext(who,c,input),lines=await storeLines(who.owner,c);
 if(context.order.version!==input.orderVersion)throw new ApiError(409,'최신 주문 판을 확인하세요.');
 if(!old&&lines.length>=1000)throw new ApiError(409,'지점별 품목 연결 한도에 도달했습니다.');
 const bundleLines=await bundleOrderMoneyRows(who.owner,c);
 const allocation=validateOrderMoneyAllocations(context.order,[...lines.filter(l=>l.id!==key&&l.input.orderId===input.orderId).map(l=>l.input),...bundleLines.filter(l=>l.input.orderId===input.orderId).map(l=>l.input),input]);
 if(allocation.status==='invalid')throw new ApiError(409,allocation.reasons.join(' '));
 const record:LineRow={id:key,campaignId:c.id,brandId:c.brandId,storeId:c.storeId!,version:(old?.version??0)+1,input,requestDigest:digest,updatedAt:stamp(),updatedBy:who.id,snapshot:{mission:context.mission.input,offer:context.offer.input,catalog:context.catalog.input}};
 const writes=[recordStatement(who.owner,'growth_order_line',key,record,c.storeId!),insert(who,'growth_order_line_history',{...record,id:`${key}:v${record.version}`},c.id)];
 if(!old){await requireCatalogInventoryIdentity(who.owner,c,context.catalog.input,context.inventory.id);const projection=projectInventory(context.inventory.input,await stockEvents(who.owner,context.inventory)),reservation=projection.reservations.find(r=>r.missionId===input.missionId&&r.held>0);
  const fields={...basicEvent('allocate',input.units,stamp(),input.evidenceRef),orderId:key,reservationId:reservation?.reservationId??'',missionId:reservation?input.missionId:''};
  const prepared=await prepareEvent(who,c,context.inventory,'line-'+key,await storefrontDigest({lineId:key,input}),fields);if(prepared.duplicate)throw new ApiError(409,'품목 연결과 재고 이력을 대사하세요.');writes.push(...prepared.writes);
 }
 await database().batch(writes);return {...await growthOperationsView(who,c),duplicate:false};
}
async function recordOperation(who:Actor,c:Campaign,b:Record<string,unknown>){
 const line=await readRecord<LineRow>(who.owner,'growth_order_line',id(b.lineId,'품목 연결 ID'));scope(line,c);if(line.campaignId!==c.id)throw new ApiError(404,'현재 캠페인의 품목 연결을 찾지 못했습니다.');
 if(!['ship','release','refund','return'].includes(String(b.kind)))throw new ApiError(400,'지원하지 않는 이행 작업입니다.');
 const currentOrder=await orderFor(who.owner,c,line.input.orderId);
 const item=await inventoryFor(who.owner,c,line.input.inventoryId),events=await stockEvents(who.owner,item),projection=projectInventory(item.input,events),order=projection.orders.find(o=>o.orderId===line.id);
 if(!order)throw new ApiError(409,'주문 재고 할당을 먼저 확인하세요.');
 const eventId=id(b.id,'운영 사건 ID'),fields={...basicEvent(b.kind as InventoryEvent['kind'],quantity(b.quantity),str(b.observedAt,'관측 시각',40,true),growthText(b.evidenceRef,'이행 근거',200,true)),orderId:line.id,reservationId:order.reservationId,missionId:order.missionId,safeRelease:flag(b.safeRelease),returnAccepted:flag(b.returnAccepted),disposition:(b.disposition??'unknown') as InventoryEvent['disposition'],restock:flag(b.restock)};
 const duplicate=events.some(e=>e.id===eventId);
 if(!duplicate&&b.kind==='ship'&&(currentOrder.version!==line.input.orderVersion||currentOrder.status==='cancelled'||currentOrder.status==='refunded'||(currentOrder.paidAmount>0&&currentOrder.refundAmount>=currentOrder.paidAmount)))throw new ApiError(409,'출고 전에 최신 주문의 취소·환불과 품목 배분을 대사하세요.');
 const prepared=await prepareEvent(who,c,item,eventId,await storefrontDigest({lineId:line.id,...fields}),fields,inventoryVersion(b.inventoryVersion));
 if(!prepared.duplicate)await database().batch(prepared.writes);return {...await growthOperationsView(who,c),duplicate:prepared.duplicate};
}
async function stockAdjustment(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(!['stocktake','receive'].includes(String(b.kind)))throw new ApiError(400,'재고 실사 또는 입고를 선택하세요.');
 const item=await inventoryFor(who.owner,c,id(b.inventoryId,'재고 ID'));
 const fields=basicEvent(b.kind as InventoryEvent['kind'],quantity(b.quantity),str(b.observedAt,'확인 시각',40,true),growthText(b.evidenceRef,'재고 근거',160,true));
 const prepared=await prepareEvent(who,c,item,id(b.id,'재고 사건 ID'),await storefrontDigest({inventoryId:item.id,...fields}),fields,inventoryVersion(b.inventoryVersion));
 if(!prepared.duplicate)await database().batch(prepared.writes);return {...await growthOperationsView(who,c),duplicate:prepared.duplicate};
}
export async function prepareMissionStock(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.action!=='release_stock')await requireGrowthRunning(who.owner);
 const item=await inventoryFor(who.owner,c,id(b.inventoryId,'재고 ID')),mission=await readRecord<GrowthRecord<MissionInput>>(who.owner,'growth_mission',id(b.missionId,'미션 ID'));
 if(mission.campaignId!==c.id||mission.brandId!==c.brandId)throw new ApiError(404,'현재 캠페인의 미션을 선택하세요.');
 const release=b.action==='release_stock',eventId=id(b.id,'재고 사건 ID');
 if(release){const intents=await rows<ExecutionIntent>(who.owner,'growth_action_intent',c.id);for(const intent of intents.filter(i=>i.input.missionId===mission.id))await assertGrowthPublicationRelease(who.owner,c,intent);if(intents.some(row=>row.input.missionId===mission.id&&row.state!=='failed'))throw new ApiError(409,'실행 결과가 실패로 확인되기 전에는 연결 재고를 해제할 수 없습니다.');}
 const fields={...basicEvent(release?'release':'reserve',quantity(b.quantity),str(b.observedAt,'확인 시각',40,true),growthText(b.evidenceRef,'예약 근거',160,true)),reservationId:release?id(b.reservationId,'예약 ID'):eventId,missionId:mission.id,safeRelease:release?flag(b.safeRelease):false};
 const events=await stockEvents(who.owner,item),duplicate=events.some(e=>e.id===eventId);
 if(!duplicate){
  if(b.missionVersion!==mission.version)throw new ApiError(409,'미션이 변경되었습니다.');
  if(release){if(!['cancelled','failed'].includes(mission.status??''))throw new ApiError(409,'취소·실패가 확인된 미션의 미배정 재고만 해제하세요.');}
  else{
   if(c.status==='archived'||mission.status!=='staged')throw new ApiError(409,'판매 준비 중인 미션만 재고를 예약할 수 있습니다.');
   const offer=await readRecord<GrowthRecord<OfferInput>>(who.owner,'growth_offer',mission.input.offerId),catalog=await readRecord<GrowthRecord<CatalogInput>>(who.owner,'growth_catalog',offer.input.catalogId);
   if([offer,catalog].some(r=>r.campaignId!==c.id||r.brandId!==c.brandId))throw new ApiError(404,'현재 캠페인의 상품을 선택하세요.');
   if(offer.version!==mission.input.offerVersion||catalog.version!==offer.input.catalogVersion||catalog.input.sku!==item.input.sku)throw new ApiError(409,'최신 상품·오퍼와 재고 SKU를 확인하세요.');
   const [stock]=await catalogStocks(who.owner,c,[catalog.input]);if(stock.status!=='known'||stock.inventoryId!==item.id||stock.inventoryVersion!==b.inventoryVersion||stock.available===null||fields.quantity>stock.available)throw new ApiError(409,'현재 단일 공유 재고·수량 단위·판·가용 수량을 다시 확인하세요.');
   if(projectInventory(item.input,events).reservations.some(r=>r.missionId===mission.id&&(b.requireNoPriorReservation===true||r.held>0)))throw new ApiError(409,'미션의 기존 재고 예약을 먼저 대사하세요.');
  }
 }
 const prepared=await prepareEvent(who,c,item,eventId,await storefrontDigest({inventoryId:item.id,...fields}),fields,inventoryVersion(b.inventoryVersion));
 return {...prepared,item,reservationId:fields.reservationId};
}
async function reserveStock(who:Actor,c:Campaign,b:Record<string,unknown>){
 const prepared=await prepareMissionStock(who,c,b);
 if(!prepared.duplicate)await database().batch(prepared.writes);return {...await growthOperationsView(who,c),duplicate:prepared.duplicate};
}
async function saveSettlement(who:Actor,c:Campaign,b:Record<string,unknown>){
 const input=parseSettlementEvidence({...b.input as Record<string,unknown>,origin:'operator_attested'},stamp());
 const key='settle-'+(await storefrontDigest([c.storeId,input.eventId])).slice(0,32),digest=await storefrontDigest(input);
 const all=await rows<SettlementRow>(who.owner,'growth_settlement',c.storeId!),old=all.find(r=>r.id===key);
 for(const row of all)scope(row,c);
 if(old){if(old.campaignId!==c.id)throw new ApiError(409,'다른 캠페인의 정산 사건입니다.');if(old.requestDigest===digest)return {...await growthOperationsView(who,c),duplicate:true};}
 if(input.revision!==(old?.input.revision??0)+1)throw new ApiError(409,'최신 정산 증빙 판을 확인하세요.');
 await assertSettlementCashIdentity(who.owner,input,key);
 const order=await orderFor(who.owner,c,input.orderId);
 if(order.version!==input.orderVersion)throw new ApiError(409,'최신 주문을 확인해 정산 증빙을 연결하세요.');
 if(!old&&all.length>=1000)throw new ApiError(409,'정산 사건 한도에 도달했습니다.');
 projectSettlements([order],[...all.map(r=>r.input),input],stamp());
 const record:SettlementRow={id:key,brandId:c.brandId,storeId:c.storeId!,campaignId:c.id,input,requestDigest:digest,recordedAt:stamp(),recordedBy:who.id};
 await database().batch([recordStatement(who.owner,'growth_settlement',key,record,c.storeId!),insert(who,'growth_settlement_history',{...record,id:`${key}:v${input.revision}`},c.id)]);
 return {...await growthOperationsView(who,c),duplicate:false};
}
export async function saveGrowthOperations(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다.');
 await storeFor(who.owner,c);
 if(b.action==='save_settlement')return saveSettlement(who,c,b);
 if(b.action==='stock_adjust')return stockAdjustment(who,c,b);
 if(b.action==='reserve_stock'||b.action==='release_stock')return reserveStock(who,c,b);
 if(b.action==='create_inventory')return createInventory(who,c,b);
 if(b.action==='link_order')return linkOrder(who,c,b);
 if(b.action==='record_operation')return recordOperation(who,c,b);
 throw new ApiError(400,'지원하지 않는 운영 작업입니다.');
}
