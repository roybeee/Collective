// 점포 귀속 집계(A4). 순수 모듈: 추적 코드 자동 귀속 규칙, 코드·팔(arm)·캠페인·출처별 집계와 단위경제, 주간 완전성 검사, north-star, incrementality-lite.
// 귀속≠증분: 여기 숫자는 '어느 코드로 들어온 주문인가'이지 '캠페인이 없었다면 없었을 주문'이 아니다. 화면·보고서에 늘 함께 적는다.
// north-star(docs/GROWTH-PLAN.ko.md KPI): 귀속 근거가 있는 주간 주문·공헌이익. POS 합계 대조(허용 오차 1%)를 통과한 주만 센다.
import {orderContribution,orderSources,type StoreOrder,type StoreSpend} from './store-operations';
import {channelCatalog} from './store-marketing';
import {matchCode,trackingCodeTypes,type CodeToken,type TrackingCode,type TrackingCodeType} from './tracking-codes';
import {creativeLabel} from './execution';

export const ATTRIBUTION_NOT_INCREMENTAL='귀속≠증분: 추적 코드로 귀속된 주문은 캠페인이 없었어도 생겼을 수 있습니다. 귀속 수치는 캠페인의 인과 효과를 증명하지 않습니다.';
export const COMPLETENESS_TOLERANCE=0.01;
// 원가를 적지 않은 주문의 변동비를 순매출 대비 비율로 추정할 때 쓰는 입력(0~1). 추정한 주문 수를 함께 돌려준다.
export type Economics={variableCostRate:number};
// 주간 POS 합계(매장 POS가 낸 그 주 순매출·주문 수). 장부 완전성 대조의 기준이다.
export type PosWeeklyTotal={id:string;storeId:string;weekStart:string;netSales:number;orderCount:number|null;source:string;note:string;version:number;createdAt:string;updatedAt:string;updatedBy:{id:string;email:string|null}};

const sum=(values:readonly number[])=>values.reduce((n,v)=>n+v,0);
const money=(n:number)=>Math.round(n*100)/100;
const ratio=(n:number)=>Math.round(n*10000)/10000;

// 0) 게시 단위 귀속(A4-2). 게시에 묶인 코드(publicationId)는 그 게시가 예약 접수(accepted)·게시 확인(published)이고 주문일(한국 날짜)이 예약일(한국 날짜) 이후일 때만 귀속한다.
// 게시 상태는 코드를 만들 때가 아니라 귀속할 때 본다. 게시 전에 코드를 만들어 캡션에 넣기 때문이다. 게시 정보가 없으면 귀속하지 않는다(fail closed).
// 거절 사유: before_publication(예약일 전 주문), pending(아직 정해지지 않은 상태라 나중에 예약 접수·게시 확인이 될 수 있음), not_live(취소·발행 실패·삭제 등 끝난 상태).
export const LIVE_PUBLICATION_STATUSES:readonly string[]=['accepted','published'];
export const PENDING_PUBLICATION_STATUSES:readonly string[]=['draft','approved','submitting','uncertain','blocked'];
export type PublicationGate={status:string;scheduledDay:string};
export type PublicationRefusal='before_publication'|'pending'|'not_live';
// ISO 시각을 한국 시각 'YYYY-MM-DD HH:mm'으로 바꾼다(한국은 서머타임이 없어 UTC+9 고정). 읽을 수 없으면 빈 문자열.
export const koreaMinute=(iso:unknown)=>{const t=typeof iso==='string'?Date.parse(iso):NaN;return Number.isFinite(t)?new Date(t+9*3600000).toISOString().slice(0,16).replace('T',' '):''};
export const publicationGate=(p:{status:string;scheduledAt?:unknown}):PublicationGate=>({status:p.status,scheduledDay:koreaMinute(p.scheduledAt).slice(0,10)});
export function publicationRefusal(code:Pick<TrackingCode,'publicationId'>,orderDate:string,publications?:ReadonlyMap<string,PublicationGate>):PublicationRefusal|null{
 if(!code.publicationId)return null;
 const p=publications?.get(code.publicationId);
 if(!p||!p.scheduledDay||![...LIVE_PUBLICATION_STATUSES,...PENDING_PUBLICATION_STATUSES].includes(p.status))return 'not_live';
 if(orderDate<p.scheduledDay)return 'before_publication';
 return LIVE_PUBLICATION_STATUSES.includes(p.status)?null:'pending';
}
// 가져오기 자동 귀속의 근거 문구. 주문 근거가 이 문구 그대로면 사람이 근거를 새로 적지 않은 코드 자동 귀속이다.
export const autoEvidence=(code:Pick<TrackingCode,'code'|'type'>)=>`추적 코드 ${code.code}(${trackingCodeTypes[code.type]}) 자동 귀속 · 주문 CSV`;
const isAutoEvidence=(text:string,code:string)=>(Object.keys(trackingCodeTypes) as TrackingCodeType[]).some(type=>text===autoEvidence({code,type}));
// 게시 관문을 지금 게시 상태로 다시 본 주문. 보고서(귀속 집계)와 주문 기록 수정이 같은 규칙을 쓴다.
// 관문을 통과하거나 게시 코드 귀속이 아니면 같은 객체를 돌려준다. 아니면 코드 귀속 사본을 빼고, 근거가 자동 문구 그대로면(사람이 근거를 적지 않았으면)
// 가져올 때 관문에서 거절한 주문처럼 미귀속(캠페인·소재 없음, 유입 미확인, 근거 없음)으로 되돌린다. 사람이 근거를 적었으면 그 수동 귀속은 둔다.
export function publicationGateView<T extends Pick<StoreOrder,'orderDate'|'codeAttribution'|'campaignId'|'creativeId'|'channel'|'attributionEvidence'>>(order:T,publications:ReadonlyMap<string,PublicationGate>):T{
 const attribution=order.codeAttribution;
 if(!attribution?.publicationId||!publicationRefusal(attribution,order.orderDate,publications))return order;
 return isAutoEvidence(order.attributionEvidence,attribution.code)?{...order,codeAttribution:undefined,campaignId:undefined,creativeId:undefined,channel:'unknown',attributionEvidence:''}:{...order,codeAttribution:undefined};
}

// 1) 자동 귀속: 셀에 나온 순서대로 첫 유효 코드(같은 지점, 적용 시작일 이후, 게시 코드는 게시 관문 통과)를 쓴다. 다른 대상(캠페인·소재·게시·팔)을 가리키는 유효 코드가 함께 있으면 충돌로 표시한다.
// refused: 지점·시작일은 맞지만 게시 관문에서 빠진 코드와 사유(가져오기 결과의 '게시 전 주문'·'취소·발행 실패 게시'·'게시 상태 확인 전' 건수).
const target=(c:TrackingCode)=>[c.campaignId,c.creativeId||'',c.publicationId||'',c.arm||''].join('\u0000');
export function attributeByCodes(tokens:readonly CodeToken[],codes:readonly TrackingCode[],order:{storeId:string;orderDate:string},publications?:ReadonlyMap<string,PublicationGate>){
 const found=tokens.map(token=>({token,code:matchCode(token,codes)})),hits=found.flatMap(f=>f.code?[f.code]:[]);
 const inScope=(c:TrackingCode)=>c.storeId===order.storeId&&c.validFrom<=order.orderDate,refusal=(c:TrackingCode)=>publicationRefusal(c,order.orderDate,publications);
 const eligible=(c:TrackingCode)=>inScope(c)&&!refusal(c),valid=hits.filter(eligible),first=valid[0]||null;
 const refused=hits.filter(inScope).flatMap(c=>{const reason=refusal(c);return reason?[{codeId:c.id,reason}]:[]});
 return {code:first,conflict:!!first&&valid.some(c=>target(c)!==target(first)),matched:valid.map(c=>c.id),skipped:hits.filter(c=>!eligible(c)).map(c=>c.id),refused,unknown:found.filter(f=>!f.code).map(f=>f.token.code)};
}
// 가져오기 미리보기의 게시 관문 안내. 건수가 없으면 null.
const countOf=(counts:unknown,key:string)=>{const x=(counts&&typeof counts==='object'?counts:{}) as Record<string,unknown>,v=x[key];return typeof v==='number'&&Number.isFinite(v)&&v>0?v:0};
export function publicationImportNote(counts:unknown){
 const n=(k:string)=>countOf(counts,k),parts=[...(n('beforePublication')?[`게시 전 주문 ${n('beforePublication')}건`]:[]),...(n('unpublished')?[`취소·발행 실패 게시 ${n('unpublished')}건`]:[]),...(n('pendingPublication')?[`게시 상태 확인 전 ${n('pendingPublication')}건`]:[])];
 return parts.length?'게시 코드로 귀속하지 않음: '+parts.join(' · '):null;
}
// 확정 전 확인(allowPendingPublications). 가져온 주문은 다시 가져와도 건너뛰므로, 지금 확정하면 이 주문은 나중에 게시가 확인돼도 게시별로 귀속되지 않는다.
export function pendingPublicationNote(counts:unknown){
 const n=countOf(counts,'pendingPublication');
 return n?`게시 상태 확인 전(승인 전·실행 승인·접수 확인 중·접수 여부 미확인·공급자 확인 필요) 게시의 코드가 있는 주문이 ${n}건 있습니다. 지금 확정하면 이 주문은 게시가 나중에 확인돼도 게시별로 귀속되지 않습니다(저장한 주문은 다시 가져와도 건너뜁니다). 실행 화면에서 게시 상태를 확인한 뒤 가져오세요.`:null;
}
// 소재 표시 이름은 실행 화면과 같은 규칙이다(lib/execution.ts creativeLabel): 제목, 없으면 '소재 · 9월 23일 14:05 생성 · 첫 사실 줄'(한국 시각).
export {creativeLabel};
// 게시별 줄 이름: 소재 이름 · 예약 시각(한국) · 게시 상태.
export const publicationRowLabel=(p:{scheduledAt?:unknown},creative:string,status:string)=>[creative,'예약 '+(koreaMinute(p.scheduledAt)||'시각 미확인'),status].join(' · ');

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
// 3) 코드·팔·소재·캠페인·게시별 집계. 코드·팔은 코드로 자동 귀속된 주문만, 소재는 소재가 연결된 주문(수동·자동), 캠페인은 수동 귀속과 미귀속(key '')까지 함께 보인다.
// 소재 키는 `${campaignId}·${creativeId}`이고 화면이 캠페인 제목과 소재 이름(보고서의 creativeLabels)을 붙인다.
// 게시는 게시 코드로 자동 귀속된 주문만 센다(A4-2). 줄 이름은 서버가 준 publicationLabels(소재 이름·예약 시각·상태), codes는 그 게시에 묶인 코드다.
export function attributionBreakdown(orders:readonly StoreOrder[],codes:readonly TrackingCode[],economics?:Economics,publicationLabels:Record<string,string>={}){
 const codeLabel=(id:string)=>{const c=codes.find(x=>x.id===id);return c?[c.code,trackingCodeTypes[c.type],c.label].filter(Boolean).join(' · '):id};
 const armKey=(o:StoreOrder)=>o.codeAttribution?`${o.campaignId||''}·${o.codeAttribution.arm||'팔 없음'}`:null;
 const publicationCodes=(key:string)=>[...new Set([...codes.filter(c=>c.publicationId===key).map(c=>c.code),...orders.flatMap(o=>o.codeAttribution?.publicationId===key?[o.codeAttribution.code]:[])])];
 return {
  byCode:groupBy(orders,o=>o.codeAttribution?.codeId??null,codeLabel,economics),
  byArm:groupBy(orders,armKey,key=>key.replace('·',' · '),economics),
  byCreative:groupBy(orders,o=>o.creativeId?`${o.campaignId||''}·${o.creativeId}`:null,key=>key.replace('·',' · 소재 '),economics),
  byCampaign:groupBy(orders,o=>o.campaignId||'',key=>key||'미귀속',economics),
  byPublication:groupBy(orders,o=>o.codeAttribution?.publicationId??null,key=>publicationLabels[key]||'게시 '+key,economics).map(g=>({...g,codes:publicationCodes(g.key)})),
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
// 보고서가 게시 관문을 다시 본 결과(publicationGateView)로 귀속이 바뀐 주문(before→after)만큼 일별 장부 합계의 귀속 항목을 고친다. 순매출·주문 수는 귀속과 무관해 그대로다.
export function regateDays(days:readonly DayTotal[],before:readonly StoreOrder[],after:readonly StoreOrder[]):DayTotal[]{
 const was=new Map(dayTotals(before).map(d=>[d.day,d])),now=new Map(dayTotals(after).map(d=>[d.day,d]));
 const fix=(d:DayTotal,key:'attributedOrders'|'attributedKnown'|'attributedUnknown'|'attributedUnknownNet')=>d[key]-(was.get(d.day)?.[key]??0)+(now.get(d.day)?.[key]??0);
 return days.map(d=>was.has(d.day)?{...d,attributedOrders:fix(d,'attributedOrders'),attributedKnown:fix(d,'attributedKnown'),attributedUnknown:fix(d,'attributedUnknown'),attributedUnknownNet:fix(d,'attributedUnknownNet')}:d);
}
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
