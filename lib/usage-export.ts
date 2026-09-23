// 사용량 화면 응답과 소유자 전용 내보내기(F2a). 화면과 CSV가 같은 판정(superseded)과 같은 필터(lib/usage-summary.ts filterUsage)를 써서 합계가 같다.
// 내보내기에는 개인정보·키를 넣지 않는다: 소유자 id 접두어를 뗀 id, 멱등 키(key·session_id) 제외, 연결 주소·암호 없음.
import {ApiError,database,readRecord,stamp,str} from './server';
import {campaignScopes,scopesSql} from './record-kinds';
import {listProviderUsage,usageKinds,type ProviderUsage,type UsageKind,type UsageSuperseded} from './usage-ledger';
import {filterUsage,isModelAlias,type UsageFilter} from './usage-summary';
import type {Campaign} from './agency';

type CampaignRef={id:string;title:string;version:number};
// 작업물이 이전 버전이 됐으면 outdated, 실행 뒤 브리프 버전이 올라갔으면 brief_changed. 캠페인·버전을 모르면 판정하지 않는다(null).
export function supersededReason(entry:ProviderUsage,campaign:CampaignRef|undefined,artifactStatus:string|undefined):UsageSuperseded{
 if(artifactStatus==='outdated')return 'outdated';
 if(campaign&&typeof entry.campaignVersion==='number'&&campaign.version>entry.campaignVersion)return 'brief_changed';
 return null;
}
// 작업물 원문을 읽지 않도록 id·상태·제목·버전만 뽑는다.
async function campaignRefs(owner:string){
 const rows=await database().prepare("SELECT json_extract(data,'$.id') AS id,json_extract(data,'$.title') AS title,json_extract(data,'$.version') AS version FROM records WHERE owner=? AND kind='campaign'").bind(owner).all<CampaignRef>();
 return new Map(rows.results.map(c=>[c.id,c]));
}
async function artifactStatuses(owner:string){
 const rows=await database().prepare("SELECT json_extract(data,'$.id') AS id,json_extract(data,'$.status') AS status FROM records WHERE owner=? AND kind='artifact'").bind(owner).all<{id:string;status:string}>();
 return new Map(rows.results.map(a=>[a.id,a.status]));
}
export async function usageView(owner:string){
 const [entries,campaigns,artifacts]=await Promise.all([listProviderUsage(owner),campaignRefs(owner),artifactStatuses(owner)]);
 const annotated=entries.map(e=>({...e,superseded:supersededReason(e,e.campaignId?campaigns.get(e.campaignId):undefined,e.artifactId?artifacts.get(e.artifactId):undefined)}));
 const used=new Set(annotated.map(e=>e.campaignId).filter(Boolean));
 return {entries:annotated,campaigns:[...campaigns.values()].filter(c=>used.has(c.id)).map(({id,title})=>({id,title}))};
}
export function usageFilter(params:URLSearchParams):UsageFilter{
 const campaignId=params.get('campaignId')||null,kind=params.get('kind')||null,role=params.get('role')||null;
 if(campaignId)str(campaignId,'캠페인',100,true);
 if(kind&&!usageKinds.includes(kind as UsageKind))throw new ApiError(400,'실행 종류를 확인하세요.');
 if(role&&!/^[a-z_]{1,60}$/.test(role))throw new ApiError(400,'역할을 확인하세요.');
 return {campaignId,kind,role};
}
async function campaignKnown(owner:string,id:string){
 return !!await database().prepare("SELECT id FROM records WHERE owner=? AND id IN (?,?) AND kind IN ('campaign','deleted_campaign')").bind(owner,`${owner}:campaign:${id}`,`${owner}:deleted_campaign:${id}`).first();
}
const withoutOwner=(owner:string,id:string|null|undefined)=>id?.startsWith(owner+':')?id.slice(owner.length+1):id??null;
// 수식 주입을 막으려고 =·+·-·@로 시작하는 값 앞에 '를 붙인다. 모르는 값은 빈 칸이다(0이 아니다).
function csvCell(value:unknown){
 if(value===null||value===undefined)return '';
 const text=String(value),safe=/^[=+\-@\t\r]/.test(text)?"'"+text:text;
 return /[",\r\n]/.test(safe)?`"${safe.replace(/"/g,'""')}"`:safe;
}
// 재추정 열(loop-5): 원장 금액(costAmount)은 그대로 두고, 읽을 때 선언 단가(declared_estimate)나 관측 뒤 등록한 단가(reestimated)로 계산한 금액을 따로 싣는다.
export const USAGE_CSV_COLUMNS=['observedAt','provider','providerRunId','model','actualModel','status','terminalReason','domainOutcome','inputTokens','outputTokens','totalTokens','costAmount','currency','priceVersion','costStatus','reestimatedCost','reestimateCurrency','reestimatePriceVersion','reestimateBaseModel','jobId','campaignId','campaignVersion','brandId','storeId','kind','role','artifactId','promptVersion','outputContractVersion','appTree','durationMs','superseded'] as const;
type CsvRow=Record<typeof USAGE_CSV_COLUMNS[number],unknown>;
function csvRow(owner:string,e:ProviderUsage):CsvRow{
 return {observedAt:e.observedAt,provider:e.provider,providerRunId:e.providerRunId,model:e.model,actualModel:isModelAlias(e.provider,e.model)?null:e.model,status:e.status,terminalReason:e.terminalReason,domainOutcome:e.domainOutcome,inputTokens:e.inputTokens,outputTokens:e.outputTokens,totalTokens:e.totalTokens,costAmount:e.costAmount,currency:e.currency,priceVersion:e.priceVersion,costStatus:e.costStatus,reestimatedCost:e.reestimatedCost,reestimateCurrency:e.reestimateCurrency,reestimatePriceVersion:e.reestimatePriceVersion,reestimateBaseModel:e.reestimateBaseModel,
  jobId:withoutOwner(owner,e.jobId),campaignId:e.campaignId,campaignVersion:e.campaignVersion,brandId:e.brandId,storeId:e.storeId,kind:e.kind,role:e.role,artifactId:e.artifactId,promptVersion:e.promptVersion,outputContractVersion:e.outputContractVersion,appTree:e.appTree,durationMs:e.durationMs,superseded:e.superseded};
}
export async function usageCsv(owner:string,filter:UsageFilter){
 const rows=filterUsage((await usageView(owner)).entries,filter);
 if(filter.campaignId&&!rows.length&&!await campaignKnown(owner,filter.campaignId))throw new ApiError(404,'캠페인을 찾을 수 없습니다.');
 const lines=[USAGE_CSV_COLUMNS.join(','),...rows.map(e=>{const row=csvRow(owner,e);return USAGE_CSV_COLUMNS.map(c=>csvCell(row[c])).join(',')})];
 // 엑셀이 한글을 깨뜨리지 않도록 UTF-8 BOM을 붙인다.
 return {name:`collective-usage-${stamp().slice(0,10)}`,body:'\uFEFF'+lines.join('\r\n')+'\r\n'};
}
async function sha12(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,12)}
function submissionBody(data:string):{instructions:string|null;input:string|null}{
 try{const body=JSON.parse(String(JSON.parse(data).body));return {instructions:typeof body.instructions==='string'?body.instructions:null,input:typeof body.input==='string'?body.input:null}}
 catch{return {instructions:null,input:null}}
}
// 캠페인 단위 HERMES 제출 원문(리플레이용). 캠페인과 이어지는 제출은 삭제 정책과 같은 경로(lib/record-kinds.ts)로 찾는다.
// instructions·input은 저장한 본문 그대로다. 새 session_id(멱등 키)만 붙이면 같은 요청을 다시 만들 수 있다.
export async function campaignSubmissions(owner:string,campaignId:unknown){
 const campaign=await readRecord<Campaign>(owner,'campaign',str(campaignId,'캠페인',100,true));
 const q=scopesSql('SELECT id,data,updated_at',owner,campaignScopes('delete',owner,campaign.id,k=>k.kind==='hermes_submission'));
 const rows=(await database().prepare(q.sql+' ORDER BY updated_at,id').bind(...q.binds).all<{id:string;data:string;updated_at:string}>()).results;
 const prefix=`${owner}:hermes_submission:`;
 const submissions=await Promise.all(rows.map(async r=>{const body=submissionBody(r.data);return {id:withoutOwner(owner,r.id.startsWith(prefix)?r.id.slice(prefix.length):r.id),submittedAt:r.updated_at,instructions:body.instructions,input:body.input,instructionHash:body.instructions===null?null:await sha12(body.instructions)}}));
 return {campaignId:campaign.id,campaignVersion:campaign.version,exportedAt:stamp(),submissions};
}
