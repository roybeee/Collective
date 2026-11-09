'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {EmptyLine} from './empty-line';
import {MetaLine} from './meta-line';
import {askConfirm} from './confirm-dialog';
import {notifySaved} from '@/lib/ui/notify';
import {REVIEWER_LINKS_MAX,SHARE_DAY_CHOICES,SHARE_DEFAULT_DAYS,SHARE_LABEL_MAX,SHARE_PATH,SHARE_STATE_LABELS,type ShareLinkEntry,type ShareScopeKind} from '@/lib/share-links';

// 공유 링크 카드(G4, docs/SHARE-LINKS.ko.md): 한 대상(동결 보고서 한 건·작업물 한 건)의 링크 목록, 만들기, 취소. 서버(/api/share)가 판정하고 화면은 받은 값을 그대로 보인다.
// 토큰 원문(공유 주소)은 만든 직후 응답에만 있어 이 카드 안에서만 한 번 보인다. 새로고침하면 다시 볼 수 없다(취소 뒤 새로 만든다).
const API='/api/share';
type ListResponse={enabled:boolean;links:ShareLinkEntry[]};
type Created=ShareLinkEntry&{token:string};
export const shareUrl=(origin:string,token:string)=>`${origin}${SHARE_PATH}${token}`;
const kst=(iso:string)=>new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
async function readJson<T>(response:Response,fallback:string):Promise<T>{
 const data=await response.json().catch(()=>({})) as T&{error?:string};
 if(!response.ok)throw new Error(data.error||fallback);
 return data;
}
const getLinks=(kind:ShareScopeKind,id:string,signal?:AbortSignal)=>fetch(API+'?'+new URLSearchParams({kind,id}),{signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<ListResponse>(r,'공유 링크를 불러오지 못했습니다.'));
const postLink=<T,>(body:Record<string,unknown>)=>fetch(API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>readJson<T>(r,'요청을 처리하지 못했습니다.'));

// 검토자 모드(kind 'artifact', 레인 X-G): 작업물 대화상자(app/artifact-reviewer-links.tsx)가 version을 넘긴다. 같은 판에 살아 있는 링크 수(최대 10개)를 보이고 다 차면 만들기를 막는다.
// 취소는 확인 대화상자(무엇·어디·되돌림)를 거친다. hideWhenOff면 스위치가 꺼져 있고 링크가 없을 때(와 불러오는 동안) 아무것도 그리지 않는다.
const reviewerCount=(links:readonly ShareLinkEntry[],version:number)=>links.filter(l=>l.state==='active'&&l.scope.version===version).length;
export function ShareLinksCard({kind,id,canManage,title,version,hideWhenOff=false}:{kind:ShareScopeKind;id:string;canManage:boolean;title:string;version?:number;hideWhenOff?:boolean}){
 const [list,setList]=useState<ListResponse|null>(null),[round,setRound]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
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
   notifySaved('공유 링크를 만들었습니다.',{description:'주소는 지금만 보입니다. 복사해 전달하세요.'});
  });
 }
 async function revoke(entry:ShareLinkEntry){
  if(reviewer&&!(await askConfirm({title:`${entry.label} 링크를 취소할까요?`,fields:{what:`외부 검토자 링크: ${title} v${version}`,where:`받는 사람 ${entry.label}, 로그인 없이 여는 공유 주소`,when:'지금 바로 닫힙니다',reversible:'되돌릴 수 없습니다. 필요하면 새 링크를 만들어 전달합니다'},impact:'이 주소로는 더 이상 작업물을 열거나 승인·수정 요청을 남길 수 없습니다. 이미 남긴 결정 기록은 그대로입니다.',undo:'취소한 링크는 다시 열 수 없습니다.',confirmLabel:'링크 취소',danger:true})))return;
  await revokeNow(entry);
 }
 const reviewer=kind==='artifact'&&typeof version==='number';
 const revokeNow=(entry:ShareLinkEntry)=>run(async()=>{await postLink({action:'revoke',id:entry.id});if(created?.id===entry.id)setCreated(null);notifySaved('공유 링크를 취소했습니다.')});
 async function copy(url:string){
  try{await navigator.clipboard.writeText(url);notifySaved('공유 주소를 복사했습니다.')}catch{toast.error('복사하지 못했습니다. 주소를 직접 선택해 복사하세요.')}
 }
 if(!list)return hideWhenOff?null:error?<p className="form-error" role="alert">{error}</p>:<p className="loading-line" role="status">공유 링크를 불러오고 있습니다.</p>;
 if(hideWhenOff&&!list.enabled&&!list.links.length)return null;
 const active=reviewer?reviewerCount(list.links,version!):0,full=reviewer&&active>=REVIEWER_LINKS_MAX;
 const enabled=list.enabled,reason=!canManage?'대표·관리자만 만들 수 있습니다.':!enabled?'기능 스위치가 꺼져 있습니다. 소유자가 켭니다.':full?`이 판의 검토자 링크는 ${REVIEWER_LINKS_MAX}개까지입니다. 하나를 취소한 뒤 만드세요.`:'';
 return <section className="form-stack" aria-label={reviewer?`검토자 링크 ${title}`:`공유 링크 ${title}`}>
  <h5>{reviewer?'외부 검토자 링크':'공유 링크'}</h5>
  <p className="subtle-note">{reviewer?`로그인 없이 이 판(v${version})을 읽고 승인·수정 요청을 남기는 주소입니다. 작업물 상태는 바꾸지 않고, 최종 승인은 앱에서 합니다. 이 판에 사용 중 ${active}/${REVIEWER_LINKS_MAX}개.`:'로그인 없이 읽는 주소입니다. 만료일이 지나거나 취소하면 바로 닫힙니다.'}</p>
  <form className="form-two" onSubmit={create}>
   <label className="store-field"><span>받는 사람</span><Input value={label} maxLength={SHARE_LABEL_MAX} required disabled={busy||!canManage||!enabled} onChange={e=>setLabel(e.target.value)} placeholder="예: 점주님"/></label>
   <label className="store-field"><span>유효 기간</span><NativeSelect value={days} disabled={busy||!canManage||!enabled} onChange={e=>setDays(e.target.value)}>{SHARE_DAY_CHOICES.map(d=><NativeSelectOption key={d} value={String(d)}>{`${d}일`}</NativeSelectOption>)}</NativeSelect></label>
   <div className="form-actions"><Button type="submit" size="sm" disabled={busy||!canManage||!enabled||full} disabledReason={reason}>{reviewer?'검토자 링크 만들기':'공유 링크 만들기'}</Button></div>
  </form>
  {created&&<div className="notice" role="status" aria-label="새 공유 주소">
   <p><b>{created.label}</b> 님에게 보낼 주소입니다. 지금만 보입니다.</p>
   <Input readOnly aria-label="공유 주소" value={shareUrl(typeof window==='undefined'?'':window.location.origin,created.token)} onFocus={e=>e.currentTarget.select()}/>
   <div className="form-actions"><Button type="button" size="sm" variant="outline" onClick={()=>void copy(shareUrl(window.location.origin,created.token))}>주소 복사</Button></div>
  </div>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!list.links.length&&<EmptyLine className="subtle-note" next="받는 사람을 적고 공유 링크 만들기를 누르세요.">아직 만든 공유 링크가 없습니다.</EmptyLine>}
  {!!list.links.length&&<ul className="artifact-list" aria-label="공유 링크 목록">{list.links.map(l=><li key={l.id}>
   <MetaLine items={[<b key="label">{l.label}</b>,SHARE_STATE_LABELS[l.state],`만료 ${kst(l.expiresAt)}`,`조회 ${l.viewCount}회`,l.lastViewedAt?`마지막 조회 ${kst(l.lastViewedAt)}`:'조회 전',l.decisions.approved?`승인 ${kst(l.decisions.approved.at)}`:'',l.decisions.revision?`수정 요청 ${kst(l.decisions.revision.at)}`:'']}/>
   {l.state==='active'&&<Button size="xs" variant="outline" disabled={busy||!canManage} disabledReason={canManage?'':'대표·관리자만 취소할 수 있습니다.'} onClick={()=>void revoke(l)}>{`${l.label} 링크 취소`}</Button>}
  </li>)}</ul>}
 </section>;
}
