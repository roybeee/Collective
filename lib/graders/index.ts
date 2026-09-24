import type {Grader,GraderResult,GraderStatus,EvalItem,GradeContext} from './types';
import {questionOnly,thinSection,contractJson,headingNesting,internalIdExposure} from './structure';
import {briefProhibitionConflict,unsupportedClaimTerm,industryMetricLeak,revisitCohortDefinition,localChannelCoverage} from './content';
import {factConflict,unconfirmedValueAssertion,inputBudget} from './ledger';
import {unnormalizedItem,rawNormalization} from './text';
export type {Grader,GraderResult,GraderStatus,EvalItem,EvalKind,GradeContext,FactLedger} from './types';
export {INPUT_TOKEN_CAP} from './ledger';

// 실패 유형 사전 v1(결정론 13종). 순서는 docs/EVAL.ko.md 정의표와 같다. 판정 임계값·ID 패턴은 이 파일들이 정본이다.
// 'v1+normalized': 원 JSON(raw)은 사람이 보는 정규화 렌더본(lib/output-normalize.ts)으로 채점한다. 'failure-types-v1'은 정규화 전 렌더본을 채점했다(품질 기준선 v1).
// '+measure-v2': 13종은 같고 부정·규칙 문장 판정(negation.ts)과 unsupported_claim_term·revisit_cohort_definition 판정을 고쳤다(측정 도구 v2). 판정이 바뀌면 이 값을 올려
// 같은 저울 재채점(regrade_run)의 버전 검사와 비교(gradersVersions)가 저울 변경을 구분하게 한다.
export const GRADERS_VERSION='failure-types-v1+normalized+measure-v2';
export const GRADERS:Grader[]=[questionOnly,thinSection,contractJson,headingNesting,internalIdExposure,briefProhibitionConflict,factConflict,unconfirmedValueAssertion,unsupportedClaimTerm,industryMetricLeak,revisitCohortDefinition,localChannelCoverage,inputBudget];
export const CONTENT_GRADERS=GRADERS.filter(g=>g.content).map(g=>g.id);

function safely(grader:Grader,item:EvalItem,ctx:GradeContext):GraderResult{
 try{return {id:grader.id,...grader.grade(item,ctx)}}
 catch(error){return {id:grader.id,status:'grader_error',detail:String((error as Error)?.message||error).slice(0,200)}}
}
// 채점기 하나의 예외는 grader_error로 격리하고 나머지는 계속한다. 재질문(question_only fail)이면 내용 채점기는 이중 계산을 막으려고 not_applicable로 둔다.
export function runGraders(item:EvalItem,ctx:GradeContext={},graders:Grader[]=GRADERS):GraderResult[]{
 const first=graders.find(g=>g.id==='question_only'),reask=first&&safely(first,item,ctx);
 return graders.map(g=>g===first&&reask?reask:reask?.status==='fail'&&g.content?{id:g.id,status:'not_applicable' as const,detail:'question_only fail 우선(이중 계산 방지)'}:safely(g,item,ctx));
}
// 예방 판정: 정규화가 고치는 두 결함은 정규화 뒤 채점으로는 pass가 되므로, 원 JSON 항목을 정규화 전 렌더본으로 이 두 채점기만 다시 돌린다.
// 지시문 예방(모델이 처음부터 만들지 않음)의 측정값이다. 저장 본문(text) 항목은 원문이 없어 빈 목록이다. 순서는 GRADERS와 같다.
// 정규화는 채점기가 잡는 알려진 경로·#·## 제목만 바꾸므로, 정규화가 바꾼 건이 있으면 채점기가 원문에서 못 본 경우(품질 JSON의 \n 이스케이프 뒤 경로 등)도 fail이다.
export const PREVENTION_GRADERS=['heading_nesting','internal_id_exposure'] as const;
export function runPreventionGraders(item:EvalItem,ctx:GradeContext={}):GraderResult[]{
 const raw=unnormalizedItem(item),n=rawNormalization(item);
 if(!raw)return [];
 const changed:Record<string,number>={heading_nesting:n?.headings??0,internal_id_exposure:n?.schemaPaths??0};
 return runGraders(raw,ctx,GRADERS.filter(g=>(PREVENTION_GRADERS as readonly string[]).includes(g.id))).map(r=>r.status==='pass'&&changed[r.id]>0?{id:r.id,status:'fail' as const,detail:`정규화가 바꾼 ${r.id==='heading_nesting'?'#·## 제목':'스키마 경로'} ${changed[r.id]}건`}:r);
}
export type GraderSummary=Record<GraderStatus,number>&{passRate:number|null};
// 합격률은 pass/(pass+fail). not_applicable은 분모에서 뺀다.
export function summarize(results:GraderResult[][]):Record<string,GraderSummary>{
 const empty=():Record<GraderStatus,number>=>({pass:0,fail:0,not_applicable:0,grader_error:0});
 const counts=results.flat().reduce<Record<string,Record<GraderStatus,number>>>((acc,r)=>({...acc,[r.id]:{...(acc[r.id]||empty()),[r.status]:(acc[r.id]?.[r.status]||0)+1}}),{});
 return Object.fromEntries(Object.entries(counts).map(([id,c])=>[id,{...c,passRate:c.pass+c.fail?c.pass/(c.pass+c.fail):null}]));
}
