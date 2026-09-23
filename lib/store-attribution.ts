// 점포 귀속 집계(A4). 순수 모듈: 추적 코드 자동 귀속 규칙, 코드·팔(arm)·캠페인·출처별 집계와 단위경제, 주간 완전성 검사, north-star, incrementality-lite.
// 귀속≠증분: 여기 숫자는 '어느 코드로 들어온 주문인가'이지 '캠페인이 없었다면 없었을 주문'이 아니다. 화면·보고서에 늘 함께 적는다.
// north-star(docs/GROWTH-PLAN.ko.md KPI): 귀속 근거가 있는 주간 주문·공헌이익. POS 합계 대조(허용 오차 1%)를 통과한 주만 센다.
import {orderContribution,orderSources,type StoreOrder,type StoreSpend} from './store-operations';
import {channelCatalog} from './store-marketing';
import {matchCode,trackingCodeTypes,type CodeToken,type TrackingCode} from './tracking-codes';

export const ATTRIBUTION_NOT_INCREMENTAL='귀속≠증분: 추적 코드로 귀속된 주문은 캠페인이 없었어도 생겼을 수 있습니다. 귀속 수치는 캠페인의 인과 효과를 증명하지 않습니다.';
export const COMPLETENESS_TOLERANCE=0.01;
// 원가를 적지 않은 주문의 변동비를 순매출 대비 비율로 추정할 때 쓰는 입력(0~1). 추정한 주문 수를 함께 돌려준다.
export type Economics={variableCostRate:number};
// 주간 POS 합계(매장 POS가 낸 그 주 순매출·주문 수). 장부 완전성 대조의 기준이다.
export type PosWeeklyTotal={id:string;storeId:string;weekStart:string;netSales:number;orderCount:number|null;source:string;note:string;version:number;createdAt:string;updatedAt:string;updatedBy:{id:string;email:string|null}};

const sum=(values:readonly number[])=>values.reduce((n,v)=>n+v,0);
const money=(n:number)=>Math.round(n*100)/100;
const ratio=(n:number)=>Math.round(n*10000)/10000;

// 1) 자동 귀속: 셀에 나온 순서대로 첫 유효 코드(같은 지점, 적용 시작일 이후)를 쓴다. 다른 대상(캠페인·소재·게시·팔)을 가리키는 유효 코드가 함께 있으면 충돌로 표시한다.
const target=(c:TrackingCode)=>[c.campaignId,c.creativeId||'',c.publicationId||'',c.arm||''].join('\u0000');
export function attributeByCodes(tokens:readonly CodeToken[],codes:readonly TrackingCode[],order:{storeId:string;orderDate:string}){
 const found=tokens.map(token=>({token,code:matchCode(token,codes)})),hits=found.flatMap(f=>f.code?[f.code]:[]);
 const eligible=(c:TrackingCode)=>c.storeId===order.storeId&&c.validFrom<=order.orderDate,valid=hits.filter(eligible),first=valid[0]||null;
 return {code:first,conflict:!!first&&valid.some(c=>target(c)!==target(first)),matched:valid.map(c=>c.id),skipped:hits.filter(c=>!eligible(c)).map(c=>c.id),unknown:found.filter(f=>!f.code).map(f=>f.token.code)};
}

// 2) 지표. 주문 수·귀속 판단은 lib/store-operations.ts ledgerSummary와 같은 기준이다.
export const countedOrder=(o:StoreOrder)=>o.status==='paid'&&(o.paidAmount===0||o.refundAmount<o.paidAmount);
export const isAttributed=(o:StoreOrder)=>countedOrder(o)&&(o.channel!=='unknown'||!!o.campaignId||!!o.creativeId);
export type Metrics={records:number;orders:number;netRevenue:number;contribution:number|null;estimatedOrders:number;unknownCostOrders:number;newCustomers:number|null};
// 공헌이익: 원가가 모두 적힌 주문은 그대로, 없으면 경제성 입력으로 추정, 둘 다 없으면 묶음 전체가 null이다.
// 신규 고객: 센 주문 모두에 신규 여부가 있어야 센다. 하나라도 모르면 null.
export function orderMetrics(orders:readonly StoreOrder[],economics?:Economics):Metrics{
 const counted=orders.filter(countedOrder),parts=orders.map(o=>{const known=orderContribution(o);return known!==null?{value:known,kind:'known'}:economics?{value:(o.paidAmount-o.refundAmount)*(1-economics.variableCostRate),kind:'estimated'}:{value:0,kind:'unknown'}});
 const unknownCostOrders=parts.filter(p=>p.kind==='unknown').length,flags=counted.map(o=>o.newCustomer);
 return {records:orders.length,orders:counted.length,netRevenue:money(sum(orders.map(o=>o.paidAmount-o.refundAmount))),contribution:unknownCostOrders?null:money(sum(parts.map(p=>p.value))),estimatedOrders:parts.filter(p=>p.kind==='estimated').length,unknownCostOrders,newCustomers:flags.some(f=>typeof f!=='boolean')?null:flags.filter(Boolean).length};
}
export type Group=Metrics&{key:string;label:string};
function groupBy(orders:readonly StoreOrder[],keyOf:(o:StoreOrder)=>string|null,labelOf:(key:string)=>string,economics?:Economics):Group[]{
 const keys=[...new Set(orders.map(keyOf).filter((k):k is string=>k!==null))];
 return keys.map(key=>({key,label:labelOf(key),...orderMetrics(orders.filter(o=>keyOf(o)===key),economics)})).sort((a,b)=>b.orders-a.orders||b.netRevenue-a.netRevenue);
}
// 3) 코드·팔·소재·캠페인별 집계. 코드·팔은 코드로 자동 귀속된 주문만, 소재는 소재가 연결된 주문(수동·자동), 캠페인은 수동 귀속과 미귀속(key '')까지 함께 보인다.
// 소재에는 사람이 읽을 제목이 아직 없어(lib/execution.ts) 키는 `${campaignId}·${creativeId}`이고 화면이 캠페인 제목을 붙인다.
export function attributionBreakdown(orders:readonly StoreOrder[],codes:readonly TrackingCode[],economics?:Economics){
 const codeLabel=(id:string)=>{const c=codes.find(x=>x.id===id);return c?[c.code,trackingCodeTypes[c.type],c.label].filter(Boolean).join(' · '):id};
 const armKey=(o:StoreOrder)=>o.codeAttribution?`${o.campaignId||''}·${o.codeAttribution.arm||'팔 없음'}`:null;
 return {
  byCode:groupBy(orders,o=>o.codeAttribution?.codeId??null,codeLabel,economics),
  byArm:groupBy(orders,armKey,key=>key.replace('·',' · '),economics),
  byCreative:groupBy(orders,o=>o.creativeId?`${o.campaignId||''}·${o.creativeId}`:null,key=>key.replace('·',' · 소재 '),economics),
  byCampaign:groupBy(orders,o=>o.campaignId||'',key=>key||'미귀속',economics),
 };
}
// 4) 출처별 단위경제. 광고비·제작비는 같은 유입 채널의 비용 장부에서만 붙인다(코드·캠페인 단위 비용 장부는 아직 없다). 주문 출처(플랫폼)에는 비용을 붙이지 않는다.
export type ChannelEconomics=Group&{adSpend:number|null;productionCost:number|null;spendTotal:number|null;contributionAfterSpend:number|null;costPerOrder:number|null;costPerNewCustomer:number|null;revenuePerSpend:number|null};
const channelName=(key:string)=>key==='unknown'?'유입 미확인':channelCatalog.find(c=>c.key===key)?.name||key;
export function unitEconomics(orders:readonly StoreOrder[],spend:readonly StoreSpend[],economics?:Economics){
 const keys=[...new Set<string>([...orders.map(o=>o.channel),...spend.map(s=>s.channel)])];
 const byChannel:ChannelEconomics[]=keys.map(key=>{
  const m=orderMetrics(orders.filter(o=>o.channel===key),economics),rows=spend.filter(s=>s.channel===key),adSpend=money(sum(rows.map(s=>s.adSpend))),productionCost=money(sum(rows.map(s=>s.productionCost))),spendTotal=money(adSpend+productionCost);
  return {key,label:channelName(key),...m,adSpend,productionCost,spendTotal,contributionAfterSpend:m.contribution===null?null:money(m.contribution-spendTotal),costPerOrder:spendTotal>0&&m.orders>0?money(spendTotal/m.orders):null,costPerNewCustomer:spendTotal>0&&m.newCustomers?money(spendTotal/m.newCustomers):null,revenuePerSpend:spendTotal>0?ratio(m.netRevenue/spendTotal):null};
 }).sort((a,b)=>b.orders-a.orders||(b.spendTotal??0)-(a.spendTotal??0));
 const bySource:ChannelEconomics[]=groupBy(orders,o=>o.source,key=>orderSources[key as keyof typeof orderSources]||key,economics).map(g=>({...g,adSpend:null,productionCost:null,spendTotal:null,contributionAfterSpend:null,costPerOrder:null,costPerNewCustomer:null,revenuePerSpend:null}));
 return {byChannel,bySource};
}

// 5) 주: 월요일 시작, 한국 날짜 문자열(YYYY-MM-DD) 기준.
export const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export const weekStart=(date:string)=>addDays(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
export function weeksBetween(from:string,to:string){if(from>to)return [];const first=weekStart(from),count=Math.floor((Date.parse(to)-Date.parse(first))/(7*86400000))+1;return Array.from({length:count},(_,i)=>addDays(first,i*7))}
export type WeekCheck={weekStart:string;weekEnd:string;ledgerNet:number;ledgerOrders:number;posNet:number|null;posOrders:number|null;posVersion:number|null;diffRate:number|null;status:'pass'|'fail'|'missing_pos';reason:string;attributedOrders:number;attributedContribution:number|null};
const within=(value:number,expected:number,tolerance:number)=>expected===0?value===0:Math.abs(value-expected)<=expected*tolerance;
const won=(n:number)=>n.toLocaleString('ko-KR');
// 하루 단위 장부 합계. 주간 완전성·north-star·incrementality-lite는 주문 행 대신 이 합계로 판정한다.
// 서버는 같은 정의(countedOrder·isAttributed·orderContribution)를 SQL로 계산해 주문 행을 읽지 않는다(lib/store-operations-server.ts ledgerDays).
export type DayTotal={day:string;net:number;orders:number;attributedOrders:number;attributedKnown:number;attributedUnknown:number;attributedUnknownNet:number};
export function dayTotals(orders:readonly StoreOrder[]):DayTotal[]{
 const days=[...new Set(orders.map(o=>o.orderDate))];
 return days.map(day=>{
  const list=orders.filter(o=>o.orderDate===day),net=(o:StoreOrder)=>o.paidAmount-o.refundAmount,attributed=list.filter(isAttributed),unknown=attributed.filter(o=>orderContribution(o)===null);
  return {day,net:sum(list.map(net)),orders:list.filter(countedOrder).length,attributedOrders:attributed.length,attributedKnown:sum(attributed.map(o=>orderContribution(o)??0)),attributedUnknown:unknown.length,attributedUnknownNet:sum(unknown.map(net))};
 });
}
// 장부의 그 주 전체 주문(모든 주문 출처)의 순매출과 주문 수를 POS 합계와 대조한다. POS 합계가 없으면 통과로 보지 않는다. posVersion은 합계를 고칠 때 보낼 버전이다.
export function weeklyCompleteness(weeks:readonly string[],orders:readonly StoreOrder[],posTotals:readonly PosWeeklyTotal[],economics?:Economics,tolerance=COMPLETENESS_TOLERANCE):WeekCheck[]{
 return weeklyCompletenessFromDays(weeks,dayTotals(orders),posTotals,economics,tolerance);
}
export function weeklyCompletenessFromDays(weeks:readonly string[],days:readonly DayTotal[],posTotals:readonly PosWeeklyTotal[],economics?:Economics,tolerance=COMPLETENESS_TOLERANCE):WeekCheck[]{
 const pct=`${ratio(tolerance*100)}%`;
 return weeks.map(start=>{
  const end=addDays(start,6),inWeek=days.filter(d=>d.day>=start&&d.day<=end),total=(key:Exclude<keyof DayTotal,'day'>)=>sum(inWeek.map(d=>d[key])),pos=posTotals.find(p=>p.weekStart===start);
  const ledgerNet=money(total('net')),ledgerOrders=total('orders'),attributedContribution=total('attributedUnknown')&&!economics?null:money(total('attributedKnown')+total('attributedUnknownNet')*(1-(economics?.variableCostRate??0)));
  const base={weekStart:start,weekEnd:end,ledgerNet,ledgerOrders,attributedOrders:total('attributedOrders'),attributedContribution};
  if(!pos)return {...base,posNet:null,posOrders:null,posVersion:null,diffRate:null,status:'missing_pos',reason:'POS 합계를 입력하지 않아 대조하지 못했습니다.'};
  const netOk=within(ledgerNet,pos.netSales,tolerance),countOk=pos.orderCount===null||within(ledgerOrders,pos.orderCount,tolerance);
  const diffRate=pos.netSales===0?(ledgerNet===0?0:null):ratio(Math.abs(ledgerNet-pos.netSales)/pos.netSales);
  const reason=!netOk?`장부 순매출이 POS 합계와 ${pct}를 넘게 다릅니다(장부 ${won(ledgerNet)}원 · POS ${won(pos.netSales)}원).`:!countOk?`장부 주문 수가 POS 주문 수와 ${pct}를 넘게 다릅니다(장부 ${ledgerOrders}건 · POS ${pos.orderCount}건).`:`POS 합계와 ${pct} 이내로 맞습니다.`;
  return {...base,posNet:pos.netSales,posOrders:pos.orderCount,posVersion:pos.version,diffRate,status:netOk&&countOk?'pass':'fail',reason};
 });
}
// 6) north-star: 대조를 통과한 주의 귀속 주문·공헌이익만 더한다. 통과한 주가 없으면 측정하지 않은 것(measured=false)이다.
export function northStar(checks:readonly Pick<WeekCheck,'weekStart'|'status'|'attributedOrders'|'attributedContribution'>[]){
 const passed=checks.filter(c=>c.status==='pass');
 return {measured:passed.length>0,weeks:passed.map(c=>c.weekStart),passedWeeks:passed.length,excludedWeeks:checks.length-passed.length,attributedOrders:sum(passed.map(c=>c.attributedOrders)),attributedContribution:!passed.length||passed.some(c=>c.attributedContribution===null)?null:money(sum(passed.map(c=>c.attributedContribution??0)))};
}
// 7) incrementality-lite: 대조를 통과한 기준 주 평균 대비 캠페인 주 평균의 변화. 인과 추정이 아니라 전후 비교이며 경고를 함께 낸다.
type WeekValue=Pick<WeekCheck,'weekStart'|'status'|'ledgerOrders'|'ledgerNet'|'attributedOrders'>;
export function incrementalityLite(checks:readonly WeekValue[],baselineWeeks:readonly string[],campaignWeeks:readonly string[],metric:'orders'|'netRevenue'='orders'){
 const byWeek=new Map(checks.map(c=>[c.weekStart,c])),passed=(weeks:readonly string[])=>weeks.flatMap(w=>{const c=byWeek.get(w);return c?.status==='pass'?[c]:[]});
 const base=passed(baselineWeeks),camp=passed(campaignWeeks),excluded=[...baselineWeeks,...campaignWeeks].filter(w=>byWeek.get(w)?.status!=='pass');
 const value=(c:WeekValue)=>metric==='orders'?c.ledgerOrders:c.ledgerNet,average=(list:readonly WeekValue[])=>list.length?money(sum(list.map(value))/list.length):null;
 const baseline=average(base),campaign=average(camp),change=baseline===null||campaign===null?null:money(campaign-baseline),attributedOrders=sum(camp.map(c=>c.attributedOrders));
 const warnings=[
  ...(base.length<2?['기준 주가 2주 미만입니다. 평소 주간 변동과 구분하기 어렵습니다.']:[]),
  ...(excluded.length?[`POS 합계 대조를 통과하지 못했거나 합계가 없는 ${excluded.length}주는 뺐습니다.`]:[]),
  ...(metric==='orders'&&change!==null&&attributedOrders>change*camp.length?[`귀속 주문 ${attributedOrders}건이 기준 대비 증가분(${money(change*camp.length)}건)보다 많습니다. 귀속 주문 일부는 캠페인이 없어도 있었을 주문입니다.`]:[]),
  '계절·날씨·휴일·다른 판촉의 영향을 분리하지 않은 단순 전후 비교입니다.',
 ];
 return {metric,baseline:{weeks:base.map(c=>c.weekStart),average:baseline},campaign:{weeks:camp.map(c=>c.weekStart),average:campaign,attributedOrders},change,changeRate:change===null||!baseline?null:ratio(change/baseline),excluded,warnings,disclaimer:ATTRIBUTION_NOT_INCREMENTAL};
}
