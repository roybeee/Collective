import {actor,secureMutation,body,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {executionRate} from '@/lib/execution-rate';
import {storeGrowthView,storeGrowthAction} from '@/lib/store-growth-server';
export async function GET(req:Request){try{const who=await actor(req);return json(await storeGrowthView(who,str(new URL(req.url).searchParams.get('storeId'),'점포',100,true)))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await actor(req);owner=who.owner;secureMutation(req);const input=await body(req);lock=await acquireLock(owner);await executionRate(owner,'store_growth');return json(await storeGrowthAction(who,input))}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
