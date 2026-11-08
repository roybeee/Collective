# 토스플레이스 POS 수집과 홀드아웃 증분 측정 (C7)

## 결론

토스플레이스 Open API에서 **읽기 전용**으로 주문·결제를 가져와 기존 지점 주문 장부(`store_order`, 출처 `pos`)에 넣고, 캠페인 기간의 매장 매출 증분을 **대조(홀드아웃) 매장과의 이중차분**으로 계산해 캠페인당 1행(`incrementality_result`)으로 저장한다. 모든 결과에는 `관찰 비교이며 인과 증명이 아닙니다` 라벨이 붙는다. 기능 스위치 `pos_tossplace`는 기본 꺼짐이며 소유자만 켠다.

## 비유

POS는 매장의 금전출납기다. 이 기능은 출납기 옆에 서서 영수증을 **읽어 적는 서기**이고, 출납기에 손을 대지는 않는다. 증분 측정은 같은 날 같은 비를 맞은 두 밭 가운데 비료를 준 밭(대상)이 안 준 밭(대조)보다 얼마나 더 자랐는지 보는 것이다. 비(계절·날씨·휴일)가 두 밭에 같이 내렸다고 **가정**할 뿐, 그 가정을 증명하지는 않는다.

## 소유자 설정 순서

1. **개발자센터 앱**: https://developers.tossplace.com 에 가입하고 Open API 앱을 만든다. API Access Key / Secret Key 쌍을 발급받는다. 주문 생성·결제 기록 같은 **쓰기 권한은 신청하지 않는다**(COLLECTIVE는 쓰지 않는다).
2. **매장 설치**: 앱을 수집할 매장에 설치하고 매장 ID(`merchantId`, 숫자)를 확인한다. POS 로그인용 매장고유번호(10자리)와 다른 값이다.
3. **웹훅(선택)**: 개발자센터 웹훅 메뉴에서 수신 주소 `https://<앱 주소>/api/pos/tossplace/webhook`, 이벤트(주문·결제), 서명 키(Secret Key)를 등록한다. 서명 키를 COLLECTIVE 연결에도 넣는다. 웹훅 없이 조회만으로도 동작한다.
4. **연결 등록**: `POST /api/pos/tossplace` `{action:'create', input:{storeId, merchantId, accessKey, secretKey, webhookSecret?, intervalMinutes(15~1440), since?(YYYY-MM-DD, 기본 30일 전)}}` — 소유자만. 키는 봉인(암호화)되어 저장되고 어떤 응답에도 평문으로 나오지 않는다. 연결은 꺼진 상태로 만들어진다.
5. **켜기**: `{action:'enable', id, expectedVersion}` 뒤 설정 → 기능 스위치에서 `pos_tossplace`를 켠다. 워커 tick이 `pos_pull` 큐에서 기한이 지난 연결을 tick마다 최대 3개, 1페이지(최대 100건)씩 읽는다. `{action:'pull_now', id}`로 소유자가 바로 한 페이지를 읽을 수 있다.
6. **확인**: `GET /api/pos/tossplace`에서 `cursor`, `lastResult`(fetched·skipped·created·updated·duplicates·older), `lastError`, `nextAttemptAt`를 본다. 설정 기능표의 'POS 자동 수집(토스플레이스)' 행이 스위치 상태를 보여 준다.

## 무엇을 읽고 무엇을 쓰지 않는가

| 읽는 것 | 쓰지 않는 것 |
|---|---|
| `GET /merchants/{merchantId}/order/orders?from&to&page&size=100&sortOrder=ASC` (주문 상태 기본값 COMPLETED·CANCELLED) | 주문 생성·수락·거절·취소, 결제 기록, 배달 등록 — 호출하지 않음 |
| `GET /merchants/{merchantId}/payment/payments/by-order-id` (대조용, 장부 반영에는 쓰지 않음) | 카탈로그·할인·매장 정보 변경 |
| 웹훅 `POST /api/pos/tossplace/webhook` 수신 | 토스플레이스로의 어떤 전송도 없음(`externalTransmissions: 0`) |

장부에 들어가는 값은 주문 ID·주문일(KST)·상태·결제액·누적 환불액·주문 방식 7개 필드뿐이다. 상품명·메모·결제수단·카드번호(마스킹)·현금영수증 식별번호·주문자 정보는 읽어도 저장하지 않는다.

## 정규화 규칙

- `orderState` COMPLETED → `paid`(결제 전액 취소면 `refunded`), CANCELLED → `cancelled`. REQUESTED·OPENED는 **건너뛴다**(미확정, 뒤에 변동 시각이 바뀌면 다시 읽힌다).
- 결제액 = APPROVED·CANCELLED 결제 금액 합, 누적 환불액 = CANCELLED 결제 금액 합. 결제 내역이 없는 완료 주문은 `chargePrice.totalAmount`. 취소 주문인데 승인 결제가 남아 있으면 결제 취소 이벤트까지 기다린다(`payments_open`).
- 주문일 = `createdAt`의 한국 날짜(처음 연결 뒤 바뀌지 않도록 완료 시각이 아니라 생성 시각을 쓴다).
- 주문 방식 = 첫 품목의 `diningOption`(HERE→홀, TOGO·PICKUP→포장, DELIVERY→배달).
- 개정 번호 = `updatedAt`의 2024-01-01 기준 0.1초 단위 정수. 같은 개정 번호·같은 내용은 중복(세지 않음), 같은 번호·다른 내용은 409로 그 페이지 전체를 거부한다.

## 커서와 멱등

- 커서 `{since, to, page}`: `since`~`to`(결제 내역 변동 시각) 범위를 ASC로 `page`씩 읽는다. 100건이 꽉 찬 페이지면 같은 범위의 다음 페이지, 짧은 페이지면 한 바퀴 종료 → `since` = 마지막 변동 시각 − 10분(겹침), `to` = 지금, `page` = 1.
- **커서는 주문 저장과 같은 D1 batch에서만 전진한다.** 시간 초과(`timeout`)·네트워크·401·429·형식 오류·큰 응답(1MB)·장부 충돌에서는 커서를 바꾸지 않고 `failures`를 올려 간격×2ⁿ(최대 24시간) 뒤에 재시도한다. 429는 `x-ratelimit-reset`까지 더 기다린다. GET만 하므로 '보낸 뒤 시간 초과'에도 외부에 기록되는 것은 없다.
- 멱등: 주문당 외부 몰 연결(`storefront_order_link`, 키 = 지점·`tossplace`·주문 ID 해시)과 개정 이력(`storefront_order_revision`)이 남는다. 다시 읽힌 주문은 `duplicates`/`older`로 세어지고 매출에 두 번 들어가지 않는다.
- 다중 페이지 바퀴 중에 어떤 주문이 다시 바뀌면 페이지가 한 칸 밀려 한 건을 놓칠 수 있다. 다음 바퀴의 10분 겹침과 웹훅 재촉이 대부분을 보정하고, 남는 차이는 기존 **주간 POS 합계 대조**(`pos_weekly_total`, 허용 오차 1%)가 드러낸다. 그때 `{action:'reset_cursor'}`로 `since`부터 다시 읽으면 중복 없이 보정된다.

## 웹훅

- 검증: `x-toss-timestamp`(epoch ms)가 현재와 ±300초 안이고, `x-toss-signature` = `v1=` + hex(HMAC-SHA256(서명 키, `${timestamp}.${원문 본문}`))이 맞아야 한다. 실패는 401, 본문 형식 오류는 400, 256KB 초과는 413.
- 멱등: `x-toss-webhook-id`가 연결별 `pos_webhook_event` 행 id가 된다. 같은 id 재전송은 `duplicate: true`로 응답하고 아무것도 쓰지 않는다.
- 처리: `order.order.created.v1`(주문 전체 포함)은 최종 상태면 바로 장부에 반영한다. `order.order.completed/cancelled.v1`, `payment.payment.approved/cancelled.v1`(식별자만)은 **외부 조회 없이** 다음 `pos_pull`을 즉시로 당긴다(`nextAttemptAt = 지금`). 웹훅 처리 중 토스플레이스를 호출하지 않는다.
- 매장 식별: 본문 `merchantId`로 연결을 찾는다. 같은 매장 ID 연결이 둘이면 401로 거부한다.

## 증분 측정 (홀드아웃)

- 계산: `POST /api/measurements` `{action:'incrementality', campaignId, treatedStoreIds?(기본 캠페인 지점), controlStoreIds, periodStart?, periodEnd?(기본 캠페인 기간, 종료일은 오늘까지, 182일 이내)}` — 대표·관리자. 결과 조회: `GET /api/measurements?campaignId=`. 캠페인 성과 탭의 '홀드아웃 매장 증분' 카드가 저장된 결과를 보여 준다.
- 방법: 캠페인 기간과 **같은 길이의 직전 기간**을 기준선으로, 장부 일별 순매출(결제−환불, `ledgerDays`)을 매장·하루 평균으로 만든 뒤 이중차분 `(대상 캠페인 − 대상 기준) − (대조 캠페인 − 대조 기준)`. 95% 신뢰구간은 날짜를 되뽑는 부트스트랩 400회(고정 seed, 같은 입력이면 같은 결과).
- 최소 자료: 기준 기간 ≥ 14일(=캠페인 기간 ≥ 14일), 대조 매장 ≥ 1, 대상·대조 겹침 없음, 기준 기간에 양쪽 장부가 있음. 하나라도 빠지면 `insufficient`(자료 부족)로 저장하고 수치는 null이다.
- 판정: 신뢰구간 하한 > 0 → `positive`(증가 관찰), 상한 < 0 → `negative`, 그 밖은 `inconclusive`. 어떤 판정이든 **인과 증명이 아니다** — 대조 매장이 계절·날씨·휴일·다른 판촉을 같은 정도로 겪었다는 가정 위의 관찰 비교다. 귀속(추적 코드)≠증분과 같은 취지다.

## 저장 구조

| kind | 범위 | 내용 |
|---|---|---|
| `channel_credential` (channel `pos_tossplace`) | 소유자 | 연결 설정·봉인 키·커서·실패 상태. `lib/channel-credentials.ts`는 커넥터 키(naver_ads·instagram)에 묶여 있어 그 모듈을 바꾸지 않고 외부 몰 조회 연결과 같은 방식으로 같은 kind에 저장했다. |
| `store_order` (source `pos`) · `storefront_order_link` · `storefront_order_revision` | 지점 | 기존 장부·연결·이력. 공급자 공통 반영은 `lib/order-ingest-server.ts`(외부 몰 반영과 같은 규칙, 출처만 매개변수). |
| `pos_webhook_event` | 지점 | 웹훅 멱등 기록(이벤트 종류·반영 요약). 본문 원문·고객 정보 없음. |
| `incrementality_result` | 캠페인 | 캠페인당 1행. 캠페인 삭제 시 함께 삭제. |

## 확인한 사실과 가정

2026-11-09에 공개 문서(https://docs.tossplace.com/reference/open-api/common.html, order/order-methods.html, order/order-model.html, payment.html, webhook.html)에서 확인한 것: 인증 헤더 `x-access-key`/`x-secret-key`, 응답 봉투 `resultType`/`success`, 페이지 `page`·`size`(1~500, 기본 100)·`sortOrder`, 주문 목록 정렬(결제 내역 변동 시각), 매장별 토큰 버킷(초당 10, 최대 100, 429와 `x-ratelimit-*`), 웹훅 서명 규칙과 `x-toss-webhook-id` 멱등 키, 웹훅 송신 IP(문서의 '웹훅 송신 IP' 절, 방화벽 허용 시 참고).

문서에 없어 **가정**으로 둔 것(실제 매장 연결 뒤 확인 필요):
1. 시간대 표기 없는 시각(`2025-09-01T00:00:00`)은 KST로 읽는다.
2. 웹훅 시각 허용 창은 ±300초(문서는 "너무 크게 차이나는 요청은 거부"만 적음).
3. 목록 응답의 `success`는 배열이다(객체 안 `content` 배열도 받는다).
4. `from`/`to`는 포함 범위이고 `orderStates` 기본값(COMPLETED·CANCELLED)이 적용된다.
5. 웹훅 서명 키는 앱 단위다. 매장(연결)마다 같은 키를 넣는다.

## 하지 않은 것

- 실제 토스플레이스 계정·매장으로의 연결 검증(`not_run`, mocked fetch만).
- 연결 설정 화면(UI). 소유자는 API로 등록한다. 성과 탭 카드는 저장된 증분 결과만 그린다.
- 상품별·결제수단별 집계, 데이터 내보내기 API, 결제 내역 대조 자동화(`listPayments`는 인터페이스만).
- `lib/connectors/**` 등록(다른 레인이 재구성 중, TODO).
