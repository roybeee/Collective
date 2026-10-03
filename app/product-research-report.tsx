'use client';
// 주간 MD 리포트: 이번 주(최근 7일) 신규·모멘텀 높음·낮음·제외 후보, 지난 결정의 성적표, 가중치 판 백테스트(정밀도@k·순위 상관·기준선).
// 지난주 점수와 결정 뒤 실제 결과는 화면 응답에 아직 없어, 상승·하락은 이번 주 모멘텀 점수로 나누고 결과는 '관측 중'으로 적는다.
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {CardButton} from '@/components/app/card-button';
import {DataTable,type DataColumn} from '@/components/app/data-table';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {Note} from '@/components/app/note';
import {Segmented} from '@/components/app/segmented';
import {date,dateTime} from '@/lib/format';
import type {BacktestResult} from '@/lib/product-research/types';
import {categoryLabel,decisionLabels,editReason,score,subValue,type Act,type Product,type View} from './product-research-shared';
import {Trend} from './product-research-radar';
import s from './product-research.module.css';

const WEEK=7*86400000,LIST=10;
const baselineLabels:Record<BacktestResult['baselines'][number]['name'],string>={current_top:'현재 1위',momentum_only:'모멘텀만',random:'무작위'};
const atK=(list:{k:number;value:number|null}[],k:number)=>list.find(x=>x.k===k)?.value??null;
const ratio=(v:number|null)=>v===null?'미확인':v.toFixed(2);
const bestBaseline=(b:BacktestResult,k:number)=>b.baselines.reduce<{name:string;value:number}|null>((best,x)=>{const v=atK(x.precisionAtK,k);return v!==null&&(!best||v>best.value)?{name:baselineLabels[x.name],value:v}:best},null);

export function ReportTab({view,act,busy,onOpen}:{view:View;act:Act;busy:boolean;onOpen:(id:string)=>void}){
 const [since]=useState(()=>Date.now()-WEEK);
 const recent=(at:string|null|undefined)=>!!at&&Date.parse(at)>=since;
 const momentum=(p:Product)=>subValue(p.score,'momentum');
 const fresh=view.products.filter(p=>recent(p.createdAt));
 const rising=view.products.filter(p=>(momentum(p)??-1)>=60).sort((a,b)=>(momentum(b)??0)-(momentum(a)??0)).slice(0,LIST);
 const falling=view.products.filter(p=>{const m=momentum(p);return m!==null&&m<=40}).sort((a,b)=>(momentum(a)??0)-(momentum(b)??0)).slice(0,LIST);
 const rejected=view.products.filter(p=>(p.decision?.status==='rejected'&&recent(p.decision.decidedAt))||(!p.decision&&p.score?.tier==='reject'));
 const decided=view.products.filter(p=>!!p.decision).sort((a,b)=>b.decision!.decidedAt.localeCompare(a.decision!.decidedAt));
 const decisionColumns:DataColumn<Product>[]=[
  {label:'후보',cell:p=><CardButton className={s.nameLink} onClick={()=>onOpen(p.id)}>{p.name}</CardButton>,sort:p=>p.name,csv:p=>p.name},
  {label:'결정',cell:p=>decisionLabels[p.decision!.status],sort:p=>decisionLabels[p.decision!.status],csv:p=>decisionLabels[p.decision!.status]},
  {label:'결정일',cell:p=>date(p.decision!.decidedAt),sort:p=>p.decision!.decidedAt,csv:p=>date(p.decision!.decidedAt)},
  {label:'사유',cell:p=>p.decision!.reason,csv:p=>p.decision!.reason},
  {label:'결정 때 점수표',cell:p=>p.score&&p.score.id===p.decision!.scoreCardId?`총점 ${score(p.score)}`:'뒤에 다시 계산됨',csv:p=>p.score&&p.score.id===p.decision!.scoreCardId?score(p.score):'뒤에 다시 계산됨'},
  {label:'지금 총점',cell:p=>score(p.score),sort:p=>p.score?.total??-1,csv:p=>score(p.score),align:'right'},
  {label:'이후 결과',cell:p=>p.decision!.handoff?'캠페인 시장 근거로 넘김, 판매 결과 관측 중':'관측 중',csv:p=>p.decision!.handoff?'캠페인 연결, 관측 중':'관측 중'},
 ];
 const backtests=[...view.backtests].sort((a,b)=>b.computedAt.localeCompare(a.computedAt));
 const backtestColumns:DataColumn<BacktestResult>[]=[
  {label:'가중치 판',cell:b=>b.weightsVersion,sort:b=>b.weightsVersion,csv:b=>b.weightsVersion},
  {label:'기준 시점',cell:b=>date(b.asOf),sort:b=>b.asOf,csv:b=>date(b.asOf)},
  {label:'관측 주',cell:b=>`${b.horizonWeeks}주`,sort:b=>b.horizonWeeks,csv:b=>b.horizonWeeks,align:'right'},
  {label:'후보 수',cell:b=>`${b.candidates}개`,sort:b=>b.candidates,csv:b=>b.candidates,align:'right'},
  {label:'정밀도@10',cell:b=>ratio(atK(b.precisionAtK,10)),sort:b=>atK(b.precisionAtK,10)??-1,csv:b=>atK(b.precisionAtK,10)??'',align:'right'},
  {label:'정밀도@20',cell:b=>ratio(atK(b.precisionAtK,20)),sort:b=>atK(b.precisionAtK,20)??-1,csv:b=>atK(b.precisionAtK,20)??'',align:'right'},
  {label:'순위 상관',cell:b=>ratio(b.spearman),sort:b=>b.spearman??-2,csv:b=>b.spearman??'',align:'right'},
  {label:'최고 기준선(정밀도@20)',cell:b=>{const x=bestBaseline(b,20);return x?`${x.name} ${x.value.toFixed(2)}`:'미확인'},csv:b=>{const x=bestBaseline(b,20);return x?`${x.name} ${x.value.toFixed(2)}`:''}},
  {label:'계산 시각',cell:b=>dateTime(b.computedAt),sort:b=>b.computedAt,csv:b=>dateTime(b.computedAt)},
 ];
 const [horizon,setHorizon]=useState<'4'|'8'|'12'>('12'),[threshold,setThreshold]=useState('20');
 const t=Number(threshold),runWhy=!view.canEdit?editReason:!(threshold.trim()&&t>0&&t<=500)?'정답 기준(상승률 %)을 0보다 큰 숫자로 쓰세요.':'';
 const run=()=>void act({action:'run_backtest',horizonWeeks:Number(horizon) as 4|8|12,labelThreshold:t},'백테스트를 실행했습니다.','저장된 시계열만 썼습니다. 결과는 아래 표에 있습니다.');
 return <section className={s.section} aria-labelledby="pr-report-title">
  <h2 id="pr-report-title" className={s.title}>주간 MD 리포트</h2>
  <p className={s.muted}><MetaLine items={[`기간 ${date(new Date(since).toISOString())}~${date(new Date().toISOString())}`,`후보 ${view.products.length}개`,`결정 ${decided.length}건`]}/></p>
  <div className={s.reportGrid}>
   <ReportList title="이번 주 새 후보" items={fresh} onOpen={onOpen} empty="이번 주 새로 생긴 후보는 없습니다."/>
   <ReportList title="모멘텀 높음(상승)" items={rising} onOpen={onOpen} empty="모멘텀 60 이상 후보는 없습니다." trend/>
   <ReportList title="모멘텀 낮음(하락)" items={falling} onOpen={onOpen} empty="모멘텀 40 이하 후보는 없습니다." trend/>
   <ReportList title="제외" items={rejected} onOpen={onOpen} empty="이번 주 제외한 후보는 없습니다."/>
  </div>
  <p className={s.muted}>지난주 점수가 화면 응답에 아직 없어 상승·하락은 이번 주 모멘텀 점수(60 이상, 40 이하)로 나눴습니다.</p>
  <h3 className={s.subtitle}>지난 결정 성적표</h3>
  {decided.length?<DataTable rows={decided} columns={decisionColumns} rowKey={p=>p.decision!.id} caption="지난 결정과 이후 결과" csvName="product-research-decisions" filterText={p=>[p.name,p.decision!.reason,categoryLabel(p.categoryId)].join(' ')}/>
   :<EmptyLine next="후보 목록이나 선정 위원회에서 첫 결정을 기록하세요.">기록한 결정이 아직 없습니다.</EmptyLine>}
  <h3 className={s.subtitle}>백테스트</h3>
  <Note>기준 시점에 점수를 고정하고 몇 주 뒤 실제로 오른 후보를 얼마나 맞혔는지 잽니다. 정밀도@20이 0.45 이상이고 최고 기준선보다 0.15 이상 높으면 목표에 닿습니다.</Note>
  <div className={s.toolbar}>
   <Segmented label="관측 기간" value={horizon} onChange={setHorizon} options={[{value:'4',label:'4주'},{value:'8',label:'8주'},{value:'12',label:'12주'}]}/>
   <label className={'field '+s.narrowField}><span>정답 기준(상승률 %)</span><Input type="number" min={1} inputMode="numeric" value={threshold} onChange={e=>setThreshold(e.target.value)}/></label>
   <Button type="button" variant="outline" disabled={busy||!!runWhy} disabledReason={runWhy} onClick={run}>백테스트 실행</Button>
  </div>
  {backtests.length?<DataTable rows={backtests} columns={backtestColumns} rowKey={b=>b.id} caption="가중치 판 백테스트 결과" csvName="product-research-backtests"/>
   :<EmptyLine next="위 '백테스트 실행'으로 저장된 시계열에서 첫 결과를 만드세요.">백테스트 결과가 아직 없습니다.</EmptyLine>}
  {backtests[0]&&<p className={s.muted}>정답 정의: {backtests[0].label}</p>}
 </section>;
}

function ReportList({title,items,onOpen,empty,trend=false}:{title:string;items:Product[];onOpen:(id:string)=>void;empty:string;trend?:boolean}){
 return <section className={s.reportCard} aria-label={title}><h4 className={s.cardTitle}>{title} <span className={s.muted}>{items.length}</span></h4>
  {items.length?<ul className={s.plainList}>{items.map(p=><li key={p.id}><CardButton className={s.nameLink} onClick={()=>onOpen(p.id)}>{p.name}</CardButton>{trend?<Trend value={subValue(p.score,'momentum')}/>:<small className={s.muted}><MetaLine items={[categoryLabel(p.categoryId),`총점 ${score(p.score)}`]}/></small>}</li>)}</ul>
   :<EmptyLine>{empty}</EmptyLine>}
 </section>;
}
