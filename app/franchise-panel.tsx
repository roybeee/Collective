'use client';
// 가맹 모집 화면(트랙 R R1a·R4b): 브랜드별 리드 원장(가린 연락처 목록·필터·할 일·담당 가져오기·리드 등록·연락처로 찾기), 정보주체 요청, 대표·관리자 설정.
// 대표 결정 22: 영업단(직원)이 이름·연락처를 보고 관리한다. 목록은 언제나 가린 값이고, 원문은 리드 상세의 연락처 보기(감사 기록)로만 본다.
// 기능 스위치(r_franchise)가 꺼지면 쓰기 버튼을 숨기고 조회·파기·정보주체 요청·광고성 정보 철회만 남긴다. 판정·권한은 서버(/api/franchise)가 한다.
import {useCallback,useEffect,useState} from 'react';
import {Plus,RefreshCw,Search,Download,Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {WorkspaceData} from '@/lib/client';
import {franchiseTabs,type FranchiseTab} from '@/lib/nav-state';
import {LEAD_STAGES} from '@/lib/franchise-gates';
import {GATE_DISCLAIMER,CONTACT_NOTE,OFF_BANNER,UNDETERMINED_BANNER,FRANCHISE_ERRORS,MEMO_HINT,RETENTION_LABEL,DUE_LABEL,STAGE_LABELS,SOURCE_LABELS,BUDGET_LABELS,TIMING_LABELS,BASIS_LABELS,REFERRAL_LABELS,
 MARKETING_METHOD_LABELS,EXPORT_PURPOSE_LABELS,CONTACT_STATE_LABELS,SUBJECT_REQUEST_TYPE_LABELS,SUBJECT_REQUEST_STATUS_LABELS,SUBJECT_RESOLUTION_LABELS,SUBJECT_CHANNEL_LABELS,BOARD_TODO_LABELS,isAdminRole,isBoardQuery,
 type LeadTask,type BasisType,type ExportPurpose,type BoardTodo} from '@/lib/franchise';
import {canChange,useAccount} from './account-context';
import {franchiseGet,franchisePost,problemOf,messageOf,ProblemBox,Disclaimer,TimeField,TaskFields,LabelSelect,saveCsv,NOW,timeOf,kst,labelOf,
 type FranchiseStatus,type Intake,type Board,type LeadSummary,type LeadDetail,type Assignee,type Problem,type TimeValue} from './franchise-common';
import {FranchiseLeadDetail,ERASE_CONFIRM,assigneeLabel,eraseDone} from './franchise-lead-detail';
import {FranchiseSettings} from './franchise-settings';

type Campaigns=readonly {id:string;title:string}[];
type Filters={stage:string;assignee:string;source:string;q:string;todo:BoardTodo|'';sort:'activity'|'eligibility'};
const noFilters:Filters={stage:'',assignee:'',source:'',q:'',todo:'',sort:'activity'};
// 검색어가 코드·지역이 아니면(전화·이메일·숫자) 보내지 않는다. 서버도 400이다.
export const SEARCH_HINT='검색은 리드 코드(L로 시작)나 지역 이름만 받습니다. 전화·이메일은 ‘연락처로 찾기’를 쓰세요(주소창에 남지 않고 기록이 남습니다).';
const isTab=(v:string):v is FranchiseTab=>(franchiseTabs as readonly string[]).includes(v);

export function FranchisePanel({workspace,initialBrandId,initialTab,onScopeChange}:{workspace:WorkspaceData;initialBrandId?:string;initialTab?:FranchiseTab;onScopeChange?:(brand:string,tab:string)=>void}){
 const brands=workspace.brands,account=useAccount();
 const known=(id?:string):id is string=>!!id&&brands.some(b=>b.id===id);
 const [brandId,setBrandId]=useState(()=>known(initialBrandId)?initialBrandId:brands[0]?.id??'');
 const [tab,setTab]=useState<FranchiseTab>(initialTab??'leads');
 const [status,setStatus]=useState<FranchiseStatus|null>(null),[statusError,setStatusError]=useState('');
 const [intake,setIntake]=useState<Intake|null>(null),[intakeError,setIntakeError]=useState('');
 // 주소로 다른 브랜드·탭 링크를 열면 따른다(열려 있는 동안에도). 브랜드가 바뀌면 이전 브랜드의 등록 조건을 버린다.
 const [link,setLink]=useState({brand:initialBrandId,tab:initialTab});
 if(link.brand!==initialBrandId||link.tab!==initialTab){setLink({brand:initialBrandId,tab:initialTab});if(known(initialBrandId)&&initialBrandId!==brandId){setBrandId(initialBrandId);setIntake(null)}if(initialTab)setTab(initialTab)}
 const loadStatus=useCallback(async(signal?:AbortSignal)=>{
  try{const s=await franchiseGet<FranchiseStatus>({view:'status'},signal);if(!signal?.aborted){setStatus(s);setStatusError('')}}
  catch(e){if(!signal?.aborted)setStatusError(messageOf(e))}
 },[]);
 const loadIntake=useCallback(async(signal?:AbortSignal)=>{
  if(!brandId)return;
  try{const d=await franchiseGet<Intake>({view:'intake',brandId},signal);if(!signal?.aborted){setIntake(d);setIntakeError('')}}
  catch(e){if(!signal?.aborted)setIntakeError(messageOf(e))}
 },[brandId]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return loadStatus(c.signal)});return ()=>c.abort()},[loadStatus]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return loadIntake(c.signal)});return ()=>c.abort()},[loadIntake]);
 const admin=status?isAdminRole(status.role):canChange(account),enabled=!!status?.enabled;
 const shown:FranchiseTab=tab==='settings'&&!admin?'leads':tab;
 function pickBrand(id:string){setBrandId(id);setIntake(null);onScopeChange?.(id,shown)}
 function pickTab(value:string){const next=isTab(value)?value:'leads';setTab(next);onScopeChange?.(brandId,next)}
 const branch=intake&&intake.profileBranch;
 const campaigns=workspace.campaigns.filter(c=>c.brandId===brandId).map(c=>({id:c.id,title:c.title}));
 if(!brands.length)return <p className="notice">먼저 브랜드를 등록하세요. 가맹 모집은 브랜드별로 관리합니다.</p>;
 return <section className="franchise-panel" aria-label="가맹 모집">
  <div className="franchise-bar">
   <label className="field"><span>브랜드</span><NativeSelect aria-label="가맹 모집 브랜드" value={brandId} onChange={e=>pickBrand(e.target.value)}>{brands.map(b=><NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect></label>
  </div>
  <p className="notice" role="note">{GATE_DISCLAIMER} · {CONTACT_NOTE}</p>
  {statusError&&<div role="alert" className="load-error"><span>{statusError}</span><Button variant="outline" size="sm" onClick={()=>void loadStatus()}>다시 불러오기</Button></div>}
  {status&&!enabled&&<p className="notice" role="note">{OFF_BANNER}</p>}
  {intakeError&&<div role="alert" className="load-error"><span>{intakeError}</span><Button variant="outline" size="sm" onClick={()=>void loadIntake()}>다시 불러오기</Button></div>}
  {intake&&branch!=='A'&&<p className="notice" role="note">{branch==='B'||branch==='C'?FRANCHISE_ERRORS.BRANCH_BLOCKED.text:UNDETERMINED_BANNER}{admin?' 설정 탭의 가맹 프로필에서 분기를 기록합니다.':''}</p>}
  <Tabs value={shown} onValueChange={pickTab}><TabsList><TabsTrigger value="leads">리드</TabsTrigger><TabsTrigger value="requests">정보주체 요청</TabsTrigger>{admin&&<TabsTrigger value="settings">설정</TabsTrigger>}</TabsList></Tabs>
  {!status?!statusError&&<p role="status">가맹 모집 정보를 불러오고 있습니다.</p>
   :shown==='leads'?<LeadsTab key={brandId} brandId={brandId} status={status} admin={admin} intake={intake} campaigns={campaigns} onRequests={()=>pickTab('requests')}/>
   :shown==='requests'?<RequestsTab key={brandId} brandId={brandId} admin={admin} keyReady={status.contactKey==='ready'}/>
   :<FranchiseSettings key={brandId} brandId={brandId} enabled={enabled} onChanged={()=>void loadIntake()}/>}
 </section>;
}

// ── 리드 목록 ──
function LeadsTab({brandId,status,admin,intake,campaigns,onRequests}:{brandId:string;status:FranchiseStatus;admin:boolean;intake:Intake|null;campaigns:Campaigns;onRequests:()=>void}){
 const enabled=status.enabled,keyReady=status.contactKey==='ready',canCreate=enabled&&keyReady&&intake?.profileBranch==='A';
 const [filters,setFilters]=useState<Filters>(noFilters),[query,setQuery]=useState('');
 const [board,setBoard]=useState<Board|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [open,setOpen]=useState<{id:string;initial?:LeadDetail}|null>(null),[dialog,setDialog]=useState<''|'create'|'export'|'find'>('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[problem,setProblem]=useState<Problem|null>(null);
 const load=useCallback(async(signal?:AbortSignal)=>{
  if(!keyReady)return;
  setLoading(true);setError('');
  try{
   const params:Record<string,string>={view:'board',brandId,sort:filters.sort};
   for(const k of ['stage','assignee','source','q','todo'] as const)if(filters[k])params[k]=filters[k];
   const d=await franchiseGet<Board>(params,signal);if(!signal?.aborted)setBoard(d);
  }catch(e){if(!signal?.aborted)setError(messageOf(e))}
  finally{if(!signal?.aborted)setLoading(false)}
 },[brandId,filters,keyReady]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 async function post(action:string,payload:Record<string,unknown>,done:(r:Record<string,unknown>)=>string){
  setBusy(true);setProblem(null);setMessage('');
  try{const r=await franchisePost(action,{brandId,...payload});if(r.status!==200){setProblem(problemOf(r));return}setMessage(done((r.body.result??{}) as Record<string,unknown>));await load()}
  finally{setBusy(false)}
 }
 function claim(l:LeadSummary){void post('claim_lead',{leadId:l.id,version:l.version},()=>`${l.systemCode}을(를) 내 담당으로 가져왔습니다.`)}
 function purge(){
  if(!window.confirm('보존 기한(COLLECTIVE 휴리스틱 H11)이 지난 연락처·메모·중복 키를 지금 파기합니다. 되돌릴 수 없습니다. 계속할까요?'))return;
  void post('purge',{},r=>{const c=(r.counts??{}) as Record<string,number>;return `파기 ${c.leads??0}건 · 중복 키 ${c.keys??0}건 · 오래된 감사 기록 ${c.audits??0}건${c.remaining?` · 남은 대상 ${c.remaining}건(다시 실행하세요)`:''}`});
 }
 const t=board?.todos,assignees:readonly Assignee[]=board?.assignees??[];
 return <div className="franchise-panel">
  <div className="franchise-bar">
   {canCreate&&<Button onClick={()=>setDialog('create')}><Plus/>리드 등록</Button>}
   {keyReady&&<Button variant="outline" onClick={()=>setDialog('find')}><Search/>연락처로 찾기</Button>}
   {admin&&keyReady&&<Button variant="outline" onClick={()=>setDialog('export')}><Download/>내보내기</Button>}
   {admin&&<Button variant="outline" disabled={busy} onClick={purge}><Trash2/>지금 파기 실행</Button>}
   {keyReady&&<Button variant="ghost" disabled={loading} onClick={()=>void load()}><RefreshCw/>새로고침</Button>}
  </div>
  {(message||problem)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<ProblemBox problem={problem}/></div>}
  {!keyReady?<div role="alert" className="load-error"><span>{FRANCHISE_ERRORS.KEY_MISSING.text}</span></div>:<>
   <form className="franchise-bar" aria-label="리드 필터" onSubmit={e=>{e.preventDefault();const q=query.trim();if(!isBoardQuery(q)){setQuery('');setProblem({error:SEARCH_HINT});return}setProblem(null);setFilters({...filters,q})}}>
    <label className="field"><span>단계</span><NativeSelect value={filters.stage} onChange={e=>setFilters({...filters,stage:e.target.value})}><NativeSelectOption value="">전체</NativeSelectOption>{LEAD_STAGES.map(s=><NativeSelectOption key={s} value={s}>{STAGE_LABELS[s]}{board?` ${board.counts.byStage[s]??0}`:''}</NativeSelectOption>)}</NativeSelect></label>
    <label className="field"><span>담당</span><NativeSelect value={filters.assignee} onChange={e=>setFilters({...filters,assignee:e.target.value})}><NativeSelectOption value="">{admin?'전체':'내 리드와 담당 없음'}</NativeSelectOption><NativeSelectOption value="me">내 리드</NativeSelectOption><NativeSelectOption value="unassigned">담당 없음</NativeSelectOption>{admin&&assignees.filter(a=>a.label!=='나').map(a=><NativeSelectOption key={a.id} value={a.id}>{a.label}</NativeSelectOption>)}</NativeSelect></label>
    <LabelSelect label="유입" labels={SOURCE_LABELS} value={filters.source} empty="전체" onChange={source=>setFilters({...filters,source})}/>
    <label className="field"><span>검색 (코드·지역)</span><Input value={query} maxLength={40} placeholder="L로 시작하는 코드 또는 지역" onChange={e=>setQuery(e.target.value)}/></label>
    <Button type="submit" variant="outline">검색</Button>
    <LabelSelect label="정렬" labels={{activity:'최근 활동',eligibility:'적격 충족'}} value={filters.sort} onChange={sort=>setFilters({...filters,sort})}/>
   </form>
   <p className="subtle-note">이름·연락처로는 검색하지 않습니다. 연락처로 확인할 때는 ‘연락처로 찾기’를 쓰세요(기록이 남습니다).</p>
   {t&&<ul className="franchise-chips" aria-label="할 일">{todoChips(t,admin).map(([key,count])=><li key={key}><button type="button" aria-pressed={filters.todo===key} title={key==='marketing_recheck'?board?.recheckLabel:undefined} onClick={()=>setFilters({...filters,todo:filters.todo===key?'':key})}>{BOARD_TODO_LABELS[key]} {count}</button></li>)}<li><button type="button" onClick={onRequests}>기한 임박 요청 {t.subjectRequestsDueSoon}</button></li></ul>}
   {filters.todo&&<p className="subtle-note">할 일 ‘{BOARD_TODO_LABELS[filters.todo]}’ 리드만 봅니다. <Button size="sm" variant="ghost" onClick={()=>setFilters({...filters,todo:''})}>할 일 필터 해제</Button></p>}
   {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>}
   {!board?loading&&<p role="status">리드를 불러오고 있습니다.</p>:board.leads.length?<>
    <div className="ledger-table-wrap"><table className="ledger-table franchise-table"><caption className="sr-only">가맹 리드 목록</caption>
     <thead><tr><th>코드</th><th>이름</th><th>연락처</th><th>단계</th><th>담당</th><th>유입</th><th>지역</th><th>예산</th><th>시기</th><th>적격</th><th>마지막 활동</th><th>보존 기한</th></tr></thead>
     <tbody>{board.leads.map(l=><tr key={l.id}>
      <td><button type="button" className="campaign-name" aria-label={`리드 ${l.systemCode} 열기`} onClick={()=>setOpen({id:l.id})}>{l.systemCode}</button></td>
      <td>{l.contact?.name??CONTACT_STATE_LABELS[l.contactState]}</td>
      <td>{l.contact?l.contact.phone??l.contact.email??'-':'-'}</td>
      <td><span className="status">{STAGE_LABELS[l.stage]}</span>{l.sourceNoticePending&&<small className="franchise-flag"> 출처 고지 필요</small>}</td>
      <td>{assigneeLabel(l,assignees)}{enabled&&l.assigneeId===null&&l.contactState==='present'&&<> <Button size="sm" variant="outline" disabled={busy} onClick={()=>claim(l)}>가져오기</Button></>}</td>
      <td>{SOURCE_LABELS[l.task.sourceChannel]}</td><td>{l.task.region||'-'}</td><td>{BUDGET_LABELS[l.task.budgetBand]}</td><td>{TIMING_LABELS[l.task.timingBand]}</td>
      <td>{l.eligibility?`${l.eligibility.met}/${l.eligibility.total}`:'-'}</td><td>{kst(l.lastActivityAt)}</td><td>{l.retentionUntil?kst(l.retentionUntil):'-'}</td>
     </tr>)}</tbody>
    </table></div>
    <p className="subtle-note">{board.total>board.leads.length?`${board.total}건 중 ${board.leads.length}건을 보여 줍니다. 필터를 좁혀 주세요.`:`${board.total}건`} · 보존 기한은 {RETENTION_LABEL}</p>
   </>:<p className="subtle-note">{filters.stage||filters.assignee||filters.source||filters.q||filters.todo?'조건에 맞는 리드가 없습니다.':'아직 등록된 리드가 없습니다.'}{!admin?' 직원은 내 리드와 담당 없는 리드만 봅니다.':''}</p>}
  </>}
  {open&&<FranchiseLeadDetail key={open.id} brandId={brandId} leadId={open.id} initial={open.initial} admin={admin} intake={intake} assignees={assignees} campaigns={campaigns} onClose={()=>setOpen(null)} onChanged={()=>void load()}/>}
  {dialog==='create'&&<CreateLeadDialog brandId={brandId} admin={admin} intake={intake} assignees={assignees} campaigns={campaigns} onClose={()=>setDialog('')} onCreated={(id,lead)=>{setDialog('');setMessage('리드를 등록했습니다.');void load();setOpen({id,initial:lead})}}/>}
  {dialog==='export'&&<ExportDialog brandId={brandId} onClose={()=>setDialog('')} onDone={text=>{setDialog('');setMessage(text)}}/>}
  {dialog==='find'&&<FindDialog brandId={brandId} onClose={()=>setDialog('')} onOpen={id=>{setDialog('');setOpen({id})}}/>}
 </div>;
}

// 할 일 칩: 누르면 그 할 일에 해당하는 리드만 보드에 보인다(서버 todo 필터). 파기 대기는 대표·관리자만.
function todoChips(t:Board['todos'],admin:boolean):[BoardTodo,number][]{
 return [['source_notice',t.sourceNoticePending],['expiring',t.contactsExpiringSoon],['marketing_recheck',t.marketingRecheck],...(admin&&t.purgePending!==undefined?[['purge_pending',t.purgePending] as [BoardTodo,number]]:[])];
}

// ── 리드 등록 ──
type CreateForm={name:string;phone:string;email:string;memo:string;task:LeadTask;basis:BasisType;noticeId:string;noticeAt:TimeValue;referralFrom:string;marketing:boolean;method:string;marketingAt:TimeValue;marketingNoticeId:string;assignee:string};
const blankCreate:CreateForm={name:'',phone:'',email:'',memo:'',task:{region:'',budgetBand:'unknown',timingBand:'unknown',sourceChannel:'phone_inquiry',campaignId:null},basis:'inquiry_response',noticeId:'',noticeAt:NOW,referralFrom:'',
 marketing:false,method:'',marketingAt:NOW,marketingNoticeId:'',assignee:'__self'};
// 최소 수집: 이름(필수)·전화/이메일(하나 이상)·메모(선택). 입력은 이 대화상자 상태에만 두고 닫으면 사라진다. 브라우저 자동 완성에 남지 않게 autoComplete를 끈다.
export function CreateLeadDialog({brandId,admin,intake,assignees,campaigns,onClose,onCreated}:{brandId:string;admin:boolean;intake:Intake|null;assignees:readonly Assignee[];campaigns:Campaigns;onClose:()=>void;onCreated:(id:string,lead?:LeadDetail)=>void}){
 const [f,setF]=useState<CreateForm>(blankCreate),[busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null);
 const notices=intake?.notices??[],set=(patch:Partial<CreateForm>)=>setF({...f,...patch});
 const missing=!f.name.trim()||(!f.phone.trim()&&!f.email.trim())||(f.basis==='consent'&&(!f.noticeId||!timeOf(f.noticeAt)))||(f.basis==='referral'&&!f.referralFrom)
  ||(admin&&f.marketing&&(!f.method||!f.marketingNoticeId||!timeOf(f.marketingAt)));
 async function submit(){
  setBusy(true);setProblem(null);
  try{
   const basis=f.basis==='consent'?{type:'consent',noticeId:f.noticeId,noticeGivenAt:timeOf(f.noticeAt)}:f.basis==='referral'?{type:'referral',referralFrom:f.referralFrom}:{type:'inquiry_response'};
   const r=await franchisePost('create_lead',{brandId,contact:{name:f.name,...(f.phone.trim()?{phone:f.phone}:{}),...(f.email.trim()?{email:f.email}:{})},...(f.memo.trim()?{memo:f.memo}:{}),task:{...f.task,region:f.task.region.trim()},basis,
    ...(admin&&f.marketing?{marketing:{status:'given',method:f.method,at:timeOf(f.marketingAt),noticeId:f.marketingNoticeId}}:{}),...(admin&&f.assignee!=='__self'?{assigneeId:f.assignee==='__none'?null:f.assignee}:{})});
   const id=r.body.result?.leadId;
   if(r.status!==200||typeof id!=='string'){setProblem(problemOf(r));return}
   setF(blankCreate);onCreated(id,r.body.lead);
  }finally{setBusy(false)}
 }
 return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose()}}><DialogContent className="wide-dialog"><DialogHeader><DialogTitle>리드 등록</DialogTitle><DialogDescription>{CONTACT_NOTE} 주소·생년월일·주민등록번호·계좌번호는 받지 않습니다.</DialogDescription></DialogHeader>
  <form className="form-stack" autoComplete="off" onSubmit={e=>{e.preventDefault();void submit()}}><fieldset disabled={busy} className="form-stack">
   <div className="form-two"><label className="field"><span>이름 *</span><Input required autoComplete="off" maxLength={40} value={f.name} onChange={e=>set({name:e.target.value})}/></label>
    <label className="field"><span>전화</span><Input autoComplete="off" inputMode="tel" maxLength={40} placeholder="010-0000-0000" value={f.phone} onChange={e=>set({phone:e.target.value})}/></label></div>
   <label className="field"><span>이메일</span><Input autoComplete="off" type="email" maxLength={254} placeholder="name@example.com" value={f.email} onChange={e=>set({email:e.target.value})}/><small>전화·이메일 중 하나 이상</small></label>
   <label className="field"><span>메모 (선택, 1000자)</span><Textarea autoComplete="off" rows={3} maxLength={1000} value={f.memo} onChange={e=>set({memo:e.target.value})}/><small>{MEMO_HINT}</small></label>
   <TaskFields task={f.task} onChange={task=>set({task})} campaigns={campaigns}/>
   <fieldset className="field"><legend>수집 근거</legend>{(Object.keys(BASIS_LABELS) as BasisType[]).map(b=><label key={b} className="franchise-inline"><input type="radio" name="franchise-basis" checked={f.basis===b} onChange={()=>set({basis:b})}/> {BASIS_LABELS[b]}</label>)}</fieldset>
   {f.basis==='consent'&&<div className="form-two"><label className="field"><span>안내한 개인정보 안내문</span><NativeSelect required value={f.noticeId} onChange={e=>set({noticeId:e.target.value})}><NativeSelectOption value="">안내문 선택</NativeSelectOption>{notices.map(n=><NativeSelectOption key={n.id} value={n.id}>{n.versionLabel}</NativeSelectOption>)}</NativeSelect>{!notices.length&&<small>대표·관리자가 설정에서 안내문을 먼저 등록해야 합니다.</small>}</label><TimeField label="안내 시각" value={f.noticeAt} onChange={noticeAt=>set({noticeAt})}/></div>}
   {f.basis==='referral'&&<><LabelSelect label="소개한 사람" labels={REFERRAL_LABELS} value={f.referralFrom} empty="선택" required onChange={referralFrom=>set({referralFrom})}/><p className="subtle-note">처음 연락할 때 어디서 연락처를 받았는지 알리고, 리드 상세에서 ‘고지함’을 기록하세요.</p></>}
   {admin?<fieldset className="field"><legend>광고성 정보 수신 동의 (선택)</legend>
    <label className="franchise-inline"><input type="checkbox" checked={f.marketing} onChange={e=>set({marketing:e.target.checked})}/> 광고성 정보 수신 동의를 따로 받았습니다</label>
    {f.marketing&&<><LabelSelect label="동의 방법" labels={MARKETING_METHOD_LABELS} value={f.method} empty="방법 선택" required onChange={method=>set({method})}/><TimeField label="동의 시각" value={f.marketingAt} onChange={marketingAt=>set({marketingAt})}/>
     <label className="field"><span>안내한 개인정보 안내문</span><NativeSelect required value={f.marketingNoticeId} onChange={e=>set({marketingNoticeId:e.target.value})}><NativeSelectOption value="">안내문 선택</NativeSelectOption>{notices.map(n=><NativeSelectOption key={n.id} value={n.id}>{n.versionLabel}</NativeSelectOption>)}</NativeSelect></label></>}
   </fieldset>:<p className="subtle-note">광고성 정보 동의는 기본으로 ‘동의 없음’입니다. 동의 기록은 대표·관리자가 합니다. 등록한 리드는 내 담당이 됩니다.</p>}
   {admin&&<label className="field"><span>담당자</span><NativeSelect value={f.assignee} onChange={e=>set({assignee:e.target.value})}><NativeSelectOption value="__self">나</NativeSelectOption><NativeSelectOption value="__none">담당 없음</NativeSelectOption>{assignees.filter(a=>a.label!=='나').map(a=><NativeSelectOption key={a.id} value={a.id}>{a.label}</NativeSelectOption>)}</NativeSelect></label>}
   <ProblemBox problem={problem}/>
   <div className="form-actions"><Button type="button" variant="outline" onClick={onClose}>취소</Button><Button type="submit" disabled={missing}>{busy?'등록 중…':'리드 등록'}</Button></div>
  </fieldset></form>
 </DialogContent></Dialog>;
}

// ── 내보내기(대표·관리자): 목적을 고르고, 가린 값/원문을 고른다. 목적·방식·건수가 감사 기록에 남는다. 메모는 내보내지 않는다. ──
function ExportDialog({brandId,onClose,onDone}:{brandId:string;onClose:()=>void;onDone:(text:string)=>void}){
 const [purpose,setPurpose]=useState<ExportPurpose|''>(''),[mode,setMode]=useState<'masked'|'full'>('masked'),[busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null);
 async function run(){
  setBusy(true);setProblem(null);
  try{
   const r=await franchisePost('export_leads',{brandId,purpose,contactMode:mode});
   if(r.status!==200){setProblem(problemOf(r));return}
   const b=r.body;if(typeof b.csv==='string'&&typeof b.filename==='string')saveCsv(b.filename,b.csv);
   onDone(`리드 ${typeof b.rowCount==='number'?b.rowCount:0}건을 내보냈습니다.`);
  }finally{setBusy(false)}
 }
 return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose()}}><DialogContent><DialogHeader><DialogTitle>리드 내보내기</DialogTitle><DialogDescription>내보내기는 목적과 건수가 감사 기록에 남습니다. 메모는 내보내지 않습니다.</DialogDescription></DialogHeader>
  <div className="form-stack">
   <LabelSelect label="목적" labels={EXPORT_PURPOSE_LABELS} value={purpose} empty="목적 선택" required onChange={setPurpose}/>
   <fieldset className="field"><legend>연락처</legend><label className="franchise-inline"><input type="radio" name="franchise-export" checked={mode==='masked'} onChange={()=>setMode('masked')}/> 가린 값</label><label className="franchise-inline"><input type="radio" name="franchise-export" checked={mode==='full'} onChange={()=>setMode('full')}/> 원문(개인정보 포함)</label></fieldset>
   {mode==='full'&&<p className="form-error">원문 파일은 목적이 끝나면 지우세요.</p>}
   <ProblemBox problem={problem}/>
   <div className="form-actions"><Button variant="outline" onClick={onClose} disabled={busy}>취소</Button><Button disabled={busy||!purpose} onClick={()=>void run()}>{busy?'만드는 중…':'CSV 내려받기'}</Button></div>
   <Disclaimer/>
  </div>
 </DialogContent></Dialog>;
}

// ── 연락처로 찾기: 전화·이메일로 이미 등록된 리드를 확인한다(중복 등록 전 확인). 찾기마다 감사 기록(찾은 값 없음)이 남는다. ──
type Match={systemCode:string;visible:boolean;leadId?:string};
function FindDialog({brandId,onClose,onOpen}:{brandId:string;onClose:()=>void;onOpen:(id:string)=>void}){
 const [phone,setPhone]=useState(''),[email,setEmail]=useState(''),[matches,setMatches]=useState<Match[]|null>(null),[busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null);
 async function run(){
  setBusy(true);setProblem(null);setMatches(null);
  try{
   const r=await franchisePost('find_contact',{brandId,...(phone.trim()?{phone}:{}),...(email.trim()?{email}:{})});
   if(r.status!==200){setProblem(problemOf(r));return}
   setMatches(Array.isArray(r.body.matches)?r.body.matches as Match[]:[]);setPhone('');setEmail('');
  }finally{setBusy(false)}
 }
 return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose()}}><DialogContent><DialogHeader><DialogTitle>연락처로 찾기</DialogTitle><DialogDescription>찾기는 감사 기록에 남습니다. 찾은 전화·이메일 값은 기록하지 않습니다.</DialogDescription></DialogHeader>
  <form className="form-stack" autoComplete="off" onSubmit={e=>{e.preventDefault();void run()}}>
   <label className="field"><span>전화</span><Input autoComplete="off" inputMode="tel" maxLength={40} placeholder="010-0000-0000" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
   <label className="field"><span>이메일</span><Input autoComplete="off" type="email" maxLength={254} placeholder="name@example.com" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <div className="form-actions"><Button type="submit" disabled={busy||(!phone.trim()&&!email.trim())}>찾기</Button></div>
  </form>
  <ProblemBox problem={problem}/>
  {matches&&(matches.length?<ul className="franchise-list">{matches.map(m=><li key={m.systemCode}><b>{m.systemCode}</b> {m.visible&&m.leadId?<Button size="sm" variant="outline" onClick={()=>onOpen(m.leadId!)}>열기</Button>:<span className="subtle-note">다른 담당자의 리드입니다. 대표·관리자에게 확인하세요.</span>}</li>)}</ul>:<p role="status">일치하는 리드가 없습니다.</p>)}
 </DialogContent></Dialog>;
}

// ── 정보주체 요청: 접수(모든 역할)·처리 상태(대표·관리자)·삭제 실행(대표·관리자). 요청한 사람의 이름·연락처는 따로 저장하지 않는다. ──
type RequestRow={id:string;leadId:string|null;leadCode:string|null;leadContactState:string|null;type:string;channel:string;receivedAt:string;dueAt:string;status:string;resolution:string|null;resolvedAt:string|null;version:number;overdue:boolean};
type RequestPost=(action:string,payload:Record<string,unknown>,done:string|((result:Record<string,unknown>)=>string),confirmText?:string)=>Promise<boolean>;
function RequestsTab({brandId,admin,keyReady}:{brandId:string;admin:boolean;keyReady:boolean}){
 const [rows,setRows]=useState<RequestRow[]|null>(null),[error,setError]=useState(''),[leads,setLeads]=useState<{id:string;systemCode:string}[]>([]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[problem,setProblem]=useState<Problem|null>(null);
 const [form,setForm]=useState<{type:string;channel:string;leadId:string;at:TimeValue}>({type:'',channel:'',leadId:'',at:NOW});
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const d=await franchiseGet<{requests:RequestRow[]}>({view:'requests',brandId},signal);if(!signal?.aborted){setRows(d.requests);setError('')}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
  if(keyReady)try{const b=await franchiseGet<Board>({view:'board',brandId},signal);if(!signal?.aborted)setLeads(b.leads.map(l=>({id:l.id,systemCode:l.systemCode})))}catch{/* 리드 목록 없이도 요청은 접수한다(연결 리드 없음). */}
 },[brandId,keyReady]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 const post:RequestPost=async(action,payload,done,confirmText)=>{
  if(confirmText&&!window.confirm(confirmText))return false;
  setBusy(true);setProblem(null);setMessage('');
  try{const r=await franchisePost(action,{brandId,...payload});if(r.status!==200){setProblem(problemOf(r));if(r.status===409)void load();return false}setMessage(typeof done==='function'?done((r.body.result??{}) as Record<string,unknown>):done);await load();return true}
  finally{setBusy(false)}
 };
 async function add(){if(await post('add_subject_request',{type:form.type,channel:form.channel,leadId:form.leadId||null,receivedAt:timeOf(form.at)},'정보주체 요청을 접수했습니다.'))setForm({type:'',channel:'',leadId:'',at:NOW})}
 return <div className="franchise-panel">
  <p className="notice" role="note">{DUE_LABEL}. 열람은 리드 상세의 연락처 보기(목적: 정보주체 요청 처리), 정정은 연락처 수정, 처리정지는 광고성 정보 철회·종결, 삭제는 삭제 실행으로 처리합니다. 답변은 COLLECTIVE 밖에서 사람이 보냅니다.</p>
  {(message||problem)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<ProblemBox problem={problem}/></div>}
  <form className="franchise-box form-stack" onSubmit={e=>{e.preventDefault();void add()}}><fieldset disabled={busy} className="form-stack"><legend>요청 접수</legend>
   <div className="form-two"><LabelSelect label="요청 유형" labels={SUBJECT_REQUEST_TYPE_LABELS} value={form.type} empty="유형 선택" required onChange={type=>setForm({...form,type})}/><LabelSelect label="접수 경로" labels={SUBJECT_CHANNEL_LABELS} value={form.channel} empty="경로 선택" required onChange={channel=>setForm({...form,channel})}/></div>
   <div className="form-two"><label className="field"><span>연결 리드 (선택)</span><NativeSelect value={form.leadId} onChange={e=>setForm({...form,leadId:e.target.value})}><NativeSelectOption value="">연결 없음</NativeSelectOption>{leads.map(l=><NativeSelectOption key={l.id} value={l.id}>{l.systemCode}</NativeSelectOption>)}</NativeSelect></label><TimeField label="접수 시각 (30일 안)" value={form.at} onChange={at=>setForm({...form,at})}/></div>
   <div className="form-actions"><Button type="submit" disabled={!form.type||!form.channel||!timeOf(form.at)}>요청 접수</Button></div>
  </fieldset></form>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>}
  {rows===null?!error&&<p role="status">요청을 불러오고 있습니다.</p>:rows.length?<div className="ledger-table-wrap"><table className="ledger-table franchise-table"><caption className="sr-only">정보주체 요청 목록</caption>
   <thead><tr><th>유형</th><th>리드 코드</th><th>접수</th><th>처리 기한</th><th>상태</th><th>결과</th>{admin&&<th>처리</th>}</tr></thead>
   <tbody>{rows.map(r=><tr key={r.id}><td>{labelOf(SUBJECT_REQUEST_TYPE_LABELS,r.type)}<br/><small>{labelOf(SUBJECT_CHANNEL_LABELS,r.channel)}</small></td><td>{r.leadCode??'-'}</td><td>{kst(r.receivedAt)}</td>
    <td>{kst(r.dueAt)}{r.overdue&&<span className="status status-revision"> 기한 지남</span>}</td><td>{labelOf(SUBJECT_REQUEST_STATUS_LABELS,r.status)}</td><td>{r.resolution?labelOf(SUBJECT_RESOLUTION_LABELS,r.resolution):'-'}</td>
    {admin&&<td><RequestUpdate key={r.version} row={r} busy={busy} post={post} leads={leads}/></td>}</tr>)}</tbody>
  </table></div>:<p className="subtle-note">접수한 요청이 없습니다.{admin?'':' 직원은 자신이 접수한 요청만 봅니다.'}</p>}
  <p className="subtle-note">처리 기한: {DUE_LABEL}</p>
 </div>;
}
// 처리(대표·관리자): 상태·결과 저장, 연결 리드가 없으면 한 번 연결, 삭제 요청이면 삭제 실행(이미 삭제된 리드면 요청만 완료로 기록).
function RequestUpdate({row,busy,post,leads}:{row:RequestRow;busy:boolean;post:RequestPost;leads:readonly {id:string;systemCode:string}[]}){
 const [status,setStatus]=useState(row.status),[resolution,setResolution]=useState(row.resolution??''),[leadId,setLeadId]=useState('');
 const open=row.status==='open'||row.status==='in_progress',erased=row.leadContactState==='erased';
 const changed=status!==row.status||resolution!==(row.resolution??'')||!!leadId;
 return <div className="form-stack">
  <div className="franchise-bar"><LabelSelect label="상태" labels={SUBJECT_REQUEST_STATUS_LABELS} value={status} onChange={setStatus}/><LabelSelect label="결과" labels={SUBJECT_RESOLUTION_LABELS} value={resolution} empty="없음" onChange={setResolution}/>
   {!row.leadId&&<label className="field"><span>연결 리드</span><NativeSelect value={leadId} onChange={e=>setLeadId(e.target.value)}><NativeSelectOption value="">연결 없음</NativeSelectOption>{leads.map(l=><NativeSelectOption key={l.id} value={l.id}>{l.systemCode}</NativeSelectOption>)}</NativeSelect></label>}
   <Button size="sm" variant="outline" disabled={busy||!changed} onClick={()=>void post('update_subject_request',{id:row.id,version:row.version,status,...(resolution?{resolution}:{}),...(leadId?{leadId}:{})},'요청 상태를 저장했습니다.')}>저장</Button></div>
  {row.type==='erasure'&&row.leadId&&open&&(erased
   ?<Button size="sm" variant="outline" disabled={busy} onClick={()=>void post('erase_lead',{leadId:row.leadId,subjectRequestId:row.id},eraseDone)}>삭제 완료로 기록</Button>
   :<Button size="sm" variant="outline" disabled={busy} onClick={()=>void post('erase_lead',{leadId:row.leadId,subjectRequestId:row.id},eraseDone,ERASE_CONFIRM)}>삭제 실행</Button>)}
  {row.type==='erasure'&&!row.leadId&&open&&<small>연결 리드를 저장하면 삭제 실행을 할 수 있습니다.</small>}
 </div>;
}
