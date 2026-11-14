# 규정 수정 제안 (규정 점검 패널)

작업물 상세의 규정 점검 패널(`components/app/compliance-panel.tsx`)에서 걸린 규칙마다 결정론 수정 제안을 보이고, 고른 제안만 새 버전으로 저장한 뒤 바로 다시 점검한다. 모델 호출은 없다.

> **COLLECTIVE 휴리스틱 · 법률 자문 아님.** 제안은 규정 점검 사전(`lib/graders/compliance-lexicon.ts`)이 찾은 표현을 정해진 방식으로 고친 문장이다. 고친 글이 법령·플랫폼 정책을 충족한다는 판단이 아니다. 게시 전 담당자가 원문 규정을 확인한다.

- 스위치: `compliance_fixes`(기본 꺼짐, `lib/feature-flags.ts`). 꺼져 있으면 패널에 제안이 보이지 않고(보기에 `fixes` 키가 없다) 적용 요청은 409다.
- 코드: `lib/graders/compliance-fixes.ts`(순수: 제안 계산·겹침 판정·적용), `lib/compliance-fixes-server.ts`(적용 요청), `lib/artifact-save.ts`(save_artifact와 같은 새 버전 저장 묶음), `lib/artifact-sources-server.ts` `withComplianceFixes`(보기에 제안 싣기), `components/app/compliance-fixes.tsx`(lazy 청크 화면)
- 테스트: `tests/compliance-fixes.test.mjs`(순수·라우트·권한), `e2e/compliance-fixes.spec.ts`(모바일·데스크톱 여정)

## 1. 제안이 있는 규칙

| 규칙 | 종류 | 고침 | 확인 필요 |
|---|---|---|---|
| `sponsorship_undisclosed` 협찬·광고 관계 표기 누락 | 넣기 | 걸린 줄 첫머리에 `#광고 `(블로그·포스팅 단락이면 `[광고] `). 추천·보증 심사지침의 '쉽게 찾을 수 있는 위치(첫머리)' 원칙. 단락마다 한 번 | 아니오 |
| `disclosure_omitted` 광고·AI 표기를 빼라는 지시 | 바꾸기 | 지시 부분(걸린 표현부터 문장 끝)을 `‘#광고’ 표기를 게시물 첫머리에 넣는다`(AI 표시면 `AI 생성 표시를 게시물에 넣는다`)로 | 아니오 |
| `virtual_person_undisclosed` 가상인물 표시 누락 | 끝에 붙이기 | 단락 끝에 `VIRTUAL_PERSON_LINE`(`lib/ai-disclosure.ts`, 심사지침 문구) | 아니오 |
| `ai_generated_unlabeled` AI 생성 소재 표시 | 끝에 붙이기 | 단락 끝에 `AI 생성 표시: AI 생성 · COLLECTIVE`(라벨은 `lib/ai-disclosure-image.ts` `AI_IMAGE_VISIBLE_LABEL`, 대표·법률 검토 전 초안) | 예 |
| `ad_label_missing` 광고 메시지 (광고) 누락 | 넣기 | 메시지 본문 첫머리(‘문자 초안:’ 뒤, 라벨만 있는 줄이면 다음 줄)에 `(광고) ` | 아니오 |
| `optout_missing` 무료 수신거부 안내 누락 | 끝에 붙이기 | 메시지 문단 끝에 `전송자: <브랜드 이름>, 무료 수신거부 [수신거부 080-…] [확인 필요]`. 080 번호는 지어내지 않고 자리표시로 둔다 | 예 |
| `disease_claim` 식품 질병 효능 | 지우기 | 걸린 문장(줄 전체면 줄)을 지운다 | 아니오 |
| `drug_claim` 화장품 의약품 오인 | 지우기 | 걸린 문장을 지운다 | 아니오 |
| `kr.fr.revenue_guarantee` 가맹 수익 보장(가맹 범위 점검에서만) | 지우기 | 걸린 문장을 지운다. 가맹 규칙(`lib/franchise-rules.ts`)에 정해진 대체 문장이 없어 넣지 않는다 | 아니오 |
| `kr.fr.superlative_claims` 업계 1위·최초·유일(가맹 범위 점검에서만) | 바꾸기 | 걸린 표현을 `[확인 필요: 순위 근거]`로. 확정 사실 `claim_basis`가 있으면 채점기가 걸지 않으므로 제안도 없다 | 예 |

- 작업물 패널의 점검은 기본 범위(가맹 범주 제외)라 가맹 두 규칙의 제안은 지금 화면에 나오지 않는다. 순수 함수는 `franchise` 옵션으로 같은 제안을 만든다.
- 한 규칙이 여러 문장에 걸리면 문장마다(표기 규칙은 단락마다) 제안을 만든다. 채점기가 첫 걸린 문장만 보고하므로, 그 문장을 같은 길이의 빈칸으로 가리고 다시 채점해 다음 문장을 찾는다.
- 두 제안이 같은 자리를 건드리면 지우기 → 바꾸기 → 넣기 → 붙이기 순으로 앞선 제안만 남긴다. 남은 표현은 적용 뒤 다시 점검하면 다시 제안된다.
- 적용 뒤 다시 계산하면 위 규칙의 제안은 0건이다(테스트 고정).

## 2. 자동으로 고치지 않는 것

- 사실·가격·숫자·번호를 지어내는 고침: 가격 표시(`price_missing`), 판매 조건(`terms_missing`), 할인 기준 가격(`discount_basis_missing`), 원산지(`origin_unconfirmed`), 매장 수·창업비용·특허·상권 같은 가맹 수치 주장. 080 번호와 전송자 명칭도 자리표시뿐이다.
- 사람·운영 판단이 필요한 것: 리뷰 보상·이벤트·체험단(`review_reward`·`receipt_review_event`·`bulk_review`), 가짜 체험담(`fake_testimonial`), 수신 동의(`consent_missing`)·야간 전송(`night_send`), 기능성 인증(`functional_unverified`), 권리 확인(`artist_rights_unconfirmed`), 그 밖의 가맹 규칙.
- AI 카피 표시 줄(`AI_DISCLOSURE_LINE`)은 붙이지 않는다. 발행 캡션 조합이 끝에 자동으로 붙이므로(docs/AI-DISCLOSURE.ko.md 3절) 본문에 넣으면 중복된다.
- 위 규칙은 화면에 '직접 고쳐야 합니다'로 보인다.

## 3. 적용 요청

`POST /api/action` `{action:'apply_compliance_fixes', artifactId, version, fixIds}`

- 권한: 편집 권한(`requireAccess` `edit_campaign`)이 있는 대표·관리자와 범위 역할(브랜드 매니저·점포 매니저, 배정 범위 안). 범위 없는 직원과 검토자는 403.
- 서버는 화면이 보낸 글을 받지 않는다. 저장 본문·현재 사실 원장·브랜드 이름으로 제안을 다시 계산하고, 고른 id가 그 안에 없으면 409('수정 제안이 바뀌었습니다'). 판이 다르면 409, 겹치면 400, 같은 id 중복·빈 목록은 400.
- 저장은 save_artifact와 같은 묶음이다(`lib/artifact-save.ts`): 새 판은 검토 대기, AI 작성(`ai`)이면 `ai_edited`와 AI 원본·편집 통계, 같은·뒤 담당 작업물 outdated, 이전 판 이력. 사건 문구는 `규정 수정 제안 n건 적용 · vN`(캠페인 이력 탭), 새 판에 `complianceFixes:{fromVersion,count,ruleIds}`를 남긴다.
- 저장 뒤 같은 요청에서 결정론 채점기·규정 점검을 다시 돌려 새 판의 채점 기록을 쓰고, 새 점검 보기(남은 제안 포함)를 돌려준다.
- 되돌리기: 캠페인 이력 탭의 버전 비교에서 이전 버전으로 되돌린다(새 버전으로 저장, 이력은 바뀌지 않는다).

## 4. 화면

- 패널의 분류별 목록 아래 '수정 제안' 묶음(lazy 청크). 걸린 규칙마다 제안을 어절 비교(`components/app/version-diff.tsx` compact)·근거 문장·'확인 필요'와 함께 보이고 체크 상자로 고른다.
- '선택한 수정 적용'은 확인 카드(무엇·어디·되돌림 '이전 버전으로 되돌릴 수 있음')를 거친다. 성공하면 알림과 함께 패널이 새 판의 점검 결과로 바뀐다. 대화상자의 본문은 창을 다시 열면 새 판으로 보인다.
- 권한이 없으면 체크 상자와 버튼이 비활성이고 사유를 보인다.
