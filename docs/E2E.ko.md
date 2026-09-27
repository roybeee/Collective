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

- 서버는 Playwright가 `e2e/serve.mjs`로 직접 띄운다. 매 실행마다 `e2e/.state/`에 빈 로컬 D1을 만들고 `drizzle/*.sql`을 적용한 뒤 `wrangler dev --local`을 `127.0.0.1:8799`(`E2E_PORT`로 변경)에서 시작한다. 운영 D1/R2에는 연결하지 않는다. 기본 설정은 가맹 리드 가져오기가 연락처를 암호화해 저장하도록 공개된 테스트 전용 고정 키(`AGENCY_ENCRYPTION_KEY`, 32바이트 0x07)를 넘긴다. 운영 키와 무관하다.
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
| 가맹 모집 자료 승인·내보내기의 대기기간 확인(#186 결정 34, `franchise-recruit.spec.ts`) | 포털 소개문 초안의 후보 문장 2개(정보공개서·가맹금/계약)만 원문 보기와 승인 단계에서 `<mark>` 강조, 체크리스트를 모두 체크해도 확인란 전에는 승인 버튼 잠김, 확인 없는 `asset_approve`·`asset_export` 409 `wait_review_missing`, 확인 뒤 승인 200(요청에 판·후보 수 2), 확인란 전 복사·내려받기 잠김, 확인 뒤 내려받은 파일·클립보드 원문이 승인 원문과 같음, 내보내기 2회 | real Chromium·로컬 D1 / mocked 인증 |
| 가맹 모집 유입·비용 탭(#188 R5c, `franchise-recruit.spec.ts`) | 모집 코드 발급 → 사용 중지(`중지 오늘`), 모집 비용 기록 → 무효화(입력 오류), 새 행사에 유효 비용 연결(선택지는 유효 비용 1건, `event_save` spendRef 저장), 가상 2행 리드 CSV 검사 → 미리보기(만들 리드 2건, 연락처 원문 없음) → 확정 대화 → 가져오기 기록·보드 2건 | real Chromium·로컬 D1(테스트 전용 암호화 키) / mocked 인증. 직원 화면은 이메일 인증 설정에서 본다 |
| 가맹 모집 성과 탭(R6c, `franchise-recruit.spec.ts`) | 가상 리드 6건·비용 1건으로 '보고 읽는 법' 문구(귀속≠증분·모델 호출 0)와 면책이 첫 숫자보다 먼저, 유입 전체 6, CPL '표본 부족(n<20)'과 `1,234,567원`, 진행 중인 주는 확정 버튼 없음, 지난주를 골라 확정(`report_freeze` 200, 확정 판 1)과 Markdown 내려받기(파일 이름), 리드 상세의 증빙 묶음 내려받기(`evidence_export` 200, 연락처 원문 없음, JSON 파일) | real Chromium·로컬 D1 / mocked 인증 |
| 가맹 리드 적격 판정(대표 결정 35, `franchise-recruit.spec.ts`) | 적격 기준 v1·가상 리드 2건으로 리드 상세 '적격 판정 기록' 양식(자유 문구 칸 없음)에서 적격·적격 기준 충족 기록(`qualify_lead` 200, 요청에 판정·사유 코드·기준 버전 1), 보류·답변 대기로 바꾼 뒤 이력 2줄(최근 것 먼저), 보드 '적격 판정' 필터 보류(`qualification=hold`)에 그 리드 1건과 판정 열 '보류', 성과 탭 '코호트 적격 판정' 표의 적격 리드당 비용 칸과 이번 달 '5건 미만' | real Chromium·로컬 D1 / mocked 인증 |
| 가맹 공공 벤치마크 탭(R7a, `franchise-recruit.spec.ts`) | 키가 없을 때 API 적재 409, 벤치마크 탭에 '타 브랜드 공개 수치. 자사 예상매출 근거가 아님' 고정 문구와 '외부 호출 0' 막힘 안내, 적재 버튼 잠김. 테스트 전용 가상 키 저장(`benchmark_key_save` 200) 뒤 '저장됨'과 적재 버튼 열림(누르지 않음), 화면에 키 값 없음. 키 지우기 확인 대화(`benchmark_key_clear` 200) 뒤 다시 잠김. 공공데이터포털은 호출하지 않는다 | real Chromium·로컬 D1 / mocked 인증. 외부 호출 0 |
| 가맹 모집 카드 묶음(R15b-2, `franchise-recruit.spec.ts`) | 유형 '모집 카드 묶음(PNG)' 안내 문구·템플릿(카드 4장, `QR https://`), 카드 4장 원문 저장 v1(게이트 막는 사유 없음), 승인(API), 대기기간 확인 전 PNG 버튼 잠김, 확인 뒤 'PNG 내려받기(1080×1350 피드)' 4장(파일 이름 `<자료>-v1-feed-N.png`, PNG 서명·IHDR 1080×1350)과 스토리 4장(1080×1920), 내보내기 2회, 브라우저 `BarcodeDetector`로 4장 QR을 읽은 링크 = 원문 링크, 발급하지 않은 코드 카드 묶음 승인 400 `card_qr_invalid` | real Chromium·로컬 D1 / mocked 인증 |
| 가맹 너처링(R9a-2, `franchise-recruit.spec.ts`) | '너처링' 탭 첫 줄 '앱은 메시지를 보내지 않습니다', HERMES 연결이 없을 때 'AI 초안 만들기' 409 안내, 정보성(이메일·제목)·광고성(문자, `(광고) {브랜드}`·무료 수신거부 줄) 템플릿 저장과 목록 2건, 리드 상세 정보 요청 기록(`add_info_request` 200) → 보낸 템플릿·요청 선택 뒤 기록(`log_lead_message` 200, 매체 email·판 1) → 발송 기록 1건, 답한 요청은 다시 고를 수 없음, 광고성 템플릿 선택지 막힘(R9b 전), 앱 밖 요청 0건 | real Chromium·로컬 D1 / mocked 인증. 실제 HERMES 초안은 not_run |
| 가맹 인터뷰 영상 완성본(R15b-3, `franchise-recruit.spec.ts`) | 승인된 '인터뷰 영상 대본(15초)·완성본' 판에서 파일을 고르고 라벨을 적어 '해시 기록'(`asset_media` 200). 요청 본문 키는 해시·크기·촬영일·라벨·id뿐이고(파일 없음), 해시가 파일 SHA-256과 같음. 목록 1건과 해시 앞 16자 표시 | real Chromium·로컬 D1 / mocked 인증 |
| 확인 사실 → PNG 제작 → 새로고침 뒤 내려받기 | 확인 사실 등록, `save_creative` 200, `/api/execution/asset` 200과 1080×1080 PNG, 새로고침 뒤 내려받기 링크 유지, 발행 이력 없음 | real Chromium Canvas·로컬 D1/R2 / mocked 인증. 외부 게시 없음 |
| 이메일 로그인·초대·세션 유지·권한 제한·폐기(별도 설정) | 관리자 초기 등록, 쿠키 속성, 새로고침 유지, 초대·멤버403, 직원 화면의 캠페인 삭제·채널 연결 버튼 미표시(관리자 화면의 캠페인 목록에는 더 보기 메뉴 표시), 가맹 모집 유입·비용 탭의 직원 화면에 모집 비용·리드 파일 가져오기·가져오기 기록 미표시와 `GET /api/franchise?view=spend·imports` 403(관리자 화면에는 표시), 위조 GPT 헤더401, 재사용401, 재설정·해제 뒤 세션401 | real HTTPS Chromium·로컬 workerd/D1·native scrypt. 실제 메일·운영 서버 호출 없음 |

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
