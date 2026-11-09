// 셀프 가입(G8, docs/SELF-SIGNUP.ko.md). 스위치 self_signup(플랫폼 스위치, 운영자 워크스페이스 값)과 AUTH_MODE=email일 때만 열린다. 꺼져 있으면 GET은 enabled:false, POST는 404다.
// start: 이메일·비밀번호(12~128자)·필수 동의(이용약관·개인정보)·선택 동의(마케팅) → 확인 대기 계정과 24시간 확인 링크. verify: 링크 소비 → 새 빈 워크스페이스 로그인.
// 메일 발송 어댑터가 없어 확인 링크를 응답으로 돌려준다(초대 링크를 관리자가 직접 전달하는 방식과 같다). 공개 운영 전 메일 연결이 필요하다.
// 요청 제한은 로그인과 같은 auth_rate_limits(IP 100회·이메일+IP 10회/15분)다. CAPTCHA는 쓰지 않는다(WCAG 2.2 3.3.8).
import {AuthError,authFailure} from '../../../../lib/auth-errors';
import {authDb,authMode,authOrigin,publicUser,sessionCookie} from '../../../../lib/auth-session';
import {authBody,authJson,clearRateLimit,normalizeEmail,rateLimit} from '../../../../lib/auth-request';
import {hashPassword,validatePassword} from '../../../../lib/auth-password';
import {signupConsents,startSelfSignup,verifySelfSignup} from '../../../../lib/auth-accounts';
import {platformFlag} from '../../../../lib/billing-server';

async function enabled(){
 if(authMode()!=='email')return false;
 return platformFlag(authDb(),'self_signup',null);
}
const notFound=()=>new AuthError(404,'요청한 기능을 찾을 수 없습니다.');
export async function GET(){try{return authJson({enabled:await enabled()})}catch(error){return authFailure(error)}}
export async function POST(req:Request){try{
 if(!await enabled())throw notFound();
 const body=await authBody(req),email=normalizeEmail(body.email);
 await rateLimit(req,email);
 if(body.action==='start'){
  const consents=signupConsents(body),passwordHash=await hashPassword(validatePassword(body.password));
  const {token}=await startSelfSignup(email,passwordHash,consents);
  const verifyUrl=`${authOrigin(req)}/#verify=${token}&email=${encodeURIComponent(email)}`;
  return authJson({ok:true,email,delivery:'display',verifyUrl,notice:'이메일 발송이 아직 연결되지 않아 확인 링크를 이 화면에 보여 드립니다. 링크는 24시간 동안 한 번만 쓸 수 있습니다.'});
 }
 if(body.action==='verify'){
  const result=await verifySelfSignup(email,body.token);
  await clearRateLimit(req,email).catch(()=>console.error('auth_rate_clear_failed'));
  return authJson({user:publicUser(result.user)},sessionCookie(req,result.token));
 }
 throw new AuthError(400,'가입 요청을 확인해 주세요.');
 }catch(error){return authFailure(error)}}
