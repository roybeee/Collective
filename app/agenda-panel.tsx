'use client';
// 홈 '오늘의 안건'(UX-PLAN P5·결정 2, GLOBAL-PLAN X1 결정 인박스 v2): 탭 전체/결정/질문/알림, 기한 초과 → 결정 대기 → 질문 → 새 신호 → 다가오는 기한.
// 집계는 GET /api/agenda다. 행 본문은 해당 캠페인 탭·성장 섹션으로 이동한다. 행 안 동작은 기존 API만 쓴다: 작업물 승인·수정 요청(POST /api/action review_artifact),
// 발행 승인(POST /api/execution approve, 관리자), 새 신호 '내가 맡기'(POST /api/growth/detections acknowledge). 미루기는 이 기기에만 24시간 남는다(localStorage).
// 자판: J/K 이동, A 승인, R 수정 요청, H 미루기(입력 칸 밖에서만). 일괄 '선택 승인'은 건수·비용 합계를 확인한 뒤 순차 실행하고 건별 결과를 남긴다. 외부 실행은 없다.
import {CardButton} from '@/components/app/card-button';
import {useCallback,useEffect,useRef,useState} from 'react';
import {accountRoleLabels,adminOnlyNote,canChange,useAccount} from './account-context';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client';
import {RefreshCw} from 'lucide-react';
import type {Agenda,AgendaItem,AgendaTab} from '@/lib/agenda-types';
import {approvable,batchSummary,costSum,inboxKey,moveIndex,readSnoozes,runSequentially,snooze,snoozedCount,visibleItems,writeSnoozes,type BatchResult,type SnoozeMap} from '@/lib/agenda-client';
import {approveAgendaItem,requestArtifactChanges} from '@/components/app/inbox-actions';
import {date,money} from '@/lib/format';
import {bootFetch} from '@/lib/ui/boot-fetch';
import {notifySaved} from '@/lib/ui/notify';
import {askConfirm} from '@/components/app/confirm-dialog';
import {EmptyLine} from '@/components/app/empty-line';
import {Segmented} from '@/components/app/segmented';
import {InboxRow,kindLabels} from '@/components/app/inbox-row';
import {pushNav} from '@/lib/nav-state';
type TabValue='all'|AgendaTab;
const tabLabels:Record<TabValue,string>={all:'전체',decide:'결정',ask:'질문',notify:'알림'};
const emptyNext:Record<TabValue,string>={all:'새 기한·승인 요청·질문·감지 신호가 생기면 여기에 모입니다.',decide:'작업물·발행·회의·자료 요청의 승인이 필요하면 여기에 모입니다.',ask:'브리프 확인 질문과 회의의 확인할 사실이 생기면 여기에 모입니다.',notify:'새 감지 신호와 다가오는 기한이 생기면 여기에 모입니다.'};
const storage=()=>typeof window==='undefined'?undefined:window.localStorage;
export function AgendaPanel({onOpen}:{onOpen:(item:AgendaItem)=>void}){
 const [agenda,setAgenda]=useState<Agenda|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[tab,setTab]=useState<TabValue>('all');
 const [snoozed,setSnoozed]=useState<SnoozeMap>({}),[selected,setSelected]=useState<string[]>([]),[changesFor,setChangesFor]=useState(''),[focus,setFocus]=useState(-1),[results,setResults]=useState<BatchResult[]>([]);
 const rows=useRef<(HTMLButtonElement|null)[]>([]),card=useRef<HTMLElement>(null);
 // 행 안 동작 뒤 초점을 남은 첫 행(없으면 카드)에 둔다. 처리한 행이 사라져 초점이 문서로 빠지면 J/K/A/R/H 자판이 끊긴다.
 const refocus=()=>setTimeout(()=>{const next=rows.current.find(el=>el?.isConnected);(next??card.current)?.focus({preventScroll:true})},0);
 const load=useCallback(async(signal?:AbortSignal)=>{setLoading(true);setError('');try{const r=await bootFetch('/api/agenda',{cache:'no-store',signal});const d=await r.json() as Agenda&{error?:string};if(!r.ok)throw new Error(d.error||'안건을 불러오지 못했습니다.');if(!signal?.aborted)setAgenda(d);}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'안건을 불러오지 못했습니다.');}finally{if(!signal?.aborted)setLoading(false);}},[]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{setSnoozed(readSnoozes(storage()));return load(c.signal)});return()=>c.abort();},[load]);
 const account=useAccount(),canAct=canChange(account),[acting,setActing]=useState(false),[actMessage,setActMessage]=useState('');
 const assignee=account?.email||(account?accountRoleLabels[account.role]:'담당자');
 async function acknowledge(items:AgendaItem[]){
  const targets=items.filter(i=>i.quick?.type==='acknowledge_signal');if(!targets.length||acting)return;
  setActing(true);setActMessage('');let done=0;const failed:string[]=[];
  for(const item of targets){const q=item.quick!;try{const r=await fetch('/api/growth/detections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'acknowledge',campaignId:item.campaignId,campaignVersion:q.campaignVersion,id:q.recordId,expectedVersion:q.version,requestId:clientId(),triage:{assignee,nextAction:q.nextAction,dueBy:q.dueBy}})});if(!r.ok){const d=await r.json().catch(()=>({})) as {error?:string};throw new Error(d.error||'맡지 못했습니다.');}done++;}catch(e){failed.push(`${item.title}: ${e instanceof Error?e.message:'맡지 못했습니다.'}`);}}
  setActing(false);setActMessage(`${done}건을 맡았습니다.${failed.length?` ${failed.length}건은 처리하지 못했습니다(${failed.join(' / ')}).`:''}`);await load();
 }
 // 행 안 결정 하나. 성공은 '…습니다.' 한 문장 알림, 실패는 행 목록 위 오류 문장으로 남긴다. 승인 뒤 목록을 다시 불러온다.
 async function act(work:()=>Promise<string|null>){
  if(acting)return;setActing(true);setError('');setResults([]);
  try{const saved=await work();if(saved){notifySaved(saved as `${string}습니다.`);setActMessage(saved);await load();refocus();}}catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.')}finally{setActing(false)}
 }
 const approve=(item:AgendaItem)=>void act(()=>approveAgendaItem(item,{confirm:true}));
 const requestChanges=(item:AgendaItem,message:string)=>void act(async()=>{const saved=await requestArtifactChanges(item,message);setChangesFor('');return saved});
 function doSnooze(item:AgendaItem){const next=snooze(snoozed,item.id);setSnoozed(next);writeSnoozes(storage(),next);setSelected(ids=>ids.filter(id=>id!==item.id));setActMessage(`'${item.title}'을 이 기기에서 24시간 미뤘습니다.`)}
 // 성장 탭이 아닌 출처(작업물·발행·회의·브리프)는 그 캠페인 탭으로 바로 간다. 성장 기록은 기존 경로(섹션·패널 열기)를 쓴다.
 const open=(item:AgendaItem)=>item.ctab&&item.ctab!=='growth'?pushNav({view:'overview',campaign:item.campaignId,ctab:item.ctab}):onOpen(item);
 const items=agenda?visibleItems(agenda.items,tab==='all'?null:tab,snoozed):[],hidden=agenda?snoozedCount(agenda.items,snoozed):0;
 const quickSignals=items.filter(i=>i.quick?.type==='acknowledge_signal'),chosen=items.filter(i=>selected.includes(i.id)&&approvable(i));
 async function approveSelected(){
  if(!chosen.length||acting)return;
  const ok=await askConfirm({title:`선택한 ${chosen.length}건을 승인할까요?`,fields:{what:chosen.map(i=>i.title).filter((t,i,a)=>a.indexOf(t)===i).join(', '),cost:money(costSum(chosen)),reversible:'작업물 승인은 이력에 남고 새 판을 저장하면 다시 검토합니다. 발행 승인은 접수 전까지 취소할 수 있습니다.'},impact:'한 건씩 차례로 승인합니다. 한 건이 실패해도 다음 건은 계속하고 건별 결과를 아래에 남깁니다.',undo:'승인 기록은 각 캠페인 이력에 남습니다.',confirmLabel:'선택 승인'});
  if(!ok)return;setActing(true);setError('');
  const out=await runSequentially(chosen,i=>approveAgendaItem(i,{confirm:false}).then(()=>undefined));
  setResults(out);setSelected([]);setActing(false);const summary=batchSummary(out);setActMessage(summary);if(out.some(r=>r.ok))notifySaved(summary as `${string}습니다.`);await load();refocus();
 }
 // 자판(카드 안, 입력 칸 밖에서만): 초점 행을 옮기고 그 행의 본문 버튼에 초점을 둔다. Enter·빈칸은 초점 둔 버튼의 기본 동작(열기·승인)을 그대로 쓴다.
 function onKey(e:React.KeyboardEvent<HTMLElement>){
  const target=e.target as HTMLElement;if(/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)||e.altKey||e.ctrlKey||e.metaKey)return;
  const key=inboxKey(e.key);if(!key||key==='open')return;
  const current=rows.current.findIndex(el=>el===target||!!el?.closest('li')?.contains(target)),index=current>=0?current:focus;
  if(key==='next'||key==='prev'){e.preventDefault();const next=moveIndex(index,key==='next'?1:-1,items.length);setFocus(next);rows.current[next]?.focus();return}
  const item=items[index];if(!item)return;e.preventDefault();
  if(key==='approve'&&approvable(item)&&canAct)approve(item);
  else if(key==='changes'&&item.action?.type==='review_artifact'&&canAct)setChangesFor(item.id);
  else if(key==='snooze')doSnooze(item);
 }
 const tabCount=(t:TabValue)=>agenda?(t==='all'?agenda.total:agenda.tabs[t]):0;
 return <section ref={card} tabIndex={-1} className="agenda-card" aria-labelledby="agenda-title" onKeyDown={onKey}><header><div><p className="eyebrow">오늘</p><h2 id="agenda-title">오늘의 안건</h2></div><CardButton type="button" className="agenda-refresh" aria-label="안건 새로고침" disabled={loading} onClick={()=>void load()}><RefreshCw size={15}/>새로고침</CardButton></header>
  {agenda&&<Segmented label="안건 탭" value={tab} onChange={v=>{setTab(v);setFocus(-1)}} options={(['all','decide','ask','notify'] as TabValue[]).map(t=>({value:t,label:<>{tabLabels[t]} <b aria-label={`${tabLabels[t]} ${tabCount(t)}건`}>{tabCount(t)}</b></>}))}/>}
  {agenda&&<ul className="agenda-counts" aria-label="안건 요약" aria-live="polite">{(Object.keys(kindLabels) as (keyof typeof kindLabels)[]).filter(k=>k!=='question'||agenda.counts.question>0).map(k=><li key={k} data-kind={k}><span>{kindLabels[k]}</span><b>{agenda.counts[k]}</b></li>)}</ul>}
  <div className="agenda-bulk flex flex-wrap gap-2 items-center">{canAct&&quickSignals.length>1&&<Button type="button" size="fit" className="min-h-11" disabled={acting} onClick={()=>void acknowledge(quickSignals)}>새 신호 {quickSignals.length}건 모두 내가 맡기</Button>}
   {chosen.length>0&&<Button type="button" size="fit" className="min-h-11" disabled={acting||!canAct} disabledReason={!canAct?adminOnlyNote():undefined} onClick={()=>void approveSelected()}>선택 승인 {chosen.length}건{costSum(chosen)?` (비용 ${money(costSum(chosen))})`:''}</Button>}
   <small className="text-muted-foreground">자판 <kbd>J</kbd>/<kbd>K</kbd> 이동, <kbd>A</kbd> 승인, <kbd>R</kbd> 수정 요청, <kbd>H</kbd> 미루기</small></div>
  {actMessage&&<p role="status" className="agenda-empty">{actMessage}</p>}
  {results.length>0&&<ul aria-label="일괄 승인 결과" className="text-sm grid gap-1">{results.map(r=><li key={r.id}>{r.title}: {r.ok?r.message:`실패, ${r.message}`}</li>)}</ul>}
  {loading&&!agenda&&<p role="status" className="agenda-empty">안건을 모으고 있습니다.</p>}
  {error&&<p role="alert" className="agenda-error">{error} <CardButton type="button" onClick={()=>void load()}>다시 불러오기</CardButton></p>}
  {agenda&&!items.length&&<EmptyLine next={emptyNext[tab]}>{hidden?`미룬 ${hidden}건 외에 지금 처리할 안건이 없습니다.`:'지금 처리할 안건이 없습니다.'}</EmptyLine>}
  {agenda&&items.length>0&&<ol className="agenda-list" aria-label="안건 목록">{items.map((item,i)=><InboxRow key={item.id} ref={el=>{rows.current[i]=el}} item={item} canAct={canAct} busy={acting} selected={selected.includes(item.id)} changesOpen={changesFor===item.id} disabledReason={adminOnlyNote()} onOpen={open} onApprove={approve} onToggleChanges={(it,o)=>setChangesFor(o?it.id:'')} onRequestChanges={requestChanges} onSnooze={doSnooze} onSelect={(it,on)=>setSelected(ids=>on?[...ids.filter(id=>id!==it.id),it.id]:ids.filter(id=>id!==it.id))}
   quick={canAct&&item.quick?.type==='acknowledge_signal'?<Button type="button" variant="outline" size="fit" className="agenda-quick min-h-11" disabled={acting} aria-label={`${item.title} 내가 맡기`} onClick={()=>void acknowledge([item])}>내가 맡기({date(item.quick.dueBy)}까지)</Button>:undefined}/>)}</ol>}
  {agenda&&agenda.total>agenda.items.length&&<p className="agenda-empty">상위 {agenda.items.length}건만 보입니다(전체 {agenda.total}건).</p>}
 </section>;
}
