// 자격증명 암호문 형식과 키 목록(security-ops-6). 서버 전용 순수 모듈이다. 환경변수 값은 인자로 받고, ApiError는 lib/server.ts가 붙인다.
// 읽기: 옛 형식 'iv.data'(키 ID·AAD 없음)와 새 형식 'v1:<키 ID>:<iv>:<data>'(AAD 선택)를 모두 받는다.
// 쓰기: 옛 형식은 AGENCY_ENCRYPTION_KEY로 쓴다(이전 코드가 그 키 하나로 읽으므로 롤백해도 읽힌다). 새 형식은 현재 키(AGENCY_ENCRYPTION_KEYS 첫 값)로 쓴다.
// 키 ID는 키 바이트의 SHA-256(도메인 구분 접두) 앞 12자라 환경변수에 따로 적지 않는다. 키 값·평문·암호문을 오류 문구에 싣지 않는다.
export type KeyEnv={AGENCY_ENCRYPTION_KEY?:string;AGENCY_ENCRYPTION_KEYS?:string};
type Entry={kid:string;key:CryptoKey};
// current: 새 형식 쓰기 키. legacy: 옛 형식 쓰기 키(AGENCY_ENCRYPTION_KEY, 없으면 null). entries: 읽기 후보(AGENCY_ENCRYPTION_KEYS 순서, 그다음 AGENCY_ENCRYPTION_KEY).
export type KeyRing={current:Entry;legacy:Entry|null;entries:Entry[]};
export type Opened={plain:string;fresh:boolean};
export class KeyConfigError extends Error{}
// message는 사유 코드(format·unknown_key·mismatch)다. 사용자 문구는 lib/server.ts가 정한다.
export class UnreadableSecret extends Error{}

// AAD는 암호문이 놓인 자리다. records는 행 id 규칙(`${owner}:${kind}:${id}`)과 같고, settings는 소유자당 1행이라 고정 이름을 쓴다.
export const recordAad=(owner:string,kind:string,id:string)=>`${owner}:${kind}:${id}`;
// settings는 records kind가 아닌 별도 테이블이라 id 규칙 템플릿으로 쓰지 않는다(tests/record-kinds.test.mjs 스캐너).
export const settingsAad=(owner:string)=>[owner,'settings','connection'].join(':');

const utf8=(s:string)=>new TextEncoder().encode(s);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
type Bytes=Uint8Array<ArrayBuffer>;
const unb64=(s:string):Bytes=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const aadOf=(aad?:string)=>aad===undefined?{}:{additionalData:utf8(aad)};

// 이전 코드와 같은 해석(atob)으로 읽어 기존 AGENCY_ENCRYPTION_KEY 값의 허용 범위를 바꾸지 않는다.
function keyBytes(raw:string,label:string,sizes:number[]){
 let bytes:Bytes|null=null;
 try{bytes=unb64(raw.trim())}catch{bytes=null}
 if(!bytes||!sizes.includes(bytes.length))throw new KeyConfigError(`암호화 키 설정 오류: ${label} 값이 base64 32바이트 키가 아닙니다. openssl rand -base64 32로 만든 값을 넣으세요.`);
 return bytes;
}
async function entry(bytes:Bytes):Promise<Entry>{
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array([...utf8('collective:credential-key-id:v1\n'),...bytes])));
 const kid=Array.from(digest.slice(0,6),b=>b.toString(16).padStart(2,'0')).join('');
 return {kid,key:await crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt'])};
}
async function buildRing(env:KeyEnv):Promise<KeyRing|null>{
 const listed=(env.AGENCY_ENCRYPTION_KEYS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const entries:Entry[]=[];
 for(const [i,raw] of listed.entries()){
  const next=await entry(keyBytes(raw,`AGENCY_ENCRYPTION_KEYS ${i+1}번째`,[32]));
  if(!entries.some(e=>e.kid===next.kid))entries.push(next);
 }
 const legacy=env.AGENCY_ENCRYPTION_KEY?await entry(keyBytes(env.AGENCY_ENCRYPTION_KEY,'AGENCY_ENCRYPTION_KEY',[16,24,32])):null;
 const listedLegacy=legacy&&entries.find(e=>e.kid===legacy.kid);
 if(legacy&&!listedLegacy)entries.push(legacy);
 if(!entries.length)return null;
 return {current:entries[0],legacy:listedLegacy||legacy,entries};
}
// 환경변수 값이 같으면 가져온 키를 다시 쓴다. 값이 바뀌면(회전·테스트) 새로 만든다. 실패한 결과는 남기지 않는다.
let cached:{keys:string;key:string;ring:Promise<KeyRing|null>}|null=null;
export function keyRing(env:KeyEnv){
 const keys=env.AGENCY_ENCRYPTION_KEYS||'',key=env.AGENCY_ENCRYPTION_KEY||'';
 if(cached&&cached.keys===keys&&cached.key===key)return cached.ring;
 const ring=buildRing(env),slot={keys,key,ring};
 cached=slot;
 ring.catch(()=>{if(cached===slot)cached=null});
 return ring;
}

async function seal(key:CryptoKey,value:string,aad?:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,...aadOf(aad)},key,utf8(value)));
 return [b64(iv),b64(data)];
}
// 이전 코드와 같은 바이트 형식이다. AGENCY_ENCRYPTION_KEY가 없을 때만 현재 키를 쓴다.
export async function sealLegacy(ring:KeyRing,value:string){return (await seal((ring.legacy||ring.current).key,value)).join('.')}
export async function sealV1(ring:KeyRing,value:string,aad:string){return ['v1',ring.current.kid,...await seal(ring.current.key,value,aad)].join(':')}

async function tryOpen(key:CryptoKey,iv:Bytes,data:Bytes,aad?:string){
 try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,...aadOf(aad)},key,data))}catch{return null}
}
function decoded(iv:string|undefined,data:string|undefined){
 try{if(iv&&data)return {iv:unb64(iv),data:unb64(data)}}catch{}
 throw new UnreadableSecret('format');
}
// fresh: 현재 키로 쓴 새 형식이라 다시 쓸 필요가 없다. 옛 형식은 AAD 없이 AGENCY_ENCRYPTION_KEY부터 읽고, 맞지 않으면 나머지 키를 차례로 쓴다.
export async function openSecret(ring:KeyRing,value:string,aad?:string):Promise<Opened>{
 if(typeof value!=='string')throw new UnreadableSecret('format');
 if(value.startsWith('v1:')){
  const [,kid,iv,data,...rest]=value.split(':');
  const parts=decoded(rest.length?undefined:iv,data);
  const candidates=ring.entries.filter(e=>e.kid===kid);
  if(!candidates.length)throw new UnreadableSecret('unknown_key');
  for(const e of candidates){const plain=await tryOpen(e.key,parts.iv,parts.data,aad);if(plain!==null)return {plain,fresh:e.kid===ring.current.kid}}
  throw new UnreadableSecret('mismatch');
 }
 const [iv,data]=value.split('.'),parts=decoded(iv,data);
 const order=ring.legacy?[ring.legacy,...ring.entries.filter(e=>e!==ring.legacy)]:ring.entries;
 for(const e of order){const plain=await tryOpen(e.key,parts.iv,parts.data);if(plain!==null)return {plain,fresh:false}}
 throw new UnreadableSecret('mismatch');
}
