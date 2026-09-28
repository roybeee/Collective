import {parseStorefrontOrders,storefrontColumns,StorefrontInputError} from './storefront-orders';
export const storefrontWebhookId=(id:string)=>'storefront_webhook:'+id;
export type StorefrontWebhook={channel:'storefront_webhook';id:string;storeId:string;brandId:string;sourceKey:string;secret:string;enabled:boolean;version:number;createdAt:string;updatedAt:string;updatedBy:string;lastReceivedAt:string|null;lastResult:{created:number;updated:number;duplicates:number;older:number}|null};
export const publicStorefrontWebhook=(v:StorefrontWebhook)=>({id:v.id,storeId:v.storeId,sourceKey:v.sourceKey,enabled:v.enabled,version:v.version,createdAt:v.createdAt,updatedAt:v.updatedAt,lastReceivedAt:v.lastReceivedAt,lastResult:v.lastResult,path:'/api/storefront-webhooks/'+v.id});
export async function verifyStorefrontSignature(secret:string,timestamp:string,signature:string,raw:string,now=Date.now()) {
 if(!/^\d{10}$/.test(timestamp)||Math.abs(Math.floor(now/1000)-Number(timestamp))>300||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(signature.slice(7).match(/../g)!,v=>parseInt(v,16));
 return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+raw));
}
export function parseStorefrontWebhook(raw:string,today:string) {
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new StorefrontInputError('올바른 JSON 본문이 필요합니다.');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='orders')throw new StorefrontInputError('orders 배열만 전송하세요. 고객 정보는 받지 않습니다.');
 const rows=(value as {orders:unknown}).orders;
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw new StorefrontInputError('한 요청에 주문 1~100건이 필요합니다.');
 const csv=rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==storefrontColumns.length||Object.keys(row).some(k=>!storefrontColumns.includes(k as typeof storefrontColumns[number])))throw new StorefrontInputError('주문 양식의 7개 필드만 전송하세요.');
  return storefrontColumns.map(k=>{const v=row[k];if(['revision','paid_amount','refund_amount'].includes(k)){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new StorefrontInputError('변경 순서와 금액은 정수여야 합니다.');return String(v);}if(typeof v!=='string'||/[\r\n,\"]/.test(v))throw new StorefrontInputError('주문 문자 필드의 형식을 확인하세요.');return v;}).join(',');
 }).join('\n');
 return parseStorefrontOrders(storefrontColumns.join(',')+'\n'+csv,today);
}
