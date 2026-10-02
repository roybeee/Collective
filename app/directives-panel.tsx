'use client';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {metaText} from '@/lib/format';
import {askConfirm} from '@/components/app/confirm-dialog';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Plus,Trash2,LoaderCircle} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {api,clientId} from '@/lib/client';
import type {CampaignDirective} from '@/lib/campaign-directives';
import {notifySaved} from '@/lib/ui/notify';

type Listing={directives:CampaignDirective[];limits:{maxLength:number;count:number}};

// 캠페인 상시 지시: 역할·회의·브리프 초안의 모든 AI 입력에 전달된다. 브리프 버전과 별개라 작업물을 무효화하지 않는다.
export function DirectivesPanel({campaignId}:{campaignId:string}){
 const [listing,setListing]=useState<Listing|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pendingId=useRef('');
 const fetchListing=useCallback(async()=>{
  const r=await fetch('/api/directives?campaignId='+encodeURIComponent(campaignId));const d=await r.json() as Listing&{error?:string};
  if(!r.ok)throw new Error(d.error||'상시 지시를 불러오지 못했습니다.');return {directives:d.directives,limits:d.limits};
 },[campaignId]);
 useEffect(()=>{
  let live=true;
  void fetchListing().then(l=>{if(live){setListing(l);setError('')}}).catch(e=>{if(live)setError((e as Error).message)});
  return()=>{live=false};
 },[fetchListing]);
 async function change(action:'add'|'remove',payload:Record<string,unknown>){
  setBusy(true);
  try{await api(action,{campaignId,...payload},'/api/directives');setListing(await fetchListing());setError('');return true}
  catch(e){toast.error((e as Error).message);return false}finally{setBusy(false)}
 }
 async function add(){
  if(!pendingId.current)pendingId.current=clientId();
  // 되돌리기는 방금 저장한 같은 지시(id)를 지운다.
  const id=pendingId.current;if(await change('add',{id,text})){pendingId.current='';setText('');notifySaved('상시 지시를 저장했습니다.',{description:'다음 AI 실행부터 적용됩니다.',undo:async()=>{await api('remove',{campaignId,id},'/api/directives');setListing(await fetchListing())},undone:'상시 지시 저장을 되돌렸습니다.'})}
 }
 async function remove(d:CampaignDirective){
  if(!(await askConfirm({title:'이 상시 지시를 삭제할까요?',impact:'기존 작업물과 브리프 버전은 그대로 유지됩니다.',undo:'삭제한 지시는 되돌릴 수 없습니다. 같은 내용으로 다시 저장할 수 있습니다.',confirmLabel:'삭제',danger:true})))return;
  if(await change('remove',{id:d.id}))notifySaved('상시 지시를 삭제했습니다.');
 }
 const full=!!listing&&listing.directives.length>=listing.limits.count;
 return <section className="notice mb-4">
  <b>상시 지시와 금지 표현</b>
  <p>역할 실행·팀 회의·브리프 초안의 모든 AI 입력에 함께 전달됩니다. 브리프 버전과 별개라 추가·삭제해도 기존 작업물은 유지되고 이력에만 남습니다.</p>
  {listing?.directives.length?<ul className="list-disc pl-5">{listing.directives.map(d=><li key={d.id} className="wrap-anywhere"><span className="whitespace-pre-wrap">{d.text}</span> <small><MetaLine items={[d.createdBy.email||'작성자',new Date(d.createdAt).toLocaleDateString('ko-KR')]}/></small><Button type="button" variant="ghost" size="sm" aria-label="상시 지시 삭제" disabled={busy} onClick={()=>void remove(d)}><Trash2/></Button></li>)}</ul>:listing&&<EmptyLine first="상시 지시">등록된 상시 지시가 없습니다.</EmptyLine>}
  <form onSubmit={e=>{e.preventDefault();void add()}}>
   <Textarea aria-label="상시 지시" rows={2} value={text} maxLength={listing?.limits.maxLength} disabled={!listing||busy||full} onChange={e=>{setText(e.target.value);pendingId.current=''}} placeholder="예: 선택지를 되묻지 말고 초안을 완성합니다. 인기·할인·첫 오픈 혜택은 확인 전 광고 문구에 쓰지 않습니다."/>
   <div className="flex justify-between items-center gap-2 mt-2">
    <small>{listing?metaText([`${text.trim().length}/${listing.limits.maxLength}자`,`${listing.directives.length}/${listing.limits.count}개`]):'불러오는 중…'}{full?'. 한도에 도달했습니다. 기존 지시를 정리해 주세요.':listing&&!text.trim()?'. 지시 내용을 쓰면 저장할 수 있습니다.':''}</small>
    <Button type="submit" size="sm" disabled={!listing||busy||full||!text.trim()} disabledReason={!listing?'먼저 대상을 고르세요.':full?'더 넣을 수 없습니다. 하나를 지운 뒤 하세요.':(!text.trim())?'필수 칸을 먼저 채우세요.':undefined}>{busy?<LoaderCircle className="spin"/>:<Plus/>}지시 저장</Button>
   </div>
  </form>
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
