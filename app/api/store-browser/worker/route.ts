import {body,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {authenticateBrowserWorker,browserWorkerAction,BrowserWorkerError} from '@/lib/store-browser-server';
import {executionRate} from '@/lib/execution-rate';
// 짧은 저장 트랜잭션에만 소유자 잠금. 브라우저 작업 중 서버 잠금을 유지하지 않는다.
export async function POST(req:Request){
 let owner='',lock='';
 try{const auth=await authenticateBrowserWorker(req);owner=auth.owner;const input=await body(req);lock=await acquireLock(owner);await executionRate(owner,'store_browser_worker');return json(await browserWorkerAction(auth,input))}
 catch(e){return e instanceof BrowserWorkerError?json({error:e.message,code:e.code},e.status):failure(e)}finally{if(lock)await releaseLock(owner,lock)}
}
