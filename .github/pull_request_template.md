<!-- AGENTS.md의 PR 요구사항과 상태 어휘를 따른다. 해당 없는 항목은 지우지 말고 이유를 적는다. -->

## 목적
-

## 변경 파일
-

## 기준 SHA
- `origin/main`:

## 검증 명령
각 검사는 `passed | failed | blocked | not_run`, 근거는 `real | mocked`로 적는다.

| 명령 | 결과 | 근거 | 수치·비고 |
|---|---|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | | | |
| `node scripts/test.mjs` | | mocked | 스위트/assertion 수 |
| `node scripts/lint-gate.mjs` | | | errors/warnings (기준선) |
| `node scripts/run-framework.mjs build` | | | |
| `python3 tests/research_worker_test.py` | | mocked gateway / real 로컬 HTTP | 차단 |
| `python3 tests/research_install_test.py` | | mocked (root·네트워크 없음) | 차단 |
| `node node_modules/@playwright/test/cli.js test` | | | 비차단, 통과 수 |

## 배포 여부
- 소스: 병합 전 (병합 뒤 `merged`)
- 배포: 배포 안 함 / `published` / `runtime-verified` (`/api/version` tree와 마지막으로 게시한 제품 커밋 tree 비교, 이후 `main` 변경이 비제품 경로 전용인지 판정. AGENTS.md 상태 어휘, docs/PUBLISH.ko.md 5단계)
- 게시했다면 `docs/releases/<날짜>-<sha7>.md` 링크:

## 남은 위험
-
