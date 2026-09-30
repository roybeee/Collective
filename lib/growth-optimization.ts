import {executionSafeText} from './growth-execution';
const refId=(v:unknown)=>{if(typeof v!=='string'||!/^[A-Za-z0-9_.:-]{1,120}$/.test(v))throw new GrowthOptimizationError('실패 근거 ID 형식을 확인하세요.');return v};
export class GrowthOptimizationError extends Error {}
export const failureKinds=['experiment_result','lesson_application','journey','cause_link','cs_ticket'] as const;
export const candidateKinds=['prompt_unit','landing_copy','offer_message','operating_rule'] as const;
export type CandidateInput={failureKind:typeof failureKinds[number];failureId:string;failureVersion:number;failureSummary:string;candidateKind:typeof candidateKinds[number];targetRef:string;proposal:string;tokenBudget:number;krwBudget:number};
export type OptimizationStage='draft'|'frozen'|'offline_evaluated'|'sales_linked'|'adopted'|'rolled_back'|'discarded';
/** Sandbox caps: an optimization candidate cannot authorize more than this budget and never touches prompt registry, graders or seals. */
export const MAX_TOKEN_BUDGET=200_000,MAX_KRW_BUDGET=300_000;
export function parseCandidate(value:unknown):CandidateInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthOptimizationError('최적화 후보 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!failureKinds.includes(b.failureKind as CandidateInput['failureKind']))throw new GrowthOptimizationError('실패 근거 종류를 선택하세요.');
 if(!candidateKinds.includes(b.candidateKind as CandidateInput['candidateKind']))throw new GrowthOptimizationError('후보 종류를 선택하세요.');
 const int=(v:unknown,label:string,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max?v:(()=>{throw new GrowthOptimizationError(`${label}은(는) 0~${max.toLocaleString('en-US')} 정수입니다.`)})();
 const version=typeof b.failureVersion==='number'&&Number.isSafeInteger(b.failureVersion)&&b.failureVersion>=1?b.failureVersion:(()=>{throw new GrowthOptimizationError('실패 근거의 판을 확인하세요.')})();
 try{
  const targetRef=executionSafeText(b.targetRef,'대상 참조',120);if(!/^[A-Za-z0-9_.:-]+$/.test(targetRef))throw new GrowthOptimizationError('대상 참조는 내부 식별자(예: 프롬프트 단위 이름)여야 합니다.');
  return {failureKind:b.failureKind as CandidateInput['failureKind'],failureId:refId(b.failureId),failureVersion:version,failureSummary:executionSafeText(b.failureSummary,'실패 원인 요약',1000),candidateKind:b.candidateKind as CandidateInput['candidateKind'],targetRef,proposal:executionSafeText(b.proposal,'개선 제안',3000),tokenBudget:int(b.tokenBudget,'토큰 예산',MAX_TOKEN_BUDGET),krwBudget:int(b.krwBudget,'비용 예산(원)',MAX_KRW_BUDGET)};
 }catch(e){if(e instanceof GrowthOptimizationError)throw e;throw new GrowthOptimizationError(e instanceof Error?e.message:'입력을 확인하세요.')}
}
/** Offline evaluation and sales effect are separate: an offline pass never implies a sales improvement. */
export function candidateStatus(x:{stage:OptimizationStage;offline:'not_run'|'pass'|'fail';salesResult:string|null}){
 const sales=x.salesResult==='supported'?'sales_supported' as const:x.salesResult==='rejected'?'sales_rejected' as const:x.salesResult?'sales_unverified' as const:'not_linked' as const;
 const adoptable=x.stage==='sales_linked'&&x.offline==='pass'&&sales==='sales_supported';
 return {offline:x.offline,sales,adoptable,reason:adoptable?'오프라인 통과와 제한 판매 확증 근거가 모두 있습니다. 채택은 소유 레인의 기존 승인 경로로만 반영합니다.':x.offline==='pass'&&sales!=='sales_supported'?'오프라인 통과는 매출 개선이 아닙니다. 제한 캠페인 확증 실험이 필요합니다.':'채택 조건(오프라인 통과+판매 확증)을 충족하지 않았습니다.'};
}
