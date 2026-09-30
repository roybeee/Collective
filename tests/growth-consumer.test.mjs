import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('No dispatch')});
const d=await load('lib/growth-consumer.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const now=Date.parse('2026-09-30T00:00:00Z');
const grant={purpose:'identity_link',state:'granted',noticeVersion:'notice-v1',evidenceRef:'consent-record',observedAt:'2026-09-01T00:00:00Z',expiresAt:'2026-12-01T00:00:00Z'};
check(d.parseConsent(grant,now).state==='granted','valid grant');
for(const patch of [{purpose:'meta'},{evidenceRef:''},{noticeVersion:'person@example.com'},{noticeVersion:'api_key=synthetic-secret'},{evidenceRef:'ｐｅｒｓｏｎ＠ｅｘａｍｐｌｅ．ｃｏｍ'},{observedAt:'2099-01-01T00:00:00Z'},{expiresAt:'2026-08-01T00:00:00Z'},{observedAt:'invalid'},{observedAt:'2026-02-30T00:00:00Z'}]){assert.throws(()=>d.parseConsent({...grant,...patch},now));passed++}
check(d.parseConsent({purpose:'identity_link',state:'revoked'},now).evidenceRef==='','withdrawal requires no old evidence');
check(d.consentActive(grant,now),'active identity');check(!d.consentActive({...grant,expiresAt:'2026-09-29T00:00:00Z'},now),'expired');check(!d.consentActive({...grant,state:'revoked'},now),'revoked');
const order={id:'order',version:1,orderDate:'2026-08-01',status:'paid',paidAmount:100,refundAmount:0};
const consents={identity_link:grant,post_purchase:{...grant,purpose:'post_purchase'},marketing_reorder:{...grant,purpose:'marketing_reorder'}};
const assess=(c=consents,rows=[{order,orderVersion:1}],wait=30)=>d.consumerAssessment(c,rows,wait,now);
check(assess().reorderEligible,'eligible old purchase');check(assess().postPurchaseEligible,'postpurchase eligible');check(!assess().maySend,'never send');
check(!assess({...consents,marketing_reorder:null}).reorderEligible,'purpose separated');check(assess({...consents,marketing_reorder:null}).postPurchaseEligible,'post purchase independent');
for(const patch of [{status:'cancelled'},{status:'refunded'},{refundAmount:1},{paidAmount:0},{orderDate:'2099-01-01'},{version:2}]){check(!assess(consents,[{order:{...order,...patch},orderVersion:1}]).reorderEligible,'unsafe purchase '+JSON.stringify(patch))}
check(!assess(consents,[{order:{...order,orderDate:'2026-09-29'},orderVersion:1}]).reorderEligible,'recent purchase wait');
check(assess(consents,[{order:{...order,orderDate:'2026-09-29'},orderVersion:1}],0).reorderEligible,'zero wait allowed');
check(!assess(consents,[{order,orderVersion:1},{order:{...order,version:2},orderVersion:1}]).reorderEligible,'stale link cannot conceal later purchase');
check(assess({...consents,identity_link:null}).latestPurchaseAt===null,'withdrawn identity never derives purchase timeline');
for(const v of [-1,366,1.5,NaN]){assert.throws(()=>d.parseWaitDays(v));passed++}
console.log(JSON.stringify({passed,external:'not_called'}));
