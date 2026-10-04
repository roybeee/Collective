# 성장2 여러 상품 번들

대상 카드: G2-26(상품 MD·번들·승인 가격·단위경제).

- 구성 상품 2~10개(같은 상품 중복 금지, 수량으로 조정), 각 상품의 **정확한 판**을 저장한다. 저장 때 현재 판이 아니면 409.
- 번들 원가 = Σ 수량 × (단위원가 + 단위변동비). 한 가지 세금 기준에서만 계산하며, 원가·변동비 미확인이나 세금 기준 혼합·미확인이면 `null`(추정하지 않음). 공헌이익 = 번들 가격 − 원가, 정가 합 대비 할인도 보여준다.
- 재고 할당: 같은 공유 재고로 연결되는 SKU 별칭의 번들당 수량을 합산한 뒤, 공유 가용 재고 ÷ 합산 수량의 최솟값이 만들 수 있는 최대 번들 수다. 재고 보류·단위 불일치는 `held`로 최대 수를 계산하지 않는다. 계획 수량을 넘으면 준비도에 표시한다.
- 준비도 누락: 판 변경, 권리 미확인, 근거 만료, 배송·반품 조건, 가격 미입력·미승인, 음수 공헌이익, 재고 부족, 구매 링크·이유.
- `mayExecute:false`, `mayReserve:false`. 번들 판매의 재고 예약·실행은 기존 단일 SKU 실행 경로에 번들 할당을 연결하는 후속이다.

저장: `growth_bundle`·`_history`·`_request`(공통 [원장 도우미](../lib/growth-ledger-server.ts): 캠페인 판·기록 판 CAS, UUID 재생/충돌, 현재/이력/요청 원자 batch). 캠페인 삭제 시 보존.

검증(2026-09-30): `tests/growth-bundle-route.test.mjs` 23 passed(real 메모리 SQLite, 인증 mocked, 외부 0), `e2e/growth-bundle.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1, 응답 유실 1회 mocked).

검증 추가(2026-10-04): `tests/growth-bundle-reservation.test.mjs` 37 passed(real 메모리 SQLite, 인증 mocked, 외부 호출 금지): 전체 예약/해제, UUID 재생·충돌, 별칭 합산 부족·단위/브랜드 불일치, 상품/재고 판, 중단·해제, 동시 요청, batch 실패 전체 rollback. `tests/growth-bundle-route.test.mjs` 23 passed. 실계정 판매/출고 검증이 아니다.
