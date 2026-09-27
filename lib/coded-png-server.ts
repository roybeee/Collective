// A4-4 코드 넣은 파생 PNG(서버). 승인된 원본 소재 PNG(pngHash)는 그대로 두고, 게시 코드가 있는 발행 초안에 코드 라벨을 그린 파생 PNG를 연결한다.
// 파생 PNG는 자기 해시로 비공개 저장(kind execution_coded_png)하고, 승인 때 앱 공개 주소(/media/<파생 해시>.png)로 제공한다(lib/execution-media.ts).
// 스위치 a4_png_code는 이 파일에서만 읽고 읽기 실패는 꺼짐이다(구조 규칙: execution-server.ts는 feature-flags를 직접 import하지 않는다).
// 서버는 이미지 안의 글자를 읽지 못한다. 크기(1080×1080)·PNG 픽셀 구조·원본과 다른 바이트·코드 일치만 확인하고, 그림 내용은 승인 때 사람이 확인한다(codedPngConfirmed).
import {ApiError,readRecord,recordStatement,database,stamp,str,uid,type Actor} from './server';
import type {Campaign} from './agency';
import type {CodedPng,ExecutionCreative,Publication} from './execution';
import {isEnabled} from './feature-flags';
import {discardPng,pngBytes,sha256,storePngThen} from './execution-media';

export type CodedPngRecord={id:string;publicationId:string;campaignId:string;creativeId:string;sourceHash:string;pngHash:string;objectKey:string;code:string;codeId:string;createdBy:string;createdAt:string};
export async function pngCodeEnabled(owner:string){try{return await isEnabled(owner,'a4_png_code')}catch{return false}}
const OFF='소재 PNG 게시 코드 기능(a4_png_code)이 꺼져 있습니다. 소유자가 기능 스위치에서 켜야 합니다.';
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
// 승인·접수 전 확인: 파생 PNG가 연결된 발행은 스위치가 켜져 있고, 파생의 바탕이 이 발행의 원본 소재 PNG·게시 코드와 같아야 한다. 연결이 없으면 스위치를 읽지 않는다.
export async function assertCodedPngUsable(owner:string,p:Publication){
 if(!p.codedPng)return;
 if(!await pngCodeEnabled(owner))throw new ApiError(409,OFF+' 코드 PNG가 연결된 발행은 이 발행을 취소하고 다시 준비하세요.');
 if(p.codedPng.sourceHash!==p.pngHash||p.codedPng.code!==p.trackingCode?.code||p.codedPng.codeId!==p.trackingCode?.id)throw new ApiError(409,'코드 PNG가 이 발행의 원본 소재·게시 코드와 다릅니다. 코드 넣은 PNG를 다시 만드세요.');
}
// 등록(관리자, owner 변경 잠금 안). currentCreative는 원본 소재가 지금도 발행에 쓸 수 있는지(사실 확정·입력 지문 일치) 확인해 돌려준다. 스위치를 먼저 본다.
export async function registerCodedPng(owner:string,campaign:Campaign,p:Publication,input:Record<string,unknown>,who:Pick<Actor,'id'>,currentCreative:()=>Promise<ExecutionCreative>){
 if(!await pngCodeEnabled(owner))throw new ApiError(409,OFF);
 if(p.status!=='draft')throw new ApiError(409,'승인 전 초안에만 코드 넣은 PNG를 연결할 수 있습니다. 재확인으로 초안에 되돌리거나 새로 준비하세요.');
 const code=p.trackingCode;
 if(!code)throw new ApiError(409,'게시 코드가 없는 발행입니다. 게시 코드를 골라 발행을 다시 준비하세요.');
 if(p.mediaMode!=='auto')throw new ApiError(409,'외부 호스트 발행에는 코드 넣은 PNG를 쓸 수 없습니다. 앱 공개 주소로 다시 준비하세요.');
 // 화면이 그린 코드가 이 발행에 발급한 코드인지 본다. 다른 발행(다른 지점·브랜드)의 코드는 400이다.
 if(str(input.code,'게시 코드',20)!==code.code)throw new ApiError(400,'이 발행에 발급한 게시 코드가 아닙니다. 다른 지점·브랜드의 코드는 넣을 수 없습니다.');
 const issued=await optional<{publicationId?:string;campaignId?:string;storeId?:string;code?:string}>(owner,'tracking_code',code.id);
 if(!issued||issued.code!==code.code||issued.publicationId!==p.id||issued.campaignId!==campaign.id||issued.storeId!==code.storeId)throw new ApiError(409,'게시 코드 발급 기록이 이 발행과 다릅니다. 새로고침 후 다시 준비하세요.');
 const creative=await currentCreative();
 if(creative.pngHash!==p.pngHash||creative.version!==p.creativeVersion)throw new ApiError(409,'소재가 변경됐습니다. 다시 준비하세요.');
 const bytes=await pngBytes(input.png),hash=await sha256(bytes);
 if(hash===p.pngHash)throw new ApiError(400,'원본 소재와 같은 PNG입니다. 게시 코드를 넣은 PNG를 올리세요.');
 if(p.codedPng?.hash===hash)return p;
 const old=await optional<CodedPngRecord>(owner,'execution_coded_png',p.id),at=stamp();
 const codedPng:CodedPng={hash,sourceHash:p.pngHash,code:code.code,codeId:code.id,registeredBy:who.id,registeredAt:at};
 const next:Publication={...p,codedPng,version:p.version+1,updatedAt:at};
 await storePngThen(owner,uid(),bytes,async objectKey=>{
  const record:CodedPngRecord={id:p.id,publicationId:p.id,campaignId:campaign.id,creativeId:p.creativeId,sourceHash:p.pngHash,pngHash:hash,objectKey,code:code.code,codeId:code.id,createdBy:who.id,createdAt:at};
  await database().batch([recordStatement(owner,'execution_coded_png',p.id,record,campaign.id),recordStatement(owner,'execution_publication',p.id,next,campaign.id)]);
 });
 // 초안이라 이전 파생 PNG는 공개되지 않았다(공개 사본은 승인 때 따로 만든다). 비공개 파일만 지운다.
 if(old?.objectKey)await discardPng(old.objectKey);
 return next;
}
// 화면 미리보기용 비공개 파일 키. 이 캠페인의 발행이 아니면 404다.
export async function codedPngObjectKey(owner:string,publicationId:string){
 const record=await readRecord<CodedPngRecord>(owner,'execution_coded_png',publicationId);
 await readRecord(owner,'campaign',record.campaignId);
 return record.objectKey;
}
