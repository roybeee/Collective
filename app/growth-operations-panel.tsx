'use client';
import {EmptyLine} from '@/components/app/empty-line';

import {CheckInput} from '@/components/app/check';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {fromLocalInput,toLocalInput} from '@/lib/format';
import {RecordView} from '@/components/app/record-view';
import {Note} from '@/components/app/note';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {emptyOrderLineInput,type OrderLineInput} from '@/lib/growth-order-bridge';
import type {InventoryInput,InventoryProjection} from '@/lib/growth-inventory';
import {GrowthSettlementPanel,type GrowthSettlementView} from './growth-settlement-panel';
import {GrowthOperationReviewView} from './growth-operation-review';
import type {GrowthOperationReview} from '@/lib/growth-operation-review';
import styles from './growth-panel.module.css';

type GrowthEntry={id:string;version:number;input:Record<string,unknown>;status?:string};
type InventoryRow={id:string;version:number;input:InventoryInput;projection:InventoryProjection};
type OrderRow={id:string;version:number;orderDate:string;status:string;paidAmount:number|null;refundAmount:number|null};
type LineRow={id:string;version:number;input:OrderLineInput;allocation:{status:string;netAllocated:number|null;reasons:string[]}};
type OperationsView={review?:GrowthOperationReview;available:boolean;storeId?:string;reason:string;inventory:InventoryRow[];orders:OrderRow[];orderLines:LineRow[];settlement?:GrowthSettlementView;campaignVersion:number;canEdit:boolean;mayExecute:false};
type ReviewTarget={kind:'order_link'|'line_reconcile'|'line_operation'|'inventory';id:string};
type FormKey='inventory_create'|'inventory_adjust'|'mission'|'order_link'|'operation'|'settlement';
const actionForm:Record<string,FormKey>={create_inventory:'inventory_create',stock_adjust:'inventory_adjust',reserve_stock:'mission',release_stock:'mission',link_order:'order_link',record_operation:'operation',save_settlement:'settlement'};
type Save=(body:Record<string,unknown>,message:string)=>Promise<boolean>;
type FormProps={view:OperationsView;busy:boolean;save:Save};
type Props={campaignId:string;missions:GrowthEntry[];offers:GrowthEntry[];catalogs:GrowthEntry[]};
const money=(value:number|null)=>value===null?'미확인':`${value.toLocaleString('ko-KR')}원`;
const count=(value:number|null)=>value===null?'미확인':value.toLocaleString('ko-KR');
const nullable=(value:string)=>value===''?null:Number(value);
const unitName=(unit:InventoryInput['unit'])=>unit==='pack'?'팩':'개';
const labels:Record<string,string>={current:'현재 판 기준',reconciliation_required:'재대사 필요',unallocated:'미배분',invalid:'배분 오류',paid:'결제 기록',refunded:'환불 기록',cancelled:'취소 기록',pending:'확인 중'};
function Field({label,children}:{label:string;children:ReactNode}){return <div className={styles.field}><label>{label}{children}</label></div>;}
function EvidenceFields({observedAt,evidenceRef,onChange}:{observedAt:string;evidenceRef:string;onChange:(patch:{observedAt?:string;evidenceRef?:string})=>void}){
 return <><Field label="관측 시각(서울 시간)"><Input required type="datetime-local" value={toLocalInput(observedAt)} onChange={e=>onChange({observedAt:fromLocalInput(e.target.value)})}/></Field><Field label="증빙 내부 ID (개인정보 제외)"><Input required maxLength={160} placeholder="warehouse-check-001" value={evidenceRef} onChange={e=>onChange({evidenceRef:e.target.value})}/></Field></>;
}
async function request(url:string,init:RequestInit):Promise<OperationsView>{
 const response=await fetch(url,{...init,credentials:'same-origin',cache:'no-store'}),raw:unknown=await response.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('운영 응답 형식을 확인하지 못했습니다.');
 const data=raw as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'운영 기록 요청에 실패했습니다.');
 if(typeof data.available!=='boolean'||typeof data.canEdit!=='boolean'||typeof data.campaignVersion!=='number'||typeof data.reason!=='string'||!['inventory','orders','orderLines'].every(key=>Array.isArray(data[key])))throw new Error('운영 기록 형식을 확인하지 못했습니다. 다시 불러오세요.');
 return data as unknown as OperationsView;
}

export function GrowthOperationsPanel(props:Props){return <OperationsWorkspace key={props.campaignId} {...props}/>;}
function OperationsWorkspace({campaignId,missions,offers,catalogs}:Props){
 const [view,setView]=useState<OperationsView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [dirty,setDirty]=useState<Partial<Record<FormKey,boolean>>>({}),[formRevision,setFormRevision]=useState(0),[selectedTarget,setSelectedTarget]=useState<(ReviewTarget&{revision:number})|null>(null);
 const sections=useRef<Partial<Record<'inventory'|'link'|'operation',HTMLDetailsElement>>>({});
 const hasDirty=Object.values(dirty).some(Boolean);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>{
  const c=new AbortController();active.current=c;
  void request(`/api/growth/operations?campaignId=${encodeURIComponent(campaignId)}`,{signal:c.signal}).then(data=>{if(!c.signal.aborted)setView(data)}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'운영 기록을 불러오지 못했습니다.')}).finally(()=>{if(active.current===c)active.current=null});
  return()=>{c.abort();active.current?.abort()};
 },[campaignId]);
 async function refresh(){
  if(busy)return;active.current?.abort();const c=new AbortController();active.current=c;setBusy(true);setError('');
  try{const next=await request(`/api/growth/operations?campaignId=${encodeURIComponent(campaignId)}`,{signal:c.signal});if(!c.signal.aborted)setView(next)}
  catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'새로고침하지 못했습니다.')}
  finally{if(active.current===c)active.current=null;if(!c.signal.aborted)setBusy(false)}
 }
 const save:Save=async(body,success)=>{
  if(active.current||!view||!view.canEdit)return false;
  const c=new AbortController();active.current=c;setBusy(true);setError('');setMessage('');
  try{const next=await request('/api/growth/operations',{method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({...body,campaignId,campaignVersion:view.campaignVersion})});
   if(c.signal.aborted)return false;setView(next);setMessage(success);const form=actionForm[String(body.action)];if(form)setDirty(previous=>({...previous,[form]:false}));return true;
  }catch(e){if(!c.signal.aborted)setError(`${e instanceof Error?e.message:'기록을 저장하지 못했습니다.'} 입력은 보존했습니다. 버전 충돌이면 운영 기록을 새로고침하고 최신 수량을 확인하세요.`);return false}
  finally{if(active.current===c)active.current=null;if(!c.signal.aborted)setBusy(false)}
 };
 function markDirty(form:FormKey){setDirty(previous=>({...previous,[form]:true}));}
 function openReview(target:ReviewTarget){
  if(!view?.canEdit||busy||hasDirty||error)return;
  const exists=target.kind==='inventory'?view.inventory.some(row=>row.id===target.id):target.kind==='order_link'?view.orders.some(row=>row.id===target.id):view.orderLines.some(row=>row.id===target.id);
  if(!exists){setError('현재 운영 기록을 찾지 못했습니다. 새로고침해 확인하세요.');return;}
  setSelectedTarget(previous=>({...target,revision:(previous?.revision??0)+1}));
  const section=sections.current[target.kind==='inventory'?'inventory':target.kind==='line_operation'?'operation':'link'];
  if(section){section.open=true;setTimeout(()=>{section.scrollIntoView({block:'start'});section.querySelector('select')?.focus();},0);}
 }
 function resetForms(){if(busy)return;setDirty({});setSelectedTarget(null);setFormRevision(previous=>previous+1);}
 return <section className={styles.business} aria-label="주문 재고 이행 운영"><header className={styles.header}><div><h3>주문·재고·이행</h3><p>주문 품목을 판매 미션과 연결하고 실사·출고·환불·반품을 기록합니다.</p></div><Button variant="panel" size="fit" aria-label="운영 기록 새로고침" type="button" onClick={()=>void refresh()} disabled={busy}>새로고침</Button></header>
  <Note className={styles.note}>운영자가 증빙을 확인한 내부 장부입니다. 외부 판매처·택배사·결제사로 실제 요청을 전송하지 않습니다. 주문 금액 배분은 판매 기여나 증분 매출의 증명이 아닙니다. 고객 이름·전화번호·이메일·비밀키를 입력하지 마세요.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}
  {!view?<p role="status">{error?'운영 기록을 불러오지 못했습니다. 새로고침으로 다시 시도하세요.':'운영 기록을 불러오고 있습니다.'}</p>:!view.available?<p className={styles.note}>{view.reason}</p>:<>
   {!view.canEdit&&<p className={styles.note}>조회 전용입니다. 기록 변경은 관리자에게 요청하세요.</p>}
   <InventorySummary inventory={view.inventory}/><OrderSummary view={view}/>{view.review&&<GrowthOperationReviewView review={view.review} onOpen={openReview} disabled={busy||hasDirty||!view.canEdit} stale={busy||!!error}/>}{hasDirty&&<p className={styles.note}>저장하지 않은 운영 입력이 있습니다. 확인 목록에서 다른 기록을 열기 전에 저장하거나 변경을 취소하세요. <Button variant="panel" size="fit" type="button" disabled={busy} onClick={resetForms}>운영 입력 변경 취소</Button></p>}
   {view.settlement&&<details onChangeCapture={()=>markDirty('settlement')}><summary>지급예정·입금 증빙과 수령 현금</summary><GrowthSettlementPanel key={`settlement-${formRevision}`} orders={view.orders} settlement={view.settlement} canEdit={view.canEdit} busy={busy} save={save}/></details>}
   {view.canEdit&&<><details ref={node=>{if(node)sections.current.inventory=node;}} onChangeCapture={event=>markDirty((event.target as HTMLElement).closest('form')?.dataset.growthForm==='inventory_create'?'inventory_create':'inventory_adjust')}><summary>공유 재고 등록·실사·입고</summary><InventoryForms key={`inventory-${formRevision}-${selectedTarget?.kind==='inventory'?selectedTarget.revision:0}`} initialInventoryId={selectedTarget?.kind==='inventory'?selectedTarget.id:undefined} view={view} busy={busy} save={save} catalogs={catalogs}/></details>
    <details onChangeCapture={()=>markDirty('mission')}><summary>미션 계획 재고 예약·해제</summary><MissionStockForm key={`mission-${formRevision}`} view={view} busy={busy} save={save} missions={missions} offers={offers} catalogs={catalogs}/></details>
    <details ref={node=>{if(node)sections.current.link=node;}} onChangeCapture={()=>markDirty('order_link')}><summary>주문 품목과 판매 미션 연결</summary><OrderLinkForm key={`link-${formRevision}-${selectedTarget?.kind==='order_link'||selectedTarget?.kind==='line_reconcile'?selectedTarget.revision:0}`} initialTarget={selectedTarget?.kind==='order_link'||selectedTarget?.kind==='line_reconcile'?selectedTarget:undefined} view={view} busy={busy} save={save} missions={missions} offers={offers} catalogs={catalogs}/></details>
    <details ref={node=>{if(node)sections.current.operation=node;}} onChangeCapture={()=>markDirty('operation')}><summary>출고·환불·반품·예약 해제 기록</summary><OperationForm key={`operation-${formRevision}-${selectedTarget?.kind==='line_operation'?selectedTarget.revision:0}`} initialLineId={selectedTarget?.kind==='line_operation'?selectedTarget.id:undefined} view={view} busy={busy} save={save}/></details></>}
  </>}
 </section>;
}

function MissionStockForm({view,busy,save,missions,offers,catalogs}:FormProps&Pick<Props,'missions'|'offers'|'catalogs'>){
 const [draft,setDraft]=useState({id:crypto.randomUUID() as string,action:'reserve_stock',missionId:'',inventoryId:'',reservationId:'',quantity:'',observedAt:new Date().toISOString(),evidenceRef:'',safeRelease:false});
 const release=draft.action==='release_stock',mission=missions.find(row=>row.id===draft.missionId);
 const offer=offers.find(row=>row.id===mission?.input.offerId),catalog=catalogs.find(row=>row.id===offer?.input.catalogId);
 const inventory=view.inventory.find(row=>row.id===draft.inventoryId),reservations=inventory?.projection.reservations.filter(row=>row.missionId===draft.missionId&&row.held>0)??[];
 const choices=view.inventory.filter(row=>release?row.projection.reservations.some(held=>held.missionId===draft.missionId&&held.held>0):!!catalog&&row.input.sku===catalog.input.sku);
 const missionChoices=missions.filter(row=>release?['cancelled','failed'].includes(row.status??''):row.status==='staged');
 async function submit(){if(!mission||!inventory)return;if(await save({...draft,quantity:Number(draft.quantity),missionVersion:mission.version,inventoryVersion:inventory.version},release?'미션의 아직 주문에 배정하지 않은 재고 예약을 해제했습니다.':'미션 계획 수량을 공유 재고에 예약했습니다. 외부 판매는 수행하지 않았습니다.'))setDraft({...draft,id:crypto.randomUUID(),quantity:'',reservationId:'',evidenceRef:'',observedAt:new Date().toISOString(),safeRelease:false})}
 return <form onSubmit={e=>{e.preventDefault();void submit()}}><Note className={styles.note}>준비된 미션에 개·팩 단위의 계획 수량을 명시적으로 예약합니다. 취소·실패가 확인된 미션의 미배정 예약만 해제할 수 있습니다. 주문에 배정된 수량은 주문 이행 화면에서 확인하세요.</Note>
  <fieldset className={styles.form} disabled={busy}><legend>미션 계획 재고</legend>
   <Field label="예약 작업"><NativeSelect value={draft.action} onChange={e=>setDraft({...draft,action:e.target.value,missionId:'',inventoryId:'',reservationId:'',observedAt:new Date().toISOString(),safeRelease:false})}><option value="reserve_stock">준비된 미션 재고 예약</option><option value="release_stock">취소·실패 미션 예약 해제</option></NativeSelect></Field>
   <Field label="대상 판매 미션"><NativeSelect required value={draft.missionId} onChange={e=>setDraft({...draft,missionId:e.target.value,inventoryId:'',reservationId:'',observedAt:new Date().toISOString()})}><option value="">미션 선택</option>{missionChoices.map(row=><option key={row.id} value={row.id}>{String(row.input.title??row.id)} · v{row.version}</option>)}</NativeSelect></Field>
   <Field label="계획 수량을 관리할 공유 재고"><NativeSelect required value={draft.inventoryId} onChange={e=>setDraft({...draft,inventoryId:e.target.value,reservationId:'',observedAt:new Date().toISOString()})}><option value="">공유 재고 선택</option>{choices.map(row=><option key={row.id} value={row.id}>{row.input.sku} · {unitName(row.input.unit)} · 가용 {count(row.projection.available)}</option>)}</NativeSelect></Field>
   {release&&<Field label="해제할 미배정 예약"><NativeSelect required value={draft.reservationId} onChange={e=>setDraft({...draft,reservationId:e.target.value})}><option value="">예약 선택</option>{reservations.map(row=><option key={row.reservationId} value={row.reservationId}>{row.reservationId} · 미배정 {row.held}</option>)}</NativeSelect></Field>}
   <Field label={`${release?'안전하게 해제할':'계획 예약'} 수량${inventory?` (${unitName(inventory.input.unit)})`:''}`}><Input required type="number" min={1} step={1} value={draft.quantity} onChange={e=>setDraft({...draft,quantity:e.target.value})}/></Field>
   <EvidenceFields observedAt={draft.observedAt} evidenceRef={draft.evidenceRef} onChange={patch=>setDraft({...draft,...patch})}/>
   {release&&<label className={styles.check}><CheckInput required checked={draft.safeRelease} onChange={e=>setDraft({...draft,safeRelease:e.target.checked})}/>취소·실패를 확인했고 아직 주문에 배정하지 않은 수량을 안전하게 해제합니다.</label>}
   <Button variant="panel" size="fit" type="submit" disabled={!mission||!inventory||(release&&!draft.reservationId)}>{release?'미션 재고 예약 해제 저장':'미션 계획 재고 예약 저장'}</Button>
  </fieldset>{!missionChoices.length&&<p className={styles.note}>{release?'취소·실패 상태의 미션이 없습니다.':'판매 미션에서 준비 요청을 먼저 완료하세요.'}</p>}
 </form>;
}

function InventorySummary({inventory}:{inventory:InventoryRow[]}){
 return <section aria-label="공유 재고 현황"><h4>같은 지점·SKU의 공유 재고</h4><p className={styles.note}>상품 초안의 재고와 별도로 관리합니다. 미션과 주문의 미출고 예약은 자동으로 만료되지 않습니다.</p>
  {!inventory.length?<EmptyLine>등록된 공유 재고가 없습니다.</EmptyLine>:inventory.map(row=><div key={row.id} className={styles.mission}><strong>{row.input.sku} · {unitName(row.input.unit)} 단위 · v{row.version}</strong><dl className={styles.businessGrid}>
   {([['실물 재고',row.projection.onHand],['미출고 예약',row.projection.reserved],['새 예약 가능',row.projection.available],['부족 수량',row.projection.shortage]] as const).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{count(value)}{value===null?'':unitName(row.input.unit)}</dd></div>)}
  </dl>{row.projection.shortage!==null&&row.projection.shortage>0&&<p className={styles.error}>실제 재고보다 예약이 많습니다. 부족분을 대사하기 전 새 미션 예약을 진행할 수 없습니다.</p>}{row.projection.onHand===null&&<p className={styles.note}>실물 재고가 미확인입니다. 실사 수량을 기록해야 새 미션 예약을 할 수 있습니다.</p>}</div>)}
 </section>;
}
function OrderSummary({view}:{view:OperationsView}){
 return <section aria-label="주문 품목 연결 현황"><h4>주문 품목 연결</h4>{!view.orderLines.length?<p>연결된 주문 품목이 없습니다. 지점 주문 장부에 등록된 주문을 선택해 연결하세요.</p>:view.orderLines.map(line=>{
  const item=view.inventory.find(row=>row.id===line.input.inventoryId),held=item?.projection.orders.find(order=>order.orderId===line.id);
  return <div key={line.id} className={styles.mission}><strong>{item?.input.sku??'재고 연결 확인 필요'} · 품목 {line.input.externalLineId}</strong><p>주문 {line.input.orderId} · 배정 {line.input.units}{item?unitName(item.input.unit):'단위'} · {labels[line.allocation.status]??line.allocation.status}</p>
   <p>품목 결제 배분 {money(line.input.paidAllocation)} · 품목 환불 배분 {money(line.input.refundAllocation)}</p>
   {held&&<p>미출고 예약 {held.held} · 출고 {held.shipped} · 해제 {held.released} · 환불 수량 {held.refunded} · 수락 반품 {held.returned} · 재입고 {held.restocked}</p>}
   {line.allocation.reasons.length>0&&<p className={styles.note}>{line.allocation.reasons.join(' · ')}</p>}
  </div>;
 })}</section>;
}

function InventoryForms({view,busy,save,catalogs,initialInventoryId=''}:FormProps&{catalogs:GrowthEntry[];initialInventoryId?:string}){
 const [draft,setDraft]=useState({sku:'',unit:'piece' as InventoryInput['unit'],onHand:null as number|null,observedAt:new Date().toISOString(),evidenceRef:''});
 const [adjust,setAdjust]=useState({id:crypto.randomUUID() as string,inventoryId:initialInventoryId,kind:'stocktake',quantity:'',observedAt:new Date().toISOString(),evidenceRef:''});
 const selected=view.inventory.find(row=>row.id===adjust.inventoryId);
 async function create(){if(await save({action:'create_inventory',input:{sku:draft.sku,unit:draft.unit,onHand:draft.onHand,locationId:view.storeId},observedAt:draft.observedAt,evidenceRef:draft.evidenceRef},'공유 재고를 등록했습니다.'))setDraft({...draft,sku:'',onHand:null,evidenceRef:''})}
 async function adjustStock(){if(!selected)return;if(await save({action:'stock_adjust',...adjust,quantity:Number(adjust.quantity),inventoryVersion:selected.version},'재고 관측을 기록했습니다.'))setAdjust({...adjust,id:crypto.randomUUID(),quantity:'',evidenceRef:'',observedAt:new Date().toISOString()})}
 return <div className={styles.editor}><form data-growth-form="inventory_create" onSubmit={e=>{e.preventDefault();void create()}}><h4>새 공유 재고</h4><fieldset disabled={busy||!view.storeId} className={styles.form}><legend className={styles.srOnly}>공유 재고 저장</legend>
  <Field label="SKU"><Input required list="growth-inventory-skus" maxLength={160} value={draft.sku} onChange={e=>setDraft({...draft,sku:e.target.value})}/><datalist id="growth-inventory-skus">{catalogs.map(row=><option key={row.id} value={String(row.input.sku??'')}>{String(row.input.title??'')}</option>)}</datalist></Field>
  <Field label="고정 수량 단위"><NativeSelect value={draft.unit} onChange={e=>setDraft({...draft,unit:e.target.value as InventoryInput['unit']})}><option value="piece">개 (piece)</option><option value="pack">팩 (pack)</option></NativeSelect></Field>
  <Field label="처음 확인한 실물 수량 (미확인은 빈칸)"><Input type="number" min={0} step={1} value={draft.onHand??''} onChange={e=>setDraft({...draft,onHand:nullable(e.target.value)})}/></Field>
  {draft.onHand!==null&&<EvidenceFields observedAt={draft.observedAt} evidenceRef={draft.evidenceRef} onChange={patch=>setDraft({...draft,...patch})}/>}<Button variant="panel" size="fit" type="submit">공유 재고 저장</Button>
 </fieldset>{!view.storeId&&<p className={styles.note}>지점 식별자를 확인할 수 없습니다. 운영 기록을 새로고침하세요.</p>}</form>
 <form data-growth-form="inventory_adjust" onSubmit={e=>{e.preventDefault();void adjustStock()}}><h4>실사·입고 기록</h4><Note className={styles.note}>실사는 현재 총수량으로 바꾸고, 입고는 기존 수량에 더합니다. 재고 미확인 상태에서는 입고만 기록해도 가용량을 확정하지 않습니다.</Note><fieldset disabled={busy||!view.inventory.length} className={styles.form}><legend className={styles.srOnly}>재고 관측 기록</legend>
  <Field label="관측할 공유 재고"><NativeSelect required value={adjust.inventoryId} onChange={e=>setAdjust({...adjust,inventoryId:e.target.value,observedAt:new Date().toISOString()})}><option value="">재고 선택</option>{view.inventory.map(row=><option key={row.id} value={row.id}>{row.input.sku} · {unitName(row.input.unit)}</option>)}</NativeSelect></Field>
  <Field label="관측 종류"><NativeSelect value={adjust.kind} onChange={e=>setAdjust({...adjust,kind:e.target.value})}><option value="stocktake">실사 — 실제 총수량</option><option value="receive">입고 — 추가 수량</option></NativeSelect></Field>
  <Field label={adjust.kind==='stocktake'?'실사한 총수량':'추가 입고 수량'}><Input required type="number" min={adjust.kind==='stocktake'?0:1} step={1} value={adjust.quantity} onChange={e=>setAdjust({...adjust,quantity:e.target.value})}/></Field>
  <EvidenceFields observedAt={adjust.observedAt} evidenceRef={adjust.evidenceRef} onChange={patch=>setAdjust({...adjust,...patch})}/><Button variant="panel" size="fit" type="submit" disabled={!selected} disabledReason={!selected?'먼저 대상을 고르세요.':undefined}>재고 관측 저장</Button>
 </fieldset></form></div>;
}

function OrderLinkForm({view,busy,save,missions,offers,catalogs,initialTarget}:FormProps&Pick<Props,'missions'|'offers'|'catalogs'>&{initialTarget?:ReviewTarget}){
 const initialLine=initialTarget?.kind==='line_reconcile'?view.orderLines.find(row=>row.id===initialTarget.id):undefined,initialOrder=view.orders.find(row=>row.id===(initialLine?.input.orderId??initialTarget?.id));
 const [draft,setDraft]=useState<OrderLineInput>(()=>initialLine?{...initialLine.input,orderVersion:initialOrder?.version??initialLine.input.orderVersion}:{...emptyOrderLineInput(),sourceKey:'manual',orderId:initialOrder?.id??'',orderVersion:initialOrder?.version??0}),[expectedVersion,setExpectedVersion]=useState(initialLine?.version??0),[lineId,setLineId]=useState(initialLine?.id??'');
 const selectedOrder=view.orders.find(row=>row.id===draft.orderId),selectedMission=missions.find(row=>row.id===draft.missionId);
 const selectedLine=view.orderLines.find(row=>row.id===lineId);
 const stale=!!selectedLine&&(selectedLine.version!==expectedVersion||selectedOrder?.version!==draft.orderVersion);
 const selectedOffer=offers.find(row=>row.id===draft.offerId),catalog=catalogs.find(row=>row.id===selectedOffer?.input.catalogId);
 const inventories=view.inventory.filter(row=>!catalog||row.input.sku===catalog.input.sku),selectedInventory=view.inventory.find(row=>row.id===draft.inventoryId);
 function chooseMission(id:string){const mission=missions.find(row=>row.id===id),offer=offers.find(row=>row.id===mission?.input.offerId);setDraft({...draft,missionId:id,missionVersion:mission?.version??0,offerId:offer?.id??'',offerVersion:offer?.version??0,inventoryId:''})}
 function chooseLine(id:string){const row=view.orderLines.find(line=>line.id===id);setLineId(id);setExpectedVersion(row?.version??0);setDraft(row?{...row.input,orderVersion:view.orders.find(order=>order.id===row.input.orderId)?.version??row.input.orderVersion}:{...emptyOrderLineInput(),sourceKey:'manual'})}
 async function submit(){if(await save({action:'link_order',input:draft,expectedVersion,inventoryVersion:selectedInventory?.version},'주문 품목을 연결했습니다. 금액 배분은 실판매 효과의 증명이 아닙니다.'))chooseLine('')}
 return <form onSubmit={e=>{e.preventDefault();void submit()}}><Note className={styles.note}>개·팩 수량은 직접 확인해 입력하세요. 오퍼 수량에서 자동 계산하지 않습니다. 결제·환불 배분을 모르면 빈칸으로 둡니다.</Note>
  <Field label="기존 품목 재대사 또는 새 연결"><NativeSelect disabled={busy} value={lineId} onChange={e=>chooseLine(e.target.value)}><option value="">새 품목 연결</option>{view.orderLines.map(line=><option key={line.id} value={line.id}>{line.input.orderId} · {line.input.sourceKey}/{line.input.accountId} · {line.input.externalLineId} · v{line.version}</option>)}</NativeSelect></Field>
  {stale&&<div role="alert" className={styles.error}>품목 또는 원 주문이 변경되었습니다. 현재 입력 금액은 보존했습니다. 최신 품목 v{selectedLine.version} · 주문 v{selectedOrder?.version??'확인 필요'}를 검토하세요.<details><summary>서버의 최신 품목 배분 보기</summary><RecordView label="서버의 최신 품목 배분 보기" value={selectedLine.input}/></details><Button variant="panel" size="fit" type="button" disabled={busy||!selectedOrder} disabledReason={!selectedOrder?'먼저 대상을 고르세요.':undefined} onClick={()=>{if(!selectedOrder)return;setExpectedVersion(selectedLine.version);setDraft(current=>({...current,orderVersion:selectedOrder.version}))}}>현재 입력 유지 · 최신 품목 판 확인</Button></div>}
  <fieldset disabled={busy||!view.orders.length} className={styles.form}><legend>주문 품목과 판매 미션</legend>
   <Field label="지점 주문"><NativeSelect required disabled={expectedVersion>0} value={draft.orderId} onChange={e=>{const order=view.orders.find(row=>row.id===e.target.value);setDraft({...draft,orderId:e.target.value,orderVersion:order?.version??0})}}><option value="">주문 선택</option>{view.orders.map(row=><option key={row.id} value={row.id}>{row.orderDate} · {row.id} · {labels[row.status]??row.status}</option>)}</NativeSelect></Field>
   <Field label="연결 판매 미션"><NativeSelect required disabled={expectedVersion>0} value={draft.missionId} onChange={e=>chooseMission(e.target.value)}><option value="">미션 선택</option>{missions.map(row=><option key={row.id} value={row.id}>{String(row.input.title??'판매 미션')} · v{row.version}</option>)}</NativeSelect></Field>
   <Field label="SKU가 일치하는 공유 재고"><NativeSelect required disabled={expectedVersion>0} value={draft.inventoryId} onChange={e=>setDraft({...draft,inventoryId:e.target.value})}><option value="">재고 선택</option>{inventories.map(row=><option key={row.id} value={row.id}>{row.input.sku} · {unitName(row.input.unit)}</option>)}</NativeSelect></Field>
   <Field label="주문 품목 수량"><Input required disabled={expectedVersion>0} type="number" min={1} step={1} value={draft.units} onChange={e=>setDraft({...draft,units:Number(e.target.value)})}/></Field>
   {([['sourceKey','판매 출처 내부 ID'],['accountId','판매 계정 내부 ID'],['externalLineId','원 주문 품목 ID']] as const).map(([key,name])=><Field key={key} label={name}><Input required disabled={expectedVersion>0} maxLength={100} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></Field>)}
   {([['paidAllocation','이 품목에 배분할 결제액'],['refundAllocation','이 품목에 배분할 환불액']] as const).map(([key,name])=><Field key={key} label={`${name} (원, 미확인은 빈칸)`}><Input type="number" min={0} step={1} value={draft[key]??''} onChange={e=>setDraft({...draft,[key]:nullable(e.target.value)})}/></Field>)}
   <Field label="배분액의 세금 기준"><NativeSelect value={draft.taxBasis} onChange={e=>setDraft({...draft,taxBasis:e.target.value as OrderLineInput['taxBasis']})}><option value="unknown">미확인</option><option value="included">세금 포함</option><option value="excluded">세금 제외</option></NativeSelect></Field>
   <Field label="품목 연결 증빙 참조 (개인정보 제외)"><Input required maxLength={200} value={draft.evidenceRef} onChange={e=>setDraft({...draft,evidenceRef:e.target.value})}/></Field>
   <Button variant="panel" size="fit" type="submit" disabled={stale||!selectedOrder||!selectedMission||!selectedOffer||!selectedInventory} disabledReason={stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':!selectedOrder?'먼저 대상을 고르세요.':!selectedMission?'먼저 대상을 고르세요.':!selectedOffer?'먼저 대상을 고르세요.':!selectedInventory?'먼저 대상을 고르세요.':undefined}>{expectedVersion?'품목 배분 재대사 저장':'주문 품목 연결 저장'}</Button>
  </fieldset>
  {!view.orders.length&&<p className={styles.note}>지점 주문 장부에 먼저 주문을 등록하세요.</p>}{selectedOrder&&<p className={styles.note}>원 주문 v{selectedOrder.version}: 결제액 {money(selectedOrder.paidAmount)} · 환불액 {money(selectedOrder.refundAmount)}. 전체 품목 배분 합계는 원 주문 금액을 넘을 수 없습니다.</p>}
  {selectedOffer&&<p className={styles.note}>연결 오퍼: {String(selectedOffer.input.title??selectedOffer.id)} · 상품 SKU {String(catalog?.input.sku??'확인 필요')}. 예약 부족이어도 실제 주문 배정 사실은 부족 상태로 남습니다.</p>}
 </form>;
}

function OperationForm({view,busy,save,initialLineId=''}:FormProps&{initialLineId?:string}){
 const [draft,setDraft]=useState({id:crypto.randomUUID() as string,lineId:initialLineId,kind:initialLineId?'':'ship',quantity:'',observedAt:new Date().toISOString(),evidenceRef:'',safeRelease:false,returnAccepted:false,disposition:'unknown',restock:false});
 const selected=view.orderLines.find(line=>line.id===draft.lineId),inventory=view.inventory.find(row=>row.id===selected?.input.inventoryId),order=inventory?.projection.orders.find(row=>row.orderId===selected?.id);
 function chooseKind(kind:string){setDraft({...draft,kind,observedAt:new Date().toISOString(),safeRelease:false,returnAccepted:false,disposition:'unknown',restock:false})}
 async function submit(){if(!inventory)return;if(await save({action:'record_operation',...draft,quantity:Number(draft.quantity),inventoryVersion:inventory.version},'운영자가 확인한 이행 사건을 기록했습니다. 외부 요청은 전송하지 않았습니다.'))setDraft({...draft,id:crypto.randomUUID(),quantity:'',evidenceRef:'',observedAt:new Date().toISOString(),safeRelease:false,returnAccepted:false,disposition:'unknown',restock:false})}
 return <form onSubmit={e=>{e.preventDefault();void submit()}}><Note className={styles.note}>환불 수량 기록은 돈을 반환하거나 실물 재고를 복구하지 않습니다. 반품은 검수 수락·재판매 가능·재입고 확인이 모두 있어야 실물 수량에 더합니다.</Note>
  <fieldset disabled={busy||!view.orderLines.length} className={styles.form}><legend>이행 사건 기록</legend>
   <Field label="이행할 주문 품목"><NativeSelect required value={draft.lineId} onChange={e=>setDraft({...draft,lineId:e.target.value,observedAt:new Date().toISOString()})}><option value="">연결 품목 선택</option>{view.orderLines.map(line=><option key={line.id} value={line.id}>{line.input.orderId} · {line.input.externalLineId}</option>)}</NativeSelect></Field>
   <Field label="이행 종류"><NativeSelect required value={draft.kind} onChange={e=>chooseKind(e.target.value)}><option value="">이행 종류 선택</option><option value="ship">출고 사실</option><option value="refund">환불 수량 확인</option><option value="return">반품 검수</option><option value="release">미출고 예약 해제</option></NativeSelect></Field>
   <Field label={`사건 수량${inventory?` (${unitName(inventory.input.unit)})`:''}`}><Input required type="number" min={1} step={1} value={draft.quantity} onChange={e=>setDraft({...draft,quantity:e.target.value})}/></Field>
   <EvidenceFields observedAt={draft.observedAt} evidenceRef={draft.evidenceRef} onChange={patch=>setDraft({...draft,...patch})}/>
   {draft.kind==='release'&&<label className={styles.check}><CheckInput required checked={draft.safeRelease} onChange={e=>setDraft({...draft,safeRelease:e.target.checked})}/>출고되지 않았고 안전하게 예약을 해제할 수 있음을 확인했습니다.</label>}
   {draft.kind==='return'&&<><label className={styles.check}><CheckInput checked={draft.returnAccepted} onChange={e=>setDraft({...draft,returnAccepted:e.target.checked,restock:false})}/>반품을 실제 수령하고 검수 수락했습니다.</label>
    <Field label="반품 검수 결과"><NativeSelect value={draft.disposition} onChange={e=>setDraft({...draft,disposition:e.target.value,restock:false})}><option value="unknown">미확인</option><option value="resalable">재판매 가능</option><option value="not_resalable">재판매 불가</option></NativeSelect></Field>
    <label className={styles.check}><CheckInput disabled={!draft.returnAccepted||draft.disposition!=='resalable'} checked={draft.restock} onChange={e=>setDraft({...draft,restock:e.target.checked})}/>검수된 수량을 판매 가능한 실물 재고에 재입고합니다.</label></>}
   <Button variant="panel" size="fit" type="submit" disabled={!inventory} disabledReason={!inventory?'먼저 대상을 고르세요.':undefined}>이행 사건 저장</Button>
  </fieldset>{order&&<p className={styles.note}>현재 미출고 예약 {order.held} · 출고 {order.shipped} · 수락 반품 {order.returned}. 이미 출고한 수량은 예약 해제로 되돌릴 수 없습니다.</p>}
 </form>;
}
