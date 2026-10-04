# 성장2 잔여 개발 마감 기록

기준: `/Users/roybee/Collective-md-round3`, 착수 기준 main `a790f2b`. 아래 33카드표와 실행 순서는 착수 당시 조사 이력이다. 현재 구현 상태는 하단 실행 기록을 따른다. 통합 #337과 삭제·보관 회귀 수정 #339가 merged됐고 제품 `59710e6`은 Sites102 published/runtime-verified다. 로컬 전체349/349 suites·19,359 assertions와 필수 CI verify passed. Q 원화 지출 제한 계약과 운영·사업 실증 조건은 아래처럼 별도 남는다.

## 착수 시점 판단 (이력)

PR285의 15증분과 MD #329~335에서 수요 단계-발행 근거, 수동 상세페이지 수정안/영수증, 반품 원인-병목/교훈 연결은 이미 구현되어 있었다. 이 조사에서는 판매처/소비자 실행 어댑터, 일반 실험 수집, 번들 실제 예약, 현금 지출, 학습 맥락/결과 연결, 일일 운영 복구를 추가 개발 대상으로 정했다. 특히 일일 운영의 첫 20개 고정 선택과 partial 재시도 차단을 수정 대상으로 확인했다. 아래 표의 공백은 당시 상태이며 현재 미구현 목록이 아니다.

## 착수 시점 33카드 대조 (진행 상태는 아래 실행 기록 참조)

| 카드 | 현재 소스 근거 | 아직 코드로 닫아야 할 필수 연결 | 실제 계정/외부 조건 |
|---|---|---|---|
|00|growth-stop, growth-daily-server, feature-flags|daily partial 재시도·이어하기·캠페인 공정성; 게이트별 준비도/차단 원인을 현재 원장으로 종합|G0-B/C/D 운영 실증, 실제 위임·예산|
|01|record-kinds, growth-ledger-server, deletion-summary|새 adapter/이벤트의 동일 ACL·origin·보존 적용 및 종합 회귀; 새 기반 저장소 불필요|실데이터 삭제/격리 인수|
|02|storefront-orders, growth-order-bridge, reconciliation|판매처 이벤트 연결과 주문·환불·정산 지연/재시작 통합 회귀; 기존 원장 재사용|실몰 지속수집·정산 대사|
|03|growth-catalog, stock-readiness, inventory|provider 상품/재고의 판·시각·unknown 동기화 및 다SKU 실행 연결|실재고·상품권리·승인가격|
|04|storefront-pull-server, scripts/mapdal/adapter.py|실판매처 pull endpoint 구현/정합성 계약(현재 공통 client만으로 종료 불가); 기존 서명웹훅 재사용|mapdal 서버 접속·조회권한·실계정 대사|
|05|growth-authority, execution/publication|새 landing/CRM/CS/scale adapter 직전 위임판·만료·owner-stop 재검사|업무범위·계정·손실한도 승인|
|06|growth-detection, signal-source, product-research collectors|MD 공식 API 수집과 신선도/실패 상태는 이미 있음. source별 누락을 0으로 바꾸지 않는 운영 연결 점검; 임의 새 크롤러 불필요|API4종, 허용 출처·법무·실수집|
|07|opportunity-board, detection, product-research/server handoff|MD 승인 신호→need 초안 이미 구현. 자동 감지→검토 가능한 opportunity 초안/담당·기한 연결 자동화 가능|외부 시즌자료·판매반응|
|08|growth-experiment/server|일반 실험 등록·동결 재개발 금지. ingestion의 정확한 개입판 검증 연결|실험 대상·기간·실행권한|
|09|growth-experiment assign_units/record_observation|판매처 실제 방문 배정·노출·비구매분모 서명 ingestion, 동의·중복·오염/추적실패 연결|실페이지 instrumentation, 실제 비구매 트래픽|
|10|growth-experiment analyse, meta-experiment 통계 재사용|자동 ingestion→성숙 주문/환불/비용 관측 갱신 및 재현 digest 연결|충분한 표본·성숙기간·비용|
|11|growth-decisions, growth-expansion|검증 결과→다음 집행/A8 계획 연결, 관측 권고와 인과확대 분리|실측 확대 근거|
|12|growth-execution/publication, expansion|12a landing/CRM/CS 실행·영수증·재조회; 12b 검증된 확대 실제 adapter와 제한 반복 worker. 현재 expansion mayExecute=false|G0-B/C/D, 실제 계정·승인된 지출|
|13|growth-lesson-applications, learning|현재 apply는 정확판에 적용했다고 기록할 뿐 생성/수정 엔진이 소비하지 않음. 승인된 reusable 방법을 다음 초안 맥락에 실제 주입하고 결과 회수|실제 효과는 실험 근거 필요|
|14|growth-consumer/server|서명된 동의 수집/철회; 목적별 메시지 outbox·provider receipt/재조회·철회 직전 검사, 적격 이탈 이벤트|실연락처는 provider에서 관리 권장; 발송계정·고지·동의·거부경로|
|15|growth-optimization/server|실패 후보·동결·예산 모델 이미 있음. 실제 평가 job 연결은 Q 소유와 통합해야 함|평가 공급자/비용 및 Q 소유 조율|
|16|optimization record_offline/link_sales/adopt/rollback|평가 결과 검증-제한실험의 정확판 연결 검사, 실제 runner 통합; 자동승격 금지 유지|제한 캠페인 판매 효과|
|17|authority, reconciliation, expansion|신규 다SKU/scale/provider 예약 원장 통합, timeout unknown 유지, 공급자 비용 재조회 대사|실비·손실·공급자 영수증|
|18|storefront-pull 공통계약|추가 채널 구현 자체는 조건부. 첫 mapdal adapter 완료가 우선|추가채널 매출 이유·계정·운영능력|
|19|growth-demand/evidence, collaboration|이미 정확 단계↔발행/측정 연결. 반응/실험 결과→오퍼 새 판 검토 초안 자동 회수; 자동 가격승인은 금지|실채널 반응·권리|
|20|growth-conditional JSON-LD/GEO|준비도 구현됨. UCP는 특정 사용처 정해진 후 상호운용 adapter; 본선 필수 선행 아님|사용 플랫폼/노출 관측|
|21|conditional overseas pilot|국가7점검·환율/반품 단위경제 구현됨. 대상국 결정 전 실제 출시코드 임의 개발 금지|국가·자격·물류·법무·정산|
|22|conditional MMM readiness|52주·변동채널 등 타당성 검사 구현됨. 데이터 없는 모델/자동배분 추가 불필요|장기 시계열·보정실험|
|23|decisionRequired만 존재|후속 J로 본선 종료조건 제외. 사업 결정 없으면 구현 안 함|외부고객 사업 결정·격리 요구 확정|
|24|decisionRequired만 존재|후속 J로 본선 종료조건 제외. 계약/성과료 서비스 임의 구현 안 함|사업 모델·계약 결정|
|25|growth-market, opportunity-board, MD handoff|구매상황/대안/장벽 need 초안 있음. 감지신호→가설 초안 자동화 및 반증/성과 회수 연결|실제 고객 니즈 검증|
|26|catalog/offer, sourcing, bundle, landing|다SKU bundle 현재 계산·저장뿐(재고예약 없음). bundle→offer/mission→모든 구성재고 원자예약/해제. landing provider 적용/조회/rollback|실견적·권리·발주·판매처 계정|
|27|demand, collaboration/server|계약/전달/승인/발행/정산 기록은 이미 있음. 허용 provider adapter와 메시지/증빙 가져오기 연결만 추가|실제 연락/계약/지급은 별도 외부 행위|
|28|execution/publication, daily, research-worker|daily 안건→저위험 초안 자동 생성·담당/기한, 준비된 T2/T3 큐 실행/재조회/복구. 우선 scheduler 누락 수정|실실행 SLA·계정·범위위임|
|29|journey, landing, cs, cause-links|문의/옵션추천 맥락·상세페이지 실제 수정, 실제 여정 집계 ingestion. 수동 전후 평가 UI 재개발 금지|트래픽·실전환·환불 성숙|
|30|inventory, settlement, reorder, cs|공식 CS 수신/답변 receipt, 재고/배송/정산 동기화. 발주 제안은 이미 있음; 구매지출 증빙으로 현금 연결|실발주/배송/반품 공급자, 약정기한|
|31|decisions lesson, cause-links, applications|허용 신호·실패→방법 후보 자동 초안, 승인 가능한 교훈의 실제 생성맥락 적용·성공/실패/무효 자동 회수|판매 효과 라벨은 확증실험만|
|32|business, targets, profit|profit.netCashFlow 항상 null. 원가/재고 구매현금 지출·환불/수수료 중복제외·기간원장, 성숙 효과종합; 기존 대시보드 재개발 불필요|은행/정산 증빙·실매출 성숙|

## 착수 시점 실행 순서 (이력)

### 1. 지속 운영과 수집 설정 완결

소유 파일: `lib/growth-daily-server.ts`, daily UI/tests, product-research 설정 UI/API(독립 소유자). partial 재시도·20개 초과 이어하기·owner별 단일 lease·중단/재개 상태를 기존 worker rotation에 연결. 수집 스위치는 현재 서버 상태를 표시하고 변경 실패를 성공으로 보이지 않게 한다.

수용: 21개 이상 캠페인이 영구 누락되지 않으며 partial만 재처리되고 완료한 캠페인은 중복 탐지하지 않는다. 동시 tick 두 개는 한 lease만 진행. 중단 시 외부 실행 없음. 스위치 재조회·권한403·서버409에서 입력/실제상태 유지.

### 2. 판매처 실행과 고객 접점 연결

소유: 신규 `growth-provider-*` 공통 계약/credential 및 landing·consumer·cs adapter 파일, storefront-side endpoint 별도 경계. 기존 authority/CAS/idempotency/원장 재사용. landing revision read/apply/readback/rollback, CRM consent/pseudonymous-recipient/send/reconcile, CS event ingestion/reply receipt를 작은 독립 adapter로 구현. raw 고객 연락처를 모델/가맹레코드로 복사하지 않는다.

수용: 승인판 일치 요청만 외부 adapter 호출. timeout은 unknown이며 재전송 없이 idempotency키로 조회. 구판·타owner·철회·만료·중단·과금한도는 호출0. apply accepted는 readback과 내용digest 일치 전 applied 아님. rollback은 정확한 이전판으로만 수행. 외부계정 없는 테스트는 mocked로 명시하며 실계정 완료로 보고하지 않는다.

### 3. 일반 실험과 다SKU 실판매 원장 연결

소유: `growth-experiment-*` signed ingestion/API, `growth-bundle-*`, execution/inventory 확장. 기존 assign/observation/statistics를 복제하지 않는다.

수용: 방문객 한 명은 재시도에도 같은 팔; 비구매자도 분모 포함; 이벤트 재전송·역순·중복주문은 집계 중복0. tracking unknown은 0원 정상으로 바뀌지 않음. bundle 구성 한 품목 부족/구판이면 모든 예약0; 성공 시 전체 SKU와 예산 원자예약; 취소/환불/부분반품의 SKU별 원장 보존.

### 4. 학습·검증 확대·순현금 완결

소유: lesson context 공급 신규 모듈 + 기존 generation 접점, daily low-risk draft handler, expansion provider 연결, profit cash ledger. Q eval/prompt-registry는 현재 소유권 확인 후 단일 소유자로 통합.

수용: reusable/미만료/동일scope 교훈만 정확판 맥락에 포함되고 이후 artifact에 lesson digest가 남음. 구판/철회 전파, 새 대표라벨 없이 내부 후보 생성 가능하지만 자동 활성화 없음. 확대는 최신 확증/이익/재고/위임/누적캡 모두 통과해야 adapter 호출; 20%만 보아 총한도 우회 불가. 현금은 실제 입금-실지급이며 예상원가·미지급을 실제 현금으로 계산하지 않고 동일 비용 이중차감0.

### 5. 통합 증거와 종료 판정

33카드의 코드 완료/merged/published/runtime-verified/실계정검증/사업성과를 별도 칸으로 갱신. 전체 테스트·타입·빌드·기준선 lint, 핵심 E2E, code/security review, PR CI, Sites 공개 tree 검증을 통과한 코드만 완료 처리한다. 본선 개발잔여0이 되어도 G0 운영/인과 성과 완료라고 쓰지 않는다. 조건부20~24는 조건·담당·재개시점을 명시한다.

## 현재 실행 기록 — #337 merged, Sites101 runtime-verified

| 증분 | 현재 구현 범위 | 운영·평가 경계 |
|---|---|---|
| 수집 제어 | 실제 서버 스위치 표시, 권한/실패/응답 유실 후 재조회 | 이전 운영 스위치 켜짐 확인과 이번 UI 게시는 별개; 실제 키 4종 필요 |
| 일일 운영 | partial 복구·커서·공정성·lease, 제한된 회수 작업자와 기회/실패/오퍼 검토 초안 | 자동 가격 승인·레지스트리 활성화 없음 |
| 현금 | 실제 현금 지출·정정·무효 원장, 이익/현금 비용 중복 제외 | 실제 은행·정산 증빙 대사 필요 |
| 번들 | 모든 SKU와 예산 원자 준비, 실주문 품목 배분·배송·부분반품·안전한 해제 | 실제 주문/물류 검증 별도 |
| 랜딩 | 승인된 정확 문구와 상품판 CAS, intent 선저장, readback, unknown 조회, 복원 재승인·이력 한도 복구 | 실제 products.descr 어댑터 설치 not_run; 공급자 외부 동시편집 CAS 보장은 별도 |
| 주문·CS | 실제 스키마용 주문 outbox/pull, 현재 본인 문의/주문 확인과 답변 영수증 | 운영 설치·실제 고객 답변 not_run |
| 상품·재고 | 서명된 상품 조회·명시 검토, 정확 SKU/상품판, 15분 TTL, 주기 작업자·실패 backoff | 한 tick 한 연결·최소 5분; 물리 재고/예약 보존, 운영 설치 not_run |
| 소비자 | 목적별 동의·철회 callback, 가명 outbox, 영수증/조회, 호출 직전 로컬 동의 재검사 | 실제 발송 계정·적법한 동의·발송 검증 필요 |
| 일반 실험 | 서명 배정·실제 노출·비구매 추적 종료·철회 SDK/ASGI, 중복·오염·unknown 처리 | 실페이지 설치·실제 트래픽 not_run |
| 교훈 | 승인된 정확판 생성 맥락 주입, artifact digest, 최신 canonical 분석의 별도 자동 outcome | 수동 outcome 불변; 관측을 인과 효과로 승격하지 않음 |
| Meta 확대 | 최초 1회 총액/일액 별도 승인, 증분 원자 예약, 최신 주문/환불/비용/관측 재검사, unknown 중단·GET 회수 | lifetime 전환 제외; 외부 동시편집 원자 차단/청구 hard cap 보장 아님; 실제 광고 지출 not_run |
| 프롬프트 최적화 | 동결 후보·등록판·케이스·예산·기존 Q 실행/서버 판정·실판매 artifact 계보 검사 | 신규 유료 실행은 원화 지출 제한 계약 부재로 409 |
| 랜딩·오퍼 최적화 | 정확 원문·판·근거의 무료 결정론적 검사, 현재 준비도와 판매 개입 재검사 | AI 품질 평가가 아님; 적용 등 대상 판 변경 시 새 후보 필요 |
| 운영규칙 최적화 | 규칙 전체/해시/scope/케이스 동결, 무료 검증, 공개 Q preference pair 회수와 실제 주입 snapshot 계보 | 무료 검증은 Q 평가 통과가 아님; 신규 유료 실행 차단 |

상품 재고 상한은 `max(0, min(local.available, provider.sellable - local.reserved))`이다. 새 예약이 즉시 상한을 소비한다. 공급자가 이미 차감한 예약과의 동일성을 입증할 수 없어 전체 미이행 예약을 보수적으로 공제하며 중복 차감으로 가용 수량이 줄 수 있다. 예약 수량 미확인은 보류한다. 입출고·실사·반품 사건 전체를 고정해 물리 원장이 바뀌면 다시 조회·승인하기 전 보류한다. 기존 출고·환불·안전한 해제는 복구할 수 있다. [상품·재고 계약](GROWTH-PROVIDER-CATALOG.ko.md), [최적화 평가 계약](GROWTH-OPTIMIZATION-EVALUATION.ko.md), [운영규칙 계약](GROWTH-OPTIMIZATION-RULE.ko.md).

## 현재 잔여와 종료 조건

1. **검토·통합 검증:** 독립 검토에서 발견한 H/M을 수정하고 재검토 passed. 통합348/348 suites·19,327 assertions, 삭제 복구 후349/349·19,359 assertions passed. 마지막 잠금/손상 기록 전용92개도 passed. 타입·빌드 passed, lint 기준선70 errors/39 warnings gate passed, Python119 passed, 프롬프트22 passed. 핵심 화면36개와 연결 화면2개 passed(real Chromium/D1, 인증·외부 provider mocked). macOS 키보드 선택 테스트2개는 빈 native select에서도 재현되어 failed였으나 Linux CI에서는 통과했다.
2. **원격 반영:** #337·#339 merged, 필수 CI verify passed, Sites102 published/runtime-verified. [게시 기록](releases/2026-10-04-59710e6.md). #337 전체 Linux E2E는285 passed·5 skipped·6 failed였고 macOS 키보드2건은 Linux에서 통과했다. 실패6건의 D1 바인드 한도 초과를 실제 workerd에서 재현·수정했으며 #339 회귀349/349·19,359 assertions와 삭제/보관/되돌리기 E2E8이 passed다. 수정본 전체 Linux E2E는 [Actions 결과](https://github.com/roybeee/Collective/actions/runs/37168565625)로 별도 확인한다.
3. **Q 원화 hard cap blocked:** 현재 공개 상류 계약에 실제 유료 지출 제한 수단이 없어 신규 유료 평가를 409로 차단한다. 가격판·모델별 최대 비용·원자 원화 예약·공급자 강제 상한·영수증/unknown 회수 계약이 필요하다. 예산 스냅샷이나 확인 체크로 이 조건을 해제하지 않는다. 실제 유료 평가 not_run.
4. **판매처 운영 설치 not_run:** 실제 MAPDAL 상품/주문/랜딩/CS/실험 어댑터의 설치·권한·정확 매핑·운영 대사는 not_run. 상품 재고는 수동 조회와 공정 순환 작업자에 연결했다. 최소 5분마다 한 연결을 읽고 실패 시 최대 6시간 backoff하며 15분 지난 근거는 보류한다. 가격·재고·물리 원장 근거 변경은 자동 승인하지 않는다.
5. **실계정·사업 효과 별도:** 네이버 검색광고·개발자센터·YouTube·쿠팡 키 4종, 실제 트래픽, 목적별 고지/동의/철회, 법무 검토, 실제 집행 범위·금액과 판매 성숙 데이터가 필요하다. 수집 0건·모의 공급자 성공을 실수집/발송/매출 성과로 보고하지 않는다. G0-B/C/D 운영 실증과 인과 성과도 별도다.
6. **조건부 카드 20~24:** UCP 사용처, 해외 대상국/자격, MMM 장기 데이터, 외부고객/성과료 사업 결정에 따라 재개한다. 조건이 없는 상태에서 임의 출시·유료 서비스·자동 예산배분을 추가하지 않는다.

| 최종 확인 | 상태 | 증거 구분 |
|---|---|---|
| 로컬 회귀·타입·빌드·lint·독립 검토 | passed | 위 수치 및 검사별 실제/모의 구분; 최종 전체·필수 CI passed |
| 핵심 E2E | passed | 핵심36+연결2, 삭제·보관 복구8 passed; 수정본 전체 Linux 결과는 #339 참조 |
| 이번 소스 main 병합 | merged | #337·#339, `59710e6` |
| 이번 소스 Sites 게시·공개 버전 확인 | published / runtime-verified | Sites102, 제품 tree 일치 |
| 실판매처 설치·실계정 호출·실제 발송/지출 | not_run | 합성 DB·mock 성공으로 대체 불가 |
| 신규 Q 유료 실행 | blocked | 원화 hard cap 상류 계약 부재, 409 차단 |
