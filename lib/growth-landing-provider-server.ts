import type {Campaign} from './agency';
import type {LandingRecord} from './growth-landing-server';
import type {LandingProviderBinding,LandingProviderAttempt} from './growth-landing-provider';
import type {GrowthAuthorityRecord,GrowthCommitmentRecord} from './growth-authority-server';
import {evaluateAuthority} from './growth-authority';
import {requireGrowthRunning} from './growth-stop-server';
import {GrowthProviderError,growthProviderProductDigest,growthProviderProductUrlMatches,type GrowthProviderReceipt} from './growth-provider';
import {parseReceipt} from './growth-landing';
import {readLandingProviderConnection,landingProviderClient,providerIdentifier,providerProductIdentifier,type LandingProviderConnection} from './growth-provider-credential-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
const currentKind='growth_landing_revision',historyKind='growth_landing_revision_history',requestKind='growth_landing_revision_request';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context={assertCurrent:(row:LandingRecord)=>Promise<void>;contentDigest:(row:LandingRecord)=>Promise<string>};
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function room(owner:string,c:Campaign,kind:string,limit:number,needed=1){const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)+needed>limit)throw new ApiError(409,'판매처 실행 이력 보관 한도에 도달했습니다.');}
function append(owner:string,c:Campaign,kind:string,id:string,data:unknown){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(data),stamp())}
async function persist(who:Actor,c:Campaign,row:LandingRecord,request?:{id:string;digest:string},recovery=false){
 // Soft caps stop NEW work, never the durable result or recovery of existing I/O.
 // Only real recovery transitions use this exception; polling never writes.
 if(!recovery){await room(who.owner,c,historyKind,2000);if(request)await room(who.owner,c,requestKind,5000);}
 await database().batch([recordStatement(who.owner,currentKind,row.id,row,c.id),append(who.owner,c,historyKind,`${row.id}:${row.version}`,row),...(request?[append(who.owner,c,requestKind,request.id,{id:row.id,digest:request.digest,version:row.version})]:[])]);
}
function sameConnection(binding:LandingProviderBinding,connection:LandingProviderConnection){return binding.storeId===connection.storeId&&binding.baseUrl===connection.baseUrl&&binding.tenantId===connection.tenantId&&binding.providerStoreId===connection.providerStoreId;}
async function authorize(who:Actor,c:Campaign,binding:LandingProviderBinding,requestId:string){
 const grant=await readRecord<GrowthAuthorityRecord>(who.owner,'growth_authority',binding.authorityId);
 if(grant.brandId!==c.brandId||grant.campaignId!==c.id||grant.campaignVersion!==c.version||grant.version!==binding.authorityVersion)throw new ApiError(409,'판매처 게시 위임의 정확한 판을 확인하세요.');
 const ledger=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_commitment' LIMIT 10001").bind(who.owner).all<{data:string}>();
 if(ledger.results.length>10000)throw new ApiError(409,'완전한 누적 비용 원장이 필요합니다.');
 const decision=evaluateAuthority(grant.input,{id:binding.productId,operationKey:'landing:'+requestId,brandId:c.brandId,campaignId:c.id,accountId:'mapdal:'+binding.storeId,channel:'storefront',operation:'publish',amount:0,loss:0,budget:'exploration',previousBudget:null,nextBudget:null,evidence:null},ledger.results.map(r=>(JSON.parse(r.data) as GrowthCommitmentRecord).commitment));
 if(!decision.allowed||decision.duplicate)throw new ApiError(409,decision.reasons[0]??'판매처 게시 위임을 확인하세요.');
}
async function currentConnection(who:Actor,c:Campaign,binding?:LandingProviderBinding,write=false){
 const connection=await readLandingProviderConnection(who.owner,c);
 if(!connection)throw new ApiError(409,'판매처 연결이 없습니다.');
 if(binding&&!sameConnection(binding,connection))throw new ApiError(409,'승인한 판매처 연결 범위가 변경되었습니다.');
 if(write&&(!connection.enabled||!connection.installationEvidenceRef||binding?.connectionVersion!==connection.version))throw new ApiError(409,'승인한 판의 판매처 연결과 실제 어댑터 설치 확인이 필요합니다.');
 return connection;
}
async function bind(who:Actor,c:Campaign,row:LandingRecord,b:Record<string,unknown>,ctx:Context){
 if(row.status!=='draft'||row.provider?.attempt)throw new ApiError(409,'시도 이력이 없는 초안만 판매처에 연결합니다.');
 await ctx.assertCurrent(row);await requireGrowthRunning(who.owner);
 const connection=await currentConnection(who,c),productId=providerProductIdentifier(b.productId),authorityId=providerIdentifier(b.authorityId);
 if(!Number.isSafeInteger(b.authorityVersion)||Number(b.authorityVersion)<1)throw new ApiError(400,'위임 판을 확인하세요.');
 if(!growthProviderProductUrlMatches(row.input.landingUrl,connection.baseUrl,productId))throw new ApiError(409,'오퍼 URL과 판매처 상품 ID가 정확히 일치해야 합니다.');
 if(row.input.sections.length!==1||row.input.sections[0].kind!=='purchase_reason')throw new ApiError(409,'판매처 자동 적용은 구매 이유 한 구역의 전체 설명 교체만 지원합니다.');
 const section=row.input.sections[0];await growthProviderProductDigest({version:1,fields:{description:section.after}});
 const client=await landingProviderClient(who.owner,connection),product=await client.read(productId);
 if(product.fields.description!==section.before)throw new ApiError(409,'판매처 현재 설명과 수정안의 현재 문구가 다릅니다.');
 const binding:LandingProviderBinding={storeId:connection.storeId,connectionVersion:connection.version,baseUrl:connection.baseUrl,tenantId:connection.tenantId,providerStoreId:connection.providerStoreId,productId,productVersion:product.version,beforeDigest:product.digest,beforeFields:product.fields,afterFields:{description:section.after},authorityId,authorityVersion:Number(b.authorityVersion),boundAt:stamp(),boundBy:who.id};
 await authorize(who,c,binding,String(b.requestId));
 return {...row,provider:{binding,attempt:null,applyReceipt:null}};
}
async function recoveryBinding(row:LandingRecord){
 const state=row.provider!,approval=state.recoveryApproval;if(!approval)return state.binding;
 const {digest,...signed}=approval;
 if(!state.applyReceipt||approval.originalRequestId!==state.applyReceipt.requestId||approval.expectedDigest!==state.applyReceipt.afterDigest||digest!==await storefrontDigest({originalApproval:row.approval!.digest,...signed}))throw new ApiError(409,'원본 복원 재승인 근거를 확인하세요.');
 return {...state.binding,connectionVersion:approval.connectionVersion,authorityId:approval.authorityId,authorityVersion:approval.authorityVersion};
}
async function dispatchChecks(who:Actor,c:Campaign,row:LandingRecord,ctx:Context,requestId:string,rollback=false){
 const live=await readRecord<Campaign>(who.owner,'campaign',c.id);
 if(live.brandId!==c.brandId||live.storeId!==c.storeId||live.version!==c.version||live.status==='archived')throw new ApiError(409,'운영 캠페인의 현재 판을 확인하세요.');
 await requireGrowthRunning(who.owner);await ctx.assertCurrent(row);
 if(!row.approval||row.approval.digest!==await ctx.contentDigest(row))throw new ApiError(409,'판매처 상품과 문구가 포함된 정확한 승인판이 필요합니다.');
 const binding=rollback?await recoveryBinding(row):row.provider!.binding,connection=await currentConnection(who,c,binding,true);
 await authorize(who,c,binding,requestId);return connection;
}
async function observe(who:Actor,row:LandingRecord,connection:LandingProviderConnection,receipt?:GrowthProviderReceipt){
 const state=row.provider!,attempt=state.attempt!,client=await landingProviderClient(who.owner,connection);
 const found=receipt??await client.receipt(attempt.requestId);
 if(!found)return {...row,provider:{...state,attempt:{...attempt,errorCode:'receipt_not_observed'}}};
 if(found.requestId!==attempt.requestId||found.productId!==state.binding.productId||found.operation!==attempt.operation||found.approvalDigest!==attempt.approvalDigest||found.beforeDigest!==attempt.expectedDigest||(attempt.operation==='rollback'&&found.originalRequestId!==attempt.originalRequestId))throw new GrowthProviderError('unknown','receipt_mismatch');
 const product=await client.read(state.binding.productId);
 const expectedVersion=attempt.operation==='apply'?state.binding.productVersion+1:state.binding.productVersion+2;
 if(product.digest!==found.afterDigest||product.version!==expectedVersion||product.fields.description!==attempt.expectedFields.description)throw new GrowthProviderError('unknown','readback_mismatch');
 const verified={...attempt,status:'verified' as const,receipt:found,verifiedAt:stamp(),errorCode:null};
 const attestation={method:'provider_verified' as const,at:found.at,evidenceRef:'provider-'+found.requestId,observedUrl:row.input.landingUrl,recordedAt:stamp(),recordedBy:who.id,reason:attempt.reason};
 return {...row,status:attempt.operation==='apply'?'applied' as const:'rolled_back' as const,provider:{...state,attempt:verified,applyReceipt:attempt.operation==='apply'?found:state.applyReceipt},...(attempt.operation==='apply'?{applied:attestation}:{rolledBack:attestation})};
}
const acknowledgement=(row:LandingRecord,duplicate=false)=>({recorded:true as const,id:row.id,version:row.version,duplicate,providerStatus:row.provider?.attempt?.status??'bound'});
async function approveRecovery(who:Actor,c:Campaign,row:LandingRecord,b:Record<string,unknown>,ctx:Context,digest:string){
 const state=row.provider!;
 if(b.confirm!==true||row.status!=='applied'||state.attempt?.status!=='verified'||!state.applyReceipt||!row.approval||row.approval.digest!==await ctx.contentDigest(row))throw new ApiError(409,'확인된 기존 적용의 원본 복원만 명시적으로 재승인할 수 있습니다.');
 const connection=await currentConnection(who,c,state.binding);
 if(!connection.enabled||!connection.installationEvidenceRef)throw new ApiError(409,'같은 판매처 연결과 설치 확인을 먼저 켜세요.');
 const authorityId=providerIdentifier(b.authorityId),authorityVersion=Number(b.authorityVersion);
 if(!Number.isSafeInteger(authorityVersion)||authorityVersion<1)throw new ApiError(400,'복원 위임의 현재 판을 확인하세요.');
 await authorize(who,c,{...state.binding,authorityId,authorityVersion},String(b.requestId));
 const product=await (await landingProviderClient(who.owner,connection)).read(state.binding.productId);
 if(product.digest!==state.applyReceipt.afterDigest||product.version!==state.binding.productVersion+1||product.fields.description!==state.binding.afterFields.description)throw new ApiError(409,'적용 이후 판매처 내용이 바뀌어 기존 원본으로 복원할 수 없습니다.');
 const prior=state.recoveryApproval;
 if(prior?.connectionVersion===connection.version&&prior.authorityId===authorityId&&prior.authorityVersion===authorityVersion){await recoveryBinding(row);return acknowledgement(row,true);}
 const signed={connectionVersion:connection.version,authorityId,authorityVersion,originalRequestId:state.applyReceipt.requestId,expectedDigest:state.applyReceipt.afterDigest,by:who.id,at:stamp()};
 const next={...row,provider:{...state,recoveryApproval:{...signed,digest:await storefrontDigest({originalApproval:row.approval.digest,...signed})}},version:row.version+1,updatedAt:stamp(),updatedBy:who.id};
 await persist(who,c,next,{id:String(b.requestId),digest},true);return acknowledgement(next);
}
/** Caller holds the shared owner lease. Intent and request commit before I/O. */
export async function saveLandingProviderAction(who:Actor,c:Campaign,b:Record<string,unknown>,ctx:Context){
 if(who.role!=='owner')throw new ApiError(403,'판매처 실제 변경은 소유자만 실행합니다.');
 const id=providerIdentifier(b.id),requestId=String(b.requestId??''),action=String(b.action);
 if(!uuid.test(requestId)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<1)throw new ApiError(400,'요청 UUID와 수정안 판을 확인하세요.');
 const digest=await storefrontDigest(b),previous=await optional<{digest:string}>(who.owner,requestKind,requestId),row=await readRecord<LandingRecord>(who.owner,currentKind,id);
 if(row.brandId!==c.brandId||row.campaignId!==c.id)throw new ApiError(404,'현재 캠페인의 수정안이 아닙니다.');
 if(previous){if(previous.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return acknowledgement(row,true)}
 if(row.version!==b.expectedVersion)throw new ApiError(409,'수정안이 변경되었습니다. 다시 불러오세요.');
 if(action==='provider_bind'){
  const bound=await bind(who,c,row,b,ctx),next={...bound,version:row.version+1,requestDigest:digest,updatedAt:stamp(),updatedBy:who.id};
  await persist(who,c,next,{id:requestId,digest});return acknowledgement(next);
 }
 const state=row.provider;if(!state)throw new ApiError(409,'승인 전 판매처 상품을 먼저 연결하세요.');
 if(action==='provider_approve_recovery')return approveRecovery(who,c,row,b,ctx,digest);
 if(action==='provider_reconcile'){
  if(!state.attempt||state.attempt.status!=='unknown')throw new ApiError(409,'결과불명 요청만 공급자 영수증으로 대사합니다.');
  const connection=await currentConnection(who,c,state.binding);let next=row;
  try{next=await observe(who,row,connection)}catch{next={...row,provider:{...state,attempt:{...state.attempt,errorCode:'reconciliation_unknown'}}};}
  if(next.provider?.attempt?.status==='unknown')return acknowledgement(row);
  next={...next,version:row.version+1,updatedAt:stamp(),updatedBy:who.id};await persist(who,c,next,{id:requestId,digest},true);return acknowledgement(next);
 }
 if(!['provider_apply','provider_rollback'].includes(action))throw new ApiError(400,'지원하지 않는 판매처 작업입니다.');
 if(b.confirm!==true)throw new ApiError(400,'판매처 실제 변경 확인이 필요합니다.');
 const rollback=action==='provider_rollback';
 if((!rollback&&(row.status!=='approved'||state.attempt))||(rollback&&(row.status!=='applied'||state.attempt?.status!=='verified'||!state.applyReceipt)))throw new ApiError(409,'이미 시도한 요청은 새 전송 없이 결과 조회로 대사하세요.');
 const reason=rollback?parseReceipt({at:stamp(),evidenceRef:requestId,observedUrl:row.input.landingUrl,reason:b.reason}).reason:'';if(rollback&&!reason)throw new ApiError(400,'되돌림 사유를 확인하세요.');
 const connection=await dispatchChecks(who,c,row,ctx,requestId,rollback);
 const attempt:LandingProviderAttempt={requestId,operation:rollback?'rollback':'apply',status:'unknown',expectedDigest:rollback?state.applyReceipt!.afterDigest:state.binding.beforeDigest,expectedFields:rollback?state.binding.beforeFields:state.binding.afterFields,approvalDigest:rollback?await storefrontDigest({approval:row.approval!.digest,recoveryApproval:state.recoveryApproval?.digest??null,requestId,reason,actor:who.id}):row.approval!.digest,...(rollback?{originalRequestId:state.applyReceipt!.requestId}:{}),startedAt:stamp(),reason,errorCode:null,receipt:null,verifiedAt:null};
 let next={...row,provider:{...state,attempt},version:row.version+1,requestDigest:digest,updatedAt:stamp(),updatedBy:who.id};
 // Reserve history space for both intent and observed result before dispatch.
 if(!rollback)await room(who.owner,c,historyKind,2000,2);await persist(who,c,next,{id:requestId,digest},rollback);
 let mutationAccepted=false;
 try{
  await dispatchChecks(who,c,next,ctx,requestId,rollback);
  const client=await landingProviderClient(who.owner,connection);
  const receipt=rollback?await client.rollback({requestId,originalRequestId:attempt.originalRequestId!,expectedDigest:attempt.expectedDigest,approvalDigest:attempt.approvalDigest}):await client.apply({requestId,productId:state.binding.productId,expectedDigest:attempt.expectedDigest,approvalDigest:attempt.approvalDigest,fields:attempt.expectedFields});
  mutationAccepted=true;
  const observed=await observe(who,next,connection,receipt);next={...observed,version:next.version+1,updatedAt:stamp()};
  await persist(who,c,next,undefined,true);return acknowledgement(next);
 }catch(error){
  // If the final local commit fails, the durable unknown intent is authoritative.
  const held=await readRecord<LandingRecord>(who.owner,currentKind,id);
  if(!mutationAccepted&&error instanceof GrowthProviderError&&error.outcome==='rejected'){
   const rejected={...held,provider:{...held.provider!,attempt:{...held.provider!.attempt!,status:'rejected' as const,errorCode:error.code}},version:held.version+1,updatedAt:stamp()};
   await persist(who,c,rejected,undefined,true);return acknowledgement(rejected);
  }
  return acknowledgement(held);
 }
}
