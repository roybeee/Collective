import {identity,actor,secureMutation,body,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {listStoreBrowser,storeBrowserAction} from '@/lib/store-browser-server';
import {executionRate} from '@/lib/execution-rate';
export async function GET(req:Request){try{return json(await listStoreBrowser(await identity(req),str(new URL(req.url).searchParams.get('storeId')??'','지점',100,true)))}catch(e){return failure(e)}}
export async function POST(req:Request){
 let owner='',lock='';
 try{const who=await actor(req);owner=who.owner;secureMutation(req);const input=await body(req);lock=await acquireLock(owner);await executionRate(owner,'store_browser');return json(await storeBrowserAction(owner,input,who))}
 catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}
}
