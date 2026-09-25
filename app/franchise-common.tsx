'use client';
// 가맹 모집 화면(트랙 R) 공용: /api/franchise 읽기·쓰기, 응답 모양, 오류·게이트 사유 표시, 시각·문서 해시 입력.
// 연락처 원문은 콘솔·브라우저 저장소·주소에 두지 않는다. 원문은 연락처 보기 응답을 받은 화면 상태에만 잠시 둔다(app/franchise-lead-detail.tsx).
// 판정은 모두 서버가 한다. 화면은 서버가 돌려준 allowedActions·allowedMoves·역할로 버튼을 숨길 뿐이다.
import type {ReactNode} from 'react';
import {clientId} from '@/lib/client';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {GATE_DISCLAIMER,kstLabel,SOURCE_LABELS,BUDGET_LABELS,TIMING_LABELS,type LeadTask,type LeadBasis,type LeadMarketing,type ContactState,type BasisType,type MarketingStatus,type Branch,type CodeMessage} from '@/lib/franchise';
import type {LeadStage,ForecastDuty} from '@/lib/franchise-gates';

export type Json=Record<string,unknown>;
export type FranchiseStatus={enabled:boolean;role:'owner'|'admin'|'member';hasRecords:boolean;contactKey:'ready'|'missing';disclaimer:string};
export type NoticeOption={id:string;versionLabel:string;sha256:string;createdAt:string};
export type Intake={enabled:boolean;notices:NoticeOption[];profileBranch:Branch|null;storageLabels?:string[];memoHint:string;contactNote:string;disclaimer:string};
export type MaskedContact={name:string;phone:string|null;email:string|null;hasPhone:boolean;hasEmail:boolean};
export type LeadSummary={id:string;systemCode:string;stage:LeadStage;closeReason:string|null;assigneeId:string|null;assignedToMe:boolean;contactState:ContactState;contact:MaskedContact|null;task:LeadTask;basisType:BasisType;
 sourceNoticePending:boolean;marketingStatus:MarketingStatus;eligibility:{met:number;total:number}|null;lastActivityAt:string;retentionUntil:string|null;retentionLabel:string;version:number;createdAt:string};
export type EventView={id:string;type:string;at:string;actor:{id:string;role:string};from?:LeadStage;to?:LeadStage;reasons?:CodeMessage[];fields?:string[];taskFields?:string[];basis?:{type?:string};consent?:{method?:string;at?:string};
 withdrawnAt?:string;evidenceId?:string;evidenceType?:string;supersedes?:string;voided?:boolean;closeReason?:string;assigneeId?:string|null};
export type SideView={startDate:string|null;days:number|null;periodEnd:string|null;shortened:boolean;extended:boolean};
export type WindowView={at:string|null;atKst:string|null;disclosureSide:SideView;draftSide:SideView;blockers:CodeMessage[];notes:CodeMessage[];warnings:CodeMessage[];ruleVersion:string;disclaimer:string};
export type EvidenceView={id:string;evidenceType:string;recordedAt:string;recordedBy:{id:string;role:string};backdateApproval:{role:string;reasonCode:string}|null;supersedes:string|null;correctionReason:string|null;
 docSha256:string|null;storageLabel:string|null;payload:Json|null;voided?:boolean;superseded:boolean;assessment?:{accepted:boolean;counted:boolean;reasons:CodeMessage[]}};
// 개점 판정은 계약·가맹금 예치 단계에서만 온다(그 밖은 null).
export type GateView={window:WindowView;forecastDuty:ForecastDuty;stageChecks:{opened:{ok:boolean;reasons:CodeMessage[];warnings:CodeMessage[]}|null};disclaimer:string};
export type LeadDetail=LeadSummary&{hasMemo:boolean;basis:LeadBasis;marketing:LeadMarketing;marketingRecheck:boolean;firstContactAt:string|null;contractedAt:string|null;closedAt:string|null;closedFrom:LeadStage|null;
 events:EventView[];allowedActions:string[];allowedMoves:LeadStage[];marketingOptions:('given'|'withdrawn')[];disclaimer:string;evidence?:EvidenceView[];gate?:GateView};
export type Assignee={id:string;label:string};
export type Board={enabled:boolean;branch:Branch|null;leads:LeadSummary[];total:number;counts:{byStage:Record<string,number>};
 todos:{sourceNoticePending:number;subjectRequestsDueSoon:number;contactsExpiringSoon:number;marketingRecheck:number;purgePending?:number};recheckLabel:string;assignees:Assignee[];disclaimer:string;contactNote:string};
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
