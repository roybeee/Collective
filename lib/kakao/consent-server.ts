// C6 수신동의 원장 서버(docs/KAKAO-BIZMESSAGE.ko.md 5절). 레코드: marketing_consent(수신자 해시당 1행)·marketing_optout·kakao_friend_relation·kakao_reconsent_notice. 모두 브랜드(parent_id)에 묶이고 캠페인과 무관하다.
// 전화번호 원문은 요청 처리 중 메모리에만 있고 레코드·응답·오류 문구·로그에 남기지 않는다. 가져오기는 CSV를 줄마다 수동 검증한다(lib/kakao/consent.ts).
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from '../server';
import type {Brand} from '../agency';
import {CONSENT_CHANNEL,consentRecordId,consentState,isRecipientHash,normalizePhone,parseConsentCsv,recipientHash,reconsentDue,reconsentNotice,type ConsentRecord,type FriendRelationRecord,type OptoutRecord,type ReconsentNotice} from './consent';

// kind 리터럴은 tests/record-kinds.test.mjs 스캐너가 읽는 모양(kinds 상수 객체)으로 둔다.
const kinds={consent:'marketing_consent',optout:'marketing_optout',friend:'kakao_friend_relation',notice:'kakao_reconsent_notice'} as const;
export const CONSENT_KINDS=kinds;
const optional=async<T>(owner:string,kind:string,id:string):Promise<T|null>=>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}};
const rowsOf=async<T>(owner:string,kind:string,brandId:string,limit:number):Promise<T[]>=>(await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT ?').bind(owner,kind,brandId,limit).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as T);

export async function requireBrand(owner:string,brandId:unknown){
 const id=str(brandId,'브랜드',100,true);
 if(id.includes(':'))throw new ApiError(400,'브랜드 입력을 확인해 주세요.');
 try{await readRecord<Brand>(owner,'brand',id)}catch(e){if(e instanceof ApiError&&e.status===404)throw new ApiError(404,'브랜드를 찾을 수 없습니다.');throw e}
 return id;
}
// 수신자 식별: 해시(64 hex)를 그대로 받거나 전화번호를 받아 해시한다. 번호는 여기서 끝난다.
export async function resolveRecipientHash(owner:string,input:{recipientHash?:unknown;phone?:unknown}){
 if(input.recipientHash!==undefined){if(!isRecipientHash(input.recipientHash))throw new ApiError(400,'수신자 해시 형식을 확인해 주세요.');return input.recipientHash}
 const phone=normalizePhone(str(input.phone,'휴대전화 번호',40,true));
 if(!phone)throw new ApiError(400,'휴대전화 번호 형식이 아닙니다.');
 return recipientHash(owner,phone);
}
export const readConsent=(owner:string,brandId:string,hash:string)=>optional<ConsentRecord>(owner,CONSENT_KINDS.consent,consentRecordId(brandId,hash));
export const readOptout=(owner:string,brandId:string,hash:string)=>optional<OptoutRecord>(owner,CONSENT_KINDS.optout,consentRecordId(brandId,hash));
export const listConsents=(owner:string,brandId:string,limit=10000)=>rowsOf<ConsentRecord>(owner,CONSENT_KINDS.consent,brandId,limit);

export type ImportSummary={brandId:string;rows:number;created:number;renewed:number;unchanged:number;errors:string[]};
// CSV 가져오기(관리자). 오류가 하나라도 있으면 저장하지 않는다(부분 반영 없음). 같은 수신자의 더 늦은 동의 일시는 갱신(철회 해제), 더 이른 일시는 무시한다.
export async function importConsents(owner:string,who:Actor,input:Record<string,unknown>,nowMs=Date.now()):Promise<ImportSummary>{
 const brandId=await requireBrand(owner,input.brandId),csv=str(input.csv,'CSV',2_000_000,true);
 const parsed=parseConsentCsv(csv,nowMs);
 if(parsed.errors.length)return {brandId,rows:parsed.rows.length,created:0,renewed:0,unchanged:0,errors:parsed.errors.slice(0,50)};
 const at=stamp(),writes:D1PreparedStatement[]=[];let created=0,renewed=0,unchanged=0;
 const seen=new Set<string>();
 for(const row of parsed.rows){
  const hash=await recipientHash(owner,row.phone);
  if(seen.has(hash)){unchanged++;continue}seen.add(hash);
  const id=consentRecordId(brandId,hash),previous=await optional<ConsentRecord>(owner,CONSENT_KINDS.consent,id);
  if(previous&&Date.parse(previous.consentedAt)>=Date.parse(row.consentedAt)&&!previous.revokedAt){unchanged++;continue}
  const record:ConsentRecord={id,recipientHash:hash,brandId,channel:CONSENT_CHANNEL,consentedAt:row.consentedAt,source:row.source,nightConsent:row.nightConsent,revokedAt:null,createdAt:previous?.createdAt??at,updatedAt:at,updatedBy:who.id};
  writes.push(recordStatement(owner,CONSENT_KINDS.consent,id,record,brandId));
  if(previous)renewed++;else created++;
 }
 if(writes.length)await database().batch(writes);
 return {brandId,rows:parsed.rows.length,created,renewed,unchanged,errors:[]};
}
// 수신거부(옵트아웃). 동의 레코드가 있으면 철회 시각을 적고, 수신거부 레코드를 남긴다. 둘 다 같은 묶음으로 쓴다.
export async function recordOptout(owner:string,who:Actor,input:Record<string,unknown>){
 const brandId=await requireBrand(owner,input.brandId),hash=await resolveRecipientHash(owner,input),at=stamp(),id=consentRecordId(brandId,hash);
 const source=input.source===undefined?'manual':str(input.source,'출처',100,true);
 const optout:OptoutRecord={id,recipientHash:hash,brandId,channel:CONSENT_CHANNEL,optedOutAt:at,source,createdAt:at,updatedBy:who.id};
 const writes=[recordStatement(owner,CONSENT_KINDS.optout,id,optout,brandId)];
 const consent=await readConsent(owner,brandId,hash);
 if(consent&&!consent.revokedAt)writes.push(recordStatement(owner,CONSENT_KINDS.consent,id,{...consent,revokedAt:at,updatedAt:at,updatedBy:who.id} satisfies ConsentRecord,brandId));
 await database().batch(writes);
 return {brandId,recipientHash:hash,optedOutAt:at,consentRevoked:!!consent&&!consent.revokedAt};
}
export async function consentSummary(owner:string,brandId:string,nowMs=Date.now()){
 const [consents,optouts]=await Promise.all([listConsents(owner,brandId),rowsOf<OptoutRecord>(owner,CONSENT_KINDS.optout,brandId,10000)]);
 const counts={active:0,expired:0,revoked:0,invalid:0,none:0};
 for(const c of consents)counts[consentState(c,nowMs)]++;
 const due=reconsentDue(consents,nowMs);
 return {brandId,total:consents.length,counts,optouts:optouts.length,reconsentDue:due.length,reconsent:due.slice(0,200)};
}
// 재동의 안내 생성(하루 1건, 같은 날 재실행은 기존 안내를 돌려준다). 안건 알림용 레코드이며 외부 전송은 없다.
export async function generateReconsentNotice(owner:string,who:Actor,brandId:string,nowMs=Date.now()):Promise<ReconsentNotice|null>{
 const due=reconsentDue(await listConsents(owner,brandId),nowMs),notice=reconsentNotice(brandId,due,nowMs,who.id);
 if(!notice)return null;
 const existing=await optional<ReconsentNotice>(owner,CONSENT_KINDS.notice,notice.id);
 if(existing)return existing;
 await recordStatement(owner,CONSENT_KINDS.notice,notice.id,notice,brandId).run();
 return notice;
}
export const listReconsentNotices=(owner:string,brandId:string)=>rowsOf<ReconsentNotice>(owner,CONSENT_KINDS.notice,brandId,100);
export const readFriendRelation=(owner:string,brandId:string,hash:string)=>optional<FriendRelationRecord>(owner,CONSENT_KINDS.friend,consentRecordId(brandId,hash));
export const friendRelationStatement=(owner:string,record:FriendRelationRecord)=>recordStatement(owner,CONSENT_KINDS.friend,record.id,record,record.brandId);
