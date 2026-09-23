import {AuthError} from './auth-errors';
import {authDb,authMode,authOrigin,hashToken} from './auth-session';
import {HttpBodyError,readBoundedJson} from './http-limits';
export function normalizeEmail(value:unknown){if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw new AuthError(400,'이메일 주소를 확인해 주세요.');return value.trim().toLowerCase()}
export async function authBody(req:Request){
 if(authMode()!=='email')throw new AuthError(409,'이메일 로그인이 활성화되지 않았습니다.');
 if(req.headers.get('origin')!==authOrigin(req))throw new AuthError(403,'허용되지 않은 요청입니다.');
 if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new AuthError(415,'JSON 요청만 허용됩니다.');
 try{const body=await readBoundedJson<Record<string,unknown>>(req,16384);if(!body||typeof body!=='object'||Array.isArray(body))throw new AuthError(400,'입력 형식을 확인해 주세요.');return body}catch(e){if(e instanceof HttpBodyError)throw new AuthError(e.status,e.message);throw e}
}
export async function rateLimit(req:Request,account:string){
 const db=authDb(),now=Date.now(),window=900000;
 // Only the edge-provided address is trusted; forwarded headers are ignored.
 const ip=req.headers.get('cf-connecting-ip')||'unknown-edge-address';
 const keys=await Promise.all([hashToken('ip:'+ip),hashToken('account:'+account)]);
 for(let i=0;i<keys.length;i++){
  await db.prepare('INSERT INTO auth_rate_limits(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END').bind(keys[i],now,now-window,now-window).run();
  const row=await db.prepare('SELECT count FROM auth_rate_limits WHERE key=?').bind(keys[i]).first<{count:number}>();
  if(!row||row.count>(i===0?100:10))throw new AuthError(429,'요청이 너무 많습니다. 15분 후 다시 시도해 주세요.');
 }
}
export const authJson=(value:unknown,cookie?:string)=>Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
