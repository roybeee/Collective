import {ApiError,runtime,database,readRecord,recordStatement,stamp} from './server';

export async function sha256(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),b=>b.toString(16).padStart(2,'0')).join('')}
export async function pngBytes(data:unknown){
 if(typeof data!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)||data.length>700000)throw new ApiError(400,'512KB 이하 PNG 파일로 저장하세요.');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(data.slice(22)),c=>c.charCodeAt(0))}catch{throw new ApiError(400,'PNG 파일을 읽지 못했습니다.')}
 await validatePng(bytes);return bytes;
}
export async function validatePng(bytes:Uint8Array){
 const signature=[137,80,78,71,13,10,26,10];
 const uint=(i:number)=>bytes[i]*16777216+bytes[i+1]*65536+bytes[i+2]*256+bytes[i+3];
 if(bytes.length<33||bytes.length>524288||signature.some((v,i)=>bytes[i]!==v)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR'||uint(16)!==1080||uint(20)!==1080)throw new ApiError(400,'1080×1080 PNG 카드가 필요합니다.');
 const invalid=()=>new ApiError(400,'PNG 픽셀 데이터를 확인하지 못했습니다. 카드를 다시 제작하세요.');
 if(uint(8)!==13||bytes[24]!==8||![2,6].includes(bytes[25])||bytes[26]||bytes[27]||bytes[28])throw invalid();
 const parts:Uint8Array[]=[];let offset=8,ended=false;
 while(offset<bytes.length){
  const size=uint(offset),end=offset+12+size;if(!Number.isSafeInteger(size)||end>bytes.length)throw invalid();
  const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));let crc=0xffffffff;
  for(let i=offset+4;i<end-4;i++){crc^=bytes[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  if(((crc^0xffffffff)>>>0)!==uint(end-4))throw invalid();
  if(type==='IHDR'&&offset!==8)throw invalid();
  if(type==='IDAT')parts.push(bytes.slice(offset+8,end-4));
  if(type==='IEND'){if(size!==0||end!==bytes.length)throw invalid();ended=true}
  offset=end;
 }
 if(!ended||!parts.length)throw invalid();
 const compressed=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let start=0;for(const p of parts){compressed.set(p,start);start+=p.length}
 const row=1+1080*(bytes[25]===6?4:3),expected=row*1080;let total=0;
 const reader=new Response(compressed).body!.pipeThrough(new DecompressionStream('deflate')).getReader();
 try{for(;;){const part=await reader.read();if(part.done)break;for(let i=0;i<part.value.length;i++)if((total+i)%row===0&&part.value[i]>4)throw invalid();total+=part.value.length;if(total>expected)throw invalid()}if(total!==expected)throw invalid()}
 catch{await reader.cancel().catch(()=>{});throw invalid()}finally{reader.releaseLock()}
}
// origin을 넘기면 앱 자체 공개 주소(/media/<sha256>.png)를 허용한다. Cloudinary·R2 외부 호스트는 고급 옵션으로 그대로 허용한다.
export function mediaUrl(input:string,hash:string,origin?:string){
 if(origin&&isOwnMediaUrl(input,origin)){const own=new URL(input);if(own.pathname!=='/media/'+hash+'.png')throw new ApiError(400,'앱 공개 주소의 파일명이 소재 PNG 해시와 다릅니다.');return own.origin+own.pathname}
 let url:URL;try{url=new URL(input)}catch{throw new ApiError(400,'공개 이미지 주소를 확인하세요.')}
 const allowed=url.hostname==='res.cloudinary.com'||/^[a-z0-9-]+\.r2\.dev$/.test(url.hostname);
 if(!allowed||url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/'+hash+'.png'))throw new ApiError(400,origin?'앱 공개 주소를 쓰거나, 고급 옵션으로 Cloudinary 또는 R2 공개 주소에 PNG 해시 파일명을 사용하세요.':'Cloudinary 또는 R2 공개 주소에 PNG 해시 파일명을 사용하세요.');
 return url.href;
}
// 앱 자체 주소는 자기 자신을 fetch하지 않고 R2 공개 객체의 해시를 확인한다.
export async function verifyMedia(url:string,hash:string,origin?:string){
 mediaUrl(url,hash,origin);
 if(origin&&isOwnMediaUrl(url,origin)){const object=await bucket().get(publicMediaKey(hash));if(!object)throw new ApiError(409,'앱 공개 PNG 파일이 없습니다. 발행을 다시 승인하세요.');await assertHash(object,hash,'앱 공개 파일이 승인할 원본 PNG와 다릅니다.');return}
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw new ApiError(409,'공개 PNG 파일을 읽을 수 없습니다.');
 const reader=response.body?.getReader();if(!reader)throw new ApiError(409,'이미지 본문이 없습니다.');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>524288){await reader.cancel();throw new ApiError(413,'이미지가 너무 큽니다.')}chunks.push(r.value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 await validatePng(bytes);if(await sha256(bytes)!==hash)throw new ApiError(409,'공개 이미지가 승인할 원본 PNG와 다릅니다.');
}
export async function storePng(owner:string,id:string,bytes:Uint8Array){
 if(!runtime.BUCKET)throw new ApiError(503,'소재 파일 저장소가 연결되지 않았습니다.');
 const key='execution/'+await sha256(new TextEncoder().encode(owner))+'/'+id+'.png';
 await runtime.BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/png'}});return key;
}
// exec-loop-12: 비공개 PNG를 먼저 저장하고 레코드 저장(save)이 실패하면 방금 쓴 객체를 지워 R2 고아 파일을 남기지 않는다.
// id는 새로 만든 uid여야 한다. 지우는 키를 다른 레코드가 참조하지 않는다는 전제다.
export async function storePngThen<T>(owner:string,id:string,bytes:Uint8Array,save:(objectKey:string)=>Promise<T>):Promise<T>{
 const objectKey=await storePng(owner,id,bytes);
 try{return await save(objectKey)}catch(e){await removeObject(objectKey);throw e}
}

// 앱 자체 공개 미디어: 승인된 발행이 참조하는 PNG만 /media/<sha256>.png로 인증 없이 제공한다.
// 키는 내용 해시라 추측할 수 없고 내용이 바뀌지 않는다. 참조는 owner별 records(kind public_media, id·parent_id=해시)에 둔다.
// 공개 객체는 같은 PNG를 게시한 워크스페이스끼리 공유하고, 모든 owner의 참조가 0이 될 때 지운다. 호출은 owner 변경 잠금 안에서 한다.
export type PublicMedia={owner:string;publicationIds:string[];createdAt:string};
const HASH=/^[0-9a-f]{64}$/,OWN_PATH=/^\/media\/[0-9a-f]{64}\.png$/;
// 제공 대상 발행 상태. 참조가 남아 있어도 발행이 이 상태가 아니면 제공하지 않는다(fail-closed, SEC-1).
const SERVED="'approved','submitting','uncertain','accepted','blocked','published'";
// 공개 라우트용 참조 행(SEC-2): owner 없는 판정 조회가 (owner,parent_id) 인덱스를 타도록 빈 owner 아래 해시별 행을 둔다.
// identity()는 빈 owner를 돌려주지 않으므로 사용자 레코드와 섞이지 않는다.
const REF_OWNER='';
const refId=(hash:string,owner:string)=>hash+':'+owner;
const refStatement=(owner:string,hash:string)=>recordStatement(REF_OWNER,'public_media_ref',refId(hash,owner),{owner},hash);
const dropRefStatement=(owner:string,hash:string)=>database().prepare("DELETE FROM records WHERE owner=? AND kind='public_media_ref' AND id=?").bind(REF_OWNER,`${REF_OWNER}:public_media_ref:${refId(hash,owner)}`);
export const publicMediaKey=(hash:string)=>'public/'+hash+'.png';
function bucket(){if(!runtime.BUCKET)throw new ApiError(503,'소재 파일 저장소가 연결되지 않았습니다.');return runtime.BUCKET}
function mediaHash(value:string){if(typeof value!=='string'||!HASH.test(value))throw new ApiError(400,'PNG 해시를 확인하세요.');return value}
function appOrigin(origin:string){
 const invalid=()=>new ApiError(503,'앱 공개 주소를 확인하지 못했습니다. 관리자에게 문의하세요.');
 let url:URL;try{url=new URL(origin)}catch{throw invalid()}
 const local=process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if((url.protocol!=='https:'&&!local)||url.username||url.password)throw invalid();return url.origin;
}
async function assertHash(object:R2ObjectBody,hash:string,message:string){if(await sha256(new Uint8Array(await object.arrayBuffer()))!==hash)throw new ApiError(409,message)}
async function removeObject(key:string){try{await runtime.BUCKET?.delete(key)}catch(e){console.error('execution_media_cleanup_failed',e instanceof Error?e.message:'unknown')}}
async function ownPublicMedia(owner:string,hash:string){try{return await readRecord<PublicMedia>(owner,'public_media',hash)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function creativeObjectKey(owner:string,hash:string){
 const row=await database().prepare("SELECT json_extract(data,'$.objectKey') AS objectKey FROM records WHERE owner=? AND kind='execution_creative' AND json_extract(data,'$.pngHash')=? AND json_extract(data,'$.objectKey')<>'' ORDER BY updated_at DESC LIMIT 1").bind(owner,hash).first<{objectKey:string}>();
 if(!row?.objectKey)throw new ApiError(404,'원본 소재 파일을 찾을 수 없습니다.');return row.objectKey;
}
export function isOwnMediaUrl(url:string,origin:string){try{const u=new URL(url),o=new URL(origin);return o.origin!=='null'&&u.origin===o.origin&&!u.username&&!u.password&&!u.search&&!u.hash&&OWN_PATH.test(u.pathname)}catch{return false}}
// 어느 owner든 제공 대상 상태의 발행이 참조하면 제공한다. 참조 행 → owner 참조 레코드 → 발행 레코드를 인덱스·기본 키로만 찾는다.
// 공개 라우트는 R2 객체가 있을 때만 부른다.
export async function isPublicMediaServed(hash:string){
 if(!HASH.test(hash))return false;
 return !!await database().prepare(`SELECT 1 AS served FROM records r JOIN records m ON m.id=json_extract(r.data,'$.owner')||':public_media:'||r.parent_id AND m.owner=json_extract(r.data,'$.owner') AND m.kind='public_media' JOIN json_each(m.data,'$.publicationIds') j JOIN records p ON p.id=m.owner||':execution_publication:'||j.value AND p.owner=m.owner AND p.kind='execution_publication' WHERE r.owner=? AND r.kind='public_media_ref' AND r.parent_id=? AND json_extract(p.data,'$.status') IN (${SERVED}) LIMIT 1`).bind(REF_OWNER,hash).first();
}
// 이 owner의 참조 중 아직 제공 대상 상태인 발행 id.
async function servedPublicationIds(owner:string,hash:string){
 const rows=await database().prepare(`SELECT j.value AS id FROM records m JOIN json_each(m.data,'$.publicationIds') j JOIN records p ON p.id=m.owner||':execution_publication:'||j.value AND p.owner=m.owner AND p.kind='execution_publication' WHERE m.id=? AND m.owner=? AND m.kind='public_media' AND json_extract(p.data,'$.status') IN (${SERVED})`).bind(`${owner}:public_media:${hash}`,owner).all<{id:string}>();
 return new Set(rows.results.map(r=>String(r.id)));
}
export async function publishPublicMedia(owner:string,pngHash:string,publicationId:string,origin:string):Promise<string>{
 const hash=mediaHash(pngHash),base=appOrigin(origin),store=bucket();
 if(typeof publicationId!=='string'||!publicationId||publicationId.length>100)throw new ApiError(400,'발행을 확인하세요.');
 const sourceKey=await creativeObjectKey(owner,hash),key=publicMediaKey(hash),existing=await store.get(key);
 let created=false;
 if(existing)await assertHash(existing,hash,'앱 공개 파일이 원본 PNG와 다릅니다. 관리자에게 문의하세요.');
 else{
  const source=await store.get(sourceKey);if(!source)throw new ApiError(404,'원본 소재 파일을 찾을 수 없습니다.');
  const bytes=new Uint8Array(await source.arrayBuffer());if(await sha256(bytes)!==hash)throw new ApiError(409,'저장된 소재 파일이 원본 해시와 다릅니다. 소재를 다시 만들어 주세요.');
  await store.put(key,bytes,{httpMetadata:{contentType:'image/png'}});created=true;
 }
 try{
  const old=await ownPublicMedia(owner,hash),listed=!!old?.publicationIds.includes(publicationId);
  await database().batch([...(listed?[]:[recordStatement(owner,'public_media',hash,{owner,publicationIds:[...(old?.publicationIds||[]),publicationId],createdAt:old?.createdAt||stamp()} satisfies PublicMedia,hash)]),refStatement(owner,hash)]);
 }catch(e){if(created)await removeObject(key);throw e}
 return `${base}/media/${hash}.png`;
}
// 참조를 먼저 지우고, 어느 owner도 제공 대상 발행으로 참조하지 않으면 공개 객체를 지운다. 삭제 실패는 기록만 한다(발행 상태가 이미 제공을 막는다).
// 이 발행과 함께, 이전 해제가 실패해 제공 대상이 아닌 상태로 남은 참조도 정리한다(SEC-1).
export async function retirePublicMedia(owner:string,pngHash:string,publicationId:string):Promise<void>{
 const hash=mediaHash(pngHash),old=await ownPublicMedia(owner,hash);if(!old)return;
 const live=await servedPublicationIds(owner,hash),publicationIds=old.publicationIds.filter(id=>id!==publicationId&&live.has(id));
 if(publicationIds.length!==old.publicationIds.length)await database().batch([recordStatement(owner,'public_media',hash,{...old,publicationIds},hash),...(publicationIds.length?[]:[dropRefStatement(owner,hash)])]);
 if(publicationIds.length||await isPublicMediaServed(hash))return;
 await removeObject(publicMediaKey(hash));
}
