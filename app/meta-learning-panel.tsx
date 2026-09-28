'use client';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {Checkbox} from '@/components/ui/checkbox';
import {metaCandidateFields,metaDecisionLabels,type MetaLearningDecision} from '@/lib/meta-learning';
import type {metaLearningView} from '@/lib/meta-learning-server';
import s from './meta-insights-panel.module.css';

type View=Awaited<ReturnType<typeof metaLearningView>>;
const empty={hypothesis:'',variable:'',control:'',treatment:'',stopCondition:'',metric:'paid_orders',minSample:'100',creativeId:''};
export function MetaLearningPanel({campaignId}:{campaignId:string}){
 const id=useId(),[view,setView]=useState<View|null>(null),[retry,setRetry]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const [snapshotId,setSnapshotId]=useState(''),[decision,setDecision]=useState<MetaLearningDecision['decision']>('hold'),[note,setNote]=useState(''),[candidate,setCandidate]=useState(empty),[confirmed,setConfirmed]=useState(false);
 useEffect(()=>{const a=new AbortController();void fetch('/api/meta-ads/learning?campaignId='+encodeURIComponent(campaignId),{signal:a.signal}).then(async r=>{const v=await r.json() as View&{error?:string};if(!r.ok)throw new Error(v.error||'조회 실패');if(a.signal.aborted)return;setView(v);setSnapshotId(old=>v.snapshots.some(x=>x.id===old)?old:v.snapshots[0]?.id??'');setError('');setConfirmed(false);}).catch(e=>{if(!a.signal.aborted)setError(e instanceof Error?e.message:'조회 실패');}).finally(()=>{if(!a.signal.aborted)setBusy(false);});return()=>a.abort();},[campaignId,retry]);
 const source=view?.snapshots.find(v=>v.id===snapshotId),disabled=busy||!view?.canEdit;
 async function save(){
  if(!view||!source)return;setBusy(true);setError('');setSuccess('');
  try{const chosen=view.creatives.find(v=>v.id===candidate.creativeId);const r=await fetch('/api/meta-ads/learning',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'record',campaignId,snapshotId,expectedDigest:source.digest,expectedVersion:view.version,decision,note,confirmed,candidate:decision==='retest'?{...candidate,minSample:Number(candidate.minSample),creativeVersion:chosen?.version,creativeHash:chosen?.pngHash}:null})});const v=await r.json() as View&{error?:string};if(!r.ok)throw new Error(v.error||'저장 실패');setView(v);setConfirmed(false);setSuccess('판단과 다음 실험 후보를 기록했습니다. 광고 집행이나 규칙 적용은 시작하지 않습니다.');}catch(e){setError(e instanceof Error?e.message:'저장 실패');}finally{setBusy(false);}
 }
 return <section className={s.root} aria-label="Meta 다음 실험" aria-busy={busy}>
  <header className={s.header}><div><span className={s.eyebrow}>COLLECTIVE / NEXT EXPERIMENT</span><h2>이번 근거로, 다음 실험을 정합니다</h2><p>기록한 보고를 바탕으로 사람의 판단과 검증할 가설을 남깁니다.</p></div><Button variant="outline" disabled={busy} onClick={()=>{setBusy(true);setConfirmed(false);setRetry(n=>n+1);}}>다시 불러오기</Button></header>
  {error&&<p role="alert" className={s.error}>{error}</p>}{success&&<p role="status" className={s.success}>{success}</p>}
  {view&&!view.snapshots.length&&<p className={s.empty}>성과 대조 탭에서 먼저 보고를 기록하세요.</p>}
  {view&&view.snapshots.length>0&&<form className={s.card} onSubmit={e=>{e.preventDefault();void save();}}><fieldset className={s.fields} disabled={disabled}>
   <legend>보고와 판단</legend><label htmlFor={id+'source'}>판단할 보고<NativeSelect id={id+'source'} value={snapshotId} onChange={e=>{setSnapshotId(e.target.value);setConfirmed(false);}}>{view.snapshots.map(v=><option key={v.id} value={v.id}>보고 v{v.version} · {v.period.since}~{v.period.until}{v.stale?' · 새 집계 필요':''}</option>)}</NativeSelect></label>
   {source?.stale&&<p className={s.warning}>주문·성과가 바뀌었습니다. 성과 대조에서 새 보고를 기록한 뒤 판단하세요.</p>}
   <p className={s.help}>{source?.evidenceStatus==='observation_only'?'구매와 성숙된 플랫폼 자료가 있으나 인과 효과는 검증되지 않았습니다.':'아직 효과를 판단할 근거가 부족합니다.'} 계속 관찰은 광고비 집행 승인이 아닙니다.</p>
   <label htmlFor={id+'decision'}>운영 판단<NativeSelect id={id+'decision'} value={decision} onChange={e=>{setDecision(e.target.value as MetaLearningDecision['decision']);setConfirmed(false);}}>{Object.entries(metaDecisionLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</NativeSelect></label>
   <label htmlFor={id+'note'}>판단 근거<Input id={id+'note'} required maxLength={1500} value={note} onChange={e=>{setNote(e.target.value);setConfirmed(false);}}/></label>
   {decision==='retest'&&<><h3>다음 실험 후보</h3>{Object.entries(metaCandidateFields).map(([key,label])=><label key={key} htmlFor={id+key}>{label}<Input id={id+key} required maxLength={1000} value={candidate[key as keyof typeof metaCandidateFields]} onChange={e=>{setCandidate(v=>({...v,[key]:e.target.value}));setConfirmed(false);}}/></label>)}
    <label htmlFor={id+'creative'}>연결 소재<NativeSelect id={id+'creative'} value={candidate.creativeId} required onChange={e=>{setCandidate(v=>({...v,creativeId:e.target.value}));setConfirmed(false);}}><option value="">소재 선택</option>{view.creatives.map(v=><option key={v.id} value={v.id}>{v.title} · v{v.version}</option>)}</NativeSelect></label>
    <label htmlFor={id+'metric'}>확인할 지표<NativeSelect id={id+'metric'} value={candidate.metric} onChange={e=>{setCandidate(v=>({...v,metric:e.target.value}));setConfirmed(false);}}><option value="paid_orders">실제 결제 주문</option><option value="contribution">기여이익</option></NativeSelect></label>
    <label htmlFor={id+'sample'}>최소 표본 수<Input id={id+'sample'} type="number" min={1} max={1000000} required value={candidate.minSample} onChange={e=>{setCandidate(v=>({...v,minSample:e.target.value}));setConfirmed(false);}}/></label><p className={s.help}>후보는 준비 초안입니다. 배정·관측 기간·비용 기준을 정하고 승인한 뒤 실험을 시작하세요.</p>
   </>}
   <label><Checkbox checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)}/>근거의 한계와 이번 판단을 확인했습니다</label><Button type="submit" disabled={disabled||!confirmed||source?.stale}>판단 기록</Button>
  </fieldset></form>}
  <div className={s.results}><h3>판단 이력</h3>{view?.records.map(r=><article className={s.card} key={r.id}><h4>{metaDecisionLabels[r.decision]} · 보고 v{r.sourceVersion}</h4><p>{r.note}</p>{r.stale&&<p className={s.warning}>기록 이후 근거가 변경되었습니다.</p>}{r.candidate&&<><p>실험 후보: {r.candidate.hypothesis}</p><p>{r.candidate.control} → {r.candidate.treatment}</p><p className={s.help}>준비 초안 · 자동 집행·규칙 활성화 없음</p></>}</article>)}</div>
 </section>;
}
