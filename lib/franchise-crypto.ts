// 가맹 리드 연락처 필드 암호화와 중복 키(R4b, 대표 결정 22). 서버 전용.
// 필드 값은 lib/server.ts encrypt(AES-GCM, AGENCY_ENCRYPTION_KEY)에 'v1.' 접두를 붙여 저장한다(키 회전 자리). 키가 없으면 503이고 평문을 저장하지 않는다.
// 중복 키는 AGENCY_ENCRYPTION_KEY에서 HKDF-SHA256(info collective:franchise-lead-key:v1)으로 파생한 HMAC 키로 만든다(새 환경변수 없음).
// 입력·출력 값을 로그·오류 문구·이벤트에 싣지 않는다. node:crypto 없이 Web Crypto만 쓴다(Workers·평가 런타임 공통).
import {ApiError,runtime,encrypt,decrypt} from './server';
import {FRANCHISE_ERRORS} from './franchise';

export function requireContactKey(){if(!runtime.AGENCY_ENCRYPTION_KEY)throw new ApiError(FRANCHISE_ERRORS.KEY_MISSING.status,FRANCHISE_ERRORS.KEY_MISSING.text)}
export async function sealField(value:string){requireContactKey();return 'v1.'+await encrypt(value)}
export async function openField(sealed:string){
 requireContactKey();
 if(typeof sealed!=='string'||!sealed.startsWith('v1.'))throw new ApiError(500,'연락처를 읽지 못했습니다.');
 try{return await decrypt(sealed.slice(3))}catch{throw new ApiError(500,'연락처를 읽지 못했습니다.')}
}
const utf8=(s:string)=>new TextEncoder().encode(s);
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
// 파생한 HMAC 키를 원 키 문자열의 SHA-256으로 찾는다(원 키를 Map 키로 두지 않는다). 파생이 실패하면 캐시하지 않는다.
const derived=new Map<string,Promise<CryptoKey>>();
async function hmacKey(){
 const raw=runtime.AGENCY_ENCRYPTION_KEY as string,id=hex(await crypto.subtle.digest('SHA-256',utf8(raw)));
 let key=derived.get(id);
 if(!key){
  key=(async()=>{
   const base=await crypto.subtle.importKey('raw',Uint8Array.from(atob(raw),c=>c.charCodeAt(0)),'HKDF',false,['deriveKey']);
   return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(0),info:utf8('collective:franchise-lead-key:v1')},base,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
  })();
  derived.set(id,key);
  key.catch(()=>derived.delete(id));
 }
 return key;
}
// 소유자·브랜드·유형·정규화 값의 HMAC(소문자 hex 64자). 소유자를 넣어 같은 브랜드 id를 쓰는 다른 워크스페이스 사이에서 같은 번호가 같은 키가 되지 않게 한다.
export async function leadKeyHmac(owner:string,brandId:string,type:'phone'|'email',normalized:string){
 requireContactKey();
 return hex(await crypto.subtle.sign('HMAC',await hmacKey(),utf8(owner+'\n'+brandId+'\n'+type+'\n'+normalized)));
}
