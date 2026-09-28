import type {Campaign} from './agency';
import type {ExecutionCreative} from './execution';
import {metaCreativeContext,viewMetaCreative} from './meta-creative-server';
import {readMetaConnection} from './meta-read-connection';
import {readMetaWriteConnection} from './meta-write-connection';
import {storefrontDigest} from './storefront-orders';
import {isEnabled} from './feature-flags';
import {ApiError,database,listRecords,readRecord,runtime,stamp} from './server';
import type {MetaImageJournal,MetaImageReceipt} from './meta-image-upload';
export type MetaImageUpload={id:string;campaignId:string;brandId:string;campaignVersion:number;creativeId:string;creativeVersion:number;pngHash:string;accountId:string;evidenceFingerprint:string;state:'prepared'|'sending'|'unknown'|'uploaded';receipt:MetaImageReceipt|null;version:number;createdAt:string;createdBy:string;sentAt:string|null;updatedAt:string;updatedBy:string};
export async function metaImageUploadContext(owner:string,c:Campaign){
 const [x,reading,writing,operations,enabled]=await Promise.all([metaCreativeContext(owner,c),readMetaConnection(owner,c.brandId),readMetaWriteConnection(owner,c.brandId),listRecords<MetaImageUpload>(owner,'meta_ads_image_upload',c.id),isEnabled(owner,'meta_ads_image_upload')]);
 const review=viewMetaCreative(c,x,false),creative=x.creatives.find(v=>v.id===review.saved?.input.creativeId),issues:string[]=[];
 if(!review.reviewValid||!creative?.current)issues.push('현재 원본 소재와 검수');if(c.status==='archived')issues.push('보관되지 않은 캠페인');
 if(!reading?.readEnabled||reading.brandId!==c.brandId||!writing||writing.brandId!==c.brandId||writing.accountId!==reading.accountId||writing.permission!=='ads_management')issues.push('같은 브랜드·계정의 읽기/별도 쓰기 연결');
 const evidenceFingerprint=await storefrontDigest({campaignVersion:c.version,review:review.saved,plan:x.plan,creative:creative?{id:creative.id,version:creative.version,pngHash:creative.pngHash}:null,reading,writing});
 return {review,creative,writing,reading,operations,enabled,issues,evidenceFingerprint};
}
export async function viewMetaImageUpload(owner:string,c:Campaign,canEdit=false){const x=await metaImageUploadContext(owner,c);return {campaignVersion:c.version,evidenceFingerprint:x.evidenceFingerprint,enabled:x.enabled,issues:x.issues,creative:x.creative?{id:x.creative.id,version:x.creative.version,pngHash:x.creative.pngHash}:null,accountId:x.writing?.accountId??null,operations:x.operations.map(o=>({...o,stale:o.evidenceFingerprint!==x.evidenceFingerprint||!!x.issues.length})),canEdit}}
export async function prepareMetaImageUpload(owner:string,c:Campaign,actorId:string,x:Awaited<ReturnType<typeof metaImageUploadContext>>){
 if(x.issues.length||!x.creative||!x.writing)throw new ApiError(409,'현재 검수·소재·계정을 확인하세요.');
 const id=await storefrontDigest({campaignId:c.id,brandId:c.brandId,creativeId:x.creative.id,pngHash:x.creative.pngHash,accountId:x.writing.accountId}),now=stamp();
 const o:MetaImageUpload={id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,creativeId:x.creative.id,creativeVersion:x.creative.version,pngHash:x.creative.pngHash,accountId:x.writing.accountId,evidenceFingerprint:x.evidenceFingerprint,state:'prepared',receipt:null,version:1,createdAt:now,createdBy:actorId,sentAt:null,updatedAt:now,updatedBy:actorId};
 await database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:meta_ads_image_upload:${id}`,owner,'meta_ads_image_upload',c.id,JSON.stringify(o),now).run();
 const old=await readRecord<MetaImageUpload>(owner,'meta_ads_image_upload',id);
 if(old.state==='prepared'&&old.sentAt===null&&old.evidenceFingerprint!==o.evidenceFingerprint){const next={...o,createdAt:old.createdAt,createdBy:old.createdBy,version:old.version+1};await database().prepare("UPDATE records SET data=?,updated_at=? WHERE owner=? AND kind='meta_ads_image_upload' AND id=? AND data=?").bind(JSON.stringify(next),now,owner,`${owner}:meta_ads_image_upload:${id}`,JSON.stringify(old)).run();}
 return readRecord<MetaImageUpload>(owner,'meta_ads_image_upload',id);
}
export async function metaImageSourceBytes(owner:string,c:Campaign,o:MetaImageUpload){
 const creative=await readRecord<ExecutionCreative>(owner,'execution_creative',o.creativeId);
 if(creative.campaignId!==c.id||creative.brandId!==c.brandId||creative.version!==o.creativeVersion||creative.pngHash!==o.pngHash||creative.campaignVersion!==c.version)throw new ApiError(409,'업로드할 원본 소재의 계보가 변경되었습니다.');
 const object=await runtime.BUCKET?.get(creative.objectKey);if(!object)throw new ApiError(404,'검수 원본 PNG를 찾을 수 없습니다.');if(object.size>524288)throw new ApiError(413,'PNG 크기 한도를 넘었습니다.');return new Uint8Array(await object.arrayBuffer());
}
export function metaImageUploadJournal(owner:string,id:string,actorId:string):MetaImageJournal{
 const read=()=>readRecord<MetaImageUpload>(owner,'meta_ads_image_upload',id);
 async function swap(old:MetaImageUpload,next:MetaImageUpload){return !!(await database().prepare("UPDATE records SET data=?,updated_at=? WHERE owner=? AND kind='meta_ads_image_upload' AND id=? AND data=?").bind(JSON.stringify(next),next.updatedAt,owner,`${owner}:meta_ads_image_upload:${id}`,JSON.stringify(old)).run()).meta.changes}
 return {async begin(){const o=await read();if(o.state!=='prepared')return false;const c=await readRecord<Campaign>(owner,'campaign',o.campaignId),x=await metaImageUploadContext(owner,c);if(!x.enabled||x.issues.length||x.evidenceFingerprint!==o.evidenceFingerprint)throw new ApiError(409,'전송 전에 검수·소재·계정이 변경되었습니다.');const now=stamp();return swap(o,{...o,state:'sending',sentAt:now,updatedAt:now,updatedBy:actorId,version:o.version+1})},async finish(receipt){const o=await read();if(o.state!=='sending')throw new ApiError(409,'전송 영수증은 변경하거나 다시 확정할 수 없습니다.');if(!await swap(o,{...o,state:receipt.state,receipt,updatedAt:stamp(),updatedBy:actorId,version:o.version+1}))throw new ApiError(409,'전송 상태가 변경되었습니다.');}};
}
// Completed source-byte provenance is immutable across token rotation; bundle read-back revalidates the current account/image reference.
export async function eligibleMetaImageReceipts(owner:string,c:Campaign){const x=await metaImageUploadContext(owner,c);if(x.issues.length||!x.creative||!x.writing)return [];return x.operations.filter(o=>o.state==='uploaded'&&o.receipt?.sourceBytesVerified===true&&o.receipt.metaImageHash&&o.campaignId===c.id&&o.brandId===c.brandId&&o.creativeId===x.creative!.id&&o.creativeVersion===x.creative!.version&&o.pngHash===x.creative!.pngHash&&o.accountId===x.writing!.accountId)}
