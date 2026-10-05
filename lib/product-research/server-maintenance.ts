import {productResearchQueue} from './server-collect';
import {automaticRetentionEnabled,runRetentionQueue} from './server-retention-actions';

// Retention is independent of collection consent and remains available with both collection flags OFF.
export async function productResearchMaintenanceQueue(owner:string):Promise<((owner:string)=>Promise<{status:'idle'|'processed'}>)|undefined>{
 const collect=await productResearchQueue(owner),retention=await automaticRetentionEnabled(owner);
 if(!collect&&!retention)return undefined;
 return async currentOwner=>{
  if(currentOwner!==owner)return {status:'idle'};
  const result=await runRetentionQueue(owner);
  if(result.status==='processed')return result;
  return collect?collect(owner):{status:'idle'};
 };
}
