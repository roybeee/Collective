# 성장2 채널 공통 판매 실험

대상 카드: G2-08(탐색 기록 후 확증 사전등록)·G2-09(배정·노출 분모·주문 연결·충돌/A-A)·G2-10(증분 분석·성숙·유효성). Meta 전용 실험(`meta-experiment*`)의 통계 경계를 재사용하고 storefront·organic·meta·manual 판매 미션에 공통으로 쓴다.

## 흐름

1. **설계(초안)**: 탐색/확증, A/A 여부, 가설, 미션·오퍼 판, 채널(미션 채널과 같아야 함), 개입 설명과 고정 근거(`landing_revision`·`demand_step`·`publication_link`·`offer`·`manual`의 id·판), 배정 단위(가명 방문자·세션·지점-일), 처리군 확률(0.1~0.9), 주지표(구매 여부 0/1·단위당 순매출·단위당 공헌이익)와 단위 범위, MDE, 군별 최소 표본, 기간(최대 180일), 성숙 대기일(0~90), 중단 기준.
2. **사전등록**: 시작 시각 전에만 가능. 미션·오퍼·개입 근거의 현재 판을 확인하고 설계 digest를 고정한다. 이후 설계 수정은 409(새 실험으로 등록).
3. **배정**: 관측 기간 안에서 가명 단위 키(8~128자, 이메일·전화 거부)를 받아 실험별 비밀 seed의 SHA-256으로 군을 정한다. 같은 키는 항상 같은 군이며 원 키는 저장하지 않는다(해시만). 실험당 5,000단위.
4. **관측**: 단위별 노출·추적 완료·오염(두 군 노출)·연결 주문(현재 지점, 관측 기간 안, 다른 단위와 중복 불가, 미노출 단위는 주문 불가). 관측·성숙 기간 안에서만 기록한다.
5. **분석**: 종료 + 성숙 대기 뒤에만 저장한다. 비구매자는 0으로 포함한다. 주문 금액은 분석 시점의 장부(환불 반영)에서 다시 읽는다. 공헌이익이 미확인인 주문은 0으로 채우지 않고 제외·집계한다.
   - 무효: 배정 비율 불일치(SRM, χ² p<0.001), 오염 5% 초과, 추적 미완료 20% 초과, 금액 미확인 10% 초과.
   - 탐색: `exploratory`(인과 판정 없음). 확증: Hoeffding 합집합 경계와 분석 회차별 α 소진(0.05/(k(k+1)))으로 `supported/rejected/inconclusive/insufficient`. A/A는 `aa_passed/aa_failed`.
   - 결과는 추가 전용(회차·설계 digest·입력 digest·단위/주문 판 계보). 같은 입력의 재분석은 409, 최대 20회.
   - `causalScope`에 채널·배정 단위·기간을 남기며 다른 채널·기간으로 외삽하지 않는다. `mayExecute/mayScale:false`.

## 저장

`growth_experiment`(설계, seed 포함·화면 비노출)·`_history`(seed 제외)·`_unit`·`_result`·`_request`. 캠페인 삭제 시 보존.

## 검증 (2026-09-30, 이 브랜치)

- `tests/growth-experiment-route.test.mjs` 42 passed(real 메모리 SQLite, 인증 mocked, 외부 0): 인증·CSRF, 범위·PII·확률 검증, UUID 재생, 시작 후 등록 거부, 개입 근거·채널 불일치 거부, 등록 설계 동결, 시작 전 배정 거부, 이메일 단위 키 거부, 결정적 재배정·균형, seed/원 키 비노출, 기간 밖·미노출·중복 주문 거부, 관측 중 분석 거부, 비구매자 0 포함 supported·α 소진, 같은 입력 재분석 거부, 환불 반영 새 회차, 오염 무효, 탐색 무판정, 취소, SRM·A/A·추적 누락·미확인 공헌이익·성숙 대기 순수 검사, owner 격리.
- `e2e/growth-experiment.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1; 시간 경과는 저장된 시작/종료 시각 수정으로 모사, 등록 응답 유실 1회 mocked).

## 남은 것

- 판매처용 서명 수신 서버는 아래 계약으로 구현됐다. 판매처 페이지의 가명 UUID 유지·서버 프록시·실제 노출·추적 완료/철회 전송 설치, 실제 동의 고지와 운영 검증은 남았다. 광고 플랫폼 노출 수집은 이 판매처 endpoint의 지원 범위가 아니다. 실계정 실험 not_run.
- 결과를 확대 판단에 쓰는 경로는 [검증된 확대 게이트](GROWTH-2-EXPANSION.ko.md)에서 다룬다.


## 판매처 서버의 서명 사건 수신 (2026-10-04)

`POST /api/growth/experiments/events/{connectionId}`. 기존 활성 `storefront_webhook` 연결과 같은 암호화 secret을 **판매처 서버에서만** 사용한다. secret을 브라우저에 전달하지 않는다. 본문 16 KiB, 인증된 연결당 분당 120회, 캠페인당 일반 사건 10,000개, 실험당 5,000단위다. 일반 사건 한도가 차면 새 배정을 차단한다. 이미 배정된 단위의 최초 추적 마감·불완전에서 완전 추적으로 전환·동의 철회는 별도 안전 여유로 수신한다. 같은 상태의 반복 마감은 일반 한도를 적용하고, 이미 철회한 단위는 새로운 철회 사건을 추가할 수 없으므로 한도 우회 반복도 차단한다.

HMAC-SHA256 입력은 정확히 아래 UTF-8 문자열이다. `x-collective-timestamp`는 10자리 Unix 초, 허용 오차 300초이며 `x-collective-signature`는 `sha256=` + 소문자 hex다. 주문 웹훅의 `timestamp.raw` 서명과 서로 재생되지 않는다.

```text
collective.growth-experiment.events.v1\nPOST\n/api/growth/experiments/events/{connectionId}\n{timestamp}\n{raw JSON body}
```

본문 공통 필드:

- `eventId`: 무작위 UUID v4. 같은 사건 재전송은 같은 UUID/내용을 유지한다.
- `action`: `assign`, `exposure`, `tracking_close`, `withdraw`.
- `campaignId`, `designId`, `designVersion`, `registrationDigest`: 현재 등록된 storefront 실험의 정확한 판. 미션·오퍼·상품·개입 판, 연결 브랜드·지점도 재확인한다.
- `unitKey`: 측정 동의 아래 생성해 유지하는 무작위 UUID v4. 이메일·전화·순번·낮은 엔트로피 식별자는 받지 않는다. 원 키는 저장하지 않고 실험 seed로 계산한 해시만 보존한다. 쿠키 초기화·교차 기기 identity 결합은 이 endpoint가 자동 해결하지 않는다.
- `revision`: 최초 assign은 1, 이후 단위 사건은 바로 다음 정수. 역순은 409이며 이전 사건부터 재전송한다. 같은 단위 assign 재요청은 기존 서버 군·현재 판을 반환하고 새 표본을 만들지 않는다.
- `occurredAt`: UTC ISO 시각. 미래·역순 시각은 거부한다.
- `consent`: `{granted, noticeVersion, observedAt}`. assign/exposure/close는 granted=true, withdraw는 false. 철회 이후 같은 단위의 재노출·관측은 금지한다.

추가 `tracking_close` 필드: `trackingComplete`·`contaminated` boolean, `trackingThrough` UTC ISO, `orders:[{externalId,revision}]` 최대 20개. 완전 추적은 실험 종료 시각까지 확인한 뒤에만 선언한다. 주문 없는 완전 추적 단위도 0인 비구매자로 분모에 포함된다. 추적 마감은 종료+성숙 대기+하루 수신 유예 내에 받는다. 동의 철회에는 이 기한을 적용하지 않는다. 철회는 캠페인 보관·실험 취소·개입 상품/오퍼 판 변경 뒤에도 수신하며, 활성 credential·owner/브랜드/지점·기존 배정 단위·원 사전등록 digest·사건 순서·서명·재생 검증은 그대로 유지한다. 오염은 한 번 true가 되면 되돌리지 않으며 이미 연결된 구매를 빈 주문 배열로 지울 수 없다.

금액·배정 군·고객 연락처 필드는 거부한다. 서버가 군을 결정하고, 주문은 연결 sourceKey의 `storefront_order_link`와 현재 `store_order` 정확한 판에서만 가져온다. 이후 정규 주문/환불 동기화는 분석 때 다시 반영한다. 원본 링크와 다른 수동 변경·다른 지점/캠페인·연결되지 않은 주문은 정상 0으로 간주하지 않고 추적 미확인으로 제외한다.

`growth_experiment_ingest_event`는 사건 digest·군/단위 해시·revision·credential 판·멱등 응답을 추가 전용으로 저장하며 unit 갱신과 한 batch다. 원 가명키·secret·본문은 저장하지 않는다. 연결 회전 뒤 동일 사건을 현재 secret으로 재서명하면 중복 반영되지 않고, 해제한 credential은 재생도 거부한다. 수동 관측과 서명 수신은 source 계보로 구분하고 같은 단위의 수동 덮어쓰기를 차단한다. 전역 중단은 신규 배정·노출을 차단하며 이미 모은 추적 마감·철회는 수신한다.

검증: `tests/growth-experiment-events.test.mjs`는 실제 메모리 SQLite와 실제 HMAC/암호화를 사용하며 시간·인증 환경은 mocked, 외부 fetch는 금지한다. 실제 판매처 instrumentation 및 실계정 수신은 별도 runtime 검증이 필요하다.

복구 회귀: `tests/growth-experiment-event-recovery.test.mjs` 17 passed(real SQLite·HMAC, 시간 mocked). 10,000개 사건으로 한도를 채운 뒤 마감·완전 추적 전환·철회, 반복 우회 차단, 성숙 종료/오퍼 변경/캠페인 보관/실험 취소 뒤 철회, credential 해제 거부를 검증했다. 한도와 만료 때문에 각각 409가 발생하는 RED를 먼저 확인했다.
