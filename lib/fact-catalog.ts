// 표준 사실 항목. key는 저장·중복 검사 기준, label은 화면·캡션·PNG 표시용, storeScoped는 지점마다 다른 항목(브랜드 공통 저장 시 확인 필요)이다.
// 가맹 항목(franchise:true, 트랙 R R1b)은 배열 끝에 둔다. disclosure: 정보공개서에서 오는 값이라 확정에 근거(sourceRef)가 필요하다. adUse:false: 수익 항목(H6)이라 캡션·사실 카드에 쓰지 않는다.
// storeType·area: 창업비용 구성(매장 유형·포함·불포함, 전용면적) 필수. asOf: 매장 수 항목이라 기준일 필수.
export type FactCatalogItem={key:string;label:string;storeScoped:boolean;franchise?:true;disclosure?:true;adUse?:false;storeType?:'required';area?:'required';asOf?:'required'};
const baseCatalog:FactCatalogItem[]=[
 {key:'address',label:'주소',storeScoped:true},
 {key:'opening_date',label:'오픈일',storeScoped:true},
 {key:'hours',label:'영업시간',storeScoped:true},
 {key:'closed_days',label:'휴무일',storeScoped:true},
 {key:'access',label:'찾아오는 길',storeScoped:true},
 {key:'parking',label:'주차',storeScoped:true},
 {key:'seating',label:'좌석',storeScoped:true},
 {key:'delivery',label:'배달·포장',storeScoped:true},
 {key:'phone',label:'전화번호',storeScoped:true},
 {key:'menu_price',label:'메뉴 가격',storeScoped:false},
 {key:'signature_menu',label:'대표 메뉴',storeScoped:false},
 {key:'cooking_method',label:'조리 방식',storeScoped:false},
 {key:'promotion',label:'프로모션',storeScoped:false},
 {key:'official_account',label:'공식 계정',storeScoped:false},
];
// 가맹 항목. 일반 낱말('인테리어'·'보증금'·'매출'·'등록번호')은 별칭으로 쓰지 않는다(소비자 사실과 충돌 방지). production_method는 cooking_method와 별칭을 겹치지 않는다.
const fr=(key:string,label:string,flags:Omit<FactCatalogItem,'key'|'label'|'storeScoped'|'franchise'>={}):FactCatalogItem=>({key,label,storeScoped:false,franchise:true,...flags});
const D={disclosure:true} as const,COST={disclosure:true,storeType:'required'} as const,AREA={disclosure:true,storeType:'required',area:'required'} as const,COUNT={disclosure:true,asOf:'required'} as const,REVENUE={disclosure:true,adUse:false} as const;
const franchiseCatalog:FactCatalogItem[]=[
 fr('franchise_fee','가맹비',COST),
 fr('education_fee','교육비',COST),
 fr('franchise_deposit','가맹 보증금',COST),
 fr('interior_cost','인테리어 비용',AREA),
 fr('other_startup_cost','기타 창업 비용',COST),
 fr('startup_cost_total','총 창업비용',AREA),
 fr('royalty_fee','로열티',D),
 fr('franchise_store_count','가맹점 수',COUNT),
 fr('direct_store_count','직영점 수',COUNT),
 fr('new_openings','신규 개점 수',COUNT),
 fr('terminations','계약 종료 수',COUNT),
 fr('cancellations','계약 해지 수',COUNT),
 fr('regional_avg_sales','지역별 평균매출',REVENUE),
 fr('direct_store_sales','직영점 매출',REVENUE),
 fr('direct_store_contribution','직영점 공헌이익',REVENUE),
 fr('monthly_sales','월 매출',REVENUE),
 fr('profit_rate','수익률',REVENUE),
 fr('disclosure_registration_no','정보공개서 등록번호',D),
 fr('disclosure_registered_on','정보공개서 등록일',D),
 fr('disclosure_registrar','정보공개서 등록기관',D),
 fr('base_fiscal_year','기준 사업연도',D),
 fr('escrow_insurance','가맹금 예치·보험 가입',D),
 fr('required_items','필수품목',D),
 fr('required_items_pricing','공급가격 산정방식 요지',D),
 fr('margin_fee','차액가맹금 여부',D),
 fr('production_method','생산 방식',D),
 fr('sales_channels','가맹점 밖 판매 채널',D),
 fr('store_types','매장 유형',D),
 fr('ip_registration','특허·상표 등록번호',D),
 fr('territory_clause','영업지역 조항',D),
 fr('claim_basis','순위·최초 표현 근거'),
 fr('trade_area_source','상권 자료 출처'),
 fr('direct_store_performance','직영점 실적(출처·기간)'),
 fr('collab_consent','협업 권리자 동의'),
 fr('own_ip_rights','자체 IP 권리 귀속'),
 fr('heritage_basis','업력 근거'),
];
export const factCatalog:FactCatalogItem[]=[...baseCatalog,...franchiseCatalog];
// 같은 항목의 흔한 다른 표기. 공백·구분 기호를 뺀 소문자로 비교한다.
const aliases:Record<string,string>={매장주소:'address',위치:'address',개점일:'opening_date',오픈날짜:'opening_date',운영시간:'hours',휴무:'closed_days',정기휴무:'closed_days',오시는길:'access',대중교통:'access',좌석수:'seating',배달:'delivery',포장:'delivery',배달여부:'delivery',전화:'phone',연락처:'phone',가격:'menu_price',메뉴가격:'menu_price',대표메뉴:'signature_menu',조리방법:'cooking_method',조리설비:'cooking_method',할인:'promotion',이벤트:'promotion',공식sns:'official_account',인스타그램:'official_account'};
// 가맹 항목의 다른 표기. canonicalFactKey에는 쓰지 않고 franchiseFactKey만 쓴다(가맹 문맥 없는 브랜드의 자유 key '가맹비'·'월 매출'은 이전과 같다).
const franchiseAliases:Record<string,string>={가입비:'franchise_fee',가맹가입비:'franchise_fee',교육훈련비:'education_fee',가맹교육비:'education_fee',계약이행보증금:'franchise_deposit',인테리어비:'interior_cost',인테리어공사비:'interior_cost',기타창업비용:'other_startup_cost',창업비용:'startup_cost_total',총투자비:'startup_cost_total',창업총비용:'startup_cost_total',월로열티:'royalty_fee',가맹점개수:'franchise_store_count',직영매장수:'direct_store_count',신규개점:'new_openings',신규출점수:'new_openings',계약종료:'terminations',계약해지:'cancellations',평균매출:'regional_avg_sales',가맹점평균매출:'regional_avg_sales',지역평균매출:'regional_avg_sales',직영매출:'direct_store_sales',공헌이익:'direct_store_contribution',월평균매출:'monthly_sales',영업이익률:'profit_rate',가맹금예치:'escrow_insurance',가맹금예치보험:'escrow_insurance',필수구입품목:'required_items',공급가격산정방식:'required_items_pricing',필수품목공급가격:'required_items_pricing',차액가맹금:'margin_fee',생산주체:'production_method',제조방식:'production_method',가맹점공급생산방식:'production_method',판매채널:'sales_channels',외부판매채널:'sales_channels',유통채널:'sales_channels',점포유형:'store_types',특허번호:'ip_registration',상표등록번호:'ip_registration',순위근거:'claim_basis',상권자료:'trade_area_source',직영점실적:'direct_store_performance',협업동의:'collab_consent',자체ip권리:'own_ip_rights'};
const compact=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s·_\-./]/g,'');
const byName=new Map<string,string>([...baseCatalog.flatMap(i=>[[compact(i.key),i.key],[compact(i.label),i.key]] as [string,string][]),...Object.entries(aliases)]);
const byFranchiseName=new Map<string,string>([...franchiseCatalog.flatMap(i=>[[compact(i.key),i.key],[compact(i.label),i.key]] as [string,string][]),...Object.entries(franchiseAliases)]);
// 카탈로그 항목이면 그 key, 아니면 기존 규칙(NFKC·소문자)으로 정규화한 자유 key.
export function canonicalFactKey(key:string):string{
 const free=key.normalize('NFKC').trim().toLowerCase();
 return byName.get(compact(free))??free;
}
export function factCatalogItem(key:string):FactCatalogItem|undefined{return factCatalog.find(i=>i.key===canonicalFactKey(key))}
// 표시 라벨. 카탈로그 밖의 자유 항목은 입력한 key를 그대로 보여 준다.
export function factLabel(key:string):string{return factCatalogItem(key)?.label??key}
// 가맹 항목 key(가맹 key·label·별칭 → key). 가맹 문맥(가맹 프로필이나 정보공개서 버전)이 있는 브랜드의 저장·사용 판정에서만 쓴다.
export function franchiseFactKey(name:string|undefined|null):string|undefined{return typeof name==='string'?byFranchiseName.get(compact(name.trim())):undefined}
export function franchiseItem(name:string|undefined|null):FactCatalogItem|undefined{const key=franchiseFactKey(name);return key?franchiseCatalog.find(i=>i.key===key):undefined}
// 이름 목록 검사용(테스트): 기존 항목 이름과 가맹 항목 이름의 compact 값.
export const catalogNames=():{base:[string,string][];franchise:[string,string][]}=>({base:[...byName.entries()],franchise:[...franchiseCatalog.flatMap(i=>[[compact(i.label),i.key]] as [string,string][]),...Object.entries(franchiseAliases)]});
