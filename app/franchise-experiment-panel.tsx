'use client';
// 가맹 모집 화면 '유입·비용' 탭의 소재 실험 선별(트랙 R R6d-2). 읽는 법 문구('플랫폼 보고, 원장 리드 아님'이 첫 줄)와 면책을 숫자보다 먼저 보인다.
// 대표·관리자는 기간 시작 전에 가설·바꾼 변수·판정 기준을 적고(계획), 기간 중·뒤에 두 판의 플랫폼 보고 수치를 입력하고(결과), 실험을 취소한다. 직원은 읽기만 한다.
// 판정은 서버(lib/franchise-experiment.ts, lib/viral-stats.ts 무수정)가 한다. 확인 층(원장 코드 귀속 리드·설명회 참석)은 건수만, 20건 미만이면 비율을 숨긴다. COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {RECRUITMENT_CHANNELS} from '@/lib/franchise-recruitment';
import {franchiseGet,franchisePost,problemOf,messageOf,ProblemBox,Disclaimer,Section,type Problem} from './franchise-common';

type Arm={assetId:string;version:number};
type Counts={denominator:number;numerator:number};
type Look={result:{control:Counts;treatment:Counts;comparable:boolean;observedUntil:string};assessment:{status:string;label:string;controlRate:number|null;treatmentRate:number|null;lift:number|null;reasons:string[]};
 stats:{probBetter:number;liftLow:number|null;liftHigh:number|null;recommendation:string;warning:{message:string}|null}|null;recordedAt:string};
type LedgerArm={leads:number;attended:number;attendedPerLead:number|null;qualified:null};
type Experiment={id:string;status:'planned'|'evaluated'|'cancelled';version:number;channelLabel:string;metric:{label:string;numerator:string;denominator:string};
 plan:{variable:string;hypothesis:string;control:Arm;treatment:Arm;minSample:number;minHours:number;minLift:number;period:{from:string;to:string}};latest:Look|null;looks:number;ledger:{control:LedgerArm;treatment:LedgerArm;minForRate:number;qualifiedNote:string}};
export type ExperimentsView={enabled:boolean;role:string;experiments:Experiment[];assets:{id:string;version:number;type:string}[];notes:string[];metrics:Record<string,{label:string}>;minSample:number;today:string;platformNote:string;disclaimer:string};

const STATUS_LABELS={planned:'계획됨',evaluated:'결과 입력됨',cancelled:'취소됨'} as const;
const RECOMMENDATION_LABELS:Readonly<Record<string,string>>={adopt:'채택 권고',stop:'중단 권고',inconclusive:'판단 보류 권고'};
export const CANCEL_EXPERIMENT_CONFIRM='이 소재 실험을 취소합니다. 입력한 결과는 기록으로 남고 더 입력할 수 없습니다.';
const pct=(v:number|null)=>v===null?'-':`${(v*100).toFixed(2)}%`;
const armLabel=(a:Arm)=>`${a.assetId} 판 ${a.version}`;
const addDaysTo=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const numberOf=(v:string)=>v.trim()===''?NaN:Number(v);

export function FranchiseExperiments({brandId,admin}:{brandId:string;admin:boolean}){
 const [view,setView]=useState<ExperimentsView|null>(null),[error,setError]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const v=await franchiseGet<ExperimentsView>({view:'experiments',brandId},signal);if(!signal?.aborted){setView(v);setError('')}}
  catch(e){if(!signal?.aborted)setError(messageOf(e))}
 },[brandId]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>{if(!c.signal.aborted)return load(c.signal)});return ()=>c.abort()},[load]);
 return <Section title="소재 실험 선별">
  {view&&<ul className="franchise-list" aria-label="소재 실험 읽는 법">{view.notes.map(n=><li key={n}>{n}</li>)}</ul>}
  <Disclaimer/>
  {error&&<p role="alert" className="load-error">{error}</p>}
  {!view?!error&&<p role="status">소재 실험을 불러오고 있습니다.</p>:<>
   {admin&&view.enabled&&<PlanForm brandId={brandId} view={view} onDone={()=>void load()}/>}
   {!view.experiments.length&&<p className="subtle-note">아직 소재 실험이 없습니다.</p>}
   {view.experiments.map(e=><ExperimentCard key={e.id} brandId={brandId} e={e} admin={admin} enabled={view.enabled} today={view.today} platformNote={view.platformNote} onDone={()=>void load()}/>)}
  </>}
 </Section>;
}

function PlanForm({brandId,view,onDone}:{brandId:string;view:ExperimentsView;onDone:()=>void}){
 const tomorrow=addDaysTo(view.today,1),first=view.assets[0],second=view.assets[1];
 const [f,setF]=useState({channel:'portal',metric:'ctr',variable:'',hypothesis:'',control:first?`${first.id}#${first.version}`:'',treatment:second?`${second.id}#${second.version}`:'',minSample:String(view.minSample),minHours:'72',minLift:'10',from:tomorrow,to:addDaysTo(tomorrow,13)});
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null),[message,setMessage]=useState('');
 const set=(patch:Partial<typeof f>)=>setF({...f,...patch});
 const arm=(v:string):Arm=>{const [assetId,version]=v.split('#');return {assetId,version:Number(version)}};
 async function submit(){
  setBusy(true);setProblem(null);setMessage('');
  const r=await franchisePost('experiment_plan',{brandId,channel:f.channel,metric:f.metric,variable:f.variable,hypothesis:f.hypothesis,control:arm(f.control),treatment:arm(f.treatment),
   minSample:numberOf(f.minSample),minHours:numberOf(f.minHours),minLift:numberOf(f.minLift),period:{from:f.from,to:f.to}});
  setBusy(false);
  if(r.status===200){setMessage('소재 실험 계획을 적었습니다. 기간이 시작되면 결과를 입력할 수 있습니다.');setF({...f,variable:'',hypothesis:''});onDone()}else setProblem(problemOf(r));
 }
 const options=view.assets.map(a=><NativeSelectOption key={`${a.id}#${a.version}`} value={`${a.id}#${a.version}`}>{`${a.id} 판 ${a.version} (${a.type})`}</NativeSelectOption>);
 return <form autoComplete="off" className="franchise-box form-stack" aria-label="소재 실험 계획" onSubmit={e=>{e.preventDefault();void submit()}}>
  <p className="subtle-note">가설과 판정 기준은 기간 시작 전에 적고 바꾸지 않습니다. 두 판은 승인된 같은 유형의 모집 자료여야 합니다.</p>
  <label className="field"><span>모집 채널</span><NativeSelect value={f.channel} onChange={e=>set({channel:e.target.value})}>{RECRUITMENT_CHANNELS.map(c=><NativeSelectOption key={c.key} value={c.key}>{c.label}</NativeSelectOption>)}</NativeSelect></label>
  <label className="field"><span>주지표</span><NativeSelect value={f.metric} onChange={e=>set({metric:e.target.value})}>{Object.entries(view.metrics).map(([k,m])=><NativeSelectOption key={k} value={k}>{m.label}</NativeSelectOption>)}</NativeSelect></label>
  <label className="field"><span>바꾼 변수</span><Input value={f.variable} maxLength={200} autoComplete="off" onChange={e=>set({variable:e.target.value})}/></label>
  <label className="field"><span>가설</span><Textarea value={f.hypothesis} maxLength={1000} autoComplete="off" onChange={e=>set({hypothesis:e.target.value})}/></label>
  <label className="field"><span>대조안</span><NativeSelect value={f.control} onChange={e=>set({control:e.target.value})}>{options}</NativeSelect></label>
  <label className="field"><span>실험안</span><NativeSelect value={f.treatment} onChange={e=>set({treatment:e.target.value})}>{options}</NativeSelect></label>
  <label className="field"><span>팔당 최소 표본</span><Input type="number" min={view.minSample} value={f.minSample} onChange={e=>set({minSample:e.target.value})}/></label>
  <label className="field"><span>최소 관찰 시간(시간)</span><Input type="number" min={1} value={f.minHours} onChange={e=>set({minHours:e.target.value})}/></label>
  <label className="field"><span>목표 개선율(%)</span><Input type="number" min={0} step="any" value={f.minLift} onChange={e=>set({minLift:e.target.value})}/></label>
  <label className="field"><span>기간 시작</span><Input type="date" value={f.from} onChange={e=>set({from:e.target.value})}/></label>
  <label className="field"><span>기간 끝</span><Input type="date" value={f.to} onChange={e=>set({to:e.target.value})}/></label>
  <Button type="submit" disabled={busy||!f.variable.trim()||!f.hypothesis.trim()||!f.control||!f.treatment}>실험 계획 적기</Button>
  <ProblemBox problem={problem}/>
  {message&&<p role="status">{message}</p>}
 </form>;
}

function ExperimentCard({brandId,e,admin,enabled,today,platformNote,onDone}:{brandId:string;e:Experiment;admin:boolean;enabled:boolean;today:string;platformNote:string;onDone:()=>void}){
 const [problem,setProblem]=useState<Problem|null>(null),[busy,setBusy]=useState(false);
 async function cancel(){
  if(!window.confirm(CANCEL_EXPERIMENT_CONFIRM))return;
  setBusy(true);setProblem(null);
  const r=await franchisePost('experiment_cancel',{brandId,experimentId:e.id,version:e.version});
  setBusy(false);if(r.status===200)onDone();else setProblem(problemOf(r));
 }
 const l=e.latest,rateOf=(a:LedgerArm)=>a.attendedPerLead===null?`표본 부족(n<${e.ledger.minForRate})`:pct(a.attendedPerLead);
 return <article className="franchise-box" aria-label={`소재 실험 ${e.plan.variable}`}>
  <h4>{`${e.channelLabel} · ${e.metric.label} · ${e.plan.variable}`} <small className="status">{STATUS_LABELS[e.status]}</small></h4>
  <p>{`가설: ${e.plan.hypothesis}`}</p>
  <p className="subtle-note">{`기간 ${e.plan.period.from} ~ ${e.plan.period.to} · 대조안 ${armLabel(e.plan.control)} · 실험안 ${armLabel(e.plan.treatment)} · 팔당 최소 표본 ${e.plan.minSample} · 최소 관찰 ${e.plan.minHours}시간 · 목표 개선율 ${e.plan.minLift}%`}</p>
  {l&&<div aria-label="최근 결과">
   <p className="notice" role="note">{platformNote}</p>
   <p>{`${e.metric.label}: 대조안 ${pct(l.assessment.controlRate)} (${l.result.control.numerator}/${l.result.control.denominator}) · 실험안 ${pct(l.assessment.treatmentRate)} (${l.result.treatment.numerator}/${l.result.treatment.denominator}) · 측정 끝 ${l.result.observedUntil}`}</p>
   <p><b>{l.assessment.label}</b>{l.stats&&` · 실험안이 나을 확률 ${(l.stats.probBetter*100).toFixed(1)}% · ${RECOMMENDATION_LABELS[l.stats.recommendation]??l.stats.recommendation}`}</p>
   {l.assessment.reasons.length>0&&<ul className="franchise-warnings">{l.assessment.reasons.map(x=><li key={x}>{x}</li>)}</ul>}
   {l.stats?.warning&&<p className="franchise-warnings">{l.stats.warning.message}</p>}
   <p className="subtle-note">{`결과 입력 ${e.looks}회`}</p>
  </div>}
  <table className="franchise-table" aria-label="확인 층(원장)">
   <thead><tr><th>판</th><th>원장 리드(코드 귀속)</th><th>설명회 참석</th><th>참석 ÷ 리드</th><th>적격 리드</th></tr></thead>
   <tbody>{(['control','treatment'] as const).map(k=><tr key={k}><td>{k==='control'?'대조안':'실험안'}</td><td>{e.ledger[k].leads}</td><td>{e.ledger[k].attended}</td><td>{rateOf(e.ledger[k])}</td><td>기록 없음</td></tr>)}</tbody>
  </table>
  <p className="subtle-note">{e.ledger.qualifiedNote}</p>
  {admin&&enabled&&e.status!=='cancelled'&&today>=e.plan.period.from&&<ResultForm brandId={brandId} e={e} today={today} onDone={onDone}/>}
  {admin&&e.status!=='cancelled'&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void cancel()}>실험 취소</Button>}
  <ProblemBox problem={problem}/>
 </article>;
}

function ResultForm({brandId,e,today,onDone}:{brandId:string;e:Experiment;today:string;onDone:()=>void}){
 const until=today<e.plan.period.to?today:e.plan.period.to;
 const [f,setF]=useState({cd:'',cn:'',td:'',tn:'',comparable:false,observedUntil:until});
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState<Problem|null>(null);
 const set=(patch:Partial<typeof f>)=>setF({...f,...patch});
 async function submit(){
  setBusy(true);setProblem(null);
  const r=await franchisePost('experiment_result',{brandId,experimentId:e.id,version:e.version,control:{denominator:numberOf(f.cd),numerator:numberOf(f.cn)},treatment:{denominator:numberOf(f.td),numerator:numberOf(f.tn)},comparable:f.comparable,observedUntil:f.observedUntil});
  setBusy(false);if(r.status===200)onDone();else setProblem(problemOf(r));
 }
 return <form autoComplete="off" className="franchise-box form-stack" aria-label="소재 실험 결과 입력" onSubmit={ev=>{ev.preventDefault();void submit()}}>
  <p className="subtle-note">{`플랫폼 관리 화면의 ${e.metric.denominator}(분모)와 ${e.metric.numerator}(반응) 수를 판마다 적습니다.`}</p>
  <label className="field"><span>{`대조안 ${e.metric.denominator}`}</span><Input type="number" min={0} value={f.cd} onChange={x=>set({cd:x.target.value})}/></label>
  <label className="field"><span>{`대조안 ${e.metric.numerator}`}</span><Input type="number" min={0} value={f.cn} onChange={x=>set({cn:x.target.value})}/></label>
  <label className="field"><span>{`실험안 ${e.metric.denominator}`}</span><Input type="number" min={0} value={f.td} onChange={x=>set({td:x.target.value})}/></label>
  <label className="field"><span>{`실험안 ${e.metric.numerator}`}</span><Input type="number" min={0} value={f.tn} onChange={x=>set({tn:x.target.value})}/></label>
  <label className="field"><span>측정 끝 날짜</span><Input type="date" value={f.observedUntil} onChange={x=>set({observedUntil:x.target.value})}/></label>
  <label className="franchise-inline"><input type="checkbox" checked={f.comparable} onChange={x=>set({comparable:x.target.checked})}/>두 판의 대상·기간·배포 조건이 비교 가능합니다</label>
  <Button type="submit" disabled={busy||[f.cd,f.cn,f.td,f.tn].some(v=>v.trim()==='')}>결과 입력</Button>
  <ProblemBox problem={problem}/>
 </form>;
}
