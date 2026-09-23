# 평가 하네스 (F1a) · 실패 유형 사전 v1 · 규제 가드레일 (A2)

결론: 역할·회의 산출물을 네트워크 없이 다시 채점하는 결정론 채점기 12종과 규제 표시 가드레일 8범주를 순수 함수로 둔다. 프롬프트·모델·입력을 바꾼 뒤 결과가 나빠지지 않았는지를 사람의 인상 대신 같은 저울로 잰다.

비유: 요리 대회에서 맛 평가는 심사위원이 하지만, "재료를 빼먹었는가", "금지 재료를 썼는가"는 체크리스트로 누구나 같은 답을 낸다. 이 문서의 채점기는 그 체크리스트다. 맛(설득력·창의성)은 판정하지 않는다.

- 코드: `lib/graders/*.ts`(상대 import만 쓰는 순수 함수), `lib/role-instruction.ts`, `scripts/eval/grade.mjs`
- 테스트: `tests/graders.test.mjs`, `tests/compliance.test.mjs`, `tests/role-instruction.test.mjs`(모두 합성 데이터, `passed · mocked`)
- 이 단계(F1a)는 새 파일만 더한다. 런타임 연결(`lib/role-execution.ts`가 `lib/role-instruction.ts`를 쓰도록 바꾸기, 서버 평가 실행 `eval_run`, 가드레일의 `complianceIssues` 저장)은 F1b·A2 연결 PR이 맡는다.
- 이 문서와 채점 결과는 법률 자문이 아니다(아래 [고지](#법률-자문-아님-고지)).

## 상태 어휘

보고는 `AGENTS.md` 상태 어휘를 따른다. 검사 결과는 `passed | failed | blocked | not_run`, 근거는 `real | mocked`다. 로컬 재채점은 저장된 원문을 다시 읽을 뿐 HERMES를 부르지 않으므로 `mocked`다.

채점기 한 개의 결과는 네 가지 중 하나다.

| 결과 | 뜻 |
|---|---|
| `pass` | 규칙을 적용했고 위반이 없다 |
| `fail` | 규칙을 적용했고 위반이 있다 |
| `not_applicable` | 이 산출물에는 규칙을 적용하지 않는다. 합격률 분모에서 뺀다 |
| `grader_error` | 채점기 코드가 예외를 냈다. 이 채점기만 격리하고 나머지 결과는 유지한다 |

원문이 로컬에 없어 채점하지 못한 산출물은 결과 대신 케이스의 `notRun`에 이유와 함께 적는다.

공통 규칙:
- 입력(브리프 목표·회의 안건)은 채점하지 않는다. 금지 표현의 출처로만 쓴다.
- 우선순위: `question_only`가 `fail`이면 내용 채점기 7종(`thin_section`, `brief_prohibition_conflict`, `fact_conflict`, `unsupported_claim_term`, `industry_metric_leak`, `revisit_cohort_definition`, `local_channel_coverage`)은 `not_applicable`로 둔다. 재질문 1건이 여러 유형으로 이중 계산되지 않게 한다. 구조 채점기(`contract_json`, `heading_nesting`, `internal_id_exposure`, `input_budget`)는 계속 채점한다.
- 판정 임계값(역할 250자, 회의 발언 80자, 계약 섹션 150자, 입력 토큰 32,000)과 내부 식별자 패턴은 `lib/graders`가 정본이다.

## 실패 유형 정의표 (v1, 결정론 12종)

| ID | 정의 | 판정 규칙(fail) | not_applicable |
|---|---|---|---|
| `question_only` | 담당 산출물 대신 작업 지정 요청·번호 선택지·"알려 주시면 작성하겠다" 보류를 반환 | `substanceProblem(text,min)==='reask'` 또는 `isQuestionOnly(text)`(`lib/role-output.ts` 재사용). min은 역할 250자, 회의 발언 80자(`DISCUSSION_MIN_CHARS`). 회의 발언은 필드마다 `## 필드명` 제목을 붙여 검사한다(`meetings.ts` fieldText와 같음). 원 JSON은 계약 제목으로 렌더해 섹션별로 검사한다 | 입력, quality 판정 |
| `thin_section` | 계약 섹션이나 전체 본문에 실제 초안이 없음 | (a) 제목·표 구분선·`자료 필요`로 **시작하는** 줄을 뺀 전체 글자 수 < 250(발언 80), (b) 계약 섹션(렌더본의 계약 제목 사이, 하위 `###` 포함) 글자 수 < 150, (c) 섹션 과반이 `자료 필요`로 시작하는 줄만 있음. PR 2의 "자료 필요가 들어간 줄 80% 초과" 비율 규칙은 쓰지 않는다(한 줄 섹션의 인라인 `[자료 필요]` 태그를 오탐함) | 입력, `question_only` fail. 계약 없는 본문은 (a)(c)만 |
| `contract_json` | 역할 계약(role-output-v1)·회의 발언 스키마 위반 | 역할: 원 JSON에 `parseRoleOutput(raw,role,contract)`가 예외를 던짐. 원 JSON이 없으면 렌더본에 계약 제목이 순서대로 정확히 1회씩 `## 제목`으로 있어야 한다(약식). 회의 발언: `parseMeetingStep`이 4필드 누락·`respondsTo` 형식 오류·앞선 완료 발언이 있는데 허용 참조 0개를 보고함. 실질 분량 오류는 이 채점기가 아니라 위 두 채점기가 맡는다 | 계약 이전(legacy) 실행, quality, 입력 |
| `heading_nesting` | 계약 섹션 본문이 `#`·`##` 제목을 다시 써서 섹션 경계가 깨짐 | 계약 렌더본에서 `^#{1,2}\s` 줄이 계약 제목·`수정 요청 반영 위치`가 아님, 또는 계약 제목 바로 다음 비어 있지 않은 줄이 `#`·`##` 제목(빈 계약 섹션). legacy 역할 본문은 내보내기가 `## 역할명`으로 감싸므로 본문의 `#`·`##` 제목이 곧 fail. `###` 이하는 허용 | 입력, 브리프, 회의 발언, quality |
| `internal_id_exposure` | 사람이 읽는 본문에 내부 ID·입력 스키마 경로·디버그 값 노출 | URL을 뺀 산문에서 (a) `scrubInternalIds(text)!==text`(UUID·`meeting-` UUID·`ai-` 32자리·revision 번호), (b) 스키마 경로 `(campaign\|brandArchive\|archive\|evidence\|artifact(s)\|stores\|products\|operations\|budgetPlan\|learning\|snapshot).필드`, (c) 디버그 값 `소문자키=([]\|null\|true\|false\|숫자\|hex)`. `respondsTo`·`role` 같은 코드 필드는 제외. (b)가 없으면 스키마 경로만 노출한 발언을 놓친다 | 입력 |
| `brief_prohibition_conflict` | 브리프·안건이 막은 표현이 가설·실험 변수·카피에 다시 나옴 | 금지 표현 = 케이스의 큐레이션 `prohibitedTerms` ∪ 원장 거절값(`claimGuard(facts).prohibited`). 대상 구역 = 제목·라벨에 가설·실험·카피·문안·메시지·대본·자막·슬로건·헤드라인이 있는 블록, `가설 N`·`실험 N`으로 시작하는 문장, 회의 발언 position·proposal. 구역 안 문장(표는 칸 단위)에 금지 표현이 있고 같은 문장에 부정·배제 표현이 없으면 fail. `[확인 필요]`는 면제 사유가 아니다(claimPolicy). 라벨에 부정어가 있는 블록(예: "사용하지 않을 표현")은 제외 | 금지 표현 0개, 입력, `question_only` fail |
| `fact_conflict` | 확정 원장과 다른 값, 미확정 항목의 구체 값 단정, 거절값 사용 | 원장이 있을 때만. (a) 확정 주소와 본문 주소(공백 제거 비교)가 다름, (b) 거절값이 부정문 밖에서 쓰임, (c) 원장이 확정하지 않은 가격(`N,NNN원`, `N만 원`)·오픈일(`N월 N일 오픈` 등)·도보 시간·유동인구 수치가 `[확인 필요]`·`[예시]`·`미확정`·`자료 필요` 표시 없이 나옴 | 원장 없음, 본문이 원장 항목을 하나도 다루지 않음, 입력, `question_only` fail |
| `unsupported_claim_term` | 근거 없는 광고 표현(인기·판매 1위·최초·유일·할인·무료·오픈 혜택)이 카피에 쓰임 | `claimGuard(facts).unverified` 용어가 카피 구역(라벨이 카피·문안·메시지 초안·대본·자막·헤드라인·슬로건·CTA인 블록, 또는 따옴표 안 문구) 문장에 부정 표현·`확인 필요` 없이 나옴. 라벨이 "하지 않을·사용하지 않을·금지·제외"인 블록은 제외. PR 2 `unverifiedClaims`(줄 단위·좁은 부정어)는 절차 문장을 오탐해 그대로 쓰지 않는다 | 입력, `question_only` fail(카피 구역이 없으면 pass) |
| `industry_metric_leak` | 캠페인과 무관한 업종의 지표·용어 유입 | 캠페인 업종이 아닌 업종 사전 용어가 배제 표현(무관·삭제·제외·해당 없·관련 없) 없는 문장에 나옴. v1 사전: 보관함(물품보관함·보관함·락커·locker·가동 가능 시간·가동률), K-POP(포토카드·초동·팬사인회·앨범 판매), 뷰티(피부 개선·보습 효과·성분 함량) | 업종 미상(`context.industry` 없음), 입력, `question_only` fail |
| `revisit_cohort_definition` | 30일 재방문율을 관찰이 끝난 코호트로 정의하지 않음 | 재방문율·재구매율 정의 문장(`재방문율 =`, `재방문율은`, `÷`, `나눈`, 또는 `재방문율` 단독 줄 다음 줄이 `=`)에 성숙 기준(관찰이 끝난·마친·완료, 성숙, 코호트)이 없음 | 정의 문장 없음, 입력, `question_only` fail |
| `local_channel_coverage` | F&B·점포 캠페인 CMO·strategy가 로컬 핵심 채널 후보를 다루지 않음 | 플레이스(네이버 지도·플레이스)·당근·배달앱(배민·쿠팡이츠·요기요·배달 플랫폼)·카카오 4개 채널군이 각각 채널 구역(라벨·줄에 "채널") 또는 결정 표현(선택·제외·보류·후순위·채택·쓰지 않·다루지 않)이 있는 줄에 나와야 한다. `자료 필요`로 시작하는 줄과 `=`로 시작하는 산식 줄은 세지 않는다. 4/4 미만이면 fail | `context.localStore`가 아님, cmo·strategy 외 역할, 회의 발언, `question_only` fail |
| `input_budget` | 역할·회의 호출 입력 토큰이 절대 상한 초과 | 사용량 원장 `inputTokens > INPUT_TOKEN_CAP`. 제안값 32,000(대표 결정 사항, `context.inputTokenCap`으로 바꾼다) | 토큰 미확인, 브리프 초안·조사 호출(포함 여부 결정 전) |

### 결정론 불가 유형 (v1 채점기 제외, 정의만)

| ID | 정의 | 제외 이유와 대체 |
|---|---|---|
| `meeting_conformity` | 회의 발언이 앞 발언에 동조만 하고 실질 반박이 없음 | 동의 뒤 반박의 실질 여부는 판단이 필요하다. "동의합니다"로 시작하는 비율만 지표로 기록한다 |
| `causal_overreach` | 자료 없이 특정 장벽을 "최대 병목"으로 단정 | 단정과 가설 표현의 경계 판단이 필요하다. 사람 라벨(B2) 대상 |
| `brand_intro_as_fact` | 미확인 브랜드 소개를 "확인 사실" 구역에 적음 | 입력에 그렇게 적혀 있다는 사실과 상품 사실의 구분이 필요하다. v1.1 원장 구역 규칙 후보 |
| `concept_diversity` | 크리에이티브 3안의 설득 원리가 실제로 다른가 | 판단 필요. LLM judge 보정(B2) 뒤 |
| `generic_positioning` | 브랜드명만 바꿔도 성립하는 포지셔닝 | 판단 필요 |
| `role_slug_in_prose` | 본문에 `cmo`·`insight` 같은 역할 ID를 씀 | 안건이 먼저 같은 표기를 써서 오탐 위험이 크다. v1.1 후보 |

### PR 2 함수와의 관계

| 함수 | 채점기에서의 쓰임 |
|---|---|
| `isQuestionOnly`, `substanceProblem`('reask') | `question_only`가 그대로 재사용 |
| `substanceProblem`('placeholder') | 비율 규칙이 인라인 태그를 오탐해 `thin_section`은 쓰지 않는다. `sectionsOf`·`placeholderOnly`는 `lib/role-output.ts`에서 export되지 않아 `lib/graders/text.ts`에 같은 규칙을 두었다. F1b에서 export로 바꿔 하나로 합친다 |
| `scrubInternalIds` | `internal_id_exposure` (a)가 치환 발생 여부로 재사용하고 (b)(c) 패턴을 더한다 |
| `parseRoleOutput`, `parseMeetingStep` | `contract_json`이 재사용 |
| `claimGuard`, `claimTerms` | `brief_prohibition_conflict`·`fact_conflict`(거절값), `unsupported_claim_term`(미확인 광고 표현) |
| `unverifiedClaims` | 줄 단위·좁은 부정어라 절차 문장을 오탐한다. 채점기는 쓰지 않는다. 런타임 "확인 전 표현" 표시도 같은 오탐을 낼 수 있어 별도 추적이 필요하다 |

## 규제 가드레일 (A2, `lib/graders/compliance.ts`)

`checkCompliance(text,{facts})`가 문장 단위로 8개 범주를 점검하고 `{version,issues,notice}`를 반환한다. 어휘 사전(`lib/graders/compliance-lexicon.ts`)은 버전(`compliance-lexicon-YYYY-MM-DD.N`)과 공식 출처 URL(국가법령정보센터)을 가진다. 판정 로직과 사전을 나눠 사전만 개정할 수 있다.

| 범주 | 점검 내용 | 등급 |
|---|---|---|
| `platform_review` | 보상 조건부 리뷰·별점 요청, 영수증·리뷰 이벤트, 체험단·대량 리뷰 확보 | block |
| `endorsement` | 가짜·위장 체험담, 협찬·광고 관계 표기 누락, 표기를 빼라는 지시, 가상인물 표시 누락 | block |
| `ai_label` | AI 생성 이미지·영상·음성 소재의 생성물 표시 필요 | warn |
| `ad_message` | 광고 메시지의 (광고) 표기 누락(block), 수신 동의 전제·무료 수신거부 안내 누락, 야간(21~08시) 전송(warn) | block·warn |
| `food_claim` | 식품의 질병 예방·치료 효능 표현(block), 원산지 표시 대상 언급인데 원장에 원산지 확정값 없음(warn) | block·warn |
| `cosmetic_claim` | 의약품 오인 표현(block), 기능성 인증 근거 없는 기능성 표현(warn) | block·warn |
| `ecommerce_terms` | 구매 유도 문구의 가격·판매 조건 누락, 할인 표시의 기준 가격 누락 | warn |
| `rights` | 아티스트·유명인 이름·사진·앨범 이미지 사용 시 권리 확인 미기재 | warn |

- 등급: `block`(발행 원천으로 선택 불가), `warn`(사람 확인 필요, 차단하지 않음), `info`(기록만). v1 사전에는 `info` 규칙이 없다.
- 판정은 하향만 한다: `downgradeVerdict(verdict,issues)`는 `block`이 있을 때 `ready_for_review`를 `revise`로 내리고, 그 밖에는 판정을 바꾸지 않는다. 위반이 없다고 판정을 올리지 않는다.
- 부정·배제 문장("가짜 리뷰는 쓰지 않습니다")은 위반으로 보지 않는다. "없습니다"는 "부작용이 없습니다" 같은 효능 주장을 면제하므로 부정어에 넣지 않았다.
- 모델 검수 스키마(`qualityCriteria` 5기준)와 `qualityScopeNotice`는 바꾸지 않는다. 런타임 연결에서 가드레일 결과는 `complianceIssues`라는 별도 필드로만 저장한다(연결은 다음 PR, 기능 스위치로 끈다).
- 한계: 플랫폼별 리뷰 운영정책의 공식 URL은 아직 확인하지 않았다(`COMPLIANCE_LEXICON.platformPolicy`). 법령 조항 해석은 사람이 확인한다. 합성 예시의 탐지율·오탐률은 `tests/compliance.test.mjs` 출력(`violations`, `detected`, `falsePositives`)에 남는다.

## 역할 지시 스냅샷 (`lib/role-instruction.ts`)

`buildRoleInstruction({role,revisionRequest})`와 `buildRoleInput({role,campaign,brand,archive,evidence,learning,previous,previousDecisions,revisionRequest})`는 `lib/role-execution.ts` start 분기가 HERMES에 보내는 `instructions`·`input`을 서버 의존 없이 만든다. `roleRequestPlan`은 같은 입력으로 앞선 작업물 발췌와 산출물 계약을 돌려준다.

- 바이트 동일성 근거: `tests/fixtures/role-submission-<기준 sha7>.json`. 기준 커밋을 `git archive`로 풀어 `scripts/eval/capture-role-submission.mjs`를 실행해 만들었다. 모의 런타임(`tests/helpers/runtime.mjs`, 메모리 SQLite, HERMES fetch 스텁)과 합성 브랜드·캠페인만 쓰며 외부 호출은 0회다. 8개 역할과 재작성 지시(revisionRequest) 1건을 담는다.
- `tests/role-instruction.test.mjs`는 런타임 헬퍼 없이 순수 로더로 함수를 읽어 스냅샷과 비교한다.
- 재캡처: 역할 지시·입력 조립이 의도적으로 바뀌면 새 기준 커밋에서 다시 캡처하고 파일 이름의 sha7을 바꾼다. 이 테스트가 깨졌는데 의도한 변경이 아니면 회귀다.

```sh
git archive <기준 SHA> | tar -x -C <임시 디렉터리>
# node_modules를 링크하고 scripts/eval/capture-role-submission.mjs를 복사한 뒤 그 디렉터리에서:
node --experimental-vm-modules scripts/eval/capture-role-submission.mjs --sha <기준 SHA> --out <저장소>/tests/fixtures/role-submission-<sha7>.json
```

## 재채점(grade) 사용법

```sh
node scripts/eval/grade.mjs <case.json> [--json] [--detail]
```

- 네트워크를 쓰지 않는다. 채점 코드는 `console`만 있는 vm 컨텍스트에서 돌고, 프로세스의 `fetch`는 호출 수를 세고 예외를 던진다. 출력의 `networkCalls`가 0이어야 한다. HERMES 호출도 0회다.
- 경로 규칙: 케이스 파일과 참조 파일은 `git check-ignore`를 통과하는(무시 대상) 경로에만 둔다(예: 저장소의 `outputs/`). git이 추적할 수 있는 경로이거나 저장소 밖이라 판정할 수 없으면 exit 3으로 거부한다. 고객 원문과 골든셋이 실수로 커밋되지 않게 하려는 규칙이다.
- 파일을 쓰지 않는다. 실행 뒤 `git status --porcelain`에 새 파일이 없어야 한다.
- 기본 출력은 유형별 집계와 항목별 판정 기호(P/F/N/E)만 보여 준다. `--detail`은 fail 근거 발췌를 보여 주므로 로컬에서만 보고, 공개 PR·문서에 붙이지 않는다.

케이스 파일(`eval-case-v1`):

```json
{
 "version": "eval-case-v1",
 "context": {"prohibitedTerms": ["숯불"], "industry": "fnb", "localStore": true, "facts": null, "inputTokenCap": 32000},
 "sources": [
  {"type": "campaign_export", "file": "campaign.md"},
  {"type": "meeting_export", "file": "meeting.md"},
  {"type": "role_markdown", "file": "insight.md", "role": "insight", "id": "insight_repaired"},
  {"type": "role_json", "file": "insight.json", "role": "insight"},
  {"type": "usage_csv", "file": "usage.csv"},
  {"type": "items", "file": "items.json"}
 ],
 "itemContext": {"discussion_cmo": {"prohibitedTerms": ["숯불", "할인"]}},
 "notRun": [{"id": "discussion_content", "reason": "원문 없음"}]
}
```

| 입력 종류 | 분리 규칙 |
|---|---|
| `campaign_export` | 앱 내려받기 파일. `목표:` 줄 → `brief_goal`(입력), `예산:` 다음부터 첫 작업물 제목 전까지 → `brief_plan`, `## <역할명> · <캠페인 제목>` → `role_<역할>`. 역할은 파일 위치가 아니라 역할명으로 식별한다. 계약 실행 여부는 `contract: {역할: true}`로 지정하거나 계약 제목이 `## 제목`으로 있으면 자동 판정한다 |
| `meeting_export` | 첫 문단 → `meeting_agenda`(입력), `## <역할명> · 의견 교환` 아래 첫 `{` 줄부터 마지막 `}` 줄까지 JSON → `discussion_<역할>`. 앞선 발언 역할과 회의 ID(respondsTo에서 추출)를 붙여 `contract_json`이 참조를 검사한다 |
| `role_markdown` · `role_json` | 역할 산출물 하나(렌더본 또는 원 JSON) |
| `usage_csv` | `run`, `input_tokens` 열. 호출 1건이 `call_<run>` 항목 1건이며 `input_budget`만 채점한다 |
| `items` | `EvalItem[]` JSON(`lib/graders/types.ts`) |

`context`는 케이스 → 입력(`sources[].context`) → 항목(`itemContext`) 순으로 덮어쓴다. `facts`는 `{confirmed:[{key,value}],prohibited:[{key,value}]}` 형식의 골든 원장이다.

## 골든셋 규약

- 저장 위치: 골든 케이스(입력·원장·큐레이션 금지 표현·기대 판정)는 공개 저장소에 두지 않는다. 로컬은 `.gitignore` 대상 경로, 서버 평가(F1b)는 D1 `eval_case`가 정본이다. 공개 저장소에는 유형 ID·정의·판정 규칙과 합성 fixture만 둔다.
- 두 세트로 나눈다.
  - dev 세트: 규칙·프롬프트 튜닝에 자유롭게 쓴다.
  - 봉인 보류(holdout) 세트: 활성화 게이트(스킬·규칙·프롬프트 변경을 켤지 결정할 때)에서만 쓴다. 쓸 때마다 날짜·목적·실행자·결과를 기록한다. 봉인 세트를 보고 규칙을 고쳤다면 그 케이스는 dev로 옮기고 기록한다.
- 편입: 월 1회 운영에서 나온 실패(재질문, 금지 표현 재등장 등)를 원문 없이 입력·기대 판정 형태로 편입한다. 편입일과 출처 실행(사람이 읽는 라벨)을 남긴다.
- 퇴역: 역할 계약 버전(`role-output-v1` 등)이나 실무 스킬 버전이 바뀌어 케이스의 기대 판정이 더는 성립하지 않으면 해당 케이스를 퇴역시키고 사유·날짜를 기록한다. 퇴역 케이스는 비교에 쓰지 않는다.

## 비교 통계 규칙

후보(바뀐 프롬프트·모델·규칙)와 기준(active)을 비교할 때:

1. 케이스 단위로 대응해 비교한다. 같은 케이스·같은 채점기의 `pass/fail`만 짝으로 쓰고, 한쪽이라도 `not_applicable`·`grader_error`·`not_run`이면 그 짝은 뺀다.
2. 불일치 쌍을 표시한다: 기준 pass → 후보 fail(b), 기준 fail → 후보 pass(c).
3. 짝의 수 n이 30 미만이면 결론은 `비회귀`(b=0) 또는 `비교 불충분`만 쓴다. "개선"이라고 쓰지 않는다.
4. `개선`은 McNemar 정확 검정(불일치 쌍 b+c에 대한 양측 이항 검정, p=0.5)에서 p<0.05이고 c>b일 때만 주장한다.
5. 관측 1회로 성능을 결론 내지 않는다. 결론마다 n, b, c, p, 사용한 세트(dev/봉인)를 함께 적는다.

## 남은 결정·한계

- `input_budget` 상한(제안 32,000)과 브리프 초안 호출 포함 여부는 대표 결정 사항이다.
- `brief_prohibition_conflict`의 금지 표현은 케이스마다 사람이 큐레이션한다. 자유 문장에서 자동 추출하면 오탐이 많아 v1은 쓰지 않는다.
- `contract_json`은 원 JSON이 없으면 렌더본 제목만 보는 약식 검사다.
- 정규식 채점기라 표현 변형에 약하다. 오탐·미탐 사례는 합성 fixture로 옮겨 테스트에 추가한다.
- 이 채점기는 사실 정확성 전체나 설득력을 판정하지 않는다.

## 법률 자문 아님 고지

규제 가드레일과 이 문서는 표시·광고 관련 법령과 공식 지침의 일부 표현을 찾는 자동 점검이다. 법률 자문이 아니며, 적발되지 않았다고 적법하다는 뜻이 아니다. 게시 전 담당자가 원문 규정과 플랫폼 정책을 확인한다.
