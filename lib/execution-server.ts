import {ApiError,readRecord,listRecords,recordStatement,stamp,uid,str,num,encrypt,decrypt} from './server';
import type {Campaign} from './agency';
import {confirmedFactContext} from './brand-facts-server';
import type {BrandFact} from './brand-facts';
import {executionTotals,type ExecutionCreative,type ExecutionLimits,type ExecutionState,type Publication,type FactRef} from './execution';
import {mediaUrl,pngBytes,sha256,storePng,verifyMedia} from './execution-media';
import {verifyBuffer} from './publisher-buffer';

export type PublisherCredential={secret:string;version:number;channelId:string;account:string};
export async function optionalRecord<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
export async function getExecution(owner:string,campaign:Campaign):Promise<ExecutionState>{
 const [creatives,publications,limits,credential]=await Promise.all([listRecords<ExecutionCreative>(owner,'execution_creative',campaign.id),listRecords<Publication>(owner,'execution_publication',campaign.id),optionalRecord<ExecutionLimits>(owner,'execution_limits',campaign.id),optionalRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId)]);
 return {creatives:creatives.map(c=>({...c,objectKey:''})),publications,limits,publisher:credential?{connected:true,channelId:credential.channelId,account:credential.account,version:credential.version}:{connected:false}};
}
export function assertVersion(record:{version:number},version:unknown){if(record.version!==version)throw new ApiError(409,'내용이 변경됐습니다. 새로고침 후 다시 확인하세요.')}
export async function resolveFacts(owner:string,campaign:Campaign,refs:unknown,until=Date.now()):Promise<BrandFact[]>{
 if(!Array.isArray(refs)||!refs.length||refs.length>4)throw new ApiError(400,'확인 사실을 1~4개 선택하세요.');
 const facts=await confirmedFactContext(owner,campaign.brandId,campaign.storeId),seen=new Set<string>();
 return refs.map((ref:FactRef)=>{
  const fact=facts.find(f=>f.id===ref?.id&&f.version===ref?.version);
  if(!fact||seen.has(fact.id)||Date.parse(fact.validUntil)<=until)throw new ApiError(409,'선택한 사실이 변경됐거나 예약 시각까지 유효하지 않습니다.');
  seen.add(fact.id);return fact;
 });
}
export async function saveLimits(owner:string,campaign:Campaign,input:Record<string,unknown>){
 const old=await optionalRecord<ExecutionLimits>(owner,'execution_limits',campaign.id);if(old)assertVersion(old,input.version);
 const maxPublications=num(input.maxPublications,'최대 발행 시도'),maxPlannedCostKRW=num(input.maxPlannedCostKRW,'예정 비용 상한');
 if(!Number.isSafeInteger(maxPublications)||maxPublications>100||!Number.isSafeInteger(maxPlannedCostKRW))throw new ApiError(400,'발행 시도는 0~100회, 비용은 정수로 입력하세요.');
 const value:ExecutionLimits={id:campaign.id,version:(old?.version||0)+1,maxPublications,maxPlannedCostKRW,paused:input.paused===true};
 await recordStatement(owner,'execution_limits',campaign.id,value,campaign.id).run();return value;
}
export async function connectPublisher(owner:string,campaign:Campaign,input:Record<string,unknown>){
 const token=str(input.token,'Buffer API 키',5000,true),organizationId=str(input.organizationId,'Buffer 조직',100,true),channelId=str(input.channelId,'Instagram 채널',100,true);
 const account=await verifyBuffer(token,organizationId,channelId),old=await optionalRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId);
 const value:PublisherCredential={secret:await encrypt(token),channelId,account,version:(old?.version||0)+1};
 await recordStatement(owner,'publisher_credential',campaign.brandId,value,campaign.brandId).run();return {connected:true,channelId,account,version:value.version};
}
export async function saveCreative(owner:string,campaign:Campaign,input:Record<string,unknown>){
 assertVersion(campaign,input.campaignVersion);
 const facts=await resolveFacts(owner,campaign,input.factRefs),caption=facts.map(f=>f.key+': '+f.value).join('\n');
 if(caption.length>1800)throw new ApiError(400,'선택한 사실이 너무 깁니다. 짧은 안내 사실을 선택하세요.');
 const bytes=await pngBytes(input.png),hash=await sha256(bytes);
 const prior=(await listRecords<ExecutionCreative>(owner,'execution_creative',campaign.id)).find(c=>c.pngHash===hash&&c.campaignVersion===campaign.version&&JSON.stringify(c.factRefs)===JSON.stringify(input.factRefs));
 if(prior)return {...prior,objectKey:''};
 if((await listRecords<ExecutionCreative>(owner,'execution_creative')).length>=200)throw new ApiError(409,'소재 보관 한도 200개에 도달했습니다. 관리자에게 보관 정책을 문의하세요.');
 const id=uid(),objectKey=await storePng(owner,id,bytes);
 const creative:ExecutionCreative={id,campaignId:campaign.id,campaignVersion:campaign.version,brandId:campaign.brandId,...(campaign.storeId?{storeId:campaign.storeId}:{}),version:1,factRefs:facts.map(f=>({id:f.id,version:f.version})),caption,pngHash:hash,objectKey,createdAt:stamp()};
 await recordStatement(owner,'execution_creative',id,creative,campaign.id).run();return {...creative,objectKey:''};
}
export async function currentCreative(owner:string,campaign:Campaign,id:string){
 const c=await readRecord<ExecutionCreative>(owner,'execution_creative',id);
 if(c.campaignId!==campaign.id||c.brandId!==campaign.brandId||c.storeId!==campaign.storeId)throw new ApiError(404,'이 캠페인의 소재가 아닙니다.');
 if(c.campaignVersion!==campaign.version)throw new ApiError(409,'브리프가 변경됐습니다. 새 소재를 만들어 주세요.');
 await resolveFacts(owner,campaign,c.factRefs);return c;
}
function schedule(value:unknown){const date=str(value,'예약 시각',50,true);if(!Number.isFinite(Date.parse(date))||Date.parse(date)<Date.now()+300000)throw new ApiError(400,'예약은 현재보다 5분 이상 뒤로 설정하세요.');return new Date(date).toISOString()}
export async function savePublication(owner:string,campaign:Campaign,input:Record<string,unknown>){
 const creative=await currentCreative(owner,campaign,str(input.creativeId,'소재',100,true));
 const scheduledAt=schedule(input.scheduledAt);await resolveFacts(owner,campaign,creative.factRefs,Date.parse(scheduledAt));
 const url=mediaUrl(str(input.mediaUrl,'공개 이미지',2000,true),creative.pngHash),plannedCostKRW=num(input.plannedCostKRW,'예정 비용');
 if(!Number.isSafeInteger(plannedCostKRW))throw new ApiError(400,'예정 비용은 원 단위 정수로 입력하세요.');
 const existing=await listRecords<Publication>(owner,'execution_publication',campaign.id);
 if(existing.length>=200)throw new ApiError(409,'캠페인 발행 기록 한도 200개에 도달했습니다. 새 캠페인으로 준비하세요.');
 if(existing.some(p=>p.creativeId===creative.id&&p.scheduledAt===scheduledAt&&p.status!=='cancelled'))throw new ApiError(409,'같은 소재와 시각의 발행이 이미 있습니다. 기존 발행을 확인하세요.');
 const p:Publication={id:uid(),campaignId:campaign.id,creativeId:creative.id,creativeVersion:creative.version,campaignVersion:campaign.version,pngHash:creative.pngHash,factRefs:creative.factRefs,caption:creative.caption,mediaUrl:url,scheduledAt,plannedCostKRW,version:1,status:'draft',createdAt:stamp()};
 await recordStatement(owner,'execution_publication',p.id,p,campaign.id).run();return p;
}
export async function publicationFor(owner:string,campaign:Campaign,id:unknown,version:unknown){
 const p=await readRecord<Publication>(owner,'execution_publication',str(id,'발행',100,true));
 if(p.campaignId!==campaign.id)throw new ApiError(404,'이 캠페인의 발행이 아닙니다.');assertVersion(p,version);return p;
}
export async function approvalInputs(owner:string,campaign:Campaign,p:Publication){
 const creative=await currentCreative(owner,campaign,p.creativeId);
 if(creative.version!==p.creativeVersion||creative.pngHash!==p.pngHash||creative.caption!==p.caption)throw new ApiError(409,'소재가 변경됐습니다. 다시 준비하세요.');
 await resolveFacts(owner,campaign,p.factRefs,Date.parse(p.scheduledAt));schedule(p.scheduledAt);
 const credential=await readRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId),limits=await readRecord<ExecutionLimits>(owner,'execution_limits',campaign.id);
 if(limits.paused)throw new ApiError(409,'이 캠페인의 발행이 중지됐습니다.');
 return {credential,limits};
}
export async function approvePublication(owner:string,campaign:Campaign,p:Publication,input:Record<string,unknown>,actor=owner){
 if(p.status!=='draft'||input.confirmed!==true||input.rightsConfirmed!==true||input.immutableMediaConfirmed!==true)throw new ApiError(400,'PNG·사실·사용 권리·공개 파일 유지 조건을 확인하고 승인하세요.');
 const {credential,limits}=await approvalInputs(owner,campaign,p);
 if(input.channelId!==credential.channelId||input.credentialVersion!==credential.version||input.limitsVersion!==limits.version)throw new ApiError(409,'화면에 표시된 계정 또는 한도가 변경됐습니다. 새로고침하고 다시 확인하세요.');
 await verifyMedia(p.mediaUrl,p.pngHash);
 const approved:Publication={...p,status:'approved',version:p.version+1,channelId:credential.channelId,credentialVersion:credential.version,limitsVersion:limits.version,approvedBy:actor,approvedAt:stamp(),updatedAt:stamp()};
 await recordStatement(owner,'execution_publication',p.id,approved,campaign.id).run();return approved;
}
// Called with the owner mutation lock. Persist the attempt BEFORE any publish call.
export async function reservePublication(owner:string,campaign:Campaign,p:Publication){
 if(p.status!=='approved'||p.attemptedAt)throw new ApiError(409,'승인된 미실행 항목만 접수할 수 있습니다. 재전송하지 마세요.');
 const {credential,limits}=await approvalInputs(owner,campaign,p);
 if(p.credentialVersion!==credential.version||p.channelId!==credential.channelId||p.limitsVersion!==limits.version||p.campaignVersion!==campaign.version)throw new ApiError(409,'계정·한도·캠페인이 변경됐습니다. 새 발행 승인이 필요합니다.');
 const total=executionTotals(await listRecords<Publication>(owner,'execution_publication',campaign.id));
 if(total.attempts>=limits.maxPublications||total.plannedCostKRW+p.plannedCostKRW>limits.maxPlannedCostKRW)throw new ApiError(409,'발행 시도 또는 예정 비용 상한을 초과합니다.');
 await verifyMedia(p.mediaUrl,p.pngHash);
 const token=await decrypt(credential.secret);
 const pending:Publication={...p,status:'submitting',attemptedAt:stamp(),updatedAt:stamp(),version:p.version+1};
 await recordStatement(owner,'execution_publication',p.id,pending,campaign.id).run();
 return {pending,token};
}
