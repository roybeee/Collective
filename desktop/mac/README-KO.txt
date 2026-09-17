COLLECTIVE for Mac · 1.0.0 · 온라인 설치 패키지

설치
1. ZIP 파일 전체를 압축 해제합니다. payload 폴더를 이동하거나 지우지 마세요.
2. Install-COLLECTIVE.command를 더블클릭합니다.
3. 공식 Electron 엔진 다운로드·SHA-256 검사·설치가 자동으로 진행됩니다.
4. COLLECTIVE가 열리면 기존 ChatGPT 계정으로 로그인합니다.

Apple Silicon(M 시리즈) / Intel 자동 감지. macOS 12 이상, 인터넷 필요.
Node.js, Homebrew, Xcode 설치 불필요. 관리자 암호를 요청하지 않습니다.
설치 위치: 사용자 홈 폴더/Applications/COLLECTIVE.app
Finder에서 앱을 Dock으로 드래그하여 고정할 수 있습니다.

macOS가 처음 실행을 막으면:
시스템 설정 → 개인정보 보호 및 보안에서 해당 파일의 '확인 없이 열기'를 선택하세요.
이 패키지는 Apple 공증을 받은 배포본이 아닙니다. 설치 시 Mac에서 로컬 서명합니다.
시스템 보안 설정을 끄거나 전체 격리 속성을 제거할 필요는 없습니다.

사용
- 전용 앱 창에서 기존 COLLECTIVE 웹 서비스를 이용합니다. 인터넷 연결이 필요합니다.
- 서버의 캠페인·HERMES 설정을 그대로 이용하며, 로그인 세션만 Mac에 저장합니다.
- 메뉴 '계정 → 다시 로그인' 또는 '브라우저에서 열기'를 사용할 수 있습니다.
- 회의 진행 중에는 팀 회의 화면을 유지하세요. 화면을 다른 탭으로 전환하거나 창을 닫으면
  단계 진행이 멈출 수 있습니다. Mac 잠자기·앱 종료 중 무인 실행은 지원하지 않습니다.
- 웹 기능의 서버 업데이트는 다시 설치하지 않아도 반영됩니다.
- Electron 엔진 업데이트는 새 설치 패키지로 재설치해야 합니다. 자동 업데이트는 없습니다.

현재 검증 범위
설치 스크립트 문법, 실행 코드 문법, URL 제한 규칙, ZIP 파일 구조를 확인했습니다.
실제 macOS 설치·서명·로그인·HERMES 회의 실행은 이 Linux 환경에서 검증하지 못했습니다.
기존 서버에서 발견한 사용자 식별자 누락(401) 문제는 이 설치 파일로 해결되지 않습니다.
로그인 실패가 계속되면 서버 인증 문제 해결이 먼저 필요합니다.
HERMES 자체를 Mac에 설치하거나 PC의 HERMES 서비스를 자동 구성하는 패키지는 아닙니다.

삭제
앱을 Cmd+Q로 종료한 후 사용자 홈/Applications/COLLECTIVE.app을 휴지통으로 이동합니다.
로컬 로그인 정보까지 삭제하려면 사용자 홈/Library/Application Support/COLLECTIVE를
Finder에서 확인 후 삭제하세요. 서버 캠페인은 삭제되지 않습니다.
업데이트 시 남긴 COLLECTIVE-backup-*.app은 새 버전 확인 후 직접 삭제할 수 있습니다.

기술 정보
Electron 44.4.1 공식 배포 파일과 공식 SHASUMS256.txt를 HTTPS로 내려받습니다.
https://releases.electronjs.org/release?channel=stable
https://www.electronjs.org/docs/latest/tutorial/security
원격 페이지의 Node.js 접근 차단, 렌더러 샌드박스, 컨텍스트 격리 적용.
서버 비밀번호·API 키·사이트 접근 토큰은 이 패키지에 포함하지 않습니다.
