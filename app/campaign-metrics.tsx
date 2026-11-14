'use client';
// 금액은 화면 언어로 맞춘다(한국어는 lib/agency money와 같은 '19,800원').
import {t,localMoney as money} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy';
import {lazy,Suspense,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {api} from '@/lib/client';
import {metricSummary,type Campaign,type Metric} from '@/lib/agency';
import {DataTable,sortNumber} from '@/components/app/data-table';
import {TrendBars} from '@/components/app/trend-bars';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import {MetaLine} from '@/components/app/meta-line';
import {INCREMENTALITY_LABEL,verdictLabels,type IncrementalityRecord} from '@/lib/incrementality';

// X-F 네이버 검색광고 제안 카드(app/ads-proposals-card.tsx). 캠페인 상세 성과 탭 안에서만 그리고(성과 화면의 캠페인별 목록에서는 그리지 않는다) 그때 내려받는다.
const AdsProposalsCard=lazy(()=>import('./ads-proposals-card').then(m=>({default:m.AdsProposalsCard})));
function CampaignAdsProposals(){const [inSheet,setInSheet]=useState(false);return inSheet?<Suspense fallback={null}><AdsProposalsCard/></Suspense>:<span hidden ref={el=>{if(el?.closest('.campaign-sheet'))setInSheet(true)}}/>}
// C7 홀드아웃 증분 카드(추가). 저장된 결과(GET /api/measurements?campaignId=)만 그린다. 계산은 측정 API(action incrementality)로 하고 여기서는 입력을 받지 않는다.
type IncrementalityLoad={status:'loading'}|{status:'ready';record:IncrementalityRecord|null}|{status:'error'};
const signedMoney=(v:number)=>(v>0?'+':'')+money(v);
export function IncrementalityCard({campaignId}:{campaignId:string}){useT();
 const [load,setLoad]=useState<IncrementalityLoad>({status:'loading'});
 useEffect(()=>{let active=true;void fetch('/api/measurements?campaignId='+encodeURIComponent(campaignId)).then(async r=>{const d=await r.json() as {incrementality?:IncrementalityRecord|null};if(!r.ok)throw new Error(t('metrics.lift.failed'));return d.incrementality??null}).then(record=>{if(active)setLoad({status:'ready',record})}).catch(()=>{if(active)setLoad({status:'error'})});return()=>{active=false}},[campaignId]);
 const r=load.status==='ready'?load.record:null,res=r?.result;
 return <><section className="metric-card" aria-label={t('metrics.lift.region')}>
  <div className="section-heading"><h3>{t('metrics.lift.title')}</h3><span className="mode-pill">{INCREMENTALITY_LABEL}</span></div>
  {load.status==='loading'&&<p className="subtle-note">{t('metrics.lift.loading')}</p>}
  {load.status==='error'&&<p className="subtle-note">{t('metrics.lift.failed')}</p>}
  {load.status==='ready'&&!r&&<p className="subtle-note">{t('metrics.lift.empty')}</p>}
  {r&&res&&<>
   <div className="metric-grid">{[[t('metrics.lift.treated'),t('metrics.lift.storeCount',{n:res.stores.treated})],[t('metrics.lift.control'),t('metrics.lift.storeCount',{n:res.stores.control})],[t('metrics.lift.period'),t('metrics.lift.periodValue',{start:r.periodStart,end:r.periodEnd,days:res.period.days})],[t('metrics.lift.prePeriod'),`${res.prePeriod.start} ~ ${res.prePeriod.end}`],[t('metrics.lift.perStoreDay'),res.liftPerStoreDay===null?t('metrics.lift.insufficient'):signedMoney(res.liftPerStoreDay)],[t('metrics.lift.total'),res.liftTotal===null?t('metrics.lift.insufficient'):signedMoney(res.liftTotal)],[t('metrics.lift.ci'),res.ci?`${signedMoney(res.ci.low)} ~ ${signedMoney(res.ci.high)}`:t('metrics.lift.insufficient')],[t('metrics.lift.verdict'),verdictLabels[res.verdict]]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   {res.reasons.length>0&&<p className="subtle-note">{res.reasons.join(' ')}</p>}
   <p className="subtle-note">{INCREMENTALITY_LABEL}{t('metrics.lift.caveat')} {r.computedAt.slice(0,10)}, v{r.version}</p>
  </>}
 </section><CampaignAdsProposals/></>;
}

type CampaignChoice=Pick<Campaign,'id'|'title'>;
type MetricDialogProps={open:boolean;campaigns:CampaignChoice[];onClose:()=>void;onSaved:()=>Promise<void>;initial?:Metric};
// 이름은 사전 키로 두고 그릴 때 t()로 읽는다(모듈을 읽는 시점의 언어에 묶이지 않게).
const valueFields=[['revenue','metrics.field.revenue'],['variableCosts','metrics.field.variableCosts'],['adSpend','metrics.field.adSpend'],['productionCost','metrics.field.productionCost'],['orders','metrics.orders']] as const;
const amount=(value:number|null)=>value===null?t('metrics.needData'):money(value);

const balanceNote=()=>t('metrics.balanceNote');
// 성과 기록이 2개 이상이면 기간별 표와 순매출 추세로 한눈에 비교한다(UX-PLAN-3 7차원, 평가 7회차 '반복 카드'). 계산식 안내는 한 번만 보인다.
export function MetricSummary({metrics}:{metrics:readonly Metric[]}){useT();
 const rows=[...metrics].sort((a,b)=>(a.periodStart??a.period).localeCompare(b.periodStart??b.period));
 const num=(v:number|null)=>v===null?t('metrics.needData'):money(v);
 return <section className="metric-summary" aria-label={t('metrics.compareRegion')}>
  <TrendBars title={t('metrics.trendTitle')} points={rows.map(m=>({label:m.periodStart??m.period,value:m.revenue,display:m.revenue===null?t('metrics.unknown'):money(m.revenue)}))}/>
  <DataTable caption={t('metrics.tableCaption')} rows={rows} rowKey={m=>m.id} csvName="campaign-metrics" columns={[
   {label:t('metrics.period'),cell:m=>m.periodStart&&m.periodEnd?`${m.periodStart} ~ ${m.periodEnd}`:m.period,csv:m=>m.period},
   {label:t('metrics.revenue'),cell:m=>num(m.revenue),sort:m=>sortNumber(m.revenue),csv:m=>m.revenue??'',align:'right'},
   {label:t('metrics.orders'),cell:m=>m.orders===null?t('metrics.needData'):t('metrics.orderCount',{n:m.orders.toLocaleString('ko-KR')}),sort:m=>sortNumber(m.orders),csv:m=>m.orders??'',align:'right'},
   {label:t('metrics.contribution'),cell:m=>num(metricSummary(m).net),sort:m=>sortNumber(metricSummary(m).net),csv:m=>metricSummary(m).net??'',align:'right'},
   {label:t('metrics.roas'),cell:m=>{const r=metricSummary(m).roas;return r===null?t('metrics.needData'):r.toFixed(2)+t('metrics.times')},sort:m=>sortNumber(metricSummary(m).roas),csv:m=>metricSummary(m).roas??'',align:'right'},
  ]}/>
  <p className="subtle-note">{balanceNote()}</p>
  {rows.length>0&&<IncrementalityCard campaignId={rows[0].campaignId}/>}
 </section>;
}

// 같은 캠페인·같은 범위에서 바로 앞 기간의 기록(출처·범위 기록끼리). 없으면 null.
export function previousMetric(m:Metric,all:Metric[]){const start=m.periodStart??m.period;return all.filter(x=>x.id!==m.id&&x.campaignId===m.campaignId&&x.schemaVersion===2&&(x.scope??'')===(m.scope??'')&&(x.periodStart??x.period)<start).sort((a,b)=>(b.periodStart??b.period).localeCompare(a.periodStart??a.period))[0]??null;}
// 직전 기간 대비 순매출 변화율. 어느 한쪽이 미확인이거나 직전이 0이면 비교하지 않는다.
const changeText=(m:Metric,prev:Metric|null)=>{if(!prev)return t('metrics.noPrevious');if(m.revenue===null||prev.revenue===null||prev.revenue===0)return t('metrics.needCompare');const r=(m.revenue-prev.revenue)/prev.revenue*100;return `${r>=0?'+':''}${r.toFixed(1)}%`;};
// 카드 제목: 저장된 period(기간과 범위를 가운뎃점으로 이은 값)는 그대로 두고 화면에서는 기간과 범위를 항목으로 나눠 그린다(가운뎃점으로 잇지 않는다).
export const periodItems=(m:Pick<Metric,'period'|'periodStart'|'periodEnd'|'scope'>)=>m.periodStart&&m.periodEnd?[`${m.periodStart} ~ ${m.periodEnd}`,...(m.scope?m.scope.split(/\s·\s/):[])]:m.period.split(/\s·\s/);
export function MetricCard({metric:m,onSaved,compact=false,all=[]}:{metric:Metric;onSaved?:()=>Promise<void>;compact?:boolean;all?:Metric[]}){useT();
 const summary=metricSummary(m),[editing,setEditing]=useState(false),prev=m.schemaVersion===2?previousMetric(m,all):null;
 // 증분 카드는 캠페인마다 한 번만: 한 카드씩 그릴 때(compact 아님) 그 캠페인의 첫 기록 아래에 둔다. 여러 카드일 때는 MetricSummary가 그린다.
 const firstOfCampaign=(all.find(x=>x.campaignId===m.campaignId)??m).id===m.id;
 return <div className="metric-card">
  <div className="section-heading"><h3><MetaLine items={periodItems(m)}/></h3><span className="mode-pill">{m.schemaVersion===2?t('metrics.sourcedRecord'):t('metrics.legacyRecord')}</span></div>
  <div className="metric-grid">{[[t('metrics.revenue'),amount(m.revenue)],[t('metrics.contribution'),amount(summary.net)],m.schemaVersion===2?[t('metrics.vsPrevious'),changeText(m,prev)]:[t('metrics.observedChange'),amount(summary.observedChange)],[t('metrics.roas'),summary.roas===null?t('metrics.needData'):summary.roas.toFixed(2)+t('metrics.times')]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
  {!compact&&<p className="subtle-note">{balanceNote()}</p>}
  {m.source&&<p className="metric-source">{t('metrics.source')} {m.source}<br/>{t('metrics.definition')} {m.definition}</p>}{m.notes&&<p className="metric-note">{m.notes}</p>}
  {onSaved&&<><div className="metric-actions"><Button variant="outline" size="sm" onClick={()=>setEditing(true)}>{t('metrics.editRecord')}</Button></div><MetricDialog open={editing} initial={m} campaigns={[{id:m.campaignId,title:t('metrics.currentCampaign')}]} onClose={()=>setEditing(false)} onSaved={onSaved}/></>}
  {!compact&&firstOfCampaign&&<IncrementalityCard campaignId={m.campaignId}/>}
 </div>;
}

export function MetricDialog(props:MetricDialogProps){useT();
 return <Dialog open={props.open} onOpenChange={open=>{if(!open)props.onClose()}}><DialogContent className="wide-dialog"><DialogHeader><DialogTitle>{props.initial?t('metrics.editTitle'):t('metrics.newTitle')}</DialogTitle><DialogDescription>{t('metrics.dialogLead')}</DialogDescription></DialogHeader>{props.open&&<MetricForm key={props.initial?.id||'new'} {...props}/>}</DialogContent></Dialog>;
}

function MetricForm({campaigns,onClose,onSaved,initial}:MetricDialogProps){useT();
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
   await onSaved();notifySaved(t('metrics.saved') as Saved);onClose();
  }catch(e){setError(e instanceof Error?e.message:t('metrics.saveFailed'))}finally{setBusy(false)}
 }
 return <form className="form-stack" onSubmit={save}>
  <label className="field"><span>{t('metrics.campaign')}</span><NativeSelect value={fields.campaignId} disabled={!!initial} onChange={e=>update('campaignId',e.target.value)}>{campaigns.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.title}</NativeSelectOption>)}</NativeSelect></label>
  <div className="form-two">{[['periodStart',t('metrics.periodStart')],['periodEnd',t('metrics.periodEnd')]].map(([key,label])=><label className="field" key={key}><span>{label}</span><Input required type="date" value={fields[key]} onChange={e=>update(key,e.target.value)}/></label>)}</div>
  {([['scope',t('metrics.scope')],['source',t('metrics.dataSource')],['definition',t('metrics.aggregation')]] as const).map(([key,label])=><label className="field" key={key}><span>{label}</span><Input required value={fields[key]} onChange={e=>update(key,e.target.value)}/></label>)}
  <label className="field"><span>{t('metrics.method')}</span><NativeSelect value={fields.method} onChange={e=>update('method',e.target.value)}><NativeSelectOption value="manual">{t('metrics.manual')}</NativeSelectOption><NativeSelectOption value="export">{t('metrics.export')}</NativeSelectOption></NativeSelect></label>
  <div className="form-two">{valueFields.map(([key,label])=><label className="field" key={key}><span>{t(label)}</span><Input type="number" min="0" max="1000000000000" step={key==='orders'?'1':'any'} value={fields[key]} placeholder={t('metrics.unknown')} onChange={e=>update(key,e.target.value)}/></label>)}</div>
  <label className="field"><span>{t('metrics.notes')}</span><Textarea value={fields.notes} onChange={e=>update('notes',e.target.value)}/></label>
  <p className="notice">{t('metrics.overlapNote')}</p>
  {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button disabled={busy||!fields.campaignId} disabledReason={!fields.campaignId?t('metrics.pickCampaign'):undefined}>{busy?t('metrics.saving'):t('metrics.save')}</Button></div>
 </form>;
}
