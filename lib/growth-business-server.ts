import type {Campaign} from './agency';
import type {Store} from './store-marketing';
import {ledgerSummary,orderCostFields,recentPeriod,type StoreOrder} from './store-operations';
import {ApiError,database,readRecord} from './server';

const unmeasured={records:null,orders:null,netRevenue:null,contributionBeforeMarketing:null,contribution:null,cash:null,incrementality:'not_measured' as const,reconciliation:'not_verified' as const};
const validDay=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
// Only campaign-linked ledger rows; totals are observations, never a claim of AI causality.
export async function growthBusiness(owner:string,c:Campaign){
 const recent=recentPeriod(),period={from:c.startDate||recent.from,to:c.endDate||recent.to};
 if(!c.storeId)return {...unmeasured,status:'not_measured' as const,period,reason:'주문 장부의 지점을 먼저 연결하세요.'};
 if(!validDay(period.from)||!validDay(period.to)||period.from>period.to)return {...unmeasured,status:'unavailable' as const,period,reason:'캠페인 집계 기간을 확인하세요.'};
 let store:Store;
 try{store=await readRecord<Store>(owner,'store',c.storeId)}catch(e){if(e instanceof ApiError&&e.status===404)return {...unmeasured,status:'unavailable' as const,period,reason:'연결 지점을 찾지 못했습니다.'};throw e}
 if(store.brandId!==c.brandId)return {...unmeasured,status:'unavailable' as const,period,reason:'현재 브랜드의 지점을 연결하세요.'};
 const result=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND json_extract(data,'$.campaignId')=? AND json_extract(data,'$.orderDate')>=? AND json_extract(data,'$.orderDate')<=? LIMIT 10001").bind(owner,c.storeId,c.id,period.from,period.to).all<{data:string}>();
 if(result.results.length>10000)return {...unmeasured,status:'unavailable' as const,period,reason:'집계 한도를 넘었습니다. 캠페인 기간을 줄여 다시 확인하세요.'};
 const orders=result.results.map(r=>JSON.parse(r.data) as StoreOrder);
 const valid=orders.every(o=>o.storeId===c.storeId&&o.campaignId===c.id&&Number.isSafeInteger(o.paidAmount)&&Number.isSafeInteger(o.refundAmount)&&o.paidAmount>=o.refundAmount&&o.refundAmount>=0&&o.costs&&Object.keys(orderCostFields).every(k=>{const v=o.costs[k as keyof typeof orderCostFields];return v===null||(Number.isSafeInteger(v)&&v>=0)}));
 if(!valid)return {...unmeasured,status:'unavailable' as const,period,reason:'주문 금액·원가 기록을 확인하세요.'};
 const summary=ledgerSummary(orders,[]);
 if(!Number.isSafeInteger(summary.netRevenue)||(summary.contribution!==null&&!Number.isSafeInteger(summary.contribution)))return {...unmeasured,status:'unavailable' as const,period,reason:'집계 금액 범위를 확인하세요.'};
 return {...unmeasured,status:'ledger_only' as const,period,records:summary.records,orders:summary.orders,netRevenue:summary.netRevenue,contributionBeforeMarketing:summary.contribution,reason:'이 캠페인에 연결된 주문 장부 기준입니다. 광고·제작비 배분, 정산 대사와 현금 수령은 별도 확인이 필요합니다.'};
}
