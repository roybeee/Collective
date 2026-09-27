# R5 유입 코드·모집 비용·리드 가져오기 구현 명세 (초안 2)

- 기준: `origin/main` `9a760e4`(#167). 아래 `file:line`은 모두 이 SHA에서 다시 확인했다. `scanText` 값 확인은 이 SHA의 `lib/pii-scan.ts`를 테스트 런타임(`tests/helpers/runtime.mjs`)으로 불러 돌린 결과다(mocked, 외부 호출 0).
- 요구 정본: `docs/FRANCHISE-RECRUITMENT-PLAN.ko.md`(이하 계획) R5 절(:735-742, 채널 목록 :738), kind 표(:451-452), 역할 표 행(:493), 보존 표 H11(:303, :465), R4b 거부 기준(:733), R6 지표 표(:748-750), 테스트 계획(:917), 공유 파일 병합 순서(:977-1008), 결정 27(:1053), 하지 않는 것(:1081), 열린 질문 14(:1127).
- 함께 읽은 것: 계획의 R4b·R15a-1·R15a-2a·R15a-2b 구현 기록(:709-716, :837-903), `docs/LANES.ko.md`, `docs/STATUS.md` 레인 R 칸, `docs/SECURITY-BOUNDARIES.ko.md`(:56-72), `docs/DATA-PROCESSING.ko.md` 3.5·4.1·DP-10(:166-229), `AGENTS.md`.
- 상태: 명세 초안 2(검토 1회 반영, 9절). 코드·문서는 바꾸지 않았다. 이 명세의 기한·한도·판정은 모두 COLLECTIVE 휴리스틱이며 법률 자문이 아니다(결정 20 보류).
- 공개 저장소 경계: 브랜드 운영 사실·실명·금액·모집 지역은 싣지 않는다. 예시 값(코드, 제공처 이름, 날짜, 이름)은 모두 가상이다.

## 결론

1. R5를 네 조각으로 나눈다.
   - R5a: 순수 모듈 두 개와 테스트. 공유 파일이 없고, 대표 질문의 답과 무관한 부분만 담는다(코드·채널·코드 귀속·비용 판정, CSV 해독·개인정보 검사·매핑·행 정규화·제공 증빙 형식·기간 겹침·해시).
   - R5b-1: 코드·비용 기록과 API, 리드 코드 추가·제외, 코드 사용 중지.
   - R5b-2: 리드 CSV 가져오기 기록과 API, '제공처 보관' 리드 상태, 가져오기 수집 근거, 가져오기 귀속 기준.
   - R5c: 화면.
2. 대표에게 올릴 질문은 둘이다(7.1). 둘 다 R5b-2(와 R5c의 가져오기 화면)만 막는다.
   - Q-R5-1: CSV로 들여온 문의를 원장에 어떻게 둘까(A·B·C안). 권고는 A안(연락처는 제공처에 두고 메타데이터만 들여와 '제공처 보관' 리드로 만든다). 딸린 질문으로 포털·박람회 파일의 수집 근거(제3자 제공 수령 또는 위탁 수집)를 묻는다. 열린 질문 14가 풀릴 때까지는 관리자가 가져오기마다 선언한다.
   - Q-R5-2: 코드 없는 가져온 리드를 '유입 미확인'으로 둘까, 제공처 파일의 채널로 따로 셀까. 권고는 '제공처 파일 기준' 귀속을 코드 귀속과 다른 열로 두는 것이다. 계획 A3 문장과 달라서 묻는다.
3. 핵심 설계 기본값:
   - 모집 코드는 'R' + `CODE_ALPHABET` 7자(8자)로 고정한다. 9자 R 코드는 `lib/pii-scan.ts:75` 여권 패턴에 걸린다(`R23456789` → national_id 확인).
   - 발급 때 `tracking_code`·`recruitment_code` 두 kind를 조회해 409를 낸다. 점포 쪽 파일은 고치지 않는다. 귀속 때 같은 값의 `tracking_code`가 있으면 귀속하지 않고 할 일을 띄운다.
   - 귀속은 읽을 때 순수 함수로 계산하고 `asOf`로 시점을 고정한다. 코드는 발급 뒤 고치지 않고 사용 중지만 한다. 리드 코드는 추가만 하고, 잘못 넣은 코드는 관리자가 '제외' 기록으로 뺀다.
   - 비용은 부가세 제외 원 단위 소진액이다. 광고분담금 출처와 점주 추천 금전 보상(금액 > 0)은 400이다. 같은 비용으로 보이는 행이나 겹치는 기간은 관리자가 확인하지 않으면 409다.
   - CSV는 원본 바이트를 base64로 받는다(100,000바이트·200행). UTF-8만 받고, 파일 해시는 원본 바이트의 SHA-256이다. 모든 머리글을 민감 열 이름 목록으로 검사하고, 모든 칸을 `scanText`와 가져오기 전용 탐지로 검사한다. 한 곳이라도 걸리면 파일 전체를 거부하고, 오류에는 행 번호·열 번호(또는 통과한 머리글 이름)만 둔다.
   - 가져온 리드는 접수 시각이 180일(H11) 안이어야 하고, 마지막 활동 시각은 접수 시각이다. '제공처 보관' 리드도 H11 보존 기한을 받는다.
4. 계획과 다르게 하는 것 18가지(0.2)는 R5a PR에서 계획 문서 R5 절에 함께 적는다.
5. 운영 D1에 합성 행을 넣는 확인은 하지 않는다(6.4). 필요하면 대표 승인 안건으로만 올린다.

## 0. 요구와 해석

### 0.1 요구 대조표

| ID | 계획 문장(:737-742) | 이 명세의 계약 | 검사 |
|---|---|---|---|
| C1 | 새 모듈에서 `CODE_ALPHABET`·`normalizeCode`만 import | `lib/franchise-recruitment.ts`가 `./tracking-codes`에서 이 두 이름만 가져온다. 구문 검사로 고정한다 | RC-S1 |
| C2 | 첫 글자 R 고정 | `^R[CODE_ALPHABET]{7}$`, 생성·직접 입력 모두 | RC-F1~F6 |
| C3 | 두 kind 조회, 충돌 409 | 발급 판정이 `taken.tracking`·`taken.recruitment`를 받고 서버는 두 id를 한 번에 조회한다. 같은 kind 경쟁은 INSERT의 UNIQUE로 409 | RC-D5, RR-C3·C4 |
| C4 | `lib/store-operations-server.ts` 무변경, 귀속 때 같은 값 `tracking_code`면 귀속하지 않고 충돌 할 일 | 2.4 충돌 규칙, 보드 할 일 `code_conflict` | RA-6, RR-A3 |
| C5 | 모집 채널 10개, 점포 채널과 분리 | 2.2 `RECRUITMENT_CHANNELS` | RC-CH1~CH3 |
| A1 | 첫 유효 코드 | 2.4 입력 순서대로 첫 유효 토큰이 결정. 제외 기록된 토큰은 건너뛴다 | RA-1·2·11 |
| A2 | validFrom 이전 접수는 귀속하지 않음 | KST 날짜 비교 `validFrom <= kstDate(receivedAt)` | RA-3 |
| A3 | 코드 없는 리드는 '유입 미확인' | `state:'unattributed'`, 사유 `no_code`. 가져온 리드의 '제공처 파일 기준'은 Q-R5-2 답 뒤 따로 센다(2.7.3) | RA-4, RA-9 |
| A4 | 모든 집계 위에 귀속≠증분 | 집계를 싣는 GET 응답마다 `attributionNote`, 화면은 집계보다 먼저 그린다 | RR-V1, UI-R2 |
| I1 | `parseCsv`·`IMPORT_LIMITS`만 import, 리드 매핑은 새 모듈 | `lib/franchise-lead-import.ts`(0.2의 1) | LI-S1 |
| I2 | `pii-scan`으로 검사, 한 칸이면 파일 전체 거부, 오류는 행 번호·열 이름만 | 2.6.3. 머리글 검사는 열 번호만 싣는다(머리글 자체가 민감할 수 있다) | LI-P1~P30, LI-M6 |
| I3 | 포털·박람회 파일은 제공자·제공일·동의 증빙 참조 필수 | 2.6.5. 동의 증빙 참조는 포털·박람회만 필수, 제공처·제공일·내보내기 기간은 모든 가져오기에 필수 | LI-V1~V9 |
| I4 | 민감·고유식별 열 매핑 불가 | 매핑 대상 허용 목록, 금지 대상 목록, 모든 머리글의 민감 열 이름 검사 | LI-M1~M7 |
| I5 | 가져온 행에 가명 코드를 새로 만든다 | 행마다 `leadSystemCode`(L+7), R5b-2 서버 | RI-5 |
| S1 | 날짜·기간, 채널, 금액, 출처 필수 | 2.5. 증빙 라벨·부가세 구분도 필수(0.2의 9) | RS-1~4 |
| S2 | 소재 버전 id, 플랫폼 보고 노출·클릭·양식 제출 선택 | `assetRef`, `platform` | RS-7~9 |
| S3 | 음수 400, 광고분담금 400 | `amount_negative`, `ad_fund_forbidden`. 점주 추천 금전 보상 `referral_reward_forbidden`(결정 27) | RS-5·6·6c |
| S4 | 기간 비용 일할 없음 | `spendInWindow`는 걸친 행을 따로 돌려준다. R6은 걸친 행이 있는 채널의 CPL을 null로 둔다(2.5) | RS-10·17 |
| S5 | 네이버 광고비 수기 입력 | 검색광고 채널 경고 문구, 연동 코드 없음 | RS-11 |
| P1 | 직원 코드 발급·CSV 확정·비용 기록 403 | `ADMIN_ACTIONS`에 더한다. 파일 검사·미리보기도 403(0.2의 4) | RR-P1, RI-P1 |
| P2 | 같은 파일 해시 재확정 409 | `recruitment_import` 행 id = 원본 바이트 SHA-256, INSERT UNIQUE | RI-4 |
| P3 | 스위치 꺼짐 409 | `OFF_EXEMPT`에는 보호 방향 작업(`spend_void`·`code_retire`)만 넣는다 | RR-P2, RI-P2 |

### 0.2 계획과 다르게 하는 것 (R5a PR에서 계획 문서 R5 절에 적는다)

1. **모듈 이름**: 계획의 `lib/lead-import.ts`를 `lib/franchise-lead-import.ts`로 한다. 레인 R 소유 범위가 `lib/franchise-*`이고(`docs/LANES.ko.md:77`), 가맹 모듈 자동 검사(fetch 0, 모델 import 0)가 `lib/franchise*.ts`만 본다(`tests/franchise-model-boundary.test.mjs:84`). 테스트 파일 이름은 계획대로 `tests/lead-import.test.mjs`다.
2. **kind 이름**: `lead_import`를 `recruitment_import`로 한다. 보존·정보주체 삭제 축은 `^(franchise|recruitment)_` kind만 선언할 수 있다(`tests/record-kinds.test.mjs:97`).
3. **가져오기 한도와 전송**: `IMPORT_LIMITS`(150KB·500행, `lib/order-import.ts:8`)보다 좁게 원본 100,000바이트·200행으로 한다. 파일은 JSON 문자열이 아니라 원본 바이트의 base64(`csvBase64`, 최대 133,336자)로 받는다.
   - 리드는 행마다 리드와 생성 이벤트 두 문장이라 200행이면 402문장이다. 주문 가져오기는 한 batch에 최대 501문장(주문 500 + 기록 1)을 쓰도록 만들어져 있다(`lib/order-import.ts:7`, `lib/store-operations-server.ts:192`). D1 문장 한도 자체는 저장소에서 확인하지 못했다.
   - 요청 본문 상한은 200,000바이트다(`lib/server.ts:28`). base64는 이스케이프가 없어 100,000바이트 파일이 항상 133,336자로 들어간다. JSON 문자열은 탭 2바이트·제어 문자 6바이트로 부풀어 보장이 없다.
4. **파일 검사·미리보기 권한**: 계획은 "직원 CSV 확정 403"만 적었다. 제3자가 준 파일을 다루므로 파일 검사·미리보기도 대표·관리자만 한다.
5. **정정 작업 추가**: 계획에 없는 네 작업을 둔다. 모두 삭제가 아니라 추가 기록이고 리뷰 포인트로 올린다.
   - `spend_void`(비용 무효화)와 `spend_record`의 `replacesSpendId`(무효화 + 새 행): 잘못 적은 비용이 R6 CPL에 영구히 남지 않게 한다.
   - `code_retire`(코드 사용 중지): 코드는 고치지 않고 오늘 이후 접수분의 귀속만 멈춘다.
   - `strike_lead_code`(리드 코드 제외, 관리자): 잘못 넣은 코드를 지우지 않고 제외 기록을 남긴다.
6. **개인정보 검사 범위**: 계획은 전화·이메일·고유식별번호를 적었다. `scanText`의 여섯 종류를 모두 거부 사유로 쓰고(fail closed), 가져오기 전용 탐지(2.6.3)와 모든 머리글의 민감 열 이름 검사를 더한다. 매핑하지 않은 열도 이름이 민감하면 파일을 거부한다.
7. **validFrom 범위**: 점포 코드는 미래 날짜가 400이다(`lib/store-operations-server.ts:13`). 모집 코드는 박람회 부스 QR을 미리 인쇄하므로 오늘(KST) −90일 ~ +180일을 받는다.
8. **분기 A에서만 코드 발급**: 계획 R5에는 없는 409다. H7(분기 B·C는 유료 모집·박람회·설명회를 하지 않음)을 따른다. 그래서 R15b의 모집 코드 QR도 분기 B·C에서는 만들 수 없다(R15b 명세에 같이 적는다). 비용 기록에는 분기 검사가 없다.
9. **비용 필수 칸 추가**: 계획 S1은 출처만 적었다. 금액의 근거 라벨(`evidence`)과 부가세 구분(`vat`)도 필수다. 정본 금액은 부가세 제외 원화 소진액이다(2.5).
10. **점주 추천 금전 보상 400**: 계획 R5 문장은 광고분담금만 적었다. 결정 27(:1053)의 둘째 부분(점주 추천 금전 보상 없음, Q9 전)도 `owner_referral` 채널 금액 > 0을 400으로 막는다. 셋째 부분(위탁 계약 밖 성과 수수료형 영업대행)은 증빙 문구 경고로만 둔다.
11. **접수 시각 범위와 마지막 활동**: 가져온 행의 접수 시각은 오늘(KST) −179일 날짜까지만 받는다(`UNCONVERTED_RETENTION_DAYS`=180, `lib/franchise.ts:248`). 가져온 리드의 `lastActivityAt`은 서버 시각이 아니라 접수 시각이다. 박람회·설명회 파일만 날짜만 있는 값을 받는다.
12. **기간 겹침**: 같은 브랜드·제공처의 이전 가져오기가 선언한 내보내기 기간 안에 드는 행을 건너뛴다(최댓값 기준 시각이 아니라 기간 커버리지). 내보내기 기간 선언이 필수다.
13. **파일 안 중복**: 같은 튜플의 행을 기본으로 건너뛰지 않는다. 건수만 경고하고, 관리자가 `dropInFileDuplicates:true`를 고를 때만 건너뛴다.
14. **리드 코드 칸과 코드 불변**: `LeadRecord.codes`(추가만)·`codeStrikes`(제외 기록)를 새로 둔다. 발급한 코드는 고치지 않고 사용 중지만 한다.
15. **가져온 리드의 접수 시각**: 제공처 파일의 시각이다. 계획 R6 speed-to-lead(:750 '첫 연락 − 서버 접수 시각')와 다르므로 R6는 가져온 리드를 '제공처 시각'으로 따로 보인다(2.7.4).
16. **가져오기 수집 근거**: `consent`는 가져오기에 받지 않는다(COLLECTIVE가 본 적 없는 안내 사실을 기록하지 않는다). 포털·박람회는 `provided` 또는 `inquiry_response`를 관리자가 선언하고 어느 쪽이든 제공 증빙이 필수다. 점주 추천은 `referral`을 쓴다(2.7.1). 수기 등록은 `provided`를 고를 수 없다.
17. **가져오기 귀속 기준**: Q-R5-2 답이 권고대로면 코드 없는 가져온 리드를 '제공처 파일 기준'으로 따로 센다(계획 A3의 '유입 미확인'과 다름).
18. **귀속 시점 고정**: 귀속·비용 합계 함수가 `asOf`를 받는다. 소급 등록 코드·늦게 넣은 코드는 표시만 하고 막지 않는다(2.4).

계획 줄 번호 표류도 같은 PR에서 고친다: `lib/store-marketing.ts:7`는 `:8`(`channelCatalog`), `lib/pii-scan.ts:5`는 `:126 scanText`, `lib/order-import.ts:80-84`는 `:78-90`, `lib/record-kinds.ts:116`는 `:152`다. `lib/store-attribution.ts:138`은 해당 설명 주석('같은 유입 채널의 비용 장부에서만')이 맞으므로 그대로 둔다. 계획 공유 파일 표의 `docs/DATA-PROCESSING.ko.md` 행(:1008) '레인 B 소유, 레인 B가 검토'는 `docs/LANES.ko.md`(:3 충돌 시 LANES 우선, :18-22 레인 A·R·Q뿐, 성장 계획 A·B 트랙은 레인 A)에 맞춰 '레인 A 검토'로 고친다.

## 1. 분할 제안

| 조각 | 내용 | 새 파일 | 고치는 파일(공유 파일은 굵게) | 선행 | 공수 |
|---|---|---|---|---|---|
| R5a 순수 모듈 | 모집 코드 형식·생성·발급·사용 중지 판정, 모집 채널, 코드 귀속(`asOf`), 비용 판정·무효화·기간 합계·정렬 창, CSV 해독·민감 열 이름·개인정보 검사·매핑·행 정규화·제공 증빙 형식·기간 겹침·해시·계획 해시 | `lib/franchise-recruitment.ts`, `lib/franchise-lead-import.ts`, `tests/recruitment-codes.test.mjs`, `tests/lead-import.test.mjs`, 테스트 고정 파일(가상 CP949·UTF-16 바이트) | `tests/franchise-model-boundary.test.mjs`(FORBIDDEN 2개), 계획 문서(R5 절, 공유 파일 표 :1008 행, 줄 번호 표류), `docs/STATUS.md` 레인 R 칸 | 레인 R 순서(STATUS 레인 R `다음:` 줄(:24) 'R3c(…) → R2 3차(…) → 트랙 R 계획 순서', 계획 :28 'R5 유입 코드·비용 → R15b …') | 0.25 |
| R5b-1 코드·비용 | `recruitment_code`·`recruitment_spend` kind, `code_issue`·`code_retire`·`spend_record`·`spend_void`, 리드 `add_lead_codes`·`strike_lead_code`, GET `codes`·`spend`, 보드 귀속·충돌 할 일, 행사 `spendRef` 존재 확인, 영수증 입력 해시 | `lib/franchise-recruitment-server.ts`, `tests/recruitment-route.test.mjs` | `lib/franchise-server.ts`, `lib/franchise.ts`, `lib/franchise-assets-server.ts`, **`lib/record-kinds.ts`**, **`tests/record-kinds.test.mjs`**, **`lib/feature-status.ts`**(사유 문구 끼워 넣기), **`docs/SECURITY-BOUNDARIES.ko.md`**, `tests/helpers/franchise-fixture.mjs`, `tests/franchise-assets-route.test.mjs`, `tests/franchise-model-boundary.test.mjs`, `tests/franchise-lib.test.mjs`, `docs/STATUS.md` 레인 R 칸 | R5a `merged` | 0.2 |
| R5b-2 리드 가져오기 | `recruitment_import` kind, `lead_import_inspect`·`lead_import_preview`·`lead_import_confirm`, GET `imports`, 가져오기 수집 근거·귀속 기준(2.7), '제공처 보관' 리드 상태와 작업 표(4.3), H11 적용 | `tests/lead-import-route.test.mjs` | `lib/franchise-lead-import.ts`·`lib/franchise-recruitment.ts`(2.7 추가), `lib/franchise-server.ts`, `lib/franchise.ts`, **`lib/record-kinds.ts`**, **`tests/record-kinds.test.mjs`**, **`docs/SECURITY-BOUNDARIES.ko.md`**, **`docs/DATA-PROCESSING.ko.md`**(3.5·4.1·DP-10 문장, 레인 A 검토), `tests/franchise-lib.test.mjs`, `tests/franchise-pipeline.test.mjs`, `tests/franchise-contacts.test.mjs`, `docs/STATUS.md` 레인 R 칸 | R5b-1 `merged`, **대표 질문 7.1(Q-R5-1·Q-R5-2)** | 0.15 |
| R5c 화면 | '유입·비용' 탭(코드·비용·가져오기), 리드 상세·보드의 코드·귀속·제외, 제공처 보관 리드의 연락처 붙이기, 행사 편집기의 비용 선택 | `app/franchise-inflow-panel.tsx` | `app/franchise-panel.tsx`, `app/franchise-lead-detail.tsx`, `app/franchise-common.tsx`, `app/franchise-events-panel.tsx`, **`lib/nav-state.ts`**, **`tests/nav-state.test.mjs`**, `tests/franchise-ui*.test.mjs`, `tests/franchise-recruit-ui.test.mjs`, `docs/STATUS.md` 레인 R 칸 | R5b-1(가져오기 화면은 R5b-2) | 0.15 |

합계 0.75 에이전트-주로 계획(:598)과 같다. 검토 반영으로 늘어난 작업(해독·탐지·정정 작업·`asOf`)은 조각 안에서 흡수하고, 넘치면 8절 시간 예산 규칙대로 멈추고 보고한다.

STATUS: 모든 R5 PR은 같은 PR에서 `docs/STATUS.md`의 레인 R 칸과 그 칸의 `갱신:` 시각만 고친다(`AGENTS.md` 현재 상태 절). 위임한 PR은 위임받은 에이전트가 PR 브랜치에서 고치고 위임자가 병합 전에 확인한다(8절 2항).

나누는 이유:

- **R4a·R15a-1 선례**: 순수 모듈은 공유 파일 없이 결정 없이 병합한다. 런타임 연결이 없어 운영 동작과 모델 입력 바이트가 바뀌지 않는다.
- **공유 파일 경합**: `lib/record-kinds.ts`·`lib/feature-status.ts`는 "먼저 연 PR" 규칙이고(`docs/LANES.ko.md:75`), 레인 A가 새 kind를 자주 더한다(B3·B4). kind를 쓰는 조각만 경합에 들어가게 한다.
- **대표 질문 격리**: 7.1의 답은 R5b-2만 바꾼다. 그래서 A안에만 뜻이 있는 규칙(수집 근거, 리드 모양, 가져오기 귀속, 가명 코드)은 R5a에 넣지 않고 R5b-2에서 더한다(2.7). R5b-1을 먼저 내면 R15b(모집 코드 QR)가 R5b-2를 기다리지 않는다.
- **리뷰 병목**: 대표 판단이 필요한 PR은 주 1개 이하다(계획 :38). 판단이 필요한 PR은 R5b-2 하나다.

공유 파일 병합 순서(계획 표를 R5a PR에서 고친다):

| 공유 파일 | 지금 순서 | R5 뒤 순서 |
|---|---|---|
| `lib/record-kinds.ts`, `tests/record-kinds.test.mjs` | R1 → R4b → R15a → R5 → R6 | 같음. R5b-1이 두 kind, R5b-2가 한 kind를 `recruitment_event`(:137) 바로 뒤, `data_request` 앞에 더한다. `tests/record-kinds.test.mjs:105`의 레인 R 위치 검사를 자기 항목만큼 고친다 |
| `docs/SECURITY-BOUNDARIES.ko.md` | R15a → R5 → R6 | 같음. R5b-1·R5b-2가 `:71`(행사 신청·참석 행) 뒤, `:72`(`r_franchise` 행) 앞에 행을 더한다 |
| `docs/DATA-PROCESSING.ko.md` | R4b → R7a → (R8 → R10) | R4b → **R5b-2** → R7a. 검토는 LANES에 따라 레인 A다(계획 :1008의 '레인 B'는 R5a PR에서 고친다) |
| `lib/nav-state.ts`, `tests/nav-state.test.mjs` | R4b → R6 | R4b → R15a-2b(이미 탭 2개를 더함) → **R5c** → R6 |
| `lib/feature-status.ts` | 먼저 연 PR | 가맹 행 사유(:105)의 ' · 법정 절차 판정(COLLECTIVE 휴리스틱 · 법률 자문 아님)' 바로 앞에 ' · 유입 코드·모집 비용(대표·관리자)'를 끼워 넣는다(R15a-2b가 같은 자리에 넣었다). 검사는 `includes()`라 안전하다(`tests/feature-status.test.mjs:107-109`) |

착수 때마다 `git fetch origin --prune`으로 `origin/main`을 확인하고, 열린 PR의 파일 목록과 대조한다(계획 규칙 2). 게시는 하지 않는다. 병합 뒤 STATUS 게시 대기열에 `- #PR · 레인 R · 보통 · 새 스위치 없음(r_franchise 기본 꺼짐)` 요청 줄만 더한다.

## 2. 순수 모듈 계약 (R5a, 2.7만 R5b-2)

### 2.1 공통 규칙

- **import 허용**:
  - `lib/franchise-recruitment.ts`: `./tracking-codes`(`CODE_ALPHABET`·`normalizeCode`만), `./pii-scan`(`scanText`), `./franchise-rules`(`isDate`·`isInstant`·`parseInstant`·`toKstDate`·`addDays`), `./franchise-gates`(`GATE_DISCLAIMER`), `./agency`(`isRecruitmentObjective`).
  - `lib/franchise-lead-import.ts`: `./order-import`(`parseCsv`·`IMPORT_LIMITS`만), `./franchise-recruitment`, `./pii-scan`, `./franchise-rules`, `./franchise`(`BUDGET_LABELS`·`TIMING_LABELS`·`UNCONVERTED_RETENTION_DAYS`).
- **import 금지**: `./server`, D1, `./feature-flags`, `./franchise-server`, `./franchise-crypto`, `./store-marketing`, `./store-attribution`, `./store-operations-server`, `./execution*`, `./hermes`. 금지 목록은 구문 검사(RC-S1·LI-S1)로 고정한다.
- **점포 모듈 쪽**: `ImportError`는 import하지 않는다. `parseCsv`가 던지는 오류는 모두 CSV 구조 오류로 본다. 그 문구에는 줄 번호와 한도만 있다(`lib/order-import.ts:29-55`). 주문 전용 문구 '가져올 주문 행이 없습니다.'(`:48`)만 '가져올 리드 행이 없습니다.'로 바꾼다.
- **순수성**: 현재 시각·난수·조회 결과는 모두 인자로 받는다(`now`, `today`, `random`, `taken`, 코드 목록, 이전 가져오기 기간). 모듈 안에서 시계를 읽지 않는다. 해시는 `crypto.subtle`을 쓰는 async 함수다(`assetBodyHash` 선례, `lib/franchise-assets.ts:319`). 브라우저와 서버가 같은 함수를 쓴다(2.6.3 사전 검사).
- **상수는 얼린다**: 내보내는 상수는 `deepFreeze`하고 정규식은 비공개로 두고 얼린 사본만 내보낸다(`lib/franchise-assets.ts:11-31` 관례).
- **객체 입력**: 사용자 입력 객체는 `Object.keys`로만 돌고 허용 목록과 `Object.hasOwn`으로 대조한다. 결과 객체는 `Object.create(null)`로 만든다. `__proto__`·`constructor` 키는 400이고 예외를 던지지 않는다.
- **확장자 없는 상대 import**만 쓴다. 기존 로더가 '.ts'를 붙인다.

### 2.2 모집 채널

```ts
export const RECRUITMENT_CHANNELS=deepFreeze([
 {key:'portal',label:'창업 포털'},{key:'search_ad',label:'네이버 검색광고'},{key:'expo',label:'박람회'},
 {key:'briefing',label:'사업설명회'},{key:'lead_ad',label:'메타 리드광고'},{key:'youtube',label:'유튜브'},
 {key:'blog_post',label:'블로그'},{key:'store_qr',label:'매장 QR'},{key:'owner_referral',label:'점주 추천'},
 {key:'community',label:'커뮤니티'}] as const);
export type RecruitmentChannel=typeof RECRUITMENT_CHANNELS[number]['key'];
export const PROVENANCE_CHANNELS=deepFreeze(['portal','expo'] as const);   // 동의 증빙 참조 필수 채널
export const EVENT_CHANNELS=deepFreeze(['expo','briefing'] as const);      // 행사 연결·날짜만 접수 시각 허용 채널
```

- 순서와 이름은 계획 :738과 같다.
- 키는 점포 채널 키(`lib/store-marketing.ts:8` `channelCatalog`의 11개)와 겹치지 않게 골랐다. 한쪽 장부의 채널 값을 다른 쪽 집계가 조용히 받는 일을 막는다. 테스트는 점포 모듈을 import하지 않고 점포 키 문자열 목록으로 대조한다.
- 리드의 `task.sourceChannel`(접수 방식 7개, `lib/franchise.ts:27`)과는 다른 축이다. 코드 귀속의 모집 채널은 코드에서만 나온다. 코드 없는 리드의 모집 채널을 `sourceChannel`로 추정하지 않는다(계획 A3). 가져온 리드의 '제공처 파일 기준' 채널(2.7.3)은 추정이 아니라 가져오기 기록의 채널이고, 코드 귀속과 다른 열로 센다.
- 참고용 소재 유형 대응(경고용, 차단 아님):

  | R15a 자료 유형 | 채널 |
  |---|---|
  | `naver_search` | `search_ad` |
  | `meta_lead_ad` | `lead_ad` |
  | `portal_intro` | `portal` |
  | `expo_banner` | `expo` |
  | `event_deck` | `briefing` |
  | `startup_page`·`first_call_script` | 제한 없음 |

### 2.3 모집 코드

```ts
export const RECRUITMENT_CODE_PREFIX='R',RECRUITMENT_CODE_BODY=7;             // 전체 8자
export function normalizeRecruitmentCode(raw:unknown):string                  // normalizeCode 그대로(NFKC·대문자·공백·하이픈 제거)
export function isRecruitmentCode(code:unknown):code is string                // ^R[CODE_ALPHABET]{7}$
export function generateRecruitmentCode(random:Uint8Array):string|null        // 248 이상 바이트는 버린다. 모자라면 null
export function recruitmentTokens(cell:string):{codes:string[];dropped:number;truncated:boolean}
export function recruitmentUtmQuery(code:{code:string;utmCampaign:string|null}):string
export function codeIssueDecision(input:unknown,ctx:CodeIssueContext):RecruitmentDecision<CodeIssueValue>
export function codeRetireDecision(code:unknown,input:unknown,ctx:CodeRetireContext):RecruitmentDecision<{retiredOn:string}>
```

- **형식**: R + 7자를 고정한다. 점포 접두어(C·Q·P·U, `lib/tracking-codes.ts:10`)에 R이 없어서 점포 생성 코드와는 겹치지 않는다. 리드 코드의 L은 `CODE_ALPHABET`에 없어서 모집 코드와 겹치지 않는다(`lib/franchise.ts:328-333`). 8자라서 여권 후보 패턴(`[MSRGD]` + 숫자 8자리 또는 3+영문+4, `lib/pii-scan.ts:75`)에 걸리지 않는다. 테스트는 생성 코드 2만 개를 `scanText`에 넣어 0건을 확인한다.
- **생성**: `generateCode`(`lib/tracking-codes.ts:22`)는 접두어가 비공개라 R을 못 만든다. 같은 거부 표집을 다시 구현한다(`leadSystemCode` 선례, `lib/franchise.ts:330`).
- **직접 입력**: 정규화 뒤 `isRecruitmentCode`여야 한다. 아니면 400 `code_format`이고 문구에 값을 싣지 않는다. 인쇄물에 먼저 쓴 코드를 등록하는 경로다.
- **토큰 추출** `recruitmentTokens`:
  1. 칸을 왼쪽부터 읽는다. `utm_content=`는 대소문자를 가리지 않는다(`parseUtm`이 키를 소문자로 바꾸는 것과 같다, `lib/tracking-codes.ts:35`). 칸 안의 모든 `utm_content` 값을 꺼낸다. 값은 `& # 공백 , ; |` 앞까지이고 `decodeURIComponent`를 한 번 시도한다(실패는 원문). `parseUtm`은 import 금지라 최소 파서를 다시 구현한다.
  2. `=`가 든 덩어리(주소·쿼리)를 뺀 나머지를 `, ; | / 공백 줄바꿈`으로 나눈다.
  3. 두 결과를 칸 안 위치 순서로 합치고 정규화한다. R 형식 토큰만 먼저 나온 것을 남기고 중복을 버린다. 최대 5개다. 버린 수(`dropped`, 점포 코드 C… 포함)와 잘림 여부를 돌려준다.
- **UTM**: `recruitmentUtmQuery`는 `utmCampaign`이 있을 때만 `utm_campaign=<값>&utm_content=<코드>`를 돌려준다. 코드는 워크스페이스 안에서 유일하므로 귀속은 코드 값으로만 맞춘다. `utm_campaign`이 달라도 막지 않는다. 점포의 `matchCode`(`:45`)와 다르다.
- **발급 입력**: `{channel, label, validFrom?, customCode?, campaignId?, assetRef?:{id,version}, eventId?, utmCampaign?}`.
- **발급 문맥** `CodeIssueContext`: `{enabled, brandId, branch, actor:{id,role}, today:'YYYY-MM-DD'(KST), campaign:CampaignLite|null, asset:AssetLite|null, event:{id,brandId,status}|null, taken:{tracking:boolean;recruitment:boolean}}`.
  - `AssetLite={id, version, brandId, status:'draft'|'approved'|'retired', reviewNeeded:boolean, current:boolean}`. `current`는 `assetRef.version`이 그 자료의 지금 판인지다(`RecruitmentAsset.status`·`review.needed`, `lib/franchise-assets.ts:107`, `:112-115`).
  - `taken`은 직접 입력 코드이거나 서버가 만든 후보 코드에 대해 서버가 조회해서 넘긴다.
- **입력 규칙**:
  - `label`: NFC·trim 1~60자, 제어·보이지 않는 문자 금지(`hasControl` 관례), `scanText` 0건.
  - `validFrom`: 없으면 `today`다. `today−90일 ≤ validFrom ≤ today+180일`.
  - `utmCampaign`: 소문자 `^[a-z0-9][a-z0-9_.-]{0,59}$`. 점포 규칙과 같은 식을 다시 구현한다.
  - 캠페인: 같은 브랜드이고 `isRecruitmentObjective`여야 한다. 행사: 같은 브랜드이고 취소되지 않아야 한다.
  - 자료 판: 같은 브랜드이고 `status==='approved'`, `!reviewNeeded`, `current`여야 한다. 아니면 409 `asset_not_approved`·`asset_review_needed`·`asset_superseded`다. 폐기했거나 사실 변경으로 재검토가 걸린 판에 새 코드를 잇지 않는다.
- **판정 단계**: 스위치(409) → 역할(403, 대표·관리자만) → 입력(400) → 상태(409: 분기 A 아님, 캠페인 목적 아님, 자료 상태, 행사 취소, 코드 사용 중). 첫 실패 단계에서 멈추고 그 단계의 코드를 모두 정렬해 돌려준다. 한 단계의 코드는 같은 상태 코드다(R15a-1 규칙).
  - 분기 A가 아니면 발급을 막는다(0.2의 8).
- **발급 값**: `{code, channel, label, validFrom, campaignId|null, assetRef|null, eventId|null, utmCampaign|null}`. 발급 뒤에는 고치지 않는다. 연결을 바꾸려면 새 코드를 발급하고 옛 코드를 사용 중지한다.
- **사용 중지** `codeRetireDecision`: 입력 `{retiredOn?}`(KST 날짜, 없으면 `today`). `max(today, code.validFrom) ≤ retiredOn ≤ today+180`이어야 한다(과거로 소급하지 않는다, 400 `retire_date_invalid`). 이미 사용 중지면 409 `code_already_retired`. 역할은 대표·관리자이고 스위치가 꺼져도 된다(보호 방향). 과거 리드의 잘못된 귀속은 리드별 제외(4.3 `strike_lead_code`)로 고친다.

### 2.4 귀속

```ts
export type AssetRef={id:string;version:number};
export type TrackingValue={value:string;createdAt:string};
export type CodeBook={codes:readonly RecruitmentCodeLite[];tracking:readonly TrackingValue[]};
export type RecruitmentCodeLite={code:string;brandId:string;channel:RecruitmentChannel;validFrom:string;createdAt:string;
 retiredOn:string|null;retiredAt:string|null;campaignId:string|null;assetRef:AssetRef|null;eventId:string|null};
export type LeadCodes={brandId:string;receivedAt:string;codes:readonly {code:string;at:string;source?:'manual'|'import'}[];strikes:readonly {code:string;at:string}[]};
export type LeadAttribution=
 |{state:'attributed';basis:'code';code:string;channel:RecruitmentChannel;campaignId:string|null;assetRef:AssetRef|null;eventId:string|null;alsoMatched:number;retroactive:boolean;late:boolean}
 |{state:'conflict';code:string}
 |{state:'unattributed';reason:'no_code'|'unknown_code'|'other_brand'|'before_valid_from'|'after_retired'};
export function attributeLead(lead:LeadCodes,book:CodeBook,opts?:{asOf?:string}):LeadAttribution
export function attributionInputs(lead:LeadCodes&{id:string},book:CodeBook,opts?:{asOf?:string}):string[]   // 정렬한 입력 id 목록(R6 증빙 해시용)
export function attributionLabel(a:LeadAttribution):{label:string;detail:string|null}
export function receivedAtOf(lead:{receivedAt?:string;createdAt:string}):string   // receivedAt ?? createdAt
export const UNATTRIBUTED_LABEL='유입 미확인';
export const LATE_TOKEN_HOURS=72;
export const RECRUITMENT_ATTRIBUTION_NOTE='귀속≠증분: 모집 코드로 귀속된 리드는 그 채널·자료가 없었어도 들어왔을 수 있습니다. 귀속 수치는 채널·자료의 인과 효과를 증명하지 않습니다.';
```

**시점 고정 `asOf`** (없으면 제한 없음): 아래 규칙은 `asOf` 이하의 기록만 본다.

- 리드 토큰은 `at ≤ asOf`, 제외 기록은 `at ≤ asOf`만 본다.
- 모집 코드는 `createdAt ≤ asOf`만 있다고 본다. 사용 중지는 `retiredAt ≤ asOf`일 때만 적용한다.
- 점포 코드 값은 `createdAt ≤ asOf`만 충돌로 본다. 그래서 `tracking`은 값만의 `Set`이 아니라 `{value, createdAt}` 목록이다.

**규칙** (입력 순서대로 토큰을 본다):

1. 제외 기록(`strikes`)에 같은 코드가 있는 토큰은 없는 것으로 본다.
2. 같은 값의 `recruitment_code`가 없으면 건너뛴다(`unknown_code` 후보). 다른 브랜드 코드도 건너뛴다(`other_brand` 후보).
3. `kstDate(receivedAt) < validFrom`이면 건너뛴다(`before_valid_from` 후보). 사용 중지가 적용되고 `kstDate(receivedAt) ≥ retiredOn`이면 건너뛴다(`after_retired` 후보). 비교는 KST 날짜 문자열이다. 예: `2026-10-05T15:00:00Z`는 KST 10-06이다.
4. 여기까지 온 첫 토큰이 결정한다. 같은 값이 `tracking`에 있으면 `conflict`이고, 다음 토큰으로 넘어가지 않는다(보수). 없으면 `attributed`다.
   - `alsoMatched`: 뒤따르는 유효 토큰 가운데 다른 채널·캠페인·자료를 가리키는 수(정보용).
   - `retroactive`: 코드의 `createdAt`이 그 토큰의 `at`보다 늦다(리드에 먼저 적힌 값을 나중에 코드로 등록했다). 인쇄물 선등록처럼 정상 경로일 수 있어 막지 않는다.
   - `late`: `source`가 `'import'`가 아닌 토큰에서 `at` − `receivedAt` > 72시간(`LATE_TOKEN_HOURS`, 정확히 72시간은 아님). 나중에 코드를 넣어 귀속을 만든 경우를 드러낸다. 가져온 파일에 처음부터 있던 코드(`source:'import'`)는 늦은 입력이 아니다.
5. 결정한 토큰이 없으면 `unattributed`다. 사유는 남은 토큰이 없으면 `no_code`, 있으면 후보 가운데 `before_valid_from` → `after_retired` → `other_brand` → `unknown_code` 순서다.

**표시**: `unattributed`는 모두 '유입 미확인'이고 사유는 부가 문구로 보인다('코드 없음', '적용 시작일 전 접수', '사용 중지 뒤 접수', '다른 브랜드 코드', '등록되지 않은 코드'). `conflict`는 '유입 미확인 · 점포 코드와 같은 값'이다. `retroactive`·`late`는 '소급 등록 코드'·'접수 72시간 뒤 입력' 배지다. R6는 두 표시가 있는 귀속을 따로 센다.

**계산 시점**: 귀속은 저장하지 않고 읽을 때 계산한다(보드·리드 상세·코드 보기). 이유:

- 점포 관리자가 R로 시작하는 코드를 나중에 직접 만들 수 있다. 두 발급 경로는 잠금이 다르다(점포 `owner`, 가맹 `owner+':franchise'`). 그래서 충돌은 읽을 때에만 빠짐없이 드러난다.
- R6 확정 스냅샷은 `asOf`를 스냅샷 시각으로 고정해 다시 계산한다. 그 뒤의 코드 추가·제외·사용 중지·점포 코드 생성은 확정한 주의 값을 바꾸지 않는다(계획 :756 '재집계가 다르면 409'가 성립한다). `attributionInputs`는 쓴 기록 id·판을 정렬해 돌려주고 R6 증빙 묶음 해시에 들어간다.

**리드 쪽 입력**: `LeadRecord.codes`(4.2)에 추가만 한다. 첫 유효 코드가 나중에 넣은 코드로 바뀌지 않게 하려는 것이다. 접수 시각보다 늦게 넣어도 비교는 접수 시각으로 한다(`late`로 드러난다).

**접수 시각** `receivedAtOf`: 수기 리드는 `createdAt`(서버 시각), 가져온 리드는 `receivedAt`(제공처 시각)이다. R6 코호트는 이 함수를 쓴다.

### 2.5 모집 비용

```ts
export type SpendInput={channel:unknown;date?:unknown;period?:{from:unknown;to:unknown};amount:unknown;vat:unknown;funding:unknown;evidence:unknown;
 original?:{currency:unknown;amount:unknown};campaignId?:unknown;assetRef?:unknown;platform?:{impressions?:unknown;clicks?:unknown;formSubmits?:unknown};
 acknowledgeDuplicate?:unknown;replacesSpendId?:unknown};
export function spendDecision(input:unknown,ctx:SpendContext):RecruitmentDecision<SpendValue>
export function spendVoidDecision(row:unknown,input:unknown,ctx:SpendVoidContext):RecruitmentDecision<{reason:SpendVoidReason}>
export function spendInWindow(rows:readonly SpendRow[],from:string,to:string,opts?:{asOf?:string}):
 {included:SpendRow[];straddling:SpendRow[];byChannel:Record<string,{total:number;rowCount:number;straddlingCount:number}>;inputs:string[]}
export function alignedWindow(rows:readonly SpendRow[],channel:string,from:string,to:string,opts?:{asOf?:string}):{from:string;to:string;expanded:boolean}|null
export const PLATFORM_REPORTED_NOTE='플랫폼 보고, 원장 리드 아님';
export const NO_PRORATION_NOTE='기간 비용은 일할하지 않습니다. 보고 기간에 일부만 걸친 비용은 따로 보입니다.';
```

**금액 정의**: 정본 금액은 그 서비스 기간에 실제로 소진한 비용의 부가세 제외 원화 금액이다. 선충전·충전금은 비용이 아니다(검색광고 선불 충전은 소진액을 적는다). 날짜는 KST다. 플랫폼이 계정 시간대로 보고해도 KST 날짜로 옮겨 적는다.

**필수 입력**:

- `channel`: 2.2의 키만 받는다. 점포 키(`naver_place` 등)는 400 `channel_unknown`이다.
- `date` 또는 `period` 가운데 정확히 하나: KST `YYYY-MM-DD`, `from ≤ to ≤ today`, 길이 366일 이하. 둘 다 주거나 둘 다 없으면 400이다. 저장·비교 전에 `date`는 `period{from:d,to:d}`로 바꾼다.
- `amount`: 원 단위 safe integer, 0 ~ 1e11. 음수는 400 `amount_negative`, 소수·문자열·NaN은 400 `amount_invalid`다. 0은 받는다(무료 채널 활동 기록).
- `vat`: `'excluded'` 또는 `'included'`. 없거나 다른 값은 400 `vat_invalid`다. 저장 행은 입력 금액과 `amountExVat`(정본)를 함께 둔다. `included`면 `amountExVat=floor(amount×10/11)`(원 미만 버림, 휴리스틱)이고, 계산서 공급가액을 알면 `excluded`로 그 값을 넣으라고 안내한다.
- `funding`: `'hq_budget'`(본부 모집 예산)만 받는다. `'ad_fund'`(광고분담금)는 400 `ad_fund_forbidden`, 그 밖은 400 `funding_invalid`다. **이 출처 값이 실제 통제다.**
- `evidence`: 금액의 출처 라벨(예: '관리 화면 월 소진 내역'). 1~200자, 제어 문자 금지, `scanText` 0건이어야 한다.

**선택 입력**:

- `original`: 외화 청구일 때만. `{currency:/^[A-Z]{3}$/ 이고 'KRW' 아님, amount:/^\d{1,12}(\.\d{1,2})?$/}`. 정보용이고 합계에는 `amountExVat`(원화 결제액 기준)만 쓴다. 틀리면 400 `original_invalid`다.
- `campaignId`: 같은 브랜드의 모집 목적 캠페인.
- `assetRef`: 같은 브랜드이고 2.3과 같은 자료 상태 조건(`approved`·재검토 없음·지금 판)을 채운 `recruitment_asset` 판. 채널과 맞지 않으면 경고 `asset_channel_mismatch`다.
- `platform.impressions`·`clicks`·`formSubmits`: 각각 null 또는 0 이상 safe integer다. 모르면 null이고 0으로 바꾸지 않는다. `clicks > impressions`는 경고다. 저장 행과 응답에 `PLATFORM_REPORTED_NOTE`를 붙인다.
- `replacesSpendId`: 같은 브랜드·같은 채널의 유효 행이어야 한다(아니면 409 `spend_replace_invalid`). 새 행 INSERT와 옛 행 무효화(사유 `replaced`)를 한 batch에 쓴다. 부분 환불은 이 경로로 순액을 다시 적는다.
- `acknowledgeDuplicate`: `true`일 때만 아래 두 409를 경고로 낮춘다.

**결정 27 검사**:

- **광고분담금 문구(보조)**: 증빙 문구를 NFKC로 바꾸고 공백·문장부호·기호(`[\s\p{P}\p{S}]`)를 없애고 소문자로 바꾼 뒤 `광고분담금|판촉분담금|광고비분담|판촉비분담|광고기금|판촉기금|공동광고|점주부담광고|가맹점부담광고|점주분담|가맹점분담|adfund|애드펀드` 가운데 하나가 있으면 400 `ad_fund_forbidden`이다. 맨 '분담금'은 넣지 않는다('분담금 없음(본부 전액 부담)'을 막지 않으려고). 출처 값을 속여 넣는 경우를 잡는 넛지이고 완전한 검사가 아니다.
- **점주 추천 금전 보상**: `channel==='owner_referral'`이고 `amount>0`이면 400 `referral_reward_forbidden`이다(결정 27, Q9 전). 점주 추천 활동 기록은 금액 0으로 적는다. 추천 카드 인쇄 같은 제작비는 해당 매체 채널(`store_qr` 등)로 적는다.
- **성과 수수료형 영업대행**: 같은 정규화 뒤 `영업대행|분양대행|성과수수료|성공보수|커미션|commission`이 있으면 경고 `agency_fee_wording`('모집 위탁 계약 밖 성과 수수료형 영업대행은 1차에 쓰지 않습니다(결정 27)')다. 위탁 계약을 맺은 가맹중개인 비용일 수 있어 막지 않는다.
- 결정 27은 아직 권고지만 권고는 대표가 다르게 정하지 않으면 쓰는 기본값이다(계획 :1034). Q9·Q10 회신 뒤 허용하면 출처 값·채널 규칙을 바꾸는 코드 PR로 한다.

**중복·겹침** (문맥으로 같은 브랜드의 유효 행 요약 `{id, channel, period, amountExVat, campaignId, assetRef}`를 받는다. `replacesSpendId` 행은 뺀다):

- `spend_possible_duplicate` 409: 같은 채널·같은 기간(정규화 뒤)·같은 `amountExVat`인 유효 행이 있다.
- `spend_period_overlap` 409: 같은 채널·`campaignId`·`assetRef`이고 기간이 하루라도 겹치는 유효 행이 있다(월 청구와 주 청구를 둘 다 적는 경우).
- 둘 다 `acknowledgeDuplicate:true`면 200과 경고 `duplicate_acknowledged`다. 응답의 기존 행 요약은 id·기간·금액만 싣는다.

**경고**: `search_ad`는 '네이버 검색광고 비용은 수기 입력입니다(API 연동 없음)'. 그 밖에 위의 `asset_channel_mismatch`·`clicks_exceed_impressions`·`agency_fee_wording`·`duplicate_acknowledged`.

**판정 단계**: 스위치(409) → 역할(403) → 입력(400) → 상태(409: 캠페인 목적 아님, 자료 상태, 중복·겹침, 교체 대상). 비용 기록에는 분기 검사를 두지 않는다. 쓴 돈의 기록은 분기와 관계없이 사실대로 남긴다(설계 원칙 3의 기록·게이트 분리).

**무효화** `spendVoidDecision`: 사유는 `entry_error`·`duplicate`·`refunded`만 받는다(`replaced`는 `replacesSpendId`로만 생긴다). 이미 무효화한 행은 409 `spend_already_voided`다. 행사 `spendRef`가 가리키는 행은 409 `spend_referenced`다(행사의 비용 연결을 먼저 바꾼다). 문맥 `referencedBy`(행사 id 수)는 서버가 조회한다. 역할은 대표·관리자다. 스위치가 꺼져도 된다(보호 방향). `replacesSpendId`도 같은 참조 검사를 받는다.

**기간 합계** `spendInWindow`:

- 무효화 행은 뺀다. 단 `asOf`가 있으면 `createdAt ≤ asOf`인 행만 보고, `voided.at > asOf`인 무효화는 아직 없던 것으로 본다.
- 기간이 창 안에 완전히 들어간 행만 `included`와 채널 합계에 넣는다. 일부만 걸친 행은 `straddling`으로 따로 돌려주고 나누지 않는다.
- `byChannel`은 행이 하나라도 있는 채널만 담는다. 채널 키가 없으면 '비용 모름'(R6 null)이고, 합계 0과 다르다.
- `inputs`는 쓴 행의 `id@version`을 정렬한 목록이다(R6 증빙 해시).

**R6 CPL 규칙(이 함수의 계약으로 적어 둔다)**: 채널의 `straddlingCount>0`이면 그 창의 CPL은 null이고 '비용 기간 불일치'로 표시한다. 대안으로 `alignedWindow`가 걸친 행을 모두 품도록 창을 넓힌 `{from,to}`를 돌려준다(366일을 넘으면 null). 월 청구 행이 주간 창에 걸쳐 분자만 빠지고 분모는 남는 과소 CPL을 막는다. R6은 두 함수를 수정 없이 쓴다.

### 2.6 리드 CSV (`lib/franchise-lead-import.ts`)

#### 2.6.1 한도·대상·매핑

```ts
export const LEAD_IMPORT_LIMITS=deepFreeze({maxBytes:100000,maxBase64:133336,maxRows:200,maxCodesPerRow:5,maxErrors:50,maxPiiPositions:20,
 maxAgeDays:UNCONVERTED_RETENTION_DAYS,maxPeriodDays:180,futureToleranceMs:300000,expiringWarnDays:14});
export const LEAD_IMPORT_TARGETS=deepFreeze({receivedAt:'접수 시각',region:'희망 시·도·시·군·구',budgetBand:'예산 구간',timingBand:'희망 시기',codes:'모집 코드',landingUrl:'유입 주소(utm_content)'});
export const FORBIDDEN_TARGETS=deepFreeze(['name','phone','email','address','birthDate','residentId','gender','account','card','memo','message','externalId','ip']);
export const SIDO_NAMES=deepFreeze([/* 17개 시·도의 정식·약칭(예: 서울·서울시·서울특별시, 경기·경기도, 강원·강원도·강원특별자치도, 전북·전라북도·전북특별자치도, 제주·제주도·제주특별자치도) */]);
```

- 바이트·행 한도는 `IMPORT_LIMITS`보다 작거나 같다. `maxAgeDays`는 `UNCONVERTED_RETENTION_DAYS`를 그대로 쓴다(값을 다시 적지 않는다). 테스트로 고정한다.
- 매핑은 `{대상: 열 번호(0부터)}`이고 한 열은 한 대상에만 쓴다. `receivedAt`만 필수다.
  - 열 번호는 `Number.isSafeInteger(i) && 0 ≤ i < headers.length`여야 한다. 문자열 '0', 음수, 소수, 범위 밖은 400 `mapping_invalid`다.
  - 키는 `Object.keys`로만 돌고 `LEAD_IMPORT_TARGETS`와 `Object.hasOwn`으로 대조한다. `__proto__`·`constructor` 키는 400 `mapping_invalid`이고 예외를 던지지 않는다.
  - 금지 대상 키는 400 `mapping_forbidden`, 그 밖의 모르는 대상은 400 `mapping_invalid`다. 민감·고유식별 열과 문의 내용 같은 자유 텍스트는 매핑할 대상 자체가 없다(계획 I4, R4b에서 메모는 암호문 칸이다).
- **민감 열 이름** `isSensitiveHeader(header)`: 매핑과 관계없이 **모든 머리글**에 적용한다(2.6.3 2단계). 두 목록은 얼린 상수이고 테스트가 항목마다 확인한다.
  - 한국어(NFKC, 공백 제거 뒤 포함 검사): 이름·성명·성함·신청자·고객명·회원명·대표자·예비창업자·문의자·담당자·닉네임·아이디·연락처·전화·휴대폰·핸드폰·휴대전화·이메일·메일·카카오·카톡·주소·거주·생년·생일·나이·연령·주민·성별·계좌·카드·직업·직장·소득·자산·재산·건강·종교·문의내용·내용·메모·비고·요청사항·질문·의견·남기실.
  - 영어(소문자, 영숫자 밖 문자로 나눈 토큰): 토큰 하나라도 phone·mobile·tel·telephone·email·mail·address·addr·birth·birthday·birthdate·dob·gender·sex·age·account·card·memo·message·comment·note·notes·nickname·username·kakao·income·job·occupation이면 민감이다. `name`은 토큰이 `name` 하나이거나 앞 토큰이 full·first·last·user·customer·applicant·contact일 때만, `id`는 토큰이 `id` 하나이거나 앞 토큰이 lead·user·member·customer·applicant·kakao일 때만 민감이다. 그래서 메타 리드광고 내보내기의 `campaign_name`·`ad_name`·`form_id`는 통과하고 `full_name`·`phone_number`·`id`는 걸린다.
  - 걸리지 않는 예: 접수일시·신청일시·문의일시·희망지역·창업예산·희망시기·유입코드·모집코드.
- **추천 매핑** `suggestLeadMapping(headers)`: 별칭이 정확히 같은 머리글만 추천한다. 별칭 예:
  - `receivedAt`: 접수일시, 신청일시, 문의일시, 등록일시, 접수일(박람회·설명회)
  - `region`: 희망지역, 창업희망지역, 지역
  - `budgetBand`: 예산, 창업예산
  - `timingBand`: 희망시기, 창업시기
  - `codes`: 모집코드, 유입코드, 코드
  - `landingUrl`: 유입URL, 랜딩URL

#### 2.6.2 전송과 인코딩

```ts
export function decodeLeadCsv(bytes:Uint8Array):Promise<{ok:true;text:string;hadBom:boolean;fileSha256:string}|{ok:false;reason:'file_too_large'|'encoding_invalid'}>
export function base64Bytes(s:unknown):Uint8Array|null        // 표준 base64 알파벳·패딩만, 133,336자 이하
```

1. **전송**: 화면은 파일을 `ArrayBuffer`로 읽어 `csvBase64`로 보낸다. 서버는 `base64Bytes`로 되돌린다. 알파벳·패딩이 틀리거나 133,336자를 넘으면 400 `encoding_invalid`·`file_too_large`다.
2. **크기**: 바이트가 100,000을 넘으면 400 `file_too_large`다.
3. **해독**: `new TextDecoder('utf-8',{fatal:true})`로 바꾼다. 실패하면 400 `encoding_invalid`다.
   - 앞의 UTF-16 BOM(`FF FE`·`FE FF`)은 400 `encoding_invalid`다.
   - UTF-8 BOM(`EF BB BF`)은 하나만 떼고 `hadBom:true`로 둔다.
   - 해독한 글에 U+FFFD나 U+0000이 있으면 400 `encoding_invalid`다. 한국어 표 계산기의 'CSV(쉼표로 분리)'는 CP949로 저장하는 경우가 많다. CP949 바이트는 UTF-8로 읽으면 깨진 글자가 되어 머리글 검사와 한글 주소 탐지를 통과해 버리므로 여기서 멈춘다.
   - 문구: '이 파일은 UTF-8 CSV가 아닙니다. 표 계산기에서 "CSV UTF-8"로 다시 저장하거나, 화면의 "EUC-KR로 읽기"를 눌러 주세요.'
4. **EUC-KR 변환(화면만)**: 화면은 `encoding_invalid`를 받으면 'EUC-KR로 읽기'를 보인다. 브라우저의 `TextDecoder('euc-kr')`로 읽어 UTF-8로 다시 인코딩한 바이트를 보내고 `transcodedFrom:'euc-kr'`를 붙인다. 이때 파일 해시는 변환본 바이트의 해시이고 기록에 변환 사실을 남긴다(디스크 파일의 해시와 다르다고 화면에 적는다).
5. **파일 해시** `fileSha256`: 받은 원본 바이트(BOM 포함)의 SHA-256이다. 디스크의 `sha256sum`과 같다(변환본 제외). R6 증빙 묶음이 원본 파일과 이 값을 잇는다. BOM만 다른 두 파일은 해시가 다르고 행은 같다. 그 경우 기간 겹침 규칙(2.6.4)이 두 번째 파일의 행을 건너뛴다.
6. **구조**: 해독한 글로 `parseCsv`를 부르고, 던진 오류는 400 `csv_invalid`로 바꾼다. 문구는 그대로 쓰되 주문 문구 하나만 리드 문구로 바꾼다. CRLF·따옴표 처리는 `parseCsv`를 따른다. 데이터 행이 200을 넘으면 400 `too_many_rows`다.

#### 2.6.3 민감 열 이름과 개인정보 검사 (계획 I2)

검사는 두 단계이고 앞 단계에서 걸리면 뒤 단계를 하지 않는다. 어느 쪽이든 400으로 파일 전체를 거부하고 아무것도 만들지 않는다.

**1단계 머리글** (400 `sensitive_column_in_file`): 머리글 하나라도 `isSensitiveHeader`이거나, 머리글 값 자체가 아래 `importPiiHits`에 걸리면 거부한다. `errors`는 `{column:'3번째 열'}`처럼 열 번호만 싣는다(머리글 자체가 이름·연락처일 수 있다). 문구: '이름·연락처·주소·생년월일·문의 내용 같은 열이 있어 파일 전체를 가져오지 않았습니다. 해당 열을 지운 파일로 다시 올려 주세요.' 이 단계가 분리된 휴대폰 열(휴대폰1·2·3), 이름·생년월일·가린 번호 열처럼 값 패턴으로 못 잡는 열을 구조로 막는다.

**2단계 칸 값** (400 `pii_in_file`): 모든 칸을 `importPiiHits(cell)`로 검사한다. 걸린 칸마다 `{row, column}`을 싣는다(최대 20개, 나머지는 건수만). `row`는 `parseCsv`의 실제 줄 번호(`lines`, 머리글 1행)이고 `column`은 1단계를 통과한 머리글 이름이다.

`importPiiHits(cell)`은 가져오기 전용이다. `lib/pii-scan.ts`는 레인 A 파일이라 고치지 않는다.

1. 원문에 `scanText`를 돌린다.
2. 정규화 사본을 만든다: 유니코드 숫자(`\p{Nd}`)를 ASCII로 바꾸고, `%`가 있으면 `decodeURIComponent`를 한 번 시도한다(실패는 원문). 사본에 `scanText`를 다시 돌린다.
3. 사본에 가져오기 전용 탐지를 돌린다:
   - 앞 0이 빠진 휴대폰(칸 전체): `^1[016789]\d{8}$`, `^1[016789][-. ]\d{3,4}[-. ]\d{4}$`.
   - 국가번호 00: `(?<!\d)00[-. ]?82[-. ]?0?1[016789]`.
   - 표 계산기 지수 표기(칸 전체): `^\d(\.\d+)?E\+\d+$`(대소문자 무시). 숨은 긴 번호로 본다.
   - 가린 휴대폰: `(?<!\d)01[016789][-. ]?[\d*]{3,4}[-. ]?[\d*]{4}(?!\d)`이면서 `*`가 하나 이상. 가린 주민등록번호: `(?<!\d)\d{6}[-. _]?[1-8*]\*{6}(?!\d)`.
   - 이메일 변형: `\(at\)|\[at\]|골뱅이|\s@\s|%40`, 최상위 도메인 없는 주소 `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?![.\w])`.
4. 사본에서 20자 이하 숫자 덩어리 안의 구분자(`[\s~_,.*/-]`)를 지운 '압축 사본'을 만들고 **휴대폰(`01[016789]\d{7,8}` 덩어리 전체)과 주민등록번호(13자리, 앞 6자리가 유효한 YYMMDD, 7번째가 1~8)만** 본다. 카드 탐지는 압축 사본에 쓰지 않는다(`2026-09-24 14:30:00` → 14자리가 카드로 잡히는 것을 막으려고).
5. 행 단위 인접 칸: 같은 행에서 이웃한 세 칸이 `^01[016789]$`, `^\d{3,4}$`, `^\d{4}$`이면 세 칸 모두 걸린 것으로 본다(머리글이 일반 이름인 분리 휴대폰 열).

- 칸 값과 탐지 종류는 문구·오류·감사·콘솔 어디에도 싣지 않는다. 계획이 행 번호·열 이름만 허용한다.
- 문구(고정): 'N개 칸에서 개인정보 형식(전화·이메일·주소·고유식별번호·결제정보 등)이 보여 파일 전체를 가져오지 않았습니다. 해당 열을 지운 파일로 다시 올려 주세요. 숫자만 이어 쓴 날짜·13자리 이상 번호도 걸립니다(날짜는 YYYY-MM-DD HH:mm로 바꿔 주세요). 모집 코드 열이 걸렸다면 코드가 R로 시작하는 8자인지 확인해 주세요.' 칸마다 종류를 알려 주지 않고 문구 하나에 두 안내를 넣는다.
- **최선 노력이다**: 이름·자유 텍스트·일반 머리글 아래의 생년월일(`1990-01-01`)은 값 패턴으로 잡을 수 없다(`lib/pii-scan.ts:4` 한계, 계획 :101). 1단계 머리글 검사와 지역 규칙(2.6.4)이 구조로 막고, 남는 위험은 7.3에 적는다.
- **브라우저 사전 검사**: 화면은 보내기 전에 같은 `localFileCheck(bytes)`(2.6.6)를 돌려 걸리면 보내지 않는다. 개인정보 열이 기기를 떠나지 않게 한다. 서버는 같은 검사를 다시 한다.
- 제공 증빙의 SHA-256은 CSV 칸이 아니라 요청 칸이다. `scanText`를 돌리지 않고 `^[0-9a-f]{64}$` 형식만 본다(`customer_id` 오탐 회피, `lib/pii-scan.ts:70`).

#### 2.6.4 행 정규화

- **`receivedAt`** (필수):
  - 받는 형식(모두 칸 전체와 맞아야 한다):
    - 시간대 있는 ISO 8601: `YYYY-MM-DDTHH:mm[:ss[.sss]](Z|±HH:mm)`.
    - KST로 읽는 로컬 시각: `YYYY[-./]M[-./]D[.]` 뒤에 공백 또는 `T`, 선택 `오전|오후`, `H:mm[:ss]`. 월·일·시는 1~2자리이고 구분자 뒤 공백을 허용한다(예: `2026-10-05 14:05`, `2026. 10. 5. 오후 2:05`, `2026-10-05 오후 2:05:03`, `2026-10-05T14:05`).
    - `오전|오후`가 있으면 시는 1~12다. 오전 12시는 0시, 오후 12시는 12시, 오후 1~11시는 +12다.
  - 값 검증은 왕복 비교다(`Date.UTC`로 만든 뒤 연·월·일·시·분·초가 같아야 한다, `parseOrderDate` 선례 `lib/order-import.ts:97-98`). `02-30`, `24:00`, `:60`은 `received_invalid`다.
  - 날짜만 있는 값(`YYYY-MM-DD`, `YYYY. M. D.`): 채널이 `expo`·`briefing`이면 받고 `receivedPrecision:'day'`, 그 날 KST 00:00으로 저장한다. 다른 채널은 `received_date_only`다.
  - 숫자만 이어 쓴 시각(`20260924143000`)은 형식이 아니다(2.6.3에서 이미 걸린다).
  - 저장은 UTC ISO(`toISOString`)다.
  - `now + 5분`보다 뒤면 `received_future`다(제공처 시계 오차 허용).
  - KST 날짜가 `addDays(today, −UNCONVERTED_RETENTION_DAYS)` 이하이면 `received_too_old`다. 날짜 단위로 판정해 미리보기와 확정 사이에 시간 경계가 흔들리지 않는다. 오늘 −179일은 받고 −180일은 거부한다. 생년월일 열을 잘못 매핑한 경우도 여기서 잡힌다.
  - KST 접수일이 제공일보다 뒤면 `received_after_provided`, 선언한 내보내기 기간(2.6.5) 밖이면 `received_outside_period`다.
  - 보존 기한(접수 +180일)이 14일 안에 끝나는 행은 경고 건수 `expiring_within_14d`다.
- **`region`** (선택): 비우면 ''다. 값이 있으면 NFKC·공백 정리 뒤 `/^[가-힣 ]{2,40}$/`이고 `scanText` 0건이어야 하며(R4b `readRegion` 규칙, `lib/franchise-server.ts:263-270`), 가져오기에는 행정구역 규칙을 더한다:
  - 첫 토큰이 `SIDO_NAMES` 안에 있어야 한다.
  - 나머지 토큰(0~3개)은 `시|군|구|읍|면|동`으로 끝나야 한다.
  - 아니면 `region_invalid`다. 예: '서울 강남구'·'경기 성남시 분당구'·'서울'은 받고, '홍길동'·'강남구'(시·도 없음)·'김서준'은 거부한다. 끝 글자 규칙만 쓰지 않는 이유는 '홍길동'처럼 사람 이름도 '동'으로 끝나기 때문이다. 지역 칸은 평문이고 직원에게 보이고 내보내기 '지역' 열에 나가므로(`lib/franchise.ts:270` `canSeeLead`, `:326` `EXPORT_COLUMNS`) 이름이 들어가면 안 된다.
- **`budgetBand`·`timingBand`** (선택): 비우면 `unknown`이다. 키나 한국어 라벨과 정확히 같으면(NFKC, 공백 제거) 그 값을 쓴다. 그 밖은 `unknown`으로 두고 경고 건수(`budget_unmapped`·`timing_unmapped`)만 센다. 값은 돌려주지 않는다.
- **`codes`·`landingUrl`** (선택): `recruitmentTokens`로 합친다(코드 열 먼저, 최대 5개). 버린 토큰 수와 잘림은 경고 건수다.
- **파일 안 중복**: 정규화한 (접수 시각, 정밀도, 지역, 예산, 시기, 코드) 튜플이 앞 행과 같은 행을 센다(`possible_duplicate_in_file` 경고 건수). 박람회 명단처럼 같은 분·지역·구간의 다른 사람이 흔해서 기본으로 건너뛰지 않는다. 입력 `dropInFileDuplicates:true`일 때만 뒤 행을 건너뛰고 `duplicate_in_file`로 센다. 이 선택은 계획 해시에 묶인다(2.6.6).
- **기간 겹침**: 같은 브랜드·같은 제공처 키(2.6.5)의 이전 가져오기가 선언한 기간들(`ctx.coveredPeriods`)의 합집합 안에 KST 접수일이 드는 행은 건너뛰고 `overlap`으로 센다.
  - 겹치게 내려받은 파일이 R6 CPL 분모를 부풀리는 것을 막는다(바이트가 달라 해시로는 못 막는다). 제공처 쪽 식별자를 받지 않고 할 수 있는 결정론 규칙이다.
  - 이전 달을 나중에 가져오는 뒤늦은 가져오기(backfill)는 기간이 겹치지 않으면 모두 들어간다. 한 행의 잘못된 날짜는 행 오류(`received_outside_period`)로 확정을 막을 뿐 커버리지를 넓히지 않는다.
  - 대가로, 이미 가져온 기간 안의 날짜로 늦게 나타난 행은 가져오지 못한다. 미리보기에 건수가 보이고 사람이 수동 등록한다. 기간 끝 날이 제공일과 같으면 경고 `period_includes_export_day`('그날 이후 접수분은 다음 파일에서 건너뜁니다')다.
- **행 오류**: 하나라도 있으면 400 `row_invalid`로 확정을 막는다. `errors`는 `{row, column, code}`(최대 50개)이고 값은 없다. 행 오류는 파일을 고쳐 다시 올린다. 원자적이고 주문 가져오기와 같다.

#### 2.6.5 제공 증빙 형식 (계획 I3)

- **입력** `provenance:{provider, providedOn, period:{from,to}, consentRef?:{sha256, storageLabel}}`:
  - `provider`: 제공처 라벨. 1~60자, 제어 문자 금지, `scanText` 0건이 아니면 400 `provider_pii`다. 제공처 키 `providerKey`는 NFKC → 공백 제거 → 소문자다('창업포털A'와 '창업 포털a'는 같은 키). 화면은 이전 가져오기의 제공처를 선택지로 먼저 보인다.
  - `providedOn`: KST 날짜, 오늘 이하.
  - `period`: 제공처 내보내기가 담은 KST 날짜 범위. `from ≤ to ≤ providedOn`, 길이 180일 이하, `from`은 `addDays(today, −179)` 이상. 틀리면 400 `period_invalid`다.
  - `consentRef.sha256`: 제공자 측 동의 증빙 문서의 SHA-256 소문자 64자.
  - `consentRef.storageLabel`: 가맹 프로필의 보관 위치 라벨 목록(`profile.storageLabels`) 안의 값이어야 한다. 원본은 올리지 않는다. 목록이 비어 있으면 400 `storage_labels_unset`('설정에서 보관 위치 라벨을 먼저 등록해 주세요')이다. R4b `storageLabelOf`(`lib/franchise-server.ts:349-356`)는 목록이 비면 40자 이하 아무 라벨이나 받지만, 가져오기는 제3자 증빙 위치라 등록 목록을 요구한다.
- `provider`·`providedOn`·`period`는 모든 가져오기에 필수다(기간 겹침 규칙의 키). 없으면 400 `provenance_required`, 형식이 틀리면 400 `provenance_invalid`다.
- `consentRef`는 채널이 `portal`·`expo`이면 필수다. 다른 채널은 선택이고, 주면 같은 검사를 한다.
- **행사 연결** `eventId`(선택): 채널이 `expo`·`briefing`일 때만 받는다(아니면 400 `event_channel_mismatch`). 문맥 `event`가 같은 브랜드여야 하고(400 `event_other_brand`), 취소되지 않아야 한다(409 `event_cancelled`). 행사별 리드당 비용(R6)의 분모가 된다.
- 수집 근거(`basis`)는 이 모듈의 R5a 판정에 없다. A안에서만 뜻이 있어 R5b-2가 2.7.1로 더한다.

#### 2.6.6 판정·검사·해시

```ts
export async function localFileCheck(bytes:Uint8Array):Promise<LocalFileResult>                      // 해독 → 구조 → 민감 열 이름 → 칸 값. 역할·스위치 없음(브라우저 사전 검사)
export async function inspectLeadFile(input:unknown,ctx:InspectContext):Promise<RecruitmentDecision<LeadFileInspection>>
export async function leadImportDecision(input:unknown,ctx:LeadImportContext):Promise<RecruitmentDecision<LeadImportPlan>>
export async function leadImportPlanSha256(p:PlanHashInput):Promise<string>
```

- **파일 검사** `inspectLeadFile`(매핑 없는 첫 단계): 입력 `{csvBase64, transcodedFrom?}`. 단계는 스위치(409) → 역할(403) → 분기(409) → 파일(400) → 머리글(400) → 칸 값(400). 결과 `{fileSha256, hadBom, headers, rowCount, suggestedMapping, transcodedFrom}`. `headers`는 두 검사를 통과했을 때만 싣는다.
- **입력** `leadImportDecision`: `{csvBase64, transcodedFrom?, channel, mapping, provenance, eventId?, dropInFileDuplicates?, confirm?:true, expected?:{planSha256, toCreate}}`.
- **문맥** `LeadImportContext`: `{enabled, brandId, branch, actor, now, today, storageLabels, coveredPeriods:{from,to}[], event:EventLite|null, fileExists:boolean, book:CodeBook, bind:Json|null}`.
  - `coveredPeriods`는 같은 브랜드·같은 `providerKey`의 이전 가져오기 기간이다(채널과 무관하다. 같은 포털 파일을 다른 채널로 골라도 막힌다).
  - `bind`는 서버가 먼저 판정한 값(R5b-2의 수집 근거)이다. 사용자 입력을 그대로 넣지 않는다. 계획 해시에 들어간다.
- **판정 단계**: 스위치(409) → 역할(403) → 분기(409, A만. R4b `createLead`의 `BRANCH_BLOCKED`와 같은 조건이라 우회로가 되지 않는다) → 파일(400) → 머리글(400) → 칸 값(400) → 입력(400: 채널·매핑·제공 증빙·기간·보관 위치·행사 브랜드·확정 표시) → 행(400) → 상태(409: 행사 취소 `event_cancelled`, 같은 파일 `file_duplicate`, 새 행 없음 `no_new_rows`, 확인 값 불일치 `expected_mismatch`).
- **계획 해시** `planSha256`: 아래 값을 키 정렬한 정본 JSON의 SHA-256이다: `brandId`, `channel`, `mapping`, `provenance`(정규화 값과 `providerKey`), `eventId`, `dropInFileDuplicates`, `transcodedFrom`, `bind`, `today`, 두 규칙 버전, `fileSha256`, 정규화한 행 목록(접수 시각 순, 동률은 줄 번호 순). 매핑·브랜드·채널·증빙·근거 가운데 하나라도 미리보기와 다르면 확정은 409다.
- **확정 요청**: `confirm:true`와 `expected`가 있어야 한다. 없으면 400 `confirm_required`다. `expected.planSha256`이 다시 계산한 값과 다르거나 `toCreate`가 다르면 409 `expected_mismatch`다(`lib/campaign-attribution.ts:67-74` 확인 패턴). 날짜가 바뀌면 `today`가 달라 409가 되고 화면은 미리보기를 다시 한다.
- **결과** `LeadImportPlan`:
  - `fileSha256`, `hadBom`, `planSha256`, `rows`, `toCreate`, `skipped:{overlap, duplicateInFile}`
  - `warnings:{budgetUnmapped, timingUnmapped, droppedTokens, truncatedTokens, possibleDuplicateInFile, expiringWithin14d, periodIncludesExportDay}`
  - `receivedRange:{from,to}`, `mapping`(열 번호만), `provenance`, `providerKey`, `eventId`
  - `attribution:{code:{[channel]:n}, unattributed:{[reason]:n}, conflict:n}`(2.4 코드 귀속만. 2.7.3은 R5b-2가 더한다)
  - `headers`(검사를 통과했을 때만), 정규화한 행 목록(서버 전용, 응답에는 싣지 않음), `ruleVersion`, `importVersion`, `note`(귀속≠증분)
- 가명 코드(`leadSystemCode`)는 이 모듈이 만들지 않는다. R5b-2 서버가 만든다(4.3).

### 2.7 A안 전용 추가 (R5b-2 PR, Q-R5-1·Q-R5-2 답 뒤)

R5b-2 PR이 두 순수 모듈에 더한다. 답이 A안이 아니면 이 절은 바뀐다(B안은 연락처 대상 추가, C안은 리드 행이 없어 2.7.2~2.7.4가 없다).

#### 2.7.1 가져오기 수집 근거 `importBasisDecision(channel, raw)`

| 채널 | 받는 `basis.type` | 비고 |
|---|---|---|
| `portal`·`expo` | `provided`(제3자 제공 수령, 제17조·제19조) 또는 `inquiry_response`(위탁 수집, 본부 명의 문의 응대, 제26조) | 관리자가 가져오기마다 선언한다. 어느 쪽이든 `consentRef`가 필수다. 열린 질문 14(:1127)가 풀릴 때까지 시스템이 하나로 정하지 않는다(Q-R5-1 딸린 질문). 기록에 '관리자 선언(열린 질문 14 미정)'을 붙인다 |
| `owner_referral` | `referral`(`referralFrom:'franchisee'` 고정) 또는 `inquiry_response` | `referral`이면 R4b 출처 고지 할 일을 그대로 받는다 |
| 그 밖 | `inquiry_response` | |

- `consent`는 모든 채널에서 400 `basis_invalid`다. 제3자 양식(예: 메타 리드광고 인스턴트 양식)에서 보인 문구는 COLLECTIVE에 등록한 안내문이 아니고, 행마다 '안내문 X를 접수 시각에 보였다'는 기록은 COLLECTIVE가 확인하지 않은 사실이 된다(`AGENTS.md` 품질 기준). 등록 안내문의 `createdAt ≤ receivedAt` 비교만으로는 이 문제가 풀리지 않아 받지 않는다. 동의 근거가 필요하면 연락처를 붙인 뒤 R4b 흐름으로 동의를 받는다.
- 그 밖의 값은 400 `basis_invalid`다. 판정은 `bind`로 계획 해시에 묶인다.

#### 2.7.2 가져온 리드 모양 `importedLeadShape(row, plan, basis, now)`

- `contactState:'external'`, `contact:null`, `memo:null`, `stage:'inquiry'`, `assigneeId:null`, `marketing:{status:'none'}`, `firstContactAt:null`.
- `receivedAt`=행의 접수 시각, `receivedPrecision:'time'|'day'`, `lastActivityAt`=`receivedAt`, `createdAt`=가져오기 시각(`now`), `importId`=가져오기 기록의 `ri-<uuid>`.
- `task:{region, budgetBand, timingBand, sourceChannel, campaignId:null}`. `sourceChannel`은 `portal`→`portal`, `expo`→`expo`, `owner_referral`→`referral`, `briefing`→`other`, 그 밖→`online_form_manual`이다(`SOURCE_LABELS`, `lib/franchise.ts:27`).
- `basis`: `provided`면 `{type:'provided', importId, provider, providedOn, sourceNoticedAt:null}`. 동의 증빙 해시는 리드에 복사하지 않는다(가져오기 기록에만 둔다. 64자리 16진이 리드 보기에 들어가면 `customer_id`로 잡힌다). `referral`이면 `{type:'referral', referralFrom:'franchisee', sourceNoticedAt:null}`, `inquiry_response`면 `{type}`.
- `codes`: 행의 토큰을 `{code, at:now, by, source:'import'}`로 둔다. `late`는 `source:'import'` 토큰에 적용하지 않는다(2.4). 화면은 '제공처 파일 코드'로 보인다.

#### 2.7.3 가져오기 귀속 기준 (Q-R5-2 권고안)

- `attributeLead`에 가져오기 문맥을 더한다: `lead.import?:{importId, channel, eventId|null}`.
- 코드 귀속이 `attributed`나 `conflict`면 그대로다(코드가 이긴다).
- 코드 귀속이 `unattributed`이고 `lead.import`가 있으면 `{state:'attributed', basis:'import', channel:import.channel, importId, eventId}`이고 라벨은 '제공처 파일 기준'이다.
- R6는 코드 귀속 수와 제공처 파일 기준 수를 다른 열로 보이고 둘 다 귀속≠증분 문구 아래에 둔다. 채널 CPL의 분모는 두 열의 합과 코드 열만의 값을 함께 보인다.
- 답이 '유입 미확인 유지'면 이 분기를 넣지 않고, 7.3에 '포털·박람회 CPL 분모 없음' 한계를 적는다.

#### 2.7.4 R6에 넘기는 규칙

- 코호트 기준 시각은 `receivedAtOf`다.
- speed-to-lead: `contactState==='external'`인 동안은 제외한다(첫 연락이 제공처 쪽에서 일어난다). 연락처를 붙이면(4.3) 입력 `firstContactAt`이 있을 때만 넣고, 가져온 리드는 '제공처 시각' 라벨로 수기 리드와 다른 중앙값을 보인다. `receivedPrecision:'day'`는 늘 제외한다.
- '미응대': `external` 리드는 세지 않는다.

## 3. 결정 객체·상태 코드·사유 코드·버전

### 3.1 결정 객체

R15a-1과 같은 모양을 두 모듈이 각자 정의한다. `lib/franchise-assets.ts`를 import하면 판정기 묶음이 따라온다.

```ts
export type RecruitmentDecision<T>=
 |{ok:true;status:200;value:T;warnings:string[];ruleVersion:string;disclaimer:string}
 |{ok:false;status:400|403|409;reasons:Code[];message:string;errors?:{row?:number;column:string;code?:string}[];ruleVersion:string;disclaimer:string};
```

- `message`는 첫 사유 코드의 고정 문구다. 입력 값을 끼워 넣지 않는다.
- `errors`는 가져오기에만 있고 행 번호·열 번호 또는 통과한 머리글 이름·행 코드만 담는다.
- 서버는 `if(!d.ok) throw` 로 HTTP에 옮기고 사유 코드·고정 문구·규칙 버전·면책을 싣는다(`decisionError` 관례, `lib/franchise-assets-server.ts:52`).
- 테스트는 모든 입력 칸(머리글 포함)에 표지 문자열을 넣고 어떤 `message`·`errors`에도 나오지 않음을 확인한다.

### 3.2 사유 코드

`lib/franchise-recruitment.ts` `RECRUITMENT_CODES`:

| 상태 | 코드 |
|---|---|
| 400 | `invalid_input`, `channel_unknown`, `code_format`, `valid_from_invalid`, `valid_from_out_of_range`, `retire_date_invalid`, `label_invalid`, `label_pii`, `utm_campaign_invalid`, `campaign_other_brand`, `asset_other_brand`, `event_other_brand`, `period_invalid`, `period_future`, `period_too_long`, `amount_negative`, `amount_invalid`, `vat_invalid`, `original_invalid`, `funding_invalid`, `ad_fund_forbidden`, `referral_reward_forbidden`, `evidence_required`, `evidence_pii`, `platform_metric_invalid`, `void_reason_invalid` |
| 403 | `role_forbidden` |
| 409 | `switch_off`, `branch_not_a`, `campaign_not_recruitment`, `asset_not_approved`, `asset_review_needed`, `asset_superseded`, `event_cancelled`, `code_taken`, `code_already_retired`, `spend_already_voided`, `spend_possible_duplicate`, `spend_period_overlap`, `spend_referenced`, `spend_replace_invalid` |
| 경고 | `asset_channel_mismatch`, `clicks_exceed_impressions`, `search_ad_manual`, `agency_fee_wording`, `duplicate_acknowledged` |

`lib/franchise-lead-import.ts` `LEAD_IMPORT_CODES`:

| 상태 | 코드 |
|---|---|
| 400 | `file_too_large`, `encoding_invalid`, `csv_invalid`, `too_many_rows`, `sensitive_column_in_file`, `pii_in_file`, `channel_unknown`, `mapping_invalid`, `mapping_forbidden`, `provenance_required`, `provenance_invalid`, `provider_pii`, `period_invalid`, `storage_labels_unset`, `event_channel_mismatch`, `event_other_brand`, `confirm_required`, `row_invalid`, `basis_invalid`(R5b-2) |
| 403 | `role_forbidden` |
| 409 | `switch_off`, `branch_not_a`, `event_cancelled`, `file_duplicate`, `no_new_rows`, `expected_mismatch` |
| 행 코드(`row_invalid` 안) | `received_missing`, `received_invalid`, `received_date_only`, `received_future`, `received_too_old`, `received_after_provided`, `received_outside_period`, `region_invalid` |
| 건너뜀(건수) | `overlap`, `duplicate_in_file`(선택했을 때만) |
| 경고(건수) | `budget_unmapped`, `timing_unmapped`, `dropped_tokens`, `truncated_tokens`, `possible_duplicate_in_file`, `expiring_within_14d`, `period_includes_export_day` |

- 코드 목록·상태표·문구표는 얼린 상수다. 테스트가 세 표의 키 집합이 같은지, 한 단계의 코드가 같은 상태인지 본다.
- 서버 전용 키는 `FRANCHISE_ERRORS`(`lib/franchise.ts:108`)에 더한다. 모두 고정 문구다.
  - R5b-1: `CODE_TAKEN` 409(같은 kind INSERT UNIQUE), `CODE_RETRY` 409(생성 5회 실패), `CODE_NOT_FOUND` 404, `CODE_STALE` 409(사용 중지 판 불일치), `SPEND_NOT_FOUND` 404, `SPEND_STALE` 409, `SPEND_REF_UNKNOWN` 400(`SPEND_REF_UNAVAILABLE`을 대신한다), `LEAD_CODE_INVALID` 400, `LEAD_CODE_NOT_ON_LEAD` 400(제외할 코드가 리드에 없음), `LEAD_CODE_STRUCK` 409(이미 제외).
  - R5b-2: `IMPORT_DUPLICATE` 409(UNIQUE. 리드 문구인 `STALE`을 쓰지 않는다), `IMPORT_RETRY` 409(가명 코드 생성 실패), `CONTACT_EXTERNAL` 409('연락처가 제공처에 있는 리드입니다. 연락처를 붙인 뒤 진행해 주세요.').

### 3.3 버전과 고정 문구

- `RECRUITMENT_VERSION='fr-recruitment@<첫 병합일>.1'`: 코드 형식·채널·귀속·비용 규칙. 모든 판정의 `ruleVersion`이다. 코드·비용 행과 가져오기 기록에 저장한다.
- `LEAD_IMPORT_VERSION='fr-lead-import@<첫 병합일>.1'`: 인코딩·대상·금지 대상·민감 열 이름·가져오기 전용 탐지·시각 문법·지역 규칙·한도. 가져오기 기록에 저장한다.
- 규칙을 바꾸면 판을 올린다. R5b-2가 2.7을 더할 때 두 판을 올린다. 귀속 규칙이 바뀌면 R6 스냅샷이 버전으로 구분한다.
- `disclaimer`는 `GATE_DISCLAIMER`('COLLECTIVE 휴리스틱 · 법률 자문 아님', `lib/franchise-gates.ts:12`)다.
- 고정 문구: `RECRUITMENT_ATTRIBUTION_NOTE`, `PLATFORM_REPORTED_NOTE`, `NO_PRORATION_NOTE`, `UNATTRIBUTED_LABEL`, 광고분담금 안내('광고분담금은 모집 비용 출처로 쓸 수 없습니다(결정 27 기본값)'), 점주 추천 안내('점주 추천에는 금전 보상을 기록하지 않습니다(결정 27 기본값)'), 인코딩 안내, 개인정보 거부 안내.

## 4. 서버·API 계약 (R5b)

### 4.1 기록 종류

세 kind를 `recruitment_event`(`lib/record-kinds.ts:137`) 바로 뒤, `data_request` 앞에 둔다. 모두 parent는 브랜드 id다.

| kind | 조각 | 행 id | 쓰기 | campaignDeletion | retention | subjectErasure | 담는 것 |
|---|---|---|---|---|---|---|---|
| `recruitment_code` | R5b-1 | `${owner}:recruitment_code:${code}` | INSERT. `insertRow`(`lib/franchise-server.ts:78`)는 비공개 상수이고 새 모듈은 `franchise-server`를 import하지 않으므로, port에 `insert(kind,id,data,parent)`를 더해 넘긴다(`runAssetAction` port 선례 `:1024-1025`). UNIQUE면 `CODE_TAKEN` 409. `recordStatement` upsert는 쓰지 않는다(기존 코드를 조용히 덮어쓴다). 사용 중지는 `version` 조건부 쓰기(어긋나면 `CODE_STALE`) | `retain`, links `['data_campaign']`, purge `keep` | `{basis:'policy',anchor:'issued',days:null,ref:'재사용 방지(휴리스틱) · 구현된 파기 없음'}` | `none` | 2.3 발급 값 + `brandId`·`status`(`active`·`retired`)·`retiredOn`·`retiredAt`·`retiredBy`·`version`·`createdAt`·`createdBy:{id,role}`·`ruleVersion`. `campaignId`는 최상위다(`data_campaign` 조건이 `$.campaignId`를 읽는다, `:175`) |
| `recruitment_spend` | R5b-1 | `rs-<uuid>` | port `insert`. 무효화는 `version` 조건부 쓰기(어긋나면 `SPEND_STALE`) | `not_campaign_scoped` | `{basis:'policy',anchor:'recorded',days:null,ref:'모집 비용 증빙(휴리스틱) · 구현된 파기 없음'}` | `none` | 2.5 값 + `period`(정규화)·`amount`·`vat`·`amountExVat`·`currency:'KRW'`·`original?`·`status`(`active`·`voided`)·`voided?:{at,by,reason}`·`replaces?`·`platformNote`·`version`·`createdAt`·`createdBy`·`ruleVersion` |
| `recruitment_import` | R5b-2 | 원본 바이트 SHA-256(소유자 전체에서 유일) | INSERT. UNIQUE면 `IMPORT_DUPLICATE` 409 | `not_campaign_scoped` | `{basis:'policy',anchor:'recorded',days:null,ref:'가져오기 입증·중복 방지(휴리스틱) · 구현된 파기 없음'}` | `none` | `importId:'ri-<uuid>'`, 파일 해시, `hadBom`, `encoding:'utf-8'`, `transcodedFrom`, 계획 해시, 채널, 제공처 라벨·`providerKey`·제공일·내보내기 기간·동의 증빙 해시·보관 위치 라벨, `eventId`, 수집 근거 유형과 '관리자 선언' 표시, 매핑(열 번호만, 머리글 이름 없음), 건수(행·생성·건너뜀 사유별·경고별·귀속 요약), 접수 시각 범위, 두 규칙 버전, `importedAt`·`importedBy:{id,role}`. 칸 값·머리글 이름은 담지 않는다 |

- 설명 문구에는 '캠페인과 무관'(코드는 '캠페인을 지워도 남는다')과 '리드 값·연락처는 담지 않는다'를 적는다.
- `recruitment_code`는 `blocksDeletion`을 두지 않는다. 캠페인 삭제 영향 조회에서 "기타 기록"으로 세어진다. `lib/deletion-summary.ts`는 고치지 않는다.
- 리드는 파일 해시가 아니라 `importId`(`ri-<uuid>`)로 가져오기를 가리킨다. 64자리 16진은 가져오기 기록·감사에만 있다. 이 두 곳을 모델·외부로 보내는 경로는 없고, R6 증빙 묶음이 이 값을 실을 때 `customer_id` 오탐 예외를 R6 명세에 적는다.
- 테스트 수정(자기 항목만): `tests/record-kinds.test.mjs:105`의 위치 검사를 `auditAt+1..+5` = asset, event, code, spend, import 다음 `data_request`로 바꾼다. 세 kind의 축 검사를 더한다.
- `tests/helpers/franchise-fixture.mjs`의 `counts()`·`total()`(:45-46)은 `kind LIKE 'franchise_%'`만 센다. `recruitment_%`를 세는 보조 함수를 더한다(R5b-1 파일 목록에 넣었다).

### 4.2 리드 레코드 확장

모두 선택 필드라 옛 리드는 바이트가 같다(마이그레이션 0).

- R5b-1:
  - `codes?: {code:string; at:string; by:ActorSnapshot; source:'manual'|'import'}[]`: 추가만 하고 최대 5개다. R 형식이 아니면 400 `LEAD_CODE_INVALID`다. 등록되지 않은 코드도 저장하고 응답 경고로 알린다. `create_lead` 입력 `codes`와 새 작업 `add_lead_codes`로 넣는다. 지우거나 순서를 바꾸는 입력은 없다.
  - `codeStrikes?: {code:string; at:string; by:ActorSnapshot; reason:'typo'|'wrong_lead'|'gaming'|'other'}[]`: 관리자만 추가한다(`strike_lead_code`). 제외는 되돌리지 않는다.
  - 이벤트 종류 `codes_added`('모집 코드 추가')·`codes_struck`('모집 코드 제외')를 `EVENT_TYPE_LABELS`(`lib/franchise.ts:100`)에 더한다. 두 종류는 `ACTIVITY_EVENTS`(`:260`)에 넣지 않는다. 내부 조작이 보존 기한을 늘리지 않게 하는 원칙(`:259` 주석)을 따른다. 이벤트는 필드 이름 `codes`와 건수만 남긴다.
- R5b-2(A안):
  - `receivedAt?: string`, `receivedPrecision?:'time'|'day'`, `importId?: string`. 없으면 접수 시각은 `createdAt`이다.
  - `contactState`에 `'external'`('제공처 보관')을 더한다. `LeadRecord` 타입(`lib/franchise.ts:204`)과 `CONTACT_STATE_LABELS`(`:77`)를 고친다.
  - `BASIS_LABELS`(`:30`)에 `provided:'제3자 제공 수령(출처 고지 필요)'`를 더하고, 수기 등록 선택지용 `INTAKE_BASIS_LABELS`(기존 3개)를 새로 둔다. `FRANCHISE_LABELS.basis`(intake 보기, `:347`)는 `INTAKE_BASIS_LABELS`를 쓴다. `tests/franchise-lib.test.mjs:29`의 `BASIS_TYPES` 3개 고정은 4개와 `INTAKE_BASIS_TYPES` 3개로 고친다. `SOURCE_CHANNELS`는 바꾸지 않는다(개수를 고정한 테스트는 없다. `:25-27`은 라벨이 한국어인지와 배열·라벨 키 일치만 본다).
  - `needsSourceNotice(basis)`=`basis.type==='referral'||basis.type==='provided'`를 `lib/franchise.ts`에 둔다.
  - `retentionUntil`(`:253-257`): `contactState`가 `'present'` 또는 `'external'`이면 마지막 활동 +180일이다. `external`은 증빙 작업이 막혀 `contractedAt`이 생기지 않는다. 가져온 리드는 `lastActivityAt=receivedAt`이라 접수 +180일에 파기(최소화) 대상이 된다.
- 보기(`leadSummary`·`leadDetail`)에 `attribution:{state,basis?,label,detail,code?,channel?,channelLabel?,retroactive?,late?}`와 `receivedAt`·`receivedPrecision`·`importId`를 더한다. `EXPORT_COLUMNS`(14열)는 바꾸지 않는다. 내보내기에 코드 열을 넣는 일은 R6로 넘긴다.

### 4.3 작업 (`POST /api/franchise`)

새 작업 목록 `RECRUITMENT_ACTIONS`(`code_issue`·`code_retire`·`spend_record`·`spend_void`)는 `lib/franchise-recruitment-server.ts`가 내보낸다. `FRANCHISE_ACTIONS`(`lib/franchise-server.ts:97`)에 펼친다. 리드 작업 `add_lead_codes`·`strike_lead_code`는 `LEAD_MUTATIONS`(`:94`)에, 가져오기 세 작업은 `OTHER_ACTIONS`(`:95`)에 더한다.

코드·비용은 `other()`(`:1022`)에서 port 방식으로 넘긴다. port는 `commit`·`receipt`에 `insert`를 더한다. 새 모듈은 `franchise-server`를 import하지 않는다(`runAssetAction` 선례, `:1024`). 가져오기는 리드 불변식을 가진 `lib/franchise-server.ts` 안에 둔다. 가명 코드 조회·이벤트·영수증을 그 모듈이 갖고 있다.

| 작업 | 역할 | 스위치 꺼짐 | 연락처 키 | 재생 대상(`targetOf`)·입력 해시 | 잠금 | 쓰기(한 batch) | 오류 |
|---|---|---|---|---|---|---|---|
| `code_issue` | 대표·관리자(직원 403) | 409 | 면제 | `null` + `inputSha256` | 잡음 | 코드 INSERT + 영수증 감사 `au-<rid>` | 400(입력), 409(분기·목적·자료 상태·행사·`code_taken`·`CODE_TAKEN`·`CODE_RETRY`) |
| `code_retire` | 대표·관리자 | 허용(`OFF_EXEMPT`) | 면제 | `input.code` | 잡음 | 조건부 갱신 + 영수증 감사 | 404 `CODE_NOT_FOUND`, 400 `retire_date_invalid`, 409(`code_already_retired`·`CODE_STALE`) |
| `spend_record` | 대표·관리자 | 409 | 면제 | `null` + `inputSha256` | 잡음 | 비용 INSERT(+ `replacesSpendId`면 옛 행 조건부 무효화) + 영수증 감사 | 400(음수·부가세·광고분담금·점주 추천·기간·채널·증빙), 409(목적·자료·중복·겹침·교체·참조) |
| `spend_void` | 대표·관리자 | 허용 | 면제 | `input.spendId` | 잡음 | 조건부 갱신 + 영수증 감사 | 404, 409(`SPEND_STALE`·이미 무효화·`spend_referenced`), 400(사유) |
| `add_lead_codes` (ON_LEAD) | 대표·관리자, 직원은 본인 담당(`canEditLead`) | 409 | 필요(기존 리드 작업과 같음) | `leadId` | 잡음 | 리드(버전만 올림, `lastActivityAt` 불변) + 이벤트 `codes_added` | 400 `LEAD_CODE_INVALID`, 409 `STALE` |
| `strike_lead_code` (ON_LEAD) | 대표·관리자 | 409 | 필요 | `leadId` | 잡음 | 리드(버전만) + 이벤트 `codes_struck` + 감사 `code_strike` | 400 `LEAD_CODE_NOT_ON_LEAD`, 409 `LEAD_CODE_STRUCK`·`STALE` |
| `lead_import_inspect` (R5b-2) | 대표·관리자 | 409 | 면제 | 영수증 없음 | **잡지 않음** | 없음 | 2.6.6 검사 코드 |
| `lead_import_preview` (R5b-2) | 대표·관리자 | 409 | 면제 | 영수증 없음 | **잡지 않음** | 없음 | 2.6 판정 코드 |
| `lead_import_confirm` (R5b-2) | 대표·관리자 | 409 | 면제(연락처 값 없음) | `null` + `inputSha256` | 잡음 | 리드 N INSERT + `created` 이벤트 N(`importId`·수집 근거 스냅샷) + `recruitment_import` INSERT + 영수증 감사 = 2N+2문장(200행이면 402) | 2.6·2.7.1 판정 코드, `IMPORT_DUPLICATE`, `IMPORT_RETRY` |
| `create_lead` | 기존과 같음 | 기존과 같음 | 기존과 같음 | 기존과 같음 | 잡음 | `codes` 추가 | `LEAD_CODE_INVALID`, `basis.type:'provided'`는 400('수집 근거를 골라 주세요.') |
| `update_contact` 붙이기 (A안, R5b-2) | 기존과 같음 | 기존과 같음 | 필요 | `leadId` | 잡음 | `external` → `present`: 이름과 전화·이메일 하나 이상, HMAC 중복 검사(같은 연락처면 409와 기존 코드), 선택 `firstContactAt`(`receivedAt ≤ t ≤ now`, 아니면 400), 이벤트 `contact_updated` | 기존 + 보존 기한 지난 리드는 먼저 파기 뒤 409 `CONTACT_GONE` |
| `event_save` (기존) | 기존과 같음 | 기존과 같음 | 면제 | 기존과 같음 | 잡음 | 기존과 같음 | `spendRef`가 null이 아니면 같은 브랜드의 무효화되지 않은 `recruitment_spend` id여야 한다. 아니면 400 `SPEND_REF_UNKNOWN`. `lib/franchise-assets-server.ts:253-254`를 바꾼다. 순수 `validateEvent`는 바꾸지 않는다 |

**목록 변경** (`lib/franchise-server.ts:101-107`):

- `ADMIN_ACTIONS`에 `code_issue`·`code_retire`·`spend_record`·`spend_void`·`strike_lead_code`·가져오기 세 작업을 더한다.
- `KEY_EXEMPT`에 `code_issue`·`code_retire`·`spend_record`·`spend_void`·가져오기 세 작업을 더한다.
- `OFF_EXEMPT`에는 `spend_void`·`code_retire`만 더한다.
- `ON_LEAD`는 `LEAD_MUTATIONS`를 펼치므로 두 리드 작업이 자동으로 들어간다.
- `targetOf`에 `code_retire`→`input.code`, `spend_void`→`input.spendId`를 더한다.
- `allowedWithoutContact`(`:930`)에 `strike_lead_code`를 더한다(파기·삭제된 리드의 잘못된 귀속도 고친다). `add_lead_codes`는 넣지 않는다.

**영수증 입력 해시** (R5b-1, R5b-2가 확장): `INPUT_BOUND=['code_issue','spend_record','lead_import_confirm']`. 이 작업의 영수증에 `inputSha256`(= `requestId`를 뺀 입력의 키 정렬 정본 JSON의 SHA-256)을 넣는다. `replay`(`:938-944`)는 지금 작업·브랜드·대상만 비교하므로, 이 작업들은 `inputSha256`도 비교해 다르면 409 `REQUEST_REUSED`다. 대상이 `null`인 작업에서 같은 요청 번호로 다른 파일·채널·직접 코드를 보내면 옛 결과가 200으로 재생되는 문제를 막는다. port의 `receipt`는 `c.inputSha256`을 넘겨받는다.

**처리 순서**는 기존 `franchisePost`(`:964-999`)를 그대로 쓴다: 행위자 → 같은 출처 → 작업·요청 id → 가맹 잠금 → 분당 60회 → 영수증 재생 → 스위치 → 브랜드 → 역할 → 연락처 키 → 분기. 예외는 하나다:

- `NO_LOCK=['lead_import_inspect','lead_import_preview']`는 잠금을 잡지 않고 영수증 재생도 하지 않는다(쓰기·영수증이 없다). 분당 60회는 그대로 센다. `acquireLock`은 기다리지 않고 409를 돌려주므로(`lib/server.ts:55`) 12,000칸 검사를 잠금 안에서 하면 직원의 `create_lead`·`update_task`가 '다른 작업을 저장하고 있습니다' 409를 받는다. 확정은 잠금 안에서 모든 판정을 다시 하고 계획 해시로 미리보기와 대조하므로 잠금 밖 미리보기가 안전하다.

**코드 발급 충돌 조회**: 한 문장으로 두 id를 본다.

```sql
SELECT id FROM records WHERE owner=? AND id IN (?,?)
```

바인드는 `${owner}:tracking_code:${code}`와 `${owner}:recruitment_code:${code}`다. 다른 잠금에서 점포 코드가 동시에 생기는 경우는 막지 못하고, 4.4 충돌 표시와 2.4 귀속 규칙이 맡는다.

**'제공처 보관' 리드 작업 표** (R5b-2): `franchisePost`의 연락처 상태 검사(`:993`)를 둘로 나눈다. `contactState==='external'`이면 아래 허용 목록만 통과하고 나머지는 409 `CONTACT_EXTERNAL`이다. 그 밖의 비보관 상태는 기존 `allowedWithoutContact`와 `CONTACT_GONE`·`LEAD_ERASED`를 그대로 쓴다. 보존 기한이 지난 `external` 리드는 이 검사 전에 `purgeInline`(`:992`)이 `purged`로 바꾸므로 기존 `CONTACT_GONE`('파기되거나 삭제된 연락처입니다. 새 문의로 등록해 주세요.')을 받는다. 계획 R4b 거부 기준(:733 '보존 기한이 지난 연락처는 새 활동으로 되살아나지 않고 … 새 문의는 새 리드')과 같다.

| 작업 | `external` 리드 | 이유 |
|---|---|---|
| `update_contact` | 허용(붙이기 분기만) | A안의 정상 경로 |
| `update_task` | 허용(과업 칸) | 제공처 화면에서 확인한 지역·구간 보정 |
| `add_lead_codes` | 허용 | |
| `strike_lead_code` | 허용(관리자) | |
| `claim_lead`·`assign_lead` | 허용 | 담당을 정해야 연락처를 붙인다 |
| `move_stage` | `to:'closed'`만 허용(중복·연락 불가 등) | 다른 단계는 연락처가 있어야 한다 |
| `erase_lead` | 허용(관리자, 멱등) | |
| `set_marketing_consent` `withdrawn` | 허용(보호 방향, 기존 `allowedWithoutContact`와 같음) | |
| `reveal_contact`, `record_source_notice`, `reopen_lead`, 증빙 7종(`record_*`·`void_evidence`), `set_marketing_consent` `given`, 그 밖 `move_stage` | 409 `CONTACT_EXTERNAL` | 연락처 없이 할 수 없거나(열람·고지·광고성 동의), 연락처 없는 리드를 계약 절차로 보내지 않는다. `reopen_lead`는 마지막 활동을 늘리는 내부 조작이라 막는다 |
| `find_contact`(ON_LEAD 아님) | 바뀜 없음 | 중복 키가 없어 `external` 리드는 찾기 결과에 나오지 않는다 |
| `add_subject_request`(ON_LEAD 아님) | 바뀜 없음 | |

**R5b-2가 고치는 곳** (빠짐없이):

1. `lib/franchise-server.ts:993` 연락처 상태 검사: `external` 분기와 `allowedWhileExternal(action,input)`.
2. `updateContact`(`:553-577`): 지금은 `lead.contact!`를 풀고 `openField(cur.name)`을 부른다(`:554-555`). `contact===null`이면 예외가 나서 500이 된다. `contactState==='external'`이면 붙이기 분기로 간다: 되돌릴 옛 키가 없고, 이름·전화/이메일을 새로 읽고, `contactKeys`로 중복을 검사하고, `contactState:'present'`와 선택 `firstContactAt`을 쓰고, 보상 경로는 새 키 삭제와 리드 원복만 한다. 메모 입력은 받는다(새 메모).
3. `recordSourceNotice`(`:635-636`)의 `basis.type!=='referral'` 검사를 `!needsSourceNotice(basis)`로 바꾼다.
4. 보드 할 일 `TODO.source_notice`(`:1081`)와 `leadSummary`의 `sourceNoticePending`(`:202`)을 `needsSourceNotice`로 바꾼다.
5. `readBasis`(`:288-297`): `provided`는 400(수기 등록에서 고를 수 없다).
6. `purgeFranchise`의 대상 조회(`:239`) `contactState='present'`를 `IN ('present','external')`로 넓힌다. `purgeStatements`는 연락처가 없어도 그대로 돈다(키 삭제 0건).
7. `lib/franchise.ts`: `leadActions`(`:293-307`)·`allowedMoves`(`:277-285`)·`marketingOptions`(`:286-291`)에 `external` 분기(위 표와 같은 목록), `retentionUntil`, `CONTACT_STATE_LABELS`, `BASIS_LABELS`·`INTAKE_BASIS_LABELS`, `needsSourceNotice`, `FRANCHISE_ERRORS.CONTACT_EXTERNAL`. 보드 행의 연락처 상태 판정 `stateOf`(`lib/franchise-server.ts:197`)는 `isContactExpired`를 쓰므로 `retentionUntil` 변경만으로 `external` 만료가 '보존 기한 지남'으로 보인다.
8. 테스트: `tests/franchise-pipeline.test.mjs`(단계·작업 목록), `tests/franchise-lib.test.mjs`(라벨·기한·작업 판정), `tests/franchise-contacts.test.mjs`(붙이기·중복 키).

**가져오기 확정 순서**:

1. `importBasisDecision`으로 근거를 판정해 `bind`에 넣고, `leadImportDecision`을 다시 돌린다(계획 해시 대조 포함). 파일 존재 여부는 `SELECT`로 미리 보고, 경쟁은 UNIQUE가 맡는다.
2. 가명 코드 N개 생성. 기존 코드와의 겹침은 90개씩 나눠 `json_extract(data,'$.systemCode') IN (...)`로 한 번에 조회한다. D1 바인드 한도 100(`lib/store-operations-server.ts:108`)을 지킨다. 파일 안에서도 겹치지 않게 다시 뽑고, 난수가 모자라면 `IMPORT_RETRY` 409다. 제공처 값을 코드로 쓰지 않는다.
3. `commit`으로 한 batch에 쓴다.
4. 응답은 확정 결과와 새 리드 코드 목록(코드만)이다.

**재생과 409**: 같은 요청 id·같은 입력은 영수증으로 같은 결과를 돌려준다. 같은 요청 id·다른 입력은 `REQUEST_REUSED` 409다. 새 요청 id로 같은 파일을 확정하면 409 `IMPORT_DUPLICATE`다.

**개인정보 거부 기록**: 확정 요청이 `sensitive_column_in_file`·`pii_in_file`로 거부되면 영수증이 아닌 일반 감사 행(`plainAudit`, `au-<uuid>`, `lead_import_rejected`)을 남긴다. 건수와 사유 코드만 담고 파일 해시·위치는 담지 않는다. 영수증이 아니므로 파일을 고친 뒤 같은 요청 번호로 다시 보내도 옛 400이 재생되지 않는다. 검사·미리보기는 기록하지 않는다.

### 4.4 GET 보기 (`FRANCHISE_VIEWS`, `lib/franchise-server.ts:1047`)

| 보기 | 역할 | 내용 |
|---|---|---|
| `codes` | 모두 | 브랜드 코드 목록(채널 라벨, 캠페인 제목 또는 `campaignMissing`, 자료 판과 지금 상태, 행사, validFrom, 사용 중지일, 발급자 id·역할), 같은 값 점포 코드 여부(`conflict`), 코드별·채널별 귀속 리드 수(소급·늦은 입력 따로)와 사유별 '유입 미확인' 수, 맨 앞에 `attributionNote`, 채널 목록, `ruleVersion`·`disclaimer` |
| `spend` | 대표·관리자(직원 403) | 비용 목록(무효화·교체 포함 표시, `amountExVat`), 선택 창 `from`·`to`의 `spendInWindow` 결과(채널별 합계·행 수·걸친 행 수)와 `alignedWindow`, `noProrationNote`, `platformNote` |
| `imports` (R5b-2) | 대표·관리자 | 가져오기 기록(4.1의 칸), 제공처 키별 커버한 기간 목록 |
| `board`·`lead` (기존) | 기존 | 리드마다 `attribution`. 할 일 `code_conflict`('모집 코드 충돌', `BOARD_TODO_LABELS` `lib/franchise.ts:85`에 추가). 필터 `inflow`(채널 키·`unattributed`·`conflict`·`import`) |

- `statusView`의 `hasRecords` kind 목록(`:1049-1051`)에 `recruitment_spend`·`recruitment_code`를 더한다. 스위치가 꺼져도 대표·관리자가 비용 무효화·코드 사용 중지 화면에 닿게 한다.
- 귀속 계산에 필요한 점포 코드는 리드에 나온 토큰만 90개씩 id로 조회하고 `{value, createdAt}`만 쓴다. 점포 코드 전체를 읽지 않는다.
- 보기 JSON은 라벨을 그대로 싣는다(JSON은 수식 주입 대상이 아니다). R5에는 CSV 내보내기가 없다. R5 기록을 CSV로 내보내는 R6 이후 경로는 모두 `csvFile`·`csvCell`(`lib/franchise.ts:319-325`)을 써야 한다(R6 명세 요구로 넘긴다).

### 4.5 감사

`AUDIT_ACTION_LABELS`(`lib/franchise.ts:102`)에 더하는 한국어 라벨:

| 키 | 라벨 |
|---|---|
| `code_issue` | 모집 코드 발급 |
| `code_retire` | 모집 코드 사용 중지 |
| `code_strike` | 리드 모집 코드 제외 |
| `spend_record` | 모집 비용 기록 |
| `spend_void` | 모집 비용 무효화 |
| `lead_import` | 리드 CSV 가져오기 |
| `lead_import_rejected` | 리드 CSV 거부 |

감사 행에 더하는 키는 허용 목록으로 테스트한다: `recordId`, `channel`, `periodFrom`, `periodTo`, `fileSha256`, `planSha256`, `inputSha256`, `count`, `skipped`(사유별 건수), `reasons`(사유 코드), `ruleVersion`, `importVersion`, `status`.

넣지 않는 것: 코드 라벨, 증빙 문구, 금액, 제공처 라벨, 보관 위치 라벨, 머리글 이름, 칸 값, 제외 사유 자유 문구(사유는 코드만). R4b 원칙대로 감사에는 값을 담지 않는다.

### 4.6 문서 행

**`docs/SECURITY-BOUNDARIES.ko.md`**: `:71` 뒤에 더한다. `:7` 마지막 갱신과 표 아래 가맹 문단도 고친다.

| 작업 | API | 대표 | 관리자 | 직원 |
|---|---|---|---|---|
| 모집 코드 발급 / 사용 중지(R+7자, 같은 값 점포·모집 코드 409, 분기 A 아님 409, 모집 목적 아닌 캠페인·미승인·재검토·옛 판 자료 409, 스위치 꺼짐 409. 사용 중지는 과거로 소급하지 않고 스위치가 꺼져도 된다) | `/api/franchise` `code_issue` / `code_retire` | 허용(감사) | 허용(감사) | 403 |
| 모집 코드·귀속 보기(건수만, 귀속≠증분 표시) | `/api/franchise` GET `codes` | 허용 | 허용 | 허용 |
| 리드에 모집 코드 넣기(추가만) / 제외 기록 | `/api/franchise` `create_lead` `codes`·`add_lead_codes` / `strike_lead_code` | 허용 / 허용(감사) | 허용 / 허용(감사) | 본인 담당만 / 403 |
| 모집 비용 기록 / 무효화, 비용 보기(음수·광고분담금·점주 추천 금액 400, 중복·겹침 확인 없으면 409, 행사가 참조한 비용 무효화 409, 기간 비용 일할 없음) | `/api/franchise` `spend_record` / `spend_void`, GET `spend` | 허용(감사) | 허용(감사) | 403. 무효화는 스위치가 꺼져도 된다 |
| 리드 CSV 파일 검사·미리보기·확정, 가져오기 기록 보기(UTF-8 아님 400, 민감 열 이름·개인정보 칸 하나면 파일 전체 400, 같은 파일 409, 분기 A 아님 409, 스위치 꺼짐 409) (R5b-2) | `/api/franchise` `lead_import_inspect`·`lead_import_preview`·`lead_import_confirm`, GET `imports` | 허용(감사) | 허용(감사) | 403 |
| 제공처 보관 리드에 연락처 붙이기(중복 409, 보존 기한 지남 409) (R5b-2) | `/api/franchise` `update_contact` | 허용 | 허용 | 본인 담당만(기존 행과 같음) |

기존 행사 행(`:70`)에는 '비용 참조는 같은 브랜드의 유효한 모집 비용 기록만(없으면 400)'을 더한다.

**`docs/DATA-PROCESSING.ko.md`** (R5b-2, 레인 A 검토):

- 3.5의 "수집 경로는 담당자가 직접 입력하는 것 하나다"(`:168`)를 두 경로로 고친다. 가져오기 경로는 대표·관리자, 연락처 없는 메타데이터, 제공처·제공일·내보내기 기간·동의 증빙 참조, UTF-8 원본 해시다.
- 3.5 표에 가져온 메타데이터 행과 `recruitment_import` 행을 더한다. 가져온 리드도 H11(접수 +180일, 연락처를 붙이면 마지막 활동 +180일)을 받는다고 적는다.
- 4.1에 리드 CSV 민감 열 이름·개인정보 거부 행을 더한다. "이 두 가져오기만 검사한다"(`:188`)를 고친다. 값 패턴 검사가 최선 노력이라는 한계를 적는다.
- DP-10 검증 2의 금지 모듈 목록에 새 모듈을 더한다. DP-10의 '레인 B 검토 대상'(`:229`) 표현을 LANES에 맞춰 '레인 A 검토'로 고친다(같은 PR, 레인 A 검토 대상).
- 받아들여지기 전에는 R5b-2 코드를 게시 대기열에 올리지 않는다.

### 4.7 모델 입력 경계 (DP-10)

- `tests/franchise-model-boundary.test.mjs:62` `FORBIDDEN`에 더한다:
  - R5a: `lib/franchise-recruitment.ts`, `lib/franchise-lead-import.ts`
  - R5b-1: `lib/franchise-recruitment-server.ts`
  - R5c: `app/franchise-inflow-panel.tsx`
- `:72` 정규식을 `/recruitment_(asset|event|code|spend|import)/`로 넓힌다.
- 모의 HERMES 실행(`:91` 이후)에 코드 라벨·비용 증빙 문구·가져온 지역·제공처 라벨 표지 문자열을 심고, 제출 본문·콘솔 0건을 확인한다.
- 모집 비용은 growth 역할 입력(`aiBudget`, `lib/agency.ts:47-51`)이나 캠페인 `Metric`에 쓰지 않는다. 점포 `store_spend`에도 쓰지 않는다. 그랬다면 `lib/store-context.ts:16`으로 모델 입력에 들어간다.

## 5. 화면 (R5c)

**탭**: `franchiseTabs`(`lib/nav-state.ts:15`)의 `events` 뒤에 `inflow`('유입·비용')를 더한다. 모든 역할에 보이고, 쓰기 영역은 역할·스위치·분기에 따라 보인다. `tests/nav-state.test.mjs`의 목록과 `tests/franchise-ui.test.mjs:424` 탭 문자열을 고친다. 내비 파일이 다른 레인의 열린 PR과 겹치면, 탭 없이 리드 탭 안 하위 영역으로 두는 대안으로 간다(규칙 2).

**`app/franchise-inflow-panel.tsx`**:

1. **머리**: `attributionNote`와 `disclaimer`를 모든 건수보다 먼저 그린다(UI-R2가 순서를 확인한다).
2. **모집 코드**:
   - 목록: 코드 복사, `utm` 쿼리 복사, 채널, 캠페인(삭제 표시), 자료 판(지금 상태), 행사, validFrom, 사용 중지일, 귀속 수(소급·늦은 입력 따로), 충돌 배지 '점포 코드와 같은 값 · 확인 필요'.
   - 발급 양식(대표·관리자): 채널 10개, 모집 목적 캠페인만, 승인·재검토 없음·지금 판 자료만, 행사, 라벨, validFrom, 직접 코드(선택). 사용 중지 버튼(날짜는 오늘 이후).
   - 직원에게는 발급 버튼 대신 '관리자에게 요청하세요'를 보인다.
3. **모집 비용** (대표·관리자):
   - 양식: 채널, 하루·기간 전환, 금액(정수 원, 천 단위 표시), 부가세 포함·제외(필수), 외화 원금(선택), 출처(본부 모집 예산 하나만. 광고분담금은 선택지로 두지 않고 안내 문구만 보인다), 증빙 라벨, 자료 판, 플랫폼 보고 수치 3개('플랫폼 보고, 원장 리드 아님' 라벨).
   - 점주 추천 채널을 고르면 금액 칸을 0으로 고정하고 '점주 추천에는 금전 보상을 기록하지 않습니다(결정 27)'를 보인다.
   - 중복·겹침 409를 받으면 기존 행 요약(기간·금액)과 '그래도 기록' 확인을 보이고, 확인하면 `acknowledgeDuplicate:true`로 다시 보낸다.
   - 목록과 무효화(사유 선택), '고쳐 다시 적기'(`replacesSpendId`), 기간 합계와 '일부만 걸친 비용' 줄, 걸친 비용이 있는 채널의 '비용 기간 불일치'.
   - 검색광고 채널을 고르면 수기 입력 안내를 보인다.
4. **리드 가져오기** (대표·관리자, R5b-2 뒤):
   1. 파일 고르기. `ArrayBuffer`로 읽고 100,000바이트를 넘으면 막는다. `localFileCheck`로 인코딩·민감 열 이름·개인정보를 기기에서 먼저 검사하고 걸리면 보내지 않는다.
   2. `encoding_invalid`면 'EUC-KR로 읽기'를 보인다(2.6.2의 4).
   3. `lead_import_inspect`로 머리글·행 수·추천 매핑을 받는다.
   4. 채널, 제공처(이전 제공처 선택지 먼저), 제공일, 내보내기 기간, 동의 증빙 참조(포털·박람회 필수), 행사(박람회·설명회), 수집 근거(2.7.1 표의 선택지와 설명).
   5. 매핑 선택. 허용 대상만 선택지에 있고 금지 대상은 아예 없다.
   6. 미리보기로 만들 수, 건너뜀 사유, 경고(파일 안 중복 가능성·보존 기한 임박·기간 끝 날), '파일 안 같은 행 건너뛰기' 선택, 귀속 요약, 행 오류(행·열)를 본다.
   7. 확정 대화에 브랜드 이름·건수·제공처를 크게 보이고 `expected:{planSha256,toCreate}`를 보낸다. 409 `expected_mismatch`면 미리보기를 다시 한다.
   8. 가져오기 기록 목록을 본다.
   - 개인정보 거부는 행·열 목록만 보이고 값은 보이지 않는다. 민감 열 이름 거부는 열 번호만 보인다.

**다른 화면**:

- 리드 등록 양식과 상세: '모집 코드' 칸(추가만, R 형식 미리 검사), 귀속 라벨과 사유, 관리자의 '코드 제외'(사유 선택). 수집 근거 선택지는 `INTAKE_BASIS_LABELS`만 보인다.
- A안 리드: '연락처 제공처 보관' 표시, '연락처 붙이기'(기존 연락처 수정 양식 재사용, 첫 연락 시각 선택), `CONTACT_EXTERNAL` 작업 버튼은 숨긴다. 중복 409면 '가져온 문의를 중복으로 종결하세요' 안내.
- 보드: 할 일 칩 `code_conflict`, 유입 필터.
- 행사 편집기(`app/franchise-events-panel.tsx:64-66`, `:205`): 하드코딩 `spendRef:null` 대신 대표·관리자에게 같은 브랜드 유효 비용 선택지를 보인다. '모집 비용 연결은 R5 뒤에 합니다.' 문구를 지운다. `tests/franchise-ui-render.test.mjs:216`, `tests/franchise-ui.test.mjs:352-355`·`:411-412`를 고친다.

**R15a-2b 규칙을 그대로 따른다**:

- fetch는 `/api/franchise`만 한다.
- 요청 번호는 `sendAttempt`(`app/franchise-common.tsx:144-150`) 규칙을 쓴다: 응답이 없을 때(status 0)만 같은 내용 재시도에 같은 번호를 쓰고, 응답을 받으면 새 번호다. 비멱등 생성 세 작업(`code_issue`·`spend_record`·`lead_import_confirm`)만 5xx에도 같은 내용이면 같은 번호를 쓴다. 커밋 뒤 5xx가 나도 서버 영수증이 한 번만 반영한다(입력 해시가 같아야 재생된다). 400이면 해당 입력으로 초점을 옮기고 새 번호다.
- 모든 입력과 양식은 자동 완성을 끈다. GET 쿼리에는 브랜드 id·필터만 싣는다.
- AI 도움 표시와 `lib/ai-disclosure` import는 없다.

## 6. 테스트 계획

허용된 품질 게이트는 계획 :908의 기존 것뿐이다. R5가 쓰는 것은 `node scripts/test.mjs`, `node node_modules/typescript/bin/tsc --noEmit`, `node scripts/lint-gate.mjs`, `node scripts/run-framework.mjs build`, CI verify다. 프롬프트를 바꾸지 않으므로 `check-prompts`는 해당이 없고, Playwright는 6.4에 적는다. 새 게이트는 만들지 않는다. 각 스위트는 `node --experimental-vm-modules tests/<이름>.test.mjs`로 돌고 `{"passed":N}`을 출력한다(`scripts/test.mjs:12`).

### 6.1 스위트

| 스위트 | 조각 | 확인 | 근거 |
|---|---|---|---|
| `tests/recruitment-codes.test.mjs`(새) | R5a(RA-9는 R5b-2) | 코드 형식·생성·토큰·발급·사용 중지 판정, 채널, 귀속(`asOf`·제외·소급·늦은 입력), 비용 판정·무효화·기간 합계·정렬 창, 구문 import 검사, 결정 객체 불변식 | passed · mocked(합성 입력, 외부 호출 0) |
| `tests/lead-import.test.mjs`(새) | R5a(LI-B는 R5b-2) | 해독·인코딩, 구조·한도, 민감 열 이름, 개인정보 거부 위치, 매핑, 시각 문법·범위, 지역, 제공 증빙·기간, 건너뜀, 파일 해시·계획 해시, 확인 값, 구문 import 검사 | passed · mocked(가상 CP949·UTF-16 바이트 고정 파일 포함) |
| `tests/franchise-model-boundary.test.mjs`(고침) | R5a·R5b | FORBIDDEN 추가, kind 정규식, 모의 HERMES 0건 | passed · mocked + 정적 |
| `tests/recruitment-route.test.mjs`(새) | R5b-1 | 실제 `/api/franchise` 라우트·메모리 SQLite: 역할 403, 스위치 409, 분기 409, 충돌 409, 재생·입력 해시, 비용, `spendRef`, 리드 코드·제외·귀속·충돌 할 일, 사용 중지, 감사 허용 키 | passed · mocked(메모리 SQLite는 D1 대용, 로컬 인증 헤더) |
| `tests/record-kinds.test.mjs`(고침) | R5b-1·2 | 위치, 축, `retain`/`keep`, `blocksDeletion` 없음 | passed · mocked |
| `tests/franchise-assets-route.test.mjs`(고침) | R5b-1 | H35(`:388-389`)·J(`:713-714`)를 `SPEND_REF_UNKNOWN`과 유효 참조 200으로, `NEW_ERRORS`(`:633`) | passed · mocked |
| `tests/franchise-lib.test.mjs`(고침) | R5b-1·2 | 이벤트·감사 라벨, `ACTIVITY_EVENTS` 불변, `CONTACT_STATE_LABELS`·`BASIS_TYPES` 4개·`INTAKE_BASIS_TYPES` 3개, `retentionUntil`의 `external`, `leadActions`·`allowedMoves`의 `external`, `needsSourceNotice` | passed · mocked |
| `tests/lead-import-route.test.mjs`(새) | R5b-2 | 검사·미리보기 무쓰기·무잠금, 확정, 409들, 402문장, A안 리드 상태·작업 표, 연락처 붙이기, 보존 기한, 동시 확정 | passed · mocked |
| `tests/franchise-pipeline.test.mjs`(고침) | R5b-2 | `external` 리드의 단계 이동·작업 거부 | passed · mocked |
| `tests/franchise-contacts.test.mjs`(고침) | R5b-2 | 가져온 파일의 매핑하지 않은 칸 원문이 D1 행·콘솔 어디에도 0건, 붙이기 중복 키 | passed · mocked |
| `tests/franchise-ui.test.mjs`·`franchise-ui-render.test.mjs`·`franchise-recruit-ui.test.mjs`·`nav-state.test.mjs`(고침) | R5c | 탭, 역할별 버튼, 귀속≠증분 순서, 금지 대상 미노출, 광고분담금 선택지 없음, 점주 추천 금액 0 고정, 비용 선택지, 값 없는 오류, 요청 번호 규칙, EUC-KR 변환 요청 모양 | passed · mocked(SSR, 실제 라우트 + 메모리 SQLite) |
| Playwright E2E | R5c | 실제 브라우저 | not_run: 가맹 E2E가 없고 스위치·분기 A·사실 준비가 필요하다(R15a-2b와 같음) |

### 6.2 수용·거부 사례

**R5a** `tests/recruitment-codes.test.mjs`:

- **RC-S1 구문**:
  - `./tracking-codes` import가 `CODE_ALPHABET`·`normalizeCode` 두 이름뿐이다.
  - 금지 모듈(2.1) import가 0건이다.
  - `store-marketing` 문자열이 없다.
- **RC-F1~F6 형식**:
  - `R2345678` 받음.
  - `r234-5678`·전각 → 정규화 뒤 받음.
  - `C2345678`·`L2345678`은 거부. L은 알파벳 밖이다.
  - 9자·7자는 거부.
  - `0 O 1 I L`이 든 값은 거부.
  - 생성 2만 개가 모두 형식에 맞고 `scanText` 0건이다.
  - 난수가 모자라면 null.
- **RC-T 토큰**:
  - 구분자 5종을 나눈다.
  - `utm_content`를 추출한다. 퍼센트 인코딩과 `#` 뒤 무시를 확인한다.
  - `UTM_CONTENT=`·`Utm_Content=`도 추출한다.
  - 한 칸의 두 주소에 든 `utm_content` 두 개를 모두 꺼낸다.
  - 일반 코드와 주소가 섞인 칸은 둘 다 꺼내고 칸 안 순서를 지킨다. 같은 코드는 먼저 나온 것 하나다.
  - 점포 코드는 버리고 센다.
  - 6개째에서 잘린다.
- **RC-CH 채널**:
  - 10개가 계획 순서와 한국어 라벨 그대로다.
  - 점포 키 11개와 교집합이 0이다.
  - 점포 키로 비용을 기록하면 400이다.
- **RC-D 발급 판정**:
  - D1 성공 값의 모양.
  - D2 스위치 꺼짐 409가 역할보다 먼저다.
  - D3 직원 403(거부 사례: 권한).
  - D4 분기 B·C·미판정 409.
  - D5 `taken.tracking` 409, `taken.recruitment` 409.
  - D6 validFrom 경계: today−90과 +180은 받고, −91과 +181은 400.
  - D7 라벨에 전화번호가 있으면 400이고 문구에 값이 없다.
  - D8 다른 브랜드 캠페인 400, 목적 아님 409, 취소 행사 409.
  - D8b 자료: `draft` 409 `asset_not_approved`, `retired` 409 `asset_not_approved`, 재검토 걸림 409 `asset_review_needed`, 옛 판 409 `asset_superseded`, 승인·지금 판 200.
  - D9 한 단계의 코드는 같은 상태다(표 전수).
- **RC-R 사용 중지 판정**:
  - 오늘 200, 어제 400 `retire_date_invalid`, validFrom 전 400, today+181 400.
  - 이미 사용 중지 409.
  - 직원 403, 스위치 꺼짐 200.
- **RA 귀속**:
  - RA-1: 첫 유효 코드가 이긴다. 순서를 바꾸면 결과가 바뀐다.
  - RA-2: 앞의 무효 토큰(미등록·다른 브랜드·시작일 전)을 건너뛴다.
  - RA-3: `2026-10-05T14:59:59Z`(KST 23:59, 10-05)는 validFrom 10-06 코드에 귀속되지 않고, `T15:00:00Z`는 귀속된다.
  - RA-4: 코드가 없으면 `no_code`이고 '유입 미확인'이다.
  - RA-5: 사유 우선순위(`after_retired` 포함).
  - RA-6: 결정 토큰이 점포 코드 값과 같으면 `conflict`이고, 뒤 토큰으로 넘어가지 않는다.
  - RA-7: 앞 토큰이 유효하면 뒤의 충돌 토큰은 결과를 바꾸지 않는다.
  - RA-8: `alsoMatched` 수.
  - RA-10 `asOf`: `asOf` 뒤에 넣은 리드 토큰, `asOf` 뒤에 만든 모집 코드, `asOf` 뒤에 만든 점포 코드(충돌), `asOf` 뒤 제외 기록, `asOf` 뒤 사용 중지는 모두 결과를 바꾸지 않는다. `attributionInputs`는 같은 입력에 같은 목록이다.
  - RA-11 제외: 첫 토큰을 제외하면 다음 토큰이 결정한다. 모두 제외하면 `no_code`다.
  - RA-12 사용 중지: `retiredOn` 전날 접수는 귀속, 당일 접수는 `after_retired`.
  - RA-13 표시: 코드 `createdAt` > 토큰 `at`이면 `retroactive`. 토큰 `at` − 접수 = 72시간은 `late` 아님, 72시간 1초는 `late`, `source:'import'` 토큰은 몇 시간이든 `late` 아님.
  - RA-9(R5b-2): 코드 없는 가져온 리드는 `basis:'import'`와 가져오기 채널, 코드가 있으면 코드 귀속이 이긴다, 충돌이면 `conflict` 그대로다.
- **RS 비용**:
  - RS-1~4: 필수 칸 각각이 없으면 400이다(`vat` 포함). `date`와 `period`를 둘 다 주면 400이다.
  - RS-5: −1은 `amount_negative`, 1.5·'1000'·NaN은 `amount_invalid`, 0은 200이다.
  - RS-5b: `vat:'included'` 11000 → `amountExVat` 10000, 11001 → 10000(버림). `vat` 다른 값 400. `original` 통화 'KRW'·'usd'·금액 '1.234'는 400.
  - RS-6: `ad_fund`는 400이다. `hq_budget`에 증빙 '광고 분담금 정산'이어도 400이다.
  - RS-6b 문구 양방향: '광.고.분.담.금'·'점주 부담 광고비'·'판촉비 분담'·'Ad Fund'·'광고기금'은 400, '분담금 없음(본부 전액 부담)'·'월 광고비 소진'은 200.
  - RS-6c 결정 27: `owner_referral` 금액 1은 400 `referral_reward_forbidden`, 금액 0은 200, 증빙 '분양대행 성과 수수료'는 200과 경고 `agency_fee_wording`.
  - RS-7: 플랫폼 수치 null 유지. −1·1.2는 400, 클릭이 노출보다 크면 경고다.
  - RS-8: 다른 브랜드 자료 400, 채널이 안 맞으면 경고다.
  - RS-8b: 미승인·폐기 409 `asset_not_approved`, 재검토 409 `asset_review_needed`, 옛 판 409 `asset_superseded`.
  - RS-9: 저장 값에 `PLATFORM_REPORTED_NOTE`가 있다.
  - RS-10: 창 안 행만 합계에 넣고, 걸친 행은 `straddling`에만 두고, 무효화 행은 뺀다. 합계에 나눈 금액이 없다.
  - RS-10b: `byChannel`은 채널별 `{total,rowCount,straddlingCount}`이고 행이 없는 채널은 키가 없다(0과 구분).
  - RS-11: 검색광고 경고.
  - RS-12: 미래 기간 400, `from > to` 400, 367일 400.
  - RS-13: 무효화 사유 외 값 400, `replaced` 직접 입력 400, 이미 무효화 409, 스위치 꺼짐 허용, 직원 403(거부 사례: 권한).
  - RS-13b: 행사가 참조한 행 무효화 409 `spend_referenced`.
  - RS-14 `asOf`: `asOf` 뒤 무효화는 아직 합계에 있고, `asOf` 뒤 기록한 행은 없다. `inputs`는 같은 입력에 같은 목록이다.
  - RS-15 중복·겹침: 같은 채널·기간·금액은 409, `date:'2026-10-01'`과 `period:{2026-10-01,2026-10-01}`은 같은 기간으로 본다. 같은 채널·캠페인·자료의 월·주 기간 겹침은 409 `spend_period_overlap`. 둘 다 `acknowledgeDuplicate:true`면 200과 경고다.
  - RS-16 교체: 무효화된 행·다른 채널 행 교체는 409 `spend_replace_invalid`, 참조된 행 교체는 409 `spend_referenced`, 정상 교체는 새 행과 `replaced` 무효화, 중복 검사에서 교체 대상은 빠진다.
  - RS-17 정렬 창: 걸친 월 행이 있으면 `alignedWindow`가 그 달을 품는 창을 돌려주고, 366일을 넘으면 null이다. 걸친 행이 없으면 `expanded:false`.
  - RS-18 직원 비용 기록 403(거부 사례: 권한).
- **RD 공통**:
  - 입력 칸에 표지 문자열을 넣어도 모든 `message`에 나오지 않는다.
  - 상태표·문구표·코드 목록의 키가 같다.
  - 내보낸 상수는 얼어 있다.

**R5a** `tests/lead-import.test.mjs`:

- **LI-S1 구문**:
  - `./order-import` import가 `parseCsv`·`IMPORT_LIMITS` 두 이름뿐이다.
  - `checkMapping`·`findPersonalData` 문자열이 없다.
  - 바이트·행 한도가 `IMPORT_LIMITS` 이하이고 `maxAgeDays === UNCONVERTED_RETENTION_DAYS`다.
- **LI-E 인코딩·전송**:
  - E1 CP949로 저장한 '접수일시,희망지역' 고정 바이트 → 400 `encoding_invalid`(깨진 머리글 미리보기가 아니다).
  - E2 UTF-16LE(BOM `FF FE`) → 400.
  - E3 U+0000이 든 UTF-8 → 400.
  - E4 BOM 있는 바이트와 없는 바이트: `fileSha256`이 다르고, 각각 Node `crypto.createHash('sha256')`로 계산한 원본 바이트 해시와 같고, 정규화 행은 같고, `hadBom`이 true·false다.
  - E5 탭이 가득한 100,000바이트 파일의 요청 JSON(`csvBase64` 포함)이 200,000바이트 안이다. 100,001바이트는 400 `file_too_large`.
  - E6 base64 알파벳 밖 문자·133,337자 → 400.
- **LI-F 파일**:
  - 201행은 400.
  - 머리글만 있으면 '가져올 리드 행이 없습니다.'이고 '주문' 문구는 없다.
  - 따옴표 오류는 줄 번호만 담는다.
- **LI-A 파일 검사**:
  - A1 매핑 없이 머리글·행 수·추천 매핑·파일 해시를 돌려준다.
  - A2 직원 403, 스위치 꺼짐 409, 분기 B 409(거부 사례).
  - A3 민감 열 이름이 있으면 `headers`를 싣지 않는다.
  - A4 `localFileCheck`와 서버 판정의 파일·검사 단계 결과가 같다(같은 바이트, 같은 사유·위치).
- **LI-P 개인정보** (모든 경우 파일 전체 400, 칸 값·탐지 종류 0건):
  - P1 매핑하지 않은 열의 전화번호 → 행·열 이름.
  - P2 이메일.
  - P3 주민등록번호 형식.
  - P4 여권 후보(`M12345678`).
  - P5 카드 13자리.
  - P6 머리글 값에 전화번호가 있으면(예: '010-0000-0000 담당') 400 `sensitive_column_in_file`이고 'N번째 열'로만 보인다.
  - P7 20곳을 넘으면 위치 20개와 전체 건수.
  - P8~P27 가져오기 전용 탐지(값마다 한 사례): `0082-10-1234-5678`, `1012345678`, `10-1234-5678`, `1.01234E+09`, `9.00101E+12`, `010   1234   5678`, `0 1 0 1 2 3 4 5 6 7 8`, `010~1234~5678`, `010_1234_5678`, `"010,1234,5678"`, `٠١٠-١٢٣٤-٥٦٧٨`, `010-****-5678`, `hong(at)gmail.com`, `hong%40gmail.com`, `hong @ gmail.com`, `hong@naver`, `010%2D1234%2D5678`, `900101-1******`, `90.01.01-1234567`, `900101_1234567`.
  - P28 일반 머리글(`값1`·`값2`·`값3`) 아래 이웃 칸 `010`·`1234`·`5678` → 세 칸 모두.
  - P29 오탐 방지(통과): 매핑한 접수 시각 `2026-09-24 14:30:00`, 예산 '5천만~1억원', 지역 '서울 강남구', 코드 `R2345678`, 날짜 `2026.09.24`.
  - P30 고정 문구에 날짜·코드 길이 안내가 있고 칸별 종류는 없다. 코드 열의 `R23456789`(오타)는 거부되고 위치만 보인다.
- **LI-M 매핑·민감 열 이름**:
  - M1 금지 대상(이름·전화·주민번호·메모·외부 id)은 400.
  - M2 모르는 대상 400, 한 열을 두 대상에 쓰면 400.
  - M3 '휴대폰' 머리글이 있으면(매핑과 무관) 400 `sensitive_column_in_file`.
  - M4 `receivedAt`이 없으면 400.
  - M5 추천 매핑이 민감 머리글을 고르지 않는다.
  - M6 매핑하지 않은 '이름'·'문의내용'·'신청자명'·'휴대폰1'·'생년월일'·'full_name'·'phone_number'·'id' 머리글 → 400이고 오류는 열 번호만이다. 메타 내보내기 머리글 `campaign_name`·`ad_name`·`adset_name`·`form_id`·`platform`과 접수일시·희망지역·창업예산은 통과한다.
  - M7 열 번호 −1·1.5·'0'·머리글 수 이상 → 400. 키 `__proto__`·`constructor` → 400 `mapping_invalid`이고 예외가 없다.
- **LI-R 행**:
  - R1 받는 시각: `2026-10-05 14:05`, `2026-10-05 14:05:03`, `2026.10.05 14:05`, `2026/10/05 14:05`, `2026-10-5 9:05`, `2026. 10. 5. 오후 2:05`, `2026-10-05 오후 2:05:03`, `2026-10-05 오전 12:10`(00:10), `2026-10-05 오후 12:10`(12:10), `2026-10-05T14:05`(KST), `2026-10-05T05:05:00Z`, `2026-10-05T14:05:00+09:00`.
  - R2 거부: `2026-02-30 10:00`, `2026-10-05 24:00`, `2026-10-05 10:60`, `2026-10-05 오후 13:00`.
  - R3 날짜만: 박람회·설명회는 받고 `receivedPrecision:'day'`와 KST 00:00, 리드광고는 `received_date_only`.
  - R4 `now`+4분은 받고 +6분은 `received_future`.
  - R5 오늘 −179일(KST 날짜)은 받고 −180일은 `received_too_old`. 같은 파일을 날짜가 바뀐 뒤 확정하면 409 `expected_mismatch`다.
  - R6 제공일 뒤는 `received_after_provided`, 선언 기간 밖은 `received_outside_period`.
  - R7 지역: '서울 강남구'·'경기 성남시 분당구'·'서울특별시'는 받고, '홍길동'·'강남구'·'서울 강남' 은 `region_invalid`, 숫자가 있으면 `region_invalid`.
  - R8 예산 라벨·키는 매핑되고, 모르는 값은 `unknown`과 경고 건수가 되며 값은 응답에 없다.
  - R9 보존 기한 14일 안 행은 경고 `expiring_within_14d` 건수.
- **LI-V 제공 증빙** (V1~V9):
  - V1 포털에 `consentRef`가 없으면 400, 박람회도 400.
  - V2 리드광고에 `consentRef`가 없어도 되지만 `provider`·`providedOn`·`period`가 없으면 400 `provenance_required`.
  - V3 해시가 63자면 400.
  - V4 보관 위치가 목록 밖이면 400, 목록이 비었으면 400 `storage_labels_unset`.
  - V5 제공처 라벨에 이메일이 있으면 400 `provider_pii`.
  - V6 `period.from > to`, 181일, `to > providedOn`, `from < today−179`는 400 `period_invalid`.
  - V7 `to === providedOn`은 경고 `period_includes_export_day`.
  - V8 `eventId`: 리드광고 채널 400 `event_channel_mismatch`, 다른 브랜드 400, 취소 409.
  - V9 '창업포털A'와 '창업 포털a'는 같은 `providerKey`다.
- **LI-B 수집 근거(R5b-2, 2.7.1)**:
  - B1 포털 `provided`·`inquiry_response`는 받고 둘 다 `consentRef` 필수.
  - B2 모든 채널에서 `consent`는 400 `basis_invalid`.
  - B3 점주 추천 `referral`은 받고 `referralFrom:'franchisee'`, 리드광고 `referral`은 400.
  - B4 근거가 바뀌면 `planSha256`이 바뀐다.
- **LI-K 건너뜀**:
  - K1 이전 기간 09-01~09-15, 새 기간 09-10~09-20 → 09-10~09-15 행은 `overlap`, 나머지는 생성.
  - K2 10월을 가져온 뒤 9월(기간 안 겹침)을 가져오면 모두 생성(뒤늦은 가져오기).
  - K3 제공처 라벨 변형(공백·대소문자)과 다른 채널 선택도 같은 커버리지에 걸린다.
  - K4 기간 밖 날짜 한 행은 `received_outside_period`로 확정을 막고 커버리지를 넓히지 않는다.
  - K5 같은 분·지역·구간·코드 없음 두 행은 기본으로 둘 다 생성되고 경고 건수 1이다. `dropInFileDuplicates:true`면 1행만 생성되고 `duplicate_in_file` 1이다.
  - K6 모두 건너뛰면 409 `no_new_rows`다.
- **LI-H 해시·확정**:
  - H1 같은 바이트는 같은 해시다(E4와 함께).
  - H2 확정에 `expected`가 없으면 400이다.
  - H3 `toCreate`가 다르면 409다.
  - H4 `fileExists`면 409다.
  - H5 분기 B면 409가 파일 검사보다 먼저다.
  - H6 같은 파일에 매핑·브랜드·채널·제공처·기간·행사·`dropInFileDuplicates`·`bind` 가운데 하나만 바꿔도 `planSha256`이 바뀌고, 옛 값으로 확정하면 409 `expected_mismatch`다.

**R5b-1** `tests/recruitment-route.test.mjs`:

- **RR-C1**: 대표 발급 200이고, 코드 행 1개와 감사 1개가 생긴다.
- **RR-C2**: 같은 요청 id·같은 입력을 다시 보내면 같은 코드가 오고 행은 그대로다. 다른 작업에 같은 요청 id를 쓰면 `REQUEST_REUSED` 409다.
- **RR-C2b**: 같은 요청 id로 채널이나 직접 코드만 바꿔 보내면 `REQUEST_REUSED` 409이고 쓰기 0건이다. `spend_record`도 같다.
- **RR-C3**: 점포 라우트로 직접 코드 `R2345678`을 만든 뒤 같은 값을 발급하면 409다(실제 `/api/store-operations`).
- **RR-C4**: 같은 코드를 동시에 두 번 발급하면 200 하나와 409 하나다. 500이 아니다. 행은 1개다.
- **RR-C5**: 모집 목적 아닌 캠페인 409, 다른 브랜드 캠페인 400.
- **RR-C6**: 사용 중지 200 뒤 그날 이후 등록 리드는 `after_retired`, 전날 접수 리드는 그대로 귀속. 직원 403, 스위치 꺼짐 200, 판 불일치 409 `CODE_STALE`.
- **RR-P1**: 직원의 `code_issue`·`code_retire`·`spend_record`·`spend_void`·`strike_lead_code`, GET `spend`는 403이고 쓰기 0건이다.
- **RR-P2**: 스위치 꺼짐이면 발급·기록·코드 추가 409, 무효화·사용 중지 200이다.
- **RR-P3**: 분기 B면 발급 409, 비용 기록 200이다.
- **RR-S1**: 비용 음수 400, 광고분담금 400, 점주 추천 금액 400, 성공 200.
- **RR-S2**: 무효화 버전이 어긋나면 409.
- **RR-S3**: `spend` 보기의 채널별 합계·걸친 행 수·정렬 창.
- **RR-S4**: 중복 409, `acknowledgeDuplicate` 200. 교체는 한 batch에 새 행과 `replaced` 무효화를 쓴다.
- **RR-S5**: 행사 `spendRef`가 가리키는 비용의 무효화·교체는 409 `spend_referenced`.
- **RR-S6**: `vat:'included'` 기록의 저장 행에 `amount`·`vat`·`amountExVat`가 있다.
- **RR-E1**: 행사 `spendRef`가 없는 id·다른 브랜드·무효화 비용이면 400 `SPEND_REF_UNKNOWN`, 유효 비용이면 200이다. H35·J를 바꾼다.
- **RR-A1**: 등록한 리드에 코드를 넣으면 보드·상세에 채널 라벨이 나온다.
- **RR-A2**: `add_lead_codes`는 앞 코드를 바꾸지 않는다. 지우는 입력은 400이다. `lastActivityAt`과 `retentionUntil`이 바뀌지 않고 이벤트는 `codes_added`다.
- **RR-A3**: 나중에 점포 라우트로 같은 값 코드를 만들면 그 리드가 `conflict`가 되고 할 일 건수 1, `codes` 보기에 충돌 표시가 나온다.
- **RR-A4**: 직원은 본인 담당 리드에만 코드를 넣는다(거부 사례: 다른 직원 리드 403).
- **RR-A5**: 관리자 `strike_lead_code` 200 뒤 귀속이 다음 토큰으로 옮겨 가고, 이벤트 `codes_struck`, `lastActivityAt` 불변. 리드에 없는 코드 400, 다시 제외 409, 직원 403. 파기된 리드에도 된다.
- **RR-V1**: `codes` 응답에서 `attributionNote`가 건수 키보다 앞선다. 직원도 200이다.
- **RR-L1**: 감사 행 키가 허용 목록 안에 있다. 라벨·증빙 문구·금액 표지 문자열이 감사·콘솔에 0건이다.
- **RR-L2**: 라벨 `=HYPERLINK("x")`와 증빙 `-2+3+cmd|' /C calc'!A0`은 저장·보기에서 원문 그대로이고(JSON), `csvCell`에 넣으면 앞에 `'`가 붙는다(R6 내보내기 요구의 기준 사례).
- **RR-M1**: 모의 HERMES 역할·회의 실행 제출 본문에 코드 라벨·증빙 표지가 0건이다.

**R5b-2** `tests/lead-import-route.test.mjs`:

- **RI-1**: 미리보기 200. 전후 D1 행 수가 같다. 영수증이 없다.
- **RI-1b**: 파일 검사 200은 매핑 없이 머리글·행 수·추천 매핑을 돌려주고 쓰기·영수증이 없다.
- **RI-2**: 200행 확정. 리드 200, 이벤트 200, 가져오기 1, 감사 1(402문장)이 생긴다. 리드는 `contactState:'external'`, `contact:null`, `lastActivityAt===receivedAt`, `createdAt`은 확정 시각, `importId`는 `ri-`로 시작한다.
- **RI-3**: 같은 요청 id·같은 입력 재생 200은 결과가 같고 행이 그대로다.
- **RI-3b**: 같은 요청 id로 다른 파일을 확정하면 409 `REQUEST_REUSED`이고 쓰기 0건이다.
- **RI-4**: 새 요청 id로 같은 파일을 확정하면 409 `IMPORT_DUPLICATE`이고 쓰기 0건이다.
- **RI-5**: 가명 코드가 기존 리드 코드와 겹치지 않는다. 시드로 충돌을 유도하면 다시 뽑는다. 어떤 칸 값도 코드와 같지 않다.
- **RI-6**: 개인정보 파일 확정은 400이고 리드 0, 감사 1(일반 감사, 건수만). 파일을 고친 뒤 같은 요청 id로 보내면 200이다(옛 400 재생 아님).
- **RI-7**: `expected.planSha256`이 다르면 409다.
- **RI-8**: 두 파일의 선언 기간이 겹치면 두 번째에서 `overlap`을 건너뛴다.
- **RI-9**: 서로 다른 요청 id로 같은 파일을 동시에 확정하면 200 하나와 409 하나다.
- **RI-10 붙이기**:
  - 제공처 보관 리드에 연락처를 붙이면 `present`가 되고, `referral`·`provided` 근거면 출처 고지 할 일이 생긴다.
  - 같은 연락처를 가진 다른 리드가 있으면 409와 그 코드가 오고 리드는 `external` 그대로다.
  - `firstContactAt`이 `receivedAt`보다 이르거나 미래면 400이다.
  - 찾기·내보내기에서 붙이기 전 리드의 연락처 칸이 빈다.
- **RI-11 작업 표**: `external` 리드에 4.3 표의 모든 작업을 보내 허용·409 `CONTACT_EXTERNAL`이 표와 같고, 500이 없다. `move_stage` `closed`는 200, `contacted`는 409다.
- **RI-12 귀속(Q-R5-2 권고안)**: 코드 없는 포털 가져오기 리드는 `codes`·`board` 보기에서 '제공처 파일 기준 · 창업 포털'로 따로 세어지고, 코드 있는 행은 코드 귀속이다. 박람회 가져오기의 `eventId`가 가져오기 기록에 남는다.
- **RI-13 보존 기한**: 접수 오늘−179일 행을 가져온 뒤 시계를 2일 넘기면 보기의 연락처 상태가 '보존 기한 지남'(`expired`)이다. 그 상태에서 `update_contact`는 먼저 파기 뒤 409 `CONTACT_GONE`이고 리드는 `purged`다. 대표가 보드를 열어도 같은 리드가 `purged`가 된다. 연락처를 붙인 리드의 기한은 붙인 시각 +180일이다.
- **RI-14**: `create_lead`에 `basis.type:'provided'`는 400이고, intake 보기의 수집 근거 선택지에 `provided`가 없다.
- **RI-15**: `provided` 리드에 연락처를 붙이면 보드 `source_notice` 할 일이 생기고 `record_source_notice`가 200이다.
- **RI-16**: 미리보기가 도는 동안(잠금 없음) 다른 직원의 `create_lead`가 409 없이 200이다.
- **RI-17**: 가져온 리드의 `lead` 보기 JSON에 `scanText`를 돌리면 0건이다(64자리 16진 없음).
- **RI-18**: 점주 추천 가져오기의 `sourceChannel`은 `referral`이고 근거는 `referral`이다.
- **RI-P1**: 직원의 파일 검사·미리보기·확정·`imports`는 403이다.
- **RI-P2**: 스위치 꺼짐이면 파일 검사·미리보기·확정 409다.
- **RI-P3**: 분기 B면 409다.

**R5c** 화면(수정 스위트 안):

- **UI-R2**: 귀속≠증분 문구가 모든 건수보다 앞선다.
- **UI-Q1**: `code_issue`·`spend_record`·`lead_import_confirm`은 5xx 뒤 같은 내용 재시도에 같은 요청 번호를 쓰고, 400 뒤에는 새 번호다. 다른 작업의 기존 규칙은 그대로다.
- **UI-E1**: 'EUC-KR로 읽기'가 보내는 요청에 `transcodedFrom:'euc-kr'`가 있고 `csvBase64`는 UTF-8 바이트다.
- **UI-F1**: 금지 대상·광고분담금 선택지가 없고, 점주 추천 채널은 금액 0 고정이다.

### 6.3 변이 대상

각 대상을 한 줄 바꿨을 때 위 검사 중 하나 이상이 실패해야 한다. R15a처럼 1차·수정 뒤 두 번 돌리고 잡힌 수를 PR에 적는다. 조각별로 그 조각의 대상만 돌린다.

1. 코드 정규식의 `^R`를 없앤다(C 코드 허용).
2. 코드 본문 길이 7을 8로 바꾼다(여권 패턴).
3. 충돌 조회에서 `tracking_code` id를 뺀다.
4. `validFrom <= kstDate`를 `<`로 바꾸거나 UTC 날짜를 쓴다.
5. 귀속에서 첫 토큰 대신 마지막 토큰을 고른다.
6. 충돌 토큰을 건너뛰고 다음 토큰에 귀속한다.
7. 충돌 판정을 없앤다.
8. 코드 없음 사유를 `unknown_code`로 바꾼다.
9. `amount < 0` 검사를 없앤다.
10. 정수 검사를 없앤다.
11. `ad_fund` 거부를 없앤다.
12. 증빙 문구 광고분담금 검사를 없애거나 문장부호 제거를 없앤다.
13. 미래 기간 검사를 없앤다.
14. 플랫폼 수치 null을 0으로 바꾼다.
15. 걸친 비용을 일할해 합계에 넣는다.
16. 머리글 값의 개인정보 검사를 없앤다.
17. 매핑하지 않은 열의 칸 검사를 없앤다.
18. 오류 문구에 칸 값을 넣는다.
19. 머리글이 걸렸을 때 이름을 쓴다.
20. 금지 대상 목록을 줄인다.
21. 민감 열 이름 검사를 매핑한 열에만 적용한다.
22. 박람회를 동의 증빙 필수 채널에서 뺀다.
23. 행 한도 200을 500으로 바꾼다.
24. 파일 해시를 해독한 글(BOM 제거 뒤)로 계산한다.
25. `expected` 비교를 없애거나 계획 해시에서 매핑을 뺀다.
26. 기간 커버리지를 최댓값 기준 시각으로 바꾼다.
27. `ADMIN_ACTIONS`에서 한 작업을 뺀다.
28. `OFF_EXEMPT`에 `code_issue`를 넣는다.
29. 코드 INSERT를 `recordStatement`로 바꾼다.
30. `spendRef` 브랜드 비교를 없앤다.
31. 가져오기 분기 검사를 없앤다.
32. 감사에 라벨을 넣는다.
33. 화면에서 귀속≠증분을 건수 뒤로 옮긴다.
34. `maxAgeDays`를 365로 바꾼다.
35. 가져온 리드의 `lastActivityAt`을 확정 시각으로 쓴다.
36. `retentionUntil`의 `external` 분기를 없앤다.
37. `allowedWhileExternal`에 `reveal_contact` 또는 증빙 작업을 넣는다.
38. `readBasis`가 `provided`를 받게 한다.
39. `TextDecoder`의 `fatal`을 끄거나 U+FFFD 검사를 없앤다.
40. 지역의 시·도 첫 토큰 규칙을 없앤다.
41. 파일 안 중복을 기본으로 건너뛴다.
42. `replay`의 `inputSha256` 비교를 없앤다.
43. 점주 추천 금액 검사를 없앤다.
44. 귀속에서 제외 기록을 무시한다.
45. `asOf` 뒤 토큰·코드·무효화를 센다.
46. 자료의 `reviewNeeded`·`current` 검사를 없앤다.
47. 비용 중복 409를 경고로 낮춘다.
48. 참조된 비용의 무효화를 허용한다.
49. `add_lead_codes`가 `task_updated`(활동) 이벤트를 쓴다.
50. `recordSourceNotice`가 `provided`를 거부한다.
51. 미리보기가 잠금을 잡는다.
52. 개인정보 거부 감사를 영수증으로 쓴다.
53. 가져오기 전용 탐지 하나(앞 0 빠진 휴대폰)를 없앤다.
54. 압축 사본에 카드 탐지를 쓴다(오탐 방지 사례가 실패해야 한다).
55. 가져오기가 `consent` 근거를 받는다.

### 6.4 real 확인과 not_run

| 확인 | 시점 | 근거 | 지금 상태 |
|---|---|---|---|
| 코드 1개 발급·사용 중지, 비용 1건 기록·무효화, 행사 비용 연결 | R5b-1이 실린 묶음 `published`·`runtime-verified` 뒤, 대표가 `r_franchise`를 켠 뒤 | real(소유자 세션, 운영 D1) | not_run: 미병합·미게시 |
| 직원 403 | 직원 계정 생성 뒤 | real | not_run: 운영 계정이 소유자 1개(계획 :484) |
| CSV 가져오기 실제 파일 | 7.1 답, LR-1 회신 뒤(계획 :32 "실제 리드를 원장에 넣는 일은 … LR-1 회신 뒤") | real | not_run: 대표 질문 대기, 결정 20 보류로 LR-1 `blocked` |
| 200행 확정의 D1 문장 한도 | 하지 않는다(기본값). 근거는 주문 가져오기가 한 batch에 최대 501문장을 쓰도록 만든 설계(`lib/store-operations-server.ts:192`)이고, 402문장은 그 안이다. 운영에서 501문장 batch가 실제로 돈 기록은 저장소에서 확인하지 못했다 | — | not_run: 합성 리드로 운영을 시험하지 않는다(계획 :732), 검증 없는 운영 DB 변경 금지(`AGENTS.md`). 확인이 꼭 필요해지면 대표 승인 안건으로 올린다(합성 브랜드 하나, 그 브랜드 행을 지우는 정리 스크립트와 실행 기록을 함께 제안, S7 운영 갱신의 대표 승인 선례). 그 전에는 한도를 올리지 않는다 |
| 실제 브라우저 화면(EUC-KR 변환 포함) | R5c 게시 뒤 | real | not_run: 가맹 E2E 없음 |

## 7. 대표 질문과 위험

### 7.1 대표 질문 (R5b-2만 막음)

**Q-R5-1. CSV로 들여온 문의를 원장에 어떻게 둘까?**

- 배경:
  - 계획 R5는 CSV에 연락처가 있으면 파일을 거부하고, 행마다 가명 코드를 새로 만들라고 한다(:740).
  - 결정 22(2026-09-25) 뒤 R4b는 문의 단계 진입에 이름과 연락처를 요구한다(:716 표, `CONTACT_REQUIRED`).
  - 그래서 계획 그대로면 원장에 "연락처 없는 리드"가 생긴다.
  - `docs/DATA-PROCESSING.ko.md:168`은 수집 경로를 "담당자가 직접 입력하는 것 하나"로 적고 있다.
  - 리드광고 단위 표는 "1단계는 양식 연락처를 COLLECTIVE로 옮기지 않는다"고 적는다(:545).

| 안 | 내용 | 좋은 점 | 대가 |
|---|---|---|---|
| **A (권고)** | 메타데이터만 들여와 '제공처 보관' 상태의 리드로 만든다. 담당자가 제공처 화면에서 연락한 뒤 그 리드에 연락처를 붙이면 결정 22의 보관 상태가 된다. 가져온 리드도 접수 +180일(H11)에 최소화된다 | 계획 R5 문장과 리드광고 단위 표를 그대로 지킨다. 연락처는 결정 22 경로(암호화·중복 키·열람 감사)로만 들어온다. R6가 가져온 리드도 한 원장에서 센다(채널 CPL은 Q-R5-2) | R4b 문의 단계 표에 '가져온 문의' 예외와 작업 표(4.3)가 생긴다. 담당자가 가져온 리드 대신 새 리드를 만들면 중복이 생긴다(화면 안내·연락처 중복 키·'중복' 종결로 줄인다). DATA-PROCESSING 3.5 문장이 바뀐다 |
| B | 이름·전화·이메일 열도 들여와 결정 22와 같게 암호화·중복 검사한다 | 담당자 입력이 줄고 중복 키로 겹침을 잡는다 | 계획 R5의 개인정보 거부 규칙, 리드광고 단위 표, DATA-PROCESSING 3.5와 정면으로 다르다. 제3자 제공 연락처 대량 수집이라 LR-2 검토 범위가 커진다 |
| C | 리드 행을 만들지 않고 코드·채널·날짜별 건수만 남긴다 | 개인정보 표면이 가장 작다. R4b 불변식이 그대로다 | 계획의 '행마다 가명 코드'와 다르다. R6의 적격 판정·speed-to-lead·리드별 여정에 가져온 문의가 빠진다 |

- 딸린 질문(A·B안일 때): 포털·박람회 파일의 수집 근거를 무엇으로 적을까? (가) 제3자 제공 수령(`provided`, 출처 고지 할 일), (나) 위탁 수집(본부 명의 문의 응대, `inquiry_response`). 권고는 열린 질문 14(:1127)와 LR-2 회신 전까지 관리자가 가져오기마다 둘 가운데 하나를 선언하고, 어느 쪽이든 제공자 측 동의 증빙 참조를 요구하는 것이다(2.7.1). 계획 :377은 포털을 위탁(제26조) 예시로 들고, R5 문장은 제17조·제19조(제공)를 적어 둘이 다르다.
- 기본값: 답이 오기 전에는 R5b-2를 착수하지 않는다. R5a의 가져오기 순수 모듈(해독·검사·정규화·기간·해시)은 A·B·C에 그대로 쓰인다. B를 고르면 연락처 대상을 더하는 확장 PR이 따로 필요하다.
- 실제 파일 가져오기는 어느 안이든 LR-1 회신 뒤에만 한다.

**Q-R5-2. 코드 없는 가져온 리드를 채널별로 셀까?**

- 배경: 포털·박람회 내보내기에는 보통 우리 `utm_content`·R 코드가 없다. 계획 A3대로 '유입 미확인'으로만 두면 R6의 채널 CPL(:748 '같은 채널 지출 ÷ 같은 채널 리드')에서 포털·박람회의 분모가 늘 0이다. 가져오기 채널은 제공처 파일이라는 증빙이 있는 값이라 `sourceChannel` 추정과 다르다.
- 권고: 코드 귀속을 먼저 쓰고, 코드가 없을 때만 '제공처 파일 기준' 귀속을 다른 열로 센다(2.7.3). 계획 A3 문장에 "가져온 리드는 제공처 파일 기준으로 따로 센다"를 더한다.
- 다른 답: '유입 미확인' 유지. 이때 7.3에 '포털·박람회 CPL 분모 없음'을 한계로 적고 R6는 이 채널의 CPL을 null로 둔다.
- 막는 것: R5b-2의 2.7.3과 RI-12만. Q-R5-1과 함께 답을 받는다.

### 7.2 막지 않는 기본값 (대표가 다르게 정하면 그 PR에서 바꾼다)

1. 광고분담금 400·점주 추천 금액 400(결정 27 권고 = 기본값). Q9·Q10 회신 뒤 완화는 코드 PR로 한다.
2. 모집 코드 R+7자 고정, validFrom −90~+180일, 발급 뒤 불변(사용 중지만), 분기 A에서만 발급.
3. 캠페인을 지워도 코드는 남고 채널 귀속을 계속한다. 점포 코드는 자동 귀속을 멈춘다. 모집 코드의 캠페인은 참조일 뿐이고, 모집 비용 분석은 채널 단위다.
4. 코드 없는 수기 리드의 모집 채널을 `sourceChannel`로 추정하지 않는다.
5. 가져오기 100,000바이트·200행·UTF-8만, 파일 검사·미리보기도 대표·관리자, 선언 기간 커버리지로 건너뛰기, 접수 시각 180일 이내, 파일 안 중복은 선택해야 건너뜀.
6. 정정 작업 네 가지 추가(계획 밖, 리뷰 포인트).
7. `lib/franchise-lead-import.ts`·`recruitment_import` 이름 변경.
8. 비용은 부가세 제외 소진액이 정본이고 중복·겹침은 확인해야 기록된다.

### 7.3 위험

| 위험 | 신호 | 대응 |
|---|---|---|
| 점포 관리자가 R로 시작하는 코드를 직접 만든다. 두 경로의 잠금이 달라 발급 때 못 막는다 | `codes` 보기 충돌 표시, 할 일 `code_conflict` | 귀속하지 않는다(보수). 점포 쪽 `codeTaken`에 `recruitment_code`를 더하는 일은 레인 A 파일이라, `docs/STATUS.md` **레인 R 칸**에 '제안(레인 A): `lib/store-operations-server.ts:99` `codeTaken`이 `recruitment_code`도 보게 하기(성장 계획 공유 파일 순서 `docs/GROWTH-PLAN.ko.md:233`이 허락할 때)'로 적는다. 다른 레인 칸에는 쓰지 않는다(`docs/LANES.ko.md:58-60`) |
| 가져온 리드와 담당자가 새로 만든 리드가 겹친다(A안) | 같은 지역·시각의 리드 두 건, 연락처를 붙일 때 409 | 등록 양식에 '가져온 문의에 연락처 붙이기' 안내. 중복 키 409가 기존 코드를 알려 준다. '중복' 종결. R6는 가져온 리드와 수동 리드를 나눠 보인다 |
| 겹치게 내려받은 파일이 CPL 분모를 부풀린다 | 같은 제공처 가져오기 기간 겹침 | 해시 409 + 선언 기간 커버리지 건너뛰기 + 제공처 키 정규화. 이미 가져온 기간 안에 늦게 나타난 행은 못 가져오고 건수가 보인다. 제공처 라벨을 완전히 다르게 적으면 막지 못한다(이전 제공처 선택지로 줄인다) |
| 값 패턴 검사는 최선 노력이다. 일반 머리글 아래 이름·자유 텍스트·생년월일, 새로운 번호 변형은 잡지 못한다 | 보관 후 발견, 정보주체 요청 | 모든 머리글 민감 열 이름 검사, 지역 시·도 규칙, 가져오기 전용 탐지, 브라우저 사전 검사로 줄인다. 받아들여진 파일은 매핑한 여섯 대상만 저장하고 나머지 칸은 저장하지 않는다(RI 스위트가 D1 0건 확인). 남은 위험을 DATA-PROCESSING 4.1에 적는다 |
| `scanText` 오탐으로 멀쩡한 파일이 거부된다(13자리 epoch 밀리초 `1727158200000`·14자리 압축 시각 `20260924143000` → 결제정보, 오타 코드 `R23456789` → 고유식별번호, 긴 제공처 id) | 거부 위치가 한 열에 몰린다 | 고정 문구가 날짜 형식 바꾸기와 코드 길이 확인을 안내하고, 그 열을 지우라고 한다. 열 단위 예외는 두지 않는다(fail closed). 압축 시각을 접수 시각 형식으로 받는 일은 파일 단위 검사 예외 결정이 필요해 하지 않는다 |
| 한국어 표 계산기 CSV가 CP949다 | `encoding_invalid` 거부가 잦다 | 고정 안내('CSV UTF-8'로 저장)와 화면의 EUC-KR 변환. 변환본 해시는 디스크 파일 해시와 다르다고 기록·화면에 적는다 |
| D1 문장 한도를 저장소에서 확인하지 못했다 | 200행 확정 실패(500) | 402문장은 주문 가져오기 설계 상한(501) 안이다. 운영 합성 시험은 하지 않는다(6.4). 한도를 올리지 않는다 |
| 요청 본문 200KB 상한 | 413 | 원본 100,000바이트 한도와 base64 전송(133,336자 고정 상한), 브라우저 사전 검사 |
| 플랫폼 보고 수치를 원장 리드처럼 읽는다 | 보고서·화면 문구 | 모든 행·응답·화면에 '플랫폼 보고, 원장 리드 아님'. CPL 분자·분모에 쓰지 않는다(R6) |
| 귀속을 인과로 읽는다 | 채널 비교 판단 | 모든 집계 위 귀속≠증분. 작은 표본 규칙은 R6(n<20 비율 숨김) |
| 귀속 조작·정정 불능(나중에 넣은 코드, 소급 등록 코드) | `late`·`retroactive` 배지 수 | 막지 않고 드러낸다. 사용 중지·리드 코드 제외로 고친다. R6는 두 표시를 따로 센다 |
| 제3자 제공 증빙은 참조일 뿐 적법성을 보증하지 않는다 | LR-1·LR-2 `blocked`(결정 20 보류) | 'COLLECTIVE 휴리스틱 · 법률 자문 아님'. 실제 가져오기는 LR-1 뒤. 열린 질문 14는 풀지 않고 관리자 선언으로 기록한다(시스템이 근거를 정하지 않는다) |
| 가져오기를 되돌릴 수 없다(엉뚱한 브랜드에 확정) | 대표 보고 | 계획 해시가 브랜드를 묶고, 확정 대화에 브랜드 이름과 건수를 크게 보인다. 되돌리기(아직 문의 단계이고 연락처가 없는 리드를 가져오기 단위로 종결)는 후속 제안이다 |
| 제공처 보관 리드의 메타데이터 | 오래된 가져온 문의 | 접수 +180일에 `purged`(최소화: 과업·단계만 남김, R4b와 같은 수준)가 된다. 보존 기한을 따로 둘지는 LR-2에 올린다 |
| 공유 파일 경합(`lib/record-kinds.ts`·`lib/nav-state.ts`, 레인 A PR) | rebase 충돌 | 착수 때 열린 PR 대조. 겹치면 그 PR 뒤로 미룬다. 강제 푸시 금지. 끝 고정 묶음 앞에 자기 항목만 붙인다 |
| 코드 행사 연결의 가명 코드 이름 혼동(R15a 참석자 가명 코드도 R로 시작할 수 있다) | 화면에서 혼동 | 참석자 가명 코드는 리드·모집 코드와 대조하지 않는다(R15a-2a). 화면 라벨을 '명찰 번호'와 '모집 코드'로 나눈다 |
| R6 내보내기의 수식 주입 | 라벨·증빙·제공처 문구가 `= + - @`로 시작 | R6 명세에 `csvFile`·`csvCell` 사용을 요구하고 RR-L2 사례를 기준으로 쓴다 |

## 8. R5a 위임 계약 초안 (`AGENTS.md` 위임 계약 7항목)

1. **목표와 수용 기준**:
   - 목표: `lib/franchise-recruitment.ts`와 `lib/franchise-lead-import.ts`를 2.1~2.6 계약대로 만든다(2.7은 만들지 않는다). 저장·API·화면·kind·스위치는 만들지 않는다. 어떤 앱 경로도 두 모듈을 import하지 않는다.
   - 성공과 거부: 6.2의 R5a 사례 전부(RC-·RA-(RA-9 제외)·RS-·RD-·LI-(LI-B 제외) 접두).
   - 권한 거부 사례: 판정 함수의 역할 단계(직원 403)를 사례로 둔다(RC-D3, RC-R, RS-13, RS-18, LI-A2).
   - 외부 호출·타임아웃: 순수 모듈이라 해당이 없다(fetch 0을 LI-S1·RC-S1과 모델 경계 테스트가 확인한다). 그 이유를 PR에 적는다.
2. **소유 파일**:
   - 새 파일: 위 두 모듈, `tests/recruitment-codes.test.mjs`, `tests/lead-import.test.mjs`, 테스트 고정 바이트 파일(가상 값만).
   - 고치는 파일: `tests/franchise-model-boundary.test.mjs`(FORBIDDEN 두 줄), 계획 문서(R5 절에 0.2 기록, 공유 파일 표 :1008 행, 줄 번호 표류), `docs/STATUS.md`의 레인 R 칸과 그 칸의 `갱신:` 시각(같은 PR).
   - 읽기만: 그 밖 전부. 특히 `lib/tracking-codes.ts`, `lib/order-import.ts`, `lib/pii-scan.ts`, `lib/store-*.ts`, `lib/record-kinds.ts`, `lib/franchise-server.ts`, STATUS의 다른 칸.
   - 위임자는 병합 전에 STATUS 레인 R 칸 내용을 확인한다.
3. **브랜치**: 최신 `origin/main`(이 명세 기준 `9a760e4`, 착수 때 다시 확인)에서 `feat/r5a-recruitment-pure`.
4. **시간 예산**: 0.25 에이전트-주(작업일 최대 1.5일). 넘으면 멈추고 보고한다. 재위임은 최대 1회, 그래도 안 되면 대표에게 올린다.
5. **허용 게이트**: `node scripts/test.mjs`, `tsc --noEmit`, `node scripts/lint-gate.mjs`, `node scripts/run-framework.mjs build`, CI verify. 새 게이트를 더하지 않는다(필요하면 제안만 한다).
6. **필수 테스트**:
   - `node --experimental-vm-modules tests/recruitment-codes.test.mjs`, `tests/lead-import.test.mjs`, `tests/franchise-model-boundary.test.mjs`: passed · mocked와 assertion 수.
   - 전체 스위트 수와 assertion 수, `tsc`, `lint-gate`(기준선 대비), `build`.
   - 변이 검사 1차·수정 뒤 잡힌 수(R5a 대상 1·2, 4~26, 34, 39~41, 43~48, 53·54. 나머지는 R5b·R5c PR이 돌린다).
   - 법률 적합성: not_run(LR-1 대상, 결정 20 보류).
7. **결과 반환**:
   - PR URL, 커밋 SHA, 기준 SHA, 변경 파일.
   - 위 명령과 출력 수치(real·mocked 구분).
   - 남은 위험(7.3 가운데 순수 모듈에 해당하는 것).
   - 게시 여부: 런타임 연결 없음, 다음 정기 묶음에 함께 실림.
   - 다음 작업: R5b-1(대표 질문 7.1과 무관).

## 9. 검토 반영

검토 1회(R5-01~22, 적대 검토 ADV-01~26)의 처리다. 모두 반영했고, 제안과 다르게 푼 것은 이유를 적었다.

| ID | 처리 |
|---|---|
| R5-01 | 반영. `maxAgeDays`=`UNCONVERTED_RETENTION_DAYS`(180, 날짜 단위, 2.6.1·2.6.4), 가져온 리드 `lastActivityAt=receivedAt`(2.7.2), `retentionUntil`이 `external`도 계산(4.2)해 기한이 지나면 `purgeInline`이 파기하고 붙이기는 기존 `CONTACT_GONE` 409(4.3 작업 표, RI-13). 새 409 키 대신 R4b 경로를 그대로 써서 '새 문의로 등록' 문구가 맞게 나온다. 0.2의 11, 7.3에 적음 |
| R5-02 | 반영. 4.3에 `external` 작업 표와 고치는 곳 8개(연락처 상태 검사, `updateContact` 붙이기 분기, `leadActions`·`allowedMoves`·`marketingOptions` 등)를 적고, `tests/franchise-pipeline.test.mjs`를 R5b-2 파일 목록에 넣음. `find_contact`는 중복 키가 없어 바꿀 것이 없다고 적음. 작업 목록 함수 이름은 `actionsFor`가 아니라 `leadActions`(`lib/franchise.ts:293`)다 |
| R5-03 | 반영. 운영 합성 200행 확인을 기본 확인에서 뺐다. 주문 가져오기 501문장 설계를 근거로 두고, 필요하면 대표 승인 안건(정리 스크립트 포함)으로만 올린다(6.4, 7.3) |
| R5-04 | 반영. `owner_referral` 금액 > 0은 400 `referral_reward_forbidden`, 영업대행·성과 수수료 문구는 경고 `agency_fee_wording`(2.5, 3.2, RS-6c, RR-S1, 변이 43, 0.2의 10) |
| R5-05 | 반영. 7.3 첫 행을 STATUS 레인 R 칸의 '제안(레인 A): …'로 바꿈 |
| R5-06 | 반영. 포털·박람회 근거를 고정하지 않고 `provided` 또는 `inquiry_response`를 관리자가 선언(동의 증빙은 둘 다 필수), Q-R5-1 딸린 질문으로 올림. 점주 추천은 `referral` 근거와 `sourceChannel` `referral`(2.7.1·2.7.2, LI-B3, RI-18). 7.3의 열린 질문 14 문장을 고침 |
| R5-07 | 반영(제안 가운데 '받지 않음'을 고름). 가져오기에 `consent`를 받지 않는다(2.7.1, LI-B2, 변이 55). `createdAt ≤ receivedAt` 비교로는 제3자 양식 문구를 확인할 수 없어서다 |
| R5-08 | 반영. `readBasis`가 `provided`를 400, 수기 등록 선택지는 `INTAKE_BASIS_LABELS`, `tests/franchise-lib.test.mjs:29` 고정 수정(4.2, 4.3 고치는 곳 5, RI-14, 변이 38) |
| R5-09 | 반영. 민감 열 이름 검사를 모든 머리글에 적용하고 400 `sensitive_column_in_file`(열 번호만), 목록 확장(2.6.1·2.6.3, LI-M3·M6, 변이 21). 새 사례 번호는 LI-M6과 LI-P8~P28이다 |
| R5-10 | 반영. Q-R5-2로 올리고 권고안 '제공처 파일 기준' 귀속(2.7.3, RI-12)과 답이 다를 때의 한계 문장(7.1)을 둠. 별도 `imports.channel` 차원 대신 귀속 결과의 `basis:'import'`로 R6가 같은 함수에서 읽게 했다 |
| R5-11 | 반영. 코드 추가를 `update_task`에서 떼어 `add_lead_codes`와 비활동 이벤트 `codes_added`로 둠(4.2·4.3, RR-A2, 변이 49) |
| R5-12 | 반영. 개인정보 거부 기록을 영수증이 아닌 일반 감사로 바꿔 재생되지 않게 하고, 확정에 입력 해시를 묶어 다른 파일은 `REQUEST_REUSED`(4.3, RI-3b·RI-6, 변이 42·52). `targetOf`를 파일 해시로 두는 안은 `targetOf`가 해독 전에 동기로 돌아 쓰지 않았다. 화면은 이미 응답을 받으면 새 번호를 쓴다(`app/franchise-common.tsx:144-150`) |
| R5-13 | 반영. 네 곳(`recordSourceNotice` :636, 보드 할 일 :1081, `sourceNoticePending` :202, `leadActions` :302)을 `needsSourceNotice`로 바꾸는 항목을 4.3에 적고 RI-15를 더함 |
| R5-14 | 반영. 0.2의 15에 적고 R6 규칙(2.7.4: '제공처 시각' 따로, 날짜만 값 제외) |
| R5-15 | 반영. 0.2를 18개로 늘림(분기 A 발급과 R15b QR 영향, 증빙·부가세 필수, 180일 창, 기간 커버리지, 파일 안 중복, 리드 코드 칸·코드 불변, 제공처 시각, 근거, 가져오기 귀속, `asOf`) |
| R5-16 | 반영. (a) `:738`, (b) '고정' 주장 삭제(4.2), (c) `lib/store-attribution.ts:138` 표류 항목 삭제, (d) port `insert`(4.1), (e) '법정 절차 판정' 앞에 끼워 넣기(1절 표), (f) STATUS 인용을 원문대로, (g) `tests/helpers/franchise-fixture.mjs`를 R5b-1 목록에, (h) 보관 위치 목록이 비면 400 `storage_labels_unset`로 명시(2.6.5, LI-V4) |
| R5-17 | 반영. DATA-PROCESSING 검토 레인을 레인 A로 적고, 계획 :1008 행과 DP-10 :229 표현을 고치는 PR을 정함(0.2 끝, 1절, 4.6) |
| R5-18 | 반영. 수집 근거·리드 모양·가져오기 귀속·가명 코드를 R5a에서 빼고 2.7(R5b-2)로 옮김. R5a는 계획 해시에 서버가 준 `bind`만 넣는다 |
| R5-19 | 반영. 8.1에 역할 403 사례를 적고, STATUS 레인 R 칸은 각 PR이 같은 PR에서 고친다고 1절·8.2에 한 번씩 적음 |
| R5-20 | 반영. UTF-8만, base64 원본 바이트 전송, `fatal` 해독과 U+FFFD·U+0000 거부, 파일 해시는 원본 바이트(2.6.2, LI-E) |
| R5-21 | 반영. 7.3 오탐 행에 14자리 압축 시각·오타 코드를 더하고 고정 문구에 날짜·코드 안내를 넣음. 압축 시각을 형식으로 받는 일은 하지 않는다고 적음 |
| R5-22 | 반영. 파일 안 중복은 기본으로 건너뛰지 않고 경고 건수, 선택 시에만 건너뜀(2.6.4, LI-K5, 변이 41) |
| ADV-01 | 반영(R5-20과 같이). 전송·해독·해시 규칙, 선택 'EUC-KR로 읽기'와 `transcodedFrom`, 기록의 `hadBom`·`encoding`, E1~E6 사례. 본문 상한 보장은 base64로 바꿔 0.2의 3을 고침 |
| ADV-02 | 반영. (a) 모든 머리글 검사(코드 이름은 `sensitive_column_in_file`), (b) 가져오기 전용 탐지를 새 모듈에 두고 `lib/pii-scan.ts`는 고치지 않음, (c) 숫자 정규화·퍼센트 해독·압축 사본, (d) 브라우저 사전 검사(2.6.3). 제시한 문자열마다 사례(LI-P8~P27), 인접 분리 칸(P28), 오탐 방지(P29). 압축 사본에는 카드 탐지를 쓰지 않는다(접수 시각 오탐). '홍길동'·'1990-01-01'은 값으로 못 잡아 머리글·지역 규칙이 맡는다고 적음 |
| ADV-03 | 반영(규칙은 바꿔서). 지역은 첫 토큰이 시·도(`SIDO_NAMES`)이고 나머지는 행정 접미사(2.6.4, LI-R7, 변이 40). 제안한 끝 글자 규칙만으로는 '홍길동'(동으로 끝남)이 통과해서 시·도 첫 토큰을 요구했다. 50% 이름 모양 파일 규칙은 이 규칙이 더 강해서 두지 않았다. 머리글 목록에 신청자·고객명·회원명·대표자·예비창업자·문의자·닉네임·아이디·ID·카카오·카톡·직업·소득·자산을 더함 |
| ADV-04 | 반영(R5-02와 같이). 작업 표와 고치는 곳 목록, RI-11 전수 사례. 증빙 작업은 `external`에서 409다(연락처 없는 리드를 계약 절차로 보내지 않는다) |
| ADV-05 | 반영(R5-10과 같이). `basis:'import'` 귀속, 행사 `eventId`(같은 브랜드·취소 아님, 박람회·설명회만), Q-R5-2, RA-9·RI-12 |
| R6-ADV-06 | 반영. `attributeLead`·`spendInWindow`·`alignedWindow`에 `asOf`, `tracking`을 `{value,createdAt}` 목록으로, `attributionInputs`·`inputs` 정렬 목록(2.4·2.5, RA-10, RS-14, 변이 45) |
| ADV-07 | 반영. 제공처 키 정규화(목록 고정 대신, 프로필 칸을 새로 두지 않으려고), 채널이 아니라 브랜드·제공처 키, 선언 기간 필수와 기간 커버리지 건너뛰기, 기간 밖 행은 행 오류(2.6.4·2.6.5, LI-K1~K4, 변이 26). 겹침 자체를 409로 막는 안은 겹치게 내려받기가 정상 작업이라 쓰지 않고, 건너뛴 건수를 미리보기에 보이고 계획 해시로 확정에 묶었다 |
| ADV-08 | 반영. 박람회·설명회는 날짜만 값을 받고 `receivedPrecision:'day'`(speed-to-lead 제외), 파일 안 중복은 선택해야 건너뜀(2.6.4, LI-R3·K5) |
| ADV-09 | 반영(R5-07과 같이 `consent`를 받지 않는 쪽으로). 안내문 시간 창 비교는 필요 없어졌다 |
| ADV-10 | 반영. `planSha256`(브랜드·채널·매핑·증빙·행사·선택·`bind`·`today`·판·파일 해시·정규화 행), 확정은 `expected.planSha256`(2.6.6, LI-H6, 변이 25) |
| ADV-11 | 반영. `inspectLeadFile`과 작업 `lead_import_inspect`(2.6.6·4.3·5절, LI-A1, RI-1b) |
| ADV-12 | 반영(R5-01과 같이). 181일 경계는 날짜 단위 −179/−180 사례(LI-R5)와 기한 지난 뒤 붙이기 사례(RI-13) |
| ADV-13 | 반영. (a) `code_retire`와 `after_retired`(과거로 소급하지 않음), (b) `strike_lead_code` 제외 기록, (c) `retroactive`·`late` 표시(2.3·2.4·4.3·4.5, RC-R, RA-11~13, RR-C6·A5). 사용 중지 날짜를 과거로 받지 않는 이유(과거 귀속 일괄 변경 방지)를 2.3에 적음 |
| ADV-14 | 반영. 자료 문맥 `{status, reviewNeeded, current}`, 409 세 코드(2.3·2.5, RC-D8b, RS-8b, 변이 46). `assetStatusAtReceipt` 노출은 R6 증빙 묶음 명세로 넘긴다(자료 판 이력은 R15a 기록에 있다) |
| ADV-15 | 반영. 날짜→기간 정규화, 중복·겹침 409와 `acknowledgeDuplicate`, `replacesSpendId`, 참조된 비용 무효화 409, 생성 세 작업의 5xx 재시도 같은 번호(2.5·4.3·5절, RS-15·16·13b, RR-S4·S5, UI-Q1) |
| R6-ADV-16 | 반영. 부가세 제외 소진액 정의, 필수 `vat`와 `amountExVat`, 외화 원금 정보, 부분 환불은 교체, 채널별 `{total,rowCount,straddlingCount}`로 모름과 0 구분, KST 날짜(2.5, RS-5b·10b) |
| R6-ADV-17 | 반영. 걸친 행이 있는 채널의 CPL은 null '비용 기간 불일치', 대안 `alignedWindow`(2.5, RS-17) |
| R6-ADV-18 | 반영. `receivedAtOf`, `external` 리드는 speed-to-lead·미응대 제외, 붙이기의 선택 `firstContactAt`, 날짜만 값 제외(2.4·2.7.4·4.3, RI-10) |
| ADV-19 | 반영. `INPUT_BOUND` 작업의 `inputSha256` 비교(4.3, RR-C2b, RI-3b) |
| ADV-20 | 반영. 검사·미리보기는 잠금 없이, 분당 한도는 유지(4.3, RI-16, 변이 51) |
| ADV-21 | 반영. 시각 문법 열거(오전/오후, 1~2자리, 점 구분, `T` 무시간대), 왕복 검증, +5분 허용, 날짜 단위 `too_old`, 사례마다 테스트(2.6.4, LI-R1~R5) |
| ADV-22 | 반영. 키 대소문자 무시, 모든 `utm_content`와 나머지 토큰의 위치 순 병합, 고정 문구의 코드 길이 안내(2.3·2.6.3, RC-T, LI-P30). 칸별 힌트는 탐지 종류를 드러내 두지 않았다 |
| ADV-23 | 반영. R5에는 CSV 내보내기가 없고, R6 이후 경로가 `csvFile`·`csvCell`을 쓰도록 요구와 기준 사례(RR-L2)를 둠(4.4, 7.3). 입력 단계 거부는 정상 라벨('-' 시작)을 막을 수 있어 하지 않았다 |
| ADV-24 | 반영. 문장부호·기호 제거, 용어 추가, 맨 '분담금' 제외, 출처 값이 실제 통제라고 명시, 양방향 사례(2.5, RS-6b) |
| ADV-25 | 반영. 열 번호·키 검증, `Object.hasOwn`, null 원형 객체(2.1·2.6.1, LI-M7) |
| ADV-26 | 반영. `lead.importId='ri-<uuid>'`, 파일 해시는 가져오기 기록·감사에만, 리드의 `provided` 근거에 동의 증빙 해시를 복사하지 않음(4.1·2.7.2, RI-17). R6 예외 문서화는 R6 명세로 넘긴다 |

## 10. 대표 결정 (2026-09-27, 레인 R 세션 질문 답)

- **Q-R5-1 = B안(연락처까지 들여온다).** 포털·박람회 CSV의 이름·전화·이메일 열을 매핑 대상으로 받아, 결정 22와 같은 경로로 저장한다(연락처 암호화, 중복 키, 열람 감사, H11 보존 기한). 설계 영향:
  - R5a의 해독·검사·정규화·기간·해시는 그대로 쓴다. B 확장은 R5b-2에서 한다: 매핑 대상에 `contactName`·`contactPhone`·`contactEmail`을 더하고, 개인정보 검사는 **매핑한 연락처 열에서만** 이름·전화·이메일을 허용한다. 그 밖의 열에서 걸리면 지금처럼 파일 전체를 거부한다. 고유식별번호·카드·계좌 같은 민감·고유식별 값은 어느 열에서도 거부한다.
  - 행마다 가명 코드를 새로 만드는 규칙은 유지한다(리드 시스템 코드). 연락처 중복 키가 기존 리드와 겹치면 새 리드를 만들지 않고 건수와 행 번호만 보인다(연락처 원문 없이).
  - 제공자·제공일·제공자 측 동의 증빙 참조는 필수로 둔다(제17조·제19조). 수집 근거는 가져오기마다 관리자가 선언한다(제3자 제공 수령 또는 위탁 수집, 열린 질문 14 미정). 제3자 제공 수령이면 출처 고지 할 일(제20조)을 만든다.
  - 계획 R5 문장('연락처가 있으면 파일 거부'), 리드광고 단위 표(:545 '1단계는 양식 연락처를 옮기지 않는다'), `docs/DATA-PROCESSING.ko.md` 3.5('수집 경로는 담당자 직접 입력 하나')가 바뀐다. R5b-2 PR에서 함께 고치고, DATA-PROCESSING은 소유 레인 검토를 받는다.
  - 실제 파일 가져오기는 LR-1(법률 검토) 회신 뒤에만 한다. LR-2 검토 범위에 '제3자 제공 연락처 대량 수령'을 더한다.
- **Q-R5-2 = 권고안(파일 출처로 따로 센다).** 코드 귀속을 먼저 쓰고, 코드가 없는 가져온 리드는 '제공처 파일 기준 · 채널' 열로 따로 센다(2.7.3). 계획 A3 문장에 "가져온 리드는 제공처 파일 기준으로 따로 센다"를 더한다.

### 10.1 main 기준 정렬 (2026-09-27, 결정 32 `7a55f09` #172)
- 정본은 계획 문서 결정 32다. 위 10절과 다른 점은 결정 32를 따른다.
- 중복 처리: 같은 사람이 두 제공처 파일에 있어도 **파일마다 한 건씩 센다**. 교차 파일 중복 병합 규칙은 R5b-2 PR에서 정하고 대표 확인을 받는다. 위 10절의 "연락처 중복 키가 기존 리드와 겹치면 새 리드를 만들지 않는다"는 이 확인 전까지 제안일 뿐이다.
- 매핑한 이름·전화·이메일 열은 결정 22의 R4b 원장과 같은 방식이다: 필드 암호화, 목록 가림, 열람 감사, 모델 전송 0건, 미전환 180일 파기. 매핑하지 않은 열에 전화·이메일이 있으면 파일 전체를 거부한다.
