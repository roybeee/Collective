// Read-only M4 boundary: supported shape is one static website link ad, KR adult targeting.
import {metaId} from './meta-insights';
import {META_READ_API_VERSION} from './meta-insights-provider';
import {readBoundedJson} from './http-limits';
export type MetaAdBundleInput={operationId:string;imageUploadReceiptId?:string;adsetId:string;creativeId:string;adId:string;pageId:string;pixelId:string;expectedMetaImageHash:string;callToActionType:'LEARN_MORE'|'SHOP_NOW';dailyBudgetKrw:number;graphDailyBudget:string;budgetUnitEvidence:string;ageMin:number;ageMax:number;country:'KR'};
export type MetaAdBundleScope=MetaAdBundleInput&{accountId:string;campaignId:string;landingUrl:string;startAt:string;endAt:string;hook:string;body:string;assetBytesVerified:false;sourceBytesVerified?:boolean;sourcePngHash?:string|null};
export class MetaAdBundleError extends Error{constructor(public code:'invalid'|'mismatch'|'unknown',message:string){super(message)}}
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function parseMetaAdBundle(value:unknown):MetaAdBundleInput{
 const v=obj(value),allowed=['operationId','imageUploadReceiptId','adsetId','creativeId','adId','pageId','pixelId','expectedMetaImageHash','callToActionType','dailyBudgetKrw','graphDailyBudget','budgetUnitEvidence','ageMin','ageMax','country'];
 const invalid=()=>{throw new MetaAdBundleError('invalid','패키지의 식별자·별도 예산 단위·대한민국 성인 타깃을 확인하세요.')};
 if(Object.keys(v).some(k=>!allowed.includes(k))||typeof v.operationId!=='string'||! /^[a-f0-9]{64}$/.test(v.operationId))invalid();
 if(v.imageUploadReceiptId!==undefined&&v.imageUploadReceiptId!==''&&(typeof v.imageUploadReceiptId!=='string'||! /^[a-f0-9]{64}$/.test(v.imageUploadReceiptId)))invalid();
 if(typeof v.dailyBudgetKrw!=='number'||!Number.isSafeInteger(v.dailyBudgetKrw)||v.dailyBudgetKrw<=0||v.dailyBudgetKrw>1e12)invalid();
 if(typeof v.graphDailyBudget!=='string'||! /^[1-9][0-9]{0,14}$/.test(v.graphDailyBudget))invalid();
 if(typeof v.expectedMetaImageHash!=='string'||! /^[a-f0-9]{32}$/.test(v.expectedMetaImageHash)||!['LEARN_MORE','SHOP_NOW'].includes(String(v.callToActionType)))invalid();
 if(typeof v.budgetUnitEvidence!=='string'||!v.budgetUnitEvidence.trim()||v.budgetUnitEvidence.length>500||/[\u0000-\u001f]/.test(v.budgetUnitEvidence))invalid();
 if(!Number.isInteger(v.ageMin)||!Number.isInteger(v.ageMax)||Number(v.ageMin)<18||Number(v.ageMax)>65||Number(v.ageMax)<Number(v.ageMin)||v.country!=='KR')invalid();
 return {operationId:v.operationId as string,...(v.imageUploadReceiptId?{imageUploadReceiptId:v.imageUploadReceiptId as string}:{}),adsetId:metaId(v.adsetId,'광고세트'),creativeId:metaId(v.creativeId,'Meta 소재'),adId:metaId(v.adId,'광고'),pageId:metaId(v.pageId,'페이지'),pixelId:metaId(v.pixelId,'픽셀'),expectedMetaImageHash:v.expectedMetaImageHash as string,callToActionType:v.callToActionType as 'LEARN_MORE'|'SHOP_NOW',dailyBudgetKrw:v.dailyBudgetKrw as number,graphDailyBudget:v.graphDailyBudget as string,budgetUnitEvidence:(v.budgetUnitEvidence as string).trim(),ageMin:v.ageMin as number,ageMax:v.ageMax as number,country:'KR'};
}
function matches(value:boolean){if(!value)throw new MetaAdBundleError('mismatch','외부 객체의 계보·비활성 상태·예산·타깃·픽셀·페이지·소재·랜딩이 검토한 패키지와 일치하지 않습니다.')}
function paused(v:Record<string,unknown>){return v.configured_status==='PAUSED'&&['PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED'].includes(String(v.effective_status))}
async function read(token:string,id:string,fields:string){
 const url=new URL(`https://graph.facebook.com/${META_READ_API_VERSION}/${id}`);url.searchParams.set('fields',fields);
 const response=await fetch(url.toString(),{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('provider response');const data=obj(await readBoundedJson(response,300000));if(data.error)throw new Error('provider response');return data;
}
export async function verifyMetaAdBundle(token:string,s:MetaAdBundleScope){
 parseMetaAdBundle(Object.fromEntries(Object.entries(s).filter(([k])=>!['accountId','campaignId','landingUrl','startAt','endAt','hook','body','assetBytesVerified','sourceBytesVerified','sourcePngHash'].includes(k))));
 const accountId=metaId(s.accountId,'광고 계정'),campaignId=metaId(s.campaignId,'외부 캠페인');
 if(typeof token!=='string'||token.length<10||token.length>4096||! /^[A-Za-z0-9_.|\-]+$/.test(token))throw new MetaAdBundleError('invalid','읽기 연결을 확인하세요.');
 try{
  const [account,campaign,set,creative,ad]=await Promise.all([read(token,'act_'+accountId,'account_id,currency,timezone_name,account_status'),read(token,campaignId,'id,name,account_id,objective,configured_status,effective_status,daily_budget,lifetime_budget'),read(token,s.adsetId,'id,account_id,campaign_id,configured_status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,destination_type,start_time,end_time,promoted_object,targeting'),read(token,s.creativeId,'id,account_id,object_story_spec,asset_feed_spec,object_story_id,url_tags,degrees_of_freedom_spec'),read(token,s.adId,'id,account_id,campaign_id,adset_id,configured_status,effective_status,creative')]);
  matches(account.account_id===accountId&&account.currency==='KRW'&&account.timezone_name==='Asia/Seoul'&&account.account_status===1);
  matches(campaign.id===campaignId&&campaign.account_id===accountId&&campaign.objective==='OUTCOME_SALES'&&campaign.configured_status==='PAUSED'&&campaign.effective_status==='PAUSED'&&typeof campaign.name==='string'&&campaign.name.endsWith(`[Collective ${s.operationId}]`));
  matches([undefined,'0',0].includes(campaign.daily_budget as string|number|undefined)&&[undefined,'0',0].includes(campaign.lifetime_budget as string|number|undefined));
  const promoted=obj(set.promoted_object),target=obj(set.targeting),geo=obj(target.geo_locations);
  matches(set.id===s.adsetId&&set.account_id===accountId&&set.campaign_id===campaignId&&paused(set)&&set.daily_budget===s.graphDailyBudget&&[undefined,'0',0].includes(set.lifetime_budget as string|number|undefined));
  matches(set.optimization_goal==='OFFSITE_CONVERSIONS'&&set.billing_event==='IMPRESSIONS'&&set.destination_type==='WEBSITE'&&promoted.pixel_id===s.pixelId&&promoted.custom_event_type==='PURCHASE');
  matches(Date.parse(String(set.start_time))===Date.parse(s.startAt)&&Date.parse(String(set.end_time))===Date.parse(s.endAt));
  matches(Object.keys(target).every(k=>['geo_locations','age_min','age_max'].includes(k))&&Object.keys(geo).every(k=>k==='countries')&&JSON.stringify(geo.countries)==='["KR"]'&&target.age_min===s.ageMin&&target.age_max===s.ageMax);
  const story=obj(creative.object_story_spec),link=obj(story.link_data),cta=obj(link.call_to_action),ctaValue=obj(cta.value);
  matches(Object.keys(story).every(k=>['page_id','link_data'].includes(k))&&Object.keys(link).every(k=>['link','name','message','image_hash','call_to_action'].includes(k))&&Object.keys(cta).every(k=>['type','value'].includes(k))&&Object.keys(ctaValue).every(k=>k==='link'));
  matches(creative.id===s.creativeId&&creative.account_id===accountId&&!creative.asset_feed_spec&&!creative.object_story_id&&!creative.url_tags&&!creative.degrees_of_freedom_spec&&story.page_id===s.pageId&&link.link===s.landingUrl&&link.name===s.hook&&link.message===s.body&&link.image_hash===s.expectedMetaImageHash&&cta.type===s.callToActionType&&ctaValue.link===s.landingUrl);
  matches(ad.id===s.adId&&ad.account_id===accountId&&ad.campaign_id===campaignId&&ad.adset_id===s.adsetId&&obj(ad.creative).id===s.creativeId&&paused(ad));
  return {...s,assetBytesVerified:false as const,verifiedAt:new Date().toISOString()};
 }catch(e){if(e instanceof MetaAdBundleError)throw e;throw new MetaAdBundleError('unknown','외부 구성을 확인하지 못했습니다. 저장된 검증을 해제했으니 다시 조회하세요.')}
}
