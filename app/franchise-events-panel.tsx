'use client';
// 가맹 모집 화면 '행사' 탭(트랙 R R15a-2b): 설명회·견학·박람회 목록, 행사 뒤 48시간 연락 칩, 등록·변경 대화상자(대표·관리자·분기 A), 취소(스위치가 꺼져도), 신청(가명 코드)·참석 기록(모든 역할).
// 판정·권한은 서버(/api/franchise)가 한다. 화면은 보기 응답으로 버튼을 숨기고 사전 검사(가명 코드 형식·건수)로 헛요청만 줄인다. 참가자 이름·연락처 칸은 없다.
// 비용 참조(R5c): 대표·관리자에게 같은 브랜드의 유효한 모집 비용(GET spend)을 선택지로 보인다. 고르지 않으면 null이고, 무효화된 비용은 서버가 400으로 막는다.
// 신청은 판 번호 없이 추가만 하는 비멱등 작업이라, 응답을 못 받은 같은 내용의 재시도만 같은 요청 번호를 쓴다(sendAttempt).
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toKstDate,kstDateOf} from '@/lib/franchise-rules';
import {franchiseGet,problemOf,messageOf,ProblemBox,Disclaimer,TimeField,WarningLines,kst,roleLabel,timeOf,stringWarnings,sendAttempt,followUpOf,reasonCodes,errorIs,won,
 type Json,type Problem,type PostResult,type Attempt,type TimeValue} from './franchise-common';

type CodeState='applied'|'attended'|'no_show';
type Ref={id:string;version:number};
export type EventItem={id:string;campaignId:string;type:string;typeLabel:string;startsAt:string;placeLabel:string;capacity:number;counts:{applied:number;attended:number;noShow:number};
 codes:{code:string;state:CodeState}[];assetRefs:{id:string;version:number;type:string|null;status:string|null}[];status:'scheduled'|'cancelled';version:number;spendRef?:string|null;
 createdBy:{id:string;role:string};cancelledAt?:string;cancelledBy?:{id:string;role:string}};
export type EventsView={events:EventItem[];followUps:{count:number;attended:number;noShow:number};approvedAssets:{id:string;version:number;type:string;typeLabel:string;latest:boolean}[];
 campaigns:{id:string;title:string}[];types:{type:string;label:string}[];assetTypes:{type:string;label:string}[];branch:string|null;h7Notice:string|null;enabled:boolean;disclaimer:string};

// ── 표시값(판정 규칙이 아니다. 한도·형식은 서버가 다시 본다) ──
export const EVENT_STATUS_LABELS:Readonly<Record<EventItem['status'],string>>={scheduled:'예정',cancelled:'취소'};
export const CODE_STATE_LABELS:Readonly<Record<CodeState,string>>={applied:'신청',attended:'참석',no_show:'불참'};
export const CODE_HINT='리드 코드(L로 시작)나 명찰 번호만. 이름·전화번호는 적지 않습니다.';
export const CANCEL_CONFIRM='행사를 취소합니다. 신청·참석 기록은 남고 되돌릴 수 없습니다.';
export const EVENTS_OFF_NOTE='기능 스위치가 꺼져 있어 행사 등록·변경·신청·참석 기록을 할 수 없습니다. 행사 취소는 할 수 있습니다.';
export const EDIT_BRANCH_NOTE='가맹 준비도 분기 A(모집 가능) 브랜드만 행사를 등록·변경합니다.';
export const LABEL_MAX=100,CAPACITY_MAX=1000,ASSET_REFS_MAX=10;
const CODE_STATES=Object.keys(CODE_STATE_LABELS) as CodeState[];
const STARTED_NOTE='시작한 행사입니다. 현장 참석은 참석 기록으로 남기세요.',FULL_NOTE='정원이 찼습니다.',BEFORE_DAY_NOTE='참석 기록은 행사일(KST)부터 할 수 있습니다.',BRANCH_NOTE='가맹 준비도 분기 A(모집 가능) 브랜드만 신청을 기록합니다.';
// 가명 코드 사전 검사: 서버 규칙(lib/franchise-assets.ts PSEUDONYM_PATTERN·숫자 7자리 금지)의 사본이다. 같은 판정인지 tests/franchise-ui.test.mjs U10이 서버 판정과 대조한다.
const CODE_PATTERN=/^[A-Za-z0-9_-]{6,64}$/,LONG_DIGITS=/\d{7}/;
const CODE_PROBLEM='가명 코드는 영문·숫자·-·_ 6~64자입니다. 숫자 7자리 이상(전화번호 형태)은 받지 않습니다.';

// ── 순수 도우미(단위 검사 대상) ──
export type EventGates={canEdit:boolean;canCancel:boolean;canRegister:boolean;canAttend:boolean;registerWhy:string|null;attendWhy:string|null};
// 변경은 대표·관리자·스위치 켜짐·예정·분기 A, 취소는 대표·관리자·예정(스위치가 꺼져도), 신청은 스위치 켜짐·예정·시작 전·정원 미만·분기 A, 참석은 스위치 켜짐·예정·행사일(KST) 이후(분기는 보지 않는다).
export function eventGates(e:EventItem,admin:boolean,enabled:boolean,branch:string|null,nowIso:string):EventGates{
 const sch=e.status==='scheduled',a=branch==='A',started=Date.parse(nowIso)>=Date.parse(e.startsAt),day=toKstDate(nowIso)>=kstDateOf(e.startsAt),full=e.counts.applied>=e.capacity;
 const open=enabled&&sch,canRegister=open&&!started&&!full&&a,canAttend=open&&day;
 return {canEdit:admin&&enabled&&sch&&a,canCancel:admin&&sch,canRegister,canAttend,
  registerWhy:!open||canRegister?null:started?STARTED_NOTE:full?FULL_NOTE:BRANCH_NOTE,attendWhy:!open||canAttend?null:BEFORE_DAY_NOTE};
}
export function codeProblem(code:string):string|null{return code===''||(CODE_PATTERN.test(code)&&!LONG_DIGITS.test(code.replace(/[-_]/g,'')))?null:CODE_PROBLEM}
export const kstLocal=(iso:string)=>new Date(Date.parse(iso)+9*3600000).toISOString().slice(0,16);
export function registerInput(e:EventItem,code:string):{payload:Json|null;problem:string|null}{const c=code.trim(),problem=codeProblem(c);return problem?{payload:null,problem}:{payload:{eventId:e.id,code:c||null},problem:null}}
const countOf=(v:string)=>/^\d+$/.test(v.trim())?Number(v.trim()):null;
// 참석 기록: 건수는 0 이상의 정수, 참석 ≤ 정원, 불참 ≤ 신청. 코드 표시는 이번 입력이 전체 설정이라 신청이 아닌 코드만 코드 순으로 보낸다(적지 않은 코드는 신청으로 돌아간다).
export function attendanceInput(e:EventItem,attended:string,noShow:string,marks:Readonly<Record<string,CodeState>>):{payload:Json|null;problem:string|null}{
 const a=countOf(attended),n=countOf(noShow),bad=(problem:string)=>({payload:null,problem});
 if(a===null||n===null||!Number.isSafeInteger(a)||!Number.isSafeInteger(n))return bad('참석·불참 수는 0 이상의 정수로 적습니다.');
 if(a>e.capacity)return bad(`참석 수는 정원(${e.capacity}명)을 넘을 수 없습니다.`);
 if(n>e.counts.applied)return bad(`불참 수는 신청 수(${e.counts.applied}명)를 넘을 수 없습니다.`);
 const codes=e.codes.map(c=>({code:c.code,state:marks[c.code]??c.state})).filter(c=>c.state!=='applied').sort((x,y)=>x.code<y.code?-1:x.code>y.code?1:0);
 if(codes.filter(c=>c.state==='attended').length>a)return bad('참석으로 표시한 코드가 참석 수보다 많습니다.');
 if(codes.filter(c=>c.state==='no_show').length>n)return bad('불참으로 표시한 코드가 불참 수보다 많습니다.');
 return {payload:{eventId:e.id,version:e.version,attended:a,noShow:n,codes},problem:null};
}
export type EventForm={type:string;campaignId:string;start:TimeValue;place:string;capacity:string;refs:Ref[];spendRef?:string};
// 비용 선택지: 모집 비용 보기(GET spend)의 유효 행만. 라벨은 채널·기간·부가세 제외 금액이다. 보기 모양이 다르면 빈 목록이다.
export type SpendChoice={id:string;label:string};
type SpendRowLite={id:string;channel:string;period:{from:string;to:string};amountExVat:number;status:string};
export function spendChoices(view:unknown):SpendChoice[]{
 const v=view as {spend?:unknown;channels?:unknown}|null,rows=Array.isArray(v?.spend)?v.spend as SpendRowLite[]:[],channels=Array.isArray(v?.channels)?v.channels as {key:string;label:string}[]:[];
 const name=(k:string)=>channels.find(c=>c.key===k)?.label??k,span=(p:{from:string;to:string})=>p.from===p.to?p.from:`${p.from}~${p.to}`;
 return rows.filter(r=>r.status==='active').map(r=>({id:r.id,label:`${name(r.channel)} ${span(r.period)} · ${won(r.amountExVat)}`}));
}
// 행사 저장 결과: 개인정보가 든 장소(PII_IN_TEXT)면 대화상자가 장소 칸에 포커스한다(9.2).
export type EventSaveOutcome='ok'|'pii'|'failed';
// 행사 저장: 시작 시각은 KST로 적은 값만(‘지금’은 보내지 않는다), 비용 참조는 고른 비용 id(없으면 null), 변경은 판 번호와 저장된 캠페인을 그대로 보낸다.
export function eventInput(f:EventForm,event:EventItem|null):Json{
 return {...(event?{eventId:event.id,version:event.version}:{}),campaignId:event?event.campaignId:f.campaignId,type:f.type,startsAt:timeOf({now:false,local:f.start.local}),placeLabel:f.place.trim(),capacity:Number(f.capacity),spendRef:f.spendRef||null,
  assetRefs:f.refs.map(r=>({id:r.id,version:r.version}))};
}
const resultOf=(r:PostResult)=>(r.body.result??{}) as Json;
const sameRef=(a:Ref,b:Ref)=>a.id===b.id&&a.version===b.version;

// ── 탭 본체 ──
export function FranchiseEvents({brandId,admin,onStatus,initial}:{brandId:string;admin:boolean;onStatus:()=>void;initial?:EventsView}){
 const [view,setView]=useState<EventsView|null>(initial??null),[error,setError]=useState(''),[now,setNow]=useState(()=>new Date().toISOString());
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[problem,setProblem]=useState<Problem|null>(null);
 const [attempts,setAttempts]=useState<Record<string,Attempt>>({}),[dialog,setDialog]=useState<{eventId:string|null}|null>(null),[spends,setSpends]=useState<SpendChoice[]>([]);
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const d=await franchiseGet<EventsView>({view:'events',brandId},signal);if(!signal?.aborted){setView(d);setError('');setNow(new Date().toISOString())}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
  // 비용 선택지(대표·관리자만 읽는다). 읽지 못하면 선택지 없이 연결 없음만 보인다.
  if(admin)try{const s=await franchiseGet<Json>({view:'spend',brandId},signal);if(!signal?.aborted)setSpends(spendChoices(s))}catch{/* 비용 보기 없이도 행사는 저장한다. */}
 },[brandId,admin]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 async function run(action:string,payload:Json):Promise<PostResult>{
  setBusy(true);setProblem(null);setMessage('');setWarnings([]);
  try{const {r,next}=await sendAttempt(action,{brandId,...payload},attempts[action]??null);setAttempts(a=>({...a,[action]:next}));return r}
  finally{setBusy(false)}
 }
 function fail(r:PostResult){
  setProblem({...problemOf(r),warnings:undefined});
  const next=followUpOf(r);
  if(next==='close'){setDialog(null);void load()}
  else if(next==='reload'||reasonCodes(r).includes('code_unknown'))void load();
  else if(next==='status'){onStatus();void load()}
 }
 function done(r:PostResult,text:string){setMessage((r.body.replayed===true?'이미 처리된 요청입니다. ':'')+text);setWarnings(stringWarnings(r));void load()}
 async function saveEvent(payload:Json):Promise<EventSaveOutcome>{const r=await run('event_save',payload);if(r.status===200){setDialog(null);done(r,'행사를 저장했습니다.');return 'ok'}fail(r);return errorIs(r,'PII_IN_TEXT')?'pii':'failed'}
 async function cancel(e:EventItem){
  if(!window.confirm(CANCEL_CONFIRM))return;
  const r=await run('event_cancel',{eventId:e.id,version:e.version});
  if(r.status===200){done(r,resultOf(r).unchanged===true?'이미 취소된 행사입니다.':'행사를 취소했습니다.');return}
  fail(r);
 }
 async function register(e:EventItem,payload:Json){
  const r=await run('event_register',payload),counts=resultOf(r).counts as {applied?:number}|undefined;
  if(r.status===200){done(r,`신청을 기록했습니다(신청 ${counts?.applied??'-'}/${e.capacity}).`);return true}
  fail(r);return false;
 }
 async function attend(payload:Json){const r=await run('event_attendance',payload);if(r.status===200){done(r,'참석을 기록했습니다.');return true}fail(r);return false}
 const canCreate=!!view&&admin&&view.enabled&&view.branch==='A'&&view.campaigns.length>0;
 const editing=dialog&&view?(dialog.eventId===null?null:view.events.find(x=>x.id===dialog.eventId)??null):null;
 return <div className="franchise-panel">
  <div className="franchise-bar"><h3>설명회·견학·박람회</h3>{canCreate&&<Button onClick={()=>{setProblem(null);setDialog({eventId:null})}}><Plus/>새 행사</Button>}</div>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>}
  {!view?!error&&<p role="status">행사를 불러오고 있습니다.</p>:<>
   {view.followUps.count>0&&<p className="franchise-chips" role="note">{`행사 뒤 48시간 연락: 행사 ${view.followUps.count}건 · 참석 ${view.followUps.attended} · 불참 ${view.followUps.noShow} · 리드 탭에서 리드 코드로 찾아 연락 기록을 남기세요.`}</p>}
   {view.h7Notice&&<p className="notice" role="note">{view.h7Notice}</p>}
   {!view.enabled&&<p className="notice" role="note">{EVENTS_OFF_NOTE}</p>}
   {view.events.length?<ul className="franchise-list" aria-label="행사 목록">{view.events.map(e=><EventRow key={e.id} e={e} view={view} admin={admin} now={now} busy={busy}
     onEdit={()=>{setProblem(null);setDialog({eventId:e.id})}} onCancel={()=>void cancel(e)} onRegister={p=>register(e,p)} onAttend={attend}/>)}</ul>
    :<p className="subtle-note">등록된 설명회·견학·박람회가 없습니다.</p>}
   <Disclaimer/>
  </>}
  {(message||problem||warnings.length>0)&&!dialog&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<WarningLines items={warnings}/><ProblemBox problem={problem}/></div>}
  {dialog&&view&&(dialog.eventId===null||editing)&&<EventEditor key={dialog.eventId??'new'} view={view} event={editing} busy={busy} problem={problem} spends={spends} onSave={saveEvent} onCancel={()=>{setDialog(null);setProblem(null)}}/>}
 </div>;
}

function EventRow({e,view,admin,now,busy,onEdit,onCancel,onRegister,onAttend}:{e:EventItem;view:EventsView;admin:boolean;now:string;busy:boolean;onEdit:()=>void;onCancel:()=>void;onRegister:(p:Json)=>Promise<boolean>;onAttend:(p:Json)=>Promise<boolean>}){
 const g=eventGates(e,admin,view.enabled,view.branch,now);
 const typeName=(t:string|null)=>t?view.assetTypes.find(x=>x.type===t)?.label??t:'자료',state=(s:string|null)=>s==='approved'?'승인':s==='retired'?'폐기':'확인 불가';
 const refs=e.assetRefs.length?e.assetRefs.map(r=>`${typeName(r.type)} v${r.version} (${state(r.status)})`).join(' · '):'없음',row=`${e.typeLabel} ${kst(e.startsAt)}`;
 return <li>
  <div className="franchise-bar"><b>{e.typeLabel}</b><span>{kst(e.startsAt)}</span><span className="status">{EVENT_STATUS_LABELS[e.status]}</span></div>
  <p className="subtle-note">{`${e.placeLabel} · 정원 ${e.capacity} · 신청 ${e.counts.applied} · 참석 ${e.counts.attended} · 불참 ${e.counts.noShow}`}</p>
  <p className="subtle-note">{`연결 자료: ${refs}`}</p>
  {e.status==='cancelled'&&<p className="subtle-note">{`취소 ${kst(e.cancelledAt)} · ${e.cancelledBy?roleLabel(e.cancelledBy.role):'-'}`}</p>}
  {(g.canEdit||g.canCancel)&&<div className="franchise-bar">{g.canEdit&&<Button size="sm" variant="outline" aria-label={`${row} 수정`} disabled={busy} onClick={onEdit}>수정</Button>}{g.canCancel&&<Button size="sm" variant="outline" aria-label={`${row} 행사 취소`} disabled={busy} onClick={onCancel}>행사 취소</Button>}</div>}
  {view.enabled&&e.status==='scheduled'&&<>
   <details className="franchise-box"><summary aria-label={`${row} 신청 기록`}>신청 기록</summary>{g.canRegister?<RegisterForm event={e} busy={busy} onRegister={onRegister}/>:<p className="subtle-note">{g.registerWhy}</p>}</details>
   <details className="franchise-box"><summary aria-label={`${row} 참석 기록`}>참석 기록</summary>{g.canAttend?<AttendanceForm event={e} busy={busy} onAttend={onAttend}/>:<p className="subtle-note">{g.attendWhy}</p>}</details>
  </>}
 </li>;
}

// 신청: 가명 코드(선택)만. 형식이 틀리면 보내지 않는다. 성공하면 입력을 비우고, 실패(중복 코드 등)하면 입력을 둔다.
function RegisterForm({event,busy,onRegister}:{event:EventItem;busy:boolean;onRegister:(p:Json)=>Promise<boolean>}){
 const [code,setCode]=useState(''),[alert,setAlert]=useState(''),hintId=useId();
 return <form autoComplete="off" className="form-stack" onSubmit={e=>{e.preventDefault();const x=registerInput(event,code);if(!x.payload){setAlert(x.problem??'');return}setAlert('');void onRegister(x.payload).then(ok=>{if(ok)setCode('')})}}><fieldset disabled={busy} className="form-stack">
  <label className="field"><span>가명 코드 (선택)</span><Input autoComplete="off" maxLength={64} spellCheck={false} aria-describedby={hintId} placeholder="예: LKB728BT" value={code} onChange={e=>{setCode(e.target.value);setAlert('')}}/></label>
  <small id={hintId}>{`${CODE_HINT} 코드 없이 기록하면 신청 수만 1 늘어납니다.`}</small>
  {alert&&<p role="alert" className="form-error">{alert}</p>}
  <div className="form-actions"><Button type="submit">신청 기록하기</Button></div>
 </fieldset></form>;
}

// 참석: 건수(기록된 값에서 시작)와 가명 코드별 상태. 사전 검사에 걸리면 저장 버튼을 잠그고 이유를 보인다.
function AttendanceForm({event,busy,onAttend}:{event:EventItem;busy:boolean;onAttend:(p:Json)=>Promise<boolean>}){
 const [attended,setAttended]=useState(String(event.counts.attended)),[noShow,setNoShow]=useState(String(event.counts.noShow));
 const [marks,setMarks]=useState<Record<string,CodeState>>(()=>Object.fromEntries(event.codes.map(c=>[c.code,c.state])));
 const x=attendanceInput(event,attended,noShow,marks);
 return <form autoComplete="off" className="form-stack" onSubmit={e=>{e.preventDefault();if(x.payload)void onAttend(x.payload)}}><fieldset disabled={busy} className="form-stack">
  <div className="form-two">
   <label className="field"><span>참석</span><Input type="number" min={0} max={event.capacity} step={1} value={attended} onChange={e=>setAttended(e.target.value)}/></label>
   <label className="field"><span>불참</span><Input type="number" min={0} max={event.counts.applied} step={1} value={noShow} onChange={e=>setNoShow(e.target.value)}/></label>
  </div>
  {event.codes.length>0&&<fieldset className="field"><legend>{`가명 코드별 상태 (${event.codes.length})`}</legend>
   {event.codes.map(c=><label key={c.code} className="franchise-inline"><span>{c.code}</span><NativeSelect aria-label={`${c.code} 상태`} value={marks[c.code]??c.state} onChange={e=>setMarks({...marks,[c.code]:e.target.value as CodeState})}>{CODE_STATES.map(s=><NativeSelectOption key={s} value={s}>{CODE_STATE_LABELS[s]}</NativeSelectOption>)}</NativeSelect></label>)}
   <small>적지 않은 코드는 신청 상태로 돌아갑니다(이번 입력이 전체 설정입니다).</small>
  </fieldset>}
  {x.problem&&<p role="alert" className="form-error">{x.problem}</p>}
  <div className="form-actions"><Button type="submit" disabled={!x.payload}>참석 저장</Button></div>
 </fieldset></form>;
}

// ── 등록·변경 대화상자(대표·관리자) ──
// 열려 있는 동안 스위치가 꺼지거나 분기가 A가 아니게 되면(다시 읽은 보기) 저장을 잠그고 이유를 보인다. 입력은 그대로 둔다.
export function EventEditor({view,event,busy,problem,spends=[],onSave,onCancel}:{view:EventsView;event:EventItem|null;busy:boolean;problem:Problem|null;spends?:readonly SpendChoice[];onSave:(payload:Json)=>Promise<EventSaveOutcome>;onCancel:()=>void}){
 const approved=(r:Ref)=>view.approvedAssets.some(a=>sameRef(a,r)),placeHint=useId(),placeRef=useRef<HTMLInputElement>(null);
 const lockedWhy=!view.enabled?EVENTS_OFF_NOTE:view.branch!=='A'?view.h7Notice??EDIT_BRANCH_NOTE:null;
 const [f,setF]=useState<EventForm>(()=>event?{type:event.type,campaignId:event.campaignId,start:{now:false,local:kstLocal(event.startsAt)},place:event.placeLabel,capacity:String(event.capacity),refs:event.assetRefs.filter(r=>r.status==='approved').map(r=>({id:r.id,version:r.version})),spendRef:event.spendRef??''}
  :{type:view.types[0]?.type??'',campaignId:'',start:{now:false,local:''},place:'',capacity:'',refs:[],spendRef:''});
 // 지금 연결된 비용이 선택지에 없으면(읽기 실패 등) 그 값을 그대로 둔다. 서버가 유효한 비용인지 다시 본다.
 const spendOptions=f.spendRef&&!spends.some(s=>s.id===f.spendRef)?[...spends,{id:f.spendRef,label:'지금 연결된 비용'}]:spends;
 const set=(patch:Partial<EventForm>)=>setF({...f,...patch});
 const refs=f.refs.filter(approved),typeName=(t:string|null|undefined)=>t?view.assetTypes.find(x=>x.type===t)?.label??t:null;
 const lost=[...(event?event.assetRefs.filter(r=>r.status!=='approved'):[]),...f.refs.filter(r=>!approved(r)).map(r=>({...r,type:event?.assetRefs.find(x=>sameRef(x,r))?.type??null}))];
 const floor=Math.max(1,event?.counts.applied??0),cap=Number(f.capacity);
 const ready=!lockedWhy&&!!f.type&&(!!event||!!f.campaignId)&&!!timeOf(f.start)&&!!f.place.trim()&&f.capacity.trim()!==''&&Number.isSafeInteger(cap)&&cap>=floor&&cap<=CAPACITY_MAX;
 const deckMissing=f.type==='briefing'&&!refs.some(r=>view.approvedAssets.find(a=>sameRef(a,r))?.type==='event_deck');
 const toggle=(r:Ref,on:boolean)=>set({refs:on?[...refs,r]:refs.filter(x=>!sameRef(x,r))});
 return <Dialog open onOpenChange={v=>{if(!v&&!busy)onCancel()}}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{event?'행사 변경':'새 행사'}</DialogTitle><DialogDescription>설명회·견학·박람회를 기록합니다. 참가자 이름·연락처는 받지 않습니다.</DialogDescription></DialogHeader>
  <form autoComplete="off" className="form-stack" onSubmit={e=>{e.preventDefault();if(ready&&!busy)void onSave(eventInput({...f,refs},event)).then(o=>{if(o==='pii')placeRef.current?.focus()})}}><fieldset disabled={busy} className="form-stack">
   {lockedWhy&&<p className="notice" role="note">{lockedWhy}</p>}
   <div className="form-two">
    <label className="field"><span>행사 유형</span><NativeSelect required value={f.type} onChange={e=>set({type:e.target.value})}>{view.types.map(t=><NativeSelectOption key={t.type} value={t.type}>{t.label}</NativeSelectOption>)}</NativeSelect></label>
    {event?<p className="subtle-note">{`모집 캠페인: ${view.campaigns.find(c=>c.id===event.campaignId)?.title??'보관되었거나 삭제된 캠페인'}`}</p>
     :<label className="field"><span>모집 캠페인</span><NativeSelect required value={f.campaignId} onChange={e=>set({campaignId:e.target.value})}><NativeSelectOption value="">캠페인 선택</NativeSelectOption>{view.campaigns.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>}
   </div>
   <TimeField label="시작 시각" value={f.start} onChange={start=>set({start})} allowNow={false}/>
   <label className="field"><span>장소</span><Input autoComplete="off" ref={placeRef} required maxLength={LABEL_MAX} aria-describedby={placeHint} placeholder="예: 가상 직영점 2층" value={f.place} onChange={e=>set({place:e.target.value})}/><small id={placeHint}>행사장·건물 이름만 적습니다. 연락처·주민등록번호 같은 개인정보는 받지 않습니다.</small></label>
   <label className="field"><span>정원</span><Input type="number" required min={floor} max={CAPACITY_MAX} step={1} value={f.capacity} onChange={e=>set({capacity:e.target.value})}/>{event&&<small>{`이미 받은 신청 ${event.counts.applied}명보다 줄일 수 없습니다.`}</small>}</label>
   <fieldset className="field"><legend>{`연결 자료 (승인된 판, 최대 ${ASSET_REFS_MAX}개)`}</legend>
    {view.approvedAssets.length?view.approvedAssets.map(a=>{const on=refs.some(r=>sameRef(r,a));return <label key={`${a.id}:${a.version}`} className="franchise-inline"><input type="checkbox" checked={on} disabled={!on&&refs.length>=ASSET_REFS_MAX} onChange={e=>toggle({id:a.id,version:a.version},e.target.checked)}/>{` ${a.typeLabel} v${a.version}${a.latest?'':' (이전 판)'}`}</label>})
     :<p className="subtle-note">승인된 모집 자료가 없습니다.</p>}
    {lost.map(r=><p key={`${r.id}:${r.version}`} className="franchise-flag">{`${typeName(r.type)??r.id} v${r.version}: 승인 판이 아니라 연결에서 빠집니다`}</p>)}
    {deckMissing&&<small>설명회에는 승인된 설명회 덱(표준 순서)을 연결하기를 권합니다. 연결하지 않아도 저장되고 경고가 남습니다.</small>}
   </fieldset>
   <label className="field"><span>모집 비용 연결 (선택)</span><NativeSelect value={f.spendRef??''} onChange={e=>set({spendRef:e.target.value})}><NativeSelectOption value="">연결 없음</NativeSelectOption>{spendOptions.map(s=><NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>)}</NativeSelect>
    <small>유입·비용 탭에서 기록한 이 브랜드의 유효한 모집 비용만 고릅니다. 연결한 비용은 행사를 취소하거나 연결을 바꾸기 전에는 무효화할 수 없습니다.</small></label>
   <ProblemBox problem={problem}/>
   <div className="form-actions"><Button type="button" variant="outline" onClick={onCancel}>취소</Button><Button type="submit" disabled={!ready||busy}>행사 저장</Button></div>
  </fieldset></form>
 </DialogContent></Dialog>;
}
