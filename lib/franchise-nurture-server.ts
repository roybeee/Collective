// 트랙 R R9a-2 너처링 템플릿 서버: /api/franchise 작업 4개(nurture_draft_start·nurture_draft_poll·nurture_template_save·nurture_template_retire)와 GET 보기 nurture.
// 템플릿은 브랜드 행(franchise_message_template, 행 id <템플릿 id>:<판>)이고 자리표시만 담는다(이름·연락처·가명 코드 없음). 판정은 순수 모듈 lib/franchise-nurture.ts가 한다.
// 초안 작성(HERMES 1회)은 lib/nurture-draft.ts가 한다. 이 모듈은 리드를 읽지 않는다. 정보 요청·수동 발송 기록은 리드 작업이라 lib/franchise-server.ts가 한다.
// 발송은 하지 않는다: 외부 발송 API가 없고, 사람이 보낸 뒤 리드 상세에서 '발송 기록'만 남긴다. franchise-server가 잠금·영수증·스위치·역할을 먼저 보고 넘긴다(port, 순환 없음).
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {ApiError,database,readRecord,listRecords,recordStatement,uid,stamp} from './server';
import {isEnabled} from './feature-flags';
import {loadFranchiseContext} from './franchise-facts-server';
import {GATE_DISCLAIMER} from './franchise-gates';
import {FRANCHISE_ERRORS,type FranchiseErrorKey,type AuditAction} from './franchise';
import {FranchiseRecruitmentError} from './franchise-recruitment-server';
import {templateDecision,PURPOSES,MEDIA,MEDIUM_LABELS,CLASSIFICATION_LABELS,CLASSIFICATION_NOTE,PLACEHOLDERS,LIMITS,NURTURE_VERSION,NURTURE_MESSAGES,
 type Purpose,type Medium,type Classification,type NurtureDecision,type LogTemplate} from './franchise-nurture';
import {startNurtureDraft,pollNurtureDraft,publicDraft,isActiveDraft,type NurtureDraft} from './nurture-draft';
import type {BrandFact} from './brand-facts';

type Json=Record<string,unknown>;
type ActorLite={id:string;role:string};
export const NURTURE_ACTIONS=['nurture_draft_start','nurture_draft_poll','nurture_template_save','nurture_template_retire'] as const;
export type NurtureAction=typeof NURTURE_ACTIONS[number];
// 템플릿 폐기는 보호 방향이라 스위치가 꺼져도 된다. 초안 조회·중지도 된다(이미 보낸 요청을 끝내거나 멈춘다).
export const NURTURE_OFF_EXEMPT:readonly string[]=['nurture_template_retire','nurture_draft_poll'];
// 초안 시작·조회는 HERMES 호출이 길어 가맹 잠금·영수증 재생을 건너뛴다. 멱등은 초안 id(nd-…)가 맡는다.
export const NURTURE_NO_LOCK:readonly string[]=['nurture_draft_start','nurture_draft_poll'];
export const NURTURE_ADMIN:readonly string[]=['nurture_template_retire'];
export const NURTURE_LIMITS=Object.freeze({templatesPerBrand:50,versionsPerTemplate:20,draftsShown:10});
export type TemplateRow={id:string;brandId:string;version:number;purpose:Purpose;classification:Classification;medium:Medium;subject:string|null;body:string;status:'active'|'retired';
 draftId:string|null;aiAssisted:boolean;savedBy:ActorLite;createdAt:string;updatedAt:string;retiredAt?:string;retiredBy?:ActorLite;ruleVersion:string};
export type NurtureAuditExtra={recordId?:string;templateVersion?:number;reasons?:string[];aiAssisted?:boolean};
export type NurturePort={commit:(stmts:D1PreparedStatement[],stale:FranchiseErrorKey)=>Promise<unknown>;receipt:(action:AuditAction,result:Json,extra:NurtureAuditExtra,target:string|null)=>D1PreparedStatement};
export type NurtureArgs={owner:string;brandId:string;now:string;enabled:boolean;actor:ActorLite;input:Json;action:NurtureAction;port:NurturePort};
type Outcome={result:Json;extra?:Json};
export class FranchiseNurtureError extends FranchiseRecruitmentError{}

const TEMPLATE_ID=/^nt-[A-Za-z0-9_-]{6,60}$/;
function fail(key:FranchiseErrorKey):never{const e=FRANCHISE_ERRORS[key];throw new FranchiseNurtureError(e.status,e.text)}
// 판정 실패를 HTTP로: 사유 코드·고정 문구·규칙 버전·면책(판정기 발췌는 싣지 않는다).
export function nurtureError(d:Extract<NurtureDecision<unknown>,{ok:false}>):never{
 throw new FranchiseNurtureError(d.status,d.message,{reasons:d.reasons.map(code=>({code,message:NURTURE_MESSAGES[code]})),ruleVersion:NURTURE_VERSION,disclaimer:GATE_DISCLAIMER});
}
const rowKey=(owner:string,id:string,version:number)=>`${owner}:franchise_message_template:${id}:${version}`;
async function templateRows(owner:string,brandId:string):Promise<TemplateRow[]>{return (await listRecords<TemplateRow>(owner,'franchise_message_template',brandId)).filter(t=>t.brandId===brandId)}
const latestOf=(rows:readonly TemplateRow[],id:string)=>rows.filter(r=>r.id===id).sort((a,b)=>b.version-a.version)[0]??null;
async function judgeContext(owner:string,brandId:string){
 const [facts,fr]=await Promise.all([listRecords<BrandFact>(owner,'brand_fact',brandId),loadFranchiseContext(owner,brandId)]);
 return {facts:facts.filter(f=>f.brandId===brandId),versions:fr.versions};
}
// 발송 기록용(franchise-server가 부른다): 활성 템플릿의 그 판. 없거나 폐기·다른 브랜드면 null.
export async function templateForLog(owner:string,brandId:string,id:unknown,version:unknown):Promise<LogTemplate|null>{
 if(typeof id!=='string'||!TEMPLATE_ID.test(id)||typeof version!=='number'||!Number.isSafeInteger(version)||version<1)return null;
 let row:TemplateRow;
 try{row=await readRecord<TemplateRow>(owner,'franchise_message_template',`${id}:${version}`)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
 if(row.brandId!==brandId||row.status!=='active')return null;
 return {id:row.id,version:row.version,purpose:row.purpose,medium:row.medium,subject:row.subject,body:row.body};
}
export {judgeContext as nurtureJudgeContext};

export function runNurtureAction(x:NurtureArgs):Promise<Outcome>{
 switch(x.action){
  case 'nurture_draft_start':return draftStart(x);
  case 'nurture_draft_poll':return draftPoll(x);
  case 'nurture_template_save':return templateSave(x);
  case 'nurture_template_retire':return templateRetire(x);
  default:return fail('UNKNOWN_ACTION');
 }
}
const commonExtra={ruleVersion:NURTURE_VERSION,classificationNote:CLASSIFICATION_NOTE,disclaimer:GATE_DISCLAIMER};
async function draftStart(x:NurtureArgs):Promise<Outcome>{
 const d=await startNurtureDraft(x.owner,x.brandId,x.actor,x.input);
 return {result:{draft:publicDraft(d)},extra:commonExtra};
}
async function draftPoll(x:NurtureArgs):Promise<Outcome>{
 const d=await pollNurtureDraft(x.owner,x.brandId,x.input);
 return {result:{draft:publicDraft(d)},extra:commonExtra};
}
// 저장(모든 역할, 스위치 켜짐): 검사를 통과한 템플릿만 새 판으로 INSERT한다. 같은 내용이면 쓰기 없음. 초안에서 가져왔으면 완료된 같은 브랜드 초안이어야 한다.
async function templateSave(x:NurtureArgs):Promise<Outcome>{
 const i=x.input,given=typeof i.templateId==='string'&&i.templateId!=='';
 if(given&&!TEMPLATE_ID.test(String(i.templateId)))fail('NURTURE_NOT_FOUND');
 const rows=await templateRows(x.owner,x.brandId),prev=given?latestOf(rows,String(i.templateId)):null;
 if(given&&!prev)fail('NURTURE_NOT_FOUND');
 if(prev&&i.baseVersion!==prev.version)fail('NURTURE_STALE');
 if(prev&&(i.purpose!==prev.purpose||i.medium!==prev.medium))fail('NURTURE_KIND_FIXED');
 const ctx=await judgeContext(x.owner,x.brandId);
 const d=templateDecision(i,{enabled:x.enabled,brandId:x.brandId,now:x.now,facts:ctx.facts,versions:ctx.versions});
 if(!d.ok)nurtureError(d);
 let draftId:string|null=null;
 if(typeof i.draftId==='string'&&i.draftId){
  let draft:NurtureDraft|null=null;
  try{draft=await readRecord<NurtureDraft>(x.owner,'franchise_nurture_draft',i.draftId)}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
  if(!draft||draft.brandId!==x.brandId||draft.status!=='completed'||!draft.result)fail('NURTURE_DRAFT_INVALID');
  draftId=draft.id;
 }else if(prev)draftId=prev.draftId;
 const v=d.value;
 if(prev&&prev.status==='active'&&prev.subject===v.subject&&prev.body===v.body)return {result:{templateId:prev.id,version:prev.version,unchanged:true},extra:commonExtra};
 if(!prev&&new Set(rows.map(r=>r.id)).size>=NURTURE_LIMITS.templatesPerBrand)fail('LIMIT');
 if(prev&&rows.filter(r=>r.id===prev.id).length>=NURTURE_LIMITS.versionsPerTemplate)fail('LIMIT');
 const row:TemplateRow={id:prev?.id??'nt-'+uid(),brandId:x.brandId,version:(prev?.version??0)+1,purpose:v.purpose,classification:v.classification,medium:v.medium,subject:v.subject,body:v.body,status:'active',
  draftId,aiAssisted:!!draftId,savedBy:{id:x.actor.id,role:x.actor.role},createdAt:prev?.createdAt??x.now,updatedAt:x.now,ruleVersion:NURTURE_VERSION};
 const result={templateId:row.id,version:row.version,classification:row.classification};
 await x.port.commit([
  database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(rowKey(x.owner,row.id,row.version),x.owner,'franchise_message_template',x.brandId,JSON.stringify(row),x.now),
  x.port.receipt('nurture_template_save',result,{recordId:row.id,templateVersion:row.version,aiAssisted:row.aiAssisted},prev?.id??null),
 ],'NURTURE_STALE');
 return {result,extra:commonExtra};
}
// 폐기(대표·관리자, 스위치가 꺼져도 된다): 최신 판을 폐기한다. 폐기한 템플릿으로는 발송 기록을 남길 수 없다. 되돌리지 않는다(새 템플릿을 만든다).
async function templateRetire(x:NurtureArgs):Promise<Outcome>{
 const id=x.input.templateId;
 if(typeof id!=='string'||!TEMPLATE_ID.test(id))fail('NURTURE_NOT_FOUND');
 const prev=latestOf(await templateRows(x.owner,x.brandId),id);
 if(!prev)fail('NURTURE_NOT_FOUND');
 if(x.input.version!==prev.version)fail('NURTURE_STALE');
 if(prev.status==='retired')return {result:{templateId:id,version:prev.version,unchanged:true}};
 const next:TemplateRow={...prev,status:'retired',retiredAt:x.now,retiredBy:{id:x.actor.id,role:x.actor.role},updatedAt:x.now},result={templateId:id,version:prev.version,status:'retired'};
 await x.port.commit([recordStatement(x.owner,'franchise_message_template',`${id}:${prev.version}`,next,x.brandId),x.port.receipt('nurture_template_retire',result,{recordId:id,templateVersion:prev.version},id)],'NURTURE_STALE');
 return {result};
}

// ── 보기(모든 역할) ──
type Viewer={owner:string;id:string;role:string};
export async function nurtureView(who:Viewer,brandId:string):Promise<Json>{
 const [rows,drafts,enabled]=await Promise.all([templateRows(who.owner,brandId),listRecords<NurtureDraft>(who.owner,'franchise_nurture_draft',brandId),isEnabled(who.owner,'r_franchise')]);
 const ids=[...new Set(rows.map(r=>r.id))];
 const templates=ids.map(id=>{const l=latestOf(rows,id)!;return {templateId:id,version:l.version,versions:rows.filter(r=>r.id===id).length,purpose:l.purpose,classification:l.classification,medium:l.medium,subject:l.subject,body:l.body,status:l.status,aiAssisted:l.aiAssisted,updatedAt:l.updatedAt}})
  .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||(a.templateId<b.templateId?-1:1));
 const recent=drafts.filter(d=>d.brandId===brandId).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,NURTURE_LIMITS.draftsShown).map(publicDraft);
 return {templates,drafts:recent,activeDraft:recent.find(isActiveDraft)?.id??null,
  purposes:PURPOSES.map(p=>({key:p.key,label:p.label,classification:p.classification,classificationLabel:CLASSIFICATION_LABELS[p.classification]})),
  media:MEDIA.map(m=>({key:m,label:MEDIUM_LABELS[m]})),placeholders:[...PLACEHOLDERS],limits:{...LIMITS,...NURTURE_LIMITS},
  enabled,role:who.role,now:stamp(),...commonExtra};
}
