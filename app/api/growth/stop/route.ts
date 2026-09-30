import {GrowthStopError} from '@/lib/growth-stop';
import {changeGrowthStop,growthStopView} from '@/lib/growth-stop-server';
import {ApiError,actor,requireAdminActor,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
export async function GET(req:Request){try{return json(await growthStopView(await actor(req)))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const input=await body(req);owner=who.owner;lock=await acquireLock(owner);return json(await changeGrowthStop(who,input))}catch(e){return failure(e instanceof GrowthStopError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
