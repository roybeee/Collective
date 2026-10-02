'use client';
import {EmptyLine} from '@/components/app/empty-line';
import {NativeSelect} from '@/components/ui/native-select';
import {Note} from '@/components/app/note';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {META_CONVERSION_PURPOSE,type MetaConversionView} from '@/lib/meta-conversion';
import s from './meta-insights-panel.module.css';
import {MetaCapiPanel} from './meta-capi-panel';
const message=(e:unknown)=>e instanceof Error?e.message:'전환 기록을 처리하지 못했습니다.';
export function MetaConversionPanel({campaignId}:{campaignId:string}){
 const id=useId(),[view,setView]=useState<MetaConversionView|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[success,setSuccess]=useState(''),[orderId,setOrderId]=useState(''),[time,setTime]=useState(''),[evidence,setEvidence]=useState(''),[consent,setConsent]=useState(false),[actual,setActual]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{const a=new AbortController();void fetch('/api/meta-ads/conversions?campaignId='+encodeURIComponent(campaignId),{signal:a.signal}).then(async r=>{const v=await r.json() as MetaConversionView&{error?:string};if(!r.ok)throw new Error(v.error||'조회 실패');if(!a.signal.aborted){setView(v);setError('');}}).catch(e=>{if(!a.signal.aborted)setError(message(e));}).finally(()=>{if(!a.signal.aborted)setBusy(false);});return()=>a.abort();},[campaignId,retry]);
 const order=view?.orders.find(x=>x.id===orderId),disabled=busy||!view?.canEdit;
 async function record(action:'prepare'|'revoke',targetId=orderId){
  if(!view)return;const target=view.orders.find(x=>x.id===targetId),previous=view.records.find(x=>x.orderId===targetId);setBusy(true);setError('');setSuccess('');
  try{const r=await fetch('/api/meta-ads/conversions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaignId,orderId:targetId,action,expectedVersion:previous?.version??0,expectedOrderVersion:target?.version,confirmed:true,consentGranted:consent,purpose:META_CONVERSION_PURPOSE,isTest:!actual,evidenceRef:evidence,eventTime:Math.floor(Date.parse(time+'+09:00')/1000)})});const v=await r.json() as MetaConversionView&{error?:string};if(!r.ok)throw new Error(v.error||'기록 실패');setView(v);setConsent(false);setActual(false);setSuccess(action==='revoke'?'동의를 철회했습니다. 이후 전송은 차단되며 과거 수신의 취소는 별도 처리합니다.':'구매 전환 준비를 기록했습니다. 전송 예약은 별도로 승인하세요.');}catch(e){setError(message(e));}finally{setBusy(false);}
 }
 return <section className={s.root} aria-label="구매 전환 준비" aria-busy={busy}>
  <header className={s.header}><div><span className={s.eyebrow}>COLLECTIVE / CONVERSIONS</span><h2>실제 주문의 전환 측정을 준비하세요</h2><p>자사몰과 연결된 주문 장부를 기준으로 구매 시각과 별도 고객 동의 증빙을 기록합니다.</p></div><Button variant="outline" disabled={busy} onClick={()=>{setBusy(true);setConsent(false);setActual(false);setRetry(x=>x+1);}}>다시 불러오기</Button></header>
  <div className={s.boundary}><div><b>준비 대장 · 외부 전송 시도 {view?.externalTransmissions??0}건</b><p>이 화면은 고객 동의를 대신 받지 않습니다. 이미 수집한 광고 전환 측정 동의의 비식별 증빙 번호만 입력하세요. 이름·전화·이메일·토큰은 입력하지 마세요.</p><p>서버 전송은 별도 연결·기능 스위치·주문별 승인을 거쳐 실행합니다. 준비 기록은 실제 Meta 수신이나 광고 성과를 의미하지 않습니다.</p></div></div>
  {error&&<p role="alert" className={s.error}>{error}</p>}{success&&<p role="status" className={s.success}>{success}</p>}
  {view&&<><div className={s.card}><h3>전송 전 남은 조건</h3><ul>{view.transmissionBlockers.map(x=><li key={x}>{x}</li>)}</ul></div>
   <div className={s.card}><h3>주문별 준비 기록</h3>{!view.orders.length?<p>자사몰 주문 연결에서 실제 주문을 가져오면 여기에 표시됩니다.</p>:<><label htmlFor={id+'order'}>연결된 주문</label><NativeSelect id={id+'order'} value={orderId} disabled={disabled} onChange={e=>{setOrderId(e.target.value);setConsent(false);setActual(false);setTime('');setEvidence('');}} className="max-w-full"><option value="">주문 선택</option>{view.orders.map(x=><option key={x.id} value={x.id}>{x.orderDate} · {x.paidAmount.toLocaleString('ko-KR')}원 · {x.id.slice(-10)}</option>)}</NativeSelect>
   {order&&<><p>주문일 {order.orderDate} · 결제 {order.paidAmount.toLocaleString('ko-KR')}원 · 환불 {order.refundAmount.toLocaleString('ko-KR')}원</p>{order.issues.map(x=><p key={x} className={s.error}>{x}</p>)}<label htmlFor={id+'time'}>실제 구매 시각 · 한국 시간<Input id={id+'time'} type="datetime-local" step="1" value={time} disabled={disabled||!!order.event} onChange={e=>setTime(e.target.value)}/></label><label htmlFor={id+'evidence'}>비식별 동의 증빙 번호<Input id={id+'evidence'} placeholder="consent-001" maxLength={72} value={evidence} disabled={disabled||!!order.event} onChange={e=>setEvidence(e.target.value)}/></label><label className={s.fields}><Checkbox checked={consent} disabled={disabled||!!order.event} onCheckedChange={v=>setConsent(v===true)}/>고객이 Meta 광고 전환 측정 목적에 별도로 동의했고 증빙을 확인했습니다</label><label className={s.fields}><Checkbox checked={actual} disabled={disabled||!!order.event} onCheckedChange={v=>setActual(v===true)}/>테스트 주문이 아닌 실제 결제 주문임을 확인했습니다</label><Button disabled={disabled||!consent||!actual||!time||!evidence||!!order.issues.length||!!order.event} disabledReason={!consent?'동의 확인을 먼저 체크하세요.':!actual?'필수 칸을 먼저 채우세요.':!time?'필수 칸을 먼저 채우세요.':!evidence?'필수 칸을 먼저 채우세요.':!!order.issues.length?'위에 표시된 문제를 먼저 해결하세요.':!!order.event?'이미 연결한 주문입니다.':undefined} onClick={()=>void record('prepare')}>전환 준비 기록</Button></>}</>}{!view.canEdit&&<p>동의 확인·철회는 워크스페이스 소유자만 할 수 있습니다.</p>}</div>
   <div className={s.card}><h3>준비한 구매 이벤트</h3><Note className="">동일 주문은 캠페인이 바뀌어도 하나의 구매 ID를 유지합니다. 환불·취소·주문 변경은 새 구매를 만들지 않습니다.</Note>{view.records.map(x=><article key={x.id} className={s.boundary}><div className="min-w-0"><b>{x.consent==='revoked'?'동의 철회됨':view.orders.find(o=>o.id===x.orderId)?.issues.length?'주문 변경 · 전송 불가':'준비 기록 · 전송 상태는 아래 대장 확인'}</b><p>{x.value.toLocaleString('ko-KR')}원 · {new Date(x.eventTime*1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} KST</p><p className={s.help+' wrap-anywhere'}>Pixel / 서버 공통 구매 ID: {x.eventId}</p><Button variant="outline" disabled={disabled} onClick={()=>void record('revoke',x.orderId)}>{x.consent==='revoked'?'철회·매칭 정보 파기 재확인':'이 주문의 전환 동의 철회'}</Button></div></article>)}{!view.records.length&&<EmptyLine next="주문을 고르고 구매 이벤트를 준비하세요.">아직 준비한 구매 이벤트가 없습니다.</EmptyLine>}</div>
   <MetaCapiPanel campaignId={campaignId} view={view} onChange={setView}/>
  </>}
 </section>;
}
