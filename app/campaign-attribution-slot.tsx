'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {RefreshCw,Save} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {api} from '@/lib/client';
import type {CampaignAttribution} from '@/lib/campaign-attribution';
import {koreaToday} from '@/lib/store-operations';
import {addDays} from '@/lib/store-attribution';
import {NOT_INCREMENTAL,unitRows,weekLabel,won,type UnitRow} from '@/lib/store-operations-view';

// 캠페인 상세 '성과' 탭(panels.tsx) 끝에 붙인다. 탭은 열릴 때만 있으므로 DOM 변화를 보고 자리를 다시 찾는다(online-grading.tsx OutputsSlot과 같은 방식).
function ResultsSlot({children}:{children:ReactNode}){
 const [host,setHost]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  let slot:HTMLDivElement|null=null;
  const sync=()=>{
   const panel=document.querySelector<HTMLElement>('.campaign-sheet [role="tabpanel"][id$="-content-results"]');
   if(slot&&panel&&slot.parentElement===panel)return;
   slot?.remove();slot=null;
   if(panel){slot=document.createElement('div');slot.className='campaign-attribution-host';panel.appendChild(slot)}
   setHost(slot);
  };
  sync();
  const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});
  return()=>{observer.disconnect();slot?.remove()};
 },[]);
 return host?createPortal(children,host):null;
}

type Period={from:string;to:string};
type Row=UnitRow&{codes?:string[]};
const count=(n:number)=>n.toLocaleString('ko-KR')+'건';
async function fetchReport(campaignId:string,period:Period|null,signal:AbortSignal){
 const response=await fetch('/api/campaign-attribution?'+new URLSearchParams({campaignId,...(period||{})}),{signal,cache:'no-store'});
 const result=await response.json() as CampaignAttribution&{error?:string};
 if(!response.ok)throw new Error(result.error||'주문 장부 귀속을 불러오지 못했습니다.');
 return result;
}

// 성과 탭의 '주문 장부 귀속' 카드. 판정·집계는 서버(lib/campaign-attribution.ts)가 정본이고, 화면은 모르는 값(null)을 0이 아니라 미확인으로 보인다.
export function CampaignAttributionSlot({campaignId,onSaved}:{campaignId:string;onSaved:()=>Promise<void>}){
 return <ResultsSlot><AttributionCard campaignId={campaignId} onSaved={onSaved}/></ResultsSlot>;
}
function AttributionCard({campaignId,onSaved}:{campaignId:string;onSaved:()=>Promise<void>}){
 const [range,setRange]=useState<Period>({from:'',to:''}),[period,setPeriod]=useState<Period|null>(null),[reload,setReload]=useState(0);
 const [report,setReport]=useState<CampaignAttribution|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[confirming,setConfirming]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  fetchReport(campaignId,period,controller.signal)
   .then(result=>{if(!controller.signal.aborted){setReport(result);setRange(result.period);setError('')}})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'주문 장부 귀속을 불러오지 못했습니다.')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[campaignId,period,reload]);
 const refresh=()=>{setLoading(true);setReload(n=>n+1)},ready=!loading&&!error&&!!report?.totals.records;
 // 스냅샷은 끝난 날(어제까지)만 저장한다(서버도 오늘 끝나는 기간은 400). 종료일이 오늘이면 같은 시작일로 어제까지 다시 조회하게 한다.
 const yesterday=addDays(koreaToday(),-1),closed=!!report&&report.period.to<=yesterday,untilYesterday=()=>{if(!report)return;setLoading(true);setPeriod({from:report.period.from<yesterday?report.period.from:yesterday,to:yesterday})};
 return <section className="campaign-attribution" aria-label="주문 장부 귀속">
  <div className="section-heading"><div><h2>주문 장부 귀속 · 자동 집계</h2><p>점포 주문 장부에서 이 캠페인에 귀속된 주문을 주 단위(한국시간 월~일)로 합칩니다. 저장한 성과가 아니라 지금 장부 기준입니다.</p></div>{ready&&(closed?<Button variant="outline" onClick={()=>setConfirming(true)}><Save/>스냅샷으로 저장</Button>:<Button variant="outline" onClick={untilYesterday}><RefreshCw/>어제까지로 조회</Button>)}</div>
  <p className="notice">{NOT_INCREMENTAL}</p>
  {ready&&!closed&&<p className="notice">{"오늘 주문은 아직 확정 전이라 스냅샷은 어제까지의 기간으로만 저장합니다. '어제까지로 조회'로 기간을 바꾼 뒤 저장하세요."}</p>}
  <form className="ledger-period" aria-label="귀속 집계 기간" onSubmit={e=>{e.preventDefault();setLoading(true);setPeriod({...range})}}>
   <label className="store-field"><span>집계 시작일</span><Input type="date" required value={range.from} max={range.to||undefined} onChange={e=>setRange({...range,from:e.target.value})}/></label>
   <label className="store-field"><span>집계 종료일</span><Input type="date" required value={range.to} min={range.from||undefined} max={koreaToday()} onChange={e=>setRange({...range,to:e.target.value})}/></label>
   <Button variant="outline" disabled={loading}><RefreshCw/>조회</Button>
  </form>
  {loading?<p role="status">주문 장부 귀속을 집계하고 있습니다.</p>:error?<div className="load-error" role="alert"><span>{error}</span><Button variant="outline" onClick={refresh}>다시 시도</Button></div>:report&&<AttributionBody report={report}/>}
  {report&&confirming&&<SnapshotDialog campaignId={campaignId} report={report} onClose={()=>setConfirming(false)} onSaved={onSaved}/>}
 </section>;
}

function AttributionBody({report:r}:{report:CampaignAttribution}){
 const t=r.totals,notes=r.notes.filter(x=>x!==NOT_INCREMENTAL),method=(key:string)=>r.byMethod.find(g=>g.key===key)?.orders??0;
 if(!t.records)return <><p className="notice">{r.period.from} ~ {r.period.to}에 이 캠페인에 귀속된 주문이 없습니다. 점포 마케팅 → 지점 → 주문 장부에서 추적 코드나 유입 확인 근거로 주문을 이 캠페인에 연결하면 여기에 자동으로 집계됩니다.</p><Notes notes={notes}/></>;
 return <>
  <div className="ledger-summary">
   <article><span>귀속 주문</span><strong>{count(t.orders)}</strong><small>기록 {count(t.records)} · 취소·전액 환불은 주문 수에서 제외</small></article>
   <article><span>순매출</span><strong>{won(t.netRevenue)}</strong><small>결제액 − 환불액</small></article>
   <article><span>공헌이익</span><strong>{won(t.contribution)}</strong><small>{t.unknownCostOrders?`원가 미확인 ${count(t.unknownCostOrders)} · 0으로 계산하지 않음`:'순매출 − 주문 원가 · 광고비 미배분'}</small></article>
   <article><span>귀속 방식</span><strong>코드 {method('code')} · 수동 {method('manual')}</strong><small>추적 코드 귀속 · 근거를 적은 수동 귀속</small></article>
  </div>
  <WeekTable weeks={r.weeks}/>
  <Breakdown title="지점별" column="지점" rows={r.byStore}/>
  <Breakdown title="소재별" column="소재" rows={r.byCreative}/>
  <Breakdown title="게시별" column="게시" rows={r.byPublication} codes note="게시 코드로 귀속되고 지금 게시 관문(예약 접수·게시 확인, 예약일 이후 주문)을 통과한 주문만 셉니다." empty="이 기간에 게시 코드로 귀속된 주문이 없습니다."/>
  <Breakdown title="귀속 방식별" column="방식" rows={r.byMethod}/>
  <Notes notes={notes}/>
 </>;
}
function WeekTable({weeks}:{weeks:CampaignAttribution['weeks']}){
 const rows=unitRows(weeks.map(w=>({...w,key:w.weekStart,label:weekLabel(w.start,w.end)})));
 return <section><div className="section-heading"><div><h3>주별 귀속</h3><p>한국시간 월요일에 시작하는 주입니다. 첫 주와 마지막 주는 집계 기간 안의 날짜만 셉니다.</p></div></div><div className="ledger-table-wrap"><table className="ledger-table"><caption className="sr-only">주별 귀속 주문·순매출·공헌이익</caption><thead><tr><th>주</th><th>귀속 주문</th><th>순매출</th><th>공헌이익</th></tr></thead><tbody>{rows.map(w=><tr key={w.key}><td><b>{w.label}</b></td><td>{w.orders}</td><td>{w.netRevenue}</td><td>{w.contribution}{w.contributionNote&&<small>{w.contributionNote}</small>}</td></tr>)}</tbody></table></div></section>;
}
function Breakdown({title,column,rows,codes=false,note,empty='이 기간에 집계할 주문이 없습니다.'}:{title:string;column:string;rows:readonly Row[];codes?:boolean;note?:string;empty?:string}){
 const shown=unitRows(rows),linked=Object.fromEntries(rows.map(r=>[r.key,(r.codes||[]).join(', ')]));
 return <section><div className="section-heading"><div><h3>{title}</h3>{note&&<p>{note}</p>}</div></div>{!shown.length?<p className="notice">{empty}</p>:<div className="ledger-table-wrap"><table className="ledger-table"><caption className="sr-only">{title} 귀속 주문·순매출·공헌이익</caption><thead><tr><th>{column}</th>{codes&&<th>코드</th>}<th>귀속 주문</th><th>순매출</th><th>공헌이익</th></tr></thead><tbody>{shown.map(r=><tr key={r.key||'none'}><td><b>{r.label}</b></td>{codes&&<td>{linked[r.key]||'코드 없음'}</td>}<td>{r.orders}</td><td>{r.netRevenue}</td><td>{r.contribution}{r.contributionNote&&<small>{r.contributionNote}</small>}</td></tr>)}</tbody></table></div>}</section>;
}
function Notes({notes}:{notes:readonly string[]}){return notes.length?<ul className="subtle-note attribution-notes">{notes.map(n=><li key={n}>{n}</li>)}</ul>:null}

// 확인 대화: 저장할 값(기간·범위·출처·수치)을 보이고, 확인한 값(expected)을 함께 보낸다. 서버는 저장 직전에 다시 집계해 값이 다르면 409로 막는다.
function SnapshotDialog({campaignId,report:r,onClose,onSaved}:{campaignId:string;report:CampaignAttribution;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),t=r.totals,variableCosts=t.contribution===null?null:t.netRevenue-t.contribution;
 async function save(){
  setBusy(true);setError('');
  try{await api('snapshot',{campaignId,from:r.period.from,to:r.period.to,confirmed:true,expected:{orders:t.orders,netRevenue:t.netRevenue,contribution:t.contribution}},'/api/campaign-attribution');await onSaved();toast.success('주문 장부 귀속 집계를 성과 기록으로 저장했습니다.');onClose()}
  catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false)}
 }
 const rows=[['측정 기간',`${r.period.from} ~ ${r.period.to}`],['비교 범위',r.snapshot.scope],['자료 출처',r.snapshot.source],['수집 방식','원자료 내보내기'],['주문 수',count(t.orders)],['순매출',won(t.netRevenue)],['상품 원가·변동비',won(variableCosts)],['매체비·제작비','배분하지 않음 · 미확인으로 저장']];
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose()}}><DialogContent className="wide-dialog"><DialogHeader><DialogTitle>주문 장부 귀속 스냅샷 저장</DialogTitle><DialogDescription>지금 보이는 집계를 성과 기록으로 저장합니다. 저장 직전에 다시 집계해 확인한 값과 다르면 저장하지 않습니다.</DialogDescription></DialogHeader>
  <dl className="attribution-snapshot">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <p className="notice">{NOT_INCREMENTAL} 같은 비교 범위에서 기간이 겹치는 성과 기록이 있으면 저장하지 않습니다.</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="form-actions"><Button variant="outline" disabled={busy} onClick={onClose}>취소</Button><Button disabled={busy} onClick={()=>void save()}>{busy?'저장 중…':'확인하고 저장'}</Button></div>
 </DialogContent></Dialog>;
}
