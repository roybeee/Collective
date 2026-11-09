import {AuthError,authFailure} from '../../../lib/auth-errors';
import {requirePrincipal,sessionCookie} from '../../../lib/auth-session';
import {authBody,authJson,rateLimit} from '../../../lib/auth-request';
import {cancelInvite,disableAccount,issueToken,listAccountEvents,listAccounts,revokeSessions,setRole} from '../../../lib/auth-accounts';
import {accessOverview,inviteScoped,setAccess} from '../../../lib/access-accounts';
import {isScopedRole} from '../../../lib/access';
// G7: 범위 역할 스위치가 켜졌거나 멤버십이 있으면 계정마다 access(범위 역할·브랜드·지점)와 scope(스위치·고를 브랜드·지점·최근 범위 변경)를 더한다. 아니면 응답은 이전과 같다.
export async function GET(req:Request){try{const user=await requirePrincipal(req,true);const [accounts,overview]=await Promise.all([listAccounts(user),accessOverview(user)]);
 const withAccess=overview?accounts.map(a=>overview.memberships[a.id]&&a.role==='member'?{...a,access:overview.memberships[a.id]}:a):accounts;
 return authJson({accounts:withAccess,...(user.role==='owner'?{events:await listAccountEvents(user)}:{}),...(overview?{scope:{enabled:overview.enabled,brands:overview.brands,stores:overview.stores,changes:overview.changes}}:{})})}catch(error){return authFailure(error)}}
export async function POST(req:Request){try{
 const body=await authBody(req),admin=await requirePrincipal(req,true);
 await rateLimit(req,'admin:'+admin.id);
 if(body.action==='invite'&&isScopedRole(body.role))return authJson(await inviteScoped(admin,body));
 if(body.action==='invite'||body.action==='reset'||body.action==='reactivate')return authJson(await issueToken(admin,body));
 if(body.action==='disable')return authJson(await disableAccount(admin,body.userId));
 if(body.action==='set_role')return authJson(await setRole(admin,body.userId,body.role));
 if(body.action==='set_access')return authJson(await setAccess(admin,body));
 if(body.action==='cancel_invite')return authJson(await cancelInvite(admin,body.userId));
 if(body.action==='revoke_sessions'){const result=await revokeSessions(admin,body.userId);return authJson(result,result.self?sessionCookie(req,'',0):undefined)}
 throw new AuthError(400,'계정 요청을 확인해 주세요.');
 }catch(error){return authFailure(error)}}
