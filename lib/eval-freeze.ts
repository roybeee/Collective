import {ApiError} from './server';
import {maskFields} from './pii-scan';
import {productionAllow,withoutPlanOwner,withoutAssignees} from './ai-context';
import {MEETING_MASK_PATHS,MEETING_ARTIFACT_FIELDS,buildMeetingSubmission} from './meeting-input';
import {BRIEF_MASK_PATHS,buildBriefSubmission,type BriefRequest} from './brief-input';
import type {Meeting,MeetingStep,MeetingPhase} from './meetings';
import type {PromptSet} from './practice';

// 회의 단계·브리프 평가 요청의 동결(G2). 저장 요청은 조립(lib/meeting-input.ts·lib/brief-input.ts)이 읽는 필드만 남기고, 운영 제출과 같은 가림을 원자료 자리에 적용한다.
// 조립은 다시 가리지만 가린 자리표시는 다시 탐지되지 않아 결과가 같다(두 번 가린 결과 = 한 번 가린 결과). 그래서 동결본으로 만든 제출은 운영 제출과 바이트가 같다.
// 한계: 발췌 상한(회의 원 작업물 8,000자·재검토 후보 24,000자)을 넘는 본문의 앞부분에 가릴 값이 있으면 가림으로 글자 수가 바뀌어 발췌 끝이 달라진다.
// 운영 기록에서 캡처할 때는 이 차이를 frozenIdentical=false로 남긴다(lib/eval-capture.ts).

// 운영 가림 경로(조립 결과 기준) → 동결 요청의 원자료 경로. 끝이 '.'인 키는 앞부분 치환이다. 목록에 없는 운영 경로가 생기면 동결이 400 대신 오류를 내 테스트가 잡는다.
type PathMap=readonly (readonly [string,readonly string[]])[];
function sourcePaths(paths:readonly string[],map:PathMap){
 return paths.flatMap(p=>{
  const hit=map.find(([key])=>key.endsWith('.')?p.startsWith(key):p===key);
  if(!hit)throw new Error(`동결 가림 경로 대응이 없습니다: ${p}`);
  const [key,targets]=hit;
  return key.endsWith('.')?targets.map(t=>t+p.slice(key.length)):targets;
 });
}
// 개선본(revision 단계 출력)의 제목·본문은 completedRevisions·candidateArtifacts 두 곳으로 간다. 단계 종류로 골라 따로 가린다(REVISION 표시 경로).
const REVISION='revision:';
const MEETING_PATH_MAP:PathMap=[
 ['agenda',['meeting.agenda']],
 ['brand.brandIntro.text',['meeting.snapshot.brand.description','meeting.snapshot.brand.knowledge']],
 ['brand.identity.',['meeting.snapshot.brand.']],
 ['evidence.',['meeting.snapshot.evidence.']],
 ['brandArchive.',['meeting.snapshot.brandArchive.']],
 ['campaign.',['meeting.snapshot.campaign.']],
 ['recordedMetrics.',['meeting.snapshot.metrics.']],
 ['previousMeeting.',['meeting.snapshot.previous.']],
 ['originalArtifacts.*.',['meeting.snapshot.artifacts.*.']],
 ['completedRevisions.*.',[REVISION]],
 ['candidateArtifacts.*.',['meeting.snapshot.artifacts.*.',REVISION]],
];
const BRIEF_PATH_MAP:PathMap=[
 ['brand.brandIntro.text',['context.brand.description','context.brand.knowledge']],
 ['brand.identity.',['context.brand.']],
 ['evidence.',['context.evidence.']],
 ['brandArchive.',['context.archive.']],
 ['currentBrief.',['input.']],
 ['previousCampaigns.',['context.previousCampaigns.']],
 ['recordedMetrics.',['context.recordedMetrics.']],
 ['approvedLearnings.',['context.approvedLearnings.']],
];
const meetingSource=sourcePaths(MEETING_MASK_PATHS,MEETING_PATH_MAP);
export const MEETING_FREEZE_MASK_PATHS=[...new Set(meetingSource.filter(p=>!p.startsWith(REVISION)))];
export const MEETING_REVISION_MASK_KEYS=[...new Set(meetingSource.filter(p=>p.startsWith(REVISION)).map(p=>p.slice(REVISION.length)))];
export const BRIEF_FREEZE_MASK_PATHS=[...new Set(sourcePaths(BRIEF_MASK_PATHS,BRIEF_PATH_MAP))];

const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const pick=(a:Record<string,unknown>,keys:readonly string[])=>Object.fromEntries(Object.entries(a).filter(([k])=>keys.includes(k)));
const bad=(message:string)=>new ApiError(400,message);
// 브랜드는 aiBrand가 읽는 필드와 id만 둔다(의뢰 정보 intake·bg는 모델에 가지 않는다). lib/brief-input.ts BriefBrand와 같다.
const BRAND_FIELDS=['id','name','short','category','color','tone','audience','constraints','description','knowledge'];
// 단계 기록은 조립이 읽는 필드만 둔다. 실행 메타(providerId·raw·오류·시도 기록·토큰·가림 기록)는 저장하지 않는다.
const STEP_FIELDS=['id','role','phase','status','output','task'];
const PHASES:readonly MeetingPhase[]=['discussion','synthesis','revision','quality'];
const strings=(v:unknown,label:string)=>{if(v===undefined)return [];if(!Array.isArray(v)||v.length>500||!v.every(x=>typeof x==='string'&&x.length<=500))throw bad(`${label}은(는) 문자열 목록이어야 합니다.`);return v as string[]};

// ── 회의 단계 ──
export type FrozenMeeting=Pick<Meeting,'id'|'campaignId'|'skillVersion'|'agenda'|'steps'|'snapshot'>;
export type MeetingStepRequest={meeting:FrozenMeeting;stepId:string;storeAllow:string[]};
// 대상 단계 직전의 회의 기록: 앞 단계는 그대로(완료), 대상 단계는 출력·교정 없이 대기, 뒤 단계는 없다. 운영이 그 단계를 처음 제출할 때(attempt 0)의 기록과 조립 결과가 같다.
// 교정 재시도(correction·attempt)는 떼어 첫 제출을 재현한다. 원자료는 줄이지 않는다(운영 비교용). 줄이고 가리는 것은 freezeMeetingRequest다.
export function meetingBefore(m:Meeting,stepId:string):Meeting{
 const at=m.steps.findIndex(s=>s.id===stepId);
 if(at<0)throw bad('회의 단계(stepId)를 찾을 수 없습니다.');
 const target=m.steps[at];
 if(!PHASES.includes(target.phase))throw bad('평가할 수 없는 회의 단계입니다.');
 return {...m,steps:[...m.steps.slice(0,at),{id:target.id,role:target.role,phase:target.phase,status:'pending',...(target.task?{task:target.task}:{})}]};
}
function minimalMeeting(m:Meeting):FrozenMeeting{
 const s=m.snapshot;
 const snapshot:Meeting['snapshot']={
  ...(s.prompts?{prompts:s.prompts}:{}),...(s.brandArchive?{brandArchive:withoutAssignees(s.brandArchive)}:{}),...(s.sourceMasking?{sourceMasking:s.sourceMasking}:{}),
  campaign:withoutPlanOwner(s.campaign),brand:pick(s.brand as unknown as Record<string,unknown>,BRAND_FIELDS) as unknown as Meeting['snapshot']['brand'],
  artifacts:s.artifacts.map(a=>pick(a as unknown as Record<string,unknown>,MEETING_ARTIFACT_FIELDS) as unknown as Meeting['snapshot']['artifacts'][number]),
  metrics:s.metrics,learning:s.learning,...(s.evidence?{evidence:{facts:s.evidence.facts,directives:s.evidence.directives} as Meeting['snapshot']['evidence']}:{}),...(s.previous?{previous:s.previous}:{}),
 };
 return {id:m.id,campaignId:m.campaignId,...(m.skillVersion?{skillVersion:m.skillVersion}:{}),agenda:m.agenda,steps:m.steps.map(t=>pick(t as unknown as Record<string,unknown>,STEP_FIELDS) as unknown as MeetingStep),snapshot};
}
const meetingAllow=(m:FrozenMeeting,storeAllow:readonly string[])=>productionAllow(m.snapshot.evidence,m.snapshot.brandArchive,storeAllow);
// 동결: 직전 기록으로 자르고, 조립이 읽는 필드만 남기고, 운영 가림 경로의 원자료를 같은 허용 값으로 가린다. 개선본 출력은 제목·본문만 가린다(다른 단계 출력은 운영도 가리지 않는다).
export function freezeMeetingRequest(m:Meeting,stepId:string,storeAllow:readonly string[]):MeetingStepRequest{
 const meeting=minimalMeeting(meetingBefore(m,stepId)),allow=meetingAllow(meeting,storeAllow);
 const masked=maskFields({meeting,stepId,storeAllow:[...storeAllow]},MEETING_FREEZE_MASK_PATHS,{allow}).value;
 const steps=masked.meeting.steps.map(t=>t.phase==='revision'&&isRecord(t.output)?{...t,output:maskFields(t.output,MEETING_REVISION_MASK_KEYS,{allow}).value}:t);
 return {...masked,meeting:{...masked.meeting,steps}};
}
// 직접 저장(save_case)하는 회의 단계 요청: {meeting, stepId, storeAllow}. 형식을 본 뒤 운영 캡처와 같은 동결을 거치고, 지금 조립기가 받아야 한다.
export function meetingStepRequestOf(v:unknown):MeetingStepRequest{
 const r=isRecord(v)?v:null,m=isRecord(r?.meeting)?r.meeting:null,s=isRecord(m?.snapshot)?m.snapshot:null;
 if(!r||!m||!s||typeof m.agenda!=='string'||!Array.isArray(m.steps)||!m.steps.every(t=>isRecord(t)&&typeof t.id==='string'&&typeof t.role==='string'&&typeof t.phase==='string')||!isRecord(s.campaign)||!isRecord(s.brand)||!Array.isArray(s.artifacts)||!Array.isArray(s.metrics)||!Array.isArray(s.learning))
  throw bad('회의 단계 요청(request)은 {meeting:{agenda, steps[], snapshot:{campaign, brand, artifacts[], metrics[], learning[]}}, stepId, storeAllow[]} 형식이어야 합니다.');
 if(typeof r.stepId!=='string'||!r.stepId)throw bad('회의 단계(stepId)를 입력하세요.');
 const frozen=freezeMeetingRequest(m as unknown as Meeting,r.stepId,strings(r.storeAllow,'지점 허용 값(storeAllow)'));
 try{buildMeetingRequest(frozen)}catch{throw bad('회의 단계 요청으로 지시문을 만들 수 없습니다. 형식을 확인하세요.')}
 return frozen;
}
// side: 쌍 평가의 이 쪽 본문. undefined면 동결 요청 그대로, 아니면 회의 스냅샷의 프롬프트 본문(snapshot.prompts.set)을 그 본문으로 바꾼다(null이면 코드 상수).
function withPromptSet(s:Meeting['snapshot'],set:PromptSet|null):Meeting['snapshot']{
 const rest=Object.fromEntries(Object.entries(s).filter(([k])=>k!=='prompts')) as Meeting['snapshot'];
 return set?{...rest,prompts:{...(s.prompts||{}),source:'registry',set}}:rest;
}
export function buildMeetingRequest({meeting,stepId,storeAllow}:MeetingStepRequest,side?:PromptSet|null){
 const m=side===undefined?meeting:{...meeting,snapshot:withPromptSet(meeting.snapshot,side)};
 const {instructions,input}=buildMeetingSubmission(m as unknown as Meeting,stepId,storeAllow);
 return {instructions,input};
}
export const targetStep=(r:MeetingStepRequest)=>r.meeting.steps.find(s=>s.id===r.stepId)!;

// ── 브리프 ──
const DATE=/^\d{4}-\d{2}-\d{2}$/;
// 동결: 담당자 실명 자리표시(두 번 적용해도 같다)와 브랜드 필드 최소화 뒤 운영 가림 경로의 원자료를 같은 허용 값으로 가린다.
export function freezeBriefRequest(r:BriefRequest):BriefRequest{
 const c=r.context,min:BriefRequest={...r,input:withoutPlanOwner(r.input),context:{...c,brand:pick(c.brand as unknown as Record<string,unknown>,BRAND_FIELDS) as unknown as BriefRequest['context']['brand'],archive:withoutAssignees(c.archive),previousCampaigns:c.previousCampaigns.map(p=>withoutPlanOwner(p))},storeAllow:[...r.storeAllow]};
 return maskFields(min,BRIEF_FREEZE_MASK_PATHS,{allow:productionAllow(c.evidence,c.archive,r.storeAllow)}).value;
}
export function briefRequestOf(v:unknown):BriefRequest{
 const r=isRecord(v)?v:null,c=isRecord(r?.context)?r.context:null,e=isRecord(c?.evidence)?c.evidence:null;
 if(!r||!isRecord(r.input)||typeof r.input.brandId!=='string'||!c||!isRecord(c.brand)||!e||!isRecord(e.facts)||!Array.isArray(e.directives)||!Array.isArray(c.sourceMasking)||!Array.isArray(c.previousCampaigns)||!Array.isArray(c.recordedMetrics)||!Array.isArray(c.approvedLearnings))
  throw bad('브리프 요청(request)은 {input:{brandId…}, context:{brand, evidence:{facts, directives[]}, archive, sourceMasking[], trialLearning, previousCampaigns[], recordedMetrics[], approvedLearnings[]}, contextDate, storeAllow[]} 형식이어야 합니다.');
 if(typeof r.contextDate!=='string'||!DATE.test(r.contextDate))throw bad('브리프 기준일(contextDate)은 YYYY-MM-DD 형식이어야 합니다.');
 const frozen=freezeBriefRequest({...(r as unknown as BriefRequest),storeAllow:strings(r.storeAllow,'지점 허용 값(storeAllow)')});
 try{buildBriefSubmission(frozen)}catch{throw bad('브리프 요청으로 지시문을 만들 수 없습니다. 형식을 확인하세요.')}
 return frozen;
}
