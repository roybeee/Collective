import type {Store} from './store-marketing';
import {openRecordSecret,sealRecordSecret} from './credential-crypto-server';
import {koreaToday} from './store-operations';
import {ImportError} from './order-import';
import {StorefrontInputError} from './storefront-orders';
import {prepareStorefrontImport} from './storefront-orders-server';
import {backoffMs,parsePullConfig,parsePullResponse,pullUrl,PULL_MAX_BYTES,PULL_TIMEOUT_MS} from './storefront-pull';
import {isEnabled} from './feature-flags';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
export type StorefrontPull={channel:'storefront_pull';id:string;storeId:string;brandId:string;sourceKey:string;baseUrl:string;secret:string;intervalMinutes:number;enabled:boolean;version:number;cursor:string|null;failures:number;lastAttemptAt:string|null;lastSuccessAt:string|null;nextAttemptAt:string|null;lastError:string|null;lastResult:{fetched:number;created:number;updated:number;duplicates:number;older:number;hasMore:boolean}|null;createdAt:string;updatedAt:string;updatedBy:string};
export const pullRecordId=(id:string)=>'storefront_pull:'+id;
const publicView=({secret:_s,...rest}:StorefrontPull)=>{void _s;return rest};
async function connections(owner:string){return (await database().prepare("SELECT data FROM records WHERE owner=? AND kind='channel_credential' AND json_extract(data,'$.channel')='storefront_pull' LIMIT 51").bind(owner).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as StorefrontPull)}
export async function storefrontPullView(who:Actor,campaignId?:string){
 const rows=await connections(who.owner),campaign=campaignId?await readRecord<{storeId?:string}>(who.owner,'campaign',campaignId):null;return {storeId:campaign?.storeId??null,connections:rows.map(publicView),enabled:await isEnabled(who.owner,'storefront_pull'),canEdit:who.role==='owner',externalWrites:0 as const};
}
export async function saveStorefrontPull(who:Actor,b:Record<string,unknown>){
 if(who.role!=='owner')throw new ApiError(403,'판매처 조회 연결은 소유자만 설정합니다.');
 const action=String(b.action??''),at=stamp();
 if(action==='create'){
  const input=parsePullConfig(b.input,true),store=await readRecord<Store>(who.owner,'store',input.storeId);if(store.status!=='active')throw new ApiError(409,'운영 중인 지점만 연결합니다.');
  if((await connections(who.owner)).length>=50)throw new ApiError(409,'판매처 조회 연결은 50개까지입니다.');
  const id=crypto.randomUUID(),row:StorefrontPull={channel:'storefront_pull',id,storeId:store.id,brandId:store.brandId,sourceKey:input.sourceKey,baseUrl:input.baseUrl,secret:await sealRecordSecret(who.owner,'channel_credential',pullRecordId(id),input.token),intervalMinutes:input.intervalMinutes,enabled:false,version:1,cursor:null,failures:0,lastAttemptAt:null,lastSuccessAt:null,nextAttemptAt:null,lastError:null,lastResult:null,createdAt:at,updatedAt:at,updatedBy:who.id};
  await recordStatement(who.owner,'channel_credential',pullRecordId(id),row).run();return {recorded:true as const,connection:publicView(row)};
 }
 const id=String(b.id??'');if(!/^[a-f0-9-]{36}$/.test(id))throw new ApiError(400,'연결 ID를 확인하세요.');
 const old=await readRecord<StorefrontPull>(who.owner,'channel_credential',pullRecordId(id));if(old.channel!=='storefront_pull')throw new ApiError(404,'판매처 조회 연결이 아닙니다.');
 if(b.expectedVersion!==old.version)throw new ApiError(409,'연결 설정이 변경되었습니다. 다시 불러오세요.');
 let next:StorefrontPull;
 if(action==='update'){const input=parsePullConfig({...b.input as object,storeId:old.storeId},false);next={...old,sourceKey:input.sourceKey,baseUrl:input.baseUrl,intervalMinutes:input.intervalMinutes,secret:input.token?await sealRecordSecret(who.owner,'channel_credential',pullRecordId(id),input.token):old.secret,...(input.baseUrl!==old.baseUrl||input.sourceKey!==old.sourceKey?{cursor:null}:{})}}
 else if(action==='enable'||action==='disable')next={...old,enabled:action==='enable',...(action==='enable'?{failures:0,nextAttemptAt:null,lastError:null}:{})};
 else if(action==='reset_cursor')next={...old,cursor:null};
 else throw new ApiError(400,'지원하지 않는 연결 작업입니다.');
 next={...next,version:old.version+1,updatedAt:at,updatedBy:who.id};await recordStatement(who.owner,'channel_credential',pullRecordId(id),next).run();return {recorded:true as const,connection:publicView(next)};
}
async function readBody(res:Response){const reader=res.body?.getReader();if(!reader)return '';const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>PULL_MAX_BYTES){await reader.cancel();throw new StorefrontInputError('판매처 응답이 너무 큽니다.')}chunks.push(value)}const all=new Uint8Array(size);let o=0;for(const c of chunks){all.set(c,o);o+=c.byteLength}return new TextDecoder().decode(all)}
/** One page. Read-only on the storefront; the import is idempotent by order revision, so a retried page cannot double count. */
export async function pullOnce(owner:string,id:string,now=Date.now()){
 const key=pullRecordId(id),conn=await readRecord<StorefrontPull>(owner,'channel_credential',key);if(conn.channel!=='storefront_pull'||!conn.enabled)return {status:'idle' as const};
 const store=await readRecord<Store>(owner,'store',conn.storeId);
 const fail=async(code:string)=>{const failures=conn.failures+1,next={...conn,failures,lastAttemptAt:new Date(now).toISOString(),lastError:code,nextAttemptAt:new Date(now+backoffMs(failures,conn.intervalMinutes)).toISOString()};await recordStatement(owner,'channel_credential',key,next).run();return {status:'retry' as const,error:code}};
 if(store.status!=='active'||store.brandId!==conn.brandId)return fail('store_inactive');
 let raw:string;
 try{const token=await openRecordSecret(owner,'channel_credential',key,conn.secret);
  const res=await fetch(pullUrl(conn.baseUrl,conn.cursor),{method:'GET',headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(PULL_TIMEOUT_MS),redirect:'error'});if(res.status===401||res.status===403)return fail('unauthorized');if(!res.ok)return fail(`http_${res.status}`);raw=await readBody(res);
 }catch(e){return fail(e instanceof StorefrontInputError?'too_large':'network')}
 let page;try{page=parsePullResponse(raw,koreaToday())}catch{return fail('invalid_response')}
 let writes:D1PreparedStatement[]=[],summary={created:0,updated:0,duplicates:0,older:0};
 if(page.orders){try{const p=await prepareStorefrontImport(owner,store,conn.sourceKey,page.orders,'pull:'+id);writes=p.writes;const {created,updated,duplicates,older}=p.result;summary={created,updated,duplicates,older}}catch(e){return fail(e instanceof ImportError||e instanceof StorefrontInputError?'rejected_orders':'import_failed')}}
 const current=await readRecord<StorefrontPull>(owner,'channel_credential',key);if(current.version!==conn.version||current.cursor!==conn.cursor)return {status:'idle' as const};
 const at=new Date(now).toISOString(),next:StorefrontPull={...current,cursor:page.nextCursor??current.cursor,failures:0,lastAttemptAt:at,lastSuccessAt:at,lastError:null,nextAttemptAt:page.hasMore?at:new Date(now+current.intervalMinutes*60000).toISOString(),lastResult:{fetched:page.count,...summary,hasMore:page.hasMore}};
 await database().batch([...writes,recordStatement(owner,'channel_credential',key,next)]);
 return {status:'processed' as const,fetched:page.count,...summary,hasMore:page.hasMore};
}
/** Worker queue: at most 3 due connections per tick, only when storefront_pull is enabled. */
export async function runStorefrontPulls(owner:string,now=Date.now()){
 if(!await isEnabled(owner,'storefront_pull'))return {status:'idle' as const};
 const due=(await connections(owner)).filter(c=>c.enabled&&(!c.nextAttemptAt||Date.parse(c.nextAttemptAt)<=now)).slice(0,3);if(!due.length)return {status:'idle' as const};
 let processed=false,retry=false;for(const c of due){const r=await pullOnce(owner,c.id,now);processed||=r.status==='processed';retry||=r.status==='retry'}
 return {status:processed?'processed' as const:retry?'retry' as const:'idle' as const};
}
