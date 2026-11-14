import '@/lib/i18n/lazy';
import {useT} from '@/lib/i18n-react';
// 공용 '안전 범위' 안내(UX-PLAN-3 4차원 라이팅). 패널마다 '…하지 않습니다'를 되풀이하지 않고, 이 화면이 하는 일과 운영자가 직접 할 일을 한 줄로 적는다.
// 같은 자리의 다른 주의(예: 개인정보 입력 금지)는 extra로 같은 묶음 안 다음 줄에 둔다. 안내가 두 단으로 따로 쌓이지 않는다(평가 9회차).
// 머리말은 공통 구역 사전(safety.scope, lib/i18n/ko-lazy.ts)에서 읽는다. 이 부품을 쓰는 화면은 모두 열 때 내려받는 화면이다(홈 첫 로딩에 없다).
export function SafetyScope({children,extra}:{children:React.ReactNode;extra?:React.ReactNode}){const t=useT();return <p className="safety-scope" role="note"><b>{t('safety.scope')}</b> {children}{extra&&<span className="safety-scope-extra">{extra}</span>}</p>}
