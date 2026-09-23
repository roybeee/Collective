'use client';
import {useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {api} from '@/lib/client';
import {metricSummary,money,type Campaign,type Metric} from '@/lib/agency';

type CampaignChoice=Pick<Campaign,'id'|'title'>;
type MetricDialogProps={open:boolean;campaigns:CampaignChoice[];onClose:()=>void;onSaved:()=>Promise<void>;initial?:Metric};
const valueFields=[['revenue','순매출 (원)'],['variableCosts','상품 원가·변동비 (원)'],['adSpend','매체비 (원)'],['productionCost','제작비 (원)'],['orders','주문 수']] as const;
const amount=(value:number|null)=>value===null?'자료 필요':money(value);

export function MetricCard({metric:m,onSaved}:{metric:Metric;onSaved?:()=>Promise<void>}){
 const summary=metricSummary(m),[editing,setEditing]=useState(false);
 return <div className="metric-card">
  <div className="section-heading"><h3>{m.period}</h3><span className="mode-pill">{m.schemaVersion===2?'출처·범위 기록':'기존 기록 · 비교 조건 미확인'}</span></div>
  <div className="metric-grid">{[['순매출',amount(m.revenue)],['기록 비용 차감 잔액',amount(summary.net)],['기준 대비 관찰 변화',m.schemaVersion===2?'비교 기록 필요':amount(summary.observedChange)],['매체비 대비 매출',summary.roas===null?'자료 필요':summary.roas.toFixed(2)+'배']].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
  <p className="subtle-note">잔액 = 순매출 − 변동비 − 매체비 − 제작비. 고정비와 미기록 비용을 포함한 전체 이익이 아닙니다. 비용 미확인은 0으로 계산하지 않습니다.</p>
  {m.source&&<p>출처: {m.source}<br/>집계 정의: {m.definition}</p>}{m.notes&&<p className="metric-note">{m.notes}</p>}
  {onSaved&&<><Button variant="outline" size="sm" onClick={()=>setEditing(true)}>기록 수정</Button><MetricDialog open={editing} initial={m} campaigns={[{id:m.campaignId,title:'현재 캠페인'}]} onClose={()=>setEditing(false)} onSaved={onSaved}/></>}
 </div>;
}

export function MetricDialog(props:MetricDialogProps){
 return <Dialog open={props.open} onOpenChange={open=>{if(!open)props.onClose()}}><DialogContent className="wide-dialog"><DialogHeader><DialogTitle>{props.initial?'성과 기록 수정':'실제 성과 입력'}</DialogTitle><DialogDescription>확인한 값만 입력하세요. 빈 값은 미확인으로 보존되며, 0은 실제로 확인한 0입니다.</DialogDescription></DialogHeader>{props.open&&<MetricForm key={props.initial?.id||'new'} {...props}/>}</DialogContent></Dialog>;
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
   await onSaved();toast.success('성과 기록을 저장했습니다.');onClose();
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
  {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button disabled={busy||!fields.campaignId}>{busy?'저장 중…':'성과 저장'}</Button></div>
 </form>;
}
