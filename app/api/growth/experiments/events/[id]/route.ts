import {openRecordSecret} from '@/lib/credential-crypto-server';
import {readBoundedText,HttpBodyError} from '@/lib/http-limits';
import {GrowthExperimentError} from '@/lib/growth-experiment';
import {parseExperimentEvent,verifyExperimentEventSignature,experimentEventPath} from '@/lib/growth-experiment-events';
import {ingestExperimentEvent} from '@/lib/growth-experiment-events-server';
import {storefrontWebhookId,type StorefrontWebhook} from '@/lib/storefront-webhook';
import {ApiError,acquireLock,database,failure,json,readRecord,releaseLock} from '@/lib/server';
async function rateLimit(owner:string,id:string){
 const key='experiment-event:'+owner+':'+id,now=Date.now();
 await database().prepare('INSERT INTO auth_rate_limits(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END').bind(key,now,now-60000,now-60000).run();
 const count=await database().prepare('SELECT count FROM auth_rate_limits WHERE key=?').bind(key).first<{count:number}>();if(!count||count.count>120)throw new ApiError(429,'실험 수신 한도입니다. 잠시 후 같은 사건 ID로 재시도하세요.');
}
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 let owner='',lock='';try{
  const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id)||new URL(req.url).pathname!==experimentEventPath(id))throw new ApiError(401,'실험 수신 인증을 확인하세요.');
  const rows=await database().prepare("SELECT owner,data FROM records WHERE kind='channel_credential' AND json_extract(data,'$.channel')='storefront_webhook' AND json_extract(data,'$.id')=? LIMIT 2").bind(id).all<{owner:string;data:string}>();
  if(rows.results.length!==1)throw new ApiError(401,'실험 수신 인증을 확인하세요.');const row=rows.results[0],connection=JSON.parse(row.data) as StorefrontWebhook;
  if(!connection.enabled)throw new ApiError(401,'실험 수신 인증을 확인하세요.');
  const raw=await readBoundedText(req,16384),secret=await openRecordSecret(row.owner,'channel_credential',storefrontWebhookId(id),connection.secret);
  if(!await verifyExperimentEventSignature(secret,id,req.headers.get('x-collective-timestamp')??'',req.headers.get('x-collective-signature')??'',raw))throw new ApiError(401,'실험 수신 인증을 확인하세요.');
  await rateLimit(row.owner,id);const event=parseExperimentEvent(raw);owner=row.owner;lock=await acquireLock(owner);
  const current=await readRecord<StorefrontWebhook>(owner,'channel_credential',storefrontWebhookId(id));if(!current.enabled||current.version!==connection.version||current.secret!==connection.secret)throw new ApiError(409,'수신 연결이 변경되었습니다. 현재 연결로 다시 서명하세요.');
  const store=await readRecord<{brandId:string;status:string}>(owner,'store',current.storeId);if(store.brandId!==current.brandId||store.status!=='active')throw new ApiError(409,'현재 연결 지점의 상태를 확인하세요.');
  return json(await ingestExperimentEvent(owner,current,event));
 }catch(e){return failure(e instanceof HttpBodyError?new ApiError(e.status,e.message):e instanceof GrowthExperimentError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}
}
