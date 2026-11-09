// C6 수신동의 원장의 순수 부분(docs/KAKAO-BIZMESSAGE.ko.md 5절). 전화번호는 정규화 뒤 SHA-256(소유자·용도 접두)으로 해시해 쓰고 원문은 어디에도 저장·기록하지 않는다.
// (가맹 리드 연락처(lib/franchise-crypto.ts)는 암호화 보관이 필요한 경우라 HMAC·AES를 쓴다. 여기는 번호를 되돌릴 일이 없어 해시만 둔다. 딜러에 보낼 번호는 전송 요청 때 사람이 넣고 레코드에는 남기지 않는다.)
// CSV 가져오기는 수동 검증이다: 열 이름·날짜·불리언을 줄마다 검사하고, 오류 문구에는 줄 번호만 적는다(번호 없음).
import {addMonths,consentStateOf,RENEWAL_WARN_MONTHS,type ConsentSnapshot,type ConsentState} from './compliance';

export const CONSENT_CHANNEL='kakao';
export type ConsentRecord={id:string;recipientHash:string;brandId:string;channel:typeof CONSENT_CHANNEL;consentedAt:string;source:string;nightConsent:boolean;revokedAt:string|null;createdAt:string;updatedAt:string;updatedBy:string};
export type OptoutRecord={id:string;recipientHash:string;brandId:string;channel:typeof CONSENT_CHANNEL;optedOutAt:string;source:string;createdAt:string;updatedBy:string};
export type FriendRelation='ADDED'|'BLOCKED'|'NONE';
export type FriendRelationRecord={id:string;recipientHash:string;brandId:string;channel:typeof CONSENT_CHANNEL;relation:FriendRelation;syncedAt:string;syncedBy:string};
// 재동의 안내 레코드(오늘의 안건 알림용). growth_detected_signal과 같은 모양(status new·detection{title,detail,dueBy,kind})이라 agenda 쪽에서 같은 방식으로 읽을 수 있다. 캠페인 없이 브랜드에 묶인다.
export type ReconsentNotice={id:string;brandId:string;campaignId:null;version:1;status:'new'|'acknowledged'|'dismissed';detection:{kind:'kakao_reconsent';title:string;detail:string;dueBy:string;recipientHashes:string[]};detectedAt:string;detectedBy:'reconsent_generator';updatedAt:string;updatedBy:string};

export const CONSENT_CSV_COLUMNS=['phone','consentedAt','source','nightConsent'] as const;
export const CONSENT_IMPORT_MAX_ROWS=5000;
export const consentRecordId=(brandId:string,recipientHash:string)=>`${brandId}:${recipientHash}`;

// 한국 휴대전화 번호만 받는다(01X + 7~8자리). +82·82 국가번호는 0으로 바꾼다. 구분자·공백은 버린다.
export function normalizePhone(raw:string):string|null{
 let digits=raw.replace(/\D/g,'');
 if(digits.startsWith('82'))digits='0'+digits.slice(2);
 return /^01[016789]\d{7,8}$/.test(digits)?digits:null;
}
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
// 소유자·용도를 접두로 넣어 다른 워크스페이스에서 같은 번호가 같은 해시가 되지 않게 한다. 결과는 소문자 hex 64자다.
export async function recipientHash(owner:string,normalizedPhone:string):Promise<string>{
 return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`collective:kakao-recipient:v1\n${owner}\n${normalizedPhone}`)));
}
export const isRecipientHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const snapshotOf=(c:ConsentRecord|null|undefined):ConsentSnapshot|null=>c?{consentedAt:c.consentedAt,nightConsent:c.nightConsent,revokedAt:c.revokedAt}:null;
export const consentState=(c:ConsentRecord|null|undefined,nowMs:number):ConsentState=>consentStateOf(snapshotOf(c),nowMs);

export type ConsentCsvRow={phone:string;consentedAt:string;source:string;nightConsent:boolean};
export type ConsentCsvResult={rows:ConsentCsvRow[];errors:string[]};
const splitCsvLine=(line:string)=>line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
const BOOL:Record<string,boolean>={true:true,'1':true,y:true,yes:true,예:true,동의:true,false:false,'0':false,n:false,no:false,아니오:false,'':false};
// 열 순서는 머리글이 정한다. 날짜는 ISO 8601 또는 YYYY-MM-DD(KST 00:00으로 해석). 미래 날짜는 거부한다.
export function parseConsentCsv(text:string,nowMs:number):ConsentCsvResult{
 const lines=text.replace(/\r\n?/g,'\n').split('\n').map(l=>l.trim()).filter(Boolean),errors:string[]=[],rows:ConsentCsvRow[]=[];
 if(!lines.length)return {rows,errors:['CSV가 비어 있습니다.']};
 const header=splitCsvLine(lines[0]).map(h=>h.replace(/^﻿/,''));
 const col=Object.fromEntries(CONSENT_CSV_COLUMNS.map(c=>[c,header.indexOf(c)])) as Record<typeof CONSENT_CSV_COLUMNS[number],number>;
 if(col.phone<0||col.consentedAt<0)return {rows,errors:[`머리글에 phone, consentedAt 열이 필요합니다(선택: source, nightConsent). 받은 머리글: ${header.join(',')}`]};
 if(lines.length-1>CONSENT_IMPORT_MAX_ROWS)return {rows,errors:[`한 번에 ${CONSENT_IMPORT_MAX_ROWS}행까지 가져올 수 있습니다.`]};
 lines.slice(1).forEach((line,i)=>{
  const n=i+2,cells=splitCsvLine(line),phone=normalizePhone(cells[col.phone]??'');
  if(!phone){errors.push(`${n}행: 휴대전화 번호 형식이 아닙니다.`);return}
  const rawDate=cells[col.consentedAt]??'',iso=/^\d{4}-\d{2}-\d{2}$/.test(rawDate)?`${rawDate}T00:00:00+09:00`:rawDate,at=Date.parse(iso);
  if(!Number.isFinite(at)){errors.push(`${n}행: 동의 일시를 해석하지 못했습니다.`);return}
  if(at>nowMs){errors.push(`${n}행: 동의 일시가 미래입니다.`);return}
  const nightRaw=(col.nightConsent>=0?cells[col.nightConsent]??'':'').toLowerCase();
  if(!(nightRaw in BOOL)){errors.push(`${n}행: nightConsent는 true/false로 적습니다.`);return}
  const source=(col.source>=0?cells[col.source]??'':'').slice(0,100);
  rows.push({phone,consentedAt:new Date(at).toISOString(),source:source||'csv_import',nightConsent:BOOL[nightRaw]});
 });
 return {rows,errors};
}
// 재동의 안내 대상: 동의가 살아 있고(철회·만료 아님) RENEWAL_WARN_MONTHS(23개월)가 지난 수신자. 만료된 수신자도 함께 돌려줘 '재동의 필요'로 보이게 한다.
export type ReconsentDue={recipientHash:string;consentedAt:string;state:ConsentState;renewBy:string};
export function reconsentDue(consents:readonly ConsentRecord[],nowMs:number):ReconsentDue[]{
 return consents.flatMap(c=>{
  const state=consentState(c,nowMs);
  if(state==='revoked'||state==='invalid'||state==='none')return [];
  const due=addMonths(c.consentedAt,RENEWAL_WARN_MONTHS);
  if(state==='active'&&due>nowMs)return [];
  return [{recipientHash:c.recipientHash,consentedAt:c.consentedAt,state,renewBy:new Date(addMonths(c.consentedAt,24)).toISOString().slice(0,10)}];
 }).sort((a,b)=>a.renewBy.localeCompare(b.renewBy)||a.recipientHash.localeCompare(b.recipientHash));
}
// 하루(KST 날짜)당 브랜드 하나에 안내 1건. 같은 날 다시 만들면 id가 같아 덮어쓰지 않는다.
export function reconsentNotice(brandId:string,due:readonly ReconsentDue[],nowMs:number,by:string):ReconsentNotice|null{
 if(!due.length)return null;
 const day=new Date(nowMs+9*3600000).toISOString().slice(0,10),at=new Date(nowMs).toISOString(),expired=due.filter(d=>d.state==='expired').length;
 return {id:`reconsent:${brandId}:${day}`,brandId,campaignId:null,version:1,status:'new',
  detection:{kind:'kakao_reconsent',title:`카카오 마케팅 수신 재동의 확인 ${due.length}명`,detail:`23개월 경과 ${due.length-expired}명, 2년 만료(전송 차단) ${expired}명. 재동의를 받기 전에는 광고성 메시지를 보내지 않습니다.`,dueBy:due[0].renewBy,recipientHashes:due.map(d=>d.recipientHash).slice(0,500)},
  detectedAt:at,detectedBy:'reconsent_generator',updatedAt:at,updatedBy:by};
}
