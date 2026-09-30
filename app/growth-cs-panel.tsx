'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthCsView} from '@/lib/growth-cs-server';
import {csCategories,csChannels,csResolutions,type CsTicketInput} from '@/lib/growth-cs';
import styles from './growth-panel.module.css';
type View=GrowthCsView;
type Ticket=View['tickets'][number];
const categoryLabels:Record<string,string>={shipping_delay:'배송 지연',product_question:'상품 문의',option_change:'옵션 변경',cancel_request:'취소 요청',return_request:'반품 요청',refund_request:'환불 요청',defect_report:'불량 신고',other:'기타'};
const statusLabels={open:'접수',responded:'응답함',resolved:'해결',cancelled:'취소'} as const;
const resolutionLabels:Record<string,string>={answered:'안내 완료',shipped:'출고',exchanged:'교환',returned:'반품 처리',refunded:'환불 처리',no_action:'조치 없음',other:'기타'};
const local=(t:number)=>new Date(t-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
const emptyTicket=():CsTicketInput=>({category:'shipping_delay',channel:'chat',summary:'',lineId:'',receivedAt:'',promisedBy:'',assignee:'',priority:'normal'});
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/cs?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('고객 문의를 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).tickets))throw new Error('문의 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthCsPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[input,setInput]=useState<CsTicketInput>(emptyTicket),[ticketId,setTicketId]=useState(''),[ev,setEv]=useState({action:'respond',at:'',evidenceRef:'',resolution:'answered',note:''}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null),draftId=useRef('');
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving;
 async function send(body:Record<string,unknown>,done:string){if(busy||writing.current||!view||stale)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,...body},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/cs',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;if(body.action==='save_ticket'){draftId.current='';setInput(emptyTicket());}else setEv(x=>({...x,evidenceRef:'',note:''}));setStale(true);setMessage(`${done} 최신 조회가 실패해도 저장은 완료된 상태입니다.`);await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const ticket=view?.tickets.find(t=>t.id===ticketId);
 const record=(t:Ticket)=>send({action:'record_event',id:t.id,expectedVersion:t.version,event:{action:ev.action,at:ev.at?new Date(ev.at).toISOString():'',evidenceRef:ev.evidenceRef,note:ev.note,...(ev.action==='resolve'?{resolution:ev.resolution}:{})}},'처리를 기록했습니다.');
 return <section aria-label="고객 문의 처리" className={styles.panel}><header className={styles.header}><h3>고객 문의 · 약속 기한</h3><button type="button" disabled={busy} onClick={()=>void load()}>문의 새로고침</button></header>
  <p className={styles.note}>고객 원문·이름·연락처·주소는 저장하지 않고 운영자 요약만 남깁니다. 약속 기한을 넘긴 미해결 문의를 먼저 보여줍니다. 반복 유형은 최근 30일 건수이며 비율·만족도가 아닙니다. 자동 응답·환불·재고 변경은 하지 않습니다.</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">문의를 조회하고 있습니다.</p>}{stale&&<p className={styles.error}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<><p>미해결 {view.open}건 · 기한 초과 {view.overdue}건{view.recurring.recurring.length?` · 반복 유형: ${view.recurring.recurring.map(c=>categoryLabels[c]).join(', ')}`:''}</p>
   {view.canEdit&&<form onSubmit={e=>{e.preventDefault();if(!draftId.current)draftId.current=`cs-${crypto.randomUUID().slice(0,8)}`;void send({action:'save_ticket',id:draftId.current,expectedVersion:0,input:{...input,receivedAt:input.receivedAt?new Date(input.receivedAt).toISOString():'',promisedBy:input.promisedBy?new Date(input.promisedBy).toISOString():''}},'문의를 접수했습니다.');}}><fieldset disabled={busy} className={styles.form}><legend>문의 접수</legend>
    <label>문의 유형<select value={input.category} onChange={e=>setInput({...input,category:e.target.value as CsTicketInput['category']})}>{csCategories.map(c=><option key={c} value={c}>{categoryLabels[c]}</option>)}</select></label>
    <label>접수 경로<select value={input.channel} onChange={e=>setInput({...input,channel:e.target.value as CsTicketInput['channel']})}>{csChannels.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    <label className={styles.wide}>운영자 요약(고객 원문·연락처 제외)<textarea required maxLength={500} value={input.summary} onChange={e=>setInput({...input,summary:e.target.value})}/></label>
    <label>주문 품목 ID(선택)<input value={input.lineId} onChange={e=>setInput({...input,lineId:e.target.value})}/></label><label>담당<input required value={input.assignee} onChange={e=>setInput({...input,assignee:e.target.value})}/></label>
    <label>접수 시각<input type="datetime-local" value={input.receivedAt} onChange={e=>setInput({...input,receivedAt:e.target.value})}/></label><label>약속 기한<input type="datetime-local" value={input.promisedBy} onChange={e=>setInput({...input,promisedBy:e.target.value})}/></label>
    <label>우선순위<select value={input.priority} onChange={e=>setInput({...input,priority:e.target.value as 'normal'|'high'})}><option value="normal">보통</option><option value="high">높음</option></select></label>
    <button type="submit" disabled={stale||!input.summary||!input.receivedAt||!input.promisedBy}>문의 접수</button></fieldset></form>}
   <ul>{view.tickets.map(t=><li key={t.id} style={{overflowWrap:'anywhere'}}><p><strong>{categoryLabels[t.input.category]}</strong> · {t.id} · {statusLabels[t.status]}{t.service.overdue?' · 기한 초과':''}{t.service.resolvedLate?' · 기한 뒤 해결':''} · 약속 {t.input.promisedBy.slice(0,16)} · 담당 {t.input.assignee}{t.input.priority==='high'?' · 높음':''}</p><p>{t.input.summary}</p>
    {t.line&&<p>품목 {t.line.id} v{t.line.version} · {t.lineStatus==='held'?'품목 변경됨':'현재'}{t.returnReasons.length?` · 반품 원인: ${t.returnReasons.map(x=>x.reasonCode).join(', ')}`:''}</p>}
    {t.events.length>0&&<p>처리: {t.events.map(e=>`${e.action}${e.resolution?`(${resolutionLabels[e.resolution]})`:''} ${e.at.slice(0,16)}`).join(' → ')}{t.service.firstResponseHours!==null?` · 첫 응답 ${t.service.firstResponseHours}시간`:''}</p>}
    {view.canEdit&&t.status!=='cancelled'&&<button type="button" disabled={busy} onClick={()=>{setTicketId(t.id);setEv(x=>({...x,at:local(Date.now()-60000)}));}}>{t.id} 처리 기록</button>}
   </li>)}</ul>
   {ticket&&<fieldset className={styles.form} disabled={busy}><legend>{ticket.id} 처리</legend>
    <label>처리 종류<select value={ev.action} onChange={e=>setEv({...ev,action:e.target.value})}><option value="respond">응답</option><option value="resolve">해결</option><option value="reopen">다시 열기</option><option value="cancel">취소</option></select></label>
    {ev.action==='resolve'&&<label>해결 방법<select value={ev.resolution} onChange={e=>setEv({...ev,resolution:e.target.value})}>{csResolutions.map(r=><option key={r} value={r}>{resolutionLabels[r]}</option>)}</select></label>}
    <label>처리 시각<input type="datetime-local" value={ev.at} onChange={e=>setEv({...ev,at:e.target.value})}/></label><label>처리 증빙 ID<input value={ev.evidenceRef} onChange={e=>setEv({...ev,evidenceRef:e.target.value})}/></label><label>처리 메모<input maxLength={500} value={ev.note} onChange={e=>setEv({...ev,note:e.target.value})}/></label>
    <button type="button" disabled={stale||!ev.at||!ev.evidenceRef} onClick={()=>void record(ticket)}>처리 저장</button></fieldset>}
  </>}
 </section>;
}
