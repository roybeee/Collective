// 상품 리서치 표준 카테고리(순수 모듈). 대표 결정(2026-10-03 D1): 푸드는 배송 이슈가 있어 상온 제품을 우선한다.
// temperature는 기본 보관 온도, regulatory는 리스크 체크리스트가 쓰는 규제 분류다. focus=true인 카테고리가 기본 조사 대상이다.
import type {CategoryId,RegulatoryClass,Temperature} from './types';

export type CategorySpec={id:CategoryId;label:string;group:'food'|'beauty'|'fashion'|'living';temperature:Temperature;regulatory:RegulatoryClass;focus:boolean;seedKeywords:readonly string[]};

export const CATEGORIES:readonly CategorySpec[]=[
 // 상온 식품(우선)
 {id:'food_sauce',label:'소스·양념(상온)',group:'food',temperature:'ambient',regulatory:'food',focus:true,seedKeywords:['마라소스','불닭소스','고추장','쌈장','떡볶이소스']},
 {id:'food_snack',label:'과자·스낵(상온)',group:'food',temperature:'ambient',regulatory:'food',focus:true,seedKeywords:['김부각','약과','누룽지칩','쌀과자','건강간식']},
 {id:'food_noodle',label:'라면·면류(상온)',group:'food',temperature:'ambient',regulatory:'food',focus:true,seedKeywords:['비빔면','짜파게티','마라탕면','냉면사리','쌀국수']},
 {id:'food_instant',label:'간편식·즉석(상온)',group:'food',temperature:'ambient',regulatory:'food',focus:true,seedKeywords:['즉석밥','레토르트','컵밥','죽','국밥']},
 {id:'food_tea_drink',label:'차·음료 분말(상온)',group:'food',temperature:'ambient',regulatory:'food',focus:true,seedKeywords:['유자차','보리차','콤부차','단백질쉐이크','식혜']},
 {id:'food_dried',label:'건어물·건조식품(상온)',group:'food',temperature:'ambient',regulatory:'food',focus:true,seedKeywords:['쥐포','김','미역','황태채','건나물']},
 {id:'food_health',label:'건강기능식품',group:'food',temperature:'ambient',regulatory:'health_functional_food',focus:false,seedKeywords:['유산균','콜라겐','비타민']},
 // 냉장·냉동 식품(후순위, 배송 이슈)
 {id:'food_chilled',label:'냉장 식품',group:'food',temperature:'chilled',regulatory:'food',focus:false,seedKeywords:['김치','반찬']},
 {id:'food_frozen',label:'냉동 식품',group:'food',temperature:'frozen',regulatory:'food',focus:false,seedKeywords:['만두','떡볶이밀키트']},
 // 뷰티·패션·리빙(확장)
 {id:'beauty_skincare',label:'스킨케어',group:'beauty',temperature:'ambient',regulatory:'cosmetics',focus:false,seedKeywords:['토너패드','선크림','앰플']},
 {id:'beauty_makeup',label:'메이크업',group:'beauty',temperature:'ambient',regulatory:'cosmetics',focus:false,seedKeywords:['쿠션','립틴트']},
 {id:'fashion_acc',label:'패션 잡화',group:'fashion',temperature:'ambient',regulatory:'general',focus:false,seedKeywords:['키링','에코백']},
 {id:'living_kitchen',label:'주방·리빙',group:'living',temperature:'ambient',regulatory:'kc_electrical',focus:false,seedKeywords:['에어프라이어용품','텀블러']},
];

export const FOCUS_TEMPERATURES:readonly Temperature[]=['ambient'];
export const focusCategories=()=>CATEGORIES.filter(c=>c.focus).map(c=>c.id);
export const categorySpec=(id:CategoryId|null)=>CATEGORIES.find(c=>c.id===id)??null;
