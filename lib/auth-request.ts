import {AuthError} from './auth-errors';
import {authDb,authMode,authOrigin,cleanupAuthRecords,hashToken} from './auth-session';
import {HttpBodyError,readBoundedJson} from './http-limits';
export function normalizeEmail(value:unknown){if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw new AuthError(400,'이메일 주소를 확인해 주세요.');return value.trim().toLowerCase()}
export async function authBody(req:Request){
 if(authMode()!=='email')throw new AuthError(409,'이메일 로그인이 활성화되지 않았습니다.');
 if(req.headers.get('origin')!==authOrigin(req))throw new AuthError(403,'허용되지 않은 요청입니다.');
 if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new AuthError(415,'JSON 요청만 허용됩니다.');
 try{const body=await readBoundedJson<Record<string,unknown>>(req,16384);if(!body||typeof body!=='object'||Array.isArray(body))throw new AuthError(400,'입력 형식을 확인해 주세요.');return body}catch(e){if(e instanceof HttpBodyError)throw new AuthError(e.status,e.message);throw e}
}
// IP 키(100회)는 모든 요청을 센다. 계정은 (계정+IP) 키(10회)로 빠르게 막고, 여러 IP의 실패를 합산하는 계정 전체 키는 막지 않고 늦춘다.
// 인증에 성공하면 계정 키를 지우므로(clearRateLimit) 남는 수는 실패뿐이다. 다른 IP의 실패가 정상 사용자의 IP 키를 채우지 않는다.
const limitWindow=900000,accountLimit=50,maxWaitSeconds=60;
function clientAddress(req:Request){
 // Only the edge-provided address is trusted; forwarded headers are ignored.
 const address=req.headers.get('cf-connecting-ip')||'unknown-edge-address';
 // IPv6는 한 사용자가 보통 /64 전체를 받으므로 /64 접두어로 묶는다. 주소를 바꿔 가며 (계정+IP) 키를 새로 받지 못하게 한다. IPv4는 그대로 쓴다.
 if(!address.includes(':')||address.includes('.'))return address;
 const [head,tail]=address.toLowerCase().split('::'),left=head?head.split(':'):[],right=tail?tail.split(':'):[];
 const groups=tail===undefined?left:[...left,...Array(Math.max(0,8-left.length-right.length)).fill('0'),...right];
 return groups.length===8&&groups.every(g=>/^[0-9a-f]{1,4}$/.test(g))?groups.slice(0,4).map(g=>parseInt(g,16).toString(16)).join(':')+'::/64':address;
}
const accountKeys=(req:Request,account:string)=>['account-ip:'+account+'|'+clientAddress(req),'account:'+account];
const tooMany=()=>new AuthError(429,'요청이 너무 많습니다. 15분 후 다시 시도해 주세요.');
async function bump(db:D1Database,name:string,now:number){
 const key=await hashToken(name);
 await db.prepare('INSERT INTO auth_rate_limits(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END').bind(key,now,now-limitWindow,now-limitWindow).run();
 return (await db.prepare('SELECT count FROM auth_rate_limits WHERE key=?').bind(key).first<{count:number}>())?.count??Infinity;
}
// 계정 전체 키가 처음 임계값을 넘으면 그 워크스페이스 소유자의 '최근 계정 변경'에 남긴다. 등록된 이메일일 때만 남는다.
function lockoutEvent(db:D1Database,account:string,now:number){
 const id=crypto.randomUUID(),at=new Date(now).toISOString();
 return db.prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT workspace_owner||':account_event:'||?,workspace_owner,'account_event','',json_object('id',?,'action','lockout','targetId',id,'targetEmail',email,'createdAt',?),? FROM auth_users WHERE email=?").bind(id,id,at,at,account).run();
}
export async function rateLimit(req:Request,account:string){
 const db=authDb(),now=Date.now(),[pair,whole]=accountKeys(req,account),ipCount=await bump(db,'ip:'+clientAddress(req),now);
 if(ipCount>100)throw tooMany();
 // 이 IP의 새 창이 열릴 때도 만료 인증 기록을 정리한다. 로그인 성공이 드물어도 행이 쌓이지 않는다(정리가 실패해도 요청은 계속한다).
 if(ipCount===1)await cleanupAuthRecords(now).catch(()=>console.error('auth_cleanup_failed'));
 if(await bump(db,pair,now)>10)throw tooMany();
 // 계정 전체 키: 50회까지는 바로 받는다. 넘으면 하드 차단 대신 직전 시도와 (초과 수)초(최대 60초) 간격을 둔 요청만 받는다(점진 지연).
 // 간격 전 요청은 세지 않으므로 공격자가 계속 두드려도 대기가 늘지 않는다. 간격 기록은 'account-wait:' 행의 window_start에 둔다.
 const row=await db.prepare('SELECT count,window_start FROM auth_rate_limits WHERE key=?').bind(await hashToken(whole)).first<{count:number;window_start:number}>();
 const over=row&&row.window_start>now-limitWindow?row.count-accountLimit:-1;
 if(over>=0){
  const slot=await db.prepare('INSERT INTO auth_rate_limits(key,count,window_start) VALUES(?,0,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start WHERE window_start<=?').bind(await hashToken('account-wait:'+account),now,now-Math.min(over,maxWaitSeconds)*1000).run();
  if(!slot.meta.changes)throw new AuthError(429,'로그인 실패가 많아 시도 간격을 늘렸습니다. 잠시 후(최대 1분) 다시 시도해 주세요.');
 }
 if(await bump(db,whole,now)===accountLimit+1)await lockoutEvent(db,account,now).catch(()=>console.error('auth_lockout_record_failed'));
}
export async function clearRateLimit(req:Request,account:string){const keys=await Promise.all(accountKeys(req,account).map(hashToken));await authDb().prepare('DELETE FROM auth_rate_limits WHERE key IN (?,?)').bind(...keys).run()}
export const authJson=(value:unknown,cookie?:string)=>Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
