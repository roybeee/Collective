import {growthText} from './growth-mission';
import type {StoreOrder} from './store-operations';
export class GrowthSettlementError extends Error {}
export type SettlementEvidence={eventId:string;revision:number;kind:'expected'|'received';orderId:string;orderVersion:number;accountRef:string;settlementRef:string;receiptRef:string;currency:'KRW';amount:number|null;feeAmount:number|null;taxBasis:'unknown'|'included'|'excluded';occurredAt:string;evidenceRef:string;origin:'operator_attested'};
type SettlementOrder=Pick<StoreOrder,'id'|'version'|'paidAmount'|'refundAmount'>;
function fail(message:string):never{throw new GrowthSettlementError(message)}
function ref(value:unknown,label:string){if(label==='주문 ID'&&typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))return value;let v:string;try{v=growthText(value,label,100,true)}catch{return fail(`${label}에는 개인정보 없는 내부 식별자가 필요합니다.`)}if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v))return fail(`${label}에는 내부 식별자를 입력하세요.`);return v}
function money(value:unknown){if(value===null)return null;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>1e12)return fail('금액은 원 단위 정수 또는 미확인이어야 합니다.');return value}
function version(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)return fail('정산 증빙과 주문의 판을 확인하세요.');return value}
function instant(value:unknown){
 if(typeof value!=='string')return fail('시간대를 포함한 실제 ISO 시각이 필요합니다.');
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m||!Number.isFinite(Date.parse(value)))return fail('올바른 ISO 시각이 필요합니다.');
 const day=new Date(`${m[1]}T00:00:00Z`),zone=m[5];
 if(day.toISOString().slice(0,10)!==m[1]||Number(m[2])>23||Number(m[3])>59||Number(m[4])>59||(zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4))>59||(Number(zone.slice(1,3))===14&&Number(zone.slice(4))!==0))))return fail('유효한 날짜와 시각을 확인하세요.');
 return value;
}
export function parseSettlementEvidence(value:unknown,now:string):SettlementEvidence{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('정산 증빙 입력을 확인하세요.');
 const b=value as Record<string,unknown>;
 if(!['expected','received'].includes(String(b.kind))||b.currency!=='KRW'||!['unknown','included','excluded'].includes(String(b.taxBasis))||b.origin!=='operator_attested')return fail('정산 구분·통화·세금·출처를 확인하세요.');
 const occurredAt=instant(b.occurredAt);if(b.kind==='received'&&Date.parse(occurredAt)>Date.parse(instant(now)))return fail('실입금 시각은 미래일 수 없습니다.');
 return {eventId:ref(b.eventId,'사건 ID'),revision:version(b.revision),kind:b.kind as SettlementEvidence['kind'],orderId:ref(b.orderId,'주문 ID'),orderVersion:version(b.orderVersion),accountRef:ref(b.accountRef,'정산 계정'),settlementRef:ref(b.settlementRef,'정산 묶음'),receiptRef:ref(b.receiptRef,'개별 입금 참조'),currency:'KRW',amount:money(b.amount),feeAmount:money(b.feeAmount),taxBasis:b.taxBasis as SettlementEvidence['taxBasis'],occurredAt,evidenceRef:ref(b.evidenceRef,'증빙 참조'),origin:'operator_attested'};
}
function total(values:(number|null)[]){
 const knownAmount=values.reduce<number>((sum,value)=>sum+(value??0),0),unknownCount=values.filter(v=>v===null).length;
 if(!Number.isSafeInteger(knownAmount))return fail('정산 합계가 계산 가능한 범위를 벗어났습니다.');
 const complete=values.length>0&&unknownCount===0;
 return {total:complete?knownAmount:null,knownAmount,unknownCount,complete};
}
export function projectSettlements(orders:SettlementOrder[],raw:unknown[],now:string){
 const parsed=raw.map(value=>parseSettlementEvidence(value,now));
 const revisions=new Map<string,SettlementEvidence>(),latest=new Map<string,SettlementEvidence>();
 for(const event of parsed){
  const key=`${event.eventId}:v${event.revision}`,same=revisions.get(key),previous=latest.get(event.eventId);
  if(same&&JSON.stringify(same)!==JSON.stringify(event))return fail('같은 정산 사건·판에 상충하는 증빙이 있습니다.');
  if(previous&&(['kind','orderId','accountRef','settlementRef','receiptRef'] as const).some(k=>previous[k]!==event[k]))return fail('정산 사건의 주문·계정·입금 참조는 변경할 수 없습니다.');
  revisions.set(key,event);if(!previous||previous.revision<event.revision)latest.set(event.eventId,event);
 }
 const events=[...latest.values()],keys=events.map(e=>JSON.stringify([e.kind,e.accountRef,e.settlementRef,e.receiptRef]));
 if(new Set(keys).size!==keys.length)return fail('같은 개별 정산·입금 참조가 중복되었습니다.');
 if(new Set(orders.map(o=>o.id)).size!==orders.length)return fail('주문이 중복되었습니다.');
 for(const order of orders)if(!Number.isSafeInteger(order.paidAmount)||!Number.isSafeInteger(order.refundAmount)||order.refundAmount<0||order.paidAmount<order.refundAmount)return fail('원 주문의 결제·환불액을 확인하세요.');
 const ledgerNetRevenue=orders.reduce((sum,o)=>sum+o.paidAmount-o.refundAmount,0);if(!Number.isSafeInteger(ledgerNetRevenue))return fail('주문 합계가 계산 가능한 범위를 벗어났습니다.');
 const stale=events.some(e=>!orders.some(o=>o.id===e.orderId&&o.version===e.orderVersion));
 return {events,ledgerNetRevenue,expectedAmount:total(events.filter(e=>e.kind==='expected').map(e=>e.amount)),receivedCash:total(events.filter(e=>e.kind==='received').map(e=>e.amount)),expectedFees:total(events.filter(e=>e.kind==='expected').map(e=>e.feeAmount)),reportedFees:total(events.filter(e=>e.kind==='received').map(e=>e.feeAmount)),reconciliation:stale?'stale' as const:'not_verified' as const,reasons:stale?['주문 변경 또는 연결 누락: 최신 주문과 정산 증빙을 대사하세요.']:['운영자 입력 증빙입니다. 은행·판매자 정산 대사는 확인되지 않았습니다.'],profit:null,netCashFlow:null};
}
