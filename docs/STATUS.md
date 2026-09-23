# COLLECTIVE 현재 상태

> 작업 시작 시 읽고, 아래 "확인 명령"으로 실제 원격 상태와 대조한다. 다르면 원격이 맞다. 용어는 `AGENTS.md`의 상태 어휘를 따른다.

마지막 갱신: 2026-09-23 00:50 UTC (Claude, 브랜치 `chore/ops-guardrails`)

## 현재 단계

Phase 0·1A와 게이트/CI 통합(PR #1·#2·#4), 배포 신원 확인(PR #5)이 `merged`. 운영 가드레일(이 문서, 상태 어휘, 위임 계약, 게시 체크리스트, 비차단 E2E)을 도입하는 중.

## 검증된 결과

| 항목 | 상태 | 근거 | 증거 |
|---|---|---|---|
| `origin/main` | `ea205b1c09fc18fc07c7960113d8c24c7ffff43f` (PR #5 병합) | real | `git ls-remote origin refs/heads/main` (2026-09-23 00:50 UTC) |
| `origin/main^{tree}` | `c31a5271d11601b72808caacb4898d80d1bcce2d` | real | `git rev-parse 'origin/main^{tree}'` |
| 마지막 운영 배포 | `runtime-verified` — 기록된 사실(2026-09-23) | real | `ea205b1` → Sites 버전 19, deployment `appgdep_6ab2c5735b0c8191b99ac67dba10975b`, `/api/version` tree `c31a5271…` 확인 2026-09-23 03:12 KST (소유자 기록) |
| main 이동 여부 | 위 배포 뒤 main은 움직이지 않았다(00:50 UTC 기준, tree 동일) | real | 위 두 명령 |
| typecheck | passed | real | `node node_modules/typescript/bin/tsc --noEmit` exit 0 |
| 단위·통합 테스트 | passed | mocked (HERMES/외부 fetch 스텁, SQLite) | `node scripts/test.mjs` 11/11 스위트, 509 assertions |
| lint 기준선 | passed | real | `node scripts/lint-gate.mjs` errors 108/108, warnings 44/44 |
| E2E 스모크(로컬) | passed, 비차단 | real 브라우저·빌드·로컬 D1 / mocked 인증 헤더 | `node node_modules/@playwright/test/cli.js test` 4/4 × 3회 (`docs/E2E.ko.md`) |

이 가드레일 PR이 병합되면 main의 tree가 바뀐다. 그 뒤 운영은 새 main 기준으로 `runtime-verified`가 아니다(문서·테스트만 바뀌어 앱 동작은 같지만 tree가 다르다). 재게시 여부는 소유자가 `docs/PUBLISH.ko.md` 사전 점검 뒤 결정한다.

## 막힌 것 · 미해결

1. **유료 HERMES로 자사 브랜드 1개를 8역할 전 구간 실제 실행한 관측 기록이 main에 없다.** main의 테스트는 전부 fetch 스텁(mocked)이다.
   - 대조 결과: 열린 PR #6(`docs/live-run-observation`)이 운영 `/api/workspace`를 읽은 관측 기록을 제안한다 — 2026-09-17~19 실행 18건, 8역할 전부 completed, 회의 1회, 3,126,481 토큰, `viral_discovery` 1건 failed. 아직 `merged`가 아니고 검토되지 않았으므로 main 기준 사실로 적지 않는다.
   - PR #6이 스스로 남긴 미확인: 원화 비용(스키마에 금액 없음), `reportedVerdict` vs `verdict` 차이, 실행별 소요 시간, `viral_discovery` 실패 원인.
2. 운영 인증 헤더(`oai-authenticated-user-id`)를 클라이언트가 위조할 수 없는지는 Sites 디스패처에 달려 있고, 저장소 안의 어떤 테스트도 이를 검증하지 않는다.
3. 게시 1회가 ChatGPT Work 크레딧을 크게 소모한다(2026-09-23 약 18분, 179 → 0). Hermes/Codex와 같은 계정이다.

## 작동 중인 작업

| PR | 브랜치 | 내용 | 상태 |
|---|---|---|---|
| #6 | `docs/live-run-observation` | 실제 실행 관측 기록, README 정정 | open |
| #3 | `feat/phase1b-instagram` | Instagram 커넥터와 채널 연결 화면 (Phase 1B) | open |
| — | `chore/ops-guardrails` | 이 문서·상태 어휘·위임 계약·게시 체크리스트·E2E | PR 진행 중 |

## 다음 행동

1. PR #6 검토·병합 여부 결정 → 병합되면 미해결 1번을 갱신한다.
2. 재게시가 필요하면 `docs/PUBLISH.ko.md` 사전 점검(크레딧·예약 실행) 후 단독으로 진행하고 `docs/releases/`에 기록한다.
3. `e2e-smoke`가 `docs/E2E.ko.md`의 승격 기준을 채우면 차단 게이트로 올리는 PR을 연다.

## 확인 명령

```bash
git fetch origin --prune && git ls-remote origin refs/heads/main && git rev-parse 'origin/main^{tree}'
gh pr list -R roybeee/Collective
# 운영: 앱 페이지 콘솔에서
# await (await fetch('/api/version', {credentials: 'same-origin', cache: 'no-store'})).json()
```
