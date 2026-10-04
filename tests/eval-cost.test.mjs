import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime();const m=await load('lib/eval-cost.ts');let passed=0;
const check=(v,n)=>{assert.ok(v,n);passed++};
check(m.costCanonical({z:'한글',a:{b:2,a:1}})==='{"a":{"a":1,"b":2},"z":"한글"}','stable UTF8 canonical keys');
const contract={schema:'collective.eval-cost.v1',id:'fixed',provider:'synthetic',model:'m',priceVersion:'v1',validUntil:new Date(Date.now()+60000).toISOString(),billing:{mode:'fixed_krw',enforcement:'provider_fixed_krw',taxAndFeesIncluded:true},limits:{maxInputTokens:100,maxOutputTokens:20,maxRequests:1,tools:false,fallback:false,retries:false},durableIdempotency:true,receiptLookup:true};
const signed={...contract,digest:await m.costDigest(contract)};const secret='synthetic-trust-key-00000000000000';
signed.signature=createHmac('sha256',secret).update('collective.eval-cost.v1\nGET\n/v1/eval-contract\nowner\n'+m.costCanonical(signed)).digest('hex');
await m.verifyCostSignature(signed,secret,'GET','/v1/eval-contract','owner');passed++;
check((await m.validateCostContract(signed)).billing.enforcement==='provider_fixed_krw','fixed contract validated');
await assert.rejects(m.verifyCostSignature({...signed,model:'other'},secret,'GET','/v1/eval-contract','owner'));passed++;
await assert.rejects(m.verifyCostSignature(signed,secret,'GET','/v1/eval-contract','other'));passed++;
for(const billing of [{...contract.billing,enforcement:'local_estimate'},{...contract.billing,taxAndFeesIncluded:false},{...contract.billing,mode:'usd_conservative_conversion'}]){await assert.rejects(m.validateCostContract({...signed,billing}));passed++;}
for(const endpoint of ['http://eval.example.com','https://127.0.0.1','https://localhost','https://eval.example.com/path','https://a:b@eval.example.com']){assert.throws(()=>m.costEndpoint(endpoint));passed++;}
check(m.costEndpoint('https://eval.example.com')==='https://eval.example.com','exact HTTPS origin');
const quote={quoteId:'q',requestDigest:'d',contractDigest:'c',model:'m',maxInputTokens:10,maxOutputTokens:20,maxChargeKrw:100};
const rejected={schema:'collective.eval-receipt.v1',requestId:'r',requestDigest:'d',quoteId:'q',contractDigest:'c',model:'m',status:'rejected',settlement:'final',chargeKrw:0,usage:null};
for(const usage of [{inputTokens:-1000000,outputTokens:0},{inputTokens:'1',outputTokens:0},{inputTokens:NaN,outputTokens:0},{inputTokens:1,outputTokens:0}]){assert.throws(()=>m.validateCostReceipt({...rejected,usage},quote,'r'));passed++;}
check(m.validateCostReceipt(rejected,quote,'r').usage===null,'rejected receipt has no billable usage');
assert.throws(()=>m.validateCostReceipt({...rejected,status:'running',settlement:'reserved',chargeKrw:null,usage:{inputTokens:11,outputTokens:0}},quote,'r'));passed++;
console.log(JSON.stringify({passed,external:'not_called'}));
