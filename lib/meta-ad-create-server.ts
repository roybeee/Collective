import type {Campaign} from './agency';
import {metaAdBundleContext} from './meta-ad-bundle-server';
import {metaImageUploadContext} from './meta-image-upload-server';
import {parseMetaAdBundle,type MetaAdBundleInput} from './meta-ad-bundle';
import {emptyMetaCreateSteps,metaCreateStepNames,type MetaCreateJournal,type MetaCreateScope,type MetaCreateSteps,type MetaCreateStep,type MetaCreateStepState} from './meta-ad-create';
import {ApiError,database,readRecord,stamp} from './server';
import {optionalRecord} from './execution-server';
import {storefrontDigest} from './storefront-orders';
import {isEnabled} from './feature-flags';
export type MetaCreateInput=Pick<MetaAdBundleInput,'operationId'|'imageUploadReceiptId'|'pageId'|'pixelId'|'graphDailyBudget'|'budgetUnitEvidence'|'ageMin'|'ageMax'|'callToActionType'>;
export type MetaCreateOperation={id:string;campaignId:string;brandId:string;input:MetaCreateInput;scope:MetaCreateScope;evidenceFingerprint:string;steps:MetaCreateSteps;version:number;createdAt:string;createdBy:string;updatedAt:string;updatedBy:string};
export async function metaCreateContext(owner:string,c:Campaign){
 const [bundle,image,saved,enabled]=await Promise.all([metaAdBundleContext(owner,c),metaImageUploadContext(owner,c),optionalRecord<MetaCreateOperation>(owner,'meta_ads_child_create',c.id),isEnabled(owner,'meta_ads_child_create')]);
 const issues=[...bundle.issues,...image.issues];if(!bundle.imageReceipts.length)issues.push('현재 검수 원본 PNG 업로드 영수증');
 const evidenceFingerprint=await storefrontDigest({bundle:bundle.evidenceFingerprint,image:image.evidenceFingerprint});return {bundle,image,saved,enabled,issues:[...new Set(issues)],evidenceFingerprint};
}
function inputObject(raw:unknown){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiError(400,'생성 구성을 확인하세요.');const value=raw as Record<string,unknown>,allowed=['operationId','imageUploadReceiptId','pageId','pixelId','graphDailyBudget','budgetUnitEvidence','ageMin','ageMax','callToActionType'];if(Object.keys(value).some(k=>!allowed.includes(k)))throw new ApiError(400,'허용하지 않는 생성 설정입니다.');return value}
export async function prepareMetaCreate(owner:string,c:Campaign,raw:unknown,actorId:string,x:Awaited<ReturnType<typeof metaCreateContext>>){
 if(x.issues.length||!x.image.writing)throw new ApiError(409,'현재 검수·계정·부모·원본 업로드를 확인하세요.');
 if(x.saved&&metaCreateStepNames.some(k=>x.saved!.steps[k].state!=='prepared'))throw new ApiError(409,'이미 전송을 시작한 캠페인은 새 작업으로 재생성하지 않습니다. 기존 ID를 대조하세요.');
 const value=inputObject(raw),parent=x.bundle.parents.find(p=>p.id===value.operationId),receipt=x.bundle.imageReceipts.find(r=>r.id===value.imageUploadReceiptId),plan=x.bundle.creative.plan?.input,review=x.bundle.review.saved?.input;
 if(!parent||!receipt||!plan||!review)throw new ApiError(409,'현재 부모 캠페인과 원본 업로드 영수증을 선택하세요.');
 const parsed=parseMetaAdBundle({...value,adsetId:'1',creativeId:'1',adId:'1',country:'KR',dailyBudgetKrw:plan.dailyTarget,expectedMetaImageHash:receipt.receipt!.metaImageHash}),input:MetaCreateInput={operationId:parsed.operationId,imageUploadReceiptId:parsed.imageUploadReceiptId,pageId:parsed.pageId,pixelId:parsed.pixelId,graphDailyBudget:parsed.graphDailyBudget,budgetUnitEvidence:parsed.budgetUnitEvidence,ageMin:parsed.ageMin,ageMax:parsed.ageMax,callToActionType:parsed.callToActionType};
 const scope:MetaCreateScope={id:await storefrontDigest({owner,campaignId:c.id,brandId:c.brandId}),bundle:{...parsed,adsetId:'',creativeId:'',adId:'',accountId:x.image.writing.accountId,campaignId:parent.receipt.externalId!,landingUrl:plan.landingUrl,startAt:plan.startAt,endAt:plan.endAt,hook:review.hook,body:review.body,assetBytesVerified:false,sourceBytesVerified:true,sourcePngHash:receipt.pngHash}},now=stamp();
 const next:MetaCreateOperation={id:c.id,campaignId:c.id,brandId:c.brandId,input,scope,evidenceFingerprint:x.evidenceFingerprint,steps:emptyMetaCreateSteps(),version:(x.saved?.version??0)+1,createdAt:x.saved?.createdAt??now,createdBy:x.saved?.createdBy??actorId,updatedAt:now,updatedBy:actorId};
 if(x.saved){if(!await swap(owner,x.saved,next))throw new ApiError(409,'생성 작업이 변경되었습니다.');}else{const result=await database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:meta_ads_child_create:${c.id}`,owner,'meta_ads_child_create',c.id,JSON.stringify(next),now).run();if(!result.meta.changes)throw new ApiError(409,'생성 작업이 이미 준비되었습니다.');}return next;
}
async function swap(owner:string,old:MetaCreateOperation,next:MetaCreateOperation){return !!(await database().prepare("UPDATE records SET data=?,updated_at=? WHERE owner=? AND kind='meta_ads_child_create' AND id=? AND data=?").bind(JSON.stringify(next),next.updatedAt,owner,`${owner}:meta_ads_child_create:${old.id}`,JSON.stringify(old)).run()).meta.changes}
export function metaCreateJournal(owner:string,id:string,actorId:string):MetaCreateJournal{
 const read=()=>readRecord<MetaCreateOperation>(owner,'meta_ads_child_create',id);
 async function change(o:MetaCreateOperation,step:MetaCreateStep,value:MetaCreateStepState){return swap(owner,o,{...o,steps:{...o.steps,[step]:value},version:o.version+1,updatedAt:stamp(),updatedBy:actorId})}
 return {async begin(step){const o=await read();if(o.steps[step].state!=='prepared'||metaCreateStepNames.slice(0,metaCreateStepNames.indexOf(step)).some(k=>o.steps[k].state!=='verified'))return false;const c=await readRecord<Campaign>(owner,'campaign',o.campaignId),x=await metaCreateContext(owner,c);if(!x.enabled||x.issues.length||x.evidenceFingerprint!==o.evidenceFingerprint)throw new ApiError(409,'전송 직전 검수·토큰·범위가 변경되었습니다.');return change(o,step,{state:'sending',externalId:null,verifiedAt:null})},async record(step,value){const o=await read(),old=o.steps[step];if(!['sending','unknown'].includes(old.state)||!['unknown','verified'].includes(value.state)||old.externalId&&old.externalId!==value.externalId||value.state==='verified'&&(!value.externalId||!value.verifiedAt))throw new ApiError(409,'단계 영수증을 변경하거나 되돌릴 수 없습니다.');if(!await change(o,step,value))throw new ApiError(409,'단계 상태가 변경되었습니다.');}};
}
export async function viewMetaCreate(owner:string,c:Campaign,canEdit=false){const x=await metaCreateContext(owner,c);return {saved:x.saved,version:x.saved?.version??0,campaignVersion:c.version,evidenceFingerprint:x.evidenceFingerprint,enabled:x.enabled,issues:x.issues,parents:x.bundle.parents.map(p=>({id:p.id,externalId:p.receipt.externalId})),images:x.bundle.imageReceipts.map(r=>({id:r.id,metaImageHash:r.receipt!.metaImageHash})),stale:!!x.saved&&x.saved.evidenceFingerprint!==x.evidenceFingerprint,canEdit,canActivate:false}}
