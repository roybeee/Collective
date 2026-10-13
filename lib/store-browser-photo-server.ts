import {ApiError,readRecord,recordStatement,runtime,stamp,str,uid} from './server';
import type {ArchiveSource} from './archive';
import type {Store} from './store-marketing';
import type {BrowserJob,BrowserPhoto,BrowserPhotoRights} from './store-browser';
const maxBytes=10*1024*1024;
const conflict=(message:string)=>{throw new ApiError(409,message)};
export async function photoBytes(owner:string,storeId:string,sourceId:string,sourceVersion:number){
 const store=await readRecord<Store>(owner,'store',storeId),source=await readRecord<ArchiveSource>(owner,'brand_source',sourceId);
 if(source.brandId!==store.brandId||(source.storeId&&source.storeId!==storeId)||source.status!=='confirmed'||source.version!==sourceVersion||!source.objectKey)conflict('사진 자료의 지점·확정 상태·판·원본 파일을 확인하세요.');
 if(!runtime.BUCKET)throw new ApiError(503,'파일 저장소에 연결하지 못했습니다.');
 const object=await runtime.BUCKET.get(source.objectKey!);if(!object)conflict('사진 원본 파일이 없습니다.');
 if(object!.size>maxBytes)throw new ApiError(400,'사진은 10MB 이하만 지원합니다.');
 const bytes=await object!.arrayBuffer(),b=new Uint8Array(bytes);
 if(!b.length||b.length>maxBytes)throw new ApiError(400,'사진 크기를 확인하세요.');
 const mime=b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b.length>=12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'?'image/webp':undefined;
 if(!mime)throw new ApiError(400,'PNG·JPEG·WebP 사진 원본만 지원합니다.');
 if(object!.httpMetadata?.contentType&&object!.httpMetadata.contentType!=='application/octet-stream'&&object!.httpMetadata.contentType!==mime)conflict('사진 원본 MIME과 바이트가 다릅니다.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 return {bytes,mime,size:b.length,sha256};
}
export async function savePhotoRights(owner:string,input:Record<string,unknown>){
 const storeId=str(input.storeId,'지점',100,true),sourceId=str(input.sourceId,'사진 자료',100,true);
 if(!Number.isInteger(input.sourceVersion)||Number(input.sourceVersion)<1)throw new ApiError(400,'자료 판을 확인하세요.');
 if(input.permission!=='owned'&&input.permission!=='licensed')throw new ApiError(400,'소유·사용 허락 근거를 선택하세요.');
 const validUntil=str(input.validUntil,'권리 만료일',50,true);if(!Number.isFinite(Date.parse(validUntil))||Date.parse(validUntil)<=Date.now())throw new ApiError(400,'미래의 권리 만료 시각을 입력하세요.');
 await photoBytes(owner,storeId,sourceId,Number(input.sourceVersion));
 const id=typeof input.rightsId==='string'?input.rightsId:uid();let prior:BrowserPhotoRights|undefined;
 if(input.rightsId){prior=await readRecord<BrowserPhotoRights>(owner,'store_browser_photo_rights',id);if(prior.storeId!==storeId||prior.version!==input.expectedVersion)conflict('권리 기록의 지점·판이 다릅니다.');}
 const rights:BrowserPhotoRights={status:'active',id,storeId,sourceId,sourceVersion:Number(input.sourceVersion),permission:input.permission,evidence:str(input.evidence,'권리 근거',3000,true),validUntil,channel:'naver_place',version:(prior?.version??0)+1,updatedAt:stamp()};
 await recordStatement(owner,'store_browser_photo_rights',id,rights,storeId).run();return {rights};
}
export async function approvedPhoto(owner:string,storeId:string,rightsId:string):Promise<BrowserPhoto>{
 const rights=await readRecord<BrowserPhotoRights>(owner,'store_browser_photo_rights',rightsId);
 if((rights.status!==undefined&&rights.status!=='active')||rights.storeId!==storeId||rights.channel!=='naver_place'||!['owned','licensed'].includes(rights.permission)||!rights.evidence||!Number.isFinite(Date.parse(rights.validUntil))||Date.parse(rights.validUntil)<=Date.now())conflict('사진 권리의 지점·채널·유효 기간을 확인하세요.');
 const asset=await photoBytes(owner,storeId,rights.sourceId,rights.sourceVersion);
 return {sourceId:rights.sourceId,sourceVersion:rights.sourceVersion,rightsId:rights.id,rightsVersion:rights.version,sha256:asset.sha256,mime:asset.mime,size:asset.size};
}
export async function revalidatePhoto(owner:string,job:BrowserJob){
 if(!job.photo)conflict('승인 사진이 없습니다.');const now=await approvedPhoto(owner,job.storeId,job.photo!.rightsId);
 if(JSON.stringify(now)!==JSON.stringify(job.photo))conflict('사진 원본·권리 판이 승인 이후 바뀌었습니다.');
 return photoBytes(owner,job.storeId,now.sourceId,now.sourceVersion);
}

// 권리 회수는 원본 삭제·지점 보관·기능 OFF와 무관하다. 이미 게시된 외부 사진은 삭제하지 않는다.
export async function revokePhotoRights(owner:string,input:Record<string,unknown>){
 const old=await readRecord<BrowserPhotoRights>(owner,'store_browser_photo_rights',str(input.rightsId,'사진 권리',100,true));
 if(input.expectedVersion!==old.version)conflict('권리 기록의 판이 바뀌었습니다. 새로고침하세요.');
 const rights:BrowserPhotoRights={...old,status:'revoked',version:old.version+1,updatedAt:stamp()};
 await recordStatement(owner,'store_browser_photo_rights',rights.id,rights,rights.storeId).run();return {rights};
}
