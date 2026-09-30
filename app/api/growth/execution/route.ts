import type {Campaign} from '@/lib/agency';
import {GrowthExecutionError} from '@/lib/growth-execution';
import {GrowthInventoryError} from '@/lib/growth-inventory';
import {GrowthMissionError} from '@/lib/growth-mission';
import {GrowthReconciliationError} from '@/lib/growth-reconciliation';
import {growthExecutionView,saveGrowthExecution} from '@/lib/growth-execution-server';
import {ApiError,actor,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
export async function GET(req:Request){
 try{const who=await actor(req),id=str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true),campaign=await readRecord<Campaign>(who.owner,'campaign',id);return json(await growthExecutionView(who,campaign));}catch(e){return failure(e);}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{const who=await requireAdminActor(req);secureMutation(req);const input=await body(req);owner=who.owner;lock=await acquireLock(owner);const campaign=await readRecord<Campaign>(owner,'campaign',str(input.campaignId,'캠페인',100,true));return json(await saveGrowthExecution(who,campaign,input));}
 catch(e){return failure(e instanceof GrowthExecutionError||e instanceof GrowthInventoryError||e instanceof GrowthMissionError||e instanceof GrowthReconciliationError?new ApiError(400,e.message):e);}
 finally{if(lock)await releaseLock(owner,lock);}
}
