// 상표 리스크 검사용 기본 보호 상표 목록(편집 가능한 예시). 계획 ⑦: 타사 상표가 제목에 있으면 리스크 '높음'(사람 확인 필요)으로 본다.
// 이 목록은 법률 판단이 아니라 국내 주요 식품 회사·대표 브랜드 이름 예시다. 실제 운영 전 대표·법무가 고치고(추가·삭제), 고친 날을 BRAND_LIST_REVIEWED_AT에 적는다.
// 소유자 브랜드(records kind 'brand'의 name)는 보호 목록에 더하되 자사 상표(ownBrands)라 위험으로 보지 않는다(risk.ts).
export const BRAND_LIST_REVIEWED_AT:string|null=null; // null = 확인 전 예시 목록
export const DEFAULT_PROTECTED_BRANDS:readonly string[]=[
 // 일반 낱말과 겹치는 이름(대상·순창·백설·크라운 등)은 오탐이 많아 넣지 않았다. 필요하면 '대상 청정원'처럼 구체적인 표기로 더한다.
 '오뚜기','농심','삼양','청정원','비비고','햇반','풀무원','동원','오리온','롯데','해태','빙그레','팔도','사조','하림','해찬들','종가집','신라면','불닭','진라면','짜파게티','초코파이','새우깡','허니버터칩',
];
// 소유자 브랜드 이름 + 기본 목록 → 중복 없는 보호 상표 목록(두 글자 미만은 오탐이 많아 뺀다).
export function protectedBrandList(ownerBrands:readonly string[],extra:readonly string[]=DEFAULT_PROTECTED_BRANDS):string[]{
 return [...new Set([...extra,...ownerBrands].map(b=>String(b??'').normalize('NFC').trim()).filter(b=>[...b].length>=2))].sort();
}
