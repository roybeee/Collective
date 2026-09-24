# 교정 기반 플레이북 (B3-1)

사람이 작업물·브리프 제안·자료·발행을 판정한 기록(B1 `review_decision`)에서 반복된 선호를 **운영자 선호 규칙**으로 만들어, 소유자가 승인한 뒤 AI 역할 입력에 전달한다.
성과 실험에서 나온 학습 규칙(바이럴·점포)과 등급·만료·주입 블록을 분리한다. 이번 단계(B3-1)는 모델(HERMES·OpenAI)을 부르지 않는다. 규칙은 사람이 직접 쓰고, 교정 데이터를 외부 모델로 보내는 Reflector는 B3-2다.

- 순수 규칙(등급·범위·만료 상태, 화면·서버 공용): `lib/learning.ts`
- 본문 검사·Curator·주입 블록(순수): `lib/playbook-curator.ts`
- 저장·승인·중지·연장·인용 검사(D1): `lib/learning-server.ts` (`playbook_*` 작업, `POST /api/learning`)
- 역할 입력 주입: `lib/role-execution.ts` (`roleRequestFor`·start 분기)
- 화면: `app/learning-panel.tsx` 학습 규칙 탭의 운영자 선호 영역
- records kind: `learning_rule`(규칙), `playbook_audit`(감사, 새 kind) — `lib/record-kinds.ts`. 중지 때 재확인 표시는 새 kind 없이 캠페인 이력(`event`)의 `playbookRecheck` detail이다.
- 테스트: `tests/playbook.test.mjs` (mocked: 메모리 SQLite·헤더 세션·모의 HERMES, 플레이북 작업의 모델 호출 0)

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
| `playbook_activate`(승인) | `draft`·`paused` → `active` | 버전 일치, 역할당 활성 8개 상한(초과 409), 만료 = 지금 + 60일 |
| `playbook_pause`(중지) | `active` → `paused` | 주입된 작업물 재확인 표시, 영향 건수 반환 |
| `playbook_renew`(연장) | `active` 유지 | 만료 = 지금 + 60일, 상한 재확인 |

- 모든 작업은 소유자 전용이고 규칙 버전(`version`)이 다르면 409다.
- 매 작업마다 `playbook_audit` 1건: 규칙 id·브랜드·작업·전후 상태·규칙 버전·만료·행위자(id·역할만)·중지 때 `affectedArtifacts`. 이메일·본문 원문은 담지 않는다.
- 기존 `pause_rule`·`retire_rule`·`renew_rule`·`retest_rule`은 운영자 선호 규칙에 409다(소유자 검사·감사를 우회하지 않게).

## 주입 블록

역할 실행(`lib/role-execution.ts`)만 운영자 선호 규칙을 넣는다. **회의·브리프 경로는 이번 범위 밖**이며 `learningContext`가 운영자 선호 규칙을 빼므로 이전과 같다.

- `operatorPreferenceContext(owner,campaign,role)`: 승인·미만료·같은 브랜드·채널·역할이 맞는 규칙, 역할 지정 규칙 먼저·최신순, 역할당 8개까지.
- 역할 입력 끝에 `operatorPreferences` 키로 붙인다: `{note, rules:[{title,version,text,channel,expiresAt}]}`. 규칙 id·인용·카운터는 모델에 보내지 않는다.
  `note`는 이 블록이 성과 근거·확정 사실이 아니며 사실 원장·브리프·근거 규칙과 충돌하면 따르지 말라고 적는다.
- `learning` 블록(성과 규칙)은 그대로다. 운영자 선호 규칙은 `learning`에 섞지 않는다.
- **규칙 0건이면 키 자체를 넣지 않는다.** 이때 역할 요청·제출 본문·`inputHash`·`learning_snapshot`은 이전과 바이트 동일하다(`tests/role-instruction`·`role-execution-drift`·`prompt-baseline` 불변).
- 규칙이 있으면 `inputHash`에 같은 블록을 넣어 새 실행 id가 되고, `learning_snapshot`에 `operatorPreferences`(주입한 규칙 사본)와 `artifactId`(이 실행이 저장할 작업물 id)를 남긴다.
- 알려진 한계: 순수 입력 조립 함수(`lib/role-instruction.ts buildRoleInput`)는 이 블록을 모른다. 역할 실행이 그 출력에 `withOperatorPreferences`로 덧붙인다. 평가 케이스 캡처(`lib/eval-server.ts`)는 요청에 `operatorPreferences`를 동결하지만 재실행 입력에는 아직 넣지 않는다.

## Curator (`lib/playbook-curator.ts`, 순수)

- 같은 브랜드·역할(역할 없는 규칙은 모든 역할과 겹친다)의 초안·적용 중·중지 규칙 쌍을 본다. **병합 제안만** 하고 규칙을 바꾸지 않는다(`GET /api/learning`의 `playbookSuggestions`).
  - 중복: NFKC·소문자·글자와 숫자만 남긴 본문의 2-gram Dice 유사도 0.8 이상.
  - 충돌: 한쪽만 부정·금지 표지(…하지 않는다·금지·피한다·삼가 등)가 있고, 표지를 뺀 주제 유사도 0.6 이상. 휴리스틱이라 사람이 판단한다.
- 역할당 활성 상한 8개(`MAX_ACTIVE_PER_ROLE`). 역할 없는 규칙은 모든 역할에 한 칸씩 쓴다. 만료된 규칙은 세지 않는다. 채널과 무관하게 보수적으로 센다.
- 만료 적용과 재확인 표시는 위 등급과 만료 절을 따른다.

## 중지와 재확인 표시

중지하면 다음 작업부터 주입하지 않는다. 이미 주입된 작업물은 `learning_snapshot`의 `operatorPreferences`·`artifactId`로 찾고, 실제로 저장된 작업물만 센다.
캠페인마다 이력(`event`) 1건을 남기고 그 `playbookRecheck` detail에 `{ruleId, reason:'rule_paused', artifacts:[{artifactId, artifactVersion, ruleVersion(주입 당시), jobId, role}]}`를 싣는다.
**작업물 내용·버전은 바꾸지 않는다.** 응답의 `affected`가 재확인 표시 작업물 수다. 캠페인 이력이라 캠페인 화면 이력에 보이고 캠페인과 함께 지워진다.
학습 화면은 `GET /api/learning`의 `playbookRechecks`(이력을 작업물 단위로 편 목록)로 규칙마다 재확인 표시 건수를 보인다.
새 캠페인 범위 kind를 만들지 않은 이유: 캠페인 삭제 대화상자(`lib/deletion-summary.ts`)가 삭제되는 모든 kind에 이름을 요구하고, 재확인 표시는 캠페인 이력의 성격이기 때문이다.

## 오염 방어

- 본문은 NFC·공백 정규화 뒤 **400자 이하**.
- 연락처(이메일·국내 전화번호·대표번호)는 거부한다.
- F3a 본문 검사(`lib/prompt-units.ts validateUnitBody`)를 재사용해 URL·도메인·IP·계정 핸들, 명령형 주입 문구(이전 지시 무시·상위 규칙 우선·시스템 프롬프트·역할 전환), 보이지 않는 문자, 코드 소유 정책 문구(근거 규율·사실 정책·출력 계약·외부 행동 금지)를 거부한다.
  - 브랜드 범위 규칙이라 브랜드명은 허용하고, 할인 금액 같은 선호가 있어 가격 표기도 허용한다.
  - 코드 소유 표지와 겹치는 흔한 표현(예: 광고 게재·메시지 발송)도 막힌다. 다른 말로 적는다.
- 승인 전 주입 0건, 소유자 전용 승인, 인용 2건 이상·같은 브랜드, 60일 만료, 역할당 8개 상한, 모델 입력의 별도 블록과 경고 문구가 함께 오염을 줄인다.
- 인용 판정 기록에는 검토 메모 원문이 없다(B1). 규칙 본문도 사람이 직접 쓴 400자 이하 문장뿐이다.

## B3-2 예정

- **Reflector**: 교정 데이터(판정 이력·선호 쌍)를 외부 모델로 보내 규칙 초안을 제안한다. 대표 결정 12에 따라 **F4b 데이터 처리 문서가 먼저**다. 제안은 `playbook_create`와 같은 검사(인용 2건 이상·같은 브랜드·본문 검사)를 거친 `draft`로만 들어오고 승인은 사람이 한다.
- **helpful/harmful 카운터** 갱신: `learning_snapshot.operatorPreferences`와 `artifactId`로 규칙이 주입된 작업물의 판정(`review_decision`)을 이어 센다.
- **performance_tested** 부여: 골든 on/off 비교(평가 run)를 첨부할 때만 연다. 지금은 `playbook_grade`·생성 모두 409다.
- 입력 조립 함수(`buildRoleInput`)에 `operatorPreferences`를 옮겨 평가 캡처·리플레이도 같은 입력을 만들게 하고, 회의·브리프 경로 주입 여부를 정한다.
