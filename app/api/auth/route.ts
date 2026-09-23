import {AuthError,authFailure} from '../../../lib/auth-errors';
import {authDb,authMode,authPrincipal,hashToken,publicUser,requirePrincipal,sessionCookie,sessionToken} from '../../../lib/auth-session';
import {authBody,authJson,normalizeEmail,rateLimit} from '../../../lib/auth-request';
import {acceptToken,bootstrapAccount,changePassword,login} from '../../../lib/auth-credentials';
export async function GET(req:Request){try{const user=await authPrincipal(req);return authJson({mode:authMode(),user:user?publicUser(user):null})}catch(error){return authFailure(error)}}
export async function POST(req:Request){try{
 const body=await authBody(req);
 if(body.action==='logout'){const token=sessionToken(req);if(token)await authDb().prepare('DELETE FROM auth_sessions WHERE session_hash=?').bind(await hashToken(token)).run();return authJson({ok:true},sessionCookie(req,'',0))}
 const email=['login','accept','bootstrap'].includes(String(body.action))?normalizeEmail(body.email):'';
 await rateLimit(req,email||'session:'+await hashToken(sessionToken(req)||'anonymous'));
 const result=body.action==='login'?await login(email,body.password):body.action==='accept'?await acceptToken(email,body.password,body.token):body.action==='bootstrap'?await bootstrapAccount(email,body.password,body.token):body.action==='change_password'?await changePassword(await requirePrincipal(req),body.currentPassword,body.password):null;
 if(!result)throw new AuthError(400,'인증 요청을 확인해 주세요.');
 return authJson({user:publicUser(result.user)},sessionCookie(req,result.token));
 }catch(error){return authFailure(error)}}
