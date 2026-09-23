import {actor,requireAdminActor,ApiError,body,secureMutation,json,failure,runtime,connection,acquireLock,releaseLock,assertNoActiveJobs,recordStatement,listRecords,stamp,uid,type Actor} from '@/lib/server';
import {workerStatus,registerWorker,revokeWorker} from '@/lib/research-worker';
import installer from '@/server/research-worker/install.py?raw';
import worker from '@/server/research-worker/worker.py?raw';
const hex=(value:string)=>Array.from(new TextEncoder().encode(value),b=>b.toString(16).padStart(2,'0')).join('');
// 설치 파일은 개인 단위로 허용한다. 목록에 본인 사용자 ID가 있거나, 대표(owner) 본인이고 기존 운영 설정처럼 워크스페이스 owner ID가 목록에 있을 때만.
const installerAdmin=(who:Actor)=>{const ids=(runtime.RESEARCH_WORKER_ADMIN_IDS||'').split(',').map(id=>id.trim()).filter(Boolean);return ids.includes(who.id)||who.role==='owner'&&ids.includes(who.owner)};
// 접속 대상(sudo 사용자@호스트)은 설치 권한자에게만 내려준다. 형식이 맞지 않으면 화면에서 자리표시자를 쓴다.
const sshTarget=()=>{const value=((runtime as {RESEARCH_WORKER_SSH_TARGET?:string}).RESEARCH_WORKER_SSH_TARGET||'').trim();return /^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,253}$/.test(value)?value:null};
// 설치 파일 발급·작업자 연결 해제 기록. 누가 언제 했는지 관리자 화면에 마지막 발급자·해제자로 보여 준다.
type WorkerEvent={action:'download'|'revoke';actor:{id:string;email:string|null};createdAt:string};
const workerEvent=(who:Actor,action:WorkerEvent['action'])=>recordStatement(who.owner,'worker_event',uid(),{action,actor:{id:who.id,email:who.email},createdAt:stamp()} satisfies WorkerEvent);
async function lastEvents(owner:string){const events=await listRecords<WorkerEvent>(owner,'worker_event');const last=(action:WorkerEvent['action'])=>{const e=events.find(x=>x.action===action);return e?{email:e.actor.email,at:e.createdAt}:null};return {lastIssued:last('download'),lastRevoked:last('revoke')}}
// 연결 해제는 설치 목록과 무관하게 대표·관리자에게 허용한다(canRevoke). 설치·다시 발급만 목록으로 판정한다(canInstall).
export async function GET(req:Request){try{const who=await actor(req),canRevoke=who.role!=='member',canInstall=canRevoke&&installerAdmin(who)&&!!runtime.RESEARCH_WORKER_GATE_TOKEN&&!!runtime.RESEARCH_WORKER_SITE_ORIGIN;return json({...await workerStatus(who.owner,{admin:canRevoke}),canInstall,canRevoke,...(canRevoke?await lastEvents(who.owner):{}),...(canInstall?{sshTarget:sshTarget()}:{})})}catch(e){return failure(e)}}
export async function POST(req:Request){let key='',lock='',ownerLock='',owner='';try{
 secureMutation(req);const who=await requireAdminActor(req);owner=who.owner;const input=await body(req);
 if(input.action==='download'&&!installerAdmin(who))throw new ApiError(403,'서버 설치 파일은 지정된 관리자만 받을 수 있습니다.');
 ownerLock=await acquireLock(owner);key=owner+':research-worker';lock=await acquireLock(key);
 if(input.action==='revoke'){await revokeWorker(owner,[workerEvent(who,'revoke')]);return json({revoked:true})}
 if(input.action!=='download')throw new ApiError(400,'지원하지 않는 작업자 설정입니다.');
 if(!runtime.RESEARCH_WORKER_GATE_TOKEN||!runtime.RESEARCH_WORKER_SITE_ORIGIN)throw new ApiError(503,'서버 설치 연결을 준비 중입니다.');
 const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'HERMES를 먼저 연결하세요.');
 await assertNoActiveJobs(owner);
 const site=new URL(runtime.RESEARCH_WORKER_SITE_ORIGIN);if(site.protocol!=='https:'||site.username||site.password)throw new ApiError(503,'서버 설치 주소를 확인하세요.');
 // 가동 중인 워커가 있으면 이전 토큰을 10분 동안 함께 받는다(security-ops-4). 즉시 멈추려면 먼저 연결 해제(revoke)한다.
 const token=await registerWorker(owner,[workerEvent(who,'download')],{graceIfOnline:true});
 const result=installer.replace('__COLLECTIVE_CONFIG_HEX__',hex(JSON.stringify({site:site.origin,owner,token,gate:runtime.RESEARCH_WORKER_GATE_TOKEN}))).replace('__COLLECTIVE_WORKER_HEX__',hex(worker));
 return new Response(result,{headers:{'Content-Type':'text/x-python; charset=utf-8','Content-Disposition':'attachment; filename="install-collective-server.py"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return failure(e)}finally{if(lock)await releaseLock(key,lock);if(ownerLock)await releaseLock(owner,ownerLock)}}
