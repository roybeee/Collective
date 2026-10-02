'use client';
import {CheckInput} from '@/components/app/check';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthBundleView} from '@/lib/growth-bundle-server';
import type {BundleInput} from '@/lib/growth-bundle';
import styles from './growth-panel.module.css';
type View=GrowthBundleView;
const won=(n:number|null)=>n===null?'미확인':`${n.toLocaleString('ko-KR')}원`;
const emptyInput=():BundleInput=>({title:'',components:[{catalogId:'',catalogVersion:1,units:1},{catalogId:'',catalogVersion:1,units:1}],price:null,priceApproved:false,plannedQuantity:0,landingUrl:'',purchaseReason:''});
async function read(campaignId:string,signal:AbortSignal):Promise<View>{const r=await fetch(`/api/growth/bundles?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal}),v:unknown=await r.json();if(!r.ok)throw new Error('번들을 조회하지 못했습니다. 관리자 권한과 연결 상태를 확인하세요.');if(!v||typeof v!=='object'||!Array.isArray((v as View).bundles))throw new Error('번들 응답을 확인하지 못했습니다.');return v as View;}
export function GrowthBundlePanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[editing,setEditing]=useState<{id:string;expectedVersion:number}|null>(null),[input,setInput]=useState<BundleInput>(emptyInput),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null),retry=useRef<{key:string;requestId:string}|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const next=await read(campaignId,controller.signal);if(!controller.signal.aborted){setView(next);setStale(false);}}catch(e){if(!controller.signal.aborted){setStale(true);setError(e instanceof Error?e.message:'조회 실패');}}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{mounted.current=true;void Promise.resolve().then(()=>{if(mounted.current)void load();});return()=>{mounted.current=false;reading.current?.abort();writing.current?.abort();};},[load]);
 const busy=loading||saving,current=editing?view?.bundles.find(b=>b.id===editing.id):undefined,conflict=!!editing&&editing.expectedVersion>0&&current?.version!==editing.expectedVersion;
 async function save(){if(busy||writing.current||!view||!editing||stale||conflict)return;
  const payload={campaignId,campaignVersion:view.campaignVersion,action:'save_bundle',id:editing.id,expectedVersion:editing.expectedVersion,input},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.requestId:crypto.randomUUID();retry.current={key,requestId};const controller=new AbortController();writing.current=controller;setSaving(true);setError('');setMessage('');
  try{const r=await fetch('/api/growth/bundles',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...payload,requestId})}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'저장하지 못했습니다.');if(!v||typeof v!=='object'||(v as {recorded?:boolean}).recorded!==true)throw new Error('저장 결과를 확인하지 못했습니다.');if(!mounted.current||controller.signal.aborted)return;retry.current=null;setEditing({id:editing.id,expectedVersion:(v as {version:number}).version});setStale(true);setMessage('번들을 저장했습니다. 최신 조회가 실패해도 저장은 완료된 상태입니다.');await load();}
  catch(e){if(mounted.current&&!controller.signal.aborted)setError(`${e instanceof Error?e.message:'저장 실패'} 입력은 보존했습니다. 응답 미확인은 같은 입력으로 재시도하세요.`);}
  finally{writing.current=null;if(mounted.current&&!controller.signal.aborted)setSaving(false);}
 }
 const comp=(i:number,patch:Partial<BundleInput['components'][number]>)=>setInput(x=>({...x,components:x.components.map((c,j)=>j===i?{...c,...patch}:c)}));
 return <section aria-label="번들 오퍼" className={styles.panel}><header className={styles.header}><h3>여러 상품 번들 · 원가와 재고 할당</h3><Button variant="panel" size="fit" aria-label="번들 새로고침" type="button" disabled={busy} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>번들의 원가·이익·할인과 만들 수 있는 수량을 계산합니다. 구성 상품의 정확한 판으로 번들 원가(수량×(원가+변동비))·공헌이익·정가 대비 할인과, 공유 재고로 만들 수 있는 최대 번들 수를 셉니다. 원가·세금 기준·재고가 확인되지 않으면 추정하지 않고 미확인으로 둡니다. 재고 예약·판매 실행은 하지 않습니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">번들을 조회하고 있습니다.</p>}{stale&&<p role="status" className={styles.warning}>이전 조회 결과입니다. 최신 조회 전에는 추가 저장을 할 수 없습니다.</p>}
  {view&&<>{view.canEdit&&<Button variant="panel" size="fit" type="button" disabled={busy} onClick={()=>{setEditing({id:`bundle-${crypto.randomUUID().slice(0,8)}`,expectedVersion:0});setInput(emptyInput());retry.current=null;}}>새 번들</Button>}
   {editing&&<form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||!view.canEdit} className={styles.form}><legend>번들 {editing.id}</legend>
    <label>번들명<Input required maxLength={200} value={input.title} onChange={e=>setInput({...input,title:e.target.value})}/></label>
    {input.components.map((c,i)=><div key={i} className={styles.wide}><label>구성 상품 {i+1}<NativeSelect value={c.catalogId} onChange={e=>{const cat=view.catalogs.find(x=>x.id===e.target.value);comp(i,{catalogId:e.target.value,catalogVersion:cat?.version??1});}}><option value="">상품 선택</option>{view.catalogs.map(x=><option key={x.id} value={x.id}>{x.title||x.sku} · v{x.version} · 가용 {x.available??'미확인'}</option>)}</NativeSelect></label><label>구성 수량 {i+1}<Input type="number" min={1} max={1000} value={c.units} onChange={e=>comp(i,{units:Number(e.target.value)})}/></label>{input.components.length>2&&<Button variant="panel" size="fit" type="button" onClick={()=>setInput(x=>({...x,components:x.components.filter((_,j)=>j!==i)}))}>구성 {i+1} 삭제</Button>}</div>)}
    {input.components.length<10&&<Button variant="panel" size="fit" type="button" onClick={()=>setInput(x=>({...x,components:[...x.components,{catalogId:'',catalogVersion:1,units:1}]}))}>구성 추가</Button>}
    <label>번들 가격(원)<Input type="number" min={0} value={input.price??''} onChange={e=>setInput({...input,price:e.target.value===''?null:Number(e.target.value)})}/></label>
    <label><CheckInput checked={input.priceApproved} onChange={e=>setInput({...input,priceApproved:e.target.checked})}/>번들 가격 승인</label>
    <label>계획 판매 수량<Input type="number" min={0} value={input.plannedQuantity} onChange={e=>setInput({...input,plannedQuantity:Number(e.target.value)})}/></label>
    <label className={styles.wide}>구매 링크<Input value={input.landingUrl} onChange={e=>setInput({...input,landingUrl:e.target.value})}/></label>
    <label className={styles.wide}>구매 이유<Input maxLength={1000} value={input.purchaseReason} onChange={e=>setInput({...input,purchaseReason:e.target.value})}/></label>
    {conflict&&<div className={styles.wide}><p>이 번들이 다른 곳에서 바뀌었습니다. 입력을 보존했습니다.</p><Button variant="panel" size="fit" type="button" disabled={stale||!current} onClick={()=>{if(current)setEditing({id:current.id,expectedVersion:current.version});retry.current=null;}}>현재 입력 유지 · 최신 판 채택</Button></div>}
    <Button variant="panel" size="fit" type="submit" disabled={stale||conflict}>번들 저장</Button></fieldset></form>}
   {!view.bundles.length&&<p>번들이 없습니다.</p>}
   <ul>{view.bundles.map(b=><li key={b.id} className="wrap-anywhere"><p><strong>{b.input.title||b.id}</strong> · v{b.version} · 가격 {won(b.input.price)}{b.input.priceApproved?'(승인)':'(미승인)'} · 원가 {won(b.assessment.cost)} · 공헌이익 {won(b.assessment.contribution)} · 정가 합 {won(b.assessment.listPrice)}</p>
    <p>만들 수 있는 번들 {b.assessment.maxBundles??'미확인'}개 · 계획 {b.input.plannedQuantity}개</p>
    <ul>{b.assessment.allocation.map(a=><li key={a.catalogId}>{a.catalogId}: 번들당 {a.unitsPerBundle} · 필요 {a.required} · 가용 {a.available??'미확인'}{a.status==='held'?' · 재고 보류':''}</li>)}</ul>
    {b.assessment.missing.map(x=><p key={x}>{x}</p>)}
    {view.canEdit&&<Button variant="panel" size="fit" type="button" disabled={busy||stale} onClick={()=>{setEditing({id:b.id,expectedVersion:b.version});setInput(structuredClone(b.input));retry.current=null;}}>{b.id} 수정</Button>}</li>)}</ul></>}
 </section>;
}
