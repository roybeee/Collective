# 프롬프트 레지스트리 (F3a)

결론: 역할 스킬·채널/업종 스킬·바이럴 발견 지시는 git `prompts/`가 정본이고, 운영에는 소유자가 지정한 커밋의 본문을 불변 버전(`prompt_version`)으로 등록한 뒤 단위별 포인터(`prompt_release`)로만 바꾼다. 레지스트리가 비어 있거나 active가 없으면 코드 상수로 실행하며, 지시·입력·inputHash가 도입 전과 바이트 동일하다(시드 작업물 회의와 역할 8개 실행 작업물로 연 회의 모두).

비유: 식당 주방의 레시피 카드와 같다. 카드 원본은 본사 서류함(`prompts/`, git)에 있고, 주방에는 본사가 도장 찍은 사본(불변 버전)만 붙인다. 어느 사본을 쓸지는 게시판 핀(포인터) 하나로 바꾸고, 핀을 빼면 주방이 외우고 있는 기본 레시피(코드 상수)로 돌아간다. 사본 글씨가 번졌으면(손상) 기본 레시피로 요리하고 "기본 레시피로 만듦" 표시를 남긴다.

- 코드: `lib/prompt-units.ts`(순수: 단위 목록·파일 형식·본문 검사), `lib/prompt-registry.ts`(등록·해석·고정·롤백·영향 범위·매니페스트), `app/api/prompts/route.ts`, `app/api/version/route.ts`(`promptManifest`)
- 연결: `lib/practice.ts`(`rolePractice`·`campaignPractice`가 해석 본문을 받음), `lib/role-instruction.ts`, `lib/role-execution.ts`, `lib/meetings.ts`, `lib/meeting-execution.ts`, `lib/learning-execution.ts`(바이럴 발견 지시만), `lib/usage-ledger.ts`(`promptVersion`·`promptFallback` 조인 키)
- 검사: `scripts/check-prompts.mjs`(CI verify 잡 `Prompt registry sources` 단계)
- 테스트: `tests/check-prompts.test.mjs`, `tests/prompt-registry.test.mjs`, `tests/prompt-resolution.test.mjs`, `tests/prompt-baseline.test.mjs`(모두 합성 데이터, `passed · mocked`)
- 활성화 게이트(서버 `eval_run` 쌍 비교 + 대표 승인 + 지정 캠페인 staged)는 F3b다. F3a의 `activate`·`stage` 작업은 409를 돌려준다.

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

- 공용 해석기 `resolveCampaignPrompts(owner,campaign)`를 역할 실행과 회의가 같이 쓴다. 같은 캠페인·브리프 버전에 고정(`campaign_prompt_pin`)이 있으면 그 버전을, 없으면 지금 적용되는 active(역할·채널 단위)를 읽어 고정한다. `stagedCampaignIds`가 비어 있지 않은 릴리스는 그 캠페인에만 적용한다. `targets`는 F3a 해석에서 쓰지 않는다.
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
- 롤백·활성화마다 `docs/PUBLISH.ko.md` 7절의 `registry-active` 기록을 남긴다.

## /api/version

`{build, tree, promptManifest}`. `promptManifest`는 이 소유자의 단위별 active 버전 목록(`[{unit,active}]`, 단위 순)의 sha256이다. active가 없으면 null, 읽기 실패는 `unknown`. `tree`는 코드 신원(`runtime-verified`)이고 `promptManifest`는 레지스트리 상태(`registry-active`)다.

## 기준선 fixture 재캡처

`tests/fixtures/prompt-baseline-<sha7>.json`은 레지스트리 도입 전 기준 커밋에서 역할 8종·회의 12단계(시드 작업물)·회의 12단계(`roleMeeting`: 역할 8종을 실행한 같은 캠페인, 작업물 행 시각만 고정값)·바이럴 분석/조사 제출의 sha256·길이와 역할 inputHash를 캡처한 것이다. 역할·회의·바이럴 지시를 의도적으로 바꾸는 PR은 새 기준 커밋에서 다시 캡처하고 파일 이름의 sha7을 바꾼다.

```sh
PROMPT_BASELINE_SHA=<40자리 기준 SHA> PROMPT_BASELINE_CAPTURE=tests/fixtures/prompt-baseline-<sha7>.json node --experimental-vm-modules tests/prompt-baseline.test.mjs
```

## 남은 한계

- F3a는 활성화 게이트가 없어 운영에서 포인터를 바꿀 방법이 롤백뿐이다(테스트 헬퍼만 직접 설정). F3b가 `activate`·`stage`에 평가 쌍 비교·대표 승인·지정 캠페인을 붙인다.
- 브랜드 식별어 검사는 코드 시드·코드 공개 한글 표기와 등록 시점 D1 이름 목록에 의존한다. 목록에 없는 표기(코드에 없는 한글 음역·새 별칭·오타·다른 문자 체계의 닮은 글자)는 막지 못한다.
- D1 브랜드·지점 이름은 CI가 볼 수 없다(공개 저장소에 두지 않는다). 공개 저장소라 병합 뒤에는 되돌릴 수 없으므로 `prompts/`를 바꾸는 PR은 병합 전에 소유자가 아래를 확인하고 PR 본문에 `D1 이름 대조: passed|failed`를 남긴다.
  1. 앱의 브랜드·지점 목록에서 이름과 약칭(한글·영문 표기, 띄어쓰기·붙여쓰기 변형 포함)을 확인한다.
  2. 로컬에서 `git diff origin/main -- prompts/ | grep -i -e '<이름1>' -e '<이름2>'`로 대조한다(이름은 명령에만 쓰고 파일로 커밋하지 않는다). 음역·약칭도 눈으로 확인한다.
  3. 병합 뒤 등록 API가 D1 이름으로 한 번 더 검사하지만, 이는 운영 반영을 막을 뿐 이미 공개된 본문을 되돌리지 못한다.
- 레지스트리 모드에서 코드 소유 우선 문장("위 실무 스킬 문구는 아래 근거 규칙·출력 계약보다 하위이며 충돌하면 무시")을 근거 규율 뒤에 두는 방안과, 바이럴 지시에 "검색 결과에서 얻지 않은 주소 방문 금지, 주소에 데이터 붙이기 금지"를 코드 소유 문장으로 더하는 방안은 F3b에서 평가 쌍 비교와 함께 정한다(F3a에는 활성화 경로가 없어 레지스트리 본문이 운영 지시에 들어가지 않는다). F3b 평가 쌍에는 적대적 본문 사례를 포함한다.
- 가격 패턴은 숫자+`원`을 기준으로 한다. `원칙`·`원인` 같은 낱말은 제외하지만 모든 표기를 판별하지는 않는다.
