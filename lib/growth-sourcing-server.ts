import type {Campaign} from './agency';
import {parseCatalogInput,type CatalogInput} from './growth-catalog';
import {parseCandidateInput,parseComparisonInput,sourcingText,assessSourcing,type CandidateInput,type ComparisonInput,type SourcingInventory} from './growth-sourcing';
import {projectInventory,type InventoryEvent} from './growth-inventory';
import type {InventoryRow} from './growth-operations-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
const kinds={candidate:'growth_sourcing_candidate',history:'growth_sourcing_history',comparison:'growth_sourcing_comparison',request:'growth_sourcing_request'} as const;
type Scoped={brandId:string;campaignId:string};
export type SourcingCatalog=Scoped&{id:string;version:number;campaignVersion:number;input:CatalogInput};
export type CandidateRecord=Scoped&{id:string;version:number;campaignVersion:number;input:CandidateInput;createdAt:string;updatedAt:string};
export type ComparisonRecord=Scoped&{id:string;campaignVersion:number;input:ComparisonInput;snapshot:{input:ComparisonInput;catalog:SourcingCatalog;candidates:CandidateRecord[];inventory:SourcingInventory;storeId:string|null};assessment:ReturnType<typeof assessSourcing>;snapshotDigest:string;createdAt:string};
function scope<T extends Scoped>(row:T,c:Campaign){if(row.brandId!==c.brandId||row.campaignId!==c.id)throw new ApiError(404,'현재 캠페인의 소싱 기록이 아닙니다.');return row}
function id(v:unknown){const s=str(v,'기록 ID',100,true);if(!/^[A-Za-z0-9_-]+$/.test(s))throw new ApiError(400,'기록 ID 형식을 확인하세요.');return s}
function append(owner:string,kind:string,key:string,row:unknown,parent:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${key}`,owner,kind,parent,JSON.stringify(row),stamp())}
async function optional<T>(owner:string,kind:string,key:string){try{return await readRecord<T>(owner,kind,key)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function rows<T extends Scoped>(owner:string,c:Campaign,kind:string,limit=500){const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();if(r.results.length>limit)throw new ApiError(409,'소싱 기록 한도를 넘었습니다. 전체 기록을 대사하세요.');return r.results.map(x=>scope(JSON.parse(x.data) as T,c))}
async function capacity(owner:string,c:Campaign,kind:string,max:number){const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=max)throw new ApiError(409,'소싱 기록 한도에 도달했습니다.')}
async function inventoryRows(owner:string,c:Campaign){
 if(!c.storeId)return [];
 const store=await optional<{brandId:string}>(owner,'store',c.storeId);if(!store||store.brandId!==c.brandId)return [];
 const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 501').bind(owner,'growth_inventory_item',c.storeId).all<{data:string}>();if(r.results.length>500)throw new ApiError(409,'재고 품목 조회 한도를 넘었습니다.');
 return r.results.map(x=>JSON.parse(x.data) as InventoryRow).filter(r=>r.brandId===c.brandId&&r.storeId===c.storeId);
}
function matched(items:InventoryRow[],sku:string){return items.filter(i=>i.input.sku===sku)}
async function stockSnapshot(owner:string,c:Campaign,catalog:SourcingCatalog,unit:ComparisonInput['unit']):Promise<SourcingInventory>{
 const items=matched(await inventoryRows(owner,c),catalog.input.sku),refs=items.map(i=>({id:i.id,version:i.version}));
 const unknown=(reason:string):SourcingInventory=>({status:'unknown',unit,onHand:null,reserved:null,available:null,shortage:null,items:refs,reason});
 if(!items.length)return unknown('현재 매장·SKU의 재고 기록 없음');
 if(items.some(i=>i.input.unit!==unit))return unknown('견적과 재고 수량 단위 불일치: 자동 환산하지 않음');
 let onHand=0,reserved=0;
 for(const item of items){
  const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 5001').bind(owner,'growth_stock_event',item.id).all<{data:string}>();if(r.results.length>5000)return unknown('재고 사건 조회 한도 초과');
  const events=r.results.map(x=>JSON.parse(x.data) as InventoryEvent&{brandId:string;storeId:string;inventoryId:string});
  if(events.some(e=>e.brandId!==c.brandId||e.storeId!==c.storeId||e.inventoryId!==item.id))return unknown('재고 사건 범위 재확인');
  let projection;try{projection=projectInventory(item.input,events.sort((a,b)=>a.version-b.version))}catch{return unknown('재고 사건 대사 필요')}
  if(projection.onHand===null||projection.version!==item.version)return unknown('현재 수량 또는 재고 판 미확인');
  onHand+=projection.onHand;reserved+=projection.reserved;if(!Number.isSafeInteger(onHand)||!Number.isSafeInteger(reserved))return unknown('재고 합계 안전 범위 초과');
 }
 return {status:'known',unit,onHand,reserved,available:Math.max(0,onHand-reserved),shortage:Math.max(0,reserved-onHand),items:refs,reason:'현재 공유 재고 장부 관측. 비교 가정은 입고가 아닙니다.'};
}
function safeCatalog(row:SourcingCatalog){const input=parseCatalogInput(row.input);for(const key of ['sku','title','fulfillment','refunds'] as const)if(input[key])sourcingText(input[key],'상품 근거',false,key==='fulfillment'||key==='refunds'?2000:200);return {...row,input}}
function comparisonChanged(row:ComparisonRecord,c:Campaign,candidates:CandidateRecord[],catalogs:SourcingCatalog[],items:InventoryRow[],now:number){
 const cat=catalogs.find(x=>x.id===row.input.catalogId),currentItems=matched(items,row.snapshot.catalog.input.sku);
 if(row.campaignVersion!==c.version||row.snapshot.storeId!==(c.storeId??null)||!cat||cat.version!==row.input.catalogVersion||row.input.candidates.some(ref=>!candidates.some(q=>q.id===ref.id&&q.version===ref.version))||currentItems.length!==row.snapshot.inventory.items.length||currentItems.some(i=>!row.snapshot.inventory.items.some(r=>r.id===i.id&&r.version===i.version)))return true;
 const currentCandidates=row.input.candidates.map(ref=>candidates.find(q=>q.id===ref.id)!);
 return JSON.stringify(assessSourcing(row.input,cat,currentCandidates,row.snapshot.inventory,c.version,now))!==JSON.stringify(row.assessment);
}
export async function growthSourcingView(who:Actor,c:Campaign,now=Date.now()){
 const [candidates,candidateHistory,comparisons,rawCatalogs,items]=await Promise.all([rows<CandidateRecord>(who.owner,c,kinds.candidate,100),rows<CandidateRecord>(who.owner,c,kinds.history,1000),rows<ComparisonRecord>(who.owner,c,kinds.comparison,200),rows<SourcingCatalog>(who.owner,c,'growth_catalog'),inventoryRows(who.owner,c)]);
 const catalogs=rawCatalogs.map(safeCatalog);
 return {candidates,candidateHistory,comparisons:comparisons.map(row=>({...row,currentChanged:comparisonChanged(row,c,candidates,catalogs,items,now)})),catalogs,campaignVersion:c.version,canEdit:c.status!=='archived',mayOrder:false as const};
}
export type SourcingView=Awaited<ReturnType<typeof growthSourcingView>>;
async function currentCatalog(owner:string,c:Campaign,key:string,version:number){const row=safeCatalog(scope(await readRecord<SourcingCatalog>(owner,'growth_catalog',key),c));if(row.version!==version||row.campaignVersion!==c.version)throw new ApiError(409,'상품·캠페인이 변경되었습니다. 최신 상품 판을 선택하세요.');return row}
async function saveCandidate(who:Actor,c:Campaign,b:Record<string,unknown>,key:string){
 const input=parseCandidateInput(b.input),old=await optional<CandidateRecord>(who.owner,kinds.candidate,key);if(old)scope(old,c);
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'공급 후보가 변경되었습니다. 최신 판과 비교하세요.');
 await currentCatalog(who.owner,c,input.catalogId,input.catalogVersion);if(!old)await capacity(who.owner,c,kinds.candidate,100);await capacity(who.owner,c,kinds.history,1000);
 const at=stamp(),row:CandidateRecord={id:key,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,version:(old?.version??0)+1,input,createdAt:old?.createdAt??at,updatedAt:at};
 return [old?recordStatement(who.owner,kinds.candidate,key,row,c.id):append(who.owner,kinds.candidate,key,row,c.id),append(who.owner,kinds.history,crypto.randomUUID(),row,c.id)];
}
async function capture(who:Actor,c:Campaign,b:Record<string,unknown>,key:string){
 if(b.expectedVersion!==0||await optional(who.owner,kinds.comparison,key))throw new ApiError(409,'비교는 불변 기록입니다. 새 비교를 저장하세요.');
 const input=parseComparisonInput(b.input),catalog=await currentCatalog(who.owner,c,input.catalogId,input.catalogVersion),candidates=[] as CandidateRecord[];
 for(const ref of input.candidates){const row=scope(await readRecord<CandidateRecord>(who.owner,kinds.candidate,ref.id),c);if(row.version!==ref.version)throw new ApiError(409,'공급 후보 판이 변경되었습니다.');if(row.input.catalogId!==catalog.id)throw new ApiError(400,'같은 상품의 공급 후보만 비교하세요.');candidates.push({...row,input:parseCandidateInput(row.input)})}
 const inventory=await stockSnapshot(who.owner,c,catalog,input.unit),snapshot={input,catalog,candidates,inventory,storeId:c.storeId??null};
 await capacity(who.owner,c,kinds.comparison,200);
 const row:ComparisonRecord={id:key,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,input,snapshot,assessment:assessSourcing(input,catalog,candidates,inventory,c.version),snapshotDigest:await storefrontDigest(snapshot),createdAt:stamp()};
 return [append(who.owner,kinds.comparison,key,row,c.id)];
}
export async function saveGrowthSourcing(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다.');
 if(!['save_candidate','capture_comparison'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 소싱 작업입니다.');
 const key=id(b.id);if(typeof b.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId))throw new ApiError(400,'요청 UUID를 확인하세요.');
 const requestId=b.requestId.toLowerCase(),digest=await storefrontDigest(b),old=await optional<Scoped&{digest:string;resultId:string}>(who.owner,kinds.request,requestId);
 if(old){scope(old,c);if(old.digest!==digest)throw new ApiError(409,'동일 요청 ID의 내용이 다릅니다.');return {...await growthSourcingView(who,c),duplicate:true,resultId:old.resultId};}
 await growthSourcingView(who,c);await capacity(who.owner,c,kinds.request,5000);
 const writes=b.action==='save_candidate'?await saveCandidate(who,c,b,key):await capture(who,c,b,key);
 writes.push(append(who.owner,kinds.request,requestId,{id:requestId,brandId:c.brandId,campaignId:c.id,digest,resultId:key},c.id));await database().batch(writes);
 return {...await growthSourcingView(who,c),resultId:key};
}
