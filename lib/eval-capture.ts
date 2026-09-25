import {ApiError,str,stamp,readRecord} from './server';
import {PRACTICE_VERSION} from './practice';
import {roles} from './agency';
import {brandStoreAllow} from './store-allow-server';
import {buildMeetingSubmission} from './meeting-input';
import {briefRequestFor,buildBriefSubmission} from './brief-input';
import {briefSources} from './brief-execution';
import {meetingBefore,freezeMeetingRequest,buildMeetingRequest,freezeBriefRequest} from './eval-freeze';
import {BRIEF_ROLE,type EvalRequest} from './eval-kinds';
import {phaseNames,type Meeting} from './meetings';
import type {BriefInput} from './brief';
import type {InputMasking} from './ai-context';
import type {FactLedger} from './graders/index';

// 운영 기록에서 회의 단계·브리프 평가 케이스를 캡처한다(G2). 동결은 lib/eval-freeze.ts, 이 파일은 DB 읽기와 드리프트 판정이다.
// 드리프트 판정(captureCheck): 지금 코드로 다시 조립한 제출이 운영이 그때 저장·전송한 제출(hermes_submission)과 같은지 본다. 지시문·입력만 비교하고(무작위 session_id 제외),
// 회의는 첫 제출(attempt 0, 교정 문장 없음)과 비교한다. 결과(submission):
//  identical 같다 · no_submission 저장 제출 없음 · code_changed 회의 당시 실무 스킬 버전(PRACTICE_VERSION)이 지금과 다르다(브리프는 지시문이 다르다)
//  store_allow_changed 가림 기록이 그때와 다르다(지점 허용 값을 지금 값으로 다시 읽는다) · context_changed 브리프 원자료(다른 캠페인·성과·학습)를 지금 DB로 다시 읽어 입력이 다르다
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
