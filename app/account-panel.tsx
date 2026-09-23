'use client';

import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {authRequest,roleLabel,type AccountUser} from './auth-client';

type ManagedAccount=AccountUser&{status:'pending'|'active'|'disabled';disabled:boolean;accepted:boolean;createdAt:string};
type AccountEvent={id:string;action:string;targetEmail:string;role?:'admin'|'member';actor?:{id:string;email:string|null};createdAt:string};
type AccountAction=[label:string,input:Record<string,unknown>,question?:string];
const eventLabels:Record<string,string>={invite:'초대 링크 발급',reset:'비밀번호 재설정 링크 발급',reactivate:'접근 복구',disable:'접근 해제',set_role:'권한 변경',cancel_invite:'초대 취소',revoke_sessions:'모든 로그인 종료',lockout:'로그인 실패 50회 초과, 시도 간격 늘림'};
const notices:Record<string,string>={disable:'계정 접근을 해제했습니다. 기존 로그인도 종료됩니다.',revoke_sessions:'해당 계정의 모든 로그인을 종료했습니다.',set_role:'권한을 변경했습니다. 초대 대기 계정은 초대 링크를 다시 발급하세요.',cancel_invite:'초대를 취소했습니다. 같은 이메일로 다시 초대할 수 있습니다.'};

export function AccountPanel({user,onClose,onSignedOut}:{user:AccountUser;onClose:()=>void;onSignedOut:()=>void}){
 const[accounts,setAccounts]=useState<ManagedAccount[]>([]);const[events,setEvents]=useState<AccountEvent[]>([]);const[email,setEmail]=useState('');const[role,setRole]=useState<'member'|'admin'>('member');
 const[link,setLink]=useState('');const[pending,setPending]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');
 const load=useCallback((signal?:AbortSignal)=>authRequest<{accounts:ManagedAccount[];events?:AccountEvent[]}>('/api/accounts',undefined,signal).then(r=>{setAccounts(r.accounts);setEvents(r.events||[])}),[]);
 useEffect(()=>{const controller=new AbortController();load(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[load]);
 async function perform(input:Record<string,unknown>,question?:string){
  if(pending||(question&&!window.confirm(question)))return;setPending(true);setError('');setNotice('');setLink('');
  try{
   const result=await authRequest<{token?:string;self?:boolean}>('/api/accounts',input);
   if(result.self){onSignedOut();return;}
   if(result.token){setLink(`${location.origin}/#invite=${encodeURIComponent(result.token)}`);setNotice('링크를 복사해 해당 직원에게 직접 전달하세요. 이메일은 자동 발송되지 않습니다.');}
   else setNotice(notices[String(input.action)]||'변경했습니다.');
   await load();
  }catch(e){setError(e instanceof Error?e.message:'계정 요청을 처리하지 못했습니다.');}finally{setPending(false);}
 }
 async function copy(){try{await navigator.clipboard.writeText(link);setNotice('초대 링크를 복사했습니다. 해당 직원에게만 전달하세요.')}catch{setNotice('링크를 선택해 직접 복사하세요.')}}
 // 소유자 계정은 본인만, 관리자 계정은 소유자만, 직원 계정은 관리자와 소유자가 관리한다(서버도 같은 규칙으로 403을 낸다).
 function actions(account:ManagedAccount):AccountAction[]{
  const self=account.id===user.id,target={userId:account.id},other=account.role==='admin'?'member':'admin';
  if(self)return account.status==='active'?[['모든 로그인 종료',{action:'revoke_sessions',...target},'이 계정의 모든 기기에서 로그아웃할까요? 지금 화면도 로그아웃됩니다.']]:[];
  if(account.role==='owner'||(account.role==='admin'&&user.role!=='owner'))return [];
  const list:AccountAction[]=[];
  if(account.status==='active')list.push(['비밀번호 재설정 링크',{action:'reset',...target}],['모든 로그인 종료',{action:'revoke_sessions',...target},`${account.email} 계정의 모든 기기에서 로그아웃할까요?`]);
  if(account.status==='pending')list.push(['초대 링크 재발급',{action:'invite',email:account.email,role:account.role}]);
  if(account.status==='pending'&&!account.accepted)list.push(['초대 취소',{action:'cancel_invite',...target},`${account.email} 초대를 취소할까요?`]);
  if(account.status==='disabled')list.push(['접근 복구',{action:'reactivate',...target},`${account.email} 계정을 복구하고 비밀번호 재설정 링크를 만들까요?`]);
  const to=other==='admin'?'관리자로':'직원으로';
  if(user.role==='owner'&&account.status!=='disabled')list.push([`${to} 권한 변경`,{action:'set_role',role:other,...target},`${account.email} 계정의 권한을 ${to} 바꿀까요?`]);
  if(account.status==='active'||(account.status==='pending'&&account.accepted))list.push(['접근 해제',{action:'disable',...target},`${account.email} 계정의 접근을 해제할까요?`]);
  return list;
 }
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="auth-dialog"><DialogHeader><DialogTitle>팀 계정 관리</DialogTitle><DialogDescription>초대한 직원은 이 워크스페이스의 업무 자료를 함께 사용합니다.{user.role==='owner'?'':' 관리자 계정의 초대·변경은 소유자만 할 수 있습니다.'}</DialogDescription></DialogHeader>
  <form className="auth-invite-form" onSubmit={e=>{e.preventDefault();void perform({action:'invite',email,role:user.role==='owner'?role:'member'})}}>
   <label>초대할 이메일<input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={pending}/></label>
   {user.role==='owner'&&<label>계정 권한<select value={role} onChange={e=>setRole(e.target.value as 'admin'|'member')} disabled={pending}><option value="member">직원</option><option value="admin">관리자</option></select></label>}
   <button className="auth-primary" disabled={pending}>초대 링크 만들기</button>
  </form>
  {error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="auth-notice" role="status">{notice}</p>}
  {link&&<div className="auth-link"><label>초대·재설정 링크<input readOnly value={link} onFocus={e=>e.target.select()}/></label><button type="button" onClick={()=>void copy()}>링크 복사</button><small>24시간 동안 한 번만 사용할 수 있습니다.</small></div>}
  <ul className="auth-accounts">{accounts.map(account=>{const list=actions(account);return <li key={account.id}><div><strong>{account.email}</strong><small>{roleLabel(account.role)}{account.disabled?' · 접근 해제됨':account.status==='pending'?' · 초대 대기':''}{account.id===user.id?' · 내 계정':''}</small></div>{list.length>0&&<div className="auth-account-actions">{list.map(([label,input,question])=><button key={label} type="button" disabled={pending} onClick={()=>void perform(input,question)}>{label}</button>)}</div>}</li>})}</ul>
  {user.role==='owner'&&<section className="auth-events" aria-label="최근 계정 변경"><h3>최근 계정 변경</h3>{events.length?<ol>{events.map(event=><li key={event.id}><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('ko-KR')}</time><span>{event.actor?event.actor.email||'알 수 없음':'시스템'} · {eventLabels[event.action]||event.action}{event.role?`(${roleLabel(event.role)})`:''} · {event.targetEmail}</span></li>)}</ol>:<small>아직 기록이 없습니다.</small>}</section>}
 </DialogContent></Dialog>;
}

export function PasswordPanel({onClose,onChanged}:{onClose:()=>void;onChanged:()=>void}){
 const[currentPassword,setCurrentPassword]=useState('');const[password,setPassword]=useState('');const[confirmation,setConfirmation]=useState('');const[error,setError]=useState('');const[pending,setPending]=useState(false);
 async function submit(event:FormEvent){
  event.preventDefault();if(pending)return;setError('');if(password!==confirmation){setError('비밀번호가 일치하지 않습니다.');return;}setPending(true);
  try{await authRequest('/api/auth',{action:'change_password',currentPassword,password});onChanged();}catch(e){setError(e instanceof Error?e.message:'변경하지 못했습니다.');}finally{setPending(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!pending)onClose()}}><DialogContent className="auth-dialog"><DialogHeader><DialogTitle>비밀번호 변경</DialogTitle><DialogDescription>다른 기기의 로그인도 종료됩니다.</DialogDescription></DialogHeader><form onSubmit={submit}>
  <label>현재 비밀번호<input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required maxLength={128} disabled={pending}/></label>
  <label>새 비밀번호<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></label>
  <label>새 비밀번호 확인<input type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></label>
  {error&&<p className="auth-error" role="alert">{error}</p>}<button className="auth-primary" disabled={pending}>{pending?'변경 중…':'비밀번호 변경'}</button>
 </form></DialogContent></Dialog>;
}
