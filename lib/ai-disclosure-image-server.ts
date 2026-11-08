// C2 AI 생성 이미지 표시(서버). 스위치 ai_image_disclosure는 이 파일에서만 읽고 읽기 실패는 꺼짐이다(구조 규칙: execution-server.ts는 feature-flags를 직접 import하지 않는다).
// 표시는 소재 PNG를 저장하기 전(해시 계산 전)에 넣는다. 그래야 소재 해시·공개 주소·Meta 업로드 해시 대조가 표시된 바이트로 고정된다.
// 반출 경로(앱 공개 사본·Meta 이미지 업로드)는 바이트를 바꾸지 않고(해시 대조가 깨진다) 표시 청크 유무만 감사 기록으로 남긴다.
import {ApiError,listRecords,recordStatement,stamp,str,uid} from './server';
import {isEnabled} from './feature-flags';
import {AI_IMAGE_POLICY,addDisclosureChunk,disclosurePayload,imageDisclosurePlan,normalizeImageOrigin,readDisclosureChunk,sha256Hex,type ImageDisclosure,type ImageOrigin} from './ai-disclosure-image';

export type AiImageDisclosureAction='marked'|'unknown_origin'|'export';
export type AiImageExportChannel='public_media'|'meta_image';
// 감사 기록(kind ai_image_disclosure, parent 캠페인). marked: 표시를 넣은 저장(id=표시 뒤 해시, 같은 원본·payload면 같은 행). unknown_origin: 출처 불명 경고. export: 반출 경로의 표시 유무.
export type AiImageDisclosureRecord={id:string;action:AiImageDisclosureAction;campaignId:string;artifactId:string|null;publicationId:string|null;channel:'creative'|AiImageExportChannel;origin:ImageOrigin;hashBefore:string;hashAfter:string|null;policy:typeof AI_IMAGE_POLICY;virtualPerson:boolean;marked:boolean;disclosure:ImageDisclosure|null;createdAt:string};
export type ImageInput={origin:ImageOrigin;virtualPerson:boolean;model?:string};
export type DiscloseResult={bytes:Uint8Array;plan:ReturnType<typeof imageDisclosurePlan>;record:AiImageDisclosureRecord|null};

export async function aiImageDisclosureEnabled(owner:string){try{return await isEnabled(owner,'ai_image_disclosure')}catch{return false}}

// 요청의 image 필드(선택). 없으면 출처 불명이다(지금 화면의 사실 카드 경로는 보내지 않는다 — 스위치가 켜져 있으면 경고 기록만 남는다).
export function parseImageInput(value:unknown):ImageInput{
 if(value===undefined||value===null)return {origin:'unknown',virtualPerson:false};
 if(typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'이미지 출처 정보를 확인하세요.');
 const v=value as Record<string,unknown>;
 if(v.virtualPerson!==undefined&&typeof v.virtualPerson!=='boolean')throw new ApiError(400,'가상인물 여부는 true 또는 false로 보내세요.');
 const model=v.model===undefined||v.model===null||v.model===''?undefined:str(v.model,'생성 모델',80);
 return {origin:normalizeImageOrigin(v.origin),virtualPerson:v.virtualPerson===true,...(model?{model}:{})};
}
const sameMark=(r:AiImageDisclosureRecord,hashBefore:string,input:ImageInput)=>r.action==='marked'&&r.hashBefore===hashBefore&&r.origin===input.origin&&r.virtualPerson===input.virtualPerson&&(r.disclosure?.model??undefined)===input.model;

// 소재 저장 전 표시. 꺼짐 → 바이트 그대로·기록 없음. manual → 그대로. 불명 → 그대로 + 경고 기록. ai/ai_edited → iTXt 청크 추가 + 기록.
// 같은 캠페인에서 같은 원본·출처·가상인물·모델로 다시 저장하면 이전 payload(createdAt 포함)를 재사용해 같은 바이트(같은 해시)가 되어 소재 중복 판정이 유지된다.
export async function discloseCreativeImage(owner:string,campaignId:string,bytes:Uint8Array,input:ImageInput):Promise<DiscloseResult>{
 const plan=imageDisclosurePlan(input.origin,await aiImageDisclosureEnabled(owner));
 if(plan==='off'||plan==='skip_manual')return {bytes,plan,record:null};
 const hashBefore=await sha256Hex(bytes),at=stamp();
 if(plan==='warn_unknown'){
  const record:AiImageDisclosureRecord={id:uid(),action:'unknown_origin',campaignId,artifactId:null,publicationId:null,channel:'creative',origin:input.origin,hashBefore,hashAfter:null,policy:AI_IMAGE_POLICY,virtualPerson:input.virtualPerson,marked:false,disclosure:null,createdAt:at};
  await recordStatement(owner,'ai_image_disclosure',record.id,record,campaignId).run();
  return {bytes,plan,record};
 }
 const origin=input.origin as 'ai'|'ai_edited';
 const prior=(await listRecords<AiImageDisclosureRecord>(owner,'ai_image_disclosure',campaignId)).find(r=>sameMark(r,hashBefore,input));
 const disclosure=prior?.disclosure??disclosurePayload({origin,model:input.model,createdAt:at,virtualPerson:input.virtualPerson});
 const marked=addDisclosureChunk(bytes,disclosure),hashAfter=await sha256Hex(marked);
 if(prior&&prior.id===hashAfter)return {bytes:marked,plan,record:prior};
 const record:AiImageDisclosureRecord={id:hashAfter,action:'marked',campaignId,artifactId:null,publicationId:null,channel:'creative',origin,hashBefore,hashAfter,policy:AI_IMAGE_POLICY,virtualPerson:input.virtualPerson,marked:true,disclosure,createdAt:at};
 await recordStatement(owner,'ai_image_disclosure',record.id,record,campaignId).run();
 return {bytes:marked,plan,record};
}
// 반출 감사: 바이트를 바꾸지 않고 표시 청크 유무를 기록한다. 꺼짐이면 기록하지 않는다. 기록 실패는 반출을 막지 않는다(console.error만).
export async function auditImageExport(owner:string,input:{bytes:Uint8Array;campaignId:string;artifactId:string|null;publicationId?:string|null;channel:AiImageExportChannel}):Promise<AiImageDisclosureRecord|null>{
 try{
  if(!await aiImageDisclosureEnabled(owner))return null;
  let disclosure:ImageDisclosure|null=null;try{disclosure=readDisclosureChunk(input.bytes)}catch{disclosure=null}
  const hash=await sha256Hex(input.bytes);
  const record:AiImageDisclosureRecord={id:uid(),action:'export',campaignId:input.campaignId,artifactId:input.artifactId,publicationId:input.publicationId??null,channel:input.channel,origin:disclosure?.origin??'unknown',hashBefore:hash,hashAfter:hash,policy:AI_IMAGE_POLICY,virtualPerson:disclosure?.virtualPerson===true,marked:!!disclosure,disclosure,createdAt:stamp()};
  await recordStatement(owner,'ai_image_disclosure',record.id,record,input.campaignId).run();
  return record;
 }catch(e){console.error('ai_image_disclosure_audit_failed',e instanceof Error?e.message:'unknown');return null}
}
