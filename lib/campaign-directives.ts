import {ApiError,str,uid,stamp,database,readRecord,listRecords,recordStatement,eventStatement,type Actor} from './server';
import type {Campaign} from './agency';

// 캠페인 상시 지시: 역할·회의·브리프 초안의 모든 AI 입력에 함께 전달된다.
// 브리프 version과 분리되어 있어 추가·삭제해도 작업물을 무효화하지 않고, 캠페인 이력(event)에만 남긴다.
export const DIRECTIVE_MAX_LENGTH=500,DIRECTIVE_LIMIT=30;
// createdBy.role: 작성자 역할. 관리자 지시는 직원이 지우지 못하고, AI 입력에는 작성자 구분(관리자/직원)으로 전달된다.
export type CampaignDirective={id:string;campaignId:string;text:string;createdAt:string;createdBy:{id:string;email:string|null;role?:Actor['role']}};
type Who=Pick<Actor,'id'|'email'|'role'>;

export async function listDirectives(owner:string,campaignId:string):Promise<CampaignDirective[]>{
 return (await listRecords<CampaignDirective>(owner,'campaign_directive',campaignId)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}

const preview=(text:string)=>text.length>120?text.slice(0,120)+'…':text;

function directiveText(value:unknown){
 if(typeof value==='string'&&value.trim().length>DIRECTIVE_MAX_LENGTH)throw new ApiError(400,`상시 지시는 ${DIRECTIVE_MAX_LENGTH}자 이하로 입력하세요.`);
 return str(value,'상시 지시',DIRECTIVE_MAX_LENGTH*4,true);
}

async function addDirective(owner:string,campaign:Campaign,current:CampaignDirective[],input:Record<string,unknown>,who:Who){
 const id=input.id===undefined?uid():str(input.id,'지시 번호',100,true);
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new ApiError(400,'지시 번호가 올바르지 않습니다.');
 const text=directiveText(input.text);
 const retry=current.find(d=>d.id===id);if(retry)return {directive:retry};
 const elsewhere=await readRecord<CampaignDirective>(owner,'campaign_directive',id).catch(e=>{if(e instanceof ApiError&&e.status===404)return null;throw e});
 if(elsewhere)throw new ApiError(409,'다른 캠페인의 지시 번호입니다. 새로고침한 뒤 다시 추가하세요.');
 if(current.length>=DIRECTIVE_LIMIT)throw new ApiError(409,`상시 지시는 캠페인당 ${DIRECTIVE_LIMIT}개까지 둘 수 있습니다. 기존 지시를 정리해 주세요.`);
 if(current.some(d=>d.text===text))throw new ApiError(409,'같은 상시 지시가 이미 있습니다.');
 const directive:CampaignDirective={id,campaignId:campaign.id,text,createdAt:stamp(),createdBy:{id:who.id,email:who.email,role:who.role}};
 await database().batch([recordStatement(owner,'campaign_directive',id,directive,campaign.id),eventStatement(owner,campaign.id,`상시 지시 추가 · ${preview(text)} (브리프 버전·작업물 유지)`,who)]);
 return {directive};
}

// 역할이 없는 지시(헤더 인증 시절)는 관리자 지시로 본다.
export const directiveByMember=(d:CampaignDirective)=>d.createdBy?.role==='member';
async function removeDirective(owner:string,campaign:Campaign,current:CampaignDirective[],input:Record<string,unknown>,who:Who){
 const id=str(input.id,'지시',100,true);
 const directive=current.find(d=>d.id===id);
 // 응답을 잃은 삭제 재시도는 이미 지워진 지시에 성공으로 답한다. 다른 캠페인의 지시만 찾을 수 없음으로 둔다.
 if(!directive){
  const elsewhere=await readRecord<CampaignDirective>(owner,'campaign_directive',id).catch(e=>{if(e instanceof ApiError&&e.status===404)return null;throw e});
  if(elsewhere)throw new ApiError(404,'상시 지시를 찾을 수 없습니다. 새로고침해 주세요.');
  return {removed:id};
 }
 if(who.role==='member'&&!directiveByMember(directive))throw new ApiError(403,'관리자가 남긴 상시 지시는 관리자만 삭제할 수 있습니다.');
 await database().batch([database().prepare("DELETE FROM records WHERE owner=? AND kind='campaign_directive' AND id=?").bind(owner,`${owner}:campaign_directive:${id}`),eventStatement(owner,campaign.id,`상시 지시 삭제 · ${preview(directive.text)} (브리프 버전·작업물 유지)`,who)]);
 return {removed:id};
}

// The caller holds the owner mutation lock for the count and duplicate checks.
export async function changeDirective(owner:string,input:Record<string,unknown>,who:Who){
 const campaign=await readRecord<Campaign>(owner,'campaign',str(input.campaignId,'캠페인',100,true));
 const current=await listDirectives(owner,campaign.id);
 if(input.action==='add')return addDirective(owner,campaign,current,input,who);
 if(input.action==='remove')return removeDirective(owner,campaign,current,input,who);
 throw new ApiError(400,'지원하지 않는 작업입니다.');
}
