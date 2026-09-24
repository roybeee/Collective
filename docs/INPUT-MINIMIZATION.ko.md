# 제작 경로 입력 최소화 (레인 A · 대표 결정 2026-09-24)

결론: 역할 실행·팀 회의·캠페인 브리프 초안이 HERMES(와 OpenAI 직접 경로)로 보내는 입력에서 필요 없는 필드를 빼고, 자유 텍스트 속 개인정보 패턴을 자리표시(`[전화번호]` 등)로 가린 뒤 보낸다. 전송은 막지 않는다. 가린 기록은 필드·종류·건수만 남기고 값은 어디에도 남기지 않는다.

비유: 외부 디자이너에게 매장 브리프를 넘기기 전에 서류철에서 필요 없는 장을 빼고(허용 목록), 남은 장의 고객 연락처는 검정 펜으로 지운다(가림). 매장 주소·대표 전화처럼 광고에 꼭 필요한 정보는 지우지 않는다(허용 값). 무엇을 몇 군데 지웠는지만 작업 일지에 적고, 지운 내용은 적지 않는다.

- 근거 문서: `docs/DATA-PROCESSING.ko.md` 4.2~4.4절, DP-1·DP-3·DP-4 표(이 문서는 그 문서를 고치지 않는다. 레인 B 소유).
- 범위: 4.4 조치 중 ①(회의 입력 허용 목록), ③(자유 텍스트 가림, 제작 경로), ④(담당자 필드), ⑤(브랜드 입력 허용 목록, 제작 경로). ②(`orderRefs`)·조사·학습 경로·⑦ 화면 안내·⑧ 조사 지시·업로드 추출문은 레인 B, ⑥ OpenAI `store`·metadata와 ⑨ 보존 기한은 법률 검토 뒤다.
- 운영 흐름은 가림(mask)으로 처리한다. 전송 차단(fail-closed)은 `failClosed` 옵션만 두고 B3-2 Reflector가 쓴다.
- 이 문서는 법률 자문이 아니다. 법률 검토 주체는 대표 본인이다(내부 브랜드 한정).

## 1. 공통 검사 모듈 `lib/pii-scan.ts`

순수 모듈이다(import 없음, 서버·네트워크 의존 없음). 레인 B와 B3-2가 같은 모듈을 가져다 쓴다.

| API | 하는 일 |
|---|---|
| `scanText(text,{allow?})` → `[{kind,count}]` | 종류별 건수만 돌려준다 |
| `maskText(text,{allow?,failClosed?})` → `{text,findings}` | 탐지 구간을 자리표시로 바꾼다. 탐지 0이면 같은 문자열을 돌려준다 |
| `maskFields(obj,paths,{allow?,failClosed?})` → `{value,findings:[{field,kind,count}]}` | 경로(`a.b`, 배열·고정 키 객체는 `*`)의 문자열만 가린 새 객체. 입력은 바꾸지 않고, 없는 경로는 만들지 않으며 키 순서를 지킨다(탐지 0이면 JSON 직렬화가 같다) |
| `PiiBlockedError` | `failClosed`에서 던진다. 문구·`findings`에는 필드·종류·건수만 있다 |
| `contactAllowValues(texts)` | 허용 목록용: 사업장 기록 속 전화번호·이메일 원문을 꺼낸다. 로그·이벤트에 쓰지 않는다 |
| `mergeFindings(...lists)` | 필드·종류별 건수를 합친다 |
| `PII_KINDS`, `PII_PLACEHOLDER` | 종류와 자리표시 |

정규화: 글자마다 NFKC(전각 숫자·`＠`·`．`)를 적용하고, 여러 대시(‐ ‒ – — ― − －)를 `-`로, 폭 없는 문자(ZWSP 등)를 없는 것으로 본 뒤 탐지한다. 가릴 때는 원문 위치로 되돌려 가린 부분 밖의 원문을 바꾸지 않는다.

허용 목록(`allow`): 정규화한 원문과 정확히 같은 부분에 완전히 들어간 탐지는 가리지 않는다. 걸치기만 하면 가린다(예: 허용 `가상로 12`는 `가상로 123`을 보호하지 않는다). 4자 미만 항목은 무시한다.

### 탐지 종류 (DP-3)

| DP-3 대상 | kind | 자리표시 | 탐지 |
|---|---|---|---|
| 휴대폰·일반 전화 | `phone` | `[전화번호]` | `010`·`011`·`016~019`, 지역번호 `02`·`031~064`, `070`·`080`·`0502~0508`, `+82`(`(0)` 포함), 괄호 지역번호, 구분자 공백·점·하이픈. `lib/order-import.ts`의 `PHONE`(비공개 상수)이 거부하는 값은 모두 잡는다(테스트로 고정) |
| 이메일 | `email` | `[이메일]` | `로컬부@도메인.최상위` |
| 주소 | `address` | `[주소]` | 도로명(두 글자 이상 이름 + `로`/`길`, `12번길`, 건물번호·부번), 지번(`…동`/`…리` 이름, `이문2동` 포함 + 번지·부번·`번지`), 동·호수(`101동 1203호`, `B동 201호`, 단독 `101동`, 단독 3자리 이상 `1203호`) |
| 결제정보 | `payment` | `[결제정보]` | 카드: 13~19자리(숫자 사이 공백·하이픈 1개, `CARD`와 같은 규칙). 계좌: 은행명(`…은행`·`…뱅크`·농협·신협·새마을금고·우체국·IBK·KB)이나 `계좌(번호)` 뒤 숫자 묶음 10~16자리(은행명까지 가린다) |
| 고유식별번호 | `national_id` | `[고유식별번호]` | 주민등록·외국인등록 형식(생년월일 6자리 + 1~8 + 6자리, 하이픈 유무), 운전면허 2-2-6-2, 여권 후보(영문 1자 + 8자리, 신형 3자리+영문+4자리) |
| 고객 식별자 | `customer_id` | `[고객식별자]` | 64자리 16진(`orderRefs` 형식) |
| 사람 이름 | — | `[담당자]` | 패턴이 아니라 필드 단위로 바꾼다(2.3) |

탐지기 우선순위: 해시 → 이메일 → 고유식별번호 → 전화 → 계좌 → 카드 → 주소. 앞선 탐지와 겹치는 뒤 탐지는 버린다(해시 속 숫자열, 이메일 속 번호, 주민등록번호 13자리가 카드로 두 번 세지지 않는다). 32자 이상 16진·UUID(커밋 SHA, 작업물 id) 안의 숫자열은 전화·카드 등으로 보지 않는다.

오탐 억제(테스트로 고정, 원문 그대로): 날짜(`2026-09-24`, `2026.09.24`, ISO 시각), 시각(`14:30`), 가격(`12,000원`), 버전(`2026-09-23.3`, `v2.3.1`), 퍼센트(`12.5%`), KPI 수치(`주문 120건`, `CTR 1.8%`, `ROAS 320%`, `첫 포장 주문 30건/주`), 수량 표현(`무료로 100개`, `추가로 2 종`, `재방문율로 20 이상`, `기준으로 3`, `기존대로 8,000자`, `계획대로 3.5%`, `예정대로 10`, `신메뉴로 1,200원`), 흔한 명사(`고객 행동 3`, `리뷰 관리 2`, `조리 5`), 노선·지점(`2호선`, `3호점`), 대표번호(`1588-0000`).

## 2. 제작 경로 변경

적용 위치: 역할 `lib/role-instruction.ts buildRoleInputMasked`(운영 `lib/role-execution.ts`와 서버 평가 `lib/eval-server.ts`가 같은 함수를 쓴다), 회의 `lib/meeting-execution.ts context`, 브리프 `lib/brief-execution.ts`. 공통 규칙은 `lib/ai-context.ts`에 있다.

### 2.1 회의 작업물 허용 목록 (①, DP-1)

`originalArtifacts`와 품질 단계 `candidateArtifacts`는 코드 상수 `MEETING_ARTIFACT_FIELDS`로만 만든다. 레코드를 펼쳐 보내지 않는다.

| 보내는 필드 | 빼는 필드(예) |
|---|---|
| `ref`(계산), `id`, `role`, `title`, `content`, `version`, `status`, `createdAt`, `factsChanged`, `brandChanged`, `unverifiedClaims`, `qualityReview`, `excerpt`(계산). 후보 작업물은 `changes`(회의 개선본의 변경 위치)를 더한다 | `reviewNote`·`reviewedAt`·`reviewedVersion`(검토 메모), `origin`·`aiSource`·`aiSourceId`(사람 수정 표시), `editStats`(편집 통계), `complianceHold`(준수 보류), `promptVersion`·`promptFallback`·`promptRecheck`·`skillVersion`·`outputContractVersion`(실행 메타), `factRefs`, `outputSignal`·`outputTokens`, `meetingId`, `campaignId`·`campaignVersion`, 그 밖에 목록 밖의 모든 필드 |

본문 상한: `originalArtifacts`는 기존대로 8,000자. `candidateArtifacts`는 역할 경로 `upstreamContext`의 품질 담당 상한과 같은 24,000자이고 잘리면 `excerpt:true`다(회의 개선본 최대 30,000자, 수정되지 않은 스냅샷 작업물 최대 40,000자가 이제 상한을 받는다). 테스트: `tests/input-minimization.test.mjs`가 목록 밖 필드가 입력에 없는지, 상한과 `excerpt`를 확인한다.

### 2.2 브랜드 입력 허용 목록 (⑤)

`aiBrand`는 `identity`(name·short·category·color·tone·audience·constraints)와 `brandIntro`만 만든다. 의뢰 정보 `intake`(웹사이트·SNS·시장·의뢰 목적·경쟁사)는 제작 입력에서 뺐다. `brandIntro.text`(소개+메모)와 `identity.audience`·`identity.constraints`는 가린 뒤 보낸다(탐지 0이면 원문 그대로). 조사·학습 경로의 브랜드 입력은 레인 B다.

### 2.3 담당자 필드 (④)

| 필드 | 경로 | 처리 |
|---|---|---|
| 캠페인 `plan.owner`(담당자·협업 자원) | 역할 `campaign`, 회의 `campaign`, 브리프 `currentBrief`·`previousCampaigns[]` | 값이 있으면 `[담당자]`로 바꾼다. 빈 값은 그대로(모델은 입력 여부만 안다. 브리프의 보호 필드 규칙은 그대로) |
| 점포 진단 `assignee` | 세 경로의 `brandArchive.storeMarketing.operations.diagnostics[]` | 값이 있으면 `[담당자]`로 바꾼다. 빈 값은 그대로. `lib/store-context.ts`는 바꾸지 않고 제작 입력에서만 바꾼다 |
| 상시 지시 `createdBy` | `evidence.directives[]` | 이전부터 `author`(관리자/직원)로만 보낸다. 이메일·id는 가지 않는다(변경 없음) |
| 채택 진단 `confirmedBy` | `brandArchive.confirmedDiagnosis` | 이전부터 뺀다(`lib/archive-server.ts withoutAdoption`, 변경 없음) |
| 캠페인 `archivedBy` | — | 보관된 캠페인은 역할·회의·브리프를 시작할 수 없고 보관 해제 때 지워지므로 입력에 오지 않는다 |

### 2.4 자유 텍스트 가림 (③)

| 경로 | 가리는 필드 |
|---|---|
| 역할 | `brand.brandIntro.text`, `brand.identity.audience`·`constraints`, `evidence.directives[].text`, `campaign.title`·`goal`·`audience`·`channels`·`stores`·`products`·`constraints`·`sources`·`plan.*`, 앞선 작업물 `previous[].title`·`content`(사람 수정본 포함), `previousDecisions.agenda`·`decisions`·`questions`, `revisionRequest.note`(검토 메모)·`previousExcerpt` |
| 회의 | `agenda`, 브랜드·상시 지시·캠페인(역할과 같음), `recordedMetrics[].notes`·`source`·`definition`, `previousMeeting.agenda`, `originalArtifacts[]`·`candidateArtifacts[]`의 `title`·`content` |
| 브리프 | 브랜드·상시 지시(역할과 같음), `currentBrief`(캠페인 필드와 `plan.*`), `previousCampaigns[].title`·`goal`·`plan.*`, `recordedMetrics[]`(회의와 같음), `approvedLearnings[].title`·`content` |

허용 값(가리지 않음): 그 캠페인 범위(브랜드·지점)의 확정 사실(`evidence.facts.confirmed[].value`)과 지점 레코드의 주소(`store.address`)·레코드에 적힌 사업장 전화·이메일 원문(`productionAllow`).

가리지 않는 것: 확정·금지·후보 사실(`evidence.facts`), 점포 맥락(`brandArchive`, 담당자 필드만 예외), 모델 출력(회의 발언·합의·개선 과제·개선본 변경 위치), 학습 규칙(`learning`·`trialLearning`), 운영자 선호 규칙 블록(`operatorPreferences`, B3-1), 브랜드 자료 발췌(`brandArchive.confirmedSources`, 업로드 추출문은 레인 B).

### 2.5 가림 기록과 저장본 (DP-4)

| 경로 | 기록 위치 | 형태 |
|---|---|---|
| 역할 | `role_output_contract.inputMasking` | 실행마다 `[{field,kind,count}]`(0건이면 빈 배열) |
| 회의 | `team_meeting.steps[].inputMasking` | 단계 제출마다 같음. 화면 응답(`publicMeeting`)에도 값 없이 포함된다 |
| 브리프 | `brief_draft.inputMasking` | 같음 |

- `hermes_submission`·`openai_submission` 저장본은 가린 전송본 그대로다. 복구(같은 키 재전송)도 저장본을 다시 보낸다(`lib/hermes.ts` 변경 없음).
- 콘솔·오류·이벤트에 값을 남기지 않는다. `failClosed` 오류 문구에도 필드·종류·건수만 있다.
- 사용자가 입력한 원 레코드(작업물 `reviewNote`, 캠페인, 브랜드, 상시 지시, 성과)와 그 내부 사본(작업물 이력 `history`, 회의 `snapshot`·`agenda`, 브리프 초안 `input`)은 그대로 둔다. 회의 스냅샷은 재시도·stale 판정(`lib/meeting-repair.ts`)이 원 레코드와 비교하므로 원문이어야 한다. 역할 `inputHash`(job id 끝 20자)는 이전처럼 원 입력의 SHA-256 앞자리다.
- 테스트: `tests/input-minimization.test.mjs`가 합성 전화번호·이메일·주소·담당자 이름이 모든 HERMES 요청 본문, 원 레코드 밖의 모든 DB 행, 콘솔 출력에 없음을 확인한다.

## 3. 스냅샷 재캡처

기준 커밋 `9bdcfc8`(코드 변경 커밋)에서 기존 절차로 다시 만들었다. 외부 호출 0회, 합성 데이터.

- `tests/fixtures/role-submission-9bdcfc8.json`: `node --experimental-vm-modules scripts/eval/capture-role-submission.mjs --sha 9bdcfc80bcab0811ece2e0d8d9b98dfa72116efb --out tests/fixtures/role-submission-9bdcfc8.json`
- `tests/fixtures/prompt-baseline-9bdcfc8.json`: `PROMPT_BASELINE_SHA=9bdcfc80bcab0811ece2e0d8d9b98dfa72116efb PROMPT_BASELINE_CAPTURE=tests/fixtures/prompt-baseline-9bdcfc8.json node --experimental-vm-modules tests/prompt-baseline.test.mjs`

변경 전후 차이(기준 `c75e667`과 구조 비교):

| 스냅샷 | 지시문 | 역할 입력·`inputHash` | 회의 입력 | 가림 자리표시 |
|---|---|---|---|---|
| role-submission(16케이스) | 16/16 동일 | 제거·추가 필드 0. 다른 값은 캡처 시각(`campaign.updatedAt`, 실행 중 갱신되는 시각)뿐이다 | — | 0 |
| prompt-baseline(역할 8, 회의 12단계 ×2, 학습 1) | 33/33 동일 | 8/8 동일(`inputHash` 포함) | 24/24 변경: (1) 작업물 제거 필드 `campaignId`·`campaignVersion`·`origin`(시드 작업물), 역할 실행 작업물은 여기에 `skillVersion`·`outputContractVersion`·`factRefs` (2) 품질 단계 `candidateArtifacts[].excerpt`(상한 표시, 2.1) 추가 | 0 |

합성 fixture에는 허용 목록 밖 개인정보 패턴이 없어 가림 차이는 0이다(fixture의 지점 주소 `가상동 12 B동 201호`·`가상동 12`는 확정 사실이라 허용 값이다). `docs/EVAL.ko.md`의 옛 fixture 이름(`role-submission-fc8eb5c.json`)은 레인 B 소유 문서라 이 PR에서 고치지 않았다.

## 4. 검증 명령

| 명령 | 내용 |
|---|---|
| `node --experimental-vm-modules tests/pii-scan.test.mjs` | 탐지·가림·허용 목록·오탐 억제·`maskFields`·`failClosed`·`order-import` 상위 집합(순수, mocked) |
| `node --experimental-vm-modules tests/input-minimization.test.mjs` | 역할·회의·브리프 실행 경로(모의 HERMES, 메모리 SQLite, mocked) |
| `node scripts/test.mjs` | 전체 스위트(재캡처 스냅샷 포함) |

## 5. 알려진 한계

- 사람 이름·민감정보(건강·알레르기 등)는 자유 텍스트에서 패턴으로 잡지 않는다. 담당자 필드만 필드 단위로 바꾼다(DP-5 사람 확인 몫).
- 주소는 상세 부분(도로명+건물번호, 지번, 동·호수)만 가리고 시·구·동 이름은 남는다. 한 글자 도로명(`종로 1`), 번지 없는 주소, 영문 주소, 건물명만 적은 위치는 잡지 않는다. 흔한 명사·부사 목록 밖의 `…동/…리 + 숫자`나 `…로/…길 + 숫자`(수량 단위·천 단위 쉼표·소수점 없이 끝나는 경우)는 주소로 가려질 수 있다. 32자 이상 16진 토큰에 붙어 쓴 번호는 잡지 않는다.
- 대표번호(`1588-xxxx` 등 8자리)는 사업장 번호로 보고 잡지 않는다. 지역번호 없는 7~8자리 번호도 잡지 않는다.
- 13~19자리 숫자열은 모두 카드로 본다(Luhn 검사 없음, `CARD`와 같다). EAN-13 바코드·긴 주문번호도 `[결제정보]`로 가려진다. 13자리 바코드가 생년월일 형식이면 `[고유식별번호]`가 된다.
- 여권·운전면허·외국인등록 형식은 후보 패턴이다. 정확한 범위는 `docs/DATA-PROCESSING.ko.md` 6절 14번 법률 검토에서 정한다. 영문 1자 + 8자리 제품 코드는 여권으로 가려질 수 있다.
- 사용자가 브리프에 직접 적은 주소·전화가 확정 사실이나 지점 레코드에 없으면 가려져서, 브리프 사실 후보(`factCandidates`)로 제안되지 않는다(출처 확인은 원 입력으로 하므로 자리표시 값은 버려진다).
- 가리지 않는 입력(2.4 '가리지 않는 것')에 개인정보가 있으면 그대로 간다. 특히 학습 규칙 문구, 운영자 선호 규칙, 점포 맥락 자유 텍스트(채널 확인 근거·조사 초안·진단 관찰), 브랜드 자료 발췌다.
- 캠페인의 AI 초안 적용 기록(`draftMeta`: 제안 값·질문·가정)은 가림 경로에 넣지 않았다(모델이 만든 제안이다).
- 회의 발언·합의 같은 모델 출력은 가리지 않는다. 이 변경 이전에 가리지 않은 입력으로 만든 출력에는 개인정보가 섞여 있을 수 있다.
- 작업물 검토 이벤트(`app/api/action/route.ts`의 '수정 요청 · 메모')처럼 제작 경로 밖의 이벤트 문구는 이 변경의 범위가 아니다.
- 평가 케이스(`eval_case.request`)는 원 요청을 동결해 저장한다. 제출 때 `buildRoleInput`이 가리므로 평가 HERMES로는 가린 본문이 가지만, 저장된 동결 요청 자체는 원문이다.
