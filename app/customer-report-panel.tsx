'use client';
import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {REPORT_METRICS,isoWeekOfDate,reportWeek,type CustomerReport,type MetricUnit} from '@/lib/customer-report';
import {addDays} from '@/lib/store-attribution';
import type {Store} from '@/lib/store-marketing';
import {canChange,useAccount,type Account} from './account-context';

// 주간 고객 보고서 화면(A8-3, docs/CUSTOMER-REPORT.ko.md 5·11절). 점포 마케팅 지점 탭 '고객 보고서'와 브랜드 사실 탭의 '사실 팩 받기'.
// 대표·관리자만 탭을 본다(직원은 숨김, 서버도 403). '검토 완료'는 대표만. 스위치 a8_customer_report가 꺼져 있으면 동결본 목록·다운로드만 보인다.
// 숫자는 서버(lib/customer-report-server.ts)가 계산하고, 화면은 받은 값을 그대로 보인다. 동결 요청은 대화상자에 보인 확인 값(confirm)을 그대로 보낸다.
const API='/api/customer-reports';
export const REPORT_SELECT_WEEKS=12,REPORT_LIST_WEEKS=26;
const FORMATS=['md','csv','json'] as const;
type Format=typeof FORMATS[number];
type PosStatus='pass'|'fail'|'missing_pos';
export type FreezeConfirm={orders:number|null;netRevenue:number|null;posStatus:PosStatus|null};
type Review={status:'reviewed';reportVersion:number;by:{id:string;role:'owner'};at:string};
export type FrozenEntry={id:string;scope:{type:'store'|'brand';id:string;brandId:string};week:string;version:number;frozenAt:string;frozenBy:{id:string;role:string};review:Review|null;stale:boolean;versions:{version:number;frozenAt:string;review:Review|null}[]};
export type PreviewResponse={enabled:boolean;id:string;closed:boolean;preview:CustomerReport;confirm:FreezeConfirm;bytes:number;maxBytes:number;tooLarge:boolean;frozen:FrozenEntry[]};
type ListResponse={enabled:boolean;frozen:FrozenEntry[]};
export const POS_STATUS_LABELS:Record<PosStatus,string>={pass:'통과',fail:'불일치',missing_pos:'POS 합계 없음'};
const FORMAT_LABELS:Record<Format,string>={md:'MD',csv:'CSV',json:'JSON'};

// ── 순수 계산 ──
const koreaToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
// 끝난 KST ISO 주(월~일)를 최근 주부터 count개. 이번 주는 일요일이 지나야 들어간다.
export function closedWeeks(today:string,count:number):string[]{
 const lastSunday=addDays(today,-(((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)+1));
 return Array.from({length:count},(_,i)=>isoWeekOfDate(addDays(lastSunday,-7*i)));
}
export const reportTabVisible=(account:Account|null)=>canChange(account);
export const canReview=(account:Account|null)=>canChange(account,true);
// 동결 요청: 확인 값은 대화상자에 보인 세 값만 그대로 보낸다(서버가 지금 계산과 다르면 409).
export const freezeBody=(storeId:string,week:string,confirm:FreezeConfirm)=>({action:'freeze',storeId,week,confirmed:true,expected:{orders:confirm.orders,netRevenue:confirm.netRevenue,posStatus:confirm.posStatus}});
export const factPackUrl=(brandId:string,storeId:string|undefined,format:Format)=>API+'?'+new URLSearchParams({type:'fact_pack',brandId,...(storeId?{storeId}:{}),format});
export const reportFileUrl=(id:string,format:Format,version?:number)=>API+'?'+new URLSearchParams({id,format,...(version?{version:String(version)}:{})});
const UNITS:Partial<Record<MetricUnit,string>>={count:'건',people:'명',weeks:'주'};
function valueText(value:number|null,unit:MetricUnit){
 if(value===null)return '미확인';
 if(unit==='krw')return value.toLocaleString('ko-KR')+'원';
 if(unit==='ratio')return (value*100).toFixed(1)+'%';
 return value.toLocaleString('ko-KR')+(UNITS[unit]||'');
}
const posText=(status:PosStatus|null)=>status?`${POS_STATUS_LABELS[status]} (${status})`:'없음';
const kst=(iso:string)=>new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const weekLabel=(week:string)=>{const w=reportWeek(week);return w?`${week} (${w.from.slice(5)}~${w.to.slice(5)})`:week};
const LEDGER_METRICS=REPORT_METRICS.filter(m=>m.section==='ledger');

// ── 요청 ──
async function readJson<T>(response:Response,fallback:string):Promise<T>{
 const data=await response.json().catch(()=>({})) as T&{error?:string};
 if(!response.ok)throw new Error(data.error||fallback);
 return data;
}
const getReport=<T,>(params:Record<string,string>,signal?:AbortSignal)=>fetch(API+'?'+new URLSearchParams(params),{signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<T>(r,'고객 보고서를 불러오지 못했습니다.'));
const postReport=<T,>(body:Record<string,unknown>)=>fetch(API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>readJson<T>(r,'요청을 처리하지 못했습니다.'));
// 첨부 파일을 받아 저장한다. 실패(스위치 꺼짐 409 등)는 서버 문구로 알린다.
async function saveFile(url:string,fallback:string){
 const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
 if(!response.ok)await readJson(response,'파일을 받지 못했습니다.');
 const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||fallback,href=URL.createObjectURL(await response.blob()),link=document.createElement('a');
 link.href=href;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);
 return name;
}

// ── 탭 연결(app/store-marketing-panel.tsx) ──
export function ReportTabTrigger(){return reportTabVisible(useAccount())?<TabsTrigger value="report">고객 보고서</TabsTrigger>:null}
export function ReportTabContent({store}:{store:Pick<Store,'id'|'brandId'|'name'>}){return reportTabVisible(useAccount())?<TabsContent value="report"><CustomerReportPanel key={store.id} store={store}/></TabsContent>:null}

export function CustomerReportPanel({store}:{store:Pick<Store,'id'|'brandId'|'name'>}){
 const owner=canReview(useAccount());
 const [weeks]=useState(()=>closedWeeks(koreaToday(),REPORT_LIST_WEEKS)),[week,setWeek]=useState(weeks[0]);
 const [list,setList]=useState<ListResponse|null>(null),[preview,setPreview]=useState<PreviewResponse|null>(null),[round,setRound]=useState(0);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirming,setConfirming]=useState(false);
 const enabled=list?.enabled??false;
 useEffect(()=>{
  const controller=new AbortController();
  void getReport<ListResponse>({brandId:store.brandId,storeId:store.id,from:weeks[weeks.length-1],to:weeks[0]},controller.signal)
   .then(d=>{if(!controller.signal.aborted){setList(d);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
  return()=>controller.abort();
 },[store.brandId,store.id,weeks,round]);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  void Promise.resolve().then(()=>{if(controller.signal.aborted)return;setLoading(true);return getReport<PreviewResponse>({storeId:store.id,week},controller.signal)})
   .then(d=>{if(d&&!controller.signal.aborted){setPreview(d);setError('')}}).catch(e=>{if(!controller.signal.aborted){setPreview(null);setError((e as Error).message)}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[enabled,store.id,week,round]);
 async function run(task:()=>Promise<string>){
  setBusy(true);
  try{toast.success(await task());setError('')}catch(e){setError((e as Error).message)}finally{setBusy(false);setRound(n=>n+1)}
 }
 const freeze=()=>run(async()=>{
  if(!preview)throw new Error('미리보기를 먼저 불러오세요.');
  const d=await postReport<{version:number}>(freezeBody(store.id,week,preview.confirm));
  return `${week} 보고서를 v${d.version}으로 동결했습니다.`;
 }).finally(()=>setConfirming(false));
 const review=(e:FrozenEntry)=>run(async()=>{await postReport({action:'review',id:e.id,version:e.version});return `${e.week} v${e.version} 검토를 기록했습니다.`});
 const download=(e:FrozenEntry,format:Format,version?:number)=>run(async()=>`${await saveFile(reportFileUrl(e.id,format,version),`customer-report.${format}`)}을(를) 받았습니다.`);
 if(!list)return error?<p className="form-error" role="alert">{error}</p>:<p className="loading-line" role="status">고객 보고서를 불러오고 있습니다.</p>;
 return <>
  <ReportView owner={owner} enabled={enabled} weeks={weeks.slice(0,REPORT_SELECT_WEEKS)} week={week} onWeek={w=>{setWeek(w);setPreview(null)}} preview={preview&&preview.preview.period.week===week?preview:null} frozen={list.frozen} busy={busy} loading={loading} error={error} onFreeze={()=>setConfirming(true)} onReview={e=>void review(e)} onDownload={(e,f,v)=>void download(e,f,v)}/>
  {confirming&&preview&&<FreezeDialog week={week} confirm={preview.confirm} busy={busy} onConfirm={()=>void freeze()} onClose={()=>setConfirming(false)}/>}
 </>;
}

type ViewProps={owner:boolean;enabled:boolean;weeks:string[];week:string;onWeek:(week:string)=>void;preview:PreviewResponse|null;frozen:FrozenEntry[];busy:boolean;loading:boolean;error:string;
 onFreeze:()=>void;onReview:(entry:FrozenEntry)=>void;onDownload:(entry:FrozenEntry,format:Format,version?:number)=>void};
// 화면 본체(상태 없음). 스위치가 꺼져 있으면 주 선택·미리보기·동결·검토 없이 동결본 목록만 그린다.
export function ReportView(props:ViewProps){
 const {enabled,weeks,week,onWeek,preview,busy,loading,error,onFreeze}=props;
 return <section aria-label="고객 보고서" aria-live="polite">
  <div className="section-heading"><div><h3>주간 고객 보고서</h3><p>끝난 주(월~일, 한국 시간)의 장부·POS 대조를 한 장으로 묶어 동결하고, 대표가 검토합니다. 모델을 쓰지 않는 집계입니다.</p></div></div>
  {!enabled&&<p className="notice" role="note">기능 스위치 a8_customer_report가 꺼져 있어 새 보고서를 만들 수 없습니다. 동결본은 그대로 받을 수 있습니다.</p>}
  {enabled&&<>
   <label className="store-field"><span>보고 주</span><NativeSelect value={week} disabled={busy} onChange={e=>onWeek(e.target.value)}>{weeks.map(w=><NativeSelectOption key={w} value={w}>{weekLabel(w)}</NativeSelectOption>)}</NativeSelect></label>
   {loading&&<p className="loading-line" role="status">보고서를 계산하고 있습니다.</p>}
   {preview&&<ReportPreview preview={preview} busy={busy} onFreeze={onFreeze}/>}
  </>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <FrozenList {...props}/>
 </section>;
}

function ReportPreview({preview,busy,onFreeze}:{preview:PreviewResponse;busy:boolean;onFreeze:()=>void}){
 const r=preview.preview,pos=r.completeness.find(c=>c.week===r.period.week),existing=preview.frozen[0];
 return <article aria-label="보고서 미리보기" className="subtle-note">
  <h4>{`${r.period.week} 미리보기 · ${r.period.from}~${r.period.to}`}</h4>
  <ul>{LEDGER_METRICS.map(m=>{const key=m.id as keyof typeof r.ledger.current;return <li key={m.id}><b>{m.label}</b> {valueText(r.ledger.current[key],m.unit)} <small>{`(전주 ${valueText(r.ledger.previous[key],m.unit)})`}</small></li>})}</ul>
  <p>{`POS 대조 ${pos?POS_STATUS_LABELS[pos.status]:'없음'}`}{pos?.reason?` · ${pos.reason}`:''}</p>
  <p>{`north-star · 대조 통과 ${r.northStar.passedWeeks}/${r.northStar.weeks.length}주 · 귀속 주문 ${r.northStar.northStarOrders}건`}</p>
  {r.spendWarnings.map((w,i)=><p key={i} className="form-error">{w.message}</p>)}
  <ul>{r.notices.slice(0,2).map(n=><li key={n}>{n}</li>)}</ul>
  {existing&&<p role="note">{`이 주 동결본 v${existing.version}이 있습니다. 다시 동결하면 v${existing.version+1}이 되고 대표 검토를 다시 받습니다.`}</p>}
  {preview.tooLarge&&<p className="form-error" role="alert">{`보고서가 ${preview.maxBytes.toLocaleString('ko-KR')}바이트를 넘어 동결할 수 없습니다.`}</p>}
  {!preview.closed&&<p role="note">아직 끝나지 않은 주라 동결할 수 없습니다.</p>}
  <Button disabled={busy||!preview.closed||preview.tooLarge} onClick={onFreeze}>동결하기</Button>
 </article>;
}

function FrozenList({owner,enabled,frozen,busy,onReview,onDownload}:ViewProps){
 const files=(entry:FrozenEntry,version?:number)=>FORMATS.map(f=><Button key={f} size="sm" variant="outline" disabled={busy} onClick={()=>onDownload(entry,f,version)}>{`${FORMAT_LABELS[f]} 받기`}</Button>);
 const reviewText=(review:Review|null)=>review?`대표 검토 ${kst(review.at)}`:'검토 전';
 return <div aria-label="동결본">
  <h4>동결본</h4>
  {!frozen.length&&<p className="subtle-note">{`최근 ${REPORT_LIST_WEEKS}주 동결본이 없습니다.`}</p>}
  <ul className="artifact-list">{frozen.map(e=>{const reviewed=e.review?.reportVersion===e.version,older=e.versions.filter(v=>v.version!==e.version);
   return <li key={e.id}><article aria-label={`동결본 ${e.week} v${e.version}`} className="brand-detail-card"><div className="brand-detail-body">
    <p><b>{`${e.week} · v${e.version}`}</b> {`· 동결 ${kst(e.frozenAt)} · ${reviewText(e.review)}`}</p>
    {e.stale&&<p className="form-error" role="note">장부 변경됨(stale) · 동결 뒤 주문·비용·POS·사실이 바뀌었습니다. 다시 동결하면 지금 장부로 새 판을 만듭니다.</p>}
    <div className="form-actions">{files(e)}{owner&&enabled&&!reviewed&&<Button size="sm" disabled={busy} onClick={()=>onReview(e)}>검토 완료</Button>}</div>
    {!!older.length&&<details><summary>{`이전 판 ${older.length}개`}</summary><ul>{older.map(v=><li key={v.version}>{`v${v.version} · 동결 ${kst(v.frozenAt)} · ${reviewText(v.review)}`} {files(e,v.version)}</li>)}</ul></details>}
   </div></article></li>})}</ul>
 </div>;
}

// 동결 확인: 서버에 보낼 확인 값(expected)을 그대로 보인다. 지금 계산과 다르면 서버가 저장하지 않는다(409).
export function FreezeDialog({week,confirm,busy,onConfirm,onClose}:{week:string;confirm:FreezeConfirm;busy:boolean;onConfirm:()=>void;onClose:()=>void}){
 return <Dialog open onOpenChange={v=>!v&&!busy&&onClose()}><DialogContent><DialogHeader><DialogTitle>{`${week} 보고서 동결`}</DialogTitle><DialogDescription>아래 값을 확인 값으로 보내 지금 판을 저장합니다. 그사이 장부가 바뀌었으면 저장하지 않습니다.</DialogDescription></DialogHeader>
  <ul aria-label="보낼 확인 값">
   <li>{`주문 수 ${valueText(confirm.orders,'count')}`}</li>
   <li>{`순매출 ${valueText(confirm.netRevenue,'krw')}`}</li>
   <li>{`POS 대조 ${posText(confirm.posStatus)}`}</li>
  </ul>
  <p className="subtle-note">다시 동결하면 판 번호가 올라가고 대표 검토를 다시 받습니다.</p>
  <div className="form-actions"><Button variant="outline" disabled={busy} onClick={onClose}>취소</Button><Button disabled={busy} onClick={onConfirm}>{busy?'동결 중…':'이 값으로 동결'}</Button></div>
 </DialogContent></Dialog>;
}

// 브랜드 사실 탭 '사실 팩 받기'(대표·관리자). 확정 사실만 담고 가맹 항목은 빠진다. 스위치가 꺼져 있으면 서버 문구(409)를 보인다.
export function FactPackDownload({brandId,storeId}:{brandId:string;storeId?:string}){
 const admin=canChange(useAccount()),[format,setFormat]=useState<Format>('md'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!admin)return null;
 async function download(){
  setBusy(true);setError('');
  try{toast.success(`${await saveFile(factPackUrl(brandId,storeId,format),`fact-pack.${format}`)}을(를) 받았습니다.`)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <div className="notice"><p>사실 팩: 지금 확정된 사실만 내려받습니다(가맹 항목 제외).</p>
  <label className="store-field"><span>사실 팩 형식</span><NativeSelect value={format} onChange={e=>setFormat(e.target.value as Format)}>{FORMATS.map(f=><NativeSelectOption key={f} value={f}>{FORMAT_LABELS[f]}</NativeSelectOption>)}</NativeSelect></label>
  <Button variant="outline" size="sm" disabled={busy} onClick={()=>void download()}>사실 팩 받기</Button>
  {error&&<p className="form-error" role="alert">{error}</p>}
 </div>;
}
