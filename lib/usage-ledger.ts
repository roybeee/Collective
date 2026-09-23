import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str} from './server';
import {isModelAlias} from './usage-summary';

export type UsageProvider='hermes'|'openai';
// thin_output: 저장했지만 출력 토큰이 역할 기준 분량의 5% 미만인 결과. 저장 완료와 쓸 만한 결과를 구분해 센다.
export type UsageOutcome='completed'|'thin_output'|'invalid_output'|'cancelled'|'provider_failed'|'storage_failed';
export type UsagePricing={provider:UsageProvider;model:string;priceVersion:string;currency:string;inputPerMillion:number;outputPerMillion:number;source:string;configuredAt:string};
export type ProviderUsage={
 id:string;provider:UsageProvider;providerRunId:string;model:string|null;
 inputTokens:number|null;outputTokens:number|null;totalTokens:number|null;
 status:string;terminalReason:string;observedAt:string;
 costAmount:number|null;currency:string|null;priceVersion:string|null;
 costStatus:'estimated'|'unpriced';pricingSource:string|null;
 inputPricePerMillion:number|null;outputPricePerMillion:number|null;
 domainOutcome:UsageOutcome|null;outcomeObservedAt:string|null;
};
const terminalStatuses=new Set(['completed','failed','error','cancelled','canceled','stopped','interrupted','incomplete']);
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const tokenCount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const text=(value:unknown)=>typeof value==='string'&&value.trim()&&value.length<=200?value.trim():null;
function providerName(value:unknown):UsageProvider{
 if(value!=='hermes'&&value!=='openai')throw new ApiError(400,'사용량 공급자를 확인하세요.');
 return value;
}
function rate(value:unknown){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000)throw new ApiError(400,'백만 토큰당 단가는 0 이상 1,000,000 이하로 입력하세요.');
 return value;
}
export function validateUsagePricing(input:Record<string,unknown>):UsagePricing{
 const provider=providerName(input.provider),model=str(input.model,'실제 모델 ID',200,true);
 if(isModelAlias(provider,model))throw new ApiError(400,'HERMES gateway 별칭에는 모델 단가를 적용할 수 없습니다. 기반 모델이 보고된 후 등록하세요.');
 const priceVersion=str(input.priceVersion,'단가 버전',100,true),currency=str(input.currency,'통화',3,true);
 if(!/^[A-Z]{3}$/.test(currency))throw new ApiError(400,'통화는 USD처럼 대문자 3자로 입력하세요.');
 const source=str(input.source,'단가 출처',2000,true);
 let url:URL;try{url=new URL(source)}catch{throw new ApiError(400,'단가 출처의 HTTPS 주소를 입력하세요.')}
 if(url.protocol!=='https:'||url.username||url.password)throw new ApiError(400,'단가 출처의 HTTPS 주소를 입력하세요.');
 return {provider,model,priceVersion,currency,inputPerMillion:rate(input.inputPerMillion),outputPerMillion:rate(input.outputPerMillion),source,configuredAt:stamp()};
}
export function estimateUsageCost(provider:UsageProvider,model:string|null,input:number|null,output:number|null,pricing?:UsagePricing){
 if(isModelAlias(provider,model))return null;
 if(!pricing||pricing.provider!==provider||pricing.model!==model||input===null||output===null)return null;
 const amount=(input*pricing.inputPerMillion+output*pricing.outputPerMillion)/1000000;
 return Number.isFinite(amount)?amount:null;
}
export async function saveUsagePricing(owner:string,input:Record<string,unknown>){
 const pricing=validateUsagePricing(input);
 await recordStatement(owner,'usage_pricing',pricing.provider+':'+pricing.model,pricing).run();
 return pricing;
}
export const listUsagePricing=(owner:string)=>listRecords<UsagePricing>(owner,'usage_pricing');
function displayUsage(entry:ProviderUsage):ProviderUsage{
 return isModelAlias(entry.provider,entry.model)?{...entry,costAmount:null,currency:null,priceVersion:null,costStatus:'unpriced',pricingSource:null,inputPricePerMillion:null,outputPricePerMillion:null}:entry;
}
export const listProviderUsage=async(owner:string)=>(await listRecords<ProviderUsage>(owner,'provider_usage')).map(displayUsage);
async function matchingPricing(owner:string,provider:UsageProvider,model:string|null){
 if(!model)return undefined;
 try{return await readRecord<UsagePricing>(owner,'usage_pricing',provider+':'+model)}
 catch(error){if(error instanceof ApiError&&error.status===404)return undefined;throw error}
}
export function normalizeProviderUsage(provider:UsageProvider,providerRunId:string,value:unknown,pricing?:UsagePricing):ProviderUsage|null{
 const raw=object(value),status=text(raw.status);
 if(!status||!terminalStatuses.has(status))return null;
 const usage=object(raw.usage),model=text(raw.model);
 const inputTokens=tokenCount(usage.input_tokens??usage.prompt_tokens),outputTokens=tokenCount(usage.output_tokens??usage.completion_tokens),totalTokens=tokenCount(usage.total_tokens);
 const reason=object(raw.incomplete_details).reason??object(raw.error).code??raw.finish_reason;
 // Keep structured reason codes, never arbitrary provider messages or result text.
 const terminalReason=typeof reason==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(reason)?reason:status;
 const costAmount=estimateUsageCost(provider,model,inputTokens,outputTokens,pricing);
 const matched=!isModelAlias(provider,model)&&pricing?.provider===provider&&pricing.model===model?pricing:undefined;
 return {id:provider+':'+providerRunId,provider,providerRunId,model,inputTokens,outputTokens,totalTokens,status,terminalReason,observedAt:stamp(),costAmount,currency:matched?.currency??null,priceVersion:matched?.priceVersion??null,costStatus:costAmount===null?'unpriced':'estimated',pricingSource:matched?.source??null,inputPricePerMillion:matched?.inputPerMillion??null,outputPricePerMillion:matched?.outputPerMillion??null,domainOutcome:null,outcomeObservedAt:null};
}
export async function recordProviderUsage(owner:string,provider:UsageProvider,providerRunId:string,response:unknown){
 providerName(provider);str(owner,'사용자',500,true);str(providerRunId,'공급자 실행 ID',200,true);
 const raw=object(response);
 if(!terminalStatuses.has(String(raw.status)))return null;
 const pricing=await matchingPricing(owner,provider,text(raw.model));
 const entry=normalizeProviderUsage(provider,providerRunId,raw,pricing)!;
 // Rates and first observation stay fixed; later provider reports may only fill missing usage.
 await database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)')
  .bind(`${owner}:provider_usage:${entry.id}`,owner,'provider_usage','',JSON.stringify(entry),entry.observedAt).run();
 await database().prepare("UPDATE records SET data=json_set(data,'$.model',COALESCE(json_extract(data,'$.model'),?),'$.inputTokens',COALESCE(json_extract(data,'$.inputTokens'),?),'$.outputTokens',COALESCE(json_extract(data,'$.outputTokens'),?),'$.totalTokens',COALESCE(json_extract(data,'$.totalTokens'),?)) WHERE id=? AND owner=? AND kind='provider_usage' AND (json_extract(data,'$.model') IS NULL OR ? IS NULL OR json_extract(data,'$.model')=?)")
  .bind(entry.model,entry.inputTokens,entry.outputTokens,entry.totalTokens,`${owner}:provider_usage:${entry.id}`,owner,entry.model,entry.model).run();
 await database().prepare("UPDATE records SET data=json_set(data,'$.costAmount',(json_extract(data,'$.inputTokens')*json_extract(data,'$.inputPricePerMillion')+json_extract(data,'$.outputTokens')*json_extract(data,'$.outputPricePerMillion'))/1000000.0,'$.costStatus','estimated') WHERE id=? AND owner=? AND kind='provider_usage' AND json_extract(data,'$.costAmount') IS NULL AND json_extract(data,'$.inputTokens') IS NOT NULL AND json_extract(data,'$.outputTokens') IS NOT NULL AND json_extract(data,'$.inputPricePerMillion') IS NOT NULL AND json_extract(data,'$.outputPricePerMillion') IS NOT NULL")
  .bind(`${owner}:provider_usage:${entry.id}`,owner).run();
 return displayUsage(await readRecord<ProviderUsage>(owner,'provider_usage',entry.id));
}
export async function saveJobUsageTokens(owner:string,jobId:string,total:unknown){
 const tokens=tokenCount(total);if(tokens===null)return;
 await database().prepare('UPDATE jobs SET tokens=MAX(tokens,?) WHERE id=? AND owner=?').bind(tokens,jobId,owner).run();
}
export async function markUsageOutcome(owner:string,provider:UsageProvider,providerRunId:string,outcome:UsageOutcome){
 providerName(provider);
 if(!['completed','thin_output','invalid_output','cancelled','provider_failed','storage_failed'].includes(outcome))throw new ApiError(400,'사용량 처리 결과를 확인하세요.');
 const observedAt=stamp();
 const result=await database().prepare("UPDATE records SET data=json_set(data,'$.domainOutcome',?,'$.outcomeObservedAt',?),updated_at=? WHERE id=? AND owner=? AND kind='provider_usage'")
  .bind(outcome,observedAt,observedAt,`${owner}:provider_usage:${provider}:${providerRunId}`,owner).run();
 return result.meta.changes>0;
}
