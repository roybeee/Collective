import {AuthError,authFailure} from '../../../lib/auth-errors';
import {requirePrincipal,sessionCookie} from '../../../lib/auth-session';
import {authBody,authJson,rateLimit} from '../../../lib/auth-request';
import {cancelInvite,disableAccount,issueToken,listAccountEvents,listAccounts,revokeSessions,setRole} from '../../../lib/auth-accounts';
export async function GET(req:Request){try{const user=await requirePrincipal(req,true);return authJson({accounts:await listAccounts(user),...(user.role==='owner'?{events:await listAccountEvents(user)}:{})})}catch(error){return authFailure(error)}}
export async function POST(req:Request){try{
 const body=await authBody(req),admin=await requirePrincipal(req,true);
 await rateLimit(req,'admin:'+admin.id);
 if(body.action==='invite'||body.action==='reset'||body.action==='reactivate')return authJson(await issueToken(admin,body));
 if(body.action==='disable')return authJson(await disableAccount(admin,body.userId));
 if(body.action==='set_role')return authJson(await setRole(admin,body.userId,body.role));
 if(body.action==='cancel_invite')return authJson(await cancelInvite(admin,body.userId));
 if(body.action==='revoke_sessions'){const result=await revokeSessions(admin,body.userId);return authJson(result,result.self?sessionCookie(req,'',0):undefined)}
 throw new AuthError(400,'계정 요청을 확인해 주세요.');
 }catch(error){return authFailure(error)}}
