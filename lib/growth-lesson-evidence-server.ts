// Model-path read-only evidence projection. Never load the operational workspace or mutation servers here.
import type {Campaign} from './agency';
import type {ArchiveSource,BrandResearch} from './archive';
import {effectiveBrandFacts,type BrandFact} from './brand-facts';
import {lessonAssessment,parseLessonInput,parseDecisionInput,type LessonInput,type DecisionInput} from './growth-decisions';
import {parseMissionInput} from './growth-mission';
import {parseJourneyInput} from './growth-journey';
import {parseCatalogInput,parseOfferInput} from './growth-catalog';
import {parseNeedInput,parseSignalInput} from './growth-market';
import {assessSignalSource,signalSourceBasis,type SignalSourceProvenance} from './growth-signal-source';
import {optionalRecord,inCampaign} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database} from './server';

type Ref={id:string;version:number};
export type LessonEvidenceRow={id:string;brandId:string;campaignId:string;campaignVersion:number;version:number;input:unknown};
type Row<T>=Omit<LessonEvidenceRow,'input'>&{input:T;factRefs?:Ref[];evidenceRefs?:Ref[];sourceProvenance?:SignalSourceProvenance};
const sameRefs=(a:LessonInput|DecisionInput,b:LessonInput|DecisionInput)=>a.missionId===b.missionId&&a.missionVersion===b.missionVersion&&a.journeyId===b.journeyId&&a.journeyVersion===b.journeyVersion;
const validRow=(r:LessonEvidenceRow,c:Campaign)=>inCampaign(r,c)&&Number.isSafeInteger(r.version)&&r.version>0&&Number.isSafeInteger(r.campaignVersion)&&r.campaignVersion>0;
export async function readGrowthLessonEvidence(owner:string,c:Campaign,lessons:LessonEvidenceRow[]){
 const memo=new Map<string,Promise<unknown>>();
 const once=<T>(key:string,read:()=>Promise<T>):Promise<T>=>{if(!memo.has(key))memo.set(key,read());return memo.get(key) as Promise<T>};
 const raw=(kind:string,id:string)=>once(`${kind}:${id}`,()=>optionalRecord<unknown>(owner,kind,id));
 const facts=()=>once('effective-facts',async()=>{
  const r=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='brand_fact' AND parent_id=? LIMIT 1001").bind(owner,c.brandId).all<{data:string}>();
  if(r.results.length>1000)throw new ApiError(409,'확정 사실 조회 한도를 넘었습니다.');
  const rows=r.results.map(x=>JSON.parse(x.data) as BrandFact).filter(x=>x.brandId===c.brandId&&(!x.storeId||x.storeId===c.storeId));
  return {raw:rows,current:effectiveBrandFacts(rows,c.brandId,c.storeId)};
 });
 return Promise.all(lessons.filter(r=>inCampaign(r,c)).map(async original=>{
  const evidence=new Map<string,unknown>();
  async function read<T>(kind:string,id:string,parse:(v:unknown)=>T):Promise<Row<T>|null>{
   const value=await raw(kind,id),r=value as Row<unknown>|null;
   if(!r||!inCampaign(r,c)){evidence.set(`${kind}:${id}`,{status:'missing_or_invalid'});return null}
   evidence.set(`${kind}:${id}`,r);
   if(!validRow(r,c))return null;
   try{return {...r,input:parse(r.input)}}catch{return null}
  }
  async function sourceHeld(signal:Row<ReturnType<typeof parseSignalInput>>){
   const p=signal.sourceProvenance;if(!p)return false;
   try{
    const s=await raw('brand_source',p.sourceId) as ArchiveSource|null;
    const r=s?.origin==='research'&&s.researchId?await raw('brand_research',s.researchId) as BrandResearch|null:null;
    evidence.set(`source:${signal.id}`,{source:s,research:r});
    if(!s||s.id!==p.sourceId||s.version!==p.sourceVersion)return true;
    const result=assessSignalSource(c,s,r,signal.input.expiresAt);
    return result.status!=='ready'||await storefrontDigest(signalSourceBasis(s,r))!==p.sourceDigest||await storefrontDigest(result.input)!==await storefrontDigest(signal.input);
   }catch{if(!evidence.has(`source:${signal.id}`))evidence.set(`source:${signal.id}`,{status:'unavailable'});return true}
  }
  async function missionLineage(mission:Row<ReturnType<typeof parseMissionInput>>){
   const missing:string[]=[],input=mission.input;if(!input.offerId)return missing;
   const offer=await read('growth_offer',input.offerId,parseOfferInput);
   if(!offer||offer.version!==input.offerVersion||offer.campaignVersion!==c.version)missing.push('판매 오퍼 변경 후 학습 근거 재검토');
   if(!offer)return missing;
   if(offer.input.catalogId){
    const catalog=await read('growth_catalog',offer.input.catalogId,parseCatalogInput);
    if(!catalog||catalog.version!==offer.input.catalogVersion||catalog.campaignVersion!==c.version)missing.push('상품 변경 후 학습 근거 재검토');
    if(catalog?.input.validUntil&&(!Number.isFinite(Date.parse(catalog.input.validUntil+'T23:59:59Z'))||Date.parse(catalog.input.validUntil+'T23:59:59Z')<Date.now()))missing.push('상품 근거 만료 후 학습 근거 재검토');
    if(catalog?.factRefs?.length){const f=await facts();evidence.set('facts',f);if(catalog.factRefs.some(ref=>!f.current.some(x=>x.id===ref.id&&x.version===ref.version)))missing.push('상품 사실 변경·만료 후 학습 근거 재검토')}
   }
   if(offer.input.needId){
    const need=await read('growth_need',offer.input.needId,parseNeedInput),captured=offer.evidenceRefs?.find(r=>r.id===offer.input.needId);
    if(!need||need.campaignVersion!==c.version||(captured&&captured.version!==need.version))missing.push('고객 기회 변경 후 학습 근거 재검토');
    if(need)for(const id of need.input.signalIds){
     const signal=await read('growth_signal',id,parseSignalInput),captured=need.evidenceRefs?.find(r=>r.id===id);
     if(signal&&await sourceHeld(signal))missing.push('브랜드 아카이브 원본 변경·미확인 후 학습 근거 재검토');
     if(!signal||signal.campaignVersion!==c.version||(captured&&captured.version!==signal.version))missing.push('시장 근거 변경 후 학습 근거 재검토');
    }
   }
   return missing;
  }
  async function upstream(row:Row<LessonInput|DecisionInput>,allowDecision:boolean):Promise<string[]>{
   const input=row.input,missing:string[]=[];
   if(row.campaignVersion!==c.version)missing.push('캠페인 변경 후 재검토');
   const mission=input.missionId?await read('growth_mission',input.missionId,parseMissionInput):null,journey=input.journeyId?await read('growth_journey',input.journeyId,parseJourneyInput):null;
   if(input.missionId&&(!mission||mission.version!==input.missionVersion||mission.campaignVersion!==c.version))missing.push('미션 변경 후 재검토');
   if(mission)missing.push(...await missionLineage(mission));
   if(input.journeyId&&(!journey||journey.version!==input.journeyVersion||journey.campaignVersion!==c.version))missing.push('구매 병목 변경 후 재검토');
   if(journey&&(journey.input.missionId!==input.missionId||journey.input.missionVersion!==input.missionVersion))missing.push('구매 병목과 미션 참조 일치 확인');
   if(allowDecision&&'decisionId' in input&&input.decisionId){
    const decision=await read('growth_decision',input.decisionId,parseDecisionInput);
    if(!decision||decision.version!==input.decisionVersion)missing.push('결정 변경 후 재검토');
    if(decision){if(!sameRefs(input,decision.input))missing.push('결정과 교훈 참조 일치 확인');missing.push(...await upstream(decision,false))}
   }
   return [...new Set(missing)];
  }
  let input:LessonInput|null=null,assessment:{canReuse:boolean;missing:string[]}={canReuse:false,missing:['교훈 입력·판을 확인할 수 없습니다.']};
  try{if(validRow(original,c)){input=parseLessonInput(original.input);assessment=lessonAssessment(input,await upstream({...original,input},true))}}catch{input=null}
  return {id:original.id,version:original.version,input,assessment,reference:{id:original.id,version:original.version,digest:await storefrontDigest({id:original.id,version:original.version,input:original.input})},evidenceDigest:await storefrontDigest([...evidence].sort(([a],[b])=>a.localeCompare(b)))};
 }));
}
