// 규제·리스크 체크리스트(순수). 계획 ⑦: 식품표시·화장품 기능성·KC·상표·가품 신호. 고위험은 총점과 별개로 '선정 금지'.
// 법률 판단이 아니라 사람이 확인할 항목 목록이다. 'blocked'는 자동 선정만 막고, 사람이 근거를 확인해 풀 수 있다(결정 기록 필요).
import type {RegulatoryClass,Temperature} from '../types';

export type RiskLevel='low'|'medium'|'high'|'blocked';
// term(추가 필드): 항목을 일으킨 말(예: 상표 이름). 승인 사유 확인에 쓴다.
export type RiskItem={rule:string;level:RiskLevel;reason:string;term?:string};
export type RiskResult={level:RiskLevel;items:RiskItem[];blocked:{rule:string;reason:string}|null};
export type RiskInput={regulatory:RegulatoryClass;
 // 규제 분류를 카테고리로 확인했는지. false면 '분류 미확인' 항목이 붙는다(match.ts classifyListing.regulatorySure).
 regulatorySure?:boolean;temperature:Temperature;titles:readonly string[];
 // 이미 확인한 인증·심의. 예: KC 인증서 번호 확인, 건강기능식품 표시·광고 심의 통과.
 certified?:{kc?:boolean;hffAdReview?:boolean;functionalCosmetics?:boolean};
 // 자사가 권리를 가진 브랜드(제목에 있어도 무방). protectedBrands 중 이 목록에 없는 이름이 보이면 타사 상표 사용이다.
 ownBrands?:readonly string[];protectedBrands?:readonly string[]};
const RANK:Record<RiskLevel,number>={low:0,medium:1,high:2,blocked:3};
// '높음' 항목을 승인하려면 결정 사유가 그 위험을 말해야 한다: 규칙마다 사유에 들어가야 할 말(하나 이상). 상표 규칙은 그 상표 이름도 인정한다.
export const REVIEW_TERMS:Record<string,readonly string[]>={
 trademark_use:['상표','브랜드','권리자','라이선스'],
 medical_claim:['의약','치료','표현','광고'],
 diet_claim:['다이어트','감량','표현','광고'],
 hff_review:['심의','건강기능'],
 functional_review:['기능성','심사'],
};
export const reviewTermsFor=(item:RiskItem)=>[...(REVIEW_TERMS[item.rule]??['리스크','위험']),...(item.term?[item.term]:[])];
export const maxLevel=(a:RiskLevel,b:RiskLevel)=>RANK[a]>=RANK[b]?a:b;

// 제목 위험 표현. 정규식은 NFC·소문자 제목에 쓴다. 오탐이 확인되면 이 표만 고친다.
export const TEXT_FLAGS:readonly {rule:string;level:RiskLevel;re:RegExp;reason:string}[]=[
 {rule:'counterfeit',level:'blocked',re:/가품|짝퉁|정품\s*(?:아님|아닙니다|아닌)|비정품|레플리카|replica|이미테이션/,reason:'가품·비정품 신호가 있습니다. 상표권 침해 위험이라 자동 선정하지 않습니다.'},
 {rule:'medical_claim',level:'high',re:/치료|완치|특효|처방|약효|질병\s*예방|병을?\s*낫/,reason:'의약품으로 오인할 표현(치료·완치·특효 등)이 있습니다. 식품 표시·광고법 위반 소지가 큽니다.'},
 {rule:'diet_claim',level:'high',re:/살\s*빠지|체지방\s*(?:감소|분해|제거)|다이어트\s*(?:효과|효능|보장)|\d+\s*kg\s*감량|지방\s*연소/,reason:'다이어트 효능을 과장하는 표현이 있습니다. 일반 식품은 체중 감량 효능을 표시할 수 없습니다.'},
 {rule:'bundle_exaggeration',level:'medium',re:/1\s*\+\s*1|2\s*\+\s*1|무조건\s*(?:최저|1등)|역대\s*최저|전국\s*1위/,reason:'1+1·최저가·1위 같은 판촉 표현은 근거(기간·조건)를 남겨야 합니다.'},
 {rule:'trademark_style',level:'medium',re:/[가-힣]\s?st(?![a-z])|[가-힣a-z]\s?스타일(?![가-힣])|정품\s*동일|동일\s*제조/,reason:"'○○ 스타일'·'정품 동일' 같은 타사 상표 연상 표현이 있습니다."},
];

const FOOD_BASE:RiskItem[]=[
 {rule:'food_labeling',level:'low',reason:'식품 표시사항(제품명·식품유형·내용량·원재료·영양성분)을 확인하세요.'},
 {rule:'food_expiry',level:'low',reason:'유통기한(소비기한)과 재고 회전이 맞는지 확인하세요.'},
 {rule:'food_origin',level:'low',reason:'원산지 표시 대상 원재료를 확인하세요.'},
 {rule:'food_allergen',level:'low',reason:'알레르기 유발 물질 표시를 확인하세요.'},
 {rule:'food_import',level:'low',reason:'수입품이면 수입식품 신고·한글 표시사항을 확인하세요.'},
];

export function assessRisk(input:RiskInput):RiskResult{
 const items:RiskItem[]=[],cert=input.certified??{};
 switch(input.regulatory){
  case 'food':items.push(...FOOD_BASE);break;
  case 'health_functional_food':
   items.push(...FOOD_BASE);
   items.push(cert.hffAdReview?{rule:'hff_review',level:'high',reason:'건강기능식품: 표시·광고 사전 심의 통과를 확인했습니다. 기능성 문구는 심의 받은 범위만 씁니다.'}
    :{rule:'hff_review',level:'blocked',reason:'건강기능식품은 표시·광고 사전 심의와 판매업 신고가 필요해 자동 선정하지 않습니다.'});
   break;
  case 'cosmetics':items.push({rule:'cosmetics_seller',level:'medium',reason:'화장품 책임판매업 등록과 전성분 표시를 확인하세요.'});break;
  case 'functional_cosmetics':
   items.push({rule:'cosmetics_seller',level:'medium',reason:'화장품 책임판매업 등록과 전성분 표시를 확인하세요.'});
   items.push({rule:'functional_review',level:cert.functionalCosmetics?'medium':'high',reason:cert.functionalCosmetics?'기능성 화장품 심사(보고) 완료를 확인했습니다.':'기능성 화장품(미백·주름·자외선 차단 등)은 식약처 심사·보고가 필요합니다.'});
   break;
  case 'kc_electrical':case 'kc_children':
   items.push(cert.kc?{rule:'kc_cert',level:'medium',reason:'KC 인증서 번호를 확인했습니다. 모델명이 인증서와 같은지 다시 확인하세요.'}
    :{rule:'kc_cert',level:'blocked',reason:`${input.regulatory==='kc_children'?'어린이 제품':'전기용품·생활용품'} KC 인증이 확인되기 전까지 선정하지 않습니다.`});
   break;
  case 'general':break;
 }
 if(input.regulatorySure===false)items.push({rule:'regulatory_unknown',level:'medium',reason:'카테고리·규제 분류를 확인하지 못했습니다. 식품·화장품·KC 대상인지 먼저 확인하세요.'});
 // 대표 결정 D1(2026-10-03): 푸드는 배송 이슈가 있어 상온 우선. 냉장·냉동은 물류 위험으로 표시한다.
 if(input.temperature==='chilled'||input.temperature==='frozen')items.push({rule:'logistics',level:'medium',reason:`${input.temperature==='frozen'?'냉동':'냉장'} 보관 상품입니다. 상온 우선 원칙(D1)에 따라 콜드체인 배송·반품 비용을 따로 검토하세요.`});
 if(input.temperature==='unknown')items.push({rule:'temperature_unknown',level:'low',reason:'보관 온도를 확인하지 못했습니다.'});
 const seen=new Set<string>();
 for(const raw of input.titles){
  const t=String(raw??'').normalize('NFC').toLowerCase();
  for(const f of TEXT_FLAGS)if(!seen.has(f.rule)&&f.re.test(t)){seen.add(f.rule);items.push({rule:f.rule,level:f.level,reason:f.reason})}
  const own=(input.ownBrands??[]).map(b=>b.normalize('NFC').toLowerCase());
  for(const b of input.protectedBrands??[]){const nb=b.normalize('NFC').toLowerCase();if(nb&&t.includes(nb)&&!own.includes(nb)&&!seen.has('trademark:'+nb)){seen.add('trademark:'+nb);items.push({rule:'trademark_use',level:'high',reason:`타사 상표 '${b}'가 제목에 있습니다. 권리자 허락 없이 쓰면 상표권 침해입니다(재판매·OEM이면 권리 관계를 확인하세요).`,term:b})}}
 }
 const level=items.reduce<RiskLevel>((m,i)=>maxLevel(m,i.level),'low'),b=items.find(i=>i.level==='blocked');
 return {level,items,blocked:b?{rule:b.rule,reason:b.reason}:null};
}
