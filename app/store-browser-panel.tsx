'use client';
import {useCallback,useEffect,useState,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {EmptyLine} from '@/components/app/empty-line';
import {Note} from '@/components/app/note';
import {MetaLine} from '@/components/app/meta-line';
import type {Store} from '@/lib/store-marketing';
import {BROWSER_JOB_LABELS,type BrowserBinding,type BrowserDevice,type BrowserListing} from '@/lib/store-browser';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import {useAccount,canChange,adminOnlyNote} from './account-context';
import {StoreBrowserWeekly,WeeklyScheduleView} from './store-browser-weekly';
import {StoreBrowserPhoto,StoreBrowserPhotoRights} from './store-browser-photo';
import {StoreBrowserDeviceHealth,StoreBrowserPublicReadback} from './store-browser-evidence';

type BindingForm=Pick<BrowserBinding,'naverPlaceId'|'managerBusinessId'|'managerUrl'|'publicUrl'|'deviceId'|'profileId'>;
const emptyBinding:BindingForm={naverPlaceId:'',managerBusinessId:'',managerUrl:'',publicUrl:'',deviceId:'',profileId:''};
function Field({label,children}:{label:string;children:ReactNode}){return <label className="store-field"><span>{label}</span>{children}</label>}
async function send<T>(payload:Record<string,unknown>):Promise<T>{
 const r=await fetch('/api/store-browser',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const d=await r.json().catch(()=>({})) as T&{error?:string};
 if(!r.ok)throw new Error(d.error||'네이버 관리 요청을 처리하지 못했습니다.');
 return d;
}

export function StoreBrowserPanel({store}:{store:Store}){
 const admin=canChange(useAccount());
 const [listing,setListing]=useState<BrowserListing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [bindingForm,setBindingForm]=useState<BindingForm>(emptyBinding),[deviceLabel,setDeviceLabel]=useState(''),[deviceProfile,setDeviceProfile]=useState('');
 const [token,setToken]=useState(''),[beforeHours,setBeforeHours]=useState(''),[afterHours,setAfterHours]=useState('');
 const binding=listing?.bindings.find(x=>x.storeId===store.id);
 const load=useCallback(async(signal?:AbortSignal)=>{
  const r=await fetch('/api/store-browser?storeId='+encodeURIComponent(store.id),{cache:'no-store',signal});
  const d=await r.json() as BrowserListing&{error?:string};
  if(!r.ok||!Array.isArray(d.jobs)||!Array.isArray(d.devices)||!Array.isArray(d.bindings))throw new Error(d.error||'네이버 관리 작업을 불러오지 못했습니다.');
  return d;
 },[store.id]);
 const fill=useCallback((d:BrowserListing)=>{
  setListing(d);const b=d.bindings.find(x=>x.storeId===store.id);
  setBindingForm(b?{naverPlaceId:b.naverPlaceId,managerBusinessId:b.managerBusinessId,managerUrl:b.managerUrl,publicUrl:b.publicUrl||'',deviceId:b.deviceId,profileId:b.profileId}:emptyBinding);
 },[store.id]);
 useEffect(()=>{
  const controller=new AbortController();
  void load(controller.signal).then(d=>{if(!controller.signal.aborted)fill(d)}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
  return()=>controller.abort();
 },[load,fill]);
 async function run(task:()=>Promise<void>,message?:Saved){
  setBusy(true);setError('');
  try{await task();fill(await load());if(message)notifySaved(message)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function registerDevice(){
  const d=await send<{device:BrowserDevice;token:string}>({action:'register_device',label:deviceLabel,profileId:deviceProfile});
  setToken(d.token);setDeviceLabel('');setDeviceProfile('');
 }
 const saveBinding=()=>send({action:'save_binding',storeId:store.id,...bindingForm,expectedVersion:binding?.version});
 const create=(type:'read_hours'|'change_hours')=>send({action:'create_job',storeId:store.id,type,beforeHours,afterHours});
 if(!listing||(!listing.enabled&&!listing.bindings.length&&!listing.jobs.length&&!listing.devices.length&&!listing.photoRights?.length))return error?<p className="form-error" role="alert">{error}</p>:null;
 const disabled=busy||!listing.enabled;
 const activeDevices=listing.devices.filter(d=>d.status!=='revoked');
 return <section className="subtle-note" aria-label="네이버 매장 관리" aria-live="polite">
  <div className="section-heading"><div><h3>네이버 매장 관리</h3><Note>로그인된 업무용 컴퓨터에서 매장을 확인하고 영업시간을 관리합니다. 변경은 관리자가 내용을 승인한 뒤 진행합니다.</Note></div><Button variant="outline" disabled={busy} onClick={()=>void run(async()=>{})}>진행 새로고침</Button></div>
  {!listing.enabled&&<p role="note">새 작업이 꺼져 있습니다. 기존 작업과 결과만 확인할 수 있습니다.</p>}
  <p>영업시간 조회·변경과 사진 업로드 변경안을 관리합니다. 실제 네이버 화면 연결 전에는 자동 실행 가능 여부를 확인해야 합니다.</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {binding&&<p><MetaLine items={[<>연결된 점포: <b>{store.name}</b></>,`플레이스 ${binding.naverPlaceId}`,`관리 사업장 ${binding.managerBusinessId}`]}/></p>}
  {admin&&listing.enabled&&store.status==='active'&&<>
   <details><summary>업무용 컴퓨터 연결</summary>
    <Note>네이버에 로그인된 컴퓨터와 브라우저 프로필을 등록하세요. 로그인 정보는 등록한 컴퓨터에 보관합니다.</Note>
    <form className="form-stack" onSubmit={e=>{e.preventDefault();void run(registerDevice,'업무용 컴퓨터를 등록했습니다.')}}>
     <Field label="컴퓨터 이름"><Input required maxLength={100} value={deviceLabel} onChange={e=>setDeviceLabel(e.target.value)} placeholder="예: 매장 운영 Mac"/></Field>
     <Field label="브라우저 프로필 ID"><Input required maxLength={100} value={deviceProfile} onChange={e=>setDeviceProfile(e.target.value)}/></Field>
     <Button disabled={busy}>컴퓨터 저장</Button>
    </form>
    {token&&<div role="status"><p>연결 토큰은 이번 화면에서만 표시됩니다. 등록한 컴퓨터의 실행 설정에 저장하세요.</p><Field label="컴퓨터 연결 토큰"><Textarea readOnly rows={3} value={token}/></Field><Button variant="outline" disabled={busy} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(token)},'연결 토큰을 복사했습니다.')}>토큰 복사</Button><Button variant="ghost" onClick={()=>setToken('')}>토큰 숨기기</Button></div>}
   </details>
   <details open={!binding}><summary>이 점포의 네이버 계정 연결</summary>
    <form className="form-stack" onSubmit={e=>{e.preventDefault();void run(async()=>{await saveBinding()},'점포 연결을 저장했습니다.')}}>
     <p><b>{store.name}</b>의 플레이스와 스마트플레이스 관리 사업장을 연결합니다. 두 ID는 서로 다를 수 있습니다.</p>
     <Field label="네이버 플레이스 ID"><Input required maxLength={100} value={bindingForm.naverPlaceId} onChange={e=>setBindingForm(f=>({...f,naverPlaceId:e.target.value}))}/></Field>
     <Field label="스마트플레이스 관리 사업장 ID"><Input required maxLength={100} value={bindingForm.managerBusinessId} onChange={e=>setBindingForm(f=>({...f,managerBusinessId:e.target.value}))}/></Field>
     <Field label="스마트플레이스 관리 화면 주소"><Input required type="url" maxLength={2000} value={bindingForm.managerUrl} onChange={e=>setBindingForm(f=>({...f,managerUrl:e.target.value}))}/></Field>
     <Field label="공개 네이버 플레이스 주소"><Input type="url" maxLength={2000} value={bindingForm.publicUrl} onChange={e=>setBindingForm(f=>({...f,publicUrl:e.target.value}))} placeholder="공개 화면 반영 확인에 사용할 주소"/></Field>
     <Field label="업무용 컴퓨터"><NativeSelect required value={bindingForm.deviceId} onChange={e=>{const d=activeDevices.find(x=>x.id===e.target.value);setBindingForm(f=>({...f,deviceId:e.target.value,profileId:d?.profileId||''}))}}><NativeSelectOption value="">컴퓨터 선택</NativeSelectOption>{activeDevices.map(d=><NativeSelectOption key={d.id} value={d.id}>{d.label}</NativeSelectOption>)}</NativeSelect></Field>
     <Field label="브라우저 프로필 ID"><Input required maxLength={100} value={bindingForm.profileId} onChange={e=>setBindingForm(f=>({...f,profileId:e.target.value}))}/></Field>
     <Button disabled={busy||!activeDevices.length} disabledReason={!activeDevices.length?'업무용 컴퓨터를 먼저 저장하세요.':undefined}>점포 연결 저장</Button>
    </form>
   </details>
   <div className="flex gap-2 flex-wrap"><Button variant="outline" disabled={disabled||!binding} disabledReason={!binding?'이 점포의 네이버 계정을 먼저 연결하세요.':undefined} onClick={()=>void run(async()=>{await create('read_hours')},'영업시간 조회를 요청했습니다.')}>현재 영업시간 확인</Button></div>
   <form className="form-stack" onSubmit={e=>{e.preventDefault();void run(async()=>{await create('change_hours');setBeforeHours('');setAfterHours('')},'영업시간 변경안을 만들었습니다.')}}>
    <Field label="현재 영업시간"><Textarea required maxLength={3000} rows={3} value={beforeHours} onChange={e=>setBeforeHours(e.target.value)} placeholder="조회 결과와 동일한 현재 영업시간"/></Field>
    <Field label="변경할 영업시간"><Textarea required maxLength={3000} rows={3} value={afterHours} onChange={e=>setAfterHours(e.target.value)} placeholder="요일별 영업시간·휴무·휴게시간을 명확히 입력"/></Field>
    <Button disabled={disabled||!binding||!beforeHours.trim()||!afterHours.trim()} disabledReason={!binding?'이 점포의 네이버 계정을 먼저 연결하세요.':!beforeHours.trim()||!afterHours.trim()?'현재 시간과 변경할 시간을 모두 입력하세요.':undefined}>변경안 만들기</Button>
   </form>
   <StoreBrowserWeekly busy={busy} connected={!!binding} observed={listing.jobs.find(j=>j.status==='verified'&&j.evidence?.schedule)?.evidence?.schedule} onRead={()=>void run(async()=>{await send({action:'create_job',storeId:store.id,type:'read_weekly_hours'})},'요일별 영업시간 조회를 요청했습니다.')} onCreate={(beforeSchedule,afterSchedule)=>run(async()=>{await send({action:'create_job',storeId:store.id,type:'change_weekly_hours',beforeSchedule,afterSchedule})},'요일별 변경안을 저장했습니다.')}/>
   <StoreBrowserPhoto sources={listing.photoSources||[]} rights={listing.photoRights||[]} busy={busy} connected={!!binding} onRights={input=>run(async()=>{await send({action:'save_photo_rights',storeId:store.id,...input})},'사진 사용 권리를 저장했습니다.')} onCreate={rightsId=>run(async()=>{await send({action:'create_job',storeId:store.id,type:'upload_photo',rightsId})},'사진 업로드 변경안을 저장했습니다.')}/>
  </>}
  {admin&&!!listing.photoRights?.length&&<StoreBrowserPhotoRights sources={listing.photoSources||[]} rights={listing.photoRights} busy={busy} onRevoke={record=>run(async()=>{await send({action:'revoke_photo_rights',rightsId:record.id,expectedVersion:record.version})},'사진 사용 권리를 회수했습니다.')}/>}
  {admin&&listing.devices.length>0&&<ul>{listing.devices.map(d=><li key={d.id}><MetaLine items={[d.label,d.status==='revoked'?'연결 해제':'등록됨']}/><StoreBrowserDeviceHealth device={d}/> {d.status!=='revoked'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void run(async()=>{await send({action:'revoke_device',deviceId:d.id,expectedVersion:d.version})},'컴퓨터 연결을 해제했습니다.')}>연결 해제</Button>}</li>)}</ul>}
  {!admin&&<p className="admin-only-note" role="note">{adminOnlyNote()} 작업 진행 상황과 결과를 확인할 수 있습니다.</p>}
  {listing.jobs.length>0?<ul>{listing.jobs.map(job=><li key={job.id} className="form-stack">
   <p><MetaLine items={[<b key="type">{job.type==='upload_photo'?'사진 업로드':job.type==='read_hours'||job.type==='read_weekly_hours'?'영업시간 조회':'영업시간 변경'}</b>,BROWSER_JOB_LABELS[job.status]]}/></p>
   {job.type==='change_hours'&&<div className="form-two"><div><b>변경 전</b><p className="whitespace-pre-wrap">{job.beforeHours}</p></div><div><b>승인할 변경 내용</b><p className="whitespace-pre-wrap">{job.afterHours}</p></div></div>}
   {job.beforeSchedule&&job.afterSchedule&&<div className="form-two"><div><b>변경 전 요일별 시간</b><WeeklyScheduleView schedule={job.beforeSchedule}/></div><div><b>승인할 요일별 시간</b><WeeklyScheduleView schedule={job.afterSchedule}/></div></div>}
   {job.photo&&<p><MetaLine items={[`승인할 사진: ${listing.photoSources?.find(s=>s.id===job.photo?.sourceId)?.title||'아카이브 사진 원본'}`,`원본 버전 ${job.photo.sourceVersion}`]}/></p>}
   {job.note&&<p>{job.note}</p>}
   {job.evidence&&<div><p><MetaLine items={[<b key="source">{job.evidence.source==='real'?'실제 화면에서 확인':'모의 테스트 근거'}</b>,job.evidence.capturedAt]}/></p><p><MetaLine items={[job.evidence.storeName,`플레이스 ${job.evidence.naverPlaceId}`]}/></p>{job.evidence.schedule?<WeeklyScheduleView schedule={job.evidence.schedule}/>:['read_hours','change_hours'].includes(job.type)&&<p className="whitespace-pre-wrap">{job.evidence.hours}</p>}{job.evidence.note&&<p>{job.evidence.note}</p>}</div>}
   {job.status==='unknown'&&<p role="note">저장 결과를 확정할 수 없습니다. 다시 전송하지 말고 네이버 화면에서 결과를 확인하세요.</p>}
   {job.status==='waiting_human'&&<p role="note">업무용 컴퓨터에서 로그인·본인 확인 또는 화면 상태를 확인하세요. 이 작업은 자동 재개되지 않습니다. 현재 영업시간을 새로 조회해 확인하고, 변경이 필요하면 새 변경안을 만들어 다시 승인하세요.</p>}
   <p>관리 화면 재조회 결과입니다. 공개 플레이스 반영은 별도 확인이 필요합니다. 모의 테스트와 실제 관리 화면 근거를 구분해 확인하세요.</p>
   <StoreBrowserPublicReadback job={job}/>
   {admin&&<div className="flex gap-2 flex-wrap">{listing.enabled&&store.status==='active'&&job.status==='draft'&&<Button disabled={busy} onClick={()=>void run(async()=>{await send({action:'approve_job',jobId:job.id,expectedVersion:job.version})},'변경안 실행을 승인했습니다.')}>위 내용으로 변경 승인</Button>}{['draft','approved'].includes(job.status)&&<Button variant="outline" disabled={busy} onClick={()=>void run(async()=>{await send({action:'cancel_job',jobId:job.id,expectedVersion:job.version})},'작업을 취소했습니다.')}>취소</Button>}</div>}
  </li>)}</ul>:<EmptyLine next={admin&&listing.enabled?'업무용 컴퓨터와 점포를 연결한 뒤 현재 영업시간을 확인하세요.':'관리자에게 네이버 계정 연결과 영업시간 조회를 요청하세요.'}>아직 네이버 관리 작업이 없습니다.</EmptyLine>}
 </section>;
}
