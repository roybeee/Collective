import type {Campaign} from './agency';
import type {StoreOrder} from './store-operations';
import type {Store} from './store-marketing';
import {consumerAssessment,consumerEvidence,consentActive,emptyConsumerConsents,parseConsent,parseWaitDays,type ConsumerConsents,type ConsumerOrder} from './growth-consumer';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
const kinds={customer:'growth_customer',consent:'growth_consumer_consent',link:'growth_consumer_order_link',history:'growth_consumer_order_history',request:'growth_consumer_request'} as const;
function appendStatement(owner:string,kind:string,id:string,data:unknown,parentId:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,parentId,JSON.stringify(data),stamp())}
export type ConsumerCustomer={id:string;brandId:string;version:number;state:'active';consents:ConsumerConsents;createdAt:string;updatedAt:string};
type Tombstone={id:string;brandId:string;version:number;state:'erased'};
export type ConsumerOrderLink={id:string;brandId:string;customerId:string;storeId:string;orderId:string;orderVersion:number;version:number;evidenceRef:string;updatedAt:string};
type RequestRecord={id:string;brandId:string;customerId:string;digest?:string;erased?:boolean};
function scoped<T extends {brandId:string}>(row:T,c:Campaign){if(row.brandId!==c.brandId)throw new ApiError(404,'현재 브랜드의 기록이 아닙니다.');return row}
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function rows<T>(owner:string,kind:string,brand:string){const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT 501').bind(owner,kind,brand).all<{data:string}>();if(r.results.length>500)throw new ApiError(409,'브랜드 기록 한도를 넘었습니다. 대사가 필요합니다.');return r.results.map(x=>JSON.parse(x.data) as T)}
async function storeOrders(who:Actor,c:Campaign){
 if(!c.storeId)return [];
 const store=await readRecord<Store>(who.owner,'store',c.storeId);scoped(store,c);
 const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT 501').bind(who.owner,'store_order',c.storeId).all<{data:string}>();
 if(r.results.length>500)throw new ApiError(409,'매장 주문이 500건을 넘습니다. 범위별 대사가 필요합니다.');
 return r.results.map(x=>JSON.parse(x.data) as StoreOrder).filter(o=>o.storeId===c.storeId).map(o=>({id:o.id,version:o.version,orderDate:o.orderDate,status:o.status,paidAmount:o.paidAmount,refundAmount:o.refundAmount} satisfies ConsumerOrder));
}
async function orderView(who:Actor,c:Campaign){
 try{const orders=await storeOrders(who,c);return {orders,orderAvailability:c.storeId?'available':'unavailable'} as const}
 catch(e){if(e instanceof ApiError&&(e.status===404||e.status===409))return {orders:[] as ConsumerOrder[],orderAvailability:'unavailable' as const};throw e}
}
export async function growthConsumerView(who:Actor,c:Campaign,waitDays=30){
 parseWaitDays(waitDays);
 const [all,links,orderState]=await Promise.all([rows<ConsumerCustomer|Tombstone>(who.owner,kinds.customer,c.brandId),rows<ConsumerOrderLink>(who.owner,kinds.link,c.brandId),orderView(who,c)]),{orders,orderAvailability}=orderState;
 const customers=all.filter((x):x is ConsumerCustomer=>x.state==='active').map(customer=>{
  scoped(customer,c);const current=consentActive(customer.consents.identity_link)?links.filter(l=>l.customerId===customer.id&&l.storeId===c.storeId&&l.brandId===c.brandId):[];
  const assessment=consumerAssessment(customer.consents,current.map(l=>({order:orders.find(o=>o.id===l.orderId)??null,orderVersion:l.orderVersion})),waitDays);
  return {...customer,links:current,assessment:orderAvailability==='available'?assessment:{...assessment,postPurchaseEligible:false,reorderEligible:false,reasons:[...assessment.reasons,'현재 매장 주문 조회 불가·범위 대사 필요']}};
 });
 return {customers,orders,orderAvailability,campaignVersion:c.version,storeId:c.storeId??null,waitDays,canEdit:c.status!=='archived',maySend:false as const,mayExecute:false as const};
}
export type ConsumerView=Awaited<ReturnType<typeof growthConsumerView>>;
function uuid(v:unknown){if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))throw new ApiError(400,'요청 ID는 무작위 UUID여야 합니다.');return v.toLowerCase()}
function validateFields(b:Record<string,unknown>){
 const common=['action','campaignId','campaignVersion','expectedVersion','requestId','waitDays'];
 const specific:Record<string,string[]>={create_customer:[],set_consent:['customerId','purpose','state','noticeVersion','evidenceRef','observedAt','expiresAt'],link_order:['customerId','orderId','orderVersion','evidenceRef'],erase_customer:['customerId']};
 const allowed=specific[String(b.action)];if(!allowed||Object.keys(b).some(k=>![...common,...allowed].includes(k)))throw new ApiError(400,'지원하지 않는 작업 또는 개인정보 필드입니다.');
}
async function capacity(owner:string,kind:string,brand:string,max:number){const r=await database().prepare('SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,brand).first<{n:number}>();if((r?.n??0)>=max)throw new ApiError(409,'브랜드 기록 한도에 도달했습니다. 새 기록 전에 대사하세요.')}
async function erase(who:Actor,c:Campaign,old:ConsumerCustomer|Tombstone,requestId:string){
 const statements=[recordStatement(who.owner,kinds.customer,old.id,{id:old.id,brandId:c.brandId,version:old.version+1,state:'erased'},c.brandId)];
 for(const kind of [kinds.consent,kinds.link,kinds.history])statements.push(database().prepare("DELETE FROM records WHERE owner=? AND kind=? AND parent_id=? AND json_extract(data,'$.customerId')=?").bind(who.owner,kind,c.brandId,old.id));
 // Keep request IDs as suppression tombstones, but remove payload digests and linking evidence.
 statements.push(database().prepare("UPDATE records SET data=json_object('id',id,'brandId',?,'customerId',?,'erased',json('true')) WHERE owner=? AND kind=? AND parent_id=? AND json_extract(data,'$.customerId')=?").bind(c.brandId,old.id,who.owner,kinds.request,c.brandId,old.id));
 statements.push(appendStatement(who.owner,kinds.request,requestId,{id:requestId,brandId:c.brandId,customerId:old.id,erased:true},c.brandId));
 await database().batch(statements);
}
async function linkOrder(who:Actor,c:Campaign,customer:ConsumerCustomer,b:Record<string,unknown>,at:string){
 if(!consentActive(customer.consents.identity_link))throw new ApiError(409,'주문 연결 목적의 현재 동의가 필요합니다.');
 const orderId=str(b.orderId,'주문',100,true),order=await readRecord<StoreOrder>(who.owner,'store_order',orderId);
 if(!c.storeId||order.storeId!==c.storeId)throw new ApiError(404,'현재 캠페인 매장의 주문이 아닙니다.');
 if(order.version!==b.orderVersion)throw new ApiError(409,'주문이 변경되었습니다. 최신 판을 확인하세요.');
 const store=await readRecord<Store>(who.owner,'store',c.storeId);scoped(store,c);
 const id=await storefrontDigest({brandId:c.brandId,storeId:c.storeId,orderId}),old=await optional<ConsumerOrderLink>(who.owner,kinds.link,id);
 if(old&&(old.customerId!==customer.id||old.brandId!==c.brandId))throw new ApiError(409,'이미 다른 고객에게 연결된 주문입니다.');
 if(!old)await capacity(who.owner,kinds.link,c.brandId,500);
 await capacity(who.owner,kinds.history,c.brandId,5000);
 const evidenceRef=consumerEvidence(b.evidenceRef,'연결 근거');
 const row:ConsumerOrderLink={id,brandId:c.brandId,customerId:customer.id,storeId:c.storeId,orderId,orderVersion:order.version,version:(old?.version??0)+1,evidenceRef,updatedAt:at};
 return [recordStatement(who.owner,kinds.link,id,row,c.brandId),appendStatement(who.owner,kinds.history,crypto.randomUUID(),row,c.brandId)];
}
export async function saveGrowthConsumer(who:Actor,c:Campaign,b:Record<string,unknown>){
 validateFields(b);const requestId=uuid(b.requestId),waitDays=parseWaitDays(b.waitDays??30);
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다.');
 const digest=await storefrontDigest(b),previous=await optional<RequestRecord>(who.owner,kinds.request,requestId);
 if(previous){
  scoped(previous,c);
  if(previous.erased){const tomb=await readRecord<Tombstone>(who.owner,kinds.customer,previous.customerId);return {erased:true,duplicate:true,customerId:tomb.id,version:tomb.version,campaignVersion:c.version,maySend:false,mayExecute:false};}
  if(previous.digest!==digest)throw new ApiError(409,'같은 요청 ID의 내용이 변경되었습니다.');
  if(b.action==='set_consent'&&b.state==='revoked'){
   const current=await readRecord<ConsumerCustomer|Tombstone>(who.owner,kinds.customer,previous.customerId);
   const purpose=b.purpose as keyof ConsumerConsents;
   if(current.state==='active'&&current.consents[purpose]?.state==='revoked')return {withdrawn:true,duplicate:true,customerId:current.id,version:current.version,campaignVersion:c.version,maySend:false,mayExecute:false};
  }
  return {...await growthConsumerView(who,c,waitDays),duplicate:true,resultCustomerId:previous.customerId};
 }
 const withdrawing=b.action==='erase_customer'||(b.action==='set_consent'&&b.state==='revoked');
 if(c.status==='archived'&&!withdrawing)throw new ApiError(409,'보관 캠페인은 철회·삭제만 가능합니다.');
 const at=stamp();let resultCustomerId='';
 if(b.action==='create_customer'){
  if(b.expectedVersion!==0)throw new ApiError(409,'새 고객의 판은 0이어야 합니다.');
  await capacity(who.owner,kinds.customer,c.brandId,500);await capacity(who.owner,kinds.request,c.brandId,10000);
  // Read scope/capacity before committing; a view failure must not conceal a successful write.
  await growthConsumerView(who,c,waitDays);
  const id=crypto.randomUUID(),row:ConsumerCustomer={id,brandId:c.brandId,version:1,state:'active',consents:emptyConsumerConsents(),createdAt:at,updatedAt:at};
  resultCustomerId=id;
  await database().batch([appendStatement(who.owner,kinds.customer,id,row,c.brandId),appendStatement(who.owner,kinds.request,requestId,{id:requestId,brandId:c.brandId,customerId:id,digest},c.brandId)]);
 }else{
  const old=scoped(await readRecord<ConsumerCustomer|Tombstone>(who.owner,kinds.customer,str(b.customerId,'고객',100,true)),c);
  resultCustomerId=old.id;
  if(old.version!==b.expectedVersion)throw new ApiError(409,'고객 기록이 변경되었습니다. 최신 판과 비교하세요.');
  if(b.action==='erase_customer'){await erase(who,c,old,requestId);return {erased:true,customerId:old.id,version:old.version+1,campaignVersion:c.version,maySend:false,mayExecute:false};}
  if(old.state!=='active')throw new ApiError(409,'삭제한 고객은 다시 활성화할 수 없습니다.');
  const statements=[];
  let consents=old.consents;
  if(b.action==='set_consent'){
   const next=parseConsent(b),prior=old.consents[next.purpose];
   if(next.state==='granted'&&prior&&(Date.parse(next.observedAt)<Date.parse(prior.observedAt)||(prior.withdrawnAt&&Date.parse(next.observedAt)<=Date.parse(prior.withdrawnAt))))throw new ApiError(409,'철회 이후 새로 관측한 동의만 등록할 수 있습니다.');
   if(!withdrawing)await capacity(who.owner,kinds.consent,c.brandId,5000);
   const consent={...next,recordedAt:at,withdrawnAt:next.withdrawnAt??prior?.withdrawnAt};
   consents={...old.consents,[next.purpose]:consent};
   statements.push(appendStatement(who.owner,kinds.consent,crypto.randomUUID(),{customerId:old.id,brandId:c.brandId,customerVersion:old.version+1,...consent},c.brandId));
  }else statements.push(...await linkOrder(who,c,old,b,at));
  if(!withdrawing){await capacity(who.owner,kinds.request,c.brandId,10000);await growthConsumerView(who,c,waitDays);}
  statements.push(recordStatement(who.owner,kinds.customer,old.id,{...old,version:old.version+1,consents,updatedAt:at},c.brandId),appendStatement(who.owner,kinds.request,requestId,{id:requestId,brandId:c.brandId,customerId:old.id,digest},c.brandId));
  await database().batch(statements);
  // Withdrawals cannot fail after persistence because unrelated store reads hit a limit.
  if(withdrawing)return {withdrawn:true,customerId:old.id,version:old.version+1,campaignVersion:c.version,maySend:false,mayExecute:false};
 }
 return {...await growthConsumerView(who,c,waitDays),resultCustomerId};
}
