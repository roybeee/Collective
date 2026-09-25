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
- 부정·배제 판정(`lib/graders/negation.ts`, 채점기와 가드레일이 같은 사전을 쓴다): 기본은 문장 전체가 아니라 대상 표현 바로 뒤 서술부(같은 절, 40자 안)만 본다. `않·말고·금지·제외·삭제·안 됩니다·안 합니다·피합니다·피해야·빼고·대신·불가·금물`은 절 안 어디에 있어도 부정이다. `아닌·아니라·없이·없습니다·없음`은 대상 바로 뒤 8자 안에 쉼표 없이 나올 때만 부정이다(예: "평범한 분식이 아닌 숯불 떡볶이"의 `아닌`은 숯불을 부정하지 않는다). `·`·`/`로 이은 나열은 한 대상으로 보고 나열 끝부터 서술부를 본다. 가운데 항목은 띄어 쓴 두 낱말까지 한 항목이다(`위장 후기·대량 홍보·추천 조작 없음`). `금지 표현: …`처럼 부정 라벨 뒤 나열도 부정이다. 연결 어미(`-고`·`-며`·`-지만`·`-되` 등, `안 되`는 제외. 뒤에 공백이나 쉼표: `알리며,`·`게시물이며,`. 쉼표 앞 `-고`는 동사 어간 뒤만 보고 `최초 입고,` 같은 명사 나열은 경계가 아니다)와 끝맺음 뒤 쉼표(`만든다,`·`보세요,`)가 절 경계다. 판정 전에 조건 주석 괄호(`(주류 제외)`, `(1인 1회, 중복 참여 금지)`)와 권유·강조 관용구(`잊지 말고`, `놓치지 마세요`, `어디에도 없습니다`)를 지운다. `(진행 금지)`처럼 괄호 전체가 앞 행위의 부정이면 남긴다.
  - 절 끝 부정(측정 v2): 대상이 속한 절(나열 끝부터 다음 절 경계까지. 따옴표 안의 연결 어미 "싸고 맛있는"은 경계가 아니다)의 끝 서술부(끝 문장부호·닫는 따옴표·끝 괄호 주석을 벗긴 끝 24자)가 대상 명사구에 대한 표현 사용의 부정·금지(`쓰지 않는다`·`사용하지 않는다`·`넣지 않는다`·`표기하지 않는다`·`금지`·`사용 보류`·`빼고`·`피한다` 등)면 대상과의 거리와 무관하게 부정이다. 40자 창을 넘는 긴 금지 목록("현재 확정된 가격·인기·판매 1위·…·효능 표현은 쓰지 않는다")을 위해서다. 단독 `보류`·`삭제`·`제외`는 대상 뒤 40자 안이고 그 사이에 따옴표 나열이 아닌 쉼표가 없을 때만 대상의 것이다("협찬 게시물은 표시 기준이 정해질 때까지 보류한다"는 부정, "헤드라인은 ‘지금 구매하세요’, 서브 문구는 보류한다"는 부정이 아니다). 표현 사용과 무관한 부정("할인 쿠폰을 발행하지 않습니다")과 `없음`·`아니다`는 먼 대상을 부정하지 않는다("효과, 부작용이 없습니다"는 효능 주장으로 남는다).
  - 주제어 확인(측정 v2 리뷰 반영): 절 끝 부정은 대상 명사구의 것이어야 한다. 대상 뒤 첫 은/는/을/를 낱말(대상 명사구의 머리: `표현은`·`문구는`·`게시물을`) 다음에 새 주제어(명사+은/는)가 나오면 절 끝 부정은 그 주제어의 것이라 대상을 면제하지 않는다("“판매 1위 떡볶이”를 … 보여 주는 15초 영상에서 가격은 쓰지 않는다", "체험단 모집 게시물을 올리는 계획, 유료 광고 집행은 보류"는 위반으로 남는다). 부사어(`에는`·`에서는`·`까지는`·`전에는`·`때는`·`(으)로는`·`지금은`), 관형형(`있는`·`하는`·`되는`·`같은`·`주는`), 따옴표 안 낱말, `쓰지는 않는다`의 `쓰지는`은 주제어가 아니다. `…는`·`…던` 낱말 바로 뒤의 조사 붙은 낱말은 대상이 든 관형절이 꾸미는 머리다("순위를 암시하는 표현은", "메뉴라는 표현은", "평점을 높이는 방식은 … 쓰지 않는다"는 부정). 대상 명사구의 머리가 주제어로 절 안에 있으면, 절 서술부가 사용·부정 서술이 아니고 다음 절에 새 주제어가 없는 동안(최대 3절) 주제어가 이어진다("판매 1위 표현은 자료가 오면 검토하되, 지금은 헤드라인에 쓰지 않는다"는 부정).
  - 인용 사용(측정 v2): 따옴표 안 대상의 닫는 따옴표 바로 뒤가 사용 서술(`처럼 쓴다`·`로 쓰되`·`를 사용한다`·`로 적는다` 등)이면 문장 뒤쪽에 다른 부정이 있어도 부정이 아니다("헤드라인은 “가장 인기 있는 …”처럼 쓰고, 할인 표현은 쓰지 않는다"는 사용). `쓰지 않는다`, 관형형(`처럼 쓰는 표현은 금지`), `는·도`가 붙은 형태(`처럼 써서는 안 된다`·`로 사용해서는 안 됩니다`·`처럼 써도 되는지는`)는 사용 서술이 아니다(뒤 부정 판정에 맡긴다).
  - 실패·중단 판정 칸(`실패 기준`·`중단 조건`·`위반 사례` 등)도 금지 맥락 라벨이다. 규제 가드레일은 표에서 이런 머리칸 아래 칸을 비우고 검사한다(다른 열은 그대로). 부정 판별의 표현 사용 동사에는 추천·보증 행위(제안하·권하·만들·요청하·작성하·게시하·올리·유도하)도 들어간다('직원·지인 후기 작성 요청은 제안하지 않습니다'는 부정).
  - 금지 맥락 라벨(`prohibitiveLabel`, 측정 v2): 라벨·제목·표 머리칸을 가운뎃점·빗금·쉼표·`및`·`또는`·`과/와`로 나눈 항목이 모두 금지 항목이거나 보조 항목(이유·사유·근거·기준·목록·예시·처리·조치·조건·대안)이고 금지 항목이 하나 이상이면 그 구역 전체가 규칙 목록이다(`금지 또는 보류 표현`, `사용하지 않을 표현`). 금지 항목은 금지·보류 서술로 끝나는 항목이다(`금지`·`보류`·`삭제`·`제외`·`피할`·`쓰지/넣지/하지 않을` 뒤에 `표현`·`문구`·`항목`·`사항`·`것` 등만 올 수 있다). 금지어가 들어 있기만 한 항목(`보류 해제 후 실행`, `보류 없이 바로 진행`, `삭제 요청 대응 뒤 게시할 후기 이벤트`, `할인 제외 상품 홍보 문안`, `보류 여부`, `보류 사유`)은 금지 항목이 아니고, `대체 문구`·`대체 카피`는 실제로 쓸 카피라 보조 항목이 아니다. 괄호는 금지·보류 한 낱말(`(사용 금지)`, `(보류)`)일 때만 라벨의 일부로 보고 그 밖(`(보류 해제)`, `(근거 없는 표현 삭제)`)은 뺀다. 다른 항목과 섞이면(`채널 역할·…·금지 표현`, `추천안·나머지 안 보류 이유`, `선택/제외`) 금지 맥락이 아니다.
- 라벨(구역 이름): 제목 줄, 또는 `**`·`__` 강조와 끝 콜론을 벗긴 뒤 문장부호 없는 30자 이하 짧은 줄(`**게시 카피**`, `게시 카피:`)이다. `라벨: 본문` 인라인 줄(`- 게시 카피: …`, `**카피 A:** …`)은 그 줄에만 라벨을 붙이고 둘러싼 라벨과 함께 본다.

## 실패 유형 정의표 (v1 결정론 13종 + G3 회의·브리프 6종)

| ID | 정의 | 판정 규칙(fail) | not_applicable |
|---|---|---|---|
| `question_only` | 담당 산출물 대신 작업 지정 요청·번호 선택지·"알려 주시면 작성하겠다" 보류를 반환 | `substanceProblem(text,min)==='reask'`(`lib/role-output.ts` 재사용, 섹션마다 `isQuestionOnly`·선택지·보류 패턴을 적용하고 재질문 섹션이 과반이거나 나머지 본문이 min 미만이면 reask). `isQuestionOnly`를 본문 전체에 단독 적용하지 않는다("고객 요청이 많은 메뉴 데이터는 아직 없습니다" 한 문장으로 fail이 되어 내용 채점기까지 가렸다). min은 역할 250자, 회의 발언 80자(`DISCUSSION_MIN_CHARS`). 회의 발언은 필드마다 `## 필드명` 제목을 붙여 검사한다(`meetings.ts` fieldText와 같음). 원 JSON은 계약 제목으로 렌더해 섹션별로 검사한다 | 입력, quality 판정 |
| `thin_section` | 계약 섹션이나 전체 본문에 실제 초안이 없음 | (a) 제목·표 구분선·`자료 필요`로 **시작하는** 줄을 뺀 전체 글자 수 < 250(발언 80), (b) 계약 섹션(렌더본의 계약 제목 사이, 하위 `###` 포함) 글자 수 < 150, (c) 섹션 과반이 `자료 필요`로 시작하는 줄만 있음. PR 2의 "자료 필요가 들어간 줄 80% 초과" 비율 규칙은 쓰지 않는다(한 줄 섹션의 인라인 `[자료 필요]` 태그를 오탐함) | 입력, `question_only` fail. 계약 없는 본문은 (a)(c)만 |
| `contract_json` | 역할 계약(role-output-v1)·회의 발언 스키마 위반 | 역할: 원 JSON에 `parseRoleOutput(raw,role,contract)`가 예외를 던짐. 원 JSON이 없으면 렌더본에 계약 제목이 순서대로 정확히 1회씩 `## 제목`으로 있어야 한다(약식). 회의 발언: `parseMeetingStep`이 4필드 누락·`respondsTo` 형식 오류·앞선 완료 발언이 있는데 허용 참조 0개를 보고함. 실질 분량 오류는 이 채점기가 아니라 위 두 채점기가 맡는다 | 계약 이전(legacy) 실행, quality, 입력 |
| `heading_nesting` | 계약 섹션 본문이 `#`·`##` 제목을 다시 써서 섹션 경계가 깨짐 | 계약 렌더본에서 `^#{1,2}\s` 줄이 계약 제목·`수정 요청 반영 위치`가 아님, 또는 계약 제목 바로 다음 비어 있지 않은 줄이 `#`·`##` 제목(빈 계약 섹션). legacy 역할 본문은 내보내기가 `## 역할명`으로 감싸므로 본문의 `#`·`##` 제목이 곧 fail. `###` 이하는 허용. 원 JSON은 사람이 보는 정규화 렌더본(계약 본문 `#`·`##` → `###`, `lib/output-normalize.ts`)을 채점하므로 이 판정은 보통 pass다. 지시문 예방 여부는 정규화 전 렌더본 판정(`prevention`)으로 본다(아래 '정규화와 예방 판정') | 입력, 브리프, 회의 발언, quality |
| `internal_id_exposure` | 사람이 읽는 본문에 내부 ID·입력 스키마 경로·디버그 값 노출 | URL을 뺀 산문에서 (a) `scrubInternalIds(text)!==text`(UUID·`meeting-` UUID·`ai-` 32자리·revision 번호), (b) 스키마 경로 `(campaign\|brandArchive\|archive\|evidence\|artifact(s)\|stores\|products\|operations\|budgetPlan\|learning\|snapshot).필드`, (c) 디버그 값 `소문자키=([]\|null\|true\|false\|숫자\|hex)`. `respondsTo`·`role` 같은 코드 필드는 제외. (b)가 없으면 스키마 경로만 노출한 발언을 놓친다. 원 JSON은 정규화 렌더본(알려진 스키마 경로 → 한국어 라벨)을 채점하므로 알려진 경로는 여기서 pass가 된다. 지시문 예방 여부는 `prevention`으로 본다(아래 '정규화와 예방 판정') | 입력 |
| `brief_prohibition_conflict` | 브리프·안건이 막은 표현이 가설·실험 변수·카피에 다시 나옴 | 금지 표현 = 케이스의 큐레이션 `prohibitedTerms` ∪ 원장 거절값(`claimGuard(facts).prohibited`). 대상 구역 = 제목·라벨(인라인 라벨 포함)에 가설·실험·카피·문안·메시지·대본·자막·슬로건·헤드라인이 있는 블록, `가설 N`·`실험 N`으로 시작하는 문장, 회의 발언 position·proposal. 구역 안 문장(표는 칸 단위)에 금지 표현이 있고 그 표현 바로 뒤 서술부가 부정·배제가 아니면(위 공통 규칙) fail. `[확인 필요]`는 면제 사유가 아니다(claimPolicy). 라벨에 부정어가 있는 블록(예: "사용하지 않을 표현")은 제외 | 금지 표현 0개, 입력, `question_only` fail |
| `fact_conflict` | 확정 원장과 다른 값, 거절값 사용(원장 대조) | 원장에 있는 항목만 대조한다. (a) 확정 주소와 본문 주소(공백 제거 비교)가 다름, (b) 원장에 확정값이 있는 가격·오픈일·도보 시간·유동인구의 본문 값이 원장 값 목록에 없음(가격은 `N,NNN원`·`N만 원`을 원 단위로, 오픈일은 월-일로 정규화해 비교), (c) 거절값이 부정·배제 없이 쓰임. `[확인 필요]`·`[예시]` 표시 문장은 대조하지 않는다. 예산·비용·한도·객단가·매출·목표·광고비·수수료 등이 있는 문장의 금액은 판매가로 보지 않는다 | 원장 없음, 원장에 있는 항목을 본문이 하나도 다루지 않음(원장에 없는 항목의 값은 세지 않고 분모에서 뺀다), 입력, `question_only` fail |
| `unconfirmed_value_assertion` | 원장이 확정하지 않은 구체 값을 표시 없이 단정(factPolicy "원장에 없는 가격·개점일은 미확정으로 표시") | 원장에 확정값이 없는 종류(가격·오픈일·도보 시간·유동인구 수치)의 값이 `[확인 필요]`·`[예시]`·`미확정`·`자료 필요` 표시 없이 나옴. 가격 판정은 `fact_conflict`와 같이 예산·비용·매출 목표 문장을 뺀다 | 원장 없음, 미확정 종류의 구체 값이 본문에 없음, 입력, `question_only` fail |
| `unsupported_claim_term` | 근거 없는 광고 표현(인기·판매 1위·최초·유일·할인·무료·오픈 혜택)이 카피에 쓰임 | `claimGuard(facts).unverified` 용어가 카피 구역 문장(라벨이 카피·문안·메시지 초안·대본·자막·헤드라인·슬로건·CTA인 블록) 또는 따옴표 안 문구(6자 이상. 회의 발언은 따옴표 문구만)에 `확인 필요` 없는 문장으로 나오고 부정·배제가 아님(위 공통 규칙). 따옴표 안 문구도 그 문장 전체로 부정을 본다: "“가장 인기 있는 …” 같은 문구는 … 쓰지 않는다"는 사용이 아니고 "“…”처럼 쓴다"는 사용이다. 금지 맥락(공통 규칙의 금지 맥락 라벨)은 대상에서 뺀다: 그런 제목 아래(다음 같은 수준 이상 제목 전까지), 라벨·인라인 라벨이 금지 맥락인 블록, 머리칸에 금지 맥락 칸(`금지 표현`, 사유 칸 `보류 사유`·`제외 이유` 포함)이 있는 표(나머지 머리칸이 모두 분류·보조 칸 — 유형·구분·분류·항목·범주·이유·사유·근거·조치·처리·기준·예시·비고·표현·번호 — 이면 표 전체, 아니면 금지 칸만 비우고 나머지 칸은 채점: `| 안 | 문구 | 보류 사유 |`, `| 채널 | 내용 | 금지 |`의 카피는 채점한다). 규칙 목록 문장·표는 카피 사용이 아니기 때문이다(품질 재평가 실측 오탐, 측정 v2). PR 2 `unverifiedClaims`(줄 단위·좁은 부정어)는 절차 문장을 오탐해 그대로 쓰지 않는다 | 입력, `question_only` fail(카피 구역이 없으면 pass) |
| `industry_metric_leak` | 캠페인과 무관한 업종의 지표·용어 유입 | 캠페인 업종이 아닌 업종 사전 용어가 배제 표현(무관·삭제·제외·해당 없·관련 없) 없는 문장에 나옴. 업종은 문자열 하나 또는 배열(주 업종+허용 업종, G3)이고 사전은 `lib/graders/industry.ts`: 보관함(물품보관함·보관함·락커·locker·가동 가능 시간·가동률), K-POP(포토카드·초동·팬사인회·앨범 판매), 뷰티(피부 개선·보습 효과·성분 함량), G3 추가 fnb(음식점·카페·베이커리)·education(학원·교육)·popup(팝업·이벤트)·retail(오프라인 소매). 업종 간 공용 용어(`COMMON_TERMS`: 가격·배송·메뉴·포장·재고·진열·상담 등)는 어느 사전에도 걸리지 않는다 | 업종 미상(`context.industry` 없음), 입력, `question_only` fail |
| `revisit_cohort_definition` | 30일 재방문율을 관찰이 끝난 코호트로 정의하지 않음 | 재방문율·재구매율 정의 문장에 성숙 기준(관찰이 끝난·마친·완료, 성숙, 코호트)이 없음. 정의 문장: `재방문율 =`, `재방문율: … / …`(콜론 뒤 빗금·`÷`·나눈·비율·비중·대비), `÷`, `나눈`·`나누어`·`나눠`, `…수 / …수`, `비율로(을) 정의`, `재방문율은(는·이란·:) … 고객(손님·구매자·방문자·회원·수)의 비율·비중`, `재방문율은 … 수로 계산(산출·정의)한다`, 또는 `재방문율` 단독 줄 다음 줄이 `=`. `재방문율은`만으로는 정의가 아니다(측정 v2). 재방문율·재구매율이 든 절(쉼표·연결 어미 전)의 서술부가 `아니다`·`계산하지 않는다`·`측정 보류` 같은 문장("30일 재방문율은 이번 결과의 주 KPI가 아니다", "…재방문율은 계산하지 않습니다")은 `÷`가 있어도 정의가 아니다. 뒤 절의 단서("…첫 방문 고객이며, 쿠폰 고객은 제외한다")는 정의를 지우지 않는다 | 정의 문장 없음, 입력, `question_only` fail |
| `local_channel_coverage` | F&B·점포 캠페인 CMO·strategy가 로컬 핵심 채널 후보를 다루지 않음 | 플레이스(네이버 지도·플레이스)·당근·배달앱(배민·쿠팡이츠·요기요·배달 플랫폼)·카카오 4개 채널군이 각각 채널 구역(라벨·줄에 "채널") 또는 결정 표현(선택·제외·보류·후순위·채택·쓰지 않·다루지 않)이 있는 줄에 나와야 한다. `자료 필요`로 시작하는 줄과 `=`로 시작하는 산식 줄은 세지 않는다. 4/4 미만이면 fail | `context.localStore`가 아님, cmo·strategy 외 역할, 회의 발언, `question_only` fail |
| `input_budget` | 역할·회의 호출 입력 토큰이 절대 상한 초과 | 사용량 원장 `inputTokens > INPUT_TOKEN_CAP`. 제안값 32,000(대표 결정 사항, `context.inputTokenCap`으로 바꾼다) | 토큰 미확인, 브리프 초안·조사 호출(포함 여부 결정 전) |
| `meeting_step_contract` (G3) | 회의 합의·품질 재검토 단계의 필수 필드·형식 위반 | `parseMeetingStep`이 거부하거나, 실무 스킬 회의(contract)에서 재검토의 5개 기준 판정(checks)·합의 과제별 판정(taskChecks)이 빠짐 | 발언·개선본·역할·브리프 |
| `revision_repeat` (G3) | 개선본이 원본을 거의 그대로 반복 | 공백·문장부호를 뺀 3글자 조각의 자카드 유사도 ≥ 0.9(약 5% 미만 수정). pass에도 유사도를 기록 | 개선본이 아닌 단계, 원본·개선본 본문 없음 |
| `seeded_defect_detection` (G3) | 평가 케이스에 일부러 심은 결함을 재검토가 지적하지 못하거나 개선본이 그대로 남김 | `expectations.seededDefects[{id,role,marker,keywords}]`. 재검토는 marker·keywords 언급이면 지적, 개선본은 같은 역할 marker를 부정 없이 다시 쓰면 미수정. 잘못된 항목은 `grader_error` | 케이스에 `seededDefects` 없음 |
| `brief_contract` (G3) | 브리프 초안 형식 위반(앱이 조용히 버리는 것 포함) | `parseBrief` 거부, 질문 3개 초과, 허용 밖·중복 제안 키, 사실 후보 10개 초과 | 브리프가 아닌 항목, 원 JSON 없음 |
| `brief_instruction_violation` (G3) | 브리프 지시 위반 | 보호 항목 제안, 사용자 입력(`ctx.briefInput`)·확정 원장에 없는 가격·날짜 단정, 금지 표현(`prohibitedTerms` ∪ 원장 거절값)의 부정 없는 사용. 대상은 요약·제안 값 | 브리프가 아닌 항목 |
| `brand_intro_as_fact` (G3) | 미확인 브랜드 소개를 '확인 사실' 구역에 적음 | 확인·확정·검증된 사실 라벨 구역(미확인·후보·가정·가설 제외, 첫 칸이 그 라벨인 표 행 포함)의 문장이 소개문과 8자 이상 일치하고 확정 사실 값·브랜드 이름 밖이며 `[확인 필요]`·미확인 표시가 없음. 바꿔 쓴 소개문은 잡지 못한다 | 소개문 없음, role·meeting_step·brief가 아닌 항목 |

### 정규화와 예방 판정 (`failure-types-v1+normalized`)

결론: 원 JSON(`raw`) 채점은 사람이 보는 정규화 렌더본을 채점하고, 정규화가 가릴 수 있는 두 결함은 정규화 전 판정을 따로 남긴다. 정규화로 가린 결함은 예방된 것이 아니기 때문이다.

- 채점 버전: `GRADERS_VERSION='failure-types-v1+normalized+measure-v2+g3'`(`lib/graders/index.ts`). `+g3`는 기존 13종 결과는 그대로 두고 회의·브리프 채점기 6종(`KIND_GRADERS`, 적용 종류 밖이면 not_applicable)과 업종 사전 확장을 더했다. 사전 확장 때문에 업종이 지정된 케이스의 `industry_metric_leak` 결과가 바뀔 수 있어 버전을 올렸다. `failure-types-v1`은 정규화 전 렌더본을 채점했다(품질 기준선 v1). `failure-types-v1+normalized`는 품질 수정 v1(#80)부터 측정 v2 전까지의 채점이다(품질 수정 v1 뒤 재평가). `+measure-v2`는 13종은 같고 부정·규칙 문장 판정과 `unsupported_claim_term`·`revisit_cohort_definition` 판정을 고친 측정 도구 v2다. 판정을 바꾸면 이 값을 올린다(같은 저울 재채점의 버전 검사가 이 값에 기댄다). 서버 평가 결과(`eval_run.results[]`)에 `gradersVersion`을 남기며, 이 값이 없는 결과는 `failure-types-v1`이다.
- 정규화(`lib/output-normalize.ts`, 저장·평가 렌더 공통): 알려진 입력 스키마 경로 → 화면 이름 라벨(브리프 필드 이름, 확정 사실·후보 사실·거절된 사실·상시 지시·사실 원장), 계약 섹션 본문의 `#`·`##` 제목 → `###`. 품질 검수 JSON은 문자열 값마다 풀어서 경로만 바꾼다.
- `prevention`: 원 JSON을 정규화 전 렌더본으로 다시 만들어 `heading_nesting`·`internal_id_exposure`만 돌린 판정(`runPreventionGraders`). 정규화는 두 채점기가 잡는 것만 바꾸므로, 정규화가 바꾼 건이 있으면 채점기가 원문에서 못 보는 경우(품질 JSON의 `\n` 이스케이프 바로 뒤 경로 등)도 fail이다. 저장 본문(`text`) 항목은 원문이 없어 빈 목록이다.
- `normalization`: 정규화가 바꾼 스키마 경로·제목 건수(값 없음). 운영 역할 작업물에도 0이 아니면 `outputNormalization`으로 남는다. 온라인 채점은 저장 본문(정규화 뒤)을 채점하므로 운영 예방 비율은 이 건수가 0인 작업물의 비율로 본다.
- 비교(`compareRuns`): `graders`는 사람이 보는 본문 기준, `prevention`은 모델 원문 기준(결과에 `prevention`이 있으면 그 판정, 없으면 `graders` — v1 결과의 `graders`는 곧 정규화 전 판정)이다. 기준선 v1과 재평가를 비교할 때 지시문 예방 효과는 `prevention`으로 읽는다. `graders`의 두 채점기 개선(c)에는 정규화 효과가 섞여 있다. `gradersVersions`·`normalization`(run별 기록 건수·정규화된 산출물 수·건수 합계)도 함께 낸다.
- 쌍 평가 게이트(F3b)는 프롬프트를 재므로 두 쪽 모두 모델 원문 기준 판정으로 합격 수·봉인 회귀를 센다. 후보 프롬프트가 일으킨 경로 노출·제목 중첩을 저장 정규화가 가려도 회귀로 잡는다.

### 결정론 불가 유형 (v1 채점기 제외, 정의만)

| ID | 정의 | 제외 이유와 대체 |
|---|---|---|
| `meeting_conformity` | 회의 발언이 앞 발언에 동조만 하고 실질 반박이 없음 | 동의 뒤 반박의 실질 여부는 판단이 필요하다. "동의합니다"로 시작하는 비율만 지표로 기록한다 |
| `causal_overreach` | 자료 없이 특정 장벽을 "최대 병목"으로 단정 | 단정과 가설 표현의 경계 판단이 필요하다. 사람 라벨(B2) 대상 |
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

`checkCompliance(text,{facts})`가 문장 단위로 8개 범주를 점검하고 `{version,issues,notice}`를 반환한다. 현재 사전은 `compliance-lexicon-2026-09-25.1`(측정 v2)이다. 품질 기준선 v1과 품질 수정 v1 뒤 재평가는 이전 사전 `compliance-lexicon-2026-09-23.2`로 채점했다. 사전·판정이 바뀐 뒤 이전 run과 비교하려면 두 run을 모두 재채점한다([같은 저울 재채점](#6-같은-저울-재채점regrade_run)). 어휘 사전(`lib/graders/compliance-lexicon.ts`)은 버전(`compliance-lexicon-YYYY-MM-DD.N`)과 공식 출처 URL(국가법령정보센터)을 가진다. 판정 로직과 사전을 나눠 사전만 개정할 수 있다.

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
- 부정·배제: 걸린 표현 바로 뒤 서술부가 부정·배제면("가짜 리뷰는 쓰지 않습니다", "리뷰 이벤트 없이 진행합니다", "리뷰 이벤트를 하면 안 됩니다") 위반으로 보지 않는다. 채점기와 같은 사전·범위 규칙(위 공통 규칙)을 쓴다. 판촉 문구의 조건 주석(`(주류 제외)`, `(중복 참여 금지)`)과 `잊지 말고` 같은 권유형 어미는 면제 사유가 아니다. `없습니다`는 대상 바로 뒤에서만 부정이라 "당뇨 개선 효과, 부작용이 없습니다"는 효능 주장으로 남는다. 측정 v2부터 부정 나열("위장 후기·대량 홍보·추천 조작 없음")과 절 끝 `보류`·`삭제`(대상 뒤 40자 안, 새 주제어·쉼표 없이)도 공통 규칙(공용 부정 판별)으로 면제한다. 뒤 절의 다른 대상 보류("가짜 후기 3건을 올려 초기 평점을 만든다, 이벤트는 보류", "체험단 모집 게시물을 올리는 계획, 유료 광고 집행은 보류")는 앞 위반을 면제하지 않는다.
- 중단 조건(측정 v2, 추천·보증 범주만): 걸린 표현이 든 절이 표기 누락을 조건으로 적고, 그 조건으로 문장이 끝나거나("광고·협찬 콘텐츠에 필요한 표시가 누락될 때.") 뒤따르는 결과가 시정 조치(내린다·중단·수정·보완·삭제·보류·교체·표기를 넣는다·게시하지 않는다 등, "협찬 게시물에 광고 표기가 빠지면 즉시 게시를 내린다")인 문장은 위반 문안이 아니다. 결과가 게시·효과 서술이면 면제하지 않는다("광고 표기가 없는 경우 협찬 게시물을 올린다", "체험단 게시물은 광고 표시가 없으면 반응이 더 좋으니 표시 없이 올립니다"). 절 단위로만 본다. "직원이 후기를 작성해 올리고 광고 표시가 누락될 때 수정한다"의 앞 절(가짜 후기)은 면제하지 않는다.
- 범위: `cleared`(표기·동의·권리 확인 등 해소 표현)는 걸린 문장이 속한 단락, 곧 렌더본의 `##` 섹션(`#`·`##` 제목과 구분선 `---` 사이) 안을 `###`~`######` 소제목으로 나눈 초안 단위에서 찾는다. 한 초안의 `(광고)`·`#광고`가 같은 문서의 다른 초안 누락을 덮지 않는다. 다만 표기를 서술한 문장은 같은 `##` 섹션의 다른 소제목 단락까지 해소한다(측정 v2). 표기 서술 문장은 해소 표현 바로 뒤에 `표기`·`표시`·`태그`나 `을/를 + 표시 동사`(표시·표기·넣·붙·달·명시·밝·고지·포함)가 오거나("(광고) 표기를 넣는다", "#광고를 붙인다"), 따옴표가 해소 표현만 감싸고 문장에 표시 동사가 있거나("협찬·체험단을 사용할 경우 해당 문안에 ‘#광고’를 표시한다"), 표현 자체가 표시 서술인("광고 표기를 넣는다") 문장이다. 부정·생략한 표기("‘#광고’를 표시하지 않는다", "‘#광고’ 표기는 생략한다", "#광고 태그는 붙이지 않는다")는 표기 서술이 아니다. 따옴표 초안에 붙인 표기("“오늘 새로 입고된 앨범을 소개합니다 #광고”", "“#광고 오늘 …”")와 초안 본문의 표기·가격("소정의 원고료를 받아 작성한 글입니다", "떡볶이 세트 12,000원과 음료")은 그 소제목 단락만 해소한다. 역할 지시가 계약 섹션 안에 `###` 소제목을 쓰게 하면서, 같은 계약 섹션의 표기 규칙 소제목이 게시 계획 소제목을 해소하지 못하던 오탐을 고친 것이다. 이 해소는 `##` 제목·구분선을 넘지 않는다. 광고 메시지 규칙의 판촉어(`context`)는 같은 문장에서 찾고, 걸린 표현이 초안 라벨(`문자 초안:`, `## 알림톡 발송 문안 B`)이면 뒤따르는 문단까지 본다. "발송 대신 매장 안내문", "수신 동의 고객이 생긴 뒤에 검토합니다" 같은 비전송·보류 문장은 면제한다(`except`).
- 체험단·대량 리뷰(`bulk_review`)는 `리뷰 N건`에 모집·확보·작업·구매·대행이 함께 있을 때만 걸고, 체험단·모집 등이 없는 KPI·목표·측정 문장("방문자 리뷰 30건을 목표로")은 면제한다. 구매 유도 문구 규칙은 버튼 클릭 수 같은 측정 문장을 면제한다.
- 매체 광고 면제(측정 v2, `sponsorship_undisclosed`): `유료 광고` 앞뒤 30자 안에 매체 광고비 집행 문맥(`집행`·`예산`·`입찰`·`매체`·`광고 세트`·`광고 관리자`·`캠페인 운영`·`CPC`·`CPM`·`ROAS`·`타기팅`·`부스팅`·`검색 광고`·`파워링크` 등)이 있으면 협찬 표기 대상이 아니다. 매체에 돈을 내고 거는 광고는 광고 자체라, 추천·보증 심사지침의 경제적 이해관계 표시(협찬·후기 게시물) 대상과 다르다. 광고 운영 동사(`돌린다`·`운영`·`게재`·`검토`·`세팅`·`노출`)도 매체 문맥이다("둘째 주부터 유료 광고를 돌린다"). 같은 범위에 게시자 문맥(`인플루언서`·`크리에이터`·`블로거`·`유튜버`·`체험단`·`리뷰어`·`서포터즈`·`원고` 등)이 있으면 그대로 본다("인플루언서 유료 광고 게시물을 예산 50만 원으로 올린다", "인플루언서와 함께 유료 광고를 돌린다"는 위반 후보). 게시물을 가리키는 합성어(`유료 광고 게시물`·`게시글`·`포스팅`·`포스트`·`후기`·`리뷰`·`원고`)는 집행·예산 문맥이어도 대상이다("유료 광고 포스팅을 월 예산 안에서 3건 올린다"). `협찬`·`체험단`·`유료 게시`·`유료 포스팅`은 집행 문맥이어도 계속 본다("협찬 게시물 3건을 광고 세트로 부스팅한다").
- 구매 유도 문구 보류 면제(측정 v2, `price_missing`·`terms_missing`의 `held`): 걸린 구매 유도 문구가 든 절(쉼표·연결 어미·줄표 사이)에서 그 문구 자체를 보류·미사용하거나(`보류`, `보류 없이`는 제외, `미사용`, `사용 여부 … 결정`), 가격·조건 `확정`·`확인` 뒤에 넣는다·추가한다·바꾼다·전환한다는 계획(문구 뒤 또는 조건이 앞: "가격 확정 후 CTA를 구매하기로 전환한다", "(구매하기는 가격 확정 후)"), 그 문구를 `확인 계획에` 적는다는 문장은 구매 유도 문구가 아니다("구매하기·주문하기 CTA는 보류하고 상품 보기 CTA만 쓴다", "바로 구매 버튼은 가격 확정 후 추가"). 같은 문장의 다른 문구·버튼 보류는 면제 사유가 아니다("헤드라인은 ‘지금 구매하세요’, 서브 문구는 보류한다", "장바구니 담기 CTA를 쓰고 할인 문구는 보류한다", "카피 A: 지금 주문하기 — 쿠폰 문구는 확인 계획에 적는다"). 실제 구매 문구("지금 구매하세요!", "‘주문하기’ 버튼 문안: 지금 주문하기")는 가격·판매 조건 warn이 그대로 남는다.
- 인용: 경쟁점·위반 사례(`사례`, `위반 소지`, `경쟁점`) 문장에서 따옴표 안에 걸린 표현은 `info`로만 남는다. 같은 규칙에 인용 밖 해당 문장이 있으면 그 문장의 원래 등급으로 보고한다.
- 제목이 `금지 사항`·`하지 않을 것`·`피할 표현`인 단락, 제목 전체가 금지·보류 목록인 단락(공통 규칙의 금지 맥락 라벨, 예: `### 금지 또는 보류 표현`)의 목록은 위반 문안으로 보지 않는다.
- 모델 검수 스키마(`qualityCriteria` 5기준)와 `qualityScopeNotice`는 바꾸지 않는다. 런타임 연결에서 가드레일 결과는 작업물의 `complianceHold`라는 별도 필드로만 저장한다(기능 스위치 `a2_downgrade`로 끈다).
- 한계: 플랫폼별 리뷰 운영정책의 공식 URL은 아직 확인하지 않았다(`COMPLIANCE_LEXICON.platformPolicy`). 법령 조항 해석은 사람이 확인한다. 합성 예시의 탐지율·오탐률은 `tests/compliance.test.mjs` 출력(`violations`, `detected`, `falsePositives`)에 남는다. 쉼표 뒤 다른 대상의 부정("음료 증정, 주류는 안 됩니다")은 대상 뒤 40자 안의 `않·금지·안 됩니다` 같은 부정어가 주제어를 보지 않아 면제될 수 있다(미탐 위험, "가장 인기 있는 K-POP 음반, 할인 표현은 쓰지 않는다"도 같다). 나열 목록("숯불, 화덕은 쓰지 않습니다")을 부정으로 인정하려고 명사 뒤 쉼표는 절 경계로 쓰지 않았다. 측정 v2의 주제어 확인은 낱말 끝 조사로만 판단한다: `…는` 관형형을 모두 알지 못해 관형절 머리가 아닌 `…는` 낱말을 새 주제어로 볼 수 있고(규칙 문장 오탐 방향), 조건부 사용 문장("…근거 자료를 확인한 뒤에만 쓰고, 그 전에는 쓰지 않는다")은 앞 절이 사용 서술이라 fail로 남는다. 매체 광고 면제는 앞뒤 30자 안의 낱말로만 판정해 게시자 문맥이 그보다 멀면 면제된다. 표기 서술 문장은 같은 `##` 섹션의 다른 소제목 단락을 대상 구분 없이 해소한다("협찬 게시물에는 ‘#광고’를 붙인다"가 같은 섹션의 체험단 게시물도 해소).

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
- 단일 원천: F1b-1(#35)부터 `lib/role-execution.ts`가 이 모듈을 직접 호출하므로 역할 지시·입력 조립은 `lib/role-instruction.ts` 한 곳에만 있다. `tests/role-execution-drift.test.mjs`는 실제 실행 경로(모의 런타임)의 제출 본문이 순수 함수 출력과 같은지 확인한다. 순수 함수 자체의 변경은 스냅샷 `role-submission-f7b6ee4.json`(품질 수정 v1, `PRACTICE_VERSION` 2026-09-25.1에서 재캡처. 같은 커밋에서 `prompt-baseline-f7b6ee4.json`도 재캡처. 16케이스: 8역할, 재질문 뒤 재작성, 검토 메모 보완, 이전 회의 결정, 앞선 작업물 발췌 잘림, quality 재작성)이 잡는다.
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
9. 채점 버전이 다른 run을 비교하면(`gradersVersions`) `heading_nesting`·`internal_id_exposure`의 지시문 예방 효과는 `prevention`(모델 원문 기준) 비교로만 주장한다. `graders` 쪽 두 채점기의 개선에는 저장 정규화 효과가 섞여 있어 예방 개선으로 쓰지 않는다.
10. 같은 저울 원칙: 채점기나 규제 사전이 바뀐 뒤에는 이전 run의 원래 결과와 새 run을 비교하지 않는다. 두 run을 모두 지금 코드로 재채점(`regrade_run`)하고 `GET /api/eval?compare=<기준 run>,<비교 run>&regrade=1`로 비교한다([같은 저울 재채점](#6-같은-저울-재채점regrade_run)). 측정 도구의 변화가 모델·프롬프트의 변화로 읽히지 않게 하려는 것이다.

## 서버 평가 실행 (F1b-2)

결론: 골든셋 케이스를 D1 `eval_case`에 동결하고, 평가 전용 HERMES 프로필에 백그라운드로 하나씩 보내 서버가 같은 채점기로 채점한다. 예산(결정 5)과 운영 격리(결정 6)를 코드가 막는다.

비유: 시험 문제지(케이스)를 봉투에 봉인해 두고, 연습실(평가 전용 프로필)에서만 풀게 한다. 한 번에 쓸 수 있는 종이(토큰)는 정해져 있고, 다 쓰면 남은 문제는 풀지 않은 것으로 적는다.

- 코드: `lib/eval-server.ts`(연결·케이스·실행), `lib/eval-kinds.ts`(평가 종류별 동결 검사·제출 조립·채점·예약, 8절), `lib/eval-budget-server.ts`(월 승인, 7절), `lib/eval-stats.ts`(비교 통계), `app/api/eval/route.ts`, `lib/background-execution.ts`(`eval:<run id>` 작업), `lib/role-execution.ts`(`roleSources`·`roleRequestFor`로 요청 조립 DB 읽기를 추출, 동작 불변. `roleSubmission`은 운영 start와 평가가 함께 쓰는 제출 조립, 8절)
- 테스트: `tests/eval-server.test.mjs`, `tests/eval-stats.test.mjs`, `tests/eval-regrade.test.mjs`, `tests/eval-budget.test.mjs`, `tests/eval-kinds.test.mjs`(합성 데이터, 평가·운영 HERMES fetch 스텁, `passed · mocked`). 실제 HERMES 호출은 0회다.
- 권한: 읽기·쓰기 모두 워크스페이스 소유자만 한다(`requireOwnerActor`). 비로그인 401, 관리자·직원 403, 다른 소유자의 케이스·실행·출력은 404. POST 본문은 1,000,000바이트 한도(413, `lib/http-limits.ts` 방식)다.
- records kind: `eval_connection`, `eval_case`, `eval_run`, `eval_output`(부모 `eval_run`), `eval_budget_approval`(월 승인, 7절). 정책은 `lib/record-kinds.ts`에 있다.
- 운영 사용량 장부(`provider_usage`)에는 평가 토큰을 쓰지 않는다. 평가 토큰은 `eval_run.usedTokens`에만 있다. `delete_run`은 이 행을 지우지 않고 결과·출력만 비운다(아래 3절). 그래서 월 누적은 삭제로 줄지 않는다.
- 첫 실측 기준선: [품질 기준선 v1 — 2026-09-24](observations/2026-09-24-quality-baseline-v1.md)(운영 `df7e253` 코드, dev 11케이스, 평가 전용 프로필 `collective-eval`, real). 결함 0개 산출물 0/11, 적용 채점기 통과율 58/81(71.6%), 규제 block 3건.
- 품질 수정 v1 뒤 재평가: [품질 재평가 — 품질 수정 v1 뒤](observations/2026-09-24-quality-after-v1.md)(운영 `443fff4` 코드, 같은 케이스, real). 모델 원문의 내부 경로·제목 깊이 결함 0(정규화 건수 0, 예방 판정 fail 0), 결함 0개 산출물 MAPDAL 4/8. 남은 채점기 실패와 규제 block은 모두 측정 도구 오탐이라 측정 v2(부정·규칙 문장 판정, 사전 `compliance-lexicon-2026-09-25.1`)와 같은 저울 재채점(6절)을 더했다.

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
| `capture_case` | `campaignId`, `role`, `kind?`, `externalKey?`·`specHash?`, `set?`, `label?`, `expectations?` | 운영 역할 실행 start와 같은 DB 읽기(`roleSources`→`roleRequestFor`)로 요청 객체를 만들어 JSON 그대로 동결한다(운영자 선호 블록 `operatorPreferences` 포함). 실행 가능 여부 검사(진행 중 작업·앞선 담당 누락·현재 작업물 존재 409)는 적용하지 않아 끝난 캠페인에서도 캡처한다 |
| `save_case` | `role`, `request`, `kind?`, `externalKey?`·`specHash?`, `expectations?`, `set?`, `label?` | `request`는 운영 요청 구조(role·campaign·brand·archive·evidence·previous)여야 하고 현재 역할 제출 조립(`roleSubmission`, 운영 start와 같은 조립)이 받아야 한다. 선호 블록(`operatorPreferences`)은 있으면 `{note, rules:[]}` 형식이어야 한다. 900,000자를 넘으면 413 |
| `update_case` | `id`, `label?`, `set?`, `expectations?` | 요청(`request`)은 바꾸지 않는다. 세트 이동은 `setChanges`에 누가·언제 남긴다. 진행 중 run이 쓰는 케이스의 `expectations`·`set` 변경은 409(이름은 가능) |
| `delete_case` | `id` | 진행 중 run이 쓰는 케이스는 409 |

- `expectations`는 채점 컨텍스트다: `prohibitedTerms`(큐레이션 금지 표현), `facts`(`{confirmed,prohibited}`, 캡처 기본값은 요청의 확정·거절 사실), `industry`, `localStore`, `inputTokenCap`. 그 밖의 키는 저장하지 않는다. 케이스별 예약 토큰을 바꾸는 입력은 없다(예약은 종류의 값, 3절).
- `kind`(평가 종류, 8절): `role`|`meeting_step`|`brief`. 없으면 `role`이고, 이 필드가 없는 옛 케이스도 `role`로 읽어 이행이 필요 없다. `meeting_step`·`brief`는 G2에서 채울 자리라 지금은 저장하면 400(지원하지 않는 평가 종류)이다. 목록 밖 값도 400이다. 저장된 케이스의 종류를 실행할 수 없으면 `start_run`이 400이고 run을 기록하지 않는다.
- `externalKey`·`specHash`(생성기 멱등 키, G4 합성 생성기용): 둘을 함께 보낸다. 하나만 오거나 형식이 틀리면 400이다. `externalKey`는 영문·숫자로 시작하는 200자 이하(영문·숫자·`_ . : -`), `specHash`는 8~128자(영문·숫자·`_ : -`)다. 같은 소유자에게 같은 키·같은 해시 케이스가 있으면 새로 만들지 않고 그 케이스를 그대로 돌려준다(이름 등 다른 입력은 무시). 같은 키에 다른 해시가 오면 409이고 아무것도 바꾸지 않는다(동결 케이스는 덮어쓰지 않는다). 키는 소유자 범위이고, 케이스를 지우면 그 키도 다시 쓸 수 있다.
- `set`은 `dev`(기본) 또는 `sealed`. `capturedWith`에 캡처 시점 `PRACTICE_VERSION`·`ROLE_OUTPUT_VERSION`을 남겨 퇴역 판단에 쓴다.
- 캠페인을 삭제해도 `eval_case`는 남는다(`retain`, `data_campaign` 링크로 삭제 영향 조회의 보존 건수에 나온다). 동결 요청에는 캠페인·브랜드·앞선 작업물 원문이 들어 있으므로 필요 없어진 케이스는 소유자가 개별 삭제한다.
- 드리프트 방지: `tests/eval-server.test.mjs`가 캡처한 요청으로 만든 지시문·입력이 같은 캠페인의 운영 start 제출 본문과 바이트 동일한지 확인한다. 운영자 선호 규칙이 있는 캠페인은 `tests/eval-kinds.test.mjs`가 같은 확인을 한다(8절).

### 3. 실행(`eval_run`)

```json
{"action":"start_run","set":"dev","tokenBudget":100000,"label":"프롬프트 변경 전 기준"}
```

- 케이스는 `caseIds`(1~100개) 또는 `set`(dev|sealed, 100개 이하)으로 고른다. `variant`는 `active`(현재 코드) 또는 `pair`(F3b 쌍 평가, 아래 5절)만 받는다. 후보 단독 실행은 없다.
- `tokenBudget`은 필수(없으면 400)이며 고른 케이스 중 가장 큰 케이스 1건 예약량(`reserveOf`, 역할 50,000) 이상 정수다. 더 작으면 400이다.
- 케이스 1건 예약량(`reserveOf`)은 케이스 종류 처리기의 값이다(`lib/eval-kinds.ts`, 역할은 `EVAL_CASE_TOKEN_RESERVE` 50,000). 케이스마다 바꾸는 입력은 없다. 회의 단계처럼 다른 예약이 필요한 종류는 G2에서 그 처리기에 둔다. 역할 50,000은 구현 선택이다. HERMES 제출에 토큰 상한이 없어서, 케이스 하나가 쓸 양을 미리 잡아 두는 값이다. 근거는 실측 역할 1회 7,343~13,997토큰(`docs/observations/2026-09-23-live-run.md`)이고, 예약량은 그 최댓값의 약 3.5배다(기준선 실측 최대 25,790토큰의 약 1.9배). 대표가 바꿀 수 있다.
- run 시작 때 결과 행마다 그 케이스의 예약을 `reserve`로 고정한다. 아래 표의 제출 직전 검사는 다음에 보낼 결과 행의 `reserve`를 쓴다. `reserve`가 없는 결과 행(Q1 전에 시작한 run)은 50,000으로 본다.
- 진행 중(`queued`·`running`) 평가 run은 소유자당 1개(`EVAL_MAX_ACTIVE_RUNS`)다. 하나가 진행 중이면 새 `start_run`은 409이고 기록하지 않는다. 검사와 저장은 POST 라우트의 소유자 잠금 안에서 한다.

| 예산(결정 5) | 기준 | 넘으면 |
|---|---|---|
| 스모크 1회 | `tokenBudget` ≤ 250,000 | 409 |
| 월 절대 상한(시작) | 이번 UTC 월에 만든 run(삭제한 run 포함)의 보고 토큰 합 + 진행 중 run의 남은 예산 + 새 `tokenBudget` ≤ 그 달의 월 상한(월 승인 cap, 승인이 없으면 1,500,000. 아래 7절) | 409 |
| run 예산(제출 직전) | 이 run의 보고 토큰 + 다음 케이스 예약(결과 행 `reserve`) ≤ `tokenBudget` | 남은 케이스 `not_run`, `stopReason: budget_reached` |
| 월 절대 상한(제출 직전) | run 생성 월의 보고 토큰 합 + 다른 진행 중 run의 남은 예산 + 다음 케이스 예약(결과 행 `reserve`) ≤ 그 달의 월 상한(월 승인 반영). 건별 승인을 받은 run도 이 검사를 건너뛰지 않는다 | 남은 케이스 `not_run`, `stopReason: monthly_cap_reached` |
| 대표 건별 승인 | `overBudgetApproved: {"reason": "…"}` | 시작만 허용하고 run에 사유·승인자·시각·넘은 상한(`smoke_cap`·`monthly_cap`)·당시 월 누적을 기록. 월 상한을 올리지는 않는다(올리려면 7절 월 승인). 이번 달 누적 + 첫 케이스 예약이 월 상한을 넘으면 승인이 있어도 409이고 run을 기록하지 않는다(제출 0건 run 방지). 월 상한 초과 409 문구는 월 승인(`set_budget_approval`)을 함께 안내한다 |

- **시작 거부 정책(선택)**: 평가 연결이 없거나, 격리 미확인이거나, 연결 확인이 blocked이거나, 운영 연결이 같은 호스트면 run을 `blocked`(원인 `blockedReason`, 케이스는 모두 `not_run`)로 기록하고 409 `{error, run}`으로 답한다. 시도와 원인이 남는다. 입력 오류(400), 예산 초과(409), 진행 중 run 있음(409)은 기록하지 않는다.
- 진행: 시작 요청은 공급자를 부르지 않는다. 백그라운드 워커(`POST /api/research-worker` tick)의 공정 큐가 `eval:<run id>`를 다른 작업과 같은 순번 커서로 돌린다. 진행 중 평가 run이 1개라 큐 순번에 평가 작업은 최대 1개다. 운영 작업이 차례를 기다리는 간격은 평가 때문에 한 순번에 한 tick만 늘어난다. tick마다 소유자 잠금 안에서 조회나 제출을 1건만 한다. 시간 초과나 막힘으로 보내는 중지 요청만 여기에 더해진다(아래 오류 분류). 제출 중인 케이스가 있으면 조회하고, 없으면 다음 케이스를 제출한다. 매 걸음 전에 연결 조건(격리·확인 상태·운영 호스트 충돌)을 다시 본다.
- 제출 본문: `{instructions, input, session_id: <키>, conversation_history: []}`. `instructions`·`input`은 케이스 종류의 조립(`lib/eval-kinds.ts` `build`)이 만든다. 역할은 운영 start와 같은 `roleSubmission`(`lib/role-execution.ts`)이다. 동결 요청에 운영자 선호 블록이 있으면 입력 끝에 `operatorPreferences`, 지시문 끝에 권한 문장이 붙는다. 블록이 없으면 순수 조립(`buildRoleInstruction`·`buildRoleInput`)과 바이트 동일하다. 운영 HERMES 제출과 같은 모양이며 현재 코드의 조립기로 만든다. 지시문·입력의 SHA-256 앞 16자를 `promptHash`로 남긴다(기존 케이스의 `promptHash` 조건은 8절).
- 멱등 키: `collective-eval-` + SHA-256(`<run id>:<case id>`) 앞 40자. `Idempotency-Key`·`X-Hermes-Session-Key` 헤더에 쓴다. 운영 키(`collective-<uuid>`)와 접두사가 달라 저장된 운영 키를 재사용할 수 없고, run마다 달라 같은 케이스를 다시 평가해도 이전 결과를 돌려받지 않는다. 같은 run·케이스의 재시도는 같은 키라 중복 실행을 막는다.
- 예산 중단: 제출 직전마다 위 표의 run 예산·월 절대 상한(제출 직전)을 본다. 넘으면 다음 제출을 멈추고, 남은 케이스는 `not_run`(`stopReason: budget_reached` 또는 `monthly_cap_reached`)이 된다. 제출한 케이스가 토큰 사용량 없이 끝나도 예산을 지킬 수 없으므로 같은 방식으로 멈춘다(`usage_unreported`). 케이스 하나가 자기 예약(`reserve`, 역할 50,000)보다 많이 쓰면 그 케이스만큼 run 예산을 넘을 수 있다. 그러면 다음 제출 직전 검사가 그 run을 멈추고, 늘어난 월 누적은 이후 run의 시작·제출 검사에 반영된다.
- 오류 분류: 401/403은 `blocked`(인증), 연결 불가·다른 주소로 이동은 `blocked`(연결)로 run을 멈춘다. 이것은 `failed`와 다르다. 제출 전 케이스는 `not_run`이 된다. 조회하던(제출 중) 케이스는 `blocked`가 되고 `providerRunId`를 유지한다. 연결은 살아 있는데 격리 해제·연결 확인 실패·운영 호스트 충돌로 게이트만 막힌 경우도 같다. 막힐 때 제출 중인 HERMES 실행이 있으면, 저장된 평가 연결이 그 run을 보낸 호스트일 때 중지를 요청한다. 요청 결과(확인함·확인하지 못함·연결이 없어 요청 못 함)는 케이스 `error`에 남긴다. 429·5xx는 워커 백오프(`background_attempt`)로 재시도한다. 그 밖의 4xx·실행 번호 오류·HERMES 실패·중단 보고는 해당 케이스만 `failed`. 30분 넘게 끝나지 않은 케이스는 중지를 요청하고 `failed`로 둔다.
- 채점: 케이스가 끝나면 서버가 `runGraders`(13종)와 `checkCompliance`로 사람이 보는 정규화 렌더본을 채점한다. run에는 채점 버전(`gradersVersion`), 채점기별 `pass|fail|not_applicable|grader_error`(상세 200자), 요약 건수, 정규화 전 예방 판정(`prevention`, 2종)과 정규화 건수(`normalization`, 위 '정규화와 예방 판정'), 가드레일 등급별 건수·규칙 ID, 보고 모델, `providerRunId`, 토큰(입력·출력·합계), `durationMs`(제출~완료 관측, tick 간격 포함)를 남긴다. 모델 출력 원문과 발췌가 든 가드레일 상세는 `eval_output`(소유자 전용)에 둔다.
- 봉인 세트: sealed 케이스를 쓰는 run은 `sealedUsed: {by, at, cases}`를 남긴다. 목적은 run `label`에 적는다.
- `cancel_run`: 제출 중인 HERMES 실행에 중지를 요청하고(확인 여부를 케이스 `error`에 남김) 그 케이스는 `cancelled`, 남은 케이스는 `not_run`. `delete_run`: 끝난 run의 출력(`eval_output`)과 케이스 결과(`results`), 재채점 기록(`regrades`)을 지운다(진행 중이면 409, 이미 삭제했으면 409). run 행은 `deleted: {by, at, cases}`를 단 채 남는다. 결정 5 장부(`usedTokens`·`tokenBudget`·`createdAt`)와 감사 기록(`overBudgetApproved`·`sealedUsed`·`label`)을 보존해 월 누적이 삭제로 줄지 않게 하려는 것이다. 삭제한 run은 비교(`compare`)할 수 없다(409).

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
| `GET /api/eval` | `connection`(비밀 없음), `cases`(요청 원문 제외 요약), `runs`, `usage: {month, usedTokens, reservedTokens, monthlyCap, approval, smokeCap}`(`monthlyCap`은 이번 달 월 승인 반영, `approval`은 이번 달 승인 레코드 또는 null, 7절) |
| `GET /api/eval?case=<id>` | 케이스 전체(동결 요청 포함) |
| `GET /api/eval?run=<id>` | run 전체 |
| `GET /api/eval?run=<id>&caseId=<id>` | 모델 출력 원문과 가드레일 상세 |
| `GET /api/eval?compare=<기준 run>,<비교 run>` | 채점기별 대응 비교(아래 비교 통계 규칙). `graders`(사람이 보는 본문 기준), `prevention`(모델 원문 기준), `gradersVersions`, `normalization`. pair run은 400 |
| `GET /api/eval?run=<id>&regrade=latest` | 그 run의 최신 재채점 결과(아래 6절). 재채점이 없으면 404, 삭제한 run은 409 |
| `GET /api/eval?compare=<기준 run>,<비교 run>&regrade=1` | 두 run의 최신 재채점 결과로 낸 같은 비교 통계 + `regrade`(두 재채점의 id·시각·버전·합계). 한쪽이라도 재채점이 없거나 두 재채점의 채점·사전 버전이 다르면 409 |
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
- 판정: `lib/eval-stats.ts` `pairGate`(순수). 비교 통계(`comparison`)는 참고용이며 게이트는 비회귀 조건(합격 수 후보 ≥ active(두 쪽 모두 모델 원문 기준 판정 — `prevention`이 있으면 그 판정. 후보 재질문으로 not_applicable이 된 채점기·후보 grader_error는 fail), 봉인 케이스 1건 이상·봉인 회귀 0, `input_budget` 후보 전부 pass, 모델·게이트웨이 동일, 전 케이스 두 쪽 완료)만 본다. 대응 30쌍 미만은 `gate.warnings`(`small_sample`)로만 알린다.

### 6. 같은 저울 재채점(`regrade_run`)

결론: 채점기나 규제 사전을 고치면 이전 run과 새 run의 결과는 서로 다른 저울로 잰 값이 된다. `regrade_run`은 끝난 run에 저장된 모델 출력(`eval_output`)을 지금 코드의 채점기·규제 가드레일·예방 판정·정규화로 다시 채점한다. 모델·HERMES를 부르지 않아 토큰은 0이다.

비유: 시험 채점 기준표를 고쳤다면 지난 학기 답안지도 새 기준표로 다시 채점해야 두 학기 점수를 비교할 수 있다. 학생에게 시험을 다시 치르게 하지는 않는다.

```json
{"action":"regrade_run","id":"<run id>"}
```

- 권한은 다른 평가 API와 같다(소유자만. 비로그인 401, 관리자·직원 403, 다른 소유자 404).
- 대상: 끝난 run(`completed`·`cancelled`·`blocked`)의 `completed` 케이스. pair run은 두 쪽 출력을 각각 다시 채점한다. 진행 중(`queued`·`running`) run과 삭제한 run은 409, 없는 run은 404, `id` 누락은 400이며 거부는 아무것도 기록하지 않는다. 기록은 compare-and-set이다: 처음 읽은 run 행이 그대로일 때만 쓰고, 채점하는 동안 삭제(`delete_run`)나 다른 재채점이 행을 바꿨으면 409로 끝내고 쓰지 않는다(삭제한 run이 이전 결과로 되살아나지 않게).
- 채점: 3절 '채점'과 같은 함수(`gradeCase`)로 저장 출력을 채점한다. 기대 판정(`expectations`)은 지금 케이스 값이다. run 뒤에 케이스의 기대 판정을 고쳤으면 그 케이스에 `caseUpdatedAfterRun: true`를 붙인다(케이스의 `expectationsUpdatedAt` 기준. 이름·세트만 고치면 붙이지 않는다. 이 필드가 생기기 전에 고친 케이스는 마지막 수정 시각으로 본다). 케이스가 삭제됐거나 저장 출력이 없으면 채점하지 않고 `skipped`에 이유를 적는다.
- 응답과 기록: `{runId, id, at, by, gradersVersion, complianceVersion, totals, original, cases, skipped}`. `totals`는 재채점 합계(케이스 수, 채점기 pass·fail·not_applicable·grader_error, 예방 판정 fail `preventionFail`, 가드레일 block·warn·info, 채점기별 fail 수 `failsByGrader`, 규칙별 적중 수 `issuesByRule`)다. `original`은 같은 케이스들의 원래 결과 합계와 그때의 채점·사전 버전이라 도구 변경 효과를 한 run 안에서 본다. `cases`에는 케이스별 채점기 판정(fail 상세 200자), 예방 판정, 정규화 건수, 가드레일 등급별 건수·규칙 ID(발췌 없음)가 있다.
- 원래 결과는 바꾸지 않는다. run의 `results`, `eval_output`, 예산 장부(`usedTokens`)와 이번 달 평가 사용량이 그대로이고, 재채점은 `eval_run.regrades`에 덧붙는다(새 records kind 없음). 최근 `EVAL_REGRADE_KEEP`(5)개만 남기고 케이스별 상세(`cases`·`skipped`)는 최신 1개에만 둔다(이전 기록은 버전·합계만). run 행 크기를 제한하려는 것이다.
- 조회·비교: `?run=<id>&regrade=latest`로 최신 재채점을 읽고, `?compare=<기준 run>,<비교 run>&regrade=1`로 두 run의 최신 재채점을 기존 비교 통계(`compareRuns`)에 넣는다(4절 표). `regrade` 값은 `latest`·`1`만 받는다(그 밖은 400). 비교는 두 재채점의 채점 버전(`GRADERS_VERSION`)과 사전 버전이 같을 때만 한다. 다르면 409이므로 두 run을 모두 다시 재채점한다. 응답의 `regrade`에 두 재채점의 합계가 함께 나와 규제 가드레일 전후도 본다. pair run은 이 비교 대상이 아니다(400).
- 같은 저울 원칙(비교 통계 규칙 10): 채점기·사전이 바뀌면 이전 run도 재채점해 새 run과 같은 저울로 비교한다. 예: 품질 기준선 v1(run 두 개)과 품질 수정 v1 뒤 재평가 run을 측정 v2 채점기(`failure-types-v1+normalized+measure-v2`)·사전(`compliance-lexicon-2026-09-25.1`)으로 재채점해 비교한다([재평가 기록](observations/2026-09-24-quality-after-v1.md)). 기준선이 run 두 개로 나뉘어 있으므로 기준 run마다 나눠 비교한다(공유 케이스만 짝이 된다, 비교 통계 규칙 8).
- 한계: 버전 비교는 버전 문자열로만 한다. 채점기 판정을 바꾸면서 `GRADERS_VERSION`을, 사전을 바꾸면서 사전 버전을 올리지 않으면 이 검사는 저울이 바뀐 것을 구분하지 못한다. 저장 출력이 없는 케이스(1차 run의 실패 케이스처럼 `completed`가 아닌 케이스)는 재채점할 수 없다.
- 테스트: `tests/eval-regrade.test.mjs`(합성 run·출력, 메모리 SQLite, fetch 스텁 호출 0, `passed · mocked`).

### 7. 월 승인 레코드(`eval_budget_approval`, Q2)

결론: 평가 토큰 월 상한은 이제 코드 상수가 아니라 UTC 달력 월마다 대표가 승인한 값(`cap`)이다. 승인이 없는 달은 결정 5의 기본 1,500,000이다. 시작 검사, 제출 직전 검사, `GET` 조회가 모두 이 값을 읽는다. 건별 승인(`overBudgetApproved`)은 시작만 허용하고, 제출 직전 월 누적 검사를 건너뛰지 못한다.

비유: 가스 계량기에 이번 달 한도를 적어 두는 것과 같다. 한도를 올리려면 대표가 계량기 표(월 승인)를 바꿔야 한다. 건별 승인은 큰 냄비를 한 번 올리게 해 줄 뿐이고, 계량기를 끄지는 않는다.

```json
{"action":"set_budget_approval","month":"2026-10","cap":2400000,"reason":"토큰 상한 증액 승인 … -> 승인한다(기준선 달)"}
```

- 입력:
  - `month`: UTC 기준 `YYYY-MM`. 지난 달은 400이다(월 누적 장부가 닫힌 달은 바꾸지 않는다). 이번 달과 다음 달 이후는 받는다.
  - `cap`: 1 이상 10,000,000 이하 정수. 기본값보다 낮게 두면 그 달을 더 좁게 막는다.
  - `reason`: 대표 승인 사유(1~500자).
- 저장:
  - 월당 1행(`id` = `YYYY-MM`)이다. 내용은 `{month, cap, reason, by: {id, email}, createdAt, history}`이다.
  - 같은 달을 다시 승인하면 행은 하나로 둔다. 이전 승인(`cap`·`reason`·`by`·`createdAt`)은 오래된 순서로 `history`에 남긴다. 이력이 50건에 닿으면 409다. 이력을 버리지 않으려는 것이다.
  - 캠페인과 무관한 소유자 기록이라 캠페인 삭제의 영향을 받지 않는다(`not_campaign_scoped`).
- 권한: 다른 평가 API와 같다. 소유자만 쓰고 읽는다. 비로그인은 401, 관리자·직원은 403이다. 거부된 요청은 승인을 바꾸지 않는다.
- 반영(`lib/eval-budget-server.ts`의 `evalMonthBudget`·`monthlyCapFor`):
  - 3절 표의 월 절대 상한(시작·제출 직전)은 run 생성 월의 `cap`을 쓴다.
  - `GET /api/eval`의 `usage.monthlyCap`은 이번 달 `cap`이고, `usage.approval`은 그 달의 승인 레코드(없으면 null)다.
  - 승인을 바꾸면 다음 시작과 다음 제출 직전 검사부터 적용된다.
- 고친 실패 사례(설계 교차 검토 1-3): 전에는 `overBudgetApproved.exceeded`에 `monthly_cap`이 든 run이 제출 직전 월 누적을 보지 않았다. 그래서 "월 누적 N까지"라는 승인을 코드가 지키지 못했다. 이제 그런 run도 승인 `cap`에 닿으면 `monthly_cap_reached`로 멈춘다. 남은 케이스의 `error`에는 적용된 상한이 적힌다.
- 건별 승인은 첫 케이스는 월 상한에 들어가는 run만 시작하게 한다. 이번 달 누적 + 첫 케이스 예약이 월 상한을 넘으면 승인이 있어도 첫 제출 직전에 곧바로 멈출 run이므로 409로 거부하고 기록하지 않는다(쓸모없는 run과 '월 상한 승인'처럼 보이는 감사 기록을 남기지 않는다). 월 상한 초과 409 문구는 `set_budget_approval`을 안내한다. 스모크 상한만 넘은 409는 건별 승인 사유 안내만 한다.
- 대표 사전 승인(2026-09-24, '토큰 상한 증액 승인 … -> 승인한다', 평가 케이스 확대와 함께):
  - 기준선을 돌리는 달(10월 예정)만 월 상한을 1,500,000에서 2,400,000으로 올린다. 내역은 파일럿 0.2M + dev 기준선 1.6M + A/A 0.21M = 약 2.0M이고, S8을 더하면 약 2.2M이다.
  - 기준선 run 1회의 `tokenBudget`은 2,000,000이다. 스모크 1회 상한(250,000)을 넘으므로 그 run에도 건별 승인 사유를 남긴다.
  - 파일럿 평균이 추정의 1.2배를 넘으면 멈추고 다시 보고한다. 이 규칙은 운영 규칙이다. 코드가 자동으로 막지 않으므로, 파일럿이 끝나면 사람이 실측 평균과 추정을 비교한다.
  - 심사를 하는 달(약 1.04M)은 증액이 필요 없다. 활성화 쌍 평가는 결정 5에 따라 건별로 승인한다.
  - 적용 방법: 기준선 달이 정해지면 소유자가 그 달에 대해 `set_budget_approval`(`cap` 2,400,000, 사유에 위 승인 인용)을 한 번 기록한다. 이 기록 전에는 그 달도 1,500,000이다.
- 한계:
  - 월 누적은 run 생성 시각(UTC) 기준이다. 월말에 시작한 run은 다음 달로 넘어가도 시작한 달의 `cap`과 누적을 쓴다.
  - 케이스 하나가 자기 예약(`reserveOf`, 역할 50,000)보다 많이 쓰면 그만큼 `cap`을 넘을 수 있다(아래 '서버 평가의 한계'와 같다).
  - run에는 적용된 `cap`을 복사하지 않는다. 어느 run에 어떤 상한이 적용됐는지는 승인 레코드의 `createdAt`·`history`와 run `createdAt`을 맞춰 본다.
- 테스트: `tests/eval-budget.test.mjs`(승인 없음 기본값, 승인 반영, UTC 월 경계, 입력 검증, 이력, 소유자 전용·관리자 403, 건별 승인 run의 승인 cap 초과 제출 중단, 첫 케이스도 들어가지 않는 건별 승인 시작 거부. 합성 데이터, 메모리 SQLite, 평가 HERMES fetch 스텁, `mocked`).

### 서버 평가의 한계

- 이 PR의 검증은 모두 `mocked`다. 실제 평가 전용 HERMES 프로필로 스모크를 돌리지 않았다(결정 5 예산 안에서 대표가 연결을 등록한 뒤 한다).
- 메모리 off와 운영 분리는 대표 확인(`isolationConfirmed`)과 호스트 비교에만 의존한다. 같은 HERMES 인스턴스를 다른 호스트 이름으로 등록하면 코드는 구분하지 못한다.
- 제출 응답이 연결 끊김으로 유실되면 run은 blocked가 되지만 HERMES가 이미 받았을 수 있다(실행 번호가 없어 중지도 못 한다). 취소·시간 초과·blocked로 멈춘 실행의 토큰은 보고되지 않으면 `usedTokens`에 들어가지 않는다. 중지 요청이 확인되지 않은 blocked 케이스는 HERMES 쪽에서 토큰을 더 썼을 수 있다. 월 누적은 run 생성 시각(UTC) 기준이다.
- 월 절대 상한은 자기 예약(`reserveOf`, 역할 50,000)을 넘게 쓰는 케이스가 없다는 가정에서만 지켜진다. 한 케이스가 예약량을 넘기면 그만큼 상한을 넘을 수 있다. 진행 중 run이 1개라, 넘는 양은 그 run의 마지막 케이스 하나에서 생긴다.
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
