import type {Campaign} from './agency';
import type {GrowthCommitmentRecord} from './growth-authority-server';
import type {CollaborationRecord} from './growth-collaboration-server';
import {growthView} from './growth-workspace-server';
import {assessPilot,geoSummary,mmmFeasibility,parseGeoObservation,parsePilot,productStructuredData,type GeoObservationInput,type PilotInput} from './growth-conditional';
import {campaignRows,inCampaign,optionalRecord,versionedMutation,type Versioned} from './growth-ledger-server';
import {ApiError,database,str,type Actor} from './server';
const kinds={geo:'growth_geo_observation',geoHistory:'growth_geo_observation_history',geoRequest:'growth_geo_observation_request',pilot:'growth_overseas_pilot',pilotHistory:'growth_overseas_pilot_history',pilotRequest:'growth_overseas_pilot_request'} as const;
const geoKinds={current:kinds.geo,history:kinds.geoHistory,request:kinds.geoRequest},pilotKinds={current:kinds.pilot,history:kinds.pilotHistory,request:kinds.pilotRequest};
export type GeoRecord=Versioned&{input:GeoObservationInput;recordedAt:string;recordedBy:string};
export type PilotRecord=Versioned&{input:PilotInput;updatedAt:string;updatedBy:string};
const weekOf=(d:string)=>{const t=Date.parse(d.slice(0,10)+'T00:00:00Z'),day=(new Date(t).getUTCDay()+6)%7;return new Date(t-day*86400000).toISOString().slice(0,10)};
async function weekly(owner:string,c:Campaign,now:number){
 const from=new Date(now-104*7*86400000).toISOString().slice(0,10),weeks=new Map<string,{revenue:number|null;spend:Record<string,number|null>}>();
 const get=(w:string)=>{if(!weeks.has(w))weeks.set(w,{revenue:0,spend:{}});return weeks.get(w)!};
 if(c.storeId)for(const r of (await database().prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND json_extract(data,'$.campaignId')=? AND json_extract(data,'$.orderDate')>=? LIMIT 50001").bind(owner,c.storeId,c.id,from).all<{data:string}>()).results){const o=JSON.parse(r.data) as {orderDate:string;paidAmount:number;refundAmount:number};const w=get(weekOf(o.orderDate));w.revenue=(w.revenue??0)+o.paidAmount-o.refundAmount}
 const add=(at:string,ch:string,v:number|null)=>{if(at.slice(0,10)<from)return;const w=get(weekOf(at));w.spend[ch]=v===null||w.spend[ch]===null?null:(w.spend[ch]??0)+v};
 for(const k of await campaignRows<GrowthCommitmentRecord>(owner,c,'growth_commitment',1000))if(inCampaign(k,c)&&(k.commitment.action.amount??0)>0)add(k.commitment.at,k.commitment.action.channel,k.commitment.status==='reconciled'?k.commitment.actualAmount:k.commitment.status==='released'?0:null);
 for(const co of await campaignRows<CollaborationRecord>(owner,c,'growth_collaboration',200)){const s=co.receipts.find(x=>x.stage==='settled');if(s)add(s.at,'collaboration',s.paidKrw??null)}
 const ws=[...weeks.keys()].sort(),channels=[...new Set([...weeks.values()].flatMap(w=>Object.keys(w.spend)))];
 return ws.map(w=>({week:w,revenue:weeks.get(w)!.revenue,spend:Object.fromEntries(channels.map(ch=>[ch,weeks.get(w)!.spend[ch]===undefined?0:weeks.get(w)!.spend[ch]]))}));
}
export async function growthConditionalView(who:Actor,c:Campaign){
 const now=Date.now(),[view,brand,geo,pilots,series]=await Promise.all([growthView(who.owner,c,who.role!=='member'),optionalRecord<{name?:string}>(who.owner,'brand',c.brandId),campaignRows<GeoRecord>(who.owner,c,geoKinds.current,2000),campaignRows<PilotRecord>(who.owner,c,pilotKinds.current,50),weekly(who.owner,c,now)]);
 const products=view.offers.map(o=>{const cat=view.catalogs.find(x=>x.id===o.input.catalogId);return {offerId:o.id,offerVersion:o.version,title:o.input.title,...productStructuredData({offerId:o.id,offerVersion:o.version,title:o.input.title,sku:cat?.input.sku??'',price:o.input.price,priceApproved:o.input.priceApproved,rightsConfirmed:cat?.input.rightsConfirmed===true,landingUrl:o.input.landingUrl,brandName:brand?.name??c.brandId,available:cat?.currentStock?.status==='known'?cat.currentStock.available:null,stockStatus:cat?.currentStock?.status??'held'})}});
 const own=geo.filter(g=>inCampaign(g,c));
 return {campaignId:c.id,campaignVersion:c.version,geo:{products,observations:own.sort((a,b)=>b.input.observedAt.localeCompare(a.input.observedAt)).slice(0,200),summary:geoSummary(own.map(g=>g.input))},overseas:pilots.filter(p=>inCampaign(p,c)).map(p=>({...p,assessment:assessPilot(p.input)})),mmm:mmmFeasibility(series),offers:view.offers.map(o=>({id:o.id,title:o.input.title})),canEdit:who.role!=='member'&&c.status!=='archived',mayLaunch:false as const,mayAllocateBudget:false as const,decisionRequired:['G2-23 외부 고객 격리·보고·삭제','G2-24 외부 서비스 온보딩·계약·성과료']};
}
export type GrowthConditionalView=Awaited<ReturnType<typeof growthConditionalView>>;
export async function saveGrowthConditional(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');
 const id=str(b.id,'기록 ID',100,true),action=String(b.action??'');
 if(action==='save_geo'){const input=parseGeoObservation(b.input);return versionedMutation<GeoRecord>(who,c,b,geoKinds,id,{action,input},async(old,at)=>{if(old)throw new ApiError(409,'관측 기록은 새로 만듭니다.');return {next:{id,brandId:c.brandId,campaignId:c.id,version:1,input,recordedAt:at,recordedBy:who.id},limit:2000}})}
 if(action==='save_pilot'){const input=parsePilot(b.input);return versionedMutation<PilotRecord>(who,c,b,pilotKinds,id,{action,input},async(old,at)=>{const view=await growthView(who.owner,c,true);if(!view.offers.some(o=>o.id===input.offerId))throw new ApiError(404,'현재 캠페인의 오퍼를 선택하세요.');return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,input,updatedAt:at,updatedBy:who.id},limit:50}})}
 throw new ApiError(400,'지원하지 않는 작업입니다.');
}
