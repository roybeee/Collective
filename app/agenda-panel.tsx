'use client';
// 홈 '오늘의 안건'(UX-PLAN P5·결정 2): 기한 초과 → 결정 대기 → 새 신호 → 다가오는 기한. 각 항목은 해당 캠페인의 성장·판매 섹션으로 연결한다.
// 집계는 GET /api/agenda다. 행 버튼은 화면 이동만 한다. 새 감지 신호는 행에서 바로 '내가 맡기'로 담당·다음 행동·기한을 기본값으로 기록한다(UX-PLAN-3 10.3).
// 맡기는 기존 감지 신호 기록 API(POST /api/growth/detections acknowledge, 관리자 이상)를 그대로 쓰며 외부 실행은 없다.
import {useCallback,useEffect,useState} from 'react';
import {accountRoleLabels,canChange,useAccount} from './account-context';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client';
import {AlertCircle,ArrowRight,CheckCircle2,Clock,Radar,RefreshCw} from 'lucide-react';
import type {Agenda,AgendaItem,AgendaKind,AgendaQuick} from '@/lib/agenda-server';
import {dateTime,date} from '@/lib/format';
const groups:{kind:AgendaKind;label:string;icon:React.ReactNode}[]=[{kind:'overdue',label:'기한 초과',icon:<AlertCircle size={16}/>},{kind:'decision',label:'결정 대기',icon:<CheckCircle2 size={16}/>},{kind:'signal',label:'새 신호',icon:<Radar size={16}/>},{kind:'upcoming',label:'다가오는 기한',icon:<Clock size={16}/>}];
const dueText=(due:string|null)=>!due?'':/^\d{4}-\d{2}-\d{2}$/.test(due)?date(due):dateTime(due);
export function AgendaPanel({onOpen}:{onOpen:(item:AgendaItem)=>void}){
 const [agenda,setAgenda]=useState<Agenda|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const load=useCallback(async(signal?:AbortSignal)=>{setLoading(true);setError('');try{const r=await fetch('/api/agenda',{cache:'no-store',signal});const d=await r.json() as Agenda&{error?:string};if(!r.ok)throw new Error(d.error||'안건을 불러오지 못했습니다.');if(!signal?.aborted)setAgenda(d);}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'안건을 불러오지 못했습니다.');}finally{if(!signal?.aborted)setLoading(false);}},[]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>load(c.signal));return()=>c.abort();},[load]);
 const account=useAccount(),canAct=canChange(account),[acting,setActing]=useState(false),[actMessage,setActMessage]=useState('');
 const assignee=account?.email||(account?accountRoleLabels[account.role]:'담당자');
 async function acknowledge(items:AgendaItem[]){
  const targets=items.filter((i):i is AgendaItem&{quick:AgendaQuick}=>i.quick?.type==='acknowledge_signal');if(!targets.length||acting)return;
  setActing(true);setActMessage('');let done=0;const failed:string[]=[];
  for(const item of targets){const q=item.quick;try{const r=await fetch('/api/growth/detections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'acknowledge',campaignId:item.campaignId,campaignVersion:q.campaignVersion,id:q.recordId,expectedVersion:q.version,requestId:clientId(),triage:{assignee,nextAction:q.nextAction,dueBy:q.dueBy}})});if(!r.ok){const d=await r.json().catch(()=>({})) as {error?:string};throw new Error(d.error||'맡지 못했습니다.');}done++;}catch(e){failed.push(`${item.title}: ${e instanceof Error?e.message:'맡지 못했습니다.'}`);}}
  setActing(false);setActMessage(`${done}건을 맡았습니다.${failed.length?` ${failed.length}건은 처리하지 못했습니다(${failed.join(' / ')}).`:''}`);await load();
 }
 const quickSignals=agenda?.items.filter(i=>i.quick?.type==='acknowledge_signal')??[];
 return <section className="agenda-card" aria-labelledby="agenda-title"><header><div><p className="eyebrow">TODAY</p><h2 id="agenda-title">오늘의 안건</h2></div><button type="button" className="agenda-refresh" aria-label="안건 새로고침" disabled={loading} onClick={()=>void load()}><RefreshCw size={15}/>새로고침</button></header>
  {canAct&&quickSignals.length>1&&<div className="agenda-bulk"><Button type="button" disabled={acting} onClick={()=>void acknowledge(quickSignals)}>새 신호 {quickSignals.length}건 모두 내가 맡기</Button><small>담당은 {assignee}, 기한은 신호별 권장일(없으면 3일 뒤)입니다.</small></div>}
  {actMessage&&<p role="status" className="agenda-empty">{actMessage}</p>}
  {agenda&&<ul className="agenda-counts" aria-label="안건 요약">{groups.map(g=><li key={g.kind} data-kind={g.kind}>{g.icon}<span>{g.label}</span><b>{agenda.counts[g.kind]}</b></li>)}</ul>}
  {loading&&!agenda&&<p role="status" className="agenda-empty">안건을 모으고 있습니다.</p>}
  {error&&<p role="alert" className="agenda-error">{error} <button type="button" onClick={()=>void load()}>다시 불러오기</button></p>}
  {agenda&&!agenda.items.length&&<p className="agenda-empty">지금 처리할 안건이 없습니다. 새 기한·승인 요청·감지 신호가 생기면 여기에 모입니다.</p>}
  {agenda&&agenda.items.length>0&&<ol className="agenda-list">{agenda.items.map(item=><li key={item.id} data-kind={item.kind}><button type="button" data-prefetch="detail growth" onClick={()=>onOpen(item)}><span className="agenda-kind">{groups.find(g=>g.kind===item.kind)?.label}</span><span className="agenda-main"><b>{item.title}</b><small>{item.campaignTitle}{item.detail?` · ${item.detail}`:''}</small></span>{item.due&&<span className="agenda-due">{dueText(item.due)}</span>}<ArrowRight size={16} aria-hidden="true"/></button>{canAct&&item.quick?.type==='acknowledge_signal'&&<Button type="button" variant="outline" size="sm" className="agenda-quick" disabled={acting} aria-label={`${item.title} 내가 맡기`} onClick={()=>void acknowledge([item])}>내가 맡기({date(item.quick.dueBy)}까지)</Button>}</li>)}</ol>}
  {agenda&&agenda.total>agenda.items.length&&<p className="agenda-empty">상위 {agenda.items.length}건만 보입니다(전체 {agenda.total}건).</p>}
 </section>;
}
