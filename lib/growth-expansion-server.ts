import type {Campaign} from './agency';
import {prepareMetaBudgetAmendment,type MetaBudgetAmendment} from './meta-budget-amendment-server';
import type {GrowthAuthorityRecord,GrowthCommitmentRecord} from './growth-authority-server';
import {readExperimentOutcomeBasis,type GrowthExperimentRecord,type GrowthExperimentResult} from './growth-experiment-server';
import {evaluateAuthority,type AuthorityAction} from './growth-authority';
import {growthView} from './growth-workspace-server';
import {requireGrowthRunning} from './growth-stop-server';
import {parseReconciliationInput,reconcileCommitment,GrowthReconciliationError} from './growth-reconciliation';
import {assessExpansion,parseExpansionInput,type ExpansionEvidence,type ExpansionInput} from './growth-expansion';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
const kinds={current:'growth_expansion',history:'growth_expansion_history',request:'growth_expansion_request'} as const;
export type ExpansionRecord={id:string;brandId:string;campaignId:string;version:number;status:'proposed'|'reserved'|'withdrawn';input:ExpansionInput;evidence:ExpansionEvidence;metaBudgetAmendmentId?:string;reservation:{commitmentId:string;authorityId:string;authorityVersion:number;amount:number;at:string;by:string}|null;reconciliation?:{status:string;actualAmount:number|null;actualLoss:number|null;evidenceRef:string;at:string;by:string}|null;requestDigest:string;createdAt:string;updatedAt:string;updatedBy:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const scoped=(x:{brandId:string;campaignId:string},c:Campaign)=>x.brandId===c.brandId&&x.campaignId===c.id;
async function rows<T>(owner:string,c:Campaign|null,kind:string,limit:number,extra='',...binds:unknown[]){const r=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind=?${c?' AND parent_id=?':''}${extra} LIMIT ?`).bind(...[owner,kind,...(c?[c.id]:[]),...binds,limit+1]).all<{data:string}>();if(r.results.length>limit)throw new ApiError(409,'확대 검토 조회 한도를 넘었습니다.');return r.results.map(x=>JSON.parse(x.data) as T)}
async function capacity(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=limit)throw new ApiError(409,'확대 검토 보관 한도에 도달했습니다.')}
function append(owner:string,c:Campaign,kind:string,id:string,value:unknown,at:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(value),at)}
const refKinds:Record<string,string>={landing_revision:'growth_landing_revision',demand_step:'growth_demand',publication_link:'growth_publication_link',offer:'growth_offer'};
async function gather(owner:string,c:Campaign,input:ExpansionInput){
 const [experiment,results,view]=await Promise.all([optional<GrowthExperimentRecord>(owner,'growth_experiment',input.experimentId),rows<GrowthExperimentResult>(owner,c,'growth_experiment_result',50," AND json_extract(data,'$.designId')=?",input.experimentId),growthView(owner,c,true)]);
 const exp=experiment&&scoped(experiment,c)?experiment:null,result=results.find(r=>r.analysisNumber===input.analysisNumber&&scoped(r,c))??null,latest=results.length?Math.max(...results.map(r=>r.analysisNumber)):null;
 let refsCurrent=!!exp;if(exp)for(const ref of exp.input.interventionRefs){if(ref.kind==='manual')continue;const x=await optional<{version:number}>(owner,refKinds[ref.kind],ref.id);if(!x||x.version!==ref.version)refsCurrent=false}
 const mission=view.missions.find(m=>m.id===input.missionId),offer=exp?view.offers.find(o=>o.id===exp.input.offerId):undefined;
 const evidence:ExpansionEvidence|null=exp&&result?{experimentId:exp.id,analysisNumber:result.analysisNumber,status:result.analysis.status,interval:result.analysis.statistics?.interval??null,minEffect:exp.input.minEffect,metric:exp.input.metric,channel:exp.input.channel,offerId:exp.input.offerId,offerVersion:exp.input.offerVersion,designDigest:result.designDigest,inputDigest:result.inputDigest,recordedAt:result.recordedAt,refs:exp.input.interventionRefs}:null;
 const assessment=assessExpansion({input,evidence,latestAnalysis:latest,experiment:exp?{status:exp.status,mode:exp.input.mode,aa:exp.input.aa,missionId:exp.input.missionId,registrationDigest:exp.registration?.digest??null}:null,refsCurrent,mission:mission?{version:mission.version,channel:mission.input.channel,offerId:mission.input.offerId,budget:mission.input.budget}:null,offer:offer?{version:offer.version,unitContribution:offer.readiness.unitContribution}:null,stock:offer?.currentStock?{status:offer.currentStock.status,available:offer.currentStock.available}:null,now:Date.now()});
 if(assessment.allowed&&evidence){try{await assertCanonicalExpansionEvidence(owner,c,evidence)}catch(error){if(!(error instanceof ApiError)||![400,404,409].includes(error.status))throw error;return {evidence,assessment:{...assessment,allowed:false,reasons:[...assessment.reasons,error.message]},mission,offer}}}
 return {evidence,assessment,mission,offer};
}
async function assertCanonicalExpansionEvidence(owner:string,c:Campaign,evidence:ExpansionEvidence){
 const basis=await readExperimentOutcomeBasis(owner,c,evidence.experimentId);
 if(!basis.current||basis.latest?.number!==evidence.analysisNumber||basis.latest.status!=='supported'||basis.registrationDigest!==evidence.designDigest||basis.inputDigest!==evidence.inputDigest)throw new ApiError(409,'현재 주문·환불·원가·관측과 승인 분석 근거가 달라졌습니다. 다시 분석하고 제안하세요.');
}
export async function growthExpansionView(who:Actor,c:Campaign){
 const [records,history,authorities]=await Promise.all([rows<ExpansionRecord>(who.owner,c,kinds.current,200),rows<ExpansionRecord>(who.owner,c,kinds.history,2000),rows<GrowthAuthorityRecord>(who.owner,c,'growth_authority',100)]);
 const proposals=await Promise.all(records.filter(r=>scoped(r,c)).map(async r=>{const live=r.status==='proposed'?await gather(who.owner,c,r.input):null;const drift=live&&live.evidence&&JSON.stringify(live.evidence)!==JSON.stringify(r.evidence)?['제안 뒤 근거 결과가 바뀌었습니다. 새 제안으로 검토하세요.']:[];const commitment=r.reservation?await optional<GrowthCommitmentRecord>(who.owner,'growth_commitment',r.reservation.commitmentId):null;return {...r,provider: r.metaBudgetAmendmentId?await optional<MetaBudgetAmendment>(who.owner,'meta_budget_amendment',r.metaBudgetAmendmentId):null,commitment:commitment?{version:commitment.version??1,status:commitment.commitment.status,reservedAmount:commitment.commitment.reservedAmount,actualAmount:commitment.commitment.actualAmount,actualLoss:commitment.commitment.actualLoss}:null,assessment:live?{...live.assessment,allowed:live.assessment.allowed&&!drift.length,reasons:[...live.assessment.reasons,...drift]}:null}}));
 return {campaignId:c.id,campaignVersion:c.version,proposals,history:history.filter(h=>scoped(h,c)),authorities:authorities.filter(a=>scoped(a,c)&&a.input.status==='active').map(a=>({id:a.id,version:a.version,accountId:a.input.accountId,channel:a.input.channel,maxTier:a.input.maxTier})),canPropose:who.role!=='member'&&c.status!=='archived',canReserve:who.role==='owner'&&c.status!=='archived',mayExecute:false as const,autoScale:false as const};
}
export type GrowthExpansionView=Awaited<ReturnType<typeof growthExpansionView>>;
export async function saveGrowthExpansion(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 const requestId=String(b.requestId??''),action=String(b.action??'');if(!uuid.test(requestId)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0)throw new ApiError(400,'요청 번호와 확대 제안 판을 확인하세요.');
 const id=str(b.id,'확대 제안 ID',100,true);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new ApiError(400,'확대 제안 ID 형식을 확인하세요.');
 const input=action==='propose'?parseExpansionInput(b.input):null,digest=await storefrontDigest({action,id,campaignId:c.id,campaignVersion:c.version,input,expectedVersion:b.expectedVersion,authorityId:b.authorityId,authorityVersion:b.authorityVersion,reconciliation:b.reconciliation,outcome:b.outcome,commitmentVersion:b.commitmentVersion,metaBudgetApproval:b.metaBudgetApproval});
 const [request,old]=await Promise.all([optional<{digest:string;id:string;version:number}>(who.owner,kinds.request,requestId),optional<ExpansionRecord>(who.owner,kinds.current,id)]),ack=(version:number,duplicate:boolean)=>({recorded:true as const,id,version,duplicate,mayExecute:false as const});
 if(request){if(request.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return ack(old?.version??request.version,true)}
 if(old&&!scoped(old,c))throw new ApiError(404,'다른 캠페인의 확대 제안입니다.');
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'확대 제안이 변경되었습니다. 다시 불러오세요.');
 if(c.status==='archived'&&!['withdraw','reconcile'].includes(action))throw new ApiError(409,'보관한 캠페인은 확대할 수 없습니다.');
 const at=stamp(),writes:D1PreparedStatement[]=[];let next:ExpansionRecord;
 if(action==='propose'){
  if(who.role==='member')throw new ApiError(403,'관리자만 확대를 제안할 수 있습니다.');if(old&&old.status!=='proposed')throw new ApiError(409,'예약·철회된 제안은 바꿀 수 없습니다. 새 제안을 만드세요.');
  const g=await gather(who.owner,c,input!);if(!g.evidence)throw new ApiError(404,'현재 캠페인의 실험 분석 결과가 아닙니다.');if(!g.assessment.allowed)throw new ApiError(409,g.assessment.reasons[0]);
  if(!old)await capacity(who.owner,c,kinds.current,200);
  next={id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,status:'proposed',input:input!,evidence:g.evidence,reservation:null,requestDigest:digest,createdAt:old?.createdAt??at,updatedAt:at,updatedBy:who.id};
 }else if(action==='withdraw'){
  if(!old||old.status!=='proposed')throw new ApiError(409,'예약 전 제안만 철회할 수 있습니다. 예약은 기존 비용 대사·해제 경로를 쓰세요.');
  next={...old,version:old.version+1,status:'withdrawn',requestDigest:digest,updatedAt:at,updatedBy:who.id};
 }else if(action==='approve_reserve'){
  if(who.role!=='owner')throw new ApiError(403,'확대 예산 예약은 소유자만 승인합니다.');await requireGrowthRunning(who.owner);
  if(!old||old.status!=='proposed')throw new ApiError(409,'제안 상태만 승인할 수 있습니다.');
  const g=await gather(who.owner,c,old.input);if(!g.evidence||JSON.stringify(g.evidence)!==JSON.stringify(old.evidence))throw new ApiError(409,'제안 뒤 근거 결과가 바뀌었습니다. 새 제안으로 검토하세요.');if(!g.assessment.allowed)throw new ApiError(409,g.assessment.reasons[0]);
  const authorityId=str(b.authorityId,'위임 ID',100,true),authority=await optional<GrowthAuthorityRecord>(who.owner,'growth_authority',authorityId);
  if(!authority||!scoped(authority,c))throw new ApiError(404,'현재 캠페인의 위임이 아닙니다.');if(authority.version!==b.authorityVersion)throw new ApiError(409,'위임이 변경되었습니다. 다시 불러오세요.');if(authority.campaignVersion!==c.version)throw new ApiError(409,'캠페인 변경 후 위임을 다시 승인하세요.');
  const mission=g.mission!,increase=old.input.nextBudget-(mission.input.budget??0),commitmentId=`${mission.id}:scale:${id}`;
  const scaleAction:AuthorityAction={id:mission.id,operationKey:commitmentId,brandId:c.brandId,campaignId:c.id,accountId:authority.input.accountId,channel:mission.input.channel,operation:'scale',amount:increase,loss:increase,budget:'confirmed',previousBudget:mission.input.budget,nextBudget:old.input.nextBudget,evidence:{id:`${old.evidence.experimentId}:${old.evidence.analysisNumber}`,incremental:g.assessment.incremental,profitable:g.assessment.profitable,capacity:g.assessment.capacity}};
  // The owner's explicit approval of this single evidence-backed step is the scale grant; standing mandates still cannot delegate scale.
  const ledger=await rows<GrowthCommitmentRecord>(who.owner,null,'growth_commitment',10000),decision=evaluateAuthority({...authority.input,allowedActions:[...new Set([...authority.input.allowedActions,'scale' as const])]},scaleAction,ledger.map(r=>r.commitment));
  if(!decision.allowed||decision.duplicate)throw new ApiError(409,`확대 예약을 막았습니다: ${decision.reasons.join(' ')||'이미 예약된 확대입니다.'}`);
  const commitment:GrowthCommitmentRecord={id:commitmentId,campaignId:c.id,brandId:c.brandId,authorityId,authorityVersion:authority.version,authorityApprovalId:authority.input.ownerApprovalId,authoritySnapshot:{...authority.input,allowedActions:[...authority.input.allowedActions]},missionId:mission.id,missionVersion:mission.version,commitment:{authorityId,action:scaleAction,status:'reserved',at,reservedAmount:increase,reservedLoss:increase,actualAmount:null,actualLoss:null},createdAt:at,createdBy:who.id};
  const amendment=b.metaBudgetApproval?await prepareMetaBudgetAmendment(who,c,old,mission,g.offer?.input.landingUrl??'',authority,commitmentId,b.metaBudgetApproval):null;
  const storedCommitment=amendment?{...commitment,providerCostRef:{kind:'meta_ads_execution',id:amendment.record.executionId}}:commitment;
  writes.push(database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:growth_commitment:${commitmentId}`,who.owner,'growth_commitment',c.id,JSON.stringify(storedCommitment),at));
  if(amendment)writes.push(...amendment.statements);
  next={...old,version:old.version+1,status:'reserved',...(amendment?{metaBudgetAmendmentId:amendment.record.id}:{}),reservation:{commitmentId,authorityId,authorityVersion:authority.version,amount:increase,at,by:who.id},requestDigest:digest,updatedAt:at,updatedBy:who.id};
 }else if(action==='reconcile'){
  if(who.role==='member')throw new ApiError(403,'관리자만 확대 예약을 대사합니다.');
  if(!old||old.status!=='reserved'||!old.reservation)throw new ApiError(409,'예약한 확대만 대사합니다.');
  if(old.metaBudgetAmendmentId)throw new ApiError(409,'공급자 예산 변경 예약은 광고 중단·최종 청구 대조 전 수동 해제 또는 비용 중복 정산할 수 없습니다.');
  if(b.outcome!=='failed'&&b.outcome!=='observed')throw new ApiError(400,'집행 결과(미집행 실패/집행 확인)를 선택하세요.');
  let rec;try{rec=parseReconciliationInput(b.reconciliation)}catch(e){throw new ApiError(400,e instanceof Error?e.message:'대사 입력을 확인하세요.')}
  const commitment=await readRecord<GrowthCommitmentRecord>(who.owner,'growth_commitment',old.reservation.commitmentId);if(!scoped(commitment,c)||commitment.commitment.action.operationKey!==commitment.id)throw new ApiError(409,'확대 예약 원장을 확인하세요.');
  if(b.commitmentVersion!==(commitment.version??1))throw new ApiError(409,'확대 예약이 변경되었습니다. 다시 불러오세요.');
  let after;try{after=reconcileCommitment(commitment.commitment,rec,b.outcome)}catch(e){throw new ApiError(409,e instanceof GrowthReconciliationError?e.message:'대사할 수 없습니다.')}
  writes.push(recordStatement(who.owner,'growth_commitment',commitment.id,{...commitment,version:(commitment.version??1)+1,commitment:{...after,...(rec.mode==='final'?{reconciledAt:at}:{})}},c.id));
  next={...old,version:old.version+1,reconciliation:{status:after.status,actualAmount:after.actualAmount,actualLoss:after.actualLoss,evidenceRef:rec.evidenceRef,at,by:who.id},requestDigest:digest,updatedAt:at,updatedBy:who.id};
 }else throw new ApiError(400,'지원하지 않는 확대 작업입니다.');
 await capacity(who.owner,c,kinds.history,2000);await capacity(who.owner,c,kinds.request,5000);
 writes.push(recordStatement(who.owner,kinds.current,id,next,c.id),append(who.owner,c,kinds.history,`${id}:${next.version}`,next,at),append(who.owner,c,kinds.request,requestId,{digest,id,version:next.version},at));
 await database().batch(writes);return ack(next.version,false);
}

/** Recheck immutable evidence immediately before a queued provider write. */
export async function assertExpansionProviderEvidence(owner:string,c:Campaign,id:string,missionId:string,missionVersion:number){
 const row=await readRecord<ExpansionRecord>(owner,kinds.current,id),g=await gather(owner,c,row.input);
 if(!scoped(row,c)||row.status!=='reserved'||row.input.missionId!==missionId||row.input.missionVersion!==missionVersion||!g.assessment.allowed||!g.evidence||JSON.stringify(g.evidence)!==JSON.stringify(row.evidence))throw new ApiError(409,'확대 승인 근거·현재 미션·재고가 변경되었습니다.');
 return row;
}
