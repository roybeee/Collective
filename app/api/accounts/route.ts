import {AuthError,authFailure} from '../../../lib/auth-errors';
import {requirePrincipal} from '../../../lib/auth-session';
import {authBody,authJson,rateLimit} from '../../../lib/auth-request';
import {disableAccount,issueToken,listAccounts} from '../../../lib/auth-accounts';
export async function GET(req:Request){try{return authJson({accounts:await listAccounts(await requirePrincipal(req,true))})}catch(error){return authFailure(error)}}
export async function POST(req:Request){try{
 const body=await authBody(req),admin=await requirePrincipal(req,true);
 await rateLimit(req,'admin:'+admin.id);
 if(body.action==='invite'||body.action==='reset')return authJson(await issueToken(admin,body));
 if(body.action==='disable')return authJson(await disableAccount(admin,body.userId));
 throw new AuthError(400,'계정 요청을 확인해 주세요.');
 }catch(error){return authFailure(error)}}
