'use client';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy';
// 채널 연결 탭의 Instagram 직접 게시·Threads 카드(X-F, docs/INSTAGRAM-DIRECT.ko.md). POST /api/channels connect_publisher·verify_publisher·revoke_publisher(관리자).
// 연결은 저장 전에 서버가 공급자 /me로 토큰을 확인한다. 토큰은 쓰기 전용 칸이며 응답에 나오지 않는다. 게시는 발행 승인·실행 때만 일어난다.
import {useState} from 'react';
import {Link2,LoaderCircle,RefreshCw,Unplug} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Segmented} from '@/components/app/segmented';
import {askConfirm} from '@/components/app/confirm-dialog';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import {toast} from 'sonner';
import {useAccount} from './account-context';
import {ChannelCard,FormField,errorText,request} from './settings-channel-card';
import {publisherIssue} from './settings-channel-state';

export type PublisherStatus={channel:'instagram_direct'|'threads';brandId:string;connected:boolean;label:string;account?:string;userId?:string;expiresAt?:string|null;version?:number;updatedAt?:string};
type Login='facebook'|'instagram';
const blank={accessToken:'',userId:'',expiresAt:'',login:'facebook' as Login};
// 이름은 사전 키로 두고 그릴 때 t()로 읽는다.
const titles={instagram_direct:'spub.title.instagram',threads:'spub.title.threads'} as const;
const leads={instagram_direct:'spub.lead.instagram',threads:'spub.lead.threads'} as const;
const ADMIN_REASON=()=>t('spub.adminOnly');

export function PublisherCard({channel,brandId,brandName,status,checked,switchOn,onChanged}:{channel:'instagram_direct'|'threads';brandId:string;brandName:string;status:PublisherStatus|null;checked:boolean;switchOn:boolean|null;onChanged:()=>void}){useT();
 const account=useAccount(),admin=!!account?.isAdmin,[open,setOpen]=useState(false),[form,setForm]=useState(blank),[issue,setIssue]=useState(''),[busy,setBusy]=useState(false);
 const set=(k:keyof typeof blank,v:string)=>{setForm(f=>({...f,[k]:v}));setIssue('')};
 const connected=!checked?null:!!status?.connected,title=t(titles[channel]);
 async function send(body:Record<string,unknown>){setBusy(true);try{return await request<Record<string,unknown>>('/api/channels',{...body,channel,brandId})}finally{setBusy(false)}}
 async function connect(){
  const problem=publisherIssue(form);if(problem){setIssue(problem);return}
  try{await send({action:'connect_publisher',data:{accessToken:form.accessToken.trim(),userId:form.userId.trim(),...(form.expiresAt?{expiresAt:form.expiresAt}:{}),...(channel==='instagram_direct'?{login:form.login}:{})}});setForm(blank);setOpen(false);notifySaved(t('spub.saved',{title}) as Saved,{description:t('spub.savedNote')});onChanged()}
  catch(e){setIssue(errorText(e))}
 }
 async function verify(){try{const r=await send({action:'verify_publisher'});notifySaved(t('spub.rechecked') as Saved,{description:typeof r.verifiedAccount==='string'?t('spub.accountPrefix')+r.verifiedAccount:undefined});onChanged()}catch(e){toast.error(errorText(e))}}
 async function revoke(){
  if(!(await askConfirm({title:t('spub.disconnectTitle',{title}),fields:{what:t('spub.disconnectWhat',{title}),where:t('spub.disconnectWhere',{brand:brandName}),cost:t('spub.noCost'),reversible:t('spub.reconnect')},impact:t('spub.disconnectImpact'),undo:t('spub.disconnectUndo'),confirmLabel:t('spub.disconnect'),danger:true})))return;
  try{await send({action:'revoke_publisher'});notifySaved(t('spub.disconnected',{title}) as Saved);onChanged()}catch(e){toast.error(errorText(e))}
 }
 const noBrand=!brandId?t('spub.needBrand'):undefined,noToken=!admin?ADMIN_REASON():undefined;
 return <ChannelCard channel={channel} title={title} lead={t(leads[channel])} connected={connected} account={status?.account||(status?.userId?'ID '+status.userId:undefined)} expiresAt={status?.expiresAt} switchOn={switchOn} switchNote={switchOn?t('spub.onDirect'):t('spub.offBuffer')}>
  <div className="form-actions">
   <Button variant="outline" size="sm" aria-expanded={open} disabled={!admin||!brandId} disabledReason={noBrand??ADMIN_REASON()} onClick={()=>{setOpen(v=>!v);setIssue('')}}><Link2/>{status?.connected?t('spub.reconnectButton'):t('spub.connect')}</Button>
   {status?.connected&&<><Button variant="outline" size="sm" disabled={busy||!admin} disabledReason={noToken} onClick={()=>void verify()}><RefreshCw/>{t('spub.check')}</Button>
   <Button variant="ghost" size="sm" disabled={busy||!admin} disabledReason={noToken} onClick={()=>void revoke()}><Unplug/>{t('spub.unlink')}</Button></>}
  </div>
  {open&&<form className="form-stack" noValidate aria-label={t('spub.connectTitle',{title})} onSubmit={e=>{e.preventDefault();void connect()}}>
   <FormField label={t('spub.token')} help={t('spub.tokenHelp')}><Input type="password" autoComplete="off" value={form.accessToken} aria-invalid={issue.includes(t('spub.tokenAria'))||undefined} onChange={e=>set('accessToken',e.target.value)}/></FormField>
   <FormField label={channel==='threads'?t('spub.threadsId'):t('spub.instagramId')} help={t('spub.idHelp')}><Input inputMode="numeric" autoComplete="off" value={form.userId} aria-invalid={issue.includes(t('spub.idAria'))||undefined} onChange={e=>set('userId',e.target.value)}/></FormField>
   <FormField label={t('spub.expiry')} help={t('spub.expiryHelp')}><Input type="date" value={form.expiresAt} onChange={e=>set('expiresAt',e.target.value)}/></FormField>
   {channel==='instagram_direct'&&<Segmented label={t('spub.login')} value={form.login} onChange={v=>set('login',v)} options={[{value:'facebook' as const,label:t('spub.facebookLogin')},{value:'instagram' as const,label:t('spub.instagramLogin')}]}/>}
   {issue&&<p className="form-error" role="alert">{issue}</p>}
   <div className="form-actions"><Button type="submit" size="sm" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Link2/>}{t('spub.checkSave')}</Button><Button type="button" variant="ghost" size="sm" onClick={()=>{setOpen(false);setForm(blank);setIssue('')}}>{t('spub.close')}</Button></div>
  </form>}
 </ChannelCard>;
}
