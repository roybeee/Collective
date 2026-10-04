import type {Campaign} from '@/lib/agency';
import {growthBundleFulfillmentView,saveGrowthBundleFulfillment} from '@/lib/growth-bundle-fulfillment-server';
import {GrowthMissionError} from '@/lib/growth-mission';
import {GrowthInventoryError} from '@/lib/growth-inventory';
import {GrowthBundleError} from '@/lib/growth-bundle';
import {GrowthReconciliationError} from '@/lib/growth-reconciliation';
import {GrowthExecutionError} from '@/lib/growth-execution';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
const error=(e:unknown)=>failure(e instanceof GrowthMissionError||e instanceof GrowthInventoryError||e instanceof GrowthBundleError||e instanceof GrowthReconciliationError||e instanceof GrowthExecutionError?new ApiError(400,e.message):e);
export async function GET(req:Request){try{const who=await requireAdminActor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await growthBundleFulfillmentView(who,c))}catch(e){return error(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthBundleFulfillment(who,c,b))}catch(e){return error(e)}finally{if(lock)await releaseLock(owner,lock)}}
