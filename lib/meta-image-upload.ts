import {sha256,validatePng} from './execution-media';
import {metaId} from './meta-insights';
import {META_READ_API_VERSION} from './meta-insights-provider';
import {readBoundedJson} from './http-limits';
export type MetaImageReceipt={state:'uploaded'|'unknown';metaImageHash:string|null;sourceBytesVerified:boolean;displayBytesVerified:false;completedAt:string};
export type MetaImageJournal={begin:()=>Promise<boolean>;finish:(receipt:MetaImageReceipt)=>Promise<void>};
export class MetaImageError extends Error{constructor(public code:'invalid'|'unknown',message:string){super(message)}}
export async function uploadMetaImage(token:string,scope:{id:string;accountId:string;pngHash:string},bytes:Uint8Array,journal:MetaImageJournal,enabled=false){
 if(!enabled)throw new MetaImageError('invalid','Meta 이미지 업로드 기능이 꺼져 있습니다.');
 const accountId=metaId(scope.accountId,'광고 계정');if(!/^[a-f0-9]{64}$/.test(scope.id)||! /^[a-f0-9]{64}$/.test(scope.pngHash)||typeof token!=='string'||token.length<10||token.length>4096||! /^[A-Za-z0-9_.|\-]+$/.test(token))throw new MetaImageError('invalid','저장된 업로드 범위와 쓰기 연결을 확인하세요.');
 await validatePng(bytes);if(await sha256(bytes)!==scope.pngHash)throw new MetaImageError('invalid','보관된 PNG가 검수 원본 해시와 다릅니다.');
 const form=new URL('https://graph.facebook.com').searchParams;let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);form.set('bytes',btoa(binary));
 if(!await journal.begin())throw new MetaImageError('invalid','이미 전송한 이미지입니다. 전송 중·결과 미확인 작업을 다시 업로드하지 않습니다.');
 try{
  const response=await fetch(`https://graph.facebook.com/${META_READ_API_VERSION}/act_${accountId}/adimages`,{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,'content-type':'application/x-www-form-urlencoded'},body:form.toString(),signal:AbortSignal.timeout(20000)});
  const data=await readBoundedJson<{images?:Record<string,{hash?:unknown}>;error?:unknown}>(response,100000),images=data.images&&typeof data.images==='object'&&!Array.isArray(data.images)?Object.values(data.images):[];
  if(!response.ok||data.error||images.length!==1||typeof images[0]?.hash!=='string'||! /^[a-f0-9]{32}$/.test(images[0].hash))throw new Error('unconfirmed response');
  const receipt:MetaImageReceipt={state:'uploaded',metaImageHash:images[0].hash,sourceBytesVerified:true,displayBytesVerified:false,completedAt:new Date().toISOString()};await journal.finish(receipt);return receipt;
 }catch{
  try{await journal.finish({state:'unknown',metaImageHash:null,sourceBytesVerified:false,displayBytesVerified:false,completedAt:new Date().toISOString()})}catch{/* Durable sending remains unresolved; never retry POST. */}
  throw new MetaImageError('unknown','이미지 업로드 결과를 확정하지 못했습니다. 같은 작업을 다시 전송하지 말고 외부 계정에서 대조하세요.');
 }
}
