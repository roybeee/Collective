import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str} from './server';
import {isModelAlias} from './usage-summary';
import {APP_TREE} from './app-version';
import {observeReportedModelSafely} from './usage-model-alarm';

export type UsageProvider='hermes'|'openai';
export type UsageKind='role'|'meeting'|'brief'|'research'|'learning';
export const usageKinds:readonly UsageKind[]=['role','meeting','brief','research','learning'];
// 사용량 조인 키(F2a, loop-8). 첫 관측(INSERT) 때 한 번 채우고 이후 폴링으로 바꾸지 않는다. 모르는 값은 0이나 빈 문자열이 아니라 null이다.
// jobId: jobs.id(역할·회의·조사·학습) 또는 브리프 초안 id. promptVersion: '<스킬 버전>:<지시 sha256 앞 12자>', 스킬 버전이 없는 인라인 지시는 'inline:<해시>'.
// appTree: 기록한 배포의 소스 트리(lib/app-version.ts, 개발 실행은 null). durationMs: 제출 원문 저장 시각부터 종료 관측까지.
export type UsageJoinKeys={jobId:string|null;campaignId:string|null;campaignVersion:number|null;brandId:string|null;storeId:string|null;kind:UsageKind|null;role:string|null;artifactId:string|null;promptVersion:string|null;outputContractVersion:string|null;appTree:string|null;durationMs:number|null};
export type UsageContextFields=Partial<Pick<UsageJoinKeys,'jobId'|'campaignId'|'campaignVersion'|'brandId'|'storeId'|'role'|'artifactId'|'outputContractVersion'>>&{skillVersion?:string|null};
// submissionId: 제출 원문(hermes_submission·openai_submission) id. 제출 시각과 지시 해시를 여기서 읽고 원문은 바꾸지 않는다.
// resolve: 첫 기록 때만 부르는 추가 읽기(브랜드·지점·스킬 버전 등). 진행 중 폴링마다 DB를 더 읽지 않게 한다.
export type UsageContext=UsageContextFields&{kind:UsageKind;submissionId:string;resolve?:()=>Promise<UsageContextFields>};
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
}&Partial<UsageJoinKeys>&{superseded?:UsageSuperseded};
// 화면 표시용 판정(저장하지 않음): 작업물이 이전 버전이 됐거나(outdated) 브리프가 바뀌어 실행 기준이 무효가 됐다(brief_changed).
export type UsageSuperseded='outdated'|'brief_changed'|null;
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
const joinText=(value:unknown)=>typeof value==='string'&&value.trim()&&value.length<=300?value.trim():null;
const joinVersion=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
async function sha12(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,12)}
const emptyJoinKeys=():UsageJoinKeys=>({jobId:null,campaignId:null,campaignVersion:null,brandId:null,storeId:null,kind:null,role:null,artifactId:null,promptVersion:null,outputContractVersion:null,appTree:APP_TREE==='unknown'?null:APP_TREE,durationMs:null});
// 제출 원문의 저장 시각과 지시(instructions) 해시. 원문이 없거나 형식이 다르면 null이다.
async function submissionFacts(owner:string,provider:UsageProvider,submissionId:string){
 const kind=provider==='hermes'?'hermes_submission':'openai_submission';
 const row=await database().prepare('SELECT data,updated_at FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:${kind}:${submissionId}`,owner,kind).first<{data:string;updated_at:string}>();
 if(!row)return {submittedAt:null,instructionHash:null};
 let instructions:unknown=null;try{instructions=JSON.parse(String(JSON.parse(row.data).body)).instructions}catch{instructions=null}
 return {submittedAt:row.updated_at,instructionHash:typeof instructions==='string'?await sha12(instructions):null};
}
function joinFields(base:UsageJoinKeys,kind:UsageKind,f:UsageContextFields):UsageJoinKeys{
 return {...base,kind,jobId:joinText(f.jobId),campaignId:joinText(f.campaignId),campaignVersion:joinVersion(f.campaignVersion),brandId:joinText(f.brandId),storeId:joinText(f.storeId),role:joinText(f.role),artifactId:joinText(f.artifactId),outputContractVersion:joinText(f.outputContractVersion)};
}
// 조인 키 보조 읽기(resolve용): 없으면(404) undefined. 다른 오류는 usageJoinKeys가 잡아 정적 키만 남긴다.
export async function recordIfPresent<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(error){if(error instanceof ApiError&&error.status===404)return undefined;throw error}}
async function usageJoinKeys(owner:string,provider:UsageProvider,observedAt:string,context?:UsageContext):Promise<UsageJoinKeys>{
 const base=emptyJoinKeys();
 if(!context)return base;
 try{
  const fields={...context,...(context.resolve?await context.resolve():{})},{submittedAt,instructionHash}=await submissionFacts(owner,provider,context.submissionId);
  const elapsed=submittedAt?Date.parse(observedAt)-Date.parse(submittedAt):NaN;
  return {...joinFields(base,context.kind,fields),promptVersion:instructionHash?`${joinText(fields.skillVersion)??'inline'}:${instructionHash}`:null,durationMs:Number.isFinite(elapsed)&&elapsed>=0?Math.round(elapsed):null};
 }catch{console.error('usage_identity_read_failed');return joinFields(base,context.kind,context)}
}
export async function recordProviderUsage(owner:string,provider:UsageProvider,providerRunId:string,response:unknown,context?:UsageContext){
 providerName(provider);str(owner,'사용자',500,true);str(providerRunId,'공급자 실행 ID',200,true);
 const raw=object(response);
 if(!terminalStatuses.has(String(raw.status)))return null;
 const id=`${owner}:provider_usage:${provider}:${providerRunId}`;
 // 첫 관측이면 조인 키를 만든다. 이미 있으면 다시 만들지 않는다(첫 INSERT만 채운다). 이전 보고 모델은 모델 경보 비교에 쓴다.
 const previous=await database().prepare("SELECT json_extract(data,'$.model') AS model FROM records WHERE id=? AND owner=? AND kind='provider_usage'").bind(id,owner).first<{model:string|null}>();
 const pricing=await matchingPricing(owner,provider,text(raw.model));
 const entry=normalizeProviderUsage(provider,providerRunId,raw,pricing)!;
 const keys=previous?{}:await usageJoinKeys(owner,provider,entry.observedAt,context);
 // Rates and first observation stay fixed; later provider reports may only fill missing usage.
 await database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)')
  .bind(id,owner,'provider_usage','',JSON.stringify({...entry,...keys}),entry.observedAt).run();
 await database().prepare("UPDATE records SET data=json_set(data,'$.model',COALESCE(json_extract(data,'$.model'),?),'$.inputTokens',COALESCE(json_extract(data,'$.inputTokens'),?),'$.outputTokens',COALESCE(json_extract(data,'$.outputTokens'),?),'$.totalTokens',COALESCE(json_extract(data,'$.totalTokens'),?)) WHERE id=? AND owner=? AND kind='provider_usage' AND (json_extract(data,'$.model') IS NULL OR ? IS NULL OR json_extract(data,'$.model')=?)")
  .bind(entry.model,entry.inputTokens,entry.outputTokens,entry.totalTokens,`${owner}:provider_usage:${entry.id}`,owner,entry.model,entry.model).run();
 await database().prepare("UPDATE records SET data=json_set(data,'$.costAmount',(json_extract(data,'$.inputTokens')*json_extract(data,'$.inputPricePerMillion')+json_extract(data,'$.outputTokens')*json_extract(data,'$.outputPricePerMillion'))/1000000.0,'$.costStatus','estimated') WHERE id=? AND owner=? AND kind='provider_usage' AND json_extract(data,'$.costAmount') IS NULL AND json_extract(data,'$.inputTokens') IS NOT NULL AND json_extract(data,'$.outputTokens') IS NOT NULL AND json_extract(data,'$.inputPricePerMillion') IS NOT NULL AND json_extract(data,'$.outputPricePerMillion') IS NOT NULL")
  .bind(`${owner}:provider_usage:${entry.id}`,owner).run();
 // 보고 모델 변경 경보: 이 실행에서 모델을 처음 알게 됐을 때만 비교한다(같은 실행의 재조회는 0건).
 if(entry.model&&(!previous||previous.model===null))await observeReportedModelSafely(owner,{provider,kind:context?.kind??null,model:entry.model,providerRunId,observedAt:entry.observedAt});
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
