import type {StoreOrder} from './store-operations';
import {growthText} from './growth-mission';

export class GrowthOrderBridgeError extends Error {}
export type OrderLineInput={orderId:string;orderVersion:number;sourceKey:string;accountId:string;externalLineId:string;inventoryId:string;units:number;missionId:string;missionVersion:number;offerId:string;offerVersion:number;paidAllocation:number|null;refundAllocation:number|null;currency:'KRW';taxBasis:'unknown'|'included'|'excluded';evidenceRef:string;source:'operator_attested'|'csv_import'};
export function emptyOrderLineInput():OrderLineInput{return {orderId:'',orderVersion:0,sourceKey:'',accountId:'',externalLineId:'',inventoryId:'',units:1,missionId:'',missionVersion:0,offerId:'',offerVersion:0,paidAllocation:null,refundAllocation:null,currency:'KRW',taxBasis:'unknown',evidenceRef:'',source:'operator_attested'}}
function fail(message:string):never{throw new GrowthOrderBridgeError(message)}
function id(v:unknown,label:string){if(label==='orderId'&&typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))return v;let s:string;try{s=growthText(v,label,100,true)}catch{return fail(`${label}은 개인정보 없는 식별자여야 합니다.`)}if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(s))return fail(`${label} 형식을 확인하세요.`);return s}
function amount(v:unknown){if(v===null)return null;if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1e12)return fail('배분 금액은 원 단위 정수 또는 미확인이어야 합니다.');return v}
export function parseOrderLineInput(value:unknown):OrderLineInput{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('주문 품목 연결 형식을 확인하세요.');
 const b=value as Record<string,unknown>;
 const refs=Object.fromEntries(['orderId','sourceKey','accountId','externalLineId','inventoryId','missionId','offerId'].map(k=>[k,id(b[k],k)]));
 for(const k of ['orderVersion','missionVersion','offerVersion','units'])if(!Number.isSafeInteger(b[k])||Number(b[k])<1||Number(b[k])>1e9)return fail('주문·미션·오퍼 판과 수량을 확인하세요.');
 if(b.currency!=='KRW'||!['unknown','included','excluded'].includes(String(b.taxBasis))||!['operator_attested','csv_import'].includes(String(b.source)))return fail('통화·세금 기준·입력 출처를 확인하세요.');
 const paidAllocation=amount(b.paidAllocation),refundAllocation=amount(b.refundAllocation);
 if(paidAllocation!==null&&refundAllocation!==null&&refundAllocation>paidAllocation)return fail('환불 배분은 결제 배분 이하여야 합니다.');
 let evidenceRef:string;try{evidenceRef=growthText(b.evidenceRef,'품목 연결 근거',200,true)}catch{return fail('개인정보 없는 품목 연결 근거가 필요합니다.')}
 return {...refs,orderVersion:b.orderVersion,missionVersion:b.missionVersion,offerVersion:b.offerVersion,units:b.units,paidAllocation,refundAllocation,currency:b.currency,taxBasis:b.taxBasis,source:b.source,evidenceRef} as OrderLineInput;
}
type AllocationOrder=Pick<StoreOrder,'id'|'version'|'paidAmount'|'refundAmount'>;
export type OrderMoneyAllocation=Pick<OrderLineInput,'orderId'|'orderVersion'|'sourceKey'|'accountId'|'externalLineId'|'paidAllocation'|'refundAllocation'>;
export function validateOrderMoneyAllocations(order:AllocationOrder,links:OrderMoneyAllocation[]){
 const none={netAllocated:null as number|null,unallocatedPaid:null as number|null,unallocatedRefund:null as number|null};
 const invalid=(reason:string)=>({...none,status:'invalid' as const,reasons:[reason]});
 if(!Number.isSafeInteger(order.paidAmount)||!Number.isSafeInteger(order.refundAmount)||order.refundAmount<0||order.paidAmount<order.refundAmount)return invalid('원 주문 금액을 확인하세요.');
 if(links.some(l=>!Number.isSafeInteger(l.orderVersion)||l.orderVersion<1||[l.paidAllocation,l.refundAllocation].some(v=>v!==null&&(!Number.isSafeInteger(v)||v<0))))return invalid('품목 연결 입력이 유효하지 않습니다.');
 if(!links.length)return {...none,status:'unallocated' as const,reasons:['품목·미션 미연결']};
 if(links.some(l=>l.orderId!==order.id))return invalid('다른 주문의 품목을 함께 배분할 수 없습니다.');
 const keys=links.map(l=>JSON.stringify([l.sourceKey,l.accountId,l.externalLineId]));
 if(new Set(keys).size!==keys.length)return invalid('같은 출처 품목이 중복 연결되었습니다.');
 const paid=links.reduce((n,l)=>n+(l.paidAllocation??0),0),refund=links.reduce((n,l)=>n+(l.refundAllocation??0),0);
 if(!Number.isSafeInteger(paid)||!Number.isSafeInteger(refund)||paid>order.paidAmount||refund>order.refundAmount)return invalid('품목 배분 합계가 원 주문의 결제·환불액을 넘습니다.');
 if(links.some(l=>l.orderVersion!==order.version))return {...none,status:'reconciliation_required' as const,reasons:['주문 변경 후 품목 배분 재대사 필요']};
 const complete=links.every(l=>l.paidAllocation!==null&&l.refundAllocation!==null);
 return {status:'current' as const,reasons:complete?[]:['일부 품목 금액 배분 미확인'],netAllocated:complete?paid-refund:null,unallocatedPaid:complete?order.paidAmount-paid:null,unallocatedRefund:complete?order.refundAmount-refund:null};
}

export function validateOrderAllocations(order:AllocationOrder,rawLinks:OrderLineInput[]){try{return validateOrderMoneyAllocations(order,rawLinks.map(parseOrderLineInput))}catch{return {netAllocated:null,unallocatedPaid:null,unallocatedRefund:null,status:'invalid' as const,reasons:['품목 연결 입력이 유효하지 않습니다.']}}}
