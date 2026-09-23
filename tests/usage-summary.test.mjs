import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw new Error('No external calls expected')});
const summary=await load('lib/usage-summary.ts');
const ledger=await load('lib/usage-ledger.ts');
const server=await load('lib/server.ts');
let passed=0;
function check(name,condition){assert.ok(condition,name);passed++}
check('Hermes agent is an alias, not the underlying model',summary.isModelAlias('hermes','hermes-agent'));
check('concrete reported model is not a known alias',!summary.isModelAlias('hermes','reported-model'));
const price={provider:'hermes',model:'hermes-agent',inputPerMillion:2,outputPerMillion:8};
check('cannot price gateway alias as actual model',ledger.estimateUsageCost('hermes','hermes-agent',100,10,price)===null);
await assert.rejects(()=>ledger.saveUsagePricing('alice',{...price,priceVersion:'v1',currency:'USD',source:'https://provider.example.com/pricing'}),/별칭/);passed++;
const result=summary.summarizeUsage([{inputTokens:10,outputTokens:2,totalTokens:12,domainOutcome:'completed'},{inputTokens:20,outputTokens:0,totalTokens:20,domainOutcome:'invalid_output'},{inputTokens:null,outputTokens:null,totalTokens:null,domainOutcome:null}]);
check('known totals do not silently turn missing usage into zero',result.totalTokens===32&&result.unknownTotalCount===1&&result.inputTokens===30&&result.unknownInputCount===1);
check('invalid output usage remains visible separately',result.invalidOutputTokens===20&&result.invalidOutputCount===1);
check('provider completion alone does not count as a validated result',result.storedCount===1&&result.unclassifiedCount===1);
// 분량 부족(thin_output)은 저장됐지만 쓸 만한 결과와 구분해 센다(ai-quality-4 권고 4).
const thin=summary.summarizeUsage([{inputTokens:10,outputTokens:2,totalTokens:12,domainOutcome:'completed'},{inputTokens:10,outputTokens:1,totalTokens:11,domainOutcome:'thin_output'}]);
check('thin output counts as stored and separately as thin',thin.storedCount===2&&thin.thinOutputCount===1);
check('zero tokens stays known',summary.summarizeUsage([{inputTokens:0,outputTokens:0,totalTokens:0,domainOutcome:'completed'}]).unknownTotalCount===0);
const legacy={id:'hermes:legacy',provider:'hermes',providerRunId:'legacy',model:'hermes-agent',inputTokens:100,outputTokens:10,totalTokens:110,costAmount:999,costStatus:'estimated',priceVersion:'incorrect-alias',currency:'USD'};
await server.recordStatement('alice','provider_usage',legacy.id,legacy).run();
const visible=(await ledger.listProviderUsage('alice'))[0];
check('legacy alias prices are not presented as verified costs',visible.costAmount===null&&visible.priceVersion===null&&visible.model==='hermes-agent');
check('historical source ledger is preserved', (await server.readRecord('alice','provider_usage',legacy.id)).costAmount===999);
console.log(JSON.stringify({passed}));
