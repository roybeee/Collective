'use client';
// 플레이스 리뷰 답글·소식 초안 카드(C5, docs/PLACE-DRAFTS.ko.md, 레인 X-G). 점포 마케팅 > 지점 > 채널 점검 탭에서 lazy로 그린다(app/store-marketing-panel.tsx).
// GET /api/place-drafts?storeId, POST create·approve·submit_help·mark_submitted·mark_verified·cancel·create_device_task·sync_device. 판정·스위치(place_drafts)·문안 고정은 서버가 한다.
// 네이버 스마트플레이스에는 공개 쓰기 API가 없다. 이 카드는 자동 제출하지 않고, 승인한 문안을 복사해 사람이 등록한 뒤 '제출했습니다'를 누르게 한다.
// 점포 브라우저 작업은 스위치·지점 연결·화면 매핑 확인이 모두 있을 때만 만들고, 점포 브라우저 화면에서 다시 승인해야 장치가 접수한다.
// 스위치가 꺼져 있고 초안이 없거나, 권한이 없어 목록을 읽지 못하면(직원 403) 아무것도 그리지 않는다(이전 화면과 같다).
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
import {notifySaved} from '@/lib/ui/notify';
import type {Store} from '@/lib/store-marketing';
import type {PlaceDraft,PlaceDraftKind,PlaceDraftStatus,NewsTopic} from '@/lib/place-drafts';
import type {PlaceDraftMapping} from '@/lib/place-drafts-server';
import {useCan} from './account-context';

type Listing={enabled:boolean;storeBrowserEnabled:boolean;drafts:PlaceDraft[];mapping:PlaceDraftMapping|null;notice?:string};
type Help={text:string|null;adminUrl:string;observedManagerUrl:string|null;path:string;note:string};
type Load={state:'loading'}|{state:'ready';listing:Listing}|{state:'hidden'}|{state:'error';message:string};
const kindLabels:Record<PlaceDraftKind,string>={review_reply:'리뷰 답글',news_post:'소식'};
const statusLabels:Record<PlaceDraftStatus,string>={draft:'승인 대기',approved:'승인됨(제출 전)',submitted:'제출 표시',verified:'게시 확인',cancelled:'취소'};
const topicLabels:Record<NewsTopic,string>={notice:'공지',promotion:'프로모션',menu:'메뉴'};
const deviceType:Record<PlaceDraftKind,'reply_review'|'post_news'>={review_reply:'reply_review',news_post:'post_news'};
const blankForm={kind:'review_reply' as PlaceDraftKind,sourceText:'',rating:'',topic:'notice' as NewsTopic,title:'',body:''};

async function send<T>(input:Record<string,unknown>):Promise<T>{
 const r=await fetch('/api/place-drafts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const d=await r.json().catch(()=>({})) as T&{error?:string};
 if(!r.ok)throw new Error(d.error||'플레이스 초안 요청을 처리하지 못했습니다.');
 return d;
}
const canDevice=(l:Listing,d:PlaceDraft)=>l.storeBrowserEnabled&&l.mapping?.status==='active'&&l.mapping.taskTypes.includes(deviceType[d.kind]);
const deviceReason=(l:Listing,d:PlaceDraft)=>!l.storeBrowserEnabled?'점포 브라우저 실행 스위치가 꺼져 있습니다.':l.mapping?.status!=='active'?'이 지점의 답글·소식 화면 매핑을 먼저 확인하세요.':!l.mapping.taskTypes.includes(deviceType[d.kind])?`${kindLabels[d.kind]} 화면 매핑이 없습니다.`:undefined;

function SubmitHelp({help,onCopy}:{help:Help;onCopy:(text:string)=>void}){
 return <div className="form-stack" role="group" aria-label="복사·제출 도움">
  {help.text&&<><b>승인한 문안</b><Textarea readOnly rows={4} aria-label="승인한 문안" value={help.text} onFocus={e=>e.currentTarget.select()}/><div className="form-actions"><Button type="button" size="sm" variant="outline" onClick={()=>onCopy(help.text!)}>문안 복사</Button></div></>}
  <p><MetaLine items={[<a key="admin" href={help.adminUrl} target="_blank" rel="noreferrer noopener">스마트플레이스 관리 열기</a>,help.observedManagerUrl&&<a key="observed" href={help.observedManagerUrl} target="_blank" rel="noreferrer noopener">연결한 관리 화면</a>,help.path]}/></p>
  <p className="subtle-note">{help.note}</p>
 </div>;
}

function DraftItem({d,listing,busy,canAct,help,onAct,onCopy}:{d:PlaceDraft;listing:Listing;busy:boolean;canAct:boolean;help?:Help;onAct:(d:PlaceDraft,action:string)=>void;onCopy:(text:string)=>void}){
 const reason=canAct?undefined:'이 지점의 발행 권한이 없습니다.',on=listing.enabled,offReason=!on?'플레이스 초안 스위치가 꺼져 있습니다. 소유자가 켭니다.':undefined;
 const blocks=d.compliance.issues.filter(i=>i.severity==='block'),warns=d.compliance.issues.filter(i=>i.severity!=='block');
 return <li className="form-stack" data-place-draft={d.id} data-status={d.status}>
  <header className="channel-card-head"><b>{kindLabels[d.kind]}{d.news?.title?`: ${d.news.title}`:''}</b><span className="proposal-badges"><Badge variant="secondary">{statusLabels[d.status]}</Badge>{d.submission&&<Badge variant="outline">{d.submission.channel==='device'?'제출 표시(장치)':'제출했습니다'}</Badge>}</span></header>
  <p className="subtle-note"><MetaLine items={['만든 시각 '+dateTime(d.createdAt),d.approvedAt&&'승인 '+dateTime(d.approvedAt),d.submission&&'제출 표시 '+dateTime(d.submission.at),d.verification&&'게시 확인 '+dateTime(d.verification.at)]}/></p>
  <p className="whitespace-pre-wrap">{d.draft.text}</p>
  {blocks.length>0&&<ul className="text-sm list-disc pl-5" aria-label="막는 규정">{blocks.map(i=><li key={i.ruleId+i.excerpt}>{i.title}{i.excerpt?`: ${i.excerpt}`:''}</li>)}</ul>}
  {warns.length>0&&<ul className="text-sm list-disc pl-5" aria-label="규정 경고">{warns.map(i=><li key={i.ruleId+i.excerpt}>{i.title}</li>)}</ul>}
  {help&&<SubmitHelp help={help} onCopy={onCopy}/>}
  {d.deviceTask&&<p className="subtle-note"><MetaLine items={['점포 브라우저 작업',d.deviceTask.jobStatus||'만듦','점포 브라우저 화면에서 다시 승인해야 장치가 접수합니다']}/></p>}
  <div className="form-actions">
   {d.status==='draft'&&<Button size="sm" disabled={busy||!canAct||!on||d.compliance.blocking} disabledReason={reason??offReason??(d.compliance.blocking?'막는 규정을 먼저 해결하세요.':undefined)} onClick={()=>onAct(d,'approve')}>승인</Button>}
   {d.status==='approved'&&!help&&<Button size="sm" variant="outline" disabled={busy||!canAct} disabledReason={reason} onClick={()=>onAct(d,'submit_help')}>복사·제출 도움 열기</Button>}
   {d.status==='approved'&&<Button size="sm" disabled={busy||!canAct||!on} disabledReason={reason??offReason} onClick={()=>onAct(d,'mark_submitted')}>제출했습니다</Button>}
   {d.status==='approved'&&!d.deviceTask&&<Button size="sm" variant="outline" disabled={busy||!canAct||!on||!canDevice(listing,d)} disabledReason={reason??offReason??deviceReason(listing,d)} onClick={()=>onAct(d,'create_device_task')}>점포 브라우저 작업 만들기</Button>}
   {d.deviceTask&&(d.status==='approved'||d.status==='submitted')&&<Button size="sm" variant="outline" disabled={busy||!canAct} disabledReason={reason} onClick={()=>onAct(d,'sync_device')}>장치 결과 확인</Button>}
   {d.status==='submitted'&&<Button size="sm" variant="outline" disabled={busy||!canAct||!on} disabledReason={reason??offReason} onClick={()=>onAct(d,'mark_verified')}>게시 확인 기록</Button>}
   {(d.status==='draft'||d.status==='approved')&&<Button size="sm" variant="ghost" disabled={busy||!canAct} disabledReason={reason} onClick={()=>onAct(d,'cancel')}>취소</Button>}
  </div>
 </li>;
}

export function PlaceDraftsCard({store}:{store:Store}){
 const [load,setLoad]=useState<Load>({state:'loading'}),[busy,setBusy]=useState(false),[form,setForm]=useState(blankForm),[helps,setHelps]=useState<Record<string,Help>>({});
 const canAct=useCan('publish',{brandId:store.brandId,storeId:store.id});
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  const r=await fetch('/api/place-drafts?storeId='+encodeURIComponent(store.id),{cache:'no-store',credentials:'same-origin',signal});
  const d=await r.json().catch(()=>({})) as Listing&{error?:string};
  if(signal?.aborted)return;
  if(r.status===401||r.status===403){setLoad({state:'hidden'});return}
  if(!r.ok||!Array.isArray(d.drafts)){setLoad({state:'error',message:d.error||'플레이스 초안을 불러오지 못했습니다.'});return}
  setLoad(!d.enabled&&!d.drafts.length?{state:'hidden'}:{state:'ready',listing:d});
 },[store.id]);
 useEffect(()=>{const c=new AbortController();void Promise.resolve().then(()=>refresh(c.signal)).catch(e=>{if(!c.signal.aborted)setLoad({state:'error',message:(e as Error).message})});return()=>c.abort()},[refresh]);
 async function run(task:()=>Promise<unknown>,saved:`${string}습니다.`){
  setBusy(true);
  try{await task();notifySaved(saved);await refresh()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
 }
 async function copy(text:string){try{await navigator.clipboard.writeText(text);notifySaved('문안을 복사했습니다.')}catch{toast.error('복사하지 못했습니다. 문안을 직접 선택해 복사하세요.')}}
 async function act(d:PlaceDraft,action:string){
  if(action==='approve'){
   const ok=await askConfirm({title:`이 ${kindLabels[d.kind]} 초안을 승인할까요?`,fields:{what:`${kindLabels[d.kind]}: ${d.draft.text.slice(0,80)}`,where:`${store.name} 네이버 스마트플레이스`,when:'승인 뒤 사람이 직접 등록합니다',reversible:'제출 전에는 취소할 수 있습니다'},impact:'승인한 문안이 고정됩니다. 네이버에 자동으로 올라가지 않습니다.',undo:'제출 전이면 취소할 수 있습니다. 문안을 바꾸려면 새 초안을 만드세요.',confirmLabel:'승인'});
   if(!ok)return;
   await run(async()=>{const r=await send<{submitHelp?:Help}>({action:'approve',id:d.id});if(r.submitHelp)setHelps(h=>({...h,[d.id]:r.submitHelp!}))},'초안을 승인했습니다.');return;
  }
  if(action==='submit_help'){setBusy(true);try{const r=await send<{submitHelp:Help}>({action:'submit_help',id:d.id});setHelps(h=>({...h,[d.id]:r.submitHelp}))}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}return}
  if(action==='create_device_task'){
   const ok=await askConfirm({title:'점포 브라우저 작업을 만들까요?',fields:{what:`${kindLabels[d.kind]} 승인 문안 등록`,where:`${store.name} 업무용 컴퓨터`,when:'점포 브라우저 화면에서 다시 승인한 뒤',reversible:'접수 전에는 점포 브라우저 화면에서 취소할 수 있습니다'},impact:'승인 대기 작업 하나를 만듭니다. 장치는 점포 브라우저 화면에서 다시 승인한 뒤에 접수합니다.',undo:'점포 브라우저 화면의 취소로 지웁니다.',confirmLabel:'작업 만들기'});
   if(!ok)return;
  }
  const saved:Record<string,`${string}습니다.`>={mark_submitted:'제출했다고 기록했습니다.',mark_verified:'게시를 확인했다고 기록했습니다.',cancel:'초안을 취소했습니다.',create_device_task:'점포 브라우저 작업을 만들었습니다.',sync_device:'장치 결과를 확인했습니다.'};
  await run(()=>send({action,id:d.id}),saved[action]??'처리했습니다.');
 }
 function create(){
  const input=form.kind==='review_reply'?{action:'create',kind:form.kind,storeId:store.id,sourceText:form.sourceText.trim(),...(form.rating?{rating:Number(form.rating)}:{})}:{action:'create',kind:form.kind,storeId:store.id,news:{topic:form.topic,title:form.title.trim(),...(form.body.trim()?{body:form.body.trim()}:{})}};
  void run(async()=>{await send(input);setForm(f=>({...blankForm,kind:f.kind}))},'초안을 만들었습니다.');
 }
 if(load.state==='hidden'||load.state==='loading')return null;
 if(load.state==='error')return <p className="form-error" role="alert">{load.message}</p>;
 const {listing}=load,on=listing.enabled,missing=form.kind==='review_reply'?(!form.sourceText.trim()?'리뷰 원문을 먼저 붙여 넣으세요.':undefined):(!form.title.trim()?'소식 제목을 먼저 쓰세요.':undefined);
 const createReason=!canAct?'이 지점의 발행 권한이 없습니다.':!on?'플레이스 초안 스위치가 꺼져 있습니다. 소유자가 켭니다.':missing;
 return <section className="metric-card place-drafts" aria-label="플레이스 리뷰 답글·소식 초안">
  <div className="section-heading"><h3>플레이스 리뷰 답글·소식 초안</h3><span className="mode-pill">쓰기 API 없음·자동 제출 없음</span></div>
  <SafetyScope>{listing.notice||'승인한 문안만 사람이 스마트플레이스에 등록합니다.'}</SafetyScope>
  <form className="form-stack" noValidate aria-label="새 초안" onSubmit={e=>{e.preventDefault();if(!createReason)create()}}>
   <Segmented label="초안 종류" value={form.kind} disabled={busy} onChange={kind=>setForm(f=>({...f,kind}))} options={[{value:'review_reply',label:'리뷰 답글'},{value:'news_post',label:'소식'}]}/>
   {form.kind==='review_reply'?<div className="form-two">
    <label className="store-field"><span>리뷰 원문</span><Textarea rows={3} maxLength={2000} value={form.sourceText} onChange={e=>setForm(f=>({...f,sourceText:e.target.value}))} placeholder="리뷰어 이름 없이 리뷰 본문만 붙여 넣으세요."/></label>
    <label className="store-field"><span>별점(선택)</span><NativeSelect value={form.rating} onChange={e=>setForm(f=>({...f,rating:e.target.value}))}><NativeSelectOption value="">모름</NativeSelectOption>{[5,4,3,2,1].map(n=><NativeSelectOption key={n} value={String(n)}>{`${n}점`}</NativeSelectOption>)}</NativeSelect></label>
   </div>:<div className="form-two">
    <label className="store-field"><span>소식 종류</span><NativeSelect value={form.topic} onChange={e=>setForm(f=>({...f,topic:e.target.value as NewsTopic}))}>{(Object.keys(topicLabels) as NewsTopic[]).map(k=><NativeSelectOption key={k} value={k}>{topicLabels[k]}</NativeSelectOption>)}</NativeSelect></label>
    <label className="store-field"><span>소식 제목</span><Input maxLength={60} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/></label>
    <label className="store-field"><span>본문(선택)</span><Textarea rows={3} maxLength={1000} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))}/></label>
   </div>}
   <small className="subtle-note">고객 전화번호·주소 같은 개인정보는 저장 전에 가려집니다. 금액·할인 표현은 확정한 브랜드 사실에 있어야 승인할 수 있습니다.</small>
   <div className="form-actions"><Button type="submit" size="sm" variant="outline" disabled={busy||!!createReason} disabledReason={createReason}>초안 만들기</Button></div>
  </form>
  {listing.drafts.length?<ul className="proposal-list" aria-label="플레이스 초안 목록">{listing.drafts.map(d=><DraftItem key={d.id} d={d} listing={listing} busy={busy} canAct={canAct} help={helps[d.id]} onAct={(x,a)=>void act(x,a)} onCopy={t=>void copy(t)}/>)}</ul>:<EmptyLine next="리뷰 원문을 붙여 넣거나 소식 제목을 쓰고 초안 만들기를 누르세요.">아직 플레이스 초안이 없습니다.</EmptyLine>}
 </section>;
}
