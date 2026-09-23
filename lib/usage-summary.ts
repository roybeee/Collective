import type {ProviderUsage,UsageProvider} from './usage-ledger';

export function isModelAlias(provider:UsageProvider,model:string|null){
 return provider==='hermes'&&model?.toLowerCase()==='hermes-agent';
}
type UsageCounts=Pick<ProviderUsage,'inputTokens'|'outputTokens'|'totalTokens'|'domainOutcome'>;
export function summarizeUsage(entries:UsageCounts[]){
 return entries.reduce((sum,entry)=>({
  inputTokens:sum.inputTokens+(entry.inputTokens??0),
  outputTokens:sum.outputTokens+(entry.outputTokens??0),
  totalTokens:sum.totalTokens+(entry.totalTokens??0),
  unknownInputCount:sum.unknownInputCount+Number(entry.inputTokens===null),
  unknownOutputCount:sum.unknownOutputCount+Number(entry.outputTokens===null),
  unknownTotalCount:sum.unknownTotalCount+Number(entry.totalTokens===null),
  invalidOutputCount:sum.invalidOutputCount+Number(entry.domainOutcome==='invalid_output'),
  invalidOutputTokens:sum.invalidOutputTokens+(entry.domainOutcome==='invalid_output'?(entry.totalTokens??0):0),
  unknownInvalidOutputCount:sum.unknownInvalidOutputCount+Number(entry.domainOutcome==='invalid_output'&&entry.totalTokens===null),
  storedCount:sum.storedCount+Number(entry.domainOutcome==='completed'||entry.domainOutcome==='thin_output'),
  thinOutputCount:sum.thinOutputCount+Number(entry.domainOutcome==='thin_output'),
  unclassifiedCount:sum.unclassifiedCount+Number(entry.domainOutcome===null),
 }),{inputTokens:0,outputTokens:0,totalTokens:0,unknownInputCount:0,unknownOutputCount:0,unknownTotalCount:0,invalidOutputCount:0,invalidOutputTokens:0,unknownInvalidOutputCount:0,storedCount:0,thinOutputCount:0,unclassifiedCount:0});
}
