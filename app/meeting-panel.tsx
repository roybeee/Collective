'use client';
import {t,type MessageKey} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy';
import {cssVars} from '@/lib/ui/css-vars';
import {clientId} from '@/lib/client';
import {metaText} from '@/lib/format';
import {MetaLine} from '@/components/app/meta-line';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Users,Play,Pause,RefreshCw,LoaderCircle,Check,ArrowRight,Download,MessageSquare} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {qualityCriteria,qualityMarkdown} from '@/lib/quality';
import {roles,type Campaign} from '@/lib/agency';
import {api,downloadText,type WorkspaceData} from '@/lib/client';
import {phaseNames,meetingActive,meetingMarkdown,defaultMeetingAgenda,hasDisagreement,latestChoice,type PublicMeeting,type MeetingStep,type MeetingChoice,type MeetingChoiceValue,type Contribution,type Synthesis,type Revision,type QualityReview} from '@/lib/meetings';
// 실행 전 계획 카드(X3)·실행 타임라인(X2)·남은 이견 A/B 선택(X2).
import {PlanCard,usePlanRules} from '@/components/app/plan-card';
import {RunTimeline} from '@/components/app/run-timeline';
import {ChoiceCard} from '@/components/app/choice-card';
import {meetingTimeline,statusView,POLL_RUNNING_MS} from '@/lib/run-timeline';
import {estimateMeetingPlan,MEETING_DEFAULT_STEPS} from '@/lib/token-estimate';
import {EvidenceSummary} from './evidence-summary';
import {notifySaved,type Saved} from '@/lib/ui/notify';

// 상태·판정 이름은 사전 키로 두고 그릴 때 읽는다(모듈을 읽는 시점의 언어에 묶이지 않게).
const stateKeys:Record<string,MessageKey>={running:'meeting.state.running',uncertain:'meeting.state.uncertain',completed:'meeting.state.completed',failed:'meeting.state.failed',cancelled:'meeting.state.cancelled'};
const stateName=(status:string)=>stateKeys[status]?t(stateKeys[status]):undefined;
const verdictKeys={ready_for_review:'meeting.verdict.ready',revise:'meeting.verdict.revise',needs_data:'meeting.verdict.needsData'} as const;
const roleName=(id:string)=>roles.find(r=>r.id===id)?.name||id;
const date=(s:string)=>new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const post=async(action:string,data:Record<string,unknown>)=>await api(action,data,'/api/meetings') as unknown as PublicMeeting;
function Text({label,children}:{label:string;children:React.ReactNode}){return <div className="meeting-text"><h5>{label}</h5><p>{children}</p></div>}
type ChoiceProps={choice?:MeetingChoice;waiting?:boolean;busy?:boolean;onChoose?:(choice:MeetingChoiceValue)=>Promise<void>};
function StepOutput({step,steps,choice,waiting,busy,onChoose}:{step:MeetingStep|PublicMeeting['steps'][number];steps:PublicMeeting['steps']}&ChoiceProps){useT();
 if(!step.output)return null;
 if(step.phase==='discussion'){const x=step.output as Contribution;return <>{!!x.respondsTo.length&&<div className="meeting-replies"><MessageSquare size={13}/>{metaText(x.respondsTo.map(id=>roleName(steps.find(s=>s.id===id)?.role||'' )))}  {t('meeting.repliesTo')}</div>}<Text label={t('meeting.out.diagnosis')}>{x.position}</Text><Text label={t('meeting.out.evidence')}>{x.evidence}</Text><Text label={t('meeting.out.challenge')}>{x.challenge}</Text><Text label={t('meeting.out.proposal')}>{x.proposal}</Text></>}
 if(step.phase==='synthesis'){const x=step.output as Synthesis;return <><Text label={t('meeting.out.decisions')}>{x.decisions}</Text>{onChoose&&hasDisagreement(x)?<ChoiceCard optionA={x.decisions} optionB={x.disagreements} current={choice} waiting={waiting} busy={busy} onChoose={onChoose}/>:<Text label={t('meeting.out.disagreements')}>{x.disagreements}</Text>}<Text label={t('meeting.out.questions')}>{x.questions}</Text><div className="meeting-task-list">{x.tasks.map(task=><section key={task.role}><b>{roleName(task.role)}</b><p>{task.instruction}</p><small>{t('meeting.out.reason')} {task.reason}</small><small>{t('meeting.out.acceptance')} {task.acceptance}</small></section>)}</div></>}
 if(step.phase==='revision'){const x=step.output as Revision;return <><Text label={t('meeting.out.changes')}>{x.changes}</Text><details><summary><MetaLine items={[x.title,t('meeting.out.expand')]}/></summary><p className="meeting-draft">{x.content}</p></details></>}
 const x=step.output as QualityReview;return <><strong className={'meeting-verdict '+x.verdict}>{t(verdictKeys[x.verdict])}</strong><Text label={t('meeting.out.summary')}>{x.summary}</Text><Text label={t('meeting.out.findings')}>{x.findings}</Text>{!!x.gateIssues?.length&&<Text label={t('meeting.out.gateIssues')}>{x.gateIssues.join("\n")}</Text>}<div className="quality-checks">{x.checks?.map((check,i)=><section key={check.criterion+i}><header><b>{qualityCriteria[check.criterion as keyof typeof qualityCriteria]||check.criterion}</b><span>{check.status==='pass'?t('meeting.check.pass'):check.status==='revise'?t('meeting.verdict.revise'):t('meeting.verdict.needsData')}</span></header><p>{t('meeting.out.location')} {check.location}</p><p>{check.finding}</p><p>{t('meeting.out.nextFix')} {check.fix}</p></section>)}</div>{!!x.taskChecks?.length&&<Text label={t('meeting.out.taskChecks')}>{x.taskChecks.map(task=>`${roleName(task.role)}: ${task.status==='pass'?t('meeting.check.pass'):task.status==='revise'?t('meeting.verdict.revise'):t('meeting.verdict.needsData')}\n${task.location}: ${task.finding}\n${t('meeting.out.nextFix')} ${task.fix}`).join('\n\n')}</Text>}</>;
}

export function MeetingPanel({campaign,workspace,onUpdated,onOutputs,onConnect}:{campaign:Campaign;workspace:WorkspaceData;onUpdated:()=>Promise<void>;onOutputs:()=>void;onConnect:()=>void}){useT();
 const[meetings,setMeetings]=useState<PublicMeeting[]>([]),[selected,setSelected]=useState(''),[agenda,setAgenda]=useState(defaultMeetingAgenda),[draft,setDraft]=useState({agenda:'',reviewFixes:0}),[previous,setPrevious]=useState<string|undefined>(),[busy,setBusy]=useState(false),[polling,setPolling]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const current=useRef(meetings);current.current=meetings;const pending=useRef(false),startId=useRef<string|null>(null),edited=useRef(false);
 // 안건 기본값은 서버가 만든 초안(검수 수정 요청·상시 지시)을 따른다. 사용자가 고친 뒤에는 덮어쓰지 않는다.
 const load=useCallback(async()=>{const r=await fetch('/api/meetings?campaignId='+encodeURIComponent(campaign.id));const d=await r.json() as {meetings:PublicMeeting[];agendaDraft?:{agenda:string;reviewFixes:number};error?:string};if(!r.ok)throw new Error(d.error||t('meeting.loadFailed'));setMeetings(d.meetings);if(d.agendaDraft){const next=d.agendaDraft;setDraft(next);if(!edited.current&&next.agenda)setAgenda(next.agenda)}setSelected(s=>s||d.meetings.find(meetingActive)?.id||d.meetings[0]?.id||'');setLoaded(true);return d.meetings},[campaign.id]);
 const merge=(m:PublicMeeting)=>setMeetings(rows=>[m,...rows.filter(x=>x.id!==m.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
 useEffect(()=>{void load().catch(e=>setError(e.message))},[load]);
 useEffect(()=>{
  let disposed=false;
  const timer=setInterval(async()=>{const active=current.current.find(meetingActive);if(!active||pending.current||disposed)return;pending.current=true;setPolling(true);
   try{const rows=await load();if(!disposed){setError('');if(!rows.some(m=>m.id===active.id&&meetingActive(m)))await onUpdated()}}
   catch(e){if(!disposed)setError((e as Error).message)}finally{pending.current=false;if(!disposed)setPolling(false)}
  },POLL_RUNNING_MS);return()=>{disposed=true;clearInterval(timer)};
 },[load,onUpdated]);
 const active=meetings.find(meetingActive),m=meetings.find(x=>x.id===selected),step=m?.steps.find(s=>s.status!=='completed');
 const connected=workspace.connection.configured&&workspace.connection.provider==='hermes';
 const otherRun=workspace.runs.some(r=>r.campaignId===campaign.id&&r.role!=='meeting'&&['starting','queued','in_progress','uncertain'].includes(r.status));
 // 실행 전 계획(X3): 완료 회의의 단계당 평균 토큰·소요와 현재 입력 길이로 추정한다. 적용 규칙 수는 학습·상시 지시 API에서 읽는다.
 const rules=usePlanRules(campaign),brand=workspace.brands.find(b=>b.id===campaign.brandId)??null,currentArtifacts=workspace.artifacts.filter(a=>a.campaignId===campaign.id&&a.status!=='outdated');
 const duration=(from:string,to:string)=>{const a=Date.parse(from),b=Date.parse(to);return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null};
 const stepTokens=(x:PublicMeeting)=>x.steps.reduce((n,s)=>n+(s.tokens||0)+(s.attempts||[]).reduce((sum,a)=>sum+(a.tokens||0),0),0);
 const history=useMemo(()=>meetings.filter(x=>x.status==='completed').map(x=>({tokens:stepTokens(x),durationMs:duration(x.createdAt,x.updatedAt),steps:x.steps.length})),[meetings]);
 const estimate=useMemo(()=>estimateMeetingPlan({roles,campaign,brand,agenda,artifacts:currentArtifacts,directives:rules.directives??0,history}),[campaign,brand,agenda,currentArtifacts,rules.directives,history]);
 const lastDone=meetings.find(x=>x.status==='completed'),outcome=lastDone?.plan?{estimatedTokens:lastDone.plan.estimatedTokens,actualTokens:stepTokens(lastDone),durationMs:duration(lastDone.createdAt,lastDone.updatedAt),title:t('meeting.lastResult')}:null;
 async function action(type:'start'|'recover'|'cancel'|'retry_failed'){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{let result:PublicMeeting;
   if(type==='start'){if(!startId.current)startId.current=clientId();result=await post('start',{id:startId.current,campaignId:campaign.id,campaignVersion:campaign.version,agenda,previousMeetingId:previous,plan:{estimatedTokens:estimate.totalTokens,estimatedMs:estimate.durationMs,steps:MEETING_DEFAULT_STEPS}});startId.current=null;edited.current=false;setPrevious(undefined);setSelected(result.id)}
   else if(type==='retry_failed'){if(!m||!step?.retryAvailable)return;result=await post(type,{id:m.id,stepId:step.id,expectedAttempt:step.attempt||0})}
   else{if(!active)return;result=await post(type,{id:active.id})}
   merge(result);await onUpdated();
  }catch(e){setError((e as Error).message)}finally{pending.current=false;setBusy(false)}
 }
 // 남은 이견 A/B 선택(X2): 기록은 추가만 되고 다음 단계·후속 회의 입력에 전달된다.
 async function choose(meetingId:string,stepId:string,choice:MeetingChoiceValue){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{merge(await post('choose',{id:meetingId,stepId,choice}));notifySaved(t('meeting.choiceSaved') as Saved,{description:t('meeting.choiceNote')})}
  catch(e){setError((e as Error).message)}finally{pending.current=false;setBusy(false)}
 }
 function followUp(){if(!m)return;edited.current=true;setPrevious(m.id);setAgenda('이전 회의의 미해결 쟁점과 품질 검토 요청을 우선 해결하고, 최신 작업물을 한 단계 더 개선해 주세요. 필요한 사실과 검증할 실험을 구분하세요.');setSelected('');startId.current=null}
 function reviewMeeting(){edited.current=false;setPrevious(undefined);setAgenda(draft.agenda);startId.current=null}
 function exportMeeting(){if(!m)return;downloadText(t('meeting.filePrefix')+m.id+'.md',meetingMarkdown(m))}
 // 안건에 쓴 지시를 캠페인 상시 지시로 남기면 이후 역할·회의·브리프 초안의 AI 입력에 함께 전달된다.
 async function saveDirective(){const text=agenda.trim(),id=clientId();setBusy(true);try{await api('add',{campaignId:campaign.id,id,text},'/api/directives');notifySaved(t('meeting.directiveSaved') as Saved,{description:t('meeting.directiveNote'),undo:()=>api('remove',{campaignId:campaign.id,id},'/api/directives'),undone:t('meeting.directiveUndone') as Saved});await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className="meeting-panel">
  <div className="meeting-heading"><div><p className="eyebrow">{t('meeting.eyebrow')}</p><h3>{t('meeting.headline')}</h3><p>{t('meeting.flow')}</p></div><Users size={28}/></div>
  <EvidenceSummary campaignId={campaign.id} artifacts={workspace.artifacts}/>
  {!active&&<div className="meeting-composer"><Label htmlFor={'agenda-'+campaign.id}>{previous?t('meeting.followUpAgenda'):t('meeting.agenda')}</Label><Textarea id={'agenda-'+campaign.id} value={agenda} onChange={e=>{edited.current=true;setAgenda(e.target.value);startId.current=null}} rows={3} maxLength={5000}/><div className="meeting-composer-actions"><span>{t('meeting.maxSteps')}</span>{draft.reviewFixes>0&&<Button variant="outline" disabled={!loaded||busy} disabledReason={!loaded?t('meeting.loading'):undefined} onClick={reviewMeeting}><RefreshCw/>{t('meeting.reviewMeeting')}</Button>}<Button variant="outline" disabled={!loaded||busy||!agenda.trim()} disabledReason={!loaded?t('meeting.loading'):(!agenda.trim())?t('meeting.fillRequired'):undefined} title={t('meeting.directiveLimit')} onClick={()=>void saveDirective()}><Check/>{t('meeting.saveDirective')}</Button>{!(connected&&workspace.worker?.registered)&&<Button onClick={onConnect}><Play/>{!connected?t('meeting.connectHermes'):t('meeting.connectWorker')}</Button>}</div>{otherRun&&<p className="subtle-note">{t('meeting.otherRun')}</p>}
   {connected&&workspace.worker?.registered&&<PlanCard lead={t('meeting.planLead')} estimate={estimate} rules={rules} outcome={outcome} primaryLabel={t('meeting.start')} busy={busy} disabled={!loaded||otherRun||!agenda.trim()} disabledReason={!loaded?t('meeting.loading'):otherRun?t('meeting.busyOther'):(!agenda.trim())?t('meeting.fillRequired'):undefined} onApprove={()=>void action('start')}/>}</div>}
  <p className="meeting-help">{t('meeting.help')}</p>
  {!workspace.worker?.online&&<p className="form-error" role="status">{workspace.worker?.registered?t('meeting.workerOffline'):t('meeting.workerMissing')}</p>}
  {error&&<div className="meeting-error" role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={()=>{setError('');void load().catch(e=>setError(e.message))}}><RefreshCw/>{t('meeting.recheck')}</Button></div>}
  {active&&<div className="meeting-live" aria-live="polite"><div><span className="meeting-live-dot"/><b>{active.stopRequested?t('meeting.stopChecking'):stateName(active.status)}</b><p><MetaLine items={[roleName(active.steps.find(s=>s.status!=='completed')?.role||'cmo'),phaseNames[active.steps.find(s=>s.status!=='completed')?.phase||'discussion'],statusView(active.steps.find(s=>s.status!=='completed')?.status||'pending',active.steps.find(s=>s.status!=='completed')?.phase).label]}/></p>{active.error&&<p className="form-error">{active.error}</p>}</div><div>{active.status==='uncertain'&&<Button size="sm" variant="outline" disabled={busy||polling} onClick={()=>void action('recover')}><RefreshCw/>{t('meeting.recover')}</Button>}<Button size="sm" variant="ghost" disabled={busy||polling||active.stopRequested} disabledReason={active.stopRequested?t('meeting.stopRequested'):undefined} onClick={()=>void action('cancel')}><Pause/>{t('meeting.stop')}</Button></div></div>}
  {!!meetings.length&&<div className="meeting-history-bar"><NativeSelect aria-label={t('meeting.pickRecord')} value={selected} onChange={e=>setSelected(e.target.value)}><NativeSelectOption value="">{t('meeting.pick')}</NativeSelectOption>{meetings.map(x=><NativeSelectOption key={x.id} value={x.id}>{metaText([date(x.createdAt),stateName(x.status),x.agenda.slice(0,24)])}</NativeSelectOption>)}</NativeSelect>{m&&<Button size="sm" variant="ghost" onClick={exportMeeting}><Download/>{t('meeting.minutes')}</Button>}</div>}
  {m&&<><div className="meeting-session-title"><h4>{m.agenda}</h4><span><MetaLine items={[t('meeting.stepsDone',{done:m.steps.filter(s=>s.status==='completed').length,total:m.steps.length}),t('meeting.briefVersion',{version:m.campaignVersion})]}/></span></div><div className="meeting-roster">{roles.map(r=>{const s=m.steps.find(s=>s.phase==='discussion'&&s.role===r.id);return <div key={r.id} className={s?.status==='completed'?'done':step?.id===s?.id&&meetingActive(m)?'speaking':''}><span className="role-avatar tint" ref={cssVars({'--tint':r.color})}>{s?.status==='completed'?<Check size={15}/>:r.initial}</span><small>{r.name}</small></div>})}</div>
   <RunTimeline items={meetingTimeline(m.steps,roleName,p=>phaseNames[p])} label={t('meeting.timeline')} className="my-4"/>
   <div className="meeting-transcript">{m.steps.filter(s=>s.output||s.status!=='pending').map((s,i)=><article className={'meeting-turn '+s.phase} key={s.id}><header><span className="role-avatar tint" ref={cssVars({'--tint':roles.find(r=>r.id===s.role)?.color})}>{roles.find(r=>r.id===s.role)?.initial}</span><div><h4>{roleName(s.role)}</h4><span><MetaLine items={[phaseNames[s.phase],String(i+1).padStart(2,'0')]}/></span></div>{statusView(s.status,s.phase).live?<LoaderCircle className="spin" size={17}/>:s.status==='completed'?<Check size={17}/>:null}<span className="sr-only">{statusView(s.status,s.phase).label}</span></header><small><MetaLine items={[t('meeting.attempt',{n:(s.attempt||0)+1}),t('meeting.tokens',{n:s.tokens??t('meeting.unknown')})]}/></small>{!!s.attempts?.length&&<details><summary>{t('meeting.failedAttempts')} {s.attempts.length}{t('meeting.countUnit')}</summary>{s.attempts.map(a=><p key={a.attempt}><MetaLine items={[t('meeting.attempt',{n:a.attempt+1}),t('meeting.tokens',{n:a.tokens??t('meeting.unknown')}),a.error]}/></p>)}</details>}{s.output?<StepOutput step={s} steps={m.steps} choice={latestChoice(m,s.id)} waiting={m.steps.some(x=>x.phase==='revision'&&x.status==='waiting_for_approval')} busy={busy} onChoose={s.phase==='synthesis'?choice=>choose(m.id,s.id,choice):undefined}/>:<p className="subtle-note">{s.error||(s.status==='waiting_for_approval'?t('meeting.choosePrompt'):t('meeting.waitingHermes'))}</p>}</article>)}</div>
   {m.status==='completed'&&<div className="meeting-result"><h4>{t('meeting.resultSaved')}</h4><p>{t('meeting.notApproved')}{m.invalidatedRoles.length?' '+metaText(m.invalidatedRoles.map(roleName))+t('meeting.invalidated'):''}</p><Button variant="outline" onClick={onOutputs}>{t('meeting.viewOutputs')}<ArrowRight/></Button></div>}
   {!meetingActive(m)&&<div className="meeting-followup">{m.error&&<p className="form-error">{m.error}</p>}{m.stale&&m.status==='failed'&&<p className="subtle-note" role="status">{t('meeting.staleRestart')}</p>}{step?.retryAvailable&&<><Button variant="outline" disabled={!!active||busy||otherRun||!connected||!workspace.worker?.registered} disabledReason={!!active?t('meeting.busyOther'):otherRun?t('meeting.busyOther'):!connected?t('meeting.connectFirst'):(!workspace.worker?.registered)?t('meeting.fillRequired'):undefined} onClick={()=>void action('retry_failed')}><RefreshCw/>{step.storedRepair?t('meeting.completeSaved'):t('meeting.rewriteFailed')}</Button><small>{step.storedRepair?t('meeting.savedValid'):t('meeting.retriesLeft',{n:2-(step.attempt||0)})}</small></>}<Button variant="outline" disabled={!!active} disabledReason={!!active?t('meeting.busyOther'):undefined} onClick={followUp}><MessageSquare/>{t('meeting.followUp')}</Button><small>{t('meeting.followUpNote')}</small></div>}
  </>}
  {loaded&&!meetings.length&&<div className="meeting-empty"><MessageSquare size={25}/><h4>{t('meeting.emptyTitle')}</h4><p>{t('meeting.emptyLead')}</p></div>}
 </section>;
}
