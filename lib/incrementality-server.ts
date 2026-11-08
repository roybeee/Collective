// 캠페인 증분 결과 계산·저장(C7). 장부 일별 합계(ledgerDays)만 읽고 순수 계산(lib/incrementality.ts)을 돌려 캠페인당 1행(incrementality_result)으로 남긴다.
// 모델 호출·외부 호출 없음. 결과에는 '관찰 비교이며 인과 증명이 아닙니다' 라벨이 항상 들어 있다.
import type {Campaign} from './agency';
import type {Store} from './store-marketing';
import {koreaToday} from './store-operations';
import {ledgerDays} from './store-operations-server';
import {addDays,computeIncrementality,isDay,MAX_PERIOD_DAYS,MAX_STORES,type DailyNet,type IncrementalityRecord} from './incrementality';
import {ApiError,readRecord,recordStatement,stamp,type Actor} from './server';

const ID=/^[A-Za-z0-9_-]{1,100}$/,bad=(m:string)=>new ApiError(400,m);
const campaignIdOf=(v:unknown)=>{if(typeof v!=='string'||!ID.test(v))throw bad('캠페인을 확인하세요.');return v};
function storeIds(value:unknown,label:string,fallback:string[]):string[]{
 if(value===undefined)return fallback;
 if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!ID.test(v)))throw bad(`${label} 매장 목록을 확인하세요.`);
 const ids=[...new Set(value as string[])];if(ids.length>MAX_STORES)throw bad(`${label} 매장은 ${MAX_STORES}곳까지입니다.`);return ids;
}
function period(b:Record<string,unknown>,campaign:Campaign,today:string){
 const start=b.periodStart??campaign.startDate,end=b.periodEnd??campaign.endDate;
 if(!isDay(start)||!isDay(end)||start>end)throw bad('캠페인 기간(시작일·종료일)을 확인하세요.');
 if(end>today)throw bad('종료일은 오늘까지입니다. 끝난 기간만 비교합니다.');
 const days=Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;if(days>MAX_PERIOD_DAYS)throw bad(`캠페인 기간은 ${MAX_PERIOD_DAYS}일까지입니다.`);
 return {start,end,days};
}
async function checkedStores(owner:string,brandId:string,ids:readonly string[]){
 for(const id of ids){const store=await readRecord<Store>(owner,'store',id);if(store.brandId!==brandId)throw bad('다른 브랜드의 지점은 비교할 수 없습니다.')}
}
export async function readIncrementality(owner:string,campaignId:unknown):Promise<IncrementalityRecord|null>{
 try{return await readRecord<IncrementalityRecord>(owner,'incrementality_result',campaignIdOf(campaignId))}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}
}
export async function computeCampaignIncrementality(who:Actor,b:Record<string,unknown>):Promise<IncrementalityRecord>{
 const owner=who.owner,campaignId=campaignIdOf(b.campaignId),campaign=await readRecord<Campaign>(owner,'campaign',campaignId),today=koreaToday();
 const {start,end,days}=period(b,campaign,today);
 const treated=storeIds(b.treatedStoreIds,'대상',campaign.storeId?[campaign.storeId]:[]),control=storeIds(b.controlStoreIds,'대조',[]);
 if(treated.some(s=>control.includes(s)))throw bad('같은 매장을 대상과 대조에 함께 넣을 수 없습니다.');
 await checkedStores(owner,campaign.brandId,[...treated,...control]);
 const preStart=addDays(start,-days);
 const daily:DailyNet[]=(await Promise.all([...treated,...control].map(async storeId=>(await ledgerDays(owner,storeId,preStart,end)).map(d=>({storeId,day:d.day,net:d.net}))))).flat();
 const result=computeIncrementality({periodStart:start,periodEnd:end,treatedStoreIds:treated,controlStoreIds:control,daily});
 const previous=await readIncrementality(owner,campaignId);
 const record:IncrementalityRecord={id:campaignId,campaignId,brandId:campaign.brandId,periodStart:start,periodEnd:end,treatedStoreIds:treated,controlStoreIds:control,result,computedAt:stamp(),computedBy:{id:who.id,email:who.email},version:(previous?.version??0)+1};
 await recordStatement(owner,'incrementality_result',campaignId,record,campaignId).run();
 return record;
}
