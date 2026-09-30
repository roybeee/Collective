# 성장2 일일 운영 루프

대상 카드: G2-00(전체 운영 게이트)·G2-28(판매 총괄의 일·상태 변경 주기, 담당·기한). [원안 7절](GROWTH-2-PLAN.ko.md#7-일정과-제품-운영-주기)의 “시장/고객 일·주”, “판매 총괄 일”, “대표 보고 일” 주기 중 **제안 부분**을 실제로 돌린다.

- **실행**: 기존 조사 작업자 tick(`lib/research-worker.ts`)에 `growth_daily` 큐를 추가했다. 기능 스위치 `growth_daily_loop`(기본 꺼짐)가 켜져 있을 때만 KST 하루 1회 실행하고, 꺼져 있으면 스위치 1행만 읽는다. 대표·관리자는 스위치와 무관하게 “오늘 안건 지금 만들기”로 수동 실행할 수 있다(같은 KST 날 두 번째 실행은 거부).
- **범위**: 보관하지 않고 지점이 연결된 캠페인, 최대 20개·30초 예산. 넘치면 `skipped`로 남기고 다음 날 처리한다. 캠페인별 오류는 그 캠페인만 `error`로 남기고 실행은 `partial`. 전체 실패는 `failed`와 1시간 뒤 `retryAt`.
- **캠페인별 작업**: [자사 장부 감지](GROWTH-2-DETECTION.ko.md)(`detectedBy:'daily_loop'`) 후 안건 7종 — 약속 기한 초과 문의, 새 감지 신호, 기한 지난 신호 검토, 확인일 지난 교훈 적용, 성숙 대기가 끝난 미분석 판매 실험, 7일 넘게 대사되지 않은 예산 예약, 기한 지난 미종료 미션.
- **하지 않는 것**: 게시·지출·발주·고객 발송·프롬프트 승격·재고/예산 변경. 전역 중단 중에도 감지·안건은 만들고 중단 상태를 기록한다.
- 기록: `growth_daily_run`(owner 범위, id=KST 날짜). 설정의 기능 표에 `growth-daily` 행을 추가했다.

검증(2026-09-30): `tests/growth-daily.test.mjs` 15 passed(real 메모리 SQLite, 외부 0: 스위치 꺼짐 무쓰기, 보관·지점 없는 캠페인 제외, 하루 1회, 실행 레코드 쓰기 0, 캠페인 실패 partial·중단 상태, 조회·owner 격리, 워커 큐 연결), 기존 `feature-flags`·`feature-status`·`research-worker-rotation`·`meta-worker`·`quality-digest-queue` passed, `e2e/growth-daily.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1).

## 남은 것

- 운영 스위치를 켜고 실제 작업자 tick으로 도는지 확인하는 것은 게시 뒤 운영 확인(not_run).
- 안건에서 실행으로 넘어가는 자율 T2/T3 반복(G0-C)은 위임·품질 근거가 쌓인 뒤 별도 판정이다.
