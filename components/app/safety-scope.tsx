// 공용 '안전 범위' 안내(UX-PLAN-3 4차원 라이팅). 패널마다 '…하지 않습니다'를 되풀이하지 않고, 이 화면이 하는 일과 운영자가 직접 할 일을 한 줄로 적는다.
export function SafetyScope({children}:{children:React.ReactNode}){return <p className="safety-scope" role="note"><b>안전 범위</b> {children}</p>}
