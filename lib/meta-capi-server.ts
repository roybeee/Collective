import type {Campaign} from './agency';
import type {Store} from './store-marketing';
import type {StoreOrder} from './store-operations';
import type {StorefrontOrderLink} from './storefront-orders';
import {conversionOrderIssues,type MetaConversionEvent} from './meta-conversion';
import type {MetaCapiPublic,MetaCapiState,MetaPixelEnvelope} from './meta-capi';
import {isEnabled} from './feature-flags';
import {META_READ_API_VERSION} from './meta-insights-provider';
import {readBoundedJson} from './http-limits';
import {ApiError,acquireLock,database,encrypt,listRecords,openSealed,readRecord,recordStatement,releaseLock,stamp} from './server';
type Connection={id:string;storeId:string;brandId:string;datasetId:string;origin:string;secret:string;version:number};
type Matching={emailHash:string;clientUserAgent:string;eventSourceUrl:string};
type Outbox={id:string;campaignId:string;storeId:string;brandId:string;datasetId:string;origin:string;connectionVersion:number;eventVersion:number;fieldConsent:{evidenceRef:string;fields:string[];purpose:'meta_ads_measurement';recordedAt:string};secret:string;state:MetaCapiState;attempts:number;version:number;updatedAt:string;reason:string;nextAttemptAt:number};
const aad=(owner:string,kind:string,id:string)=>`${owner}:${kind}:${id}`;
export async function limitMetaConversionMutation(owner:string){
 const now=Date.now(),key='meta-conversion:'+owner;
 await database().prepare('INSERT INTO auth_rate_limits(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END').bind(key,now,now-60000,now-60000).run();
 const row=await database().prepare('SELECT count FROM auth_rate_limits WHERE key=?').bind(key).first<{count:number}>();if(!row||row.count>60)throw new ApiError(429,'전환 요청이 많습니다. 잠시 후 다시 시도하세요.');
}
const optional=async<T>(owner:string,kind:string,id:string):Promise<T|null>=>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}};
export async function configureMetaCapi(owner:string,store:Store,b:Record<string,unknown>){
 const old=await optional<Connection>(owner,'meta_capi_connection',store.id);
 if(b.confirmed!==true||b.expectedConnectionVersion!==(old?.version??0))throw new ApiError(409,'현재 연결 버전과 별도 전환 전송 연결 승인을 확인하세요.');
 if(typeof b.datasetId!=='string'||!/^\d{5,30}$/.test(b.datasetId)||typeof b.token!=='string'||!/^[A-Za-z0-9_.|\-]{10,4096}$/.test(b.token))throw new ApiError(400,'데이터셋 ID와 전환 전용 토큰을 확인하세요.');
 let url:URL;try{url=new URL(String(b.origin))}catch{throw new ApiError(400,'자사몰 HTTPS 원본 주소가 필요합니다.')}
 if(url.protocol!=='https:'||url.origin!==b.origin||url.username||url.password||!url.hostname.includes('.')||/^(localhost|127\.|\[)/.test(url.hostname))throw new ApiError(400,'경로·쿼리가 없는 자사몰 HTTPS 원본 주소가 필요합니다.');
 const next:Connection={id:store.id,storeId:store.id,brandId:store.brandId,datasetId:b.datasetId,origin:url.origin,secret:await encrypt(b.token,{aad:aad(owner,'meta_capi_connection',store.id)}),version:(old?.version??0)+1};
 await recordStatement(owner,'meta_capi_connection',store.id,next,store.id).run();
}
export async function disconnectMetaCapi(owner:string,store:Store,expected:unknown){
 const c=await optional<Connection>(owner,'meta_capi_connection',store.id);if(!c||expected!==c.version)throw new ApiError(409,'연결이 변경되었습니다.');
 // Retain dataset binding/version, destroy the token. Reconnection cannot migrate an event to a different dataset.
 await recordStatement(owner,'meta_capi_connection',store.id,{...c,secret:'',version:c.version+1},store.id).run();
}
export async function metaCapiView(owner:string,store:Store):Promise<MetaCapiPublic>{
 const [enabled,c,ops]=await Promise.all([isEnabled(owner,'meta_ads_capi'),optional<Connection>(owner,'meta_capi_connection',store.id),listRecords<Outbox>(owner,'meta_capi_outbox',store.id)]);
 return {enabled,connection:c?{datasetId:c.datasetId,origin:c.origin,version:c.version,connected:!!c.secret}:null,operations:ops.map(({id,state,attempts,version,updatedAt,reason,nextAttemptAt})=>({id,state,attempts,version,updatedAt,reason,nextAttemptAt}))};
}
async function validEvent(owner:string,store:Store,id:string){
 const event=await readRecord<MetaConversionEvent>(owner,'meta_conversion_event',id),order=await readRecord<StoreOrder>(owner,'store_order',event.orderId),links=await listRecords<StorefrontOrderLink>(owner,'storefront_order_link',store.id);
 if(store.status!=='active'||event.storeId!==store.id||event.brandId!==store.brandId||order.storeId!==store.id||event.consent!=='granted'||conversionOrderIssues(order,event).length||!links.some(x=>x.orderId===order.id&&x.brandId===store.brandId&&x.storeId===store.id))throw new ApiError(409,'현재 주문·연결·고객 동의를 다시 확인하세요.');
 if(event.eventTime>Math.floor(Date.now()/1000)||event.eventTime<Math.floor(Date.now()/1000)-604800)throw new ApiError(409,'구매 시각이 Meta의 7일 전송 범위를 벗어났습니다.');
 return event;
}
function matchingInput(b:Record<string,unknown>,c:Connection):Matching{
 if(b.confirmed!==true||b.fieldsConsented!==true||typeof b.emailHash!=='string'||!(/^[a-f0-9]{64}$/).test(b.emailHash)||typeof b.clientUserAgent!=='string'||b.clientUserAgent.length<3||b.clientUserAgent.length>512||/[\r\n]/.test(b.clientUserAgent))throw new ApiError(400,'이메일 SHA-256와 실제 구매 브라우저 정보의 전송 동의를 확인하세요. 원문 개인정보는 입력하지 마세요.');
 let u:URL;try{u=new URL(String(b.eventSourceUrl))}catch{throw new ApiError(400,'실제 구매 페이지 주소를 확인하세요.')}
 if(u.origin!==c.origin||u.search||u.hash||u.username||u.password||u.pathname.length>200||!/^\/[a-zA-Z0-9/_-]*$/.test(u.pathname))throw new ApiError(400,'연결된 자사몰의 개인정보 없는 고정 구매 페이지 주소가 필요합니다.');
 return {emailHash:b.emailHash,clientUserAgent:b.clientUserAgent,eventSourceUrl:u.href};
}
export async function queueMetaCapi(owner:string,campaign:Campaign,store:Store,b:Record<string,unknown>){
 if(!await isEnabled(owner,'meta_ads_capi'))throw new ApiError(409,'전환 전송 기능 스위치가 꺼져 있습니다.');
 const c=await optional<Connection>(owner,'meta_capi_connection',store.id);if(!c?.secret||c.brandId!==store.brandId||campaign.storeId!==store.id||campaign.brandId!==store.brandId||campaign.status==='archived')throw new ApiError(409,'현재 캠페인·지점의 전환 연결이 필요합니다.');
 const event=await validEvent(owner,store,String(b.eventId));if(b.expectedVersion!==event.version)throw new ApiError(409,'동의 기록이 변경되었습니다.');
 const matching=matchingInput(b,c),old=await optional<Outbox>(owner,'meta_capi_outbox',event.id);if(old)throw new ApiError(409,'같은 구매의 전송 대장이 이미 있습니다. 상태를 확인하세요.');
 const o:Outbox={id:event.id,campaignId:campaign.id,storeId:store.id,brandId:store.brandId,datasetId:c.datasetId,origin:c.origin,connectionVersion:c.version,eventVersion:event.version,fieldConsent:{evidenceRef:event.evidenceRef,fields:['em','client_user_agent','event_source_url','purchase'],purpose:'meta_ads_measurement',recordedAt:stamp()},secret:await encrypt(JSON.stringify(matching),{aad:aad(owner,'meta_capi_outbox',event.id)}),state:'queued',attempts:0,version:1,updatedAt:stamp(),reason:'고객 필드 동의 확인 후 대기',nextAttemptAt:0};
 await database().batch([recordStatement(owner,'meta_capi_outbox',o.id,o,store.id),audit(owner,o)]);
}
function audit(owner:string,o:Outbox){
 const id=o.id+':'+o.version,data={id,eventId:o.id,storeId:o.storeId,state:o.state,attempts:o.attempts,reason:o.reason,fieldConsent:o.fieldConsent,updatedAt:o.updatedAt};
 // Only the actual persisted transition can append its immutable audit row.
 return database().prepare("INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE owner=? AND kind='meta_capi_outbox' AND id=? AND data=?)").bind(`${owner}:meta_capi_audit:${id}`,owner,'meta_capi_audit',o.storeId,JSON.stringify(data),o.updatedAt,owner,aad(owner,'meta_capi_outbox',o.id),JSON.stringify(o));
}
export async function purgeMetaCapiMatching(owner:string,id:string){const o=await optional<Outbox>(owner,'meta_capi_outbox',id);if(o)await save(owner,o,{secret:'',state:o.state==='accepted'?'accepted':'blocked',reason:'동의 철회 · 저장된 매칭 정보 파기, 과거 수신 취소는 별도 처리'});}
async function save(owner:string,old:Outbox,patch:Partial<Outbox>){
 const next={...old,...patch,version:old.version+1,updatedAt:stamp()};
 const results=await database().batch([database().prepare("UPDATE records SET data=?,updated_at=? WHERE owner=? AND kind='meta_capi_outbox' AND id=? AND data=?").bind(JSON.stringify(next),next.updatedAt,owner,aad(owner,'meta_capi_outbox',old.id),JSON.stringify(old)),audit(owner,next)]);
 if(!results[0].meta.changes)throw new ApiError(409,'전환 대장이 변경되었습니다.');return next;
}
export async function metaPixelEnvelope(owner:string,store:Store,id:string):Promise<MetaPixelEnvelope>{
 if(!await isEnabled(owner,'meta_ads_capi'))throw new ApiError(409,'전환 전송 기능 스위치가 꺼져 있습니다.');
 const event=await validEvent(owner,store,id),o=await readRecord<Outbox>(owner,'meta_capi_outbox',id),c=await optional<Connection>(owner,'meta_capi_connection',store.id);
 if(!c?.secret||c.datasetId!==o.datasetId||c.origin!==o.origin||o.storeId!==store.id||o.brandId!==store.brandId||o.eventVersion!==event.version||['blocked','rejected'].includes(o.state))throw new ApiError(409,'전환 전송 계약을 다시 확인하세요.');
 return {datasetId:c.datasetId,eventId:event.eventId,eventName:'Purchase',value:event.value,currency:event.currency,expiresAt:Date.now()+300000};
}
async function sendOne(owner:string,o:Outbox){
 let event:MetaConversionEvent,c:Connection,matching:Matching,token:string;
 try{
  const store=await readRecord<Store>(owner,'store',o.storeId),campaign=await readRecord<Campaign>(owner,'campaign',o.campaignId);event=await validEvent(owner,store,o.id);
  const current=await optional<Connection>(owner,'meta_capi_connection',store.id);
  if(!current?.secret||current.datasetId!==o.datasetId||current.origin!==o.origin||current.brandId!==o.brandId||campaign.brandId!==o.brandId||campaign.storeId!==o.storeId||campaign.status==='archived'||event.version!==o.eventVersion)throw new Error();c=current;
  matching=JSON.parse((await openSealed(o.secret,aad(owner,'meta_capi_outbox',o.id))).plain) as Matching;
  matchingInput({...matching,confirmed:true,fieldsConsented:true},c);token=(await openSealed(c.secret,aad(owner,'meta_capi_connection',c.id))).plain;
 }catch{await save(owner,o,{state:'blocked',secret:'',reason:'주문·동의·연결이 변경되어 차단됨'});return}
 const sending=await save(owner,o,{state:'sending',attempts:o.attempts+1,nextAttemptAt:Date.now()+300000,reason:'공급자 응답 대기'});
 let state:MetaCapiState='unknown',reason='수신 결과 미확인 · 같은 구매 ID로 제한 재시도';
 try{
  const r=await fetch(`https://graph.facebook.com/${META_READ_API_VERSION}/${c.datasetId}/events`,{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({data:[{event_name:'Purchase',event_time:event.eventTime,event_id:event.eventId,action_source:'website',event_source_url:matching.eventSourceUrl,user_data:{em:[matching.emailHash],client_user_agent:matching.clientUserAgent},custom_data:{currency:'KRW',value:event.value}}]}),signal:AbortSignal.timeout(15000)});
  const data=await readBoundedJson<{events_received?:number}>(r,32768);
  if(r.ok&&data.events_received===1){state='accepted';reason='Meta 수신 1건 확인 · 귀속/중복 제거 성공은 별도 확인'}
  else if(r.status>=400&&r.status<500&&r.status!==429){state='rejected';reason='공급자가 전환 계약/권한을 거부함'}
 }catch{/* Do not expose provider responses or matching data. Durable sending survives a process exit. */}
 await save(owner,sending,{state,reason,secret:['accepted','rejected'].includes(state)?'':sending.secret});
}
// Worker-safe bounded batch. The same owner lock serializes revocation, queueing and a provider attempt.
export async function advanceMetaConversionWork(owner:string){
 if(!await isEnabled(owner,'meta_ads_capi'))return {processed:0};
 let lock='';try{lock=await acquireLock(owner);const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='meta_capi_outbox' AND json_extract(data,'$.state') IN ('queued','sending','unknown') AND json_extract(data,'$.nextAttemptAt')<=? ORDER BY updated_at LIMIT 3").bind(owner,Date.now()).all<{data:string}>();let processed=0;
  for(const row of rows.results){if(!await isEnabled(owner,'meta_ads_capi'))break;const o=JSON.parse(row.data) as Outbox;if(o.attempts>=3){await save(owner,o,{state:'unknown',secret:'',nextAttemptAt:Number.MAX_SAFE_INTEGER,reason:'재시도 3회 한도 · 수신 여부를 Meta에서 확인하세요.'});continue}await sendOne(owner,o);processed++}return {processed};
 }finally{if(lock)await releaseLock(owner,lock)}
}
