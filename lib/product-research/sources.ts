// 상품 리서치 출처 레지스트리(순수 모듈). docs/PRODUCT-RESEARCH-PLAN.ko.md 3절.
// 원칙: 공식 API → 계약 데이터 → 운영자 가져오기. robots.txt나 약관이 자동 수집을 막는 곳은 manual로만 둔다(autoFetch:false, hosts 비움).
// tests/product-research-sources.test.mjs가 manual 출처에 자동 수집 경로가 없는지, 수집기가 레지스트리 밖 호스트를 부르지 않는지 확인한다.
import type {SourceId,SourceSpec} from './types';

export const SOURCES:readonly SourceSpec[]=[
 {id:'naver_searchad_keyword',label:'네이버 검색광고 키워드 도구',method:'api',autoFetch:true,hosts:['api.searchad.naver.com'],
  basis:'네이버 검색광고 공식 API(/keywordstool). 광고주 API 키·비밀키·고객 ID로 서명 호출',
  metrics:['search_volume_month','search_volume_pc','search_volume_mobile','ad_competition'],dailyQuota:null,scale:'absolute'},
 {id:'naver_datalab_search',label:'네이버 데이터랩 검색어 트렌드',method:'api',autoFetch:true,hosts:['openapi.naver.com'],
  basis:'네이버 개발자센터 공식 API(/v1/datalab/search). 상대값만 제공해 검색광고 절대값으로 보정',
  metrics:['search_trend'],dailyQuota:1000,scale:'relative'},
 {id:'naver_datalab_shopping',label:'네이버 데이터랩 쇼핑인사이트',method:'api',autoFetch:true,hosts:['openapi.naver.com'],
  basis:'네이버 개발자센터 공식 API(/v1/datalab/shopping/*). 쇼핑 클릭 상대값',
  metrics:['shopping_click_trend'],dailyQuota:1000,scale:'relative'},
 {id:'naver_shop_search',label:'네이버 쇼핑 검색',method:'api',autoFetch:true,hosts:['openapi.naver.com'],
  basis:'네이버 개발자센터 공식 검색 API(/v1/search/shop.json). 상품 수·최저가·판매처',
  metrics:['product_count','seller_count','price_min','price_median'],dailyQuota:25000,scale:'absolute'},
 {id:'youtube_data',label:'YouTube 데이터',method:'api',autoFetch:true,hosts:['www.googleapis.com'],
  basis:'YouTube Data API v3. 하루 10,000단위(search.list 100, videos.list 1). 검색은 아끼고 영상 단위로 추적',
  metrics:['video_views','video_view_velocity','video_count'],dailyQuota:10000,scale:'absolute'},
 {id:'coupang_partners',label:'쿠팡 파트너스',method:'api',autoFetch:true,hosts:['api-gateway.coupang.com'],
  basis:'쿠팡 파트너스 공식 Open API(HMAC 서명). 승인 조건·호출 제한은 발급 화면 기준으로 확인',
  metrics:['rank','price_min'],dailyQuota:null,scale:'rank'},
 {id:'licensed_ranking',label:'계약 랭킹 데이터',method:'licensed',autoFetch:false,hosts:[],
  basis:'대표 결정(2026-10-03 D2): 유료 계약 데이터 진행. 계약 전에는 공급사 내보내기 파일 가져오기만, 계약 후 고정 호스트를 등록해 자동 수집',
  metrics:['rank','sales_estimate','review_count','rating','price_min'],dailyQuota:null,scale:'rank'},
 {id:'coupang_ranking_manual',label:'쿠팡 랭킹(가져오기)',method:'manual',autoFetch:false,hosts:[],
  basis:'공식 API 범위 밖 랭킹은 자동 접근이 차단된다. 운영자가 본 화면을 파일로 올린다',
  metrics:['rank','price_min','review_count','rating'],dailyQuota:null,scale:'rank'},
 {id:'musinsa_ranking_manual',label:'무신사 랭킹(가져오기)',method:'manual',autoFetch:false,hosts:[],
  basis:'공개 API 없음, robots.txt가 일반 수집기를 모두 막음(User-agent: * Disallow: /). 운영자 가져오기만',
  metrics:['rank','price_min','review_count','rating'],dailyQuota:null,scale:'rank'},
 {id:'oliveyoung_ranking_manual',label:'올리브영 랭킹(가져오기)',method:'manual',autoFetch:false,hosts:[],
  basis:'공개 API 없음, 자동 접근 시 403. 운영자 가져오기만',
  metrics:['rank','price_min','review_count','rating'],dailyQuota:null,scale:'rank'},
 {id:'own_sales',label:'자사 판매',method:'internal',autoFetch:false,hosts:[],
  basis:'COLLECTIVE 주문 장부·발행 관측(앱 안 자료)',
  metrics:['own_orders','own_revenue'],dailyQuota:null,scale:'absolute'},
];

export function sourceSpec(id:SourceId):SourceSpec{
 const spec=SOURCES.find(s=>s.id===id);
 if(!spec)throw new Error(`unknown product research source: ${id}`);
 return spec;
}

// 자동 수집기가 호출 직전에 부른다. 레지스트리가 허용하지 않은 출처·호스트면 던진다.
export function assertAutoFetch(id:SourceId,host:string){
 const spec=sourceSpec(id);
 if(!spec.autoFetch||spec.method==='manual'||spec.method==='internal')throw new Error(`${spec.label}은 자동 수집이 허용되지 않습니다.`);
 if(!spec.hosts.includes(host))throw new Error(`${spec.label}의 허용 호스트가 아닙니다: ${host}`);
}

// 운영자 가져오기를 받을 수 있는 출처(manual + 계약 데이터 내보내기 파일).
export const IMPORTABLE_SOURCES=SOURCES.filter(s=>s.method==='manual'||s.method==='licensed').map(s=>s.id);
