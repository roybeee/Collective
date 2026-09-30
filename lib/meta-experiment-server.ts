import type {Campaign} from './agency';
import {requireGrowthRunning} from './growth-stop-server';
import type {LearningRule} from './learning';
import type {MetaLearningDecision} from './meta-learning';
import {experimentDesignInput,type ExperimentDesign,type ExperimentUnit,type ExperimentObservation,type ExperimentResult,type ExperimentRule} from './meta-experiment';
import {experimentCreativeBasis,experimentDesignCurrent,experimentEvidence,experimentUnits} from './meta-experiment-evidence';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str} from './server';

const rows=<T>(owner:string,kind:string,c:Campaign)=>listRecords<T>(owner,kind,c.id);
const publicDesign=({seed,...d}:ExperimentDesign)=>{void seed;return d;};
async function designFor(owner:string,c:Campaign,id:unknown){const d=await readRecord<ExperimentDesign>(owner,'meta_experiment_design',str(id,'실험 설계',200,true));if(d.campaignId!==c.id||d.brandId!==c.brandId)throw new ApiError(409,'실험 범위가 다릅니다.');return d;}
export async function metaExperimentView(owner:string,c:Campaign,canEdit:boolean){
 const [designs,results,rules,decisions]=await Promise.all([rows<ExperimentDesign>(owner,'meta_experiment_design',c),rows<ExperimentResult>(owner,'meta_experiment_result',c),rows<ExperimentRule>(owner,'meta_experiment_rule',c),rows<MetaLearningDecision>(owner,'meta_ads_learning_decision',c)]);
 const display=await Promise.all(designs.map(async d=>{const evidence=await experimentEvidence(owner,c,d,results.filter(r=>r.designId===d.id).length+1),saved=results.find(r=>r.designId===d.id&&r.sourceDigest===evidence.sourceDigest);return {...publicDesign(d),state:saved?.statistics.status??evidence.statistics.status,sourceDigest:evidence.sourceDigest,assigned:evidence.units.length,observed:evidence.units.filter(u=>u.observation).length};}));
 return {designs:display,results:results.sort((a,b)=>b.version-a.version),rules,registrations:decisions.filter(d=>d.registration).map(d=>({id:d.id,metric:d.registration!.primaryMetric,startAt:d.registration!.startAt,title:d.registration!.hypothesis})),canEdit:canEdit&&c.status!=='archived',notice:'배정 단위와 노출·미구매·비용은 운영자가 기록합니다. 실제 무작위 노출과 완전 추적을 검증하지 않았다면 인과 효과로 해석하지 마세요. 규칙 승인은 광고 집행 권한이 아닙니다.'};
}
async function createDesign(owner:string,actorId:string,c:Campaign,b:Record<string,unknown>){
 const source=await readRecord<MetaLearningDecision>(owner,'meta_ads_learning_decision',str(b.registrationId,'사전등록',200,true));
 if(!source.registration||!source.candidate||source.campaignId!==c.id||source.brandId!==c.brandId||source.campaignVersion!==c.version||!c.storeId)throw new ApiError(409,'현재 캠페인·지점의 사전등록을 선택하세요.');
 const r=source.registration,input=experimentDesignInput(b,r.primaryMetric),id=source.id;
 const old=(await rows<ExperimentDesign>(owner,'meta_experiment_design',c)).find(d=>d.id===id);
 if(old){if(Object.entries(input).some(([k,v])=>old[k as keyof ExperimentDesign]!==v))throw new ApiError(409,'불변 통계 설계를 변경할 수 없습니다.');return {duplicate:true};}
 if(Date.now()>=Date.parse(r.startAt))throw new ApiError(409,'관측 시작 전에 통계 설계를 고정하세요.');
 const candidate=source.candidate,creative={creativeId:candidate.creativeId,creativeVersion:candidate.creativeVersion,creativeHash:candidate.creativeHash};
 const creativeBasis=await experimentCreativeBasis(owner,c,creative);if(!creativeBasis)throw new ApiError(409,'현재 소재와 사실 근거를 확인하세요.');
 const payload={id,campaignId:c.id,brandId:c.brandId,storeId:c.storeId,campaignVersion:c.version,registrationId:source.id,registration:r,creative,creativeBasis,metric:r.primaryMetric,minSample:r.minSample,...input,seed:crypto.randomUUID(),createdAt:stamp(),actorId};
 const d:ExperimentDesign={...payload,digest:await storefrontDigest(payload)};
 if(!await experimentDesignCurrent(owner,c,d))throw new ApiError(409,'소재·캠페인 설계가 변경되었습니다.');
 await recordStatement(owner,'meta_experiment_design',id,d,c.id).run();return {duplicate:false};
}
async function assignUnit(owner:string,c:Campaign,d:ExperimentDesign,b:Record<string,unknown>){
 if(typeof b.unitHash!=='string'||!/^[a-f0-9]{64}$/.test(b.unitHash))throw new ApiError(400,'몰의 비식별 방문자 키 SHA256만 받습니다. 이메일·전화번호는 받지 않습니다.');
 const units=await experimentUnits(owner,d),existing=units.find(u=>u.unitHash===b.unitHash);
 if(existing)return {assignment:existing,duplicate:true};
 if(!await experimentDesignCurrent(owner,c,d)||Date.now()<Date.parse(d.registration.startAt)||Date.now()>=Date.parse(d.registration.endAt))throw new ApiError(409,'현재 설계의 관측 기간에만 배정할 수 있습니다.');
 if(units.length>=10000)throw new ApiError(409,'실험당 배정 단위 한도 10,000개에 도달했습니다.');
 const digest=await storefrontDigest({seed:d.seed,unit:b.unitHash}),arm=parseInt(digest.slice(0,8),16)<0x80000000?'control' as const:'treatment' as const;
 const u:ExperimentUnit={id:d.id+':'+b.unitHash,designId:d.id,campaignId:c.id,unitHash:b.unitHash,arm,assignedAt:stamp(),version:1,observation:null};
 await recordStatement(owner,'meta_experiment_unit',u.id,u,c.id).run();return {assignment:u,duplicate:false};
}
function observationInput(value:unknown,actorId:string):ExperimentObservation{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'관측 자료를 확인하세요.');const v=value as Record<string,unknown>;
 if(!Array.isArray(v.orderIds)||v.orderIds.length>100||v.orderIds.some(x=>typeof x!=='string'||!x||x.length>200)||new Set(v.orderIds).size!==v.orderIds.length)throw new ApiError(400,'중복 없는 주문 식별자를 최대 100개 연결하세요.');
 const orderIds=v.orderIds as string[],purchases=Array.isArray(v.purchases)?v.purchases:[];
 if(purchases.length!==v.orderIds.length||new Set(purchases.map(p=>p?.orderId)).size!==purchases.length)throw new ApiError(400,'각 주문의 실제 결제 시각과 원장 증빙이 필요합니다.');
 const proofs=purchases.map(p=>{if(!p||typeof p!=='object'||!orderIds.includes(p.orderId))throw new ApiError(400,'결제 증빙의 주문을 확인하세요.');const purchasedAt=str(p.purchasedAt,'실제 결제 시각',40,true);if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(purchasedAt)||!Number.isFinite(Date.parse(purchasedAt))||Date.parse(purchasedAt)>Date.now())throw new ApiError(400,'시간대가 있는 실제 결제 시각을 입력하세요.');return {orderId:String(p.orderId),purchasedAt:new Date(purchasedAt).toISOString(),evidenceRef:str(p.evidenceRef,'결제 시각 증빙',500,true)};}).sort((a,b)=>a.orderId.localeCompare(b.orderId));
 if(['exposed','trackingComplete','contaminated'].some(k=>typeof v[k]!=='boolean')||['netTaxKrw','adSpendKrw','productionCostKrw'].some(k=>typeof v[k]!=='number'||!Number.isSafeInteger(v[k])||Number(v[k])<0||Number(v[k])>1e9))throw new ApiError(400,'노출·추적 확인과 비용·순세액 원화 정수를 입력하세요.');
 const observedThrough=str(v.observedThrough,'관측 종료',40,true);
 if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(observedThrough)||!Number.isFinite(Date.parse(observedThrough))||Date.parse(observedThrough)>Date.now())throw new ApiError(400,'미래가 아닌 관측 종료 시각을 입력하세요.');
 return {orderIds:[...v.orderIds].sort() as string[],purchases:proofs,exposed:v.exposed as boolean,trackingComplete:v.trackingComplete as boolean,contaminated:v.contaminated as boolean,netTaxKrw:Number(v.netTaxKrw),adSpendKrw:Number(v.adSpendKrw),productionCostKrw:Number(v.productionCostKrw),costEvidence:str(v.costEvidence,'비용·배분 근거',1000,true),sourceReceipt:str(v.sourceReceipt,'노출·추적 증빙',500,true),observedThrough:new Date(observedThrough).toISOString(),recordedAt:stamp(),actorId};
}
async function observe(owner:string,actorId:string,c:Campaign,d:ExperimentDesign,b:Record<string,unknown>){
 const u=await readRecord<ExperimentUnit>(owner,'meta_experiment_unit',str(b.unitId,'배정 단위',300,true));
 if(u.designId!==d.id||u.campaignId!==c.id)throw new ApiError(409,'배정 범위가 다릅니다.');
 const observation=observationInput(b.observation,actorId),inputDigest=({recordedAt,actorId,...value}:ExperimentObservation)=>{void recordedAt;void actorId;return storefrontDigest(value);};
 if(Date.parse(observation.observedThrough)<Date.parse(u.assignedAt))throw new ApiError(400,'배정 이전 관측입니다.');
 if(u.observation&&await inputDigest(u.observation)===await inputDigest(observation))return {duplicate:true};
 if(b.expectedVersion!==u.version)throw new ApiError(409,'관측 판이 변경되었습니다. 다시 조회하세요.');
 const units=await experimentUnits(owner,d);
 if(units.some(x=>x.id!==u.id&&x.observation?.orderIds.some(id=>observation.orderIds.includes(id))))throw new ApiError(409,'같은 주문을 여러 배정 단위에 중복 연결할 수 없습니다.');
 for(const id of observation.orderIds){const order=await readRecord<{storeId:string;campaignId?:string}>(owner,'store_order',id);if(order.storeId!==d.storeId||order.campaignId!==c.id)throw new ApiError(409,'현재 지점·캠페인의 주문만 연결하세요.');}
 const next={...u,version:u.version+1,observation};
 await database().batch([recordStatement(owner,'meta_experiment_unit',u.id,next,c.id),recordStatement(owner,'meta_experiment_observation',u.id+':'+next.version,next,c.id)]);
 return {duplicate:false};
}
async function evaluate(owner:string,actorId:string,c:Campaign,d:ExperimentDesign){
 const results=(await rows<ExperimentResult>(owner,'meta_experiment_result',c)).filter(r=>r.designId===d.id),version=results.length+1,e=await experimentEvidence(owner,c,d,version);
 if(['not_started','collecting','maturing'].includes(e.statistics.status))throw new ApiError(409,'종료·성숙 대기 후 한 번 판정하고, 정정 자료가 생겼을 때 새 판을 남깁니다.');
 const existing=results.find(r=>r.sourceDigest===e.sourceDigest);
 if(existing)return {duplicate:true};
 const r:ExperimentResult={id:d.id+':'+version,designId:d.id,campaignId:c.id,brandId:c.brandId,version,sourceDigest:e.sourceDigest,designDigest:d.digest,statistics:e.statistics,lineage:e.lineage,recordedAt:stamp(),actorId};
 await recordStatement(owner,'meta_experiment_result',r.id,r,c.id).run();return {duplicate:false};
}
async function ruleAction(owner:string,actorId:string,c:Campaign,d:ExperimentDesign,b:Record<string,unknown>){
 const results=(await rows<ExperimentResult>(owner,'meta_experiment_result',c)).filter(r=>r.designId===d.id).sort((a,b)=>b.version-a.version),result=results[0];
 if(!result||!['supported','rejected'].includes(result.statistics.status))throw new ApiError(409,'성숙한 개선·악화 근거가 있는 최신 결과가 필요합니다.');
 const evidence=await experimentEvidence(owner,c,d,result.version);
 if(evidence.sourceDigest!==result.sourceDigest||evidence.statistics.status!==result.statistics.status)throw new ApiError(409,'원자료가 바뀌었습니다. 새 판정을 기록하세요.');
 if(b.action==='propose_rule'){
  const guidance=str(b.guidance,'규칙 제안',2000,true),id=result.id,existing=(await rows<ExperimentRule>(owner,'meta_experiment_rule',c)).find(r=>r.id===id);
  if(existing){if(existing.guidance!==guidance)throw new ApiError(409,'이미 제안된 결과입니다.');return {duplicate:true};}
  const r:ExperimentRule={id,campaignId:c.id,brandId:c.brandId,designId:d.id,resultId:result.id,resultVersion:result.version,sourceDigest:result.sourceDigest,guidance,status:'draft',recordedAt:stamp(),actorId};
  await recordStatement(owner,'meta_experiment_rule',id,r,c.id).run();return {duplicate:false};
 }
 const candidate=await readRecord<ExperimentRule>(owner,'meta_experiment_rule',str(b.ruleId,'규칙 후보',200,true));
 if(candidate.resultId!==result.id||candidate.campaignId!==c.id||candidate.designId!==d.id)throw new ApiError(409,'최신 결과의 규칙 후보만 승인할 수 있습니다.');
 if(candidate.status==='approved')return {duplicate:true};
 const at=stamp(),id='meta:'+candidate.id;
 const rule:LearningRule={id,origin:'meta',grade:'performance_observed',brandId:c.brandId,storeId:d.storeId,channel:'Instagram',experimentId:d.id,experimentVersion:result.version,caseId:'',title:d.registration.hypothesis,guidance:candidate.guidance,scope:d.registration.fixedConditions,evidenceLevel:'observational',status:'active',version:1,direction:result.statistics.status==='supported'?'test':'caution',expiresAt:new Date(Date.now()+30*86400000).toISOString(),createdAt:at,updatedAt:at,metaAssessment:{campaignId:c.id,designId:d.id,resultId:result.id,sourceDigest:result.sourceDigest}};
 await database().batch([recordStatement(owner,'learning_rule',id,rule,c.brandId),recordStatement(owner,'meta_experiment_rule',candidate.id,{...candidate,status:'approved',learningRuleId:id,approvedAt:at,approvedBy:actorId},c.id)]);return {duplicate:false};
}
export async function mutateMetaExperiment(owner:string,actorId:string,c:Campaign,b:Record<string,unknown>){
 if(b.action==='approve_rule')await requireGrowthRunning(owner);
 if(c.status==='archived'||b.confirmed!==true)throw new ApiError(409,'활성 캠페인에서 작업 내용을 확인하세요.');
 if(b.action==='design')return createDesign(owner,actorId,c,b);
 const d=await designFor(owner,c,b.designId);
 if(b.action==='assign')return assignUnit(owner,c,d,b);
 if(b.action==='observe')return observe(owner,actorId,c,d,b);
 if(b.action==='evaluate')return evaluate(owner,actorId,c,d);
 if(b.action==='propose_rule'||b.action==='approve_rule')return ruleAction(owner,actorId,c,d,b);
 throw new ApiError(400,'지원하지 않는 실험 작업입니다.');
}
