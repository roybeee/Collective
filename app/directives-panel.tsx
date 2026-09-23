'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Plus,Trash2,LoaderCircle} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {api,clientId} from '@/lib/client';
import type {CampaignDirective} from '@/lib/campaign-directives';

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
  if(await change('add',{id:pendingId.current,text})){pendingId.current='';setText('');toast.success('상시 지시를 추가했습니다. 다음 AI 실행부터 적용됩니다.')}
 }
 async function remove(d:CampaignDirective){
  if(!window.confirm('이 상시 지시를 삭제할까요? 기존 작업물과 브리프 버전은 그대로 유지됩니다.'))return;
  if(await change('remove',{id:d.id}))toast.success('상시 지시를 삭제했습니다.');
 }
 const full=!!listing&&listing.directives.length>=listing.limits.count;
 return <section className="notice" style={{marginBottom:16}}>
  <b>상시 지시 · 금지 표현</b>
  <p>역할 실행·팀 회의·브리프 초안의 모든 AI 입력에 함께 전달됩니다. 브리프 버전과 별개라 추가·삭제해도 기존 작업물은 유지되고 이력에만 남습니다.</p>
  {listing?.directives.length?<ul style={{listStyle:'disc',paddingLeft:20}}>{listing.directives.map(d=><li key={d.id} style={{overflowWrap:'anywhere'}}><span style={{whiteSpace:'pre-wrap'}}>{d.text}</span> <small>{d.createdBy.email||'작성자'} · {new Date(d.createdAt).toLocaleDateString('ko-KR')}</small><Button type="button" variant="ghost" size="sm" aria-label="상시 지시 삭제" disabled={busy} onClick={()=>void remove(d)}><Trash2/></Button></li>)}</ul>:listing&&<p>등록된 상시 지시가 없습니다.</p>}
  <form onSubmit={e=>{e.preventDefault();void add()}}>
   <Textarea aria-label="상시 지시" rows={2} value={text} maxLength={listing?.limits.maxLength} disabled={!listing||busy||full} onChange={e=>{setText(e.target.value);pendingId.current=''}} placeholder="예: 선택지를 되묻지 말고 초안을 완성합니다. 인기·할인·첫 오픈 혜택은 확인 전 광고 문구에 쓰지 않습니다."/>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:8}}>
    <small>{listing?`${text.trim().length}/${listing.limits.maxLength}자 · ${listing.directives.length}/${listing.limits.count}개`:'불러오는 중…'}{full?' · 한도에 도달했습니다. 기존 지시를 정리해 주세요.':''}</small>
    <Button type="submit" size="sm" disabled={!listing||busy||full||!text.trim()}>{busy?<LoaderCircle className="spin"/>:<Plus/>}지시 추가</Button>
   </div>
  </form>
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
