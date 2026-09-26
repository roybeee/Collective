# B4 2부 보상 계보 설계

결론: 사람 판정·발행·반응·주문·재방문 보상(보상 L0~L4)을 프롬프트 버전(`promptVersion`)과 학습 규칙(`ruleId@version`)별로 모으는 결정론 집계를 만든다. 선행 조건이 다 차지 않아 **축소 착수**한다. 반응(L2)은 줄여서 세고, 재방문(L4)은 `not_run`으로 두고, 결과는 읽기 전용이다. 첫 PR(B4-2a)은 모델 호출 0회의 순수 모듈이다.

비유: 식당 주방에서 레시피 판(버전)마다 "손님이 처음 먹고 바로 좋다고 했나, 메뉴판에 올랐나, 그 메뉴로 주문이 들어왔나"를 영수증에 적힌 레시피 번호로만 거슬러 세는 장부다. 번호가 없는 영수증은 어느 레시피에도 나눠 주지 않는다.

- 상태: **B4-2a 순수 모듈을 구현했다**(`lib/reward-lineage.ts`, [8절](#8-b4-2a-구현-순수-모듈)). 서버·API·스위치·화면은 없다.
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
| **B4-2c** 화면·판정 기록 | 학습 또는 품질 화면의 읽기 전용 표. `insufficient`·`reduced`·`not_run`·귀속≠증분을 함께 보인다. 2026-10-15 중단 규칙 판정을 기록한다 | 화면 파일(PR 5 범위), 관찰 기록 | 묶음 5. 토큰 0 |

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

## 9. 남은 위험
- **promptVersion 공백**: 레지스트리 이전 실행과 조회 실패는 promptVersion이 비어 `no_prompt_version`으로 빠진다. 초기에는 unallocated가 클 수 있다.
- **L1 `live`**: 결정 16 전에는 실제 게시 증거가 아니다. 화면(B4-2c)이 `realPublish:false`를 함께 보여야 한다.
- **규칙 중복 배분**: 규칙별 합계를 더해서 쓰면 과대 집계가 된다. 고지로만 막는다.
- **표본**: 운영 판정 수가 적어 대부분 `insufficient`일 것이다. 비교는 5건 이상인 버전끼리만 나온다.
- **Web Crypto**: `rewardLineage`는 전역 `crypto.subtle`에 기댄다. Workers와 Node 테스트 런타임에는 있다. 없는 환경에서는 `buildRewardLineage`와 `canonicalInput`을 쓰고 해시는 호출자가 붙인다.
