# A8 고객 보고서·사실 지식 팩 (LLM 0) 설계

결론: 점포 브랜드의 주간 고객 보고서와 확정 사실 팩을 모델 호출 없이 결정론 집계로 만들고 내보낸다. 필요한 데이터는 대부분 이미 있다(A4 귀속 집계, A6 자료 요청·플레이스 대조, 확정 사실). 새로 만드는 것은 지표 사전, 렌더러, 동결 스냅샷, 대표 검토 기록이다. PR은 3개로 나누고 모두 토큰 0이다.

비유: 가게 장부(주문·광고비)와 게시판(확정 사실)을 일주일마다 한 장짜리 결산표로 묶는다. 결산표는 사진을 찍어(동결) 두고, 사장님이 확인 도장(검토)을 찍는다.

- 상태: **A8-1 순수 모듈을 구현했다(연결 없음, [9절](#9-a8-1-구현-순수-모듈))**. A8-2(서버·API)·A8-3(화면)은 착수 전이다.
- 레인: A([LANES](LANES.ko.md)). 기준 SHA `63f8873`. 아래 `파일:줄`은 그 커밋 기준이다.
- 4단계 종료 조건: "점포 브랜드 주간 고객 보고서 1건을 대표가 검토했다(real)". 묶음 5(B3·B4 2부·A8·PR 5)에 싣는다.

## 1. 쓸 수 있는 결정론 데이터

기간은 대부분 한국 날짜 문자열(`YYYY-MM-DD`, `koreaToday`, `lib/store-operations.ts:25`)이다.

| 지표 | 정의 위치 | 지점 귀속 | 출처 구분 |
|---|---|---|---|
| 주문 수(결제 완료·전액 환불 아님) | `lib/store-attribution.ts:107` `countedOrder`, `:112-116` | 지점 | 사용자 기록 |
| 순매출(결제−환불) | `store-attribution.ts:115`, `store-operations.ts:32` `ledgerSummary` | 지점 | 사용자 기록 |
| 공헌이익(원가 미상 1건이라도 있으면 null) | `store-operations.ts:28`, `store-attribution.ts:110-115` | 지점 | 파생 |
| 신규 고객 수(미상 있으면 null) | `store-attribution.ts:111,115` | 지점 | 사용자 기록 |
| 귀속 주문·코드/팔/소재/캠페인별 | `store-attribution.ts:108`, `:126-137` | 지점 | 파생 |
| 채널 단위경제(광고비·주문당 비용·ROAS) | `store-attribution.ts:141-149` | 지점 | 사용자 기록 + 네이버 수집값 옮김 |
| 주간 POS 대조·north-star | `store-attribution.ts:178-195`, POS 입력 `store-operations-server.ts:196-206` | 지점 | 사용자 기록·파생 |
| 캠페인 귀속 집계(기본 8주, 최대 26주) | `lib/campaign-attribution.ts:16,26-58` | 지점·브랜드 합산 | 파생 |
| 네이버 검색광고·Instagram 값 | `lib/connectors/naver-ads.ts:115-118`, `instagram.ts:101-103` → `measurement_draft`(`lib/measurement-collection.ts:20-38`, `comparable:false`) | 캠페인 → 지점 | 커넥터 실측. **수집마다 덮어써서 과거 주 값이 남지 않는다** |
| 발행 건수·상태 | `lib/execution.ts:11,19,28` | 캠페인 → 지점 | 앱 기록 |
| 열린 자료 요청 | `lib/data-requests.ts:23-24` | 선택 | 앱 기록(A6) |
| 플레이스 불일치 | `lib/place-check.ts:15-18` | 지점 | 대조 결과(A6-2) |

- data-truth-9 지표 정의는 대시보드 숫자에만 코드로 있다(`lib/workspace-metrics.ts:24-39`, 대응표 `docs/QUALITY-CONSOLE.ko.md:86-95`). 매출·주문 지표는 A4 함수가 사실상의 정본이다. 지표 id·단위·출처를 한곳에 모은 사전은 없어서 A8-1이 만든다.
- 주 경계는 **KST ISO 주(월~일), 끝난 주만 동결**한다. 점포 장부(`store-attribution.ts:151-154`)·품질 콘솔(`lib/quality-console.ts:44-62`)과 같은 관례다.
- `store_report` kind가 이미 있으므로(지점 조사 보고서) 새 kind 이름은 `customer_report`다.

## 2. 사실 지식 팩
- **담는 것**: `effectiveBrandFacts(facts, brandId, storeId, now)`(`lib/brand-facts.ts:24-28`)만 담는다. 확정됐고, 근거가 있고, 유효기한 안인 사실이다. 같은 항목이면 지점 사실이 브랜드 사실을 대신한다.
- **따로 두는 것**
  - 거절 사실(광고 금지 표현)은 별도 절에 둔다.
  - 후보·만료·근거 없음·가맹 항목은 건수만 적는다.
  - 유효기한이 14일 안에 끝나는 사실에는 `expiresInDays`를 붙인다.
- **형식**: JSON(`collective.fact-pack.v1`, 정본), Markdown, CSV. 세 형식의 `factId·version` 집합이 같다는 것을 테스트로 고정한다.
- **표시**
  - 항목마다 범위, 출처(가림 적용), 확인일, 유효기한, 판, 확정 시각을 적는다.
  - `confirmedBy.email`은 싣지 않는다.
- **가맹 사실은 v1에서 뺀다**
  - 제외 조건:
    - 카탈로그 franchise 항목
    - `franchiseFactKey` 별칭
    - `sourceRef`나 `cost`가 있는 사실
  - 이유: 정보공개서 버전 판정이 트랙 R 파일에 있고, 수익 항목은 밖으로 내보내면 안 된다.
  - A8은 `fact-catalog.ts`와 `franchise-*`를 읽기만 한다. 트랙 R의 R6은 A8 렌더러를 자기 파일에서 재사용할 수 있게 범용으로 만든다.

## 3. 산출과 저장
- **미리보기**: 요청할 때 계산하고 저장하지 않는다.
- **동결**
  - 명시적인 `freeze` 요청으로 kind `customer_report` 행을 만든다. 동결이 필요한 이유는 두 가지다. 커넥터 초안은 덮어써지고, 주문은 나중에 고쳐진다.
  - `attributionSnapshot` 방식을 따른다(`campaign-attribution.ts:65-82`). 확인 값 `expected`와 지금 계산한 값이 다르면 409, 끝나지 않은 주면 400이다.
- **판과 이력**: id는 `<store|brand:ID>:<YYYY-Www>`로 결정론이다. 다시 동결하면 `version+1`이 되고, 이전 판 최대 5개를 행 안 `history`에 둔다.
- **변경 감지**
  - 입력 참조를 해시로 둔다: 주문·비용 `{id,version}`, POS 판, 사실 `{id,version}`.
  - 읽을 때 다시 계산해서 다르면 `stale:true`로 표시한다.
- **대표 검토**
  - 같은 행의 `review:{status:'reviewed', reportVersion, by:{id, role:'owner'}, at}`에 남긴다.
  - 대표만 할 수 있다. 판이 바뀌면 새 판은 미검토 상태가 된다.
- **kind 등록**
  - parent는 brand, `not_campaign_scoped`다.
  - 위치는 `place_snapshot` 뒤, `brand_voice` 앞이다. 끝의 고정 묶음을 지킨다.

## 4. 개인정보: 집계만 담는다
1. 보고서 payload는 순수 빌더가 지표 사전에 있는 키만으로 새로 조립한다. 다음 값은 빌더 입력에 들어오지 않는다.
   - 주문 행 필드: 주문번호·메모·근거·추적 코드·입력자
   - 비용 출처 문구
   - 커넥터 계정 id·raw
2. 남는 문자열은 `maskFields`(`lib/pii-scan.ts:170`)로 가린다: 코드 설명, 소재·캠페인 제목, 자료 요청 라벨, 사실 출처.
   - 허용 목록은 확정 사실 값과 지점 주소다.
   - 가린 기록은 필드·종류·건수만 남긴다.
3. 빼는 것:
   - 자료 요청의 `text`·`assignee`·`origins`
   - 플레이스 원문 값(항목·상태만 남긴다)
4. 카나리 테스트: 주문 메모 등에 전화·이메일·카드 패턴을 심고, JSON·MD·CSV 어디에도 나오지 않는지 확인한다.
5. CSV는 `=+-@`·탭으로 시작하는 셀 앞에 `'`를 붙인다. `usage-export`와 같은 규칙을 A8 파일에 로컬로 둔다.

## 5. PR 분할

| PR | 목표 | 주요 파일 | 스위치·게시·토큰 |
|---|---|---|---|
| **A8-1** 순수 모듈 | 지표 사전 `REPORT_METRICS`, 보고서 빌더·MD·CSV, 사실 팩 빌더 | 신규 `lib/customer-report.ts`, `lib/fact-pack.ts`, 테스트 2개. 이 문서에 지표 정의표를 보강한다 | 연결이 없어 스위치가 필요 없다. 게시 불필요. 토큰 0 |
| **A8-2** 서버·API | 미리보기, 동결, 대표 검토, 다운로드(보고서·사실 팩) | `lib/store-operations-server.ts`(`attributionReport`에 export 한 단어), 신규 `lib/customer-report-server.ts`, `app/api/customer-reports/route.ts`, `record-kinds`·`feature-flags`(`a8_customer_report` 기본 꺼짐)·`feature-status`, `SECURITY-BOUNDARIES` | 기본 꺼짐. 병합에는 게시가 필요 없다. 토큰 0 |
| **A8-3** 화면(PR 5 범위) | 지점 탭 '고객 보고서'(주 선택·미리보기·동결 대화상자·판 목록·대표 '검토 완료'·다운로드), 사실 탭 '사실 팩 받기' | 신규 `app/customer-report-panel.tsx`, `lib/nav-state.ts`, `app/store-marketing-panel.tsx`·`app/brand-facts-panel.tsx` 각 1줄, E2E | 묶음 5로 게시. 토큰 0 |

- **payload 계약**: `collective.customer-report.v1`. 담는 항목은 범위, 기간(`YYYY-Www`, from·to, `Asia/Seoul`), 장부(값·전주), 완전성(POS 대조), north-star, 채널 단위경제, 커넥터(`comparable:false`·한계), 발행 건수, 할 일(열린 자료 요청 라벨, 플레이스 불일치 항목), 사실 건수, 고지("귀속≠증분", "자동 판정 아님"), 가림 기록이다.
- **API**
  - `GET ?storeId=&week=`: 미리보기와 동결 목록
  - `GET ?id=&format=json|md|csv`: 첨부 파일(`no-store`, `nosniff`)
  - `GET ?type=fact_pack&brandId=&storeId=&format=…`
  - `POST freeze`: 확인 값 필요, 잠금
  - `POST review`: 대표만
- **주요 RED 테스트**
  - 같은 fixture에서 보고서 합계 = `attributionReport` = `ledgerSummary`(data-truth-9)
  - KST 월~일 주 경계
  - 공헌이익은 원가 미상이면 null
  - north-star는 POS 대조를 통과한 주만 센다
  - 카나리 개인정보 0건
  - 커넥터 값은 `comparable:false`이고 계정 id가 없다
  - 네이버 광고비 창이 주를 걸치면 경고한다
  - CSV 수식 방지
  - 같은 입력이면 바이트가 같다
  - 사실 팩은 유효 사실만 담고 가맹 항목은 제외한다
  - 세 형식의 id 집합이 같다
  - 순수 모듈은 server·feature-flags·quality·franchise를 import하지 않는다
  - 스위치가 꺼지면 409, 직원은 403, 검토는 대표만
  - 동결 뒤 주문을 고치면 `stale`
  - provider_usage 0건(토큰 0)

## 6. 4단계 종료 조건(real) 절차
1. 3단계 종료 조건과 묶음 5의 `runtime-verified`를 기록한다(레인 A 게시).
2. 점포 브랜드 지점 하나에서 끝난 주 W를 고른다. 그 주의 주문 CSV, POS 주간 합계, 비용 장부를 준비한다.
3. 대표가 `a8_customer_report`를 켠다.
4. 대표나 관리자가 W 미리보기를 확인하고 동결한다.
5. 대표가 MD를 받아 읽고 '검토 완료'를 누른다.
6. 동결 메타(id·판·`review.at`·role, `stale:false`)를 레인 A 칸과 관찰 기록에 **건수·상태만** 적는다. 매출 원문은 공개 저장소에 적지 않는다.

## 7. 대표 결정 (권고)

| # | 질문 | 권고 |
|---|---|---|
| D1 | 공유 링크 | 만들지 않는다. 다운로드와 수동 전달만 한다. 공개 링크는 외부 고객 게이트(원칙 13) 뒤 별도 계획으로 둔다 |
| D2 | 권한 | 미리보기·다운로드·사실 팩·동결은 대표·관리자만(직원 403), 검토는 대표만 |
| D3 | 계산과 동결 | 미리보기는 요청 시 계산, 검토는 동결 판에만. 다시 동결하면 재검토 |
| D4 | 포함 범위 | 포함: 장부·POS 대조·north-star·채널 단위경제·커넥터(참고, 비교 불가)·발행 건수·열린 자료 요청(라벨만)·플레이스 불일치(항목·상태만)·사실 유효기한 건수. 제외: B2 AI 품질 지표(내부용), 주간 incrementality-lite(오독 위험), 변동비율 추정 |
| D5 | real 종료 조건의 최소 데이터 | 그 주에 주문 1건 이상과 POS 합계가 있어야 한다. 없으면 `not_run` 사유로 기록 |
| D6 | 가맹 사실 | v1에서 제외. 필요하면 트랙 R이 R6/R15에서 따로 만든다 |
| D7 | 캠페인 삭제 뒤 | 동결 보고서는 `not_campaign_scoped`로 남긴다 |

## 8. 위험과 공유 파일
- **네이버 광고비 날짜 몰림**: 수집 기간 합계가 종료일 한 건으로 기록된다(`lib/spend-transfer.ts:44,73`). 주를 걸치면 한 주에 몰리므로 경고만 달고 배분하지 않는다.
- **조회 한도**: 5,000건·26주(`store-operations-server.ts:40,217`)를 넘으면 400을 그대로 전달한다.
- **공유 파일**
  - `lib/record-kinds.ts`·`lib/feature-flags.ts`·`lib/feature-status.ts`는 트랙 R R15a-2와 겹칠 수 있다. LANES 규칙대로 먼저 연 PR이 이기고, 뒤 PR은 main을 merge해서 자기 항목만 더한다.
  - `prompts/`·`role-instruction`·`meetings`와 레인 Q의 `eval-*`·`quality-*`는 건드리지 않는다. 주 라벨은 교차 테스트로만 확인한다.

## 9. A8-1 구현 (순수 모듈)

결론: 보고서·사실 팩을 만드는 순수 함수와 지표 사전을 더했다. 서버·API·kind·스위치는 건드리지 않았고(A8-2), 모델·외부 호출은 0회다. 5절 A8-1 RED 목록은 `tests/customer-report.test.mjs`·`tests/fact-pack.test.mjs`가 고정한다.

비유: 계산기와 결산표 양식만 먼저 만들었다. 장부를 꺼내 오는 창구(서버)와 도장 찍는 자리(동결·검토)는 다음 PR이다.

### 9.1 지표 사전 `REPORT_METRICS`

payload의 숫자 키는 모두 아래 id다(테스트가 확인한다). 정의는 A4 순수 함수를 그대로 쓴다(data-truth-9).

| id | 구역 | 이름 | 단위 | 출처 | 정의 | 근거 코드 |
|---|---|---|---|---|---|---|
| `records` | 장부 | 주문 기록 | 건 | 사용자 기록 | 보고 주(한국 날짜 월~일)의 주문 기록 전체(취소·전액 환불 포함). | `store-attribution.ts orderMetrics records` |
| `orders` | 장부 | 주문 수 | 건 | 사용자 기록 | 결제 완료이고 전액 환불이 아닌 주문. | `store-attribution.ts countedOrder` |
| `cancelled` | 장부 | 취소 | 건 | 사용자 기록 | 상태가 취소인 주문 기록. | `store-operations.ts ledgerSummary cancelled` |
| `refunded` | 장부 | 전액 환불 | 건 | 사용자 기록 | 상태가 전액 환불인 주문 기록. | `store-operations.ts ledgerSummary refunded` |
| `netRevenue` | 장부 | 순매출 | 원 | 사용자 기록 | 모든 주문 기록의 결제액−환불액 합. | `store-attribution.ts orderMetrics netRevenue = ledgerSummary netRevenue` |
| `contribution` | 장부 | 공헌이익 | 원 | 파생 | 순매출−주문 원가(식재료·포장·수수료·배달비·증정) 합. 원가를 모르는 주문이 1건이라도 있으면 null(추정 없음). | `store-operations.ts orderContribution` |
| `unknownCostOrders` | 장부 | 원가 미입력 주문 | 건 | 사용자 기록 | 원가 항목 중 하나라도 비어 있는 주문 기록. | `store-attribution.ts orderMetrics unknownCostOrders` |
| `newCustomers` | 장부 | 신규 고객 | 명 | 사용자 기록 | 센 주문 중 신규 여부가 참인 주문. 하나라도 모르면 null. | `store-attribution.ts orderMetrics newCustomers` |
| `attributedOrders` | 장부 | 귀속 주문 | 건 | 파생 | 센 주문 중 유입 채널·캠페인·소재가 하나라도 있는 주문. 귀속≠증분. | `store-attribution.ts isAttributed` |
| `adSpend` | 장부 | 광고비 | 원 | 사용자 기록 | 비용 장부 광고비 합. 네이버 검색광고 수집값을 옮긴 기록은 수집 기간 합계를 종료일 한 건으로 적는다(배분 없음). | `store-operations.ts ledgerSummary adSpend` |
| `productionCost` | 장부 | 제작·협찬비 | 원 | 사용자 기록 | 비용 장부 제작·협찬비 합. | `store-operations.ts ledgerSummary productionCost` |
| `spendTotal` | 장부 | 비용 합계 | 원 | 파생 | 광고비+제작·협찬비. | `store-attribution.ts unitEconomics spendTotal` |
| `ledgerNet` | POS 대조 | 장부 순매출 | 원 | 사용자 기록 | 그 주 일별 장부 합계의 순매출. | `store-attribution.ts weeklyCompletenessFromDays` |
| `ledgerOrders` | POS 대조 | 장부 주문 수 | 건 | 사용자 기록 | 그 주 일별 장부 합계의 주문 수. | `store-attribution.ts weeklyCompletenessFromDays` |
| `posNet` | POS 대조 | POS 순매출 | 원 | 사용자 기록 | 매장 POS가 낸 그 주 순매출 합계. 없으면 null(missing_pos). | `store-attribution.ts PosWeeklyTotal netSales` |
| `posOrders` | POS 대조 | POS 주문 수 | 건 | 사용자 기록 | 매장 POS가 낸 그 주 주문 수. 없으면 null. | `store-attribution.ts PosWeeklyTotal orderCount` |
| `diffRate` | POS 대조 | POS 차이율 | 비율 | 파생 | |장부 순매출−POS 순매출|÷POS 순매출. 허용 오차 1% 안이면 pass. | `store-attribution.ts COMPLETENESS_TOLERANCE` |
| `attributedContribution` | POS 대조 | 귀속 공헌이익 | 원 | 파생 | 그 주 귀속 주문의 공헌이익. 원가를 모르는 귀속 주문이 있으면 null. | `store-attribution.ts weeklyCompletenessFromDays` |
| `measured` | north-star | north-star 측정 | 예/아니오 | 파생 | POS 대조를 통과한 주가 하나라도 있는가. | `store-attribution.ts northStar measured` |
| `passedWeeks` | north-star | 대조 통과 주 | 주 | 파생 | 지난 4주 중 POS 대조 pass인 주. | `store-attribution.ts northStar` |
| `excludedWeeks` | north-star | 제외한 주 | 주 | 파생 | 지난 4주 중 fail·missing_pos인 주. | `store-attribution.ts northStar` |
| `northStarOrders` | north-star | north-star 귀속 주문 | 건 | 파생 | 통과한 주의 귀속 주문 합. | `store-attribution.ts northStar attributedOrders` |
| `northStarContribution` | north-star | north-star 귀속 공헌이익 | 원 | 파생 | 통과한 주의 귀속 공헌이익 합. 하나라도 null이거나 통과 주가 없으면 null. | `store-attribution.ts northStar attributedContribution` |
| `contributionAfterSpend` | 채널 | 비용 뺀 공헌이익 | 원 | 파생 | 채널 공헌이익−같은 채널 비용 합계. 공헌이익이 null이면 null. | `store-attribution.ts unitEconomics` |
| `costPerOrder` | 채널 | 주문당 비용 | 원 | 파생 | 채널 비용 합계÷주문 수. | `store-attribution.ts unitEconomics` |
| `costPerNewCustomer` | 채널 | 신규 고객당 비용 | 원 | 파생 | 채널 비용 합계÷신규 고객. | `store-attribution.ts unitEconomics` |
| `revenuePerSpend` | 채널 | 비용 대비 순매출 | 비율 | 파생 | 순매출÷채널 비용 합계(ROAS). 귀속≠증분. | `store-attribution.ts unitEconomics` |
| `connectorAdSpend` | 커넥터 | 커넥터 광고비 | 원 | 커넥터 실측 | 커넥터가 수집 기간 합계로 준 광고비. 모르면 null. | `measurement_draft storeValues.adSpend` |
| `connectorConversions` | 커넥터 | 커넥터 전환 | 건 | 커넥터 실측 | 커넥터가 준 전환 수(광고 계정 전환 정의). | `measurement_draft storeValues.orders` |
| `controlNumerator` | 커넥터 | 대조안 분자 | 건 | 커넥터 실측 | 대조안 수집 값의 분자(정의 참고). | `measurement_draft arms.control.value` |
| `controlDenominator` | 커넥터 | 대조안 분모 | 건 | 커넥터 실측 | 대조안 수집 값의 분모(정의 참고). | `measurement_draft arms.control.value` |
| `treatmentNumerator` | 커넥터 | 실험안 분자 | 건 | 커넥터 실측 | 실험안 수집 값의 분자(정의 참고). | `measurement_draft arms.treatment.value` |
| `treatmentDenominator` | 커넥터 | 실험안 분모 | 건 | 커넥터 실측 | 실험안 수집 값의 분모(정의 참고). | `measurement_draft arms.treatment.value` |
| `publications` | 발행 | 발행 건수 | 건 | 앱 기록 | 예약 시각(한국 날짜)이 보고 주인 발행을 상태별로 센다. | `execution.ts Publication status` |
| `openDataRequests` | 할 일 | 열린 자료 요청 | 건 | 앱 기록 | 열린 자료 요청(라벨만). | `data-requests.ts DataRequest` |
| `placeMismatches` | 할 일 | 플레이스 불일치 | 건 | 파생 | 플레이스 대조에서 일치가 아닌 항목(항목·상태만). | `place-check.ts PlaceCheckResult` |
| `factCounts` | 사실 | 사실 건수 | 건 | 앱 기록 | 사실 팩의 확정·14일 안 만료·거절·제외 건수. | `fact-pack.ts FactPackCounts` |

### 9.2 계약

| 함수 | 입력 → 출력 | 규칙 |
|---|---|---|
| `isoWeekOfDate(date)`·`reportWeek(week)`·`weekClosed(week, today)` | 한국 날짜 ↔ `YYYY-Www`(월~일, `Asia/Seoul`) | 없는 주(W00·W54·그해에 없는 W53)는 `null`. 라벨은 `quality-console` `isoWeekOf`와 같다(테스트에서만 교차 확인, 런타임 import 없음) |
| `aggregateLedger(week, orders, spend)` | 주문·비용 행 → `ReportLedger`(이번 주·전주 장부, 채널 단위경제, 주를 걸친 네이버 광고비 창) | 여기서 주문 행 필드와 비용 출처 문구가 떨어진다. `orders`는 게시 관문을 다시 본 주문(`publicationGateView`)을 넘긴다. `spend`는 보고 주 앞뒤 네이버 수집 기록까지 넘겨야 걸친 창을 찾는다 |
| `buildReport(input)` | `{scope, week, ledger, days, posTotals, connectors?, publications?, dataRequests?, placeChecks?, facts?, allow?}` → `collective.customer-report.v1` | 사전 키만으로 새로 조립한다. 없는 주·다른 주의 장부는 `RangeError`. POS 대조·north-star는 보고 주를 포함한 최근 4주(`REPORT_TRAILING_WEEKS`). `days`는 게시 관문을 다시 본 일별 합계(`attributionReport`의 `regateDays`와 같게) |
| `reportMarkdown`·`reportCsv`·`reportFileName` | payload → MD·CSV·파일 이름 | 렌더러는 payload만 읽는다. CSV는 `section,key,label,unit,value,previous` 한 줄에 값 하나, UTF-8 BOM·CRLF. 파일 이름은 `customer-report-<store|brand>-<id>-<YYYY-Www>.<json|md|csv>` |
| `factPackInput(facts, brandId, storeId, now)` | 저장된 사실 → `{confirmed, rejected, excluded}` | 확정 = `effectiveBrandFacts`, 거절 = `scopedBrandFacts`의 금지 사실, 나머지는 후보·만료·근거 없음·가맹 건수 |
| `buildFactPack({scope, now, ...})`·`factPackMarkdown`·`factPackCsv` | → `collective.fact-pack.v1` | 빌더도 가맹 항목을 다시 걸러 센다. `confirmedBy`는 싣지 않는다. 14일 안 만료에 `expiresInDays`. 세 형식의 `factId·version` 집합이 같다 |

- **payload 키**: `schema, scope{type,id,brandId,name,address,businessPhone}, period{week,from,to,timeZone,previousWeek}, ledger{current,previous}, completeness[], northStar{measured,weeks,passedWeeks,excludedWeeks,northStarOrders,northStarContribution}, channels[], spendWarnings[], connectors[], publications{total,byStatus}, todos{dataRequests[{label}],placeMismatches[{field,label,state}]}, facts, notices[], masking[]`.
- **공헌이익**: 빌더는 변동비율을 어디에도 넘기지 않는다. 장부에 원가 미입력 주문이 있으면 입력에 공헌이익이 적혀 와도 `null`로 둔다.
- **커넥터**: `naver_ads`·`instagram`만. 커넥터·수집 기간·수집 시각·보고 주와의 관계(`within|crosses|outside`)·정의·한계·숫자 값(`storeValues`의 광고비·전환, arm의 분자·분모)만 옮기고 `comparable:false`로 고정한다. 계정 id·광고 대상·자격증명·`raw`·arm `source`는 읽지 않는다.
- **가림**: `maskFields` 경로는 지점 이름, 채널 이름, 커넥터 정의·한계, 자료 요청 라벨이다. 허용 목록은 지점 주소, 확정 사업장 전화, `allow`(확정 사실 값)다. 사실 팩은 출처·거절 표현·이름을 가리고 확정 사실 값·지점 주소를 허용한다.
- **고지**: `notices` 첫 두 줄은 "귀속≠증분"(`ATTRIBUTION_NOT_INCREMENTAL`)과 "자동 판정 아님"이다. MD 머리와 CSV `notice` 행에도 같은 문장이 들어간다.

### 9.3 설계와 다르게 한 것·한계

- north-star 키는 장부의 `attributedOrders`와 헷갈리지 않게 `northStarOrders`·`northStarContribution`으로 이름을 바꿨다. 창은 최근 4주로 정했다(설계에 없던 값).
- v1 payload에는 코드·팔·소재·캠페인별 표를 넣지 않았다(D4 포함 범위에 없음). 그래서 4절 2의 "코드 설명, 소재·캠페인 제목" 가림 경로는 없다.
- CSV는 `=+-@`·탭·CR로 시작하는 **문자열**에만 `'`를 붙이고 숫자(음수 포함)는 그대로 둔다. `usage-export`는 음수에도 붙인다. BOM·CRLF는 같다.
- 네이버 옮긴 광고비 판별(`naver-<24자>-<시작일>` id, 비용일 = 종료일)과 발행 상태 이름(`PUBLICATION_STATUS_LABELS`)은 `lib/spend-transfer.ts`·`lib/execution.ts`에서 로컬로 옮겼다. 두 파일은 허용 import 목록 밖이다(`spend-transfer`는 `server`를 import한다). 발행 이름은 테스트가 같음을 확인한다. id 형식이 바뀌면 두 곳을 함께 고친다.
- 같은 항목의 지점 사실에 `sourceRef`·`cost`가 있으면, 그 지점 사실은 가맹이라 빠지고 대신된 브랜드 사실도 없다. 실제로는 가맹 항목에만 근거가 붙어서 드물다.
- 브랜드 범위 보고서(`scope.type='brand'`)는 POS 합계를 지점별로 거르지 않는다. 지점 합산 규칙은 A8-2에서 정한다.
- import 경계 테스트는 타입 전용 import를 실행 그래프에서 뺀다. `lib/execution.ts`가 `franchise-facts`를 타입으로만 import하기 때문이다(컴파일하면 지워진다). 직접 import는 타입까지 전부 허용 목록(`store-attribution`·`store-operations`·`brand-facts`·`fact-catalog`·`pii-scan`·`fact-pack`)만 쓴다.
- 가림은 패턴 기반이다. 사람 이름 등은 잡지 않는다(`docs/INPUT-MINIMIZATION.ko.md` 알려진 한계).
