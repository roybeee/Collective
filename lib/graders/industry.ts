// industry_metric_leak 업종 사전(G3). v1 사전(locker·kpop·beauty)은 campaign-policy.ts campaignEvidencePolicy의 보관함 정규식을 업종 사전으로 일반화했다.
// G3에서 fnb·education·popup·retail을 더했다. 사전 용어는 그 업종에서만 쓰는 운영 지표·용어의 복합어로 둔다.
// 업종 간 공용 용어(COMMON_TERMS: 가격·배송·메뉴·포장·대기·재고·진열·상담 등)는 단독으로 사전에 걸리지 않는다(tests/graders-meeting-brief.test.mjs가 확인).
// 예: MAPDAL(브랜드 범주 K-FOOD & CULTURE)의 kpop 캠페인이 떡볶이·분식 메뉴·먹방 같은 음식 낱말로 fnb 유입이 되지 않게, fnb는 원산지·메뉴판·테이블 회전·배달 주문처럼 음식점 운영 용어만 본다.
export const INDUSTRY_TERMS:Record<string,RegExp>={
 locker:/물품보관함|보관함|락커|\blocker\b|가동\s?가능\s?시간|가동률/i,
 kpop:/포토카드|초동|팬사인회|앨범\s?판매/,
 beauty:/피부\s?개선|보습\s?효과|성분\s?함량/,
 fnb:/원산지|메뉴판|(?:신|대표|시그니처|세트|사이드|주력|점심|저녁)\s?메뉴|포장\s?(?:주문|손님|판매)|테이크\s?아웃|배달\s?(?:주문|앱|매출|비중|수수료)|배달의민족|쿠팡이츠|요기요|(?:테이블|좌석)\s?회전|식자재/,
 education:/수강생|수강료|수강\s?(?:신청|등록|인원|문의)|커리큘럼|(?:입학|수강|진로|학습|등록)\s?상담|레벨\s?테스트|체험\s?수업|학부모|재원생|학원생|강사진|개강/,
 popup:/입장객|입장권|입장료|입장\s?(?:정원|마감)|사전\s?예약\s?입장|회차(?:별|제)\s?입장|동시\s?수용\s?인원|팝업\s?(?:스토어\s?)?운영\s?기간/,
 retail:/(?:지점|점포|매장)별\s?(?:재고|진열)|재고\s?(?:회전|실사)|진열\s?면적|플래노그램|planogram|엔드\s?캡/i,
};
// 여러 업종이 같이 쓰는 낱말. 사전은 이 낱말 하나로는 걸리지 않아야 한다.
export const COMMON_TERMS=['가격','배송','할인','이벤트','리뷰','후기','매장','방문','고객','주문','예약','쿠폰','결제','매출','객단가','회원','굿즈','오픈','기간','장소','지점','메뉴','포장','배달','대기','대기 번호','재고','재고 소진','진열','진열대','매대','상담','상담 신청','수업','클래스','체험','입장','팝업','팝업 기간','방문객 수','행사 기간','세트','신제품','발주','픽업'];
// 캠페인 업종: 단일 ID 또는 [주 업종, ...허용 업종]. 문자열이 아닌 값과 빈 문자열은 버린다. 결과가 비면 업종 미상이다.
export function industryIds(industry:unknown):string[]{
 const list=Array.isArray(industry)?industry:[industry];
 return list.filter((x):x is string=>typeof x==='string'&&!!x.trim()).map(x=>x.trim());
}
