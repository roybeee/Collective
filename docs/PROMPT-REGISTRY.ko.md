# 프롬프트 레지스트리 (F3a·F3b)

결론: 역할 스킬·채널/업종 스킬·바이럴 발견 지시는 git `prompts/`가 정본이고, 운영에는 소유자가 지정한 커밋의 본문을 불변 버전(`prompt_version`)으로 등록한 뒤 단위별 포인터(`prompt_release`)로만 바꾼다. 레지스트리가 비어 있거나 active가 없으면 코드 상수로 실행하며, 지시·입력·inputHash가 도입 전과 바이트 동일하다(시드 작업물 회의와 역할 8개 실행 작업물로 연 회의 모두).

비유: 식당 주방의 레시피 카드와 같다. 카드 원본은 본사 서류함(`prompts/`, git)에 있고, 주방에는 본사가 도장 찍은 사본(불변 버전)만 붙인다. 어느 사본을 쓸지는 게시판 핀(포인터) 하나로 바꾸고, 핀을 빼면 주방이 외우고 있는 기본 레시피(코드 상수)로 돌아간다. 사본 글씨가 번졌으면(손상) 기본 레시피로 요리하고 "기본 레시피로 만듦" 표시를 남긴다.

- 코드: `lib/prompt-units.ts`(순수: 단위 목록·파일 형식·본문 검사), `lib/prompt-registry.ts`(등록·해석·고정·롤백·영향 범위·매니페스트·활성화 게이트), `app/api/prompts/route.ts`, `app/api/version/route.ts`(`promptManifest`)
- 활성화 게이트(F3b): `lib/eval-server.ts`(쌍 평가 `pair` run), `lib/eval-stats.ts`(`pairGate`·`pairReport`, 순수), `lib/usage-model-alarm.ts`(`alarmState`·경보 확인 기록), `app/api/eval/route.ts`
- 연결: `lib/practice.ts`(`rolePractice`·`campaignPractice`가 해석 본문을 받음), `lib/role-instruction.ts`, `lib/role-execution.ts`, `lib/meetings.ts`, `lib/meeting-execution.ts`, `lib/learning-execution.ts`(바이럴 발견 지시만), `lib/usage-ledger.ts`(`promptVersion`·`promptFallback` 조인 키)
- 검사: `scripts/check-prompts.mjs`(CI verify 잡 `Prompt registry sources` 단계)
- 테스트: `tests/check-prompts.test.mjs`, `tests/prompt-registry.test.mjs`, `tests/prompt-resolution.test.mjs`, `tests/prompt-baseline.test.mjs`, `tests/prompt-activation.test.mjs`(모두 합성 데이터, `passed · mocked`)
- 활성화 게이트(F3b, 대표 결정 2·5·10): 서버 `eval_run` 쌍 비교(`pair`) + 대표(owner) 승인 + 지정 캠페인 `stage` → `promote`. 비율(%) 카나리와 자동 승격은 없다. 아래 '활성화 게이트'와 '운영 런북' 절.

## 단위와 소유 경계 (대표 결정 3)

| 단위 | 본문 | 코드가 계속 소유하는 것 |
|---|---|---|
| `role.<cmo·insight·strategy·creative·content·growth·data·quality>` | `{focus,methods,outputs,review,handoff}` | 머리말 `실무 스킬 <PRACTICE_VERSION>`, `필수 산출물:`·`완료 전 점검:`·`인계:` 제목, 분량 지시, 회의 발언 지시, `maxTokens`, 출력 계약 섹션(`lib/role-output.ts`, 제목·수) |
| `channel.<shortform·youtube·community·search·commerce·offline·default>` | 문자열 | 적용 조건(정규식), `campaignEvidencePolicy` |
| `viral.discovery` | 문자열(`viralPractice`) | 연구원 역할 문장, 조사 도구·oEmbed 경로, 출력 스키마 |

- 근거 규율(`evidenceDiscipline`)·사실 정책(`factPolicy`)·출력 계약·외부 행동 금지·JSON 계약 지시는 덮어쓸 수 없다. 그 문구(정책 문장 머리, `근거 규칙`·`필수 산출물`·`완료 전 점검`·`인계:`·`실무 스킬` 제목, 입력·계약 필드명(`evidence.facts`·`candidate`·`sections` 등), `JSON`·`제이슨`, 코드펜스, `외부 행동`·광고 집행·메시지 발송·직접 게시·결제 같은 외부 행동 지시, `근거가 없어도`·`확정 사실처럼` 같은 사실 정책 뒤집기)를 담은 본문은 거부한다. 띄어쓰기·전각·구두점 변형도 같은 표지로 본다.
- 역할 항목·채널 본문·바이럴 본문에는 줄바꿈을 둘 수 없다(가짜 섹션 제목 방지). 코드 소유 섹션 제목은 코드만 만든다.
- 역할 스킬 `outputs` 수는 출력 계약 섹션 수와 같아야 한다. 계약 섹션 제목은 코드 상수 그대로다(본문의 산출물 문구와 다를 수 있다. 평가는 F3b 쌍 비교가 맡는다).
- `prompts/`에는 브랜드를 식별할 수 없는 일반 스킬만 둔다. 브랜드 특화 내용은 D1에만 둔다.

## 정본 파일 (`prompts/<단위>.json`)

```json
{"schema": 1, "unit": "role.cmo", "body": {"focus": "…", "methods": ["…"], "outputs": ["…"], "review": ["…"], "handoff": "…"}}
```

- 단위마다 파일 하나. 파일 이름이 단위다. 다른 파일은 두지 않는다.
- F3a 도입 시점의 정본은 코드 상수와 본문이 같다(`tests/check-prompts.test.mjs`의 `codeEqualUnits`). 개선 본문을 제안하는 PR은 그 단위를 목록에서 빼고, 병합 뒤 등록·평가(F3b)·활성화한다. 코드 상수는 폴백으로 남는다.
- `prompts/`는 비제품 경로다. 앱 소스(`app`·`lib`·`server`·`components`·`hooks`)가 import하면 검사가 실패한다. 운영 반영은 등록·활성화로만 하고 게시(`published`)가 필요 없다.

## CI 검사 (`node scripts/check-prompts.mjs [디렉터리]`)

통과하지 않으면 비영 종료하고 `FAIL <파일>: [사유] 메시지`를 쓴다. 사유: `schema`(형식·파일 이름·unit 불일치), `hidden`(줄바꿈·제어 문자, 너비 없는 공백·양방향 제어·Unicode Tags 같은 형식 문자, 이체 선택자, 사용자 정의 영역·미할당 문자, NFC가 아닌 본문), `missing`(단위 파일 없음), `length`(단위당 6,000자 초과), `code_owned`, `injection`(이전·앞서·지금까지의 지시 무시, 상위 규칙보다 우선, system prompt, 역할 전환 요구 등), `url`(URL·hxxp·www·모든 TLD의 도메인과 `[.]`·`dot` 표기·IPv4·`//호스트`·`data:`·`@계정`), `brand`(코드 시드 브랜드명과 그 앞부분·약칭·`<한글 표기> / <브랜드명>` 병기·코드에 이미 공개된 한글 표기 `codeBrandAliases`), `price`(`원`·`₩`·통화 코드), `product_import`. 등록 API도 같은 규칙(`lib/prompt-units.ts`)을 쓰며, 브랜드 식별어에 소유자 D1의 브랜드·지점 이름과 약칭(영문 3자·한글 2자 이상)을 더한다.

- 대조는 NFKC 정규화·소문자화한 본문과, 거기서 공백을 뺀 사본, 글자·숫자만 남긴 사본으로 한다. 브랜드 식별어는 글자 사이에 공백·하이픈·구두점이 끼어도 같은 이름으로 본다(영문 4자 이하는 영문 경계, 한글 2자는 앞 한글 경계를 둬 `today`·`로드맵 달성` 같은 우연 일치를 피한다).
- `codeBrandAliases`에는 앱 소스(`lib`·`app`)에 이미 공개된 표기만 둔다. `tests/check-prompts.test.mjs`가 목록의 모든 표기가 앱 소스에 있는지 확인한다.
- 이 검사는 보조 수단이다. 1차 통제는 `main` 병합 전 리뷰와 F3b의 평가 쌍 비교다. 패턴 목록은 알려진 우회를 막을 뿐 의미가 같은 모든 표현을 판별하지 못한다.

## 등록 (`POST /api/prompts`, 소유자 전용)

```json
{"action": "register", "unit": "role.cmo", "sourceSha": "<40자리 커밋 SHA>"}
```

1. 서버가 `https://raw.githubusercontent.com/roybeee/Collective/<sourceSha>/prompts/<단위>.json`과 `…/main/prompts/<단위>.json`을 가져온다(10초 제한, 리다이렉트는 따라가지 않고 blocked, 32,000바이트 상한).
2. 두 본문(정규화 JSON)이 같을 때만 계속한다. 다르면 400(main에 병합된 본문만 등록).
3. 본문 검사(위 CI 검사 + D1 브랜드·지점 이름·약칭, 같은 정규화). 위반은 400.
4. 버전 id `<단위>@<정규화 본문 sha256 앞 12자>`로 `prompt_version`을 `INSERT OR IGNORE`한다. 같은 sha256 재등록은 멱등(`idempotent:true`). 같은 id에 다른 본문이 있으면 409.
5. 가져오기 실패(연결 실패·시간 초과·HTTP 오류·파일 없음)는 `prompt_registration`에 `blocked`로 기록하고 502. 본문 업로드로 대신하는 경로는 없다. 새 기계 자격증명도 쓰지 않는다(공개 저장소 raw 경로만).

권한: 비로그인 401, 관리자·직원 403, 다른 소유자의 버전·단위는 404. `raw.githubusercontent.com`의 main은 CDN 캐시로 몇 분 늦을 수 있다. 병합 직후 400(main과 다름)이면 잠시 뒤 다시 등록한다.

조회: `GET /api/prompts`(단위·릴리스·버전 요약·최근 등록 기록·매니페스트), `?version=<id>`(본문 포함), `?impact=<id>`(영향 범위).

## 해석·고정·폴백

- 공용 해석기 `resolveCampaignPrompts(owner,campaign)`를 역할 실행과 회의가 같이 쓴다. 같은 캠페인·브리프 버전에 고정(`campaign_prompt_pin`)이 있으면 그 버전을, 없으면 지금 적용되는 버전(역할·채널 단위)을 읽어 고정한다. `stagedCampaignIds`가 비어 있지 않은 릴리스(스테이징 중)는 지정 캠페인에 `active`를, 나머지 캠페인에 `baseline`(스테이징 전 전체 적용 버전, 없으면 코드 상수)을 적용한다. `targets`는 쓰지 않는다(비율 카나리 없음).
- 회의는 시작 때 해석을 `snapshot.prompts`(`source`·`units`·`promptVersion`·본문 `set`)에 고정하고 모든 단계가 그 본문을 쓴다.
- 바이럴 발견 지시는 캠페인이 없어 `resolveUnitPrompt(owner,'viral.discovery')`로 따로 해석한다(지정 캠페인 릴리스는 쓰지 않는다). 분석·조사 작업이 같은 지시를 쓴다.
- 레지스트리가 비어 있거나 적용할 active가 없으면 코드 상수로 실행한다. 지시·입력·inputHash가 도입 전과 바이트 동일하다(`tests/prompt-baseline.test.mjs`, `tests/role-instruction.test.mjs`, `tests/role-execution-drift.test.mjs`).
- 코드 기본값과 같은 본문을 활성화하면 지시·입력은 바이트 동일하고, 역할 inputHash에는 `promptVersion` 키만 더해진다(`tests/prompt-resolution.test.mjs`가 독립 오라클로 재계산).
- 조회 실패(`lookup_failed`)나 레코드 손상(`corrupt_record`: 단위·id·형식·sha256 불일치, 끊긴 포인터)이면 코드 상수로 실행하고 `promptFallback`을 learning_snapshot·작업물·provider_usage(회의는 스냅샷과 사용량, 바이럴은 learning_task와 사용량)에 남긴다. 이때는 고정을 쓰지 않는다.
- 작업물의 실행 메타(`promptVersion`·`promptFallback`·`promptRecheck`)는 기록용이며 모델 입력에 싣지 않는다. 회의 입력(`originalArtifacts`·`candidateArtifacts`)은 작업물을 펼칠 때 이 필드를 빼고 나머지 키 순서를 그대로 둔다(`lib/meeting-execution.ts` `modelArtifact`). 역할 입력은 원래 작업물의 정해진 필드만 쓴다(`upstreamContext`).

## promptVersion 기록 (F2a 조인 키)

- 레지스트리 단위를 썼으면 `unit@sha256 앞 12자`를, 한 실행이 여러 단위를 쓰면 단위 목록 순서로 `+`로 잇는다(역할 실행: 역할 스킬 + 이 캠페인에 적용되는 채널 스킬). 예: `role.cmo@1a2b3c4d5e6f+channel.shortform@…`.
- 코드 상수로 실행했으면 기존 F2a 규칙 `<스킬 버전>:<지시 sha256 앞 12자>`(스킬 버전이 없으면 `inline:`)이다.
- 같은 실행의 작업물(`artifact.promptVersion`)·`learning_snapshot`·`provider_usage`·회의 단계(`steps[].promptVersion`)가 같은 값을 쓴다. 회의 스냅샷의 `prompts.promptVersion`은 캠페인 단위(고정한 모든 역할·채널 단위)다.

## 롤백과 영향 범위

```json
{"action": "rollback", "unit": "role.cmo", "expectedActive": "<지금 active 버전 id>"}
```

- 포인터 한 번 조작: `active ← previous`(없으면 null = 코드 상수), `previous ← null`, `history`에 행위자·시각·from/to를 남긴다. `expectedActive`가 다르면 409.
- 같은 배치에서 그 버전으로 만든 현행 작업물에 `promptRecheck`(버전·사유·시각) 표시만 남긴다. 본문과 갱신 시각은 바꾸지 않는다. 그 버전을 고정한 캠페인 해석을 풀어 다음 실행이 새 active로 다시 고정한다.
- 영향 범위(`?impact=<id>`): 그 버전으로 만든 작업물과, 그 작업물 카피를 쓴 발행물(`execution_publication.copy.artifactId`) 목록·수.
- 이미 제출한 작업의 멱등 재제출(기존 요청 확인)은 저장된 원문(`hermes_submission`)을 그대로 보낸다. 롤백이 진행 중 작업의 본문을 바꾸지 않는다.
- 스테이징 중 롤백(`expectedActive` = 스테이징 버전)은 스테이징 전 상태로 되돌린다: `active ← previous`(= 스테이징 전 전체 적용 버전), `stagedCampaignIds ← []`, `baseline ← null`.
- 같은 배치에서 `prompt_release_event`(`action: "rollback"`, from·to, to 버전의 `sourceSha`, 해제한 `stagedCampaignIds`, 영향 수 `impact`, 조작 전·후 `promptManifest`)를 남긴다. 승인·평가 근거(`approval`·`evalRunId`)는 null이다. 응답에 `event`가 있다.
- 롤백·활성화마다 `docs/PUBLISH.ko.md` 7절의 `registry-active` 기록을 남긴다.

## 활성화 게이트 (F3b)

결론: 새 버전은 서버 쌍 평가(`pair` run)가 게이트 조건을 모두 통과하고 대표(owner)가 승인 사유를 남길 때만 켠다. 먼저 지정 캠페인에만 켜고(`stage`), 관찰한 뒤 전체에 켠다(`promote`). 비율(%) 카나리와 자동 승격은 없다. 모델·게이트웨이 변경 경보가 열려 있으면 모두 멈춘다.

비유: 신메뉴 시식회와 같다. 같은 손님(골든 케이스)에게 지금 메뉴와 신메뉴를 한 자리에서 번갈아 내고, 같은 채점표로 비교한다. 주방 설비(게이트웨이)나 재료 납품처(모델)가 시식 도중 바뀌었으면 그 시식은 무효다. 통과하면 사장님이 서명하고, 먼저 지정한 매장에서만 팔아 본 뒤 전 매장에 낸다. 설비·납품처가 바뀌었다는 알림이 오면 사장님이 확인할 때까지 신메뉴 출시를 멈춘다.

### 쌍 평가 (`POST /api/eval` `start_run`, `variant: "pair"`)

```json
{"action": "start_run", "pair": {"unit": "role.cmo", "candidateVersionId": "role.cmo@<12자>"}, "set": "sealed", "tokenBudget": 200000, "label": "role.cmo 후보 쌍 평가"}
```

- 케이스마다 두 쪽을 같은 run 안에서 이어서 제출한다. `active` 쪽은 지금 전체 캠페인에 적용되는 레지스트리 버전(없으면 코드 상수), `candidate` 쪽은 후보 버전 본문이다(`RoleRequest.prompts` 주입). 대상 단위만 바꾸고 다른 단위는 두 쪽 모두 코드 상수다.
- 순서 효과를 줄이려고 케이스마다 `active→candidate`와 `candidate→active`를 번갈아 쓴다. 멱등 키는 쪽마다 새로 만든다: `collective-eval-` + SHA-256(`<run>:<case>:<active|candidate>`) 앞 40자.
- 케이스는 대상 단위를 쓰는 것만 남긴다(역할 스킬은 같은 역할 케이스, 채널 스킬은 그 채널이 적용되는 캠페인 케이스). 뺀 수는 `pair.skippedCases`. 남는 케이스가 없으면 400. 바이럴 발견 지시는 400(역할 케이스로 평가할 수 없다).
- 후보가 등록돼 있지 않으면 404, 다른 단위의 버전이거나 지금 active와 같으면 400. `variant`는 `active` 또는 `pair`만 받는다(후보 단독 실행 없음).
- 예산(결정 5, F1b-2 규칙 그대로): 두 제출이 각각 제출 직전 run 예산·월 상한 검사와 케이스 1건 예약(50,000)을 받는다. 한쪽만 끝나고 예산에 닿으면 나머지는 `not_run`이 되고 그 run은 게이트를 통과하지 못한다.
- 채점: 두 쪽을 같은 채점기(13종)와 규제 가드레일로 채점한다. run 결과에는 케이스×쪽마다 채점기별 pass/fail, 보고 모델, 토큰을 남기고, 시작 시점 `gatewaySnapshot`과 종료 시점 `gatewaySnapshotEnd`(같은 평가 연결로 다시 잰 해시)를 남긴다. 출력 원문은 `eval_output` `<run>:<case>:<쪽>`.
- 결과 확인: `GET /api/eval?pair=<run>` → `{pair, comparison(두 쪽 McNemar 비교), gate}`. `GET /api/eval?run=<run>&caseId=<case>&variant=candidate`로 한쪽 출력 원문을 본다. pair run은 `?compare=`에 넣을 수 없다(400).

### 게이트 조건 (`lib/eval-stats.ts` `pairGate` + `lib/prompt-registry.ts`)

모두 만족해야 한다. 하나라도 어긋나면 409이고, 응답 `error`에 어긋난 사유를 모두 적는다.

| 조건 | 거부 사유 |
|---|---|
| `evalRunId`가 이 단위·버전의 pair run이고 `completed`(삭제하지 않음) | 쌍 평가 실행이 없음·pair가 아님·다른 버전·끝나지 않음 |
| 모든 케이스가 두 쪽 모두 `completed` | 두 쪽 모두 completed인 케이스 수 부족(예산 중단·실패 포함) |
| 그 run의 active 쪽 버전이 지금 전체 적용 버전과 같음 | 평가 뒤 active가 바뀜(다시 평가) |
| 평가 연결 게이트웨이 해시가 시작·종료에 같고 확인됨(운영 스냅샷 해시도 같음) | 게이트웨이 스냅샷 해시 다름·미확인 |
| 보고 모델이 두 쪽·모든 케이스에서 하나로 같고 보고됨 | 보고 모델 다름·미보고 |
| 코드 채점 합격 수 후보 ≥ active(케이스·채점기 대응. 두 쪽 모두 모델 원문 기준 판정을 쓴다 — `heading_nesting`·`internal_id_exposure`는 저장 정규화 전 판정(`prevention`, `docs/EVAL.ko.md` '정규화와 예방 판정'). 후보가 재질문(`question_only` fail)해 `not_applicable`이 된 채점기와 후보 쪽 `grader_error`는 후보 fail로 센다. active 쪽 `not_applicable`·`grader_error`와 그 밖의 `not_applicable`은 뺀다) | 합격 수 후보 < active |
| 봉인(sealed) 케이스가 1건 이상 | 봉인 케이스 없음(`sealed_missing`) |
| 봉인(sealed) 케이스에서 active pass → 후보 fail 회귀 0건(위 보정 포함) | 봉인 세트 회귀 N건 |
| `input_budget` 채점기가 후보 쪽 모든 케이스에서 pass | input_budget 후보 합격 부족 |
| `model_change`·`gateway_change` 경보가 마지막 확인 이후 열려 있지 않음(결정 10) | 경보 N건 동결 |

- 후보 보정은 비회귀 게이트라 후보에 불리한 쪽으로 센다. 산출물을 내지 않은 후보(재질문)가 같은 케이스 active의 내용 채점 합격을 셈에서 지워 다른 케이스 개선 1건으로 통과하는 것을 막는다. 봉인 케이스의 재질문은 `question_only`와 잃은 내용 채점 합격이 모두 봉인 회귀가 된다.
- 최소 케이스 수는 강제하지 않는다(대표 결정 전). 대응 쌍이 30쌍 미만이면 `gate.warnings`에 `small_sample` 경고를 싣고 거부하지 않는다. `activate`·`stage`·`promote` 응답의 `event.gate`에 `cases`·`sealedCases`·`warnings`가 있다.
- 진행 중(queued·running) run이 쓰는 케이스의 기대 판정·세트는 `update_case`로 바꿀 수 없다(409, 이름은 가능). 한 run의 두 쪽이 다른 기준으로 채점되는 것을 막는다.

### 활성화·지정 캠페인·승격 (`POST /api/prompts`, owner 전용)

```json
{"action": "activate", "unit": "role.cmo", "versionId": "role.cmo@<12자>", "evalRunId": "<pair run>", "approval": {"reason": "<승인 사유>"}}
{"action": "stage", "unit": "role.cmo", "versionId": "role.cmo@<12자>", "evalRunId": "<pair run>", "campaignIds": ["<캠페인>"], "approval": {"reason": "<승인 사유>"}}
{"action": "promote", "unit": "role.cmo"}
{"action": "reset_pins", "campaignIds": ["<캠페인>"]}
```

- `activate`: 전체 캠페인에 적용. `previous ← active`, `active ← versionId`, `evalRunId`·`approvedBy`·`history`를 남긴다.
- `stage`: 게이트 동일. `active ← versionId`, `baseline ← 지금 전체 적용 버전`, `previous ← 같은 값`, `stagedCampaignIds ← campaignIds`(1~50개, 정렬). 지정 캠페인만 새 버전을 쓰고 나머지 캠페인은 `baseline`을 계속 써서 지시·입력·inputHash가 그대로다. 응답 `pinnedCampaignIds`는 지정 캠페인 중 이미 해석을 고정한 캠페인이다.
- 고정(pin) 규칙: 이미 고정한 캠페인·브리프 버전은 스테이징·승격 뒤에도 고정 버전을 쓴다. 새 버전을 받게 하려면 `reset_pins`로 그 캠페인의 고정을 명시적으로 푼다(브리프 버전이 올라가도 다시 고정된다). 진행 중 작업의 재제출은 저장된 원문을 그대로 보내고, 회의는 시작 때 스냅샷을 끝까지 쓴다. 지정 캠페인의 회의 스냅샷 `promptVersion`은 같은 캠페인 역할 실행의 `promptVersion`과 같다(같은 고정을 쓴다).
- `promote`: 스테이징한 버전을 전체에 적용한다(`stagedCampaignIds ← []`, `baseline ← null`). 같은 `evalRunId`로 게이트를 다시 확인하고(기준 = `baseline`) 경보 동결을 다시 본다. `approval.reason`은 선택이다. 스테이징이 없으면 409.
- 스테이징 중에는 같은 단위의 `activate`·`stage`가 409다. `promote` 또는 `rollback`으로 먼저 끝낸다.
- `activate`·`promote`에 `campaignIds`·`stagedCampaignIds`·`baseline`을 주면 400이다(조용히 전체 적용하지 않는다). 지정 캠페인 적용은 `stage`로만 한다.
- 비율 필드(`percent`·`ratio`·`canary`·`weight`·`traffic`·`rollout`)는 400이다. 워커·예약 작업은 `prompt_release`를 쓰지 않는다(승격은 owner의 `promote` 요청뿐).
- 권한: 비로그인 401, 관리자·직원 403, 다른 소유자의 버전·단위·캠페인·평가 run은 404. 쓰기는 소유자 잠금 안에서 한다.
- 기록: 조작마다(`activate`·`stage`·`promote`·`rollback`) `prompt_release_event`(단위·from·to·`sourceSha`·`evalRunId`·승인 사유·승인자·지정 캠페인·게이트 요약·조작 전후 `promptManifest`)를 남긴다. 롤백은 승인·평가 근거가 null이고 해제한 지정 캠페인과 영향 수를 남긴다. `reset_pins`도 푼 고정의 `promptVersion`을 남긴다. `GET /api/prompts`의 `events`로 본다.

### 경보 동결과 해제 (결정 10)

- HERMES 모델은 고정하지 않는다. 운영 실행이 보고한 모델이 바뀌면 `model_change`, 운영 게이트웨이 일일 스냅샷 해시가 바뀌면 `gateway_change`가 생긴다. 확인(`prompt_alarm_ack`)되지 않은 경보가 하나라도 있으면 `activate`·`stage`·`promote`가 409다. `GET /api/prompts`의 `alarms.open`에 열린 경보가, `alarms.lastAck`에 마지막 확인이 있다.
- 해제 절차:
  1. `GET /api/prompts`로 열린 경보(모델 전후 보고값, 게이트웨이 해시·바뀐 섹션)를 확인한다.
  2. 골든 스모크를 다시 돌린다: `start_run`(`variant: "active"`, 봉인 또는 dev 세트, 결정 5 예산 안) → 결과가 경보 전 run과 비회귀인지 `?compare=`로 본다.
  3. `{"action": "acknowledge_alarms", "reason": "<확인 내용>", "evalRunId": "<스모크 run>"}`. `evalRunId`는 선택(권장)이며 주면 끝난 run이어야 한다(없으면 404, 진행 중·삭제면 409). 열린 경보가 없으면 409.
- 확인 기록은 확인한 경보 id 목록이다. 확인 뒤에 생긴 경보는 다시 동결한다. 처음 F3b를 쓸 때 이전에 쌓인 경보가 있으면 한 번 확인해야 한다.

## 운영 런북 (대표용)

1. 후보 PR 병합: `prompts/<단위>.json` 본문을 바꾸는 PR을 리뷰해 `main`에 병합한다(D1 이름 대조 기록 포함, 아래 '남은 한계'). 병합 커밋 SHA를 적어 둔다.
2. 등록: `POST /api/prompts` `{"action":"register","unit":"<단위>","sourceSha":"<병합 SHA>"}` → 버전 id(`<단위>@<12자>`). 502(blocked)면 잠시 뒤 같은 SHA로 다시 한다.
3. 경보 확인: `GET /api/prompts`의 `alarms.open`이 비어 있는지 본다. 있으면 위 해제 절차부터 한다.
4. 쌍 평가: `POST /api/eval` `start_run`(`pair`, 봉인 세트 포함, `tokenBudget` ≤ 250,000). 워커가 끝낼 때까지 `GET /api/eval?run=<id>`로 본다.
5. 결과 확인: `GET /api/eval?pair=<id>` → `gate.ok`, `gate.reasons`, 합격 수, `sealedCases`·봉인 회귀, `input_budget`, 모델, 게이트웨이 시작·종료 해시, `comparison`의 n·b·c·p. 표본이 30쌍 미만이면 "개선"이라고 쓰지 않는다(비교 통계 규칙).
6. 지정 캠페인 적용: `stage`(`campaignIds` 1~50개, 승인 사유). 응답 `pinnedCampaignIds`에 있는 캠페인이 새 버전을 받아야 하면 `reset_pins`.
7. 관찰: 지정 캠페인의 작업물·회의·품질 판정과 `provider_usage`를 `promptVersion`으로 나눠 본다(F2a 조인 키). 지정 밖 캠페인은 그대로다.
8. 전체 적용 또는 되돌림: 문제가 없으면 `promote`, 있으면 `rollback`(`expectedActive` = 스테이징 버전, 스테이징 전 상태로 돌아간다).
9. 기록: 조작마다(롤백 포함) `docs/PUBLISH.ko.md` 7절 형식으로 `registry-active`를 남긴다. 근거는 `GET /api/prompts`의 `events`(단위·from→to·`sourceSha`·`evalRunId`·승인 사유·지정 캠페인·`manifestBefore`/`manifestAfter`)와 운영 `/api/version`의 `promptManifest`다. `promptManifest`가 이벤트의 `manifestAfter`와 같으면 `registry-active`다. 레지스트리 조작은 게시가 아니므로 `runtime-verified`와 섞지 않는다.

## /api/version

`{build, tree, promptManifest}`. `promptManifest`는 이 소유자의 단위별 적용 상태 목록(`[{unit,active}]`, 단위 순, 스테이징 중인 단위는 `{unit,active,baseline,stagedCampaignIds}`)의 sha256이다. 스테이징 전후와 승격 전후가 서로 다른 해시가 된다. active가 없으면 null, 읽기 실패는 `unknown`. `tree`는 코드 신원(`runtime-verified`)이고 `promptManifest`는 레지스트리 상태(`registry-active`)다.

## 기준선 fixture 재캡처

`tests/fixtures/prompt-baseline-<sha7>.json`은 레지스트리 도입 전 기준 커밋에서 역할 8종·회의 12단계(시드 작업물)·회의 12단계(`roleMeeting`: 역할 8종을 실행한 같은 캠페인, 작업물 행 시각만 고정값)·바이럴 분석/조사 제출의 sha256·길이와 역할 inputHash를 캡처한 것이다. 역할·회의·바이럴 지시를 의도적으로 바꾸는 PR은 새 기준 커밋에서 다시 캡처하고 파일 이름의 sha7을 바꾼다.

```sh
PROMPT_BASELINE_SHA=<40자리 기준 SHA> PROMPT_BASELINE_CAPTURE=tests/fixtures/prompt-baseline-<sha7>.json node --experimental-vm-modules tests/prompt-baseline.test.mjs
```

## 남은 한계

- F3b 게이트는 골든셋만큼만 안다. 쌍 평가는 결정론 채점기 13종의 비회귀만 보며 설득력·사실 정확성 전체를 판정하지 않는다. 봉인 케이스가 없는 pair run은 거부하지만(`sealed_missing`) 최소 케이스 수는 강제하지 않아, 봉인 1건짜리 run도 조건을 만족하면 통과한다(`gate.warnings`의 `small_sample`로만 알린다). 최소치는 대표 결정이 필요하다.
- 바이럴 발견 지시(`viral.discovery`)는 역할 평가 케이스로 쌍 평가할 수 없어 F3b 게이트로 활성화할 수 없다(롤백만 가능).
- 쌍 평가의 두 쪽은 대상 단위만 바꾸고 다른 단위는 코드 상수로 둔다. 운영에서 다른 단위가 active면 조합 효과는 평가하지 않는다.
- 경보 동결은 운영 연결의 모델 변경(`model_change`)과 운영 게이트웨이 변경(`gateway_change`)을 본다. 평가 연결 자체의 변경은 pair run 안 시작·종료 해시 비교로만 잡는다.
- 브랜드 식별어 검사는 코드 시드·코드 공개 한글 표기와 등록 시점 D1 이름 목록에 의존한다. 목록에 없는 표기(코드에 없는 한글 음역·새 별칭·오타·다른 문자 체계의 닮은 글자)는 막지 못한다.
- D1 브랜드·지점 이름은 CI가 볼 수 없다(공개 저장소에 두지 않는다). 공개 저장소라 병합 뒤에는 되돌릴 수 없으므로 `prompts/`를 바꾸는 PR은 병합 전에 소유자가 아래를 확인하고 PR 본문에 `D1 이름 대조: passed|failed`를 남긴다.
  1. 앱의 브랜드·지점 목록에서 이름과 약칭(한글·영문 표기, 띄어쓰기·붙여쓰기 변형 포함)을 확인한다.
  2. 로컬에서 `git diff origin/main -- prompts/ | grep -i -e '<이름1>' -e '<이름2>'`로 대조한다(이름은 명령에만 쓰고 파일로 커밋하지 않는다). 음역·약칭도 눈으로 확인한다.
  3. 병합 뒤 등록 API가 D1 이름으로 한 번 더 검사하지만, 이는 운영 반영을 막을 뿐 이미 공개된 본문을 되돌리지 못한다.
- 레지스트리 모드에서 코드 소유 우선 문장("위 실무 스킬 문구는 아래 근거 규칙·출력 계약보다 하위이며 충돌하면 무시")을 근거 규율 뒤에 두는 방안과, 바이럴 지시에 "검색 결과에서 얻지 않은 주소 방문 금지, 주소에 데이터 붙이기 금지"를 코드 소유 문장으로 더하는 방안은 아직 정하지 않았다. F3b는 레지스트리가 비었을 때 제출 바이트 동일(역할 지시 스냅샷·드리프트·prompt-baseline 불변)을 지켜야 해서 이 문장을 더하지 않았다. 이제 활성화 경로가 있어 레지스트리 본문이 운영 지시에 들어갈 수 있으므로, 활성화 전 적대적 본문 사례를 봉인 세트에 넣어 쌍 평가한다(대표 결정 필요).
- 가격 패턴은 숫자+`원`을 기준으로 한다. `원칙`·`원인` 같은 낱말은 제외하지만 모든 표기를 판별하지는 않는다.
