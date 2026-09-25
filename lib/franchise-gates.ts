// 트랙 R 법정 절차 게이트(R4a). 순수 모듈: 제공 기록 판정, 계약 가능 시각(정보공개서 쪽·계약서안 쪽 두 시계), 단계 전이·가맹금·본계약 전 약정 판정, 산정서 의무, 변경등록 기한만 계산한다.
// 저장·API·화면·권한(직원 403)·잠금(동시 전이 409)·요청 제한은 R4b 몫이다. 현재 시각은 호출자가 서버 시각 now로 준다. 모듈은 시계를 읽지 않고 외부 호출이 없다.
// 근거: docs/FRANCHISE-RECRUITMENT-PLAN.ko.md 'R4 파이프라인·법정 절차 게이트'·'COLLECTIVE 휴리스틱' H1~H5·'수동 절차서 v0' 6·7단계, 대표 지시 h.last_day_holiday_extension. 결과는 COLLECTIVE 휴리스틱이며 법률 자문이 아니다(LR-1 확인 대상).
import {FRANCHISE_RULES,FRANCHISE_RULES_VERSION,FranchiseInputError,isInstant,parseInstant,isDate,toKstDate,kstDateOf,addDays,weekdayOf,kstMidnight,ruleAt} from './franchise-rules';

function deepFreeze<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const k of Object.keys(value))deepFreeze((value as Record<string,unknown>)[k])}
 return value;
}

// ── 상수 ──
export const GATE_DISCLAIMER='COLLECTIVE 휴리스틱 · 법률 자문 아님';
// fee_escrowed는 단계가 아니라 가맹금 이벤트다. 계약·가맹금 단계만 막고 앞 단계 기록은 언제나 받는다(설계 원칙 3).
export const LEAD_STAGES=deepFreeze(['inquiry','contacted','consulted','briefing','disclosed','draft_provided','contracted','fee_escrowed','opened','closed'] as const);
export type LeadStage=typeof LEAD_STAGES[number];
export const REASON_CODES=deepFreeze(['backdate_unapproved','change_notice_method_mismatch','contract_too_early','delivery_id_conflict','disclosure_missing','draft_missing','draft_template_incomplete','escrow_unproven','evidence_incomplete','fee_too_early','forecast_statement_missing','future_delivery','future_event','invalid_date','invalid_record','invalid_stage','invalid_timestamp','method_not_allowed','nearby_missing','pre_contract_agreement_too_early','receipt_unconfirmed','shortening_unproven','version_not_registered','version_not_valid_on_delivery'] as const);
export type ReasonCode=typeof REASON_CODES[number];
export const WARNING_CODES=deepFreeze(['advisor_independence_unverified','application_date_unknown','holiday_calendar_unverified'] as const);
export type WarningCode=typeof WARNING_CODES[number];
// 조문↔코드 대조표: 사유·경고 코드마다 근거 규칙 id(FRANCHISE_RULES). 입력 형식 코드는 규칙이 없다. kr.fr.independent_advisor는 proposed라 참고로만 적는다.
export const REASON_RULES:Readonly<Record<ReasonCode|WarningCode,readonly string[]>>=deepFreeze({
 advisor_independence_unverified:['h.advice_shortening_evidence','kr.fr.independent_advisor'],
 application_date_unknown:['kr.fr.change_deadlines','kr.fr.change_deadlines_2028'],
 backdate_unapproved:['h.evidence_integrity'],
 change_notice_method_mismatch:['h.change_notice_restart','kr.fr.delivery_methods'],
 contract_too_early:['h.change_notice_restart','h.first_day_excluded','h.last_day_holiday_extension','h.later_disclosure_doc','kr.fr.disclosure_wait','kr.fr.draft_wait'],
 delivery_id_conflict:['h.evidence_integrity'],
 disclosure_missing:['kr.fr.disclosure_wait'],
 draft_missing:['kr.fr.draft_wait'],
 draft_template_incomplete:['kr.fr.draft_wait'],
 escrow_unproven:['kr.fr.escrow'],
 evidence_incomplete:['kr.fr.delivery_methods'],
 fee_too_early:['h.first_day_excluded','h.last_day_holiday_extension','kr.fr.disclosure_wait','kr.fr.draft_wait'],
 forecast_statement_missing:['kr.fr.forecast_statement'],
 future_delivery:['h.evidence_integrity'],
 future_event:['h.evidence_integrity'],
 holiday_calendar_unverified:['h.last_day_holiday_extension'],
 invalid_date:[],invalid_record:[],invalid_stage:[],invalid_timestamp:[],
 method_not_allowed:['kr.fr.delivery_methods'],
 nearby_missing:['h.later_disclosure_doc','kr.fr.nearby_doc'],
 pre_contract_agreement_too_early:['h.pre_contract_development_agreement','kr.fr.disclosure_wait'],
 receipt_unconfirmed:['h.m4_receipt_required','kr.fr.delivery_methods'],
 shortening_unproven:['h.advice_shortening_evidence'],
 version_not_registered:['kr.fr.delivery_methods','kr.fr.disclosure_wait'],
 version_not_valid_on_delivery:['kr.fr.disclosure_wait'],
});
export const GATE_RULES:{readonly ruleVersion:string;readonly rulesVersion:string;readonly ruleIds:readonly string[];readonly disclaimer:string;readonly timezone:'+09:00'}=deepFreeze({
 ruleVersion:'fr-gates@2026-09-25.1',rulesVersion:FRANCHISE_RULES_VERSION,
 ruleIds:['h.advice_shortening_evidence','h.change_notice_restart','h.evidence_integrity','h.first_day_excluded','h.last_day_holiday_extension','h.later_disclosure_doc','h.m4_receipt_required','h.pre_contract_development_agreement','kr.fr.change_deadlines','kr.fr.change_deadlines_2028','kr.fr.delivery_methods','kr.fr.disclosure_wait','kr.fr.draft_wait','kr.fr.escrow','kr.fr.forecast_statement','kr.fr.nearby_doc'],
 disclaimer:GATE_DISCLAIMER,timezone:'+09:00' as const,
});
// disclosure: 정보공개서, nearby: 인근가맹점 현황문서, draft: 계약서안, change_notice: 계약 전 중요사항 변경 통지(시행령 제6조③).
export const DELIVERY_DOCS=deepFreeze(['disclosure','nearby','draft','change_notice'] as const);
// hand: 시행령 제6조①1호 직접 전달, certified_mail: 2호 내용증명, electronic: 4호 전자우편·문자·앱, ftc_link: 공정위 사이트 링크(제공이 아니라 기록 거부).
export const DELIVERY_METHODS=deepFreeze(['hand','certified_mail','electronic','ftc_link'] as const);
export const ALLOWED_METHODS=deepFreeze(['hand','certified_mail','electronic'] as const);
export const ELECTRONIC_CHANNELS=deepFreeze(['email','sms','app'] as const);
// 7일 단축을 인정하는 자문자: 변호사·가맹거래사.
export const ADVISOR_TYPES=deepFreeze(['attorney','franchise_consultant'] as const);
// 예치기관(시행령 제5조의8): 은행·체신관서·보험회사·신탁업자.
export const ESCROW_INSTITUTIONS=deepFreeze(['bank','post_office','insurer','trust'] as const);
// 제2조6호 가~마목. 가(가입비·교육비·계약금)·나(담보)는 제6조의5 예치 대상, 마(그 밖의 대가)도 보수적으로 예치를 요구한다. 다(설비·인테리어·임차료)·라(정기 대가)는 시점만 본다.
export const FEE_CATEGORIES=deepFreeze(['a_join','b_security','c_opening','d_periodic','e_other'] as const);
export const ESCROW_REQUIRED_CATEGORIES=deepFreeze(['a_join','b_security','e_other'] as const);
// 제11조② 필수 기재 호 수(12호 2024-07-03 시행 포함). 제공일과 관계없이 13개를 모두 요구한다.
export const CONTRACT_ITEM_COUNT=13;
export const AMENDMENT_ITEMS=deepFreeze(['ad_promo_spend','avg_operating_period','business_terms','cover','direct_store_status','employees','financials','franchisee_burden','general_info','history','ip','long_running_stores','minor_change','opening_procedure','other_brand_store_counts','regional_avg_sales','regional_hq','store_changes','store_counts','support_training','violations'] as const);
// 입력 배열 길이 상한. 넘으면 invalid_record로 닫는다(fail-closed).
export const LIMITS=deepFreeze({deliveries:200,advice:50,fees:50,agreements:20,versions:200,templates:50,holidays:400} as const);
// id·사유 코드는 ASCII 패턴만 받는다. 한글 같은 비ASCII 자유 문자열은 막지만 전화번호·로마자 이름 같은 ASCII 값은 막지 못하므로 id는 R4b 서버가 만든 값만 넘긴다.
// 모듈 판정은 비공개 정규식으로 한다. 내보내는 값은 얼린 사본이라 가져간 쪽이 compile을 불러도 이 모듈의 판정은 바뀌지 않는다(얼린 RegExp의 compile은 패턴을 바꾼 뒤 던진다).
const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/,APPROVAL_RE=/^[a-z][a-z0-9_]{2,63}$/;
export const ID_PATTERN:RegExp=Object.freeze(new RegExp(ID_RE.source));
export const APPROVAL_REASON_PATTERN:RegExp=Object.freeze(new RegExp(APPROVAL_RE.source));

// ── 입력 타입 ──
// 백데이트 승인 표지: 역할·사유 코드·감사 이벤트 id가 모두 있어야 유효하다. 감사 이벤트 생성은 R4b가 한다.
export type BackdateApproval={role:'owner'|'admin';reasonCode:string;auditEventId:string};
// 1호 증빙은 불리언만 받는다(가~다목 자필, 라목 본부 서명, 확인서 교부). 이름·주소·서명 이미지는 받지 않는다.
export type HandEvidence={receiptDateTimePlaceHandwritten:boolean;nameAddressPhoneHandwritten:boolean;signatureHandwritten:boolean;hqSigned:boolean;confirmationGiven:boolean};
export type CertifiedMailEvidence={receiptConfirmed:boolean};
export type ElectronicEvidence={channel:'email'|'sms'|'app';receivedAt?:string|null;printable:boolean};
// deliveredAt: 증빙에 묶인 제공 시각(1호 자필 수령 일시, 2호 내용증명 접수 시각, 4호 발송 시각). recordedAt: 서버 기록 시각. 4호 수신 시각은 evidence.electronic.receivedAt.
export type FranchiseDelivery={id:string;doc:'disclosure'|'nearby'|'draft'|'change_notice';method:string;deliveredAt:string;recordedAt:string;versionId?:string;templateId?:string;evidence?:{hand?:HandEvidence;certifiedMail?:CertifiedMailEvidence;electronic?:ElectronicEvidence};backdateApproval?:BackdateApproval|null};
// advisedOn은 KST 날짜 'YYYY-MM-DD'. hqPaid·hqReferred는 본부 비용 부담·본부 소개 여부(null=모름).
export type AdviceEvidence={id:string;advisorType:string;registrationVerified:boolean;advisedOn:string;targetDoc:'disclosure'|'draft';hqPaid:boolean|null;hqReferred:boolean|null};
// registeredAt null = 미등록. 유효 기간은 [validFrom, validUntil).
export type DisclosureVersion={id:string;registeredAt:string|null;validFrom:string;validUntil:string};
export type ContractTemplate={id:string;checkedItems:readonly number[]};
export type ForecastStatementRecord={providedAt:string;recordedAt:string;written:boolean;backdateApproval?:BackdateApproval|null};
export type ContractRecord={signedAt:string;recordedAt:string;backdateApproval?:BackdateApproval|null};
export type FeeCategory=typeof FEE_CATEGORIES[number];
// escrow.agreementAt: 예치 합의 시각. 합의가 따로 없으면 명시적 null이어야 한다(키가 없으면 escrow_unproven). paidAt: 본부 수령 시각(예치 경로에서도 있으면 간주 수령 시각 후보다).
export type FeeRecord={id:string;category:FeeCategory;recordedAt:string;paidAt?:string|null;escrow?:{institutionType:string;firstDepositAt:string;agreementAt:string|null}|null;insurance?:{coverageFrom:string;coverageTo:string}|null;backdateApproval?:BackdateApproval|null};
export type PreContractAgreement={id:string;signedAt:string;recordedAt:string;clauses:{fee:boolean;construction:boolean;training:boolean};backdateApproval?:BackdateApproval|null};
export type ContractWindowInput={deliveries:readonly FranchiseDelivery[];advice?:readonly AdviceEvidence[];disclosureVersions:readonly DisclosureVersion[];contractTemplates:readonly ContractTemplate[];holidays?:readonly string[]|null};
export type FranchiseLead={deliveries:readonly FranchiseDelivery[];advice?:readonly AdviceEvidence[];forecastStatement?:ForecastStatementRecord|null;contract?:ContractRecord|null;fees?:readonly FeeRecord[];agreements?:readonly PreContractAgreement[]};
export type GateContext={disclosureVersions:readonly DisclosureVersion[];contractTemplates:readonly ContractTemplate[];holidays?:readonly string[]|null;forecast?:{sme?:boolean|null;storesAtFyEnd?:number|null}|null};
export type AmendmentItem=typeof AMENDMENT_ITEMS[number];
export type AmendmentChange={item:AmendmentItem;occurredOn?:string|null;individualWithFinancials?:boolean|null};

// ── 결과 타입 ──
// accepted=false: 기록 거부(R4b 400). accepted=true·counted=false: 기록은 남되 대기 타이머를 시작하지 않음. counted=true: 기산에 씀.
// effectiveAt: 기산에 쓴 원래 시각 문자열(4호는 수신 시각, 그 밖은 deliveredAt)이고 산입한 기록에만 채운다(산입하지 않은 기록은 기산에 쓴 시각이 없어 null). effectiveDate는 그 KST 날짜.
export type DeliveryAssessment={id:string|null;doc:string|null;method:string|null;accepted:boolean;counted:boolean;effectiveAt:string|null;effectiveDate:string|null;reasons:ReasonCode[]};
// periodEnd: 공휴일 연장까지 반영한 대기기간 마지막 날. opensAt: 계약·가맹금이 허용되는 첫 시각.
// ruleIds: 이 쪽 계산에 적용한 규칙 id(시작일에 적용되는 것만, 계산 근거). 위임 명세 밖에 더한 필드라 위임자 승인 대상이다.
export type SideWindow={startDate:string|null;days:7|14|null;periodEnd:string|null;opensAt:string|null;shortened:boolean;extended:boolean;ruleIds:string[]};
// at: blockers가 비었을 때만 두 쪽 opensAt 중 늦은 값. notes: 막지 않는 설명(shortening_unproven).
export type ContractWindow={at:string|null;disclosureSide:SideWindow;draftSide:SideWindow;blockers:ReasonCode[];notes:ReasonCode[];warnings:WarningCode[];deliveries:DeliveryAssessment[];ruleVersion:string;disclaimer:string};
export type GateResult={ok:boolean;reasons:ReasonCode[];warnings:WarningCode[];ruleVersion:string;disclaimer:string;window?:ContractWindow};
export type ForecastDuty='required'|'not_required'|'unknown';
export type AmendmentResult={deadline:string|null;basis:'event'|'quarter'|'fiscal_year'|null;days:30|120|180|null;ruleId:string|null;reasons:ReasonCode[];warnings:WarningCode[];ruleVersion:string;disclaimer:string};

// ── 공통 보조 ──
type Doc=typeof DELIVERY_DOCS[number];
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sortedUnique=<T extends string>(xs:readonly T[]):T[]=>[...new Set(xs)].sort(ascii);
const oneOf=<T extends string>(list:readonly T[],v:unknown):v is T=>typeof v==='string'&&(list as readonly string[]).includes(v);
const validId=(v:unknown):v is string=>typeof v==='string'&&ID_RE.test(v);
const msOf=(v:unknown):number|null=>isInstant(v)?parseInstant(v):null;
const present=(v:unknown)=>v!==undefined&&v!==null;
const validApproval=(a:unknown)=>isRecord(a)&&(a.role==='owner'||a.role==='admin')&&typeof a.reasonCode==='string'&&APPROVAL_RE.test(a.reasonCode)&&validId(a.auditEventId);
// 키를 정렬한 JSON. 같은 id 기록의 동일성 비교와 정렬에만 쓰고 결과에는 싣지 않는다. undefined 값은 JSON처럼 빼고, BigInt는 던지지 않게 표지로 적는다.
// loose(제공 기록용): null과 생략을 같게 보고, 시각 필드(deliveredAt·recordedAt·receivedAt)는 같은 순간이면 같은 값으로 적는다(제공 판정에서 둘은 뜻이 같다).
const TIME_KEYS:readonly string[]=['deliveredAt','recordedAt','receivedAt'];
function stableJson(v:unknown,loose=false,depth=0,key=''):string{
 if(depth>12)return 'null';
 if(typeof v==='bigint')return 'n'+String(v);
 if(Array.isArray(v))return '['+v.map(x=>x===undefined?'null':stableJson(x,loose,depth+1)).join(',')+']';
 if(isRecord(v))return '{'+Object.keys(v).sort(ascii).filter(k=>loose?present(v[k]):v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stableJson(v[k],loose,depth+1,k)).join(',')+'}';
 if(loose&&TIME_KEYS.includes(key)&&isInstant(v))return 't'+parseInstant(v);
 return JSON.stringify(v)??'null';
}
// 같은 id 기록을 내용 키별로 묶는다. id가 없거나 틀린 기록은 따로 둔다. 같은 내용 키에서는 엄격 JSON이 가장 작은 원본 하나만 남긴다(입력 순서와 무관).
function groupById(list:readonly unknown[],keyOf:(x:unknown)=>string):{groups:Map<string,Map<string,unknown>>;unkeyed:unknown[]}{
 const groups=new Map<string,Map<string,unknown>>(),unkeyed:unknown[]=[];
 for(const x of list){
  if(!isRecord(x)||!validId(x.id)){unkeyed.push(x);continue}
  const g=groups.get(x.id)??new Map<string,unknown>(),k=keyOf(x),prev=g.get(k);
  if(prev===undefined||ascii(stableJson(x),stableJson(prev))<0)g.set(k,x);
  groups.set(x.id,g);
 }
 return {groups,unkeyed};
}
const later=(a:string,b:string)=>parseInstant(a)>=parseInstant(b)?a:b;

// ── 템플릿·대기기간 ──
// 제11조② 1~13호를 모두 체크했는가. 0·14·소수·문자열이 섞이면 false, 중복은 무시한다.
export function templateComplete(template:unknown):boolean{
 if(!isRecord(template)||!Array.isArray(template.checkedItems))return false;
 const items:readonly unknown[]=template.checkedItems;
 if(!items.every(x=>typeof x==='number'&&Number.isInteger(x)&&x>=1&&x<=CONTRACT_ITEM_COUNT))return false;
 return new Set(items).size===CONTRACT_ITEM_COUNT;
}
const isWeekend=(date:string)=>{const w=weekdayOf(date);return w===0||w===6};
// H2 + h.last_day_holiday_extension. 초일 불산입으로 마지막 날 = 시작일+days. 마지막 날이 토·일·공휴일이면 다음 평일까지 넘긴다(연장은 말일에만, 여는 날이 주말이어도 더 늦추지 않는다).
// 공휴일 목록이 없거나 비면, 또는 말일 판정에 걸친 연도의 날짜가 목록에 하나도 없으면(그해를 덮지 않는 목록) calendarVerified=false다(호출자가 holiday_calendar_unverified를 낸다).
export function waitingPeriod(startDate:string,days:7|14,holidays?:readonly string[]|null):{periodEnd:string;opensAt:string;extended:boolean;calendarVerified:boolean}{
 if(!isDate(startDate)||(days!==7&&days!==14))throw new FranchiseInputError('invalid_date');
 if(present(holidays)&&!Array.isArray(holidays))throw new FranchiseInputError('invalid_date');
 const list:readonly unknown[]=Array.isArray(holidays)?holidays:[];
 if(list.some(h=>!isDate(h)))throw new FranchiseInputError('invalid_date');
 const off=new Set(list as readonly string[]),first=addDays(startDate,days);
 let end=first,steps=0;
 while(isWeekend(end)||off.has(end)){
  if(++steps>LIMITS.holidays+10)throw new FranchiseInputError('invalid_date');
  end=addDays(end,1);
 }
 const listedYears=new Set([...off].map(d=>d.slice(0,4)));
 let covered=list.length>0;
 for(let y=Number(first.slice(0,4));y<=Number(end.slice(0,4));y++)if(!listedYears.has(String(y)))covered=false;
 return {periodEnd:end,opensAt:kstMidnight(addDays(end,1)),extended:steps>0,calendarVerified:covered};
}

// ── 제공 기록 판정 ──
const HAND_KEYS=['receiptDateTimePlaceHandwritten','nameAddressPhoneHandwritten','signatureHandwritten','hqSigned','confirmationGiven'] as const;
// 같은 id가 하나뿐이고 등록 시각이 모든 증빙 시각(4호는 발송·수신 둘 다) 이전이어야 등록된 버전이다. 등록 전에 발송하고 등록 뒤에 수신한 파일은 등록한 정보공개서 제공이 아니다(제7조①).
// 그다음 증빙 시각이 모두 [validFrom, validUntil) 안이어야 제공일에 유효한 버전이다.
function versionReason(versionId:unknown,versions:readonly unknown[],times:readonly number[]):ReasonCode|null{
 const found=validId(versionId)?versions.filter(v=>isRecord(v)&&v.id===versionId):[];
 if(found.length!==1)return 'version_not_registered';
 const v=found[0] as Record<string,unknown>,registered=msOf(v.registeredAt);
 if(registered===null||times.some(t=>registered>t))return 'version_not_registered';
 const from=msOf(v.validFrom),until=msOf(v.validUntil);
 return from===null||until===null||times.some(t=>t<from||t>=until)?'version_not_valid_on_delivery':null;
}
function templateOk(templateId:unknown,templates:readonly unknown[]):boolean{
 const found=validId(templateId)?templates.filter(t=>isRecord(t)&&t.id===templateId):[];
 return found.length===1&&templateComplete(found[0]);
}
// 기록의 가장 늦은 증빙 시각(제공 시각과 4호 수신 시각 중 늦은 것). 제공 시각을 읽을 수 없으면 null(호출자가 가장 늦은 것으로 본다).
function latestEvidenceMs(raw:unknown):number|null{
 if(!isRecord(raw))return null;
 const delivered=msOf(raw.deliveredAt);
 if(delivered===null)return null;
 const ev=isRecord(raw.evidence)?raw.evidence:{},el=isRecord(ev.electronic)?ev.electronic:null,received=el?msOf(el.receivedAt):null;
 return received===null?delivered:Math.max(delivered,received);
}
function assessOne(delivery:unknown,versions:readonly unknown[],templates:readonly unknown[],now:unknown):DeliveryAssessment{
 const d=isRecord(delivery)?delivery:{};
 const id=validId(d.id)?d.id:null,doc=oneOf(DELIVERY_DOCS,d.doc)?d.doc:null,method=oneOf(DELIVERY_METHODS,d.method)?d.method:null;
 const reject=(reasons:ReasonCode[]):DeliveryAssessment=>({id,doc,method,accepted:false,counted:false,effectiveAt:null,effectiveDate:null,reasons});
 // (1) 구조
 if(!isRecord(delivery)||!id||!doc||typeof d.method!=='string')return reject(['invalid_record']);
 // (2) 시각 형식
 const ev=isRecord(d.evidence)?d.evidence:{},el=isRecord(ev.electronic)?ev.electronic:null,hasReceived=!!el&&present(el.receivedAt);
 const delivered=msOf(d.deliveredAt),recorded=msOf(d.recordedAt),nowMs=msOf(now),received=hasReceived&&el?msOf(el.receivedAt):null;
 if(delivered===null||recorded===null||nowMs===null||(hasReceived&&received===null))return reject(['invalid_timestamp']);
 // (3) 법정 제공 방법(1·2·4호)만
 if(!oneOf(ALLOWED_METHODS,d.method))return reject(['method_not_allowed']);
 // (4) 미래 시각, (5) 기록 시각보다 이른 증빙 시각은 승인 표지가 있어야 받는다(허용 오차 없음).
 const evidenceTimes=received===null?[delivered]:[delivered,received];
 if(recorded>nowMs||evidenceTimes.some(t=>t>recorded||t>nowMs))return reject(['future_delivery']);
 if(evidenceTimes.some(t=>t<recorded)&&!validApproval(d.backdateApproval))return reject(['backdate_unapproved']);
 // (6) 방법별 증빙
 const reasons:ReasonCode[]=[];
 if(d.method==='hand'){const h=isRecord(ev.hand)?ev.hand:null;if(!h||!HAND_KEYS.every(k=>h[k]===true))reasons.push('evidence_incomplete')}
 else if(d.method==='certified_mail'){const c=isRecord(ev.certifiedMail)?ev.certifiedMail:null;if(!c||c.receiptConfirmed!==true)reasons.push('evidence_incomplete')}
 else if(!el)reasons.push('evidence_incomplete','receipt_unconfirmed');
 else{
  if(!oneOf(ELECTRONIC_CHANNELS,el.channel)||el.printable!==true)reasons.push('evidence_incomplete');
  if(received===null)reasons.push('receipt_unconfirmed');
  else if(received<delivered)reasons.push('evidence_incomplete');
 }
 // 4호는 수신 시각부터(H5), 그 밖은 증빙에 묶인 제공 시각부터 센다.
 const useReceived=d.method==='electronic'&&received!==null&&!!el;
 const effectiveAt=String(useReceived&&el?el.receivedAt:d.deliveredAt);
 if(d.doc==='disclosure'){const v=versionReason(d.versionId,versions,evidenceTimes);if(v)reasons.push(v)}
 if(d.doc==='draft'&&!templateOk(d.templateId,templates))reasons.push('draft_template_incomplete');
 const counted=!reasons.length;
 return {id,doc,method,accepted:true,counted,effectiveAt:counted?effectiveAt:null,effectiveDate:counted?toKstDate(effectiveAt):null,reasons:sortedUnique(reasons)};
}
// 제공 기록 1건을 판정한다. 같은 id 충돌·변경 통지 방법 비교처럼 여러 기록을 봐야 하는 판정은 earliestContractAt이 한다.
export function assessDelivery(delivery:unknown,input:Pick<ContractWindowInput,'disclosureVersions'|'contractTemplates'>,now:string):DeliveryAssessment{
 const i:Record<string,unknown>=isRecord(input)?input:{};
 return assessOne(delivery,Array.isArray(i.disclosureVersions)?i.disclosureVersions:[],Array.isArray(i.contractTemplates)?i.contractTemplates:[],now);
}

// ── 계약 가능 시각 ──
type Parsed={deliveries:readonly unknown[];advice:readonly unknown[];versions:readonly unknown[];templates:readonly unknown[];holidays:readonly string[];issues:ReasonCode[]};
// 입력 배열·버전·템플릿·공휴일을 먼저 검사한다. 하나라도 틀리면 계산하지 않고 닫는다(fail-closed).
function parseInput(input:unknown):Parsed{
 const o=isRecord(input)?input:{},issues:ReasonCode[]=isRecord(input)?[]:['invalid_record'];
 const list=(v:unknown,max:number,optional:boolean):readonly unknown[]=>{
  if(optional&&!present(v))return [];
  if(Array.isArray(v)&&v.length<=max)return v;
  issues.push('invalid_record');return [];
 };
 const deliveries=list(o.deliveries,LIMITS.deliveries,false),advice=list(o.advice,LIMITS.advice,true),versions=list(o.disclosureVersions,LIMITS.versions,false),templates=list(o.contractTemplates,LIMITS.templates,false),holidays=list(o.holidays,LIMITS.holidays,true);
 const uniqueIds=(xs:readonly unknown[])=>{const ids=xs.filter(isRecord).map(x=>x.id);return new Set(ids).size===ids.length};
 for(const v of versions){
  if(!isRecord(v)||!validId(v.id)||!(v.registeredAt===null||typeof v.registeredAt==='string')||typeof v.validFrom!=='string'||typeof v.validUntil!=='string'){issues.push('invalid_record');continue}
  const from=msOf(v.validFrom),until=msOf(v.validUntil);
  if((v.registeredAt!==null&&!isInstant(v.registeredAt))||from===null||until===null||from>=until)issues.push('invalid_timestamp');
 }
 for(const t of templates)if(!isRecord(t)||!validId(t.id)||!Array.isArray(t.checkedItems))issues.push('invalid_record');
 if(!uniqueIds(versions)||!uniqueIds(templates))issues.push('invalid_record');
 if(holidays.some(h=>!isDate(h)))issues.push('invalid_date');
 return {deliveries,advice,versions,templates,holidays:holidays.filter(isDate),issues};
}
// 계약·가맹금·약정 판정용: 그 시각 이전의 증빙만 남긴다. 제7조③·제11조①은 계약·수령 시점에 14일(7일)이 지났는지를 묻으므로, 뒤에 기록된 재제공·통지·자문이 이미 한 계약을 뒤집지 않는다.
// 시각을 읽을 수 없는 제공 기록은 남기고(fail-closed), 같은 id 기록은 하나라도 남으면 모두 남긴다(충돌을 숨기지 않는다). 자문은 advisedOn이 그 KST 날짜 이하인 것만 남긴다(날짜가 틀린 자문은 주장으로 남아 shortening_unproven이 된다).
function cutParsed(p:Parsed,cutoff:string):Parsed{
 const cut=parseInstant(cutoff),day=toKstDate(cutoff),within=(x:unknown)=>{const t=latestEvidenceMs(x);return t===null||t<=cut};
 const keep=new Set<string>();
 for(const d of p.deliveries)if(isRecord(d)&&validId(d.id)&&within(d))keep.add(d.id);
 return {...p,deliveries:p.deliveries.filter(d=>isRecord(d)&&validId(d.id)?keep.has(d.id):within(d)),advice:p.advice.filter(a=>!isRecord(a)||!isDate(a.advisedOn)||a.advisedOn<=day)};
}
type Row={a:DeliveryAssessment;key:string;raw:unknown;latestMs:number|null;effectiveMs:number|null;method:string|null};
// 같은 id 기록은 내용 키(시각 표기·null 생략을 정규화한 stable JSON)가 같으면 1건으로 센다.
// 내용이 다르면 그 id의 모든 기록을 산입하지 않는다(delivery_id_conflict). 다만 따로 보면 거부될 기록은 충돌이어도 거부를 유지하고 충돌 사유를 더한다(id가 겹친다고 미래·백데이트·허용 안 된 방법 기록이 받아지지 않게).
function assessRows(p:Parsed,now:string):Row[]{
 const rows:Row[]=[],{groups,unkeyed}=groupById(p.deliveries,x=>stableJson(x,true));
 const row=(raw:unknown,a:DeliveryAssessment,key:string):Row=>({a,key,raw,latestMs:latestEvidenceMs(raw),effectiveMs:a.effectiveAt===null?null:parseInstant(a.effectiveAt),method:isRecord(raw)&&typeof raw.method==='string'?raw.method:null});
 const assess=(raw:unknown)=>assessOne(raw,p.versions,p.templates,now);
 for(const raw of unkeyed)rows.push(row(raw,assess(raw),stableJson(raw,true)));
 for(const g of groups.values()){
  for(const [key,raw] of g){
   const a=assess(raw);
   if(g.size===1)rows.push(row(raw,a,key));
   else rows.push(row(raw,a.accepted?{...a,counted:false,effectiveAt:null,effectiveDate:null,reasons:['delivery_id_conflict']}:{...a,reasons:sortedUnique([...a.reasons,'delivery_id_conflict'])},key));
  }
 }
 // H3: 산입된 변경 통지는 그 이전 가장 늦은 산입 정보공개서 제공과 같은 방법이어야 산입한다. 시행령 제6조③은 제1항 각 호 어느 방법이든 허용하므로 같은 방법 요구는 COLLECTIVE 보수 해석(Q3)이다.
 const disclosures=rows.filter(r=>r.a.doc==='disclosure'&&r.a.counted);
 for(const r of rows){
  if(r.a.doc!=='change_notice'||!r.a.counted||r.effectiveMs===null)continue;
  const at=r.effectiveMs,before=disclosures.filter(x=>x.effectiveMs!==null&&x.effectiveMs<=at);
  if(!before.length)continue;
  const latest=Math.max(...before.map(x=>x.effectiveMs as number));
  if(before.some(x=>x.effectiveMs===latest&&x.method!==r.method)){r.a={...r.a,counted:false,effectiveAt:null,effectiveDate:null,reasons:['change_notice_method_mismatch']};r.effectiveMs=null}
 }
 return rows.sort((x,y)=>ascii(x.a.id??'',y.a.id??'')||ascii(x.key,y.key));
}
const MISSING={disclosure:'disclosure_missing',nearby:'nearby_missing',draft:'draft_missing'} as const;
const emptySide=():SideWindow=>({startDate:null,days:null,periodEnd:null,opensAt:null,shortened:false,extended:false,ruleIds:[]});
const windowResult=(w:Omit<ContractWindow,'ruleVersion'|'disclaimer'>):ContractWindow=>({...w,blockers:sortedUnique(w.blockers),notes:sortedUnique(w.notes),warnings:sortedUnique(w.warnings),ruleVersion:GATE_RULES.ruleVersion,disclaimer:GATE_DISCLAIMER});
type Advice={target:'disclosure'|'draft'|null;valid:boolean;advisedOn:string|null;dependent:boolean};
// 자문 증빙. 같은 id가 내용이 다르면 둘 다 무효. targetDoc이 정보공개서·계약서안이 아니면 어느 쪽에도 쓰지 못하는 주장으로 두 쪽 모두에 센다. 날짜 형식이 틀린 자문도 무효 주장이다(shortening_unproven).
function readAdvice(list:readonly unknown[]):Advice[]{
 const {groups}=groupById(list,x=>stableJson(x));
 return list.map(a=>{
  if(!isRecord(a))return {target:null,valid:false,advisedOn:null,dependent:true};
  const target=a.targetDoc==='disclosure'||a.targetDoc==='draft'?a.targetDoc:null,conflict=!validId(a.id)||(groups.get(a.id)?.size??0)>1;
  const valid=!conflict&&target!==null&&oneOf(ADVISOR_TYPES,a.advisorType)&&a.registrationVerified===true&&isDate(a.advisedOn);
  return {target,valid,advisedOn:isDate(a.advisedOn)?a.advisedOn:null,dependent:a.hqPaid!==false||a.hqReferred!==false};
 });
}
const SIDE_RULES={disclosure:'kr.fr.disclosure_wait',draft:'kr.fr.draft_wait'} as const;
type SideCalc={side:SideWindow;unproven:boolean;dependent:boolean;calendarVerified:boolean};
// 한 쪽 대기 계산. 자문일은 그 쪽 시작일 이상·판정일 이하여야 하고, 그 쪽 기준 규칙이 시작일에 적용될 때만 7일을 검토한다(H4).
// 단축으로 여는 시각은 max(7일 대기 다음 날, 가장 이른 유효 자문일 다음 날)이다. 그 값이 14일 대기로 여는 시각보다 이르지 않으면 14일을 쓴다(자문이 게이트를 늦추지 않는다, 법정 상한 14일).
function sideWindow(target:'disclosure'|'draft',start:string,advice:readonly Advice[],today:string,holidays:readonly string[],extraRules:readonly string[]):SideCalc{
 const claims=advice.filter(a=>a.target===target||a.target===null);
 const valid=ruleAt(SIDE_RULES[target],start)?claims.filter(a=>a.valid&&a.target===target&&a.advisedOn!==null&&a.advisedOn>=start&&a.advisedOn<=today):[];
 const hol=holidays.length?holidays:null,w14=waitingPeriod(start,14,hol),earliest=valid.map(a=>a.advisedOn as string).sort(ascii)[0];
 let chosen={days:14 as 7|14,w:w14,opensAt:w14.opensAt};
 if(earliest){
  const w7=waitingPeriod(start,7,hol),opensAt=later(w7.opensAt,kstMidnight(addDays(earliest,1)));
  if(parseInstant(opensAt)<parseInstant(w14.opensAt))chosen={days:7,w:w7,opensAt};
 }
 const shortened=chosen.days===7;
 // 계약서안(제11조)에는 법정 제공 방법이 없어 kr.fr.delivery_methods를 계약서안 쪽 근거로 싣지 않는다(방법·증빙 요구는 h.evidence_integrity 쪽 휴리스틱).
 const ruleIds=sortedUnique([SIDE_RULES[target],...(target==='disclosure'?['kr.fr.delivery_methods']:[]),'h.evidence_integrity','h.first_day_excluded','h.last_day_holiday_extension',...extraRules,...(shortened?['h.advice_shortening_evidence']:[])]).filter(id=>ruleAt(id,start)!==null);
 return {side:{startDate:start,days:chosen.days,periodEnd:chosen.w.periodEnd,opensAt:chosen.opensAt,shortened,extended:chosen.w.extended,ruleIds},unproven:claims.length>0&&!valid.length,dependent:shortened&&valid.some(a=>a.dependent),calendarVerified:chosen.w.calendarVerified};
}
type Evaluation={window:ContractWindow;rows:Row[];parsed:Parsed};
// cutoff가 있으면 그 시각 이전 증빙만으로 계산한다(cutParsed). now는 미래·백데이트 판정에 그대로 쓴다.
function evaluate(input:unknown,now:string,cutoff:string|null=null):Evaluation{
 const parsed=parseInput(input),closed=(blockers:ReasonCode[]):Evaluation=>({window:windowResult({at:null,disclosureSide:emptySide(),draftSide:emptySide(),blockers,notes:[],warnings:[],deliveries:[]}),rows:[],parsed});
 if(!isInstant(now))return closed(['invalid_timestamp']);
 if(parsed.issues.length)return closed(parsed.issues);
 const p=cutoff!==null&&isInstant(cutoff)?cutParsed(parsed,cutoff):parsed;
 const rows=assessRows(p,now),blockers:ReasonCode[]=[],notes:ReasonCode[]=[],warnings:WarningCode[]=[],start:Partial<Record<Doc,string>>={};
 // 거부된 기록의 사유는 모두 차단 사유다.
 for(const r of rows)if(!r.a.accepted)blockers.push(...r.a.reasons);
 const countedMs=(doc:Doc)=>rows.filter(r=>r.a.doc===doc&&r.a.counted).map(r=>r.effectiveMs as number);
 for(const F of DELIVERY_DOCS){
  const C=rows.filter(r=>r.a.doc===F&&r.a.counted),U=rows.filter(r=>r.a.doc===F&&r.a.accepted&&!r.a.counted);
  if(!C.length&&F!=='change_notice')blockers.push(MISSING[F]);
  // 산입된 제공보다 늦은 결손 제공(발송·수신 중 늦은 증빙 시각 기준)이 있으면 마지막으로 받은 문서가 불확실하므로 막는다. 산입이 없으면 결손 사유를 모두 차단 사유로 낸다.
  // 변경 통지는 그보다 엄격히 늦게 산입된 정보공개서 재제공이 있으면 대체된 것으로 본다(같은 시각이면 대체가 아니다). 재제공·재통지는 기산을 늦춘다.
  const baseline=Math.max(-Infinity,...countedMs(F)),redelivered=F==='change_notice'?Math.max(-Infinity,...countedMs('disclosure')):-Infinity;
  for(const r of U){const t=r.latestMs??Infinity;if(t>baseline&&t>=redelivered)blockers.push(...r.a.reasons)}
  if(C.length)start[F]=C.map(r=>r.a.effectiveDate as string).sort(ascii)[C.length-1];
 }
 const advice=readAdvice(p.advice),today=toKstDate(now),sides:SideCalc[]=[];
 let disclosureSide=emptySide(),draftSide=emptySide();
 try{
  // H1·H3: 정보공개서 쪽은 정보공개서·인근가맹점 문서·변경 통지 중 늦은 날부터 센다.
  if(start.disclosure&&start.nearby){
   const s=[start.disclosure,start.nearby,start.change_notice??''].sort(ascii)[2];
   const calc=sideWindow('disclosure',s,advice,today,p.holidays,['kr.fr.nearby_doc','h.later_disclosure_doc',...(start.change_notice?['h.change_notice_restart']:[])]);
   sides.push(calc);disclosureSide=calc.side;
  }
  if(start.draft){const calc=sideWindow('draft',start.draft,advice,today,p.holidays,[]);sides.push(calc);draftSide=calc.side}
 }catch(err){
  // 날짜 범위를 벗어난 계산(예: 2199년 말 제공)만 invalid_date로 닫는다. 그 밖의 예외는 프로그래밍 오류라 숨기지 않는다.
  if(!(err instanceof FranchiseInputError))throw err;
  blockers.push('invalid_date');
 }
 if(sides.some(s=>s.unproven))notes.push('shortening_unproven');
 if(sides.some(s=>s.dependent))warnings.push('advisor_independence_unverified');
 if(sides.some(s=>!s.calendarVerified))warnings.push('holiday_calendar_unverified');
 const at=!blockers.length&&disclosureSide.opensAt&&draftSide.opensAt?later(disclosureSide.opensAt,draftSide.opensAt):null;
 return {window:windowResult({at,disclosureSide,draftSide,blockers,notes,warnings,deliveries:rows.map(r=>r.a)}),rows,parsed};
}
// 계약·가맹금이 허용되는 첫 시각. 두 시계(정보공개서 쪽·계약서안 쪽)를 KST 날짜로 세고 늦은 쪽을 고른다. 입력 순서와 무관하게 같은 결과를 낸다.
export function earliestContractAt(input:ContractWindowInput,now:string):ContractWindow{return evaluate(input,now).window}

// ── 가맹금·본계약 전 약정 ──
type WindowFacts={at:number|null;blockers:ReasonCode[];notes:ReasonCode[];warnings:WarningCode[]};
// 호출자가 준 window에서 알려진 코드만 읽는다(임의 문자열을 결과로 옮기지 않는다).
function windowFacts(w:unknown):WindowFacts{
 const o=isRecord(w)?w:{},codes=<T extends string>(v:unknown,list:readonly T[])=>Array.isArray(v)?v.filter((x):x is T=>oneOf(list,x)):[];
 return {at:msOf(o.at),blockers:codes(o.blockers,REASON_CODES),notes:codes(o.notes,REASON_CODES),warnings:codes(o.warnings,WARNING_CODES)};
}
const gate=(reasons:readonly ReasonCode[],warnings:readonly WarningCode[],window?:ContractWindow):GateResult=>{
 const r=sortedUnique(reasons),base={ok:!r.length,reasons:r,warnings:sortedUnique(warnings),ruleVersion:GATE_RULES.ruleVersion,disclaimer:GATE_DISCLAIMER};
 return window?{...base,window}:base;
};
// 증빙 시각 무결성(h.evidence_integrity): 증빙 시각·기록 시각이 now보다 늦거나 증빙 시각이 기록 시각보다 늦으면 future_event, 기록 시각보다 이르면 승인 표지가 필요하다.
function integrity(evidence:readonly number[],recorded:number,nowMs:number,approval:unknown):ReasonCode[]{
 const out:ReasonCode[]=[];
 if(recorded>nowMs||evidence.some(t=>t>nowMs||t>recorded))out.push('future_event');
 if(evidence.some(t=>t<recorded)&&!validApproval(approval))out.push('backdate_unapproved');
 return out;
}
type FeeFacts={reasons:ReasonCode[];deemed:string|null;early:boolean};
// 가맹금 기록 1건의 형식·증빙·무결성(창과 무관한 부분). early=true면 형식 오류라 창을 보지 않는다.
// 간주 수령 시각은 기록된 증빙 시각(본부 수령 paidAt, 예치 합의, 최초 예치) 가운데 가장 이른 것이다. 예치면 제7조③1호·제11조①1호(합의일·최초 예치일)에 더해, 본부가 직접 받은 시각이 있으면 그것도 넣는다(예치를 늦게 해서 대기기간 전 수령을 가리지 못하게).
function feeFacts(fee:unknown,now:string):FeeFacts{
 const f=isRecord(fee)?fee:null;
 if(!f||!validId(f.id)||!oneOf(FEE_CATEGORIES,f.category))return {reasons:['invalid_record'],deemed:null,early:true};
 const nowMs=msOf(now),recorded=msOf(f.recordedAt);
 if(nowMs===null||recorded===null)return {reasons:['invalid_timestamp'],deemed:null,early:true};
 const reasons:ReasonCode[]=[],evidence:string[]=[],hasPaid=present(f.paidAt),paid=hasPaid&&isInstant(f.paidAt)?f.paidAt:null;
 if(hasPaid&&paid===null)reasons.push('invalid_timestamp');
 if(paid!==null)evidence.push(paid);
 if(present(f.escrow)){
  const e=f.escrow;
  if(!isRecord(e))reasons.push('invalid_record');
  else{
   if(!oneOf(ESCROW_INSTITUTIONS,e.institutionType))reasons.push('escrow_unproven');
   const first=isInstant(e.firstDepositAt)?e.firstDepositAt:null;
   if(first===null)reasons.push('invalid_timestamp');else evidence.push(first);
   // 예치 합의 시각을 비워 두면 제7조③1호 간주를 우회할 수 있으므로 키가 없으면 증빙 부족으로 본다(합의가 없으면 명시적 null).
   if(!Object.hasOwn(e,'agreementAt')||e.agreementAt===undefined)reasons.push('escrow_unproven');
   else if(e.agreementAt!==null){if(isInstant(e.agreementAt))evidence.push(e.agreementAt);else reasons.push('invalid_timestamp')}
   // 예치 대상 가맹금을 최초 예치보다 먼저 본부가 받았다면 직접 수령이라 예치 증빙이 되지 못한다(제6조의5①, 제41조③1호). 예치 뒤 수령(예치기관 지급)은 막지 않는다.
   if(paid!==null&&first!==null&&parseInstant(paid)<parseInstant(first)&&oneOf(ESCROW_REQUIRED_CATEGORIES,f.category))reasons.push('escrow_unproven');
  }
 }else if(present(f.insurance)){
  const ins=f.insurance;
  if(!isRecord(ins))reasons.push('invalid_record');
  else{
   const from=msOf(ins.coverageFrom),to=msOf(ins.coverageTo),paidMs=paid===null?null:parseInstant(paid);
   if(from===null||to===null)reasons.push('invalid_timestamp');
   else if(from>=to||(paidMs!==null&&(paidMs<from||paidMs>=to)))reasons.push('escrow_unproven');
   if(!hasPaid)reasons.push('invalid_record');
  }
 }else{
  if(oneOf(ESCROW_REQUIRED_CATEGORIES,f.category))reasons.push('escrow_unproven');
  if(!hasPaid)reasons.push('invalid_record');
 }
 reasons.push(...integrity(evidence.map(parseInstant),recorded,nowMs,f.backdateApproval));
 const deemed=evidence.length?evidence.reduce((a,b)=>parseInstant(b)<parseInstant(a)?b:a):null;
 return {reasons,deemed,early:false};
}
function feeTiming(x:FeeFacts,w:WindowFacts):ReasonCode[]{
 const r=[...x.reasons];
 if(w.at===null)r.push('fee_too_early',...w.blockers);
 else if(x.deemed!==null&&parseInstant(x.deemed)<w.at)r.push('fee_too_early');
 if(r.includes('fee_too_early')&&w.notes.includes('shortening_unproven'))r.push('shortening_unproven');
 return r;
}
// 가맹금 기록 1건. window는 간주 수령 시각 이전 기록으로 계산한 창이어야 한다(checkTransition은 스스로 그렇게 계산한다).
export function checkFee(fee:unknown,window:ContractWindow,now:string):GateResult{
 const w=windowFacts(window),x=feeFacts(fee,now);
 return gate(x.early?x.reasons:feeTiming(x,w),w.warnings);
}
type AgreementFacts={reasons:ReasonCode[];signedAt:string|null;binding:boolean;early:boolean};
// 본계약 전 약정 1건의 형식·무결성. 무결성(미래·백데이트)은 조항과 관계없이 모든 약정에 적용한다. binding은 가맹금·공사·교육 조항이 하나라도 있는가다.
function agreementFacts(agreement:unknown,now:string):AgreementFacts{
 const g=isRecord(agreement)?agreement:null,c=g&&isRecord(g.clauses)?g.clauses:null;
 if(!g||!validId(g.id)||!c||typeof c.fee!=='boolean'||typeof c.construction!=='boolean'||typeof c.training!=='boolean')return {reasons:['invalid_record'],signedAt:null,binding:false,early:true};
 const nowMs=msOf(now),recorded=msOf(g.recordedAt),signedAt=isInstant(g.signedAt)?g.signedAt:null;
 if(nowMs===null||signedAt===null||recorded===null)return {reasons:['invalid_timestamp'],signedAt:null,binding:false,early:true};
 return {reasons:integrity([parseInstant(signedAt)],recorded,nowMs,g.backdateApproval),signedAt,binding:c.fee===true||c.construction===true||c.training===true,early:false};
}
function agreementTiming(x:AgreementFacts,w:WindowFacts):ReasonCode[]{
 const r=[...x.reasons];
 if(x.binding&&x.signedAt!==null){
  if(w.at===null)r.push('pre_contract_agreement_too_early',...w.blockers);
  else if(parseInstant(x.signedAt)<w.at)r.push('pre_contract_agreement_too_early');
 }
 return r;
}
// 본계약 전 점포 개발 약정 등(수동 절차서 7단계). 가맹금·공사·교육 조항이 하나라도 있으면 계약과 같게 보고 계약 가능 시각 뒤에만 허용한다. 모두 없으면 후보 점포 검토만 적은 약정이라 시점은 보지 않는다.
// window는 약정 서명 시각 이전 기록으로 계산한 창이어야 한다(checkTransition은 스스로 그렇게 계산한다).
export function checkAgreement(agreement:unknown,window:ContractWindow,now:string):GateResult{
 const w=windowFacts(window),x=agreementFacts(agreement,now);
 return gate(x.early?x.reasons:agreementTiming(x,w),w.warnings);
}

// ── 산정서 의무 ──
// 제9조⑤: 중소기업자가 아니거나 직전 사업연도 말 가맹점 100개 이상이면 의무. 입력 하나라도 모르면 unknown(게이트는 required와 같게 막는다).
export function forecastDuty(input?:{sme?:unknown;storesAtFyEnd?:unknown}|null):ForecastDuty{
 const o=isRecord(input)?input:{},sme=o.sme,stores=o.storesAtFyEnd;
 if(typeof sme!=='boolean'||typeof stores!=='number'||!Number.isSafeInteger(stores)||stores<0)return 'unknown';
 return !sme||stores>=100?'required':'not_required';
}
function forecastReasons(statement:unknown,signed:number|null,nowMs:number):ReasonCode[]{
 if(!isRecord(statement)||statement.written!==true)return ['forecast_statement_missing'];
 const provided=msOf(statement.providedAt),recorded=msOf(statement.recordedAt);
 if(provided===null||recorded===null)return ['forecast_statement_missing','invalid_timestamp'];
 const out=integrity([provided],recorded,nowMs,statement.backdateApproval);
 if(out.length||(signed!==null&&provided>signed))out.push('forecast_statement_missing');
 return out;
}

// ── 단계 전이 ──
const OPEN_STAGES:readonly LeadStage[]=['inquiry','contacted','consulted','briefing','closed'];
// 같은 id 가맹금·약정은 내용이 같으면 한 번, 다르면 invalid_record. 배열이 아니거나 상한을 넘으면 invalid_record.
function recordList(v:unknown,max:number):{items:unknown[];issues:ReasonCode[]}{
 if(!present(v))return {items:[],issues:[]};
 if(!Array.isArray(v)||v.length>max)return {items:[],issues:['invalid_record']};
 const {groups,unkeyed}=groupById(v,x=>stableJson(x)),items:unknown[]=[...unkeyed],issues:ReasonCode[]=[];
 for(const g of groups.values()){if(g.size>1)issues.push('invalid_record');else items.push(...g.values())}
 return {items,issues};
}
// 단계 전이 판정. inquiry~briefing·closed는 여기서 막지 않는다(분기 B의 LR-1 전 409, 직원 403, 잠금 409, 요청 제한, 종결 사유 코드는 R4b).
// disclosed·draft_provided는 기록이 받아졌는지만 본다(기록은 언제나 받는다). contracted·opened는 계약 서명 시각, 가맹금은 간주 수령 시각, 약정은 서명 시각 이전 기록으로 창을 계산한다.
export function checkTransition(lead:FranchiseLead,to:string,now:string,ctx:GateContext):GateResult{
 const pre:ReasonCode[]=[];
 if(!oneOf(LEAD_STAGES,to))pre.push('invalid_stage');
 if(!isInstant(now))pre.push('invalid_timestamp');
 if(pre.length)return gate(pre,[]);
 if(OPEN_STAGES.includes(to as LeadStage))return gate([],[]);
 const l=isRecord(lead)?lead:null,c=isRecord(ctx)?ctx:null;
 if(!l||!c)return gate(['invalid_record'],[]);
 const input={deliveries:l.deliveries,advice:l.advice,disclosureVersions:c.disclosureVersions,contractTemplates:c.contractTemplates,holidays:c.holidays};
 const e=evaluate(input,now),window=e.window;
 // 판정 시각 이전 기록만으로 계산한 창. 시각을 읽을 수 없으면 현재 기준 창을 쓴다.
 const windowAt=(cutoff:string|null):ContractWindow=>cutoff===null?window:evaluate(input,now,cutoff).window;
 if(to==='disclosed'||to==='draft_provided'){
  if(e.parsed.issues.length)return gate(e.parsed.issues,[]);
  const doc=to==='disclosed'?'disclosure':'draft',mine=e.rows.filter(r=>r.a.doc===doc);
  if(!mine.length)return gate([doc==='disclosure'?'disclosure_missing':'draft_missing'],[]);
  const complete=(r:Row)=>doc==='disclosure'||templateOk(isRecord(r.raw)?r.raw.templateId:undefined,e.parsed.templates);
  if(mine.some(r=>r.a.accepted&&complete(r)))return gate([],[]);
  return gate([...mine.filter(r=>!r.a.accepted).flatMap(r=>r.a.reasons),...(mine.some(r=>r.a.accepted&&!complete(r))?['draft_template_incomplete' as const]:[])],[]);
 }
 const fees=recordList(l.fees,LIMITS.fees),agreements=recordList(l.agreements,LIMITS.agreements),nowMs=parseInstant(now),used:WarningCode[]=[];
 const feeReasons=(fallback:ContractWindow)=>fees.items.flatMap(f=>{
  const x=feeFacts(f,now);if(x.early)return x.reasons;
  const w=x.deemed!==null?windowAt(x.deemed):fallback;used.push(...w.warnings);return feeTiming(x,windowFacts(w));
 });
 const agreementReasons=(fallback:ContractWindow)=>agreements.items.flatMap(a=>{
  const x=agreementFacts(a,now);if(x.early||!x.binding)return x.reasons;
  const w=x.signedAt!==null?windowAt(x.signedAt):fallback;used.push(...w.warnings);return agreementTiming(x,windowFacts(w));
 });
 if(to==='fee_escrowed'){
  if(!fees.items.length&&!fees.issues.length)return gate(['invalid_record'],window.warnings,window);
  const reasons=[...fees.issues,...feeReasons(window)];
  return gate(reasons,[...window.warnings,...used],window);
 }
 // contracted·opened
 const contract=isRecord(l.contract)?l.contract:null;
 if(!contract)return gate(['invalid_record'],window.warnings,window);
 const signedAt=isInstant(contract.signedAt)?contract.signedAt:null,recorded=msOf(contract.recordedAt),cw=windowAt(signedAt),signed=signedAt===null?null:parseInstant(signedAt);
 const reasons:ReasonCode[]=[...cw.blockers];
 if(signed===null||recorded===null)reasons.push('invalid_timestamp');
 else reasons.push(...integrity([signed],recorded,nowMs,contract.backdateApproval));
 if(cw.at!==null&&signed!==null&&signed<parseInstant(cw.at)){reasons.push('contract_too_early');if(cw.notes.includes('shortening_unproven'))reasons.push('shortening_unproven')}
 if(forecastDuty(isRecord(c.forecast)?c.forecast:{})!=='not_required')reasons.push(...forecastReasons(l.forecastStatement,signed,nowMs));
 reasons.push(...fees.issues,...feeReasons(cw),...agreements.issues,...agreementReasons(cw));
 return gate(reasons,[...cw.warnings,...used],cw);
}

// ── 변경등록 기한(별표 1의2) ──
type AmendBasis='event'|'quarter'|'fiscal_year';
// 현행(2021.11.19 개정) 항목 분류. 조사 요약 기준이며 '일부' 항목은 가장 짧은 기준을 쓴다(R1 착수 때 별표 원문과 대조).
const CURRENT_BASIS:Readonly<Partial<Record<AmendmentItem,AmendBasis>>>={
 cover:'event',general_info:'event',history:'event',violations:'event',
 ip:'quarter',regional_hq:'quarter',franchisee_burden:'quarter',business_terms:'quarter',opening_procedure:'quarter',support_training:'quarter',minor_change:'quarter',
 financials:'fiscal_year',employees:'fiscal_year',store_counts:'fiscal_year',store_changes:'fiscal_year',other_brand_store_counts:'fiscal_year',regional_avg_sales:'fiscal_year',avg_operating_period:'fiscal_year',ad_promo_spend:'fiscal_year',direct_store_status:'fiscal_year',
};
// 2028-01-01 시행: 가맹점·직영점 수, 개폐점 변동, 기타 영업표지 점포 수, 직영점 목록은 분기 종료 후 30일로, 장기운영 가맹점 정보는 사업연도 종료 후 120일로 생긴다.
const BASIS_2028:Readonly<Partial<Record<AmendmentItem,AmendBasis>>>={...CURRENT_BASIS,store_counts:'quarter',store_changes:'quarter',other_brand_store_counts:'quarter',direct_store_status:'quarter',long_running_stores:'fiscal_year'};
const AMEND_VERSIONS:readonly {id:string;basis:Readonly<Partial<Record<AmendmentItem,AmendBasis>>>}[]=[{id:'kr.fr.change_deadlines',basis:CURRENT_BASIS},{id:'kr.fr.change_deadlines_2028',basis:BASIS_2028}];
const lastDayOf=(y:number,m:number)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const isMonthEnd=(date:string)=>Number(date.slice(8,10))===lastDayOf(Number(date.slice(0,4)),Number(date.slice(5,7)));
// occurredOn 이상인 가장 가까운 달력 분기말과 회계 분기말(사업연도 종료 월 기준 3개월 간격) 가운데 이른 날.
function quarterEnd(occurred:string,fiscalYearEnd:string):string{
 const y=Number(occurred.slice(0,4)),m=Number(occurred.slice(5,7)),fm=Number(fiscalYearEnd.slice(5,7)),found:string[]=[];
 for(const fits of [(mm:number)=>mm%3===0,(mm:number)=>(((mm-fm)%3)+3)%3===0]){
  for(let i=0;i<12;i++){const mm=((m-1+i)%12)+1,yy=y+Math.floor((m-1+i)/12);if(fits(mm)){found.push(`${yy}-${String(mm).padStart(2,'0')}-${String(lastDayOf(yy,mm)).padStart(2,'0')}`);break}}
 }
 return found.sort(ascii)[0];
}
type AmendCandidate={ruleId:string;basis:AmendBasis;deadline:string;days:30|120|180};
// 정보공개서 변경등록 기한. 신청일로 규칙 버전을 고르고(selectBy application_date), 신청일을 모르면 성립하는 버전 중 이른 기한과 경고를 낸다. 기한에는 공휴일 연장을 하지 않는다.
export function amendmentDeadline(fiscalYearEnd:string,change:AmendmentChange,applicationDate?:string|null):AmendmentResult{
 const reasons:ReasonCode[]=[],warnings:WarningCode[]=[];
 const done=(r:AmendCandidate|null):AmendmentResult=>({deadline:r?r.deadline:null,basis:r?r.basis:null,days:r?r.days:null,ruleId:r?r.ruleId:null,reasons:sortedUnique(reasons),warnings:sortedUnique(warnings),ruleVersion:GATE_RULES.ruleVersion,disclaimer:GATE_DISCLAIMER});
 if(!isDate(fiscalYearEnd)||!isMonthEnd(fiscalYearEnd))reasons.push('invalid_date');
 const ch:Record<string,unknown>=isRecord(change)?change:{},item=oneOf(AMENDMENT_ITEMS,ch.item)?ch.item:null;
 if(!item)reasons.push('invalid_record');
 const known=present(applicationDate);
 let versionIds:string[]=[];
 if(!known){warnings.push('application_date_unknown');versionIds=AMEND_VERSIONS.map(v=>v.id)}
 else{
  const applied=isDate(applicationDate)||isInstant(applicationDate)?ruleAt('kr.fr.change_deadlines',kstDateOf(applicationDate)):null;
  if(applied)versionIds=[applied.id];else reasons.push('invalid_date');
 }
 if(reasons.length||!item)return done(null);
 const candidates=AMEND_VERSIONS.filter(v=>versionIds.includes(v.id)).flatMap(v=>{const b=v.basis[item];return b?[{ruleId:v.id,basis:b}]:[]});
 if(!candidates.length){reasons.push('invalid_record');return done(null)}
 const occurred=isDate(ch.occurredOn)?ch.occurredOn:null;
 // 신청일을 모를 때도 사유 발생일이 필요한 후보가 하나라도 있으면 닫는다(그 후보가 가장 이른 기한일 수 있다).
 if(candidates.some(x=>x.basis!=='fiscal_year')&&!occurred){reasons.push('invalid_date');return done(null)}
 let computed:AmendCandidate[];
 try{
  computed=candidates.map(x=>{
   if(x.basis==='event')return {...x,deadline:addDays(occurred as string,30),days:30 as const};
   if(x.basis==='quarter')return {...x,deadline:addDays(quarterEnd(occurred as string,fiscalYearEnd),30),days:30 as const};
   const days=ch.individualWithFinancials===true?180 as const:120 as const;
   return {...x,deadline:addDays(fiscalYearEnd,days),days};
  });
 }catch(err){
  if(!(err instanceof FranchiseInputError))throw err;
  reasons.push('invalid_date');return done(null);
 }
 // 신청일을 모르면 기한이 그 규칙 버전의 시행일보다 이른 후보는 뺀다(그 버전으로는 시행일 전에 신청할 수 없어 성립하지 않는 조합이다).
 const feasible=known?computed:computed.filter(x=>{const from=FRANCHISE_RULES.find(r=>r.id===x.ruleId)?.effectiveFrom;return !from||x.deadline>=from});
 if(!feasible.length){reasons.push('invalid_date');return done(null)}
 // 가장 이른 기한. 같은 날이면 규칙 순서(현행 먼저)를 따른다.
 return done(feasible.reduce((best,x)=>x.deadline<best.deadline?x:best));
}
