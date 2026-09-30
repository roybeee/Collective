import type {Campaign} from './agency';
import {parseCatalogInput} from './growth-catalog';
import {parseCandidateInput,sourcingText,type SourcingInventory} from './growth-sourcing';
import {stockSnapshot,type SourcingCatalog,type CandidateRecord} from './growth-sourcing-server';
import {assessReorder,parseReorderInput,type ReorderInput,type ReorderAssessment} from './growth-reorder';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,stamp,str,type Actor} from './server';
const kinds={review:'growth_reorder_review',request:'growth_reorder_request'} as const;
type Scoped={brandId:string;campaignId:string};
export type ReorderReview=Scoped&{id:string;campaignVersion:number;input:ReorderInput;snapshot:{evaluatedAt:string;input:ReorderInput;catalog:SourcingCatalog;candidate:CandidateRecord;inventory:SourcingInventory;storeId:string|null};assessment:ReorderAssessment;snapshotDigest:string;createdAt:string};
function scope<T extends Scoped>(r:T,c:Campaign){if(r.brandId!==c.brandId||r.campaignId!==c.id)throw new ApiError(404,'현재 브랜드·캠페인의 재발주 근거가 아닙니다.');return r}
function id(v:unknown){const s=str(v,'기록 ID',100,true);if(!/^[A-Za-z0-9_-]+$/.test(s))throw new ApiError(400,'기록 ID 형식을 확인하세요.');return s}
async function optional<T>(owner:string,kind:string,key:string){try{return await readRecord<T>(owner,kind,key)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function rows<T extends Scoped>(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();if(r.results.length>limit)throw new ApiError(409,'재발주 검토 근거 조회 한도를 넘었습니다.');return r.results.map(x=>scope(JSON.parse(x.data) as T,c))}
function catalog(r:SourcingCatalog){const input=parseCatalogInput(r.input);for(const k of ['sku','title','fulfillment','refunds'] as const)if(input[k])sourcingText(input[k],'상품 근거',false,k==='fulfillment'||k==='refunds'?2000:200);return {...r,input}}
async function inventoryRefs(owner:string,c:Campaign){if(!c.storeId)return [];const store=await optional<{brandId:string}>(owner,'store',c.storeId);if(!store||store.brandId!==c.brandId)return [];const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 501').bind(owner,'growth_inventory_item',c.storeId).all<{data:string}>();if(r.results.length>500)throw new ApiError(409,'재고 조회 한도를 넘었습니다.');return r.results.map(x=>JSON.parse(x.data) as {id:string;version:number;brandId:string;storeId:string;input:{sku:string}}).filter(x=>x.brandId===c.brandId&&x.storeId===c.storeId)}
function changed(r:ReorderReview,c:Campaign,catalogs:SourcingCatalog[],candidates:CandidateRecord[],items:Awaited<ReturnType<typeof inventoryRefs>>,now:number){
 const cat=catalogs.find(x=>x.id===r.input.catalogId),q=candidates.find(x=>x.id===r.input.candidateId),stock=items.filter(x=>x.input.sku===r.snapshot.catalog.input.sku);
 if(c.version!==r.campaignVersion||(c.storeId??null)!==r.snapshot.storeId||!cat||cat.version!==r.input.catalogVersion||!q||q.version!==r.input.candidateVersion||stock.length!==r.snapshot.inventory.items.length||stock.some(x=>!r.snapshot.inventory.items.some(y=>y.id===x.id&&y.version===x.version)))return true;
 return JSON.stringify(assessReorder(r.input,cat,q,r.snapshot.inventory,c.version,now))!==JSON.stringify(r.assessment);
}
export async function growthReorderView(who:Actor,c:Campaign,now=Date.now()){
 const [rawCatalogs,rawCandidates,reviews,items]=await Promise.all([rows<SourcingCatalog>(who.owner,c,'growth_catalog',500),rows<CandidateRecord>(who.owner,c,'growth_sourcing_candidate',100),rows<ReorderReview>(who.owner,c,kinds.review,200),inventoryRefs(who.owner,c)]);
 const catalogs=rawCatalogs.map(catalog),candidates=rawCandidates.map(q=>({...q,input:parseCandidateInput(q.input)}));
 return {catalogs,candidates,reviews:reviews.map(r=>({...r,currentChanged:changed(r,c,catalogs,candidates,items,now)})),campaignVersion:c.version,canEdit:c.status!=='archived',mayOrder:false as const};
}
export type ReorderView=Awaited<ReturnType<typeof growthReorderView>>;
function append(owner:string,kind:string,key:string,row:unknown,parent:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${key}`,owner,kind,parent,JSON.stringify(row),stamp())}
export async function saveGrowthReorder(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 검토를 추가할 수 없습니다.');if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다.');if(b.action!=='capture_review')throw new ApiError(400,'지원하지 않는 재발주 작업입니다.');
 const key=id(b.id);if(typeof b.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId))throw new ApiError(400,'요청 UUID를 확인하세요.');
 const requestId=b.requestId.toLowerCase(),digest=await storefrontDigest(b),previous=await optional<Scoped&{digest:string;resultId:string}>(who.owner,kinds.request,requestId);
 if(previous){scope(previous,c);if(previous.digest!==digest)throw new ApiError(409,'같은 요청 ID의 입력이 다릅니다.');return {...await growthReorderView(who,c),resultId:previous.resultId,duplicate:true};}
 if(b.expectedVersion!==0||await optional(who.owner,kinds.review,key))throw new ApiError(409,'저장한 검토는 변경할 수 없습니다. 새 검토를 저장하세요.');
 const now=Date.now(),input=parseReorderInput(b.input,now),cat=catalog(scope(await readRecord<SourcingCatalog>(who.owner,'growth_catalog',input.catalogId),c)),raw=scope(await readRecord<CandidateRecord>(who.owner,'growth_sourcing_candidate',input.candidateId),c),candidate={...raw,input:parseCandidateInput(raw.input)};
 if(cat.version!==input.catalogVersion||candidate.version!==input.candidateVersion||cat.campaignVersion!==c.version||candidate.campaignVersion!==c.version||candidate.input.catalogVersion!==cat.version)throw new ApiError(409,'상품·견적·캠페인 판이 변경되었습니다.');if(candidate.input.catalogId!==cat.id)throw new ApiError(400,'같은 상품의 견적을 선택하세요.');
 const view=await growthReorderView(who,c,now);if(view.reviews.length>=200)throw new ApiError(409,'재발주 검토 저장 한도에 도달했습니다.');
 const count=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(who.owner,kinds.request,c.id).first<{n:number}>();if((count?.n??0)>=5000)throw new ApiError(409,'요청 기록 한도에 도달했습니다.');
 const inventory=await stockSnapshot(who.owner,c,cat,input.unit),snapshot={evaluatedAt:new Date(now).toISOString(),input,catalog:cat,candidate,inventory,storeId:c.storeId??null};
 const review:ReorderReview={id:key,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,input,snapshot,assessment:assessReorder(input,cat,candidate,inventory,c.version,now),snapshotDigest:await storefrontDigest(snapshot),createdAt:snapshot.evaluatedAt};
 await database().batch([append(who.owner,kinds.review,key,review,c.id),append(who.owner,kinds.request,requestId,{id:requestId,brandId:c.brandId,campaignId:c.id,digest,resultId:key},c.id)]);
 return {...view,reviews:[{...review,currentChanged:false},...view.reviews],resultId:key};
}
