# 성장2 원안 잔여 개발 인계 초안

작성 기준: 2026-09-30, `/Users/roybee/Collective-operation-review` HEAD `e17a931c9175e21bcfa395606439df15d1823493`와 현재 운영 확인 목록 변경. 원안은 `docs/GROWTH-2-PLAN.ko.md`의 G2-00~32 33카드(12a/b로 표는 34행)다. 추가 반영: `/Users/roybee/Collective-return-reasons`의 `growth-return-reasons*` 최종 읽기 검토. 이 문서는 소스 읽기 결과이며 CI·운영 배포·실계정 증거를 새로 검증하지 않았다. 로컬 코드 존재, 테스트 통과, merge, publish, runtime 검증, 실제 사업 성과는 별개다.

## 인계 결론

현재는 Meta에 한정되지 않는다. 시장 근거→기회→단일 상품/오퍼→판매 미션→예산/공유 재고→Buffer 발행→정확 발행별 측정/귀속 주문→운영/목표 리뷰의 연결이 있다. 그러나 많은 연결은 운영자 근거, 로컬 원장, 읽기 검토에 한정된다. 실제 고객 문의 처리, 기록된 반품 원인의 개선 효과·자동 학습, 크리에이터 실행 영수증, 상품 상세페이지 변경 및 비Meta 구매 실험은 완료로 세면 안 된다.

다음 개발은 새 종합 대시보드보다 기존 실행·관측을 수요 시퀀스와 개선 결정에 연결하는 것이 우선이다. 실제 외부 실행은 현재 권한·계정·예산·재고·출처 판과 원래 승인 범위를 별도로 충족해야 한다.

## 2026-09-30 Claude 잔여 개발 결과 (PR #285)

아래 33카드 표의 "완료로 세면 안 되는 잔여" 중 코드로 닫을 수 있는 연결을 `claude/vibrant-bohr-gzwdmw`에서 구현했다. 모두 로컬 원장·조회·검토이고 `mayExecute:false`다. 문서별 경계는 각 `GROWTH-2-*.ko.md`에 있다.

| 카드 | 이번에 연결한 것 | 여전히 코드 밖(not_run·결정 필요) |
|---|---|---|
| 00·28 | [일일 자율 루프](GROWTH-2-DAILY-LOOP.ko.md): KST 하루 1회, 캠페인 20개·30초 한도, 탐지+7종 안건, partial/failed/retryAt. 스위치 `growth_daily_loop` 기본 OFF | 실제 운영에서 켜고 G0-B/C/D 실증 |
| 04·18 | [판매처 pull 어댑터](STOREFRONT-PULL.ko.md): 봉인 토큰, cursor/limit, 리다이렉트 금지·10초·256KB, 기존 import와 같은 배치로 cursor 전진, 지수 backoff. 스위치 `storefront_pull` 기본 OFF | 맵달 판매처의 실제 pull endpoint·실계정 정산 대사 |
| 06·07·25 | [자사 데이터 신호 탐지](GROWTH-2-DETECTION.ko.md): 수요 급변·재고 일수·반품/CS 반복·시즌 달력, 멱등 신호 ID | 외부 시장/검색/리뷰 지속 수집 |
| 08·09·10 | [일반 판매 실험](GROWTH-2-EXPERIMENTS.ko.md): 시작 전 동결, SHA-256 배정, SRM·오염·추적·미확인 검사, 알파 소비, Meta 통계 재사용 | 실제 노출·미구매 분모 수집과 성숙 결과 |
| 11·12b·17b | [검증 확대 게이트](GROWTH-2-EXPANSION.ko.md): 90일 내 최신 확증 결과·동일 개입·양의 단위 공헌·재고·증액 20% 이하 → 소유자 `scale` 예약·대사 | 실제 증액 집행 |
| 12a·26·29 | [상세페이지 수정안](GROWTH-2-LANDING.ko.md): 초안→승인→수동 적용 영수증→롤백, 미승인 가격·재고 주장·미확인 사실 차단 | 판매처 상세페이지 API 배포·재조회 |
| 13·31 | [교훈 적용 계보](GROWTH-2-LESSON-APPLICATIONS.ko.md): 재사용 가능 교훈→정확한 대상 판, 결과 1건, 실패 누적 시 재검토 제안 | 자동 방법 수집 |
| 15·16 | [최적화 후보](GROWTH-2-OPTIMIZATION.ko.md): 실제 실패 기록에서만 후보, 토큰/원화 상한, 동결→eval_run→동결 뒤 확증 실험→소유자 채택·롤백 | 평가 실행 자체는 Q 레인 경로, 자동 승격 금지 유지 |
| 19·27·28 | [수요 단계↔발행 근거](GROWTH-2-DEMAND-EVIDENCE.ko.md), [크리에이터·파트너 영수증](GROWTH-2-COLLABORATION.ko.md): 제안→합의→전달→승인(고지·진정성)→발행→정산/취소, 추적 코드 주문 | 실제 연락·계약·지급·발행 |
| 26 | [다SKU 번들](GROWTH-2-BUNDLES.ko.md): 단일 세금 기준 원가 합산, 공유 재고로 최대 번들 수 | 실발주·판매면 연결 |
| 29·30·31 | [반품 원인 연결](GROWTH-2-CAUSE-LINKS.ko.md), [CS 티켓](GROWTH-2-CS.ko.md): 원인→여정/결정/교훈, 개인정보 없는 운영자 요약·약속 기한·지연·30일 반복 | 고객 원문 수집·발송·CS 도구 연동 |
| 32 | [마케팅 후 공헌이익·현금](GROWTH-2-PROFIT.ko.md): 대사된 비용만 합산, 하나라도 미대사면 합계 null, 순현금 계산 안 함 | 성숙 효과 판정 |
| 20·21·22 | [조건부 확장](GROWTH-2-CONDITIONAL.ko.md): Product JSON-LD, AI 답변 인용 관측(세션·주문 분리), 해외 파일럿 7점검·환율/반품 반영 단위경제(대표 결정 대기까지), MMM 52주·2채널 미만 not_run | UCP 상호운용, 실제 해외 출시, MMM 예산 배분 |
| 23·24 | 구현 안 함(`decisionRequired`로 표시) | 외부 고객 서비스 사업 결정 |

공통: 모든 변경은 캠페인 CAS·UUID 멱등·현재/추가 전용 이력/요청 영수증을 한 배치로 저장한다(`lib/growth-ledger-server.ts`). 성장 패널 각 접기 영역은 독립 오류 경계로 감싸 한 패널의 조회 실패가 탭 전체를 멈추지 않는다. 아래 표와 절은 이 증분 이전의 소스 읽기 기록으로 보존한다.

## 33카드 대조

| 카드 | 확인한 구현 근거 | 완료로 세면 안 되는 잔여 |
|---|---|---|
| 00 | `growth-stop*`, 실행/학습/프롬프트 gate, owner 중단·복구 경로 | 전체 자율 운영의 G0-B/C/D 실증, 자산·성과 조건 종합 |
| 01 | `record-kinds.ts`, 범위/CAS/이력/보존, 각 growth 모듈 | 모든 기존·신규 경로의 origin·삭제·격리 종합 실증 |
| 02 | `storefront-orders*`, `growth-order-bridge`, 운영 품목 재대사 | 실제 판매처 주문/취소/정산의 지속 수집 및 전 구간 재시작 검증 |
| 03 | `growth-catalog`, `growth-stock-readiness-server`, 단위/단일 공유 원장 | 공급자 실재고·채널 상품 동기화, 다SKU 패키지 |
| 04 | CSV preview/import와 서명 웹훅 수신 존재 | 특정 공식 판매처의 read adapter, cursor/retry, 실계정 정산 대사 |
| 05 | `growth-authority*`, 실행 위임·계정·만료·누적 한도, Buffer 직전 재확인 | 모든 실행 채널의 동일 권한 연결 및 실제 반복업무 운영 검증 |
| 06 | 수동 signal, 확정 archive import·현재 원본 검증 | 시장/검색/리뷰/자사 신호의 지속 수집과 출처별 실패 복구 |
| 07 | `growth-opportunity-board`, 가설/상품/오퍼/미션/기한 조회 | 자동 기회 발견·시즌 데이터 수집·기회 성과 검증 |
| 08 | `learning.ts` 바이럴 실험, `artifact-experiment`, Meta 사전등록/동결 | 채널 공통 판매 탐색/확증 등록 및 실행 개입 판 연결 |
| 09 | `meta-experiment*` 가명 배정·관측·중복 주문 검사 | 일반 storefront/organic 노출 분모·비구매자 포함·충돌/A-A 실증 |
| 10 | Meta 분석·source digest, `viral-stats` 콘텐츠 지표 분석 | 일반 판매 증분이익의 성숙·비용·세금·추적 유효성 연결; 바이럴 지표를 증분 매출로 승격 금지 |
| 11 | `growth-decisions*` 일일 관측 결정/행동/담당/기한 | 검증 결과→확대 카드·A8 집행 연결 |
| 12a | `growth-execution*`, `growth-publication*`, 기존 Buffer pipeline, Meta 경로 | 실계정 제한 판매·영수증·비용/주문 재조회 실증. accepted는 published가 아님 |
| 12b | 확대 판정 관련 Meta/권한 구성요소 | 검증 범위·이익·재고·누적캡을 만족하는 자율 반복/확대 end-to-end |
| 13 | 기존 `learning-server`, 규칙 등급/만료/계보, growth lesson 후보 | 성장 운영 교훈→실제 다음 제작/실행 맥락 자동 적용·효과 회수 |
| 14 | `growth-consumer*` 가명 고객·목적 동의/철회·주문 연결·재구매 적격성 | 실제 동의 수집/메시지 발송/이탈 회수·성숙 효과. 후보 적격≠발송 허가 |
| 15 | 기존 eval/prompt 후보·예산/동결 인프라 | 실제 성장 실패 원인→제한 최적화 후보 생성/시험의 연결 |
| 16 | `eval-freeze`, `prompt-registry` 평가·owner 승인·stage/promote/rollback | 제한 캠페인 판매 효과 검증. offline pass는 매출 개선이 아님; 기존 자동 승격 금지 유지 |
| 17 | `growth-reconciliation*` 실비/손실 대사·무집행 원자 해제, 예산/재고 예약 | 공급자 증빙 확정, 17b 검증 후 배분/증액 연결. unknown은 미사용/해제 가능이 아님 |
| 18 | 일반 주문 CSV/webhook 기반은 재사용 가능 | 추가 판매채널 adapter·취소/재고/정산 실계정 검증 및 채널 추가 이유 |
| 19 | `growth-demand*` 메시지/장면/접점/미션 참조 | 실제 발행·반응을 시퀀스 각 단계와 연결하고 오퍼 개정으로 회수 |
| 20 | 기존 자료·상품 사실을 활용할 기반 | GEO 인용/유입/주문 분리 관측, UCP 실제 상호운용. 조건 충족 후 |
| 21 | 기존 원장/소싱/단위경제 기반 | 국가별 상품자격·물류·반품·환율·실정산 검증. 조건 충족 후 |
| 22 | 초기 장부 데이터 기반 | 장기 시계열/변동·보정이 없으면 MMM not_run; 초기 자동 예산근거 금지 |
| 23 | 기존 owner/brand/store ACL 기반 | 외부 고객 전용 격리/입력/보고/삭제 실증. 자사 본선 완료 조건에서 제외 |
| 24 | 범용 업무/캠페인 기반 | 외부 고객 온보딩·계약·성과료 사업 결정. 자사 판매보다 우선하지 않음 |
| 25 | `growth-market` NeedInput, 기회 보드 연결·검토 순서 | 자동 NeedPattern 발견/검증. 기한·준비도 정렬은 수요/매출 예측 점수가 아님 |
| 26 | 단일SKU 오퍼·승인 가격·재고·소싱 비교 snapshot | 다SKU 번들 원가/재고 할당, 공식 공급자·실발주·실 판매면 연결 |
| 27 | DemandStep의 creator/partner, 권리·진정성·협업 조건/비용/수동 성과 | 크리에이터/파트너 계약·콘텐츠 전달·승인·실제 발행 및 성과 영수증 연결 |
| 28 | 미션/원자 예약/Buffer adapter/발행 관측·주문 귀속 | 모든 채널 큐·복구/서비스 시간 실증, 수요 단계별 개입·성과 계보 |
| 29 | `growth-journey*` 수동 병목 before/after·분모·대체 설명, 정확 이행 사건의 운영자 원인 기록 | 실제 문의/옵션추천, 상세페이지/결제 개선 실행, 원인→개선 검토 연결·순이익/환불 효과 |
| 30 | 공유 재고/출고/반품/정산 증빙·재발주 가정·운영 확인 목록, `growth-return-reasons*` 운영자 확인 원인·사건 digest·CAS/이력 | CS 티켓/고객 원문/발송·원인별 효과·약정 배송/정산 기한·공식 공급/이행 adapter·실발주 |
| 31 | growth lesson 상태 candidate/testing/reusable/retired와 결과 구분, 원인 기록의 독립 증거 계보 | 원인→개선/교훈 자동 연결, 자동 방법 수집·실제 적용 및 성공/실패/무효 회수 |
| 32 | `growth-business*`, `growth-targets*`, 결정/목표/불변 리뷰·최신 장부 비교 | 마케팅 후 공헌이익·실현 순현금·성숙 효과 종합, 실행 결과로 이어지는 일일 자율 루프 |

## 특히 구분할 현재 기능과 빈 연결

### 고객 문의·반품 원인

`growth-inventory.ts`는 ship/release/refund/return와 수량, 검수 수락, 재판매/재입고 여부를 기록한다. 금전 환불과 물리적 반품을 분리한다. `growth-operation-review.ts`는 기존 주문·품목 상태를 읽어 대사·미출고·취소/환불 후 held·공유 재고 문제를 보여준다.

추가 구현된 `growth-return-reasons.ts/server.ts`와 `/api/growth/return-reasons`는 정확한 return/refund 사건→품목(line.id)→재고와 owner/campaign/brand/store 범위를 확인한다. 원인 코드와 개인정보 없는 내부 증빙 ID를 저장하며 unknown을 허용한다. 기록은 operator_attested이고 외부 고객/공급자의 확증이 아니다. 실제 사건 의미필드·재고 단위·품목 기준의 서버 계산 digest, CAS, UUID 멱등, 현재 판/추가 전용 이력/요청 영수증 원자 저장이 있다. 원본 변경은 held로 분리하며 기존 재고·환불 원장은 수정하지 않는다. 저장 ACK와 후속 조회 실패도 구분한다.

따라서 이제 반품 원인 모델 자체가 없다고 말하면 틀리다. 남은 것은 CS 티켓·고객 원문/보존 정책·발송/응대 상태·약속 기한, 원인별 개선 효과 및 원인→병목/교훈 연결이다. `growth-journey.ts`의 hypothesis/action/handoffReason은 여전히 고객 응대 시스템이 아니다. 사건 수량은 해당 원인 때문에 발생한 수량으로 확정할 수 없고, 환불 금액을 물리 수량으로 환산하거나 사건별 수량을 무조건 합산하면 안 된다.

### 크리에이터·파트너

`growth-demand.ts`의 DemandStep에는 placement=creator/partner, partnerRole/partnerTerms/plannedCost, rightsStatus/rightsEvidence, authenticityConfirmed, performanceStatus/performanceEvidence/performanceNote가 있다. `growth-demand-server.ts`의 변경 작업은 save_sequence이고 결과는 mayExecute:false다.

이는 협업 계획과 운영자 성과 메모다. 실제 담당자에게 연락·전송·발행·지급하거나 provider receipt를 증명하지 않는다. own-media Buffer 경로를 크리에이터 계정 권한으로 확대 해석해서는 안 된다.

### 상세페이지 실제 변경

`growth-catalog.ts`의 OfferInput은 landingUrl과 purchaseReason을 보관한다. `growth-journey.ts`는 action/appliedAt/factEvidence와 전후 수치를 기록한다. 기존 artifact/copy pack은 생성·검토·승인 가능하고 execution-server는 승인 카피를 Buffer 캡션으로 연결한다.

이번 조사 범위에서 growth 오퍼/병목 수정안을 판매처 상품 상세페이지 revision으로 배포하고 재조회·롤백하는 adapter는 확인되지 않았다. appliedAt 입력과 artifact 승인만으로 실제 페이지가 바뀌었다고 보고하면 안 된다. 가맹 리드용 흐름도 소비자 구매 판매면의 대체 증거가 아니다.

### 일반 주문 수집·실험·자율 루프

`app/api/storefront-orders/route.ts`는 관리자 CSV previewKey/import 원자 경로다. `app/api/storefront-webhooks/[id]/route.ts`는 서명/시각/연결 판/owner 잠금으로 같은 prepareStorefrontImport를 재사용한다. 따라서 일반 주문 수신 코드가 없다고 말하면 틀리다. 다만 자체 웹훅은 특정 공식 판매처의 실계정 pull/cursor adapter 검증과 다르다.

`learning.ts`의 실험은 share_rate/completion_rate/click_rate 중심이고 `meta-experiment*`에는 사전등록, 가명 배정, 주문 연결·비용 관측 및 평가가 있다. 이 자산을 복제하지 말고 재사용하되 Meta 범위를 제거하는 것만으로 범용 구매 실험이 되는 것은 아니다. 실제 개입·노출·미구매 분모·귀속 시간·환불 성숙·추적 충돌을 연결해야 한다.

기존 연구/학습 job·poll/recover는 있다. 계획 문서의 일/주 운영 주기가 이미 실행되는 성장 자율 scheduler라는 증거는 아니다. 기록 가능한 nextAction, 기회 정렬, owner stop만으로 대표 지시 없는 판매 개선 루프가 완료되지는 않는다.

## 다음 개발 권고: 3개 증분

### 1. 수요 시퀀스 단계 ↔ 기존 발행/관측 근거 연결 (우선)

대상 G2-19/27/28/11. 기존 growth_demand의 정확한 sequenceVersion/stepId와 기존 growth_publication link/관측을 연결한다. 새 수동 성과 폼 대신 서버가 원 발행/측정/주문 근거를 가져오며, 사용자 수동 performanceNote와 구분한다. own-media organic 한 경로부터 시작한다.

- 재사용: growth-demand-server, growth-publication-server, growth-publication-observation-server, growth-decisions-server.
- 필수: 동일 owner/brand/store/campaign/mission/offer 판, 정확 step와 발행 관계, source 변경 시 stale, failed/pending/null 보류, published와 accepted 구분, 데이터 기간 구분.
- 결과는 다음 오퍼/메시지 수정의 검토 근거다. 자동 가격 변경·인과 성공 라벨·외부 게시 없음. 기존 수정 UI로 정확 기록 이동.
- 수용: 정상 발행별 근거가 시퀀스에 나타나고 다른 step/구판/타범위/미확인 source가 승격되지 않는다. creator/partner는 승인된 자체 발행 증거와 혼동하지 않는다.

### 2. 상세페이지 수정안 ↔ 검토 가능한 산출물/실제 적용 영수증 분리

대상 G2-26/29/12a. 우선 오퍼/상품사실/기존 승인 카피의 정확 판으로 상세페이지 변경안을 만들고 diff·미리보기 및 원본 판을 동결한다. 실제 판매처 adapter가 정해지기 전에는 내부 검토 산출물로만 남긴다. 외부 페이지 수정은 별도 실행 권한과 adapter 준비 후 낙관적 잠금·발행 receipt·재조회·롤백으로 연결한다.

- 재사용: artifact/copy pack 승인, brand facts, growth catalog/offer/journey, 기존 execution 권한·unknown 복구 패턴.
- 필수: 가격/재고/권리 무단 승격 금지, 구판 사실 차단, 실제 적용 전 applied로 표시 금지, 롤백 기준 보존.
- 수용: 준비된 수정안과 실제 적용 여부가 화면·API에서 분리되고, raw appliedAt 입력만으로 효과 평가의 확정 근거가 되지 않는다.

### 3. 저장된 반품 원인 → 기존 병목/개선 검토 연결

대상 G2-30/29/31. 이미 구현한 원인 입력 폼을 다시 만들지 않는다. 현재 원본 검증이 가능한 원인 기록의 정확한 recordVersion/event snapshot을 기존 JourneyBlocker/Decision/SkillLesson 검토에 연결한다. 원인 분류는 운영자 확인 관측으로 유지하고, 코드별 빈도·비중을 계산하려면 관측기간과 사건/품목/주문 중 어떤 분모인지 먼저 고정한다.

- 재사용: growth-return-reasons-server, growth-operation-review, growth-journey-server, growth-decisions-server.
- 필수: 동일 campaign/brand/store·품목/상품 계보, source held/구판 전파, unknown 원인 유지, return/refund 동일 품목의 중복 집계 방지, 근거 수정 시 재검토.
- 가장 작은 결과는 원인 기록에서 해당 상품·오퍼·병목을 여는 정확 연결과 서버 근거 스냅샷이다. 자동 고객 응대·환불·재고 해제·가격 수정·학습 규칙 승격은 포함하지 않는다.
- 수용: 유효한 특정 사건 원인이 개선 검토에 나타나되 원본 변경 시 보류되며, 원인 빈도를 결함률/인과 효과나 확정 수요로 표시하지 않는다. 자동 교훈 적용과 원인별 개선 효과는 이후 별도 검증이다.

세 증분 이후에 범용 실험과 자율 반복 실행을 연결한다. 공식 주문 adapter는 실제 사용할 판매처·계정·권한이 확보되면 우선순위를 올릴 수 있지만, 미확보 상태에서 실계정 검증 완료로 계산하지 않는다.

## 유지해야 할 검증 경계

- 로컬/모의 provider 테스트는 실제 Buffer·Meta·판매처·은행 실행 증거가 아니다.
- 공급자 accepted, published, 관측됨, 귀속 주문, 증분 매출은 각각 다른 상태다.
- 마케팅 전 공헌이익과 마케팅 후 이익, 주문 장부와 실제 수령 현금/순현금은 다르다. growth-business는 미확인 이익/현금을 null로 유지한다.
- source stale/철회/실패·unknown·빈 분모는 0이나 성공으로 바꾸지 않는다.
- 공유 재고 부족은 캠페인별 부족량이 아니며 projection orderId는 growth line ID다.
- 데이터 조회 오류가 기존 주문 수집·비용 대사·중단·복구·안전 해제 경로를 막지 않도록 한다.
- 이번 후속은 return-reasons 구현까지 반영한 계획 초안이다. 새로운 production 권한·비용·발송·발주 허가를 부여하지 않는다.
