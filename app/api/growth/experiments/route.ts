import type {Campaign} from '@/lib/agency';
import {GrowthExperimentError} from '@/lib/growth-experiment';
import {growthExperimentView,saveGrowthExperiment} from '@/lib/growth-experiment-server';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
const error=(e:unknown)=>failure(e instanceof GrowthExperimentError?new ApiError(400,e.message):e);
export async function GET(req:Request){try{const who=await requireAdminActor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await growthExperimentView(who,c))}catch(e){return error(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthExperiment(who,c,b))}catch(e){return error(e)}finally{if(lock)await releaseLock(owner,lock)}}
