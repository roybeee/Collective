import type {Campaign} from './agency';
import type {MetaExecution} from './meta-execution';
import type {ExpansionRecord} from './growth-expansion-server';
import {assertExpansionProviderEvidence} from './growth-expansion-server';
import type {GrowthAuthorityRecord,GrowthCommitmentRecord} from './growth-authority-server';
import type {MissionInput} from './growth-mission';
import type {MetaReservation} from './meta-reservation';
import {budgetAmendmentAmounts,runBudgetAmendment,type BudgetAmendmentAmounts,type BudgetAmendmentState} from './meta-budget-amendment';
import {readExecutionHierarchy,readExecutionSpend,verifyExecutionCurrency,writeExecutionDailyBudget} from './meta-execution-provider';
import {readMetaWriteConnection,metaWriteToken} from './meta-write-connection';
import {requireGrowthRunning} from './growth-stop-server';
import {workerStatus} from './research-worker';
import {isEnabled} from './feature-flags';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,stamp,type Actor} from './server';
export type MetaBudgetAmendment=BudgetAmendmentAmounts&{id:string;campaignId:string;brandId:string;executionId:string;expansionId:string;commitmentId:string;authorityId:string;authorityVersion:number;missionId:string;missionVersion:number;executionScopeDigest:string;connectionFingerprint:string;state:BudgetAmendmentState;version:number;approvedAt:string;approvedBy:string;expiresAt:string;updatedAt:string;observedAt:string|null;settledAt?:string};
async function token(owner:string,e:MetaExecution){const w=await readMetaWriteConnection(owner,e.brandId);if(!w||w.accountId!==e.scope.accountId||w.permission!=='ads_management')throw new ApiError(409,'원본 광고 계정의 쓰기 연결이 필요합니다.');return {value:await metaWriteToken(owner,w),fingerprint:await storefrontDigest({version:w.version,updatedAt:w.updatedAt,accountId:w.accountId,secret:w.secret})}}
const cas=(owner:string,kind:string,id:string,old:unknown,next:unknown)=>database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT id,owner,kind,parent_id,CASE WHEN data=? THEN ? ELSE json('stale_budget_revision') END,? FROM records WHERE owner=? AND kind=? AND id=? ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(JSON.stringify(old),JSON.stringify(next),stamp(),owner,kind,`${owner}:${kind}:${id}`);
const history=(owner:string,a:MetaBudgetAmendment)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:meta_budget_amendment_history:${a.id}:${a.version}`,owner,'meta_budget_amendment_history',a.campaignId,JSON.stringify(a),a.updatedAt);
/** Returned statements join the growth commitment + expansion request transaction. No provider writes. */
export async function prepareMetaBudgetAmendment(who:Actor,c:Campaign,exp:ExpansionRecord,mission:{id:string;version:number;input:MissionInput},landingUrl:string,authority:GrowthAuthorityRecord,commitmentId:string,value:unknown){
 if(who.role!=='owner'||!value||typeof value!=='object')throw new ApiError(403,'소유자의 정확한 예산 변경 승인이 필요합니다.');
 const b=value as Record<string,unknown>,e=await readRecord<MetaExecution>(who.owner,'meta_ads_execution',String(b.executionId??''));
 if(e.campaignId!==c.id||e.brandId!==c.brandId||mission.input.channel!=='meta'||authority.input.accountId!==e.scope.accountId||e.scope.landingUrl!==landingUrl)throw new ApiError(409,'동일 미션·오퍼 랜딩·광고 실행·위임 계정의 계보가 아닙니다.');
 if(!exp.evidence.refs.some(r=>r.kind==='manual'&&r.id===`meta_execution:${e.id}`&&r.version===1))throw new ApiError(409,'확증 실험 등록에 원본 Meta 실행 참조(meta_execution:실행ID, 판 1)가 필요합니다.');
 if(!await isEnabled(who.owner,'meta_ads_execution')||!(await workerStatus(who.owner)).online)throw new ApiError(409,'광고 실행 기능과 온라인 감시 워커가 필요합니다.');
 const w=await token(who.owner,e);if(w.fingerprint!==e.connectionFingerprint)throw new ApiError(409,'승인된 쓰기 연결이 바뀌었습니다.');
 const currency=await verifyExecutionCurrency(w.value,e.scope);let amounts:BudgetAmendmentAmounts;
 try{amounts=budgetAmendmentAmounts(e,b,exp.input.nextBudget,mission.input.budget??0,currency.offset)}catch(error){throw new ApiError(409,error instanceof Error?error.message:'예산 단위를 확인하세요.')}
 const statuses=await readExecutionHierarchy(w.value,e.scope),spend=await readExecutionSpend(w.value,e.scope),now=Date.now();
 if(Object.values(statuses).some(s=>s!=='ACTIVE')||spend.totalSpend>=e.maxSpend||spend.totalSpend>=e.lossLimit||spend.dailySpend>=e.dailyTarget||now>=Date.parse(e.expiresAt)||now>=Date.parse(e.scope.endAt)||!e.lastObservedAt||now-Date.parse(e.lastObservedAt)>180000)throw new ApiError(409,'정상 감시 중이며 기존 한도 안인 광고만 확대할 수 있습니다.');
 const r=await readRecord<MetaReservation>(who.owner,'meta_ads_reservation',e.reservationId);
 if(r.state!=='reserved'||r.version!==e.reservationVersion||r.scopeDigest!==e.scopeDigest||r.campaignId!==c.id||r.accountId!==e.scope.accountId)throw new ApiError(409,'원본 광고 예산 예약의 정확한 판이 필요합니다.');
 const id=await storefrontDigest({executionId:e.id,expansionId:exp.id}),at=stamp();
 const a:MetaBudgetAmendment={...amounts,id,campaignId:c.id,brandId:c.brandId,executionId:e.id,expansionId:exp.id,commitmentId,authorityId:authority.id,authorityVersion:authority.version,missionId:mission.id,missionVersion:mission.version,executionScopeDigest:e.scopeDigest,connectionFingerprint:w.fingerprint,state:'approved',version:1,approvedAt:at,approvedBy:who.id,expiresAt:new Date(Math.min(now+15*60000,Date.parse(e.expiresAt),Date.parse(e.scope.endAt))).toISOString(),updatedAt:at,observedAt:null};
 const nextReservation={...r,version:r.version+1,additionalReservedAmount:amounts.increase,budgetAmendmentId:id,updatedAt:at},nextExecution={...e,version:e.version+1,reservationVersion:nextReservation.version,budgetAmendment:{id,state:'pending' as const,nextDaily:a.nextDaily,nextGraph:a.nextGraph},updatedAt:at,updatedBy:who.id};
 // Caller holds the workspace lock; one execution revision can receive only one amendment.
 return {record:a,statements:[database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:meta_budget_amendment:${id}`,who.owner,'meta_budget_amendment',c.id,JSON.stringify(a),at),history(who.owner,a),cas(who.owner,'meta_ads_execution',e.id,e,nextExecution),cas(who.owner,'meta_ads_reservation',r.id,r,nextReservation)]};
}
async function stillCurrent(owner:string,c:Campaign,a:MetaBudgetAmendment,e:MetaExecution,current:(e:MetaExecution)=>Promise<boolean>){
 try{
  await requireGrowthRunning(owner);
  if(e.state!=='active'||e.pending||e.budgetAmendment?.id!==a.id||e.budgetAmendment.state!=='pending'||e.scopeDigest!==a.executionScopeDigest||Date.now()>=Date.parse(a.expiresAt)||!(await workerStatus(owner)).online||!await current(e))return false;
  const authority=await readRecord<GrowthAuthorityRecord>(owner,'growth_authority',a.authorityId),commitment=await readRecord<GrowthCommitmentRecord>(owner,'growth_commitment',a.commitmentId);
  if(authority.version!==a.authorityVersion||authority.input.status!=='active'||authority.campaignVersion!==c.version||Date.now()>=Date.parse(authority.input.expiresAt)||Date.now()<Date.parse(authority.input.startsAt)||commitment.commitment.status!=='reserved'||commitment.commitment.reservedAmount!==a.increase)return false;
  await assertExpansionProviderEvidence(owner,c,a.expansionId,a.missionId,a.missionVersion);
  const w=await token(owner,e);if(w.fingerprint!==a.connectionFingerprint)return false;
  const currency=await verifyExecutionCurrency(w.value,e.scope);if(currency.offset!==a.currencyOffset)return false;
  const statuses=await readExecutionHierarchy(w.value,e.scope),spend=await readExecutionSpend(w.value,e.scope);
  return Object.values(statuses).every(s=>s==='ACTIVE')&&spend.totalSpend<e.maxSpend&&spend.totalSpend<e.lossLimit&&spend.dailySpend<e.dailyTarget;
 }catch{return false}
}
/** Called under the normal Meta execution owner lock. One approved execution, at most one budget POST. */
export async function advanceMetaBudgetAmendmentForExecution(owner:string,c:Campaign,e:MetaExecution,current:(e:MetaExecution)=>Promise<boolean>){
 if(!e.budgetAmendment||e.budgetAmendment.state==='applied')return {status:'idle' as const};
 let row=await readRecord<MetaBudgetAmendment>(owner,'meta_budget_amendment',e.budgetAmendment.id);
 if(row.executionId!==e.id||row.campaignId!==c.id||row.brandId!==c.brandId)throw new ApiError(409,'예산 변경 계보가 다릅니다.');
 if(row.state==='applied'||row.state==='blocked')return {status:'idle' as const};
 const w=await token(owner,e),scope={...e.scope,dailyBudgetKrw:row.nextDaily,graphDailyBudget:row.nextGraph};
 async function save(patch:{state:BudgetAmendmentState}){
  const at=stamp(),next={...row,...patch,version:row.version+1,updatedAt:at,...(patch.state==='applied'?{observedAt:at}:{})};
  const live=await readRecord<MetaExecution>(owner,'meta_ads_execution',e.id);
  if(live.budgetAmendment?.id!==row.id)throw new ApiError(409,'예산 실행 연결이 변경되었습니다.');
  const updated:MetaExecution=patch.state==='applied'?{...live,version:live.version+1,maxSpend:row.nextTotal,dailyTarget:row.nextDaily,lossLimit:live.lossLimit+row.increase,budgetAmendment:{id:row.id,state:'applied',nextDaily:row.nextDaily,nextGraph:row.nextGraph},updatedAt:at,updatedBy:'worker'}:patch.state==='unknown'?{...live,version:live.version+1,state:'unknown',maySpend:true,stopReason:'budget_result_unknown',updatedAt:at,updatedBy:'worker'}:patch.state==='blocked'?{...live,version:live.version+1,budgetAmendment:{id:row.id,state:'blocked',nextDaily:row.nextDaily,nextGraph:row.nextGraph},updatedAt:at,updatedBy:'worker'}:live;
  const writes=[cas(owner,'meta_budget_amendment',row.id,row,next),history(owner,next),...(updated!==live?[cas(owner,'meta_ads_execution',live.id,live,updated)]:[])];
  await database().batch(writes);row=next;return row;
 }
 await runBudgetAmendment(row,{current:()=>stillCurrent(owner,c,row,e,current),write:async()=>{await requireGrowthRunning(owner);await writeExecutionDailyBudget(w.value,e.scope.adsetId,row.nextGraph)},read:async()=>{await verifyExecutionCurrency(w.value,scope);await readExecutionHierarchy(w.value,scope);return row.nextGraph}},{save});
 return {status:row.state==='unknown'||row.state==='submitting'?'retry' as const:'processed' as const};
}

/** Settle the linked funding commitment with the same final Meta bill, not a second expense. */
export async function settleMetaBudgetAmendment(owner:string,c:Campaign,e:MetaExecution,amount:number,spend:{totalSpend:number;dailySpend:number},actorId:string){
 const a=await readRecord<MetaBudgetAmendment>(owner,'meta_budget_amendment',e.budgetAmendment!.id),commitment=await readRecord<GrowthCommitmentRecord>(owner,'growth_commitment',a.commitmentId);
 if(a.executionId!==e.id||a.campaignId!==c.id||commitment.campaignId!==c.id||commitment.brandId!==c.brandId)throw new ApiError(409,'예산 정산 계보가 일치하지 않습니다.');
 const at=stamp(),actual=Math.max(0,amount-a.previousTotal),next:MetaExecution={...e,version:e.version+1,state:'settled',settledSpend:amount,settledAt:at,...spend,maySpend:false,updatedAt:at,updatedBy:actorId};
 const funding={...commitment,version:(commitment.version??1)+1,commitment:{...commitment.commitment,status:'reconciled' as const,actualAmount:actual,actualLoss:actual,reconciledAt:at}},done={...a,version:a.version+1,settledAt:at,updatedAt:at};
 await database().batch([cas(owner,'meta_ads_execution',e.id,e,next),cas(owner,'growth_commitment',commitment.id,commitment,funding),cas(owner,'meta_budget_amendment',a.id,a,done),history(owner,done)]);
 return next;
}
