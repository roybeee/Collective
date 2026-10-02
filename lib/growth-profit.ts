/**
 * Post-marketing contribution and cash from the campaign's own ledgers. Every unreconciled spend, unpaid-amount-unknown settlement or
 * open Meta execution keeps the total null with a reason; nothing is zero-filled. Attributed or ledger totals are not causal effects.
 */
export type SpendItem={source:'growth_commitment'|'collaboration'|'meta_execution';id:string;at:string;status:'known'|'unknown';amount:number|null};
export type CashItem={kind:'expected'|'received';amount:number|null;fee:number|null;at:string};
export function profitSummary(x:{netRevenue:number|null;contributionBeforeMarketing:number|null;spend:SpendItem[];cash:CashItem[];period:{from:string;to:string}}){
 const inPeriod=(at:string)=>at.slice(0,10)>=x.period.from&&at.slice(0,10)<=x.period.to;
 const spend=x.spend.filter(s=>inPeriod(s.at)),unknownSpend=spend.filter(s=>s.status==='unknown'||s.amount===null);
 const knownSpend=spend.reduce((n,s)=>n+(s.status==='known'&&s.amount!==null?s.amount:0),0);
 const marketingCost=unknownSpend.length?null:knownSpend;
 const contributionAfterMarketing=x.contributionBeforeMarketing!==null&&marketingCost!==null?x.contributionBeforeMarketing-marketingCost:null;
 const cash=x.cash.filter(c=>inPeriod(c.at)),sum=(rows:CashItem[],k:'amount'|'fee')=>rows.some(r=>r[k]===null)?null:rows.reduce((n,r)=>n+(r[k] as number),0);
 const received=sum(cash.filter(c=>c.kind==='received'),'amount'),expected=sum(cash.filter(c=>c.kind==='expected'),'amount');
 const reasons=[
  ...(x.contributionBeforeMarketing===null?['주문 원가가 미확인이라 광고·제작비 차감 전 공헌이익을 계산할 수 없습니다.']:[]),
  ...(unknownSpend.length?[`대사되지 않은 마케팅 지출 ${unknownSpend.length}건(${[...new Set(unknownSpend.map(s=>s.source))].join(', ')})이 있어 마케팅 후 이익을 확정하지 않습니다.`]:[]),
  ...(received===null&&cash.some(c=>c.kind==='received')?['금액 미확인 입금 증빙이 있습니다.']:[]),
  '순현금은 원가 구매·재고 매입 현금이 연결되지 않아 계산하지 않습니다.',
 ];
 return {period:x.period,netRevenue:x.netRevenue,contributionBeforeMarketing:x.contributionBeforeMarketing,marketing:{known:knownSpend,unknownItems:unknownSpend.length,total:marketingCost,bySource:(['growth_commitment','collaboration','meta_execution'] as const).map(source=>({source,known:spend.filter(s=>s.source===source&&s.status==='known').reduce((n,s)=>n+(s.amount??0),0),unknown:spend.filter(s=>s.source===source&&(s.status==='unknown'||s.amount===null)).length}))},contributionAfterMarketing,cash:{received,expected,pending:received!==null&&expected!==null?Math.max(expected-received,0):null,fees:sum(cash.filter(c=>c.kind==='received'),'fee'),netCashFlow:null},reasons,causalStatus:'not_measured' as const,status:contributionAfterMarketing===null?'partial' as const:'reconciled_ledger' as const};
}
