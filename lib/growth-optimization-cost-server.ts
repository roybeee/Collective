import type {Campaign} from './agency';
import type {OptimizationRecord} from './growth-optimization-server';
import {assertEvaluation} from './growth-optimization-evaluation-server';
import {assertRuleEvaluation} from './growth-optimization-rule-server';
import {prepareBoundedEvaluation} from './eval-server';
import type {EvalRun} from './eval-server';
import {readBoundedPreparation,startBoundedEvaluation} from './eval-cost-server';
import {storefrontDigest} from './storefront-orders';
import {requireGrowthRunning} from './growth-stop-server';
import {ApiError,database,readRecord,type Actor} from './server';

export type CostPreparation={preparedId:string;preparedDigest:string;totalMaxChargeKrw:number;totalMaxTokens:number;requestCount:number;model:string;priceVersion:string;expiresAt:string};
export type CostIntent={label:string;at:string;by:string;tokenBudget:number;krwBudget:number;preparedId:string;preparedDigest:string};
const fail=(message:string):never=>{throw new ApiError(409,message)};
export async function prepareCandidateCost(who:Actor,c:Campaign,r:OptimizationRecord,maxOutputTokens:unknown):Promise<CostPreparation>{
 if(who.role!=='owner')throw new ApiError(403,'평가 견적은 소유자만 준비합니다.');
 if(c.status==='archived')fail('보관한 캠페인의 새 평가는 준비할 수 없습니다.');
 if(r.evaluation?.intent||r.ruleEvaluation?.intent)fail('시작한 평가가 있습니다. 실행 원장에서 회수·취소하세요.');
 const e=r.ruleEvaluation?await assertRuleEvaluation(who.owner,c,r):await assertEvaluation(who.owner,r,true);
 const pair=r.ruleEvaluation?{kind:'operator_preferences',ruleIds:[r.ruleEvaluation.rule.id]}:{unit:e.pair.unit,candidateVersionId:e.pair.candidateVersionId};
 const p=await prepareBoundedEvaluation(who.owner,{variant:'pair',caseIds:e.caseIds,pair,maxOutputTokens});
 await exactPreparation(who.owner,c,r,p.preparedId,p.preparedDigest);
 return {preparedId:p.preparedId,preparedDigest:p.preparedDigest,totalMaxChargeKrw:p.totalMaxChargeKrw,totalMaxTokens:p.totalMaxTokens,requestCount:p.requestCount,model:p.contract.model,priceVersion:p.contract.priceVersion,expiresAt:p.quotes.map(q=>q.expiresAt).sort()[0]};
}
async function exactPreparation(owner:string,c:Campaign,r:OptimizationRecord,id:string,digest:string){
 const e=r.ruleEvaluation?await assertRuleEvaluation(owner,c,r):await assertEvaluation(owner,r,true),p=await readBoundedPreparation(owner,id);
 if(!p.pair)fail('쌍 평가 견적이 필요합니다.');
 const {skippedCases,...pair}=p.pair!;
 if(p.preparedDigest!==digest||skippedCases!==0||await storefrontDigest(pair)!==await storefrontDigest(e.pair)||await storefrontDigest(p.cases)!==e.caseDigest)fail('동결 후보와 견적의 프롬프트·규칙·케이스가 다릅니다.');
 if(p.totalMaxChargeKrw>r.input.krwBudget||p.totalMaxTokens>r.input.tokenBudget)fail('동결 후보 예산보다 견적이 큽니다. 예산을 조정한 새 후보가 필요합니다.');
 return p;
}
export async function candidateCostIntent(who:Actor,c:Campaign,r:OptimizationRecord,confirmed:unknown,at:string):Promise<CostIntent>{
 if(who.role!=='owner')throw new ApiError(403,'평가 실행 비용 승인은 소유자만 할 수 있습니다.');
 if(c.status==='archived')fail('보관한 캠페인의 새 평가는 시작할 수 없습니다.');
 if(confirmed!==true)fail('표시된 원화 견적의 평가 실행을 명시적으로 승인하세요.');
 if(r.evaluation?.intent||r.ruleEvaluation?.intent)fail('이미 승인한 평가가 있습니다. 실행 원장을 회수하세요.');
 await requireGrowthRunning(who.owner);
 const p=r.costPreparation;if(!p)fail('원화 지출 상한을 강제하는 공급자 계약의 견적이 필요합니다.');
 await exactPreparation(who.owner,c,r,p!.preparedId,p!.preparedDigest);
 if(Date.parse(p!.expiresAt)<=Date.now())fail('견적이 만료되었습니다. 무료 견적을 다시 준비하세요.');
 return {label:`growth-opt:${r.id}:${p!.preparedId}`,at,by:who.id,tokenBudget:r.input.tokenBudget,krwBudget:r.input.krwBudget,preparedId:p!.preparedId,preparedDigest:p!.preparedDigest};
}
/** Durable Growth intent exists first. A lost Q response reuses its exact prepared ID. */
export async function dispatchCandidateCost(who:Actor,c:Campaign,r:OptimizationRecord){
 const intent=r.evaluation?.intent??r.ruleEvaluation?.intent;
 if(!intent||!('preparedId' in intent)||typeof intent.preparedId!=='string'||!('preparedDigest' in intent)||typeof intent.preparedDigest!=='string'||!('krwBudget' in intent)||typeof intent.krwBudget!=='number')return;
 const prepared=await readBoundedPreparation(who.owner,intent.preparedId);
 if(prepared.preparedDigest!==intent.preparedDigest)fail('승인한 평가 준비 근거가 다릅니다.');
 if(prepared.runId){
  const run=await readRecord<EvalRun>(who.owner,'eval_run',prepared.runId);
  if(run.boundedCost?.preparedId!==intent.preparedId||run.boundedCost.preparedDigest!==intent.preparedDigest||run.label!==intent.label||run.createdBy.id!==intent.by)fail('승인한 평가 실행 연결이 다릅니다.');
  return;
 }
 if(r.stage!=='frozen'||c.status==='archived')fail('현재 후보 단계에서 새 평가 예약을 시작할 수 없습니다.');
 await exactPreparation(who.owner,c,r,intent.preparedId,intent.preparedDigest);
 await requireGrowthRunning(who.owner);
 await startBoundedEvaluation(who.owner,{preparedId:intent.preparedId,preparedDigest:intent.preparedDigest,krwBudget:intent.krwBudget,tokenBudget:intent.tokenBudget,label:intent.label},who);
}
export async function candidateCostStatus(owner:string,r:OptimizationRecord){
 if(!r.costPreparation)return null;
 const result=await database().prepare("SELECT json_extract(data,'$.runId') runId FROM records WHERE owner=? AND kind='eval_cost_prepared' AND id=?").bind(owner,`${owner}:eval_cost_prepared:${r.costPreparation.preparedId}`).first<{runId:string|null}>();
 if(!result?.runId)return {status:'awaiting_reservation',reservedKrw:0,settledKrw:0,runId:null,reason:null};
 const run=await readRecord<EvalRun>(owner,'eval_run',result.runId);
 if(run.boundedCost?.preparedId!==r.costPreparation.preparedId||run.boundedCost.preparedDigest!==r.costPreparation.preparedDigest)return null;
 return {status:run.status,reservedKrw:run.boundedCost.reservedKrw,settledKrw:run.boundedCost.settledKrw,runId:run.id,reason:run.blockedReason??null};
}
