// 표준 사실 항목. key는 저장·중복 검사 기준, label은 화면·캡션·PNG 표시용, storeScoped는 지점마다 다른 항목(브랜드 공통 저장 시 확인 필요)이다.
export type FactCatalogItem={key:string;label:string;storeScoped:boolean};
export const factCatalog:FactCatalogItem[]=[
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
// 같은 항목의 흔한 다른 표기. 공백·구분 기호를 뺀 소문자로 비교한다.
const aliases:Record<string,string>={매장주소:'address',위치:'address',개점일:'opening_date',오픈날짜:'opening_date',운영시간:'hours',휴무:'closed_days',정기휴무:'closed_days',오시는길:'access',대중교통:'access',좌석수:'seating',배달:'delivery',포장:'delivery',배달여부:'delivery',전화:'phone',연락처:'phone',가격:'menu_price',메뉴가격:'menu_price',대표메뉴:'signature_menu',조리방법:'cooking_method',조리설비:'cooking_method',할인:'promotion',이벤트:'promotion',공식sns:'official_account',인스타그램:'official_account'};
const compact=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s·_\-./]/g,'');
const byName=new Map<string,string>([...factCatalog.flatMap(i=>[[compact(i.key),i.key],[compact(i.label),i.key]] as [string,string][]),...Object.entries(aliases)]);
// 카탈로그 항목이면 그 key, 아니면 기존 규칙(NFKC·소문자)으로 정규화한 자유 key.
export function canonicalFactKey(key:string):string{
 const free=key.normalize('NFKC').trim().toLowerCase();
 return byName.get(compact(free))??free;
}
export function factCatalogItem(key:string):FactCatalogItem|undefined{return factCatalog.find(i=>i.key===canonicalFactKey(key))}
// 표시 라벨. 카탈로그 밖의 자유 항목은 입력한 key를 그대로 보여 준다.
export function factLabel(key:string):string{return factCatalogItem(key)?.label??key}
