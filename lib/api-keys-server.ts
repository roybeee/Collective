// API 키 서버(G9, docs/MCP-SERVER.ko.md). 만들기·목록·취소(대표·관리자, 세션)와 MCP 경로의 키 확인·빈도 제한·호출 감사.
// 저장: records kind 'api_key', 행 id는 `api_key:<키 SHA-256>`(소유자 없이 PK로 찾는다). 키 원문은 저장하지도 기록(console)하지도 않는다.
// 확인 순서: 키 모양 → 해시 PK 조회 → 저장 id와 상수 시간 비교 → 만료·취소. 실패는 모두 같은 null(호출자가 같은 401로 답한다).
// 스위치 mcp_server(기본 꺼짐)는 이 파일에서만 읽는다. 꺼지면 만들기 409, MCP 경로는 모두 404다. 목록·취소는 꺼져도 된다.
import {ApiError,database,recordStatement,stamp,uid,type Actor} from './server';
import {hashToken,randomToken} from './auth-session';
import {isEnabled} from './feature-flags';
import {API_KEY_MESSAGES as M,API_KEY_PREFIX,API_KEY_RATE_PER_MINUTE,API_KEYS_MAX_ACTIVE,entryOf,expiryOf,isApiKeyToken,keyState,parseCreateKey,parseRevokeKey,type ApiKey,type ApiKeyEntry,type Parsed} from './api-keys';

const rowId=(hash:string)=>`api_key:${hash}`;
const RATE_WINDOW=60000,TOUCH_EVERY=60000;

export async function mcpServerOn(owner:string){
 return isEnabled(owner,'mcp_server').catch(()=>{console.error('mcp_server_flag_unreadable');return false});
}
// 같은 길이의 16진 문자열을 상수 시간으로 비교한다(PK 조회 뒤 저장 id와 다시 맞춰 본다).
export function sameHash(a:string,b:string){
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
const parse=<T>(result:Parsed<T>):T=>{if(result.success)return result.data;throw new ApiError(400,result.issue.message)};

// ── 소유자 쪽(세션 인증, 호출자가 잠금·빈도 제한을 잡는다) ──
async function ownerKeys(owner:string):Promise<ApiKey[]>{
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='api_key' ORDER BY updated_at DESC`).bind(owner).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as ApiKey);
}
const adminOnly=(who:Actor)=>{if(who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,M.adminOnly)};
export async function listApiKeys(who:Actor):Promise<{enabled:boolean;keys:ApiKeyEntry[]}>{
 adminOnly(who);
 const now=Date.now();
 return {enabled:await mcpServerOn(who.owner),keys:(await ownerKeys(who.owner)).map(k=>entryOf(k,now))};
}
async function createKey(who:Actor,raw:Record<string,unknown>){
 const input=parse(parseCreateKey(raw)),now=Date.now();
 if((await ownerKeys(who.owner)).filter(k=>keyState(k,now)==='active').length>=API_KEYS_MAX_ACTIVE)throw new ApiError(409,M.cap);
 const token=API_KEY_PREFIX+randomToken(),hash=await hashToken(token);
 const key:ApiKey={id:uid(),label:input.label,scope:input.scope,prefix:API_KEY_PREFIX,last4:token.slice(-4),createdBy:{id:who.id,role:who.role==='owner'?'owner':'admin'},
  createdAt:new Date(now).toISOString(),expiresAt:expiryOf(now,input.days),revokedAt:null,lastUsedAt:null};
 await database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(rowId(hash),who.owner,'api_key','',JSON.stringify(key),key.createdAt).run();
 return {...entryOf(key,now),token};
}
async function revokeKey(owner:string,raw:Record<string,unknown>){
 const input=parse(parseRevokeKey(raw));
 const row=await database().prepare(`SELECT id,data FROM records WHERE owner=? AND kind='api_key' AND json_extract(data,'$.id')=?`).bind(owner,input.id).first<{id:string;data:string}>();
 if(!row)throw new ApiError(404,M.notFound);
 const key=JSON.parse(row.data) as ApiKey,now=Date.now();
 if(key.revokedAt)return entryOf(key,now);
 const revoked:ApiKey={...key,revokedAt:new Date(now).toISOString()};
 await database().prepare('UPDATE records SET data=?,updated_at=? WHERE id=? AND owner=?').bind(JSON.stringify(revoked),revoked.revokedAt,row.id,owner).run();
 return entryOf(revoked,now);
}
// 판정 순서: 모르는 작업 400 → 권한 403 → 취소(스위치 무관) → 스위치 꺼짐 409 → 입력 400 → 상한 409.
export async function apiKeyAction(who:Actor,input:Record<string,unknown>){
 const action=input.action;
 if(action!=='create'&&action!=='revoke')throw new ApiError(400,'지원하지 않는 API 키 작업입니다.');
 adminOnly(who);
 if(action==='revoke')return revokeKey(who.owner,input);
 if(!await mcpServerOn(who.owner))throw new ApiError(409,M.off);
 return createKey(who,input);
}

// ── MCP 경로(키 인증) ──
export type ResolvedKey={owner:string;rowId:string;key:ApiKey};
export async function resolveApiKey(token:unknown):Promise<ResolvedKey|null>{
 if(!isApiKeyToken(token))return null;
 const id=rowId(await hashToken(token));
 const row=await database().prepare(`SELECT id,owner,data FROM records WHERE id=? AND kind='api_key'`).bind(id).first<{id:string;owner:string;data:string}>();
 if(!row||!sameHash(row.id,id))return null;
 const key=JSON.parse(row.data) as ApiKey;
 if(keyState(key,Date.now())!=='active')return null;
 return {owner:row.owner,rowId:row.id,key};
}
// 마지막 사용 시각은 1분에 한 번만 쓴다(요청마다 쓰지 않는다). 실패해도 요청은 계속한다.
export async function touchApiKey(r:ResolvedKey,now=Date.now()){
 if(r.key.lastUsedAt&&now-Date.parse(r.key.lastUsedAt)<TOUCH_EVERY)return;
 const used:ApiKey={...r.key,lastUsedAt:new Date(now).toISOString()};
 await database().prepare('UPDATE records SET data=? WHERE id=? AND owner=? AND json_extract(data,\'$.revokedAt\') IS NULL').bind(JSON.stringify(used),r.rowId,r.owner).run().catch(()=>console.error('api_key_touch_failed'));
}
// 키당 1분 60회(auth_rate_limits, 기존 인증 정리 주기가 지난 창을 지운다). 넘으면 429.
export async function apiKeyRate(keyId:string,now=Date.now()){
 const key=await hashToken('mcp-key:'+keyId),db=database();
 await db.prepare('INSERT INTO auth_rate_limits(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END').bind(key,now,now-RATE_WINDOW,now-RATE_WINDOW).run();
 const row=await db.prepare('SELECT count FROM auth_rate_limits WHERE key=?').bind(key).first<{count:number}>();
 if(!row||row.count>API_KEY_RATE_PER_MINUTE)throw new ApiError(429,M.rate);
}
// 호출 감사(kind api_call): 키 id·도구 이름·성공 여부·오류 분류·시각만. 입력·결과 본문(payload)은 남기지 않는다.
export type ApiCallAudit={keyId:string;tool:string;ok:boolean;error?:'tool_error'|'scope_denied'|'invalid_params'|'unknown_tool'|'internal'};
export function apiCallStatement(owner:string,audit:ApiCallAudit){
 const id=uid();
 return recordStatement(owner,'api_call',id,{id,keyId:audit.keyId,tool:audit.tool.slice(0,64),ok:audit.ok,...(audit.error?{error:audit.error}:{}),at:stamp()});
}
// MCP 도구가 쓰는 행위자. 키를 만든 사람의 역할(대표·관리자)을 쓰고, 이벤트에는 `api_key:<id>`로 남는다.
export const keyActor=(r:ResolvedKey):Actor=>({owner:r.owner,id:`api_key:${r.key.id}`,email:null,role:r.key.createdBy.role});
