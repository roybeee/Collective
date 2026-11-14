'use client';
import '@/lib/i18n/lazy-cards';
import {useEffect,useState,type FormEvent} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {EmptyLine} from './empty-line';
import {MetaLine} from './meta-line';
import {askConfirm} from './confirm-dialog';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import {kstText} from '@/lib/format';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import {REVIEWER_LINKS_MAX,SHARE_DAY_CHOICES,SHARE_DEFAULT_DAYS,SHARE_LABEL_MAX,SHARE_PATH,type ShareLinkEntry,type ShareScopeKind} from '@/lib/share-links';

// 공유 링크 카드(G4, docs/SHARE-LINKS.ko.md): 한 대상(동결 보고서 한 건·작업물 한 건)의 링크 목록, 만들기, 취소. 서버(/api/share)가 판정하고 화면은 받은 값을 그대로 보인다.
// 토큰 원문(공유 주소)은 만든 직후 응답에만 있어 이 카드 안에서만 한 번 보인다. 새로고침하면 다시 볼 수 없다(취소 뒤 새로 만든다).
const API='/api/share';
type ListResponse={enabled:boolean;links:ShareLinkEntry[]};
type Created=ShareLinkEntry&{token:string};
export const shareUrl=(origin:string,token:string)=>`${origin}${SHARE_PATH}${token}`;
// 시각은 화면 언어(lib/format.ts kstText), 상태 이름은 사전(share.state.<상태>, 한국어는 lib/share-links.ts SHARE_STATE_LABELS와 같다)으로 적는다.
const kst=(iso:string)=>kstText(iso,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
async function readJson<T>(response:Response,fallback:string):Promise<T>{
 const data=await response.json().catch(()=>({})) as T&{error?:string};
 if(!response.ok)throw new Error(data.error||fallback);
 return data;
}
const getLinks=(kind:ShareScopeKind,id:string,signal?:AbortSignal)=>fetch(API+'?'+new URLSearchParams({kind,id}),{signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<ListResponse>(r,t('share.loadFailed')));
const postLink=<T,>(body:Record<string,unknown>)=>fetch(API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>readJson<T>(r,t('share.requestFailed')));

// 검토자 모드(kind 'artifact', 레인 X-G): 작업물 대화상자(app/artifact-reviewer-links.tsx)가 version을 넘긴다. 같은 판에 살아 있는 링크 수(최대 10개)를 보이고 다 차면 만들기를 막는다.
// 취소는 확인 대화상자(무엇·어디·되돌림)를 거친다. hideWhenOff면 스위치가 꺼져 있고 링크가 없을 때(와 불러오는 동안) 아무것도 그리지 않는다.
const reviewerCount=(links:readonly ShareLinkEntry[],version:number)=>links.filter(l=>l.state==='active'&&l.scope.version===version).length;
export function ShareLinksCard({kind,id,canManage,title,version,hideWhenOff=false}:{kind:ShareScopeKind;id:string;canManage:boolean;title:string;version?:number;hideWhenOff?:boolean}){
 useT();const [list,setList]=useState<ListResponse|null>(null),[round,setRound]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [label,setLabel]=useState(''),[days,setDays]=useState(String(SHARE_DEFAULT_DAYS)),[created,setCreated]=useState<Created|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  void getLinks(kind,id,controller.signal).then(d=>{if(!controller.signal.aborted){setList(d);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
  return()=>controller.abort();
 },[kind,id,round]);
 async function run(task:()=>Promise<void>){
  setBusy(true);
  try{await task();setError('')}catch(e){setError((e as Error).message)}finally{setBusy(false);setRound(n=>n+1)}
 }
 function create(e:FormEvent){
  e.preventDefault();
  void run(async()=>{
   const link=await postLink<Created>({action:'create',scope:{kind,id},label:label.trim(),days:Number(days)});
   setCreated(link);setLabel('');
   notifySaved(t('share.created') as Saved,{description:t('share.createdNote')});
  });
 }
 async function revoke(entry:ShareLinkEntry){
  if(reviewer&&!(await askConfirm({title:t('share.revokeTitle',{label:entry.label}),fields:{what:t('share.revokeWhatReviewer',{title,version}),where:t('share.revokeWhere',{label:entry.label}),when:t('share.revokeWhen'),reversible:t('share.revokeReversible')},impact:t('share.revokeImpact'),undo:t('share.revokeUndo'),confirmLabel:t('share.revokeConfirm'),danger:true})))return;
  await revokeNow(entry);
 }
 const reviewer=kind==='artifact'&&typeof version==='number';
 const revokeNow=(entry:ShareLinkEntry)=>run(async()=>{await postLink({action:'revoke',id:entry.id});if(created?.id===entry.id)setCreated(null);notifySaved(t('share.revoked') as Saved)});
 async function copy(url:string){
  try{await navigator.clipboard.writeText(url);notifySaved(t('share.copied') as Saved)}catch{toast.error(t('share.copyFailed'))}
 }
 if(!list)return hideWhenOff?null:error?<p className="form-error" role="alert">{error}</p>:<p className="loading-line" role="status">{t('share.loading')}</p>;
 if(hideWhenOff&&!list.enabled&&!list.links.length)return null;
 const active=reviewer?reviewerCount(list.links,version!):0,full=reviewer&&active>=REVIEWER_LINKS_MAX;
 const enabled=list.enabled,reason=!canManage?t('share.createDenied'):!enabled?t('share.switchOff'):full?t('share.reviewerMax',{REVIEWER_LINKS_MAX}):'';
 return <section className="form-stack" aria-label={reviewer?t('share.reviewerSection',{title}):t('share.section',{title})}>
  <h5>{reviewer?t('share.reviewerTitle'):t('share.title')}</h5>
  <p className="subtle-note">{reviewer?t('share.reviewerLead',{version,active,REVIEWER_LINKS_MAX}):t('share.lead')}</p>
  <form className="form-two" onSubmit={create}>
   <label className="store-field"><span>{t('share.recipient')}</span><Input value={label} maxLength={SHARE_LABEL_MAX} required disabled={busy||!canManage||!enabled} onChange={e=>setLabel(e.target.value)} placeholder={t('share.recipientPlaceholder')}/></label>
   <label className="store-field"><span>{t('share.validity')}</span><NativeSelect value={days} disabled={busy||!canManage||!enabled} onChange={e=>setDays(e.target.value)}>{SHARE_DAY_CHOICES.map(d=><NativeSelectOption key={d} value={String(d)}>{t('share.days',{d})}</NativeSelectOption>)}</NativeSelect></label>
   <div className="form-actions"><Button type="submit" size="sm" disabled={busy||!canManage||!enabled||full} disabledReason={reason}>{reviewer?t('share.createReviewer'):t('share.create')}</Button></div>
  </form>
  {created&&<div className="notice" role="status" aria-label={t('share.newAddress')}>
   <p><b>{created.label}</b> {t('share.newAddressNote')}</p>
   <Input readOnly aria-label={t('share.address')} value={shareUrl(typeof window==='undefined'?'':window.location.origin,created.token)} onFocus={e=>e.currentTarget.select()}/>
   <div className="form-actions"><Button type="button" size="sm" variant="outline" onClick={()=>void copy(shareUrl(window.location.origin,created.token))}>{t('share.copy')}</Button></div>
  </div>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!list.links.length&&<EmptyLine className="subtle-note" next={t('share.emptyNext')}>{t('share.empty')}</EmptyLine>}
  {!!list.links.length&&<ul className="artifact-list" aria-label={t('share.list')}>{list.links.map(l=><li key={l.id}>
   <MetaLine items={[<b key="label">{l.label}</b>,t(`share.state.${l.state}`),t('share.expires',{v:kst(l.expiresAt)}),t('share.views',{viewCount:l.viewCount}),l.lastViewedAt?t('share.lastViewed',{v:kst(l.lastViewedAt)}):t('share.notViewed'),l.decisions.approved?t('share.approvals',{v:kst(l.decisions.approved.at)}):'',l.decisions.revision?t('share.changes',{v:kst(l.decisions.revision.at)}):'']}/>
   {l.state==='active'&&<Button size="xs" variant="outline" disabled={busy||!canManage} disabledReason={canManage?'':t('share.revokeDenied')} onClick={()=>void revoke(l)}>{t('share.revokeLabel',{label:l.label})}</Button>}
  </li>)}</ul>}
 </section>;
}
