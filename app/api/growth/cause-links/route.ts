import type {Campaign} from '@/lib/agency';
import {GrowthCauseLinkError} from '@/lib/growth-cause-links';
import {GrowthExecutionError} from '@/lib/growth-execution';
import {growthCauseLinkView,saveGrowthCauseLink} from '@/lib/growth-cause-links-server';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
const error=(e:unknown)=>failure(e instanceof GrowthCauseLinkError||e instanceof GrowthExecutionError?new ApiError(400,e.message):e);
export async function GET(req:Request){try{const who=await requireAdminActor(req),q=new URL(req.url).searchParams,c=await readRecord<Campaign>(who.owner,'campaign',str(q.get('campaignId'),'캠페인',100,true));return json(await growthCauseLinkView(who,c,{from:q.get('from'),to:q.get('to')}))}catch(e){return error(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthCauseLink(who,c,b))}catch(e){return error(e)}finally{if(lock)await releaseLock(owner,lock)}}
