import {ApiError,runtime} from './server';

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
export function mediaUrl(input:string,hash:string){
 let url:URL;try{url=new URL(input)}catch{throw new ApiError(400,'공개 이미지 주소를 확인하세요.')}
 const allowed=url.hostname==='res.cloudinary.com'||/^[a-z0-9-]+\.r2\.dev$/.test(url.hostname);
 if(!allowed||url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/'+hash+'.png'))throw new ApiError(400,'Cloudinary 또는 R2 공개 주소에 PNG 해시 파일명을 사용하세요.');
 return url.href;
}
export async function verifyMedia(url:string,hash:string){
 mediaUrl(url,hash);
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
