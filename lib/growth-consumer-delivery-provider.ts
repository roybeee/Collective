import {deliveryUuid,type DeliveryPayload,type DeliveryReceipt,type DeliveryScope} from './growth-consumer-delivery';
/** Fixed host, signed requests, bounded responses; ambiguous writes are never retried. */
export async function consumerDeliveryProvider(operation:'send'|'receipt'|'cancel',scope:DeliveryScope,secret:string,requestId:string,payloadDigest:string,maxCostKrw:number,payload?:DeliveryPayload):Promise<DeliveryReceipt|null>{
 const path=`/collective/v1/${scope.mode==='cs'?'cs':'consumer'}/${operation}`,timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID(),body=JSON.stringify({tenantId:scope.tenantId,storeId:scope.providerStoreId,requestId,payloadDigest,...(payload?{payload}:{})});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`))),b=>b.toString(16).padStart(2,'0')).join('');
 try{
  const response=await fetch(`https://mapdal.kr${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-collective-timestamp':timestamp,'x-collective-nonce':nonce,'x-collective-signature':signature},body});
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json')||!response.body)return null;
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32768){await reader.cancel();return null}chunks.push(value)}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const r=JSON.parse(new TextDecoder().decode(bytes)) as DeliveryReceipt|null;
  if(!r||Object.keys(r).some(k=>!['requestId','payloadDigest','status','costKrw','receiptId','at','code'].includes(k))||r.requestId!==requestId||r.payloadDigest!==payloadDigest||!['accepted','delivered','failed'].includes(r.status)||!deliveryUuid(r.receiptId)||typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||Date.parse(r.at)>Date.now()+60000||![null,'cancelled','rejected','expired'].includes(r.code)||!(r.costKrw===null||(Number.isSafeInteger(r.costKrw)&&r.costKrw>=0&&r.costKrw<=maxCostKrw)))return null;
  return r;
 }catch{return null}
}
