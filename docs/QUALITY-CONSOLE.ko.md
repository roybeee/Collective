# 품질 콘솔·주간 다이제스트·판정 보정 (B2 1단계)

AI 작업물 품질을 LLM 없이 센다. 역할×스킬·프롬프트 버전×보고 모델마다 1차 승인율, 사람 판정 사유, 폐기 토큰, 회의 완주율, 온라인 채점 결과, 규제 보류를 집계한다. 사람의 기준별 판정으로 AI 품질 검수의 일치도(Cohen's κ)를 잰다.
모델(HERMES·OpenAI)과 외부 API는 호출하지 않는다. 집계는 순수 함수이고, 서버는 D1을 읽기만 하며 쓰지 않는다. **자동 판정이 아니다.** 숫자는 사람이 판단할 때 참고하는 기록일 뿐이고, 작업물을 합격·불합격 처리하지 않는다.

| 층 | 파일 |
|---|---|
| 순수 집계 | `lib/quality-console.ts` `consoleSummary(input,{from,to})` |
| 판정 보정 | `lib/quality-kappa.ts` `cohenKappa`·`criterionKappa`·`unitsFromDecisions` |
| 주간 다이제스트 | `lib/quality-digest.ts` `weeklyPayload`·`weeklyDigest`·`digestMarkdown` |
| 서버 조회·API | `lib/quality-console-server.ts`, `GET /api/quality-console`(소유자·관리자) |
| 로컬 스크립트 | `scripts/quality-digest.mjs`(네트워크 없음) |
| 테스트 | `tests/quality-console.test.mjs`·`tests/quality-kappa.test.mjs`·`tests/quality-digest.test.mjs`·`tests/quality-console-route.test.mjs` |

정의는 되도록 기존 것을 가져다 쓴다. 새로 만든 정의는 아래 표에 근거와 함께 따로 적는다.

## 입력

`ConsoleInput`의 각 필드는 D1 레코드를 모양 그대로 담은 배열이다. 서버는 필요한 필드만 골라 읽어도 된다. 작업물 본문(`content`)은 재질문 판정에만 쓴다. `isQuestionOnly`는 2,500자를 넘는 본문을 재질문으로 보지 않으므로, 그보다 긴 본문은 빈 문자열로 넘겨도 결과가 같다.

| 필드 | 레코드 | 쓰는 값 |
|---|---|---|
| `artifacts` | `artifact`(현재 판) | `id`·`role`·`status`·`version`·`origin`·`createdAt`·`skillVersion`·`promptVersion`(F3a)·`meetingId`·`aiSource.version`·`aiSource.skillVersion`·`complianceHold.checkedAt`·`content` |
| `history`(선택) | `history`(이전 판) | `originalId`(작업물 id)와 위 필드(본문 제외). 새 판 저장(`save_artifact`)·회의 개선·outdated 처리 때 남긴 복사본이다 |
| `decisions` | `review_decision`(B1). **기록 순서(rowid)대로** | 판정 전체(1차 승인율·사유·수정 요청·κ 단위) |
| `usage` | `provider_usage`(F2a 조인 키 포함) | 토큰, `model`, `observedAt`, `domainOutcome`, `jobId`·`kind`·`role`·`artifactId`·`promptVersion`·`providerRunId` |
| `meetings` | `team_meeting` | `id`·`status`·`createdAt` |
| `gradings` | `grading`(F2b) | `artifactId`·`artifactVersion`·`jobId`·`role`·`status`·`graders[].status`·`gradedAt` |
| `jobs`(선택) | `jobs` 표 행 | `id`·`role`·`provider_id`(또는 `providerId`). 조인 키가 없는 F2a 이전 사용량을 실행 번호로 잇는다 |

## 기간과 주

- `from`·`to`가 한국 시간 날짜(`YYYY-MM-DD`)면 양 끝을 모두 포함한다. ISO 시각이면 `from`은 포함하고 `to`는 포함하지 않는다. 잘못된 기간이나 `from ≥ to`는 `RangeError('기간(from·to)을 확인하세요.')`다.
- 각 사건은 그 사건의 시각으로 기간에 들어간다. 작업물은 판(작업물 id·버전)마다 그 판의 `createdAt`(사람이 고친 판은 고친 시각, 회의 개선본은 회의가 저장한 시각), 판정은 `createdAt`, 사용량은 `observedAt`, 채점은 `gradedAt`, 규제 보류는 판마다 `complianceHold.checkedAt`(없으면 그 판 `createdAt`), 회의는 시작 시각(`createdAt`)을 쓴다.
- 판은 현재 작업물 레코드와 이력(`history`)의 이전 판을 (작업물 id, 버전)마다 하나로 모은 것이다. 같은 판이 둘 다 있으면 현재 레코드를 쓴다. 그래서 사람이 새 판을 저장해 보류가 풀리거나 작성 시각이 바뀌어도 지난 주에 센 AI 작업물·규제 보류는 그대로다.
- 주는 ISO 주다. 월요일 00:00(KST)부터 다음 월요일 00:00(KST) 전까지이고, 이름은 `2026-W39` 꼴이다(`isoWeekOf`·`weekRange`·`previousWeek`). 존재하지 않는 주(W00, W54, 그해에 없는 W53)는 `weekRange`가 `null`을 돌려준다.
- 주간 추이(`weeks`)는 기간과 겹치는 주마다 같은 집계를 낸 것이다. 양 끝의 주는 기간 안에 든 부분만 센다.

## 행: 역할 × 스킬 버전 × 프롬프트 버전 × 보고 모델

행 키는 `[role, skillVersion, promptVersion, reportedModel]`이다. 판정·채점·작업물은 판(작업물 id·버전) 기준으로 키를 정한다. 회의 개선은 역할 작업물 id를 재사용해 새 판(버전+1, `origin` `ai`, `meetingId`)을 쓰고(`lib/meeting-execution.ts`), 역할 실행은 항상 1판이다(`lib/role-execution.ts`). 그래서 같은 작업물 id라도 역할 실행 판과 회의 판은 다른 행에 들어갈 수 있다.

| 열 | 정하는 법 |
|---|---|
| 역할 | 작업물 `role`. 판정은 B1 `role`. 작업물과 잇지 못한 사용량은 `usage.role`, 그것도 없으면 `jobs.role` |
| 프롬프트 버전 | 프롬프트 레지스트리(F3a) 버전(`role.<역할>@<sha12>+channel.<채널>@<sha12>`, `@` 포함)이면 그 값, 코드 상수 실행(`<스킬 버전>:<지시 해시>`·`inline:`)이면 없음(화면 '코드 상수')이다. 값은 판의 AI 원본 판 `promptVersion`(F3a가 역할·회의 작업물에 남긴다) → B1 판정 `promptVersion` → 사용량 `promptVersion`(회의 판은 그 회의·역할 사용량, 그 밖은 역할 실행 사용량) 순서로 찾는다. 사용량 행은 자기 `promptVersion`이다 |
| 스킬 버전 | B1과 같은 기준이다. AI 판은 작업물 `skillVersion`, 사람이 고친 판(`ai_edited`)은 AI 원본의 `aiSource.skillVersion`, 판정은 B1 `skillVersion`, 역할 실행 사용량은 그 1판의 스킬 버전을 쓴다. 이 값이 없으면 사용량 `promptVersion`의 앞부분을 쓴다(`inline:`은 없음으로 본다). **레지스트리 실행 행은 스킬 버전 칸을 비운다(—).** 사용량 원장에는 레지스트리 실행의 스킬 버전이 남지 않아(F3a `promptVersion`이 대신한다), 넣으면 같은 실행이 작업물·판정 행과 사용량 행으로 갈라지기 때문이다 |
| 보고 모델 | 공급자가 보고한 `usage.model`. 회의가 쓴 판(AI 원본 판에 `meetingId`)은 그 회의·역할의 사용량을 먼저 본다. 그 밖(역할 실행 1판과 그 사람 수정본)은 작업물 사용량(`artifactId`)을 먼저 본다. 다음은 채점 기록의 `jobId`나 `jobs.provider_id`다. 찾지 못하면 '미확인'이다. `hermes-agent` 별칭은 '실제 모델 미확인'으로 표시한다 |

직접 작성한 작업물(`manual`)과 그 판정은 어느 행에도 들어가지 않는다. 사유 분포와 판정 수에는 포함된다.
행에는 그 행 사용량의 원래 `promptVersions` 목록도 붙는다. 1차 승인율 표(`firstPass`)는 B1 `firstPassApproval` 그대로 역할×스킬 버전이다.

## 지표 정의

| 지표 | 정의 | 근거 |
|---|---|---|
| AI 작업물(이전 버전 포함) | 기간 안에 만든 AI 작업물 판 수(`origin` `ai`·`ai_edited`). 이전 판(`history`)과 outdated 판도 센다 | **새 정의**. 대시보드 '작업물'과 다르다(아래 대응표) |
| 1차 승인율 | B1 `firstPassApproval` 그대로. 대상마다 **전체 기록에서** 첫 작업물 판정을 찾고, 그 판정이 기간 안에 있을 때만 센다. 분모 `n`에는 AI 작업물(`ai`·`ai_edited`)의 첫 판정이 들어가고, `approvedFirst`는 사람이 고치지 않은 AI 판의 첫 판정이 `approved`인 수다. `editedFirst`(사람이 먼저 고친 판)는 분모에만 들어간다 | B1 재사용. 전체 기간에서 역할×스킬 버전 수치가 `firstPassApprovalRates`와 같다(교차 테스트) |
| 수정 요청·사유 | 기간 안의 AI 작업물 판정 중 `revision` 수, 그리고 사유 코드별 건수(판정 1건에 코드마다 1) | B1 `REVIEW_REASONS` 10코드 |
| 사유 분포(전체) | 기간 안의 모든 판정(작업물·브리프 제안·자료·발행)을 사유 코드×대상별로 센다 | B1 |
| 폐기 토큰 | 쓰이지 않은 AI 실행의 토큰. 아래 우선순위로 사용량 1건에 사유를 하나만 붙인다 | **새 정의**(아래) |
| 미연결 토큰 | 작업물·회의와 잇지 못해 폐기 여부를 판단할 수 없는 사용량의 토큰 | **새 정의**(아래) |
| 토큰 수 | `totalTokens`를 쓰고, 없으면 입력+출력을 쓴다. 둘 다 모르면 0으로 채우지 않고 `unknownTokenRuns`로 따로 센다 | 토큰 예산 누계 규칙(`docs/RELIABILITY.ko.md` 토큰 예산) |
| 다른 실행 종류 | 브리프·조사·학습 사용량의 토큰(`otherKindTokens`). 역할 행에는 넣지 않는다 | F2a `kind` |
| 채점 | `grading`의 `graded`·`grader_error`·`not_run` 건수와 실패 채점기 수(채점기 결과 중 `fail`·`grader_error`). 자주 실패한 채점기 id 목록도 낸다 | F2b `campaignGradings`의 `failed`와 같은 기준 |
| 규제 보류 | `complianceHold`가 있는 판 수(이전 판 포함, 점검 시각 기준) | A2 |
| 회의 완주율 | 기간 안에 시작한 회의 중 `completed` 비율. 실패·취소·진행 중(`running`·`uncertain`)은 따로 센다. 진행 중인 회의도 분모에 남는다 | **새 정의**(시작 대비 완료) |

### 폐기 토큰 (새 정의)

역할 실행 사용량은 F2a 조인 키 `artifactId`로 작업물과 잇는다. F2a가 `jobId`에서 만든 값이다(`ai-<sha256(jobId) 앞 32자>`). 이 키가 없으면 채점 기록의 `jobId`로, F2a 이전 행은 `jobs.provider_id` = `providerRunId`로 이어 본다. 역할 실행은 그 작업물의 1판을 만든다. 회의가 같은 id에 쓴 뒤 판(개선본)의 판정·본문으로 역할 실행 토큰을 폐기로 세지 않도록, 사유는 1판 기준으로 정한다. 우선순위는 다음과 같다.

1. `invalid_output`: 사용량 `domainOutcome`이 `invalid_output`이다(형식 오류로 작업물을 저장하지 않음). 잇지 않아도 판정할 수 있다.
2. `question_only`: 현재 레코드가 그 1판(사람·회의가 바꾸지 않은 AI 판)이고 본문이 재질문뿐이다(`isQuestionOnly`).
3. `revision`: 1판(`origin ai`)에 `revision` 판정이 있고, 그 뒤 같은 판에 `approved`가 없다. B1 이전 기록은 현재 레코드가 1판이고 상태가 `revision`인 경우로 본다.
4. `outdated`: 이은 작업물의 현재 상태가 `outdated`다(사용량 화면 `superseded` `outdated`와 같은 조건).

회의 사용량은 발언·합의·개선·검수 단계가 같은 `jobId`와 역할을 함께 쓴다. 그래서 작업물 단위로 나눌 수 없고, 폐기로는 `invalid_output`만 센다.

### 미연결 토큰 (새 정의)

- 역할 실행(또는 종류를 모르는 F2a 이전 행)인데 작업물을 찾지 못했다. 캠페인이 지워졌거나 조인 키가 없는 경우다. 단 `provider_failed`·`cancelled`·`storage_failed`는 원래 작업물이 없으므로 미연결로 세지 않는다.
- 회의 사용량인데 그 회의 레코드가 없다.
- 역할을 전혀 알 수 없는 행은 어느 행에도 넣지 않고 합계(`totals.unlinkedTokens`)에만 넣는다.

### 워크스페이스 숫자와의 대응 (`lib/workspace-metrics.ts`, data-truth-9)

같은 이름이 다른 정의로 쓰이지 않도록 대응을 적는다. 교차 테스트(`tests/quality-console.test.mjs` 6-5)가 재질문 판정이 같음을 고정한다.

| 콘솔 | 워크스페이스 | 관계 |
|---|---|---|
| 폐기 사유 `question_only`(재질문만 남김) | `needsWorkArtifacts`의 재질문(`artifactUsable`이 거르는 것) | 같은 `isQuestionOnly`(`lib/role-output.ts`). 2,500자를 넘는 본문은 둘 다 재질문이 아니다 |
| AI 작업물(이전 버전 포함) | 대시보드·사이드바 '작업물'(`status`가 outdated가 아닌 현재 작업물) | 다르다. 콘솔은 기간 안에 만든 AI 판(ai·ai_edited)을 이전 판·outdated까지 세고, 직접 작성(manual)은 뺀다 |
| 수정 요청(행) | '보완 필요'(`needsWorkArtifacts`) | 다르다. 콘솔은 기간 안의 사람 `revision` 판정 수이고, 워크스페이스는 지금 revision이거나 쓸 수 없는 review 작업물 수다 |
| 전체 캠페인 | 샘플 캠페인(`sampleCampaignIds`) 제외 | 콘솔은 캠페인을 따로 거르지 않는다. 샘플 캠페인은 AI 실행 전에는 AI 작업물·판정·사용량이 없어 숫자에 들어오지 않고, 실행하면 실제 캠페인으로 센다(워크스페이스와 같은 전환) |

### 사후 변동 (한계)

- 판정·사용량·채점 시각, 판별 작성 시각·규제 보류는 기록이 남아 지난 주 수치가 바뀌지 않는다.
- 폐기 사유(`outdated`·`revision`·`question_only`)는 작업물의 **현재** 상태와 그 뒤 판정으로 정한다. 그래서 지난 주 실행이 이번 주에 outdated가 되거나 수정 요청을 받으면 지난 주 폐기 토큰이 늘 수 있다. 다이제스트의 '전주' 열은 다이제스트를 만든 시점에 다시 계산한 값이다.
- 이력(`history`)을 남기지 않던 과거 경로로 덮어쓴 판은 되살릴 수 없다.

## 표본 규칙

- 비율(1차 승인율·회의 완주율·κ 일치율)은 표본이 `MIN_SAMPLE` = 5건 미만이면 `null`이다. 화면과 다이제스트에는 '표본 부족 (n=3)'처럼 표시한다. 표본 수 `n`은 비율과 항상 같이 낸다.
- κ는 기준별 라벨이 `MIN_KAPPA_N` = 20건 미만이면 내지 않는다. 이때는 '보정 불가(표본 부족, N건 더 필요)'로 표시한다.

## 판정 보정 κ

- 단위: B1 `criterionUnits`와 같이 (작업물 id·버전, 기준)이다. 5기준은 `lib/quality.ts` `qualityCriteria`의 근거·브랜드·상품·제작·실행·예산·운영·측정·실험이다. `unitsFromDecisions(decisions)`는 판정 로그에서 같은 단위를 같은 순서로 만든다(실제 SQLite로 대조하는 테스트가 있다). 같은 단위를 두 번 이상 판정했으면 기록 순서상 마지막 판정만 쓴다.
- 짝: 사람 판정(`pass`·`revise`)과 판정 시점의 AI 검수 상태(`pass`·`revise`·`needs_data`)를 짝짓는다. **기본 κ·일치율·표는 원 범주(2×3)다.** 사람 라벨에는 `needs_data`가 없으므로(B1 `criteriaProblem`) AI의 `needs_data`는 늘 불일치로 센다. `needs_data`를 `revise`로 묶은 값은 보조 값 `kappaCollapsed`·`agreementCollapsed`(화면·다이제스트 '묶은 κ')로만 낸다. AI가 `needs_data`로 둔 건수는 `aiNeedsData`로 따로 낸다. AI 상태가 없던 단위(`ai: null`)는 짝에서 빼고 `missingAi`로 센다.
- 계산: `cohenKappa(pairs)`. κ = (po − pe) / (1 − pe)이고 po는 일치 비율, pe = Σ_k p_사람(k)·p_AI(k)다. 범주는 두 평가자가 쓴 값의 합집합이다(2×2 이상, 한쪽만 쓴 범주도 된다). 전체에 범주가 하나뿐이면 pe = 1이라 κ를 정의할 수 없다. 이때 결과는 `single_category`이고 일치율만 낸다. 쌍이 없으면 `no_data`다. 교과서 예시(20/5/10/15 → 0.4, 3×3 → 29/59 등)로 값을 고정했다.
- 상태(`criterionKappa`): `no_data`(라벨 0), `insufficient`(n < 20), `single_category`, `ok`(원 범주 기준). 기준마다 2×3 표(사람 pass·revise × AI pass·revise·needs_data), `needed`(20까지 남은 라벨 수)를 함께 낸다. 묶은 κ는 n ≥ 20이고 정의될 때만 값이 있다.
- 해석(`kappaBand`, Landis & Koch 1977 관례): 0 미만 '우연보다 낮은 일치', 0.20 이하 '미미한 일치', 0.40 이하 '약한 일치', 0.60 이하 '보통 일치', 0.80 이하 '상당한 일치', 그 위 '거의 완전한 일치'. 보정할 때 참고하는 표현이며 합격 기준이나 자동화 기준이 아니다. `ai-quality-7` 자동화 범위를 정할 때는 κ와 n을 함께 근거로 본다.
- 범위: 콘솔 화면은 조회 기간 안의 라벨로 계산한다(상한 안에서 읽은 판정에서 만든다). 주간 다이제스트는 **주 끝까지 누적한** 라벨로 계산한다. 라벨이 적어서 주 단위로는 거의 항상 표본 부족이기 때문이다. 서버는 누적 라벨도 기준별 판정(`criteria`가 있는 작업물 판정) 최근 5,000건까지만 읽고, 넘으면 `partial`에 `units`를 남긴다.

## 주간 다이제스트

`weeklyPayload(input, week, units?)`는 그 주 요약, 전주 요약, 주 끝까지 누적한 κ를 담은 `{week,summary,previous,kappa}`를 만든다. `units`를 넘기면(서버가 B1 `criterionUnits`로 읽은 누적 라벨) 그것을 쓰고, 넘기지 않으면 `input.decisions`에서 만든다. `weeklyDigest(summary,kappa,{week,previous?,campaignId?,partial?})`와 `digestMarkdown(payload)`가 한국어 마크다운을 만든다.

- 머리말: 기간(KST), 비교할 전주(없으면 '전주 자료 없음'), 캠페인 범위, 집계·사유 코드 버전을 적는다. 이어서 **'자동 판정 아님'** 고지와 표본 규칙을 적는다. 조회 상한 때문에 일부만 읽었다면(`partial`) '일부만 집계'를 밝힌다.
- 절 순서: 한눈에 보기(이번 주·전주·변화, 비율은 %p) → 역할×스킬·프롬프트 버전×보고 모델 → 사람 판정 사유 → 폐기 토큰 → 회의 완주율 → 판정 보정 κ → 자주 실패한 채점기.
- 개인정보: 요약에는 역할·버전·보고 모델·건수·토큰만 들어 있다. 작업물 본문, 검토 메모 원문, 채점 상세, 회의 안건, 이메일, 계정 id는 요약과 다이제스트 어디에도 나오지 않는다(테스트로 확인).
- 파일 이름: `digestFileName(week)` = `collective-quality-digest-2026-W39.md`.

## 다이제스트 실행 방법

스크립트는 표준 출력으로만 낸다. 파일을 쓰지 않고 네트워크도 쓰지 않는다(`fetch` 차단, 모듈은 `console`만 있는 vm 컨텍스트에서 실행). 인자나 입력이 잘못되면 종료 코드 2다. `--week`를 빼면 지난주(KST)를 쓴다.

### 로컬

로컬 D1(`wrangler dev --local --persist-to .wrangler/state`)의 sqlite 파일을 바로 읽는다. 읽기 전용으로 열고, 한 워크스페이스의 행만 쓴다.

```sh
find .wrangler/state -path '*d1*' -name '*.sqlite'
node scripts/quality-digest.mjs --sqlite <찾은 .sqlite> --week 2026-W39 [--owner <워크스페이스 id>]
```

워크스페이스가 여럿이면 `--owner`로 골라야 한다(생략하면 종료 코드 2). 레코드를 JSON(`{artifacts,decisions,usage,meetings,gradings,jobs?}`)으로 떠 두었다면 `node scripts/quality-digest.mjs <레코드.json> --week 2026-W39`로 실행한다.

### 운영

스크립트는 운영 D1이나 API에 접속하지 않는다. 소유자나 관리자가 받은 응답을 넣는다.

1. 로그인한 브라우저에서 `GET /api/quality-console?week=2026-W39`를 열어 JSON(`{week,summary,previous,kappa,campaignId,partial,notice}`)을 파일로 저장한다. 원하면 `&campaignId=`로 캠페인을 지정한다. 마크다운만 필요하면 `GET /api/quality-console?format=digest&week=2026-W39`로 첨부 파일을 바로 받아도 된다.
2. `node scripts/quality-digest.mjs <저장한.json>`으로 실행한다. 서버와 같은 함수로 같은 마크다운을 낸다. `campaignId`·`partial`이 있으면 머리말에 밝힌다. 주는 응답의 `week`를 쓴다. `--week`를 주었는데 응답의 주와 다르면 종료 코드 2로 멈춘다(다른 주 이름이 붙은 다이제스트를 막는다).
3. 저장한 JSON과 출력에는 본문이나 메모가 없다. 그래도 워크스페이스 운영 기록이므로 저장소에 커밋하지 말고 `outputs/` 같은 무시 경로에 둔다.

워커 큐 실행과 Slack 전달은 2단계에서 한다(성장 계획 B2 2단계, digest 큐).
