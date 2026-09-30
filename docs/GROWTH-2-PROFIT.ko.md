# 성장2 마케팅 후 손익·현금

대상 카드: G2-32(사업 대시보드: 매출/이익/현금·기여 증거). 기존 [사업목표·30일 리뷰](GROWTH-2-TARGETS.ko.md)와 캠페인 장부 요약(`growth-business`)이 `null`로 두던 마케팅 후 공헌이익과 현금을 채운다.

- **순매출·마케팅 전 공헌이익**: 기존 캠페인 주문 장부 집계(`growthBusiness`)를 그대로 쓴다. 원가 미확인이면 `null`.
- **마케팅 지출**(기간 안 발생 시각 기준):
  - 판매 예산 예약(`growth_commitment`, 확대 예약 포함): `reconciled` → 실제 누적 실비, `released` → 0, `reserved/unknown` → 미대사.
  - 크리에이터·파트너 협업: 정산 영수증의 지급액(미확인이면 미대사). 수수료가 있는데 게시만 되고 정산 전이면 미대사.
  - Meta 집행: `settled`의 정산 지출, 활성화 없이 철회된 경우 0, 그 밖은 미대사.
  - 미대사가 하나라도 있으면 마케팅 합계와 마케팅 후 공헌이익은 `null`(확인된 합계와 미대사 건수는 따로 표시). 0으로 채우지 않는다.
- **현금**: 운영자 정산 증빙(`growth_settlement`)의 입금 합계·정산 예정·미입금·수수료. 금액 미확인 증빙이 있으면 `null`. 원가 구매·재고 매입 현금이 연결되지 않아 **순현금은 계산하지 않는다**.
- 기간: 기본 최근 30일, 최대 1년. `causalStatus: not_measured`. 읽기 전용이며 권한은 기존 캠페인 조회와 같다.

검증(2026-09-30): `tests/growth-profit-route.test.mjs` 16 passed(real 메모리 SQLite, 인증 mocked), `e2e/growth-profit.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1, 주문은 실제 장부 API로 생성).
