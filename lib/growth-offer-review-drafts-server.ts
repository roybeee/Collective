import type {Campaign} from './agency';
import type {OfferInput} from './growth-catalog';
import type {GrowthRecord} from './growth-workspace-server';
import type {GrowthExperimentRecord} from './growth-experiment-server';
import {readExperimentOutcomeBasis} from './growth-experiment-server';
import {growthDemandEvidenceView} from './growth-demand-evidence-server';
import {campaignRows,inCampaign,optionalRecord} from './growth-ledger-server';
import {readGrowthStop} from './growth-stop-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,acquireLock,releaseLock,readRecord,database,stamp,type Actor} from './server';
const kinds={draft:'growth_offer_review_draft',cursor:'growth_offer_review_cursor'} as const;
type Source={kind:'experiment'|'response';id:string;offerId:string;offerVersion:number};
export type OfferReviewDraft={id:string;brandId:string;campaignId:string;campaignVersion:number;version:1;source:Source&{digest:string;reference:string;summary:string};offer:{id:string;version:number;digest:string};proposal:string;createdAt:string;mayApply:false};
const PROPOSAL='관측 결과의 표본·유입·가격·행사 조건을 확인하고 구매 이유·표현·조건 중 바꿀 요소 하나와 반증 근거를 작성하세요. 변경안은 기존 오퍼 승인 경로에서 검토합니다.';
async function sourceReader(who:Actor,c:Campaign){
 const designs=await campaignRows<GrowthExperimentRecord>(who.owner,c,'growth_experiment',200);
 let response:Awaited<ReturnType<typeof growthDemandEvidenceView>>|null=null,unavailable=false;
 try{response=await growthDemandEvidenceView(who,c)}catch{unavailable=true}
 const invalid=designs.filter(e=>inCampaign(e,c)&&e.status==='registered'&&(!e.input?.offerId||!Number.isSafeInteger(e.input?.offerVersion))).length;
 const sources:Source[]=[...designs.filter(e=>inCampaign(e,c)&&e.status==='registered'&&e.input?.offerId&&Number.isSafeInteger(e.input?.offerVersion)).map(e=>({kind:'experiment' as const,id:e.id,offerId:e.input.offerId,offerVersion:e.input.offerVersion})),...(response?.records.filter(r=>r.status==='active').map(r=>({kind:'response' as const,id:r.id,offerId:r.snapshot.offerId,offerVersion:r.snapshot.offerVersion}))??[])].sort((a,b)=>(a.kind+':'+a.id)<(b.kind+':'+b.id)?-1:1);
 const cache=new Map<string,Promise<{digest:string;reference:string;summary:string}|null>>();
 async function read(source:Source){
  const key=source.kind+':'+source.id;
  if(!cache.has(key))cache.set(key,(async()=>{
   if(source.kind==='response'&&unavailable)throw new ApiError(409,'반응 근거 조회를 보류합니다.');
   if(!sources.some(s=>s.kind===source.kind&&s.id===source.id&&s.offerId===source.offerId&&s.offerVersion===source.offerVersion))return null;
   if(source.kind==='experiment'){
    const basis=await readExperimentOutcomeBasis(who.owner,c,source.id);
    if(!basis.current||!basis.latest)return null;
    return {digest:await storefrontDigest(basis),reference:basis.latest.id,summary:basis.latest.status};
   }
   const record=response?.records.find(r=>r.id===source.id),assessment=record?.assessment;
   if(!record||assessment?.status!=='current'||assessment.performance!=='observed')return null;
   return {digest:await storefrontDigest({record,assessment}),reference:record.id,summary:'observed_not_causal'};
  })());
  return cache.get(key)!;
 }
 return {sources,read,unavailable,invalid};
}
async function currentOffer(who:Actor,c:Campaign,source:Source){
 const offer=await optionalRecord<GrowthRecord<OfferInput>>(who.owner,'growth_offer',source.offerId);
 return offer&&inCampaign(offer,c)&&offer.campaignVersion===c.version&&offer.version===source.offerVersion?offer:null;
}
/** Bounded review intake only. Existing offers, their approval and provider systems are never written. */
export async function createGrowthOfferReviewDrafts(who:Actor,c:Campaign){
 if(who.role==='member')throw new ApiError(403,'관리자만 오퍼 검토 초안을 회수합니다.');
 const token=await acquireLock(who.owner);
 try{
  const current=await readRecord<Campaign>(who.owner,'campaign',c.id);
  if(current.version!==c.version||current.brandId!==c.brandId||current.storeId!==c.storeId)throw new ApiError(409,'캠페인이 변경되었습니다.');
  if(current.status==='archived'||(await readGrowthStop(who.owner)).status!=='running')return {created:0,remaining:false,intakeHeld:false,sourceErrors:0};
  const reader=await sourceReader(who,c),cursor=await optionalRecord<{after:string|null}>(who.owner,kinds.cursor,c.id),list=reader.sources.filter(s=>!cursor?.after||s.kind+':'+s.id>cursor.after),chunk=list.slice(0,20),remaining=list.length>20;
  const count=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(who.owner,kinds.draft,c.id).first<{n:number}>();
  let created=0,intakeHeld=false,sourceErrors=reader.invalid+(reader.unavailable?1:0);const writes:(()=>D1PreparedStatement)[]=[],at=stamp();
  const append=(kind:string,id:string,value:unknown,replace=false)=>()=>database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mutation_locks WHERE owner=? AND token=? AND expires_at>=?)"+(replace?' ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at':''))
   .bind(`${who.owner}:${kind}:${id}`,who.owner,kind,c.id,JSON.stringify(value),at,who.owner,token,Date.now());
  for(const source of chunk){
   let evidence,offer;try{[evidence,offer]=await Promise.all([reader.read(source),currentOffer(who,c,source)])}catch{sourceErrors++;continue}
   if(!evidence||!offer)continue;
   const offerDigest=await storefrontDigest(offer),id='offer-review-'+(await storefrontDigest({campaignId:c.id,source,evidence,offerDigest})).slice(0,32);
   if(await optionalRecord<OfferReviewDraft>(who.owner,kinds.draft,id))continue;
   if((count?.n??0)+created>=1000){intakeHeld=true;continue}
   const draft:OfferReviewDraft={id,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,version:1,source:{...source,...evidence},offer:{id:offer.id,version:offer.version,digest:offerDigest},proposal:PROPOSAL,createdAt:at,mayApply:false};
   writes.push(append(kinds.draft,id,draft));created++;
  }
  writes.push(append(kinds.cursor,c.id,{id:c.id,brandId:c.brandId,campaignId:c.id,after:remaining?chunk.at(-1)!.kind+':'+chunk.at(-1)!.id:null},true));
  const saved=await database().batch(writes.map(prepare=>prepare()));if(saved.some(x=>!x.meta.changes))throw new ApiError(409,'오퍼 초안 회수 잠금이 만료되었습니다. 다음 실행에서 대사하세요.');
  return {created,remaining,intakeHeld,sourceErrors};
 }finally{await releaseLock(who.owner,token)}
}
/** Live checks invalidate old drafts without deleting audit evidence or trusting yesterday's daily state. */
export async function growthOfferReviewDraftsView(who:Actor,c:Campaign){
 const raw=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC,id DESC LIMIT 51').bind(who.owner,kinds.draft,c.id).all<{data:string}>();
 if(!raw.results.length)return {rows:[],hasMore:false,sourceUnavailable:false,mayApply:false as const};
 const reader=await sourceReader(who,c),drafts=raw.results.slice(0,50).map(x=>JSON.parse(x.data) as OfferReviewDraft).filter(x=>inCampaign(x,c));
 const rows=await Promise.all(drafts.map(async row=>{
  try{const [source,offer]=await Promise.all([reader.read(row.source),currentOffer(who,c,row.source)]),current=row.campaignVersion===c.version&&!!source&&source.digest===row.source.digest&&!!offer&&await storefrontDigest(offer)===row.offer.digest;
   return {...row,sourceStatus:current?'current' as const:'stale' as const,sourceReason:current?'현재 원문·관측 근거입니다.':'원문·관측·분석 또는 연결 판이 변경되었습니다. 새 근거를 검토하세요.'};
  }catch{return {...row,sourceStatus:'unavailable' as const,sourceReason:'현재 원천 근거 조회가 지연되어 초안을 보류합니다.'}}
 }));
 return {rows,hasMore:raw.results.length>50,sourceUnavailable:reader.unavailable,mayApply:false as const};
}
