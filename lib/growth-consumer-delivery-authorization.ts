import type {Campaign} from './agency';
import {ApiError,acquireLock,releaseLock,readRecord,stamp} from './server';
import {readBoundedText,HttpBodyError} from './http-limits';
import {appendRow,campaignCapacity,optionalRecord} from './growth-ledger-server';
import {deliveryKinds,deliveryUuid,type DeliveryRow} from './growth-consumer-delivery';
import {deliveryConnection,deliverySecret} from './growth-consumer-delivery-config';
import {currentConsumerAuthorization} from './growth-consumer-delivery-server';
import {deliverySignature,verifyDeliverySignature} from './growth-consumer-delivery-signature';
/** HMAC machine callback, not a browser mutation. Scope and nonce are checked before returning any authorization. */
export async function authorizeConsumerRequest(req:Request){
 let lock='',owner='';
 try{
  if(new URL(req.url).search||!req.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(400,'잘못된 제공자 요청입니다.');
  const raw=await readBoundedText(req,4096),b=JSON.parse(raw) as Record<string,unknown>,path='/api/growth/consumer-delivery/authorize';
  if(!b||Object.keys(b).sort().join(',')!=='campaignId,owner,payloadDigest,requestId,storeId,tenantId'||typeof b.owner!=='string'||!b.owner||b.owner.length>200||typeof b.campaignId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(b.campaignId)||!deliveryUuid(b.requestId)||typeof b.payloadDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.payloadDigest))throw new ApiError(400,'잘못된 제공자 요청입니다.');
  owner=b.owner;const timestamp=req.headers.get('x-collective-timestamp')??'',nonce=req.headers.get('x-collective-nonce')??'',signature=req.headers.get('x-collective-signature')??'';
  if(!/^\d{1,12}$/.test(timestamp)||Math.abs(Number(timestamp)-Math.floor(Date.now()/1000))>60||!deliveryUuid(nonce))throw new ApiError(401,'제공자 인증에 실패했습니다.');
  let c:Campaign,secret:string;try{c=await readRecord<Campaign>(owner,'campaign',b.campaignId);const connection=await deliveryConnection(owner,c,true);if(!connection||connection.tenantId!==b.tenantId||connection.providerStoreId!==b.storeId)throw new Error('scope');secret=await deliverySecret(owner,connection)}catch{throw new ApiError(401,'제공자 인증에 실패했습니다.')}
  if(!await verifyDeliverySignature(secret,`${timestamp}\n${nonce}\nPOST\n${path}\n${raw}`,signature))throw new ApiError(401,'제공자 인증에 실패했습니다.');
  lock=await acquireLock(owner);const nonceId=`auth-${nonce}`;
  if(await optionalRecord(owner,deliveryKinds.request,nonceId))throw new ApiError(409,'이미 사용한 제공자 요청입니다.');
  await campaignCapacity(owner,c,deliveryKinds.request,10000);await appendRow(owner,c,deliveryKinds.request,nonceId,{id:b.requestId,kind:'authorization',nonce,at:stamp()},stamp()).run();
  const fresh=await readRecord<Campaign>(owner,'campaign',c.id),row=await optionalRecord<DeliveryRow>(owner,deliveryKinds.current,b.requestId),allowed=!!row&&row.payloadDigest===b.payloadDigest&&await currentConsumerAuthorization({owner,id:'consumer-provider',role:'admin',email:null},fresh,row);
  const response=JSON.stringify({allowed,requestId:b.requestId,payloadDigest:b.payloadDigest,nonce,checkedAt:stamp()});
  return new Response(response,{headers:{'content-type':'application/json','cache-control':'no-store','x-collective-signature':await deliverySignature(secret,`${nonce}\n${response}`)}});
 }catch(e){if(e instanceof HttpBodyError)throw new ApiError(e.status,e.message);if(e instanceof SyntaxError)throw new ApiError(400,'잘못된 제공자 요청입니다.');throw e}finally{if(lock)await releaseLock(owner,lock)}
}
