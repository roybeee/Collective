import type {Campaign} from './agency';
import type {CatalogInput,CatalogStock} from './growth-catalog';
import {projectInventory,type InventoryEvent} from './growth-inventory';
import type {InventoryRow} from './growth-operations-server';
import {ApiError,database,readRecord} from './server';

function held(input:CatalogInput,reason:string):CatalogStock{return {status:'held',inventoryId:null,inventoryVersion:null,unit:input.stockUnit??'unknown',onHand:null,reserved:null,available:null,shortage:null,reasons:[reason]}}
async function itemsFor(owner:string,c:Campaign){
 if(!c.storeId)throw Error('store missing');
 const store=await readRecord<{brandId:string}>(owner,'store',c.storeId);if(store.brandId!==c.brandId)throw Error('store scope');
 const rows=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 501').bind(owner,'growth_inventory_item',c.storeId).all<{data:string}>();if(rows.results.length>500)throw Error('inventory capacity');
 const items=rows.results.map(x=>JSON.parse(x.data) as InventoryRow);if(items.some(i=>!i||!i.input||typeof i.input.sku!=='string'))throw Error('inventory shape');return items;
}
async function projectionFor(owner:string,c:Campaign,item:InventoryRow){
 const rows=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 5001').bind(owner,'growth_stock_event',item.id).all<{data:string}>();if(rows.results.length>5000)throw Error('event capacity');
 const events=rows.results.map(x=>JSON.parse(x.data) as InventoryEvent&{brandId:string;storeId:string;inventoryId:string});
 if(events.some(e=>e.brandId!==c.brandId||e.storeId!==c.storeId||e.inventoryId!==item.id))throw Error('event scope');
 const projection=projectInventory(item.input,[...events].sort((a,b)=>a.version-b.version));
 if(projection.version!==item.version)throw Error('projection revision');return projection;
}
/** Read-only preparation evidence. A SKU must resolve to exactly one shared ledger. */
export async function catalogStocks(owner:string,c:Campaign,inputs:readonly CatalogInput[]):Promise<CatalogStock[]>{
 let items:InventoryRow[];try{items=await itemsFor(owner,c)}catch{return inputs.map(i=>held(i,'현재 지점의 공유 재고 조회·범위를 확인할 수 없습니다.'))}
 const projections=new Map<string,Promise<Awaited<ReturnType<typeof projectionFor>>>>();
 return Promise.all(inputs.map(async input=>{
  if(!input.stockUnit||input.stockUnit==='unknown')return held(input,'상품의 재고 단위를 먼저 확인하세요.');
  const matching=items.filter(i=>i.input.sku===input.sku);if(matching.length!==1)return held(input,matching.length?'같은 SKU의 재고 장부가 중복되어 대사가 필요합니다.':'현재 매장·SKU의 공유 재고 장부가 없습니다.');
  const item=matching[0];if(item.brandId!==c.brandId||item.storeId!==c.storeId||item.input.locationId!==c.storeId)return held(input,'재고 장부의 브랜드·지점·위치가 일치하지 않습니다.');
  if(item.input.unit!==input.stockUnit)return held(input,'상품과 재고 수량 단위가 다릅니다. 자동 환산하지 않습니다.');
  try{if(!projections.has(item.id))projections.set(item.id,projectionFor(owner,c,item));const p=await projections.get(item.id)!;if(p.onHand===null||p.available===null)return held(input,'현재 공유 재고 수량이 미확인입니다.');
   return {status:'known',inventoryId:item.id,inventoryVersion:item.version,unit:item.input.unit,onHand:p.onHand,reserved:p.reserved,available:p.available,shortage:p.shortage,reasons:[]};
  }catch{return held(input,'재고 사건 조회·범위·현재 판을 대사해야 합니다.')}
 }));
}

/** Existing order facts may allocate unknown/insufficient stock; identity and units still must agree. */
export async function requireCatalogInventoryIdentity(owner:string,c:Campaign,input:CatalogInput,inventoryId:string){
 let items:InventoryRow[];try{items=await itemsFor(owner,c)}catch{throw new ApiError(409,'현재 공유 재고 식별 범위를 확인할 수 없습니다.')}
 const matching=items.filter(i=>i.input.sku===input.sku),item=matching[0];
 if(!input.stockUnit||input.stockUnit==='unknown'||matching.length!==1||item.id!==inventoryId||item.brandId!==c.brandId||item.storeId!==c.storeId||item.input.locationId!==c.storeId||item.input.unit!==input.stockUnit)throw new ApiError(409,'상품과 단일 공유 재고의 범위·수량 단위를 확인하세요.');
}
