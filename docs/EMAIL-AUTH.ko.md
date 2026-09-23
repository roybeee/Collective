# 이메일 로그인 운영 안내

## 동작

`AUTH_MODE=email`에서 GPT 로그인 헤더는 무시한다. 사용자 이메일·비밀번호로 인증하고 D1의 기존 `workspace_owner`에 연결한다. 기존 records/settings/R2 데이터는 이동하거나 소유자를 바꾸지 않는다. 관리자가 초대한 직원만 가입할 수 있고, 직원은 같은 업무 자료를 공유한다. 관리자(소유자 포함)만 하는 작업은 연결 자격증명·채널 연결·사용량 단가·워커 설치 및 계정 관리, 캠페인 삭제, 브랜드 지식 수정, 작업물 최종 승인, 브랜드 사실 확정·거절, 아카이브 자료 확정·제외·진단 채택·의뢰 정보 수정, 발행 설정·승인·실행·취소다. 전체 표는 [보안 경계의 역할별 권한](SECURITY-BOUNDARIES.ko.md#역할별-권한-이메일-모드)을 따른다. 앱 화면은 직원에게 이 작업의 버튼을 그리지 않고 '관리자에게 요청하세요'를 안내한다(`app/auth-client.ts` `useCanManage`, 판정은 서버가 한다).

비밀번호는 scrypt N32768/r8/p3(32MiB), 개별 salt로 해시한다. 세션은 난수 토큰의 SHA-256만 DB에 저장하고 Secure/HttpOnly/SameSite=Lax `__Host-collective_session` 쿠키로 전달한다. 세션은 마지막 사용 뒤 7일(유휴) 또는 로그인 뒤 30일(절대) 중 먼저 오는 때에 끝난다. 사용할 때마다 만료를 늦추되 1시간 단위로만 기록한다(`lib/auth-session.ts` `authPrincipal`). 쿠키 Max-Age는 30일이며 만료 판정은 서버가 한다. 비밀번호 변경·재설정·계정 해제는 기존 세션을 폐기한다. 초대·재설정은 이메일에 묶인 24시간 일회용 링크다. 이메일 자동 발송 및 이메일 소유권 인증은 제공하지 않는다. 관리자가 본인 확인 후 해당 직원에게 링크를 직접 전달한다.

## 권한: 소유자·관리자·직원

소유자(owner)는 저장하지 않고 요청마다 계산한다. 같은 `workspace_owner` 안에서 `role='admin'`인 계정 중 `created_at`이 가장 이른 계정(같으면 id 오름차순)이 소유자다. 운영에서는 bootstrap으로 만든 첫 관리자가 소유자이며 데이터 이전은 없다. `/api/auth`와 계정 목록은 소유자를 `owner`로 돌려준다. 소유자는 관리자 권한을 모두 가진다(`requireAdmin`·`isAdmin`·`requireAdminActor` 통과).

| 작업 | 소유자 | 관리자 | 직원 |
|---|---|---|---|
| 직원 초대·재설정 링크·접근 해제·접근 복구·초대 취소·모든 로그인 종료 | 가능 | 가능 | 불가(403) |
| 관리자 초대, 관리자 대상 위 작업 | 가능 | 불가(403) | 불가 |
| 권한 변경(직원↔관리자) | 가능 | 불가(403) | 불가 |
| 소유자 계정 재설정·해제·권한 변경 | 불가(권한 불변) | 불가(403) | 불가 |
| 소유자 본인의 재설정 링크·모든 로그인 종료 | 본인만 | 불가(403) | 불가 |
| 계정 변경 기록(최근 20건) 보기 | 가능 | 불가 | 불가 |
| 본인 계정 접근 해제 | 불가(400) | 불가(400) | 불가 |

권한 검사는 화면과 서버에 모두 있다. 서버(`lib/auth-accounts.ts`)는 대상의 역할과 요청자의 현재 상태(활성 관리자, 소유자 전용 작업이면 소유자)를 쓰기 SQL 안에서 다시 확인한다. 업무 API는 `lib/server.ts`의 `actor()`(이메일 모드: 세션 계정, legacy: 헤더 id를 소유자로 취급), `requireAdminActor()`(소유자·관리자 아니면 403), `requireOwnerActor()`(소유자 아니면 403)를 쓴다. 앱 화면은 `AuthGate`가 내려 주는 로그인 상태(`app/auth-client.ts`의 `useAuthState`)로 사이드바 프로필에 이메일과 역할(소유자·관리자·직원)을 보여 준다. legacy 모드는 '워크스페이스 소유자'로 표시한다.

## 계정 관리 (`/api/accounts`)

- `invite`·`reset`: 기존과 같다. 관리자 초대와 관리자 대상 재설정은 소유자만 한다.
- `reactivate`(접근 복구): 접근 해제된 계정을 초대 대기로 되돌리고 24시간 일회용 재설정 링크를 발급한다. 링크로 새 비밀번호를 정하면 다시 로그인할 수 있다.
- `set_role`(권한 변경): 소유자만 직원↔관리자를 바꾼다. 소유자 권한은 바꿀 수 없고 활성 관리자가 한 명 이상 남아야 한다. 역할이 바뀌면 아직 쓰지 않은 초대·재설정 링크는 폐기되므로 초대 대기 계정은 링크를 다시 발급한다. 로그인 중인 계정에는 다음 요청부터 바로 적용된다. 관리자를 직원으로 바꾸거나 관리자의 접근을 해제하면, 그 관리자가 발급해 아직 쓰지 않은 다른 계정의 초대·재설정 링크도 같은 batch에서 폐기한다(발급 기록의 토큰 해시로 찾는다. 이 기능 전에 발급된 링크는 기록이 없어 24시간 만료를 따른다).
- `cancel_invite`(초대 취소): 수락 전(비밀번호 없음) 초대는 계정 행과 링크를 지운다. 같은 이메일을 다른 권한으로 다시 초대할 수 있다. 한 번이라도 로그인했던 계정은 접근 해제를 쓴다.
- `revoke_sessions`(모든 로그인 종료): 대상 계정의 세션만 모두 지우고 계정은 그대로 둔다. 소유자의 로그인은 소유자 본인만 끝낼 수 있고, 본인에게 쓰면 지금 화면도 로그아웃된다.
- 계정 변경 기록: 위 작업과 `disable`은 변경과 같은 batch·같은 조건으로 `records`(kind `account_event`)에 행위자(id·이메일), 작업, 대상 이메일, 바뀐 권한, 시각을 남긴다. 실제로 반영된 변경만 기록되고 토큰 원문은 남기지 않는다. 링크 발급 기록에는 발급자 해제·강등 때 링크를 폐기하려고 토큰 해시(`tokenHash`)를 함께 남기며, 목록 응답에서는 뺀다. 로그인 실패가 계정 전체 임계값(50회)을 처음 넘으면 `lockout` 기록(행위자 없음, 화면에는 '시스템')을 남긴다. 소유자는 계정 패널의 '최근 계정 변경'에서 최근 20건을 본다.
- 업무 이벤트: `eventStatement(owner,campaignId,message,actor?)`의 선택 인자로 행위자를 이벤트 `data.actor`에 남긴다. `/api/action` 외에 학습 규칙 실험·채택(`/api/learning`), 지점 변경·점포 실험 캠페인 생성·회고 승격(`/api/stores`), AI 작업 시작·재실행 허용·취소(`/api/run`), 회의 시작(`/api/meetings`)도 요청자를 넘긴다. 서버가 스스로 진행하는 백그라운드 이벤트에는 행위자가 없다. 캠페인 이력 탭은 행위자 이메일을 시각 옆에 보여 준다(legacy는 이메일이 없어 표시하지 않는다). 기존 호출은 그대로 동작한다.

## 로그인 제한과 기록 정리

- 요청 제한(15분 창): IP 키는 모든 요청을 100회까지 센다. 계정은 (계정+IP) 키 10회로 막는다. IPv6 주소는 /64 접두어로 묶어 세므로(`lib/auth-request.ts` `clientAddress`) 같은 /64 안에서 주소를 바꿔도 새 키를 받지 못한다. IPv4는 주소 그대로다. 여러 IP의 실패를 합산하는 계정 전체 키는 막지 않고 늦춘다(점진 지연): 50회까지는 바로 받고, 넘으면 직전 시도와 (초과 수)초, 최대 60초 간격을 둔 요청만 받는다. 간격 전 요청은 429('잠시 후(최대 1분) 다시 시도')이며 세지 않으므로 계속 두드려도 대기가 늘지 않는다. 그래서 다른 IP 5개에서 10회씩 틀려도 깨끗한 IP의 정상 로그인은 바로 된다. 로그인·초대 수락·bootstrap·비밀번호 변경이 성공하면 그 계정 키(계정+IP, 계정 전체)를 지우므로 남는 수는 실패뿐이다. 초기화가 실패해도 이미 반영된 인증 결과와 쿠키는 그대로 돌려준다. 계정 관리 요청(`admin:` 키)은 성공해도 초기화하지 않는다.
- 남은 위험(auth-3 부분 해결): IPv4 여러 개나 IPv6 /64 여러 개를 가진 공격자는 계정 전체 키를 넘긴 뒤 지연 간격마다 먼저 시도해 정상 사용자를 계속 늦출 수 있다(하드 차단이 아니어서 간격이 열리면 로그인할 수 있지만 경합한다). 성공 로그인이 계정 전체 키를 지우므로 공격자의 추측 예산도 그때 다시 50회로 채워진다. 사람 확인(Turnstile)과 기기 쿠키(성공 로그인 기기에 계정 전체 키를 적용하지 않는 방식)는 이번 범위에서 뺐다.
- 정리: 로그인이 성공할 때, 그리고 요청 제한에서 어떤 IP의 새 15분 창이 열릴 때마다 만료된 세션, 만료된 지 7일이 지난 초대·재설정 토큰(사용 여부 무관, 사용은 만료 전에만 가능), 창이 끝난 요청 제한 행을 지운다(`cleanupAuthRecords`). 로그인 성공이 드물어도 실패 요청이 쌓는 행은 다음 새 창에서 지워진다. bootstrap 기록은 남긴다. 정리가 실패해도 로그인은 유지한다. migration `0003`은 `auth_tokens.expires_at`, `auth_rate_limits.window_start` 인덱스만 추가하는 스키마 전용 변경이다(`CREATE INDEX` 2건, 데이터 변경 없음).
- 후속 과제: 민감한 작업의 재인증(auth-1 권고 3: 재설정·해제·관리자 초대 때 현재 비밀번호, auth-10 권고 3: 발행 승인·Buffer 연결·설치 파일 발급 때 최근 로그인 확인), 로그인 화면의 '이 기기에서 로그인 유지' 선택(선택하지 않으면 브라우저 세션 쿠키), 반복 실패 시 사람 확인(Turnstile), 기기 쿠키는 이번 범위 밖이다. 그래서 auth-1·auth-3·auth-10은 부분 해결이다. 관리자 세션이 탈취되면 재인증 없이 직원 재설정 링크 발급·접근 해제가 가능하다. 앱 전용 Android 환경에서 세션 쿠키가 앱 종료 때 사라지는지 확인한 뒤 '로그인 유지' 기본값을 정한다.

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

운영 빌드(`NODE_ENV=production`)에서 `AUTH_MODE`가 비어 있으면 모든 인증·업무 API가 503(인증 모드가 설정되지 않았습니다)으로 닫힌다(fail-closed). 기존 Sites 인증은 `AUTH_MODE=legacy`를 명시해야만 허용한다. 개발 서버에서만 미설정을 legacy로 본다. `email`·`legacy`가 아닌 값은 503이다. 환경 revision 변경·복구·재게시 뒤에는 `/api/auth`가 mode=email을 반환하는지 먼저 확인한다. **Sites public 상태에서 legacy로 되돌리면 안 된다.** 복구 시 먼저 Sites 접근을 owner-only로 돌리고 확인한 뒤 기존 코드/환경으로 되돌린다. 인증 테이블 삭제나 업무 데이터 변경은 필요 없다.

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
- 커버리지 백분율은 not_run. 만료 session/token/rate row 자동 청소는 이후 PR 1에서 로그인 성공 경로에 추가했다(위 '로그인 제한과 기록 정리').
- 독립 의존성 감사 `pnpm --ignore-workspace audit --prod --json`: failed(Critical0/High2/Moderate1/Low1). 기존 Next 빌드 경로의 browserslist4.28.2(권고≥4.28.7), baseline-browser-mapping2.10.30(≥2.11.0), @babel/core7.29.0(≥7.29.6). 이번 변경에서 의존성을 추가하지 않았으며 인증 요청 입력이 해당 도구에 전달되는 경로는 발견하지 못했다. 별도 의존성 갱신 과제로 남긴다.

PR 1(인증 강화) 기록:

- `tests/email-auth.test.mjs` 37건, `tests/auth-boundary.test.mjs` 28건: SQLite·native scrypt real, D1/Cloudflare binding adapter mocked. 소유자 계산, 관리자 B의 소유자 재설정·해제·권한 변경·세션 종료 403, 다른 IP 실패 10회 뒤 정상 로그인 성공, IP 5개×10회 실패 뒤 깨끗한 IP 정상 로그인 성공과 `lockout` 기록 1건, 같은 IPv6 /64 51개 주소 실패 뒤 다른 IP 정상 로그인 성공, 계정 전체 50회 초과 뒤 점진 지연, 제한 초기화 실패에도 비밀번호 변경·로그인 200과 쿠키, 새 IP 창의 정리, 해제·강등된 관리자가 발급한 링크 401, 유휴 7일·절대 30일 세션 만료, 접근 복구·권한 변경·초대 취소·모든 로그인 종료, 정리 작업, 행위자 기록, `AUTH_MODE` 미설정+운영 빌드 503을 확인한다.
- 리뷰 후속(직원 화면 버튼 숨김·행위자·잠금 완화) 뒤 로컬 재실행: 이메일 여정 1/1, 기본 여정 12/12 passed(로컬 macOS, real Chromium·workerd·로컬 D1). 이메일 여정은 직원 화면에 캠페인 삭제·채널 연결 버튼이 없고 관리자 화면에는 삭제 버튼이 있는지 확인한다.
- 기본 브라우저 여정은 legacy를 명시해서 띄운다(`e2e/serve.mjs`의 `--var AUTH_MODE:legacy`). 운영 빌드는 `NODE_ENV`가 production으로 고정되므로 미설정이면 503이 난다.
- 이메일 여정 간헐 실패 원인: wrangler dev 4.92 로컬 HTTPS 프록시는 워커가 요청 본문을 읽기 전에 응답하면 그 뒤에 오는 요청을 붙잡는다. 여정의 'Origin 없는 POST 403' 확인(본문 있음, 서버는 본문을 읽기 전에 거절) 바로 뒤 `member.reload()`가 멈췄다가 CI에서 'Network connection lost'(HTTP 500)로 끝났다. 로컬 재현: 본문 20KB로 키운 같은 여정이 3/3회 같은 줄(reload 뒤 '로그아웃' 미표시)에서 실패했고, 별도 스크립트에서 본문을 읽지 않는 POST 뒤 다른 연결의 GET이 24/40회 멈췄다(본문 없는 같은 POST는 0/40). 확인 요청에서 본문을 빼 고쳤다(서버 판정은 본문과 무관). 수정 뒤 이메일 여정 5/5회, 기본 여정 12/12 passed(로컬 macOS, real Chromium·workerd·로컬 D1). 운영 Workers와 무관한 로컬 환경 문제다. CI 로그의 TLS `CERTIFICATE_UNKNOWN`은 로컬(macOS)에서 재현되지 않아 원인으로 확인하지 못했다. 브라우저 여정에서 본문 있는 요청을 거절 경로로 보낼 때는 같은 문제를 피하도록 본문을 싣지 않는다.
