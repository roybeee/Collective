import type {Campaign} from './agency';
import {ApiError,acquireLock,releaseLock,database,readRecord,recordStatement,stamp} from './server';
import {deliveryKinds,type DeliveryRow} from './growth-consumer-delivery';
import {reconcileDelivery} from './growth-consumer-delivery-server';
/** Cancellation-only worker. Runs even when new execution is disabled/stopped. No send operation is reachable. */
export async function drainConsumerCancellations(owner:string,limit=10,now=Date.now()){
 if(!Number.isInteger(limit)||limit<1||limit>10)throw new ApiError(400,'취소 처리 한도를 확인하세요.');
 let lock='';try{lock=await acquireLock(owner)}catch(e){if(e instanceof ApiError&&e.status===409)return {attempted:0,completed:0,pending:true,busy:true};throw e}
 let attempted=0,completed=0;const start=Date.now();
 try{
  const found=await database().prepare("SELECT data FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.cancelPending')=1 AND (json_extract(data,'$.cancelRetryAt') IS NULL OR json_extract(data,'$.cancelRetryAt')<=?) ORDER BY updated_at,id LIMIT ?").bind(owner,deliveryKinds.current,new Date(now).toISOString(),limit).all<{data:string}>();
  for(const raw of found.results){if(attempted>=limit||Date.now()-start>=20000)break;const row=JSON.parse(raw.data) as DeliveryRow;
   if(row.cancelRetryAt&&Date.parse(row.cancelRetryAt)>now)continue;
   const at=stamp(),attempts=(row.cancelAttempts??0)+1,next:DeliveryRow={...row,version:row.version+1,cancelAttempts:attempts,cancelRetryAt:new Date(now+Math.min(3600000,30000*2**Math.min(attempts-1,7))).toISOString(),updatedAt:at};
   await database().batch([recordStatement(owner,deliveryKinds.current,row.id,next,row.campaignId),database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${deliveryKinds.history}:${row.id}:${next.version}`,owner,deliveryKinds.history,row.campaignId,JSON.stringify(next),at)]);attempted++;
   try{const c=await readRecord<Campaign>(owner,'campaign',row.campaignId);if(c.brandId!==row.brandId)continue;await reconcileDelivery({owner,id:'consumer-cancellation-worker',role:'admin',email:null},c,{campaignVersion:c.version,expectedVersion:next.version},row.id);const current=await readRecord<DeliveryRow>(owner,deliveryKinds.current,row.id);if(!current.cancelPending)completed++}catch{/* Durable retry remains; no assumption about provider cancellation. */}
  }
  return {attempted,completed,pending:found.results.length>completed};
 }finally{await releaseLock(owner,lock)}
}
