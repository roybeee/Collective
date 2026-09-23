import {env} from 'cloudflare:workers';
import {AuthError} from './auth-errors';
export type Principal={id:string;email:string;role:'admin'|'member';owner:string};
export const authEnv=env as unknown as {DB?:D1Database;AUTH_MODE?:string;AUTH_ORIGIN?:string;AUTH_BOOTSTRAP_EMAIL?:string;AUTH_BOOTSTRAP_OWNER?:string;AUTH_BOOTSTRAP_TOKEN_HASH?:string};
export function authMode(): 'legacy'|'email'{
 if(authEnv.AUTH_MODE===undefined||authEnv.AUTH_MODE==='legacy')return 'legacy';
 if(authEnv.AUTH_MODE==='email')return 'email';
 throw new AuthError(503,'인증 모드 설정을 확인해 주세요.');
}
export function authDb(){if(!authEnv.DB)throw new AuthError(503,'인증 저장소에 연결하지 못했습니다.');return authEnv.DB}
export async function hashToken(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}
export function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
export function authOrigin(req:Request){
 const url=new URL(req.url),configured=authEnv.AUTH_ORIGIN;
 const local=process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(local&&!configured)return url.origin;
 if(!configured)throw new AuthError(503,'인증 사이트 주소가 설정되지 않았습니다.');
 let origin:URL;try{origin=new URL(configured)}catch{throw new AuthError(503,'인증 사이트 주소를 확인해 주세요.')}
 if(origin.protocol!=='https:'||origin.origin!==configured||url.origin!==configured)throw new AuthError(403,'허용되지 않은 인증 사이트입니다.');
 return configured;
}
function cookieName(req:Request){return authOrigin(req).startsWith('https:')?'__Host-collective_session':'collective_session_local'}
export function sessionCookie(req:Request,token:string,maxAge=2592000){return `${cookieName(req)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(req.url).protocol==='https:'?'; Secure':''}`}
export function sessionToken(req:Request){const name=cookieName(req)+'=';const values=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name));if(values.length!==1)return null;const value=values[0].slice(name.length);return /^[a-f0-9]{64}$/.test(value)?value:null}
export async function authPrincipal(req:Request):Promise<Principal|null>{
 if(authMode()!=='email')return null;
 const db=authDb(),token=sessionToken(req);if(!token)return null;
 const row=await db.prepare("SELECT u.id,u.email,u.role,u.workspace_owner AS owner FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.session_hash=? AND s.expires_at>? AND u.status='active'").bind(await hashToken(token),Date.now()).first<Principal>();
 if(!row||!['admin','member'].includes(row.role))return null;return row;
}
export function publicUser(user:Principal){return {id:user.id,email:user.email,role:user.role}}
export async function requirePrincipal(req:Request,admin=false){const user=await authPrincipal(req);if(!user)throw new AuthError(401,'로그인이 필요합니다.');if(admin&&user.role!=='admin')throw new AuthError(403,'관리자 권한이 필요합니다.');return user}
export function sessionInsert(hash:string,id:string,passwordHash:string){const now=Date.now();return authDb().prepare("INSERT INTO auth_sessions(session_hash,user_id,expires_at,created_at) SELECT ?,id,?,? FROM auth_users WHERE id=? AND status='active' AND password_hash=?").bind(hash,now+2592000000,now,id,passwordHash)}
