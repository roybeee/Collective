# COLLECTIVE 현재 상태

마지막 갱신: 2026-09-23 09:34 UTC (Claude, PR 0 `chore/engineering-baseline`)

## 현재 운영 상태

| 항목 | 값 | 근거 |
|---|---|---|
| 운영 제품 커밋 | `dbf94a5138df0ea0765919abaa4fa955511d49a2` (PR #20 `merged`) | 제품 tree `281ea84a47227a5eec82c0b2b7c0cde6c5889c90` |
| `origin/main` | `3f68f21` (PR #21, PR 0 병합 전 기준). dbf94a5 뒤의 변경은 문서 전용 | `git diff --name-only dbf94a5 3f68f21 -- . ':!docs' ':!*.md'` 결과 없음 |
| Sites 게시 | 버전23 `published`, deployment `appgdep_6ab383ddc9408191a9cb0e12916d5cd5`, 2026-09-23 07:46:46 UTC | [게시 기록](releases/2026-09-23-dbf94a5.md) |
| 실행 검증 | `runtime-verified` · real (main `3f68f21` 기준, PR 0 병합 전), 2026-09-23 07:58 UTC 경 | 관리자 이메일 세션으로 연 운영 `/api/version` = build `2026-09-23T07:22:55.964Z`, tree `281ea84…`(dbf94a5 tree와 같음) |
| 인증 | `AUTH_MODE=email`, 계정 1개(관리자) | 운영 `/api/auth` mode=email. [전환 기록](releases/2026-09-23-1ecd72e.md) |
| Sites 접근 | public(사용자 명시 승인, 접근 설정 revision2). 로그인 없는 업무·계정 요청은 앱이 401 | [전환 기록](releases/2026-09-23-1ecd72e.md) |
| 조사 워커 | online | 운영 관찰, 2026-09-23 07:58 UTC 경 |
| 열린 PR | #19 문서(`docs/email-auth-release`, `main`에 병합 안 됨, 충돌. 내용은 PR 0에서 다시 반영), #16 Android(ChatGPT 인증 시절 기준, 개선 계획에서 제외), PR 0(이 변경) | 감사 시점 기록. 작업 전 `gh pr list -R roybeee/Collective`로 대조 |
| 로컬 게이트(main `3f68f21`) | tests passed 27/27 suites·849 assertions, tsc passed exit0, lint gate passed errors107/기준108·warnings44/기준44 | 테스트 real SQLite / mocked 외부 공급자. lint 0 errors가 아님 |
| PR 0 브랜치 게이트(`chore/engineering-baseline`, 2026-09-23 09:34 UTC 경) | tests passed 29/29 suites·946 assertions, tsc passed exit0, lint gate passed errors74/기준74·warnings44/기준44, build passed exit0, 워커 계약 테스트 passed 50회 반복 0회 실패 | 테스트 real SQLite / mocked 외부 공급자, 워커 mocked gateway / real 로컬 HTTP. E2E는 not_run(CI 비차단 잡에서 실행). 병합 전 브랜치 값이며 병합 뒤 main CI로 다시 확인 |

- PR 0 병합 시점부터 `main` 기준 배포 상태는 `published`(운영 dbf94a5, Sites 버전23)이며 `runtime-verified`가 아니다. 게시하지 않은 제품 변경(`lib/deep-research-server.ts`, `lib/store-server.ts`, `lib/validate.ts`, `app/workspace.tsx`)이 `main`에 들어가기 때문이다. 게시 전까지 운영 기준은 dbf94a5다. 게시는 별도 승인 후 [게시 체크리스트](PUBLISH.ko.md)로 진행하고 5단계로 다시 판정한다.
- Sites가 public인 동안 `AUTH_MODE`를 legacy로 되돌리지 않는다. `AUTH_MODE`를 비워 두어도 legacy다(`lib/auth-session.ts` `authMode`). 환경 revision 변경·복구·재게시 뒤에는 `/api/auth`가 mode=email을 반환하는지, 위조 헤더 요청이 401인지 먼저 확인한다. 코드 기본값을 fail-closed로 바꾸는 일은 PR 1(`auth-2`)에서 한다. 복구는 [이메일 로그인 복구 순서](EMAIL-AUTH.ko.md)를 따른다.
- 권장 임시 조치: PR 1 게시 전까지 관리자·직원 계정을 추가로 초대하지 않는다(계정 1개 유지). 역할별 권한 경계와 설치 파일 권한 판정 단위를 PR 1에서 개인 단위로 보완하기 전이기 때문이다.
- 확인 필요: bootstrap 환경 세 항목 제거와 재게시는 기록이 없다(버전23 게시 기록은 환경 revision4 유지). 실제 Buffer/Instagram 게시는 not_run.
- 후속 조치: PR 0 병합 뒤 사용자 승인을 받아 PR #19를 닫는다(내용은 [게시 기록](releases/2026-09-23-1ecd72e.md)과 아래 이력으로 옮겼다). 외부 호출이라 이 PR에서는 기록만 한다.

## 진행 중 작업: 전체 개선 7개 PR

사용자 승인 "전체적으로 개선하라"(2026-09-23). 범위·순서·finding 배정은 [전체 개선 계획](IMPROVEMENT-PLAN.ko.md)에 있다.

- PR 0 엔지니어링 기반 — 진행 중(`chore/engineering-baseline`). 제품 동작 변경 없음.
- PR 1 보안·인증 → PR 2 AI 품질 루프 → PR 3 첫 게시 경로 → PR 4 측정·비용 → PR 5 화면·UX → PR 6 조사 서버 보안 — 대기.
- 각 PR의 운영 게시는 병합 뒤 별도 승인을 받는다.

## 이력

아래는 각 시점의 기록이다. "운영 미적용", "Sites 접근은 변경하지 않았다", "runtime-verified는 blocked", "제품 소스 a67a318"처럼 현재형으로 적힌 서술은 모두 그 시점의 상태다. 현재 상태는 위 "현재 운영 상태" 표를 따른다.

### 2026-09-23 07:48 UTC 기록 — 실행 연결 첫 단계 배포 (dbf94a5, Sites 버전23)

- 이 절의 runtime-verified blocked는 2026-09-23 07:58 UTC 경 관리자 이메일 세션 확인으로 해소됐다(위 표).
- 제품 `dbf94a5138df0ea0765919abaa4fa955511d49a2` / PR #20 merged.
- Sites 버전23 published: `appgdep_6ab383ddc9408191a9cb0e12916d5cd5`, succeeded, 2026-09-23 07:46:46 UTC. 기존 public 접근과 환경 revision4를 유지했다.
- 제품/Sites 투영 tree `281ea84a47227a5eec82c0b2b7c0cde6c5889c90` 일치. runtime-verified는 blocked: 운영 브라우저에 이메일 로그인 세션이 없어 `/api/version`의 인증 후 값을 확인하지 못했다. 실제 새 로그인 화면까지 확인했으며 내부 기능 정상 작동으로 확대 해석하지 않는다.
- 전체27/27 suites·849 assertions, TypeScript, lint gate, build, 기본 E2E12와 이메일 E2E1 passed. main CI `35831544401`도 재실행 후 verify/e2e-smoke 모두 passed. 최초 이메일 검사 실패는 Miniflare `Network connection lost` HTTP500으로 확인했고 제품 코드는 바꾸지 않았다.
- 실제 Buffer/Instagram 게시 not_run(계정·공개 이미지 호스트 미연결). [배포 근거](releases/2026-09-23-dbf94a5.md).
- 아래 이전 배포 기록은 당시 근거로 보존한다. 후속 문서 전용 커밋은 별도 게시하지 않는다.

### 브랜드 사실·제작·발행·주문 연결 — 개발 검증 (PR #20 병합 전 기록)

- 기준 main `1ecd72e`의 이메일 로그인 변경을 보존해 통합했다. [기능·운영 경계](EXECUTION-LOOP.ko.md), [승인 범위](EXECUTION-LOOP-PLAN.ko.md).
- 사실 버전/출처/유효기한, 실제 PNG 제작·저장, 계정·소재·예정 비용 승인, Buffer Instagram 어댑터, 주문의 캠페인·소재 귀속을 구현했다.
- 새 통합 회귀: 실행49, 이메일 권한10, 사실31, 주문귀속22 passed. real SQLite / mocked Buffer·HTTP·R2.
- 브라우저: 기본 Playwright12 passed(real Chromium Canvas·로컬 D1/R2, mocked 로그인 헤더), 이메일 인증1 passed(real 로컬 쿠키 세션).
- TypeScript passed; lint gate passed(107 errors/108 기준선, 44 warnings/44 기준선). 기존 lint 오류를 0으로 보고하지 않는다.
- 코드·보안 리뷰의 게시 결과 유실, 예약 캠페인 삭제, 잘못된 PNG, 승인 계정 경합, 업로드/요청 한도 문제를 보완했다. 수정 한도에서도 사실 확인 철회가 가능하다.
- 실제 Buffer 계정 검증·외부 호스팅·SNS 게시: not_run(연결 계정·호스트 미제공). 실제 광고비/모델 비용의 하드캡, 자동 CRM, GEO 모니터링은 후속 범위다. 커버리지 비율: not_run.
- 소스 병합/게시/runtime-verified는 이 구현 테스트 결과와 별도로 후속 배포 기록에 남긴다.

### 2026-09-23 07:09 UTC 기록 — 이메일 로그인 게시와 공개 전환 (PR #18, 1ecd72e)

PR #19(`docs/email-auth-release`, 커밋 aa06574·b242019)가 기록했으나 `main`에 병합되지 않은 내용을 옮겼다. 당시 "관리자 초기 설정 대기"였고, 이후 관리자 계정 설정과 runtime-verified는 위 표에 있다.

- PR #18 merged: `1ecd72e94101e5e3d3a098eb1e86804d70f9d03c`. Sites published: `appgdep_6ab378faf33c81919101aff6ff1aef8a`, 환경 revision4. 사용자 지정 이메일을 초기 관리자 secret으로 설정하고 기존 owner에 연결했다. 비밀번호·초기 토큰 원문은 저장소에 저장하지 않았다.
- 실제 운영 검사 passed: `/api/auth` 200(mode=email/user=null), 익명·위조 GPT 헤더 업무 조회401, native scrypt를 실행하는 미등록 계정 로그인401. 운영 자료 조회와 `/api/version` tree 검증은 관리자 비밀번호 설정 전이므로 not_run; 전체 runtime-verified는 아직 아니었다.
- 사용자 명시 승인으로 Sites 접근을 public(revision2)으로 전환했다. 무자격 GET `/`200(GPT 게이트/리다이렉트 없음), `/api/auth`200(email/null), 업무 API 익명·위조헤더401, 계정 API401 확인. 초기 등록 링크는 사용자에게 전달했으며 본인이 비밀번호를 설정한 뒤 bootstrap 환경 제거와 운영 자료/tree 확인을 이어가기로 했다.
- CI: verify 모두 passed. 동일 최종 소스 push 실행35829036803은 기존10+이메일1 브라우저 passed. PR 실행35829042093은 테스트 서버 종료 뒤 연결 거부로 failed(원인 미확정). 공개/운영 인증 성공과 이 비차단 검사 실패를 혼동하지 않는다.
- [게시 기록](releases/2026-09-23-1ecd72e.md), [운영 설정·전환·복구 및 검증 근거](EMAIL-AUTH.ko.md).

### 2026-09-23 06:34 UTC 기록 — 이메일 로그인 구현 및 로컬 검증 (당시 운영 미적용)

- 사용자가 이메일+비밀번호 및 관리자 초대 방식을 승인했다. 기준 `d96a6cae30076dd429ccaae21074216d33075264`, 별도 `feat/email-auth` 브랜치.
- 기존 owner 연결 보존, 초대·재설정 일회 링크, 30일 세션, 관리자 권한 제한을 구현했다. GPT 헤더는 이메일 모드에서 인증에 사용하지 않는다.
- tests passed 23/23 suites, runner 집계737 assertions와 별도 node:test 인증20개. SQLite/native crypto real, Cloudflare 환경 adapter/모델응답 mocked.
- build/typecheck passed. 기존 브라우저10/10 및 이메일 브라우저1/1 passed. 이메일 여정은 real HTTPS Chromium/local workerd/D1/native scrypt로 실행했다.
- lint 기준선 gate passed, errors106/108·warnings44/44(0 errors 의미 아님). 독립 코드·DB·보안 검토 CRITICAL/HIGH 0, pending 초대 재발급 UI와 요청한도 소진 시 로그아웃 차단 지적 수정. 만료 인증 레코드 정리는 후속 운영 과제로 기록했다. 운영 게시·운영 CPU 한도·실제 Android 이메일 로그인은 not_run.
- 남은 입력: 최초 관리자 이메일. 사이트 진입 화면 공개 전환은 사용자 명시 승인 후 진행하며 자체 업무 API 보호를 먼저 검증한다. 운영 데이터와 Sites 접근은 변경하지 않았다.
- [운영 설정·전환·복구 및 검증 근거](EMAIL-AUTH.ko.md).

### 소스와 배포 — a67a318, Sites 버전21 (당시 기록)

- 제품 소스: `a67a318abd024880389f5dde5e8923bc2ca60657` (PR #15 merged, main CI passed).
- Sites 버전 21 published, 환경 revision 3 유지. 배포 `appgdep_6ab36c7589b881919fb9302d31532b86` succeeded.
- runtime-verified: 로그인한 운영 브라우저의 `/api/version`가 tree `b57380bb9ade2e2aea7a1ee5fc8fcff92ace6b7f`를 반환해 제품 소스와 일치했다.
- 이 상태 기록의 후속 문서 커밋은 별도 게시하지 않는다. 운영 기준은 위 제품 커밋이며 문서 전용 main 후속 커밋과 구분한다. [게시 증거](releases/2026-09-23-a67a318.md).

### ODA 실사용 후속 보완 — 운영 적용 (a67a318 당시)

사용자가 실제 ODA 오류 분석 뒤 구현을 승인했다. 역할별 결과 계약·재작성/후속 무효화, 회의 실패 단계 재작성, 서버 단일 진행, 업종·측정 규칙, 사용량 진단을 보완해 PR #15로 병합·게시했다. [상세](ODA-EXECUTION-FIXES.ko.md).

- 테스트: passed, 21/21 suites (real SQLite/핸들러, mocked 모델 공급자).
- Playwright: passed, 10/10 (real Chromium/로컬 D1, mocked 인증; 새 회의 검사는 응답/작업자 상태도 mocked).
- TypeScript 및 build: passed, exit 0. lint gate: passed, errors106/기준108, warnings44/기준44.
- 코드 검토의 후속 작업물 무효화와 재작성 UI 지적을 수정했다.
- 커버리지 비율: not_run. 구조 검증을 사실 정확성 검증으로 해석하지 않는다.
- 운영 화면에서 기존 Insight 재질문을 보완 필요로 차단하고 재작성 버튼을 제공하는 것을 확인했다. 실제 재작성 1건도 성공했다(23,216 tokens, 비용 미확인). 근거 구분과 30일 성숙 코호트 정의를 원문에서 확인했으며, 전체 캠페인 완료를 의미하지 않는다. [게시 기록](releases/2026-09-23-a67a318.md).

### 이전 버전 20의 보완

1. 역할·바이럴 접수의 원자 저장, 멱등 복구, 활성 실행 전체 조회.
2. 실패·취소·형식 오류를 포함한 사용량 원장, 수동 가격 버전과 nullable 비용, 설정 UI.
3. machine worker의 역할·회의·바이럴·초안 진행, 캠페인 연속 실행 동의/중단, 조사·측정 공정 순환.
4. 캠페인 상세 및 이전 원문 비교, 출처·기간·범위와 미확인 비용 보존, stale 수정 거부.
5. 요청/외부 응답 스트림 제한, 설치 파일 관리자 제한, 읽기 전용 운영 인증 probe.

상세와 적용 조건: [실행·사용량·작업물 보완](RELIABILITY.ko.md), [보안 경계](SECURITY-BOUNDARIES.ko.md).

### 이전 버전 20의 검증 기록

| 검사 | 상태 | 근거 |
|---|---|---|
| `node scripts/test.mjs` | passed · 16/16 suites, 646 assertions | real SQLite·핸들러 / mocked 외부 공급자 |
| `node node_modules/typescript/bin/tsc --noEmit` | passed · exit 0 | real 정적 검사 |
| `node scripts/lint-gate.mjs` | passed · errors 106/108, warnings 42/44 | real 정적 검사, lint zero가 아님 |
| `node scripts/run-framework.mjs build` | passed · exit 0 | real 로컬 빌드 |
| `node node_modules/@playwright/test/cli.js test` | passed · 8/8, 18.0초 | real Chromium·로컬 D1 / mocked 인증 헤더 |
| `python3 tests/research_worker_test.py` | passed · 4/4 | mocked gateway / real 로컬 HTTP |
| 운영 익명·위조·중복 인증 헤더 GET | passed · 각 HTTP 401 | real, 기존 운영 사이트 읽기 요청 3건 |
| 원본 Worker 직접 접근·로그인 사용자 간 운영 격리 | not_run | 직접 origin 및 두 사용자 세션 미제공 |
| Sites 게시 및 runtime tree | passed · real | 버전 20, 제품 tree 일치 |
| 운영 워커·설치 관리자 | passed · real | registered/activated/online/canInstall true, systemd active/running |
| 새 유료 모델·커넥터 호출 | not_run | 게시 검증은 읽기 전용, 실호출 비용 미발생 |

복구·공정 큐·terminal 오류·원장 후속 실패·기존 성과 버전 전환은 회귀 실패를 먼저 확인한 뒤 수정했다. 코드·보안 교차 리뷰에서 발견한 HIGH/MEDIUM은 보완했다. 커버리지 백분율은 측정하지 않았다.

### 운영 적용과 남은 경계 (버전20 게시 당시)

- `RESEARCH_WORKER_ADMIN_IDS`에 기존 운영 워커의 실제 소유자 ID를 secret으로 설정하고 게시했다. 로그인 사용자 canInstall=true를 확인했다.
- 기존 worker tick 자격증명은 유지했다. 게시 이후 heartbeat 및 systemd active/running, queue idle을 확인했다. 기존 Python 프로토콜과 호환하므로 재설치·재발급·재시작하지 않았다.
- 새 사용량 UI와 기존 워크스페이스 데이터 조회를 운영 브라우저에서 확인했다. 단가는 미등록이며 임의 가격을 넣지 않았다.
- gateway의 도구 강제 읽기 전용 권한·직접 origin·실사용자 간 격리는 추가 운영 검증 대상이다. 설치 파일의 공통 gate는 여전히 신뢰된 관리자에게 제공된다.
- workspace 전체 본문 전송은 호환을 위해 유지한다. 페이지네이션 최적화와 고객별 협업 권한은 이번 변경에 포함하지 않았다.

### 과거 실제 실행

[2026-09-23 관측 기록](observations/2026-09-23-live-run.md)에 실제 8역할·회의·브랜드 조사 및 바이럴 조사 결과가 있다. 모의 테스트 통과와 과거 실호출은 별개의 근거다. 해당 문서의 총 18건 표에는 실패 1건이 포함되므로 모두 완료한 18건으로 해석하지 않는다. 강화된 품질 게이트 이후의 실호출 및 원문 경로 개선의 운영 게시 여부는 별도 확인한다.
