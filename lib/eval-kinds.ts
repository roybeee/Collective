import {ApiError,str} from './server';
import type {RoleRequest} from './role-instruction';
import type {PromptSet} from './practice';
import {roles} from './agency';
import {aiBrand} from './ai-context';
import {voiceForRole} from './brand-voice';
import {roleSubmission,type RoleSubmissionRequest} from './role-execution';
import {preferenceSides,type OperatorPreferenceBlock} from './playbook-curator';
import {runGraders,runPreventionGraders,GRADERS,GRADERS_VERSION,ALL_GRADERS,VIRAL_GRADERS,viralProse,type GraderResult,type GraderStatus,type FactLedger,type GradeContext,type EvalItem,type SeededDefect} from './graders/index';
import {bodyOf,rawNormalization} from './graders/text';
import {outputObject,proseValues,briefPlanValues} from './graders/types';
import {checkCompliance} from './graders/compliance';
import {buildBriefSubmission,type BriefRequest} from './brief-input';
import {meetingStepRequestOf,buildMeetingRequest,briefRequestOf,targetStep,type MeetingStepRequest} from './eval-freeze';
import {scrubMeetingOutput,meetingLabels,type Synthesis} from './meetings';
import {viralAnalysisSubmission,type ViralAnalysisRequest} from './learning-execution';
import {INPUT_DIET_PAIR_KIND,INPUT_DIET_SIDES,INPUT_DIET_VERSION} from './input-diet';

// 평가 종류(Q1 골격, G2 회의·브리프). 평가 케이스(eval_case.kind)마다 요청 동결(freeze: 입력 → 저장 요청·담당), 제출 조립(build: 동결 요청 → {instructions,input}),
// 채점(grade: 출력 → 채점 결과), 케이스 1건 예약 토큰(reserve), 쌍 평가 대상 캠페인(campaignOf)을 한 처리기에 둔다. lib/eval-server.ts는 케이스의 kind로 처리기를 고른다.
// kind가 없는 옛 케이스는 role이다(이행 불필요). 요청은 종류별 모양이 달라 처리기 계약은 unknown으로 받고, 각 처리기가 저장 때 검사한 모양으로 읽는다.
export const EVAL_CASE_KINDS=['role','meeting_step','brief','viral_analysis'] as const;
export type EvalCaseKind=typeof EVAL_CASE_KINDS[number];
// 케이스 1건 예약(역할 EVAL_CASE_TOKEN_RESERVE): HERMES 제출에 토큰 상한이 없어 한 건이 쓸 양을 미리 잡아 둔다. 실측 역할 1회 7,343~13,997토큰(docs/observations/2026-09-23-live-run.md)의 약 3.5배다.
// 회의 단계는 원 작업물 8개(각 8,000자)·재검토 후보(각 24,000자)가 입력에 들어가 파일럿 실측 전까지 100,000으로 잡는다(설계 2-8). 브리프는 미측정이라 역할과 같게 둔다.
// 예약은 종류 처리기의 값만 쓴다(케이스별 덮어쓰기 없음).
export const EVAL_CASE_TOKEN_RESERVE=50000,EVAL_MEETING_STEP_TOKEN_RESERVE=100000,EVAL_BRIEF_TOKEN_RESERVE=50000;
// 바이럴 사례 분석(viral_analysis): 입력은 사례(관찰 14,000자·자막 20,000자 상한)와 관찰 기록 목록이다. 실측 전이라 역할과 같게 둔다(docs/EVAL.ko.md 8절).
export const EVAL_VIRAL_ANALYSIS_TOKEN_RESERVE=50000;
// 기대 판정 = lib/graders 채점 컨텍스트. industry는 단일 업종 ID 또는 [주 업종, ...허용 업종](G3). seededDefects는 회의 재검토·개선본이 찾아야 할 심은 결함(G3).
export type EvalExpectations={prohibitedTerms:string[];facts:FactLedger|null;industry:string|string[]|null;localStore:boolean;inputTokenCap?:number;seededDefects?:SeededDefect[]};
export type EvalRequest=RoleRequest|MeetingStepRequest|BriefRequest|ViralAnalysisRequest;
type KindCase={id:string;role:string;kind?:string;request:EvalRequest;expectations:EvalExpectations};
// 쌍 평가의 한 쪽. 프롬프트 쌍(F3b)은 본문(PromptSet, active가 코드 상수면 null), 운영자 선호 쌍(B3-2b)은 off·on과 run에 고정한 블록이다.
// 입력 축소 쌍(C07, pair.kind input_diet)은 같은 동결 요청을 스위치 꺼짐(off)·켜짐(on)으로 조립한다(lib/input-diet.ts INPUT_DIET_SIDES).
export type PreferenceSide={preference:'off'|'on';block:OperatorPreferenceBlock};
export type InputDietSide={inputDiet:'off'|'on'};
export type EvalSide=PromptSet|null|PreferenceSide|InputDietSide;
const preferenceSide=(side:EvalSide|undefined):side is PreferenceSide=>!!side&&'preference' in side;
const inputDietSide=(side:EvalSide|undefined):side is InputDietSide=>!!side&&'inputDiet' in side;
const dietOf=(side:InputDietSide)=>INPUT_DIET_SIDES[side.inputDiet];
const obj=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const baseContext=(e:EvalExpectations):GradeContext=>({prohibitedTerms:e.prohibitedTerms,facts:e.facts,industry:e.industry,localStore:e.localStore,...(e.inputTokenCap?{inputTokenCap:e.inputTokenCap}:{})});
// 역할 담당 ID(에이전시 역할 목록). 회의 단계는 대상 단계의 담당, 브리프는 담당이 없어 BRIEF_ROLE이다.
export function roleId(v:unknown){const id=str(v,'담당',40,true);if(!roles.some(r=>r.id===id))throw new ApiError(400,'담당을 선택해 주세요.');return id}
export const BRIEF_ROLE='brief',VIRAL_ANALYSIS_ROLE='viral_analysis';

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
 build:(request:EvalRequest,side?:EvalSide)=>{instructions:string;input:string};
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
// 운영자 선호 쌍(B3-2b)은 동결 요청의 operatorPreferences만 바꾼다: off는 키를 빼고, on은 run에 고정한 블록을 넣는다(preferenceSides). 조립은 운영과 같은 roleSubmission이다.
// 입력 축소 쌍(C07)은 동결 요청을 그대로 두고 조립 인자만 off·on으로 넘긴다. off는 인자 없는 조립과 바이트가 같다.
function buildRole(request:EvalRequest,side?:EvalSide){
 const r=request as RoleSubmissionRequest;
 if(inputDietSide(side)){const {instructions,input}=roleSubmission(r,dietOf(side));return {instructions,input}}
 const {instructions,input}=roleSubmission(preferenceSide(side)?preferenceSides(r,side.block)[side.preference]:side===undefined?r:{...r,prompts:side??undefined});
 return {instructions,input};
}
// lib/graders 13종(GRADERS)으로 채점한다. 회의·브리프용 채점기(KIND_GRADERS)는 역할 산출물에 붙이지 않아 역할 run의 기존 비교가 그대로다.
// 브랜드 말투(A3-2): 동결 요청의 확정 말투가 입력에 실리는 역할(content·creative)이면 피할 표현을 채점 맥락에 넣는다. 없으면 키가 없어 기존 채점과 같다.
// 기대 계약(A3-4): 동결 요청에 출력 프로필이 있으면 채점 맥락에 넣는다. contract_json이 요청한 계약으로 원문을 읽어 운영과 같이 v1 원문을 거부한다. 없으면 키가 없다.
function gradeRole(kase:KindCase,output:string,inputTokens:number|null){
 const request=kase.request as RoleRequest,voice=voiceForRole(kase.role,request.brandVoice);
 return graded({id:kase.id,kind:'role',role:kase.role,raw:output,contract:true,inputTokens},{...baseContext(kase.expectations),...(voice?{brandVoice:{avoidTerms:[...voice.avoidTerms]}}:{}),...(request.outputProfile?{outputProfile:request.outputProfile}:{})});
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

// ── brief: 운영 브리프 초안과 같은 조립(lib/brief-input.ts buildBriefSubmission). 레지스트리 단위가 없어 프롬프트 쌍 평가에서 빼고, 입력 축소 쌍(C07)만 대상이다 ──
function freezeBrief(v:unknown,roleInput:unknown){
 if(roleInput!==undefined&&roleInput!==BRIEF_ROLE)throw new ApiError(400,`브리프 케이스의 담당은 ${BRIEF_ROLE}입니다.`);
 return {request:briefRequestOf(v),role:BRIEF_ROLE};
}
// 입력 축소 쌍(C07)만 받는다. 프롬프트·운영자 선호 쌍은 여전히 대상이 아니다.
function buildBrief(request:EvalRequest,side?:EvalSide){
 if(side!==undefined&&!inputDietSide(side))throw new Error('브리프는 입력 축소 쌍 평가만 대상입니다.');
 const {instructions,input}=buildBriefSubmission(request as BriefRequest,side?dietOf(side):undefined);
 return {instructions,input};
}
// 본문(text)은 계획이 되는 summary·제안 값이다(questions·assumptions 제외, 설계 3절). JSON이 아니면 원문 그대로다. briefInput은 사용자가 준 값(가격·날짜 단정 판정 제외).
function gradeBrief(kase:KindCase,output:string,inputTokens:number|null){
 const r=kase.request as BriefRequest,x=parsed(output),e=kase.expectations;
 const item:EvalItem={id:kase.id,kind:'brief',role:BRIEF_ROLE,raw:output,text:x?briefPlanValues(x).join('\n\n'):output,inputTokens};
 const ctx:GradeContext={...baseContext(e),briefInput:JSON.stringify({...r.input,contextDate:r.contextDate}),...brandContext(r.context.brand)};
 return graded(item,ctx,runGraders(item,ctx,ALL_GRADERS));
}

// ── viral_analysis: 운영 사례 분석(L1)과 같은 조립(lib/learning-execution.ts viralAnalysisSubmission) ──
// 저장 요청은 운영 입력 그대로 {brand, case, observations}다(brand는 운영이 보낸 가린 정체성 필드). 담당은 VIRAL_ANALYSIS_ROLE이다.
// 조사(L2)는 입력에 요청 시각(requestedAt)이 들어가 재현할 수 없어 평가 종류가 아니다({query, requestedAt} 모양은 400).
const caseText=(c:Record<string,unknown>|null)=>!!c&&typeof c.id==='string'&&typeof c.brandId==='string'&&typeof c.scope==='string'&&typeof c.observations==='string'&&!!c.observations.trim();
function freezeViral(v:unknown,roleInput:unknown){
 if(roleInput!==undefined&&roleInput!==VIRAL_ANALYSIS_ROLE)throw new ApiError(400,`바이럴 사례 분석 케이스의 담당은 ${VIRAL_ANALYSIS_ROLE}입니다.`);
 const r=obj(v),observations=r?.observations;
 if(!r||!obj(r.brand)||!caseText(obj(r.case))||!Array.isArray(observations)||!observations.every(o=>obj(o)))throw new ApiError(400,'바이럴 사례 분석 요청(request)은 {brand:{}, case:{id, brandId, scope, observations}, observations:[]} 형식이어야 합니다. 조사(query·requestedAt)는 평가 대상이 아닙니다.');
 const request={brand:r.brand,case:r.case,observations} as ViralAnalysisRequest;
 try{viralAnalysisSubmission(request)}catch{throw new ApiError(400,'바이럴 사례 분석 요청으로 지시문을 만들 수 없습니다. 형식을 확인하세요.')}
 return {request,role:VIRAL_ANALYSIS_ROLE};
}
// side: undefined(active run)·null(쌍 평가 active가 코드 상수)은 코드 상수, PromptSet은 그 viral 본문(없으면 코드 상수)이다. 운영자 선호 쌍은 대상이 아니다.
function buildViral(request:EvalRequest,side?:EvalSide){
 if(preferenceSide(side))throw new Error('바이럴 사례 분석은 운영자 선호 쌍 평가 대상이 아닙니다.');
 if(inputDietSide(side))throw new Error('바이럴 사례 분석은 입력 축소 쌍 평가 대상이 아닙니다(조립이 inputDiet를 받지 않는다).');
 return viralAnalysisSubmission(request as ViralAnalysisRequest,side?.viral);
}
// 채점 항목: 원 JSON(raw)과 사람이 읽는 분석 문장(text, 규제 가드레일이 읽는다). 채점기는 바이럴 목록(VIRAL_GRADERS)만 쓰고, 관찰 밖 수치 판정에 동결 사례·관찰을 준다.
function gradeViral(kase:KindCase,output:string,inputTokens:number|null){
 const r=kase.request as ViralAnalysisRequest,base:EvalItem={id:kase.id,kind:'viral_analysis',role:VIRAL_ANALYSIS_ROLE,raw:output,inputTokens};
 const item={...base,text:viralProse(base).join('\n\n')},ctx:GradeContext={...baseContext(kase.expectations),viralCase:{case:r.case,observations:r.observations}};
 return graded(item,ctx,runGraders(item,ctx,VIRAL_GRADERS));
}

const HANDLERS:Record<EvalCaseKind,EvalKindHandler>={
 role:{kind:'role',reserve:EVAL_CASE_TOKEN_RESERVE,freeze:freezeRole,build:buildRole,grade:gradeRole,campaignOf:r=>obj((r as RoleRequest).campaign),factsOf:r=>ledgerOf((r as RoleRequest).evidence?.facts)},
 meeting_step:{kind:'meeting_step',reserve:EVAL_MEETING_STEP_TOKEN_RESERVE,freeze:freezeMeeting,build:(r,side)=>{if(preferenceSide(side))throw new Error('회의 단계는 운영자 선호 쌍 평가 대상이 아닙니다.');return inputDietSide(side)?buildMeetingRequest(r as MeetingStepRequest,undefined,dietOf(side)):buildMeetingRequest(r as MeetingStepRequest,side)},grade:gradeMeeting,campaignOf:r=>obj((r as MeetingStepRequest).meeting.snapshot.campaign),factsOf:r=>ledgerOf((r as MeetingStepRequest).meeting.snapshot.evidence?.facts)},
 brief:{kind:'brief',reserve:EVAL_BRIEF_TOKEN_RESERVE,freeze:freezeBrief,build:buildBrief,grade:gradeBrief,campaignOf:()=>null,factsOf:r=>ledgerOf((r as BriefRequest).context.evidence.facts)},
 // 캠페인이 없어 캠페인 기준 쌍 평가(역할·채널 단위)에서는 빠지고, viral.discovery 쌍 평가만 대상이다(lib/eval-server.ts pairCases).
 viral_analysis:{kind:'viral_analysis',reserve:EVAL_VIRAL_ANALYSIS_TOKEN_RESERVE,freeze:freezeViral,build:buildViral,grade:gradeViral,campaignOf:()=>null,factsOf:()=>null},
};

// ── 입력 축소 on/off 쌍 평가(성장1 C07, docs/EVAL.ko.md 'input_diet 쌍') ──
// pair:{kind:'input_diet'}: active=off(동결 요청을 inputDiet false로 조립 = 지금 평가 기본 조립), candidate=on(inputDiet true). 규칙·본문 선택이 없어 메타가 고정값이다.
// 대상은 조립 함수가 inputDiet를 받는 종류뿐이다(역할 roleSubmission·회의 buildMeetingSubmission·브리프 buildBriefSubmission). 바이럴 사례 분석은 빠진다(skippedCases).
// 이 run은 스위치 input_diet 켜기 판단 근거이고 프롬프트 활성화 근거가 아니다(lib/prompt-registry.ts gateRun 409).
export const INPUT_DIET_PAIR={kind:INPUT_DIET_PAIR_KIND,unit:INPUT_DIET_PAIR_KIND,activeVersionId:'off',candidateVersionId:INPUT_DIET_VERSION} as const;
export type InputDietPair={kind:typeof INPUT_DIET_PAIR_KIND;unit:typeof INPUT_DIET_PAIR_KIND;activeVersionId:'off';candidateVersionId:typeof INPUT_DIET_VERSION};
export const isInputDietPair=(pair:object|null|undefined):pair is InputDietPair=>!!pair&&(pair as {kind?:unknown}).kind===INPUT_DIET_PAIR_KIND;
export const INPUT_DIET_PAIR_KINDS:readonly EvalCaseKind[]=['role','meeting_step','brief'];
export function inputDietPairCases<C extends {kind?:string}>(cases:readonly C[]){
 const kept=cases.filter(c=>(INPUT_DIET_PAIR_KINDS as readonly string[]).includes(c.kind??'role'));
 return {cases:kept,skippedCases:cases.length-kept.length};
}

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
