'use client';
import {useCallback,useEffect,useState} from 'react';
import {ClipboardCheck,Download,RefreshCw} from 'lucide-react';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {roles,type Campaign} from '@/lib/agency';
import {isModelAlias} from '@/lib/usage-summary';
import {MIN_SAMPLE,kstDate,type ConsoleSummary,type MeetingCompletion} from '@/lib/quality-console';
import {MIN_KAPPA_N,kappaBand,type CriterionKappaRow} from '@/lib/quality-kappa';
import {AdminOnly} from './account-context';
import {QualityOperationsPanel} from './quality-operations-panel';
import {JudgeLabelPanel} from './judge-label-panel';

// B2 품질 콘솔(소유자·관리자 전용 시트). GET /api/quality-console(lib/quality-console-server.ts)의 집계를 보여 주기만 하고 다시 계산하지 않는다.
// 표본 규칙은 집계와 같다: 비율은 n<MIN_SAMPLE(5)이면 '표본 부족', κ는 기준별 라벨 n<MIN_KAPPA_N(20)이면 '보정 불가', 한 범주만 있으면 '정의 불가'.
type ConsoleData={period:{from:string;to:string;days:number};campaignId:string|null;summary:ConsoleSummary;kappa:CriterionKappaRow[];partial:{kinds:string[];limit:number}|null;read:Record<string,number>;digestWeek:string;notice:string};
const kindNames:Record<string,string>={decisions:'사람 판정',artifacts:'작업물',history:'이전 판',usage:'사용량',meetings:'회의',gradings:'채점',jobs:'실행',units:'κ 라벨'};
const discardNames:[string,string][]=[['question_only','재질문만 남김'],['revision','수정 요청으로 대체'],['outdated','이전 버전(outdated)'],['invalid_output','형식 오류(invalid_output)']];
const targetNames:[string,string][]=[['artifact','작업물'],['brief_suggestion','브리프 제안'],['source','자료'],['publication','발행']];
const n=(value:number|null|undefined)=>(value??0).toLocaleString('ko-KR');
const roleName=(id:string)=>roles.find(r=>r.id===id)?.name||id||'미확인';
const modelName=(model:string|null)=>model===null?'미확인':isModelAlias('hermes',model)?`${model} (실제 모델 미확인)`:model;
const percent=(value:number)=>`${(value*100).toFixed(1)}%`;
// 비율은 표본이 MIN_SAMPLE 미만이면 집계가 null을 준다. 그때는 숫자 대신 표본 부족과 n을 보인다.
const rateText=(rate:number|null,k:number,size:number)=>rate===null?`표본 부족 (n=${size})`:`${percent(rate)} (${k}/${size})`;
const meetingRate=(m:MeetingCompletion)=>rateText(m.rate,m.completed,m.started);
function kappaText(row:CriterionKappaRow){
 if(row.status==='ok'&&row.kappa!==null)return `${row.kappa.toFixed(2)} · ${kappaBand(row.kappa)}`;
 if(row.status==='single_category')return 'κ 정의 불가(한 범주만 있음)';
 return `보정 불가(${row.status==='no_data'?'라벨 없음':'표본 부족'}, ${row.needed}건 더 필요)`;
}
const agreementText=(row:CriterionKappaRow)=>row.n===0?'라벨 없음':row.agreement===null?`표본 부족 (n=${row.n})`:percent(row.agreement);
// 레지스트리 실행 행은 프롬프트 버전으로 묶어 스킬 버전 칸이 비고(—), 코드 상수 실행 행은 프롬프트 버전 칸이 '코드 상수'다.
const skillText=(r:{skillVersion:string|null;promptVersion:string|null})=>r.skillVersion??(r.promptVersion?'—':'미확인');
// 주의 끝(to)은 다음 주 월요일 00:00 KST(제외)라 1ms 앞의 날짜가 마지막 날이다.
const weekDays=(w:{from:string;to:string})=>`${kstDate(w.from).slice(5)}~${kstDate(new Date(Date.parse(w.to)-1).toISOString()).slice(5)}`;
async function consoleData(query:string):Promise<ConsoleData>{
 const response=await fetch('/api/quality-console'+(query?'?'+query:''),{cache:'no-store'}),data=await response.json() as ConsoleData&{error?:string};
 if(!response.ok)throw new Error(data.error||'품질 지표를 불러오지 못했습니다.');
 return data;
}
async function downloadDigest(query:string){
 const response=await fetch('/api/quality-console?format=digest'+(query?'&'+query:''),{cache:'no-store'});
 if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};throw new Error(data.error||'주간 다이제스트를 받지 못했습니다.')}
 const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||'collective-quality-digest.md',url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
 link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Stat({label,value,dim=false}:{label:string;value:string;dim?:boolean}){return <div><strong className={dim?'quality-dim':''}>{value}</strong><span>{label}</span></div>}
function Totals({s}:{s:ConsoleSummary}){
 const t=s.totals;
 return <div className="quality-stats"><Stat label="AI 작업물(이전 버전 포함)" value={n(t.artifacts)}/><Stat label="1차 승인율" value={rateText(t.firstPassRate,t.approvedFirst,t.n)} dim={t.firstPassRate===null}/><Stat label="수정 요청" value={n(t.revisions)}/>
  <Stat label="폐기 토큰" value={n(t.discardedTokens)}/><Stat label="미연결 토큰(작업물·회의와 잇지 못함)" value={n(t.unlinkedTokens)}/><Stat label="회의 완주율" value={meetingRate(s.meetings)} dim={s.meetings.rate===null}/>
  <Stat label="A2 규제 보류" value={n(t.holds)}/><Stat label="채점 완료·오류·미실행" value={`${n(t.gradings.graded)}·${n(t.gradings.grader_error)}·${n(t.gradings.not_run)}`}/><Stat label="실패 채점기" value={n(t.gradings.failedGraders)}/></div>;
}
function Rows({s}:{s:ConsoleSummary}){
 if(!s.rows.length)return <p className="subtle-note">아직 이 기간에 역할별로 묶을 AI 작업물이 없습니다.</p>;
 return <div className="quality-table"><Table aria-label="역할·스킬·프롬프트 버전·보고 모델별 지표"><TableCaption>1차 승인율은 사람이 고치지 않은 AI 판에 내린 첫 판정 기준(B1)입니다. 프롬프트 레지스트리로 실행한 행은 프롬프트 버전으로 묶습니다. 보고 모델은 공급자가 알린 이름입니다.</TableCaption>
  <TableHeader><TableRow>{['역할','스킬 버전','프롬프트 버전','보고 모델'].map(h=><TableHead key={h}>{h}</TableHead>)}{['작업물','1차 승인율','수정 요청'].map(h=><TableHead key={h} className="num">{h}</TableHead>)}<TableHead>주요 사유</TableHead>{['폐기 토큰','미연결','채점 완료·오류·미실행','실패 채점기','규제 보류'].map(h=><TableHead key={h} className="num">{h}</TableHead>)}</TableRow></TableHeader>
  <TableBody>{s.rows.map(r=>{const top=Object.entries(r.reasons).filter(([,c])=>c>0).sort((a,b)=>b[1]-a[1]).slice(0,2);return <TableRow key={JSON.stringify([r.role,r.skillVersion,r.promptVersion,r.reportedModel])}>
   <TableCell>{roleName(r.role)}</TableCell><TableCell className={r.skillVersion?'':'quality-dim'}>{skillText(r)}</TableCell><TableCell className={r.promptVersion?'':'quality-dim'}>{r.promptVersion??'코드 상수'}</TableCell><TableCell>{modelName(r.reportedModel)}</TableCell>
   <TableCell className="num">{n(r.artifacts)}</TableCell><TableCell className={'num'+(r.firstPassRate===null?' quality-dim':'')}>{rateText(r.firstPassRate,r.approvedFirst,r.n)}</TableCell><TableCell className="num">{n(r.revisions)}</TableCell>
   <TableCell>{top.length?top.map(([code,c])=>`${s.reasons.find(x=>x.code===code)?.label||code} ${c}`).join(' · '):<span className="quality-dim">—</span>}</TableCell><TableCell className="num">{n(r.discardedTokens)}</TableCell><TableCell className="num">{n(r.unlinkedTokens)}</TableCell>
   <TableCell className="num">{`${n(r.gradings.graded)}·${n(r.gradings.grader_error)}·${n(r.gradings.not_run)}`}</TableCell><TableCell className="num">{n(r.gradings.failedGraders)}</TableCell><TableCell className="num">{n(r.holds)}</TableCell></TableRow>})}</TableBody></Table></div>;
}
function Reasons({s}:{s:ConsoleSummary}){
 const list=s.reasons.filter(r=>r.total>0);
 return <><p className="subtle-note">판정 {n(Object.values(s.decisions).reduce((a,b)=>a+b,0))}건: {targetNames.map(([k,label])=>`${label} ${n(s.decisions[k as keyof typeof s.decisions])}`).join(' · ')}</p>
  {list.length?<div className="quality-table"><Table aria-label="사람 판정 사유 분포"><TableHeader><TableRow><TableHead>사유</TableHead>{targetNames.map(([k,label])=><TableHead key={k} className="num">{label}</TableHead>)}<TableHead className="num">합계</TableHead></TableRow></TableHeader>
   <TableBody>{list.map(r=><TableRow key={r.code}><TableCell>{r.label}</TableCell>{targetNames.map(([k])=><TableCell key={k} className="num">{n(r[k as keyof typeof s.decisions])}</TableCell>)}<TableCell className="num">{n(r.total)}</TableCell></TableRow>)}</TableBody></Table></div>:<p className="subtle-note">이 기간에 사유 코드가 붙은 판정이 없습니다.</p>}</>;
}
function Discards({s}:{s:ConsoleSummary}){
 const t=s.totals;
 return <div className="quality-stats">{discardNames.map(([k,label])=><Stat key={k} label={label} value={n(t.discarded[k as keyof typeof t.discarded])}/>)}<Stat label="폐기 합계" value={n(t.discardedTokens)}/><Stat label="미연결" value={n(t.unlinkedTokens)}/><Stat label="토큰 미보고 실행(건)" value={n(t.unknownTokenRuns)}/><Stat label="다른 실행 종류(브리프·조사·학습)" value={n(t.otherKindTokens)}/></div>;
}
function KappaTable({rows}:{rows:CriterionKappaRow[]}){
 return <div className="quality-table"><Table aria-label="기준별 판정 보정(κ)"><TableCaption>사람의 기준별 판정(통과·수정)과 판정 시점 AI 품질 검수 상태(통과·수정·자료 필요)의 일치도(Cohen&apos;s κ)입니다. AI의 &apos;자료 필요&apos;는 불일치로 세고, 묶은 κ는 &apos;자료 필요&apos;를 &apos;수정&apos;으로 묶은 보조 값입니다. 라벨 {MIN_KAPPA_N}건 미만은 보정 불가이며 κ는 자동 판정 기준이 아닙니다.</TableCaption>
  <TableHeader><TableRow><TableHead>기준</TableHead><TableHead className="num">라벨 n</TableHead><TableHead className="num">일치율</TableHead><TableHead>κ</TableHead><TableHead className="num">묶은 κ</TableHead></TableRow></TableHeader>
  <TableBody>{rows.map(r=><TableRow key={r.criterion}><TableCell>{r.label}</TableCell><TableCell className="num">{n(r.n)}</TableCell><TableCell className={'num'+(r.agreement===null?' quality-dim':'')}>{agreementText(r)}</TableCell><TableCell className={r.status==='ok'?'':'quality-dim'}>{kappaText(r)}</TableCell><TableCell className={'num'+(r.kappaCollapsed===null?' quality-dim':'')}>{r.kappaCollapsed===null?'—':r.kappaCollapsed.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table></div>;
}
function Trend({s}:{s:ConsoleSummary}){
 return <div className="quality-table"><Table aria-label="주간 추이"><TableHeader><TableRow><TableHead>주(한국 시간)</TableHead>{['AI 작업물(이전 버전 포함)','1차 승인율','폐기 토큰','회의 완주율'].map(h=><TableHead key={h} className="num">{h}</TableHead>)}</TableRow></TableHeader>
  <TableBody>{s.weeks.map(w=><TableRow key={w.week}><TableCell>{w.week} <small className="quality-dim">{weekDays(w)}</small></TableCell><TableCell className="num">{n(w.artifacts)}</TableCell><TableCell className="num">{rateText(w.firstPassRate,w.approvedFirst,w.n)}</TableCell><TableCell className="num">{n(w.discardedTokens)}</TableCell><TableCell className="num">{meetingRate(w.meetings)}</TableCell></TableRow>)}</TableBody></Table></div>;
}
function Summary({data}:{data:ConsoleData}){
 const s=data.summary,m=s.meetings,empty=['decisions','artifacts','history','usage','meetings','gradings'].every(k=>!data.read[k]);
 return <>
  {data.partial&&<p className="quality-partial" role="status">일부만 집계: {data.partial.kinds.map(k=>kindNames[k]||k).join('·')} 기록이 {n(data.partial.limit)}건을 넘어 최근 {n(data.partial.limit)}건만 셌습니다. 기간을 줄이면 전부 셉니다.</p>}
  <p className="subtle-note">{data.period.from} ~ {data.period.to} ({data.period.days}일, 한국 시간) · 읽은 기록(기간 밖 판정 이력 포함): {Object.entries(kindNames).map(([k,label])=>`${label} ${n(data.read[k])}`).join(' · ')}</p>
  {empty?<p className="subtle-note">아직 이 기간에 집계할 기록이 없습니다. AI 작업물을 승인하거나 수정 요청하면 여기에 쌓입니다.</p>:<>
   <section><h3>한눈에 보기</h3><Totals s={s}/></section>
   <section><h3>역할 × 스킬·프롬프트 버전 × 보고 모델</h3><Rows s={s}/></section>
   <section><h3>사람 판정 사유</h3><Reasons s={s}/></section>
   <section><h3>폐기 토큰</h3><p className="subtle-note">쓰이지 않은 AI 작업물의 사용량입니다. 작업물·회의와 잇지 못한 사용량은 미연결로 따로 셉니다.</p><Discards s={s}/></section>
   <section><h3>회의 완주율</h3><p>시작 {n(m.started)}건 · 완료 {n(m.completed)} · 실패 {n(m.failed)} · 취소 {n(m.cancelled)} · 진행 중 {n(m.inProgress)} · 완주율 {meetingRate(m)}</p></section>
   {s.failedGraders.length>0&&<section><h3>자주 실패한 채점기</h3><ul className="quality-chips">{s.failedGraders.map(g=><li key={g.id}>{g.id} {g.count}</li>)}</ul></section>}
  </>}
  <section><h3>판정 보정(κ)</h3><KappaTable rows={data.kappa}/></section>
  {!empty&&s.weeks.length>0&&<section><h3>주간 추이</h3><Trend s={s}/></section>}
 </>;
}
export function QualityConsolePanel({open,onClose,campaigns}:{open:boolean;onClose:()=>void;campaigns:Campaign[]}){
 const [data,setData]=useState<ConsoleData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[range,setRange]=useState({from:'',to:'',campaignId:''}),[week,setWeek]=useState(''),[busy,setBusy]=useState(false),[digestError,setDigestError]=useState('');
 // 조회는 화면에 보이는 기간으로 보낸다(바꾸지 않은 칸은 지난 조회의 기간). 다이제스트는 마지막으로 조회에 적용된 캠페인을 쓴다.
 const shown={from:range.from||data?.period.from||'',to:range.to||data?.period.to||'',campaignId:range.campaignId};
 const query=new URLSearchParams(Object.entries(shown).filter(([,v])=>v)).toString();
 const load=useCallback(async(q:string)=>{
  setLoading(true);
  try{const next=await consoleData(q);setData(next);setWeek(w=>w||next.digestWeek);setError('')}catch(e){setError(e instanceof Error?e.message:'품질 지표를 불러오지 못했습니다.')}finally{setLoading(false)}
 },[]);
 // 시트를 처음 열 때 기본 기간(최근 28일)으로 읽는다. 오류 뒤 닫았다 다시 열면 다시 읽는다.
 useEffect(()=>{
  if(!open||data)return;
  let disposed=false;
  void consoleData('').then(next=>{if(!disposed){setData(next);setWeek(w=>w||next.digestWeek);setError('')}}).catch(e=>{if(!disposed)setError(e instanceof Error?e.message:'품질 지표를 불러오지 못했습니다.')}).finally(()=>{if(!disposed)setLoading(false)});
  return()=>{disposed=true};
 },[open,data]);
 async function digest(){
  setBusy(true);setDigestError('');
  try{await downloadDigest(new URLSearchParams({...(week?{week}:{}),...(data?.campaignId?{campaignId:data.campaignId}:{})}).toString())}catch(e){setDigestError(e instanceof Error?e.message:'주간 다이제스트를 받지 못했습니다.')}finally{setBusy(false)}
 }
 return <Sheet open={open} onOpenChange={v=>{if(!v)onClose()}}><SheetContent className="quality-console-sheet"><SheetHeader><SheetTitle>품질 콘솔</SheetTitle><SheetDescription>역할·스킬·프롬프트 버전·보고 모델별 1차 승인율, 사람 판정 사유, 폐기 토큰, 회의 완주율과 판정 보정(κ)을 모델 호출 없이 집계합니다.</SheetDescription></SheetHeader>
  <div className="quality-console">
   <AdminOnly owner><QualityOperationsPanel campaigns={campaigns}/></AdminOnly>
   <p className="notice">{data?.notice||'기록을 LLM 없이 센 집계입니다. 자동 판정이 아니며 작업물을 합격·불합격 처리하지 않습니다.'}</p>
   <form className="quality-toolbar" onSubmit={e=>{e.preventDefault();void load(query)}}>
    <label>시작일(한국 시간)<Input type="date" value={shown.from} onChange={e=>setRange(r=>({...r,from:e.target.value}))}/></label>
    <label>종료일<Input type="date" value={shown.to} onChange={e=>setRange(r=>({...r,to:e.target.value}))}/></label>
    <label>캠페인<NativeSelect aria-label="품질 콘솔 캠페인" value={range.campaignId} onChange={e=>setRange(r=>({...r,campaignId:e.target.value}))}><NativeSelectOption value="">전체 캠페인</NativeSelectOption>{campaigns.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>
    <Button type="submit" variant="outline" disabled={loading}><RefreshCw/>조회</Button>
   </form>
   <p className="subtle-note">기간은 최대 180일이고 기본은 오늘까지 최근 28일입니다. 비율은 표본 {MIN_SAMPLE}건 미만이면 표본 부족으로 표시합니다.</p>
   {error&&<div className="load-error" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={()=>void load(query)}><RefreshCw/>다시 시도</Button></div>}
   {loading&&!data?<p className="loading-line" role="status">품질 지표 불러오는 중…</p>:data&&<Summary data={data}/>}
   <section><h3>AI 심사 보정 라벨</h3><AdminOnly owner note="보정 라벨은 워크스페이스 소유자만 매깁니다(평가 출력은 소유자 전용)."><JudgeLabelPanel/></AdminOnly></section>
   <section><h3><ClipboardCheck className="inline size-4"/> 주간 다이제스트</h3><p className="subtle-note">같은 집계로 만든 한국어 마크다운(지표 표·전주 대비·표본 부족 표시)입니다. 기본은 지난주(ISO 주, 한국 시간)이고 캠페인 범위는 마지막으로 조회한 범위를 따릅니다.</p>
    <div className="quality-toolbar"><label>주(YYYY-Www)<Input type="week" aria-label="다이제스트 주" value={week} onChange={e=>setWeek(e.target.value)} placeholder="2026-W38"/></label><Button type="button" disabled={busy} onClick={()=>void digest()}><Download/>주간 다이제스트 받기</Button></div>
    {digestError&&<p className="form-error" role="alert">{digestError} <Button variant="outline" size="sm" onClick={()=>void digest()}><RefreshCw/>다시 시도</Button></p>}
   </section>
  </div></SheetContent></Sheet>;
}
