# 실행·사용량·작업물 보완

기준 소스 `69c366d`, 개발 브랜치 `feat/collective-reliability`. 운영 게시와 로컬 검증은 별개다.

## 실행과 복구

- 개별 역할의 job, 학습 snapshot, 공급자 요청 원문을 같은 D1 batch에 저장한 뒤 제출한다. HERMES는 영구 멱등 키로 복구하며, OpenAI의 불확실 접수는 기존 수동 확인 규칙을 유지한다.
- 바이럴 조사·분석·규칙 초안도 job/task/submission을 원자 저장한다.
- 모든 활성 실행은 최근 종료 이력 200건과 분리해 반환한다.
- 잘못된 완료 출력은 작업 실패로 종료하고 이미 발생한 사용량은 남긴다. 공급자 상태와 앱의 결과 처리 상태는 별개다.

## 서버 진행

`/api/research-worker`의 기존 machine token을 사용하는 워커가 조사, 일반 작업, 측정을 순환 처리한다. 일반 작업에는 개별 역할 결과 회수, 회의, 바이럴, 브리프, 사용자가 명시적으로 시작한 캠페인 연속 실행이 포함된다. 브라우저 인증 헤더를 합성해 내부 API를 호출하지 않고 owner를 검증한 공통 실행 서비스를 사용한다.

캠페인 연속 실행은 `campaign_sequence`에 동의를 저장한다. 브리프 변경·담당자 실패·사용자 중단은 다음 유료 실행을 멈춘다. 중단은 이미 접수된 공급자 작업의 취소와 다르며, 진행 중 작업은 별도 취소할 수 있다. 최종 작업물은 사람이 승인해야 한다. 캠페인 삭제는 예약과 요청 원문을 함께 삭제한다.

등록만 되고 서버 프로세스가 꺼져 있으면 무인 진행되지 않는다. 작업자가 오프라인인 경우 열린 화면은 개별 역할 결과를 회수할 수 있지만 새 역할 연속 시작은 서버 예약이 담당한다. 새 코드 게시 후 기존 Python 워커의 같은 tick 요청으로 기능이 활성화되며, 실제 서버/사이트 상태는 별도 검증해야 한다.

## 사용량과 비용

연결 및 설정의 **AI 사용량과 비용**에서 실행별 원장을 확인한다. 공급자가 보고한 실제 모델, 입력·출력·합계 토큰, terminal 사유, 앱 처리 결과를 보존한다. 누락은 `null`/미확인이며 0으로 바꾸지 않는다. 과거 실행을 추정해서 채우지 않는다.

사용자가 공급자·실제 모델·가격 버전·통화·출처·백만 토큰당 가격을 명시하면 그 이후 최초 관측되는 실행에 적용한다. 비용은 추정치이며 도구·캐시 할인·구독·세금·환율을 포함하지 않는다. 기존 실행은 가격 설정 변경으로 재계산하지 않는다. 후속 공급자 조회에서 누락 토큰이 보완되는 경우 최초 관측한 가격만 사용한다.

원본 사용량 저장 실패는 동일 실행을 재조회하게 한다. 후속 결과 분류 주석만 실패하면 `usage_outcome_write_failed`를 남기고 이미 완료한 도메인 작업을 실패로 되돌리지 않는다. 이 경우 사용량은 남고 처리 결과가 미확인일 수 있다.

### 사용량 조인 키 (F2a)

`provider_usage`는 첫 기록(INSERT) 때 조인 키를 한 번 채우고 이후 재조회로 바꾸지 않는다. 대상은 HERMES 5개 경로(역할·회의·브리프·조사·학습)와 OpenAI 역할 경로다. 모르는 값은 `null`이며 0이나 빈 문자열로 채우지 않는다. 이 기능 이전 행에는 키가 없다.

| 키 | 값 |
|---|---|
| `jobId` | `jobs.id`(역할·회의·조사·학습), 브리프는 초안 id |
| `campaignId`·`campaignVersion` | 실행 기준 캠페인과 브리프 버전. 조사는 `null`, 규칙 초안은 원천 실험의 캠페인 |
| `brandId`·`storeId` | 실행 기준 브랜드·지점. 역할은 제출 때 역할 계약(`role_output_contract.usageScope`)에 함께 저장한 값이라 실행 중 브리프가 바뀌어도 버전이 섞이지 않는다(값이 없는 계약은 `null`) |
| `kind`·`role` | `role`·`meeting`·`brief`·`research`·`learning`, 역할 id·회의 발언 역할·조사 단계·학습 작업 종류 |
| `promptVersion` | `<스킬 버전>:<지시 sha256 앞 12자>`. 스킬 버전이 없는 인라인 지시(브리프·조사·학습)는 `inline:<해시>` |
| `outputContractVersion` | 역할 계약(`role-output-v1`) 또는 조사 프로토콜. 회의·브리프·학습은 `null` |
| `artifactId` | 역할 작업물 id(`ai-<sha256(jobId) 앞 32자>`) |
| `appTree`·`durationMs` | 기록한 배포의 소스 트리(개발 실행은 `null`), 제출 원문 저장부터 종료 관측까지 |

제출 본문(HERMES·OpenAI로 보내는 요청)은 바꾸지 않는다. 지시 해시와 제출 시각은 저장된 제출 원문에서 읽는다. 사용량 화면은 캠페인·역할 열과 필터, `superseded`(작업물이 이전 버전이 됨 `outdated`, 브리프 버전이 올라가 기준이 무효 `brief_changed`)를 보여 준다.

### 보고 모델 변경 경보

대표 결정 10에 따라 HERMES 기반 모델은 별칭(`hermes-agent`)으로 두고 고정하지 않는다. 그래서 `usage_model_state` 1행(공급자별 마지막 보고 모델)과 새 보고 모델을 비교해 바뀌면 `model_change` 1건을 남긴다. HERMES 5개 경로는 같은 연결을 쓰므로 기반 모델 1회 변경은 실행 종류 수와 무관하게 1건이다. `kind`는 그 변경을 처음 관측한 실행의 종류(참고 정보)다. 같은 값 반복, 같은 실행 재조회, 모델을 보고하지 않은 실행은 0건이다. 처음 보고는 기준값만 남긴다. 모델 전환 중 늦게 끝난 이전 실행(기준값을 만든 실행보다 먼저 제출된 실행)이 이전 모델을 보고하면 비교하지 않는다. 기준값 실행보다 나중에 제출된 실행의 다른 모델은 실제 변경으로 1건이다. 어느 한쪽의 제출 시각을 모르면 그대로 비교한다. 별칭은 `actual: null`(실제 모델 미확인)로 적고 별칭에 단가를 걸 수 없다. `GET /api/usage`의 `modelChanges`(최근 20건)·`reportedModels`와 사용량 화면의 경보 배지로 확인한다. 경보 기록 실패는 `model_change_write_failed`만 남기고 사용량·도메인 처리를 막지 않는다.

### 토큰 예산 (PR 4a, loop-4)

`lib/token-budget.ts`. 단가를 몰라도 동작하도록 금액이 아니라 토큰으로 막는다. **기본값은 미설정**이며, 미설정이면 제출을 막지 않고 경고만 돌려준다(`GET /api/usage`의 `budget.warning`, 사용량 화면의 ‘상한 미설정’ 배지).

- 상한: 워크스페이스 월 상한 1개(`token_budget` id `workspace`)와 캠페인별 월 상한(id `campaign:<캠페인>`). 기간은 둘 다 한국 시간(KST, UTC+9) 달력 월이다(예: 9월 = `2026-08-31T15:00:00Z` 이상 `2026-09-30T15:00:00Z` 미만).
- 설정: `POST /api/usage` `{"action":"set_budget","scope":"workspace"|"campaign","campaignId":"…","monthlyTokens":2000000}`. `monthlyTokens:null`이면 그 상한을 지워 미설정으로 되돌린다. 워크스페이스 소유자만(관리자·직원 403, 비로그인 401, 다른 출처 403). 1~10,000,000,000 정수가 아니면 400, 모르는 캠페인은 404.
- 누계: 이번 달 `provider_usage` 보고 토큰(모든 공급자, 관측 시각 `observedAt` 기준, 총 토큰이 없으면 입력+출력, 둘 다 모르면 누계에서 빼고 `unknownUsage`로 따로 센다) + 진행 중 예약. 캠페인 누계는 F2a 조인 키 `campaignId`가 같은 행만 센다.
- 진행 중 예약(`token_reservation`, 제출 1건당 1행): 가드를 통과한 제출의 예상 토큰·실행 종류·캠페인·실행 번호·멱등 키 해시. 요청 원문은 담지 않고 `hermes_submission` 원문도 바꾸지 않는다. 토큰을 아는 종료 사용량이 기록되면(`pollHermes`) 지운다. 실행 번호 기록이 실패해 `runId`가 비어 있어도 제출 id로 찾아 지운다. 종료 사용량이 토큰을 보고하지 않았으면(실패 실행 등) 예약을 지우지 않고 예상치로 계속 센다(누계에서 0으로 빠지지 않게). HERMES가 새 요청을 4xx로 확정 거절하면 푼다. 429(미접수·재시도 예정)·연결 오류·5xx(접수 불확실)와 같은 멱등 키의 복구 재전송이 받은 4xx(원래 요청이 이미 접수됐을 수 있음)는 예약을 남겨 달이 끝날 때까지 또는 복구·종료 때까지 센다.
- 예상 토큰: `max(입력 추정, 같은 실행 종류의 최근 종료 실행 20건 평균 보고 토큰)`. 입력 추정은 제출 본문 전체의 `max(문자 수/2, UTF-8 바이트/3)` 올림이다. 영어·JSON은 흔히 3~4자당 1토큰이라 문자 수/2가 넉넉하고, 한글은 1자당 1토큰 가까이 쓰일 수 있어 바이트/3(한글 1자 = 3바이트)과 비교한다. 입력 추정에는 HERMES 에이전트 자체 지시·도구 호출·출력 토큰이 빠져 실제 사용량보다 크게 작을 수 있어(운영 관찰 조사 1회 평균 약 339k, `docs/observations/2026-09-23-live-run.md`) 같은 종류의 최근 평균과 비교한다. 실행 종류는 사용량 조인 키 `kind`와 같은 규칙이다(브리프는 `brief-` 제출, 역할·학습은 jobs 행의 역할, 회의는 캠페인을 부모로 둔 그 밖의 제출, 조사는 브랜드를 부모로 둔 제출). 종료 후에는 실제 보고 토큰이 예상을 대신한다.
- 가드: `lib/hermes.ts` `submitHermes`가 `/v1/runs` 요청 직전에 `reserveTokenBudget`을 부른다. 확인과 예약 기록은 SQL 한 문장(조건부 `INSERT … SELECT … WHERE 누계 + 다른 진행 중 예약 + 이번 예상 <= 상한`)이라 동시에 들어온 제출이 서로의 예약을 못 본 채 함께 통과하지 않는다. 쓰지 못하면 누계를 다시 읽어(`assertTokenBudget`) 요청을 보내지 않고 409 `토큰 예산 초과: 남은 예산 N토큰 · …`(`TokenBudgetExceeded`)를 던진다(워크스페이스·캠페인 중 남은 예산이 적은 쪽). 역할(start·recover)·회의(advance·recover)·브리프·브랜드 조사·바이럴 학습 5개 운영 경로가 모두 이 함수로 제출한다(`tests/token-budget.test.mjs`가 경로별 409와 `/v1/runs` 제출 위치를 확인). 각 경로는 기존 규칙대로 작업을 ‘실패’로 남기고 사유에 이 문구를 보인다. 캠페인 연속 실행은 실패한 작업을 보고 ‘막힘’으로 멈춘다.
- 제출의 캠페인: 역할·회의는 제출 원문의 부모 캠페인, 브리프는 초안의 `campaignId`, 실험 규칙 초안은 원천 실험의 캠페인, 조사·사례 분석·주제 조사는 없음(워크스페이스 상한만).
- 복구: 같은 멱등 키의 재전송(접수 확인 복구)은 이미 통과한 요청이라 다시 막거나 두 번 세지 않는다. 이 기능 이전에 저장된 제출처럼 예약이 없는 복구는 새 요청처럼 가드를 거친다. 브랜드 조사는 복구 중 예산 초과를 ‘접수 확인 지연’으로 가리지 않고 사유와 함께 실패로 남긴다. 회의 복구(`lib/meeting-execution.ts` catch의 `unknown=recovering||…`)는 같은 경우를 아직 ‘확인 지연’으로 보이고, 역할 복구는 409 사유를 보이지만 작업이 ‘확인 필요’에 남는다. 두 경로는 F3 뒤 후속이다.
- 한계(소프트 캡): 예약은 제출 시점의 예상일 뿐이다. 이미 가드를 통과한 진행 중 실행의 실제 사용량이 예상보다 크면 월 누계가 상한을 넘을 수 있다. 사용량 화면에도 이 점을 적는다.
- 평가 실행(`lib/eval-server.ts`, F1b-2)은 별도 평가 연결과 결정 5의 별도 월 예산(1.5M, UTC 월)을 쓰고 `submitHermes`·`provider_usage`를 거치지 않는다. 그래서 이 가드가 평가를 다시 막지 않고, 평가 사용량도 운영 누계에 들어가지 않는다.
- 확인: `GET /api/usage`의 `budget`(`month`·`workspace`·`campaigns`·`campaignOptions`·`warning`)과 사용량 화면의 ‘이번 달 토큰 예산’(상한·사용·진행 중 예상·남은 예산, 소유자에게만 설정 양식).
- 캠페인 삭제: 캠페인별 상한 행은 `data.campaignId`로 캠페인과 함께 지운다(`lib/record-kinds.ts` `data_campaign`, 삭제 영향 대화상자의 ‘캠페인 토큰 상한’). 워크스페이스 상한과 예약은 남는다.
- 후속(`loop-4` 미해결 부분): 실행 1회 상한(성장 계획 지표 ‘조사 1회 토큰 → 1회 상한 이하’)과 HERMES 요청에 역할별 출력 토큰 상한(`practices[role].maxTokens`)을 전달하는 것은 gateway 지원 확인 후다. 그 전까지는 월 상한이 하드캡이 아니다(위 한계). OpenAI 직접 경로(`lib/role-execution.ts` `openai('responses')`)는 이번 가드를 거치지 않는다(사용량은 누계에 들어간다).

### 별칭 단가 선언 (PR 4a, loop-5)

대표 결정 10에 따라 별칭 `hermes-agent`를 유지하므로 공급자가 기반 모델을 보고하지 않는다. 모델 단가 등록(`set_pricing`)은 여전히 별칭을 거부하고, 원장 원본(`provider_usage`의 `costAmount`·`priceVersion`)은 바꾸지 않는다.

- 선언: `POST /api/usage` `{"action":"set_alias_pricing","baseModel":"…","priceVersion":"…","currency":"USD","inputPerMillion":2,"outputPerMillion":8,"source":"https://…","effectiveFrom":"2026-09-01"}`. 워크스페이스 소유자만(관리자·직원 403). 기반 모델에 별칭을 넣거나, 날짜가 `YYYY-MM-DD` 달력 날짜가 아니거나, 근거가 HTTPS가 아니면 400. 같은 적용 시작일은 덮어쓴다(`usage_alias_pricing`).
- 추정: 선언 단가는 읽을 때(`listProviderUsage`) 별칭 실행에만 적용한다. 실행의 관측 시각 이전에 시작한(한국 시간 그날 0시) 가장 늦은 선언을 쓰고, `reestimatedCost = (입력×입력 단가 + 출력×출력 단가)/1,000,000`과 `reestimatePriceVersion`·`reestimateBaseModel`·`reestimateCurrency`·`reestimateSource`를 덧붙이며 `costStatus`는 `declared_estimate`다. 그래서 선언 전의 과거 실행도 추정치가 보인다. 입력·출력 토큰 중 하나라도 모르면 `reestimatedCost:null`(`reestimateNote:"tokens_unknown"`).
- 경보: 선언의 적용 기간 안에 경보가 있으면 선언 단가는 경보 이전 기간만 유효하다. 경보는 보고 모델 변경(`model_change`, 같은 공급자)과 게이트웨이 스냅샷의 `models` 섹션 변경(`gateway_change`, F2b)이다. 결정 10으로 HERMES는 계속 `hermes-agent`만 보고하므로 별칭 뒤 기반 모델 교체는 보고 모델 변경으로는 드러나지 않고 게이트웨이 스냅샷으로 드러난다(성장 계획 설계 원칙 7). 경보 이후 실행은 추정하지 않고(`reestimateNote:"after_model_change"`), `GET /api/usage`의 `aliasPricingWarning`과 화면에 ‘선언 단가는 경보 이전 기간만 유효’ 경고를 보인다. 경보 뒤에도 쓰려면 기반 모델을 확인해 경보 다음 날짜를 적용 시작일로 다시 선언한다. 경보 뒤에 시작한 선언이 있으면 그 경보는 해소된 것으로 보고 경고를 지운다.
- 별칭이 아닌 실제 모델 행(OpenAI 포함): 관측 때 단가가 없어 원장 금액이 비어 있고 입력·출력 토큰을 알면, 나중에 등록한 같은 공급자·모델 단가(`usage_pricing`)로 읽을 때 `reestimatedCost`·`reestimatePriceVersion`·`reestimateCurrency`·`reestimateSource`를 계산하고 `costStatus`는 `reestimated`다. 관측 때 단가로 계산된 행과 원장 원본은 바뀌지 않는다.
- 표시: 사용량 화면 비용 열은 ‘선언 단가 추정’·‘나중 등록 단가 추정’으로 원장 추정과 구분한다. CSV 내보내기(`lib/usage-export.ts`)는 원장 `costAmount` 옆에 `reestimatedCost`·`reestimateCurrency`·`reestimatePriceVersion`·`reestimateBaseModel` 열을 따로 싣는다.

### 커넥터 응답 한도와 조사 결과 예외 문구 (PR 4a, security-ops-11)

- Instagram·네이버 검색광고 커넥터는 응답을 200KB 한도 안에서만 읽는다(`readBoundedJson`). 넘으면 파싱하지 않고 502로 끝난다. 네이버 연결 확인(`verify`)은 인증(2xx)만 보고 캠페인 목록 본문은 읽지 않아 캠페인이 많은 계정도 연결된다.
- 브랜드 조사 결과 처리에서 `ApiError`가 아닌 예외(TypeError 등)는 조사 기록·화면에 고정 문구 ‘조사 결과를 처리하지 못했습니다. 다시 시도해 주세요.’만 남기고, 로그에는 오류 이름·코드만 남긴다(`research_result_unexpected_error`).
- 잔여: 실험 과제 원소가 null이면 422가 아니라 TypeError로 실패하는 파서 동작(`lib/deep-research-server.ts`)은 그 파일이 PR 6 앱 측 레인 잠금이라 A7로 넘겼다(`docs/IMPROVEMENT-PLAN.ko.md` 배정 변경). A7이 422로 바꾸고 `tests/validate.test.mjs`의 알려진 결함 검사도 함께 바꾼다.

### 기능 스위치

`lib/feature-flags.ts`가 알려진 스위치와 기본값의 정본이다. 모두 기본 꺼짐이다: `online_grading`, `b1_reason_required`, `a4_auto_attribution`, `a2_downgrade`. 서버 코드는 `isEnabled(owner, flag)`로 읽는다. 저장은 소유자 범위 `feature_flag` 행(스위치당 1행)이며 행이 없으면 기본값이다. 캐시가 없어 쓰기는 다음 요청부터 반영된다(게시 불필요).

- 조회: `GET /api/feature-flags`(로그인한 모든 역할, 변경자는 소유자에게만).
- 변경: `POST /api/feature-flags` `{"action":"set","flag":"online_grading","enabled":false}`, 기본값 복귀는 `{"action":"reset","flag":"..."}`. 워크스페이스 소유자만(관리자·직원 403). 모르는 스위치·불리언이 아닌 값은 400.

#### A2 런타임 하향 (`a2_downgrade`)

`lib/online-grading.ts`. 규제 가드레일(`lib/graders/compliance.ts`)을 운영 저장 경로에 연결하되 판정은 내리기만 한다. 역할 실행·회의가 저장한 작업물(`gradeSavedArtifacts`·`gradeMeetingArtifacts` 대상)을 온라인 채점과 같은 자리(저장·job 완료·사용량 결과 기록 뒤, 소유자 잠금을 푼 `finally`)에서 점검한다.

- 점검: `online_grading`이 켜져 있으면 그 채점의 규제 점검 결과를 재사용한다(점검 1회). 꺼져 있어도 `a2_downgrade`만으로 점검한다. 이때 `grading` 기록은 기존 규칙대로 쓰지 않는다. 회의 경로는 그 회의가 저장한 레코드(`meetingId`가 그 회의)만 점검한다. 잠금이 풀린 뒤 사람이 저장한 새 버전은 `meetingId`가 없어 대상이 아니다(채점 대상은 기존 그대로).
- 입력 상한: 온라인 채점과 같은 `MAX_GRADED_LINES`(2,000줄)를 넘는 작업물은 점검하지 않고 hold도 남기지 않는다(로그 `a2_downgrade_not_run`, 이름만). 규제 점검도 줄 수에 비례 이상으로 느려지기 때문이다(로컬 실측: 빈 줄 2,001줄 4ms·10,001줄 51ms·20,001줄 202ms·40,000줄 795ms, `문자 초안:` 5,715줄 833ms, 상한 이내 `앱 푸시 문안:` 2,000줄 133ms). 상한을 넘는 작업물은 미탐 위험이 있으므로 게시 전 담당자 확인이 그대로 필요하다.
- 차단 표시: block 위반이 있으면 작업물에 `complianceHold`(`version` 사전 버전, `block` 건수, `issues` 최대 20건의 `category`·`ruleId`·`title`·`excerpt`, `checkedAt`, `notice`)를 남긴다. warn·info만 있으면 쓰지 않는다. 하향만 한다: block이 없어도 기존 hold를 지우지 않고, hold가 이미 있으면 덮지 않는다. 사람이 새 버전을 저장하면 새 버전에는 필드가 없어 자연히 사라진다.
- 품질 검수 하향: 품질 검수 작업물(`role:"quality"`, `qualityReview` 있음)을 저장하면 같은 캠페인·같은 캠페인 버전의 현재(outdated 아님) 작업물(품질 검수 자신 포함) 중 hold가 있거나 이번 점검에서 block이 나온 것이 있을 때 `downgradeVerdict`로 `ready_for_review`만 `revise`로 내린다. 문구는 저장된 hold(화면에 보이는 것)로 만들고, 없을 때만 같은 버전의 이번 점검 결과로 만든다. `gateIssues`(없는 이전 형식이면 `findings` 끝)에 `A2 규제 점검: <작업물 제목> — <규칙 제목> 외 N건`(역할 순서)과 법률 자문 아님 고지를 더하고 `content`를 `qualityMarkdown`으로 다시 만든다. `checks` 5기준·`taskChecks`·`reportedVerdict`는 그대로다. 이미 `revise`·`needs_data`면 문구만 더한다.
- 캠페인 상태: 판정을 `ready_for_review`에서 `revise`로 실제로 내렸으면 역할·회의 저장 규칙(판정이 `ready_for_review`가 아니면 캠페인 `revision`)과 맞게 캠페인을 `revision`(수정 요청)으로 내린다. 캠페인이 `review`이고 같은 캠페인 버전일 때만 쓴다(`UPDATE records SET data=json_set(data,'$.status','revision','$.updatedAt',?),updated_at=? WHERE id=? AND owner=? AND kind='campaign' AND json_extract(data,'$.version')=? AND json_extract(data,'$.status')='review'`). 승인·실행 중 등 다른 상태는 바꾸지 않는다. hold만 썼거나 문구만 더했으면 같은 캠페인 버전일 때 캠페인 `updatedAt`만 올려 캠페인 상세 화면이 다시 읽게 한다.
- compare-and-set: `UPDATE records SET data=? WHERE id=? AND owner=? AND kind='artifact' AND json_extract(data,'$.version')=? AND json_extract(data,'$.status')='review' AND data=?`. 저장 뒤 버전이 바뀌었거나(사람이 수정) `review`가 아니면(승인·수정 요청·outdated) 쓰지 않는다. 읽은 뒤 다른 표시(브랜드·사실 변경 등)가 붙어 `changes`가 0이면 한 번만 다시 읽어, 버전·상태가 그대로일 때 그 본문 위에 다시 쓴다(표시 보존). 두 번째도 0이면 조용히 건너뛴다. 작업물 `updated_at`은 바꾸지 않는다(작업물 목록 순서 유지).
- 알려진 한계: A2는 잠금 밖에서 쓴다. 잠금을 잡은 쓰기(브랜드·사실 변경 표시처럼 작업물 전체를 다시 쓰는 경로)가 A2보다 먼저 읽고 나중에 쓰면 방금 쓴 hold가 사라질 수 있다(lost update, 품질 검수에 더한 문구와 캠페인 상태는 남는다). 연속 실행(`advance_sequence`)이 역할 저장과 A2 하향 사이에 끼어들면 하향 전 판정을 읽어 `completed`로 끝날 수 있다. 두 경우 모두 창은 A2 실행 시간(상한 이내 작업물 1개당 수 ms~약 130ms)이다.
- 수정 이력: 버전을 올리지 않는 같은 버전의 표시·검수 보정이라 `history` 행을 만들지 않는다(`brandChanged`·`factsChanged` 표시와 같은 규칙). 사람이 작업물을 수정 저장하면 기존 규칙대로 이전 버전(hold 포함)이 `history`에 남는다. 승인은 막지 않는다.
- 비차단: 예외는 삼키고 로그 `a2_downgrade_error` 1줄(이름만, 작업물 원문 없음)만 남긴다. 상한 초과로 건너뛰면 `a2_downgrade_not_run` 1줄이다. 역할·회의 결과, job 상태, `domainOutcome`은 그대로다.
- 끄는 방법: `POST /api/feature-flags` `{"action":"set","flag":"a2_downgrade","enabled":false}` 또는 `{"action":"reset","flag":"a2_downgrade"}`(기본 꺼짐). 다음 저장부터 점검·하향이 0회다. 두 스위치가 모두 꺼져 있으면 작업물·`grading` 기록은 스위치 도입 전과 바이트 단위로 같다. 이미 남은 hold는 그 버전이 바뀔 때까지 표시된다.
- 확인: 캠페인 상세 작업물 탭 끝(온라인 채점 표시 자리)에 작업물별 `규제 점검 차단 N건 — 게시 전 담당자 확인 필요`, 이슈(규칙 제목·발췌·출처 수), 고지를 보인다. hold가 없으면 표시하지 않는다.
- 고지: 이 점검은 표시·광고 관련 법령과 공식 지침의 일부 표현을 찾는 자동 점검이며 법률 자문이 아니다. 적발되지 않았다고 적법하다는 뜻이 아니며, 게시 전 담당자가 원문 규정과 플랫폼 정책을 확인한다.
- 테스트: `tests/a2-runtime.test.mjs`(`passed · mocked`).

### 소유자 전용 내보내기

`GET /api/usage/export`는 워크스페이스 소유자만 읽는다(비로그인 401, 관리자·직원 403, 다른 소유자의 캠페인 404).

- `type=usage_csv`(기본): 조인 키를 포함한 `provider_usage` CSV. `campaignId`·`kind`·`role` 필터는 사용량 화면과 같은 함수라 합계가 화면과 같다. 모르는 값은 빈 칸이다.
- `type=submissions&campaignId=`: 캠페인의 HERMES 제출 원문(`instructions`·`input`)과 지시 해시. 새 `session_id`만 붙이면 같은 요청을 다시 만들 수 있다.
- 둘 다 소유자 id 접두어를 뗀 id를 쓰고 멱등 키·연결 주소·암호·계정 이메일을 넣지 않는다.

### 게이트웨이 상태 스냅샷 (F2b)

`lib/gateway-snapshot.ts`. 워커 tick(`lib/research-worker.ts`)이 작업 순환 전에 부른다. 소유자당 UTC 하루 1회이며, 마지막 `gateway_snapshot` 행의 시각이 오늘(UTC)이면 건너뛴다(행 id도 UTC 날짜라 하루 1행).

- 대상: 운영 HERMES 연결의 `GET /v1/capabilities`·`/v1/toolsets`·`/v1/models`. 세 요청은 병렬, 호출당 타임아웃 5초라 tick(60초 제한)에 더해지는 시간은 최대 5초다.
- 정규화: 객체 키 정렬, 배열은 원소 JSON 순으로 정렬, 아래 변동 필드를 모든 깊이에서 제거한다. 실제로 지운 필드 이름은 스냅샷 `removedFields`에 남는다.
  `created` `created_at` `createdAt` `updated_at` `updatedAt` `timestamp` `time` `now` `server_time` `serverTime` `generated_at` `generatedAt` `expires_at` `expiresAt` `request_id` `requestId` `trace_id` `traceId` `uptime` `uptime_seconds` `started_at` `startedAt`
- 저장: 전체 sha256, 섹션별 sha256, 섹션 요약(말단 경로 → 값 해시 앞 12자, 섹션당 200개)만 남긴다. 응답 원문·연결 키·주소는 저장하지 않는다. 배열 원소 경로는 짧은 `id`·`name` 또는 순번을 쓴다. 경로에 쓰는 객체 키·라벨이 주소처럼 보이면(`://`·`@`·공백, host:port, IPv4, IPv6 `::`, 마지막 마디가 영문 2자 이상인 점 이은 이름) 또는 80자를 넘으면 원문을 쓰지 않는다. 키는 `(가림 <키 sha256 앞 8자>)` 별칭(날짜 사이 같은 별칭이라 변경 비교 유지), 라벨은 순번이다. `gpt-4.1-mini`처럼 마지막 마디에 숫자가 있는 모델 id는 그대로 쓴다.
- 변경 경보: 직전 `passed` 스냅샷과 해시가 다르면 `gateway_change` 1건(바뀐 섹션별 추가·삭제·변경 경로, 종류별 20개까지), 같으면 0건. 첫 스냅샷은 기준값만 남긴다.
- 막힘: 세 요청 중 하나라도 실패·타임아웃·인증 오류면 그날 스냅샷을 `blocked`(해시 없음, 섹션 이름이 든 사유)로 남기고 경보는 만들지 않는다. 다음 UTC 날짜에 다시 재며 비교 기준은 마지막 `passed`다. 저장 자체가 실패하면 로그 `gateway_snapshot_failed` 1줄만 남는다. 어느 경우도 tick과 다른 작업을 막지 않는다.
- 건너뜀: 연결이 없거나 OpenAI 연결이면 기록 없이 건너뛴다(`not_run` 행을 만들지 않는다).
- 확인: `GET /api/usage`의 `gateway`(마지막 스냅샷 상태·해시, 최근 변경 5건)와 사용량 화면 모델 변경 경보 아래 줄.

### 평가 실행의 게이트웨이 기준 (F2b)

`eval_run.gatewaySnapshot`은 시작 시점 기준이다. `operational`은 운영 연결의 최신 `passed` 스냅샷(날짜·해시)이며 평가 연결 기준이 아니다(`basis:"operational"`). `eval`은 같은 스냅샷 함수로 시작 시점에 잰 평가 연결 해시다(`basis:"eval"`, 실패하면 `blocked`, 실행은 계속). 평가 연결 해시는 run에만 있고 `gateway_snapshot` 행을 만들지 않는다.

### 온라인 채점 (F2b)

`lib/online-grading.ts`. 기능 스위치 `online_grading`(기본 꺼짐)이 켜져 있으면 역할 작업물(`lib/role-execution.ts`)과 회의 작업물(`lib/meeting-execution.ts`)이 저장·job 완료·사용량 결과 기록을 모두 마치고 소유자 변경 잠금(`acquireLock`)을 푼 뒤(`finally`) `lib/graders` 13종과 규제 가드레일로 채점한다. 채점하는 동안 같은 소유자의 다른 변경은 409로 막히지 않는다. 응답은 채점이 끝난 뒤 돌아간다.

- 기록: `grading`(id=`<작업물 id>:<버전>`, parent=캠페인). 채점기 판정·요약, 규제 점검 건수와 규칙(발췌 없음), 채점 소요 ms(`durationMs`, 채점기+규제 점검), 맥락(사실 원장 출처: 역할=현재 사실, 회의=회의 시작 스냅샷, 지점 캠페인 여부, 보고 입력 토큰). 업종·큐레이션 금지 표현은 운영 캠페인에 없어 비운다.
- 비차단: 채점기 하나의 예외는 그 채점기의 `grader_error` 1줄이다. 채점·저장이 실패하면 `status:"grader_error"` 기록 1건과 로그 `online_grading_grader_error` 1줄만 남고 작업물·job 상태·`domainOutcome`은 그대로다.
- 입력 상한: 일부 채점기는 줄 수가 늘면 비례 이상으로 느려진다(로컬 실측: 2,000줄 이하 합성 최악 입력 약 110ms 이하, 빈 줄 20,000줄 약 0.5초·40,000줄 약 2.3초). 2,000줄(`MAX_GRADED_LINES`)을 넘는 작업물은 채점기를 부르지 않고 `status:"not_run"`(`reason:"too_many_lines"`, `lines`) 기록만 남긴다. 채점기 구현(`lib/graders`)은 평가 실행과 같은 기준이어야 해서 상한은 입력에만 둔다.
- 꺼짐: 스위치 행(`online_grading`·`a2_downgrade` 2행)만 읽고 채점기를 부르지 않는다(`a2_downgrade`만 켜져 있으면 위 규제 점검만 한다). 캠페인을 지우면 채점 기록도 지운다(판정 근거에 작업물 발췌가 있다). 잠금 밖에서 쓰므로 grading 행은 캠페인 행이 아직 있을 때만 쓴다(그사이 삭제되면 행을 남기지 않는다).
- 확인: `GET /api/usage?grading=<캠페인 id>`와 캠페인 상세 작업물 탭 끝의 작은 자동 점검 요약(현재 작업물 id·버전과 같은 채점만). 승인·품질 판정이 아니다.

## 상세·버전·성과

캠페인 상세는 owner 범위 `/api/campaigns/[id]`에서 읽는다. 이력 탭은 현재·이전 작업물 원문을 나란히 표시하며 승인을 대신하거나 자동 복원하지 않는다.

새 성과 기록은 측정 시작/종료일, 비교 범위, 출처, 집계 정의, 수집 방식을 요구한다. 미확인 비용은 null이며 비용이 하나라도 없으면 잔액을 확정하지 않는다. 같은 범위의 기간 중복, 소수 주문 수, 오래된 버전의 덮어쓰기를 거부한다. 기존 자유문자열 기간은 legacy로 유지하고 출처를 만들어내지 않는다. 기존 기록을 새 형식으로 수정할 때 버전을 증가시킨다.

현재 workspace의 전체 계정 데이터 조회는 호환을 위해 유지한다. 상세 API가 생겼다고 목록 전송량 최적화까지 완료한 것은 아니다.

## 운영 적용 조건

- `RESEARCH_WORKER_ADMIN_IDS`를 설정하지 않으면 설치 파일 다운로드는 거부된다. 기존 worker token과 tick은 계속 유효하다.
- 일반 JSON 요청은 실제 수신량 200,000 UTF-8 바이트 한도다. 대형 한글 요청은 이전 문자 수 기준보다 일찍 거부될 수 있다.
- Sites 익명 헤더 검사와 실제 로그인 간 격리는 다른 검사다. [보안 경계](SECURITY-BOUNDARIES.ko.md)를 따른다.
- GitHub 소스 반영, Sites 게시, `/api/version` tree 확인을 각각 보고한다. 이번 개발만으로 운영 환경·gateway 도구 권한이 바뀌지는 않는다.

## 회귀 검증

`tests/reliability.test.mjs`는 저장 실패·접수 응답 유실·서버 8역할 완주·사용자 승인 유지·큐 공정성·중단·삭제·OpenAI 접수 ID 보존을 확인한다. `tests/execution-identity.test.mjs`는 5개 HERMES 경로와 OpenAI 역할의 조인 키, 모델 변경 경보, 내보내기 권한·합계를, `tests/feature-flags.test.mjs`는 스위치 기본값·즉시 끄기·소유자 전용 쓰기를, `tests/token-budget.test.mjs`는 예산 미설정 통과·경고, 설정 초과 409(5개 HERMES 경로), 진행 중 예약(종류별 최근 평균, 토큰 미보고 종료 실행 유지, 실행 번호 없는 예약 정리), 동시 예약 1건만 통과, 한국 시간 월 경계, 캠페인 예산, 같은 요청 복구(429 뒤 재전송, 예약 없는 조사 복구의 예산 초과 실패), 소유자 전용 설정을, `tests/usage-summary.test.mjs`는 별칭 선언 단가 재추정·경보(보고 모델·게이트웨이 models 섹션) 이후 제외·재선언 뒤 경고 해소·나중 등록 단가 재추정·CSV 재추정 열·원장 불변을 확인한다. `tests/terminal-recovery.test.mjs`는 잘못된 완료 출력과 원장 주석 실패의 도메인 상태를 확인한다. 사용량·보안·상세 테스트와 E2E에는 비용 null, 버전 비교, 오래된 수정 거부, 단가 저장이 포함된다.

외부 모델 응답은 mocked다. E2E는 실제 Chromium과 로컬 D1, mocked 인증 헤더를 사용한다. 유료 모델 실호출과 새 소스의 운영 게시 검증은 별개이며 이 개발에서 수행하지 않는다.
