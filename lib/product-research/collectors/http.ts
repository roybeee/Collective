// 상품 리서치 수집기 공용 HTTP(한도 있는 fetch). 모든 자동 수집은 이 함수 하나로만 나간다.
// 1) 호출 직전 출처 레지스트리(assertAutoFetch)로 출처·호스트를 확인한다. manual·internal 출처와 등록 밖 호스트는 fetch 전에 막힌다.
// 2) 리디렉트는 따르지 않는다(redirect:'manual'). 고정 호스트 밖으로 끌려가는 경로를 없앤다.
// 3) 본문은 바이트 한도 안에서만 읽고(lib/http-limits.ts), 원문은 저장하지 않고 sha-256 해시·크기만 남긴다.
import {HttpBodyError,readBoundedText} from '../../http-limits';
import {assertAutoFetch} from '../sources';
import type {SourceId} from '../types';
import type {CollectDeps} from './index';

export type CollectorErrorCode='not_allowed'|'auth'|'quota'|'redirect'|'http'|'network'|'timeout'|'too_large'|'format'|'input';

// 워커·서버가 실패 사유를 문구가 아니라 종류(code)로 가르도록 한다. auth는 같은 키로 재시도해도 성공하지 않고, quota는 다음 쿼터 날짜까지 멈춘다.
export class CollectorError extends Error{
 constructor(public code:CollectorErrorCode,message:string,public status:number|null=null){super(message)}
}
export class CollectorAuthError extends CollectorError{constructor(message:string,status:number|null=null){super('auth',message,status)}}
export class CollectorQuotaError extends CollectorError{constructor(message:string,status:number|null=null){super('quota',message,status)}}

export type FetchOptions={label:string;maxBytes?:number;timeoutMs?:number};
export type FetchedJson={json:unknown;status:number;bodyBytes:number;bodyDigest:string;fetchedAt:string};

const DEFAULT_MAX_BYTES=1_000_000;
const DEFAULT_TIMEOUT_MS=20_000;
// 401·403 본문에서 쿼터 초과 사유만 찾는다. YouTube는 쿼터 초과를 403(quotaExceeded)으로 준다.
const ERROR_PEEK_BYTES=16_000;
const QUOTA_REASON=/quotaExceeded|rateLimitExceeded|dailyLimitExceeded|userRateLimitExceeded|Query limit exceeded/i;

export async function sha256Hex(input:string|Uint8Array<ArrayBuffer>):Promise<string>{
 const bytes=typeof input==='string'?new TextEncoder().encode(input):input;
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function discard(response:Response){await response.body?.cancel().catch(()=>undefined)}

async function peek(response:Response){
 try{return await readBoundedText(response,ERROR_PEEK_BYTES)}catch{return ''}
}

// url은 각 수집기의 고정 상수 + 인코딩한 쿼리로만 만든다. 사용자가 준 URL·호스트를 받는 경로는 없다.
export async function fetchSourceJson(sourceId:SourceId,url:string,init:RequestInit,deps:CollectDeps,options:FetchOptions):Promise<FetchedJson>{
 const {label}=options;
 let target:URL;
 try{target=new URL(url)}catch{throw new CollectorError('not_allowed',`${label} 주소 형식이 올바르지 않습니다.`)}
 if(target.protocol!=='https:')throw new CollectorError('not_allowed',`${label}은 https로만 호출합니다.`);
 try{assertAutoFetch(sourceId,target.host)}catch(error){throw new CollectorError('not_allowed',error instanceof Error?error.message:`${label} 자동 수집이 허용되지 않습니다.`)}
 // deps.fetch를 메서드로 부르지 않는다(Workers의 Illegal invocation 회피).
 const call=deps.fetch;
 let response:Response;
 try{
  response=await call(target.toString(),{...init,redirect:'manual',signal:AbortSignal.timeout(options.timeoutMs??DEFAULT_TIMEOUT_MS)});
 }catch(error){
  const name=(error as {name?:string}|null)?.name;
  if(name==='TimeoutError'||name==='AbortError')throw new CollectorError('timeout',`${label} 응답이 제한 시간 안에 오지 않았습니다. 잠시 후 다시 시도해 주세요.`);
  throw new CollectorError('network',`${label} 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.`);
 }
 const status=response.status;
 if(response.type==='opaqueredirect'||(status>=300&&status<400)){
  await discard(response);
  throw new CollectorError('redirect',`${label}이 다른 주소로 이동하라고 응답해 따르지 않았습니다 (${status}).`,status);
 }
 if(status===401||status===403){
  const text=await peek(response);
  if(QUOTA_REASON.test(text))throw new CollectorQuotaError(`${label} 하루 호출 한도를 넘었습니다. 쿼터가 초기화된 뒤 다시 시도합니다.`,status);
  throw new CollectorAuthError(`${label} 인증에 실패했습니다. 키와 권한(승인 상태)을 확인하세요.`,status);
 }
 if(status===429){
  await discard(response);
  throw new CollectorQuotaError(`${label} 호출 한도를 넘었습니다. 쿼터가 초기화된 뒤 다시 시도합니다.`,status);
 }
 if(!response.ok){
  await discard(response);
  throw new CollectorError('http',`${label} 요청을 처리하지 못했습니다 (${status}).`,status);
 }
 const maxBytes=options.maxBytes??DEFAULT_MAX_BYTES;
 let text:string;
 try{text=await readBoundedText(response,maxBytes)}catch(error){
  if(error instanceof HttpBodyError&&error.status===413)throw new CollectorError('too_large',`${label} 응답이 허용 크기(${Math.round(maxBytes/1000)}KB)를 넘어 읽지 않았습니다. 요청 범위를 줄여 주세요.`,status);
  throw new CollectorError('format',`${label} 응답을 끝까지 읽지 못했습니다.`,status);
 }
 // 해시·크기는 받은 본문 기준(UTF-8)이다. 원문은 여기서 버리고 해석한 값만 돌려준다.
 const bytes=new TextEncoder().encode(text);
 let json:unknown;
 try{json=JSON.parse(text)}catch{throw new CollectorError('format',`${label} 응답 형식이 올바르지 않습니다.`,status)}
 return {json,status,bodyBytes:bytes.byteLength,bodyDigest:await sha256Hex(bytes),fetchedAt:deps.now().toISOString()};
}

// ── 수집기 공용 해석 도우미 ──
// 유한한 0 이상 숫자만 값으로 본다. 그 밖(빈 값·문자열·음수)은 null(미확인)이다. 0으로 채우지 않는다.
export function nonNegative(value:unknown):number|null{
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
 if(typeof value==='string'&&/^\s*\d+(\.\d+)?\s*$/.test(value)){const n=Number(value);return Number.isFinite(n)?n:null}
 return null;
}
export function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
export function list(value:unknown):unknown[]{return Array.isArray(value)?value:[]}
export function text(value:unknown,max=300):string|null{
 if(typeof value!=='string')return null;
 const t=value.trim();
 return t?t.slice(0,max):null;
}
export function median(values:number[]):number|null{
 if(!values.length)return null;
 const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);
 return s.length%2?s[m]:(s[m-1]+s[m])/2;
}
// 제어 문자(줄바꿈·탭 포함). 정규식 대신 코드값으로 본다(no-control-regex).
export function hasControl(value:string):boolean{return [...value].some(c=>{const n=c.charCodeAt(0);return n<32||n===127})}
// 사용자 입력 키워드·검색어: 앞뒤 공백 제거, 1~max자, 제어 문자 금지.
export function keywordInput(value:unknown,label:string,max=100):string{
 if(typeof value!=='string'||!value.trim())inputError(`${label}을 입력하세요.`);
 const v=value.trim();
 if(v.length>max)inputError(`${label}은 ${max}자 이내로 입력하세요.`);
 if(hasControl(v))inputError(`${label}에 줄바꿈이나 제어 문자를 넣을 수 없습니다.`);
 return v;
}
// 입력 오류(키워드 수·기간 등)는 호출 전에 막는다. 쿼터를 쓰지 않는다.
export function inputError(message:string):never{throw new CollectorError('input',message)}
export function isoDay(value:unknown,label:string):string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))inputError(`${label}을 YYYY-MM-DD 형식으로 입력하세요.`);
 const t=Date.parse(`${value}T00:00:00Z`);
 if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==value)inputError(`${label}이 실제 날짜가 아닙니다.`);
 return value;
}
