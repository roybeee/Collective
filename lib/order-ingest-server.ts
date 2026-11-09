// 외부 주문 반영(공급자 공통, C7). lib/storefront-orders-server.ts prepareStorefrontImport와 같은 규칙에 장부 출처(source)만 매개변수로 뺐다.
// 기존 외부 몰 호출자는 그대로 두고(동작 변경 없음), POS 공급자는 source 'pos'로 이 경로를 쓴다. 호출자가 소유자 잠금을 잡고, 돌려준 writes를 한 묶음으로 저장한다.
import type {Store} from './store-marketing';
import type {StoreOrder} from './store-operations';
import {orderInput} from './store-operations-server';
import {storefrontDigest,type StorefrontRow,type StorefrontOrderLink} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp} from './server';

export type ExternalOrderSource=Extract<StoreOrder['source'],'direct'|'pos'>;
export type IngestOutcome={externalId:string;action:'create'|'update'|'duplicate'|'older';netRevenue:number};
export type IngestSummary={created:number;updated:number;duplicates:number;older:number};
async function maybe<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const conflict=(message:string)=>new ApiError(409,message);

type Prepared={order:StoreOrder;link:StorefrontOrderLink;existing:StoreOrder|null};
function tally(summary:IngestSummary,action:IngestOutcome['action']):IngestSummary{
 return {...summary,created:summary.created+(action==='create'?1:0),updated:summary.updated+(action==='update'?1:0),duplicates:summary.duplicates+(action==='duplicate'?1:0),older:summary.older+(action==='older'?1:0)};
}
// 기존 연결이 있는 주문의 개정 비교. 같은 개정은 내용이 같아야 중복이고, 오래된 개정은 반영하지 않는다.
function compareRevision(row:StorefrontRow,link:StorefrontOrderLink,digest:string,existing:StoreOrder|null,store:Store):'older'|'duplicate'|'update'{
 if(link.brandId!==store.brandId||!existing)throw conflict('기존 주문 연결이 변경되었습니다. 장부를 확인하세요.');
 if(row.revision<link.revision)return 'older';
 if(row.revision===link.revision){if(digest!==link.digest)throw conflict('같은 변경 순서에 서로 다른 주문 내용이 있습니다. 원본을 확인하세요.');return 'duplicate'}
 if(existing.version!==link.orderVersion)throw conflict('장부에서 직접 수정한 주문이 있습니다. 외부 값으로 덮어쓰지 않았습니다.');
 if(existing.orderDate!==row.orderDate)throw conflict('주문일은 최초 연결 후 변경할 수 없습니다. 원본 주문 ID와 날짜를 확인하세요.');
 return 'update';
}
async function assertNew(owner:string,store:Store,source:ExternalOrderSource,row:StorefrontRow,existing:StoreOrder|null){
 if(existing)throw conflict('같은 주문이 장부에 이미 있습니다. 기존 주문을 확인한 뒤 연결하세요.');
 // 같은 출처·주문번호가 다른 날짜로 들어오면 두 번째 구매로 세지 않는다.
 const found=await database().prepare("SELECT id FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND json_extract(data,'$.source')=? AND json_extract(data,'$.orderNumber')=? LIMIT 1").bind(owner,store.id,source,row.externalId).first();
 if(found)throw conflict('장부에 같은 주문 번호가 있습니다. 중복 등록을 막았습니다.');
}
function statements(owner:string,store:Store,sourceKey:string,row:StorefrontRow,p:Prepared,digest:string,actorId:string,now:string){
 const revisionId=p.link.id+':'+row.revision;
 return [
  recordStatement(owner,'store_order',p.order.id,p.order,store.id),
  recordStatement(owner,'storefront_order_link',p.link.id,p.link,store.id),
  recordStatement(owner,'storefront_order_revision',revisionId,{id:revisionId,storeId:store.id,sourceKey,orderId:p.order.id,externalId:row.externalId,revision:row.revision,orderVersion:p.order.version,previousOrderVersion:p.existing?.version??null,status:row.status,paidAmount:row.paidAmount,refundAmount:row.refundAmount,digest,recordedAt:now,recordedBy:actorId},store.id),
 ];
}
export async function prepareExternalOrderImport(owner:string,store:Store,sourceKey:string,source:ExternalOrderSource,rows:readonly StorefrontRow[],actorId:string){
 let writes:ReturnType<typeof recordStatement>[]=[],outcomes:IngestOutcome[]=[],summary:IngestSummary={created:0,updated:0,duplicates:0,older:0};
 const versions:unknown[]=[];
 for(const row of rows){
  const key=await storefrontDigest([store.id,sourceKey,row.externalId]),digest=await storefrontDigest(row),link=await maybe<StorefrontOrderLink>(owner,'storefront_order_link',key);
  const input=await orderInput({source,orderNumber:row.externalId,orderDate:row.orderDate,status:row.status,mode:row.mode,paidAmount:row.paidAmount,refundAmount:row.refundAmount,channel:'unknown',note:''},store.id);
  const existing=await maybe<StoreOrder>(owner,'store_order',link?.orderId??input.id);
  versions.push([key,link?.revision??null,link?.digest??null,existing?.version??null]);
  const action=link?compareRevision(row,link,digest,existing,store):'create';
  if(action==='create')await assertNew(owner,store,source,row,existing);
  if(action==='older'||action==='duplicate'){summary=tally(summary,action);outcomes=[...outcomes,{externalId:row.externalId,action,netRevenue:existing!.paidAmount-existing!.refundAmount}];continue}
  const now=stamp(),order:StoreOrder=existing?{...existing,status:row.status,paidAmount:row.paidAmount,refundAmount:row.refundAmount,mode:row.mode,version:existing.version+1,updatedAt:now}:{...input,version:1,createdAt:now,updatedAt:now};
  const next:StorefrontOrderLink={id:key,storeId:store.id,brandId:store.brandId,sourceKey,externalId:row.externalId,revision:row.revision,digest,orderId:order.id,orderVersion:order.version,updatedAt:now};
  writes=[...writes,...statements(owner,store,sourceKey,row,{order,link:next,existing},digest,actorId,now)];
  summary=tally(summary,action);outcomes=[...outcomes,{externalId:row.externalId,action,netRevenue:order.paidAmount-order.refundAmount}];
 }
 const previewKey=await storefrontDigest({storeId:store.id,storeVersion:store.version,sourceKey,source,rows,versions});
 return {writes,result:{previewKey,...summary,outcomes}};
}
