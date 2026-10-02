'use client';
import {LockedNote} from '@/components/app/locked-note';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {metaText} from '@/lib/format';
import {CheckInput} from '@/components/app/check';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthExpansionView} from '@/lib/growth-expansion-server';
import type {ExpansionInput} from '@/lib/growth-expansion';
import styles from './growth-panel.module.css';
type View=GrowthExpansionView;
type Proposal=View['proposals'][number];
const statusLabels={proposed:'제안(예약 전)',reserved:'소유자 승인·예산 예약',withdrawn:'철회'} as const;
const won=(n:number|null|undefined)=>n===null||n===undefined?'미확인':`${n.toLocaleString('ko-KR')}원`;
const emptyInput=():ExpansionInput=>({missionId:'',missionVersion:1,experimentId:'',analysisNumber:1,nextBudget:0,addQuantity:0,rationale:''});
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/expansion?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('확대 검토를 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).proposals))throw new Error('확대 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthExpansionPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[input,setInput]=useState<ExpansionInput>(emptyInput),[authorityId,setAuthorityId]=useState(''),[rec,setRec]=useState({outcome:'observed' as 'observed'|'failed',mode:'final' as 'partial'|'final'|'release',actualAmount:'',actualLoss:'',evidenceRef:'',note:'',noExecution:false,noOutstandingObligations:false}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null),draftId=useRef('');
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);/* 활성 위임이 하나뿐이면 미리 고른다(과업 하네스: 고르는 입력 절약). */if(next.authorities.length===1)setAuthorityId(id=>id||next.authorities[0].id);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving,authority=view?.authorities.find(a=>a.id===authorityId);
 async function send(body:Record<string,unknown>,done:string){if(busy||writing.current||!view||stale)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,...body},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/expansion',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;if(body.action==='propose')draftId.current='';setStale(true);setMessage(`${done} 최신 조회가 실패해도 저장은 완료된 상태입니다.`);await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const num=(k:keyof ExpansionInput)=>(e:{target:{value:string}})=>setInput({...input,[k]:Number(e.target.value)});
 const reconcile=(p:Proposal)=>send({action:'reconcile',id:p.id,expectedVersion:p.version,commitmentVersion:p.commitment?.version,outcome:rec.outcome,reconciliation:{mode:rec.mode,actualAmount:rec.actualAmount===''?null:Number(rec.actualAmount),actualLoss:rec.actualLoss===''?null:Number(rec.actualLoss),evidenceRef:rec.evidenceRef,note:rec.note,noExecution:rec.noExecution,noOutstandingObligations:rec.noOutstandingObligations}},'확대 예약을 대사했습니다.');
 return <section aria-label="검증된 확대" className={styles.panel}><header className={styles.header}><h3>검증된 확대(1회 20% 이내)</h3><Button variant="panel" size="fit" aria-label="확대 검토 새로고침" type="button" disabled={busy} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>검증된 근거가 모두 갖춰졌을 때만 확대를 제안합니다. 조건은 사전등록 확증 실험의 최신 개선 근거(90일 이내, 같은 채널·오퍼 판, 개입 근거 판 동일), 양수 단위 공헌이익, 공유 가용 재고입니다. 예약은 소유자가 건별로 승인하며 서명된 총·일·주·손실 한도를 넓히지 않습니다. 상시 위임에 자동 확대 권한은 없고, 실제 광고비 변경·집행은 이 화면 밖에서 합니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">확대 검토를 조회하고 있습니다.</p>}{stale&&<p role="status" className={styles.warning}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<>{view.canPropose?<form onSubmit={e=>{e.preventDefault();if(!draftId.current)draftId.current=`expansion-${crypto.randomUUID().slice(0,8)}`;void send({action:'propose',id:draftId.current,expectedVersion:0,input},'확대를 제안했습니다. 아직 예약되지 않았습니다.');}}><fieldset disabled={busy} className={styles.form}><legend>확대 제안</legend>
    <label>미션 ID<Input required value={input.missionId} onChange={e=>setInput({...input,missionId:e.target.value})}/></label><label>미션 판<Input type="number" min={1} value={input.missionVersion} onChange={num('missionVersion')}/></label>
    <label>실험 ID<Input required value={input.experimentId} onChange={e=>setInput({...input,experimentId:e.target.value})}/></label><label>분석 회차<Input type="number" min={1} value={input.analysisNumber} onChange={num('analysisNumber')}/></label>
    <label>확대 후 예산(원)<Input type="number" min={1} value={input.nextBudget} onChange={num('nextBudget')}/></label><label>추가 판매 수량<Input type="number" min={0} value={input.addQuantity} onChange={num('addQuantity')}/></label>
    <label className={styles.wide}>확대 이유<Input required maxLength={1000} value={input.rationale} onChange={e=>setInput({...input,rationale:e.target.value})}/></label>
    <Button variant="panel" size="fit" type="submit" disabled={stale} disabledReason={stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':undefined}>확대 제안</Button></fieldset></form>:<LockedNote action="확대 제안" reason="제안 권한이 없습니다. 관리자에게 요청하세요."/>}
   {view.canReserve&&<label>예약에 쓸 활성 위임<NativeSelect value={authorityId} onChange={e=>setAuthorityId(e.target.value)}><option value="">위임 선택</option>{view.authorities.map(a=><option key={a.id} value={a.id}>{metaText([a.id,a.channel,a.accountId,`v${a.version}`])}</option>)}</NativeSelect></label>}
   {!view.proposals.length&&<EmptyLine next="확대 조건을 채운 미션이 생기면 위에서 제안할 수 있습니다.">확대 제안이 없습니다.</EmptyLine>}
   <ul>{view.proposals.map(p=><li key={p.id} className="wrap-anywhere"><p><MetaLine items={[<strong key="id">{p.id}</strong>,`v${p.version}`,statusLabels[p.status],`미션 ${p.input.missionId} → ${won(p.input.nextBudget)}`,`실험 ${p.evidence.experimentId} ${p.evidence.analysisNumber}회차(${p.evidence.status})`]}/></p>
    {p.assessment&&<><p><MetaLine items={[`증가분 ${won(p.assessment.increase)}`,`증분 ${p.assessment.incremental?'확인':'없음'}`,`이익 ${p.assessment.profitable?'양수':'미확인/음수'}`,`재고 ${p.assessment.capacity?'충분':'부족/미확인'}`,`범위 ${p.assessment.causalScope}`]}/></p>{p.assessment.reasons.map(x=><p key={x}>{x}</p>)}</>}
    {p.commitment&&<p><MetaLine items={[`확대 예약 ${won(p.commitment.reservedAmount)}`,`원장 ${p.commitment.status}`,`실비 ${won(p.commitment.actualAmount)}`,`손실 ${won(p.commitment.actualLoss)}`]}/></p>}
    {p.status==='proposed'&&<Button variant="panel" size="fit" type="button" disabled={!view.canReserve||busy||stale||!authority||!p.assessment?.allowed} disabledReason={!view.canReserve?'예약 권한이 없습니다. 소유자에게 요청하세요.':stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':!authority?'판매 위임을 먼저 고르세요.':(!p.assessment?.allowed)?'판매 위임 범위를 벗어났습니다.':undefined} onClick={()=>void send({action:'approve_reserve',id:p.id,expectedVersion:p.version,authorityId:authority!.id,authorityVersion:authority!.version},'소유자 승인으로 확대 예산을 예약했습니다. 집행은 별도입니다.')}>{p.id} 소유자 승인·예약</Button>}
    {p.status==='proposed'&&<Button variant="panel" size="fit" type="button" disabled={busy||stale} disabledReason={stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':undefined} onClick={()=>void send({action:'withdraw',id:p.id,expectedVersion:p.version},'제안을 철회했습니다.')}>{p.id} 철회</Button>}
    {p.status==='reserved'&&p.commitment&&!['reconciled','released'].includes(p.commitment.status)&&<fieldset className={styles.form}><legend>{p.id} 확대 예약 대사</legend>
     <label>집행 결과<NativeSelect value={rec.outcome} onChange={e=>setRec({...rec,outcome:e.target.value as 'observed'|'failed'})}><option value="observed">집행 확인</option><option value="failed">미집행 실패</option></NativeSelect></label>
     <label>대사 방법<NativeSelect value={rec.mode} onChange={e=>setRec({...rec,mode:e.target.value as 'partial'|'final'|'release'})}><option value="partial">부분</option><option value="final">최종</option><option value="release">무집행 해제</option></NativeSelect></label>
     <label>누적 실비(원)<Input type="number" min={0} value={rec.actualAmount} onChange={e=>setRec({...rec,actualAmount:e.target.value})}/></label><label>누적 손실(원)<Input type="number" min={0} value={rec.actualLoss} onChange={e=>setRec({...rec,actualLoss:e.target.value})}/></label>
     <label>대사 증빙 ID<Input value={rec.evidenceRef} onChange={e=>setRec({...rec,evidenceRef:e.target.value})}/></label><label>대사 근거<Input value={rec.note} onChange={e=>setRec({...rec,note:e.target.value})}/></label>
     <label><CheckInput checked={rec.noExecution} onChange={e=>setRec({...rec,noExecution:e.target.checked})}/>집행 없음 확인</label><label><CheckInput checked={rec.noOutstandingObligations} onChange={e=>setRec({...rec,noOutstandingObligations:e.target.checked})}/>잔여 의무 없음 확인</label>
     <Button variant="panel" size="fit" type="button" disabled={busy||stale||!rec.evidenceRef||!rec.note} disabledReason={stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':!rec.evidenceRef?'필수 칸을 먼저 채우세요.':!rec.note?'필수 칸을 먼저 채우세요.':undefined} onClick={()=>void reconcile(p)}>{p.id} 대사 기록</Button></fieldset>}
   </li>)}</ul>
   <details><summary>확대 이력</summary>{view.history.map(h=><p key={h.id+':'+h.version}><MetaLine items={[h.id,`v${h.version}`,statusLabels[h.status],h.updatedAt]}/></p>)}</details></>}
 </section>;
}
