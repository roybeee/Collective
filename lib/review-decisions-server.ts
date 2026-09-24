// B1 판정 로그 저장·조회(D1). 순수 규칙은 lib/review-decisions.ts, 형식 문서는 docs/REVIEW-DECISIONS.ko.md.
// records kind 'review_decision'(lib/record-kinds.ts)은 추가만 한다: 행 id는 매번 새 uuid이고 ON CONFLICT 없는 INSERT라 같은 id가 오면 실패한다(덮어쓰기 0).
// 조회 순서는 기록 순서(rowid)다. 모든 함수는 DB만 읽고 쓰며 모델(HERMES·OpenAI)을 부르지 않는다.
import {ApiError,database,readRecord,stamp,uid,type Actor} from './server';
import {valueOf,type BriefDraft,type BriefInput} from './brief';
import type {Artifact} from './agency';
import {REVIEW_REASONS_VERSION,reasonCodesProblem,reasonCodesOf,criteriaProblem,criteriaOf,editStats,suggestionDecision,firstPassApproval,legacyHumanEdit,type ReviewTargetKind,type ReviewDecision,type ReviewActor,type ReasonCode,type CriterionJudgement,type EditStats} from './review-decisions';

export const reviewActor=(who:Actor):ReviewActor=>({id:who.id,role:who.role});
// 검사 실패는 400이고 호출한 라우트는 어떤 레코드도 쓰기 전에 멈춘다. required면 사유가 1개 이상 있어야 한다.
export function requireReasonCodes(value:unknown,kind:ReviewTargetKind,required=false):ReasonCode[]{
 const problem=reasonCodesProblem(value,kind);if(problem)throw new ApiError(400,problem);
 const codes=reasonCodesOf(value);if(required&&!codes.length)throw new ApiError(400,'수정 요청 사유를 1개 이상 선택하세요.');
 return codes;
}
type AiSource={id:string;version:number;skillVersion:string|null;outputContractVersion:string|null};
type QualityChecks={checks?:{criterion:string;status:string}[]};
export type ReviewedArtifact=Pick<Artifact,'id'|'campaignId'|'role'|'content'|'version'|'origin'>&{meetingId?:string;skillVersion?:string|null;outputContractVersion?:string|null;aiSourceId?:string;aiSource?:AiSource;editStats?:EditStats|null;qualityReview?:QualityChecks};
export function requireCriteria(value:unknown,a:ReviewedArtifact):CriterionJudgement[]|undefined{
 if(value===undefined||value===null)return undefined;
 if(a.role!=='quality')throw new ApiError(400,'기준별 판정은 품질 검수 작업물에만 남길 수 있습니다.');
 const problem=criteriaProblem(value);if(problem)throw new ApiError(400,problem);
 const list=criteriaOf(value,a.qualityReview?.checks||[]);return list.length?list:undefined;
}
type DecisionInput=Omit<ReviewDecision,'id'|'createdAt'|'reasonsVersion'>;
export function decisionStatement(owner:string,input:DecisionInput){
 const id=uid(),decision:ReviewDecision={...input,id,reasonsVersion:REVIEW_REASONS_VERSION,createdAt:stamp()};
 return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:review_decision:${id}`,owner,'review_decision','',JSON.stringify(decision),decision.createdAt);
}
const noVersions={promptVersion:null,skillVersion:null,outputContractVersion:null};
// promptVersion은 사용량 원장(provider_usage)의 조인 키에서 읽는다. 역할 작업물은 artifactId, 브리프 초안은 jobId(=초안 id)다.
async function promptVersionOf(owner:string,field:'artifactId'|'jobId',id:string){
 const row=await database().prepare(`SELECT json_extract(data,'$.promptVersion') AS v FROM records WHERE owner=? AND kind='provider_usage' AND json_extract(data,'$.${field}')=? ORDER BY updated_at DESC LIMIT 1`).bind(owner,id).first<{v:string|null}>();
 return typeof row?.v==='string'?row.v:null;
}
// AI 작업물과 사람이 고친 AI 작업물은 AI 원본 실행의 버전을 쓴다. 직접 작성한 작업물은 버전이 없다.
// AI 원본을 찾지 못한 사람 수정본은 작업물 id로 사용량 원장의 promptVersion만 찾고 실행 버전은 null이다.
async function artifactVersions(owner:string,a:ReviewedArtifact,view:AiView){
 if(view.origin!=='ai'&&view.origin!=='ai_edited')return noVersions;
 return {promptVersion:await promptVersionOf(owner,'artifactId',view.source?.id||a.id),skillVersion:view.source?.skillVersion??null,outputContractVersion:view.source?.outputContractVersion??null};
}
export async function artifactDecisionStatement(owner:string,a:ReviewedArtifact,input:{decision:'approved'|'revision';reasonCodes:ReasonCode[];note:string;criteria?:CriterionJudgement[];actor:ReviewActor}){
 const view=await aiView(owner,a);
 return decisionStatement(owner,{targetKind:'artifact',targetId:a.id,version:a.version,role:a.role,decision:input.decision,reasonCodes:input.reasonCodes,...(input.note?{noteLength:input.note.length}:{}),actor:input.actor,
  ...await artifactVersions(owner,a,view),campaignId:a.campaignId,brandId:null,origin:view.origin,...(input.criteria?{criteria:input.criteria}:{})});
}
export const sourceDecisionStatement=(owner:string,s:{id:string;brandId:string;version:number},actor:ReviewActor,reasonCodes:ReasonCode[])=>
 decisionStatement(owner,{targetKind:'source',targetId:s.id,version:s.version,role:null,decision:'excluded',reasonCodes,actor,...noVersions,campaignId:null,brandId:s.brandId});
export const publicationDecisionStatement=(owner:string,p:{id:string;version:number;campaignId:string},decision:'cancelled'|'returned',actor:ReviewActor,reasonCodes:ReasonCode[])=>
 decisionStatement(owner,{targetKind:'publication',targetId:p.id,version:p.version,role:null,decision,reasonCodes,actor,...noVersions,campaignId:p.campaignId,brandId:null});
// 브리프 저장 때 초안 제안 필드마다 채택·수정·미사용 1건. 비교 기준(baseline)은 초안을 요청할 때의 입력이다. 사유는 수정·미사용 판정에만 붙인다.
export async function briefSuggestionStatements(owner:string,input:{draft:BriefDraft;saved:Partial<BriefInput>;campaign:{id:string;version:number};actor:ReviewActor;reasonCodes:ReasonCode[]}){
 const suggestions=input.draft.result?.suggestions||[];
 if(!suggestions.length)return [];
 const promptVersion=await promptVersionOf(owner,'jobId',input.draft.id);
 return suggestions.map(s=>{
  const decision=suggestionDecision(valueOf(input.saved,s.field),s.value,valueOf(input.draft.input,s.field));
  return decisionStatement(owner,{targetKind:'brief_suggestion',targetId:input.draft.id,version:input.campaign.version,role:null,decision,reasonCodes:decision==='adopted'?[]:input.reasonCodes,section:s.field,actor:input.actor,promptVersion,skillVersion:null,outputContractVersion:null,campaignId:input.campaign.id,brandId:input.draft.input.brandId||null});
 });
}

// D: AI 작업물(origin ai)을 사람이 고쳐 저장하면 ai_edited로 바꾸고 AI 원본(id·버전·실행 버전)과 원본 대비 편집 통계를 남긴다. 직접 작성은 그대로 둔다.
async function aiSourceContent(owner:string,campaignId:string,source:AiSource){
 const row=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='history' AND parent_id=? AND json_extract(data,'$.originalId')=? AND json_extract(data,'$.version')=? AND json_extract(data,'$.origin')='ai' LIMIT 1").bind(owner,campaignId,source.id,source.version).first<{data:string}>();
 return row?(JSON.parse(row.data) as {content:string}).content:null;
}
// 과거 사람 수정본(legacyHumanEdit)의 AI 원본: 이력에서 그보다 앞선 판 중 실제 AI 판(v1 또는 회의 개선)의 가장 최근 판. 없으면 null.
async function legacyAiSource(owner:string,a:ReviewedArtifact):Promise<AiSource|null>{
 const row=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='history' AND parent_id=? AND json_extract(data,'$.originalId')=? AND json_extract(data,'$.origin')='ai' AND json_extract(data,'$.version')<? AND (json_extract(data,'$.version')=1 OR json_extract(data,'$.meetingId') IS NOT NULL) ORDER BY json_extract(data,'$.version') DESC LIMIT 1").bind(owner,a.campaignId,a.id,a.version).first<{data:string}>();
 if(!row)return null;
 const h=JSON.parse(row.data) as ReviewedArtifact;
 return {id:a.id,version:h.version,skillVersion:h.skillVersion??null,outputContractVersion:h.outputContractVersion??null};
}
// 판정·선호 쌍·편집이 보는 출처. 과거 사람 수정본은 origin이 'ai'여도 ai_edited로 보고 이력에서 AI 원본을 찾는다.
type AiView={origin:string;source:AiSource|null};
async function aiView(owner:string,a:ReviewedArtifact):Promise<AiView>{
 if(legacyHumanEdit(a))return {origin:'ai_edited',source:await legacyAiSource(owner,a)};
 if(a.origin==='ai')return {origin:'ai',source:{id:a.id,version:a.version,skillVersion:a.skillVersion??null,outputContractVersion:a.outputContractVersion??null}};
 return {origin:a.origin||'manual',source:a.origin==='ai_edited'?a.aiSource||null:null};
}
export async function correctedOrigin(owner:string,old:ReviewedArtifact|null,content:string){
 if(!old)return {origin:'manual'};
 const view=await aiView(owner,old);
 if(view.origin==='ai'&&view.source)return {origin:'ai_edited',aiSourceId:`${old.id}:${old.version}`,aiSource:view.source,editStats:editStats(old.content,content)};
 if(view.origin!=='ai_edited'||!view.source)return {origin:view.origin};
 const original=await aiSourceContent(owner,old.campaignId,view.source);
 return {origin:'ai_edited',aiSourceId:`${view.source.id}:${view.source.version}`,aiSource:view.source,editStats:original===null?null:editStats(original,content)};
}

async function decisionRows(where:string,binds:unknown[]){
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='review_decision'${where} ORDER BY rowid`).bind(...binds).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as ReviewDecision);
}
// 대상별 이력(기록 순서). 작업물은 targetId가 작업물 id이고 version이 판정한 버전이다. 브리프 제안은 초안 id이고 section이 필드다.
export const targetHistory=(owner:string,kind:ReviewTargetKind,targetId:string)=>decisionRows(" AND json_extract(data,'$.targetKind')=? AND json_extract(data,'$.targetId')=?",[owner,kind,targetId]);
export const campaignDecisions=(owner:string,campaignId:string)=>decisionRows(" AND json_extract(data,'$.campaignId')=?",[owner,campaignId]);
export const firstPassApprovalRates=async(owner:string)=>firstPassApproval(await decisionRows(" AND json_extract(data,'$.targetKind')='artifact'",[owner]));
// B2 κ 계산 단위: (작업물 id·버전, 기준)마다 사람 판정과 판정 시점의 AI 검수 상태.
export type CriterionUnit=CriterionJudgement&{artifactId:string;version:number;decisionId:string;actorId:string;createdAt:string};
export async function criterionUnits(owner:string,campaignId?:string):Promise<CriterionUnit[]>{
 const rows=campaignId?await campaignDecisions(owner,campaignId):await decisionRows(" AND json_extract(data,'$.targetKind')='artifact'",[owner]);
 return rows.flatMap(d=>(d.criteria||[]).map(c=>({...c,artifactId:d.targetId,version:d.version,decisionId:d.id,actorId:d.actor.id,createdAt:d.createdAt})));
}
// H: 선호 쌍은 조회로만 묶는다(학습에 쓰지 않는다). AI 원본·사람 확정본(승인했거나 사람이 고친 현재 판)·판정 이력. 직접 작성한 작업물은 null.
export async function preferencePair(owner:string,artifactId:string){
 const a=await readRecord<ReviewedArtifact&{status:string}>(owner,'artifact',artifactId),view=await aiView(owner,a);
 if(view.origin!=='ai'&&view.origin!=='ai_edited')return null;
 const source=view.source,aiContent=view.origin==='ai'?a.content:source?await aiSourceContent(owner,a.campaignId,source):null;
 const human=a.status==='approved'||view.origin==='ai_edited'?{version:a.version,content:a.content,status:a.status,origin:view.origin,editStats:a.editStats??null}:null;
 return {artifactId:a.id,campaignId:a.campaignId,role:a.role,ai:source&&aiContent!==null?{...source,content:aiContent}:null,human,decisions:await targetHistory(owner,'artifact',a.id)};
}
