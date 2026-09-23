import {roles,type Artifact} from './agency';
import {practices} from './practice';

export const ROLE_OUTPUT_VERSION='role-output-v1';
export type RoleOutputContract={version:string;role:string;contextTruncated?:boolean;sections:{id:string;title:string}[]};
export function roleOutputContract(role:string):RoleOutputContract {
 return {version:ROLE_OUTPUT_VERSION,role,sections:practices[role].outputs.map((title,index)=>({id:`output_${index+1}`,title}))};
}
// A narrow guard for known nonanswers, not a factual accuracy or quality judgment.
export function isQuestionOnly(content:string){
 const text=content.trim();
 if(text.length>2500)return false;
 return /(?:작업|요청|과업)[\s\S]{0,35}(?:명시되지|지정되지|주어지지|없습니다|없어요)/.test(text)
  ||/(?:원하시는|수행할|진행할|어떤)[\s\S]{0,35}(?:작업|업무)[\s\S]{0,50}(?:선택해|지정해|알려\s?주|말씀해)/.test(text)
  ||/(?:what (?:task|would you like)|please (?:specify|choose) (?:the |a )?task)/i.test(text);
}
function outputError(message:string):never {throw new Error(`작업물 수정 필요: ${message}`)}
export function parseRoleOutput(content:string,role:string,contract?:RoleOutputContract){
 if(!content.trim())return outputError('본문이 비어 있습니다.');
 if(isQuestionOnly(content))return outputError('담당 과업 대신 작업 선택을 요청했습니다.');
 if(!contract||role==='quality')return content;
 let raw:unknown;try{raw=JSON.parse(content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))}catch{return outputError('필수 산출물 JSON 형식이 아닙니다.');}
 if(!raw||typeof raw!=='object')return outputError('결과 객체가 필요합니다.');
 const result=raw as Record<string,unknown>;
 if(result.contractVersion!==contract.version||result.role!==role)return outputError('담당 또는 산출물 계약 버전이 일치하지 않습니다.');
 if(!Array.isArray(result.sections)||result.sections.length!==contract.sections.length)return outputError('필수 산출물 항목이 누락되거나 중복되었습니다.');
 const sections=result.sections as Record<string,unknown>[];
 const rendered=contract.sections.map(required=>{
  const matches=sections.filter(s=>s&&typeof s==='object'&&s.id===required.id);
  if(matches.length!==1)return outputError(`${required.id} (${required.title}) 항목이 필요합니다.`);
  const body=matches[0].content;
  if(typeof body!=='string'||!body.trim()||isQuestionOnly(body))return outputError(`${required.id} 항목에 실제 초안 또는 자료 필요·확인 계획을 작성하세요.`);
  return `## ${required.title}\n\n${body.trim()}`;
 }).join('\n\n');
 if(rendered.length>40000)return outputError('산출물이 40,000자 저장 한도를 초과했습니다. 요약해서 다시 작성하세요.');
 return rendered;
}
export function artifactUsable(a:Artifact,campaignVersion:number){
 return ['review','approved'].includes(a.status)&&(!a.campaignVersion||a.campaignVersion===campaignVersion)&&!!a.content.trim()&&!isQuestionOnly(a.content);
}
export function upstreamContext(artifacts:Artifact[],role:string,campaignVersion:number){
 const index=roles.findIndex(r=>r.id===role);
 return roles.slice(0,index).flatMap(prior=>{
  const a=artifacts.filter(a=>a.role===prior.id&&artifactUsable(a,campaignVersion)).sort((a,b)=>b.version-a.version||b.createdAt?.localeCompare(a.createdAt))[0];
  return a?[{id:a.id,version:a.version,role:a.role,title:a.title,content:a.content.slice(0,role==='quality'?24000:6000),excerpt:a.content.length>(role==='quality'?24000:6000),originalLength:a.content.length}]:[];
 });
}
