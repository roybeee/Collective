import {ApiError,database,recordStatement,stamp,listRecords,readRecord,acquireLock,releaseLock,runtime,purgeExpiredSignals} from './server';
import {researchActive,type BrandResearch} from './archive';
import {recordGatewaySnapshotSafely} from './gateway-snapshot';

// security-ops-4: 토큰 만료·자동 교체는 RESEARCH_WORKER_TOKEN_EXPIRY=enforce일 때만 켠다(기본 꺼짐: 만료 없음, 교체 제안 없음).
// 켜면 새 발급 토큰은 90일에 만료된다. 만료 14일 전부터, 워커가 새 토큰을 저장할 수 있다고 알린 tick(X-Collective-Rotation: ready)의 응답에만
// 다음 토큰(원문은 그 응답에서만, 저장은 해시)을 싣고, 워커가 다음 토큰으로 tick하면 이전 토큰을 지운다. 끄면 저장된 expiresAt도 검사하지 않는다(환경변수 삭제로 되돌림).
// 이 변경 전 설치기로 설치한 워커는 설정 폴더가 읽기 전용이라 교체를 저장하지 못한다(docs/SECURITY-BOUNDARIES.ko.md). 그래서 기본으로 켜지 않는다.
// 설치 파일을 다시 발급할 때 가동 중인 워커가 있으면 그 토큰을 10분 동안 함께 받는다(previous). 이것은 환경변수와 무관하다.
export const WORKER_TOKEN_TTL_MS=90*86400000,WORKER_ROTATE_BEFORE_MS=14*86400000,WORKER_REISSUE_GRACE_MS=10*60000,WORKER_REOFFER_MS=10*60000;
const ONLINE_MS=180000,REJECTION_THROTTLE_MS=60000;
type NextToken={hash:string;createdAt:string;expiresAt:string};
type Credential={hash:string;createdAt:string;expiresAt?:string;next?:NextToken;rotationOfferedAt?:string;previous?:{hashes:string[];until:string}};
type Slot='current'|'next'|'previous';
type RejectReason='expired'|'grace_ended'|'unknown_token'|'gate';
// 사유별 마지막 거부 시각. owner 헤더만 맞춘 요청의 unknown_token이 실제 원인(만료·유예 종료·gate)을 덮지 않게 사유마다 따로 둔다.
type Rejection=Partial<Record<RejectReason,string>>;
// security-ops-7: 사이트 공통 gate 헤더를 앱도 확인한 결과. ok·missing(헤더 없음)·mismatch(값 다름)·unset(앱에 gate 비밀값 없음).
type GateVerdict='ok'|'missing'|'mismatch'|'unset';
type WorkerState={lastSeen:string;version:string;tokenHash:string;lastStatus?:number;lastJob?:string;blocked?:number;lastQueue?:string;gate?:GateVerdict;rotationReady?:boolean;signalPurgeDay?:string};
export async function workerHash(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('')}
async function credential(owner:string){try{return await readRecord<Credential>(owner,'worker_credential','current')}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function optionalRecord<T>(owner:string,kind:string){try{return await readRecord<T>(owner,kind,'current')}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const newToken=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const tokenExpiry=()=>((runtime as {RESEARCH_WORKER_TOKEN_EXPIRY?:string}).RESEARCH_WORKER_TOKEN_EXPIRY||'').trim().toLowerCase()==='enforce';
const expiry=()=>new Date(Date.now()+WORKER_TOKEN_TTL_MS).toISOString();
const issued=async(token:string):Promise<Credential>=>({hash:await workerHash(token),createdAt:stamp(),...(tokenExpiry()?{expiresAt:expiry()}:{})});
const later=(at:string|undefined,now:number)=>!!at&&Date.parse(at)>now;
// 모든 글자를 끝까지 비교해 일치 여부가 시간에 드러나지 않게 한다.
function sameText(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^(b.charCodeAt(i)||0);return diff===0}
// 해시가 어느 슬롯의 유효한 토큰인지, 아니면 왜 거부하는지. 슬롯 비교는 결과와 무관하게 모두 한다.
function matchSlot(saved:Credential|null,hash:string,now:number,expiring=tokenExpiry()):{slot:Slot}|{reason:RejectReason}{
 const current=sameText(hash,saved?.hash||''),next=sameText(hash,saved?.next?.hash||''),previous=(saved?.previous?.hashes||[]).map(h=>sameText(hash,h)).includes(true);
 const alive=(at:string|undefined)=>!expiring||!at||later(at,now);
 if(saved&&current)return alive(saved.expiresAt)?{slot:'current'}:{reason:'expired'};
 if(saved?.next&&next&&alive(saved.next.expiresAt))return {slot:'next'};
 if(saved?.previous&&previous)return later(saved.previous.until,now)?{slot:'previous'}:{reason:'grace_ended'};
 return {reason:'unknown_token'};
}
const appGateEnforced=()=>((runtime as {RESEARCH_WORKER_APP_GATE?:string}).RESEARCH_WORKER_APP_GATE||'').trim().toLowerCase()==='enforce';
// 해시끼리 비교해 길이·내용이 시간에 드러나지 않게 한다. 헤더 값은 저장하지 않는다.
async function gateVerdict(req:Request):Promise<GateVerdict>{
 const expected=runtime.RESEARCH_WORKER_GATE_TOKEN,sent=req.headers.get('oai-sites-authorization');
 if(!expected)return 'unset';if(!sent)return 'missing';
 return sameText(await workerHash(sent),await workerHash('Bearer '+expected))?'ok':'mismatch';
}
// 거부 기록(worker_rejected): 거부된 워커는 신호를 보낼 수 없으므로 앱이 인증 실패를 남긴다. 자격증명이 있는 소유자만, 사유마다 1분에 한 번만 쓴다.
// 조회는 자격증명 유무와 무관하게 해서 owner별 등록 여부가 응답 시간에 덜 드러나게 한다. 기록 실패는 응답(401/403)을 바꾸지 않는다.
async function recordRejection(owner:string,reason:RejectReason,registered:boolean){
 try{
  const last=await optionalRecord<Rejection>(owner,'worker_rejection'),at=last?.[reason];
  if(!registered||at&&Date.now()-Date.parse(at)<REJECTION_THROTTLE_MS)return;
  await recordStatement(owner,'worker_rejection','current',{...last,[reason]:stamp()} satisfies Rejection).run();
 }catch{/* 인증 결과는 그대로 둔다 */}
}
// 화면에는 구체적인 사유(만료·유예 종료·gate) 중 가장 최근 것을 보여 주고, 없을 때만 출처를 확인할 수 없는 unknown_token을 보여 준다.
function shownRejection(r:Rejection|null):{at:string;reason:RejectReason}|null{
 const specific=(['expired','grace_ended','gate'] as const).flatMap(reason=>r?.[reason]?[{at:r[reason]!,reason}]:[]).reduce<{at:string;reason:RejectReason}|null>((a,b)=>!a||b.at>a.at?b:a,null);
 return specific||(r?.unknown_token?{at:r.unknown_token,reason:'unknown_token'}:null);
}
// admin: 만료·회전·거부·gate 상태는 대표·관리자 화면(setup GET canRevoke)에만 내려준다. 일반 멤버에게 gate 강제 여부·디스패처 헤더 전달 여부를 알리지 않는다(workspace는 공개 필드만).
export async function workerStatus(owner:string,{admin=false}:{admin?:boolean}={}){
 const saved=await credential(owner),registered=!!saved;let state:WorkerState|undefined;
 try{state=await readRecord<WorkerState>(owner,'worker_state','current')}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
 if(state?.tokenHash!==saved?.hash)state=undefined;
 const status={registered,activated:registered&&!!state?.lastSeen,online:registered&&!!state?.lastSeen&&Date.now()-Date.parse(state.lastSeen)<ONLINE_MS,lastSeen:state?.lastSeen||null,lastStatus:state?.lastStatus||null,blocked:state?.blocked||0};
 if(!admin)return status;
 const rejection=registered?shownRejection(await optionalRecord<Rejection>(owner,'worker_rejection')):null,now=Date.now(),expiring=tokenExpiry();
 return {...status,expiryEnforced:expiring,issuedAt:saved?.createdAt||null,expiresAt:expiring&&saved?.expiresAt||null,rotationOfferedAt:expiring&&saved?.next?saved.rotationOfferedAt||saved.next.createdAt:null,rotationReady:state?.rotationReady??null,
  graceUntil:saved?.previous&&later(saved.previous.until,now)?saved.previous.until:null,lastRejectedAt:rejection?.at||null,lastRejectedReason:rejection?.reason||null,gate:state?.gate||null,gateEnforced:appGateEnforced()};
}
// 3분 안에 응답한 워커가 쓰는 유효한 토큰과, 그 워커가 이미 받았을 수 있는 다음 토큰.
async function runningHashes(owner:string){
 const saved=await credential(owner),state=await optionalRecord<WorkerState>(owner,'worker_state'),now=Date.now();
 if(!saved||!state||!(now-Date.parse(state.lastSeen)<ONLINE_MS)||'reason' in matchSlot(saved,state.tokenHash,now))return [];
 return [...new Set([state.tokenHash,...(saved.next?[saved.next.hash]:[])])];
}
// audit: 발급·해제 기록(행위자)을 같은 batch에 넣어, 반영된 변경만 기록된다.
// graceIfOnline: 설치 파일 다시 발급. 가동 중인 워커가 있으면 그 토큰을 10분 동안 함께 받는다. 옵션이 없으면 이전 토큰은 바로 무효다.
export async function registerWorker(owner:string,audit:D1PreparedStatement[]=[],options:{graceIfOnline?:boolean}={}){
 const token=newToken(),carried=options.graceIfOnline?await runningHashes(owner):[];
 const saved:Credential={...await issued(token),...(carried.length?{previous:{hashes:carried,until:new Date(Date.now()+WORKER_REISSUE_GRACE_MS).toISOString()}}:{})};
 await database().batch([recordStatement(owner,'worker_credential','current',saved),database().prepare("DELETE FROM records WHERE owner=? AND kind IN ('worker_state','worker_rejection')").bind(owner),...audit]);
 return token;
}
export async function revokeWorker(owner:string,audit:D1PreparedStatement[]=[]){await database().batch([database().prepare("DELETE FROM records WHERE owner=? AND kind IN ('worker_credential','worker_state','worker_rejection')").bind(owner),...audit])}
// 토큰을 먼저 확인한다. 가짜 토큰은 gate와 무관하게 기존 앱 문구의 401이라 운영 점검(scripts/probe-dispatcher-auth.mjs)의 판정이 바뀌지 않는다.
// gate는 기본으로 기록만 하고(tick의 worker_state.gate), RESEARCH_WORKER_APP_GATE=enforce일 때만 403으로 막는다(디스패처가 헤더를 앱까지 넘기는지 먼저 확인).
// rotationReady: 워커가 새 토큰을 저장할 수 있다고 알린 요청(X-Collective-Rotation: ready). 이 신호가 있는 tick에만 다음 토큰을 싣는다.
export async function workerIdentity(req:Request){
 const owner=req.headers.get('x-collective-owner')||'',token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!owner||owner.length>200||!/^[a-f0-9]{64}$/.test(token))throw new ApiError(401,'작업자 인증이 필요합니다.');
 const saved=await credential(owner),hash=await workerHash(token),match=matchSlot(saved,hash,Date.now());
 if('reason' in match){await recordRejection(owner,match.reason,!!saved);throw new ApiError(401,'작업자 연결이 해제됐거나 인증이 만료됐습니다.')}
 const gate=await gateVerdict(req);
 if(gate!=='ok'&&appGateEnforced()){await recordRejection(owner,'gate',true);throw new ApiError(403,'작업자 요청의 사이트 gate 확인에 실패했습니다.')}
 return {owner,hash,gate,rotationReady:req.headers.get('x-collective-rotation')==='ready'};
}
// 다음 토큰으로 온 tick이면 승격하고 이전 토큰·유예를 지운다. 만료가 켜져 있고, 현재 토큰이 만료 14일 안이며, 워커가 저장할 수 있다고 알렸을 때만
// 새 다음 토큰을 만들어 응답에 싣는다. 받지 못했거나 저장하지 못한 워커가 다시 현재 토큰으로 오면 마지막 제안 10분 뒤에야 새 토큰으로 바꿔 다시 보낸다
// (마지막으로 보낸 것만 유효). 그 사이 tick은 쓰기·재전송이 없고, 이미 저장한 워커는 유지된 다음 토큰 해시로 승격된다.
async function rotateCredential(owner:string,saved:Credential,slot:Slot,ready:boolean):Promise<{rotation?:{token:string;expiresAt:string}}>{
 if(slot==='next'&&saved.next){await recordStatement(owner,'worker_credential','current',{hash:saved.next.hash,createdAt:saved.next.createdAt,expiresAt:saved.next.expiresAt} satisfies Credential).run();return {}}
 if(slot!=='current'||!ready||!tokenExpiry()||!saved.expiresAt||Date.parse(saved.expiresAt)-Date.now()>WORKER_ROTATE_BEFORE_MS)return {};
 if(saved.next&&Date.now()-Date.parse(saved.next.createdAt)<WORKER_REOFFER_MS)return {};
 const token=newToken(),next:NextToken={hash:await workerHash(token),createdAt:stamp(),expiresAt:expiry()};
 await recordStatement(owner,'worker_credential','current',{...saved,next,rotationOfferedAt:saved.rotationOfferedAt||next.createdAt} satisfies Credential).run();
 return {rotation:{token,expiresAt:next.expiresAt}};
}
// Rotate work classes so a long research run cannot starve scheduled measurements.
// 반환 status는 설치된 파이썬 워커가 검사하는 ('idle','processed','retry') 안에 머물러야 한다.
export async function workerTick(principal:{owner:string;hash:string;gate?:GateVerdict;rotationReady?:boolean},executeResearch:(owner:string,input:Record<string,any>,timeout:number)=>Promise<Response>,collectDue?:(owner:string)=>Promise<{status:string}>,advanceWork?:(owner:string)=>Promise<{status:string}>){
 const {owner,hash,gate,rotationReady=false}=principal;
 const key=owner+':research-worker',lock=await acquireLock(key);
 try{
  const saved=await credential(owner),match=matchSlot(saved,hash,Date.now());
  if(!saved||'reason' in match)throw new ApiError(401,'작업자 인증이 변경됐습니다.');
  const rotated=await rotateCredential(owner,saved,match.slot,rotationReady);
  const active=(await listRecords<BrandResearch>(owner,'brand_research')).filter(researchActive),blocked=active.filter(r=>r.status==='uncertain'&&!r.retryAt).length;
  const due=active.filter(r=>!r.retryAt||Date.parse(r.retryAt)<=Date.now()).filter(r=>r.status!=='uncertain'||!!r.retryAt).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  let previous:WorkerState|undefined;try{previous=await readRecord<WorkerState>(owner,'worker_state','current')}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
  const job=due[(due.findIndex(r=>r.id===previous?.lastJob)+1)%due.length];
  // F4b-2: 만료 비식별 평가 신호 정리는 소유자당 UTC 하루 1회(만료가 날짜 단위다). 상태에 마지막 정리 날짜를 남겨 같은 날 두 번째 tick부터는 건너뛴다.
  const today=stamp().slice(0,10),purgeSignals=previous?.signalPurgeDay!==today;
  const state={lastSeen:stamp(),version:'1',tokenHash:hash,lastJob:previous?.lastJob,blocked,...(gate?{gate}:{}),rotationReady,signalPurgeDay:today};
  await recordStatement(owner,'worker_state','current',state).run();
  // 게이트웨이 상태 스냅샷(F2b): 소유자당 UTC 하루 1회, 호출당 5초 병렬. 실패해도 예외를 던지지 않아 아래 작업 순환을 막지 않는다.
  await recordGatewaySnapshotSafely(owner);
  // F4b-2: 90일이 지난 비식별 평가 신호를 지운다(문장 1개, 하루 1회). 실패해도 작업 순환을 막지 않고 다음 날 tick·캠페인 삭제가 다시 지운다.
  if(purgeSignals)await purgeExpiredSignals(owner).catch(()=>console.error('deidentified_signal_purge_failed'));
  const queues=['research','execution','measurement'];
  const first=(queues.indexOf(previous?.lastQueue||'')+1)%queues.length;
  for(let offset=0;offset<queues.length;offset++){
   const queue=queues[(first+offset)%queues.length];
   let result:{status:string;httpStatus?:number}|undefined;
   // Persist the turn before external work; a crash must not monopolize the queue.
   const turnState={...state,lastQueue:queue,lastJob:queue==='research'&&job?job.id:state.lastJob};
   await recordStatement(owner,'worker_state','current',turnState).run();
   if(queue==='research'&&job){
    const response=await executeResearch(owner,{id:job.id,action:job.status==='uncertain'?'recover':'advance'},20000);
    result={status:response.ok?'processed':'retry',httpStatus:response.status};
   }else if(queue==='execution'&&advanceWork)result=await advanceWork(owner);
   else if(queue==='measurement'&&collectDue)result=await collectDue(owner);
   if(result&&result.status!=='idle'){
    await recordStatement(owner,'worker_state','current',{...turnState,lastSeen:stamp(),lastStatus:result.httpStatus}).run();
    return {...result,status:result.status==='retry'?'retry':'processed',queue,pending:active.length,blocked,...rotated};
   }
  }
  return {status:'idle',pending:active.length,blocked,...rotated};
 }finally{await releaseLock(key,lock)}
}
