import type {Campaign} from './agency';
import type {MetaInsightReport} from './meta-insights';
import {metaWindow,summarizeMetaInsights} from './meta-insights';
import {campaignAttribution} from './campaign-attribution';
import {optionalRecord} from './execution-server';
import {ApiError,database,listRecords} from './server';
import {koreaToday,recentPeriod,type StoreOrder} from './store-operations';
import type {Store} from './store-marketing';
import {orderMetrics} from './store-attribution';
import {storefrontDigest} from './storefront-orders';
export const META_REPORT_DEFINITION='meta-reconciliation-v1';
export type MetaPerformanceSnapshot={id:string;campaignId:string;version:number;capturedAt:string;capturedBy:string;digest:string;report:MetaPerformanceReport};
export type MetaPerformanceReport=Awaited<ReturnType<typeof metaPerformanceReport>>;
export async function metaPerformanceReport(owner:string,c:Campaign,requested:{since?:unknown;until?:unknown}){
 const insight=await optionalRecord<MetaInsightReport>(owner,'meta_ads_insights',c.id),recent=recentPeriod();
 const period=metaWindow({since:requested.since??insight?.since??recent.from,until:requested.until??insight?.until??recent.to});
 if(period.until>koreaToday())throw new ApiError(400,'미래 날짜는 집계할 수 없습니다.');
 const stores=(await listRecords<Store>(owner,'store',c.brandId)).filter(s=>!c.storeId||s.id===c.storeId),ids=new Set(stores.map(s=>s.id));
 // Bound the entire workspace read, then reject unrelated stores. Never return raw customer/order fields.
 const raw=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND json_extract(data,'$.orderDate')>=? AND json_extract(data,'$.orderDate')<=? LIMIT 5001").bind(owner,period.since,period.until).all<{data:string}>();
 if(raw.results.length>5000)throw new ApiError(400,'조회할 주문이 5,000건을 넘습니다. 기간을 좁혀 주세요.');
 const orders=raw.results.map(r=>JSON.parse(r.data) as StoreOrder).filter(o=>ids.has(o.storeId)),ledger=orderMetrics(orders);
 const attributed=await campaignAttribution(owner,c,{from:period.since,to:period.until});
 const covered=!!insight&&insight.since<=period.since&&insight.until>=period.until;
 const meta=covered?summarizeMetaInsights(insight.rows.filter(r=>r.date>=period.since&&r.date<=period.until)):null;
 const sinceCollection=insight?Date.now()-Date.parse(insight.collectedAt):null;
 const days=insight?.attribution==='1d_click'?1:7;
 const matured=!!insight&&Date.parse(insight.collectedAt)>=Date.parse(period.until+'T23:59:59+09:00')+days*86400000;
 const warnings=[
  '장부는 입력된 주문만 집계합니다. 전체 매출의 완전성이나 POS 대조 완료를 뜻하지 않습니다.',
  '캠페인 귀속에는 다른 채널도 포함될 수 있습니다. Meta 귀속과 같지 않으며 광고로 늘어난 증분 매출도 아닙니다.',
  '금액은 기록 원문 기준입니다. 부가세 기준 일치가 확인되지 않아 자료 간 비율이나 순이익을 계산하지 않습니다.',
  ...(!covered?['선택 기간 전체를 포함하는 Meta 성과가 없습니다. 누락 기간을 0으로 채우지 않았습니다.']:[]),
  ...(insight&&insight.campaignVersion!==c.version?['Meta 성과 수집 후 캠페인이 변경되었습니다. 연결 범위를 재확인하세요.']:[]),
  ...(insight&&sinceCollection!==null&&sinceCollection>86400000?['Meta 성과가 24시간 이상 갱신되지 않았습니다. 최신 자료인지 확인하세요.']:[]),
  ...(insight&&!matured?['Meta 전환 인정 기간이 지난 뒤 수집한 자료가 아닙니다. 지연 전환 반영을 기다려야 합니다.']:[]),
  ...(period.until===koreaToday()?['오늘은 아직 끝나지 않아 당일 수치가 추가될 수 있습니다.']:[]),
  ...(ledger.unknownCostOrders?[`원가 미입력 주문 ${ledger.unknownCostOrders}건: 공헌이익은 미확인입니다.`]:[]),
  ...attributed.notes.filter(n=>n.startsWith('게시 관문 밖')||n.includes('밖 주문'))
 ];
 const basis={definition:META_REPORT_DEFINITION,campaignVersion:c.version,period,storeRefs:stores.map(s=>({id:s.id,version:s.version})).sort((a,b)=>a.id.localeCompare(b.id)),orderRefs:orders.map(o=>({id:o.id,version:o.version})).sort((a,b)=>a.id.localeCompare(b.id)),insightRef:insight?{version:insight.version,digest:insight.digest}:null,attribution:attributed.totals,excluded:attributed.excluded};
 return {definition:META_REPORT_DEFINITION,period,currency:'KRW' as const,timeZone:'Asia/Seoul' as const,taxBasis:'unverified' as const,campaign:{id:c.id,title:c.title,version:c.version},stores:stores.map(s=>({id:s.id,name:s.name})),meta:meta?{...meta,source:insight!.source,collectedAt:insight!.collectedAt,attribution:insight!.attribution,accountId:insight!.accountId,externalCampaignId:insight!.externalCampaignId,version:insight!.version,matured}:null,ledger:stores.length?{...ledger,scope:'store_all_channels' as const}:null,attributed:stores.length?attributed.totals:null,incrementalRevenue:null,netProfit:null,decision:'insufficient_evidence' as const,warnings,basisDigest:await storefrontDigest(basis)};
}
export function reportDifference(a:MetaPerformanceReport,b:MetaPerformanceReport){if(a.period.since!==b.period.since||a.period.until!==b.period.until)return null;const delta=(x:number|null|undefined,y:number|null|undefined)=>typeof x==='number'&&typeof y==='number'?y-x:null;return {metaValueMinor:delta(a.meta?.purchaseValueMinor,b.meta?.purchaseValueMinor),ledgerRevenue:delta(a.ledger?.netRevenue,b.ledger?.netRevenue),attributedRevenue:delta(a.attributed?.netRevenue,b.attributed?.netRevenue)}}
