import type {Grader,GraderResult,GraderStatus,EvalItem,GradeContext} from './types';
import {questionOnly,thinSection,contractJson,headingNesting,internalIdExposure} from './structure';
import {briefProhibitionConflict,unsupportedClaimTerm,industryMetricLeak,revisitCohortDefinition,localChannelCoverage} from './content';
import {factConflict,inputBudget} from './ledger';
export type {Grader,GraderResult,GraderStatus,EvalItem,EvalKind,GradeContext,FactLedger} from './types';
export {INPUT_TOKEN_CAP} from './ledger';

// 실패 유형 사전 v1(결정론 12종). 순서는 docs/EVAL.ko.md 정의표와 같다. 판정 임계값·ID 패턴은 이 파일들이 정본이다.
export const GRADERS_VERSION='failure-types-v1';
export const GRADERS:Grader[]=[questionOnly,thinSection,contractJson,headingNesting,internalIdExposure,briefProhibitionConflict,factConflict,unsupportedClaimTerm,industryMetricLeak,revisitCohortDefinition,localChannelCoverage,inputBudget];
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
export type GraderSummary=Record<GraderStatus,number>&{passRate:number|null};
// 합격률은 pass/(pass+fail). not_applicable은 분모에서 뺀다.
export function summarize(results:GraderResult[][]):Record<string,GraderSummary>{
 const empty=():Record<GraderStatus,number>=>({pass:0,fail:0,not_applicable:0,grader_error:0});
 const counts=results.flat().reduce<Record<string,Record<GraderStatus,number>>>((acc,r)=>({...acc,[r.id]:{...(acc[r.id]||empty()),[r.status]:(acc[r.id]?.[r.status]||0)+1}}),{});
 return Object.fromEntries(Object.entries(counts).map(([id,c])=>[id,{...c,passRate:c.pass+c.fail?c.pass/(c.pass+c.fail):null}]));
}
