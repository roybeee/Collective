import {csDeliveryEvidence,csResponseStatements} from './growth-cs-source-server';
import type {Campaign} from './agency';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
import {appendRow,campaignRows,inCampaign,versionedMutation} from './growth-ledger-server';
import {growthConsumerView} from './growth-consumer-server';
import {storefrontDigest} from './storefront-orders';
import {evaluateAuthority} from './growth-authority';
import {requireGrowthRunning} from './growth-stop-server';
import {deliveryAction,deliveryKinds,deliveryNeedsReceipt,deliveryUuid,parseDeliveryInput,type DeliveryAuthority,type DeliveryCommitment,type DeliveryInput,type DeliveryReceipt,type DeliveryRow} from './growth-consumer-delivery';
import {configureDelivery,deliveryConnection,deliverySecret,publicDeliveryConnection} from './growth-consumer-delivery-config';
import {consumerDeliveryProvider} from './growth-consumer-delivery-provider';
export async function consumerDeliveryView(who:Actor,c:Campaign){return {campaignVersion:c.version,connection:publicDeliveryConnection(await deliveryConnection(who.owner,c,true)),deliveries:await campaignRows<DeliveryRow>(who.owner,c,deliveryKinds.current,500)}}
async function snapshot(who:Actor,c:Campaign,id:string,input:DeliveryInput,existingCommitmentId?:string){
 if(c.status==='archived'||Date.parse(input.expiresAt)<=Date.now())throw new ApiError(409,'보관되었거나 발송 승인이 만료되었습니다.');
 const evidence=await deliveryEvidence(who,c,input);
 const connection=await deliveryConnection(who.owner,c);if(!connection?.enabled)throw new ApiError(409,'소유자가 발송 연결을 활성화해야 합니다.');
 const authority=await readRecord<DeliveryAuthority>(who.owner,'growth_authority',input.authorityId);
 if(!inCampaign(authority,c)||authority.version!==input.authorityVersion||authority.campaignVersion!==c.version)throw new ApiError(409,'위임 판이 변경되었습니다.');
 await requireGrowthRunning(who.owner);
 const ledger=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_commitment' LIMIT 10001").bind(who.owner).all<{data:string}>();if(ledger.results.length>10000)throw new ApiError(409,'예산 원장 전체 대사가 필요합니다.');
 const scope={tenantId:connection.tenantId,providerStoreId:connection.providerStoreId,storeId:connection.storeId,...(input.purpose==='service_reply'?{mode:'cs' as const}:{})},action=deliveryAction({id,brandId:c.brandId,campaignId:c.id},input,scope),decision=evaluateAuthority(authority.input,action,ledger.results.map(r=>JSON.parse(r.data) as DeliveryCommitment).filter(r=>r.id!==existingCommitmentId).map(r=>r.commitment));
 if(!decision.allowed||decision.duplicate)throw new ApiError(409,'현재 위임·기간·예산이 발송을 허용하지 않습니다.');
 const consentDigest=evidence.digest,payload={requestId:id,recipientId:evidence.customer.id,purpose:input.purpose,templateId:input.templateId,templateDigest:input.templateDigest,maxCostKrw:input.maxCostKrw,expiresAt:input.expiresAt,consentDigest,...(input.serviceContext?{serviceContext:input.serviceContext}:{})};
 const digest=await storefrontDigest({campaign:c,evidence:evidence.evidence,connection:{...scope,version:connection.version},authority,input,payload});
 return {digest,scope,payload,authority,action,connection};
}
async function writeReceipt(who:Actor,c:Campaign,row:DeliveryRow,receipt:DeliveryReceipt|null){
 if(!receipt)return {recorded:true,id:row.id,version:row.version,status:row.status,ambiguous:true};
 if(['delivered','failed'].includes(row.status)&&receipt.status!==row.status)throw new ApiError(409,'완료된 발송을 이전 상태로 바꿀 수 없습니다.');
 if(row.receipt?.receiptId===receipt.receiptId)return {recorded:true,id:row.id,version:row.version,duplicate:true};
 const at=stamp(),cs=receipt.status==='delivered'?await csResponseStatements(who,c,row,at,receipt.at):{statements:[],held:false},next:DeliveryRow={...row,version:row.version+1,status:receipt.status,receipt,csResponseHeld:cs.held,cancelPending:row.cancelPending&&receipt.status==='accepted',updatedAt:at};
 const statements=[...cs.statements,recordStatement(who.owner,deliveryKinds.current,row.id,next,c.id),appendRow(who.owner,c,deliveryKinds.history,`${row.id}:${next.version}`,next,at)];
 if(row.commitmentId&&receipt.status!=='accepted'&&receipt.costKrw!==null){const commitment=await readRecord<DeliveryCommitment>(who.owner,'growth_commitment',row.commitmentId);if(!inCampaign(commitment,c))throw new ApiError(409,'예산 범위가 다릅니다.');statements.push(recordStatement(who.owner,'growth_commitment',commitment.id,{...commitment,commitment:{...commitment.commitment,status:receipt.costKrw===0?'released':'reconciled',actualAmount:receipt.costKrw,actualLoss:receipt.costKrw,reconciledAt:at}},c.id))}
 await database().batch(statements);return {recorded:true,id:row.id,version:next.version,status:next.status};
}
function fields(b:Record<string,unknown>){const allowed:Record<string,string[]>={configure:['config'],queue:['id','input'],approve:['id','confirm','autoDispatch'],dispatch:['id'],reconcile:['id'],cancel:['id']};if(!allowed[String(b.action)]||Object.keys(b).some(k=>!['action','campaignId','campaignVersion','expectedVersion','requestId',...allowed[String(b.action)]].includes(k)))throw new ApiError(400,'지원하지 않는 작업 또는 개인정보 필드입니다.')}
export async function saveConsumerDelivery(who:Actor,c:Campaign,b:Record<string,unknown>){
 fields(b);if(b.autoDispatch!==undefined&&typeof b.autoDispatch!=='boolean')throw new ApiError(400,'자동 발송 승인 여부를 확인하세요.');if(!deliveryUuid(b.requestId))throw new ApiError(400,'무작위 요청 UUID가 필요합니다.');
 if(b.action==='configure')return configureDelivery(who,c,b);
 if(!deliveryUuid(b.id))throw new ApiError(400,'무작위 발송 UUID가 필요합니다.');const id=b.id;
 if(b.action==='reconcile')return reconcileDelivery(who,c,b,id);
 if(b.action==='approve'&&who.role!=='owner')throw new ApiError(403,'소유자만 발송을 승인할 수 있습니다.');
 const input=b.action==='queue'?parseDeliveryInput(b.input):null;
 const result=await versionedMutation<DeliveryRow>(who,c,b,deliveryKinds,id,{action:b.action,input,confirm:b.confirm??false,autoDispatch:b.autoDispatch??false},async(old,at)=>{
  if(b.action==='queue'){
   if(old)throw new ApiError(409,'이미 등록된 발송입니다.');if(c.status==='archived'||Date.parse(input!.expiresAt)<=Date.now())throw new ApiError(409,'현재 발송 자격이 없습니다.');await deliveryEvidence(who,c,input!);
   return {next:{id,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,version:1,customerId:input!.customerId,input,status:'queued',approval:null,payload:null,payloadDigest:null,providerScope:null,maxCostKrw:input!.maxCostKrw,commitmentId:null,suppressed:false,cancelPending:false,receipt:null,createdAt:at,updatedAt:at}};
  }
  if(!old)throw new ApiError(404,'발송 기록이 없습니다.');
  if(b.action==='cancel')return {recovery:true,next:{...old,version:old.version+1,status:old.status==='queued'?'failed':old.status,suppressed:true,cancelPending:['unknown','accepted'].includes(old.status),updatedAt:at}};
  if(old.status!=='queued'||old.suppressed||!old.input)throw new ApiError(409,'이미 실행되었거나 억제된 발송은 다시 보낼 수 없습니다.');
  const current=await snapshot(who,c,id,old.input);
  if(b.action==='approve'){
   if(b.confirm!==true)throw new ApiError(400,'불변 발송 내용의 확인이 필요합니다.');
   return {next:{...old,version:old.version+1,approval:{snapshotDigest:current.digest,approvedBy:who.id,approvedAt:at,autoDispatch:b.autoDispatch===true},executionHeld:false,executionRetryAt:undefined,payload:current.payload,payloadDigest:await storefrontDigest(current.payload),providerScope:current.scope,updatedAt:at}};
  }
  if(!old.approval||old.approval.snapshotDigest!==current.digest||!old.payload||!old.payloadDigest)throw new ApiError(409,'승인 후 동의·주문·연결·위임이 변경되었습니다. 다시 승인하세요.');
  const commitmentId=`consumer-delivery-${id}`,commitment:DeliveryCommitment={id:commitmentId,brandId:c.brandId,campaignId:c.id,authorityId:current.authority.id,authorityVersion:current.authority.version,authorityApprovalId:current.authority.input.ownerApprovalId,authoritySnapshot:current.authority.input,missionId:'',missionVersion:0,commitment:{authorityId:current.authority.id,action:current.action,status:'unknown',at,reservedAmount:old.maxCostKrw,reservedLoss:old.maxCostKrw,actualAmount:null,actualLoss:null},createdAt:at,createdBy:who.id};
  return {next:{...old,version:old.version+1,status:'unknown',commitmentId,updatedAt:at},extra:[appendRow(who.owner,c,'growth_commitment',commitmentId,commitment,at)]};
 });
 if(b.action!=='dispatch'||result.duplicate)return result;
 const row=await readRecord<DeliveryRow>(who.owner,deliveryKinds.current,id),connection=await deliveryConnection(who.owner,c);
 if(!connection||!row.providerScope||!row.payload||!row.payloadDigest)return {...result,ambiguous:true};
 const receipt=await consumerDeliveryProvider('send',row.providerScope,await deliverySecret(who.owner,connection),id,row.payloadDigest,row.maxCostKrw,row.payload);
 return writeReceipt(who,c,row,receipt);
}
export async function reconcileDelivery(who:Actor,c:Campaign,b:Record<string,unknown>,id:string){
 const row=await readRecord<DeliveryRow>(who.owner,deliveryKinds.current,id);if(!inCampaign(row,c))throw new ApiError(404,'현재 캠페인의 발송이 아닙니다.');
 if(c.version!==b.campaignVersion||row.version!==b.expectedVersion)throw new ApiError(409,'현재 판을 다시 불러오세요.');
 if(!deliveryNeedsReceipt(row)||!row.providerScope||!row.payloadDigest)throw new ApiError(409,'조회할 미확정 발송이 없습니다.');
 const connection=await deliveryConnection(who.owner,c,true);if(!connection||connection.storeId!==row.providerScope.storeId||connection.tenantId!==row.providerScope.tenantId||connection.providerStoreId!==row.providerScope.providerStoreId)throw new ApiError(409,'원래 제공자 연결에서 영수증을 대사하세요.');
 const receipt=await consumerDeliveryProvider(row.cancelPending?'cancel':'receipt',row.providerScope,await deliverySecret(who.owner,connection),id,row.payloadDigest,row.maxCostKrw);
 return writeReceipt(who,c,row,receipt);
}

/** Provider calls immediately before its one transport claim; never a reusable authorization lease. */
export async function currentConsumerAuthorization(who:Actor,c:Campaign,row:DeliveryRow){
 if(!inCampaign(row,c)||row.suppressed||row.cancelPending||!['unknown','accepted'].includes(row.status)||!row.input||!row.payload||!row.providerScope||!row.approval||!row.commitmentId)return false;
 const commitment=await readRecord<DeliveryCommitment>(who.owner,'growth_commitment',row.commitmentId);
 if(!inCampaign(commitment,c)||commitment.authorityId!==row.input.authorityId||commitment.authorityVersion!==row.input.authorityVersion||await storefrontDigest(commitment.commitment.action)!==await storefrontDigest(deliveryAction(row,row.input,row.providerScope))||commitment.commitment.action.id!==row.id||!['unknown','reserved'].includes(commitment.commitment.status)||commitment.commitment.reservedAmount!==row.maxCostKrw||commitment.commitment.reservedLoss!==row.maxCostKrw)return false;
 try{const current=await snapshot(who,c,row.id,row.input,row.commitmentId);return current.digest===row.approval.snapshotDigest&&await storefrontDigest(current.payload)===row.payloadDigest}catch(e){if(e instanceof ApiError&&[400,404,409].includes(e.status))return false;throw e}
}

async function deliveryEvidence(who:Actor,c:Campaign,input:DeliveryInput){
 if(input.purpose==='service_reply')return csDeliveryEvidence(who,c,input);
 const view=await growthConsumerView(who,c,input.waitDays),customer=view.customers.find(x=>x.id===input.customerId);
 if(!customer||customer.version!==input.customerVersion||!(input.purpose==='post_purchase'?customer.assessment.postPurchaseEligible:customer.assessment.reorderEligible))throw new ApiError(409,'현재 고객·동의·매장·주문 판의 발송 자격이 없습니다.');
 return {customer,evidence:{customer,orders:view.orders.filter(o=>customer.links.some(l=>l.orderId===o.id))},digest:await storefrontDigest(customer.consents)};
}
