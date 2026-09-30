import type {Campaign} from './agency';
import type {Publication} from './execution';
import type {ViralExperiment} from './learning';
import type {MeasurementSource,MeasurementDraft} from './measurement-collection';
import type {GrowthPublicationLink} from './growth-publication-server';
import type {ExecutionIntent} from './growth-execution-server';
import {assessPublicationMeasurement} from './growth-publication-observation';
import {attributionPeriod,campaignAttribution} from './campaign-attribution';
import {ApiError,database,readRecord} from './server';
async function optional<T>(owner:string,kind:string,id:string|undefined){if(!id)return null;try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function safeId(id:unknown):string{if(typeof id!=='string'||!/^[a-zA-Z0-9_:.-]{1,200}$/.test(id))throw new ApiError(409,'관측 연결 식별자를 확인하세요.');return id}
type AttributionValue={records:number;orders:number;netRevenue:number;contribution:number|null;unknownCostOrders:number;newCustomers:number|null};
export async function growthPublicationObservation(owner:string,c:Campaign,input:{from?:unknown;to?:unknown}={}){
 const period=attributionPeriod(input),result=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 201').bind(owner,'growth_publication_link',c.id).all<{data:string}>();
 if(result.results.length>200)throw new ApiError(409,'게시 관측 연결 조회 한도를 넘었습니다.');
 const links=result.results.map(r=>JSON.parse(r.data) as GrowthPublicationLink);
 const storeCount=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,'store',c.brandId).first<{n:number}>();
 if((storeCount?.n??0)>5000)throw new ApiError(409,'브랜드 지점 조회 한도를 넘었습니다.');
 const attribution=await campaignAttribution(owner,c,period);
 const rows=await Promise.all(links.map(async link=>{
  const linkId=safeId(link.id),intentId=safeId(link.intentId),publicationId=safeId(link.publicationId);
  const [p,i]=await Promise.all([optional<Publication>(owner,'execution_publication',publicationId),optional<ExecutionIntent>(owner,'growth_action_intent',intentId)]);
  const reasons:string[]=[];
  if(link.brandId!==c.brandId||link.campaignId!==c.id||!i||i.id!==intentId||i.brandId!==c.brandId||i.campaignId!==c.id||i.storeId!==c.storeId||i.snapshot?.mission?.channel!=='organic'||!p||p.id!==publicationId||p.campaignId!==c.id)reasons.push('미션과 게시물의 브랜드·캠페인·지점 연결을 확인하세요.');
  const valid=!reasons.length,experimentId=valid&&p?.experimentId?safeId(p.experimentId):undefined,arm=p?.arm;
  const [e,s,d]=await Promise.all([optional<ViralExperiment>(owner,'viral_experiment',experimentId),optional<MeasurementSource>(owner,'measurement_source',experimentId&&arm?`${experimentId}:${arm}`:undefined),optional<MeasurementDraft>(owner,'measurement_draft',experimentId)]);
  const measurement=assessPublicationMeasurement({campaign:c,publication:valid?p:null,experiment:e,source:s,draft:d});
  const group=attribution.byPublication.find(g=>g.key===publicationId),attributionReasons=[...reasons,...(p?.status!=='published'?['게시 완료 전에는 게시물 주문 귀속을 표시하지 않습니다.']:[])];
  let value:AttributionValue|null=null;
  if(!attributionReasons.length&&group)value={records:group.records,orders:group.orders,netRevenue:group.netRevenue,contribution:group.contribution,unknownCostOrders:group.unknownCostOrders,newCustomers:group.newCustomers};
  return {linkId,intentId,publicationId,publicationStatus:valid?p!.status:'unknown',experiment:valid&&e&&e.id===experimentId&&e.brandId===c.brandId&&e.campaignId===c.id&&(arm==='control'||arm==='treatment')?{id:safeId(e.id),arm,channel:'instagram' as const}:null,measurement,attribution:{status:attributionReasons.length?'held' as const:group?'observed' as const:'no_rows' as const,value,reasons:attributionReasons},reasons};
 }));
 return {campaignId:c.id,period,rows,mayCollect:false as const,mayExecute:false as const,causalStatus:'not_measured' as const};
}
export type GrowthPublicationObservationView=Awaited<ReturnType<typeof growthPublicationObservation>>;
