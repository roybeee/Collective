# AI 심사 루브릭·보정 (J1)

비유: 새 심사위원에게 먼저 대표와 같은 답안지를 채점시켜 보고, 눈높이가 맞는 과목만 맡긴다. 맡긴 과목에서도 심사위원은 불합격만 줄 수 있고 합격 도장은 찍지 못한다.

결론: 결정론 채점기가 못 보는 판단 품질 7기준을 1~5점 루브릭으로 정의한다. 대표 라벨과 비교해 채택 조건을 모두 넘은 기준만 '채택'하고, 채택 전 점수는 '참고'로만 보이며 게이트에 쓰지 않는다. J1은 루브릭·심사 프롬프트 빌더·응답 파서·보정 통계·채택 판정만 둔 순수 함수다. 모델·HERMES·네트워크를 호출하지 않고 저장소·API도 바꾸지 않는다.

| 층 | 파일 |
|---|---|
| 루브릭·프롬프트 빌더·응답 파서 | `lib/judge-rubric.ts` `JUDGE_CRITERIA`·`applicableCriteria`·`judgeInstructions`·`buildJudgePrompt`·`parseJudgeResponse` |
| 보정 통계·채택 판정 | `lib/judge-kappa.ts` `weightedKappa`·`spearman`·`bootstrapKappaLower`·`criterionStats`·`adoptCriterion` |
| 테스트 | `tests/judge-rubric.test.mjs`·`tests/judge-kappa.test.mjs`(합성 데이터, 네트워크 호출 0) |
| 순서·승인 | [품질 계획 v2 로드맵](QUALITY-ROADMAP.ko.md) J1~J4, R4·R5 |

루브릭·앵커·상수의 정본은 코드다. 이 문서는 요약이고, 코드와 다르면 코드가 맞다.

## 목적

[평가 하네스](EVAL.ko.md)의 결정론 채점기는 형식·금지 표현·사실 대조처럼 누구나 같은 답을 내는 항목만 본다. 설득력이나 전략 타당성처럼 판단이 필요한 품질은 [결정론 불가 유형](EVAL.ko.md#결정론-불가-유형-v1-채점기-제외-정의만)으로 남아 있다. AI 심사는 이 빈칸을 평가 전용 HERMES로 채점하되, 사람 라벨로 보정한 기준만 쓴다(성장 계획 설계 원칙 2).

- 심사는 막기만 한다. 채택된 기준도 회귀를 막는 데만 쓰고 합격을 주지 않는다(성장 계획 설계 원칙 6).
- 심사 대상은 완료된 평가 출력(`eval_output`)이다. 운영 작업물 전수 심사는 하지 않는다.

## 루브릭 `judge-rubric-v1`

v1은 역할 산출물(kind `role`)만 심사한다. quality 역할은 B1 κ가 이미 보정하므로 빼고, 회의 동조(`meeting_conformity`)와 회의·브리프 kind는 다음 루브릭 버전에서 다룬다. 2점·4점 앵커는 코드에 있다.

| 기준 | 이름 | 1점 | 3점 | 5점 | 적용 역할 | v1 채택 대상 |
|---|---|---|---|---|---|---|
| `evidence_linkage` | 근거 연결 | 근거가 결론을 지지하지 않음 | 일부 비약 | 핵심 주장마다 근거 또는 미확인 표시 | quality 외 7역할 | 예 |
| `actionability` | 실행 가능성 | 방향만 있음 | 담당·일정·규격 중 일부가 빠짐 | 추가 질문 없이 착수 가능(중단 조건 포함) | cmo·creative·content·growth·data | 예 |
| `causal_overreach` | 인과 절제 | "최대 병목은 X"처럼 근거 없이 단정 | 가설과 단정이 섞임 | 원인 주장마다 근거나 검증 계획 | insight·strategy·cmo·growth·data | 예 |
| `strategic_validity` | 전략 타당성 | 목표와 무관한 채널·지표 | 연결은 있으나 대안·제외 이유 없음 | 선택·제외·우선순위를 제약으로 설명 | cmo·strategy·growth·creative | 아니오(참고) |
| `persuasion` | 설득력 | 이유 없는 주장 | 이점은 있으나 타깃 장벽과 무관 | 장벽→이점→행동이 이어짐 | strategy·creative·content | 아니오(참고) |
| `generic_positioning` | 브랜드 차별화 | 경쟁사 이름을 넣어도 성립 | 톤은 맞으나 차별 근거 약함 | 브랜드 고유 자산·제약에 묶임 | strategy·creative·content | 아니오(참고) |
| `concept_diversity` | 콘셉트 다양성 | 같은 원리의 표현만 바꿈 | 두 안만 원리가 다름 | 세 안의 설득 원리가 모두 다름 | creative·content | 아니오(참고) |

- 모든 기준은 점수가 높을수록 좋다. `causal_overreach`는 절제할수록, `generic_positioning`은 차별될수록 높다.
- 채택 대상은 표본이 30건을 넘는 3기준뿐이다. 나머지 4기준은 7개 캠페인 역할 출력을 다 모아도 30건에 닿지 않아(설득력 21, 전략 타당성 28, 브랜드 차별화 21, 콘셉트 다양성 14) v1 동안 참고로만 쓴다.
- 적용 역할 밖의 기준에 점수를 내면 무효다(아래 파서).

## 심사 입력

`buildJudgePrompt(request, {denyTerms})`가 지시문(`instructions`)과 입력(`input`, JSON 문자열)을 만든다. 심사 실행(J3)은 이 둘을 그대로 보내고, 함께 돌려받은 `sent`(역할과 실제로 보낸 가림본)를 파서에 넘긴다.

| 입력 필드 | 내용(허용 목록 투영) | 가림 |
|---|---|---|
| `task` | kind, 역할 id·이름·deliverable | 없음 |
| `output` | 심사할 산출물의 정규화 렌더본(`bodyOf`) | 운영 역할 입력과 같은 개인정보 가림 |
| `brief` | 브리프 요약(설계 2절): `goal`(목표)·`audience`(타깃)·`kpi`·`channels`·`constraints`(금지 표현, 브리프 constraints 원문. 골든 라벨의 `prohibitedTerms`가 아니다)·`budgetConfirmed`(예산 확정 여부, 모르면 `null`). 없는 값은 빈 문자열 | 자유 텍스트 5개를 운영 캠페인 필드처럼 가림 |
| `facts.confirmed` | 확정 사실. 운영 `confirmedItem`과 같은 `key`·`value`·`source`·`verifiedAt`·`validUntil`·`scope`만 | 운영과 같이 가리지 않음(값은 허용 값) |
| `facts.rejected` | 거절된 사실. 운영 `prohibitedItem`의 `key`·`value`·`scope`만 | 값은 운영과 같이 가림 |
| `brand` | 브랜드 요약(`aiBrand` 모양): `identity`의 정체성 7필드(`name`·`short`·`category`·`color`·`tone`·`audience`·`constraints`)와 `brandIntro.text`. `verification`은 늘 `unverified`, `useInCopy`는 늘 `false` | 소개문·audience·constraints 가림 |
| `upstream` | 상류 작업물 발췌 | 먼저 가린 뒤 8,000자로 자름 |

- 가림은 `lib/pii-scan.ts` `maskFields`로 운영과 같게 한다. 허용 값은 확정 사실 값과 요청의 `allow`(지점 주소 등)다.
- 상류 발췌는 가림을 먼저 하고 자른다. 자른 뒤 가리면 경계에 걸친 전화번호·이메일 조각이 탐지되지 않고 나간다.
- `brand`·`brief`·사실은 허용 목록 모양으로 다시 만든 새 객체만 보낸다. 모양 밖 키(예: `brand.intake`·`brand.id`·`brand.knowledge`, 사실의 `note`)는 거부하고, 값이 문자열이 아니면(가림은 문자열만 본다) `bad_request`다. J3는 `Brand` 원본이 아니라 `aiBrand(brand)`를 넘긴다.
- 브리프 요약은 설계 2절을 따른다. 계획 J3 줄의 '브리프 constraints 원문'은 금지 표현의 출처(골든 라벨이 아니라 constraints 원문)를 정한 것이고, 근거 연결·전략 타당성·설득력이 기대는 목표·타깃·KPI를 빼라는 뜻이 아니다. 모두 E1로 이미 보낸 캠페인 필드의 부분집합이다.
- 요청이 아래에 걸리면 422 `JudgePromptError`로 거부하고 프롬프트를 만들지 않는다. 오류 문구에는 필드 경로만 싣고 값은 싣지 않는다.

| 코드 | 조건 |
|---|---|
| `forbidden_field` | 허용 키(`kind`·`role`·`renderedOutput`·`brief`·`confirmedFacts`·`rejectedFacts`·`brand`·`upstreamExcerpt`·`allow`) 밖의 최상위 키. `brief`·`brand`·사실의 허용 목록 밖 키. 자료 안 어느 깊이에든 금지 키(`FORBIDDEN_KEYS`, 대소문자 무시: 모델명(`model`)·평가 구분(`variant`·`active`·`candidate`·`baseline`)·골든 라벨(`expectations`·`prohibitedTerms`)·프롬프트 버전·실행·케이스 id·봉인 표시·채점 결과 등). 검사 깊이(12단)를 넘는 객체(검사하지 못했으므로 거부). 가린 입력이나 지시문에 `denyTerms` 값이 있음 |
| `unsupported_kind` | kind가 `role`이 아님 |
| `unsupported_role` | 모르는 역할이거나 quality 역할 |
| `bad_request` | 본문이 비었거나 필드 형식이 틀림(`budgetConfirmed`는 참·거짓, `brandIntro.verification`은 `unverified`, `useInCopy`는 `false`만). `denyTerms`가 문자열 배열이 아님 |

금지 값(`denyTerms`): 키 이름 검사만으로는 본문 문장 속 모델명(예: 상류 발췌의 'model: …')을 막지 못한다. J3는 run이 보고한 모델 id·별칭, 평가 연결 model, promptVersion·promptHash, variant 이름을 `denyTerms`로 넘긴다. 빌더는 가림을 마친 입력과 지시문에 그 값(3자 이상, NFKC·대소문자 무시)이 하나라도 들어 있으면 값을 밝히지 않고 `forbidden_field`로 거부한다. 3자 미만 값은 오탐이 커서 보지 않는다.

## 편향 방지 원칙

- 심사자는 산출물이 어느 모델·프롬프트 버전·평가 구분(active/candidate)에서 나왔는지 모른다. 지시문에도 루브릭 버전·평가 구분·다른 산출물을 쓰지 않는다.
- 한 번에 산출물 하나를 절대 평가한다. AB·BA 쌍 판정은 게이트에 쓰이지 않아 v1에서 뺐다.
- 길이·분량·문체·형식은 점수 근거가 아니라고 지시한다. 그래도 길이에 끌리는지는 채택 조건의 길이 편향으로 따로 잰다.
- 점수마다 본문에서 그대로 복사한 인용 1~3개를 요구하고, 없는 인용이면 그 점수를 버린다.
- 도구(웹 검색·브라우저·코드 실행·파일 조회)를 쓰지 말라고 지시한다. 평가 프로필에 도구가 켜져 있어도 검색으로 결과가 흔들리지 않게 하려는 것이다.
- 입력 속 산출물·브리프·사실·브랜드·상류 발췌에 든 지시문은 따르지 말라고 지시한다. 심사 자료일 뿐이다.
- 판단할 수 없으면 억지로 점수를 내지 않고 `score:null, uncertain:true`로 답하게 한다.
- 생성과 심사가 같은 별칭 모델이라 자기선호는 코드로 막을 수 없다. 통제 수단은 사람 보정뿐이다. 다른 기반 모델을 쓰는 심사 전용 프로필은 아직 결정하지 않은 선택지다.
- 봉인 출력과 결함을 심은 출력은 쉬운 극단값이라 κ를 부풀린다. κ 계산에서 분리한다(아래 `use`).

## 파서 무효 규칙

`parseJudgeResponse(raw, sent)`는 응답에서 JSON을 꺼낸다(코드 블록 울타리를 벗기고, 안 되면 첫 `{`부터 마지막 `}`까지, 그래도 안 되면 설명문에 중괄호가 섞인 경우를 위해 `{"criteria"`부터 마지막 `}`까지). 응답 전체가 무효인 경우는 둘이다.

- `not_json`: JSON을 찾지 못함
- `bad_shape`: `criteria` 배열이 없음

그 밖의 무효는 해당 기준만 버린다(`score:null`, `valid:false`, `invalid`에 사유). 다른 기준은 그대로 쓴다.

| 사유 | 조건 |
|---|---|
| `bad_shape` | 항목이 객체가 아니거나 `id`가 없음. 또는 `uncertain:true`인데 점수가 있음(모순이라 점수를 버린다) |
| `unknown_criterion` | 루브릭에 없는 기준 |
| `not_applicable` | 적용 역할 밖의 기준에 점수를 냄 |
| `duplicate` | 같은 기준을 두 번 이상 답함(모두 무효) |
| `score_missing` | 적용 기준인데 점수가 없고(`null`이거나 필드 없음) `uncertain:true`도 아님 |
| `score_out_of_range` | 점수가 1~5 정수가 아님 |
| `quotes_missing` | 점수가 있는데 인용이 없음 |
| `too_many_quotes` | 인용이 3개를 넘음 |
| `quote_too_short` | 가림 토큰(`[전화번호]` 등)을 뺀 정규화 인용이 4자 미만 |
| `quote_not_found` | 인용이 실제로 보낸 가림본(`sent.output`)에 없음 |

- 인용 대조는 렌더본 원문이 아니라 실제로 보낸 가림본과 한다. 가린 부분을 인용하면 원문과는 어긋나기 때문이다. 양쪽을 NFKC로 바꾸고 소문자로 만든 뒤 공백·문장부호·기호(마크다운 강조·대시 포함)를 지우고 비교한다(`quoteKey`).
- 수치 인용은 뜻이 바뀌지 않게 대조한다. 천 단위 쉼표는 무시하지만(`5,000원` = `5000원`), 숫자 안의 구분 한 글자(`.` `,` `:` `/`)는 숫자의 일부로 남긴다(`1.5배` ≠ `15배`). 그 밖에 숫자 사이에 낀 공백·기호(`50%. 10`, `11:00~14:00`의 `~`)는 두 숫자를 가르는 경계로 남겨 숫자가 붙지 않게 한다. 인용이 숫자로 시작하거나 끝나면 본문의 앞·뒤 글자가 숫자(또는 숫자 안의 구분)가 아닐 때만 일치로 본다('할인율은 5'는 '할인율은 50%'에, '5배'는 '15배'에 맞지 않는다).
- `score:null, uncertain:true`는 유효한 답이다(인용 불필요). 보정 통계에서는 판정 불가로 센다.
- 적용 기준 중 답이 없는 것은 `missing`으로 돌려준다.
- 돌려주는 `quotes`는 대조를 통과한 인용뿐이다(무효·판정 불가 답에서도 지어낸 인용은 버린다). 인용은 3개, 하나당 300자(`QUOTE_MAX_CHARS`)까지 남긴다. `reason`은 300자에서 자른다.
- `reason`은 모델이 쓴 자유 텍스트라 가리지 않은 값이 섞일 수 있다. J3는 `judge_output`에 저장하기 전에 `reason`에 `maskText`를 적용한다(J3 수용 조건).

## 보정 통계

`criterionStats(criterion, items)`가 기준 하나의 통계를 낸다. 항목마다 사람 점수(`human`, 1~5 또는 해당없음 null), 파서가 유효로 받은 심사 점수(`judge`, 무효·누락은 null), `uncertain`, 파서 무효 사유(`invalid`, 선택), 보낸 산출물 글자 수(`length`), 용도(`use`)를 넣는다.

- `use`: `measure`(기본)만 κ에 쓴다. `anchor`(앵커 맞춤), `sealed`(봉인 출력), `seeded`(결함 심은 출력), `relabel`(자기 일치도용 재라벨)은 `excluded`로만 센다.
- `invalid`: 파서가 돌려준 사유 배열을 그대로 넣는다. 무효 답이므로 `judge`는 null이어야 한다(점수가 있으면 422).
- 인용 무효(`quoteInvalid`·`quoteInvalidRate`): 사람이 점수를 매긴 항목 중 인용 사유(`quotes_missing`·`too_many_quotes`·`quote_too_short`·`quote_not_found`)로 무효가 된 답의 건수와 비율이다. 적용표 밖 점수·누락과 섞지 않고 따로 본다(교차 검토 3-6).
- 대응 쌍: 사람 점수가 있고, 심사 점수가 유효하며, uncertain이 아닌 항목이다.
- 가중 κ(`weightedKappa`): 점수 1~5의 이차 가중 κ. 두 쪽이 같은 한 점수뿐이면 정의할 수 없어 null이다.
- 부트스트랩 하한(`bootstrapKappaLower`): 대응 쌍을 2,000번 복원 추출해 κ를 다시 재고 양측 95% 구간의 하한(2.5% 분위)을 낸다. 시드를 고정해 같은 입력이면 같은 값이다.
- Spearman ρ, 이진화(4점 이상) κ(`cohenKappa`)는 보조 값이다.
- uncertain 비율: 사람이 점수를 매긴 항목 중 심사가 쓸 수 있는 점수를 내지 못한 비율이다. uncertain뿐 아니라 무효·누락도 포함한다.
- 양극 점수: 대응 쌍에서 사람 점수 1~2점 건수와 4~5점 건수다.
- 길이 편향: ρ(심사 점수, 글자 수) − ρ(사람 점수, 글자 수). 심사가 사람보다 길이에 더 끌려가는 정도다.
- 입력이 틀리면(1~5 정수가 아닌 점수, 음수 글자 수, 모르는 기준·용도 등) 422 `JudgeStatsError`로 거부하고 통계를 내지 않는다.

## 사람 보정 절차

라벨은 대표가 단독으로 매긴다(2026-09-24 '판정 라벨링 …' → '오케이', [로드맵](QUALITY-ROADMAP.ko.md#대표-승인-기록)).

| 묶음 | 건수 | 용도 | κ 계산 |
|---|---|---|---|
| 측정 | 42건 | 채택 판정 | 포함(`measure`) |
| 앵커 맞춤 | 10건 | A/A 출력으로 대표와 앵커 해석을 맞춘다 | 제외(`anchor`) |
| 재라벨 | 10건 | 2주 뒤 같은 출력을 다시 라벨해 대표 자기 일치도를 본다 | 제외(`relabel`). 채택 조건이 아니다 |

- 일정: 주 20건(약 1.7시간)씩 3주에 나눈다(성장 계획 설계 원칙 11, 운영 주 3시간).
- 채택 대상별 측정 표본: `evidence_linkage` 42건, `actionability` 30건, `causal_overreach` 30건. 표본 조건은 이 라벨 수로 본다(아래 채택 조건). 대표가 `actionability`·`causal_overreach`에 '해당없음'을 주면 30건 아래로 내려가므로 그만큼 측정 라벨을 더한다.
- 자기 일치도: 재라벨 항목은 `use:'relabel'`로 넣어 κ 쌍에서 뺀다. 자기 일치도는 같은 출력의 `{human: 첫 라벨, judge: 재라벨}` 쌍을 `weightedKappa`에 넣어 잰다.
- 방식(J2): 같은 렌더본에 같은 루브릭으로 1~5점 또는 해당없음을 매긴다. 라벨은 새 kind `judge_label`(parent `eval_run`)에 `/api/eval` 소유자 액션으로 저장한다. 사람 판정 로그(`review_decision`)는 쓰지 않는다.
- 블라인드: 표시 id와 순서는 무작위이고 run id·variant를 보이지 않는다. 라벨을 저장하기 전에는 심사 점수를 숨긴다. 심사는 라벨을 저장한 출력만 한다(R4).
- 봉인 출력은 보정 라벨에 쓰지 않는다.
- 관리자 이중 라벨(사람끼리 일치도)은 관리자 권한 확대를 결정한 뒤 20건 이상으로 한다. 그 전까지는 하지 않는다.

### 라벨 화면·API (J2)

- 화면: 품질 콘솔의 'AI 심사 보정 라벨'(소유자만, 관리자·직원에게는 안내 문구만 보인다). '라벨 불러오기'로 대기열을 받아 한 항목씩 렌더본과 적용 기준(정의·1~5점 앵커)을 보고 기준마다 1~5 또는 해당없음을 고른다. 모두 고르면 저장할 수 있다. 용도는 측정(`measure`, 기본)과 앵커 맞춤(`anchor`)을 고르고 메모(500자)를 붙일 수 있다. 화면은 응답에서 허용한 필드(표시 id·역할 이름·적용 기준·렌더본)만 읽는다.
- 대상(`lib/judge-labels-server.ts`): 삭제하지 않고 끝난 active run의 `completed` 결과 중 역할 kind, dev 세트, 적용 기준이 있는 역할(품질 검수 제외)이다. 봉인 세트·pair run·삭제한 run의 출력은 나오지 않는다.
- 블라인드: 표시 id는 `L` + SHA-256(run·케이스·쪽)의 앞 10자이고, 대기열은 표시 id 순서다(실행·케이스 생성 순서와 무관). 응답에는 run·케이스 id, variant, 모델, 케이스 이름, 채점 결과, 기대 판정이 없다. 심사 점수(J3)는 라벨을 저장하기 전에는 보내지 않는다.
- API(소유자 전용 `/api/eval`, 관리자·직원 403, 비로그인 401):
  - `GET ?labels=queue[&limit=N]`: 라벨이 없는 항목을 표시 id 순으로 N개(기본 10, 최대 50). 루브릭(7기준·앵커)과 건수(`items`·`labeled`·용도별)를 함께 준다.
  - `GET ?labels=item&id=<표시 id>`: 그 항목과 저장된 라벨(재라벨·수정용). 없으면 404.
  - `POST {action:'save_label', itemId, scores, use?, note?}`: 적용 기준마다 1~5 정수 또는 `'na'`를 빠짐없이 준다(빠지거나 적용 밖 기준·범위 밖 점수는 400). `measure`·`anchor`는 항목당 1행(다시 저장하면 바꾼다), `relabel`은 첫 라벨이 있어야 하고(없으면 409) 따로 1행이다. 모델 출력이 없으면 409.
- 저장(`judge_label`, 부모 `eval_run`): 기준별 점수(해당없음은 null), 용도, 루브릭 버전, 렌더본 SHA-256(`outputHash`, J3가 본문이 바뀌었는지 본다), run·케이스·쪽(서버에만), 라벨한 사람·시각, 메모. 라벨이 있는 run은 `delete_run`이 409다.
- 테스트: `tests/judge-labels.test.mjs`(대상 선별·블라인드·순서·limit, 저장 검증 400·404·409, 용도 전환·재라벨, 삭제 거부, 관리자·직원 403·비로그인 401. 합성 데이터, 평가 HERMES fetch 스텁, `mocked`), `e2e/judge-labels.spec.ts`(화면 여정. 대기열·저장 API는 모의하고, 모의 응답에 섞은 run·케이스 id·variant·모델이 화면과 저장 요청에 나오지 않는지 본다, `mocked`).

## 채택 조건

`adoptCriterion(stats)`는 아래를 모두 충족하면 `adopted`, 하나라도 못 채우면 `reference`와 못 채운 사유 전부를 돌려준다. 표본·κ·하한·uncertain·양극은 경계값이면 충족이고, 길이 편향은 0.2이면 미충족이다. 계산할 수 없는 값(null)은 미충족이다. 결과는 입력 통계의 `rubricVersion`을 그대로 싣는다.

채택은 게이트를 켜는 결정이고 J4·R5는 저장된 통계로 이 함수를 부른다. 그래서 입력 형식이 틀리면(필드 누락, NaN, 문자열, `pairs`가 `labelled`보다 큼, 양극 합이 `pairs`보다 큼) 채택도 참고도 아닌 422 `JudgeStatsError`로 거부한다.

| 조건 | 기준 | 사유 코드 |
|---|---|---|
| 채택 대상 | `evidence_linkage`·`actionability`·`causal_overreach` | `not_target` |
| 루브릭 버전 | 통계의 `rubricVersion`이 현재 버전(`judge-rubric-v1`)과 같음 | `rubric_version` |
| 표본 | 사람이 점수를 매긴 측정 항목(`labelled`) 30건 이상. κ·하한·양극은 대응 쌍으로 재고, uncertain·무효로 줄어드는 쌍은 아래 판정 불가 상한이 막는다 | `small_sample` |
| 일치도 | 가중 κ 0.6 이상 | `kappa` |
| 불확실성 | 부트스트랩 κ 하한 0.4 이상 | `kappa_lower` |
| 판정 불가 | uncertain 비율(무효·누락 포함) 20% 이하 | `uncertain` |
| 양극 점수 | 사람 점수 1~2점, 4~5점 각 3건 이상 | `polar` |
| 길이 편향 | 0.2 미만(사람보다 0.2 이상 길이에 끌리지 않음) | `length_bias` |

## 채택 전과 후

- 채택 전(`reference`): 점수는 '참고'로만 보인다. 게이트·판정·승인에 쓰지 않는다. 참고 4기준은 v1 동안 늘 이 상태다.
- 채택 후(`adopted`, J4): 채택된 기준만 쌍 평가 게이트의 `judge_regression`으로 막는다. 임계값은 A/A 잡음의 95% 분위로 정하고, 2점 하락은 재심사 1회로 확인한 뒤 막는다. 심사 점수로 통과시키지는 않는다.
- 인용과 판정 이유는 `judge_output`에만 두고 run 결과와 목록 조회에는 점수만 둔다(J3). 콘솔·다이제스트에도 인용 원문을 넣지 않는다.

## 재보정

- 채택 기록에는 보정 당시 `rubricVersion`과 평가 게이트웨이 해시를 남긴다. 심사 run의 게이트웨이 해시가 다르면 자동으로 '재보정 필요'로 강등한다(J4). 결정 10의 모델 변경 경보는 운영 게이트웨이 스냅샷에서만 생기고, 평가 연결은 해시를 기록만 하며 HERMES가 별칭만 보고하기 때문이다.
- 루브릭 버전(`judge-rubric-v1`)이 바뀌면 이전 채택은 새 버전에 이어지지 않는다. 통계·채택 결과가 모두 `rubricVersion`을 싣고, 다른 버전의 통계를 판정하면 `rubric_version`으로 참고에 머문다.
- 주기 재측정(설계 3절): 채택된 기준은 4주마다 새 측정 라벨 10건을 더해 κ를 다시 잰다. 조건을 못 채우면 참고로 강등한다. 이 10건(약 50분)은 대표 운영 시간(주 3시간) 안에 넣는다. 게이트웨이 해시 변화만으로는 같은 해시 안의 드리프트(입력 분포 변화 등)를 잡지 못하기 때문이다.
- 강등된 기준은 다시 보정해 채택 조건을 채우기 전까지 게이트에 쓰지 않는다.

## 데이터 처리 경계

- J1은 아무것도 보내지 않는다.
- 골든 라벨(`expectations`·`prohibitedTerms`)과 모델·평가 구분 정보는 심사 입력에 들어갈 수 없다(위 `forbidden_field`).
- J3가 평가 출력을 평가 HERMES로 다시 보내는 것은 [데이터 처리](DATA-PROCESSING.ko.md) E1 행에 아직 없는 전송이다. J3 전에 E1 행을 넓혀야 한다([로드맵](QUALITY-ROADMAP.ko.md#아직-결정하지-않은-것)).
