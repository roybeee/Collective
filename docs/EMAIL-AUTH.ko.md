# 이메일 로그인 운영 안내

## 동작

`AUTH_MODE=email`에서 GPT 로그인 헤더는 무시한다. 사용자 이메일·비밀번호로 인증하고 D1의 기존 `workspace_owner`에 연결한다. 기존 records/settings/R2 데이터는 이동하거나 소유자를 바꾸지 않는다. 관리자가 초대한 직원만 가입할 수 있고, 직원은 같은 업무 자료를 공유한다. 연결 자격증명·채널 연결·사용량 단가·워커 설치 및 계정 관리는 관리자만 변경한다.

비밀번호는 scrypt N32768/r8/p3(32MiB), 개별 salt로 해시한다. 세션은 난수 토큰의 SHA-256만 DB에 저장하고 Secure/HttpOnly/SameSite=Lax `__Host-collective_session` 쿠키로 30일 유지한다. 비밀번호 변경·재설정·계정 해제는 기존 세션을 폐기한다. 초대·재설정은 이메일에 묶인 24시간 일회용 링크다. 이메일 자동 발송 및 이메일 소유권 인증은 제공하지 않는다. 관리자가 본인 확인 후 해당 직원에게 링크를 직접 전달한다.

## 운영 전환 순서

현재 운영(2026-09-23 기준): `AUTH_MODE=email`, Sites 접근 public, 계정 1개(관리자). PR #18 merged 뒤 이메일 인증을 published했고, 사용자 명시 승인으로 로그인 진입 화면을 public(접근 설정 revision2)으로 전환했다. 익명·위조 GPT 헤더 업무 API와 계정 API의401을 운영에서 확인했다. 관리자가 초기 비밀번호를 설정했고, 2026-09-23 07:58 UTC 경 관리자 세션으로 버전23의 `/api/version` tree를 확인했다(runtime-verified). 아래 6단계의 bootstrap 환경 세 항목 제거·재게시는 기록이 없어 확인이 필요하다. 근거: [게시 기록](releases/2026-09-23-1ecd72e.md), [현재 상태](STATUS.md). 아래 순서는 이 전환에 쓴 절차이며 재구축·복구 때 참고한다.

1. 사용자가 첫 관리자 이메일을 지정한다. 비밀번호를 채팅·환경변수·소스에 저장하지 않는다.
2. 기존 운영 settings의 정확한 owner를 읽어 `AUTH_BOOTSTRAP_OWNER`에 연결한다. 임의 새 owner를 만들지 않는다.
3. 암호학적 난수 32바이트 이상의 bootstrap 토큰을 생성한다. Sites secret에는 원문이 아닌 SHA-256 해시만 `AUTH_BOOTSTRAP_TOKEN_HASH`로 넣는다. 원문은 비공개 일회용 `/#setup=TOKEN` 링크로 관리자에게만 전달한다. 브라우저는 fragment를 즉시 주소에서 제거한다.
4. Sites 환경에 `AUTH_MODE=email`, `AUTH_ORIGIN`(정확한 HTTPS origin, 끝 `/` 없음), `AUTH_BOOTSTRAP_EMAIL`, `AUTH_BOOTSTRAP_OWNER`, `AUTH_BOOTSTRAP_TOKEN_HASH`를 설정한다. 이메일·owner·hash는 secret으로 취급한다. 기존 모델·암호화·워커 환경은 보존한다.
5. owner-only Sites 접근을 유지한 채 검증된 소스와 migration 0002를 게시한다. migration은 인증 테이블만 추가한다. 운영 Workers CPU 한도에서 native scrypt 등록/로그인을 확인한다. 로컬 workerd 성공만으로 운영 한도까지 검증된 것은 아니다.
6. 기존 소유자가 초기 링크에서 직접 비밀번호를 정한다. 첫 관리자 등록은 DB에서 한 번만 가능하다. 기존 자료와 `/api/version`을 검증한다. 초기 등록 후 bootstrap 환경 세 항목을 제거하고 같은 버전을 재게시한다.
7. 사용자가 **로그인 진입 화면 공개**를 명시 승인한 뒤 Sites 접근을 public으로 전환한다. 앱 내부 데이터/API는 자체 세션 필수다. 공개 전환 전 `/api/auth`의 mode=email 및 위조 GPT 헤더/익명 업무 API의401을 확인한다. 공개 후 새 비로그인 브라우저에서 GPT 화면 없이 자체 로그인→자료 접근을 확인한다.
8. 기존 Android APK가 같은 URL을 열므로 서버 전환 후 별도 앱 재설치 없이 이메일 화면을 사용한다. 실제 기기 검증은 별도 기록한다.

`AUTH_MODE` 미설정 또는 `legacy`만 기존 Sites 인증을 허용한다. 다른 값은503으로 닫힌다. **Sites public 상태에서 legacy로 되돌리면 안 된다.** 복구 시 먼저 Sites 접근을 owner-only로 돌리고 확인한 뒤 기존 코드/환경으로 되돌린다. 인증 테이블 삭제나 업무 데이터 변경은 필요 없다.

## 검사

```sh
node scripts/test.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/lint-gate.mjs
node scripts/run-framework.mjs build
node node_modules/@playwright/test/cli.js test
node node_modules/@playwright/test/cli.js test -c playwright.auth.config.ts
```

아래 수치는 PR #18 병합 시점(2026-09-23) 기록이다. 현재 스위트·E2E 수는 [현재 상태](STATUS.md)와 [E2E 안내](E2E.ko.md)(기본 12건 + 이메일 1건)를 따른다.

- 인증 테스트20개: SQLite 및 native scrypt real, D1/Cloudflare binding adapter mocked. 경합 bootstrap, 초대 일회 소비·이메일 결합·만료, 비활성 관리자, 마지막 관리자, 세션 폐기, origin/입력/rate limit, 잘못된 AUTH_MODE 및 요청 한도 소진 후 로그아웃 검사.
- 인증 브라우저 여정1개: HTTPS/Chromium/workerd/native scrypt 및 로컬 D1 real. 외부 모델·실제 메일·운영 서버 호출 없음. 관리자 초기 등록·로그인·초대·새로고침 유지·cookie flags·멤버403·위조 GPT401·재사용401·재설정과 disable 후 세션401 확인.
- 기존 브라우저10개: real Chromium/로컬 D1, mocked Sites 인증 및 일부 AI 응답.
- 커버리지 백분율은 not_run. 만료 session/token/rate row 자동 청소는 미구현이며 운영 DB 용량 모니터링 필요.
- 독립 의존성 감사 `pnpm --ignore-workspace audit --prod --json`: failed(Critical0/High2/Moderate1/Low1). 기존 Next 빌드 경로의 browserslist4.28.2(권고≥4.28.7), baseline-browser-mapping2.10.30(≥2.11.0), @babel/core7.29.0(≥7.29.6). 이번 변경에서 의존성을 추가하지 않았으며 인증 요청 입력이 해당 도구에 전달되는 경로는 발견하지 못했다. 별도 의존성 갱신 과제로 남긴다.
