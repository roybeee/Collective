import type {LocalPartnerCandidate} from './store-growth';

// 공식 사업 소개를 실제 열람한 날짜. 조회할 때마다 갱신하지 않습니다.
// 전국 서비스 소개는 개별 점포 생활권의 도달·계약·효과를 입증하지 않습니다.
const CHECKED_AT='2026-10-11';
const EXPIRES_AT='2026-11-10';
type CatalogSource={id:string;name:string;kind:LocalPartnerCandidate['kind'];url:string;regions:string[];concepts:string[];summary:string};
const sources:CatalogSource[]=[
 {id:'revu-local',name:'레뷰 지역·매장 체험단',kind:'platform',url:'https://biz.revu.net/local',regions:[],concepts:['요식업','숙박','뷰티','키즈','공방'],summary:'공식 지역·매장 소개에서 블로그·인스타·숏폼 체험단 및 지역·업종·방문 일정별 선정 서비스를 확인했습니다. 모집 가능성과 실제 지역 도달·견적은 개별 확인이 필요합니다.'},
 {id:'dinnerqueen',name:'디너의여왕',kind:'platform',url:'https://dinnerqueen.net/qz_ads',regions:[],concepts:['요식업','카페','음식점'],summary:'공식 광고 안내의 인플루언서 마케팅 서비스를 확인했습니다. 개별 체험단의 방문 가능 지역·최근 협찬 실적·권리·비용은 제공자 확인이 필요합니다.'},
 {id:'reviewnote',name:'리뷰노트',kind:'platform',url:'https://www.reviewnote.co.kr/',regions:[],concepts:['요식업','뷰티','생활'],summary:'공식 체험단 서비스 홈페이지를 확인했습니다. 무료 여부를 점포별 총비용 0으로 해석하지 않으며 제공 상품·추가 요금·계약 범위는 개별 확인합니다.'},
 {id:'daangn-business',name:'당근 비즈프로필',kind:'platform',url:'https://business.daangn.com/business-profile/about',regions:[],concepts:[],summary:'공식 비즈프로필 소개에서 동네 고객 대상 사업장 운영 경로를 확인했습니다. 자체 채널 후보이며 특정 동네 실제 도달이나 광고비는 아직 확인하지 않았습니다.'},
 {id:'naver-smartplace',name:'네이버 스마트플레이스',kind:'platform',url:'https://smartplace.naver.com/introduction/smartplace',regions:[],concepts:[],summary:'공식 사업장 관리 서비스 소개를 확인했습니다. 정보 관리·방문 연결 후보이며 특정 점포의 검색 노출·매출·관리 권한은 별도 확인합니다.'},
 {id:'seongdong-journal',name:'성동저널',kind:'media',url:'https://www.seongdongnews.com/',regions:['서울 성동구'],concepts:['지역 소식','음식점','요식업'],summary:'매체 공식 홈페이지에서 성동구·성수동 동별 뉴스와 음식/맛집 분야를 확인했습니다. 지역 취재 범위에 관한 근거이며 실제 독자 거주지·협찬 가능 여부·광고 견적·성과는 미확인입니다.'},
];

export function catalogCandidates(storeId:string,today:string):LocalPartnerCandidate[]{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(Date.parse(`${today}T00:00:00Z`))||new Date(`${today}T00:00:00Z`).toISOString().slice(0,10)!==today)return [];
 return sources.map(s=>({id:`catalog-${storeId}-${s.id}`,storeId,name:s.name,kind:s.kind,url:s.url,regions:[...s.regions],concepts:[...s.concepts],audiences:[],dayparts:[],evidenceUrl:s.url,evidenceSummary:s.summary,publicBusinessEvidence:s.summary,recentExamples:[],quoteEvidenceUrl:'',rightsScope:'',rightsDays:null,visitConditions:'',sponsoredRatio:null,checkedAt:CHECKED_AT,expiresAt:EXPIRES_AT,localReach:null,localReachEvidence:'',quote:null,rights:'unknown',disclosure:'unknown',tracking:'unknown',status:'research',version:0}));
}
