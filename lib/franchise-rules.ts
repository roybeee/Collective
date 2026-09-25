// 트랙 R 가맹 규칙 레지스트리(R4a). 순수 모듈: 규칙 상수, 시행일 창에 따른 규칙 선택(ruleAt·rulesAt), 레지스트리 자체 검사, KST 날짜·시각 보조 함수만 둔다.
// 저장·API·화면·스위치·프롬프트는 없다(R4b·R2가 이 모듈을 가져다 쓴다). 모듈은 시계를 읽지 않는다. 현재 시각이 필요한 검사는 호출자가 now를 넘긴다. import가 없다.
// 근거: docs/FRANCHISE-RECRUITMENT-PLAN.ko.md '규칙 레지스트리 스키마'·'법적 경계'·'COLLECTIVE 휴리스틱'. 휴리스틱(basis heuristic)은 법률 자문이 아니며 강화는 즉시, 완화는 LR-1 회신과 코드 PR로만 한다.

export type RuleStatus='in_force'|'scheduled'|'proposed';
// 'none'은 proposed 규칙에만 쓴다(계획 표의 '없음'). proposed는 어떤 날짜에도 적용되지 않는다.
export type RuleTier='hard_block'|'block_unless_evidence'|'gate'|'sla'|'warn'|'info'|'none';
export type RuleBasis='official'|'heuristic'|'platform';
// 규칙을 고를 날짜의 종류. 날짜를 실제로 고르는 것은 호출자다(now: 판정 시각, application_date: 등록·변경등록 신청일, delivery_date: 정보공개서·계약서안 제공일).
export type RuleSelectBy='now'|'application_date'|'delivery_date';
export type RuleConfidence='high'|'medium'|'low';
// R2 적용 범위: franchise_brand는 가맹 프로필이 있는 브랜드의 모든 캠페인, objective_export는 가맹 모집 objective 캠페인과 내보내기만.
export type RuleScope='franchise_brand'|'objective_export';
// effectiveFrom·effectiveTo는 KST 날짜 'YYYY-MM-DD'이고 창은 [effectiveFrom, effectiveTo)다. 모르는 시행일은 비운다(-∞/+∞). family는 같은 규칙의 시행 버전 묶음, question은 LR-1 질문 번호.
export type FranchiseRule={readonly id:string;readonly family?:string;readonly jurisdiction:'KR';readonly article:string;readonly title:string;readonly status:RuleStatus;readonly effectiveFrom?:string;readonly effectiveTo?:string;readonly selectBy:RuleSelectBy;readonly tier:RuleTier;readonly basis:RuleBasis;readonly sourceUrls:readonly string[];readonly verifiedAt:string;readonly confidence:RuleConfidence;readonly scope?:RuleScope;readonly question?:string;readonly notes?:string};
export type RuleFilter={basis?:RuleBasis;tier?:RuleTier;status?:RuleStatus;selectBy?:RuleSelectBy;family?:string;scope?:RuleScope;ids?:readonly string[]};

// ── 입력 오류 ──
// 문구는 코드별 고정이다. 입력 값은 message·stack·추가 필드 어디에도 넣지 않는다(시각·날짜 문자열에 무엇이 섞여 올지 모른다).
export type InputErrorCode='invalid_timestamp'|'invalid_date';
const INPUT_MESSAGES:Readonly<Record<InputErrorCode,string>>=Object.freeze({invalid_timestamp:'시각은 시간대가 있는 ISO 8601이어야 합니다.',invalid_date:'날짜는 YYYY-MM-DD 또는 시간대가 있는 ISO 8601이어야 합니다.'});
export class FranchiseInputError extends Error{readonly code:InputErrorCode;constructor(code:InputErrorCode){super(INPUT_MESSAGES[code]);this.name='FranchiseInputError';this.code=code}}

// ── KST 날짜·시각 ──
// KST는 +09:00 고정이다(일광절약 없음). Date.parse는 달력에 없는 날·T24:00·시간대 없는 로컬 시각을 조용히 받으므로 쓰지 않고, 정규식과 달력 검사 뒤 Date.UTC 산술로만 계산한다.
export const KST_OFFSET='+09:00';
const KST_MS=9*3600e3,DAY_MS=864e5,MIN_YEAR=2000,MAX_YEAR=2199,MAX_OFFSET_MIN=14*60;
// 초·소수(3자리까지)는 선택, 시간대(Z 또는 ±HH:MM)는 필수. 소문자 t·z, 공백 구분, 기본형(콜론 없음)은 받지 않는다.
const INSTANT_RE=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE=/^(\d{4})-(\d{2})-(\d{2})$/;
const leapYear=(y:number)=>y%4===0&&(y%100!==0||y%400===0);
const monthDays=(y:number,m:number)=>m===2?(leapYear(y)?29:28):m===4||m===6||m===9||m===11?30:31;
// 연 2000~2199만 받는다(Date.UTC는 0~99년을 1900년대로 바꾸므로 범위를 좁혀 둔다).
const validYmd=(y:number,m:number,d:number)=>y>=MIN_YEAR&&y<=MAX_YEAR&&m>=1&&m<=12&&d>=1&&d<=monthDays(y,m);
function offsetMs(tz:string):number|null{
 if(tz==='Z')return 0;
 if(tz==='-00:00')return null;
 const h=Number(tz.slice(1,3)),m=Number(tz.slice(4,6)),total=h*60+m;
 if(m>59||total>MAX_OFFSET_MIN)return null;
 return (tz[0]==='-'?-1:1)*total*6e4;
}
function instantMs(value:unknown):number|null{
 if(typeof value!=='string')return null;
 const m=INSTANT_RE.exec(value);
 if(!m)return null;
 const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),h=Number(m[4]),mi=Number(m[5]),s=m[6]===undefined?0:Number(m[6]),ms=m[7]===undefined?0:Number((m[7]+'00').slice(0,3)),offset=offsetMs(m[8]);
 if(!validYmd(y,mo,d)||h>23||mi>59||s>59||offset===null)return null;
 const t=Date.UTC(y,mo-1,d,h,mi,s,ms)-offset,kstYear=new Date(t+KST_MS).getUTCFullYear();
 // KST 날짜도 2000~2199여야 한다('2199-12-31T20:00:00Z'는 KST 2200-01-01). 받은 시각의 KST 날짜 계산이 뒤에서 범위를 벗어나 던지지 않게 여기서 거른다.
 return kstYear>=MIN_YEAR&&kstYear<=MAX_YEAR?t:null;
}
function dateParts(value:unknown):[number,number,number]|null{
 if(typeof value!=='string')return null;
 const m=DATE_RE.exec(value);
 if(!m)return null;
 const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
 return validYmd(y,mo,d)?[y,mo,d]:null;
}
const pad=(n:number,width=2)=>String(n).padStart(width,'0');
// epoch ms를 UTC 달력 날짜로 푼다. 로컬 시간대 게터(getDate·getDay)는 CI(UTC)와 개발 PC(KST)에서 결과가 달라 쓰지 않는다.
function ymdOf(ms:number):string{const d=new Date(ms);return `${pad(d.getUTCFullYear(),4)}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`}
function dayMs(date:unknown):number{const p=dateParts(date);if(!p)throw new FranchiseInputError('invalid_date');return Date.UTC(p[0],p[1]-1,p[2])}
export const isInstant=(value:unknown):value is string=>instantMs(value)!==null;
// 시간대 있는 ISO 8601 시각을 epoch ms로 바꾼다. 형식이 틀리면 invalid_timestamp.
export function parseInstant(value:unknown):number{const t=instantMs(value);if(t===null)throw new FranchiseInputError('invalid_timestamp');return t}
export const isDate=(value:unknown):value is string=>dateParts(value)!==null;
export function parseDate(value:unknown):string{if(!isDate(value))throw new FranchiseInputError('invalid_date');return value}
// 시각의 KST 날짜. 2026-10-05T15:30Z는 KST 2026-10-06이다.
export const toKstDate=(instant:unknown):string=>ymdOf(parseInstant(instant)+KST_MS);
// 날짜면 그대로, 시각이면 KST 날짜. 둘 다 아니면 invalid_date.
export function kstDateOf(value:unknown):string{
 if(isDate(value))return value;
 const t=instantMs(value);
 if(t===null)throw new FranchiseInputError('invalid_date');
 return ymdOf(t+KST_MS);
}
// 결과도 2000~2199의 달력 날짜여야 한다. 범위를 벗어나거나 계산할 수 없으면 invalid_date(형식이 깨진 날짜 문자열을 돌려주지 않는다).
export function addDays(date:string,days:number):string{
 if(!Number.isSafeInteger(days))throw new FranchiseInputError('invalid_date');
 const t=dayMs(date)+days*DAY_MS,y=Number.isFinite(t)?new Date(t).getUTCFullYear():NaN;
 if(!(y>=MIN_YEAR&&y<=MAX_YEAR))throw new FranchiseInputError('invalid_date');
 return ymdOf(t);
}
// 0=일요일 … 6=토요일.
export const weekdayOf=(date:string):number=>new Date(dayMs(date)).getUTCDay();
export const kstMidnight=(date:string):string=>`${parseDate(date)}T00:00:00${KST_OFFSET}`;
export function compareInstant(a:string,b:string):number{const x=parseInstant(a),y=parseInstant(b);return x<y?-1:x>y?1:0}

// ── 규칙 레지스트리 ──
// 조사 시점은 2026-09-24 KST다(대표 지시로 더한 h.last_day_holiday_extension만 2026-09-25). 미래 확인 시각 검사는 registryIssues(now)가 한다.
export const FRANCHISE_RULES_VERSION='2026-09-25.1';
const VERIFIED='2026-09-24T00:00:00+09:00';
// 출처 URL. LAW: 가맹사업법 현행(법률 제20712호). DEC_L3: 계획 [L3]이 인용한 시행령 판(MST=284653은 제36561호가 아니라 제36220호다. 구판 대조용으로 두고 2028 별표 규칙 출처에는 쓰지 않는다). DEC_NOW·DEC_2028: 시행령 제36561호 현행·2028-01-01 시행 별표(MST=288453).
const DRF='https://www.law.go.kr/DRF/lawService.do?OC=test';
const LAW=`${DRF}&target=law&type=XML&MST=268283`;
const LAW_LM=`${DRF}&target=law&type=XML&LM=가맹사업거래의%20공정화에%20관한%20법률`;
const LAW_2026=`${DRF}&target=law&type=XML&MST=281999`;
const LAW_2026_LSW='https://www.law.go.kr/LSW/lsInfoP.do?efYd=20261231&lsiSeq=281999&ancNo=21295&ancYd=20251230';
const LAW_LSW='https://www.law.go.kr/LSW/lsInfoP.do?lsId=009367&ancYnChk=0';
const DEC_L3=`${DRF}&target=law&type=XML&MST=284653`;
const DEC_NOW=`${DRF}&target=eflaw&type=XML&MST=288453&efYd=20260804`;
const DEC_2028=`${DRF}&target=eflaw&type=XML&MST=288453&efYd=20280101`;
const DEC_LM=`${DRF}&target=law&type=XML&LM=가맹사업거래의%20공정화에%20관한%20법률%20시행령`;
const NOTICE_2019_8=`${DRF}&target=admrul&type=XML&ID=2100000183885`;
const NOTICE_FORM_OLD=`${DRF}&target=admrul&type=XML&ID=2100000206187`;
const NOTICE_FORM_2026=`${DRF}&target=admrul&type=XML&ID=2100000283584`;
const NOTICE_PENALTY=`${DRF}&target=admrul&type=XML&ID=2100000283586`;
const AD_ACT='https://www.law.go.kr/LSW/lsInfoP.do?lsId=002011&ancYnChk=0';
const PIPA=`${DRF}&target=eflaw&type=XML&MST=283839&efYd=20260911`;
const CIVIL=`${DRF}&target=law&type=XML&LM=민법`;
const GOV_HOLIDAYS=`${DRF}&target=law&type=XML&LM=관공서의%20공휴일에%20관한%20규정`;
const FTC='https://www.ftc.go.kr/www/selectBbsNttView.do';
const FTC_47855=`${FTC}?bordCd=3&key=12&nttSn=47855`,FTC_47837=`${FTC}?bordCd=3&key=12&nttSn=47837`,FTC_47793=`${FTC}?bordCd=3&key=12&nttSn=47793`,FTC_46672=`${FTC}?bordCd=3&key=12&nttSn=46672`;
const FTC_47838=`${FTC}?bordCd=3&key=12&nttSn=47838`,FTC_47549=`${FTC}?bordCd=3&key=12&nttSn=47549`,FTC_47293=`${FTC}?bordCd=3&key=12&nttSn=47293`,FTC_11315=`${FTC}?key=204&bordCd=203&nttSn=11315`;
const FTC_ENDORSE=`${FTC}?pageUnit=10&pageIndex=1&searchCnd=all&key=12&bordCd=3&searchCtgry=01%2C02&nttSn=47547`;
const MOLEG_24_0795='https://www.moleg.go.kr/lawinfo/nwLwAnInfo.mo?mid=a10106020000&cs_seq=441122&pageCnt=30&currentPage=1&keyField=&keyWord=&sort=date';
const EASYLAW='https://easylaw.go.kr/CSP/CnpClsMainBtr.laf?popMenu=ov&csmSeq=647&ccfNo=2&cciNo=1&cnpClsNo=2';

const RULES:FranchiseRule[]=[
 // 공식 규정: 가맹사업법·시행령 (법정 절차 게이트)
 {id:'kr.fr.disclosure_wait',jurisdiction:'KR',article:'가맹사업법 제7조③(1호 예치 합의일 간주 포함), 제7조①',title:'정보공개서등 제공일부터 14일(정보공개서 자문 시 7일)이 지나기 전 가맹금 수령·가맹계약 체결 금지',status:'in_force',effectiveFrom:'2014-02-14',selectBy:'delivery_date',tier:'gate',basis:'official',sourceUrls:[LAW,LAW_LM,FTC_47855,FTC_47837],verifiedAt:VERIFIED,confidence:'high',
  notes:'effectiveFrom은 법률 제12094호(2013.8.13 개정) 시행일. 2026.12.31 개정법에서도 문언이 같다. 등록한 정보공개서만 기산한다. 사유: contract_too_early, fee_too_early, disclosure_missing, version_not_registered, version_not_valid_on_delivery.'},
 {id:'kr.fr.draft_wait',jurisdiction:'KR',article:'가맹사업법 제11조①(7일 단축, 법률 제19614호), 제11조②(필수 기재 13개 호, 12호 법률 제19912호 2024-07-03), 제11조③',title:'계약서안 제공일부터 14일(계약서 자문 시 7일) 전 가맹금 수령·계약 금지, 13개 호 기재',status:'in_force',effectiveFrom:'2023-11-09',selectBy:'delivery_date',tier:'gate',basis:'official',sourceUrls:[LAW,LAW_LM,FTC_11315],verifiedAt:VERIFIED,confidence:'high',
  notes:'effectiveFrom은 7일 단축 시행일이고 그 전 판은 모델링하지 않는다. 게이트는 14일을 항상 적용하고, 계약서안 쪽 단축은 시작일이 2023-11-09 이후일 때만 한다. 법률 제19614호 부칙 제2조는 시행 당시 14일이 지나지 않은 제공분(2023-10-26~11-08 제공)에도 7일을 적용하므로 이 기준은 법보다 엄격한 보수 기본값이다(과거 제공분에만 영향, LR-1 확인). 13개 호는 제공일과 관계없이 모두 요구한다. 사유: draft_template_incomplete, draft_missing, contract_too_early.'},
 {id:'kr.fr.delivery_methods',jurisdiction:'KR',article:'가맹사업법 시행령 제6조①1·2·4호, ③; 가맹사업법 제7조①',title:'정보공개서 제공 방법과 방법별 증빙(1호 자필 가~다목·본부 서명·확인서 교부, 2호 내용증명, 4호 발송·수신 시각·인쇄 가능), 계약 전 중요사항 변경 통지',status:'in_force',selectBy:'delivery_date',tier:'gate',basis:'official',sourceUrls:[DEC_L3,DEC_NOW,DEC_LM],verifiedAt:VERIFIED,confidence:'high',
  notes:'시행일 미확인(조사 기준 현행, 2026.8.4 변경 없음)이라 effectiveFrom을 비운다. 3호(정보통신망 게시)는 R11 전에는 제공 방법으로 받지 않는다. 공정위 사이트 링크·요약본은 제공이 아니다. 전자서명은 1호 자필을 대체하지 않는다. 2호는 내용증명 접수 시각부터 센다. ③은 변경 통지를 제1항 각 호 어느 방법으로든 하게 한다. 최근 산입 정보공개서와 같은 방법을 요구하는 것은 COLLECTIVE 휴리스틱(h.change_notice_restart, Q3)이다. 계약서안(제11조)에는 법정 제공 방법이 없어서, 계약서안 기록에 같은 방법·증빙을 요구하는 것도 휴리스틱이다. 사유: method_not_allowed, evidence_incomplete, receipt_unconfirmed, change_notice_method_mismatch.'},
 {id:'kr.fr.nearby_doc',jurisdiction:'KR',article:'가맹사업법 제7조②③',title:'인근가맹점 현황문서(예정지 최근접 10개, 광역 안 10개 미만이면 전부, 없으면 없다는 문서) 제공',status:'in_force',selectBy:'delivery_date',tier:'gate',basis:'official',sourceUrls:[LAW,LAW_LM],verifiedAt:VERIFIED,confidence:'high',
  notes:'예정지 미확정이면 확정 즉시 같은 법정 방법·증빙으로 준다. 사유: nearby_missing.'},
 {id:'kr.fr.escrow',jurisdiction:'KR',article:'가맹사업법 제6조의5①(제2조6호 가·나목), 시행령 제5조의8, 제15조의2(피해보상보험 예외), 제11조②9호',title:'가맹금(가입비·교육비·계약금·담보성 금전) 예치기관 예치 또는 피해보상보험',status:'in_force',selectBy:'now',tier:'gate',basis:'official',sourceUrls:[LAW,DEC_NOW,LAW_LM],verifiedAt:VERIFIED,confidence:'high',
  notes:'예치기관: 은행·체신관서·보험회사·신탁업자. 계약 체결 전에 낸 가맹금도 포함. 마목(그 밖의 대가)도 보수적으로 예치를 요구한다. 간주 수령 시각은 기록된 증빙 시각(본부 수령·예치 합의·최초 예치) 가운데 가장 이른 것이다. 예치 대상 가맹금을 최초 예치보다 먼저 본부가 받았다면 직접 수령(제41조③1호)이라 예치 증빙으로 보지 않는다. 사유: escrow_unproven.'},
 {id:'kr.fr.forecast_statement',jurisdiction:'KR',article:'가맹사업법 제9조⑤⑥⑦, 시행령 제9조③~⑤, 법제처 해석 24-0795',title:'예상매출액 산정서 서면 제공 의무(중소기업자가 아니거나 직전 사업연도 말 가맹점 100개 이상)',status:'in_force',selectBy:'now',tier:'gate',basis:'official',sourceUrls:[LAW,DEC_L3,DEC_NOW,MOLEG_24_0795],verifiedAt:VERIFIED,confidence:'high',
  notes:'의무 또는 미확인이면 계약 전(서명 시각 이전) 서면 산정서 기록이 필요하다. 산정·점포 선택은 하지 않는다. 중소기업 여부는 법적 지위를 입력받고 매출로 추정하지 않는다. 5년 보관은 R4b. 사유: forecast_statement_missing.'},
 {id:'kr.fr.change_deadlines',family:'kr.fr.change_deadlines',jurisdiction:'KR',article:'가맹사업법 시행령 별표 1의2(현행, 2021.11.19 개정), 제5조의3',title:'정보공개서 변경등록 기한: 사유 발생 30일, 분기 종료 후 30일, 사업연도 종료 후 120일(재무제표 작성 개인사업자 180일)',status:'in_force',effectiveFrom:'2021-11-19',effectiveTo:'2028-01-01',selectBy:'application_date',tier:'sla',basis:'official',sourceUrls:[DEC_L3,DEC_NOW,FTC_47793],verifiedAt:VERIFIED,confidence:'high',
  notes:'2028.1.1 전 신청한 등록·변경등록은 종전 규정(부칙 제2조). 항목별 분류는 조사 요약 기준이라 일부 항목은 가장 짧은 기준을 쓴다. 기한에는 공휴일 연장을 하지 않는다(이른 알림이 보수적).'},
 {id:'kr.fr.change_deadlines_2028',family:'kr.fr.change_deadlines',jurisdiction:'KR',article:'개정 시행령 별표 1의2(대통령령 제36561호), 부칙 제2조',title:'변경등록 기한 개편: 가맹점·직영점 수, 개폐점 변동 수, 기타 영업표지 가맹점 수, 직영점 목록은 분기 종료 후 30일, 장기운영 가맹점 정보는 사업연도 종료 후 120일',status:'scheduled',effectiveFrom:'2028-01-01',selectBy:'application_date',tier:'sla',basis:'official',sourceUrls:[DEC_2028,FTC_47793,NOTICE_FORM_2026],verifiedAt:VERIFIED,confidence:'high',
  notes:'신청일이 2028-01-01 이후일 때 고른다(selectBy application_date). 2027 사업연도 4분기 분기 항목에 적용되는지는 확인 필요.'},
 // 공식 규정: 모집 표현(R2가 쓴다)
 {id:'kr.fr.revenue_guarantee',jurisdiction:'KR',article:'가맹사업법 제9조①, 시행령 제8조①1호, 허위·과장 정보제공 유형 지정고시 제2019-8호',title:'수익·매출 보장, 최저 수익 보장 표현',status:'in_force',selectBy:'now',tier:'hard_block',basis:'official',sourceUrls:[LAW,DEC_L3,DEC_NOW,NOTICE_2019_8,FTC_46672],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'원장·[확인 필요]·관리자 해제로 풀리지 않는다. 부정문(수익을 보장하지 않습니다)은 잡지 않는다(R2).'},
 {id:'kr.fr.insurance_mark',jurisdiction:'KR',article:'가맹사업법 제15조의2(⑥), 제41조③3호',title:"피해보상보험 등 체결 사실 없는 보험 표지·'가맹금 안전' 표현",status:'in_force',selectBy:'now',tier:'hard_block',basis:'official',sourceUrls:[LAW,LAW_LSW],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand'},
 {id:'kr.fr.association_condition',family:'kr.fr.association_condition',jurisdiction:'KR',article:'가맹사업법 제14조의2⑤(법률 제12094호)',title:'가맹점사업자단체 가입·미가입을 조건으로 한 계약·불이익 금지',status:'in_force',effectiveFrom:'2014-02-14',effectiveTo:'2026-12-31',selectBy:'now',tier:'hard_block',basis:'official',sourceUrls:[LAW,LAW_LM],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'현행 문언은 계획 심사에서 [L9]로 대조. 2026-12-31부터 같은 금지가 ⑥으로 옮겨진다(kr.fr.association_condition_2026).'},
 {id:'kr.fr.association_condition_2026',family:'kr.fr.association_condition',jurisdiction:'KR',article:'가맹사업법 제14조의2⑥(법률 제21295호)',title:'가맹점사업자단체 가입·미가입 조건 금지(항 이동)',status:'scheduled',effectiveFrom:'2026-12-31',selectBy:'now',tier:'hard_block',basis:'official',sourceUrls:[LAW_2026_LSW,LAW_2026],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand'},
 {id:'kr.fr.association_bargaining',jurisdiction:'KR',article:'가맹사업법 신설 제14조의2④, 제14조의3(법률 제21295호)',title:'등록 가맹점사업자단체 등록제와 협의의무',status:'scheduled',effectiveFrom:'2026-12-31',selectBy:'now',tier:'info',basis:'official',sourceUrls:[LAW_2026_LSW,LAW_2026,FTC_47838],verifiedAt:VERIFIED,confidence:'high',
  notes:'부칙: 시행 이후 요청분부터. ruleAt 경계(2026-12-30 null, 2026-12-31 적용).'},
 {id:'kr.fr.association_decree',jurisdiction:'KR',article:'가맹점사업자단체 관련 시행령 개정안·단체등록 고시 제정안(입법·행정예고 종료, 미공포)',title:'단체 등록 요건 수치(가입 10% 또는 1,000명, 최소 30명, 재요청 180·60·90일)',status:'proposed',selectBy:'now',tier:'none',basis:'official',sourceUrls:[FTC_47838],verifiedAt:VERIFIED,confidence:'medium',
  notes:'미공포. effectiveFrom을 추정해 넣지 않는다. 어떤 날짜에도 적용하지 않는다. 공포 뒤 코드 PR로만 scheduled로 올린다.'},
 {id:'kr.fr.independent_advisor',jurisdiction:'KR',article:'가맹점주 권익강화 종합대책(2025.9.23) 과제, 미입법',title:'7일 단축을 가맹본부와 고용·특수관계 없는 독립 전문가 자문에만 허용',status:'proposed',selectBy:'delivery_date',tier:'none',basis:'official',sourceUrls:[FTC_11315,LAW_LM],verifiedAt:VERIFIED,confidence:'medium',
  notes:'미입법이라 적용하지 않는다. h.advice_shortening_evidence는 본부 비용·소개 자문에 경고(advisor_independence_unverified)만 낸다.'},
 {id:'kr.fr.store_count_claims',jurisdiction:'KR',article:'허위·과장 정보제공 유형 지정고시 제2019-8호(누적 계약 수를 영업 중 가맹점처럼), 표시광고법 제3조①1호',title:"'N호점·성업 중 N개·오픈 예정 N개' 매장 수 주장은 확정 가맹점 수 값·기준일과 대조",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'official',sourceUrls:[NOTICE_2019_8,AD_ACT,FTC_47549],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'값 대조는 R2(VALUE_KINDS).'},
 {id:'kr.fr.startup_cost_claims',jurisdiction:'KR',article:"시행령 별표 1 제5호가목4)(현행, 2028.1.1 개편 전), 고시 제2019-8호(추가 비용을 뺀 창업비용, 근거 없는 '업계 최저 창업비용')",title:'창업비용 표현은 매장 유형·포함·불포함 항목·전용면적 3.3㎡당 비용·추정이면 상·하한과 함께',status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'official',sourceUrls:[DEC_NOW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'R0 체크리스트 24행.'},
 {id:'kr.fr.ip_claims',jurisdiction:'KR',article:"시행령 제8조①3호, 고시 제2019-8호(출원만 한 특허를 '특허받은', 미등록 상표를 등록번호로)",title:"'특허·등록' 표현은 등록번호 사실이 있을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'official',sourceUrls:[DEC_L3,DEC_NOW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'R0 체크리스트 16행.'},
 {id:'kr.fr.conditional_support',jurisdiction:'KR',article:'시행령 제8조②2호',title:'요건을 채워야 받는 지원을 무조건 지원처럼 표현 금지(조건·기간 병기 필요)',status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'official',sourceUrls:[DEC_L3,DEC_NOW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'정부 창업 지원·대출 연계 문구 포함.'},
 {id:'kr.fr.superlative_claims',jurisdiction:'KR',article:"고시 제2019-8호('업계 최저 창업비용'), 부당한 표시·광고 유형 고시·비교표시광고 심사지침(배타 표현)",title:"'업계 최저·1위·최초·유일'은 기준·출처 사실이 있을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'official',sourceUrls:[NOTICE_2019_8,AD_ACT],verifiedAt:VERIFIED,confidence:'medium',scope:'franchise_brand',
  notes:'배타 표현 고시 원문은 미열람, 2차 자료 기준(신뢰도 중간).'},
 {id:'kr.fr.trade_area_claims',jurisdiction:'KR',article:'시행령 제8조①2호, 고시 제2019-8호(인근 동종 점포를 없는 것처럼)',title:"'상권 분석·유동인구·경쟁 점포 없음' 등 상권 주장은 출처·확인일 사실이 있을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'official',sourceUrls:[DEC_L3,DEC_NOW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand'},
 {id:'kr.fr.production_claims',jurisdiction:'KR',article:'고시 제2019-8호(OEM 생산을 직영 공장 생산처럼)',title:"'자체 공장·직접 생산' 표현은 production_method 확정 사실이 있을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'official',sourceUrls:[NOTICE_2019_8,DEC_L3,DEC_NOW],verifiedAt:VERIFIED,confidence:'high',scope:'objective_export',
  notes:"소비자 캠페인 오탐 방지를 위해 objective_export 범위. '수제'는 h.handmade_claims로 나눴다. R0 체크리스트 23행."},
 {id:'kr.fr.exclusive_channel_claims',jurisdiction:'KR',article:'고시 제2019-8호(다른 유통 채널로도 파는 상품을 가맹점 전용처럼)',title:"'가맹점 전용·가맹점에서만' 표현은 sales_channels 확정 사실이 있을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'official',sourceUrls:[NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'high',scope:'objective_export'},
 {id:'kr.fr.territory_claims',jurisdiction:'KR',article:'가맹사업법 제12조의4, 시행령 제13조의4',title:"'독점 상권' 표현에 영업지역 조항 사실이 없으면 경고",status:'in_force',selectBy:'now',tier:'warn',basis:'official',sourceUrls:[LAW,DEC_L3,DEC_NOW],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'영업지역 점검은 조건부 R12.'},
 // 공식 규정: 광고
 {id:'kr.ad.endorsement_disclosure',jurisdiction:'KR',article:'추천·보증 등에 관한 표시·광고 심사지침(2024.12.1), 표시광고법 제3조①',title:'경제적 이해관계 표시 없는 점주 후기 경고(제목·첫 부분 표시)',status:'in_force',effectiveFrom:'2024-12-01',selectBy:'now',tier:'warn',basis:'official',sourceUrls:[FTC_ENDORSE,AD_ACT],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'후기 동의 기록은 R2 testimonial_consent.'},
 {id:'kr.ad.virtual_human_label',jurisdiction:'KR',article:'추천·보증 심사지침 개정(2026.6.1, 가상인물 표시), 표시광고법 제3조①',title:"'가상인물' 표시 없는 AI 가상인물 경고",status:'in_force',effectiveFrom:'2026-06-01',selectBy:'now',tier:'warn',basis:'official',sourceUrls:[FTC_ENDORSE,AD_ACT],verifiedAt:VERIFIED,confidence:'high',scope:'franchise_brand',
  notes:'표시광고법 URL은 R2 규제 사전 이관 때 law.go.kr 출처 요건(tests/compliance.test.mjs)을 맞추려고 더했다.'},
 // COLLECTIVE 휴리스틱(H1~H14와 형제 규칙). 법령이 정한 것이 아니라 보수적으로 고른 기본값이다.
 {id:'h.later_disclosure_doc',jurisdiction:'KR',article:"H1(착안: 제7조②③ '정보공개서등을 제공한 날')",title:'정보공개서 쪽 대기는 정보공개서와 인근가맹점 현황문서 중 늦게 준 날부터 센다. 먼저 준 문서 기록은 거부하지 않는다',status:'in_force',selectBy:'delivery_date',tier:'gate',basis:'heuristic',sourceUrls:[LAW,LAW_LM],verifiedAt:VERIFIED,confidence:'medium',question:'Q2',
  notes:'강화는 즉시, 완화는 LR-1 회신과 코드 PR로만.'},
 {id:'h.first_day_excluded',jurisdiction:'KR',article:'H2(착안: 제7조③·제11조①, 민법 제157조 초일 불산입 유추)',title:'KST 날짜로 세고 초일은 넣지 않는다. 제공일 D면 D+14일이 마지막 날이고 그다음 날 00:00 KST부터 계약·가맹금 가능(단축 시 D+7일이 마지막 날)',status:'in_force',selectBy:'delivery_date',tier:'gate',basis:'heuristic',sourceUrls:[LAW,LAW_LM,CIVIL],verifiedAt:VERIFIED,confidence:'medium',question:'Q1',
  notes:'KST는 +09:00 고정. 00:00 정각 제공도 초일 불산입(민법 제157조 단서 미적용, 늦게 열리는 쪽). 말일 공휴일 연장은 h.last_day_holiday_extension이 더한다.'},
 {id:'h.change_notice_restart',jurisdiction:'KR',article:'H3(착안: 시행령 제6조③ 계약 전 중요사항 변경 통지)',title:'계약 전 중요사항 변경을 통지하면 정보공개서 쪽 대기를 통지일부터 다시 센다. 통지는 최근 산입 정보공개서와 같은 방법이어야 산입',status:'in_force',selectBy:'delivery_date',tier:'gate',basis:'heuristic',sourceUrls:[DEC_L3,DEC_NOW],verifiedAt:VERIFIED,confidence:'medium',question:'Q3',
  notes:'시행령 제6조③은 제1항 각 호 어느 방법이든 허용한다. 같은 방법 요구는 COLLECTIVE 보수 해석(Q3)이다. 방법이 달라 산입하지 않은 통지는 그 뒤 산입된 정보공개서 재제공이 있으면 대체된 것으로 본다. 사유: change_notice_method_mismatch, contract_too_early.'},
 {id:'h.advice_shortening_evidence',jurisdiction:'KR',article:'H4(착안: 제7조③·제11조① 자문 시 7일, 제11조②10호)',title:'7일 단축은 문서별 자문 증빙(자문자 유형 변호사·가맹거래사, 등록 확인, 자문일, 대상 문서)이 있을 때만. 본부가 비용을 대거나 소개한 자문은 경고',status:'in_force',selectBy:'delivery_date',tier:'gate',basis:'heuristic',sourceUrls:[LAW,FTC_11315],verifiedAt:VERIFIED,confidence:'medium',question:'Q4',
  notes:'자문일은 그 쪽 시작일 이상이어야 하고, 단축 시 여는 시각은 max(7일 대기 뒤, 자문일 다음 날 00:00 KST). 그 값이 14일 대기보다 늦으면 14일을 쓴다(자문이 게이트를 늦추지 않는다, 법정 상한 14일). 계약·가맹금·약정 판정에는 그 시각의 KST 날짜 이전 자문만 쓴다. 독립성 요건은 proposed(kr.fr.independent_advisor)라 경고만. 사유: shortening_unproven, 경고 advisor_independence_unverified. 문구 차단은 h.captive_advisor_phrase.'},
 {id:'h.m4_receipt_required',jurisdiction:'KR',article:"H5(착안: 시행령 제6조①4호 '발송시간과 수신시간을 확인')",title:'4호(전자우편·문자·앱 파일)는 수신 시각 증빙이 있어야 제공으로 세고, 수신 시각부터 기산',status:'in_force',selectBy:'delivery_date',tier:'gate',basis:'heuristic',sourceUrls:[DEC_L3,DEC_NOW],verifiedAt:VERIFIED,confidence:'medium',question:'Q5',
  notes:'알림톡 파일 발송의 4호 해당 여부는 LR-2(Q8) 전에는 판단하지 않는다(채널 email·sms·app만). 사유: receipt_unconfirmed.'},
 {id:'h.revenue_figures_no_ad',jurisdiction:'KR',article:'H6(착안: 제9조③ 서면 원칙, 고시 제2019-8호 성공 사례 매출 부풀림)',title:'정보공개서 평균매출, 직영점 매출·공헌이익, 월 매출, 수익률 수치는 광고·캡션·사실 카드·랜딩·설명회 슬라이드에 쓰지 않는다(adUse:false)',status:'in_force',selectBy:'now',tier:'hard_block',basis:'heuristic',sourceUrls:[LAW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'medium',scope:'franchise_brand',question:'Q5',
  notes:'기간·표본·근거를 붙인 서면 자료에서만 쓴다.'},
 {id:'h.pre_registration_recruiting',jurisdiction:'KR',article:'H7(착안: 제6조의2, 제7조①; 등록 전 모집 허용 조항 미확인)',title:'정보공개서 등록 전에는 유료 모집 광고·박람회·설명회·가맹 조건 제시를 하지 않고, 1차 회신 전에는 문의를 COLLECTIVE에 기록하지 않는다',status:'in_force',selectBy:'now',tier:'gate',basis:'heuristic',sourceUrls:[LAW,EASYLAW],verifiedAt:VERIFIED,confidence:'medium',question:'Q7',
  notes:'분기 B의 inquiry 409는 R4b가 프로필 상태로 판정한다(R4a checkTransition은 inquiry를 막지 않는다).'},
 {id:'h.fact_opinion_labels',jurisdiction:'KR',article:'H8(착안: 정보공개서 표준양식 고시 제3조3호 사실·의견 분리)',title:'가맹 조건 수치 문장에는 [사실: 항목·기준일], 전망·장점 문장에는 [의견]을 붙인다',status:'in_force',selectBy:'now',tier:'warn',basis:'heuristic',sourceUrls:[NOTICE_FORM_OLD,NOTICE_FORM_2026],verifiedAt:VERIFIED,confidence:'medium',scope:'franchise_brand'},
 {id:'h.headline_claim_block',jurisdiction:'KR',article:"H9(착안: 과징금 부과기준 고시 제2026-12호 '가장 강조된 경우')",title:'헤드라인·첫 줄·키비주얼의 수치 주장은 warn 대신 block',status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'heuristic',sourceUrls:[NOTICE_PENALTY,FTC_47793],verifiedAt:VERIFIED,confidence:'medium',scope:'franchise_brand',
  notes:"계획 R2 표의 '강화' 행."},
 {id:'h.same_asset_30_review',jurisdiction:'KR',article:"H10(착안: 과징금 고시 제2026-12호 '피해 가맹희망자 30명 이상')",title:'같은 승인 소재 버전에 귀속된 가맹희망자가 30명에 이르기 전에 재검토 할 일을 띄운다',status:'in_force',selectBy:'now',tier:'sla',basis:'heuristic',sourceUrls:[NOTICE_PENALTY],verifiedAt:VERIFIED,confidence:'medium',
  notes:'R6 할 일.'},
 {id:'h.lead_retention_180',jurisdiction:'KR',article:'H11(법정 기준 없음; 착안: 개인정보 보호법 제21조)',title:'미전환 리드는 마지막 활동 또는 종결 뒤 180일에 파기한다',status:'in_force',selectBy:'now',tier:'sla',basis:'heuristic',sourceUrls:[PIPA],verifiedAt:VERIFIED,confidence:'low',question:'Q6',
  notes:'LR-1 회신으로 확정. 파기 실행은 R4b.'},
 {id:'h.small_sample_suppression',jurisdiction:'KR',article:'H12(성장 계획 KPI 관행, [M5] 미국 벤더 참고치)',title:"비율은 분모 n<20이면 숨기고 건수와 '표본 부족'을 보인다. 계약 코호트는 문의 뒤 90일 전이면 '미성숙'. speed-to-lead 1시간은 참고치",status:'in_force',selectBy:'now',tier:'info',basis:'heuristic',sourceUrls:['https://www.franconnect.com/en/franchise-development-benchmarks-2025/'],verifiedAt:VERIFIED,confidence:'medium',
  notes:"R6 표시 규칙. 미국 수치는 '미국·외부' 라벨로만."},
 {id:'h.zero_cost_claims',jurisdiction:'KR',article:'H13(착안: 고시 제2019-8호 기만 예시, 시행령 별표 1 제5호나목2) 차액가맹금)',title:"'로열티 0원·가맹비 면제·교육비 없음' 같은 비용 0 표현은 필수품목 공급 조건(공급가격 산정방식, 차액가맹금 여부)과 그 밖의 비용을 같은 화면에 적을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'heuristic',sourceUrls:[NOTICE_2019_8,DEC_NOW],verifiedAt:VERIFIED,confidence:'medium',scope:'franchise_brand'},
 {id:'h.direct_store_popularity',jurisdiction:'KR',article:'H14(착안: 시행령 제8조①1호, 고시 제2019-8호 이례적 가맹점 매출 기만 예시)',title:"직영 매장의 대기줄·완판·판매량·화제성 표현은 출처·기간 사실과 '직영점 실적' 표지가 있을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'heuristic',sourceUrls:[DEC_L3,DEC_NOW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'medium',scope:'objective_export',
  notes:'소비자 캠페인에는 걸지 않는다. 가맹점 성과로 잇는 문장은 h.direct_to_franchise_inference(warn).'},
 {id:'h.last_day_holiday_extension',jurisdiction:'KR',article:'대표 지시(2026-09-25), 민법 제161조 유추(기간 말일이 토요일·공휴일이면 익일 만료), 관공서의 공휴일에 관한 규정 제2·3조',title:'대기기간 마지막 날이 토·일요일 또는 호출자가 준 공휴일이면 다음 첫 평일까지를 기간으로 보고, 계약·가맹금은 그 평일 다음 날 00:00 KST부터 허용',status:'in_force',selectBy:'delivery_date',tier:'gate',basis:'heuristic',sourceUrls:[CIVIL,GOV_HOLIDAYS,LAW],verifiedAt:'2026-09-25T00:00:00+09:00',confidence:'low',question:'Q1',
  notes:'계획보다 보수적인 강화라 신뢰도가 낮아도 게이트를 늦게 열 뿐이다. 공휴일 목록이 없거나 비면, 또는 말일 판정에 걸친 연도의 날짜가 목록에 하나도 없으면(그해를 덮지 않는 목록) 주말만 연장하고 경고 holiday_calendar_unverified(평일 공휴일·대체공휴일을 놓쳐 더 일찍 열 수 있다). 연장은 말일에만 하고 여는 날이 주말이어도 더 늦추지 않는다. 변경등록 기한(sla)에는 적용하지 않는다. 금지기간에 제161조를 적용하는지, 행정기본법 제6조② 반대 해석과의 관계는 LR-1 Q1 확인 대상.'},
 {id:'h.net_profit_payback_claims',jurisdiction:'KR',article:'H6 확장(착안: 제9조①, 시행령 제8조①1호)',title:"'월 순수익 N원'·'투자금 회수 N개월' 같은 수치 표현은 보장 표현이 아니어도 차단",status:'in_force',selectBy:'now',tier:'hard_block',basis:'heuristic',sourceUrls:[LAW,DEC_L3,DEC_NOW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'medium',scope:'franchise_brand',
  notes:'계획 R2 hard_block 1행의 휴리스틱 부분.'},
 {id:'h.wait_bypass_solicitation',jurisdiction:'KR',article:'가맹사업법 제2조6호, 제7조③, 제11조①(패턴은 휴리스틱), [F3]',title:"가계약금·상권 선점 예약금·우선협상 보증금, 본계약 전 점포 개발 약정의 보증금 선납 요청, 계약·가맹금·가맹 문맥의 '바로 계약·대기 없이' 등 대기기간 우회 유도",status:'in_force',selectBy:'now',tier:'hard_block',basis:'heuristic',sourceUrls:[LAW,FTC_47293,LAW_LM],verifiedAt:VERIFIED,confidence:'medium',scope:'franchise_brand',
  notes:"'대기 없이 바로 픽업' 같은 소비자 문장은 계약·가맹금·가맹 문맥이 없으면 잡지 않는다(R2 오탐 테스트)."},
 {id:'h.captive_advisor_phrase',jurisdiction:'KR',article:'H4 문구 차단(착안: 제29조④ 미등록자 가맹거래사 표시 금지와 별개)',title:"'본사 전속 가맹거래사로 7일 계약' 류 문구",status:'in_force',selectBy:'now',tier:'hard_block',basis:'heuristic',sourceUrls:[LAW,LAW_LM],verifiedAt:VERIFIED,confidence:'medium',scope:'franchise_brand',question:'Q4'},
 {id:'h.handmade_claims',jurisdiction:'KR',article:'고시 제2019-8호 공급 상품 표제의 확장 적용(예시에는 없음)',title:"'수제' 표현은 production_method 확정 사실이 있을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'heuristic',sourceUrls:[NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'medium',scope:'objective_export',
  notes:"'매일 직접 굽는 수제 도넛' 같은 소비자 캠페인 문장은 오탐 0이어야 한다(R2)."},
 {id:'h.exclusive_supply_claims',jurisdiction:'KR',article:'고시 제2019-8호 표제 확장, 제11조②12호, 시행령 별표 1 제6호가목1), H13',title:"'본사 독점 공급' 표현은 필수품목 사실과 12호(공급가격 산정방식)·차액가맹금 병기 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'heuristic',sourceUrls:[NOTICE_2019_8,LAW,DEC_NOW],verifiedAt:VERIFIED,confidence:'medium',scope:'objective_export'},
 {id:'h.collab_rights_claims',jurisdiction:'KR',article:'부정경쟁방지법 제2조1호 나목·타목, 표시광고법 제3조①(적용 범위·문구는 휴리스틱)',title:'다른 회사·아티스트 이름·로고를 쓴 협업 표기는 권리자 서면 동의와 매체·기간 사실, 과거형 사실 캡션이 있을 때만',status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'heuristic',sourceUrls:[AD_ACT,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'medium',scope:'objective_export',
  notes:'부정경쟁방지법 원문 URL은 조사 자료·계획 출처에 없어 R2 착수 때 확인한다.'},
 {id:'h.own_ip_claims',jurisdiction:'KR',article:'시행령 제8조①3호, 상표법(적용 범위·문구는 휴리스틱)',title:"'자체 IP·자체 캐릭터·자체 상표'는 상표권자·저작권 귀속 사실이 있을 때만(권리자가 가맹본부와 다르면 사용 허락 관계로 표기)",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'heuristic',sourceUrls:[DEC_L3,DEC_NOW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'medium',scope:'objective_export',
  notes:'상표법 원문 URL 미수집.'},
 {id:'h.heritage_claims',jurisdiction:'KR',article:'표시광고법 제3조①(적용 범위·문구는 휴리스틱)',title:"'N년 전통·since·EST'는 개업·운영 주체와 연속 운영 증빙이 있을 때만",status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'heuristic',sourceUrls:[AD_ACT],verifiedAt:VERIFIED,confidence:'medium',scope:'objective_export'},
 {id:'h.direct_to_franchise_inference',jurisdiction:'KR',article:'H14(착안: 시행령 제8조①1호)',title:'직영점 성과를 가맹점에서도 기대할 수 있는 것처럼 잇는 문장은 경고(패턴으로 다 잡지 못해 승인자가 확인)',status:'in_force',selectBy:'now',tier:'warn',basis:'heuristic',sourceUrls:[DEC_L3,DEC_NOW,NOTICE_2019_8],verifiedAt:VERIFIED,confidence:'medium',scope:'objective_export'},
 {id:'h.pre_contract_development_agreement',jurisdiction:'KR',article:'수동 절차서 v0 7단계(착안: 제2조6호, 제7조③, 제11조①, [F3] 명칭이 아닌 내용으로 판단)',title:'본계약 전 점포 개발 약정이 가맹금 수령·인테리어 공사·교육 조항을 담으면 계약 가능 시각 뒤에만 맺는다. 그 조항이 없으면 후보 점포 검토만 적은 약정으로 본다',status:'in_force',selectBy:'now',tier:'gate',basis:'heuristic',sourceUrls:[LAW,FTC_47293,FTC_11315],verifiedAt:VERIFIED,confidence:'medium',question:'Q7',
  notes:'checkAgreement와 contracted 전이에서 판정. 사유: pre_contract_agreement_too_early.'},
 {id:'h.evidence_integrity',jurisdiction:'KR',article:"트랙 R 설계 원칙 4(착안: 제7조① '제공 시점을 객관적으로 확인할 수 있는' 방법)",title:'기산은 증빙에 묶인 시각만 쓴다. 기록 시각보다 이른 증빙 시각은 관리자 역할·사유 코드·감사 이벤트가 있어야 받는다. 미래 시각은 거부하고, 같은 id는 한 번만 센다',status:'in_force',selectBy:'now',tier:'gate',basis:'heuristic',sourceUrls:[LAW,DEC_L3,DEC_NOW],verifiedAt:VERIFIED,confidence:'medium',
  notes:'허용 오차 없음. 대표(owner)도 역할·사유 코드·감사 이벤트 id를 모두 갖춰야 한다. 같은 id 내용 충돌은 산입하지 않고, 따로 보면 거부될 기록은 충돌이어도 거부한다. 계약·가맹금·약정 판정은 그 시각 이전의 증빙만 쓴다(뒤에 기록된 재제공·통지·자문이 이미 한 계약을 뒤집지 않는다). 사유: future_delivery, future_event, backdate_unapproved, delivery_id_conflict. 게이트 시나리오 12.'},
 // 플랫폼 정책(공식 규정과 분리 표시)
 {id:'platform.meta.lead_form_fields',jurisdiction:'KR',article:'Meta 광고 기준, 리드광고 약관',title:'인스턴트 양식은 사전 허가 없이 금융정보·정부 식별번호 등을 묻지 않고 처리방침 URL을 둔다. 투자수익 보장 금지',status:'in_force',selectBy:'now',tier:'block_unless_evidence',basis:'platform',sourceUrls:['https://transparency.meta.com/policies/ad-standards/','https://www.facebook.com/legal/leadgen/tos'],verifiedAt:VERIFIED,confidence:'medium',
  notes:"계획 표 등급 'block'을 block_unless_evidence(사전 허가 증빙)로 옮겼다. '창업 예산 구간' 문항의 해당 여부는 열린 질문 13."},
 {id:'platform.kakao.alimtalk',jurisdiction:'KR',article:'카카오 알림톡 심사 가이드, 카카오 브랜드 메시지',title:'알림톡은 정보성 전용, 브랜드 메시지 광고성은 08:00~20:50',status:'in_force',selectBy:'now',tier:'warn',basis:'platform',sourceUrls:['https://kakaobusiness.gitbook.io/main/ad/infotalk/audit','https://kakaobusiness.gitbook.io/main/ad/brandmessage'],verifiedAt:VERIFIED,confidence:'medium',
  notes:"계획 표 등급 'warn'. R9가 발송 기록 거부로 쓴다."},
];
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
const freezeRule=(r:FranchiseRule):FranchiseRule=>Object.freeze({...r,sourceUrls:Object.freeze([...r.sourceUrls])});
// id 오름차순, 규칙 객체와 출처 배열까지 얼린다.
export const FRANCHISE_RULES:readonly FranchiseRule[]=Object.freeze(RULES.map(freezeRule).sort((a,b)=>ascii(a.id,b.id)));

// ── 규칙 선택 ──
// [effectiveFrom, effectiveTo)가 날짜를 포함하는 in_force·scheduled만 적용한다. proposed는 날짜가 적혀 있어도 적용하지 않는다.
const inWindow=(r:FranchiseRule,d:string)=>(!r.effectiveFrom||r.effectiveFrom<=d)&&(!r.effectiveTo||d<r.effectiveTo);
const applies=(r:FranchiseRule,d:string)=>(r.status==='in_force'||r.status==='scheduled')&&inWindow(r,d);
// id 또는 family로 그 날짜의 규칙 버전 하나를 고른다. date는 KST 날짜 또는 시간대 있는 시각(KST 날짜로 바꾼다). 모르는 id나 적용 버전이 없으면 null.
export function ruleAt(id:string,date:string):FranchiseRule|null{
 const d=kstDateOf(date);
 if(typeof id!=='string')return null;
 return FRANCHISE_RULES.find(r=>(r.id===id||r.family===id)&&applies(r,d))??null;
}
// 그 날짜에 적용되는 규칙 가운데 filter의 모든 조건을 만족하는 것을 id 오름차순 새 배열로 돌려준다. selectBy에 맞는 날짜 선택은 호출자 몫이다.
export function rulesAt(date:string,filter?:RuleFilter):FranchiseRule[]{
 const d=kstDateOf(date),f:RuleFilter=filter&&typeof filter==='object'?filter:{};
 // ids가 있는데 배열이 아니면 조건을 무시하지 않고 빈 결과로 닫는다(fail-closed).
 if(f.ids!==undefined&&!Array.isArray(f.ids))return [];
 const ids=Array.isArray(f.ids)?f.ids:null;
 return FRANCHISE_RULES.filter(r=>applies(r,d)&&(f.basis===undefined||r.basis===f.basis)&&(f.tier===undefined||r.tier===f.tier)&&(f.status===undefined||r.status===f.status)
  &&(f.selectBy===undefined||r.selectBy===f.selectBy)&&(f.family===undefined||r.id===f.family||r.family===f.family)&&(f.scope===undefined||r.scope===f.scope)&&(!ids||ids.includes(r.id))).sort((a,b)=>ascii(a.id,b.id));
}

// ── 레지스트리 자체 검사 ──
// 모듈은 시계를 읽지 않으므로 now를 받는다(테스트가 현재 시각을 넘긴다). 결과는 `${id}:${issue}` ASCII 오름차순.
const RULE_ID=/^(kr\.(fr|ad)|h|platform\.[a-z]+)\.[a-z0-9_]+$/;
const STATUSES:readonly string[]=['in_force','scheduled','proposed'],TIERS:readonly string[]=['hard_block','block_unless_evidence','gate','sla','warn','info','none'],BASES:readonly string[]=['official','heuristic','platform'];
const SELECT_BY:readonly string[]=['now','application_date','delivery_date'],CONFIDENCES:readonly string[]=['high','medium','low'],SCOPES:readonly string[]=['franchise_brand','objective_export'];
const REQUIRED_FIELDS=['article','title','selectBy','tier','basis','confidence','verifiedAt'];
const OFFICIAL_HOSTS:readonly string[]=['www.law.go.kr','www.ftc.go.kr'];
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const filled=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
const basisOfId=(id:string)=>id.startsWith('kr.')?'official':id.startsWith('h.')?'heuristic':id.startsWith('platform.')?'platform':null;
// https URL의 호스트. 실행 환경의 URL 전역에 기대지 않고 정규식 하나로만 본다(환경마다 결과가 달라지지 않게). userinfo(@)·역슬래시·IP 리터럴·공백은 받지 않는다.
const HTTPS_URL=/^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?(?:[/?#]|$)/i;
function httpsHost(u:unknown):string|null{
 if(typeof u!=='string'||/\s|\\/.test(u))return null;
 const m=HTTPS_URL.exec(u);
 return m?m[1].toLowerCase():null;
}
// 시행일 창의 열린 끝. effectiveFrom이 없으면 -∞, effectiveTo가 없으면 +∞로 본다(날짜 문자열 비교).
const OPEN_START='0000-01-01',OPEN_END='9999-12-31';
const windowOf=(r:Record<string,unknown>):[string,string]=>[isDate(r.effectiveFrom)?r.effectiveFrom:OPEN_START,isDate(r.effectiveTo)?r.effectiveTo:OPEN_END];
function ruleIssues(r:unknown,nowMs:number):string[]{
 if(!isRecord(r))return ['id_format','field_missing'];
 const out:string[]=[],id=typeof r.id==='string'?r.id:'';
 if(!RULE_ID.test(id))out.push('id_format');
 else if(basisOfId(id)!==r.basis)out.push('id_basis_mismatch');
 if(REQUIRED_FIELDS.some(k=>!filled(r[k])))out.push('field_missing');
 const enumBad=r.jurisdiction!=='KR'||!STATUSES.includes(String(r.status))||(filled(r.selectBy)&&!SELECT_BY.includes(String(r.selectBy)))||(filled(r.tier)&&!TIERS.includes(String(r.tier)))
  ||(filled(r.basis)&&!BASES.includes(String(r.basis)))||(filled(r.confidence)&&!CONFIDENCES.includes(String(r.confidence)))||(r.scope!==undefined&&!SCOPES.includes(String(r.scope)))||(r.family!==undefined&&!RULE_ID.test(String(r.family)));
 if(enumBad)out.push('enum_invalid');
 const fromBad=r.effectiveFrom!==undefined&&!isDate(r.effectiveFrom),toBad=r.effectiveTo!==undefined&&!isDate(r.effectiveTo);
 if(fromBad||toBad)out.push('date_invalid');
 else if(isDate(r.effectiveFrom)&&isDate(r.effectiveTo)&&r.effectiveFrom>=r.effectiveTo)out.push('window_invalid');
 if(r.status==='scheduled'&&!isDate(r.effectiveFrom))out.push('scheduled_without_from');
 if(r.status==='proposed'&&(r.effectiveFrom!==undefined||r.effectiveTo!==undefined))out.push('proposed_has_dates');
 if(r.status==='proposed'&&r.tier!=='none')out.push('proposed_tier');
 if(r.tier==='none'&&r.status!=='proposed')out.push('tier_none_not_proposed');
 const urls=Array.isArray(r.sourceUrls)?r.sourceUrls:[];
 if(!urls.length)out.push('source_missing');
 const hosts=urls.map(httpsHost);
 if(hosts.some(h=>h===null))out.push('source_not_https');
 if(r.basis==='official'&&r.status!=='proposed'&&!hosts.some(h=>h!==null&&OFFICIAL_HOSTS.includes(h)))out.push('official_source_host');
 if(filled(r.verifiedAt)){
  if(!isInstant(r.verifiedAt))out.push('verified_at_invalid');
  else if(parseInstant(r.verifiedAt)>nowMs)out.push('verified_at_future');
 }
 return out;
}
// 같은 family의 적용 가능한(proposed가 아닌) 구성원 창이 겹치면 두 규칙 모두에 family_overlap을 단다. ruleAt이 family로 한 버전만 고르게 하는 전제다.
function familyOverlaps(rules:readonly unknown[]):string[]{
 const members=rules.filter(isRecord).filter(r=>typeof r.family==='string'&&r.status!=='proposed'&&typeof r.id==='string');
 const out:string[]=[];
 members.forEach((a,i)=>members.slice(i+1).forEach(b=>{
  if(a.family!==b.family)return;
  const [af,at]=windowOf(a),[bf,bt]=windowOf(b);
  if(af<bt&&bf<at)out.push(`${a.id}:family_overlap`,`${b.id}:family_overlap`);
 }));
 return out;
}
const SAFE_ID=/^[A-Za-z0-9._:-]{1,128}$/;
// rules가 배열이 아니면 '깨끗함'이 아니라 registry:rules_invalid를 낸다. 라벨 '?'(id를 읽을 수 없는 항목)끼리는 중복으로 세지 않는다.
export function registryIssues(now:string,rules:readonly FranchiseRule[]=FRANCHISE_RULES):string[]{
 if(!isInstant(now))return ['registry:now_invalid'];
 if(!Array.isArray(rules))return ['registry:rules_invalid'];
 const nowMs=parseInstant(now),list:readonly unknown[]=rules;
 const label=(r:unknown)=>isRecord(r)&&typeof r.id==='string'&&SAFE_ID.test(r.id)?r.id:'?';
 const counts=new Map<string,number>();
 list.forEach(r=>counts.set(label(r),(counts.get(label(r))??0)+1));
 const out=list.flatMap(r=>[...ruleIssues(r,nowMs),...(label(r)!=='?'&&(counts.get(label(r))??0)>1?['duplicate_id']:[])].map(issue=>`${label(r)}:${issue}`));
 return [...new Set([...out,...familyOverlaps(list)])].sort(ascii);
}

// ── 모집 표현 판정 상수(R2) ──
// 캡션·발행 게이트 판정기(lib/franchise-compliance.ts)가 쓴다. 공식 규칙의 표현 정규식은 규제 사전(lib/graders/compliance-lexicon.ts 범주 franchise_recruit)에 있고,
// 여기에는 휴리스틱 표현 정규식·근거 사실 조건·해제 불가 목록만 둔다. 규칙 레지스트리(FRANCHISE_RULES·FRANCHISE_RULES_VERSION)는 바꾸지 않는다.
export const FRANCHISE_CLAIMS_VERSION='fr-claims@2026-09-25.1';
// 해제 불가 목록(결정 25, 대표 기본값으로 적용 2026-09-25). 원장·[확인 필요]·인용·관리자·대표 승인 어느 것으로도 풀리지 않는다. 완화는 법률 검토(LR-1) 뒤 코드 PR로만 한다.
export const FRANCHISE_HARD_BLOCK_IDS=Object.freeze(['h.captive_advisor_phrase','h.net_profit_payback_claims','h.revenue_figures_no_ad','h.wait_bypass_solicitation','kr.fr.association_condition','kr.fr.association_condition_2026','kr.fr.insurance_mark','kr.fr.revenue_guarantee'] as const);
// 휴리스틱 표현 정규식(문장 단위). also: 같은 문장에 함께 있어야 함. except: 면제(해제 불가 규칙은 매치가 든 절에서만 본다). cleared: 본문에 있으면 해소. title: 화면에 보일 짧은 이름.
// 부정은 매치된 서술에 바로 붙은 것만 인정한다('보장하지 않습니다', '가계약금은 받지 않습니다'). 뒤 절의 '제외·무관·불가·금지·대신'이나 '걱정하지 마세요'는 부정이 아니다(판정기).
export type ClaimMatcher={readonly title:string;readonly match:string;readonly cleared?:string;readonly also?:string;readonly except?:string};
// 소비자 문장과 겹치는 비용 낱말('베이킹 클래스 교육비', '로열티 카드', '로열티 고객 혜택')은 가맹 비용이 아니다.
const CLS_EDU='(?<!(?:클래스|수강|체험|원데이)\\s?)교육비',LOYALTY='로열티(?!\\s?(?:카드|멤버십|회원|포인트|프로그램|적립|클럽|고객|혜택|등급|VIP))';
// 가맹 문맥 낱말(규제 사전 FR_CONTEXT와 같은 모양, 이 파일은 import하지 않는다).
const FR_CTX='(?:가맹|창업|본사|개설|점주|계약(?!직))';
// 금액·비율 수치(숫자 뒤 만·천·억·원·%·배).
const MONEY='\\d[\\d,.]*\\s?(?:만|천|억|원|%|퍼센트|배)';
// 수치 뒤 기부·할인 문맥('매출의 10%를 기부합니다', '하루 매출의 일부(10%)를 전달합니다', '감사 이벤트 20% 할인')은 수익 수치가 아니다. 같은 절(쉼표 전)만 본다.
const NOT_REVENUE='(?![^.,\\n]{0,15}(?:기부|후원|환원|전달|나눔))(?!\\s?(?:할인|OFF|off|세일|적립|페이백|쿠폰))';
// 순위('매출 1위', '매출 TOP')는 수익 수치가 아니다. 앞자리 숫자에 붙은 '월·연·일'('9월 매출', '12월 수입')은 기간이 아니라 날짜다.
const NO_RANK='(?:(?!\\d+\\s?위|TOP|top|베스트)[^.,\\n])';
// 소득으로서 '수입'(뒤에 조사·수·기호). '수입 원두·버터'는 수입품이다.
const INCOME='수입(?=\\s?(?:[은는이가을를도만]|약|평균|최소|최대|\\d|[,:·~]|$))';
const PAYBACK_BASE='(?:투자금|투자\\s?(?:비용|원금)|창업\\s?비용|원금)';
const ZERO='(?:0\\s?원|없음|없는|없이|면제|무료|제로|zero|ZERO|프리|free|FREE)';
const MATCHERS:Record<string,ClaimMatcher>={
 // hard_block. 수치 자체를 막는다(보장 표현이 아니어도, 부정문이어도 막는다: 판정기 FIGURE_IDS). 금액·비율 단위가 붙은 수치만 본다.
 'h.revenue_figures_no_ad':{title:'매출·수익률 수치 광고(H6)',match:`(?:(?<![\\d가-힣])(?:월|연|일)|매월|매달|매년|연간|월간|하루|평균|직영점|가맹점|점포당|매장당)\\s?(?:평균\\s?)?매출(?:액)?(?!\\s?\\d+\\s?위)${NO_RANK}{0,10}?${MONEY}${NOT_REVENUE}|매출액\\s?${MONEY}${NOT_REVENUE}|수익률\\s?\\d|공헌\\s?이익[^.,\\n]{0,10}?\\d`},
 // '이번 달 판매 순수익의 10%를 기부합니다', '9월 수익금의 10%', '12월 수입 원두', '1개월 이내 회수해 세척', '3개월 회수 텀블러'는 수익·회수 수치가 아니다(투자 문맥이 있어야 회수).
 'h.net_profit_payback_claims':{title:'순수익·투자금 회수 수치(H6)',match:`(?:순수익(?!금)|순이익|(?<!\\d)월\\s?수익(?!금)|(?<!\\d)월\\s?${INCOME}|순\\s?마진)${NO_RANK}{0,8}?${MONEY}${NOT_REVENUE}|${PAYBACK_BASE}[^.,\\n]{0,10}?회수|투자\\s?회수|\\d+\\s?(?:개월|년)\\s?(?:만에|안에|이내|이면|내)?\\s?${PAYBACK_BASE}\\s?(?:을|를|이|가)?\\s?(?:전액\\s?)?회수|ROI\\s?\\d`},
 // 가맹·창업 문맥이 있어야 한다. '전 가맹 매장에서 당일 픽업', '가맹 매장 어디서나 바로 사용', '점포별 예약금 선납 후 픽업', '제휴 계약 카드로 결제하면 바로 할인',
 // '계약직 바리스타 즉시 근무', '단체 주문 계약 시 당일 배송'은 소비자 문장이다. '가계약금은 가맹금에 해당합니다'는 정의(같은 절 except), '가계약금 요구는 불법입니다'는 부정이다.
 'h.wait_bypass_solicitation':{title:'가계약금·바로 계약 같은 대기기간 우회 유도',match:'가계약\\s?(?:금)?|상권\\s?(?:선점|예약)\\s?(?:금|비)|우선\\s?협상\\s?(?:보증금|예약금|권)|(?:예약금|보증금)\\s?(?:선납|먼저|미리)|(?:가맹\\s?계약|계약(?!직)|가맹(?!점|\\s?(?:매장|점포|브랜드|카드)))(?!\\s?(?:해지|취소|철회|해제|종료))[^.,\\n]{0,12}?(?:바로|즉시|당일|대기\\s?없이)|(?:바로|즉시|당일|대기\\s?없이)[^.,\\n]{0,8}?(?:가맹\\s?)?(?:계약(?!직)|가맹금)',
  also:'가맹(?!점|\\s?(?:매장|점포|브랜드|카드))|가계약|창업|개설|상권|우선\\s?협상|오픈|개점|출점|입점',except:'가맹금에\\s?(?:해당|포함)'},
 // 법정 대기기간 안내('14일(변호사·가맹거래사 자문시 7일)이 지나야', '자문으로 7일 뒤에 계약할 수 있습니다')는 제7조③을 옮긴 문장이라 막지 않는다. 전속 자문과 '7일 만에 계약'만 본다.
 'h.captive_advisor_phrase':{title:'본사 전속 자문으로 7일 계약 같은 문구(H4)',match:'(?:본사|가맹\\s?본부|본부)\\s?(?:전속|소속|지정|제휴)\\s?(?:가맹\\s?거래사|변호사)|7\\s?일\\s?(?:만에|안에|이면|내)\\s?(?:바로\\s?)?(?:가맹\\s?)?계약(?!\\s?(?:해지|취소|철회|해제|종료))'},
 // block_unless_evidence. '멤버십 가입비 무료', '포장 용기 보증금 없음', '교육비 무료 원데이 클래스', '바리스타 교육비 무료 이벤트', '로열티 프리 음원'은 소비자 문장이다.
 'h.zero_cost_claims':{title:'로열티 0원·가맹비 면제 같은 비용 0 표현(H13)',match:`(?:${LOYALTY}|가맹비|가맹\\s?가입비|(?:가맹|계약\\s?이행)\\s?보증금|가맹\\s?교육비)\\s?${ZERO}|(?<=${FR_CTX}[^.,\\n]{0,20})${CLS_EDU}\\s?${ZERO}|${CLS_EDU}\\s?${ZERO}(?=[^.\\n]{0,30}${FR_CTX})|(?<![가-힣A-Za-z])(?:무|노|No|NO|no|제로|zero|ZERO)\\s?(?:\\(\\s?無\\s?\\)\\s?)?(?:${LOYALTY}|가맹비)`,except:'클래스|수강|원데이|음원|음악|BGM|이미지|폰트|사진'},
 // 아래는 모집 범위(objective_export)에서만 적용한다. 소비자 캠페인 문장('오늘도 완판', '매일 직접 굽는 수제 도넛')은 막지 않는다.
 'h.direct_store_popularity':{title:'직영 매장 대기줄·완판·판매량 표현(H14)',match:'완판|품절\\s?(?:대란|행진|사태|임박)?|대기\\s?(?:줄|행렬|번호|시간)|줄\\s?서서|오픈\\s?런|웨이팅|하루\\s?\\d+\\s?(?:개|판|명)|누적\\s?판매\\s?\\d|판매량\\s?\\d|화제의|핫플'},
 'h.handmade_claims':{title:'수제 표현',match:'수제|손으로\\s?(?:직접\\s?)?(?:빚|만든|만들|반죽)|핸드\\s?메이드|handmade'},
 'h.exclusive_supply_claims':{title:'본사 독점 공급 표현',match:'본사\\s?(?:독점|단독)\\s?(?:공급|납품|유통)|독점\\s?공급'},
 'h.collab_rights_claims':{title:'협업·콜라보 표기',match:'콜라보|컬래버(?:레이션)?|협업\\s?(?:메뉴|에디션|제품|굿즈)|collab'},
 'h.own_ip_claims':{title:'자체 IP·캐릭터·상표 표현',match:'자체\\s?(?:IP|캐릭터|상표)|자사\\s?(?:캐릭터|IP)'},
 'h.heritage_claims':{title:'N년 전통·since 표현',match:'\\d+\\s?년\\s?(?:전통|역사|노하우)|(?:since|Since|SINCE)\\s?\\d{4}|(?:EST|Est)\\.?\\s?\\d{4}'},
 'h.direct_to_franchise_inference':{title:'직영점 성과를 가맹점 기대로 잇는 문장(H14)',match:'(?:직영점|본점|1\\s?호점)[^.\\n]{0,30}?(?:가맹점|점주|여러분)[^.\\n]{0,20}?(?:도|에서도)\\s?(?:같은|동일|똑같|기대|가능)'},
};
export const FRANCHISE_CLAIM_MATCHERS:Readonly<Record<string,ClaimMatcher>>=Object.freeze(Object.fromEntries(Object.entries(MATCHERS).map(([id,m])=>[id,Object.freeze({...m})])));
// 수치 자체를 막는 해제 불가 규칙(H6). 부정문('보장하지 않습니다')이어도 수치는 광고에 남으므로 부정 면제를 두지 않는다.
export const FRANCHISE_FIGURE_IDS=Object.freeze(['h.net_profit_payback_claims','h.revenue_figures_no_ad'] as const);
// 공식 규칙의 휴리스틱 확장(판정원은 공식 규칙 id 그대로, 근거 라벨은 '공식 규정 … 확장 적용 · COLLECTIVE 휴리스틱 · 법률 자문 아님').
// kr.fr.insurance_mark: 조문(제15조의2⑤⑥)은 보험·채무지급보증·공제 계약 표지다. '가맹금 안전·안심·보호·100%' 문구를 유사 표지로 보는 것은 휴리스틱이다.
// 보험 계약 사실(근거)이 있으면 '가맹금 보호' 같은 사실 표현은 통과하지만, strong('100%·보장·안전하게 지켜 드립니다')은 계약이 있어도 과장이라 막는다.
export type ClaimExtension={readonly match:string;readonly strong:string;readonly label:string};
export const FRANCHISE_OFFICIAL_EXTENSIONS:Readonly<Record<string,ClaimExtension>>=Object.freeze({
 'kr.fr.insurance_mark':Object.freeze({match:'가맹금[^.,\\n]{0,12}?(?:안전|안심|보호|지켜|100\\s?%)|(?:안전|안심)\\s?가맹금',strong:'100\\s?%|보장|지켜\\s?드|완벽',label:'공식 규정 제15조의2⑥ 확장 적용'}),
});
// 근거 조건(이게 만족되면 표현을 쓸 수 있다). hard_block id에는 없다. 보험 표지만 예외다: 제15조의2①의 계약(보험·채무지급보증·공제) 사실은 규칙의 성립 조건이지 해제가 아니다.
// values: 가맹 값 종류(lib/graders/ledger.ts VALUE_KINDS)의 본문 값이 현재 확정 사실 값과 같아야 함. fact_in_text: 현재 사실 값이 본문에 있어야 함(all이면 모두, marker는 본문 표지).
// fact_value: 현재 사실 값이 valuePattern에 맞고 notPattern에 맞지 않아야 함. fact_exists: 현재 사실이 있어야 함. 현재 사실 = 정보공개서 현재 등록 버전 근거가 있는 확정 사실(비공개 항목은 확정 사실).
export type ClaimEvidence=
 |{readonly kind:'values';readonly valueKinds:readonly string[]}
 |{readonly kind:'fact_in_text';readonly factKeys:readonly string[];readonly all?:true;readonly marker?:string}
 |{readonly kind:'fact_value';readonly factKey:string;readonly valuePattern:string;readonly notPattern?:string}
 |{readonly kind:'fact_exists';readonly factKeys:readonly string[]};
const EVIDENCE:Record<string,ClaimEvidence>={
 'kr.fr.insurance_mark':{kind:'fact_value',factKey:'escrow_insurance',valuePattern:'피해\\s?보상\\s?보험|채무\\s?지급\\s?보증|공제\\s?(?:조합|계약)'},
 'kr.fr.store_count_claims':{kind:'values',valueKinds:['매장 수']},
 'kr.fr.startup_cost_claims':{kind:'values',valueKinds:['창업비용','가맹비','교육비','가맹 보증금','인테리어 비용','로열티']},
 'kr.fr.ip_claims':{kind:'fact_exists',factKeys:['ip_registration']},
 'kr.fr.superlative_claims':{kind:'fact_in_text',factKeys:['claim_basis']},
 'kr.fr.trade_area_claims':{kind:'fact_in_text',factKeys:['trade_area_source']},
 'kr.fr.production_claims':{kind:'fact_value',factKey:'production_method',valuePattern:'자체|직접|직영',notPattern:'OEM|위탁|외주'},
 'kr.fr.exclusive_channel_claims':{kind:'fact_value',factKey:'sales_channels',valuePattern:'없음|가맹점\\s?(?:에서만|전용|만)'},
 'kr.fr.territory_claims':{kind:'fact_exists',factKeys:['territory_clause']},
 'h.zero_cost_claims':{kind:'fact_in_text',factKeys:['required_items_pricing','margin_fee'],all:true},
 'h.direct_store_popularity':{kind:'fact_in_text',factKeys:['direct_store_performance'],marker:'직영점\\s?실적'},
 'h.handmade_claims':{kind:'fact_value',factKey:'production_method',valuePattern:'수제|손으로|핸드'},
 'h.exclusive_supply_claims':{kind:'fact_in_text',factKeys:['required_items_pricing','margin_fee'],all:true},
 'h.collab_rights_claims':{kind:'fact_in_text',factKeys:['collab_consent']},
 'h.own_ip_claims':{kind:'fact_exists',factKeys:['own_ip_rights']},
 'h.heritage_claims':{kind:'fact_in_text',factKeys:['heritage_basis']},
};
const freezeEvidence=(e:ClaimEvidence):ClaimEvidence=>Object.freeze('factKeys' in e?{...e,factKeys:Object.freeze([...e.factKeys])}:'valueKinds' in e?{...e,valueKinds:Object.freeze([...e.valueKinds])}:{...e});
export const FRANCHISE_CLAIM_EVIDENCE:Readonly<Record<string,ClaimEvidence>>=Object.freeze(Object.fromEntries(Object.entries(EVIDENCE).map(([id,e])=>[id,freezeEvidence(e)])));
// 정규식이 아니라 판정기 로직으로만 구현하는 규칙: H8(가맹 수치 문장의 [사실] 표지·정보공개서 각주), H9(첫 줄 수치 주장의 경고를 차단으로).
export const FRANCHISE_CLAIM_LOGIC=Object.freeze(['h.fact_opinion_labels','h.headline_claim_block'] as const);
