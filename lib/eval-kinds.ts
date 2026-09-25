import {ApiError,str} from './server';
import type {RoleRequest} from './role-instruction';
import type {PromptSet} from './practice';
import {roles} from './agency';
import {aiBrand} from './ai-context';
import {roleSubmission,type RoleSubmissionRequest} from './role-execution';
import {runGraders,runPreventionGraders,GRADERS,GRADERS_VERSION,ALL_GRADERS,type GraderResult,type GraderStatus,type FactLedger,type GradeContext,type EvalItem,type SeededDefect} from './graders/index';
import {bodyOf,rawNormalization} from './graders/text';
import {outputObject,proseValues,briefPlanValues} from './graders/types';
import {checkCompliance} from './graders/compliance';
import {buildBriefSubmission,type BriefRequest} from './brief-input';
import {meetingStepRequestOf,buildMeetingRequest,briefRequestOf,targetStep,type MeetingStepRequest} from './eval-freeze';
import {scrubMeetingOutput,meetingLabels,type Synthesis} from './meetings';

// 평가 종류(Q1 골격, G2 회의·브리프). 평가 케이스(eval_case.kind)마다 요청 동결(freeze: 입력 → 저장 요청·담당), 제출 조립(build: 동결 요청 → {instructions,input}),
// 채점(grade: 출력 → 채점 결과), 케이스 1건 예약 토큰(reserve), 쌍 평가 대상 캠페인(campaignOf)을 한 처리기에 둔다. lib/eval-server.ts는 케이스의 kind로 처리기를 고른다.
// kind가 없는 옛 케이스는 role이다(이행 불필요). 요청은 종류별 모양이 달라 처리기 계약은 unknown으로 받고, 각 처리기가 저장 때 검사한 모양으로 읽는다.
export const EVAL_CASE_KINDS=['role','meeting_step','brief'] as const;
export type EvalCaseKind=typeof EVAL_CASE_KINDS[number];
// 케이스 1건 예약(역할 EVAL_CASE_TOKEN_RESERVE): HERMES 제출에 토큰 상한이 없어 한 건이 쓸 양을 미리 잡아 둔다. 실측 역할 1회 7,343~13,997토큰(docs/observations/2026-09-23-live-run.md)의 약 3.5배다.
// 회의 단계는 원 작업물 8개(각 8,000자)·재검토 후보(각 24,000자)가 입력에 들어가 파일럿 실측 전까지 100,000으로 잡는다(설계 2-8). 브리프는 미측정이라 역할과 같게 둔다.
// 예약은 종류 처리기의 값만 쓴다(케이스별 덮어쓰기 없음).
export const EVAL_CASE_TOKEN_RESERVE=50000,EVAL_MEETING_STEP_TOKEN_RESERVE=100000,EVAL_BRIEF_TOKEN_RESERVE=50000;
// 기대 판정 = lib/graders 채점 컨텍스트. industry는 단일 업종 ID 또는 [주 업종, ...허용 업종](G3). seededDefects는 회의 재검토·개선본이 찾아야 할 심은 결함(G3).
export type EvalExpectations={prohibitedTerms:string[];facts:FactLedger|null;industry:string|string[]|null;localStore:boolean;inputTokenCap?:number;seededDefects?:SeededDefect[]};
export type EvalRequest=RoleRequest|MeetingStepRequest|BriefRequest;
type KindCase={id:string;role:string;kind?:string;request:EvalRequest;expectations:EvalExpectations};
const obj=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const baseContext=(e:EvalExpectations):GradeContext=>({prohibitedTerms:e.prohibitedTerms,facts:e.facts,industry:e.industry,localStore:e.localStore,...(e.inputTokenCap?{inputTokenCap:e.inputTokenCap}:{})});
// 역할 담당 ID(에이전시 역할 목록). 회의 단계는 대상 단계의 담당, 브리프는 담당이 없어 BRIEF_ROLE이다.
export function roleId(v:unknown){const id=str(v,'담당',40,true);if(!roles.some(r=>r.id===id))throw new ApiError(400,'담당을 선택해 주세요.');return id}
export const BRIEF_ROLE='brief';

// 채점 결과: lib/graders와 규제 가드레일. run에는 판정·요약만, 발췌가 든 가드레일 상세(report)는 eval_output에 둔다.
// prevention(정규화 전 heading_nesting·internal_id_exposure)과 normalization 건수는 역할 산출물 렌더에 있다. 회의 단계는 원문의 internal_id_exposure만 예방 판정으로 두고(정규화 건수 없음), 브리프는 빈 목록이다.
const gradeRows=(rows:GraderResult[])=>rows.map(g=>({id:g.id,status:g.status,...(g.detail?{detail:g.detail.slice(0,200)}:{})}));
function graded(item:EvalItem,ctx:GradeContext,graders=runGraders(item,ctx),role=item.kind==='role',preventionRows?:GraderResult[]){
 const rows=gradeRows(graders),prevention=preventionRows?gradeRows(preventionRows):role?gradeRows(runPreventionGraders(item,ctx)):[],normalization=role?rawNormalization(item):null;
 const report=checkCompliance(bodyOf(item),{facts:ctx.facts??null}),severity=(s:string)=>report.issues.filter(i=>i.severity===s).length;
 const summary=rows.reduce((acc,g)=>({...acc,[g.status]:acc[g.status]+1}),{pass:0,fail:0,not_applicable:0,grader_error:0} as Record<GraderStatus,number>);
 return {report,result:{gradersVersion:GRADERS_VERSION,graders:rows,summary,prevention,...(normalization?{normalization}:{}),compliance:{version:report.version,block:severity('block'),warn:severity('warn'),info:severity('info'),issues:report.issues.map(i=>({category:i.category,ruleId:i.ruleId,severity:i.severity}))}}};
}
export type GradedCase=ReturnType<typeof graded>;
export type EvalKindHandler={kind:EvalCaseKind;reserve:number;
 freeze:(request:unknown,role:unknown)=>{request:EvalRequest;role:string};
 build:(request:EvalRequest,side?:PromptSet|null)=>{instructions:string;input:string};
 grade:(kase:KindCase,output:string,inputTokens:number|null)=>GradedCase;
 // 쌍 평가(pair) 대상 캠페인(roleRunUnits로 후보 단위를 쓰는지 본다). null이면 쌍 평가에서 뺀다.
 campaignOf:(request:EvalRequest)=>Record<string,unknown>|null;
 // 저장 요청이 가진 사실 원장(capture·save의 기본 facts).
 factsOf:(request:EvalRequest)=>FactLedger|null};
const ledgerOf=(facts:{confirmed?:unknown;prohibited?:unknown}|undefined|null):FactLedger|null=>facts&&Array.isArray(facts.confirmed)&&Array.isArray(facts.prohibited)?{confirmed:facts.confirmed,prohibited:facts.prohibited} as FactLedger:null;

// ── role: 운영 역할 실행과 같은 조립(lib/role-execution.ts roleSubmission — 운영자 선호 블록·권한 문장 포함)으로 보낸다 ──
// 직접 저장하는 요청은 운영 요청 구조여야 하고 현재 역할 조립기가 받아야 한다. 선호 블록은 있으면 {note, rules[]} 모양이어야 한다.
function freezeRole(v:unknown,roleInput:unknown){
 const role=roleId(roleInput),r=obj(v),prefs=r?.operatorPreferences===undefined?null:obj(r.operatorPreferences);
 if(!r||r.role!==role||!obj(r.campaign)||!obj(r.brand)||!obj(r.archive)||!obj(r.evidence)||!Array.isArray(r.previous))throw new ApiError(400,'역할 요청(request)은 role·campaign·brand·archive·evidence·previous를 갖춘 운영 요청 구조여야 합니다.');
 if(r.operatorPreferences!==undefined&&(typeof prefs?.note!=='string'||!Array.isArray(prefs.rules)))throw new ApiError(400,'운영자 선호 블록(operatorPreferences)은 {note, rules:[]} 형식이어야 합니다.');
 try{roleSubmission(r as RoleSubmissionRequest)}catch{throw new ApiError(400,'역할 요청으로 지시문을 만들 수 없습니다. 형식을 확인하세요.')}
 return {request:r as RoleRequest,role};
}
// side: 쌍 평가(pair)의 이 쪽 본문. undefined면 동결 요청 그대로, 아니면 그 본문(PromptSet, active가 코드 상수면 null → 주입 없음)을 요청 prompts로 주입한다.
// 동결 요청의 다른 필드(운영자 선호 블록 포함)는 그대로다. 종류마다 주입 자리가 달라(회의 단계는 snapshot.prompts) 처리기가 정한다.
function buildRole(request:EvalRequest,side?:PromptSet|null){const r=request as RoleRequest,{instructions,input}=roleSubmission(side===undefined?r:{...r,prompts:side??undefined});return {instructions,input}}
// lib/graders 13종(GRADERS)으로 채점한다. 회의·브리프용 채점기(KIND_GRADERS)는 역할 산출물에 붙이지 않아 역할 run의 기존 비교가 그대로다.
function gradeRole(kase:KindCase,output:string,inputTokens:number|null){
 return graded({id:kase.id,kind:'role',role:kase.role,raw:output,contract:true,inputTokens},baseContext(kase.expectations));
}

// ── meeting_step: 운영 회의 진행과 같은 조립(lib/meeting-input.ts buildMeetingSubmission)을 대상 단계 직전 기록으로 부른다 ──
// 저장 요청은 lib/eval-freeze.ts가 자르고 줄이고 가린 {meeting, stepId, storeAllow}다. 담당은 대상 단계의 담당이며, 입력의 role이 다르면 400이다.
function freezeMeeting(v:unknown,roleInput:unknown){
 const request=meetingStepRequestOf(v),role=targetStep(request).role;
 if(roleInput!==undefined&&roleInput!==role)throw new ApiError(400,`회의 단계 케이스의 담당은 대상 단계의 담당(${role})이어야 합니다.`);
 return {request,role};
}
// 채점 항목: 발언은 기존 discussion 채점(fields·앞선 발언 역할), 합의·개선본·재검토는 meeting_step(G3). 사람이 읽는 본문(text)은
// 개선본이면 content, 합의·재검토면 판정·역할 같은 코드 필드와 되묻는 질문(questions)을 뺀 문장이다. 원 JSON(raw)은 형식 채점기가 읽는다.
const parsed=(output:string)=>outputObject({id:'',kind:'meeting_step',raw:output});
function stepText(phase:string,x:Record<string,unknown>|null,output:string){
 if(!x)return output;
 if(phase==='revision')return typeof x.content==='string'?x.content:'';
 return proseValues(Object.fromEntries(Object.entries(x).filter(([k])=>k!=='questions'))).join('\n\n');
}
// normalized: 운영이 저장·표시하는 정규화본(scrubMeetingOutput, 라벨은 동결 회의 기록의 meetingLabels)으로 채점한다. false면 원문(예방 판정용)이다.
function meetingItem(kase:KindCase,output:string,inputTokens:number|null,normalized=true):EvalItem{
 const r=kase.request as MeetingStepRequest,m=r.meeting,s=targetStep(r),at=m.steps.indexOf(s),raw=parsed(output),x=raw&&normalized?scrubMeetingOutput(raw,meetingLabels(m)):raw,base={id:kase.id,role:s.role,meetingId:m.id,inputTokens};
 if(s.phase==='discussion')return {...base,kind:'discussion',...(x?{fields:x}:{}),priorRoles:m.steps.slice(0,at).filter(t=>t.phase==='discussion'&&t.status==='completed').map(t=>t.role)};
 const synthesis=m.steps.find(t=>t.phase==='synthesis')?.output as Synthesis|undefined,original=[...m.snapshot.artifacts].reverse().find(a=>a.role===s.role)?.content;
 return {...base,kind:'meeting_step',phase:s.phase,raw:output,text:stepText(s.phase,x,output),contract:!!m.skillVersion,
  ...(s.phase==='revision'&&original?{original:original.slice(0,8000)}:{}),...(s.phase==='quality'?{taskRoles:(synthesis?.tasks||[]).map(t=>t.role)}:{})};
}
const brandContext=(brand:{name?:string}&Parameters<typeof aiBrand>[0])=>({brandIntro:aiBrand(brand).brandIntro.text,brandName:brand.name||''});
function gradeMeeting(kase:KindCase,output:string,inputTokens:number|null){
 const m=(kase.request as MeetingStepRequest).meeting,e=kase.expectations;
 const ctx:GradeContext={...baseContext(e),...(e.seededDefects?{seededDefects:e.seededDefects}:{}),...brandContext(m.snapshot.brand)};
 const item=meetingItem(kase,output,inputTokens),exposure=GRADERS.filter(g=>g.id==='internal_id_exposure');
 return graded(item,ctx,runGraders(item,ctx,ALL_GRADERS),false,runGraders(meetingItem(kase,output,inputTokens,false),ctx,exposure));
}

// ── brief: 운영 브리프 초안과 같은 조립(lib/brief-input.ts buildBriefSubmission). 레지스트리 단위가 없어 쌍 평가에서 뺀다 ──
function freezeBrief(v:unknown,roleInput:unknown){
 if(roleInput!==undefined&&roleInput!==BRIEF_ROLE)throw new ApiError(400,`브리프 케이스의 담당은 ${BRIEF_ROLE}입니다.`);
 return {request:briefRequestOf(v),role:BRIEF_ROLE};
}
function buildBrief(request:EvalRequest,side?:PromptSet|null){
 if(side!==undefined)throw new Error('브리프는 쌍 평가 대상이 아닙니다.');
 const {instructions,input}=buildBriefSubmission(request as BriefRequest);
 return {instructions,input};
}
// 본문(text)은 계획이 되는 summary·제안 값이다(questions·assumptions 제외, 설계 3절). JSON이 아니면 원문 그대로다. briefInput은 사용자가 준 값(가격·날짜 단정 판정 제외).
function gradeBrief(kase:KindCase,output:string,inputTokens:number|null){
 const r=kase.request as BriefRequest,x=parsed(output),e=kase.expectations;
 const item:EvalItem={id:kase.id,kind:'brief',role:BRIEF_ROLE,raw:output,text:x?briefPlanValues(x).join('\n\n'):output,inputTokens};
 const ctx:GradeContext={...baseContext(e),briefInput:JSON.stringify({...r.input,contextDate:r.contextDate}),...brandContext(r.context.brand)};
 return graded(item,ctx,runGraders(item,ctx,ALL_GRADERS));
}

const HANDLERS:Record<EvalCaseKind,EvalKindHandler>={
 role:{kind:'role',reserve:EVAL_CASE_TOKEN_RESERVE,freeze:freezeRole,build:buildRole,grade:gradeRole,campaignOf:r=>obj((r as RoleRequest).campaign),factsOf:r=>ledgerOf((r as RoleRequest).evidence?.facts)},
 meeting_step:{kind:'meeting_step',reserve:EVAL_MEETING_STEP_TOKEN_RESERVE,freeze:freezeMeeting,build:(r,side)=>buildMeetingRequest(r as MeetingStepRequest,side),grade:gradeMeeting,campaignOf:r=>obj((r as MeetingStepRequest).meeting.snapshot.campaign),factsOf:r=>ledgerOf((r as MeetingStepRequest).meeting.snapshot.evidence?.facts)},
 brief:{kind:'brief',reserve:EVAL_BRIEF_TOKEN_RESERVE,freeze:freezeBrief,build:buildBrief,grade:gradeBrief,campaignOf:()=>null,factsOf:r=>ledgerOf((r as BriefRequest).context.evidence.facts)},
};

const known=(v:unknown):v is EvalCaseKind=>typeof v==='string'&&(EVAL_CASE_KINDS as readonly string[]).includes(v);
// 입력의 kind: 없으면 role, 목록 밖이면 400.
export function caseKind(v:unknown):EvalCaseKind{
 if(v===undefined)return 'role';
 if(!known(v))throw new ApiError(400,`평가 종류(kind)는 ${EVAL_CASE_KINDS.join('·')} 중 하나여야 합니다.`);
 return v;
}
// 케이스 kind의 처리기(없으면 role). 저장된 목록 밖 값은 400이다.
export function evalKind(v:unknown):EvalKindHandler{
 const kind=v??'role';
 if(!known(kind))throw new ApiError(400,`지원하지 않는 평가 종류입니다(${String(kind)}).`);
 return HANDLERS[kind];
}
// 케이스 1건 예약 토큰: 종류 처리기의 값. run 시작 때 결과 행 reserve에 고정하고, run 예산 하한·제출 직전 run 예산·월 상한 재검사가 모두 이 값을 쓴다.
export function reserveOf(kase:{kind?:string}){return evalKind(kase.kind).reserve}
