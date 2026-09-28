import type {Campaign} from './agency';
import type {Store} from './store-marketing';
import type {StoreOrder} from './store-operations';
import type {StorefrontOrderLink} from './storefront-orders';
import {storefrontDigest} from './storefront-orders';
import {conversionOrderIssues,type MetaConversionEvent,type MetaConversionView} from './meta-conversion';
import {ApiError,listRecords,readRecord} from './server';
import {metaCapiView} from './meta-capi-server';
export const conversionId=(owner:string,brandId:string,storeId:string,orderId:string)=>storefrontDigest(['meta-purchase-v1',owner,brandId,storeId,orderId]).then(x=>'purchase_'+x);
export async function conversionContext(owner:string,campaignId:string){
 const campaign=await readRecord<Campaign>(owner,'campaign',campaignId);
 if(!campaign.storeId)throw new ApiError(409,'캠페인에 지점을 먼저 연결하세요.');
 const store=await readRecord<Store>(owner,'store',campaign.storeId);
 if(store.brandId!==campaign.brandId)throw new ApiError(409,'캠페인과 지점의 브랜드가 다릅니다.');
 return {campaign,store};
}
export async function conversionView(owner:string,store:Store,canEdit:boolean):Promise<MetaConversionView>{
 const [links,orders,records]=await Promise.all([listRecords<StorefrontOrderLink>(owner,'storefront_order_link',store.id),listRecords<StoreOrder>(owner,'store_order',store.id),listRecords<MetaConversionEvent>(owner,'meta_conversion_event',store.id)]);
 const capi=await metaCapiView(owner,store),scoped=records.filter(x=>x.brandId===store.brandId&&x.storeId===store.id).map(x=>({...x,externalTransmissions:capi.operations.find(o=>o.id===x.id)?.attempts??0})),linked=new Set(links.filter(x=>x.brandId===store.brandId&&x.storeId===store.id).map(x=>x.orderId));
 return {canEdit,capi,mayTransmit:capi.enabled&&!!capi.connection?.connected,externalTransmissions:capi.operations.reduce((n,x)=>n+x.attempts,0),transmissionBlockers:[...(!capi.enabled?['외부 전환 전송 기능 스위치가 꺼져 있습니다.']:[]),...(!capi.connection?.connected?['전환 전용 데이터셋·토큰·자사몰 주소 연결이 필요합니다.']:[]),'주문별 별도 고객 필드 동의와 전송 예약이 필요합니다.'],records:scoped,orders:orders.filter(x=>x.storeId===store.id&&linked.has(x.id)).map(x=>{const event=scoped.find(e=>e.orderId===x.id)??null;return {id:x.id,orderDate:x.orderDate,status:x.status,paidAmount:x.paidAmount,refundAmount:x.refundAmount,version:x.version,issues:conversionOrderIssues(x,event??undefined),event}})};
}
