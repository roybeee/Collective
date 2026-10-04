import type {Campaign} from './agency';
import {ApiError,database,recordStatement,stamp,type Actor} from './server';
import {appendRow,campaignRows,optionalRecord} from './growth-ledger-server';
import {openRecordSecret,sealRecordSecret} from './credential-crypto-server';
import {storefrontDigest} from './storefront-orders';
import {scanText} from './pii-scan';
import {deliveryKinds,deliveryNeedsReceipt,type DeliveryRow} from './growth-consumer-delivery';
export type DeliveryConnection={id:string;channel:'growth_consumer_delivery';brandId:string;campaignId:string;storeId:string;tenantId:string;providerStoreId:string;secret:string;enabled:boolean;version:number;updatedAt:string};
export const deliveryConnectionId=(c:Campaign)=>`growth_consumer_delivery:${c.id}`;
export async function deliveryConnection(owner:string,c:Campaign,allowPreviousStore=false){const x=await optionalRecord<DeliveryConnection>(owner,'channel_credential',deliveryConnectionId(c));if(x&&(x.channel!=='growth_consumer_delivery'||x.brandId!==c.brandId||x.campaignId!==c.id||(!allowPreviousStore&&x.storeId!==c.storeId)))throw new ApiError(409,'매장 연결이 변경되었습니다. 소유자가 연결을 다시 확인하세요.');return x}
export const publicDeliveryConnection=(x:DeliveryConnection|null)=>x?{version:x.version,enabled:x.enabled,tenantId:x.tenantId,providerStoreId:x.providerStoreId,configured:true}:{version:0,enabled:false,tenantId:'',providerStoreId:'',configured:false};
export const deliverySecret=(owner:string,x:DeliveryConnection)=>openRecordSecret(owner,'channel_credential',x.id,x.secret);
export async function configureDelivery(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(who.role!=='owner')throw new ApiError(403,'소유자만 발송 연결을 설정할 수 있습니다.');
 if(c.status==='archived'||!c.storeId||c.version!==b.campaignVersion)throw new ApiError(409,'현재 활성 매장 캠페인이 필요합니다.');
 const digest=await storefrontDigest(b),request=await optionalRecord<{digest:string;id:string;version:number}>(who.owner,deliveryKinds.request,String(b.requestId));
 if(request){if(request.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return {recorded:true,duplicate:true,connection:publicDeliveryConnection(await deliveryConnection(who.owner,c))}}
 const old=await deliveryConnection(who.owner,c,true);if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'연결 판이 변경되었습니다.');
 const x=b.config as Record<string,unknown>;if(!x||typeof x!=='object'||Object.keys(x).some(k=>!['tenantId','providerStoreId','secret','enabled'].includes(k))||typeof x.enabled!=='boolean')throw new ApiError(400,'연결 입력을 확인하세요.');
 const identifier=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v)&&scanText(v).length===0;
 if(!identifier(x.tenantId)||!identifier(x.providerStoreId)||(!old&&x.enabled))throw new ApiError(400,'최초 연결은 비활성으로 저장하세요. 테넌트와 매장 ID를 확인하세요.');
 const secret=x.secret===undefined||x.secret===''?old?await deliverySecret(who.owner,old):'':x.secret;
 if(typeof secret!=='string'||secret.length<32||secret.length>512)throw new ApiError(400,'32~512자 서명 비밀값이 필요합니다.');
 const unresolved=(await campaignRows<DeliveryRow>(who.owner,c,deliveryKinds.current,500)).filter(r=>deliveryNeedsReceipt(r)||r.cancelPending);
 if(unresolved.length&&(!old||x.tenantId!==old.tenantId||x.providerStoreId!==old.providerStoreId||secret!==await deliverySecret(who.owner,old)||(x.enabled&&old.storeId!==c.storeId)))throw new ApiError(409,'미확정 발송의 영수증·취소 대사 전에는 제공자 식별자와 서명 키를 변경할 수 없습니다. 같은 연결의 비활성화는 가능합니다.');
 const id=deliveryConnectionId(c),next:DeliveryConnection={id,channel:'growth_consumer_delivery',brandId:c.brandId,campaignId:c.id,storeId:unresolved.length&&old?old.storeId:c.storeId,tenantId:String(x.tenantId),providerStoreId:String(x.providerStoreId),secret:await sealRecordSecret(who.owner,'channel_credential',id,secret),enabled:x.enabled,version:(old?.version??0)+1,updatedAt:stamp()};
 await database().batch([recordStatement(who.owner,'channel_credential',id,next,c.brandId),appendRow(who.owner,c,deliveryKinds.request,String(b.requestId),{id,digest,version:next.version},next.updatedAt)]);return {recorded:true,connection:publicDeliveryConnection(next)};
}
