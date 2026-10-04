import type {Campaign} from './agency';
import type {CandidateInput} from './growth-optimization';
import type {LandingRecord} from './growth-landing-server';
import type {GrowthExperimentRecord} from './growth-experiment-server';
import {growthView} from './growth-workspace-server';
import {landingReadiness,parseLandingProposal} from './growth-landing';
import {checkCompliance,COMPLIANCE_LEXICON} from './graders/compliance';
import {growthProviderProductDigest} from './growth-provider';
import {inCampaign,optionalRecord} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database} from './server';
import type {BrandFact} from './brand-facts';

const GATE_VERSION='growth-content-readiness-v1';
export type ContentEvaluation={kind:'deterministic_content';candidateKind:'landing_copy'|'offer_message';targetId:string;targetVersion:number;source:unknown;sourceDigest:string;basis:unknown;basisDigest:string;stockObservation:unknown;stockObservationDigest:string;gateVersion:string};
type Candidate={id:string;input:Pick<CandidateInput,'candidateKind'|'targetRef'>;contentEvaluation?:ContentEvaluation|null};
function fail(message:string):never{throw new ApiError(409,message)}
const sorted=<T extends {id:string}>(values:T[])=>[...values].sort((a,b)=>a.id.localeCompare(b.id));
const stableRow=<T extends {id:string;version:number}>(row:T)=>Object.fromEntries(Object.entries(row).filter(([key])=>!['readiness','currentStock'].includes(key))) as Omit<T,'readiness'|'currentStock'>;
async function originalFacts(owner:string,c:Campaign){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='brand_fact' AND parent_id=? LIMIT 501").bind(owner,c.brandId).all<{data:string}>();
 if(rows.results.length>500)fail('사실 원장 범위를 줄여 다시 검사하세요.');
 return sorted(rows.results.map(x=>JSON.parse(x.data) as BrandFact).filter(f=>f.brandId===c.brandId&&(!f.storeId||f.storeId===c.storeId)));
}
async function context(owner:string,c:Campaign,r:Candidate){
 if(!['landing_copy','offer_message'].includes(r.input.candidateKind))fail('문구·오퍼 원문 검사 대상이 아닙니다.');
 const view=await growthView(owner,c,false),landing=r.input.candidateKind==='landing_copy'?await optionalRecord<LandingRecord>(owner,'growth_landing_revision',r.input.targetRef):null;
 if(r.input.candidateKind==='landing_copy'&&(!landing||!inCampaign(landing,c)))fail('현재 캠페인의 상세 문구 판을 선택하세요.');
 const offer=view.offers.find(o=>o.id===(landing?.input.offerId??r.input.targetRef));
 if(!offer)fail('현재 캠페인의 오퍼를 선택하세요.');
 const catalog=view.catalogs.find(x=>x.id===offer.input.catalogId),need=view.needs.find(x=>x.id===offer.input.needId),facts=await originalFacts(owner,c);
 const signals=sorted(view.signals.filter(x=>need?.input.signalIds.includes(x.id))),journey=landing?.input.journeyId?await optionalRecord<{id:string;brandId:string;campaignId:string;version:number}>(owner,'growth_journey',landing.input.journeyId):null;
 const stock=catalog?.currentStock??null,stockIdentity=stock?{inventoryId:stock.inventoryId,unit:stock.unit,sku:catalog?.input.sku}:null;
 const source=landing??stableRow(offer),basis={campaign:{id:c.id,brandId:c.brandId,storeId:c.storeId??null,version:c.version},offer:stableRow(offer),catalog:catalog?stableRow(catalog):null,need:need?stableRow(need):null,signals,facts,journey,stockIdentity};
 const reasons=[...offer.readiness.missing];
 if(landing){
  const input=parseLandingProposal(landing.input),snapshot=landing.snapshot;
  reasons.push(...landingReadiness(input,{offerPrice:offer.input.price,priceApproved:offer.input.priceApproved,rightsConfirmed:catalog?.input.rightsConfirmed===true,factIds:view.facts.map(f=>f.id),offerLandingUrl:offer.input.landingUrl}).missing);
  if(input.offerVersion!==offer.version||snapshot.offerVersion!==offer.version||snapshot.catalogId!==catalog?.id||snapshot.catalogVersion!==catalog?.version||snapshot.offerPrice!==offer.input.price||snapshot.priceApproved!==offer.input.priceApproved||snapshot.facts.some(ref=>!view.facts.some(f=>f.id===ref.id&&f.version===ref.version)))reasons.push('상세 문구의 상품·오퍼·사실 근거 판을 재검토하세요.');
  if(input.journeyId&&(!journey||!inCampaign(journey,c)||journey.version!==input.journeyVersion||snapshot.journeyVersion!==journey.version))reasons.push('상세 문구의 구매 병목 판을 재검토하세요.');
  if(['withdrawn','rolled_back'].includes(landing.status))reasons.push('철회·복원한 문구는 판매 후보로 사용할 수 없습니다.');
 }
 const text=landing?landing.input.sections.map(section=>section.after).join('\n\n'):[offer.input.title,offer.input.purchaseReason].join('\n\n');
 const compliance=checkCompliance(text,{facts:{confirmed:view.facts.map(f=>({key:f.key,value:f.value})),prohibited:facts.filter(f=>f.status==='rejected').map(f=>({key:f.key,value:f.value}))}});
 reasons.push(...compliance.issues.filter(i=>i.severity==='block').map(i=>`기존 표현 검사: ${i.ruleId}`));
 return {source,basis,stockObservation:stock,reasons:[...new Set(reasons)],landing};
}
export async function freezeContentEvaluation(owner:string,c:Campaign,r:Candidate):Promise<ContentEvaluation>{
 const {source,basis,stockObservation}=await context(owner,c,r);
 return {kind:'deterministic_content',candidateKind:r.input.candidateKind as ContentEvaluation['candidateKind'],targetId:source.id,targetVersion:source.version,source,sourceDigest:await storefrontDigest(source),basis,basisDigest:await storefrontDigest(basis),stockObservation,stockObservationDigest:await storefrontDigest(stockObservation),gateVersion:GATE_VERSION+':'+COMPLIANCE_LEXICON.version};
}
export async function assertContentEvaluation(owner:string,c:Campaign,r:Candidate){
 const e=r.contentEvaluation;
 if(!e||e.kind!=='deterministic_content'||e.targetId!==r.input.targetRef||e.candidateKind!==r.input.candidateKind||e.gateVersion!==GATE_VERSION+':'+COMPLIANCE_LEXICON.version)fail('정확한 원문·근거를 먼저 동결하세요.');
 if(await storefrontDigest(e.source)!==e.sourceDigest||await storefrontDigest(e.basis)!==e.basisDigest||await storefrontDigest(e.stockObservation)!==e.stockObservationDigest)fail('동결 원문·근거 저장값이 변경되었습니다.');
 const current=await freezeContentEvaluation(owner,c,r);
 if(current.targetVersion!==e.targetVersion||current.sourceDigest!==e.sourceDigest||current.basisDigest!==e.basisDigest)fail('원문·상품·오퍼·수요·사실·재고 근거가 변경되었습니다. 새 후보로 다시 검사하세요.');
 return e;
}
/** Original content code checks only. No AI grade, provider call or inferred sales effect. */
export async function collectContentEvaluation(owner:string,c:Campaign,r:Candidate){
 const e=await assertContentEvaluation(owner,c,r),{reasons}=await context(owner,c,r);
 return {id:'content:'+await storefrontDigest({candidate:r.id,evaluation:e}),verdict:reasons.length?'fail' as const:'pass' as const,tokens:0 as const,reasons};
}
async function verifiedLanding(row:LandingRecord){
 const p=row.provider,a=p?.attempt,receipt=p?.applyReceipt;
 if(!row.approval||row.approval.digest!==await storefrontDigest({id:row.id,input:row.input,snapshot:row.snapshot,...(p?{providerBinding:p.binding}:{})}))fail('현재 원문·판매처 binding의 승인 digest가 다릅니다.');
 if(row.status!=='applied'||row.applied?.method!=='provider_verified'||!row.approval||!p||!a||a.operation!=='apply'||a.status!=='verified'||!a.verifiedAt||!receipt||receipt.operation!=='apply'||receipt.status!=='applied'||receipt.requestId!==a.requestId||receipt.productId!==p.binding.productId||receipt.approvalDigest!==row.approval.digest||a.approvalDigest!==row.approval.digest||receipt.beforeDigest!==p.binding.beforeDigest||a.expectedDigest!==p.binding.beforeDigest||await storefrontDigest(a.receipt)!==await storefrontDigest(receipt))fail('동일 문구의 제공자 적용 영수증과 실제 페이지 재조회 확인이 필요합니다.');
 if(await storefrontDigest(p.binding.afterFields)!==await storefrontDigest(a.expectedFields)||receipt.afterDigest!==await growthProviderProductDigest({fields:p.binding.afterFields,version:p.binding.productVersion+1}))fail('적용 문구와 제공자 결과 digest가 다릅니다.');
 if(row.input.sections.length!==1||row.input.sections[0].after!==p.binding.afterFields.description)fail('평가한 전체 문구와 실제 적용 내용이 다릅니다.');
}
export async function contentSalesIntervention(owner:string,c:Campaign,r:Candidate,experiment:GrowthExperimentRecord){
 const e=await assertContentEvaluation(owner,c,r),report=await collectContentEvaluation(owner,c,r);
 if(report.verdict!=='pass')fail('현재 원문 코드 검사를 통과해야 판매 검증에 연결합니다.');
 if(!experiment.registration||experiment.registration.digest!==await storefrontDigest({id:experiment.id,input:experiment.input})||await storefrontDigest(experiment.registration.refs)!==await storefrontDigest(experiment.input.interventionRefs))fail('확증 실험의 동결 내용과 개입 판이 다릅니다.');
 const kind=e.candidateKind==='landing_copy'?'landing_revision':'offer';
 if(!experiment.registration.refs.some(ref=>ref.kind===kind&&ref.id===e.targetId&&ref.version===e.targetVersion))fail('검사한 정확한 원문 판의 개입 근거가 필요합니다.');
 const targetOffer=kind==='offer'?{id:e.targetId,version:e.targetVersion}:{id:(e.source as LandingRecord).input.offerId,version:(e.source as LandingRecord).input.offerVersion};
 if(experiment.input.offerId!==targetOffer.id||experiment.input.offerVersion!==targetOffer.version)fail('실제로 실행하는 오퍼가 검사한 문구의 오퍼와 다릅니다.');
 if(kind==='landing_revision')await verifiedLanding(e.source as LandingRecord);
 return {kind,id:e.targetId,version:e.targetVersion,contentDigest:e.sourceDigest};
}
