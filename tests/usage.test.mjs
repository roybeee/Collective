import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';

const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
class Statement{
 constructor(query,values=[]){this.query=query;this.values=values}
 bind(...values){return new Statement(this.query,values)}
 async first(){return sql.prepare(this.query).get(...this.values)||null}
 async all(){return {results:sql.prepare(this.query).all(...this.values)}}
 async run(){return {meta:{changes:Number(sql.prepare(this.query).run(...this.values).changes)}}}
}
const runtime={AUTH_MODE:'legacy',DB:{prepare:query=>new Statement(query)}};
let response={},failStatusAfterStop=false;
const context=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,process:{env:{NODE_ENV:'production'}},fetch:async url=>{if(failStatusAfterStop&&!url.endsWith('/stop'))throw new Error('connection lost after stop');return Response.json(response)}});
const modules=new Map();
const env=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context});
function moduleFor(file){
 file=resolve(file);if(modules.has(file))return modules.get(file);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const vmModule=new SourceTextModule(code,{context,identifier:file});modules.set(file,vmModule);return vmModule;
}
async function load(file){
 const vmModule=moduleFor(file);
 if(vmModule.status==='unlinked')await vmModule.link((specifier,reference)=>{
  if(specifier==='cloudflare:workers')return env;
  const file=specifier.startsWith('@/')?resolve(specifier.slice(2)):resolve(dirname(reference.identifier),specifier);
  return moduleFor(file.endsWith('.ts')?file:file+'.ts');
 });
 await vmModule.evaluate();return vmModule.namespace;
}
const ledger=await load('lib/usage-ledger.ts');
const passed=[];
function check(name,value){assert.ok(value,name);passed.push(name)}
const pricing={provider:'hermes',model:'reported-model',priceVersion:'manual-2026-09',currency:'USD',inputPerMillion:2,outputPerMillion:8,source:'https://provider.example.com/pricing'};
const sample={object:'hermes.run',run_id:'run_1',status:'completed',model:'reported-model',usage:{input_tokens:1000000,output_tokens:250000,total_tokens:1250000}};
await ledger.saveUsagePricing('alice',pricing);
const first=await ledger.recordProviderUsage('alice','hermes','run_1',sample);
check('matching explicit model pricing computes an estimate with its version',first.costAmount===4&&first.costStatus==='estimated'&&first.priceVersion===pricing.priceVersion&&first.currency==='USD');
check('ledger preserves the actual rate snapshot',first.inputPricePerMillion===2&&first.outputPricePerMillion===8&&first.pricingSource===pricing.source);
check('pricing cannot leak across providers or actual reported models',ledger.estimateUsageCost('openai','reported-model',10,10,pricing)===null&&ledger.estimateUsageCost('hermes','other-model',10,10,pricing)===null);
check('reported model and usage retained',first.model==='reported-model'&&first.inputTokens===1000000&&first.outputTokens===250000&&first.totalTokens===1250000);
check('terminal reason and observation timestamp retained',first.terminalReason==='completed'&&Number.isFinite(Date.parse(first.observedAt)));
await ledger.saveUsagePricing('alice',{...pricing,priceVersion:'new-version',inputPerMillion:20});
await ledger.recordProviderUsage('alice','hermes','run_1',{...sample,usage:{total_tokens:1}});
let rows=await ledger.listProviderUsage('alice');
check('repeat polls never duplicate or reprice an observed run',rows.length===1&&rows[0].costAmount===4&&rows[0].priceVersion===pricing.priceVersion);
await ledger.saveUsagePricing('alice',pricing);
await ledger.recordProviderUsage('alice','hermes','run_delayed',{...sample,usage:{}});
await ledger.saveUsagePricing('alice',{...pricing,priceVersion:'later-price',inputPerMillion:200});
await ledger.recordProviderUsage('alice','hermes','run_delayed',sample);
const enriched=(await ledger.listProviderUsage('alice')).find(x=>x.providerRunId==='run_delayed');
check('late usage fills null fields using the original price snapshot',enriched.totalTokens===1250000&&enriched.costAmount===4&&enriched.priceVersion===pricing.priceVersion);
await ledger.recordProviderUsage('bob','hermes','run_1',sample);
const bob=(await ledger.listProviderUsage('bob'))[0];
check('same provider run is isolated by owner and owner pricing',bob.costAmount===null&&bob.priceVersion===null&&(await ledger.listProviderUsage('alice')).length===2);
const missing=await ledger.recordProviderUsage('alice','openai','resp_missing',{status:'failed',error:{code:'provider_error',message:'private secret'},usage:{total_tokens:17}});
check('unknown model split usage and price remain null rather than zero',missing.model===null&&missing.inputTokens===null&&missing.outputTokens===null&&missing.costAmount===null&&missing.totalTokens===17);
check('termination reason stores code without private provider error message',missing.terminalReason==='provider_error'&&!JSON.stringify(missing).includes('private secret'));
const invalid=await ledger.recordProviderUsage('alice','openai','resp_invalid',{status:'incomplete',model:'different-model',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:-1,output_tokens:'20',total_tokens:1.5}});
check('invalid usage types do not become billable numbers',invalid.inputTokens===null&&invalid.outputTokens===null&&invalid.totalTokens===null&&invalid.costAmount===null&&invalid.terminalReason==='max_output_tokens');
const aliases=await ledger.recordProviderUsage('alice','hermes','run_alias',{status:'cancelled',usage:{prompt_tokens:15,completion_tokens:0,total_tokens:15}});
check('explicit zero and Hermes token aliases are preserved',aliases.inputTokens===15&&aliases.outputTokens===0&&aliases.totalTokens===15);
check('nonterminal responses are not entered in the terminal ledger',await ledger.recordProviderUsage('alice','hermes','run_waiting',{status:'running',usage:{total_tokens:10}})===null);
await assert.rejects(()=>ledger.saveUsagePricing('alice',{...pricing,inputPerMillion:-1}));passed.push('negative manual rate rejected');
await assert.rejects(()=>ledger.saveUsagePricing('alice',{...pricing,source:'javascript:alert(1)'}));passed.push('invalid manual pricing source rejected');
await assert.rejects(()=>ledger.saveUsagePricing('alice',{...pricing,currency:'usd'}));passed.push('ambiguous currency rejected');
const hermes=await load('lib/hermes.ts');
const cfg={provider:'hermes',endpoint:'https://hermes.example.com',key:'local-test-only',model:'configured-label'};
for(const status of ['failed','cancelled','incomplete','completed']){
 const id='run_'+status;response={...sample,run_id:id,status,output:status==='completed'?'not valid domain JSON':undefined};
 const output=await hermes.pollHermes(cfg,id,false,30000,'alice');
 const row=(await ledger.listProviderUsage('alice')).find(x=>x.providerRunId===id);
 check(status+' provider usage captured before domain result parsing',row?.totalTokens===1250000&&row.model==='reported-model'&&(status!=='completed'||output.output[0].content[0].text==='not valid domain JSON'));
}
response={...sample,run_id:'run_bad_output',output:123};
const malformed=await hermes.pollHermes(cfg,'run_bad_output',false,30000,'alice');
check('malformed completed output is an explicit terminal domain failure',malformed.status==='failed'&&malformed.invalidOutput===true&&malformed.output.length===0);
check('malformed completed output still preserves incurred usage',(await ledger.listProviderUsage('alice')).some(x=>x.providerRunId==='run_bad_output'));
await ledger.markUsageOutcome('alice','hermes','run_bad_output','invalid_output');
const invalidOutput=(await ledger.listProviderUsage('alice')).find(x=>x.providerRunId==='run_bad_output');
check('domain failure is distinct from provider completion and preserves billing',invalidOutput.domainOutcome==='invalid_output'&&invalidOutput.status==='completed'&&invalidOutput.totalTokens===1250000&&Number.isFinite(Date.parse(invalidOutput.outcomeObservedAt)));
check('domain annotation cannot create a foreign owner entry',await ledger.markUsageOutcome('bob','hermes','run_bad_output','completed')===false);
await assert.rejects(()=>ledger.markUsageOutcome('alice','hermes','run_bad_output','unvalidated text'));passed.push('invalid domain outcome rejected');
response={...sample,run_id:'wrong',output:'wrong'};
await assert.rejects(()=>hermes.pollHermes(cfg,'run_expected',false,30000,'alice'));
check('mismatched run identity cannot contaminate ledger',!(await ledger.listProviderUsage('alice')).some(x=>x.providerRunId==='run_expected'));
response={...sample,run_id:'run_stop',status:'cancelled'};failStatusAfterStop=true;
await assert.rejects(()=>hermes.pollHermes(cfg,'run_stop',true,30000,'alice'));
check('terminal stop acknowledgement survives subsequent status transport failure',(await ledger.listProviderUsage('alice')).some(x=>x.providerRunId==='run_stop'&&x.status==='cancelled'));
failStatusAfterStop=false;response={...sample,run_id:'run_oversized',output:'x'.repeat(1000001)};
await assert.rejects(()=>hermes.pollHermes(cfg,'run_oversized',false,30000,'alice'),error=>error.status===502);
check('oversized provider response is rejected before unbounded JSON decoding',!(await ledger.listProviderUsage('alice')).some(x=>x.providerRunId==='run_oversized'));
const route=await load('app/api/usage/route.ts');
let result=await route.GET(new Request('https://agency.test/api/usage'));
check('usage API requires authenticated owner',result.status===401);
result=await route.GET(new Request('https://agency.test/api/usage',{headers:{'oai-authenticated-user-id':'bob'}}));
const body=await result.json();
check('usage API returns only authenticated owner entries',body.entries.length===1&&body.entries[0].providerRunId==='run_1'&&body.pricing.length===0);
result=await route.POST(new Request('https://agency.test/api/usage',{method:'POST',headers:{'oai-authenticated-user-id':'alice',origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({action:'set_pricing',...pricing})}));
check('cross-origin price mutation rejected',result.status===403);
result=await route.POST(new Request('https://agency.test/api/usage',{method:'POST',headers:{'oai-authenticated-user-id':'alice',origin:'https://agency.test','Content-Type':'application/json'},body:JSON.stringify({action:'set_pricing',...pricing})}));
check('explicit authenticated pricing is saved',result.status===200);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
