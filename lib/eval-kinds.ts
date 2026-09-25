import {ApiError} from './server';
import type {RoleRequest} from './role-instruction';
import type {PromptSet} from './practice';
import {roleSubmission,type RoleSubmissionRequest} from './role-execution';
import {runGraders,runPreventionGraders,GRADERS_VERSION,type GraderResult,type GraderStatus,type FactLedger,type GradeContext,type EvalItem} from './graders/index';
import {bodyOf,rawNormalization} from './graders/text';
import {checkCompliance} from './graders/compliance';

// 평가 종류 골격(Q1). 평가 케이스(eval_case.kind)마다 요청 동결 검사(freeze), 제출 조립(build: 동결 요청 → {instructions,input}), 채점(grade: 출력 → 채점 결과),
// 케이스 1건 예약 토큰(reserve)을 한 처리기에 둔다. lib/eval-server.ts는 케이스의 kind로 처리기를 골라 부른다. kind가 없는 옛 케이스는 role이다(이행 불필요).
// meeting_step·brief는 G2에서 채울 자리다(lib/meeting-input.ts buildMeetingSubmission, lib/brief-input.ts buildBriefSubmission). 지금은 저장·실행 모두 '지원하지 않는 평가 종류' 400이다.
export const EVAL_CASE_KINDS=['role','meeting_step','brief'] as const;
export type EvalCaseKind=typeof EVAL_CASE_KINDS[number];
// 케이스 1건 예약(역할 EVAL_CASE_TOKEN_RESERVE): HERMES 제출에 토큰 상한이 없어 한 건이 쓸 양을 미리 잡아 둔다. 실측 역할 1회 7,343~13,997토큰(docs/observations/2026-09-23-live-run.md)의 약 3.5배다.
// 예약은 종류 처리기의 값만 쓴다(케이스별 덮어쓰기 없음). 회의 단계처럼 다른 예약이 필요한 종류는 G2에서 그 처리기의 reserve로 둔다.
export const EVAL_CASE_TOKEN_RESERVE=50000;
// 기대 판정 = lib/graders 채점 컨텍스트.
export type EvalExpectations={prohibitedTerms:string[];facts:FactLedger|null;industry:string|null;localStore:boolean;inputTokenCap?:number};
type KindCase={id:string;role:string;kind?:string;expectations:EvalExpectations};
const obj=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;

// ── role: 운영 역할 실행과 같은 조립(lib/role-execution.ts roleSubmission — 운영자 선호 블록·권한 문장 포함)으로 보낸다 ──
// 직접 저장하는 요청은 운영 요청 구조여야 하고 현재 역할 조립기가 받아야 한다. 선호 블록은 있으면 {note, rules[]} 모양이어야 한다.
function freezeRole(v:unknown,role:string):RoleRequest{
 const r=obj(v),prefs=r?.operatorPreferences===undefined?null:obj(r.operatorPreferences);
 if(!r||r.role!==role||!obj(r.campaign)||!obj(r.brand)||!obj(r.archive)||!obj(r.evidence)||!Array.isArray(r.previous))throw new ApiError(400,'역할 요청(request)은 role·campaign·brand·archive·evidence·previous를 갖춘 운영 요청 구조여야 합니다.');
 if(r.operatorPreferences!==undefined&&(typeof prefs?.note!=='string'||!Array.isArray(prefs.rules)))throw new ApiError(400,'운영자 선호 블록(operatorPreferences)은 {note, rules:[]} 형식이어야 합니다.');
 try{roleSubmission(r as RoleSubmissionRequest)}catch{throw new ApiError(400,'역할 요청으로 지시문을 만들 수 없습니다. 형식을 확인하세요.')}
 return r as RoleRequest;
}
// side: 쌍 평가(pair)의 이 쪽 본문. undefined면 동결 요청 그대로, 아니면 그 본문(PromptSet, active가 코드 상수면 null → 주입 없음)을 요청 prompts로 주입한다.
// 동결 요청의 다른 필드(운영자 선호 블록 포함)는 그대로다. 종류마다 주입 자리가 달라(회의 단계는 snapshot.prompts) 처리기가 정한다.
function buildRole(request:RoleRequest,side?:PromptSet|null){const {instructions,input}=roleSubmission(side===undefined?request:{...request,prompts:side??undefined});return {instructions,input}}
// lib/graders 13종과 규제 가드레일로 채점한다. run에는 판정·요약만, 발췌가 든 가드레일 상세(report)는 eval_output에 둔다.
// graders·가드레일은 사람이 보는 정규화 렌더본을 채점하고, 정규화가 가릴 수 있는 두 결함은 prevention(정규화 전)과 normalization 건수로 따로 남긴다.
const gradeRows=(rows:GraderResult[])=>rows.map(g=>({id:g.id,status:g.status,...(g.detail?{detail:g.detail.slice(0,200)}:{})}));
function gradeRole(kase:KindCase,output:string,inputTokens:number|null){
 const e=kase.expectations,item:EvalItem={id:kase.id,kind:'role',role:kase.role,raw:output,contract:true,inputTokens};
 const ctx:GradeContext={prohibitedTerms:e.prohibitedTerms,facts:e.facts,industry:e.industry,localStore:e.localStore,...(e.inputTokenCap?{inputTokenCap:e.inputTokenCap}:{})};
 const graders=gradeRows(runGraders(item,ctx)),prevention=gradeRows(runPreventionGraders(item,ctx)),normalization=rawNormalization(item);
 const report=checkCompliance(bodyOf(item),{facts:e.facts}),severity=(s:string)=>report.issues.filter(i=>i.severity===s).length;
 const summary=graders.reduce((acc,g)=>({...acc,[g.status]:acc[g.status]+1}),{pass:0,fail:0,not_applicable:0,grader_error:0} as Record<GraderStatus,number>);
 return {report,result:{gradersVersion:GRADERS_VERSION,graders,summary,prevention,...(normalization?{normalization}:{}),compliance:{version:report.version,block:severity('block'),warn:severity('warn'),info:severity('info'),issues:report.issues.map(i=>({category:i.category,ruleId:i.ruleId,severity:i.severity}))}}};
}
// 처리기 계약. 요청 타입은 아직 역할(RoleRequest)뿐이다. G2가 두 번째 종류를 등록할 때 EvalCase.request와 함께 종류별 합집합으로 넓힌다.
export type EvalKindHandler={kind:EvalCaseKind;reserve:number;freeze:(request:unknown,role:string)=>RoleRequest;build:(request:RoleRequest,side?:PromptSet|null)=>{instructions:string;input:string};grade:typeof gradeRole};
const HANDLERS:Record<EvalCaseKind,EvalKindHandler|null>={role:{kind:'role',reserve:EVAL_CASE_TOKEN_RESERVE,freeze:freezeRole,build:buildRole,grade:gradeRole},meeting_step:null,brief:null};

const known=(v:unknown):v is EvalCaseKind=>typeof v==='string'&&(EVAL_CASE_KINDS as readonly string[]).includes(v);
// 입력의 kind: 없으면 role, 목록 밖이면 400.
export function caseKind(v:unknown):EvalCaseKind{
 if(v===undefined)return 'role';
 if(!known(v))throw new ApiError(400,`평가 종류(kind)는 ${EVAL_CASE_KINDS.join('·')} 중 하나여야 합니다.`);
 return v;
}
// 케이스 kind의 처리기(없으면 role). 자리만 있는 종류(meeting_step·brief)와 저장된 목록 밖 값은 400이다.
export function evalKind(v:unknown):EvalKindHandler{
 const kind=v??'role',handler=known(kind)?HANDLERS[kind]:null;
 if(!handler)throw new ApiError(400,`지원하지 않는 평가 종류입니다(${String(kind)}). 지금은 역할(role) 평가만 저장·실행합니다.`);
 return handler;
}
// 케이스 1건 예약 토큰: 종류 처리기의 값. run 시작 때 결과 행 reserve에 고정하고, run 예산 하한·제출 직전 run 예산·월 상한 재검사가 모두 이 값을 쓴다.
export function reserveOf(kase:{kind?:string}){return evalKind(kase.kind).reserve}
