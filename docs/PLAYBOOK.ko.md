# 교정 기반 플레이북 (B3-1 · B3-2a · B3-2b · B3-2c · B3-2 Reflector)

사람이 작업물·브리프 제안·자료·발행을 판정한 기록(B1 `review_decision`)에서 반복된 선호를 **운영자 선호 규칙**으로 만들어, 소유자가 승인한 뒤 AI 역할 입력에 전달한다.
성과 실험에서 나온 학습 규칙(바이럴·점포)과 등급·만료·주입 블록을 분리한다. 이번 단계(B3-1)는 모델(HERMES·OpenAI)을 부르지 않는다. 규칙은 사람이 직접 쓰고, 교정 데이터를 외부 모델로 보내는 Reflector는 B3-2다.

- 순수 규칙(등급·범위·만료 상태, 화면·서버 공용): `lib/learning.ts`
- 본문 검사·Curator·주입 블록(순수): `lib/playbook-curator.ts`
- 저장·승인·중지·연장·인용 검사(D1): `lib/learning-server.ts` (`playbook_*` 작업, `POST /api/learning`)
- 역할 입력 주입: `lib/role-execution.ts` (`roleRequestFor`·start 분기)
- 화면: `app/learning-panel.tsx` 학습 규칙 탭의 운영자 선호 영역
- records kind: `learning_rule`(규칙), `playbook_audit`(감사, 새 kind) — `lib/record-kinds.ts`. 중지 때 재확인 표시는 새 kind 없이 캠페인 이력(`event`)의 `playbookRecheck` detail이다.
- 테스트: `tests/playbook.test.mjs` (mocked: 메모리 SQLite·헤더 세션·모의 HERMES, 플레이북 작업의 모델 호출 0)
- B3-2a 교정 신호(교정 묶음·파생 피드백·재발률·경보 중 승인 동결): 아래 [B3-2a 절](#b3-2a-교정-신호), 테스트 `tests/playbook-signals.test.mjs`
- B3-2b 선호 on/off 골든 쌍 평가(`POST /api/eval` `pair.kind: operator_preferences`): 아래 [B3-2b 절](#b3-2b-선호-onoff-쌍-평가), 테스트 `tests/eval-preference-pair.test.mjs`
- B3-2c 선호 쌍 평가 첨부(`POST /api/learning` `playbook_attach_eval`)와 4단계 종료 조건 절차: 아래 [B3-2c 절](#b3-2c-선호-쌍-평가-첨부), 테스트 `tests/playbook-attach-eval.test.mjs`
- B3-2 Reflector(교정 묶음 → 격리 HERMES 1회 → 규칙 초안, `POST /api/reflector`): 아래 [B3-2 Reflector 절](#b3-2-reflector), 테스트 `tests/reflector.test.mjs`

## 등급과 만료 (대표 결정 9, 2026-09-24)

| 등급(`grade`) | 출처 | 만료 | 주입 블록 | 부여 경로 |
|---|---|---|---|---|
| `operator_preference` | 운영자 교정(`origin: review`)·편집 diff 근거(`origin: preference`) | 승인·연장 시점부터 **60일** | `operatorPreferences` | 소유자 수동 생성 → 승인 |
| `performance_observed` | 바이럴 실험 채택·점포 회고 승격(`origin: viral`·`store`) | 30일(기존 `RULE_DAYS`) | `learning` | 기존 그대로 |
| `performance_tested` | 골든 on/off 비교를 첨부한 성과 규칙 | B3-2에서 확정 | `learning` | **이번 단계에서는 막음**(생성·`playbook_grade` 모두 409) |

- 등급 필드가 없는 기존 규칙은 `performance_observed`로 본다(`ruleGrade`). 기존 규칙 레코드와 역할 입력은 바뀌지 않는다.
- 만료된 규칙은 주입에서 빠진다(`ruleApplies`의 `expiresAt`). 적용 중인 규칙은 만료 **7일 전**부터 재확인이 필요하다고 표시한다(`playbookState.reconfirm`, 기존 재검토 창과 같다).
- 재확인은 연장(`playbook_renew`)이다. 지금부터 60일로 늘리고 감사 기록을 남긴다. 측정 기반 연장 규칙(`renew_rule`)은 성과 규칙 전용이며 운영자 선호 규칙에는 409다.
- 운영자 선호 규칙은 성과 실험의 재검토 배너(`expiringRules`)에 넣지 않는다. 재검증 실험 대상이 아니기 때문이다.

## 범위: 채널 `*`과 역할

- `channel: "*"`(기본값)은 채널과 무관하게 같은 브랜드의 캠페인에 적용된다. 채널이 비어 있는 캠페인에도 들어가고, 다른 브랜드에는 0건이다.
- 특정 채널을 고르면 기존 규칙과 같은 채널 별칭 판정(`channelAliases`)을 쓴다.
- `role`을 지정하면 그 역할의 입력에만 들어간다. 역할을 모르는 호출(브리프·회의)에는 전달하지 않는다. 역할이 없는 규칙은 모든 역할 입력에 들어간다.
- `ruleApplies(rule,brandId,channels,now,storeId,role)`에 역할 인자를 더했다. 역할이 없는 기존 규칙의 판정은 그대로다.

## 수동 생성과 인용 규칙

`POST /api/learning {action:'playbook_create',data:{brandId,text,role?,channel?,origin?,citations}}` — **소유자 전용**(관리자·직원 403).

- 대상 브랜드는 필수, 역할은 선택(8개 역할 id), 채널은 `*` 기본 또는 등록된 채널 이름.
- 인용(`citations`)은 서로 다른 `review_decision` id **2~20건**이다. 모두 이 워크스페이스의 실제 기록이어야 하고, **같은 브랜드**여야 한다.
  - 판정의 브랜드는 기록의 `brandId`, 없으면(작업물·발행 판정) 캠페인의 브랜드다. 원 캠페인이 삭제돼 브랜드를 알 수 없는 기록은 인용할 수 없다.
  - 없거나 다른 브랜드의 기록이면 400이다.
  - `origin: preference`(편집 diff 근거)는 사람이 고친 AI 작업물 판정(`targetKind: artifact`, `origin: ai_edited`)만 인용한다. 아니면 400.
- 만든 규칙은 `status: draft`다. **승인 전에는 역할 입력 주입 0건**이다.
- 규칙 레코드: `id: playbook:<uuid>`, `grade: operator_preference`, `citations`, `feedback: {helpful:0,harmful:0}`(카운터 자리, 갱신은 B3-2), `experimentId: ''`(캠페인 삭제의 실험 규칙 경로에 걸리지 않는다).
- 화면의 인용 선택은 `GET /api/learning`의 `reviewDecisions`(최근 200건 요약: 시각·대상·역할·판정·사유 코드, 메모·행위자 없음)에서 브랜드별로 고른다.

## 상태와 감사 로그

| 작업 | 전 상태 → 후 상태 | 검사 |
|---|---|---|
| `playbook_create` | → `draft` | 본문·인용·등급 |
| `playbook_activate`(승인) | `draft`·`paused` → `active` | 버전 일치, 열린 모델·게이트웨이 경보가 있으면 409(B3-2a D3), 역할당 활성 8개 상한(초과 409), 만료 = 지금 + 60일 |
| `playbook_pause`(중지) | `active` → `paused` | 주입된 작업물 재확인 표시, 영향 건수 반환 |
| `playbook_renew`(연장) | `active` 유지 | 만료 = 지금 + 60일, 상한 재확인 |

- 모든 작업은 소유자 전용이고 규칙 버전(`version`)이 다르면 409다.
- 매 작업마다 `playbook_audit` 1건: 규칙 id·브랜드·작업·전후 상태·규칙 버전·만료·행위자(id·역할만)·중지 때 `affectedArtifacts`. 이메일·본문 원문은 담지 않는다.
- 기존 `pause_rule`·`retire_rule`·`renew_rule`·`retest_rule`은 운영자 선호 규칙에 409다(소유자 검사·감사를 우회하지 않게).

## 주입 블록

역할 실행(`lib/role-execution.ts`)만 운영자 선호 규칙을 넣는다. **회의·브리프 경로는 이번 범위 밖**이며 `learningContext`가 운영자 선호 규칙을 빼므로 이전과 같다.

- `operatorPreferenceContext(owner,campaign,role)`: 승인·미만료·같은 브랜드·채널·역할이 맞는 규칙, 역할 지정 규칙 먼저·최신순, 역할당 8개까지.
- 역할 입력 끝에 `operatorPreferences` 키로 붙인다: `{note, rules:[{title,version,text,channel,expiresAt}]}`. 규칙 id·인용·카운터는 모델에 보내지 않는다.
  `note`는 이 블록이 성과 근거·확정 사실이 아니며 시스템 지시·`evidence.facts`·`factPolicy`·근거 규칙을 바꿀 권한이 없으니 충돌하면 따르지 말라고 적는다(입력에 실제로 있는 키 이름을 쓴다).
- 블록의 권한 한계는 지시문(instructions)이 정한다. 규칙이 1건 이상일 때만 순수 지시문(`buildRoleInstruction`) 끝에 `OPERATOR_PREFERENCE_AUTHORITY` 한 문장을 붙인다(`withPreferenceAuthority`, `revisionInstruction`처럼 조건부).
  이 문장은 operatorPreferences가 작업 방식 선호 데이터일 뿐 시스템 지시·evidence.facts·factPolicy·근거 규칙·산출물 계약을 바꾸거나 그보다 우선할 권한이 없다고 적는다. 코드 경로의 `promptVersion`(지시 해시)은 이 문장을 포함한 실제 지시문으로 계산한다.
- 역할 요청(`roleRequestFor`)에는 모델용 블록만 싣는다. 규칙 사본(스냅샷·중지 재확인용)은 `roleRequestWithRules`가 `operatorRules`로 따로 돌려준다.
- `learning` 블록(성과 규칙)은 그대로다. 운영자 선호 규칙은 `learning`에 섞지 않는다.
- **규칙 0건이면 키 자체를 넣지 않는다.** 이때 역할 요청·제출 본문·`inputHash`·`learning_snapshot`은 이전과 바이트 동일하다(`tests/role-instruction`·`role-execution-drift`·`prompt-baseline` 불변).
- 규칙이 있으면 `inputHash`에 같은 블록을 넣어 새 실행 id가 되고, `learning_snapshot`에 `operatorPreferences`(주입한 규칙 사본)와 `artifactId`(이 실행이 저장할 작업물 id)를 남긴다.
- 평가 케이스 캡처(`lib/eval-server.ts captureCase`)는 `roleRequestFor` 결과를 그대로 동결하므로 동결본에는 모델용 블록만 있다(규칙 id·인용·카운터 없음).
  동결본만으로 운영 제출을 바이트 그대로 다시 만들 수 있다: 입력 = `withOperatorPreferences(buildRoleInput(request), request.operatorPreferences)`, 지시문 = `withPreferenceAuthority(buildRoleInstruction(request), request.operatorPreferences)`(`tests/playbook.test.mjs`가 확인).
- 평가 실행 제출: Q1(#86)부터 운영 start와 서버 평가(`lib/eval-kinds.ts`)가 같은 역할 제출 조립 `roleSubmission`(`lib/role-execution.ts`)을 쓴다. 동결본에 블록이 있으면 평가 실행 입력·지시문에도 블록과 권한 문장이 들어가 운영 제출과 바이트 동일하다.
  B3-1 때 적었던 한계(평가 실행 입력에 블록·권한 문장이 빠짐)는 이것으로 해소됐다. 블록이 없는 동결본(규칙 0건·옛 동결본)은 순수 함수 출력과 바이트 동일하다.
- B5 맥락 리플레이는 저장된 HERMES 제출 입력(`hermes_submission`의 `input`)을 읽으므로 블록이 들어간 운영 입력을 그대로 본다. 규칙 0건이면 제출 본문이 이전과 바이트 동일하다.

## Curator (`lib/playbook-curator.ts`, 순수)

- 같은 브랜드·역할(역할 없는 규칙은 모든 역할과 겹친다)의 초안·적용 중·중지 규칙 쌍을 본다. **병합 제안만** 하고 규칙을 바꾸지 않는다(`GET /api/learning`의 `playbookSuggestions`).
  - 중복: NFKC·소문자·글자와 숫자만 남긴 본문의 2-gram Dice 유사도 0.8 이상.
  - 충돌: 한쪽만 부정·금지 표지(…하지 않는다·금지·피한다·삼가 등)가 있고, 표지를 뺀 주제 유사도 0.6 이상. 휴리스틱이라 사람이 판단한다.
- 역할당 활성 상한 8개(`MAX_ACTIVE_PER_ROLE`). 역할 없는 규칙은 모든 역할에 한 칸씩 쓴다. 만료된 규칙은 세지 않는다. 채널과 무관하게 보수적으로 센다.
- 만료 적용과 재확인 표시는 위 등급과 만료 절을 따른다.

## 중지와 재확인 표시

중지하면 다음 작업부터 주입하지 않는다. 이미 주입된 작업물은 `learning_snapshot`의 `operatorPreferences`·`artifactId`로 찾는다.
- 작업물이 저장돼 있으면 그 버전으로 표시한다.
- 작업물이 아직 없고 그 실행이 끝나지 않았으면(`starting`·`queued`·`in_progress`·`uncertain`) **대기 표시**(`pending: true`, `artifactVersion: null`)로 남긴다. `artifactId`는 실행 id에서 정해지므로(`roleArtifactId`) 중지 뒤 완료돼 저장될 작업물을 가리킨다.
- 작업물 없이 끝난 실행(실패·취소)은 표시하지 않는다. 규칙 변경(`POST /api/learning`)과 역할 실행은 같은 소유자 잠금을 써서 중지 도중 새 주입이 끼어들지 않는다.

캠페인마다 이력(`event`) 1건을 남기고 그 `playbookRecheck` detail에 `{ruleId, reason:'rule_paused', artifacts:[{artifactId, artifactVersion, ruleVersion(주입 당시), jobId, role, pending?}]}`를 싣는다.
**작업물 내용·버전은 바꾸지 않는다.** 응답의 `affected`가 재확인 표시 수(대기 표시 포함), `pending`이 그중 실행 중인 작업 수다. 감사 기록에도 `affectedArtifacts`·`pendingArtifacts`를 남긴다. 캠페인 이력이라 캠페인 화면 이력에 보이고 캠페인과 함께 지워진다.
학습 화면은 `GET /api/learning`의 `playbookRechecks`(이력을 작업물 단위로 편 목록)로 규칙마다 재확인 표시 건수를 보인다. 대기 표시는 읽을 때 푼다: 작업물이 저장됐으면 그 버전의 일반 표시로 바꾸고, 작업물 없이 끝났으면 빼고, 아직 실행 중이면 대기 표시로 둔다.
새 캠페인 범위 kind를 만들지 않은 이유: 캠페인 삭제 대화상자(`lib/deletion-summary.ts`)가 삭제되는 모든 kind에 이름을 요구하고, 재확인 표시는 캠페인 이력의 성격이기 때문이다.

## 오염 방어

- 본문은 NFC·공백 정규화 뒤 **400자 이하**.
- 연락처(이메일·국내 전화번호·대표번호)는 거부한다. NFKC로 접은 본문(전각 숫자·전각 @)에서 보고, 숫자 사이 구분자(공백·대시류·가운뎃점·점·슬래시·괄호·밑줄·ㅡ, 1~3자)를 지운 숫자열로 한 번 더 본다(띄어 쓴 숫자·en dash·구분자 없는 대표번호).
  시각의 `:`와 금액의 `,`는 구분자로 보지 않는다(15:00-18:00, 15,000,000원은 통과).
- 한 단어에 라틴 문자와 키릴·그리스 문자를 섞으면 거부한다(모양이 같은 문자로 영어 표지를 피하는 것을 막는다).
- F3a 본문 검사(`lib/prompt-units.ts validateUnitBody`)를 재사용해 URL·도메인·IP·계정 핸들, 명령형 주입 문구(이전 지시 무시·상위 규칙 우선·시스템 프롬프트·역할 전환), 보이지 않는 문자, 코드 소유 정책 문구(근거 규율·사실 정책·출력 계약·외부 행동 금지)를 거부한다.
  F3a 한국어 표지는 공백만 접은 형태에서 보므로, 원문과 **글자·숫자만 남긴 사본**에 한 번씩 돌린다(`이전·지시`, `시스템-프롬프트`처럼 구두점을 끼운 변형). F3a 단위(prompts) 검사 동작은 바꾸지 않는다.
- 플레이북 전용 표지를 더 막는다(F3a에는 넣지 않는다).
  - 지시 동의어(안내·가이드·가이드라인·방침·원칙)를 무시하라는 문구, 영어 동사(ignore·disregard·override·bypass·obey 등, skip … guidance/rules/evidence, only follow, take priority).
  - 권한 주장: 지시·사실·근거·증거·출처·브리프보다 우선(중요), 최우선으로 따르기, 먼저 따르기, 이 선호만 따르기.
  - 근거 규율 우회: 근거 없이, 출처(표기) 생략, 확정해 적기, 미확정 표시 빼기, without evidence, as certain, fact ledger.
  - 순서 선호(예: 결론을 근거보다 먼저 쓴다, 환불 정책보다 할인 혜택을 먼저 적는다)와 강조(고객 혜택을 최우선으로 적는다)는 막지 않는다.
  - 브랜드 범위 규칙이라 브랜드명은 허용하고, 할인 금액 같은 선호가 있어 가격 표기도 허용한다.
  - 코드 소유 표지와 겹치는 흔한 표현(예: 광고 게재·메시지 발송)도 막힌다. 다른 말로 적는다.
- 승인 전 주입 0건, 소유자 전용 승인, 인용 2건 이상·같은 브랜드, 60일 만료, 역할당 8개 상한, 모델 입력의 별도 블록과 경고 문구, 지시문의 권한 한계 문장이 함께 오염을 줄인다.
- 인용 판정 기록에는 검토 메모 원문이 없다(B1). 규칙 본문도 사람이 직접 쓴 400자 이하 문장뿐이다.

## B3-2 예정

- **Reflector**: 코드는 아래 [B3-2 Reflector 절](#b3-2-reflector)에 있다(스위치 `b3_reflector` 기본 꺼짐). 운영에서 켜는 것은 [데이터 처리 7절](DATA-PROCESSING.ko.md#7-b3-reflectora5-착수-조건)의 사람 확인 항목(법률 검토·HERMES 운영 주체·도구 설정)을 채운 뒤다.
- **helpful/harmful 카운터**: 저장하지 않고 읽을 때 계산하기로 했다(B3-2a, 아래 절). 저장 필드 `feedback`은 0으로 두고 쓰지 않는다.
- **performance_tested** 부여: 골든 on/off 비교(평가 run)를 첨부할 때만 연다. 지금은 `playbook_grade`·생성 모두 409다.
- 평가 실행과 운영 제출의 일치는 Q1(#86) `roleSubmission`으로 해소됐다(주입 블록 절). 회의·브리프 경로 주입 여부는 아직 정하지 않았다.

## B3-2a 교정 신호

B3-2a는 교정 데이터를 **읽을 때 모아 보여 주기만** 한다. 모델(HERMES·OpenAI)을 부르지 않고, 규칙(`learning_rule`)을 쓰지 않으며, 상태·만료·저장 필드 `feedback`(0 유지)을 바꾸지 않는다. Reflector(외부 모델 초안)는 여전히 F4b 뒤다.

- 순수 계산: `lib/playbook-curator.ts` `correctionClusters`·`playbookFeedback`·`recurrenceRate`. 타입·상수: `lib/learning.ts`(`PLAYBOOK_CLUSTER_MIN=5`, `CLUSTER_WINDOW_DAYS=90`).
- 서버: `lib/learning-server.ts` `playbookSignals`. 작업물 판정(최근 5,000건)을 요약(메모 길이·행위자 없음)하고 브랜드는 인용 검사와 같이 기록의 `brandId`, 없으면 캠페인의 브랜드로 정한다(알 수 없으면 제외).
- 스위치 `b3_playbook_signals`(기본 꺼짐)는 `lib/learning-server.ts`에서만 읽고, 읽기에 실패하면 꺼짐으로 본다.
  - 꺼짐: `GET /api/learning` 응답이 이전과 **바이트 동일**하고 새 키가 없다.
  - 켜짐: 대표·관리자에게만 `correctionClusters`·`playbookFeedback`·`recurrence` 키를 응답 끝에 덧붙인다. **직원 응답에는 키가 없다**(보상 계보와 같은 권한 관례). 화면도 대표·관리자만 그린다.
- 화면: 학습 규칙 탭 운영자 선호 영역 아래 '교정 신호' 절(`app/learning-panel.tsx` `PlaybookSignals`). 초안 대상 묶음의 '규칙 초안 쓰기'는 역할과 인용을 미리 채운 `playbook_create` 폼을 연다(생성은 소유자만, 본문은 사람이 쓴다, 저장하면 초안).

### (a) 교정 묶음 `correctionClusters`

- 교정 = 작업물 판정 중 `revision`, 또는 사람이 고친 판(`origin: ai_edited`)의 `approved`.
- 브랜드×역할로 최근 90일(`window`는 한국 날짜 `from`~`to`)을 센다. **5건 이상이면 `eligible`** 이고 `decisionIds`에 인용할 판정 id를 최신순으로 인용 상한(20건)까지 미리 채운다. 미달이면 `decisionIds`는 빈 배열이다.
- `coveredBy`: 그 묶음의 교정을 이미 인용한 같은 브랜드 운영자 선호 규칙 id.
- 담는 값은 id·역할·건수·사유 코드별 건수뿐이다(메모·이메일·본문 없음).

### (b) 규칙 버전별 파생 피드백 `playbookFeedback`

- 주입 기록(`learning_snapshot`의 `operatorPreferences`·`artifactId`)으로 규칙 버전(`ruleId`·`ruleVersion`)과 작업물을 잇고, 작업물마다 **기록 순서상 첫 판정**을 본다. AI 작성(`ai`·`ai_edited`)의 첫 판정만 `decidedFirst`에 넣는다.
  - `helpful`: 사람이 고치지 않은 판(`ai`)의 첫 판정이 `approved`. `firstPassApproval`의 1차 승인과 같은 정의라 보상 계보 `byRule`의 `approvedFirst`와 같은 값이다(`tests/playbook-signals.test.mjs` 교차 검사).
  - `editedFirst`: 사람이 먼저 고친 판(`ai_edited`)의 첫 판정.
  - `recurrence`: `ai` 첫 판정이 `revision`이고 사유 코드가 규칙이 인용한 판정의 사유 코드와 겹침. 겹치지 않으면 `otherRevision`. 네 값의 합이 `decidedFirst`다.
- 첫 판정이 5건 미만이면 `status: insufficient`. 모든 줄에 "자동 판정 아님: 규칙 상태·만료를 바꾸지 않습니다." 고지(`notice`)를 붙인다.

### (c) 같은 사유 재발률 `recurrence`

- 브랜드×역할×사유 코드. 사유 목록은 90일 교정 묶음에 나온 코드다(4주 창에 0건이어도 남는다).
- 4주 창에서 `n` = 판정받은 작업물 수, `rate` = 그중 그 사유로 교정받은 작업물 비율(소수 넷째 자리). **n<20이면 `rate: null`, `status: "표본 부족"`**(GROWTH-PLAN KPI '같은 사유 교정 재발률'의 표본 하한).

### (d) 경보 중 승인 동결(D3)

- 열린 모델·게이트웨이 변경 경보(`model_change`·`gateway_change`, 결정 10)가 있으면 `playbook_activate`를 **409**로 막는다. 스위치와 무관하게 늘 적용한다.
- 판정은 프롬프트 레지스트리의 활성화 게이트와 같은 `alarmState`(`lib/usage-model-alarm.ts`, `lib/prompt-registry.ts`가 쓰는 함수)이고, 해제도 같은 확인 절차(`POST /api/prompts` `acknowledge_alarms`, 소유자)다.
- `playbook_pause`(주입을 줄임)와 `playbook_renew`(적용 중 규칙의 만료만 늘림)는 막지 않는다.

## B3-2b 선호 on/off 쌍 평가

B3-2b는 운영자 선호 규칙이 역할 산출물을 나쁘게 만들지 않는지를 **골든 케이스 on/off 비교**로 잰다. 설계 권고 D5(초안도 평가)·D8·D11을 적용했다(대표 지시 2026-09-27 "B2 2단계 빼고 남은 개발 모두 진행"). 규칙 상태·만료·등급은 바꾸지 않는다. `performance_tested` 부여는 이번 범위가 아니다(여전히 409).

- 요청: `POST /api/eval {action:'start_run', pair:{kind:'operator_preferences', ruleIds:[…]}, caseIds, tokenBudget, label}`(소유자 전용, 관리자·직원 403, 비로그인 401). 평가 run 절차는 [EVAL 5절](EVAL.ko.md#운영자-선호-onoff-쌍-평가pairkind-operator_preferences-b3-2b).
- 두 쪽(같은 run·같은 게이트웨이 스냅샷, 케이스마다 번갈아):
  - off(`active`): 동결 요청에서 `operatorPreferences`를 뺀 제출. `roleSubmission`(운영 조립)과 바이트 동일하다.
  - on(`candidate`): 고른 규칙만으로 만든 블록을 넣은 제출. 블록은 운영 주입과 같은 `operatorPreferenceBlock`이고 순서도 운영 주입과 같은 `preferenceOrder`(역할 지정 먼저·최신순·id)다. 그래서 '이 규칙만 적용 중일 때의 운영 제출'과 바이트 동일하다.
- 순수 헬퍼(`lib/playbook-curator.ts`): `preferenceSides(request, block)` → `{off, on}`(원 요청 불변), `preferencePairCases(cases, rules)` → `{cases, skippedCases}`, `preferencePairRules(rules)`(블록·규칙 참조), `isPreferencePair`. `lib/learning-server.ts` `operatorPreferenceContext`도 같은 `preferenceOrder`를 쓴다(동작 동일).
- 규칙 검사: 1~8개(`MAX_ACTIVE_PER_ROLE`), 같은 브랜드, 운영자 선호 규칙만, 종료(`retired`) 거부. 초안·중지 규칙은 평가할 수 있다(D5).
- 대상 케이스: 고른 규칙이 모두 주입될 역할 케이스(같은 브랜드·역할·채널. `ruleApplies`의 범위 판정을 쓰고 상태·만료는 보지 않는다). 다른 브랜드·역할·채널 밖·회의 단계·브리프는 `skippedCases`로 센다.
- run 메타(`eval_run.pair`, 시작 때 고정):

```json
"pair":{"kind":"operator_preferences","unit":"operator_preferences","brandId":"oda","activeVersionId":"off","candidateVersionId":"playbook:9c1e@2","rules":[{"ruleRef":"playbook:9c1e@2","role":"content","channel":"*","status":"draft"}],"blockHash":"sha256:…","block":{"note":"…","rules":[…]},"skippedCases":1}
```

- 모델에 가는 블록에는 제목·버전·본문·채널·만료만 있다. 규칙 id·인용·카운터는 run 메타에만 둔다. 시작 뒤 규칙을 고치거나 중지해도 두 쪽 본문은 시작 때 블록이다.
- 판정: 기존 `pairGate`를 바꾸지 않고 쓴다(봉인 1건 이상·봉인 회귀 0·같은 게이트웨이·같은 모델·전 케이스 두 쪽 완료·후보 합격 수 ≥ off). 비회귀 게이트이며 개선을 주장하지 않는다.
- 이 run은 프롬프트 레지스트리 활성화 게이트(`activate`·`stage`·`promote`)의 근거가 되지 못한다(409, `lib/prompt-registry.ts`).
- 한계: 프롬프트 본문은 동결 요청 그대로라 레지스트리 active 버전이 있는 캠페인의 운영 제출과는 프롬프트 부분이 다를 수 있다(두 쪽 모두 같은 본문이라 비교는 공정하다). 회의·브리프 경로는 운영에서도 선호 블록을 넣지 않아 대상이 아니다.

## B3-2c 선호 쌍 평가 첨부

B3-2c는 끝난 선호 쌍 평가 run(B3-2b)을 **그 run이 평가한 규칙 버전에 감사 기록으로만** 붙인다(설계 권고 D4·D6, 대표 지시 "남은 개발 모두 진행"). 규칙 레코드의 버전·상태·만료·등급은 바꾸지 않으므로 `ruleRef`(`id@version`) 계보가 그대로 이어진다. 모델(HERMES·OpenAI)을 부르지 않는다.

- 요청: `POST /api/learning {"action":"playbook_attach_eval","id":"playbook:9c1e","version":2,"runId":"r-abc"}`. **대표만**(관리자·직원 403), 스위치 `b3_playbook_signals` 꺼짐이면 409.
- 거절:
  - 400: 프롬프트 쌍 run·단독(active)·심사(judge) run(`pair.kind`가 `operator_preferences`가 아님), 다른 브랜드의 run, 그 규칙을 평가하지 않은 run
  - 409: 진행 중(`completed`가 아님)·삭제한 run, 요청 `version`이 규칙의 지금 버전과 다름, run이 평가한 `ruleRef`에 요청 `id@version`이 없음(다른 버전을 평가함), 같은 run을 같은 버전에 다시 첨부
- 감사 기록(`playbook_audit`, 추가만): 기존 감사 필드(`id`·`brandId`·`fromStatus`=`toStatus`·`expiresAt`)에 run id·게이트·쌍 수를 더한다.

```json
{"action":"attach_eval","ruleId":"playbook:9c1e","ruleVersion":2,"evalRunId":"r-abc","gate":{"passed":true,"reasons":[],"warnings":["small_sample"]},"pairs":3,"sealed":1,"actor":{"id":"u1","role":"owner"},"createdAt":"…"}
```

- `gate`는 `GET /api/eval?pair=<run>`과 같은 `pairGate`(`lib/eval-stats.ts`)의 판정이다. `passed`=비회귀 게이트 통과, `reasons`·`warnings`=사유 코드. `pairs`=on/off 케이스 쌍 수, `sealed`=봉인 케이스 수. 실패한 게이트도 실패로 첨부한다(기록이지 승인 조건이 아니다).
- 평가 서버(`lib/eval-server.ts`)는 고치지 않는다. 평가 서버가 역할 실행을 거쳐 `lib/learning-server.ts`를 다시 불러 순환하므로, 판정의 원래 순수 모듈(`pairGate`)과 `EvalRun` 타입만 가져온다.
- `attach_eval` 감사는 개선 루프 후보가 아니다(`lib/improvement-loops.ts`는 `activate`만 본다).
- `performance_tested` 부여는 계속 409다(D6). 첨부는 등급을 바꾸지 않는다.
- 보기: `GET /api/learning` `playbookEvals`(규칙 버전별로 가장 나중에 첨부한 게이트). 교정 신호와 같은 스위치·권한이다(대표·관리자, 직원 응답에는 키 없음, 꺼짐이면 키 없음). 화면은 운영자 선호 규칙 카드에 "v2 · 골든 on/off: 비회귀 통과 · run 앞 8자 · 쌍 3(봉인 1) · 경고 small_sample"을 보이고, 대표에게만 '평가 첨부'(run id 입력) 버튼을 둔다.

### 4단계 종료 조건 절차

운영자 선호 규칙이 실제 역할 산출물에 들어가 사람이 볼 수 있을 때까지를 한 번 끝까지 돌린다. 모델을 부르는 단계는 쌍 평가뿐이다.

1. **대표 승인**: 이 절차(대상 브랜드·역할, 쌍 평가 토큰)를 대표가 승인한다.
2. **초안**: 교정 신호 묶음 또는 사람 판정 2건 이상을 인용해 `playbook_create`로 초안을 만든다(주입 0건).
3. **골든 캡처**: 같은 브랜드·역할의 역할 케이스를 골든셋에 캡처한다. 봉인(sealed) 케이스를 1건 이상 넣는다.
4. **on/off 쌍 평가**: `POST /api/eval` `pair.kind: operator_preferences`로 초안 규칙을 평가한다(약 100k 토큰, 스모크 상한 초과면 건별 승인 `overBudgetApproved`).
5. **첨부**: run이 `completed`가 되면 `playbook_attach_eval`로 그 규칙 버전에 붙인다. 화면에서 비회귀 통과·경고를 확인한다.
6. **승인**: 대표가 `playbook_activate`로 승인한다(경보가 열려 있으면 409). 승인하면 버전이 1 오른다. 첨부는 평가한 버전에 남는다.
7. **실제 주입**: 같은 브랜드·역할의 역할 실행을 1건 돌린다.
8. **appliedRules 확인**: 보상 계보(`GET /api/reward-lineage`)의 `appliedRules`·`byRule`에 그 규칙의 `ruleRef`가 나오는지, 작업물 끝에 규칙 제목·버전이 적혔는지 본다.
9. **기록**: run id·첨부 감사 id·주입 작업물 id·결과(passed/failed, real)를 `docs/observations/`에 남긴다.

## B3-2 Reflector

같은 브랜드×역할의 교정이 쌓이면 운영자 버튼으로 교정 사유와 바뀐 부분 발췌를 **Reflector 전용 HERMES 격리 프로필**에 1회 보내 운영자 선호 규칙 **초안**을 받는다. 초안은 `playbook_create`와 같은 검사를 통과한 것만 저장하고, 승인·주입은 기존 사람 승인 흐름(`playbook_activate`, 대표) 그대로다. 자동 활성화는 없다. 데이터 처리 기준은 [DATA-PROCESSING 4.3](DATA-PROCESSING.ko.md#43-b3-reflectora5가-지킬-추가-규칙-제안-법률-검토-전) DP-1~DP-9를 따른다.

- 순수 규칙(본문 조립·허용 목록·DP-3 검사·도구 흔적·후보 검사): `lib/reflector.ts`
- 서버(스위치·권한·격리 연결·발동 조건·제출·결과·초안 저장·보존 정리): `lib/reflector-server.ts`, API `app/api/reflector/route.ts`
- 화면: `app/reflector-section.tsx`(학습 규칙 탭, 운영자 선호 영역 아래, 대표·관리자만). `app/learning-panel.tsx`에는 import·마운트 한 줄만 더했다.
- records kind: `reflector_run`(실행·제출 원문·응답 원문), `reflector_connection`(전용 연결), `reflector_isolation`(대표 격리 확인) — `lib/record-kinds.ts`
- 테스트: `tests/reflector.test.mjs` (mocked: 메모리 SQLite·이메일 세션·모의 Reflector HERMES fetch 스텁·합성 데이터, 외부 호출 0, 운영 HERMES 호출 0)

### 스위치·권한·발동 조건

- 스위치 `b3_reflector`(기본 꺼짐)는 `lib/reflector-server.ts`에서만 읽고 읽기 실패는 꺼짐으로 본다. 꺼져 있으면 미리보기·실행·결과 확인이 모두 409(`blocked: switch_off`)이고 HERMES 호출은 0회다. GET은 `{"enabled":false}`만 돌려준다.
- 대표·관리자만 쓴다. 직원은 GET·POST 모두 403이다. 전용 연결 저장·격리 확인은 대표만 한다(관리자 403).
- 발동 조건은 B3-2a 교정 묶음(`correctionClusters`)과 같은 계산이다: 같은 브랜드×역할에서 90일 안 교정(수정 요청, 사람이 고친 판의 승인) **5건 이상**. 미만이면 409(`blocked: not_eligible`, `detail: {corrections, min}`)이고 호출 0회다. 보내는 교정은 묶음의 `decisionIds`(최신순, 인용 상한 20건)다.

### 2단계 흐름

`POST /api/reflector`

1. `{"action":"reflector_preview","brandId":"oda","role":"content"}` → 보낼 본문(`body.instructions`·`body.input`), `previewHash`(`sha256:` + 본문 JSON의 SHA-256), DP-3 탐지 결과 `findings`(필드 경로·종류·건수), `blocked`, 연결 상태 `gate`. **전송 0회, 저장 없음.**
2. `{"action":"reflector_run","brandId":"oda","role":"content","previewHash":"sha256:…","confirmed":true}` → 서버가 본문을 다시 만들어 해시가 같을 때만 보낸다.
   - 409 사유(`blocked`): `preview_mismatch`(미리보기 뒤 본문이 바뀜), `pii_detected`(`detail.findings`에 필드·종류·건수만), `no_connection`·`connection_not_ready`·`isolation_unconfirmed`·`same_host`(격리 프로필 조건), `in_progress`(같은 브랜드×역할에 다른 해시의 실행이 진행 중), `budget_exceeded`(토큰 예산 가드).
   - `confirmed: true`가 없으면 400이다. 같은 브랜드×역할에 **같은 해시**의 실행이 진행 중이면 새로 보내지 않고 그 실행을 `duplicate: true`로 돌려준다.
3. `{"action":"reflector_check","id":"reflector-…"}` → 진행 중이면 같은 전용 연결(같은 호스트)로 조회하고, 끝나면 사용량을 기록하고 결과를 처리한다. 끝난 실행을 다시 확인하면 아무것도 바꾸지 않는다. 화면은 진행 중인 실행을 5초마다 확인한다.

GET `/api/reflector?brandId=` → 스위치·전용 연결(호스트·상태, 키 없음)·격리 확인 여부·연결 게이트·역할별 교정 건수와 발동 가능 여부·최근 실행 10건(제출 원문·응답 원문·라벨 대응표 없음).

### 보내는 본문(DP-1·DP-2)

허용 목록은 코드 상수다(`REFLECTOR_INPUT_KEYS`·`REFLECTOR_BRAND_KEYS`·`REFLECTOR_CORRECTION_KEYS`·`REFLECTOR_SECTION_KEYS`). 레코드를 펼치지 않고 키를 골라 만든다.

```json
{"task":"operator_preference_rule_candidates","role":"content",
 "brand":{"name":"…","short":"…","category":"…","color":"…","tone":"…","audience":"…","constraints":"…"},
 "corrections":[{"ref":"d1","campaign":"c1","decision":"revision","reasonCodes":["voice"],"skillVersion":"content@v3","sections":[]},
                {"ref":"d5","campaign":"c2","decision":"approved","reasonCodes":[],"skillVersion":"content@v3","sections":[{"title":"카피","before":"…","after":"…"}]}]}
```

- `brand`는 `aiBrand(brand).identity`(정체성)만이다. 소개·브랜드 메모·의뢰 정보는 없다.
- `ref`는 판정 id 대신 가명 라벨(d1…), `campaign`은 캠페인 id 대신 가명 라벨(c1…)이다. 라벨 → 판정 id 대응표는 실행 기록(`labels`)에만 두고 모델에 보내지 않는다.
- `sections`는 선호 쌍(`preferencePair`)의 AI 원본(before)과 사람 확정본(after)에서 달라진 섹션(제목 `#~###` 단위, 편집 통계와 같은 규칙) 최대 3개, 쪽마다 600자까지다. 사람 확정본이 없으면(수정 요청만 받은 판) 빈 배열이고 사유 코드만 간다.
- 넣지 않는 것(검토 메모는 본문 경로가 없고, 입력 검사는 모든 문자열 값을 보므로 경로가 생기면 DP-3에 걸린다): 검토 메모 원문(`reviewNote`), 브랜드 메모·의뢰 정보, 점포 맥락, `orderRefs`·주문·성과 수치, 행위자(계정 id·이메일), 원 캠페인 id·판정 id·작업물 id. `tests/reflector.test.mjs`가 키 집합과 심어 둔 표지가 본문에 없음을 확인한다.
- 지시문(`REFLECTOR_INSTRUCTIONS`)은 코드 상수다. 도구를 쓰지 말고, 발췌를 그대로 옮기지 말고, 연락처·주소·URL·가격 수치를 넣지 말고, 인용 2개 이상을 적으라고 요구한다.

### 전송 전 검사와 기록(DP-3·DP-4)

- 입력의 모든 문자열 값을 `lib/pii-scan.ts` `scanText`로 검사한다(전화·이메일·주소·결제정보·고유식별번호·고객 식별자). 하나라도 있으면 **fail-closed**: 미리보기는 `blocked: true`와 필드·종류·건수를 보이고, 실행은 409(`pii_detected`)로 보내지 않는다. 가려서 보내기는 법률 검토 뒤 정한다(DP-3).
- 오류·차단 응답에는 필드 경로·종류·건수만 싣는다. 본문·탐지값·키를 콘솔·오류 문구·이벤트에 남기지 않는다(테스트가 콘솔 출력 전체를 확인한다).
- 저장하는 제출 원문은 전송 본문 그대로다(`reflector_run.submission.body` = HERMES로 보낸 바이트, 같은 `Idempotency-Key`). 저장한 뒤 보내고, 429·5xx·연결 오류로 접수가 불확실하면 `submitting`으로 남겨 결과 확인이 같은 키로 다시 보낸다.
- 미리보기는 운영자 화면에 본문을 보여 준다(DP-5 사람 확인). 사람 이름·민감정보는 패턴으로 다 잡지 못하므로 확인 체크가 있어야 보낼 수 있다.

### 격리 프로필(DP-7)

- HERMES 전용이다. OpenAI 직접 경로는 없다(`lib/reflector-server.ts`는 `openai`·`api.openai.com`을 부르지 않는다).
- 운영 HERMES 연결을 쓰지 않는다. 대표가 **Reflector 전용 연결**(주소·키, `reflector_save_connection`)을 따로 저장한다. 운영 연결과 같은 호스트면 400이다. 호스트는 이름(소문자, 끝 점 제거)으로만 비교하므로 포트가 달라도 막힌다. 443이 아닌 포트는 공통 주소 검사(`lib/hermes.ts` `hermesEndpoint`)가 먼저 400으로 거부하고 `:443`은 포트 없는 주소와 같게 본다(테스트 7). 키는 기존 연결과 같은 방식(`lib/server.ts` `encrypt`, AES-GCM)으로 암호화한다. 저장할 때 `/v1/capabilities`(실행·조회·중지·영구 멱등)와 인증 보호를 확인하고, 실패하면 `blocked` 상태로 저장해 실행을 막는다.
- 대표의 **격리 확인 기록**(`reflector_confirm_isolation`, "이 Reflector 프로필은 세션 메모리·스킬 축적이 꺼져 있고 도구(웹·브라우저·MCP)가 없습니다.")이 지금 연결에 대해 있어야 한다. 연결을 다시 저장하면 확인을 다시 해야 한다. 둘 중 하나라도 없으면 실행 409다.
- 코드는 프로필의 메모리·도구 설정을 직접 확인하지 못한다. 대표 확인 기록에 의존한다(평가 연결의 격리 확인과 같은 한계).
- **도구 흔적 폐기**: 조회 응답에 도구 흔적이 있으면 결과를 버리고(`discarded`) 초안을 만들지 않는다. 흔적 판정은 알려진 이름의 필드만 본다: `tool_calls`·`tools_used`·`tool_events`·`tool_results`·`tool_invocations`·`tools`(응답과 `usage`), `last_event`·`events[].type/event/name`의 tool·function_call·browser·web_search·web_extract. HERMES run 응답의 도구 호출 목록 필드는 문서화돼 있지 않아([DATA-PROCESSING 8절](DATA-PROCESSING.ko.md#8-확인-필요-목록) 4번), **흔적이 없다는 것이 도구 미사용의 증명은 아니다**.

### 결과와 초안(DP-6)

- 응답은 JSON `{"candidates":[{"text":"…","citations":["d1","d5"]}]}`이다. 형식이 틀리면 실행을 `failed`로 두고 초안을 만들지 않는다(응답 원문은 실행 기록에 남는다).
- 후보는 최대 5개이고 6번째부터 `over_limit`으로 거절한다. 후보마다 아래를 통과해야 초안이 된다. 거절은 순번과 사유 코드만 남긴다.
  - `text`: `playbook_create`와 같은 본문 검사(`ruleBodyProblem`: 400자, 연락처, URL·도메인·핸들, 명령형 주입, 근거 규율 우회, 코드 소유 정책, 동형 문자)
  - `pii`: DP-3 출력 검사(`scanText`, 주소 등 본문 검사가 보지 않는 패턴)
  - `quotes_source`: 보낸 발췌를 25자 이상 이어서 그대로 옮김(교정 원문 인용 금지)
  - `citation_outside`: 입력에 없는 라벨(다른 브랜드 판정 id 포함), `citations`: 인용 2건 미만·20건 초과 또는 `playbook_create`와 같은 인용 검사(`citedDecisions`: 실제 기록·같은 브랜드) 실패
  - `duplicate`: 같은 실행의 같은 본문
- 초안은 `playbook_create`와 같은 모양이다: `learning_rule`(`origin: review`, `grade: operator_preference`, `status: draft`, 역할 = 실행 역할, 채널 `*`, 인용 = 판정 id, 만료 60일). `scope`는 "사람 판정 N건 인용 · Reflector 초안"이다. 인용은 판정 id(작업물 id·판 참조)만이고 교정 원문은 담지 않는다.
- 초안마다 `playbook_audit` `create`를 남기고 `source: reflector`·`reflectorRunId`를 더한다(행위자 id·역할만).
- 인용 검사는 저장 직전에 `citedDecisions`를 그대로 다시 부른다. 실행 뒤 판정의 브랜드가 바뀌어(원 캠페인 변경 등) 같은 브랜드 판정 2건 이상이 되지 않으면 그 후보는 `citations`로 거절한다.
- 승인 전 주입 0건이다. 승인은 운영자 선호 규칙 카드의 기존 승인(대표, 경보 동결·역할당 8개 상한 적용)이다. 모델·게이트웨이 경보가 열려 있어도 Reflector 초안 생성은 막지 않고 승인(`playbook_activate`)만 409다(B3-2a D3와 같다).
- `GET /api/learning` 응답은 바꾸지 않았다(새 키 없음). Reflector 상태는 `GET /api/reflector`에만 있다.

### 예산·멱등·보존·삭제

- 제출 전에 토큰 예산 가드(loop-4, `reserveTokenBudget`)가 예약한다. 넘으면 409(`budget_exceeded`)이고 보내지 않으며 실행 기록도 남기지 않는다. 사용량은 `kind: learning`(역할 `reflector`)으로 기록하고 끝나면 예약을 정리한다.
- 멱등: 제출 키는 실행마다 새로 만들고(`collective-reflector-<uuid>`), 재전송은 같은 키다. 같은 브랜드×역할에 진행 중인 실행은 1건이다(소유자 잠금 안에서 판정).
- 보존: `reflector_run`은 만든 날부터 **90일**(`expiresAt`)이 지나면 Reflector 읽기·쓰기 때 지운다. 90일은 문서에 값이 없어 둔 COLLECTIVE 휴리스틱이며 **법률 검토 뒤 확정**한다.
- 삭제 연쇄: `reflector_run`은 브랜드 행(parent = 브랜드 id)이고, 입력에 들어간 캠페인(`campaignIds`) 중 하나를 지우면 함께 지운다(캠페인 삭제 대화상자의 'AI 요청·응답 원문'). 새 경로 `data_campaigns`(`campaignIds` 배열 포함 판정)를 `lib/record-kinds.ts`에 더했다. 앱에는 브랜드 삭제 경로가 아직 없다. 만든 초안(`learning_rule`)은 운영자 선호 규칙의 기존 정책을 따른다.
