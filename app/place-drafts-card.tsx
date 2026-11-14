'use client';
// 플레이스 리뷰 답글·소식 초안 카드(C5, docs/PLACE-DRAFTS.ko.md, 레인 X-G). 점포 마케팅 > 지점 > 채널 점검 탭에서 lazy로 그린다(app/store-marketing-panel.tsx).
// GET /api/place-drafts?storeId, POST create·approve·submit_help·mark_submitted·mark_verified·cancel·create_device_task·sync_device. 판정·스위치(place_drafts)·문안 고정은 서버가 한다.
// 네이버 스마트플레이스에는 공개 쓰기 API가 없다. 이 카드는 자동 제출하지 않고, 승인한 문안을 복사해 사람이 등록한 뒤 '제출했습니다'를 누르게 한다.
// 점포 브라우저 작업은 스위치·지점 연결·화면 매핑 확인이 모두 있을 때만 만들고, 점포 브라우저 화면에서 다시 승인해야 장치가 접수한다.
// 스위치가 꺼져 있고 초안이 없거나, 권한이 없어 목록을 읽지 못하면(직원 403) 아무것도 그리지 않는다(이전 화면과 같다).
import '@/lib/i18n/lazy-cards';
import {currentLocale,t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import {useCallback,useEffect,useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {MetaLine} from '@/components/app/meta-line';
import {EmptyLine} from '@/components/app/empty-line';
import {SafetyScope} from '@/components/app/safety-scope';
import {Segmented} from '@/components/app/segmented';
import {askConfirm} from '@/components/app/confirm-dialog';
import {dateTime} from '@/lib/format';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import type {Store} from '@/lib/store-marketing';
import type {PlaceDraft,PlaceDraftKind,PlaceDraftStatus,NewsTopic} from '@/lib/place-drafts';
import type {PlaceDraftMapping} from '@/lib/place-drafts-server';
import {useCan} from './account-context';

type Listing={enabled:boolean;storeBrowserEnabled:boolean;drafts:PlaceDraft[];mapping:PlaceDraftMapping|null;notice?:string};
type Help={text:string|null;adminUrl:string;observedManagerUrl:string|null;path:string;note:string};
type Load={state:'loading'}|{state:'ready';listing:Listing}|{state:'hidden'}|{state:'error';message:string};
// 이름 표는 그릴 때 사전에서 읽는다(모듈을 읽는 시점의 언어에 묶이지 않게).
const kindLabels=():Record<PlaceDraftKind,string>=>({review_reply:t('place.kind.review_reply'),news_post:t('place.kind.news_post')});
const statusLabels=():Record<PlaceDraftStatus,string>=>({draft:t('place.status.draft'),approved:t('place.status.approved'),submitted:t('place.status.submitted'),verified:t('place.status.verified'),cancelled:t('place.status.cancelled')});
const topicLabels=():Record<NewsTopic,string>=>({notice:t('place.topic.notice'),promotion:t('place.topic.promotion'),menu:t('place.topic.menu')});
const deviceType:Record<PlaceDraftKind,'reply_review'|'post_news'>={review_reply:'reply_review',news_post:'post_news'};
const blankForm={kind:'review_reply' as PlaceDraftKind,sourceText:'',rating:'',topic:'notice' as NewsTopic,title:'',body:''};

async function send<T>(input:Record<string,unknown>):Promise<T>{
 const r=await fetch('/api/place-drafts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const d=await r.json().catch(()=>({})) as T&{error?:string};
 if(!r.ok)throw new Error(d.error||t('place.requestFailed'));
 return d;
}
const canDevice=(l:Listing,d:PlaceDraft)=>l.storeBrowserEnabled&&l.mapping?.status==='active'&&l.mapping.taskTypes.includes(deviceType[d.kind]);
const deviceReason=(l:Listing,d:PlaceDraft)=>!l.storeBrowserEnabled?t('place.deviceSwitchOff'):l.mapping?.status!=='active'?t('place.deviceMapping'):!l.mapping.taskTypes.includes(deviceType[d.kind])?t('place.deviceNoMapping',{v:kindLabels()[d.kind]}):undefined;

function SubmitHelp({help,onCopy}:{help:Help;onCopy:(text:string)=>void}){
 useT();return <div className="form-stack" role="group" aria-label={t('place.help')}>
  {help.text&&<><b>{t('place.approvedText')}</b><Textarea readOnly rows={4} aria-label={t('place.approvedText')} value={help.text} onFocus={e=>e.currentTarget.select()}/><div className="form-actions"><Button type="button" size="sm" variant="outline" onClick={()=>onCopy(help.text!)}>{t('place.copyText')}</Button></div></>}
  <p><MetaLine items={[<a key="admin" href={help.adminUrl} target="_blank" rel="noreferrer noopener">{t('place.openManager')}</a>,help.observedManagerUrl&&<a key="observed" href={help.observedManagerUrl} target="_blank" rel="noreferrer noopener">{t('place.linkedManager')}</a>,help.path]}/></p>
  <p className="subtle-note">{help.note}</p>
 </div>;
}

function DraftItem({d,listing,busy,canAct,help,onAct,onCopy}:{d:PlaceDraft;listing:Listing;busy:boolean;canAct:boolean;help?:Help;onAct:(d:PlaceDraft,action:string)=>void;onCopy:(text:string)=>void}){
 useT();const reason=canAct?undefined:t('place.denied'),on=listing.enabled,offReason=!on?t('place.switchOff'):undefined;
 const blocks=d.compliance.issues.filter(i=>i.severity==='block'),warns=d.compliance.issues.filter(i=>i.severity!=='block');
 return <li className="form-stack" data-place-draft={d.id} data-status={d.status}>
  <header className="channel-card-head"><b>{kindLabels()[d.kind]}{d.news?.title?`: ${d.news.title}`:''}</b><span className="proposal-badges"><Badge variant="secondary">{statusLabels()[d.status]}</Badge>{d.submission&&<Badge variant="outline">{d.submission.channel==='device'?t('place.submitDevice'):t('place.submitted')}</Badge>}</span></header>
  <p className="subtle-note"><MetaLine items={[t('place.createdAt')+dateTime(d.createdAt),d.approvedAt&&t('place.approvedAt')+dateTime(d.approvedAt),d.submission&&t('place.submittedAt')+dateTime(d.submission.at),d.verification&&t('place.verifiedAt')+dateTime(d.verification.at)]}/></p>
  <p className="whitespace-pre-wrap">{d.draft.text}</p>
  {blocks.length>0&&<ul className="text-sm list-disc pl-5" aria-label={t('place.blocking')}>{blocks.map(i=><li key={i.ruleId+i.excerpt}>{i.title}{i.excerpt?`: ${i.excerpt}`:''}</li>)}</ul>}
  {warns.length>0&&<ul className="text-sm list-disc pl-5" aria-label={t('place.warnings')}>{warns.map(i=><li key={i.ruleId+i.excerpt}>{i.title}</li>)}</ul>}
  {help&&<SubmitHelp help={help} onCopy={onCopy}/>}
  {d.deviceTask&&<p className="subtle-note"><MetaLine items={[t('place.deviceTask'),d.deviceTask.jobStatus||t('place.deviceCreated'),t('place.deviceReapprove')]}/></p>}
  <div className="form-actions">
   {d.status==='draft'&&<Button size="sm" disabled={busy||!canAct||!on||d.compliance.blocking} disabledReason={reason??offReason??(d.compliance.blocking?t('place.blockingFirst'):undefined)} onClick={()=>onAct(d,'approve')}>{t('place.approve')}</Button>}
   {d.status==='approved'&&!help&&<Button size="sm" variant="outline" disabled={busy||!canAct} disabledReason={reason} onClick={()=>onAct(d,'submit_help')}>{t('place.openHelp')}</Button>}
   {d.status==='approved'&&<Button size="sm" disabled={busy||!canAct||!on} disabledReason={reason??offReason} onClick={()=>onAct(d,'mark_submitted')}>{t('place.submitted')}</Button>}
   {d.status==='approved'&&!d.deviceTask&&<Button size="sm" variant="outline" disabled={busy||!canAct||!on||!canDevice(listing,d)} disabledReason={reason??offReason??deviceReason(listing,d)} onClick={()=>onAct(d,'create_device_task')}>{t('place.createDeviceTask')}</Button>}
   {d.deviceTask&&(d.status==='approved'||d.status==='submitted')&&<Button size="sm" variant="outline" disabled={busy||!canAct} disabledReason={reason} onClick={()=>onAct(d,'sync_device')}>{t('place.checkDevice')}</Button>}
   {d.status==='submitted'&&<Button size="sm" variant="outline" disabled={busy||!canAct||!on} disabledReason={reason??offReason} onClick={()=>onAct(d,'mark_verified')}>{t('place.recordVerified')}</Button>}
   {(d.status==='draft'||d.status==='approved')&&<Button size="sm" variant="ghost" disabled={busy||!canAct} disabledReason={reason} onClick={()=>onAct(d,'cancel')}>{t('place.cancel')}</Button>}
  </div>
 </li>;
}

export function PlaceDraftsCard({store}:{store:Store}){
 useT();const [load,setLoad]=useState<Load>({state:'loading'}),[busy,setBusy]=useState(false),[form,setForm]=useState(blankForm),[helps,setHelps]=useState<Record<string,Help>>({});
 const canAct=useCan('publish',{brandId:store.brandId,storeId:store.id});
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  const r=await fetch('/api/place-drafts?storeId='+encodeURIComponent(store.id),{cache:'no-store',credentials:'same-origin',signal});
  const d=await r.json().catch(()=>({})) as Listing&{error?:string};
  if(signal?.aborted)return;
  if(r.status===401||r.status===403){setLoad({state:'hidden'});return}
  if(!r.ok||!Array.isArray(d.drafts)){setLoad({state:'error',message:d.error||t('place.loadFailed')});return}
  setLoad(!d.enabled&&!d.drafts.length?{state:'hidden'}:{state:'ready',listing:d});
 },[store.id]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>refresh(c.signal)).catch(e=>{if(!c.signal.aborted)setLoad({state:'error',message:(e as Error).message})});return()=>c.abort()},[refresh]);
 async function run(task:()=>Promise<unknown>,saved:`${string}습니다.`){
  setBusy(true);
  try{await task();notifySaved(saved);await refresh()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
 }
 async function copy(text:string){try{await navigator.clipboard.writeText(text);notifySaved(t('place.copied') as Saved)}catch{toast.error(t('place.copyFailed'))}}
 async function act(d:PlaceDraft,action:string){
  if(action==='approve'){
   const ok=await askConfirm({title:t('place.approveTitle',{v:kindLabels()[d.kind]}),fields:{what:`${kindLabels()[d.kind]}: ${d.draft.text.slice(0,80)}`,where:t('place.approveWhere',{name:store.name}),when:t('place.approveWhen'),reversible:t('place.approveReversible')},impact:t('place.approveImpact'),undo:t('place.approveUndo'),confirmLabel:t('place.approve')});
   if(!ok)return;
   await run(async()=>{const r=await send<{submitHelp?:Help}>({action:'approve',id:d.id});if(r.submitHelp)setHelps(h=>({...h,[d.id]:r.submitHelp!}))},t('place.approved') as Saved);return;
  }
  if(action==='submit_help'){setBusy(true);try{const r=await send<{submitHelp:Help}>({action:'submit_help',id:d.id});setHelps(h=>({...h,[d.id]:r.submitHelp}))}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}return}
  if(action==='create_device_task'){
   const ok=await askConfirm({title:t('place.deviceTitle'),fields:{what:t('place.deviceWhat',{v:kindLabels()[d.kind]}),where:t('place.deviceWhere',{name:store.name}),when:t('place.deviceWhen'),reversible:t('place.deviceReversible')},impact:t('place.deviceImpact'),undo:t('place.deviceUndo'),confirmLabel:t('place.deviceConfirm')});
   if(!ok)return;
  }
  const saved:Record<string,Saved>={mark_submitted:t('place.markedSubmitted') as Saved,mark_verified:t('place.markedVerified') as Saved,cancel:t('place.cancelled') as Saved,create_device_task:t('place.deviceCreatedDone') as Saved,sync_device:t('place.deviceChecked') as Saved};
  await run(()=>send({action,id:d.id}),saved[action]??t('place.done'));
 }
 function create(){
  const input=form.kind==='review_reply'?{action:'create',kind:form.kind,storeId:store.id,sourceText:form.sourceText.trim(),...(form.rating?{rating:Number(form.rating)}:{})}:{action:'create',kind:form.kind,storeId:store.id,news:{topic:form.topic,title:form.title.trim(),...(form.body.trim()?{body:form.body.trim()}:{})}};
  void run(async()=>{await send(input);setForm(f=>({...blankForm,kind:f.kind}))},t('place.draftCreated') as Saved);
 }
 if(load.state==='hidden'||load.state==='loading')return null;
 if(load.state==='error')return <p className="form-error" role="alert">{load.message}</p>;
 const {listing}=load,on=listing.enabled,missing=form.kind==='review_reply'?(!form.sourceText.trim()?t('place.sourceFirst'):undefined):(!form.title.trim()?t('place.titleFirst'):undefined);
 const createReason=!canAct?t('place.denied'):!on?t('place.switchOff'):missing;
 return <section className="metric-card place-drafts" aria-label={t('place.title')}>
  <div className="section-heading"><h3>{t('place.title')}</h3><span className="mode-pill">{t('place.badge')}</span></div>
  <SafetyScope>{currentLocale()==='ko'?listing.notice||t('place.lead'):t('place.notice')}</SafetyScope>
  <form className="form-stack" noValidate aria-label={t('place.new')} onSubmit={e=>{e.preventDefault();if(!createReason)create()}}>
   <Segmented label={t('place.kindField')} value={form.kind} disabled={busy} onChange={kind=>setForm(f=>({...f,kind}))} options={[{value:'review_reply',label:t('place.kind.review_reply')},{value:'news_post',label:t('place.kind.news_post')}]}/>
   {form.kind==='review_reply'?<div className="form-two">
    <label className="store-field"><span>{t('place.source')}</span><Textarea rows={3} maxLength={2000} value={form.sourceText} onChange={e=>setForm(f=>({...f,sourceText:e.target.value}))} placeholder={t('place.sourceHelp')}/></label>
    <label className="store-field"><span>{t('place.rating')}</span><NativeSelect value={form.rating} onChange={e=>setForm(f=>({...f,rating:e.target.value}))}><NativeSelectOption value="">{t('place.unknown')}</NativeSelectOption>{[5,4,3,2,1].map(n=><NativeSelectOption key={n} value={String(n)}>{t('place.stars',{n})}</NativeSelectOption>)}</NativeSelect></label>
   </div>:<div className="form-two">
    <label className="store-field"><span>{t('place.topicField')}</span><NativeSelect value={form.topic} onChange={e=>setForm(f=>({...f,topic:e.target.value as NewsTopic}))}>{(Object.keys(topicLabels()) as NewsTopic[]).map(k=><NativeSelectOption key={k} value={k}>{topicLabels()[k]}</NativeSelectOption>)}</NativeSelect></label>
    <label className="store-field"><span>{t('place.newsTitle')}</span><Input maxLength={60} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/></label>
    <label className="store-field"><span>{t('place.body')}</span><Textarea rows={3} maxLength={1000} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))}/></label>
   </div>}
   <small className="subtle-note">{t('place.privacy')}</small>
   <div className="form-actions"><Button type="submit" size="sm" variant="outline" disabled={busy||!!createReason} disabledReason={createReason}>{t('place.create')}</Button></div>
  </form>
  {listing.drafts.length?<ul className="proposal-list" aria-label={t('place.list')}>{listing.drafts.map(d=><DraftItem key={d.id} d={d} listing={listing} busy={busy} canAct={canAct} help={helps[d.id]} onAct={(x,a)=>void act(x,a)} onCopy={t=>void copy(t)}/>)}</ul>:<EmptyLine next={t('place.emptyNext')}>{t('place.empty')}</EmptyLine>}
 </section>;
}
