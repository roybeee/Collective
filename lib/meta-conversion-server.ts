import type {Campaign} from './agency';
import type {Store} from './store-marketing';
import type {StoreOrder} from './store-operations';
import type {StorefrontOrderLink} from './storefront-orders';
import {storefrontDigest} from './storefront-orders';
import {conversionOrderIssues,type MetaConversionEvent,type MetaConversionView} from './meta-conversion';
import {ApiError,listRecords,readRecord} from './server';
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
 const scoped=records.filter(x=>x.brandId===store.brandId&&x.storeId===store.id),linked=new Set(links.filter(x=>x.brandId===store.brandId&&x.storeId===store.id).map(x=>x.orderId));
 return {canEdit,mayTransmit:false,externalTransmissions:0,transmissionBlockers:['외부 전환 전송 기능은 비활성 상태입니다.','Meta 데이터셋·고객 동의 수집 경로·허용 필드 계약과 실제 테스트 검증 후 별도 활성화가 필요합니다.'],records:scoped,orders:orders.filter(x=>x.storeId===store.id&&linked.has(x.id)).map(x=>{const event=scoped.find(e=>e.orderId===x.id)??null;return {id:x.id,orderDate:x.orderDate,status:x.status,paidAmount:x.paidAmount,refundAmount:x.refundAmount,version:x.version,issues:conversionOrderIssues(x,event??undefined),event}})};
}
