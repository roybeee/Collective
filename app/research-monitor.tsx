'use client';
import {useEffect,useRef} from 'react';
type Job={id:string;brandId:string;status:string;retryAt?:string};
// Mounted above navigation: changing tabs never abandons submission recovery or syncing.
export function ResearchMonitor({enabled,onChanged}:{enabled:boolean;onChanged:()=>Promise<void>}){
 const changed=useRef(onChanged);changed.current=onChanged;
 useEffect(()=>{if(!enabled)return;let stopped=false,busy=false,cursor=0;
  const tick=async()=>{if(stopped||busy)return;busy=true;try{
   const response=await fetch('/api/archive/research?jobs=active',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('조사 목록을 갱신하지 못했습니다. 연결과 로그인을 확인하세요.');
   const jobs:Job[]=await response.json();
   const eligible=jobs.filter(j=>j.status!=='uncertain'||!!j.retryAt).filter(j=>!j.retryAt||Date.parse(j.retryAt)<=Date.now());const batch=eligible.length?Array.from({length:Math.min(3,eligible.length)},(_,i)=>eligible[(cursor+i)%eligible.length]):[];cursor+=batch.length;
   await Promise.all(batch.map(async j=>{
    try{const r=await fetch('/api/archive/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:j.status==='uncertain'?'recover':'advance',id:j.id}),signal:AbortSignal.timeout(110000)});const result=await r.json() as {status:string;error?:string};if(!r.ok)throw new Error(result.error||'조사 상태를 확인하지 못했습니다.');window.dispatchEvent(new CustomEvent('brand-research-sync',{detail:{brandId:j.brandId,error:''}}));window.dispatchEvent(new CustomEvent('brand-research-updated',{detail:j.brandId}));if(result.status==='completed'||result.status==='failed'||result.status==='cancelled')await changed.current()}catch(e){window.dispatchEvent(new CustomEvent('brand-research-sync',{detail:{brandId:j.brandId,error:e instanceof Error?e.message:'조사 상태 확인이 지연되고 있습니다.'}}))}
   }));
  }catch(e){window.dispatchEvent(new CustomEvent('brand-research-sync',{detail:{error:e instanceof Error?e.message:'조사 목록 확인이 지연되고 있습니다.'}}))}finally{busy=false}};
  void tick();const timer=setInterval(()=>void tick(),10000);const wake=()=>void tick();window.addEventListener('brand-research-queued',wake);window.addEventListener('online',wake);
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('brand-research-queued',wake);window.removeEventListener('online',wake)};
 },[enabled]);return null;
}
