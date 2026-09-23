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
// 별칭 단가 선언(loop-5, 결정 10: 별칭 hermes-agent 유지). 소유자가 별칭 뒤의 기반 모델과 단가를 선언하면 별칭 실행 비용을 읽을 때 추정한다.
// 원장(provider_usage) 원본은 바꾸지 않는다. 적용 시작일(YYYY-MM-DD)은 한국 시간 그날 0시부터이고, 실행마다 관측 시각 이전에 시작한 가장 늦은 선언을 쓴다.
export type AliasPricing={provider:'hermes';alias:string;baseModel:string;priceVersion:string;currency:string;inputPerMillion:number;outputPerMillion:number;source:string;effectiveFrom:string;declaredAt:string};
export type AliasModelChange={provider:string;observedAt:string};
export type AliasReestimate={reestimatedCost:number|null;reestimatePriceVersion:string;reestimateCurrency:string;reestimateBaseModel:string;reestimateSource:string;reestimateNote:'after_model_change'|'tokens_unknown'|null};
export const kstDayStart=(day:string)=>new Date(Date.parse(day+'T00:00:00+09:00')).toISOString();
// 선언의 유효 기간 끝: 적용 시작 이후 처음 관측된 같은 공급자의 경보(보고 모델 변경 또는 게이트웨이 스냅샷 models 섹션 변경). 경보 이후에는 기반 모델이 바뀌었을 수 있어 추정하지 않는다.
export function aliasPricingCutoff(d:AliasPricing,changes:AliasModelChange[]){
 const start=kstDayStart(d.effectiveFrom);
 return changes.filter(c=>c.provider===d.provider&&c.observedAt>=start).map(c=>c.observedAt).sort()[0]??null;
}
// 별칭 실행이 아니거나 적용할 선언이 없으면 null(표시 변경 없음).
export function aliasReestimate(e:Pick<ProviderUsage,'provider'|'model'|'observedAt'|'inputTokens'|'outputTokens'>,declarations:AliasPricing[],changes:AliasModelChange[]):AliasReestimate|null{
 if(!isModelAlias(e.provider,e.model))return null;
 const d=declarations.filter(x=>x.provider===e.provider&&kstDayStart(x.effectiveFrom)<=e.observedAt).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
 if(!d)return null;
 const cutoff=aliasPricingCutoff(d,changes),base={reestimatePriceVersion:d.priceVersion,reestimateCurrency:d.currency,reestimateBaseModel:d.baseModel,reestimateSource:d.source};
 if(cutoff&&e.observedAt>=cutoff)return {...base,reestimatedCost:null,reestimateNote:'after_model_change'};
 if(e.inputTokens===null||e.outputTokens===null)return {...base,reestimatedCost:null,reestimateNote:'tokens_unknown'};
 const amount=(e.inputTokens*d.inputPerMillion+e.outputTokens*d.outputPerMillion)/1000000;
 return {...base,reestimatedCost:Number.isFinite(amount)?amount:null,reestimateNote:null};
}
// 아직 해소되지 않은 경보만 경고한다: 선언 기간 안의 경보 중 그 뒤에 시작한 선언이 없는 것. 경보 다음 날짜로 다시 선언하면 경고가 사라진다.
export function aliasPricingWarning(declarations:AliasPricing[],changes:AliasModelChange[]){
 const open=changes.some(c=>declarations.some(d=>d.provider===c.provider&&kstDayStart(d.effectiveFrom)<=c.observedAt)&&!declarations.some(d=>d.provider===c.provider&&kstDayStart(d.effectiveFrom)>c.observedAt));
 return open?'보고 모델 변경 경보가 있습니다. 선언 단가는 경보 이전 기간만 유효하므로 경보 이후의 별칭 실행은 추정하지 않습니다. 기반 모델을 확인한 뒤 경보 다음 날짜를 적용 시작일로 다시 선언하세요.':null;
}
