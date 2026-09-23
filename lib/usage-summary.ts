import type {ProviderUsage,UsageProvider} from './usage-ledger';

export function isModelAlias(provider:UsageProvider,model:string|null){
 return provider==='hermes'&&model?.toLowerCase()==='hermes-agent';
}
// 공급자가 보고한 모델. 별칭이면 actual은 null이다('실제 모델 미확인').
export type ReportedModel={reported:string;actual:string|null};
export const modelLabel=(m:ReportedModel)=>m.actual??`실제 모델 미확인 (${m.reported})`;
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
// 사용량 필터(F2a). 화면과 CSV 내보내기가 같은 함수를 써서 합계가 같다. 빈 값은 전체다.
export type UsageFilter={campaignId?:string|null;kind?:string|null;role?:string|null};
type Filterable=Pick<ProviderUsage,'campaignId'|'kind'|'role'>;
export function filterUsage<T extends Filterable>(entries:T[],filter:UsageFilter){
 return entries.filter(e=>(!filter.campaignId||e.campaignId===filter.campaignId)&&(!filter.kind||e.kind===filter.kind)&&(!filter.role||e.role===filter.role));
}
export const usageKindNames:Record<string,string>={role:'역할 실행',meeting:'팀 회의',brief:'브리프 초안',research:'브랜드 조사',learning:'바이럴 학습'};
