'use client';
import {useCallback,useEffect,useState} from 'react';
import {toast} from 'sonner';
import {ExternalLink} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Store,StoreTask} from '@/lib/store-marketing';
import {PLACE_FIELDS,PLACE_LIMITS,PLACE_PLATFORMS,type PlaceCheckState,type PlaceField,type PlaceSnapshot} from '@/lib/place-check';
import {useAccount,canChange,adminOnlyNote} from './account-context';

// 플레이스 정보 대조(A6-2): 점포 마케팅 '채널 점검' 탭 아래에 붙인다. 관리자가 네이버 플레이스에서 본 값을 옮겨 적으면 서버가 확정 사실과 대조한다.
// 이 화면은 URL을 열지 않는다(링크는 사람이 여는 새 창). 스위치가 꺼져 있고 스냅샷이 없으면 아무것도 그리지 않는다.
type Listing={enabled:boolean;snapshots:PlaceSnapshot[];tasks:StoreTask[]};
const FIELD_LABELS:Record<PlaceField,string>={address:'주소',hours:'영업시간',closed_days:'휴무',phone:'전화',menu_price:'메뉴 가격'};
const STATE_LABELS:Record<PlaceCheckState,string>={match:'일치',conflict:'확정 사실과 다름',place_missing:'플레이스에 없음',fact_missing:'확정 사실 없음',both_missing:'둘 다 없음'};
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
const blank=():Record<PlaceField,string>=>({address:'',hours:'',closed_days:'',phone:'',menu_price:''});
async function send<T>(payload:Record<string,unknown>):Promise<T>{
 const r=await fetch('/api/place-checks',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const d=await r.json().catch(()=>({})) as T&{error?:string};
 if(!r.ok)throw new Error(d.error||'요청을 처리하지 못했습니다.');
 return d;
}

export function PlaceCheckPanel({store}:{store:Store}){
 const admin=canChange(useAccount());
 const [listing,setListing]=useState<Listing|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [url,setUrl]=useState(''),[checkedAt,setCheckedAt]=useState(today()),[fields,setFields]=useState(blank()),[evidence,setEvidence]=useState<Record<string,string>>({});
 const snapshot=listing?.snapshots.find(s=>s.platform==='naver_place');
 const fetchListing=useCallback(async(signal?:AbortSignal)=>{
  const r=await fetch('/api/place-checks?storeId='+encodeURIComponent(store.id),{signal,cache:'no-store'});
  const d=await r.json() as Listing&{error?:string};
  if(!r.ok||!Array.isArray(d.snapshots))throw new Error(d.error||'플레이스 대조를 불러오지 못했습니다.');
  return d;
 },[store.id]);
 const fill=useCallback((d:Listing)=>{const s=d.snapshots.find(x=>x.platform==='naver_place');setListing(d);if(s){setUrl(s.url);setFields({...blank(),...s.fields})}},[]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetchListing(controller.signal).then(d=>{if(!controller.signal.aborted){fill(d);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
  return()=>controller.abort();
 },[fetchListing,fill]);
 async function run(task:()=>Promise<string>){
  setBusy(true);
  try{const message=await task();fill(await fetchListing());setError('');toast.success(message)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const save=()=>run(async()=>{
  const d=await send<{snapshot:PlaceSnapshot;tasks:StoreTask[];dataRequests?:number|null}>({action:'save_snapshot',storeId:store.id,platform:'naver_place',url,checkedAt,fields,version:snapshot?.version});
  const opened=d.tasks.filter(t=>t.status==='open').length,closed=d.tasks.length-opened;
  return `대조 완료 · 할 일 열림 ${opened}건 · 닫힘 ${closed}건${d.dataRequests?` · 자료 요청 ${d.dataRequests}건`:''}`;
 });
 const complete=(t:StoreTask)=>run(async()=>{await send({action:'save_task',storeId:store.id,id:t.id,version:t.version,status:'done',evidence:evidence[t.id]??''});setEvidence(e=>({...e,[t.id]:''}));return '할 일을 완료로 기록했습니다.'});
 if(!listing||(!listing.enabled&&!listing.snapshots.length))return error?<p className="form-error" role="alert">{error}</p>:null;
 const open=listing.tasks.filter(t=>t.status==='open');
 return <section className="subtle-note" aria-label="플레이스 정보 대조" aria-live="polite">
  <div className="section-heading"><div><h3>{PLACE_PLATFORMS.naver_place.label} 정보 대조</h3><p>플레이스에서 본 값을 옮겨 적으면 확정 사실과 대조합니다. 다른 항목은 할 일로 열리고, 다시 일치하면 자동으로 완료됩니다.</p></div></div>
  {!listing.enabled&&<p>기능 스위치 a6_place_check가 꺼져 있어 새로 대조할 수 없습니다. 기존 결과는 그대로 보입니다.</p>}
  {snapshot&&<div>
   <p>스냅샷 v{snapshot.version} · 확인일 {snapshot.checkedAt} · <a href={snapshot.url} target="_blank" rel="noreferrer">플레이스 열기<ExternalLink size={13}/></a></p>
   <ul>{snapshot.result.map(r=><li key={r.field}><b>{FIELD_LABELS[r.field]}</b> · {STATE_LABELS[r.state]}{r.state==='conflict'?` · 플레이스 "${r.placeValue}" / 확정 "${r.factValue}"`:''}</li>)}</ul>
  </div>}
  {open.length>0&&<ul>{open.map(t=><li key={t.id}>
   <span>{t.title}</span>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
    <Input aria-label="완료 근거" maxLength={3000} value={evidence[t.id]??''} placeholder="처리 근거(예: 플레이스 영업시간 수정)" onChange={e=>setEvidence(x=>({...x,[t.id]:e.target.value}))}/>
    <Button size="sm" variant="outline" disabled={busy||!listing.enabled||!(evidence[t.id]??'').trim()} onClick={()=>void complete(t)}>완료 기록</Button>
   </div>
  </li>)}</ul>}
  {listing.enabled&&(admin?<form className="form-stack" onSubmit={e=>{e.preventDefault();void save()}}>
   <label className="store-field"><span>플레이스 주소(https://map.naver.com 또는 place.naver.com)</span><Input required type="url" maxLength={PLACE_LIMITS.url} value={url} onChange={e=>setUrl(e.target.value)}/></label>
   <label className="store-field"><span>확인일</span><Input required type="date" max={today()} value={checkedAt} onChange={e=>setCheckedAt(e.target.value)}/></label>
   {PLACE_FIELDS.map(f=><label className="store-field" key={f}><span>{FIELD_LABELS[f]}</span><Input maxLength={PLACE_LIMITS.field[f]} value={fields[f]} onChange={e=>setFields(x=>({...x,[f]:e.target.value}))}/></label>)}
   <Button type="submit" disabled={busy||!url.trim()}>확정 사실과 대조</Button>
  </form>:<p className="subtle-note admin-only-note" role="note">{adminOnlyNote()} 플레이스 스냅샷은 대표·관리자가 입력합니다. 할 일 완료는 누구나 기록할 수 있습니다.</p>)}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
