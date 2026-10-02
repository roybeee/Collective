'use client';

import {CardButton} from '@/components/app/card-button';
import {Button} from '@/components/ui/button';
import {lazy,Suspense,useCallback,useEffect,useState,type ReactNode} from 'react';
import {authRequest,type AccountUser,type AuthState} from './auth-client';
import {AccountProvider} from './account-context';
import type {SetupLink} from './auth-form';
// 로그인 폼과 팀 계정·비밀번호 대화상자는 쓸 때 내려받는다(로그인한 홈 첫 로딩 JS 예산, UX-PLAN-3 ⑩).
const AuthForm=lazy(()=>import('./auth-form').then(m=>({default:m.AuthForm})));
const AccountPanel=lazy(()=>import('./account-panel').then(m=>({default:m.AccountPanel}))),PasswordPanel=lazy(()=>import('./account-panel').then(m=>({default:m.PasswordPanel})));
import './auth.css';

function readSetupLink():SetupLink|null{
 if(typeof window==='undefined')return null;
 const fragment=new URLSearchParams(window.location.hash.slice(1));
 const kind=fragment.has('setup')?'setup':fragment.has('invite')?'invite':null;
 if(!kind)return null;
 const token=fragment.get(kind)||'';
 return token.length<=512?{kind,token}:null;
}

export default function AuthGate({children}:{children:ReactNode}){
 const[state,setState]=useState<AuthState|null>(null);const[error,setError]=useState('');const[link,setLink]=useState<SetupLink|null>(readSetupLink);
 const[panel,setPanel]=useState<'accounts'|'password'|null>(null);const[pending,setPending]=useState(false);
 const refresh=useCallback((signal?:AbortSignal)=>authRequest<AuthState>('/api/auth',undefined,signal).then(next=>{
  if(signal?.aborted)return;setState(next);setError('');if(!next.user)setPanel(null);
 }).catch(e=>{if(!signal?.aborted)setError(e instanceof Error?e.message:'연결하지 못했습니다.')}),[]);
 useEffect(()=>{
  const clearFragment=()=>{if(readSetupLink())history.replaceState(history.state,'',location.pathname+location.search)};
  const changed=()=>{const next=readSetupLink();if(next){setLink(next);clearFragment()}};
  clearFragment();window.addEventListener('hashchange',changed);
  const controller=new AbortController();void refresh(controller.signal);
  const focus=()=>{void refresh(controller.signal)};window.addEventListener('focus',focus);
  const interval=window.setInterval(focus,60_000);
  return()=>{controller.abort();window.removeEventListener('focus',focus);window.removeEventListener('hashchange',changed);window.clearInterval(interval)};
 },[refresh]);
 function signedIn(user:AccountUser){setState({mode:'email',user});setLink(null);setError('')}
 async function logout(){
  if(pending)return;setPending(true);setError('');
  try{await authRequest('/api/auth',{action:'logout'});setState({mode:'email',user:null});setPanel(null);}
  catch(e){setError(e instanceof Error?e.message:'로그아웃하지 못했습니다.');}finally{setPending(false);}
 }
 if(!state)return <main className="auth-screen"><section className="auth-card"><div className="auth-brand">COLLECTIVE</div>{error?<><p role="alert">{error}</p><Button className="auth-primary" onClick={()=>void refresh()}>다시 연결</Button></>:<p role="status">워크스페이스를 준비하고 있습니다…</p>}</section></main>;
 if(state.mode==='legacy')return <AccountProvider state={state}>{children}</AccountProvider>;
 if(link||!state.user)return <Suspense fallback={<main className="auth-screen"><section className="auth-card"><div className="auth-brand">COLLECTIVE</div><p role="status">워크스페이스를 준비하고 있습니다…</p></section></main>}><AuthForm link={link} onSignedIn={signedIn} onCancel={()=>setLink(null)}/></Suspense>;
 const manager=state.user.role!=='member';
 return <AccountProvider state={state}><div className="auth-toolbar"><span>{state.user.email}</span><nav aria-label="계정 메뉴">{manager&&<CardButton onClick={()=>setPanel('accounts')}>팀 계정 관리</CardButton>}<CardButton onClick={()=>setPanel('password')}>비밀번호 변경</CardButton><CardButton disabled={pending} onClick={()=>void logout()}>로그아웃</CardButton></nav>{error&&<p role="alert">{error}</p>}</div>{children}
  {panel==='accounts'&&manager&&<Suspense fallback={null}><AccountPanel user={state.user} onClose={()=>setPanel(null)} onSignedOut={()=>{setState({mode:'email',user:null});setPanel(null)}}/></Suspense>}
  {panel==='password'&&<Suspense fallback={null}><PasswordPanel onClose={()=>setPanel(null)} onChanged={()=>{setPanel(null);void refresh()}}/></Suspense>}
 </AccountProvider>;
}
