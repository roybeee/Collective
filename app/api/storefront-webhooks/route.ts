import type {Store} from '@/lib/store-marketing';
import {sealRecordSecret} from '@/lib/credential-crypto-server';
import {storefrontSource,StorefrontInputError} from '@/lib/storefront-orders';
import {publicStorefrontWebhook,storefrontWebhookId,type StorefrontWebhook} from '@/lib/storefront-webhook';
import {ApiError,acquireLock,actor,body,failure,json,listRecords,readRecord,recordStatement,releaseLock,requireOwnerActor,secureMutation,stamp,str,uid} from '@/lib/server';
async function connections(owner:string,storeId:string){return (await listRecords<StorefrontWebhook>(owner,'channel_credential')).filter(c=>c.channel==='storefront_webhook'&&c.storeId===storeId);}
export async function GET(req:Request){try{const who=await actor(req),store=await readRecord<Store>(who.owner,'store',str(new URL(req.url).searchParams.get('storeId'),'지점',100,true));return json({canEdit:who.role==='owner',connections:(await connections(who.owner,store.id)).map(publicStorefrontWebhook)});}catch(e){return failure(e);}}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireOwnerActor(req);secureMutation(req);const b=await body(req);if(!['create','enable','disable','rotate'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 웹훅 설정입니다.');owner=who.owner;lock=await acquireLock(owner);const store=await readRecord<Store>(owner,'store',str(b.storeId,'지점',100,true));if(store.status!=='active'&&b.action!=='disable')throw new ApiError(409,'보관된 지점에는 수신 연결을 설정할 수 없습니다.');
 const now=stamp();let saved:StorefrontWebhook,signingSecret:string|undefined;
 if(b.action==='create'){
  const sourceKey=storefrontSource(b.sourceKey),existing=await connections(owner,store.id);if(existing.some(c=>c.sourceKey===sourceKey))throw new ApiError(409,'같은 몰 식별자의 연결이 있습니다. 기존 연결을 사용하세요.');if(existing.length>=10)throw new ApiError(409,'지점별 수신 연결은 최대 10개입니다.');const id=uid();signingSecret=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');saved={channel:'storefront_webhook',id,storeId:store.id,brandId:store.brandId,sourceKey,secret:await sealRecordSecret(owner,'channel_credential',storefrontWebhookId(id),signingSecret),enabled:false,version:1,createdAt:now,updatedAt:now,updatedBy:who.id,lastReceivedAt:null,lastResult:null};
 }else{
  const old=await readRecord<StorefrontWebhook>(owner,'channel_credential',storefrontWebhookId(str(b.id,'연결',100,true)));if(old.channel!=='storefront_webhook'||old.storeId!==store.id||old.brandId!==store.brandId)throw new ApiError(404,'이 지점의 수신 연결이 아닙니다.');if(b.expectedVersion!==old.version)throw new ApiError(409,'연결 설정이 변경되었습니다. 다시 불러오세요.');saved={...old,version:old.version+1,updatedAt:now,updatedBy:who.id};
  if(b.action==='enable'){if(b.confirmed!==true)throw new ApiError(400,'서명된 주문을 장부에 자동 반영할지 확인하세요.');saved.enabled=true;}
  if(b.action==='disable')saved.enabled=false;
  if(b.action==='rotate'){signingSecret=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');saved.secret=await sealRecordSecret(owner,'channel_credential',storefrontWebhookId(old.id),signingSecret);saved.enabled=false;}
 }
 await recordStatement(owner,'channel_credential',storefrontWebhookId(saved.id),saved).run();return json({connection:publicStorefrontWebhook(saved),...(signingSecret?{signingSecret}:{})});
 }catch(e){return failure(e instanceof StorefrontInputError?new ApiError(400,e.message):e);}finally{if(lock)await releaseLock(owner,lock);}}
