// 상품 리서치 API 계약(순수 모듈). 서버(app/api/product-research)와 화면(app/product-research-*.tsx)이 같은 모양을 쓴다.
// GET /api/product-research → ProductResearchView(types.ts)에 아래 ViewExtras를 더한 응답.
// POST /api/product-research → {action, requestId(uuid v4), ...payload}. 쓰기는 대표·관리자만, 자동 수집 즉시 실행·출처 연결은 소유자만.
import type {CategoryId,DecisionStatus,ProductResearchView,SourceId,Temperature} from './types';

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
 |{action:'decide';productId:string;scoreCardId:string;briefId:string|null;status:DecisionStatus;reason:string}
 |{action:'handoff';decisionId:string;campaignId:string;campaignVersion:number}
 |{action:'run_backtest';horizonWeeks:4|8|12;labelThreshold:number};

// GET 응답에 더하는 값.
export type ViewExtras={
 settings:ResearchSettings;
 credentials:{key:CredentialKey;connected:boolean;account:string|null;updatedAt:string|null}[];
 imports:{snapshotId:string;sourceId:SourceId;fileName:string;rows:number;importedAt:string;importedBy:string|null}[];
 collect:{lastRunAt:string|null;nextRunAt:string|null;lastErrors:{sourceId:SourceId;message:string;at:string}[]};
 campaigns:{id:string;title:string;version:number;brandId:string}[];
 canConnect:boolean; // 소유자
};
export type ResearchViewResponse=ProductResearchView&ViewExtras;
