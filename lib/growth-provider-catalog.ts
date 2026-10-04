import {GROWTH_PROVIDER_PRODUCT_ID} from './growth-provider';
export const PROVIDER_CATALOG_TTL_MS=15*60*1000;
export type ProviderCatalogSnapshot={tenantId:string;storeId:string;productId:string;state:'active'|'unknown'|'deleted';title:string;price:number|null;sellable:number|null;unit:'piece';observedAt:string};
export function parseCatalogSnapshot(value:unknown):ProviderCatalogSnapshot{
 const s=value as ProviderCatalogSnapshot,keys=['tenantId','storeId','productId','state','title','price','sellable','unit','observedAt'];
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==keys.length||!keys.every(k=>Object.hasOwn(s,k))||![s.tenantId,s.storeId].every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x))||!GROWTH_PROVIDER_PRODUCT_ID.test(s.productId)||!['active','unknown','deleted'].includes(s.state)||typeof s.title!=='string'||s.title.length>500||s.unit!=='piece'||![s.price,s.sellable].every(x=>x===null||Number.isSafeInteger(x)&&x>=0)||s.state==='active'&&(s.price===null||s.sellable===null)||typeof s.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(s.observedAt)||!Number.isFinite(Date.parse(s.observedAt)))throw Error('invalid_catalog_snapshot');
 return s;
}
export function catalogCeiling(localAvailable:number,snapshot:ProviderCatalogSnapshot,reserved:number,now=Date.now()){
 const s=parseCatalogSnapshot(snapshot),age=now-Date.parse(s.observedAt);
 if(s.state!=='active'||s.sellable===null||age<0||age>PROVIDER_CATALOG_TTL_MS||!Number.isSafeInteger(localAvailable)||localAvailable<0||!Number.isSafeInteger(reserved)||reserved<0)throw Error('provider_catalog_held');
 // No proof ties provider decrements to local reservations, so subtract all outstanding obligations.
 return Math.max(0,Math.min(localAvailable,s.sellable-reserved));
}
