# 사람 판정·교정 결정 로그 (B1)

사람이 AI 작업물·브리프 제안·조사 자료·발행을 판정한 기록을 덮어쓰지 않고 쌓는다. 채점기(F1)와 사람 판정을 같은 사유 코드로 맞춰 B2(κ 보정)·B3(개선 분석)·A7·F4b가 조회로 쓴다.
모델(HERMES·OpenAI) 호출은 하지 않는다. 기록·조회는 D1 읽기·쓰기만 쓴다(테스트: `tests/review-decisions.test.mjs`, fetch 호출 0).

- 순수 규칙(화면·서버 공용): `lib/review-decisions.ts`
- 저장·조회(D1): `lib/review-decisions-server.ts`
- records kind: `review_decision` (`lib/record-kinds.ts` 목록 끝)
- 기능 스위치: `b1_reason_required` (`lib/feature-flags.ts`, 기본 꺼짐)

## 사유 코드 v1 (대표 결정 8, 2026-09-24)

`review-reasons-v1`. quality 5기준(`lib/quality.ts` `qualityCriteria` 키)과 검토 코드 5개, 총 10개다. 각 코드 아래에 F1 실패 유형 ID(`lib/graders` 채점기 id)를 매핑한다.

| 코드 | 라벨 | 뜻 | 대상 | F1 채점기 |
|---|---|---|---|---|
| `evidence` | 근거 | 출처·실측 없이 단정하거나 확인 전 값·표현을 표시 없이 씀 | 전체 | `unconfirmed_value_assertion`, `unsupported_claim_term` |
| `brand` | 브랜드·상품 | 브랜드 정체성·상품·업종과 맞지 않음 | 전체 | `industry_metric_leak` |
| `execution` | 제작·실행 | 실행할 초안·채널 계획·제작 지시가 비었거나 부족함 | 작업물·브리프 제안·발행 | `thin_section`, `local_channel_coverage` |
| `economics` | 예산·운영 | 예산·원가·운영 조건을 무시하거나 임의로 확정함 | 작업물·브리프 제안 | 없음(결정론 채점기 없음) |
| `measurement` | 측정·실험 | 지표 정의·기준 기간·대조군·판정 기준이 없거나 잘못됨 | 작업물·브리프 제안 | `revisit_cohort_definition` |
| `compliance` | 규제·표시 | 표시·광고 규제, 플랫폼 정책, 권리 확인이 필요한 표현 | 전체 | A2 규제 가드레일(`checkCompliance`) 전체 |
| `voice` | 어조·표현 | 브랜드 목소리·톤이 맞지 않거나 브리프가 막은 표현을 씀 | 작업물·브리프 제안·발행 | `brief_prohibition_conflict` |
| `fact_error` | 사실 오류 | 확정 사실과 다른 값(가격·주소·오픈일 등)이나 거절된 값을 씀 | 전체 | `fact_conflict` |
| `question_only` | 재질문·보류 | 산출물 대신 재질문·선택지·작성 보류를 돌려줌 | 작업물 | `question_only` |
| `format` | 형식·구조 | 출력 계약·제목 구조가 깨지거나 내부 ID·디버그 값이 노출됨 | 작업물·발행 | `contract_json`, `heading_nesting`, `internal_id_exposure` |

- 매핑하지 않는 채점기: `input_budget`(호출 입력 토큰 상한은 산출물 내용 판정이 아니다).
- 대상 밖 코드(예: 자료 제외에 `question_only`)와 모르는 코드는 400이다. 목록은 10개 이하, 중복은 한 번만 남긴다.
- 화면 칩은 최대 8개다(`reasonChoices`). 역할이 주로 다루는 기준을 앞에 둔다: cmo·growth는 `economics`·`measurement`, data는 `measurement`, quality는 `evidence`·`measurement`·`economics`.

## 저장 형식 (`review_decision`)

행 id는 `<owner>:review_decision:<uuid>`이고 `ON CONFLICT` 없는 INSERT로만 쓴다. 같은 판정을 고치지 않고 새 행을 더한다(덮어쓰기 0). 조회 순서는 기록 순서(rowid)다. `parent_id`는 비워 두고 캠페인은 `campaignId`로 잇는다.

| 필드 | 뜻 |
|---|---|
| `targetKind` | `artifact` \| `brief_suggestion` \| `source` \| `publication` |
| `targetId` | 작업물 id · 브리프 초안 id · 자료 id · 발행 id |
| `version` | 판정한 대상 버전(작업물·자료·발행 버전, 브리프 제안은 저장한 브리프 버전) |
| `role` | 작업물 담당 역할. 그 밖은 `null` |
| `decision` | 작업물 `approved`·`revision`, 브리프 제안 `adopted`·`edited`·`ignored`, 자료 `excluded`, 발행 `cancelled`·`returned`(승인을 초안으로 되돌린 재확인) |
| `reasonCodes` | 사유 코드 목록(빈 목록 가능) |
| `section` | 브리프 제안의 필드 키(`kpi` 등) |
| `note` | 검토 메모(작업물 수정 요청·승인 메모). 고객 원문이 들어갈 수 있다 |
| `actor` | PR 1 행위자 `{id,email,role}` |
| `promptVersion` | 사용량 원장(`provider_usage`) 조인 키. 작업물은 `artifactId`, 브리프 제안은 `jobId`(=초안 id)로 찾는다. 없으면 `null` |
| `skillVersion`·`outputContractVersion` | 작업물(또는 사람이 고친 작업물의 AI 원본)에서 복사. 직접 작성·브리프·자료·발행은 `null` |
| `campaignId`·`brandId` | 캠페인 판정은 `campaignId`, 자료 제외는 `brandId` |
| `origin` | 작업물 판정 때의 출처(`ai`·`ai_edited`·`manual`) |
| `criteria` | quality 작업물의 기준별 사람 판정 `[{criterion,human:'pass'|'revise',ai}]`. `ai`는 판정 시점 AI 검수 상태 사본 |
| `reasonsVersion`·`createdAt` | `review-reasons-v1`, 기록 시각 |

보존: B2·B3 평가 자료라 `eval_case`처럼 캠페인을 지워도 남긴다(`retain`, `data_campaign`, 삭제를 막지는 않는다). 캠페인 삭제 영향 조회에는 보존 건수로 잡히고 대화상자에는 이름표가 없어 '기타 기록'으로 보인다(`lib/deletion-summary.ts` 이름표는 후속). 검토 메모(`note`)가 캠페인 삭제 뒤에도 남으므로 메모 삭제 경로가 필요하면 후속으로 만든다. 자료 제외 판정은 `campaignId`가 없다.
레지스트리 위치: `tests/token-budget.test.mjs`가 마지막 3개(`token_budget`·`token_reservation`·`usage_alias_pricing`)를 고정해 그 묶음 바로 앞에 둔다.

## 기록 지점

| 지점 | 동작 |
|---|---|
| `POST /api/action` `review_artifact` | 판정 1회 = `review_decision` 1건 + 기존 이벤트 1건. 작업물 `reviewNote`·재작성 입력(PR 2)은 그대로다. 모르는 코드는 스위치와 관계없이 400. 스위치가 켜지면 수정 요청에 사유 1개 이상 필수(없으면 400, 어떤 레코드도 쓰지 않음). 승인은 칩 없이 된다. 직원 승인은 기존대로 403이고 판정도 남지 않는다. `criteria`는 quality 작업물만 받는다(그 밖은 400) |
| `POST /api/action` `save_artifact` | AI 작업물(`origin ai`)을 사람이 고쳐 저장하면 `origin ai_edited`, `aiSourceId`(`<원본 id>:<원본 버전>`, 채점 기록 `grading` id와 같은 형식), `aiSource`(원본 실행 버전), `editStats`(`changedSections` 바뀐 섹션 제목, `diffRatio` 0~1 줄 단위 편집 비율)를 남긴다. 다시 고쳐도 원본과 비교한다. 처음부터 직접 쓴 작업물은 `manual` 그대로다 |
| `POST /api/action` `save_campaign` | HERMES 초안을 처음 캠페인에 저장할 때 제안 필드마다 1건. 저장값이 제안과 같으면 `adopted`, 비었거나 초안 요청 때 값 그대로면 `ignored`, 그 밖은 `edited`. `suggestionReasons`(선택)는 `edited`·`ignored`에만 붙인다. 재시도·재저장은 중복 기록하지 않는다 |
| `POST /api/archive` `review_source`·`review_sources` | 사용 제외(`excluded`)마다 1건. `reasonCodes` 선택. 확인·후보로 돌리기는 기록하지 않는다 |
| `POST /api/execution` `cancel`·`reconfirm` | 발행 취소 `cancelled`, 재확인(승인을 초안으로 되돌림) `returned` 1건. `reasonCodes` 선택. 상태 변경 뒤 기록하므로 두 쓰기는 한 묶음이 아니다 |

화면: 작업물 검토 창(`app/panels.tsx`)은 수정 요청 사유 칩과 quality 기준별 통과·수정 버튼, 출처 문구(`AI 작성 · 사람 수정`)를 보여 준다. 브리프·자료·발행 화면은 사유 한 개를 고르는 선택 입력만 있다.

## 조회 함수 (`lib/review-decisions-server.ts`)

| 함수 | 돌려주는 것 |
|---|---|
| `targetHistory(owner,targetKind,targetId)` | 대상별 판정 이력(기록 순서) |
| `campaignDecisions(owner,campaignId)` | 캠페인의 모든 판정 |
| `firstPassApprovalRates(owner)` | 역할×`skillVersion`별 1차 승인율 `{role,skillVersion,artifacts,approvedFirst,rate}`. 작업물마다 첫 판정이 `approved`인 비율(순수 계산은 `firstPassApproval`) |
| `criterionUnits(owner,campaignId?)` | B2 κ 단위 `(artifactId, version, criterion)`별 사람 판정과 AI 상태 |
| `preferencePair(owner,artifactId)` | 선호 쌍: AI 원본(`ai`)·사람 확정본(`human`, 승인했거나 사람이 고친 현재 판)·판정 이력. 직접 작성한 작업물은 `null`. 조회용이며 학습에는 쓰지 않는다 |
