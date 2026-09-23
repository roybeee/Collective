import {ApiError,runtime,readRecord,listRecords,recordStatement,eventStatement,database,acquireLock,releaseLock,stamp,uid,str,num,encrypt,decrypt,type Actor} from './server';
import {campaignBudget,type Artifact,type Brand,type Campaign} from './agency';
import {confirmedFactContext} from './brand-facts-server';
import type {BrandFact} from './brand-facts';
import {evidenceContext} from './ai-context';
import {factLabel} from './fact-catalog';
import {approvalDrift,budgetIssues,campaignGateIssues,captionIssues,composeCaption,copyBlocks,executionTotals,providerPublicationStatus,publicationLabels,reviewStatuses,uncertainResolvable,type CaptionCandidate,type ExecutionCreative,type ExecutionLimits,type ExecutionState,type NeedsReview,type Publication,type PublicationCopy,type PublicationStatus,type FactRef} from './execution';
import {isOwnMediaUrl,mediaUrl,pngBytes,publishPublicMedia,retirePublicMedia,sha256,storePngThen,verifyMedia} from './execution-media';
import {inspectBuffer,verifyBuffer} from './publisher-buffer';

export type PublisherCredential={secret:string;version:number;channelId:string;account:string;organizationId?:string};
type Who=Pick<Actor,'id'|'email'>;
export async function optionalRecord<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
// 캡션과 PNG에는 내부 key 대신 표준 항목 라벨을 쓴다(data-truth-12).
const labeledCaption=(facts:Pick<BrandFact,'key'|'value'>[])=>facts.map(f=>factLabel(f.key)+': '+f.value).join('\n');
// 소재 입력 지문(exec-loop-8): 브랜드 이름·색, 사실 {id,version}, 캡션. 입력이 같으면 브리프 버전이 바뀌어도 소재를 다시 만들 필요가 없다.
export async function materialHash(brand:Pick<Brand,'name'|'color'>,refs:FactRef[],caption:string){return sha256(new TextEncoder().encode(JSON.stringify([brand.name,brand.color,refs.map(r=>[r.id,r.version]),caption])))}
async function creativeCurrent(campaign:Campaign,brand:Brand|null,facts:BrandFact[],c:ExecutionCreative){
 const used=c.factRefs.map(r=>facts.find(f=>f.id===r.id&&f.version===r.version));
 // 지점 연결 전에 만든 소재는 접수 때 currentCreative가 거부하므로 화면에서도 현재 소재가 아니다(R4).
 if(used.some(f=>!f)||!brand||c.storeId!==campaign.storeId)return false;
 if(!c.materialHash)return c.campaignVersion===campaign.version;
 return c.materialHash===await materialHash(brand,c.factRefs,labeledCaption(used as BrandFact[]));
}
export async function getExecution(owner:string,campaign:Campaign):Promise<ExecutionState>{
 const [creatives,publications,limits,credential,brand,facts,copies]=await Promise.all([listRecords<ExecutionCreative>(owner,'execution_creative',campaign.id),listRecords<Publication>(owner,'execution_publication',campaign.id),optionalRecord<ExecutionLimits>(owner,'execution_limits',campaign.id),optionalRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId),optionalRecord<Brand>(owner,'brand',campaign.brandId),confirmedFactContext(owner,campaign.brandId,campaign.storeId),captionCandidates(owner,campaign)]);
 const current=await Promise.all(creatives.map(c=>creativeCurrent(campaign,brand,facts,c)));
 return {creatives:creatives.map((c,i)=>({...c,objectKey:'',current:current[i]})),publications,limits,publisher:credential?{connected:true,channelId:credential.channelId,account:credential.account,version:credential.version}:{connected:false},copies,copyCaptions:aiCopyCaptionsEnabled()};
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
// 캡션 후보(exec-loop-7 1): 현재 브리프 버전에서 승인된 콘텐츠 작업물의 게시 카피. PR 2 근거 컨텍스트의 확정·거절·후보 사실로 검사한다.
const copySource=(a:Artifact,c:Campaign)=>a.role==='content'&&a.status==='approved'&&a.campaignId===c.id&&(a.campaignVersion===undefined||a.campaignVersion===c.version);
// 결정 17(AI 생성물 표시·규제 검토 책임)이 정해지기 전에는 AI 작업물 카피를 게시 캡션에 쓰지 않는다.
// 표시 문구·위치와 승인 게이트의 표시 확인을 구현한 뒤 AI_COPY_CAPTIONS=enabled로 켠다. 확인 사실 문구만 쓰는 캡션은 영향이 없다.
export const aiCopyCaptionsEnabled=()=>runtime.AI_COPY_CAPTIONS==='enabled';
export async function captionCandidates(owner:string,campaign:Campaign):Promise<CaptionCandidate[]>{
 if(!aiCopyCaptionsEnabled())return [];
 const artifacts=(await listRecords<Artifact>(owner,'artifact',campaign.id)).filter(a=>copySource(a,campaign));
 if(!artifacts.length)return [];
 const {facts}=await evidenceContext(database(),owner,campaign);
 return artifacts.flatMap(a=>copyBlocks(a.content).map((text,index)=>({artifactId:a.id,artifactVersion:a.version,index,text,issues:captionIssues(text,facts)})));
}
async function approvedCopy(owner:string,campaign:Campaign,input:unknown):Promise<PublicationCopy>{
 if(!aiCopyCaptionsEnabled())throw new ApiError(409,'AI 작업물 카피를 캡션에 쓰는 기능은 AI 생성물 표시 기준(결정 17)이 정해질 때까지 꺼져 있습니다. 확인 사실 문구만으로 발행하세요.');
 const ref=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;
 const artifact=await readRecord<Artifact>(owner,'artifact',str(ref.artifactId,'카피 작업물',100,true));
 if(!copySource(artifact,campaign)||artifact.version!==ref.artifactVersion)throw new ApiError(409,'카피 작업물이 현재 브리프에서 승인된 버전이 아닙니다. 캡션 후보를 다시 불러오세요.');
 const index=typeof ref.index==='number'?ref.index:-1,text=copyBlocks(artifact.content)[index];
 if(!text)throw new ApiError(400,'캡션 후보를 선택하세요.');
 const issues=captionIssues(text,(await evidenceContext(database(),owner,campaign)).facts);
 if(issues.length)throw new ApiError(409,'이 카피는 캡션에 쓸 수 없습니다: '+issues.join(', '));
 return {artifactId:artifact.id,artifactVersion:artifact.version,index,text};
}
export async function saveLimits(owner:string,campaign:Campaign,input:Record<string,unknown>){
 const old=await optionalRecord<ExecutionLimits>(owner,'execution_limits',campaign.id);if(old)assertVersion(old,input.version);
 const maxPublications=num(input.maxPublications,'최대 발행 시도'),maxPlannedCostKRW=num(input.maxPlannedCostKRW,'예정 비용 상한');
 if(!Number.isSafeInteger(maxPublications)||maxPublications>100||!Number.isSafeInteger(maxPlannedCostKRW))throw new ApiError(400,'발행 시도는 0~100회, 비용은 정수로 입력하세요.');
 // 비용 상한은 확정 예산(0원 무예산 포함) 안에서만 정한다. 미확정(null·확정 표시 없는 이전 0)이면 0원 상한만 허용한다(data-truth-4 a).
 const budget=campaignBudget(campaign);
 if(budget===null&&maxPlannedCostKRW>0)throw new ApiError(409,'예산을 확정한 뒤 비용 상한을 정하세요. 예산이 미확정이면 비용 상한은 0원만 저장할 수 있습니다.');
 if(budget!==null&&maxPlannedCostKRW>budget)throw new ApiError(409,`예정 비용 상한은 확정된 캠페인 예산 ${budget.toLocaleString('ko-KR')}원을 넘을 수 없습니다.`);
 const value:ExecutionLimits={id:campaign.id,version:(old?.version||0)+1,maxPublications,maxPlannedCostKRW,paused:input.paused===true};
 await recordStatement(owner,'execution_limits',campaign.id,value,campaign.id).run();return value;
}
// 연결 변경은 화면에 표시된 연결 버전(CAS)을 확인한다. 처음 연결할 때는 버전이 없어야 한다.
export async function connectPublisher(owner:string,campaign:Campaign,input:Record<string,unknown>){
 const old=await optionalRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId);
 if(old)assertVersion(old,input.version);else if(input.version!==undefined&&input.version!==null)throw new ApiError(409,'발행 연결이 바뀌었습니다. 새로고침 후 다시 연결하세요.');
 const token=str(input.token,'Buffer API 키',5000,true),organizationId=str(input.organizationId,'Buffer 조직',100,true),channelId=str(input.channelId,'Instagram 채널',100,true);
 const account=await verifyBuffer(token,organizationId,channelId);
 const value:PublisherCredential={secret:await encrypt(token),channelId,account,organizationId,version:(old?.version||0)+1};
 await recordStatement(owner,'publisher_credential',campaign.brandId,value,campaign.brandId).run();return {connected:true,channelId,account,version:value.version};
}
// 승인을 새 버전의 초안으로 되돌린다. 승인 필드와 자동 공개 주소를 비운다(JSON 저장 시 undefined 필드는 빠진다).
function toDraft(p:Publication,reason:string):Publication{return {...p,status:'draft',version:p.version+1,mediaUrl:p.mediaMode==='auto'?'':p.mediaUrl,channelId:undefined,credentialVersion:undefined,limitsVersion:undefined,approvedLimits:undefined,approvedBy:undefined,approvedAt:undefined,needsReview:undefined,invalidatedReason:reason,updatedAt:stamp()}}
// 승인에서 벗어난 발행의 앱 공개 주소 참조를 해제한다. 호출자는 owner 변경 잠금을 가진다. 실패해도 상태 변경은 유지하고 기록만 남긴다.
export async function retireMedia(owner:string,publications:Publication[]){
 for(const p of publications)if(p.mediaMode==='auto'&&p.mediaUrl)await retirePublicMedia(owner,p.pngHash,p.id).catch(e=>console.error('execution_media_retire_failed',e instanceof Error?e.message:'unknown'));
}
// exec-loop-11: 자격증명을 지우고 이 브랜드의 모든 승인을 초안으로 되돌리며 감사 이벤트를 남긴다. 이미 접수된 예약은 Buffer에서 처리한다.
export async function disconnectPublisher(owner:string,campaign:Campaign,input:Record<string,unknown>,who:Who){
 const credential=await readRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId);assertVersion(credential,input.version);
 const campaigns=(await listRecords<Campaign>(owner,'campaign')).filter(c=>c.brandId===campaign.brandId);
 const approved=(await Promise.all(campaigns.map(c=>listRecords<Publication>(owner,'execution_publication',c.id)))).flat().filter(p=>p.status==='approved');
 const db=database();
 await db.batch([db.prepare("DELETE FROM records WHERE owner=? AND kind='publisher_credential' AND id=?").bind(owner,`${owner}:publisher_credential:${campaign.brandId}`),...approved.map(p=>recordStatement(owner,'execution_publication',p.id,toDraft(p,'Buffer 연결 해제'),p.campaignId)),eventStatement(owner,campaign.id,`Buffer 연결 해제 · ${credential.account} 자격증명을 삭제하고 승인 ${approved.length}건을 초안으로 되돌렸습니다. 이미 접수된 예약은 Buffer에서 확인하세요.`,who)]);
 await retireMedia(owner,approved);
 return {connected:false,invalidated:approved.length};
}
export async function saveCreative(owner:string,campaign:Campaign,input:Record<string,unknown>){
 assertVersion(campaign,input.campaignVersion);
 const facts=await resolveFacts(owner,campaign,input.factRefs),caption=labeledCaption(facts);
 if(caption.length>1800)throw new ApiError(400,'선택한 사실이 너무 깁니다. 짧은 안내 사실을 선택하세요.');
 const bytes=await pngBytes(input.png),hash=await sha256(bytes),refs=facts.map(f=>({id:f.id,version:f.version}));
 const material=await materialHash(await readRecord<Brand>(owner,'brand',campaign.brandId),refs,caption);
 const prior=(await listRecords<ExecutionCreative>(owner,'execution_creative',campaign.id)).find(c=>c.pngHash===hash&&c.materialHash===material);
 if(prior)return {...prior,objectKey:''};
 if((await listRecords<ExecutionCreative>(owner,'execution_creative')).length>=200)throw new ApiError(409,'소재 보관 한도 200개에 도달했습니다. 관리자에게 보관 정책을 문의하세요.');
 const id=uid();
 return storePngThen(owner,id,bytes,async objectKey=>{
  const creative:ExecutionCreative={id,campaignId:campaign.id,campaignVersion:campaign.version,brandId:campaign.brandId,...(campaign.storeId?{storeId:campaign.storeId}:{}),version:1,factRefs:refs,caption,pngHash:hash,objectKey,materialHash:material,createdAt:stamp()};
  await recordStatement(owner,'execution_creative',id,creative,campaign.id).run();return {...creative,objectKey:''};
 });
}
export async function currentCreative(owner:string,campaign:Campaign,id:string){
 const c=await readRecord<ExecutionCreative>(owner,'execution_creative',id);
 if(c.campaignId!==campaign.id||c.brandId!==campaign.brandId||c.storeId!==campaign.storeId)throw new ApiError(404,'이 캠페인의 소재가 아닙니다.');
 const facts=await resolveFacts(owner,campaign,c.factRefs);
 if(!c.materialHash){if(c.campaignVersion!==campaign.version)throw new ApiError(409,'브리프가 변경됐습니다. 새 소재를 만들어 주세요.');return c}
 if(c.materialHash!==await materialHash(await readRecord<Brand>(owner,'brand',campaign.brandId),c.factRefs,labeledCaption(facts)))throw new ApiError(409,'소재 입력(브랜드 이름·색·사실·캡션)이 바뀌었습니다. 새 소재를 만들어 주세요.');
 return c;
}
function schedule(value:unknown){const date=str(value,'예약 시각',50,true);if(!Number.isFinite(Date.parse(date))||Date.parse(date)<Date.now()+300000)throw new ApiError(400,'예약은 현재보다 5분 이상 뒤로 설정하세요.');return new Date(date).toISOString()}
// 외부 주소를 비우거나 앱 공개 주소를 넣으면 auto: 승인 때 앱이 /media/<sha256>.png를 채운다(exec-loop-2). Cloudinary·R2는 고급 옵션(external)이다.
export async function savePublication(owner:string,campaign:Campaign,input:Record<string,unknown>,origin:string){
 const creative=await currentCreative(owner,campaign,str(input.creativeId,'소재',100,true));
 const scheduledAt=schedule(input.scheduledAt);await resolveFacts(owner,campaign,creative.factRefs,Date.parse(scheduledAt));
 const raw=str(input.mediaUrl??'','공개 이미지',2000),checked=raw?mediaUrl(raw,creative.pngHash,origin):'',mediaMode=!checked||isOwnMediaUrl(checked,origin)?'auto' as const:'external' as const;
 const plannedCostKRW=num(input.plannedCostKRW,'예정 비용');
 if(!Number.isSafeInteger(plannedCostKRW))throw new ApiError(400,'예정 비용은 원 단위 정수로 입력하세요.');
 const existing=await listRecords<Publication>(owner,'execution_publication',campaign.id);
 if(existing.length>=200)throw new ApiError(409,'캠페인 발행 기록 한도 200개에 도달했습니다. 새 캠페인으로 준비하세요.');
 if(existing.some(p=>p.creativeId===creative.id&&p.scheduledAt===scheduledAt&&p.status!=='cancelled'))throw new ApiError(409,'같은 소재와 시각의 발행이 이미 있습니다. 기존 발행을 확인하세요.');
 const copy=input.copy?await approvedCopy(owner,campaign,input.copy):undefined,caption=composeCaption(copy?.text,creative.caption);
 if(caption.length>2200)throw new ApiError(400,'캡션이 Instagram 한도 2,200자를 넘습니다. 더 짧은 카피를 고르세요.');
 const p:Publication={id:uid(),campaignId:campaign.id,creativeId:creative.id,creativeVersion:creative.version,campaignVersion:campaign.version,pngHash:creative.pngHash,factRefs:creative.factRefs,caption,...(copy?{copy}:{}),mediaUrl:mediaMode==='auto'?'':checked,mediaMode,scheduledAt,plannedCostKRW,version:1,status:'draft',createdAt:stamp()};
 await recordStatement(owner,'execution_publication',p.id,p,campaign.id).run();return p;
}
export async function publicationFor(owner:string,campaign:Campaign,id:unknown,version:unknown){
 const p=await readRecord<Publication>(owner,'execution_publication',str(id,'발행',100,true));
 if(p.campaignId!==campaign.id)throw new ApiError(404,'이 캠페인의 발행이 아닙니다.');assertVersion(p,version);return p;
}
export async function approvalInputs(owner:string,campaign:Campaign,p:Publication){
 const gate=campaignGateIssues(campaign,p.scheduledAt);if(gate.length)throw new ApiError(409,gate.join(' '));
 const creative=await currentCreative(owner,campaign,p.creativeId);
 if(creative.version!==p.creativeVersion||creative.pngHash!==p.pngHash||composeCaption(p.copy?.text,creative.caption)!==p.caption)throw new ApiError(409,'소재가 변경됐습니다. 다시 준비하세요.');
 if(p.copy&&(await approvedCopy(owner,campaign,p.copy)).text!==p.copy.text)throw new ApiError(409,'카피 작업물이 바뀌었습니다. 캡션 후보를 다시 고르세요.');
 await resolveFacts(owner,campaign,p.factRefs,Date.parse(p.scheduledAt));schedule(p.scheduledAt);
 const [credential,limits]=await Promise.all([optionalRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId),optionalRecord<ExecutionLimits>(owner,'execution_limits',campaign.id)]);
 if(!credential)throw new ApiError(409,'채널 미연결 · Buffer Instagram 채널을 연결한 뒤 승인하세요.');
 if(!limits)throw new ApiError(409,'한도 미설정 · 기본 한도(발행 1회·0원)를 저장한 뒤 승인하세요.');
 if(limits.paused)throw new ApiError(409,'이 캠페인의 발행이 중지됐습니다.');
 // 한도를 저장한 뒤 예산을 낮추거나 미확정으로 되돌려도 승인·접수 때 다시 확인한다.
 const budget=budgetIssues(campaign,p.plannedCostKRW,limits);if(budget.length)throw new ApiError(409,budget.join(' '));
 return {credential,limits};
}
export async function approvePublication(owner:string,campaign:Campaign,p:Publication,input:Record<string,unknown>,who:Who,origin:string){
 const external=p.mediaMode!=='auto';
 if(p.status!=='draft'||input.confirmed!==true||input.rightsConfirmed!==true||(external&&input.immutableMediaConfirmed!==true))throw new ApiError(400,external?'PNG·사실·사용 권리·공개 파일 유지 조건을 확인하고 승인하세요.':'PNG·사실·사용 권리를 확인하고 승인하세요.');
 const {credential,limits}=await approvalInputs(owner,campaign,p);
 const changed=[...(input.channelId!==credential.channelId||input.credentialVersion!==credential.version?['발행 계정']:[]),...(input.limitsVersion!==limits.version?['실행 한도']:[])];
 if(changed.length)throw new ApiError(409,`화면에 표시된 정보가 변경됐습니다(${changed.join(', ')}). 새로고침하고 다시 확인하세요.`);
 // 자동 모드는 승인된 발행만 앱 공개 주소로 제공한다. 외부 호스트는 원본 해시와 같은지 확인한다.
 let url=p.mediaUrl;if(external)await verifyMedia(p.mediaUrl,p.pngHash,origin);else url=await publishPublicMedia(owner,p.pngHash,p.id,origin);
 const approved:Publication={...p,status:'approved',version:p.version+1,mediaUrl:url,channelId:credential.channelId,credentialVersion:credential.version,limitsVersion:limits.version,approvedLimits:{maxPublications:limits.maxPublications,maxPlannedCostKRW:limits.maxPlannedCostKRW},approvedBy:who.id,approvedAt:stamp(),invalidatedReason:undefined,updatedAt:stamp()};
 try{await recordStatement(owner,'execution_publication',p.id,approved,campaign.id).run()}catch(e){if(!external)await retirePublicMedia(owner,p.pngHash,p.id).catch(()=>{});throw e}
 return approved;
}
// Called with the owner mutation lock. Persist the attempt BEFORE any publish call.
export async function reservePublication(owner:string,campaign:Campaign,p:Publication,origin:string){
 if(p.status!=='approved'||p.attemptedAt)throw new ApiError(409,'승인된 미실행 항목만 접수할 수 있습니다. 재전송하지 마세요.');
 const {credential,limits}=await approvalInputs(owner,campaign,p);
 const drift=approvalDrift(p,credential,limits);
 // 사용한 사실이 바뀌면 사실 버전이 달라져 같은 소재로 다시 승인할 수 없다. 취소하고 새 PNG로 준비하게 안내한다.
 if(drift.length)throw new ApiError(409,`승인 뒤 바뀐 항목: ${drift.join(', ')}. `+(p.needsReview?'이 발행을 취소하고 새 PNG로 새 초안을 만드세요.':"'재확인'으로 초안에 되돌린 뒤 다시 승인하세요."));
 const total=executionTotals(await listRecords<Publication>(owner,'execution_publication',campaign.id));
 if(total.attempts>=limits.maxPublications||total.plannedCostKRW+p.plannedCostKRW>limits.maxPlannedCostKRW)throw new ApiError(409,'발행 시도 또는 예정 비용 상한을 초과합니다.');
 await verifyMedia(p.mediaUrl,p.pngHash,origin);
 const token=await decrypt(credential.secret);
 const pending:Publication={...p,status:'submitting',attemptedAt:stamp(),updatedAt:stamp(),version:p.version+1};
 await recordStatement(owner,'execution_publication',p.id,pending,campaign.id).run();
 return {pending,token};
}
// 공급자 결과는 잠금 재획득 없이 버전 조건부 UPDATE로 저장한다. 접수 중 표시된 needsReview는 유지한다.
// 반영되지 않으면(changes=0·저장 오류) Buffer 게시 번호를 별도 감사 기록과 응답에 남겨 잃지 않는다(exec-loop-9).
export async function saveProviderResult(owner:string,campaign:Campaign,pending:Publication,result:Publication){
 const saved:Publication={...result,version:pending.version+1,updatedAt:stamp()};let changes=0;
 try{changes=(await database().prepare("UPDATE records SET data=json_set(?,'$.needsReview',json(json_extract(data,'$.needsReview'))),updated_at=? WHERE owner=? AND kind='execution_publication' AND id=? AND json_extract(data,'$.version')=? AND json_extract(data,'$.status')='submitting'").bind(JSON.stringify(saved),stamp(),owner,`${owner}:execution_publication:${pending.id}`,pending.version).run()).meta.changes}
 catch(e){if(!saved.providerId)throw e;console.error('execution_provider_result_save_failed',e instanceof Error?e.message:'unknown')}
 // 잠금을 얻지 못하면 참조가 남지만 공개 제공은 발행 상태로 판정해 멈춘다(SEC-1). 남은 참조는 다음 해제 때 정리된다.
 if(changes&&saved.status==='failed'){const lock=await acquireLock(owner).catch(()=>'');if(lock)try{await retireMedia(owner,[pending])}finally{await releaseLock(owner,lock)}else console.error('execution_media_retire_deferred',pending.id)}
 if(changes||!saved.providerId)return readRecord<Publication>(owner,'execution_publication',pending.id);
 const audit={id:uid(),publicationId:pending.id,campaignId:campaign.id,providerId:saved.providerId,providerStatus:saved.providerStatus,status:saved.status,createdAt:stamp()};
 await recordStatement(owner,'execution_provider_audit',audit.id,audit,campaign.id).run().catch(e=>console.error('execution_provider_audit_failed',e instanceof Error?e.message:'unknown'));
 const current=await optionalRecord<Publication>(owner,'execution_publication',pending.id).catch(()=>null);
 return {...(current||saved),providerAudit:{providerId:saved.providerId,providerStatus:saved.providerStatus,message:'이 Buffer 게시 번호를 발행 기록에 저장하지 못했습니다. 접수 확인에서 이 번호로 연결하세요.'}};
}
export async function cancelPublication(owner:string,campaign:Campaign,p:Publication){
 if(p.status!=='draft'&&p.status!=='approved')throw new ApiError(409,'이미 접수한 항목은 Buffer에서 예약 상태와 취소 여부를 확인하세요.');
 const cancelled:Publication={...p,status:'cancelled',version:p.version+1,updatedAt:stamp()};await recordStatement(owner,'execution_publication',p.id,cancelled,campaign.id).run();
 await retireMedia(owner,[p]);return cancelled;
}
// exec-loop-8: 무효화된 승인을 새 버전의 초안으로 되돌린다. 바뀐 소재·사실·한도는 다시 승인할 때 검사한다.
export async function reconfirmPublication(owner:string,campaign:Campaign,p:Publication,who:Who){
 if(p.status!=='approved'||p.attemptedAt)throw new ApiError(409,'승인 후 접수하지 않은 발행만 재확인할 수 있습니다.');
 const draft:Publication={...toDraft(p,'관리자 재확인'),reconfirmedBy:who.id,reconfirmedAt:stamp()};
 await database().batch([recordStatement(owner,'execution_publication',p.id,draft,campaign.id),eventStatement(owner,campaign.id,'발행 재확인 · 승인을 초안으로 되돌렸습니다. 바뀐 항목을 확인하고 다시 승인하세요.',who)]);
 await retireMedia(owner,[p]);return draft;
}
// exec-loop-9: 접수 여부가 불확실한 발행을 관리자가 확정한다. 재전송하지 않는다.
// Buffer 게시 ID는 원래 채널의 게시인지 확인한다. '없음 확인'은 실패로 닫고 시도 차감 복원 여부를 명시적으로 고른다.
export async function resolveUncertain(owner:string,campaign:Campaign,p:Publication,input:Record<string,unknown>,who:Who){
 if(p.status!=='submitting'&&p.status!=='uncertain')throw new ApiError(409,'접수 확인 중이거나 접수 여부가 미확인인 발행만 확정할 수 있습니다.');
 // 방금 접수 중이 된 건은 Buffer 응답을 기다리는 중일 수 있다. 이때 '없음'으로 닫으면 실제 접수가 실패로 남고 한도가 풀린다.
 if(!uncertainResolvable(p))throw new ApiError(409,'접수 처리 중입니다. 잠시 후 확인하세요.');
 const resolved={version:p.version+1,resolvedBy:who.id,resolvedAt:stamp(),updatedAt:stamp()};let next:Publication,message:string;
 if(input.notFound===true){
  if(typeof input.restoreAttempt!=='boolean')throw new ApiError(400,'발행 시도 차감을 되돌릴지 선택하세요.');
  next={...p,...resolved,status:'failed',attemptRestored:input.restoreAttempt,error:'관리자가 Buffer에서 게시가 없음을 확인했습니다. 자동 재전송하지 않습니다.'};
  message=`접수 확인 · Buffer에 게시가 없어 실패로 닫았습니다. 발행 시도 차감 ${input.restoreAttempt?'복원':'유지'}.`;
 }else{
  const providerId=str(input.providerId,'Buffer 게시 ID',200,true);
  if((await listRecords<Publication>(owner,'execution_publication',campaign.id)).some(x=>x.id!==p.id&&x.providerId===providerId))throw new ApiError(409,'다른 발행에 연결된 Buffer 게시 ID입니다.');
  const credential=await optionalRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId);
  if(!credential||credential.channelId!==p.channelId)throw new ApiError(409,'원래 발행 계정으로 연결한 뒤 확인하세요.');
  const remote=await inspectBuffer(await decrypt(credential.secret),providerId);
  if(remote.channelId!==p.channelId)throw new ApiError(409,'이 발행의 Instagram 채널에 있는 Buffer 게시가 아닙니다.');
  next={...p,...resolved,status:providerPublicationStatus(remote.status),providerId,providerStatus:remote.status,error:undefined};
  message=`접수 확인 · Buffer 게시 ID로 '${publicationLabels[next.status]}' 상태를 확정했습니다.`;
 }
 await database().batch([recordStatement(owner,'execution_publication',p.id,next,campaign.id),eventStatement(owner,campaign.id,message,who)]);
 if(next.status==='failed')await retireMedia(owner,[p]);
 return next;
}
// exec-loop-3: 사실 저장·철회 뒤 그 사실을 쓴 승인·접수 중·미확인·접수·공급자 확인 필요 발행에 needsReview를 남기고 개수를 돌려준다.
// 읽은 스냅샷을 덮어쓰지 않고 현재 행에 표시만 더한다(R8). 접수 중(submitting)은 버전을 올리지 않아 공급자 결과 저장(saveProviderResult)의 버전 조건을 깨지 않는다.
export async function flagPublicationsForFactChange(db:D1Database,owner:string,factIds:string[]):Promise<number>{
 const ids=new Set(factIds);if(!ids.size)return 0;
 const live=reviewStatuses.map(s=>`'${s}'`).join(',');
 const rows=await db.prepare(`SELECT data FROM records WHERE owner=? AND kind='execution_publication' AND json_extract(data,'$.status') IN (${live})`).bind(owner).all<{data:string}>();
 const at=stamp(),needsReview={reason:'게시에 쓴 확인 사실이 수정되거나 철회됐습니다. 승인 건은 같은 소재로 다시 승인할 수 없으니 이 발행을 취소하고 새 PNG로 새 초안을 만드세요. 접수된 예약은 Buffer에서 취소 여부를 확인하세요.',at};
 const writes=rows.results.map(r=>JSON.parse(r.data) as Publication).filter(p=>p.factRefs?.some(r=>ids.has(r.id))).map(p=>db.prepare(`UPDATE records SET data=json_set(data,'$.needsReview',json(?),'$.version',CASE WHEN json_extract(data,'$.status')='submitting' THEN json_extract(data,'$.version') ELSE json_extract(data,'$.version')+1 END,'$.updatedAt',?),updated_at=? WHERE owner=? AND kind='execution_publication' AND id=? AND json_extract(data,'$.status') IN (${live})`).bind(JSON.stringify(needsReview),at,at,owner,`${owner}:execution_publication:${p.id}`));
 if(!writes.length)return 0;
 return (await db.batch(writes)).reduce((n,r)=>n+(r.meta?.changes||0),0);
}
// security-ops-10: 외부 호스트 발행은 게시 전(accepted·blocked) 상태 조회 때 공개 파일 해시를 다시 확인한다. 달라졌거나 읽을 수 없으면 재검토 표시를 돌려준다.
// 네트워크 오류처럼 판정할 수 없는 실패는 표시하지 않고 기록만 한다.
export async function externalMediaReview(p:Publication,status:PublicationStatus,origin:string):Promise<NeedsReview|undefined>{
 if(p.mediaMode==='auto'||(status!=='accepted'&&status!=='blocked'))return;
 try{await verifyMedia(p.mediaUrl,p.pngHash,origin)}catch(e){
  if(e instanceof ApiError)return {reason:`외부 이미지가 승인한 원본과 다르거나 읽을 수 없습니다. Buffer에서 예약을 취소하세요. (${e.message})`,at:stamp()};
  console.error('execution_media_recheck_failed',e instanceof Error?e.message:'unknown');
 }
}
