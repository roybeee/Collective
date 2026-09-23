import {AuthError,invalidCredentials} from './auth-errors';
import {authDb,authEnv,hashToken,randomToken,sessionInsert,type Principal} from './auth-session';
import {hashPassword,validatePassword,verifyPassword} from './auth-password';
import {normalizeEmail} from './auth-request';
type UserRow={id:string;email:string;password_hash:string|null;workspace_owner:string;role:'admin'|'member';status:string};
const principal=(u:UserRow):Principal=>({id:u.id,email:u.email,role:u.role,owner:u.workspace_owner});
export async function login(email:string,password:unknown){
 const user=await authDb().prepare('SELECT * FROM auth_users WHERE email=?').bind(email).first<UserRow>();
 if(!await verifyPassword(password,user?.password_hash||null)||!user||user.status!=='active')throw invalidCredentials();
 const token=randomToken();const result=await sessionInsert(await hashToken(token),user.id,user.password_hash!).run();
 if(!result.meta.changes)throw invalidCredentials();return {user:principal(user),token};
}
export async function bootstrapAccount(email:string,password:unknown,token:unknown){
 const config=authEnv;
 if(typeof token!=='string'||token.length<32||token.length>256||!config.AUTH_BOOTSTRAP_EMAIL||email!==normalizeEmail(config.AUTH_BOOTSTRAP_EMAIL)||!config.AUTH_BOOTSTRAP_OWNER||!config.AUTH_BOOTSTRAP_TOKEN_HASH||await hashToken(token)!==config.AUTH_BOOTSTRAP_TOKEN_HASH)throw invalidCredentials();
 const db=authDb(),id=crypto.randomUUID(),nonce=randomToken(),session=randomToken(),passwordHash=await hashPassword(validatePassword(password)),now=Date.now();
 const results=await db.batch([
  db.prepare("INSERT OR IGNORE INTO auth_tokens(token_hash,email,owner,role,kind,expires_at,used,created_at) SELECT 'bootstrap',?,?,'admin','bootstrap',0,?,? WHERE NOT EXISTS(SELECT 1 FROM auth_users)").bind(email,config.AUTH_BOOTSTRAP_OWNER,nonce,now),
  db.prepare("INSERT INTO auth_users(id,email,password_hash,workspace_owner,role,status,created_at) SELECT ?,?,?,?,'admin','active',? WHERE EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash='bootstrap' AND used=?)").bind(id,email,passwordHash,config.AUTH_BOOTSTRAP_OWNER,now,nonce),
  sessionInsert(await hashToken(session),id,passwordHash),
 ]);
 if(!results[1].meta.changes)throw invalidCredentials();return {user:{id,email,role:'admin' as const,owner:config.AUTH_BOOTSTRAP_OWNER},token:session};
}
export async function acceptToken(email:string,password:unknown,token:unknown){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw invalidCredentials();
 const db=authDb(),hash=await hashToken(token),now=Date.now();
 const target=await db.prepare("SELECT u.* FROM auth_tokens t JOIN auth_users u ON u.id=t.user_id WHERE t.token_hash=? AND t.email=? AND t.email=u.email AND t.owner=u.workspace_owner AND t.role=u.role AND t.kind IN ('invite','reset') AND t.used IS NULL AND t.expires_at>? AND u.status IN ('pending','active')").bind(hash,email,now).first<UserRow>();
 if(!target)throw invalidCredentials();
 const passwordHash=await hashPassword(validatePassword(password)),nonce=randomToken(),session=randomToken();
 const owned="EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND used=?)";
 const results=await db.batch([
  db.prepare("UPDATE auth_tokens SET used=? WHERE token_hash=? AND used IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM auth_users WHERE id=auth_tokens.user_id AND status IN ('pending','active'))").bind(nonce,hash,Date.now()),
  db.prepare(`UPDATE auth_users SET password_hash=?,status='active' WHERE id=? AND ${owned}`).bind(passwordHash,target.id,hash,nonce),
  db.prepare(`DELETE FROM auth_sessions WHERE user_id=? AND ${owned}`).bind(target.id,hash,nonce),
  db.prepare(`UPDATE auth_tokens SET used='revoked' WHERE user_id=? AND used IS NULL AND ${owned}`).bind(target.id,hash,nonce),
  sessionInsert(await hashToken(session),target.id,passwordHash),
 ]);
 if(!results[0].meta.changes||!results[4].meta.changes)throw invalidCredentials();return {user:principal(target),token:session};
}
export async function changePassword(user:Principal,current:unknown,password:unknown){
 const db=authDb(),row=await db.prepare("SELECT * FROM auth_users WHERE id=? AND status='active'").bind(user.id).first<UserRow>();
 if(!row||!await verifyPassword(current,row.password_hash))throw invalidCredentials();
 const next=await hashPassword(validatePassword(password)),session=randomToken();
 const results=await db.batch([
  db.prepare("UPDATE auth_users SET password_hash=? WHERE id=? AND password_hash=? AND status='active'").bind(next,user.id,row.password_hash),
  db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)').bind(user.id,user.id,next),
  db.prepare("UPDATE auth_tokens SET used='revoked' WHERE user_id=? AND used IS NULL AND EXISTS(SELECT 1 FROM auth_users WHERE id=? AND password_hash=?)").bind(user.id,user.id,next),
  sessionInsert(await hashToken(session),user.id,next),
 ]);
 if(!results[0].meta.changes||!results[3].meta.changes)throw new AuthError(409,'계정 정보가 변경됐습니다. 다시 로그인해 주세요.');return {user,token:session};
}
