import type {Campaign} from '@/lib/agency';
import {GrowthDemandEvidenceError} from '@/lib/growth-demand-evidence';
import {GrowthExecutionError} from '@/lib/growth-execution';
import {growthDemandEvidenceView,saveGrowthDemandEvidence} from '@/lib/growth-demand-evidence-server';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
const error=(e:unknown)=>failure(e instanceof GrowthDemandEvidenceError||e instanceof GrowthExecutionError?new ApiError(400,e.message):e);
export async function GET(req:Request){try{const who=await requireAdminActor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await growthDemandEvidenceView(who,c))}catch(e){return error(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthDemandEvidence(who,c,b))}catch(e){return error(e)}finally{if(lock)await releaseLock(owner,lock)}}
