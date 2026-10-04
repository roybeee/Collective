/** Server-side MAPDAL landing bridge. No automatic retries of external writes. */
export type GrowthProviderFields = {description:string};
export const GROWTH_PROVIDER_ORIGINS=['https://mapdal.kr','https://www.mapdal.kr'] as const;
export type GrowthProviderProduct = {productId:string;version:number;fields:GrowthProviderFields;digest:string};
export type GrowthProviderReceipt = {
 requestId:string;productId:string;beforeDigest:string;afterDigest:string;
 approvalDigest:string;operation:'apply'|'rollback';at:string;status:'applied';originalRequestId?:string;
};
export type GrowthProviderApply = {requestId:string;productId:string;expectedDigest:string;approvalDigest:string;fields:GrowthProviderFields};
export type GrowthProviderRollback = {requestId:string;originalRequestId:string;expectedDigest:string;approvalDigest:string};
export type GrowthProviderConfig = {baseUrl:string;tenantId:string;storeId:string;secret:string};
export type GrowthProviderClient = ReturnType<typeof createGrowthProviderClient>;
type JsonObject = Record<string,unknown>;
const PREFIX='/collective/v1/landing/',MAX_BYTES=32768,TIMEOUT_MS=10000;
const ID=/^[A-Za-z0-9_-]{1,100}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,HEX=/^[0-9a-f]{64}$/;
export const GROWTH_PROVIDER_PRODUCT_ID=/^[A-Za-z0-9_:-]{1,100}$/;
export function growthProviderProductUrlMatches(landingUrl:string,baseUrl:string,productId:string){
 if(!GROWTH_PROVIDER_PRODUCT_ID.test(productId))return false;
 try{const actual=new URL(landingUrl),base=new URL(baseUrl);return actual.origin===base.origin&&!actual.username&&!actual.password&&!actual.search&&!actual.hash&&decodeURIComponent(actual.pathname)==='/p/'+productId;}catch{return false;}
}
const REJECTIONS=new Set(['invalid_request','invalid_signature','scope_denied','nonce_replayed','idempotency_conflict','product_not_found','receipt_not_found','not_apply_receipt','rollback_digest_mismatch','stale_product','request_too_large','content_type','query_not_allowed','invalid_method','unknown_path']);
export class GrowthProviderError extends Error {
 constructor(public readonly outcome:'unknown'|'rejected'|'unavailable',public readonly code:string){
  super(outcome==='unknown'?'판매처 처리 결과를 조회해 확인해야 합니다.':outcome==='rejected'?'판매처가 요청을 거절했습니다.':'판매처 응답을 확인할 수 없습니다.');this.name='GrowthProviderError';
 }
}
function object(value:unknown):value is JsonObject{return !!value&&typeof value==='object'&&!Array.isArray(value)}
function exact(value:unknown,keys:string[]):value is JsonObject{return object(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k))}
function matches(value:unknown,re:RegExp):value is string{return typeof value==='string'&&re.test(value)}
function validFields(value:unknown):value is GrowthProviderFields{
 return exact(value,['description'])&&typeof value.description==='string'&&value.description.length>0&&value.description.length<=8000&&!/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.description)&&Array.from(value.description).every(c=>{const n=c.codePointAt(0)!;return n<0xd800||n>0xdfff});
}
function inputCheck(valid:unknown):asserts valid {if(!valid)throw new GrowthProviderError('rejected','invalid_request')}
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),v=>v.toString(16).padStart(2,'0')).join('');
/** Canonical contract intentionally has one text field and integer revision. */
export async function growthProviderProductDigest(product:Pick<GrowthProviderProduct,'fields'|'version'>){
 inputCheck(validFields(product.fields)&&Number.isSafeInteger(product.version)&&product.version>0);
 return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({fields:{description:product.fields.description},version:product.version}))));
}
function endpoint(baseUrl:string){
 let url:URL;try{url=new URL(baseUrl)}catch{throw new GrowthProviderError('rejected','invalid_endpoint')}
 // Trusted provider allowlist is code-owned. User-controlled domains are never fetched.
 inputCheck(GROWTH_PROVIDER_ORIGINS.some(origin=>origin===url.origin)&&!url.port&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash);
 return url.origin;
}
async function responseJson(res:Response){
 if(!res.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new Error('content_type');
 const reader=res.body?.getReader();if(!reader)throw new Error('empty_response');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('response_limit')}chunks.push(value)}
 const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined)) as unknown;
}
function parseReceipt(value:unknown,requestId:string):GrowthProviderReceipt{
 const keys=['requestId','productId','beforeDigest','afterDigest','approvalDigest','operation','at','status'];
 if(object(value)&&value.operation==='rollback')keys.push('originalRequestId');
 if(!exact(value,keys)||value.requestId!==requestId||!matches(value.productId,GROWTH_PROVIDER_PRODUCT_ID)||!matches(value.beforeDigest,HEX)||!matches(value.afterDigest,HEX)||!matches(value.approvalDigest,HEX)||!['apply','rollback'].includes(String(value.operation))||value.status!=='applied'||typeof value.at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value.at)||!Number.isFinite(Date.parse(value.at))||(value.operation==='rollback'&&!matches(value.originalRequestId,UUID)))throw new Error('invalid_receipt');
 return value as GrowthProviderReceipt;
}
function parseMutationReceipt(value:unknown,input:GrowthProviderApply|GrowthProviderRollback,action:'apply'|'rollback'){
 const receipt=parseReceipt(value,input.requestId);
 if(receipt.operation!==action||receipt.beforeDigest!==input.expectedDigest||receipt.approvalDigest!==input.approvalDigest||('productId'in input&&receipt.productId!==input.productId)||('originalRequestId'in input&&receipt.originalRequestId!==input.originalRequestId))throw new Error('mismatched_receipt');
 return receipt;
}
export function createGrowthProviderClient(configuration:GrowthProviderConfig){
 const config={...configuration},base=endpoint(config.baseUrl);
 inputCheck(matches(config.tenantId,ID)&&matches(config.storeId,ID)&&typeof config.secret==='string'&&new TextEncoder().encode(config.secret).byteLength>=32);
 async function request<T>(action:'read'|'receipt'|'apply'|'rollback',input:JsonObject,parse:(value:unknown)=>T|Promise<T>):Promise<T>{
  const path=PREFIX+action,body=JSON.stringify({tenantId:config.tenantId,storeId:config.storeId,...input});
  inputCheck(new TextEncoder().encode(body).byteLength<=MAX_BYTES);
  const mutation=action==='apply'||action==='rollback',outcome=mutation?'unknown':'unavailable';
  try{
   const timestamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID();
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const signature=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode([timestamp,nonce,'POST',path,body].join('\n'))));
   const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',accept:'application/json','x-collective-timestamp':timestamp,'x-collective-nonce':nonce,'x-collective-signature':signature},body,redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS)});
   const value=await responseJson(res);
   if(!res.ok){
    if([400,401,403,404,405,409,413,415].includes(res.status)&&exact(value,['status','code'])&&value.status==='rejected'&&typeof value.code==='string'&&REJECTIONS.has(value.code))throw new GrowthProviderError('rejected',value.code);
    throw new GrowthProviderError(outcome,'provider_response');
   }
   return await parse(value);
  }catch(error){if(error instanceof GrowthProviderError)throw error;throw new GrowthProviderError(outcome,'provider_response')}
 }
 return {
  async read(productId:string):Promise<GrowthProviderProduct>{
   inputCheck(matches(productId,GROWTH_PROVIDER_PRODUCT_ID));
   return request('read',{productId},async value=>{
    if(!exact(value,['productId','version','fields','digest'])||value.productId!==productId||!Number.isSafeInteger(value.version)||(value.version as number)<1||!validFields(value.fields)||!matches(value.digest,HEX))throw new Error('invalid_product');
    const product=value as GrowthProviderProduct;
    if(await growthProviderProductDigest(product)!==product.digest)throw new Error('invalid_digest');return product;
   });
  },
  async apply(input:GrowthProviderApply):Promise<GrowthProviderReceipt>{
   inputCheck(exact(input,['requestId','productId','expectedDigest','approvalDigest','fields'])&&matches(input.requestId,UUID)&&matches(input.productId,GROWTH_PROVIDER_PRODUCT_ID)&&matches(input.expectedDigest,HEX)&&matches(input.approvalDigest,HEX)&&validFields(input.fields));
   return request('apply',input,value=>parseMutationReceipt(value,input,'apply'));
  },
  async receipt(requestId:string):Promise<GrowthProviderReceipt|null>{
   inputCheck(matches(requestId,UUID));return request('receipt',{requestId},value=>value===null?null:parseReceipt(value,requestId));
  },
  async rollback(input:GrowthProviderRollback):Promise<GrowthProviderReceipt>{
   inputCheck(exact(input,['requestId','originalRequestId','expectedDigest','approvalDigest'])&&matches(input.requestId,UUID)&&matches(input.originalRequestId,UUID)&&matches(input.expectedDigest,HEX)&&matches(input.approvalDigest,HEX));
   return request('rollback',input,value=>parseMutationReceipt(value,input,'rollback'));
  },
 };
}
