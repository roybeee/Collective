// M4 provider boundary: campaign-only, behind the separate owner write connection and default-off flag.
// A caller must persist sending/unknown receipts before/after I/O. Never retry a write.
import {readBoundedJson} from './http-limits';
import {metaId} from './meta-insights';
import {META_READ_API_VERSION} from './meta-insights-provider';
export type PausedCampaignDraft={accountId:string;name:string;objective:'OUTCOME_SALES';specialCategoryReview:'not_applicable';operationKey:string};
export type PausedCampaignReceipt={operationKey:string;accountId:string;externalId:string|null;state:'prepared'|'sending'|'unknown'|'paused_verified';sentAt:string|null;verifiedAt:string|null};
export class MetaPausedError extends Error {constructor(public code:'disabled'|'invalid'|'unknown'|'mismatch',message:string,public externalId:string|null=null){super(message)}}
function object(v:unknown):Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}}
export function pausedCampaignDraft(raw:Record<string,unknown>):PausedCampaignDraft{
 const accountId=metaId(raw.accountId,'광고 계정');
 if(typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>120||/[\u0000-\u001f]/.test(raw.name))throw new MetaPausedError('invalid','캠페인 이름을 확인하세요.');
 if(raw.objective!=='OUTCOME_SALES'||raw.specialCategoryReview!=='not_applicable')throw new MetaPausedError('invalid','첫 비활성 캠페인은 판매 목적·특별 광고 범주 비해당 검토가 필요합니다.');
 if(typeof raw.operationKey!=='string'||!/^[a-f0-9]{64}$/.test(raw.operationKey))throw new MetaPausedError('invalid','저장된 작업 식별자가 필요합니다.');
 // Reject unsafe fields even if TypeScript callers cast them in. No status, budget, targeting or arbitrary request payload accepted.
 const allowed=['accountId','name','objective','specialCategoryReview','operationKey'];if(Object.keys(raw).some(k=>!allowed.includes(k)))throw new MetaPausedError('invalid','지원하지 않는 광고 설정이 포함되어 있습니다.');
 return {accountId,name:raw.name.trim(),objective:'OUTCOME_SALES',specialCategoryReview:'not_applicable',operationKey:raw.operationKey};
}
export function preparedPausedReceipt(draft:PausedCampaignDraft):PausedCampaignReceipt{return {operationKey:draft.operationKey,accountId:draft.accountId,externalId:null,state:'prepared',sentAt:null,verifiedAt:null}}
function tokenValue(token:string){if(typeof token!=='string'||token.length<10||token.length>4096||!/^[A-Za-z0-9_.|\-]+$/.test(token))throw new MetaPausedError('invalid','별도 쓰기 연결이 필요합니다.');return token}
function guard(enabled:boolean){if(enabled!==true)throw new MetaPausedError('disabled','비활성 광고 생성 연결이 꺼져 있습니다.')}
async function responseJson(response:Response){if(!response.ok)throw new Error('provider response');const value=object(await readBoundedJson(response,300000));if(value.error)throw new Error('provider response');return value}
export async function verifyPausedMetaCampaign(token:string,receipt:PausedCampaignReceipt,enabled=false){
 guard(enabled);if(!/^[a-f0-9]{64}$/.test(receipt.operationKey))throw new MetaPausedError('invalid','작업 식별자를 확인하세요.');const secret=tokenValue(token),accountId=metaId(receipt.accountId,'광고 계정'),externalId=metaId(receipt.externalId,'외부 캠페인');
 try{const url=new URL(`https://graph.facebook.com/${META_READ_API_VERSION}/${externalId}`);url.searchParams.set('fields','id,name,account_id,configured_status,effective_status,objective');const value=await responseJson(await fetch(url.toString(),{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(15000)}));
  if(typeof value.name!=='string'||!value.name.endsWith(`[Collective ${receipt.operationKey}]`)||value.id!==externalId||value.account_id!==accountId||value.objective!=='OUTCOME_SALES'||value.configured_status!=='PAUSED'||value.effective_status!=='PAUSED')throw new MetaPausedError('mismatch','외부 캠페인의 계정·목적·비활성 상태가 일치하지 않습니다.',externalId);
  return {...receipt,state:'paused_verified' as const,verifiedAt:new Date().toISOString()};
 }catch(e){if(e instanceof MetaPausedError)throw e;throw new MetaPausedError('unknown','외부 비활성 상태를 확인하지 못했습니다. 생성 요청을 반복하지 말고 상태를 다시 조회하세요.',externalId)}
}
// Journal.begin must atomically compare prepared state and durably reserve sending. False rejects concurrent/repeated calls. An interrupted call stays unresolved.
export type PausedCampaignJournal={begin:(receipt:PausedCampaignReceipt)=>Promise<boolean>;finish:(receipt:PausedCampaignReceipt)=>Promise<void>};
export async function createPausedMetaCampaign(token:string,raw:Record<string,unknown>,receipt:PausedCampaignReceipt,journal:PausedCampaignJournal,enabled=false){
 guard(enabled);const draft=pausedCampaignDraft(raw),secret=tokenValue(token);
 if(receipt.operationKey!==draft.operationKey||receipt.accountId!==draft.accountId||receipt.state!=='prepared'||receipt.externalId!==null)throw new MetaPausedError('invalid','새 준비 작업만 전송할 수 있습니다. 전송 중·결과 미확인 작업은 재생성하지 않습니다.');
 const sending:PausedCampaignReceipt={...receipt,state:'sending',sentAt:new Date().toISOString(),verifiedAt:null};if(!await journal.begin(sending))throw new MetaPausedError('invalid','이미 전송한 작업입니다. 외부 상태를 대조하세요.');
 let externalId:string|null=null;
 try{
  const fields=new URL('https://graph.facebook.com/').searchParams;for(const [key,value] of Object.entries({name:`${draft.name} [Collective ${draft.operationKey}]`,objective:'OUTCOME_SALES',status:'PAUSED',special_ad_categories:'[]',is_adset_budget_sharing_enabled:'false'}))fields.set(key,value);
  const data=await responseJson(await fetch(`https://graph.facebook.com/${META_READ_API_VERSION}/act_${draft.accountId}/campaigns`,{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+secret,'content-type':'application/x-www-form-urlencoded'},body:fields.toString(),signal:AbortSignal.timeout(20000)}));
  externalId=metaId(data.id,'외부 캠페인');
  // Save the external ID before read-back so a process stop can be reconciled without a second POST.
  const unknown:PausedCampaignReceipt={...sending,state:'unknown',externalId};await journal.finish(unknown);
  const verified=await verifyPausedMetaCampaign(secret,unknown,true);await journal.finish(verified);return verified;
 }catch(e){
  try{await journal.finish({...sending,state:'unknown',externalId})}catch{/* The durable sending receipt remains unresolved. Never issue another POST. */}
  if(e instanceof MetaPausedError&&e.code==='mismatch')throw e;
  throw new MetaPausedError('unknown','생성 결과를 확정하지 못했습니다. 같은 작업을 다시 생성하지 말고 외부 상태를 대조하세요.',externalId);
 }
}
