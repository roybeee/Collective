'use client';
import {readOnlyReason} from '@/lib/ui/read-only';
import {askConfirm} from '@/components/app/confirm-dialog';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import type {metaReservationView} from '@/lib/meta-reservation-server';
import s from './meta-insights-panel.module.css';
type View=Awaited<ReturnType<typeof metaReservationView>>;
const labels={reserved:'로컬 예약',released:'예약 해제',unknown:'결과 확인 필요'};
export function MetaReservationPanel({campaignId}:{campaignId:string}){
 const id=useId(),[view,setView]=useState<View|null>(null),[retry,setRetry]=useState(0),[busy,setBusy]=useState(true),[amount,setAmount]=useState(''),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 useEffect(()=>{const a=new AbortController();void fetch('/api/meta-ads/reservations?campaignId='+encodeURIComponent(campaignId),{signal:a.signal}).then(async r=>{const v=await r.json() as View&{error?:string};if(!r.ok)throw new Error(v.error||'조회 실패');if(!a.signal.aborted){setView(v);setError('');setConfirmed(false);}}).catch(e=>{if(!a.signal.aborted)setError(e instanceof Error?e.message:'조회 실패');}).finally(()=>{if(!a.signal.aborted)setBusy(false);});return()=>a.abort();},[campaignId,retry]);
 async function action(action:string,extra:Record<string,unknown>={}){
  if(!view)return;setBusy(true);setError('');setSuccess('');try{const r=await fetch('/api/meta-ads/reservations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,campaignId,expectedScopeDigest:view.scopeDigest,amount:Number(amount),note,confirmed,...extra})});const v=await r.json() as View&{error?:string};if(!r.ok)throw new Error(v.error||'저장 실패');setView(v);setConfirmed(false);setSuccess(action==='release'?'앱의 예약을 해제했습니다. 외부 광고 상태는 바뀌지 않습니다.':'계획 예산을 예약했습니다. 예약은 지출이 아닙니다.');}catch(e){setError(e instanceof Error?e.message:'저장 실패');}finally{setBusy(false);}
 }
 return <section className={s.root} aria-label="Meta 예산 예약" aria-busy={busy}><header className={s.header}><div><span className={s.eyebrow}>예산 예약</span><h2>실행할 범위의 예산을 따로 잡습니다</h2><p>확인한 광고 구성을 기준으로 계획 금액을 예약하고 이력을 보존합니다.</p></div><Button variant="outline" disabled={busy} onClick={()=>{setBusy(true);setConfirmed(false);setRetry(n=>n+1);}}>다시 불러오기</Button></header>
  {error&&<p role="alert" className={s.error}>{error}</p>}{success&&<p role="status" className={s.success}>{success}</p>}
  {view&&<><div className={s.boundary}><b>현재 단계: 로컬 예약</b>{view.executionBlockers.map(x=><p key={x}>{x}</p>)}</div><div className={s.card}><p>안전 여유 제외 금액: {view.allocatable===null?'미확인':view.allocatable.toLocaleString()+'원'} · 예약 중: {view.reserved.toLocaleString()}원</p>{view.issues.length>0&&<ul>{view.issues.map(x=><li key={x}>{x}</li>)}</ul>}
   <form onSubmit={e=>{e.preventDefault();void action('reserve');}}><fieldset className={s.fields} disabled={busy||!view.canEdit||!!view.issues.length}><legend>계획 예산 예약</legend><label htmlFor={id+'amount'}>예약 금액 (원)<Input id={id+'amount'} type="number" min={1} step={1} required value={amount} onChange={e=>{setAmount(e.target.value);setConfirmed(false);}}/></label><label htmlFor={id+'note'}>예약 근거<Input id={id+'note'} maxLength={500} required value={note} onChange={e=>{setNote(e.target.value);setConfirmed(false);}}/></label><label><Checkbox checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)}/>광고 구성·기간·예약 금액을 확인했습니다</label><Button type="submit" disabled={!confirmed} disabledReason={!confirmed?'확인 칸을 먼저 체크하세요.':undefined}>계획 예산 예약</Button></fieldset></form></div>
   <div className={s.results}><h3>예약 이력</h3>{view.records.map(r=><article className={s.card} key={r.id}><h4>{labels[r.state]} · {r.amount.toLocaleString()}원</h4><p>{r.note}</p>{r.stale&&<p className={s.warning}>광고 구성의 최신 확인이 필요합니다.</p>}{r.state==='reserved'&&<Button disabledReason={view.canEdit?undefined:readOnlyReason} variant="outline" disabled={busy||!view.canEdit} onClick={async()=>{if(await askConfirm({title:'앱의 계획 예산 예약만 해제할까요?',impact:'외부 광고를 정지하는 동작은 아닙니다.',undo:'해제한 예약은 되돌리지 않습니다. 필요하면 새로 예약하세요.',confirmLabel:'예약 해제'}))void action('release',{id:r.id,expectedVersion:r.version,confirmed:true});}}>로컬 예약 해제</Button>}</article>)}</div></>}
 </section>;
}
