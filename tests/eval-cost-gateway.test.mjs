import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(),m=await load('lib/eval-cost.ts');
// Generate with the actual Python gateway serializer/signer, not a JS copy.
const fixture=JSON.parse(execFileSync('python3',['-c',`
import sys,json
sys.path.insert(0,'scripts')
from eval_gateway.core import Gateway,digest
owner='fixture-owner';key='synthetic-signing-key-0000000000000000';g=Gateway.__new__(Gateway);g.owner=owner;g.key=key
request={'instructions':'판정 기준\\n정확판','input':'한글 사례 🎯'}
c={'schema':'collective.eval-cost.v1','id':'fixed-fixture','provider':'synthetic','model':'model','priceVersion':'v1','validUntil':'2099-01-01T00:00:00Z','billing':{'mode':'fixed_krw','enforcement':'provider_fixed_krw','taxAndFeesIncluded':True},'limits':{'maxInputTokens':1000,'maxOutputTokens':100,'maxRequests':1,'tools':False,'fallback':False,'retries':False},'durableIdempotency':True,'receiptLookup':True}
c={**c,'digest':digest(c)}
q={'schema':'collective.eval-quote.v1','quoteId':'q','requestDigest':digest(request),'contractDigest':c['digest'],'model':'model','maxInputTokens':1000,'maxOutputTokens':100,'maxChargeKrw':10,'expiresAt':'2099-01-01T00:00:00Z'}
r={'schema':'collective.eval-receipt.v1','requestId':'r','requestDigest':q['requestDigest'],'quoteId':'q','contractDigest':c['digest'],'model':'model','status':'completed','settlement':'final','chargeKrw':5,'usage':{'inputTokens':12,'outputTokens':13},'output':'합성 결과'}
print(json.dumps({'owner':owner,'key':key,'request':request,'contract':g.signed('GET','/v1/eval-contract',c),'quote':g.signed('POST','/v1/eval-quotes',q),'receipt':g.signed('GET','/v1/eval-submissions/r',r)}))
`],{encoding:'utf8'}));
for(const [key,method,path] of [['contract','GET','/v1/eval-contract'],['quote','POST','/v1/eval-quotes'],['receipt','GET','/v1/eval-submissions/r']])await m.verifyCostSignature(fixture[key],fixture.key,method,path,fixture.owner);
const contract=await m.validateCostContract(fixture.contract),quote=await m.validateCostQuote(fixture.quote,contract,fixture.request,100);
assert.equal(m.validateCostReceipt(fixture.receipt,quote,'r').chargeKrw,5);
console.log(JSON.stringify({passed:6,python:'real_gateway_signer',transport:'not_called'}));
