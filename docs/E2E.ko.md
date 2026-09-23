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
```

- 서버는 Playwright가 `e2e/serve.mjs`로 직접 띄운다. 매 실행마다 `e2e/.state/`에 빈 로컬 D1을 만들고 `drizzle/*.sql`을 적용한 뒤 `wrangler dev --local`을 `127.0.0.1:8799`(`E2E_PORT`로 변경)에서 시작한다. 운영 D1/R2에는 연결하지 않는다.
- 스크린샷(390×844 `mobile-*.png`, 1280×800 `desktop-*.png`), 실패 시 trace는 `e2e/artifacts/`에 남는다. 이 폴더와 `e2e/.state/`는 `.gitignore` 대상이라 빌드가 `dirty`로 표시되지 않는다.
- 두 화면 크기(`mobile`, `desktop` 프로젝트) × 테스트 5개 = 10건.

## 검사 내용

| 테스트 | 확인 | 근거 |
|---|---|---|
| 브랜드 등록 → 새로고침 → 유지 | UI로 브랜드 등록, `/api/archive` 200, 새로고침 뒤 브랜드 아카이브에 그대로 표시 | real: 브라우저, 빌드 결과, 로컬 D1 / mocked: 인증 |
| 다른 소유자 격리 | 다른 소유자 화면에 그 브랜드가 없고, `GET /api/archive?brandId=…`가 404 | 위와 같음 |
| 로그인 헤더 없음 | 화면에 "로그인이 필요합니다" 경고, `GET /api/workspace` 401 | real (헤더를 붙이지 않음) |
| 이전 원문·성과 수정 | 버전 비교, 미확인 비용 보존, 동시 수정 거부 | real Chromium/로컬 D1, mocked 인증 |
| 사용량 가격 | 명시한 모델별 단가 저장 | real Chromium/로컬 D1, mocked 인증 |
| 회의 실패 단계 재작성 | 완료 발언 유지, 단계/시도 지정 POST, 이후 GET 조회만 발생 | real Chromium, mocked 인증·회의 응답·작업자 상태 |

## 실제(real)와 모의(mocked)의 경계

- **인증은 모의다.** 운영에서는 Sites 디스패처가 로그인한 사용자에게 `oai-authenticated-user-id` 헤더를 붙이고, 앱(`lib/server.ts`의 `identity`)은 그 헤더를 소유자로 쓴다. 로컬에는 디스패처가 없으므로 테스트가 이 헤더를 직접 붙여 소유자를 재현한다. 앱의 인증 코드는 바꾸지 않았다. 운영 디스패처가 클라이언트가 보낸 같은 이름의 헤더를 제거하는지는 이 테스트로 검증되지 않는다.
- HERMES, OpenAI, 외부 조사는 호출하지 않는다(HERMES 미연결 상태에서 브랜드 등록은 조사를 접수하지 않는다).
- 로컬 D1/R2는 wrangler(miniflare) 시뮬레이터다. 운영 Cloudflare 환경과 같다는 증거는 아니다.
- 운영 사이트에 대한 E2E는 없다. 운영 확인은 `docs/PUBLISH.ko.md`의 `/api/version` 검증이 유일하다.

소유자 격리는 단위·통합 테스트에도 있다(`tests/workflow.mjs`, `tests/archive.test.mjs`, `tests/brief-workflow.mjs`, `tests/delete-campaign.test.mjs`, `tests/meetings.test.mjs`, `tests/learning.test.mjs`, `tests/measurements.test.mjs`). 이들은 라우트 핸들러를 SQLite와 모의 HERMES로 실행한다(mocked).

## 관측 사항

- 390px 폭에서 사이드바 시트는 메뉴를 눌러도 저절로 닫히지 않는다(2026-09-23). 테스트는 Escape로 닫는다. 제품 동작은 바꾸지 않았다.

## 차단(blocking)으로 올리는 기준

1. `main`에서 `e2e-smoke`가 연속 20회 이상(또는 2주) 실패 없이 통과한다. 실패가 있었다면 원인이 테스트 불안정이 아니라 실제 결함이었음을 기록한다.
2. CI 실행 시간이 `verify`와 합쳐 20분 안이다.
3. 위 조건을 `docs/STATUS.md`에 증거(실행 링크)와 함께 기록하고, 소유자 승인 뒤 `ci.yml`에서 `continue-on-error: true`를 제거하는 별도 PR을 연다.
