// C6 후속: 전송 화면의 수신자 묶음(순수). 수신동의 원장(해시만)을 동의 상태로 나눠 수와 해시만 보인다. 번호는 어디에도 없다.
// 묶음: active(유효 동의, 수신거부 아님) · night(유효 동의 + 야간 동의) · renewal_due(유효하지만 23개월 경과, 곧 재동의) · informational(알림톡 정보성: 수신거부만 뺀 원장 전체).
// 비용 추정 단가는 딜러 계약 전 가정이다(딜러·발송량·메시지 형식마다 다르다). 화면은 '추정'으로만 보이고 실제 비용은 딜러 결과(costKrw)가 정한다.
import {consentState,reconsentDue,type ConsentRecord} from './consent';
import type {MessageType} from './types';

export const SEGMENTS=['active','night','renewal_due','informational'] as const;
export type Segment=typeof SEGMENTS[number];
export const SEGMENT_RECIPIENT_LIMIT=50;
// 가정 단가(원/건, 부가세 별도). 계약한 딜러 단가로 이 표만 바꾼다(docs/KAKAO-BIZMESSAGE.ko.md 6절).
export const ESTIMATED_UNIT_KRW:Readonly<Record<MessageType,number>>={alimtalk:8,brand:20};
export const isSegment=(v:unknown):v is Segment=>typeof v==='string'&&(SEGMENTS as readonly string[]).includes(v);

// renewalDue: lib/kakao/consent.ts reconsentDue가 '활성·23개월 경과'로 고른 해시(재동의 안내와 같은 기준).
export function inSegment(c:ConsentRecord,segment:Segment,ctx:{optedOut:ReadonlySet<string>;renewalDue:ReadonlySet<string>},nowMs:number){
 if(ctx.optedOut.has(c.recipientHash))return false;
 if(segment==='informational')return true;
 if(consentState(c,nowMs)!=='active')return false;
 if(segment==='night')return c.nightConsent;
 if(segment==='renewal_due')return ctx.renewalDue.has(c.recipientHash);
 return true;
}
export function segmentView(consents:readonly ConsentRecord[],optedOut:ReadonlySet<string>,segment:Segment,nowMs:number){
 const ctx={optedOut,renewalDue:new Set(reconsentDue(consents,nowMs).filter(d=>d.state==='active').map(d=>d.recipientHash))};
 const members=consents.filter(c=>inSegment(c,segment,ctx,nowMs)).sort((a,b)=>a.recipientHash.localeCompare(b.recipientHash));
 const counts=Object.fromEntries(SEGMENTS.map(s=>[s,consents.filter(c=>inSegment(c,s,ctx,nowMs)).length])) as Record<Segment,number>;
 return {segment,count:members.length,counts,recipients:members.slice(0,SEGMENT_RECIPIENT_LIMIT).map(c=>c.recipientHash)};
}
export const estimateCost=(type:MessageType,count:number)=>({unitKrw:ESTIMATED_UNIT_KRW[type],totalKrw:ESTIMATED_UNIT_KRW[type]*Math.max(0,count),assumed:true as const});
