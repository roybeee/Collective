'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthOptimizationView} from '@/lib/growth-optimization-server';
import {candidateKinds,failureKinds,MAX_KRW_BUDGET,MAX_TOKEN_BUDGET,type CandidateInput} from '@/lib/growth-optimization';
import styles from './growth-panel.module.css';
type View=GrowthOptimizationView;
type Row=View['candidates'][number];
const failureLabels={experiment_result:'실험 결과',lesson_application:'교훈 적용',journey:'구매 병목',cause_link:'원인 연결',cs_ticket:'고객 문의'} as const;
const kindLabels={prompt_unit:'프롬프트 단위',landing_copy:'상세 문구',offer_message:'오퍼 메시지',operating_rule:'운영 규칙'} as const;
const stageLabels={draft:'초안',frozen:'동결',offline_evaluated:'오프라인 평가',sales_linked:'판매 검증 연결',adopted:'채택(기존 경로 반영)',rolled_back:'되돌림',discarded:'폐기'} as const;
const salesLabels={not_linked:'미연결',sales_unverified:'판매 효과 미확인',sales_supported:'판매 개선 근거',sales_rejected:'판매 악화 근거'} as const;
const empty=():CandidateInput=>({failureKind:'experiment_result',failureId:'',failureVersion:1,failureSummary:'',candidateKind:'prompt_unit',targetRef:'',proposal:'',tokenBudget:50000,krwBudget:0});
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/optimization?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('최적화 후보를 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).candidates))throw new Error('후보 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthOptimizationPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[input,setInput]=useState<CandidateInput>(empty),[extra,setExtra]=useState({evalRunId:'',verdict:'pass',experimentId:'',ref:'',reason:'',evidenceRef:''}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null),draftId=useRef('');
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving;
 async function send(body:Record<string,unknown>,done:string){if(busy||writing.current||!view||stale)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,...body},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/optimization',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;if(body.action==='save_candidate'){draftId.current='';setInput(empty());}setStale(true);setMessage(`${done} 최신 조회가 실패해도 저장은 완료된 상태입니다.`);await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const act=(r:Row,action:string,done:string,more:Record<string,unknown>={})=>send({action,id:r.id,expectedVersion:r.version,...more},done);
 return <section aria-label="최적화 후보 샌드박스" className={styles.panel}><header className={styles.header}><h3>최적화 후보 · 샌드박스</h3><button aria-label="후보 새로고침" type="button" disabled={busy} onClick={()=>void load()}>새로고침</button></header>
  <p className={styles.note}>실제 실패 근거(악화·무효 실험, 실패한 교훈 적용, 병목, 원인, 문의)에서만 후보를 만들고 토큰 {MAX_TOKEN_BUDGET.toLocaleString('ko-KR')}·비용 {MAX_KRW_BUDGET.toLocaleString('ko-KR')}원 안에서 평가합니다. 동결 후 평가 실행·확증 실험만 연결하며, 오프라인 통과는 매출 개선이 아닙니다. 이 화면은 프롬프트 등록·승격·채점기·봉인을 바꾸지 않고, 채택은 기존 승인 경로의 반영 기록을 참조만 합니다.</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">후보를 조회하고 있습니다.</p>}{stale&&<p role="status" className={styles.warning}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<>{view.canEdit&&<form onSubmit={e=>{e.preventDefault();if(!draftId.current)draftId.current=`opt-${crypto.randomUUID().slice(0,8)}`;void send({action:'save_candidate',id:draftId.current,expectedVersion:0,input},'후보를 저장했습니다.');}}><fieldset disabled={busy} className={styles.form}><legend>새 최적화 후보</legend>
    <label>실패 근거 종류<select value={input.failureKind} onChange={e=>setInput({...input,failureKind:e.target.value as CandidateInput['failureKind']})}>{failureKinds.map(k=><option key={k} value={k}>{failureLabels[k]}</option>)}</select></label>
    <label>실패 근거 ID<input value={input.failureId} onChange={e=>setInput({...input,failureId:e.target.value})}/></label><label>실패 근거 판<input type="number" min={1} value={input.failureVersion} onChange={e=>setInput({...input,failureVersion:Number(e.target.value)})}/></label>
    <label className={styles.wide}>실패 원인 요약<input maxLength={1000} value={input.failureSummary} onChange={e=>setInput({...input,failureSummary:e.target.value})}/></label>
    <label>후보 종류<select value={input.candidateKind} onChange={e=>setInput({...input,candidateKind:e.target.value as CandidateInput['candidateKind']})}>{candidateKinds.map(k=><option key={k} value={k}>{kindLabels[k]}</option>)}</select></label>
    <label>대상 참조<input value={input.targetRef} onChange={e=>setInput({...input,targetRef:e.target.value})}/></label>
    <label className={styles.wide}>개선 제안<textarea maxLength={3000} value={input.proposal} onChange={e=>setInput({...input,proposal:e.target.value})}/></label>
    <label>토큰 예산<input type="number" min={0} max={MAX_TOKEN_BUDGET} value={input.tokenBudget} onChange={e=>setInput({...input,tokenBudget:Number(e.target.value)})}/></label><label>비용 예산(원)<input type="number" min={0} max={MAX_KRW_BUDGET} value={input.krwBudget} onChange={e=>setInput({...input,krwBudget:Number(e.target.value)})}/></label>
    <button type="submit" disabled={stale||!input.failureId||!input.proposal}>후보 저장</button></fieldset></form>}
   <fieldset className={styles.form} disabled={busy}><legend>단계 입력</legend><label>평가 실행 ID<input value={extra.evalRunId} onChange={e=>setExtra({...extra,evalRunId:e.target.value})}/></label><label>오프라인 판정<select value={extra.verdict} onChange={e=>setExtra({...extra,verdict:e.target.value})}><option value="pass">통과</option><option value="fail">실패</option></select></label><label>확증 실험 ID<input value={extra.experimentId} onChange={e=>setExtra({...extra,experimentId:e.target.value})}/></label><label>반영 기록 ID<input value={extra.ref} onChange={e=>setExtra({...extra,ref:e.target.value})}/></label><label>되돌림 사유<input value={extra.reason} onChange={e=>setExtra({...extra,reason:e.target.value})}/></label><label>되돌림 증빙 ID<input value={extra.evidenceRef} onChange={e=>setExtra({...extra,evidenceRef:e.target.value})}/></label></fieldset>
   {!view.candidates.length&&<p>최적화 후보가 없습니다.</p>}
   <ul>{view.candidates.map(r=><li key={r.id} className="wrap-anywhere"><p><strong>{kindLabels[r.input.candidateKind]} {r.input.targetRef}</strong> · {r.id} · {stageLabels[r.stage]} · 근거 {failureLabels[r.input.failureKind]} {r.input.failureId}{r.failureStatus==='changed'?' · 근거 변경':''}</p>
    <p>오프라인: {r.status.offline==='not_run'?'미실행':r.status.offline==='pass'?`통과(${r.offline?.evalRunId})`:'실패'} · 판매: {salesLabels[r.status.sales]} · {r.status.reason}</p>
    {view.canEdit&&r.stage==='draft'&&<button type="button" disabled={busy||stale} onClick={()=>void act(r,'freeze','후보를 동결했습니다.')}>{r.id} 동결</button>}
    {view.canEdit&&r.stage==='frozen'&&<button type="button" disabled={busy||stale||!extra.evalRunId} onClick={()=>void act(r,'record_offline','오프라인 평가를 연결했습니다.',{evalRunId:extra.evalRunId,verdict:extra.verdict})}>{r.id} 오프라인 평가 연결</button>}
    {view.canEdit&&r.stage==='offline_evaluated'&&<button type="button" disabled={busy||stale||!extra.experimentId} onClick={()=>void act(r,'link_sales','판매 확증 실험을 연결했습니다.',{experimentId:extra.experimentId})}>{r.id} 판매 실험 연결</button>}
    {view.canAdopt&&r.stage==='sales_linked'&&<button type="button" disabled={busy||stale||!r.status.adoptable||!extra.ref} onClick={()=>void act(r,'adopt','채택을 기록했습니다.',{ref:extra.ref})}>{r.id} 채택 기록</button>}
    {view.canEdit&&r.stage==='adopted'&&<button type="button" disabled={busy||stale||!extra.reason||!extra.evidenceRef} onClick={()=>void act(r,'rollback','되돌림을 기록했습니다.',{reason:extra.reason,evidenceRef:extra.evidenceRef})}>{r.id} 되돌림</button>}
    {view.canEdit&&['draft','frozen','offline_evaluated','sales_linked'].includes(r.stage)&&<button type="button" disabled={busy||stale} onClick={()=>void act(r,'discard','후보를 폐기했습니다.')}>{r.id} 폐기</button>}
   </li>)}</ul></>}
 </section>;
}
