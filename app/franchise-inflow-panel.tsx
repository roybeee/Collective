'use client';
// 가맹 모집 화면 '유입·비용' 탭(트랙 R R5c): 귀속≠증분 문구와 면책을 모든 건수보다 먼저 보이고, 모집 코드 목록·발급·사용 중지(대표·관리자), 채널별 귀속 건수,
// 모집 비용 기록·무효화·고쳐 다시 적기·기간 합계(대표·관리자), 리드 파일 가져오기(대표·관리자, app/franchise-import-panel.tsx)를 둔다.
// 직원은 코드 목록과 귀속 건수만 본다. 비용·가져오기는 읽지도 않는다(서버도 403). 판정·권한은 서버(/api/franchise)가 한다. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
// 비멱등 생성 작업(코드 발급·비용 기록)은 응답이 없거나 5xx일 때만 같은 내용 재시도에 같은 요청 번호를 쓴다(sendAttempt, 명세 UI-Q1).
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {RECRUITMENT_CHANNELS,RECRUITMENT_CHANNEL_LABELS,RECRUITMENT_ATTRIBUTION_NOTE,RECRUITMENT_MESSAGES,UNATTRIBUTED_LABEL,UNATTRIBUTED_REASON_LABELS,PLATFORM_REPORTED_NOTE} from '@/lib/franchise-recruitment';
import {franchiseGet,problemOf,messageOf,ProblemBox,Disclaimer,Section,LabelSelect,kst,won,copyText,sendAttempt,followUpOf,reasonCodes,type Json,type Problem,type PostResult,type Attempt} from './franchise-common';
import {LeadImport,type ImportsView,type ImportEvent} from './franchise-import-panel';
import {FranchiseExperiments} from './franchise-experiment-panel';

// ── 보기 모양(서버 lib/franchise-recruitment-server.ts codes·spend 보기) ──
type Tally={attributed:number;retroactive:number;late:number};
type AssetRefLite={id:string;version:number};
export type CodeItem={code:string;channel:string;channelLabel:string;label:string;validFrom:string;status:'active'|'retired';retiredOn:string|null;campaignId:string|null;campaignTitle:string|null;campaignMissing:boolean;
 assetRef:AssetRefLite|null;assetState:{status:string;reviewNeeded:boolean;current:boolean}|null;eventId:string|null;utmCampaign:string|null;utmQuery:string;createdAt:string;createdBy:{id:string;role:string}|null;version:number;conflict:boolean;
 attributed:{total:number;retroactive:number;late:number}};
export type CodesView={attributionNote:string;codes:CodeItem[];byChannel:Record<string,Tally>;fileBasis:Record<string,number>;fileBasisLabel:string;unattributed:Record<string,number>;leadCount:number;enabled:boolean;role:string;ruleVersion:string;disclaimer:string};
export type SpendItem={id:string;channel:string;period:{from:string;to:string};amount:number;vat:'excluded'|'included';amountExVat:number;funding:string;evidence:string;original:{currency:string;amount:string}|null;
 campaignId:string|null;assetRef:AssetRefLite|null;platform:{impressions:number|null;clicks:number|null;formSubmits:number|null};status:'active'|'voided';voided:{at:string;reason:string}|null;replaces:{spendId:string}|null;version:number;createdAt:string};
export type SpendView={spend:SpendItem[];window:{from:string;to:string;byChannel:Record<string,{total:number;rowCount:number;straddlingCount:number}>;straddling:string[];aligned:Record<string,{from:string;to:string;expanded:boolean}|null>}|null;noProrationNote:string;platformNote:string};
// 발급·비용 양식의 선택지(행사 보기에서 받는다: 모집 캠페인·승인 자료·행사·분기).
export type InflowOptions={campaigns:{id:string;title:string}[];approvedAssets:{id:string;version:number;typeLabel:string;latest:boolean}[];events:ImportEvent[]};
type Initial={codes?:CodesView;spend?:SpendView;options?:InflowOptions;imports?:ImportsView};

// ── 고정 문구 ──
export const MEMBER_ISSUE_NOTE='모집 코드 발급과 중지는 대표·관리자에게 요청하세요. 모집 비용·가져오기 기록은 대표·관리자만 봅니다.';
export const RETIRE_CODE_CONFIRM='이 코드의 귀속을 멈춥니다. 중지일 이후 접수분만 귀속되지 않고, 과거 귀속은 바뀌지 않습니다. 되돌릴 수 없습니다.';
export const REFERRAL_NOTE='점주 추천에는 금전 보상을 기록하지 않습니다(결정 27). 금액은 0으로 적습니다.';
export const AD_FUND_NOTE=RECRUITMENT_MESSAGES.ad_fund_forbidden;
// 비용 출처 선택지는 본부 모집 예산 하나뿐이다. 광고분담금은 선택지로 두지 않는다(결정 27, 명세 UI-F1).
export const FUNDING_LABELS={hq_budget:'본부 모집 예산'} as const;
export const VOID_REASON_LABELS={entry_error:'입력 오류',duplicate:'중복',refunded:'환불'} as const;
const VOIDED_LABELS:Readonly<Record<string,string>>={...VOID_REASON_LABELS,replaced:'교체'};
const VAT_LABELS={excluded:'부가세 제외',included:'부가세 포함'} as const;
const WARNING_TEXT=(code:string)=>(RECRUITMENT_MESSAGES as Readonly<Record<string,string>>)[code]??code;
const channelName=(k:string)=>(RECRUITMENT_CHANNEL_LABELS as Readonly<Record<string,string>>)[k]??k;

// ── 순수 도우미(단위 검사 대상) ──
export type IssueForm={channel:string;label:string;validFrom:string;customCode:string;utmCampaign:string;campaignId:string;asset:string;eventId:string};
export const ISSUE_BLANK:IssueForm={channel:'',label:'',validFrom:'',customCode:'',utmCampaign:'',campaignId:'',asset:'',eventId:''};
// 빈 칸은 보내지 않는다(서버 기본값: 적용 시작일 오늘, 코드는 서버 생성). 자료는 'id:판' 값에서 판 번호를 숫자로 바꾼다.
export function codeIssueInput(f:IssueForm):Json{
 const [assetId,assetVersion]=f.asset.split(':');
 return {channel:f.channel,label:f.label.trim(),...(f.validFrom?{validFrom:f.validFrom}:{}),...(f.customCode.trim()?{customCode:f.customCode.trim()}:{}),...(f.campaignId?{campaignId:f.campaignId}:{}),
  ...(assetId&&assetVersion?{assetRef:{id:assetId,version:Number(assetVersion)}}:{}),...(f.eventId?{eventId:f.eventId}:{}),...(f.utmCampaign.trim()?{utmCampaign:f.utmCampaign.trim()}:{})};
}
export const retireInput=(c:Pick<CodeItem,'code'|'version'>,retiredOn:string):Json=>({code:c.code,version:c.version,...(retiredOn?{retiredOn}:{})});
export type SpendForm={channel:string;mode:'day'|'period';date:string;from:string;to:string;amount:string;vat:''|'excluded'|'included';evidence:string;currency:string;original:string;campaignId:string;asset:string;
 impressions:string;clicks:string;formSubmits:string;replacesSpendId:string};
export const SPEND_BLANK:SpendForm={channel:'',mode:'day',date:'',from:'',to:'',amount:'',vat:'',evidence:'',currency:'',original:'',campaignId:'',asset:'',impressions:'',clicks:'',formSubmits:'',replacesSpendId:''};
const intOf=(v:string)=>{const s=v.replace(/[,\s]/g,'');return /^\d+$/.test(s)?Number(s):null};
// 비용 입력: 금액은 쉼표를 뺀 정수 원, 점주 추천은 0 고정. 부가세 구분·근거는 필수. 출처는 본부 모집 예산으로 고정해 보낸다. 모르는 플랫폼 수치는 보내지 않는다(0으로 바꾸지 않는다).
export function spendInput(f:SpendForm,acknowledgeDuplicate=false):{payload:Json|null;problem:string|null}{
 const bad=(problem:string)=>({payload:null,problem});
 if(!f.channel)return bad('채널을 고르세요.');
 const when=f.mode==='day'?(f.date?{date:f.date}:null):(f.from&&f.to?{period:{from:f.from,to:f.to}}:null);
 if(!when)return bad(f.mode==='day'?'비용 날짜를 고르세요.':'비용 기간의 시작과 끝을 고르세요.');
 const amount=f.channel==='owner_referral'?0:intOf(f.amount);
 if(amount===null||!Number.isSafeInteger(amount))return bad('금액은 원 단위 정수로 적어 주세요(쉼표는 괜찮습니다).');
 if(!f.vat)return bad('부가세 포함·제외를 고르세요.');
 if(!f.evidence.trim())return bad('금액의 근거를 적어 주세요.');
 const currency=f.currency.trim().toUpperCase(),original=f.original.trim();
 if(!!currency!==!!original)return bad('외화 원금은 통화와 금액을 함께 적거나 둘 다 비워 두세요.');
 const metrics:Json={};
 for(const k of ['impressions','clicks','formSubmits'] as const){if(!f[k].trim())continue;const n=intOf(f[k]);if(n===null)return bad('플랫폼 보고 수치는 0 이상의 정수로 적어 주세요.');metrics[k]=n}
 const [assetId,assetVersion]=f.asset.split(':');
 return {payload:{channel:f.channel,...when,amount,vat:f.vat,funding:'hq_budget',evidence:f.evidence.trim(),...(currency?{original:{currency,amount:original}}:{}),...(f.campaignId?{campaignId:f.campaignId}:{}),
  ...(assetId&&assetVersion?{assetRef:{id:assetId,version:Number(assetVersion)}}:{}),...(Object.keys(metrics).length?{platform:metrics}:{}),...(acknowledgeDuplicate?{acknowledgeDuplicate:true}:{}),...(f.replacesSpendId?{replacesSpendId:f.replacesSpendId}:{})},problem:null};
}
// '고쳐 다시 적기': 기존 행 값으로 양식을 채우고 replacesSpendId를 단다. 저장하면 서버가 옛 행을 '교체'로 무효화한다.
export function spendFormOf(s:SpendItem):SpendForm{
 const day=s.period.from===s.period.to,m=(v:number|null)=>v===null?'':String(v);
 return {...SPEND_BLANK,channel:s.channel,mode:day?'day':'period',date:day?s.period.from:'',from:day?'':s.period.from,to:day?'':s.period.to,amount:String(s.amount),vat:s.vat,evidence:s.evidence,
  currency:s.original?.currency??'',original:s.original?.amount??'',campaignId:s.campaignId??'',asset:s.assetRef?`${s.assetRef.id}:${s.assetRef.version}`:'',
  impressions:m(s.platform.impressions),clicks:m(s.platform.clicks),formSubmits:m(s.platform.formSubmits),replacesSpendId:s.id};
}
export const voidInput=(s:Pick<SpendItem,'id'|'version'>,reason:string):Json=>({spendId:s.id,version:s.version,reason});
// 중복·겹침 409가 싣는 기존 행 요약(기간·부가세 제외 금액만).
export type SpendDuplicate={id:string;period:{from:string;to:string};amountExVat:number};
export const duplicatesOf=(r:PostResult):SpendDuplicate[]=>{const d=(r.body as Json).duplicates;return Array.isArray(d)?d as SpendDuplicate[]:[]};
const warningsOf=(r:PostResult):string[]=>{const w=(r.body as Json).warnings;return Array.isArray(w)?w.filter((x):x is string=>typeof x==='string'):[]};
const span=(p:{from:string;to:string})=>p.from===p.to?p.from:`${p.from}~${p.to}`;

// ── 탭 본체 ──
export function FranchiseInflow({brandId,brandName,admin,branch,storageLabels,onStatus,initial,initialSpendForm}:{brandId:string;brandName:string;admin:boolean;branch:string|null;storageLabels:readonly string[];onStatus:()=>void;initial?:Initial;initialSpendForm?:SpendForm}){
 const [codes,setCodes]=useState<CodesView|null>(initial?.codes??null),[spend,setSpend]=useState<SpendView|null>(initial?.spend??null);
 const [options,setOptions]=useState<InflowOptions|null>(initial?.options??null),[imports,setImports]=useState<ImportsView|null>(initial?.imports??null),[error,setError]=useState('');
 const [win,setWin]=useState({from:initial?.spend?.window?.from??'',to:initial?.spend?.window?.to??''});
 // 합계 기간은 '기간 합계 보기'를 눌렀을 때만 바뀐다(입력할 때마다 다시 읽지 않는다). 다른 쓰기 뒤 다시 읽을 때도 마지막으로 본 기간을 쓴다.
 const range=useRef(win);
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const c=await franchiseGet<CodesView>({view:'codes',brandId},signal);if(!signal?.aborted){setCodes(c);setError('')}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
  if(!admin)return;
  // 대표·관리자만: 비용(선택한 기간 합계 포함)·가져오기 기록·양식 선택지. 하나를 읽지 못해도 나머지는 보인다.
  const {from,to}=range.current;
  try{const s=await franchiseGet<SpendView>({view:'spend',brandId,...(from&&to?{from,to}:{})},signal);if(!signal?.aborted)setSpend(s)}catch(e){if(!signal?.aborted)setError(messageOf(e))}
  try{const i=await franchiseGet<ImportsView>({view:'imports',brandId},signal);if(!signal?.aborted)setImports(i)}catch{/* 가져오기 기록 없이도 탭은 쓴다. */}
  try{const o=await franchiseGet<InflowOptions>({view:'events',brandId},signal);if(!signal?.aborted)setOptions(o)}catch{/* 선택지 없이도 코드·비용을 적는다(연결은 비워 둔다). */}
 },[brandId,admin]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 const enabled=!!codes?.enabled;
 return <div className="franchise-panel">
  <p className="notice" role="note">{RECRUITMENT_ATTRIBUTION_NOTE}</p>
  <Disclaimer/>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load()}>다시 불러오기</Button></div>}
  {!codes?!error&&<p role="status">유입·비용 정보를 불러오고 있습니다.</p>:<>
   <InflowSummary codes={codes}/>
   <CodesSection brandId={brandId} codes={codes} admin={admin} enabled={enabled} branch={branch} options={options} onChanged={()=>void load()} onStatus={onStatus}/>
   {admin&&<SpendSection brandId={brandId} spend={spend} enabled={enabled} options={options} win={win} setWin={setWin} initialForm={initialSpendForm} onLoad={next=>{range.current=next;void load()}} onStatus={onStatus}/>}
   {admin&&imports&&<LeadImport brandId={brandId} brandName={brandName} storageLabels={storageLabels} events={options?.events??[]} imports={imports} canImport={enabled&&branch==='A'} onImported={()=>void load()}/>}
   <FranchiseExperiments brandId={brandId} admin={admin}/>
  </>}
 </div>;
}

// 건수: 채널별 코드 귀속(소급·늦은 입력 따로), 제공처 파일 기준(코드 귀속과 다른 열), 사유별 '유입 미확인'.
function InflowSummary({codes}:{codes:CodesView}){
 const channels=RECRUITMENT_CHANNELS.filter(c=>(codes.byChannel[c.key]?.attributed??0)>0),files=RECRUITMENT_CHANNELS.filter(c=>(codes.fileBasis[c.key]??0)>0);
 const reasons=Object.entries(codes.unattributed).filter(([,n])=>n>0);
 return <Section title={`리드 ${codes.leadCount}건의 유입`}>
  <ul className="franchise-list" aria-label="채널별 귀속">
   {channels.map(c=>{const t=codes.byChannel[c.key];return <li key={c.key}>{`${c.label} 귀속 ${t.attributed}`}{(t.retroactive>0||t.late>0)&&<small>{` (소급 등록 코드 ${t.retroactive} · 늦은 입력 ${t.late})`}</small>}</li>})}
   {files.map(c=><li key={'f'+c.key}>{`${codes.fileBasisLabel} · ${c.label} ${codes.fileBasis[c.key]}`}</li>)}
   {reasons.length>0&&<li>{`${UNATTRIBUTED_LABEL}: ${reasons.map(([k,n])=>`${k==='conflict'?'점포 코드와 같은 값':(UNATTRIBUTED_REASON_LABELS as Readonly<Record<string,string>>)[k]??k} ${n}`).join(' · ')}`}</li>}
   {!channels.length&&!files.length&&!reasons.length&&<li className="subtle-note">아직 리드가 없습니다.</li>}
  </ul>
 </Section>;
}

// ── 모집 코드 ──
function CodesSection({brandId,codes,admin,enabled,branch,options,onChanged,onStatus}:{brandId:string;codes:CodesView;admin:boolean;enabled:boolean;branch:string|null;options:InflowOptions|null;onChanged:()=>void;onStatus:()=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[problem,setProblem]=useState<Problem|null>(null),[attempt,setAttempt]=useState<Attempt>(null);
 const [form,setForm]=useState<IssueForm>(ISSUE_BLANK),[retireOn,setRetireOn]=useState<Record<string,string>>({});
 async function run(action:string,payload:Json,last:Attempt=null){
  setBusy(true);setProblem(null);setMessage('');
  try{const {r,next}=await sendAttempt(action,{brandId,...payload},last);if(r.status!==200){setProblem(problemOf(r));const f=followUpOf(r);if(f==='status')onStatus();if(f!=='keep')onChanged()}return {r,next}}
  finally{setBusy(false)}
 }
 async function issue(){
  const {r,next}=await run('code_issue',codeIssueInput(form),attempt);setAttempt(next);
  if(r.status!==200)return;
  const code=(r.body.result as Json|undefined)?.code,w=warningsOf(r);
  setForm(ISSUE_BLANK);setMessage(`${r.body.replayed===true?'이미 처리된 요청입니다. ':''}모집 코드 ${typeof code==='string'?code:''}을(를) 발급했습니다.${w.length?' 주의: '+w.map(WARNING_TEXT).join(' '):''}`);onChanged();
 }
 async function retire(c:CodeItem){
  if(!window.confirm(RETIRE_CODE_CONFIRM))return;
  const {r}=await run('code_retire',retireInput(c,retireOn[c.code]??''));
  if(r.status===200){setMessage(`모집 코드 ${c.code}의 귀속을 멈췄습니다.`);onChanged()}
 }
 async function copy(text:string,what:string){setMessage(await copyText(text)?`${what}을(를) 복사했습니다.`:`복사하지 못했습니다. 직접 선택해 복사하세요: ${text}`)}
 const canIssue=admin&&enabled&&branch==='A',set=(p:Partial<IssueForm>)=>setForm({...form,...p});
 const eventName=(id:string|null)=>{if(!id)return null;const e=options?.events.find(x=>x.id===id);return e?`${e.typeLabel} ${kst(e.startsAt)}`:'연결된 행사'};
 const assetName=(c:CodeItem)=>{if(!c.assetRef)return null;const s=c.assetState,state=!s?'확인 불가':s.status!=='approved'?'승인 아님':s.reviewNeeded?'재검토 필요':s.current?'지금 판':'옛 판';return `자료 v${c.assetRef.version} (${state})`};
 return <Section title="모집 코드" note="코드는 발급 뒤 고치지 않고, 잘못되면 귀속을 멈춥니다(과거 귀속은 그대로). 리드의 코드는 리드 상세에서 넣습니다.">
  {codes.codes.length?<div className="ledger-table-wrap"><table className="ledger-table franchise-table"><caption className="sr-only">모집 코드 목록</caption>
   <thead><tr><th>코드</th><th>채널</th><th>라벨</th><th>연결</th><th>적용 시작일</th><th>상태</th><th>귀속 리드</th>{admin&&<th>처리</th>}</tr></thead>
   <tbody>{codes.codes.map(c=><tr key={c.code}>
    <td><code>{c.code}</code> <Button size="sm" variant="ghost" aria-label={`${c.code} 코드 복사`} onClick={()=>void copy(c.code,'코드')}>복사</Button>
     {c.utmQuery&&<Button size="sm" variant="ghost" aria-label={`${c.code} utm 복사`} onClick={()=>void copy(c.utmQuery,'utm 쿼리')}>utm</Button>}
     {c.conflict&&<small className="franchise-flag"> 점포 코드와 같은 값 · 확인 필요</small>}</td>
    <td>{c.channelLabel}</td><td>{c.label}</td>
    <td>{[c.campaignId?(c.campaignMissing?'삭제된 캠페인':c.campaignTitle??'캠페인'):null,assetName(c),eventName(c.eventId)].filter(Boolean).join(' · ')||'-'}</td>
    <td>{c.validFrom}</td><td>{c.status==='active'&&!c.retiredOn?'사용 중':`중지 ${c.retiredOn??''}`}</td>
    <td>{c.attributed.total}{(c.attributed.retroactive>0||c.attributed.late>0)&&<small>{` (소급 ${c.attributed.retroactive} · 늦은 입력 ${c.attributed.late})`}</small>}</td>
    {admin&&<td>{c.status==='active'&&!c.retiredOn&&<span className="franchise-bar"><Input type="date" aria-label={`${c.code} 중지일 (비우면 오늘)`} value={retireOn[c.code]??''} onChange={e=>setRetireOn({...retireOn,[c.code]:e.target.value})}/>
     <Button size="sm" variant="outline" aria-label={`${c.code} 사용 중지`} disabled={busy} onClick={()=>void retire(c)}>중지</Button></span>}</td>}
   </tr>)}</tbody>
  </table></div>:<p className="subtle-note">발급한 모집 코드가 없습니다.</p>}
  {(message||problem)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<ProblemBox problem={problem}/></div>}
  {!admin?<p className="subtle-note">{MEMBER_ISSUE_NOTE}</p>
   :!enabled?<p className="subtle-note">{RECRUITMENT_MESSAGES.switch_off} 코드 중지는 할 수 있습니다.</p>
   :branch!=='A'?<p className="notice" role="note">{RECRUITMENT_MESSAGES.branch_not_a}</p>
   :canIssue&&<form autoComplete="off" className="franchise-box form-stack" onSubmit={e=>{e.preventDefault();void issue()}}><fieldset disabled={busy} className="form-stack"><legend>새 모집 코드</legend>
    <div className="form-two"><LabelSelect label="모집 채널" labels={RECRUITMENT_CHANNEL_LABELS} value={form.channel} empty="채널 선택" required onChange={channel=>set({channel})}/>
     <label className="field"><span>라벨 (60자)</span><Input autoComplete="off" required maxLength={60} placeholder="예: 가을 박람회 부스 QR" value={form.label} onChange={e=>set({label:e.target.value})}/><small>이름·연락처는 적지 않습니다.</small></label></div>
    <div className="form-two"><label className="field"><span>적용 시작일 (비우면 오늘)</span><Input type="date" value={form.validFrom} onChange={e=>set({validFrom:e.target.value})}/><small>오늘(KST) 90일 전부터 180일 뒤까지</small></label>
     <label className="field"><span>직접 정한 코드 (선택)</span><Input autoComplete="off" maxLength={12} spellCheck={false} placeholder="비우면 자동 생성 (R + 7자)" value={form.customCode} onChange={e=>set({customCode:e.target.value})}/></label></div>
    <div className="form-two"><label className="field"><span>모집 캠페인 (선택)</span><NativeSelect value={form.campaignId} onChange={e=>set({campaignId:e.target.value})}><NativeSelectOption value="">없음</NativeSelectOption>{(options?.campaigns??[]).map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>
     <label className="field"><span>utm_campaign (선택)</span><Input autoComplete="off" maxLength={60} spellCheck={false} placeholder="예: expo_fall" value={form.utmCampaign} onChange={e=>set({utmCampaign:e.target.value})}/></label></div>
    <div className="form-two"><label className="field"><span>모집 자료 (선택, 승인된 지금 판)</span><NativeSelect value={form.asset} onChange={e=>set({asset:e.target.value})}><NativeSelectOption value="">없음</NativeSelectOption>{(options?.approvedAssets??[]).filter(a=>a.latest).map(a=><NativeSelectOption key={`${a.id}:${a.version}`} value={`${a.id}:${a.version}`}>{`${a.typeLabel} v${a.version}`}</NativeSelectOption>)}</NativeSelect></label>
     <label className="field"><span>행사 (선택)</span><NativeSelect value={form.eventId} onChange={e=>set({eventId:e.target.value})}><NativeSelectOption value="">없음</NativeSelectOption>{(options?.events??[]).filter(e=>e.status!=='cancelled').map(e=><NativeSelectOption key={e.id} value={e.id}>{`${e.typeLabel} ${kst(e.startsAt)}`}</NativeSelectOption>)}</NativeSelect></label></div>
    <div className="form-actions"><Button type="submit" disabled={!form.channel||!form.label.trim()}>모집 코드 발급</Button></div>
   </fieldset></form>}
 </Section>;
}

// ── 모집 비용(대표·관리자) ──
function SpendSection({brandId,spend,enabled,options,win,setWin,initialForm,onLoad,onStatus}:{brandId:string;spend:SpendView|null;enabled:boolean;options:InflowOptions|null;win:{from:string;to:string};setWin:(w:{from:string;to:string})=>void;initialForm?:SpendForm;onLoad:(range:{from:string;to:string})=>void;onStatus:()=>void}){
 const [form,setForm]=useState<SpendForm>(initialForm??SPEND_BLANK),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[problem,setProblem]=useState<Problem|null>(null);
 const [dups,setDups]=useState<SpendDuplicate[]>([]),[attempt,setAttempt]=useState<Attempt>(null),[voidReason,setVoidReason]=useState<Record<string,string>>({});
 const set=(p:Partial<SpendForm>)=>{setForm({...form,...p});setDups([])},x=spendInput(form),referral=form.channel==='owner_referral';
 async function send(action:string,payload:Json,last:Attempt=null){
  setBusy(true);setProblem(null);setMessage('');
  try{const {r,next}=await sendAttempt(action,{brandId,...payload},last);if(r.status!==200){setProblem(problemOf(r));if(followUpOf(r)==='status')onStatus()}return {r,next}}
  finally{setBusy(false)}
 }
 async function record(ack=false){
  const p=spendInput(form,ack);if(!p.payload)return;
  const {r,next}=await send('spend_record',p.payload,attempt);setAttempt(next);
  if(r.status===409&&reasonCodes(r).some(c=>c==='spend_possible_duplicate'||c==='spend_period_overlap')){setDups(duplicatesOf(r));return}
  if(r.status!==200)return;
  const w=warningsOf(r);setForm(SPEND_BLANK);setDups([]);setMessage(`${r.body.replayed===true?'이미 처리된 요청입니다. ':''}모집 비용을 기록했습니다.${w.length?' 주의: '+w.map(WARNING_TEXT).join(' '):''}`);onLoad(win);
 }
 async function voidRow(s:SpendItem){const reason=voidReason[s.id];if(!reason)return;const {r}=await send('spend_void',voidInput(s,reason));if(r.status===200){setMessage('모집 비용을 무효화했습니다.');onLoad(win)}else if(followUpOf(r)!=='keep')onLoad(win)}
 const assets=(options?.approvedAssets??[]).filter(a=>a.latest);
 return <Section title="모집 비용" note={`부가세 제외 원화 소진액이 기준입니다. ${spend?.noProrationNote??''}`}>
  <form autoComplete="off" className="franchise-bar" aria-label="비용 기간 합계" onSubmit={e=>{e.preventDefault();onLoad(win)}}>
   <label className="field"><span>합계 시작일</span><Input type="date" value={win.from} onChange={e=>setWin({...win,from:e.target.value})}/></label>
   <label className="field"><span>합계 끝일</span><Input type="date" value={win.to} onChange={e=>setWin({...win,to:e.target.value})}/></label>
   <Button type="submit" variant="outline" disabled={!win.from||!win.to}>기간 합계 보기</Button>
  </form>
  {spend?.window&&<ul className="franchise-list" aria-label="채널별 기간 합계">{Object.entries(spend.window.byChannel).map(([ch,t])=>{const a=spend.window?.aligned[ch];return <li key={ch}>
   {`${channelName(ch)} ${won(t.total)} · ${t.rowCount}건`}{t.straddlingCount>0&&<small className="franchise-flag">{` · 일부만 걸친 비용 ${t.straddlingCount}건 · 비용 기간 불일치${a?` (맞춘 기간 ${span(a)})`:''}`}</small>}</li>})}
   {!Object.keys(spend.window.byChannel).length&&<li className="subtle-note">{`${span(spend.window)} 기간의 비용이 없습니다.`}</li>}</ul>}
  {spend?spend.spend.length?<div className="ledger-table-wrap"><table className="ledger-table franchise-table"><caption className="sr-only">모집 비용 목록</caption>
   <thead><tr><th>채널</th><th>기간</th><th>금액(부가세 제외)</th><th>근거</th><th>{PLATFORM_REPORTED_NOTE}</th><th>상태</th><th>처리</th></tr></thead>
   <tbody>{spend.spend.map(s=><tr key={s.id}>
    <td>{channelName(s.channel)}</td><td>{span(s.period)}</td><td>{won(s.amountExVat)}{s.vat==='included'&&<small>{` (입력 ${won(s.amount)}, ${VAT_LABELS.included})`}</small>}{s.original&&<small>{` · 외화 ${s.original.currency} ${s.original.amount}`}</small>}</td>
    <td>{s.evidence}</td><td>{[['노출',s.platform.impressions],['클릭',s.platform.clicks],['양식',s.platform.formSubmits]].filter(([,v])=>v!==null).map(([k,v])=>`${k} ${v}`).join(' · ')||'-'}</td>
    <td>{s.status==='active'?'유효':`무효화 (${VOIDED_LABELS[s.voided?.reason??'']??'-'})`}{s.replaces&&<small> · 교체 기록</small>}</td>
    <td>{s.status==='active'&&<span className="franchise-bar"><NativeSelect aria-label="무효화 사유" value={voidReason[s.id]??''} onChange={e=>setVoidReason({...voidReason,[s.id]:e.target.value})}><NativeSelectOption value="">사유 선택</NativeSelectOption>{Object.entries(VOID_REASON_LABELS).map(([k,v])=><NativeSelectOption key={k} value={k}>{v}</NativeSelectOption>)}</NativeSelect>
     <Button size="sm" variant="outline" disabled={busy||!voidReason[s.id]} onClick={()=>void voidRow(s)}>무효화</Button>
     {enabled&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setForm(spendFormOf(s));setDups([]);setMessage('')}}>고쳐 다시 적기</Button>}</span>}</td>
   </tr>)}</tbody></table></div>:<p className="subtle-note">기록한 모집 비용이 없습니다.</p>:<p role="status">모집 비용을 불러오고 있습니다.</p>}
  {(message||problem)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<ProblemBox problem={problem}/></div>}
  {!enabled?<p className="subtle-note">{RECRUITMENT_MESSAGES.switch_off} 비용 무효화는 할 수 있습니다.</p>
   :<form autoComplete="off" className="franchise-box form-stack" onSubmit={e=>{e.preventDefault();void record()}}><fieldset disabled={busy} className="form-stack"><legend>모집 비용 기록{form.replacesSpendId?' (교체: 기존 행을 무효화하고 새로 적습니다)':''}</legend>
    <div className="form-two"><LabelSelect label="모집 채널" labels={RECRUITMENT_CHANNEL_LABELS} value={form.channel} empty="채널 선택" required onChange={channel=>set({channel,...(channel==='owner_referral'?{amount:'0'}:{})})}/>
     <label className="field"><span>비용 출처</span><NativeSelect value="hq_budget" disabled onChange={()=>undefined}>{Object.entries(FUNDING_LABELS).map(([k,v])=><NativeSelectOption key={k} value={k}>{v}</NativeSelectOption>)}</NativeSelect><small>{AD_FUND_NOTE}</small></label></div>
    {form.channel==='search_ad'&&<p className="subtle-note">{RECRUITMENT_MESSAGES.search_ad_manual}</p>}
    {referral&&<p className="notice" role="note">{REFERRAL_NOTE}</p>}
    <fieldset className="field"><legend>기간</legend><label className="franchise-inline"><input type="radio" name="spend-mode" checked={form.mode==='day'} onChange={()=>set({mode:'day'})}/> 하루</label><label className="franchise-inline"><input type="radio" name="spend-mode" checked={form.mode==='period'} onChange={()=>set({mode:'period'})}/> 기간</label></fieldset>
    {form.mode==='day'?<label className="field"><span>비용 날짜</span><Input type="date" required value={form.date} onChange={e=>set({date:e.target.value})}/></label>
     :<div className="form-two"><label className="field"><span>시작일</span><Input type="date" required value={form.from} onChange={e=>set({from:e.target.value})}/></label><label className="field"><span>끝일 (366일 이하)</span><Input type="date" required value={form.to} onChange={e=>set({to:e.target.value})}/></label></div>}
    <div className="form-two"><label className="field"><span>금액 (원)</span><Input autoComplete="off" aria-label="금액 (원)" inputMode="numeric" maxLength={20} placeholder="예: 300,000" value={referral?'0':form.amount} disabled={referral} onChange={e=>set({amount:e.target.value})}/>{intOf(form.amount)!==null&&!referral&&<small>{won(intOf(form.amount) as number)}</small>}</label>
     <fieldset className="field"><legend>부가세</legend>{(Object.keys(VAT_LABELS) as ('excluded'|'included')[]).map(k=><label key={k} className="franchise-inline"><input type="radio" name="spend-vat" checked={form.vat===k} onChange={()=>set({vat:k})}/> {VAT_LABELS[k]}</label>)}<small>계산서 공급가액을 알면 부가세 제외로 그 값을 적습니다.</small></fieldset></div>
    <label className="field"><span>금액 근거 (200자)</span><Input autoComplete="off" required maxLength={200} placeholder="예: 관리 화면 9월 소진 내역" value={form.evidence} onChange={e=>set({evidence:e.target.value})}/><small>이름·연락처는 적지 않습니다.</small></label>
    <div className="form-two"><label className="field"><span>외화 통화 (선택)</span><Input autoComplete="off" maxLength={3} placeholder="예: USD" value={form.currency} onChange={e=>set({currency:e.target.value})}/></label><label className="field"><span>외화 원금 (선택)</span><Input autoComplete="off" maxLength={15} placeholder="예: 120.50" value={form.original} onChange={e=>set({original:e.target.value})}/></label></div>
    <div className="form-two"><label className="field"><span>모집 캠페인 (선택)</span><NativeSelect value={form.campaignId} onChange={e=>set({campaignId:e.target.value})}><NativeSelectOption value="">없음</NativeSelectOption>{(options?.campaigns??[]).map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>
     <label className="field"><span>모집 자료 (선택)</span><NativeSelect value={form.asset} onChange={e=>set({asset:e.target.value})}><NativeSelectOption value="">없음</NativeSelectOption>{assets.map(a=><NativeSelectOption key={`${a.id}:${a.version}`} value={`${a.id}:${a.version}`}>{`${a.typeLabel} v${a.version}`}</NativeSelectOption>)}</NativeSelect></label></div>
    <fieldset className="field"><legend>{`플랫폼 보고 수치 (선택 · ${PLATFORM_REPORTED_NOTE})`}</legend><div className="form-two">
     {([['impressions','노출'],['clicks','클릭'],['formSubmits','양식 제출']] as const).map(([k,l])=><label key={k} className="field"><span>{l}</span><Input autoComplete="off" inputMode="numeric" maxLength={15} value={form[k]} onChange={e=>set({[k]:e.target.value})}/></label>)}</div></fieldset>
    {x.problem&&(form.channel||form.amount||form.evidence)&&<p className="form-error">{x.problem}</p>}
    {dups.length>0&&<div role="alert" className="franchise-problem"><p>같은 비용으로 보이는 행이나 겹치는 기간이 있습니다. 같은 비용이 아니면 확인하고 기록하세요.</p>
     <ul>{dups.map(d=><li key={d.id}>{`${span(d.period)} · ${won(d.amountExVat)}`}</li>)}</ul><Button type="button" variant="outline" onClick={()=>void record(true)}>그래도 기록</Button></div>}
    <div className="form-actions">{form.replacesSpendId&&<Button type="button" variant="outline" onClick={()=>set({...SPEND_BLANK})}>교체 취소</Button>}<Button type="submit" disabled={!x.payload}>비용 기록</Button></div>
   </fieldset></form>}
 </Section>;
}
