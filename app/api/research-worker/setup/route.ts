import {ApiError,body,identity,secureMutation,json,failure,runtime,connection,acquireLock,releaseLock,assertNoActiveJobs} from '@/lib/server';
import {workerStatus,registerWorker,revokeWorker} from '@/lib/research-worker';
import installer from '@/server/research-worker/install.py?raw';
import worker from '@/server/research-worker/worker.py?raw';
const hex=(value:string)=>Array.from(new TextEncoder().encode(value),b=>b.toString(16).padStart(2,'0')).join('');
const installerAdmin=(owner:string)=>(runtime.RESEARCH_WORKER_ADMIN_IDS||'').split(',').map(id=>id.trim()).filter(Boolean).includes(owner);
export async function GET(req:Request){try{const owner=identity(req);return json({...await workerStatus(owner),canInstall:installerAdmin(owner)&&!!runtime.RESEARCH_WORKER_GATE_TOKEN&&!!runtime.RESEARCH_WORKER_SITE_ORIGIN})}catch(e){return failure(e)}}
export async function POST(req:Request){let key='',lock='',ownerLock='',owner='';try{
 secureMutation(req);owner=identity(req);const input=await body(req);
 if(input.action==='download'&&!installerAdmin(owner))throw new ApiError(403,'서버 설치 파일은 지정된 관리자만 받을 수 있습니다.');
 ownerLock=await acquireLock(owner);key=owner+':research-worker';lock=await acquireLock(key);
 if(input.action==='revoke'){await revokeWorker(owner);return json({revoked:true})}
 if(input.action!=='download')throw new ApiError(400,'지원하지 않는 작업자 설정입니다.');
 if(!runtime.RESEARCH_WORKER_GATE_TOKEN||!runtime.RESEARCH_WORKER_SITE_ORIGIN)throw new ApiError(503,'서버 설치 연결을 준비 중입니다.');
 const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'HERMES를 먼저 연결하세요.');
 await assertNoActiveJobs(owner);
 const site=new URL(runtime.RESEARCH_WORKER_SITE_ORIGIN);if(site.protocol!=='https:'||site.username||site.password)throw new ApiError(503,'서버 설치 주소를 확인하세요.');
 const token=await registerWorker(owner);
 const result=installer.replace('__COLLECTIVE_CONFIG_HEX__',hex(JSON.stringify({site:site.origin,owner,token,gate:runtime.RESEARCH_WORKER_GATE_TOKEN}))).replace('__COLLECTIVE_WORKER_HEX__',hex(worker));
 return new Response(result,{headers:{'Content-Type':'text/x-python; charset=utf-8','Content-Disposition':'attachment; filename="install-collective-server.py"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return failure(e)}finally{if(lock)await releaseLock(key,lock);if(ownerLock)await releaseLock(owner,ownerLock)}}
