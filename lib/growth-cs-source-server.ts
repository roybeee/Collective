import type {Campaign} from './agency';
import type {StorefrontOrderLink} from './storefront-orders';
import type {CsTicketRecord} from './growth-cs-server';
import type {ConsumerCustomer} from './growth-consumer-server';
import type {DeliveryInput,DeliveryRow} from './growth-consumer-delivery';
import {deliveryUuid} from './growth-consumer-delivery';
import {emptyConsumerConsents} from './growth-consumer';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
import {appendRow,campaignRows,inCampaign,optionalRecord,campaignCapacity} from './growth-ledger-server';
import {deliveryConnection,deliverySecret} from './growth-consumer-delivery-config';
import {type CsSource} from './growth-cs-source';
import {readCsInbox} from './growth-cs-source-provider';
const kinds={current:'growth_cs_source',history:'growth_cs_source_history',request:'growth_cs_source_request'} as const;
export async function csSourceView(who:Actor,c:Campaign){
 const [sources,tickets,customers]=await Promise.all([campaignRows<CsSource>(who.owner,c,kinds.current,2000),campaignRows<CsTicketRecord>(who.owner,c,'growth_cs_ticket',2000),database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_customer' AND parent_id=? LIMIT 2001").bind(who.owner,c.brandId).all<{data:string}>()]);
 if(customers.results.length>2000)throw new ApiError(409,'고객 범위 대사가 필요합니다.');const customerMap=new Map(customers.results.map(r=>{const x=JSON.parse(r.data) as ConsumerCustomer;return [x.id,x]}));const ticketMap=new Map(tickets.map(t=>[t.id,t]));
 return {campaignVersion:c.version,sources:sources.map(s=>{const customer=customerMap.get(s.customerId),ticket=ticketMap.get(s.id);return {...s,customerVersion:customer?.version??s.customerVersion,ticketVersion:ticket?.version??s.ticketVersion,canReply:s.status==='open'&&ticket?.status==='open'&&customer?.state==='active'&&!!s.order}})};
}
export async function pullCsSources(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived'||c.version!==b.campaignVersion||!deliveryUuid(b.requestId)||!(b.cursor===undefined||b.cursor===null||typeof b.cursor==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(b.cursor)))throw new ApiError(400,'문의 접수 요청 판과 범위를 확인하세요.');
 const connection=await deliveryConnection(who.owner,c);if(!connection?.enabled)throw new ApiError(409,'소유자의 제공자 연결이 필요합니다.');
 const requestDigest=await storefrontDigest({campaignId:c.id,campaignVersion:c.version,cursor:b.cursor??null}),previous=await optionalRecord<{digest:string;nextCursor?:string|null;intakeHeld?:boolean}>(who.owner,kinds.request,b.requestId);
 if(previous){if(previous.digest!==requestDigest)throw new ApiError(409,'동일 접수 요청 내용이 바뀌었습니다.');return {recorded:true,duplicate:true,nextCursor:previous.nextCursor??null,intakeHeld:previous.intakeHeld??false}}
 let page;try{page=await readCsInbox(connection.tenantId,connection.providerStoreId,await deliverySecret(who.owner,connection),b.cursor as string|null??null)}catch{throw new ApiError(409,'서명된 문의 접수를 확인하지 못했습니다. 원문·연락처 없는 제공자 계약을 확인하세요.')}
 const at=stamp(),writes:D1PreparedStatement[]=[];let imported=0,newSources=0;
 const pendingCustomers=new Map<string,ConsumerCustomer>();
 for(const source of page.items){
  const linkId=await storefrontDigest([c.storeId,source.sourceKey,source.externalOrderId]),link=await optionalRecord<StorefrontOrderLink>(who.owner,'storefront_order_link',linkId),old=await optionalRecord<CsSource>(who.owner,kinds.current,source.id);
  if(old?.erased){if(!inCampaign(old,c))throw new ApiError(409,'삭제된 문의 범위가 다릅니다.');continue;}
  const existingCustomer=await optionalRecord<ConsumerCustomer>(who.owner,'growth_customer',source.customerId);if(existingCustomer?.brandId===c.brandId&&existingCustomer.state!=='active')continue;
  if(!link||link.brandId!==c.brandId||link.storeId!==c.storeId)throw new ApiError(409,'문의의 정확한 판매처 주문을 먼저 동기화하세요.');
  const order=await readRecord<{id:string;storeId:string;version:number}>(who.owner,'store_order',link.orderId);if(order.storeId!==c.storeId||order.version!==link.orderVersion)throw new ApiError(409,'주문 판이 변경되었습니다.');
  if(old&&(!inCampaign(old,c)||old.customerId!==source.customerId||old.externalOrderId!==source.externalOrderId||old.sourceKey!==source.sourceKey||old.provider?.tenantId!==connection.tenantId||old.provider?.storeId!==connection.providerStoreId))throw new ApiError(409,'문의의 고객·주문 범위가 변경되었습니다.');
  let customer=pendingCustomers.get(source.customerId)??await optionalRecord<ConsumerCustomer>(who.owner,'growth_customer',source.customerId);
  if(customer&&(customer.brandId!==c.brandId||customer.state!=='active'))throw new ApiError(409,'삭제되었거나 다른 브랜드의 고객입니다.');
  if(!customer){customer={id:source.customerId,brandId:c.brandId,version:1,state:'active',consents:emptyConsumerConsents(),createdAt:at,updatedAt:at};pendingCustomers.set(customer.id,customer);writes.push(recordStatement(who.owner,'growth_customer',customer.id,customer,c.brandId))}
  const ticket=await optionalRecord<CsTicketRecord>(who.owner,'growth_cs_ticket',source.id);if(ticket&&(!inCampaign(ticket,c)||!old))throw new ApiError(409,'문의 티켓 범위가 다릅니다.');
  if(!ticket){const next:CsTicketRecord={id:source.id,brandId:c.brandId,campaignId:c.id,version:1,status:source.status==='open'?'open':'cancelled',input:{category:source.category,channel:'marketplace',summary:'판매처 본인 문의 접수',lineId:'',receivedAt:source.receivedAt,promisedBy:new Date(Date.parse(source.receivedAt)+86400000).toISOString(),assignee:'운영 담당',priority:'normal'},events:[],line:null,createdAt:at,updatedAt:at,updatedBy:who.id};writes.push(recordStatement(who.owner,'growth_cs_ticket',source.id,next,c.id),appendRow(who.owner,c,'growth_cs_ticket_history',`${source.id}:1`,next,at))}
  if(old&&old.sourceDigest===source.sourceDigest&&old.status===source.status&&old.order?.version===order.version&&old.order?.linkRevision===link.revision)continue;
  if(!old)newSources++;
  const next:CsSource={...source,brandId:c.brandId,campaignId:c.id,storeId:c.storeId!,version:(old?.version??0)+1,provider:{tenantId:connection.tenantId,storeId:connection.providerStoreId},order:{id:order.id,version:order.version,linkId,linkRevision:link.revision},customerVersion:customer.version,ticketVersion:ticket?.version??1,updatedAt:at};
  writes.push(recordStatement(who.owner,kinds.current,source.id,next,c.id),appendRow(who.owner,c,kinds.history,`${source.id}:${next.version}`,next,at));imported++;
  writes.push(...csSourceSuppression(who.owner,c,source.id,source.sourceDigest,source.status,b.requestId,at));
 }
 if((await campaignRows(who.owner,c,kinds.current,2000)).length+newSources>2000)throw new ApiError(409,'문의 접수 대사가 필요합니다.');
 // Existing source changes/withdrawals must remain auditable even at intake capacity.
 if(newSources){await campaignCapacity(who.owner,c,kinds.request,20000);await campaignCapacity(who.owner,c,kinds.history,20000);}
 await database().batch([...writes,appendRow(who.owner,c,kinds.request,b.requestId,{digest:requestDigest,at,nextCursor:page.nextCursor,intakeHeld:page.intakeHeld},at)]);return {recorded:true,imported,nextCursor:page.nextCursor,intakeHeld:page.intakeHeld};
}
export async function csDeliveryEvidence(who:Actor,c:Campaign,input:DeliveryInput){
 const ref=input.serviceContext;if(!ref)throw new ApiError(409,'본인 문의 근거가 필요합니다.');
 const [source,ticket,customer]=await Promise.all([readRecord<CsSource>(who.owner,kinds.current,ref.ticketId),readRecord<CsTicketRecord>(who.owner,'growth_cs_ticket',ref.ticketId),readRecord<ConsumerCustomer>(who.owner,'growth_customer',input.customerId)]);
 const connection=await deliveryConnection(who.owner,c);if(!connection||source.provider?.tenantId!==connection.tenantId||source.provider?.storeId!==connection.providerStoreId)throw new ApiError(409,'원래 문의를 접수한 제공자 연결이 필요합니다.');
 if(!inCampaign(source,c)||!inCampaign(ticket,c)||source.storeId!==c.storeId||source.customerId!==input.customerId||source.sourceDigest!==ref.sourceDigest||source.status!=='open'||ticket.status!=='open'||ticket.version!==ref.ticketVersion||customer.brandId!==c.brandId||customer.state!=='active'||customer.version!==input.customerVersion)throw new ApiError(409,'현재 본인 문의·고객·티켓 판이 아닙니다.');
 const [order,link]=await Promise.all([readRecord<{storeId:string;version:number}>(who.owner,'store_order',source.order.id),readRecord<StorefrontOrderLink>(who.owner,'storefront_order_link',source.order.linkId)]);
 if(order.storeId!==c.storeId||order.version!==source.order.version||link.orderId!==source.order.id||link.orderVersion!==order.version||link.revision!==source.order.linkRevision||link.externalId!==source.externalOrderId||link.sourceKey!==source.sourceKey)throw new ApiError(409,'현재 정확한 주문 판을 확인하세요.');
 return {customer,evidence:{source,ticket,order,link},digest:await storefrontDigest({source,ticket,order,link,customerVersion:customer.version})};
}
export async function csResponseStatements(who:Actor,c:Campaign,row:DeliveryRow,at:string,respondedAt=at){
 const ref=row.input?.serviceContext;if(row.input?.purpose!=='service_reply'||!ref)return {statements:[] as D1PreparedStatement[],held:false};
 const ticket=await optionalRecord<CsTicketRecord>(who.owner,'growth_cs_ticket',ref.ticketId);
 if(ticket?.events.some(x=>x.evidenceRef===row.id&&x.action==='respond'))return {statements:[] as D1PreparedStatement[],held:false};
 if(!ticket||!inCampaign(ticket,c)||ticket.version!==ref.ticketVersion||ticket.status!=='open'||Date.parse(respondedAt)<Date.parse(ticket.input.receivedAt))return {statements:[] as D1PreparedStatement[],held:true};
 const next:CsTicketRecord={...ticket,version:ticket.version+1,status:'responded',events:[...ticket.events,{action:'respond',at:respondedAt,evidenceRef:row.id,note:'제공자 문의 화면 게시 영수증 확인',recordedAt:at,recordedBy:who.id}],updatedAt:at,updatedBy:who.id};return {statements:[recordStatement(who.owner,'growth_cs_ticket',ticket.id,next,c.id),appendRow(who.owner,c,'growth_cs_ticket_history',`${ticket.id}:${next.version}`,next,at)],held:false};
}

function csSourceSuppression(owner:string,c:Campaign,ticketId:string,digest:string,status:string,requestId:string,at:string){
 const marker=`cs-${requestId}`;
 return [database().prepare("UPDATE records SET data=json_set(data,'$.version',json_extract(data,'$.version')+1,'$.status',CASE WHEN json_extract(data,'$.status')='queued' THEN 'failed' ELSE json_extract(data,'$.status') END,'$.suppressed',json('true'),'$.cancelPending',json(CASE WHEN json_extract(data,'$.status') IN ('unknown','accepted') THEN 'true' ELSE 'false' END),'$.cancelRetryAt',NULL,'$.csSuppressionRequestId',?,'$.updatedAt',?) WHERE owner=? AND kind='growth_consumer_delivery' AND parent_id=? AND json_extract(data,'$.input.serviceContext.ticketId')=? AND (json_extract(data,'$.input.serviceContext.sourceDigest')<>? OR ?<>'open') AND json_extract(data,'$.status') IN ('queued','unknown','accepted')").bind(marker,at,owner,c.id,ticketId,digest,status),database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT owner||':growth_consumer_delivery_history:'||json_extract(data,'$.id')||':'||json_extract(data,'$.version'),owner,'growth_consumer_delivery_history',parent_id,data,? FROM records WHERE owner=? AND kind='growth_consumer_delivery' AND json_extract(data,'$.csSuppressionRequestId')=? AND json_extract(data,'$.input.serviceContext.ticketId')=?").bind(at,owner,marker,ticketId)];
}
