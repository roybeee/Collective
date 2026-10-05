'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {askConfirm} from '@/components/app/confirm-dialog';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {clientId} from '@/lib/client';
import {dateTime} from '@/lib/format';
import s from './product-research.module.css';

type Plan={id:string;digest:string;expiresAt:string;status:string;total:number;counts:{kind:string;records:number}[];heldReasons:string[];externalDeletion:string};
type View={settings:{automaticEnabled:boolean};latestPlan:Plan|null;receipts:{id:string;at:string;deleted:number;mode:string}[];externalEvidence:{id:string;reference:string;note:string}[]};
export function ResearchRetentionActions({canInspect}:{canInspect:boolean}){
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [reference,setReference]=useState(''),[note,setNote]=useState('');
 async function request(body?:Record<string,unknown>){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/product-research/retention',body?{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:clientId(),...body})}:{credentials:'same-origin'});
   const result=await response.json() as View&{error?:string};if(!response.ok)throw new Error(result.error||'보존 처리를 확인하지 못했습니다.');setView(result);
  }catch(e){setError(e instanceof Error?e.message:'보존 처리를 확인하지 못했습니다.')}
  finally{setBusy(false)}
 }
 async function apply(){
  const plan=view?.latestPlan;if(!plan)return;
  if(!await askConfirm({title:'확인한 보존 계획을 적용할까요?',impact:`이 소유자의 만료 자료 ${plan.total}건을 처리합니다. 자료가 바뀌면 계획을 다시 확인해야 합니다. 외부 복사본은 별도 확인이 필요합니다.`,undo:'삭제된 원문은 되돌릴 수 없습니다.',confirmLabel:'계획 적용',danger:true}))return;
  await request({action:'apply',planId:plan.id,digest:plan.digest,confirmed:true});
 }
 async function configure(){
  const enabled=!view?.settings.automaticEnabled;
  if(!await askConfirm({title:`자동 보존 처리를 ${enabled?'켤까요':'끌까요'}?`,impact:enabled?'작업자가 연결돼 실행될 때, 확인 가능한 만료 YouTube 자료를 정리합니다. 수집 스위치와 별개이며 불완전한 계보나 사업 기록 연결은 보류합니다.':'이후 자동 보존 처리를 중단합니다.',undo:'설정은 다시 바꿀 수 있지만 이미 처리된 자료는 복구할 수 없습니다.',confirmLabel:enabled?'자동 처리 켜기':'자동 처리 끄기',danger:enabled}))return;
  await request({action:'configure',automaticEnabled:enabled,confirmed:true});
 }
 const plan=view?.latestPlan;
 return <section className={s.block} aria-label="보존 계획과 처리">
  <h3 className={s.subtitle}>보존 계획과 처리</h3>
  <p className={s.muted}>삭제 전 영향을 확인합니다. 승인·판매 기록에 연결됐거나 계보를 확인할 수 없으면 처리를 보류합니다.</p>
  <Button variant="outline" disabled={!canInspect||busy} disabledReason={!canInspect?'소유자만 보존 처리를 관리할 수 있습니다.':undefined} onClick={()=>void request()}>보존 처리 열기</Button>
  {error&&<p role="alert">{error}</p>}
  {view&&<div aria-live="polite">
   <p>자동 보존 처리: {view.settings.automaticEnabled?'켜짐':'꺼짐'}</p>
   <div className={s.toolbar}>
    <Button variant="outline" disabled={busy} onClick={()=>void request({action:'preview'})}>삭제 계획 확인</Button>
    <Button variant="outline" disabled={busy} onClick={()=>void configure()}>자동 처리 {view.settings.automaticEnabled?'끄기':'켜기'}</Button>
   </div>
   {plan&&<div>
    <p>처리 대상 {plan.total}건</p><p className={s.muted}>계획 유효 기한: {dateTime(plan.expiresAt)}</p>
    {plan.counts.map(row=><p key={row.kind}>{row.kind}: {row.records}건</p>)}
    {plan.heldReasons.map(reason=><p role="status" key={reason}>{reason}</p>)}
    <Button disabled={busy||plan.status!=='ready'||!plan.total} disabledReason={plan.status!=='ready'?'계획의 보류 사유를 먼저 해결하세요.':!plan.total?'처리할 만료 자료가 없습니다.':undefined} onClick={()=>void apply()}>확인한 계획 적용</Button>
   </div>}
   <h4>최근 내부 처리</h4>
   {view.receipts.length?view.receipts.map(row=><p key={row.id}><MetaLine items={[dateTime(row.at),`${row.deleted}건`,row.mode==='automatic'?'자동':'수동']}/></p>):<EmptyLine next="삭제 계획 확인으로 처리할 자료가 있는지 먼저 확인하세요.">처리 이력이 없습니다.</EmptyLine>}
   <h4>외부 복사본 처리 증빙</h4>
   <p className={s.muted}>공급자 삭제 확인 자료를 등록합니다. 등록은 운영자 진술이며 공급자의 실제 삭제 확인은 별도로 필요합니다.</p>
   <label className="field"><span>외부 처리 증빙 참조</span><Input value={reference} maxLength={300} onChange={e=>setReference(e.target.value)} placeholder="확인 문서 주소 또는 접수 번호"/></label>
   <label className="field"><span>확인 내용</span><Input value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></label>
   <Button variant="outline" disabled={busy||!reference.trim()||!note.trim()} disabledReason={!reference.trim()||!note.trim()?'증빙 참조와 확인 내용을 입력하세요.':undefined} onClick={()=>void request({action:'record_external_evidence',reference,note,confirmed:true})}>외부 처리 증빙 저장</Button>
   {view.externalEvidence.map(row=><p key={row.id}><MetaLine items={[row.reference,row.note,'운영자 증빙']}/></p>)}
  </div>}
 </section>;
}
