import {parseCsv,personalDataKind} from './order-import';
import type {StoreOrder} from './store-operations';
export const storefrontColumns=['order_id','revision','order_date','status','paid_amount','refund_amount','mode'] as const;
export const storefrontTemplate=storefrontColumns.join(',')+'\n';
export type StorefrontRow={externalId:string;revision:number;orderDate:string;status:StoreOrder['status'];paidAmount:number;refundAmount:number;mode:StoreOrder['mode']};
export type StorefrontOrderLink={id:string;storeId:string;brandId:string;sourceKey:string;externalId:string;revision:number;digest:string;orderId:string;orderVersion:number;updatedAt:string};
export class StorefrontInputError extends Error {}
export function storefrontSource(value:unknown){if(typeof value!=='string'||!/^([a-z0-9][a-z0-9_-]{1,39})$/.test(value))throw new StorefrontInputError('몰 식별자는 영문 소문자·숫자·밑줄·하이픈 2~40자로 입력하세요.');return value}
export function parseStorefrontOrders(csv:unknown,today:string):StorefrontRow[]{
 if(typeof csv!=='string')throw new StorefrontInputError('주문 CSV를 선택하세요.');const {headers,rows}=parseCsv(csv);
 if(headers.length!==storefrontColumns.length||storefrontColumns.some((x,i)=>headers[i]!==x))throw new StorefrontInputError('제공한 주문 양식의 열 순서를 유지하세요. 고객 정보는 가져올 수 없습니다.');
 if(rows.length>100)throw new StorefrontInputError('한 번에 최대 100개 주문을 가져올 수 있습니다.');
 const seen=new Set<string>();const amount=(v:string)=>{if(!/^\d{1,12}$/.test(v)||Number(v)>1e12)throw new StorefrontInputError('금액은 0 이상의 원화 정수로 입력하세요.');return Number(v)};
 return rows.map((r,i)=>{const [externalId,rev,orderDate,status,paid,refund,mode]=r;
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(externalId)||personalDataKind(externalId,false))throw new StorefrontInputError(`${i+2}행: 고객 정보가 아닌 몰 주문 ID를 입력하세요.`);
  if(seen.has(externalId))throw new StorefrontInputError(`${i+2}행: 주문이 중복되었습니다. 가장 최신 상태 한 행만 남기세요.`);seen.add(externalId);
  if(!/^[1-9]\d{0,9}$/.test(rev))throw new StorefrontInputError(`${i+2}행: 변경 순서는 1 이상의 정수로 입력하세요.`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)||!Number.isFinite(Date.parse(orderDate))||new Date(orderDate).toISOString().slice(0,10)!==orderDate||orderDate>today)throw new StorefrontInputError(`${i+2}행: 주문일을 확인하세요.`);
  if(!['paid','refunded','cancelled'].includes(status)||!['hall','pickup','delivery','group'].includes(mode))throw new StorefrontInputError(`${i+2}행: 주문 상태 또는 주문 방식을 확인하세요.`);
  const paidAmount=amount(paid),refundAmount=amount(refund);
  if(refundAmount>paidAmount||(status!=='paid'&&paidAmount!==refundAmount)||(status==='paid'&&paidAmount>0&&refundAmount===paidAmount))throw new StorefrontInputError(`${i+2}행: 결제·누적 환불 금액과 주문 상태가 맞지 않습니다.`);
  return {externalId,revision:Number(rev),orderDate,status:status as StoreOrder['status'],paidAmount,refundAmount,mode:mode as StoreOrder['mode']};
 });
}
export const storefrontDigest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),x=>x.toString(16).padStart(2,'0')).join('');
