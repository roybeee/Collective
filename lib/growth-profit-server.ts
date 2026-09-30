import type {Campaign} from './agency';
import type {GrowthCommitmentRecord} from './growth-authority-server';
import type {CollaborationRecord} from './growth-collaboration-server';
import type {SettlementEvidence} from './growth-settlement';
import {growthBusiness} from './growth-business-server';
import {profitSummary,type CashItem,type SpendItem} from './growth-profit';
import {campaignRows,inCampaign} from './growth-ledger-server';
import {ApiError,database,type Actor} from './server';
const day=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export async function growthProfitView(who:Actor,c:Campaign,q:{from?:unknown;to?:unknown}){
 const to=day(q.to)?String(q.to):new Date().toISOString().slice(0,10),from=day(q.from)?String(q.from):new Date(Date.parse(to+'T00:00:00Z')-29*86400000).toISOString().slice(0,10);
 if(from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw new ApiError(400,'기간은 시작≤끝, 최대 1년입니다.');
 const period={from,to},[business,commitments,collaborations,meta]=await Promise.all([growthBusiness(who.owner,c,period),campaignRows<GrowthCommitmentRecord>(who.owner,c,'growth_commitment',1000),campaignRows<CollaborationRecord>(who.owner,c,'growth_collaboration',200),database().prepare("SELECT data FROM records WHERE owner=? AND kind='meta_ads_execution' AND parent_id=? LIMIT 501").bind(who.owner,c.id).all<{data:string}>()]);
 const settlements=c.storeId?(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_settlement' AND parent_id=? AND json_extract(data,'$.campaignId')=? LIMIT 5001").bind(who.owner,c.storeId,c.id).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as {brandId:string;campaignId:string;input:SettlementEvidence}):[];
 const spend:SpendItem[]=[
  ...commitments.filter(r=>inCampaign(r,c)&&(r.commitment.action.amount??0)>0).map(r=>({source:'growth_commitment' as const,id:r.id,at:r.commitment.at,status:r.commitment.status==='reconciled'||r.commitment.status==='released'?'known' as const:'unknown' as const,amount:r.commitment.status==='released'?0:r.commitment.status==='reconciled'?r.commitment.actualAmount:null})),
  ...collaborations.filter(r=>inCampaign(r,c)).flatMap(r=>{const settled=r.receipts.find(x=>x.stage==='settled');const published=r.receipts.find(x=>x.stage==='published');if(settled)return [{source:'collaboration' as const,id:r.id,at:settled.at,status:settled.paidKrw===null||settled.paidKrw===undefined?'unknown' as const:'known' as const,amount:settled.paidKrw??null}];if(published&&(r.plan.feeKrw??0)>0)return [{source:'collaboration' as const,id:r.id,at:published.at,status:'unknown' as const,amount:null}];return []}),
  ...meta.results.map(x=>JSON.parse(x.data) as {id:string;campaignId:string;state:string;approvedAt:string;settledSpend:number|null;settledAt:string|null;totalSpend:number|null;lastObservedAt:string|null}).filter(x=>x.campaignId===c.id).map(x=>{const settled=x.state==='settled'&&Number.isSafeInteger(x.settledSpend);const never=x.state==='revoked'&&!x.lastObservedAt&&(x.totalSpend===null||x.totalSpend===0);return {source:'meta_execution' as const,id:x.id,at:settled&&x.settledAt?x.settledAt:x.approvedAt,status:settled||never?'known' as const:'unknown' as const,amount:settled?x.settledSpend:never?0:null}}),
 ];
 const cash:CashItem[]=settlements.filter(s=>inCampaign(s,c)).map(s=>({kind:s.input.kind,amount:s.input.amount,fee:s.input.feeAmount,at:s.input.occurredAt}));
 return {campaignId:c.id,ledger:{status:business.status,reason:business.reason},...profitSummary({netRevenue:business.netRevenue,contributionBeforeMarketing:business.contributionBeforeMarketing,spend,cash,period}),mayExecute:false as const};
}
export type GrowthProfitView=Awaited<ReturnType<typeof growthProfitView>>;
