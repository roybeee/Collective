import {growthText} from './growth-mission';
export class GrowthConsumerError extends Error {}
export const consumerPurposes=['identity_link','post_purchase','marketing_reorder'] as const;
export type ConsumerPurpose=typeof consumerPurposes[number];
export type ConsumerConsent={purpose:ConsumerPurpose;state:'granted'|'revoked';noticeVersion:string;evidenceRef:string;observedAt:string;expiresAt:string;recordedAt?:string;withdrawnAt?:string};
export type ConsumerConsents=Record<ConsumerPurpose,ConsumerConsent|null>;
export const emptyConsumerConsents=():ConsumerConsents=>({identity_link:null,post_purchase:null,marketing_reorder:null});
function fail(s:string):never{throw new GrowthConsumerError(s)}
export function consumerEvidence(v:unknown,label:string){
 if(typeof v!=='string')return fail(`${label}을 입력하세요.`);
 const normalized=v.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'');
 if(/(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(normalized))return fail('인증정보는 저장할 수 없습니다.');
 try{return growthText(normalized,label,120,true)}catch{return fail(`${label}: 개인정보 없는 근거 식별자를 입력하세요.`)}
}
function instant(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,19)!==v.slice(0,19))return fail('UTC 일시를 확인하세요.');return v}
export function parseConsent(b:Record<string,unknown>,now=Date.now()):ConsumerConsent{
 if(!consumerPurposes.includes(b.purpose as ConsumerPurpose)||!['granted','revoked'].includes(String(b.state)))return fail('동의 목적·상태를 확인하세요.');
 const purpose=b.purpose as ConsumerPurpose;
 if(b.state==='revoked')return {purpose,state:'revoked',noticeVersion:'',evidenceRef:'',observedAt:new Date(now).toISOString(),expiresAt:'',withdrawnAt:new Date(now).toISOString()};
 const observedAt=instant(b.observedAt),expiresAt=instant(b.expiresAt);
 if(Date.parse(observedAt)>now||Date.parse(expiresAt)<=now||Date.parse(expiresAt)<=Date.parse(observedAt))return fail('동의 관측 시각·유효기간을 확인하세요.');
 return {purpose,state:'granted',noticeVersion:consumerEvidence(b.noticeVersion,'고지 판'),evidenceRef:consumerEvidence(b.evidenceRef,'동의 근거'),observedAt,expiresAt};
}
export function parseWaitDays(v:unknown=30){if(!Number.isInteger(v)||Number(v)<0||Number(v)>365)return fail('재구매 대기는 0~365일 정수여야 합니다.');return Number(v)}
export function consentActive(c:ConsumerConsent|null|undefined,now=Date.now()){return !!c&&c.state==='granted'&&Date.parse(c.observedAt)<=now&&Date.parse(c.expiresAt)>now}
export type ConsumerOrder={id:string;version:number;orderDate:string;status:string;paidAmount:number;refundAmount:number};
export function consumerAssessment(consents:ConsumerConsents,links:{order:ConsumerOrder|null;orderVersion:number}[],waitDays=30,now=Date.now()){
 parseWaitDays(waitDays);
 const reasons:string[]=[],today=new Date(now+9*3600000).toISOString().slice(0,10);
 if(!consentActive(consents.identity_link,now))return {postPurchaseEligible:false,reorderEligible:false,reasons:['고객·주문 연결 동의 없음 또는 만료'],latestPurchaseAt:null,waitDays,maySend:false as const,mayExecute:false as const};
 if(!links.length)reasons.push('현재 매장 구매 연결 없음');
 const dates=links.map(({order,orderVersion})=>{
  if(!order||order.version!==orderVersion){reasons.push('주문 변경·삭제 후 연결 재확인');return ''}
  if(order.status!=='paid'||!Number.isSafeInteger(order.paidAmount)||order.paidAmount<=0||order.refundAmount!==0){reasons.push('취소·환불·결제액 확인 필요');return ''}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(order.orderDate)||!Number.isFinite(Date.parse(order.orderDate))||new Date(order.orderDate).toISOString().slice(0,10)!==order.orderDate||order.orderDate>today){reasons.push('구매일 미확인 또는 미래');return ''}
  return order.orderDate;
 }).filter(Boolean).sort();
 const latestPurchaseAt=dates.at(-1)??null,base=reasons.length===0;
 const postPurchaseEligible=base&&consentActive(consents.post_purchase,now);
 const elapsedDays=latestPurchaseAt?Math.floor((Date.parse(today)-Date.parse(latestPurchaseAt))/86400000):null;
 const reorderEligible=base&&consentActive(consents.marketing_reorder,now)&&elapsedDays!==null&&elapsedDays>=waitDays;
 if(!consentActive(consents.post_purchase,now))reasons.push('구매 후 관리 목적 동의 없음 또는 만료');
 if(!consentActive(consents.marketing_reorder,now))reasons.push('재구매 마케팅 목적 동의 없음 또는 만료');
 if(elapsedDays!==null&&elapsedDays<waitDays)reasons.push('운영자가 정한 재구매 대기일 미충족');
 return {postPurchaseEligible,reorderEligible,reasons:[...new Set(reasons)],latestPurchaseAt,waitDays,maySend:false as const,mayExecute:false as const};
}
