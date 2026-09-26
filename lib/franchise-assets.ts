// 트랙 R R15a-1 모집 자료 키트(순수). 모집 자료 유형 7종·고정 절, 원문 SHA-256, 입력 검사, 승인 체크리스트, 승인·내보내기 판정(R2 모집 범위 전체 판정·H8·각주·근거 사실), 재검토 표시, 설명회·견학·박람회(정원·신청·참석) 판정만 계산한다.
// 저장(D1 `recruitment_asset`·`recruitment_event` 레코드)·API·화면·스위치 읽기·세션 역할 판정·잠금·요청 제한·감사·워크스페이스 할 일은 R15a-2 몫이다. 시계를 읽지 않는다(now 인자). 외부 호출이 없고 해시 계산만 웹 암호 API를 쓴다.
// 근거: docs/FRANCHISE-RECRUITMENT-PLAN.ko.md 'R15'·'R2 구현 기록'·'R3 남은 일 (7)'. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님. 모델 경계: lib/franchise.ts·lib/franchise-server.ts·lib/franchise-crypto.ts를 import하지 않는다(tests/franchise-model-boundary.test.mjs).
import {FRANCHISE_RULES_VERSION,FRANCHISE_REVIEW_NET,isInstant,parseInstant,isDate,toKstDate,kstDateOf} from './franchise-rules';
import {judgeFranchiseText,franchiseGateError,franchiseIssueLabels,mentionedFranchiseFacts,type FranchiseJudgement} from './franchise-compliance';
import {factLine,footnoteIssues,franchiseFactUseIssue,versionStates,currentDisclosureVersion,FRANCHISE_FACT_MESSAGES,type VersionLite} from './franchise-facts';
import {GATE_DISCLAIMER} from './franchise-gates';
import {franchiseItem} from './fact-catalog';
import {isRecruitmentObjective} from './agency';
import type {BrandFact} from './brand-facts';

function deepFreeze<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const k of Object.keys(value))deepFreeze((value as Record<string,unknown>)[k])}
 return value;
}
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sortedUnique=<T extends string>(xs:readonly T[]):T[]=>[...new Set(xs)].sort(ascii);
const oneOf=<T extends string>(list:readonly T[],v:unknown):v is T=>typeof v==='string'&&(list as readonly string[]).includes(v);

// ── 버전·한도·패턴 ──
export const ASSETS_VERSION='fr-assets@2026-09-26.1';
export const CHECKLIST_VERSION='fr-assets-checklist@2026-09-26.1';
// 원문 20,000자에서 판정기는 약 0.2초 걸린다(실측). 배열 길이 상한을 넘는 기록은 invalid_record, 입력은 해당 입력 코드로 닫는다(fail closed).
export const LIMITS=deepFreeze({bodyChars:20000,factRefs:20,placements:20,labelChars:100,capacity:1000,assetRefs:10,codes:1000} as const);
// id는 서버가 만든 ASCII 값만 받는다. 가명 코드는 구분자('-'·'_')를 뺀 숫자 7자리 이상 연속을 막아 전화번호·주민번호 같은 값('010-0000-0101' 꼴 포함)이 코드로 들어오지 않게 한다.
// 판정은 비공개 정규식으로 한다. 내보내는 값은 얼린 사본이라 가져간 쪽이 compile을 불러도 이 모듈의 판정은 바뀌지 않는다.
const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/,PSEUDONYM_RE=/^[A-Za-z0-9_-]{6,64}$/,LONG_DIGITS=/\d{7}/,HEX64=/^[0-9a-f]{64}$/;
export const ID_PATTERN:RegExp=Object.freeze(new RegExp(ID_RE.source));
export const PSEUDONYM_PATTERN:RegExp=Object.freeze(new RegExp(PSEUDONYM_RE.source));

// ── 자료 유형 ──
export const ASSET_TYPES=deepFreeze(['event_deck','expo_banner','first_call_script','meta_lead_ad','naver_search','portal_intro','startup_page'] as const);
export type AssetType=typeof ASSET_TYPES[number];
export const ASSET_TYPE_ORDER=deepFreeze(['startup_page','portal_intro','naver_search','meta_lead_ad','expo_banner','event_deck','first_call_script'] as const);
export const ASSET_TYPE_LABELS:Readonly<Record<AssetType,string>>=deepFreeze({startup_page:'창업 페이지 문안',portal_intro:'포털 소개문',naver_search:'네이버 검색 문안',meta_lead_ad:'메타 리드광고 문안',expo_banner:'박람회 배너·리플렛 문안',event_deck:'설명회 덱 개요·원고',first_call_script:'첫 통화 스크립트'});
// 말로 쓰는 원고. 수익 안전망 경고(h.revenue_like_figure_review)를 이 두 유형에서만 409로 올린다.
export const SPOKEN_ASSET_TYPES=deepFreeze(['event_deck','first_call_script'] as const);

// ── 고정 절 ──
// heading = SECTION_MARK + title + (label ? ' ' + label : ''). 창업 페이지 문안에는 수익 수치 칸이 없다(H6). 나머지 5종은 자유 문안이라 절 검사를 하지 않는다.
export const SECTION_MARK='■ ';
export type SectionSpec={readonly id:string;readonly title:string;readonly label:string|null;readonly heading:string;readonly costLines:boolean;readonly fixedLines:readonly string[]};
export const WAITING_NOTES=deepFreeze([
 '정보공개서를 받은 날부터 14일(변호사·가맹거래사에게 정보공개서 자문을 받았다면 7일)이 지나기 전에는 가맹계약을 체결하거나 가맹금을 받지 않습니다.',
 '가맹계약서안을 받은 날부터 14일(계약서 자문을 받았다면 7일)이 지나기 전에도 가맹계약을 체결하거나 가맹금을 받지 않습니다.',
] as const);
export const REVENUE_QNA_NOTE='수익에 관한 질문은 정보공개서와 서면 자료로 안내합니다.';
const section=(id:string,title:string,label:string|null,costLines:boolean,fixedLines:readonly string[]):SectionSpec=>({id,title,label,heading:SECTION_MARK+title+(label?' '+label:''),costLines,fixedLines:[...fixedLines]});
const HEURISTIC_LABEL=`[${GATE_DISCLAIMER}]`;
export const STARTUP_PAGE_SECTIONS:readonly SectionSpec[]=deepFreeze([
 section('why','왜 이 브랜드인가','[의견]',false,[]),
 section('cost','창업비용 표','[사실]',true,[]),
 section('support','지원 내용','[조건·기간 병기]',false,[]),
 section('process','가맹 절차와 정보공개서 제공 뒤 대기기간',HEURISTIC_LABEL,false,WAITING_NOTES),
 section('faq','자주 묻는 질문',null,false,[]),
 section('contact','문의 경로',null,false,[]),
]);
// 설명회 표준 순서.
export const EVENT_DECK_SECTIONS:readonly SectionSpec[]=deepFreeze([
 section('story','브랜드 이야기','[의견]',false,[]),
 section('demo','메뉴 시연 또는 직영 공간 견학·시식',null,false,[]),
 section('cost','창업비용 표','[사실]',true,[]),
 section('support','지원','[조건·기간 병기]',false,[]),
 section('process','가맹 절차와 두 대기기간',HEURISTIC_LABEL,false,WAITING_NOTES),
 section('qna','질의응답',null,false,[REVENUE_QNA_NOTE]),
]);
const SECTIONS_OF:Readonly<Partial<Record<AssetType,readonly SectionSpec[]>>>=deepFreeze({startup_page:STARTUP_PAGE_SECTIONS,event_deck:EVENT_DECK_SECTIONS});

// ── 승인 체크리스트 ──
// 앞의 세 항목은 R2 5차 측정에서 판정기가 많이 놓친 유형이다(대기기간 우회 18건 중 13건, 단체 가입 조건 14건 중 10건, 본사 연계 자문 14건 중 9건). 판정 이슈는 registryId로 항목에 붙인다.
export const CHECKLIST_IDS=deepFreeze(['endorsement_disclosure','h7_branch_a','no_association_condition','no_captive_advisor','no_revenue_figures','no_wait_bypass'] as const);
export type ChecklistItemId=typeof CHECKLIST_IDS[number];
export type ChecklistItem={readonly id:ChecklistItemId;readonly text:string;readonly ruleIds:readonly string[]};
export const CHECKLIST_ITEMS:readonly ChecklistItem[]=deepFreeze([
 {id:'no_wait_bypass',text:"대기기간 우회 없음: 가계약금·예약금·선점금·홀딩비, 입금 순서로 자리 확정, '바로 계약·대기 없이' 같은 표현이 없고, 정보공개서·계약서안을 받은 날부터 14일(자문 시 7일)이 지나기 전에는 계약하거나 가맹금을 받지 않는다고 안내합니다.",ruleIds:['h.wait_bypass_solicitation','kr.fr.disclosure_wait','kr.fr.draft_wait']},
 {id:'no_association_condition',text:'단체 가입 조건 없음: 가맹점사업자단체 가입·미가입을 계약 조건이나 지원·불이익의 조건으로 적지 않았습니다.',ruleIds:['kr.fr.association_condition','kr.fr.association_condition_2026']},
 {id:'no_captive_advisor',text:'본사 연계 자문 없음: 본부가 변호사·가맹거래사·행정사 같은 자문자를 지정·소개하거나 비용을 대는 것처럼, 본부 연계 자문으로 계약이 빨라지는 것처럼 쓰지 않았습니다.',ruleIds:['h.advice_shortening_evidence','h.captive_advisor_phrase']},
 {id:'no_revenue_figures',text:'수익 수치 없음: 평균매출·월 매출·순수익·수익률·투자금 회수 기간을 예시 점주·돌려 말하기·질문 답변 형태로도 쓰지 않았고, 수익 질문은 서면 절차 안내로만 답합니다(H6).',ruleIds:['h.net_profit_payback_claims','h.revenue_figures_no_ad','kr.fr.revenue_guarantee']},
 {id:'h7_branch_a',text:'분기 A 확인: 가맹 준비도 분기 A(모집 가능)와 현재 정보공개서 등록 버전을 확인했습니다. 분기 B·C·판정 불가가 되면 유료 모집 광고·박람회·설명회·가맹 조건 제시를 멈춥니다(H7).',ruleIds:['h.pre_registration_recruiting']},
 {id:'endorsement_disclosure',text:"추천·보증 표시: 점주·대표 후기·인터뷰나 AI 가상인물이 있으면 경제적 이해관계와 '가상인물' 표시를 첫머리에 적었습니다(없으면 해당 없음으로 확인).",ruleIds:['kr.ad.endorsement_disclosure','kr.ad.virtual_human_label']},
]);
// 분기 리터럴은 이 모듈에 따로 둔다(lib/franchise.ts는 모델 경계 밖 리드 모듈이라 import하지 않는다). 'A'만 모집 가능이고 나머지·null·모르는 값은 모두 막는다(R4b BRANCH_BLOCKED와 같은 fail closed).
type Branch='A'|'B'|'C'|'undetermined';
// R3 남은 일 (7): 분기 B·C·판정 불가 브랜드의 objective 캠페인 체크리스트에 보일 H7 안내.
export const H7_NOTICES:Readonly<Record<Exclude<Branch,'A'>,string>>=deepFreeze({
 B:`분기 B(문의 수집만)입니다. 정보공개서 등록·변경등록이나 보완이 끝나기 전에는 유료 모집 광고·박람회·설명회·가맹 조건 제시와 가맹금·예약금 수령을 하지 않고, 브랜드 자체 채널에는 가맹 조건과 문의 유도 없이 브랜드 이야기만 씁니다(H7). 이 자료는 승인·내보내기할 수 없습니다. ${GATE_DISCLAIMER}`,
 C:`분기 C(모집 불가)입니다. 모집 광고와 가맹 상담을 하지 않습니다(H7). 이 자료는 승인·내보내기할 수 없습니다. ${GATE_DISCLAIMER}`,
 undetermined:`가맹 준비도 분기가 판정되지 않았습니다. 분기 A(모집 가능)로 기록되기 전에는 모집 자료를 승인·내보내지 않고 설명회·견학·박람회를 열지 않습니다(H7). ${GATE_DISCLAIMER}`,
});
const H8_ID='h.fact_opinion_labels';
export const ASSET_RULES:{readonly assetsVersion:string;readonly checklistVersion:string;readonly rulesVersion:string;readonly ruleIds:readonly string[];readonly disclaimer:string;readonly timezone:'+09:00'}=deepFreeze({
 assetsVersion:ASSETS_VERSION,checklistVersion:CHECKLIST_VERSION,rulesVersion:FRANCHISE_RULES_VERSION,
 ruleIds:sortedUnique([...CHECKLIST_ITEMS.flatMap(i=>i.ruleIds),H8_ID]),disclaimer:GATE_DISCLAIMER,timezone:'+09:00' as const,
});

// ── 저장 모양(R15a-2가 D1에 저장한다. 이름·연락처 필드는 없다) ──
export type AssetFactRef={id:string;version:number};
export type AssetRef={id:string;version:number};
export type AssetStatus='draft'|'approved'|'retired';
export type AssetApproval={by:string;role:'owner'|'admin';at:string;bodyHash:string;checklist:{version:string;checked:ChecklistItemId[]}};
// confirmedAt: KST 'YYYY-MM-DD'.
export type AssetPlacement={label:string;confirmedAt:string};
export type AssetExportRecord={at:string;by:string;role:'owner'|'admin';bodyHash:string;judgeVersion:string;assetsVersion:string;checklistVersion:string};
export const REVIEW_REASONS=deepFreeze(['fact_changed','version_changed'] as const);
export type ReviewReason=typeof REVIEW_REASONS[number];
export type AssetReview={needed:boolean;reasons:ReviewReason[];at:string|null};
export type RecruitmentAsset={id:string;brandId:string;campaignId:string;type:AssetType;version:number;body:string;bodyHash:string;factRefs:AssetFactRef[];disclosureVersionId:string|null;status:AssetStatus;approval:AssetApproval|null;placements:AssetPlacement[];exports:AssetExportRecord[];review:AssetReview;createdAt:string;updatedAt:string};
export const EVENT_TYPES=deepFreeze(['briefing','expo','tour'] as const);
export type EventType=typeof EVENT_TYPES[number];
export const EVENT_TYPE_LABELS:Readonly<Record<EventType,string>>=deepFreeze({briefing:'설명회',tour:'견학',expo:'박람회'});
export type EventCode={code:string;state:'applied'|'attended'|'no_show'};
export type EventCounts={applied:number;attended:number;noShow:number};
// assetRefs: 사용한 모집 자료 버전(id·version). spendRef: R5 모집 비용 기록 id 또는 null(존재 확인은 R-2). 행사 참석은 건수와 가명 코드 연결만 남긴다.
export type RecruitmentEvent={id:string;brandId:string;campaignId:string;type:EventType;startsAt:string;placeLabel:string;capacity:number;spendRef:string|null;counts:EventCounts;codes:EventCode[];assetRefs:AssetRef[];status:'scheduled'|'cancelled';version:number;createdAt:string;updatedAt:string};

// ── 사유 코드·결과 ──
export const ASSET_CODES=deepFreeze(['asset_not_approved','attendance_before_event','block_unresolved','branch_not_a','campaign_not_recruitment','campaign_other_brand','capacity_below_applied','capacity_full','checklist_incomplete','checklist_outdated','code_duplicate','code_unknown','cost_table_missing','event_cancelled','event_started','fact_changed','fact_other_brand','fact_ref_missing','fact_revenue','fact_source_missing','fact_stale','fact_store_scoped','footnote_missing','h8_label_missing','hard_block','hash_mismatch','invalid_body','invalid_code','invalid_counts','invalid_event','invalid_fact_refs','invalid_input','invalid_placement','invalid_record','invalid_timestamp','invalid_type','not_approved','not_draft','not_exported','record_other_brand','revenue_qna_note_missing','review_needed','role_forbidden','section_duplicate','section_missing','section_order','section_unknown','spoken_revenue_figure','switch_off','version_not_current','waiting_note_missing'] as const);
export type AssetCode=typeof ASSET_CODES[number];
// 한 판정 단계의 코드는 모두 같은 상태 코드다. 400: 클라이언트가 채울 입력·형식, 403: 역할, 409: 서버 상태(스위치·분기·승인·판정).
export const ASSET_CODE_STATUS:Readonly<Record<AssetCode,400|403|409>>=deepFreeze({
 asset_not_approved:409,attendance_before_event:400,block_unresolved:409,branch_not_a:409,campaign_not_recruitment:409,campaign_other_brand:400,capacity_below_applied:409,capacity_full:409,checklist_incomplete:400,checklist_outdated:409,
 code_duplicate:409,code_unknown:400,cost_table_missing:409,event_cancelled:409,event_started:409,fact_changed:409,fact_other_brand:400,fact_ref_missing:409,fact_revenue:409,fact_source_missing:409,
 fact_stale:409,fact_store_scoped:400,footnote_missing:409,h8_label_missing:409,hard_block:409,hash_mismatch:409,invalid_body:400,invalid_code:400,invalid_counts:400,invalid_event:400,
 invalid_fact_refs:400,invalid_input:400,invalid_placement:400,invalid_record:400,invalid_timestamp:400,invalid_type:400,not_approved:409,not_draft:409,not_exported:409,record_other_brand:400,
 revenue_qna_note_missing:409,review_needed:409,role_forbidden:403,section_duplicate:409,section_missing:409,section_order:409,section_unknown:409,spoken_revenue_figure:409,switch_off:409,version_not_current:409,
 waiting_note_missing:409,
});
// 고정 문구. 입력 값을 끼워 넣지 않는다. hard_block·block_unresolved는 판정 결과가 있으면 franchiseGateError 문구(원문 발췌 포함, 기존 발행 게이트와 같음)를 쓰고, 아래는 판정 결과가 없을 때의 문구다.
export const ASSET_MESSAGES:Readonly<Record<AssetCode,string>>=deepFreeze({
 asset_not_approved:'승인된 모집 자료 버전만 행사에 연결할 수 있습니다.',
 attendance_before_event:'행사일(KST) 전에는 참석·불참을 기록할 수 없습니다.',
 block_unresolved:'가맹 모집 규칙상 근거 사실이 필요한 표현이 남아 있습니다.',
 branch_not_a:`가맹 준비도 분기가 A(모집 가능)로 기록된 브랜드만 모집 자료를 승인·내보내고 설명회·견학·박람회를 열 수 있습니다(H7). ${GATE_DISCLAIMER}`,
 campaign_not_recruitment:'가맹 모집 목적 캠페인에서만 모집 자료와 행사를 만들 수 있습니다.',
 campaign_other_brand:'이 브랜드의 캠페인이 아닙니다.',
 capacity_below_applied:'정원은 이미 받은 신청 수보다 작게 줄일 수 없습니다.',
 capacity_full:'정원이 찼습니다. 신청을 더 받을 수 없습니다.',
 checklist_incomplete:'승인 체크리스트의 모든 항목을 확인해야 승인할 수 있습니다.',
 checklist_outdated:'승인 체크리스트가 바뀌었습니다. 새로고침하고 새 체크리스트로 다시 확인하세요.',
 code_duplicate:'이미 신청 기록이 있는 가명 코드입니다.',
 code_unknown:'신청 기록에 없는 가명 코드입니다.',
 cost_table_missing:'창업비용 표 절에 매장 유형별 총 창업비용과 선택한 창업비용 사실의 사실 줄(유형·금액·포함·불포함)을 그대로 넣으세요.',
 event_cancelled:'취소된 행사입니다.',
 event_started:'시작한 행사에는 신청을 받을 수 없습니다. 현장 참석은 참석 기록으로 남기세요.',
 fact_changed:'선택한 사실이 변경됐거나 확정·유효 상태가 아닙니다. 새로고침 후 다시 선택하세요.',
 fact_other_brand:'다른 브랜드의 사실은 이 브랜드 모집 자료의 근거로 쓸 수 없습니다.',
 fact_ref_missing:'원문에 값이 나온 가맹 사실을 근거 사실로 선택하세요. 사실이 바뀌면 이 자료를 재검토하기 위해 필요합니다.',
 fact_revenue:FRANCHISE_FACT_MESSAGES.revenueNoAd,
 fact_source_missing:FRANCHISE_FACT_MESSAGES.sourceMissingInUse,
 fact_stale:FRANCHISE_FACT_MESSAGES.staleFact,
 fact_store_scoped:'지점 사실은 브랜드 모집 자료의 근거로 쓸 수 없습니다.',
 footnote_missing:'가맹 사실의 정보공개서 각주 줄이 원문에 없습니다. 각주 줄을 바꾸지 말고 그대로 넣으세요.',
 h8_label_missing:'가맹 수치 문장에 [사실] 표지나 정보공개서 각주가 없습니다(H8).',
 hard_block:'가맹 모집 규칙상 쓸 수 없는 표현이 남아 있습니다(승인으로 풀 수 없음).',
 hash_mismatch:'원문이 확인·승인한 내용과 다릅니다. 새로고침하고 다시 승인하세요.',
 invalid_body:'원문은 1~20,000자이고 줄바꿈·탭 밖의 제어 문자를 넣을 수 없습니다.',
 invalid_code:'가명 코드 형식을 확인하세요.',
 invalid_counts:'참석·불참 건수를 확인하세요.',
 invalid_event:'행사 유형·장소 라벨·정원·비용 참조·연결 자료를 확인하세요.',
 invalid_fact_refs:'근거 사실 선택을 확인하세요(최대 20개, 중복 불가).',
 invalid_input:'입력 형식을 확인하세요.',
 invalid_placement:'게시 위치 라벨(1~100자)과 게시 확인일(내보낸 날부터 오늘까지의 날짜)을 확인하세요. 게시 위치는 20곳까지입니다.',
 invalid_record:'저장된 기록의 형식이 올바르지 않습니다.',
 invalid_timestamp:'시각은 시간대가 있는 ISO 8601이어야 합니다.',
 invalid_type:'자료 유형을 확인하세요.',
 not_approved:'승인된 자료만 내보낼 수 있습니다.',
 not_draft:'초안 상태의 자료만 승인할 수 있습니다.',
 not_exported:'내보낸 자료만 게시 위치를 기록할 수 있습니다.',
 record_other_brand:'이 브랜드의 기록이 아닙니다.',
 revenue_qna_note_missing:'질의응답 절에 수익 질문 안내 문장을 그대로 넣으세요(H6).',
 review_needed:'근거 사실이나 정보공개서 버전이 바뀌어 재검토가 필요합니다. 현재 사실로 새 버전을 저장하고 다시 승인하세요.',
 role_forbidden:'모집 자료 승인·내보내기·게시 기록과 행사 등록·변경은 대표·관리자만 할 수 있습니다.',
 section_duplicate:'고정 절 제목이 두 번 이상 있습니다.',
 section_missing:'고정 절 제목이 빠졌습니다. 제목 줄을 템플릿 그대로 두세요.',
 section_order:'고정 절 순서가 템플릿과 다릅니다.',
 section_unknown:'템플릿에 없는 절 제목(■)이 있습니다.',
 spoken_revenue_figure:`설명회 원고·첫 통화 스크립트에 수익처럼 보이는 수치가 있습니다. 수익 질문은 서면 절차 안내 문장으로만 답합니다(H6). ${GATE_DISCLAIMER}`,
 switch_off:'가맹 모집 기능이 꺼져 있어 모집 자료·행사를 저장·승인·내보낼 수 없습니다.',
 version_not_current:'자료를 저장할 때의 정보공개서 버전이 현재 등록 버전이 아닙니다. 현재 버전의 사실로 새 버전을 저장하세요.',
 waiting_note_missing:'가맹 절차 절에 두 대기기간 안내 문장을 그대로 넣으세요.',
});
// 막지 않는 경고.
export const ASSET_WARNING_MESSAGES=deepFreeze({briefingDeckMissing:'설명회에 승인된 설명회 덱(표준 순서)을 연결하지 않았습니다.'} as const);
// 상태 코드는 결정 객체로 돌려준다(lib/franchise-facts.ts FranchiseSaveCheck·franchiseGateError 관례). R15a-2: if(!d.ok) throw new ApiError(d.status,d.message).
export type Decision<T>=
 |{ok:true;status:200;value:T;warnings:string[];ruleVersion:string;disclaimer:string}
 |{ok:false;status:400|403|409;reasons:AssetCode[];message:string;judgement?:FranchiseJudgement;ruleVersion:string;disclaimer:string};
type Failure=Extract<Decision<never>,{ok:false}>;

// ── 입력·문맥 타입 ──
export type CampaignLite={id:string;brandId:string;objective?:unknown};
// facts: 이 브랜드의 사실 기록 전부와 참조 id로 읽은 다른 브랜드 기록(R15a-2가 넘긴다). versions: 정보공개서 버전(다른 브랜드 것이 섞여도 된다).
export type AssetContext={enabled:boolean;brandId:string;branch:string|null;campaign:CampaignLite|null;facts:readonly BrandFact[];versions:readonly VersionLite[];now:string};
export type AssetActor={id:string;role:string};
export type AssetInputValue={type:AssetType;body:string;factRefs:AssetFactRef[];disclosureVersionId:string|null;judgement:FranchiseJudgement};
export type GateContext={brandId:string;facts:readonly BrandFact[];versions:readonly VersionLite[];now:string};
export type GateIssues={codes:AssetCode[];status:200|400|409;judgement:FranchiseJudgement|null;message:string|null};
export type ApprovalChecklist={version:string;items:{id:ChecklistItemId;text:string;ruleIds:string[];warnings:string[]}[];h7Notice:string|null};
export type EventContext={enabled:boolean;brandId:string;branch:string|null;campaign:CampaignLite|null;assets:readonly Pick<RecruitmentAsset,'id'|'version'|'brandId'|'status'|'type'>[];actor:AssetActor;now:string};
export type EventOpContext={enabled:boolean;brandId:string;branch:string|null;now:string};
export type EventInputValue={type:EventType;startsAt:string;placeLabel:string;capacity:number;spendRef:string|null;assetRefs:AssetRef[]};

// ── 공통 보조 ──
const isStr=(v:unknown):v is string=>typeof v==='string';
const filled=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
// 배열 원소 검사는 빈 칸(sparse hole)을 undefined로 채운 사본에 한다(every·some·filter는 빈 칸을 건너뛴다). JSON에는 빈 칸이 없지만 순수 함수 호출자에게도 fail closed다.
const dense=(v:readonly unknown[]):unknown[]=>Array.from(v);
const strList=(v:unknown):v is string[]=>Array.isArray(v)&&dense(v).every(isStr);
const validId=(v:unknown):v is string=>typeof v==='string'&&ID_RE.test(v);
const posInt=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;
const countInt=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const ctxOf=(v:unknown):Record<string,unknown>=>isRecord(v)?v:{};
const byId=<T extends {id:string}>(xs:readonly T[]):T[]=>[...xs].sort((a,b)=>ascii(a.id,b.id));
// 원문·라벨·actor id에 넣을 수 없는 문자를 찾는다: C0·C1 제어 문자(U+0000–U+001F·U+007F–U+009F, 원문의 줄바꿈·탭만 허용), 짝 없는 서로게이트, 줄·문단 구분(U+2028·U+2029),
// 사용자 정의 영역(U+E000–U+F8FF, 15·16평면), 미할당(Cn, 비문자 U+FDD0–U+FDEF·끝이 FFFE·FFFF 포함). 판정기 matchView는 Cf·M만 지우므로 이런 문자로 낱말을 끊으면 판정을 비껴가고,
// 검토자에게는 보이지 않거나 줄로 보인다(lib/prompt-units.ts hiddenChars 선례). 명세 3.4의 U+0000–U+001F·U+007F 범위를 fail closed로 넓혔다(교차 검토 반영).
// 범위는 정규식 대신 codePointAt 루프로 본다(lint no-control-regex 기준선 유지). 미할당만 \p{Cn}으로 본다(런타임 유니코드 표 기준, 비문자는 표와 무관하게 늘 Cn).
// 짝 없는 서로게이트는 UTF-8로 바꿀 때 U+FFFD가 되어 서로 다른 원문이 같은 해시가 될 수 있으므로 함께 막는다.
const UNASSIGNED=/\p{Cn}/u;
function hasControl(s:string,allowBreaks:boolean):boolean{
 for(let i=0;i<s.length;){
  const c=s.codePointAt(i)??0;
  if((c<0x20&&!(allowBreaks&&(c===0x0a||c===0x09)))||(c>=0x7f&&c<=0x9f)||(c>=0xd800&&c<=0xdfff)||c===0x2028||c===0x2029||(c>=0xe000&&c<=0xf8ff)||c>=0xf0000)return true;
  i+=c>0xffff?2:1;
 }
 return UNASSIGNED.test(s);
}
// 저장 전 정규화는 여기 한 곳뿐이다: CRLF·CR → LF, 유니코드 NFC. 해시(assetBodyHash)는 정규화하지 않는다.
const normalBody=(s:string)=>s.replace(/\r\n?/g,'\n').normalize('NFC');
// 원문 불변식(입력 검사와 저장된 기록이 같이 쓴다): 정규형이고, trim이 비지 않고, 20,000자 이하이고, 금지 문자가 없다.
const bodyOk=(v:unknown):v is string=>typeof v==='string'&&v.length<=LIMITS.bodyChars&&!!v.trim()&&!hasControl(v,true)&&normalBody(v)===v;
const labelOf=(v:unknown):string|null=>{
 if(typeof v!=='string')return null;
 const s=v.normalize('NFC').trim();
 return s.length>=1&&s.length<=LIMITS.labelChars&&!hasControl(s,false)?s:null;
};
const actorIdOk=(v:unknown):v is string=>typeof v==='string'&&v.length>=1&&v.length<=200&&!hasControl(v,false);
// 대표·관리자만. 그 밖의 역할과 형식이 틀린 actor는 모두 403(fail closed).
const adminActor=(a:unknown):a is {id:string;role:'owner'|'admin'}=>isRecord(a)&&actorIdOk(a.id)&&(a.role==='owner'||a.role==='admin');
// 명세 2.1의 숫자 7자리 규칙을 그 목적(전화·주민번호 차단)대로 구분자를 뺀 값에 적용한다(fail closed 강화, 교차 검토 반영).
const pseudonymOk=(v:unknown):v is string=>typeof v==='string'&&PSEUDONYM_RE.test(v)&&!LONG_DIGITS.test(v.replace(/[-_]/g,''));
function refsOk(v:unknown,max:number):v is AssetRef[]{
 if(!Array.isArray(v)||v.length>max||!dense(v).every(x=>isRecord(x)&&validId(x.id)&&posInt(x.version)))return false;
 return new Set(v.map(x=>(x as AssetRef).id)).size===v.length;
}
const refList=(v:readonly AssetRef[]):AssetRef[]=>v.map(r=>({id:r.id,version:r.version})).sort((a,b)=>ascii(a.id,b.id)||a.version-b.version);
const sameRefs=(a:unknown,b:readonly AssetRef[])=>{
 if(!refsOk(a,Number.MAX_SAFE_INTEGER))return false;
 const x=refList(a);
 return x.length===b.length&&x.every((r,i)=>r.id===b[i].id&&r.version===b[i].version);
};
function factOk(f:unknown):f is BrandFact{
 if(!isRecord(f))return false;
 const r=f.sourceRef,c=f.cost;
 return isStr(f.id)&&isStr(f.brandId)&&(f.storeId===undefined||f.storeId===null||isStr(f.storeId))&&isStr(f.key)&&isStr(f.value)&&isStr(f.status)&&isStr(f.source)&&isStr(f.verifiedAt)&&isStr(f.validUntil)&&typeof f.version==='number'&&Number.isSafeInteger(f.version)
  &&(r===undefined||r===null||(isRecord(r)&&isStr(r.disclosureVersionId)&&typeof r.fiscalYear==='number'&&Number.isSafeInteger(r.fiscalYear)&&(r.page===undefined||r.page===null||typeof r.page==='number')&&(r.asOf===undefined||isStr(r.asOf))))
  &&(c===undefined||c===null||(isRecord(c)&&isStr(c.storeType)&&strList(c.includes)&&strList(c.excludes)&&(c.areaM2===undefined||c.areaM2===null||typeof c.areaM2==='number')));
}
const versionOk=(v:unknown):v is VersionLite=>isRecord(v)&&isStr(v.id)&&isStr(v.brandId)&&isStr(v.label)&&(v.registeredAt===null||isStr(v.registeredAt))&&isStr(v.validFrom)&&isStr(v.validUntil)&&isStr(v.status);
// 문맥의 사실·버전 기록. 하나라도 형식이 틀리면 invalid_record로 닫는다(판정기에 넘기기 전).
function recordsOf(c:Record<string,unknown>):{facts:BrandFact[];versions:VersionLite[]}|null{
 const facts=c.facts,versions=c.versions;
 return Array.isArray(facts)&&dense(facts).every(factOk)&&Array.isArray(versions)&&dense(versions).every(versionOk)?{facts,versions}:null;
}
const ASSET_STATUSES:readonly AssetStatus[]=['draft','approved','retired'];
// 저장된 원문도 입력 검사와 같은 불변식(bodyOk)과 16진 64자 해시를 지켜야 한다. 다른 쓰기 경로·잘못된 기록의 원문이 판정기를 비껴가지 못하게 invalid_record로 닫는다(교차 검토 반영).
function assetOk(a:unknown):a is RecruitmentAsset{
 if(!isRecord(a))return false;
 const rv=a.review;
 return validId(a.id)&&filled(a.brandId)&&filled(a.campaignId)&&oneOf(ASSET_TYPES,a.type)&&posInt(a.version)&&bodyOk(a.body)&&isStr(a.bodyHash)&&HEX64.test(a.bodyHash)&&refsOk(a.factRefs,LIMITS.factRefs)
  &&(a.disclosureVersionId===null||isStr(a.disclosureVersionId))&&oneOf(ASSET_STATUSES,a.status)&&(a.approval===null||isRecord(a.approval))
  &&Array.isArray(a.placements)&&a.placements.length<=LIMITS.placements&&dense(a.placements).every(isRecord)&&Array.isArray(a.exports)&&dense(a.exports).every(x=>isRecord(x)&&isInstant(x.at))
  &&isRecord(rv)&&typeof rv.needed==='boolean'&&Array.isArray(rv.reasons)&&dense(rv.reasons).every(x=>oneOf(REVIEW_REASONS,x))&&(rv.at===null||isStr(rv.at))&&isStr(a.createdAt)&&isStr(a.updatedAt);
}
const CODE_STATES:readonly EventCode['state'][]=['applied','attended','no_show'];
function codesOk(v:unknown,states:readonly EventCode['state'][]):v is EventCode[]{
 if(!Array.isArray(v)||v.length>LIMITS.codes||!dense(v).every(x=>isRecord(x)&&pseudonymOk(x.code)&&oneOf(states,x.state)))return false;
 return new Set(v.map(x=>(x as EventCode).code)).size===v.length;
}
const capacityOk=(v:unknown):v is number=>posInt(v)&&v<=LIMITS.capacity;
function eventOk(e:unknown):e is RecruitmentEvent{
 if(!isRecord(e))return false;
 const n=e.counts;
 return validId(e.id)&&filled(e.brandId)&&filled(e.campaignId)&&oneOf(EVENT_TYPES,e.type)&&isInstant(e.startsAt)&&isStr(e.placeLabel)&&capacityOk(e.capacity)&&(e.spendRef===null||validId(e.spendRef))
  &&isRecord(n)&&countInt(n.applied)&&countInt(n.attended)&&countInt(n.noShow)&&codesOk(e.codes,CODE_STATES)&&refsOk(e.assetRefs,LIMITS.assetRefs)
  &&(e.status==='scheduled'||e.status==='cancelled')&&posInt(e.version)&&isStr(e.createdAt)&&isStr(e.updatedAt);
}
// 버전 라벨은 NFC로 맞춘 사본을 쓴다. 저장소는 라벨을 trim만 하고 원문은 NFC로 저장되므로, 각주 줄 비교가 NFD 라벨에서 늘 실패하지 않게 한다.
const brandVersionsOf=(versions:readonly VersionLite[],brandId:string)=>byId(versions.filter(v=>v.brandId===brandId).map(v=>({...v,label:v.label.normalize('NFC')})));

// ── 결정 ──
const JUDGE_CODES:readonly AssetCode[]=['block_unresolved','hard_block'];
// 판정기 문구(있으면)를 먼저 두고 나머지 코드의 고정 문구를 ASCII 순으로 공백 하나로 잇는다.
function messageOf(reasons:readonly AssetCode[],j:FranchiseJudgement|null):string{
 const head=j&&reasons.some(c=>JUDGE_CODES.includes(c))?franchiseGateError(j)?.message??null:null;
 return [...(head?[head]:[]),...reasons.filter(c=>!(head&&JUDGE_CODES.includes(c))).map(c=>ASSET_MESSAGES[c])].join(' ');
}
function fail(codes:readonly AssetCode[],j:FranchiseJudgement|null=null):Failure{
 const reasons=sortedUnique(codes);
 return {ok:false,status:ASSET_CODE_STATUS[reasons[0]],reasons,message:messageOf(reasons,j),...(j?{judgement:j}:{}),ruleVersion:ASSETS_VERSION,disclaimer:GATE_DISCLAIMER};
}
const pass=<T>(value:T,warnings:string[]=[]):Decision<T>=>({ok:true,status:200,value,warnings,ruleVersion:ASSETS_VERSION,disclaimer:GATE_DISCLAIMER});
// 판정 함수는 던지지 않는다. 예상하지 못한 예외도 결정으로 닫는다: 입력 시각 오류(FranchiseInputError)는 invalid_timestamp, 그 밖은 invalid_record.
const errorCode=(e:unknown):AssetCode=>isRecord(e)&&e.name==='FranchiseInputError'?'invalid_timestamp':'invalid_record';
function guarded<T>(run:()=>Decision<T>):Decision<T>{try{return run()}catch(e){return fail([errorCode(e)])}}
async function guardedAsync<T>(run:()=>Promise<Decision<T>>):Promise<Decision<T>>{try{return await run()}catch(e){return fail([errorCode(e)])}}

// ── 원문 해시 ──
// 받은 문자열의 UTF-8 바이트를 정규화 없이 SHA-256한다(내보낸 원문 바이트와 증빙 해시가 1:1). 문자열이 아니면 ''라 비교가 늘 실패한다.
export async function assetBodyHash(body:string):Promise<string>{
 if(typeof body!=='string')return '';
 const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
 return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}

// ── 사실 해석 ──
// 브랜드 단위 유효 확정 사실: 같은 브랜드, 지점 사실 아님, confirmed, 출처 있음, verifiedAt ≤ now < validUntil(parseInstant). effectiveBrandFacts(facts,brandId,undefined,ms)와 같다.
function effectiveOf(facts:readonly BrandFact[],now:string,brandId?:string):BrandFact[]{
 if(!Array.isArray(facts)||!isInstant(now))return [];
 const t=parseInstant(now);
 return facts.filter(f=>isRecord(f)&&(brandId===undefined||f.brandId===brandId)&&!f.storeId&&f.status==='confirmed'&&typeof f.source==='string'&&!!f.source.trim()&&isInstant(f.verifiedAt)&&isInstant(f.validUntil)&&parseInstant(f.verifiedAt)<=t&&t<parseInstant(f.validUntil));
}
export function effectiveAssetFacts(facts:readonly BrandFact[],brandId:string,now:string):BrandFact[]{return typeof brandId==='string'?effectiveOf(facts,now,brandId):[]}
const USE_CODE:Readonly<Record<'revenueNoAd'|'sourceMissingInUse'|'staleFact',AssetCode>>={revenueNoAd:'fact_revenue',sourceMissingInUse:'fact_source_missing',staleFact:'fact_stale'};
// 참조 사실 해석. 입력 단계(400: 다른 브랜드·지점 사실)를 모두 모으고, 있으면 멈춘다. 다음 상태 단계(409)를 모두 모은다.
// 원본이 없는 경우는 409 fact_changed다(기존 resolveFacts와 같고, 다른 소유자의 사실 id인지 드러내지 않는다). 같은 id 기록이 둘 이상이면 모호하므로 fact_changed.
function resolveRefs(refs:readonly AssetFactRef[],facts:readonly BrandFact[],brandId:string,now:string,brandVersions:readonly VersionLite[]):{codes:AssetCode[];facts:BrandFact[]}{
 const input:AssetCode[]=[];
 for(const r of refs){
  const same=facts.filter(f=>f.id===r.id);
  if(same.some(f=>f.brandId!==brandId))input.push('fact_other_brand');
  else if(same.some(f=>!!f.storeId))input.push('fact_store_scoped');
 }
 if(input.length)return {codes:input,facts:[]};
 const valid=new Set(effectiveAssetFacts(facts,brandId,now)),states=versionStates(brandVersions,now),state:AssetCode[]=[],out:BrandFact[]=[];
 for(const r of refs){
  const same=facts.filter(f=>f.id===r.id),f=same.length===1?same[0]:undefined;
  if(!f||f.version!==r.version||!valid.has(f)){state.push('fact_changed');continue}
  const use=franchiseFactUseIssue(f,states);
  if(use){state.push(USE_CODE[use]);continue}
  out.push(f);
 }
 return {codes:state,facts:out};
}
// 판정기는 참조한 사실만 근거로 본다(주장 → 근거 → 승인). 이 브랜드의 유효한 수익 항목(adUse:false) 사실은 H6 수익 값 탐지에만 더한다. id로 중복을 없애고 id 순으로 둔다.
function judgeFactsOf(refFacts:readonly BrandFact[],effective:readonly BrandFact[]):BrandFact[]{
 const out=new Map<string,BrandFact>();
 for(const f of [...refFacts,...effective.filter(x=>franchiseItem(x.key)?.adUse===false)])if(!out.has(f.id))out.set(f.id,f);
 return byId([...out.values()]);
}

// ── 입력 검사 ──
// 초안 저장에는 직원도 된다(역할·분기를 보지 않는다). 해제 불가 표현이 있어도 초안 저장은 성공하고, 판정은 승인·내보내기에서 막는다(value.judgement는 미리보기).
export function validateAssetInput(input:unknown,ctx:AssetContext):Decision<AssetInputValue>{
 return guarded(()=>{
  const c=ctxOf(ctx),now=c.now;
  if(!isInstant(now))return fail(['invalid_timestamp']);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!isRecord(input))return fail(['invalid_input']);
  const codes:AssetCode[]=[],type=input.type,body=typeof input.body==='string'?normalBody(input.body):null,refs=input.factRefs;
  if(!oneOf(ASSET_TYPES,type))codes.push('invalid_type');
  if(body===null||!bodyOk(body))codes.push('invalid_body');
  if(!refsOk(refs,LIMITS.factRefs))codes.push('invalid_fact_refs');
  if(codes.length||!oneOf(ASSET_TYPES,type)||body===null||!refsOk(refs,LIMITS.factRefs))return fail(codes);
  const brandId=c.brandId,campaign=c.campaign;
  if(!filled(brandId)||!isRecord(campaign)||campaign.brandId!==brandId)return fail(['campaign_other_brand']);
  if(!isRecruitmentObjective(campaign))return fail(['campaign_not_recruitment']);
  const records=recordsOf(c);
  if(!records)return fail(['invalid_record']);
  const factRefs=refList(refs),brandVersions=brandVersionsOf(records.versions,brandId),resolved=resolveRefs(factRefs,records.facts,brandId,now,brandVersions);
  if(resolved.codes.length)return fail(resolved.codes);
  const effective=byId(effectiveAssetFacts(records.facts,brandId,now));
  const j=judgeFranchiseText({text:body,at:now,now,scope:'recruitment',brandId,facts:judgeFactsOf(resolved.facts,effective),versions:brandVersions});
  return pass({type,body,factRefs,disclosureVersionId:currentDisclosureVersion(brandVersions,brandId,now)?.id??null,judgement:j},franchiseIssueLabels(j).warnings);
 });
}

// ── 초안 ──
// 검사를 통과한 값만 받는다(판정하지 않는다). 유형·원문·참조(id·version)·정보공개서 버전이 모두 같고 prev를 아직 쓸 수 있으면 prev를 그대로 돌려준다(쓰기 없음, 승인 유지).
// 쓸 수 있음 = 재검토 표시가 없고, 초안이거나 현재 체크리스트 버전으로 승인된 기록. 재검토 표시·옛 체크리스트 승인·승인 없는 approved·폐기는 같은 원문이어도 새 초안 버전을 만든다.
// 그래야 review_needed·checklist_outdated 문구가 안내하는 '새 버전 저장 뒤 재승인' 길이 막히지 않는다(교차 검토 반영). 폐기 기록을 같은 원문으로 다시 초안으로 되살리는 것은 리뷰 포인트다.
const keepable=(p:RecruitmentAsset):boolean=>isRecord(p.review)&&p.review.needed===false
 &&(p.status==='draft'||(p.status==='approved'&&isRecord(p.approval)&&isRecord(p.approval.checklist)&&p.approval.checklist.version===CHECKLIST_VERSION));
export async function draftAsset(prev:RecruitmentAsset|null,value:AssetInputValue,meta:{id:string;brandId:string;campaignId:string;now:string}):Promise<RecruitmentAsset>{
 const factRefs=refList(value.factRefs);
 if(prev&&keepable(prev)&&prev.type===value.type&&prev.body===value.body&&sameRefs(prev.factRefs,factRefs)&&prev.disclosureVersionId===value.disclosureVersionId)return prev;
 return {id:meta.id,brandId:meta.brandId,campaignId:meta.campaignId,type:value.type,version:(prev?.version??0)+1,body:value.body,bodyHash:await assetBodyHash(value.body),factRefs,disclosureVersionId:value.disclosureVersionId,
  status:'draft',approval:null,placements:[],exports:[],review:{needed:false,reasons:[],at:null},createdAt:prev?.createdAt??meta.now,updatedAt:meta.now};
}

// ── 절 구조 ──
// 창업 페이지 문안·설명회 덱: 절마다 제목과 고정 문장을 줄바꿈으로 잇고 절 사이는 빈 줄 하나. 창업비용 표 몸통은 비운다(R15a-2가 factCaption으로 채운다). 그 밖의 유형은 ''.
export function sectionTemplate(type:unknown):string{
 const sections=oneOf(ASSET_TYPES,type)?SECTIONS_OF[type]:undefined;
 return sections?sections.map(s=>[s.heading,...s.fixedLines].join('\n')).join('\n\n'):'';
}
const FIXED_LINE_CODE:Readonly<Record<string,AssetCode>>={process:'waiting_note_missing',qna:'revenue_qna_note_missing'};
const MARK=SECTION_MARK.trim();
// 줄은 '\n'과, 화면에서 줄로 보일 수 있는 U+0085·U+2028·U+2029로 나눈다. 저장 원문에는 이 문자가 없지만(bodyOk) 직접 부르는 미리보기 원문에서도 ■ 줄을 놓치지 않는다(fail closed).
const LINE_BREAK=/\n|\u0085|\u2028|\u2029/;
// facts는 이 브랜드의 사실이다(assetGateIssues가 브랜드로 걸러 넘긴다). 제목 줄은 trim이 명세 heading과 정확히 같은 줄이다. 제목이 아닌데 ■로 시작하는 줄(공백 없는 '■수익' 포함)은 section_unknown이다.
// 절 몸통은 제목 다음 줄부터 다음 제목 줄 또는 ■ 줄 앞까지이고, 몸통 줄 비교는 trim하지 않은 정확 일치다(footnoteIssues와 같다). 사실 줄은 NFC로 맞춰 비교한다(원문은 NFC로 저장되고 사실 값은 NFC가 아닐 수 있다).
export function assetStructureIssues(type:unknown,body:unknown,refFacts:readonly BrandFact[],facts:readonly BrandFact[],versions:readonly VersionLite[],now:string):AssetCode[]{
 const sections=oneOf(ASSET_TYPES,type)?SECTIONS_OF[type]:undefined;
 if(!sections)return [];
 if(typeof body!=='string')return ['section_missing'];
 try{
  const lines=body.split(LINE_BREAK),headings=sections.map(s=>s.heading),codes:AssetCode[]=[],found=new Map<string,number[]>(),breaks:number[]=[];
  lines.forEach((line,i)=>{
   const t=line.trim();
   if(headings.includes(t)){found.set(t,[...(found.get(t)??[]),i]);breaks.push(i)}
   else if(t.startsWith(MARK)){codes.push('section_unknown');breaks.push(i)}
  });
  let last=-1;
  for(const h of headings){
   const at=found.get(h);
   if(!at){codes.push('section_missing');continue}
   if(at.length>1)codes.push('section_duplicate');
   if(at[0]<last)codes.push('section_order');
   last=Math.max(last,at[0]);
  }
  const bodyOf=(s:SectionSpec):Set<string>=>{const at=found.get(s.heading);if(!at)return new Set();const end=breaks.find(b=>b>at[0])??lines.length;return new Set(lines.slice(at[0]+1,end))};
  const states=versionStates(versions,now);
  for(const s of sections){
   const own=bodyOf(s);
   if(s.costLines){
    // 필요한 비용 사실 = 참조 사실 중 창업비용 구성 항목 ∪ 이 브랜드의 유효하고 현재 버전인 총 창업비용 사실 전부(매장 유형별). 0개이거나 사실 줄 하나라도 몸통에 없으면 cost_table_missing.
    const required=new Map<string,BrandFact>();
    for(const f of [...refFacts.filter(x=>franchiseItem(x.key)?.storeType==='required'),...effectiveOf(facts,now).filter(x=>franchiseItem(x.key)?.key==='startup_cost_total'&&!!x.sourceRef&&states[x.sourceRef.disclosureVersionId]==='current')])required.set(f.id,f);
    if(!required.size||[...required.values()].some(f=>!factLine(f).normalize('NFC').split(LINE_BREAK).every(l=>own.has(l))))codes.push('cost_table_missing');
   }
   if(s.fixedLines.some(l=>!own.has(l)))codes.push(FIXED_LINE_CODE[s.id]);
  }
  return sortedUnique(codes);
 }catch{return ['section_missing']}
}

// ── 내용 게이트(승인·내보내기·미리보기 공유) ──
const gateOf=(codes:readonly AssetCode[],j:FranchiseJudgement|null):GateIssues=>{
 const reasons=sortedUnique(codes);
 return reasons.length?{codes:reasons,status:ASSET_CODE_STATUS[reasons[0]] as 400|409,judgement:j,message:messageOf(reasons,j)}:{codes:[],status:200,judgement:j,message:null};
};
// 1) 저장 당시 정보공개서 버전이 현재 등록 버전인가 2) 참조 사실(400 → 409) 3) 내용(모두 모음, 409): 절 구조, R2 모집 범위 판정, H8 표지(경고를 409로), 각주, 원문에 값이 나온 사실의 참조, 말로 쓰는 원고의 수익 안전망.
function contentGate(asset:RecruitmentAsset,g:{brandId:string;facts:readonly BrandFact[];versions:readonly VersionLite[];now:string}):GateIssues{
 const brandVersions=brandVersionsOf(g.versions,g.brandId),current=currentDisclosureVersion(brandVersions,g.brandId,g.now);
 if(!current||asset.disclosureVersionId!==current.id)return gateOf(['version_not_current'],null);
 const resolved=resolveRefs(refList(asset.factRefs),g.facts,g.brandId,g.now,brandVersions);
 if(resolved.codes.length)return gateOf(resolved.codes,null);
 const effective=byId(effectiveAssetFacts(g.facts,g.brandId,g.now)),judgeFacts=judgeFactsOf(resolved.facts,effective);
 const j=judgeFranchiseText({text:asset.body,at:g.now,now:g.now,scope:'recruitment',brandId:g.brandId,facts:judgeFacts,versions:brandVersions});
 const codes:AssetCode[]=assetStructureIssues(asset.type,asset.body,resolved.facts,g.facts.filter(f=>f.brandId===g.brandId),brandVersions,g.now);
 if(j.hardBlocked)codes.push('hard_block');
 // H9로 올린 경고도 tier block이라 여기에 든다.
 if(j.issues.some(x=>x.tier==='block'))codes.push('block_unresolved');
 // H8은 판정기에서 경고지만 내보낼 자료에는 409다.
 if(j.issues.some(x=>x.ruleId===H8_ID))codes.push('h8_label_missing');
 const mentioned=(facts:readonly BrandFact[])=>mentionedFranchiseFacts({text:asset.body,now:g.now,brandId:g.brandId,facts,versions:brandVersions});
 if(footnoteIssues(asset.body,{used:resolved.facts.filter(f=>!!f.sourceRef),mentioned:mentioned(judgeFacts)},brandVersions).length)codes.push('footnote_missing');
 const refIds=new Set(asset.factRefs.map(r=>r.id));
 if(mentioned(effective).some(f=>!refIds.has(f.id)))codes.push('fact_ref_missing');
 // 안전망 경고를 말로 쓰는 원고에서만 409로 올린다(첫 통화 스크립트 포함은 계획 수용 기준보다 넓은 강화). 예치 안전망은 모든 유형에서 경고로 두고 체크리스트에 보인다.
 if(oneOf(SPOKEN_ASSET_TYPES,asset.type)&&j.issues.some(x=>x.ruleId===FRANCHISE_REVIEW_NET.id))codes.push('spoken_revenue_figure');
 return gateOf(codes,j);
}
export function assetGateIssues(asset:unknown,ctx:GateContext):GateIssues{
 try{
  const c=ctxOf(ctx),now=c.now,brandId=c.brandId;
  if(!isInstant(now))return gateOf(['invalid_timestamp'],null);
  const records=recordsOf(c);
  if(!assetOk(asset)||!filled(brandId)||!records)return gateOf(['invalid_record'],null);
  if(asset.brandId!==brandId)return gateOf(['record_other_brand'],null);
  return contentGate(asset,{brandId,now,...records});
 }catch(e){return gateOf([errorCode(e)],null)}
}

// ── 승인 체크리스트 ──
// 판정 경고(tier warn)는 registryId가 항목의 ruleIds에 있으면 그 항목 옆에 보인다: 예치 안전망 → 대기기간 우회, 수익 안전망 → 수익 수치, 추천·보증 경고 → 추천·보증 표시.
function checklistWarnings(j:unknown):{registryId:string;text:string}[]{
 if(!isRecord(j)||!Array.isArray(j.issues))return [];
 try{
  const judgement=j as FranchiseJudgement,warn=judgement.issues.filter(x=>x.tier==='warn'),labels=franchiseIssueLabels(judgement).warnings;
  return warn.map((x,k)=>({registryId:String(x.registryId),text:labels[k]}));
 }catch{return []}
}
export function h7Notice(branch:unknown):string|null{return branch==='A'?null:branch==='B'?H7_NOTICES.B:branch==='C'?H7_NOTICES.C:H7_NOTICES.undetermined}
export function approvalChecklist(judgement:FranchiseJudgement|null,branch:unknown):ApprovalChecklist{
 const warned=checklistWarnings(judgement);
 return {version:CHECKLIST_VERSION,items:CHECKLIST_ITEMS.map(i=>({id:i.id,text:i.text,ruleIds:[...i.ruleIds],warnings:warned.filter(w=>i.ruleIds.includes(w.registryId)).map(w=>w.text)})),h7Notice:h7Notice(branch)};
}
// 빈 칸이 있는 배열은 빈 칸을 undefined로 본다(길이·Set 크기가 맞아도 빠진 항목이 있으면 미완료).
const completeChecklist=(checked:readonly unknown[])=>{
 if(checked.length!==CHECKLIST_IDS.length)return false;
 const xs=dense(checked);
 return new Set(xs).size===xs.length&&xs.every(x=>oneOf(CHECKLIST_IDS,x));
};

// ── 승인·내보내기 공통 앞 단계 ──
// now → 스위치(409) → 역할(403) → 기록 형식·브랜드(400) → 분기 A(409) → 캠페인(400) → 모집 목적(409). R15a-2 라우트의 OFF(409)·ADMIN_ONLY(403)와 같은 순서의 방어 중복이다.
type Ready={asset:RecruitmentAsset;actor:{id:string;role:'owner'|'admin'};brandId:string;now:string;facts:BrandFact[];versions:VersionLite[]};
function readyFor(asset:unknown,ctx:unknown):Ready|Failure{
 const c=ctxOf(ctx),now=c.now,actor=c.actor,brandId=c.brandId,campaign=c.campaign;
 if(!isInstant(now))return fail(['invalid_timestamp']);
 if(c.enabled!==true)return fail(['switch_off']);
 if(!adminActor(actor))return fail(['role_forbidden']);
 const records=recordsOf(c);
 if(!assetOk(asset)||!filled(brandId)||!records)return fail(['invalid_record']);
 if(asset.brandId!==brandId)return fail(['record_other_brand']);
 if(c.branch!=='A')return fail(['branch_not_a']);
 if(!isRecord(campaign)||campaign.id!==asset.campaignId||campaign.brandId!==brandId)return fail(['campaign_other_brand']);
 if(!isRecruitmentObjective(campaign))return fail(['campaign_not_recruitment']);
 return {asset,actor,brandId,now,...records};
}
const isFailure=(x:Ready|Failure):x is Failure=>'ok' in x;

// 체크리스트 미완료는 400(클라이언트가 채울 입력, 선례 approvePublication의 필수 확인란), 체크리스트 버전 변경·원문 변경은 서버 상태가 바뀐 것이라 409다. hard_block은 대표 역할·체크리스트로 풀리지 않는다(결정 25).
export async function approveDecision(asset:unknown,input:unknown,ctx:AssetContext&{actor:AssetActor}):Promise<Decision<{approval:AssetApproval;judgement:FranchiseJudgement}>>{
 return guardedAsync(async()=>{
  const r=readyFor(asset,ctx);
  if(isFailure(r))return r;
  const a=r.asset;
  if(a.status!=='draft')return fail(['not_draft']);
  if(a.review.needed)return fail(['review_needed']);
  if(!isRecord(input)||!isRecord(input.checklist)||!Array.isArray(input.checklist.checked))return fail(['checklist_incomplete']);
  if(input.checklist.version!==CHECKLIST_VERSION)return fail(['checklist_outdated']);
  if(!completeChecklist(input.checklist.checked))return fail(['checklist_incomplete']);
  if(input.bodyHash!==a.bodyHash||await assetBodyHash(a.body)!==a.bodyHash)return fail(['hash_mismatch']);
  const g=contentGate(a,r);
  if(!g.judgement||g.codes.length)return fail(g.codes.length?g.codes:['invalid_record'],g.judgement);
  return pass({approval:{by:r.actor.id,role:r.actor.role,at:r.now,bodyHash:a.bodyHash,checklist:{version:CHECKLIST_VERSION,checked:[...CHECKLIST_IDS]}},judgement:g.judgement},franchiseIssueLabels(g.judgement).warnings);
 });
}
function approvalOk(a:unknown,now:string):a is AssetApproval{
 return isRecord(a)&&actorIdOk(a.by)&&(a.role==='owner'||a.role==='admin')&&isInstant(a.at)&&parseInstant(a.at)<=parseInstant(now)&&typeof a.bodyHash==='string'&&HEX64.test(a.bodyHash)
  &&isRecord(a.checklist)&&typeof a.checklist.version==='string'&&strList(a.checklist.checked);
}
// 같은 입력이면 같은 결과다(사실·버전 배열 순서와 무관). body는 원문 그대로(해시한 바이트와 같음)이고, R15a-2는 record를 exports에 덧붙이고 body만 복사·내려받기로 내준다.
export async function exportDecision(asset:unknown,ctx:AssetContext&{actor:AssetActor}):Promise<Decision<{body:string;record:AssetExportRecord;judgement:FranchiseJudgement}>>{
 return guardedAsync(async()=>{
  const r=readyFor(asset,ctx);
  if(isFailure(r))return r;
  const a=r.asset,approval=a.approval;
  if(a.status!=='approved'||!approvalOk(approval,r.now))return fail(['not_approved']);
  if(approval.checklist.version!==CHECKLIST_VERSION)return fail(['checklist_outdated']);
  if(!completeChecklist(approval.checklist.checked))return fail(['not_approved']);
  if(await assetBodyHash(a.body)!==a.bodyHash||approval.bodyHash!==a.bodyHash)return fail(['hash_mismatch']);
  if(a.review.needed)return fail(['review_needed']);
  const g=contentGate(a,r);
  if(!g.judgement||g.codes.length)return fail(g.codes.length?g.codes:['invalid_record'],g.judgement);
  const j=g.judgement;
  return pass({body:a.body,record:{at:r.now,by:r.actor.id,role:r.actor.role,bodyHash:a.bodyHash,judgeVersion:j.version,assetsVersion:ASSETS_VERSION,checklistVersion:approval.checklist.version},judgement:j},franchiseIssueLabels(j).warnings);
 });
}

// ── 게시 위치 ──
// 이미 일어난 게시를 증빙으로 남기는 기록이라 분기는 보지 않는다. 게시 확인일은 내보낸 날(KST)부터 오늘(KST)까지.
export function placementDecision(asset:unknown,input:unknown,ctx:{enabled:boolean;brandId:string;actor:AssetActor;now:string}):Decision<{placement:AssetPlacement}>{
 return guarded(()=>{
  const c=ctxOf(ctx),now=c.now,brandId=c.brandId;
  if(!isInstant(now))return fail(['invalid_timestamp']);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!adminActor(c.actor))return fail(['role_forbidden']);
  if(!assetOk(asset)||!filled(brandId))return fail(['invalid_record']);
  if(asset.brandId!==brandId)return fail(['record_other_brand']);
  if(asset.status!=='approved')return fail(['not_approved']);
  if(!asset.exports.length)return fail(['not_exported']);
  const i=isRecord(input)?input:{},label=labelOf(i.label),on=i.confirmedAt;
  if(label===null||!isDate(on)||on>toKstDate(now)||on<kstDateOf(asset.exports[0].at)||asset.placements.length>=LIMITS.placements)return fail(['invalid_placement']);
  return pass({placement:{label,confirmedAt:on}});
 });
}

// ── 재검토 표시 ──
// lib/brand-facts-server.ts factsChangedWrites·affectsPublications, lib/franchise-server.ts versionFactReview를 따른다. 입력 형식이 틀리면 재검토 대상으로 본다(fail closed).
type CostDetail=NonNullable<BrandFact['cost']>;
const sameList=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const sameCost=(a:CostDetail|null,b:CostDetail|null)=>!a||!b?a===b:a.storeType===b.storeType&&(a.areaM2??null)===(b.areaM2??null)&&sameList(a.includes,b.includes)&&sameList(a.excludes,b.excludes);
export function factChangeAffects(before:BrandFact|null,after:BrandFact|null):boolean{
 try{
  if(before===null)return false;
  if(after===null)return true;
  if(!factOk(before)||!factOk(after))return true;
  if(before.status==='confirmed'&&after.status!=='confirmed')return true;
  if(after.status==='rejected'&&before.status!=='rejected')return true;
  if(after.value!==before.value)return true;
  if(!isInstant(after.validUntil)||!isInstant(before.validUntil)||!(parseInstant(after.validUntil)>=parseInstant(before.validUntil)))return true;
  const b=before.sourceRef??undefined,a=after.sourceRef??undefined;
  if(b?.disclosureVersionId!==a?.disclosureVersionId||b?.fiscalYear!==a?.fiscalYear||b?.asOf!==a?.asOf)return true;
  return !sameCost(before.cost??null,after.cost??null);
 }catch{return true}
}
// before에서 current였고 after에서 current가 아니거나 각주(라벨·등록일)가 바뀐(noteChangedId) 버전 id. 형식이 틀리면 [].
export function changedVersionIds(before:readonly VersionLite[],after:readonly VersionLite[],now:string,noteChangedId:string|null):string[]{
 try{
  if(!Array.isArray(before)||!dense(before).every(versionOk)||!Array.isArray(after)||!dense(after).every(versionOk)||!isInstant(now))return [];
  const was=versionStates(before,now),next=versionStates(after,now);
  return sortedUnique(before.filter(v=>was[v.id]==='current'&&(next[v.id]!=='current'||v.id===noteChangedId)).map(v=>v.id));
 }catch{return []}
}
// 초안·승인 자료만(폐기 건너뜀). 기존 review와 같으면 결과에 넣지 않아 같은 변경을 두 번 적용해도 결과가 같다. 결과는 id, version 순이고 입력을 바꾸지 않는다.
export function markAssetsForReview(assets:readonly RecruitmentAsset[],change:{factIds?:readonly string[];versionIds?:readonly string[]},at:string):{id:string;version:number;review:AssetReview}[]{
 try{
  if(!Array.isArray(assets)||!isRecord(change)||!isInstant(at))return [];
  const factIds=new Set(strList(change.factIds)?change.factIds:[]),versionIds=new Set(strList(change.versionIds)?change.versionIds:[]);
  const out:{id:string;version:number;review:AssetReview}[]=[];
  for(const a of assets){
   if(!assetOk(a)||(a.status!=='draft'&&a.status!=='approved'))continue;
   const add:ReviewReason[]=[];
   if(a.factRefs.some(r=>factIds.has(r.id)))add.push('fact_changed');
   if(a.disclosureVersionId!==null&&versionIds.has(a.disclosureVersionId))add.push('version_changed');
   if(!add.length)continue;
   const prev=a.review,review:AssetReview={needed:true,reasons:sortedUnique([...prev.reasons,...add]),at:prev.needed&&prev.at!==null?prev.at:at};
   if(prev.needed&&prev.at===review.at&&sameList(prev.reasons,review.reasons))continue;
   out.push({id:a.id,version:a.version,review});
  }
  return out.sort((x,y)=>ascii(x.id,y.id)||x.version-y.version);
 }catch{return []}
}

// ── 행사(설명회·견학·박람회) ──
// 행사 등록·변경은 대표·관리자, 분기 A만(B·C는 설명회·견학·박람회를 열지 않는다, H7). 과거 시각의 행사도 증빙으로 기록할 수 있다.
// 설명회 표준 순서는 행사 기록이 아니라 연결한 설명회 덱 자료의 절 검사로 강제한다. 승인된 설명회 덱이 없으면 경고만 한다.
type LinkedAsset=Pick<RecruitmentAsset,'id'|'version'|'brandId'|'status'|'type'>;
const linkOk=(a:unknown):a is LinkedAsset=>isRecord(a)&&isStr(a.id)&&posInt(a.version)&&isStr(a.brandId)&&isStr(a.status)&&isStr(a.type);
export function validateEvent(input:unknown,ctx:EventContext,prev?:RecruitmentEvent|null):Decision<EventInputValue>{
 return guarded(()=>{
  const c=ctxOf(ctx),now=c.now,brandId=c.brandId,campaign=c.campaign;
  if(!isInstant(now))return fail(['invalid_timestamp']);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!adminActor(c.actor))return fail(['role_forbidden']);
  if(c.branch!=='A')return fail(['branch_not_a']);
  if(!isRecord(input))return fail(['invalid_input']);
  const codes:AssetCode[]=[],type=input.type,startsAt=input.startsAt,placeLabel=labelOf(input.placeLabel),capacity=input.capacity,spendRef=input.spendRef,assetRefs=input.assetRefs;
  const spendOk=spendRef===null||validId(spendRef);
  if(!oneOf(EVENT_TYPES,type)||placeLabel===null||!capacityOk(capacity)||!spendOk||!refsOk(assetRefs,LIMITS.assetRefs))codes.push('invalid_event');
  if(!isInstant(startsAt))codes.push('invalid_timestamp');
  if(codes.length||!oneOf(EVENT_TYPES,type)||placeLabel===null||!capacityOk(capacity)||!(spendRef===null||validId(spendRef))||!refsOk(assetRefs,LIMITS.assetRefs)||!isInstant(startsAt))return fail(codes);
  // 고칠 때 이전 기록의 캠페인과 다른 캠페인이면 캠페인 단계에서 막는다.
  if(!filled(brandId)||!isRecord(campaign)||campaign.brandId!==brandId||(isRecord(prev)&&isStr(prev.campaignId)&&prev.campaignId!==campaign.id))return fail(['campaign_other_brand']);
  if(!isRecruitmentObjective(campaign))return fail(['campaign_not_recruitment']);
  const old=prev===undefined||prev===null?null:prev;
  if(old!==null&&!eventOk(old))return fail(['invalid_record']);
  if(old!==null&&old.brandId!==brandId)return fail(['record_other_brand']);
  const refs=refList(assetRefs),pool=Array.isArray(c.assets)?c.assets.filter(linkOk):[];
  if(refs.some(r=>pool.some(a=>a.id===r.id&&a.brandId!==brandId)))return fail(['record_other_brand']);
  const linked=refs.map(r=>pool.find(a=>a.id===r.id&&a.version===r.version&&a.brandId===brandId&&a.status==='approved'));
  if(linked.some(a=>!a))return fail(['asset_not_approved']);
  if(old!==null){
   const state:AssetCode[]=[];
   if(old.status==='cancelled')state.push('event_cancelled');
   if(capacity<old.counts.applied)state.push('capacity_below_applied');
   if(state.length)return fail(state);
  }
  const warnings=type==='briefing'&&!linked.some(a=>a?.type==='event_deck')?[ASSET_WARNING_MESSAGES.briefingDeckMissing]:[];
  return pass({type,startsAt,placeLabel,capacity,spendRef,assetRefs:refs},warnings);
 });
}
const copyCode=(x:EventCode):EventCode=>({code:x.code,state:x.state});
const byCode=(xs:EventCode[])=>xs.sort((a,b)=>ascii(a.code,b.code));
// 신청 기록: 직원도 할 수 있다. 분기 A만(H7). 코드는 가명 코드이고 이름·연락처는 받지 않는다.
export function registerDecision(event:unknown,input:unknown,ctx:EventOpContext):Decision<{counts:EventCounts;codes:EventCode[]}>{
 return guarded(()=>{
  const c=ctxOf(ctx),now=c.now,brandId=c.brandId;
  if(!isInstant(now))return fail(['invalid_timestamp']);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!eventOk(event)||!filled(brandId))return fail(['invalid_record']);
  if(event.brandId!==brandId)return fail(['record_other_brand']);
  if(c.branch!=='A')return fail(['branch_not_a']);
  if(!isRecord(input))return fail(['invalid_input']);
  const raw=input.code;
  if(raw!==undefined&&raw!==null&&!pseudonymOk(raw))return fail(['invalid_code']);
  const code=pseudonymOk(raw)?raw:null;
  const state:AssetCode[]=[];
  if(event.status==='cancelled')state.push('event_cancelled');
  if(parseInstant(now)>=parseInstant(event.startsAt))state.push('event_started');
  if(event.counts.applied>=event.capacity)state.push('capacity_full');
  if(code!==null&&event.codes.some(x=>x.code===code))state.push('code_duplicate');
  if(state.length)return fail(state);
  const codes=event.codes.map(copyCode);
  if(code!==null)codes.push({code,state:'applied'});
  return pass({counts:{applied:event.counts.applied+1,attended:event.counts.attended,noShow:event.counts.noShow},codes:byCode(codes)});
 });
}
// 참석 기록: 직원도 할 수 있고 분기는 보지 않는다(일어난 일의 기록). 행사일(KST) 당일부터 받는다(시작 전 입장 체크 포함, 날짜 비교는 franchise-gates와 같다).
// counts는 설정값으로 바꾼다. codes는 이번 입력이 코드 상태의 전체 설정이다: 적은 코드는 그 상태, 적지 않은 코드는 신청(applied)으로 둔다. 그래서 다시 기록해도 같은 결과다.
export function attendanceDecision(event:unknown,input:unknown,ctx:EventOpContext):Decision<{counts:EventCounts;codes:EventCode[]}>{
 return guarded(()=>{
  const c=ctxOf(ctx),now=c.now,brandId=c.brandId;
  if(!isInstant(now))return fail(['invalid_timestamp']);
  if(c.enabled!==true)return fail(['switch_off']);
  if(!eventOk(event)||!filled(brandId))return fail(['invalid_record']);
  if(event.brandId!==brandId)return fail(['record_other_brand']);
  if(event.status==='cancelled')return fail(['event_cancelled']);
  if(toKstDate(now)<kstDateOf(event.startsAt))return fail(['attendance_before_event']);
  if(!isRecord(input))return fail(['invalid_input']);
  const attended=input.attended,noShow=input.noShow,marks=input.codes===undefined?[]:input.codes,codes:AssetCode[]=[];
  const counted=countInt(attended)&&countInt(noShow);
  if(!countInt(attended)||!countInt(noShow)||noShow>event.counts.applied||attended>event.capacity)codes.push('invalid_counts');
  if(!codesOk(marks,['attended','no_show']))codes.push('invalid_code');
  else{
   const known=new Set(event.codes.map(x=>x.code));
   if(marks.some(m=>!known.has(m.code)))codes.push('code_unknown');
   if(counted&&(marks.filter(m=>m.state==='attended').length>(attended as number)||marks.filter(m=>m.state==='no_show').length>(noShow as number)))codes.push('invalid_counts');
  }
  if(codes.length||!countInt(attended)||!countInt(noShow)||!codesOk(marks,['attended','no_show']))return fail(codes);
  const next=new Map(marks.map(m=>[m.code,m.state]));
  return pass({counts:{applied:event.counts.applied,attended,noShow},codes:byCode(event.codes.map(x=>({code:x.code,state:next.get(x.code)??'applied'})))});
 });
}
