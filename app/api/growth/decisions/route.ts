import type {Campaign} from '@/lib/agency';
import {GrowthDecisionsError} from '@/lib/growth-decisions';
import {growthDecisionsView,saveGrowthDecision} from '@/lib/growth-decisions-server';
import {ApiError,actor,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),id=str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true),c=await readRecord<Campaign>(who.owner,'campaign',id);return json(await growthDecisionsView(who,c))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthDecision(who,c,b))}catch(e){return failure(e instanceof GrowthDecisionsError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
