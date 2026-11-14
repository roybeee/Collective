'use client';
import '@/lib/i18n/lazy-cards';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import {StatList} from '@/components/app/stat-list';
import {MetaLine} from '@/components/app/meta-line';
import {metaText} from '@/lib/format';
import {CheckInput} from '@/components/app/check';
import {askConfirm} from '@/components/app/confirm-dialog';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import type {Campaign} from '@/lib/agency';
import type {BrandFact} from '@/lib/brand-facts';
import type {FactDecision} from '@/lib/brand-facts-server';
import type {FactImportSkip,LedgerCheck} from '@/lib/fact-import';
import {factCatalog,factCatalogItem,factLabel,franchiseItem} from '@/lib/fact-catalog';
import {costDetailLine,footnoteLine,VERSION_STATE_LABELS,type VersionState} from '@/lib/franchise-facts';
import {adminRequestNote,useCanManage} from './auth-client';
import {FactPackDownload} from './customer-report-panel';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOptGroup,NativeSelectOption} from '@/components/ui/native-select';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';

// 문구 표는 그릴 때 사전에서 읽는다(모듈을 읽는 시점의 언어에 묶이지 않게).
const statuses=()=>({candidate:t('facts.status.candidate'),confirmed:t('facts.status.confirmed'),rejected:t('facts.status.rejected')});
const checkStates=():Record<LedgerCheck['state'],string>=>({unverified:t('facts.check.unverified'),candidate:t('facts.check.candidate'),conflict:t('facts.check.conflict'),prohibited:t('facts.check.prohibited')});
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
 const review=data.reviewPublications===null?t('facts.publicationsFailed'):data.reviewPublications?t('facts.publicationsReview',{reviewPublications:data.reviewPublications}):'';
 return [...(data.warnings||[]),review].filter(Boolean).join(' ');
}

// campaign이 있으면 그 캠페인의 브랜드·지점 범위, 없으면 brandId의 브랜드 단위로 사실 원장을 관리한다(브랜드 아카이브 '확인 사실' 탭).
export function BrandFactsPanel({campaign,brandId,onChanged}:{campaign?:Campaign;brandId?:string;onChanged?:()=>void}){
 useT();const brand=campaign?.brandId??brandId??'';
 const [scopeStore,setScopeStore]=useState(''),storeId=campaign?campaign.storeId:scopeStore||undefined;
 const [facts,setFacts]=useState<(BrandFact&FactDecision)[]>([]),[overview,setOverview]=useState<Overview|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[alertNote,setAlertNote]=useState(''),[skipped,setSkipped]=useState<FactImportSkip[]>([]);
 const [checkedAt,setCheckedAt]=useState(()=>Date.now());
 const [franchise,setFranchise]=useState<FranchiseBlock|null>(null),[source,setSource]=useState<SourceForm>(emptySource),[rebasing,setRebasing]=useState<BrandFact|null>(null),[rebaseForm,setRebaseForm]=useState({fiscalYear:'',page:'',asOf:'',verifiedAt:'',validUntil:''});
 const [editing,setEditing]=useState<BrandFact|null>(null),[form,setForm]=useState<FactForm>(emptyForm),[open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),[otherKey,setOtherKey]=useState(false),[scopeConfirmed,setScopeConfirmed]=useState(false);
 // 직원은 확인 후보만 제안·수정·가져오기한다. 확정·거절과 확정·거절된 사실 수정은 관리자 전용이다(서버 403).
 const canManage=useCanManage();
 const scopeName=(id?:string)=>id?(overview?.stores.find(s=>s.id===id)?.name||t('facts.thisStore')):t('facts.brandWide');
 const load=useCallback(async(signal?:AbortSignal)=>{
  setLoading(true);setError('');
  try{
   const params=new URLSearchParams({brandId:brand});if(storeId)params.set('storeId',storeId);
   const response=await fetch('/api/brand-facts?'+params,{signal});const data=await response.json() as {facts:(BrandFact&FactDecision)[];error?:string;franchise?:FranchiseBlock}&Partial<Overview>;
   if(!response.ok)throw new Error(data.error||t('facts.loadFailed'));
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
   if(!response.ok)throw new Error((response.status===409?t('facts.conflict'):'')+(data.error||t('facts.saveFailed')));
   setOpen(false);setEditing(null);setMessage(t('facts.saved'));setAlertNote(savedNote(data));await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 async function importCandidates(){
  if(!overview||!(await askConfirm({title:t('facts.importTitle',{importable:overview.readiness.importable}),body:t('facts.importWhat',{v:scopeName(storeId)}),impact:t('facts.importImpact'),undo:t('facts.importUndo'),confirmLabel:t('facts.importConfirm')})))return;
  setSaving(true);setError('');setMessage('');setAlertNote('');
  try{
   const {response,data}=await postFacts<{imported:number;skipped:FactImportSkip[]}>({action:'import_candidates',brandId:brand,...(storeId?{storeId}:{})});
   if(!response.ok)throw new Error(data.error||t('facts.importFailed'));
   setSkipped(data.skipped);setMessage(t('facts.imported',{imported:data.imported})+(data.skipped.length?t('facts.importSkipped',{length:data.skipped.length}):''));await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 async function register(check:LedgerCheck){
  setSaving(true);setError('');setMessage('');setAlertNote('');
  try{
   const {response,data}=await postFacts<SaveResult>({action:'save_fact',data:{brandId:brand,...(check.storeId?{storeId:check.storeId}:{}),key:check.key,value:check.claim,status:'candidate',source:check.source,verifiedAt:'',validUntil:''}});
   if(!response.ok)throw new Error((response.status===409?t('facts.exists'):'')+(data.error||t('facts.candidateFailed')));
   setMessage(t('facts.candidateSaved',{label:check.label}));setAlertNote(savedNote(data));await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 // 이전 정보공개서 버전 근거의 가맹 사실을 현재 버전으로 옮긴다(대표·관리자). 값·창업비용 상세는 그대로다.
 async function rebase(event:FormEvent){
  event.preventDefault();if(!rebasing||!franchise?.currentVersionId)return;
  setSaving(true);setError('');setMessage('');setAlertNote('');
  try{
   const {response,data}=await postFacts<SaveResult>({action:'rebase_facts',brandId:brand,disclosureVersionId:franchise.currentVersionId,items:[{id:rebasing.id,version:rebasing.version,fiscalYear:Number(rebaseForm.fiscalYear),page:rebaseForm.page?Number(rebaseForm.page):null,...(rebaseForm.asOf?{asOf:rebaseForm.asOf}:{}),verifiedAt:isoInput(rebaseForm.verifiedAt),validUntil:isoInput(rebaseForm.validUntil)}]});
   if(!response.ok)throw new Error((response.status===409?t('facts.conflict'):'')+(data.error||t('facts.rebaseFailed')));
   setRebasing(null);setMessage(data.rebased?t('facts.rebased'):t('facts.alreadyCurrent'));setAlertNote(savedNote(data));await load();onChanged?.();
  }catch(error){setError((error as Error).message)}finally{setSaving(false)}
 }
 const ready=overview?.readiness;
 return <section aria-label={t('facts.title')}><div className="section-heading"><div><h3>{t('facts.title')}</h3><p>{t('facts.lead')}</p></div><Button disabled={saving} onClick={()=>edit(null)}>{t('facts.new')}</Button></div>
  {!campaign&&<FactPackDownload brandId={brand} storeId={storeId}/>}
  {!campaign&&!!overview?.stores.length&&<label className="field"><span>{t('facts.scope')}</span><NativeSelect aria-label={t('facts.scopeLabel')} value={scopeStore} onChange={e=>{setScopeStore(e.target.value);setOpen(false);setSkipped([])}}><NativeSelectOption value="">{t('facts.brandWide')}</NativeSelectOption>{overview.stores.map(s=><NativeSelectOption key={s.id} value={s.id}>{s.name} {t('facts.includesBrand')}</NativeSelectOption>)}</NativeSelect></label>}
  {ready&&<div className="notice"><StatList label={t('facts.readiness')} items={[[t('facts.confirmedForProduction'),t('facts.confirmedCount',{confirmed:ready.confirmed})],[t('facts.candidates'),t('facts.candidatesCount',{candidates:ready.candidates})],[t('facts.importable'),t('facts.importableCount',{importable:ready.importable})]]}/>{ready.confirmed===0&&ready.candidates+ready.importable>0&&<p>{t('facts.reviewCandidates')}</p>}<Button variant="outline" size="sm" disabled={saving||!ready.importable} disabledReason={!ready.importable?t('facts.noImportable'):undefined} onClick={()=>void importCandidates()}>{t('facts.import')}</Button> <small>{t('facts.importNote')}</small></div>}
  {!!skipped.length&&<details className="fold"><summary>{t('facts.skipped')} {skipped.length}{t('facts.countUnit')}</summary><ul>{skipped.map((s,i)=><li key={i}><MetaLine items={[scopeName(s.storeId),`${s.label}: ${s.value}`,s.reason]}/></li>)}</ul></details>}
  {!!overview?.checks.length&&<details className="fold" open={!campaign}><summary>{t('facts.checkNeeded')} {overview.checks.length}{t('facts.countUnit')}</summary><ul className="artifact-list">{overview.checks.map(c=><li key={c.id} className="brand-detail-card"><div className="brand-detail-body"><p><span className="source-state">{checkStates()[c.state]}</span> <MetaLine items={[c.origin==='brand'?t('facts.brandIntro'):t('facts.storeInfo',{storeName:c.storeName??''}),`${c.label}: ${c.value}`]}/></p>{c.origin==='brand'&&<p className="subtle-note">{c.claim}</p>}{c.state==='conflict'&&<p className="form-error">{c.origin==='store'?t('facts.storeValue',{label:c.label}):t('facts.introValue',{label:c.label})} {t('facts.differs')} {c.ledgerValue}</p>}{c.state==='prohibited'&&<p className="form-error">{t('facts.prohibited')}</p>}{c.state==='unverified'&&<Button variant="outline" size="sm" disabled={saving} onClick={()=>void register(c)}>{t('facts.saveCandidate')}</Button>}</div></li>)}</ul></details>}
  {error&&<div role="alert" className="load-error"><span>{error}</span><Button variant="outline" disabled={saving} onClick={()=>void load()}>{t('facts.refresh')}</Button></div>}{message&&<p role="status">{message}</p>}{alertNote&&<p role="alert" className="form-error">{alertNote}</p>}
  {loading?<ScreenSkeleton label={t('facts.loading')} rows={2}/>:facts.length?<ul className="artifact-list">{facts.map(f=><li key={f.id} className="brand-detail-card"><div className="brand-detail-body"><h4><MetaLine items={[factLabel(f.key)+(factCatalogItem(f.key)?'':t('facts.other')),statuses()[f.status]]}/></h4><p className="whitespace-pre-wrap">{f.value}</p>{franchise&&<FranchiseFactNote fact={f} block={franchise} canManage={canManage} disabled={saving} onRebase={()=>{setRebasing(f);setRebaseForm({fiscalYear:f.sourceRef?String(f.sourceRef.fiscalYear):'',page:f.sourceRef?.page?String(f.sourceRef.page):'',asOf:f.sourceRef?.asOf??'',verifiedAt:'',validUntil:''})}}/>}<p><MetaLine items={[scopeName(f.storeId),`v${f.version}`,f.status==='confirmed'&&Date.parse(f.validUntil)<=checkedAt&&t('facts.expired')]}/></p><p>{t('facts.source')} {f.source||t('facts.unverified')}</p><p><MetaLine items={[t('facts.checkedOn',{v:f.verifiedAt?new Date(f.verifiedAt).toLocaleString('ko-KR'):t('facts.unverified')}),t('facts.validUntil',{v:f.validUntil?new Date(f.validUntil).toLocaleString('ko-KR'):t('facts.unset')})]}/></p>{f.status!=='candidate'&&f.confirmedBy&&<p><MetaLine items={[`${f.status==='confirmed'?t('facts.confirm'):t('facts.reject')}: ${f.confirmedBy.email||f.confirmedBy.id}`,f.confirmedAt&&new Date(f.confirmedAt).toLocaleString('ko-KR')]}/></p>}{(canManage||f.status==='candidate')&&<Button variant="outline" disabled={saving} onClick={()=>edit(f)} aria-label={t('facts.editLabel',{v:factLabel(f.key)})}>{canManage?t('facts.edit'):t('facts.editCandidate')}</Button>}</div></li>)}</ul>:<p className="notice">{t('facts.empty')}</p>}
  {rebasing&&franchise&&<form className="form-stack" onSubmit={rebase} aria-label={t('facts.rebaseTitle')}><fieldset disabled={saving} className="form-stack"><legend>{factLabel(rebasing.key)}{t('facts.rebaseLead')}{versionLabel(franchise.currentVersionId||'')}{t('facts.rebaseTail')}</legend>
   <p className="subtle-note">{t('facts.rebaseNote')} {franchise.disclaimer}</p>
   <div className="form-two"><label className="field"><span>{t('facts.fiscalYear')}</span><Input required type="number" min={2000} max={2199} value={rebaseForm.fiscalYear} onChange={e=>setRebaseForm({...rebaseForm,fiscalYear:e.target.value})}/></label><label className="field"><span>{t('facts.pageOptional')}</span><Input type="number" min={1} max={5000} value={rebaseForm.page} onChange={e=>setRebaseForm({...rebaseForm,page:e.target.value})}/></label></div>
   {franchiseItem(rebasing.key)?.asOf&&<label className="field"><span>{t('facts.asOf')}</span><Input required type="date" value={rebaseForm.asOf} onChange={e=>setRebaseForm({...rebaseForm,asOf:e.target.value})}/></label>}
   <div className="form-two"><label className="field"><span>{t('facts.verifiedAt')}</span><Input required type="datetime-local" value={rebaseForm.verifiedAt} onChange={e=>setRebaseForm({...rebaseForm,verifiedAt:e.target.value})}/></label><label className="field"><span>{t('facts.validUntilField')}</span><Input required type="datetime-local" value={rebaseForm.validUntil} onChange={e=>setRebaseForm({...rebaseForm,validUntil:e.target.value})}/></label></div>
   <div className="form-actions"><Button type="button" variant="outline" onClick={()=>setRebasing(null)}>{t('facts.cancel')}</Button><Button type="submit">{saving?t('facts.rebasing'):t('facts.rebase')}</Button></div>
  </fieldset></form>}
  {open&&<form className="form-stack" onSubmit={save} aria-label={t('facts.form')}><fieldset disabled={saving} className="form-stack"><legend>{editing?t('facts.editTitle'):t('facts.new')}({scopeName(targetStore)})</legend>
   <label className="field"><span>{t('facts.key')}</span><NativeSelect required value={otherKey?OTHER:(keyItem?.key??'')} onChange={e=>{const value=e.target.value;setOtherKey(value===OTHER);setForm({...form,key:value===OTHER?'':value});setScopeConfirmed(false)}}><NativeSelectOption value="" disabled>{t('facts.pickKey')}</NativeSelectOption>{factCatalog.filter(i=>!i.franchise).map(i=><NativeSelectOption key={i.key} value={i.key}>{metaText([i.label,i.storeScoped&&t('facts.storeKeys')])}</NativeSelectOption>)}{franchise&&<NativeSelectOptGroup label={t('facts.franchiseKeys')}>{factCatalog.filter(i=>i.franchise).map(i=><NativeSelectOption key={i.key} value={i.key}>{metaText([i.label,i.adUse===false&&t('facts.adBlocked')])}</NativeSelectOption>)}</NativeSelectOptGroup>}<NativeSelectOption value={OTHER}>{t('facts.otherKey')}</NativeSelectOption></NativeSelect></label>
   {otherKey&&<label className="field"><span>{t('facts.otherName')}{keyItem?t('facts.savedAsStandard',{label:keyItem.label}):''}</span><Input required maxLength={120} value={form.key} onChange={e=>setForm({...form,key:e.target.value})} placeholder={t('facts.otherPlaceholder')}/></label>}
   {needsScopeConfirm&&<label><CheckInput required checked={scopeConfirmed} onChange={e=>setScopeConfirmed(e.target.checked)}/> {keyItem?.label}{t('facts.storeSpecific')}{!campaign&&!!overview?.stores.length?t('facts.storeHint'):''}</label>}
   <label className="field"><span>{t('facts.value')}</span><Textarea required rows={3} maxLength={5000} value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/></label>
   {franchise&&frItem&&<fieldset className="form-stack" aria-label={t('facts.disclosureSource')}><legend>{t('facts.franchiseItem')} {frItem.label}</legend>
    {!franchise.enabled&&<p role="note" className="form-error">{t('facts.franchiseOff')}</p>}
    {frItem.adUse===false&&<p role="note">{t('facts.adBlockedNote')}</p>}
    {frItem.disclosure&&<><label className="field"><span>{t('facts.version')}</span><NativeSelect required={form.status==='confirmed'} value={source.versionId} onChange={e=>setSource({...source,versionId:e.target.value})}><NativeSelectOption value="">{t('facts.pickVersion')}</NativeSelectOption>{franchise.versions.map(v=><NativeSelectOption key={v.id} value={v.id} disabled={v.state!=='current'&&v.id!==editing?.sourceRef?.disclosureVersionId}>{metaText([v.label,VERSION_STATE_LABELS[v.state]])}</NativeSelectOption>)}</NativeSelect></label>
     <div className="form-two"><label className="field"><span>{t('facts.fiscalYear')}</span><Input required={!!source.versionId} type="number" min={2000} max={2199} value={source.fiscalYear} onChange={e=>setSource({...source,fiscalYear:e.target.value})}/></label><label className="field"><span>{t('facts.pageOptional')}</span><Input type="number" min={1} max={5000} value={source.page} onChange={e=>setSource({...source,page:e.target.value})}/></label></div>
     {frItem.asOf&&<label className="field"><span>{t('facts.asOf')}</span><Input required={form.status==='confirmed'} type="date" value={source.asOf} onChange={e=>setSource({...source,asOf:e.target.value})}/></label>}</>}
    {frItem.storeType&&<><label className="field"><span>{t('facts.storeType')}</span><Input required={form.status==='confirmed'} maxLength={30} value={source.storeType} onChange={e=>setSource({...source,storeType:e.target.value})} placeholder={t('facts.storeTypePlaceholder')}/></label>
     <div className="form-two"><label className="field"><span>{t('facts.includes')}</span><Input required={!!source.storeType} value={source.includes} onChange={e=>setSource({...source,includes:e.target.value})} placeholder={t('facts.includesPlaceholder')}/></label><label className="field"><span>{t('facts.excludes')}</span><Input required={!!source.storeType} value={source.excludes} onChange={e=>setSource({...source,excludes:e.target.value})} placeholder={t('facts.excludesPlaceholder')}/></label></div>
     {frItem.area&&<label className="field"><span>{t('facts.area')}</span><Input required={form.status==='confirmed'} type="number" min={0} step="0.1" value={source.areaM2} onChange={e=>setSource({...source,areaM2:e.target.value})}/></label>}</>}
    {frItem.disclosure&&<p className="subtle-note">{t('facts.franchiseRule')} {franchise.disclaimer}</p>}
   </fieldset>}
   {canManage?<label className="field"><span>{t('facts.statusField')}</span><NativeSelect value={form.status} onChange={e=>{setForm({...form,status:e.target.value as BrandFact['status']});setConfirmed(false)}}>{Object.entries(statuses()).map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label>:<p className="subtle-note">{t('facts.statusLabel')} {statuses().candidate}{t('facts.statusAdminOnly')} {adminRequestNote}</p>}
   <label className="field"><span>{t('facts.sourceField')}</span><Textarea required={form.status==='confirmed'} rows={2} maxLength={3000} value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></label>
   <div className="form-two"><label className="field"><span>{t('facts.verifiedAtLocal')}</span><Input type="datetime-local" required={form.status==='confirmed'} value={form.verifiedAt} onChange={e=>setForm({...form,verifiedAt:e.target.value})}/></label><label className="field"><span>{t('facts.validUntilLocal')}</span><Input type="datetime-local" required={form.status==='confirmed'} value={form.validUntil} onChange={e=>setForm({...form,validUntil:e.target.value})}/></label></div>
   {form.status==='confirmed'&&<label><CheckInput required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> {t('facts.attest')}</label>}
   <p className="notice">{t('facts.exclusionNote')}</p>
   <div className="form-actions"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>{t('facts.cancel')}</Button><Button type="submit">{saving?t('facts.saving'):t('facts.save')}</Button></div>
  </fieldset></form>}
 </section>;
}
// 가맹 사실 아래 근거·상세·각주 미리보기·상태(옮길 사실·광고 사용 불가). 가맹 블록이 있는 브랜드에서만 그린다.
function FranchiseFactNote({fact,block,canManage,disabled,onRebase}:{fact:BrandFact;block:FranchiseBlock;canManage:boolean;disabled:boolean;onRebase:()=>void}){
 useT();const item=franchiseItem(fact.key);
 if(!item)return null;
 const version=block.versions.find(v=>v.id===fact.sourceRef?.disclosureVersionId),note=fact.sourceRef?footnoteLine(fact,block.versions):null,stale=block.staleFactIds.includes(fact.id);
 return <div className="subtle-note">
  {fact.sourceRef&&<p>{t('facts.source')} <MetaLine items={[t('facts.disclosureVersion',{v:version?`${version.label}(${VERSION_STATE_LABELS[version.state]})`:t('facts.noVersion')}),t('facts.fiscalYearValue',{fiscalYear:fact.sourceRef.fiscalYear}),fact.sourceRef.page&&t('facts.pageValue',{page:fact.sourceRef.page}),fact.sourceRef.asOf&&t('facts.asOfValue',{asOf:fact.sourceRef.asOf})]}/></p>}
  {fact.cost&&<p><MetaLine items={[t('facts.storeTypeValue',{storeType:fact.cost.storeType}),costDetailLine(fact.cost)]}/></p>}
  {note&&<p>{t('facts.footnote')} {note}</p>}
  {item.adUse===false&&<p role="note">{t('facts.adBlocked')}</p>}
  {stale&&<p role="note" className="form-error">{t('facts.oldVersion')}{canManage&&block.enabled&&block.currentVersionId?<> <Button variant="outline" size="sm" disabled={disabled} onClick={onRebase}>{t('facts.rebase')}</Button></>:''}</p>}
  <p>{block.disclaimer}</p>
 </div>;
}
