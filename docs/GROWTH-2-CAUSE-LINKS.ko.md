# 성장2 반품·환불 원인 → 개선 검토 연결

대상 카드: G2-30(반품 원인)·G2-29(구매 병목)·G2-31(운영 교훈). [다음 증분 권고 3](GROWTH-2-NEXT-GAPS.ko.md#3-저장된-반품-원인--기존-병목개선-검토-연결).

## 무엇을 하는가

- 이미 기록한 운영자 확인 원인([반품·환불 원인](GROWTH-2-RETURN-REASONS.ko.md))의 정확한 판을 같은 미션의 구매 병목(`growth_journey`)·일일 결정(`growth_decision`)·운영 교훈(`growth_lesson`) 판에 연결한다. 원인 입력 폼을 다시 만들지 않는다.
- 연결 조건: 원인 기록이 현재 원본(사건·품목·재고) 확인을 통과하고 요청한 판과 같을 것, 검토 기록이 현재 캠페인의 요청 판일 것, 사건 품목의 미션 = 검토 기록의 미션. 미션이 없는 품목은 연결하지 않는다.
- 원인 기록이 개정되거나(판·digest), 원본이 보류되거나, 검토 기록이 개정되면 연결은 `held`다.
- 원인 분포: 관측 기간(기본 최근 30일, 최대 1년)에 반품·환불 사건이 관측된 **품목 수**를 분모로 한다. 같은 품목의 반품·환불은 한 번만 센다. 원본 보류·원인 미기록·여러 원인·관측 시각 없음은 따로 센다. `unknown`은 미기록과 구분한다. 비율을 계산하지 않고 `rateStatus: not_a_defect_rate`, `causalStatus: not_measured`다.
- 자동 고객 응대·환불·재고 해제·가격 수정·학습 규칙 승격은 없다(`mayExecute:false`, `mayPromote:false`).

## 저장

`growth_cause_link`(현재, id=`사건__종류__검토ID`)·`_history`·`_request`. 캠페인 삭제 시 보존. CAS·UUID·원자 batch. 보관 캠페인에는 새 연결 불가.

## 검증 (2026-09-30, 이 브랜치)

- `tests/growth-cause-links-route.test.mjs` 33 passed(real 메모리 SQLite, 인증 mocked, 외부 0): 인증·CSRF, 원인/검토 CAS, 다른 미션·원인 미기록·미션 없는 품목 거부, 원자 rollback, UUID, 병목·결정·교훈 연결, 품목 기준 분모·반품+환불 중복 방지·unknown/미기록 구분, 원문 증빙 비노출, 원인 개정·검토 개정·품목 변경 보류, 기간 필터·날짜 검증·1년 상한, 해제 이력, 보관, owner 격리.
- `e2e/growth-cause-links.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1, 응답 유실 1회만 mocked).

## 남은 것

- CS 티켓·고객 문의 원문·약속 기한(G2-30 CS)과 원인별 개선 효과 측정.
- 연결된 원인을 교훈 채택(`reusable`) 근거로 요구하는 규칙은 교훈 쪽 후속 결정이다.
