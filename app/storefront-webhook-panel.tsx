'use client';
import {askConfirm} from '@/components/app/confirm-dialog';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {publicStorefrontWebhook} from '@/lib/storefront-webhook';
import s from './storefront-orders-panel.module.css';
type Connection=ReturnType<typeof publicStorefrontWebhook>;
export function StorefrontWebhookPanel({storeId}:{storeId:string}) {
 const id=useId(),[connections,setConnections]=useState<Connection[]>([]),[canEdit,setCanEdit]=useState(false),[source,setSource]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[secret,setSecret]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const a=new AbortController();void fetch('/api/storefront-webhooks?storeId='+encodeURIComponent(storeId),{signal:a.signal}).then(async r=>{const v=await r.json() as {connections:Connection[];canEdit:boolean;error?:string};if(!r.ok)throw new Error(v.error||'연결 조회 실패');if(!a.signal.aborted){setConnections(v.connections);setCanEdit(v.canEdit);}}).catch(e=>{if(!a.signal.aborted)setError(e instanceof Error?e.message:'조회 실패');}).finally(()=>{if(!a.signal.aborted)setBusy(false);});return()=>a.abort();},[storeId,retry]);
 async function send(action:string,c?:Connection) {
  if(action==='enable'&&!(await askConfirm({title:'이 연결로 서명된 주문·환불을 장부에 자동 반영할까요?',impact:'서명이 확인된 주문·환불이 주문 장부에 자동으로 기록됩니다.',undo:'같은 화면에서 끌 수 있습니다. 이미 반영된 기록은 남습니다.',confirmLabel:'켜기'})))return;
  if(action==='rotate'&&!(await askConfirm({title:'키를 다시 발급할까요?',impact:'기존 키를 폐기하고 수신을 끕니다.',undo:'몰 서버에 새 키를 설정한 뒤 다시 켜야 합니다.',confirmLabel:'키 다시 발급',danger:true})))return;
  setBusy(true);setError('');setSecret('');
  try {const r=await fetch('/api/storefront-webhooks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,storeId,sourceKey:source,id:c?.id,expectedVersion:c?.version,confirmed:action==='enable'})});const v=await r.json() as {connection:Connection;signingSecret?:string;error?:string};if(!r.ok)throw new Error(v.error||'설정 실패');setConnections(old=>[v.connection,...old.filter(x=>x.id!==v.connection.id)]);if(v.signingSecret)setSecret(v.signingSecret);if(action==='create')setSource('');}catch(e){setError(e instanceof Error?e.message:'처리 실패');}finally{setBusy(false);}
 }
 return <section className={s.card} aria-label="자사몰 서명 수신 연결"><details><summary><b>주문 자동 수신 연결</b> · 서버 개발자용</summary><p className={s.caption}>자사몰 서버에서 COLLECTIVE 주문 형식으로 보내는 범용 웹훅입니다. 카페24·Shopify 등의 기본 웹훅을 그대로 연결하는 기능은 아닙니다. 고객 정보 없이 주문·누적 환불만 받으며 Meta로 전송하지 않습니다.</p>
 {error&&<p role="alert" className={s.error}>{error}</p>}
 {secret&&<div className={s.preview}><b>서명 키 · 지금 한 번만 표시</b><p className={s.caption}>몰 서버의 비밀 설정에 저장하세요. URL·브라우저 코드·고객 화면에 넣지 않습니다. 닫은 뒤 다시 볼 수 없으며 분실하면 키를 교체하세요.</p><code style={{display:'block',overflowWrap:'anywhere'}}>{secret}</code><Button variant="outline" onClick={()=>setSecret('')}>키 저장 후 화면에서 숨기기</Button></div>}
 <form className={s.fields} onSubmit={e=>{e.preventDefault();void send('create');}}><label htmlFor={id+'source'}>자동 수신 몰 식별자<Input id={id+'source'} required maxLength={40} pattern="[a-z0-9][a-z0-9_-]{1,39}" value={source} disabled={busy||!canEdit} onChange={e=>setSource(e.target.value)} placeholder="예: brand-store"/></label><p className={s.caption}>CSV로 가져오던 몰은 같은 식별자를 사용해야 중복을 대조할 수 있습니다.</p><Button disabled={busy||!canEdit||!source}>꺼진 수신 연결 만들기</Button></form>
 {connections.map(c=><article key={c.id} className={s.preview}><h4>{c.sourceKey} · {c.enabled?'수신 켜짐':'수신 꺼짐'}</h4><p className={s.caption}>수신 주소</p><code style={{display:'block',overflowWrap:'anywhere'}}>{typeof window==='undefined'?'':window.location.origin}{c.path}</code><p>마지막 정상 수신: {c.lastReceivedAt?new Date(c.lastReceivedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'없음'}</p>{c.lastResult&&<p>새 주문 {c.lastResult.created} · 갱신 {c.lastResult.updated} · 중복 {c.lastResult.duplicates} · 이전 상태 {c.lastResult.older}</p>}<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Button disabled={busy||!canEdit} onClick={()=>void send(c.enabled?'disable':'enable',c)}>{c.enabled?'수신 끄기':'수신 켜기'}</Button><Button variant="outline" disabled={busy||!canEdit} onClick={()=>void send('rotate',c)}>서명 키 교체</Button></div></article>)}
 {!connections.length&&!busy&&<p className={s.caption}>아직 자동 수신 연결이 없습니다. CSV 가져오기는 계속 사용할 수 있습니다.</p>}<Button variant="ghost" disabled={busy} onClick={()=>{setBusy(true);setError('');setRetry(v=>v+1);}}>수신 상태 새로고침</Button><p className={s.caption}>연결 설정은 소유자만 변경할 수 있습니다. 수신을 꺼도 이미 반영된 주문·환불 장부는 유지됩니다. 서명/주문 오류는 보내는 서버에 HTTP 오류로 반환합니다.</p>
 </details></section>;
}
