'use client';
// 홈 화면 클라이언트 진입점(UX-PLAN-3 ⑩ 4G LCP). 서버 페이지가 AuthGate에 Workspace를 children으로 넘기면 Workspace 화면 코드는
// 첫 JS를 다 받은 뒤에야 따로 받기 시작했다(두 번째 물결). 한 클라이언트 모듈에서 둘을 정적으로 잇으면 서버 렌더가 이 모듈과
// 그 정적 의존성 전부를 <link rel="modulepreload">로 머리에 넣어, 화면 코드가 HTML을 읽는 즉시 함께 내려받힌다.
import AuthGate from './auth-gate';
import Workspace from './workspace';
export default function HomeClient(){return <AuthGate><Workspace/></AuthGate>}
