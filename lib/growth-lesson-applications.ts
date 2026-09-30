import {executionId,executionSafeText} from './growth-execution';
export class GrowthLessonApplicationError extends Error {}
export const applicationTargets=['mission','landing_revision','demand','experiment'] as const;
export type ApplicationInput={lessonId:string;lessonVersion:number;targetKind:typeof applicationTargets[number];targetId:string;targetVersion:number;howApplied:string;expectedCheck:string;checkAt:string};
export type ApplicationOutcome={result:'success'|'failure'|'invalid';at:string;evidenceRef:string;note:string;recordedAt:string;recordedBy:string};
export function parseApplicationInput(value:unknown):ApplicationInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthLessonApplicationError('교훈 적용 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!applicationTargets.includes(b.targetKind as ApplicationInput['targetKind']))throw new GrowthLessonApplicationError('적용 대상 종류를 선택하세요.');
 const v=(x:unknown,label:string)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=1?x:(()=>{throw new GrowthLessonApplicationError(`${label}의 정확한 판을 확인하세요.`)})();
 const checkAt=String(b.checkAt??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(checkAt)||new Date(checkAt+'T00:00:00Z').toISOString().slice(0,10)!==checkAt)throw new GrowthLessonApplicationError('효과 확인일을 YYYY-MM-DD로 입력하세요.');
 try{return {lessonId:executionId(b.lessonId),lessonVersion:v(b.lessonVersion,'교훈'),targetKind:b.targetKind as ApplicationInput['targetKind'],targetId:executionId(b.targetId),targetVersion:v(b.targetVersion,'적용 대상'),howApplied:executionSafeText(b.howApplied,'적용 방법',1000),expectedCheck:executionSafeText(b.expectedCheck,'확인할 결과',500),checkAt}}
 catch(e){if(e instanceof GrowthLessonApplicationError)throw e;throw new GrowthLessonApplicationError(e instanceof Error?e.message:'입력을 확인하세요.')}
}
export function parseOutcome(value:unknown,now=Date.now()):Omit<ApplicationOutcome,'recordedAt'|'recordedBy'>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthLessonApplicationError('적용 결과를 확인하세요.');const b=value as Record<string,unknown>;
 if(!['success','failure','invalid'].includes(String(b.result)))throw new GrowthLessonApplicationError('성공·실패·무효 중 선택하세요.');
 const at=String(b.at??'');if(!Number.isFinite(Date.parse(at))||Date.parse(at)>now+60_000)throw new GrowthLessonApplicationError('결과 확인 시각은 현재 이전이어야 합니다.');
 try{return {result:b.result as ApplicationOutcome['result'],at:new Date(Date.parse(at)).toISOString(),evidenceRef:executionId(b.evidenceRef),note:executionSafeText(b.note,'결과 근거',1000)}}
 catch(e){throw new GrowthLessonApplicationError(e instanceof Error?e.message:'입력을 확인하세요.')}
}
/** Reuse performance is a tally of operator-attested outcomes, not a causal label; repeated failures only suggest review, never auto-retire. */
export function lessonReuse(applications:{lessonId:string;outcome:ApplicationOutcome|null;checkAt:string}[],today:string){
 const by=new Map<string,{applied:number;success:number;failure:number;invalid:number;pending:number;overdue:number}>();
 for(const a of applications){const s=by.get(a.lessonId)??{applied:0,success:0,failure:0,invalid:0,pending:0,overdue:0};s.applied++;if(a.outcome)s[a.outcome.result]++;else{s.pending++;if(a.checkAt<today)s.overdue++}by.set(a.lessonId,s)}
 return [...by.entries()].map(([lessonId,s])=>({lessonId,...s,reviewSuggested:s.failure>=2&&s.failure>s.success,causalStatus:'not_measured' as const}));
}
