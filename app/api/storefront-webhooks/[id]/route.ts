import type {Store} from '@/lib/store-marketing';
import {openRecordSecret} from '@/lib/credential-crypto-server';
import {readBoundedText,HttpBodyError} from '@/lib/http-limits';
import {koreaToday} from '@/lib/store-operations';
import {ImportError} from '@/lib/order-import';
import {StorefrontInputError} from '@/lib/storefront-orders';
import {prepareStorefrontImport} from '@/lib/storefront-orders-server';
import {verifyStorefrontSignature,parseStorefrontWebhook,storefrontWebhookId,type StorefrontWebhook} from '@/lib/storefront-webhook';
import {ApiError,acquireLock,database,failure,json,readRecord,recordStatement,releaseLock,stamp} from '@/lib/server';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {
 let owner='',lock='';try {
  const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))throw new ApiError(401,'웹훅 인증을 확인하세요.');
  const rows=await database().prepare("SELECT owner,data FROM records WHERE kind='channel_credential' AND json_extract(data,'$.channel')='storefront_webhook' AND json_extract(data,'$.id')=? LIMIT 2").bind(id).all<{owner:string;data:string}>();
  if(rows.results.length!==1)throw new ApiError(401,'웹훅 인증을 확인하세요.');const row=rows.results[0],connection=JSON.parse(row.data) as StorefrontWebhook;
  if(!connection.enabled)throw new ApiError(401,'웹훅 인증을 확인하세요.');
  const raw=await readBoundedText(req,64000),secret=await openRecordSecret(row.owner,'channel_credential',storefrontWebhookId(id),connection.secret);
  if(!await verifyStorefrontSignature(secret,req.headers.get('x-collective-timestamp')??'',req.headers.get('x-collective-signature')??'',raw))throw new ApiError(401,'웹훅 인증을 확인하세요.');
  const orders=parseStorefrontWebhook(raw,koreaToday());owner=row.owner;lock=await acquireLock(owner);
  const current=await readRecord<StorefrontWebhook>(owner,'channel_credential',storefrontWebhookId(id));if(!current.enabled||current.version!==connection.version)throw new ApiError(409,'연결 설정이 변경되었습니다. 새 설정을 확인하세요.');
  const store=await readRecord<Store>(owner,'store',current.storeId);if(store.status!=='active'||store.brandId!==current.brandId)throw new ApiError(409,'주문을 수신할 지점 상태를 확인하세요.');
  const {writes,result}=await prepareStorefrontImport(owner,store,current.sourceKey,orders,'webhook:'+id),{created,updated,duplicates,older}=result,summary={created,updated,duplicates,older};
  await database().batch([...writes,recordStatement(owner,'channel_credential',storefrontWebhookId(id),{...current,lastReceivedAt:stamp(),lastResult:summary})]);
  return json({...summary,externalTransmissions:0});
 }catch(e){return failure(e instanceof HttpBodyError?new ApiError(e.status,e.message):e instanceof StorefrontInputError||e instanceof ImportError?new ApiError(400,e.message):e);}finally{if(lock)await releaseLock(owner,lock);}
}
