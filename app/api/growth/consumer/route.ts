import type {Campaign} from '@/lib/agency';
import {GrowthConsumerError,parseWaitDays} from '@/lib/growth-consumer';
import {growthConsumerView,saveGrowthConsumer} from '@/lib/growth-consumer-server';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
export async function GET(req:Request){try{const who=await requireAdminActor(req),q=new URL(req.url).searchParams,c=await readRecord<Campaign>(who.owner,'campaign',str(q.get('campaignId'),'캠페인',100,true));return json(await growthConsumerView(who,c,parseWaitDays(q.has('waitDays')?Number(q.get('waitDays')):30)))}catch(e){return failure(e instanceof GrowthConsumerError?new ApiError(400,e.message):e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthConsumer(who,c,b))}catch(e){return failure(e instanceof GrowthConsumerError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
