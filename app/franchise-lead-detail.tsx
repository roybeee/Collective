'use client';
// 가맹 리드 상세(트랙 R R4b): 가린 연락처, 연락처 보기(목적·항목 감사 기록, 60초 뒤 화면에서 지움), 담당, 단계 이동과 막힌 사유, 과업·연락처 수정,
// 수집 근거·출처 고지, 광고성 정보 동의·철회, 정보주체 요청, 대표·관리자 전용 계약 가능 시각·증빙 기록·증빙 목록·삭제 실행, 이력(값 없음).
// 버튼은 서버가 돌려준 allowedActions·allowedMoves·marketingOptions로만 보인다. 판정·권한은 서버가 다시 본다(COLLECTIVE 휴리스틱 · 법률 자문 아님).
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {STAGE_LABELS,BASIS_LABELS,REFERRAL_LABELS,MARKETING_METHOD_LABELS,MARKETING_STATUS_LABELS,CLOSE_REASON_LABELS,REVEAL_PURPOSE_LABELS,BACKDATE_REASON_LABELS,CORRECTION_REASON_LABELS,
 SUBJECT_REQUEST_TYPE_LABELS,SUBJECT_CHANNEL_LABELS,CONTACT_FIELD_LABELS,CONTACT_STATE_LABELS,EVIDENCE_TYPE_LABELS,DELIVERY_DOC_LABELS,DELIVERY_METHOD_LABELS,ELECTRONIC_CHANNEL_LABELS,HAND_EVIDENCE_LABELS,
 ADVISOR_TYPE_LABELS,FEE_CATEGORY_LABELS,ESCROW_INSTITUTION_LABELS,FORECAST_DUTY_LABELS,EVENT_TYPE_LABELS,CONTACT_NOTE,RETENTION_LABEL,RECHECK_LABEL,MEMO_HINT,DUE_LABEL,
 type LeadTask,type RevealPurpose,type CloseReason,type MarketingMethod,type SubjectRequestType,type SubjectChannel,type ContactField} from '@/lib/franchise';
import {franchiseGet,franchisePost,problemOf,messageOf,ProblemBox,Disclaimer,Section,TimeField,HashField,StorageField,LabelSelect,TaskFields,NOW,timeOf,kstDate,kst,labelOf,roleLabel,
 type Json,type LeadDetail,type Intake,type Assignee,type Problem,type PostResult,type TimeValue,type EvidenceView,type GateView,type SideView} from './franchise-common';

type Act=(action:string,payload:Json,done?:string,noVersion?:boolean)=>Promise<PostResult|null>;
type Common={lead:LeadDetail;act:Act;busy:boolean};
const REVEAL_MS=60000;
export const ERASE_CONFIRM='연락처·메모·중복 키를 지우고 되돌릴 수 없습니다. 단계·증빙 기록은 남습니다.';
const can=(lead:LeadDetail,action:string)=>lead.allowedActions.includes(action);
const TASK_FIELD_LABELS={region:'지역',budgetBand:'예산',timingBand:'시기',sourceChannel:'유입',campaignId:'캠페인'};
type EvidenceType=keyof typeof EVIDENCE_TYPE_LABELS;

export function assigneeLabel(lead:{assigneeId:string|null;assignedToMe:boolean},assignees:readonly Assignee[]){return lead.assigneeId===null?'담당 없음':lead.assignedToMe?'나':assignees.find(a=>a.id===lead.assigneeId)?.label??'다른 담당자'}
export function contactLine(lead:Pick<LeadDetail,'contact'|'contactState'>,full=false){
 if(!lead.contact)return CONTACT_STATE_LABELS[lead.contactState];
 const c=lead.contact;return [c.name,c.phone,full||!c.phone?c.email:null].filter(Boolean).join(' · ');
}

export function FranchiseLeadDetail({brandId,leadId,initial,admin,intake,assignees,campaigns,onClose,onChanged}:{brandId:string;leadId:string;initial?:LeadDetail|null;admin:boolean;intake:Intake|null;assignees:readonly Assignee[];campaigns:readonly {id:string;title:string}[];onClose:()=>void;onChanged:()=>void}){
 const [lead,setLead]=useState<LeadDetail|null>(initial??null),[loadError,setLoadError]=useState('');
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null),[message,setMessage]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const data=await franchiseGet<LeadDetail>({view:'lead',brandId,leadId},signal);if(!signal?.aborted){setLead(data);setLoadError('')}}
  catch(e){if(!signal?.aborted)setLoadError(messageOf(e))}
 },[brandId,leadId]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 // 모든 쓰기: 새 요청 번호, 현재 버전(필요한 작업만), 응답의 리드 보기로 갱신. 409(변경·게이트)는 리드를 다시 읽어 이력과 버전을 맞춘다.
 const act:Act=async(action,payload,done,noVersion)=>{
  if(!lead)return null;
  setBusy(true);setProblem(null);setMessage('');
  try{
   const r=await franchisePost(action,{brandId,leadId:lead.id,...(noVersion?{}:{version:lead.version}),...payload});
   if(r.body.lead)setLead(r.body.lead);
   if(r.status!==200){setProblem(problemOf(r));if(r.status===409)void load();return null}
   if(done)setMessage(done);
   onChanged();
   return r;
  }finally{setBusy(false)}
 };
 const common=lead?{lead,act,busy}:null;
 return <Sheet open onOpenChange={open=>{if(!open)onClose()}}><SheetContent className="franchise-sheet">
  <SheetHeader><SheetTitle>{lead?`리드 ${lead.systemCode}`:'리드'}</SheetTitle><SheetDescription>{lead?`${STAGE_LABELS[lead.stage]} · ${assigneeLabel(lead,assignees)} · 마지막 활동 ${kst(lead.lastActivityAt)}`:'리드를 불러오고 있습니다.'}</SheetDescription></SheetHeader>
  <div className="franchise-detail">
   {loadError&&<div role="alert" className="load-error"><span>{loadError}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>}
   {common&&<LeadBody {...common} admin={admin} intake={intake} assignees={assignees} campaigns={campaigns} brandId={brandId}/>}
   {(problem||message)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<ProblemBox problem={problem}/></div>}
  </div>
 </SheetContent></Sheet>;
}

function LeadBody({lead,act,busy,admin,intake,assignees,campaigns,brandId}:Common&{admin:boolean;intake:Intake|null;assignees:readonly Assignee[];campaigns:readonly {id:string;title:string}[];brandId:string}){
 const c={lead,act,busy},notices=intake?.notices??[];
 const retention=lead.contactState!=='present'&&lead.contactState!=='expired'?'연락처 없음':lead.retentionUntil?kst(lead.retentionUntil):'계약 리드는 종결 뒤 3년(종결 전에는 계산하지 않음)';
 return <>
  <section className="franchise-box" aria-label="리드 요약">
   <p><b>{contactLine(lead,true)}</b> <span className="status">{STAGE_LABELS[lead.stage]}</span>{lead.stage==='closed'&&lead.closeReason&&<span className="subtle-note"> 종결 사유: {labelOf(CLOSE_REASON_LABELS,lead.closeReason)} · {kst(lead.closedAt)}</span>}</p>
   <p className="subtle-note">{RETENTION_LABEL}: {retention}</p>
   <p className="subtle-note">{CONTACT_NOTE}</p>
  </section>
  {can(lead,'reveal_contact')&&<RevealBox key={lead.version} {...c}/>}
  <AssignBox {...c} admin={admin} assignees={assignees}/>
  <StageBox {...c}/>
  {admin&&lead.gate&&<GateCard gate={lead.gate}/>}
  {can(lead,'update_task')&&<Section title="과업 정보"><TaskForm key={lead.version} {...c} campaigns={campaigns}/></Section>}
  {can(lead,'update_contact')&&<Section title="연락처 수정" note="빈칸은 그대로 둡니다. 바꿀 값만 적으세요. 수정은 이력에 항목 이름만 남습니다."><ContactForm key={lead.version} {...c}/></Section>}
  <BasisBox {...c} notices={notices}/>
  <MarketingBox key={'m'+lead.version} {...c} notices={notices}/>
  {can(lead,'add_subject_request')&&<SubjectQuick key={'s'+lead.version} {...c}/>}
  {admin&&lead.evidence&&<EvidenceSection {...c} brandId={brandId}/>}
  {can(lead,'erase_lead')&&<Section title="연락처 삭제 실행 (정보주체 요청)" note={ERASE_CONFIRM}><div><Button variant="outline" disabled={busy} onClick={()=>{if(window.confirm(ERASE_CONFIRM))void act('erase_lead',{},'연락처·메모·중복 키를 삭제했습니다.',true)}}>삭제 실행</Button></div></Section>}
  <Timeline lead={lead}/>
 </>;
}

// 연락처 보기: 목적과 항목을 고르면 서버가 원문을 돌려주고 감사 기록(값 없음)을 남긴다. 값은 이 컴포넌트 상태에만 두고 60초 뒤·리드 변경 때 지운다.
function RevealBox({lead,act,busy}:Common){
 const available=(['name','phone','email','memo'] as ContactField[]).filter(f=>f==='name'||(f==='phone'&&!!lead.contact?.hasPhone)||(f==='email'&&!!lead.contact?.hasEmail)||(f==='memo'&&lead.hasMemo));
 const [fields,setFields]=useState<ContactField[]>(()=>available.filter(f=>f!=='memo')),[purpose,setPurpose]=useState<RevealPurpose>('call_back');
 const [values,setValues]=useState<Record<string,string|null>|null>(null);
 useEffect(()=>{if(!values)return;const t=setTimeout(()=>setValues(null),REVEAL_MS);return ()=>clearTimeout(t)},[values]);
 async function reveal(){
  const r=await act('reveal_contact',{fields:available.filter(f=>fields.includes(f)),purpose},undefined,true);
  const v=r?.body.values;if(v&&typeof v==='object')setValues(v as Record<string,string|null>);
 }
 return <Section title="연락처 보기" note="열람 목적과 항목이 기록에 남습니다. 보인 값은 60초 뒤 화면에서 지웁니다.">
  {values?<div className="franchise-revealed" aria-live="polite"><dl>{available.filter(f=>f in values).map(f=><div key={f}><dt>{CONTACT_FIELD_LABELS[f]}</dt><dd style={{whiteSpace:'pre-wrap'}}>{values[f]??'없음'}</dd></div>)}</dl><Button size="sm" variant="outline" onClick={()=>setValues(null)}>지금 가리기</Button></div>
  :<div className="franchise-bar">
   <LabelSelect label="열람 목적" labels={REVEAL_PURPOSE_LABELS} value={purpose} onChange={setPurpose}/>
   <fieldset className="franchise-inline"><legend className="sr-only">볼 항목</legend>{available.map(f=><label key={f}><input type="checkbox" checked={fields.includes(f)} onChange={e=>setFields(e.target.checked?[...fields,f]:fields.filter(x=>x!==f))}/> {CONTACT_FIELD_LABELS[f]}</label>)}</fieldset>
   <Button disabled={busy||!fields.length} onClick={()=>void reveal()}>연락처 보기</Button>
  </div>}
 </Section>;
}

function AssignBox({lead,act,busy,admin,assignees}:Common&{admin:boolean;assignees:readonly Assignee[]}){
 const [target,setTarget]=useState('');
 const others=assignees.filter(a=>a.id!==lead.assigneeId);
 return <Section title="담당">
  <p>현재 담당: <b>{assigneeLabel(lead,assignees)}</b></p>
  <div className="franchise-bar">
   {can(lead,'claim_lead')&&<Button disabled={busy} onClick={()=>void act('claim_lead',{},'이 리드를 내가 담당합니다.')}>내가 담당하기</Button>}
   {admin&&can(lead,'assign_lead')&&<><NativeSelect aria-label="담당자 바꾸기" value={target} onChange={e=>setTarget(e.target.value)}><NativeSelectOption value="">담당자 선택</NativeSelectOption>{lead.assigneeId!==null&&<NativeSelectOption value="__none">담당 없음</NativeSelectOption>}{others.map(a=><NativeSelectOption key={a.id} value={a.id}>{a.label}</NativeSelectOption>)}</NativeSelect>
    <Button variant="outline" disabled={busy||!target} onClick={()=>void act('assign_lead',{assigneeId:target==='__none'?null:target},'담당자를 바꿨습니다.').then(r=>{if(r)setTarget('')})}>담당 지정</Button></>}
  </div>
  {!admin&&lead.assigneeId!==null&&!lead.assignedToMe&&<p className="subtle-note">담당자 변경은 대표·관리자가 합니다.</p>}
 </Section>;
}

function StageBox({lead,act,busy}:Common){
 const moves=lead.allowedMoves.filter(s=>s!=='closed'),closable=lead.allowedMoves.includes('closed'),reopen=can(lead,'reopen_lead');
 const [reason,setReason]=useState<CloseReason|''>('');
 const reasons=Object.fromEntries(Object.entries(CLOSE_REASON_LABELS).filter(([k])=>k!=='contract_ended'||!!lead.contractedAt)) as Record<CloseReason,string>;
 return <Section title="단계" note="정보공개서 제공·계약서안 제공·계약·가맹금 예치는 증빙 기록으로만 진행합니다. 막히면 사유를 보여 줍니다.">
  <p>현재 단계: <b>{STAGE_LABELS[lead.stage]}</b>{lead.stage==='closed'&&lead.closedFrom?` (종결 전 ${STAGE_LABELS[lead.closedFrom]})`:''}</p>
  {(moves.length>0||reopen)&&<div className="franchise-bar">{moves.map(s=><Button key={s} variant="outline" disabled={busy} onClick={()=>void act('move_stage',{to:s},`${STAGE_LABELS[s]} 단계로 옮겼습니다.`)}>{s==='opened'?'개점 기록':STAGE_LABELS[s]+' 단계로'}</Button>)}
   {reopen&&<Button variant="outline" disabled={busy} onClick={()=>void act('reopen_lead',{},'리드를 다시 열었습니다.')}>다시 열기</Button>}</div>}
  {closable&&<div className="franchise-bar"><LabelSelect label="종결 사유" labels={reasons} value={reason} empty="사유 선택" onChange={setReason}/><Button variant="outline" disabled={busy||!reason} onClick={()=>void act('move_stage',{to:'closed',closeReason:reason},'리드를 종결했습니다.')}>종결</Button></div>}
  {!moves.length&&!closable&&!reopen&&<p className="subtle-note">지금 이 계정으로 옮길 수 있는 단계가 없습니다.</p>}
  <Disclaimer/>
 </Section>;
}

const sideText=(label:string,s:SideView)=>`${label}: ${s.startDate??'-'} 기산 · ${s.days??'-'}일 · 기간 말일 ${s.periodEnd??'-'}${s.shortened?' · 7일로 단축':''}${s.extended?' · 주말·공휴일로 말일 연장':''}`;
// 계약 가능 시각(대표·관리자): 가장 이른 계약 가능 시각, 기산 내역, 막힌 이유·참고·주의, 예상매출액 산정서 필요 여부, 개점 판정.
function GateCard({gate}:{gate:GateView}){
 const w=gate.window,opened=gate.stageChecks.opened;
 return <Section title="계약 가능 시각">
  <p><b>{w.atKst??'아직 계산할 수 없습니다'}</b></p><Disclaimer/>
  <p className="subtle-note">{sideText('정보공개서 쪽',w.disclosureSide)}</p>
  <p className="subtle-note">{sideText('계약서안 쪽',w.draftSide)}</p>
  {!!w.blockers.length&&<><p>막힌 이유</p><ul>{w.blockers.map(b=><li key={b.code}>{b.message}</li>)}</ul></>}
  {!!w.notes.length&&<><p>참고</p><ul>{w.notes.map(b=><li key={b.code}>{b.message}</li>)}</ul></>}
  {!!w.warnings.length&&<ul className="franchise-warnings">{w.warnings.map(b=><li key={b.code}>주의: {b.message}</li>)}</ul>}
  <p>예상매출액 산정서: {FORECAST_DUTY_LABELS[gate.forecastDuty]}</p>
  <p>개점 판정: {opened.ok?'진행 가능':'막힘'}</p>{!opened.ok&&!!opened.reasons.length&&<ul>{opened.reasons.map(r=><li key={r.code}>{r.message}</li>)}</ul>}
 </Section>;
}

function TaskForm({lead,act,busy,campaigns}:Common&{campaigns:readonly {id:string;title:string}[]}){
 const [task,setTask]=useState<LeadTask>(lead.task);
 const changed=(Object.keys(task) as (keyof LeadTask)[]).filter(k=>(task[k]||null)!==(lead.task[k]||null));
 return <form className="form-stack" onSubmit={e=>{e.preventDefault();void act('update_task',{task:Object.fromEntries(changed.map(k=>[k,k==='campaignId'?task[k]||null:task[k]]))},'과업 정보를 저장했습니다.')}}>
  <TaskFields task={task} onChange={setTask} campaigns={campaigns}/>
  <div className="form-actions"><Button type="submit" disabled={busy||!changed.length}>과업 저장</Button></div>
 </form>;
}

const blankContact={name:'',phone:'',email:'',memo:'',clearPhone:false,clearEmail:false,clearMemo:false};
// 연락처 수정: 입력값은 이 폼 상태에만 있고 저장에 성공하면 버전이 바뀌어 폼이 비워진다. 브라우저 자동 완성에 남지 않게 autoComplete를 끈다.
function ContactForm({lead,act,busy}:Common){
 const [f,setF]=useState(blankContact);
 const contact={...(f.name.trim()?{name:f.name}:{}),...(f.clearPhone?{phone:null}:f.phone.trim()?{phone:f.phone}:{}),...(f.clearEmail?{email:null}:f.email.trim()?{email:f.email}:{})};
 const memo=f.clearMemo?{memo:null}:f.memo.trim()?{memo:f.memo}:{},empty=!Object.keys(contact).length&&!('memo' in memo);
 return <form className="form-stack" autoComplete="off" onSubmit={e=>{e.preventDefault();void act('update_contact',{...(Object.keys(contact).length?{contact}:{}),...memo},'연락처를 수정했습니다.')}}>
  <div className="form-two"><label className="field"><span>이름</span><Input autoComplete="off" maxLength={40} value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></label>
   <label className="field"><span>전화</span><Input autoComplete="off" inputMode="tel" maxLength={40} disabled={f.clearPhone} placeholder="010-0000-0000" value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/>{lead.contact?.hasPhone&&<label className="franchise-inline"><input type="checkbox" checked={f.clearPhone} onChange={e=>setF({...f,clearPhone:e.target.checked,phone:''})}/> 전화 지우기</label>}</label></div>
  <label className="field"><span>이메일</span><Input autoComplete="off" type="email" maxLength={254} disabled={f.clearEmail} placeholder="name@example.com" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/>{lead.contact?.hasEmail&&<label className="franchise-inline"><input type="checkbox" checked={f.clearEmail} onChange={e=>setF({...f,clearEmail:e.target.checked,email:''})}/> 이메일 지우기</label>}</label>
  <label className="field"><span>메모 (1000자)</span><Textarea autoComplete="off" rows={3} maxLength={1000} disabled={f.clearMemo} value={f.memo} onChange={e=>setF({...f,memo:e.target.value})}/><small>{MEMO_HINT}</small>{lead.hasMemo&&<label className="franchise-inline"><input type="checkbox" checked={f.clearMemo} onChange={e=>setF({...f,clearMemo:e.target.checked,memo:''})}/> 메모 지우기</label>}</label>
  <p className="subtle-note">전화·이메일 중 하나는 남아야 합니다.</p>
  <div className="form-actions"><Button type="button" variant="outline" disabled={busy} onClick={()=>setF(blankContact)}>비우기</Button><Button type="submit" disabled={busy||empty}>연락처 저장</Button></div>
 </form>;
}

function BasisBox({lead,act,busy,notices}:Common&{notices:Intake['notices']}){
 const b=lead.basis,[at,setAt]=useState<TimeValue>(NOW),notice=notices.find(n=>n.id===b.noticeId);
 return <Section title="수집 근거">
  <p>{BASIS_LABELS[b.type]}</p>
  {b.type==='consent'&&<p className="subtle-note">개인정보 안내문 {notice?notice.versionLabel:'(사용 중지된 버전)'} · 안내 시각 {kst(b.noticeGivenAt)}</p>}
  {b.type==='referral'&&<>
   <p className="subtle-note">소개: {labelOf(REFERRAL_LABELS,b.referralFrom)} · {b.sourceNoticedAt?`출처 고지함 ${kst(b.sourceNoticedAt)}`:'출처 고지 필요'}</p>
   {!b.sourceNoticedAt&&<p className="subtle-note">다른 사람에게 소개받은 연락처입니다. 처음 연락할 때 어디서 연락처를 받았는지 알리고 기록하세요.</p>}
   {!b.sourceNoticedAt&&can(lead,'record_source_notice')&&<div className="franchise-bar"><TimeField label="고지한 시각" value={at} onChange={setAt}/><Button disabled={busy||!timeOf(at)} onClick={()=>void act('record_source_notice',{noticedAt:timeOf(at)},'출처 고지를 기록했습니다.')}>고지함</Button></div>}
  </>}
 </Section>;
}

// 광고성 정보: 문의 응대와 별개로 받는다. 기본은 동의 없음이다. 철회는 보호 방향이라 언제나(스위트 꺼짐 포함) 기록할 수 있다. 발송 기능은 없다.
function MarketingBox({lead,act,busy,notices}:Common&{notices:Intake['notices']}){
 const m=lead.marketing,[method,setMethod]=useState<MarketingMethod|''>(''),[at,setAt]=useState<TimeValue>(NOW),[noticeId,setNoticeId]=useState('');
 const given=lead.marketingOptions.includes('given'),withdraw=lead.marketingOptions.includes('withdrawn');
 return <Section title="광고성 정보 수신" note="광고성 정보 동의는 문의 응대와 따로 받습니다. 기본은 동의 없음이며 COLLECTIVE는 메시지를 보내지 않습니다.">
  <p>{MARKETING_STATUS_LABELS[m.status]}{m.status==='given'?` · ${labelOf(MARKETING_METHOD_LABELS,m.method)} · ${kst(m.at)}`:m.status==='withdrawn'?` · ${kst(m.withdrawnAt)}`:''}</p>
  {lead.marketingRecheck&&<p className="form-error">{RECHECK_LABEL}</p>}
  {withdraw&&<div><Button variant="outline" disabled={busy} onClick={()=>{if(window.confirm('광고성 정보 수신 철회를 기록할까요?'))void act('set_marketing_consent',{status:'withdrawn'},'광고성 정보 수신 철회를 기록했습니다.',true)}}>수신 철회</Button></div>}
  {given&&<details><summary>동의 기록 (대표·관리자)</summary><div className="form-stack">
   <LabelSelect label="동의 방법" labels={MARKETING_METHOD_LABELS} value={method} empty="방법 선택" onChange={setMethod}/>
   <TimeField label="동의 시각" value={at} onChange={setAt}/>
   <label className="field"><span>안내한 개인정보 안내문</span><NativeSelect value={noticeId} onChange={e=>setNoticeId(e.target.value)}><NativeSelectOption value="">안내문 선택</NativeSelectOption>{notices.map(n=><NativeSelectOption key={n.id} value={n.id}>{n.versionLabel}</NativeSelectOption>)}</NativeSelect>{!notices.length&&<small>설정에서 개인정보 안내문을 먼저 등록하세요.</small>}</label>
   <div><Button disabled={busy||!method||!noticeId||!timeOf(at)} onClick={()=>void act('set_marketing_consent',{status:'given',method,at:timeOf(at),noticeId},'광고성 정보 수신 동의를 기록했습니다.')}>동의 기록</Button></div>
  </div></details>}
 </Section>;
}

function SubjectQuick({act,busy}:Common){
 const [type,setType]=useState<SubjectRequestType|''>(''),[channel,setChannel]=useState<SubjectChannel|''>(''),[at,setAt]=useState<TimeValue>(NOW);
 return <details className="franchise-box"><summary>정보주체 요청 접수 (열람·정정·삭제·처리정지·출처 고지)</summary><div className="form-stack">
  <div className="form-two"><LabelSelect label="요청 유형" labels={SUBJECT_REQUEST_TYPE_LABELS} value={type} empty="유형 선택" onChange={setType}/><LabelSelect label="접수 경로" labels={SUBJECT_CHANNEL_LABELS} value={channel} empty="경로 선택" onChange={setChannel}/></div>
  <TimeField label="접수 시각 (30일 안)" value={at} onChange={setAt}/>
  <p className="subtle-note">{DUE_LABEL}. 요청한 사람의 이름·연락처는 따로 적지 않습니다.</p>
  <div><Button disabled={busy||!type||!channel||!timeOf(at)} onClick={()=>void act('add_subject_request',{type,channel,receivedAt:timeOf(at)},undefined,true).then(r=>{const due=r?.body.result?.dueAt;if(r)window.alert(`정보주체 요청을 접수했습니다. 처리 기한 ${kst(typeof due==='string'?due:null)}`)})}>요청 접수</Button></div>
 </div></details>;
}

// ── 증빙(대표·관리자) ──
type SettingsLite={profile:{storageLabels:string[]}|null;versions:{id:string;label:string;status:string}[];templates:{id:string;label:string;status:string;complete:boolean}[]};
const HAND_KEYS=Object.keys(HAND_EVIDENCE_LABELS) as (keyof typeof HAND_EVIDENCE_LABELS)[];
type EvForm={type:EvidenceType;docSha256:string;storageLabel:string;backdateReason:string;supersedes:string;correctionReason:string;
 doc:keyof typeof DELIVERY_DOC_LABELS;method:'hand'|'certified_mail'|'electronic';deliveredAt:TimeValue;versionId:string;templateId:string;hand:Record<typeof HAND_KEYS[number],boolean>;receiptConfirmed:boolean;
 channel:keyof typeof ELECTRONIC_CHANNEL_LABELS;received:boolean;receivedAt:TimeValue;printable:boolean;
 advisorType:keyof typeof ADVISOR_TYPE_LABELS;registrationVerified:boolean;advisedOn:string;targetDoc:'disclosure'|'draft';hqPaid:string;hqReferred:string;
 providedAt:TimeValue;signedAt:TimeValue;category:keyof typeof FEE_CATEGORY_LABELS;paid:boolean;paidAt:TimeValue;proof:'none'|'escrow'|'insurance';institutionType:keyof typeof ESCROW_INSTITUTION_LABELS;
 firstDepositAt:TimeValue;hasAgreementAt:boolean;agreementAt:TimeValue;coverageFrom:string;coverageTo:string;clauses:{fee:boolean;construction:boolean;training:boolean}};
const blankEvidence=(type:EvidenceType):EvForm=>({type,docSha256:'',storageLabel:'',backdateReason:'',supersedes:'',correctionReason:'',doc:'disclosure',method:'hand',deliveredAt:NOW,versionId:'',templateId:'',
 hand:Object.fromEntries(HAND_KEYS.map(k=>[k,false])) as EvForm['hand'],receiptConfirmed:false,channel:'email',received:false,receivedAt:NOW,printable:false,
 advisorType:'franchise_consultant',registrationVerified:false,advisedOn:'',targetDoc:'disclosure',hqPaid:'',hqReferred:'',providedAt:NOW,signedAt:NOW,category:'a_join',paid:true,paidAt:NOW,proof:'escrow',institutionType:'bank',
 firstDepositAt:NOW,hasAgreementAt:false,agreementAt:NOW,coverageFrom:'',coverageTo:'',clauses:{fee:false,construction:false,training:false}});
const tri=(v:string)=>v==='yes'?true:v==='no'?false:null;
// 서버 whitelist와 같은 키만 보낸다(자유 입력 칸 없음). times는 기록 시각보다 이를 수 있는 증빙 시각이다('지금'이 아니면 사유가 필요하다).
function evidenceRequest(f:EvForm):{action:string;payload:Json;times:TimeValue[]}{
 const common={...(f.docSha256?{docSha256:f.docSha256}:{}),...(f.storageLabel?{storageLabel:f.storageLabel}:{}),...(f.supersedes?{supersedes:f.supersedes,correctionReason:f.correctionReason}:{})};
 switch(f.type){
  case 'delivery':{
   const evidence=f.method==='hand'?{hand:f.hand}:f.method==='certified_mail'?{certifiedMail:{receiptConfirmed:f.receiptConfirmed}}:{electronic:{channel:f.channel,receivedAt:f.received?timeOf(f.receivedAt):null,printable:f.printable}};
   return {action:'record_delivery',payload:{...common,doc:f.doc,method:f.method,deliveredAt:timeOf(f.deliveredAt),...(f.doc==='disclosure'?{versionId:f.versionId}:{}),...(f.doc==='draft'?{templateId:f.templateId}:{}),evidence},times:[f.deliveredAt,...(f.method==='electronic'&&f.received?[f.receivedAt]:[])]};
  }
  case 'advice':return {action:'record_advice',payload:{...common,advisorType:f.advisorType,registrationVerified:f.registrationVerified,advisedOn:f.advisedOn,targetDoc:f.targetDoc,hqPaid:tri(f.hqPaid),hqReferred:tri(f.hqReferred)},times:[]};
  case 'forecast':return {action:'record_forecast',payload:{...common,providedAt:timeOf(f.providedAt)},times:[f.providedAt]};
  case 'contract':return {action:'record_contract',payload:{...common,signedAt:timeOf(f.signedAt)},times:[f.signedAt]};
  case 'agreement':return {action:'record_agreement',payload:{...common,signedAt:timeOf(f.signedAt),clauses:f.clauses},times:[f.signedAt]};
  default:{
   const escrow=f.proof==='escrow'?{institutionType:f.institutionType,firstDepositAt:timeOf(f.firstDepositAt),agreementAt:f.hasAgreementAt?timeOf(f.agreementAt):null}:null;
   const insurance=f.proof==='insurance'?{coverageFrom:kstDate(f.coverageFrom),coverageTo:kstDate(f.coverageTo)}:null;
   return {action:'record_fee',payload:{...common,category:f.category,...(f.paid?{paidAt:timeOf(f.paidAt)}:{}),...(escrow?{escrow}:{}),...(insurance?{insurance}:{})},times:[...(f.paid?[f.paidAt]:[]),...(escrow?[f.firstDepositAt,...(f.hasAgreementAt?[f.agreementAt]:[])]:[])]};
  }
 }
}
function evidenceSummary(e:EvidenceView,settings:SettingsLite|null){
 const p=e.payload??{},s=(k:string)=>typeof p[k]==='string'?p[k] as string:null;
 if(e.voided)return '다른 리드 기록 무효화';
 switch(e.evidenceType){
  case 'delivery':{const v=settings?.versions.find(x=>x.id===p.versionId)?.label,t=settings?.templates.find(x=>x.id===p.templateId)?.label;return [labelOf(DELIVERY_DOC_LABELS,s('doc')),labelOf(DELIVERY_METHOD_LABELS,s('method')),'제공 '+kst(s('deliveredAt')),v,t].filter(Boolean).join(' · ')}
  case 'advice':return [labelOf(ADVISOR_TYPE_LABELS,s('advisorType')),'자문일 '+(s('advisedOn')??'-'),'대상 '+labelOf(DELIVERY_DOC_LABELS,s('targetDoc')),p.registrationVerified?'등록 확인':'등록 미확인'].join(' · ');
  case 'forecast':return '서면 제공 '+kst(s('providedAt'));
  case 'contract':return '서명 '+kst(s('signedAt'));
  case 'agreement':{const c=(p.clauses??{}) as Record<string,boolean>;return ['서명 '+kst(s('signedAt')),'조항: '+([c.fee&&'가맹금',c.construction&&'공사',c.training&&'교육'].filter(Boolean).join('·')||'없음')].join(' · ')}
  case 'fee':{const esc=p.escrow as Json|undefined,ins=p.insurance as Json|undefined;return [labelOf(FEE_CATEGORY_LABELS,s('category')),s('paidAt')?'수령 '+kst(s('paidAt')):null,esc?`예치 ${labelOf(ESCROW_INSTITUTION_LABELS,esc.institutionType as string)} · 첫 입금 ${kst(esc.firstDepositAt as string)}`:null,ins?`보험 ${kst(ins.coverageFrom as string)}~${kst(ins.coverageTo as string)}`:null].filter(Boolean).join(' · ')}
  default:return '';
 }
}
function EvidenceSection({lead,act,busy,brandId}:Common&{brandId:string}){
 const [settings,setSettings]=useState<SettingsLite|null>(null),[settingsError,setSettingsError]=useState('');
 useEffect(()=>{const c=new AbortController();franchiseGet<SettingsLite>({view:'settings',brandId},c.signal).then(d=>{if(!c.signal.aborted)setSettings(d)},e=>{if(!c.signal.aborted)setSettingsError(messageOf(e))});return ()=>c.abort()},[brandId]);
 const recordable=can(lead,'record_delivery');
 return <>
  {settingsError&&<p className="form-error" role="alert">{settingsError}</p>}
  {recordable&&<Section title="증빙 기록" note="증빙은 추가만 합니다. 고칠 때는 정정 대상을 골라 새로 기록합니다. 기록 시각은 서버 시각이고, 그보다 이른 증빙 시각은 사유가 필요합니다."><EvidenceForm key={lead.version} lead={lead} act={act} busy={busy} settings={settings}/></Section>}
  {!recordable&&lead.stage==='closed'&&<p className="subtle-note">종결된 리드는 다시 연 뒤 증빙을 기록합니다.</p>}
  <EvidenceList lead={lead} act={act} busy={busy} settings={settings}/>
 </>;
}
function EvidenceForm({lead,act,busy,settings}:Common&{settings:SettingsLite|null}){
 const [f,setF]=useState<EvForm>(()=>blankEvidence('delivery'));
 const set=(patch:Partial<EvForm>)=>setF({...f,...patch});
 const req=evidenceRequest(f),backdate=req.times.some(t=>!t.now),labels=settings?.profile?.storageLabels??[];
 const versions=(settings?.versions??[]).filter(v=>v.status==='active'),templates=(settings?.templates??[]).filter(t=>t.status==='active');
 const targets=(lead.evidence??[]).filter(e=>e.evidenceType===f.type&&!e.voided&&!e.superseded);
 const missing=req.times.some(t=>!timeOf(t))||(f.type==='delivery'&&((f.doc==='disclosure'&&!f.versionId)||(f.doc==='draft'&&!f.templateId)))||(f.type==='advice'&&!f.advisedOn)||(f.type==='forecast'&&!f.docSha256)
  ||(f.type==='fee'&&f.proof==='insurance'&&(!f.coverageFrom||!f.coverageTo))||(backdate&&!f.backdateReason)||(!!f.supersedes&&!f.correctionReason);
 async function submit(){
  const r=await act(req.action,{...req.payload,...(backdate?{backdateReason:f.backdateReason}:{})},`${EVIDENCE_TYPE_LABELS[f.type]} 기록을 저장했습니다.`);
  const a=r?.body.result?.assessment as {counted?:boolean;reasons?:{message:string}[]}|undefined;
  if(a&&a.counted===false)window.alert('기록했지만 기산에 쓰지 않습니다: '+(a.reasons??[]).map(x=>x.message).join(' ')+' (COLLECTIVE 휴리스틱 · 법률 자문 아님)');
 }
 return <form className="form-stack" onSubmit={e=>{e.preventDefault();void submit()}}>
  <LabelSelect label="기록할 증빙" labels={EVIDENCE_TYPE_LABELS} value={f.type} onChange={type=>setF({...blankEvidence(type),storageLabel:f.storageLabel})}/>
  {f.type==='delivery'&&<>
   <div className="form-two"><LabelSelect label="문서" labels={DELIVERY_DOC_LABELS} value={f.doc} onChange={doc=>set({doc})}/>
    <LabelSelect label="제공 방법" labels={{hand:DELIVERY_METHOD_LABELS.hand,certified_mail:DELIVERY_METHOD_LABELS.certified_mail,electronic:DELIVERY_METHOD_LABELS.electronic}} value={f.method} onChange={method=>set({method})}/></div>
   <p className="subtle-note">공정위 사이트 링크 안내는 제공으로 기록하지 않습니다.</p>
   {f.doc==='disclosure'&&<label className="field"><span>정보공개서 버전</span><NativeSelect required value={f.versionId} onChange={e=>set({versionId:e.target.value})}><NativeSelectOption value="">버전 선택</NativeSelectOption>{versions.map(v=><NativeSelectOption key={v.id} value={v.id}>{v.label}</NativeSelectOption>)}</NativeSelect>{!versions.length&&<small>설정에서 최신 정보공개서 버전을 먼저 등록하세요.</small>}</label>}
   {f.doc==='draft'&&<label className="field"><span>가맹계약서안 템플릿</span><NativeSelect required value={f.templateId} onChange={e=>set({templateId:e.target.value})}><NativeSelectOption value="">템플릿 선택</NativeSelectOption>{templates.map(t=><NativeSelectOption key={t.id} value={t.id}>{t.label}{t.complete?'':' · 13개 항목 확인 미완'}</NativeSelectOption>)}</NativeSelect></label>}
   <TimeField label="제공 시각" value={f.deliveredAt} onChange={deliveredAt=>set({deliveredAt})}/>
   {f.method==='hand'&&<fieldset className="field"><legend>직접 전달 증빙</legend>{HAND_KEYS.map(k=><label key={k} className="franchise-inline"><input type="checkbox" checked={f.hand[k]} onChange={e=>set({hand:{...f.hand,[k]:e.target.checked}})}/> {HAND_EVIDENCE_LABELS[k]}</label>)}</fieldset>}
   {f.method==='certified_mail'&&<label className="franchise-inline"><input type="checkbox" checked={f.receiptConfirmed} onChange={e=>set({receiptConfirmed:e.target.checked})}/> 내용증명 수령 확인</label>}
   {f.method==='electronic'&&<><LabelSelect label="전자 방식 채널" labels={ELECTRONIC_CHANNEL_LABELS} value={f.channel} onChange={channel=>set({channel})}/>
    <label className="franchise-inline"><input type="checkbox" checked={f.printable} onChange={e=>set({printable:e.target.checked})}/> 출력 가능한 형태로 보냄</label>
    <label className="franchise-inline"><input type="checkbox" checked={f.received} onChange={e=>set({received:e.target.checked})}/> 수신 시각 확인함</label>
    {f.received&&<TimeField label="수신 시각" value={f.receivedAt} onChange={receivedAt=>set({receivedAt})}/>}</>}
  </>}
  {f.type==='advice'&&<>
   <div className="form-two"><LabelSelect label="자문자" labels={ADVISOR_TYPE_LABELS} value={f.advisorType} onChange={advisorType=>set({advisorType})}/><LabelSelect label="자문 대상 문서" labels={{disclosure:DELIVERY_DOC_LABELS.disclosure,draft:DELIVERY_DOC_LABELS.draft}} value={f.targetDoc} onChange={targetDoc=>set({targetDoc})}/></div>
   <label className="field"><span>자문일</span><Input type="date" required value={f.advisedOn} onChange={e=>set({advisedOn:e.target.value})}/></label>
   <label className="franchise-inline"><input type="checkbox" checked={f.registrationVerified} onChange={e=>set({registrationVerified:e.target.checked})}/> 자문자 등록 확인함</label>
   <div className="form-two"><LabelSelect label="본부가 비용 부담" labels={{yes:'예',no:'아니오'}} value={f.hqPaid} empty="모름" onChange={hqPaid=>set({hqPaid})}/><LabelSelect label="본부가 자문자 소개" labels={{yes:'예',no:'아니오'}} value={f.hqReferred} empty="모름" onChange={hqReferred=>set({hqReferred})}/></div>
  </>}
  {f.type==='forecast'&&<TimeField label="서면 제공 시각" value={f.providedAt} onChange={providedAt=>set({providedAt})}/>}
  {(f.type==='contract'||f.type==='agreement')&&<TimeField label="서명 시각" value={f.signedAt} onChange={signedAt=>set({signedAt})}/>}
  {f.type==='contract'&&<p className="subtle-note">계약 가능 시각 전이거나 필요한 제공 기록이 없으면 저장하지 않고 사유를 보여 줍니다.</p>}
  {f.type==='agreement'&&<fieldset className="field"><legend>약정에 든 조항</legend>{(['fee','construction','training'] as const).map(k=><label key={k} className="franchise-inline"><input type="checkbox" checked={f.clauses[k]} onChange={e=>set({clauses:{...f.clauses,[k]:e.target.checked}})}/> {({fee:'가맹금',construction:'공사',training:'교육'})[k]}</label>)}</fieldset>}
  {f.type==='fee'&&<>
   <LabelSelect label="가맹금 유형" labels={FEE_CATEGORY_LABELS} value={f.category} onChange={category=>set({category})}/>
   <label className="franchise-inline"><input type="checkbox" checked={f.paid} onChange={e=>set({paid:e.target.checked})}/> 수령 시각 기록</label>
   {f.paid&&<TimeField label="수령 시각" value={f.paidAt} onChange={paidAt=>set({paidAt})}/>}
   <LabelSelect label="예치·보험 증빙" labels={{none:'없음',escrow:'예치',insurance:'피해보상보험'}} value={f.proof} onChange={proof=>set({proof})}/>
   {f.proof==='escrow'&&<><LabelSelect label="예치기관" labels={ESCROW_INSTITUTION_LABELS} value={f.institutionType} onChange={institutionType=>set({institutionType})}/><TimeField label="첫 예치 시각" value={f.firstDepositAt} onChange={firstDepositAt=>set({firstDepositAt})}/>
    <label className="franchise-inline"><input type="checkbox" checked={f.hasAgreementAt} onChange={e=>set({hasAgreementAt:e.target.checked})}/> 예치 합의 시각 기록</label>{f.hasAgreementAt&&<TimeField label="예치 합의 시각" value={f.agreementAt} onChange={agreementAt=>set({agreementAt})}/>}</>}
   {f.proof==='insurance'&&<div className="form-two"><label className="field"><span>보험 시작일</span><Input type="date" required value={f.coverageFrom} onChange={e=>set({coverageFrom:e.target.value})}/></label><label className="field"><span>보험 종료일 (미래 가능)</span><Input type="date" required value={f.coverageTo} onChange={e=>set({coverageTo:e.target.value})}/></label></div>}
  </>}
  <HashField label="문서 해시" value={f.docSha256} required={f.type==='forecast'} onChange={docSha256=>set({docSha256})}/>
  <StorageField labels={labels} value={f.storageLabel} onChange={storageLabel=>set({storageLabel})}/>
  {backdate&&<LabelSelect label="기록 시각보다 이른 증빙 시각 사유" labels={BACKDATE_REASON_LABELS} value={f.backdateReason} empty="사유 선택" required onChange={backdateReason=>set({backdateReason})}/>}
  {!!targets.length&&<details><summary>정정 (선택)</summary><div className="form-two">
   <label className="field"><span>정정 대상</span><NativeSelect value={f.supersedes} onChange={e=>set({supersedes:e.target.value})}><NativeSelectOption value="">정정하지 않음</NativeSelectOption>{targets.map(t=><NativeSelectOption key={t.id} value={t.id}>{evidenceSummary(t,settings)} · 기록 {kst(t.recordedAt)}</NativeSelectOption>)}</NativeSelect></label>
   <LabelSelect label="정정 사유" labels={{typo:CORRECTION_REASON_LABELS.typo,wrong_time:CORRECTION_REASON_LABELS.wrong_time,wrong_document:CORRECTION_REASON_LABELS.wrong_document,other:CORRECTION_REASON_LABELS.other}} value={f.correctionReason} empty="사유 선택" onChange={correctionReason=>set({correctionReason})}/>
  </div></details>}
  <div className="form-actions"><Button type="submit" disabled={busy||missing}>{EVIDENCE_TYPE_LABELS[f.type]} 기록</Button></div>
  <Disclaimer/>
 </form>;
}
function EvidenceList({lead,act,busy,settings}:Common&{settings:SettingsLite|null}){
 const rows=lead.evidence??[];
 if(!rows.length)return <Section title="증빙 목록"><p className="subtle-note">아직 기록한 증빙이 없습니다.</p></Section>;
 return <Section title="증빙 목록" note="추가 전용입니다. 지우지 않고 정정·무효 표시로 남깁니다.">
  <ul className="franchise-list">{rows.map(e=><li key={e.id}>
   <p><b>{labelOf(EVIDENCE_TYPE_LABELS,e.evidenceType)}</b> {e.superseded&&<span className="status status-outdated">정정됨</span>}{e.voided&&<span className="status status-revision">무효</span>} {evidenceSummary(e,settings)}</p>
   <p className="subtle-note">기록 {kst(e.recordedAt)} · {roleLabel(e.recordedBy.role)}{e.backdateApproval?` · 이른 시각 사유: ${labelOf(BACKDATE_REASON_LABELS,e.backdateApproval.reasonCode)}`:''}{e.correctionReason?` · 정정 사유: ${labelOf(CORRECTION_REASON_LABELS,e.correctionReason)}`:''}{e.storageLabel?` · 보관 ${e.storageLabel}`:''}{e.docSha256?` · 해시 ${e.docSha256.slice(0,12)}`:''}</p>
   {e.assessment&&<p className="subtle-note">{e.assessment.counted?'기산에 씀':'기산에 쓰지 않음'}{e.assessment.reasons.length?': '+e.assessment.reasons.map(r=>r.message).join(' '):''}</p>}
   {can(lead,'void_evidence')&&!e.voided&&!e.superseded&&e.evidenceType!=='contract'&&<VoidButton id={e.id} act={act} busy={busy}/>}
  </li>)}</ul>
  <Disclaimer/>
 </Section>;
}
// 다른 리드에 잘못 적은 기록을 무효로 표시한다(계약 기록은 정정만). 단계는 되돌리지 않고 게이트가 그 기록을 세지 않는다.
function VoidButton({id,act,busy}:{id:string;act:Act;busy:boolean}){
 const [reason,setReason]=useState('');
 return <div className="franchise-bar"><LabelSelect label="무효 사유" labels={CORRECTION_REASON_LABELS} value={reason} empty="사유 선택" onChange={setReason}/>
  <Button size="sm" variant="outline" disabled={busy||!reason} onClick={()=>{if(window.confirm('이 증빙을 무효로 표시할까요? 기록은 지우지 않고 남습니다.'))void act('void_evidence',{supersedes:id,correctionReason:reason},'증빙을 무효로 표시했습니다.')}}>다른 리드 기록 무효화</Button></div>;
}

// 이력: 종류·단계·사유·항목 이름·시각·역할만 보인다(값 없음).
function eventLine(e:LeadDetail['events'][number]){
 return [labelOf(EVENT_TYPE_LABELS,e.type),e.from||e.to?`${e.from?STAGE_LABELS[e.from]:''} → ${e.to?STAGE_LABELS[e.to]:''}`:null,e.closeReason?'사유 '+labelOf(CLOSE_REASON_LABELS,e.closeReason):null,
  e.fields?.length?'항목 '+e.fields.map(f=>labelOf(CONTACT_FIELD_LABELS,f)).join('·'):null,e.taskFields?.length?'항목 '+e.taskFields.map(f=>labelOf(TASK_FIELD_LABELS,f)).join('·'):null,
  e.basis?.type?'근거 '+labelOf(BASIS_LABELS,e.basis.type):null,e.consent?.method?'방법 '+labelOf(MARKETING_METHOD_LABELS,e.consent.method):null,e.evidenceType?labelOf(EVIDENCE_TYPE_LABELS,e.evidenceType):null,
  e.assigneeId!==undefined&&e.type==='assigned'?(e.assigneeId?'담당 지정':'담당 없음'):null].filter(Boolean).join(' · ');
}
function Timeline({lead}:{lead:LeadDetail}){
 return <Section title="이력">{lead.events.length?<ul className="franchise-list">{lead.events.map(e=><li key={e.id}><p>{eventLine(e)}</p>{!!e.reasons?.length&&<ul>{e.reasons.map(r=><li key={r.code}>{r.message}</li>)}</ul>}<p className="subtle-note">{kst(e.at)} · {roleLabel(e.actor.role)}</p></li>)}</ul>:<p className="subtle-note">이력이 없습니다.</p>}</Section>;
}
