'use client';

import {useCallback,useEffect,useState,type ReactNode} from 'react';
import {authRequest,type AccountUser,type AuthState} from './auth-client';
import {AccountProvider} from './account-context';
import {AuthForm,type SetupLink} from './auth-form';
import {AccountPanel,PasswordPanel} from './account-panel';
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
 if(!state)return <main className="auth-screen"><section className="auth-card"><div className="auth-brand">COLLECTIVE</div>{error?<><p role="alert">{error}</p><button className="auth-primary" onClick={()=>void refresh()}>다시 연결</button></>:<p role="status">워크스페이스를 준비하고 있습니다…</p>}</section></main>;
 if(state.mode==='legacy')return <AccountProvider state={state}>{children}</AccountProvider>;
 if(link||!state.user)return <AuthForm link={link} onSignedIn={signedIn} onCancel={()=>setLink(null)}/>;
 const manager=state.user.role!=='member';
 return <AccountProvider state={state}><div className="auth-toolbar"><span>{state.user.email}</span><nav aria-label="계정 메뉴">{manager&&<button onClick={()=>setPanel('accounts')}>팀 계정 관리</button>}<button onClick={()=>setPanel('password')}>비밀번호 변경</button><button disabled={pending} onClick={()=>void logout()}>로그아웃</button></nav>{error&&<p role="alert">{error}</p>}</div>{children}
  {panel==='accounts'&&manager&&<AccountPanel user={state.user} onClose={()=>setPanel(null)} onSignedOut={()=>{setState({mode:'email',user:null});setPanel(null)}}/>}
  {panel==='password'&&<PasswordPanel onClose={()=>setPanel(null)} onChanged={()=>{setPanel(null);void refresh()}}/>}
 </AccountProvider>;
}
