import {failure,acquireLock,releaseLock} from '@/lib/server';
import {executionRate} from '@/lib/execution-rate';
import {authenticateBrowserWorker,browserWorkerAsset} from '@/lib/store-browser-server';
export async function GET(req:Request){
 let owner='',lock='';
 try{
  const auth=await authenticateBrowserWorker(req);owner=auth.owner;lock=await acquireLock(owner);await executionRate(owner,'store_browser_asset');await releaseLock(owner,lock);lock='';
  const url=new URL(req.url),asset=await browserWorkerAsset(auth,{jobId:url.searchParams.get('jobId'),attemptId:url.searchParams.get('attemptId'),leaseToken:req.headers.get('x-browser-lease-token')});
  return new Response(asset.bytes,{headers:{'Content-Type':asset.mime,'Content-Length':String(asset.size),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}
}
