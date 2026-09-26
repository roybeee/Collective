# A8 고객 보고서·사실 지식 팩 (LLM 0) 설계

결론: 점포 브랜드의 주간 고객 보고서와 확정 사실 팩을 모델 호출 없이 결정론 집계로 만들고 내보낸다. 필요한 데이터는 대부분 이미 있다(A4 귀속 집계, A6 자료 요청·플레이스 대조, 확정 사실). 새로 만드는 것은 지표 사전, 렌더러, 동결 스냅샷, 대표 검토 기록이다. PR은 3개로 나누고 모두 토큰 0이다.

비유: 가게 장부(주문·광고비)와 게시판(확정 사실)을 일주일마다 한 장짜리 결산표로 묶는다. 결산표는 사진을 찍어(동결) 두고, 사장님이 확인 도장(검토)을 찍는다.

- 상태: **설계만 했다(코드 착수 전)**. 성장 계획 원칙 12에 따라 3단계 종료 조건(A3·A6 real run)을 채운 뒤 A8-1부터 착수한다.
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
