# 제작 경로 입력 최소화 (레인 A · 대표 결정 2026-09-24)

결론: 역할 실행·팀 회의·캠페인 브리프 초안이 HERMES(와 OpenAI 직접 경로)로 보내는 입력에서 필요 없는 필드를 빼고, 자유 텍스트 속 개인정보 패턴을 자리표시(`[전화번호]` 등)로 가린 뒤 보낸다. 전송은 막지 않는다. 가린 기록은 필드·종류·건수만 남기고 값은 어디에도 남기지 않는다.

비유: 외부 디자이너에게 매장 브리프를 넘기기 전에 서류철에서 필요 없는 장을 빼고(허용 목록), 남은 장의 고객 연락처는 검정 펜으로 지운다(가림). 매장 주소·대표 전화처럼 광고에 꼭 필요한 정보는 지우지 않는다(허용 값). 무엇을 몇 군데 지웠는지와 몇 군데를 일부러 남겼는지만 작업 일지에 적고, 그 내용은 적지 않는다.

- 근거 문서: `docs/DATA-PROCESSING.ko.md` 4.2~4.4절, DP-1·DP-3·DP-4 표(이 문서는 그 문서를 고치지 않는다. 레인 B 소유).
- 범위: 4.4 조치 중 ①(회의 입력 허용 목록), ③(자유 텍스트 가림, 제작 경로), ④(담당자 필드), ⑤(브랜드 입력 허용 목록, 제작 경로). 학습 경로의 ⑤·⑧은 레인 A 후속 PR이다(6절. 레인 A 세션이 종료돼 레인 B 세션이 이어받았다). ②(`orderRefs`)·조사 경로 ⑤·⑦ 화면 안내·⑧ 조사 지시는 레인 B(#69), 업로드 추출문은 레인 B 후속, ⑥ OpenAI `store`·metadata와 ⑨ 보존 기한은 법률 검토 뒤다.
- 운영 흐름은 가림(mask)으로 처리한다. 전송 차단(fail-closed)은 `failClosed` 옵션만 두고 B3-2 Reflector가 쓴다.
- 이 문서는 법률 자문이 아니다. 법률 검토 주체는 대표 본인이다(내부 브랜드 한정).

## 1. 공통 검사 모듈 `lib/pii-scan.ts`

순수 모듈이다(import 없음, 서버·네트워크 의존 없음). 레인 B와 B3-2가 같은 모듈을 가져다 쓴다.

| API | 하는 일 |
|---|---|
| `scanText(text,{allow?})` → `[{kind,count}]` | 종류별 건수만 돌려준다 |
| `maskText(text,{allow?,failClosed?})` → `{text,findings,allowed}` | 탐지 구간을 자리표시로 바꾼다. 가릴 탐지 0이면 같은 문자열을 돌려준다. `allowed`는 허용 값이라 가리지 않은 탐지의 종류·건수다 |
| `maskFields(obj,paths,{allow?,failClosed?})` → `{value,findings,allowed}`(각 `[{field,kind,count}]`) | 경로(`a.b`, 배열·고정 키 객체는 `*`)의 문자열만 가린 새 객체. 입력은 바꾸지 않고, 없는 경로는 만들지 않으며 키 순서를 지킨다(가릴 탐지 0이면 JSON 직렬화가 같다) |
| `PiiBlockedError` | `failClosed`에서 던진다. 문구·`findings`에는 필드·종류·건수만 있다. 허용 값은 막지 않는다 |
| `contactAllowValues(texts)` | 허용 목록용: 지점 기록의 연락 동선 속 유선·대표 전화번호 원문만 꺼낸다. 휴대폰 대역(`010`·`011`·`016~019`, `+82 10` 포함)과 이메일은 사업장 값인지 알 수 없어 꺼내지 않는다. 로그·이벤트에 쓰지 않는다 |
| `mergeFindings(...lists)` | 필드·종류별 건수를 합친다 |
| `PII_KINDS`, `PII_PLACEHOLDER` | 종류와 자리표시 |

정규화: 글자마다 NFKC(전각 숫자·`＠`·`．`)를 적용하고, 여러 대시(‐ ‒ – — ― − －)와 구분자로 쓰는 가운뎃점류(· ‧ • ∙ ㆍ ・)·한글 `ㅡ`를 `-`로, 폭 없는 문자(ZWSP 등)를 없는 것으로 본 뒤 탐지한다. 가릴 때는 원문 위치로 되돌려 가린 부분 밖의 원문을 바꾸지 않는다.

허용 목록(`allow`): 다음 탐지는 가리지 않고 `allowed`로 센다. (1) 정규화한 허용 값과 정확히 같은 부분에 완전히 들어간 탐지. (2) 허용 값 안에서 탐지되는 조각(도로명+건물번호, 지번, 동·호수, 전화번호)과 같은 탐지. 조각 비교는 전화면 숫자만(`+82`는 `0`으로), 그 밖은 공백·쉼표를 뺀 문자열로 한다. 그래서 지점 주소 `가상시 가상구 가상로 12, 1층 C107호`가 허용 값이면 본문의 `가상로 12`·`가상로12`도 남는다. 걸치기만 하거나 다른 번호면 가린다(예: 허용 `가상로 12`는 `가상로 123`·`가상로 120`을 보호하지 않는다). 4자 미만 항목·조각은 무시한다.

### 탐지 종류 (DP-3)

| DP-3 대상 | kind | 자리표시 | 탐지 |
|---|---|---|---|
| 휴대폰·일반 전화 | `phone` | `[전화번호]` | `010`·`011`·`016~019`, 지역번호 `02`·`031~064`, `070`·`080`·`0502~0508`, 국가번호 `+82`·`(+82)`·`+` 없는 `82`(`(0)` 포함), 괄호 지역번호. 구분자: 없음, 공백 1~2개, `-`·`.`(앞뒤 공백 0~2개, `010 - 0000 - 0000`), 붙여 쓴 `/`, 가운뎃점류·`ㅡ`(정규화). `lib/order-import.ts`의 `PHONE`(비공개 상수)이 거부하는 값은 모두 잡는다(테스트로 고정) |
| 이메일 | `email` | `[이메일]` | `로컬부@도메인.최상위` |
| 주소 | `address` | `[주소]` | 도로명(두 글자 이상 이름 + `로`/`길`, `12번길`, 건물번호·부번), 지번(`…동`/`…리` 이름, `이문2동` 포함 + 번지·부번·`번지`. `…리 + 숫자`는 부번·`번지`가 있거나 읍·면 바로 뒤일 때만), 동·호수(`101동 1203호`, `B동 201호`, 단독 `101동`). 단독 3자리 이상 호수(`1203호`)는 주거 건물 이름(아파트·빌라·오피스텔·맨션·연립·주택·원룸·고시원·기숙사·레지던스) 바로 뒤나 도로명·지번 탐지 바로 뒤(쉼표·층 표기만 사이에 둠, `가상로 12, 3층 301호`)에서만 잡는다 |
| 결제정보 | `payment` | `[결제정보]` | 카드: 구분자 없는 13~19자리(`CARD`와 같다), 또는 같은 구분자(공백 1~2개, `-`·`.`, 공백 낀 `-`)를 되풀이한 카드 묶음(4-4-4-1~7, 4-4-4-4-1~3, 4-6-4~5)이면서 Luhn 검사를 통과하는 것. 계좌: 은행명(`…은행`·`…뱅크`·농협·신협·새마을금고·우체국·IBK·KB·신한·국민·우리·하나·수협·씨티·SC제일)이나 `계좌(번호)`(`입금계좌` 포함) 뒤 숫자 10~16자리(이어 쓰기 또는 묶음, 은행명까지 가린다). 날짜가 든 묶음(`우체국 2026-09-24 14시`)은 뺀다 |
| 고유식별번호 | `national_id` | `[고유식별번호]` | 주민등록·외국인등록 형식(생년월일 6자리 + 1~8 + 6자리. 구분자 없음·`-`·`.`·공백, 생년월일 사이 공백 `00 01 01-…` 허용), 운전면허 2-2-6-2, 여권 후보(영문 1자 + 8자리, 신형 3자리+영문+4자리) |
| 고객 식별자 | `customer_id` | `[고객식별자]` | 64자리 16진(`orderRefs` 형식) |
| 사람 이름 | — | `[담당자]` | 패턴이 아니라 필드 단위로 바꾼다(2.3) |

탐지기 우선순위: 해시 → 이메일 → 고유식별번호 → 전화 → 계좌 → 카드 → 주소. 앞선 탐지와 겹치는 뒤 탐지는 버린다(해시 속 숫자열, 이메일 속 번호, 주민등록번호 13자리가 카드로 두 번 세지지 않는다). 32자 이상 16진·UUID(커밋 SHA, 작업물 id) 안의 숫자열은 전화·카드 등으로 보지 않는다.

오탐 억제(테스트로 고정, 원문 그대로): 날짜(`2026-09-24`, `2026.09.24`, ISO 시각), 시각(`14:30`), 가격(`12,000원`), 버전(`2026-09-23.3`, `v2.3.1`), 퍼센트(`12.5%`), KPI 수치(`주문 120건`, `CTR 1.8%`, `ROAS 320%`, `첫 포장 주문 30건/주`), 수량 표현(`무료로 100개`, `추가로 2 종`, `재방문율로 20 이상`, `기준으로 3`, `기존대로 8,000자`, `계획대로 3.5%`, `예정대로 10`, `신메뉴로 1,200원`), 흔한 명사(`고객 행동 3`, `리뷰 관리 2`, `조리 5`), 노선·지점(`2호선`, `3호점`), 대표번호(`1588-0000`). 리뷰 지적(PR 68)으로 더한 것: 날짜 목록(`2026-09-24 2026-10-05`, `09-24 09-25 09-26`)·수치 나열(`120 135 150 180 210`, `1200 1350 1500 1800`)은 카드가 아니다. 몰 입점·가맹·발행·인허가 호수(`1층 C107호`, `B103호 팝업`, `3층 301호 팝업스토어`, `가맹 100호 매장`, `뉴스레터 102호`, `제2024-123호`)는 주소가 아니다. 채널 배분·나열(`인스타로 60 / 블로그로 40`, `배민으로 60, 쿠팡이츠로 30, 요기요로 10`, `피드 2, 스토리 3, 릴스 1`, `이메일로 3, 문자로 2`, `브리프대로 3, 가이드대로 2`), 채널 이름·가격 명사(`예산은 인스타로 60 배정`, `할인가로 9900`), 외래어 `…리`(`카테고리 1`, `배터리 5000`, `갤러리 3`), 비율(`곧바로 1:1`), 코스(`둘레길 3 코스`)는 주소가 아니다. 나열 판정: 부번·번지 없는 `X로 N`·`X동 N`의 앞이나 뒤에 `이름 + 숫자` 항목이 `,`·`/`·`|`·`-`(가운뎃점)로 이어지면 주소로 보지 않는다.

## 2. 제작 경로 변경

적용 위치: 역할 `lib/role-instruction.ts buildRoleInputMasked`(운영 `lib/role-execution.ts`와 서버 평가 `lib/eval-server.ts`가 같은 함수를 쓴다), 회의 `lib/meeting-execution.ts context`, 브리프 `lib/brief-execution.ts`. 공통 규칙은 `lib/ai-context.ts`에, 브랜드 단위 캠페인의 지점 허용 값 조회는 `lib/store-allow-server.ts`에 있다.

### 2.1 회의 작업물 허용 목록 (①, DP-1)

`originalArtifacts`와 품질 단계 `candidateArtifacts`는 코드 상수 `MEETING_ARTIFACT_FIELDS`로만 만든다. 레코드를 펼쳐 보내지 않는다.

| 보내는 필드 | 빼는 필드(예) |
|---|---|
| `ref`(계산), `id`, `role`, `title`, `content`, `version`, `status`, `createdAt`, `factsChanged`, `brandChanged`, `unverifiedClaims`, `qualityReview`, `excerpt`(계산). 후보 작업물은 `changes`(회의 개선본의 변경 위치)를 더한다 | `reviewNote`·`reviewedAt`·`reviewedVersion`(검토 메모), `origin`·`aiSource`·`aiSourceId`(사람 수정 표시), `editStats`(편집 통계), `complianceHold`(준수 보류), `promptVersion`·`promptFallback`·`promptRecheck`·`skillVersion`·`outputContractVersion`(실행 메타), `factRefs`, `outputSignal`·`outputTokens`, `meetingId`, `campaignId`·`campaignVersion`, 그 밖에 목록 밖의 모든 필드 |

본문 상한: `originalArtifacts`는 기존대로 8,000자. `candidateArtifacts`는 역할 경로 `upstreamContext`의 품질 담당 상한과 같은 24,000자이고 잘리면 `excerpt:true`다(회의 개선본 최대 30,000자, 수정되지 않은 스냅샷 작업물 최대 40,000자가 이제 상한을 받는다). 테스트: `tests/input-minimization.test.mjs`가 목록 밖 필드가 입력에 없는지, 상한과 `excerpt`를 확인한다.

### 2.2 브랜드 입력 허용 목록 (⑤)

`aiBrand`는 `identity`(name·short·category·color·tone·audience·constraints)와 `brandIntro`만 만든다. 의뢰 정보 `intake`(웹사이트·SNS·시장·의뢰 목적·경쟁사)는 제작 입력에서 뺐다. `brandIntro.text`(소개+메모)와 `identity.audience`·`identity.constraints`는 가린 뒤 보낸다(탐지 0이면 원문 그대로). 조사 경로의 브랜드 입력은 레인 B(#69, `researchBrand`), 학습 경로는 6절이다.

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
| 역할 | `brand.brandIntro.text`, `brand.identity.audience`·`constraints`, `evidence.directives[].text`, 후보·금지 사실 값 `evidence.facts.candidate[].value`·`prohibited[].value`, 점포 맥락의 지점 자유 텍스트 `brandArchive.storeMarketing.store`의 `name`·`customer`·`goal`·`daypart`·`menu`·`hours`·`access`·`capacity`·`economics`·`competitors`(주소 `address`는 허용 값이라 뺀다), `campaign.title`·`goal`·`audience`·`channels`·`stores`·`products`·`constraints`·`sources`·`plan.*`, 앞선 작업물 `previous[].title`·`content`(사람 수정본 포함), `previousDecisions.agenda`·`decisions`·`questions`, `revisionRequest.note`(검토 메모)·`previousExcerpt` |
| 회의 | `agenda`, 브랜드·상시 지시·후보·금지 사실·지점 자유 텍스트·캠페인(역할과 같음), `recordedMetrics[].notes`·`source`·`definition`·`scope`(비교 범위)·`period`(scope가 붙는 기간 표기), `previousMeeting.agenda`, 이전 회의 합의 `previousMeeting.decisions.decisions`·`questions`(역할의 `previousDecisions`와 같은 규칙), `originalArtifacts[]`·`completedRevisions[]`·`candidateArtifacts[]`의 `title`·`content`(개선본은 `completedRevisions`와 품질 단계 `candidateArtifacts` 두 곳으로 가므로 둘 다 가린다) |
| 브리프 | 브랜드·상시 지시·후보·금지 사실·지점 자유 텍스트(역할과 같음), `currentBrief`(캠페인 필드와 `plan.*`), `previousCampaigns[].title`·`goal`·`plan.*`, `recordedMetrics[]`(회의와 같음), `approvedLearnings[].title`·`content` |

허용 값(가리지 않음, `productionAllow`): (1) 그 캠페인 범위(브랜드·지점)의 확정 사실 값(`evidence.facts.confirmed[].value`). (2) 지점 레코드의 주소(`store.address`)와 연락 동선(`store.access`)에 적힌 유선·대표 번호(`storeAllowValues`). 휴대폰 대역·이메일과 주요 고객(`customer`)·비교 매장(`competitors`) 같은 다른 자유 텍스트의 값은 허용하지 않는다(사업장 휴대폰·이메일은 확정 사실로 등록한다). (3) 브랜드 단위 캠페인(지점 미지정)이면 그 브랜드 active 지점 전부의 (2) 값(`lib/store-allow-server.ts brandStoreAllow`, 보관 지점 제외). 지점 캠페인은 점포 맥락의 지점 값만 쓴다. 역할은 요청의 `storeAllow`(모델 입력에는 싣지 않음, 0건이면 키 없음), 회의는 단계 제출 때, 브리프는 제출 때 읽는다. 허용 값 안의 조각과 같은 탐지도 허용한다(1절).

가리지 않는 것: 확정 사실 값(`evidence.facts.confirmed`), 점포 맥락 중 지점 레코드 밖(채널 확인 근거·조사 초안·진단 관찰·실험·측정, 담당자 필드만 예외), 모델 출력(회의 발언·합의·개선 과제·개선본 변경 위치 `changes`, 이전 회의의 발언 `previousMeeting.discussion`과 품질 출력 `previousMeeting.quality` 포함. 이전 회의 합의 문장만 역할 경로와 맞춰 가린다), 학습 규칙(`learning`·`trialLearning`), 운영자 선호 규칙 블록(`operatorPreferences`, B3-1), 브랜드 자료 발췌(`brandArchive.confirmedSources`, 업로드 추출문은 레인 B).

### 2.5 가림 기록과 저장본 (DP-4)

| 경로 | 기록 위치 | 형태 |
|---|---|---|
| 역할 | `role_output_contract.inputMasking` | 실행마다 `[{field,kind,count}]`(0건이면 빈 배열). 허용 값이라 가리지 않고 보낸 탐지는 `{field,kind,count,allowed:true}`로 함께 남는다 |
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

합성 fixture에는 허용 목록 밖 개인정보 패턴이 없어 가림 차이는 0이다(fixture의 지점 주소 `가상동 12 B동 201호`·`가상동 12`는 확정 사실이라 허용 값이다). `docs/EVAL.ko.md`의 fixture 이름은 이 PR에서 `role-submission-9bdcfc8.json`으로 고쳤다. `docs/STATUS.md`의 옛 이름은 상태 문서 소유자(레인 B)가 갱신한다.

리뷰 반영(탐지기·가림 경로·허용 값 변경)은 두 fixture를 바꾸지 않았다. 합성 fixture 본문에 새 경로(후보·금지 사실, 지점 자유 텍스트, 성과 `scope`·`period`, `completedRevisions`)의 탐지가 없고, 줄어든 탐지(카드 묶음·호수·나열)도 원래 0건이었다. 그래서 재캡처 없이 `tests/prompt-baseline.test.mjs`·`tests/role-instruction.test.mjs`가 그대로 통과한다.

병렬 레인과 fixture: 테스트는 `prompt-baseline-*.json`이 정확히 1개일 것을 요구한다. 두 레인이 각자 재캡처하면 나중에 병합하는 쪽이 rename 충돌과 테스트 실패를 함께 겪는다. 나중에 병합하는 쪽은 최신 `main`으로 맞춘 뒤 먼저 병합된 fixture를 지우고 병합된 트리의 기준 커밋에서 다시 캡처한다(옛 fixture 이름 바꾸기 금지).

## 4. 검증 명령

| 명령 | 내용 |
|---|---|
| `node --experimental-vm-modules tests/pii-scan.test.mjs` | 탐지·가림·허용 목록·오탐 억제·`maskFields`·`failClosed`·`order-import` 상위 집합(순수, mocked) |
| `node --experimental-vm-modules tests/input-minimization.test.mjs` | 역할·회의·브리프 실행 경로(모의 HERMES, 메모리 SQLite, mocked) |
| `node scripts/test.mjs` | 전체 스위트(재캡처 스냅샷 포함) |

## 5. 알려진 한계

- 사람 이름·민감정보(건강·알레르기 등)는 자유 텍스트에서 패턴으로 잡지 않는다. 담당자 필드만 필드 단위로 바꾼다(DP-5 사람 확인 몫).
- 주소는 상세 부분(도로명+건물번호, 지번, 동·호수)만 가리고 시·구·동 이름은 남는다. 한 글자 도로명(`종로 1`), 번지 없는 주소, 영문 주소, 건물명만 적은 위치는 잡지 않는다. 흔한 명사·부사·채널 이름 목록 밖의 `…동 + 숫자`나 `…로/…길 + 숫자`(수량 단위·천 단위 쉼표·소수점·비율 없이 끝나는 경우)는 주소로 가려질 수 있다. 32자 이상 16진 토큰에 붙어 쓴 번호는 잡지 않는다.
- 단독 호수는 주거 건물 이름(아파트·빌라·오피스텔 등)이나 도로명·지번 바로 뒤에서만 잡는다. `고객 집 1203호`, 영문자가 붙은 호수(`C107호`)는 잡지 않는다. `…리 + 숫자`는 부번·`번지`나 읍·면 없이 쓰면 잡지 않는다(`가상리 55`). 부번·번지 없는 주소를 `,`·`/`로 나열하면(`가상로 12, 나상로 34`) 수치 나열로 보고 잡지 않는다.
- 대표번호(`1588-xxxx` 등 8자리)는 사업장 번호로 보고 잡지 않는다. 지역번호 없는 7~8자리 번호도 잡지 않는다. `+` 없는 `82`로 시작하는 숫자 묶음(`82 10 100 2000`)은 전화로 가려질 수 있다.
- 구분자 없는 13~19자리 숫자열은 모두 카드로 본다(Luhn 검사 없음, `CARD`와 같다). EAN-13 바코드·긴 주문번호도 `[결제정보]`로 가려진다. 13자리 바코드가 생년월일 형식이면 `[고유식별번호]`가 된다. 구분자가 있는 카드 묶음은 Luhn을 통과할 때만 카드라서, 4자리 수 넷을 한 칸씩 띄운 나열 중 Luhn을 통과하는 것(`1000 2000 3000 4000`)은 가려진다.
- 구분자가 있는 숫자는 `CARD`(숫자 사이 공백·하이픈 1개 아무 곳)보다 좁게 본다. 그래서 은행명·`계좌` 없이 적은 계좌번호 묶음(`000-000000-00-000`)은 카드 묶음 형식이 아니면 잡지 않는다(PR 68 첫 판에서는 카드 규칙이 대신 가렸다).
- 여권·운전면허·외국인등록 형식은 후보 패턴이다. 정확한 범위는 `docs/DATA-PROCESSING.ko.md` 6절 14번 법률 검토에서 정한다. 영문 1자 + 8자리 제품 코드는 여권으로 가려질 수 있다.
- 사용자가 브리프에 직접 적은 주소·전화가 확정 사실이나 지점 레코드에 없으면 가려져서, 브리프 사실 후보(`factCandidates`)로 제안되지 않는다(출처 확인은 원 입력으로 하므로 자리표시 값은 버려진다).
- 가리지 않는 입력(2.4 '가리지 않는 것')에 개인정보가 있으면 그대로 간다. 특히 학습 규칙 문구, 운영자 선호 규칙, 점포 맥락 자유 텍스트(채널 확인 근거·조사 초안·진단 관찰), 브랜드 자료 발췌다.
- 캠페인의 AI 초안 적용 기록(`draftMeta`: 제안 값·질문·가정)은 가림 경로에 넣지 않았다(모델이 만든 제안이다).
- 회의 발언·합의 같은 모델 출력은 가리지 않는다(이전 회의 합의 문장 `decisions`·`questions`만 예외로 가린다). 이 변경 이전에 가리지 않은 입력으로 만든 출력에는 개인정보가 섞여 있을 수 있다.
- 확정 사실 값은 종류를 가리지 않고 허용 값이다. 점주 개인 휴대폰을 확정 사실로 등록하면 모든 가림 경로에서 그 번호가 원문으로 간다. 설계 결정('확정 브랜드 사실 값')대로이며, 게시용 사실 키로 좁힐지는 후속 결정이다.
- 오탐 억제 목록의 단어 중 실제 법정동 이름과 겹치는 것(`연동`·`변동`·`작동`)은 그 동의 지번 주소(`제주시 연동 123-4`)를 잡지 못한다. 아파트 동·호 약식 표기(`101-1203`)도 잡지 않는다.
- 의도적으로 난독화한 값은 잡지 않는다: `[at]`·`(at)`·` at `·` @ ` 이메일, 한글 로컬부·IDN 도메인 이메일, 한글 숫자(`공일공-…`)로 쓴 전화·주민번호, 탐지 전 제거 목록 밖의 보이지 않는 문자를 끼운 값. DP-5 사람 확인 몫이다.
- 모델 지시문에는 `[전화번호]`·`[주소]` 같은 자리표시가 가린 값이라는 안내가 없다. 가린 입력으로 만든 산출물에 자리표시가 옮겨질 수 있다(실제 모델 동작은 `not_run`). 지시문 한 줄 추가는 지시문 해시와 스냅샷이 바뀌므로 후속 PR에서 재캡처와 함께 한다.
- 작업물 검토 이벤트(`app/api/action/route.ts`의 '수정 요청 · 메모')처럼 제작 경로 밖의 이벤트 문구는 이 변경의 범위가 아니다.
- 평가 케이스(`eval_case.request`)는 원 요청을 동결해 저장한다. 제출 때 `buildRoleInput`이 가리므로 평가 HERMES로는 가린 본문이 가지만, 저장된 동결 요청 자체는 원문이다. 브랜드 단위 캠페인이면 동결 요청에 지점 허용 값(`storeAllow`: 지점 주소·유선 번호)도 함께 저장된다.
- 허용 조각은 탐지 단위로 비교한다. 지점 주소의 `도로명+건물번호`가 허용 값이면 본문의 같은 `도로명+건물번호`는 어디에 적혀도 남는다(같은 건물의 다른 호수는 가린다). 역할 `inputHash`는 허용 값을 포함하지 않으므로, 지점 주소만 바뀌면 가림 결과가 달라도 같은 작업 id가 된다.

## 6. 학습 경로(후속 PR)

바이럴 학습 경로에도 4.4 ⑤·⑧을 적용한다. 레인 B #69가 조사 경로에 쓴 도우미(`lib/archive-research.ts`의 `researchBrand`·`authorPrivacy`)를 `lib/learning-execution.ts`에서 그대로 쓴다.

| 조치 | 바꾼 것 |
|---|---|
| ⑤ 브랜드 입력 | 학습 규칙 초안(L3 `start_guidance`)·바이럴 분석(L1 `start_analysis`)·바이럴 발견(L2 `start_discovery`) 제출의 `brand`를 `researchBrand(brand)`로 보낸다. 정체성 7필드(`name`·`short`·`category`·`color`·`tone`·`audience`·`constraints`)만 가고 공식 주소(`officialLinks`)는 없다. `id`·`bg`·`description`·`knowledge`·`intake` 전체가 빠진다. 입력 키 이름 `brand`와 과업 입력(실험·판정·결과, 사례·관찰, 조사 주제·요청 시각)은 그대로다 |
| ⑧ 작성자 식별정보 | 바이럴 발견(L2) 지시에만 넣는다. '개인의 민감한 정보를 수집하지 마세요.' 바로 뒤에 `authorPrivacy` 문장과 사례 게시 계정 한정 문장(`caseAccountRule`: '단, 사례 게시물을 올린 공개 계정 이름은 사례 식별용으로 cases의 account에만 적으세요. 댓글·리뷰 작성자와 게시물·영상에 등장하는 개인의 식별정보는 적지 마세요.')을 차례로 붙인다. 코드가 붙이는 지시에 있으므로 레지스트리 단위 `viral.discovery` 본문(코드 상수 `viralPractice`)은 바뀌지 않고, 레지스트리 버전을 활성화해도 문장이 빠지지 않는다. 사례 분석(L1)·규칙 초안(L3) 지시에는 넣지 않는다. 병합된 계획(4.4 ⑧)대로 L2만이다. L1은 제공된 사례·관찰만 읽고 L3은 실험 결과만 읽어 외부 콘텐츠를 수집하지 않는다. 그래서 분석 지시문은 이 변경 전과 바이트 동일하다 |

- ⑧ 해석(대표 확인 필요): `authorPrivacy`는 '게시물 작성자'의 계정도 기록하지 말라고 하고, 예외는 브랜드·경쟁사 공식 계정뿐이다. 그런데 발견 지시는 사례마다 `account`를 채우게 하고(스키마 `cases[].account`) oEmbed로 계정을 대조하게 한다. 바이럴 사례의 게시자는 대부분 일반 크리에이터라 예외에 들지 않는다. 문장만 넣으면 모델은 `account`를 비우거나(사례 식별과 `baselineViews` 비교 근거가 약해진다) ⑧을 어긴다. 대표가 승인한 ⑧ 조치 문구(4.4 8번)는 '리뷰·댓글 작성자'다. 그래서 사례 게시물을 올린 공개 계정은 관찰 대상으로 보고 `account`에만 적게 했다. 댓글·리뷰 작성자와 게시물·영상 속 개인은 계속 뺀다. 게시 계정도 적지 않기로 하면(엄격안) 발견 스키마의 `account`와 oEmbed '계정 대조' 문구도 함께 고친다. `makeCase`는 `account`를 선택값으로 받으므로 저장은 그대로 된다.
- 가리지 않는다: 제작 경로(2.2)와 달리 `audience`·`constraints`는 조사 경로처럼 원문으로 간다. 바이럴 사례의 계정명·자막·관찰, 조사 주제, 실험 조건·결과 메모도 가리지 않는다.
- 저장 기록은 그대로다. 브랜드 레코드는 소개·메모·의뢰 정보를 유지하고 모델 입력에서만 뺀다. 저장한 제출 원문이 전송본이고 복구(`recover`)도 그것을 다시 보내므로, 이 변경 전에 저장한 제출은 복구 때 이전 본문으로 간다.
- 테스트: `tests/learning-input-minimization.test.mjs`(모의 HERMES, 메모리 SQLite, mocked).

스냅샷: 학습 경로 제출 바이트가 의도적으로 바뀐다. `prompt-baseline`의 학습 항목 가운데 바이럴 분석 입력과 바이럴 발견 지시문이 달라지므로 fixture를 재캡처한다. `tests/prompt-resolution.test.mjs`(75·132행)도 같은 fixture의 `learning[1]`(발견 지시문)과 비교하므로, 재캡처 하나로 두 스위트가 함께 맞춰진다. 절차는 3절과 같다. 코드 변경을 커밋한 뒤 그 커밋 SHA로 캡처한다. 옛 `tests/fixtures/prompt-baseline-9bdcfc8.json`은 `git rm`으로 지운다(이름 바꾸기 금지. 테스트는 fixture가 정확히 1개일 것을 요구한다).

- `tests/fixtures/prompt-baseline-<재캡처 SHA>.json`(환경변수에는 40자, 파일 이름에는 앞 7자. 코드 커밋 뒤 채운다): `PROMPT_BASELINE_SHA=<재캡처 SHA> PROMPT_BASELINE_CAPTURE=tests/fixtures/prompt-baseline-<재캡처 SHA>.json node --experimental-vm-modules tests/prompt-baseline.test.mjs`
- 역할 8종·회의 12단계 ×2 항목은 바뀌지 않아야 한다. 역할·회의·브리프·조사 제출 바이트는 이 변경의 범위 밖이다.
- 역할 제출 스냅샷 `tests/fixtures/role-submission-9bdcfc8.json`(역할 16케이스, 이전 회의 합의 입력 포함)은 학습 경로를 지나지 않으므로 바뀌지 않는다. 재캡처하지 않는다.

변경 전후 차이(옛 fixture `9bdcfc8`과 비교. 이 작업 트리를 스크래치 경로로 캡처했다. 외부 호출 0회, 합성 데이터):

| 스냅샷 | 역할 8종 | 회의 12단계 ×2 | 바이럴 분석(L1) | 바이럴 발견(L2) 지시문 |
|---|---|---|---|---|
| prompt-baseline | 8/8 동일(`inputHash`·지시문·입력) | 24/24 동일(지시문·입력) | 지시문 동일(1,035자). 입력 변경 627→543자(`brand`에서 `id`·`bg`·`description`·`knowledge`가 빠짐) | 변경 1,655→1,832자(`authorPrivacy`·`caseAccountRule` 추가, sha256 `b691d1e0…`) |

`providerCalls.external`(0)도 같다. 옛 fixture를 지운 스크래치 사본에서 재캡처하면 `tests/prompt-baseline.test.mjs`(83)와 `tests/prompt-resolution.test.mjs`(50)가 모두 통과한다.
