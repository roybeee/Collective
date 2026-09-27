# B4 2부 보상 계보 설계

결론: 사람 판정·발행·반응·주문·재방문 보상(보상 L0~L4)을 프롬프트 버전(`promptVersion`)과 학습 규칙(`ruleId@version`)별로 모으는 결정론 집계를 만든다. 선행 조건이 다 차지 않아 **축소 착수**한다. 반응(L2)은 줄여서 세고, 재방문(L4)은 `not_run`으로 두고, 결과는 읽기 전용이다. 첫 PR(B4-2a)은 모델 호출 0회의 순수 모듈이다.

비유: 식당 주방에서 레시피 판(버전)마다 "손님이 처음 먹고 바로 좋다고 했나, 메뉴판에 올랐나, 그 메뉴로 주문이 들어왔나"를 영수증에 적힌 레시피 번호로만 거슬러 세는 장부다. 번호가 없는 영수증은 어느 레시피에도 나눠 주지 않는다.

- 상태: **B4-2a 순수 모듈, B4-2b 서버·API·스위치, B4-2c 닫힌 개선 루프 대장과 학습 화면 보상 표를 구현했다**(`lib/reward-lineage.ts` [8절](#8-b4-2a-구현-순수-모듈), `lib/reward-lineage-server.ts`·`/api/reward-lineage` [9절](#9-b4-2b-구현-서버api스위치), `lib/improvement-loops.ts`·`app/reward-lineage-section.tsx` [11절](#11-b4-2c-구현-닫힌-개선-루프와-화면)). 스위치 `b4_reward_lineage`는 기본 꺼짐이다.
- 레인: A([LANES](LANES.ko.md)). 기준 SHA `76fc96e`. 아래 `파일:줄`은 그 커밋 기준이다.
- 착수 근거: 대표 지시(2026-09-27 "B2 2단계 빼고 남은 개발을 모두 진행하라").
- 이름 구분: 이 문서의 **보상 L0~L4**는 보상 층이다. [DATA-PROCESSING](DATA-PROCESSING.ko.md)의 L1~L3(바이럴 사례 분석·발견·학습 규칙 초안의 모델 입력 경로)과는 다른 것이다. 코드 키는 영문(`human`·`publish`·`engagement`·`order`·`revisit`)을 쓴다.

## 1. 설계 요약
- **입력**: 이미 저장된 기록만 쓴다.
  - 사람 판정 `review_decision`(`lib/review-decisions.ts:108`)
  - 작업물 판(현재 판·이전 판)
  - 실행 기록 `learning_snapshot`(`lib/learning.ts:39`)
  - 발행 `execution_publication`(`lib/execution.ts:15,19`)
  - 주문 `store_order`와 바이럴 실험·규칙
- **계보 키**
  - 버전: 작업물 판의 AI 원본 `promptVersion`. 사람이 고친 판(`ai_edited`)은 `aiSource.promptVersion`을 먼저 본다.
  - 규칙: 스냅샷의 `rules`·`operatorPreferences`를 `ruleId@version`으로 작업물에 잇는다. 스냅샷에 `artifactId`가 없으면 서버가 계산한 `roleArtifactId`(`lib/role-execution.ts:49`, 비동기 해시) 매핑을 입력으로 받는다.
- **출력**: `collective.reward-lineage.v1`. 같은 입력이면 입력 배열 순서와 관계없이 바이트가 같다. `inputDigest`는 입력 기록의 id·판만 모은 정규 문자열의 SHA-256이다.
- **읽기 전용**: 결과를 프롬프트 버전·규칙의 자동 승격·강등에 쓰지 않는다. B3-2 `feedback`(helpful/harmful)에도 쓰지 않는다.

## 2. 보상 L0~L4 정의

| 층 | 키 | 원천 | 계보 | 신뢰도 | 상태 |
|---|---|---|---|---|---|
| L0 사람 판정 | `human` | `review_decision`(작업물 approved·revision) | 판정의 `promptVersion`. 사람이 고친 판은 `aiSource.promptVersion`. 규칙은 targetId → `learning_snapshot`(roleArtifactId 매핑 입력) | `app_record` | measured |
| L1 게시 승인·발행 | `publish` | `execution_publication` | `copy.artifactId@artifactVersion` → 작업물 판 | 승인 `app_record`, 실게시 `connector` | measured, 결정 16 전에는 `realPublish:false` |
| L2 반응 | `engagement` | `source.kind==='artifact'`인 바이럴 실험 결과·채택 규칙 | 실험 `source` → 작업물 판 | `user_record` | **reduced**(`decision16_not_run`). 사례 기반 실험은 뺀다 |
| L3 주문 귀속 | `order` | 게시 관문을 다시 통과한 게시 코드 귀속 주문 | `codeAttribution.publicationId` → 발행 `copy.artifactId` | `user_record+derived`, 귀속≠증분 | measured(경로). 원가 미상 1건이라도 있으면 `contribution:null` |
| L4 재방문 | `revisit` | 없음(A5 전) | — | — | **not_run**(`a5_not_started`), 모든 줄 `null` |

- **L0 1차 판정**: 작업물마다 기록 순서(`createdAt`, `id`)상 첫 판정만 1차 판정이다. 규칙은 `firstPassApproval`(`lib/review-decisions.ts:114`)과 같다.
  - 1차 승인은 사람이 고치지 않은 AI 판(`origin ai`)의 첫 판정이 approved인 경우뿐이다.
  - 사람이 먼저 고친 판의 첫 판정은 분모에 넣고 `editedFirst`로 센다.
  - 직접 작성(manual) 작업물은 뺀다.
  - 첫 판정이 기간 전이면 기간 안의 판정은 1차 판정이 아니다. 수정 요청 수(`revisions`)와 사유 코드 수는 기간 안의 판정을 모두 센다.
  - 사유 코드는 v1 사전의 코드만 센다. 메모·섹션 원문은 싣지 않는다.
- **L1**: 기간은 예약 시각의 한국 날짜로 본다.
  - `approved`는 승인 기록(`approvedAt`)이 있는 발행이다.
  - `live`는 예약 접수·게시 확인(`LIVE_PUBLICATION_STATUSES`)이다.
  - 결정 16이 `not_run`이면 `live`도 앱의 접수 기록일 뿐 실제 게시 증거가 아니다.
- **L2**: 기간은 실험 생성일(한국 날짜)이다. `adoptedRules`는 그 실험에서 나온 초안 아닌 규칙 수다.
- **L3**: 주문일(한국 날짜)이 기간 안인 주문을 `publicationGateView`(`lib/store-attribution.ts:48`)로 지금 게시 상태에 맞춰 다시 본다. 그 뒤 `isAttributed`(`:108`)인 주문만 남긴다. 지표는 `orderMetrics`(`:112`)를 변동비율 추정 없이 쓴다.

## 3. 배분 규칙
1. 정확한 계보만 버전·규칙에 배분한다: 판정 대상 작업물 판, 발행 `copy`, 게시 코드의 발행.
2. 배분하지 못한 것은 `unallocated`에 층별 사유 건수로 둔다. 사유 코드는 아래와 같다.

   | 사유 | 뜻 |
   |---|---|
   | `manual_or_campaign_only` | 수동 귀속·캠페인 코드·게시 전 주문이라 사람 근거만 남은 귀속 |
   | `no_copy` | 카피 없는 발행이나 그 발행의 코드로 들어온 주문(계보 unknown) |
   | `no_prompt_version` | 작업물은 이어졌지만 그 판의 promptVersion을 모름 |
   | `no_artifact_mapping` | 작업물로 잇지 못한 실행 기록 |

3. 1차 판정이 5건 미만이면 1차 승인율은 `null`, 상태는 `insufficient`다.
4. 버전 비교(`comparisons`)는 설명용이다.
   - 같은 역할 안에서 표본이 충분한 버전을 첫 1차 판정 시각 순으로 세운다.
   - 이웃한 두 버전의 `probTreatmentBetter`(`lib/viral-stats.ts:98`)만 적는다.
   - 권고·판정 필드와 문구는 없다.
5. 한 작업물에 규칙이 여럿이면 규칙마다 같은 보상을 센다. 그래서 규칙별 합계는 전체보다 클 수 있다(고지에 적는다).
6. 회의 작업물의 복합 버전(`a+b`)은 `byPromptVersion`에서 키 그대로 쓴다. 단위별 모음(`byUnitVersion`)은 `usesVersion`으로 복합 키에 나온 단위마다 만든다. 그 단위를 쓰는 모든 줄(단독 키 포함)을 더한다.
7. `appliedRules`는 새 필드가 아니다. 스냅샷의 `rules`·`operatorPreferences`를 이 이름으로 파생해 보인다. 등급이 없는 규칙은 `performance_observed`로 본다(`lib/learning.ts:62`와 같다).

## 4. 계약(요약)

```json
{"schema":"collective.reward-lineage.v1","period":{"from":"2026-09-01","to":"2026-09-28","timeZone":"Asia/Seoul"},"scope":{"brandId":"b1","storeId":null,"campaignId":null},
 "layers":{"human":{"status":"measured","source":"app_record"},"publish":{"status":"measured","source":"app_record","liveSource":"connector","realPublish":false},
  "engagement":{"status":"reduced","reason":"decision16_not_run","source":"user_record","excluded":{"caseBased":1}},"order":{"status":"measured","source":"user_record+derived","notice":"귀속≠증분"},"revisit":{"status":"not_run","reason":"a5_not_started"}},
 "byPromptVersion":[{"promptVersion":"role.content@3f2a9c1b7d0e","role":"content","artifacts":12,
  "human":{"decidedFirst":10,"approvedFirst":6,"editedFirst":2,"revisions":3,"firstPassRate":0.6,"status":"measured","reasonCodes":{"voice":2}},
  "publish":{"publications":4,"approved":4,"live":0,"cancelled":0,"failed":0},"engagement":{"experiments":1,"evaluated":1,"adoptedRules":0},
  "order":{"attributedOrders":0,"netRevenue":0,"contribution":0,"unknownCostOrders":0},"revisit":null,"lineage":{"exact":20}}],
 "byUnitVersion":[],"byRule":[{"ruleRef":"playbook:9c1e@2","grade":"operator_preference","artifacts":5,"human":{"firstPassRate":null,"status":"insufficient","…":"…"},"…":"…"}],
 "comparisons":[],
 "unallocated":{"human":{"firstDecisions":0,"reasons":{"no_prompt_version":0}},"publish":{"publications":1,"reasons":{"no_copy":1,"no_prompt_version":0}},
  "engagement":{"experiments":0,"reasons":{"no_prompt_version":0}},"order":{"attributedOrders":3,"reasons":{"manual_or_campaign_only":3,"no_copy":0,"no_prompt_version":0}},
  "rules":{"snapshots":0,"reasons":{"no_artifact_mapping":0}}},
 "notices":["귀속≠증분 …","자동 판정 아님 …","배분 …","결정 16 …","재방문(L4) …"],"inputDigest":"sha256:…"}
```

- `artifacts`: 그 줄에 기간 안 보상 사건(판정·발행·실험·주문)이 하나라도 있는 작업물 수.
- `lineage.exact`: 그 줄에 배분한 보상 사건 수. 계보가 없거나 캠페인만 있는 사건은 줄이 아니라 `unallocated`에 있다.
- 주문이 0건인 줄의 `contribution`은 `orderMetrics` 규칙대로 0이다. 원가 미상 주문이 섞이면 `null`이다.
- 범위(브랜드·지점·캠페인)로 기록을 거르는 일은 호출자(B4-2b 서버)가 한다. 모듈은 기간만 거른다.
- 출력에 주문번호·메모·근거 원문·이메일·규칙 본문·캡션은 없다(카나리 테스트).

## 5. 대표 결정 (권고 적용)
대표 지시("B2 2단계 빼고 남은 개발 모두 진행")에 따라 아래 권고를 적용해 착수했다. 바꾸려면 B4-2b 전에 알려 주면 된다.

| # | 질문 | 적용한 권고 |
|---|---|---|
| R1 | 선행 조건이 덜 찼는데 착수하나 | 축소 착수한다. 코드는 만들고, 운영에서 L3·L4를 쓰는 것(스위치 켜기·KPI 주장)은 2026-10-15 판정에 맡긴다 |
| R2 | 결정 16 `not_run`일 때 L2 | 작업물 출처 실험만 세고 `reduced`로 표시한다. 사례 기반 실험은 뺀다 |
| R3 | L4 | A5 전이라 `not_run`, 값은 `null` |
| R4 | 표본 하한 | 1차 판정 5건. 미만이면 비율 `null`·`insufficient` |
| R5 | 버전 비교 | `probTreatmentBetter`를 설명용으로만 보인다. 권고·판정 문구와 자동 승격·강등은 없다 |
| R6 | 수동·캠페인 귀속 주문 | 어느 버전에도 배분하지 않고 `unallocated`에 둔다 |
| R7 | 적용 규칙 필드 | 새 필드 없이 스냅샷에서 `appliedRules`로 파생한다 |
| R8 | 복합 버전 | 키 그대로 쓰고 단위별 모음은 `usesVersion`으로 한다 |

## 6. 선행 조건 판정
판정: **축소 착수**.

| 선행 | 상태 | 근거 |
|---|---|---|
| A4·F2·F5·PR 4b-2(코드) | `merged` | [GROWTH-PLAN](GROWTH-PLAN.ko.md) B4 행(선행 A4, F2, F5, PR 4b) |
| 결정 16 첫 실게시 | `not_run` | Buffer 계정·공개 이미지 호스트 미연결([STATUS](STATUS.md), [배포 기록](releases/2026-09-23-dbf94a5.md) 29행). 그래서 L2 축소(GROWTH-PLAN 2단계 종료 조건) |
| 실제 주문 CSV 기록 | 없음 | 운영 주문 장부 사용이 관측되지 않았다 |
| 중단 규칙 | 판정일 **2026-10-15** | GROWTH-PLAN 141행 "A4 게시 뒤 3주 동안 실제 주문 CSV가 0건이면 B4 2부와 A5 착수를 보류한다". 그날도 0건이면 L3·L4를 운영에서 쓰는 것(스위치 켜기·KPI 주장)만 보류한다. 코드와 L0·L1 집계는 남긴다 |

## 7. PR 계획

| PR | 목표 | 주요 파일 | 스위치·게시·토큰 |
|---|---|---|---|
| **B4-2a** 순수 모듈(이 PR) | 보상 층 집계, 규칙 계보, 배분 규칙, `inputDigest` | 신규 `lib/reward-lineage.ts`, `tests/reward-lineage.test.mjs`, 이 문서 | 연결 없음. 게시 불필요. 토큰 0 |
| **B4-2b** 서버·API | 범위(브랜드·지점·캠페인)로 기록을 읽는다. `roleArtifactId` 매핑을 계산한다. 결정 16 상태를 읽어 미리보기로 돌려준다. 저장 없는 읽기 전용 GET으로 시작한다 | 신규 `lib/reward-lineage-server.ts`, `app/api/reward-lineage/route.ts`, `lib/feature-flags.ts`(`b4_reward_lineage` 기본 꺼짐) | 스위치 꺼짐. 묶음 5로 게시. 토큰 0 |
| **B4-2c** 개선 루프·화면 | 닫힌 개선 루프 대장(후보·전후 14일 비교·대표 닫기 동결)과 학습 화면 보상 표. `insufficient`·`reduced`·`not_run`·귀속≠증분을 함께 보인다. 2026-10-15 중단 규칙 판정 절차를 정한다([11절](#11-b4-2c-구현-닫힌-개선-루프와-화면)) | 신규 `lib/improvement-loops.ts`·`app/reward-lineage-section.tsx`, `lib/reward-lineage-server.ts`·route POST, kind `improvement_loop` | 스위치 꺼짐. 묶음 5. 토큰 0 |

- `lib/learning.ts`·`lib/learning-server.ts`는 B4 2부 어느 PR에서도 고치지 않고 타입만 import한다. 그래서 B3와 겹치지 않는다(GROWTH-PLAN 파일 소유 표).

## 8. B4-2a 구현 (순수 모듈)
- **공개 함수**
  - `buildRewardLineage(input)`: 동기, `inputDigest:null`
  - `rewardLineage(input)`: 비동기, Web Crypto SHA-256으로 `inputDigest`를 붙인다
  - `canonicalInput(input)`: 해시 원문
  - `appliedRules(snapshot)`, `usesVersion(key, id)`
- **import**
  - `review-decisions`(`firstPassApproval`·`REVIEW_REASONS`·타입)
  - `store-attribution`(`publicationGateView`·`publicationGate`·`isAttributed`·`orderMetrics`·`koreaMinute`·`LIVE_PUBLICATION_STATUSES`·`ATTRIBUTION_NOT_INCREMENTAL`)
  - `viral-stats`(`probTreatmentBetter`)
  - `learning`·`execution`·`customer-report`는 타입만
- **`usesVersion`은 로컬 사본이다**: `lib/prompt-registry.ts:41`의 원본은 순수 함수지만, 그 파일이 `./server`를 import해서 순수 모듈에서 부를 수 없다.
- **입력 검사**: 기간은 `YYYY-MM-DD`이고 시작일 ≤ 종료일이어야 한다. 결정 16은 `real|not_run`, 브랜드 범위는 필수다. 어기면 `RewardLineageError`(400)를 던진다.
- **RED 목록**(`tests/reward-lineage.test.mjs`, 모두 passed · mocked)
  1. L0: 작업물의 첫 판정만 1차 승인으로 센다. 사람이 고친 판은 aiSource.promptVersion으로 묶는다.
  2. ruleRef: rules·operatorPreferences를 id@version으로 작업물에 잇는다(roleArtifactId 매핑 입력).
  3. L1: copy가 있는 발행만 정확한 계보로 센다. copy가 없으면 unknown이다.
  4. L3: 게시 관문을 통과한 코드 귀속 주문만 센다. 원가 미상이 1건이라도 있으면 contribution은 null이다.
  5. L3: 수동·캠페인 귀속은 unallocated이고 어느 버전에도 배분하지 않는다.
  6. L2: 결정 16 not_run이면 reduced이고, 사례 기반 실험은 빼고 작업물 출처 실험만 센다.
  7. L4: A5 전에는 not_run 사유와 null이다.
  8. 표본 5건 미만 비율은 null·insufficient다.
  9. 같은 입력이면 바이트 동일한 출력이다(입력 순서 무관, inputDigest 동일, 판이 바뀌면 digest 변경).
  10. 출력에 주문번호·메모·근거 원문·이메일이 없다(카나리).
  11. 순수 모듈 import 경계: `server`·`feature-flags`·`quality-*`·`eval-*`·`franchise-*`·`*-server`를 실행 그래프에서 import하지 않는다.
- **변이 검사**: 20개 변이를 모두 잡았다. 대상은 아래와 같다.
  - 첫 판정 무시, aiSource 무시, 표본 하한, 게시 관문 제거, 수동 귀속 배분
  - 사례 실험 포함, 결정 16 무시, 판정 정렬 제거, roleArtifactId 무시, 변동비율 추정
  - usesVersion 부분 문자열, L4 측정 표시, 알 수 없는 사유 코드, 비교 방향 뒤집기, copy 무시
  - 기간 무시, 초안 규칙 채택, digest에 원문 포함, 줄 정렬 제거, 기본 등급

## 9. B4-2b 구현 (서버·API·스위치)
- **파일**
  - 신규 `lib/reward-lineage-server.ts`: records를 읽어 `rewardLineage`에 넘긴다. 쓰기·잠금·모델·커넥터 호출이 없다(토큰 0).
  - 신규 `app/api/reward-lineage/route.ts`: `GET ?from=&to=&brandId=&storeId=&campaignId=`만 있다.
  - `lib/feature-flags.ts` `b4_reward_lineage`(기본 꺼짐), `lib/feature-status.ts` 기능표 `reward-lineage` 행(고객 보고서 행 다음).
  - 새 kind 0개, D1 migration 0건. `lib/learning*.ts`·실행기·`meetings`는 고치지 않는다(`roleArtifactId`와 타입만 import).
- **판정 순서**: 비로그인 401 → 직원 403 → 스위치 꺼짐 409 → 기간 400 → 범위(없음·다른 워크스페이스·서로 맞지 않음 404, 빠짐 400).
  - 스위치는 이 서버 파일에서만 읽고, 읽기 실패는 꺼짐으로 본다.
  - 대표·관리자는 200이다. 권한은 route와 서버가 함께 막는다.
- **응답**: `{enabled:true,decision16,partial:{kinds},lineage}`. `lineage`는 `collective.reward-lineage.v1`이다.
  - 같은 DB 상태면 `inputDigest`와 응답 바이트가 같다. 기록이 바뀌면 `inputDigest`가 바뀐다.
- **기간**: 한국 날짜 `from`~`to`(양 끝 포함). 기본은 오늘까지 28일, 최대 180일이다. SQL 창은 앞뒤 하루씩 넓히고, 날짜 경계는 순수 모듈이 다시 거른다.
- **범위**
  - 브랜드는 필수다. `storeId`나 `campaignId`만 주면 그 기록의 브랜드를 쓴다.
  - 범위 캠페인: 브랜드는 그 브랜드의 모든 캠페인이다. 지점은 그 지점 캠페인과 브랜드 공통 캠페인이다(고객 보고서와 같은 규칙). 캠페인은 그 캠페인만이다.
  - 판정: 캠페인을 지워도 남는다. 그래서 브랜드 범위는 판정의 `brandId`로, 지점·캠페인 범위는 판정의 `campaignId`로 거른다. 지운 캠페인의 판정은 지점을 알 수 없어 지점 범위에서 빠진다.
  - 주문: 지점 범위는 그 지점, 그 밖은 브랜드의 모든 지점이다. 캠페인 범위는 그 캠페인에 귀속된 주문만이다.
  - 발행·실험: 범위 캠페인 것만 읽는다. 기간 주문의 게시 코드가 가리키는 범위 캠페인 발행도 읽는다(게시 관문 재검사). 규칙은 그 실험에서 나온 브랜드 규칙만이다.
- **작업물 판과 규칙 계보**
  - 판정·발행 copy·실험 출처가 가리키는 작업물의 현재 판과 이전 판(kind `history`)만 읽는다. 본문은 읽지 않는다.
  - 역할 실행: 그 작업물 캠페인의 `learning_snapshot`을 읽고, `artifactId`가 없으면 `roleArtifactId(스냅샷 id)`로 작업물에 잇는다.
  - 회의 작업물: `meetingId`의 `team_meeting` `snapshot.learning`을 `meeting:<회의>:<작업물>` 스냅샷으로 잇는다.
  - 사건이 있는 작업물에 이어지는 스냅샷만 넘긴다. 그래서 `unallocated.rules.no_artifact_mapping`은 이 서버에서 0이다.
  - 규칙 사본은 id·판·등급만 읽는다.
- **캠페인 삭제 뒤**: 작업물·스냅샷은 지워지고 판정은 남는다. 판정은 `promptVersion` 줄에 남고, 규칙 계보는 없다(ruleRef unknown, 그 규칙 줄 없음).
- **D1 한도**: 종류별 최근 5,000행만 읽는다. 넘으면 `partial.kinds`에 종류를 남긴다(`campaign`·`review_decision`·`execution_publication`·`store_order`·`viral_experiment`·`learning_rule`·`artifact`·`history`·`learning_snapshot`·`team_meeting`). 목록 조건은 JSON 배열 하나(`json_each`)로 바인드해 바인드 수가 고정이다.
- **결정 16**: 저장 기록이 없는 운영 판정이다. 그래서 서버 상수 `DECISION16_STATE='not_run'`으로 둔다. 첫 실게시가 real로 판정되면 이 값만 바꾼다.
- **RED 목록**(`tests/reward-lineage-server.test.mjs`, 모두 passed · mocked: 메모리 SQLite, 로컬 인증 헤더·이메일 세션, fetch 스텁)
  1. `b4_reward_lineage`가 꺼져 있으면 409, 켜면 200이다.
  2. 직원 403, 관리자·소유자 200, 비로그인 401이다.
  3. fetch 호출 0회, `provider_usage` 0건이다(모델·커넥터 호출 없음).
  4. 5,000행을 넘으면 `partial.kinds`에 표시한다.
  5. 캠페인을 지운 뒤에도 판정은 promptVersion으로 남고 ruleRef는 unknown이다(규칙 줄·매핑 없음).
  6. record-kinds 고정 목록이 그대로다(새 kind 없음).
  7. `b4_reward_lineage` 기본값은 false다.
  8. 범위 필터(브랜드·지점·캠페인)가 다른 범위 기록을 섞지 않는다.
  9. 다른 owner의 기록은 보이지 않는다.
  10. 같은 DB 상태면 `inputDigest`가 같다.
  - 그 밖: roleArtifactId·회의 `snapshot.learning` 규칙 계보, 기간 전 첫 판정, 기간 400·180일, 서로 맞지 않는 범위 404, 저장 0건, 원문 없음(메모·캡션·규칙 본문·주문번호).
- **변이 검사**: 21개 변이를 모두 잡았다. 대상은 아래와 같다.
  - 스위치 무시, 권한 제거(route·서버), 스위치 기본값 켜짐, 행 상한 표시 제거, roleArtifactId 무시, 회의 snapshot.learning 무시
  - 지점 캠페인 필터 제거, 주문 지점 필터 제거, 캠페인 범위 제거, 판정 범위를 늘 brandId로, 판정 범위를 늘 campaignId로, 소유자 조건 제거
  - 기본 기간 90일, 최대 기간 181일, inputDigest 없음, 결정 16 real, 지점·브랜드 불일치 허용, 캠페인 불일치 허용, 기간 역순 허용
  - 기간 전 판정 제외(1차 판정 오판), 발행 범위 캠페인 무시

## 10. 남은 위험
- **promptVersion 공백**: 레지스트리 이전 실행과 조회 실패는 promptVersion이 비어 `no_prompt_version`으로 빠진다. 초기에는 unallocated가 클 수 있다.
- **L1 `live`**: 결정 16 전에는 실제 게시 증거가 아니다. 화면(B4-2c)이 `realPublish:false`를 함께 보여야 한다.
- **규칙 중복 배분**: 규칙별 합계를 더해서 쓰면 과대 집계가 된다. 고지로만 막는다.
- **표본**: 운영 판정 수가 적어 대부분 `insufficient`일 것이다. 비교는 5건 이상인 버전끼리만 나온다.
- **Web Crypto**: `rewardLineage`는 전역 `crypto.subtle`에 기댄다. Workers와 Node 테스트 런타임에는 있다. 없는 환경에서는 `buildRewardLineage`와 `canonicalInput`을 쓰고 해시는 호출자가 붙인다.
- **B4-2b 범위 규칙**: 지점 범위에 브랜드 공통 캠페인이 함께 든다. 그래서 같은 공통 캠페인 기록이 두 지점에 모두 보인다. 지운 캠페인의 판정은 지점 범위에서 빠지고 브랜드 범위에만 남는다.
- **B4-2b 행 상한**: 판정이 5,000행을 넘으면 최근 행만 읽는다. 그래서 오래된 첫 판정이 빠져 1차 판정이 달라질 수 있다. 이때 `partial.kinds`에 `review_decision`이 나오므로 화면(B4-2c)이 '일부만 집계'를 함께 보여야 한다.
- **결정 16 상수**: 첫 실게시가 real이 돼도 코드 상수를 바꾸기 전까지 `not_run`으로 보인다. 결정 16 판정 기록 PR에서 함께 바꾼다.
- **B4-2c 전후 비교는 인과가 아니다**: 같은 14일에 다른 버전·규칙·계절 변화가 섞인다. 화면과 동결 행 모두 설명용이고 자동 판정이 아니다. 운영 판정 수가 적어 대부분 `insufficient`로 머물 수 있다.
- **B4-2c 코드 상수 전 창**: 레지스트리 이전(from 없음) 활성화의 전 창은 '그 단위의 레지스트리 버전이 없는 줄'이다. 채널·회의 단위는 역할을 몰라 같은 기간의 다른 역할 줄까지 든다.
- **B4-2c 한 번 읽기**: 루프 후보 창을 모두 덮는 기간을 한 번 읽는다(최대 약 194일). 종류별 5,000행을 넘으면 `loops.partial.kinds`가 나오고 오래된 창의 수치가 빠질 수 있다. 180일 넘은 미종결 후보는 목록에서 빠진다(닫을 수 없다).
- **B4-2c 닫은 뒤 범위**: 루프는 한 번만 닫고 닫을 때의 범위(브랜드) 수치를 동결한다. 프롬프트 루프를 다른 브랜드 화면에서 보면 닫은 브랜드의 동결 수치가 보인다.

## 11. B4-2c 구현 (닫힌 개선 루프와 화면)
- **파일**
  - 신규 `lib/improvement-loops.ts`(순수): 루프 후보, 전후 14일 창, 창별 보상 비교, 상태, `inputDigest`. `reward-lineage`·`store-attribution`·`viral-stats`만 실행 import한다. `lib/prompt-registry.ts`는 `ReleaseEventRecord` 타입만 import한다(서버 의존 없음, 로컬 복사 없음).
  - `lib/reward-lineage-server.ts`: GET 응답에 `loops`를 더하고 POST `close`(`rewardLineageAction`)를 넣었다. `app/api/reward-lineage/route.ts`에 POST(`secureMutation`, 소유자 잠금, `executionRate(owner,'reward_lineage')`).
  - kind `improvement_loop`(`lib/record-kinds.ts`, `customer_report` 뒤·`brand_voice` 앞). parent 없음, 캠페인과 무관, 추가만(`INSERT OR IGNORE`, 이미 있으면 409), 원문·이메일·승인 사유 없음.
  - 신규 `app/reward-lineage-section.tsx`와 `app/learning-panel.tsx` 학습 규칙 탭 아래 '보상 계보' 절(새 탭 없음). D1 migration 0건. 토큰 0.
- **루프 후보**
  - 프롬프트: `prompt_release_event`의 `activate`·`promote` 중 `evalRunId`와 `approval`이 모두 있는 것. `stage`·`rollback`·`reset_pins`는 후보가 아니다. 워크스페이스 전체 단위다.
  - 운영자 선호 규칙: 조회 브랜드의 `playbook_audit` `activate`(B3-1). 규칙 역할은 그 `learning_rule`의 `role`(없으면 모든 역할)이다.
  - 루프 id는 `prompt:<이벤트 id>`·`playbook:<감사 id>`이고 루프당 한 번만 닫는다.
  - 180일(`LOOP_MAX_AGE_DAYS`)보다 오래된 활성화는 닫지 않은 한 목록에 없다.
- **창과 비교**
  - 활성화 한국 날짜 D. 전 창은 D-14~D-1, 후 창은 D~D+13이다. B4-2a `buildRewardLineage`를 창마다 다시 부른다.
  - 프롬프트: 후 = `to` 버전을 쓴 줄(`usesVersion`, 복합 키 포함). 전 = `from` 버전을 쓴 줄이다. `from`이 없으면(코드 상수) 그 단위의 레지스트리 버전이 없는 줄이다. `role.*` 단위는 같은 역할만 본다.
  - 규칙: 후 = 그 규칙이 주입된 작업물(`byRule`의 `ruleId@*`). 전 = 같은 브랜드의 같은 역할 줄(`byPromptVersion`)이다.
  - 창별로 L0(1차 판정·승인·수정 요청), L1(발행·승인·접수), L3 경로(귀속 주문·순매출·공헌이익, 귀속≠증분)를 싣는다. L2·L4는 싣지 않는다.
  - `probTreatmentBetter`(전=대조, 후=실험)는 양쪽 1차 판정이 모두 5건 이상일 때만 설명용으로 적는다. 권고·판정 필드는 없다.
- **상태**(우선순위 순): `closed`(동결 행 있음) → `rolled_back`(롤백·중지됨) → `open`(오늘 ≤ D+13) → `insufficient`(한쪽이라도 1차 판정 5건 미만) → `closable`.
  - `rolled_back`은 설계 요청의 네 상태에 더한 다섯째 상태다. 롤백된 버전을 `closable`로 보이지 않게 하려고 넣었다.
  - 롤백: 활성화 뒤 같은 단위의 `rollback`이 이 루프의 `to`를 되돌렸다. 규칙은 활성화 뒤 같은 규칙의 `pause`다(재승인은 새 루프다).
- **닫기(POST `close`)**
  - 본문: `{action:'close',loopId,version,expected:{before:{decidedFirst,approvedFirst},after:{…}},brandId|storeId|campaignId}`.
  - 판정 순서: 모르는 작업 400 → 대표 아님 403(관리자·직원, route와 서버가 함께 막는다) → 스위치 꺼짐 409 → 범위 400·404 → 루프 없음 404 → 판 번호(`version`: 닫기 전 0, 닫은 뒤 1) 불일치 409 → `closable` 아님 409 → `expected` 빠짐 400 → 지금 수치와 다름 409.
  - 동결: 그때 계산한 `comparison`·`windows`·`source`·범위와 루프 `inputDigest`를 `improvement_loop` 행에 쓴다. 닫은 사람은 id·역할(`owner`)만 남긴다.
  - 닫은 루프는 이후 데이터가 바뀌어도 이 행의 수치와 `inputDigest`를 그대로 보인다. 롤백 여부만 지금 이벤트로 다시 본다.
- **inputDigest**: 루프 창 입력 참조의 SHA-256이다. 판정은 후 창 끝까지, 발행·주문·실험은 루프 창 안만 넣고 B4-2a `canonicalInput`으로 만든다(id·판만, 원문 없음). 루프 창 밖 새 기록은 바꾸지 않는다.
- **읽기**: `prompt_release_event`(승인은 있는지와 시각만, 사유 원문은 읽지 않는다)·브랜드 `playbook_audit`·`improvement_loop`·규칙 역할을 읽는다. 후보 창을 모두 덮는 기간을 `lineageInput`으로 한 번 읽는다. 행 상한을 넘은 종류는 `loops.partial.kinds`에 남긴다.
- **B4-2b 결함 수정**: 서버가 스냅샷 자체 `artifactId`(운영자 선호를 주입한 실행)를 순수 모듈에 넘기지 않았다. 그래서 운영자 선호 규칙의 `byRule` 계보가 끊겼다(`roleArtifactIds`에도 없음). `ruleLinks`가 `artifactId`를 그대로 넘기게 고쳤다. 규칙 루프 서버 테스트가 이 경로를 잡는다(변이 검사로 확인).
- **화면**(학습 → 학습 규칙 탭 아래 '보상 계보' 절)
  - 대표·관리자만 보이고 직원에게는 절이 없다. 스위치가 꺼지면(409) 안내만 보인다.
  - 버전별 보상 L0~L4 표를 보인다. 고지는 `realPublish:false`, 일부만 집계(`partial.kinds`), 귀속≠증분, 자동 판정 아님, L4 `not_run`이다.
  - 규칙별 표에는 중복 배분이라 줄을 합산하지 말라는 고지를 붙인다.
  - 개선 루프 목록은 전후·설명용 확률·상태·종료 조건 셈을 보인다. 'close'(닫기 · 수치 동결) 버튼은 대표에게만, `closable` 루프에만 있다. 누르면 확인 창을 띄운다.
- **4단계 종료 조건 "닫힌 개선 루프 누적 5건"의 셈법**([GROWTH-PLAN](GROWTH-PLAN.ko.md) 4단계)
  - 워크스페이스의 `improvement_loop` 행 중 지금 롤백되지 않은 것만 센다. 화면과 응답의 `loops.exit.counted`이고, 목표는 `exit.target=5`다.
  - 닫은 뒤 그 버전이 롤백되거나 규칙이 중지되면 행은 남지만 셈에서 빠진다(`countsToExit:false`).
  - 닫기는 대표만 한다. `closable`(14일 경과, 전후 각 5건 이상, 롤백 없음)만 닫을 수 있어, 표본이 모자란 루프는 세지 않는다.
  - 자동 판정이 아니다. 전후 차이의 방향(좋아졌는지)은 셈에 쓰지 않고 대표 검토에 맡긴다.
- **2026-10-15 중단 규칙 판정 절차**([6절](#6-선행-조건-판정), GROWTH-PLAN 141행)
  1. 기준일: A4 게시일부터 3주다. 판정일은 **2026-10-15(KST)**로 고정한다.
  - 2026-09-27 대표 결정으로 판정을 오늘로 앞당겼다. 결과는 0건, `blocked`다. 같은 날 스위치를 켰으므로 3단계의 "이미 켰다면" 쪽을 따른다([관찰 기록](observations/2026-09-27-lane-a-b4-stop-rule.md)). 주문 CSV가 real로 1건 이상 생기면 4단계를 적용한다.
  2. 확인할 기록: 운영 D1에서 A4 게시 뒤 만든 `order_import`(주문 CSV 가져오기 기록) 행 수와 그 행들이 적은 가져온 주문 건수를 센다(소유자 워크스페이스, 합성·테스트 브랜드 제외). 직접 입력한 `store_order`는 CSV가 아니므로 세지 않는다. 명령과 결과는 관찰 기록(`docs/observations/2026-10-15-lane-a-b4-stop-rule.md`)에 `real`로 남긴다.
  3. 0건이면: L3·L4를 운영에서 쓰는 것을 보류한다. 스위치 `b4_reward_lineage`는 켜지 않거나, 이미 켰다면 L3를 KPI로 주장하지 않는다. 코드·L0·L1 집계와 개선 루프 대장(L0 기준)은 남긴다. STATUS 레인 A 칸에 `blocked`(사유: 실제 주문 CSV 0건)로 적는다.
  4. 1건 이상이면: L3 사용을 막지 않는다. 스위치 켜기는 대표 결정으로 따로 한다. A5 착수 판단은 별도 문서에서 한다.
  5. 판정을 하지 못했으면(운영 D1 접근 불가 등) `not_run`과 이유를 적고, 다음 영업일에 다시 한다. 그 사이 L3는 보류 상태로 본다.
- **RED 목록**(모두 passed · mocked)
  - `tests/improvement-loops.test.mjs`(순수, 45): activate·promote(evalRunId·승인 있음) 후보·승인 없는 stage 제외, 창 경계(D-14~D-1, D~D+13), closable 전후 수치와 설명용 확률, open(마지막 날까지)·insufficient, 롤백된 버전은 닫힌 루프로 세지 않음(닫은 뒤 롤백 포함), 닫은 루프의 동결 수치 불변, playbook activate 뒤 주입 작업물만 후 창·같은 역할 전 창·중지 = 롤백, 결정론·inputDigest, import 경계.
  - `tests/improvement-loops-server.test.mjs`(실제 SQLite, 44): GET loops, close는 대표만(관리자·직원 403, 비로그인 401, 다른 출처 403), 판 불일치·상태·확인 값 409, 동결 수치는 이후 데이터가 바뀌어도 불변, 롤백 뒤 셈 제외, 다른 소유자 분리, 스위치 꺼짐 POST close 409·직원 403, kind 등록 위치, fetch 0회·`provider_usage` 0건.
  - `tests/reward-lineage-ui.test.mjs`(화면 렌더·원문, 10): 직원에게 절 없음, 대표에게 close 버튼, 관리자에게 없음, 스위치 꺼짐 안내, 고지·표·루프 목록, 학습 화면 새 탭 없음.
  - 고정 목록 테스트는 자기 항목만 더했다: `tests/customer-report-server.test.mjs`(customer_report 다음 improvement_loop, 그다음 brand_voice), `tests/reward-lineage-server.test.mjs`(새 kind는 improvement_loop만, route는 GET·POST).
  - E2E는 추가하지 않았다(`not_run`).
- **변이 검사**: 33개 변이를 모두 잡았다.
  - 순수: stage 후보, 승인·평가 run 무시, 롤백 무시·시각 무시, open 경계, 표본 하한, 창 13일, from 무시, 역할 필터, 규칙 후 창을 전체 줄로, 중지 무시, 동결 무시, 셈에서 롤백 무시, 비교 방향, 창 판정 자르기, 브랜드 필터, 최대 나이
  - 서버: 대표 전용 제거(route+서버), 판 번호·확인 값·상태·스위치 검사 제거, 추가만→덮어쓰기, 스냅샷 artifactId 누락(B4-2b 결함), 승인 읽기 누락, 규칙 역할 누락, 닫은 행 읽기 누락
  - 화면: 관리자 닫기, 직원 노출, 합산 금지 고지 제거, realPublish 고지 뒤집기, 모든 상태에 닫기 버튼
