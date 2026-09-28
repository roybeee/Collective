import type {Campaign} from './agency';
import type {MetaReservation} from './meta-reservation';
import {metaAdBundleContext,metaAdBundleScope,requireVerifiedMetaAdBundle} from './meta-ad-bundle-server';
import {readMetaWriteConnection,metaWriteToken} from './meta-write-connection';
import {storefrontDigest} from './storefront-orders';
import {isEnabled} from './feature-flags';
import {workerStatus} from './research-worker';
import {ApiError,database,readRecord,stamp,str,acquireLock,releaseLock} from './server';
import {META_KRW_CONTRACT,executionStopReason,type MetaExecution} from './meta-execution';
import {readExecutionHierarchy,readExecutionSpend,writeExecutionStatus,verifyExecutionCurrency} from './meta-execution-provider';
import {runExecutionTransition} from './meta-execution-runner';
export async function executionRecords(owner:string){const r=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='meta_ads_execution' ORDER BY updated_at ASC LIMIT 1001").bind(owner).all<{data:string}>();if(r.results.length>1000)throw new ApiError(409,'실행 기록 조회 한도를 초과했습니다.');return r.results.map(x=>JSON.parse(x.data) as MetaExecution)}
async function connection(owner:string,c:Campaign,accountId:string){const w=await readMetaWriteConnection(owner,c.brandId);if(!w||w.accountId!==accountId||w.brandId!==c.brandId||w.permission!=='ads_management')throw new ApiError(409,'고정된 브랜드·계정의 현재 쓰기 연결이 필요합니다.');return {token:await metaWriteToken(owner,w),fingerprint:await storefrontDigest({version:w.version,updatedAt:w.updatedAt,accountId:w.accountId,secret:w.secret})}}
async function save(owner:string,old:MetaExecution,patch:Partial<MetaExecution>,actorId:string){const next={...old,...patch,version:old.version+1,updatedAt:stamp(),updatedBy:actorId};const r=await database().prepare("UPDATE records SET data=?,updated_at=? WHERE owner=? AND kind='meta_ads_execution' AND id=? AND data=?").bind(JSON.stringify(next),next.updatedAt,owner,`${owner}:meta_ads_execution:${old.id}`,JSON.stringify(old)).run();if(!r.meta.changes)throw new ApiError(409,'다른 요청이 실행 상태를 변경했습니다.');return next}
async function current(owner:string,c:Campaign,e:MetaExecution,activation=false){
 try{const [x,w,r,enabled]=await Promise.all([metaAdBundleContext(owner,c),connection(owner,c,e.scope.accountId),readRecord<MetaReservation>(owner,'meta_ads_reservation',e.reservationId),isEnabled(owner,'meta_ads_execution')]);
 if(!enabled||c.status==='archived'||x.issues.length||!x.saved||x.evidenceFingerprint!==e.bundleEvidence||w.fingerprint!==e.connectionFingerprint||r.state!=='reserved'||r.version!==e.reservationVersion||r.scopeDigest!==e.scopeDigest)return false;
 const s=await metaAdBundleScope(c,x,x.saved.input);if(await storefrontDigest({scope:s,evidenceFingerprint:x.evidenceFingerprint})!==e.scopeDigest)return false;
 if(activation)await verifyExecutionCurrency(w.token,e.scope);
 if(activation&&(Date.now()>=Date.parse(e.activationDeadline)||Date.now()>=Date.parse(e.expiresAt)||!(await workerStatus(owner)).online))return false;return true;
 }catch{return false}
}
export async function viewMetaExecution(owner:string,c:Campaign,canEdit=false){const [records,enabled,worker]=await Promise.all([executionRecords(owner),isEnabled(owner,'meta_ads_execution'),workerStatus(owner)]);return {records:records.filter(e=>e.campaignId===c.id),enabled,canEdit,workerOnline:worker.online,campaignVersion:c.version,maySpend:records.some(e=>e.campaignId===c.id&&e.maySpend),notice:'집계 지연과 일일 예산 초과 게재가 가능하며 로컬 한도는 실제 청구 상한을 보장하지 않습니다. 중단 후 광고비 대조까지 예약을 유지합니다.'}}
export async function approveMetaExecution(owner:string,actorId:string,c:Campaign,b:Record<string,unknown>){
 if(!await isEnabled(owner,'meta_ads_execution')||!(await workerStatus(owner)).online||c.status==='archived')throw new ApiError(409,'실행 기능과 온라인 감시 워커를 확인하세요.');
 const scope=await requireVerifiedMetaAdBundle(owner,c),r=await readRecord<MetaReservation>(owner,'meta_ads_reservation',str(b.reservationId,'예약',100,true)),x=await metaAdBundleContext(owner,c),w=await connection(owner,c,scope.accountId);
 if(b.expectedScopeDigest!==scope.scopeDigest||b.campaignVersion!==c.version||r.campaignId!==c.id||r.brandId!==c.brandId||r.state!=='reserved'||r.scopeDigest!==scope.scopeDigest||r.version!==b.reservationVersion||!scope.sourceBytesVerified||!scope.imageUploadReceiptId)throw new ApiError(409,'현재 예약·검수 원본·광고 구성의 동일성을 확인하세요.');
 const maxSpend=Number(b.maxSpend),expiresAt=str(b.expiresAt,'승인 만료',40,true),end=Date.parse(expiresAt),now=Date.now();
 if(typeof b.maxSpend!=='number'||!Number.isSafeInteger(maxSpend)||maxSpend<=0||maxSpend>r.amount||maxSpend>r.totalBudget-r.safetyReserve||!Number.isSafeInteger(r.lossLimit)||r.lossLimit<=0||scope.dailyBudgetKrw>maxSpend||b.emergencyStopMandate!==true||b.confirmed!==true||!Number.isFinite(end)||end<=now||end>Date.parse(scope.endAt)||Date.parse(scope.startAt)<=now)throw new ApiError(400,'예산·손실 한도·기간·비상 중단 위임을 확인하세요.');
 const records=await executionRecords(owner);if(records.length>=1000)throw new ApiError(409,'실행 기록 한도입니다. 기존 작업 중단·대조만 가능합니다.');if(records.some(e=>e.reservationId===r.id||e.scope.campaignId===scope.campaignId&&!['revoked','settled'].includes(e.state)))throw new ApiError(409,'이 예약이나 외부 캠페인에 이미 실행 기록이 있습니다.');
 await verifyExecutionCurrency(w.token,scope);const statuses=await readExecutionHierarchy(w.token,scope),spend=await readExecutionSpend(w.token,scope);if(Object.values(statuses).some(v=>v!=='PAUSED')||spend.totalSpend!==0)throw new ApiError(409,'아직 집행되지 않은 비활성 광고 구성만 승인할 수 있습니다.');
 const id=await storefrontDigest({reservation:r.id,scope:scope.scopeDigest}),at=stamp(),record:MetaExecution={id,campaignId:c.id,brandId:c.brandId,reservationId:r.id,reservationVersion:r.version,scope,scopeDigest:scope.scopeDigest,bundleEvidence:x.evidenceFingerprint,connectionFingerprint:w.fingerprint,maxSpend,dailyTarget:scope.dailyBudgetKrw,lossLimit:r.lossLimit,safetyReserve:r.safetyReserve,currencyContract:META_KRW_CONTRACT,emergencyStopMandate:true,expiresAt:new Date(end).toISOString(),activationDeadline:new Date(Math.min(now+15*60000,end)).toISOString(),approvedAt:at,approvedBy:actorId,state:'approved',version:1,pending:null,lastObservedAt:at,totalSpend:0,dailySpend:0,stopReason:null,settledSpend:null,settledAt:null,updatedAt:at,updatedBy:actorId,maySpend:false};
 const inserted=await database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:meta_ads_execution:${id}`,owner,'meta_ads_execution',c.id,JSON.stringify(record),at).run();if(!inserted.meta.changes)throw new ApiError(409,'이미 승인된 예약입니다.');return record;
}
export async function transitionMetaExecution(owner:string,actorId:string,c:Campaign,e:MetaExecution,target:'ACTIVE'|'PAUSED'){
 const w=await connection(owner,c,e.scope.accountId);if(target==='ACTIVE'){
  if(e.state!=='approved'||!await current(owner,c,e,true))throw new ApiError(409,'승인 근거가 바뀌었거나 만료되었습니다.');
  await verifyExecutionCurrency(w.token,e.scope);const statuses=await readExecutionHierarchy(w.token,e.scope),spend=await readExecutionSpend(w.token,e.scope);if(Object.values(statuses).some(s=>s!=='PAUSED')||spend.totalSpend!==0)throw new ApiError(409,'외부 비활성 상태·미집행 근거를 다시 확인하세요.');
 }
 let row=e;
 const result=await runExecutionTransition(e,target,{read:()=>readExecutionHierarchy(w.token,e.scope,target==='ACTIVE'),write:(id,status)=>writeExecutionStatus(w.token,id,status)},{async save(p){row=await save(owner,row,p,actorId);return row},current:()=>current(owner,c,row,true)});
 if(result.state==='active'||result.state==='stopped'){try{return await save(owner,result,{...await readExecutionSpend(w.token,e.scope),lastObservedAt:stamp()},actorId)}catch{return save(owner,result,{state:'unknown',maySpend:true,stopReason:'spend_unconfirmed'},actorId)}}return result;
}
export async function actMetaExecution(owner:string,actorId:string,c:Campaign,b:Record<string,unknown>){
 if(b.action==='approve')return approveMetaExecution(owner,actorId,c,b);
 let e=await readRecord<MetaExecution>(owner,'meta_ads_execution',str(b.id,'실행 기록',100,true));if(e.campaignId!==c.id||e.brandId!==c.brandId)throw new ApiError(404,'이 캠페인의 실행 기록이 아닙니다.');if(e.version!==b.expectedVersion)throw new ApiError(409,'실행 판이 변경되었습니다.');if(b.confirmed!==true)throw new ApiError(400,'이 작업을 명시적으로 확인하세요.');
 if(b.action==='activate')return transitionMetaExecution(owner,actorId,c,e,'ACTIVE');
 if(b.action==='stop'){
  if(['settled','revoked'].includes(e.state))return e;
  e=await save(owner,e,{stopReason:'manual_stop'},actorId);return transitionMetaExecution(owner,actorId,c,e,'PAUSED');
 }
 if(b.action==='settle'){
  if(e.state!=='stopped'||e.pending)throw new ApiError(409,'전체 중단을 확인한 뒤 최종 광고비를 대조하세요.');
  const amount=b.settledSpend;if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0||b.billingFinalConfirmed!==true)throw new ApiError(400,'최종 청구 원화 금액과 대조 완료 확인이 필요합니다.');
  const w=await connection(owner,c,e.scope.accountId),s=await readExecutionHierarchy(w.token,e.scope,false),spend=await readExecutionSpend(w.token,e.scope);if(Object.values(s).some(v=>v!=='PAUSED')||amount<spend.totalSpend)throw new ApiError(409,'중단 상태·최종 청구 금액을 다시 확인하세요.');
  return save(owner,e,{state:'settled',settledSpend:amount,settledAt:stamp(),...spend,maySpend:false},actorId);
 }
 throw new ApiError(400,'지원하지 않는 실행 작업입니다.');
}
export async function advanceMetaExecutionWork(owner:string){
 const records=(await executionRecords(owner)).filter(e=>!['settled','revoked','stopped'].includes(e.state)).sort((a,b)=>Number(a.state==='approved')-Number(b.state==='approved')).slice(0,1);let advanced=0,retry=false;
 for(const initial of records){let lock='';try{lock=await acquireLock(owner);let e=await readRecord<MetaExecution>(owner,'meta_ads_execution',initial.id);const c=await readRecord<Campaign>(owner,'campaign',e.campaignId);
  if(e.state==='approved'){if(Date.now()<Date.parse(e.activationDeadline)&&await current(owner,c,e)){await save(owner,e,{},'worker');continue}e=await save(owner,e,{stopReason:'approval_expired_or_stale'},'worker')}
  if(e.state==='active'){
   let reason:string|null=null;try{const w=await connection(owner,c,e.scope.accountId),statuses=await readExecutionHierarchy(w.token,e.scope),spend=await readExecutionSpend(w.token,e.scope);reason=executionStopReason(e,spend,await current(owner,c,e));if(Object.values(statuses).some(s=>s!=='ACTIVE'))reason='external_status_changed';if(!e.lastObservedAt||Date.now()-Date.parse(e.lastObservedAt)>180000)reason='monitor_stale';if(!reason){await save(owner,e,{...spend,lastObservedAt:stamp()},'worker');advanced++;continue}}catch{reason='monitor_unconfirmed'}e=await save(owner,e,{stopReason:reason},'worker');
  }
  await transitionMetaExecution(owner,'worker',c,e,'PAUSED');advanced++;
 }catch{
  retry=true;
  // Advance queue age even on unavailable credentials, so one broken account cannot starve others.
  try{const latest=await readRecord<MetaExecution>(owner,'meta_ads_execution',initial.id);await save(owner,latest,{stopReason:'monitor_retry_required'},'worker')}catch{/* CAS conflict means another caller owns progress. */}
 }finally{if(lock)await releaseLock(owner,lock)}}return {status:retry?'retry' as const:advanced?'processed' as const:'idle' as const};
}
