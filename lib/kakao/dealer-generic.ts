// 카카오 비즈메시지 딜러사 API 참고 구현(C6). 문서화된 '일반 REST 모양'(기본 URL + API 키 헤더 + JSON)을 가정한다.
// ※ dealer-specific mapping needed: 실제 딜러사(NHN Cloud Notification, Kakao i Connect Message, SOLAPI 등)는 경로·필드·상태 문자열이 다르다.
//   대표가 딜러 계약을 맺은 뒤 GENERIC_SHAPE와 bodyOf()·메시지 id/비용 읽기만 그 딜러에 맞게 바꾸면 된다. 계약(BizMessageProvider)과 전송 규율은 그대로다.
// 규율: 전송은 한도 큐·429 백오프를 거치고, 보낸 뒤 결과를 모르면 unknown으로 돌려주며 절대 다시 보내지 않는다. 수신 번호·API 키는 로그·오류 문구에 싣지 않는다.
import {DEALER_POLICY,realDeps,resultStatus,runSend,toSendResult} from './dealer-outcome';
import type {AlimtalkRequest,BizMessageProvider,BrandMessageRequest,DealerAttempt,DealerCredential,MessageResult,SendResult,VerifyResult} from './types';
import type {RunDeps} from '../connectors/rate-queue';

export const GENERIC_SHAPE={
 alimtalk:'POST {baseUrl}/v1/alimtalk/messages',brand:'POST {baseUrl}/v1/brand/messages',result:'GET {baseUrl}/v1/messages/{messageId}',verify:'GET {baseUrl}/v1/sender-profiles/{senderKey}',
 apiKeyHeader:'X-Api-Key',idempotencyHeader:'Idempotency-Key',note:'dealer-specific mapping needed',
} as const;
export const DEFAULT_TIMEOUT_MS=10000;
type FetchFn=(input:string,init:RequestInit)=>Promise<Response>;
export type GenericDealerOptions={fetch?:FetchFn;deps?:RunDeps;timeoutMs?:number};

type Body=Record<string,unknown>;
const bodyOf=(text:string):Body|null=>{try{const v=JSON.parse(text) as unknown;return v&&typeof v==='object'&&!Array.isArray(v)?v as Body:null}catch{return null}};
const asText=(v:unknown)=>typeof v==='string'?v:undefined;
const asNumber=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const trimSlash=(url:string)=>url.replace(/\/+$/,'');

// 한 번의 HTTP 시도. fetch가 예외로 끝나면 보냈는지 알 수 없으므로 쓰기에는 sent:true(unknown)로 분류되게 한다(중복 전송보다 보수적).
async function attempt(fetchFn:FetchFn,url:string,init:RequestInit,timeoutMs:number):Promise<DealerAttempt>{
 // AbortController가 없는 런타임(평가 vm)에서는 시간 제한 없이 보낸다.
 const controller=typeof AbortController==='function'?new AbortController():null,timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
 try{
  const res=await fetchFn(url,controller?{...init,signal:controller.signal}:init),body=bodyOf(await res.text());
  return {kind:'response',status:res.status,retryAfter:res.headers.get('retry-after'),value:{messageId:asText(body?.messageId)??asText(body?.id),costKrw:asNumber(body?.costKrw),detail:asText(body?.message)??asText(body?.status)??''}};
 }catch{
  return controller?.signal.aborted?{kind:'timeout',sent:true}:{kind:'network_error',sent:true};
 }finally{if(timer)clearTimeout(timer)}
}

export function genericDealer(credential:DealerCredential,options:GenericDealerOptions={}):BizMessageProvider{
 const fetchFn:FetchFn=options.fetch??((input,init)=>fetch(input,init)),deps=options.deps??realDeps,timeoutMs=options.timeoutMs??DEFAULT_TIMEOUT_MS,base=trimSlash(credential.baseUrl);
 const headers=(idempotencyKey?:string):Record<string,string>=>({'content-type':'application/json',accept:'application/json',[GENERIC_SHAPE.apiKeyHeader]:credential.apiKey,...(idempotencyKey?{[GENERIC_SHAPE.idempotencyHeader]:idempotencyKey}:{})});
 const post=(path:string,payload:unknown,idempotencyKey:string):Promise<SendResult>=>runSend(`generic:${credential.senderKey}`,()=>attempt(fetchFn,base+path,{method:'POST',headers:headers(idempotencyKey),body:JSON.stringify(payload)},timeoutMs),deps,DEALER_POLICY).then(toSendResult);
 return {
  name:'generic',
  sendAlimtalk:(r:AlimtalkRequest)=>post('/v1/alimtalk/messages',{senderKey:r.senderKey,templateCode:r.templateCode,recipient:r.to,variables:r.variables},r.idempotencyKey),
  sendBrandMessage:(r:BrandMessageRequest)=>post('/v1/brand/messages',{senderKey:r.senderKey,recipient:r.to,text:r.text,buttons:r.buttons??[],ad:true},r.idempotencyKey),
  async getResult(messageId:string):Promise<MessageResult>{
   const a=await attempt(fetchFn,`${base}/v1/messages/${encodeURIComponent(messageId)}`,{method:'GET',headers:headers()},timeoutMs);
   if(a.kind!=='response'||a.status<200||a.status>=300)return {messageId,status:'unknown',detail:'결과를 조회하지 못했습니다. 나중에 다시 조회합니다.',costKrw:null};
   return {messageId,status:resultStatus(a.value?.detail),detail:a.value?.detail??'',costKrw:a.value?.costKrw??null};
  },
  async verify():Promise<VerifyResult>{
   const a=await attempt(fetchFn,`${base}/v1/sender-profiles/${encodeURIComponent(credential.senderKey)}`,{method:'GET',headers:headers()},timeoutMs);
   if(a.kind==='response'&&a.status>=200&&a.status<300)return {ok:true,account:credential.senderName||credential.senderKey,detail:'발신프로필을 확인했습니다.'};
   return {ok:false,account:'',detail:a.kind==='response'?`딜러가 발신프로필을 확인하지 못했습니다(${a.status}).`:'딜러에 연결하지 못했습니다.'};
  },
 };
}
