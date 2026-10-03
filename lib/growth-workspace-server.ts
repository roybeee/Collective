import type {Campaign} from './agency';
import {effectiveBrandFacts,type BrandFact,type FactRef} from './brand-facts';
import {parseCatalogInput,parseOfferInput,catalogReadiness,offerReadiness,type CatalogInput,type OfferInput,type CatalogStock} from './growth-catalog';
import {parseSignalInput,parseNeedInput,signalEvidence,needReadiness,type SignalInput,type NeedInput} from './growth-market';
import {parseMissionInput,missionReadiness,growthText,type MissionInput,type MissionReceipt,type MissionState} from './growth-mission';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
import {storefrontDigest} from './storefront-orders';
import {catalogStocks} from './growth-stock-readiness-server';
import {liveSignalSource} from './growth-signal-source-server';
import type {SignalSourceProvenance} from './growth-signal-source';
import {growthBusiness} from './growth-business-server';
import {buildOpportunityBoard} from './growth-opportunity-board';

// 상품 리서치 선정(lib/product-research/server.ts handoff)에서 넘어온 시장 근거의 계보. 있으면 성장 화면에서 고쳐 쓸 수 없다(근거가 끊긴다).
export type ProductResearchProvenance={decisionId:string;scoreCardId:string;productId:string;snapshotIds:string[]};
export type GrowthRecord<T>={id:string;campaignId:string;brandId:string;campaignVersion:number;version:number;input:T;updatedAt:string;updatedBy:string;requestDigest:string;sourceProvenance?:SignalSourceProvenance;productResearch?:ProductResearchProvenance;factRefs?:FactRef[];evidenceRefs?:{id:string;version:number}[];status?:MissionState;receipt?:MissionReceipt};
type Catalog=GrowthRecord<CatalogInput>;
const kinds={signal:'growth_signal',need:'growth_need',catalog:'growth_catalog',offer:'growth_offer',mission:'growth_mission'} as const;
type Entity=keyof typeof kinds;
async function rows<T>(owner:string,kind:string,c:Campaign){
 const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT 501').bind(owner,kind,c.id).all<{data:string}>();
 if(r.results.length>500)throw new ApiError(409,'캠페인별 기록이 500건을 넘습니다. 운영자에게 문의하세요.');
 return r.results.map(x=>JSON.parse(x.data) as GrowthRecord<T>).filter(x=>x.brandId===c.brandId&&x.campaignId===c.id);
}
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function sameScope<T>(record:GrowthRecord<T>|null,c:Campaign){if(record&&(record.campaignId!==c.id||record.brandId!==c.brandId))throw new ApiError(404,'이 캠페인의 기록을 찾지 못했습니다.');return record}
async function factsFor(owner:string,c:Campaign){
 const raw=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='brand_fact' AND parent_id=?").bind(owner,c.brandId).all<{data:string}>();
 return effectiveBrandFacts(raw.results.map(r=>JSON.parse(r.data) as BrandFact),c.brandId,c.storeId);
}
function catalogStatus(r:Catalog,facts:BrandFact[],c:Campaign,stock:CatalogStock){
 const base=catalogReadiness(r.input,Date.now(),stock),current=new Map(facts.map(f=>[f.id,f.version]));
 return {...base,missing:[...base.missing,...(r.campaignVersion!==c.version?['캠페인 변경 후 상품 재검토']:[]),...((r.factRefs??[]).some(f=>current.get(f.id)!==f.version)?['상품 사실 변경·만료: 재검토 필요']:[])]};
}
async function workspace(owner:string,c:Campaign){
 const [signals,needs,catalogs,offers,missions,facts]=await Promise.all([rows<SignalInput>(owner,kinds.signal,c),rows<NeedInput>(owner,kinds.need,c),rows<CatalogInput>(owner,kinds.catalog,c),rows<OfferInput>(owner,kinds.offer,c),rows<MissionInput>(owner,kinds.mission,c),factsFor(owner,c)]);
 const currentSignals=await Promise.all(signals.map(async r=>{const sourceReadiness=await liveSignalSource(owner,c,r),base=signalEvidence(r.input,Date.now());return {...r,sourceReadiness,evidence:sourceReadiness?.status==='held'?{status:'insufficient' as const,reason:sourceReadiness.reasons.join(' ')}:base}}));
 const ns=needs.map(r=>{const base=needReadiness(r.input,currentSignals,Date.now());return {...r,readiness:{...base,missing:[...base.missing,...(r.input.signalIds.some(id=>!r.evidenceRefs?.some(ref=>ref.id===id&&ref.version===signals.find(s=>s.id===id)?.version))?['시장 근거 변경 후 고객 기회 재검토']:[]),...(r.campaignVersion!==c.version?['캠페인 변경 후 고객 기회 재검토']:[])]}}});
 const stocks=await catalogStocks(owner,c,catalogs.map(r=>r.input));
 const cs=catalogs.map((r,i)=>({...r,currentStock:stocks[i],readiness:catalogStatus(r,facts,c,stocks[i])}));
 const os=offers.map(r=>{const item=cs.find(x=>x.id===r.input.catalogId)??null,need=ns.find(n=>n.id===r.input.needId);const base=offerReadiness(r.input,item,Date.now(),item?.currentStock);return {...r,currentStock:item?.currentStock??null,readiness:{...base,missing:[...base.missing,...(item?.readiness.missing??[]),...(need?.readiness.missing??['고객 근거 연결']),...(need&&!r.evidenceRefs?.some(ref=>ref.id===need.id&&ref.version===need.version)?['고객 기회 변경 후 오퍼 재검토']:[]),...(r.campaignVersion!==c.version?['캠페인 변경 후 오퍼 재검토']:[])]}}});
 const ms=missions.map(r=>{const offer=os.find(x=>x.id===r.input.offerId);return {...r,currentStock:offer?.currentStock??null,readiness:missionReadiness(r.input,[...(offer?.readiness.missing??['판매 오퍼 연결']),...(offer&&offer.version!==r.input.offerVersion?['오퍼 변경 후 미션 재검토']:[]),...(r.campaignVersion!==c.version?['캠페인 변경 후 미션 재검토']:[])])}});
 return {signals:currentSignals,needs:ns,catalogs:cs,offers:os,missions:ms,facts:facts.map(f=>({id:f.id,version:f.version,key:f.key,value:f.value})),campaignVersion:c.version};
}
export async function growthView(owner:string,c:Campaign,canEdit:boolean){
 const [data,business]=await Promise.all([workspace(owner,c),growthBusiness(owner,c)]);
 return {...data,business,opportunityBoard:buildOpportunityBoard(data,Date.now()),canEdit:canEdit&&c.status!=='archived',mayExecute:false as const,summary:{salesStatus:business.status,activeMissions:data.missions.filter(m=>['staged','unknown'].includes(m.status??'')).length,blockedMissions:data.missions.filter(m=>m.readiness.missing.length).length},links:{campaignId:c.id,brandId:c.brandId,storeId:c.storeId??null,orders:'store_order',meta:'meta_ads_plan'}};
}
function entityFor(action:unknown):Entity{
 const entity=typeof action==='string'&&action.startsWith('save_')?action.slice(5):'';
 if(!Object.hasOwn(kinds,entity))throw new ApiError(400,'지원하지 않는 성장 작업입니다.');
 return entity as Entity;
}
function recordId(value:unknown){const id=str(value,'기록 ID',100,true);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new ApiError(400,'기록 ID 형식을 확인하세요.');return id}
async function required<T>(owner:string,entity:Entity,id:string,c:Campaign){const r=sameScope(await optional<GrowthRecord<T>>(owner,kinds[entity],id),c);if(!r)throw new ApiError(404,'참조 기록을 찾지 못했습니다.');return r}
async function validateReferences(owner:string,c:Campaign,entity:Entity,input:unknown){
 if(entity==='need'){const n=input as NeedInput;for(const id of n.signalIds)await required<SignalInput>(owner,'signal',id,c)}
 if(entity==='offer'){const o=input as OfferInput;if(o.catalogId){const r=await required<CatalogInput>(owner,'catalog',o.catalogId,c);if(r.version!==o.catalogVersion)throw new ApiError(409,'상품이 변경되었습니다. 다시 선택하세요.')}if(o.needId)await required<NeedInput>(owner,'need',o.needId,c)}
 if(entity==='mission'){const m=input as MissionInput;if(m.offerId){const r=await required<OfferInput>(owner,'offer',m.offerId,c);if(r.version!==m.offerVersion)throw new ApiError(409,'오퍼가 변경되었습니다. 다시 선택하세요.')}}
}
async function commitRecord<T>(who:Actor,entity:Entity,c:Campaign,record:GrowthRecord<T>){
 const historyId=`${entity}:${record.id}:${record.version}`;
 // The owner mutation lock serializes revision allocation; batch keeps current and history atomic.
 const history=database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:growth_history:${historyId}`,who.owner,'growth_history',c.id,JSON.stringify({...record,entity}),record.updatedAt);
 await database().batch([recordStatement(who.owner,kinds[entity],record.id,record,c.id),history]);
}
export async function saveGrowth(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 if(['queue_mission','record_receipt','cancel_mission'].includes(String(b.action)))return transitionMission(who,c,b);
 const entity=entityFor(b.action),id=recordId(b.id),old=sameScope(await optional<GrowthRecord<unknown>>(who.owner,kinds[entity],id),c);
 if(entity==='signal'&&(old?.sourceProvenance||old?.productResearch))throw new ApiError(409,'가져온 신호는 원본 자료에서 수정한 뒤 새 판을 가져오세요.');
 const parsers={signal:parseSignalInput,need:parseNeedInput,catalog:parseCatalogInput,offer:parseOfferInput,mission:parseMissionInput};
 const input=parsers[entity](b.input),digest=await storefrontDigest({action:b.action,input,campaignVersion:c.version,expectedVersion:b.expectedVersion});
 if(old?.requestDigest===digest)return {...await growthView(who.owner,c,true),duplicate:true};
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'다른 변경이 있습니다. 다시 불러오세요.');
 if(!old&&(await rows(who.owner,kinds[entity],c)).length>=500)throw new ApiError(409,'이 종류의 기록은 캠페인별 500건까지 만들 수 있습니다.');
 if(entity==='mission'&&old&&old.status!=='draft')throw new ApiError(409,'준비 요청한 미션은 변경할 수 없습니다. 새 미션을 만드세요.');
 await validateReferences(who.owner,c,entity,input);
 const evidenceRefs=entity==='need'?await Promise.all((input as NeedInput).signalIds.map(async id=>{const r=await required<SignalInput>(who.owner,'signal',id,c);return {id,version:r.version}})):entity==='offer'&&(input as OfferInput).needId?[await required<NeedInput>(who.owner,'need',(input as OfferInput).needId,c).then(r=>({id:r.id,version:r.version}))]:[];
 const facts=entity==='catalog'?await factsFor(who.owner,c):[];
 const factIds=entity==='catalog'?(input as CatalogInput).factIds:[];
 if(factIds.some(fid=>!facts.some(f=>f.id===fid)))throw new ApiError(409,'상품 근거는 현재 브랜드·지점의 유효한 확정 사실이어야 합니다.');
 const record:GrowthRecord<unknown>={id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:(old?.version??0)+1,input,updatedAt:stamp(),updatedBy:who.id,requestDigest:digest,evidenceRefs,...(entity==='catalog'?{factRefs:facts.filter(f=>factIds.includes(f.id)).map(f=>({id:f.id,version:f.version}))}:{}),...(entity==='mission'?{status:'draft' as const}:{})};
 await commitRecord(who,entity,c,record);
 return {...await growthView(who.owner,c,true),duplicate:false};
}
async function transitionMission(who:Actor,c:Campaign,b:Record<string,unknown>){
 const old=await required<MissionInput>(who.owner,'mission',recordId(b.id),c),digest=await storefrontDigest({action:b.action,input:b.input??null,expectedVersion:b.expectedVersion,campaignVersion:c.version});
 const linked=await database().prepare("SELECT id FROM records WHERE owner=? AND kind='growth_action_intent' AND parent_id=? AND json_extract(data,'$.input.missionId')=? LIMIT 1").bind(who.owner,c.id,old.id).first();
 if(linked)throw new ApiError(409,'예산·재고가 연결된 미션은 판매 실행 결과 확인에서 처리하세요.');
 if(old.requestDigest===digest)return {...await growthView(who.owner,c,true),duplicate:true};
 if(b.expectedVersion!==old.version)throw new ApiError(409,'판매 미션이 변경되었습니다. 다시 불러오세요.');
 let status:MissionState=old.status??'draft',receipt=old.receipt;
 if(b.action==='queue_mission'){
  if(status!=='draft')throw new ApiError(409,'이미 요청한 미션입니다. 결과 불명 작업은 재요청할 수 없습니다.');
  const current=(await workspace(who.owner,c)).missions.find(m=>m.id===old.id);
  if(!current||current.readiness.missing.length)throw new ApiError(409,'상품·오퍼·근거와 실행 준비를 다시 확인하세요.');
  status='staged';
 }else if(b.action==='cancel_mission'){
  if(!['draft','staged'].includes(status))throw new ApiError(409,'외부 결과를 확인한 뒤 종료하세요.');
  status='cancelled';
 }else{
  if(!['staged','unknown'].includes(status))throw new ApiError(409,'준비 요청 또는 결과 확인 중인 미션만 기록할 수 있습니다.');
  const input=b.input as Record<string,unknown>|null;
  if(!input||!['unknown','failed','observed'].includes(String(input.status)))throw new ApiError(400,'실행 확인 상태를 선택하세요.');
  const reference=growthText(input.reference,'실행 증빙 참조',200,true),note=growthText(input.note,'확인 내용',1000,true);
  status=input.status as MissionReceipt['status'];receipt={status,reference,note,recordedAt:stamp(),recordedBy:who.id};
 }
 await commitRecord(who,'mission',c,{...old,version:old.version+1,status,...(receipt?{receipt}:{}),updatedAt:stamp(),updatedBy:who.id,requestDigest:digest});
 return {...await growthView(who.owner,c,true),duplicate:false};
}
