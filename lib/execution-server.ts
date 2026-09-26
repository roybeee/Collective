import {ApiError,runtime,readRecord,listRecords,recordStatement,eventStatement,database,acquireLock,releaseLock,stamp,uid,str,num,encrypt,decrypt,type Actor} from './server';
import {campaignBudget,isRecruitmentObjective,type Artifact,type Brand,type Campaign} from './agency';
import {confirmedFactContext} from './brand-facts-server';
import type {BrandFact} from './brand-facts';
import {evidenceContext} from './ai-context';
import {factLabel} from './fact-catalog';
import {approvalDrift,budgetIssues,campaignGateIssues,captionIssues,composeCaption,copyBlocks,executionTotals,providerPublicationStatus,publicationLabels,reviewStatuses,uncertainResolvable,CREATIVE_TITLE_MAX,type CaptionCandidate,type ExecutionCreative,type ExecutionLimits,type ExecutionState,type FranchiseExecution,type NeedsReview,type Publication,type PublicationCode,type PublicationCopy,type PublicationStatus,type FactRef} from './execution';
import {isOwnMediaUrl,mediaUrl,pngBytes,publishPublicMedia,retirePublicMedia,sha256,storePngThen,verifyMedia} from './execution-media';
import {inspectBuffer,verifyBuffer} from './publisher-buffer';
import {issuePublicationCode} from './publication-codes';
import {CODE_ALPHABET,CODE_MAX,type TrackingCode} from './tracking-codes';
import type {Store} from './store-marketing';
import {assertNotArchived} from './campaign-archive';
import {AI_DISCLOSURE_LINE,hasKnownOrigin,isAiGenerated} from './ai-disclosure';
import {factCaption,footnoteIssues,franchiseFactUseIssues,versionStates,FRANCHISE_FACT_MESSAGES,type VersionLite} from './franchise-facts';
import {hasFranchiseContext,loadFranchiseContext,type FranchiseContext} from './franchise-facts-server';
import {franchiseGateError,franchiseIssueLabels,judgeFranchiseText,mentionedFranchiseFacts,recruitmentLike,recruitmentWarning,type ClaimScope,type FranchiseJudgement} from './franchise-compliance';
import {COMPLIANCE_NOTICE} from './graders/compliance';
import {GATE_DISCLAIMER} from './franchise-gates';
import {isInstant} from './franchise-rules';

export type PublisherCredential={secret:string;version:number;channelId:string;account:string;organizationId?:string};
type Who=Pick<Actor,'id'|'email'>;
export async function optionalRecord<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
// 캡션과 PNG에는 내부 key 대신 표준 항목 라벨을 쓴다(data-truth-12).
const labeledCaption=(facts:Pick<BrandFact,'key'|'value'>[])=>facts.map(f=>factLabel(f.key)+': '+f.value).join('\n');
// 트랙 R R1b: 정보공개서 근거(sourceRef)·창업비용 상세가 있는 가맹 사실이 있으면 사실 줄에 매장 유형·기준일·포함·불포함을 싣고 캡션 끝에 결정론 각주를 붙인다.
// 없으면 labeledCaption과 같은 바이트라 기존 소재의 materialHash가 바뀌지 않는다. 참조 버전을 찾지 못하면 null(현재 소재가 아님).
const sourced=(facts:readonly BrandFact[])=>facts.some(f=>!!f.sourceRef||!!f.cost);
const creativeCaption=(facts:BrandFact[],versions:readonly VersionLite[])=>sourced(facts)?factCaption(facts,versions):labeledCaption(facts);
// 판정 범위(트랙 R R3): 가맹 모집 목적(objective) 캠페인은 가맹 프로필 유무와 관계없이 모집 범위, 가맹 프로필 브랜드의 그 밖 캠페인은 소비자 범위,
// 둘 다 아니면 판정하지 않는다(비가맹 경로 불변). 기능 스위치는 읽지 않는다(저장된 objective 캠페인은 저장값대로 점검하고, 끄는 길은 목적 해제다).
const claimScope=(campaign:Pick<Campaign,'objective'>,fr:FranchiseContext):ClaimScope|null=>isRecruitmentObjective(campaign)?'recruitment':fr.profile?'consumer':null;
// 사실 사용·각주 검사 범위: 가맹 문맥(프로필·정보공개서 버전) 브랜드와 objective 캠페인.
const factScope=(campaign:Pick<Campaign,'objective'>,fr:FranchiseContext)=>hasFranchiseContext(fr)||isRecruitmentObjective(campaign);
// 사실 사용 게이트(가맹 문맥 브랜드·objective 캠페인): 수익 항목(H6)·근거 없는 가맹 항목·교체된 정보공개서 버전의 사실은 소재·발행에 쓰지 않는다.
function franchiseFactGate(campaign:Pick<Campaign,'objective'>,fr:FranchiseContext,facts:BrandFact[]){
 if(!factScope(campaign,fr))return;
 const issues=franchiseFactUseIssues(facts,fr.versions,stamp());
 if(issues.length)throw new ApiError(409,issues[0].message);
}
// 가맹 모집 규칙 판정(트랙 R R2·R3): 판정 범위(claimScope)가 있는 캠페인만 캡션 본문을 직접 판정한다(원장 해소·[확인 필요] 면제·인용 강등 없음).
// facts는 캠페인 범위의 유효 확정 사실(sourceRef 포함), at은 규칙 선택 시각(발행 예약 시각, 소재·카피는 지금)이다. 범위가 없으면 null(비가맹 경로 불변).
// 규칙 선택 시각은 시간대 있는 ISO 시각만 쓴다. 저장 기록의 예약 시각을 읽을 수 없으면 지금 시각 규칙으로 판정한다(판정을 건너뛰지 않는다).
const ruleTime=(at:string)=>isInstant(at)?at:stamp();
function franchiseJudgement(campaign:Campaign,fr:FranchiseContext,facts:BrandFact[],text:string,at:string):FranchiseJudgement|null{
 const scope=claimScope(campaign,fr);
 return scope?judgeFranchiseText({text,at:ruleTime(at),now:stamp(),scope,brandId:campaign.brandId,facts,versions:fr.versions}):null;
}
// 차단(해제 불가·근거 필요)이면 409. 승인 입력 확인란·역할(대표 포함)은 이 판정을 바꾸지 못한다.
function assertFranchiseText(j:FranchiseJudgement|null){const e=j&&franchiseGateError(j);if(e)throw new ApiError(e.status,e.message)}
// 소재 입력 지문(exec-loop-8): 브랜드 이름·색, 사실 {id,version}, 캡션. 입력이 같으면 브리프 버전이 바뀌어도 소재를 다시 만들 필요가 없다.
export async function materialHash(brand:Pick<Brand,'name'|'color'>,refs:FactRef[],caption:string){return sha256(new TextEncoder().encode(JSON.stringify([brand.name,brand.color,refs.map(r=>[r.id,r.version]),caption])))}
async function creativeCurrent(campaign:Campaign,brand:Brand|null,facts:BrandFact[],c:ExecutionCreative,versions:readonly VersionLite[]){
 const used=c.factRefs.map(r=>facts.find(f=>f.id===r.id&&f.version===r.version));
 // 지점 연결 전에 만든 소재는 접수 때 currentCreative가 거부하므로 화면에서도 현재 소재가 아니다(R4).
 if(used.some(f=>!f)||!brand||c.storeId!==campaign.storeId)return false;
 if(!c.materialHash)return c.campaignVersion===campaign.version;
 const caption=creativeCaption(used as BrandFact[],versions);
 return caption!==null&&c.materialHash===await materialHash(brand,c.factRefs,caption);
}
export async function getExecution(owner:string,campaign:Campaign):Promise<ExecutionState>{
 const [creatives,publications,limits,credential,brand,facts,copies,fr]=await Promise.all([listRecords<ExecutionCreative>(owner,'execution_creative',campaign.id),listRecords<Publication>(owner,'execution_publication',campaign.id),optionalRecord<ExecutionLimits>(owner,'execution_limits',campaign.id),optionalRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId),optionalRecord<Brand>(owner,'brand',campaign.brandId),confirmedFactContext(owner,campaign.brandId,campaign.storeId),captionCandidates(owner,campaign),loadFranchiseContext(owner,campaign.brandId)]);
 // 정보공개서 버전은 근거 있는 가맹 사실의 각주 계산에만 쓰인다(근거 없는 사실의 캡션은 버전과 무관하다).
 const current=await Promise.all(creatives.map(c=>creativeCurrent(campaign,brand,facts,c,fr.versions)));
 const state:ExecutionState={creatives:creatives.map((c,i)=>({...c,objectKey:'',current:current[i]})),publications,limits,publisher:credential?{connected:true,channelId:credential.channelId,account:credential.account,version:credential.version}:{connected:false},copies,copyCaptions:aiCopyCaptionsEnabled()};
 // 판정 범위가 없는 캠페인(가맹 프로필 없는 브랜드의 소비자 캠페인)은 franchise 키가 없다(비가맹 응답 불변).
 const scope=claimScope(campaign,fr);
 return scope?{...state,franchise:franchiseExecution(campaign,scope,fr,facts,publications)}:state;
}
// 발행 화면의 가맹 정보(트랙 R R2). 초안·승인 발행마다 서버 승인 게이트와 같은 조건(사실 사용·각주·가맹 규칙 판정)의 차단 사유를 계산한다.
// 모집 범위(objective 캠페인)는 소비자 캠페인 안내(recruitmentWarning)를 싣지 않고, 가맹 프로필이 없으면 branch가 null이다. 키 순서는 소비자 범위와 같다.
function franchiseExecution(campaign:Campaign,scope:ClaimScope,fr:FranchiseContext,facts:BrandFact[],publications:Publication[]):FranchiseExecution{
 const versions=fr.versions,branch=fr.profile?.branch??null,now=stamp(),states=versionStates(versions,now),live=publications.filter(p=>p.status==='draft'||p.status==='approved');
 const byId=new Map(franchiseFactUseIssues(facts,versions,now).map(x=>[x.id,x.message]));
 const verdicts=Object.fromEntries(live.map(p=>{
  const used=p.factRefs.flatMap(r=>facts.filter(f=>f.id===r.id&&f.version===r.version));
  const labels=franchiseIssueLabels(judgeFranchiseText({text:p.caption,at:ruleTime(p.scheduledAt),now,scope,brandId:campaign.brandId,facts,versions}));
  const factUse=[...new Set(used.flatMap(f=>byId.has(f.id)?[byId.get(f.id)!]:[]))];
  const mentioned=mentionedFranchiseFacts({text:p.caption,now,brandId:campaign.brandId,facts,versions});
  const footnote=footnoteIssues(p.caption,{used:used.filter(f=>!!f.sourceRef),mentioned},versions).length?[FRANCHISE_FACT_MESSAGES.footnoteMissing]:[];
  return [p.id,{blockers:[...factUse,...footnote,...labels.blockers],warnings:labels.warnings}];
 }));
 const text=[campaign.title,campaign.goal,campaign.audience,campaign.channels,...live.map(p=>p.caption)].filter(x=>typeof x==='string').join('\n');
 return {scope,branch,versions:versions.map(v=>({id:v.id,label:v.label,registeredAt:v.registeredAt,state:states[v.id]})),blockedFacts:[...byId].map(([id,reason])=>({id,reason})),publications:verdicts,
  recruitmentWarning:scope==='consumer'&&branch!==null&&recruitmentLike(text)?recruitmentWarning(branch):null,notice:COMPLIANCE_NOTICE,disclaimer:GATE_DISCLAIMER};
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
// 결정 17(AI 생성물 표시·규제 검토 책임): 표시 줄(lib/ai-disclosure.ts)·승인 게이트의 표시 확인은 구현됐다. 표시 문구는 대표·법률 검토 전 초안이라
// 대표가 문구를 확정하고 docs/AI-DISCLOSURE.ko.md 체크리스트를 마친 뒤 AI_COPY_CAPTIONS=enabled로 켠다. 꺼져 있으면 작업물 카피를 캡션에 쓰지 않는다. 확인 사실 문구만 쓰는 캡션은 영향이 없다.
export const aiCopyCaptionsEnabled=()=>runtime.AI_COPY_CAPTIONS==='enabled';
// 출처가 없거나 알 수 없는 작업물은 AI 생성물 여부를 판정할 수 없어 캡션에 쓰지 않는다(결정 17, 표시 누락 방지).
const UNKNOWN_ORIGIN='작업물 출처 불명(AI 생성물 여부를 판정할 수 없음)';
export async function captionCandidates(owner:string,campaign:Campaign):Promise<CaptionCandidate[]>{
 if(!aiCopyCaptionsEnabled())return [];
 const artifacts=(await listRecords<Artifact>(owner,'artifact',campaign.id)).filter(a=>copySource(a,campaign));
 if(!artifacts.length)return [];
 const [{facts},fr]=await Promise.all([evidenceContext(database(),owner,campaign),loadFranchiseContext(owner,campaign.brandId)]);
 // 판정 범위가 있는 캠페인(가맹 모집 목적 또는 가맹 프로필 브랜드): 가맹 규칙 차단은 issues(고를 수 없음), 경고는 warnings. 판정 입력은 모델 입력(evidenceContext)이 아니라 sourceRef가 있는 확정 사실이다.
 const frFacts=claimScope(campaign,fr)?await confirmedFactContext(owner,campaign.brandId,campaign.storeId):[],now=stamp();
 return artifacts.flatMap(a=>copyBlocks(a.content).map((text,index)=>{
  const candidate:CaptionCandidate={artifactId:a.id,artifactVersion:a.version,index,text,issues:[...captionIssues(text,facts),...(hasKnownOrigin(a)?[]:[UNKNOWN_ORIGIN])],aiGenerated:isAiGenerated(a)};
  const j=franchiseJudgement(campaign,fr,frFacts,text,now);
  if(!j)return candidate;
  const labels=franchiseIssueLabels(j);
  return {...candidate,issues:[...candidate.issues,...labels.blockers],warnings:labels.warnings};
 }));
}
async function approvedCopy(owner:string,campaign:Campaign,input:unknown,fr?:FranchiseContext):Promise<PublicationCopy>{
 if(!aiCopyCaptionsEnabled())throw new ApiError(409,'AI 작업물 카피를 캡션에 쓰는 기능은 대표가 AI 생성물 표시 문구(결정 17)를 확정할 때까지 꺼져 있습니다. 확인 사실 문구만으로 발행하세요.');
 const ref=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;
 const artifact=await readRecord<Artifact>(owner,'artifact',str(ref.artifactId,'카피 작업물',100,true));
 if(!copySource(artifact,campaign)||artifact.version!==ref.artifactVersion)throw new ApiError(409,'카피 작업물이 현재 브리프에서 승인된 버전이 아닙니다. 캡션 후보를 다시 불러오세요.');
 if(!hasKnownOrigin(artifact))throw new ApiError(409,'이 카피는 캡션에 쓸 수 없습니다: '+UNKNOWN_ORIGIN);
 const index=typeof ref.index==='number'?ref.index:-1,text=copyBlocks(artifact.content)[index];
 if(!text)throw new ApiError(400,'캡션 후보를 선택하세요.');
 const issues=captionIssues(text,(await evidenceContext(database(),owner,campaign)).facts);
 if(issues.length)throw new ApiError(409,'이 카피는 캡션에 쓸 수 없습니다: '+issues.join(', '));
 // 가맹 규칙(트랙 R R2): 카피 본문을 지금 시각 규칙으로 판정한다. 캡션 전체는 발행 준비·승인 때 예약 시각 규칙으로 다시 판정한다.
 const context=fr??await loadFranchiseContext(owner,campaign.brandId);
 if(claimScope(campaign,context))assertFranchiseText(franchiseJudgement(campaign,context,await confirmedFactContext(owner,campaign.brandId,campaign.storeId),text,stamp()));
 // AI 생성물 여부는 작업물 출처(origin)에서 파생해 발행에 기록한다(결정 17). 캡션 표시 줄과 승인 게이트가 이 값을 쓴다.
 return {artifactId:artifact.id,artifactVersion:artifact.version,index,text,aiGenerated:isAiGenerated(artifact)};
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
function toDraft(p:Publication,reason:string):Publication{return {...p,status:'draft',version:p.version+1,mediaUrl:p.mediaMode==='auto'?'':p.mediaUrl,channelId:undefined,credentialVersion:undefined,limitsVersion:undefined,approvedLimits:undefined,approvedBy:undefined,approvedAt:undefined,aiDisclosureConfirmedBy:undefined,aiDisclosureConfirmedAt:undefined,needsReview:undefined,invalidatedReason:reason,updatedAt:stamp()}}
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
// 소재 제목(exec-loop-4 (3)): 선택. 앞뒤 공백을 빼고 1~60자. 비우면 저장하지 않는다(기존 소재와 같은 모양).
function creativeTitle(value:unknown){
 if(value===undefined||value===null)return '';
 const title=str(value,'소재 제목',1000);
 if(title.length>CREATIVE_TITLE_MAX)throw new ApiError(400,`소재 제목은 ${CREATIVE_TITLE_MAX}자 이하로 입력하세요.`);
 return title;
}
export async function saveCreative(owner:string,campaign:Campaign,input:Record<string,unknown>){
 assertVersion(campaign,input.campaignVersion);
 const title=creativeTitle(input.title);
 const facts=await resolveFacts(owner,campaign,input.factRefs),fr=await loadFranchiseContext(owner,campaign.brandId);
 franchiseFactGate(campaign,fr,facts);
 const caption=creativeCaption(facts,fr.versions);
 if(caption===null)throw new ApiError(409,FRANCHISE_FACT_MESSAGES.staleFact);
 if(caption.length>1800)throw new ApiError(400,'선택한 사실이 너무 깁니다. 짧은 안내 사실을 선택하세요.');
 if(claimScope(campaign,fr))assertFranchiseText(franchiseJudgement(campaign,fr,await confirmedFactContext(owner,campaign.brandId,campaign.storeId),caption,stamp()));
 const bytes=await pngBytes(input.png),hash=await sha256(bytes),refs=facts.map(f=>({id:f.id,version:f.version}));
 const material=await materialHash(await readRecord<Brand>(owner,'brand',campaign.brandId),refs,caption);
 const prior=(await listRecords<ExecutionCreative>(owner,'execution_creative',campaign.id)).find(c=>c.pngHash===hash&&c.materialHash===material);
 // 같은 PNG·입력이면 기존 소재를 돌려준다. 제목은 해시·캡션에 들어가지 않으므로 제목이 없던 소재에는 제목만 붙인다.
 // 버전은 올리지 않는다(발행의 소재 버전 비교가 바뀌지 않게). 다른 제목이 이미 있으면 조용히 버리지 않고 409로 알린다.
 if(prior){
  if(!title||prior.title===title)return {...prior,objectKey:''};
  if(prior.title)throw new ApiError(409,`같은 소재가 이미 '${prior.title}' 제목으로 있어 제목을 바꾸지 않았습니다.`);
  const named:ExecutionCreative={...prior,title};await recordStatement(owner,'execution_creative',prior.id,named,campaign.id).run();return {...named,objectKey:''};
 }
 if((await listRecords<ExecutionCreative>(owner,'execution_creative')).length>=200)throw new ApiError(409,'소재 보관 한도 200개에 도달했습니다. 관리자에게 보관 정책을 문의하세요.');
 const id=uid();
 return storePngThen(owner,id,bytes,async objectKey=>{
  const creative:ExecutionCreative={id,campaignId:campaign.id,campaignVersion:campaign.version,brandId:campaign.brandId,...(campaign.storeId?{storeId:campaign.storeId}:{}),version:1,factRefs:refs,caption,pngHash:hash,objectKey,materialHash:material,...(title?{title}:{}),createdAt:stamp()};
  await recordStatement(owner,'execution_creative',id,creative,campaign.id).run();return {...creative,objectKey:''};
 });
}
// 현재 소재와 그 사실·가맹 문맥. 발행 준비·승인·접수가 같이 쓴다.
async function currentCreativeInputs(owner:string,campaign:Campaign,id:string){
 const c=await readRecord<ExecutionCreative>(owner,'execution_creative',id);
 if(c.campaignId!==campaign.id||c.brandId!==campaign.brandId||c.storeId!==campaign.storeId)throw new ApiError(404,'이 캠페인의 소재가 아닙니다.');
 const facts=await resolveFacts(owner,campaign,c.factRefs),fr=await loadFranchiseContext(owner,campaign.brandId);
 if(!c.materialHash){if(c.campaignVersion!==campaign.version)throw new ApiError(409,'브리프가 변경됐습니다. 새 소재를 만들어 주세요.');return {creative:c,facts,fr}}
 const caption=creativeCaption(facts,fr.versions);
 if(caption===null)throw new ApiError(409,FRANCHISE_FACT_MESSAGES.staleFact);
 if(c.materialHash!==await materialHash(await readRecord<Brand>(owner,'brand',campaign.brandId),c.factRefs,caption))throw new ApiError(409,'소재 입력(브랜드 이름·색·사실·캡션)이 바뀌었습니다. 새 소재를 만들어 주세요.');
 return {creative:c,facts,fr};
}
export async function currentCreative(owner:string,campaign:Campaign,id:string){return (await currentCreativeInputs(owner,campaign,id)).creative}
// 가맹 사실 게이트·가맹 규칙 판정·각주 검사(트랙 R R1b·R2). 순서: 사실 사용(H6·근거 없음·교체 버전) → 가맹 규칙 판정(가맹 프로필 브랜드, at 시각 규칙) → 각주.
// 각주: 캡션에 쓴 근거 있는 가맹 사실(used)과 캡션·카피에 값이 나온 현재 가맹 사실(mentioned)마다 정보공개서 각주 줄이 그대로 있어야 한다(각주를 지운 캡션 409).
// 가맹 문맥(프로필·버전)이 없는 브랜드의 소비자 캠페인은 사실 조회 없이 끝난다(비가맹 경로 불변). objective 캠페인은 가맹 문맥이 없어도 모집 범위로 판정한다(R3).
async function franchiseCaptionGate(owner:string,campaign:Campaign,fr:FranchiseContext,used:BrandFact[],caption:string,at:string){
 franchiseFactGate(campaign,fr,used);
 if(!factScope(campaign,fr))return;
 const facts=await confirmedFactContext(owner,campaign.brandId,campaign.storeId);
 assertFranchiseText(franchiseJudgement(campaign,fr,facts,caption,at));
 const mentioned=mentionedFranchiseFacts({text:caption,now:stamp(),brandId:campaign.brandId,facts,versions:fr.versions});
 if(footnoteIssues(caption,{used:used.filter(f=>!!f.sourceRef),mentioned},fr.versions).length)throw new ApiError(409,FRANCHISE_FACT_MESSAGES.footnoteMissing);
}
// A4-2 게시 코드 선택: 쿠폰·POS 태그만 캡션에 넣는다. 지점 캠페인은 그 지점(다른 지점 거절), 브랜드 공통 캠페인은 같은 브랜드의 운영 지점을 골라야 한다.
async function publicationCodeChoice(owner:string,campaign:Campaign,raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiError(400,'게시 코드 입력 형식을 확인하세요.');
 const choice=raw as Record<string,unknown>,type=choice.type;
 if(type!=='coupon'&&type!=='pos_tag')throw new ApiError(400,'게시 코드 유형(쿠폰·POS 태그)을 선택하세요.');
 const storeId=choice.storeId===undefined||choice.storeId===null||choice.storeId===''?campaign.storeId||'':str(choice.storeId,'코드 지점',100);
 if(!storeId)throw new ApiError(400,'브랜드 공통 캠페인은 코드를 쓸 지점을 선택하세요.');
 if(campaign.storeId&&storeId!==campaign.storeId)throw new ApiError(409,'이 캠페인에 연결된 지점에만 게시 코드를 발급할 수 있습니다.');
 const store=await optionalRecord<Store>(owner,'store',storeId);
 if(!store||store.brandId!==campaign.brandId)throw new ApiError(409,'이 캠페인 브랜드의 지점이 아닙니다. 같은 브랜드의 지점을 고르세요.');
 if(store.status==='archived')throw new ApiError(409,'보관된 지점에는 게시 코드를 발급할 수 없습니다.');
 return {type,storeId} as {type:PublicationCode['type'];storeId:string};
}
// 코드 발급 뒤 발행 저장이 실패하면 발행이 없는 코드가 남는다. 같은 캠페인·소재·지점·유형으로 다시 준비하면 그 코드의 발행 id를 그대로 써서
// 멱등 발급(issuePublicationCode)이 같은 코드를 돌려주게 한다. 재시도해도 코드가 늘지 않는다. 호출자는 owner 변경 잠금을 가진다.
async function publicationIdFor(owner:string,campaign:Campaign,creativeId:string,choice:{type:string;storeId:string},existing:Publication[]){
 const orphan=(await listRecords<TrackingCode>(owner,'tracking_code',choice.storeId)).find(c=>!!c.publicationId&&c.campaignId===campaign.id&&c.creativeId===creativeId&&c.type===choice.type&&!existing.some(p=>p.id===c.publicationId));
 return orphan?.publicationId||uid();
}
function schedule(value:unknown){const date=str(value,'예약 시각',50,true);if(!Number.isFinite(Date.parse(date))||Date.parse(date)<Date.now()+300000)throw new ApiError(400,'예약은 현재보다 5분 이상 뒤로 설정하세요.');return new Date(date).toISOString()}
// 외부 주소를 비우거나 앱 공개 주소를 넣으면 auto: 승인 때 앱이 /media/<sha256>.png를 채운다(exec-loop-2). Cloudinary·R2는 고급 옵션(external)이다.
export async function savePublication(owner:string,campaign:Campaign,input:Record<string,unknown>,origin:string,who?:Who|null){
 const {creative,facts:used,fr}=await currentCreativeInputs(owner,campaign,str(input.creativeId,'소재',100,true));
 const scheduledAt=schedule(input.scheduledAt);await resolveFacts(owner,campaign,creative.factRefs,Date.parse(scheduledAt));
 const raw=str(input.mediaUrl??'','공개 이미지',2000),checked=raw?mediaUrl(raw,creative.pngHash,origin):'',mediaMode=!checked||isOwnMediaUrl(checked,origin)?'auto' as const:'external' as const;
 const plannedCostKRW=num(input.plannedCostKRW,'예정 비용');
 if(!Number.isSafeInteger(plannedCostKRW))throw new ApiError(400,'예정 비용은 원 단위 정수로 입력하세요.');
 const existing=await listRecords<Publication>(owner,'execution_publication',campaign.id);
 if(existing.length>=200)throw new ApiError(409,'캠페인 발행 기록 한도 200개에 도달했습니다. 새 캠페인으로 준비하세요.');
 if(existing.some(p=>p.creativeId===creative.id&&p.scheduledAt===scheduledAt&&p.status!=='cancelled'))throw new ApiError(409,'같은 소재와 시각의 발행이 이미 있습니다. 기존 발행을 확인하세요.');
 const copy=input.copy?await approvedCopy(owner,campaign,input.copy,fr):undefined;
 const choice=input.trackingCode===undefined||input.trackingCode===null?null:await publicationCodeChoice(owner,campaign,input.trackingCode);
 // 코드 발급 전에 가맹 사실 게이트·가맹 규칙(예약 시각 규칙)·각주를 확인한다(막히면 코드가 발급되지 않는다).
 await franchiseCaptionGate(owner,campaign,fr,used,composeCaption(copy,creative.caption),scheduledAt);
 // 한도는 AI 생성물 표시 줄·코드 줄을 포함해 검사한다. 발급 전에는 가장 긴 코드(CODE_MAX자)로 재서, 발급 뒤에는 저장만 남게 한다(한도 때문에 발급한 코드가 버려지지 않게).
 const extraLines=[...(copy?.aiGenerated?['AI 생성물 표시 줄']:[]),...(choice?['게시 코드 줄']:[])].join('·');
 if(composeCaption(copy,creative.caption,choice?{type:choice.type,code:CODE_ALPHABET[0].repeat(CODE_MAX)}:undefined).length>2200)throw new ApiError(400,(extraLines?extraLines+'을 포함한 캡션이':'캡션이')+' Instagram 한도 2,200자를 넘습니다. 더 짧은 카피를 고르'+(choice?'거나 코드 없이 준비하세요.':'세요.'));
 if(choice&&!who)throw new ApiError(403,'게시 코드 발급은 관리자만 할 수 있습니다.');
 const id=choice?await publicationIdFor(owner,campaign,creative.id,choice,existing):uid();
 const issued=choice&&who?await issuePublicationCode(owner,{campaign,publicationId:id,creativeId:creative.id,storeId:choice.storeId,type:choice.type,who:{id:who.id,email:who.email}}):null;
 // 멱등 발급은 이미 있는 코드를 돌려준다. 캡션 코드 줄과 발행 기록이 선택과 다른 코드를 가리키지 않게 확인한다.
 if(issued&&choice&&(issued.type!==choice.type||issued.storeId!==choice.storeId||issued.publicationId!==id))throw new ApiError(409,'게시 코드 발급 결과가 선택한 유형·지점과 다릅니다. 새로고침 후 다시 준비하세요.');
 const trackingCode:PublicationCode|undefined=issued&&choice?{id:issued.id,code:issued.code,type:choice.type,storeId:issued.storeId}:undefined;
 const caption=composeCaption(copy,creative.caption,trackingCode);
 const p:Publication={id,campaignId:campaign.id,creativeId:creative.id,creativeVersion:creative.version,campaignVersion:campaign.version,pngHash:creative.pngHash,factRefs:creative.factRefs,caption,...(copy?{copy}:{}),...(trackingCode?{trackingCode}:{}),mediaUrl:mediaMode==='auto'?'':checked,mediaMode,scheduledAt,plannedCostKRW,version:1,status:'draft',createdAt:stamp()};
 await recordStatement(owner,'execution_publication',p.id,p,campaign.id).run();return p;
}
export async function publicationFor(owner:string,campaign:Campaign,id:unknown,version:unknown){
 const p=await readRecord<Publication>(owner,'execution_publication',str(id,'발행',100,true));
 if(p.campaignId!==campaign.id)throw new ApiError(404,'이 캠페인의 발행이 아닙니다.');assertVersion(p,version);return p;
}
export async function approvalInputs(owner:string,campaign:Campaign,p:Publication){
 const gate=campaignGateIssues(campaign,p.scheduledAt);if(gate.length)throw new ApiError(409,gate.join(' '));
 const {creative,facts:used,fr}=await currentCreativeInputs(owner,campaign,p.creativeId);
 // 스위치를 켠 뒤 표시 문구 상수가 바뀌면 남은 초안·승인의 캡션에는 이전 표시 줄이 있다. 재확인으로는 캡션이 바뀌지 않으므로 취소·재준비를 안내한다(결정 17).
 if(p.copy?.aiGenerated===true&&!p.caption.includes(AI_DISCLOSURE_LINE))throw new ApiError(409,'AI 생성물 표시 문구가 준비 뒤 바뀌었습니다. 이 발행을 취소하고 다시 준비하세요.');
 if(creative.version!==p.creativeVersion||creative.pngHash!==p.pngHash||composeCaption(p.copy,creative.caption,p.trackingCode)!==p.caption)throw new ApiError(409,'소재가 변경됐습니다. 다시 준비하세요.');
 // 기록된 AI 생성물 판정(이 필드 이전 기록 포함)이 작업물 출처와 다르면 캡션 표시 줄이 맞지 않으므로 다시 준비하게 한다(결정 17).
 if(p.copy){const copy=await approvedCopy(owner,campaign,p.copy,fr);if(copy.text!==p.copy.text)throw new ApiError(409,'카피 작업물이 바뀌었습니다. 캡션 후보를 다시 고르세요.');if(copy.aiGenerated!==(p.copy.aiGenerated===true))throw new ApiError(409,'카피 작업물의 AI 생성물 판정이 준비 때와 다릅니다. 이 발행을 취소하고 캡션 후보를 다시 골라 준비하세요.')}
 // 가맹 사실 게이트·가맹 규칙·각주(트랙 R R1b·R2). 소재·발행 두 행의 캡션을 함께 고쳐 각주를 지워도 여기서 막는다. 승인 입력 확인란·역할(대표 포함)로는 풀리지 않는다.
 await franchiseCaptionGate(owner,campaign,fr,used,p.caption,p.scheduledAt);
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
 // 보관 캠페인은 발행을 승인하지 않는다(409, 보관 해제 후 다시).
 assertNotArchived(campaign);
 const external=p.mediaMode!=='auto';
 if(p.status!=='draft'||input.confirmed!==true||input.rightsConfirmed!==true||(external&&input.immutableMediaConfirmed!==true))throw new ApiError(400,external?'PNG·사실·사용 권리·공개 파일 유지 조건을 확인하고 승인하세요.':'PNG·사실·사용 권리를 확인하고 승인하세요.');
 // 결정 17: AI 카피 발행은 캡션 끝 표시 줄을 확인했다는 체크(aiDisclosureConfirmed:true)가 있어야 승인한다. 확인자·시각은 승인자와 같은 방식으로 남긴다.
 const aiCopy=p.copy?.aiGenerated===true;
 if(aiCopy&&input.aiDisclosureConfirmed!==true)throw new ApiError(409,'AI 카피를 쓴 발행입니다. 캡션 끝 표시 문구를 확인하고 AI 생성물 표시를 확인하세요.');
 const {credential,limits}=await approvalInputs(owner,campaign,p);
 const changed=[...(input.channelId!==credential.channelId||input.credentialVersion!==credential.version?['발행 계정']:[]),...(input.limitsVersion!==limits.version?['발행 횟수 한도']:[])];
 if(changed.length)throw new ApiError(409,`화면에 표시된 정보가 변경됐습니다(${changed.join(', ')}). 새로고침하고 다시 확인하세요.`);
 // 자동 모드는 승인된 발행만 앱 공개 주소로 제공한다. 외부 호스트는 원본 해시와 같은지 확인한다.
 let url=p.mediaUrl;if(external)await verifyMedia(p.mediaUrl,p.pngHash,origin);else url=await publishPublicMedia(owner,p.pngHash,p.id,origin);
 const approved:Publication={...p,status:'approved',version:p.version+1,mediaUrl:url,channelId:credential.channelId,credentialVersion:credential.version,limitsVersion:limits.version,approvedLimits:{maxPublications:limits.maxPublications,maxPlannedCostKRW:limits.maxPlannedCostKRW},approvedBy:who.id,approvedAt:stamp(),...(aiCopy?{aiDisclosureConfirmedBy:who.id,aiDisclosureConfirmedAt:stamp()}:{}),invalidatedReason:undefined,updatedAt:stamp()};
 try{await recordStatement(owner,'execution_publication',p.id,approved,campaign.id).run()}catch(e){if(!external)await retirePublicMedia(owner,p.pngHash,p.id).catch(()=>{});throw e}
 return approved;
}
// Called with the owner mutation lock. Persist the attempt BEFORE any publish call.
export async function reservePublication(owner:string,campaign:Campaign,p:Publication,origin:string){
 assertNotArchived(campaign);
 if(p.status!=='approved'||p.attemptedAt)throw new ApiError(409,'승인된 미실행 항목만 접수할 수 있습니다. 재전송하지 마세요.');
 const {credential,limits}=await approvalInputs(owner,campaign,p);
 const drift=approvalDrift(p,credential,limits);
 // 사용한 사실이 바뀌면 사실 버전이 달라져 같은 소재로 다시 승인할 수 없다. 취소하고 새 PNG로 준비하게 안내한다.
 if(drift.length)throw new ApiError(409,`승인 뒤 바뀐 항목: ${drift.join(', ')}. `+(p.needsReview?'이 발행을 취소하고 새 PNG로 새 초안을 만드세요.':"'재확인'으로 초안에 되돌린 뒤 다시 승인하세요."));
 const total=executionTotals(await listRecords<Publication>(owner,'execution_publication',campaign.id));
 // 횟수와 비용 중 무엇이 막았는지 따로 알린다(exec-loop-10). 참고로 입력한 예정 비용도 0원보다 크면 상한에 포함된다.
 if(total.attempts>=limits.maxPublications)throw new ApiError(409,`발행 횟수 한도를 초과합니다(누적 발행 시도 ${total.attempts}회 · 한도 ${limits.maxPublications}회).`);
 if(total.plannedCostKRW+p.plannedCostKRW>limits.maxPlannedCostKRW)throw new ApiError(409,`예정 비용 상한을 초과합니다(누적 ${total.plannedCostKRW.toLocaleString('ko-KR')}원 + 이번 ${p.plannedCostKRW.toLocaleString('ko-KR')}원 · 상한 ${limits.maxPlannedCostKRW.toLocaleString('ko-KR')}원).`);
 await verifyMedia(p.mediaUrl,p.pngHash,origin);
 const token=await decrypt(credential.secret);
 const pending:Publication={...p,status:'submitting',attemptedAt:stamp(),updatedAt:stamp(),version:p.version+1};
 await publicationKeepingReview(owner,pending,campaign.id).run();
 return {pending,token};
}
// 발행 행 전체 쓰기(접수 예약·상태 조회). owner 잠금 밖에서 붙는 재검토 표시(가맹 정보공개서 버전 교체, lib/franchise-server.ts versionFactReview)가
// 읽은 뒤 쓰기 전에 붙었으면 지우지 않는다(saveProviderResult와 같은 취지). 새 행에 재검토 표시가 있거나 저장된 행에 없으면 recordStatement와 같은 바이트다.
export function publicationKeepingReview(owner:string,p:Publication,campaignId:string){
 return database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=CASE WHEN json_extract(records.data,'$.needsReview') IS NOT NULL AND json_extract(excluded.data,'$.needsReview') IS NULL THEN json_set(excluded.data,'$.needsReview',json(json_extract(records.data,'$.needsReview'))) ELSE excluded.data END, updated_at=excluded.updated_at WHERE records.owner=excluded.owner")
  .bind(`${owner}:execution_publication:${p.id}`,owner,'execution_publication',campaignId,JSON.stringify(p),stamp());
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
// extra: 상태 변경과 한 묶음으로 쓸 추가 기록(B1 판정 로그). 하나라도 실패하면 상태도 바뀌지 않는다.
export async function cancelPublication(owner:string,campaign:Campaign,p:Publication,extra:D1PreparedStatement[]=[]){
 if(p.status!=='draft'&&p.status!=='approved')throw new ApiError(409,'이미 접수한 항목은 Buffer에서 예약 상태와 취소 여부를 확인하세요.');
 const cancelled:Publication={...p,status:'cancelled',version:p.version+1,updatedAt:stamp()};await database().batch([recordStatement(owner,'execution_publication',p.id,cancelled,campaign.id),...extra]);
 await retireMedia(owner,[p]);return cancelled;
}
// exec-loop-8: 무효화된 승인을 새 버전의 초안으로 되돌린다. 바뀐 소재·사실·한도는 다시 승인할 때 검사한다.
export async function reconfirmPublication(owner:string,campaign:Campaign,p:Publication,who:Who,extra:D1PreparedStatement[]=[]){
 if(p.status!=='approved'||p.attemptedAt)throw new ApiError(409,'승인 후 접수하지 않은 발행만 재확인할 수 있습니다.');
 const draft:Publication={...toDraft(p,'관리자 재확인'),reconfirmedBy:who.id,reconfirmedAt:stamp()};
 await database().batch([recordStatement(owner,'execution_publication',p.id,draft,campaign.id),eventStatement(owner,campaign.id,'발행 재확인 · 승인을 초안으로 되돌렸습니다. 바뀐 항목을 확인하고 다시 승인하세요.',who),...extra]);
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
