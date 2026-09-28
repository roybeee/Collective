import type {StoreOrder} from './store-operations';
export const META_CONVERSION_PURPOSE='meta_ads_measurement' as const;
export type MetaConversionEvent={id:string;eventId:string;eventName:'Purchase';storeId:string;brandId:string;orderId:string;orderVersion:number;eventTime:number;value:number;currency:'KRW';purpose:typeof META_CONVERSION_PURPOSE;consent:'granted'|'revoked';evidenceRef:string;isTest:false;version:number;recordedAt:string;updatedAt:string;actorId:string;externalTransmissions:0};
export type MetaConversionOrder={id:string;orderDate:string;status:string;paidAmount:number;refundAmount:number;version:number;issues:string[];event:MetaConversionEvent|null};
export type MetaConversionView={orders:MetaConversionOrder[];records:MetaConversionEvent[];canEdit:boolean;mayTransmit:false;externalTransmissions:0;transmissionBlockers:string[]};
export function conversionOrderIssues(order:StoreOrder,event?:MetaConversionEvent){
 return [...(order.status!=='paid'?['취소·전액 환불 주문은 구매 전환으로 준비할 수 없습니다.']:[]),...(order.refundAmount>0?['환불이 있는 주문은 새 구매 전환으로 준비할 수 없습니다.']:[]),...(order.paidAmount<=0?['실제 결제 금액이 필요합니다.']:[]),...(event&&event.orderVersion!==order.version?['준비 후 주문 장부가 변경되었습니다. 기존 이벤트는 전송할 수 없습니다.']:[]),...(event?.consent==='revoked'?['전환 측정 동의가 철회되었습니다.']:[])];
}
