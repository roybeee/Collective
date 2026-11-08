// C2 AI 생성 이미지 표시(AI 기본법 제31조, docs/AI-DISCLOSURE.ko.md 9절). 순수 함수만 둔다(서버·화면·테스트 공용, 의존성 없음).
// 반출되는 PNG에 기계판독 메타데이터(iTXt 청크, 키워드 ai-disclosure, JSON 본문)를 IEND 앞에 넣는다. 픽셀(IHDR·IDAT)은 바꾸지 않는다.
// 가시 표시 줄은 서버가 글자를 그릴 수 없어 화면 경로(lib/creative-render.ts renderDisclosedCard)로 따로 둔다.
// 입력 바이트는 수정하지 않고 항상 새 Uint8Array를 돌려준다.

export const AI_IMAGE_DISCLOSURE_KEYWORD='ai-disclosure';
export const AI_IMAGE_POLICY='KR-AI-Basic-Act-31';
export const AI_IMAGE_GENERATOR='COLLECTIVE';
// 가시 표시 줄 문구(화면 경로가 그린다). 표시 문구는 대표·법률 검토 전 초안이다(결정 17과 같은 절차로 확정한다).
export const AI_IMAGE_VISIBLE_LABEL='AI 생성 · COLLECTIVE';
export const VIRTUAL_PERSON_IMAGE_LABEL='가상인물';

export type ImageOrigin='ai'|'ai_edited'|'manual'|'unknown';
export type ImageDisclosure={origin:'ai'|'ai_edited';generator:typeof AI_IMAGE_GENERATOR;model?:string;createdAt:string;policy:typeof AI_IMAGE_POLICY;virtualPerson:boolean};
export type PngChunk={type:string;offset:number;length:number;data:Uint8Array};
export type ImageDisclosurePlan='off'|'mark'|'skip_manual'|'warn_unknown';

const SIGNATURE=[137,80,78,71,13,10,26,10];
const CRC_TABLE=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0}return table})();

// PNG 청크 CRC-32(ISO 3309, 청크 종류 4바이트+데이터).
export function crc32(bytes:Uint8Array,start=0,end=bytes.length):number{
 let crc=0xffffffff;
 for(let i=start;i<end;i++)crc=CRC_TABLE[(crc^bytes[i])&0xff]^(crc>>>8);
 return (crc^0xffffffff)>>>0;
}
const readUint32=(bytes:Uint8Array,at:number)=>((bytes[at]<<24)|(bytes[at+1]<<16)|(bytes[at+2]<<8)|bytes[at+3])>>>0;
function writeUint32(value:number):Uint8Array{return new Uint8Array([(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255])}
const ascii=(bytes:Uint8Array,at:number,size:number)=>String.fromCharCode(...bytes.subarray(at,at+size));
function concat(parts:readonly Uint8Array[]):Uint8Array{
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
 parts.reduce((at,p)=>{out.set(p,at);return at+p.length},0);
 return out;
}
export function isPngSignature(bytes:Uint8Array):boolean{return bytes.length>=8&&SIGNATURE.every((v,i)=>bytes[i]===v)}

// 청크 배열로 읽는다. 서명·길이·CRC·IHDR 첫 자리·IEND 끝 자리를 확인하고 틀리면 Error를 던진다(PNG가 아니면 표시를 넣지 않는다).
export function pngChunks(bytes:Uint8Array):PngChunk[]{
 if(!isPngSignature(bytes))throw new Error('PNG 서명이 아닙니다.');
 const chunks:PngChunk[]=[];
 let offset=8;
 while(offset<bytes.length){
  if(offset+12>bytes.length)throw new Error('PNG 청크 길이가 잘렸습니다.');
  const length=readUint32(bytes,offset),end=offset+12+length;
  if(end>bytes.length)throw new Error('PNG 청크가 파일 끝을 넘습니다.');
  const type=ascii(bytes,offset+4,4);
  if(!/^[A-Za-z]{4}$/.test(type))throw new Error('PNG 청크 종류를 읽지 못했습니다.');
  if(crc32(bytes,offset+4,end-4)!==readUint32(bytes,end-4))throw new Error(`PNG 청크 ${type}의 CRC가 틀립니다.`);
  chunks.push({type,offset,length,data:bytes.slice(offset+8,end-4)});
  offset=end;
 }
 if(chunks[0]?.type!=='IHDR')throw new Error('PNG 첫 청크가 IHDR가 아닙니다.');
 if(chunks[chunks.length-1]?.type!=='IEND')throw new Error('PNG 마지막 청크가 IEND가 아닙니다.');
 return chunks;
}
export function encodeChunk(type:string,data:Uint8Array):Uint8Array{
 if(!/^[A-Za-z]{4}$/.test(type))throw new Error('PNG 청크 종류는 영문 4자다.');
 const body=concat([new Uint8Array(Array.from(type,c=>c.charCodeAt(0))),data]);
 return concat([writeUint32(data.length),body,writeUint32(crc32(body))]);
}
// iTXt 본문: 키워드\0 압축플래그(0) 압축방법(0) 언어태그\0 번역키워드\0 UTF-8 본문. 압축하지 않는다(짧은 JSON, 의존성 없음).
export function encodeITXt(keyword:string,text:string):Uint8Array{
 if(!/^[\x20-\x7e]{1,79}$/.test(keyword))throw new Error('iTXt 키워드는 1~79자 Latin-1 인쇄 문자다.');
 const enc=new TextEncoder();
 return concat([enc.encode(keyword),new Uint8Array([0,0,0,0,0]),enc.encode(text)]);
}
export function decodeITXt(data:Uint8Array):{keyword:string;text:string}|null{
 const keywordEnd=data.indexOf(0);
 if(keywordEnd<1||keywordEnd>79)return null;
 const compressed=data[keywordEnd+1];
 let at=keywordEnd+3;
 const language=data.indexOf(0,at);if(language<0)return null;at=language+1;
 const translated=data.indexOf(0,at);if(translated<0)return null;at=translated+1;
 if(compressed!==0)return null;
 return {keyword:ascii(data,0,keywordEnd),text:new TextDecoder().decode(data.subarray(at))};
}
const isDisclosureChunk=(c:PngChunk)=>c.type==='iTXt'&&decodeITXt(c.data)?.keyword===AI_IMAGE_DISCLOSURE_KEYWORD;

export function disclosurePayload(input:{origin:'ai'|'ai_edited';model?:string;createdAt:string;virtualPerson?:boolean}):ImageDisclosure{
 return {origin:input.origin,generator:AI_IMAGE_GENERATOR,...(input.model?{model:input.model}:{}),createdAt:input.createdAt,policy:AI_IMAGE_POLICY,virtualPerson:input.virtualPerson===true};
}
// 표시 청크를 IEND 앞에 넣은 새 PNG. 이미 있는 ai-disclosure 청크는 하나로 교체한다. 같은 바이트·같은 payload면 결과도 같다(해시 결정론).
export function addDisclosureChunk(bytes:Uint8Array,disclosure:ImageDisclosure):Uint8Array{
 const chunks=pngChunks(bytes).filter(c=>!isDisclosureChunk(c));
 const marker=encodeChunk('iTXt',encodeITXt(AI_IMAGE_DISCLOSURE_KEYWORD,JSON.stringify(disclosure)));
 const kept=chunks.map(c=>bytes.slice(c.offset,c.offset+12+c.length));
 return concat([bytes.slice(0,8),...kept.slice(0,-1),marker,kept[kept.length-1]]);
}
function validDisclosure(value:unknown):value is ImageDisclosure{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return (v.origin==='ai'||v.origin==='ai_edited')&&v.generator===AI_IMAGE_GENERATOR&&v.policy===AI_IMAGE_POLICY&&typeof v.createdAt==='string'&&typeof v.virtualPerson==='boolean'&&(v.model===undefined||typeof v.model==='string');
}
// 검증·테스트용 읽기. 표시 청크가 없거나 본문이 규격과 다르면 null이다. PNG가 아니면 Error다.
export function readDisclosureChunk(bytes:Uint8Array):ImageDisclosure|null{
 const chunk=pngChunks(bytes).find(isDisclosureChunk);
 if(!chunk)return null;
 try{const parsed:unknown=JSON.parse(decodeITXt(chunk.data)!.text);return validDisclosure(parsed)?parsed:null}catch{return null}
}
export function normalizeImageOrigin(value:unknown):ImageOrigin{return value==='ai'||value==='ai_edited'||value==='manual'?value:'unknown'}
// 스위치·출처로 할 일을 정한다. 꺼짐이면 아무것도 하지 않는다(바이트 불변). 출처 불명은 표시하지 않고 막지도 않으며 경고 기록만 남긴다(캡션 규칙과 같은 태도).
export function imageDisclosurePlan(origin:ImageOrigin,enabled:boolean):ImageDisclosurePlan{
 if(!enabled)return 'off';
 if(origin==='ai'||origin==='ai_edited')return 'mark';
 return origin==='manual'?'skip_manual':'warn_unknown';
}
export async function sha256Hex(bytes:Uint8Array):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
