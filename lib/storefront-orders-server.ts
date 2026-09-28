import type {Store} from './store-marketing';
import type {StoreOrder} from './store-operations';
import {orderInput} from './store-operations-server';
import {storefrontDigest,type StorefrontRow,type StorefrontOrderLink} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp} from './server';
async function maybe<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
// Caller must hold the owner mutation lock; commit returned writes in one batch.
export async function prepareStorefrontImport(owner:string,store:Store,sourceKey:string,rows:StorefrontRow[],actorId:string){
 const writes:ReturnType<typeof recordStatement>[]=[],outcomes:{externalId:string;action:'create'|'update'|'duplicate'|'older';netRevenue:number}[]=[];
 const versions:unknown[]=[];let created=0,updated=0,duplicates=0,older=0;
 for(const row of rows){
  const key=await storefrontDigest([store.id,sourceKey,row.externalId]),digest=await storefrontDigest(row),link=await maybe<StorefrontOrderLink>(owner,'storefront_order_link',key);
  const input=await orderInput({source:'direct',orderNumber:row.externalId,orderDate:row.orderDate,status:row.status,mode:row.mode,paidAmount:row.paidAmount,refundAmount:row.refundAmount,channel:'unknown',note:''},store.id);
  const existing=await maybe<StoreOrder>(owner,'store_order',link?.orderId??input.id);
  versions.push([key,link?.revision??null,link?.digest??null,existing?.version??null]);
  if(link){
   if(link.brandId!==store.brandId||!existing)throw new ApiError(409,'기존 주문 연결이 변경되었습니다. 장부를 확인하세요.');
   if(row.revision<link.revision){older++;outcomes.push({externalId:row.externalId,action:'older',netRevenue:existing.paidAmount-existing.refundAmount});continue}
   if(row.revision===link.revision){if(digest!==link.digest)throw new ApiError(409,'같은 변경 순서에 서로 다른 주문 내용이 있습니다. 원본을 확인하세요.');duplicates++;outcomes.push({externalId:row.externalId,action:'duplicate',netRevenue:existing.paidAmount-existing.refundAmount});continue}
   if(existing.version!==link.orderVersion)throw new ApiError(409,'장부에서 직접 수정한 주문이 있습니다. 외부 값으로 덮어쓰지 않았습니다.');
   if(existing.orderDate!==row.orderDate)throw new ApiError(409,'주문일은 최초 연결 후 변경할 수 없습니다. 원본 주문 ID와 날짜를 확인하세요.');
  }else{
   if(existing)throw new ApiError(409,'같은 주문이 장부에 이미 있습니다. 기존 주문을 확인한 뒤 연결하세요.');
   // A matching source/order number on another date must not become a second purchase.
   const found=await database().prepare("SELECT id FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND json_extract(data,'$.source')='direct' AND json_extract(data,'$.orderNumber')=? LIMIT 1").bind(owner,store.id,row.externalId).first();
   if(found)throw new ApiError(409,'장부에 같은 직접 주문 번호가 있습니다. 중복 등록을 막았습니다.');
  }
  const now=stamp(),order:StoreOrder=existing?{...existing,status:row.status,paidAmount:row.paidAmount,refundAmount:row.refundAmount,mode:row.mode,version:existing.version+1,updatedAt:now}:{...input,version:1,createdAt:now,updatedAt:now};
  const next:StorefrontOrderLink={id:key,storeId:store.id,brandId:store.brandId,sourceKey,externalId:row.externalId,revision:row.revision,digest,orderId:order.id,orderVersion:order.version,updatedAt:now};
  writes.push(recordStatement(owner,'store_order',order.id,order,store.id),recordStatement(owner,'storefront_order_link',key,next,store.id),recordStatement(owner,'storefront_order_revision',key+':'+row.revision,{id:key+':'+row.revision,storeId:store.id,sourceKey,orderId:order.id,externalId:row.externalId,revision:row.revision,orderVersion:order.version,previousOrderVersion:existing?.version??null,status:row.status,paidAmount:row.paidAmount,refundAmount:row.refundAmount,digest,recordedAt:now,recordedBy:actorId},store.id));
  if(existing)updated++;else created++;outcomes.push({externalId:row.externalId,action:existing?'update':'create',netRevenue:order.paidAmount-order.refundAmount});
 }
 const previewKey=await storefrontDigest({storeId:store.id,storeVersion:store.version,sourceKey,rows,versions});
 return {writes,result:{previewKey,created,updated,duplicates,older,outcomes}};
}
