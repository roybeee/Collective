import type {Campaign} from './agency';
import {growthView} from './growth-workspace-server';
import {bundleAssessment,parseBundleInput,type BundleCatalog,type BundleInput} from './growth-bundle';
import {campaignRows,inCampaign,versionedMutation,type Versioned} from './growth-ledger-server';
import {ApiError,str,type Actor} from './server';
const kinds={current:'growth_bundle',history:'growth_bundle_history',request:'growth_bundle_request'} as const;
export type BundleRecord=Versioned&{input:BundleInput;snapshot:{components:{catalogId:string;catalogVersion:number}[]};createdAt:string;updatedAt:string;updatedBy:string};
const catalogsOf=(view:Awaited<ReturnType<typeof growthView>>):BundleCatalog[]=>view.catalogs.map(x=>({id:x.id,version:x.version,input:x.input,currentStock:x.currentStock??null,readiness:x.readiness}));
export async function growthBundleView(who:Actor,c:Campaign){
 const [rows,history,view]=await Promise.all([campaignRows<BundleRecord>(who.owner,c,kinds.current,200),campaignRows<BundleRecord>(who.owner,c,kinds.history,2000),growthView(who.owner,c,who.role!=='member')]);
 const catalogs=catalogsOf(view);
 return {campaignId:c.id,campaignVersion:c.version,bundles:rows.filter(r=>inCampaign(r,c)).map(r=>({...r,assessment:bundleAssessment(r.input,catalogs)})),history:history.filter(h=>inCampaign(h,c)),catalogs:catalogs.map(x=>({id:x.id,version:x.version,title:x.input.title,sku:x.input.sku,unit:x.input.stockUnit??'unknown',available:x.currentStock?.status==='known'?x.currentStock.available:null})),canEdit:who.role!=='member'&&c.status!=='archived',mayExecute:false as const};
}
export type GrowthBundleView=Awaited<ReturnType<typeof growthBundleView>>;
export async function saveGrowthBundle(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.action!=='save_bundle')throw new ApiError(400,'지원하지 않는 번들 작업입니다.');
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');
 const input=parseBundleInput(b.input),id=str(b.id,'번들 ID',100,true);
 return versionedMutation<BundleRecord>(who,c,b,kinds,id,{action:b.action,input},async(old,at)=>{
  const view=await growthView(who.owner,c,true),catalogs=catalogsOf(view);
  for(const comp of input.components){const cat=catalogs.find(x=>x.id===comp.catalogId);if(!cat)throw new ApiError(404,`현재 캠페인 상품이 아닙니다: ${comp.catalogId}`);if(cat.version!==comp.catalogVersion)throw new ApiError(409,`상품이 변경되었습니다: ${comp.catalogId}. 최신 판을 선택하세요.`)}
  if(input.priceApproved&&who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,'가격 승인은 관리자만 합니다.');
  return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,input,snapshot:{components:input.components.map(x=>({catalogId:x.catalogId,catalogVersion:x.catalogVersion}))},createdAt:(old as BundleRecord|null)?.createdAt??at,updatedAt:at,updatedBy:who.id},limit:200};
 });
}
