# 성장2 검증된 확대 게이트

대상 카드: G2-12b(검증 결과 기반 확대)·G2-17b(검증 후 예산 확대)·G2-11(확대 결정). 기존 위임 평가(`evaluateAuthority`)의 `scale` 규칙(확정 예산·증분/수익/수용능력 근거·1회 20%·서명 한도 불확대)에 **서버가 확인한 근거**를 처음으로 연결한다.

## 흐름

1. **제안(관리자)**: 미션 id·판, 실험 id·분석 회차, 확대 후 예산, 추가 판매 수량, 이유. 서버가 다음을 모두 확인해야 저장된다.
   - 실험: 사전등록(`registered`)·확증(`confirm`)·A/A 아님, 실험 미션 = 확대 미션.
   - 결과: 해당 회차가 최신 분석이고 `supported`, 설계 digest = 등록 digest, 기록 후 90일 이내.
   - 유효범위: 실험 당시 개입 근거(`landing_revision`·`demand_step`·`publication_link`·`offer`)의 판이 그대로, 미션 채널·오퍼 = 실험 채널·오퍼, 오퍼 판 동일.
   - 이익: 오퍼 단위 공헌이익이 확인된 양수. 수용능력: 공유 재고 가용 수량 ≥ 추가 판매 수량(보류·미확인은 차단).
   - 예산: 기존 예산 > 0, 확대 후 예산은 기존 대비 1회 20% 이내.
2. **소유자 승인·예약**: 소유자만(관리자 403), 전역 중단 중 불가. 제안 당시 근거와 현재 근거가 같아야 한다. 활성 위임을 골라 증가분만 `growth_commitment` 원장에 `operation:'scale'`, `budget:'confirmed'`, 근거 id(`실험:회차`)로 예약한다. 서명된 총·일·주·손실 한도와 기존 원장 사용량은 그대로 적용된다.
   - 상시 위임에 `scale`을 넣는 것은 계속 금지다. 건별 소유자 승인만 확대 권한이며, 위임 기록 자체는 바뀌지 않는다.
3. **대사**: 예약한 확대는 실행 intent가 없으므로 기존 `reconcileCommitment` 규칙으로 이 화면에서 대사한다(부분/최종/무집행 해제, 누적값 하향 금지, 해제는 미집행 실패·실비 0·잔여 의무 없음 확인 필요). 보관 캠페인·전역 중단 중에도 대사는 가능하다.

실제 광고비 변경·집행은 하지 않는다(`mayExecute:false`, `autoScale:false`). 결과의 인과 범위는 등록한 채널·오퍼·기간이다.

## 저장

`growth_expansion`(현재)·`_history`·`_request`, 예약은 기존 `growth_commitment`(id=`미션:scale:제안ID`). 캠페인 삭제 시 보존.

## 검증 (2026-09-30, 이 브랜치)

- `tests/growth-expansion-route.test.mjs` 38 passed(real 메모리 SQLite, 인증 mocked, 외부 0): 인증·CSRF, 20% 초과·재고 부족·탐색/불확실/오래된 결과·A/A·탐색 실험·다른 채널·개입 판 변경·최신 아닌 회차 차단, 유효 제안, 전역 중단·관리자(최초 관리자=소유자 규칙 반영) 승인 차단, 위임 CAS, 제안 뒤 근거 변경 차단, confirmed scale 예약·근거 id, 위임 불확대, 이중 예약 금지, 서명 한도 초과 차단, 철회, 해제 조건·최종 대사·누적 하향 금지, owner 격리, 순수 판정(미확인/음수 공헌이익·기존 예산 0·보류 재고).
- 기존 `growth-authority*`·`growth-execution*`·`growth-reconciliation*`·`record-kinds` passed.
- `e2e/growth-expansion.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1; 실험·결과만 로컬 fixture).

## 남은 것

- 채널 공급자에 증액을 실제 반영하는 실행 경로와 실계정 증빙은 not_run이다(Meta 집행은 기존 M5 경로·별도 승인).
- 반복 자율 확대(G0-C/D)는 이 건별 승인 경로의 운영 표본이 쌓인 뒤 별도 판정한다.
