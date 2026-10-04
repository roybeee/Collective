import type {CostIntent} from './growth-optimization-cost-server';
import type {Campaign,Artifact} from './agency';
import {evalAction,evalRead,type EvalRun,type EvalCase} from './eval-server';
import {pairPrompts,roleRunUnits,type PairPrompts} from './prompt-registry';
import {evalKind,reserveOf} from './eval-kinds';
import {pairReport} from './eval-stats';
import type {GrowthPublicationLink} from './growth-publication-server';
import type {GrowthExperimentRecord} from './growth-experiment-server';
import type {OptimizationRecord} from './growth-optimization-server';
import {inCampaign,optionalRecord} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,type Actor} from './server';
export type OptimizationEvaluation={pair:PairPrompts;caseIds:string[];caseDigest:string;pairDigest:string;intent?:{label:string;at:string;by:string;tokenBudget:number;krwBudget:number;krwCapNotEnforced:true}|CostIntent};
const params=(key?:string,value?:string)=>{const p=new URL('https://collective.invalid').searchParams;if(key)p.set(key,value!);return p};
const unsupported=()=>new ApiError(409,'이 후보 종류는 전용 동결 페이로드 평가 어댑터가 필요합니다. 다른 프롬프트 평가로 대신 통과할 수 없습니다.');
async function caseDigest(owner:string,ids:string[],unit?:string,budget?:number){
 const cases=await Promise.all(ids.map(id=>evalRead(owner,params('case',id)) as Promise<EvalCase>));
 if(unit&&cases.some(c=>{const campaign=evalKind(c.kind).campaignOf(c.request);return unit==='viral.discovery'?c.kind!=='viral_analysis':!campaign||!roleRunUnits(c.role,campaign as Campaign).includes(unit)}))throw new ApiError(409,'모든 평가 케이스가 후보 프롬프트 단위를 사용해야 합니다.');
 if(budget!==undefined&&cases.reduce((n,c)=>n+2*reserveOf(c),0)>budget)throw new ApiError(409,'쌍 평가 케이스 예약량이 후보 토큰 예산을 넘습니다.');
 if(!cases.some(c=>c.set==='sealed'))throw new ApiError(409,'봉인 평가 케이스를 하나 이상 포함하세요.');
 return storefrontDigest(cases);
}
export async function freezeEvaluation(owner:string,r:OptimizationRecord,value:unknown):Promise<OptimizationEvaluation|null>{
 if(r.input.candidateKind!=='prompt_unit')return null;
 if(!value||typeof value!=='object')throw new ApiError(400,'등록된 후보 버전과 평가 케이스를 지정하세요.');
 const b=value as Record<string,unknown>;
 if(!Array.isArray(b.caseIds)||!b.caseIds.length||b.caseIds.length>100||b.caseIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(id))||new Set(b.caseIds).size!==b.caseIds.length)throw new ApiError(400,'중복 없는 평가 케이스 ID 1~100개를 지정하세요.');
 const ids=(b.caseIds as string[]).slice().sort(),pair=await pairPrompts(owner,{unit:r.input.targetRef,candidateVersionId:b.candidateVersionId});
 return {pair,caseIds:ids,caseDigest:await caseDigest(owner,ids,pair.unit,r.input.tokenBudget),pairDigest:await storefrontDigest(pair)};
}
export async function assertEvaluation(owner:string,r:OptimizationRecord,starting=false){
 if(r.input.candidateKind!=='prompt_unit'||!r.evaluation)throw unsupported();
 const e=r.evaluation;
 if(!r.frozen||r.frozen.digest!==await storefrontDigest({id:r.id,input:r.input,evaluation:{pair:e.pair,caseIds:e.caseIds,caseDigest:e.caseDigest,pairDigest:e.pairDigest}}))throw new ApiError(409,'동결 후보의 평가 근거가 변경되었습니다.');
 if(await caseDigest(owner,e.caseIds,e.pair.unit,r.input.tokenBudget)!==e.caseDigest)throw new ApiError(409,'평가 케이스가 동결 후 변경되었습니다. 새 후보로 평가하세요.');
 if(starting&&await storefrontDigest(await pairPrompts(owner,{unit:e.pair.unit,candidateVersionId:e.pair.candidateVersionId}))!==e.pairDigest)throw new ApiError(409,'등록 후보 또는 기준 프롬프트가 변경되었습니다.');
 return e;
}
export async function runMatches(r:OptimizationRecord,run:EvalRun){
 const e=r.evaluation!,pair=run.pair&&'candidateSet' in run.pair?run.pair:null;
 return !!e.intent&&(!('preparedId' in e.intent)||(run.boundedCost?.preparedId===e.intent.preparedId&&run.boundedCost?.preparedDigest===e.intent.preparedDigest&&run.boundedCost.settledKrw<=e.intent.krwBudget))&&run.label===e.intent.label&&run.variant==='pair'&&run.results.length===e.caseIds.length*2&&e.caseIds.every(id=>['active','candidate'].every(variant=>run.results.filter(x=>x.caseId===id&&x.variant===variant).length===1))&&!!pair&&await storefrontDigest({unit:pair.unit,candidateVersionId:pair.candidateVersionId,activeVersionId:pair.activeVersionId,candidateSet:pair.candidateSet,activeSet:pair.activeSet})===e.pairDigest&&pair.skippedCases===0&&JSON.stringify([...run.caseIds].sort())===JSON.stringify(e.caseIds)&&run.tokenBudget===e.intent.tokenBudget&&run.usedTokens<=e.intent.tokenBudget&&run.usedTokens>=0&&Number.isSafeInteger(run.usedTokens)&&Date.parse(run.createdAt)>=Date.parse(e.intent.at)&&run.createdBy.id===e.intent.by;
}
/** Only called after the durable intent transaction succeeds. Never retry this call. */
export async function dispatchEvaluation(who:Actor,r:OptimizationRecord){
 const e=r.evaluation!,intent=e.intent!;
 try{
  const response=await evalAction(who.owner,{action:'start_run',label:intent.label,variant:'pair',pair:{unit:e.pair.unit,candidateVersionId:e.pair.candidateVersionId},caseIds:e.caseIds,tokenBudget:intent.tokenBudget},who);
  const value=await response.json() as EvalRun|{run?:EvalRun},run='run' in value?value.run:value as EvalRun;
  if(run?.id&&run.status==='queued'&&(!await runMatches(r,run)||run.results.reduce((n,x)=>n+(x.reserve??50_000),0)>intent.tokenBudget))await evalAction(who.owner,{action:'cancel_run',id:run.id},who);
 }catch{
  // The Q write may have succeeded before a lost response. Preserve intent and recover by label only.
 }
}
export async function collectEvaluation(owner:string,r:OptimizationRecord,requested:unknown){
 const e=await assertEvaluation(owner,r);
 if(!e.intent)throw new ApiError(409,'이 후보가 승인하여 시작한 평가 실행이 없습니다.');
 const listing=await evalRead(owner,params()) as {runs:EvalRun[]},matches=listing.runs.filter(run=>run.label===e.intent!.label);
 if(matches.length!==1)throw new ApiError(409,'평가 실행 수락 상태를 확인하지 못했습니다. 재실행하지 말고 Q 실행 원장을 대사하세요.');
 const run=await evalRead(owner,params('run',matches[0].id)) as EvalRun;
 if(requested&&requested!==run.id||!await runMatches(r,run))throw new ApiError(409,'이 후보의 정확한 프롬프트·케이스·예산 실행이 아닙니다.');
 if(run.status!=='completed'||run.deleted)throw new ApiError(409,'후보 평가가 완료되지 않았습니다. Q 실행 상태를 확인하세요.');
 const report=pairReport(run);
 return {run,report};
}
/** Exact registered publication revision and its approved copy artifact prove prompt lineage. */
export async function salesIntervention(owner:string,c:Campaign,r:OptimizationRecord,e:GrowthExperimentRecord){
 if(!r.evaluation||!e.registration||e.registration.digest!==await storefrontDigest({id:e.id,input:e.input})||JSON.stringify(e.registration.refs)!==JSON.stringify(e.input.interventionRefs))throw new ApiError(409,'실험 사전등록 내용·개입 판이 일치하지 않습니다.');
 for(const ref of e.registration.refs){
  if(ref.kind!=='publication_link')continue;
  const link=await optionalRecord<GrowthPublicationLink>(owner,'growth_publication_link',ref.id);
  if(!link||!inCampaign(link,c)||link.version!==ref.version||link.status!=='published')continue;
  const copy=link.snapshot.publication.copy;
  if(!copy)continue;
  const artifact=await optionalRecord<Artifact&{promptVersion?:string}>(owner,'artifact',copy.artifactId);
  if(!artifact||artifact.campaignId!==c.id||artifact.version!==copy.artifactVersion||!artifact.promptVersion?.split('+').includes(r.evaluation.pair.candidateVersionId))continue;
  return {kind:'publication_link' as const,id:ref.id,version:ref.version,artifactId:artifact.id,artifactVersion:artifact.version,candidateVersionId:r.evaluation.pair.candidateVersionId};
 }
 throw new ApiError(409,'동일 후보 프롬프트로 만든 승인 카피의 정확한 게시 연결 판이 실험에 필요합니다.');
}
