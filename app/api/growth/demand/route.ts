import type {Campaign} from '@/lib/agency';
import {GrowthDemandError} from '@/lib/growth-demand';
import {growthDemandView,saveGrowthDemand} from '@/lib/growth-demand-server';
import {ApiError,actor,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),id=str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true),c=await readRecord<Campaign>(who.owner,'campaign',id);return json(await growthDemandView(who,c))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthDemand(who,c,b))}catch(e){return failure(e instanceof GrowthDemandError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
