// C8 후속: 주문 장부 → 당근 광고 전환 이벤트(순수 모듈). 대상은 유입 채널이 당근(channel 'daangn')으로 귀속된 결제 주문이다.
// 클릭 id: 주문 장부에는 당근 광고 클릭 id를 받는 칸이 없다(가져오기 양식·POS·외부 몰 모두). 그래서 이벤트에 클릭 id·사용자 식별자를 싣지 않고,
// 주문 단위 오프라인 전환(eventId=주문 id 파생, 금액·주문일)으로만 보낸다. 당근 API가 클릭 id 없는 이벤트를 받는지는 실계정 확인 전 가정이다(docs/DAANGN-ADS.ko.md 6절).
// 거부(4xx)되면 그 묶음은 failed로 남고 다시 보내지 않는다. 묶음(집계) 전환 API는 문서로 확인되지 않아 쓰지 않는다.
import type {StoreOrder} from './store-operations';
import type {ConversionEvent} from './connectors/daangn-ads';

export const CONVERSION_EVENT_NAME='purchase';
// 장부 주문일 기준 최근 30일만 대기열에 넣는다(오래된 주문을 한꺼번에 보내지 않는다). 운영 관측으로 조정하는 초깃값이다.
export const CONVERSION_LOOKBACK_DAYS=30,CONVERSION_QUEUE_PER_TICK=100;
export type ConversionStatus='queued'|'sending'|'sent'|'failed'|'unknown';
export type DaangnConversion={id:string;orderId:string;storeId:string;brandId:string;event:ConversionEvent;clickId:null;status:ConversionStatus;queuedAt:string;queuedBy:string;send:{at:string;by:string;outcome:string|null;httpStatus:number|null;error:string|null;batch:string}|null;version:number;updatedAt:string};

const net=(o:Pick<StoreOrder,'paidAmount'|'refundAmount'>)=>o.paidAmount-o.refundAmount;
// 대상: 당근 귀속·결제 상태·순매출 > 0·창 안의 주문일. 환불·취소 주문은 넣지 않는다.
export function conversionEligible(o:Pick<StoreOrder,'channel'|'status'|'paidAmount'|'refundAmount'|'orderDate'>,today:string,lookbackDays=CONVERSION_LOOKBACK_DAYS){
 if(o.channel!=='daangn'||o.status!=='paid'||net(o)<=0)return false;
 const from=new Date(Date.parse(today+'T00:00:00Z')-lookbackDays*86400000).toISOString().slice(0,10);
 return o.orderDate>=from&&o.orderDate<=today;
}
// 이벤트: eventId는 주문 id에서만 만든다(같은 주문은 늘 같은 id → 당근 쪽 중복 제거 키). 시각은 장부에 시각이 없어 주문일 KST 00:00이다.
export function conversionEvent(o:Pick<StoreOrder,'id'|'orderDate'|'paidAmount'|'refundAmount'>):ConversionEvent{
 return {eventId:'collective-order-'+o.id,eventName:CONVERSION_EVENT_NAME,eventTime:new Date(Date.parse(o.orderDate+'T00:00:00+09:00')).toISOString(),value:net(o),currency:'KRW'};
}
// 한 번 보낸(또는 보냈을 수 있는) 행은 다시 보내지 않는다. queued만 보낼 수 있다.
export const sendable=(c:Pick<DaangnConversion,'status'>)=>c.status==='queued';
