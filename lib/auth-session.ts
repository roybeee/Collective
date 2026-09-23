import {env} from 'cloudflare:workers';
import {AuthError} from './auth-errors';
export type Role='owner'|'admin'|'member';
export type Principal={id:string;email:string;role:Role;owner:string};
export const authEnv=env as unknown as {DB?:D1Database;AUTH_MODE?:string;AUTH_ORIGIN?:string;AUTH_BOOTSTRAP_EMAIL?:string;AUTH_BOOTSTRAP_OWNER?:string;AUTH_BOOTSTRAP_TOKEN_HASH?:string};
export function authMode(): 'legacy'|'email'{
 // 운영 빌드에서 AUTH_MODE가 비면 GPT 헤더를 믿는 legacy로 열지 않고 닫는다. legacy는 명시해야 한다.
 if(authEnv.AUTH_MODE===undefined&&process.env.NODE_ENV==='production')throw new AuthError(503,'인증 모드가 설정되지 않았습니다. 관리자에게 문의해 주세요.');
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
// 소유자는 저장하지 않고 계산한다: 같은 workspace_owner의 관리자 중 가장 먼저 만든 계정(동률이면 id 오름차순).
export const roleSql=(u:string)=>`CASE WHEN ${u}.role='admin' AND ${u}.id=(SELECT o.id FROM auth_users o WHERE o.workspace_owner=${u}.workspace_owner AND o.role='admin' ORDER BY o.created_at,o.id LIMIT 1) THEN 'owner' ELSE ${u}.role END`;
// 세션은 마지막 사용 뒤 7일(유휴)이 지나거나 로그인 뒤 30일(절대)이 지나면 끝난다. 사용할 때마다 만료를 min(로그인+30일, 지금+7일)로 늦추되 1시간 단위로만 쓴다.
const idleLimit=604800000,absoluteLimit=2592000000,refreshStep=3600000;
export async function authPrincipal(req:Request):Promise<Principal|null>{
 if(authMode()!=='email')return null;
 const db=authDb(),token=sessionToken(req);if(!token)return null;
 const hash=await hashToken(token),now=Date.now();
 const row=await db.prepare(`SELECT u.id,u.email,${roleSql('u')} AS role,u.workspace_owner AS owner,s.expires_at AS expiresAt,s.created_at AS createdAt FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.session_hash=? AND s.expires_at>? AND u.status='active'`).bind(hash,now).first<Principal&{expiresAt:number;createdAt:number}>();
 if(!row||!['owner','admin','member'].includes(row.role))return null;
 const next=Math.min(row.createdAt+absoluteLimit,now+idleLimit);
 if(next-row.expiresAt>=refreshStep)await db.prepare('UPDATE auth_sessions SET expires_at=? WHERE session_hash=? AND expires_at<?').bind(next,hash,next).run();
 return {id:row.id,email:row.email,role:row.role,owner:row.owner};
}
export function publicUser(user:Principal){return {id:user.id,email:user.email,role:user.role}}
export async function requirePrincipal(req:Request,admin=false){const user=await authPrincipal(req);if(!user)throw new AuthError(401,'로그인이 필요합니다.');if(admin&&user.role==='member')throw new AuthError(403,'관리자 권한이 필요합니다.');return user}
// 만료 세션, 만료된 지 7일 지난 초대·재설정 토큰(사용 여부 무관, 사용 시점은 만료 전이다), 창이 끝난 요청 제한 행을 지운다. bootstrap 기록은 남긴다.
export function cleanupAuthRecords(now=Date.now()){const db=authDb();return db.batch([
 db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now),
 db.prepare("DELETE FROM auth_tokens WHERE kind!='bootstrap' AND expires_at<=?").bind(now-604800000),
 db.prepare('DELETE FROM auth_rate_limits WHERE window_start<=?').bind(now-900000),
])}
export function sessionInsert(hash:string,id:string,passwordHash:string){const now=Date.now();return authDb().prepare("INSERT INTO auth_sessions(session_hash,user_id,expires_at,created_at) SELECT ?,id,?,? FROM auth_users WHERE id=? AND status='active' AND password_hash=?").bind(hash,now+idleLimit,now,id,passwordHash)}
