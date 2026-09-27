'use client';
// 가맹 모집 화면 '성과' 탭(트랙 R R6c, 계획 화면 V8 '어느 채널 돈이 계약이 되나'): 주간 모집 보고(유입·채널 CPL·플랫폼 보고·speed-to-lead·문의 월 코호트·법정 게이트·규칙 신선도)를
// 서버 보기 report(lib/franchise-report-server.ts) 그대로 보인다. 귀속≠증분·작은 표본 문구와 면책을 모든 숫자보다 먼저 둔다. 1~4건 칸은 '5건 미만', 분모 20 미만은 '표본 부족'이다(서버 계산).
// 대표·관리자는 끝난 주를 확정하고(확인한 다이제스트를 보내 재집계가 다르면 409) 확정본을 내려받는다. 직원은 집계만 본다. 판정·권한은 서버가 한다. 모델 호출은 0이다.
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cellText,rateText,costText,moneyText,QUALIFIED_NOTE,STL_REFERENCE_NOTE,type RecruitmentReport,type Cell} from '@/lib/franchise-report';
import {franchiseGet,franchisePost,problemOf,messageOf,ProblemBox,Disclaimer,Section,kst,saveText,roleLabel,errorIs,type Json,type Problem} from './franchise-common';

// ── 보기 모양(서버 report 보기) ──
export type FrozenSummary={version:number;digest:string;frozenAt:string;frozenBy:{id:string;role:string};changedSinceFreeze:boolean;versions:{version:number;frozenAt:string;digest:string}[]};
export type ReportViewData={enabled:boolean;role:string;week:string;period:{week:string;from:string;to:string};closed:boolean;preview:RecruitmentReport;digest:string;frozen:FrozenSummary|null;ruleVersion:string;disclaimer:string};
export type ReportFormat='md'|'csv'|'json';

// ── 고정 문구 ──
export const FREEZE_CONFIRM='이 주의 보고를 지금 값으로 확정합니다. 확정본은 고치지 않고, 다시 확정하면 새 판이 됩니다.';
export const OPEN_WEEK_NOTE='진행 중인 주입니다. 끝난 주(일요일까지, 한국 날짜)만 확정할 수 있습니다.';
export const CHANGED_NOTE='확정 뒤 리드·비용 기록이 바뀌었습니다. 확정본은 그대로이고, 지금 값으로 다시 확정하면 새 판이 됩니다.';
export const REPORT_CHANGED_NOTE='확인한 뒤 원장이 바뀌어 확정하지 않았습니다. 다시 불러온 값을 확인한 뒤 확정하세요.';
export const MEMBER_REPORT_NOTE='보고 확정과 내려받기는 대표·관리자가 합니다.';
export const FORMAT_LABELS:Readonly<Record<ReportFormat,string>>={md:'Markdown',csv:'CSV',json:'JSON'};

// ── 순수 도우미(단위 검사 대상) ──
export const freezeInput=(v:Pick<ReportViewData,'week'|'digest'>):Json=>({week:v.week,confirmed:true,expected:{digest:v.digest}});
export const exportInput=(week:string,format:ReportFormat,version?:number):Json=>({week,format,...(version!==undefined?{version}:{})});
export const canFreeze=(v:Pick<ReportViewData,'enabled'|'closed'>,admin:boolean)=>admin&&v.enabled&&v.closed;

// ── 탭 본체 ──
export function FranchiseReport({brandId,admin,initial}:{brandId:string;admin:boolean;initial?:ReportViewData}){
 const [data,setData]=useState<ReportViewData|null>(initial??null),[week,setWeek]=useState(initial?.week??''),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[problem,setProblem]=useState<Problem|null>(null);
 const load=useCallback(async(pick:string,signal?:AbortSignal)=>{
  try{const d=await franchiseGet<ReportViewData>({view:'report',brandId,...(pick?{week:pick}:{})},signal);if(!signal?.aborted){setData(d);setWeek(d.week);setError('')}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
 },[brandId]);
 useEffect(()=>{if(initial)return;const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load('',c.signal)});return ()=>c.abort()},[load,initial]);
 async function freeze(v:ReportViewData){
  if(!window.confirm(FREEZE_CONFIRM))return;
  setBusy(true);setProblem(null);setMessage('');
  try{
   const r=await franchisePost('report_freeze',{brandId,...freezeInput(v)});
   if(r.status===200){setMessage(`${v.week} 보고를 확정했습니다(판 ${String((r.body.result as Json|undefined)?.version??'')}).`);await load(v.week);return}
   if(errorIs(r,'REPORT_CHANGED'))setMessage(REPORT_CHANGED_NOTE);
   setProblem(problemOf(r));await load(v.week);
  }finally{setBusy(false)}
 }
 async function download(v:ReportViewData,format:ReportFormat,version?:number){
  setBusy(true);setProblem(null);setMessage('');
  try{
   const r=await franchisePost('report_export',{brandId,...exportInput(v.week,format,version)});
   if(r.status!==200){setProblem(problemOf(r));return}
   const b=r.body as Json;saveText(String(b.fileName),String(b.body));setMessage(`${String(b.fileName)}을(를) 내려받았습니다.`);
  }finally{setBusy(false)}
 }
 return <div className="franchise-panel">
  {data&&<ul className="franchise-list" aria-label="보고 읽는 법">{data.preview.notes.map((n,i)=><li key={i}>{n}</li>)}</ul>}
  <Disclaimer/>
  <form autoComplete="off" className="franchise-bar" aria-label="보고 주 고르기" onSubmit={e=>{e.preventDefault();void load(week)}}>
   <label className="field"><span>보고 주</span><Input type="week" aria-label="보고 주" value={week} onChange={e=>setWeek(e.target.value)}/></label>
   <Button type="submit" variant="outline" disabled={!week}>보기</Button>
  </form>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load(week)}>다시 불러오기</Button></div>}
  {!data?!error&&<p role="status">모집 보고를 불러오고 있습니다.</p>:<>
   <FreezeBox data={data} admin={admin} busy={busy} onFreeze={()=>void freeze(data)} onDownload={(f,v)=>void download(data,f,v)}/>
   {(message||problem)&&<div className="franchise-status">{message&&<p role="status">{message}</p>}<ProblemBox problem={problem}/></div>}
   <ReportBody r={data.preview}/>
  </>}
 </div>;
}

function FreezeBox({data,admin,busy,onFreeze,onDownload}:{data:ReportViewData;admin:boolean;busy:boolean;onFreeze:()=>void;onDownload:(f:ReportFormat,version?:number)=>void}){
 const f=data.frozen;
 return <Section title={`${data.period.week} (${data.period.from} ~ ${data.period.to})`} note={data.closed?'끝난 주입니다.':OPEN_WEEK_NOTE}>
  {f?<p>{`확정 판 ${f.version} · ${kst(f.frozenAt)} · ${roleLabel(f.frozenBy.role)}`}</p>:<p className="subtle-note">이 주의 확정본이 없습니다.</p>}
  {f?.changedSinceFreeze&&<p className="notice" role="note">{CHANGED_NOTE}</p>}
  {!admin?<p className="subtle-note">{MEMBER_REPORT_NOTE}</p>:<div className="franchise-bar">
   {canFreeze(data,admin)&&<Button disabled={busy} onClick={onFreeze}>{f?'지금 값으로 다시 확정':'이 주 보고 확정'}</Button>}
   {f&&(Object.keys(FORMAT_LABELS) as ReportFormat[]).map(k=><Button key={k} size="sm" variant="outline" disabled={busy} onClick={()=>onDownload(k)}>{`${FORMAT_LABELS[k]} 내려받기`}</Button>)}
  </div>}
  {admin&&!data.enabled&&<p className="subtle-note">가맹 모집 기능이 꺼져 있어 확정은 할 수 없습니다. 확정본 내려받기는 할 수 있습니다.</p>}
  {admin&&f&&f.versions.length>1&&<ul className="franchise-list" aria-label="이전 확정 판">{f.versions.slice(1).map(v=><li key={v.version}>{`판 ${v.version} · ${kst(v.frozenAt)} `}<Button size="sm" variant="ghost" disabled={busy} onClick={()=>onDownload('md',v.version)}>Markdown</Button></li>)}</ul>}
 </Section>;
}

// ── 보고 본문 ──
type Row=readonly [string,string];
function Table({caption,head,rows}:{caption:string;head:readonly string[];rows:readonly (readonly string[])[]}){
 return <div className="ledger-table-wrap"><table className="ledger-table franchise-table"><caption className="sr-only">{caption}</caption>
  <thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead>
  <tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
}
const cells=(pairs:readonly (readonly [string,Cell])[]):Row[]=>pairs.map(([k,c])=>[k,cellText(c)] as const);
export function ReportBody({r}:{r:RecruitmentReport}){
 const i=r.inflow,c=r.cost,s=r.speedToLead,g=r.gates;
 return <>
  <Section title="유입(보고 주 접수)">
   <Table caption="유입 건수" head={['구분','리드']} rows={[...cells([['전체',i.total],['수기 등록',i.manual],['가져온 리드',i.imported],['코드 귀속',i.code],['제공처 파일 기준',i.file],['유입 미확인',i.unattributed],['점포 코드와 같은 값',i.conflict],['소급 등록 코드',i.retroactive],['접수 72시간 뒤 입력',i.late]]),['귀속 비율',rateText(i.attributedRate)]]}/>
   {i.channels.length?<Table caption="채널별 유입" head={['채널','코드 귀속','제공처 파일 기준','합계']} rows={i.channels.map(ch=>[ch.merged?`${ch.label} (${ch.channelLabels.join('·')})`:ch.label,cellText(ch.code),cellText(ch.file),cellText(ch.total)])}/>:<p className="subtle-note">이 주에 귀속된 리드가 없습니다.</p>}
  </Section>
  <Section title="채널 CPL" note={`${c.window.from} ~ ${c.window.to} 안에 기간이 모두 든 비용만 셉니다. 걸친 비용이 있으면 CPL을 비우고 맞춘 기간을 보입니다.`}>
   <p>{`주 안 비용 합계 ${moneyText(c.totalSpend)} · 걸친 비용 ${c.straddlingRows}건`}</p>
   {c.channels.length?<Table caption="채널별 비용과 CPL" head={['채널','비용','리드(코드+파일)','CPL(코드+파일)','CPL(코드만)','맞춘 기간']} rows={c.channels.map(ch=>[ch.label,moneyText(ch.spend),cellText(ch.leads),costText(ch.cpl),costText(ch.cplCode),ch.aligned?`${ch.aligned.from} ~ ${ch.aligned.to}`:'-'])}/>:<p className="subtle-note">이 주의 비용·귀속 리드가 없습니다.</p>}
   {c.platform.length>0&&<Table caption="플랫폼 보고 수치" head={['채널','노출','클릭','양식 제출','구분']} rows={c.platform.map(p=>[p.label,p.impressions===null?'모름':String(p.impressions),p.clicks===null?'모름':String(p.clicks),p.formSubmits===null?'모름':String(p.formSubmits),p.note])}/>}
  </Section>
  <Section title="speed-to-lead(첫 연락까지)" note={STL_REFERENCE_NOTE}>
   <Table caption="speed-to-lead" head={['기준 시각','접수','첫 연락','미응대','중앙값(분)','첫 연락 비율']} rows={s.groups.map(x=>[x.label,cellText(x.received),cellText(x.contacted),cellText(x.uncontacted),x.medianState==='shown'?String(x.medianMinutes):x.medianState==='suppressed'?'5건 미만':'-',rateText(x.contactedRate)])}/>
   <p className="subtle-note">{`제공처 시각이 날짜만 있어 뺀 리드: ${cellText(s.excludedDayPrecision)}`}</p>
  </Section>
  <Section title="문의 월 코호트" note="문의 월(한국 날짜) 기준입니다. 비율은 코호트 20건 이상일 때만 보입니다. 계약 칸은 1건부터 보이고, 계약당 비용은 계약 20건 전에는 지출 합계·계약 수와 '표본 부족'을 함께 적습니다(대표 결정 36).">
   <Table caption="문의 월 코호트" head={['문의 월','문의','성숙',...(r.cohorts[0]?.stages??[]).map(x=>x.label),'종결','비용','계약당 비용']}
    rows={r.cohorts.map(k=>[k.month,cellText(k.size),k.mature?'성숙':'미성숙',...k.stages.map(x=>`${cellText(x.reached)} (${rateText(x.rate)})`),cellText(k.closed),k.spendState==='straddling'?'비용 기간 불일치':moneyText(k.spend),costText(k.costPerContract)])}/>
  </Section>
  <Section title="적격 판정(문의 월 코호트)" note={QUALIFIED_NOTE}>
   <Table caption="코호트 적격 판정" head={['문의 월','적격','기준 버전별 적격','보류','거절','판정 없음','적격 리드당 비용']}
    rows={r.cohorts.map(k=>{const q=k.qualification;return [k.month,cellText(q.qualified),q.byVersion.length?q.byVersion.map(x=>`v${x.version} ${cellText(x.qualified)}`).join(' · '):'-',cellText(q.hold),cellText(q.rejected),cellText(q.unjudged),costText(q.costPerQualified)]})}/>
  </Section>
  <Section title="법정 게이트·규칙">
   <Table caption="법정 게이트와 규칙 신선도" head={['항목','값']} rows={[['보고 주 계약',cellText(g.contractsInWeek)],['보고 주 서버 거부 시도',String(g.blockedAttempts)],['계약 리드(전체)',cellText(g.contracted)],['증빙 완결(전체)',cellText(g.evidenceComplete)],
    [`확인 ${r.thresholds.ruleStaleDays}일이 지난 규칙`,`${r.rules.stale} / ${r.rules.checked}`]]}/>
  </Section>
 </>;
}
