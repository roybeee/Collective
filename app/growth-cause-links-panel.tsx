'use client';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthCauseLinkView} from '@/lib/growth-cause-links-server';
import type {CauseTargetKind} from '@/lib/growth-cause-links';
import styles from './growth-panel.module.css';
type View=GrowthCauseLinkView;
type Row=View['records'][number];
const reasonLabels:Record<string,string>={unknown:'미확인',product_defect:'상품 결함',description_mismatch:'설명과 다름',wrong_option:'옵션 불일치',delivery_issue:'배송 문제',change_of_mind:'구매자 변심',other:'기타'};
const targetLabels:Record<CauseTargetKind,string>={journey:'구매 병목',decision:'일일 결정',lesson:'운영 교훈'};
async function read(campaignId:string,window:{from:string;to:string},signal:AbortSignal):Promise<View>{const q=new URLSearchParams({campaignId,...(window.from?{from:window.from}:{}),...(window.to?{to:window.to}:{})});const r=await fetch(`/api/growth/cause-links?${q}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'원인 연결을 조회하지 못했습니다.');if(!v||typeof v!=='object'||!Array.isArray((v as View).records))throw new Error('원인 연결 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthCauseLinksPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[window,setWindow]=useState({from:'',to:''}),[eventId,setEventId]=useState(''),[targetKind,setTargetKind]=useState<CauseTargetKind>('journey'),[targetId,setTargetId]=useState(''),[note,setNote]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 const load=useCallback(async(range:{from:string;to:string}={from:'',to:''})=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,range,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving,event=view?.events.find(e=>e.eventId===eventId),target=view?.targets[targetKind].find(t=>t.id===targetId);
 async function send(action:'link'|'retire',row?:Row){if(busy||writing.current||!view||stale)return;
  const input=action==='retire'&&row?row.input:event&&target?{eventId:event.eventId,reasonVersion:event.reasonVersion,targetKind,targetId:target.id,targetVersion:target.version,note}:null;if(!input)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,action,expectedVersion:action==='retire'&&row?row.version:view.records.find(r=>r.input.eventId===input.eventId&&r.input.targetKind===input.targetKind&&r.input.targetId===input.targetId)?.version??0,input},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};
  const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/cause-links',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;setStale(true);setMessage(action==='link'?'원인과 검토 기록을 연결했습니다. 최신 조회가 실패해도 저장은 완료된 상태입니다.':'연결을 해제했습니다.');await load(window);}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const d=view?.distribution;
 return <section aria-label="반품 원인 개선 연결" className={styles.panel}><header className={styles.header}><h3>반품·환불 원인 → 개선 검토</h3><button aria-label="원인 연결 새로고침" type="button" disabled={busy} onClick={()=>void load(window)}>새로고침</button></header>
  <Note className={styles.note}>운영자가 확인한 원인 기록을 같은 미션의 구매 병목·일일 결정·운영 교훈에 연결합니다. 원인 분포는 관측 기간의 반품·환불 품목 수 기준이며 결함률·인과 효과가 아닙니다. 자동 응대·환불·재고 해제·규칙 승격은 하지 않습니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">원인 연결을 조회하고 있습니다.</p>}{stale&&<p role="status" className={styles.warning}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&d&&<><form className={styles.form} onSubmit={e=>{e.preventDefault();void load(window);}}><label>관측 시작일<input type="date" value={window.from} onChange={e=>setWindow({...window,from:e.target.value})}/></label><label>관측 종료일<input type="date" value={window.to} onChange={e=>setWindow({...window,to:e.target.value})}/></label><button type="submit" disabled={busy}>기간 적용</button></form>
   <h4>원인 분포 ({d.window.from}~{d.window.to})</h4><p>분모: 반품·환불 사건이 있는 품목 {d.denominator.lines}건 · 원본 보류 {d.held}건 · 원인 미기록 {d.unrecorded}건 · 여러 원인 {d.linesWithMultipleCodes}건 · 관측 시각 없음 제외 {d.excludedWithoutObservedAt}건</p>
   <ul>{d.counts.map(c=><li key={c.code}>{reasonLabels[c.code]??c.code}: {c.lines}건</li>)}</ul><p>결함률·반품률이 아닌 운영자 확인 분포입니다. 인과 효과: 미측정.</p>
   <form onSubmit={e=>{e.preventDefault();void send('link');}}><fieldset disabled={busy||!view.canEdit} className={styles.form}><legend>원인을 검토 기록에 연결</legend>
    <label>원인 기록된 사건<select value={eventId} onChange={e=>{setEventId(e.target.value);retry.current=null;}}><option value="">사건 선택</option>{view.events.map(e=><option key={e.eventId} value={e.eventId}>{e.kind==='return'?'반품':'환불'} · {e.eventId} · {reasonLabels[e.reasonCode]} v{e.reasonVersion}{e.sourceStatus==='held'?' · 보류':''}</option>)}</select></label>
    <label>검토 종류<select value={targetKind} onChange={e=>{setTargetKind(e.target.value as CauseTargetKind);setTargetId('');retry.current=null;}}>{Object.entries(targetLabels).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
    <label>검토 기록<select value={targetId} onChange={e=>{setTargetId(e.target.value);retry.current=null;}}><option value="">기록 선택</option>{view.targets[targetKind].map(t=><option key={t.id} value={t.id}>{t.title||t.id} · v{t.version}</option>)}</select></label>
    <label>연결 메모(개인정보 제외)<input maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <button type="submit" disabled={!event||!target||event.sourceStatus==='held'||stale}>원인 연결</button></fieldset></form>
   <ul>{view.records.filter(r=>r.status==='active').map(r=><li key={r.id} className="wrap-anywhere"><p>{r.input.eventId} ({reasonLabels[r.snapshot.reasonCode]} v{r.snapshot.reasonVersion}) → {targetLabels[r.input.targetKind]} {r.input.targetId} v{r.snapshot.targetVersion} · {r.assessment?.status==='held'?'보류':'현재'}</p>{r.assessment?.reasons.map(x=><p key={x}>{x}</p>)}{view.canEdit&&<button type="button" disabled={busy||stale} onClick={()=>void send('retire',r)}>{r.input.eventId}→{r.input.targetId} 해제</button>}</li>)}</ul>
   <details><summary>원인 연결 이력</summary>{view.history.map(h=><p key={h.id+':'+h.version} className="wrap-anywhere">{h.id} · v{h.version} · {h.status==='active'?'연결':'해제'} · {h.recordedAt}</p>)}</details></>}
 </section>;
}
