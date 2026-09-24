# 평가 하네스 (F1a) · 실패 유형 사전 v1 · 규제 가드레일 (A2)

결론: 역할·회의 산출물을 네트워크 없이 다시 채점하는 결정론 채점기 13종과 규제 표시 가드레일 8범주를 순수 함수로 둔다. 프롬프트·모델·입력을 바꾼 뒤 결과가 나빠지지 않았는지를 사람의 인상 대신 같은 저울로 잰다.

비유: 요리 대회에서 맛 평가는 심사위원이 하지만, "재료를 빼먹었는가", "금지 재료를 썼는가"는 체크리스트로 누구나 같은 답을 낸다. 이 문서의 채점기는 그 체크리스트다. 맛(설득력·창의성)은 판정하지 않는다.

- 코드: `lib/graders/*.ts`(상대 import만 쓰는 순수 함수), `lib/role-instruction.ts`, `scripts/eval/grade.mjs`
- 테스트: `tests/graders.test.mjs`, `tests/compliance.test.mjs`, `tests/role-instruction.test.mjs`(모두 합성 데이터, `passed · mocked`)
- F1a는 새 파일만 더했다. F1b-1(#35)이 `lib/role-execution.ts`를 `lib/role-instruction.ts`에 연결했다. 서버 평가 실행(`eval_case`·`eval_run`)은 F1b-2가 더했다([서버 평가 실행](#서버-평가-실행-f1b-2)). 가드레일의 운영 연결은 A2 런타임 하향(기능 스위치 `a2_downgrade`, [아래](#런타임-하향-a2_downgrade))이 맡는다.
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
- 우선순위: `question_only`가 `fail`이면 내용 채점기 8종(`thin_section`, `brief_prohibition_conflict`, `fact_conflict`, `unconfirmed_value_assertion`, `unsupported_claim_term`, `industry_metric_leak`, `revisit_cohort_definition`, `local_channel_coverage`)은 `not_applicable`로 둔다. 재질문 1건이 여러 유형으로 이중 계산되지 않게 한다. 구조 채점기(`contract_json`, `heading_nesting`, `internal_id_exposure`, `input_budget`)는 계속 채점한다.
- 판정 임계값(역할 250자, 회의 발언 80자, 계약 섹션 150자, 입력 토큰 32,000)과 내부 식별자 패턴은 `lib/graders`가 정본이다.
- 부정·배제 판정(`lib/graders/negation.ts`, 채점기와 가드레일이 같은 사전을 쓴다): 문장 전체가 아니라 대상 표현 바로 뒤 서술부(같은 절, 40자 안)만 본다. `않·말고·금지·제외·삭제·안 됩니다·안 합니다·피합니다·피해야·빼고·대신·불가·금물`은 절 안 어디에 있어도 부정이다. `아닌·아니라·없이·없습니다`는 대상 바로 뒤 8자 안에 쉼표 없이 나올 때만 부정이다(예: "평범한 분식이 아닌 숯불 떡볶이"의 `아닌`은 숯불을 부정하지 않는다). `·`·`/`로 이은 나열은 한 대상으로 본다. `금지 표현: …`처럼 부정 라벨 뒤 나열도 부정이다. 판정 전에 조건 주석 괄호(`(주류 제외)`, `(1인 1회, 중복 참여 금지)`)와 권유·강조 관용구(`잊지 말고`, `놓치지 마세요`, `어디에도 없습니다`)를 지운다. `(진행 금지)`처럼 괄호 전체가 앞 행위의 부정이면 남긴다.
- 라벨(구역 이름): 제목 줄, 또는 `**`·`__` 강조와 끝 콜론을 벗긴 뒤 문장부호 없는 30자 이하 짧은 줄(`**게시 카피**`, `게시 카피:`)이다. `라벨: 본문` 인라인 줄(`- 게시 카피: …`, `**카피 A:** …`)은 그 줄에만 라벨을 붙이고 둘러싼 라벨과 함께 본다.

## 실패 유형 정의표 (v1, 결정론 13종)

| ID | 정의 | 판정 규칙(fail) | not_applicable |
|---|---|---|---|
| `question_only` | 담당 산출물 대신 작업 지정 요청·번호 선택지·"알려 주시면 작성하겠다" 보류를 반환 | `substanceProblem(text,min)==='reask'`(`lib/role-output.ts` 재사용, 섹션마다 `isQuestionOnly`·선택지·보류 패턴을 적용하고 재질문 섹션이 과반이거나 나머지 본문이 min 미만이면 reask). `isQuestionOnly`를 본문 전체에 단독 적용하지 않는다("고객 요청이 많은 메뉴 데이터는 아직 없습니다" 한 문장으로 fail이 되어 내용 채점기까지 가렸다). min은 역할 250자, 회의 발언 80자(`DISCUSSION_MIN_CHARS`). 회의 발언은 필드마다 `## 필드명` 제목을 붙여 검사한다(`meetings.ts` fieldText와 같음). 원 JSON은 계약 제목으로 렌더해 섹션별로 검사한다 | 입력, quality 판정 |
| `thin_section` | 계약 섹션이나 전체 본문에 실제 초안이 없음 | (a) 제목·표 구분선·`자료 필요`로 **시작하는** 줄을 뺀 전체 글자 수 < 250(발언 80), (b) 계약 섹션(렌더본의 계약 제목 사이, 하위 `###` 포함) 글자 수 < 150, (c) 섹션 과반이 `자료 필요`로 시작하는 줄만 있음. PR 2의 "자료 필요가 들어간 줄 80% 초과" 비율 규칙은 쓰지 않는다(한 줄 섹션의 인라인 `[자료 필요]` 태그를 오탐함) | 입력, `question_only` fail. 계약 없는 본문은 (a)(c)만 |
| `contract_json` | 역할 계약(role-output-v1)·회의 발언 스키마 위반 | 역할: 원 JSON에 `parseRoleOutput(raw,role,contract)`가 예외를 던짐. 원 JSON이 없으면 렌더본에 계약 제목이 순서대로 정확히 1회씩 `## 제목`으로 있어야 한다(약식). 회의 발언: `parseMeetingStep`이 4필드 누락·`respondsTo` 형식 오류·앞선 완료 발언이 있는데 허용 참조 0개를 보고함. 실질 분량 오류는 이 채점기가 아니라 위 두 채점기가 맡는다 | 계약 이전(legacy) 실행, quality, 입력 |
| `heading_nesting` | 계약 섹션 본문이 `#`·`##` 제목을 다시 써서 섹션 경계가 깨짐 | 계약 렌더본에서 `^#{1,2}\s` 줄이 계약 제목·`수정 요청 반영 위치`가 아님, 또는 계약 제목 바로 다음 비어 있지 않은 줄이 `#`·`##` 제목(빈 계약 섹션). legacy 역할 본문은 내보내기가 `## 역할명`으로 감싸므로 본문의 `#`·`##` 제목이 곧 fail. `###` 이하는 허용 | 입력, 브리프, 회의 발언, quality |
| `internal_id_exposure` | 사람이 읽는 본문에 내부 ID·입력 스키마 경로·디버그 값 노출 | URL을 뺀 산문에서 (a) `scrubInternalIds(text)!==text`(UUID·`meeting-` UUID·`ai-` 32자리·revision 번호), (b) 스키마 경로 `(campaign\|brandArchive\|archive\|evidence\|artifact(s)\|stores\|products\|operations\|budgetPlan\|learning\|snapshot).필드`, (c) 디버그 값 `소문자키=([]\|null\|true\|false\|숫자\|hex)`. `respondsTo`·`role` 같은 코드 필드는 제외. (b)가 없으면 스키마 경로만 노출한 발언을 놓친다 | 입력 |
| `brief_prohibition_conflict` | 브리프·안건이 막은 표현이 가설·실험 변수·카피에 다시 나옴 | 금지 표현 = 케이스의 큐레이션 `prohibitedTerms` ∪ 원장 거절값(`claimGuard(facts).prohibited`). 대상 구역 = 제목·라벨(인라인 라벨 포함)에 가설·실험·카피·문안·메시지·대본·자막·슬로건·헤드라인이 있는 블록, `가설 N`·`실험 N`으로 시작하는 문장, 회의 발언 position·proposal. 구역 안 문장(표는 칸 단위)에 금지 표현이 있고 그 표현 바로 뒤 서술부가 부정·배제가 아니면(위 공통 규칙) fail. `[확인 필요]`는 면제 사유가 아니다(claimPolicy). 라벨에 부정어가 있는 블록(예: "사용하지 않을 표현")은 제외 | 금지 표현 0개, 입력, `question_only` fail |
| `fact_conflict` | 확정 원장과 다른 값, 거절값 사용(원장 대조) | 원장에 있는 항목만 대조한다. (a) 확정 주소와 본문 주소(공백 제거 비교)가 다름, (b) 원장에 확정값이 있는 가격·오픈일·도보 시간·유동인구의 본문 값이 원장 값 목록에 없음(가격은 `N,NNN원`·`N만 원`을 원 단위로, 오픈일은 월-일로 정규화해 비교), (c) 거절값이 부정·배제 없이 쓰임. `[확인 필요]`·`[예시]` 표시 문장은 대조하지 않는다. 예산·비용·한도·객단가·매출·목표·광고비·수수료 등이 있는 문장의 금액은 판매가로 보지 않는다 | 원장 없음, 원장에 있는 항목을 본문이 하나도 다루지 않음(원장에 없는 항목의 값은 세지 않고 분모에서 뺀다), 입력, `question_only` fail |
| `unconfirmed_value_assertion` | 원장이 확정하지 않은 구체 값을 표시 없이 단정(factPolicy "원장에 없는 가격·개점일은 미확정으로 표시") | 원장에 확정값이 없는 종류(가격·오픈일·도보 시간·유동인구 수치)의 값이 `[확인 필요]`·`[예시]`·`미확정`·`자료 필요` 표시 없이 나옴. 가격 판정은 `fact_conflict`와 같이 예산·비용·매출 목표 문장을 뺀다 | 원장 없음, 미확정 종류의 구체 값이 본문에 없음, 입력, `question_only` fail |
| `unsupported_claim_term` | 근거 없는 광고 표현(인기·판매 1위·최초·유일·할인·무료·오픈 혜택)이 카피에 쓰임 | `claimGuard(facts).unverified` 용어가 카피 구역(라벨이 카피·문안·메시지 초안·대본·자막·헤드라인·슬로건·CTA인 블록, 또는 따옴표 안 문구) 문장에 `확인 필요` 없이 나오고 그 용어 바로 뒤 서술부가 부정·배제가 아님. 라벨이 "하지 않을·사용하지 않을·금지·제외"인 블록은 제외. PR 2 `unverifiedClaims`(줄 단위·좁은 부정어)는 절차 문장을 오탐해 그대로 쓰지 않는다 | 입력, `question_only` fail(카피 구역이 없으면 pass) |
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
| `substanceProblem`('reask') | `question_only`가 그대로 재사용 |
| `isQuestionOnly` | `substanceProblem`이 섹션마다 적용하는 경로로만 쓴다. 첫 정규식의 `없습니다\|없어요` 분기가 평범한 "…요청…없습니다" 문장도 재질문으로 본다. 런타임 `parseRoleOutput`은 본문 전체에 적용해 같은 문장이 든 정상 산출물을 거절할 수 있다(F1b에서 좁힐 후속 과제) |
| `substanceProblem`('placeholder') | 비율 규칙이 인라인 태그를 오탐해 `thin_section`은 쓰지 않는다. `sectionsOf`·`placeholderOnly`는 `lib/role-output.ts`에서 export되지 않아 `lib/graders/text.ts`에 같은 규칙을 두었다. F1b에서 export로 바꿔 하나로 합친다 |
| `scrubInternalIds` | `internal_id_exposure` (a)가 치환 발생 여부로 재사용하고 (b)(c) 패턴을 더한다 |
| `parseRoleOutput`, `parseMeetingStep` | `contract_json`이 재사용 |
| `claimGuard`, `claimTerms` | `brief_prohibition_conflict`·`fact_conflict`(거절값), `unsupported_claim_term`(미확인 광고 표현) |
| `unverifiedClaims` | 줄 단위·좁은 부정어라 절차 문장을 오탐한다. 채점기는 쓰지 않는다. 런타임 "확인 전 표현" 표시도 같은 오탐을 낼 수 있어 별도 추적이 필요하다 |

## 규제 가드레일 (A2, `lib/graders/compliance.ts`)

`checkCompliance(text,{facts})`가 문장 단위로 8개 범주를 점검하고 `{version,issues,notice}`를 반환한다. 현재 사전은 `compliance-lexicon-2026-09-23.2`다. 어휘 사전(`lib/graders/compliance-lexicon.ts`)은 버전(`compliance-lexicon-YYYY-MM-DD.N`)과 공식 출처 URL(국가법령정보센터)을 가진다. 판정 로직과 사전을 나눠 사전만 개정할 수 있다.

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
- 부정·배제: 걸린 표현 바로 뒤 서술부가 부정·배제면("가짜 리뷰는 쓰지 않습니다", "리뷰 이벤트 없이 진행합니다", "리뷰 이벤트를 하면 안 됩니다") 위반으로 보지 않는다. 채점기와 같은 사전·범위 규칙(위 공통 규칙)을 쓴다. 판촉 문구의 조건 주석(`(주류 제외)`, `(중복 참여 금지)`)과 `잊지 말고` 같은 권유형 어미는 면제 사유가 아니다. `없습니다`는 대상 바로 뒤에서만 부정이라 "당뇨 개선 효과, 부작용이 없습니다"는 효능 주장으로 남는다.
- 범위: `cleared`(표기·동의·권리 확인 등 해소 표현)는 걸린 문장이 속한 섹션(제목 `#` 줄·구분선 `---` 사이)에서만 찾는다. 한 초안의 `(광고)`·`#광고`가 같은 문서의 다른 초안 누락을 덮지 않는다. 광고 메시지 규칙의 판촉어(`context`)는 같은 문장에서 찾고, 걸린 표현이 초안 라벨(`문자 초안:`, `## 알림톡 발송 문안 B`)이면 뒤따르는 문단까지 본다. "발송 대신 매장 안내문", "수신 동의 고객이 생긴 뒤에 검토합니다" 같은 비전송·보류 문장은 면제한다(`except`).
- 체험단·대량 리뷰(`bulk_review`)는 `리뷰 N건`에 모집·확보·작업·구매·대행이 함께 있을 때만 걸고, 체험단·모집 등이 없는 KPI·목표·측정 문장("방문자 리뷰 30건을 목표로")은 면제한다. 구매 유도 문구 규칙은 버튼 클릭 수 같은 측정 문장을 면제한다.
- 인용: 경쟁점·위반 사례(`사례`, `위반 소지`, `경쟁점`) 문장에서 따옴표 안에 걸린 표현은 `info`로만 남는다. 같은 규칙에 인용 밖 해당 문장이 있으면 그 문장의 원래 등급으로 보고한다.
- 제목이 `금지 사항`·`하지 않을 것`·`피할 표현`인 섹션의 목록은 위반 문안으로 보지 않는다.
- 모델 검수 스키마(`qualityCriteria` 5기준)와 `qualityScopeNotice`는 바꾸지 않는다. 런타임 연결에서 가드레일 결과는 작업물의 `complianceHold`라는 별도 필드로만 저장한다(기능 스위치 `a2_downgrade`로 끈다).
- 한계: 플랫폼별 리뷰 운영정책의 공식 URL은 아직 확인하지 않았다(`COMPLIANCE_LEXICON.platformPolicy`). 법령 조항 해석은 사람이 확인한다. 합성 예시의 탐지율·오탐률은 `tests/compliance.test.mjs` 출력(`violations`, `detected`, `falsePositives`)에 남는다. 쉼표 뒤 다른 대상의 부정("음료 증정, 주류는 안 됩니다")은 같은 절로 보아 면제될 수 있다(미탐 위험). 나열 목록("숯불, 화덕은 쓰지 않습니다")을 부정으로 인정하려고 쉼표를 절 경계로 쓰지 않았다.

### 런타임 하향 (`a2_downgrade`)

`lib/online-grading.ts`가 역할·회의 작업물 저장 직후(잠금 해제 뒤) 가드레일을 적용한다. 기본 꺼짐이며 운영 절차·compare-and-set 조건은 [RELIABILITY.ko.md 기능 스위치](RELIABILITY.ko.md#기능-스위치)에 있다.

- 판정은 하향만 한다. block 위반이 있는 작업물에 `complianceHold`(사전 버전, block 건수, 규칙별 `category`·`ruleId`·`title`·`excerpt` 최대 20건, `checkedAt`, `notice`)를 남긴다. warn·info는 기록하지 않는다. block이 없어도 기존 hold를 지우지 않는다.
- 품질 검수(`ai-quality-6` 구조 게이트 `enforceQuality` 뒤)를 저장할 때 같은 캠페인·같은 캠페인 버전의 현재 작업물(검수 자신 포함)에 hold가 있거나 이번 점검에서 block이 나오면 `downgradeVerdict`로 `ready_for_review`→`revise`만 하고, `gateIssues`에 `A2 규제 점검: <작업물 제목> — <규칙 제목> 외 N건`과 `COMPLIANCE_NOTICE`를 더한다. `checks`는 5기준 그대로이며 규제 기준(criterion)을 새로 만들지 않는다. `taskChecks`도 그대로다. 판정을 내렸으면 캠페인도 역할·회의 저장 규칙처럼 `review`→`revision`으로만 내린다.
- 입력 상한: 온라인 채점과 같은 2,000줄(`MAX_GRADED_LINES`)을 넘는 작업물은 점검하지 않는다(미탐 위험, 로그 `a2_downgrade_not_run`).
- `online_grading`이 켜져 있으면 채점 결과의 규제 점검을 재사용하고 `grading` 기록 형식은 바꾸지 않는다(발췌 없음). 꺼져 있어도 `a2_downgrade`만으로 점검한다.
- 끄는 방법: 기능 스위치 `a2_downgrade`를 끄거나 기본값으로 되돌린다. 꺼지면 작업물·`grading` 기록이 이전과 바이트 단위로 같다.
- 테스트: `tests/a2-runtime.test.mjs`(`passed · mocked`). 화면 표시와 hold는 법률 자문이 아니다([고지](#법률-자문-아님-고지)).

## 역할 지시 스냅샷 (`lib/role-instruction.ts`)

`buildRoleInstruction({role,revisionRequest})`와 `buildRoleInput({role,campaign,brand,archive,evidence,learning,previous,previousDecisions,revisionRequest})`는 `lib/role-execution.ts` start 분기가 HERMES에 보내는 `instructions`·`input`을 서버 의존 없이 만든다. `roleRequestPlan`은 같은 입력으로 앞선 작업물 발췌와 산출물 계약을 돌려준다.

- 바이트 동일성 근거: `tests/fixtures/role-submission-<기준 sha7>.json`. 기준 커밋을 `git archive`로 풀어 `scripts/eval/capture-role-submission.mjs`를 실행해 만들었다. 모의 런타임(`tests/helpers/runtime.mjs`, 메모리 SQLite, HERMES fetch 스텁)과 합성 브랜드·캠페인만 쓰며 외부 호출은 0회다. 8개 역할과 재작성 지시(revisionRequest) 1건을 담는다.
- `tests/role-instruction.test.mjs`는 런타임 헬퍼 없이 순수 로더로 함수를 읽어 스냅샷과 비교한다.
- 재캡처: 역할 지시·입력 조립이 의도적으로 바뀌면 새 기준 커밋에서 다시 캡처하고 파일 이름의 sha7을 바꾼다. 이 테스트가 깨졌는데 의도한 변경이 아니면 회귀다. 실패 메시지가 재캡처 절차를 안내한다.
- 단일 원천: F1b-1(#35)부터 `lib/role-execution.ts`가 이 모듈을 직접 호출하므로 역할 지시·입력 조립은 `lib/role-instruction.ts` 한 곳에만 있다. `tests/role-execution-drift.test.mjs`는 실제 실행 경로(모의 런타임)의 제출 본문이 순수 함수 출력과 같은지 확인한다. 순수 함수 자체의 변경은 스냅샷 `role-submission-fc8eb5c.json`(16케이스: 8역할, 재질문 뒤 재작성, 검토 메모 보완, 이전 회의 결정, 앞선 작업물 발췌 잘림, quality 재작성)이 잡는다.
- 병합 순서 주의: `lib/practice.ts`(`PRACTICE_VERSION`, 역할 방법 문구), `lib/campaign-policy.ts`, `lib/ai-context.ts`, `lib/role-instruction.ts`를 바꾸는 PR은 스냅샷 테스트가 실패한다. 의도한 변경이면 새 기준 SHA에서 fixture를 재캡처한다.

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

구현: `lib/eval-stats.ts`(`compareRuns`, `mcnemarExact`, `comparisonVerdict`, import 없는 순수 모듈). 서버 평가 결과는 `GET /api/eval?compare=<기준 run>,<비교 run>`으로 비교한다.

1. 케이스 단위로 대응해 비교한다. 같은 케이스·같은 채점기의 `pass/fail`만 짝으로 쓰고, 한쪽이라도 `not_applicable`·`grader_error`·`not_run`이면 그 짝은 뺀다.
2. 불일치 쌍을 표시한다: 기준 pass → 후보 fail(b), 기준 fail → 후보 pass(c).
3. 짝의 수 n이 30 미만이면 결론은 `비회귀`(b=0) 또는 `비교 불충분`만 쓴다. "개선"이라고 쓰지 않는다.
4. `개선`은 McNemar 정확 검정(불일치 쌍 b+c에 대한 양측 이항 검정, p=0.5)에서 p<0.05이고 c>b일 때만 주장한다.
5. 관측 1회로 성능을 결론 내지 않는다. 결론마다 n, b, c, p, 사용한 세트(dev/봉인)를 함께 적는다.
6. 판정 어휘(`lib/eval-stats.ts`): n=0이면 `insufficient`. n<30이면 b=0일 때 `non_regression`, 아니면 `insufficient`(p가 작아도 회귀·개선을 주장하지 않는다). n≥30이면 p<0.05·c>b는 `improved`, p<0.05·b>c는 `regressed`, 그 밖에는 b=0이면 `non_regression`, 아니면 `inconclusive`.
7. p = min(1, 2·Σ_{i≤min(b,c)} C(b+c,i)/2^(b+c)). 2^-n이 0으로 내려가지 않도록 로그 공간에서 더한다. 기준값은 Python 분수 계산과 1e-12 안에서 같다(`tests/eval-stats.test.mjs`).
8. 비교 결과에는 공유 케이스 수, 한쪽 run에만 있는 케이스 수(`onlyBaseline`·`onlyCandidate`), `sameCaseSet`을 함께 낸다. 케이스 집합이 다르면 공유 케이스만 짝으로 쓴다.

## 서버 평가 실행 (F1b-2)

결론: 골든셋 케이스를 D1 `eval_case`에 동결하고, 평가 전용 HERMES 프로필에 백그라운드로 하나씩 보내 서버가 같은 채점기로 채점한다. 예산(결정 5)과 운영 격리(결정 6)를 코드가 막는다.

비유: 시험 문제지(케이스)를 봉투에 봉인해 두고, 연습실(평가 전용 프로필)에서만 풀게 한다. 한 번에 쓸 수 있는 종이(토큰)는 정해져 있고, 다 쓰면 남은 문제는 풀지 않은 것으로 적는다.

- 코드: `lib/eval-server.ts`(연결·케이스·실행·채점), `lib/eval-stats.ts`(비교 통계), `app/api/eval/route.ts`, `lib/background-execution.ts`(`eval:<run id>` 작업), `lib/role-execution.ts`(`roleSources`·`roleRequestFor`로 요청 조립 DB 읽기를 추출, 동작 불변)
- 테스트: `tests/eval-server.test.mjs`, `tests/eval-stats.test.mjs`(합성 데이터, 평가·운영 HERMES fetch 스텁, `passed · mocked`). 실제 HERMES 호출은 0회다.
- 권한: 읽기·쓰기 모두 워크스페이스 소유자만 한다(`requireOwnerActor`). 비로그인 401, 관리자·직원 403, 다른 소유자의 케이스·실행·출력은 404. POST 본문은 1,000,000바이트 한도(413, `lib/http-limits.ts` 방식)다.
- records kind: `eval_connection`, `eval_case`, `eval_run`, `eval_output`(부모 `eval_run`). 정책은 `lib/record-kinds.ts`에 있다.
- 운영 사용량 장부(`provider_usage`)에는 평가 토큰을 쓰지 않는다. 평가 토큰은 `eval_run.usedTokens`에만 있다. `delete_run`은 이 행을 지우지 않고 결과·출력만 비운다(아래 3절). 그래서 월 누적은 삭제로 줄지 않는다.

### 1. 평가 연결

```json
{"action":"save_connection","endpoint":"https://<평가 전용 HERMES 주소>","key":"<평가 연결 키>","isolationConfirmed":true,"note":"메모리 off 평가 프로필"}
```

- 주소는 HTTPS만 받는다(`hermesEndpoint` 규칙: 443 포트, IP·내부 호스트 거부).
- 운영 HERMES 연결(`settings`)과 호스트가 같으면 400으로 거부한다. 경로가 달라도 호스트가 같으면 같은 endpoint로 본다(같은 gateway면 같은 메모리를 쓸 수 있어서다). 호스트는 소문자로 바꾸고 끝의 점을 뗀 뒤 비교한다. `<호스트>.`(FQDN 표기)는 `<호스트>`와 같은 DNS 이름이기 때문이다. 저장 때와 매 실행 걸음의 재확인에 같은 규칙을 쓴다.
- 평가 주소의 호스트 끝에 점이 있으면(`%2E` 인코딩 포함) 400으로 거부한다.
- 주소와 키는 기존 자격증명과 같은 방식(`lib/server.ts` `encrypt`, `AGENCY_ENCRYPTION_KEY`, AES-GCM)으로 한 암호문에 저장한다. 응답과 GET에는 설정 여부·호스트·상태·확인 시각만 나오고 키와 전체 주소는 나오지 않는다.
- 저장할 때 `verifyHermes`로 `GET /v1/capabilities`(실행·조회·중지·영구 멱등), 무인증 요청 401/403, `GET /v1/models`를 확인한다. **선택: 확인에 실패해도 저장하고 `status: blocked`와 `statusReason`을 남긴다.** blocked 연결로는 실행하지 않는다. `{"action":"check_connection"}`으로 다시 확인한다.
- `isolationConfirmed`는 대표가 평가 전용 프로필(메모리 off, 운영과 분리)을 확인했다는 표시다. false로도 저장되지만 실행은 blocked가 된다. 메모리 off 여부는 코드가 검사하지 못한다(아래 한계).

### 2. 평가 케이스(`eval_case`)

| 작업 | 입력 | 규칙 |
|---|---|---|
| `capture_case` | `campaignId`, `role`, `set?`, `label?`, `expectations?` | 운영 역할 실행 start와 같은 DB 읽기(`roleSources`→`roleRequestFor`)로 요청 객체를 만들어 JSON 그대로 동결한다. 실행 가능 여부 검사(진행 중 작업·앞선 담당 누락·현재 작업물 존재 409)는 적용하지 않아 끝난 캠페인에서도 캡처한다 |
| `save_case` | `role`, `request`, `expectations?`, `set?`, `label?` | `request`는 운영 요청 구조(role·campaign·brand·archive·evidence·previous)여야 하고 현재 `buildRoleInstruction`·`buildRoleInput`이 받아야 한다. 900,000자를 넘으면 413 |
| `update_case` | `id`, `label?`, `set?`, `expectations?` | 요청(`request`)은 바꾸지 않는다. 세트 이동은 `setChanges`에 누가·언제 남긴다 |
| `delete_case` | `id` | 진행 중 run이 쓰는 케이스는 409 |

- `expectations`는 채점 컨텍스트다: `prohibitedTerms`(큐레이션 금지 표현), `facts`(`{confirmed,prohibited}`, 캡처 기본값은 요청의 확정·거절 사실), `industry`, `localStore`, `inputTokenCap`.
- `set`은 `dev`(기본) 또는 `sealed`. `capturedWith`에 캡처 시점 `PRACTICE_VERSION`·`ROLE_OUTPUT_VERSION`을 남겨 퇴역 판단에 쓴다.
- 캠페인을 삭제해도 `eval_case`는 남는다(`retain`, `data_campaign` 링크로 삭제 영향 조회의 보존 건수에 나온다). 동결 요청에는 캠페인·브랜드·앞선 작업물 원문이 들어 있으므로 필요 없어진 케이스는 소유자가 개별 삭제한다.
- 드리프트 방지: `tests/eval-server.test.mjs`가 캡처한 요청으로 만든 지시문·입력이 같은 캠페인의 운영 start 제출 본문과 바이트 동일한지 확인한다.

### 3. 실행(`eval_run`)

```json
{"action":"start_run","set":"dev","tokenBudget":100000,"label":"프롬프트 변경 전 기준"}
```

- 케이스는 `caseIds`(1~100개) 또는 `set`(dev|sealed, 100개 이하)으로 고른다. `variant`는 `active`(현재 코드) 또는 `pair`(F3b 쌍 평가, 아래 5절)만 받는다. 후보 단독 실행은 없다.
- `tokenBudget`은 필수(없으면 400)이며 케이스 1건 예약량(`EVAL_CASE_TOKEN_RESERVE`, 50,000) 이상 정수다. 더 작으면 400이다.
- 케이스 1건 예약량 50,000은 구현 선택이다. HERMES 제출에 토큰 상한이 없어서, 케이스 하나가 쓸 양을 미리 잡아 두는 값이다. 근거는 실측 역할 1회 7,343~13,997토큰(`docs/observations/2026-09-23-live-run.md`)이고, 예약량은 그 최댓값의 약 3.5배다. 대표가 바꿀 수 있다.
- 진행 중(`queued`·`running`) 평가 run은 소유자당 1개(`EVAL_MAX_ACTIVE_RUNS`)다. 하나가 진행 중이면 새 `start_run`은 409이고 기록하지 않는다. 검사와 저장은 POST 라우트의 소유자 잠금 안에서 한다.

| 예산(결정 5) | 기준 | 넘으면 |
|---|---|---|
| 스모크 1회 | `tokenBudget` ≤ 250,000 | 409 |
| 월 절대 상한(시작) | 이번 UTC 월에 만든 run(삭제한 run 포함)의 보고 토큰 합 + 진행 중 run의 남은 예산 + 새 `tokenBudget` ≤ 1,500,000 | 409 |
| run 예산(제출 직전) | 이 run의 보고 토큰 + 50,000 ≤ `tokenBudget` | 남은 케이스 `not_run`, `stopReason: budget_reached` |
| 월 절대 상한(제출 직전) | run 생성 월의 보고 토큰 합 + 다른 진행 중 run의 남은 예산 + 50,000 ≤ 1,500,000. 월 상한 승인을 받은 run은 이 검사를 건너뛰고 run 예산만 본다 | 남은 케이스 `not_run`, `stopReason: monthly_cap_reached` |
| 대표 건별 승인 | `overBudgetApproved: {"reason": "…"}` | 허용하고 run에 사유·승인자·시각·넘은 상한(`smoke_cap`·`monthly_cap`)·당시 월 누적을 기록 |

- **시작 거부 정책(선택)**: 평가 연결이 없거나, 격리 미확인이거나, 연결 확인이 blocked이거나, 운영 연결이 같은 호스트면 run을 `blocked`(원인 `blockedReason`, 케이스는 모두 `not_run`)로 기록하고 409 `{error, run}`으로 답한다. 시도와 원인이 남는다. 입력 오류(400), 예산 초과(409), 진행 중 run 있음(409)은 기록하지 않는다.
- 진행: 시작 요청은 공급자를 부르지 않는다. 백그라운드 워커(`POST /api/research-worker` tick)의 공정 큐가 `eval:<run id>`를 다른 작업과 같은 순번 커서로 돌린다. 진행 중 평가 run이 1개라 큐 순번에 평가 작업은 최대 1개다. 운영 작업이 차례를 기다리는 간격은 평가 때문에 한 순번에 한 tick만 늘어난다. tick마다 소유자 잠금 안에서 조회나 제출을 1건만 한다. 시간 초과나 막힘으로 보내는 중지 요청만 여기에 더해진다(아래 오류 분류). 제출 중인 케이스가 있으면 조회하고, 없으면 다음 케이스를 제출한다. 매 걸음 전에 연결 조건(격리·확인 상태·운영 호스트 충돌)을 다시 본다.
- 제출 본문: `{instructions: buildRoleInstruction(request), input: buildRoleInput(request), session_id: <키>, conversation_history: []}`. 운영 HERMES 제출과 같은 모양이며 현재 코드의 조립기로 만든다. 지시문·입력의 SHA-256 앞 16자를 `promptHash`로 남긴다.
- 멱등 키: `collective-eval-` + SHA-256(`<run id>:<case id>`) 앞 40자. `Idempotency-Key`·`X-Hermes-Session-Key` 헤더에 쓴다. 운영 키(`collective-<uuid>`)와 접두사가 달라 저장된 운영 키를 재사용할 수 없고, run마다 달라 같은 케이스를 다시 평가해도 이전 결과를 돌려받지 않는다. 같은 run·케이스의 재시도는 같은 키라 중복 실행을 막는다.
- 예산 중단: 제출 직전마다 위 표의 run 예산·월 절대 상한(제출 직전)을 본다. 넘으면 다음 제출을 멈추고, 남은 케이스는 `not_run`(`stopReason: budget_reached` 또는 `monthly_cap_reached`)이 된다. 제출한 케이스가 토큰 사용량 없이 끝나도 예산을 지킬 수 없으므로 같은 방식으로 멈춘다(`usage_unreported`). 케이스 하나가 예약량 50,000보다 많이 쓰면 그 케이스만큼 run 예산을 넘을 수 있다. 그러면 다음 제출 직전 검사가 그 run을 멈추고, 늘어난 월 누적은 이후 run의 시작·제출 검사에 반영된다.
- 오류 분류: 401/403은 `blocked`(인증), 연결 불가·다른 주소로 이동은 `blocked`(연결)로 run을 멈춘다. 이것은 `failed`와 다르다. 제출 전 케이스는 `not_run`이 된다. 조회하던(제출 중) 케이스는 `blocked`가 되고 `providerRunId`를 유지한다. 연결은 살아 있는데 격리 해제·연결 확인 실패·운영 호스트 충돌로 게이트만 막힌 경우도 같다. 막힐 때 제출 중인 HERMES 실행이 있으면, 저장된 평가 연결이 그 run을 보낸 호스트일 때 중지를 요청한다. 요청 결과(확인함·확인하지 못함·연결이 없어 요청 못 함)는 케이스 `error`에 남긴다. 429·5xx는 워커 백오프(`background_attempt`)로 재시도한다. 그 밖의 4xx·실행 번호 오류·HERMES 실패·중단 보고는 해당 케이스만 `failed`. 30분 넘게 끝나지 않은 케이스는 중지를 요청하고 `failed`로 둔다.
- 채점: 케이스가 끝나면 서버가 `runGraders`(13종)와 `checkCompliance`로 채점한다. run에는 채점기별 `pass|fail|not_applicable|grader_error`(상세 200자), 요약 건수, 가드레일 등급별 건수·규칙 ID, 보고 모델, `providerRunId`, 토큰(입력·출력·합계), `durationMs`(제출~완료 관측, tick 간격 포함)를 남긴다. 모델 출력 원문과 발췌가 든 가드레일 상세는 `eval_output`(소유자 전용)에 둔다.
- 봉인 세트: sealed 케이스를 쓰는 run은 `sealedUsed: {by, at, cases}`를 남긴다. 목적은 run `label`에 적는다.
- `cancel_run`: 제출 중인 HERMES 실행에 중지를 요청하고(확인 여부를 케이스 `error`에 남김) 그 케이스는 `cancelled`, 남은 케이스는 `not_run`. `delete_run`: 끝난 run의 출력(`eval_output`)과 케이스 결과(`results`)를 지운다(진행 중이면 409, 이미 삭제했으면 409). run 행은 `deleted: {by, at, cases}`를 단 채 남는다. 결정 5 장부(`usedTokens`·`tokenBudget`·`createdAt`)와 감사 기록(`overBudgetApproved`·`sealedUsed`·`label`)을 보존해 월 누적이 삭제로 줄지 않게 하려는 것이다. 삭제한 run은 비교(`compare`)할 수 없다(409).

| 케이스 상태 | 뜻 |
|---|---|
| `pending` | 아직 제출하지 않음 |
| `submitted` | HERMES가 받음, 결과 대기 |
| `completed` | 결과를 받아 채점함(채점 결과의 pass/fail과는 별개) |
| `failed` | HERMES 실패·중단·시간 초과·출력 형식 오류 |
| `blocked` | 제출했으나 연결·인증·격리 조건이 막혀 결과를 확인하지 못함. HERMES가 계속 실행했을 수 있고, 중지 요청 결과는 `error`에 기록 |
| `cancelled` | 취소로 중지 |
| `not_run` | 예산·월 상한·사용량 미보고·취소·막힘으로 제출하지 않음(이유를 `error`에 기록) |

run 상태: `queued` → `running` → `completed` | `cancelled` | `blocked`.

### 4. 조회

| 요청 | 응답 |
|---|---|
| `GET /api/eval` | `connection`(비밀 없음), `cases`(요청 원문 제외 요약), `runs`, `usage: {month, usedTokens, reservedTokens, monthlyCap, smokeCap}` |
| `GET /api/eval?case=<id>` | 케이스 전체(동결 요청 포함) |
| `GET /api/eval?run=<id>` | run 전체 |
| `GET /api/eval?run=<id>&caseId=<id>` | 모델 출력 원문과 가드레일 상세 |
| `GET /api/eval?compare=<기준 run>,<비교 run>` | 채점기별 대응 비교(아래 비교 통계 규칙). pair run은 400 |
| `GET /api/eval?pair=<pair run>` | 한 run 안 두 쪽(active·candidate) 대응 비교와 활성화 게이트 판정(`gate`) |
| `GET /api/eval?run=<id>&caseId=<id>&variant=<active\|candidate>` | pair run 한쪽의 모델 출력 원문과 가드레일 상세 |

### 5. 쌍 평가(`pair`, F3b)

결론: 후보 프롬프트 버전은 따로 돌리지 않고, 같은 run 안에서 케이스마다 지금 적용 버전(active)과 번갈아 제출해 같은 채점기로 비교한다. 활성화 게이트(`docs/PROMPT-REGISTRY.ko.md` '활성화 게이트')가 이 run 하나로 판정한다.

```json
{"action":"start_run","pair":{"unit":"role.cmo","candidateVersionId":"role.cmo@<12자>"},"set":"sealed","tokenBudget":200000,"label":"role.cmo 후보 쌍 평가"}
```

- 두 쪽: `active`는 레지스트리 전체 적용 버전(없으면 코드 상수, 이때 제출 본문은 `active` run과 바이트 동일), `candidate`는 후보 버전 본문을 `RoleRequest.prompts`로 주입한다. 대상 단위 밖은 두 쪽 모두 코드 상수다. run의 `pair`에 단위·후보·active 버전 id와 두 쪽 본문을 시작 때 고정한다.
- 결과 행: 케이스마다 두 행(`variant: active|candidate`). 순서는 케이스마다 `active→candidate`, `candidate→active`를 번갈아 쓴다. 멱등 키는 `<run>:<case>:<쪽>`으로 쪽마다 다르다.
- 대상 단위를 쓰지 않는 케이스(다른 역할, 채널이 적용되지 않는 캠페인)는 빼고 `pair.skippedCases`에 수를 남긴다. 남는 케이스가 없으면 400.
- 예산: 두 제출 모두 위 3절 표의 run 예산·월 상한 검사를 제출 직전마다 받는다. 한 케이스가 한쪽만 끝나고 멈추면 게이트를 통과하지 못한다.
- 게이트웨이: 시작 때 `gatewaySnapshot`, 끝날 때(`completed`) 같은 평가 연결로 `gatewaySnapshotEnd`를 잰다. 두 해시가 다르면 게이트 거부다.
- 판정: `lib/eval-stats.ts` `pairGate`(순수). 비교 통계(`comparison`)는 참고용이며 게이트는 비회귀 조건(합격 수 후보 ≥ active, 봉인 회귀 0, `input_budget` 후보 전부 pass, 모델·게이트웨이 동일, 전 케이스 두 쪽 완료)만 본다.

### 서버 평가의 한계

- 이 PR의 검증은 모두 `mocked`다. 실제 평가 전용 HERMES 프로필로 스모크를 돌리지 않았다(결정 5 예산 안에서 대표가 연결을 등록한 뒤 한다).
- 메모리 off와 운영 분리는 대표 확인(`isolationConfirmed`)과 호스트 비교에만 의존한다. 같은 HERMES 인스턴스를 다른 호스트 이름으로 등록하면 코드는 구분하지 못한다.
- 제출 응답이 연결 끊김으로 유실되면 run은 blocked가 되지만 HERMES가 이미 받았을 수 있다(실행 번호가 없어 중지도 못 한다). 취소·시간 초과·blocked로 멈춘 실행의 토큰은 보고되지 않으면 `usedTokens`에 들어가지 않는다. 중지 요청이 확인되지 않은 blocked 케이스는 HERMES 쪽에서 토큰을 더 썼을 수 있다. 월 누적은 run 생성 시각(UTC) 기준이다.
- 월 절대 상한은 케이스 1건 예약량(50,000)을 넘게 쓰는 케이스가 없다는 가정에서만 지켜진다. 한 케이스가 예약량을 넘기면 그만큼 상한을 넘을 수 있다. 진행 중 run이 1개라, 넘는 양은 그 run의 마지막 케이스 하나에서 생긴다.
- 화면(UI)은 없다. API로만 쓴다.

## 남은 결정·한계

- `input_budget` 상한(제안 32,000)과 브리프 초안 호출 포함 여부는 대표 결정 사항이다.
- `brief_prohibition_conflict`의 금지 표현은 케이스마다 사람이 큐레이션한다. 자유 문장에서 자동 추출하면 오탐이 많아 v1은 쓰지 않는다.
- `contract_json`은 원 JSON이 없으면 렌더본 제목만 보는 약식 검사다.
- 정규식 채점기라 표현 변형에 약하다. 오탐·미탐 사례는 합성 fixture로 옮겨 테스트에 추가한다. 공개 저장소의 fixture는 로컬 산출물 문장을 옮기지 않고 같은 판정 성질의 합성 문장으로 새로 쓴다.
- 실패 유형 수는 13종이다. 계획의 v1 목표(10~12종)보다 1종 많다. 원장 대조(`fact_conflict`, 원장에 없는 항목은 분모에서 제외)와 미확정 값 단정(`unconfirmed_value_assertion`)을 계획 수용 기준대로 나누었기 때문이다.
- 이 채점기는 사실 정확성 전체나 설득력을 판정하지 않는다.

## 법률 자문 아님 고지

규제 가드레일과 이 문서는 표시·광고 관련 법령과 공식 지침의 일부 표현을 찾는 자동 점검이다. 법률 자문이 아니며, 적발되지 않았다고 적법하다는 뜻이 아니다. 게시 전 담당자가 원문 규정과 플랫폼 정책을 확인한다.
