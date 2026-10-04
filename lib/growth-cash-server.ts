import type {Campaign} from './agency';
import type {SettlementEvidence} from './growth-settlement';
import {cashDay,cashDirection,cashIdentity,cashPeriod,cashReason,cashRef,parseCashInput,type ActualCashSummary,type CashInput,type CashPeriod} from './growth-cash';
import {campaignRows,inCampaign,versionedMutation,type Versioned} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,stamp,str,type Actor} from './server';
const kinds={current:'growth_cash',history:'growth_cash_history',request:'growth_cash_request',coverage:'growth_cash_coverage',coverageHistory:'growth_cash_coverage_history',coverageRequest:'growth_cash_coverage_request'} as const;
const coverageKinds={current:kinds.coverage,history:kinds.coverageHistory,request:kinds.coverageRequest} as const;
export type CashRecord=Versioned&{input:CashInput;status:'active'|'void';voidReason:string|null;createdAt:string;updatedAt:string;updatedBy:string};
export type CashCoverage=Versioned&{period:CashPeriod;inputDigest:string;evidenceRef:string;origin:'operator_attested';updatedAt:string;updatedBy:string};
type SettlementRow={id:string;brandId:string;campaignId:string;storeId:string;input:SettlementEvidence};
async function ownerRows<T>(owner:string,kind:string){
 const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? LIMIT 5001').bind(owner,kind).all<{data:string}>();
 if(r.results.length>5000)throw new ApiError(409,'현금·정산 조회 한도를 넘었습니다. 전체 증빙을 대사하세요.');
 return r.results.map(x=>JSON.parse(x.data) as T);
}
async function sources(owner:string){const [cash,settlements]=await Promise.all([ownerRows<CashRecord>(owner,kinds.current),ownerRows<SettlementRow>(owner,'growth_settlement')]);return {cash,settlements}}
const periodId=async(c:Campaign,p:CashPeriod)=>`period-${(await storefrontDigest([c.id,p.from,p.to])).slice(0,32)}`;
const inPeriod=(at:string,p:CashPeriod)=>at.slice(0,10)>=p.from&&at.slice(0,10)<=p.to;
// Also called by settlement writes under the shared owner lock: neither write order can double-count a receipt.
export async function assertSettlementCashIdentity(owner:string,input:SettlementEvidence,settlementId:string){
 if(input.kind!=='received')return;
 const all=await ownerRows<CashRecord>(owner,kinds.current);
 const settlements=await ownerRows<SettlementRow>(owner,'growth_settlement');
 if(settlements.some(x=>x.id!==settlementId&&x.input.kind==='received'&&cashIdentity(x.input)===cashIdentity(input)))throw new ApiError(400,'같은 은행 거래 참조의 정산 입금이 이미 있습니다.');
 if(all.some(x=>cashIdentity(x.input)===cashIdentity(input)))throw new ApiError(409,'같은 은행 거래가 현금 원장에 있습니다. 정산과 현금 원장에 중복 기록할 수 없습니다.');
}
function totals(rows:{amount:number|null}[]){if(rows.some(r=>r.amount===null))return null;const n=rows.reduce((sum,r)=>sum+(r.amount??0),0);if(!Number.isSafeInteger(n))throw new ApiError(409,'현금 합계가 안전한 원 단위 범위를 넘었습니다.');return n}
export async function growthCashView(who:Actor,c:Campaign,period:CashPeriod){
 const p=cashPeriod(period),[all,coverageRows,history]=await Promise.all([sources(who.owner),campaignRows<CashCoverage>(who.owner,c,coverageKinds.current,500),campaignRows<CashRecord>(who.owner,c,kinds.history,5000)]);
 const cash=all.cash.filter(x=>inCampaign(x,c)),settlements=all.settlements.filter(x=>inCampaign(x,c)&&x.storeId===c.storeId);
 const active=cash.filter(x=>x.status==='active'&&inPeriod(x.input.occurredAt,p)),received=settlements.filter(x=>x.input.kind==='received'&&inPeriod(x.input.occurredAt,p));
 const identities=[...all.cash.map(x=>cashIdentity(x.input)),...all.settlements.filter(x=>x.input.kind==='received').map(x=>cashIdentity(x.input))];
 const counts=new Map<string,number>();for(const key of identities)counts.set(key,(counts.get(key)??0)+1);
 const duplicateKeys=[...new Set([...active.map(x=>cashIdentity(x.input)),...received.map(x=>cashIdentity(x.input))])].filter(key=>(counts.get(key)??0)>1).sort();
 const sort=<T extends {id:string}>(rows:T[])=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
 const inputDigest=await storefrontDigest({campaign:{id:c.id,version:c.version,storeId:c.storeId??null},cash:sort(cash),settlements:sort(settlements),duplicateKeys});
 const coverageId=await periodId(c,p),coverage=coverageRows.find(x=>inCampaign(x,c)&&x.id===coverageId)??null;
 const unknownItems=active.filter(x=>x.input.amount===null).length+received.filter(x=>x.input.amount===null).length;
 const coverageStatus=!coverage?'missing' as const:coverage.inputDigest!==inputDigest?'stale' as const:'complete' as const;
 const receipts=totals([...received.map(x=>x.input),...active.filter(x=>cashDirection(x.input.kind)==='in').map(x=>x.input)]),payments=totals(active.filter(x=>cashDirection(x.input.kind)==='out').map(x=>x.input));
 const reasons=[...(coverageStatus!=='complete'?[coverageStatus==='stale'?'현금·정산 기록이 바뀌어 기간 완전성 확인을 다시 해야 합니다.':'기간의 모든 입출금을 확인해야 순현금을 계산합니다.']:[]),...(unknownItems?['금액 미확인 입출금이 있어 순현금을 계산하지 않습니다.']:[]),...(duplicateKeys.length?['같은 은행 거래 참조가 중복되어 순현금을 계산하지 않습니다.']:[])];
 const summary:ActualCashSummary={netCashFlow:reasons.length||receipts===null||payments===null?null:receipts-payments,actualReceipts:duplicateKeys.length?null:receipts,actualPayments:duplicateKeys.length?null:payments,coverageStatus,verification:'operator_attested',unknownItems,duplicateIdentities:duplicateKeys.length,reasons};
 return {campaignId:c.id,campaignVersion:c.version,period:p,entries:sort(cash),history:sort(history.filter(x=>inCampaign(x,c))),settlements:received,coverageId,coverage,inputDigest,summary,canEdit:who.role!=='member'&&c.status!=='archived',mayExecute:false as const};
}
export type GrowthCashView=Awaited<ReturnType<typeof growthCashView>>;
export async function saveGrowthCash(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(who.role==='member')throw new ApiError(403,'관리자만 현금 기록을 변경할 수 있습니다.');
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');
 if(b.action==='attest_period')return attest(who,c,b);
 if(b.action!=='save_cash'&&b.action!=='void_cash')throw new ApiError(400,'지원하지 않는 현금 원장 작업입니다.');
 const id=str(b.id,'현금 기록 ID',100,true),input=b.action==='save_cash'?parseCashInput(b.input,stamp()):null,reason=b.action==='void_cash'?cashReason(b.reason):null;
 return versionedMutation<CashRecord>(who,c,b,kinds,id,{action:b.action,input,reason},async(old,at)=>{
  if(!input){if(!old)throw new ApiError(404,'무효 처리할 현금 기록이 없습니다.');return {next:{...old,version:old.version+1,status:'void',voidReason:reason,updatedAt:at,updatedBy:who.id}}}
  if(old&&(cashIdentity(old.input)!==cashIdentity(input)||cashDirection(old.input.kind)!==cashDirection(input.kind)))throw new ApiError(409,'계정·은행 거래 참조와 입출금 방향은 바꿀 수 없습니다.');
  const all=await sources(who.owner),identity=cashIdentity(input);
  if(all.cash.some(x=>x.id!==id&&cashIdentity(x.input)===identity)||all.settlements.some(x=>x.input.kind==='received'&&cashIdentity(x.input)===identity))throw new ApiError(409,'같은 은행 거래 참조가 이미 현금 또는 정산 원장에 있습니다.');
  return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,input,status:'active',voidReason:null,createdAt:old?.createdAt??at,updatedAt:at,updatedBy:who.id}};
 });
}
async function attest(who:Actor,c:Campaign,b:Record<string,unknown>){
 const period=cashPeriod(b.period),evidenceRef=cashRef(b.evidenceRef,'기간 대사 증빙');
 if(b.confirmedComplete!==true)throw new ApiError(400,'입금·매입·광고·환불·별도 수수료 등 기간의 모든 입출금을 확인하세요.');
 if(period.to>stamp().slice(0,10))throw new ApiError(400,'미래 기간은 완전성을 확인할 수 없습니다.');
 const id=await periodId(c,period);if(b.id!==id)throw new ApiError(400,'기간 확인 ID를 다시 조회하세요.');
 return versionedMutation<CashCoverage>(who,c,b,coverageKinds,id,{period,evidenceRef,inputDigest:b.inputDigest,confirmedComplete:true},async(old,at)=>{
  const view=await growthCashView(who,c,period);
  if(b.inputDigest!==view.inputDigest)throw new ApiError(409,'현금·정산 기록이 변경되었습니다. 다시 조회하고 확인하세요.');
  if(view.summary.unknownItems||view.summary.duplicateIdentities)throw new ApiError(409,'미확인 금액 또는 중복 거래를 먼저 해결하세요.');
  return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,period,inputDigest:view.inputDigest,evidenceRef,origin:'operator_attested',updatedAt:at,updatedBy:who.id}};
 });
}
export function cashQueryPeriod(from:unknown,to:unknown){const end=cashDay(to)?String(to):stamp().slice(0,10),start=cashDay(from)?String(from):new Date(Date.parse(end)-29*86400000).toISOString().slice(0,10);return cashPeriod({from:start,to:end})}
