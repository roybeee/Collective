// 팀 회의 합의의 '채택한 방향'(decisions, 모델이 쓴 한 덩어리 글)을 결정 카드 단위로 나눈다(벤치마크 P2). 화면 표시 전용 순수 함수이며 저장 기록·모델 입력은 바꾸지 않는다.
// 줄마다 하나의 결정으로 보고 앞의 목록 기호(-, *, •, 1., 1), ①)를 뗀다. 한 줄뿐이면 카드 하나다. 너무 많으면 앞 12개만 카드로 두고 나머지는 마지막 카드에 붙인다.
const BULLET=/^\s*(?:[-*•·]|\d{1,2}[.)]|[①-⑳])\s*/;
export const MAX_DECISION_CARDS=12;
export function decisionItems(text:string|undefined):string[]{
 const lines=(text??'').split(/\r?\n/).map(l=>l.replace(BULLET,'').trim()).filter(Boolean);
 if(lines.length<=MAX_DECISION_CARDS)return lines;
 return [...lines.slice(0,MAX_DECISION_CARDS-1),lines.slice(MAX_DECISION_CARDS-1).join('\n')];
}
