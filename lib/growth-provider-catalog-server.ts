import type {Campaign} from './agency';
import type {CatalogInput,CatalogStock} from './growth-catalog';
import {projectInventory,type InventoryEvent} from './growth-inventory';
import type {InventoryRow} from './growth-operations-server';
import type {GrowthRecord} from './growth-workspace-server';
import {readLandingProviderConnection} from './growth-provider-credential-server';
import {openRecordSecret} from './credential-crypto-server';
import {readProviderCatalog} from './growth-provider-catalog-client';
import {catalogCeiling,type ProviderCatalogSnapshot} from './growth-provider-catalog';
import {storefrontDigest} from './storefront-orders';
import {optionalRecord} from './growth-ledger-server';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
const kinds={binding:'growth_provider_catalog_binding',source:'growth_provider_catalog_source',history:'growth_provider_catalog_history',request:'growth_provider_catalog_request'} as const;
type Binding={id:string;brandId:string;storeId:string;campaignId:string;sku:string;inventoryId:string;catalogId:string;catalogVersion:number;productId:string;connectionVersion:number;version:number;approvedDigest:string|null;updatedAt:string;updatedBy:string};
type Source={id:string;brandId:string;storeId:string;campaignId:string;version:number;status:'ready'|'failed';snapshot:ProviderCatalogSnapshot|null;digest:string|null;connectionVersion:number;checkedAt:string;inventoryDigest:string|null};
const scope=(r:{brandId:string;storeId:string},c:Campaign)=>r.brandId===c.brandId&&r.storeId===c.storeId;
const held=(stock:CatalogStock,reason:string):CatalogStock=>({...stock,status:'held',available:null,reasons:[...stock.reasons,reason]});
const sourceBasis=(s:ProviderCatalogSnapshot,inventoryDigest:string|null)=>({snapshot:{...s,observedAt:undefined},inventoryDigest});
async function inventoryBasis(owner:string,c:Campaign,b:Binding){
 const item=await readRecord<InventoryRow>(owner,'growth_inventory_item',b.inventoryId);
 if(!scope(item,c)||item.input.sku!==b.sku||item.input.locationId!==c.storeId||item.input.unit!=='piece')throw Error('inventory_scope');
 const rows=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 5001').bind(owner,'growth_stock_event',item.id).all<{data:string}>();
 if(rows.results.length>5000)throw Error('inventory_capacity');
 const events=rows.results.map(x=>JSON.parse(x.data) as InventoryEvent&{brandId:string;storeId:string;inventoryId:string}).sort((a,b)=>a.version-b.version);
 if(events.some(e=>!scope(e,c)||e.inventoryId!==item.id)||projectInventory(item.input,events).version!==item.version)throw Error('inventory_lineage');
 const physical=events.filter(e=>['stocktake','receive','ship','return'].includes(e.kind));
 return {digest:await storefrontDigest({inventoryId:item.id,input:item.input,physical}),observedAfter:physical.at(-1)?.recordedAt??null};
}
async function bindings(owner:string,c:Campaign){const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 501').bind(owner,kinds.binding,c.storeId).all<{data:string}>();if(r.results.length>500)throw new ApiError(409,'판매처 상품 연결 조회 한도에 도달했습니다.');return r.results.map(x=>JSON.parse(x.data) as Binding)}
export async function providerCatalogView(who:Actor,c:Campaign){
 const connection=await readLandingProviderConnection(who.owner,c),rows=c.storeId?await bindings(who.owner,c):[];
 return {campaignVersion:c.version,connectionReady:!!connection?.enabled,canManage:who.role==='owner',rows:await Promise.all(rows.filter(x=>scope(x,c)).map(async binding=>({binding,source:await optionalRecord<Source>(who.owner,kinds.source,binding.id)})))};
}
export async function providerCatalogCeiling(owner:string,c:Campaign,input:CatalogInput,stock:CatalogStock):Promise<CatalogStock>{
 try{
  const matches=(await bindings(owner,c)).filter(x=>x.sku===input.sku);if(!matches.length)return stock;
  if(matches.length!==1)return held(stock,'판매처 SKU 연결이 중복되었습니다.');
  const b=matches[0],connection=await readLandingProviderConnection(owner,c),source=await optionalRecord<Source>(owner,kinds.source,b.id),catalog=await optionalRecord<GrowthRecord<CatalogInput>>(owner,'growth_catalog',b.catalogId);
  if(!scope(b,c)||b.inventoryId!==stock.inventoryId||!connection?.enabled||connection.version!==b.connectionVersion||!catalog||catalog.version!==b.catalogVersion||catalog.input.sku!==b.sku||!source||!scope(source,c)||source.status!=='ready'||!source.snapshot||source.connectionVersion!==connection.version||!source.digest||b.approvedDigest!==source.digest||source.snapshot.productId!==b.productId||source.snapshot.tenantId!==connection.tenantId||source.snapshot.storeId!==connection.providerStoreId||source.snapshot.price!==input.price||stock.unit!=='piece'||stock.available===null||stock.reserved===null)return held(stock,'판매처 연결·상품 판·가격·재고 근거를 가져온 뒤 승인하세요.');
  if(!source.inventoryDigest||(await inventoryBasis(owner,c,b)).digest!==source.inventoryDigest)return held(stock,'입출고·실사·반품 변경 후 판매처 재고를 다시 조회하고 승인하세요.');
  if(await storefrontDigest(sourceBasis(source.snapshot,source.inventoryDigest))!==source.digest)return held(stock,'판매처 상품 근거가 변경되었습니다.');
  return {...stock,available:catalogCeiling(stock.available,source.snapshot,stock.reserved)};
 }catch{return held(stock,'판매처 상품 동기화 실패·미확인·삭제·만료 상태를 대사하세요.')}
}
// A failing SELECT aborts the entire D1 batch before any source, history or request write.
function catalogRecordGuard(owner:string,kind:string,id:string,expected:unknown){
 return database().prepare("SELECT json(CASE WHEN (SELECT data FROM records WHERE owner=? AND kind=? AND id=?) IS ? THEN 'null' ELSE 'stale_provider_catalog' END)").bind(owner,kind,`${owner}:${kind}:${id}`,expected==null?null:JSON.stringify(expected));
}
export async function saveProviderCatalog(who:Actor,c:Campaign,b:Record<string,unknown>,options:{leaseToken?:string}={}){
 if(who.role!=='owner')throw new ApiError(403,'판매처 상품 연결은 소유자가 확인합니다.');
 if(!c.storeId||c.status==='archived'||b.campaignVersion!==c.version)throw new ApiError(409,'운영 캠페인과 점포의 현재 판이 필요합니다.');
 const store=await readRecord<{brandId:string}>(who.owner,'store',c.storeId);if(store.brandId!==c.brandId)throw new ApiError(404,'점포 범위가 다릅니다.');
 const requestId=str(b.requestId,'요청 ID',100,true);if(!/^[0-9a-f-]{36}$/.test(requestId))throw new ApiError(400,'요청 ID를 확인하세요.');
 const digest=await storefrontDigest(b),request=await optionalRecord<{digest:string}>(who.owner,kinds.request,requestId);if(request){if(request.digest!==digest)throw new ApiError(409,'요청 내용이 다릅니다.');return {recorded:true,duplicate:true};}
 const connection=await readLandingProviderConnection(who.owner,c);if(!connection?.enabled)throw new ApiError(409,'설치 확인된 MAPDAL 연결을 먼저 활성화하세요.');
 const leaseToken=options.leaseToken;if(!leaseToken)throw new ApiError(409,'상품 저장 작업 잠금이 필요합니다.');
 const guards:D1PreparedStatement[]=[catalogRecordGuard(who.owner,'campaign',c.id,c),catalogRecordGuard(who.owner,'channel_credential',connection.id,connection),catalogRecordGuard(who.owner,kinds.request,requestId,null)];
 const action=String(b.action),at=stamp(),writes:D1PreparedStatement[]=[];let binding:Binding,sourceHistory:Source|null=null;
 if(action==='bind'){
  const catalog=await readRecord<GrowthRecord<CatalogInput>>(who.owner,'growth_catalog',str(b.catalogId,'상품 ID',100,true)),inventory=await readRecord<InventoryRow>(who.owner,'growth_inventory_item',str(b.inventoryId,'재고 ID',100,true));
  if(catalog.brandId!==c.brandId||catalog.campaignId!==c.id||catalog.version!==b.catalogVersion||!scope(inventory,c)||inventory.version!==b.inventoryVersion||catalog.input.sku!==inventory.input.sku||catalog.input.stockUnit!=='piece'||inventory.input.unit!=='piece')throw new ApiError(409,'상품·공유 재고의 정확한 SKU·단위·판을 확인하세요.');
  const productId=str(b.productId,'판매처 상품 ID',100,true);if(!/^[A-Za-z0-9_:-]{1,100}$/.test(productId))throw new ApiError(400,'판매처 상품 ID 형식을 확인하세요.');
  const id='pc-'+(await storefrontDigest([c.brandId,c.storeId,catalog.input.sku])).slice(0,32),old=await optionalRecord<Binding>(who.owner,kinds.binding,id);
  guards.push(catalogRecordGuard(who.owner,kinds.binding,id,old));
  if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'연결 판이 변경되었습니다.');
  const all=await bindings(who.owner,c);if(!old&&all.length>=500)throw new ApiError(409,'상품 연결 한도에 도달했습니다.');if(all.some(x=>x.id!==id&&x.productId===productId))throw new ApiError(409,'같은 판매처 상품이 다른 SKU에 연결되어 있습니다.');
  binding={id,brandId:c.brandId,storeId:c.storeId,campaignId:c.id,sku:catalog.input.sku,inventoryId:inventory.id,catalogId:catalog.id,catalogVersion:catalog.version,productId,connectionVersion:connection.version,version:(old?.version??0)+1,approvedDigest:null,updatedAt:at,updatedBy:who.id};
  writes.push(recordStatement(who.owner,kinds.binding,id,binding,c.storeId));
 }else{
  binding=await readRecord<Binding>(who.owner,kinds.binding,str(b.id,'연결 ID',100,true));if(!scope(binding,c)||b.expectedVersion!==binding.version||connection.version!==binding.connectionVersion)throw new ApiError(409,'현재 점포 연결 판을 확인하세요.');
  const previous=await optionalRecord<Source>(who.owner,kinds.source,binding.id);
  guards.push(catalogRecordGuard(who.owner,kinds.binding,binding.id,binding),catalogRecordGuard(who.owner,kinds.source,binding.id,previous));
  if(action==='pull'){
   let snapshot:ProviderCatalogSnapshot|null=null,status:Source['status']='failed',inventoryDigest:string|null=null;
   try{const before=await inventoryBasis(who.owner,c,binding);snapshot=await readProviderCatalog({baseUrl:connection.baseUrl,tenantId:connection.tenantId,storeId:connection.providerStoreId,secret:await openRecordSecret(who.owner,'channel_credential',connection.id,connection.secret)},binding.productId);if(previous?.snapshot&&Date.parse(snapshot.observedAt)<Date.parse(previous.snapshot.observedAt))throw Error('stale_snapshot');const after=await inventoryBasis(who.owner,c,binding);if(before.digest!==after.digest||after.observedAfter&&Date.parse(snapshot.observedAt)<Date.parse(after.observedAfter))throw Error('inventory_changed_during_pull');inventoryDigest=after.digest;status='ready';}catch{snapshot=null;}
   const next:Source={id:binding.id,brandId:c.brandId,storeId:c.storeId,campaignId:c.id,version:(previous?.version??0)+1,status,snapshot,digest:snapshot?await storefrontDigest(sourceBasis(snapshot,inventoryDigest)):null,connectionVersion:connection.version,checkedAt:at,inventoryDigest};
   sourceHistory=next;writes.push(recordStatement(who.owner,kinds.source,binding.id,next,c.storeId));
  }else if(action==='review'){
   if(!previous?.snapshot||previous.status!=='ready'||b.sourceVersion!==previous.version||b.sourceDigest!==previous.digest||b.confirmed!==true)throw new ApiError(409,'가져온 정확한 상품 근거와 운영자 확인이 필요합니다.');
   if(!previous.inventoryDigest||(await inventoryBasis(who.owner,c,binding)).digest!==previous.inventoryDigest)throw new ApiError(409,'입출고·실사·반품 변경 후 판매처 근거를 다시 조회하세요.');
   try{catalogCeiling(0,previous.snapshot,0)}catch{throw new ApiError(409,'현재 판매처 상품·재고의 유효한 관측이 필요합니다.');}const catalog=await readRecord<GrowthRecord<CatalogInput>>(who.owner,'growth_catalog',binding.catalogId);
   if(catalog.version!==binding.catalogVersion||catalog.input.price!==previous.snapshot.price)throw new ApiError(409,'판매처 가격과 현재 상품 판을 먼저 대사하세요.');
   binding={...binding,version:binding.version+1,approvedDigest:previous.digest,updatedAt:at,updatedBy:who.id};writes.push(recordStatement(who.owner,kinds.binding,binding.id,binding,c.storeId));
  }else throw new ApiError(400,'지원하지 않는 상품 동기화 작업입니다.');
 }
 writes.push(recordStatement(who.owner,kinds.request,requestId,{digest,brandId:c.brandId,storeId:c.storeId,campaignId:c.id},c.storeId),recordStatement(who.owner,kinds.history,requestId,{id:requestId,action,binding,source:sourceHistory,at,by:who.id},c.storeId));
 if(leaseToken)guards.push(database().prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM mutation_locks WHERE owner=? AND token=? AND expires_at>=?) THEN 'null' ELSE 'stale_provider_catalog_lease' END)").bind(who.owner,leaseToken,Date.now()));
 try{await database().batch([...guards,...writes]);}catch(e){if(/malformed JSON/i.test(String(e)))throw new ApiError(409,'상품 조회 잠금 또는 근거 판이 변경되었습니다. 현재 상태를 다시 확인하세요.');throw e;}return {recorded:true,duplicate:false};
}
