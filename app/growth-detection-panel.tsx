'use client';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthDetectionView} from '@/lib/growth-detection-server';
import styles from './growth-panel.module.css';
type View=GrowthDetectionView;
type Row=View['signals'][number];
const kindLabels={demand_rise:'주문 증가',demand_drop:'주문 감소',stockout_risk:'품절 위험',return_cluster:'반품 원인 반복',cs_recurring:'문의 반복',season:'시즌 일정'} as const;
const statusLabels={new:'새 신호',acknowledged:'담당 지정',dismissed:'기각'} as const;
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/detections?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('감지 신호를 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).signals))throw new Error('감지 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthDetectionPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[triage,setTriage]=useState({id:'',assignee:'',nextAction:'',dueBy:'',reason:''}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving;
 async function send(body:Record<string,unknown>,done:(v:Record<string,unknown>)=>string){if(busy||writing.current||!view||stale)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,expectedVersion:0,...body},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/detections',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;setTriage({id:'',assignee:'',nextAction:'',dueBy:'',reason:''});setStale(true);setMessage(done(v as Record<string,unknown>));await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const selected=view?.signals.find(s=>s.id===triage.id);
 const act=(s:Row,action:'acknowledge'|'dismiss')=>send({action,id:s.id,expectedVersion:s.version,...(action==='acknowledge'?{triage:{assignee:triage.assignee,nextAction:triage.nextAction,dueBy:triage.dueBy}}:{reason:triage.reason})},()=>action==='acknowledge'?'담당과 기한을 지정했습니다.':'신호를 기각했습니다.');
 return <section aria-label="자사 장부 감지 신호" className={styles.panel}><header className={styles.header}><h3>자사 장부 감지 신호 · 기회 검토</h3><Button variant="panel" size="fit" aria-label="감지 신호 새로고침" type="button" disabled={busy} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>우리 주문·재고·문의 기록에서 변화를 규칙으로 감지합니다. 규칙은 주문 속도 변화(최근 7일 vs 직전 21일, ±50%·최소 5건), 3일분 이하 공유 재고, 30일 반품 원인·문의 유형 3건 이상, 45일 안의 시즌 일정입니다. 모델·외부 수집이 없고 수요 예측이 아닙니다. 매일 운영 루프가 새 신호를 만들며, 담당·다음 행동·기한을 지정하거나 사유와 함께 기각합니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">감지 신호를 조회하고 있습니다.</p>}{stale&&<p role="status" className={styles.warning}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<>{view.canEdit&&<Button variant="panel" size="fit" type="button" disabled={busy||stale} onClick={()=>void send({action:'detect'},v=>`지금 감지했습니다: 조건 충족 ${v.detected}건 · 새 신호 ${v.created}건.`)}>지금 감지</Button>}
   {!view.signals.length&&<p>감지 신호가 없습니다. 기회가 없다는 증명은 아닙니다.</p>}
   <ul>{view.signals.map(s=><li key={s.id} className="wrap-anywhere"><p><strong>{kindLabels[s.detection.kind]}</strong> · {s.detection.title} · {statusLabels[s.status]}{s.overdue?' · 기한 경과':''} · {s.detectedBy==='daily_loop'?'일일 루프':'운영자'} {s.detectedAt.slice(0,10)}</p><p>{s.detection.detail} (기간 {s.detection.window.from}~{s.detection.window.to}{s.detection.dueBy?` · 준비 기한 ${s.detection.dueBy}`:''})</p>
    {s.triage&&<p>담당 {s.triage.assignee} · {s.triage.nextAction} · 기한 {s.triage.dueBy}</p>}{s.status==='dismissed'&&<p>기각 사유: {s.dismissReason}</p>}
    {view.canEdit&&s.status!=='dismissed'&&<Button variant="panel" size="fit" type="button" disabled={busy} onClick={()=>setTriage({id:s.id,assignee:s.triage?.assignee??'',nextAction:s.triage?.nextAction??'',dueBy:s.triage?.dueBy??s.detection.dueBy??'',reason:''})}>{s.detection.title} 검토</Button>}</li>)}</ul>
   {selected&&<fieldset className={styles.form} disabled={busy}><legend>{selected.detection.title} 검토</legend><label>담당<Input value={triage.assignee} onChange={e=>setTriage({...triage,assignee:e.target.value})}/></label><label>다음 행동<Input maxLength={500} value={triage.nextAction} onChange={e=>setTriage({...triage,nextAction:e.target.value})}/></label><label>검토 기한<Input type="date" value={triage.dueBy} onChange={e=>setTriage({...triage,dueBy:e.target.value})}/></label>
    <Button variant="panel" size="fit" type="button" disabled={stale||!triage.assignee||!triage.nextAction||!triage.dueBy} onClick={()=>void act(selected,'acknowledge')}>담당 지정</Button><label>기각 사유<Input maxLength={500} value={triage.reason} onChange={e=>setTriage({...triage,reason:e.target.value})}/></label><Button variant="panel" size="fit" type="button" disabled={stale||!triage.reason} onClick={()=>void act(selected,'dismiss')}>기각</Button></fieldset>}</>}
 </section>;
}
