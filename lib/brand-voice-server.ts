import {ApiError,readRecord,recordStatement,stamp,str,type Actor} from './server';
import type {Brand} from './agency';
import {parseVoiceBody,activeVoiceInput,voiceBody,BRAND_VOICE_LIMITS,type BrandVoice,type BrandVoiceInput,type VoiceBody,type VoiceSnapshot,type VoiceActor} from './brand-voice';

// 브랜드 말투 원장(A3-2) 저장. records kind brand_voice(id=brandId, parent=brandId, 브랜드당 1행, 최근 20판 history를 행 안에 둔다).
// 쓰기(save_draft·confirm·revoke)는 대표·관리자만 한다(라우트가 requireAdminActor로 막고, 여기서도 직원을 403으로 막는다). 모든 쓰기는 version 비교(CAS)로 409를 낸다.
// 사람은 id·역할만 남긴다. 확정본(confirmedVoice)만 모델 입력에 간다(activeVoiceInput). 초안을 고치는 동안에도 이전 확정본이 모델에 간다.
export type VoiceAction='save_draft'|'confirm'|'revoke';
const ACTIONS:readonly string[]=['save_draft','confirm','revoke'];
export async function readBrandVoice(owner:string,brandId:string):Promise<BrandVoice|null>{
 try{return await readRecord<BrandVoice>(owner,'brand_voice',brandId)}catch(error){if(error instanceof ApiError&&error.status===404)return null;throw error}
}
// 역할 입력용 확정본 블록(없으면 null). lib/role-execution.ts가 스위치가 켜진 content·creative 역할에서만 부른다.
export async function confirmedVoiceInput(owner:string,brandId:string):Promise<BrandVoiceInput|null>{return activeVoiceInput(await readBrandVoice(owner,brandId))}
// 판 하나(history 항목·확정본): 행에서 id·확정본·history를 뺀 값.
const snapshotOf=(v:VoiceSnapshot):VoiceSnapshot=>({...voiceBody(v),version:v.version,status:v.status,updatedBy:v.updatedBy,updatedAt:v.updatedAt,...(v.confirmedBy?{confirmedBy:v.confirmedBy,confirmedAt:v.confirmedAt}:{})});
type Change={body:VoiceBody;status:VoiceSnapshot['status'];by:VoiceActor;confirmed:boolean;keepConfirmed:boolean};
// 새 판: version+1, 이전 판을 history 맨 앞에 넣고 20판까지 남긴다. 확정이면 이 판이 확정본이고, 초안이면 이전 확정본을 그대로 두고, 철회면 확정본이 없다.
function nextRow(old:BrandVoice|null,brandId:string,{body,status,by,confirmed,keepConfirmed}:Change):BrandVoice{
 const now=stamp(),snap:VoiceSnapshot={...body,version:(old?.version??0)+1,status,updatedBy:by,updatedAt:now,...(confirmed?{confirmedBy:by,confirmedAt:now}:{})};
 const history=old?[snapshotOf(old),...old.history].slice(0,BRAND_VOICE_LIMITS.history):[];
 return {id:brandId,brandId,...snap,confirmedVoice:confirmed?snapshotOf(snap):keepConfirmed?old?.confirmedVoice??null:null,history};
}
export async function saveBrandVoice(owner:string,input:Record<string,unknown>,who:Pick<Actor,'id'|'role'>){
 if(!ACTIONS.includes(String(input.action)))throw new ApiError(400,'지원하지 않는 작업입니다.');
 if(who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,'브랜드 말투는 대표·관리자만 쓰고 확정할 수 있습니다.');
 const action=input.action as VoiceAction,brandId=str(input.brandId,'브랜드',100,true);
 await readRecord<Brand>(owner,'brand',brandId);
 const old=await readBrandVoice(owner,brandId);
 if(!Number.isInteger(input.version)||input.version!==(old?.version??0))throw new ApiError(409,'브랜드 말투가 그사이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.');
 const by:VoiceActor={id:who.id,role:who.role};
 let row:BrandVoice;
 if(action==='save_draft'){
  const {body,errors}=parseVoiceBody(input.data);
  if(!body)throw new ApiError(400,errors[0]||'말투 내용을 확인해 주세요.');
  row=nextRow(old,brandId,{body,status:'draft',by,confirmed:false,keepConfirmed:true});
 }else if(action==='confirm'){
  if(!old||old.status!=='draft')throw new ApiError(409,'확정할 초안이 없습니다. 초안을 먼저 저장하세요.');
  row=nextRow(old,brandId,{body:voiceBody(old),status:'confirmed',by,confirmed:true,keepConfirmed:false});
 }else{
  if(!old?.confirmedVoice)throw new ApiError(409,'철회할 확정 말투가 없습니다.');
  row=nextRow(old,brandId,{body:voiceBody(old),status:'revoked',by,confirmed:false,keepConfirmed:false});
 }
 await recordStatement(owner,'brand_voice',brandId,row,brandId).run();
 return {voice:row,active:activeVoiceInput(row)};
}
