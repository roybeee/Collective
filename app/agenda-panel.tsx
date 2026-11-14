'use client';
// 홈 '오늘의 안건'(UX-PLAN P5·결정 2, GLOBAL-PLAN X1 결정 인박스 v2): 탭 전체/결정/질문/알림, 기한 초과 → 결정 대기 → 질문 → 새 신호 → 다가오는 기한.
// 집계는 GET /api/agenda다. 행 본문은 해당 캠페인 탭·성장 섹션으로 이동한다. 행 안 동작은 기존 API만 쓴다: 작업물 승인·수정 요청(POST /api/action review_artifact),
// 발행 승인(POST /api/execution approve, 관리자), 새 신호 '내가 맡기'(POST /api/growth/detections acknowledge). 미루기는 이 기기에만 24시간 남는다(localStorage).
// 자판: J/K 이동, ←/→ 행 안 동작, A 승인, R 수정 요청, H 미루기(입력 칸 밖에서만). 일괄 '선택 승인'은 건수·비용 합계를 확인한 뒤 순차 실행하고 건별 결과를 남긴다. 외부 실행은 없다.
// Tab 순서(e2e/ux-keyboard-tasks 과업 1·3): 탭(한 정지) → 행마다 본문 버튼(+바로 처리) → 목록 아래 일괄 동작·새로고침·자판 안내. 행 안 보조 동작은 Tab 정지가 아니다(components/app/inbox-row.tsx).
// 새로고침·일괄 동작은 목록 아래에 둔다: 첫 행까지 Tab 수를 늘리지 않고, 행 처리 뒤 목록이 자동으로 다시 읽히므로 수동 새로고침은 목록을 본 뒤에 쓴다.
// 행 안 동작 코드(승인·수정 요청 API 호출, components/app/inbox-actions.tsx)는 처음 쓸 때 내려받는다(홈 첫 로딩 JS 예산, tests/ux-budget.json homeJsGzKB).
import {CardButton} from '@/components/app/card-button';
import {useCallback,useEffect,useRef,useState} from 'react';
import {accountRoleLabels,adminOnlyNote,canChange,useAccessCheck,useAccount} from './account-context';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client';
import {RefreshCw} from 'lucide-react';
import type {Agenda,AgendaItem,AgendaTab} from '@/lib/agenda-types';
import {approvable,localAgendaItem,batchSummary,costSum,inboxKey,moveIndex,readSnoozes,runSequentially,snooze,snoozedCount,visibleItems,writeSnoozes,type BatchResult,type SnoozeMap} from '@/lib/agenda-client';
import {date} from '@/lib/format';
import {localMoney as money,t,type MessageKey} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import {bootFetch} from '@/lib/ui/boot-fetch';
import {notifySaved} from '@/lib/ui/notify';
import {askConfirm} from '@/components/app/confirm-dialog';
import {EmptyLine} from '@/components/app/empty-line';
import {Segmented} from '@/components/app/segmented';
import {InboxRow,kindLabels} from '@/components/app/inbox-row';
import {pushNav} from '@/lib/nav-state';
type TabValue='all'|AgendaTab;
const tabLabels:Record<TabValue,MessageKey>={all:'agenda.tab.all',decide:'agenda.tab.decide',ask:'agenda.tab.ask',notify:'agenda.tab.notify'};
const emptyNext:Record<TabValue,MessageKey>={all:'agenda.emptyNext.all',decide:'agenda.emptyNext.decide',ask:'agenda.emptyNext.ask',notify:'agenda.emptyNext.notify'};
const storage=()=>typeof window==='undefined'?undefined:window.localStorage;
const inboxActions=()=>import('@/components/app/inbox-actions');
export function AgendaPanel({onOpen}:{onOpen:(item:AgendaItem)=>void}){
 // 언어가 바뀌면 다시 그린다(useT). 문구는 모듈 함수 t를 써서 불러오기 콜백의 의존성이 바뀌지 않게 한다.
 useT();const [agenda,setAgenda]=useState<Agenda|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[tab,setTab]=useState<TabValue>('all');
 const [snoozed,setSnoozed]=useState<SnoozeMap>({}),[selected,setSelected]=useState<string[]>([]),[changesFor,setChangesFor]=useState(''),[focus,setFocus]=useState(-1),[results,setResults]=useState<BatchResult[]>([]);
 const rows=useRef<(HTMLButtonElement|null)[]>([]),card=useRef<HTMLElement>(null);
 // 행 안 동작 뒤 초점을 남은 첫 행(없으면 카드)에 둔다. 처리한 행이 사라져 초점이 문서로 빠지면 J/K/A/R/H 자판이 끊긴다.
 const refocus=()=>setTimeout(()=>{const next=rows.current.find(el=>el?.isConnected);(next??card.current)?.focus({preventScroll:true})},0);
 const load=useCallback(async(signal?:AbortSignal)=>{setLoading(true);setError('');try{const r=await bootFetch('/api/agenda',{cache:'no-store',signal});const d=await r.json() as Agenda&{error?:string};if(!r.ok)throw new Error(d.error||t('agenda.loadFailed'));if(!signal?.aborted)setAgenda(d);}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:t('agenda.loadFailed'));}finally{if(!signal?.aborted)setLoading(false);}},[]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{setSnoozed(readSnoozes(storage()));return load(c.signal)});return()=>c.abort();},[load]);
 const account=useAccount(),canAct=canChange(account),[acting,setActing]=useState(false),[actMessage,setActMessage]=useState('');
 // 행 안 승인·수정 요청은 행마다 자원(브랜드·지점)으로 판정한다(G7 범위 역할). 대표·관리자·직원은 canAct와 같은 값이다. 새 신호 '내가 맡기'는 그대로 canAct다.
 const access=useAccessCheck(),actionOf=(i:AgendaItem)=>i.action?.type==='approve_publication'?'publish' as const:'approve_artifact' as const;
 const canActOn=(i:AgendaItem)=>access.check(actionOf(i),{brandId:i.brandId??null,storeId:i.storeId??null});
 const denyText=(i:AgendaItem)=>access.deny==='scope'?t(actionOf(i)==='publish'?'access.deniedPublish':'access.deniedApprove'):adminOnlyNote();
 const assignee=account?.email||(account?accountRoleLabels[account.role]:t('agenda.assignee'));
 async function acknowledge(items:AgendaItem[]){
  const targets=items.filter(i=>i.quick?.type==='acknowledge_signal');if(!targets.length||acting)return;
  setActing(true);setActMessage('');let done=0;const failed:string[]=[];
  for(const item of targets){const q=item.quick!;try{const r=await fetch('/api/growth/detections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'acknowledge',campaignId:item.campaignId,campaignVersion:q.campaignVersion,id:q.recordId,expectedVersion:q.version,requestId:clientId(),triage:{assignee,nextAction:q.nextAction,dueBy:q.dueBy}})});if(!r.ok){const d=await r.json().catch(()=>({})) as {error?:string};throw new Error(d.error||t('agenda.ackFailed'));}done++;}catch(e){failed.push(`${item.title}: ${e instanceof Error?e.message:t('agenda.ackFailed')}`);}}
  setActing(false);setActMessage(t('agenda.ackDone',{n:done})+(failed.length?t('agenda.ackSomeFailed',{n:failed.length,list:failed.join(' / ')}):''));await load();
 }
 // 행 안 결정 하나. 성공은 '…습니다.' 한 문장 알림, 실패는 행 목록 위 오류 문장으로 남긴다. 승인 뒤 목록을 다시 불러온다.
 async function act(work:()=>Promise<string|null>){
  if(acting)return;setActing(true);setError('');setResults([]);
  try{const saved=await work();if(saved){notifySaved(saved as `${string}습니다.`);setActMessage(saved);await load();refocus();}}catch(e){setError(e instanceof Error?e.message:t('inbox.failed'))}finally{setActing(false)}
 }
 const approve=(item:AgendaItem)=>void act(async()=>(await inboxActions()).approveAgendaItem(item,{confirm:true}));
 const requestChanges=(item:AgendaItem,message:string)=>void act(async()=>{const saved=await (await inboxActions()).requestArtifactChanges(item,message);setChangesFor('');return saved});
 function doSnooze(item:AgendaItem){const next=snooze(snoozed,item.id);setSnoozed(next);writeSnoozes(storage(),next);setSelected(ids=>ids.filter(id=>id!==item.id));setActMessage(t('agenda.snoozed',{title:item.title}))}
 // 성장 탭이 아닌 출처(작업물·발행·회의·브리프)는 그 캠페인 탭으로 바로 간다. 성장 기록은 기존 경로(섹션·패널 열기)를 쓴다.
 // 캠페인에 묶이지 않은 출처(요금 알림·재동의·플레이스 초안·광고 제안)는 그 화면(nav)으로 간다.
 const open=(item:AgendaItem)=>item.nav?pushNav(item.nav):item.ctab&&item.ctab!=='growth'?pushNav({view:'overview',campaign:item.campaignId,ctab:item.ctab}):onOpen(item);
 // 서버가 만든 제목·설명은 화면 언어로 바꿔 그린다(lib/agenda-client.ts localAgendaItem, 한국어는 그대로).
 const items=agenda?visibleItems(agenda.items,tab==='all'?null:tab,snoozed).map(localAgendaItem):[],hidden=agenda?snoozedCount(agenda.items,snoozed):0;
 const quickSignals=items.filter(i=>i.quick?.type==='acknowledge_signal'),chosen=items.filter(i=>selected.includes(i.id)&&approvable(i));
 async function approveSelected(){
  if(!chosen.length||acting)return;
  const ok=await askConfirm({title:t('agenda.approveSelectedTitle',{n:chosen.length}),fields:{what:chosen.map(i=>i.title).filter((x,i,a)=>a.indexOf(x)===i).join(', '),cost:money(costSum(chosen)),reversible:t('agenda.batchReversible')},impact:t('agenda.batchImpact'),undo:t('agenda.batchUndo'),confirmLabel:t('agenda.approveSelected')});
  if(!ok)return;setActing(true);setError('');
  const {approveAgendaItem}=await inboxActions();
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
  if(key==='approve'&&approvable(item)&&canActOn(item))approve(item);
  else if(key==='changes'&&item.action?.type==='review_artifact'&&canActOn(item))setChangesFor(item.id);
  else if(key==='snooze')doSnooze(item);
 }
 const tabCount=(tab:TabValue)=>agenda?(tab==='all'?agenda.total:agenda.tabs[tab]):0;
 return <section ref={card} tabIndex={-1} className="agenda-card" aria-labelledby="agenda-title" onKeyDown={onKey}><header><div><p className="eyebrow">{t('agenda.eyebrow')}</p><h2 id="agenda-title">{t('agenda.title')}</h2></div></header>
  {agenda&&<Segmented label={t('agenda.tabsLabel')} value={tab} onChange={v=>{setTab(v);setFocus(-1)}} options={(['all','decide','ask','notify'] as TabValue[]).map(v=>({value:v,label:<>{t(tabLabels[v])} <b aria-label={t('agenda.tabCount',{tab:t(tabLabels[v]),n:tabCount(v)})}>{tabCount(v)}</b></>}))}/>}
  {agenda&&<ul className="agenda-counts" aria-label={t('agenda.summary')} aria-live="polite">{(Object.keys(kindLabels) as (keyof typeof kindLabels)[]).filter(k=>k!=='question'||agenda.counts.question>0).map(k=><li key={k} data-kind={k}><span>{t(kindLabels[k])}</span><b>{agenda.counts[k]}</b></li>)}</ul>}
  {actMessage&&<p role="status" className="agenda-empty">{actMessage}</p>}
  {results.length>0&&<ul aria-label={t('agenda.batchResults')} className="text-sm grid gap-1">{results.map(r=><li key={r.id}>{r.title}: {r.ok?r.message:t('agenda.resultFailed',{message:r.message})}</li>)}</ul>}
  {loading&&!agenda&&<p role="status" className="agenda-empty">{t('agenda.loading')}</p>}
  {error&&<p role="alert" className="agenda-error">{error} <CardButton type="button" onClick={()=>void load()}>{t('agenda.reload')}</CardButton></p>}
  {agenda&&!items.length&&<EmptyLine next={t(emptyNext[tab])}>{hidden?t('agenda.emptySnoozed',{n:hidden}):t('agenda.empty')}</EmptyLine>}
  {agenda&&items.length>0&&<ol className="agenda-list" aria-label={t('agenda.list')}>{items.map((item,i)=><InboxRow key={item.id} ref={el=>{rows.current[i]=el}} item={item} canAct={canActOn(item)} busy={acting} selected={selected.includes(item.id)} changesOpen={changesFor===item.id} disabledReason={denyText(item)} onOpen={open} onApprove={approve} onToggleChanges={(it,o)=>setChangesFor(o?it.id:'')} onRequestChanges={requestChanges} onSnooze={doSnooze} onSelect={(it,on)=>setSelected(ids=>on?[...ids.filter(id=>id!==it.id),it.id]:ids.filter(id=>id!==it.id))}
   quick={canAct&&item.quick?.type==='acknowledge_signal'?<Button type="button" data-row-control variant="outline" size="fit" className="agenda-quick min-h-11" disabled={acting} aria-label={t('agenda.ackLabel',{title:item.title})} onClick={()=>void acknowledge([item])}>{t('agenda.ackUntil',{date:date(item.quick.dueBy)})}</Button>:undefined}/>)}</ol>}
  {agenda&&<div className="agenda-bulk flex flex-wrap gap-2 items-center">{canAct&&quickSignals.length>1&&<Button type="button" size="fit" className="min-h-11" disabled={acting} onClick={()=>void acknowledge(quickSignals)}>{t('agenda.ackAll',{n:quickSignals.length})}</Button>}
   {chosen.length>0&&<Button type="button" size="fit" className="min-h-11" disabled={acting||!chosen.every(canActOn)} disabledReason={chosen.find(i=>!canActOn(i))?denyText(chosen.find(i=>!canActOn(i))!):undefined} onClick={()=>void approveSelected()}>{t('agenda.approveSelectedCount',{n:chosen.length})}{costSum(chosen)?t('agenda.withCost',{amount:money(costSum(chosen))}):''}</Button>}
   <CardButton type="button" className="agenda-refresh" aria-label={t('agenda.refreshLabel')} disabled={loading} onClick={()=>void load()}><RefreshCw size={15}/>{t('agenda.refresh')}</CardButton>
   <small className="text-muted-foreground">{t('agenda.keys')} <kbd>J</kbd>/<kbd>K</kbd> {t('agenda.keyMove')}, <kbd>←</kbd>/<kbd>→</kbd> {t('agenda.keyRow')}, <kbd>A</kbd> {t('inbox.approve')}, <kbd>R</kbd> {t('inbox.requestChanges')}, <kbd>H</kbd> {t('inbox.snooze')}</small></div>}
  {agenda&&agenda.total>agenda.items.length&&<p className="agenda-empty">{t('agenda.topOnly',{shown:agenda.items.length,total:agenda.total})}</p>}
 </section>;
}
