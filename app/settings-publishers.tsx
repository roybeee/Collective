'use client';
// 채널 연결 탭의 Instagram 직접 게시·Threads 카드(X-F, docs/INSTAGRAM-DIRECT.ko.md). POST /api/channels connect_publisher·verify_publisher·revoke_publisher(관리자).
// 연결은 저장 전에 서버가 공급자 /me로 토큰을 확인한다. 토큰은 쓰기 전용 칸이며 응답에 나오지 않는다. 게시는 발행 승인·실행 때만 일어난다.
import {useState} from 'react';
import {Link2,LoaderCircle,RefreshCw,Unplug} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Segmented} from '@/components/app/segmented';
import {askConfirm} from '@/components/app/confirm-dialog';
import {notifySaved} from '@/lib/ui/notify';
import {toast} from 'sonner';
import {useAccount} from './account-context';
import {ChannelCard,FormField,errorText,request} from './settings-channel-card';
import {publisherIssue} from './settings-channel-state';

export type PublisherStatus={channel:'instagram_direct'|'threads';brandId:string;connected:boolean;label:string;account?:string;userId?:string;expiresAt?:string|null;version?:number;updatedAt?:string};
type Login='facebook'|'instagram';
const blank={accessToken:'',userId:'',expiresAt:'',login:'facebook' as Login};
const titles={instagram_direct:'Instagram 직접 게시',threads:'Threads 게시'} as const;
const leads={instagram_direct:'Buffer 없이 Graph API로 승인된 발행을 게시합니다.',threads:'Threads API로 승인된 발행을 게시합니다.'} as const;
const ADMIN_REASON='관리자만 연결을 바꿀 수 있습니다.';

export function PublisherCard({channel,brandId,brandName,status,checked,switchOn,onChanged}:{channel:'instagram_direct'|'threads';brandId:string;brandName:string;status:PublisherStatus|null;checked:boolean;switchOn:boolean|null;onChanged:()=>void}){
 const account=useAccount(),admin=!!account?.isAdmin,[open,setOpen]=useState(false),[form,setForm]=useState(blank),[issue,setIssue]=useState(''),[busy,setBusy]=useState(false);
 const set=(k:keyof typeof blank,v:string)=>{setForm(f=>({...f,[k]:v}));setIssue('')};
 const connected=!checked?null:!!status?.connected,title=titles[channel];
 async function send(body:Record<string,unknown>){setBusy(true);try{return await request<Record<string,unknown>>('/api/channels',{...body,channel,brandId})}finally{setBusy(false)}}
 async function connect(){
  const problem=publisherIssue(form);if(problem){setIssue(problem);return}
  try{await send({action:'connect_publisher',data:{accessToken:form.accessToken.trim(),userId:form.userId.trim(),...(form.expiresAt?{expiresAt:form.expiresAt}:{}),...(channel==='instagram_direct'?{login:form.login}:{})}});setForm(blank);setOpen(false);notifySaved(`${title} 연결을 확인하고 저장했습니다.`,{description:'게시는 발행 승인과 실행 때만 일어납니다.'});onChanged()}
  catch(e){setIssue(errorText(e))}
 }
 async function verify(){try{const r=await send({action:'verify_publisher'});notifySaved('저장된 토큰을 다시 확인했습니다.',{description:typeof r.verifiedAccount==='string'?'계정 '+r.verifiedAccount:undefined});onChanged()}catch(e){toast.error(errorText(e))}}
 async function revoke(){
  if(!(await askConfirm({title:`${title} 연결을 해제할까요?`,fields:{what:`${title} 장수명 토큰`,where:`${brandName} 브랜드`,cost:'비용 변화 없음',reversible:'새 토큰으로 다시 연결하면 됩니다'},impact:'이 브랜드의 승인된 발행은 Buffer 경로로 돌아가고, 직접 게시 계정으로 승인한 발행은 다시 확인해야 합니다.',undo:'되돌리기는 없습니다. 다시 연결하세요.',confirmLabel:'연결 해제',danger:true})))return;
  try{await send({action:'revoke_publisher'});notifySaved(`${title} 연결을 해제했습니다.`);onChanged()}catch(e){toast.error(errorText(e))}
 }
 const noBrand=!brandId?'브랜드를 먼저 만드세요.':undefined,noToken=!admin?ADMIN_REASON:undefined;
 return <ChannelCard channel={channel} title={title} lead={leads[channel]} connected={connected} account={status?.account||(status?.userId?'ID '+status.userId:undefined)} expiresAt={status?.expiresAt} switchOn={switchOn} switchNote={switchOn?'연결된 브랜드는 직접 게시':'꺼져 있으면 Buffer 경로'}>
  <div className="form-actions">
   <Button variant="outline" size="sm" aria-expanded={open} disabled={!admin||!brandId} disabledReason={noBrand??ADMIN_REASON} onClick={()=>{setOpen(v=>!v);setIssue('')}}><Link2/>{status?.connected?'새 토큰으로 다시 연결':'연결'}</Button>
   {status?.connected&&<><Button variant="outline" size="sm" disabled={busy||!admin} disabledReason={noToken} onClick={()=>void verify()}><RefreshCw/>확인</Button>
   <Button variant="ghost" size="sm" disabled={busy||!admin} disabledReason={noToken} onClick={()=>void revoke()}><Unplug/>해제</Button></>}
  </div>
  {open&&<form className="form-stack" noValidate aria-label={`${title} 연결`} onSubmit={e=>{e.preventDefault();void connect()}}>
   <FormField label="장수명 액세스 토큰" help="서버에서 암호화해 저장합니다. 저장 뒤에는 다시 보이지 않습니다."><Input type="password" autoComplete="off" value={form.accessToken} aria-invalid={issue.includes('토큰')||undefined} onChange={e=>set('accessToken',e.target.value)}/></FormField>
   <FormField label={channel==='threads'?'Threads 사용자 ID':'Instagram 비즈니스 계정 ID'} help="숫자 ID입니다."><Input inputMode="numeric" autoComplete="off" value={form.userId} aria-invalid={issue.includes('계정 ID')||undefined} onChange={e=>set('userId',e.target.value)}/></FormField>
   <FormField label="토큰 만료일 (선택)" help="발급 때 확인한 날짜입니다. 14일 전부터 이 카드에 경고가 붙습니다."><Input type="date" value={form.expiresAt} onChange={e=>set('expiresAt',e.target.value)}/></FormField>
   {channel==='instagram_direct'&&<Segmented label="로그인 방식" value={form.login} onChange={v=>set('login',v)} options={[{value:'facebook' as const,label:'Facebook 로그인'},{value:'instagram' as const,label:'Instagram 로그인'}]}/>}
   {issue&&<p className="form-error" role="alert">{issue}</p>}
   <div className="form-actions"><Button type="submit" size="sm" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Link2/>}연결 확인 후 저장</Button><Button type="button" variant="ghost" size="sm" onClick={()=>{setOpen(false);setForm(blank);setIssue('')}}>닫기</Button></div>
  </form>}
 </ChannelCard>;
}
