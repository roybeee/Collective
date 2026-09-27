# 2026-09-27 레인 A: B3 4단계 종료 조건 (운영자 선호 규칙 첫 실제 주입)

결론: **1~7단계 passed · real, 8단계 부분(규칙 주입·스냅샷·개선 루프는 확인, 보상 계보 `byRule`은 사람 판정 대기)**. 대표 승인 규칙이 ODA CMO 재작성에 실제로 들어갔고 작업물 끝에 규칙 제목과 버전이 적혔다. 보상 계보는 사건(사람 판정·발행·반응)이 있는 작업물만 세므로, 대표가 새 작업물을 판정하면 `byRule`에 나타난다.

비유: 새 조리 지침을 주방에 붙였고, 첫 접시가 그 지침대로 나왔다. 손님 평가표는 손님이 맛을 봐야 채워진다.

## 절차와 결과 ([PLAYBOOK](../PLAYBOOK.ko.md) 4단계 종료 조건 절차)

| 단계 | 결과 | 근거 | 증거 |
|---|---|---|---|
| 1 대표 승인 | passed | real | 2026-09-27 "b3 승인한다" |
| 2 초안 | passed | real | 대표 판정 2건(ODA insight `0f891e8a` 수정 요청 "코딩같은 딱딱함", cmo `8b68bd8d` 수정 요청 "당근마켓 등 지역 타깃 전략") 인용, `playbook:24e71fa4-b931-44c0-9b16-e1ba2316773b` v1 초안(ODA 전 역할·전 채널, 126자) |
| 3 골든 캡처 | passed | real | dev `8555e378`(ODA cmo, 기존). 봉인 `34e1f921`(ODA growth): 봉인 작성 전용 에이전트가 캡처했고 이 세션은 id만 봤다([SEALED-CASES](../SEALED-CASES.ko.md)) |
| 4 on/off 쌍 평가 | passed | real | run `3fb5122b`(73,312토큰, tokenBudget 130,000): 게이트 ok, 봉인 회귀 0, input_budget 2/2, 경고 `small_sample`. 대응 쌍 15, fail 0 |
| 5 첨부 | passed | real | `playbook_attach_eval` → v1에 통과 표시(pairs 2, sealed 1) |
| 6 승인 | passed | real | 처음엔 409(`gateway_change` 2026-09-27 경보 동결). 세션 29f7af가 스모크 `8c85ed1e` 재채점 비교(회귀 0) 뒤 `acknowledge_alarms`(`662244dc`, 15:13:51 KST)를 했고, 그 뒤 `playbook_activate` 200 → active v2, 만료 2026-11-26. 첨부는 v1에 남음(계보 보존) |
| 7 실제 주입 | passed | real | ODA CMO 재작성(`repairId` = 수정 요청 작업물 `ai-f8710d51c` v1) → 작업물 `ai-4fb50c2c38a6e0d08480f2c22b98424c`(2026-09-27 06:20 UTC, review). `learning_snapshot`의 `operatorPreferences` = `playbook:24e71fa4…@2` |
| 8 appliedRules 확인 | 부분 | real | 작업물 끝 "적용한 작성 규칙 … 버전 2" 있음. 개선 루프 대장에 이 승인(`playbook:3d024db9…`, v2, ODA)이 후보로 올라옴. `GET /api/reward-lineage?brandId=oda`의 `byRule`은 빈 목록: `ruleLinks`가 사건 있는 작업물의 스냅샷만 남기기 때문(`lib/reward-lineage-server.ts`). 새 작업물에 대표 판정이 생기면 다시 본다 |
| 9 기록 | passed | real | 이 파일 |

## 품질 관찰 (대표 판단용)
- 수정 요청 반영: 당근을 '채택·조건부 테스트' 채널로 넣고, 지역 채널 4개군(네이버 플레이스·당근·배달앱·카카오)의 채택 이유를 적었다.
- 규칙 준수: 끝의 "수정 요청 반영 위치" 절에 `revisionRequest.note`·`output_1`·`previousVersion`·`lastFailure` 같은 내부 필드 이름이 그대로 나왔다. 규칙 앞 문장("코드·필드 이름 같은 기술 표기 대신")을 이 절에서는 지키지 않았다. 반복되면 이 절의 표기를 코드에서 한국어 라벨로 바꾸는 정규화(레인 Q, `lib/output-normalize.ts`)를 검토할 만하다.
- 작업물 끝의 규칙 인용은 원문을 조금 줄여 옮겼다('나열' 등 일부 생략).

## 남은 것
- 대표가 새 CMO 작업물(`ai-4fb50c2c3…`)을 판정하면 `byRule`에 `playbook:24e71fa4…@2`가 나오는지 보고 이 파일 아래에 덧붙인다.
- 개선 루프 전후 14일 비교는 승인일(2026-09-27)부터 14일 뒤 닫을 수 있다(`b4_reward_lineage` 켜짐). 주문(L3)은 B4 중단 규칙 blocked라 KPI로 쓰지 않는다.

## 8단계 확인 (2026-09-27 06:4x UTC 덧붙임)
- 대표가 새 CMO 작업물을 06:41:36 UTC에 수정 요청으로 판정했다. 메모: SEO(구글맵·홈페이지)와 GEO/AEO 카테고리 검토 필요.
- `GET /api/reward-lineage?campaignId=37da2d59…`의 `byRule`: `playbook:24e71fa4…@2`(operator_preference), 1차 판정 1·수정 요청 1, `insufficient`. **8단계 passed · real.**
- 같은 시각 `?brandId=oda`는 `byRule`·`byPromptVersion`이 모두 비었다. 원인은 작업물 판정의 `brandId`가 null(캠페인만 기록)인데, 브랜드 범위가 판정 `brandId`로 걸렀기 때문이다(`lib/reward-lineage-server.ts` `readDecisions`). 레인 A 결함이라 고쳤다(PR `fix/reward-lineage-brand-scope-decisions`, Red-Green 확인). 게시 뒤 브랜드 범위로 다시 본다.

## 브랜드 범위 확인 (묶음 20 게시 뒤, 2026-09-27 08:0x UTC)
- 대표 GEO 정정 요청(생성형 AI 검색 최적화) → CMO 재작성 `ai-21e8ab2c7…` → 대표 승인.
- `GET /api/reward-lineage?brandId=oda`의 `byRule`: `playbook:24e71fa4…@2` 1차 판정 3·승인 1·수정 요청 2. 캠페인 범위와 같다. **#189 운영 확인 passed · real.**
