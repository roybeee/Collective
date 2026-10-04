import {deliverySignature,verifyDeliverySignature} from './growth-consumer-delivery-signature';
import {readBoundedJson} from './http-limits';
import {GROWTH_PROVIDER_ORIGINS,GROWTH_PROVIDER_PRODUCT_ID,type GrowthProviderConfig} from './growth-provider';
import {parseCatalogSnapshot} from './growth-provider-catalog';
export const PROVIDER_CATALOG_PATH='/collective/v1/catalog/read';
export async function readProviderCatalog(config:GrowthProviderConfig,productId:string){
 if(!GROWTH_PROVIDER_ORIGINS.some(x=>x===config.baseUrl)||!GROWTH_PROVIDER_PRODUCT_ID.test(productId))throw Error('invalid_provider_scope');
 const path=PROVIDER_CATALOG_PATH,timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID(),body=JSON.stringify({tenantId:config.tenantId,storeId:config.storeId,productId});
 const response=await fetch(config.baseUrl+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-collective-timestamp':timestamp,'x-collective-nonce':nonce,'x-collective-signature':await deliverySignature(config.secret,`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`)},body});
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('provider_unavailable');
 const value=await readBoundedJson<{snapshot:unknown;snapshotJson:string;signature:string}>(response,32768);
 if(!value||Object.keys(value).sort().join(',')!=='signature,snapshot,snapshotJson'||typeof value.snapshotJson!=='string'||!await verifyDeliverySignature(config.secret,`${timestamp}\n${nonce}\n200\n${path}\n${value.snapshotJson}`,value.signature)||JSON.stringify(JSON.parse(value.snapshotJson))!==JSON.stringify(value.snapshot))throw Error('invalid_provider_signature');
 const s=parseCatalogSnapshot(value.snapshot);
 if(s.tenantId!==config.tenantId||s.storeId!==config.storeId||s.productId!==productId||Math.abs(Date.now()-Date.parse(s.observedAt))>300000)throw Error('invalid_provider_snapshot_scope');
 return s;
}
