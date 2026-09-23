'use client';
import {clientId} from '@/lib/client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Users,Play,Pause,RefreshCw,LoaderCircle,Check,ArrowRight,Download,MessageSquare} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {qualityCriteria,qualityMarkdown} from '@/lib/quality';
import {roles,type Campaign} from '@/lib/agency';
import {api,downloadText,type WorkspaceData} from '@/lib/client';
import {phaseNames,meetingActive,meetingMarkdown,type PublicMeeting,type MeetingStep,type Contribution,type Synthesis,type Revision,type QualityReview} from '@/lib/meetings';

const stateName:Record<string,string>={running:'회의 진행 중',uncertain:'접수 확인 필요',completed:'회의 완료',failed:'회의 중단',cancelled:'중지됨'};
const verdictName={ready_for_review:'사용자 검토 준비',revise:'수정 필요',needs_data:'자료 필요'};
const roleName=(id:string)=>roles.find(r=>r.id===id)?.name||id;
const date=(s:string)=>new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const post=async(action:string,data:Record<string,unknown>)=>await api(action,data,'/api/meetings') as unknown as PublicMeeting;
function Text({label,children}:{label:string;children:React.ReactNode}){return <div className="meeting-text"><h5>{label}</h5><p>{children}</p></div>}
function StepOutput({step,steps}:{step:MeetingStep|PublicMeeting['steps'][number];steps:PublicMeeting['steps']}){
 if(!step.output)return null;
 if(step.phase==='discussion'){const x=step.output as Contribution;return <>{!!x.respondsTo.length&&<div className="meeting-replies"><MessageSquare size={13}/>{x.respondsTo.map(id=>roleName(steps.find(s=>s.id===id)?.role||'' )).join(' · ')} 의견에 답변</div>}<Text label="진단">{x.position}</Text><Text label="근거와 한계">{x.evidence}</Text><Text label="반론·보완">{x.challenge}</Text><Text label="제안·협업 요청">{x.proposal}</Text></>}
 if(step.phase==='synthesis'){const x=step.output as Synthesis;return <><Text label="채택한 방향">{x.decisions}</Text><Text label="남은 이견·보류 이유">{x.disagreements}</Text><Text label="확인할 사실">{x.questions}</Text><div className="meeting-task-list">{x.tasks.map(t=><section key={t.role}><b>{roleName(t.role)}</b><p>{t.instruction}</p><small>선정 이유: {t.reason}</small><small>완료 조건: {t.acceptance}</small></section>)}</div></>}
 if(step.phase==='revision'){const x=step.output as Revision;return <><Text label="반영한 의견과 변경점">{x.changes}</Text><details><summary>{x.title} · 개선본 펼치기</summary><p className="meeting-draft">{x.content}</p></details></>}
 const x=step.output as QualityReview;return <><strong className={'meeting-verdict '+x.verdict}>{verdictName[x.verdict]}</strong><Text label="검수 결론">{x.summary}</Text><Text label="검토 항목과 후속 요청">{x.findings}</Text>{!!x.gateIssues?.length&&<Text label="추가 확인 필요">{x.gateIssues.join("\n")}</Text>}<div className="quality-checks">{x.checks?.map((check,i)=><section key={check.criterion+i}><header><b>{qualityCriteria[check.criterion as keyof typeof qualityCriteria]||check.criterion}</b><span>{check.status==='pass'?'통과':check.status==='revise'?'수정 필요':'자료 필요'}</span></header><p>위치: {check.location}</p><p>{check.finding}</p><p>다음 조치: {check.fix}</p></section>)}</div>{!!x.taskChecks?.length&&<Text label="과제별 완료 검토">{x.taskChecks.map(t=>`${roleName(t.role)} · ${t.status==='pass'?'통과':t.status==='revise'?'수정 필요':'자료 필요'}\n${t.location} · ${t.finding}\n다음 조치: ${t.fix}`).join('\n\n')}</Text>}</>;
}

export function MeetingPanel({campaign,workspace,onUpdated,onOutputs,onConnect}:{campaign:Campaign;workspace:WorkspaceData;onUpdated:()=>Promise<void>;onOutputs:()=>void;onConnect:()=>void}){
 const[meetings,setMeetings]=useState<PublicMeeting[]>([]),[selected,setSelected]=useState(''),[agenda,setAgenda]=useState('현재 캠페인의 가장 큰 약점을 서로 검토하고, 고객 반응을 높일 구체적인 개선안을 만들어 주세요. 근거가 부족한 부분과 검증할 실험도 정리해 주세요.'),[previous,setPrevious]=useState<string|undefined>(),[busy,setBusy]=useState(false),[polling,setPolling]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const current=useRef(meetings);current.current=meetings;const pending=useRef(false),startId=useRef<string|null>(null);
 const load=useCallback(async()=>{const r=await fetch('/api/meetings?campaignId='+encodeURIComponent(campaign.id));const d=await r.json() as {meetings:PublicMeeting[];error?:string};if(!r.ok)throw new Error(d.error||'회의 기록을 불러오지 못했습니다.');setMeetings(d.meetings);setSelected(s=>s||d.meetings.find(meetingActive)?.id||d.meetings[0]?.id||'');setLoaded(true);return d.meetings},[campaign.id]);
 const merge=(m:PublicMeeting)=>setMeetings(rows=>[m,...rows.filter(x=>x.id!==m.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
 useEffect(()=>{void load().catch(e=>setError(e.message))},[load]);
 useEffect(()=>{
  let disposed=false;
  const timer=setInterval(async()=>{const active=current.current.find(meetingActive);if(!active||pending.current||disposed)return;pending.current=true;setPolling(true);
   try{const rows=await load();if(!disposed){setError('');if(!rows.some(m=>m.id===active.id&&meetingActive(m)))await onUpdated()}}
   catch(e){if(!disposed)setError((e as Error).message)}finally{pending.current=false;if(!disposed)setPolling(false)}
  },4000);return()=>{disposed=true;clearInterval(timer)};
 },[load,onUpdated]);
 const active=meetings.find(meetingActive),m=meetings.find(x=>x.id===selected),step=m?.steps.find(s=>s.status!=='completed');
 const connected=workspace.connection.configured&&workspace.connection.provider==='hermes';
 const otherRun=workspace.runs.some(r=>r.campaignId===campaign.id&&r.role!=='meeting'&&['starting','queued','in_progress','uncertain'].includes(r.status));
 async function action(type:'start'|'recover'|'cancel'|'retry_failed'){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{let result:PublicMeeting;
   if(type==='start'){if(!startId.current)startId.current=clientId();result=await post('start',{id:startId.current,campaignId:campaign.id,campaignVersion:campaign.version,agenda,previousMeetingId:previous});startId.current=null;setPrevious(undefined);setSelected(result.id)}
   else if(type==='retry_failed'){if(!m||!step?.retryAvailable)return;result=await post(type,{id:m.id,stepId:step.id,expectedAttempt:step.attempt||0})}
   else{if(!active)return;result=await post(type,{id:active.id})}
   merge(result);await onUpdated();
  }catch(e){setError((e as Error).message)}finally{pending.current=false;setBusy(false)}
 }
 function followUp(){if(!m)return;setPrevious(m.id);setAgenda('이전 회의의 미해결 쟁점과 품질 검토 요청을 우선 해결하고, 최신 작업물을 한 단계 더 개선해 주세요. 필요한 사실과 검증할 실험을 구분하세요.');setSelected('');startId.current=null}
 function exportMeeting(){if(!m)return;downloadText('팀-회의-'+m.id+'.md',meetingMarkdown(m))}
 return <section className="meeting-panel">
  <div className="meeting-heading"><div><p className="eyebrow">TEAM ROUNDTABLE</p><h3>서로의 의견에서, 더 나은 실행안으로.</h3><p>8명 의견 교환 → 총괄의 과제 배정 → 담당자 개선 → 독립 품질 재검토</p></div><Users size={28}/></div>
  {!active&&<div className="meeting-composer"><Label htmlFor={'agenda-'+campaign.id}>{previous?'후속 회의 안건':'회의 안건'}</Label><Textarea id={'agenda-'+campaign.id} value={agenda} onChange={e=>{setAgenda(e.target.value);startId.current=null}} rows={3} maxLength={5000}/><div className="meeting-composer-actions"><span>최대 13단계 · 실패 단계의 추가 실행은 사용자가 선택</span><Button disabled={!loaded||busy||otherRun||!agenda.trim()} onClick={()=>connected&&workspace.worker?.registered?void action('start'):onConnect()}><Play/>{!connected?'HERMES 연결':!workspace.worker?.registered?'서버 작업자 연결':'팀 회의 시작'}</Button></div>{otherRun&&<p className="subtle-note">현재 AI 작업을 완료하거나 취소한 뒤 회의를 시작할 수 있습니다.</p>}</div>}
  <p className="meeting-help">회의는 서버 작업자가 진행하며 화면을 닫아도 이어집니다. 응답 검증 실패는 자동 재시도하지 않습니다. 개선본은 검토 대기로 저장되고 영향받는 후속 작업물은 이전 버전으로 전환됩니다.</p>
  {!workspace.worker?.online&&<p className="form-error" role="status">{workspace.worker?.registered?'서버 작업자 오프라인: 접수된 작업과 기록은 유지되며 작업자가 다시 연결되면 이어집니다.':'서버 작업자가 등록되지 않았습니다. 연결 및 설정에서 등록해 주세요.'}</p>}
  {error&&<div className="meeting-error" role="alert"><p>{error}</p><Button variant="outline" size="sm" onClick={()=>{setError('');void load().catch(e=>setError(e.message))}}><RefreshCw/>다시 확인</Button></div>}
  {active&&<div className="meeting-live" aria-live="polite"><div><span className="meeting-live-dot"/><b>{active.stopRequested?'중지 확인 중':stateName[active.status]}</b><p>{roleName(active.steps.find(s=>s.status!=='completed')?.role||'cmo')} · {phaseNames[active.steps.find(s=>s.status!=='completed')?.phase||'discussion']}</p>{active.error&&<p className="form-error">{active.error}</p>}</div><div>{active.status==='uncertain'&&<Button size="sm" variant="outline" disabled={busy||polling} onClick={()=>void action('recover')}><RefreshCw/>기존 요청 확인</Button>}<Button size="sm" variant="ghost" disabled={busy||polling||active.stopRequested} onClick={()=>void action('cancel')}><Pause/>회의 중지</Button></div></div>}
  {!!meetings.length&&<div className="meeting-history-bar"><NativeSelect aria-label="회의 기록 선택" value={selected} onChange={e=>setSelected(e.target.value)}><NativeSelectOption value="">회의 선택</NativeSelectOption>{meetings.map(x=><NativeSelectOption key={x.id} value={x.id}>{date(x.createdAt)} · {stateName[x.status]} · {x.agenda.slice(0,24)}</NativeSelectOption>)}</NativeSelect>{m&&<Button size="sm" variant="ghost" onClick={exportMeeting}><Download/>회의록</Button>}</div>}
  {m&&<><div className="meeting-session-title"><h4>{m.agenda}</h4><span>{m.steps.filter(s=>s.status==='completed').length}/{m.steps.length} 단계 완료 · 브리프 v{m.campaignVersion}</span></div><div className="meeting-roster">{roles.map(r=>{const s=m.steps.find(s=>s.phase==='discussion'&&s.role===r.id);return <div key={r.id} className={s?.status==='completed'?'done':step?.id===s?.id&&meetingActive(m)?'speaking':''}><span className="role-avatar" style={{background:r.color}}>{s?.status==='completed'?<Check size={15}/>:r.initial}</span><small>{r.name}</small></div>})}</div>
   <div className="meeting-transcript">{m.steps.filter(s=>s.output||s.status!=='pending').map((s,i)=><article className={'meeting-turn '+s.phase} key={s.id}><header><span className="role-avatar" style={{background:roles.find(r=>r.id===s.role)?.color}}>{roles.find(r=>r.id===s.role)?.initial}</span><div><h4>{roleName(s.role)}</h4><span>{phaseNames[s.phase]} · {String(i+1).padStart(2,'0')}</span></div>{s.status==='running'||s.status==='starting'?<LoaderCircle className="spin" size={17}/>:s.status==='completed'?<Check size={17}/>:null}</header><small>시도 {(s.attempt||0)+1} · 토큰 {s.tokens??'미확인'}</small>{!!s.attempts?.length&&<details><summary>이전 실패 기록 {s.attempts.length}건</summary>{s.attempts.map(a=><p key={a.attempt}>시도 {a.attempt+1} · 토큰 {a.tokens??'미확인'} · {a.error}</p>)}</details>}{s.output?<StepOutput step={s} steps={m.steps}/>:<p className="subtle-note">{s.error||'HERMES의 실제 응답을 기다리고 있습니다.'}</p>}</article>)}</div>
   {m.status==='completed'&&<div className="meeting-result"><h4>개선본과 품질 재검토를 작업물에 저장했습니다.</h4><p>아직 사용자 승인 전입니다.{m.invalidatedRoles.length?' '+m.invalidatedRoles.map(roleName).join(' · ')+' 작업은 변경된 방향에 맞춰 다시 작성해야 합니다.':''}</p><Button variant="outline" onClick={onOutputs}>개선된 작업물 보기<ArrowRight/></Button></div>}
   {!meetingActive(m)&&<div className="meeting-followup">{m.error&&<p className="form-error">{m.error}</p>}{step?.retryAvailable&&<><Button variant="outline" disabled={!!active||busy||otherRun||!connected||!workspace.worker?.registered} onClick={()=>void action('retry_failed')}><RefreshCw/>실패 단계 다시 작성</Button><small>완료 발언은 보존합니다. 이 단계에서 {2-(step.attempt||0)}회 남음 · 추가 사용량이 발생합니다.</small></>}<Button variant="outline" disabled={!!active} onClick={followUp}><MessageSquare/>후속 회의 새로 시작</Button><small>완료 발언·중단 사유·검수 결과와 최신 작업물을 새 회의에 전달합니다.</small></div>}
  </>}
  {loaded&&!meetings.length&&<div className="meeting-empty"><MessageSquare size={25}/><h4>첫 회의 안건을 정해 주세요.</h4><p>각 담당자가 별도로 답변하며 앞선 팀원의 의견을 반박하거나 보완합니다. 합의 내용과 담당자의 실제 수정본을 함께 남깁니다.</p></div>}
 </section>;
}
