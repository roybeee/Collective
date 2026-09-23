'use client';
import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {Link2,LoaderCircle,Unplug,TriangleAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Field} from './panels';
import {adminRequestNote,useCanManage} from './auth-client';

type ChannelStatus={channel:'naver_ads'|'instagram';label:string;connected:boolean;account:string;expiresAt:string|null;expiringSoon:boolean;updatedAt:string|null};
const blank={apiKey:'',secretKey:'',customerId:'',accessToken:'',userId:'',expiresAt:''};
const day=(value:string|null)=>value?new Date(value).toLocaleDateString('ko-KR'):'';

export function ChannelPanel(){
 const[channels,setChannels]=useState<ChannelStatus[]>([]);
 const[channel,setChannel]=useState<'naver_ads'|'instagram'>('naver_ads');
 const[form,setForm]=useState(blank);
 const[busy,setBusy]=useState(false);
 const canManage=useCanManage();
 const set=(k:keyof typeof blank,v:string)=>setForm(s=>({...s,[k]:v}));

 async function load(){
  const response=await fetch('/api/channels',{cache:'no-store'});
  const data=await response.json() as {channels?:ChannelStatus[];error?:string};
  if(!response.ok)throw new Error(data.error||'채널 연결 상태를 불러오지 못했습니다.');
  setChannels(data.channels||[]);
 }
 // 최초 1회만 읽는다. 이후 갱신은 저장·해제 핸들러가 직접 호출한다.
 useEffect(()=>{
  let cancelled=false;
  fetch('/api/channels',{cache:'no-store'})
   .then(r=>r.json() as Promise<{channels?:ChannelStatus[]}>)
   .then(d=>{if(!cancelled)setChannels(d.channels||[])})
   .catch(()=>{if(!cancelled)toast.error('채널 연결 상태를 불러오지 못했습니다.')});
  return()=>{cancelled=true};
 },[]);

 async function send(action:string,payload:Record<string,unknown>,message:string){
  setBusy(true);
  try{
   const response=await fetch('/api/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||'요청에 실패했습니다.');
   setForm(blank);await load();toast.success(message);
  }catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
 }

 const current=channels.find(c=>c.channel===channel);
 return <section className="settings-card">
  <h2>성과 자동 수집 연결</h2>
  <p>광고·게시물 성과를 직접 가져옵니다. 가져온 숫자는 초안으로만 저장되고, 비교 가능성은 실험 화면에서 직접 확인해 확정합니다.</p>

  {channels.map(c=><div className="connection-status" key={c.channel}>
   <span className={c.connected?'connected':''}/>
   {c.label} · {c.connected?`연결됨 · ${c.account}`:'연결 전'}
   {c.connected&&c.expiresAt&&<> · 토큰 만료 {day(c.expiresAt)}</>}
   {c.expiringSoon&&<> <TriangleAlert/> 갱신 필요</>}
  </div>)}

  {canManage?<>
  <Tabs value={channel} onValueChange={v=>{setChannel(v as 'naver_ads'|'instagram');setForm(blank)}}>
   <TabsList><TabsTrigger value="naver_ads">네이버 검색광고</TabsTrigger><TabsTrigger value="instagram">Instagram</TabsTrigger></TabsList>
  </Tabs>

  <form className="form-stack" onSubmit={e=>{e.preventDefault();void send('save_credential',{channel,data:form},'연결을 확인하고 저장했습니다.')}}>
   {channel==='naver_ads'?<>
    <Field label="API 키" help="광고시스템 → 도구 → API 사용 관리에서 발급합니다."><Input autoComplete="off" value={form.apiKey} onChange={e=>set('apiKey',e.target.value)} required/></Field>
    <Field label="비밀키" help="서버에서 암호화해 저장하며 다시 화면에 표시하지 않습니다."><Input type="password" autoComplete="off" value={form.secretKey} onChange={e=>set('secretKey',e.target.value)} required/></Field>
    <Field label="Customer ID" help="광고시스템의 고객 ID(숫자)입니다."><Input inputMode="numeric" value={form.customerId} onChange={e=>set('customerId',e.target.value)} required/></Field>
    <p className="notice">노출·클릭·광고비·전환을 가져옵니다. 전환 정의는 광고 계정의 전환 추적 설정을 따르므로 매장 실제 구매와 일치하는지 확인해야 합니다.</p>
   </>:<>
    <Field label="장수명 액세스 토큰" help="서버에서 암호화해 저장하며 요청 시 헤더로만 전송합니다."><Input type="password" autoComplete="off" value={form.accessToken} onChange={e=>set('accessToken',e.target.value)} required/></Field>
    <Field label="Instagram 비즈니스 계정 ID" help="페이스북 페이지에 연결된 비즈니스·크리에이터 계정 ID(숫자)입니다."><Input inputMode="numeric" value={form.userId} onChange={e=>set('userId',e.target.value)} required/></Field>
    <Field label="토큰 만료일 (선택)" help="발급 시 확인한 만료일입니다. 토큰에서 읽을 수 없어 직접 입력하며 만료 7일 전부터 알립니다."><Input type="date" value={form.expiresAt} onChange={e=>set('expiresAt',e.target.value)}/></Field>
    <p className="notice">도달·공유·저장·재생을 가져옵니다. 미디어 인사이트는 게시 이후 누적값이라 기간 비교에 그대로 쓸 수 없습니다. 두 안을 비교하려면 게시 후 경과 시간이 같아야 합니다.</p>
   </>}
   <div className="form-actions"><Button type="submit" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Link2/>}연결 확인 및 저장</Button></div>
  </form>

  {current?.connected&&<Button variant="ghost" disabled={busy} onClick={()=>void send('revoke_credential',{channel},'연결을 해제했습니다.')}><Unplug/>{current.label} 연결 해제</Button>}
  </>:<p className="notice">채널 연결·해제는 관리자만 할 수 있습니다. {adminRequestNote}</p>}

  <p className="subtle-note">네이버 플레이스와 당근 비즈프로필은 공식 통계 API가 없어 자동 수집 대상이 아닙니다. 두 채널의 성과는 계속 직접 입력합니다.</p>
 </section>;
}
