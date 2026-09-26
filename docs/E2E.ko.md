# E2E 스모크 (Playwright)

로컬에서 빌드한 앱을 실제 브라우저(Chromium)로 조작해 핵심 여정 하나가 저장까지 이어지는지 본다.
현재 CI에서는 **비차단**(`e2e-smoke` 잡, `continue-on-error: true`)이다. `verify` 잡과는 독립적이다.

## 실행

`pnpm run`은 이 저장소에서 실패하므로(`packages field missing or empty`) node로 직접 실행한다.
`package.json`의 `test:e2e` 스크립트는 같은 명령을 기록해 둔 것일 뿐이다.

```bash
pnpm install --frozen-lockfile                              # pnpm 11.25.0
node node_modules/@playwright/test/cli.js install chromium   # 최초 1회
node scripts/run-framework.mjs build                         # dist/ 생성 (소스를 바꾸면 다시)
node node_modules/@playwright/test/cli.js test
node node_modules/@playwright/test/cli.js test -c playwright.auth.config.ts   # 이메일 인증 1건
```

- 서버는 Playwright가 `e2e/serve.mjs`로 직접 띄운다. 매 실행마다 `e2e/.state/`에 빈 로컬 D1을 만들고 `drizzle/*.sql`을 적용한 뒤 `wrangler dev --local`을 `127.0.0.1:8799`(`E2E_PORT`로 변경)에서 시작한다. 운영 D1/R2에는 연결하지 않는다.
- `e2e/serve.mjs`는 wrangler를 띄우기 전에 `e2e/wrangler-proxy-fix.mjs`로 설치된 wrangler 4.92.0의 로컬 프록시(`node_modules/wrangler/wrangler-dist/ProxyWorker.js`)를 고친다. 끊긴 GET이 다음 요청까지 멈추던 버그를 wrangler 4.114·4.130 수정으로 되돌려 넣은 것이다. 한 번만 적용하고, 다른 wrangler 버전이면 건너뛰며, 원문이 다르면 서버를 띄우지 않고 멈춘다. 로컬에서 E2E를 돌리면 설치본이 바뀐다(`pnpm install --force`로 되돌린다). 운영 Workers에는 이 프록시가 없다.
- 스크린샷(390×844 `mobile-*.png`, 1280×800 `desktop-*.png`), 실패 시 trace는 `e2e/artifacts/`에 남는다. 로컬 서버 stdout 전체(wrangler 요청 기록: 경로·상태·처리 시간)는 줄마다 UTC 시각을 붙여 `e2e/artifacts/server-default.log`(이메일 인증 여정은 `server-auth.log`)에 남는다. CI는 이 폴더를 늘 올리므로(`e2e-artifacts`), 응답 없이 멈춘 요청을 Playwright 시각과 맞춰 볼 수 있다(2026-09-25 `meeting-quality.spec.ts:40` 흔들림 조사용). 이 폴더와 `e2e/.state/`는 `.gitignore` 대상이라 빌드가 `dirty`로 표시되지 않는다.
- 기본 설정(`playwright.config.ts`): 두 화면 크기(`mobile`, `desktop` 프로젝트) × 테스트 7개(`smoke` 5, `meeting-quality` 1, `execution` 1) = 14건.
- 이메일 인증 설정(`playwright.auth.config.ts`): `email-auth` 1건(390px, HTTPS `127.0.0.1:8800`). 합계 15건.

## 검사 내용

| 테스트 | 확인 | 근거 |
|---|---|---|
| 브랜드 등록 → 새로고침 → 유지 | UI로 브랜드 등록, `/api/archive` 200, 새로고침 뒤 브랜드 아카이브에 그대로 표시 | real: 브라우저, 빌드 결과, 로컬 D1 / mocked: 인증 |
| 다른 소유자 격리 | 다른 소유자 화면에 그 브랜드가 없고, `GET /api/archive?brandId=…`가 404 | 위와 같음 |
| 로그인 헤더 없음 | 화면에 "로그인이 필요합니다" 경고, `GET /api/workspace` 401 | real (헤더를 붙이지 않음) |
| 이전 원문·성과 수정 | 버전 비교, 미확인 비용 보존, 동시 수정 거부 | real Chromium/로컬 D1, mocked 인증 |
| 사용량 가격 | 명시한 모델별 단가 저장 | real Chromium/로컬 D1, mocked 인증 |
| 캠페인 삭제(목록 ⋯ 메뉴) | 대시보드 표에 삭제·더 보기 없음, 삭제 영향 조회 건수(작업물 1건)·결정 7 안내 표시, 제목 불일치 시 비활성·일치 시 활성, 삭제 뒤 `GET /api/campaigns/[id]` 404 | real Chromium/로컬 D1, mocked 인증 |
| 회의 실패 단계 재작성 | 완료 발언 유지, 단계/시도 지정 POST, 이후 GET 조회만 발생 | real Chromium, mocked 인증·회의 응답·작업자 상태 |
| 확인 사실 → PNG 제작 → 새로고침 뒤 내려받기 | 확인 사실 등록, `save_creative` 200, `/api/execution/asset` 200과 1080×1080 PNG, 새로고침 뒤 내려받기 링크 유지, 발행 이력 없음 | real Chromium Canvas·로컬 D1/R2 / mocked 인증. 외부 게시 없음 |
| 이메일 로그인·초대·세션 유지·권한 제한·폐기(별도 설정) | 관리자 초기 등록, 쿠키 속성, 새로고침 유지, 초대·멤버403, 직원 화면의 캠페인 삭제·채널 연결 버튼 미표시(관리자 화면의 캠페인 목록에는 더 보기 메뉴 표시), 위조 GPT 헤더401, 재사용401, 재설정·해제 뒤 세션401 | real HTTPS Chromium·로컬 workerd/D1·native scrypt. 실제 메일·운영 서버 호출 없음 |

## 실제(real)와 모의(mocked)의 경계

- **기본 12건의 인증은 모의다.** 운영은 `AUTH_MODE=email`이며 앱(`lib/server.ts`의 `identity`)은 자체 세션 쿠키로 사용자를 확인하고 `oai-authenticated-user-id` 헤더를 무시한다. 기본 설정은 `AUTH_MODE=legacy`를 명시해 서버를 띄우고(`e2e/serve.mjs`의 `--var AUTH_MODE:legacy`. 운영 빌드는 미설정이면 503이다. legacy는 로컬 개발·E2E용이다. 운영에서는 Sites 접근을 owner-only로 되돌린 뒤의 [복구 절차](EMAIL-AUTH.ko.md)에서만 쓰며, Sites public 상태에서는 절대 쓰지 않는다), 테스트가 이 헤더를 직접 붙여 소유자를 재현한다. 운영과 같은 세션 인증은 이메일 설정 1건만 로컬에서 실제로 실행한다. 운영 사이트의 익명·위조 헤더 거부는 이 테스트가 아니라 [게시 기록](releases/2026-09-23-1ecd72e.md)의 운영 검사가 근거다.
- HERMES, OpenAI, 외부 조사는 호출하지 않는다(HERMES 미연결 상태에서 브랜드 등록은 조사를 접수하지 않는다).
- 로컬 D1/R2는 wrangler(miniflare) 시뮬레이터다. 운영 Cloudflare 환경과 같다는 증거는 아니다.
- 운영 사이트에 대한 E2E는 없다. 운영 확인은 `docs/PUBLISH.ko.md`의 `/api/version` 검증과 게시 기록에 남긴 운영 검사뿐이다.

소유자 격리는 단위·통합 테스트에도 있다(`tests/workflow.mjs`, `tests/archive.test.mjs`, `tests/brief-workflow.mjs`, `tests/delete-campaign.test.mjs`, `tests/meetings.test.mjs`, `tests/learning.test.mjs`, `tests/measurements.test.mjs`). 이들은 라우트 핸들러를 SQLite와 모의 HERMES로 실행한다(mocked).

## 요청 가로채기(page.route) 규칙

`page.route` 처리기 안에서 `route.fetch()`로 실제 응답을 받아 고쳐 돌려주지 않는다. 테스트에 필요한 실제 응답은 가로채기 전에 `page.request.get`으로 미리 받아 두고, 처리기에서는 `route.fulfill({json:...})`로 바로 돌려준다(`e2e/navigation.spec.ts`의 폴링 테스트, `e2e/meeting-quality.spec.ts`). 부하가 걸린 러너에서 `route.fetch`가 응답을 돌려주지 않고 멈춘 적이 있고(그러면 화면의 폴링이 끝나지 않은 요청에 막힌다), 화면이 계속 조회하는 동안 컨텍스트를 닫으면 진행 중인 `route.fetch` 응답이 폐기돼 `Response has been disposed` 경합이 난다. 응답이 테스트 도중 바뀌어야 하면 처리기 안에서 `route.fetch`가 아니라 `page.request.get`으로 새로 받고, 그 `await`가 끝난 뒤 `fulfill`한다. 테스트 끝에서는 지금처럼 `page.unrouteAll({behavior:'wait'})`로 처리기가 끝나기를 기다린 뒤 컨텍스트를 닫는다.

## 관측 사항

- 390px 폭에서 사이드바 시트는 메뉴를 눌러도 저절로 닫히지 않는다(2026-09-23). 테스트는 Escape로 닫는다. 제품 동작은 바꾸지 않았다.

## 차단(blocking)으로 올리는 기준

1. `main`에서 `e2e-smoke`가 연속 20회 이상(또는 2주) 실패 없이 통과한다. 실패가 있었다면 원인이 테스트 불안정이 아니라 실제 결함이었음을 기록한다. `main` 실행마다 `e2e-smoke`의 `Record outcome` 단계가 실행 요약에 `e2e-smoke main: success|failure (run <id>)`를 남긴다. 연속 횟수는 `gh run list --workflow ci.yml --branch main`으로 실행 목록을 받아 각 실행의 이 요약 줄(또는 `gh run view <id> --json jobs`의 `e2e-smoke` 단계 결론)로 센다. 잡 단위 `continue-on-error` 때문에 실행 전체 결론만으로는 e2e 실패를 알 수 없다.
2. CI 실행 시간이 `verify`와 합쳐 20분 안이다.
3. 위 조건을 `docs/STATUS.md`에 증거(실행 링크)와 함께 기록하고, 소유자 승인 뒤 `ci.yml`에서 `continue-on-error: true`를 제거하는 별도 PR을 연다.
