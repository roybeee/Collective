import {META_READ_API_VERSION} from './meta-insights-provider';
import {metaId} from './meta-insights';
import {readBoundedJson} from './http-limits';
import {parseMetaAdBundle,type MetaAdBundleScope} from './meta-ad-bundle';
export const metaCreateStepNames=['adset','creative','ad'] as const;
export type MetaCreateStep=typeof metaCreateStepNames[number];
export type MetaCreateStepState={state:'prepared'|'sending'|'unknown'|'verified';externalId:string|null;verifiedAt:string|null};
export type MetaCreateSteps=Record<MetaCreateStep,MetaCreateStepState>;
export type MetaCreateScope={id:string;bundle:MetaAdBundleScope};
export type MetaCreateJournal={begin:(step:MetaCreateStep)=>Promise<boolean>;record:(step:MetaCreateStep,value:MetaCreateStepState)=>Promise<void>};
export const emptyMetaCreateSteps=():MetaCreateSteps=>({adset:{state:'prepared',externalId:null,verifiedAt:null},creative:{state:'prepared',externalId:null,verifiedAt:null},ad:{state:'prepared',externalId:null,verifiedAt:null}});
export class MetaCreateError extends Error{constructor(public code:'invalid'|'unknown'|'mismatch',message:string){super(message)}}
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const name=(s:MetaCreateScope,step:MetaCreateStep)=>`Collective ${step} [${s.id}]`;
function guard(token:string,s:MetaCreateScope){
 if(! /^[a-f0-9]{64}$/.test(s.id)||s.bundle.sourceBytesVerified!==true||!s.bundle.imageUploadReceiptId||typeof token!=='string'||token.length<10||token.length>4096||! /^[A-Za-z0-9_.|\-]+$/.test(token))throw new MetaCreateError('invalid','검수 원본 업로드 영수증과 고정된 쓰기 범위가 필요합니다.');
 const {accountId,campaignId,landingUrl,startAt,endAt,hook,body,assetBytesVerified,sourceBytesVerified,sourcePngHash,...input}=s.bundle;
 void assetBytesVerified;void sourceBytesVerified;void sourcePngHash;parseMetaAdBundle({...input,adsetId:'1',creativeId:'1',adId:'1'});metaId(accountId,'계정');metaId(campaignId,'부모 캠페인');
 let url:URL;try{url=new URL(landingUrl)}catch{throw new MetaCreateError('invalid','랜딩 주소가 올바르지 않습니다.')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!hook||!body||!Number.isFinite(Date.parse(startAt))||Date.parse(endAt)<=Date.parse(startAt))throw new MetaCreateError('invalid','현재 검수한 문구·랜딩·기간이 필요합니다.');
}
function fields(s:MetaCreateScope,step:MetaCreateStep,states:MetaCreateSteps){const b=s.bundle;if(step==='adset')return {name:name(s,step),campaign_id:b.campaignId,status:'PAUSED',daily_budget:b.graphDailyBudget,billing_event:'IMPRESSIONS',optimization_goal:'OFFSITE_CONVERSIONS',bid_strategy:'LOWEST_COST_WITHOUT_CAP',destination_type:'WEBSITE',start_time:b.startAt,end_time:b.endAt,promoted_object:{pixel_id:b.pixelId,custom_event_type:'PURCHASE'},targeting:{geo_locations:{countries:['KR']},age_min:b.ageMin,age_max:b.ageMax}};if(step==='creative')return {name:name(s,step),object_story_spec:{page_id:b.pageId,link_data:{link:b.landingUrl,image_hash:b.expectedMetaImageHash,name:b.hook,message:b.body,call_to_action:{type:b.callToActionType,value:{link:b.landingUrl}}}}};return {name:name(s,step),adset_id:states.adset.externalId,status:'PAUSED',creative:{creative_id:states.creative.externalId}}}
async function read(token:string,id:string,fieldNames:string){const url=new URL(`https://graph.facebook.com/${META_READ_API_VERSION}/${id.startsWith('act_')?'act_'+metaId(id.slice(4),'계정'):metaId(id,'외부 객체')}`);url.searchParams.set('fields',fieldNames);const r=await fetch(url.toString(),{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)}),v=obj(await readBoundedJson(r,300000));if(!r.ok||v.error)throw new Error('provider read failed');return v}
function same(a:unknown,b:unknown):boolean{if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));if(a&&b&&typeof a==='object'&&typeof b==='object'){const x=obj(a),y=obj(b);return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>same(x[k],y[k]))}return a===b}
export async function verifyMetaChild(token:string,s:MetaCreateScope,step:MetaCreateStep,states:MetaCreateSteps){
 guard(token,s);const id=states[step].externalId;if(!id)throw new MetaCreateError('invalid','알려진 외부 ID만 조회할 수 있습니다.');
 const expected=fields(s,step,states),fieldNames=step==='adset'?'campaign_id,configured_status,effective_status,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,destination_type,start_time,end_time,promoted_object,targeting':step==='creative'?'object_story_spec,asset_feed_spec,object_story_id,url_tags,degrees_of_freedom_spec':'campaign_id,adset_id,configured_status,effective_status,creative';
 const value=await read(token,id,'id,name,account_id,'+fieldNames);let valid=value.id===id&&value.account_id===s.bundle.accountId&&value.name===name(s,step);
 if(step==='creative')valid=valid&&same(value.object_story_spec,expected.object_story_spec)&&!value.asset_feed_spec&&!value.object_story_id&&!value.url_tags&&!value.degrees_of_freedom_spec;
 else{
  valid=valid&&value.configured_status==='PAUSED'&&['PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED'].includes(String(value.effective_status))&&value.campaign_id===s.bundle.campaignId;
  if(step==='ad')valid=valid&&value.adset_id===states.adset.externalId&&obj(value.creative).id===states.creative.externalId;
  else for(const [key,wanted] of Object.entries(expected)){if(['name','status'].includes(key))continue;valid=valid&&(key.endsWith('_time')?Date.parse(String(value[key]))===Date.parse(String(wanted)):same(value[key],wanted))}
  if(step==='adset')valid=valid&&[undefined,'0',0].includes(value.lifetime_budget as string|number|undefined);
 }
 if(!valid)throw new MetaCreateError('mismatch','외부 객체의 이름·계정·부모·비활성 상태·검수 구성이 일치하지 않습니다.');return {state:'verified' as const,externalId:id,verifiedAt:new Date().toISOString()};
}
async function preflight(token:string,s:MetaCreateScope,step:MetaCreateStep,states:MetaCreateSteps){const [account,parent]=await Promise.all([read(token,'act_'+s.bundle.accountId,'account_id,currency,timezone_name,account_status'),read(token,s.bundle.campaignId,'id,name,account_id,objective,configured_status,effective_status,daily_budget,lifetime_budget')]);if(account.account_id!==s.bundle.accountId||account.currency!=='KRW'||account.timezone_name!=='Asia/Seoul'||account.account_status!==1||parent.id!==s.bundle.campaignId||parent.account_id!==s.bundle.accountId||parent.objective!=='OUTCOME_SALES'||parent.configured_status!=='PAUSED'||parent.effective_status!=='PAUSED'||typeof parent.name!=='string'||!parent.name.endsWith('[Collective '+s.bundle.operationId+']')||![undefined,'0',0].includes(parent.daily_budget as string|number|undefined)||![undefined,'0',0].includes(parent.lifetime_budget as string|number|undefined))throw new MetaCreateError('mismatch','외부 계정·부모 캠페인의 비활성 상태 또는 예산 범위가 변경되었습니다.');if(step!=='adset')await verifyMetaChild(token,s,'adset',states);if(step==='ad')await verifyMetaChild(token,s,'creative',states)}
export async function createMetaChild(token:string,s:MetaCreateScope,step:MetaCreateStep,states:MetaCreateSteps,journal:MetaCreateJournal,enabled=false){
 if(!enabled)throw new MetaCreateError('invalid','비활성 하위 광고 생성 기능이 꺼져 있습니다.');guard(token,s);
 if(!metaCreateStepNames.includes(step)||states[step].state!=='prepared'||metaCreateStepNames.slice(0,metaCreateStepNames.indexOf(step)).some(k=>states[k].state!=='verified'))throw new MetaCreateError('invalid','앞 단계가 확인된 미전송 단계만 생성할 수 있습니다.');
 await preflight(token,s,step,states);if(!await journal.begin(step))throw new MetaCreateError('invalid','이미 전송한 단계입니다. 다시 생성하지 않습니다.');let externalId:string|null=null;
 try{
  const form=new URL('https://graph.facebook.com').searchParams;for(const [k,v] of Object.entries(fields(s,step,states)))form.set(k,typeof v==='object'?JSON.stringify(v):String(v));
  const endpoint={adset:'adsets',creative:'adcreatives',ad:'ads'}[step],r=await fetch(`https://graph.facebook.com/${META_READ_API_VERSION}/act_${s.bundle.accountId}/${endpoint}`,{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,'content-type':'application/x-www-form-urlencoded'},body:form.toString(),signal:AbortSignal.timeout(20000)}),v=obj(await readBoundedJson(r,100000));if(!r.ok||v.error)throw new Error('provider response');externalId=metaId(v.id,'외부 객체');
  const pending:MetaCreateStepState={state:'unknown',externalId,verifiedAt:null};await journal.record(step,pending);const verified=await verifyMetaChild(token,s,step,{...states,[step]:pending});await journal.record(step,verified);return verified;
 }catch(e){try{await journal.record(step,{state:'unknown',externalId,verifiedAt:null})}catch{/* sending/unknown remains unresolved */}if(e instanceof MetaCreateError)throw e;throw new MetaCreateError('unknown','생성 결과를 확정하지 못했습니다. 같은 단계를 다시 전송하지 말고 알려진 ID만 조회하세요.')}
}
export async function reconcileMetaChild(token:string,s:MetaCreateScope,step:MetaCreateStep,states:MetaCreateSteps,journal:MetaCreateJournal){if(!['unknown','sending'].includes(states[step].state)||!states[step].externalId)throw new MetaCreateError('invalid','결과가 미확정인 알려진 ID만 조회하세요.');await preflight(token,s,step,states);const verified=await verifyMetaChild(token,s,step,states);await journal.record(step,verified);return verified}
