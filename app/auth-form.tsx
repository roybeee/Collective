'use client';

import {useState,type FormEvent} from 'react';
import {authRequest,type AccountUser} from './auth-client';

export type SetupLink={kind:'invite'|'setup';token:string};

export function AuthForm({link,onSignedIn,onCancel}:{link:SetupLink|null;onSignedIn:(user:AccountUser)=>void;onCancel:()=>void}){
 const[email,setEmail]=useState('');const[password,setPassword]=useState('');
 const[confirmation,setConfirmation]=useState('');const[pending,setPending]=useState(false);const[error,setError]=useState('');
 async function submit(event:FormEvent){
  event.preventDefault();if(pending)return;setError('');
  if(link&&password!==confirmation){setError('비밀번호가 일치하지 않습니다.');return;}
  setPending(true);
  try{
   const result=await authRequest<{user:AccountUser}>('/api/auth',{action:link?(link.kind==='setup'?'bootstrap':'accept'):'login',email,password,...(link?{token:link.token}:{})});
   setPassword('');setConfirmation('');onSignedIn(result.user);
  }catch(error){setError(error instanceof Error?error.message:'로그인하지 못했습니다.');}
  finally{setPending(false);}
 }
 return <main className="auth-screen"><section className="auth-card">
  <div className="auth-brand"><span aria-hidden="true">✳</span> COLLECTIVE</div>
  <p className="auth-eyebrow">YOUR TEAM. ONE WORKSPACE.</p>
  <h1>{link?'계정 시작하기':'다시 만나 반갑습니다'}</h1>
  <p className="auth-intro">{link?'초대받은 이메일과 새 비밀번호를 입력하세요.':'이메일로 로그인하고 팀의 작업을 이어가세요.'}</p>
  <form onSubmit={submit}>
   <label>이메일<input name="email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254} disabled={pending}/></label>
   <label>비밀번호<input name="password" type="password" autoComplete={link?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={link?12:1} maxLength={128} disabled={pending}/></label>
   {link&&<><label>비밀번호 확인<input name="confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></label><small>비밀번호는 12~128자로 설정하세요.</small></>}
   {error&&<p className="auth-error" role="alert">{error}</p>}
   <button className="auth-primary" disabled={pending} type="submit">{pending?'확인 중…':link?'비밀번호 설정하고 시작':'로그인'}</button>
  </form>
  {link?<button className="auth-text-button" type="button" onClick={onCancel} disabled={pending}>로그인 화면으로</button>:<p className="auth-note">처음 방문하셨거나 비밀번호를 잊으셨나요?<br/>관리자에게 초대 또는 재설정 링크를 요청하세요.</p>}
  <p className="auth-note">로그인은 최대 30일 동안 유지됩니다.<br/>공용 기기에서는 사용 후 로그아웃해 주세요.</p>
 </section></main>;
}
