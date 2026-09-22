import {ApiError,database,recordStatement,stamp,listRecords,readRecord,acquireLock,releaseLock} from './server';
import {researchActive,type BrandResearch} from './archive';

type Credential={hash:string;createdAt:string};
type WorkerState={lastSeen:string;version:string;tokenHash:string;lastStatus?:number;lastJob?:string;blocked?:number};
export async function workerHash(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('')}
async function credential(owner:string){try{return await readRecord<Credential>(owner,'worker_credential','current')}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
export async function workerStatus(owner:string){
 const saved=await credential(owner),registered=!!saved;let state:WorkerState|undefined;
 try{state=await readRecord<WorkerState>(owner,'worker_state','current')}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
 if(state?.tokenHash!==saved?.hash)state=undefined;
 return {registered,activated:registered&&!!state?.lastSeen,online:registered&&!!state?.lastSeen&&Date.now()-Date.parse(state.lastSeen)<180000,lastSeen:state?.lastSeen||null,lastStatus:state?.lastStatus||null,blocked:state?.blocked||0};
}
export async function registerWorker(owner:string){
 const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 await database().batch([recordStatement(owner,'worker_credential','current',{hash:await workerHash(token),createdAt:stamp()}),database().prepare('DELETE FROM records WHERE owner=? AND kind=?').bind(owner,'worker_state')]);
 return token;
}
export async function revokeWorker(owner:string){await database().prepare("DELETE FROM records WHERE owner=? AND kind IN ('worker_credential','worker_state')").bind(owner).run()}
export async function workerIdentity(req:Request){
 const owner=req.headers.get('x-collective-owner')||'',token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!owner||owner.length>200||!/^[a-f0-9]{64}$/.test(token))throw new ApiError(401,'작업자 인증이 필요합니다.');
 const saved=await credential(owner),hash=await workerHash(token);let diff=0;
 for(let i=0;i<64;i++)diff|=hash.charCodeAt(i)^(saved?.hash||'0'.repeat(64)).charCodeAt(i);
 if(!saved||diff!==0)throw new ApiError(401,'작업자 연결이 해제됐거나 인증이 만료됐습니다.');
 return {owner,hash};
}
// collectDue는 성과 자동 수집이다. 조사 작업이 없을 때만 진행한다.
// 반환 status는 설치된 파이썬 워커가 검사하는 ('idle','processed','retry') 안에 머물러야 한다.
export async function workerTick(principal:{owner:string;hash:string},executeResearch:(owner:string,input:Record<string,any>,timeout:number)=>Promise<Response>,collectDue?:(owner:string)=>Promise<{status:string}>){
 const {owner,hash}=principal;
 const key=owner+':research-worker',lock=await acquireLock(key);
 try{
  if((await credential(owner))?.hash!==hash)throw new ApiError(401,'작업자 인증이 변경됐습니다.');
  const active=(await listRecords<BrandResearch>(owner,'brand_research')).filter(researchActive),blocked=active.filter(r=>r.status==='uncertain'&&!r.retryAt).length;
  const due=active.filter(r=>!r.retryAt||Date.parse(r.retryAt)<=Date.now()).filter(r=>r.status!=='uncertain'||!!r.retryAt).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  let previous:WorkerState|undefined;try{previous=await readRecord<WorkerState>(owner,'worker_state','current')}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
  const job=due[(due.findIndex(r=>r.id===previous?.lastJob)+1)%due.length];
  const state={lastSeen:stamp(),version:'1',tokenHash:hash,lastJob:job?.id||previous?.lastJob,blocked};
  await recordStatement(owner,'worker_state','current',state).run();
  if(!job){
   const collected=collectDue?await collectDue(owner):null;
   const status=collected?.status==='processed'||collected?.status==='retry'?collected.status:'idle';
   return {status,pending:active.length,blocked};
  }
  const response=await executeResearch(owner,{id:job.id,action:job.status==='uncertain'?'recover':'advance'},20000);
  await recordStatement(owner,'worker_state','current',{...state,lastSeen:stamp(),lastStatus:response.status}).run();
  return {status:response.ok?'processed':'retry',httpStatus:response.status,pending:active.length,blocked};
 }finally{await releaseLock(key,lock)}
}
