'use client';
import {EmptyLine} from '@/components/app/empty-line';
import {readOnlyReason} from '@/lib/ui/read-only';
import {CheckInput} from '@/components/app/check';
import {NativeSelect} from '@/components/ui/native-select';
import {Textarea} from '@/components/ui/textarea';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {dateTime} from '@/lib/format';
import {enumLabel} from '@/lib/ui-copy';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthExperimentView} from '@/lib/growth-experiment-server';
import {experimentChannels,experimentMetrics,assignmentUnits,type ExperimentDesignInput} from '@/lib/growth-experiment';
import styles from './growth-panel.module.css';
type View=GrowthExperimentView;
type Experiment=View['experiments'][number];
const statusLabels:Record<string,string>={draft:'초안',registered:'사전등록',cancelled:'취소',collecting:'관측 중',maturing:'성숙 대기',insufficient:'표본 부족',invalid:'무효',inconclusive:'불확실',supported:'개선 근거(등록 범위)',rejected:'악화 근거(등록 범위)',exploratory:'탐색(인과 판정 없음)',aa_passed:'A/A 통과',aa_failed:'A/A 실패'};
const metricLabels={paid_orders:'구매 여부(0/1)',net_revenue_per_unit:'단위당 순매출',contribution_per_unit:'단위당 공헌이익'} as const;
const local=(t:number)=>new Date(t-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
const emptyDesign=():ExperimentDesignInput=>({title:'',mode:'confirm',aa:false,hypothesis:'',missionId:'',missionVersion:1,offerId:'',offerVersion:1,channel:'storefront',intervention:'',interventionRefs:[],assignmentUnit:'pseudonymous_visitor',treatmentShare:0.5,metric:'paid_orders',lowerBound:0,upperBound:1,minEffect:0.05,minSamplePerArm:100,startAt:local(Date.now()+86400000),endAt:local(Date.now()+15*86400000),maturityDays:7,stopRule:''});
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/experiments?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('판매 실험을 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).experiments))throw new Error('실험 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthExperimentPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[editing,setEditing]=useState<{id:string;expectedVersion:number}|null>(null),[input,setInput]=useState<ExperimentDesignInput>(emptyDesign),[refs,setRefs]=useState(''),[unitKeys,setUnitKeys]=useState(''),[obs,setObs]=useState({unitHash:'',exposed:true,trackingComplete:true,contaminated:false,orderIds:'',evidenceRef:''}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving;
 async function send(body:Record<string,unknown>,done:string){if(busy||writing.current||!view||stale)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,...body},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/experiments',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;if(body.action==='save_design')setEditing({id:String(body.id),expectedVersion:(v as {version:number}).version});if(body.action==='assign_units')setUnitKeys('');setStale(true);setMessage(`${done} 최신 조회가 실패해도 저장은 완료된 상태입니다.`);await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 function saveDesign(){if(!editing)return;let interventionRefs:ExperimentDesignInput['interventionRefs']=[];try{interventionRefs=refs.split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{const [kind,id,version]=line.split(':');return {kind:kind as ExperimentDesignInput['interventionRefs'][number]['kind'],id,version:Number(version)}});}catch{setError('개입 근거 형식을 확인하세요.');return}
  void send({action:'save_design',id:editing.id,expectedVersion:editing.expectedVersion,input:{...input,interventionRefs,startAt:new Date(input.startAt).toISOString(),endAt:new Date(input.endAt).toISOString()}},'실험 설계를 저장했습니다.');}
 const edit=(e:Experiment)=>{setEditing({id:e.id,expectedVersion:e.version});setInput({...e.input,startAt:local(Date.parse(e.input.startAt)),endAt:local(Date.parse(e.input.endAt))});setRefs(e.input.interventionRefs.map(r=>`${r.kind}:${r.id}:${r.version}`).join('\n'));retry.current=null;};
 const n=(k:keyof ExperimentDesignInput)=>(e:{target:{value:string}})=>setInput({...input,[k]:Number(e.target.value)});
 return <section aria-label="판매 실험" className={styles.panel}><header className={styles.header}><h3>판매 실험 · 사전등록과 분석</h3><Button variant="panel" size="fit" aria-label="실험 새로고침" type="button" disabled={busy} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>판매 실험을 미리 등록하고 결과를 판정합니다. 탐색 실험은 인과 판정을 하지 않고, 확증 실험은 시작 전에 가설·배정 확률·주지표·최소 효과·표본·기간·성숙 대기를 고정합니다. 비구매자는 0으로 포함하며, 배정 비율 불일치·오염·추적 누락·금액 미확인이 크면 무효입니다. 결과는 등록 범위에만 적용되고 실행·확대 권한을 주지 않습니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">실험을 조회하고 있습니다.</p>}{stale&&<p role="status" className={styles.warning}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<>{<Button variant="panel" size="fit" type="button" disabled={busy||!view.canEdit} disabledReason={view.canEdit?undefined:readOnlyReason} onClick={()=>{setEditing({id:`exp-${crypto.randomUUID().slice(0,8)}`,expectedVersion:0});setInput(emptyDesign());setRefs('');retry.current=null;}}>새 실험 설계</Button>}
   {editing&&<form onSubmit={e=>{e.preventDefault();saveDesign();}}><fieldset disabled={busy||!view.canEdit} className={styles.form}><legend>실험 {editing.id}</legend>
    <label>실험 제목<Input required maxLength={200} value={input.title} onChange={e=>setInput({...input,title:e.target.value})}/></label>
    <label>실험 종류<NativeSelect value={input.mode} onChange={e=>setInput({...input,mode:e.target.value as 'explore'|'confirm'})}><option value="confirm">확증</option><option value="explore">탐색</option></NativeSelect></label>
    <label>A/A 점검<NativeSelect value={String(input.aa)} onChange={e=>setInput({...input,aa:e.target.value==='true'})}><option value="false">아니오</option><option value="true">예</option></NativeSelect></label>
    <label className={styles.wide}>가설<Textarea required maxLength={2000} value={input.hypothesis} onChange={e=>setInput({...input,hypothesis:e.target.value})}/></label>
    <label>미션 ID<Input required value={input.missionId} onChange={e=>setInput({...input,missionId:e.target.value})}/></label><label>미션 판<Input type="number" min={1} value={input.missionVersion} onChange={n('missionVersion')}/></label>
    <label>오퍼 ID<Input required value={input.offerId} onChange={e=>setInput({...input,offerId:e.target.value})}/></label><label>오퍼 판<Input type="number" min={1} value={input.offerVersion} onChange={n('offerVersion')}/></label>
    <label>채널<NativeSelect value={input.channel} onChange={e=>setInput({...input,channel:e.target.value as ExperimentDesignInput['channel']})}>{experimentChannels.map(c=><option key={c} value={c}>{enumLabel('experimentChannel',c)}</option>)}</NativeSelect></label>
    <label>배정 단위<NativeSelect value={input.assignmentUnit} onChange={e=>setInput({...input,assignmentUnit:e.target.value as ExperimentDesignInput['assignmentUnit']})}>{assignmentUnits.map(c=><option key={c} value={c}>{enumLabel('assignmentUnit',c)}</option>)}</NativeSelect></label>
    <label className={styles.wide}>개입 설명<Textarea required maxLength={2000} value={input.intervention} onChange={e=>setInput({...input,intervention:e.target.value})}/></label>
    <label className={styles.wide}>개입 근거(줄마다 종류:ID:판)<Textarea value={refs} onChange={e=>setRefs(e.target.value)} placeholder="landing_revision:landing-1234:3"/></label>
    <label>처리군 배정 확률<Input type="number" step={0.05} min={0.1} max={0.9} value={input.treatmentShare} onChange={n('treatmentShare')}/></label>
    <label>주지표<NativeSelect value={input.metric} onChange={e=>{const metric=e.target.value as ExperimentDesignInput['metric'];setInput({...input,metric,...(metric==='paid_orders'?{lowerBound:0,upperBound:1}:{})});}}>{experimentMetrics.map(m=><option key={m} value={m}>{metricLabels[m]}</option>)}</NativeSelect></label>
    <label>단위 최솟값<Input type="number" value={input.lowerBound} onChange={n('lowerBound')}/></label><label>단위 최댓값<Input type="number" value={input.upperBound} onChange={n('upperBound')}/></label>
    <label>최소 효과(MDE)<Input type="number" step="any" value={input.minEffect} onChange={n('minEffect')}/></label><label>군별 최소 표본<Input type="number" min={10} value={input.minSamplePerArm} onChange={n('minSamplePerArm')}/></label>
    <label>시작 시각<Input type="datetime-local" value={input.startAt} onChange={e=>setInput({...input,startAt:e.target.value})}/></label><label>종료 시각<Input type="datetime-local" value={input.endAt} onChange={e=>setInput({...input,endAt:e.target.value})}/></label>
    <label>성숙 대기일<Input type="number" min={0} max={90} value={input.maturityDays} onChange={n('maturityDays')}/></label>
    <label className={styles.wide}>중단 기준<Input required maxLength={1000} value={input.stopRule} onChange={e=>setInput({...input,stopRule:e.target.value})}/></label>
    <Button variant="panel" size="fit" type="submit" disabled={stale}>실험 설계 저장</Button></fieldset></form>}
   {!view.experiments.length&&<EmptyLine first={view.canEdit?'판매 실험':undefined}>판매 실험이 없습니다.</EmptyLine>}
   <ul>{view.experiments.map(e=><li key={e.id} className="wrap-anywhere"><p><strong>{e.input.title}</strong> · {e.id} · v{e.version} · {e.input.mode==='confirm'?'확증':'탐색'}{e.input.aa?' · A/A':''} · {statusLabels[e.status]}</p>
    <p>{metricLabels[e.input.metric]} · MDE {e.input.minEffect} · 군별 최소 {e.input.minSamplePerArm} · 처리 확률 {e.input.treatmentShare} · {dateTime(e.input.startAt)}~{dateTime(e.input.endAt)} · 성숙 {e.input.maturityDays}일</p>
    {e.status==='registered'&&<p>배정: 대조 {e.units.control} · 처리 {e.units.treatment} · 관측 {e.units.observed}{e.preview?` · 현재 ${statusLabels[e.preview.status]}`:''}</p>}
    {e.preview?.reasons.map(x=><p key={x}>{x}</p>)}
    {e.latest&&<p>분석 {e.latest.analysisNumber}회차: {statusLabels[e.latest.analysis.status]} · 대조 {e.latest.analysis.analysed.control}/처리 {e.latest.analysis.analysed.treatment}{e.latest.analysis.statistics?.interval?` · 차이 구간 [${e.latest.analysis.statistics.interval.map(v=>v.toFixed(3)).join(', ')}] · α ${e.latest.analysis.statistics.alpha.toFixed(4)}`:''} · 범위: {e.latest.analysis.causalScope}</p>}
    {view.canEdit&&e.status==='draft'&&<><Button variant="panel" size="fit" type="button" disabled={busy||stale} onClick={()=>edit(e)}>{e.id} 설계 수정</Button><Button variant="panel" size="fit" type="button" disabled={busy||stale} onClick={()=>void send({action:'register',id:e.id,expectedVersion:e.version},'사전등록했습니다. 설계는 이제 바꿀 수 없습니다.')}>{e.id} 사전등록</Button></>}
    {view.canEdit&&e.status!=='cancelled'&&<Button variant="panel" size="fit" type="button" disabled={busy||stale} onClick={()=>void send({action:'cancel',id:e.id,expectedVersion:e.version},'실험을 취소했습니다.')}>{e.id} 취소</Button>}
    {e.status==='registered'&&<><label>배정할 가명 단위 키(줄마다 하나)<Textarea value={unitKeys} onChange={ev=>setUnitKeys(ev.target.value)}/></label><Button variant="panel" size="fit" type="button" disabled={busy||stale||!unitKeys.trim()} onClick={()=>void send({action:'assign_units',id:e.id,units:unitKeys.split('\n').map(x=>x.trim()).filter(Boolean)},'배정했습니다.')}>{e.id} 단위 배정</Button>
     <fieldset className={styles.form}><legend>{e.id} 단위 관측</legend><label>관측할 배정 단위<NativeSelect value={obs.unitHash} onChange={ev=>setObs({...obs,unitHash:ev.target.value})}><option value="">단위 선택</option>{e.unitRows.map(u=><option key={u.unitHash} value={u.unitHash}>{u.unitHash.slice(0,12)} · {u.arm==='control'?'대조':'처리'}{u.observed?` · 관측됨(주문 ${u.orders})`:''}</option>)}</NativeSelect></label>
      <label><CheckInput checked={obs.exposed} onChange={ev=>setObs({...obs,exposed:ev.target.checked})}/>노출됨</label><label><CheckInput checked={obs.trackingComplete} onChange={ev=>setObs({...obs,trackingComplete:ev.target.checked})}/>추적 완료</label><label><CheckInput checked={obs.contaminated} onChange={ev=>setObs({...obs,contaminated:ev.target.checked})}/>두 군 모두 노출(오염)</label>
      <label>연결 주문 ID(쉼표 구분)<Input value={obs.orderIds} onChange={ev=>setObs({...obs,orderIds:ev.target.value})}/></label><label>관측 근거 ID<Input value={obs.evidenceRef} onChange={ev=>setObs({...obs,evidenceRef:ev.target.value})}/></label>
      <Button variant="panel" size="fit" type="button" disabled={busy||stale||!obs.unitHash||!obs.evidenceRef} onClick={()=>{const u=e.unitRows.find(x=>x.unitHash===obs.unitHash);if(u)void send({action:'record_observation',id:e.id,expectedVersion:u.version,observation:{unitHash:u.unitHash,exposed:obs.exposed,trackingComplete:obs.trackingComplete,contaminated:obs.contaminated,orderIds:obs.orderIds.split(',').map(x=>x.trim()).filter(Boolean),evidenceRef:obs.evidenceRef}},'관측을 기록했습니다.');}}>{e.id} 관측 기록</Button></fieldset>
     <Button variant="panel" size="fit" type="button" disabled={busy||stale} onClick={()=>void send({action:'analyse',id:e.id},'분석 결과를 저장했습니다.')}>{e.id} 분석</Button></>}
    {e.results.length>1&&<details><summary>{e.id} 분석 이력</summary>{e.results.map(r=><p key={r.id}>{r.analysisNumber}회차 · {statusLabels[r.analysis.status]} · 입력 {r.inputDigest.slice(0,12)} · {r.recordedAt}</p>)}</details>}
   </li>)}</ul></>}
 </section>;
}
