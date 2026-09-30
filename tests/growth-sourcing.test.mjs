import assert from 'node:assert/strict';import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('No purchase')});const d=await load('lib/growth-sourcing.ts');let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const input={...d.emptyCandidateInput(),catalogId:'p',catalogVersion:1,supplierCode:'SUP-A',unit:'piece',unitCost:100,moq:12,leadDays:0,shippingCost:0,extraCost:20,taxBasis:'included',validUntil:'2026-09-30',evidenceRef:'quote-v1',note:'공급 후보 확인'};
const quote={id:'q',version:1,campaignVersion:1,input},catalog={id:'p',version:1,campaignVersion:1,input:{sku:'SKU',taxBasis:'included',validUntil:'2099-01-01'}};
const selection={...d.emptyComparisonInput(),catalogId:'p',catalogVersion:1,requestedQuantity:13,unit:'piece',candidates:[{id:'q',version:1}]},stock={status:'known',onHand:5,reserved:10,available:0,shortage:5,unit:'piece'};
const assess=(patch={},inventory=stock,now=Date.parse('2026-09-30T14:59:00Z'))=>d.assessSourcing(selection,catalog,[{...quote,input:{...input,...patch}}],inventory,1,now).rows[0];
check(d.parseCandidateInput(input).shippingCost===0,'zero costs preserved');check(d.parseCandidateInput({...input,shippingCost:null}).shippingCost===null,'null preserved');
for(const patch of [{unitCost:-1},{moq:0},{leadDays:1.5},{shippingCost:Number.MAX_SAFE_INTEGER+1},{supplierCode:'person@example.com'},{note:'api_key=synthetic-secret'},{validUntil:'2026-02-30'},{currency:'USD'},{catalogVersion:0}]){assert.throws(()=>d.parseCandidateInput({...input,...patch}));passed++}
check(assess().quantity===13,'MOQ is minimum not order multiple');check(assess().totalCost===1320,'fixed extras once');check(assess().leadDays===0,'same day not unknown');check(assess().status==='comparable','complete current candidate');
check(assess().projectedAvailable===8,'existing shortage offsets incoming assumption');check(assess().projectedShortage===0,'incoming clears shortage');
for(const patch of [{moq:null},{unitCost:null},{shippingCost:null},{extraCost:null},{leadDays:null},{taxBasis:'excluded'},{unit:'pack'},{unit:'unknown'},{catalogVersion:2},{evidenceRef:''}])check(assess(patch).status==='held','missing/mismatch held '+JSON.stringify(patch));
check(assess({},stock,Date.parse('2026-09-30T15:00:00Z')).status==='held','KST midnight expiry');check(assess({unitCost:Number.MAX_SAFE_INTEGER}).status==='held','overflow held');
check(assess({},{...stock,status:'unknown',onHand:null,available:null,reserved:null}).projectedAvailable===null,'unknown stock not zero');
check(assess({unit:'pack'}).quantity===null&&assess({unit:'pack'}).totalCost===null,'piece requested cannot use pack MOQ or unit cost');
check(d.assessSourcing(selection,{...catalog,input:{...catalog.input,validUntil:'2026-09-30T00:00:00Z'}},[quote],stock,1,Date.parse('2026-09-30T01:00:00Z')).rows[0].status==='held','catalog exact ISO expiry');
assert.throws(()=>d.parseComparisonInput({...selection,candidates:[{id:'q',version:1},{id:'q',version:1}]}));passed++;
assert.throws(()=>d.parseComparisonInput({...selection,requestedQuantity:0}));passed++;
console.log(JSON.stringify({passed,external:'not_called'}));
