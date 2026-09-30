'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthLandingView} from '@/lib/growth-landing-server';
import {landingSectionKinds,type LandingProposalInput,type LandingSection} from '@/lib/growth-landing';
import styles from './growth-panel.module.css';
type View=GrowthLandingView;
type Proposal=View['proposals'][number];
const sectionLabels:Record<LandingSection['kind'],string>={headline:'제목',purchase_reason:'구매 이유',price_display:'가격 표시',shipping:'배송',returns:'반품·교환',trust:'신뢰 근거',option_guide:'옵션 안내',faq:'자주 묻는 질문',cta:'구매 버튼 문구'};
const statusLabels={draft:'초안',approved:'승인(페이지 미변경)',applied:'적용 확인(운영자)',rolled_back:'되돌림 확인',withdrawn:'철회'} as const;
const emptySection=():LandingSection=>({kind:'headline',before:'',after:'',factIds:[]});
const emptyInput=():LandingProposalInput=>({title:'',offerId:'',offerVersion:0,journeyId:'',journeyVersion:0,landingUrl:'',rationale:'',rollbackPlan:'',sections:[emptySection()]});
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/landing?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('상세페이지 수정안을 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).proposals))throw new Error('수정안 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthLandingPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[editing,setEditing]=useState<{id:string;expectedVersion:number}|null>(null),[input,setInput]=useState<LandingProposalInput>(emptyInput),[receipt,setReceipt]=useState({at:'',evidenceRef:'',reason:''}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving,offer=view?.offers.find(o=>o.id===input.offerId),current=editing?view?.proposals.find(p=>p.id===editing.id):undefined,conflict=!!editing&&editing.expectedVersion>0&&current?.version!==editing.expectedVersion;
 function startNew(){setEditing({id:`landing-${crypto.randomUUID().slice(0,8)}`,expectedVersion:0});setInput(emptyInput());retry.current=null;setError('');setMessage('');}
 function edit(p:Proposal){setEditing({id:p.id,expectedVersion:p.version});setInput(structuredClone(p.input));retry.current=null;setError('');setMessage('');}
 const section=(i:number,patch:Partial<LandingSection>)=>setInput(x=>({...x,sections:x.sections.map((s,j)=>j===i?{...s,...patch}:s)}));
 async function send(body:Record<string,unknown>,done:string){if(busy||writing.current||!view||stale)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,...body},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/landing',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;if(body.action==='save_proposal')setEditing({id:String(body.id),expectedVersion:(v as {version:number}).version});setStale(true);setMessage(`${done} 최신 조회가 실패해도 저장은 완료된 상태입니다.`);await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const receiptBody=(p:Proposal)=>({at:receipt.at?new Date(receipt.at).toISOString():'',evidenceRef:receipt.evidenceRef,observedUrl:p.input.landingUrl,reason:receipt.reason});
 return <section aria-label="상세페이지 수정안" className={styles.panel}><header className={styles.header}><h3>상세페이지 수정안 · 적용 확인</h3><button type="button" disabled={busy} onClick={()=>void load()}>수정안 새로고침</button></header>
  <p className={styles.note}>수정안은 오퍼·상품·확정 사실 판에 고정한 검토 산출물입니다. 승인은 페이지 변경이 아니며, 운영자가 실제 판매처 페이지를 바꾼 뒤 확인 증빙으로 적용·되돌림을 기록합니다. 판매처 자동 수정 연동은 없습니다. 가격은 승인된 오퍼 가격만, 재고 수량 문구는 쓸 수 없습니다.</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">수정안을 조회하고 있습니다.</p>}{stale&&<p className={styles.error}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<>{view.canEdit&&<button type="button" disabled={busy} onClick={startNew}>새 수정안</button>}
   {editing&&<form onSubmit={e=>{e.preventDefault();void send({action:'save_proposal',id:editing.id,expectedVersion:editing.expectedVersion,input},'수정안을 저장했습니다.');}}><fieldset disabled={busy||!view.canEdit} className={styles.form}><legend>수정안 {editing.id}</legend>
    <label>수정안 제목<input required maxLength={200} value={input.title} onChange={e=>setInput({...input,title:e.target.value})}/></label>
    <label>판매 오퍼<select value={input.offerId} onChange={e=>{const o=view.offers.find(x=>x.id===e.target.value);setInput({...input,offerId:e.target.value,offerVersion:o?.version??0,landingUrl:o?.landingUrl??''});}}><option value="">오퍼 선택</option>{view.offers.map(o=><option key={o.id} value={o.id}>{o.title||o.id} · v{o.version}</option>)}</select></label>
    {offer&&<p className={styles.wide}>상세페이지 {offer.landingUrl||'미등록'} · 승인 가격 {offer.priceApproved&&offer.price!==null?`${offer.price.toLocaleString('ko-KR')}원`:'미승인'}</p>}
    <label>연결할 구매 병목(선택)<select value={input.journeyId} onChange={e=>{const j=view.journeys.find(x=>x.journeyId===e.target.value);setInput({...input,journeyId:e.target.value,journeyVersion:j?.journeyVersion??0});}}><option value="">연결 안 함</option>{view.journeys.map(j=><option key={j.journeyId} value={j.journeyId}>{j.title||j.journeyId} · v{j.journeyVersion}</option>)}</select></label>
    <label className={styles.wide}>변경 이유<textarea required maxLength={2000} value={input.rationale} onChange={e=>setInput({...input,rationale:e.target.value})}/></label>
    <label className={styles.wide}>되돌림 기준<input required maxLength={1000} value={input.rollbackPlan} onChange={e=>setInput({...input,rollbackPlan:e.target.value})}/></label>
    {input.sections.map((s,i)=><fieldset key={i} className={styles.wide}><legend>구역 {i+1}</legend>
     <label>구역 종류 {i+1}<select value={s.kind} onChange={e=>section(i,{kind:e.target.value as LandingSection['kind']})}>{landingSectionKinds.map(k=><option key={k} value={k}>{sectionLabels[k]}</option>)}</select></label>
     <label>현재 문구 {i+1}<textarea maxLength={2000} value={s.before} onChange={e=>section(i,{before:e.target.value})}/></label>
     <label>변경 문구 {i+1}<textarea required maxLength={2000} value={s.after} onChange={e=>section(i,{after:e.target.value})}/></label>
     <label>확정 사실 근거 {i+1}<select multiple value={s.factIds} onChange={e=>section(i,{factIds:[...e.target.selectedOptions].map(o=>o.value)})}>{view.facts.map(f=><option key={f.id} value={f.id}>{f.key} · v{f.version}</option>)}</select></label>
     {input.sections.length>1&&<button type="button" onClick={()=>setInput(x=>({...x,sections:x.sections.filter((_,j)=>j!==i)}))}>구역 {i+1} 삭제</button>}</fieldset>)}
    {input.sections.length<12&&<button type="button" onClick={()=>setInput(x=>({...x,sections:[...x.sections,emptySection()]}))}>구역 추가</button>}
    {conflict&&<div className={styles.wide}><p>이 수정안이 다른 곳에서 바뀌었습니다. 입력을 보존했습니다.</p><button type="button" disabled={stale||!current} onClick={()=>{if(current)setEditing({id:current.id,expectedVersion:current.version});retry.current=null;}}>현재 입력 유지 · 최신 판 채택</button></div>}
    <button type="submit" disabled={conflict||stale||!input.offerId}>수정안 저장</button></fieldset></form>}
   <label>적용·되돌림 시각<input type="datetime-local" value={receipt.at} onChange={e=>setReceipt({...receipt,at:e.target.value})}/></label>
   <label>페이지 확인 증빙 ID<input maxLength={100} pattern="[A-Za-z0-9_-]+" value={receipt.evidenceRef} onChange={e=>setReceipt({...receipt,evidenceRef:e.target.value})}/></label>
   <label>되돌림 사유<input maxLength={500} value={receipt.reason} onChange={e=>setReceipt({...receipt,reason:e.target.value})}/></label>
   {!view.proposals.length&&<p>수정안이 없습니다.</p>}
   <ul>{view.proposals.map(p=><li key={p.id} style={{overflowWrap:'anywhere'}}><p><strong>{p.input.title}</strong> · {p.id} · v{p.version} · {statusLabels[p.status]} · 원본 {p.sourceStatus==='held'?'보류':'현재'}</p>
    <p>페이지 변경: {p.pageChanged==='operator_attested'?`운영자 확인 ${p.applied?.at}`:p.pageChanged==='rolled_back'?`되돌림 확인 ${p.rolledBack?.at}`:'확인되지 않음'} · 효과: 미측정</p>
    {[...p.sourceReasons,...p.readiness.missing].map(x=><p key={x}>{x}</p>)}
    {view.canEdit&&p.status==='draft'&&<><button type="button" disabled={busy||stale} onClick={()=>edit(p)}>{p.id} 수정</button><button type="button" disabled={busy||stale||p.sourceStatus==='held'||!!p.readiness.missing.length} onClick={()=>void send({action:'approve',id:p.id,expectedVersion:p.version},'승인했습니다. 페이지는 아직 바뀌지 않았습니다.')}>{p.id} 승인</button></>}
    {(p.status==='draft'||p.status==='approved')&&<button type="button" disabled={busy||stale} onClick={()=>void send({action:'withdraw',id:p.id,expectedVersion:p.version},'철회했습니다.')}>{p.id} 철회</button>}
    {p.status==='approved'&&<button type="button" disabled={busy||stale||!receipt.at||!receipt.evidenceRef} onClick={()=>void send({action:'record_applied',id:p.id,expectedVersion:p.version,receipt:receiptBody(p)},'적용 확인을 기록했습니다.')}>{p.id} 적용 확인 기록</button>}
    {p.status==='applied'&&<button type="button" disabled={busy||stale||!receipt.at||!receipt.evidenceRef||!receipt.reason} onClick={()=>void send({action:'record_rollback',id:p.id,expectedVersion:p.version,receipt:receiptBody(p)},'되돌림을 기록했습니다.')}>{p.id} 되돌림 기록</button>}
   </li>)}</ul>
   <details><summary>구매 병목의 적용 근거</summary>{view.journeys.map(j=><p key={j.journeyId}>{j.title||j.journeyId} · {j.basis==='operator_receipt'?`적용 영수증 ${j.receipts.length}건`:j.basis==='raw_applied_at_only'?'직접 입력한 적용 시각만 있음(영수증 아님)':'적용 기록 없음'}</p>)}</details>
   <details><summary>수정안 이력</summary>{view.history.map(h=><p key={h.id+':'+h.version}>{h.id} · v{h.version} · {statusLabels[h.status]} · {h.updatedAt}</p>)}</details></>}
 </section>;
}
