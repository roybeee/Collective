# COLLECTIVE 현재 상태

> 작업 시작 시 읽고, 아래 "확인 명령"으로 실제 원격 상태와 대조한다. 다르면 원격이 맞다. 용어는 `AGENTS.md`의 상태 어휘를 따른다.

마지막 갱신: 2026-09-23 02:50 UTC (Claude, 브랜치 `docs/viral-discovery-rerun`)

## 현재 단계

Phase 0·1A·1B와 게이트/CI 통합(PR #1·#2·#4), 배포 신원 확인(PR #5), 실제 실행 관측 기록(PR #6), 운영 가드레일(PR #7)이 `merged`. PR #3(Phase 1B)은 내용이 PR #4로 main에 들어가 있어 닫았다. 관측 문서의 미확인 2건은 후속 관측(PR #8, `merged`)으로 해소했다.

## 검증된 결과

| 항목 | 상태 | 근거 | 증거 |
|---|---|---|---|
| `origin/main` | `95070ee65776e5f8af48444ab1b2f58eecd2099d` (PR #7 병합) | real | `git ls-remote origin refs/heads/main` (2026-09-23 00:56 UTC) |
| `origin/main^{tree}` | `378b2dbd523b44692a8c27966797952427bf2062` | real | `git rev-parse 'origin/main^{tree}'` |
| 마지막 운영 배포 | `runtime-verified` — 기록된 사실(2026-09-23) | real | `ea205b1` → Sites 버전 19, deployment `appgdep_6ab2c5735b0c8191b99ac67dba10975b`, `/api/version` tree `c31a5271…` 확인 2026-09-23 03:12 KST (소유자 기록) |
| main 이동 여부 | 위 배포 뒤 main이 PR #6·#7로 이동했다. 운영은 새 main 기준으로 `runtime-verified`가 아니다(문서·테스트·CI만 바뀌어 앱 동작은 같다) | real | 위 두 명령 |
| typecheck | passed | real | `node node_modules/typescript/bin/tsc --noEmit` exit 0 |
| 단위·통합 테스트 | passed | mocked (HERMES/외부 fetch 스텁, SQLite) | `node scripts/test.mjs` 11/11 스위트, 509 assertions |
| lint 기준선 | passed | real | `node scripts/lint-gate.mjs` errors 108/108, warnings 44/44 |
| E2E 스모크(로컬) | passed, 비차단 | real 브라우저·빌드·로컬 D1 / mocked 인증 헤더 | `node node_modules/@playwright/test/cli.js test` 4/4 × 3회 (`docs/E2E.ko.md`) |

재게시 여부는 소유자가 `docs/PUBLISH.ko.md` 사전 점검 뒤 결정한다. 앱 코드가 바뀌지 않았으므로 지금은 재게시할 이유가 없다.

## 막힌 것 · 미해결

1. **실제 실행 관측(PR #6 `merged`)의 남은 미확인.** 후속 관측(2026-09-23 00:55 UTC, real, 읽기 전용)으로 2건을 해소했다(`docs/observations/2026-09-23-live-run.md` 5절).
   - `viral_discovery` 실패 원인: 당시(9/17) HERMES api_server에 도구가 없어서 모델이 사례를 지어내지 않고 비워 반환했고, 앱이 이를 `failed`로 기록했다. 도구는 9/18에 연결됐고, 재실행에서 성공을 확인했다(다음 행동 1).
   - `reportedVerdict` vs `verdict`: quality 실행 3건이 모두 게이트 도입(`d67adeb`, 2026-09-17 14:14 UTC) 이전에 실행돼 필드가 없다. 게이트 이후 실행이 있어야 관측할 수 있다.
   - 남은 미확인: 원화 비용(스키마에 금액 없음), 실행별 소요 시간, 다른 기능 경로의 실행 여부.
2. 운영 인증 헤더(`oai-authenticated-user-id`)를 클라이언트가 위조할 수 없는지는 Sites 디스패처에 달려 있고, 저장소 안의 어떤 테스트도 이를 검증하지 않는다.
3. 게시 1회가 ChatGPT Work 크레딧을 크게 소모한다(2026-09-23 약 18분, 179 → 0). Hermes/Codex와 같은 계정이다.

## 작동 중인 작업

| PR | 브랜치 | 내용 | 상태 |
|---|---|---|---|
| — | `docs/viral-discovery-rerun` | viral_discovery 재실행 관측 기록 | PR 진행 중 |

## 다음 행동

1. HERMES 검색 도구는 연결돼 있고 끝까지 동작한다(real). 2026-09-23 02:38 UTC `viral_discovery` 재실행이 `completed`로 끝났고, 실존하는 YouTube 사례 3건을 반환했다(40,150 토큰, 관측 문서 6절). 남은 한계는 Instagram·TikTok·Reddit 원문을 확인하지 못한다는 것이다(firecrawl 미지원, browser 백엔드 `off`). 이 채널들이 필요하면 browser 백엔드나 ASIDE 경로를 켤지 소유자가 결정한다. 게이트가 배포된 상태에서 quality를 실행하면 `reportedVerdict`도 관측할 수 있다.
2. 재게시가 필요하면 `docs/PUBLISH.ko.md` 사전 점검(크레딧·예약 실행) 후 단독으로 진행하고 `docs/releases/`에 기록한다.
3. `e2e-smoke`가 `docs/E2E.ko.md`의 승격 기준을 채우면 차단 게이트로 올리는 PR을 연다.

## 확인 명령

```bash
git fetch origin --prune && git ls-remote origin refs/heads/main && git rev-parse 'origin/main^{tree}'
gh pr list -R roybeee/Collective
# 운영: 앱 페이지 콘솔에서
# await (await fetch('/api/version', {credentials: 'same-origin', cache: 'no-store'})).json()
```
