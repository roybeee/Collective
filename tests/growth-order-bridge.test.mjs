import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('No external requests')});
const {parseOrderLineInput,validateOrderAllocations}=await load('lib/growth-order-bridge.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const order={id:'o',version:2,paidAmount:10000,refundAmount:2000,status:'paid'};
const base={orderId:'o',orderVersion:2,sourceKey:'shop',accountId:'seller',externalLineId:'line-1',inventoryId:'sku-1',units:2,missionId:'m',missionVersion:1,offerId:'offer',offerVersion:1,paidAllocation:6000,refundAllocation:1000,currency:'KRW',taxBasis:'included',evidenceRef:'seller-line-1',source:'operator_attested'};
const parsed=parseOrderLineInput(base);check(parsed.units===2,'explicit physical units');
let r=validateOrderAllocations(order,[parsed]);check(r.status==='current'&&r.netAllocated===5000&&r.unallocatedPaid===4000,'partial allocation does not clone full order');
r=validateOrderAllocations(order,[parsed,{...parsed,externalLineId:'line-2',paidAllocation:4000,refundAllocation:1000}]);check(r.netAllocated===8000&&r.unallocatedPaid===0,'multi-line amounts reconcile');
check(validateOrderAllocations(order,[parsed,{...parsed,externalLineId:'line-2',paidAllocation:5000}]).status==='invalid','paid over-allocation rejected');
check(validateOrderAllocations(order,[{...parsed,refundAllocation:3000}]).status==='invalid','refund over-allocation rejected');
check(validateOrderAllocations(order,[parsed,parsed]).status==='invalid','duplicate source line rejected');
check(validateOrderAllocations({...order,version:3},[parsed]).status==='reconciliation_required','new order revision stale');
check(validateOrderAllocations(order,[{...parsed,paidAllocation:null,refundAllocation:null}]).netAllocated===null,'unknown not zero');
check(validateOrderAllocations(order,[]).status==='unallocated','no line does not invent attribution');
check(validateOrderAllocations(order,[{...parsed,orderId:'foreign'}]).status==='invalid','foreign order refused');
for(const patch of [{units:0},{units:1.5},{orderVersion:0},{paidAllocation:-1},{refundAllocation:7000},{evidenceRef:'person@example.com'},{source:'signed_webhook'},{externalLineId:'010-1234-5678'},{currency:'USD'}]){
 assert.throws(()=>parseOrderLineInput({...base,...patch}));passed++;
}
console.log(JSON.stringify({passed}));
