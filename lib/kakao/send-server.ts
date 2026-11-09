// C6 전송 파이프라인(docs/KAKAO-BIZMESSAGE.ko.md 6절): 초안 → 컴플라이언스 판정 → 사람 승인(assertAutonomy('customer_send'), 자동 불가) → 딜러 전송(멱등 키) → 결과 폴링 → 레코드.
// 레코드 kind 'bizmessage_send'(브랜드에 묶임, 캠페인 무관). 수신자는 해시만 저장하고, 실제 번호는 전송 요청 때 사람이 넣어 해시 대조 뒤 딜러에게만 넘긴다(레코드·로그에 없음).
// 스위치 kakao_bizmessage(기본 꺼짐)는 이 파일에서만 읽는다. 꺼져 있어도 판정·초안·승인·조회는 되고 전송·결과 폴링만 409다.
// 전송은 보내기 전에 status 'sending'을 영속하고(저널), 결과를 모르면 'unknown'으로 남겨 다시 보내지 않는다. 같은 초안을 다시 보내면 저장된 레코드를 그대로 돌려준다.
import {ApiError,database,readRecord,recordStatement,stamp,str,uid,type Actor} from '../server';
import {isEnabled} from '../feature-flags';
import {assertAutonomy} from '../autonomy-server';
import {checkKakaoCompliance,kstParts,type Classification,type ComplianceVerdict} from './compliance';
import {normalizePhone,snapshotOf} from './consent';
import {readConsent,readOptout,requireBrand,resolveRecipientHash} from './consent-server';
import {defaultProviderFactory,loadDealer,type ProviderFactory} from './credential-server';
import {KAKAO_FLAG} from './registry-descriptor';
import type {BrandMessageButton,MessageType,SendResult} from './types';

const kinds={send:'bizmessage_send'} as const;
export const SEND_KIND=kinds.send;
export type SendStatus='draft'|'approved'|'sending'|'sent'|'failed'|'unknown';
export type SendRecord={id:string;brandId:string;campaignId:null;type:MessageType;classification:Classification;recipientHash:string;senderName:string;templateCode:string|null;variables:Record<string,string>;text:string;buttons:BrandMessageButton[];
 status:SendStatus;compliance:ComplianceVerdict;idempotencyKey:string;approval:{by:string;at:string;autonomy:string}|null;send:{at:string;day:string;outcome:SendResult['outcome']|null;messageId:string|null;costKrw:number|null;detail:string;attempts:number}|null;
 result:{status:string;checkedAt:string;detail:string;costKrw:number|null}|null;version:number;createdAt:string;createdBy:string;updatedAt:string;updatedBy:string};
export const SEND_LIMITS={textChars:1000,buttons:5,buttonName:14,variables:20,list:200} as const;
export const SWITCH_OFF=`기능 스위치 ${KAKAO_FLAG}가 꺼져 있어 전송하지 않습니다. 판정·초안·승인은 계속됩니다.`;

export async function kakaoEnabled(owner:string){return isEnabled(owner,KAKAO_FLAG).catch(()=>{console.error('kakao_bizmessage_flag_unreadable');return false})}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const messageType=(v:unknown):MessageType=>{if(v!=='alimtalk'&&v!=='brand')throw new ApiError(400,"메시지 유형은 'alimtalk'(알림톡) 또는 'brand'(브랜드 메시지)입니다.");return v};
function buttonsOf(v:unknown):BrandMessageButton[]{
 if(v===undefined||v===null)return [];
 if(!Array.isArray(v)||v.length>SEND_LIMITS.buttons)throw new ApiError(400,`버튼은 ${SEND_LIMITS.buttons}개까지입니다.`);
 return v.map(b=>{
  if(!record(b))throw new ApiError(400,'버튼 입력을 확인해 주세요.');
  const url=str(b.url,'버튼 주소',500,true);
  if(!/^https:\/\//.test(url))throw new ApiError(400,'버튼 주소는 https여야 합니다.');
  return {name:str(b.name,'버튼 이름',SEND_LIMITS.buttonName,true),url};
 });
}
function variablesOf(v:unknown):Record<string,string>{
 if(v===undefined||v===null)return {};
 if(!record(v)||Object.keys(v).length>SEND_LIMITS.variables)throw new ApiError(400,`템플릿 변수는 ${SEND_LIMITS.variables}개까지입니다.`);
 return Object.fromEntries(Object.entries(v).map(([k,val])=>[str(k,'변수 이름',50,true),str(val,'변수 값',200)]));
}
async function version(input:Record<string,unknown>,current:SendRecord){
 if(input.version!==undefined&&input.version!==current.version)throw new ApiError(409,'전송 기록이 다른 곳에서 바뀌었습니다. 최신 판을 확인하세요.');
}
// 수신자별 오늘(KST) 광고성 전송 수. 보냄·결과 미확인·전송 중을 모두 센다(모르는 결과도 보냈을 수 있다).
export async function adSentToday(owner:string,brandId:string,recipientHash:string,day:string){
 const row=await database().prepare(`SELECT COUNT(*) n FROM records WHERE owner=? AND kind='bizmessage_send' AND parent_id=? AND json_extract(data,'$.recipientHash')=? AND json_extract(data,'$.classification')='advertising' AND json_extract(data,'$.status') IN ('sending','sent','unknown') AND json_extract(data,'$.send.day')=?`).bind(owner,brandId,recipientHash,day).first<{n:number}>();
 return row?.n??0;
}
export type EvaluateInput={brandId:string;recipientHash:string;type:MessageType;text:string;senderName:string};
export async function evaluateMessage(owner:string,e:EvaluateInput,nowMs:number):Promise<ComplianceVerdict>{
 const [consent,optout,sent]=await Promise.all([readConsent(owner,e.brandId,e.recipientHash),readOptout(owner,e.brandId,e.recipientHash),adSentToday(owner,e.brandId,e.recipientHash,kstParts(nowMs).date)]);
 return checkKakaoCompliance({type:e.type,text:e.text,senderName:e.senderName,now:nowMs,consent:snapshotOf(consent),optedOut:!!optout,adSentToday:sent});
}
// 전송자 명칭은 연결된 딜러 자격증명(발신프로필)의 이름을 우선 쓰고, 연결 전이면 입력값을 쓴다(판정 미리보기용).
async function senderNameFor(owner:string,brandId:string,input:Record<string,unknown>){
 try{return (await loadDealer(owner,{brandId})).credential.senderName}catch(e){if(e instanceof ApiError&&e.status===409)return input.senderName===undefined?'':str(input.senderName,'전송자 명칭',100);throw e}
}
type Parsed={brandId:string;recipientHash:string;type:MessageType;text:string;senderName:string;templateCode:string|null;variables:Record<string,string>;buttons:BrandMessageButton[]};
async function parseMessage(owner:string,input:Record<string,unknown>):Promise<Parsed>{
 const brandId=await requireBrand(owner,input.brandId),type=messageType(input.type),recipientHash=await resolveRecipientHash(owner,input);
 const text=str(input.text,'본문',SEND_LIMITS.textChars,true),templateCode=type==='alimtalk'?str(input.templateCode,'알림톡 템플릿 코드',100,true):null;
 return {brandId,recipientHash,type,text,senderName:await senderNameFor(owner,brandId,input),templateCode,variables:type==='alimtalk'?variablesOf(input.variables):{},buttons:type==='brand'?buttonsOf(input.buttons):[]};
}
// 판정 미리보기(저장 없음). 스위치와 무관하다.
export async function checkMessage(owner:string,input:Record<string,unknown>,nowMs=Date.now()){
 const p=await parseMessage(owner,input);
 return {brandId:p.brandId,recipientHash:p.recipientHash,type:p.type,verdict:await evaluateMessage(owner,p,nowMs)};
}
export async function readSend(owner:string,id:unknown){
 const key=str(id,'전송 기록 ID',100,true);
 try{return await readRecord<SendRecord>(owner,kinds.send,key)}catch(e){if(e instanceof ApiError&&e.status===404)throw new ApiError(404,'전송 기록을 찾을 수 없습니다.');throw e}
}
async function save(owner:string,next:SendRecord){await recordStatement(owner,kinds.send,next.id,next,next.brandId).run();return next}

// 초안: 판정 결과를 함께 저장한다. 판정이 막혀도 초안은 남긴다(고치고 다시 판정). 스위치와 무관하다.
export async function draftMessage(owner:string,who:Actor,input:Record<string,unknown>,nowMs=Date.now()):Promise<SendRecord>{
 const p=await parseMessage(owner,input),at=new Date(nowMs).toISOString(),verdict=await evaluateMessage(owner,p,nowMs),id=uid();
 return save(owner,{id,brandId:p.brandId,campaignId:null,type:p.type,classification:verdict.classification,recipientHash:p.recipientHash,senderName:p.senderName,templateCode:p.templateCode,variables:p.variables,text:p.text,buttons:p.buttons,
  status:'draft',compliance:verdict,idempotencyKey:`kakao:${owner}:${id}`,approval:null,send:null,result:null,version:1,createdAt:at,createdBy:who.id,updatedAt:at,updatedBy:who.id});
}
// 승인: 소유자·관리자가 누른다. 자율성 규칙 customer_send는 고위험이라 auto가 될 수 없고(lib/autonomy.ts), never면 403이다. 승인 시점에 판정을 다시 해 막히면 409다.
export async function approveMessage(owner:string,who:Actor,input:Record<string,unknown>,nowMs=Date.now()):Promise<SendRecord>{
 if(who.role==='member')throw new ApiError(403,'소유자·관리자만 전송을 승인할 수 있습니다.');
 const current=await readSend(owner,input.id);await version(input,current);
 if(current.status!=='draft')throw new ApiError(409,'초안 상태의 기록만 승인할 수 있습니다.');
 const decision=await assertAutonomy(owner,'customer_send');
 const verdict=await evaluateMessage(owner,current,nowMs);
 if(!verdict.ok)throw new ApiError(409,`전송 규칙에 막혀 승인할 수 없습니다: ${verdict.reasons.map(r=>r.message).join(' ')}`);
 const at=new Date(nowMs).toISOString();
 return save(owner,{...current,status:'approved',compliance:verdict,approval:{by:who.id,at,autonomy:decision.mode},version:current.version+1,updatedAt:at,updatedBy:who.id});
}
export type SendOutput={record:SendRecord;executed:boolean};
// 전송: 스위치 꺼짐 409 → 승인 상태 확인 → 번호 해시 대조 → 전송 직전 판정 재확인 → 'sending' 영속 → 딜러 호출 → 결과 저장. 이미 보낸(sent·unknown·sending) 기록은 다시 보내지 않고 그대로 돌려준다.
export async function sendMessage(owner:string,who:Actor,input:Record<string,unknown>,make:ProviderFactory=defaultProviderFactory,nowMs=Date.now()):Promise<SendOutput>{
 if(!await kakaoEnabled(owner))throw new ApiError(409,SWITCH_OFF);
 if(who.role==='member')throw new ApiError(403,'소유자·관리자만 전송할 수 있습니다.');
 const current=await readSend(owner,input.id);
 if(current.status==='sent'||current.status==='unknown'||current.status==='sending')return {record:current,executed:false};
 if(current.status!=='approved')throw new ApiError(409,current.status==='draft'?'사람이 승인한 뒤에만 보낼 수 있습니다.':'실패한 기록은 다시 보내지 않습니다. 새 초안을 만드세요.');
 await version(input,current);
 const phone=await resolveRecipientHash(owner,{phone:input.phone});
 if(phone!==current.recipientHash)throw new ApiError(400,'입력한 번호가 이 기록의 수신자와 다릅니다.');
 const verdict=await evaluateMessage(owner,current,nowMs);
 if(!verdict.ok)throw new ApiError(409,`전송 규칙에 막혔습니다: ${verdict.reasons.map(r=>r.message).join(' ')}`);
 const {credential}=await loadDealer(owner,{brandId:current.brandId}),provider=make(credential),at=new Date(nowMs).toISOString(),day=kstParts(nowMs).date;
 const sending=await save(owner,{...current,status:'sending',compliance:verdict,send:{at,day,outcome:null,messageId:null,costKrw:null,detail:'',attempts:0},version:current.version+1,updatedAt:at,updatedBy:who.id});
 const to=normalizePhone(str(input.phone,'휴대전화 번호',40,true))??'';
 const result=current.type==='alimtalk'
  ?await provider.sendAlimtalk({senderKey:credential.senderKey,templateCode:current.templateCode??'',to,variables:current.variables,idempotencyKey:current.idempotencyKey})
  :await provider.sendBrandMessage({senderKey:credential.senderKey,to,text:current.text,buttons:current.buttons,adFlag:true,idempotencyKey:current.idempotencyKey});
 const status:SendStatus=result.outcome==='success'?'sent':result.outcome==='unknown'?'unknown':'failed',done=stamp();
 const next=await save(owner,{...sending,status,send:{at,day,outcome:result.outcome,messageId:result.messageId,costKrw:result.costKrw,detail:result.detail,attempts:result.attempts},version:sending.version+1,updatedAt:done,updatedBy:who.id});
 return {record:next,executed:true};
}
// 결과 폴링(읽기): 보낸·결과 미확인 기록의 메시지 id로 딜러 결과를 읽는다. 결과를 모르면 unknown 그대로 둔다(다시 읽어도 된다).
export async function pollResult(owner:string,who:Actor,input:Record<string,unknown>,make:ProviderFactory=defaultProviderFactory):Promise<SendRecord>{
 if(!await kakaoEnabled(owner))throw new ApiError(409,SWITCH_OFF);
 const current=await readSend(owner,input.id);
 if(!current.send||!(current.status==='sent'||current.status==='unknown'))throw new ApiError(409,'보낸 기록만 결과를 조회합니다.');
 if(!current.send.messageId)throw new ApiError(409,'딜러 메시지 id가 없어 결과를 조회할 수 없습니다. 딜러 콘솔에서 멱등 키로 대조하세요.');
 const {credential}=await loadDealer(owner,{brandId:current.brandId}),r=await make(credential).getResult(current.send.messageId),at=stamp();
 const status:SendStatus=r.status==='delivered'?'sent':r.status==='failed'?'failed':current.status;
 return save(owner,{...current,status,result:{status:r.status,checkedAt:at,detail:r.detail,costKrw:r.costKrw},send:{...current.send,costKrw:r.costKrw??current.send.costKrw},version:current.version+1,updatedAt:at,updatedBy:who.id});
}
export async function listSends(owner:string,brandId:string):Promise<SendRecord[]>{
 return (await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT ?').bind(owner,kinds.send,brandId,SEND_LIMITS.list).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as SendRecord);
}
