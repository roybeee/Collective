import type {VerifiedMetaAdBundleScope} from './meta-ad-bundle';
import {META_READ_API_VERSION} from './meta-insights-provider';
import {readBoundedJson} from './http-limits';
import {metaId} from './meta-insights';
import {krwGraphBudget} from './meta-execution';
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export class MetaExecutionError extends Error{constructor(public code:'mismatch'|'unknown',message:string){super(message)}}
function tokenValue(token:string){if(typeof token!=='string'||token.length<10||token.length>4096||! /^[A-Za-z0-9_.|\-]+$/.test(token))throw new MetaExecutionError('mismatch','같은 광고 계정의 현재 쓰기 연결이 필요합니다.');return token}
async function get(token:string,path:string,params:Record<string,string>){const url=new URL(`https://graph.facebook.com/${META_READ_API_VERSION}/${path}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const r=await fetch(url.toString(),{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+tokenValue(token)},signal:AbortSignal.timeout(4000)}),v=object(await readBoundedJson(r,300000));if(!r.ok||v.error)throw new MetaExecutionError('unknown','외부 상태 조회를 확인하지 못했습니다.');return v}
function match(v:boolean){if(!v)throw new MetaExecutionError('mismatch','승인한 광고 계보·구성·예산 단위가 외부 상태와 다릅니다.')}
function same(a:unknown,b:unknown):boolean{if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));if(a&&b&&typeof a==='object'&&typeof b==='object'){const x=object(a),y=object(b);return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>same(x[k],y[k]))}return a===b}
export async function readExecutionHierarchy(token:string,s:VerifiedMetaAdBundleScope,strict=true){
 const accountId=metaId(s.accountId,'계정'),campaignId=metaId(s.campaignId,'캠페인'),adsetId=metaId(s.adsetId,'광고세트'),adId=metaId(s.adId,'광고'),creativeId=metaId(s.creativeId,'소재');
 const [account,campaign,set,ad,creative,sets,ads]=await Promise.all([get(token,'act_'+accountId,{fields:'account_id,currency,timezone_name,account_status'}),get(token,campaignId,{fields:'id,name,account_id,objective,configured_status,effective_status,daily_budget,lifetime_budget'}),get(token,adsetId,{fields:'id,account_id,campaign_id,configured_status,effective_status,daily_budget,lifetime_budget,billing_event,optimization_goal,destination_type,start_time,end_time,promoted_object,targeting'}),get(token,adId,{fields:'id,account_id,campaign_id,adset_id,configured_status,effective_status,creative'}),strict?get(token,creativeId,{fields:'id,account_id,object_story_spec,asset_feed_spec,object_story_id,url_tags,degrees_of_freedom_spec'}):Promise.resolve({} as Record<string,unknown>),strict?get(token,campaignId+'/adsets',{fields:'id',limit:'2'}):Promise.resolve({} as Record<string,unknown>),strict?get(token,adsetId+'/ads',{fields:'id',limit:'2'}):Promise.resolve({} as Record<string,unknown>)]);
 match(account.account_id===accountId&&account.currency==='KRW'&&account.timezone_name==='Asia/Seoul');
 match(campaign.id===campaignId&&campaign.account_id===accountId&&set.id===adsetId&&set.account_id===accountId&&set.campaign_id===campaignId&&ad.id===adId&&ad.account_id===accountId&&ad.campaign_id===campaignId&&ad.adset_id===adsetId);
 if(strict){
  match(account.account_status===1&&campaign.objective==='OUTCOME_SALES'&&typeof campaign.name==='string'&&campaign.name.endsWith(`[Collective ${s.operationId}]`));
  match([undefined,'0',0].includes(campaign.daily_budget as number|string|undefined)&&[undefined,'0',0].includes(campaign.lifetime_budget as number|string|undefined));
  match(set.daily_budget===s.graphDailyBudget&&[undefined,'0',0].includes(set.lifetime_budget as number|string|undefined));
  match(set.billing_event==='IMPRESSIONS'&&set.optimization_goal==='OFFSITE_CONVERSIONS'&&set.destination_type==='WEBSITE'&&Date.parse(String(set.start_time))===Date.parse(s.startAt)&&Date.parse(String(set.end_time))===Date.parse(s.endAt));
  match(same(set.promoted_object,{pixel_id:s.pixelId,custom_event_type:'PURCHASE'})&&same(set.targeting,{geo_locations:{countries:['KR']},age_min:s.ageMin,age_max:s.ageMax}));
  match(creative.id===creativeId&&creative.account_id===accountId&&object(ad.creative).id===creativeId&&!creative.asset_feed_spec&&!creative.object_story_id&&!creative.url_tags&&!creative.degrees_of_freedom_spec);
  match(same(creative.object_story_spec,{page_id:s.pageId,link_data:{link:s.landingUrl,name:s.hook,message:s.body,image_hash:s.expectedMetaImageHash,call_to_action:{type:s.callToActionType,value:{link:s.landingUrl}}}}));
  match(same(sets.data,[{id:adsetId}])&&!object(sets.paging).next&&same(ads.data,[{id:adId}])&&!object(ads.paging).next);
 }
 const statuses={campaign:String(campaign.configured_status),adset:String(set.configured_status),ad:String(ad.configured_status)};match(Object.values(statuses).every(v=>v==='ACTIVE'||v==='PAUSED'));return statuses;
}
function spendValue(raw:unknown){if(typeof raw!=='string'||! /^\d+(?:\.\d{1,2})?$/.test(raw)||!Number.isSafeInteger(Math.ceil(Number(raw))))throw new MetaExecutionError('unknown','광고비 원화 값을 확인하지 못했습니다.');return Math.ceil(Number(raw))}
export async function readExecutionSpend(token:string,s:VerifiedMetaAdBundleScope){
 async function read(datePreset:string){const data=await get(token,metaId(s.adsetId,'광고세트')+'/insights',{fields:'account_id,adset_id,account_currency,spend',date_preset:datePreset,level:'adset',limit:'2'});if(!Array.isArray(data.data)||data.data.length>1||object(data.paging).next)throw new MetaExecutionError('unknown','광고비 집계 범위를 확인하지 못했습니다.');if(!data.data.length)return 0;const row=object(data.data[0]);match(row.account_id===s.accountId&&row.adset_id===s.adsetId&&row.account_currency==='KRW');return spendValue(row.spend)}
 const [totalSpend,dailySpend]=await Promise.all([read('maximum'),read('today')]);match(totalSpend>=dailySpend);return {totalSpend,dailySpend};
}
export async function writeExecutionStatus(token:string,id:string,status:'ACTIVE'|'PAUSED'){
 if(status!=='ACTIVE'&&status!=='PAUSED')throw new MetaExecutionError('mismatch','지원하지 않는 외부 상태입니다.');const form=new URL('https://graph.facebook.com').searchParams;form.set('status',status);
 const r=await fetch(`https://graph.facebook.com/${META_READ_API_VERSION}/${metaId(id,'광고 객체')}`,{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+tokenValue(token),'content-type':'application/x-www-form-urlencoded'},body:form.toString(),signal:AbortSignal.timeout(4000)}),v=object(await readBoundedJson(r,100000));if(!r.ok||v.error||v.success!==true)throw new MetaExecutionError('unknown','외부 상태 변경 결과를 확인하지 못했습니다.');
}

export async function verifyExecutionCurrency(token:string,s?:Pick<VerifiedMetaAdBundleScope,'dailyBudgetKrw'|'graphDailyBudget'>){const v=await get(token,'me',{fields:'currency'}),c=object(v.currency);match(c.user_currency==='KRW'&&typeof c.currency_offset==='number'&&Number.isSafeInteger(c.currency_offset)&&c.currency_offset>0);const offset=c.currency_offset as number;if(s)match(s.graphDailyBudget===krwGraphBudget(s.dailyBudgetKrw,offset));return {currency:'KRW' as const,offset};}
