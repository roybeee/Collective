'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {api} from '@/lib/client';
import {metricSummary,money,type Campaign,type Metric} from '@/lib/agency';
import {DataTable,sortNumber} from '@/components/app/data-table';
import {TrendBars} from '@/components/app/trend-bars';
import {notifySaved} from '@/lib/ui/notify';

type CampaignChoice=Pick<Campaign,'id'|'title'>;
type MetricDialogProps={open:boolean;campaigns:CampaignChoice[];onClose:()=>void;onSaved:()=>Promise<void>;initial?:Metric};
const valueFields=[['revenue','순매출 (원)'],['variableCosts','상품 원가·변동비 (원)'],['adSpend','매체비 (원)'],['productionCost','제작비 (원)'],['orders','주문 수']] as const;
const amount=(value:number|null)=>value===null?'자료 필요':money(value);

const balanceNote='잔액 = 순매출 − 변동비 − 매체비 − 제작비. 고정비와 미기록 비용을 포함한 전체 이익이 아닙니다. 비용 미확인은 0이 아닌 미확인으로 둡니다.';
// 성과 기록이 2개 이상이면 기간별 표와 순매출 추세로 한눈에 비교한다(UX-PLAN-3 7차원, 평가 7회차 '반복 카드'). 계산식 안내는 한 번만 보인다.
export function MetricSummary({metrics}:{metrics:readonly Metric[]}){
 const rows=[...metrics].sort((a,b)=>(a.periodStart??a.period).localeCompare(b.periodStart??b.period));
 const num=(v:number|null)=>v===null?'자료 필요':money(v);
 return <section className="metric-summary" aria-label="기간별 성과 비교">
  <TrendBars title="기간별 순매출 추세(성과 기록 기준)" points={rows.map(m=>({label:m.periodStart??m.period,value:m.revenue,display:m.revenue===null?'미확인':money(m.revenue)}))}/>
  <DataTable caption="기간별 성과" rows={rows} rowKey={m=>m.id} csvName="campaign-metrics" columns={[
   {label:'기간',cell:m=>m.periodStart&&m.periodEnd?`${m.periodStart} ~ ${m.periodEnd}`:m.period,csv:m=>m.period},
   {label:'순매출',cell:m=>num(m.revenue),sort:m=>sortNumber(m.revenue),csv:m=>m.revenue??'',align:'right'},
   {label:'주문 수',cell:m=>m.orders===null?'자료 필요':`${m.orders.toLocaleString('ko-KR')}건`,sort:m=>sortNumber(m.orders),csv:m=>m.orders??'',align:'right'},
   {label:'비용 차감 잔액',cell:m=>num(metricSummary(m).net),sort:m=>sortNumber(metricSummary(m).net),csv:m=>metricSummary(m).net??'',align:'right'},
   {label:'매체비 대비 매출',cell:m=>{const r=metricSummary(m).roas;return r===null?'자료 필요':r.toFixed(2)+'배'},sort:m=>sortNumber(metricSummary(m).roas),csv:m=>metricSummary(m).roas??'',align:'right'},
  ]}/>
  <p className="subtle-note">{balanceNote}</p>
 </section>;
}

// 같은 캠페인·같은 범위에서 바로 앞 기간의 기록(출처·범위 기록끼리). 없으면 null.
export function previousMetric(m:Metric,all:Metric[]){const start=m.periodStart??m.period;return all.filter(x=>x.id!==m.id&&x.campaignId===m.campaignId&&x.schemaVersion===2&&(x.scope??'')===(m.scope??'')&&(x.periodStart??x.period)<start).sort((a,b)=>(b.periodStart??b.period).localeCompare(a.periodStart??a.period))[0]??null;}
// 직전 기간 대비 순매출 변화율. 어느 한쪽이 미확인이거나 직전이 0이면 비교하지 않는다.
const changeText=(m:Metric,prev:Metric|null)=>{if(!prev)return '직전 기록 없음';if(m.revenue===null||prev.revenue===null||prev.revenue===0)return '비교 자료 필요';const r=(m.revenue-prev.revenue)/prev.revenue*100;return `${r>=0?'+':''}${r.toFixed(1)}%`;};
export function MetricCard({metric:m,onSaved,compact=false,all=[]}:{metric:Metric;onSaved?:()=>Promise<void>;compact?:boolean;all?:Metric[]}){
 const summary=metricSummary(m),[editing,setEditing]=useState(false),prev=m.schemaVersion===2?previousMetric(m,all):null;
 return <div className="metric-card">
  <div className="section-heading"><h3>{m.period}</h3><span className="mode-pill">{m.schemaVersion===2?'출처·범위 기록':'기존 기록 · 비교 조건 미확인'}</span></div>
  <div className="metric-grid">{[['순매출',amount(m.revenue)],['기록 비용 차감 잔액',amount(summary.net)],m.schemaVersion===2?['직전 기간 대비 순매출',changeText(m,prev)]:['기준 대비 관찰 변화',amount(summary.observedChange)],['매체비 대비 매출',summary.roas===null?'자료 필요':summary.roas.toFixed(2)+'배']].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
  {!compact&&<p className="subtle-note">{balanceNote}</p>}
  {m.source&&<p>출처: {m.source}<br/>집계 정의: {m.definition}</p>}{m.notes&&<p className="metric-note">{m.notes}</p>}
  {onSaved&&<><Button variant="outline" size="sm" onClick={()=>setEditing(true)}>기록 수정</Button><MetricDialog open={editing} initial={m} campaigns={[{id:m.campaignId,title:'현재 캠페인'}]} onClose={()=>setEditing(false)} onSaved={onSaved}/></>}
 </div>;
}

export function MetricDialog(props:MetricDialogProps){
 return <Dialog open={props.open} onOpenChange={open=>{if(!open)props.onClose()}}><DialogContent className="wide-dialog"><DialogHeader><DialogTitle>{props.initial?'성과 기록 수정':'실제 성과 기록'}</DialogTitle><DialogDescription>확인한 값만 입력하세요. 빈 값은 미확인으로 보존되며, 0은 실제로 확인한 0입니다.</DialogDescription></DialogHeader>{props.open&&<MetricForm key={props.initial?.id||'new'} {...props}/>}</DialogContent></Dialog>;
}

function MetricForm({campaigns,onClose,onSaved,initial}:MetricDialogProps){
 const [initialVersion]=useState(initial?.version||1);
 const [fields,setFields]=useState<Record<string,string>>(()=>({
  campaignId:initial?.campaignId||campaigns[0]?.id||'',periodStart:initial?.periodStart||'',periodEnd:initial?.periodEnd||'',scope:initial?.scope||'',source:initial?.source||'',definition:initial?.definition||'',method:initial?.method||'manual',notes:initial?.notes||'',
  ...Object.fromEntries(valueFields.map(([key])=>[key,initial?.[key]==null?'':String(initial[key])])),
 }));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const update=(key:string,value:string)=>setFields(current=>({...current,[key]:value}));
 async function save(event:React.FormEvent){
  event.preventDefault();setBusy(true);setError('');
  try{
   await api('save_metric',{...fields,id:initial?.id,version:initialVersion,schemaVersion:2,baselineContribution:null,...Object.fromEntries(valueFields.map(([key])=>[key,fields[key]===''?null:Number(fields[key])]))});
   await onSaved();notifySaved('성과 기록을 저장했습니다.');onClose();
  }catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.')}finally{setBusy(false)}
 }
 return <form className="form-stack" onSubmit={save}>
  <label className="field"><span>캠페인</span><NativeSelect value={fields.campaignId} disabled={!!initial} onChange={e=>update('campaignId',e.target.value)}>{campaigns.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>
  <div className="form-two">{[['periodStart','측정 시작일'],['periodEnd','측정 종료일']].map(([key,label])=><label className="field" key={key}><span>{label}</span><Input required type="date" value={fields[key]} onChange={e=>update(key,e.target.value)}/></label>)}</div>
  {([['scope','비교 범위 (매장·계정·대상)'],['source','자료 출처'],['definition','집계 정의 (시간대·환불·부가세·고객군)']] as const).map(([key,label])=><label className="field" key={key}><span>{label}</span><Input required value={fields[key]} onChange={e=>update(key,e.target.value)}/></label>)}
  <label className="field"><span>수집 방식</span><NativeSelect value={fields.method} onChange={e=>update('method',e.target.value)}><NativeSelectOption value="manual">직접 입력</NativeSelectOption><NativeSelectOption value="export">원자료 내보내기</NativeSelectOption></NativeSelect></label>
  <div className="form-two">{valueFields.map(([key,label])=><label className="field" key={key}><span>{label}</span><Input type="number" min="0" max="1000000000000" step={key==='orders'?'1':'any'} value={fields[key]} placeholder="미확인" onChange={e=>update(key,e.target.value)}/></label>)}</div>
  <label className="field"><span>측정 방법과 메모</span><Textarea value={fields.notes} onChange={e=>update('notes',e.target.value)}/></label>
  <p className="notice">같은 캠페인·비교 범위의 기간은 겹칠 수 없습니다. 순매출에 반영한 할인·환불을 비용으로 다시 차감하지 마세요. 전후 차이는 인과 효과가 아닙니다.</p>
  {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button disabled={busy||!fields.campaignId} disabledReason={!fields.campaignId?'캠페인을 먼저 고르세요.':undefined}>{busy?'저장 중…':'성과 저장'}</Button></div>
 </form>;
}
