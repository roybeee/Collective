'use client';
import {EmptyLine} from '@/components/app/empty-line';

import {readOnlyReason} from '@/lib/ui/read-only';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import styles from './growth-panel.module.css';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';

type Purpose='identity_link'|'post_purchase'|'marketing_reorder';
type Consent={state:'granted'|'revoked';noticeVersion:string;evidenceRef:string;observedAt:string;expiresAt:string};
type Customer={id:string;version:number;state:'active'|'erased';consents:Record<Purpose,Consent|null>;links:unknown[];assessment:{postPurchaseEligible:boolean;reorderEligible:boolean;reasons:string[];latestPurchaseAt:string|null;waitDays:number;maySend:false}};
type View={resultCustomerId?:string;orderAvailability?:'available'|'unavailable';customers:Customer[];orders:{id:string;version:number;orderDate:string;status:string;paidAmount:number;refundAmount:number}[];campaignVersion:number;canEdit:boolean;maySend:false;mayExecute:false;waitDays:number;storeId:string};
type Acknowledgment={withdrawn?:true;erased?:true;customerId:string;version:number;campaignVersion:number;maySend:false};
const purposes:readonly (readonly [Purpose,string])[]=[['identity_link','동일인 주문 연결'],['post_purchase','구매 후 관리'],['marketing_reorder','마케팅·재구매']];
async function request(campaignId:string,waitDays:number,init:RequestInit={}):Promise<View|Acknowledgment>{
 const response=await fetch(`/api/growth/consumer${init.method==='POST'?'':`?campaignId=${encodeURIComponent(campaignId)}&waitDays=${waitDays}`}`,{...init,cache:'no-store'});
 const raw:unknown=await response.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('소비자 동의 응답을 확인하지 못했습니다.');
 const data=raw as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'소비자 동의 요청에 실패했습니다.');
 if(init.method==='POST'&&(data.withdrawn===true||data.erased===true)&&typeof data.customerId==='string'&&typeof data.version==='number')return data as unknown as Acknowledgment;
 if(!Array.isArray(data.customers)||!Array.isArray(data.orders)||typeof data.campaignVersion!=='number'||typeof data.canEdit!=='boolean')throw new Error('소비자 동의 응답을 확인하지 못했습니다.');
 return data as unknown as View;
}
function ConsumerEditor({campaignId,view,onView,busy,onBusy}:{campaignId:string;view:View;onView:(v:View)=>void;busy:boolean;onBusy:(v:boolean)=>void}){
 const [selection,setSelection]=useState({id:'',version:0}),[campaignVersion,setCampaignVersion]=useState(view.campaignVersion);
 const [purpose,setPurpose]=useState<Purpose>('identity_link'),[draft,setDraft]=useState({noticeVersion:'',evidenceRef:'',observedAt:'',expiresAt:''});
 const [order,setOrder]=useState({id:'',version:0}),[linkEvidence,setLinkEvidence]=useState('');
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),pending=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.abort();};},[]);
 const selected=view.customers.find(row=>row.id===selection.id),stale=!!selected&&selected.version!==selection.version,staleCampaign=campaignVersion!==view.campaignVersion;
 const locked=busy||stale||staleCampaign,editable=!!selected&&selected.state==='active'&&view.canEdit;
 function pick(row:Customer){if(row.id!==selection.id){setDraft({noticeVersion:'',evidenceRef:'',observedAt:'',expiresAt:''});setOrder({id:'',version:0});setLinkEvidence('');setPurpose('identity_link');}setSelection({id:row.id,version:row.version});setError('');setMessage('');retry.current=null;}
 async function mutate(action:string,extra:Record<string,unknown>={}){
  if(pending.current||busy)return;
  const payload={action,campaignId,campaignVersion,waitDays:view.waitDays,...(action==='create_customer'?{expectedVersion:0}:{customerId:selection.id,expectedVersion:selection.version}),...extra};
  const key=JSON.stringify(payload),previous=retry.current?.key===key?retry.current:null,requestId=previous?.requestId??crypto.randomUUID();retry.current={key,requestId};
  const c=new AbortController();pending.current=c;onBusy(true);setError('');setMessage('');
  try{
   const result=await request(campaignId,view.waitDays,{method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({...payload,requestId})});
   if(!mounted.current||c.signal.aborted)return;
   const next:View='customers' in result?result:{...view,campaignVersion:result.campaignVersion,customers:view.customers.map(item=>item.id!==result.customerId?item:{...item,version:result.version,state:result.erased?'erased':item.state,links:result.erased||extra.purpose==='identity_link'?[]:item.links,consents:result.erased?{identity_link:null,post_purchase:null,marketing_reorder:null}:{...item.consents,[String(extra.purpose)]:{state:'revoked',noticeVersion:'',evidenceRef:'',observedAt:'',expiresAt:''}},assessment:{...item.assessment,latestPurchaseAt:result.erased||extra.purpose==='identity_link'?null:item.assessment.latestPurchaseAt,postPurchaseEligible:false,reorderEligible:false,reasons:['철회·삭제 반영 완료. 최신 평가를 조회하세요.']}})};
   const row=next.customers.find(item=>action==='create_customer'?item.id===next.resultCustomerId:item.id===selection.id);
   if(!row)throw new Error('저장 기록을 확인하지 못했습니다. 새로고침하여 결과를 확인하세요.');
   onView(next);if(action==='create_customer')pick(row);else setSelection({id:row.id,version:row.version});setCampaignVersion(next.campaignVersion);retry.current=null;
   setMessage(action==='create_customer'?'가명 소비자를 생성했습니다.':action==='link_order'?'주문을 연결했습니다.':action==='erase_customer'?'가명 소비자와 주문 연결을 삭제했습니다.':extra.state==='revoked'?'동의를 철회했습니다.':'목적별 동의를 기록했습니다.');
   if(!('customers' in result)){try{const refreshed=await request(campaignId,view.waitDays,{signal:c.signal});if(mounted.current&&!c.signal.aborted&&'customers' in refreshed)onView(refreshed);}catch{if(mounted.current&&!c.signal.aborted)setMessage(previous=>`${previous} 최신 평가는 새로고침해 확인하세요.`);}}
  }catch(e){if(mounted.current&&!c.signal.aborted)setError(`${e instanceof Error?e.message:'저장하지 못했습니다.'} 입력은 보존했습니다. 응답을 확인하지 못했다면 동일 입력으로 재시도하거나 새로고침해 결과를 확인하세요.`);}
  finally{pending.current=null;if(mounted.current&&!c.signal.aborted)onBusy(false);}
 }
 return <><Button disabledReason={view.canEdit?undefined:readOnlyReason} variant="panel" size="fit" type="button" disabled={locked||!view.canEdit} onClick={()=>void mutate('create_customer')}>새 가명 소비자 생성</Button>{error&&<p className={styles.error} role="alert">{error}</p>}{message&&<p className={styles.success} role="status">{message}</p>}
 {staleCampaign&&<p className={styles.error}>캠페인이 변경되었습니다.<Button variant="panel" size="fit" type="button" disabled={busy} onClick={()=>setCampaignVersion(view.campaignVersion)}>현재 입력 유지 · 최신 캠페인 기준 사용</Button></p>}
 <div className={styles.workspace}><div role="group" className={styles.list} aria-label="가명 소비자 목록">{!view.customers.length&&<EmptyLine first={view.canEdit?'가명 소비자':undefined}>등록된 가명 소비자가 없습니다.</EmptyLine>}{view.customers.map(row=><Button variant="panel" size="fit" type="button" key={row.id} disabled={busy} aria-pressed={row.id===selection.id} onClick={()=>pick(row)}><strong>가명 {row.id.slice(0,12)}</strong><span>{row.state==='erased'?'삭제됨':'활성'} · v{row.version}</span></Button>)}</div>
 {selected&&<div className={styles.editor}><h4>가명 소비자 · v{selection.version}</h4><p className="wrap-anywhere">{selected.id}</p>{stale&&<div className={styles.error}>기록이 v{selected.version}로 바뀌었습니다. 아래 최신 동의 상태를 검토하세요.<Button variant="panel" size="fit" type="button" disabled={busy} onClick={()=>{setSelection({id:selected.id,version:selected.version});retry.current=null;}}>현재 입력 유지 · 최신 소비자 버전 사용</Button></div>}
 <section aria-label="소비자 적격성" className={styles.readiness}><p>구매 후 관리: {selected.assessment.postPurchaseEligible?'후보':'보류'}</p><p>재구매 검토: {selected.assessment.reorderEligible?'후보':'보류'}</p><p>최근 구매일: {selected.assessment.latestPurchaseAt??'미확인'} · 검토 대기 {selected.assessment.waitDays}일</p><ul>{selected.assessment.reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul><p>후보 여부는 검토용입니다. 고객 메시지를 발송하지 않습니다.</p></section>
 <section aria-label="목적별 동의 상태">{purposes.map(([id,label])=><article key={id} className={styles.mission} aria-label={`${label} 동의 상태`}><h4>{label}</h4><p>{selected.consents[id]?.state==='granted'?'동의 기록':selected.consents[id]?.state==='revoked'?'철회':'동의 없음'}</p>{selected.consents[id]&&<p>확인: {selected.consents[id]?.observedAt||'미확인'}<br/>만료: {selected.consents[id]?.expiresAt||'해당 없음'}<br/>고지문: {selected.consents[id]?.noticeVersion||'해당 없음'}<br/>증빙: {selected.consents[id]?.evidenceRef||'해당 없음'}</p>}<Button variant="panel" size="fit" type="button" disabled={locked||selected.state==='erased'} onClick={()=>void mutate('set_consent',{purpose:id,state:'revoked'})}>{label} 동의 철회</Button></article>)}</section>
 {editable&&<form onSubmit={event=>{event.preventDefault();void mutate('set_consent',{purpose,state:'granted',...draft});}}><fieldset disabled={locked} className={styles.form}><legend>목적별 동의 기록</legend><label className={styles.field}>동의 목적<NativeSelect value={purpose} onChange={event=>setPurpose(event.target.value as Purpose)}>{purposes.map(([id,label])=><option key={id} value={id}>{label}</option>)}</NativeSelect></label>{([['noticeVersion','고지문 버전'],['evidenceRef','동의 증빙 내부 ID'],['observedAt','동의 확인 시각 (시간대 포함)'],['expiresAt','동의 만료 시각 (시간대 포함)']] as const).map(([key,label])=><label className={styles.field} key={key}>{label}<Input required maxLength={120} value={draft[key]} placeholder={key.endsWith('At')?'2026-09-30T03:00:00Z':undefined} onChange={event=>setDraft(previous=>({...previous,[key]:event.target.value}))}/></label>)}<Button variant="panel" size="fit" type="submit">선택 목적 동의 기록</Button></fieldset></form>}
 {editable&&<form onSubmit={event=>{event.preventDefault();void mutate('link_order',{orderId:order.id,orderVersion:order.version,evidenceRef:linkEvidence});}}><fieldset disabled={locked} className={styles.form}><legend>운영자가 확인한 동일인 주문 연결</legend><label className={styles.wide}>연결할 지점 주문<NativeSelect required value={order.id} onChange={event=>setOrder({id:event.target.value,version:view.orders.find(row=>row.id===event.target.value)?.version??0})}><option value="">선택하세요</option>{view.orders.map(row=><option key={row.id} value={row.id}>{row.orderDate} · {row.status} · {row.paidAmount.toLocaleString()}원 · {row.id.slice(0,10)} · v{row.version}</option>)}</NativeSelect></label><label className={styles.wide}>동일인 연결 증빙 내부 ID<Input required maxLength={120} value={linkEvidence} onChange={event=>setLinkEvidence(event.target.value)}/></label><p className={styles.wide}>주문 연결은 운영자가 확인한 증빙입니다. 자동 동일인 인증이 아닙니다. 현재 지점 주문만 표시합니다.</p><Button variant="panel" size="fit" type="submit">운영자 확인으로 주문 연결</Button></fieldset></form>}
 <p>연결 주문 수: {selected.links.length}</p>{view.orderAvailability==='unavailable'&&<Note className={styles.note}>현재 지점 주문을 조회할 수 없습니다. 지점 연결과 주문 범위를 확인하세요. 동의 철회와 삭제는 계속 가능합니다.</Note>}{selected.state==='active'&&<details><summary>가명 소비자 삭제</summary><p>목적별 동의와 동일인 주문 연결을 제거합니다. 원 주문과 회계 기록은 보존합니다.</p><Button variant="panel" size="fit" type="button" disabled={locked} onClick={()=>void mutate('erase_customer')}>가명 소비자·연결 삭제</Button></details>}{selected.state==='erased'&&<p>삭제된 가명 소비자입니다. 원 주문은 주문 운영에서 확인하세요.</p>}
 </div>}</div></>;
}
export function GrowthConsumerPanel({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[waitDays,setWaitDays]=useState(30),[draftDays,setDraftDays]=useState('30');
 const read=useRef<AbortController|null>(null);
 const load=useCallback(async(signal:AbortSignal)=>{setLoading(true);setError('');try{const next=await request(campaignId,waitDays,{signal});if(!signal.aborted&&'customers' in next)setView(next);}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'소비자 동의를 불러오지 못했습니다.');}finally{if(!signal.aborted)setLoading(false);}},[campaignId,waitDays]);
 useEffect(()=>{const c=new AbortController();read.current=c;void Promise.resolve().then(()=>{if(!c.signal.aborted)void load(c.signal);});return()=>read.current?.abort();},[load]);
 function reload(){read.current?.abort();const c=new AbortController();read.current=c;void load(c.signal);}
 return <section className={styles.panel} aria-label="소비자 동의·재구매"><header className={styles.header}><div><h3>소비자 동의·재구매</h3><p>브랜드별 가명 소비자, 목적별 동의, 주문 연결과 재구매 검토를 기록합니다.</p></div><Button variant="panel" size="fit" aria-label="소비자 동의 새로고침" type="button" disabled={loading||busy} onClick={reload}>새로고침</Button></header>
 <Note className={styles.note}>이름·연락처·외부 고객 식별자를 입력하지 마세요. 동의 고지문과 증빙은 내부 참조만 기록합니다. 일시는 UTC 기준 Z 형식으로 입력하세요. 목적별 동의는 서로 대체되지 않습니다. 만료된 동의도 철회할 수 있습니다.</Note>
 <form onSubmit={event=>{event.preventDefault();const days=Number(draftDays);if(draftDays===''||!Number.isInteger(days)||days<0||days>365){setError('대기일은 0~365 사이의 정수로 입력하세요.');return;}setWaitDays(days);if(days===waitDays)reload();}}><fieldset className={styles.form} disabled={loading||busy}><legend>재구매 후보 검토 조건</legend><label className={styles.field}>재구매 검토 대기일<Input type="number" required min={0} max={365} step={1} value={draftDays} onChange={event=>setDraftDays(event.target.value)}/></label><Button variant="panel" size="fit" type="submit">대기일 적용</Button><p className={styles.wide}>이 화면의 대기일은 검토용 조건이며 자동 발송 일정이나 저장된 운영 정책이 아닙니다.</p></fieldset></form>
 {loading&&<ScreenSkeleton label="소비자 동의를 불러오고 있습니다." rows={2}/>}{error&&<p role="alert" className={styles.error}>{error}</p>}{view&&<ConsumerEditor key={campaignId} campaignId={campaignId} view={view} onView={next=>{read.current?.abort();setLoading(false);setView(next);}} busy={busy} onBusy={value=>{if(value){read.current?.abort();setLoading(false);}setBusy(value);}}/>}
 </section>;
}
