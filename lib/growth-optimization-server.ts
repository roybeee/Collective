import type {Campaign} from './agency';
import type {GrowthExperimentRecord,GrowthExperimentResult} from './growth-experiment-server';
import {candidateStatus,parseCandidate,type CandidateInput,type OptimizationStage} from './growth-optimization';
import {campaignRows,inCampaign,optionalRecord,versionedMutation,type Versioned} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,str,type Actor} from './server';
const kinds={current:'growth_optimization',history:'growth_optimization_history',request:'growth_optimization_request'} as const;
const failureKinds={experiment_result:'growth_experiment_result',lesson_application:'growth_lesson_application',journey:'growth_journey',cause_link:'growth_cause_link',cs_ticket:'growth_cs_ticket'} as const;
export type OptimizationRecord=Versioned&{input:CandidateInput;stage:OptimizationStage;frozen:{digest:string;at:string;by:string}|null;offline:{evalRunId:string;verdict:'pass'|'fail';tokens:number;at:string;by:string}|null;sales:{experimentId:string;at:string}|null;adoption:{ref:string;at:string;by:string}|null;rollback:{reason:string;evidenceRef:string;at:string;by:string}|null;createdAt:string;updatedAt:string;updatedBy:string};
async function failureValid(owner:string,c:Campaign,i:CandidateInput){
 const row=await optionalRecord<{brandId:string;campaignId:string;version?:number;analysis?:{status:string};outcome?:{result:string}|null;status?:string}>(owner,failureKinds[i.failureKind],i.failureId);
 if(!row||!inCampaign(row,c))return '현재 캠페인의 실패 근거가 아닙니다.';
 if(row.version!==undefined&&row.version!==i.failureVersion)return '실패 근거가 개정되었습니다.';
 if(i.failureKind==='experiment_result'&&!['invalid','rejected','inconclusive','aa_failed','insufficient'].includes(row.analysis?.status??''))return '실패·무효·불확실 실험 결과만 최적화 근거가 됩니다.';
 if(i.failureKind==='lesson_application'&&!['failure','invalid'].includes(row.outcome?.result??''))return '실패·무효로 회수된 교훈 적용만 근거가 됩니다.';
 return null;
}
async function salesResult(owner:string,c:Campaign,r:OptimizationRecord){
 if(!r.sales)return null;const e=await optionalRecord<GrowthExperimentRecord>(owner,'growth_experiment',r.sales.experimentId);if(!e||!inCampaign(e,c))return 'missing';
 const res=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_experiment_result' AND parent_id=? AND json_extract(data,'$.designId')=? LIMIT 51").bind(owner,c.id,e.id).all<{data:string}>();
 const latest=res.results.map(x=>JSON.parse(x.data) as GrowthExperimentResult).sort((a,b)=>b.analysisNumber-a.analysisNumber)[0];return latest?.analysis.status??'pending';
}
export async function growthOptimizationView(who:Actor,c:Campaign){
 const [rows,history]=await Promise.all([campaignRows<OptimizationRecord>(who.owner,c,kinds.current,200),campaignRows<OptimizationRecord>(who.owner,c,kinds.history,2000)]);
 const candidates=await Promise.all(rows.filter(r=>inCampaign(r,c)).map(async r=>{const failure=await failureValid(who.owner,c,r.input);const sales=await salesResult(who.owner,c,r);return {...r,failureStatus:failure?'changed' as const:'current' as const,failureReason:failure,status:candidateStatus({stage:r.stage,offline:r.offline?.verdict??'not_run',salesResult:sales}),salesResult:sales}}));
 return {campaignId:c.id,campaignVersion:c.version,candidates,history:history.filter(h=>inCampaign(h,c)),canEdit:who.role!=='member'&&c.status!=='archived',canAdopt:who.role==='owner',mayPromote:false as const,mayChangeGraders:false as const};
}
export type GrowthOptimizationView=Awaited<ReturnType<typeof growthOptimizationView>>;
const allowed:Record<string,OptimizationStage[]>={freeze:['draft'],record_offline:['frozen'],link_sales:['offline_evaluated'],adopt:['sales_linked'],rollback:['adopted'],discard:['draft','frozen','offline_evaluated','sales_linked']};
export async function saveGrowthOptimization(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=str(b.id,'후보 ID',100,true),action=String(b.action??'');
 const input=action==='save_candidate'?parseCandidate(b.input):null;
 return versionedMutation<OptimizationRecord>(who,c,b,kinds,id,{action,input,evalRunId:b.evalRunId,verdict:b.verdict,experimentId:b.experimentId,ref:b.ref,reason:b.reason,evidenceRef:b.evidenceRef},async(old,at)=>{
  if(action==='save_candidate'){
   if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 후보를 만들지 않습니다.');if(old&&old.stage!=='draft')throw new ApiError(409,'동결한 후보는 바꿀 수 없습니다. 새 후보를 만드세요.');
   const problem=await failureValid(who.owner,c,input!);if(problem)throw new ApiError(409,problem);
   return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,input:input!,stage:'draft',frozen:null,offline:null,sales:null,adoption:null,rollback:null,createdAt:(old as OptimizationRecord|null)?.createdAt??at,updatedAt:at,updatedBy:who.id},limit:200};
  }
  if(!old)throw new ApiError(404,'후보를 찾지 못했습니다.');
  if(!allowed[action])throw new ApiError(400,'지원하지 않는 후보 작업입니다.');if(!allowed[action].includes(old.stage))throw new ApiError(409,`현재 단계(${old.stage})에서 할 수 없는 작업입니다.`);
  const next:OptimizationRecord={...old,version:old.version+1,updatedAt:at,updatedBy:who.id};
  if(action==='freeze'){const problem=await failureValid(who.owner,c,old.input);if(problem)throw new ApiError(409,problem);next.stage='frozen';next.frozen={digest:await storefrontDigest({id,input:old.input}),at,by:who.id};}
  else if(action==='record_offline'){
   const runId=String(b.evalRunId??'');if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(runId))throw new ApiError(400,'평가 실행 ID를 확인하세요.');if(b.verdict!=='pass'&&b.verdict!=='fail')throw new ApiError(400,'오프라인 판정(pass/fail)을 선택하세요.');
   const run=await optionalRecord<{id:string;status:string;tokenBudget:number;usedTokens:number;createdAt:string}>(who.owner,'eval_run',runId);
   if(!run)throw new ApiError(404,'평가 실행을 찾지 못했습니다.');if(run.status!=='completed')throw new ApiError(409,'완료된 평가 실행만 연결합니다.');
   if(Date.parse(run.createdAt)<Date.parse(old.frozen!.at))throw new ApiError(409,'후보 동결 이후에 시작한 평가 실행만 연결합니다.');
   if(run.tokenBudget>old.input.tokenBudget||run.usedTokens>old.input.tokenBudget)throw new ApiError(409,'평가 실행 토큰이 후보 예산을 넘습니다.');
   next.stage='offline_evaluated';next.offline={evalRunId:runId,verdict:b.verdict,tokens:run.usedTokens,at,by:who.id};
  }else if(action==='link_sales'){
   if(old.offline?.verdict!=='pass')throw new ApiError(409,'오프라인 통과 후보만 판매 검증에 연결합니다.');
   const e=await optionalRecord<GrowthExperimentRecord>(who.owner,'growth_experiment',String(b.experimentId??''));
   if(!e||!inCampaign(e,c))throw new ApiError(404,'현재 캠페인의 판매 실험이 아닙니다.');if(e.status!=='registered'||e.input.mode!=='confirm'||e.input.aa)throw new ApiError(409,'사전등록한 확증 실험만 연결합니다.');
   if(!e.registration||Date.parse(e.registration.at)<Date.parse(old.frozen!.at))throw new ApiError(409,'후보 동결 이후에 사전등록한 실험만 연결합니다.');
   next.stage='sales_linked';next.sales={experimentId:e.id,at};
  }else if(action==='adopt'){
   if(who.role!=='owner')throw new ApiError(403,'채택은 소유자만 기록합니다.');
   const status=candidateStatus({stage:old.stage,offline:old.offline?.verdict??'not_run',salesResult:await salesResult(who.owner,c,old)});if(!status.adoptable)throw new ApiError(409,status.reason);
   const ref=String(b.ref??'');if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(ref))throw new ApiError(400,'기존 승인 경로의 반영 기록 ID를 입력하세요.');
   next.stage='adopted';next.adoption={ref,at,by:who.id};
  }else if(action==='rollback'){
   const reason=String(b.reason??'').trim(),ev=String(b.evidenceRef??'');if(!reason||reason.length>500||!/^[A-Za-z0-9_.:-]{1,100}$/.test(ev))throw new ApiError(400,'되돌림 사유와 증빙 ID를 입력하세요.');
   next.stage='rolled_back';next.rollback={reason,evidenceRef:ev,at,by:who.id};
  }else if(action==='discard')next.stage='discarded';
  return {next};
 });
}
