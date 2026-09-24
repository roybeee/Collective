# 맥락 정책 리플레이 (B5)

결론: 저장된 역할·회의 제출 입력을 읽기만 해서, 후보 맥락 정책(P0~P4)마다 입력 토큰이 얼마나 줄고 근거(사실·출처·섹션)가 얼마나 남는지 비교표로 낸다. 모델은 부르지 않는다. 품질 영향을 재는 서버 평가는 계획만 적었고 `not_run`이다(대표 건별 승인 필요, 결정 5).

비유: 이삿짐을 줄이기 전에 상자마다 무게를 먼저 다는 일이다. 무엇을 빼면 얼마나 가벼워지는지(절약)와 꼭 필요한 물건이 상자에 남는지(보존)는 저울로 먼저 잰다. 실제로 짐을 빼고 살아 보는 일(서버 평가)은 승인을 받은 뒤에 한다.

- 성장 계획: B5 "맥락 선택 정책을 grade 모드와 서버 평가로 비교해 PR 4b 설계 근거로 넘긴다", 2단계 종료 조건 "맥락 정책 비교표를 `loop-10`·`ai-quality-9` 설계에 첨부"([GROWTH-PLAN](GROWTH-PLAN.ko.md)).
- 근거 finding: `ai-quality-9` 권고 (1) "모델 호출 없이 먼저 측정한다. 저장된 `hermes_submission.body`를 읽기 전용으로 조회해 JSON 최상위 키별 문자 수 분해표를 만든다. 이후 각 job에 inputChars 분해를 기록한다", (2)~(4) 메타 제거·섹션별 예산·회의 단계별 축소. `loop-10` 권고: 아카이브 revision마다 한 번 만드는 요약 digest(출처 ID 유지), 역할별로 필요한 카테고리만 넣기, 조립 뒤 문자/토큰 추정치로 상한을 넘으면 자료를 잘라 omitted 수 표시, 원장 연결로 역할별 입력 토큰 비교.
- 이 PR이 다루는 것: `ai-quality-9` (1) 앞부분(키별 분해)과 (2)~(4)(P1~P3), `loop-10`의 카테고리 선택(P4)·입력 상한(정책별 "상한 초과" 지표)·아카이브 비중(brandArchive 하위 키 분해). PR 4b로 넘기는 것: `ai-quality-9` (1) 후반 job별 inputChars 기록(쓰기 필요), `loop-10` digest 생성·저장(아래 "범위와 안전").
- 구현(채택한 정책을 운영 입력 조립에 반영)은 PR 4b가 한다. 이 PR은 분석 전용이다.

## 상태

| 검사 | 결과 |
|---|---|
| `tests/context-policies.test.mjs` | passed · mocked (167 검사, 합성 fixture, 모델·네트워크 호출 0회) |
| `tests/context-replay.test.mjs` | passed · mocked (43 검사, 합성 fixture, fetch 호출 0회 확인) |
| `tests/context-replay-route.test.mjs` | passed · mocked (52 검사, 실제 SQLite(node:sqlite)·실제 라우트, 권한·조회·문자 예산·원문 미포함·스크립트, fetch 0회) |
| 운영 데이터 리플레이 | not_run (소유자가 운영에서 GET으로 실행한다. 아래 "운영 실행") |
| grade 모드 산출물 재채점 | not_run (정책별 새 산출물이 없다. 입력측 `input_budget` 대응만 "상한 초과" 지표로 낸다. 아래 "grade 모드 대응") |
| 서버 평가(쌍 비교) | not_run (대표 건별 승인 전. 아래 "서버 평가 계획") |

## 범위와 안전

- 운영 제출 경로는 바꾸지 않는다. `lib/role-instruction.ts` `buildRoleInput`, `lib/meeting-execution.ts` `context()`, `lib/archive-server.ts`, `lib/role-output.ts`는 그대로다. 정책 함수는 저장된 입력 문자열을 받아 새 문자열을 계산할 뿐이다.
- 쓰기 없음, 스키마 변경 없음, 새 records kind 없음, 유료 모델·외부 API 호출 없음.
- 원문은 어떤 출력에도 넣지 않는다. 통계·비교표에 나오는 것은 형식 검사를 통과한 키 이름(`/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/`, 아니면 `(기타 키)`), 인덱스를 지운 경로(`previous[].content`), 역할 id·회의 단계 이름·계약 섹션 id, 수치와 개수뿐이다. 테스트가 입력의 20자 이상 문자열 조각이 통계 JSON·비교표에 없는지 확인한다.
- 조회 메모리: 서버는 SQL에서 저장 본문의 `input`만 꺼내고(지시문은 옮기지 않는다), 최신순으로 input 길이를 누적해 `MAX_TOTAL_CHARS`(8,000,000자)를 넘는 제출부터는 본문 없이 "문자 예산 초과"로 센다. 품질 단계 회의 입력은 1건에 10만~24만 자라 200건을 모두 올리면 Workers isolate 메모리(128MB)를 넘을 수 있기 때문이다. 손상된 data·본문은 `json_valid`로 걸러 쿼리 전체를 실패시키지 않는다.
- `loop-10` digest는 후보에 넣지 않았다. digest는 아카이브 revision마다 한 번 만들어 저장하는 요약이라 요약 생성(모델 호출이나 새 요약 규칙)과 저장(쓰기·새 기록 형식)이 필요하다. 이 PR은 모델 호출·쓰기·새 kind가 없는 분석 전용이다. 대신 digest 설계 입력으로 brandArchive 하위 키 분해(확정 자료 `confirmedSources` 비중 등)를 낸다. digest 생성·저장·조립은 PR 4b로 넘긴다.
- `ai-quality-9` 권고 (1) 후반 "각 job에 inputChars 분해 기록"은 쓰기가 필요해 PR 4b로 넘긴다. 기록 형식은 이 PR의 `breakdown()`(최상위 키별 `{chars, tokens}`)을 그대로 쓴다.

## 구성

| 파일 | 역할 |
|---|---|
| `lib/context-policies.ts` | 후보 정책(순수, 상대 import만). `CONTEXT_POLICIES`, `applyPolicy(id, submission)` → `{input, omitted, applicable}`, `headings`, `splitSections`, `sectionBudget`, `digestSections`, `ROLE_ARCHIVE_CATEGORIES`, `HANDOFF_SECTIONS`, `BUDGET_LISTS` |
| `lib/context-replay.ts` | 통계. `breakdown(input)`, `replay(submissions)` → `ReplaySummary`, `comparisonMarkdown(summary, {generatedAt})`. 토큰은 `lib/token-budget.ts` `estimateInputTokens`, 입력 상한은 `lib/graders/ledger.ts` `INPUT_TOKEN_CAP`을 그대로 쓴다 |
| `lib/context-replay-server.ts` | 서버 조회. 소유자 범위의 최근 `hermes_submission`(캠페인을 부모로 둔 역할·회의 제출)에서 SQL로 `input`만 읽기 전용으로 꺼내(문자 예산 `MAX_TOTAL_CHARS`) 종류·역할·단계를 정하고 위 함수에 넘긴다. 응답에는 통계만 싣는다 |
| `app/api/context-replay/route.ts` | 운영 GET(소유자·관리자만, 비로그인 401, 직원 403, 쓰기·잠금·모델 호출 없음). `limit`(1~200, 기본 50), `kind`(`role`·`meeting`·`all`, 기본 `all`), `format=markdown`이면 비교표 마크다운 첨부 |
| `scripts/eval/context-replay.mjs` | 비제품 경로. `node scripts/eval/context-replay.mjs <응답.json>` 또는 `--sqlite <로컬 D1 .sqlite> [--owner <워크스페이스>] [--limit 1~200] [--kind role\|meeting\|all]`로 같은 비교표를 표준 출력에 쓴다(네트워크 호출 없음) |

입력 한 건: `{kind: 'role' | 'meeting', role?, stage?, input}`. `input`은 `hermes_submission` 기록의 `body`(`{instructions, input, session_id, conversation_history}` JSON)에서 꺼낸 `input` 문자열이다. 역할은 `buildRoleInput`, 회의는 `meeting-execution.ts` `context()`가 만든 JSON 텍스트다. `role`이 없으면 `task.role`(역할 입력)이나 `role`(회의 입력)을, `stage`가 없으면 회의 입력의 `phase`를 쓴다. 역할·회의가 아닌 종류는 `skipped`로 세고 뺀다.

로더 주의: `lib/token-budget.ts`가 `./server`(`cloudflare:workers`)를 가져온다. vm으로 `lib/context-replay.ts`를 읽는 스크립트는 `cloudflare:workers`를 빈 env 모듈로 바꾸고 `TextEncoder`를 넣어야 한다(`tests/helpers/runtime.mjs` 방식). `lib/context-policies.ts`는 상대 import만 쓰므로 `scripts/eval/load-ts.mjs` 순수 로더로 읽힌다.

## 정책 정의

| 정책 | 이름 | 적용 대상 | 규칙 |
|---|---|---|---|
| P0 | 현행 | 모든 제출 | 항등. 결과가 원래 입력과 바이트 동일하다(캡처 스냅샷 16케이스로 고정) |
| P1 | 메타 제거 | JSON 입력 | `campaign`에서 `draftMeta`·`status`·`derivedStatus`·`statusReason`·`createdAt`·`updatedAt`·`budgetConfirmedAt`·`id`를 뺀다. 회의 `originalArtifacts`·`candidateArtifacts` 원소에서 `campaignId`·`status`·`origin`·`createdAt`·`factRefs`·`outputContractVersion`·`skillVersion`을 뺀다 |
| P2 | 섹션별 예산 | JSON 입력 | 지금 앞부분 절단을 받는 목록(`BUDGET_LISTS`: 역할 `previous` 6,000/24,000자, 회의 `originalArtifacts` 8,000자)의 `content`를 섹션마다 2,000자(`SECTION_BUDGET`)로 줄인다. 제목 줄은 남기고 잘린 곳에 ` …`를 붙인다. 줄인 원소의 `excerpt`가 있으면 `true`로 바꾼다. 품질 검수 대상 `candidateArtifacts`와 개선본 `completedRevisions`는 지금 절단되지 않고 줄이면 검수 범위가 좁아지므로 대상이 아니다 |
| P3 | 회의 단계별 축소 | 회의 의견 교환·품질 재검토 제출(단계를 알 때) | 의견 교환: `originalArtifacts`마다 요약(첫 본문 섹션, 1,000자)과 역할 계약의 인계 섹션(1,500자)만 본문을 남기고 나머지 섹션은 제목 줄만 남긴다. 품질 재검토: `candidateArtifacts`는 그대로, `originalArtifacts`는 `{ref, id, role, version, length}`만, `completedRevisions`는 `content`를 뺀다(`candidateArtifacts`와 같은 본문). 합의·개선 단계는 명세 범위 밖이라 해당 없음이다(합의는 acceptance에 완성본에서 확인할 위치를 써야 해 축소 위험이 다르다. 비교하려면 별도 후보로 나눈다) |
| P4 | 아카이브 카테고리 선택 | 역할을 알 때 | `brandArchive.confirmedSources`에서 역할에 필요한 카테고리만 남기고 뺀 수를 `omittedSources`에 더한다. 채널·성과 카테고리가 없는 역할은 `observations`를 빼고 `omittedObservations`에 더한다. 사실(`evidence`)은 건드리지 않는다 |

섹션: 코드 블록(```` ``` ````·`~~~`) 밖의 마크다운 제목으로 나눈다. 경계 수준은 제목이 2개 이상인 가장 얕은 수준이되, 역할 계약 제목 수준(`## `, `lib/role-output.ts` `parseRoleOutput`)보다 얕게 잡지 않는다. 그 수준 이하의 제목은 모두 경계다. 그래서 문서 제목 H1 하나, 본문 속 H1, 코드 블록 속 `# 주석` 줄이 계약 섹션을 한 섹션으로 뭉치지 않는다. 어느 수준도 제목이 2개 미만이면 모든 제목이 경계다. 첫 제목 앞 머리말은 제목 없는 섹션이다.

P3 요약은 첫 본문 섹션이다(그 앞의 제목만 있는 섹션, 예: 문서 제목 H1은 그대로 둔다). 인계 섹션은 역할 계약 섹션 id로 고정한다(`HANDOFF_SECTIONS`, 테스트가 계약 제목의 인계 낱말 `/인계|요청|자료\s?필요|미확정|다음 실험/`로 다시 계산해 대조한다).

| 역할 | 인계 섹션 | 계약 제목 |
|---|---|---|
| cmo | `output_3` | 최소 실행안/확장안과 예산 합계·확정/가정/미확정 목록 |
| insight | `output_3` | 우선 가설·반증 조건·최소 조사/실험·추가 자료 요청 |
| data | `output_4` | 결과 기록 양식과 다음 실험 연결 |
| strategy·creative·content·growth | 없음 | 계약에 다음 담당에게 넘기는 섹션이 없다. 요약만 남는다 |
| quality | 없음 | 품질 작업물은 계약 렌더링을 거치지 않는 자유 형식이다(`parseRoleOutput`이 quality는 원문 그대로 저장) |

7개 산출 역할 중 3개만 인계 섹션이 있고, 세 역할 모두 마지막 계약 섹션이다. `omitted[].reason`에는 인계 표시가 붙는다: 섹션 id(찾음), `<id> 미발견`(계약에는 있으나 본문에 그 제목이 없음, 예: 계약 제목을 쓰지 않은 회의 개선본), `없음`(계약에 인계 섹션이 없는 역할).

P4 역할별 카테고리(`lib/archive.ts` `archiveCategories`). 근거는 역할 계약 섹션 제목이다. 계약 제목의 채널→채널, 성과·매출·CPA→성과, 대상·고객→고객 카테고리는 반드시 남긴다(테스트가 확인한다). 미분류(`other`)는 역할을 판단할 수 없어 모든 역할에 남긴다. 알 수 없는 카테고리 값은 `other`로 본다.

| 역할 | 브랜드 | 제품·가격 | 고객 | 시장 | 채널 | 성과 | 운영 | 미분류 | 채널 관찰 | 근거(계약 섹션 → 카테고리) |
|---|---|---|---|---|---|---|---|---|---|---|
| cmo | ○ | ○ | ○ | ○ | | ○ | ○ | ○ | ○ | 목표 행동·주지표·성공/중단 조건, 예산 합계 → 고객·시장·성과·운영 |
| insight | ○ | ○ | ○ | ○ | | | | ○ | | 고객 상황·대안·장벽, 근거 표 → 고객·시장·제품 |
| strategy | ○ | ○ | ○ | ○ | ○ | | | ○ | ○ | 타깃→약속→증거 메시지, 채널 역할·랜딩/매장 연결 → 고객·제품·채널 |
| creative | ○ | ○ | ○ | | ○ | | | ○ | ○ | 콘셉트·증명 장면·제작 지시서 → 브랜드·제품·고객·채널 |
| content | ○ | ○ | | | ○ | | ○ | ○ | ○ | 게시 카피·랜딩 문안·제작 체크리스트 → 브랜드·제품·채널·운영 |
| growth | | ○ | ○ | | ○ | ○ | ○ | ○ | ○ | 채널별 대상·예산·UTM·허용 CPA·재고 수용량 → 고객·채널·성과·운영 |
| data | | | | | ○ | ○ | ○ | ○ | ○ | 지표 사전·A/B 계획·판단표 → 채널·성과·운영 |
| quality | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | 5개 기준 검수 → 전체 |

해당 없음(`applicable: false`, 입력 그대로): JSON 객체가 아닌 입력과 `JSON.stringify` 출력 그대로가 아닌 JSON(공백·이스케이프가 달라 재직렬화만으로 길이가 바뀐다)은 P1~P4 모두, 역할 제출·합의·개선 단계·알 수 없는 회의 단계는 P3, 알 수 없는 역할은 P4.

`omitted`: 정책이 뺀 것의 목록 `{path, chars, reason}`. `chars`는 그 경로에서 줄어든 직렬화 문자 수다. 한 정책의 `chars` 합은 원래 입력 길이 − 새 입력 길이와 정확히 같다(모든 fixture×정책에서 테스트). `reason`에는 코드 문구·역할 id·카테고리 id·수치만 들어간다.

## 지표

| 지표 | 정의 |
|---|---|
| 최상위 키별 분해 | `breakdown(input).byKey[키] = {chars, tokens}`. `"키":값` 조각의 문자 수와 추정 토큰이다. 조각 합 + 쉼표 + 중괄호 = 입력 길이. 비교표는 P0 기준 묶음 평균과 비중(묶음 입력 문자 합 대비)을 싣는다 |
| brandArchive 하위 키 분해 | `breakdown(input).archive[키]`. `confirmedSources`·`observations`·`storeMarketing`·`confirmedDiagnosis` 등 아카이브 하위 키 조각의 문자 수와 추정 토큰. 조각 합 + 쉼표 + 중괄호 = brandArchive 값 길이. 비교표는 전체·역할 전체·회의 전체 묶음의 평균과 비중(묶음 입력 문자 합 대비)을 싣는다. `loop-10` digest 설계 입력이다 |
| 추정 토큰 | `estimateInputTokens(input)` = max(⌈문자 수/2⌉, ⌈UTF-8 바이트/3⌉). 과대 쪽 추정이다. `input`만 센다. 지시문(instructions)과 HERMES 에이전트 자체 지시·도구 호출은 빠진다 |
| n · 해당 없음 | n은 그 정책을 적용할 수 있는 제출 수, 해당 없음은 묶음 표본 − n |
| 평균·중앙값 토큰 | 정책을 적용한 입력의 추정 토큰. n개만으로 계산하므로 n이 P0와 다르면 평균끼리 비교하지 않는다 |
| 절약 토큰 · 절약률 | 같은 제출끼리 잰 값: Σ(P0 토큰) − Σ(정책 토큰), 그리고 그 값 ÷ Σ(P0 토큰) |
| 사실 보존 | P0 입력의 `evidence.facts`(confirmed·prohibited·candidate) 항목 `버킷:키:범위` 중 정책 뒤에도 남은 비율 |
| 출처 보존 | P0 입력의 `brandArchive.confirmedSources[].id`·`observations[].id` 중 남은 비율 |
| 섹션 제목 보존 | 작업물(`previous`·`originalArtifacts`·`candidateArtifacts`·`completedRevisions`) 섹션 `ref#제목` 중 남은 비율. 섹션은 위 "섹션" 경계 기준이라 역할 계약 `## ` 제목을 모두 센다. 제목 없는 머리말·제목 없는 작업물은 `ref#(머리말)`, 같은 작업물 안에서 반복되는 제목은 `ref#제목#2`로 센다. `ref`가 없는 원소는 `artifactRef` 규칙(예: "콘텐츠 스튜디오 개선본")으로 이름을 붙여, 같은 작업물이 여러 목록에 있으면 한 번만 센다 |
| 빠진 섹션 | P0에서 본문이 있던 섹션 중 정책 뒤 본문이 사라진 섹션 수(제목만 남은 섹션 포함) |
| 본문 보존 | 작업물 목록 4개의 `content` 문자 합(정책 뒤 ÷ P0). 제목은 남고 본문만 줄어드는 손실(P2 예산, P3 요약, 제목 없는 긴 작업물)을 본다 |
| 상한 초과 | 정책 적용 뒤 추정 토큰이 `INPUT_TOKEN_CAP`(32,000, `lib/graders/ledger.ts`)을 넘는 제출 수. grade 모드 `input_budget` 판정의 입력측 대응이며 `loop-10`의 입력 상한 권고를 정책별로 본다. input만 세므로 실제 판정(제공자 보고 입력 토큰)보다 작게 나온다 |
| 절단된 선행 작업물 | P0 입력의 `previous`·`originalArtifacts`·`candidateArtifacts` 중 `excerpt: true`인 원소 수. 지금 앞부분 절단(역할 6,000자, 품질 24,000자, 회의 8,000자)이 얼마나 자주 일어나는지 보여 준다 |
| P2 절단 보정 | P2를 적용한 제출 중 P2 대상 작업물이 이미 잘린 제출 수, 잘린 문자 합(역할 `previous`의 `originalLength` − 저장 길이), 원래 길이를 모르는 작업물 수(회의 `originalArtifacts`), 운영 P2 절약 추정 하한(P2 절약 − 잘린 문자, 1자를 최대 1토큰으로 본다. 원래 길이를 모르는 작업물이 있으면 —) |
| 생략 경로 | 정책별 `omitted` 경로(인덱스를 `[]`로 바꿈)마다 건수와 문자 합 |

묶음: 전체, 역할 전체, 역할별(`role:<id>`, 모르는 역할은 `role:unknown`), 회의 전체, 회의 단계별(`meeting:<단계>`). 요약 JSON은 모든 키를, 비교표는 전체 묶음의 모든 키와 나머지 묶음의 상위 5개 키를 싣는다.

## 해석 규칙

- n<30인 묶음은 참고용이다([EVAL](EVAL.ko.md) 비교 통계 규칙 3). 리플레이는 결정론 계산이라 통계 검정 대상은 아니지만, 표본이 작으면 운영 분포를 대표하지 못한다.
- 절약률은 입력 추정 토큰 기준이다. 실제 사용량에는 HERMES 에이전트 자체 지시·도구 호출·출력이 더해진다. 실행당 약 20k 입력 토큰 중 에이전트 오버헤드 비율은 확인되지 않았다(`loop-10` verifyNote).
- P2 절약은 상한이다. 저장된 입력에는 이미 잘린 앞부분만 있어, 리플레이의 P2 토큰은 운영 P2 토큰 이하이고 절약률은 운영 이상이다. 운영 P2는 원문 전체에서 모든 섹션을 섹션당 2,000자로 넣으므로 긴 다섹션 작업물(예: `ai-quality-9`의 CMO 9,485자)에서는 입력이 오히려 늘 수 있다. 비교표의 "P2 절단 입력 보정" 표로 절단 입력 포함 제출 수와 운영 P2 절약 추정 구간 [하한, 상한]을 함께 본다. 잘린 제출에서는 섹션 제목 보존이 구조상 100%라 P2가 되살리는 인계 섹션 수는 PR 4b 조립 단계에서 원본 작업물로 잰다. 여러 섹션의 긴 작업물에서 앞부분 6,000자 절단이 뒤 섹션을 잃고 섹션 예산은 모든 제목을 남기는지는 테스트가 고정한다.
- P3 품질 재검토 단계의 섹션 손실은 개선본으로 대체됐거나 무효가 된 원본 버전의 섹션이다. 의도한 축소다. 의견 교환 단계의 "빠진 섹션"은 요약·인계 밖에서 제목만 남기고 본문을 뺀 섹션이다. 인계 섹션이 없는 역할은 요약만 남는다는 점을 함께 본다.
- 상한 초과가 P0에서 0이 아니면 그 제출은 지금도 grade 모드 `input_budget`(입력측)에 걸린다. 정책이 그 수를 줄이는지가 `loop-10` 입력 상한 권고의 효과다.
- P4의 출처 보존 감소는 역할별로 뺀 카테고리 자료다. 뺀 자료가 그 역할의 판단에 필요했는지는 리플레이로 알 수 없고 서버 평가로만 판단한다.
- 보존 지표는 식별자·제목이 남았는지만 본다. 채택 판단은 절약률만으로 하지 않는다.

## 합성 fixture 측정 예 (mocked)

`tests/fixtures/role-submission-fc8eb5c.json` 16케이스와 테스트의 합성 회의 입력 4단계, P4용 합성 아카이브 1건(자료 5·관찰 2)으로 계산한 값이다. 회의 입력은 `context()`의 키를 모두 갖춘다(`previousMeeting`, 완료된 `discussion` 발언, 개선·품질 단계의 `synthesis`). 합성 자료는 아카이브가 작고 작업물이 짧아 운영 비율을 대표하지 않는다. 계산 방법이 동작함을 보이는 예로만 쓴다.

| 묶음 | P1 절약률 | P2 절약률 | P3 절약률 | P4 절약률 | 비고 |
|---|---:|---:|---:|---:|---|
| 역할 전체(n=17) | 0.7% | 32.6%(상한) | 해당 없음 | 0.6% | P2 절약 대부분은 24,100자·6,100자 합성 선행 작업물이 든 절단 케이스 2건(strategy-truncated, quality-truncated)에서 나온다. 잘린 문자 18,300자로 잡은 운영 P2 절약 추정 하한은 8,423토큰(10.3%)이고, strategy-truncated만 보면 −11,932토큰(입력 증가)이다. P2 본문 보존 45.5%, P4 출처 보존 78.3% |
| 회의 전체(n=4) | 13.6% | 0.0% | 34.0% | 0.0% | P3는 의견 교환·품질 재검토 2건에만 적용(합의·개선 해당 없음). P3 섹션 제목 보존 76.0%, 빠진 섹션 26, 본문 보존 42.3% |
| 회의 · 의견 교환(n=1) | 14.1% | 0.0% | 20.2% | 0.0% | 제목 보존 100%, 빠진 섹션 14(요약·인계 밖), 본문 보존 54.9% |
| 회의 · 품질 재검토(n=1) | 14.4% | 0.0% | 43.1% | 0.0% | P3 섹션 제목 보존 53.8%(교체·무효 원본 버전), 빠진 섹션 12 |

최상위 키 비중(P0, 합성): 역할은 `previous` 56.5%, `brandArchive` 8.3%, `task` 7.4%, `campaign` 6.6%. 회의는 `originalArtifacts` 56.5%, `discussion` 8.0%, `candidateArtifacts` 7.9%, `previousMeeting` 5.6%. brandArchive 하위 키는 역할에서 `confirmedSources` 4.4%, `notice` 1.6%. 상한 초과는 모든 정책에서 0건이다. 운영 비율은 운영 리플레이로 다시 잰다.

## 운영 실행 (소유자)

1. 소유자(또는 관리자) 계정으로 `GET /api/context-replay?limit=200&kind=all`을 부른다. 서버가 최근 `hermes_submission`(기본 50건, 최대 200건)을 읽기만 하고 통계만 돌려준다. 원문·제출 id·지시문은 응답에 없다. input 문자 합이 8,000,000자를 넘으면 오래된 제출부터 본문을 옮기지 않고 `read.overBudget`("문자 예산 초과")으로 센다. 그 수가 0이 아니면 `kind=role`·`kind=meeting`으로 나눠 부르거나 `limit`을 줄여 표본을 다시 받는다.
2. `&format=markdown`으로 받은 비교표를 `ai-quality-9`·`loop-10` 설계(PR 4b 계획)에 붙인다. 이것이 2단계 종료 조건의 "맥락 정책 비교표 첨부"다. 붙일 때 생성 시각·표본 수·근거 어휘(`real`: 운영 D1 저장 입력, 모델 호출 없음)를 함께 적는다.
3. 오프라인 재계산이 필요하면 받은 JSON이나 로컬 D1 sqlite 파일을 `scripts/eval/context-replay.mjs`에 넣는다(네트워크 호출 없음).
4. 저장 입력은 제출 시점의 스냅샷이다. 표본 기간(가장 오래된·최근 제출 시각)을 함께 기록한다.

## grade 모드 대응

성장 계획 B5는 맥락 정책을 grade 모드와 서버 평가로 비교하라고 한다. grade 모드(F1a, `scripts/eval/grade.mjs`)는 저장된 산출물을 토큰 0으로 재채점한다. 맥락 정책은 입력만 바꾸므로, 정책별 새 산출물이 없으면 산출물 채점기(재질문·내부 ID·사실 충돌 등)는 돌릴 대상이 없다. 새 산출물은 모델 호출이 필요해 서버 평가의 몫이다.

- 지금 하는 것: 입력만으로 판정하는 채점기 `input_budget`을 정책별로 재현한다. 비교표의 "상한 초과"가 정책 적용 뒤 추정 토큰 > `INPUT_TOKEN_CAP`(32,000) 제출 수다. 상한 값은 `lib/graders/ledger.ts`에서 import해 grade 모드와 같게 둔다.
- 하지 않는 것(`not_run`): 정책별 산출물 재채점. 서버 평가 run이 만든 후보·active 산출물에 grade 모드를 돌려 실패 유형 수를 비교하는 것은 아래 서버 평가 계획에 포함한다.

## 서버 평가 계획 (not_run)

결론: 리플레이로 고른 역할 정책 후보 2개를 F3b 쌍 평가 구조(같은 run 안에서 케이스마다 active와 후보를 번갈아 제출, 같은 채점기)로 비교한다. 실행에는 평가 하네스 확장과 대표 승인이 필요하다. 이 PR은 코드로 평가를 호출하지 않는다.

- 대응 구조: F3b `pair`는 지금 프롬프트 단위 후보(`RoleRequest.prompts`)만 바꾼다([EVAL](EVAL.ko.md) 5절). 맥락 정책 비교는 지시문은 같게 두고 입력만 바꾼다. active 쪽은 `buildRoleInput(request)`, 후보 쪽은 `applyPolicy(<정책>, {kind:'role', role, input: buildRoleInput(request)}).input`이다. 결과 행·순서 교대·멱등 키·게이트웨이 해시·`pairGate` 판정은 F3b 규칙을 그대로 쓴다.
- 필요한 확장(이 PR 범위 밖, 레인 A 소유): `lib/eval-server.ts` 쌍 평가에 맥락 정책 후보(`pair.contextPolicy` 같은 필드)를 받는 분기. 정책 id와 omitted 요약을 run에 고정한다. 확장 PR이 따로 필요하다.
- 대상: 역할 정책만 가능하다. 평가 케이스(`eval_case`)는 역할 요청(`RoleRequest`)만 동결하므로 회의 단계 정책 P3은 서버 평가로 비교할 수 없다. P3은 리플레이 수치와 PR 4b의 모의 테스트로만 판단하고, 회의 평가 케이스가 생기면 다시 계획한다.
- 후보 선택: 운영 리플레이에서 절약률이 크고 보존 지표 손실이 작은 역할 정책 2개(P1은 위험이 낮아 P2 또는 P4와 함께 고르는 것을 기본으로 한다). 봉인 케이스를 1건 이상 넣는다(게이트 조건).
- 규모와 예산(결정 5, B5 리플레이 약 0.7M은 대표 건별 승인):

| 항목 | 값 | 근거 |
|---|---|---|
| 실행 1회 토큰 | 23,216 | 운영 역할 실행 1건 입력 19,181 + 출력 4,035 (`docs/releases/2026-09-23-a67a318.md` 30행) |
| 구성 | 후보 2개 × 케이스 7개 × 두 쪽 = 제출 28회 | 0.7M 안에 들어가는 최대 제출 수는 30회 |
| 예상 사용 | 약 650,000 tokens | 28 × 23,216 = 650,048 |
| run별 `tokenBudget` | 352,000 | 마지막 제출 직전 검사(보고 13회 301,808 + 예약 50,000 = 351,808)를 통과해야 두 쪽이 모두 끝난다 |
| 승인 요청 상한 | 704,000 tokens | run 2개 × 352,000 |
| 월 상한과의 관계 | 1.5M 중 나머지 약 850,000 | 1,500,000 − 650,048 = 849,952. 같은 달 다른 평가와 합산해 확인한다 |

- 판정: 쌍 수가 30 미만이므로 결론은 `non_regression` 또는 `insufficient`만 쓴다. "개선"은 주장하지 않는다(EVAL 비교 통계 규칙 3·6). 게이트는 `pairGate`(합격 수 후보 ≥ active, 봉인 회귀 0, `input_budget` 후보 전부 pass, 모델·게이트웨이 동일, 전 케이스 두 쪽 완료)를 그대로 쓴다.
- 중단: 예산·월 상한·사용량 미보고로 멈추면 남은 케이스는 `not_run`이고 그 run은 게이트를 통과하지 못한다. 재실행은 새 승인으로 한다.
- 실행 전 확인: 평가 전용 HERMES 연결 격리 확인(결정 6), 운영 호스트와 다른지, 같은 달 평가 누적.

## PR 4b에 넘길 설계 근거 형식

비교표를 붙일 때 정책마다 아래 형식으로 요약한다. 수치는 비교표에서 옮기고 원문은 넣지 않는다.

```md
### 맥락 정책 설계 근거 — <P1~P4> <이름>
- 대상 finding: ai-quality-9 권고 (<번호>) / loop-10
- 리플레이: 제출 <N>건(역할 <a> · 회의 <b>), 제출 기간 <UTC 시작>~<UTC 끝>, 생성 <generatedAt>, 근거 real(운영 D1 저장 입력, 모델 호출 0회)
- 절약: <묶음>별 절약 토큰 <합> · 절약률 <%> (추정 토큰, input만)
- 보존: 사실 <%> · 출처 <%> · 섹션 제목 <%> · 빠진 섹션 <수>
- 본문 보존: <%> (작업물 content 문자 합)
- 상한 초과: P0 <수>건 → 정책 <수>건 (INPUT_TOKEN_CAP 32,000, 추정 토큰·input만)
- 절단된 선행 작업물: <수>건. P2만: 절단 입력 포함 제출 <수>건, 운영 P2 절약 추정 구간 [<하한>, <상한>] 토큰
- 아카이브: brandArchive 하위 키 비중 confirmedSources <%> · observations <%> · storeMarketing <%> (digest 설계 입력)
- 서버 평가: not_run(사유) | pair run <id> · 세트 <dev/sealed> · n <쌍 수> · b <수> · c <수> · p <값> · 판정 <non_regression/insufficient> · 게이트 <통과/거부 사유>
- grade 모드: 입력측 input_budget(상한 초과)만 | 서버 평가 산출물 재채점 결과
- 권고: 채택 | 보류 | 기각 — <이유 한 줄>
- 구현 위치: <lib/role-instruction.ts buildRoleInput | lib/meeting-execution.ts context() | lib/archive-server.ts brandArchiveContext | lib/role-output.ts upstreamContext>
- 영향 테스트: tests/fixtures/role-submission-<sha7>.json 재캡처(바이트 동일성 스냅샷), tests/role-execution-drift.test.mjs
- 되돌리기: <기능 스위치 이름 또는 revert 대상>
- 남은 위험: <예: 뺀 카테고리 자료가 필요한 캠페인 유형>
```

모든 요약 뒤에 PR 4b가 구현할 후속을 한 번 적는다.

```md
### 후속(PR 4b 구현)
- ai-quality-9 권고 (1) 후반: job별 inputChars(최상위 키별) 기록 — 이 PR의 breakdown() 형식({키: {chars, tokens}}) 재사용
- loop-10 digest: 아카이브 revision별 요약 digest(출처 ID 유지) 생성·저장·조립 — 이 PR의 brandArchive 하위 키 분해를 설계 입력으로 쓴다
- loop-10 입력 상한: 조립 뒤 추정치가 INPUT_TOKEN_CAP을 넘으면 자료를 잘라 omitted 수 표시 — 이 PR의 상한 초과 수를 기준선으로 쓴다
```

## 한계

- 회의 입력은 `meeting-execution.ts` `context()`가 export되지 않아 테스트에서 같은 키·순서의 합성 입력으로 만든다. `tests/context-policies.test.mjs`가 `context()` 반환 객체의 최상위 키(조건부 스프레드 포함)를 TypeScript 구문 트리로 읽어, 키가 늘거나 빠지거나 순서가 바뀌면 실패한다.
- P3 인계 섹션은 역할 계약 섹션 id로 고정했다. 7개 산출 역할 중 cmo·insight·data만 인계 섹션이 있고, strategy·creative·content·growth와 자유 형식 작업물(회의 개선본, 품질 작업물)은 요약만 남는다. 개선본이 계약 제목을 쓰지 않으면 인계 섹션을 찾지 못한다(`미발견`).
- P2 절약은 저장 입력 기준 상한이다. 회의 `originalArtifacts`는 원래 길이가 입력에 없어 추정 하한도 낼 수 없다.
- `loop-10` digest는 후보에 없다(생성·저장이 필요해 PR 4b로 넘긴다).
- P4 카테고리표는 후보다. 자료 분류(`classifySource`)가 틀리면 필요한 자료가 빠질 수 있다.
- 토큰은 추정치다. 실제 사용량 비교는 서버 평가나 사용량 원장(`provider_usage`)으로 한다.
- 이 문서의 수치 예는 합성 fixture이며 `mocked`다. 운영 판단에는 운영 리플레이 수치를 쓴다.
