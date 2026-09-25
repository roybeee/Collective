# 공동작업 인계 (Claude ↔ ChatGPT/Codex)

결론: 다른 도구(ChatGPT·Codex·다른 Claude 세션)가 이 저장소를 이어서 개발할 때 읽는 문서다. 코드와 상태의 정본은 GitHub `main`과 [현재 상태](STATUS.md)다. 이 문서는 거기에 없는 '일하는 방법'을 적는다. 역할 분리, 게시 방법, 평가 run 방법, 겪은 함정, 다음 작업이다.

비유: STATUS.md는 병원 차트이고, 이 문서는 교대 근무자에게 주는 인수인계 메모다.

## 기준
- 저장소: `roybeee/Collective`, 브랜치 `main`
- 기준 SHA: `8c22f0e`(#115). 운영은 `e8bd8e0`(tree `d8eacc9`)이다. `8c22f0e` 게시 지시문을 대표에게 보냈다(대기).
- 작성자/도구: Claude Code(품질 계획 v2 세션)
- 작성 시각: 2026-09-25 15:21 UTC
- 이 문서를 바꾸는 사람은 기준 SHA와 작성 시각을 같이 고친다.

## 먼저 읽을 것
1. [AGENTS.md](../AGENTS.md): 공동작업 규칙과 금지 사항(강제 푸시·`reset --hard`·비밀값 커밋 금지).
2. [현재 상태](STATUS.md): 운영 버전, 진행 중 작업, 다음 행동.
3. [품질 로드맵](QUALITY-ROADMAP.ko.md)과 [평가 하네스](EVAL.ko.md): 품질 계획 v2와 채점기.
4. 다음 개발 후보: [성장 계획](GROWTH-PLAN.ko.md)의 A1·A3·A6·A8·B4 2부, [트랙 R](FRANCHISE-RECRUITMENT-PLAN.ko.md).

## 역할 분리
| 일 | 누가 | 이유 |
|---|---|---|
| 코드·문서 PR, 병합 | 개발 도구(Claude 또는 GPT) | 대표가 병합·평가 run·게시 SHA 선택을 위임했다(2026-09-25, STATUS '권한 위임') |
| Sites 게시 실행 | 대표가 Sites 편집기에 지시문을 붙여 넣음 | 개발 도구에는 게시 도구가 없다 |
| 공유 서버(HERMES) 명령 | 대표 | 공유 서버 변경은 대표 확인 뒤 |
| 봉인 케이스 작성·생성·가져오기 | 프롬프트를 고치지 않는 사람·세션 | [봉인 케이스](SEALED-CASES.ko.md). 프롬프트를 고치는 도구는 Claude든 GPT든 봉인 요청·출력을 열지 않는다. 합계만 본다 |
| 평가 라벨(R4) | 대표 | AI 심사를 대표 눈높이로 보정한다 |

## 두 도구가 함께 일할 때
- 한 작업은 최신 `origin/main`에서 만든 브랜치 하나, PR 하나다.
  - 시작할 때 STATUS의 진행 중 작업에 한 줄을 적는다(브랜치 이름, 도구, 목표).
  - 같은 파일을 두 도구가 동시에 고치지 않는다. 파일 소유자는 1명이다.
- 자주 충돌하는 줄이 있다. `lib/graders/index.ts`의 `GRADERS_VERSION`, `lib/graders/compliance-lexicon.ts`의 사전 버전, `docs/STATUS.md`다. 먼저 병합된 PR이 이기고, 뒤 PR은 `origin/main` 위로 다시 올려 버전을 이어 붙인다.
- 게시 SHA는 한 번에 한 도구만 고른다. 게시 지시문이 나가 있는 동안에는 다른 도구가 새 게시를 요청하지 않는다(지금: `8c22f0e` 대기).
- 브라우저: 소유자 세션 Chrome 탭을 두 도구가 같이 쓰면 요청이 막힌다(2026-09-25 `ERR_BLOCKED_BY_CLIENT`). 도구마다 새 탭을 연다.

## 검증 명령 (`pnpm run` 금지, node로 직접)
```sh
node scripts/test.mjs                              # 126 suites
node node_modules/typescript/bin/tsc --noEmit
node scripts/lint-gate.mjs                         # 기준선 70 errors / 39 warnings
node scripts/check-prompts.mjs
python3 tests/research_worker_test.py              # 소켓 경합으로 간헐 실패(기존 결함)
node scripts/run-framework.mjs build
node --experimental-vm-modules tests/<이름>.test.mjs   # 스위트 하나
```
- 채점기·사전·파서를 고치면 원문 문장으로 RED 테스트를 먼저 만든다.
  - 가드 테스트(계속 잡아야 하는 문장)도 둔다.
  - 규칙의 대안마다 빼 보는 변이 검사를 한다. 살아남은 대안은 규칙에서 빼거나 테스트를 더한다.
- 채점 결과가 바뀌면 `GRADERS_VERSION`에 태그를 더한다. 규제 판정이 바뀌면 사전 버전을 올린다. 둘 다 EVAL 문서에 적는다.
- 프롬프트 바이트가 바뀌면 기준 fixture를 커밋 SHA로 다시 캡처한다(`tests/prompt-baseline.test.mjs`·`scripts/eval/capture-role-submission.mjs` 머리 주석). 커밋을 먼저 만들고 그 SHA로 캡처한다.

## 게시 방법 (커넥터 파일 목록 방식)
[게시 절차](PUBLISH.ko.md)의 exact-tree 방식은 Sites 작업 사본의 GitHub fetch 시간 초과로 쓰지 않는다. 지금은 아래 방식이다.
1. 목록 만들기: `git diff --no-renames --raw --no-abbrev <운영 SHA> <목표 SHA> | awk '{st=$5; blob=(st=="D")?"-":$4; print st" "blob" "$6}'`
2. 보내기 전 검증: 임시 `GIT_INDEX_FILE`에 운영 tree를 `read-tree`하고 목록을 `update-index`로 적용한다. 그 결과 `write-tree`가 목표 tree와 같아야 한다.
3. 지시문에 넣을 것(최근 지시문 형식을 따른다):
   - (0) 시작 tree 확인.
   - A·M 줄은 `curl -o`로 받고 `git hash-object`로 확인.
   - D 줄은 `git rm -q`.
   - write-tree 전 전체 재해시.
   - write-tree = 목표 tree일 때만 커밋·빌드.
   - 빌드 뒤 `HEAD^{tree}` 재확인.
   - 보고 항목(SITES_COMMIT 등).
4. 겪은 함정
   - 파일이 저장 뒤 빈 파일(`e69de29`)로 바뀐 일이 있다. 그래서 write-tree 전에 전체를 다시 해시한다.
   - 편집기가 삭제 줄을 건너뛴 일이 있다. 그래서 D 줄은 `git rm` 명령으로 적는다.
   - zsh에서 변수 이름 `path`를 쓰면 PATH가 망가진다.
   - 다른 세션의 게시가 끼면 tree가 예상과 다르다. 시작 tree별 목록을 여러 개 준비하거나, 멈추고 보고하게 한다.
5. 게시 뒤 확인(소유자 세션)
   - `/api/version` tree, `/api/auth`.
   - 쿠키 없는 업무 API 401, `/media/<없는 해시>.png` 404와 CSP.
   - 작업자 online, 기능 스위치 기본값, `check_connection`.
   - 결과는 `docs/releases/<날짜>-<sha7>.md`에 적는다.

## 평가 run 방법 (소유자 세션 브라우저, `/api/eval`)
- 실행: `POST {action:'start_run', label, variant:'active', caseIds, tokenBudget}`
  - 역할·브리프 케이스는 1건에 50,000, 회의 단계는 100,000을 예약한다.
  - 예산은 '실제 사용 + 다음 케이스 예약'을 넘어야 한다. 2건을 60,000으로 넣으면 두 번째가 `not_run`이 된다.
- 한도: 스모크 1회 250,000, 월 한도는 `eval_budget_approval`.
- 게시 뒤에는 `POST {action:'regrade_run', id}`로 끝난 run을 새 저울로 다시 채점한다(토큰 0).
- 결과 조회: `?run=<id>`, `?run=<id>&caseId=<id>`(출력), `?run=<id>&regrade=latest`.
- 브라우저 자동화로 읽을 때 쿠키·쿼리처럼 보이는 문자(`= ? & %`)가 섞이면 출력이 막힌다. 바꿔서 읽는다.

## 다음 작업
1. `8c22f0e` 게시 반영 확인과 릴리스 기록. S8 run `93a7c33a`·`480861d6` 재채점으로 `industry_metric_leak` 오탐이 사라졌는지 본다(토큰 0).
2. R4 대표 라벨링: 품질 콘솔 대기열 65건, 주 20건.
3. A/A 10건: 10월 한도, 약 0.22M. J4 임계값의 잡음 바닥이다.
4. R5 채택 판정(토큰 0) → J4 게이트 PR(품질 계획 v2 마지막 PR).
5. 게시 뒤 24~72시간 동안 `invalid_output` 비율, 5xx, Workers CPU를 본다. #112가 거절을 줄여야 한다.
6. 다음 개발은 대표 결정 대기다. 권장은 A1 로컬 채널 스킬 팩 → A3 카피 팩 v2다. 트랙 R은 법률 검토(R-0)가 병목이다.

## 남은 위험
- 모델 원문에 입력 필드 이름(`evidence.directives` 등)이 섞이는 예방 판정 fail이 R3 역할 3건에 있다. 화면에서는 정규화로 가려진다. 지시문에 금지 규칙이 이미 있어 비율만 추적한다.
- 조건 없는 `[가격 확인 필요]` CTA 경고는 설계대로 남긴다(품질 수정 v1 결정).
- 운영 `/api/version` tree가 `unknown`으로 나온 일이 있다(2026-09-25 08:21, 트랙 R 게시). 원인은 확인하지 못했다. 빌드하던 순간 git 조회가 실패한 것으로 보인다(그 빌드 결과물에 tree 문자열이 없음). 재발 방지(같은 셸에서 tree를 확인해 `COLLECTIVE_SOURCE_TREE`로 넘겨 빌드하고, `dist/server`에 tree가 박혔는지 확인한 뒤 게시)는 [73147a9 게시 기록](releases/2026-09-25-73147a9.md)에 있다.
