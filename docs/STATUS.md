# COLLECTIVE 현재 상태

마지막 갱신: 2026-09-23 05:59 UTC (Codex)

## 소스와 배포

- 제품 소스: `6fe596afed212d6786da28d20685fb1caf8e8ec7` (PR #13 merged, main CI passed).
- Sites 버전 20 published, 환경 revision 3 적용. 배포 `appgdep_6ab359666c508191bd34be4d348e93c2` succeeded.
- runtime-verified: 로그인한 운영 브라우저의 `/api/version?release=6fe596a`가 tree `c382ed857f9fe3e9da63842c8f5309be070c375e`를 반환해 제품 소스와 일치했다.
- 이 상태 기록의 후속 문서 커밋은 별도 게시하지 않는다. 운영 기준은 위 제품 커밋이며 문서 전용 main 후속 커밋과 구분한다. [게시 증거](releases/2026-09-23-6fe596a.md).

## ODA 실사용 후속 보완 — 게시 준비

사용자가 실제 ODA 오류 분석 뒤 구현을 승인했다. `fix/oda-execution-quality`에서 역할별 결과 계약·재작성/후속 무효화, 회의 실패 단계 재작성, 서버 단일 진행, 업종·측정 규칙, 사용량 진단을 보완했다. [상세](ODA-EXECUTION-FIXES.ko.md).

- 테스트: passed, 21/21 suites (real SQLite/핸들러, mocked 모델 공급자).
- Playwright: passed, 10/10 (real Chromium/로컬 D1, mocked 인증; 새 회의 검사는 응답/작업자 상태도 mocked).
- TypeScript 및 build: passed, exit 0. lint gate: passed, errors106/기준108, warnings44/기준44.
- 코드 검토의 후속 작업물 무효화와 재작성 UI 지적을 수정했다.
- 커버리지 비율과 새 실제 모델 응답 검증: not_run. 구조 검증을 사실 정확성 검증으로 해석하지 않는다.
- 기존 운영 버전은 위 20이며, 이 후속 변경의 merged/published/runtime-verified는 배포 기록에서 별도로 확정한다.

## 이번 보완

1. 역할·바이럴 접수의 원자 저장, 멱등 복구, 활성 실행 전체 조회.
2. 실패·취소·형식 오류를 포함한 사용량 원장, 수동 가격 버전과 nullable 비용, 설정 UI.
3. machine worker의 역할·회의·바이럴·초안 진행, 캠페인 연속 실행 동의/중단, 조사·측정 공정 순환.
4. 캠페인 상세 및 이전 원문 비교, 출처·기간·범위와 미확인 비용 보존, stale 수정 거부.
5. 요청/외부 응답 스트림 제한, 설치 파일 관리자 제한, 읽기 전용 운영 인증 probe.

상세와 적용 조건: [실행·사용량·작업물 보완](RELIABILITY.ko.md), [보안 경계](SECURITY-BOUNDARIES.ko.md).

## 이번 검증

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

## 운영 적용과 남은 경계

- `RESEARCH_WORKER_ADMIN_IDS`에 기존 운영 워커의 실제 소유자 ID를 secret으로 설정하고 게시했다. 로그인 사용자 canInstall=true를 확인했다.
- 기존 worker tick 자격증명은 유지했다. 게시 이후 heartbeat 및 systemd active/running, queue idle을 확인했다. 기존 Python 프로토콜과 호환하므로 재설치·재발급·재시작하지 않았다.
- 새 사용량 UI와 기존 워크스페이스 데이터 조회를 운영 브라우저에서 확인했다. 단가는 미등록이며 임의 가격을 넣지 않았다.
- gateway의 도구 강제 읽기 전용 권한·직접 origin·실사용자 간 격리는 추가 운영 검증 대상이다. 설치 파일의 공통 gate는 여전히 신뢰된 관리자에게 제공된다.
- workspace 전체 본문 전송은 호환을 위해 유지한다. 페이지네이션 최적화와 고객별 협업 권한은 이번 변경에 포함하지 않았다.

## 과거 실제 실행

[2026-09-23 관측 기록](observations/2026-09-23-live-run.md)에 실제 8역할·회의·브랜드 조사 및 바이럴 조사 결과가 있다. 모의 테스트 통과와 과거 실호출은 별개의 근거다. 해당 문서의 총 18건 표에는 실패 1건이 포함되므로 모두 완료한 18건으로 해석하지 않는다. 강화된 품질 게이트 이후의 실호출 및 원문 경로 개선의 운영 게시 여부는 별도 확인한다.
