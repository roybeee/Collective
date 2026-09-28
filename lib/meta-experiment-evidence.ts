import type {Brand,Campaign} from './agency';
import {effectiveBrandFacts,type BrandFact} from './brand-facts';
import type {ExecutionCreative} from './execution';
import {creativeCurrent} from './execution-creative-basis';
import {loadFranchiseContext} from './franchise-facts-server';
import type {ExperimentDesign,ExperimentUnit,ExperimentResult,ExperimentState} from './meta-experiment';
import {experimentStatistics} from './meta-experiment';
import {storefrontDigest} from './storefront-orders';
import {orderContribution,type StoreOrder} from './store-operations';
import {ApiError,database,listRecords,readRecord} from './server';

export async function experimentUnits(owner:string,d:ExperimentDesign){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='meta_experiment_unit' AND parent_id=? AND json_extract(data,'$.designId')=? ORDER BY id LIMIT 10001").bind(owner,d.campaignId,d.id).all<{data:string}>();
 if(rows.results.length>10000)throw new ApiError(409,'실험은 최대 10,000개 배정 단위까지 지원합니다.');
 return rows.results.map(r=>JSON.parse(r.data) as ExperimentUnit);
}
export async function experimentDesignCurrent(owner:string,c:Campaign,d:ExperimentDesign){
 if(c.id!==d.campaignId||c.brandId!==d.brandId||c.storeId!==d.storeId||c.version!==d.campaignVersion||c.status==='archived')return false;
 const fingerprint=await experimentCreativeBasis(owner,c,d.creative);
 return !!fingerprint&&fingerprint===d.creativeBasis;
}
export async function experimentCreativeBasis(owner:string,c:Campaign,ref:ExperimentDesign['creative']){
 try{
  const v=await readRecord<ExecutionCreative>(owner,'execution_creative',ref.creativeId),brand=await readRecord<Brand>(owner,'brand',c.brandId);
  if(v.campaignId!==c.id||v.brandId!==c.brandId||v.storeId!==c.storeId||v.version!==ref.creativeVersion||v.pngHash!==ref.creativeHash)return null;
  const facts=effectiveBrandFacts(await listRecords<BrandFact>(owner,'brand_fact',c.brandId),c.brandId,c.storeId),used=v.factRefs.map(r=>facts.find(f=>f.id===r.id&&f.version===r.version));
  if(used.some(f=>!f))return null;
  // Keep model-injection validation away from publishing/benchmark loaders.
  const fr=await loadFranchiseContext(owner,c.brandId);
  if(!await creativeCurrent(c,brand,facts,v,fr.versions))return null;
  return storefrontDigest({name:brand.name,color:brand.color,creative:v,used,disclosures:fr.versions});
 }catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e;}
}
function outcome(d:ExperimentDesign,u:ExperimentUnit,orders:StoreOrder[]){
 const o=u.observation;
 if(!o||!o.exposed||!o.trackingComplete||o.contaminated||Date.parse(o.observedThrough)<Date.parse(d.registration.endAt)+d.registration.maturityHours*3600000)return null;
 if(orders.some(v=>{
  const proof=o.purchases?.find(p=>p.orderId===v.id),at=Date.parse(proof?.purchasedAt??'');
  return v.storeId!==d.storeId||v.campaignId!==d.campaignId||!['paid','refunded','cancelled'].includes(v.status)||!proof?.evidenceRef||!Number.isFinite(at)||at<Math.max(Date.parse(d.registration.startAt),Date.parse(u.assignedAt))||at>=Date.parse(d.registration.endAt)||v.orderDate!==new Date(at).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
 }))return null;
 if(d.metric==='paid_orders')return orders.some(v=>v.status==='paid'&&v.paidAmount>v.refundAmount)?1:0;
 const contributions=orders.map(orderContribution);
 if(contributions.some(v=>v===null))return null;
 return contributions.reduce<number>((a,v)=>a+(v??0),0)-o.netTaxKrw-o.adSpendKrw-o.productionCostKrw;
}
export async function experimentEvidence(owner:string,c:Campaign,d:ExperimentDesign,version:number){
 const units=await experimentUnits(owner,d),allOrders=await listRecords<StoreOrder>(owner,'store_order',d.storeId),orderMap=new Map(allOrders.map(o=>[o.id,o]));
 const resolved=units.map(u=>({unit:u,orders:(u.observation?.orderIds??[]).map(id=>orderMap.get(id)).filter((v):v is StoreOrder=>!!v)}));
 const lineage=resolved.map(({unit,orders})=>({unitId:unit.id,version:unit.version,orders:orders.map(o=>({id:o.id,version:o.version}))}));
 const designCurrent=await experimentDesignCurrent(owner,c,d);
 const sourceDigest=await storefrontDigest({design:d.digest,designCurrent,units:resolved});
 const values=resolved.map(({unit,orders})=>({arm:unit.arm,value:orders.length===(unit.observation?.orderIds.length??0)?outcome(d,unit,orders):null}));
 const statistics=experimentStatistics(d,values.filter(v=>v.arm==='control'&&v.value!==null).map(v=>v.value!),values.filter(v=>v.arm==='treatment'&&v.value!==null).map(v=>v.value!),version);
 const now=Date.now();let state:ExperimentState=statistics.status;
 const ids=resolved.flatMap(v=>v.orders.map(o=>o.id));
 if(!designCurrent||new Set(ids).size!==ids.length)state='invalid';
 else if(now<Date.parse(d.registration.startAt))state='not_started';
 else if(now<Date.parse(d.registration.endAt))state='collecting';
 else if(now<Date.parse(d.registration.endAt)+d.registration.maturityHours*3600000)state='maturing';
 else if(values.some(v=>v.value===null))state='invalid';
 return {sourceDigest,lineage,statistics:{...statistics,status:state,reason:state===statistics.status?statistics.reason:'기간·설계·노출·추적 완전성·성숙·원가를 확인하세요.'},units};
}
// Used again at model injection time: a refund or corrected source must stop
// applying an old rule even before an operator saves the next result.
export async function metaRuleEvidenceCurrent(owner:string,reference:{campaignId:string;designId:string;resultId:string;sourceDigest:string}){
 try{
  const c=await readRecord<Campaign>(owner,'campaign',reference.campaignId),d=await readRecord<ExperimentDesign>(owner,'meta_experiment_design',reference.designId),r=await readRecord<ExperimentResult>(owner,'meta_experiment_result',reference.resultId);
  if(d.campaignId!==c.id||r.designId!==d.id||r.sourceDigest!==reference.sourceDigest)return false;
  const current=await experimentEvidence(owner,c,d,r.version);
  return current.sourceDigest===r.sourceDigest&&['supported','rejected'].includes(current.statistics.status);
 }catch(e){if(e instanceof ApiError&&e.status===404)return false;throw e;}
}
