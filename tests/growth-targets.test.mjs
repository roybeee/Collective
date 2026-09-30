import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('No external calls')});
const d=await load('lib/growth-targets.ts');let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const now=Date.parse('2026-09-30T03:00:00Z'),input={...d.emptyTargetInput(),title:'첫 판매 관측',status:'confirmed',metric:'netRevenue',unit:'KRW',baseline:0,targetValue:100,from:'2026-08-01',to:'2026-08-30',executionStartedAt:'2026-08-01',denominator:'캠페인 귀속 주문',assignee:'운영 담당',autonomyScope:'로컬 기록',profitCondition:'변동비 확인',lossLimit:0,requiredImprovement:'반품 원인 개선',stopRule:'손실 상한 도달',stopAt:'2026-09-30',changeReason:'첫 기준 수립',confirmBy:'2026-08-01'};
const business={status:'ledger_only',netRevenue:150,orders:2,paidOrders:2,contributionBeforeMarketing:50};
check(d.parseTargetInput(input).baseline===0,'zero baseline preserved');check(d.parseTargetInput({...input,baseline:null}).baseline===null,'unknown baseline preserved');
for(const patch of [{metric:'cash'},{unit:'orders'},{targetValue:-1},{baseline:NaN},{from:'2026-02-30'},{to:'2026-07-01'},{title:'person@example.com'},{changeReason:'api_key=synthetic-secret'},{lossLimit:-1},{status:'invalid'}]){assert.throws(()=>d.parseTargetInput({...input,...patch}));passed++}
check(d.targetAssessment(input).missing.length===0,'complete contract');check(d.targetAssessment({...input,baseline:null}).missing.length>0,'unknown baseline held');
const review=(patch={},ledger=business)=>d.targetReviewAssessment({...input,...patch},ledger,now);
check(review().status==='observed_met','mature threshold observed');check(review().observedValue===150,'observed value');check(review().absoluteChange===150,'zero uses absolute difference');check(!review().mayExecute&&!review().mayScale,'no authority');
check(review({status:'provisional'}).status==='held','provisional held');check(review({from:'2026-09-20',to:'2026-10-19',executionStartedAt:'2026-09-20'}).status==='interim','immature interim');
check(review({metric:'contributionProfit'}, {...business,contributionBeforeMarketing:null}).status==='held','unknown costs hold profit');check(review({}, {...business,netRevenue:0}).status==='observed_below','zero not missing');check(review({}, {...business,status:'unavailable',netRevenue:null}).status==='held','unavailable held');
check(review({from:'2026-08-01',to:'2026-08-07'}).status==='interim','short window not 30day review');
check(review({executionStartedAt:'2026-09-01'}).status==='held','observation cannot predate execution');
check(d.targetReviewAssessment({...input,from:'2026-09-01',to:'2026-09-30',executionStartedAt:'2026-09-01'},business,now).status==='interim','end day still in progress KST');
check(review({metric:'paidOrders',unit:'orders',targetValue:2}).observedValue===2,'paid count metric');
check(d.parseReviewInput({}).decisionVersion===0,'review blank decision');assert.throws(()=>d.parseReviewInput({nextAction:'ｐｅｒｓｏｎ＠ｅｘａｍｐｌｅ．ｃｏｍ'}));passed++;
console.log(JSON.stringify({passed,external:'not_called'}));
