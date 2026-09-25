// 트랙 R 가맹 리드 원장(R1a·R4b) 순수 모듈: 코드·한국어 라벨·고정 문구, 연락처 정규화·가림, 보존 기한, 역할 판정, 적격 점수, CSV 칸, 게이트 설명.
// 서버(lib/franchise-server.ts)와 화면이 같은 판정을 쓴다. 저장·암호화·네트워크·시계는 없다. 현재 시각이 필요한 함수는 now를 받는다.
// 대표 결정 22(2026-09-25): 리드에 이름·연락처를 저장한다(필드 암호화, 목록 가림, 열람 감사). 결정 20(법률 검토 보류): 모든 기한·게이트는 COLLECTIVE 휴리스틱이며 법률 자문이 아니다.
import {GATE_DISCLAIMER,type LeadStage,type ReasonCode,type WarningCode,type GateResult,type ContractWindow,type SideWindow} from './franchise-gates';
import {CODE_ALPHABET} from './tracking-codes';

const keysOf=<K extends string>(o:Readonly<Record<K,string>>)=>Object.freeze(Object.keys(o) as K[]);

// ── 단계 ──
export const STAGE_LABELS:Readonly<Record<LeadStage,string>>={inquiry:'문의',contacted:'연락',consulted:'상담',briefing:'설명회',disclosed:'정보공개서 제공',draft_provided:'계약서안 제공',contracted:'계약',fee_escrowed:'가맹금 예치',opened:'개점',closed:'종결'};
export const GENERAL_STAGES=Object.freeze(['inquiry','contacted','consulted','briefing'] as const);
export type GeneralStage=typeof GENERAL_STAGES[number];
// 증빙 기록으로만 가는 단계. move_stage로는 갈 수 없다.
export const EVIDENCE_STAGES=Object.freeze(['disclosed','draft_provided','contracted','fee_escrowed'] as const);
export const STAGE_ORDER:Readonly<Record<Exclude<LeadStage,'closed'>,number>>={inquiry:0,contacted:1,consulted:2,briefing:3,disclosed:4,draft_provided:5,contracted:6,fee_escrowed:7,opened:8};
export const stageOrder=(s:string)=>Object.hasOwn(STAGE_ORDER,s)?STAGE_ORDER[s as keyof typeof STAGE_ORDER]:-1;
export const isGeneralStage=(s:unknown):s is GeneralStage=>typeof s==='string'&&(GENERAL_STAGES as readonly string[]).includes(s);
export const isEvidenceStage=(s:unknown)=>typeof s==='string'&&(EVIDENCE_STAGES as readonly string[]).includes(s);

// ── 과업 필드·수집 근거·동의·사유 코드 ──
export const BUDGET_LABELS={unknown:'미정',lt_50m:'5천만원 미만','50m_100m':'5천만~1억원','100m_150m':'1억~1.5억원','150m_200m':'1.5억~2억원',gte_200m:'2억원 이상'} as const;
export type BudgetBand=keyof typeof BUDGET_LABELS;
export const BUDGET_BANDS=keysOf(BUDGET_LABELS);
export const TIMING_LABELS={unknown:'미정',within_3m:'3개월 안','3m_6m':'3~6개월','6m_12m':'6~12개월',over_12m:'1년 이후'} as const;
export type TimingBand=keyof typeof TIMING_LABELS;
export const TIMING_BANDS=keysOf(TIMING_LABELS);
export const SOURCE_LABELS={referral:'지인·점주 추천',phone_inquiry:'전화 문의',walk_in:'매장 방문',expo:'박람회',portal:'창업 포털',online_form_manual:'온라인 양식(수기 옮김)',other:'기타'} as const;
export type SourceChannel=keyof typeof SOURCE_LABELS;
export const SOURCE_CHANNELS=keysOf(SOURCE_LABELS);
export const BASIS_LABELS={inquiry_response:'문의 응대(제15조①4호)',consent:'동의(제15조①1호)',referral:'제3자 소개(출처 고지 필요)'} as const;
export type BasisType=keyof typeof BASIS_LABELS;
export const BASIS_TYPES=keysOf(BASIS_LABELS);
export const REFERRAL_LABELS={franchisee:'가맹점주',acquaintance:'지인',partner:'협력사',other:'기타'} as const;
export type ReferralFrom=keyof typeof REFERRAL_LABELS;
export const REFERRAL_FROM=keysOf(REFERRAL_LABELS);
export const MARKETING_METHOD_LABELS={written:'서면',recorded_call:'녹취',electronic:'전자 양식'} as const;
export type MarketingMethod=keyof typeof MARKETING_METHOD_LABELS;
export const MARKETING_METHODS=keysOf(MARKETING_METHOD_LABELS);
export const MARKETING_STATUS_LABELS={none:'동의 없음',given:'동의',withdrawn:'철회'} as const;
export type MarketingStatus=keyof typeof MARKETING_STATUS_LABELS;
export const CLOSE_REASON_LABELS={not_interested:'관심 없음',budget_mismatch:'예산 불일치',region_unavailable:'모집 불가 지역',unreachable:'연락 불가',duplicate:'중복',hq_declined:'본부 거절',contract_ended:'계약 종료(계약 리드만)',other:'기타'} as const;
export type CloseReason=keyof typeof CLOSE_REASON_LABELS;
export const CLOSE_REASONS=keysOf(CLOSE_REASON_LABELS);
export const REVEAL_PURPOSE_LABELS={call_back:'연락',consultation:'상담 준비',subject_request:'정보주체 요청 처리',correction:'정정 확인',contract_prep:'계약 준비'} as const;
export type RevealPurpose=keyof typeof REVEAL_PURPOSE_LABELS;
export const REVEAL_PURPOSES=keysOf(REVEAL_PURPOSE_LABELS);
export const EXPORT_PURPOSE_LABELS={subject_request:'정보주체 요청 처리',internal_review:'내부 점검',handover:'담당 인수인계'} as const;
export type ExportPurpose=keyof typeof EXPORT_PURPOSE_LABELS;
export const EXPORT_PURPOSES=keysOf(EXPORT_PURPOSE_LABELS);
// 모두 lib/franchise-gates.ts APPROVAL_REASON_PATTERN(/^[a-z][a-z0-9_]{2,63}$/)을 만족한다(테스트 고정).
export const BACKDATE_REASON_LABELS={after_the_fact_entry:'사후 입력',offline_delivery:'현장 전달 뒤 입력',system_unavailable:'시스템 사용 불가',correction:'정정'} as const;
export type BackdateReason=keyof typeof BACKDATE_REASON_LABELS;
export const BACKDATE_REASONS=keysOf(BACKDATE_REASON_LABELS);
// wrong_lead는 void_evidence(다른 리드에 잘못 적은 기록 무효화)에만 쓴다.
export const CORRECTION_REASON_LABELS={typo:'오기',wrong_time:'시각 오류',wrong_document:'문서 오류',wrong_lead:'다른 리드',other:'기타'} as const;
export type CorrectionReason=keyof typeof CORRECTION_REASON_LABELS;
export const CORRECTION_REASONS=keysOf(CORRECTION_REASON_LABELS);
export const SUBJECT_REQUEST_TYPE_LABELS={access:'열람',correction:'정정',erasure:'삭제',suspension:'처리정지',source_notice:'수집 출처 고지'} as const;
export type SubjectRequestType=keyof typeof SUBJECT_REQUEST_TYPE_LABELS;
export const SUBJECT_REQUEST_TYPES=keysOf(SUBJECT_REQUEST_TYPE_LABELS);
export const SUBJECT_REQUEST_STATUS_LABELS={open:'접수',in_progress:'처리 중',done:'완료',rejected:'거절'} as const;
export type SubjectRequestStatus=keyof typeof SUBJECT_REQUEST_STATUS_LABELS;
export const SUBJECT_REQUEST_STATUS=keysOf(SUBJECT_REQUEST_STATUS_LABELS);
export const SUBJECT_RESOLUTION_LABELS={fulfilled:'처리함',erased:'삭제함',corrected:'정정함',not_found:'대상 없음',refused_other:'거절(기타)'} as const;
export type SubjectResolution=keyof typeof SUBJECT_RESOLUTION_LABELS;
export const SUBJECT_RESOLUTIONS=keysOf(SUBJECT_RESOLUTION_LABELS);
export const SUBJECT_CHANNEL_LABELS={phone:'전화',email:'이메일',in_person:'방문',mail:'우편',other:'기타'} as const;
export type SubjectChannel=keyof typeof SUBJECT_CHANNEL_LABELS;
export const SUBJECT_CHANNELS=keysOf(SUBJECT_CHANNEL_LABELS);
export const BRANCH_LABELS={A:'분기 A',B:'분기 B',C:'분기 C',undetermined:'판정 불가'} as const;
export type Branch=keyof typeof BRANCH_LABELS;
export const BRANCHES=keysOf(BRANCH_LABELS);
export const CONTACT_FIELD_LABELS={name:'이름',phone:'전화',email:'이메일',memo:'메모'} as const;
export type ContactField=keyof typeof CONTACT_FIELD_LABELS;
export const CONTACT_FIELDS=keysOf(CONTACT_FIELD_LABELS);
// expired는 저장하지 않고 읽을 때만 계산한다(보존 기한이 지났지만 아직 파기 전).
export const CONTACT_STATE_LABELS={present:'보관 중',purged:'파기됨',erased:'삭제됨',expired:'보존 기한 지남'} as const;
export type ContactState=keyof typeof CONTACT_STATE_LABELS;
export const CONTACT_STATES=keysOf(CONTACT_STATE_LABELS);
export const EVIDENCE_TYPE_LABELS={delivery:'제공',advice:'자문',forecast:'예상매출액 산정서',contract:'계약',fee:'가맹금',agreement:'본계약 전 약정'} as const;
export type EvidenceType=keyof typeof EVIDENCE_TYPE_LABELS;
export const EVIDENCE_TYPES=keysOf(EVIDENCE_TYPE_LABELS);
// 증빙 입력 화면용 라벨. 코드 목록은 lib/franchise-gates.ts가 정본이다.
export const DELIVERY_DOC_LABELS={disclosure:'정보공개서',nearby:'인근가맹점 현황문서',draft:'가맹계약서안',change_notice:'중요사항 변경 통지'} as const;
export const DELIVERY_METHOD_LABELS={hand:'직접 전달',certified_mail:'내용증명',electronic:'전자 방식',ftc_link:'공정위 사이트 링크(제공 아님)'} as const;
export const ELECTRONIC_CHANNEL_LABELS={email:'이메일',sms:'문자',app:'앱'} as const;
export const HAND_EVIDENCE_LABELS={receiptDateTimePlaceHandwritten:'수령 일시·장소 자필',nameAddressPhoneHandwritten:'이름·주소·전화 자필',signatureHandwritten:'서명 자필',hqSigned:'본부 서명',confirmationGiven:'확인서 교부'} as const;
export const ADVISOR_TYPE_LABELS={attorney:'변호사',franchise_consultant:'가맹거래사'} as const;
export const FEE_CATEGORY_LABELS={a_join:'가입비·교육비·계약금',b_security:'보증금·담보',c_opening:'설비·인테리어·임차료',d_periodic:'정기 대가',e_other:'그 밖의 대가'} as const;
export const ESCROW_INSTITUTION_LABELS={bank:'은행',post_office:'체신관서',insurer:'보험회사',trust:'신탁업자'} as const;
export const FORECAST_DUTY_LABELS={required:'산정서 필요',not_required:'불필요',unknown:'미확인(필요로 처리)'} as const;
export const EVENT_TYPE_LABELS={created:'등록',stage_changed:'단계 변경',transition_blocked:'진행 차단',claimed:'담당 가져옴',assigned:'담당 지정',contact_updated:'연락처 수정',task_updated:'과업 수정',source_noticed:'출처 고지',marketing_given:'광고성 정보 동의',marketing_withdrawn:'광고성 정보 철회',evidence_recorded:'증빙 기록',evidence_voided:'증빙 무효화',purged:'연락처 파기',erased:'연락처 삭제',reopened:'다시 열기'} as const;
export type LeadEventType=keyof typeof EVENT_TYPE_LABELS;
export const AUDIT_ACTION_LABELS={reveal:'연락처 보기',find:'연락처로 찾기',export:'내보내기',purge:'파기',erase:'정보주체 삭제',backdate:'이른 증빙 시각',evidence_void:'증빙 무효화',assign:'담당 지정',claim:'담당 가져옴',profile_save:'가맹 프로필 저장',version_register:'정보공개서 버전 등록',version_retire:'정보공개서 버전 사용 중지',template_register:'계약서안 템플릿 등록',template_retire:'계약서안 템플릿 사용 중지',notice_register:'안내문 등록',notice_retire:'안내문 사용 중지',subject_request:'정보주체 요청 접수',subject_request_update:'정보주체 요청 처리',marketing_withdrawn:'광고성 정보 철회'} as const;
export type AuditAction=keyof typeof AUDIT_ACTION_LABELS;

// ── 고정 문구 ──
// 서버는 이 문구를 그대로 던진다(값을 끼워 넣지 않는다).
export const FRANCHISE_ERRORS={
 OFF:{status:409,text:'가맹 모집 기능이 꺼져 있습니다. 조회·파기·정보주체 요청만 할 수 있습니다.'},
 KEY_MISSING:{status:503,text:'연락처 암호화 키가 설정되지 않아 리드 연락처를 저장하거나 볼 수 없습니다. 관리자에게 문의해 주세요.'},
 ADMIN_ONLY:{status:403,text:'대표·관리자만 할 수 있습니다.'},
 NOT_ASSIGNED:{status:403,text:'담당 리드만 할 수 있습니다. 담당자가 없는 리드는 먼저 가져오세요.'},
 NOT_VISIBLE:{status:403,text:'이 리드를 볼 권한이 없습니다.'},
 LEAD_NOT_FOUND:{status:404,text:'리드를 찾을 수 없습니다.'},
 STALE:{status:409,text:'리드가 변경됐습니다. 새로고침한 뒤 다시 시도해 주세요.'},
 DUPLICATE:{status:409,text:'이미 등록된 연락처입니다. 기존 리드 코드를 확인해 주세요.'},
 GATE_BLOCKED:{status:409,text:'지금은 이 단계로 진행할 수 없습니다. 사유를 확인해 주세요.'},
 EVIDENCE_ONLY:{status:400,text:'이 단계는 증빙 기록으로만 진행합니다.'},
 NO_BACKWARD:{status:400,text:'증빙이 기록된 리드는 앞 단계로 되돌릴 수 없습니다.'},
 CLOSED:{status:409,text:'종결된 리드입니다. 다시 연 뒤 기록해 주세요.'},
 ALREADY_ASSIGNED:{status:409,text:'이미 담당자가 있는 리드입니다.'},
 CONTACT_REQUIRED:{status:400,text:'이름과 전화번호·이메일 중 하나 이상을 입력해 주세요.'},
 PII_IN_TEXT:{status:400,text:'이름·메모·지역·라벨에는 연락처·주소·주민등록번호·계좌·카드 번호를 적을 수 없습니다.'},
 FUTURE_TIME:{status:400,text:'미래 시각은 기록할 수 없습니다.'},
 BACKDATE:{status:400,text:'기록 시각보다 이른 증빙 시각은 사유를 골라야 합니다.'},
 BRANCH_BLOCKED:{status:409,text:'가맹 준비도 분기가 A(모집 가능)로 기록된 브랜드만 문의를 등록할 수 있습니다.'},
 CONTACT_GONE:{status:409,text:'파기되거나 삭제된 연락처입니다. 새 문의로 등록해 주세요.'},
 LEAD_ERASED:{status:409,text:'연락처가 파기·삭제된 리드는 종결·증빙·정보주체 요청만 기록할 수 있습니다.'},
 REPLAY_EXPIRED:{status:409,text:'열람·내보내기 요청이 만료됐습니다. 다시 요청해 주세요.'},
 REQUEST_REUSED:{status:409,text:'요청 번호가 다른 요청에 쓰였습니다. 새로고침한 뒤 다시 시도해 주세요.'},
 NOTICE_REQUIRED:{status:400,text:'동의 근거에는 개인정보 안내문 버전과 안내 시각이 필요합니다.'},
 STORAGE_LABEL:{status:400,text:'보관 위치는 설정에서 등록한 라벨만 고를 수 있습니다.'},
 VERSION_NOT_FOUND:{status:400,text:'정보공개서 버전을 찾을 수 없습니다.'},
 TEMPLATE_NOT_FOUND:{status:400,text:'계약서 템플릿을 찾을 수 없습니다.'},
 RETIRED:{status:400,text:'사용 중지된 항목은 새 기록에 쓸 수 없습니다.'},
 LIMIT:{status:409,text:'기록 한도에 도달했습니다.'},
 UNKNOWN_ACTION:{status:400,text:'지원하지 않는 작업입니다.'},
 REQUEST_ID:{status:400,text:'요청 번호를 확인해 주세요.'},
 UNKNOWN_VIEW:{status:400,text:'지원하지 않는 화면입니다.'},
} as const satisfies Record<string,{status:number;text:string}>;
export type FranchiseErrorKey=keyof typeof FRANCHISE_ERRORS;
// 게이트 사유·경고 코드의 한국어 설명. REASON_CODES ∪ WARNING_CODES와 정확히 같은 키(테스트 고정).
export const GATE_REASON_MESSAGES:Readonly<Record<ReasonCode|WarningCode,string>>={
 backdate_unapproved:'기록 시각보다 이른 증빙 시각은 대표·관리자가 사유와 함께 기록해야 합니다.',
 change_notice_method_mismatch:'변경 통지는 직전 정보공개서 제공과 같은 방법이어야 기산에 씁니다.',
 contract_too_early:'계약 가능 시각 전입니다. 대기기간이 지나야 계약을 기록할 수 있습니다.',
 delivery_id_conflict:'같은 번호의 제공 기록 내용이 서로 다릅니다.',
 disclosure_missing:'기산에 쓸 정보공개서 제공 기록이 없습니다.',
 draft_missing:'기산에 쓸 계약서안 제공 기록이 없습니다.',
 draft_template_incomplete:'계약서안 템플릿의 필수 기재 13개 항목 확인이 끝나지 않았습니다.',
 escrow_unproven:'가맹금 예치 또는 피해보상보험 증빙이 부족합니다.',
 evidence_incomplete:'제공 방법별 증빙 항목이 빠졌습니다.',
 fee_too_early:'계약 가능 시각 전에 가맹금을 받은 것으로 기록됐습니다.',
 forecast_statement_missing:'예상매출액 산정서 서면 제공 기록이 필요합니다.',
 future_delivery:'제공 시각이 현재보다 늦습니다.',
 future_event:'증빙 시각이 현재보다 늦습니다.',
 invalid_date:'날짜를 확인해 주세요.',
 invalid_record:'기록 형식을 확인해 주세요.',
 invalid_stage:'알 수 없는 단계입니다.',
 invalid_timestamp:'시각 형식을 확인해 주세요.',
 method_not_allowed:'허용된 제공 방법(직접 전달·내용증명·전자 방식)이 아닙니다. 공정위 사이트 링크는 제공으로 기록할 수 없습니다.',
 nearby_missing:'기산에 쓸 인근가맹점 현황문서 제공 기록이 없습니다.',
 pre_contract_agreement_too_early:'가맹금·공사·교육 조항이 있는 약정은 계약 가능 시각 뒤에만 기록할 수 있습니다.',
 receipt_unconfirmed:'전자 방식 제공의 수신 시각 증빙이 없습니다.',
 shortening_unproven:'7일 단축을 뒷받침할 자문 증빙이 확인되지 않았습니다.',
 version_not_registered:'제공 시점에 등록된 정보공개서 버전이 아닙니다.',
 version_not_valid_on_delivery:'제공 시점에 유효한 정보공개서 버전이 아닙니다.',
 advisor_independence_unverified:'자문자의 독립성(본부 비용 부담·소개 여부)이 확인되지 않았습니다.',
 application_date_unknown:'변경등록 신청일을 몰라 이른 기한을 표시합니다.',
 holiday_calendar_unverified:'공휴일 목록이 없어 주말만 반영했습니다.',
};
export {GATE_DISCLAIMER};
export const CONTACT_NOTE='연락처는 암호화해 저장하고 목록에서는 가립니다. 연락처 보기는 기록에 남습니다.';
export const OFF_BANNER='가맹 모집 기능이 꺼져 있습니다. 대표가 설정의 기능 스위치에서 켤 수 있습니다. 조회·파기·정보주체 요청은 계속할 수 있습니다.';
export const DUE_LABEL='처리 기한(COLLECTIVE 휴리스틱 10일 · 법률 자문 아님)';
export const RETENTION_LABEL='보존 기한(COLLECTIVE 휴리스틱 H11 · 법률 자문 아님)';
export const MEMO_HINT='연락처·주소·주민등록번호·계좌번호와 건강·신용·가족 같은 민감한 내용은 적지 마세요.';
export const RECHECK_LABEL='광고성 정보 동의 2년 경과(재확인 필요 · COLLECTIVE 휴리스틱 · 법률 자문 아님)';
export const UNDETERMINED_BANNER='가맹 준비도 분기가 판정되지 않았습니다. 분기 A로 기록하기 전에는 문의를 등록할 수 없습니다.';

// ── 레코드 모양(lib/franchise-server.ts가 저장한다) ──
export type Role='owner'|'admin'|'member';
export type Who={id:string;role:Role};
export type ActorSnapshot={id:string;role:Role|'system'};
export type LeadTask={region:string;budgetBand:BudgetBand;timingBand:TimingBand;sourceChannel:SourceChannel;campaignId:string|null};
export type LeadBasis={type:BasisType;noticeId?:string;noticeGivenAt?:string;referralFrom?:ReferralFrom;sourceNoticedAt?:string|null};
export type LeadMarketing={status:MarketingStatus;method?:MarketingMethod;at?:string;noticeId?:string;withdrawnAt?:string};
// contact·memo 값은 'v1.' 접두 암호문만 저장한다. 가린 값은 저장하지 않고 읽을 때 만든다.
export type LeadRecord={id:string;brandId:string;systemCode:string;stage:LeadStage;closeReason:CloseReason|null;closedFrom:LeadStage|null;assigneeId:string|null;
 contact:{name:string;phone:string|null;email:string|null}|null;memo:string|null;contactState:'present'|'purged'|'erased';
 task:LeadTask;basis:LeadBasis;marketing:LeadMarketing;firstContactAt:string|null;lastActivityAt:string;contractedAt:string|null;closedAt:string|null;
 purgedAt?:string;erasedAt?:string;version:number;createdAt:string;createdBy:ActorSnapshot;updatedAt:string};
export type EligibilityCriteria={version:number;budgetBands:readonly string[];regions:readonly string[];timingBands:readonly string[]};

// ── 정규화 ──
const PHONE_SEPARATORS=/[\s+\-‐-―.()]/g;
// 숫자와 구분자(공백·+·-·.·괄호)만 받는다. 82로 시작하면 국가번호로 보고 0을 붙인다(국내 번호는 항상 0으로 시작한다).
export function normalizePhone(raw:unknown):string|null{
 if(typeof raw!=='string'||raw.length>40)return null;
 let d=raw.normalize('NFKC').replace(PHONE_SEPARATORS,'');
 if(!/^\d+$/.test(d))return null;
 if(d.startsWith('82'))d='0'+d.slice(2).replace(/^0/,'');
 return /^0\d{8,10}$/.test(d)?d:null;
}
export function normalizeEmail(raw:unknown):string|null{
 if(typeof raw!=='string')return null;
 const v=raw.normalize('NFKC').trim().toLowerCase();
 return v.length<=254&&/^[^\s@]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(v)?v:null;
}
// 이름: 1~40자(코드 포인트). 제어 문자·숫자·<>는 받지 않는다. 개인정보 패턴 검사는 서버가 한다.
export function normalizeName(raw:unknown):string|null{
 if(typeof raw!=='string')return null;
 const v=raw.normalize('NFKC').trim().replace(/\s+/g,' '),n=[...v].length;
 return n>=1&&n<=40&&!/[\d<>]/.test(v)&&![...v].some(c=>{const x=c.codePointAt(0)??0;return x<32||x>=127&&x<=159})?v:null;
}
export function formatPhone(d:string){
 if(/^02\d{7,8}$/.test(d))return `02-${d.slice(2,d.length-4)}-${d.slice(-4)}`;
 if(/^\d{10}$/.test(d))return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
 if(/^\d{11}$/.test(d))return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
 return d;
}
// ── 가림(읽을 때만) ──
export function maskName(name:string){const cs=[...name],n=cs.length;return n<=1?'*':n===2?cs[0]+'*':cs[0]+'*'.repeat(n-2)+cs[n-1]}
export const maskPhone=(d:string)=>'***-****-'+d.slice(-4);
export function maskEmail(e:string){const at=e.lastIndexOf('@');return at<1?'***':[...e.slice(0,at)][0]+'***@'+e.slice(at+1)}

// ── 보존 기한(H11, COLLECTIVE 휴리스틱) ──
const DAY=86400000;
export const UNCONVERTED_RETENTION_DAYS=180,CONTRACT_RETENTION_DAYS=1095,AUDIT_RETENTION_DAYS=365,MARKETING_RECHECK_DAYS=730,DSR_DUE_DAYS=10;
// 읽을 수 없는 시각은 이미 지난 것으로 본다(파기 쪽으로 닫는다).
const msOf=(v:string|null|undefined)=>{const t=typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(t)?t:0};
const iso=(ms:number)=>new Date(ms).toISOString();
// 연락처가 없으면 null. 계약에 이른 리드는 종결 뒤 1095일(열려 있는 동안 null), 그 밖은 마지막 활동 뒤 180일.
export function retentionUntil(lead:Pick<LeadRecord,'contactState'|'contractedAt'|'closedAt'|'lastActivityAt'>):string|null{
 if(lead.contactState!=='present')return null;
 if(lead.contractedAt)return lead.closedAt?iso(msOf(lead.closedAt)+CONTRACT_RETENTION_DAYS*DAY):null;
 return iso(msOf(lead.lastActivityAt)+UNCONVERTED_RETENTION_DAYS*DAY);
}
export function isContactExpired(lead:Pick<LeadRecord,'contactState'|'contractedAt'|'closedAt'|'lastActivityAt'>,now:string){const until=retentionUntil(lead);return until!==null&&Date.parse(until)<=msOf(now)}
// 가맹희망자와 관련된 활동만 마지막 활동 시각을 바꾼다. 열람·찾기·담당 지정·내보내기·철회·정보주체 요청·차단된 전이·파기는 바꾸지 않는다(내부 조작이 보존 기한을 늘리지 않게).
export const ACTIVITY_EVENTS:readonly LeadEventType[]=Object.freeze(['created','stage_changed','reopened','contact_updated','task_updated','source_noticed','marketing_given','evidence_recorded']);
// 광고성 정보 수신 동의 2년 재확인(정보통신망법 관행, 휴리스틱). 발송 기능은 없고 할 일로만 띄운다.
export function marketingRecheckDue(lead:Pick<LeadRecord,'marketing'>,now:string){return lead.marketing.status==='given'&&!!lead.marketing.at&&msOf(now)-msOf(lead.marketing.at)>=MARKETING_RECHECK_DAYS*DAY}
export const subjectDueAt=(receivedAt:string)=>iso(msOf(receivedAt)+DSR_DUE_DAYS*DAY);
export const auditCutoff=(now:string)=>iso(msOf(now)-AUDIT_RETENTION_DAYS*DAY);

// ── 역할 판정(서버 403과 화면 버튼이 같은 판정을 쓴다) ──
type Assigned=Pick<LeadRecord,'assigneeId'>;
export const isAdminRole=(role:string)=>role==='owner'||role==='admin';
export const isOwnLead=(who:Who,lead:Assigned)=>lead.assigneeId===who.id;
export const canSeeLead=(who:Who,lead:Assigned)=>isAdminRole(who.role)||lead.assigneeId===who.id||lead.assigneeId===null;
export const canEditLead=(who:Who,lead:Assigned)=>isAdminRole(who.role)||isOwnLead(who,lead);
export const canReveal=(who:Who,lead:Assigned)=>isAdminRole(who.role)||isOwnLead(who,lead);
// 증빙·계약이 있는 리드의 종결은 3년 보존 시계를 여는 관리자 결정이라 직원은 일반 단계에서만 종결한다.
export const canClose=(who:Who,lead:Assigned&Pick<LeadRecord,'stage'>)=>isAdminRole(who.role)||(isOwnLead(who,lead)&&isGeneralStage(lead.stage));
type ActionLead=Assigned&Pick<LeadRecord,'stage'|'basis'|'marketing'>&{contactState:ContactState};
// 화면이 보일 수 있는 이동 단계(서버가 다시 판정한다). 증빙 단계는 증빙 기록으로만 간다.
export function allowedMoves(who:Who,lead:ActionLead,enabled:boolean):LeadStage[]{
 const admin=isAdminRole(who.role),present=lead.contactState==='present';
 if(lead.stage==='closed')return [];
 const out:LeadStage[]=[];
 if(enabled&&present&&canEditLead(who,lead)&&isGeneralStage(lead.stage))out.push(...GENERAL_STAGES.filter(s=>s!==lead.stage));
 if(admin&&enabled&&present&&(lead.stage==='contracted'||lead.stage==='fee_escrowed'))out.push('opened');
 if(canClose(who,lead)&&(enabled||admin))out.push('closed');
 return out;
}
export function marketingOptions(who:Who,lead:ActionLead,enabled:boolean):('given'|'withdrawn')[]{
 const out:('given'|'withdrawn')[]=[];
 if(isAdminRole(who.role)&&enabled&&lead.contactState==='present'&&lead.marketing.status!=='given')out.push('given');
 if(lead.marketing.status==='given'&&canSeeLead(who,lead))out.push('withdrawn');
 return out;
}
// 화면이 보일 수 있는 POST 작업 이름. 서버가 같은 조건을 다시 본다.
export function leadActions(who:Who,lead:ActionLead,enabled:boolean):string[]{
 const admin=isAdminRole(who.role),present=lead.contactState==='present',closed=lead.stage==='closed',out:string[]=[];
 if(present&&canReveal(who,lead))out.push('reveal_contact');
 if(present&&canEditLead(who,lead)&&(enabled||admin))out.push('update_contact');
 if(present&&enabled&&canEditLead(who,lead))out.push('update_task');
 if(allowedMoves(who,lead,enabled).length)out.push('move_stage');
 if(admin&&enabled&&present&&closed)out.push('reopen_lead');
 if(enabled&&present&&lead.assigneeId===null)out.push('claim_lead');
 if(admin&&enabled&&present)out.push('assign_lead');
 if(present&&lead.basis.type==='referral'&&canEditLead(who,lead)&&(enabled||admin))out.push('record_source_notice');
 if(marketingOptions(who,lead,enabled).length)out.push('set_marketing_consent');
 if(admin&&enabled&&!closed)out.push('record_delivery','record_advice','record_forecast','record_contract','record_fee','record_agreement','void_evidence');
 if(admin&&lead.contactState!=='erased')out.push('erase_lead');
 out.push('add_subject_request');
 return out;
}

// ── 적격 점수(보드 정렬에만 쓴다. 자동 탈락 없음) ──
export function eligibilityScore(lead:Pick<LeadRecord,'task'|'firstContactAt'>,criteria:EligibilityCriteria|null|undefined):{met:number;total:4}|null{
 if(!criteria)return null;
 const met=[criteria.budgetBands.includes(lead.task.budgetBand),!!lead.task.region&&criteria.regions.includes(lead.task.region),criteria.timingBands.includes(lead.task.timingBand),lead.firstContactAt!==null].filter(Boolean).length;
 return {met,total:4};
}

// ── CSV(수식 주입 방지) ──
// 원문 첫 글자가 탭·CR이거나, NFKC 뒤 앞쪽 공백·폭 없는 문자를 건너뛴 첫 글자가 = + - @이면 '를 붙인다. 모든 칸은 따옴표로 감싼다.
export function csvCell(v:unknown):string{
 const raw=String(v??''),head=raw.normalize('NFKC').replace(/^[\s­​-‍⁠﻿]+/,'');
 const safe=/^[\t\r]/.test(raw)||/^[=+\-@]/.test(head)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
}
export const csvRow=(cells:readonly unknown[])=>cells.map(csvCell).join(',');
export const csvFile=(header:readonly string[],rows:readonly (readonly unknown[])[])=>'﻿'+[csvRow(header),...rows.map(csvRow)].join('\r\n');
export const EXPORT_COLUMNS=Object.freeze(['코드','단계','담당자 ID','유입','지역','예산','시기','수집 근거','광고성 정보','등록일','마지막 활동','이름','전화','이메일']);

// ── 시스템 코드 ──
// 'L' + CODE_ALPHABET 7자. 248 이상 바이트는 버려 31자에 고르게 나눈다(lib/tracking-codes.ts generateCode와 같은 방법). L은 점포(C·Q·P·U)·모집(R) 접두어와 겹치지 않는다.
export function leadSystemCode(random:Uint8Array):string|null{
 const n=CODE_ALPHABET.length,limit=256-256%n,chars=Array.from(random).filter(b=>b<limit).slice(0,7).map(b=>CODE_ALPHABET[b%n]);
 return chars.length===7?'L'+chars.join(''):null;
}

// ── 게이트 설명 ──
export type CodeMessage={code:string;message:string};
export const codeMessages=(codes:readonly string[])=>codes.map(code=>({code,message:(GATE_REASON_MESSAGES as Readonly<Record<string,string>>)[code]??code}));
export function describeGate(result:GateResult){return {ok:result.ok,reasons:codeMessages(result.reasons),warnings:codeMessages(result.warnings),ruleVersion:result.ruleVersion,disclaimer:GATE_DISCLAIMER}}
const sideOf=(s:SideWindow)=>({startDate:s.startDate,days:s.days,periodEnd:s.periodEnd,shortened:s.shortened,extended:s.extended});
// atKst: 'YYYY-MM-DD HH:mm KST'. +09:00 시각은 문자열을 자르고, 그 밖은 9시간을 더해 UTC 표기로 바꾼다.
export function kstLabel(at:string|null){if(!at)return null;const s=at.endsWith('+09:00')?at:iso(msOf(at)+9*3600000);return `${s.slice(0,10)} ${s.slice(11,16)} KST`}
export function describeWindow(w:ContractWindow){
 return {at:w.at,atKst:kstLabel(w.at),disclosureSide:sideOf(w.disclosureSide),draftSide:sideOf(w.draftSide),blockers:codeMessages(w.blockers),notes:codeMessages(w.notes),warnings:codeMessages(w.warnings),ruleVersion:w.ruleVersion,disclaimer:GATE_DISCLAIMER};
}

// 화면 선택 목록 묶음(intake 보기가 그대로 돌려준다).
export const FRANCHISE_LABELS={stages:STAGE_LABELS,budgets:BUDGET_LABELS,timings:TIMING_LABELS,sources:SOURCE_LABELS,basis:BASIS_LABELS,referralFrom:REFERRAL_LABELS,marketingMethods:MARKETING_METHOD_LABELS,marketingStatus:MARKETING_STATUS_LABELS,closeReasons:CLOSE_REASON_LABELS,revealPurposes:REVEAL_PURPOSE_LABELS,exportPurposes:EXPORT_PURPOSE_LABELS,backdateReasons:BACKDATE_REASON_LABELS,correctionReasons:CORRECTION_REASON_LABELS,subjectRequestTypes:SUBJECT_REQUEST_TYPE_LABELS,subjectRequestStatus:SUBJECT_REQUEST_STATUS_LABELS,subjectResolutions:SUBJECT_RESOLUTION_LABELS,subjectChannels:SUBJECT_CHANNEL_LABELS,branches:BRANCH_LABELS,contactFields:CONTACT_FIELD_LABELS,contactStates:CONTACT_STATE_LABELS,evidenceTypes:EVIDENCE_TYPE_LABELS,deliveryDocs:DELIVERY_DOC_LABELS,deliveryMethods:DELIVERY_METHOD_LABELS,electronicChannels:ELECTRONIC_CHANNEL_LABELS,handEvidence:HAND_EVIDENCE_LABELS,advisorTypes:ADVISOR_TYPE_LABELS,feeCategories:FEE_CATEGORY_LABELS,escrowInstitutions:ESCROW_INSTITUTION_LABELS,forecastDuty:FORECAST_DUTY_LABELS,eventTypes:EVENT_TYPE_LABELS,auditActions:AUDIT_ACTION_LABELS} as const;
