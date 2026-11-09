'use client';
// 셀프 가입 화면(G8, 스위치 self_signup이 켜졌을 때만 로그인 화면에서 연다). 이메일·비밀번호(비밀번호 관리자 자동완성 허용)와 동의 3개.
// 이용약관·개인정보 수집·이용은 필수, 마케팅 수신은 선택이며 세 칸 모두 처음에는 비어 있다(사전 선택 금지). CAPTCHA·퍼즐은 쓰지 않는다(WCAG 2.2 3.3.8).
// 메일 발송이 아직 없어 서버가 돌려준 확인 링크를 화면에 보여 주고, 같은 화면에서 확인할 수 있다(docs/SELF-SIGNUP.ko.md).
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {useState,type FormEvent} from 'react';
import {authRequest,type AccountUser} from './auth-client';

export type VerifyLink={token:string;email:string};
type Started={verifyUrl:string;notice:string;email:string};
export const verifyLinkOf=(url:string):VerifyLink|null=>{try{const p=new URLSearchParams(new URL(url).hash.slice(1)),token=p.get('verify')||'',email=p.get('email')||'';return /^[a-f0-9]{64}$/.test(token)&&email?{token,email}:null}catch{return null}};

export function SignupForm({verify,onSignedIn,onCancel}:{verify:VerifyLink|null;onSignedIn:(user:AccountUser)=>void;onCancel:()=>void}){
 const[email,setEmail]=useState(verify?.email??'');const[password,setPassword]=useState('');const[confirmation,setConfirmation]=useState('');
 const[terms,setTerms]=useState(false);const[privacy,setPrivacy]=useState(false);const[marketing,setMarketing]=useState(false);
 const[started,setStarted]=useState<Started|null>(null);const[pending,setPending]=useState(false);const[error,setError]=useState('');
 async function run(task:()=>Promise<void>){if(pending)return;setError('');setPending(true);try{await task()}catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다. 다시 시도해 주세요.')}finally{setPending(false)}}
 function start(event:FormEvent){
  event.preventDefault();
  if(password!==confirmation){setError('두 비밀번호가 서로 다릅니다. 다시 입력해 주세요.');return}
  if(!terms||!privacy){setError('이용약관과 개인정보 수집·이용에 동의해 주세요. 두 항목은 필수입니다.');return}
  void run(async()=>{const result=await authRequest<Started>('/api/auth/signup',{action:'start',email,password,termsAccepted:terms,privacyAccepted:privacy,marketingOptIn:marketing});setPassword('');setConfirmation('');setStarted(result)});
 }
 function finishVerify(link:VerifyLink){void run(async()=>{const result=await authRequest<{user:AccountUser}>('/api/auth/signup',{action:'verify',email:link.email,token:link.token});onSignedIn(result.user)})}
 const pendingLink=verify??(started?verifyLinkOf(started.verifyUrl):null);
 const back=<Button variant="link" className="auth-text-button" type="button" onClick={onCancel} disabled={pending}>로그인 화면으로</Button>;
 if(pendingLink)return <main className="auth-screen"><section className="auth-card">
  <div className="auth-brand"><span aria-hidden="true">✳</span> COLLECTIVE</div>
  <h1>이메일 확인</h1>
  <p className="auth-intro">{pendingLink.email} 주소로 만든 새 워크스페이스를 확인합니다.</p>
  {started&&<div className="auth-link"><p className="auth-notice" role="status">{started.notice}</p><label>이메일 확인 링크<Input readOnly value={started.verifyUrl} onFocus={e=>e.currentTarget.select()}/></label></div>}
  {error&&<p className="auth-error" role="alert">{error}</p>}
  <Button className="auth-primary" type="button" disabled={pending} onClick={()=>finishVerify(pendingLink)}>{pending?'확인 중…':'이메일 확인하고 시작'}</Button>
  {back}
 </section></main>;
 return <main className="auth-screen"><section className="auth-card">
  <div className="auth-brand"><span aria-hidden="true">✳</span> COLLECTIVE</div>
  <h1>새 워크스페이스 만들기</h1>
  <p className="auth-intro">이메일과 비밀번호로 가입하면 빈 워크스페이스가 만들어집니다. 브랜드는 직접 추가합니다.</p>
  <form onSubmit={start}>
   <label>이메일<Input name="email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254} disabled={pending}/></label>
   <label>비밀번호<Input name="password" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></label>
   <label>비밀번호 확인<Input name="confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></label>
   <small>비밀번호는 12~128자로 설정하세요. 비밀번호 관리자를 써도 됩니다.</small>
   <fieldset className="grid gap-3 border-0 p-0 m-0">
    <legend className="mb-2 text-[13px] font-bold">동의</legend>
    <div className="flex items-start gap-2"><Checkbox id="signup-terms" name="terms" className="mt-0.5 size-5" checked={terms} onCheckedChange={v=>setTerms(v===true)} required disabled={pending}/><label htmlFor="signup-terms">(필수) 이용약관에 동의합니다</label></div>
    <div className="flex items-start gap-2"><Checkbox id="signup-privacy" name="privacy" className="mt-0.5 size-5" checked={privacy} onCheckedChange={v=>setPrivacy(v===true)} required disabled={pending}/><label htmlFor="signup-privacy">(필수) 개인정보 수집·이용(이메일, 비밀번호 해시, 가입 시각)에 동의합니다</label></div>
    <div className="flex items-start gap-2"><Checkbox id="signup-marketing" name="marketing" className="mt-0.5 size-5" checked={marketing} onCheckedChange={v=>setMarketing(v===true)} disabled={pending}/><label htmlFor="signup-marketing">(선택) 마케팅 정보 수신에 동의합니다. 동의하지 않아도 가입할 수 있습니다</label></div>
   </fieldset>
   {error&&<p className="auth-error" role="alert">{error}</p>}
   <Button className="auth-primary" disabled={pending} type="submit">{pending?'확인 중…':'가입하고 확인 링크 받기'}</Button>
  </form>
  {back}
  <p className="auth-note">약관·개인정보 처리방침 본문은 정식 공개 전 확정본으로 바뀝니다(초안).</p>
 </section></main>;
}
