import type {Campaign} from './agency';
import {prepareCandidateCost,candidateCostIntent,dispatchCandidateCost,candidateCostStatus,type CostPreparation} from './growth-optimization-cost-server';
import {freezeEvaluation,collectEvaluation,salesIntervention,type OptimizationEvaluation} from './growth-optimization-evaluation-server';
import {freezeRuleEvaluation,assertRuleEvaluation,validateRuleEvaluation,collectRuleEvaluation,ruleSalesIntervention,type RuleEvaluation} from './growth-optimization-rule-server';
import {freezeContentEvaluation,assertContentEvaluation,collectContentEvaluation,contentSalesIntervention,type ContentEvaluation} from './growth-optimization-content-server';
import type {FailureDraftOrigin} from './growth-failure-drafts-server';
import {readExperimentOutcomeBasis,type GrowthExperimentRecord} from './growth-experiment-server';
import {candidateStatus,parseCandidate,type CandidateInput,type OptimizationStage} from './growth-optimization';
import {campaignRows,inCampaign,optionalRecord,versionedMutation,type Versioned} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,str,type Actor} from './server';
const kinds={current:'growth_optimization',history:'growth_optimization_history',request:'growth_optimization_request'} as const;
const failureKinds={experiment_result:'growth_experiment_result',lesson_application:'growth_lesson_application',journey:'growth_journey',cause_link:'growth_cause_link',cs_ticket:'growth_cs_ticket'} as const;
export type OptimizationRecord=Versioned&{input:CandidateInput;autoDraft?:FailureDraftOrigin;stage:OptimizationStage;costPreparation?:CostPreparation;frozen:{digest:string;at:string;by:string}|null;evaluation?:OptimizationEvaluation|null;ruleEvaluation?:RuleEvaluation|null;contentEvaluation?:ContentEvaluation|null;validation?:Awaited<ReturnType<typeof validateRuleEvaluation>>;offline:{kind?:'q_pair'|'deterministic_content';reasons?:string[];evalRunId:string;verdict:'pass'|'fail';tokens:number;at:string;by:string}|null;sales:{experimentId:string;at:string;designDigest?:string;intervention?:Awaited<ReturnType<typeof salesIntervention>>|Awaited<ReturnType<typeof ruleSalesIntervention>>|Awaited<ReturnType<typeof contentSalesIntervention>>}|null;adoption:{ref:string;at:string;by:string}|null;rollback:{reason:string;evidenceRef:string;at:string;by:string}|null;createdAt:string;updatedAt:string;updatedBy:string};
async function failureValid(owner:string,c:Campaign,i:CandidateInput){
 const row=await optionalRecord<{id:string;brandId:string;campaignId:string;designId?:string;analysisNumber?:number;version?:number;analysis?:{status:string};outcome?:{result:string}|null;status?:string}>(owner,failureKinds[i.failureKind],i.failureId);
 if(!row||!inCampaign(row,c))return '현재 캠페인의 실패 근거가 아닙니다.';
 if(row.version!==undefined&&row.version!==i.failureVersion)return '실패 근거가 개정되었습니다.';
 if(i.failureKind==='experiment_result'&&!['invalid','rejected','inconclusive','aa_failed','insufficient'].includes(row.analysis?.status??''))return '실패·무효·불확실 실험 결과만 최적화 근거가 됩니다.';
 if(i.failureKind==='experiment_result'){
  const latest=await database().prepare("SELECT json_extract(data,'$.id') id FROM records WHERE owner=? AND kind='growth_experiment_result' AND parent_id=? AND json_extract(data,'$.brandId')=? AND json_extract(data,'$.campaignId')=? AND json_extract(data,'$.designId')=? ORDER BY json_extract(data,'$.analysisNumber') DESC LIMIT 1").bind(owner,c.id,c.brandId,c.id,row.designId??'').first<{id:string}>();
  if(!latest||latest.id!==row.id)return '새 분석 결과가 있습니다. 최신 실패 근거를 검토하세요.';
 }
 if(i.failureKind==='lesson_application'&&!['failure','invalid'].includes(row.outcome?.result??''))return '실패·무효로 회수된 교훈 적용만 근거가 됩니다.';
 return null;
}
async function salesResult(owner:string,c:Campaign,r:OptimizationRecord){
 if(!r.sales)return null;
 try{
  const e=await optionalRecord<GrowthExperimentRecord>(owner,'growth_experiment',r.sales.experimentId);
  if(!e||!inCampaign(e,c))return 'pending';
  const intervention=r.contentEvaluation?await contentSalesIntervention(owner,c,r,e):r.ruleEvaluation?await ruleSalesIntervention(owner,c,r,e):await salesIntervention(owner,c,r,e);
  if(await storefrontDigest(intervention)!==await storefrontDigest(r.sales.intervention))return 'pending';
  const basis=await readExperimentOutcomeBasis(owner,c,r.sales.experimentId);return basis.current&&basis.registrationDigest===r.sales.designDigest?basis.latest?.status??'pending':'pending';
 }
 catch(e){if(e instanceof ApiError&&[400,404,409].includes(e.status))return 'pending';throw e}
}
export async function growthOptimizationView(who:Actor,c:Campaign){
 const [rows,history]=await Promise.all([campaignRows<OptimizationRecord>(who.owner,c,kinds.current,200),campaignRows<OptimizationRecord>(who.owner,c,kinds.history,2000)]);
 const candidates=await Promise.all(rows.filter(r=>inCampaign(r,c)).map(async r=>{const failure=await failureValid(who.owner,c,r.input);const sales=await salesResult(who.owner,c,r);return {...r,costStatus:await candidateCostStatus(who.owner,r),failureStatus:failure?'changed' as const:'current' as const,failureReason:failure,status:candidateStatus({stage:r.stage,offline:r.offline?.verdict??'not_run',salesResult:sales}),salesResult:sales}}));
 return {campaignId:c.id,campaignVersion:c.version,candidates,history:history.filter(h=>inCampaign(h,c)),canEdit:who.role!=='member'&&c.status!=='archived',canAdopt:who.role==='owner',mayPromote:false as const,mayChangeGraders:false as const};
}
export type GrowthOptimizationView=Awaited<ReturnType<typeof growthOptimizationView>>;
const allowed:Record<string,OptimizationStage[]>={resume_evaluation:['frozen'],prepare_evaluation:['frozen'],validate_evaluation:['frozen'],freeze:['draft'],start_evaluation:['frozen'],record_offline:['frozen'],link_sales:['offline_evaluated'],adopt:['sales_linked'],rollback:['adopted'],discard:['draft','frozen','offline_evaluated','sales_linked']};
async function assertFrozenCandidate(owner:string,c:Campaign,r:OptimizationRecord){
 const evaluation=r.evaluation?{...r.evaluation,intent:undefined}:null,ruleEvaluation=r.ruleEvaluation?{...r.ruleEvaluation,intent:undefined}:null;
 if(!r.frozen||r.frozen.digest!==await storefrontDigest({id:r.id,input:r.input,...(evaluation?{evaluation}:{}),...(ruleEvaluation?{ruleEvaluation}:{}),...(r.contentEvaluation?{contentEvaluation:r.contentEvaluation}:{})}))throw new ApiError(409,'후보 동결 내용이 변경되었습니다.');
 if(r.ruleEvaluation)await assertRuleEvaluation(owner,c,r);
 if(r.contentEvaluation)await assertContentEvaluation(owner,c,r);
}
export async function saveGrowthOptimization(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=str(b.id,'후보 ID',100,true),action=String(b.action??'');
 const input=action==='save_candidate'?parseCandidate(b.input):null;
 const result=await versionedMutation<OptimizationRecord>(who,c,b,kinds,id,{action,input,evalRunId:b.evalRunId,verdict:b.verdict,evaluation:b.evaluation,confirmed:b.confirmed,krwCapNotEnforced:b.krwCapNotEnforced,maxOutputTokens:b.maxOutputTokens,experimentId:b.experimentId,ref:b.ref,reason:b.reason,evidenceRef:b.evidenceRef},async(old,at)=>{
  if(action==='save_candidate'){
   if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 후보를 만들지 않습니다.');if(old&&old.stage!=='draft')throw new ApiError(409,'동결한 후보는 바꿀 수 없습니다. 새 후보를 만드세요.');
   const problem=await failureValid(who.owner,c,input!);if(problem)throw new ApiError(409,problem);
   return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,input:input!,...(old?.autoDraft?{autoDraft:old.autoDraft}:{}),stage:'draft',frozen:null,offline:null,sales:null,adoption:null,rollback:null,createdAt:(old as OptimizationRecord|null)?.createdAt??at,updatedAt:at,updatedBy:who.id},limit:200};
  }
  if(!old)throw new ApiError(404,'후보를 찾지 못했습니다.');
  if(!allowed[action])throw new ApiError(400,'지원하지 않는 후보 작업입니다.');if(!allowed[action].includes(old.stage))throw new ApiError(409,`현재 단계(${old.stage})에서 할 수 없는 작업입니다.`);
  const next:OptimizationRecord={...old,version:old.version+1,updatedAt:at,updatedBy:who.id};
  if(action==='freeze'){
   const problem=await failureValid(who.owner,c,old.input);if(problem)throw new ApiError(409,problem);
   if(old.input.candidateKind==='operating_rule')next.ruleEvaluation=await freezeRuleEvaluation(who.owner,c,old,b.evaluation);
   else if(old.input.candidateKind==='landing_copy'||old.input.candidateKind==='offer_message')next.contentEvaluation=await freezeContentEvaluation(who.owner,c,old);
   else next.evaluation=await freezeEvaluation(who.owner,old,b.evaluation);
   next.stage='frozen';next.frozen={digest:await storefrontDigest({id,input:old.input,...(next.evaluation?{evaluation:next.evaluation}:{}),...(next.ruleEvaluation?{ruleEvaluation:next.ruleEvaluation}:{}),...(next.contentEvaluation?{contentEvaluation:next.contentEvaluation}:{})}),at,by:who.id};
  }else if(action==='validate_evaluation'){
   await assertFrozenCandidate(who.owner,c,old);next.validation=await validateRuleEvaluation(who.owner,c,old);
  }else if(action==='prepare_evaluation'){
   await assertFrozenCandidate(who.owner,c,old);next.costPreparation=await prepareCandidateCost(who,c,old,b.maxOutputTokens);
  }else if(action==='start_evaluation'){
   await assertFrozenCandidate(who.owner,c,old);const intent=await candidateCostIntent(who,c,old,b.confirmed,at);
   if(old.ruleEvaluation)next.ruleEvaluation={...old.ruleEvaluation,intent};else if(old.evaluation)next.evaluation={...old.evaluation,intent};
  }else if(action==='resume_evaluation'){
   if(who.role!=='owner')throw new ApiError(403,'소유자만 평가 시작을 복구합니다.');
   if(!old.evaluation?.intent&&!old.ruleEvaluation?.intent)throw new ApiError(409,'복구할 승인 의도가 없습니다.');
  }else if(action==='record_offline'){
   await assertFrozenCandidate(who.owner,c,old);
   if(old.contentEvaluation){const report=await collectContentEvaluation(who.owner,c,old);next.offline={kind:'deterministic_content',evalRunId:report.id,verdict:report.verdict,tokens:0,reasons:report.reasons,at,by:who.id};}
   else{const {run,report}=old.ruleEvaluation?await collectRuleEvaluation(who.owner,c,old,b.evalRunId):await collectEvaluation(who.owner,old,b.evalRunId);next.offline={kind:'q_pair',evalRunId:run.id,verdict:report.gate.ok?'pass':'fail',tokens:run.usedTokens,at,by:who.id};}
   next.stage='offline_evaluated';
  }else if(action==='link_sales'){
   if(old.offline?.verdict!=='pass')throw new ApiError(409,'오프라인 통과 후보만 판매 검증에 연결합니다.');
   const e=await optionalRecord<GrowthExperimentRecord>(who.owner,'growth_experiment',String(b.experimentId??''));
   if(!e||!inCampaign(e,c))throw new ApiError(404,'현재 캠페인의 판매 실험이 아닙니다.');if(e.status!=='registered'||e.input.mode!=='confirm'||e.input.aa)throw new ApiError(409,'사전등록한 확증 실험만 연결합니다.');
   if(!e.registration||Date.parse(e.registration.at)<Date.parse(old.frozen!.at))throw new ApiError(409,'후보 동결 이후에 사전등록한 실험만 연결합니다.');
   await assertFrozenCandidate(who.owner,c,old);
   next.stage='sales_linked';next.sales={experimentId:e.id,at,designDigest:e.registration.digest,intervention:old.contentEvaluation?await contentSalesIntervention(who.owner,c,old,e):old.ruleEvaluation?await ruleSalesIntervention(who.owner,c,old,e):await salesIntervention(who.owner,c,old,e)};
  }else if(action==='adopt'){
   if(who.role!=='owner')throw new ApiError(403,'채택은 소유자만 기록합니다.');
   await assertFrozenCandidate(who.owner,c,old);
   if(old.contentEvaluation&&(await collectContentEvaluation(who.owner,c,old)).verdict!=='pass')throw new ApiError(409,'현재 원문·사실·재고 검사를 다시 통과해야 채택할 수 있습니다.');
   if(old.contentEvaluation||old.ruleEvaluation){const experiment=old.sales?await optionalRecord<GrowthExperimentRecord>(who.owner,'growth_experiment',old.sales.experimentId):null;if(!experiment||!inCampaign(experiment,c))throw new ApiError(409,'판매 개입의 현재 근거가 필요합니다.');const intervention=old.contentEvaluation?await contentSalesIntervention(who.owner,c,old,experiment):await ruleSalesIntervention(who.owner,c,old,experiment);if(await storefrontDigest(intervention)!==await storefrontDigest(old.sales?.intervention))throw new ApiError(409,'판매 개입 근거가 변경되었습니다.');}
   const status=candidateStatus({stage:old.stage,offline:old.offline?.verdict??'not_run',salesResult:await salesResult(who.owner,c,old)});if(!status.adoptable)throw new ApiError(409,status.reason);
   const ref=String(b.ref??'');if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(ref))throw new ApiError(400,'기존 승인 경로의 반영 기록 ID를 입력하세요.');
   next.stage='adopted';next.adoption={ref,at,by:who.id};
  }else if(action==='rollback'){
   const reason=String(b.reason??'').trim(),ev=String(b.evidenceRef??'');if(!reason||reason.length>500||!/^[A-Za-z0-9_.:-]{1,100}$/.test(ev))throw new ApiError(400,'되돌림 사유와 증빙 ID를 입력하세요.');
   next.stage='rolled_back';next.rollback={reason,evidenceRef:ev,at,by:who.id};
  }else if(action==='discard')next.stage='discarded';
  return {next};
 });
 if(action==='start_evaluation'||action==='resume_evaluation'){const saved=await optionalRecord<OptimizationRecord>(who.owner,kinds.current,id);if(saved&&inCampaign(saved,c))await dispatchCandidateCost(who,c,saved);}
 return result;
}
