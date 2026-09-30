'use client';

import {useState,type ReactNode} from 'react';
import type {SettlementEvidence,projectSettlements} from '@/lib/growth-settlement';
import styles from './growth-panel.module.css';

export type GrowthSettlementView=ReturnType<typeof projectSettlements>;
type Order={id:string;version:number;orderDate:string};
type Props={orders:Order[];settlement:GrowthSettlementView;canEdit:boolean;busy:boolean;save:(body:Record<string,unknown>,message:string)=>Promise<boolean>};
type Total=GrowthSettlementView['receivedCash'];
const money=(value:number|null)=>value===null?'미확인':`${value.toLocaleString('ko-KR')}원`;
function Field({label,children}:{label:string;children:ReactNode}){return <div className={styles.field}><label>{label}{children}</label></div>;}
function empty(kind:SettlementEvidence['kind']='expected'):SettlementEvidence{
 return {eventId:crypto.randomUUID(),revision:1,kind,orderId:'',orderVersion:0,accountRef:'',settlementRef:'',receiptRef:'',currency:'KRW',amount:null,feeAmount:null,taxBasis:'unknown',occurredAt:new Date().toISOString(),evidenceRef:'',origin:'operator_attested'};
}
function AmountSummary({name,value}:{name:string;value:Total}){
 return <div><dt>{name}</dt><dd>{money(value.total)}</dd>{!value.complete&&<small>{value.unknownCount>0?`금액 미확인 ${value.unknownCount}건 · 확인된 부분 ${money(value.knownAmount)}`:'등록된 해당 증빙이 없습니다.'}</small>}</div>;
}

export function GrowthSettlementPanel({orders,settlement,canEdit,busy,save}:Props){
 const [draft,setDraft]=useState<SettlementEvidence>(()=>empty()),[baseRevision,setBaseRevision]=useState(0);
 const selected=settlement.events.find(event=>event.eventId===draft.eventId),order=orders.find(row=>row.id===draft.orderId);
 const stale=!!selected&&selected.revision!==baseRevision;
 const modified=!selected||JSON.stringify({...draft,revision:selected.revision})!==JSON.stringify(selected);
 const latestOrderVersion=order?.version??0;
 function change(patch:Partial<SettlementEvidence>){setDraft(current=>({...current,...patch}))}
 function choose(eventId:string){const event=settlement.events.find(row=>row.eventId===eventId);setBaseRevision(event?.revision??0);setDraft(event?{...event,revision:event.revision+1,orderVersion:orders.find(row=>row.id===event.orderId)?.version??event.orderVersion}:empty())}
 function newEvent(kind:SettlementEvidence['kind'],split=false){
  const next=empty(kind);setBaseRevision(0);setDraft(split?{...next,orderId:draft.orderId,orderVersion:latestOrderVersion,accountRef:draft.accountRef,settlementRef:draft.settlementRef,taxBasis:draft.taxBasis}:next);
 }
 async function submit(){const {origin: _origin,...input}=draft;void _origin;if(await save({action:'save_settlement',input},'운영자 정산 증빙을 저장했습니다. 은행 대사는 수행하지 않았습니다.')){setBaseRevision(draft.revision);setDraft(current=>({...current,revision:current.revision+1}))}}
 return <section className={styles.business} aria-label="지급예정과 입금 증빙"><h3>지급예정·입금 증빙</h3>
  <p className={styles.note}>지급예정과 실제 입금 확인을 따로 기록합니다. 수령 현금은 입금 증빙의 합계이며, 원가·세금·기타 지출을 차감한 순현금흐름이 아닙니다. 운영자 증빙이며 은행·판매자 정산 확인을 완료한 기록으로 표시하지 않습니다.</p>
  <dl className={styles.businessGrid}><AmountSummary name="지급예정 금액" value={settlement.expectedAmount}/><AmountSummary name="입금 증빙의 수령 현금" value={settlement.receivedCash}/><AmountSummary name="지급예정 수수료" value={settlement.expectedFees}/><AmountSummary name="입금 증빙 수수료" value={settlement.reportedFees}/><div><dt>순현금흐름</dt><dd>미확인</dd></div></dl>
  <p className={settlement.reconciliation==='stale'?styles.error:styles.note}>{settlement.reasons.join(' · ')}</p>
  <div className={styles.list} aria-label="정산 사건 목록">{!settlement.events.length?<p>등록된 정산 증빙이 없습니다.</p>:settlement.events.map(event=><button type="button" key={event.eventId} disabled={busy} aria-pressed={event.eventId===draft.eventId} onClick={()=>choose(event.eventId)}><strong>{event.kind==='expected'?'지급예정':'입금 확인'} · {money(event.amount)}</strong><span>주문 {event.orderId} · 개별 참조 {event.receiptRef} · v{event.revision}</span></button>)}</div>
  {canEdit&&<><div className={styles.actions}><button type="button" disabled={busy} onClick={()=>newEvent('expected')}>새 지급예정</button><button type="button" disabled={busy} onClick={()=>newEvent('received')}>새 입금 확인</button><button type="button" disabled={busy||!draft.orderId||!draft.accountRef||!draft.settlementRef} onClick={()=>newEvent('received',true)}>선택 주문의 분할 입금 추가</button></div>
   <p className={styles.note}>분할 입금은 입금마다 새 사건 ID와 새 개별 입금 참조로 등록하세요. 기존 증빙의 금액 수정은 같은 사건의 다음 판으로 기록합니다. 지급예정 수수료와 입금 증빙 수수료는 따로 집계하므로 각각 해당 증빙에서 확인한 금액을 기록하세요.</p>
   {stale&&<div role="alert" className={styles.error}>이 사건의 서버 기록이 v{selected.revision}로 바뀌었습니다. 현재 입력은 보존했습니다.<details><summary>최신 증빙과 비교</summary><pre>{JSON.stringify(selected,null,2)}</pre></details><button type="button" disabled={busy} onClick={()=>{setBaseRevision(selected.revision);change({revision:selected.revision+1,orderVersion:latestOrderVersion})}}>현재 입력 유지 · 최신 판 기준 사용</button><button type="button" disabled={busy} onClick={()=>choose(selected.eventId)}>최신 증빙으로 입력 교체</button></div>}
   <form onSubmit={e=>{e.preventDefault();void submit()}}><fieldset className={styles.form} disabled={busy}><legend>{baseRevision?`같은 정산 사건 수정 · v${draft.revision}`:'새 정산 사건'}</legend>
    <Field label="정산 사건 ID"><input required disabled={baseRevision>0} maxLength={100} value={draft.eventId} onChange={e=>change({eventId:e.target.value})}/></Field>
    <Field label="정산 구분"><select disabled={baseRevision>0} value={draft.kind} onChange={e=>change({kind:e.target.value as SettlementEvidence['kind']})}><option value="expected">지급예정</option><option value="received">실제 입금 확인</option></select></Field>
    <Field label="연결 주문"><select required disabled={baseRevision>0} value={draft.orderId} onChange={e=>{const row=orders.find(item=>item.id===e.target.value);change({orderId:e.target.value,orderVersion:row?.version??0})}}><option value="">주문 선택</option>{orders.map(row=><option key={row.id} value={row.id}>{row.orderDate} · {row.id} · v{row.version}</option>)}</select></Field>
    {([['accountRef','정산 계정 내부 참조'],['settlementRef','정산 묶음 내부 참조'],['receiptRef','개별 지급예정·입금 참조']] as const).map(([key,name])=><Field key={key} label={name}><input required disabled={baseRevision>0} maxLength={100} value={draft[key]} onChange={e=>change({[key]:e.target.value})}/></Field>)}
    {([['amount',draft.kind==='received'?'이 입금에서 수령한 금액':'이번 지급예정 금액'],['feeAmount','이 증빙에 기재된 수수료']] as const).map(([key,name])=><Field key={key} label={`${name} (원, 미확인은 빈칸)`}><input type="number" min={0} step={1} value={draft[key]??''} onChange={e=>change({[key]:e.target.value===''?null:Number(e.target.value)})}/></Field>)}
    <Field label="금액의 세금 기준"><select value={draft.taxBasis} onChange={e=>change({taxBasis:e.target.value as SettlementEvidence['taxBasis']})}><option value="unknown">미확인</option><option value="included">세금 포함</option><option value="excluded">세금 제외</option></select></Field>
    <Field label={draft.kind==='received'?'실제 입금 시각 (시간대 포함 ISO)':'지급예정 시각 (시간대 포함 ISO)'}><input required placeholder="2026-10-01T10:00:00+09:00" value={draft.occurredAt} onChange={e=>change({occurredAt:e.target.value})}/></Field>
    <Field label="정산 증빙 내부 참조"><input required maxLength={100} value={draft.evidenceRef} onChange={e=>change({evidenceRef:e.target.value})}/></Field>
   </fieldset>{order&&draft.orderVersion!==order.version&&<p className={styles.error}>주문이 v{order.version}로 변경되었습니다. 주문 변경을 확인한 뒤 연결 판을 갱신하세요.<button type="button" disabled={busy} onClick={()=>change({orderVersion:order.version})}>최신 주문 판 확인</button></p>}
   <button type="submit" disabled={busy||stale||!modified||!order||draft.orderVersion!==order.version}>{baseRevision?'같은 사건의 수정판 저장':'정산 증빙 저장'}</button>
   {!orders.length&&<p className={styles.note}>지점 주문을 먼저 등록해야 정산 증빙을 연결할 수 있습니다.</p>}
  </form></>}
 </section>;
}
