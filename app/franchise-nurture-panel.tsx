'use client';
// 가맹 모집 화면 '너처링' 탭(트랙 R R9a): 예비창업자에게 사람이 직접 보낼 메시지의 자리표시 템플릿을 만들고 모은다. 앱은 메시지를 보내지 않는다.
// AI 초안은 HERMES 1회(목적·분류·매체·브랜드 정체성·확정 사실 줄만 보냄, 리드 정보 없음)이고, 검사를 통과한 초안만 편집기에 채운다. 저장·판정은 서버가 한다.
// 템플릿 폐기는 대표·관리자만. 발송 기록은 리드 상세에서 남긴다(app/franchise-lead-detail.tsx). 분류는 COLLECTIVE 해석 · 법률 자문 아님(LR-2 전).
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {franchiseGet,franchisePost,problemOf,messageOf,ProblemBox,Disclaimer,Section,kst,copyText,type Json,type Problem} from './franchise-common';

// ── 보기 모양(서버 nurture 보기) ──
export type PurposeOption={key:string;label:string;classification:string;classificationLabel:string};
export type TemplateView={templateId:string;version:number;versions:number;purpose:string;classification:string;medium:string;subject:string|null;body:string;status:'active'|'retired';aiAssisted:boolean;updatedAt:string};
export type DraftView={id:string;purpose:string;medium:string;status:string;result:{subject:string|null;body:string}|null;reasons:string[];error?:string;createdAt:string};
export type NurtureViewData={templates:TemplateView[];drafts:DraftView[];activeDraft:string|null;purposes:PurposeOption[];media:{key:string;label:string}[];placeholders:string[];
 limits:{bodyChars:number;subjectChars:number};enabled:boolean;role:string;classificationNote:string;disclaimer:string};

// ── 고정 문구 ──
export const NO_SEND_NOTE='앱은 메시지를 보내지 않습니다. 템플릿을 복사해 담당자가 직접 보내고, 보낸 뒤 리드 상세에서 \'발송 기록\'만 남깁니다.';
export const AD_NOTE='광고성 템플릿은 저장만 할 수 있습니다. 광고성 메시지의 발송 기록은 매체별 수신 동의 확인(R9b) 뒤에 열립니다.';
export const DRAFT_NOTE='AI 초안은 목적·매체·브랜드 소개·확정 사실만 HERMES에 보냅니다. 리드 이름·연락처는 보내지 않고 자리표시로 둡니다.';
export const RETIRE_CONFIRM='이 템플릿을 폐기합니다. 폐기한 템플릿으로는 발송 기록을 남길 수 없고 되돌릴 수 없습니다.';
const ACTIVE_STATUSES=['starting','queued','in_progress','uncertain'];
export const POLL_MS=3000;

// ── 순수 도우미 ──
export const labelOf=(list:readonly {key:string;label:string}[],key:string)=>list.find(x=>x.key===key)?.label??key;
export const newDraftId=()=>'nd-'+Math.random().toString(36).slice(2,12)+Date.now().toString(36);
export const saveInput=(f:{templateId:string|null;base:number|null;purpose:string;medium:string;subject:string;body:string;draftId:string|null}):Json=>({
 ...(f.templateId?{templateId:f.templateId,baseVersion:f.base}:{}),purpose:f.purpose,medium:f.medium,subject:f.medium==='email'&&f.subject.trim()?f.subject:null,body:f.body,...(f.draftId?{draftId:f.draftId}:{})});
export function draftMessage(d:DraftView):string{
 if(d.status==='completed')return 'AI 초안을 편집기에 넣었습니다. 읽고 고친 뒤 저장하세요.';
 if(d.status==='failed')return d.reasons.length?`AI 초안이 검사에서 막혀 저장하지 않았습니다(${d.reasons.join(', ')}). 다시 요청하거나 직접 쓰세요.`:(d.error??'AI 초안을 만들지 못했습니다.');
 if(d.status==='cancelled')return 'AI 초안을 중지했습니다.';
 if(d.status==='uncertain')return d.error??'접수 여부를 확인하지 못했습니다. 복구를 눌러 이어서 확인하세요.';
 return 'AI 초안을 작성하고 있습니다.';
}

// ── 탭 본체 ──
export function FranchiseNurture({brandId,admin,initial}:{brandId:string;admin:boolean;initial?:NurtureViewData}){
 const [data,setData]=useState<NurtureViewData|null>(initial??null),[error,setError]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const d=await franchiseGet<NurtureViewData>({view:'nurture',brandId},signal);if(!signal?.aborted){setData(d);setError('')}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
 },[brandId]);
 useEffect(()=>{if(initial)return;const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load,initial]);
 return <Section title="너처링 템플릿(사람이 보내는 메시지)">
  <p className="notice" role="note"><strong>{NO_SEND_NOTE}</strong></p>
  <p className="subtle-note">{`분류는 ${data?.classificationNote??'COLLECTIVE 해석 · 법률 자문 아님'}입니다. ${AD_NOTE}`}</p>
  <Disclaimer/>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>}
  {!data?!error&&<p role="status">너처링 템플릿을 불러오고 있습니다.</p>:<>
   <TemplateEditor brandId={brandId} data={data} onDone={()=>void load()}/>
   <TemplateList brandId={brandId} data={data} admin={admin} onDone={()=>void load()}/>
  </>}
 </Section>;
}

function TemplateEditor({brandId,data,onDone}:{brandId:string;data:NurtureViewData;onDone:()=>void}){
 const [purpose,setPurpose]=useState(data.purposes[0]?.key??''),[medium,setMedium]=useState('email'),[subject,setSubject]=useState(''),[body,setBody]=useState('');
 const [draftId,setDraftId]=useState<string|null>(null),[draft,setDraft]=useState<DraftView|null>(null),[busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null),[message,setMessage]=useState('');
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 const cls=data.purposes.find(p=>p.key===purpose);
 function applyDraft(d:DraftView){
  setDraft(d);setMessage(draftMessage(d));
  if(d.status==='completed'&&d.result){setBody(d.result.body);setSubject(d.result.subject??'');setDraftId(d.id)}
  if(ACTIVE_STATUSES.includes(d.status)&&d.status!=='uncertain')timer.current=setTimeout(()=>void poll(d.id,'poll'),POLL_MS);
 }
 async function poll(id:string,mode:'poll'|'recover'|'cancel'){
  const r=await franchisePost('nurture_draft_poll',{brandId,draftId:id,mode});
  if(r.status===200)applyDraft(((r.body.result??{}) as {draft:DraftView}).draft);else setProblem(problemOf(r));
 }
 async function startDraft(){
  setProblem(null);setMessage('');setBusy(true);
  const r=await franchisePost('nurture_draft_start',{brandId,draftId:newDraftId(),purpose,medium});
  setBusy(false);
  if(r.status===200)applyDraft(((r.body.result??{}) as {draft:DraftView}).draft);else setProblem(problemOf(r));
 }
 async function save(){
  setProblem(null);setMessage('');setBusy(true);
  const r=await franchisePost('nurture_template_save',{brandId,...saveInput({templateId:null,base:null,purpose,medium,subject,body,draftId})});
  setBusy(false);
  if(r.status===200){setMessage(`템플릿을 저장했습니다(v${String((r.body.result as Json).version)}).`);setBody('');setSubject('');setDraftId(null);setDraft(null);onDone()}else setProblem(problemOf(r));
 }
 const running=!!draft&&ACTIVE_STATUSES.includes(draft.status);
 // 새로고침·다른 기기에서 시작한 작성 중 초안: 이어서 확인(조회)·복구·중지를 연다. 이 버튼이 없으면 초안이 끝나지 않아 새 초안이 409로 막힌다.
 const pending=!draft&&data.activeDraft?data.drafts.find(d=>d.id===data.activeDraft)??null:null;
 return <div className="franchise-box">
  <h4>새 템플릿</h4>
  <div className="form-two">
   <label className="field"><span>목적</span><NativeSelect aria-label="너처링 목적" value={purpose} onChange={e=>setPurpose(e.target.value)}>{data.purposes.map(p=><NativeSelectOption key={p.key} value={p.key}>{`${p.label} · ${p.classificationLabel}`}</NativeSelectOption>)}</NativeSelect></label>
   <label className="field"><span>매체</span><NativeSelect aria-label="너처링 매체" value={medium} onChange={e=>setMedium(e.target.value)}>{data.media.map(m=><NativeSelectOption key={m.key} value={m.key}>{m.label}</NativeSelectOption>)}</NativeSelect></label>
  </div>
  {cls?.classification==='advertising'&&<p className="subtle-note">{"광고성: 첫 줄 '(광고) {브랜드}', 마지막 줄 '무료 수신거부: {수신거부}'가 있어야 저장됩니다. 알림톡은 쓸 수 없습니다."}</p>}
  <p className="subtle-note">{`자리표시: ${data.placeholders.join(' ')} · 이름·연락처·숫자 코드는 값으로 쓰지 않습니다.`}</p>
  {medium==='email'&&<label className="field"><span>제목</span><Input aria-label="템플릿 제목" maxLength={data.limits.subjectChars} value={subject} onChange={e=>setSubject(e.target.value)}/></label>}
  <label className="field"><span>본문</span><Textarea aria-label="템플릿 본문" rows={8} maxLength={data.limits.bodyChars} value={body} onChange={e=>{setBody(e.target.value);setDraftId(null)}}/></label>
  {pending&&<div className="franchise-bar" role="status"><span>{`작성 중인 AI 초안이 있습니다(${labelOf(data.purposes,pending.purpose)} · ${labelOf(data.media,pending.medium)} · ${kst(pending.createdAt)}).`}</span>
   <Button size="sm" variant="outline" disabled={busy} onClick={()=>void poll(pending.id,'poll')}>이어서 확인</Button>
   {pending.status==='uncertain'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void poll(pending.id,'recover')}>복구</Button>}
   <Button size="sm" variant="outline" disabled={busy} onClick={()=>void poll(pending.id,'cancel')}>중지</Button></div>}
  <div className="franchise-actions">
   <Button size="sm" variant="outline" disabled={busy||running||!data.enabled||!!pending} onClick={()=>void startDraft()}>AI 초안 만들기</Button>
   {draft?.status==='uncertain'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void poll(draft.id,'recover')}>복구</Button>}
   {running&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void poll(draft!.id,'cancel')}>중지</Button>}
   <Button size="sm" disabled={busy||!data.enabled||!body.trim()} onClick={()=>void save()}>템플릿 저장</Button>
  </div>
  <p className="subtle-note">{DRAFT_NOTE}</p>
  {message&&<p role="status">{message}</p>}
  <ProblemBox problem={problem}/>
 </div>;
}

function TemplateList({brandId,data,admin,onDone}:{brandId:string;data:NurtureViewData;admin:boolean;onDone:()=>void}){
 const [problem,setProblem]=useState<Problem|null>(null),[message,setMessage]=useState('');
 async function retire(t:TemplateView){
  if(!window.confirm(RETIRE_CONFIRM))return;
  const r=await franchisePost('nurture_template_retire',{brandId,templateId:t.templateId,version:t.version});
  if(r.status===200){setMessage('템플릿을 폐기했습니다.');onDone()}else setProblem(problemOf(r));
 }
 async function copy(t:TemplateView){setMessage(await copyText((t.subject?t.subject+'\n\n':'')+t.body)?'템플릿을 복사했습니다. 자리표시를 채워 직접 보내세요.':'복사하지 못했습니다. 본문을 직접 선택해 복사하세요.')}
 if(!data.templates.length)return <p className="subtle-note">아직 템플릿이 없습니다.</p>;
 return <div className="franchise-box">
  <h4>템플릿</h4>
  <ul className="franchise-list" aria-label="너처링 템플릿 목록">{data.templates.map(t=><li key={t.templateId}>
   <div className="franchise-bar"><b>{labelOf(data.purposes,t.purpose)}</b><span>{labelOf(data.media,t.medium)}</span><span className="status">{t.classification==='advertising'?'광고성':'요청받은 1회 정보'}</span><span>{`v${t.version}`}</span>{t.status==='retired'&&<span className="franchise-flag">폐기</span>}{t.aiAssisted&&<small>AI 초안에서 시작</small>}</div>
   {t.subject&&<p><b>{t.subject}</b></p>}
   <pre className="whitespace-pre-wrap break-words text-sm" aria-label={`템플릿 ${t.templateId} 본문`}>{t.body}</pre>
   <p className="subtle-note">{`수정 ${kst(t.updatedAt)} · 판 ${t.versions}개`}</p>
   {t.status==='active'&&<div className="franchise-actions"><Button size="sm" variant="outline" onClick={()=>void copy(t)}>복사</Button>{admin&&<Button size="sm" variant="outline" onClick={()=>void retire(t)}>폐기</Button>}</div>}
  </li>)}</ul>
  {message&&<p role="status">{message}</p>}
  <ProblemBox problem={problem}/>
 </div>;
}
