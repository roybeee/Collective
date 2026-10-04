import {parseBundleReservationRequest,prepareBundleReservation,type BundleReservation} from './growth-bundle-reservation-server';
import {readGrowthStop} from './growth-stop-server';
import type {Campaign} from './agency';
import {growthView} from './growth-workspace-server';
import {bundleAssessment,parseBundleInput,type BundleCatalog,type BundleInput} from './growth-bundle';
import {campaignRows,inCampaign,versionedMutation,optionalRecord,type Versioned} from './growth-ledger-server';
import type {InventoryRow} from './growth-operations-server';
import {ApiError,database,str,type Actor} from './server';
const kinds={current:'growth_bundle',history:'growth_bundle_history',request:'growth_bundle_request'} as const;
export type BundleRecord=Versioned&{reservation?:BundleReservation;input:BundleInput;snapshot:{components:{catalogId:string;catalogVersion:number}[]};createdAt:string;updatedAt:string;updatedBy:string};
const catalogsOf=(view:Awaited<ReturnType<typeof growthView>>):BundleCatalog[]=>view.catalogs.map(x=>({id:x.id,version:x.version,input:x.input,currentStock:x.currentStock??null,readiness:x.readiness}));
export async function growthBundleView(who:Actor,c:Campaign){
 const [rows,history,view,stop]=await Promise.all([campaignRows<BundleRecord>(who.owner,c,kinds.current,200),database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC,id DESC LIMIT 2001').bind(who.owner,kinds.history,c.id).all<{data:string}>(),growthView(who.owner,c,who.role!=='member'),readGrowthStop(who.owner)]);
 const catalogs=catalogsOf(view);
 const bundles=await Promise.all(rows.filter(r=>inCampaign(r,c)).map(async r=>({...r,assessment:bundleAssessment(r.input,catalogs),canReserve:who.role!=='member'&&c.status!=='archived'&&stop.status==='running'&&r.reservation?.status!=='held'&&r.input.plannedQuantity>0&&bundleAssessment({...r.input,plannedQuantity:1},catalogs).missing.length===0,reservationInventory:await Promise.all((r.reservation?.components??[]).map(async component=>{const item=await optionalRecord<InventoryRow>(who.owner,'growth_inventory_item',component.inventoryId);return {inventoryId:component.inventoryId,version:item&&item.brandId===c.brandId&&item.storeId===c.storeId?item.version:null}}))})));
 return {campaignId:c.id,campaignVersion:c.version,bundles,history:history.results.slice(0,2000).map(h=>JSON.parse(h.data) as BundleRecord).filter(h=>inCampaign(h,c)),historyHasMore:history.results.length>2000,catalogs:catalogs.map(x=>({id:x.id,version:x.version,title:x.input.title,sku:x.input.sku,unit:x.input.stockUnit??'unknown',available:x.currentStock?.status==='known'?x.currentStock.available:null,inventoryId:x.currentStock?.inventoryId??null,inventoryVersion:x.currentStock?.inventoryVersion??null})),canEdit:who.role!=='member'&&c.status!=='archived',canRelease:who.role!=='member',mayExecute:false as const};
}
export type GrowthBundleView=Awaited<ReturnType<typeof growthBundleView>>;
export async function saveGrowthBundle(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.action==='reserve_bundle'||b.action==='release_bundle'){
  if(c.status==='archived'&&b.action!=='release_bundle')throw new ApiError(409,'보관한 캠페인은 예약할 수 없습니다.');
  const id=str(b.id,'번들 ID',100,true),input=parseBundleReservationRequest(b);
  return versionedMutation<BundleRecord>(who,c,b,kinds,id,{action:b.action,...input},async(old,at)=>{
   if(!old)throw new ApiError(404,'번들을 먼저 저장하세요.');
   const catalogs=catalogsOf(await growthView(who.owner,c,true)),prepared=await prepareBundleReservation(who,c,old,b,catalogs,at);
   return {next:{...old,reservation:prepared.reservation,version:old.version+1,updatedAt:at,updatedBy:who.id},extra:prepared.writes,limit:200,recovery:b.action==='release_bundle'};
  });
 }
 if(b.action!=='save_bundle')throw new ApiError(400,'지원하지 않는 번들 작업입니다.');
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');
 const input=parseBundleInput(b.input),id=str(b.id,'번들 ID',100,true);
 return versionedMutation<BundleRecord>(who,c,b,kinds,id,{action:b.action,input},async(old,at)=>{
  if(old?.reservation?.status==='held')throw new ApiError(409,'재고 예약 중인 번들은 수정할 수 없습니다. 먼저 전체 예약을 해제하세요.');
  const view=await growthView(who.owner,c,true),catalogs=catalogsOf(view);
  for(const comp of input.components){const cat=catalogs.find(x=>x.id===comp.catalogId);if(!cat)throw new ApiError(404,`현재 캠페인 상품이 아닙니다: ${comp.catalogId}`);if(cat.version!==comp.catalogVersion)throw new ApiError(409,`상품이 변경되었습니다: ${comp.catalogId}. 최신 판을 선택하세요.`)}
  if(input.priceApproved&&who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,'가격 승인은 관리자만 합니다.');
  return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,input,snapshot:{components:input.components.map(x=>({catalogId:x.catalogId,catalogVersion:x.catalogVersion}))},createdAt:(old as BundleRecord|null)?.createdAt??at,updatedAt:at,updatedBy:who.id},limit:200};
 });
}
