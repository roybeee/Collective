import {ApiError} from '../server';
import {K,optional,readMany,readSnapshots} from './server-store';
import {SOURCE_POLICY_VERSION,researchSourcePolicy,snapshotResearchPolicy,type ResearchSourcePolicy} from './source-policy';
import type {ScoreCard,MdBrief,Snapshot} from './types';
export {SOURCE_POLICY_VERSION} from './source-policy';
const missing=():ResearchSourcePolicy=>({allowed:false,code:'missing_snapshot',reason:'원본 근거를 모두 확인할 수 없어 기존 분석을 사용할 수 없습니다. 허용된 자료로 새 판을 계산하세요.'});
export async function snapshotIdsResearchPolicy(owner:string,ids:readonly string[],now=Date.now()):Promise<ResearchSourcePolicy>{
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id)||ids.length>10000)return missing();
 const rows=await readSnapshots(owner,[...new Set(ids)]);
 for(const id of ids){const result=snapshotResearchPolicy(rows.get(id),now);if(!result.allowed)return result}
 return {allowed:true,code:null,reason:null};
}
export async function scoreResearchPolicy(owner:string,card:ScoreCard|undefined,now=Date.now()):Promise<ResearchSourcePolicy>{
 if(!card||card.riskEvidenceComplete===false||!Array.isArray(card.subScores)||card.subScores.some(s=>!s||!Array.isArray(s.evidence)))return missing();
 return snapshotIdsResearchPolicy(owner,card.subScores.flatMap(s=>s.evidence),now);
}
export async function productResearchPolicy(owner:string,product:{scoreId?:string|null;listings?:{sourceId:unknown}[]}|undefined,now=Date.now()):Promise<ResearchSourcePolicy>{
 if(!product?.scoreId)return missing();
 for(const listing of product.listings??[]){const result=researchSourcePolicy(listing.sourceId);if(!result.allowed)return result}
 return scoreResearchPolicy(owner,await optional<ScoreCard>(owner,K.score,product.scoreId)??undefined,now);
}
type PolicyProduct={scoreId?:string|null;listings?:{sourceId:unknown}[]};
function cardEvidence(card:ScoreCard|undefined):string[]{
 return card&&card.riskEvidenceComplete!==false&&Array.isArray(card.subScores)&&card.subScores.every(s=>s&&Array.isArray(s.evidence))?card.subScores.flatMap(s=>s.evidence):[];
}
function idsPolicy(ids:readonly string[],snapshots:ReadonlyMap<string,Snapshot>,now:number):ResearchSourcePolicy{
 if(!ids.length||ids.length>10000||ids.some(id=>typeof id!=='string'||!id))return missing();
 for(const id of ids){const policy=snapshotResearchPolicy(snapshots.get(id),now);if(!policy.allowed)return policy}
 return {allowed:true,code:null,reason:null};
}
export async function scoreResearchPolicies(owner:string,cards:readonly ScoreCard[],now=Date.now()){
 const ids=[...new Set(cards.flatMap(cardEvidence))];
 const snapshots=ids.length<=10000?await readSnapshots(owner,ids):new Map<string,Snapshot>();
 return new Map(cards.map(card=>[card.id,idsPolicy(cardEvidence(card),snapshots,now)]));
}
function briefShape(brief:MdBrief){return brief.sourcePolicyVersion===SOURCE_POLICY_VERSION&&Array.isArray(brief.scoreCardIds)&&brief.scoreCardIds.length>0&&Array.isArray(brief.claims)&&Array.isArray(brief.productIds)&&brief.productIds.length>0}
export async function briefResearchPolicies(owner:string,briefs:readonly MdBrief[],now=Date.now()){
 const eligible=briefs.filter(briefShape),result=new Map(briefs.map(b=>[b.id,missing()]));
 const products=await readMany<PolicyProduct>(owner,K.product,[...new Set(eligible.flatMap(b=>b.productIds))]);
 const cardIds=[...new Set([...eligible.flatMap(b=>b.scoreCardIds??[]),...[...products.values()].flatMap(p=>p.scoreId?[p.scoreId]:[])])];
 const cards=await readMany<ScoreCard>(owner,K.score,cardIds);
 const citations=(b:MdBrief)=>b.claims.flatMap(c=>Array.isArray(c?.citations)?c.citations:[]);
 const ids=[...new Set([...eligible.flatMap(citations),...[...cards.values()].flatMap(cardEvidence)])];
 const snapshots=ids.length<=10000?await readSnapshots(owner,ids):new Map<string,Snapshot>();
 const scores=new Map([...cards].map(([id,card])=>[id,idsPolicy(cardEvidence(card),snapshots,now)]));
 const productPolicy=(id:string):ResearchSourcePolicy=>{
  const product=products.get(id);if(!product?.scoreId)return missing();
  for(const listing of product.listings??[]){const policy=researchSourcePolicy(listing.sourceId);if(!policy.allowed)return policy}
  return scores.get(product.scoreId)??missing();
 };
 for(const brief of eligible){
  const policies=[idsPolicy(citations(brief),snapshots,now),...(brief.scoreCardIds??[]).map(id=>scores.get(id)??missing()),...brief.productIds.map(productPolicy)];
  result.set(brief.id,policies.find(p=>!p.allowed)??{allowed:true,code:null,reason:null});
 }
 return result;
}
export async function briefResearchPolicy(owner:string,brief:MdBrief|undefined,now=Date.now()):Promise<ResearchSourcePolicy>{
 return brief?(await briefResearchPolicies(owner,[brief],now)).get(brief.id)??missing():missing();
}
export function requireResearchPolicy(result:ResearchSourcePolicy){if(!result.allowed)throw new ApiError(409,result.reason??'근거 사용 정책을 확인하세요.')}

// 성장 조회는 같은 점수/스냅샷을 신호마다 다시 읽지 않는다. 실패는 전체 참조를 보류한다.
export async function researchProvenancePolicies(owner:string,rows:readonly {id:string;productResearch?:{scoreCardId:string;productId:string;snapshotIds:string[]}}[],now=Date.now()){
 const linked=rows.filter(r=>r.productResearch),result=new Map<string,ResearchSourcePolicy>();
 try{
  const cards=await readMany<ScoreCard>(owner,K.score,[...new Set(linked.map(r=>r.productResearch!.scoreCardId))]);
  const idsFor=(r:typeof linked[number])=>{
   const p=r.productResearch!,card=cards.get(p.scoreCardId);
   if(!card||card.riskEvidenceComplete===false||card.productId!==p.productId||!Array.isArray(p.snapshotIds)||!p.snapshotIds.length||!Array.isArray(card.subScores)||card.subScores.some(s=>!s||!Array.isArray(s.evidence)))return null;
   const evidence=card.subScores.flatMap(s=>s.evidence);
   return evidence.length?[...p.snapshotIds,...evidence]:null;
  };
  const references=new Map(linked.map(r=>[r.id,idsFor(r)]));
  const ids=[...new Set([...references.values()].flatMap(ids=>ids??[]))];
  if(ids.length>10000||ids.some(id=>typeof id!=='string'||!id))return new Map(linked.map(r=>[r.id,missing()]));
  const snapshots:Map<string,Snapshot>=await readSnapshots(owner,ids);
  for(const row of linked){
   const refs=references.get(row.id);let verdict=missing();
   if(refs?.length){verdict={allowed:true,code:null,reason:null};for(const id of refs){const policy=snapshotResearchPolicy(snapshots.get(id),now);if(!policy.allowed){verdict=policy;break}}}
   result.set(row.id,verdict);
  }
 }catch{for(const r of linked)result.set(r.id,missing())}
 return result;
}
