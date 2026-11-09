// C6 광고성 전송 컴플라이언스 엔진(순수, docs/KAKAO-BIZMESSAGE.ko.md 4절). 저장·네트워크·시계를 모르고 입력만 본다. 법률 자문이 아니다.
// 하는 일: (1) 정보성/광고성 분류 (2) 알림톡은 정보성만 (3) 브랜드 메시지는 '(광고)' 머리말·전송자 명칭·080 무료 수신거부 줄
// (4) KST 전송 시간대(딜러 20:50~08:00 차단, 야간 별도 동의가 있을 때만 허용) (5) 수신 동의(없음·철회·2년 경과 → 재동의 필요) (6) 수신거부 목록 (7) 수신자별 하루 광고성 상한.
// 사유 문구는 한국어이고 규칙 id를 함께 적는다. 어휘는 lib/graders/compliance-lexicon.ts ad_message 규칙의 해소 정규식((광고)·수신거부·080)을 다시 쓴다.
import {COMPLIANCE_LEXICON} from '../graders/compliance-lexicon';
import type {MessageType} from './types';

export type Classification='informational'|'advertising';
export const CLASSIFICATION_LABELS:Readonly<Record<Classification,string>>={informational:'정보성',advertising:'광고성'};
export type ConsentSnapshot={consentedAt:string;nightConsent:boolean;revokedAt:string|null};
export type ComplianceInput={type:MessageType;text:string;senderName:string;now:number|string;consent:ConsentSnapshot|null;optedOut:boolean;adSentToday:number;dailyCap?:number};
export type ComplianceReason={rule:KakaoRuleId;message:string;basis:string};
export type ComplianceVerdict={ok:boolean;classification:Classification;reasons:ComplianceReason[];warnings:ComplianceReason[];kst:{date:string;time:string;night:boolean};checkedAt:string};

export const KAKAO_RULE_IDS=['kakao.alimtalk.informational_only','kakao.brand.ad_label','kakao.brand.sender_name','kakao.brand.optout_080','kakao.night_window','kakao.consent.required','kakao.consent.revoked','kakao.consent.expired','kakao.consent.renewal_due','kakao.optout','kakao.daily_cap','kakao.text.empty'] as const;
export type KakaoRuleId=typeof KAKAO_RULE_IDS[number];
const LAW='정보통신망 이용촉진 및 정보보호 등에 관한 법률';
// 규칙 근거(화면·문서 공통). 조문은 2026-11-09 기준 현행 조문 번호다(개정 시 docs와 함께 갱신).
export const KAKAO_RULES:Readonly<Record<KakaoRuleId,{title:string;basis:string}>>={
 'kakao.alimtalk.informational_only':{title:'알림톡은 정보성 전용',basis:'카카오 알림톡 심사 가이드(광고성 내용 불가), lib/franchise-rules.ts platform.kakao.alimtalk'},
 'kakao.brand.ad_label':{title:"광고성 메시지는 '(광고)'로 시작",basis:`${LAW} §50④, 시행령 §61①(표기 방법)`},
 'kakao.brand.sender_name':{title:'전송자 명칭 표기',basis:`${LAW} §50④(전송자의 명칭·연락처 표기)`},
 'kakao.brand.optout_080':{title:'무료 수신거부 방법(080) 표기',basis:`${LAW} §50④, 시행령 §61(무료 수신거부 수단)`},
 'kakao.night_window':{title:'야간 광고성 전송 제한',basis:`${LAW} §50③(21시~08시 별도 동의), 카카오 브랜드 메시지 정책(20:50~08:00 발송 불가)`},
 'kakao.consent.required':{title:'명시적 사전 수신 동의',basis:`${LAW} §50①(사전 동의)`},
 'kakao.consent.revoked':{title:'철회한 수신자 전송 금지',basis:`${LAW} §50②·⑦(수신거부·동의 철회 뒤 전송 금지)`},
 'kakao.consent.expired':{title:'2년마다 수신 동의 재확인',basis:`${LAW} §50⑧, 시행령 §62조의3(2년 주기 확인)`},
 'kakao.consent.renewal_due':{title:'재동의 확인 시기 임박(23개월 경과)',basis:`${LAW} 시행령 §62조의3(2년 주기 확인) 운영 기준`},
 'kakao.optout':{title:'수신거부 목록',basis:`${LAW} §50②(수신거부 의사 표시 뒤 전송 금지)`},
 'kakao.daily_cap':{title:'수신자별 하루 광고성 상한',basis:'COLLECTIVE 운영 기준(기본 하루 1건), 법령 아님'},
 'kakao.text.empty':{title:'본문 필요',basis:'입력 검증'},
};
export const CONSENT_VALID_MONTHS=24,RENEWAL_WARN_MONTHS=23,DEFAULT_DAILY_CAP=1;
// 딜러 정책 시간대(KST). 법은 21:00~08:00이지만 딜러가 20:50부터 막으므로 더 엄격한 쪽을 쓴다.
export const SEND_WINDOW={openMinute:8*60,closeMinute:20*60+50};

const adRule=(id:string)=>COMPLIANCE_LEXICON.rules.find(r=>r.category==='ad_message'&&r.id===id);
const AD_LABEL_RE=new RegExp(adRule('ad_label_missing')?.cleared??'\\(광고\\)|\\[광고\\]|（광고）');
// 수신거부 문구는 사전(optout_missing.cleared)보다 좁게 본다: '080 번호만 있는 문의 줄'은 수신거부 안내가 아니다.
const OPTOUT_RE=/수신\s?거부|무료\s?거부|수신\s?철회/;
// 변형 표기((광/고)·[광고]·(AD))는 '(광고)' 그대로가 아니다(lib/franchise-nurture.ts AD_VARIANT와 같은 태도).
const AD_VARIANT_RE=/\(\s*광\s*[/·.\s]\s*고\s*\)|\[\s*광\s*고\s*\]|\(\s*AD\s*\)|<\s*광\s*고\s*>|（\s*광고\s*）/i;
const OPTOUT_080_RE=/080-?\d{3,4}-?\d{4}/;
const FREE_OPTOUT_RE=/무료\s?수신\s?거부/g;
// 광고성 신호 어휘(lib/graders/compliance-lexicon.ts PROMOTION과 같은 계열 + 판촉 낱말). 정보성 알림(주문·예약·배송·결제 안내)에는 나오지 않는 낱말만 둔다.
export const AD_KEYWORDS=['할인','이벤트','쿠폰','혜택','무료','증정','특가','프로모션','세일','사은품','신메뉴','오픈 기념','런칭','출시','적립','방문하세요','주문하세요','구매하세요','예약하세요','드립니다','추천드려요','한정','선착순','%'] as const;

export function classifyMessage(text:string):{classification:Classification;hits:string[]}{
 const body=text.replace(FREE_OPTOUT_RE,' ');
 if(AD_LABEL_RE.test(body)||AD_VARIANT_RE.test(body))return {classification:'advertising',hits:['(광고) 표기']};
 const hits=AD_KEYWORDS.filter(k=>body.includes(k));
 return {classification:hits.length?'advertising':'informational',hits};
}
// KST 날짜·시각(시계는 입력). 입력이 문자열이면 ISO로 해석한다.
export function kstParts(now:number|string):{date:string;time:string;minutes:number;night:boolean}{
 const ms=typeof now==='number'?now:Date.parse(now),k=new Date(ms+9*3600000);
 const minutes=k.getUTCHours()*60+k.getUTCMinutes(),date=k.toISOString().slice(0,10),time=k.toISOString().slice(11,16);
 return {date,time,minutes,night:minutes<SEND_WINDOW.openMinute||minutes>=SEND_WINDOW.closeMinute};
}
export function addMonths(iso:string,months:number):number{
 const d=new Date(iso);
 if(!Number.isFinite(d.getTime()))return NaN;
 const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));
 return d.getTime();
}
export type ConsentState='none'|'active'|'expired'|'revoked'|'invalid';
export function consentStateOf(consent:ConsentSnapshot|null,nowMs:number):ConsentState{
 if(!consent)return 'none';
 if(consent.revokedAt)return 'revoked';
 const expiry=addMonths(consent.consentedAt,CONSENT_VALID_MONTHS);
 if(!Number.isFinite(expiry)||Date.parse(consent.consentedAt)>nowMs)return 'invalid';
 return expiry<=nowMs?'expired':'active';
}
const reason=(rule:KakaoRuleId,message:string):ComplianceReason=>({rule,message:`${message} [${rule}]`,basis:KAKAO_RULES[rule].basis});

function brandFormat(text:string,senderName:string):ComplianceReason[]{
 const out:ComplianceReason[]=[],first=text.split('\n').find(l=>l.trim())??'';
 if(AD_VARIANT_RE.test(text)&&!first.trimStart().startsWith('(광고)'))out.push(reason('kakao.brand.ad_label',"'(광고)' 표기는 변형((광/고)·[광고]·(AD) 등) 없이 첫 줄 맨 앞에 그대로 써야 합니다."));
 else if(!first.trimStart().startsWith('(광고)'))out.push(reason('kakao.brand.ad_label',"광고성 메시지는 첫 줄을 '(광고)'로 시작해야 합니다."));
 if(!senderName.trim()||!text.includes(senderName.trim()))out.push(reason('kakao.brand.sender_name','광고성 메시지에는 전송자 명칭(브랜드·사업자명)이 본문에 있어야 합니다.'));
 const optoutLine=text.split('\n').find(l=>OPTOUT_RE.test(l)&&OPTOUT_080_RE.test(l));
 if(!optoutLine)out.push(reason('kakao.brand.optout_080',"'무료 수신거부 080-XXX-XXXX' 형식의 수신거부 안내 줄이 있어야 합니다."));
 return out;
}
function consentReasons(consent:ConsentSnapshot|null,nowMs:number):{reasons:ComplianceReason[];warnings:ComplianceReason[]}{
 const state=consentStateOf(consent,nowMs),reasons:ComplianceReason[]=[],warnings:ComplianceReason[]=[];
 if(state==='none'||state==='invalid')reasons.push(reason('kakao.consent.required','이 수신자의 마케팅 수신 동의 기록(동의 일시 포함)이 없어 광고성 메시지를 보낼 수 없습니다.'));
 else if(state==='revoked')reasons.push(reason('kakao.consent.revoked','이 수신자는 수신 동의를 철회했습니다. 다시 동의하기 전에는 보낼 수 없습니다.'));
 else if(state==='expired')reasons.push(reason('kakao.consent.expired',`수신 동의가 ${CONSENT_VALID_MONTHS}개월을 넘었습니다. 재동의 필요.`));
 else if(consent&&addMonths(consent.consentedAt,RENEWAL_WARN_MONTHS)<=nowMs)warnings.push(reason('kakao.consent.renewal_due',`수신 동의가 ${RENEWAL_WARN_MONTHS}개월을 넘었습니다. 재동의 확인을 준비하세요.`));
 return {reasons,warnings};
}
// 판정. 광고성 규칙은 분류가 광고성이거나 유형이 브랜드 메시지일 때 모두 적용한다(브랜드 메시지는 유형 자체가 광고성이다).
export function checkKakaoCompliance(input:ComplianceInput):ComplianceVerdict{
 const nowMs=typeof input.now==='number'?input.now:Date.parse(input.now),kst=kstParts(nowMs),text=input.text??'';
 const {classification,hits}=classifyMessage(text),reasons:ComplianceReason[]=[],warnings:ComplianceReason[]=[];
 if(!text.trim())reasons.push(reason('kakao.text.empty','본문을 입력하세요.'));
 if(input.type==='alimtalk'&&classification==='advertising')reasons.push(reason('kakao.alimtalk.informational_only',`알림톡은 정보성 전용입니다. 광고성 표현(${hits.slice(0,3).join(', ')})이 있어 보낼 수 없습니다. 광고는 브랜드 메시지로 보내세요.`));
 const advertising=input.type==='brand'||classification==='advertising';
 if(input.type==='brand')reasons.push(...brandFormat(text,input.senderName));
 if(advertising){
  if(kst.night&&!input.consent?.nightConsent)reasons.push(reason('kakao.night_window',`지금은 KST ${kst.time}로 광고성 전송 제한 시간대(20:50~08:00)입니다. 야간 수신에 별도 동의한 수신자에게만 보낼 수 있습니다.`));
  const c=consentReasons(input.consent,nowMs);reasons.push(...c.reasons);warnings.push(...c.warnings);
  if(input.optedOut)reasons.push(reason('kakao.optout','이 수신자는 수신거부 목록에 있습니다.'));
  const cap=input.dailyCap??DEFAULT_DAILY_CAP;
  if(input.adSentToday>=cap)reasons.push(reason('kakao.daily_cap',`이 수신자에게 오늘 이미 광고성 메시지를 ${input.adSentToday}건 보냈습니다(하루 상한 ${cap}건).`));
 }
 return {ok:reasons.length===0,classification:input.type==='brand'?'advertising':classification,reasons,warnings,kst:{date:kst.date,time:kst.time,night:kst.night},checkedAt:new Date(nowMs).toISOString()};
}
