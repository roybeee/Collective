# 성장2 확증 근거 → Meta 최초 1회 예산 변경

지원 범위는 기존 Collective 단일 캠페인·단일 광고세트·단일 광고, KRW/Asia-Seoul, daily_budget, 정상 감시 중인 ACTIVE 실행이다. 각 실행에 확대 개정은 한 번만 허용한다. lifetime_budget 전환·자동 반복 확대·기존 승인과 다른 랜딩/타깃/기간 변경은 포함하지 않는다.

## 승인 및 계보

성장 확대 `approve_reserve`의 선택 입력:

```json
{"metaBudgetApproval":{"executionId":"원본 실행 ID","executionVersion":12,"nextDailyBudgetKrw":1200,"confirmed":true}}
```

소유자만 총액 `input.nextBudget`과 위 일액을 별도로 승인한다. UI에서 총액 증분을 추가 예약하고 기존 손실 감시 한도에 같은 증분을 더한다는 내용을 확인한다. 일반 예약은 provider 쓰기를 승인하지 않는다.

- 미션 `channel=meta`, 원본 미션 총액 = Meta 실행 `maxSpend`, 같은 캠페인/브랜드/위임 계정/오퍼 랜딩.
- 확증 실험에 `manual` 참조 `meta_execution:<원본 실행 ID>` / 판 `1`을 사전등록한다. 판 1은 변경되지 않는 원본 실행 승인 참조다. 이는 소유자가 선언한 실험 개입 계보이며 개별 노출을 공급자 영수증으로 증명하는 기능은 아니다.
- 제안·조회·일반/Meta 예약·실제 POST 직전마다 최신 확증 결과의 등록 digest, 개입 refs, 현재 주문·환불·원가·관측으로 재계산한 inputDigest와 분석 회차를 대조한다. 새 분석 없이 원장이 바뀌면 확대를 막는다. 동일 오퍼/개입 판·공헌이익·공유 재고 및 위임 한도도 재확인한다.
- 원본 실제 예산, 실행 현재 판, 읽기/쓰기 계정, 통화 배율, 정상 감시, 기존 총액/일액/손실 한도 내 상태를 확인한다.
- 총액과 일액 증가율은 각각 20% 이내다. 총액을 Graph 일액으로 자동 환산하지 않는다.

## 영속화 및 worker

growth 증분 commitment + expansion 승인 + 요청 UUID + meta_budget_amendment 승인 + Meta 실행 pending pointer + 추가 Meta 예약액을 같은 DB batch에 저장한다. workspace 잠금과 이전 JSON 판을 검사하는 SQL로 다른 판의 변경 시 전체 batch를 실패시킨다. 원본 scope/digest와 Meta 계획은 바꾸지 않는다.

기존 `advanceMetaExecutionWork`가 비상 중단/unknown 작업을 우선하고, 정상 광고 감시를 성공한 뒤 연결된 승인 개정 한 건을 처리한다. 한 tick에 신규 예산 POST는 최대 한 번이다. 실행 중 증거·위임·연결·스위치·전역 중단·예약·기간을 다시 확인한다. 정상 실행은 age 순으로 순환하며, 전체 아카이브 수와 관계없이 처리 대상 1건만 읽는다.

`approved → submitting`을 먼저 저장한 뒤 Meta 광고세트의 `daily_budget`만 POST한다. 응답 성공만으로 완료하지 않고 전체 strict hierarchy를 다음 일액으로 읽어 다시 확인한다. 적용 확인과 effective 예산 갱신은 같은 transaction으로 저장한다. 원본 scope는 보존하고 감시는 applied 개정의 일액만 덮어씌운 effective scope를 검사한다.

## unknown / 중단 / 정산

응답 유실·시간초과·오류는 unknown이다. 신규 요청 ID나 다음 tick에서 예산 POST를 반복하지 않는다. 기존 Meta 안전 경로로 부모부터 중단한 뒤 GET으로 목표 구성·예산을 확인한다. 조회가 그대로 unknown이면 개정 이력을 늘리지 않는다. 원래 예산이 보이는 것만으로 미수락을 단정하지 않는다. 목표를 회수해도 중단한 광고를 자동 재활성화하지 않는다.

Meta Graph에 expected-budget CAS가 없으므로 외부 Ads Manager 동시 편집을 원자 차단한다고 주장하지 않는다. 승인한 전체 구성과 다르면 완료 처리를 보류한다. daily_budget과 집계 지연 때문에 로컬 총액/손실 감시는 실제 청구 상한이 아니다.

연결한 성장 예약의 수동 해제·별도 실비 정산은 차단한다. Meta 중단과 최종 청구 대조 시 실행·개정·연결 commitment를 함께 정산한다. 추가 funding 실비는 최종 청구가 원본 총액을 넘은 부분으로 기록하고, 비용 보고는 같은 소유자·캠페인의 정확한 Meta execution을 참조하는 funding alias를 중복 합산하지 않는다. 미확인 비용은 기존처럼 미확인 상태다.

## 검증과 한계

합성 SQLite + mocked Graph 검증이며 실제 Meta 요청/광고 집행은 0회다. 총액/일액 구별, 승인 전 POST 0회, 1회 변경, strict 감시 유지, 응답 유실 후 GET-only 복구, 수동 예약 해제 차단, 최종 정산과 비용 단일 계상, 아카이브 한도에서 중단 접근성을 검사한다.

공식 SDK의 AdSet 업데이트에는 daily_budget/lifetime_budget/end_time이 있으나 lifetime 전환 조건은 별도 검증이 필요하다. 첫 구현에서는 daily만 사용한다: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py
