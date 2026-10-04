import {ApiError} from './server';
export type CostRequest={instructions:string;input:string};
export type EvalCostContract={schema:'collective.eval-cost.v1';id:string;digest:string;provider:string;model:string;priceVersion:string;validUntil:string;billing:{mode:'fixed_krw'|'usd_conservative_conversion';enforcement:'provider_fixed_krw'|'local_estimate';taxAndFeesIncluded:boolean};limits:{maxInputTokens:number;maxOutputTokens:number;maxRequests:1;tools:false;fallback:false;retries:false};durableIdempotency:true;receiptLookup:true;signature:string};
export type EvalCostQuote={schema:'collective.eval-quote.v1';quoteId:string;contractDigest:string;requestDigest:string;model:string;maxInputTokens:number;maxOutputTokens:number;maxChargeKrw:number;expiresAt:string;signature:string};
export type EvalCostReceipt={schema:'collective.eval-receipt.v1';requestId:string;requestDigest:string;quoteId:string;contractDigest:string;providerRunId?:string;model:string;status:'accepted'|'running'|'completed'|'rejected'|'unknown';settlement:'reserved'|'final';chargeKrw:number|null;usage:{inputTokens:number;outputTokens:number}|null;output?:string;signature:string};
export function costCanonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(costCanonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+costCanonical((value as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(value);}
const hex=(v:ArrayBuffer)=>Array.from(new Uint8Array(v),b=>b.toString(16).padStart(2,'0')).join('');
export const costDigest=async(v:unknown)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(costCanonical(v))));
export function costAssert(v:unknown,message='원화 상한 계약·견적·영수증을 확인하세요.'):asserts v{if(!v)throw new ApiError(409,message);}
export const costInteger=(v:unknown,max=1000000000)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
export function costEndpoint(value:unknown){costAssert(typeof value==='string');const u=new URL(value);costAssert(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&!u.port&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(u.hostname)&&!u.hostname.endsWith('.local')&&!u.hostname.endsWith('.internal'));return u.origin;}
export async function verifyCostSignature(value:unknown,key:string,method:string,path:string,owner:string){
 costAssert(value&&typeof value==='object'&&!Array.isArray(value));const {signature,...body}=value as Record<string,unknown>;costAssert(typeof signature==='string'&&/^[a-f0-9]{64}$/.test(signature)&&key.length>=32);
 const h=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16));costAssert(await crypto.subtle.verify('HMAC',h,bytes,new TextEncoder().encode(`collective.eval-cost.v1\n${method}\n${path}\n${owner}\n${costCanonical(body)}`)));
}
export async function validateCostContract(value:unknown){
 const c=value as EvalCostContract;costAssert(JSON.stringify(value).length<=10000);costAssert(c?.schema==='collective.eval-cost.v1'&&typeof c.id==='string'&&c.id.length<=100&&typeof c.provider==='string'&&typeof c.model==='string'&&c.model.length<=200&&typeof c.priceVersion==='string'&&Date.parse(c.validUntil)>Date.now());
 costAssert(c.billing?.mode==='fixed_krw'&&c.billing.enforcement==='provider_fixed_krw'&&c.billing.taxAndFeesIncluded===true&&c.limits?.maxRequests===1&&c.limits.tools===false&&c.limits.fallback===false&&c.limits.retries===false&&c.durableIdempotency===true&&c.receiptLookup===true);
 costAssert(costInteger(c.limits.maxInputTokens,1000000)&&c.limits.maxInputTokens>0&&costInteger(c.limits.maxOutputTokens,1000000)&&c.limits.maxOutputTokens>0);
 const {digest,signature,...body}=c;void signature;costAssert(digest===await costDigest(body));return c;
}
export async function validateCostQuote(q:EvalCostQuote,c:EvalCostContract,request:CostRequest,maxOutputTokens:number){
 costAssert(JSON.stringify(q).length<=10000);costAssert(q?.schema==='collective.eval-quote.v1'&&typeof q.quoteId==='string'&&q.quoteId.length<=160&&q.contractDigest===c.digest&&q.requestDigest===await costDigest(request)&&q.model===c.model&&q.maxOutputTokens===maxOutputTokens&&q.maxOutputTokens<=c.limits.maxOutputTokens&&costInteger(q.maxInputTokens,c.limits.maxInputTokens)&&costInteger(q.maxChargeKrw)&&Date.parse(q.expiresAt)>Date.now()&&Date.parse(q.expiresAt)<=Date.parse(c.validUntil));return q;
}
export function validateCostReceipt(r:EvalCostReceipt,q:EvalCostQuote,id:string){
 costAssert(r?.schema==='collective.eval-receipt.v1'&&r.requestId===id&&r.requestDigest===q.requestDigest&&r.quoteId===q.quoteId&&r.contractDigest===q.contractDigest&&r.model===q.model&&['accepted','running','completed','rejected','unknown'].includes(r.status)&&['reserved','final'].includes(r.settlement));
 if(r.usage!==null)costAssert(r.usage&&costInteger(r.usage.inputTokens,q.maxInputTokens)&&costInteger(r.usage.outputTokens,q.maxOutputTokens));
 if(r.status==='rejected')costAssert(r.usage===null||(r.usage.inputTokens===0&&r.usage.outputTokens===0));
 if(r.settlement==='final'){costAssert(['completed','rejected'].includes(r.status)&&costInteger(r.chargeKrw,q.maxChargeKrw));if(r.status==='completed')costAssert(typeof r.output==='string'&&r.output.length<=300000&&r.usage&&costInteger(r.usage.inputTokens,q.maxInputTokens)&&costInteger(r.usage.outputTokens,q.maxOutputTokens));else costAssert(r.chargeKrw===0);}
 else costAssert(r.chargeKrw===null);return r;
}
