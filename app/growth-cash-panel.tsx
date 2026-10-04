'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {NativeSelect} from '@/components/ui/native-select';
import {Note} from '@/components/app/note';
import {MetaLine} from '@/components/app/meta-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import {clientId} from '@/lib/client';
import {cashKinds,type CashInput,type CashKind,type CashPeriod} from '@/lib/growth-cash';
import type {CashRecord,GrowthCashView} from '@/lib/growth-cash-server';
import {useAccount} from './account-context';
import styles from './growth-panel.module.css';
const labels:Record<CashKind,string>={inventory_purchase:'매입·재고 실지급',marketing_payment:'광고·제작비 실지급',refund_payment:'고객 환불 실지급',fee_payment:'별도 수수료 실지급',other_payment:'기타 실지급',other_receipt:'기타 실입금'};
const won=(n:number|null)=>n===null?'미확인':`${n.toLocaleString('ko-KR')}원`;
type Props={campaignId:string;period:CashPeriod;onChanged:()=>void};
export function GrowthCashPanel(props:Props){const account=useAccount();return account?.isAdmin?<CashWorkspace key={`${props.campaignId}:${props.period.from}:${props.period.to}`} {...props}/>:<Note>실제 입출금 증빙의 기록·기간 확인은 관리자만 할 수 있습니다.</Note>}
const blank=()=>({id:clientId(),version:0,kind:'inventory_purchase' as CashKind,accountRef:'',receiptRef:'',amount:'',occurredAt:new Date().toISOString(),evidenceRef:'',reason:''});
function CashWorkspace({campaignId,period,onChanged}:Props){
 const [view,setView]=useState<GrowthCashView|null>(null),[form,setForm]=useState(blank),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[attestation,setAttestation]=useState(''),[complete,setComplete]=useState(false);
 const sending=useRef(false),request=useRef<{key:string;id:string}|null>(null),reading=useRef<AbortController|null>(null);
 const {from,to}=period;
 const load=useCallback(async()=>{
  reading.current?.abort();const controller=new AbortController();reading.current=controller;
  try{const q=new URLSearchParams({campaignId,from,to}),r=await fetch(`/api/growth/cash?${q}`,{cache:'no-store',signal:controller.signal}),v=await r.json() as GrowthCashView&{error?:string};if(!r.ok)throw Error(v.error||'현금 원장을 불러오지 못했습니다.');if(!controller.signal.aborted){setView(v);setError('')}return !controller.signal.aborted}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'현금 조회 실패');return false}
 },[campaignId,from,to]);
 useEffect(()=>{void Promise.resolve().then(()=>load());return()=>reading.current?.abort()},[load]);
 async function act(payload:Record<string,unknown>){
  if(!view||sending.current)return false;sending.current=true;setBusy(true);setError('');setNotice('');
  const base={campaignId,campaignVersion:view.campaignVersion,...payload},key=JSON.stringify(base);
  if(request.current?.key!==key)request.current={key,id:clientId()};
  let saved=false;
  try{
   const r=await fetch('/api/growth/cash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,requestId:request.current.id})}),v=await r.json() as {error?:string};
   if(!r.ok)throw Error(v.error||'현금 기록을 저장하지 못했습니다.');
   saved=true;const fresh=await load();onChanged();setComplete(false);
   setNotice(fresh?'실제 현금 기록을 저장했습니다. 운영자가 증빙으로 확인한 기록입니다.':'저장은 완료됐지만 최신 조회에 실패했습니다. 새로고침으로 확인하세요.');
   return fresh;
  }catch(e){setError(saved?'저장은 완료됐지만 최신 조회에 실패했습니다.':e instanceof Error?e.message:'저장 응답을 확인하지 못했습니다. 같은 입력으로 다시 시도하세요.');return false}
  finally{sending.current=false;setBusy(false)}
 }
 async function save(){
  const amount=form.amount.trim()===''?null:Number(form.amount),input:CashInput={kind:form.kind,accountRef:form.accountRef,receiptRef:form.receiptRef,currency:'KRW',amount,occurredAt:form.occurredAt,evidenceRef:form.evidenceRef,reason:form.reason,origin:'operator_attested'};
  if(await act({action:'save_cash',id:form.id,expectedVersion:form.version,input}))setForm(blank());
 }
 function edit(row:CashRecord){setForm({id:row.id,version:row.version,...row.input,amount:row.input.amount===null?'':String(row.input.amount),reason:''});setNotice('기존 거래 참조를 유지하고 실제 금액·시각·증빙을 정정합니다. 무효 기록은 저장하면 복원됩니다.')}
 async function voidRow(row:CashRecord){
  if(sending.current)return;
  const ok=await askConfirm({title:'현금 기록을 무효 처리할까요?',impact:'합계에서 제외하고 기존 판과 무효 이력은 보존합니다. 실제 은행 거래는 그대로 유지됩니다.',undo:'같은 기록을 정정해 다시 활성화할 수 있습니다.',confirmLabel:'무효 기록',danger:true});
  if(ok)await act({action:'void_cash',id:row.id,expectedVersion:row.version,reason:'운영자가 기존 증빙을 검토하여 무효 처리'});
 }
 const why=!view?.canEdit?'관리자만 활성 캠페인의 현금을 변경할 수 있습니다.':'';
 return <section className={styles.panel} aria-label="실제 입출금 원장">
  <header className={styles.header}><h4>실제 입출금 원장</h4><Button variant="panel" size="fit" disabled={busy} onClick={()=>void load()}>현금 원장 새로고침</Button></header>
  <Note>운영자가 증빙을 보고 기록한 실제 KRW 입출금입니다. 예상 원가·미지급 비용은 넣지 않습니다. 정산의 실입금액은 이미 실제 입금한 금액이므로 표시된 정산 수수료를 다시 빼지 않습니다. 별도 수수료·환불은 실제 계좌 출금이 있을 때만 기록하세요.</Note>
  <Note>계정·거래 참조는 개인정보 없는 내부 식별자입니다. 정산과 은행 증빙의 같은 입금에는 반드시 동일한 계정 참조·개별 입금 참조를 쓰세요. 같은 거래를 두 원장에 중복으로 넣을 수 없습니다. 은행 계좌번호·고객 이름·연락처는 입력하지 마세요.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status">{notice}</p>}
  {view&&<>
   <p><MetaLine items={[`기간 ${period.from}~${period.to} (UTC)`,`실제 입금 ${won(view.summary.actualReceipts)}`,`실제 지급 ${won(view.summary.actualPayments)}`,`순현금 ${won(view.summary.netCashFlow)}`]}/></p>
   {view.summary.reasons.map(reason=><p key={reason}>{reason}</p>)}
   <form className={styles.form} onSubmit={e=>{e.preventDefault();void save()}}>
    <label>거래 종류<NativeSelect value={form.kind} disabled={busy||!!why} onChange={e=>setForm({...form,kind:e.target.value as CashKind})}>{cashKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</NativeSelect></label>
    <label>계정 참조<Input value={form.accountRef} disabled={busy||!!why||form.version>0} onChange={e=>setForm({...form,accountRef:e.target.value})} required maxLength={100}/></label>
    <label>은행 거래 참조<Input value={form.receiptRef} disabled={busy||!!why||form.version>0} onChange={e=>setForm({...form,receiptRef:e.target.value})} required maxLength={100}/></label>
    <label>실제 금액(원, 미확인은 비워둠)<Input type="number" min="0" step="1" value={form.amount} disabled={busy||!!why} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
    <label>실제 입출금 시각(UTC ISO)<Input value={form.occurredAt} disabled={busy||!!why} onChange={e=>setForm({...form,occurredAt:e.target.value})} required placeholder="2026-10-04T00:00:00Z"/></label>
    <label>입출금 증빙 참조<Input value={form.evidenceRef} disabled={busy||!!why} onChange={e=>setForm({...form,evidenceRef:e.target.value})} required maxLength={100}/></label>
    <label>기록·정정 사유<Input value={form.reason} disabled={busy||!!why} onChange={e=>setForm({...form,reason:e.target.value})} minLength={5} maxLength={300} required/></label>
    <Button variant="panel" size="fit" type="submit" disabled={busy||!!why} disabledReason={why}>{form.version?'현금 기록 정정':'실제 현금 기록'}</Button>
    {form.version>0&&<Button variant="panel" size="fit" type="button" disabled={busy} onClick={()=>setForm(blank())}>정정 취소</Button>}
   </form>
   <ul>{view.entries.map(row=><li key={row.id}><MetaLine items={[labels[row.input.kind],won(row.input.amount),`${row.input.accountRef}/${row.input.receiptRef}`,row.input.occurredAt,`증빙 ${row.input.evidenceRef}`,row.status==='void'?'무효':'유효',`판 ${row.version}`]}/> <Button variant="panel" size="fit" disabled={busy||!!why} disabledReason={why} onClick={()=>edit(row)}>정정</Button> {row.status==='active'&&<Button variant="panel" size="fit" disabled={busy||!!why} disabledReason={why} onClick={()=>void voidRow(row)}>무효 처리</Button>}</li>)}</ul>
   <details><summary>정정·무효 이력 {view.history.length}건</summary><ul>{view.history.map(row=><li key={`${row.id}:${row.version}`}><MetaLine items={[`${row.id} 판 ${row.version}`,row.status,won(row.input.amount),row.voidReason||row.input.reason,row.updatedAt]}/></li>)}</ul></details>
   <form className={styles.form} onSubmit={e=>{e.preventDefault();void act({action:'attest_period',id:view.coverageId,expectedVersion:view.coverage?.version??0,period: view.period,inputDigest:view.inputDigest,evidenceRef:attestation,confirmedComplete:complete})}}>
    <h4>기간 입출금 완전성 확인</h4>
    <label>기간 대사 증빙 참조<Input value={attestation} disabled={busy||!!why} onChange={e=>setAttestation(e.target.value)} required maxLength={100}/></label>
    <label><Checkbox checked={complete} disabled={busy||!!why} onCheckedChange={value=>setComplete(value===true)}/>기간의 모든 입금·매입·광고·환불·별도 수수료를 확인했고 누락·중복이 없습니다. 은행 자동 검증이 아닌 운영자 확인입니다.</label>
    <Button variant="panel" size="fit" type="submit" disabled={busy||!!why||!complete||!!view.summary.unknownItems||!!view.summary.duplicateIdentities} disabledReason={why||(!complete?'기간의 전체 입출금 확인 항목을 선택하세요.':'미확인 금액과 중복 거래를 먼저 해결하세요.')}>기간 완전성 확인 기록</Button>
   </form>
  </>}
 </section>;
}
