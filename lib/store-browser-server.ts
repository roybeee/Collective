import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str,uid,type Actor} from './server';
import {isEnabled} from './feature-flags';
import type {ArchiveSource} from './archive';
import {weeklySchedule,weeklyCanonical} from './store-browser-hours';
import {approvedPhoto,revalidatePhoto,savePhotoRights,revokePhotoRights} from './store-browser-photo-server';
import {browserPublicUrl,publicReadback} from './store-browser-public';
import type {Store} from './store-marketing';
import type {BrowserBinding,BrowserDevice,BrowserEvidence,BrowserJob,BrowserListing,BrowserPhotoRights,BrowserHealth} from './store-browser';

type StoredDevice=BrowserDevice&{owner:string;tokenHash:string};
export type BrowserWorkerIdentity={owner:string;deviceId:string;profileId:string};
export class BrowserWorkerError extends ApiError{constructor(public code:'NO_JOB'|'DEVICE_BUSY',message:string){super(409,message)}}
const isRead=(job:BrowserJob)=>job.type==='read_hours'||job.type==='read_weekly_hours';
const leaseMs=5*60*1000,approvalMs=24*60*60*1000;
const admin=(who:Pick<Actor,'role'>)=>{if(who.role==='member')throw new ApiError(403,'대표·관리자만 변경할 수 있습니다.')};
const conflict=(message:string)=>{throw new ApiError(409,message)};
const version=(old:{version:number},input:Record<string,unknown>)=>{if(input.expectedVersion!==old.version)conflict('판이 바뀌었습니다. 새로고침하세요.')};
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return undefined;throw e}}
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')}
const publicDevice=(device:StoredDevice):BrowserDevice=>({id:device.id,label:device.label,profileId:device.profileId,status:device.status,version:device.version,createdAt:device.createdAt,updatedAt:device.updatedAt,...(device.lastSeenAt?{lastSeenAt:device.lastSeenAt}:{}),...(device.health?{health:device.health}:{})});
const publicJob=(job:BrowserJob)=>{const {leaseHash,...value}=job;void leaseHash;return value};
export async function storeBrowserOn(owner:string){return isEnabled(owner,'store_browser_execution').catch(()=>false)}
async function enabled(owner:string){if(!await storeBrowserOn(owner))conflict('브라우저 실행 기능이 꺼져 있습니다.')}
async function activeStore(owner:string,id:string){const store=await readRecord<Store>(owner,'store',id);if(store.status!=='active')conflict('보관한 지점입니다.');return store}
function managerUrl(raw:unknown){const value=str(raw,'관리 주소',2000,true);try{const u=new URL(value);if(u.protocol!=='https:'||!['smartplace.naver.com','new.smartplace.naver.com'].includes(u.hostname)||u.username||u.password||u.port||u.hash)throw Error();return u.href}catch{throw new ApiError(400,'네이버 스마트플레이스 공식 HTTPS 관리 주소를 입력하세요.')}}
function identifier(raw:unknown,label:string){const id=str(raw,label,100,true);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new ApiError(400,label+' 형식을 확인하세요.');return id}
async function save(owner:string,kind:string,value:BrowserJob|BrowserBinding|StoredDevice,parent=''){await recordStatement(owner,kind,value.id,value,parent).run()}
async function event(owner:string,job:BrowserJob,action:string){await database().batch([recordStatement(owner,'store_browser_job',job.id,job,job.storeId),recordStatement(owner,'store_browser_event',uid(),{jobId:job.id,storeId:job.storeId,action,status:job.status,version:job.version,createdAt:stamp()},job.storeId)])}
export async function listStoreBrowser(owner:string,storeId:string):Promise<BrowserListing>{
 const store=await readRecord<Store>(owner,'store',storeId);
 const [bindings,jobs,devices,photoRights,sources]=await Promise.all([listRecords<BrowserBinding>(owner,'store_browser_binding',storeId),listRecords<BrowserJob>(owner,'store_browser_job',storeId),listRecords<StoredDevice>(owner,'store_browser_device'),listRecords<BrowserPhotoRights>(owner,'store_browser_photo_rights',storeId),listRecords<ArchiveSource>(owner,'brand_source',store.brandId)]);
 return {enabled:await storeBrowserOn(owner),bindings,jobs:jobs.map(publicJob),devices:devices.map(publicDevice),photoRights,photoSources:sources.filter(x=>x.status==='confirmed'&&x.objectKey&&/\.(png|jpe?g|webp)$/i.test(x.fileName??'')&&(!x.storeId||x.storeId===storeId)).map(x=>({id:x.id,title:x.title,version:x.version,fileName:x.fileName,fileSize:x.fileSize}))};
}
async function registerDevice(owner:string,input:Record<string,unknown>){
 const now=stamp(),id=uid(),token=`sb.${id}.${uid()}${uid()}`;
 const device:StoredDevice={id,owner,label:str(input.label,'장치 이름',100,true),profileId:identifier(input.profileId,'로컬 프로필'),status:'active',tokenHash:await hash(token),version:1,createdAt:now,updatedAt:now};
 await save(owner,'store_browser_device',device);return {device:publicDevice(device),token};
}
async function bindingAction(owner:string,input:Record<string,unknown>){
 const store=await activeStore(owner,str(input.storeId,'지점',100,true)),old=await optional<BrowserBinding>(owner,'store_browser_binding',store.id);
 if(old)version(old,input);else if(input.expectedVersion!==undefined&&input.expectedVersion!==0)conflict('연결 판을 확인하세요.');
 const device=await readRecord<StoredDevice>(owner,'store_browser_device',str(input.deviceId,'장치',100,true));
 if(device.status!=='active'||input.profileId!==device.profileId)conflict('활성 장치와 로컬 프로필을 확인하세요.');
 const binding:BrowserBinding={id:store.id,storeId:store.id,storeName:store.name,deviceId:device.id,profileId:device.profileId,naverPlaceId:identifier(input.naverPlaceId,'공개 플레이스 ID'),managerBusinessId:identifier(input.managerBusinessId,'관리 사업장 ID'),managerUrl:managerUrl(input.managerUrl),...(input.publicUrl?{publicUrl:browserPublicUrl(input.publicUrl)}:{}),version:(old?.version??0)+1,updatedAt:stamp()};
 await save(owner,'store_browser_binding',binding,store.id);return {binding};
}
async function createJob(owner:string,input:Record<string,unknown>){
 const store=await activeStore(owner,str(input.storeId,'지점',100,true)),binding=await readRecord<BrowserBinding>(owner,'store_browser_binding',store.id);
 if(!['read_hours','change_hours','read_weekly_hours','change_weekly_hours','upload_photo'].includes(String(input.type)))throw new ApiError(400,'지원하는 브라우저 작업을 선택하세요.');
 const type=input.type as BrowserJob['type'],write=!['read_hours','read_weekly_hours'].includes(type);
 const beforeSchedule=type==='change_weekly_hours'?weeklySchedule(input.beforeSchedule):undefined,afterSchedule=type==='change_weekly_hours'?weeklySchedule(input.afterSchedule,true):undefined;
 const beforeHours=beforeSchedule?weeklyCanonical(beforeSchedule):str(input.beforeHours??'','변경 전 영업시간',3000,type==='change_hours'),afterHours=afterSchedule?weeklyCanonical(afterSchedule):str(input.afterHours??'','변경 후 영업시간',3000,type==='change_hours');
 if(write&&type!=='upload_photo'&&beforeHours===afterHours)throw new ApiError(400,'변경 전·후 영업시간이 같습니다.');
 const photo=type==='upload_photo'?await approvedPhoto(owner,store.id,str(input.rightsId,'사진 권리',100,true)):undefined;
 if(photo)await preventDuplicatePhoto(owner,binding,photo.sha256);
 const now=stamp(),job:BrowserJob={id:uid(),storeId:store.id,type,status:write?'draft':'approved',bindingVersion:binding.version,binding,beforeHours,afterHours,...(beforeSchedule?{beforeSchedule,afterSchedule}:{}),...(photo?{photo}:{}),publicReadback:{state:'not_checked'},digest:await hash(JSON.stringify({binding,type,beforeHours,afterHours,photo})),deviceId:binding.deviceId,version:1,createdAt:now,updatedAt:now};
 await event(owner,job,'create_job');return {job:publicJob(job)};
}
export async function storeBrowserAction(owner:string,input:Record<string,unknown>,who:Pick<Actor,'id'|'role'>){
 admin(who);if(!['revoke_device','cancel_job','revoke_photo_rights'].includes(String(input.action)))await enabled(owner);
 if(input.action==='register_device')return registerDevice(owner,input);
 if(input.action==='save_binding')return bindingAction(owner,input);
 if(input.action==='create_job')return createJob(owner,input);
 if(input.action==='save_photo_rights')return savePhotoRights(owner,input);
 if(input.action==='revoke_photo_rights')return revokePhotoRights(owner,input);
 if(input.action==='revoke_device'){
  const old=await readRecord<StoredDevice>(owner,'store_browser_device',str(input.deviceId,'장치',100,true));version(old,input);
  const device={...old,status:'revoked' as const,version:old.version+1,updatedAt:stamp()};await save(owner,'store_browser_device',device);return {device:publicDevice(device)};
 }
 if(input.action!=='approve_job'&&input.action!=='cancel_job')throw new ApiError(400,'지원하지 않는 작업입니다.');
 const old=await readRecord<BrowserJob>(owner,'store_browser_job',str(input.jobId,'작업',100,true));version(old,input);
 if(input.action==='approve_job'){
  await activeStore(owner,old.storeId);
  const binding=await readRecord<BrowserBinding>(owner,'store_browser_binding',old.storeId);
  if(binding.version!==old.bindingVersion)conflict('매장 연결이 바뀌었습니다. 작업을 다시 만드세요.');
 }
 if(input.action==='approve_job'&&old.status!=='draft')conflict('초안만 승인할 수 있습니다.');
 if(input.action==='cancel_job'&&!['draft','approved'].includes(old.status))conflict('실행 시작 전 작업만 취소할 수 있습니다.');
 if(input.action==='approve_job'&&old.photo){await revalidatePhoto(owner,old);await preventDuplicatePhoto(owner,old.binding,old.photo.sha256,old.id)}
 const job:BrowserJob={...old,status:input.action==='approve_job'?'approved':'cancelled',...(input.action==='approve_job'?{approvedDigest:old.digest,approvedBy:who.id,approvedUntil:new Date(Date.now()+approvalMs).toISOString()}:{}),version:old.version+1,updatedAt:stamp()};
 await event(owner,job,String(input.action));return {job:publicJob(job)};
}
// 장치 UUID로만 검색한다. 요청 body의 owner는 절대 인증 근거가 아니다.
export async function authenticateBrowserWorker(req:Request):Promise<BrowserWorkerIdentity>{
 const token=req.headers.get('authorization')?.match(/^Bearer (sb\.[a-f0-9-]{36}\.[a-f0-9-]{72})$/)?.[1];
 if(!token)throw new ApiError(401,'장치 인증이 필요합니다.');
 const id=token.split('.')[1],rows=await database().prepare("SELECT owner,data FROM records WHERE kind='store_browser_device' AND id LIKE ?").bind(`%:store_browser_device:${id}`).all<{owner:string;data:string}>();
 if(rows.results.length!==1)throw new ApiError(401,'장치 인증에 실패했습니다.');
 const device=JSON.parse(rows.results[0].data) as StoredDevice;
 if(device.status!=='active'||device.id!==id||device.owner!==rows.results[0].owner||device.tokenHash!==await hash(token))throw new ApiError(401,'장치 인증에 실패했습니다.');
 return {owner:device.owner,deviceId:id,profileId:device.profileId};
}
function evidenceInput(input:Record<string,unknown>,job:BrowserJob):BrowserEvidence{
 const raw=input.evidence;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiError(400,'관찰 근거가 필요합니다.');
 const r=raw as Record<string,unknown>;
 if(Object.keys(r).some(k=>!['managerUrl','managerBusinessId','naverPlaceId','storeName','hours','capturedAt','source','note','schedule','photoId','photoSha256'].includes(k)))throw new ApiError(400,'근거에 허용하지 않는 항목이 있습니다. 쿠키·로그인 정보는 보내지 마세요.');
 const evidence:BrowserEvidence={managerUrl:managerUrl(r.managerUrl),managerBusinessId:identifier(r.managerBusinessId,'관찰 사업장 ID'),naverPlaceId:identifier(r.naverPlaceId,'관찰 플레이스 ID'),storeName:str(r.storeName,'관찰 점포명',300,true),hours:r.schedule!==undefined?weeklyCanonical(r.schedule):str(r.hours??'','관찰 영업시간',3000,job.type!=='upload_photo'),capturedAt:str(r.capturedAt,'관찰 시각',50,true),source:r.source as 'real'|'mocked',note:str(r.note??'','근거 메모',1000),...(r.schedule!==undefined?{schedule:weeklySchedule(r.schedule)}:{}),...(r.photoId!==undefined?{photoId:str(r.photoId,'관찰 사진 ID',200,true)}:{}),...(r.photoSha256!==undefined?{photoSha256:str(r.photoSha256,'관찰 사진 해시',64,true)}:{})};
 const b=job.binding;
 if(evidence.managerUrl!==b.managerUrl||evidence.managerBusinessId!==b.managerBusinessId||evidence.naverPlaceId!==b.naverPlaceId||evidence.storeName!==b.storeName)conflict('관찰한 매장·계정 대상이 승인 대상과 다릅니다.');
 const time=Date.parse(evidence.capturedAt);if(!Number.isFinite(time)||Math.abs(Date.now()-time)>leaseMs||!['real','mocked'].includes(evidence.source))throw new ApiError(400,'최근 관찰 시각과 실측·모의 구분을 확인하세요.');
 return evidence;
}
async function liveBinding(auth:BrowserWorkerIdentity,job:BrowserJob){
 const store=await activeStore(auth.owner,job.storeId);
 if(store.name!==job.binding.storeName)conflict('점포 이름이 바뀌었습니다. 연결을 다시 확인하세요.');
 const binding=await readRecord<BrowserBinding>(auth.owner,'store_browser_binding',job.storeId);
 if(binding.version!==job.bindingVersion||binding.deviceId!==auth.deviceId||binding.profileId!==auth.profileId)conflict('연결·장치·프로필이 바뀌었습니다. 사람 확인이 필요합니다.');
 return binding;
}
async function claimJob(auth:BrowserWorkerIdentity){
 const on=await storeBrowserOn(auth.owner),jobs=await listRecords<BrowserJob>(auth.owner,'store_browser_job');
 if(jobs.some(j=>j.deviceId===auth.deviceId&&j.leaseHash&&Date.parse(j.leaseUntil??'')>Date.now()&&!['cancelled','waiting_human'].includes(j.status)&&!(j.status==='verified'&&(!j.binding.publicUrl||['matched','different','unavailable'].includes(j.publicReadback?.state??'')))))throw new BrowserWorkerError('DEVICE_BUSY','장치가 다른 작업을 실행하고 있습니다.');
 const candidates=jobs.filter(j=>j.deviceId===auth.deviceId&&j.binding.profileId===auth.profileId&&((on&&j.status==='approved')||((['claimed','target_checked','prepared','submit_started','submitted','unknown'].includes(j.status)||(j.status==='verified'&&j.publicReadback?.state==='pending'))&&Date.parse(j.leaseUntil??'')<Date.now()))).sort((a,b)=>Number(a.status==='approved')-Number(b.status==='approved'));
 let selected:{job:BrowserJob;binding:BrowserBinding}|undefined;
 for(const candidate of candidates){
  try{
   const reconcile=candidate.status!=='approved';
   const binding=reconcile?candidate.binding:await liveBinding(auth,candidate);
   await activeStore(auth.owner,candidate.storeId);
   if(!reconcile&&!isRead(candidate)&&(candidate.approvedDigest!==candidate.digest||!Number.isFinite(Date.parse(candidate.approvedUntil??''))||Date.parse(candidate.approvedUntil??'')<=Date.now()))continue;
   if(!reconcile&&!isRead(candidate)&&jobs.some(j=>j.id!==candidate.id&&!isRead(j)&&j.binding.naverPlaceId===candidate.binding.naverPlaceId&&(['claimed','target_checked','prepared','submit_started','submitted','unknown'].includes(j.status)||(j.status==='waiting_human'&&!!j.submissionStartedAt))))continue;
   if(!reconcile&&candidate.photo){await revalidatePhoto(auth.owner,candidate);await preventDuplicatePhoto(auth.owner,binding,candidate.photo.sha256,candidate.id)}
   selected={job:candidate,binding};break;
  }catch(e){if(!(e instanceof ApiError)||![404,409].includes(e.status))throw e}
 }
 if(!selected){if(candidates.length)conflict('대기 작업의 승인·연결·선행 실행 결과를 확인하세요.');throw new BrowserWorkerError('NO_JOB','실행할 작업이 없습니다.');}
 const {job:old,binding}=selected!,reconcile=old.status!=='approved';
 const leaseToken=uid()+uid(),attemptId=uid(),next:BrowserJob={...old,status:reconcile?'unknown':'claimed',attemptId,leaseHash:await hash(leaseToken),leaseUntil:new Date(Date.now()+leaseMs).toISOString(),version:old.version+1,updatedAt:stamp()};
 await event(auth.owner,next,'claim');
 return {job:publicJob(next),binding,leaseToken,attemptId,executionMode:reconcile?'reconcile':isRead(old)?'read':'write'};
}
export async function browserWorkerAction(auth:BrowserWorkerIdentity,input:Record<string,unknown>){
 const on=await storeBrowserOn(auth.owner);
 const device=await readRecord<StoredDevice>(auth.owner,'store_browser_device',auth.deviceId);
 if(device.status!=='active'||device.profileId!==auth.profileId)throw new ApiError(401,'장치 연결이 회수되었습니다.');
 if(input.action==='report_health')return reportHealth(auth,input,device);
 await save(auth.owner,'store_browser_device',{...device,lastSeenAt:stamp()});
 if(input.action==='claim')return claimJob(auth);
 const old=await readRecord<BrowserJob>(auth.owner,'store_browser_job',str(input.jobId,'작업',100,true));
 version(old,input);
 if(old.deviceId!==auth.deviceId||old.attemptId!==input.attemptId||old.leaseHash!==await hash(str(input.leaseToken,'실행 임대',100,true))||Date.parse(old.leaseUntil??'')<=Date.now())conflict('실행 임대가 다르거나 만료되었습니다.');
 const action=String(input.action);
 if(['target_checked','prepared','begin_submit'].includes(action)){if(!on)conflict('브라우저 실행 기능이 꺼져 있습니다.');await liveBinding(auth,old)}
 const now=stamp();let next:BrowserJob={...old,version:old.version+1,updatedAt:now};
 if(action==='public_readback'){if(old.status!=='verified')conflict('관리 화면 확인 뒤 공개 화면을 확인하세요.');next={...next,publicReadback:publicReadback(input,old)};await event(auth.owner,next,action);return {job:publicJob(next)}}
 if(['verified','cancelled','waiting_human'].includes(old.status))conflict('종료된 작업입니다.');
 if(action==='heartbeat')next={...next,leaseUntil:new Date(Date.now()+leaseMs).toISOString()};
 else if(action==='handoff'){next={...next,status:old.submissionStartedAt?'unknown':'waiting_human',note:str(input.note,'사람 확인 사유',1000,true)}}
 else if(action==='unknown'){
  if(!['submit_started','submitted','unknown'].includes(old.status))conflict('저장 시작 이후에만 결과 불명확을 기록할 수 있습니다.');
  next={...next,status:'unknown',note:str(input.note,'불명확 사유',1000,true)};
 }
 else if(action==='target_checked'){
  if(old.status!=='claimed')conflict('접수한 작업만 대상 확인할 수 있습니다.');
  next={...next,evidence:evidenceInput(input,old),status:'target_checked'};
 }
 else if(action==='prepared'){
  if(isRead(old)||old.status!=='target_checked')conflict('대상을 확인한 변경 작업만 준비할 수 있습니다.');
  const evidence=evidenceInput(input,old);if(old.type!=='upload_photo'&&evidence.hours!==old.beforeHours)conflict('현재 영업시간이 승인한 변경 전 값과 다릅니다.');
  if(old.photo)await revalidatePhoto(auth.owner,old);
  next={...next,evidence,status:'prepared'};
 }
 else if(action==='begin_submit'){
  if(isRead(old)||old.status!=='prepared'||old.submissionStartedAt)conflict('저장은 작업당 한 번만 시작할 수 있습니다.');
  if(old.approvedDigest!==old.digest||Date.parse(old.approvedUntil??'')<=Date.now())conflict('변경 승인이 만료되었습니다.');
  if(old.photo){await revalidatePhoto(auth.owner,old);await preventDuplicatePhoto(auth.owner,old.binding,old.photo.sha256,old.id)}
  next={...next,status:'submit_started',submissionStartedAt:now};
 }
 else if(action==='submitted'){
  if(old.status!=='submit_started')conflict('저장 시작 기록이 필요합니다.');next={...next,status:'submitted'};
 }
 else if(action==='verify'){
  if(isRead(old)?!['target_checked','unknown'].includes(old.status):!['submit_started','submitted','unknown'].includes(old.status))conflict('대조할 실행 단계가 아닙니다.');
  const evidence=evidenceInput(input,old);
  if(!isRead(old)&&old.type!=='upload_photo'&&evidence.hours!==old.afterHours)conflict('저장 후 영업시간이 승인한 값과 다릅니다.');
  if(old.type.includes('weekly')&&!evidence.schedule)throw new ApiError(400,'7요일 관찰 일정이 필요합니다.');
  if(old.photo&&(!evidence.photoId||evidence.photoSha256!==old.photo.sha256))conflict('저장된 사진 ID·원본 해시가 승인 사진과 다릅니다.');
  next={...next,status:'verified',evidence,publicReadback:{state:old.binding.publicUrl?'pending':'not_checked'}};
 }
 else throw new ApiError(400,'지원하지 않는 장치 작업입니다.');
 await event(auth.owner,next,action);return {job:publicJob(next),...(action==='begin_submit'?{permitSubmit:true}:{})};
}

async function preventDuplicatePhoto(owner:string,binding:BrowserBinding,sha256:string,except?:string){
 const jobs=await listRecords<BrowserJob>(owner,'store_browser_job');
 if(jobs.some(j=>j.id!==except&&j.binding.naverPlaceId===binding.naverPlaceId&&j.photo?.sha256===sha256&&(['submit_started','submitted','unknown','verified'].includes(j.status)||!!j.submissionStartedAt)))conflict('같은 플레이스에 저장했거나 결과가 불명확한 사진입니다. 재업로드 대신 기존 작업을 대조하세요.');
}
async function reportHealth(auth:BrowserWorkerIdentity,input:Record<string,unknown>,device:StoredDevice){
 if(!['ready','error'].includes(String(input.process))||!['ready','offline','blocked'].includes(String(input.browser))||!['ready','login_required','captcha','unknown'].includes(String(input.auth)))throw new ApiError(400,'장치 프로세스·브라우저·인증 상태를 확인하세요.');
 const health:BrowserHealth={process:input.process as BrowserHealth['process'],browser:input.browser as BrowserHealth['browser'],auth:input.auth as BrowserHealth['auth'],note:str(input.note??'','상태 메모',1000),reportedAt:stamp()};
 const next={...device,health,lastSeenAt:stamp(),version:device.version+1,updatedAt:stamp()};await save(auth.owner,'store_browser_device',next);return {device:publicDevice(next)};
}
export async function browserWorkerAsset(auth:BrowserWorkerIdentity,input:Record<string,unknown>){
 const device=await readRecord<StoredDevice>(auth.owner,'store_browser_device',auth.deviceId);if(device.status!=='active')throw new ApiError(401,'장치 연결이 회수되었습니다.');
 const job=await readRecord<BrowserJob>(auth.owner,'store_browser_job',str(input.jobId,'작업',100,true));
 if(job.deviceId!==auth.deviceId||job.attemptId!==input.attemptId||job.leaseHash!==await hash(str(input.leaseToken,'실행 임대',100,true))||Date.parse(job.leaseUntil??'')<=Date.now()||job.approvedDigest!==job.digest||!['claimed','target_checked','prepared'].includes(job.status))conflict('승인 사진의 활성 실행 임대가 필요합니다.');
 return revalidatePhoto(auth.owner,job);
}
