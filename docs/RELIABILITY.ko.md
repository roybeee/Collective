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

### 기능 스위치

`lib/feature-flags.ts`가 알려진 스위치와 기본값의 정본이다. 모두 기본 꺼짐이다: `online_grading`, `b1_reason_required`, `a4_auto_attribution`, `a2_downgrade`. 서버 코드는 `isEnabled(owner, flag)`로 읽는다. 저장은 소유자 범위 `feature_flag` 행(스위치당 1행)이며 행이 없으면 기본값이다. 캐시가 없어 쓰기는 다음 요청부터 반영된다(게시 불필요).

- 조회: `GET /api/feature-flags`(로그인한 모든 역할, 변경자는 소유자에게만).
- 변경: `POST /api/feature-flags` `{"action":"set","flag":"online_grading","enabled":false}`, 기본값 복귀는 `{"action":"reset","flag":"..."}`. 워크스페이스 소유자만(관리자·직원 403). 모르는 스위치·불리언이 아닌 값은 400.

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
- 저장: 전체 sha256, 섹션별 sha256, 섹션 요약(말단 경로 → 값 해시 앞 12자, 섹션당 200개)만 남긴다. 응답 원문·연결 키·주소는 저장하지 않는다. 배열 원소 경로는 짧은 `id`·`name`(주소처럼 보이는 값 제외) 또는 순번을 쓴다.
- 변경 경보: 직전 `passed` 스냅샷과 해시가 다르면 `gateway_change` 1건(바뀐 섹션별 추가·삭제·변경 경로, 종류별 20개까지), 같으면 0건. 첫 스냅샷은 기준값만 남긴다.
- 막힘: 세 요청 중 하나라도 실패·타임아웃·인증 오류면 그날 스냅샷을 `blocked`(해시 없음, 섹션 이름이 든 사유)로 남기고 경보는 만들지 않는다. 다음 UTC 날짜에 다시 재며 비교 기준은 마지막 `passed`다. 저장 자체가 실패하면 로그 `gateway_snapshot_failed` 1줄만 남는다. 어느 경우도 tick과 다른 작업을 막지 않는다.
- 건너뜀: 연결이 없거나 OpenAI 연결이면 기록 없이 건너뛴다(`not_run` 행을 만들지 않는다).
- 확인: `GET /api/usage`의 `gateway`(마지막 스냅샷 상태·해시, 최근 변경 5건)와 사용량 화면 모델 변경 경보 아래 줄.

### 평가 실행의 게이트웨이 기준 (F2b)

`eval_run.gatewaySnapshot`은 시작 시점 기준이다. `operational`은 운영 연결의 최신 `passed` 스냅샷(날짜·해시)이며 평가 연결 기준이 아니다(`basis:"operational"`). `eval`은 같은 스냅샷 함수로 시작 시점에 잰 평가 연결 해시다(`basis:"eval"`, 실패하면 `blocked`, 실행은 계속). 평가 연결 해시는 run에만 있고 `gateway_snapshot` 행을 만들지 않는다.

### 온라인 채점 (F2b)

`lib/online-grading.ts`. 기능 스위치 `online_grading`(기본 꺼짐)이 켜져 있으면 역할 작업물(`lib/role-execution.ts`)과 회의 작업물(`lib/meeting-execution.ts`)이 저장·job 완료·사용량 결과 기록을 모두 마친 직후 `lib/graders` 13종과 규제 가드레일로 채점한다.

- 기록: `grading`(id=`<작업물 id>:<버전>`, parent=캠페인). 채점기 판정·요약, 규제 점검 건수와 규칙(발췌 없음), 채점 소요 ms(`durationMs`, 채점기+규제 점검), 맥락(사실 원장 출처: 역할=현재 사실, 회의=회의 시작 스냅샷, 지점 캠페인 여부, 보고 입력 토큰). 업종·큐레이션 금지 표현은 운영 캠페인에 없어 비운다.
- 비차단: 채점기 하나의 예외는 그 채점기의 `grader_error` 1줄이다. 채점·저장이 실패하면 `status:"grader_error"` 기록 1건과 로그 `online_grading_grader_error` 1줄만 남고 작업물·job 상태·`domainOutcome`은 그대로다.
- 꺼짐: 스위치 1행만 읽고 채점기를 부르지 않는다. 캠페인을 지우면 채점 기록도 지운다(판정 근거에 작업물 발췌가 있다).
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

`tests/reliability.test.mjs`는 저장 실패·접수 응답 유실·서버 8역할 완주·사용자 승인 유지·큐 공정성·중단·삭제·OpenAI 접수 ID 보존을 확인한다. `tests/execution-identity.test.mjs`는 5개 HERMES 경로와 OpenAI 역할의 조인 키, 모델 변경 경보, 내보내기 권한·합계를, `tests/feature-flags.test.mjs`는 스위치 기본값·즉시 끄기·소유자 전용 쓰기를 확인한다. `tests/terminal-recovery.test.mjs`는 잘못된 완료 출력과 원장 주석 실패의 도메인 상태를 확인한다. 사용량·보안·상세 테스트와 E2E에는 비용 null, 버전 비교, 오래된 수정 거부, 단가 저장이 포함된다.

외부 모델 응답은 mocked다. E2E는 실제 Chromium과 로컬 D1, mocked 인증 헤더를 사용한다. 유료 모델 실호출과 새 소스의 운영 게시 검증은 별개이며 이 개발에서 수행하지 않는다.
