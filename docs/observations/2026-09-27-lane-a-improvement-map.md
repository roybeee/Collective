# 개선 계획 finding 매핑 (레인 A, 성장1 종료)

- 작성: 레인 A가 위임한 읽기 전용 조사 결과를 레인 A가 검토해 옮겼다. `ux-12`는 레인 A가 직접 다시 확인했다(병합 PR 본문·코드 검색 0건). 감사 원문은 싣지 않는다(ID·저장소 경로만).

- 기준: `origin/main` `11c3839` (작업 지시 시점 66c2ad4 이후 #212·#223 병합). 읽기 전용 조사, 2026-09-27.
- 판정 규칙: `present` = 병합 PR + 최신 main에 코드/테스트 경로 존재(`git cat-file -e` 전수 확인, 인용 병합 커밋 전부 origin/main 조상 확인). 문서 언급만으로는 present 처리 안 함.
- 유실 점검: 근거·관련 PR 31개(#22·23·25·28·30·32·33·37·40·41·43·44·46~50·52·53·56·58~61·63·64·65·211·212·213·220)의 변경 파일 전수 존재 확인 → 없는 파일은 `app/channel-panel.tsx` 1건(#63 F5가 미사용 파일로 의도 삭제, 기능은 app/panels.tsx로 대체) → `lost` 0건. 단 파일 단위 점검이라 파일 내부 코드 삭제(B5 #65 유형)는 ID 주석이 남은 항목만 간접 확인됨.

## 요약

| 판정 | 건수 |
|---|---|
| present | 85 |
| absorbed | 1 |
| open-pr | 3 |
| lost | 0 |
| unmapped | 1 |
| excluded | 4 |
| refuted | 1 |
| 합계 | 95 |

### present 외 항목

- `loop-2` — open-pr: #219 OPEN(발행↔실험 arm 연결, Instagram 게시물 ID 수집 등록). #30(B4 1부)은 판정 부분만 확장. origin/main 코드·테스트에 ID 없음
- `loop-10` — open-pr: 구현은 #218 OPEN(input_diet·digest·입력 상한). main의 lib/context-replay.ts(#64→#220 복원)는 설계 근거(B5)일 뿐 구현 아님
- `ai-quality-9` — open-pr: 구현은 #218 OPEN. B5 설계 근거(#64 병합→#65에서 삭제→#220 a2b8b48 복원)만 main에 있음
- `ux-12` — unmapped → **레인 A가 닫음**: 병합·열린 PR 본문, 커밋, 코드·테스트 어디에도 ID가 없었다. 계획 PR 5 범위 중 대응이 없는 '재실행 영향 설명'을 #226(다시 작성 전 영향 작업물 표시, `lib/rerun-impact.ts`·`tests/rerun-impact.test.mjs`)으로 구현했다. ID↔항목 대응은 감사 원문으로만 확정된다
- `eng-hygiene-12` — absorbed: IMPROVEMENT-PLAN 36행: ux-5와 같은 설정 기능 표 문제. #61이 "ux-5·eng-hygiene-12"로 함께 처리, 코드·테스트 주석 병기

### present지만 부분 해결·근거 약함(재확인 권장)

- 범위 표기로만 인용(ID별 주석·본문 항목 없음): `auth-11`, `ai-quality-3` `-5` `-11` `-12`, `data-truth-5`, `exec-loop-5`, `eng-hygiene-1` `-2` `-4`.
- `ai-quality-12`(추정): 계획 PR 2의 "AI 팀 실행 도구 권한 축소"는 #25에서 지시문 문장만 확인, 코드 수준 toolset 제한 근거 없음.
- 문서화된 부분 해결: `auth-1`·`auth-10`(재인증 후속), `auth-3`(Turnstile·기기 쿠키 제외) — EMAIL-AUTH.ko.md 38·40행.
- CLOSEOUT §3이 5절 인계를 요구한 제외분: `security-ops-5` ③(#213 Instagram 토큰 자동 갱신), `security-ops-6` 운영 키 회전(#211).
- `exec-loop-4` 권고 (4) Instagram media ID·인사이트: #53 범위 밖 → #219(OPEN)가 실질 대응하나 ID 미인용.

## 전체 표

| finding ID | 최종 배정(배정 변경 반영) | 근거 PR·병합 커밋 | 최신 main 존재 확인 경로 | 판정 | 비고 |
|---|---|---|---|---|---|
| `eng-hygiene-1` | PR 0 | #22 `4bb500c` | `.github/workflows/ci.yml`<br>`docs/STATUS.md` | present | #22는 PR 0 범위로 인용(ID 개별 인용 없음). ① PR #19 닫힘(2026-09-23 CLOSED) 확인 |
| `eng-hygiene-2` | PR 0 | #22 `4bb500c` | `.github/workflows/ci.yml`<br>`scripts/test.mjs`<br>`scripts/lint-gate.mjs`<br>`tests/lint-gate.test.mjs` | present | #22 PR 0 범위 인용(ID 개별 인용 없음). CI Build·Worker contract 차단 단계, 스위트 120초 timeout 존재 확인 |
| `eng-hygiene-3` | PR 0 | #22 `4bb500c` | `tests/research_worker_test.py`<br>`.github/workflows/ci.yml` | present | #22 본문에 ID 인용(워커 계약 테스트 RST 수정) |
| `eng-hygiene-4` | PR 0 | #22 `4bb500c` | `docs/PUBLISH.ko.md`<br>`scripts/lint-gate.mjs`<br>`tests/lint-gate.test.mjs` | present | #22 PR 0 범위 인용. GROWTH-PLAN F3 행이 eng-hygiene-4=runtime-verified 정의로 지칭. 문서 중심 항목이라 코드 근거는 CI 조상 점검 |
| `eng-hygiene-7` | PR 0 (③은 PR 5) | #22 `4bb500c`, #61 `a0d07d6` | `app/workspace.tsx`<br>`tests/account-ui.test.mjs`<br>`tests/deletion-summary.test.mjs`<br>`scripts/lint-baseline.json` | present | ③ CampaignTable 분리는 #61에서 ID 인용·테스트 주석 존재. ①② lint 감축은 #22 범위 인용 |
| `eng-hygiene-10` | PR 0 | #22 `4bb500c` | `.github/workflows/ci.yml` | present | ci.yml 28행 주석이 ID 인용(비차단 STATUS 조상 점검), 4bb500c에서 추가 |
| `auth-1` | PR 1 | #23 `d156dfd` | `lib/auth-accounts.ts`<br>`tests/email-auth.test.mjs`<br>`tests/security-boundaries.test.mjs` | present | #23 ID 인용(소유자 판정). EMAIL-AUTH가 부분 해결 명시: 권고 3 민감 작업 재인증 미구현(후속) |
| `auth-2` | PR 1 | #23 `d156dfd` | `lib/auth-request.ts`<br>`tests/auth-boundary.test.mjs` | present | #23 ID 인용(AUTH_MODE fail-closed). STATUS 155행 운영 적용 기록 |
| `auth-3` | PR 1 | #23 `d156dfd` | `lib/auth-credentials.ts`<br>`lib/auth-request.ts`<br>`tests/email-auth.test.mjs` | present | #23 ID 인용(로그인 제한·IPv6 /64). EMAIL-AUTH 38·40행 부분 해결(Turnstile·기기 쿠키 제외) |
| `auth-4` | PR 1 | #23 `d156dfd` | `app/api/research-worker/setup/route.ts`<br>`tests/security-boundaries.test.mjs` | present | #23 ID 인용(설치 파일 개인 단위 판정) |
| `auth-5` | PR 1 | #23 `d156dfd` | `lib/server.ts`<br>`tests/execution-auth.test.mjs`<br>`tests/auth-boundary.test.mjs` | present | #23 ID 인용(직원 권한). 참고: #23이 수정한 app/channel-panel.tsx는 #63(e4c5cc4)이 미사용 파일로 삭제 — 기능 대체(app/panels.tsx), 유실 아님 |
| `auth-6` | PR 1 | #23 `d156dfd` | `lib/server.ts`<br>`tests/auth-boundary.test.mjs`<br>`tests/security-boundaries.test.mjs` | present | #23 ID 인용(행위자 기록) |
| `auth-7` | PR 1 | #23 `d156dfd` | `lib/server.ts`<br>`tests/execution-auth.test.mjs` | present | #23 ID 인용(직원 화면 안내·관리자 전용 조치) |
| `auth-8` | PR 1 | #23 `d156dfd` | `tests/security-boundaries.test.mjs`<br>`server/research-worker/README.md` | present | #23 ID 인용(민감 정보 제거·재발 방지 테스트). 과거 git 이력 노출은 운영 확인 항목 |
| `auth-9` | PR 1 | #23 `d156dfd` | `lib/auth-accounts.ts`<br>`lib/auth-session.ts`<br>`tests/email-auth.test.mjs` | present | #23 ID 인용(auth-9/10 계정 수명주기) |
| `auth-10` | PR 1 | #23 `d156dfd` | `lib/auth-accounts.ts`<br>`lib/auth-session.ts`<br>`tests/email-auth.test.mjs` | present | #23 "auth-9/10" 표기로 인용. EMAIL-AUTH 40행 부분 해결(권고 3 최근 로그인 확인 후속) |
| `auth-11` | PR 1 | #23 `d156dfd` | `lib/auth-session.ts`<br>`tests/email-auth.test.mjs` | present | #23 목적의 "auth-1~12" 범위 인용뿐, 본문 항목에 개별 인용 없음 — 근거 약함(확인 권장) |
| `auth-12` | PR 1 | #23 `d156dfd` | `drizzle/0003_noisy_bruce_banner.sql`<br>`tests/email-auth.test.mjs` | present | #23 ID 인용(만료 세션·토큰 정리, migration 0003) |
| `security-ops-8` | PR 1 | #23 `d156dfd` | `lib/research-worker.ts`<br>`tests/security-boundaries.test.mjs` | present | #23 ID 인용(작업자 설치/해제 행위자 기록) |
| `security-ops-9` | PR 1 | #23 `d156dfd` | `tests/security-boundaries.test.mjs` | present | #23 ID 인용(직원 응답에서 HERMES 주소 제외) |
| `eng-hygiene-6` | PR 1 | #23 `d156dfd` | `tests/security-boundaries.test.mjs` | present | #23 ID 인용(추적 파일 민감 정보 제거 재발 방지) |
| `ai-quality-1` | PR 2 | #25 `c524777` | `lib/role-execution.ts`<br>`tests/role-output-integration.test.mjs` | present | 테스트 61행 ID 주석. B1(#51)이 버전별 이력으로 확장 |
| `ai-quality-2` | PR 2 | #25 `c524777` | `lib/role-execution.ts`<br>`lib/campaign-directives.ts`<br>`tests/directives.test.mjs` | present | #25 범위 인용(ai-quality-1~12), lib/role-execution.ts 94행 ID 주석 |
| `ai-quality-3` | PR 2 | #25 `c524777` | `lib/ai-context.ts`<br>`tests/ai-context.test.mjs`<br>`tests/role-output-integration.test.mjs` | present | #25 범위 인용뿐(ID 주석 없음) — 미확인 브랜드 소개 표시로 추정 매핑 |
| `ai-quality-4` | PR 2 | #25 `c524777` | `lib/role-output.ts`<br>`tests/role-output-integration.test.mjs`<br>`tests/usage-summary.test.mjs` | present | 테스트 110행 ID 주석 |
| `ai-quality-5` | PR 2 | #25 `c524777` | `lib/meetings.ts`<br>`tests/meeting-contract.test.mjs`<br>`tests/meetings.test.mjs` | present | #25 범위 인용뿐(ID 주석 없음) — 회의 발언 참조 정규화로 추정 매핑 |
| `ai-quality-6` | PR 2 | #25 `c524777`, #52 `5ad24fc` | `lib/quality.ts`<br>`tests/role-output-integration.test.mjs`<br>`tests/a2-runtime.test.mjs` | present | 테스트 120행 ID 주석, #52 A2 런타임이 뒤에 연결 |
| `ai-quality-7` | PR 2 | #25 `c524777` | `tests/role-output-integration.test.mjs` | present | 테스트 120행 "ai-quality-6, 7, 10" 주석 |
| `ai-quality-8` | PR 2 | #25 `c524777` | `lib/brief.ts`<br>`tests/brief-workflow.mjs` | present | tests/brief-workflow.mjs 78행 ID 주석(브리프 사실 후보 출처 검증) |
| `ai-quality-10` | PR 2 | #25 `c524777` | `lib/role-output.ts`<br>`tests/role-output-integration.test.mjs` | present | 테스트 120행 주석, GROWTH-PLAN F1이 ID 패턴 재사용 명시 |
| `ai-quality-11` | PR 2 | #25 `c524777` | `lib/ai-context.ts`<br>`tests/ai-context.test.mjs` | present | #25 범위 인용뿐(ID 주석 없음) — 근거 약함(확인 권장) |
| `ai-quality-12` | PR 2 | #25 `c524777` | `lib/meeting-execution.ts`<br>`tests/meetings.test.mjs` | present | #25 범위 인용뿐(ID 주석 없음) — 근거 약함. 계획의 "AI 팀 실행 도구 권한 축소"는 지시문 수준만 확인, 코드 수준 toolset 제한 없음 |
| `data-truth-1` | PR 2 | #25 `c524777` | `lib/campaign-policy.ts`<br>`tests/campaign-policy.test.mjs` | present | #25 ID 인용("data-truth-1/2/5/10"). GROWTH-PLAN A2가 금지 표현 사전 import 명시 |
| `data-truth-2` | PR 2 | #25 `c524777` | `tests/role-output-integration.test.mjs` | present | 테스트 141행 ID 주석(브랜드 수정 연쇄 제거) |
| `data-truth-5` | PR 2 | #25 `c524777` | `lib/ai-context.ts`<br>`tests/ai-context.test.mjs` | present | #25 "data-truth-1/2/5/10" 표기로 인용, ID 주석 없음 |
| `data-truth-10` | PR 2 | #25 `c524777`, #56 `63ce8cb` | `lib/archive-server.ts`<br>`tests/research-salvage.test.mjs` | present | #25 인용, #56(A7)이 candidate 게이트 불변 확인 |
| `exec-loop-1` | PR 3 | #28 `d8464a3` | `lib/fact-import.ts`<br>`tests/fact-import.test.mjs` | present | #28 ID 인용(exec-loop-1~3). 사실 원장 초기 입력 |
| `exec-loop-2` | PR 3 | #28 `d8464a3` | `app/media/[file]/route.ts`<br>`lib/execution.ts`<br>`tests/execution-loop.test.mjs`<br>`tests/public-media.test.mjs` | present | 코드·테스트 ID 주석(앱 자체 공개 PNG). high |
| `exec-loop-3` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`tests/execution-loop.test.mjs`<br>`tests/brand-facts.test.mjs` | present | 코드·테스트 ID 주석 |
| `exec-loop-5` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`tests/execution-loop.test.mjs` | present | #28 "5~9" 범위 인용, ID 주석 없음 |
| `exec-loop-6` | PR 3 | #28 `d8464a3` | `tests/execution-loop.test.mjs` | present | 테스트 ID 주석 |
| `exec-loop-7` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`tests/execution-loop.test.mjs` | present | 코드·테스트 ID 주석. 권고 (2) 실사진 템플릿은 EXECUTION-LOOP 106행 후속 |
| `exec-loop-8` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`tests/execution-loop.test.mjs` | present | 코드·테스트 ID 주석 |
| `exec-loop-9` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`lib/execution.ts`<br>`tests/execution-loop.test.mjs` | present | 코드·테스트 ID 주석 |
| `exec-loop-11` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`tests/execution-loop.test.mjs` | present | 코드·테스트 ID 주석 |
| `exec-loop-12` | PR 3 | #28 `d8464a3` | `lib/execution-media.ts`<br>`tests/delete-campaign.test.mjs`<br>`tests/public-media.test.mjs` | present | 코드·테스트 ID 주석. (1) 뒷부분·(2) 보관 한도 단위는 EXECUTION-LOOP 109행 후속 |
| `data-truth-3` | PR 3 | #28 `d8464a3` | `lib/data-requests.ts`<br>`tests/campaign-store-link.test.mjs` | present | 테스트 ID 주석(지점↔캠페인) |
| `data-truth-4` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`tests/campaign-store-link.test.mjs`<br>`tests/execution-loop.test.mjs` | present | 코드·테스트 ID 주석(예산 null/0) |
| `data-truth-7` | PR 3 | #28 `d8464a3` | `tests/campaign-store-link.test.mjs` | present | 테스트 ID 주석 |
| `data-truth-12` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`lib/fact-catalog.ts`<br>`tests/brand-facts.test.mjs` | present | 코드·테스트 ID 주석(표준 항목 라벨) |
| `security-ops-10` | PR 3 | #28 `d8464a3` | `lib/execution-server.ts`<br>`tests/execution-loop.test.mjs` | present | 코드·테스트 ID 주석 |
| `eng-hygiene-5` | PR 3 | #28 `d8464a3` | `tests/public-media.test.mjs` | present | 테스트 ID 주석(PNG 자산 라우트·email 모드) |
| `loop-1` | PR 4b | #63 `e4c5cc4`, #213 `877e874` | `lib/measurement-status.ts`<br>`app/measurement-collect.tsx`<br>`tests/measurement-status.test.mjs`<br>`tests/measurement-collect-ui.test.mjs` | present | #213 병합(877e874). SECURITY-BOUNDARIES 181행 |
| `loop-2` | PR 4b | — | — | open-pr | #219 OPEN(발행↔실험 arm 연결, Instagram 게시물 ID 수집 등록). #30(B4 1부)은 판정 부분만 확장. origin/main 코드·테스트에 ID 없음 |
| `loop-3` | A4(1단계) + PR 4b 잔여 | #46 `edf82f1`, #53 `900cbca` | `lib/campaign-attribution.ts`<br>`lib/spend-transfer.ts`<br>`tests/campaign-attribution.test.mjs`<br>`tests/spend-transfer.test.mjs`<br>`tests/store-attribution.test.mjs` | present | A4-1 #46 귀속 집계, PR 4b-2 #53 잔여(광고비 이관). 학습 규칙 연결은 #53이 B3·B4 2부로 넘김 |
| `loop-4` | PR 4a | #48 `48d340d`, #60 `656b7ed` | `lib/token-budget.ts`<br>`tests/token-budget.test.mjs` | present | #48 토큰 예산, #60 OpenAI 경로 후속 |
| `loop-5` | PR 4a | #48 `48d340d` | `lib/usage-ledger.ts`<br>`lib/usage-summary.ts`<br>`tests/usage-summary.test.mjs` | present | #48 별칭 단가 선언(결정 10) |
| `loop-6` | PR 4b | #44 `3a147c3` | `tests/learning.test.mjs` | present | #44 ID 인용(검증 채널 분리), 테스트 ID 주석 |
| `loop-7` | PR 4b | #44 `3a147c3` | `lib/store-server.ts`<br>`tests/stores.test.mjs`<br>`tests/nav-state.test.mjs` | present | #44 ID 인용(점포 회고 규칙 승격 미리보기) |
| `loop-8` | F2(흡수) | #43 `92a9ad1` | `lib/usage-ledger.ts`<br>`tests/execution-identity.test.mjs` | present | 배정 변경: F2 통째 흡수. #43(F2a) 실행 신원 조인 키 |
| `loop-9` | PR 4b | #44 `3a147c3`, #213 `877e874` | `lib/measurement-collection.ts`<br>`tests/measurements.test.mjs` | present | #44 ID 인용(측정 기간 롤링) |
| `loop-10` | PR 4b | — | `lib/context-replay.ts`<br>`tests/context-replay.test.mjs` | open-pr | 구현은 #218 OPEN(input_diet·digest·입력 상한). main의 lib/context-replay.ts(#64→#220 복원)는 설계 근거(B5)일 뿐 구현 아님 |
| `loop-11` | PR 4b | #44 `3a147c3`, #213 `877e874` | `lib/learning-view.ts`<br>`tests/learning-view.test.mjs`<br>`tests/learning.test.mjs` | present | #44 ID 인용(규칙 만료 알림) |
| `exec-loop-4` | A4(1단계) + PR 4b 잔여 | #46 `edf82f1`, #49 `07e2c97`, #50 `b948848`, #53 `900cbca` | `lib/campaign-attribution.ts`<br>`lib/store-operations-server.ts`<br>`tests/tracking-codes.test.mjs`<br>`tests/execution-publication-code.test.mjs`<br>`tests/store-publication-codes.test.mjs`<br>`tests/store-code-entry.test.mjs` | present | 권고 (1)(2)(3)(5) 병합. 권고 (4) Instagram media ID·인사이트는 #53이 범위 밖으로 둠 → #219(loop-2, OPEN)가 게시물 ID 등록을 다루나 exec-loop-4를 인용하지 않음(추적 필요) |
| `exec-loop-10` | PR 4b | #44 `3a147c3` | `lib/execution-server.ts`<br>`tests/execution-loop.test.mjs`<br>`e2e/execution.spec.ts` | present | #44 ID 인용(발행 횟수 한도 명칭) |
| `security-ops-5` | PR 4b | #63 `e4c5cc4`, #213 `877e874` | `lib/measurement-status.ts`<br>`lib/connectors/errors.ts`<br>`tests/measurement-status.test.mjs` | present | #213 병합. ③ Instagram 토큰 만료 조회·장수명 토큰 갱신은 범위 제외 — CLOSEOUT §3이 5절 인계 요구 |
| `security-ops-6` | PR 4b | #211 `97da209` | `lib/credential-crypto.ts`<br>`lib/credential-crypto-server.ts`<br>`tests/credential-crypto.test.mjs` | present | #211 병합(97da209). 운영 키 회전은 not_run — CLOSEOUT §3이 5절 인계 요구 |
| `security-ops-11` | PR 4a + A7(잔여) | #48 `48d340d`, #56 `63ce8cb` | `lib/deep-research-server.ts`<br>`lib/store-server.ts`<br>`tests/research-errors.test.mjs`<br>`tests/research-salvage.test.mjs`<br>`tests/validate.test.mjs` | present | 배정 변경 반영: #48 커넥터 한도·예외 문구, #56(A7) null 원소 422·부분 구제 완료 |
| `ai-quality-9` | PR 4b | — | `lib/context-replay.ts` | open-pr | 구현은 #218 OPEN. B5 설계 근거(#64 병합→#65에서 삭제→#220 a2b8b48 복원)만 main에 있음 |
| `ux-1` | PR 5 | #37 `17d819b` | `lib/nav-state.ts`<br>`tests/nav-state.test.mjs`<br>`e2e/navigation.spec.ts` | present | #37 ID 인용(URL 내비게이션). 캠페인 상세 탭 동기화는 이월 표기 |
| `ux-2` | PR 5 | #53 `900cbca`, #61 `a0d07d6` | `app/execution-panel.tsx`<br>`app/store-operations-panel.tsx`<br>`tests/execution-store-links.test.mjs`<br>`e2e/store-measurement.spec.ts` | present | #61 권고 (2)(3), 캠페인 귀속 요약은 #53 성과 탭 |
| `ux-3` | PR 5 | #61 `a0d07d6` | `app/account-context.tsx`<br>`tests/account-ui.test.mjs` | present | #61 ux-3 (1)(2) |
| `ux-4` | PR 5 | #37 `17d819b` | `app/workspace.tsx`<br>`e2e/navigation.spec.ts` | present | #37 ID 인용(로딩·오류 상태). ID 코드 주석 없음 |
| `ux-5` | PR 5 | #61 `a0d07d6` | `lib/feature-status.ts`<br>`tests/feature-status.test.mjs`<br>`tests/workspace-wiring.test.mjs` | present | #61 ID 인용, 코드·테스트 주석 |
| `ux-6` | PR 5 | #37 `17d819b` | `lib/history-labels.ts`<br>`tests/history-labels.test.mjs` | present | #37 ID 인용(버전 비교 라벨) |
| `ux-7` | PR 5 | #37 `17d819b` | `lib/archive-stage.ts`<br>`tests/archive-stage.test.mjs` | present | #37 ID 인용(브랜드 아카이브 진행 표시) |
| `ux-8` | PR 5 | #37 `17d819b` | `lib/brand-default.ts`<br>`tests/brand-default.test.mjs` | present | #37 ID 인용(기본 브랜드) |
| `ux-9` | PR 5 + PR 5d(권고 2 잔여) | #40 `590a146`, #58 `193fe96` | `lib/campaign-archive.ts`<br>`app/delete-campaign-dialog.tsx`<br>`tests/campaign-archive.test.mjs`<br>`tests/deletion-summary.test.mjs` | present | 배정 변경 반영: #40 권고 1·3, #58 보관 완료 |
| `ux-10` | PR 5 | #37 `17d819b` | `lib/workspace-metrics.ts`<br>`tests/workspace-metrics.test.mjs` | present | #37 ID 인용(대시보드 숫자 통일) |
| `ux-11` | PR 5 | #37 `17d819b` | `app/workspace.tsx`<br>`tests/workspace-wiring.test.mjs` | present | #37 ID 인용(상세 중복 호출 제거). ID 코드 주석 없음 |
| `ux-12` | PR 5 | #226(레인 A, 2026-09-27) | `lib/rerun-impact.ts`<br>`tests/rerun-impact.test.mjs` | unmapped → #226 | 병합·열린 PR 본문, 커밋, 코드·테스트 어디에도 ID 없음. 계획 PR 5 범위 중 "재실행 영향 설명"만 대응 PR이 안 보임(ID↔항목 대응은 감사 원문 확인 필요) |
| `data-truth-8` | PR 5(5d) | #58 `193fe96` | `lib/campaign-status.ts`<br>`tests/campaign-status.test.mjs` | present | #58 파생 캠페인 상태 |
| `data-truth-9` | PR 5 | #37 `17d819b`, #58 `193fe96` | `lib/workspace-metrics.ts`<br>`tests/workspace-metrics.test.mjs`<br>`lib/campaign-status.ts` | present | #37 지표 정의 통일 |
| `eng-hygiene-12` | PR 5(ux-5에 흡수) | #61 `a0d07d6` | `lib/feature-status.ts`<br>`tests/feature-status.test.mjs` | absorbed | IMPROVEMENT-PLAN 36행: ux-5와 같은 설정 기능 표 문제. #61이 "ux-5·eng-hygiene-12"로 함께 처리, 코드·테스트 주석 병기 |
| `security-ops-1` | PR 6(2단계 병행) | #33 `0a0c497`, #47 `310be12` | `lib/research-tools.ts`<br>`lib/research-tool-check.ts`<br>`tests/research-tools.test.mjs`<br>`server/research-worker/install.py` | present | #33 설치기(훅), #47 앱 측 도구 위험 등급 |
| `security-ops-2` | PR 6(2단계 병행) | #33 `0a0c497` | `server/research-worker/install.py`<br>`tests/research_install_test.py` | present | #33 브라우저 격리(high). 서버 적용은 #72·#77 재설치 기록 참조, 코드 주석에 ID 없음 |
| `security-ops-3` | PR 6(2단계 병행) | #33 `0a0c497` | `server/research-worker/install.py`<br>`tests/research_install_test.py` | present | #33 설치기 권한 축소 |
| `security-ops-4` | PR 6(2단계 병행) | #33 `0a0c497`, #47 `310be12` | `lib/research-worker.ts`<br>`tests/research-worker-rotation.test.mjs`<br>`tests/research_worker_test.py` | present | #33 워커 백오프, #47 토큰 만료·회전 |
| `security-ops-7` | PR 6(2단계 병행) | #33 `0a0c497`, #47 `310be12` | `lib/research-worker.ts`<br>`scripts/probe-dispatcher-auth.mjs`<br>`tests/security-boundaries.test.mjs` | present | #33 probe, #47 앱 gate 확인 |
| `security-ops-12` | PR 6(2단계 병행) | #33 `0a0c497`, #65 `918e643` | `lib/file-signature.ts`<br>`lib/archive-upload-server.ts`<br>`tests/file-signature.test.mjs`<br>`tests/upload-integrity.test.mjs` | present | #33 시그니처, #65(PR 6c) 서버 재추출·원본 정리 |
| `eng-hygiene-8` | 제외 | — | — | excluded | 포맷 일괄 변경 제외(계획 제외 표) |
| `eng-hygiene-11` | 제외 | — | — | excluded | 로컬 pnpm 불일치 제외(명령은 node 직접 실행) |
| `data-truth-11` | 제외(권고 (1)만 F4a 재개) | #32 `fc8eb5c` | `lib/record-kinds.ts`<br>`tests/record-kinds.test.mjs` | excluded | 권고 (1) kind 레지스트리는 #32(F4a) 병합으로 처리, 권고 (2) 스키마 버전·마이그레이션은 계속 제외 |
| `eng-hygiene-9` | 제외 | — | — | excluded | Android PR #16 여전히 OPEN — 계속/닫기 결정 미정(계획 범위 밖) |
| `data-truth-6` | refuted | — | — | refuted | 주문 장부→점포 측정→AI 입력 경로 기존재. 귀속 요약 표시는 ux-2·loop-3(#53)에서 처리 |
