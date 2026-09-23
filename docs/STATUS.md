# COLLECTIVE 현재 상태

마지막 갱신: 2026-09-23 21:24 UTC (Claude 레인 B 세션, PR 4a)

## 현재 운영 상태

| 항목 | 값 | 근거 |
|---|---|---|
| 운영 제품 커밋 | `a64aeefa669afe362f18fff87d2a2b61686af5b5` (#29 `merged`, PR 2 #25·PR 3 #28 포함) | 제품 tree `33a87014f44362ca2696e860f58ceb9bfe67ce90` |
| `origin/main` | `310be12` (#47) | a64aeef 뒤 **미게시 제품 변경 있음**: #27 F1a·A2, #30 B4 1부, #32 F4a, #33 PR 6 서버 측, #35 F1b-1, #37 PR 5a, #39 F1b-2 서버 평가, #40 PR 5b, #41 동결 요약 표시, #43 F2a, #44 PR 4b-1, #45 F2b, #46 A4-1, #47 PR 6 앱 측. main 기준 `runtime-verified` 아님 |
| Sites 게시 | `published` 버전 25, deployment `appgdep_6ab3f15f96c88191860af69d8b50289d`, 2026-09-23 15:3x UTC | [게시 기록](releases/2026-09-23-a64aeef.md) |
| 실행 검증 | `runtime-verified` · real, 2026-09-23 15:34 UTC 경 | 소유자 이메일 세션 `/api/version` tree `33a8701…` = a64aeef tree. 익명 401, `/media` 404·CSP 확인 |
| 인증 | `AUTH_MODE=email`, 계정 1개(소유자) | 운영 `/api/auth` 200, mode=email, role=owner |
| Sites 접근 | public(사용자 명시 승인, 접근 설정 revision2). 이번 게시에서 변경 지시 없음 | 게시 뒤 접근 설정 재확인은 not_run |
| 조사 워커 | online(lastSeen 2026-09-23 16:59 UTC, blocked 0) | 게시 뒤 감시 중 확인(real). 게시 뒤 새 AI 실행 0건이라 invalid_output 비율 판단 데이터 없음 |
| 열린 PR | #16 Android(draft, 제외), PR 4a 비용 가드(레인 B, 이 PR). A4-2 게시 단위 귀속(레인 B) 구현 중 | `gh pr list -R roybeee/Collective`, 2026-09-23 21:30 UTC |
| main CI(`310be12`) | passed · verify | GitHub Actions main 실행 |

- `AUTH_MODE` fail-closed(PR 1, `auth-2`)가 운영에 적용됐다. 운영 빌드에서 `AUTH_MODE`가 비면 모든 인증·업무 API가 503이다. Sites가 public인 동안 legacy로 되돌리지 않는다. 환경 revision 변경·복구·재게시 뒤에는 `/api/auth`가 mode=email인지, 위조 헤더 요청이 401인지 먼저 확인한다. 복구는 [이메일 로그인 복구 순서](EMAIL-AUTH.ko.md)를 따른다.
- 확인 필요: 익명 업무 API 401은 a64aeef 게시 뒤 확인했다(passed · real). 위조 헤더 요청 401은 not_run이다(자동 모드 안전 검사 정책). 소유자가 직접 확인한다. 민감 작업 재인증(step-up)은 아직 구현되지 않았다(PR #23 남은 위험).
- 확인 필요: bootstrap 환경 세 항목 제거와 재게시 기록이 없다. 실제 Buffer/Instagram 게시는 not_run.

## 진행 중 작업: 병렬 레인

사용자 승인 "전체적으로 개선하라"(2026-09-23)와 대표 결정 1(병렬 레인)·4(묶음 게시). 범위·배정은 [전체 개선 계획](IMPROVEMENT-PLAN.ko.md)과 성장 계획 문서(PR #26 병합 후 `docs/GROWTH-PLAN.ko.md`)를 따른다.

- PR 0 엔지니어링 기반 `merged`(#22), PR 1 보안·인증 `merged`(#23) — 묶음 1로 게시, `runtime-verified`.
- PR 2 AI 품질 루프 `merged`(#25), PR 3 첫 게시 경로 `merged`(#28), 결정 17 게이트(#29) — 대표 승인으로 `a64aeef` 묶음 게시, `runtime-verified`. 게시 뒤 24~72시간 중단 조건 감시 중.
- 성장 계획 `docs/GROWTH-PLAN.ko.md`(#26)가 병합됐다. 레인 배정·공유 파일 병합 순서·묶음 게시 절차는 그 문서가 정본이다.
- 레인 A(공통 기반·교정, 세션 roybee-9a): F1a·A2 순수 함수 `merged`(#27), F4a kind 레지스트리·결정 7 삭제 정책 `merged`(#32), F1b-1 역할 지시 순수 함수 연결 `merged`(#35, 스냅샷 `tests/fixtures/role-submission-fc8eb5c.json`), F1b-2 서버 평가 실행 `merged`(#39, `/api/eval` 소유자 전용, 평가 작업 소유자당 1개). F2a 실행 신원·기능 스위치 `merged`(#43: `lib/feature-flags.ts` 기본 꺼짐 — online_grading·b1_reason_required·a4_auto_attribution·a2_downgrade, 소유자만 변경 / 사용량 원장 조인 키 / 보고 모델 변경 경보 / 사용량 내보내기). F2b 게이트웨이 스냅샷·온라인 채점 `merged`(#45: 워커 tick에서 소유자당 하루 1회 스냅샷, `online_grading` 스위치가 켜질 때만 저장 뒤 채점). 다음은 B1 검토 결정 로그(대표 결정 8 대기) → F3. HERMES 평가 전용 프로필(메모리 off)은 대표 승인으로 서버에 생성됨(운영 게이트웨이 무변경).
- 레인 B(실측·비용, 이 세션): B4 1부 바이럴 판정 통계 `merged`(#30). A4 점포 실측·PR 4a 비용 가드·PR 6 앱 측은 F2(기능 스위치·`lib/hermes.ts`·`lib/research-worker.ts` 순서) 뒤. 그 사이 PR 5 중 공유 파일에 걸리지 않는 부분을 진행한다: PR 5a 내비게이션·로딩 상태·대시보드 숫자 `merged`(#37), PR 5b 삭제 대화상자(결정 7·건수 API)·보존 규칙 표시·E2E route.fetch 제거 `merged`(#40), 동결 요약 표시 `merged`(#41). PR 4b-1(loop-6 검증 채널 분리·loop-7 점포 회고 규칙 승격 미리보기·loop-9 측정 기간 롤링·arm별 초안·loop-11 만료 임박 규칙 알림·연장 조건·exec-loop-10 발행 횟수 한도) 이 PR. PR 4b-1 `merged`(#44). A4-1 점포 실측(추적 코드·POS CSV 가져오기·`a4_auto_attribution` 스위치 기반 자동 귀속·코드/팔/캠페인/출처별 집계·주 단위 완전성 검사·incrementality-lite) `merged`(#46). 발행 캡션의 추적 코드 연결은 A4-2. PR 6 앱 측(security-ops-4·7·1: 워커 토큰 만료·온라인 회전·재발급 10분 유예·거부 기록·앱 gate 확인·조사 도구 위험 등급) `merged`(#47) — 만료·회전은 `RESEARCH_WORKER_TOKEN_EXPIRY=enforce`, 앱 gate 차단은 `RESEARCH_WORKER_APP_GATE=enforce`, 위험 도구 차단은 `RESEARCH_TOOL_POLICY=block`일 때만 켜지고 기본은 기록·경고만 한다. PR 4a 비용 가드(loop-4 토큰 예산: 기본 미설정·경고만, 소유자가 월 워크스페이스·캠페인 상한을 정하면 HERMES 제출 전 409 / loop-5 별칭 단가 선언 재추정 / security-ops-11 커넥터 응답 200KB 제한·조사 처리 오류 고정 문구) 이 PR. 다음은 A4-2 게시 단위 귀속(구현 중), A7·F4b는 레인 A의 B1 뒤. PR 4a 비용 가드는 A4 다음, `lib/role-execution.ts`는 F3 뒤라 HERMES 제출 지점(`lib/hermes.ts`)에서만 다룬다.
- PR 6 서버 측 `merged`(#33): 조사 서버 브라우저 격리(CDP 연결 구조로 변경)·설치기 권한 축소·워커 백오프. 앱 측 PR에서 설치기 워커 유닛에 `ReadWritePaths=/etc/collective-research`(설정 폴더만 쓰기 허용)를 더했다. 온라인 토큰 회전은 이 설치기로 재설치한 워커만 저장할 수 있다. **공유 서버 재설치는 대표 승인 뒤**. 실서버 검증 not_run.
- E2E 간헐 실패: 회의 테스트의 응답 폐기 경합은 수정(#34). workerd 크래시는 원인 미확정(blocked) — 다음 발생 때 `[serve]` 로그로 사유 확인.
- 새 records kind는 `lib/record-kinds.ts` 등록 필수(#32, `tests/record-kinds.test.mjs`). 역할 지시는 `lib/role-instruction.ts` 한 곳에서 만든다(#35). `lib/practice.ts`·`campaign-policy.ts`·`ai-context.ts`·`role-instruction.ts`를 바꾸면 `scripts/eval/capture-role-submission.mjs`로 스냅샷 재캡처.
- E2E 규칙: 테스트 route 처리기에서 `route.fetch()`는 부하 중 응답이 멈출 수 있어(화면 폴링이 끝나지 않은 reload에 막힘) 미리 받은 응답을 `route.fulfill`로 돌려준다(#37, PR 5b에서 기존 스펙 정리).
- 결정 17(AI 생성물 표시) 미결: AI 카피 캡션은 `AI_COPY_CAPTIONS=enabled`가 아니면 꺼져 있다(#29).
- `docs/STATUS.md`·`prompt_plan.md`는 여러 레인이 함께 쓰므로 병합 순서대로 rebase해 갱신한다.

## 이력

아래는 각 시점의 기록이다. "운영 미적용", "Sites 접근은 변경하지 않았다", "runtime-verified는 blocked", "제품 소스 a67a318"처럼 현재형으로 적힌 서술은 모두 그 시점의 상태다. 현재 상태는 위 "현재 운영 상태" 표를 따른다.

### 2026-09-23 12:48 UTC 기록 — 보안·인증 게시 (d156dfd)

- PR 0(#22)의 미게시 제품 변경과 PR 1(#23)을 함께 게시했다. 운영 `/api/version` tree가 `6a1881b…`로 d156dfd tree와 같아 `runtime-verified` · real.
- 게시는 대표가 Sites 편집기에서 직접 실행했다. Sites 버전·deployment ID·migration 0003 적용 결과는 기록 없음. [게시 기록](releases/2026-09-23-d156dfd.md).
- PR #19는 이미 `CLOSED`다(이전 STATUS의 "닫을 예정"은 해소).

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
