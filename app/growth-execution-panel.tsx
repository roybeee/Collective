'use client';

import {dateTime} from '@/lib/format';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import styles from './growth-panel.module.css';
import {GrowthPublicationPanel} from './growth-publication-panel';
import {GrowthReconciliationPanel,type ReconciliationData,type ReconciliationAck} from './growth-reconciliation-panel';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';

type Reference={id:string;version:number;label:string};
type Mission={id:string;version:number;status:string;input:{title:string;budget:number|null;lossLimit:number|null};readiness:{missing:string[]}};
type Authority={id:string;version:number;input:{accountId:string;channel:string;status:string}};
type Inventory={id:string;version:number;input:{sku:string;unit:'piece'|'pack'};projection:{available:number|null;reserved:number}};
type Preparation={missionId:string;missionVersion:number;authorityId:string;authorityVersion:number;inventoryId:string;inventoryVersion:number;quantity:string;recoveryOwner:string;recoveryDueAt:string;evidenceRef:string};
type Intent={publicationLinkId?:string|null;id:string;version:number;currentMissionVersion:number;state:string;input:Omit<Preparation,'quantity'>&{quantity:number};commitmentId:string;reservationId:string;snapshot?:{mission?:{input?:{title?:string};title?:string}}};
type ReceiptRow={id:string;intentId:string;intentVersion:number;state:string;input:Receipt|null;recordedAt:string};
type View=Omit<ReconciliationData,'intents'|'inventory'>&{intents:Intent[];receipts:ReceiptRow[];missions:Mission[];authorities:Authority[];inventory:Inventory[];campaignVersion:number;canPrepare:boolean;canRecord:boolean;mayExecute:false};
type Receipt={status:'unknown'|'observed'|'failed';reference:string;note:string};
const emptyPreparation=():Preparation=>({missionId:'',missionVersion:0,authorityId:'',authorityVersion:0,inventoryId:'',inventoryVersion:0,quantity:'',recoveryOwner:'',recoveryDueAt:'',evidenceRef:''});
const states:Record<string,string>={prepared:'예약 완료',reserved:'예약 완료',unknown:'결과 미확인',observed:'관측 완료',failed:'실패 확인'};
async function request(campaignId:string,init?:RequestInit,allowUnavailable?:false):Promise<View>;
async function request(campaignId:string,init:RequestInit,allowUnavailable:true):Promise<View|ReconciliationAck>;
async function request(campaignId:string,init:RequestInit={},allowUnavailable=false):Promise<View|ReconciliationAck>{
 const response=await fetch(`/api/growth/execution${init.method==='POST'?'':`?campaignId=${encodeURIComponent(campaignId)}`}`,{...init,cache:'no-store'});
 const raw:unknown=await response.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('실행 준비 응답을 확인하지 못했습니다.');
 const data=raw as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'실행 준비 요청에 실패했습니다.');
 if(allowUnavailable&&data.reconciled===true&&data.viewUnavailable===true&&typeof data.resultIntentId==='string')return data as unknown as ReconciliationAck;
 if(!['intents','receipts','missions','authorities','inventory','commitments','reconciliations'].every(key=>Array.isArray(data[key]))||typeof data.campaignVersion!=='number'||typeof data.canPrepare!=='boolean'||typeof data.canRecord!=='boolean')throw new Error('실행 준비 응답을 확인하지 못했습니다.');
 return data as unknown as View;
}
function ReferenceField({label,rows,id,version,onChange}:{label:string;rows:Reference[];id:string;version:number;onChange:(id:string,version:number)=>void}){
 const selected=rows.find(row=>row.id===id);
 return <div className={styles.field}><label>{label}<select value={id} onChange={event=>onChange(event.target.value,rows.find(row=>row.id===event.target.value)?.version??0)}><option value="">선택하세요</option>{id&&!selected&&<option value={id}>이전 선택 · 현재 사용 불가</option>}{rows.map(row=><option key={row.id} value={row.id}>{row.label} · v{row.version}</option>)}</select></label>{id&&<p>선택한 기준 v{version}</p>}{selected&&selected.version!==version&&<button type="button" onClick={()=>onChange(id,selected.version)}>최신 {label} 연결 (v{selected.version})</button>}</div>;
}
function ExecutionEditor({campaignId,view,onView,busy,onBusy,linkedIntentIds}:{linkedIntentIds:string[];campaignId:string;view:View;onView:(v:View)=>void;busy:boolean;onBusy:(v:boolean)=>void}){
 const [draft,setDraft]=useState(emptyPreparation),[campaignVersion,setCampaignVersion]=useState(view.campaignVersion);
 const [selection,setSelection]=useState({id:'',version:0}),[receipt,setReceipt]=useState<Receipt>({status:'unknown',reference:'',note:''}),[receiptId,setReceiptId]=useState(()=>crypto.randomUUID());
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const pending=useRef<AbortController|null>(null),mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.abort();};},[]);
 function change(patch:Partial<Preparation>){setDraft(previous=>({...previous,...patch}));setMessage('');}
 function select(row:Intent){setSelection({id:row.id,version:row.version});setReceipt({status:'unknown',reference:'',note:''});setReceiptId(crypto.randomUUID());setError('');setMessage('');}
 async function mutate(action:'prepare_execution'|'record_execution_receipt'){
  if(pending.current||busy||(action==='record_execution_receipt'&&publicationLinked))return;
  const c=new AbortController();pending.current=c;onBusy(true);setError('');setMessage('');
  try{
   const payload=action==='prepare_execution'?{input:{...draft,recoveryDueAt:draft.recoveryDueAt?`${draft.recoveryDueAt}T23:59:59+09:00`:'',quantity:draft.quantity===''?null:Number(draft.quantity)}}:{id:selection.id,expectedVersion:selection.version,receiptId,input:receipt};
   const next=await request(campaignId,{method:'POST',signal:c.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({action,campaignId,campaignVersion,...payload})});
   if(!mounted.current||c.signal.aborted)return;
   const row=next.intents.find(item=>action==='prepare_execution'?item.input.missionId===draft.missionId:item.id===selection.id);
   if(!row)throw new Error('저장 응답에서 실행 기록을 확인하지 못했습니다. 새로고침으로 확인하세요.');
   onView(next);setSelection({id:row.id,version:row.version});setReceiptId(crypto.randomUUID());
   setMessage(action==='prepare_execution'?'예산과 재고를 함께 예약했습니다. 외부 실행은 수행하지 않았습니다.':'실행 결과를 기록했습니다. 예산·재고 예약은 자동 해제하지 않습니다.');
  }catch(e){if(mounted.current&&!c.signal.aborted)setError(`${e instanceof Error?e.message:'기록하지 못했습니다.'} 입력은 보존했습니다. 새로고침으로 서버 상태를 확인한 뒤 다시 시도하세요.`);}
  finally{pending.current=null;if(mounted.current&&!c.signal.aborted)onBusy(false);}
 }
 const mission=view.missions.find(row=>row.id===draft.missionId),authority=view.authorities.find(row=>row.id===draft.authorityId),inventory=view.inventory.find(row=>row.id===draft.inventoryId),selected=view.intents.find(row=>row.id===selection.id);
 const staleCampaign=campaignVersion!==view.campaignVersion,staleReference=!!draft.missionId&&mission?.version!==draft.missionVersion||!!draft.authorityId&&authority?.version!==draft.authorityVersion||!!draft.inventoryId&&inventory?.version!==draft.inventoryVersion;
 const publicationLinked=!!selected&&(!!selected.publicationLinkId||linkedIntentIds.includes(selected.id));
 const staleReceipt=!!selected&&selected.version!==selection.version,terminal=selected?.state==='observed'||selected?.state==='failed';
 const stateLabel=(row:Intent)=>`${states[row.state]??row.state}${view.commitments.find(item=>item.id===row.commitmentId)?.commitment.status==='released'?' · 무집행 취소':''}`;
 const label=(row:Intent)=>view.missions.find(m=>m.id===row.input.missionId)?.input.title||row.snapshot?.mission?.input?.title||row.snapshot?.mission?.title||row.input.missionId;
 return <div className={styles.editor}>{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}
 {staleCampaign&&<div className={styles.error}>캠페인이 변경되었습니다. 현재 입력과 연결 조건을 다시 검토하세요.<button type="button" disabled={busy} onClick={()=>setCampaignVersion(view.campaignVersion)}>현재 입력 유지 · 최신 캠페인 기준 사용</button></div>}
 <form onSubmit={event=>{event.preventDefault();void mutate('prepare_execution');}}><fieldset className={styles.form} disabled={busy||!view.canPrepare}><legend>예산·재고 예약 준비</legend>
 <ReferenceField label="준비된 판매 미션" rows={view.missions.filter(row=>row.status==='staged').map(row=>({id:row.id,version:row.version,label:row.input.title}))} id={draft.missionId} version={draft.missionVersion} onChange={(missionId,missionVersion)=>change({missionId,missionVersion})}/>
 <ReferenceField label="서명된 판매 위임" rows={view.authorities.filter(row=>row.input.status==='active').map(row=>({id:row.id,version:row.version,label:`${row.input.accountId} · ${row.input.channel}`}))} id={draft.authorityId} version={draft.authorityVersion} onChange={(authorityId,authorityVersion)=>change({authorityId,authorityVersion})}/>
 <ReferenceField label="예약할 공유 재고" rows={view.inventory.map(row=>({id:row.id,version:row.version,label:`${row.input.sku} · 가용 ${row.projection.available??'미확인'} ${row.input.unit==='pack'?'팩':'개'}`}))} id={draft.inventoryId} version={draft.inventoryVersion} onChange={(inventoryId,inventoryVersion)=>change({inventoryId,inventoryVersion})}/>
 <Note className={styles.note}>준비도에서 확인한 브랜드·지점·SKU의 원장과 상품 수량 단위가 일치해야 합니다. 개·팩은 자동 환산하지 않습니다. 다른 캠페인의 예약으로 가용량이 바뀔 수 있으므로 최신 재고 판을 확인하세요.</Note><label className={styles.field}>예약할 재고 수량 (등록된 SKU 단위)<input type="number" min={1} step={1} required value={draft.quantity} onChange={event=>change({quantity:event.target.value})}/></label>
 <label className={styles.field}>결과 확인 담당 역할<input maxLength={200} required value={draft.recoveryOwner} onChange={event=>change({recoveryOwner:event.target.value})}/></label>
 <label className={styles.field}>결과 확인 기한<input type="date" required value={draft.recoveryDueAt} onChange={event=>change({recoveryDueAt:event.target.value})}/></label>
 <label className={styles.wide}>준비 증빙 내부 ID<input maxLength={100} required value={draft.evidenceRef} onChange={event=>change({evidenceRef:event.target.value})}/></label>
 </fieldset><Note className={styles.note}>결과 확인 기한은 선택한 날짜의 한국시간 23:59:59입니다. 준비 증빙 ID에는 영문·숫자·밑줄·붙임표를 사용하세요.</Note>{mission&&<div className={styles.readiness}><p>미션 예산 {mission.input.budget??'미확인'}원 · 손실 한도 {mission.input.lossLimit??'미확인'}원</p>{!!mission.readiness.missing.length&&<ul>{mission.readiness.missing.map((reason,index)=><li key={index}>{reason}</li>)}</ul>}</div>}
 {staleReference&&<p className={styles.error}>연결 기록이 변경되었습니다. 최신 내용을 검토하고 각 연결 기준을 다시 선택하세요.</p>}
 <button type="submit" className={styles.primary} disabled={busy||!view.canPrepare||staleCampaign||staleReference||!draft.missionId||!draft.authorityId||!draft.inventoryId||mission?.status!=='staged'||!!mission?.readiness.missing.length}>예산·재고 함께 예약</button></form>
 {!view.canPrepare&&<p>현재 권한·캠페인 상태에서는 새 예약을 준비할 수 없습니다.</p>}
 <div className={styles.workspace}><div role="group" className={styles.list} aria-label="판매 실행 기록">{!view.intents.length&&<p>예약된 실행 기록이 없습니다.</p>}{view.intents.map(row=><button key={row.id} type="button" disabled={busy} aria-pressed={selection.id===row.id} onClick={()=>select(row)}><strong>{label(row)}</strong><span>{stateLabel(row)} · v{row.version}</span></button>)}</div>
 {selected&&<div className={styles.editor}><h4>{label(selected)} · {stateLabel(selected)}</h4><p>예약 수량 {selected.input.quantity} · 결과 확인 {selected.input.recoveryOwner} · {selected.input.recoveryDueAt}</p><p>예산 예약 {selected.commitmentId}<br/>재고 예약 {selected.reservationId}</p>
 {staleReceipt&&<div className={styles.error}>다른 운영자가 결과를 갱신했습니다. 최신 상태는 {states[selected.state]??selected.state}입니다.<button type="button" disabled={busy||terminal} onClick={()=>{setSelection({id:selected.id,version:selected.version});setReceiptId(crypto.randomUUID());}}>현재 입력 유지 · 최신 결과 버전 사용</button></div>}
 {publicationLinked&&<Note className={styles.note}>자연유입 발행과 연결된 실행입니다. 위의 발행 연결에서 저장된 서버 결과를 동기화하세요. 수동 실행 결과 입력은 잠겨 있습니다.</Note>}<form onSubmit={event=>{event.preventDefault();void mutate('record_execution_receipt');}}><fieldset className={styles.receipt} disabled={busy||!view.canRecord||terminal||staleReceipt||staleCampaign||publicationLinked}><legend>실행 결과 확인 기록</legend><label>확인 상태<select value={receipt.status} onChange={event=>setReceipt(previous=>({...previous,status:event.target.value as Receipt['status']}))}><option value="unknown">결과 미확인 · 예약 유지</option><option value="observed">운영자 관측 완료</option><option value="failed">실패 확인</option></select></label><label>결과 증빙 내부 ID<input required maxLength={200} value={receipt.reference} onChange={event=>setReceipt(previous=>({...previous,reference:event.target.value}))}/></label><label>결과 확인 내용<textarea required maxLength={1000} value={receipt.note} onChange={event=>setReceipt(previous=>({...previous,note:event.target.value}))}/></label><button type="submit">실행 결과 기록</button></fieldset></form>
 <GrowthReconciliationPanel key={selected.id} intent={selected} data={view} busy={busy} onBusy={onBusy} onSubmit={async payload=>{const next=await request(campaignId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,campaignId})},true);if('viewUnavailable' in next){if(next.resultIntentId!==selected.id)throw new Error('저장 대상 확인이 필요합니다.');if(mounted.current)onView({...view,canRecord:false,canPrepare:false});return next;}if(mounted.current){onView(next);const row=next.intents.find(item=>item.id===selected.id);if(row)setSelection({id:row.id,version:row.version});}return next;}}/>
 <section aria-label="실행 증빙 이력"><h4>실행 증빙 이력</h4>{view.receipts.filter(row=>row.intentId===selected.id).sort((a,b)=>b.intentVersion-a.intentVersion).map(row=><article className={styles.mission} key={row.id}><strong>{states[row.state]??row.state} · v{row.intentVersion}</strong><p>{dateTime(row.recordedAt)}</p>{row.input&&<><p>근거: {row.input.reference}</p><p>{row.input.note}</p></>}</article>)}</section>{terminal&&<p>최종 확인 기록은 다시 실행하거나 덮어쓰지 않습니다.</p>}<Note className={styles.note}>결과 미확인에서는 재실행하지 않고 증빙을 확인합니다. 관측 완료는 매출 증명이 아닙니다. 실제 주문·출고·정산은 주문 운영 장부에서 확인하세요.</Note></div>}</div>
 </div>;
}
export function GrowthExecutionPanel({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[linkedIntentIds,setLinkedIntentIds]=useState<string[]>([]);
 const read=useRef<AbortController|null>(null);
 const load=useCallback(async(signal:AbortSignal)=>{setLoading(true);setError('');try{const next=await request(campaignId,{signal});if(!signal.aborted)setView(next);}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'실행 준비를 불러오지 못했습니다.');}finally{if(!signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{const c=new AbortController();read.current=c;void Promise.resolve().then(()=>{if(!c.signal.aborted)void load(c.signal);});return()=>read.current?.abort();},[load]);
 function reload(){read.current?.abort();const c=new AbortController();read.current=c;void load(c.signal);}
 function saved(next:View){read.current?.abort();setLoading(false);setView(next);}
 return <section className={styles.panel} aria-label="일반 판매 실행 준비"><header className={styles.header}><div><h3>일반 판매 실행 준비</h3><p>서명된 위임과 준비된 미션에 예산·공유 재고를 함께 예약합니다.</p></div><button aria-label="실행 준비 새로고침" type="button" disabled={loading||busy} onClick={reload}>새로고침</button></header>
 <Note className={styles.note}>외부 판매·광고 실행은 수행하지 않습니다. 결과 기록만으로 예산·재고를 자동 해제하지 않습니다. 증빙은 개인정보와 비밀값이 없는 내부 ID, 담당자는 역할로 입력하세요.</Note>
 <GrowthPublicationPanel campaignId={campaignId} onChanged={ids=>{setLinkedIntentIds(previous=>[...new Set([...previous,...ids])]);reload();}}/>
 {loading&&<ScreenSkeleton label="실행 준비를 불러오고 있습니다." rows={2}/>}{error&&<p role="alert" className={styles.error}>{error}</p>}{view&&<ExecutionEditor key={campaignId} campaignId={campaignId} view={view} linkedIntentIds={linkedIntentIds} onView={saved} busy={busy} onBusy={value=>{if(value){read.current?.abort();setLoading(false);}setBusy(value);}}/>}
 </section>;
}
