'use client';
// 가맹 모집 화면(트랙 R) 공용: /api/franchise 읽기·쓰기, 응답 모양, 오류·게이트 사유 표시, 시각·문서 해시 입력.
// 연락처 원문은 콘솔·브라우저 저장소·주소에 두지 않는다. 원문은 연락처 보기 응답을 받은 화면 상태에만 잠시 둔다(app/franchise-lead-detail.tsx).
// 판정은 모두 서버가 한다. 화면은 서버가 돌려준 allowedActions·allowedMoves·역할로 버튼을 숨길 뿐이다.
import {useState,type ReactNode} from 'react';
import {clientId} from '@/lib/client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {GATE_DISCLAIMER,FRANCHISE_ERRORS,kstLabel,SOURCE_LABELS,BUDGET_LABELS,TIMING_LABELS,type LeadTask,type LeadBasis,type LeadMarketing,type ContactState,type BasisType,type MarketingStatus,type Branch,type CodeMessage,type FranchiseErrorKey,type QualificationVerdict,type QualificationReason} from '@/lib/franchise';
import type {LeadStage,ForecastDuty} from '@/lib/franchise-gates';

export type Json=Record<string,unknown>;
export type FranchiseStatus={enabled:boolean;role:'owner'|'admin'|'member';hasRecords:boolean;contactKey:'ready'|'missing';disclaimer:string};
export type NoticeOption={id:string;versionLabel:string;sha256:string;createdAt:string};
export type Intake={enabled:boolean;notices:NoticeOption[];profileBranch:Branch|null;storageLabels?:string[];memoHint:string;contactNote:string;disclaimer:string};
export type MaskedContact={name:string;phone:string|null;email:string|null;hasPhone:boolean;hasEmail:boolean};
// 모집 코드 귀속(R5b-1, 서버가 읽을 때 계산). 라벨·사유는 서버 문구를 그대로 보인다.
export type AttributionView={state:'attributed'|'unattributed'|'conflict';basis?:'code'|'import';label:string;detail:string|null;code?:string;channel?:string;channelLabel?:string;reason?:string;retroactive?:boolean;late?:boolean};
export type LeadSummary={id:string;systemCode:string;stage:LeadStage;closeReason:string|null;assigneeId:string|null;assignedToMe:boolean;contactState:ContactState;contact:MaskedContact|null;task:LeadTask;basisType:BasisType;
 sourceNoticePending:boolean;marketingStatus:MarketingStatus;eligibility:{met:number;total:number}|null;qualification?:QualificationView|null;lastActivityAt:string;retentionUntil:string|null;retentionLabel:string;version:number;createdAt:string;attribution?:AttributionView};
// 현재 적격 판정(대표 결정 35). current는 지금 적격 기준 버전으로 한 판정인지다.
export type QualificationView={verdict:QualificationVerdict;reason:QualificationReason;criteriaVersion:number;at:string;current:boolean};
export type QualificationRow={verdict:QualificationVerdict;reason:QualificationReason;criteriaVersion:number;score:{met:number;total:number}|null;at:string;by:{id:string;role:string}};
export type LeadCodeView={code:string;at:string;source:'manual'|'import'};
export type LeadImportView={importId:string;channel:string;channelLabel:string;eventId:string|null;provider:string;providedOn:string;receivedAt:string;receivedPrecision:'time'|'day';merged:boolean;at:string};
export type EventView={id:string;type:string;at:string;actor:{id:string;role:string};from?:LeadStage;to?:LeadStage;reasons?:CodeMessage[];fields?:string[];taskFields?:string[];basis?:{type?:string};consent?:{method?:string;at?:string};
 withdrawnAt?:string;evidenceId?:string;evidenceType?:string;supersedes?:string;voided?:boolean;closeReason?:string;assigneeId?:string|null;qualification?:{verdict:string;reason:string;criteriaVersion:number}};
export type SideView={startDate:string|null;days:number|null;periodEnd:string|null;shortened:boolean;extended:boolean};
export type WindowView={at:string|null;atKst:string|null;disclosureSide:SideView;draftSide:SideView;blockers:CodeMessage[];notes:CodeMessage[];warnings:CodeMessage[];ruleVersion:string;disclaimer:string};
export type EvidenceView={id:string;evidenceType:string;recordedAt:string;recordedBy:{id:string;role:string};backdateApproval:{role:string;reasonCode:string}|null;supersedes:string|null;correctionReason:string|null;
 docSha256:string|null;storageLabel:string|null;payload:Json|null;voided?:boolean;superseded:boolean;assessment?:{accepted:boolean;counted:boolean;reasons:CodeMessage[]}};
// 개점 판정은 계약·가맹금 예치 단계에서만 온다(그 밖은 null).
export type GateView={window:WindowView;forecastDuty:ForecastDuty;stageChecks:{opened:{ok:boolean;reasons:CodeMessage[];warnings:CodeMessage[]}|null};disclaimer:string};
export type LeadDetail=LeadSummary&{hasMemo:boolean;basis:LeadBasis;marketing:LeadMarketing;marketingRecheck:boolean;firstContactAt:string|null;contractedAt:string|null;closedAt:string|null;closedFrom:LeadStage|null;
 events:EventView[];allowedActions:string[];allowedMoves:LeadStage[];marketingOptions:('given'|'withdrawn')[];disclaimer:string;evidence?:EvidenceView[];gate?:GateView;
 codes?:LeadCodeView[];codeStrikes?:{code:string;at:string;reason:string}[];imports?:LeadImportView[];criteriaVersion?:number|null;qualifications?:QualificationRow[];
 infoRequests?:{id:string;purpose:string;at:string;by:{id:string;role:string};used:boolean}[];messageLogs?:{id:string;templateId:string;templateVersion:number;classification:string;medium:string;requestId:string|null;at:string;by:{id:string;role:string}}[]};
export type Assignee={id:string;label:string};
export type Board={enabled:boolean;branch:Branch|null;leads:LeadSummary[];total:number;counts:{byStage:Record<string,number>};
 todos:{sourceNoticePending:number;subjectRequestsDueSoon:number;contactsExpiringSoon:number;marketingRecheck:number;purgePending?:number;codeConflict?:number};recheckLabel:string;assignees:Assignee[];disclaimer:string;contactNote:string};
// 게이트 409·거절된 제공 400·중복 409가 싣는 필드. 값(연락처)은 싣지 않는다.
export type Problem={error:string;reasons?:CodeMessage[];warnings?:CodeMessage[];window?:WindowView;earliestContractAt?:string|null;disclaimer?:string;duplicateOf?:{systemCode:string|null}};
export type PostBody=Json&Partial<Problem>&{ok?:boolean;result?:Json;replayed?:boolean;lead?:LeadDetail};
export type PostResult={status:number;body:PostBody};

export class FranchiseLoadError extends Error{constructor(readonly status:number,message:string){super(message)}}
export const messageOf=(e:unknown)=>e instanceof Error&&e.message?e.message:'요청을 처리하지 못했습니다.';

// 읽기(GET). 실패하면 서버의 한국어 문구로 FranchiseLoadError를 던진다.
export async function franchiseGet<T>(params:Record<string,string>,signal?:AbortSignal):Promise<T>{
 const response=await fetch('/api/franchise?'+new URLSearchParams(params).toString(),{signal,cache:'no-store'});
 const data=await response.json().catch(()=>({})) as T&{error?:string};
 if(!response.ok)throw new FranchiseLoadError(response.status,data.error||'가맹 모집 정보를 불러오지 못했습니다.');
 return data;
}
// 쓰기(POST). lib/client.ts api()는 error만 남겨 사유·경고·계약 가능 시각·중복 코드를 버리므로 쓰지 않는다.
// 요청 번호는 사용자 동작마다 새로 만든다. 네트워크 오류로 응답을 못 받았을 때만 같은 번호로 한 번 다시 보낸다(서버 영수증이 중복 기록을 막는다).
export async function franchisePost(action:string,payload:Json,requestId:string=clientId()):Promise<PostResult>{
 const init:RequestInit={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,action,requestId})};
 let response:Response;
 try{response=await fetch('/api/franchise',init)}
 catch{
  try{response=await fetch('/api/franchise',init)}
  catch{return {status:0,body:{error:'네트워크 오류로 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'}}}
 }
 const body=await response.json().catch(()=>({error:'응답을 읽지 못했습니다. 새로고침한 뒤 확인해 주세요.'})) as PostBody;
 return {status:response.status,body};
}
export function problemOf(r:PostResult):Problem{
 const b=r.body;
 return {error:typeof b.error==='string'&&b.error?b.error:'요청을 처리하지 못했습니다.',...(b.reasons?{reasons:b.reasons}:{}),...(b.warnings?{warnings:b.warnings}:{}),...(b.window?{window:b.window}:{}),
  ...('earliestContractAt' in b?{earliestContractAt:b.earliestContractAt??null}:{}),...(b.disclaimer?{disclaimer:b.disclaimer}:{}),...(b.duplicateOf?{duplicateOf:b.duplicateOf}:{})};
}

// 오류와 게이트 사유. 막힌 이동은 사유(한국어)·경고·계약 가능 시각·면책 문구를 함께 보인다.
export function ProblemBox({problem}:{problem:Problem|null}){
 if(!problem)return null;
 const p=problem,gate=!!(p.reasons?.length||p.window||'earliestContractAt' in p);
 return <div role="alert" className="franchise-problem">
  <p>{p.duplicateOf?`이미 등록된 연락처입니다. 기존 리드 코드: ${p.duplicateOf.systemCode??'확인 불가'}`:p.error}</p>
  {!!p.reasons?.length&&<ul>{p.reasons.map(r=><li key={r.code}>{r.message}</li>)}</ul>}
  {!!p.warnings?.length&&<ul className="franchise-warnings">{p.warnings.map(w=><li key={w.code}>주의: {w.message}</li>)}</ul>}
  {'earliestContractAt' in p&&<p>계약 가능 시각: {kstLabel(p.earliestContractAt??null)??'아직 계산할 수 없습니다'}</p>}
  {(gate||p.disclaimer)&&<small>{p.disclaimer||GATE_DISCLAIMER}</small>}
 </div>;
}
export const Disclaimer=()=><small className="franchise-disclaimer">{GATE_DISCLAIMER}</small>;
// 원 단위 금액(모집 비용, R5c): 천 단위 쉼표와 '원'. 부가세 제외 금액을 보일 때 쓴다.
export const won=(n:number)=>`${new Intl.NumberFormat('ko-KR').format(n)}원`;
export const kst=(at:string|null|undefined)=>at?kstLabel(at)??'-':'-';

// 시각 입력. '지금(서버 시각)'이면 'now'를 보내 서버 기록 시각을 쓴다. 아니면 한국시간으로 적은 시각을 +09:00 시각으로 보낸다.
export type TimeValue={now:boolean;local:string};
export const NOW:TimeValue={now:true,local:''};
export const timeOf=(t:TimeValue)=>t.now?'now':t.local.length===16?t.local+':00+09:00':t.local.length===19?t.local+'+09:00':'';
// 날짜만 받는 칸(보험 기간 등)은 그날 한국시간 0시로 보낸다.
export const kstDate=(v:string)=>v?v+'T00:00:00+09:00':'';
export function TimeField({label,value,onChange,allowNow=true}:{label:string;value:TimeValue;onChange:(v:TimeValue)=>void;allowNow?:boolean}){
 return <div className="field"><span>{label}</span>
  {allowNow&&<label className="franchise-inline"><input type="checkbox" checked={value.now} onChange={e=>onChange({...value,now:e.target.checked})}/> 지금(서버 시각)</label>}
  {(!allowNow||!value.now)&&<Input type="datetime-local" required aria-label={label+' · 한국시간'} value={value.local} onChange={e=>onChange({...value,local:e.target.value})}/>}
  {(!allowNow||!value.now)&&<small>한국시간(KST) 기준</small>}
 </div>;
}
// 문서 해시: 파일을 고르면 브라우저에서 SHA-256만 계산한다. 파일은 올리지 않는다.
export async function sha256OfFile(file:File){const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
export function HashField({label,value,onChange,required=false}:{label:string;value:string;onChange:(v:string)=>void;required?:boolean}){
 return <div className="field"><span>{label}{required?'':' (선택)'}</span>
  <input type="file" aria-label={label+' 파일 선택'} onChange={e=>{const file=e.target.files?.[0];if(!file){onChange('');return}void sha256OfFile(file).then(onChange,()=>onChange(''))}}/>
  <Input aria-label={label+' SHA-256'} value={value} required={required} pattern="[0-9a-f]{64}" placeholder="파일을 고르면 SHA-256 64자가 채워집니다" onChange={e=>onChange(e.target.value.trim().toLowerCase())}/>
  <small>파일은 올리지 않고 해시만 저장합니다.</small>
 </div>;
}
// 보관 위치: 설정에서 등록한 라벨이 있으면 그중에서 고르고, 없으면 40자 이내로 적는다.
export function StorageField({labels,value,onChange,required=false}:{labels:readonly string[];value:string;onChange:(v:string)=>void;required?:boolean}){
 return <label className="field"><span>보관 위치{required?'':' (선택)'}</span>
  {labels.length?<NativeSelect value={value} required={required} onChange={e=>onChange(e.target.value)}><NativeSelectOption value="">{required?'보관 위치 선택':'없음'}</NativeSelectOption>{labels.map(l=><NativeSelectOption key={l} value={l}>{l}</NativeSelectOption>)}</NativeSelect>
   :<Input value={value} required={required} maxLength={40} placeholder="예: 본사 문서함" onChange={e=>onChange(e.target.value)}/>}
 </label>;
}
// 라벨 표에서 고르는 선택 상자. 값 타입은 라벨 표의 키에서만 정한다(onChange는 추론에 쓰지 않는다).
export function LabelSelect<K extends string>({label,labels,value,onChange,empty,required=false}:{label:string;labels:Readonly<Record<K,string>>;value:string;onChange:(v:NoInfer<K>)=>void;empty?:string;required?:boolean}){
 return <label className="field"><span>{label}</span><NativeSelect value={value} required={required} onChange={e=>onChange(e.target.value as K)}>{empty!==undefined&&<NativeSelectOption value="">{empty}</NativeSelectOption>}{(Object.keys(labels) as K[]).map(k=><NativeSelectOption key={k} value={k}>{labels[k]}</NativeSelectOption>)}</NativeSelect></label>;
}
// 문의 조건(지역·유입·예산·시기·캠페인). 리드 등록과 문의 조건 수정이 같이 쓴다. 지역은 시·군·구 이름만(숫자·번지 없음).
export function TaskFields({task,onChange,campaigns}:{task:LeadTask;onChange:(t:LeadTask)=>void;campaigns:readonly {id:string;title:string}[]}){
 return <>
  <div className="form-two">
   <label className="field"><span>지역 (선택)</span><Input value={task.region} maxLength={40} placeholder="예: 가상시 가상구" onChange={e=>onChange({...task,region:e.target.value})}/><small>시·군·구 이름만 적습니다. 번지·숫자는 받지 않습니다.</small></label>
   <LabelSelect label="유입" labels={SOURCE_LABELS} value={task.sourceChannel} onChange={v=>onChange({...task,sourceChannel:v})}/>
  </div>
  <div className="form-two">
   <LabelSelect label="예산" labels={BUDGET_LABELS} value={task.budgetBand} onChange={v=>onChange({...task,budgetBand:v})}/>
   <LabelSelect label="창업 시기" labels={TIMING_LABELS} value={task.timingBand} onChange={v=>onChange({...task,timingBand:v})}/>
  </div>
  {campaigns.length>0&&<label className="field"><span>캠페인 (선택 · 유입 귀속용)</span><NativeSelect value={task.campaignId??''} onChange={e=>onChange({...task,campaignId:e.target.value||null})}><NativeSelectOption value="">없음</NativeSelectOption>{campaigns.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>}
 </>;
}
export const labelOf=(labels:object,key:string|null|undefined)=>key?(labels as Readonly<Record<string,string>>)[key]??key:'-';
export const roleLabel=(role:string)=>labelOf({owner:'대표',admin:'관리자',member:'직원',system:'시스템'},role);
// 이력·증빙의 행위자: 담당자 목록(대표·관리자는 워크스페이스 계정, 직원은 자신만 '나')에서 찾고, 없으면 역할로 보인다.
export const actorLabel=(actor:{id:string;role:string},assignees:readonly Assignee[])=>actor.role==='system'?roleLabel('system'):assignees.find(a=>a.id===actor.id)?.label??roleLabel(actor.role);
export function Section({title,children,note}:{title:string;children:ReactNode;note?:ReactNode}){return <section className="franchise-box"><h3>{title}</h3>{note&&<p className="subtle-note">{note}</p>}{children}</section>}
// CSV 파일 저장: 서버가 만든 문자열(BOM 포함)을 그대로 파일로 내려받는다. 화면 상태에 남기지 않는다.
export function saveCsv(name:string,csv:string){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

// ── R15a-2b 모집 자료·행사 탭 공용 ──
// 텍스트 파일 저장: 서버가 준 원문 문자열을 그대로 쓴다. BOM을 넣지 않고 줄바꿈을 바꾸지 않는다. 화면 상태에 남기지 않는다.
export function saveText(name:string,body:string){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([body],{type:'text/plain;charset=utf-8'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
// 클립보드 복사. 성공하면 true, API가 없거나 권한·보안 문맥 때문에 실패하면 false다. 던지지 않는다.
export async function copyText(body:string):Promise<boolean>{try{if(typeof navigator==='undefined'||typeof navigator.clipboard?.writeText!=='function')return false;await navigator.clipboard.writeText(body);return true}catch{return false}}
// 200 응답의 경고. 모집 자료·행사 작업은 string[]를 준다(권장 문장 안내 포함, 막지 않는다). 리드 작업의 CodeMessage[]는 여기서 읽지 않는다. 문자열이 아닌 항목은 버린다.
export const stringWarnings=(r:PostResult):string[]=>{const w=(r.body as Json).warnings;return Array.isArray(w)?w.filter((x):x is string=>typeof x==='string'):[]};
export function WarningLines({items}:{items:readonly string[]}){return items.length?<ul className="franchise-warnings">{items.map((w,i)=><li key={i}>주의: {w}</li>)}</ul>:null}
// 요청 번호: 응답을 못 받은(status 0) 같은 내용의 재시도만 같은 번호를 쓴다(서버 영수증이 한 번만 반영). 내용이 바뀌었거나 응답을 받았으면 새 번호.
export type Attempt={id:string;key:string}|null;
export const attemptId=(last:Attempt,key:string)=>last&&last.key===key?last.id:clientId();
// 쓰기 한 번: key=[작업, 보낼 값] → 요청 번호 → 보내기. 응답이 없을 때(status 0)만 다음 시도에 같은 번호를 넘긴다('새 자료 저장'·'신청 기록' 같은 비멱등 작업이 두 번 반영되지 않게).
// R5c(명세 5절·UI-Q1): 비멱등 생성 세 작업(코드 발급·비용 기록·리드 가져오기 확정)은 5xx 뒤에도 같은 내용이면 같은 번호를 쓴다. 커밋 뒤 5xx가 나도 서버 영수증(입력 해시 대조)이 한 번만 반영한다.
export const RETRY_5XX_ACTIONS:readonly string[]=['code_issue','spend_record','lead_import_confirm'];
export async function sendAttempt(action:string,payload:Json,last:Attempt):Promise<{r:PostResult;next:Attempt}>{
 const key=JSON.stringify([action,payload]),id=attemptId(last,key),r=await franchisePost(action,payload,id);
 const keep=r.status===0||(r.status>=500&&RETRY_5XX_ACTIONS.includes(action));
 return {r,next:keep?{id,key}:null};
}
// 실패 뒤 화면이 할 일: keep(입력 유지)·reload(보기·목록 다시 읽기)·close(닫고 목록 다시 읽기)·status(패널 상태·배너 다시 읽기).
export type FollowUp='keep'|'reload'|'close'|'status';
export const reasonCodes=(r:PostResult):string[]=>Array.isArray(r.body.reasons)?r.body.reasons.map(x=>x.code):[];
export const errorIs=(r:PostResult,key:FranchiseErrorKey)=>r.body.error===FRANCHISE_ERRORS[key].text;
export function followUpOf(r:PostResult):FollowUp{
 if(r.status===403)return 'status';
 if(r.status===404)return 'close';
 if(r.status===409)return errorIs(r,'OFF')||reasonCodes(r).includes('switch_off')?'status':'reload';
 return 'keep';
}

// ── 증빙 묶음 내려받기(트랙 R R6b evidence_export, 대표·관리자, 감사) ──
// 리드 상세(리드별 여정)와 모집 자료 상세(자료별 묶음)가 쓴다. 묶음은 JSON이고 연락처·메모 값은 없다. 감사 기록에는 묶음 해시만 남는다.
export const EVIDENCE_EXPORT_NOTE='실증 요청·신고에 낼 증빙 묶음(JSON)을 내려받습니다. 연락처·메모 값은 없고, 내려받기는 감사 기록에 남습니다.';
export const evidenceInput=(scope:'lead'|'asset',target:string):Json=>({scope,...(scope==='lead'?{leadId:target}:{assetId:target})});
export function EvidenceExport({brandId,scope,target}:{brandId:string;scope:'lead'|'asset';target:string}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[problem,setProblem]=useState<Problem|null>(null);
 async function run(){
  setBusy(true);setMessage('');setProblem(null);
  try{
   const r=await franchisePost('evidence_export',{brandId,...evidenceInput(scope,target)});
   if(r.status!==200){setProblem(problemOf(r));return}
   const b=r.body as Json;saveText(String(b.fileName),String(b.body));setMessage(`증빙 묶음을 내려받았습니다(SHA-256 ${String(b.sha256).slice(0,12)}…).`);
  }finally{setBusy(false)}
 }
 return <Section title="증빙 묶음" note={EVIDENCE_EXPORT_NOTE}>
  <div><Button variant="outline" size="sm" disabled={busy} onClick={()=>void run()}>증빙 묶음 내려받기</Button></div>
  {(message||problem)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<ProblemBox problem={problem}/></div>}
 </Section>;
}
