// 상품 리서치 API 계약(순수 모듈). 서버(app/api/product-research)와 화면(app/product-research-*.tsx)이 같은 모양을 쓴다.
// GET /api/product-research → ProductResearchView(types.ts)에 아래 ViewExtras를 더한 응답.
// POST /api/product-research → {action, requestId(uuid v4), ...payload}. 쓰기는 대표·관리자만, 자동 수집 즉시 실행·출처 연결은 소유자만.
import type {CategoryId,DecisionStatus,ProductResearchView,Series,Snapshot,SourceId,Temperature} from './types';

export const RESEARCH_ACTIONS=[
 'save_settings',     // 조사 방향(카테고리·보관 온도·가격 상한·질문)
 'connect_source',    // 출처 자격증명 저장(검증 호출 뒤 암호화 저장, 소유자만)
 'disconnect_source', // 자격증명 삭제(소유자만)
 'import_file',       // 운영자 가져오기(manual·licensed 출처, CSV/JSON 2MB·2,000행)
 'collect_now',       // 자동 수집 즉시 1회(소유자만, product_research_collect 켜짐·쿼터 안)
 'recompute',         // 저장된 스냅샷으로 정규화·점수표 다시 계산(외부 호출 없음)
 'confirm_match',     // 상품 매칭 확인·분리
 'set_brand_fit',     // 브랜드 적합성 사람 점수(0~100)와 사유
 'generate_brief',    // MD 선정 메모(template: 결정형, model: AI 팀 상품 MD 역할) — 인용 검사 통과분만 저장
 'decide',            // 승인·보류·제외와 사유
 'handoff',           // 승인 상품을 캠페인의 성장2 시장 근거로 넘김(발주·가격 승인 없음)
 'run_backtest',      // 저장된 시계열로 가중치 판 백테스트
 // 평가 1회차 추가(뒤에만 붙인다).
 'clear_quarantine',  // 이상치로 격리된 관측을 사람이 확인하고 해제(사유 필수) → 다시 점수에 들어감
 'link_sourcing',     // 상품을 성장2 캠페인의 소싱 후보(growth_sourcing_candidate)와 잇는다(같은 소유자·브랜드·캠페인, 후보 판 기록)
 'unlink_sourcing',   // 소싱 후보 연결 해제
 'save_risk_review',  // 점수표 판별 사람 리스크 체크리스트 저장(검토 필요 점수표는 승인 전 필수)
] as const;
export type ResearchAction=typeof RESEARCH_ACTIONS[number];

// 출처 자격증명 묶음. naver_developers는 데이터랩 2종과 쇼핑 검색이 같이 쓴다.
export const CREDENTIAL_KEYS=['naver_searchad','naver_developers','youtube','coupang_partners','licensed'] as const;
export type CredentialKey=typeof CREDENTIAL_KEYS[number];
export const CREDENTIAL_SOURCES:Record<CredentialKey,readonly SourceId[]>={
 naver_searchad:['naver_searchad_keyword'],
 naver_developers:['naver_datalab_search','naver_datalab_shopping','naver_shop_search'],
 youtube:['youtube_data'],
 coupang_partners:['coupang_partners'],
 licensed:['licensed_ranking'],
};

export type ResearchSettings={categories:CategoryId[];temperatures:Temperature[];priceMax:number|null;question:string;version:number;updatedAt:string|null};

export type ResearchRequest=
 |{action:'save_settings';settings:Omit<ResearchSettings,'version'|'updatedAt'>;expectedVersion:number}
 |{action:'connect_source';credentialKey:CredentialKey;input:Record<string,string>}
 |{action:'disconnect_source';credentialKey:CredentialKey}
 |{action:'import_file';sourceId:SourceId;fileName:string;text:string;scope:string;observedDate:string}
 |{action:'collect_now';sourceId?:SourceId}
 |{action:'recompute'}
 |{action:'confirm_match';productId:string;decision:'merge'|'split';listingKeys:string[]}
 |{action:'set_brand_fit';productId:string;value:number;reason:string}
 |{action:'generate_brief';productIds:string[];question:string;mode:'template'|'model'}
 // riskAcknowledged(추가 필드, 선택): 검토 필요(needsReview) 점수표를 리스크 체크리스트 없이 승인할 때 위험 확인 표시. 사유에 확인한 위험(review.terms 중 하나)을 적어야 한다.
 |{action:'decide';productId:string;scoreCardId:string;briefId:string|null;status:DecisionStatus;reason:string;riskAcknowledged?:boolean}
 // sourceUrl(추가 필드, 선택): 상품 목록에 공개 https 주소가 없을 때 근거로 쓸 공개 주소. 없으면 가장 좋은 목록 주소를 쓴다.
 |{action:'handoff';decisionId:string;campaignId:string;campaignVersion:number;sourceUrl?:string}
 |{action:'run_backtest';horizonWeeks:4|8|12;labelThreshold:number}
 |{action:'clear_quarantine';quarantineId:string;reason:string}
 |{action:'link_sourcing';productId:string;campaignId:string;candidateId:string}
 |{action:'unlink_sourcing';productId:string}
 |{action:'save_risk_review';productId:string;scoreCardId:string;checklist:{rule:string;checked:boolean}[];note:string};

// 서버가 쓰는 입력 검사 한도(평가 1회차 M8). 화면은 이 값을 그대로 써서 서버와 같은 기준으로 버튼을 켜고 끈다.
export const QUESTION_MAX=200;            // 조사 질문·메모 질문(자)
export const REASON_MIN=5;                // 결정 사유·브랜드 적합성 사유·격리 해제 사유 최소(자)
export const REASON_MAX=500;              // 결정 사유 최대(자)
export const BRAND_FIT_REASON_MAX=300;    // 브랜드 적합성 사유 최대(자)
export const CLEAR_REASON_MAX=200;        // 격리 해제 사유 최대(자)
export const BRAND_FIT_MIN=0,BRAND_FIT_MAX=100;
export const PRICE_MAX_MIN=100,PRICE_MAX_MAX=10_000_000; // 가격 상한(원, 정수) 또는 비움
export const BRIEF_PRODUCTS_MAX=20;       // 메모 한 번에 비교할 상품 수
export const MATCH_KEYS_MAX=50;           // 매칭 확인 한 번에 고를 목록 수
export const BACKTEST_HORIZONS=[4,8,12] as const;
export const LABEL_THRESHOLD_MIN=1,LABEL_THRESHOLD_MAX=500; // 백테스트 정답 기준(%)
export const IMPORT_SCOPE_MAX=100;        // 가져오기 랭킹 범위(자)
export const IMPORT_MAX_AGE_DAYS=14;      // 가져오기 기준일 하한(한국 날짜로 오늘부터 14일 전까지), 미래 거절
export const RISK_RULES_MAX=30,RISK_RULE_MAX=200,RISK_NOTE_MAX=500; // 리스크 체크리스트 항목 수·항목 길이·메모 길이
export const COLLECT_NOW_PER_DAY=3;       // 즉시 수집(collect_now) 한국 날짜 하루 횟수
export const HANDOFF_EVIDENCE_MAX_DAYS=30; // 넘기기 근거 관측의 최대 나이(일, 관측 기간·기준일 기준)

// 화면 응답 추가 필드의 모양(평가 1회차).
export type ResearchAlert={sourceId:SourceId;message:string;since:string};
export type SourceFreshness={sourceId:SourceId;successRate30d:number|null;calls30d:number;lastOkAt:string|null;quarantined:number};
export type RankingImportStatus={sourceId:SourceId;lastImportedAt:string|null;thisWeek:boolean};
export type QuarantineEntry={id:string;sourceId:SourceId;snapshotId:string;subjectKey:string;metric:string;periodTo:string;value:number;median:number;robustZ:number;createdAt:string};
export type RiskReview={id:string;productId:string;scoreCardId:string;checklist:{rule:string;checked:boolean}[];note:string;by:{id:string;email:string|null};at:string};

// GET 응답에 더하는 값.
export type ViewExtras={
 settings:ResearchSettings;
 credentials:{key:CredentialKey;connected:boolean;account:string|null;updatedAt:string|null}[];
 // scope·observedDate(추가 필드): 가져오기 때 적은 랭킹 범위와 기준일.
 imports:{snapshotId:string;sourceId:SourceId;fileName:string;rows:number;importedAt:string;importedBy:string|null;scope?:string|null;observedDate?:string|null}[];
 collect:{lastRunAt:string|null;nextRunAt:string|null;lastErrors:{sourceId:SourceId;message:string;at:string}[]};
 campaigns:{id:string;title:string;version:number;brandId:string}[];
 canConnect:boolean; // 소유자
 // 추가 필드: 화면에 보이는 상품의 시계열(점수표가 인용한 스냅샷 + 같은 출처의 이전 스냅샷, 합쳐 최대 200개. 시계열마다 최근 104주 점만)과 근거 스냅샷 요약(현재 점수표·메모가 가리키는 것 + 최근 50개).
 series?:Series[];
 // request·limitations·rows(추가 필드): 요청 범위(키워드·카테고리·기간·가져오기 범위), 해석 한계, 관측 행 수. 관측 본문은 싣지 않는다.
 snapshots?:{id:string;sourceId:SourceId;fetchedAt:string;status:Snapshot['status'];request?:Snapshot['request']|null;limitations?:string[];rows?:number}[];
 // 평가 1회차 추가 필드(모두 선택). alerts: 출처별 연속 실패·격리 대기 경보. freshness: 출처별 30일 호출 성공률·마지막 정상 수집·격리 수.
 // rankingStatus: 랭킹 가져오기 출처별 마지막 가져오기와 이번 주(한국 날짜, 월요일 시작) 여부. quarantines: 해제를 기다리는 격리 관측(최대 100).
 // riskReviews: 화면 상품의 현재 점수표에 저장된 최신 리스크 검토. collectNow: 오늘 즉시 수집 횟수. weeklyReport: 마지막 주간 MD 리포트.
 alerts?:ResearchAlert[];
 freshness?:SourceFreshness[];
 rankingStatus?:RankingImportStatus[];
 quarantines?:QuarantineEntry[];
 riskReviews?:RiskReview[];
 collectNow?:{usedToday:number;maxPerDay:number};
 weeklyReport?:{week:string;briefId:string|null;at:string;reason:string|null}|null;
};
export type ResearchViewResponse=ProductResearchView&ViewExtras;
