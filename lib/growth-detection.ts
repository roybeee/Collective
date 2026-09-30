/**
 * Deterministic own-data signal detection (no scraping, no model). Each candidate carries its numbers, window and denominator;
 * thresholds are fixed and documented, and a candidate is a prompt for human review, not a demand forecast.
 */
export type DetectionKind='demand_rise'|'demand_drop'|'stockout_risk'|'return_cluster'|'cs_recurring'|'season';
export type Detection={key:string;kind:DetectionKind;title:string;detail:string;window:{from:string;to:string};evidence:Record<string,number|string|null>;dueBy:string|null};
export type OrderPoint={orderDate:string;status:string;paidAmount:number;refundAmount:number};
const day=(t:number)=>new Date(t).toISOString().slice(0,10),D=86400000;
// Korean commerce calendar. Lunar holidays are fixed per year; missing years produce no seasonal candidate rather than a guess.
export const SEASONS:{key:string;name:string;dates:Record<string,string>}[]=[
 {key:'seollal',name:'설날',dates:{'2026':'2026-02-17','2027':'2027-02-07','2028':'2028-01-27'}},
 {key:'chuseok',name:'추석',dates:{'2026':'2026-09-25','2027':'2027-09-15','2028':'2028-10-03'}},
 {key:'valentine',name:'밸런타인데이',dates:{'2026':'2026-02-14','2027':'2027-02-14','2028':'2028-02-14'}},
 {key:'whiteday',name:'화이트데이',dates:{'2026':'2026-03-14','2027':'2027-03-14','2028':'2028-03-14'}},
 {key:'parents',name:'어버이날',dates:{'2026':'2026-05-08','2027':'2027-05-08','2028':'2028-05-08'}},
 {key:'pepero',name:'빼빼로데이',dates:{'2026':'2026-11-11','2027':'2027-11-11','2028':'2028-11-11'}},
 {key:'blackfriday',name:'블랙프라이데이',dates:{'2026':'2026-11-27','2027':'2027-11-26','2028':'2028-11-24'}},
 {key:'christmas',name:'크리스마스',dates:{'2026':'2026-12-25','2027':'2027-12-25','2028':'2028-12-25'}},
];
export const THRESHOLDS={recentDays:7,baselineDays:21,minRecentOrders:5,changeRatio:0.5,stockDays:3,returnCluster:3,returnDays:30,csRecurring:3,seasonLeadDays:45};
export function detectSignals(x:{now:number;orders:OrderPoint[];stock:{sku:string;available:number|null;status:string;recentUnits:number}[];returns:{reasonCode:string;observedAt:string}[];csRecurring:string[]}):Detection[]{
 const out:Detection[]=[],today=day(x.now),T=THRESHOLDS;
 const paid=(o:OrderPoint)=>o.status==='paid'&&o.paidAmount>o.refundAmount;
 const recentFrom=day(x.now-(T.recentDays-1)*D),baseFrom=day(x.now-(T.recentDays+T.baselineDays-1)*D),baseTo=day(x.now-T.recentDays*D);
 const recent=x.orders.filter(o=>paid(o)&&o.orderDate>=recentFrom&&o.orderDate<=today).length,base=x.orders.filter(o=>paid(o)&&o.orderDate>=baseFrom&&o.orderDate<=baseTo).length;
 const recentRate=recent/T.recentDays,baseRate=base/T.baselineDays;
 if(base>0&&(recent>=T.minRecentOrders||base/T.baselineDays*T.recentDays>=T.minRecentOrders)){
  const change=(recentRate-baseRate)/baseRate;
  if(change>=T.changeRatio)out.push({key:`demand_rise:${recentFrom}`,kind:'demand_rise',title:'최근 7일 유료 주문 증가',detail:`최근 7일 일평균 ${recentRate.toFixed(2)}건, 직전 21일 일평균 ${baseRate.toFixed(2)}건(+${Math.round(change*100)}%).`,window:{from:baseFrom,to:today},evidence:{recentOrders:recent,baselineOrders:base,changePct:Math.round(change*100)},dueBy:null});
  if(change<=-T.changeRatio)out.push({key:`demand_drop:${recentFrom}`,kind:'demand_drop',title:'최근 7일 유료 주문 감소',detail:`최근 7일 일평균 ${recentRate.toFixed(2)}건, 직전 21일 일평균 ${baseRate.toFixed(2)}건(${Math.round(change*100)}%). 유입·결제 고장인지 먼저 확인하세요.`,window:{from:baseFrom,to:today},evidence:{recentOrders:recent,baselineOrders:base,changePct:Math.round(change*100)},dueBy:null});
 }
 for(const s of x.stock){
  if(s.status!=='known'||s.available===null||s.recentUnits<=0)continue;
  const perDay=s.recentUnits/T.recentDays,days=s.available/perDay;
  if(days<=T.stockDays)out.push({key:`stockout_risk:${s.sku}:${recentFrom}`,kind:'stockout_risk',title:`${s.sku} 품절 위험`,detail:`가용 ${s.available}개, 최근 7일 판매 ${s.recentUnits}개 기준 약 ${days.toFixed(1)}일분.`,window:{from:recentFrom,to:today},evidence:{available:s.available,recentUnits:s.recentUnits,daysOfCover:Math.round(days*10)/10},dueBy:day(x.now+Math.max(0,Math.floor(days))*D)});
 }
 const since=day(x.now-(T.returnDays-1)*D),counts=new Map<string,number>();
 for(const r of x.returns){if(r.observedAt.slice(0,10)<since||r.reasonCode==='unknown')continue;counts.set(r.reasonCode,(counts.get(r.reasonCode)??0)+1)}
 for(const [code,n] of counts)if(n>=T.returnCluster)out.push({key:`return_cluster:${code}:${since}`,kind:'return_cluster',title:`반품·환불 원인 반복: ${code}`,detail:`최근 30일 운영자 확인 원인 ${n}건(사건 수, 비율 아님).`,window:{from:since,to:today},evidence:{events:n,reasonCode:code},dueBy:null});
 for(const category of x.csRecurring)out.push({key:`cs_recurring:${category}:${since}`,kind:'cs_recurring',title:`문의 유형 반복: ${category}`,detail:'최근 30일 같은 유형 문의 3건 이상(건수, 비율 아님).',window:{from:since,to:today},evidence:{category},dueBy:null});
 const year=today.slice(0,4),next=String(Number(year)+1);
 for(const s of SEASONS)for(const y of [year,next]){const d=s.dates[y];if(!d)continue;const lead=(Date.parse(d+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/D;if(lead>=0&&lead<=T.seasonLeadDays)out.push({key:`season:${s.key}:${d}`,kind:'season',title:`${s.name} ${lead}일 전`,detail:`${d} ${s.name}. 준비 상품·오퍼·재고·배송 마감을 확인하세요.`,window:{from:today,to:d},evidence:{date:d,leadDays:lead},dueBy:day(Date.parse(d+'T00:00:00Z')-7*D)})}
 return out;
}
