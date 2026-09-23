import type {CampaignPlan,DraftMeta} from './brief';
export type Brand = {intake?:import('./archive').BrandIntake;id:string; name:string; short:string; category:string; color:string; bg:string; description:string; audience:string; tone:string; constraints:string; knowledge:string};
export type Campaign = {storeId?:string;storeExperimentId?:string;plan?:CampaignPlan;draftMeta?:DraftMeta;id:string; brandId:string; title:string; goal:string; audience:string; channels:string; stores:string; products:string; budget:number; startDate:string; endDate:string; constraints:string; sources:string; status:string; version:number; createdAt:string; updatedAt:string;};
export type Artifact = {campaignVersion?:number; outputContractVersion?:string; id:string; campaignId:string; role:string; title:string; content:string; status:string; version:number; origin:string; createdAt:string};
export type Run = {id:string; campaignId:string; role:string; status:string; error:string|null; createdAt:string; model:string; tokens:number};
export type Metric = {id:string; campaignId:string; period:string; revenue:number|null; variableCosts:number|null; adSpend:number|null; productionCost:number|null; orders:number|null; baselineContribution:number|null; notes:string;schemaVersion?:2;version?:number;periodStart?:string;periodEnd?:string;scope?:string;source?:string;definition?:string;method?:'manual'|'export';updatedAt?:string};
export type Event = {id:string; campaignId:string; message:string; createdAt:string};
export const roles = [
 {id:'cmo',name:'총괄 파트너',en:'Managing partner',initial:'MP',color:'#d9f36c',job:'목표를 실행 가능한 과제로',deliverable:'목표·범위·예산·일정과 미확정 사항을 구분한 실행 브리프. 예산과 성과 수치를 임의 확정하지 말 것.'},
 {id:'insight',name:'고객 인사이트',en:'Research & intelligence',initial:'RI',color:'#d9e5ff',job:'고객이 선택하는 이유를 발견',deliverable:'제공 자료에서 관찰한 사실, 출처, 추론, 검증할 가설을 구분. 검색한 자료는 URL과 기준 시점을 제시. 검색하지 못한 내용은 자료 필요로 표시하고 최신 시장조사를 했다고 주장하지 말 것.'},
 {id:'strategy',name:'브랜드 전략',en:'Brand strategist',initial:'BS',color:'#eedbfa',job:'브랜드만의 분명한 방향',deliverable:'타깃·구매 이유·핵심 메시지·제외 표현·판단 근거가 있는 전략 브리프.'},
 {id:'creative',name:'크리에이티브',en:'Creative director',initial:'CD',color:'#fbd6c5',job:'기억에 남는 아이디어로',deliverable:'서로 다른 캠페인 콘셉트 3개와 핵심 카피, 선택 근거 및 시각적 제작 지시서. 실제 이미지 생성과 구분할 것.'},
 {id:'content',name:'콘텐츠 스튜디오',en:'Content studio',initial:'CS',color:'#ffe9b3',job:'채널에 맞는 카피와 제작안',deliverable:'게시물 카피 3종, 15초 영상 대본 1종, 랜딩 구성안과 제작 규격. 이미지·영상 파일이 생성되었다고 주장하지 말 것.'},
 {id:'growth',name:'채널 & 그로스',en:'Growth strategist',initial:'GS',color:'#c8eade',job:'아이디어를 고객에게 연결',deliverable:'채널·대상·예산 배분·일정·UTM·중단 조건. 광고 집행은 미연결 상태로 계획만 작성.'},
 {id:'data',name:'데이터 & 실험',en:'Measurement lead',initial:'ML',color:'#cce9f4',job:'숫자로 증명하는 성장',deliverable:'지표 정의·기준 기간·대조군·수집 방법·실험 판정 기준. 데이터가 없으면 성과 측정 설계만 작성하고 수치를 꾸미지 말 것.'},
 {id:'quality',name:'독립 품질 검수',en:'Independent reviewer',initial:'QA',color:'#e1e3e8',job:'좋은 결과의 마지막 기준',deliverable:'앞선 결과물의 근거·브랜드 적합성·제작 완성도·측정 가능성을 각각 통과/수정/자료 필요로 판정. 발견 위치와 구체적인 수정 요청. 자기인증 점수나 승인 처리는 하지 말 것.'}
];
export const brandDefaults:Brand[] = [
 {id:'ofd',name:'Old Ferry Donut',short:'OFD',category:'BAKERY & COFFEE',color:'#273953',bg:'#e5e9ee',description:'묵직하고 쫄깃한 도우, 아낌없이 채운 크림. 일상에서 만나는 프리미엄 도넛.',audience:'좋은 디저트와 브랜드 경험을 찾는 고객',tone:'클래식하고 위트 있는, 자신감 있는, 따뜻한',constraints:'기존 로고·캐릭터·컬러 유지. 상시 가격 할인에 의존하지 않기.',knowledge:'Deep Navy + Cream. 클래식 세리프와 볼드 산세리프. 항해 모티프. 제품과 매장 경험을 중심으로 표현.\n초기 브랜드 정보: 대표님 대화 기반. 실제 제품·가격·매장 정보는 캠페인 시작 전 확인.'},
 {id:'oda',name:'ODA Pizza',short:'ODA',category:'CONTEMPORARY PIZZA',color:'#bf442b',bg:'#f9e5dd',description:'화덕의 열기와 풍성한 도우. 일상에서 즐기는 contemporary wood-fired pizza.',audience:'합리적인 가격으로 완성도 있는 한 끼를 찾는 고객',tone:'젊고 감각적, 친근하고 선명한',constraints:'실제 메뉴와 가격 확인. 배달 수수료와 상품 원가를 고려.',knowledge:'볼드 타이포그래피와 명확한 그래픽. 매장·포장·배달에서 일관된 매력.\n초기 브랜드 정보: 대표님 대화 기반. 현재 판매 메뉴는 별도 확인.'},
 {id:'mapdal',name:'MAPDAL',short:'MD',category:'K-FOOD & CULTURE',color:'#91394d',bg:'#f6e2e9',description:'Sweet + Spicy. K-food와 팬덤, 공간을 연결하는 맵달.',audience:'K-food와 문화 경험에 관심 있는 Gen Z·Alpha',tone:'대담하고 즐거운, 문화적 맥락을 이해하는',constraints:'사업별 타깃 구분. 해외 시장의 반응을 검증 없이 일반화하지 않기.',knowledge:'MAPDAL SEOUL · MAPDAL BUNSIK · MAPDAL VENDING MACHINE.\n초기 브랜드 정보: 대표님 대화 기반. 국가·사업별 제품 정보 확인 필요.'},
 {id:'alan',name:'Dr.alan623',short:'a623',category:'BEAUTY & DAILY RITUAL',color:'#38645e',bg:'#deede8',description:'미세한 미스트와 일상의 리추얼을 중심으로 하는 뷰티 브랜드.',audience:'간편하고 세련된 스킨케어 경험을 찾는 고객',tone:'정제된, 명료한, 연구 근거를 존중하는',constraints:'닥터알란623 / Dr.alan623 표기. 입증되지 않은 효능 주장 금지.',knowledge:'미스트를 중심으로 세럼·선크림으로 확장 구상.\n초기 브랜드 정보: 대표님 대화 기반. 성분·시험 근거·판매 상태는 확인 필요.'}
];
export const statuses:Record<string,string>={draft:'브리프 작성',ready:'실행 준비',running:'AI 작업 중',review:'검토 대기',approved:'기획 승인',revision:'수정 요청',measuring:'성과 기록'};
export function money(n:number){return new Intl.NumberFormat('ko-KR').format(n)+'원'}
export function metricSummary(m:Metric){
 const contribution=m.revenue===null||m.variableCosts===null?null:m.revenue-m.variableCosts;
 const net=contribution===null||m.adSpend===null||m.productionCost===null?null:contribution-m.adSpend-m.productionCost;
 return {contribution,net,observedChange:net===null||m.baselineContribution===null?null:net-m.baselineContribution,roas:m.revenue!==null&&m.adSpend!==null&&m.adSpend>0?m.revenue/m.adSpend:null,cpa:m.adSpend!==null&&m.orders!==null&&m.orders>0?m.adSpend/m.orders:null};
}
