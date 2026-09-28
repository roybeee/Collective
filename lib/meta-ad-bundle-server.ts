import {eligibleMetaImageReceipts} from './meta-image-upload-server';
import type {Campaign} from './agency';
import {metaReadiness} from './meta-ads';
import {metaCreativeContext,viewMetaCreative} from './meta-creative-server';
import {readMetaConnection} from './meta-read-connection';
import {readMetaWriteConnection} from './meta-write-connection';
import type {PausedCampaignOperation} from './meta-paused-journal';
import {optionalRecord} from './execution-server';
import {isEnabled} from './feature-flags';
import {storefrontDigest} from './storefront-orders';
import {ApiError,listRecords} from './server';
import type {MetaAdBundleInput,MetaAdBundleScope} from './meta-ad-bundle';
export type VerifiedMetaAdBundleScope=MetaAdBundleScope&{scopeDigest:string;verifiedAt:string};
export type MetaAdBundle={id:string;campaignId:string;brandId:string;campaignVersion:number;version:number;input:MetaAdBundleInput;evidenceFingerprint:string;status:'prepared'|'reviewed'|'verified'|'unknown';verifiedScope:VerifiedMetaAdBundleScope|null;reviewedBy:string|null;reviewedAt:string|null;updatedAt:string;updatedBy:string};
export async function metaAdBundleContext(owner:string,c:Campaign){
 const [creative,connection,writeConnection,operations,saved,enabled]=await Promise.all([metaCreativeContext(owner,c),readMetaConnection(owner,c.brandId),readMetaWriteConnection(owner,c.brandId),listRecords<PausedCampaignOperation>(owner,'meta_ads_write_operation',c.id),optionalRecord<MetaAdBundle>(owner,'meta_ads_bundle',c.id),isEnabled(owner,'meta_ads_bundle')]);
 const review=viewMetaCreative(c,creative,false),issues=[...metaReadiness(creative.plan,c.version).missing];
 if(!review.reviewValid)issues.push('현재 계획·근거·소재·실험의 검수');if(c.status==='archived')issues.push('보관되지 않은 캠페인');
 if(!connection?.readEnabled||connection.brandId!==c.brandId)issues.push('같은 브랜드의 읽기 연결');
 if(!writeConnection||writeConnection.brandId!==c.brandId||writeConnection.accountId!==connection?.accountId)issues.push('부모 캠페인과 같은 읽기·쓰기 계정');
 if(creative.plan?.input.goal!=='purchase')issues.push('구매 목적의 준비 계획');
 const parentFingerprint=await storefrontDigest({campaignVersion:c.version,plan:creative.plan,review:review.saved,connectionVersion:writeConnection?.version??0,accountId:writeConnection?.accountId??null});
 const parents=operations.filter(o=>o.campaignId===c.id&&o.brandId===c.brandId&&o.campaignVersion===c.version&&o.evidenceFingerprint===parentFingerprint&&o.draft.accountId===connection?.accountId&&o.receipt.accountId===connection?.accountId&&o.receipt.state==='paused_verified'&&o.receipt.externalId);
 if(!parents.length)issues.push('현재 검수와 일치하는 비활성 부모 캠페인');
 const evidenceFingerprint=await storefrontDigest({parentFingerprint,readConnectionVersion:connection?.version??0,readConnectionUpdatedAt:connection?.updatedAt??null,writeConnectionUpdatedAt:writeConnection?.updatedAt??null,review:review.saved,parents:parents.map(p=>({id:p.id,version:p.version,receipt:p.receipt}))});
 const imageReceipts=await eligibleMetaImageReceipts(owner,c);
 return {creative,review,connection,parents,saved,enabled,imageReceipts,issues:[...new Set(issues)],evidenceFingerprint};
}
export function metaAdBundleScope(c:Campaign,x:Awaited<ReturnType<typeof metaAdBundleContext>>,input:MetaAdBundleInput):MetaAdBundleScope{
 const p=x.parents.find(p=>p.id===input.operationId),plan=x.creative.plan?.input,review=x.review.saved?.input;
 if(x.issues.length||!p||!plan||!review||!x.connection||input.dailyBudgetKrw!==plan.dailyTarget)throw new ApiError(409,'현재 검수·부모 캠페인·원화 일별 목표와 패키지를 대조하세요.');
 const imageReceipt=input.imageUploadReceiptId?x.imageReceipts.find(r=>r.id===input.imageUploadReceiptId&&r.receipt?.metaImageHash===input.expectedMetaImageHash):null;
 if(input.imageUploadReceiptId&&!imageReceipt)throw new ApiError(409,'업로드 영수증과 현재 원본·계정·Meta 이미지 hash가 다릅니다.');
 return {...input,...(imageReceipt?{sourceBytesVerified:true,sourcePngHash:imageReceipt.pngHash}:{}),accountId:x.connection.accountId,campaignId:p.receipt.externalId!,landingUrl:plan.landingUrl,startAt:plan.startAt,endAt:plan.endAt,hook:review.hook,body:review.body,assetBytesVerified:false};
}
export async function viewMetaAdBundle(owner:string,c:Campaign,canEdit=false){
 const x=await metaAdBundleContext(owner,c),s=x.saved;let verifiedScope:VerifiedMetaAdBundleScope|null=null;
 const stale=!!s&&(s.campaignVersion!==c.version||s.evidenceFingerprint!==x.evidenceFingerprint||!!x.issues.length||!!s.input.imageUploadReceiptId&&!x.imageReceipts.some(r=>r.id===s.input.imageUploadReceiptId&&r.receipt?.metaImageHash===s.input.expectedMetaImageHash));
 if(s?.status==='verified'&&s.verifiedScope&&!stale&&x.enabled&&Date.now()-Date.parse(s.verifiedScope.verifiedAt)>=0&&Date.now()-Date.parse(s.verifiedScope.verifiedAt)<=15*60*1000){
  const scope=metaAdBundleScope(c,x,s.input),digest=await storefrontDigest({scope,evidenceFingerprint:x.evidenceFingerprint});
  if(s.verifiedScope.scopeDigest===digest)verifiedScope=s.verifiedScope;
 }
 return {imageReceipts:x.imageReceipts.map(r=>({id:r.id,pngHash:r.pngHash,metaImageHash:r.receipt!.metaImageHash})),saved:s,version:s?.version??0,campaignVersion:c.version,evidenceFingerprint:x.evidenceFingerprint,enabled:x.enabled,issues:x.issues,parents:x.parents.map(p=>({id:p.id,externalId:p.receipt.externalId,name:p.draft.name})),dailyBudgetKrw:x.creative.plan?.input.dailyTarget??null,landingUrl:x.creative.plan?.input.landingUrl??'',stale,verifiedScope,canEdit,canActivate:false as const};
}
export async function requireVerifiedMetaAdBundle(owner:string,c:Campaign){const v=await viewMetaAdBundle(owner,c);if(!v.verifiedScope)throw new ApiError(409,'현재 근거로 검토한 패키지를 15분 이내 다시 외부 조회하세요.');return v.verifiedScope}
