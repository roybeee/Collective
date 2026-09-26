# 세션별 레인과 개발 순서

결론: COLLECTIVE는 세 세션이 동시에 개발한다. 이 문서는 누가 무엇을 만들고, 어떤 파일을 고치고, 누가 게시하는지를 정한다. 같은 일을 두 세션이 하지 않게 하려는 문서이고, 다른 문서와 충돌하면 이 문서가 이긴다.

비유: 한 부엌에 요리사 셋이 있다. 각자 맡은 메뉴(레인)가 있고, 음식 내보내기(게시)는 한 사람만 한다. 주문판(STATUS)은 칸을 나눠 자기 칸에만 적는다.

- 결정: 대표 지시(2026-09-26 "계속 뭔가 앞서가있어서 중복업무를 하고있어보이는데 바로잡고 세션별 개발순서를 정리해서 중복업무를 없애").
- 작성: Claude A 세션. 레인을 바꾸려면 대표 확인을 받고 이 문서를 고친다.

## 왜 바꾸나 (2026-09-26 관찰)
- 최근 PR 25개 중 24개가 `docs/STATUS.md`를 고쳤다. 대부분 같은 줄(`마지막 갱신`, 운영 표)이다. 그래서 병합할 때마다 충돌이 나고 CI를 다시 돌렸다(#129·#130·#133 등).
- 게시를 세 곳이 했다. 버전 36은 트랙 R, 37~39는 Codex, 40은 Claude A가 했다. 운영 기록도 세 곳이 따로 적었다(#131, #135, STATUS 운영 표).
- STATUS와 HANDOFF에 같은 절이 복사돼 있다(HERMES 평가 실패 복구, 운영 API 복구 등).
- HANDOFF의 '다음 작업'이 세 레인을 한 목록에 섞어서, 누가 할 일인지 분명하지 않았다.

## 레인

| 레인 | 세션 | 맡는 일 | 게시 |
|---|---|---|---|
| **A** 제품 기능 | Claude A 세션 | 성장 계획 A·B 트랙 제품 기능(`docs/GROWTH-PLAN.ko.md`). A3·A6 마무리, A8, B4 2부, B3, 조건부 A5 | **게시 담당(단독)** |
| **R** 가맹 모집 | Claude 트랙 R 세션 | 트랙 R 전체(`docs/FRANCHISE-RECRUITMENT-PLAN.ko.md`) | 하지 않음. 게시 대기열에 적는다 |
| **Q** 품질·평가·운영 | Codex 세션 | 품질 계획 v2 잔여(R4·A/A·R5·J4), 평가 하네스·HERMES·품질 콘솔, 프롬프트 레지스트리 운영(A1 `channel.offline` 쌍 평가·활성화), 게시 뒤 운영 감시 | 하지 않음. 게시 대기열에 적는다 |

- 레인에 없는 새 일이 생기면, 먼저 발견한 세션이 STATUS의 자기 레인 칸에 "제안"으로 적고 대표 확인을 받은 뒤 이 표에 더한다.
- 다른 레인의 PR을 대신 병합하거나 고치지 않는다. 막히면 그 레인 칸의 '막힌 것'에 적는다.

## 레인별 개발 순서

### 레인 A (Claude A 세션)
1. A3·A6 종료 조건 run. 묶음 14(Sites 버전 40)에 실렸다.
   - A6: 점포 브랜드 자료 요청 1건이 사실 확정으로 닫힘(real, 토큰 0). 사실 확정은 대표가 한다.
   - A3: 골든 v2 dev 2건(예약 100k, 실측 약 30k). 스위치를 켜는 것은 대표 확인 뒤에 한다.
2. A8 고객 보고서·사실 지식 팩(LLM 0). 선행 A4·B2·F2는 `merged`다. 화면은 PR 5 범위다.
3. B4 2부 보상 계보. 결정 16(첫 실게시)을 먼저 확인한다.
4. B3 교정 플레이북. `lib/learning.ts`와 역할 입력을 고친다. 레인 R의 R3b가 병합된 뒤 시작한다(아래 공유 파일 순서).
5. 조건부 A5, B5 GEPA, B4 3부. W24 발동 조건을 확인한 뒤 착수하거나 `not_run`을 기록한다.

### 레인 R (Claude 트랙 R 세션)
1. R3b 새 채널 단위 6개. `prompts/channel.*`, `lib/prompt-units.ts`, `lib/role-instruction.ts`, `lib/meetings.ts`를 고친다.
2. R15a-2 모집 자료 키트 기록·API·화면. `lib/record-kinds.ts`를 고친다.
3. 그 뒤는 트랙 R 계획 순서를 따른다(R3c `lib/graders/industry.ts`, R5 등).

### 레인 Q (Codex 세션)
1. 열린 #131(운영 API 복구 기록)·#135(Codex 한도 오판 수정)를 병합한다.
2. A1 `channel.offline` 쌍 평가를 다시 하고, 통과하면 지정 캠페인에 stage한다. HERMES 쿼터가 복구된 뒤에 한다.
3. R4 대표 라벨링 대기열 운영(주 20건), A/A 10건(10월 한도, 약 0.22M), R5 채택 판정 → J4 게이트 PR.
4. 게시 뒤 24~72시간 운영 감시(`invalid_output` 비율, 5xx, Workers CPU). 결과는 자기 레인 칸에 적는다.

## 게시 (레인 A 단독)
- 게시는 레인 A만 요청한다. 방식은 자동 게시(`docs/PUBLISH.ko.md` 8절)다. 다른 레인은 Sites 편집기 붙여 넣기도, 게시 요청 PR도 만들지 않는다.
- 다른 레인이 게시가 필요하면 STATUS의 **게시 대기열**에 한 줄을 적는다(병합된 PR 번호, 급한 정도, 스위치 기본값).
- 레인 A는 대기열을 모아 묶음으로 게시한다. 급한 수정은 바로 게시한다.
- 게시 뒤 운영 확인(`runtime-verified`)은 `/api/version/public` curl과 소유자 `/api/version`으로 하고, 게시 기록(`docs/releases/`)은 레인 A가 쓴다.
- 롤백은 운영 장애 때 어느 레인이든 대표 확인을 받고 할 수 있다. 한 뒤에는 레인 A 칸에 알린다.

## 공유 문서 규칙
- **`docs/STATUS.md`**
  - 각 레인은 자기 칸(`## 레인 A`·`## 레인 R`·`## 레인 Q`)만 고친다.
  - 칸마다 첫 줄이 그 레인의 `갱신:` 시각(UTC)이다. 파일 전체의 `마지막 갱신` 줄과 `현재 운영 상태` 표, `게시 대기열`은 게시 담당(레인 A)만 고친다.
  - 다른 레인 칸이나 공용 표가 틀렸으면 고치지 말고, 자기 칸에 "확인 필요: …"로 적는다.
- **`docs/HANDOFF.ko.md`**
  - '일하는 방법'(검증 명령, 평가 run 방법, 함정)만 둔다. 상태·결과 절은 STATUS에만 적고 HANDOFF에 복사하지 않는다.
  - '다음 작업'은 이 문서의 레인별 개발 순서를 가리킨다.
- **게시 기록 `docs/releases/`**: 레인 A만 쓴다.
- **관찰 기록 `docs/observations/`**: 만든 레인이 쓴다. 파일 이름에 레인이 드러나게 한다.

## 공유 코드 파일 순서
두 레인 이상이 고치는 파일은 아래 순서로 병합한다. 먼저 병합된 쪽이 이기고, 뒤에 오는 쪽은 최신 `origin/main`을 merge한 뒤(강제 푸시 금지) 이어 붙인다.

| 파일 | 소유(먼저) | 뒤에 오는 레인 | 규칙 |
|---|---|---|---|
| `lib/graders/index.ts` `GRADERS_VERSION`, `lib/graders/compliance-lexicon.ts` | Q | A, R | 채점기·사전 추가는 태그를 이어 붙인다. Q의 채점 기준 변경 PR이 열려 있으면 그 뒤에 병합한다 |
| `prompts/`, `lib/prompt-units.ts`, `lib/role-instruction.ts`, `lib/meetings.ts` | R(R3b) | A(B3) | R3b 병합 뒤 B3 착수 |
| `lib/role-execution.ts`, `lib/meeting-execution.ts`, `lib/brief-execution.ts`, `lib/execution-server.ts` | 먼저 연 PR | 나머지 | 호출 1줄 수준만 더한다. 스위치는 `*-server.ts` 보조 모듈에서 읽는다(구조 규칙 `tests/franchise-objective.test.mjs` 6) |
| `lib/record-kinds.ts`, `lib/feature-flags.ts`, `lib/feature-status.ts` | 먼저 연 PR | 나머지 | 끝 고정 묶음 앞에 자기 레인 항목을 붙인다. 고정 목록 테스트는 자기 항목만 더한다 |
| `lib/learning.ts`, `lib/learning-server.ts` | A | — | B3·B4 2부 |
| `lib/franchise-*`, `app/api/franchise*` | R | — | |
| `lib/eval-*`, `lib/online-grading.ts`, `lib/prompt-registry.ts`, `scripts/eval/` | Q | — | A·R가 고쳐야 하면 Q 칸에 요청한다 |

## 세션 시작 점검 (모든 레인)
1. 이 문서와 STATUS의 자기 레인 칸, 게시 대기열을 읽는다.
2. `gh pr list`로 다른 레인의 열린 PR이 고치는 파일을 보고, 위 표의 순서를 지킨다.
3. 다음 일은 자기 레인 개발 순서의 맨 위에서 고른다. 다른 레인 목록의 일은 하지 않는다.
