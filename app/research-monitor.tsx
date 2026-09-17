'use client';
import {useEffect,useRef} from 'react';
type Job={id:string;brandId:string;status:string;retryAt?:string};
// Mounted above navigation: changing tabs never abandons submission recovery or syncing.
export function ResearchMonitor({enabled,onChanged}:{enabled:boolean;onChanged:()=>Promise<void>}){
 const changed=useRef(onChanged);changed.current=onChanged;
 useEffect(()=>{if(!enabled)return;let stopped=false,busy=false,cursor=0;
  const tick=async()=>{if(stopped||busy)return;busy=true;try{
   const response=await fetch('/api/archive/research?jobs=active',{signal:AbortSignal.timeout(15000)});if(!response.ok)return;
   const jobs:Job[]=await response.json();
   const eligible=jobs.filter(j=>j.status!=='uncertain'||!!j.retryAt).filter(j=>!j.retryAt||Date.parse(j.retryAt)<=Date.now());const batch=eligible.length?Array.from({length:Math.min(3,eligible.length)},(_,i)=>eligible[(cursor+i)%eligible.length]):[];cursor+=batch.length;
   await Promise.all(batch.map(async j=>{
    try{const r=await fetch('/api/archive/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:j.status==='uncertain'?'recover':'advance',id:j.id}),signal:AbortSignal.timeout(110000)});if(!r.ok)return;const result=await r.json() as {status:string};window.dispatchEvent(new CustomEvent('brand-research-updated',{detail:j.brandId}));if(result.status==='completed'||result.status==='failed'||result.status==='cancelled')await changed.current()}catch{/* The durable server record is retried on the next pass. */}
   }));
  }catch{/* A temporary read failure must not stop accepted HERMES work. */}finally{busy=false}};
  void tick();const timer=setInterval(()=>void tick(),10000);const wake=()=>void tick();window.addEventListener('brand-research-queued',wake);window.addEventListener('online',wake);
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('brand-research-queued',wake);window.removeEventListener('online',wake)};
 },[enabled]);return null;
}
