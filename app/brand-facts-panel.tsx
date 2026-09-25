'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import type {Campaign} from '@/lib/agency';
import type {BrandFact} from '@/lib/brand-facts';
import type {FactDecision} from '@/lib/brand-facts-server';
import type {FactImportSkip,LedgerCheck} from '@/lib/fact-import';
import {factCatalog,factCatalogItem,factLabel,franchiseItem} from '@/lib/fact-catalog';
import {costDetailLine,footnoteLine,VERSION_STATE_LABELS,type VersionState} from '@/lib/franchise-facts';
import {adminRequestNote,useCanManage} from './auth-client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOptGroup,NativeSelectOption} from '@/components/ui/native-select';

const statuses={candidate:'확인 후보',confirmed:'확인 사실',rejected:'사용 거절'};
const checkStates:Record<LedgerCheck['state'],string>={unverified:'미확인',candidate:'후보 검토 중',conflict:'원장과 다름',prohibited:'거절된 표현'};
const OTHER='__other';
type FactForm=Pick<BrandFact,'key'|'value'|'status'|'source'|'verifiedAt'|'validUntil'>;
type Overview={readiness:{confirmed:number;candidates:number;importable:number};checks:LedgerCheck[];stores:{id:string;name:string}[]};
type SaveResult={error?:string;warnings?:string[];reviewPublications?:number|null;rebased?:number;unchanged?:number};
const emptyForm:FactForm={key:'',value:'',status:'candidate',source:'',verifiedAt:'',validUntil:''};
// 트랙 R R1b 가맹 블록(GET /api/brand-facts, 가맹 프로필이나 정보공개서 버전이 있는 브랜드만).
type FranchiseBlock={enabled:boolean;fiscalYearEnd:string|null;currentVersionId:string|null;versions:{id:string;label:string;registeredAt:string|null;state:VersionState}[];staleFactIds:string[];disclaimer:string};
// 정보공개서 근거·창업비용 상세 입력(문자열). 포함·불포함은 쉼표로 나눈다.
type SourceForm={versionId:string;fiscalYear:string;page:string;asOf:string;storeType:string;includes:string;excludes:string;areaM2:string};
const emptySource:SourceForm={versionId:'',fiscalYear:'',page:'',asOf:'',storeType:'',includes:'',excludes:'',areaM2:''};
const listOf=(text:string)=>text.split(',').map(x=>x.trim()).filter(Boolean);
const sourceFormOf=(f:BrandFact|null):SourceForm=>f?{versionId:f.sourceRef?.disclosureVersionId??'',fiscalYear:f.sourceRef?String(f.sourceRef.fiscalYear):'',page:f.sourceRef?.page?String(f.sourceRef.page):'',asOf:f.sourceRef?.asOf??'',storeType:f.cost?.storeType??'',includes:f.cost?.includes.join(', ')??'',excludes:f.cost?.excludes.join(', ')??'',areaM2:f.cost?.areaM2?String(f.cost.areaM2):''}:emptySource;
function localInput(value:string){
 if(!value)return '';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
 const adjusted=new Date(date.getTime()-date.getTimezoneOffset()*60000);
 return adjusted.toISOString().slice(0,16);
}
function isoInput(value:string){return value?new Date(value).toISOString():''}
async function postFacts<T>(payload:Record<string,unknown>){const response=await fetch('/api/brand-facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {response,data:await response.json() as T&{error?:string}}}
// 저장 뒤 알릴 내용: 지점 전용 항목의 브랜드 공통 저장 경고와 재검토가 필요한 예약 발행 수.
function savedNote(data:SaveResult){
 const review=data.reviewPublications===null?'예약 발행 확인에 실패했습니다. 제작·발행 탭에서 예약 발행을 확인하세요.':data.reviewPublications?`예약 발행 ${data.reviewPublications}건 검토 필요 · 제작·발행 탭에서 확인하세요.`:'';
 return [...(data.warnings||[]),review].filter(Boolean).join(' ');
}

// campaign이 있으면 그 캠페인의 브랜드·지점 범위, 없으면 brandId의 브랜드 단위로 사실 원장을 관리한다(브랜드 아카이브 '확인 사실' 탭).
export function BrandFactsPanel({campaign,brandId,onChanged}:{campaign?:Campaign;brandId?:string;onChanged?:()=>void}){
 const brand=campaign?.brandId??brandId??'';
 const [scopeStore,setScopeStore]=useState(''),storeId=campaign?campaign.storeId:scopeStore||undefined;
 const [facts,setFacts]=useState<(BrandFact&FactDecision)[]>([]),[overview,setOverview]=useState<Overview|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[alertNote,setAlertNote]=useState(''),[skipped,setSkipped]=useState<FactImportSkip[]>([]);
 const [checkedAt,setCheckedAt]=useState(()=>Date.now());
 const [franchise,setFranchise]=useState<FranchiseBlock|null>(null),[source,setSource]=useState<SourceForm>(emptySource),[rebasing,setRebasing]=useState<BrandFact|null>(null),[rebaseForm,setRebaseForm]=useState({fiscalYear:'',page:'',asOf:'',verifiedAt:'',validUntil:''});
 const [editing,setEditing]=useState<BrandFact|null>(null),[form,setForm]=useState<FactForm>(emptyForm),[open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),[otherKey,setOtherKey]=useState(false),[scopeConfirmed,setScopeConfirmed]=useState(false);
 // 직원은 확인 후보만 제안·수정·가져오기한다. 확정·거절과 확정·거절된 사실 수정은 관리자 전용이다(서버 403).
 const canManage=useCanManage();
 const scopeName=(id?:string)=>id?(overview?.stores.find(s=>s.id===id)?.name||'이 지점'):'브랜드 공통';
 const load=useCallback(async(signal?:AbortSignal)=>{
  setLoading(true);setError('');
  try{
   const params=new URLSearchParams({brandId:brand});if(storeId)params.set('storeId',storeId);
   const response=await fetch('/api/brand-facts?'+params,{signal});const data=await response.json() as {facts:(BrandFact&FactDecision)[];error?:string;franchise?:FranchiseBlock}&Partial<Overview>;
   if(!response.ok)throw new Error(data.error||'사실 목록을 불러오지 못했습니다.');
   if(!signal?.aborted){setFacts(data.facts.filter(f=>!f.storeId||f.storeId===storeId));setOverview(data.readiness&&data.checks&&data.stores?{readiness:data.readiness,checks:data.checks,stores:data.stores}:null);setFranchise(data.franchise??null);setCheckedAt(Date.now())}
  }catch(error){if(!signal?.aborted)setError((error as Error).message)}finally{if(!signal?.aborted)setLoading(false)}
 },[brand,storeId]);
 useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>{if(!controller.signal.aborted)return load(controller.signal)});return ()=>controller.abort()},[load]);
 function edit(fact:BrandFact|null){
  setEditing(fact);setForm(fact?{key:fact.key,value:fact.value,status:fact.status,source:fact.source,verifiedAt:localInput(fact.verifiedAt),validUntil:localInput(fact.validUntil)}:emptyForm);
  setSource(sourceFormOf(fact));setOtherKey(!!fact&&!factCatalogItem(fact.key));setConfirmed(false);setScopeConfirmed(false);setOpen(true);setError('');setMessage('');setAlertNote('');
 }
 const targetStore=editing?editing.storeId:storeId,keyItem=factCatalogItem(form.key),needsScopeConfirm=!!keyItem?.storeScoped&&!targetStore;
 // 가맹 항목(가맹 브랜드만): 정보공개서 근거·창업비용 상세를 함께 보낸다. 가맹 항목이 아니게 바꾸면 이전 근거를 지운다(null).
 const frItem=franchise?franchiseItem(form.key):undefined,versionLabel=(id:string)=>franchise?.versions.find(v=>v.id===id)?.label||id;
 function franchisePayload(){
  if(!frItem)return editing?.sourceRef||editing?.cost?{sourceRef:null,cost:null}:{};
  const sourceRef=frItem.disclosure&&source.versionId?{disclosureVersionId:source.versionId,fiscalYear:Number(source.fiscalYear),page:source.page?Number(source.page):null,...(frItem.asOf&&source.asOf?{asOf:source.asOf}:{})}:null;
  const cost=frItem.storeType&&source.storeType?{storeType:source.storeType,includes:listOf(source.includes),excludes:listOf(source.excludes),areaM2:source.areaM2?Number(source.areaM2):null}:null;
  return {sourceRef,cost};
 }
 async function save(event:FormEvent){
  event.preventDefault();setSaving(true);setError('');setMessage('');setAlertNote('');
  try{
   const {response,data}=await postFacts<SaveResult>({action:'save_fact',id:editing?.id,version:editing?.version,confirmed:form.status==='confirmed'&&confirmed,data:{...form,brandId:brand,...(targetStore?{storeId:targetStore}:{}),verifiedAt:isoInput(form.verifiedAt),validUntil:isoInput(form.validUntil),...franchisePayload()}});
   if(!response.ok)throw new Error((response.status===409?'저장 충돌: ':'')+(data.error||'사실을 저장하지 못했습니다.'));
   setOpen(false);setEditing(null);setMessage('브랜드 사실을 저장했습니다.');setAlertNote(savedNote(data));await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 async function importCandidates(){
  if(!overview||!window.confirm(`조사 주장·지점 정보·브리프의 확정 표현에서 사실 후보 ${overview.readiness.importable}건을 ${scopeName(storeId)} 범위의 확인 후보로 가져옵니다. 같은 항목이 이미 있으면 건너뜁니다. 확정은 관리자가 합니다. 계속할까요?`))return;
  setSaving(true);setError('');setMessage('');setAlertNote('');
  try{
   const {response,data}=await postFacts<{imported:number;skipped:FactImportSkip[]}>({action:'import_candidates',brandId:brand,...(storeId?{storeId}:{})});
   if(!response.ok)throw new Error(data.error||'사실 후보를 가져오지 못했습니다.');
   setSkipped(data.skipped);setMessage(`사실 후보 ${data.imported}건을 가져왔습니다.`+(data.skipped.length?` 같은 항목이 있어 ${data.skipped.length}건은 건너뛰었습니다.`:''));await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 async function register(check:LedgerCheck){
  setSaving(true);setError('');setMessage('');setAlertNote('');
  try{
   const {response,data}=await postFacts<SaveResult>({action:'save_fact',data:{brandId:brand,...(check.storeId?{storeId:check.storeId}:{}),key:check.key,value:check.claim,status:'candidate',source:check.source,verifiedAt:'',validUntil:''}});
   if(!response.ok)throw new Error((response.status===409?'이미 같은 항목이 있습니다: ':'')+(data.error||'후보로 등록하지 못했습니다.'));
   setMessage(`${check.label} 후보를 원장에 등록했습니다.`);setAlertNote(savedNote(data));await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 // 이전 정보공개서 버전 근거의 가맹 사실을 현재 버전으로 옮긴다(대표·관리자). 값·창업비용 상세는 그대로다.
 async function rebase(event:FormEvent){
  event.preventDefault();if(!rebasing||!franchise?.currentVersionId)return;
  setSaving(true);setError('');setMessage('');setAlertNote('');
  try{
   const {response,data}=await postFacts<SaveResult>({action:'rebase_facts',brandId:brand,disclosureVersionId:franchise.currentVersionId,items:[{id:rebasing.id,version:rebasing.version,fiscalYear:Number(rebaseForm.fiscalYear),page:rebaseForm.page?Number(rebaseForm.page):null,...(rebaseForm.asOf?{asOf:rebaseForm.asOf}:{}),verifiedAt:isoInput(rebaseForm.verifiedAt),validUntil:isoInput(rebaseForm.validUntil)}]});
   if(!response.ok)throw new Error((response.status===409?'저장 충돌: ':'')+(data.error||'새 버전으로 옮기지 못했습니다.'));
   setRebasing(null);setMessage(data.rebased?'가맹 사실을 현재 정보공개서 버전으로 옮겼습니다.':'이미 현재 버전 근거입니다.');setAlertNote(savedNote(data));await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 const ready=overview?.readiness;
 return <section aria-label="브랜드 확인 사실"><div className="section-heading"><div><h3>브랜드 확인 사실</h3><p>조리 방식·가격·영업시간 등 근거를 확인한 내용을 관리합니다.</p></div><Button disabled={saving} onClick={()=>edit(null)}>사실 추가</Button></div>
  {!campaign&&!!overview?.stores.length&&<label className="field"><span>적용 범위 · 이 범위의 캠페인이 받는 사실</span><NativeSelect aria-label="사실 적용 범위" value={scopeStore} onChange={e=>{setScopeStore(e.target.value);setOpen(false);setSkipped([])}}><NativeSelectOption value="">브랜드 공통</NativeSelectOption>{overview.stores.map(s=><NativeSelectOption key={s.id} value={s.id}>{s.name} · 브랜드 공통 포함</NativeSelectOption>)}</NativeSelect></label>}
  {ready&&<div className="notice"><p>제작에 쓸 확정 사실 {ready.confirmed}건 · 확인 후보 {ready.candidates}건 · 가져올 수 있는 후보 {ready.importable}건{ready.confirmed===0&&ready.candidates+ready.importable>0?' · 확정 사실이 없습니다. 후보의 근거를 확인해 확정하세요.':''}</p><Button variant="outline" size="sm" disabled={saving||!ready.importable} onClick={()=>void importCandidates()}>후보 가져오기</Button> <small>조사 주장·지점 정보·브리프의 ‘확정 사실(사용자 직접 제공)’과 브리프 사실 후보를 확인 후보로만 등록합니다. 확정은 관리자가 합니다.</small></div>}
  {!!skipped.length&&<details><summary>건너뛴 항목 {skipped.length}건</summary><ul>{skipped.map((s,i)=><li key={i}>{scopeName(s.storeId)} · {s.label}: {s.value} · {s.reason}</li>)}</ul></details>}
  {!!overview?.checks.length&&<details open={!campaign}><summary>원장 점검 · 확인 필요 {overview.checks.length}건</summary><ul className="artifact-list">{overview.checks.map(c=><li key={c.id} className="brand-detail-card"><div className="brand-detail-body"><p><span className="source-state">{checkStates[c.state]}</span> {c.origin==='brand'?'브랜드 소개':`${c.storeName} 지점 정보`} · {c.label}: {c.value}</p>{c.origin==='brand'&&<p className="subtle-note">{c.claim}</p>}{c.state==='conflict'&&<p className="form-error">{c.origin==='store'?`지점 ${c.label} 값이`:`브랜드 소개의 ${c.label} 표현이`} 원장 확정값과 다릅니다. 원장: {c.ledgerValue}</p>}{c.state==='prohibited'&&<p className="form-error">원장에서 사용 거절한 표현입니다. 소개·지점 정보를 고치고 광고 문구에 쓰지 마세요.</p>}{c.state==='unverified'&&<Button variant="outline" size="sm" disabled={saving} onClick={()=>void register(c)}>원장에 후보로 등록</Button>}</div></li>)}</ul></details>}
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" disabled={saving} onClick={()=>void load()}>목록 새로고침</Button></div>}{message&&<p role="status">{message}</p>}{alertNote&&<p role="alert" className="form-error">{alertNote}</p>}
  {loading?<p role="status">사실을 불러오고 있습니다.</p>:facts.length?<ul className="artifact-list">{facts.map(f=><li key={f.id} className="brand-detail-card"><div className="brand-detail-body"><h4>{factLabel(f.key)}{factCatalogItem(f.key)?'':' · 기타'} · {statuses[f.status]}</h4><p style={{whiteSpace:'pre-wrap'}}>{f.value}</p>{franchise&&<FranchiseFactNote fact={f} block={franchise} canManage={canManage} disabled={saving} onRebase={()=>{setRebasing(f);setRebaseForm({fiscalYear:f.sourceRef?String(f.sourceRef.fiscalYear):'',page:f.sourceRef?.page?String(f.sourceRef.page):'',asOf:f.sourceRef?.asOf??'',verifiedAt:'',validUntil:''})}}/>}<p>{scopeName(f.storeId)} · v{f.version}{f.status==='confirmed'&&Date.parse(f.validUntil)<=checkedAt?' · 유효 기한 만료':''}</p><p>근거: {f.source||'미확인'}</p><p>확인: {f.verifiedAt?new Date(f.verifiedAt).toLocaleString('ko-KR'):'미확인'} · 유효 기한: {f.validUntil?new Date(f.validUntil).toLocaleString('ko-KR'):'미설정'}</p>{f.status!=='candidate'&&f.confirmedBy&&<p>{f.status==='confirmed'?'확정':'거절'}: {f.confirmedBy.email||f.confirmedBy.id}{f.confirmedAt?' · '+new Date(f.confirmedAt).toLocaleString('ko-KR'):''}</p>}{(canManage||f.status==='candidate')&&<Button variant="outline" disabled={saving} onClick={()=>edit(f)} aria-label={`${factLabel(f.key)} 사실 편집`}>{canManage?'편집·상태 변경':'후보 수정'}</Button>}</div></li>)}</ul>:<p className="notice">등록된 사실이 없습니다. 확인 후보부터 기록하고 근거 확인 후 확정하세요.</p>}
  {rebasing&&franchise&&<form className="form-stack" onSubmit={rebase} aria-label="가맹 사실 새 버전으로 옮기기"><fieldset disabled={saving} className="form-stack"><legend>{factLabel(rebasing.key)} · 현재 정보공개서 버전({versionLabel(franchise.currentVersionId||'')})으로 옮기기</legend>
   <p className="subtle-note">값과 창업비용 상세는 그대로입니다. 값이 달라졌으면 사실을 편집하세요. {franchise.disclaimer}</p>
   <div className="form-two"><label className="field"><span>기준 사업연도</span><Input required type="number" min={2000} max={2199} value={rebaseForm.fiscalYear} onChange={e=>setRebaseForm({...rebaseForm,fiscalYear:e.target.value})}/></label><label className="field"><span>쪽 (선택)</span><Input type="number" min={1} max={5000} value={rebaseForm.page} onChange={e=>setRebaseForm({...rebaseForm,page:e.target.value})}/></label></div>
   {franchiseItem(rebasing.key)?.asOf&&<label className="field"><span>기준일 · 정보공개서 등록일 이전</span><Input required type="date" value={rebaseForm.asOf} onChange={e=>setRebaseForm({...rebaseForm,asOf:e.target.value})}/></label>}
   <div className="form-two"><label className="field"><span>확인 시점</span><Input required type="datetime-local" value={rebaseForm.verifiedAt} onChange={e=>setRebaseForm({...rebaseForm,verifiedAt:e.target.value})}/></label><label className="field"><span>유효 기한 · 다음 변경등록 기한 이전</span><Input required type="datetime-local" value={rebaseForm.validUntil} onChange={e=>setRebaseForm({...rebaseForm,validUntil:e.target.value})}/></label></div>
   <div className="form-actions"><Button type="button" variant="outline" onClick={()=>setRebasing(null)}>취소</Button><Button type="submit">{saving?'옮기는 중…':'새 버전으로 옮기기'}</Button></div>
  </fieldset></form>}
  {open&&<form className="form-stack" onSubmit={save} aria-label="브랜드 사실 편집"><fieldset disabled={saving} className="form-stack"><legend>{editing?'사실 수정':'새 사실'} · {scopeName(targetStore)}</legend>
   <label className="field"><span>사실 항목</span><NativeSelect required value={otherKey?OTHER:(keyItem?.key??'')} onChange={e=>{const value=e.target.value;setOtherKey(value===OTHER);setForm({...form,key:value===OTHER?'':value});setScopeConfirmed(false)}}><NativeSelectOption value="" disabled>항목 선택</NativeSelectOption>{factCatalog.filter(i=>!i.franchise).map(i=><NativeSelectOption key={i.key} value={i.key}>{i.label}{i.storeScoped?' · 지점별 항목':''}</NativeSelectOption>)}{franchise&&<NativeSelectOptGroup label="가맹 · 정보공개서 항목">{factCatalog.filter(i=>i.franchise).map(i=><NativeSelectOption key={i.key} value={i.key}>{i.label}{i.adUse===false?' · 광고 사용 불가(H6)':''}</NativeSelectOption>)}</NativeSelectOptGroup>}<NativeSelectOption value={OTHER}>기타(자유 입력)</NativeSelectOption></NativeSelect></label>
   {otherKey&&<label className="field"><span>기타 항목 이름{keyItem?` · ‘${keyItem.label}’ 표준 항목으로 저장됩니다`:''}</span><Input required maxLength={120} value={form.key} onChange={e=>setForm({...form,key:e.target.value})} placeholder="포장 용기"/></label>}
   {needsScopeConfirm&&<label><input type="checkbox" required checked={scopeConfirmed} onChange={e=>setScopeConfirmed(e.target.checked)}/> {keyItem?.label}은(는) 지점마다 다른 항목입니다. 브랜드 공통으로 저장해 모든 지점의 제작물에 쓰는 것이 맞음을 확인합니다.{!campaign&&!!overview?.stores.length?' 지점 사실은 위 적용 범위에서 지점을 고른 뒤 추가하세요.':''}</label>}
   <label className="field"><span>확인할 내용</span><Textarea required rows={3} maxLength={5000} value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/></label>
   {franchise&&frItem&&<fieldset className="form-stack" aria-label="정보공개서 근거"><legend>가맹 항목 · {frItem.label}</legend>
    {!franchise.enabled&&<p role="note" className="form-error">가맹 모집 기능이 꺼져 있어 가맹 항목은 사용 거절만 할 수 있습니다.</p>}
    {frItem.adUse===false&&<p role="note">광고 사용 불가(H6) · 이 수치는 캡션·사실 카드에 쓸 수 없습니다.</p>}
    {frItem.disclosure&&<><label className="field"><span>정보공개서 버전 · 현재 등록 버전만 고를 수 있습니다</span><NativeSelect required={form.status==='confirmed'} value={source.versionId} onChange={e=>setSource({...source,versionId:e.target.value})}><NativeSelectOption value="">버전 선택</NativeSelectOption>{franchise.versions.map(v=><NativeSelectOption key={v.id} value={v.id} disabled={v.state!=='current'&&v.id!==editing?.sourceRef?.disclosureVersionId}>{v.label} · {VERSION_STATE_LABELS[v.state]}</NativeSelectOption>)}</NativeSelect></label>
     <div className="form-two"><label className="field"><span>기준 사업연도</span><Input required={!!source.versionId} type="number" min={2000} max={2199} value={source.fiscalYear} onChange={e=>setSource({...source,fiscalYear:e.target.value})}/></label><label className="field"><span>쪽 (선택)</span><Input type="number" min={1} max={5000} value={source.page} onChange={e=>setSource({...source,page:e.target.value})}/></label></div>
     {frItem.asOf&&<label className="field"><span>기준일 · 정보공개서 등록일 이전</span><Input required={form.status==='confirmed'} type="date" value={source.asOf} onChange={e=>setSource({...source,asOf:e.target.value})}/></label>}</>}
    {frItem.storeType&&<><label className="field"><span>매장 유형</span><Input required={form.status==='confirmed'} maxLength={30} value={source.storeType} onChange={e=>setSource({...source,storeType:e.target.value})} placeholder="테이크아웃형"/></label>
     <div className="form-two"><label className="field"><span>포함 항목 · 쉼표로 구분</span><Input required={!!source.storeType} value={source.includes} onChange={e=>setSource({...source,includes:e.target.value})} placeholder="가맹비, 교육비"/></label><label className="field"><span>불포함 항목 · 없으면 ‘없음’</span><Input required={!!source.storeType} value={source.excludes} onChange={e=>setSource({...source,excludes:e.target.value})} placeholder="임차보증금"/></label></div>
     {frItem.area&&<label className="field"><span>전용면적(㎡)</span><Input required={form.status==='confirmed'} type="number" min={0} step="0.1" value={source.areaM2} onChange={e=>setSource({...source,areaM2:e.target.value})}/></label>}</>}
    {frItem.disclosure&&<p className="subtle-note">확정하면 유효 기한은 다음 변경등록 기한(추정)과 버전 유효 기간 안이어야 합니다. 카드·캡션에는 ‘정보공개서 등록 버전·기준 사업연도·확인일’ 각주가 붙습니다. {franchise.disclaimer}</p>}
   </fieldset>}
   {canManage?<label className="field"><span>사실 상태</span><NativeSelect value={form.status} onChange={e=>{setForm({...form,status:e.target.value as BrandFact['status']});setConfirmed(false)}}>{Object.entries(statuses).map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label>:<p className="subtle-note">사실 상태: {statuses.candidate}. 확정·거절은 관리자만 할 수 있습니다. {adminRequestNote}</p>}
   <label className="field"><span>확인 근거 · 문서·담당자·URL</span><Textarea required={form.status==='confirmed'} rows={2} maxLength={3000} value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></label>
   <div className="form-two"><label className="field"><span>확인 시점 · 현재 기기 시간대</span><Input type="datetime-local" required={form.status==='confirmed'} value={form.verifiedAt} onChange={e=>setForm({...form,verifiedAt:e.target.value})}/></label><label className="field"><span>유효 기한 · 현재 기기 시간대</span><Input type="datetime-local" required={form.status==='confirmed'} value={form.validUntil} onChange={e=>setForm({...form,validUntil:e.target.value})}/></label></div>
   {form.status==='confirmed'&&<label><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 근거를 직접 확인했고 유효 기한까지 적용 가능한 사실임을 확인합니다.</label>}
   <p className="notice">후보·거절·기한이 지난 사실은 제작용 확인 사실에서 제외됩니다. 같은 항목의 지점 사실이 있으면 브랜드 공통 사실보다 우선합니다.</p>
   <div className="form-actions"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>취소</Button><Button type="submit">{saving?'저장 중…':'사실 저장'}</Button></div>
  </fieldset></form>}
 </section>;
}
// 가맹 사실 아래 근거·상세·각주 미리보기·상태(옮길 사실·광고 사용 불가). 가맹 블록이 있는 브랜드에서만 그린다.
function FranchiseFactNote({fact,block,canManage,disabled,onRebase}:{fact:BrandFact;block:FranchiseBlock;canManage:boolean;disabled:boolean;onRebase:()=>void}){
 const item=franchiseItem(fact.key);
 if(!item)return null;
 const version=block.versions.find(v=>v.id===fact.sourceRef?.disclosureVersionId),note=fact.sourceRef?footnoteLine(fact,block.versions):null,stale=block.staleFactIds.includes(fact.id);
 return <div className="subtle-note">
  {fact.sourceRef&&<p>근거: 정보공개서 {version?`${version.label} · ${VERSION_STATE_LABELS[version.state]}`:'버전 없음'} · 기준 사업연도 {fact.sourceRef.fiscalYear}년{fact.sourceRef.page?` · ${fact.sourceRef.page}쪽`:''}{fact.sourceRef.asOf?` · 기준일 ${fact.sourceRef.asOf}`:''}</p>}
  {fact.cost&&<p>매장 유형 {fact.cost.storeType} · {costDetailLine(fact.cost)}</p>}
  {note&&<p>각주 미리보기: {note}</p>}
  {item.adUse===false&&<p role="note">광고 사용 불가(H6)</p>}
  {stale&&<p role="note" className="form-error">이전 버전 · 새 버전으로 옮기세요{canManage&&block.enabled&&block.currentVersionId?<> <Button variant="outline" size="sm" disabled={disabled} onClick={onRebase}>새 버전으로 옮기기</Button></>:''}</p>}
  <p>{block.disclaimer}</p>
 </div>;
}
