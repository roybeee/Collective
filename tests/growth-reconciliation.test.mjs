import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('No dispatch')});const d=await load('lib/growth-reconciliation.ts'),a=await load('lib/growth-authority.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const input={mode:'partial',actualAmount:null,actualLoss:null,evidenceRef:'proof',note:'운영자 누적 비용 확인',noExecution:false,noOutstandingObligations:false};
const authority={...a.emptyAuthorityInput(),id:'new',brandId:'b',campaignId:'c',accountId:'account',channel:'manual',status:'active',maxTier:'T3',allowedActions:['spend'],ownerApprovalId:'approval',ownerSignedAt:'2026-09-01T00:00:00Z',startsAt:'2026-09-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z',periodStart:'2026-09-01T00:00:00Z',periodEnd:'2027-01-01T00:00:00Z',totalCap:100,dayCap:100,weekCap:100,lossCap:10};
const action={id:'m',operationKey:'m-v1',brandId:'b',campaignId:'c',accountId:'account',channel:'manual',operation:'spend',amount:60,loss:4,budget:'exploration',previousBudget:null,nextBudget:null,evidence:null};
const commitment={authorityId:'old',action,status:'reserved',at:'2026-08-01T00:00:00Z',reservedAmount:60,reservedLoss:4,actualAmount:null,actualLoss:null};
check(d.parseReconciliationInput(input).actualAmount===null,'unknown preserved');check(d.parseReconciliationInput({...input,actualAmount:0}).actualAmount===0,'zero preserved');
for(const patch of [{mode:'invalid'},{actualAmount:-1},{actualLoss:NaN},{actualAmount:Number.MAX_SAFE_INTEGER+1},{evidenceRef:'person@example.com'},{note:'api_key=synthetic-secret'},{noExecution:'yes'}]){assert.throws(()=>d.parseReconciliationInput({...input,...patch}));passed++}
let result=d.reconcileCommitment(commitment,input,'unknown');check(result.status==='unknown'&&result.reservedAmount===60,'unknown retains reservation');
result=d.reconcileCommitment(commitment,{...input,actualAmount:70,actualLoss:8},'observed');check(result.status==='unknown'&&result.actualAmount===70,'partial observed cost can exceed reservation');
assert.throws(()=>d.reconcileCommitment(result,{...input,actualAmount:60,actualLoss:8},'observed'));passed++;
assert.throws(()=>d.reconcileCommitment(result,input,'observed'));passed++;
assert.throws(()=>d.reconcileCommitment(commitment,{...input,mode:'final',actualAmount:0,actualLoss:0},'unknown'));passed++;
assert.throws(()=>d.reconcileCommitment(commitment,{...input,mode:'final',actualAmount:70,actualLoss:8},'observed'));passed++;
result=d.reconcileCommitment(commitment,{...input,mode:'final',actualAmount:70,actualLoss:8,noOutstandingObligations:true},'observed');check(result.status==='reconciled'&&result.actualAmount===70,'final actual stored');
for(const state of ['unknown','observed','prepared']){assert.throws(()=>d.reconcileCommitment(commitment,{...input,mode:'release',actualAmount:0,actualLoss:0,noExecution:true,noOutstandingObligations:true},state));passed++}
assert.throws(()=>d.reconcileCommitment(commitment,{...input,mode:'release',actualAmount:null,actualLoss:0,noExecution:true,noOutstandingObligations:true},'failed'));passed++;
result=d.reconcileCommitment(commitment,{...input,mode:'release',actualAmount:0,actualLoss:0,noExecution:true,noOutstandingObligations:true},'failed');check(result.status==='released','explicit failed zero release');
const lossLedger={...commitment,status:'reconciled',actualAmount:0,actualLoss:9};const decision=a.evaluateAuthority(authority,{...action,id:'next',operationKey:'next-v1',amount:0,loss:2},[lossLedger],Date.parse('2026-09-30T00:00:00Z'));
check(!decision.allowed&&decision.usage.loss===9,'new authority and period cannot reset cumulative loss');
const finalToday={...lossLedger,reconciledAt:'2026-09-30T00:00:00Z',actualAmount:90};check(a.evaluateAuthority(authority,{...action,id:'today',operationKey:'today-v1',amount:20,loss:0},[finalToday],Date.parse('2026-09-30T01:00:00Z')).usage.day===90,'current reconciliation conservatively counts today');
for(const actualAmount of [null,1])check(!a.evaluateAuthority(authority,{...action,id:'next',operationKey:'next-v1',amount:0,loss:0},[{...lossLedger,status:'released',actualAmount,actualLoss:0}],Date.parse('2026-09-30T00:00:00Z')).allowed,'invalid released ledger blocked');
console.log(JSON.stringify({passed,external:'not_called'}));
