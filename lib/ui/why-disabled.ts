// 비활성 버튼의 이유(UX-PLAN-3 Q3·Q11): [조건, 이유] 목록에서 처음 참인 이유를 돌려준다. 버튼 옆에 보이고 aria-describedby로 연결한다.
// 진행 중(busy)처럼 잠깐인 상태는 이유를 보이지 않도록 목록에 넣지 않는다.
export function whyDisabled(rules:readonly (readonly [boolean,string])[]):string{return rules.find(([blocked])=>blocked)?.[1]??''}
