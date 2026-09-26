import type {EvalCase,EvalRun} from './eval-server';
import {pairGate} from './eval-stats';

// 운영 화면에는 동결 요청·출력·기대 판정·케이스별 채점 근거를 보내지 않는다.
export function operationsSummary(cases:EvalCase[],runs:EvalRun[]){
 return {
  cases:cases.map(c=>({id:c.id,kind:c.kind??'role',role:c.role,set:c.set})),
  runs:runs.filter(r=>!r.deleted).map(r=>{
   const latest=r.regrades?.at(-1),gate=r.variant==='pair'?pairGate(r):null;
   return {id:r.id,label:r.label,status:r.status,variant:r.variant,usedTokens:r.usedTokens,createdAt:r.createdAt,
    completed:r.results.filter(x=>x.status==='completed').length,total:r.results.length,
    pair:r.pair?{unit:r.pair.unit,candidateVersionId:r.pair.candidateVersionId}:null,
    gate:gate?{ok:gate.ok,reasons:gate.reasons,warnings:gate.warnings,cases:gate.cases,sealedCases:gate.sealedCases,passes:gate.passes,inputBudget:gate.inputBudget}:null,
    regrade:latest?{id:latest.id,at:latest.at,gradersVersion:latest.gradersVersion,totals:latest.totals}:null};
  }),
 };
}
