import {growthDay} from './growth-mission';
import type {NeedInput} from './growth-market';
export type OpportunityDeadline={raw:string;at:number|null;kstDay:string|null;status:'overdue'|'today'|'upcoming'|'missing'|'invalid'};
export type OpportunityPreparation='held'|'unknown'|'reviewable';
type Readiness={missing:readonly string[]};
type Row<T>={id:string;version:number;campaignVersion?:number;input:T;readiness?:Readiness;evidenceRefs?:readonly {id:string;version:number}[]};
type OfferInput={title:string;needId:string;catalogId:string;catalogVersion:number;purchaseReason:string;price?:number|null;quantity?:number};
type CatalogInput={title:string;sku:string;price?:number|null};
type MissionInput={title:string;offerId:string;offerVersion:number;deadline:string;assignee:string;nextAction:string};
export type OpportunityBoardInput={campaignVersion:number;signals?:readonly {id:string}[];needs:readonly Row<NeedInput>[];offers:readonly Row<OfferInput>[];catalogs:readonly Row<CatalogInput>[];missions:readonly (Row<MissionInput>&{status?:string})[]};
const kstDay=(at:number)=>new Date(at).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
export function opportunityDeadline(raw:string,nowMs:number):OpportunityDeadline{
 if(!Number.isFinite(nowMs)||!Number.isFinite(new Date(nowMs).getTime()))throw new Error('보드 평가 시각을 확인하세요.');
 if(!raw)return {raw:'',at:null,kstDay:null,status:'missing'};
 let at:number,day:string;
 try{
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){at=growthDay(raw);day=raw;}
  else{
   const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
   if(!m)throw Error('format');growthDay(m[1]);
   if(Number(m[2])>23||Number(m[3])>59||Number(m[4])>59||(m[5]!=='Z'&&(Number(m[5].slice(1,3))>14||Number(m[5].slice(4))>59||(Number(m[5].slice(1,3))===14&&Number(m[5].slice(4))!==0))))throw Error('time');
   at=Date.parse(raw);if(!Number.isFinite(at))throw Error('instant');day=kstDay(at);
  }
 }catch{return {raw,at:null,kstDay:null,status:'invalid'}}
 return {raw,at,kstDay:day,status:at<=nowMs?'overdue':day===kstDay(nowMs)?'today':'upcoming'};
}
function unique<T extends {id:string;version:number}>(rows:readonly T[]):T[]{return [...new Map([...rows].sort((a,b)=>a.version-b.version||JSON.stringify(a).localeCompare(JSON.stringify(b))).map(r=>[r.id,r])).values()].sort((a,b)=>a.id.localeCompare(b.id));}
function readiness(row:{readiness?:Readiness;campaignVersion?:number},campaignVersion:number){const known=Array.isArray(row.readiness?.missing),reasons=known?[...row.readiness!.missing]:['준비도 미확인'];if(row.campaignVersion!==undefined&&row.campaignVersion!==campaignVersion)reasons.push('캠페인 판 변경 후 재검토');return {known,reasons};}
function preparation(known:boolean,reasons:readonly string[]):OpportunityPreparation{return !known?'unknown':reasons.length?'held':'reviewable'}
const uniqueReasons=(reasons:readonly string[])=>[...new Set(reasons)];
const rank={overdue:0,today:1,upcoming:2,missing:3,invalid:3} as const;
const preparationRank={held:0,unknown:1,reviewable:2} as const;
function compare(a:{id:string;deadline:OpportunityDeadline;preparation:OpportunityPreparation},b:{id:string;deadline:OpportunityDeadline;preparation:OpportunityPreparation}){return rank[a.deadline.status]-rank[b.deadline.status]||(a.deadline.at??Infinity)-(b.deadline.at??Infinity)||preparationRank[a.preparation]-preparationRank[b.preparation]||a.id.localeCompare(b.id)}
export function buildOpportunityBoard(view:OpportunityBoardInput,nowMs:number){
 opportunityDeadline('',nowMs);
 const needs=unique(view.needs),catalogs=unique(view.catalogs),offers=unique(view.offers),missions=unique(view.missions);
 const offerRows=offers.map(row=>{
  const catalog=catalogs.find(x=>x.id===row.input.catalogId),need=needs.find(x=>x.id===row.input.needId),base=readiness(row,view.campaignVersion),reasons=[...base.reasons];
  if(!need)reasons.push('연결된 고객 기회 없음');
  if(!catalog)reasons.push('연결된 상품 없음');else if(catalog.version!==row.input.catalogVersion)reasons.push('상품 참조 판 불일치');
  const captured=row.evidenceRefs?.find(x=>x.id===row.input.needId);if(need&&captured&&captured.version!==need.version)reasons.push('고객 기회 참조 판 불일치');
  return {id:row.id,version:row.version,title:row.input.title,needId:row.input.needId,purchaseReason:row.input.purchaseReason,catalogId:row.input.catalogId,currentCatalogVersion:catalog?.version??null,referenceVersion:row.input.catalogVersion,price:row.input.price??null,heldReasons:uniqueReasons(reasons),preparation:preparation(base.known,reasons)};
 });
 const missionRows=missions.map(row=>{
  const offer=offerRows.find(x=>x.id===row.input.offerId),base=readiness(row,view.campaignVersion),status=row.status??'unknown_status',reasons=[...base.reasons],knownStatus=['draft','staged','unknown','failed','observed','cancelled'].includes(status);
  if(!offer)reasons.push('연결된 판매 오퍼 없음');else if(offer.version!==row.input.offerVersion)reasons.push('오퍼 참조 판 불일치');
  if(!knownStatus)reasons.push('미션 상태 미확인');
  const deadline:OpportunityDeadline=row.input.deadline&&!/^\d{4}-\d{2}-\d{2}$/.test(row.input.deadline)?{raw:row.input.deadline,at:null,kstDay:null,status:'invalid'}:opportunityDeadline(row.input.deadline,nowMs);if(deadline.status==='invalid')reasons.push('실제 미션 기한 확인 필요');
  return {id:row.id,version:row.version,title:row.input.title,offerId:row.input.offerId,referenceVersion:row.input.offerVersion,needId:offer&&needs.some(n=>n.id===offer.needId)?offer.needId:null,status,assignee:row.input.assignee,nextAction:row.input.nextAction,deadline,heldReasons:uniqueReasons(reasons),preparation:preparation(base.known&&knownStatus,reasons),active:['staged','unknown'].includes(status),open:['draft','staged','unknown'].includes(status),closed:['failed','observed','cancelled'].includes(status)};
 }).sort((a,b)=>compare(a,b));
 const opportunities=needs.map(row=>{
  const linkedOffers=offerRows.filter(x=>x.needId===row.id),linkedMissions=missionRows.filter(x=>x.needId===row.id),base=readiness(row,view.campaignVersion),deadline=opportunityDeadline(row.input.deadline,nowMs);
  const reasons=uniqueReasons([...base.reasons,...(!linkedOffers.length?['연결된 판매 오퍼 없음']:[]),...linkedOffers.flatMap(o=>o.heldReasons),...linkedMissions.filter(m=>!m.closed).flatMap(m=>m.heldReasons),...(deadline.status==='invalid'?['실제 고객 기회 기한 확인 필요']:[])]);
  const known=base.known&&linkedOffers.length>0&&linkedOffers.every(o=>o.preparation!=='unknown')&&linkedMissions.every(m=>m.closed||m.preparation!=='unknown');
  return {id:row.id,version:row.version,title:row.input.title,situation:row.input.situation,desiredOutcome:row.input.desiredOutcome,alternative:row.input.alternative,barrier:row.input.barrier,counterEvidence:row.input.counterEvidence,assignee:row.input.assignee,nextAction:row.input.nextAction,deadline,evidenceLevel:'hypothesis' as const,preparation:preparation(known,reasons),reasons,offers:linkedOffers,catalogs:catalogs.filter(c=>linkedOffers.some(o=>o.catalogId===c.id)).map(c=>({id:c.id,version:c.version,title:c.input.title,sku:c.input.sku,price:c.input.price??null})),missions:linkedMissions,readyOfferCount:linkedOffers.filter(x=>x.preparation==='reviewable').length,heldOfferCount:linkedOffers.filter(x=>x.preparation!=='reviewable').length,hasUnknownResult:linkedMissions.some(m=>m.status==='unknown'),mayExecute:false as const};
 }).sort(compare);
 const schedule=[...opportunities.map(n=>({key:`need:${n.id}`,kind:'need' as const,id:n.id,title:n.title,needId:n.id,deadline:n.deadline,assignee:n.assignee,nextAction:n.nextAction,status:'hypothesis',reasons:n.reasons,preparation:n.preparation})),...missionRows.map(m=>({key:`mission:${m.id}`,kind:'mission' as const,id:m.id,title:m.title,needId:m.needId,deadline:m.deadline,assignee:m.assignee,nextAction:m.nextAction,status:m.status,reasons:m.heldReasons,preparation:m.preparation}))].sort((a,b)=>compare(a,b)||a.key.localeCompare(b.key));
 return {evaluatedAt:new Date(nowMs).toISOString(),opportunities,schedule,unlinked:{offers:offerRows.filter(o=>!needs.some(n=>n.id===o.needId)),missions:missionRows.filter(m=>m.needId===null)},activeMissionCount:missionRows.filter(m=>m.active).length,openMissionCount:missionRows.filter(m=>m.open).length,mayExecute:false as const,sortExplanation:'기한·준비도 확인 필요·식별자 순서의 검토 목록입니다. 매출·수요 예측이나 실행 권한을 뜻하지 않습니다.'};
}
export type GrowthOpportunityBoard=ReturnType<typeof buildOpportunityBoard>;
