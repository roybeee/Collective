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
// 별칭 단가 선언(loop-5, 결정 10): 원장 원본은 그대로 두고 읽을 때 reestimatedCost·reestimatePriceVersion을 계산한다(costStatus 'declared_estimate').
const declared={baseModel:'declared-base-model',priceVersion:'declared-2026-09',currency:'USD',inputPerMillion:2,outputPerMillion:8,source:'https://provider.example.com/pricing',effectiveFrom:'2026-09-01'};
for(const [name,bad] of [['alias as the base model',{baseModel:'HERMES-AGENT'}],['a non-calendar start date',{effectiveFrom:'2026-02-30'}],['a start date that is not YYYY-MM-DD',{effectiveFrom:'9/1/2026'}],['a month outside the calendar',{effectiveFrom:'2026-13-45'}],['month zero',{effectiveFrom:'2026-00-10'}],['a non-HTTPS source',{source:'http://provider.example.com/p'}],['a lowercase currency',{currency:'usd'}],['a negative rate',{outputPerMillion:-1}]]){await assert.rejects(()=>ledger.saveAliasPricing('dora',{...declared,...bad}),e=>e.status===400,name);passed++}
const saved=await ledger.saveAliasPricing('dora',declared);
check('alias price declaration keeps base model, rates, currency, source and start date',saved.alias==='hermes-agent'&&saved.baseModel==='declared-base-model'&&saved.effectiveFrom==='2026-09-01'&&saved.inputPerMillion===2&&Number.isFinite(Date.parse(saved.declaredAt)));
const entry=(runId,model,observedAt,extra={})=>({id:'hermes:'+runId,provider:'hermes',providerRunId:runId,model,inputTokens:100000,outputTokens:10000,totalTokens:110000,status:'completed',terminalReason:'completed',observedAt,costAmount:null,currency:null,priceVersion:null,costStatus:'unpriced',pricingSource:null,inputPricePerMillion:null,outputPricePerMillion:null,domainOutcome:null,outcomeObservedAt:null,...extra});
const rows={
 aliasIn:entry('alias_in','hermes-agent','2026-09-10T00:00:00.000Z'),
 // 2026-09-01 00:00 KST = 2026-08-31T15:00:00Z. 1초 전은 선언 이전이다.
 aliasBefore:entry('alias_before','hermes-agent','2026-08-31T14:59:59.000Z'),
 aliasStart:entry('alias_start','hermes-agent','2026-08-31T15:00:00.000Z'),
 aliasSplit:entry('alias_split','hermes-agent','2026-09-11T00:00:00.000Z',{inputTokens:null}),
 aliasMid:entry('alias_mid','hermes-agent','2026-09-10T13:00:00.000Z'),
 aliasLate:entry('alias_late','hermes-agent','2026-09-12T00:00:00.000Z'),
 real:entry('real','reported-model','2026-09-10T00:00:00.000Z',{costAmount:0.28,currency:'USD',priceVersion:'real-v1',costStatus:'estimated',pricingSource:'https://provider.example.com/real',inputPricePerMillion:2,outputPricePerMillion:8}),
 openai:entry('oa','hermes-agent','2026-09-10T00:00:00.000Z',{provider:'openai',id:'openai:oa'}),
};
for(const row of Object.values(rows))await server.recordStatement('dora','provider_usage',row.id,row).run();
let listed=await ledger.listProviderUsage('dora');
const byRun=id=>listed.find(e=>e.providerRunId===id);
check('old alias runs are re-estimated at read time with the declared price',byRun('alias_in').reestimatedCost===(100000*2+10000*8)/1000000&&byRun('alias_in').costStatus==='declared_estimate'&&byRun('alias_in').reestimatePriceVersion==='declared-2026-09'&&byRun('alias_in').reestimateBaseModel==='declared-base-model'&&byRun('alias_in').reestimateCurrency==='USD');
check('declared estimate is not written as the ledger cost',byRun('alias_in').costAmount===null&&byRun('alias_in').priceVersion===null);
check('the stored ledger row is unchanged (no re-pricing in place)',JSON.stringify(await server.readRecord('dora','provider_usage','hermes:alias_in'))===JSON.stringify(rows.aliasIn));
check('the start date begins at KST midnight',byRun('alias_start').costStatus==='declared_estimate'&&byRun('alias_before').costStatus==='unpriced'&&byRun('alias_before').reestimatedCost===undefined);
check('missing split tokens leave the declared estimate unknown',byRun('alias_split').costStatus==='unpriced'&&byRun('alias_split').reestimatedCost===null&&byRun('alias_split').reestimateNote==='tokens_unknown');
check('rows priced at observation keep the ledger cost and non-alias rows without a price stay unpriced',JSON.stringify(byRun('real'))===JSON.stringify(rows.real)&&byRun('oa').costStatus==='unpriced'&&!('reestimatedCost' in byRun('oa')));
// 별칭이 아닌 실제 모델 행: 관측 때 단가가 없어 원장 금액이 비어 있으면, 나중에 등록한 단가로 읽을 때 재추정한다(costStatus 'reestimated'). 원장은 그대로다.
const late={realLate:entry('real_late','gpt-x','2026-09-10T00:00:00.000Z',{provider:'openai',id:'openai:real_late'}),realLateSplit:entry('real_late_split','gpt-x','2026-09-10T00:00:00.000Z',{provider:'openai',id:'openai:real_late_split',outputTokens:null})};
for(const row of Object.values(late))await server.recordStatement('dora','provider_usage',row.id,row).run();
await ledger.saveUsagePricing('dora',{provider:'openai',model:'gpt-x',priceVersion:'gpt-x-2026-09-20',currency:'USD',inputPerMillion:1,outputPerMillion:4,source:'https://provider.example.com/gpt-x'});
listed=await ledger.listProviderUsage('dora');
check('a real-model run observed before its price was registered is re-estimated at read time',byRun('real_late').costStatus==='reestimated'&&byRun('real_late').reestimatedCost===(100000*1+10000*4)/1000000&&byRun('real_late').reestimatePriceVersion==='gpt-x-2026-09-20'&&byRun('real_late').reestimateCurrency==='USD'&&byRun('real_late').reestimateSource==='https://provider.example.com/gpt-x'&&byRun('real_late').costAmount===null&&byRun('real_late').priceVersion===null);
check('the re-estimated real-model ledger row is unchanged',JSON.stringify(await server.readRecord('dora','provider_usage','openai:real_late'))===JSON.stringify(late.realLate));
check('a real-model run with a missing split token count is not re-estimated',byRun('real_late_split').costStatus==='unpriced'&&!('reestimatedCost' in byRun('real_late_split')));
check('a row already priced at observation is not re-estimated',JSON.stringify(byRun('real'))===JSON.stringify(rows.real));
await ledger.saveAliasPricing('dora',{...declared,priceVersion:'declared-2026-09-11',inputPerMillion:4,effectiveFrom:'2026-09-11'});
listed=await ledger.listProviderUsage('dora');
check('the latest declaration that started before the run applies',byRun('alias_in').reestimatePriceVersion==='declared-2026-09'&&byRun('alias_split').reestimatePriceVersion==='declared-2026-09-11');
check('no model change alarm, no alias pricing warning',(await(async()=>{const c=await ledger.aliasPricingContext('dora');return c.declarations.length===2&&c.changes.length===0&&summary.aliasPricingWarning(c.declarations,c.changes)===null})()));
// 보고 모델 변경 경보가 선언 기간 안에 있으면 선언 단가는 경보 이전 기간만 유효하다.
await server.recordStatement('dora','model_change','hermes:1:abc',{id:'hermes:1:abc',key:'hermes',provider:'hermes',kind:'role',from:{reported:'hermes-agent',actual:null},to:{reported:'other-model',actual:'other-model'},providerRunId:'x',observedAt:'2026-09-10T12:00:00.000Z'}).run();
listed=await ledger.listProviderUsage('dora');
check('alias runs before the alarm keep the declared estimate',byRun('alias_in').costStatus==='declared_estimate');
check('alias runs after the alarm under the earlier declaration are not estimated',byRun('alias_mid').reestimatedCost===null&&byRun('alias_mid').reestimateNote==='after_model_change'&&byRun('alias_mid').costStatus==='unpriced'&&byRun('alias_mid').reestimatePriceVersion==='declared-2026-09');
check('a declaration that starts after the alarm estimates again',byRun('alias_late').costStatus==='declared_estimate'&&byRun('alias_late').reestimatePriceVersion==='declared-2026-09-11'&&byRun('alias_late').reestimatedCost===(100000*4+10000*8)/1000000);
const context=await ledger.aliasPricingContext('dora');
// 경고는 아직 해소되지 않은 경보만 알린다. 경보 뒤에 시작한 선언이 있으면 해소된 것이다.
check('an alarm inside the only declaration shows the before-alarm-only warning',/경보 이전 기간만 유효/.test(summary.aliasPricingWarning(context.declarations.filter(d=>d.effectiveFrom==='2026-09-01'),context.changes)));
check('re-declaring from a date after the alarm clears the warning',summary.aliasPricingWarning(context.declarations,context.changes)===null);
// CSV 내보내기에도 읽을 때 계산한 재추정 금액을 원장 금액(costAmount)과 다른 열로 싣는다.
const exporter=await load('lib/usage-export.ts');
const csvLines=(await exporter.usageCsv('dora',{})).body.replace(/^\uFEFF/,'').trim().split('\r\n').map(line=>line.split(','));
const csvCol=name=>csvLines[0].indexOf(name),csvRun=id=>csvLines.find(row=>row[csvCol('providerRunId')]===id);
check('CSV has re-estimate columns next to the ledger cost',['reestimatedCost','reestimateCurrency','reestimatePriceVersion','reestimateBaseModel'].every(c=>csvCol(c)>csvCol('costStatus')));
check('CSV shows the declared estimate of an alias row and keeps the ledger cost empty',(row=>row[csvCol('costAmount')]===''&&row[csvCol('costStatus')]==='declared_estimate'&&Number(row[csvCol('reestimatedCost')])===(100000*2+10000*8)/1000000&&row[csvCol('reestimateCurrency')]==='USD'&&row[csvCol('reestimatePriceVersion')]==='declared-2026-09'&&row[csvCol('reestimateBaseModel')]==='declared-base-model')(csvRun('alias_in')));
check('CSV shows the later-price estimate of a real-model row',(row=>row[csvCol('costAmount')]===''&&row[csvCol('costStatus')]==='reestimated'&&Number(row[csvCol('reestimatedCost')])===(100000*1+10000*4)/1000000&&row[csvCol('reestimatePriceVersion')]==='gpt-x-2026-09-20'&&row[csvCol('reestimateBaseModel')]==='')(csvRun('real_late')));
// 결정 10: 별칭 뒤 기반 모델이 바뀌어도 보고 모델(hermes-agent)은 그대로다. 게이트웨이 스냅샷의 models 섹션 변경도 경보로 본다(GROWTH-PLAN 설계 원칙 7).
await ledger.saveAliasPricing('erin',declared);
const erinRows={early:entry('erin_early','hermes-agent','2026-09-05T00:00:00.000Z'),late:entry('erin_late','hermes-agent','2026-09-12T00:00:00.000Z')};
for(const row of Object.values(erinRows))await server.recordStatement('erin','provider_usage',row.id,row).run();
const gatewayChange=(date,detectedAt,sections)=>server.recordStatement('erin','gateway_change',date,{id:date,detectedAt,fromHash:'a'.repeat(64),toHash:'b'.repeat(64),fromDate:'2026-09-01',toDate:date,sections:sections.map(section=>({section,added:[],removed:[],changed:['data.0.id'],truncated:false}))}).run();
await gatewayChange('2026-09-03','2026-09-03T00:05:00.000Z',['toolsets']);
listed=await ledger.listProviderUsage('erin');
check('a gateway change without the models section does not cut the declaration',byRun('erin_early').costStatus==='declared_estimate'&&byRun('erin_late').costStatus==='declared_estimate'&&summary.aliasPricingWarning(...Object.values(await ledger.aliasPricingContext('erin')))===null);
await gatewayChange('2026-09-10','2026-09-10T00:05:00.000Z',['capabilities','models']);
listed=await ledger.listProviderUsage('erin');
check('alias runs after a models-section gateway change are not estimated',byRun('erin_early').costStatus==='declared_estimate'&&byRun('erin_late').reestimatedCost===null&&byRun('erin_late').reestimateNote==='after_model_change'&&byRun('erin_late').costStatus==='unpriced');
check('a models-section gateway change shows the before-alarm-only warning',/경보 이전 기간만 유효/.test(summary.aliasPricingWarning(...Object.values(await ledger.aliasPricingContext('erin')))));
await ledger.saveAliasPricing('erin',{...declared,priceVersion:'declared-2026-09-11',effectiveFrom:'2026-09-11'});
listed=await ledger.listProviderUsage('erin');
check('re-declaring after the gateway change estimates again and clears the warning',byRun('erin_late').costStatus==='declared_estimate'&&byRun('erin_late').reestimatePriceVersion==='declared-2026-09-11'&&summary.aliasPricingWarning(...Object.values(await ledger.aliasPricingContext('erin')))===null);
console.log(JSON.stringify({passed}));
