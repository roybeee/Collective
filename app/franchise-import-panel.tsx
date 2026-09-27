'use client';
// 가맹 모집 '유입·비용' 탭의 리드 파일 가져오기(트랙 R R5c, 대표·관리자): 파일 고르기 → 기기 사전 검사(인코딩·민감 열 이름·개인정보) → 서버 파일 검사 →
// 채널·제공 증빙·수집 근거·열 연결 → 미리보기(만들 수·합쳐진 행 번호·건너뜀·경고·귀속 요약) → 확정 대화(브랜드·건수·제공처) → 가져오기 기록.
// 대표 결정 32(B안): 이름·전화·이메일 머리글 열만 연락처로 연결한다. 화면에는 연락처 원문이 없다. 합쳐진 건수와 행 번호만 보인다('리드 1건, 집계는 파일별').
// 개인정보 거부는 행·열 위치만 보이고 칸 값은 보이지 않는다. 사전 검사에 걸린 파일은 보내지 않는다(개인정보 열이 기기를 떠나지 않게). 판정은 서버가 다시 한다.
// 확정은 비멱등 생성 작업이라 응답이 없거나 5xx일 때만 같은 내용 재시도에 같은 요청 번호를 쓴다(sendAttempt, 명세 UI-Q1). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {RECRUITMENT_CHANNEL_LABELS,RECRUITMENT_ATTRIBUTION_NOTE,FILE_BASIS_LABEL,UNATTRIBUTED_LABEL,UNATTRIBUTED_REASON_LABELS,PROVENANCE_CHANNELS,EVENT_CHANNELS} from '@/lib/franchise-recruitment';
import {LEAD_IMPORT_TARGETS,LEAD_IMPORT_MESSAGES,LEAD_IMPORT_LIMITS,IMPORT_BASIS_BY_CHANNEL,CONTACT_TARGETS,contactColumnKind,localFileCheck,type LeadImportTarget,type LeadDecision} from '@/lib/franchise-lead-import';
import {Section,HashField,StorageField,LabelSelect,kst,sendAttempt,followUpOf,reasonCodes,type Json,type Attempt} from './franchise-common';

// ── 보기 모양(서버 lib/franchise-lead-import-server.ts imports 보기·미리보기 결과) ──
export type ImportRecord={importId:string;channel:string;channelLabel:string;provider:string;providedOn:string;period:{from:string;to:string};transcodedFrom:string|null;eventId:string|null;basis:{type:string;note:string};
 counts:{rows:number;created:number;mergedExisting:number;mergedInFile:number;providerLeadCount:number;skipped:{overlap:number;duplicateInFile:number}};receivedRange:{from:string;to:string}|null;importedAt:string;fileSha256:string};
export type ImportsView={imports:ImportRecord[];coverage:Record<string,{from:string;to:string}[]>};
export type ImportEvent={id:string;type:string;typeLabel:string;startsAt:string;status:string};
export type Inspection={fileSha256:string;headers:string[];rowCount:number;suggestedMapping:Partial<Record<LeadImportTarget,number>>;transcodedFrom:string|null};
export type ImportPlan={planSha256:string;rows:number;toCreate:number;providerLeadCount:number;merged:{existing:{count:number;rows:number[]};inFile:{count:number;rows:number[]}};skipped:{overlap:number;duplicateInFile:number};
 warnings:Record<string,number|boolean>;receivedRange:{from:string;to:string}|null;channel:string;channelLabel:string;provenance:{provider:string};note:string;
 attribution:{code:Record<string,number>;unattributed:Record<string,number>;conflict:number;fileBasis:Record<string,number>}};
export type ImportFile={bytes:Uint8Array;transcodedFrom:string|null};

// ── 고정 문구·선택지 ──
export const EUC_KR_BUTTON='EUC-KR로 읽기';
export const TRANSCODED_NOTE='EUC-KR 파일을 UTF-8로 바꿔 보냈습니다. 기록되는 파일 해시는 변환본의 해시라 디스크 파일의 해시와 다릅니다.';
export const IMPORT_BASIS_LABELS:Readonly<Record<string,string>>={provided:'제3자 제공 수령(출처 고지 필요)',inquiry_response:'위탁 수집(문의 응대)',referral:'제3자 소개(가맹점주)'};
const WARNING_KEYS:Readonly<Record<string,string>>={budgetUnmapped:'budget_unmapped',timingUnmapped:'timing_unmapped',droppedTokens:'dropped_tokens',truncatedTokens:'truncated_tokens',possibleDuplicateInFile:'possible_duplicate_in_file',expiringWithin14d:'expiring_within_14d',periodIncludesExportDay:'period_includes_export_day'};
const MESSAGE=(code:string)=>(LEAD_IMPORT_MESSAGES as Readonly<Record<string,string>>)[code]??code;
const TARGETS=Object.keys(LEAD_IMPORT_TARGETS) as LeadImportTarget[];
const inList=(list:readonly string[],v:string)=>list.includes(v);

// ── 순수 도우미(단위 검사 대상) ──
// 원본 바이트를 base64로(서버는 원본 바이트의 SHA-256을 파일 해시로 쓴다). 큰 배열을 한 번에 펼치지 않게 나눈다.
export function bytesToBase64(bytes:Uint8Array):string{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)}
// UTF-8은 받은 바이트 그대로, 'EUC-KR로 읽기'는 브라우저 해독기로 읽어 UTF-8로 다시 인코딩한다(명세 2.6.2의 4).
export function readForImport(bytes:Uint8Array,encoding:'utf-8'|'euc-kr'):ImportFile{
 if(encoding==='utf-8')return {bytes,transcodedFrom:null};
 return {bytes:new TextEncoder().encode(new TextDecoder('euc-kr').decode(bytes)),transcodedFrom:'euc-kr'};
}
export const needsEucKr=(d:LeadDecision<unknown>)=>!d.ok&&d.reasons.includes('encoding_invalid');
export const inspectInput=(file:ImportFile):Json=>({csvBase64:bytesToBase64(file.bytes),...(file.transcodedFrom?{transcodedFrom:file.transcodedFrom}:{})});
// 열 연결 선택지: 연락처 대상은 그 종류의 연락처 머리글 열만, 나머지 대상은 연락처 머리글이 아닌 열만(금지 대상은 선택지 자체가 없다).
export function mappingChoices(headers:readonly string[],target:LeadImportTarget):number[]{
 const contact=inList(CONTACT_TARGETS,target);
 return headers.flatMap((h,i)=>(contact?contactColumnKind(h)===target:contactColumnKind(h)===null)?[i]:[]);
}
// 서버가 추천한 연결에 연락처 머리글 열을 더한다(같은 종류의 첫 열).
export function initialMapping(inspection:Inspection):Partial<Record<LeadImportTarget,number>>{
 const out:Partial<Record<LeadImportTarget,number>>={...inspection.suggestedMapping};
 for(const t of CONTACT_TARGETS){const i=mappingChoices(inspection.headers,t)[0];if(out[t]===undefined&&i!==undefined)out[t]=i}
 return out;
}
export type ImportForm={channel:string;provider:string;providedOn:string;from:string;to:string;consentSha:string;consentLabel:string;eventId:string;basis:string;dropDuplicates:boolean;mapping:Partial<Record<LeadImportTarget,number>>};
export const IMPORT_BLANK:ImportForm={channel:'',provider:'',providedOn:'',from:'',to:'',consentSha:'',consentLabel:'',eventId:'',basis:'',dropDuplicates:false,mapping:{}};
export const basisChoices=(channel:string)=>channel&&Object.hasOwn(IMPORT_BASIS_BY_CHANNEL,channel)?IMPORT_BASIS_BY_CHANNEL[channel]:['inquiry_response'];
// 미리보기 입력: 파일(원본 base64·변환 표시)·채널·연결·제공 증빙·행사·파일 안 같은 행 건너뛰기·수집 근거. 빈 선택 칸은 보내지 않는다.
export function importInput(file:ImportFile,f:ImportForm):Json{
 const consent=f.consentSha||f.consentLabel?{consentRef:{sha256:f.consentSha,storageLabel:f.consentLabel}}:{};
 return {...inspectInput(file),channel:f.channel,mapping:{...f.mapping},provenance:{provider:f.provider.trim(),providedOn:f.providedOn,period:{from:f.from,to:f.to},...consent},
  ...(f.eventId?{eventId:f.eventId}:{}),...(f.dropDuplicates?{dropInFileDuplicates:true}:{}),basis:{type:f.basis,...(f.basis==='referral'?{referralFrom:'franchisee'}:{})}};
}
export const confirmInput=(input:Json,plan:Pick<ImportPlan,'planSha256'|'toCreate'>):Json=>({...input,confirm:true,expected:{planSha256:plan.planSha256,toCreate:plan.toCreate}});
const formReady=(f:ImportForm)=>!!f.channel&&!!f.provider.trim()&&!!f.providedOn&&!!f.from&&!!f.to&&!!f.basis&&f.mapping.receivedAt!==undefined
 &&(!inList(PROVENANCE_CHANNELS,f.channel)||(/^[0-9a-f]{64}$/.test(f.consentSha)&&!!f.consentLabel));
const rowsText=(rows:readonly number[])=>rows.length?`(${rows.join(', ')}행)`:'';

// 사전 검사(LeadDecision)나 서버 오류 응답의 사유·위치. 위치는 행 번호·열(번호 또는 통과한 머리글 이름)과 고정 문구뿐이다(칸 값 없음).
type ErrorLike={message?:string;error?:string;reasons?:readonly (string|{code:string;message:string})[];errors?:readonly {row?:number;column:string;code?:string}[]};
export function ImportErrors({decision}:{decision:ErrorLike|null}){
 if(!decision)return null;
 const head=decision.message??decision.error??'파일을 가져오지 못했습니다.',errors=decision.errors??[];
 return <div role="alert" className="franchise-problem"><p>{head}</p>
  {errors.length>0&&<ul>{errors.map((e,i)=><li key={i}>{[e.row!==undefined?`${e.row}행`:null,e.column,e.code?MESSAGE(e.code):null].filter(Boolean).join(' · ')}</li>)}</ul>}
 </div>;
}

// ── 본체 ──
type Initial={file?:ImportFile;inspection?:Inspection;form?:ImportForm;plan?:ImportPlan};
export function LeadImport({brandId,brandName,storageLabels,events,imports,canImport=true,onImported,initial}:{brandId:string;brandName:string;storageLabels:readonly string[];events:readonly ImportEvent[];imports:ImportsView;canImport?:boolean;onImported:()=>void;initial?:Initial}){
 const [raw,setRaw]=useState<Uint8Array|null>(null),[file,setFile]=useState<ImportFile|null>(initial?.file??null),[inspection,setInspection]=useState<Inspection|null>(initial?.inspection??null);
 const [form,setForm]=useState<ImportForm>(initial?.form??(initial?.inspection?{...IMPORT_BLANK,mapping:initialMapping(initial.inspection)}:IMPORT_BLANK)),[plan,setPlan]=useState<ImportPlan|null>(initial?.plan??null);
 const [problem,setProblem]=useState<ErrorLike|null>(null),[euc,setEuc]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirming,setConfirming]=useState(false),[attempt,setAttempt]=useState<Attempt>(null);
 const set=(p:Partial<ImportForm>)=>{setForm({...form,...p});setPlan(null)};
 function reset(){setRaw(null);setFile(null);setInspection(null);setForm(IMPORT_BLANK);setPlan(null);setEuc(false);setAttempt(null)}
 async function send(action:string,payload:Json,last:Attempt=null){
  setBusy(true);setProblem(null);setMessage('');
  try{const {r,next}=await sendAttempt(action,{brandId,...payload},last);if(r.status!==200){setProblem(r.body as ErrorLike);if(followUpOf(r)!=='keep')onImported()}return {r,next}}
  finally{setBusy(false)}
 }
 // 기기 사전 검사 → 서버 파일 검사. 사전 검사에 걸리면 보내지 않는다.
 async function check(next:ImportFile){
  setProblem(null);setEuc(false);setInspection(null);setPlan(null);
  const local=await localFileCheck(next.bytes);
  if(!local.ok){setProblem(local);setEuc(needsEucKr(local)&&next.transcodedFrom===null);return}
  const {r}=await send('lead_import_inspect',inspectInput(next));
  if(r.status!==200)return;
  const i=r.body.result as Inspection;setFile(next);setInspection(i);setForm({...IMPORT_BLANK,mapping:initialMapping(i)});
 }
 async function pick(list:FileList|null){
  reset();setProblem(null);const f=list?.[0];if(!f)return;
  if(f.size>LEAD_IMPORT_LIMITS.maxBytes){setProblem({message:MESSAGE('file_too_large')});return}
  const bytes=new Uint8Array(await f.arrayBuffer());setRaw(bytes);await check(readForImport(bytes,'utf-8'));
 }
 async function preview(){if(!file)return;const {r}=await send('lead_import_preview',importInput(file,form));if(r.status===200)setPlan(r.body.result as ImportPlan)}
 async function confirm(){
  if(!file||!plan)return;
  const {r,next}=await send('lead_import_confirm',confirmInput(importInput(file,form),plan),attempt);setAttempt(next);setConfirming(false);
  if(r.status===409&&reasonCodes(r).includes('expected_mismatch')){setPlan(null);return}
  if(r.status!==200)return;
  const res=r.body.result as {created?:number;merged?:ImportPlan['merged']};reset();
  setMessage(`${r.body.replayed===true?'이미 처리된 요청입니다. ':''}리드 ${res.created??0}건을 가져왔습니다.${res.merged?.existing.count?` 기존 리드에 합친 행 ${res.merged.existing.count}건.`:''}`);onImported();
 }
 const channelEvents=events.filter(e=>e.status!=='cancelled'&&e.type===form.channel),providers=[...new Set(imports.imports.map(i=>i.provider))];
 return <>
  {canImport&&<Section title="리드 파일 가져오기" note={`창업 포털·박람회 등 제공처가 준 CSV를 들여옵니다(UTF-8, ${LEAD_IMPORT_LIMITS.maxBytes.toLocaleString('ko-KR')}바이트·${LEAD_IMPORT_LIMITS.maxRows}행까지). 이름·전화·이메일 머리글 열만 연락처로 저장합니다(결정 32). 같은 사람이 이미 있으면 새 리드를 만들지 않고 합칩니다.`}>
   <label className="field"><span>CSV 파일</span><input type="file" accept=".csv,text/csv" aria-label="가져올 CSV 파일" disabled={busy} onChange={e=>void pick(e.target.files)}/><small>파일은 기기에서 먼저 검사합니다. 개인정보 형식이 보이면 보내지 않습니다.</small></label>
   {euc&&raw&&<div className="franchise-bar"><Button variant="outline" disabled={busy} onClick={()=>void check(readForImport(raw,'euc-kr'))}>{EUC_KR_BUTTON}</Button><small>표 계산기의 ‘CSV(쉼표로 분리)’ 파일은 EUC-KR인 경우가 많습니다.</small></div>}
   <ImportErrors decision={problem}/>
   {message&&<p role="status">{message}</p>}
   {file&&inspection&&<form autoComplete="off" className="franchise-box form-stack" onSubmit={e=>{e.preventDefault();if(formReady(form))void preview()}}><fieldset disabled={busy} className="form-stack"><legend>{`파일 ${inspection.rowCount}행 · 열 ${inspection.headers.length}개`}</legend>
    {file.transcodedFrom&&<p className="subtle-note">{TRANSCODED_NOTE}</p>}
    <div className="form-two"><LabelSelect label="모집 채널" labels={RECRUITMENT_CHANNEL_LABELS} value={form.channel} empty="채널 선택" required onChange={channel=>set({channel,eventId:'',basis:basisChoices(channel).length===1?basisChoices(channel)[0]:''})}/>
     <label className="field"><span>제공처 (60자)</span><Input autoComplete="off" required maxLength={60} list="franchise-import-providers" placeholder="예: 가상창업포털" value={form.provider} onChange={e=>set({provider:e.target.value})}/><datalist id="franchise-import-providers">{providers.map(p=><option key={p} value={p}/>)}</datalist><small>회사·서비스 이름만 적습니다.</small></label></div>
    <div className="form-two"><label className="field"><span>제공일</span><Input type="date" required value={form.providedOn} onChange={e=>set({providedOn:e.target.value})}/></label>
     <div className="field"><span>내보내기 기간 (제공처 화면에서 고른 기간)</span><div className="franchise-bar"><Input type="date" aria-label="내보내기 기간 시작" required value={form.from} onChange={e=>set({from:e.target.value})}/><Input type="date" aria-label="내보내기 기간 끝" required value={form.to} onChange={e=>set({to:e.target.value})}/></div><small>같은 제공처의 이전 가져오기 기간과 겹치는 행은 건너뜁니다.</small></div></div>
    {form.channel&&<fieldset className="field"><legend>제공자 측 동의 증빙{inList(PROVENANCE_CHANNELS,form.channel)?' (필수)':' (선택)'}</legend>
     <HashField label="동의 증빙 문서" value={form.consentSha} required={inList(PROVENANCE_CHANNELS,form.channel)} onChange={consentSha=>set({consentSha})}/>
     <StorageField labels={storageLabels} value={form.consentLabel} required={inList(PROVENANCE_CHANNELS,form.channel)} onChange={consentLabel=>set({consentLabel})}/></fieldset>}
    {inList(EVENT_CHANNELS,form.channel)&&<label className="field"><span>행사 (선택)</span><NativeSelect value={form.eventId} onChange={e=>set({eventId:e.target.value})}><NativeSelectOption value="">없음</NativeSelectOption>{channelEvents.map(e=><NativeSelectOption key={e.id} value={e.id}>{`${e.typeLabel} ${kst(e.startsAt)}`}</NativeSelectOption>)}</NativeSelect></label>}
    {form.channel&&<fieldset className="field"><legend>수집 근거 (관리자 선언 · 열린 질문 14 미정)</legend>{basisChoices(form.channel).map(b=><label key={b} className="franchise-inline"><input type="radio" name="franchise-import-basis" checked={form.basis===b} onChange={()=>set({basis:b})}/> {IMPORT_BASIS_LABELS[b]??b}</label>)}</fieldset>}
    <fieldset className="field"><legend>열 연결</legend><div className="form-two">{TARGETS.map(t=><label key={t} className="field"><span>{LEAD_IMPORT_TARGETS[t]}{t==='receivedAt'?' *':''}</span>
     <NativeSelect value={form.mapping[t]===undefined?'':String(form.mapping[t])} onChange={e=>{const mapping={...form.mapping};if(e.target.value==='')delete mapping[t];else mapping[t]=Number(e.target.value);set({mapping})}}>
      <NativeSelectOption value="">연결 안 함</NativeSelectOption>{mappingChoices(inspection.headers,t).map(i=><NativeSelectOption key={i} value={String(i)}>{`${i+1}열 · ${inspection.headers[i]}`}</NativeSelectOption>)}</NativeSelect></label>)}</div>
     <small>연락처는 이름과 전화·이메일 가운데 하나 이상을 함께 연결합니다. 연결하지 않은 연락처 열이 있으면 파일 전체를 가져오지 않습니다.</small></fieldset>
    <label className="franchise-inline"><input type="checkbox" checked={form.dropDuplicates} onChange={e=>set({dropDuplicates:e.target.checked})}/> 파일 안 같은 행(접수 시각·지역·예산·시기·코드가 같음) 건너뛰기</label>
    <div className="form-actions"><Button type="button" variant="outline" onClick={reset}>다른 파일</Button><Button type="submit" disabled={!formReady(form)}>미리보기</Button></div>
   </fieldset></form>}
   {plan&&<PlanView plan={plan} busy={busy} onConfirm={()=>setConfirming(true)}/>}
   {confirming&&plan&&<Dialog open onOpenChange={v=>{if(!v&&!busy)setConfirming(false)}}><DialogContent><DialogHeader><DialogTitle>{`${brandName}에 리드 ${plan.toCreate}건 가져오기`}</DialogTitle><DialogDescription>{`제공처 ${plan.provenance.provider} · ${plan.channelLabel}. 가져온 연락처는 암호화해 저장하고 목록에서는 가립니다.`}</DialogDescription></DialogHeader>
    <p><b>{`새 리드 ${plan.toCreate}건`}</b>{plan.merged.existing.count>0&&` · 기존 리드에 합칠 행 ${plan.merged.existing.count}건`}</p>
    <div className="form-actions"><Button variant="outline" disabled={busy} onClick={()=>setConfirming(false)}>취소</Button><Button disabled={busy} onClick={()=>void confirm()}>{busy?'가져오는 중…':'가져오기 확정'}</Button></div>
   </DialogContent></Dialog>}
  </Section>}
  <Section title="가져오기 기록">
   {imports.imports.length?<ul className="franchise-list" aria-label="리드 가져오기 기록">{imports.imports.map(i=><li key={i.importId}>
    <b>{`${i.channelLabel} · ${i.provider}`}</b> <small>{`제공일 ${i.providedOn} · 내보내기 기간 ${i.period.from}~${i.period.to} · 가져온 시각 ${kst(i.importedAt)}`}</small>
    <p className="subtle-note">{`새 리드 ${i.counts.created} · 기존 리드에 합침 ${i.counts.mergedExisting} · 파일 안 합침 ${i.counts.mergedInFile} · 제공처별 리드 ${i.counts.providerLeadCount} · 건너뜀 ${i.counts.skipped.overlap+i.counts.skipped.duplicateInFile}`}</p>
    <small>{`${IMPORT_BASIS_LABELS[i.basis.type]??i.basis.type} · ${i.basis.note}${i.transcodedFrom?' · EUC-KR 변환본(디스크 파일 해시와 다름)':''} · 파일 해시 ${i.fileSha256.slice(0,12)}…`}</small>
   </li>)}</ul>:<p className="subtle-note">가져온 파일이 없습니다.</p>}
  </Section>
 </>;
}

// 미리보기: 귀속≠증분 문구를 귀속 건수보다 먼저 보인다. 병합은 건수와 행 번호만이다.
function PlanView({plan,busy,onConfirm}:{plan:ImportPlan;busy:boolean;onConfirm:()=>void}){
 const code=Object.entries(plan.attribution.code).filter(([,n])=>n>0),file=Object.entries(plan.attribution.fileBasis).filter(([,n])=>n>0),un=Object.entries(plan.attribution.unattributed).filter(([,n])=>n>0);
 const warnings=Object.entries(plan.warnings).filter(([,v])=>v===true||(typeof v==='number'&&v>0));
 const name=(k:string)=>(RECRUITMENT_CHANNEL_LABELS as Readonly<Record<string,string>>)[k]??k;
 return <section className="franchise-box" aria-label="가져오기 미리보기">
  <p className="notice" role="note">{plan.note||RECRUITMENT_ATTRIBUTION_NOTE}</p>
  <p><b>{`만들 리드 ${plan.toCreate}건`}</b>{` · 제공처별 리드 ${plan.providerLeadCount}명 · 파일 ${plan.rows}행`}</p>
  {plan.merged.existing.count>0&&<p>{`기존 리드에 합쳐진 행 ${plan.merged.existing.count}건${rowsText(plan.merged.existing.rows)}`}</p>}
  {plan.merged.inFile.count>0&&<p>{`파일 안에서 합쳐진 행 ${plan.merged.inFile.count}건${rowsText(plan.merged.inFile.rows)}`}</p>}
  {(plan.skipped.overlap>0||plan.skipped.duplicateInFile>0)&&<p className="subtle-note">{`건너뜀: 이전 가져오기 기간과 겹침 ${plan.skipped.overlap} · 파일 안 같은 행 ${plan.skipped.duplicateInFile}`}</p>}
  {plan.receivedRange&&<p className="subtle-note">{`접수 시각 ${kst(plan.receivedRange.from)} ~ ${kst(plan.receivedRange.to)} (제공처 시각)`}</p>}
  {warnings.length>0&&<ul className="franchise-warnings">{warnings.map(([k,v])=><li key={k}>{`주의: ${MESSAGE(WARNING_KEYS[k]??k)}${typeof v==='number'?` (${v}건)`:''}`}</li>)}</ul>}
  <ul className="franchise-list" aria-label="새 리드의 귀속 요약">
   {code.map(([k,n])=><li key={'c'+k}>{`코드 귀속 · ${name(k)} ${n}`}</li>)}
   {file.map(([k,n])=><li key={'f'+k}>{`${FILE_BASIS_LABEL} · ${name(k)} ${n}`}</li>)}
   {un.length>0&&<li>{`코드로 귀속되지 않은 사유(${UNATTRIBUTED_LABEL}): ${un.map(([k,n])=>`${(UNATTRIBUTED_REASON_LABELS as Readonly<Record<string,string>>)[k]??k} ${n}`).join(' · ')}`}</li>}
   {plan.attribution.conflict>0&&<li>{`점포 코드와 같은 값 ${plan.attribution.conflict}`}</li>}
  </ul>
  <div className="form-actions"><Button disabled={busy||plan.toCreate+plan.merged.existing.count<1} onClick={onConfirm}>가져오기 확정</Button></div>
 </section>;
}
