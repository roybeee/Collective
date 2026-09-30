import {GrowthSettlementError} from '@/lib/growth-settlement';
import type {Campaign} from '@/lib/agency';
import {growthOperationsView,saveGrowthOperations} from '@/lib/growth-operations-server';
import {GrowthInventoryError} from '@/lib/growth-inventory';
import {GrowthOrderBridgeError} from '@/lib/growth-order-bridge';
import {GrowthMissionError} from '@/lib/growth-mission';
import {ApiError,acquireLock,actor,body,failure,json,readRecord,releaseLock,requireAdminActor,secureMutation,str} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await growthOperationsView(who,c))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthOperations(who,c,b))}catch(e){return failure(e instanceof GrowthSettlementError||e instanceof GrowthInventoryError||e instanceof GrowthOrderBridgeError||e instanceof GrowthMissionError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
