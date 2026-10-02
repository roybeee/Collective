// 공용 '안전 범위' 안내(UX-PLAN-3 4차원 라이팅). 패널마다 '…하지 않습니다'를 되풀이하지 않고, 이 화면이 하는 일과 운영자가 직접 할 일을 한 줄로 적는다.
// 같은 자리의 다른 주의(예: 개인정보 입력 금지)는 extra로 같은 묶음 안 다음 줄에 둔다. 안내가 두 단으로 따로 쌓이지 않는다(평가 9회차).
export function SafetyScope({children,extra}:{children:React.ReactNode;extra?:React.ReactNode}){return <p className="safety-scope" role="note"><b>안전 범위</b> {children}{extra&&<span className="safety-scope-extra">{extra}</span>}</p>}
