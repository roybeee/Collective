'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import type {Campaign} from '@/lib/agency';
import type {BrandFact} from '@/lib/brand-facts';
import type {FactDecision} from '@/lib/brand-facts-server';
import {adminRequestNote,useCanManage} from './auth-client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';

const statuses={candidate:'확인 후보',confirmed:'확인 사실',rejected:'사용 거절'};
type FactForm=Pick<BrandFact,'key'|'value'|'status'|'source'|'verifiedAt'|'validUntil'>;
const emptyForm:FactForm={key:'',value:'',status:'candidate',source:'',verifiedAt:'',validUntil:''};
function localInput(value:string){
 if(!value)return '';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
 const adjusted=new Date(date.getTime()-date.getTimezoneOffset()*60000);
 return adjusted.toISOString().slice(0,16);
}
function isoInput(value:string){return value?new Date(value).toISOString():''}

export function BrandFactsPanel({campaign,onChanged}:{campaign:Campaign;onChanged?:()=>void}){
 const [facts,setFacts]=useState<(BrandFact&FactDecision)[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [checkedAt,setCheckedAt]=useState(()=>Date.now());
 const [editing,setEditing]=useState<BrandFact|null>(null),[form,setForm]=useState<FactForm>(emptyForm),[open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false);
 // 직원은 확인 후보만 제안·수정한다. 확정·거절과 확정·거절된 사실 수정은 관리자 전용이다(서버 403).
 const canManage=useCanManage();
 const load=useCallback(async(signal?:AbortSignal)=>{
  setLoading(true);setError('');
  try{
   const params=new URLSearchParams({brandId:campaign.brandId});if(campaign.storeId)params.set('storeId',campaign.storeId);
   const response=await fetch('/api/brand-facts?'+params,{signal});const data=await response.json() as {facts:(BrandFact&FactDecision)[];error?:string};
   if(!response.ok)throw new Error(data.error||'사실 목록을 불러오지 못했습니다.');
   if(!signal?.aborted){setFacts(data.facts.filter(f=>!f.storeId||f.storeId===campaign.storeId));setCheckedAt(Date.now())}
  }catch(error){if(!signal?.aborted)setError((error as Error).message)}finally{if(!signal?.aborted)setLoading(false)}
 },[campaign.brandId,campaign.storeId]);
 useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>{if(!controller.signal.aborted)return load(controller.signal)});return ()=>controller.abort()},[load]);
 function edit(fact:BrandFact|null){
  setEditing(fact);setForm(fact?{key:fact.key,value:fact.value,status:fact.status,source:fact.source,verifiedAt:localInput(fact.verifiedAt),validUntil:localInput(fact.validUntil)}:emptyForm);
  setConfirmed(false);setOpen(true);setError('');setMessage('');
 }
 async function save(event:FormEvent){
  event.preventDefault();setSaving(true);setError('');setMessage('');
  try{
   const storeId=editing?editing.storeId:campaign.storeId;
   const response=await fetch('/api/brand-facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_fact',id:editing?.id,version:editing?.version,confirmed:form.status==='confirmed'&&confirmed,data:{...form,brandId:campaign.brandId,...(storeId?{storeId}:{}),verifiedAt:isoInput(form.verifiedAt),validUntil:isoInput(form.validUntil)}})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error((response.status===409?'저장 충돌: ':'')+(data.error||'사실을 저장하지 못했습니다.'));
   setOpen(false);setEditing(null);setMessage('브랜드 사실을 저장했습니다.');await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 return <section aria-label="브랜드 확인 사실"><div className="section-heading"><div><h3>브랜드 확인 사실</h3><p>조리 방식·가격·영업시간 등 근거를 확인한 내용을 관리합니다.</p></div><Button disabled={saving} onClick={()=>edit(null)}>사실 추가</Button></div>
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" disabled={saving} onClick={()=>void load()}>목록 새로고침</Button></div>}{message&&<p role="status">{message}</p>}
  {loading?<p role="status">사실을 불러오고 있습니다.</p>:facts.length?<ul className="artifact-list">{facts.map(f=><li key={f.id} className="brand-detail-card"><div className="brand-detail-body"><h4>{f.key} · {statuses[f.status]}</h4><p style={{whiteSpace:'pre-wrap'}}>{f.value}</p><p>{f.storeId?'이 지점':'브랜드 공통'} · v{f.version}{f.status==='confirmed'&&Date.parse(f.validUntil)<=checkedAt?' · 유효 기한 만료':''}</p><p>근거: {f.source||'미확인'}</p><p>확인: {f.verifiedAt?new Date(f.verifiedAt).toLocaleString('ko-KR'):'미확인'} · 유효 기한: {f.validUntil?new Date(f.validUntil).toLocaleString('ko-KR'):'미설정'}</p>{f.status!=='candidate'&&f.confirmedBy&&<p>{f.status==='confirmed'?'확정':'거절'}: {f.confirmedBy.email||f.confirmedBy.id}{f.confirmedAt?' · '+new Date(f.confirmedAt).toLocaleString('ko-KR'):''}</p>}{(canManage||f.status==='candidate')&&<Button variant="outline" disabled={saving} onClick={()=>edit(f)} aria-label={`${f.key} 사실 편집`}>{canManage?'편집·상태 변경':'후보 수정'}</Button>}</div></li>)}</ul>:<p className="notice">등록된 사실이 없습니다. 확인 후보부터 기록하고 근거 확인 후 확정하세요.</p>}
  {open&&<form className="form-stack" onSubmit={save} aria-label="브랜드 사실 편집"><fieldset disabled={saving} className="form-stack"><legend>{editing?'사실 수정':'새 사실'} · {editing?(editing.storeId?'이 지점':'브랜드 공통'):(campaign.storeId?'이 지점':'브랜드 공통')}</legend>
   <label className="field"><span>사실 항목</span><Input required maxLength={120} value={form.key} onChange={e=>setForm({...form,key:e.target.value})} placeholder="조리 방식"/></label>
   <label className="field"><span>확인할 내용</span><Textarea required rows={3} maxLength={5000} value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/></label>
   {canManage?<label className="field"><span>사실 상태</span><NativeSelect value={form.status} onChange={e=>{setForm({...form,status:e.target.value as BrandFact['status']});setConfirmed(false)}}>{Object.entries(statuses).map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label>:<p className="subtle-note">사실 상태: {statuses.candidate}. 확정·거절은 관리자만 할 수 있습니다. {adminRequestNote}</p>}
   <label className="field"><span>확인 근거 · 문서·담당자·URL</span><Textarea required={form.status==='confirmed'} rows={2} maxLength={3000} value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></label>
   <div className="form-two"><label className="field"><span>확인 시점 · 현재 기기 시간대</span><Input type="datetime-local" required={form.status==='confirmed'} value={form.verifiedAt} onChange={e=>setForm({...form,verifiedAt:e.target.value})}/></label><label className="field"><span>유효 기한 · 현재 기기 시간대</span><Input type="datetime-local" required={form.status==='confirmed'} value={form.validUntil} onChange={e=>setForm({...form,validUntil:e.target.value})}/></label></div>
   {form.status==='confirmed'&&<label><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 근거를 직접 확인했고 유효 기한까지 적용 가능한 사실임을 확인합니다.</label>}
   <p className="notice">후보·거절·기한이 지난 사실은 제작용 확인 사실에서 제외됩니다. 같은 항목의 지점 사실이 있으면 브랜드 공통 사실보다 우선합니다.</p>
   <div className="form-actions"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>취소</Button><Button type="submit">{saving?'저장 중…':'사실 저장'}</Button></div>
  </fieldset></form>}
 </section>;
}
