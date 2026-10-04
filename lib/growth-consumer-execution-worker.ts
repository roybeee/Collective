import type {Campaign} from './agency';
import {ApiError,acquireLock,releaseLock,database,readRecord,recordStatement,stamp} from './server';
import {inCampaign} from './growth-ledger-server';
import {deliveryKinds,deliveryNeedsReceipt,type DeliveryRow} from './growth-consumer-delivery';
import {reconcileDelivery,saveConsumerDelivery} from './growth-consumer-delivery-server';

/** One explicitly owner-approved send OR read-only recovery, under the API's owner lock. */
export async function advanceConsumerDeliveryWork(owner:string,now=Date.now()){
 let token:string;
 try{token=await acquireLock(owner)}catch(e){if(e instanceof ApiError&&e.status===409)return {status:'idle' as const};throw e}
 try{return await advanceLocked(owner,now)}finally{await releaseLock(owner,token)}
}
async function advanceLocked(owner:string,now:number){
 const found=await database().prepare("SELECT data FROM records WHERE owner=? AND kind=? AND COALESCE(json_extract(data,'$.cancelPending'),0)=0 AND (json_extract(data,'$.executionRetryAt') IS NULL OR json_extract(data,'$.executionRetryAt')<=?) AND ((json_extract(data,'$.status')='queued' AND json_extract(data,'$.approval.autoDispatch')=1 AND COALESCE(json_extract(data,'$.suppressed'),0)=0) OR json_extract(data,'$.status') IN ('unknown','accepted') OR (json_extract(data,'$.status') IN ('delivered','failed') AND json_extract(data,'$.receipt') IS NOT NULL AND json_extract(data,'$.receipt.costKrw') IS NULL)) ORDER BY updated_at,id LIMIT 1").bind(owner,deliveryKinds.current,new Date(now).toISOString()).first<{data:string}>();
 if(!found)return {status:'idle' as const};
 const row=JSON.parse(found.data) as DeliveryRow,at=stamp(),attempts=(row.executionAttempts??0)+1;
 const next:DeliveryRow={...row,version:row.version+1,executionAttempts:attempts,executionRetryAt:new Date(now+Math.min(3600000,30000*2**Math.min(attempts-1,7))).toISOString(),updatedAt:at};
 const writes=(value:DeliveryRow)=>[recordStatement(owner,deliveryKinds.current,row.id,value,row.campaignId),recordStatement(owner,deliveryKinds.history,`${row.id}:${value.version}`,value,row.campaignId)];
 // Advance before any dependency lookup: one broken campaign cannot starve the queue.
 await database().batch(writes(next));
 try{
  const c=await readRecord<Campaign>(owner,'campaign',row.campaignId);
  if(!inCampaign(row,c))throw new ApiError(409,'발송 캠페인 범위가 변경되었습니다.');
  const who={owner,id:'consumer-execution-worker',role:'admin' as const,email:null};
  if(deliveryNeedsReceipt(next))await reconcileDelivery(who,c,{campaignVersion:c.version,expectedVersion:next.version},row.id);
  else if(next.status==='queued'&&next.approval?.autoDispatch&&!next.suppressed)await saveConsumerDelivery(who,c,{action:'dispatch',id:row.id,campaignVersion:c.version,expectedVersion:next.version,requestId:crypto.randomUUID()});
 }catch(e){
  if(e instanceof ApiError&&[400,404,409].includes(e.status)){
   const current=await readRecord<DeliveryRow>(owner,deliveryKinds.current,row.id);
   if(current.status==='queued'){
    const held:DeliveryRow={...current,version:current.version+1,approval:null,executionHeld:true,updatedAt:stamp()};
    await database().batch(writes(held));
   }
  }
  // Unknown receipt/cost retains its reservation and its original provider scope.
 }
 return {status:'processed' as const};
}
