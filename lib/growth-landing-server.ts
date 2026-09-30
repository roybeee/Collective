import type {Campaign} from './agency';
import type {JourneyRecord} from './growth-journey-server';
import {growthView} from './growth-workspace-server';
import {requireGrowthRunning} from './growth-stop-server';
import {landingReadiness,parseLandingProposal,parseReceipt,type LandingProposalInput,type LandingReceipt,type LandingSnapshot,type LandingStatus} from './growth-landing';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
const kinds={current:'growth_landing_revision',history:'growth_landing_revision_history',request:'growth_landing_revision_request'} as const;
export type LandingRecord={id:string;brandId:string;campaignId:string;version:number;status:LandingStatus;input:LandingProposalInput;snapshot:LandingSnapshot;approval:{by:string;at:string;digest:string}|null;applied:LandingReceipt|null;rolledBack:LandingReceipt|null;requestDigest:string;createdAt:string;updatedAt:string;updatedBy:string};
type Workspace=Awaited<ReturnType<typeof growthView>>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const scoped=(x:{brandId:string;campaignId:string},c:Campaign)=>x.brandId===c.brandId&&x.campaignId===c.id;
async function rows<T>(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();if(r.results.length>limit)throw new ApiError(409,'상세페이지 수정안 조회 한도를 넘었습니다.');return r.results.map(x=>JSON.parse(x.data) as T)}
async function capacity(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=limit)throw new ApiError(409,'상세페이지 수정안 보관 한도에 도달했습니다.')}
function append(owner:string,c:Campaign,kind:string,id:string,value:unknown,at:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(value),at)}
/** Current sources: exact offer/catalog/fact/journey versions. Changes after approval hold the proposal instead of silently re-approving it. */
function sources(input:LandingProposalInput,view:Workspace,journey:JourneyRecord|null){
 const offer=view.offers.find(o=>o.id===input.offerId),catalog=offer?view.catalogs.find(x=>x.id===offer.input.catalogId):undefined,factIds=new Set(input.sections.flatMap(s=>s.factIds));
 const facts=view.facts.filter(f=>factIds.has(f.id)).map(f=>({id:f.id,version:f.version})).sort((a,b)=>a.id.localeCompare(b.id));
 const reasons:string[]=[];
 if(!offer)reasons.push('현재 캠페인의 오퍼가 아닙니다.');else if(offer.version!==input.offerVersion)reasons.push('오퍼가 변경되었습니다.');
 if(offer&&(!catalog||catalog.version!==offer.input.catalogVersion))reasons.push('오퍼의 상품 판을 확인하세요.');
 if(input.journeyId&&(!journey||journey.version!==input.journeyVersion||journey.input.offerId!==input.offerId))reasons.push('연결한 구매 병목의 판·오퍼를 확인하세요.');
 const snapshot:LandingSnapshot={offerVersion:offer?.version??0,catalogId:catalog?.id??'',catalogVersion:catalog?.version??0,offerPrice:offer?.input.price??null,priceApproved:offer?.input.priceApproved===true,facts,journeyVersion:input.journeyId?journey?.version??null:null};
 const readiness=landingReadiness(input,{offerPrice:snapshot.offerPrice,priceApproved:snapshot.priceApproved,rightsConfirmed:catalog?.input.rightsConfirmed===true,factIds:view.facts.map(f=>f.id),offerLandingUrl:offer?.input.landingUrl??''});
 return {snapshot,reasons,readiness};
}
const contentDigest=(r:Pick<LandingRecord,'id'|'input'|'snapshot'>)=>storefrontDigest({id:r.id,input:r.input,snapshot:r.snapshot});
async function journeyFor(owner:string,c:Campaign,input:LandingProposalInput){if(!input.journeyId)return null;const j=await optional<JourneyRecord>(owner,'growth_journey',input.journeyId);return j&&scoped(j,c)?j:null}
export async function growthLandingView(who:Actor,c:Campaign){
 const [records,history,view,journeys]=await Promise.all([rows<LandingRecord>(who.owner,c,kinds.current,200),rows<LandingRecord>(who.owner,c,kinds.history,2000),growthView(who.owner,c,who.role!=='member'),rows<JourneyRecord>(who.owner,c,'growth_journey',500)]);
 const own=records.filter(r=>scoped(r,c));
 const proposals=await Promise.all(own.map(async r=>{
  const journey=r.input.journeyId?journeys.find(j=>j.id===r.input.journeyId&&scoped(j,c))??null:null,{snapshot,reasons,readiness}=sources(r.input,view,journey);
  const drift=JSON.stringify(snapshot)!==JSON.stringify(r.snapshot)?['승인·저장 당시 오퍼·상품·사실·병목 판이 바뀌었습니다.']:[];
  const approvalValid=!!r.approval&&r.approval.digest===await contentDigest(r);
  return {...r,sourceStatus:reasons.length||drift.length?'held' as const:'current' as const,sourceReasons:[...reasons,...drift],readiness,approvalValid,pageChanged:r.status==='applied'?'operator_attested' as const:r.status==='rolled_back'?'rolled_back' as const:'not_confirmed' as const};
 }));
 const journeyReceipts=journeys.filter(j=>scoped(j,c)).map(j=>{const applied=own.filter(r=>r.input.journeyId===j.id&&r.status==='applied');return {journeyId:j.id,journeyVersion:j.version,title:j.input.title,rawAppliedAt:j.input.appliedAt||null,receipts:applied.map(r=>({revisionId:r.id,version:r.version,at:r.applied!.at})),basis:applied.length?'operator_receipt' as const:j.input.appliedAt?'raw_applied_at_only' as const:'none' as const}});
 return {campaignId:c.id,campaignVersion:c.version,proposals,history:history.filter(r=>scoped(r,c)),offers:view.offers.map(o=>({id:o.id,version:o.version,title:o.input.title,landingUrl:o.input.landingUrl,price:o.input.price,priceApproved:o.input.priceApproved})),facts:view.facts.map(f=>({id:f.id,version:f.version,key:f.key})),journeys:journeyReceipts,canEdit:who.role!=='member'&&c.status!=='archived',mayApply:false as const,adapter:null,causalStatus:'not_measured' as const};
}
export type GrowthLandingView=Awaited<ReturnType<typeof growthLandingView>>;
const transitions:Record<string,{from:LandingStatus[];to:LandingStatus}>={approve:{from:['draft'],to:'approved'},record_applied:{from:['approved'],to:'applied'},record_rollback:{from:['applied'],to:'rolled_back'},withdraw:{from:['draft','approved'],to:'withdrawn'}};
export async function saveGrowthLanding(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 const requestId=String(b.requestId??''),action=String(b.action??'');if(!uuid.test(requestId)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0)throw new ApiError(400,'요청 번호와 수정안 판을 확인하세요.');
 if(action!=='save_proposal'&&!transitions[action])throw new ApiError(400,'지원하지 않는 상세페이지 수정안 작업입니다.');
 const id=str(b.id,'수정안 ID',100,true);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new ApiError(400,'수정안 ID 형식을 확인하세요.');
 const input=action==='save_proposal'?parseLandingProposal(b.input):null,receipt=['record_applied','record_rollback'].includes(action)?parseReceipt(b.receipt):null;
 const digest=await storefrontDigest({action,id,campaignId:c.id,campaignVersion:c.version,input,receipt,expectedVersion:b.expectedVersion});
 const [request,old]=await Promise.all([optional<{digest:string;id:string;version:number}>(who.owner,kinds.request,requestId),optional<LandingRecord>(who.owner,kinds.current,id)]),ack=(version:number,duplicate:boolean)=>({recorded:true as const,id,version,duplicate,mayApply:false as const});
 if(request){if(request.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return ack(old?.version??request.version,true)}
 if(old&&!scoped(old,c))throw new ApiError(404,'다른 캠페인의 수정안입니다.');
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'수정안이 변경되었습니다. 입력을 보존하고 다시 불러오세요.');
 const at=stamp();let next:LandingRecord;
 if(action==='save_proposal'){
  if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 수정안을 만들 수 없습니다.');
  if(old&&old.status!=='draft')throw new ApiError(409,'초안 상태의 수정안만 고칠 수 있습니다. 새 수정안을 만드세요.');
  const [view,journey]=await Promise.all([growthView(who.owner,c,true),journeyFor(who.owner,c,input!)]),{snapshot,reasons}=sources(input!,view,journey);
  if(reasons.length)throw new ApiError(409,reasons[0]);
  if(!old)await capacity(who.owner,c,kinds.current,200);
  next={id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,status:'draft',input:input!,snapshot,approval:null,applied:null,rolledBack:null,requestDigest:digest,createdAt:old?.createdAt??at,updatedAt:at,updatedBy:who.id};
 }else{
  if(!old)throw new ApiError(404,'수정안을 찾지 못했습니다.');
  const t=transitions[action];if(!t.from.includes(old.status))throw new ApiError(409,'현재 상태에서 할 수 없는 작업입니다.');
  next={...old,version:old.version+1,status:t.to,requestDigest:digest,updatedAt:at,updatedBy:who.id};
  if(action==='approve'||action==='record_applied'){
   if(action==='approve'){if(c.status==='archived')throw new ApiError(409,'보관한 캠페인의 수정안은 승인할 수 없습니다.');await requireGrowthRunning(who.owner);}
   const [view,journey]=await Promise.all([growthView(who.owner,c,true),journeyFor(who.owner,c,old.input)]),{snapshot,reasons,readiness}=sources(old.input,view,journey);
   if(reasons.length)throw new ApiError(409,reasons[0]);
   if(JSON.stringify(snapshot)!==JSON.stringify(old.snapshot))throw new ApiError(409,'저장 뒤 오퍼·상품·사실·병목 판이 바뀌었습니다. 새 초안으로 다시 검토하세요.');
   if(readiness.missing.length)throw new ApiError(409,readiness.missing[0]);
   if(action==='approve')next.approval={by:who.id,at,digest:await contentDigest(old)};
   else{
    if(!old.approval||old.approval.digest!==await contentDigest(old))throw new ApiError(409,'승인된 내용과 현재 수정안이 다릅니다.');
    if(receipt!.observedUrl!==old.input.landingUrl)throw new ApiError(409,'확인한 페이지 URL이 수정안의 상세페이지와 다릅니다.');
    if(Date.parse(receipt!.at)<Math.floor(Date.parse(old.approval.at)/60_000)*60_000)throw new ApiError(409,'적용 시각은 승인 이후여야 합니다.');
    next.applied={method:'manual_attested',...receipt!,recordedAt:at,recordedBy:who.id};
   }
  }
  if(action==='record_rollback'){
   if(receipt!.observedUrl!==old.input.landingUrl)throw new ApiError(409,'확인한 페이지 URL이 수정안의 상세페이지와 다릅니다.');
   if(!receipt!.reason)throw new ApiError(400,'되돌림 사유를 입력하세요.');
   if(Date.parse(receipt!.at)<Date.parse(old.applied!.at))throw new ApiError(409,'되돌림 시각은 적용 이후여야 합니다.');
   next.rolledBack={method:'manual_attested',...receipt!,recordedAt:at,recordedBy:who.id};
  }
 }
 await capacity(who.owner,c,kinds.history,2000);await capacity(who.owner,c,kinds.request,5000);
 await database().batch([recordStatement(who.owner,kinds.current,id,next,c.id),append(who.owner,c,kinds.history,`${id}:${next.version}`,next,at),append(who.owner,c,kinds.request,requestId,{digest,id,version:next.version},at)]);
 return ack(next.version,false);
}
