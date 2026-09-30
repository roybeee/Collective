'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthCollaborationView} from '@/lib/growth-collaboration-server';
import type {CollaborationPlan,CollaborationStage} from '@/lib/growth-collaboration';
import styles from './growth-panel.module.css';
type View=GrowthCollaborationView;
type Row=View['collaborations'][number];
const stageLabels:Record<CollaborationStage,string>={proposed:'제안',agreed:'합의',delivered:'콘텐츠 납품',approved:'브랜드 승인',published:'게시 확인',settled:'정산',cancelled:'취소'};
const nextStages:Record<CollaborationStage,CollaborationStage[]>={proposed:['agreed','cancelled'],agreed:['delivered','cancelled'],delivered:['approved','cancelled'],approved:['published','cancelled'],published:['settled'],settled:[],cancelled:[]};
const won=(n:number|null|undefined)=>n===null||n===undefined?'미확인':`${n.toLocaleString('ko-KR')}원`;
const emptyPlan=():CollaborationPlan=>({sequenceId:'',sequenceVersion:1,stepId:'',partnerAlias:'',partnerKind:'creator',audienceFitEvidence:'',brief:'',rightsScope:'',rightsDays:90,terms:'',feeKrw:null,commissionRate:null,trackingCodeId:'',deliverDueAt:'',publishDueAt:''});
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/collaborations?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('협업을 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).collaborations))throw new Error('협업 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthCollaborationPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[editing,setEditing]=useState<{id:string;expectedVersion:number}|null>(null),[plan,setPlan]=useState<CollaborationPlan>(emptyPlan),[receipt,setReceipt]=useState({stage:'' as CollaborationStage|'',at:'',evidenceRef:'',note:'',disclosureConfirmed:false,authenticityConfirmed:false,paidKrw:''}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving;
 async function send(body:Record<string,unknown>,done:string){if(busy||writing.current||!view||stale)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,...body},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/collaborations',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;if(body.action==='save_plan')setEditing({id:String(body.id),expectedVersion:(v as {version:number}).version});else setReceipt(x=>({...x,stage:'',evidenceRef:'',note:''}));setStale(true);setMessage(`${done} 최신 조회가 실패해도 저장은 완료된 상태입니다.`);await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const recordStage=(r:Row)=>send({action:'record_stage',id:r.id,expectedVersion:r.version,receipt:{stage:receipt.stage,at:receipt.at?new Date(receipt.at).toISOString():'',evidenceRef:receipt.evidenceRef,note:receipt.note,disclosureConfirmed:receipt.disclosureConfirmed,authenticityConfirmed:receipt.authenticityConfirmed,paidKrw:receipt.paidKrw===''?null:Number(receipt.paidKrw)}},'단계 영수증을 기록했습니다.');
 const t=(k:keyof CollaborationPlan)=>(e:{target:{value:string}})=>setPlan({...plan,[k]:e.target.value});
 return <section aria-label="크리에이터 파트너 협업" className={styles.panel}><header className={styles.header}><h3>크리에이터·파트너 협업</h3><button type="button" disabled={busy} onClick={()=>void load()}>협업 새로고침</button></header>
  <p className={styles.note}>크리에이터·파트너 수요 단계의 브리프·청중 적합 근거·권리·수수료·추적 코드·일정을 기록하고, 합의→납품→승인(광고 표시·진정성 확인)→게시→정산을 운영자 증빙으로 남깁니다. 협업자 연락·메시지 발송·지급은 하지 않으며 연락처를 입력하지 마세요. 성과는 추적 코드로 연결된 게시 이후 주문이며 인과 효과가 아닙니다.</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">협업을 조회하고 있습니다.</p>}{stale&&<p className={styles.error}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<>{view.canEdit&&<button type="button" disabled={busy} onClick={()=>{setEditing({id:`collab-${crypto.randomUUID().slice(0,8)}`,expectedVersion:0});setPlan(emptyPlan());retry.current=null;}}>새 협업</button>}
   {editing&&<form onSubmit={e=>{e.preventDefault();void send({action:'save_plan',id:editing.id,expectedVersion:editing.expectedVersion,plan},'협업 계획을 저장했습니다.');}}><fieldset disabled={busy||!view.canEdit} className={styles.form}><legend>협업 {editing.id}</legend>
    <label className={styles.wide}>수요 단계<select value={`${plan.sequenceId}|${plan.stepId}`} onChange={e=>{const s=view.steps.find(x=>`${x.sequenceId}|${x.stepId}`===e.target.value);setPlan({...plan,sequenceId:s?.sequenceId??'',sequenceVersion:s?.sequenceVersion??1,stepId:s?.stepId??'',partnerKind:s?.placement==='partner'?'partner':'creator'});}}><option value="|">단계 선택</option>{view.steps.map(s=><option key={`${s.sequenceId}|${s.stepId}`} value={`${s.sequenceId}|${s.stepId}`}>{s.title} · {s.stepId} · {s.placement==='creator'?'크리에이터':'파트너'} · 계획 비용 {won(s.plannedCost)}</option>)}</select></label>
    <label>협업자 별칭(가명 ID)<input required value={plan.partnerAlias} onChange={t('partnerAlias')}/></label>
    <label className={styles.wide}>청중 적합 근거<textarea required maxLength={1000} value={plan.audienceFitEvidence} onChange={t('audienceFitEvidence')}/></label>
    <label className={styles.wide}>브리프<textarea required maxLength={3000} value={plan.brief} onChange={t('brief')}/></label>
    <label>사용 권리 범위<input required value={plan.rightsScope} onChange={t('rightsScope')}/></label><label>권리 기간(일)<input type="number" min={1} max={3650} value={plan.rightsDays} onChange={e=>setPlan({...plan,rightsDays:Number(e.target.value)})}/></label>
    <label className={styles.wide}>조건<input required value={plan.terms} onChange={t('terms')}/></label>
    <label>고정 수수료(원)<input type="number" min={0} value={plan.feeKrw??''} onChange={e=>setPlan({...plan,feeKrw:e.target.value===''?null:Number(e.target.value)})}/></label><label>성과 수수료율(0~0.5)<input type="number" step={0.01} min={0} max={0.5} value={plan.commissionRate??''} onChange={e=>setPlan({...plan,commissionRate:e.target.value===''?null:Number(e.target.value)})}/></label>
    <label>추적 코드 ID<input value={plan.trackingCodeId} onChange={t('trackingCodeId')}/></label>
    <label>납품 기한<input type="date" value={plan.deliverDueAt} onChange={t('deliverDueAt')}/></label><label>게시 기한<input type="date" value={plan.publishDueAt} onChange={t('publishDueAt')}/></label>
    <button type="submit" disabled={stale||!plan.stepId}>협업 계획 저장</button></fieldset></form>}
   {!view.collaborations.length&&<p>협업이 없습니다.</p>}
   <ul>{view.collaborations.map(r=><li key={r.id} style={{overflowWrap:'anywhere'}}><p><strong>{r.plan.partnerAlias}</strong> · {r.id} · {stageLabels[r.stage]} · 단계 {r.plan.stepId} · 수수료 {won(r.plan.feeKrw)}{r.plan.commissionRate!==null?` + ${(r.plan.commissionRate*100).toFixed(1)}%`:''} · 납품 {r.plan.deliverDueAt} · 게시 {r.plan.publishDueAt} · 원본 {r.sourceStatus==='held'?'보류':'현재'}</p>
    <p>성과: {r.performance.status==='observed'?`게시 이후 주문 ${r.performance.orders}건 · 순매출 ${won(r.performance.netRevenue)} · 공헌이익 ${won(r.performance.contribution)}`:r.performance.status==='not_published'?'게시 확인 전':r.performance.status==='no_tracking'?'추적 코드 없음':'보류'} · 인과 효과: 미측정</p>
    {[...r.sourceReasons,...r.warnings].map(x=><p key={x}>{x}</p>)}
    <p>영수증: {r.receipts.map(x=>`${stageLabels[x.stage]} ${x.at.slice(0,10)}${x.paidKrw!==undefined?` 지급 ${won(x.paidKrw)}`:''}`).join(' → ')||'없음'}</p>
    {view.canEdit&&r.stage==='proposed'&&<button type="button" disabled={busy||stale} onClick={()=>{setEditing({id:r.id,expectedVersion:r.version});setPlan(structuredClone(r.plan));retry.current=null;}}>{r.id} 계획 수정</button>}
    {nextStages[r.stage].length>0&&<fieldset className={styles.form}><legend>{r.id} 단계 영수증</legend>
     <label>다음 단계<select value={receipt.stage} onChange={e=>setReceipt({...receipt,stage:e.target.value as CollaborationStage})}><option value="">단계 선택</option>{nextStages[r.stage].map(s=><option key={s} value={s}>{stageLabels[s]}</option>)}</select></label>
     <label>발생 시각<input type="datetime-local" value={receipt.at} onChange={e=>setReceipt({...receipt,at:e.target.value})}/></label><label>증빙 ID<input value={receipt.evidenceRef} onChange={e=>setReceipt({...receipt,evidenceRef:e.target.value})}/></label>
     {receipt.stage==='approved'&&<><label><input type="checkbox" checked={receipt.disclosureConfirmed} onChange={e=>setReceipt({...receipt,disclosureConfirmed:e.target.checked})}/>광고·협찬 표시 확인</label><label><input type="checkbox" checked={receipt.authenticityConfirmed} onChange={e=>setReceipt({...receipt,authenticityConfirmed:e.target.checked})}/>가짜 참여·후기 없음 확인</label></>}
     {receipt.stage==='settled'&&<label>지급액(원)<input type="number" min={0} value={receipt.paidKrw} onChange={e=>setReceipt({...receipt,paidKrw:e.target.value})}/></label>}
     <button type="button" disabled={busy||stale||!receipt.stage||!receipt.at||!receipt.evidenceRef} onClick={()=>void recordStage(r)}>{r.id} 단계 기록</button></fieldset>}
   </li>)}</ul>
   <details><summary>협업 이력</summary>{view.history.map(x=><p key={x.id+':'+x.version}>{x.id} · v{x.version} · {stageLabels[x.stage]} · {x.updatedAt}</p>)}</details></>}
 </section>;
}
