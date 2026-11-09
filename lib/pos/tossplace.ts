// 토스플레이스 Open API 공급자(C7). 문서: https://docs.tossplace.com/reference/open-api/common.html · order/order-methods.html · order/order-model.html · webhook.html (2026-11-09 확인).
// 확인한 사실: 인증 헤더 x-access-key·x-secret-key, 응답 봉투 {resultType:'SUCCESS',success} / {resultType:'FAIL',error}, 페이지 page·size(1~500)·sortOrder,
// 주문 목록은 결제 내역 변동 시각 순, 호출량 매장별 토큰 버킷(초당 10·최대 100, 429와 x-ratelimit-reset epoch ms),
// 웹훅 서명 x-toss-signature = 'v1=' + hex(HMAC-SHA256(secret, `${x-toss-timestamp}.${rawBody}`)), x-toss-webhook-id가 멱등 키.
// 가정(문서에 없음, docs/POS-INTEGRATION.ko.md): 시간대 표기 없는 시각은 KST, 웹훅 시각 허용 창 ±300초, 목록 응답 success는 배열(또는 content 배열).
import {readBoundedText,HttpBodyError} from '../http-limits';
import {parseStorefrontOrders,storefrontColumns,StorefrontInputError,type StorefrontRow} from '../storefront-orders';
import type {PosCredential,PosCursor,PosListResult,PosNormalized,PosPayment,PosPaymentsResult,PosProvider,PosWebhookVerdict,PosFailure} from './types';

export const TOSSPLACE_BASE='https://open-api.tossplace.com/api-public/openapi/v1';
export const TOSSPLACE_PAGE_SIZE=100,TOSSPLACE_TIMEOUT_MS=10_000,TOSSPLACE_MAX_BYTES=1_000_000,TOSSPLACE_WEBHOOK_WINDOW_MS=300_000;
// 다음 바퀴는 마지막 변동 시각보다 이만큼 앞에서 다시 읽는다(페이지 이동으로 놓친 주문 보정). 겹친 주문은 개정 번호로 중복 처리된다.
export const TOSSPLACE_OVERLAP_MS=600_000;
// 개정 번호(StorefrontRow.revision, 1~10자리 정수) = 2024-01-01 이후 변동 시각의 0.1초 단위. 2055년까지 10자리 안이다.
export const TOSSPLACE_REVISION_EPOCH=Date.parse('2024-01-01T00:00:00Z');
const ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/,MERCHANT=/^\d{1,19}$/;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;

// ISO 8601 시각. 시간대가 없으면 KST로 본다(가정). 읽을 수 없으면 NaN.
export function parseTossTime(value:unknown){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value))return NaN;
 return Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(value)?value:value+'+09:00');
}
export const koreaDate=(ms:number)=>new Date(ms+9*3600000).toISOString().slice(0,10);
export const tossplaceRevision=(updatedAt:number)=>Math.floor((updatedAt-TOSSPLACE_REVISION_EPOCH)/100);
const diningMode=(option:unknown):StorefrontRow['mode']=>option==='DELIVERY'?'delivery':option==='TOGO'||option==='PICKUP'?'pickup':'hall';

// 결제 내역 합계: APPROVED·CANCELLED 결제의 금액 합이 결제액, CANCELLED 금액 합이 누적 환불액이다. 결제 내역이 없는 완료 주문은 청구 최종금액을 쓴다.
function amounts(order:Record<string,unknown>){
 const payments=Array.isArray(order.payments)?order.payments:null;if(!payments)return null;
 let paid=0,refund=0;
 for(const p of payments){if(!record(p))return null;const amount=integer(p.amount);if(amount===null||!['APPROVED','CANCELLED'].includes(String(p.state)))return null;paid+=amount;if(p.state==='CANCELLED')refund+=amount}
 if(!payments.length&&order.orderState==='COMPLETED'){const total=record(order.chargePrice)?integer(order.chargePrice.totalAmount):null;if(total===null)return null;return {paid:total,refund:0}}
 return {paid,refund};
}
export function normalizeTossplaceOrder(order:unknown,today:string):PosNormalized{
 if(!record(order)||typeof order.id!=='string'||!ID.test(order.id))return {skip:'invalid'};
 const state=String(order.orderState);if(!['REQUESTED','OPENED','COMPLETED','CANCELLED','UNDEFINED'].includes(state))return {skip:'invalid'};
 const createdAt=parseTossTime(order.createdAt),updatedAt=parseTossTime(order.updatedAt);if(!Number.isFinite(createdAt)||!Number.isFinite(updatedAt))return {skip:'invalid'};
 if(state!=='COMPLETED'&&state!=='CANCELLED')return {skip:'not_final'};
 const money=amounts(order);if(!money)return {skip:'invalid'};
 const {paid,refund}=money;if(refund>paid)return {skip:'inconsistent'};
 if(state==='CANCELLED'&&paid!==refund)return {skip:'payments_open'};
 const status:StorefrontRow['status']=state==='CANCELLED'?'cancelled':paid>0&&refund===paid?'refunded':'paid';
 const revision=tossplaceRevision(updatedAt);if(revision<1||revision>9_999_999_999)return {skip:'revision_range'};
 const orderDate=koreaDate(createdAt);if(orderDate>today)return {skip:'future'};
 const first=Array.isArray(order.lineItems)&&record(order.lineItems[0])?order.lineItems[0].diningOption:undefined;
 return {row:{externalId:order.id,revision,orderDate,status,paidAmount:paid,refundAmount:refund,mode:diningMode(first)},updatedAt};
}
// 같은 주문이 한 페이지에 두 번 오면 최신 개정만 남기고, 기존 양식 검증(parseStorefrontOrders)을 그대로 통과시킨다.
export function normalizeTossplacePage(orders:readonly unknown[],today:string){
 const skipReasons:Record<string,number>={};const latest=new Map<string,StorefrontRow>();let maxUpdatedAt=0;
 for(const order of orders){
  const n=normalizeTossplaceOrder(order,today);
  if(record(order)){const t=parseTossTime(order.updatedAt);if(Number.isFinite(t))maxUpdatedAt=Math.max(maxUpdatedAt,t)}
  if('skip' in n){skipReasons[n.skip]=(skipReasons[n.skip]??0)+1;continue}
  const prev=latest.get(n.row.externalId);if(!prev||prev.revision<n.row.revision)latest.set(n.row.externalId,n.row);
 }
 const rows=[...latest.values()];
 const csv=[storefrontColumns.join(','),...rows.map(r=>[r.externalId,r.revision,r.orderDate,r.status,r.paidAmount,r.refundAmount,r.mode].join(','))].join('\n')+'\n';
 return {rows:rows.length?parseStorefrontOrders(csv,today):[],skipped:orders.length-rows.length,skipReasons,maxUpdatedAt};
}
export function tossplaceOrdersUrl(merchantId:string,cursor:PosCursor){
 const u=new URL(`${TOSSPLACE_BASE}/merchants/${merchantId}/order/orders`);
 u.searchParams.set('from',cursor.since);u.searchParams.set('to',cursor.to);u.searchParams.set('page',String(cursor.page));u.searchParams.set('size',String(TOSSPLACE_PAGE_SIZE));u.searchParams.set('sortOrder','ASC');
 return u.toString();
}
export const initialCursor=(since:string,now:number):PosCursor=>({since,to:new Date(now).toISOString(),page:1});
export function nextCursor(cursor:PosCursor,count:number,maxUpdatedAt:number,now:number):{cursor:PosCursor;hasMore:boolean}{
 if(count>=TOSSPLACE_PAGE_SIZE)return {cursor:{...cursor,page:cursor.page+1},hasMore:true};
 const watermark=Math.max(Date.parse(cursor.since),(maxUpdatedAt||Date.parse(cursor.to))-TOSSPLACE_OVERLAP_MS);
 return {cursor:{since:new Date(watermark).toISOString(),to:new Date(now).toISOString(),page:1},hasMore:false};
}
const headersFor=(c:PosCredential)=>({'x-access-key':c.accessKey,'x-secret-key':c.secretKey,accept:'application/json','content-type':'application/json'});
const failure=(kind:PosFailure['kind'],retryAt:number|null=null):PosListResult=>({ok:false,failure:{kind,retryAt}});
function envelope(raw:string):unknown[]|null{
 let value:unknown;try{value=JSON.parse(raw)}catch{return null}
 if(!record(value)||value.resultType!=='SUCCESS')return null;
 const body=value.success;if(Array.isArray(body))return body;
 if(record(body)&&Array.isArray(body.content))return body.content;
 return null;
}
async function get(credential:PosCredential,url:string):Promise<{ok:true;raw:string}|{ok:false;failure:PosFailure}>{
 let res:Response;
 try{res=await fetch(url,{method:'GET',headers:headersFor(credential),signal:AbortSignal.timeout(TOSSPLACE_TIMEOUT_MS),redirect:'error'})}
 catch(e){return {ok:false,failure:{kind:(e as {name?:unknown}|null)?.name==='TimeoutError'?'timeout':'network',retryAt:null}}}
 if(res.status===401||res.status===403)return {ok:false,failure:{kind:'unauthorized',retryAt:null}};
 if(res.status===429){const reset=Number(res.headers.get('x-ratelimit-reset'));return {ok:false,failure:{kind:'rate_limited',retryAt:Number.isFinite(reset)&&reset>0?reset:null}}}
 if(!res.ok)return {ok:false,failure:{kind:`http_${res.status}`,retryAt:null}};
 try{return {ok:true,raw:await readBoundedText(res,TOSSPLACE_MAX_BYTES)}}
 catch(e){return {ok:false,failure:{kind:e instanceof HttpBodyError&&e.status===413?'too_large':'network',retryAt:null}}}
}
export const tossplaceProvider:PosProvider={
 key:'tossplace',
 async listOrders(credential,merchantId,cursor,today,now){
  if(!MERCHANT.test(merchantId))return failure('invalid_response');
  const current=cursor??initialCursor(new Date(now-30*86400000).toISOString(),now);
  const got=await get(credential,tossplaceOrdersUrl(merchantId,current));if(!got.ok)return {ok:false,failure:got.failure};
  const orders=envelope(got.raw);if(!orders||orders.length>TOSSPLACE_PAGE_SIZE)return failure('invalid_response');
  let page;try{page=normalizeTossplacePage(orders,today)}catch(e){return failure(e instanceof StorefrontInputError?'invalid_response':'invalid_response')}
  const next=nextCursor(current,orders.length,page.maxUpdatedAt,now);
  return {ok:true,page:{rows:page.rows,count:orders.length,skipped:page.skipped,skipReasons:page.skipReasons,nextCursor:next.cursor,hasMore:next.hasMore}};
 },
 async listPayments(credential,merchantId,orderId):Promise<PosPaymentsResult>{
  if(!MERCHANT.test(merchantId)||!ID.test(orderId))return {ok:false,failure:{kind:'invalid_response',retryAt:null}};
  const u=new URL(`${TOSSPLACE_BASE}/merchants/${merchantId}/payment/payments/by-order-id`);u.searchParams.set('orderId',orderId);
  const got=await get(credential,u.toString());if(!got.ok)return {ok:false,failure:got.failure};
  const list=envelope(got.raw);if(!list)return {ok:false,failure:{kind:'invalid_response',retryAt:null}};
  const payments:PosPayment[]=list.flatMap(p=>{if(!record(p)||typeof p.id!=='string'||typeof p.orderId!=='string')return [];const amount=integer(p.amount);if(amount===null)return [];const state:PosPayment['state']=p.state==='APPROVED'||p.state==='CANCELLED'?p.state:'UNDEFINED';return [{id:p.id,orderId:p.orderId,state,amount}]});
  return {ok:true,payments};
 },
 async verifyWebhook(secret,headers,raw,now):Promise<PosWebhookVerdict>{
  const timestamp=headers.get('x-toss-timestamp')??'',signature=headers.get('x-toss-signature')??'',webhookId=headers.get('x-toss-webhook-id')??'';
  if(!/^\d{10,16}$/.test(timestamp)||!/^v1=[a-f0-9]{64}$/.test(signature)||!/^[A-Za-z0-9_.:-]{1,100}$/.test(webhookId))return {ok:false,reason:'missing_headers'};
  if(Math.abs(now-Number(timestamp))>TOSSPLACE_WEBHOOK_WINDOW_MS)return {ok:false,reason:'stale'};
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.slice(3).match(/../g)!,v=>parseInt(v,16));
  const valid=await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+raw));
  return valid?{ok:true,webhookId,timestamp:Number(timestamp)}:{ok:false,reason:'bad_signature'};
 },
 normalize:normalizeTossplaceOrder,
};
// 웹훅 본문(WebhookEvent). 주문 생성 이벤트만 주문 전체를 담고, 나머지 주문·결제 이벤트는 식별자만 담아 조회를 재촉한다.
export type TossplaceWebhookEvent={id:string;type:string;merchantId:string;order:unknown|null};
export function parseTossplaceWebhook(raw:string):TossplaceWebhookEvent|null{
 let value:unknown;try{value=JSON.parse(raw)}catch{return null}
 if(!record(value)||typeof value.id!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(value.id)||typeof value.type!=='string'||!/^[a-z_][a-z0-9_.]{1,80}$/.test(value.type))return null;
 const merchantId=typeof value.merchantId==='number'&&Number.isSafeInteger(value.merchantId)&&value.merchantId>0?String(value.merchantId):typeof value.merchantId==='string'&&MERCHANT.test(value.merchantId)?value.merchantId:null;
 if(!merchantId||!record(value.data))return null;
 return {id:value.id,type:value.type,merchantId,order:value.type==='order.order.created.v1'&&record(value.data.order)?value.data.order:null};
}
export const TOSSPLACE_NUDGE_EVENTS:readonly string[]=['order.order.completed.v1','order.order.cancelled.v1','payment.payment.approved.v1','payment.payment.cancelled.v1'];
