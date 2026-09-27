import {ApiError,str,stamp,readRecord,listRecords,database} from './server';
import {PRACTICE_VERSION} from './practice';
import {roles} from './agency';
import {brandStoreAllow} from './store-allow-server';
import {buildMeetingSubmission} from './meeting-input';
import {briefRequestFor,buildBriefSubmission} from './brief-input';
import {briefSources} from './brief-execution';
import {meetingBefore,freezeMeetingRequest,buildMeetingRequest,freezeBriefRequest} from './eval-freeze';
import {BRIEF_ROLE,evalKind,type EvalRequest} from './eval-kinds';
import {learningBrand,viralAnalysisSubmission,type LearningTask,type ViralAnalysisRequest} from './learning-execution';
import {phaseNames,type Meeting} from './meetings';
import type {BriefInput} from './brief';
import type {ViralCase} from './learning';
import type {Brand} from './agency';
import type {InputMasking} from './ai-context';
import type {FactLedger} from './graders/index';

// 운영 기록에서 회의 단계·브리프 평가 케이스를 캡처한다(G2). 동결은 lib/eval-freeze.ts, 이 파일은 DB 읽기와 드리프트 판정이다.
// 드리프트 판정(captureCheck): 지금 코드로 다시 조립한 제출이 운영이 그때 저장·전송한 제출(hermes_submission)과 같은지 본다. 지시문·입력만 비교하고(무작위 session_id 제외),
// 회의는 첫 제출(attempt 0, 교정 문장 없음)과 비교한다. 결과(submission):
//  identical 같다 · no_submission 저장 제출 없음 · code_changed 회의 당시 실무 스킬 버전(PRACTICE_VERSION)이 지금과 다르다(브리프는 지시문이 다르다)
//  store_allow_changed 가림 기록이 그때와 다르다(지점 허용 값을 지금 값으로 다시 읽는다) · context_changed 브리프 원자료(다른 캠페인·성과·학습)를 지금 DB로 다시 읽어 입력이 다르다
//  (바이럴 사례 분석은 사례·관찰 기록이 작업 뒤에 바뀌었다. 지시문이 다르면 code_changed, 브랜드 가림 기록이 다르면 store_allow_changed다)
//  assembly_drift 위 사유 없이 다르다 — 이것만 경보한다(조립 코드가 운영과 갈라졌다는 뜻).
// frozenIdentical: 동결본(자르고 줄이고 가린 저장 요청)으로 만든 제출이 원기록 조립과 같은지. 발췌 상한 앞부분의 가림으로 글자 수가 바뀐 경우만 false다.
export type CaptureSubmission='identical'|'no_submission'|'code_changed'|'store_allow_changed'|'context_changed'|'assembly_drift';
export type CaptureCheck={submission:CaptureSubmission;frozenIdentical:boolean;checkedAt:string};
export type Captured={request:EvalRequest;role:string;campaignId:string|null;label:string;facts:FactLedger|null;captureCheck:CaptureCheck};
type Built={instructions:string;input:string};
const same=(a:Built,b:Built)=>a.instructions===b.instructions&&a.input===b.input;
async function storedSubmission(owner:string,id:string):Promise<Built|null>{
 try{const body=JSON.parse((await readRecord<{body:string}>(owner,'hermes_submission',id)).body);return {instructions:String(body.instructions),input:String(body.input)}}
 catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
}
const ledgerOf=(facts:{confirmed?:unknown;prohibited?:unknown}|undefined):FactLedger|null=>facts&&Array.isArray(facts.confirmed)&&Array.isArray(facts.prohibited)?{confirmed:facts.confirmed,prohibited:facts.prohibited} as FactLedger:null;

// {kind:'meeting_step', meetingId, stepId}. 지점 허용 값은 지금 값으로 읽는다(운영도 제출 때마다 읽는다).
export async function captureMeetingStep(owner:string,input:Record<string,unknown>):Promise<Captured>{
 const m=await readRecord<Meeting>(owner,'team_meeting',str(input.meetingId,'회의',100,true)),stepId=str(input.stepId,'회의 단계',200,true);
 const storeAllow=await brandStoreAllow(owner,m.snapshot.campaign),production=buildMeetingSubmission(meetingBefore(m,stepId),stepId,storeAllow);
 const request=freezeMeetingRequest(m,stepId,storeAllow),stored=await storedSubmission(owner,stepId);
 const step=m.steps.find(s=>s.id===stepId)!,recorded=(step as {inputMasking?:InputMasking[]}).inputMasking;
 const submission:CaptureSubmission=!stored?'no_submission':same(stored,production)?'identical':m.skillVersion!==PRACTICE_VERSION?'code_changed':JSON.stringify(production.maskingRecord)!==JSON.stringify(recorded)?'store_allow_changed':'assembly_drift';
 const roleName=roles.find(r=>r.id===step.role)?.name||step.role;
 return {request,role:step.role,campaignId:m.campaignId,label:`${phaseNames[step.phase]} · ${roleName} · ${m.snapshot.campaign.title}`,facts:ledgerOf(m.snapshot.evidence?.facts),
  captureCheck:{submission,frozenIdentical:same(buildMeetingRequest(request),production),checkedAt:stamp()}};
}
// {kind:'brief', briefDraftId}. 저장 초안의 입력과 작성일(UTC 날짜)을 기준일로, 운영 start와 같은 DB 읽기(briefSources)로 요청을 다시 만든다.
type StoredDraft={id:string;input:BriefInput;campaignId?:string;createdAt:string};
export async function captureBrief(owner:string,input:Record<string,unknown>):Promise<Captured>{
 const draft=await readRecord<StoredDraft>(owner,'brief_draft',str(input.briefDraftId,'브리프 초안',100,true));
 const raw=JSON.parse(JSON.stringify(briefRequestFor(await briefSources(owner,{campaignId:draft.campaignId,input:draft.input,contextDate:draft.createdAt.slice(0,10)}))));
 const production=buildBriefSubmission(raw),request=freezeBriefRequest(raw),stored=await storedSubmission(owner,'brief-'+draft.id);
 const submission:CaptureSubmission=!stored?'no_submission':same(stored,production)?'identical':stored.instructions!==production.instructions?'code_changed':'context_changed';
 return {request,role:BRIEF_ROLE,campaignId:draft.campaignId??null,label:`브리프 초안 · ${draft.input.title||'제목 없음'}`,facts:ledgerOf(request.context.evidence.facts),
  captureCheck:{submission,frozenIdentical:same(buildBriefSubmission(request),production),checkedAt:stamp()}};
}

// {kind:'viral_analysis', jobId}(레인 Q 바이럴 평가 PR 1). 끝난(completed·failed·cancelled) 사례 분석(L1) 작업만 캡처한다. 운영 start_analysis와 같은 DB 읽기
// (사례·관찰 기록·가린 브랜드 정체성, lib/learning-execution.ts learningBrand)로 요청을 다시 만들고, 그때 쓴 본문(레지스트리 버전이면 그 버전, 아니면 코드 상수)으로 조립해 저장 제출과 비교한다.
// 거부: jobId 없음 400, 없는 작업 404, 조사(L2)·규칙 초안(L3) 작업 400(조사 입력에는 요청 시각 requestedAt이 들어가 재현할 수 없다), 진행 중 409.
const LEARNING_ROLES=['viral_analysis','viral_discovery','viral_guidance'],FINISHED=['completed','failed','cancelled'];
async function usedBody(owner:string,task:LearningTask){
 if(!task.promptVersion)return undefined;
 try{return (await readRecord<{body?:unknown}>(owner,'prompt_version',task.promptVersion)).body}catch(e){if(e instanceof ApiError&&e.status===404)return undefined;throw e}
}
const caseContext=(x:{case?:unknown;observations?:unknown})=>JSON.stringify({case:x.case,observations:x.observations});
function storedContext(stored:Built){try{return caseContext(JSON.parse(stored.input))}catch{return null}}
export async function captureViralAnalysis(owner:string,input:Record<string,unknown>):Promise<Captured>{
 const id=str(input.jobId,'학습 작업(jobId)',200,true);
 const job=await database().prepare('SELECT role,status FROM jobs WHERE id=? AND owner=?').bind(id,owner).first<{role:string;status:string}>();
 if(!job||!LEARNING_ROLES.includes(job.role))throw new ApiError(404,'학습 작업을 찾을 수 없습니다.');
 if(job.role==='viral_discovery')throw new ApiError(400,'바이럴 사례 조사(L2) 작업은 입력에 요청 시각이 들어가 재현할 수 없어 평가 케이스로 캡처하지 않습니다. 사례 분석 작업을 고르세요.');
 if(job.role!=='viral_analysis')throw new ApiError(400,'바이럴 사례 분석 작업만 평가 케이스로 캡처합니다.');
 if(!FINISHED.includes(job.status))throw new ApiError(409,'진행 중인 사례 분석 작업은 끝난 뒤 캡처하세요.');
 const task=await readRecord<LearningTask>(owner,'learning_task',id);
 if(task.kind!=='analysis'||!task.caseId)throw new ApiError(400,'바이럴 사례 분석 작업만 평가 케이스로 캡처합니다.');
 const c=await readRecord<ViralCase>(owner,'viral_case',task.caseId),brand=await readRecord<Brand>(owner,'brand',c.brandId);
 const [observations,modelBrand]=await Promise.all([listRecords<ViralCase>(owner,'case_observation',c.id),learningBrand(owner,brand)]);
 const raw=JSON.parse(JSON.stringify({brand:modelBrand.value,case:c,observations})) as ViralAnalysisRequest,body=await usedBody(owner,task);
 const production=viralAnalysisSubmission(raw,body),frozen=evalKind('viral_analysis').freeze(raw,undefined),request=frozen.request as ViralAnalysisRequest,stored=await storedSubmission(owner,id);
 const submission:CaptureSubmission=!stored?'no_submission':same(stored,production)?'identical':stored.instructions!==production.instructions?'code_changed'
  :JSON.stringify(modelBrand.masking)!==JSON.stringify(task.inputMasking??[])?'store_allow_changed':storedContext(stored)!==caseContext(raw)?'context_changed':'assembly_drift';
 return {request,role:frozen.role,campaignId:null,label:`사례 분석 · ${c.title}`,facts:null,
  captureCheck:{submission,frozenIdentical:same(viralAnalysisSubmission(request,body),production),checkedAt:stamp()}};
}
