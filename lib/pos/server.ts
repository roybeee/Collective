// 토스플레이스 POS 연결·조회·웹훅 서버(C7). 연결은 외부 몰 조회 연결과 같은 kind(channel_credential, channel 'pos_tossplace')에 저장하고
// 키 쌍·웹훅 서명 키는 봉인(sealRecordSecret)한다. lib/channel-credentials.ts는 커넥터 키(naver_ads·instagram)에 묶여 있어 그 모듈은 바꾸지 않았다.
// 읽기 전용: 주문·결제 조회와 웹훅 수신만 하고 토스플레이스에 아무것도 쓰지 않는다. 커서는 주문 저장과 같은 묶음에서만 전진한다.
import type {Store} from '../store-marketing';
import {openRecordSecret,sealRecordSecret} from '../credential-crypto-server';
import {koreaToday} from '../store-operations';
import {ImportError} from '../order-import';
import {StorefrontInputError} from '../storefront-orders';
import {backoffMs} from '../storefront-pull';
import {prepareExternalOrderImport,type IngestSummary} from '../order-ingest-server';
import {isEnabled} from '../feature-flags';
import {ApiError,acquireLock,database,readRecord,recordStatement,releaseLock,stamp,type Actor} from '../server';
import {initialCursor,parseTossplaceWebhook,tossplaceProvider,TOSSPLACE_NUDGE_EVENTS} from './tossplace';
import type {PosCredential,PosCursor,PosFailure} from './types';

export const POS_CHANNEL='pos_tossplace',POS_SOURCE_KEY='tossplace',POS_MAX_CONNECTIONS=50,POS_WEBHOOK_MAX_BYTES=256_000,POS_DEFAULT_SINCE_DAYS=30;
export type PosResult=IngestSummary&{fetched:number;skipped:number;hasMore:boolean};
export type PosConnection={channel:typeof POS_CHANNEL;id:string;storeId:string;brandId:string;provider:'tossplace';merchantId:string;sourceKey:string;secret:string;since:string;intervalMinutes:number;enabled:boolean;webhookEnabled:boolean;version:number;cursor:PosCursor|null;failures:number;lastAttemptAt:string|null;lastSuccessAt:string|null;nextAttemptAt:string|null;lastError:string|null;lastResult:PosResult|null;lastWebhookAt:string|null;createdAt:string;updatedAt:string;updatedBy:string};
export type PosWebhookEvent={id:string;connectionId:string;storeId:string;merchantId:string;type:string;webhookId:string;receivedAt:string;result:{imported:IngestSummary|null;skipped:string|null;nudged:boolean}};
export type PosConnectionInput={storeId:string;merchantId:string;accessKey:string;secretKey:string;webhookSecret:string;intervalMinutes:number;since:string};
export const posRecordId=(id:string)=>POS_CHANNEL+':'+id;
const publicView=({secret:_s,...rest}:PosConnection)=>{void _s;return rest};
const bad=(message:string)=>new ApiError(400,message);
const ID=/^[A-Za-z0-9_-]{1,100}$/,MERCHANT=/^\d{1,19}$/,KEY=/^\S{8,500}$/,DAY=/^\d{4}-\d{2}-\d{2}$/;
const sinceIso=(day:string)=>new Date(day+'T00:00:00+09:00').toISOString();

export function parsePosInput(value:unknown,requireKeys:boolean,today=koreaToday()):PosConnectionInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw bad('POS 연결 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(typeof b.storeId!=='string'||!ID.test(b.storeId))throw bad('지점을 확인하세요.');
 if(typeof b.merchantId!=='string'||!MERCHANT.test(b.merchantId))throw bad('매장 ID(merchantId)는 숫자만 입력하세요. POS 로그인용 매장고유번호와 다릅니다.');
 const key=(v:unknown,label:string,required:boolean)=>{const s=v===undefined||v===null?'':String(v);if((required||s)&&!KEY.test(s))throw bad(`${label}는 공백 없는 8~500자입니다.`);return s};
 const accessKey=key(b.accessKey,'API Access Key',requireKeys),secretKey=key(b.secretKey,'API Secret Key',requireKeys);
 if(!!accessKey!==!!secretKey)throw bad('Access Key와 Secret Key를 함께 입력하세요.');
 const webhookSecret=key(b.webhookSecret,'웹훅 서명 키',false);
 if(typeof b.intervalMinutes!=='number'||!Number.isSafeInteger(b.intervalMinutes)||b.intervalMinutes<15||b.intervalMinutes>1440)throw bad('조회 간격은 15~1440분입니다.');
 const since=b.since===undefined||b.since===''?new Date(Date.parse(today+'T00:00:00Z')-POS_DEFAULT_SINCE_DAYS*86400000).toISOString().slice(0,10):String(b.since);
 if(!DAY.test(since)||!Number.isFinite(Date.parse(since))||since>today)throw bad('조회 시작일은 오늘까지의 날짜로 입력하세요.');
 return {storeId:b.storeId,merchantId:b.merchantId,accessKey,secretKey,webhookSecret,intervalMinutes:b.intervalMinutes,since};
}
async function connections(owner:string){return (await database().prepare("SELECT data FROM records WHERE owner=? AND kind='channel_credential' AND json_extract(data,'$.channel')='pos_tossplace' LIMIT 51").bind(owner).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as PosConnection)}
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const seal=(owner:string,id:string,c:PosCredential)=>sealRecordSecret(owner,'channel_credential',posRecordId(id),JSON.stringify(c));
async function credentialOf(owner:string,conn:PosConnection):Promise<PosCredential>{return JSON.parse(await openRecordSecret(owner,'channel_credential',posRecordId(conn.id),conn.secret)) as PosCredential}

export async function posConnectionView(who:Actor){
 return {connections:(await connections(who.owner)).map(publicView),enabled:await isEnabled(who.owner,'pos_tossplace'),canEdit:who.role==='owner',externalWrites:0 as const,webhookPath:'/api/pos/tossplace/webhook'};
}
async function createConnection(who:Actor,b:Record<string,unknown>,at:string){
 const input=parsePosInput(b.input,true),store=await readRecord<Store>(who.owner,'store',input.storeId);if(store.status!=='active')throw new ApiError(409,'운영 중인 지점만 연결합니다.');
 const rows=await connections(who.owner);if(rows.length>=POS_MAX_CONNECTIONS)throw new ApiError(409,`POS 연결은 ${POS_MAX_CONNECTIONS}개까지입니다.`);
 if(rows.some(c=>c.merchantId===input.merchantId))throw new ApiError(409,'같은 매장 ID가 이미 연결되어 있습니다.');
 const id=crypto.randomUUID(),secret=await seal(who.owner,id,{accessKey:input.accessKey,secretKey:input.secretKey,webhookSecret:input.webhookSecret});
 const row:PosConnection={channel:POS_CHANNEL,id,storeId:store.id,brandId:store.brandId,provider:'tossplace',merchantId:input.merchantId,sourceKey:POS_SOURCE_KEY,secret,since:input.since,intervalMinutes:input.intervalMinutes,enabled:false,webhookEnabled:!!input.webhookSecret,version:1,cursor:null,failures:0,lastAttemptAt:null,lastSuccessAt:null,nextAttemptAt:null,lastError:null,lastResult:null,lastWebhookAt:null,createdAt:at,updatedAt:at,updatedBy:who.id};
 await recordStatement(who.owner,'channel_credential',posRecordId(id),row).run();return {recorded:true as const,connection:publicView(row)};
}
async function updateConnection(who:Actor,old:PosConnection,b:Record<string,unknown>):Promise<PosConnection>{
 const input=parsePosInput({...(b.input as object),storeId:old.storeId},false);
 const previous=await credentialOf(who.owner,old),credential:PosCredential={accessKey:input.accessKey||previous.accessKey,secretKey:input.secretKey||previous.secretKey,webhookSecret:b.input&&(b.input as Record<string,unknown>).webhookSecret!==undefined?input.webhookSecret:previous.webhookSecret};
 if((await connections(who.owner)).some(c=>c.id!==old.id&&c.merchantId===input.merchantId))throw new ApiError(409,'같은 매장 ID가 이미 연결되어 있습니다.');
 const reset=input.merchantId!==old.merchantId||input.since!==old.since;
 return {...old,merchantId:input.merchantId,since:input.since,intervalMinutes:input.intervalMinutes,secret:await seal(who.owner,old.id,credential),webhookEnabled:!!credential.webhookSecret,...(reset?{cursor:null}:{})};
}
export async function savePosConnection(who:Actor,b:Record<string,unknown>){
 if(who.role!=='owner')throw new ApiError(403,'POS 연결은 소유자만 설정합니다.');
 const action=String(b.action??''),at=stamp();
 if(action==='create')return createConnection(who,b,at);
 const id=String(b.id??'');if(!/^[a-f0-9-]{36}$/.test(id))throw bad('연결 ID를 확인하세요.');
 const old=await readRecord<PosConnection>(who.owner,'channel_credential',posRecordId(id));if(old.channel!==POS_CHANNEL)throw new ApiError(404,'POS 연결이 아닙니다.');
 if(b.expectedVersion!==old.version)throw new ApiError(409,'연결 설정이 변경되었습니다. 다시 불러오세요.');
 let next:PosConnection;
 if(action==='update')next=await updateConnection(who,old,b);
 else if(action==='enable'||action==='disable')next={...old,enabled:action==='enable',...(action==='enable'?{failures:0,nextAttemptAt:null,lastError:null}:{})};
 else if(action==='reset_cursor')next={...old,cursor:null,failures:0,nextAttemptAt:null};
 else throw bad('지원하지 않는 연결 작업입니다.');
 next={...next,version:old.version+1,updatedAt:at,updatedBy:who.id};await recordStatement(who.owner,'channel_credential',posRecordId(id),next).run();return {recorded:true as const,connection:publicView(next)};
}
const failureCode=(f:PosFailure)=>f.kind;
/** 한 페이지 조회. 읽기 전용이며 반영은 주문 개정 번호로 멱등이라 재시도한 페이지가 두 번 세어지지 않는다. 실패(시간 초과 포함)하면 커서를 바꾸지 않는다. */
export async function pullOnce(owner:string,id:string,now=Date.now()){
 const key=posRecordId(id),conn=await readRecord<PosConnection>(owner,'channel_credential',key);if(conn.channel!==POS_CHANNEL||!conn.enabled)return {status:'idle' as const};
 const store=await readRecord<Store>(owner,'store',conn.storeId);
 const fail=async(code:string,retryAt:number|null=null)=>{const failures=conn.failures+1,wait=Math.max(now+backoffMs(failures,conn.intervalMinutes),retryAt??0);const next={...conn,failures,lastAttemptAt:new Date(now).toISOString(),lastError:code,nextAttemptAt:new Date(wait).toISOString()};await recordStatement(owner,'channel_credential',key,next).run();return {status:'retry' as const,error:code}};
 if(store.status!=='active'||store.brandId!==conn.brandId)return fail('store_inactive');
 let credential:PosCredential;try{credential=await credentialOf(owner,conn)}catch{return fail('credential_unreadable')}
 const listed=await tossplaceProvider.listOrders(credential,conn.merchantId,conn.cursor??initialCursor(sinceIso(conn.since),now),koreaToday(),now);
 if(!listed.ok)return fail(failureCode(listed.failure),listed.failure.retryAt);
 const {page}=listed;let writes:D1PreparedStatement[]=[],summary:IngestSummary={created:0,updated:0,duplicates:0,older:0};
 if(page.rows.length){try{const p=await prepareExternalOrderImport(owner,store,conn.sourceKey,'pos',page.rows,'pos:'+id);writes=p.writes;const {created,updated,duplicates,older}=p.result;summary={created,updated,duplicates,older}}catch(e){return fail(e instanceof ImportError||e instanceof StorefrontInputError||(e instanceof ApiError&&e.status===409)?'rejected_orders':'import_failed')}}
 const current=await readRecord<PosConnection>(owner,'channel_credential',key);if(current.version!==conn.version||JSON.stringify(current.cursor)!==JSON.stringify(conn.cursor))return {status:'idle' as const};
 const at=new Date(now).toISOString(),next:PosConnection={...current,cursor:page.nextCursor,failures:0,lastAttemptAt:at,lastSuccessAt:at,lastError:null,nextAttemptAt:page.hasMore?at:new Date(now+current.intervalMinutes*60000).toISOString(),lastResult:{fetched:page.count,skipped:page.skipped,...summary,hasMore:page.hasMore}};
 await database().batch([...writes,recordStatement(owner,'channel_credential',key,next)]);
 return {status:'processed' as const,fetched:page.count,skipped:page.skipped,...summary,hasMore:page.hasMore};
}
/** 워커 큐 pos_pull: 스위치 pos_tossplace가 켜진 소유자의 기한 지난 연결을 tick마다 최대 3개 읽는다. */
export async function runPosPulls(owner:string,now=Date.now()){
 if(!await isEnabled(owner,'pos_tossplace'))return {status:'idle' as const};
 const due=(await connections(owner)).filter(c=>c.enabled&&(!c.nextAttemptAt||Date.parse(c.nextAttemptAt)<=now)).slice(0,3);if(!due.length)return {status:'idle' as const};
 let processed=false,retry=false;for(const c of due){const r=await pullOnce(owner,c.id,now);processed||=r.status==='processed';retry||=r.status==='retry'}
 return {status:processed?'processed' as const:retry?'retry' as const:'idle' as const};
}
const unauthorized=()=>new ApiError(401,'웹훅 인증을 확인하세요.');
async function connectionForMerchant(merchantId:string){
 const rows=await database().prepare("SELECT owner,data FROM records WHERE kind='channel_credential' AND json_extract(data,'$.channel')='pos_tossplace' AND json_extract(data,'$.merchantId')=? LIMIT 2").bind(merchantId).all<{owner:string;data:string}>();
 if(rows.results.length!==1)throw unauthorized();
 return {owner:rows.results[0].owner,connection:JSON.parse(rows.results[0].data) as PosConnection};
}
/** 웹훅 수신: 서명·시각 창 검증 → x-toss-webhook-id 멱등 → 주문 생성 이벤트(주문 전체)는 바로 반영, 그 밖의 주문·결제 이벤트는 다음 조회를 재촉한다. 외부 호출 없음. */
export async function receivePosWebhook(raw:string,headers:Headers,now=Date.now()){
 const event=parseTossplaceWebhook(raw);if(!event)throw bad('웹훅 본문 형식을 확인하세요.');
 const found=await connectionForMerchant(event.merchantId);if(!found.connection.enabled||!found.connection.webhookEnabled)throw unauthorized();
 const credential=await credentialOf(found.owner,found.connection),verdict=await tossplaceProvider.verifyWebhook(credential.webhookSecret,headers,raw,now);if(!verdict.ok)throw unauthorized();
 const owner=found.owner,lock=await acquireLock(owner);
 try{
  const current=await readRecord<PosConnection>(owner,'channel_credential',posRecordId(found.connection.id));if(!current.enabled||current.version!==found.connection.version)throw new ApiError(409,'연결 설정이 변경되었습니다. 새 설정을 확인하세요.');
  const eventId=current.id+':'+verdict.webhookId;if(await optional<PosWebhookEvent>(owner,'pos_webhook_event',eventId))return {received:true as const,duplicate:true as const,externalTransmissions:0 as const};
  const store=await readRecord<Store>(owner,'store',current.storeId);if(store.status!=='active'||store.brandId!==current.brandId)throw new ApiError(409,'주문을 수신할 지점 상태를 확인하세요.');
  let writes:D1PreparedStatement[]=[],imported:IngestSummary|null=null,skipped:string|null=null;
  if(event.order){const n=tossplaceProvider.normalize(event.order,koreaToday());if('skip' in n)skipped=n.skip;else{const p=await prepareExternalOrderImport(owner,store,current.sourceKey,'pos',[n.row],'webhook:'+current.id);writes=p.writes;const {created,updated,duplicates,older}=p.result;imported={created,updated,duplicates,older}}}
  const nudged=!event.order&&TOSSPLACE_NUDGE_EVENTS.includes(event.type),at=new Date(now).toISOString();
  const record:PosWebhookEvent={id:eventId,connectionId:current.id,storeId:store.id,merchantId:current.merchantId,type:event.type,webhookId:verdict.webhookId,receivedAt:at,result:{imported,skipped,nudged}};
  await database().batch([...writes,recordStatement(owner,'pos_webhook_event',eventId,record,store.id),recordStatement(owner,'channel_credential',posRecordId(current.id),{...current,lastWebhookAt:at,...(nudged?{nextAttemptAt:at}:{})})]);
  return {received:true as const,duplicate:false as const,...(imported??{created:0,updated:0,duplicates:0,older:0}),skipped,nudged,externalTransmissions:0 as const};
 }finally{await releaseLock(owner,lock)}
}
