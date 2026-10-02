'use client';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthDemandEvidenceView} from '@/lib/growth-demand-evidence-server';
import styles from './growth-panel.module.css';
type View=GrowthDemandEvidenceView;
type Row=View['records'][number];
type Basis={sequenceId:string;sequenceVersion:number;stepId:string;publicationLinkId:string;publicationLinkVersion:number;expectedVersion:number;campaignVersion:number};
const delivery={not_submitted:'전송 전',accepted:'공급자 접수(게시 아님)',published:'게시 완료',failed:'실패·취소',unknown:'결과 미확인'} as const;
const performance={held:'근거 보류',not_published:'게시 완료 전',collecting:'게시됨 · 관측 수집 중',observed:'관측 근거 있음'} as const;
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/demand-evidence?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('단계 근거를 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).records)||!Array.isArray((v as View).sequences))throw new Error('단계 근거 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthDemandEvidencePanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[sequenceId,setSequenceId]=useState(''),[stepId,setStepId]=useState(''),[linkId,setLinkId]=useState(''),[evidenceRef,setEvidenceRef]=useState(''),[basis,setBasis]=useState<Basis|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const sequence=view?.sequences.find(s=>s.sequenceId===sequenceId),step=sequence?.steps.find(s=>s.stepId===stepId),publication=view?.publications.find(p=>p.id===linkId),current=view?.records.find(r=>r.id===linkId);
 const nextBasis=():Basis|null=>view&&sequence&&publication?{sequenceId:sequence.sequenceId,sequenceVersion:sequence.sequenceVersion,stepId,publicationLinkId:publication.id,publicationLinkVersion:publication.version,expectedVersion:current?.version??0,campaignVersion:view.campaignVersion}:null;
 const fresh=nextBasis(),changed=!!basis&&JSON.stringify(basis)!==JSON.stringify(fresh),busy=loading||saving;
 function select(next:{sequenceId?:string;stepId?:string;linkId?:string}){const s=next.sequenceId??sequenceId,st=next.sequenceId!==undefined?'':next.stepId??stepId,l=next.linkId??linkId;setSequenceId(s);setStepId(st);setLinkId(l);setBasis(null);retry.current=null;setError('');setMessage('');}
 async function submit(action:'link'|'retire',row?:Row){if(busy||writing.current||!view?.canEdit||stale)return;
  const b=action==='retire'&&row?{sequenceId:row.input.sequenceId,sequenceVersion:row.input.sequenceVersion,stepId:row.input.stepId,publicationLinkId:row.input.publicationLinkId,publicationLinkVersion:row.input.publicationLinkVersion,expectedVersion:row.version,campaignVersion:view.campaignVersion}:basis??fresh;if(!b)return;if(action==='link'&&!basis){setBasis(b);}
  const {expectedVersion,campaignVersion,...rest}=b,payload={campaignId,campaignVersion,action,expectedVersion,input:{...rest,evidenceRef:action==='retire'&&row?row.input.evidenceRef:evidenceRef}},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};
  const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/demand-evidence',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error(r.status===409?`${(v as {error?:string})?.error??'판이 변경되었습니다.'} 새로고침 뒤 다시 선택하세요.`:(v as {error?:string})?.error??'근거 연결을 저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;setBasis(null);setStale(true);setMessage(action==='link'?'단계와 발행 근거를 연결했습니다. 최신 조회가 실패해도 저장은 완료된 상태입니다.':'연결을 해제했습니다. 이력은 보존됩니다.');await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 return <section aria-label="수요 단계 발행 근거" className={styles.panel}><header className={styles.header}><h3>수요 단계 ↔ 발행 근거</h3><Button variant="panel" size="fit" aria-label="단계 근거 새로고침" type="button" disabled={busy} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>자체 계정 자연 유입 단계에만 승인된 발행 연결을 붙입니다. 서버가 발행·측정·귀속 주문 기록을 직접 읽으며, 운영자 성과 메모와 구분합니다. 공급자 접수는 게시 완료가 아니고, 귀속 주문은 인과 효과가 아닙니다. 크리에이터·파트너·광고 단계는 별도 근거가 필요합니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">단계 근거를 조회하고 있습니다.</p>}{stale&&<p role="status" className={styles.warning}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<><form onSubmit={e=>{e.preventDefault();void submit('link');}}><fieldset disabled={busy||!view.canEdit} className={styles.form}><legend>단계에 발행 근거 연결</legend>
   <label>수요 시퀀스<NativeSelect value={sequenceId} onChange={e=>select({sequenceId:e.target.value})}><option value="">시퀀스 선택</option>{view.sequences.map(s=><option key={s.sequenceId} value={s.sequenceId}>{s.title||s.sequenceId} · v{s.sequenceVersion}</option>)}</NativeSelect></label>
   <label>수요 단계<NativeSelect value={stepId} onChange={e=>select({stepId:e.target.value})}><option value="">단계 선택</option>{sequence?.steps.map(st=><option key={st.stepId} value={st.stepId}>{st.stepId} · {st.channel}/{st.placement}{st.eligibility.length?' · 연결 불가':''}</option>)}</NativeSelect></label>
   <label>승인된 발행 연결<NativeSelect value={linkId} onChange={e=>select({linkId:e.target.value})}><option value="">발행 선택</option>{view.publications.map(p=><option key={p.id} value={p.id}>{p.publicationId} · {p.status} · v{p.version}{p.linkedTo?` · 연결됨(${p.linkedTo.stepId})`:''}</option>)}</NativeSelect></label>
   <label>연결 확인 근거 (개인정보 제외)<Input required maxLength={160} value={evidenceRef} onChange={e=>setEvidenceRef(e.target.value)}/></label>
   {step&&step.eligibility.map(x=><p key={x} className={styles.wide}>{x}</p>)}
   {changed&&<div className={styles.wide}><p>선택한 기준 판이 현재 기록과 다릅니다. 입력을 보존했습니다.</p><Button variant="panel" size="fit" type="button" disabled={stale} onClick={()=>{setBasis(fresh);retry.current=null;setError('');}}>현재 입력 유지 · 최신 판 채택</Button></div>}
   <Button variant="panel" size="fit" type="submit" disabled={!step||!!step.eligibility.length||!publication||!evidenceRef||changed||stale}>{current?.status==='active'?'다른 단계로 다시 연결':'근거 연결'}</Button></fieldset></form>
  <h4>단계별 서버 근거</h4>{!view.records.some(r=>r.status==='active')&&<p>연결된 단계 근거가 없습니다. 성과 없음의 증명은 아닙니다.</p>}
  <ul>{view.records.filter(r=>r.status==='active').map(r=>{const a=r.assessment!,m=a.evidence.measurement,at=a.evidence.attribution;return <li key={r.id} className="wrap-anywhere"><p>{r.input.sequenceId} / {r.input.stepId} ← 발행 {r.snapshot.publicationId} · 연결 v{r.version} · {performance[a.performance]}</p><p>게시 상태: {delivery[a.evidence.deliveryState]} · 인과 효과: 미측정</p>{m&&<p>측정: {m.status==='held'?'보류':m.value?`분모 ${m.value.denominator??'미확인'} · 분자 ${m.value.numerator??'미확인'} (${m.window?.from}~${m.window?.to})`:'값 없음'}</p>}{at&&<p>귀속 주문: {at.status==='observed'&&at.value?`${at.value.orders}건 · 순매출 ${at.value.netRevenue.toLocaleString('ko-KR')}원 · 공헌이익 ${at.value.contribution===null?'미확인':at.value.contribution.toLocaleString('ko-KR')+'원'}`:at.status==='no_rows'?'해당 기간 행 없음':'보류'}</p>}{a.reasons.map(x=><p key={x}>{x}</p>)}{view.canEdit&&<Button variant="panel" size="fit" type="button" disabled={busy||stale} onClick={()=>void submit('retire',r)}>연결 해제</Button>}</li>})}</ul>
  <details><summary>연결 이력</summary>{view.history.map(h=><p key={h.id+':'+h.version} className="wrap-anywhere">{h.input.sequenceId}/{h.input.stepId} · 발행 연결 {h.id} · v{h.version} · {h.status==='active'?'연결':'해제'} · {h.recordedAt}</p>)}</details></>}
 </section>;
}
