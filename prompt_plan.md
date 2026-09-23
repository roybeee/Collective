# COLLECTIVE Android 앱 계획 — 사용자 승인

기준: origin/main edd7219ad8c044cb8d0616e4170f81a7901903f6. 브랜치: feat/android-app.
작업 경로: /Users/roybee/Collective-android (기존 작업 트리 보존).

1. 기존 Sites URL·ChatGPT 로그인·데이터를 사용하는 Android 설치형 APK를 만든다.
2. TWA를 시도하고 도메인 연결 검증 실패 시 Custom Tabs 상단 바를 유지한다. 현재 assetlinks 경로 익명 HTTP 401.
3. COLLECTIVE 아이콘·시작 화면, 고정 HTTPS 실행 주소, 안전한 외부 입력 처리.
4. Android 빌드·서명·설치·실행, 웹 모바일 메뉴/파일/뒤로가기 확인. 실제 로그인에 사용자 조작이 필요하면 그 부분을 미검증으로 기록한다.
5. APK와 설치/재빌드 안내, 검사 증거를 제공한다. Play Store 출시는 별도.

검증: Android unit/lint/assemble, apksigner, 실제 에뮬레이터 실행. 웹 기존 test/typecheck/lint/build/Playwright. 코드·보안 리뷰. 실제 운영 쓰기·유료 모델 호출 없음.

## 이전 계획

# COLLECTIVE 안정성·운영 보완 계획

기준: origin/main 69c366d. 브랜치: feat/collective-reliability.
사용자가 분석의 다섯 개선 항목을 지목해 개발을 승인했다.

1. 역할 실행의 job·입력·학습 snapshot 원자 저장 및 멱등 복구. 활성 실행은 이력 제한과 분리.
2. 공급자 terminal 응답을 도메인 해석 전에 원장에 기록. 실제 모델·토큰·종료사유 보존, 미확인은 null. 명시한 가격 버전만 비용 추정에 사용.
3. 등록된 machine worker가 사용자가 시작한 역할/회의/바이럴/초안 작업을 진행. 캠페인 연속 실행 동의와 중지를 영구 저장. 조사·측정과 공정하게 순환.
4. owner 범위 캠페인 상세·작업물 버전 비교, 구조화된 성과 기간·근거·미확인 비용 및 기존 기록 호환.
5. 요청/응답 스트림 예산과 설치 관리자 경계 강화. 운영 Sites 인증·gateway 권한은 읽기 검증 도구와 절차로 분리하며 미실행은 미검증으로 보고.

검증: 새 회귀 테스트 RED/GREEN, 기존 전체 테스트, typecheck, lint baseline, build, 모바일/데스크톱 E2E, 코드·보안 리뷰.
실제 운영 변경/배포/유료 호출은 본 로컬 개발 검증에 포함하지 않는다.
