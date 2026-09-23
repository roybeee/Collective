'use client';

import {useEffect,useState,type FormEvent} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {authRequest,type AccountUser} from './auth-client';

type ManagedAccount=AccountUser&{status:'pending'|'active'|'disabled';disabled:boolean;createdAt:string};

export function AccountPanel({user,onClose}:{user:AccountUser;onClose:()=>void}){
 const[accounts,setAccounts]=useState<ManagedAccount[]>([]);const[email,setEmail]=useState('');const[role,setRole]=useState<'member'|'admin'>('member');
 const[link,setLink]=useState('');const[pending,setPending]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');
 useEffect(()=>{const controller=new AbortController();authRequest<{accounts:ManagedAccount[]}>('/api/accounts',undefined,controller.signal).then(r=>setAccounts(r.accounts)).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[]);
 async function perform(input:Record<string,unknown>){
  if(pending)return;setPending(true);setError('');setNotice('');setLink('');
  try{
   const result=await authRequest<{token?:string}>('/api/accounts',input);
   if(result.token){setLink(`${location.origin}/#invite=${encodeURIComponent(result.token)}`);setNotice('링크를 복사해 해당 직원에게 직접 전달하세요. 이메일은 자동 발송되지 않습니다.');}
   else setNotice('계정 접근을 해제했습니다. 기존 로그인도 종료됩니다.');
   setAccounts((await authRequest<{accounts:ManagedAccount[]}>('/api/accounts')).accounts);
  }catch(e){setError(e instanceof Error?e.message:'계정 요청을 처리하지 못했습니다.');}finally{setPending(false);}
 }
 async function copy(){try{await navigator.clipboard.writeText(link);setNotice('초대 링크를 복사했습니다. 해당 직원에게만 전달하세요.')}catch{setNotice('링크를 선택해 직접 복사하세요.')}}
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="auth-dialog"><DialogHeader><DialogTitle>팀 계정 관리</DialogTitle><DialogDescription>초대한 직원은 이 워크스페이스의 업무 자료를 함께 사용합니다.</DialogDescription></DialogHeader>
  <form className="auth-invite-form" onSubmit={e=>{e.preventDefault();void perform({action:'invite',email,role})}}>
   <label>초대할 이메일<input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={pending}/></label>
   <label>계정 권한<select value={role} onChange={e=>setRole(e.target.value as 'admin'|'member')} disabled={pending}><option value="member">직원</option><option value="admin">관리자</option></select></label>
   <button className="auth-primary" disabled={pending}>초대 링크 만들기</button>
  </form>
  {error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="auth-notice" role="status">{notice}</p>}
  {link&&<div className="auth-link"><label>초대·재설정 링크<input readOnly value={link} onFocus={e=>e.target.select()}/></label><button type="button" onClick={()=>void copy()}>링크 복사</button><small>24시간 동안 한 번만 사용할 수 있습니다.</small></div>}
  <ul className="auth-accounts">{accounts.map(account=><li key={account.id}><div><strong>{account.email}</strong><small>{account.role==='admin'?'관리자':'직원'}{account.disabled?' · 접근 해제됨':account.status==='pending'?' · 초대 대기':''}{account.id===user.id?' · 내 계정':''}</small></div>{!account.disabled&&account.id!==user.id&&<div className="auth-account-actions"><button type="button" disabled={pending} onClick={()=>void perform(account.status==='pending'?{action:'invite',email:account.email,role:account.role}:{action:'reset',userId:account.id})}>{account.status==='pending'?'초대 링크 재발급':'비밀번호 재설정 링크'}</button><button type="button" disabled={pending} onClick={()=>{if(window.confirm(`${account.email} 계정의 접근을 해제할까요?`))void perform({action:'disable',userId:account.id})}}>접근 해제</button></div>}</li>)}</ul>
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
