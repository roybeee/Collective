'use client';
import {useCallback,useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {RefreshCw} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Artifact} from '@/lib/agency';
import {STORE_LINK_WARNING,type DataRequest} from '@/lib/data-requests';
import {useAccount,canChange,adminOnlyNote} from './account-context';

// 캠페인 상세 '작업물' 탭(panels.tsx) 끝에 붙인다. 탭은 열릴 때만 있으므로 DOM 변화를 보고 자리를 다시 찾는다(online-grading.tsx OutputsSlot과 같은 방식).
function OutputsSlot({children}:{children:ReactNode}){
 const [host,setHost]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  let slot:HTMLDivElement|null=null;
  const sync=()=>{
   const panel=document.querySelector<HTMLElement>('.campaign-sheet [role="tabpanel"][id$="-content-outputs"]');
   if(slot&&panel&&slot.parentElement===panel)return;
   slot?.remove();slot=null;
   if(panel){slot=document.createElement('div');slot.className='data-requests';panel.appendChild(slot)}
   setHost(slot);
  };
  sync();
  const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});
  return()=>{observer.disconnect();slot?.remove()};
 },[]);
 return host?createPortal(children,host):null;
}

type Listing={enabled:boolean;requests:DataRequest[]};
type Editing={id:string;mode:'fact'|'close'};
async function send<T>(path:string,payload:Record<string,unknown>):Promise<T>{
 const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const d=await r.json().catch(()=>({})) as T&{error?:string};
 if(!r.ok)throw new Error(d.error||'요청을 처리하지 못했습니다.');
 return d;
}
const resolutionText=(r:DataRequest)=>{
 const x=r.resolution;
 if(!x)return '닫힘';
 return x.kind==='fact_confirmed'?`사실 확정으로 닫힘(사실 v${x.factVersion})`:x.kind==='answered'?`답변 완료${x.note?`: ${x.note}`:''}`:`필요 없음${x.note?`: ${x.note}`:''}`;
};

// 자료 요청(A6-1): 작업물의 '자료 필요'를 모아 보이고, 사실 후보 제안(기존 /api/brand-facts save_fact candidate)과 관리자 닫기·필요 없음을 한다.
// 관리자가 같은 항목의 사실을 확정하면 서버가 요청을 자동으로 닫는다. 스위치가 꺼져 있고 요청이 없으면 아무것도 그리지 않는다.
export function DataRequestsSlot({campaignId,artifacts}:{campaignId:string;artifacts:Artifact[]}){
 const account=useAccount(),admin=canChange(account);
 const [listing,setListing]=useState<Listing|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [editing,setEditing]=useState<Editing|null>(null),[text,setText]=useState('');
 const signature=artifacts.map(a=>`${a.id}:${a.version}`).join('|');
 const fetchListing=useCallback(async(signal?:AbortSignal)=>{
  const r=await fetch('/api/data-requests?campaignId='+encodeURIComponent(campaignId),{signal,cache:'no-store'});
  const d=await r.json() as Listing&{error?:string};
  if(!r.ok||!Array.isArray(d.requests))throw new Error(d.error||'자료 요청을 불러오지 못했습니다.');
  return d;
 },[campaignId]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetchListing(controller.signal).then(d=>{if(!controller.signal.aborted){setListing(d);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
  return()=>controller.abort();
 },[fetchListing,signature]);
 async function run(task:()=>Promise<string>){
  setBusy(true);
  try{const message=await task();setListing(await fetchListing());setError('');setEditing(null);setText('');toast.success(message)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const collect=()=>run(async()=>{const d=await send<{created:number;merged:number;skipped:{confirmed:number;capped:number}}>('/api/data-requests',{action:'collect',campaignId});return `새 요청 ${d.created}건 · 출처 추가 ${d.merged}건${d.skipped.confirmed?` · 이미 확정 ${d.skipped.confirmed}건`:''}${d.skipped.capped?` · 한도 초과 ${d.skipped.capped}건`:''}`});
 const reconcile=()=>run(async()=>{const d=await send<{closed:number}>('/api/data-requests',{action:'reconcile',campaignId});return `확정 사실로 닫은 요청 ${d.closed}건`});
 const resolve=(r:DataRequest,action:'close'|'dismiss')=>run(async()=>{await send('/api/data-requests',{action,id:r.id,version:r.version,note:text});return action==='close'?'답변 완료로 닫았습니다.':'필요 없음으로 닫았습니다.'});
 // 사실 후보 제안: 기존 사실 원장 경로(직원도 가능). 관리자가 확정하면 요청이 닫힌다.
 const propose=(r:DataRequest)=>run(async()=>{await send('/api/brand-facts',{action:'save_fact',data:{brandId:r.brandId,...(r.storeId?{storeId:r.storeId}:{}),key:r.factKey??r.label,value:text,status:'candidate',source:`자료 요청 ${r.id} · ${r.text}`.slice(0,3000),verifiedAt:'',validUntil:''}});return '확인 후보로 저장했습니다. 관리자가 확정하면 요청이 닫힙니다.'});
 if(!listing||(!listing.enabled&&!listing.requests.length))return error?<OutputsSlot><p className="form-error" role="alert">{error}</p></OutputsSlot>:null;
 const open=listing.requests.filter(r=>r.status==='open'),closed=listing.requests.filter(r=>r.status!=='open');
 const edit=(id:string,mode:Editing['mode'])=>{setEditing(editing?.id===id&&editing.mode===mode?null:{id,mode});setText('')};
 return <OutputsSlot><section className="subtle-note" aria-label="자료 요청" aria-live="polite">
  <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',flexWrap:'wrap'}}>
   <b>자료 요청 · 열림 {open.length} · 닫힘 {closed.length}</b>
   {listing.enabled&&<span style={{display:'flex',gap:8}}>
    <Button variant="outline" size="sm" disabled={busy} onClick={()=>void collect()}>작업물에서 모으기</Button>
    {admin&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>void reconcile()}><RefreshCw/>확정 사실과 대조</Button>}
   </span>}
  </div>
  {!listing.enabled&&<p>기능 스위치 a6_data_requests가 꺼져 있어 새로 모으거나 닫을 수 없습니다. 기존 요청은 그대로 보입니다.</p>}
  {listing.enabled&&!open.length&&<p>열린 자료 요청이 없습니다. 작업물의 ‘자료 필요’ 표시를 모으면 여기에 보입니다.</p>}
  {open.length>0&&<ul>{open.map(r=><li key={r.id}>
   <span>{r.label}{r.assignee?` · 담당 ${r.assignee}`:''} · {r.storeId?'지점':'브랜드 공통'}{r.origins.length?` · 출처 ${r.origins.length}곳`:''}{r.factKey?'':' · 사실 항목 미지정(자동으로 닫히지 않음)'}</span>
   <br/><small>{r.text}</small>
   {r.scopeWarning==='store_link_needed'&&<p className="form-error">{STORE_LINK_WARNING}</p>}
   {listing.enabled&&<span style={{display:'flex',gap:8,flexWrap:'wrap'}}>
    <Button variant="ghost" size="sm" disabled={busy} onClick={()=>edit(r.id,'fact')}>사실 후보로 제안</Button>
    {admin&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>edit(r.id,'close')}>닫기·필요 없음</Button>}
   </span>}
   {editing?.id===r.id&&<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
    <Input aria-label={editing.mode==='fact'?'사실 내용':'메모'} maxLength={editing.mode==='fact'?5000:500} value={text} placeholder={editing.mode==='fact'?`${r.label} 내용`:'메모(선택)'} onChange={e=>setText(e.target.value)}/>
    {editing.mode==='fact'?<Button size="sm" disabled={busy||!text.trim()} onClick={()=>void propose(r)}>후보 저장</Button>:<>
     <Button size="sm" disabled={busy} onClick={()=>void resolve(r,'close')}>답변 완료</Button>
     <Button size="sm" variant="outline" disabled={busy} onClick={()=>void resolve(r,'dismiss')}>필요 없음</Button></>}
   </div>}
  </li>)}</ul>}
  {!admin&&open.length>0&&<p className="subtle-note admin-only-note" role="note">{adminOnlyNote()} 닫기·필요 없음은 대표·관리자가, 사실 확정은 브랜드 아카이브에서 관리자가 합니다.</p>}
  {closed.length>0&&<details><summary>닫힌 요청 {closed.length}건</summary><ul>{closed.map(r=><li key={r.id}>{r.label} · {resolutionText(r)}</li>)}</ul></details>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section></OutputsSlot>;
}
