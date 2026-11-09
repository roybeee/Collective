'use client';
// G3 자율성 규칙·예약 실행 설정 카드. 레인 소유자가 app/panels.tsx 설정 화면에 붙인다(이 파일은 내보내기만 한다).
// 행동마다 자동·확인 후·금지 3단 선택과 등급 표지를 보이고, 고위험 행동의 '자동'은 비활성 이유로 막는다. 예약 목록과 추가 폼은 아래 카드다.
import {useCallback,useEffect,useRef,useState} from 'react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {DataTable} from '@/components/app/data-table';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {Note} from '@/components/app/note';
import {SafetyScope} from '@/components/app/safety-scope';
import {Segmented} from '@/components/app/segmented';
import {dateTime} from '@/lib/format';
import {notifySaved} from '@/lib/ui/notify';
import {AUTONOMY_MODE_LABELS,type AutonomyAction,type AutonomyMode,type AutonomySettings} from '@/lib/autonomy';
import type {AutonomyView} from '@/lib/autonomy-server';
import {SCHEDULE_ACTIONS,SCHEDULE_ACTION_LABELS,SCHEDULE_KINDS,SCHEDULE_KIND_LABELS,WEEKDAY_LABELS,describeSpec,scheduleTitle,type Schedule,type ScheduleAction,type ScheduleKind,type ScheduledRun} from '@/lib/scheduled-runs';
import type {ScheduledRunsView} from '@/lib/scheduled-runs-server';
import styles from './growth-panel.module.css';

type ActionRow=AutonomyView['actions'][number];
const runStatus:Record<ScheduledRun['status'],string>={completed:'완료',skipped:'건너뜀',failed:'실패'};
const EDIT_REASON='소유자·관리자만 바꿀 수 있습니다.';
const HOURS=Array.from({length:24},(_,h)=>h);

async function request<T>(url:string,init:RequestInit={}):Promise<T>{
 const response=await fetch(url,{...init,cache:'no-store'}),raw:unknown=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(raw&&typeof raw==='object'&&typeof (raw as {error?:unknown}).error==='string'?(raw as {error:string}).error:'요청을 처리하지 못했습니다.');
 if(!raw||typeof raw!=='object')throw new Error('응답을 확인하지 못했습니다.');
 return raw as T;
}
const post=(url:string,body:unknown,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

function ModeControl({row,value,onChange,disabled}:{row:ActionRow;value:AutonomyMode;onChange:(mode:AutonomyMode)=>void;disabled:boolean}){
 const options=row.allowedModes.map(mode=>({value:mode,label:AUTONOMY_MODE_LABELS[mode]}));
 return <div className={styles.actions}><Segmented label={`${row.label} 모드`} value={value} options={options} onChange={onChange} disabled={disabled}/>
  {row.disabledReason&&<Button type="button" variant="panel" size="fit" disabled disabledReason={row.disabledReason}>{AUTONOMY_MODE_LABELS.auto}</Button>}</div>;
}

function RulesCard(){
 const [view,setView]=useState<AutonomyView|null>(null),[draft,setDraft]=useState<AutonomySettings|null>(null);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false);
 const load=useCallback(async()=>{setLoading(true);setError('');try{const next=await request<AutonomyView>('/api/autonomy');if(mounted.current){setView(next);setDraft(next.settings);}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'자율성 규칙을 조회하지 못했습니다.');}finally{if(mounted.current)setLoading(false);}},[]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;};},[load]);
 const dirty=!!view&&!!draft&&view.actions.some(a=>draft[a.action]!==view.settings[a.action]);
 const canEdit=view?.canEdit===true;
 async function save(){
  if(!view||!draft||saving)return;setSaving(true);setError('');
  try{const next=await request<AutonomyView>('/api/autonomy',post('/api/autonomy',{settings:draft,expectedVersion:view.version},'PUT'));if(!mounted.current)return;setView(next);setDraft(next.settings);notifySaved('자율성 규칙을 저장했습니다.',{description:next.enabled?'다음 요청부터 적용됩니다.':'스위치가 꺼져 있어 모든 행동은 확인 후로 동작합니다.'});}
  catch(e){if(mounted.current)setError(`${e instanceof Error?e.message:'저장하지 못했습니다.'} 입력은 보존했습니다.`);}
  finally{if(mounted.current)setSaving(false);}
 }
 const set=(action:AutonomyAction,mode:AutonomyMode)=>setDraft(d=>d?{...d,[action]:mode}:d);
 return <section aria-label="자율성 규칙" className={styles.mission}>
  <header className={styles.header}><div><h3>자율성 규칙</h3><p>행동마다 자동, 확인 후, 금지를 정합니다.</p></div><Button type="button" variant="panel" size="fit" disabled={loading||saving} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>금지한 행동은 요청 즉시 거절됩니다. 자동은 저위험 행동에만 둘 수 있고, 지금은 응답에 표시만 하며 실행 흐름은 그대로입니다. 스위치가 꺼져 있으면 모두 확인 후로 동작합니다.</Note>
  <SafetyScope>발행 접수, 광고 활성화, 예산 변경, 고객 발송, 정책 변경은 사람이 확인하거나 금지만 가능합니다.</SafetyScope>
  {loading&&<p role="status">자율성 규칙을 확인하고 있습니다.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
  {view&&draft&&<>
   <p><MetaLine items={[view.enabled?'규칙 적용 중':'스위치 꺼짐(모두 확인 후)',`v${view.version}`,view.updatedAt?`마지막 저장 ${dateTime(view.updatedAt)}`:'저장 기록 없음']}/></p>
   <DataTable caption="행동별 자율성 규칙" rows={view.actions} rowKey={r=>r.action} columns={[
    {label:'행동',cell:r=>r.label},
    {label:'등급',cell:r=><Badge variant={r.disabledReason?'destructive':'outline'}>{r.tier}</Badge>,sort:r=>r.tier},
    {label:'모드',cell:r=><ModeControl row={r} value={draft[r.action]} onChange={mode=>set(r.action,mode)} disabled={!canEdit||saving}/>},
   ]}/>
   <div className={styles.actions}><Button type="button" variant="panel" size="fit" disabled={!canEdit||!dirty||saving} disabledReason={!canEdit?EDIT_REASON:!dirty?'바뀐 항목이 없습니다.':undefined} onClick={()=>void save()}>규칙 저장</Button>
    <Button type="button" variant="panel" size="fit" disabled={!dirty||saving} disabledReason={!dirty?'바뀐 항목이 없습니다.':undefined} onClick={()=>setDraft(view.settings)}>바꾼 내용 되돌리기</Button></div>
  </>}
 </section>;
}

type Form={kind:ScheduleKind;action:ScheduleAction;campaignId:string;weekdays:number[];hour:number;title:string};
const blankForm=():Form=>({kind:'weekly_performance_summary',action:'create_meeting_draft',campaignId:'',weekdays:[1],hour:9,title:''});

function ScheduleForm({view,busy,onSave}:{view:ScheduledRunsView;busy:boolean;onSave:(form:Form,brandId:string)=>Promise<boolean>}){
 const [form,setForm]=useState<Form>(blankForm);
 const campaign=view.campaigns.find(c=>c.id===form.campaignId);
 const missing=!campaign?'캠페인을 고르세요.':!form.weekdays.length?'요일을 하나 이상 고르세요.':'';
 const toggleDay=(d:number,on:boolean)=>setForm(f=>({...f,weekdays:on?[...new Set([...f.weekdays,d])].sort((a,b)=>a-b):f.weekdays.filter(x=>x!==d)}));
 return <form onSubmit={e=>{e.preventDefault();if(!campaign||missing)return;void onSave(form,campaign.brandId).then(ok=>{if(ok)setForm(blankForm());});}}>
  <fieldset disabled={busy||!view.canEdit} className={styles.receipt}><legend>새 예약</legend>
   <label>종류<NativeSelect value={form.kind} onChange={e=>setForm(f=>({...f,kind:e.target.value as ScheduleKind}))}>{SCHEDULE_KINDS.map(k=><option key={k} value={k}>{SCHEDULE_KIND_LABELS[k]}</option>)}</NativeSelect></label>
   <label>행동<NativeSelect value={form.action} onChange={e=>setForm(f=>({...f,action:e.target.value as ScheduleAction}))}>{SCHEDULE_ACTIONS.map(a=><option key={a} value={a}>{SCHEDULE_ACTION_LABELS[a]}</option>)}</NativeSelect></label>
   <label>캠페인<NativeSelect value={form.campaignId} onChange={e=>setForm(f=>({...f,campaignId:e.target.value}))}><option value="">캠페인 선택</option>{view.campaigns.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</NativeSelect></label>
   <div role="group" aria-label="요일(KST)" className={styles.actions}>{WEEKDAY_LABELS.map((label,d)=><label key={d}><Checkbox checked={form.weekdays.includes(d)} onCheckedChange={v=>toggleDay(d,v===true)}/> {label}</label>)}</div>
   <label>시각(KST)<NativeSelect value={String(form.hour)} onChange={e=>setForm(f=>({...f,hour:Number(e.target.value)}))}>{HOURS.map(h=><option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>)}</NativeSelect></label>
   <label>예약 이름(선택)<Input value={form.title} maxLength={120} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/></label>
   <div className={styles.actions}><Button type="submit" variant="panel" size="fit" disabled={busy||!view.canEdit||!!missing} disabledReason={!view.canEdit?EDIT_REASON:missing||undefined}>예약 저장</Button></div>
  </fieldset>
 </form>;
}

function SchedulesCard(){
 const [view,setView]=useState<ScheduledRunsView|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(false);
 const load=useCallback(async()=>{setLoading(true);setError('');try{const next=await request<ScheduledRunsView>('/api/scheduled-runs');if(mounted.current)setView(next);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'예약을 조회하지 못했습니다.');}finally{if(mounted.current)setLoading(false);}},[]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;};},[load]);
 async function send(body:Record<string,unknown>,saved:`${string}습니다.`){
  if(busy)return false;setBusy(true);setError('');
  try{const next=await request<ScheduledRunsView>('/api/scheduled-runs',post('/api/scheduled-runs',body));if(!mounted.current)return false;setView(next);notifySaved(saved);return true;}
  catch(e){if(mounted.current)setError(`${e instanceof Error?e.message:'저장하지 못했습니다.'} 입력은 보존했습니다.`);return false;}
  finally{if(mounted.current)setBusy(false);}
 }
 const campaignTitle=(id:string)=>view?.campaigns.find(c=>c.id===id)?.title??id;
 const editReason=view?.canEdit?undefined:EDIT_REASON;
 return <section aria-label="예약 실행" className={styles.mission}>
  <header className={styles.header}><div><h3>예약 실행</h3><p>정한 요일과 시각이 지나면 하루 한 번 실행합니다.</p></div><Button type="button" variant="panel" size="fit" disabled={loading||busy} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>주간 성과 요약은 최근 7일 성과 기록을 회의 안건 초안으로 적습니다. 일일 신호 검토는 오늘의 안건에 검토 항목을 올립니다. 회의 시작과 게시는 사람이 누릅니다.</Note>
  {loading&&<p role="status">예약을 확인하고 있습니다.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
  {view&&<>
   <p><MetaLine items={[view.enabled?'예약 실행 켜짐':'스위치 꺼짐(예약은 편집만 가능)',`오늘 ${view.today}`]}/></p>
   {view.schedules.length?<DataTable caption="예약 목록" rows={view.schedules} rowKey={s=>s.id} columns={[
    {label:'이름',cell:s=>scheduleTitle(s)},
    {label:'행동',cell:s=>SCHEDULE_ACTION_LABELS[s.action]},
    {label:'캠페인',cell:s=>campaignTitle(s.campaignId),sort:s=>campaignTitle(s.campaignId)},
    {label:'시각',cell:s=>describeSpec(s.spec)},
    {label:'상태',cell:s=><Badge variant={s.enabled?'default':'outline'}>{s.enabled?'켜짐':'꺼짐'}</Badge>},
    {label:'관리',cell:(s:Schedule)=><div className={styles.actions}>
     <Button type="button" variant="panel" size="fit" disabled={busy||!view.canEdit} disabledReason={editReason} onClick={()=>void send({action:'set_enabled',id:s.id,enabled:!s.enabled},s.enabled?'예약을 꺼 두었습니다.':'예약을 켰습니다.')}>{s.enabled?'끄기':'켜기'}</Button>
     <Button type="button" variant="panel" size="fit" disabled={busy||!view.canEdit} disabledReason={editReason} onClick={()=>void send({action:'remove',id:s.id},'예약을 지웠습니다.')}>삭제</Button></div>},
   ]}/>:<EmptyLine first={view.canEdit?'예약':undefined} next={view.canEdit?undefined:'소유자·관리자가 아래 폼으로 만듭니다.'}>등록된 예약이 없습니다.</EmptyLine>}
   <ScheduleForm view={view} busy={busy} onSave={(form,brandId)=>send({action:'save',schedule:{kind:form.kind,action:form.action,brandId,campaignId:form.campaignId,spec:{weekdays:form.weekdays,hour:form.hour},title:form.title}},'예약을 저장했습니다.')}/>
   {view.runs.length>0&&<DataTable caption="최근 실행 기록" rows={view.runs} rowKey={r=>r.id} limit={10} columns={[
    {label:'기간',cell:r=>r.period,sort:r=>r.period},
    {label:'행동',cell:r=>SCHEDULE_ACTION_LABELS[r.action]},
    {label:'결과',cell:r=><MetaLine items={[runStatus[r.status],r.reason]}/>},
    {label:'기록 시각',cell:r=>dateTime(r.generatedAt),sort:r=>r.generatedAt},
   ]}/>}
  </>}
 </section>;
}

export function AutonomyPanel(){
 return <div className={styles.receipt}><RulesCard/><SchedulesCard/></div>;
}
