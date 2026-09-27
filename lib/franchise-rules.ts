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
export const FRANCHISE_CLAIMS_VERSION='fr-claims@2026-09-27.2';
// 해제 불가 목록(결정 25, 대표 기본값으로 적용 2026-09-25). 원장·[확인 필요]·인용·관리자·대표 승인 어느 것으로도 풀리지 않는다. 완화는 법률 검토(LR-1) 뒤 코드 PR로만 한다.
export const FRANCHISE_HARD_BLOCK_IDS=Object.freeze(['h.captive_advisor_phrase','h.net_profit_payback_claims','h.revenue_figures_no_ad','h.wait_bypass_solicitation','kr.fr.association_condition','kr.fr.association_condition_2026','kr.fr.insurance_mark','kr.fr.revenue_guarantee'] as const);
// 휴리스틱 표현 정규식(문장 단위). also: 같은 문장에 함께 있어야 함. except: 면제(해제 불가 규칙은 매치가 든 절에서만 본다). cleared: 본문에 있으면 해소. title: 화면에 보일 짧은 이름.
// 판정기는 문장 보기(글자 사이 구분 기호·이모지·한 글자씩 띄운 낱말을 붙이고 한글·혼합 수를 숫자로 바꾼 문장)에서 정규식을 돌리고, 해제 불가 규칙은 줄바꿈·물음표로 끊은 표현도 본다.
// 부정은 매치된 서술 자신을 부정할 때만 인정한다('보장하지 않습니다', '가계약금, 상권 선점금을 받지 않습니다', '수익 보장 광고는 법으로 금지돼 있습니다').
// 뒤 절의 '제외·무관·불가·금지·대신', '걱정하지 마세요', 다른 브랜드와의 대비('보장하지 않는 브랜드와는 다릅니다')는 부정이 아니다(판정기).
// consumerAlso: 소비자 범위에서만 같은 문장에 있어야 하는 가맹 문맥(모집 범위는 캠페인 자체가 가맹 문맥이다).
// recruitmentMatch: 모집 범위에서만 match에 더하는 표현(소비자 문장과 겹치는 모양: 명사 없는 '월 5천 매장', 묻고 답하는 수치).
// more: match와 같은 규칙·같은 조건(also·consumerAlso·except·부정)으로 보되 정규식을 따로 컴파일하는 표현. 한 정규식 원문이 20KB(20,480자)를 넘으면 V8이 정규식 최적화를 꺼
// 판정이 열 배 가까이 느려지므로 큰 표현 묶음은 나눈다(tests/franchise-compliance.test.mjs 15h가 모든 정규식 원문 크기를 본다).
export type ClaimMatcher={readonly title:string;readonly match:string;readonly recruitmentMatch?:string;readonly more?:readonly string[];readonly cleared?:string;readonly also?:string;readonly consumerAlso?:string;readonly except?:string};
// 소비자 문장과 겹치는 비용 낱말('베이킹 클래스 교육비', '바리스타 기초반 교육비', '로열티 카드', '로열티 스탬프·쿠폰', '로열티 고객 혜택')은 가맹 비용이 아니다(규제 사전 FR_EDU_LABEL·FR_ROYALTY_LABEL과 같은 모양).
const CLS_EDU='(?<!(?:클래스|수강|체험|원데이|아카데미|홈카페|바리스타|베이킹|만들기|강좌|기초반|심화반|수업|강습|워크숍|자격증)\\s?)교육비',LOYALTY='로열티(?!\\s?(?:카드|멤버십|회원|포인트|프로그램|적립|클럽|고객|혜택|등급|VIP|스탬프|쿠폰))';
// 가맹 문맥 낱말(규제 사전 FR_CONTEXT와 같은 모양, 이 파일은 import하지 않는다). '본사 아카데미'·'창업 30주년'은 가맹 문맥이 아니다.
const FR_CTX='(?:가맹|창업(?!\\s?(?:\\d+\\s?(?:주년|년)|이래|이후|기념|자|주년))|개설|점주|계약(?!직))';
// 금액·비율 수치(숫자 뒤 만·천·억·원·%·배, '억대'·'수천만원'). 판정기는 한글·혼합 수('오백만원', '4천2백만원', '18프로')를 먼저 숫자로 바꾼다. 영어 금액('6M KRW', 'KRW 50,000,000')도 본다.
const VAGUE_MONEY='억\\s?대|수\\s?(?:십|백|천)\\s?만\\s?원?|수\\s?억';
// 단위 없이 쉼표로 묶은 백만 이상 수('월 매출 42,000,000', '월 순수익 5,000,000')도 금액이다. 개수 단위가 붙으면 아니다.
const BARE_BIG='\\d{1,3}(?:,\\d{3}){2,}(?![\\d,]|\\s?(?:개|명|잔|회|건|뷰|분|시간|병|판))';
const MONEY=`(?:\\d[\\d,.]*\\s?(?:만|천|억|원|%|퍼센트|배)|${BARE_BIG}|${VAGUE_MONEY})`,BIG_MONEY=`(?:\\d[\\d,.]*\\s?(?:만|천|억)|${BARE_BIG}|${VAGUE_MONEY})`;
// 말로 쓰는 단위 없는 수('월 700 가져가십니다', '일매출 300 찍는', '월 매출 8,500'): 두 자리 이상 또는 쉼표로 묶은 수, 뒤에 수·단위·비율·로마자가 붙지 않은 수. 연도(2025)와 전화번호('1588-0000', '010 0000 0101'), 쪽·조항 번호('정보공개서 12쪽')는 아니다.
const BARE_N='(?<![\\d,.]|\\d\\s?-\\s?)(?!0\\d)(?!(?:19|20)\\d{2}(?![\\d,]))(?:\\d{1,3}(?:,\\d{3})+|\\d{2,})(?![\\d%A-Za-z]|[,.]\\d|\\s?-\\s?\\d|\\s\\d|\\s?(?:개|명|잔|회|건|뷰|분|시간|일|주|년|개월|위|등|호점|km|m|미터|평|㎡|퍼센트|배|쪽|페이지|조|항))';
// 만 없이 쓴 백·천('월 순수익 5백 이상', '월 천 가져가세요')은 뒤에 끝맺음·비교·서술이 올 때만 금액으로 본다.
const KO_BARE='(?:\\d+|[일이삼사오육칠팔구])?\\s?(?:백|천)(?=\\s?(?:이상|넘게|정도|씩|이|은|는|을|를|$|[,.!~]|가져|벌|버|번|법|찍|보장|확정))';
// 명사가 바로 뒤에 오는 백·천('월 5백 순익', 판정기는 '오백'을 '5백'으로 읽는다).
const KO_NUM='(?:\\d+|[일이삼사오육칠팔구])?\\s?(?:백|천)(?![가-힣]{2})';
// 개수·기간·순위 단위가 붙은 수는 금액이 아니다('월 3천 개 판매', '하루 300명').
const NOT_COUNTED='(?!\\s?(?:개|명|잔|판|회|뷰|건|병|봉|장(?!사)|마리|그릇|세트|박스|분|시간|일|주|년|개월|위|등|호점|평|㎡|번|곳|%|퍼센트|배|인분))';
const MONEY_EN='(?:\\d[\\d,.]*\\s?(?:[MKB](?![A-Za-z])|mil(?:lion)?(?![a-z]))\\s?(?:KRW|won|원)?|\\d[\\d,.]*\\s?(?:KRW|won)(?![a-z])|(?:KRW|₩)\\s?\\d[\\d,.]*)';
// 수치 뒤 기부·할인·사용처 문맥('매출의 10%를 기부합니다', '순수익 100%는 보호소 사료 구입에 사용됩니다', '장학금으로 지급', '감사 이벤트 20% 할인')은 수익 수치가 아니다. 같은 절(쉼표 전)만 본다.
const NOT_REVENUE='(?![^.,\\n]{0,30}(?:기부|후원|환원|전달|나눔|장학|급식|기금|기탁|보호소|쓰입|쓰여|쓰이|사용됩|사용합|사용해|사용돼))(?!\\s?(?:할인|OFF|off|세일|적립|페이백|쿠폰))';
// 매출·수익의 비율('가맹점 매출액의 3%'인 로열티, '연간 순이익의 3%'인 기부)은 수익 수치가 아니다.
const SHARE='(?!\\s?의\\s?(?:약\\s?)?\\d[\\d,.]*\\s?(?:%|퍼센트))';
// 순위('매출 1위', '매출 TOP')와 할인·특가 문구는 수익 수치 사이에 오지 않는다. 앞자리 숫자에 붙은 '월·연·일'('9월 매출', '12월 수입')은 기간이 아니라 날짜다.
// 말줄임('매출은요… 5,800', NFKC 뒤 '...')은 사이에 올 수 있다.
// 비용 라벨('로열티는 매출과 관계없이 월 20만원')이 앞에 있으면 뒤 금액은 그 비용이다(모집 범위 매출 표현, R2 5차 재검토).
const COST_BEFORE='(?:로열티|가맹비|교육비|보증금|인테리어|임대료|월세|관리비|광고비|분담금|수수료)';
const NO_RANK='(?:\\.{2,}|(?!\\d+\\s?위|TOP|top|베스트|할인|세일|특가|쿠폰|적립)[^.,\\n])';
// 소득으로서 '수입'(뒤에 조사·수·기호). '수입 원두·버터'는 수입품이다.
const INCOME='수입(?=\\s?(?:[은는이가을를도만]|약|평균|최소|최대|\\d|[,:·~]|$))';
// 이익률·마진율·영업이익 뒤에는 조사·기간·'약·평균' 같은 말만 온다('영업이익 월 800만원', '마진율 40%'). '공급 마진(공급가 원가+10%)'은 가맹본부 공급 마진 고지다.
const RATE_GAP='(?:\\s?(?:이|은|는|도|가|[:：]))?\\s?(?:(?:약|평균|월\\s?평균|연\\s?평균|월|연|최대|최소|무려|연간|월간)\\s?)?';
const PERIOD='(?:(?<![\\d가-힣])(?:월|연|일)|매월|매달|매년|매일|연간|월간|하루|한\\s?달|1\\s?년|일\\s?년|평균|월\\s?평균|연\\s?평균|평일|주말)';
// 금액 앞의 기간('월 600만원 순수익', '한 달에 700만원 버는'). 날짜('9월')는 기간이 아니다.
const PERIOD_AT=`${PERIOD}(?:\\s?에)?(?:\\s?평균)?`;
const REV_SUBJ='(?:직영\\s?(?:\\d+\\s?호)?점|직영|가맹점|점포|매장|점당|점포당|매장당|본점|\\d+\\s?호점)';
// 순수입·실수령·세후 수익, '평균 수익', '점주님들 수익'도 순수익 표현이다. 직원 급여 문장('매니저 채용, 실수령 월 280만원')의 실수령은 아니다.
const NET_NOUN='(?:순수익(?!금)|순이익|순익|순수입|실\\s?수입|실\\s?수익(?!금|률)|(?<!(?:직원|알바|아르바이트|매니저|크루|스태프|급여|월급|채용|연봉)[^.\\n]{0,12})실\\s?수령(?:액)?|세후\\s?(?:수익|소득))';
const PROFIT=`(?:${NET_NOUN}|(?<![\\d가-힣])(?:월|연|일)\\s?(?:수익(?!금|률)|${INCOME}|소득)|(?:매달|매월|한\\s?달|하루|월\\s?평균|연간|1\\s?년|일\\s?년|평균|점포당|매장당|점당)\\s?(?:수익(?!금|률)|소득)|(?:점주|가맹\\s?점주|가맹점|사장)\\s?(?:님\\s?)?(?:들\\s?)?(?:의\\s?)?(?:순?수익(?!금|률)|소득|${INCOME})|순\\s?마진|[Nn]et\\s+(?:profits?|income|margin|earnings)|(?<![A-Za-z])(?:[Nn]et|NET)(?![A-Za-z])(?=\\s?(?:[:：]\\s?)?(?:${PERIOD}|\\d))|(?:연봉|월급)(?=[^.\\n]{0,20}(?:점주|사장|오너|창업|가맹))|(?<=(?:점주|사장|오너|창업|가맹)[^.\\n]{0,20})(?:연봉|월급))`;
// 점주 소득으로 쓴 연봉·월급('연봉 1억 점주님'), 'Net 월 600'도 순수익 표현이다(R2 4차 재검토).
// 금액이 앞에 오는 순수익('월 600만원 순수익', '600만원 순수익 달성'). '수익'·'소득'만 쓰면 기간이 앞에 있어야 한다.
const PROFIT_AFTER=`(?:${PERIOD_AT}\\s?(?:${MONEY}|${MONEY_EN}|${BARE_N}|${KO_NUM})(?:\\s?원)?\\s?(?:이상\\s?|넘는\\s?|의\\s?)?(?:${NET_NOUN}|수익(?!금|률)|소득)|(?<![\\d,.])${MONEY}(?:\\s?원)?\\s?(?:이상\\s?|넘는\\s?|의\\s?)?${NET_NOUN})${NOT_REVENUE}`;
// 버는 돈('한 달에 700만원 버는 점주님들', '점주님들 월 700 가져가십니다', '매달 500 남깁니다', '월 450 남아요').
const EARN=`${PERIOD_AT}\\s?(?:${MONEY}|${MONEY_EN}|${BARE_N}|${KO_BARE})(?:\\s?원)?\\s?(?:이상\\s?|넘게\\s?|씩\\s?|정도\\s?|까지\\s?|은\\s?|는\\s?)?(?:을\\s?|를\\s?)?(?:벌(?:어|고|었|면|기|\\s?수)|버는|번다|법니다|버셨|버세요|버시|가져\\s?가|챙겨\\s?가|챙기(?:는|고|세|시|셨|죠|십)|챙깁|찍히(?:는|고|죠|네|더|십)|꽂히(?:는|고|죠|네)|손에\\s?쥐|남기(?:시|는|고|세)|남깁|남(?:는|아요|습니다|더라|죠))${NOT_REVENUE}`;
// 투자금 회수: 투자·창업 비용과 기간 수치가 함께 있어야 한다('18개월이면 투자금 회수', '창업비 8개월이면 뽑습니다', '손익분기점 3개월'). '투자금 회수를 약속하는 광고는 하지 않습니다'처럼 기간 수치가 없으면 수치 표현이 아니다.
const PAYBACK_BASE='(?:투자금|투자\\s?(?:비용|비|원금|액)|창업\\s?(?:비용|비|자금)|개설\\s?비용|초기\\s?(?:투자\\s?)?(?:비용|자금|금|비)|초기\\s?투자|(?<![가-힣])원금|본전|(?:들어간|투자한|넣은|쓴|들인)\\s?돈)';
// 기간 수: '18개월', '1년 반', '한 달 반', '석 달', '넉 달', '일 년'.
const PERIOD_N='(?:\\d+(?:\\.\\d+)?\\s?(?:개월|달|년|주)(?:\\s?반)?|(?:한|두|세|석|네|넉|다섯|여섯|일곱|여덟|아홉|열|열한|열두)\\s?(?:달|해)(?:\\s?반)?|(?:일|이|삼)\\s?년(?:\\s?반)?|반\\s?년)',RECOVER='(?:회수|뽑|건지|건져|되찾|돌려\\s?받|만회|복구|빠지|빠져|빠집|돌아\\s?(?:오|옵|와)|(?<=돈[^.\\n]{0,15})찾(?:습|아|으|는|을|았))';
const PAYBACK_AT='(?:만에|안에|이내|이면|내|만|정도면|내에|에|컷!?|후면|뒤면|지나면|차에는|차에|차면)';
// 비용 0: '로열티 X', '가맹비 0', '가맹비 없어요', '로열티 안 받습니다', 라벨과 사이에 '도'·'전액·평생·1년간'이 와도 본다('교육비·가맹비 전액 무료', '로열티 1년간 면제', '로열티도 없이').
// '매출 연동 로열티는 없습니다'·'별도 정액 로열티는 없습니다'(다른 로열티가 있다는 고지)는 아니다.
const ZERO='(?:안\\s?받(?:습|아|는|음|고)|받지\\s?않(?:습|아|는|음|고)|0\\s?원|0\\s?(?:%|퍼센트)|₩\\s?0(?![\\d,.])|0(?![\\d,.%])|없음|없는|없이|없어요|없습니다|없고|면제|무료|제로|zero|ZERO|프리|free|FREE|X(?![A-Za-z0-9])(?!\\s?원))';
const ZERO_GAP='(?:(?:전액|평생|영구|첫\\s?해|최초|\\d+\\s?(?:년|개월|달)\\s?(?:간|동안)?|일\\s?년\\s?(?:간|동안)?|오픈\\s?(?:후|까지))\\s?)?';
// 대기기간 우회: 가맹 계약만 본다. 입점·임대·단체·근로·재배·제휴 계약, '계약 재배 농가', '계약 해지·만료', '계약서안'은 가맹 계약이 아니다.
const FR_CONTRACT='(?<!(?:입점|임대|임차|단체|근로|고용|재배|공급|납품|구매|렌탈|리스|제휴|통신|케이터링|배송|구독|광고|협찬|용역|도급|매매|분양|보험|카드|전속|출연|주문|정기|위탁)\\s?)계약(?!\\s?(?:직|재배|농가|농장|업체|기간|만료|해지|취소|철회|해제|종료|갱신|서\\s?안|서\\s?초안|사항|조건|내용))';
// '그 자리에서·현장에서 계약'(상담 직후 계약)도 즉시 계약이다. 계약금·가맹비·가맹금을 오늘 입금·거는 표현도 본다(R2 4차 재검토).
const TIMING_SPOT='(?:그\\s?자리에서|같은\\s?자리에서|현장에서|즉석(?:에서)?|상담\\s?당일|상담\\s?(?:받고|후)\\s?바로)',FEE_WORD='(?:계약금|가맹비|가맹금)';
const TIMING_FAST='(?:바로|즉시|당일|곧바로|당장|오늘)',TIMING_WAIT='(?:대기\\s?(?:기간\\s?)?(?:없이|생략|패스|0\\s?일)|숙려\\s?기간\\s?(?:을\\s?)?패스|기다림\\s?없이|기다리지\\s?않고|기다릴\\s?필요\\s?(?:없이|가\\s?없|없)|안\\s?기다려도|숙려\\s?기간\\s?(?:을\\s?)?(?:없이|생략(?:하고)?|건너뛰(?:고)?))';
// '당일 계약 시 가맹비 할인', '오늘 계약!'처럼 조건·끝맺음으로 쓴 계약도 본다.
const CONTRACT_ACT='(?:\\s?(?:을|를)?\\s?(?:체결|진행|가능|완료|OK|ok|서명|사인)|하|해|할|합|됩|돼|되|\\s?시(?![가-힣])|(?=\\s?(?:[!~]|$)))';
const DEPOSIT='(?:계약금|예약금|보증금|예치금|선입금|선납금|신청금|신청비|착수금|[Dd]eposit)';
const SECURE=`(?:(?:상권|입지|가맹\\s?(?:희망\\s?)?지역|영업\\s?지역|희망\\s?지역|점포\\s?자리|매장\\s?자리)\\s?(?:을|를)?\\s?(?:확보|선점|잡아|홀딩|예약|찜|보장|지켜|우선)|(?:개설|출점|입점|계약|가맹|지역|상권|입지)\\s?우선\\s?(?:권|순위|협상|배정)|우선\\s?협상권?|(?:희망\\s?)?지역\\s?배정`
 // 맨 낱말 지역·자리·상권을 먼저 잡거나 홀드·배정하는 표현, 우선 오픈·오픈 일정 당겨 드림(R2 4차 재검토).
 +`|(?<![가-힣])(?:지역|자리|상권|입지)\\s?(?:을|를)?\\s?(?:먼저\\s?|미리\\s?)?(?:찜|잡아|잡습|홀드|홀딩|확보|배정|확정|선점)|우선\\s?(?:오픈|개점|출점|선택)|오픈\\s?(?:일정|날짜|순서|시기)?\\s?(?:을|를)?\\s?(?:당겨|앞당)|(?:희망\\s?)?지역\\s?(?:을\\s?|를\\s?)?우선)`;
const DEPOSIT_CTX='(?:가맹|창업|개설|출점|상권|입지|자리\\s?확보|우선|오픈\\s?(?:일정|날짜|순서)?\\s?(?:을|를)?\\s?(?:당겨|앞당))';
// 가맹비·가맹금 선결제·선납(계약 전 가맹금 수령)과 계약금을 걸어 두게 하는 표현.
const FEE_PREPAY='(?:가맹비|가맹금)\\s?(?:을|를)?\\s?(?:선결제|선납|선입금|(?:미리|먼저)\\s?(?:입금|결제|납부))';
const HOLD_PAY='(?:가?계약금|예약금|보증금|예치금)\\s?(?:을|를)?\\s?(?:\\d[\\d,.]*\\s?(?:만\\s?원?|천|원)?\\s?)?(?:먼저\\s?|미리\\s?)?(?:걸어\\s?(?:두|놓|주)|거세요|거시|걸면|걸어야|걸고|넣어\\s?(?:두|놓))';
const HOLD_CTX='(?:자리|지역|상권|입지|우선|오픈\\s?(?:일정|날짜|순서)?\\s?(?:을|를)?\\s?(?:당겨|앞당))';
// 본사 자문(H4): 본사 쪽 자문자 이름, 7일·일주일, 자문료.
const HQ='(?:본사|가맹\\s?본부|본부|당사|저희|우리\\s?본사)',ADVISOR='(?:가맹\\s?거래사|거래사|변호사|법무\\s?법인|로펌|자문\\s?(?:위원|단|사))';
// 본사 안의 법무 조직·사내 변호사·고문 변호사(본사 쪽 자문, 블라인드 레드팀 2차).
const HQ_LEGAL='(?:법무\\s?(?:팀|실|부|담당|파트|라인)|사내\\s?(?:변호사|법무(?:\\s?(?:팀|실))?|자문)|(?:고문|자문|내부)\\s?(?:변호사|법무\\s?법인|로펌|가맹\\s?거래사)|법률\\s?(?:팀|고문|자문\\s?(?:팀|단)?))';
const WEEK='(?:7\\s?일|칠\\s?일|일주일|1\\s?주일?|한\\s?주)',ADVICE_FEE='(?:자문료|자문\\s?(?:비용|비|수수료))';
// ── 대기기간 오기재(대표 결정 3번 보완, 2026-09-26) ──
// 정보공개서(제7조③)·가맹계약서안(제11조①)을 받은 날부터 14일(변호사·가맹거래사 자문을 받았다면 7일)이 지나기 전에는 계약·가맹금 수령을 못 한다. 그보다 이른 때 계약·가맹금을 허용하는 문장,
// 대기기간을 선택·생략·협의·조정할 수 있다고 적은 문장은 h.wait_bypass_solicitation(해제 불가)에 더한다. 새 해제 불가 id는 없다(결정 25의 8개).
// 짧은 기간: 1~6일·1~4영업일·48시간·며칠·이삼일·세 밤·'3 days'(자문을 받아도 7일보다 짧다)은 언제나('열나흘'·'열하루'의 '나흘'·'하루'는 아니다), 7~13일·일주일·열흘·'1 week'는 같은 문장에 자문 조건(자문·변호사·가맹거래사)이 없을 때만 본다
// ('자문 없이도'·'자문 없어도'·'자문 여부와 관계없이'는 조건이 아니다. 5~9영업일도 7일 이상 쪽이다). 14일·보름·2주 이상과 '14일(자문 시 7일)'은 보지 않는다. 날짜 계산('3/2 발송, 3/5 계약', '교부일 10월 1일 / 계약일 10월 3일')은 하지 않는다(알려진 틈, 승인자 확인).
// 레드팀 반영(2026-09-26): 'D+3'·'+3일'·'4일차'·'Day 3', 화살표로 이은 '수령 → 3일 → 계약', 요일('월요일에 받고 금요일에 계약')·같은 주·내일·모레·글피, 영어('FDD', 'contract', '3 days', '1 week'),
// 도장 찍기, '계약서 쓰시면', 짧은 두 문장('정보공개서 먼저 드려요. 3일 뒤 계약합니다.'), 표('숙려기간 : 없음', '대기기간 | 7일', '계약 가능일: 정보공개서 수령 다음 날'), 대기기간 중 가맹금·'대기기간과 무관',
// 날짜 소급·역산·뒤 날짜로 적기, 폐지·적용 제외 주장('소규모 본부라 적용 대상이 아닙니다'는 제3조 적용 배제와 겹칠 수 있어 LR-1 확인 대상이다. 확인 전까지 강화 쪽으로 막는다), 형식적 자문('체크만 하시면 7일').
const WAIT_DOC='(?:정보\\s?공개서|(?<![가-힣])공개서|(?<![가-힣])정개서|(?<![가-힣])정공서|(?:가맹\\s?)?계약서\\s?(?:안|초안|샘플|견본|양식)|FDD|[Dd]isclosure\\s?(?:[Dd]ocument|[Dd]oc))';
const ADVICE_ON='(?:자문|변호사|가맹\\s?거래사|(?<![가-힣])거래사)(?!\\s?(?:을|를|은|는|도|이|가)?\\s?(?:없이|없어도|없더라도|없으셔도|안\\s?받|받지\\s?않|생략|불필요|필요\\s?(?:없|가\\s?없|는\\s?없)|안\\s?해도|하지\\s?않아도|(?:여부\\s?(?:와|과|에)?\\s?)?(?:관계\\s?없이|상관\\s?없이|무관하게)))';
// 자문 조건 검사는 기간·단축 낱말이 맞은 뒤에만 한다(앞뒤 80자 안, 판정 시간을 늘리지 않으려고 낱말 뒤에 둔다).
const NO_ADVICE_AROUND=`(?<!${ADVICE_ON}[^\\n]{0,85})(?![^\\n]{0,80}${ADVICE_ON})`;
// 범위('3-4일', '5~7일')는 앞 수까지 한 기간으로 읽는다.
const RANGE='(?:\\d{1,2}\\s?[-~〜∼]\\s?)?';
const SHORT_DAYS=`(?:(?<![\\d.,])${RANGE}[1-6]\\s?일|(?<![\\d.,])${RANGE}[1-4]\\s?영업\\s?일|(?<!열\\s?)(?:하루|이틀|사흘|나흘)|닷새|엿새|(?<![가-힣])(?:이|삼|사|오|육)일|(?<![가-힣])(?:삼|사|오|육)\\s일|(?<=후|뒤)(?:삼|사|오|육)\\s?일|(?<![가-힣])(?:일이|이삼|삼사|사오|오륙)\\s?일|며칠|몇\\s?일|(?<![\\d.,])[1-9]?\\d\\s?시간|(?<![가-힣])(?:이십사|사십팔|칠십이|스물\\s?네|열\\s?두|몇|한|두|세|네)\\s?시간|반나절|(?<![가-힣])(?:한|두|세|네|다섯|여섯)\\s?밤(?!중)|(?<![\\d.,])${RANGE}[1-6]\\s?days?(?![a-z])|(?<![A-Za-z])(?:[Oo]ne|[Tt]wo|[Tt]hree|[Ff]our|[Ff]ive|[Ss]ix|[Aa]|[Ff]ew|[Cc]ouple\\s?of)\\s+days?(?![a-z]))`;
// 자문 조건 검사 없는 7~13일(자문 여부와 관계없다는 문장이 직접 쓴다).
const WEEKISH_RAW=`(?:(?<![\\d.,])${RANGE}(?:(?:[7-9]|1[0-3])\\s?일|[5-9]\\s?영업\\s?일)|이레|여드레|아흐레|열흘|열하루|열이틀|열사흘|(?<![가-힣])(?:칠|팔|구|십|십이|십삼)일|일\\s?주일|(?<![\\d.,])1\\s?주(?:일)?|한\\s?주(?:일)?|(?<![\\d.,])${RANGE}(?:[7-9]|1[0-3])\\s?days(?![a-z])|(?<![A-Za-z])(?:1|[Oo]ne|[Aa])\\s?weeks?(?![a-z])|(?<![A-Za-z])(?:[Ss]even|[Ee]ight|[Nn]ine|[Tt]en)\\s+days(?![a-z]))`;
const WEEKISH_DAYS=`${WEEKISH_RAW}${NO_ADVICE_AROUND}`;
const SHORT_WAIT=`(?:${SHORT_DAYS}|${WEEKISH_DAYS})`;
// 기간 뒤 '지나면·뒤·만에·안에·이면·째·자면' 같은 말(짧은 괄호 주석 '3일(영업일)'도 건넌다), 화살표 앞('3일 → 계약'). 날짜로 쓴 '3일에'는 아니다.
const WAIT_AFTER='(?:\\s?\\([^()\\n]{1,30}\\))?\\s?(?:간|동안)?\\s?(?:이|가|을|를|만|쯤|정도)?\\s?(?:(?:다\\s?)?(?:지나면|지나고|지나서|지나야|지난\\s?(?:뒤|후|다음|때|날)|경과\\s?(?:하면|후|뒤|시|하고|한\\s?(?:뒤|후))|되면|되는\\s?날)|째(?:\\s?(?:되는\\s?날|날|에|되면))?|(?:뒤|후|이후|다음)(?:에|에는|부터|면|엔)?|만에|안에|이내(?:에)?|내(?:에)?|이면|면|정도면|쯤이면|자면|자고|(?:검토|숙려|대기|열람)\\s?(?:후|뒤|하고|하시고|하시면|하면|(?=\\s?(?:→|->|=>|⇒)))|(?=\\s?(?:→|->|=>|⇒)))';
// 곧바로 계약·가맹금으로 잇는 때('다음 날', '같은 날', '그날', '당일', '익일', '동시에', '바로·즉시', '받은 날', '받자마자', '받으시면서', '수령 시', '내일·모레·글피', '이번 주 안에·이번 주말').
const WAIT_NOW='(?:다음\\s?날|익일|이튿날|같은\\s?날|당일|그\\s?날|(?:그|같은)\\s?자리(?:에서)?|현장(?:에서)?|즉석(?:에서)?|동시에|바로|즉시|곧바로|곧장|당장|대기\\s?없이|기다리지\\s?않고|기다림\\s?없이|내일|모레|글피|(?:이번|그|같은|금)\\s?주\\s?(?:안|내|중)|이번\\s?주말|(?:받|드리|받으시|수령하시)자마자|(?:받은|받으신|받는|받으시는|드린|드리는|주신|제공한|제공된|제공하는|제공받은|제공받으신|수령한|수령하신|전달한|전달된|전달받은|전달받으신|교부한|설명한|설명하는|설명드린|설명\\s?드린|보신|열람한|열람하신)\\s?(?:날|당일|즉시|그날|자리에서))';
// 받는 때('받으시면서', '받으실 때', '수령 시'): 가맹금·계약만 본다('수령 시 서명해 주세요'는 수령 확인 서명이다).
const WAIT_AT_RECEIPT='(?:(?:받으시|받으|드리|수령하시)면서|(?:받으실|받으시는|받을|드릴|드리는|수령하실|수령)\\s?(?:때|시)(?![가-힣]))';
// 문서와 때 사이(짧은 두 문장을 이은 문장의 마침표를 건넌다). '14일·보름·두 주가 지나면·끝나면' 뒤의 '바로'는 기간이 지난 뒤다.
const WAIT_DOC_GAP=(n:number)=>`(?:(?!지나|지난|끝나|끝난|경과|보름|두\\s?주|이\\s?주|열나흘|십사)[^\\n\\d]){0,${n}}?`;
// 때와 계약·가맹금 사이('본사와', '바로'), 계약·본계약·가맹금·서명·도장. 계약 상담·설명·절차·일정·여부·조건·예정일, 계약서안·계약서 전달, 가맹금 금액·반환·예치·안내, 수령 확인서·영수증 서명은 계약·가맹금 수령이 아니다.
const WAIT_GAP='(?:(?:본사|본부|저희|당사)\\s?(?:와|과)\\s?|(?:바로|즉시|곧바로|곧장|당장|얼른|빠르게|언제든)\\s?){0,2}';
// 짧은 기간 뒤 '따로 자문 없이도 계약'(자문 조건이 아니다, 블라인드 레드팀 2차).
const NO_ADVICE_GAP='(?:(?:따로\\s?|굳이\\s?)?(?:자문|변호사|가맹\\s?거래사)\\s?(?:없이도?|없어도|안\\s?받(?:아도|고도?))\\s?)?';
// 묻는 문장('계약할 수 있나요?', '줄일 수 있나요?', '하면 어떻게 되나요?', '가능한가요?')은 주장이 아니다. 권하는 물음('계약하실래요?', '진행할까요?', '어떠세요?')은 아니다.
const ASK_END='(?:(?:있|없|되|하)나요|(?:인|한|는|은)가요|(?:있을|없을|될|가능할)까요|(?:있|없|됩|합|가능합)니까|가능한가요|가능하나요)\\s?(?:\\?|$)';
// 뒤 14자 안의 부정·금지('계약하실 수 없습니다', '안 됩니다', '불가', '위반입니다', '선택이 아닌', '줄여 드리는 일은 없습니다')와 묻는 끝은 허용하는 문장이 아니다. 계약·가맹금 바로 뒤 8자 안의 '필요 없습니다'도 같다.
// 조건('계약 안 하시면 좋은 자리를 놓치실 수 있으니')은 부정이 아니다(블라인드 레드팀 2차). '안 하셔도 됩니다'·'하지 마세요'는 그대로 부정이다.
const WAIT_NOT_NEG=`(?![^.,\\n]{0,14}?(?:수\\s?(?:는\\s?|도\\s?)?없|(?:일|경우|적)\\s?(?:은|는|이|가|도)?\\s?없|지\\s?(?:[는도]\\s?)?(?:않|못|마(?=세요|십시오|시고|라|요|$|\\s|[.!,]))|(?<![가-힣])안\\s?(?:됩|돼|되|받|합|해|하(?!시면|면)|드립)|불가|금지|어렵|아닙|아니|아닌|위반|불법|위법|${ASK_END}))`;
const WAIT_ABOUT='(?!\\s?(?:을|를|은|는|에\\s?(?:대해|관해|대한|관한))?\\s?(?:상담|설명|안내|절차|검토|서류|준비|문의|관련|교육|일정|여부|담당|비교|고민|내용|조건|금액|액수|구성|항목|내역|명세|기준|산정|반환|환불|예치|보호|규정|알려|정보|(?:체결\\s?)?(?:예정일|날짜|일자)))';
// 가맹금 낱말(제2조6호: 가입비·교육비·보증금 포함). 점포 임대·임차 보증금은 아니다.
const WAIT_FEE='(?:가맹금|가맹비|계약금|가입비|교육비|(?<!(?:임대|임차|점포|상가|월세|전세)\\s?)보증금)';
const WAIT_PAY='(?:선입금|선납|선결제|입금|납부|결제|송금|받|내(?!일|용|부|역))';
const WAIT_ACT=`(?:(?:가맹\\s?|본\\s?)?${FR_CONTRACT}${WAIT_ABOUT}(?!\\s?(?:전(?![가-힣])|서(?!\\s?(?:(?:를|을)\\s?)?(?:에|작성|서명|사인|날인|쓰|써|도장))))|${WAIT_FEE}${WAIT_ABOUT}|(?<!(?:확인서|수령증|영수증|동의서|신청서|수령\\s?확인)[^.\\n]{0,12})(?:체결|서명|사인|날인|도장\\s?(?:을\\s?)?(?:찍|쾅|꽝))|(?<![A-Za-z])[Cc]ontract(?![a-z]))${WAIT_NOT_NEG}(?![^.,\\n]{0,8}?필요\\s?(?:는\\s?|가\\s?)?없)(?![^.\\n]{0,25}?(?:확인서|수령증|영수증))`;
const WAIT_POS='(?:가능(?!\\s?(?:하지|한지|할까|여부|성))|할\\s?수\\s?있|하실\\s?수\\s?있|받을\\s?수\\s?있|드릴\\s?수\\s?있|합니다|해요|해\\s?드립|해\\s?드려|하세요|하셔도|받습|받아요|받아도|드립니다|진행|하시면\\s?됩|하면\\s?됩|됩니다|돼요|OK|ok)';
// 계약하면 주는 혜택('대기기간 끝나기 전 계약하시면 가맹비 할인').
const WAIT_PERK='(?:하시면|하면|시(?![가-힣]))[^.\\n]{0,15}?(?:할인|혜택|특전|우대|면제|무료|사은품|증정)';
// 대기기간과 무관한 대기·기간(예약·배송·교육·설치·승인 대기, 청약철회 숙려 기간, 보고서 열람 기간). 바로 앞 낱말, 교육·설치·승인·청약 같은 낱말은 앞 8자 안도 본다.
// 앞 낱말 검사(뒤보기)는 대기기간·문서 낱말의 첫 글자에서만 한다(첫 글자 앞보기, 긴 입력에서 모든 자리마다 뒤보기를 돌리지 않는다. '가맹계약서안'은 '계'부터 맞는다).
const WAIT_SUBJ_GUARD='(?=[12두이십법대숙열정공계FDd])(?<!(?:상담|배송|예약|주문|픽업|입고|배달|제작|교육|공사|인테리어|오픈|출고|입점|개점|웨이팅|줄)\\s?)(?<!(?:교육|설치|장비|승인|심사|청약|철회|환불|반품|교환|보고서|분석|자료|발급|대출|체험|이벤트|구독)[^.,\\n]{0,8})';
// 대기기간을 이르는 말: '14일 대기기간', '대기기간(14일)', '숙려 기간', '열람 기간', '14일 규정'. 날짜('10월 14일')는 아니다.
const WAIT_SUBJ=`${WAIT_SUBJ_GUARD}(?:(?<![\\d월]\\s?)(?:14\\s?일|2\\s?주|두\\s?주|이\\s?주|십사\\s?일)\\s?(?:의\\s?)?(?:(?:법정\\s?)?(?:대기|숙려)\\s?(?:기간)?|기간|규정|룰|원칙)|(?:법정\\s?)?(?:대기|숙려)\\s?(?:기간|일수)(?:\\s?(?:14\\s?일|2\\s?주))?|열람\\s?기간)(?:\\s?(?:준수|적용|이행))?`;
const WAIT_FILLER='(?:(?:(?:상황|경우|사정|일정|형편)\\s?에\\s?(?:따라|맞춰)|원하시면|필요\\s?(?:시|하면|하시면)|요청\\s?(?:시|하시면)|얼마든지|충분히|언제든|본사와|본사\\s?(?:재량|판단)(?:으로|에\\s?따라)?|협의\\s?(?:후|하에|를\\s?통해)|(?:본인|점주님|예비\\s?점주님|가맹\\s?희망자|고객님)\\s?(?:이|께서)|동의\\s?(?:시|하시면|하에))\\s?){0,2}';
// 협의로 늘릴 수는 있어도 줄일 수는 없다는 문장('대기기간은 협의로 늘릴 수는 있어도 줄일 수는 없습니다', '협의로 연장할 수는 있어도 단축은 불가합니다')은 협의로 줄인다는 말이 아니다(15k, 2026-09-26).
// '협의' 뒤는 이음말 화이트리스트만 본다(15l, 2026-09-26): '협의로(도·는)', '협의(를) 해도·하더라도·하셔도', 그 뒤 선택으로 '늘릴·연장할 수는 있어도·있지만'·'연장은 가능하지만'과 '절대·결코·전혀', 끝은 줄임을 부정하는 서술이다('줄일 수 없을까요~'·'없나요' 같은 묻는 끝은 아니다). 15k의 25자 빈 창은 '협의 가능하지만·협의 사항이라·협의로 정하되·협의 하에 7일까지·협의로 조정되며 … 줄일 수는 없습니다'(협의로 정하거나 조정할 수 있다는 말)까지 뺐다. '협의로 줄일 수는 있어도 늘릴 수는 없습니다'는 끝이 줄임 부정이 아니어서 빼지 않는다.
const SHORTEN_WORD='(?:줄이|줄일|줄여|줄어|단축|앞당|당기|당길|당겨|짧아|짧게|축소)';
const SHORTEN_DENIED=`${SHORTEN_WORD}[가-힣]{0,3}?\\s?(?:(?:할|될|하실|드릴)\\s?)?(?:수\\s?(?:는\\s?|도\\s?)?없|지\\s?(?:는\\s?|도\\s?)?(?:않|못)|(?:은|는|이|도)\\s?(?:불가|안\\s?(?:됩|돼|되)|금지)|불가)(?![가-힣]{0,2}(?:까|나요|냐|니까|는지|을지|나\\s?[~?]))[가-힣]{0,4}\\s*(?:[.!~]|$)`;
const NEGOTIATE_CONN='\\s?(?:로도|로는|으로|로|를?\\s?(?:하더라도|해도|하셔도|하시더라도))\\s?(?:(?:늘리|늘릴|연장하|연장할|연장)[가-힣]{0,2}?\\s?(?:수\\s?(?:는\\s?|도\\s?)?있(?:어도|지만|으나|습니다만)|(?:은|는|이)?\\s?가능(?:하지만|해도|합니다만|하나))\\s?[,，]?\\s?)?(?:(?:절대(?:로)?|결코|전혀)\\s?)?';
const NEGOTIATE_DENIED=`(?!${NEGOTIATE_CONN}${SHORTEN_DENIED})`;
const WAIT_OPTIONAL=`(?:선택\\s?(?:사항|적)?|필수\\s?(?:사항)?\\s?(?:은|는|가|이)?\\s?(?:아님|아닙|아니(?!\\s?(?:라고|란|라는))|X)|의무\\s?(?:사항)?\\s?(?:은|는|가|이)?\\s?(?:아님|아닙|아니(?!\\s?(?:라고|란|라는)))|생략\\s?(?:가능|할\\s?수\\s?있|하실\\s?수\\s?있|하셔도|해도|도\\s?가능|OK|ok)|면제\\s?(?:가능|해\\s?드|됩|돼)|협의${NEGOTIATE_DENIED}\\s?(?:가능|하에|해\\s?드|로|하셔도|할\\s?수\\s?있)|유동적|융통성\\s?있|형식(?:적|일\\s?뿐|에\\s?불과|상)|요식\\s?(?:행위|적)|유명무실|참고\\s?(?:사항|용)|권[장고]\\s?(?:사항|기준|기간|치)|가이드\\s?라인|(?:법적\\s?)?(?:강제성|구속력)\\s?(?:이|은|는|도)?\\s?없|(?:법적(?:으로)?\\s?)?강제(?:되는|하는|적인)?\\s?(?:사항|것|건|의무)\\s?(?:은|는|이|가)?\\s?아(?:님|닙|니(?!\\s?(?:라고|란|라는)))|탄력적|(?:꼭\\s?)?안\\s?지켜도|지키지\\s?않아도|무시\\s?(?:가능|하셔도|해도)|건너뛸\\s?수\\s?있|건너뛰어도|없어도\\s?(?:되|돼|됩)|상관\\s?없|스킵|[Ss]kip|SKIP|포기\\s?(?:하시면|하면|가능|할\\s?수\\s?있|하셔도|해도))`;
// 자문 조건 없이 대기기간을 줄이거나 조정한다는 말(자문을 받으면 7일로 줄어드는 것은 제7조③이다). '짧게 느껴질 수 있지만'은 줄이는 말이 아니다.
const WAIT_SHORTEN=`(?:조정|단축|줄일\\s?수|줄여|줄어|당겨|앞당|짧아(?!\\s?(?:보|보이|보여))|짧게(?!\\s?(?:느껴|느끼|보이|보여|생각|여기)))${NO_ADVICE_AROUND}`;
// 계약 당일·전날 문서를 다시·한 부 더·요약본·최종본과 비교해 주는 것은 첫 제공이 아니다. '받으신 날짜·날부터'(확인)와 '받으셨다면'(조건)도 아니다.
const WAIT_REPEAT_GAP='(?:(?!다시|재차|한\\s?(?:부|번)\\s?더|한부더|설명|비교|확인|사본|요약|최종|복사|추가)[^.\\n\\d]){0,10}?';
const WAIT_RECEIVED='(?:받으(?!셨다면|셨으면|신다면|시면|신\\s?(?:날짜|날|일자|일(?![가-힣])))|받습|받아|받게)';
const WAIT_MISSTATED:readonly string[]=[
 // 정보공개서·계약서안을 받은 뒤 짧은 기간 또는 곧바로 계약·가맹금('정보공개서를 받은 날부터 3일이 지나면 가맹계약', '정보공개서를 받은 다음 날 계약', '정보공개서 제공 뒤 바로 계약금을 받습니다', '받으시고 3일 후, 계약서 작성').
 `${WAIT_DOC}${WAIT_DOC_GAP(20)}(?:${SHORT_WAIT}${WAIT_AFTER}|${WAIT_NOW}\\s?(?:에|에도|에는|엔|부터|로|이라도)?)\\s?(?:(?:→|->|=>|⇒|,|，)\\s?)?${WAIT_GAP}${WAIT_ACT}`,
 `${WAIT_DOC}(?:와|과)\\s?(?:함께|같이|동시에|한꺼번에)\\s?${WAIT_GAP}${WAIT_ACT}`,
 `${WAIT_DOC}${WAIT_DOC_GAP(20)}${WAIT_AT_RECEIPT}\\s?${WAIT_GAP}(?:${WAIT_FEE}|(?:가맹\\s?)?${FR_CONTRACT}(?!\\s?(?:전(?![가-힣])|서(?!\\s?(?:에|작성|서명|사인|날인|쓰|써|도장)))))${WAIT_ABOUT}${WAIT_NOT_NEG}(?![^.\\n]{0,25}?(?:확인서|수령증|영수증))`,
 // 가맹금·계약을 주제로 먼저 쓴 문장('가맹금은 정보공개서를 드린 날 받습니다', '가맹비는 정보공개서와 함께 입금해 주세요', '가맹 계약은 정보공개서를 받고 일주일 뒤에 합니다').
 `(?:${WAIT_FEE}|(?:가맹\\s?)?${FR_CONTRACT}(?:\\s?체결)?)\\s?(?:은|는|도)\\s?${WAIT_DOC}(?:[^.\\n\\d]{0,12}?(?:${WAIT_NOW}\\s?(?:에|에도|에는|엔|부터)?|${SHORT_WAIT}${WAIT_AFTER})|(?:와|과)\\s?(?:함께|같이|동시에|한꺼번에))\\s?(?:(?:바로|즉시|곧바로|곧장|함께|같이|동시에|한꺼번에|한\\s?번에)\\s?)?(?:받|입금|결제|납부|송금|수령|수납|청구|체결|진행|하|합|해|드립|서명|사인|가능|OK|ok)${WAIT_NOT_NEG}`,
 // 계약 당일·하루 전·N일 전에 정보공개서·계약서안을 주는 문장('가맹계약서안은 계약 당일 드립니다', '가맹계약 3일 전까지 정보공개서를 드립니다').
 `${WAIT_DOC}(?:\\s?(?:와|과|랑|하고|및)\\s?[가-힣]{1,8})?\\s?(?:은|는|을|를|도)?\\s?(?:모두\\s?|함께\\s?|같이\\s?)?(?:가맹\\s?)?계약(?:\\s?체결)?\\s?(?:일|일자)?\\s?(?:하는|하시는|하실|할|체결하는|체결할)?\\s?(?:당일|전날|날|때|자리에서|현장에서|직전|하루\\s?전(?:날)?|${SHORT_WAIT}\\s?전)(?:에|에는|까지|쯤)?(?!\\s?(?:이\\s?아니|이\\s?아닌|이전|로부터|부터))${WAIT_REPEAT_GAP}(?:드립|드려|드리|전달|제공|교부|보내|주(?:고|며|세|십|어|ㅂ)|${WAIT_RECEIVED})${WAIT_NOT_NEG}`,
 `(?:가맹\\s?)?${FR_CONTRACT}(?:\\s?체결)?\\s?(?:일\\s?)?(?:(?:${SHORT_WAIT}|하루)\\s?전(?:날)?|전날|당일)(?:에|에는|까지|쯤)?[^.\\n\\d]{0,12}?${WAIT_DOC}${WAIT_REPEAT_GAP}(?:드립|드려|드리|전달|제공|교부|보내|${WAIT_RECEIVED}|수령(?!\\s?확인))${WAIT_NOT_NEG}`,
 // 계약까지 짧은 기간('정보공개서 받고 계약까지 딱 5일이면 됩니다', '정보공개서 수령 후 계약까지: 5일').
 `${WAIT_DOC}[^.\\n\\d]{0,15}?(?:(?:가맹\\s?)?${FR_CONTRACT}|(?:가맹금|가맹비|계약금)\\s?(?:입금|납부|결제)?)\\s?(?:까지|까진)\\s?(?:은\\s?|는\\s?|[:：]\\s?)?(?:단\\s?|딱\\s?|불과\\s?|최소\\s?|약\\s?|겨우\\s?|고작\\s?|보통\\s?|평균\\s?|빠르면\\s?)?(?:${SHORT_WAIT}|당일)${WAIT_NOT_NEG}`,
 // 대기기간을 짧게 적은 문장('대기기간은 3일입니다', 자문 조건 없는 '대기기간은 7일입니다', '대기기간 | 7일', '정보공개서 검토 기간 3일'). '대기기간 3일째'는 기간 안의 날이다.
 `${WAIT_SUBJ_GUARD}(?:(?:법정\\s?)?(?:대기|숙려)\\s?(?:기간|일수)|열람\\s?기간|${WAIT_DOC}\\s?(?:의\\s?)?(?:검토|열람)\\s?(?:기간|시간))\\s?(?:은|는|이|:|：|\\|)?\\s?(?:단\\s?|딱\\s?|불과\\s?|최소\\s?|약\\s?|겨우\\s?|고작\\s?|보통\\s?|평균\\s?|총\\s?|최대\\s?|원칙적으로\\s?|기본적으로\\s?|통상\\s?|일반적으로\\s?|실제로는?\\s?|넉넉히\\s?|충분히\\s?)?${SHORT_WAIT}(?=\\s?(?:입니다|이에요|예요|이다|임|이며|이고|로|으로|뿐|밖에|만|이면|면|드려요|드립니다|드림|드리고|드려|[,.!~)]|$))`,
 // 대기기간이 선택·필수 아님·생략·면제·협의·조정·스킵·포기 가능(자문 조건 없는 단축·조정)이라는 문장('14일 대기기간은 선택 사항입니다', '대기기간은 상황에 따라 조정 가능합니다', '14일은 권장 사항입니다').
 `${WAIT_SUBJ}\\s?(?:은|는|이|가|도|요|을|를)?\\s?${WAIT_FILLER}(?:${WAIT_OPTIONAL}|${WAIT_SHORTEN})${WAIT_NOT_NEG}`,
 `${WAIT_SUBJ_GUARD}(?<![\\d월.,]\\s?)(?:14\\s?일|2\\s?주|두\\s?주|십사\\s?일)\\s?(?:은|는)\\s?(?:(?:본사|저희|당사|회사)\\s?)?(?:내부\\s?)?(?:(?:기준|규정|지침|방침|원칙)(?:이라서?|이어서|이니|이고|이며)\\s?)?${WAIT_FILLER}(?:${WAIT_OPTIONAL}|${WAIT_SHORTEN})${WAIT_NOT_NEG}`,
 // 14일·2주가 안 돼도·지나기 전에도 계약·가맹금이 된다는 문장('2주 안 돼도 계약 가능합니다', '대기기간 끝나기 전 계약하시면 가맹비 할인').
 `(?:(?<![\\d.,월]\\s?)(?:14\\s?일|2\\s?주|십사\\s?일)|두\\s?주|이\\s?주|보름|(?:대기|숙려)\\s?기간)\\s?(?:이|가)?\\s?(?:안\\s?(?:돼도|되어도|됐어도|지나도|지났어도|되더라도|지나더라도|채워도)|못\\s?채워도|채우지\\s?않(?:아도|더라도|고)|(?:다\\s?)?(?:지나기|경과하기|끝나기|되기|차기)\\s?전(?:에도|이라도|이어도|에|에는|이더라도)?|전(?:에도|이라도|이더라도))[^.\\n\\d]{0,12}?${WAIT_ACT}(?:[^.,\\n]{0,10}?${WAIT_POS}|\\s?${WAIT_PERK})${WAIT_NOT_NEG}`,
 // 14일·2주를 기다릴 필요 없다는 문장('14일 기다리실 필요 없이').
 `(?:(?<![\\d.,월]\\s?)14\\s?일|2\\s?주|두\\s?주|이\\s?주|보름|대기\\s?기간)\\s?(?:을|를|이나|씩이나|까지|동안)?\\s?(?:다\\s?|꼭\\s?|굳이\\s?)?(?:기다리실|기다리셔야\\s?할|기다려야\\s?할|기다릴|채우실|채울|지키실|지킬)\\s?필요\\s?(?:는\\s?|가\\s?|까지는\\s?)?(?:없|X|NO|no)|(?:14\\s?일|2\\s?주|두\\s?주|보름|대기\\s?기간)\\s?(?:을|를)?\\s?(?:다\\s?|꼭\\s?)?(?:굳이\\s?)?안\\s?기다리셔도`,
];
// 레드팀 반영 표현(2026-09-26). 원문 크기 때문에 따로 컴파일한다(ClaimMatcher.more).
const WEEKDAY='(?:월|화|수|목|금|토|일)요일';
const WEEK_GAP='(?:(?!다다음|두\\s?주|2\\s?주|이\\s?주|셋째|넷째|다음\\s?달|달\\s?(?:뒤|후)|주\\s?(?:뒤|후))[^.\\n\\d]){0,20}?';
const WAIT_14='(?<![\\d월.,]\\s?)(?:14\\s?일|2\\s?주|두\\s?주|십사\\s?일)';
const WAIT_ANSWER='\\s?(?:(?:→|->|A\\s?[.:：)])\\s?)?';
const WAIT_YES='(?:(?:네|예)\\s?[,.!]|물론|그럼요|당연)';
const WAIT_MISSTATED_MORE:readonly string[]=[
 // 'D+3'·'+3일'·'4일차'·'Day 3'(정보공개서 받은 날이 D·1일차), 화살표·기호로 이은 '제공 ▶ 3일 ▶ 가맹계약'.
 `${WAIT_DOC}[^\\n]{0,20}?(?:[Dd]\\s?\\+\\s?(?:[1-9]|1[0-3])(?!\\d)(?:\\s?일)?|\\+\\s?(?:[1-9]|1[0-3])\\s?일)\\s?(?:차\\s?)?(?:에\\s?)?(?:,\\s?)?${WAIT_GAP}${WAIT_ACT}`,
 `${WAIT_DOC}[^\\n]{0,30}?(?:가맹\\s?)?${FR_CONTRACT}${WAIT_ABOUT}(?:\\s?(?:체결|서명))?\\s?(?:은|는|일|일자)?\\s?[:：]?\\s?(?:[Dd]\\s?\\+\\s?(?:[1-9]|1[0-3])(?!\\d)|\\(?\\s?(?:[1-9]|1[0-4])\\s?일\\s?차(?!\\s?이후))${WAIT_NOT_NEG}`,
 `${WAIT_DOC}[^\\n]{0,25}?(?:(?<!\\d)(?:[1-9]|1[0-4])\\s?일\\s?차|(?<![A-Za-z])[Dd]ay\\s?(?:[1-9]|1[0-4])(?!\\d))\\s?(?:에\\s?|에는\\s?)?(?:[,:：]\\s?)?${WAIT_GAP}${WAIT_ACT}`,
 `${WAIT_DOC}\\s?(?:수령|제공|교부|전달|발송)(?:\\s?(?:후|뒤))?\\s?(?:(?:→|->|=>|⇒)\\s?)?${SHORT_WAIT}\\s?(?:(?:→|->|=>|⇒)\\s?)?(?:가맹\\s?)?계약(?:\\s?(?:체결|서명))?(?=\\s?(?:$|[.!~]|가능|OK|진행|완료))`,
 `${WAIT_DOC}${WAIT_DOC_GAP(20)}(?:뒤|후|이후)\\s?${SHORT_WAIT}\\s?[,，]\\s?(?:자문\\s?(?:없어도|없이도|안\\s?받아도|안\\s?받으셔도)\\s?)?(?:OK|ok|가능|(?:가맹\\s?)?계약\\s?(?:OK|ok|가능))${WAIT_NOT_NEG}`,
 // 요일·같은 주('월요일에 받으시면 금요일에 계약', '이번 주 받으시고 다음 주 월요일에 계약'). '다다음 주'·'2주 뒤'는 아니다.
 `(?:${WEEKDAY}|이번\\s?주|금주)[^.\\n\\d]{0,10}?${WAIT_DOC}${WEEK_GAP}(?:(?:이번|같은|그)\\s?주\\s?|(?<!다)다음\\s?주\\s?)?${WEEKDAY}(?:\\s?(?:에|에는|엔|쯤))?\\s?${WAIT_GAP}${WAIT_ACT}`,
 // 문서를 먼저 쓰고 계약·가맹금을 주제로 이은 때('정보공개서는 오늘 드립니다. 계약은 내일 하시죠.').
 `${WAIT_DOC}${WAIT_DOC_GAP(20)}(?:가맹\\s?)?(?:${FR_CONTRACT}|${WAIT_FEE})\\s?(?:은|는|도)\\s?(?:내일|모레|글피|다음\\s?날|익일|이튿날|당일|그\\s?날|바로|즉시|${SHORT_WAIT}\\s?(?:뒤|후)(?:에)?)\\s?(?:에\\s?)?(?:바로\\s?)?(?:하|해|합|진행|체결|가능|받|입금|납부|결제|OK|서명|사인)${WAIT_NOT_NEG}`,
 // 묻고 짧게 답한 문장('Q. 정보공개서 받고 언제 계약할 수 있나요?\nA. 3일 후부터 가능합니다', 'FAQ) 계약은 언제? → 정보공개서 받고 사흘 후'), 짧게 바꾸는 물음에 '네'로 답한 문장.
 `${WAIT_DOC}[^?\\n]{0,20}?(?:언제|며칠)[^?\\n]{0,8}?(?:${FR_CONTRACT}|${WAIT_FEE})[^?\\n]{0,15}\\?${WAIT_ANSWER}(?:${WAIT_YES}\\s?)?(?:${WAIT_DOC}[^.?\\n\\d]{0,12}?)?${SHORT_WAIT}${WAIT_AFTER}${WAIT_NOT_NEG}`,
 `(?:가맹\\s?)?(?:${FR_CONTRACT}|${WAIT_FEE})\\s?(?:은|는|을|를|이|가)?\\s?(?:언제|며칠\\s?(?:뒤|후))[^?\\n]{0,12}\\?${WAIT_ANSWER}${WAIT_DOC}[^.?\\n\\d]{0,12}?${SHORT_WAIT}${WAIT_AFTER}${WAIT_NOT_NEG}`,
 `${WAIT_DOC}${WAIT_DOC_GAP(20)}(?:${SHORT_WAIT}${WAIT_AFTER}|${WAIT_NOW})[^?\\n]{0,6}?(?:${FR_CONTRACT}|${WAIT_FEE})[^?\\n]{0,15}\\?\\s?(?:A\\s?[.:：)]\\s?)?${WAIT_YES}`,
 `${WAIT_SUBJ}[^?\\n]{0,20}?(?:줄|단축|생략|조정|협의|면제|건너|스킵|패스)[^?\\n]{0,12}\\?\\s?(?:A\\s?[.:：)]\\s?)?${WAIT_YES}${NO_ADVICE_AROUND}`,
 // 대기기간을 묻는 물음에 '아니요'로 답하고 줄여 주는 문장('Q: 대기기간이 꼭 14일인가요?\nA: 아니요, 협의하면 짧아집니다').
 `${WAIT_SUBJ}[^?\\n]{0,15}\\?\\s?(?:A\\s?[.:：)]\\s?)?(?:아니요|아뇨|아니오)\\s?[,.!]?\\s?[^.?\\n]{0,20}?(?:짧아|줄어|줄일|단축|빨라|앞당|당겨|${SHORT_DAYS}(?!\\s?(?:이|가)?\\s?아니))${NO_ADVICE_AROUND}${WAIT_NOT_NEG}`,
 // 표·이름표('계약 가능일: 정보공개서 수령 다음 날', '계약금 입금 시점: 정보공개서 수령 당일').
 `(?:(?:가맹\\s?)?계약|${WAIT_FEE})\\s?(?:입금|납부|결제|체결|서명)?\\s?(?:가능\\s?)?(?:일|일자|날짜|시점|시기|날)\\s?[:：|]\\s?${WAIT_DOC}\\s?(?:수령|제공|교부|전달|을\\s?받은|받은|받으신)?\\s?(?:다음\\s?날|익일|이튿날|당일|같은\\s?날|즉시|직후|${SHORT_WAIT}\\s?(?:뒤|후|이후))`,
 // 대기기간이 없다·0일·X·zero('숙려기간 : 없음', '대기기간? 그런 거 없어요', '대기기간 ㄴㄴ'), 대기기간 없이 진행, 대기는 딱 일주일.
 `${WAIT_SUBJ_GUARD}(?:법정\\s?)?(?:대기|숙려)\\s?(?:기간|일수)\\s?(?:은|는|이|가|도|:|：|\\|)?\\s?\\??\\s?(?:그런\\s?(?:거|것|건)\\s?(?:은|는)?\\s?)?(?:아예\\s?|따로\\s?|별도\\s?|전혀\\s?|사실상\\s?)?(?:없(?:습니다|어요|음|다(?![가-힣])|죠|지요)|X(?![A-Za-z0-9])|0\\s?일|제로|[Zz]ero|ZERO|ㄴㄴ|\\u1102\\u1102|노노|NO(?![A-Za-z])|No(?![A-Za-z]))`,
 `${WAIT_SUBJ_GUARD}(?:대기|숙려)\\s?기간\\s?(?:을\\s?)?(?:없이|생략하고|건너뛰고|스킵하고|패스하고)\\s?(?:바로\\s?|즉시\\s?)?(?:진행|처리|체결|가능|OK|시작)${WAIT_NOT_NEG}`,
 `(?<![가-힣]\\s?)대기\\s?(?:는|은)\\s?(?:딱\\s?|단\\s?|불과\\s?|겨우\\s?|고작\\s?)?${SHORT_WAIT}(?=\\s?(?:입니다|이에요|예요|뿐|[!.~]|$))`,
 // 대기기간 중·14일 전·대기기간과 무관하게 받는 가맹금('대기기간 중에도 가맹비 선입금 가능', '가맹금은 14일 전에 먼저 받고', '교육비는 대기기간과 상관없이 먼저 받습니다').
 `${WAIT_SUBJ}\\s?(?:중(?:에|에도|에는|이라도)?|동안(?:에|에도|이라도)?|안에(?:도)?|내에(?:도)?|내(?=\\s))\\s?[^.\\n\\d]{0,10}?(?:${WAIT_FEE}\\s?(?:을|를)?\\s?(?:먼저\\s?|미리\\s?|일부\\s?)?${WAIT_PAY}|(?:가맹\\s?)?${FR_CONTRACT}${WAIT_ABOUT}\\s?(?:을\\s?|를\\s?)?(?:체결|진행|가능|하|해|합|서명))${WAIT_NOT_NEG}`,
 `${WAIT_FEE}\\s?(?:은|는|을|를|도)?\\s?(?:${WAIT_14}|보름|(?:대기|숙려)\\s?기간)\\s?(?:이\\s?|가\\s?)?(?:(?:(?:다\\s?)?(?:지나기|끝나기|경과하기)\\s?)?(?:전|이전)(?:에|에도|부터)?|중(?:에|에도|에라도)?|동안(?:에|에도)?)\\s?(?:먼저\\s?|미리\\s?|일부\\s?)?${WAIT_PAY}${WAIT_NOT_NEG}`,
 `${WAIT_FEE}\\s?(?:입금|납부|결제|수령)?\\s?(?:은|는|도)\\s?(?:14\\s?일\\s?)?(?:대기|숙려)\\s?기간(?:\\s?14\\s?일)?\\s?(?:과|와|에)\\s?(?:무관(?:합니다|해요|하게|하며|하고)?|상관\\s?(?:없|이\\s?없)(?:이|습니다|어요)?|관계\\s?(?:없|가\\s?없)(?:이|습니다|어요)?|별개(?:입니다|예요|로)?)${WAIT_NOT_NEG}`,
 // 계약은 2주 뒤, 가맹비는 오늘·미리.
 `(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:은|는)?\\s?${WAIT_14}\\s?(?:뒤|후|이후)(?:에)?\\s?(?:[,，]\\s?)?${WAIT_FEE}\\s?(?:은|는|만|도)?\\s?(?:오늘|지금|먼저|미리|당일|바로|즉시|선입금|선납|우선)`,
 `${WAIT_14}\\s?(?:뒤|후|이후)(?:에)?\\s?(?:가맹\\s?)?${FR_CONTRACT}(?:하시되|하시고|하고|하지만|이지만|하시더라도)?\\s?(?:[,，]\\s?)?${WAIT_FEE}\\s?(?:은|는|만|도)?\\s?(?:오늘|지금|먼저|미리|당일|바로|즉시|선입금|선납|우선)`,
 // 날짜 소급·역산·비워 두기, 계약서를 뒤 날짜로 적기('정보공개서 수령일은 소급해서 적어드릴게요', '계약서는 14일 뒤 날짜로 작성합니다').
 `(?:${WAIT_DOC}\\s?(?:수령|제공|교부|전달)\\s?(?:일|날짜|일자)|(?:수령\\s?)?확인서(?:\\s?(?:의\\s?)?(?:날짜|일자))?|${WAIT_SUBJ})\\s?(?:은|는|을|를|의|도)?\\s?[^.\\n]{0,15}?(?:소급|역산|(?:\\d+\\s?(?:일|주)|이\\s?주|두\\s?주|보름|열흘|며칠)\\s?(?:전|이전|앞)\\s?(?:날짜|일자)|날짜\\s?(?:를\\s?|는\\s?|은\\s?)?(?:비워|비우|공란|빈\\s?칸|앞당|당겨|거꾸로))${WAIT_NOT_NEG}`,
 `(?:가맹\\s?)?계약(?:서|일)\\s?(?:의\\s?)?(?:날짜|일자|체결일|작성일)?\\s?(?:는|은|을|를)?\\s?[^.\\n]{0,12}?(?:\\d+\\s?(?:일|주)|이\\s?주|두\\s?주|보름|열흘|며칠|나중)\\s?(?:뒤|후|이후)?\\s?(?:날짜|일자)?\\s?(?:로|으로)\\s?(?:적|쓰|기재|작성|처리|맞춰|찍)${WAIT_NOT_NEG}`,
 // 형식적 자문('자문 받았다고 체크만 하시면 7일 뒤 계약됩니다', '자문 확인서에 서명만 해주시면 대기기간 7일로 줄어요').
 `(?:자문|${ADVISOR})[^.\\n]{0,20}?(?:(?:서명|사인|체크|도장|날인)\\s?만|받았다고\\s?(?:체크|표시|적|쓰|하시|하면|하셔도)|받은\\s?(?:걸로|것으로)|형식(?:적|상|일\\s?뿐|에\\s?불과)|요식)[^.\\n]{0,25}?(?:7\\s?일|칠\\s?일|일주일|1\\s?주|한\\s?주|단축|줄어|줄여|줄일|빨라)${WAIT_NOT_NEG}`,
 // 대기기간을 깎아내리는 말: 옛날 얘기, 최대 기간일 뿐, 폐지·없어짐, 적용 제외, 기다리다 자리를 놓친다, 14일이 아니라 7일, 다른 곳은 14일 저희는 사흘.
 `(?:${WAIT_SUBJ}|${WAIT_14}|보름)\\s?(?:을|를)?\\s?(?:다\\s?|꼭\\s?)?(?:기다리는|지키는|채우는|기다리시는|지키시는)\\s?(?:건|것은|거는|게|것도)\\s?(?:다\\s?)?(?:옛날|옛말|구시대|구식|의미\\s?없|필요\\s?없|손해|시간\\s?낭비|낭비)`,
 `(?:${WAIT_SUBJ}|${WAIT_14})\\s?(?:은|는|이|가)?\\s?(?:최대|최장|상한|최고)\\s?(?:기간|치|일수)?(?:이고|이며|일\\s?뿐|이라|이지만)?[^.\\n]{0,12}?(?:더\\s?)?(?:빨리|일찍|짧게|앞당|단축)${NO_ADVICE_AROUND}${WAIT_NOT_NEG}`,
 `${WAIT_SUBJ}(?:\\s?(?:제도|규정|의무|조항))?\\s?(?:은|는|이|가|도)?\\s?[^.\\n]{0,10}?(?:폐지(?:됐|되었|됨|돼)|없어졌|없어짐|사라졌|사라짐|철폐|삭제(?:됐|되었)|없앴|유명무실|무력화)${WAIT_NOT_NEG}`,
 `${WAIT_SUBJ}(?:\\s?(?:제도|규정|의무|조항))?\\s?(?:은|는|이|가|도)?\\s?[^.\\n]{0,20}?(?:적용\\s?(?:이\\s?)?(?:안\\s?(?:됩|돼|되)|되지\\s?않|제외|예외|면제|대상이\\s?아(?:니|닙|님|닌)|대상\\s?아님|대상\\s?외)|해당\\s?(?:안\\s?(?:됩|돼)|되지\\s?않|사항\\s?(?:없|이\\s?없)))${WAIT_NOT_NEG}`,
 `(?:${WAIT_SUBJ}|${WAIT_14}|보름)\\s?(?:을\\s?|를\\s?|동안\\s?)?(?:다\\s?)?(?:기다리다가?|기다리면|기다리시면|기다리는\\s?(?:동안|사이))[^.\\n]{0,15}?(?:뺏|빼앗|놓치|놓칩|나가|나갑|나갈|없어지|없어집|사라지|사라집|팔려|팔립|마감)${WAIT_NOT_NEG}`,
 `${WAIT_14}\\s?(?:이|가)?\\s?아니(?:라|고)\\s?${SHORT_WAIT}${WAIT_NOT_NEG}`,
 `${SHORT_WAIT}\\s?(?:만|이면|정도만|정도)\\s?(?:기다리시면|기다리면|기다리셔도|대기하시면|대기하면)\\s?(?:바로\\s?)?(?:가맹\\s?)?${FR_CONTRACT}${WAIT_ABOUT}${WAIT_NOT_NEG}`,
 `(?:${WAIT_SUBJ}|${WAIT_14})\\s?\\??[^.\\n]{0,15}?(?:저희|우리|당사|본사)\\s?(?:는|은)\\s?(?:딱\\s?|단\\s?|불과\\s?|겨우\\s?)?${SHORT_WAIT}(?=\\s?(?:[!.~]|$|입니다|이에요|예요|이면\\s?(?:됩|돼|충분|끝|OK)|면\\s?(?:됩|돼|충분|끝|OK)|만\\s?(?:기다리|대기)|로\\s?(?:충분|끝)))`,
 // 14일 안에·전에 계약하면 혜택, 14일 이내 언제든 계약.
 `${WAIT_14}\\s?(?:이내|안|내)(?:에|에라도|라도|에도)?\\s?(?:언제든(?:지)?|아무\\s?때나|바로|즉시|빨리)?\\s?(?:가맹\\s?)?(?:${FR_CONTRACT}|${WAIT_FEE})${WAIT_ABOUT}\\s?(?:을\\s?|를\\s?)?(?:체결\\s?)?(?:하시면|하면|시(?![가-힣])|가능|OK|진행|하실\\s?수\\s?있|할\\s?수\\s?있|하세요|해\\s?드|합니다|받습|입금)${WAIT_NOT_NEG}`,
 `${WAIT_14}\\s?(?:전|이전)(?:에)?\\s?(?:가맹\\s?)?${FR_CONTRACT}\\s?${WAIT_PERK}`,
 // 보통·평균 며칠이면 계약, 계약까지 평균 N일(앞에 14일·대기기간이 없을 때).
 `(?<![가-힣])(?:보통|평균(?:적으로)?|대개|대부분|통상|빠르면|일반적으로)\\s?${SHORT_WAIT}\\s?(?:정도|쯤|내외|안팎)?\\s?(?:이면|면|만에|안에|이내에?|내에?)\\s?(?:바로\\s?)?(?:가맹\\s?)?${FR_CONTRACT}${WAIT_ABOUT}${WAIT_NOT_NEG}`,
 `(?<!(?:14\\s?일|2\\s?주|두\\s?주|보름|대기\\s?기간|숙려\\s?기간)[^.\\n]{0,20})(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:체결\\s?)?(?:까지|까진)\\s?(?:걸리는|소요되는|필요한|드는)?\\s?(?:시간|기간|일수|소요\\s?(?:시간|기간|일))?\\s?(?:은|는|:|：)?\\s?(?:평균|보통|약|최소|단|딱|대략|빠르면|겨우|고작|불과)\\s?${SHORT_WAIT}${WAIT_NOT_NEG}`,
 // 하루·당일·원데이·한 번에 끝내는 흐름('정보공개서✔ 계약✔ 하루 만에 끝!', '정보공개서 설명 → 계약서 서명 → 가맹비 입금, 하루에 끝!'), 현장 계약.
 `${WAIT_DOC}[^.\\n\\d]{0,25}?(?:(?:가맹\\s?)?${FR_CONTRACT}(?:서)?${WAIT_ABOUT}|${WAIT_FEE}${WAIT_ABOUT}|(?<!(?:확인서|수령증|영수증|동의서|신청서|수령\\s?확인)[^.\\n]{0,12})서명)[^.\\n\\d]{0,20}?(?:하루\\s?(?:만에|에|안에|면)|(?<![가-힣])당일(?:에)?|원\\s?데이|[Oo]ne[-\\s]?day|한\\s?(?:번|방)에|한꺼번에|원스톱|같은\\s?날)(?=\\s?(?:끝|완료|처리|진행|마무리|OK|가능|해\\s?드|합니다|다\\s?(?:끝|처리|해)|[!.~]|$))${WAIT_NOT_NEG}`,
 `(?<!(?:공사|건설|시공|인테리어)\\s?)(?<![가-힣])현장\\s?(?:가맹\\s?)?계약(?=\\s?(?:시(?![가-힣])|하시면|하면|받(?:습|아|으|고)|해\\s?드|합니다|체결|특전|혜택|할인|이벤트|우대|프로모션|가능|진행|OK|[!~]|$))${WAIT_NOT_NEG}`,
 // 계약하면 주는 정보공개서, 정보공개서 없이·나중에, 미리 보실 필요 없이, 계약서를 그날 보여 주고 바로 서명, 검토는 하루면 충분, 설명 듣고 바로 계약금.
 `${WAIT_DOC}\\s?(?:는|은|를|도)?\\s?(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:을\\s?|를\\s?)?(?:체결\\s?)?(?:하시면|하면|하시고|하고\\s?나서|하신\\s?(?:후|뒤|다음)(?:에)?|한\\s?(?:후|뒤|다음)(?:에)?|시(?![가-힣]))\\s?${WAIT_REPEAT_GAP}(?:드립|드려|드리|보내|전달|제공|교부|발송|챙겨)${WAIT_NOT_NEG}`,
 `${WAIT_DOC}\\s?(?:없이|안\\s?받(?:고|으셔도|아도)|받지\\s?않(?:고|으셔도|아도)|생략하고|건너뛰고|패스하고)\\s?(?:도\\s?)?(?:바로\\s?)?(?:가맹\\s?)?(?:${FR_CONTRACT}|${WAIT_FEE})${WAIT_ABOUT}${WAIT_NOT_NEG}`,
 `${WAIT_DOC}\\s?(?:는|은|도)?\\s?(?:나중에|천천히|계약\\s?(?:후|뒤)에?|계약하고\\s?나서)[^\\n]{0,25}?(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:을|를)?\\s?(?:부터|먼저)\\s?(?:하|진행|해|체결|사인|서명)`,
 `${WAIT_DOC}\\s?(?:은|는|을|를|도)?\\s?(?:미리|사전에|먼저|따로)\\s?(?:보실|받으실|검토하실|읽으실|보|받|검토할|읽을)\\s?필요\\s?(?:가|는|도)?\\s?(?:없|X)`,
 `(?:가맹\\s?)?계약서\\s?(?:는|은|를)?\\s?(?:계약\\s?)?(?:당일|그\\s?날|현장에서|그\\s?자리에서)(?:에)?\\s?(?:처음\\s?)?(?:보여|보내|드리|드려|전달|설명|주)[^.\\n]{0,12}?(?:바로|즉시|곧바로|그\\s?자리에서)\\s?(?:서명|사인|날인|도장|계약|체결)${WAIT_NOT_NEG}`,
 `${WAIT_DOC}\\s?(?:검토|열람|확인|숙지)\\s?(?:는|은|도)?\\s?${SHORT_WAIT}\\s?(?:이면|면|만\\s?(?:하면|해도)|정도면|로|으로)?\\s?(?:충분|끝|OK|족|됩니다|돼요)${WAIT_NOT_NEG}`,
 `${WAIT_DOC}\\s?(?:설명|브리핑)\\s?(?:을\\s?|를\\s?)?(?:들으시고|듣고|들으신\\s?(?:후|뒤|다음)(?:에)?|들은\\s?(?:후|뒤|다음)(?:에)?|받으시고|받고|받으신\\s?(?:후|뒤)(?:에)?)\\s?(?:바로\\s?|곧바로\\s?|즉시\\s?)?${WAIT_ACT}(?![^.\\n]{0,15}?(?:14\\s?일|2\\s?주|두\\s?주|보름))`,
];
// ── 대기기간 오기재 2차(블라인드 레드팀 반영, 2026-09-26) ──
// 문서 낱말 없이 짧은 기간 뒤 계약('영업일 기준 5일 후 계약 진행', '12일만 지나면 가맹계약서 작성 가능', '상담 후 48시간 내 계약하시면', '1주일 검토→계약').
// '5영업일'~'9영업일'은 7일 이상이라 자문 조건이 없을 때만 본다(WEEKISH_DAYS). '영업일 기준 5일'은 1~6일로 읽는다(보수적, 판정 시간 때문에 기간 표현을 더 나누지 않는다).
// 14일·2주·대기기간이 지난 뒤의 짧은 기간('14일이 지나고 3일 뒤 계약')과 계약 진행 여부·일정은 아니다.
const WAIT_NOT_ELAPSED='(?<!(?:14\\s?일|2\\s?주|두\\s?주|이\\s?주|보름|열나흘|십사\\s?일|(?:대기|숙려)\\s?기간)\\s?(?:이|가|을|를)?\\s?(?:다\\s?)?(?:지나|지난|경과|끝나|끝난|채우|채운|후|뒤|이후)[^.\\n]{0,30})';
// 짧은 기간을 앞에 두면 긴 입력('7일 7일 …')의 모든 자리에서 기간 표현을 풀어 보느라 느리다. '계약' 낱말에서 시작해 앞보기(뒤보기)로 기간을 확인한다(판정 시간, 2026-09-26).
const CONTRACT_DONE=`${WAIT_ABOUT}(?:\\s?서)?(?:\\s?(?:을|를|에))?\\s?(?:체결|진행(?!\\s?(?:여부|일정|절차|방법|상황|과정))|가능|서명|사인|작성|날인|도장|하|해|합|됩|돼|되|OK|ok|쓰|써|(?=\\s?(?:[!~→]|->|$)))`;
// 가맹금(제2조6호: 가입비·교육비·보증금 포함)과 이름과 관계없이 가맹금일 수 있는 예약금·예치금·선입금·착수금·신청금.
const FEE_ANY='(?:가맹금|가맹비|계약금|가입비|교육비|보증금(?<!(?:임대|임차|점포|상가|월세|전세)\\s?보증금)|예약금|예치금|선입금|착수금|신청금|가입금)';
const DOC_BEFORE=`${WAIT_DOC}\\s?(?:을|를|은|는)?\\s?(?:드리기|받으시기|받기|전달하기|교부하기|제공하기|발송하기|수령하기|보내\\s?드리기|전달|교부|제공|발송|수령)?\\s?(?:전|이전)(?:에는|에도|에|부터|까지)?(?![가-힣])`;
const NO_ADVICE_Q='(?:자문|변호사|가맹\\s?거래사)\\s?(?:을\\s?|를\\s?)?(?:없이도?|없어도|안\\s?받(?:아도|고도?|으셔도)|받지\\s?않(?:아도|고도?|으셔도))';
const WAIT_MISSTATED_2:readonly string[]=[
 `(?=계약)(?<=${SHORT_WAIT}${WAIT_AFTER}\\s?(?:(?:→|->|=>|⇒)\\s?)?${WAIT_GAP}${NO_ADVICE_GAP}(?:가맹\\s?|본\\s?)?)${WAIT_NOT_ELAPSED}${FR_CONTRACT}${CONTRACT_DONE}${WAIT_NOT_NEG}`,
 // 검토·열람 기간 없이 계약('정보공개서 검토 기간 없이 계약 가능!').
 `(?:검토|열람|숙고|고민)\\s?(?:기간|시간|일수)\\s?(?:을\\s?|은\\s?|도\\s?)?(?:없이|생략(?:하고)?|건너뛰(?:고)?|스킵(?:하고)?|패스(?:하고)?)\\s?(?:바로\\s?|즉시\\s?|곧바로\\s?)?(?:가맹\\s?)?(?:${FR_CONTRACT}|${WAIT_FEE})${WAIT_ABOUT}${WAIT_NOT_NEG}`,
 // 대기기간을 짧은 기간으로 줄인다('숙려기간을 3일로 줄여드릴 수 있어요', 자문 조건 없는 '대기기간을 7일로 단축').
 `(?:줄|단축|앞당|당겨|조정|짧아|축소|변경)(?<=${WAIT_SUBJ}\\s?(?:을|를|은|는|도|이|가)?\\s?(?:얼마든지\\s?|최대\\s?)?(?:${SHORT_WAIT}|하루|당일|반나절)\\s?(?:로|으로|까지|만으로)\\s?(?:줄|단축|앞당|당겨|조정|짧아|축소|변경))${WAIT_NOT_NEG}`,
 // 합의·협의·동의·요청·원하면·내부 정책·재량·탄력적으로 대기기간을 줄이거나 조정한다('대기기간은 서로 합의하면 줄일 수 있어요', '14일 대기는 양쪽이 합의만 하면 얼마든지 줄일 수 있으니',
 // '대기기간은 가맹희망자가 요청하면 단축해 드리니', '숙려기간은 점주님과 본사 간 협의로 얼마든지 조정할 수 있습니다', '숙려기간은 당사 내부 정책에 따라 탄력적으로 조정 가능합니다').
 // '… 합의로 줄일 수 없습니다'(부정)와 자문 조건이 있는 단축은 아니다(WAIT_NOT_NEG, WAIT_SHORTEN의 NO_ADVICE_AROUND).
 `(?:합의|협의|동의|요청|원하|정책|방침|내규|재량|탄력|유연|임의)(?<=${WAIT_SUBJ}\\s?(?:은|는|이|가|도|을|를)?[^.\\n\\d]{0,20}?(?:합의|협의|동의|요청|원하|정책|방침|내규|재량|탄력|유연|임의))[^.\\n\\d]{0,20}?${WAIT_SHORTEN}${WAIT_NOT_NEG}`,
 // 한 문서 쪽 대기는 따로 없다('계약서안은 따로 기다릴 필요 없고 정보공개서만 14일 지나면 돼요'). 뒤에 계약·기간 말이 없는 '정보공개서는 기다리실 필요 없이 당일 보내 드립니다'(발송)는 아니다.
 `${WAIT_DOC}\\s?(?:은|는|도|쪽\\s?(?:대기\\s?기간|대기|기간)?\\s?(?:은|는))?\\s?(?:따로\\s?|별도로?\\s?|굳이\\s?|추가로\\s?)?(?:기다리실|기다릴|기다리셔야\\s?할|기다려야\\s?할|대기하실|대기할|세실|셀|계산하실|계산할|지키실|지킬)\\s?필요\\s?(?:는|가|도)?\\s?(?:없|X)(?=[^.\\n]{0,30}?(?:${FR_CONTRACT}|지나면|지나야|${WAIT_14}|보름|기간))`,
 // 가맹금·예약금을 정보공개서보다 먼저 받는다('예약금은 가맹금이 아니라서 정보공개서 드리기 전에 먼저 받아도 괜찮아요', '교육비랑 보증금은 정공서 전달 전에 선입금', '가맹비 일부를 먼저 받고, 정보공개서는 추후').
 `${FEE_ANY}[^.\\n]{0,25}?${DOC_BEFORE}\\s?(?:이라도\\s?)?(?:먼저\\s?|미리\\s?|우선\\s?|일부\\s?)?(?:${WAIT_PAY}|입금)${WAIT_NOT_NEG}`,
 `${DOC_BEFORE}\\s?(?:이라도\\s?)?(?:먼저\\s?|미리\\s?)?${FEE_ANY}\\s?(?:을|를|은|는|부터|만)?\\s?(?:먼저\\s?|미리\\s?|일부\\s?|우선\\s?)?(?:${WAIT_PAY}|입금)${WAIT_NOT_NEG}`,
 `${FEE_ANY}[^.\\n]{0,15}?(?:먼저|미리|우선)\\s?(?:${WAIT_PAY}|입금)[^.\\n]{0,8}?${WAIT_DOC}\\s?(?:은|는|을|를|도)?\\s?(?:추후|나중에|그\\s?(?:후|뒤|다음)(?:에)?|이후(?:에)?|천천히|따로|별도로|뒤에|후에|다음에|차후)`,
 // 자문 여부와 관계없이·자문을 받든 안 받든 7일(자문 조건이 아니다, '가맹거래사 자문 여부와 관계없이 7일이 지나면 계약서에 서명하실 수 있습니다').
 `(?:자문|변호사|가맹\\s?거래사)\\s?(?:자문\\s?)?(?:을\\s?|를\\s?)?(?:받든\\s?안\\s?받든|여부\\s?(?:와|과|에)?\\s?(?:관계\\s?없이|상관\\s?없이|무관하게))[^.\\n\\d]{0,12}?(?:${WEEK}|${SHORT_DAYS}|${WEEKISH_RAW})[^.\\n\\d]{0,15}?(?:${FR_CONTRACT}|${WAIT_FEE}|서명|사인|체결)${WAIT_NOT_NEG}`,
 // 묻고 '네'로 답한 짧은 기간('Q. 자문 없이도 7일 되나요? A. 네, 7일만 지나면 돼요', 'Q: 7일 만에 계약할 수 있나요? A: 네, … 자문 없이도 7일 뒤 가능합니다'). 자문 조건을 단 답은 아니다(NO_ADVICE_AROUND).
 `${NO_ADVICE_Q}[^?\\n]{0,20}?(?:${WEEK}|${SHORT_DAYS}|${WEEKISH_RAW})[^?\\n]{0,15}\\?${WAIT_ANSWER}${WAIT_YES}`,
 `\\?(?=${WAIT_ANSWER}${WAIT_YES})(?<=${SHORT_WAIT}\\s?(?:만에|안에|이면|면|뒤|후|이내|내|지나면|경과하면)?\\s?(?:바로\\s?)?(?:가맹\\s?)?(?:${FR_CONTRACT}|${WAIT_FEE})[^?\\n]{0,15}\\?)${WAIT_ANSWER}${WAIT_YES}`,
];
// 경고·반박·법 설명·묻는 문장(COLLECTIVE 휴리스틱): 매치가 든 절이 '… 법 위반입니다', '… 피하세요', '… 신고 대상입니다', '… 거절하세요', '… 말은 거짓입니다', '… 권하지 않습니다',
// '… 계약하실 수는 없습니다', '… 하면 어떻게 되나요'로 끝나면 허용·권유하는 문장이 아니다. 'We do not offer same-day contracts'도 같다. 대기기간 규칙과 본사 연계 자문 규칙의 except(절 안)에 둔다.
// 판정기(clauseOf)는 절을 끊은 경계(쉼표·물음표·느낌표·괄호·세미콜론·줄표)를 절 뒤에 붙여 준다. 1393089까지의 끝(WAIT_CAUTION_KO·WAIT_QUOTE_REBUT·CAPTIVE_FREE_END)은 그 경계를 받아(CLAUSE_END) 결과가 전과 같고,
// 15k 뒤에 더한 끝('…는 것은 불가능합니다', '…피하는 게 좋아요')은 문장 끝에서만(STRICT_END, 느낌표만 허용) 뺀다('…불가능합니다? 저희는 가능합니다', '…피하는 게 좋아요, 저희는 3일이면 됩니다'는 아니다, 15l).
const CLAUSE_END='[.~\\s]*(?:[,，;；·ㆍ\\u119E+|!?()（）]|\\s[-–—/]\\s)?$',STRICT_END='[.~\\s]*!?$';
const WAIT_CAUTION_KO='(?:(?:법\\s?|법률\\s?|가맹사업법\\s?)?(?:위반|불법|위법)(?:입니다|이에요|예요|이다|임|행위(?:입니다|예요|이다))|(?:신고|제재|처벌|과태료|과징금|시정\\s?(?:명령|조치)|단속)\\s?(?:대상|사유)(?:입니다|이에요|예요|이다|임|이\\s?됩니다)|신고(?:해\\s?주세요|해\\s?주십시오|하세요|하십시오|하시기\\s?바랍니다|할\\s?수\\s?있(?:습니다|어요)|하실\\s?수\\s?있(?:습니다|어요))|(?:피하|조심하|주의하|의심하|의심해\\s?보|경계하|멀리하|거절하|거부하|미루)(?:세요|십시오|셔야\\s?(?:합니다|해요))|(?:거절|거부)하셔도\\s?(?:됩니다|돼요|괜찮(?:습니다|아요))|면\\s?안\\s?(?:됩니다|돼요|되요)|(?:말|안내|주장|설명|광고|이야기|얘기|정보)\\s?(?:은|는|도)\\s?(?:모두\\s?|전부\\s?)?(?:거짓|허위|사실이\\s?아닙니다|잘못된\\s?(?:것|정보|안내|말)|잘못|틀린\\s?(?:말|것|정보))(?:입니다|이에요|예요)?|후회하(?:는|시는)\\s?(?:사례|분|경우|일)(?:가|이|도)?\\s?(?:많|있|적지\\s?않|늘)(?:습니다|어요|아요)|(?:권하|권유하|요구하|강요하|제안하|유도하|종용하)지\\s?(?:않(?:습니다|아요|음)|마세요)|응하지\\s?(?:않(?:습니다|아요|음)|못합니다)|(?:계약|체결|서명|입금|납부)\\s?(?:을\\s?)?(?:하실|하시|할|하)?\\s?수\\s?(?:는\\s?|도\\s?)?없(?:습니다|어요|음)|(?:계약|체결|서명|입금)\\s?(?:하는|하시는|을\\s?하는)\\s?(?:일|경우)\\s?(?:은|는|이)?\\s?(?:절대\\s?)?없(?:습니다|어요|음)|필요\\s?(?:가|는)?\\s?없는\\s?(?:경우|때)\\s?(?:는|은)?\\s?없(?:습니다|어요|음)|(?:하|되|시)?면\\s?(?:어떻게|어찌)\\s?(?:되나요|될까요|됩니까|되죠|돼요))';
const WAIT_CAUTION_EN='(?:[Dd]o|[Dd]oes|[Ww]ill|[Cc]an|[Ww]e)\\s?(?:not|n\'t)\\s+(?:offer|allow|accept|permit|provide|do|sign|take)|[Nn]ever\\s+(?:offer|allow|accept|sign|take)';
// 같은 절에 권유·압박('바로 계약하지 않으면 후회하는 사례가 많습니다', '가계약금 넣어 두시고 자리 뺏기지 않게 주의하세요', '14일 기다리다 자리 놓치는 일은 피하세요',
// '대기기간 없이 계약 가능하니 … 주의하세요')이 있으면 경고·반박 끝이 아니다(레드팀 반영 뒤 재검토). '자문을 받지 않으면', '14일이 지나지 않으면'은 압박이 아니다. 양보 뒤 면책('본사 지정 변호사가 7일 만에 끝내 드리지만 강요하지 않습니다')도 권유다(블라인드 레드팀 2차).
const CAUTION_PRESSURE='(?:(?<!(?:자문|변호사|거래사)[^.\\n]{0,6})(?<!(?:지나|경과하|끝나|채우|받|거치)\\s?)(?:지\\s?않(?:으면|으시면)|안\\s?(?:하시면|하면|내시면|내면|넣으시면|넣으면))|(?:놓치|뺏기|빼앗기|밀리|넘어가|뒤처지|헷갈리|늦)(?:시)?지\\s?않(?:게|도록)|늦(?:으면|으시면|기\\s?전)|미루(?:면|시면)|망설이(?:면|시면|다)|기다리(?:다|시다)|가능하(?:니|므로)|(?:지만|는데|으나)\\s?(?:절대\\s?|결코\\s?|굳이\\s?|전혀\\s?|억지로\\s?)?(?:강요|강제|권유|요구|종용)|(?:계약|입금|서명|체결|납부|결제|송금|사인)\\s?(?:을\\s?|를\\s?)?(?:하시고|해\\s?주시고)(?!\\s?(?:나서|난\\s?(?:뒤|후|다음))))';
// 따옴 반박('… 안 하시면 손해라는 말은 거짓입니다')은 절 안에 압박 낱말이 있어도 반박이다(압박 낱말은 반박하는 주장 안에 있다, 블라인드 레드팀 2차).
const WAIT_QUOTE_REBUT='(?:라는|다는|이라는|냐는)\\s?(?:말|안내|주장|광고|얘기|이야기|권유|제안|문구)\\s?(?:은|는|도)\\s?(?:모두\\s?|전부\\s?)?(?:거짓|허위|사실이\\s?아닙니다|잘못된\\s?(?:것|정보|안내|말)|틀린\\s?(?:말|것|정보)|(?:법\\s?)?위반|불법|위법)(?:입니다|이에요|예요|이다)?'+CLAUSE_END;
// '…는 것은 불가능합니다·안 됩니다·할 수 없습니다·금지돼 있습니다·허용되지 않습니다'로 끝나는 절(15k, 2026-09-26: '정보공개서를 받은 같은 자리에서 계약하는 것은 불가능합니다'). 대기기간 규칙에만 쓴다(15l).
// 15l(2026-09-26): '것'이 가리키는 행위가 계약·체결·서명·도장·가맹금 수령·납부여야 하고('당일 계약하시면 드리는 할인을 나중에 받는 것은 불가능합니다'는 아니다), 문장 끝이어야 한다(STRICT_END).
// '불가능하지는 않습니다', '불가능합니다만 …', 다른 브랜드와의 대비, 같은 절의 압박, 본사 쪽 자문자('본사 지정 가맹거래사 말고 다른 전문가에게 자문받는 것은 불가능합니다'), 계약 조건·혜택·할인,
// 가계약·선점·예약금 같은 우회 낱말('설명회 당일 가계약금을 받는 것은 불가능합니다'는 다른 날은 된다는 말로 읽힌다)은 아니다.
const IMPOSSIBLE_ACT=`(?:(?:가맹\\s?|본\\s?)?계약\\s?(?:을\\s?|를\\s?)?(?:체결\\s?|진행\\s?)?하|체결\\s?하|서명\\s?하|사인\\s?하|날인\\s?하|도장\\s?(?:을\\s?|를\\s?)?찍|(?<![가-힣])(?:가맹금|가맹비|가입비|교육비)\\s?(?:을|를)?\\s?(?:[가-힣]{1,4}\\s)?(?:받|내|입금하|납부하|결제하|송금하|수령하))(?:시)?는`;
const WAIT_IMPOSSIBLE_END=`^(?![^\\n]*?(?:${CAUTION_PRESSURE}|다른\\s?(?:브랜드|곳|본사|본부|업체|가맹\\s?본부)|타\\s?(?:브랜드|사|업체|본사)|경쟁\\s?(?:사|업체|브랜드)|(?:전속|소속|지정|제휴|파트너|연계|협력|전담|직속|추천|소개)\\s?(?:사\\s?|한\\s?|된\\s?)?${ADVISOR}|하셔야|하시면|넣으시면|드리는\\s?\\d|할인|혜택|특전|우대|사은품|증정|(?<![가-힣])가\\s?계약|선점|홀딩|예약금|예치금|착수금|선입금|선납|우선\\s?(?:협상|순위)))`
 +`[^\\n]*?${IMPOSSIBLE_ACT}\\s?(?:것|건|거|일)\\s?(?:은|는|이|도)?\\s?(?:절대(?:로)?\\s?|법적으로\\s?|법상\\s?|현행법상\\s?|가맹사업법상\\s?|법으로\\s?|법에\\s?따라\\s?)?`
 +`(?:불가능(?:합니다|해요|하다|함|입니다|이에요)?|불가(?:합니다|해요|입니다|예요|이다|함)?|안\\s?(?:됩니다|돼요|되요)|(?:할|하실|받을|받으실)\\s?수\\s?(?:는\\s?)?없(?:습니다|어요|음)|금지(?:돼|되어)\\s?있(?:습니다|어요|음)|금지(?:됩니다|입니다|예요|돼요|임)|허용(?:되지|이\\s?되지)\\s?않(?:습니다|아요|음))${STRICT_END}`;
// 새 주의 끝(15k '피하는 게 좋아요·조심하는 게 좋습니다')은 따온 권유('…라는·하자는·다는 곳은')를 피하라고 할 때만, 문장 끝에서만 뺀다(15l).
// '본사 제휴 가맹거래사 말고 다른 곳에서 자문받는 건 피하는 게 좋습니다', '…안 쓰는 곳은 피하는 게 좋아요', '…라는 곳은 피하는 게 좋아요, 저희는 3일이면 됩니다'는 아니다.
// 따온 권유가 돈을 걸지 않고·없이 계약하라는 말이면('가계약금을 걸지 않고 계약하라는 곳은 피하는 게 좋아요') 그 권유를 피하라는 것은 돈을 걸라는 말이라 빼지 않는다(PAY_NEGATED).
// 계약 행위를 피하라는 모양('계약하는 건 피하는 게 좋아요')은 '가계약금을 걸지 않고 계약하는 건 피하는 게 좋아요'를 함께 빼서 넣지 않는다(1393089처럼 막는다, 알려진 오탐).
const AVOID_BETTER='(?:피하|조심하|주의하|의심하|경계하|멀리하|거르|거절하|거부하)(?:시)?는\\s?(?:게|것이|편이)\\s?(?:좋(?:아요|습니다|겠습니다|겠어요|죠|지요)|낫(?:습니다|죠|지요)|나아요|안전(?:합니다|해요))';
const QUOTED_PLACE='(?:라는|자는|다는|냐는)\\s?(?:곳|업체|본사|본부|브랜드|회사|분|사람|영업\\s?사원|컨설턴트|상담사)(?:은|는|이|도)?\\s?';
const PAY_NEGATED='(?:계약금|예약금|보증금|예치금|선점금|선입금|착수금|확보금|신청금|홀딩비|선점비|가맹금|가맹비|가입비|교육비|입금|선납|(?<![가-힣])가\\s?계약)\\s?(?:을|를|은|는|도)?\\s?(?:(?:먼저|미리|굳이|꼭)\\s?)?(?:안\\s?(?:걸|내|넣|주|보내|입금|결제|하)|(?:걸|내|넣|주|보내|입금하|결제하|납부하|하)지\\s?(?:않|말)|없이)';
const NO_PRESSURE=`^(?![^\\n]*?${CAUTION_PRESSURE})[^\\n]*?`;
const WAIT_CAUTION_END=`${NO_PRESSURE}(?:${WAIT_CAUTION_KO}${CLAUSE_END}|${QUOTED_PLACE}${AVOID_BETTER}${STRICT_END}(?<!${PAY_NEGATED}[^\\n]*))|${WAIT_CAUTION_EN}|${WAIT_QUOTE_REBUT}|${WAIT_IMPOSSIBLE_END}`;
// 본사 연계 자문 규칙만: 자문자 선택이 자유롭다·의무가 아니라는 문장('본사가 추천한 가맹거래사를 꼭 이용하실 필요는 없습니다', '다른 변호사를 고르셔도 됩니다').
// 자문자를 목적어로 쓴 문장만 본다('본사 지정 가맹거래사 자문 받으시면 7일이라 다른 변호사 찾으실 필요 없습니다', '… 강요하지 않습니다'만 붙인 권유는 아니다).
const CAPTIVE_OBJ=`(?:${ADVISOR}|자문\\s?(?:인|자))(?:\\s?님)?`,FREE_OK='(?:됩니다|돼요|괜찮(?:습니다|아요))';
const CAPTIVE_FREE_END=`(?:${CAPTIVE_OBJ}\\s?(?:을|를|에게|에게서|께|한테|으로|로)?\\s?(?:만\\s?)?(?:자문\\s?(?:을\\s?|를\\s?)?)?(?:꼭\\s?|반드시\\s?|굳이\\s?|무조건\\s?)?(?:이용|사용|선택|선임|쓰|써|받|맡기|맡겨|거치|거쳐)[^.\\n]{0,12}?`
 +`(?:(?:의무|필요|조건|이유|강제성)\\s?(?:는|은|가|이|도)?\\s?(?:전혀\\s?)?(?:없(?:습니다|어요|음)|아닙니다)|(?:것|건|거)\\s?(?:은|는)?\\s?아닙니다|(?:강요|강제|요구|권유)하지\\s?않(?:습니다|아요|음))`
 +`|(?:다른|원하시는)\\s?${CAPTIVE_OBJ}\\s?(?:을|를|으로|로)?\\s?(?:자유롭게\\s?|직접\\s?)?(?:고르|선택하|선임하|찾으|정하)셔도\\s?${FREE_OK}`
 +`|${CAPTIVE_OBJ}\\s?(?:은|는|도)\\s?(?:자유롭게|직접|원하시는\\s?(?:분|곳)으로)\\s?(?:고르|선택하|선임하|찾으|정하)셔도\\s?${FREE_OK})${CLAUSE_END}`;
// 본사 연계 자문 규칙의 경고 끝(15l, 2026-09-26): 1393089까지의 끝과 따옴 반박, 그리고 새 주의 끝은 따온 권유('…라는 곳은 피하는 게 좋아요')일 때만 뺀다. '…는 것은 불가능합니다'는 이 규칙의 면제가 아니다
// ('본사 지정 가맹거래사 말고 다른 전문가에게 자문받는 것은 불가능합니다', '본사 추천 가맹거래사를 거치지 않고 계약하는 것은 불가능합니다'는 본사 연계 자문을 강제하는 말이다).
// 따온 권유 앞에 '…말고·외에·아닌 다른·외부', '…안 쓰는·거치지 않고·자문 없이'가 있으면('본사 지정 가맹거래사 말고 다른 곳에서 자문받으라는 곳은 피하는 게 좋아요') 새 주의 끝으로 빼지 않는다.
const CAPTIVE_OTHER=`(?:말고|외에|외의|외|빼고|아닌)\\s?(?:다른|외부|딴)|(?:안\\s?(?:쓰|거치|통하|이용하|받)|(?:쓰|거치|통하|이용하|받)지\\s?않)(?:고|는|아도)|${ADVISOR}(?:\\s?님)?\\s?(?:자문\\s?)?없이`;
const CAPTIVE_CAUTION_END=`${NO_PRESSURE}(?:${WAIT_CAUTION_KO}${CLAUSE_END}|${QUOTED_PLACE}${AVOID_BETTER}${STRICT_END}(?<!(?:${CAPTIVE_OTHER})[^\\n]*))|${WAIT_CAUTION_EN}|${WAIT_QUOTE_REBUT}`;
// 본사가 지정·연결·소개·섭외한 자문자·자문(본사 연계 자문, H4): '본사가 지정한 가맹거래사', '본사에서 연결해 드리는 변호사', '저희가 소개한 가맹거래사', '가맹거래사는 본사가 붙여 드리니',
// '저희 쪽 가맹거래사님께 확인받으시면 7일', '가맹거래사 자문 확인서는 본사에서 발급해 드립니다'.
// '본사와 관계없는 변호사', '본사는 자문자를 지정하지 않습니다', '본사가 지정한 가맹거래사는 없습니다'(부정)는 아니다. 자문료는 ADVICE_FEE 규칙이 본다.
// '본사와 제휴한 가맹거래사'(본사와 + 제휴·연결·협약)도 본다(블라인드 레드팀 2차). '본사와 무관한 변호사'는 아니다.
// 본사 쪽 자문자를 '… 가 아닌' 독립 자문자와 대비해 독립 자문자에게 자문을 받으라고 권하는 문장('본사와 제휴한 가맹거래사가 아닌, 직접 고른 전문가에게 자문을 받으세요')은 본사 연계 자문이 아니다(15k, 2026-09-26).
// 15l(2026-09-26): 독립 자문자 뒤에는 '…에게(서)·께·한테 (계약서·정보공개서 같은 낱말 두 개까지) 자문·검토·상담·조언·확인을 받으세요·구하세요·받으시길 권합니다·받으시는 게 좋습니다'만 받는다.
// 15k의 25자 창(깎아내리는 말 목록 밖)은 '… 받으시면 2주 기다리셔야 하니 참고하세요', '… 확인서 발급이 되지 않으니 유의하세요', '… 비용은 본인 부담이니 참고하세요'를 뺐다. 참고하세요·유의하세요·알아두세요는 권하는 끝이 아니다.
// '… 아닌 분은 14일을 기다리셔야 합니다', '… 아닌, 직접 고른 전문가는 7일 단축이 안 됩니다'도 아니다.
const INDEPENDENT_ADVISOR=`(?:(?:(?:본인|점주님|예비\\s?점주님)(?:이|께서)|가맹\\s?희망자가|스스로|직접|따로)\\s?(?:고른|고르신|선택한|선택하신|찾은|찾으신|선임한|선임하신|정한|정하신|알아본|알아보신|구한|구하신)|독립(?:된|적인)|본사와\\s?(?:무관한|관계\\s?없는|관계가\\s?없는|이해\\s?관계가?\\s?없는|상관\\s?없는|연관\\s?없는)|중립적인|제3자인?)\\s?(?:[가-힣]{1,6}\\s)?(?:전문가|변호사|가맹\\s?거래사|거래사|자문(?:인|자|사)|법률\\s?전문가|법무\\s?법인|로펌)(?:\\s?님)?`;
const ADVICE_TAKE='(?:에게서|에게|께|한테)\\s?(?:(?!늦|비용|비싸|기다|추가)[가-힣]{1,8}\\s){0,2}?(?:자문|검토|상담|조언|확인)(?:을|를)?\\s?(?:받으|받|구하)(?:세요|십시오|시길\\s?(?:권합니다|권해\\s?드립니다|바랍니다)|시기\\s?바랍니다|시는\\s?(?:게|것이)\\s?(?:좋|낫|안전)[가-힣]{0,4}|는\\s?(?:게|것이)\\s?(?:좋|낫|안전)[가-힣]{0,4})';
const NOT_HQ_ADVISOR=`(?!(?:\\s?님)?\\s?(?:이|가)\\s?아닌\\s?[,，]?\\s?${INDEPENDENT_ADVISOR}\\s?${ADVICE_TAKE}\\s*[.!~]?\\s*$)`;
const HQ_ARRANGE='(?:지정|추천|소개|연결|선정|섭외|주선|알선|매칭|배정|제휴|협약|위촉|제공)';
const CAPTIVE_ARRANGED=[
 `${HQ}\\s?(?:가|이|와|과|에서|측에서|쪽에서|측이|쪽이)?\\s?(?:직접\\s?)?${HQ_ARRANGE}\\s?(?:한|하는|해\\s?(?:드린|드리는|준|주는|드릴|줄|놓은|둔)|된|하신|드린|드리는)?\\s?(?:${ADVISOR}|자문(?:\\s?(?:자|사|인|단|위원|서비스))?(?!\\s?(?:료|비|수수료|절차|제도|방법|요건|확인서|기간|여부|의\\s?의미)))(?:\\s?님)?${NOT_HQ_ADVISOR}`,
 `${ADVISOR}(?:\\s?님)?\\s?(?:은|는|을|를|도)?\\s?${HQ}\\s?(?:가|이|에서|측에서|쪽에서)\\s?(?:직접\\s?)?(?:연결|소개|매칭|배정|지정|붙여|섭외|주선|알선|추천|선정)`,
 `${HQ}\\s?(?:쪽|측)(?:\\s?의)?\\s?${ADVISOR}(?:\\s?님)?[^.\\n]{0,25}?(?:${WEEK}|단축|줄어|줄여|빨라)`,
 `(?:자문|${ADVISOR})\\s?(?:자문\\s?)?확인서\\s?(?:는|은|를|을|도)?\\s?${HQ}\\s?(?:에서|가|이|측에서|쪽에서)?\\s?(?:직접\\s?|대신\\s?)?(?:발급|작성|준비|만들|써|대신|챙겨)|${HQ}\\s?(?:에서|가|이|측에서|쪽에서)?\\s?(?:직접\\s?|대신\\s?)?(?:자문|${ADVISOR})\\s?(?:자문\\s?)?확인서\\s?(?:를|을|도)?\\s?(?:발급|작성|준비|만들어|써\\s?드|대신|챙겨)`,
].join('|');
// 표현 목록을 정규식 원문 19,200자 안의 묶음으로 나눈다(순서 유지, V8 최적화 한계 20,480자 아래). 묶음 수만큼 문장마다 정규식을 한 번 더 돌리므로(짧은 문장 수천 개 입력)
// 한계 안에서 크게 묶는다(블라인드 레드팀 2차에서 18,000자로는 묶음이 6개가 되어 '대기기간? '×4000 판정이 약 15% 느려졌다).
const packRegex=(list:readonly string[],limit=19200):string[]=>list.reduce<string[]>((out,x)=>{const last=out.length?out[out.length-1]:'';if(last&&last.length+1+x.length<=limit)out[out.length-1]=last+'|'+x;else out.push(x);return out},[]);
// '14일이 지나면 바로 계약', '대기기간이 끝나면 바로 계약'의 '바로'는 기간이 지난 뒤다(이른 계약이 아니다).
const WAIT_ELAPSED='(?<!(?:14\\s?일|2\\s?주|두\\s?주|보름|열나흘|(?:대기|숙려)\\s?기간)\\s?(?:이|가|을|를)?\\s?(?:다\\s?)?(?:지나(?:면|서|고|야)|지난\\s?(?:뒤|후|다음)(?:에)?|끝나(?:면|고|야)|끝난\\s?(?:뒤|후|다음)(?:에)?|경과(?:하면|\\s?후|\\s?뒤|한\\s?(?:뒤|후))|(?:이\\s?)?후(?:에)?|뒤(?:에)?|되면|채우면|채우시면)\\s?)';
const MATCHERS:Record<string,ClaimMatcher>={
 // hard_block. 수치 자체를 막는다(보장 표현이 아니어도, 부정문이어도 막는다: 판정기 FIGURE_IDS). 금액·비율 단위가 붙은 수치만 본다.
 // 앞머리 없는 '매출 N원'은 만·억 단위 금액만 본다('매출 7천만원 브랜드', '매출이 월 5천만원'). 영업이익·마진율·이익률·공헌이익, 영어 'monthly sales 50M KRW'도 같다.
 'h.revenue_figures_no_ad':{title:'매출·수익률 수치 광고(H6)',match:[
  `(?:${PERIOD}|${REV_SUBJ})\\s?(?:평균\\s?)?(?:매출액|매출(?!액)|매상|판매액)(?:이|은|는|도)?${SHARE}(?!\\s?\\d+\\s?위)${NO_RANK}{0,10}?(?:${MONEY}|${MONEY_EN}|${BARE_N})${NOT_REVENUE}`,
  `(?<![가-힣])(?:매출액|매출(?!액)|매상|판매액)(?:이|은|는|도)?${SHARE}(?!\\s?\\d+\\s?위)${NO_RANK}{0,8}?${BIG_MONEY}${NOT_REVENUE}`,
  // 금액이 앞에 오는 매출('월 5천만원 매출 올리는 가맹점', '1억 매출 신화'), 단위 없이 말로 쓴 매출('일매출 300 찍는 매장').
  `(?:${PERIOD_AT}|${REV_SUBJ})\\s?(?:${BIG_MONEY}|${MONEY_EN})\\s?원?\\s?(?:이상\\s?|넘는\\s?|의\\s?)?(?:매출액|매출|매상|판매액)${NOT_REVENUE}`,
  `(?<![\\d,.])${BIG_MONEY}\\s?원?\\s?(?:이상\\s?)?(?:매출|매상)\\s?(?:신화|달성|돌파|기록|올리|찍|나오|나와|내는|가맹점|매장|점포|브랜드)`,
  `(?:${PERIOD}|${REV_SUBJ})\\s?(?:평균\\s?)?(?:매출|매상)\\s?(?:이|은|는)?\\s?${BARE_N}\\s?(?:이상\\s?|넘게\\s?|씩\\s?)?(?:찍|나오|나와|넘|돌파|달성|올리|기록)`,
  `매출액${SHARE}\\s?${MONEY}${NOT_REVENUE}`,
  `(?:영업\\s?이익(?:률|율)?|이익\\s?(?:률|율)|(?<!(?:노|착한|제로|공급|유통|본사|물류)\\s?)마진\\s?(?:률|율)?|수익률|공헌\\s?이익(?:률|율)?)${SHARE}${RATE_GAP}(?:${MONEY}|${MONEY_EN})${NOT_REVENUE}`,
  `(?:[Mm]onthly|[Aa]nnual|[Yy]early|[Dd]aily|[Aa]verage|[Aa]vg\\.?)\\s+(?:gross\\s+)?(?:sales|revenues?)\\s?(?:of|:)?\\s?(?:${MONEY}|${MONEY_EN})|(?:[Ss]ales|[Rr]evenues?)\\s?[:：]?\\s+(?:of\\s+)?${MONEY_EN}`,
  // 영어 낱말 뒤 한국어 수치('Sales 월 5천 넘는 매장'), 금액이 먼저 오고 매출로 끝나는 문장('월 1억, 저희 강남점 매출입니다', '4,200만원. 저희 1호점 한 달 매출입니다.').
  `(?<![A-Za-z])(?:[Ss][Aa][Ll][Ee][Ss]|[Rr]evenues?|REVENUES?)(?![A-Za-z])\\s?[:：]?\\s?(?:${PERIOD}\\s?)?(?:${BIG_MONEY}|${KO_NUM}|${BARE_N})${NOT_REVENUE}`,
  `(?<![\\d,.])(?:${PERIOD_AT}\\s?)?${BIG_MONEY}\\s?원?\\s?[.,!]?\\s?[^.\\n]{0,20}?(?:매출액|매출|매상)\\s?(?:입니다|이에요|예요|이죠|이다|임|이랍니다)`,
 ].join('|'),recruitmentMatch:[
  // 모집 범위만: 매출 명사가 앞 절이고 수치가 쉼표 뒤('매출 그래프 보시면 압니다, 월 7~8천'), 묻고 답하는 수치('하루 매출? 평일도 3백은 기본'),
  // 매출 명사 없이 기간 뒤 큰 금액이 매장·나온다·찍는다와 함께('테이크아웃 매장도 월 6천은 나옵니다', '월 5천 매장 수두룩', '월 천 찍는 매장'). 개수 단위가 붙으면 아니다.
  `(?:매출액|매출|매상)(?![^.\\n]{0,3}\\d+\\s?(?:위|등))[^.,\\n]{0,20}[,，]\\s?${PERIOD_AT}\\s?(?:\\d[\\d,.]*\\s?[~\\-]\\s?)?(?:${BIG_MONEY}|${KO_BARE})${NOT_COUNTED}${NOT_REVENUE}`,
  `(?:매출액|매출|매상)[^?\\n]{0,20}\\?\\s?(?:[가-힣]{1,4}\\s)?(?:${PERIOD_AT}\\s?)?(?:평균\\s?|약\\s?|보통\\s?)?(?:${BIG_MONEY}|${KO_BARE}|${BARE_N})${NOT_COUNTED}${NOT_REVENUE}`,
  `(?<![\\d가-힣])(?:월|매월|매달|한\\s?달(?:에)?|하루)\\s?(?:평균\\s?)?(?:${BIG_MONEY}|${KO_NUM})(?:\\s?만)?(?:\\s?원)?(?:\\s?[~\\-]\\s?(?:${BIG_MONEY}|${KO_NUM})(?:\\s?만)?(?:\\s?원)?)?${NOT_COUNTED}\\s?(?:은|는|이|가|도|씩|이상|넘게|넘는|정도|까지)?\\s?(?:꾸준히\\s?|안정적으로\\s?|거뜬히\\s?|기본으로\\s?|무난히\\s?|평균\\s?|늘\\s?)?(?:나옵|나와|나오는|나온|찍|매장|점포|가게|가맹점)${NOT_REVENUE}`,
  // R2 5차 재검토: 매출 뒤 단위 없는 수가 찍혔다·넘었다('1호점 첫 달 매출 6,300 찍었습니다'), 매출 뒤 기간과 단위 없는 수('배달 앱 매출 월 1,500'),
  // 매출 명사 뒤 절 안의 기간 금액('매출 상위 10% 가맹점 월 평균 9천'). 날짜('매출 12월 결산')·차수·순위는 아니다.
  `(?<![가-힣])(?:매출|매상)\\s?(?:이|은|는|도)?\\s?${BARE_N}(?!\\s?(?:월|차|번째|기))\\s?(?:이상\\s?|넘게\\s?)?(?:찍|나오|나와|넘|돌파|달성|기록|올리|올렸)`,
  `(?<!${COST_BEFORE}[^.\\n]{0,15})(?<![가-힣])(?:매출|매상)\\s?(?:은|는|이|:)?\\s?${PERIOD}\\s?(?:평균\\s?)?(?:${BARE_N}(?!\\s?(?:월|차|번째|기))|${KO_NUM})${NOT_COUNTED}${NOT_REVENUE}`,
  `(?<!${COST_BEFORE}[^.\\n]{0,15})(?:매출액|매출|매상)${SHARE}(?!\\s?(?:과|와|에)?\\s?(?:관계|무관|상관|연동|대비|비례))(?![^.\\n]{0,3}\\d+\\s?(?:위|등))[^.,\\n]{0,25}?(?<![\\d가-힣])(?:월|매월|매달|한\\s?달|연|연간)\\s?(?:평균\\s?)?(?:${BIG_MONEY}|${KO_BARE}|${KO_NUM})${NOT_COUNTED}${NOT_REVENUE}`,
 ].join('|')},
 // '이번 달 판매 순수익의 10%를 기부합니다', '9월 수익금의 10%', '12월 수입 원두', '1개월 이내 회수해 세척', '3개월 회수 텀블러'는 수익·회수 수치가 아니다(투자 문맥과 기간 수치가 있어야 회수).
 'h.net_profit_payback_claims':{title:'순수익·투자금 회수 수치(H6)',match:[
  `${PROFIT}${SHARE}${NO_RANK}{0,8}?(?:${MONEY}|${MONEY_EN}|${KO_BARE}|${BARE_N})${NOT_REVENUE}`,PROFIT_AFTER,EARN,
  `${PAYBACK_BASE}[^.\\n]{0,12}?${PERIOD_N}[^.\\n]{0,8}?${RECOVER}`,
  `${PERIOD_N}\\s?${PAYBACK_AT}?\\s?${PAYBACK_BASE}\\s?(?:을|를|이|가)?\\s?(?:전액\\s?|모두\\s?|전부\\s?|싹\\s?(?:다\\s?)?|몽땅\\s?|다\\s?)?${RECOVER}`,
  // 기간이 먼저 오는 문장('8개월. 투자금 회수까지 걸린 시간입니다.'), 금액이 먼저 오고 순수익으로 끝나는 문장('600만원, 이게 우리 점주님 평균 순수익입니다'),
  // '투자 회수 기간 업계 최단 7개월', 영어 'payback'이 뒤에 오는 기간('1년 안에 payback'). R2 4차 재검토.
  `^\\s?${PERIOD_N}\\s?[.!]\\s?${PAYBACK_BASE}\\s?(?:을|를|이|가)?\\s?${RECOVER}(?:까지|하는\\s?데|에)`,
  `(?<![\\d,.])(?:${PERIOD_AT}\\s?)?${BIG_MONEY}\\s?원?\\s?[.,!]?\\s?[^.\\n]{0,20}?(?:${NET_NOUN}|수익(?!금|률))\\s?(?:입니다|이에요|예요|이죠|이다|임|이랍니다)`,
  `투자\\s?(?:금\\s?)?회수\\s?기간\\s?(?:은|는|이)?[^.,\\n]{0,12}?${PERIOD_N}`,
  `${PERIOD_N}\\s?(?:만에|안에|이내|내|이면|면)?\\s?(?:[Pp]ay\\s?-?back|PAYBACK|[Bb]reak[-\\s]?even|BREAK[-\\s]?EVEN)(?![a-z])`,
  // '1년이면 본전입니다', '석 달이면 본전', '회수까지 딱 8개월(창업비용)'.
  `${PERIOD_N}\\s?${PAYBACK_AT}?\\s?(?:바로\\s?)?본전`,
  `(?<=${PAYBACK_BASE}[^.\\n]{0,20})회수\\s?(?:까지|까진|하는\\s?데|에|는|은)\\s?(?:[은는이가]\\s?)?(?:딱|약|평균|단|불과|겨우|고작|최소)?\\s?${PERIOD_N}|회수\\s?(?:까지|까진|하는\\s?데)\\s?(?:[은는이가]\\s?)?(?:딱|약|평균|단|불과|겨우|고작|최소)?\\s?${PERIOD_N}(?=[^.\\n]{0,30}${PAYBACK_BASE})`,
  // 'BEP 4개월', '4개월 만에 BEP', '투자 대비 250% 수익'.
  `(?<![A-Za-z])(?:BEP|B\\.E\\.P\\.?)\\s?[:：]?\\s?(?:달성\\s?)?(?:까지\\s?)?(?:약\\s?|평균\\s?|단\\s?)?${PERIOD_N}|${PERIOD_N}\\s?(?:만에|안에|이내|내|만)?\\s?BEP`,
  `투자\\s?(?:금\\s?|비\\s?|비용\\s?|원금\\s?)?대비\\s?(?:(?:연|월|평균)\\s?)?(?:수익률?\\s?|이익률?\\s?|수익률은\\s?)?\\d[\\d,.]*\\s?(?:%|퍼센트|배)`,
  `${PAYBACK_BASE}\\s?(?:을|를)?[^.\\n]{0,8}?${RECOVER}[^.\\n]{0,10}?${PERIOD_N}`,
  // 손에 남는 돈의 금액('인건비·월세 다 빼고 손에 남는 돈 월 480'). 비율('매출 대비 남는 돈 35%')은 안전망 경고에 맡긴다(R2 5차 재검토).
  // 통장에 꽂히는 금액('점주님 통장에 매달 400 꽂힘', '매달 통장에 500씩 꽂히는 구조').
  `(?<!${COST_BEFORE}[^.\\n]{0,15})(?:(?:${PERIOD_AT}\\s?)?(?:통장|계좌)(?:에|으로|로)\\s?(?:${PERIOD_AT}\\s?)?)(?:${BIG_MONEY}|${KO_BARE}|${BARE_N})(?:\\s?원)?\\s?(?:씩\\s?)?(?:꽂|찍히|찍혀|들어\\s?(?:오|와|옵)|입금\\s?(?:되|돼|됩))`,
  `(?:손에\\s?)?(?:순\\s?)?(?:남는|쥐는|떨어지는)\\s?(?:돈|금액)\\s?(?:은|이|만|:)?\\s?(?:(?:월|매달|매월|한\\s?달|하루|연)(?:\\s?에)?(?:\\s?평균)?\\s?)?(?:평균\\s?|약\\s?|최소\\s?)?(?:${BIG_MONEY}|${MONEY_EN}|${KO_BARE}|${BARE_N})${NOT_COUNTED}${NOT_REVENUE}`,
  `손익\\s?분기(?:점)?[^.\\n]{0,10}?${PERIOD_N}|${PERIOD_N}[^.\\n]{0,6}?손익\\s?분기`,
  `(?:회수|페이백)\\s?기간\\s?(?:은|는|이)?\\s?[:：]?\\s?(?:약\\s?|평균\\s?)?${PERIOD_N}`,
  `R[O0]I\\s?[:：]?\\s?(?:(?:연|월|평균|약|최소|최대|무려)\\s?){0,2}\\d|[Pp]ay\\s?-?back\\s?(?:period\\s?)?(?:of\\s?|in\\s?|:\\s?)?\\d+\\s?(?:개월|년|months?|years?)|[Bb]reak[-\\s]?even\\s?(?:in\\s?|:\\s?)?\\d+\\s?(?:개월|년|months?|years?)`,
 ].join('|'),recruitmentMatch:[
  // 모집 범위만: 버는 돈·순수익을 묻고 수치로 답하는 문장('점주님들 한 달에 얼마 버시냐고요? 평균 650').
  `(?:순?수익|순익|순이익|벌|버시|버는|번다|버세요|가져\\s?가)[^?\\n]{0,20}\\?\\s?(?:[가-힣]{1,5}\\s){0,3}(?:${PERIOD_AT}\\s?)?(?:평균\\s?|약\\s?|보통\\s?)?(?:${BIG_MONEY}|${KO_BARE}|${BARE_N})${NOT_COUNTED}${NOT_REVENUE}`,
 ].join('|')},
 // 가계약금·임시 계약금·선점금·홀딩비·우선협상 예치금·점포 개발 약정 보증금, 입지·지역 확보를 위한 예치, 가맹 계약의 '바로 계약·대기 없이·숙려기간 생략·14일 안 기다려도', 계약 즉시 오픈.
 // '전 가맹 매장에서 당일 픽업', '지역화폐 가맹 업소라 결제 즉시 캐시백', '가맹 상담 신청 즉시 연락', '점포별 예약금 선납 후 픽업', '오픈 기념 케이크 예약금 선납', '제휴 계약 카드로 결제하면 바로 할인',
 // '계약직 바리스타 즉시 근무', '단체 주문 계약 시 당일 배송', '백화점 입점 계약 마치고 바로 팝업 오픈', '가맹 계약 후 바로 교육', '가맹 계약서안은 상담 당일', '가맹 계약 해지 시 즉시 반환'은 대기기간 우회가 아니다.
 // '가계약금은 가맹금에 해당합니다'는 정의(같은 절 except), '가계약금 요구는 불법입니다'는 부정이다.
 // 대기기간 오기재(14일, 자문 시 7일보다 이른 계약·가맹금, 대기기간 선택·생략·협의·조정)는 more(WAIT_MISSTATED)에서 본다(대표 결정 3번 보완, 2026-09-26).
 // 레드팀 반영(2026-09-26): WAIT_MISSTATED_MORE(D+N·N일차·화살표·요일·Q&A·표·대기기간 중 가맹금·날짜 소급·폐지·적용 제외·형식적 자문)를 더하고, 절 끝의 경고·반박·법 설명('… 법 위반입니다', '… 피하세요',
 // '… 신고 대상입니다', '… 권하지 않습니다', '… 하면 어떻게 되나요')은 except(WAIT_CAUTION_END)로 뺀다(같은 절의 권유·압박 CAUTION_PRESSURE는 빼지 않는다). '14일이 지나면 바로 계약'의 '바로'는 WAIT_ELAPSED로 뺀다.
 // 블라인드 레드팀 2차(2026-09-26): WAIT_MISSTATED_2(문서 낱말 없는 짧은 기간 뒤 계약, 검토 기간 없이, 대기기간을 N일로·합의·요청·내부 정책으로 줄임, 한 문서 쪽 대기 없음, 정보공개서보다 먼저 받는 가맹금·예약금,
 // 자문 여부와 관계없는 7일, 같은 줄 Q&A)와 즉석·현장·같은 자리 계약, 계약 당일 함께 교부, 가입비·교육비 입금 뒤 정보공개서, 5~9영업일, 정공서를 더한다.
 'h.wait_bypass_solicitation':{title:'가계약금·바로 계약·대기기간 오기재 같은 대기기간 우회 유도',match:[
  '(?<![가-힣])가\\s?계약(?:\\s?금)?','임시\\s?계약금','선점\\s?(?:금|비|료)|홀딩\\s?(?:비|금|료)','(?:상권|입지)\\s?(?:선점|예약|확보|홀딩)\\s?(?:금|비|료)|(?:자리|지역|점포)\\s?(?:선점|확보|홀딩)\\s?(?:금|비|료)',
  '우선\\s?(?:협상|순위|배정)\\s?(?:보증금|예약금|예치금|계약금|금|비|권)','(?:입점|입지|개설|출점)\\s?(?:확정|확보|예약|선점)\\s?(?:금|비)','점포\\s?개발\\s?(?:약정\\s?)?(?:보증금|예치금|계약금|예약금)',
  `${DEPOSIT}[^.\\n]{0,25}?${SECURE}|${SECURE}[^.\\n]{0,25}?${DEPOSIT}`,'(?:가?계약금|선입금|[Dd]eposit)[^.\\n]{0,25}?자리\\s?(?:을|를)?\\s?(?:확보|선점|잡아|홀딩|예약|찜)',
  `(?:계약금|예약금|보증금|예치금)\\s?(?:을|를)?\\s?(?:선납|먼저|미리|선입금)(?=[^.\\n]{0,20}${DEPOSIT_CTX})|(?<=${DEPOSIT_CTX}[^.\\n]{0,20})(?:계약금|예약금|보증금|예치금)\\s?(?:을|를)?\\s?(?:선납|먼저|미리|선입금)`,
  `${TIMING_WAIT}[^.,\\n]{0,10}?(?:가맹\\s?)?(?:${FR_CONTRACT}|가맹금|계약금)`,`${WAIT_ELAPSED}${TIMING_FAST}[^.,\\n]{0,6}?(?:가맹\\s?)?${FR_CONTRACT}${CONTRACT_ACT}`,`${WAIT_ELAPSED}${TIMING_FAST}\\s?${FEE_WORD}\\s?(?:을|를|은|는)?\\s?(?:입금|납부|결제|송금|내(?!일)|걸|거세요|거시)|${FEE_WORD}\\s?(?:을|를|은|는)?\\s?${TIMING_FAST}\\s?(?:입금|납부|결제|송금|내(?!일)|걸|거)`,
  `(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:을|를|은|는|도|이)?\\s?${TIMING_FAST}\\s?(?:체결|진행|가능|완료|OK|서명|사인)`,
  `(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:하면|하시면|시|후|과\\s?동시에|체결\\s?(?:시|후|즉시)|당일)?\\s?${TIMING_FAST}(?:\\s?${TIMING_FAST})?[^.,\\n]{0,8}?(?:오픈|개점|개업|영업\\s?시작|창업|출점|매장\\s?운영)`,
  '14\\s?일\\s?(?:을\\s?|의\\s?)?(?:대기\\s?(?:기간\\s?)?)?(?:안\\s?기다려도|기다리지\\s?않(?:아도|고)|기다릴\\s?필요\\s?(?:없|가\\s?없)|없이|생략|건너뛰)|숙려\\s?기간\\s?(?:을\\s?)?(?:생략|없이|건너뛰)|대기\\s?기간\\s?(?:을\\s?)?(?:생략|건너뛰)',
  '[Ss]ign\\s+(?:today|now|immediately|instantly|same[-\\s]day)|(?:[Ii]nstant|[Ss]ame[-\\s]day|[Ii]mmediate)\\s+(?:contract|signing)|[Nn]o\\s+waiting\\s+period|[Ss]kip\\s+the\\s+wait',
  // 착수금·신청금·사전 계약금·선계약·약식 계약, '입점 보장금', 계약 뒤 정보공개서, '가맹 계약 즉시', 1~6일 만의 계약, '오늘 바로 사인'.
  '(?<![가-힣])(?:가맹\\s?)?착수금|사전\\s?계약금|선\\s?계약금|(?<![가-힣])선\\s?계약(?!\\s?(?:조건|내용|사항))|약식\\s?계약|(?:입점|입지|개설|출점)\\s?보장\\s?(?:금|비)',
  `정보\\s?공개서\\s?(?:는|은|를)?\\s?(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:체결\\s?)?(?:후|뒤|이후|다음)`,`(?:가맹\\s?)?${FR_CONTRACT}\\s?${TIMING_FAST}(?=\\s?(?:[!.~]|$))`,
  `(?:하루|이틀|사흘|나흘|닷새|엿새|(?<!\\d)[1-6]\\s?일)\\s?(?:만에|안에|이면|내|이내)\\s?(?:바로\\s?)?(?:가맹\\s?)?${FR_CONTRACT}`,
  `(?<!(?:확인서|수령증|영수증|동의서|신청서)에?\\s?)${TIMING_FAST}\\s?(?:바로\\s?)?(?:계약서에\\s?)?(?:사인|도장\\s?(?:을\\s?)?찍)`,'[Nn]o\\s+wait(?:ing)?(?![a-z])',
  // R2 4차 재검토: 가맹비 선결제와 지역 우선, 계약금을 걸어 두게 하는 자리·지역 선점('좋은 자리 금방 나가요, 계약금 걸어두세요', '계약금 50 걸면 우선 오픈'),
  // 상담 그 자리에서 계약, 서류·정보공개서보다 계약 먼저('서류는 천천히, 계약부터 하시죠', '정보공개서 검토는 계약하고 나서'), 대기기간 협의·무시('대기기간? 협의 가능합니다').
  `${FEE_PREPAY}[^.\\n]{0,25}?${SECURE}|${SECURE}[^.\\n]{0,25}?${FEE_PREPAY}`,
  `(?<=${HOLD_CTX}[^.\\n]{0,25})${HOLD_PAY}|${HOLD_PAY}(?=[^.\\n]{0,25}${HOLD_CTX})`,
  `${TIMING_SPOT}[^.,\\n]{0,6}?(?:가맹\\s?)?${FR_CONTRACT}${CONTRACT_ACT}`,
  `(?<=(?:서류|공개서)[^.\\n]{0,25})(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:을|를)?\\s?(?:부터|먼저)\\s?(?:하|진행|해|체결|사인|서명)|(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:을|를)?\\s?(?:부터|먼저)\\s?(?:하|진행|해|체결|사인|서명)(?=[^.\\n]{0,25}(?:서류|공개서))`,
  `정보\\s?공개서\\s?(?:는|은|를)?\\s?(?:검토|확인|수령|열람|설명)\\s?(?:는|은|를|도)?\\s?(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:체결\\s?)?(?:하고\\s?나서|한\\s?(?:후|뒤|다음)|하신\\s?(?:후|뒤|다음)|후|뒤|이후|다음)`,
  `(?:대기|숙려)\\s?기간\\s?(?:은|는|도|이|가|요)?\\s?\\??\\s?(?:협의${NEGOTIATE_DENIED}|신경\\s?(?:쓰지|안\\s?쓰|끄)|상관\\s?(?:없|안)|무시|패스)(?!\\s?(?:은|는|이|가|도)?\\s?(?:불가|안\\s?됩|어렵|없))`,
  // R2 5차 재검토: 입금·결제 순서로 자리·상권을 확정하는 표현('예치금 입금 순서로 확정합니다', '대기 순번은 입금 순입니다', '1순위 예약금 50만원'),
  // 입금하면 자리·상권을 지켜 주는 표현('지금 입금하시면 이 자리 다른 분께 안 넘어갑니다', '보증금 넣으시면 상권 보호 들어갑니다'), 금액을 먼저·미리 걸거나 보내게 하는 표현
  // ('보증금 100만원 먼저 걸어두시면', '오늘 가맹비만 먼저 보내주세요'), 계약 전에 낸 돈을 계약 때 차감하는 표현('30만원 선입금, 계약 시 차감'), 자리 킵·홀드 비용, 신청비로 상권 검토,
  // 가맹금을 받은 뒤 정보공개서를 주는 표현, 당일·원스톱 계약과 공개서 설명 N분 뒤 계약, 상담 N일 후 계약, '기다림 없는 창업'. 케이크·단체 주문 예약금은 아니다.
  // 입금 순서: 예치금·예약금을 입금한 순서, 자리·상권·지역·선착순과 함께 쓴 입금 순서, 대기·자리 순번의 입금 순('교육 일정은 입금 순서로 확정'은 아니다).
  `(?:${DEPOSIT}|가맹비|가맹금)\\s?(?:을|를)?\\s?(?:입금|납입|결제|송금|예치|이체)\\s?(?:순서|순번|순)\\s?(?:으로|로|대로)?\\s?(?:확정|배정|결정|선정|마감|우선|정해|드립)`,
  `(?<=(?:자리|상권|입지|지역|선착순|점포|우선)[^.\\n]{0,30})(?:입금|납입|결제|송금|예치|이체)\\s?(?:순서|순번|순)\\s?(?:으로|로|대로)?\\s?(?:확정|배정|결정|선정|마감|우선|정해|드립)|(?:입금|납입|결제|송금|예치|이체)\\s?(?:순서|순번|순)\\s?(?:으로|로|대로)?\\s?(?:확정|배정|결정|선정|마감|우선|정해|드립)(?=[^.\\n]{0,30}(?:자리|상권|입지|지역|선착순|점포|우선))`,
  `(?<=(?:대기|자리|상권|지역|오픈|출점|개설|예비\\s?(?:가맹\\s?)?점주)[^.\\n]{0,15})(?:순번|순서|순위)\\s?(?:은|는|이)?\\s?(?:입금|결제|납입|송금|이체)\\s?(?:순서|순)(?:입니다|이에요|예요|이다|임|으로|대로)?(?![가-힣])|(?<![\\d가-힣])\\d\\s?순위\\s?(?:가?계약금|예약금|보증금|예치금)`,
  `(?:(?:지금|오늘|먼저|미리)\\s?)?(?:(?:${DEPOSIT}|가맹비|가맹금)\\s?(?:을|를|만)?\\s?(?:\\d[\\d,.]*\\s?(?:만\\s?원?|천|원)?\\s?)?(?:넣으시면|넣으면|내시면|내면|거시면|걸면|보내\\s?주시면|입금하시면|입금하면)|(?:입금|송금|결제|이체)(?:하시면|하면|해\\s?주시면|\\s?시(?![가-힣])))[^.\\n]{0,25}?(?:자리|상권|입지|지역|순번)[^.\\n]{0,15}?(?:안\\s?넘어|안\\s?뺏|안\\s?나가|확보|확정|지켜|홀드|잡아|찜|보호|우선|배정|선점|맡아)`,
  `(?<!(?:케이크|주문|픽업|단체|도시락|파티|상품|제품|굿즈|대관|좌석|테이블|대여|렌탈|텀블러|컵|용기|반납)[^.\\n]{0,10})(?:가?계약금|예약금|보증금|예치금|가맹비|가맹금)\\s?(?:을|를|만)?\\s?(?:\\d[\\d,.]*\\s?(?:만\\s?원?|천|원)?\\s?)?(?:만\\s?)?(?:먼저|미리)\\s?(?:걸어\\s?(?:두|놓|주)|거세요|거시|걸면|넣어\\s?(?:두|놓)|입금|송금|보내|결제|납부)(?![^.\\n]{0,15}반납)`,
  `(?:${DEPOSIT}|선납)[^.\\n]{0,25}?계약\\s?(?:시|때|하시면|하면|후)\\s?(?:차감|공제|대체|전환)`,
  `(?:자리|상권|지역|입지|점포)\\s?(?:킵|[Kk]eep|홀드|찜|맡아\\s?두|잡아\\s?두)[^.\\n]{0,25}?(?:\\d|${DEPOSIT}|입금|비용|금액)|(?:${DEPOSIT}|입금)[^.\\n]{0,25}?(?:자리|상권|지역|입지)\\s?(?:킵|[Kk]eep|홀드|찜)`,
  '(?:신청비|신청금|예약금|예치금|검토비|접수비)[^.\\n]{0,25}?상권\\s?(?:검토|분석|조사|확인|배정)',
  // 돈을 내면 자리·상권을 잡아 주는 표현('50만원이면 상권 먼저 잡아드립니다', '자리 잡아드리는 데 50만원이면 됩니다').
  `(?<![\\d,.])\\d[\\d,.]*\\s?(?:만|천)\\s?원?\\s?(?:이면|만\\s?내시면|만\\s?있으면|으로|에)\\s?(?:[가-힣]{1,4}\\s)?(?:상권|자리|지역|입지)\\s?(?:을|를)?\\s?(?:먼저\\s?|미리\\s?)?(?:잡아|확보|선점|홀드|찜|맡아)|(?:상권|자리|지역|입지)\\s?(?:을|를)?\\s?(?:먼저\\s?|미리\\s?)?(?:잡아|확보|선점|홀드|찜|맡아)\\s?(?:드리|드립|주|둬|두)(?:는|기)?\\s?(?:데|비용|값|에)?\\s?(?:은|는)?\\s?\\d[\\d,.]*\\s?(?:만|천)\\s?원?`,
  '(?:가맹금|가맹비|계약금|예약금|보증금|예치금|가입비|교육비)\\s?(?:을|를)?\\s?(?:입금|결제|납부|송금)?\\s?(?:후|뒤|하신\\s?(?:후|뒤|다음)|하시면|확인\\s?(?:후|되면|시))[^.\\n]{0,12}?(?:정보\\s?)?공개서',
  `당일\\s?(?:가맹\\s?)?계약(?=\\s?(?:까지|도\\s|OK|ok|가능(?!\\s?(?:여부|한지|할까|하냐))|완료|진행|체결|원스톱|혜택|특가|이벤트|할인|시(?![가-힣])|하|해|[!~,]|$))|원스톱\\s?(?:가맹\\s?)?계약|(?:가맹\\s?)?${FR_CONTRACT}\\s?(?:까지\\s?)?원스톱|(?:정보\\s?)?(?:공개서|설명|상담|브리핑)\\s?(?:설명\\s?)?\\d+\\s?분\\s?(?:이면|만에|안에|컷|내)[^.,\\n]{0,20}?계약`,
  `(?:상담|설명회?|방문|공개서\\s?(?:수령|설명))\\s?(?:하루|이틀|사흘|나흘|닷새|엿새|(?<!\\d)[1-6]\\s?일)\\s?(?:후|뒤|후에|뒤에)\\s?(?:바로\\s?)?(?:가맹\\s?)?${FR_CONTRACT}`,
  '기다림\\s?(?:이\\s?)?없는\\s?(?:가맹|창업|계약)',
 ].join('|'),
  // 대표 결정 3번 보완(2026-09-26): 대기기간 오기재(위 WAIT_MISSTATED·WAIT_MISSTATED_MORE·WAIT_MISSTATED_2). 19,200자 안의 묶음으로 따로 컴파일한다(ClaimMatcher.more, packRegex).
  more:packRegex([...WAIT_MISSTATED,...WAIT_MISSTATED_MORE,...WAIT_MISSTATED_2]),consumerAlso:'가맹(?!\\s?(?:업소|가게|지점|매장|점포|카드|브랜드|점(?!주)))|가계약|창업|개설|출점|상권|입지|선점|홀딩|우선\\s?(?:협상|순위)|정보\\s?공개서|점주|본사|본부|오픈|개점|계약금|가맹금|[Dd]eposit|[Ss]ign|[Ff]ranchise|공개서',except:`가맹금에\\s?(?:해당|포함)|${WAIT_CAUTION_END}`},
 // 법정 대기기간 안내('14일(변호사·가맹거래사 자문시 7일)이 지나야', '자문으로 7일 뒤에 계약할 수 있습니다')는 제7조③을 옮긴 문장이라 막지 않는다. 본사 전속·지정·파트너·연계 자문과 '7일·일주일 만에 계약'만 본다.
 // 본사가 지정한·연결해 드리는·소개한·섭외한 자문자와 자문('본사가 지정한 가맹거래사 자문을 받으시면 7일로 줄어')도 본다(CAPTIVE_ARRANGED, 2026-09-26).
 // 레드팀 반영(2026-09-26): '저희 쪽 가맹거래사님께 확인받으시면 7일', 본사가 발급하는 자문 확인서도 본다. '7일 만에 계약할 수 있나요?'(묻는 문장), '7일 안에 계약 상담·계약 여부'는 아니다.
 // 절 끝의 경고·법 설명과 자문자 선택이 자유롭다는 문장('본사가 추천한 가맹거래사를 꼭 이용하실 필요는 없습니다', '다른 변호사를 고르셔도 됩니다', 자문자를 목적어로 쓴 문장만)은 except로 뺀다.
 // 소비자 범위의 '상담 후 7일 안에 계약하면 첫 주 무료'(정기배송 계약)는 가맹·자문 문맥이 없어 아니다.
 'h.captive_advisor_phrase':{title:'본사 전속 자문으로 7일 계약 같은 문구(H4)',match:[
  `${HQ}(?:에서|\\s?쪽(?:에서)?|\\s?측)?\\s?(?:의\\s?)?(?:전속|소속|지정|제휴|파트너|연계|협력|전담|직속|추천|소개)(?:\\s?사(?![가-힣]))?\\s?${ADVISOR}${NOT_HQ_ADVISOR}`,
  // 본사가 붙여 주거나 무료로 봐 주는 자문('본사에서 거래사님 붙여드려요', '본사 쪽 거래사님이 무료로 봐드려요'), 본사 없이 쓴 제휴·지정 자문('제휴 법무법인 무료 자문').
  `${HQ}(?:에서|\\s?쪽(?:에서)?|\\s?측)?\\s?(?:의\\s?)?${ADVISOR}(?:\\s?님)?(?:이|가|을|를)?[^.\\n]{0,12}?(?:붙여|연결|소개|매칭|배정|무료|봐\\s?드|봐\\s?줍|대\\s?드)`,
  `(?<![가-힣])(?:제휴|파트너|전속|지정|연계)\\s?${ADVISOR}${NOT_HQ_ADVISOR}`,
  `(?:${WEEK}\\s?(?:만에|안에|이면|면|내|이내|내에|만|컷!?)|(?:7\\s?days?|[Ss]even\\s+days|7\\s?-\\s?day)\\s?(?:[!,]\\s?)?)\\s?(?:바로\\s?)?(?:가맹\\s?)?계약(?!\\s?(?:해지|취소|철회|해제|종료))${WAIT_ABOUT}${WAIT_NOT_NEG}`,
  `${WEEK}\\s?(?:가맹\\s?)?계약(?=\\s?(?:[!.~]|$|패키지|가능|완료|OK|진행|체결|프로그램|제도|코스|시스템|트랙))`,
  // 자문 문맥의 '7일이면 끝'·'7일 만에 오픈'.
  `(?<=(?:자문|거래사|변호사|법무|로펌)[^.\\n]{0,20})${WEEK}\\s?(?:만에|안에|이면|면|내|이내|내에|만|컷!?)\\s?(?:바로\\s?)?(?:오픈|개점|끝|완료|사인)|${WEEK}\\s?(?:만에|안에|이면|면|내|이내|내에|만|컷!?)\\s?(?:바로\\s?)?(?:오픈|개점|끝|완료|사인)(?=[^.\\n]{0,20}(?:자문|거래사|변호사|법무|로펌))`,
  // '7일 속성 계약', '(자문사 본사 연결)'(R2 5차 재검토).
  `${WEEK}\\s?(?:속성|초고속|스피드|초스피드|패스트|빠른|급행)\\s?(?:가맹\\s?)?계약`,`${ADVISOR}\\s?(?:[은는을를]\\s?)?${HQ}\\s?(?:에서\\s?)?(?:연결|소개|매칭|배정|지정)`,
  `(?:본사|본부|가맹\\s?본부)(?:가|에서)?\\s?${ADVICE_FEE}[^.\\n]{0,8}?(?:대\\s?(?:드리|드립|줍|줘)|부담|지원|내\\s?드|무료)[^.\\n]{0,20}?(?:${WEEK}|단축)`,
  `${ADVICE_FEE}\\s?(?:는|은|도)?\\s?(?:전액\\s?)?(?:본사|본부)\\s?(?:가\\s?)?(?:전액\\s?)?(?:부담|지원|대\\s?(?:드|줍|줘)|무료)(?=[^\\n]{0,40}(?:${WEEK}|단축))|(?<=(?:${WEEK}|단축)[^\\n]{0,40})${ADVICE_FEE}\\s?(?:는|은|도)?\\s?(?:전액\\s?)?(?:본사|본부)\\s?(?:가\\s?)?(?:전액\\s?)?(?:부담|지원|대\\s?(?:드|줍|줘)|무료)`,
  // 대표 결정 3번 보완(2026-09-26): 본사가 지정·연결·소개·섭외한 자문자·자문(위 CAPTIVE_ARRANGED).
  CAPTIVE_ARRANGED,
  // 블라인드 레드팀 2차(2026-09-26): 본사 법무팀·사내 변호사·고문 변호사의 자문·검토·설명으로 7일·단축('저희 본사 법무팀 변호사 자문을 받으시면 7일로 단축됩니다').
  // 법무팀과 단축 사이에 조건·수단('받으시면', '들으시면', '거치면', '이면')이 있어야 한다. '본사 법무팀이 7일 단축 요건을 설명해 드립니다'(안내)와
  // '본사 법무팀의 설명을 들었다는 이유만으로 대기기간이 줄어들지는 않습니다'(부정)는 아니다.
  `${HQ}\\s?(?:의\\s?|쪽\\s?|측\\s?)?${HQ_LEGAL}(?:\\s?님)?[^.\\n]{0,20}?(?:받으시면|받으면|받고|들으시면|들으면|거치면|거치시면|거쳐|통하면|통해|이면|하시면|하면)[^.\\n]{0,15}?(?:${WEEK}|단축|줄어|줄여|줄일|빨라|앞당|대기\\s?(?:기간\\s?)?없이)${WAIT_NOT_NEG}`,
 ].join('|'),
  consumerAlso:'가맹|창업|거래사|변호사|법무|자문|정보\\s?공개서|본사|본부|점주|[Ff]ranchise',except:`${CAPTIVE_CAUTION_END}|${CAPTIVE_FREE_END}`},
 // block_unless_evidence. '멤버십 가입비 무료', '포장 용기 보증금 없음', '교육비 무료 원데이 클래스', '바리스타 교육비 무료 이벤트', '로열티 프리 음원', '창업 30주년 기념 교육비 무료'는 소비자 문장이다.
 'h.zero_cost_claims':{title:'로열티 0원·가맹비 면제 같은 비용 0 표현(H13)',match:`(?:${LOYALTY}|가맹비|가맹\\s?가입비|(?:가맹|계약\\s?이행)\\s?보증금|가맹\\s?교육비)\\s?(?:도\\s?)?${ZERO_GAP}${ZERO}|(?<=${FR_CTX}[^.,\\n]{0,20})${CLS_EDU}\\s?${ZERO_GAP}${ZERO}|${CLS_EDU}\\s?${ZERO_GAP}${ZERO}(?=[^.\\n]{0,30}${FR_CTX})|(?<![가-힣A-Za-z])(?:무|노|No|NO|no|제로|zero|ZERO)\\s?(?:\\(\\s?無\\s?\\)\\s?)?(?:${LOYALTY}|가맹비)|[Rr]oyalty[-\\s]?free|[Nn]o\\s+royalt(?:y|ies)|[Zz]ero\\s+royalt(?:y|ies)|[Ff]ranchise\\s+fees?\\s+(?:free|waived|0)`,except:'클래스|수강|원데이|음원|음악|BGM|이미지|폰트|사진|[Mm]usic|[Ii]mages?|[Ff]onts?|[Pp]hotos?|[Ss]tock|[Aa]udio|[Ss]ound'},
 // 아래는 모집 범위(objective_export)에서만 적용한다. 소비자 캠페인 문장('오늘도 완판', '매일 직접 굽는 수제 도넛')은 막지 않는다.
 'h.direct_store_popularity':{title:'직영 매장 대기줄·완판·판매량 표현(H14)',match:'\\d[\\d,.]*\\s?(?:m|미터|km)\\s?(?:넘는\\s?|의\\s?|짜리\\s?)?(?:줄|대기\\s?줄|웨이팅|행렬)|완판|매진|품절\\s?(?:대란|행진|사태|임박)?|대기\\s?(?:줄|행렬|번호|시간|\\d+\\s?(?:시간|분))|줄\\s?(?:서서|서는|선|서기|을\\s?서|이\\s?긴)|행렬|문전성시|오픈\\s?런|웨이팅|하루\\s?\\d[\\d,]*\\s?(?:개|판|명)|누적\\s?판매\\s?\\d|판매량\\s?\\d|화제의|핫플'},
 'h.handmade_claims':{title:'수제 표현',match:'수제|손\\s?반죽|(?:손으로|손수)\\s?(?:직접\\s?)?(?:빚|만든|만들|반죽)|핸드\\s?메이드|handmade'},
 'h.exclusive_supply_claims':{title:'본사 독점 공급 표현',match:'본사\\s?(?:독점|단독)\\s?(?:공급|납품|유통)|독점\\s?공급|본사\\s?(?:에서\\s?)?만\\s?(?:공급|납품)'},
 'h.collab_rights_claims':{title:'협업·콜라보 표기',match:'콜라보|컬래버(?:레이션)?|협업\\s?(?:메뉴|에디션|제품|굿즈|매장|스토어|팝업|컬렉션|패키지)|collab'},
 'h.own_ip_claims':{title:'자체 IP·캐릭터·상표 표현',match:'자체\\s?(?:IP|캐릭터|상표)|자사\\s?(?:캐릭터|IP)'},
 'h.heritage_claims':{title:'N년 전통·since 표현',match:'\\d{4}\\s?년\\s?(?:부터|이래)[^.\\n]{0,8}?(?:한\\s?길|외길|명가|전통|역사)|\\d+\\s?년\\s?(?:전통|역사|노하우)|(?:since|Since|SINCE)\\s?\\d{4}|(?:EST|Est)\\.?\\s?\\d{4}'},
 'h.direct_to_franchise_inference':{title:'직영점 성과를 가맹점 기대로 잇는 문장(H14)',match:'(?:직영점|본점|1\\s?호점)[^.\\n]{0,30}?(?:가맹점|점주|여러분)[^.\\n]{0,20}?(?:도|에서도)\\s?(?:같은|동일|똑같|기대|가능)'},
};
export const FRANCHISE_CLAIM_MATCHERS:Readonly<Record<string,ClaimMatcher>>=Object.freeze(Object.fromEntries(Object.entries(MATCHERS).map(([id,m])=>[id,Object.freeze({...m,...(m.more?{more:Object.freeze([...m.more])}:{})})])));
// 수치 자체를 막는 해제 불가 규칙(H6). 부정문('보장하지 않습니다')이어도 수치는 광고에 남으므로 부정 면제를 두지 않는다.
export const FRANCHISE_FIGURE_IDS=Object.freeze(['h.net_profit_payback_claims','h.revenue_figures_no_ad'] as const);
// 공식 규칙의 휴리스틱 확장(판정원은 공식 규칙 id 그대로, 근거 라벨은 '공식 규정 … 확장 적용 · COLLECTIVE 휴리스틱 · 법률 자문 아님').
// kr.fr.insurance_mark: 조문(제15조의2⑤⑥)은 보험·채무지급보증·공제 계약 표지다. '가맹금 안전·안심·보호·100%' 문구를 유사 표지로 보는 것은 휴리스틱이다.
// 보험 계약 사실(근거)이 있으면 '가맹금 보호' 같은 사실 표현은 통과하지만, strong('100%·보장·안전하게 지켜 드립니다·떼일 걱정 없는·먹튀')은 계약이 있어도 과장이라 막는다.
// '가맹비 안전', '가맹금 떼일 걱정 없는', '가맹금 먹튀 없음', 'Franchise fee 100% safe'도 같은 확장이다.
// textEvidence: 근거 조건과 다른 사실 표현의 근거. 확정 사실 값이 valuePattern에 맞고 적중 문장이 textPattern에 맞으면 strong이 아닌 표현을 통과시킨다
// ('가맹금은 가상은행에 예치해 보호합니다'는 예치 사실이 있으면 제6조의5 예치를 옮긴 사실 표현이다).
// recruitmentMatch: 모집 범위에서만 더하는 확장 표현('돈 떼일 걱정 없는 가맹 본부', '가입비·교육비 전액 안전 보관'. 가입비·교육비·보증금은 제2조6호 가맹금 항목이다).
export type ClaimExtension={readonly match:string;readonly recruitmentMatch?:string;readonly strong:string;readonly label:string;readonly textEvidence?:{readonly factKey:string;readonly valuePattern:string;readonly textPattern:string}};
export const FRANCHISE_OFFICIAL_EXTENSIONS:Readonly<Record<string,ClaimExtension>>=Object.freeze({
 'kr.fr.insurance_mark':Object.freeze({match:'(?:가맹금|가맹비|가맹\\s?가입비|[Ff]ranchise\\s?fees?)[^.,\\n]{0,12}?(?:안전|안심|보호|지켜|100\\s?%|떼일\\s?(?:걱정|염려|일)?\\s?(?:없|zero|제로|NO|no)?|떼이지\\s?않|떼먹|먹튀\\s?(?:걱정\\s?)?(?:없|zero|제로|NO|no|X)?|날릴\\s?(?:걱정|일)\\s?(?:없)?|걱정\\s?(?:없|zero|제로|끝|NO|no|X)|돌려\\s?받|환불\\s?보장|[Ss]afe|[Ss]ecure|[Pp]rotect(?:ed|ion)|[Ii]nsured|[Gg]uaranteed)'
  // '가맹금 전액 보장 제도', '가맹금 (지급)보증', '안전 가맹비'. '가맹 보증금'·'보증보험'은 아니다(바로 붙은 표현만).
  +'|(?:가맹금|가맹비)\\s?(?:전액\\s?|100\\s?%\\s?)?(?:반환\\s?|환불\\s?|지급\\s?)?(?:보장|보증(?!\\s?(?:금|보험)))|(?:안전|안심)\\s?가맹(?:금|비)',recruitmentMatch:'(?<![가-힣])(?:돈|투자금|창업\\s?자금|가입비|교육비|(?<!(?:임차|임대|컵|용기|포장)\\s?)보증금)[^.,\\n]{0,10}?(?:떼일|떼이|떼먹|먹튀|안전\\s?(?:보관|보호|관리)|100\\s?%\\s?(?:보호|안전|보장|반환))',
  strong:'100\\s?%|보장|지켜\\s?드|완벽|떼일|떼이지|떼먹|먹튀|걱정\\s?(?:없|zero|제로|끝|NO|no)|[Gg]uarantee',label:'공식 규정 제15조의2⑥ 확장 적용',
  textEvidence:Object.freeze({factKey:'escrow_insurance',valuePattern:'예치|에스크로',textPattern:'예치|에스크로'})}),
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
// 안전망(판정기 로직, 경고만): 규칙 레지스트리의 새 규칙이 아니라 H6(h.revenue_figures_no_ad)을 부모로 둔 확인용 경고다(레지스트리 54개·버전 불변). 모집 범위와, 모집 문구가 있는 소비자 캡션에 건다.
// 수익 규칙이 잡지 않은 문장(또는 이웃한 짧은 문장을 이은 문장)에 수익·손실 낱말(words)과 금액·비율(figure: 만·천·백·억·%, 단위 없는 세 자리 이상 수. 연도·전화번호는 뺀다)이 함께 있으면 경고로 승인자에게 보인다(안전망마다 첫 문장 하나, 한 문장에 안전망 경고 하나).
// 금액은 비용 라벨 절('가맹비 550만원', '월세 다 빼고'는 수익 낱말이 같은 절에 있으면 수익), 경품·기부·할인 절, 매출의 몫('매출액의 3%')이면 수익 금액이 아니다.
// 약한 낱말(weak: 정산·부담·입금·예치·선착순·자리·상권)은 비용 라벨 없는 같은 절의 금액과 함께일 때만 본다. 경고는 차단으로 오르지 않는다(H9 제외). R2 5차 재검토: 좁고 정확한 해제 불가 표현 밖의 속어·돌려 말하기는
// 이 넓은 경고망으로 승인자에게 보이고, 마지막 확인은 승인자다.
// 판정 규칙이 일부러 다루지 않고 승인자 확인에 맡기는 형태(2026-09-25 R2 3차 재검토, 합성 우회 120건 기준): 첫 음절만 띄운 낱말('수 익보장'), 속어·은어('찜비·킵·도장 찍으세요·쏩니다·장담 못합니다'),
// 부정 뒤 긍정·다른 브랜드 대비로 돌려 말하기('보장이라고 광고할 순 없지만 사실상 보장입니다', '보장하지 않는 본사가 대부분이지만 저희는 합니다'),
// 돌려 쓴 이름('매출 대비 남는 돈 35%'는 안전망 경고만, '자리 맡아두는 비용'), 판정 보기 목록에 없는 한자·기호('無', '保証', '回收'), 'D+7' 같은 표기, 고유어 수·다른 단위의 매장 수('스무 개', '150점', '매장 100+'),
// 부드러운 불이익('물량 공급이 어려울 수 있습니다'), 막연한 수('유동 인구 수만 명').
// 4차 재검토(합성 우회 180건·소비자 200건)에서 규칙으로 옮긴 형태: 라벨 뒤 단위 없는 수('월 매출 4200 (단위: 만원)', '월 순익 400 보장'), 수치가 먼저 오는 문장, 묻고 답하는 수치, 부족분 보전,
// 대소문자 섞인 영어, 서식 문자·숫자 속 O·닮은 글자·호환 자모. 남긴 형태: 계산으로 만든 수('객단가 6천 → 월 7,200'), 통장에 꽂히는 돈 같은 속어, 지역 한정 매장 수('서울에만 45개'),
// 비용 라벨 없이 매장 유형만 붙인 금액('테이크아웃형 2,900 / 매장형 4,500'), 글자 속 숫자('수1익'), 거꾸로·로마자로 쓴 낱말('장보 익수', 'suik bojang'). 패턴 규칙은 끝내 완전하지 않고 마지막 확인은 승인자다.
// 5차 재검토(최종 소비자 120건·현실적 우회 100건)에서 규칙으로 옮긴 형태: 통장에 꽂히는 금액, 지역·기간으로 좁힌 매장 수, 돈을 내면 자리를 잡아 주는 표현, '쏩니다', '경쟁점 無'.
// 남긴 형태(경고망 또는 승인자): 계산으로 만든 수, 고유어 수·다른 단위의 매장 수, 부정 뒤 긍정·다른 브랜드 대비로 돌려 말하기, 첫 음절만 띄운 낱말, 판정 보기 목록에 없는 한자·로마자 표기, 'D+7'.
export const FRANCHISE_REVIEW_NET=Object.freeze({id:'h.revenue_like_figure_review',parent:'h.revenue_figures_no_ad',title:'수익처럼 보이는 수치(H6 안전망)',
 words:'수익|수입(?!\\s?(?:원두|버터|밀가루|재료|원료|식자재|과일|치즈|맥주|와인|고기|산|품))|매출|매상|순익|(?<!불)이익|마진|소득|순수입|실\\s?수령|벌(?:어|고|었|면|이|기|\\s?수)|버는|번다|법니다|버셨|버세요|버시|가져\\s?가|챙기|챙겨|챙깁|남는\\s?돈|손에\\s?(?:남|쥐|떨어)|찍히|찍혀|꽂히|꽂혀|통장|배당|원금|손실|적자|뽑|회수|본전|BEP|ROI|R0I|손익|[Pp]rofit|[Rr]evenue|[Ee]arn',
 weak:'정산|부담|입금|예치|선착순|자리\\s?(?:확보|선점|잡|찜|킵|홀드)|상권\\s?(?:확보|선점|우선|배정)',
 skip:'분담금|광고비|판촉비|홍보비|마케팅\\s?(?:비용|비)|수수료|관리비|카드\\s?(?:수수료|매출)',
 figure:'\\d[\\d,.]*\\s?(?:만|천|억|원|%|퍼센트|배)|\\d+\\s?백(?![가-힣]{2})|(?<![가-힣\\d])천\\s?(?:만\\s?원?)?(?=$|[^가-힣]|[은는이가을를도씩](?![가-힣]))|(?<![\\d.,\\-]\\s?)(?!0)\\d{1,3}(?:,\\d{3})+|억\\s?대|수\\s?(?:십|백|천)\\s?만|수\\s?억|(?<![\\d.,\\-/]|\\d\\s)(?!0)(?!(?:19|20)\\d{2}(?!\\d))\\d{3,}(?![\\d.,\\-/]|\\s\\d)|₩\\s?\\d|\\d\\s?(?:KRW|won|[MK](?![A-Za-z]))'} as const);
// 예치·입금으로 자리를 잡는 표현의 안전망(경고만, 부모 h.wait_bypass_solicitation, 레지스트리 불변): 대기기간 우회 규칙이 잡지 않은 문장에 입금·예치·예약금·보증금 같은 돈 낱말(pay)과
// 자리·상권·순번·선착순·우선·확보·홀드 같은 자리 낱말(hold)이 함께 있으면 경고로 승인자에게 보인다(첫 문장 하나, 수익 안전망과 같은 문장에 겹치지 않는다). 부정한 문장('가계약금은 받지 않습니다')은 아니다(R2 5차 재검토).
export const FRANCHISE_DEPOSIT_NET=Object.freeze({id:'h.deposit_like_review',parent:'h.wait_bypass_solicitation',title:'입금으로 자리를 잡는 것처럼 보이는 표현(대기기간 우회 안전망)',
 pay:'입금|예치|가?계약금|예약금|보증금|선입금|선납|신청금|신청비|착수금|[Dd]eposit|걸어\\s?(?:두|놓)|거시면|걸면|송금|이체',
 hold:'자리|상권|입지|순번|순서\\s?(?:대로|로|으로)|입금\\s?순|선착순|우선\\s?(?:권|순위|배정|협상|오픈|선택|확보)|확보|선점|홀드|홀딩|킵|[Kk]eep|찜|안\\s?넘어|(?:지역|점포|오픈\\s?일정)\\s?(?:배정|확정|당겨)',
 negated:'지\\s?않|없습니다|없어요|없음|금지|불법|마세요|아닙니다|아니요|아뇨'} as const);

// 정규식이 아니라 판정기 로직으로만 구현하는 규칙: H8(가맹 수치 문장의 [사실] 표지·정보공개서 각주), H9(첫 줄 수치 주장의 경고를 차단으로).
export const FRANCHISE_CLAIM_LOGIC=Object.freeze(['h.fact_opinion_labels','h.headline_claim_block'] as const);
