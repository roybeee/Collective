'use client';
import {useEffect,useState} from 'react';
import {Download,LoaderCircle,Check} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {api} from '@/lib/client';
import {MetaLine} from '@/components/app/meta-line';
import {metaText} from '@/lib/format';
import {channelNameForConnector,type ConnectorKey} from '@/lib/channels';
import {credentialState} from '@/lib/feature-status';
import type {ViralExperiment} from '@/lib/learning';
import type {Campaign} from '@/lib/agency';
import type {ResolvedScope} from '@/lib/channel-credentials';
import type {MeasurementView} from '@/lib/measurement-status';
import {notifySaved} from '@/lib/ui/notify';

// loop-1: 진행 중인 콘텐츠 실험 카드의 'A/B 성과 가져오기'와 자동 수집 상태(security-ops-5).
// 수집은 초안만 만든다. 결과 반영과 비교 가능 확정은 '결과 입력'에서 사람이 한다. 수집 버튼은 대표·관리자에게, 이 실험 채널의 커넥터 연결이 있을 때만 보인다.
export type ResolvedCredential={channel:ConnectorKey;label:string;resolvedScope:ResolvedScope|null;account:string;expiresAt:string|null};
type Arm='control'|'treatment';
const armLabels:Record<Arm,string>={control:'A(대조안)',treatment:'B(실험안)'};
const TOKEN_WARNING_MS=7*86400000;
const when=(s:string|null)=>s?new Date(s).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'미확인';
const scopeLabel=(s:ResolvedScope|null)=>s?.level==='store'?`지점 연결 ${s.storeId}`:s?.level==='brand'?`브랜드 연결 ${s.brandId}`:s?.level==='workspace'?'워크스페이스 기본':'연결 없음';
const seoulDay=(at:number)=>new Date(at).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});

// 이 실험 채널에 맞고 수집에 쓸 연결이 있는 커넥터. 채널마다 커넥터는 하나뿐이다.
export function collectConnectors(experiment:Pick<ViralExperiment,'channel'>,resolved:readonly ResolvedCredential[]){
 return resolved.filter(r=>r.resolvedScope&&channelNameForConnector(r.channel)===experiment.channel);
}
// 버튼 노출: 진행 중 실험, 대표·관리자, 이 채널의 연결이 있을 때만.
export const canStartCollect=(experiment:Pick<ViralExperiment,'status'>,canCollect:boolean,connectors:readonly ResolvedCredential[])=>experiment.status==='running'&&canCollect&&connectors.length>0;
export type CollectForm={arm:Arm;channel:string;target:string;from:string;to:string};
export const collectPayload=(experimentId:string,f:CollectForm)=>({experimentId,arm:f.arm,channel:f.channel,target:f.target.trim(),from:f.from,to:f.to});
export const startCollect=(experimentId:string,f:CollectForm)=>api('collect',collectPayload(experimentId,f),'/api/measurements');

// 토큰 만료 경고(연결 및 설정과 같은 판정). 만료일을 모르는 연결은 경고하지 않는다.
function tokenWarning(c:ResolvedCredential|undefined,now:number){
 if(!c?.resolvedScope||!c.expiresAt)return '';
 const state=credentialState({connected:true,expiresAt:c.expiresAt,expiringSoon:Date.parse(c.expiresAt)-now<TOKEN_WARNING_MS},now);
 return state==='expired'?`${c.label} 토큰이 만료됐습니다(${scopeLabel(c.resolvedScope)}). 자동 수집이 실패합니다. 연결 및 설정에서 다시 연결하세요.`:state==='expiring'?`${c.label} 토큰이 ${when(c.expiresAt)}에 만료됩니다(${scopeLabel(c.resolvedScope)}). 만료 전에 새 토큰으로 다시 연결하세요.`:'';
}

// 카드 본문: 수집 초안(arm별 값·기간·연결), 비교 경고, 자동 수집 대상 상태, 토큰 만료. 네트워크를 부르지 않는다.
export function CollectStatus({view,connector,now}:{view?:MeasurementView;connector?:ResolvedCredential;now:number}){
 const token=tokenWarning(connector,now),arms=(['control','treatment'] as const).flatMap(a=>view?.draft?.arms[a]?[[a,view.draft.arms[a]!] as const]:[]),failing=view?.sources.filter(s=>s.lastError)??[];
 if(!view&&!token)return null;
 return <section className="learning-assessment" aria-label="자동 수집 성과">
  {token&&<p role="alert">{token}</p>}
  {failing.map(s=><p role="alert" key={s.id}>자동 수집 실패({armLabels[s.arm]}): <MetaLine items={[s.lastError!.reason,`연속 ${s.failures}회`,s.reauthRequired&&'재연결 필요',s.stopped?'자동 수집 멈춤':s.nextAttemptAt&&`다음 시도 ${when(s.nextAttemptAt)}`]}/></p>)}
  {arms.length>0&&<ul className="learning-meta" aria-label="수집 초안">{arms.map(([a,d])=><li key={a}><MetaLine items={[armLabels[a],d.value?`${d.value.numerator??'미확인'} / ${d.value.denominator??'미확인'}`:'값 없음',`기간 ${d.window?`${d.window.from}~${d.window.to}`:'미확인'}`,`수집 ${when(d.fetchedAt)}`,scopeLabel(d.credential)]}/></li>)}</ul>}
  {!!view?.draft?.limitations.length&&<ul className="learning-meta" aria-label="수집 한계">{view.draft.limitations.map(x=><li key={x}>{x}</li>)}</ul>}
  {view?.sources.filter(s=>!s.lastError).map(s=><small key={s.id}><MetaLine items={[`${armLabels[s.arm]} 자동 수집`,`대상 ${s.target}`,`마지막 ${when(s.lastFetchedAt)}`,s.stopped?s.stoppedReason:s.nextAttemptAt&&`다음 ${when(s.nextAttemptAt)}`]}/></small>)}
  {view?.draft&&<small>수집 초안은 비교 가능으로 확정되지 않습니다. 결과 입력에서 두 안의 조건을 확인한 뒤 직접 체크하세요.</small>}
 </section>;
}

// 수집 대화상자 본문. 기간 기본값은 실험 시작일부터 마지막 완결일(어제, Asia/Seoul)까지다.
export function CollectFields({f,set,connectors}:{f:CollectForm;set:(k:keyof CollectForm,v:string)=>void;connectors:readonly ResolvedCredential[]}){
 return <>
  <div className="form-two"><label className="field"><span>실험안 *</span><NativeSelect value={f.arm} onChange={e=>set('arm',e.target.value)}><NativeSelectOption value="control">{armLabels.control}</NativeSelectOption><NativeSelectOption value="treatment">{armLabels.treatment}</NativeSelectOption></NativeSelect></label>
  <label className="field"><span>커넥터 *</span><NativeSelect value={f.channel} onChange={e=>set('channel',e.target.value)}>{connectors.map(c=><NativeSelectOption key={c.channel} value={c.channel}>{metaText([c.label,c.account||'계정 미확인',scopeLabel(c.resolvedScope)])}</NativeSelectOption>)}</NativeSelect></label></div>
  <label className="field"><span>{f.channel==='instagram'?'게시물 ID *':'광고 대상 ID *'}</span><Input required value={f.target} maxLength={100} onChange={e=>set('target',e.target.value)} placeholder={f.channel==='instagram'?'숫자 미디어 ID':'캠페인·광고그룹·키워드 ID'}/><small>이 실험안을 게시·집행한 대상 하나를 적습니다. 두 안은 같은 연결·같은 기간으로 가져와야 비교할 수 있습니다.</small></label>
  <div className="form-two"><label className="field"><span>수집 시작일 *</span><Input type="date" required value={f.from} onChange={e=>set('from',e.target.value)}/></label><label className="field"><span>수집 종료일 *</span><Input type="date" required value={f.to} onChange={e=>set('to',e.target.value)}/><small>어제까지로 두면 워커가 6시간마다 어제까지로 넓혀 다시 가져옵니다.</small></label></div>
 </>;
}

// 대화상자 기본값: 아직 가져오지 않은 실험안, 첫 커넥터, 기존 수집 기간(없으면 실험 시작일~어제, Asia/Seoul).
function initialForm(experiment:ViralExperiment,view:MeasurementView|undefined,connectors:readonly ResolvedCredential[]):CollectForm{
 const last=seoulDay(Date.now()-86400000),first=experiment.startedAt?seoulDay(Date.parse(experiment.startedAt)):last,prior=view?.sources.find(s=>s.arm==='control')??view?.sources[0],hasControl=view?.sources.some(s=>s.arm==='control');
 return {arm:hasControl&&!view?.sources.some(s=>s.arm==='treatment')?'treatment':'control',channel:connectors[0]?.channel??'',target:'',from:prior?.window?.from??(first<last?first:last),to:prior?.window?.to??last};
}
export function MeasurementCollect({experiment,view,campaign,canCollect,busy,onCollected}:{experiment:ViralExperiment;view?:MeasurementView;campaign?:Pick<Campaign,'brandId'|'storeId'>;canCollect:boolean;busy:boolean;onCollected:()=>Promise<unknown>}){
 // 만료 판정 기준 시각(now)은 연결 상태를 받을 때 정한다(렌더 중 시계를 읽지 않는다).
 const[now,setNow]=useState(0),[resolved,setResolved]=useState<ResolvedCredential[]>([]),[open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[f,setF]=useState<CollectForm>({arm:'control',channel:'',target:'',from:'',to:''});
 const storeId=campaign?.brandId===experiment.brandId?campaign.storeId||'':'',running=experiment.status==='running';
 // 만료 판정·버튼 노출은 수집과 같은 우선순위(지점 > 브랜드 > 워크스페이스 기본)로 고른 연결을 쓴다(GET /api/channels resolved, F5).
 useEffect(()=>{if(!running)return;let active=true;fetch(`/api/channels?brandId=${encodeURIComponent(experiment.brandId)}${storeId?`&storeId=${encodeURIComponent(storeId)}`:''}`).then(async r=>{if(!r.ok)return;const d=await r.json() as {resolved?:ResolvedCredential[]};if(active){setNow(Date.now());setResolved(d.resolved??[])}}).catch(()=>{/* 보조 표시: 불러오지 못하면 버튼과 만료 경고를 숨긴다. */});return()=>{active=false}},[experiment.brandId,storeId,running]);
 const connectors=collectConnectors(experiment,resolved);
 function start(){setF(initialForm(experiment,view,connectors));setError('');setOpen(true)}
 async function submit(ev:React.FormEvent){ev.preventDefault();setSaving(true);setError('');try{await startCollect(experiment.id,f);setOpen(false);await onCollected();notifySaved('성과를 초안으로 가져왔습니다.',{description:'결과 입력에서 확인한 뒤 반영하세요.'})}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
 return <>
  <CollectStatus view={view} connector={connectors[0]??resolved.find(r=>channelNameForConnector(r.channel)===experiment.channel)} now={now}/>
  {canStartCollect(experiment,canCollect,connectors)&&<div className="learning-actions"><Button variant="outline" disabled={busy||saving} onClick={start}><Download/>A/B 성과 가져오기</Button></div>}
  <Dialog open={open} onOpenChange={v=>!v&&!saving&&setOpen(false)}><DialogContent className="learning-dialog"><DialogHeader><DialogTitle>A/B 성과 가져오기</DialogTitle><DialogDescription>연결된 채널 API에서 한 실험안의 수치를 가져와 초안으로 저장합니다. 이후 워커가 같은 대상을 6시간마다 다시 가져옵니다. 결과 반영과 비교 가능 확정은 결과 입력에서 사람이 합니다.</DialogDescription></DialogHeader>
   <form className="form-stack" onSubmit={submit}><CollectFields f={f} set={(k,v)=>setF(s=>({...s,[k]:v}))} connectors={connectors}/>{error&&<p role="alert" className="form-error">{error}</p>}<div className="form-actions"><Button type="button" variant="outline" disabled={saving} onClick={()=>setOpen(false)}>취소</Button><Button type="submit" disabled={saving||!f.channel} disabledReason={!f.channel?'필수 칸을 먼저 채우세요.':undefined}>{saving?<LoaderCircle className="spin"/>:<Check/>}가져오기</Button></div></form>
  </DialogContent></Dialog>
 </>;
}

// 워크스페이스 첫 화면 알림(CollectAlertsView·CollectAlertsNotice)은 홈 첫 로딩을 가볍게 하려고 app/home-alerts.tsx에 둔다.
export {CollectAlertsView,CollectAlertsNotice} from './home-alerts';
