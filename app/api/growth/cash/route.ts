import type {Campaign} from '@/lib/agency';
import {GrowthCashError} from '@/lib/growth-cash';
import {cashQueryPeriod,growthCashView,saveGrowthCash} from '@/lib/growth-cash-server';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
const error=(e:unknown)=>failure(e instanceof GrowthCashError?new ApiError(400,e.message):e);
export async function GET(req:Request){try{const who=await requireAdminActor(req),q=new URL(req.url).searchParams,c=await readRecord<Campaign>(who.owner,'campaign',str(q.get('campaignId'),'캠페인',100,true));return json(await growthCashView(who,c,cashQueryPeriod(q.get('from'),q.get('to'))))}catch(e){return error(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowthCash(who,c,b))}catch(e){return error(e)}finally{if(lock)await releaseLock(owner,lock)}}
