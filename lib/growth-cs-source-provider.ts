import {deliverySignature} from './growth-consumer-delivery-signature';
import {readBoundedJson} from './http-limits';
import {parseCsSource} from './growth-cs-source';
export async function readCsInbox(tenantId:string,storeId:string,secret:string,cursor:string|null){
 const path='/collective/v1/cs/inbox',timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID(),body=JSON.stringify({tenantId,storeId,cursor,limit:50});
 const response=await fetch(`https://mapdal.kr${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-collective-timestamp':timestamp,'x-collective-nonce':nonce,'x-collective-signature':await deliverySignature(secret,`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`)},body});
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('provider_unavailable');const r=await readBoundedJson<{items:unknown[];nextCursor:string|null;intakeHeld?:boolean}>(response,32768);
 if(!r||Object.keys(r).some(k=>!['items','nextCursor','intakeHeld'].includes(k))||(r.intakeHeld!==undefined&&typeof r.intakeHeld!=='boolean')||!Array.isArray(r.items)||r.items.length>50||!(r.nextCursor===null||(typeof r.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(r.nextCursor))))throw new Error('invalid_source');const items=r.items.map(parseCsSource);if(new Set(items.map(x=>x.id)).size!==items.length)throw new Error('duplicate_source');return {items,nextCursor:r.nextCursor,intakeHeld:r.intakeHeld??false};
}
