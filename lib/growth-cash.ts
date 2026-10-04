import {executionSafeText} from './growth-execution';
/** Actual KRW movements only. Operator evidence is not a bank verification or a forecast. */
export class GrowthCashError extends Error {}
export const cashKinds=['inventory_purchase','marketing_payment','refund_payment','fee_payment','other_payment','other_receipt'] as const;
export type CashKind=typeof cashKinds[number];
export type CashInput={kind:CashKind;accountRef:string;receiptRef:string;currency:'KRW';amount:number|null;occurredAt:string;evidenceRef:string;reason:string;origin:'operator_attested'};
export type CashPeriod={from:string;to:string};
function fail(message:string):never{throw new GrowthCashError(message)}
function safe(value:string,label:string,max:number){
 // 같은 공용 PII·인증정보 검사에 JSON 따옴표·호환문자·폭 없는 문자 우회를 정규화해 보낸다.
 try{executionSafeText(value.normalize('NFKC').replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g,'').replace(/["']/g,''),label,max)}catch{return fail(`${label}에 식별정보와 인증정보를 넣을 수 없습니다.`)}
 return value.trim();
}
export function cashRef(value:unknown,label:string){if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value))return fail(`${label}에는 개인정보 없는 내부 참조를 입력하세요.`);return safe(value,label,100)}
export function cashReason(value:unknown){if(typeof value!=='string'||value.trim().length<5||value.length>300)return fail('기록·정정 사유는 5~300자로 입력하세요.');return safe(value,'기록·정정 사유',300)}
export function cashDay(value:unknown){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value}
export function cashPeriod(value:unknown):CashPeriod{
 const v=value as Partial<CashPeriod>|null;
 if(!v||!cashDay(v.from)||!cashDay(v.to)||v.from!>v.to!||Date.parse(v.to!)-Date.parse(v.from!)>366*86400000)return fail('현금 기간은 유효한 시작일·종료일, 최대 1년이어야 합니다.');
 return {from:v.from!,to:v.to!};
}
export function parseCashInput(value:unknown,now:string):CashInput{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('실제 현금 입력을 확인하세요.');
 const v=value as Record<string,unknown>;
 if(!cashKinds.includes(v.kind as CashKind)||v.currency!=='KRW'||v.origin!=='operator_attested')return fail('실제 입출금 종류·KRW·운영자 확인 출처가 필요합니다.');
 if(v.amount!==null&&(typeof v.amount!=='number'||!Number.isSafeInteger(v.amount)||v.amount<0||v.amount>1e12))return fail('실제 금액은 0 이상 원 단위 정수 또는 미확인입니다.');
 const raw=v.occurredAt;
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)||!cashDay(raw.slice(0,10))||!Number.isFinite(Date.parse(raw))||raw.slice(11,19)!==new Date(raw).toISOString().slice(11,19)||Date.parse(raw)>Date.parse(now))return fail('실제 입출금 시각은 미래가 아닌 UTC ISO 시각이어야 합니다.');
 return {kind:v.kind as CashKind,accountRef:cashRef(v.accountRef,'계정 참조'),receiptRef:cashRef(v.receiptRef,'은행 거래 참조'),currency:'KRW',amount:v.amount as number|null,occurredAt:new Date(raw).toISOString(),evidenceRef:cashRef(v.evidenceRef,'입출금 증빙'),reason:cashReason(v.reason),origin:'operator_attested'};
}
// received settlements and bank entries MUST use the same opaque bank account/transaction reference.
export const cashIdentity=(x:{accountRef:string;receiptRef:string})=>JSON.stringify([x.accountRef,x.receiptRef]);
export const cashDirection=(kind:CashKind)=>kind==='other_receipt'?'in' as const:'out' as const;
export type ActualCashSummary={netCashFlow:number|null;actualReceipts:number|null;actualPayments:number|null;coverageStatus:'missing'|'stale'|'complete';verification:'operator_attested';unknownItems:number;duplicateIdentities:number;reasons:string[]};
