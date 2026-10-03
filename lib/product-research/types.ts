// 상품 리서치·MD 에이전트 공용 계약(순수 모듈). docs/PRODUCT-RESEARCH-PLAN.ko.md 4절.
// 수집기(collectors/*)·분석(analytics/*)·서버(server.ts)·화면(app/product-research-*.tsx)이 이 타입만 공유한다.
// 원칙: 모르는 값은 null(0과 구분), 모든 수치는 원본 스냅샷 ID를 가리킨다, 저장 kind는 records 표의 pr_* 이다.

// 출처 ID. 허용 방식은 sources.ts 레지스트리가 정본이다.
export const SOURCE_IDS=[
 'naver_searchad_keyword', // 네이버 검색광고 키워드 도구: 월간 검색수(PC·모바일)·연관 키워드·경쟁 지수
 'naver_datalab_search',   // 네이버 데이터랩 검색어 트렌드: 기간별 상대값(0~100)
 'naver_datalab_shopping', // 네이버 데이터랩 쇼핑인사이트: 카테고리·키워드 클릭 상대값
 'naver_shop_search',      // 네이버 검색 API 쇼핑: 상품 수·최저가·판매처
 'youtube_data',           // YouTube Data API v3: 영상 조회수·좋아요·댓글·채널 구독자
 'coupang_partners',       // 쿠팡 파트너스 API: 카테고리 베스트·상품 검색
 'licensed_ranking',       // 계약 데이터(셀러 분석 도구 등) 랭킹·판매 추정 이력
 'coupang_ranking_manual', // 운영자 가져오기: 쿠팡 랭킹 화면
 'musinsa_ranking_manual', // 운영자 가져오기: 무신사 랭킹 화면
 'oliveyoung_ranking_manual', // 운영자 가져오기: 올리브영 랭킹 화면
 'own_sales',              // 자사 주문 장부·발행 관측(내부)
] as const;
export type SourceId=typeof SOURCE_IDS[number];

// api: 공식 API 자동 수집 · licensed: 계약 데이터(자동 수집 허용, 계약 근거 필수) · manual: 운영자 가져오기만(자동 수집 금지) · internal: 앱 안 자료
export type AccessMethod='api'|'licensed'|'manual'|'internal';

export type SourceSpec={
 id:SourceId;
 label:string;
 method:AccessMethod;
 // 자동 수집 가능 여부. manual은 항상 false다(tests가 지킨다).
 autoFetch:boolean;
 // 호출하는 고정 호스트. manual·internal은 빈 배열이다.
 hosts:readonly string[];
 // 근거: 공식 문서·약관·robots 확인 결과 한 문장.
 basis:string;
 // 출처가 주는 지표.
 metrics:readonly MetricKey[];
 // 하루 쿼터(공급자 기준 단위). 모르면 null.
 dailyQuota:number|null;
 // 값의 성격. relative는 0~100 상대값이라 절대량으로 보정해야 한다.
 scale:'absolute'|'relative'|'rank';
};

export const METRIC_KEYS=[
 'search_volume_month',   // 월간 검색수(PC+모바일), 절대값
 'search_volume_pc',
 'search_volume_mobile',
 'search_trend',          // 상대 추세 0~100
 'shopping_click_trend',  // 쇼핑 클릭 상대 추세 0~100
 'ad_competition',        // 광고 경쟁 지수 0(낮음)~1(높음)
 'product_count',         // 쇼핑 검색 상품 수
 'seller_count',          // 판매처 수
 'price_min',             // 원
 'price_median',          // 원
 'video_views',           // 영상 조회수(누적)
 'video_view_velocity',   // 하루 조회수 증가
 'video_count',           // 관련 영상 수
 'rank',                  // 플랫폼 랭킹 순위(1이 최상)
 'review_count',
 'rating',
 'sales_estimate',        // 계약 데이터 판매 추정(개/월)
 'own_orders',            // 자사 주문 수
 'own_revenue',           // 자사 순매출(원)
] as const;
export type MetricKey=typeof METRIC_KEYS[number];

// 보관 온도. 대표 결정(2026-10-03 D1): 푸드는 배송 이슈가 있어 상온 제품을 우선한다.
export type Temperature='ambient'|'chilled'|'frozen'|'unknown';
// 규제 분류. 리스크 체크리스트와 자동 선정 금지 판단에 쓴다.
export type RegulatoryClass='food'|'health_functional_food'|'cosmetics'|'functional_cosmetics'|'kc_electrical'|'kc_children'|'general';

export type CategoryId=string; // categories.ts의 표준 카테고리 ID

// 원본 스냅샷(불변). 외부 원문 전체는 저장하지 않는다. 필요한 수치는 observations로, 원문은 해시·크기만 남긴다.
export type Snapshot={
 id:string;               // uuid
 sourceId:SourceId;
 method:AccessMethod;
 // 요청 범위: 키워드·카테고리·기간 등. 사용자 입력 URL은 담지 않는다.
 request:Record<string,string|number|boolean|null>;
 fetchedAt:string;        // ISO
 bodyDigest:string;       // sha-256 hex
 bodyBytes:number;
 status:'ok'|'partial'|'failed';
 // 해석을 제한하는 사실(지연 반영·부분 데이터 등).
 limitations:string[];
 // 운영자 가져오기면 가져온 사람과 파일 이름. 자동 수집이면 null.
 importedBy:{id:string;email:string|null;fileName:string}|null;
 observations:Observation[];
};

// 한 지표의 한 시점 값. subject는 키워드 또는 플랫폼 상품이다.
export type Observation={
 subject:Subject;
 metric:MetricKey;
 value:number|null;      // null=미확인
 // 값이 가리키는 기간. 하루 값이면 from=to.
 period:{from:string;to:string};
 // 랭킹이면 그 랭킹의 범위(카테고리 이름 등).
 scope?:string;
};

export type Subject=
 |{type:'keyword';text:string}
 |{type:'listing';sourceId:SourceId;externalId:string;title:string;brand:string|null;price:number|null;url:string|null;categoryPath:string|null};

// 같은 수요를 뜻하는 키워드 묶음.
export type KeywordGroup={
 id:string;
 label:string;
 keywords:string[];
 categoryId:CategoryId|null;
 createdAt:string;
 updatedAt:string;
};

// 정규화 상품(여러 플랫폼 목록을 같은 상품으로 묶은 것).
export type ResearchProduct={
 id:string;
 name:string;             // 표준 이름
 brand:string|null;
 categoryId:CategoryId|null;
 temperature:Temperature;
 regulatory:RegulatoryClass;
 priceBand:{min:number|null;max:number|null};
 listings:{sourceId:SourceId;externalId:string;title:string;url:string|null}[];
 keywordGroupIds:string[];
 // 매칭 근거와 신뢰도(0~1). 0.95 미만은 사람 확인 대기.
 match:{method:'barcode'|'brand_name_size'|'manual';confidence:number;confirmedBy:{id:string;email:string|null}|null};
 createdAt:string;
 updatedAt:string;
};

// 시계열의 한 점. 반드시 스냅샷을 가리킨다.
export type SeriesPoint={at:string;value:number|null;snapshotId:string};
export type Series={subjectKey:string;metric:MetricKey;sourceId:SourceId;points:SeriesPoint[]};

export const SUB_SCORES=['demand','momentum','durability','competition','profitability','feasibility','content','brand_fit','risk'] as const;
export type SubScoreKey=typeof SUB_SCORES[number];

export type SubScore={
 key:SubScoreKey;
 // 0~100. 자료가 없으면 null(0 아님).
 value:number|null;
 // 이 하위 점수에 쓴 근거 스냅샷.
 evidence:string[];
 // 사람이 읽는 한 문장 설명.
 reason:string;
};

// 점수표 판(불변). 가중치 판이 바뀌면 새 판을 만든다.
export type ScoreCard={
 id:string;
 productId:string;
 weightsVersion:string;
 computedAt:string;
 subScores:SubScore[];
 total:number|null;        // 0~100. 핵심 자료(수요·모멘텀) 둘 다 없으면 null
 confidence:number;        // 0~1, 자료 완비율과 출처 수로 계산
 missing:SubScoreKey[];
 // 고위험이면 총점과 별개로 선정 금지.
 blocked:{reason:string;rule:string}|null;
 // 분류: 도입 검토·관찰·자료 보강·제외
 tier:'adopt'|'watch'|'needs_data'|'reject';
 inputDigest:string;
};

// MD 선정 메모 판. 모든 수치는 citations에 있는 스냅샷을 인용한다.
export type MdBrief={
 id:string;
 productIds:string[];
 question:string;          // 대표가 준 방향(예: "여름 상온 K-스낵, 2만 원 이하")
 summary:string;
 recommendation:'adopt'|'watch'|'reject';
 claims:{text:string;citations:string[]}[];
 risks:string[];
 // 작성 방식: 결정형 템플릿 또는 모델. 모델이면 실행 ID.
 author:{kind:'template'}|{kind:'model';jobId:string};
 // 인용 채점 결과.
 citationCheck:{passed:boolean;unsupported:string[]};
 createdAt:string;
};

export type DecisionStatus='approved'|'hold'|'rejected';
export type MdDecision={
 id:string;
 productId:string;
 scoreCardId:string;
 briefId:string|null;
 status:DecisionStatus;
 reason:string;
 decidedBy:{id:string;email:string|null};
 decidedAt:string;
 // 승인 뒤 성장2로 넘긴 연결.
 handoff:{campaignId:string;signalId:string|null;needId:string|null}|null;
};

export type BacktestResult={
 id:string;
 weightsVersion:string;
 asOf:string;              // 점수 고정 시점
 horizonWeeks:number;      // 4·8·12
 candidates:number;
 precisionAtK:{k:number;value:number|null}[];
 spearman:number|null;
 baselines:{name:'current_top'|'momentum_only'|'random';precisionAtK:{k:number;value:number|null}[]}[];
 // 정답 정의: 관측 기간 뒤 추세·순위가 기준 이상 오른 상품.
 label:string;
 computedAt:string;
};

// 화면 응답(GET /api/product-research). 서버와 화면이 같은 모양을 쓴다.
export type ProductResearchView={
 enabled:boolean;          // 스위치 product_research
 collectEnabled:boolean;   // 스위치 product_research_collect
 focus:{temperature:Temperature[];categories:CategoryId[]};
 sources:{id:SourceId;label:string;method:AccessMethod;connected:boolean;lastFetchedAt:string|null;lastStatus:Snapshot['status']|null;quotaUsedToday:number|null;dailyQuota:number|null}[];
 products:(ResearchProduct&{score:ScoreCard|null;decision:MdDecision|null})[];
 keywordGroups:KeywordGroup[];
 briefs:MdBrief[];
 backtests:BacktestResult[];
 canEdit:boolean;
 mayOrder:false;
};
