# COLLECTIVE 현재 상태

> 레인·게시 담당·공유 파일 순서는 [세션별 레인](LANES.ko.md)이 정한다. 각 레인은 아래 자기 칸만 고친다. 아래 '이전 기록' 절들은 2026-09-26 레인 도입 전의 공용 기록이다.

## 성장2 원안 전체 재개 (2026-09-30 · Codex)

- 대표 지시 “성장2의 원래 개발계획 전체를 개발 지속하라.” `codex/growth2-full`, 기준 `8cc2942`. 아래 과거 “성장2 필수 개발 종료”는 **Meta M0~M6에 한정된 판정**이다. 원안 전체는 미완료다.
- [전체 원안 카드](GROWTH-2-PLAN.ko.md)를 기준으로 [첫 공통 기반](GROWTH-2-WORKSPACE.ko.md)을 구현했다. 상품·오퍼, 시장 근거·고객 기회, 판매 미션, 소유자 위임·누적 예산 예약, 캠페인 주문 장부 집계를 성장·판매 탭에서 연결한다. 로컬 준비 기록과 실제 매출·집행·효과 검증은 분리한다.
- 로컬 검증 passed: 전체233/233 suites·14,504 assertions(외부 mocked), 최종 삭제 보호 회귀 추가 뒤 위임 API72 passed(real memory SQL, 외부 호출0), 전체 브라우저108 passed(real local Chromium/D1, 인증·외부 mocked). 타입·빌드·프롬프트22 passed, lint 기준선70 errors/39 warnings 유지. 신규 비즈니스 모듈7개 native V8 named function84/85(98.8%; line/branch 지표 아님). 코드/보안 재검토 HIGH/MEDIUM 잔여0(신규 변경 범위).
- 첫 공통 기반 #266은 `d2a2507`로 merged. published/runtime-verified는 아니다. 실제 외부 실행·정산·매출 효과는 not_run이며 원안 전체는 미완료다. 주문·재고·정산 후속 증분은 바로 아래에 기록한다.

### 주문·재고·정산 후속 (2026-09-30 · Codex)

- 첫 공통 기반은 [#266](https://github.com/roybeee/Collective/pull/266), `c40ebd7`. 원격 CI verify/e2e-smoke 모두 passed. 후속은 이 커밋 위 `codex/growth2-fulfillment`이며 [운영 계약](GROWTH-2-OPERATIONS.ko.md)을 따른다.
- 공유 실물 재고·미션 예약/해제·기존 주문 품목 연결·출고/환불/반품·지급예정/입금 증빙 UI/API를 구현했다. 재고 사건 멱등/CAS, 결과 불명 예약 유지, 기존 판매 스냅샷 보존, 원 주문 금액 한도, 0원 정상 주문 이행, 정산 수정 이력을 검증했다. 원안 G2-02/03/30/32의 부분 구현이다.
- passed: 전체237/237 suites·14,684 assertions(외부 mocked); 전용 재고88·주문연결19·운영API45·정산27(real pure/memory SQL, 외부 호출0). 최종 성장 브라우저6 passed(real local Chromium/D1, 인증 fixture), 정산 UI 저장/수정판·모바일 화면 경계 포함. 타입·빌드·프롬프트22 passed, lint 기준선70/39 유지. 신규 도메인4개 V8 named function62/63=98.4%(line/branch 지표 아님). 코드/보안 리뷰 HIGH/MEDIUM 잔여0, 발견한 재대사·수수료·출고 경계 수정 후 재검증.
- 주문·재고·정산 #267은 `f019510`로 merged. 원격 verify/e2e-smoke 모두 passed, 병합 tree와 검증된 `b0a1912`의 diff0. published/runtime-verified는 아니다. 외부몰·택배·은행 쓰기/조회와 실판매 효과는 not_run. 다음 원안 본선은 수요 시퀀스·구매 병목·일일 결정/운영 교훈·재구매와 일반 판매 실행 연결이다. 공식 정산·CS/재발주와 범용 실험·검증 확대도 남아 있다.

### 수요 시퀀스 후속 (2026-09-30 · Codex)

- 자동 재개 지시에 따라 main `f019510` 기준 `codex/growth2-demand`에서 원안 G2-27의 순서형 메시지·사용 장면·소재/검색어/대상·크리에이터/파트너 조건·비용·권리/진정성·관측 근거를 구현했다. [계약과 잔여](GROWTH-2-DEMAND.ko.md).
- 현재 오퍼·미션과 상위 근거의 준비도를 재사용하며 변경 시 무효화한다. 캠페인/시퀀스 CAS, 동일 요청 멱등성, 추가 전용 이력, 500개 쓰기 전 한도, 역할/소유자 격리와 충돌 입력 보존을 적용했다. 준비돼도 mayExecute=false이며 원안 전체/실제 수요 검증 완료가 아니다.
- passed: 전체239/239 suites·14,834 assertions(외부 mocked). 전용 도메인117/API33(real pure/memory SQL, 외부 호출0). 성장 브라우저 기존6+신규 수요2 passed(real local Chromium/D1, 인증 fixture): 순서 저장·재조회, null/0, 동시 수정 입력 보존, 모바일/데스크톱 너비. 신규 검사 최초 textarea label 선택 실패는 접근성 role locator로 수정 후 재통과(앱 데이터는 정상 보존). 타입·빌드·프롬프트22 passed, lint gate 기존70/39 유지. 신규 도메인/서버 V8 named function24/24(100%; line/branch 지표 아님).
- 코드 리뷰에서 진정성 확인 누락을 발견해 수정했고 재검증했다. 이 증분은 게시되지 않았으며 실제 채널 발행·반응 수집·협업 발송은 not_run. 다음 본선은 구매 병목(G2-29)·일일 결정/운영 교훈(G2-11/31/32)과 실행 연결이다. 소비자 동의/재구매·조건부 나머지 카드도 원안에 유지한다.

### 구매 병목 후속 (2026-09-30 · Codex)
갱신: 2026-09-30 03:57 UTC

- 수요 시퀀스 [#268](https://github.com/roybeee/Collective/pull/268)은 원격 verify/e2e-smoke 모두 passed 뒤 main `bdda24e`로 merged. 검증된 head `378983d`와 병합 tree diff0. Sites 게시와 운영 버전 검증은 이번 실행에서 not_run.
- 구매 병목 #269는 CI 성공 뒤 `a733099`로 merged. 이번 후속 실행에서 #266~269를 Sites68로 published/runtime-verified 했다. [게시 증거](releases/2026-09-30-a733099.md).
- `codex/growth2-journey`, 기준 `bdda24e`: 원안 G2-29의 [구매 병목 관측·수정 계획](GROWTH-2-JOURNEY.ko.md)을 구현했다. 유입~배송 단계, 분모·채널·기기·집단, 전후 관측기간·출처·집계 지연·추적 상태, 대체 설명, 조치·담당·기한과 현재 오퍼/미션 판을 연결한다.
- 수동 관측의 전환율·환불률·공헌이익 차이를 구분하고 null/0·음수 이익을 보존한다. 미래/미성숙·추적 불명·불일치 관측창·상위 변경/미션 unknown에서는 차이를 숨긴다. 인과/자동 해결·확대 판정과 외부 실행은 제공하지 않는다.
- 전용 도메인132/API43 passed(순수 로직·메모리 SQL 실행, 인증/외부 runtime mocked, 외부 호출0). 모바일/데스크톱 성장 브라우저10 passed(real local Chromium/D1, 인증 fixture): 새 병목2+기존 수요/이행/성장8, 저장·재조회·null/0·음수 이익·충돌 입력 보존·화면 너비. 타입·빌드·프롬프트22 passed, 최종 lint70 errors/39 warnings 기준선 유지. 병렬 편집 도중 첫 lint에서 경고1 증가를 보고했으며 최종 파일로 재실행해 기준선 통과. 신규 도메인/서버 V8 named function27/27(100%; line/branch 지표 아님).
- 코드/보안 리뷰 HIGH/MEDIUM 잔여0. 전체241/241 suites·15,009 assertions passed(외부 mocked). G2-29 전체의 자동수집·실제 상담/추천·판매면 수정/실개선 검증은 잔여다. 다음은 G2-11/31/32 일일 결정·운영 교훈·30일 리뷰, 이어 G2-28/12a 일반 판매 실행과 G2-14 동의 기반 재구매다. 전체33개 카드 완료가 아니다.

### 일일 결정·운영 교훈 후속 (2026-09-30 · Codex)
갱신: 2026-09-30 05:05 UTC

- main `a733099`에서 `codex/growth2-decisions`: [G2-11/31/32 부분 구현](GROWTH-2-DECISIONS.ko.md). 유지/수정/중단/탐색/확대 검토, 관측과 대체 설명·다음 행동·담당·기한을 미션/병목에 연결하고 서버가 근거·사업 집계 스냅샷과 digest를 고정한다. 클라이언트 성과값은 스냅샷에 쓰지 않는다.
- 교훈 후보/시험/재사용/퇴역, 성공/실패/무효·근거 등급·적용 범위·시험/반증·폐기조건·손실 한도·만료를 기록한다. 실패 미션의 재발 방지 학습을 허용하며, 기존 learning origin/active 경로를 변경하지 않는다. 외부 실행·자동확대·규칙승격·인과판정은 비활성이다.
- 리뷰에서 미션 상위 오퍼 변경이 재사용에 반영되지 않는 MED를 발견, RED 재현 후 오퍼→상품/사실·니즈→시장 근거까지 변경/삭제 검사를 보완했다. 재검토 HIGH/MED 잔여0. 현재/추가 전용 이력 batch, ACL·CSRF·CAS·멱등·각500개 상한, 과거 미션의 비밀문구 스냅샷 재검증을 적용했다.
- 전용 도메인145/API56 passed(real pure/로컬 메모리 SQL, 인증·외부 mocked, 외부 호출0). 최종 전체243/243 suites·15,210 assertions passed(외부 mocked). 최초 전체 검사는 레코드 종류 스캐너의 동적 kind 미인식으로242/243 failed였고, 실제 사용하는 kind 맵으로 정리한 뒤 전체 재실행해 통과했다. 성장 브라우저12 passed 뒤 최종 참조검사 수정본의 결정·교훈2 재통과(real Chromium/로컬 D1, 인증 fixture). 최종 타입·빌드·프롬프트22·lint70/39 passed. 신규 도메인/서버 named function32/32(100%; line/branch 지표 아님).
- #270은 `771d348`로 merged. 2026-09-30 06:54 UTC Sites69 published/runtime-verified: [게시 증거](releases/2026-09-30-771d348.md). 자동 일일 운영·독립 평가/학습 적용 결과·사업 목표/30일 리뷰·일반 판매 집행·동의 재구매는 잔여이며 계속 개발한다.

### 일반 판매 실행 준비 후속 (2026-09-30 · Codex)
갱신: 2026-09-30 07:03 UTC

- #270 병합 main `771d348`에서 `codex/growth2-execution`: [G2-28/12a/17a 부분 구현](GROWTH-2-EXECUTION.ko.md). 미션·위임·공유 재고의 최신 판을 확인하고 기존 예산 예약·재고 사건·실행 준비·이력을 한 batch로 저장한다. 별도 예산/재고 원장은 만들지 않는다.
- 동일 요청 멱등, 기존 예산의 정확한 채택, 기존 재고 예약 충돌, SKU 단위 수량·복구 담당·기한, 안전한 서버 스냅샷을 적용했다. 운영자 결과 기록은 미션 상태/판/이력과 원자 갱신한다. unknown 중복 준비·기존 미션 경로 우회·확정 결과 덮어쓰기를 막고 예약을 자동 해제하지 않는다. 위임 철회·캠페인 보관 뒤에도 결과 대사는 유지한다.
- 전용 도메인85/API76 passed(real pure/메모리 SQL, 인증 mocked, 외부 호출0). 실패 주입으로 예산·재고·준비/결과 이력 rollback과 동시 요청 멱등을 확인했다. 기존 위임72/운영45 passed. 최종 전체245/245 suites·15,371 assertions passed(외부 mocked). 초기244/244 통과 뒤 추가한 도메인·최종 회귀를 포함해 전체 재검증했다.
- 성장 브라우저14 passed, 최종 충돌 입력 보존·재조회·terminal·증빙 이력2 passed(real Chromium/로컬 D1, 인증 fixture). 최초 추가 충돌 검사의 disabled 입력 label 선택 실패는 실제 입력 보존을 확인하고 role 선택자로 고친 뒤 재통과했다. 최종 타입·빌드·프롬프트22·lint70/39 passed. 신규 도메인/서버 named function15/15 실행(문장/분기 커버리지 아님).
- 코드·보안 재검토 HIGH/MED0. 날짜 계약·이력 표시·스냅샷 안전검사를 보완했고 secret SKU 회귀 RED→GREEN을 확인했다. 의존성 변경 없음; 별도 의존성 감사는 기존 pnpm workspace 설정으로 blocked이며 통과로 표시하지 않는다.
- #271은 `31c00a5`로 merged. Sites70 published/runtime-verified(2026-09-30 07:53 UTC): [게시 증거](releases/2026-09-30-31c00a5.md). 원안 전체는 미완료이며 실제 공급자 adapter·실비 대사/해제·전역 중단·실판매 검증은 잔여다. 다음 본선은 G2-14 소비자 동의/철회·재구매 적격성과 G2-32 사업목표/30일 리뷰이며 자동 개발을 유지한다.

### 소비자 동의·재구매 후속 (2026-09-30 · Codex)

- main `31c00a5` 기준 `codex/growth2-consumer`: G2-14 부분 구현. 브랜드별 가명 소비자, 동일인 연결/구매 후 관리/마케팅·재구매 목적별 동의·철회, 현재 지점 주문 연결, 대기일 기준 재구매 검토를 구현했다. [계약과 잔여](GROWTH-2-CONSUMER.ko.md). 실제 동의 수집·고객 연락·재구매율/이탈 효과 검증은 not_run이며 원안 전체는 미완료다.
- 관리자·브랜드 경계, 동시 수정/CAS·멱등 재시도, 추가 전용 이력, 원자 삭제와 재활성화 방지 tombstone을 적용했다. 동일인 동의 철회 시 구매정보를 숨기고, 새 동의 뒤 과거 철회 요청 재전송은 최신 상태를 보존한다. 주문 조회 한도에도 철회·삭제는 유지하며 원 주문은 삭제하지 않는다. 다른 소비자 선택 시 이전 입력을 초기화한다.
- 전용 도메인33/API57/모델·가맹 경계12 passed(real pure/memory SQL, 인증·모델 mocked, 외부 호출0). 모바일·데스크톱 브라우저2 passed(real Chromium/local D1, 인증 fixture·GET 실패 주입 mocked), 최종 타입·빌드 passed, lint 기준선70/39 유지. 신규 도메인/서버 V8 named function21/21 실행(문장/분기 커버리지 아님). 코드·보안 검토 잔여 HIGH/MED0.
- 초기 전체 검사는 마지막 철회 회귀 수정 중 실행되어247/248 failed였다. 최종 소스 전체248/248 suites·15,473 assertions passed(외부 mocked), 프롬프트22 passed, staged gitleaks 약76KB 유출0. #272는 원격 verify/e2e-smoke passed 뒤 `9570ffc`로 merged. Sites71 published/runtime-verified(2026-09-30 08:53 UTC), [게시 증거](releases/2026-09-30-9570ffc.md). 다음 본선은 G2-32 사업목표·30일 리뷰 및 원안 전체 잔여 개발이다.

### 사업목표·30일 리뷰 후속 (2026-09-30 · Codex)

- main `9570ffc` 기준 `codex/growth2-targets`: [G2-32 부분 구현](GROWTH-2-TARGETS.ko.md). 잠정/확정 사업목표, 기준선·절대목표·기간·분모·책임자·손실/중단 조건과 개정 이유를 저장한다. 최신 목표 판과 서버의 해당 기간 장부 관측·다음30일 계획을 불변 리뷰로 고정한다. 과거 실패/목표를 덮어쓰지 않으며 입력0과 미확인을 분리한다.
- 광고·제작비 미배분 공헌이익·순현금·인과·자율성과는 미확인으로 유지한다.30일 미성숙은 중간 리뷰, 불완전 목표/장부는 판단 보류다. 명시적 리뷰1건 재대조에서 정렬한 주문 ID·판 해시와 캠페인/지점 범위 변경도 확인하며, 양쪽 자료 미측정은 “동일”로 판정하지 않는다. 자동 실행/확대 권한은 부여하지 않는다.
- 전용 도메인29/API51 passed(real pure/memory SQL, 인증 mocked, 외부0), 삭제 표시80·기존 장부9·워크스페이스37 passed. 최종 타입·빌드·프롬프트22·lint 기준선70/39 passed. 신규/변경 사업모듈3개 V8 named function27/27 실행(문장/분기 커버리지 아님). 코드·보안 재검토 잔여 HIGH/MED0.
- 모바일/데스크톱 신규 E2E2와 기존 성장 회귀16 passed(real Chromium/local D1, 인증 fixture). 초기2회 실패는 선택상자/저장된 textarea의 exact label locator 대기였고 role locator로 수정 후 입력 보존·목표/리뷰 개정·장부 대조 모두 통과했다. 초기 전체250/250 suites·15,549 assertions passed 뒤 미측정 비교 회귀4개를 추가했고 최종 전체250/250 suites·15,553 assertions passed(외부 mocked). staged gitleaks 약73KB 유출0.
- #273은 원격 CI verify/e2e-smoke passed 뒤 `4cd3df1`로 merged. Sites72 published/runtime-verified(2026-09-30 09:54 UTC), [게시 증거](releases/2026-09-30-4cd3df1.md). 다음 본선은 G2-17a 기존 예약의 실비/손실 대사·무집행 취소 원자 해제, 이어 전역 중단이다. 공식 정산·실제 공급자 실행/비용 확인·성숙 재구매·검증 확대와 원안 전체 잔여는 계속 추적한다.

### 실비·손실 대사와 무집행 취소 후속 (2026-09-30 · Codex)

- main `4cd3df1` 기준 `codex/growth2-reconciliation`: [G2-17a 부분 구현](GROWTH-2-RECONCILIATION.ko.md). 기존 예산·재고 장부에 부분/최종 누적 실비·손실 대사와 무집행 취소를 연결했다. null/0 보존, 누적금액 하향 방지, 최종 잔여 의무 확인, 미배정·미출고 전체 예약만 원자 해제한다. 운영자 확인이며 실제 공급자 검증은 not_run이다.
- 위임/기간을 바꿔도 같은 계정의 누적 탐색손실을 유지한다. 예약 초과 실제 비용도 기록하고 신규 한도에 반영한다. 캠페인 보관·위임 철회 후 대사와 동일 UUID 재시도, 버전 충돌 입력 보존, 삭제 후 이력 보존을 적용했다.
- 독립 코드/보안 리뷰에서 무관 주문 조회 한도 때문에 대사까지 막히는 MED1을 발견했다. 정확한 참조 저장과 전체 조회를 분리하고, 주문1001건에서 부분/최종 대사·무집행 취소·중복 재시도 회귀를 통과했다. 저장 후 조회 실패는 성공 확인으로 반환하고 화면은 최신 조회 전 추가 쓰기를 보류한다. 재검토 HIGH/MED0.
- 전체252/252 suites·15,619 assertions passed(외부 mocked). 이후 최종 대사 회귀2개를 추가한 전용 API43과 도메인25 passed(real memory SQL/pure, 인증 mocked, 외부 호출0), 기존 실행API76 passed. 신규 도메인/서버 V8 named function10/11 실행(90.9%; 문장/분기 커버리지 아님). 프롬프트22 passed. 신규/기존 성장 E2E10 passed 뒤 최종 저장 확인/조회 실패 복구 변경 경로 E2E2 passed(real Chromium/local D1, 인증·응답 유실/조회 실패 주입 mocked). 최종 타입·빌드 passed, lint 기준선70/39 유지, staged gitleaks 약62KB 유출0.
- #274는 CI verify/e2e-smoke passed 뒤 `96402c7`로 merged. Sites73 published/runtime-verified(2026-09-30 10:55 UTC), [게시 증거](releases/2026-09-30-96402c7.md). 다음 본선은 owner 단위 전역 중단: 일반 예산/재고 예약, Buffer 게시, Meta 예약/ACTIVE, 일반·Meta 학습 적용 및 프롬프트 승격의 실제 서버 진입점에 공통 검사. 주문 수집·대사·감사·PAUSED/정산/불확실 결과 복구는 유지하고 이미 진행 중인 외부 요청은 별도로 추적한다. 공유 파일 소유권을 확인한 뒤 착수하며 재개만으로 자동 재전송하지 않는다. 원안33개 전체는 미완료다.

### 작업공간 전역 중단 후속 (2026-09-30 · Codex)

- 대표의 3시간 집중 개발 지시: 2026-09-30 10:51:55~13:51:55 UTC(한국시간22:51:55까지). `collective-2`를15분 재개로 갱신했다. 종료 때 진행 변경을 저장하고 실제 결과를 보고한다.
- main `96402c7` 기준 `codex/growth2-global-stop`: [전역 중단 계약](GROWTH-2-GLOBAL-STOP.ko.md). owner 작업공간 전체 신규 예산·재고 예약, 게시 승인/접수, Meta 예약/활성화, 학습 채택·연장·프롬프트 적용을 차단한다. 관리자 중단/소유자 재개, owner 잠금·CAS·UUID·추가 전용 이력·손상/조회 실패 차단을 적용했다. 점포 회고·기존 비용 대사·정지·정산·복구는 유지한다.
- 이미 전송 중인 Buffer 결과를 보존하고 전송 전 중단이면 공급자 호출0으로 기록한다. Meta ACTIVE 중 중단되면 추가 활성화는 막고 불확실 상태를 유지하며 이후 PAUSED·정산·예약 해제가 가능하다. 중단 자체가 외부 취소 완료나 예산/재고 해제를 뜻하지 않으며 재개 자동 재전송은 없다. Q 프롬프트 엔진은 유지하고 API 기존 잠금 안에 가드만 추가했다.
- 전체256/256 suites·15,692 assertions passed(외부 mocked), 이후 추가한 전용 Buffer경합17/Meta경합8/중단중대사복구43 passed(real SQLite, 공급자 mocked, 실제 외부0). 중단 중 실제 주문 저장·부분/전액 환불 정정 API8 passed(real memory SQLite, 인증 mocked). 기본 전용 domain13/API27/entrygate12/학습19, 기존 learning148/stores141/prompts71/Meta실험34 passed. 기존 MetaAPI24/Bufferloop171/실행76/위임API72 passed. entrygate의 복구 항목은 정상 성공이 아니라 중단 차단을 건너뛰는 검증이며, 실제 성공은 별도 복구회귀로 검증했다.
- 신규 중단 E2E2+기존 실행/대사4=6 passed(real Chromium/local D1, 인증·응답 유실 mocked). 최종 타입·빌드·프롬프트22 passed, lint 기준선70/39 유지. 신규 핵심2모듈 V8 named function7/7 실행(문장/분기 아님). 독립 코드/명세/보안 재검토 HIGH/MED0.
- PR #275 첫 원격 CI는 추가 회귀 파일의 미사용 변수2개로 lint70/41 failed, e2e-smoke는 passed였다. 테스트의 미사용 선언만 제거했고 Buffer17/Meta8과 lint70/39를 재실행해 passed했다. 원격 재검증 결과는 별도로 확인한다.
- 아직 미게시. 다음 증분은 G2-26 단일 SKU 소싱 후보의 원가·MOQ·납기 비교와 발주 검토안이며 실제 발주·계약·결제는 수행하지 않는다. 다SKU 번들·공급자 실연동·검증 확대 등 원안 전체 잔여를 계속한다.

### 공급 후보·소싱 비교 후속 (2026-09-30 · Codex)
갱신: 2026-09-30 11:22 UTC

- main `96402c7` 기준 `codex/growth2-sourcing`: [G2-26 단일 SKU 소싱 비교](GROWTH-2-SOURCING.ko.md). 공급 후보 원가·MOQ·납기·배송/부대비·세금·단위·증빙·유효일과 견적 개정 이력을 저장한다. 현재 상품·후보·공유 재고 판을 고정한 불변 비교이며 최저가 자동 채택이나 실제 발주 권한을 부여하지 않는다.
- 단위가 다르면 수량·금액을 보류하고, 예약 초과 부족분을 포함한 가상 입고 영향을 계산한다. 현재 참조 변경·시간 경과 만료는 과거 평가를 덮지 않고 표시한다. 관리자/owner 경계, CAS·UUID·원자 저장·한도·삭제 보존을 적용했다. 기존 예산·재고·가격·정산 원장은 변경하지 않는다.
- 코드/보안 리뷰에서 단위 혼합 계산·상품 ISO 만료·긴 배송/반품 조건의 조회 거부를 발견해 RED→GREEN 수정했다. 최종 HIGH/MED0. 도메인34/API39 passed(real pure/memory SQLite, 인증 mocked, 외부0), 전체254/254 suites·15,694 assertions passed(외부 mocked). 신규2모듈 V8 named function30/30 실행(문장/분기 지표 아님).
- 타입·빌드·프롬프트22·lint 기존70/39 passed. 소싱 신규2+기존 워크스페이스4=E2E6 passed(real Chromium/local D1, 인증·응답 유실 주입 mocked). 최종 서버 문자 길이 보완 뒤 빌드 재통과. 전역중단 #275의 `24b2814`를 로컬 통합한 뒤 전체262/262 suites·15,841 assertions, 타입·빌드·lint70/39 및 소싱2/중단2/워크스페이스4 총E2E8 passed. 신규 소싱 기능은 아직 미게시이며 원안 전체는 미완료다.
- 다음은 G2-30의 재발주 수량/시점·구매비 검토다. 실제 SKU 판매속도와 명시적 수요 가정, 미입고 발주 상태, 검토 한도와 현금 잔고를 분리하고 외부 발주는 수행하지 않는다.

### 재발주 수량·시점·구매비 검토 후속 (2026-09-30 · Codex)
갱신: 2026-09-30 11:36 UTC

- `codex/growth2-reorder`, main `96402c7`에서 소싱 `4095478`을 의존 통합해 [G2-30 재발주 검토](GROWTH-2-REORDER.ko.md)를 구현했다. 운영자 수요 가정·납기·안전재고·추가 확보기간과 현재 공유 재고를 연결한다. 예약 부족분을 보존하고 미입고 발주 없음의 당일 확인·근거가 있어야 구매수량을 제시한다.
- 필요량0이면 MOQ·고정배송비 없이 수량/비용0, 세금 별도면 견적 소계와 실제 현금소요 미확인을 구분한다. 비용 한도는 은행 잔고나 예산 위임이 아니다. 실제 발주·입고·가격·예산·정산 변경은 없으며 `mayOrder:false`다. 평가 시각·입력·상품·견적·재고 판과 평가를 불변 보존하고 현재 변경/시간 만료는 별도 표시한다.
- 전용 domain35/API34 passed(real pure/memory SQLite, 인증 mocked, 외부0), 전체256/256 suites·15,763 assertions passed(외부 mocked). 단위/수요0·납기·MOQ·overflow·한도·기존 예약 부족·다른 캠페인 예약·CAS/UUID·원자 rollback·용량200·보관/역할 경계 회귀 포함. ISO 시차 범위·정확 평가시각·지점 브랜드 변경은 RED→GREEN. 독립 리뷰 HIGH/MED0.
- 타입·빌드·프롬프트22·lint 기존70/39 passed. 재발주2+소싱2=E2E4 passed(real Chromium/local D1, 인증·응답 유실 주입 mocked), null→0·입력 보존·다른 후보 선택 시 근거 초기화·불변 이력·재조회/모바일 검증. 신규2모듈 V8 named function21/21 실행(문장/분기 지표 아님). 이후 전역중단과 main `e49815c`를 포함한 소싱 `3af681f` 통합에서 전체264/264 suites·15,910 assertions, 타입·빌드·lint70/39·브라우저 재발주/소싱/중단6 passed. 통합 충돌 리뷰 HIGH/MED0.
- 이 신규 검토는 아직 미게시다. #275 전역 중단은 main `e49815c`로 merged, Sites74 published/runtime-verified(11:34 UTC), [게시 증거](releases/2026-09-30-e49815c.md). #276 소싱은 별도 CI 중이다. 다음은 카탈로그 수동 수량 대신 단일 공유 재고·확인 단위로 상품/오퍼/미션 준비도를 판정하는 수정이다.

### 공유 재고 기준 상품·오퍼·미션 준비도 (2026-09-30 · Codex)
갱신: 2026-09-30 11:49 UTC

- main `e49815c`에서 소싱 검증본 `3af681f`를 의존 통합한 `codex/growth2-stock-readiness`: [공유 재고 준비도](GROWTH-2-STOCK-READINESS.ko.md). 카탈로그 수동 수량은 참고로만 두고, 확인한 상품 단위와 현재 단일 매장·SKU 원장으로 준비도를 판정한다. 다른 캠페인 예약도 차감하며 다른 지점·중복·단위 불일치·미확인·조회 오류는 보류한다.
- 신규 주문 할당의 piece/pack 우회와 소싱의 명시 상품 단위 누락을 독립 리뷰에서 발견해 RED→GREEN 수정했다. 기존 실제 주문의 부족/미확인 재고 기록, 출고/정정·비용 대사·해제는 유지한다. 손상 원장/조회 실패는 준비도 보류이며 기존 수동 수량으로 대체하지 않는다. 추가 원장·외부 실행·현금 변경은 없다.
- stock 도메인10/API22, catalog124/workspace37/execution76/authority72/reconciliation43/stop recovery43/operations49/demand33/journey43/sourcing35/API41, 총13개 전용·기존회귀 파일 passed(real pure/memory SQLite, 인증/외부 mocked, 외부0). 전체264/264 suites·15,880 assertions passed. 새 helper V8 named function5/5 실행(문장·분기 지표 아님). 최종 독립 HIGH/MED0.
- 타입·빌드·프롬프트22 passed. 최초 lint 미사용 테스트 선언1 경고증가를 제거하고 최종70 errors/39 warnings 기준선 passed. E2E 신규stock2/워크스페이스4/운영2/실행2/대사2 총12 passed(real Chromium/local D1, 인증·기존 대사 응답실패 주입 mocked). 실제 원장 재고가 있어 수동0에서도 준비, 다른 캠페인 예약 후 가용0이면 수동100으로도 보류, 단위·상품판 재연결·CAS입력보존·모바일을 확인했다.
- 재발주 통합 후 명시 상품 단위 불일치 시 구매수량·시점·현금 모두 null 보류하는 회귀2개를 추가했다. 통합 전체266/266 suites·15,951 assertions, 타입·빌드·관련8파일 E2E18 passed(real Chromium/local D1, 인증/기존 복구 실패 주입 mocked), 독립 통합 리뷰 HIGH/MED0. 이 준비도 변경은 아직 미게시이며 전체 성장2 원안은 미완료다.
- #276 소싱은 main `25f370b`로 merged, Sites75 published/runtime-verified(11:52 UTC), [게시 증거](releases/2026-09-30-25f370b.md). #277 재발주는 원격 CI4개 passed 뒤 main `a652d29`로 merged, 아직 미게시다.

### 자연 유입 미션과 기존 Buffer 발행 연결 (2026-09-30 · Codex)
갱신: 2026-09-30 12:25 UTC

- 검증된 재발주·공유 재고 준비도 `841bcef` 기반 `codex/growth2-organic-adapter`: [G2-12a/28 실행 연결](GROWTH-2-PUBLICATION.ko.md). prepared organic 미션과 승인된 미시도 발행을 관리자 1:1 연결하고 기존 Buffer 실행 진입점에서 현재 위임·채널·소재·사실·예산·정확한 전체 재고 예약을 확인한다.
- 발행 submitting과 성장 unknown을 같은 batch에 저장한다. 기존 예약을 중복 차감하지 않으며 전송 직전 철회·중단을 확인한다. 서버 발행 판의 명시 동기화, source 판 멱등, 접수/예약과 실제 게시 분리, 불확실 결과 재전송 금지, 수동 결과/무집행 해제 우회 차단을 구현했다.
- 독립 리뷰 지적: 중복 sync·승인 내용 변경·상충 결과, 게시 권한, 무관 목록 상한의 복구 차단, 오퍼 전체 수량 예약을 수정했다. exact 복구 후 전체 조회 불가 시 저장 ACK를 보존한다. 재검토 HIGH/MED0, 전용 API54/복구26 및 실제 성장·Buffer route/SQLite 통합41 passed(인증·공급자 mocked, 실제 외부0).
- 타입·빌드·프롬프트22·최종 lint70/39 passed. 신규 publication2와 기존 execution/reconciliation/stock/stop/Buffer execution10, E2E12 passed(real Chromium/local D1, 공급자 승인·상태 fixture·응답 유실/ACK mocked). UI 독립 리뷰 HIGH/MED0. 새2모듈 V8 named function21/21 실행(문장·분기 커버리지 아님), staged gitleaks 약121KB 유출0.
- 초기 lint71/40은 const 선언·미사용 test sql 2줄 수정 뒤 기준선 복구. 최초 전체270/271 suites·16,057 assertions에서 새 삭제 차단 kind의 테스트 기대 목록 누락1건을 수정했고 전용52 passed, 두 번째 전체는 테스트 중 root가 변경 목록을 stage하여 graders의 작업트리 불변 검사가 실패했다(제품 변경 없음). 이후 파일·인덱스를 고정한 최종 전체271/271 suites·16,109 assertions passed(외부 mocked). 실제 계정 게시·도달·주문·효과는 not_run이며 원안 전체는 미완료다.
- #277·278은 merged, Sites76 published/runtime-verified(12:14 UTC), [게시 증거](releases/2026-09-30-7e553b8.md).

### 발행 이후 플랫폼 관측·귀속 주문 연결 (2026-09-30 · Codex)
갱신: 2026-09-30 12:44 UTC

- #279 자연 유입 발행 연결은 원격 CI4개 passed 뒤 main `6f84979`로 merged, Sites77 published/runtime-verified했다. [게시 증거](releases/2026-09-30-6f84979.md). 별도 `codex/growth2-publication-observation`에서 [저장 관측 연결](GROWTH-2-PUBLICATION-OBSERVATION.ko.md)을 이어간다.
- 성장 link→정확 publication→실험/안→명시 source/draft, 선택 기간의 정확 게시별 귀속 주문을 조회한다. 기존 수집 성공 저장의 publicationId 소실도 실제 publication 범위를 대조해 보존하도록 수정한다. 다른 대상의 옛 연결은 승계하지 않는다.
- 전체274/274 suites·16,169 assertions passed(외부 mocked). 전용 domain29/API19/collection12와 기존 측정92/status52/publication-link35 passed(real pure/memory SQLite, 인증·공급자 mocked). 최종 타입·빌드·프롬프트22 passed, lint 기준선70/39 유지. 최종 E2E8 passed(real Chromium/local D1, 공급자 합성 fixture·조회실패 주입 mocked): 관측2+기존publication/execution/store-measurement6. 초기 브라우저2회는 기존 화면 이동 시 테스트 자료의 필수 creative/input 필드 누락으로 실패해 fixture 보완 후 통과했다.
- 독립 리뷰의 미래 수집 시각/기간·잘못된 credential 범위와 store5000 조회상한 경계를 보완했고 HIGH/MED 잔여0. staged gitleaks59KB 유출0. 신규 외부 수집·원장 저장·전환율/인과 계산은 범위 밖이다. 기존 제작·발행/성과 탭 이동을 연결했다. 현재 관측 증분은 로컬 검증 완료이며 원격 CI·게시 전이다. 전체 원안 완료가 아니다.

### 확정 시장자료와 성장 신호 연결 (2026-09-30 · Codex)
갱신: 2026-09-30 12:54 UTC

- #280 관측 증분 `8258045`는 로컬 전체274/274 suites·16,169 assertions, 타입·빌드·E2E8·lint70/39 검증 뒤 원격 CI 중이다. main #279는 Sites77 published/runtime-verified다.
- 별도 `codex/growth2-signal-source`에서 [G2-06 자료 연결](GROWTH-2-SIGNAL-SOURCES.ko.md)을 개발한다. 확정 공개 시장자료를 서버 검증 후 가져오고 원자료 판·digest와 관측 시각을 보존한다. 완료 연구의 원문 접근 근거를 확인하며 같은 원본 판 중복과 수동 계보 제거를 막는다.
- 원본 수정/제외/범위 변경·만료/조회 실패는 신호→기회→오퍼→미션과 해당 학습 계보에 보류로 전파한다. UI는 시장 단계에서 후보·검증된 요약·기한·중복·충돌을 표시한다. 가져온 근거 직접 편집은 잠그고 원자료 새 판을 명시적으로 가져온다.
- 전체276/276 suites·16,233 assertions passed(외부 mocked). 전용 domain24/API39, 기존 market50/workspace37/decisions56, kind53 passed(real pure/memory SQLite, 인증 mocked). 최종 타입·빌드·프롬프트22 passed, lint 기준선70/39 유지, staged gitleaks54KB 유출0. 독립 리뷰 HIGH/MED 잔여0.
- 신규2+기존growth-workspace4 E2E6 passed(real local D1/Archive API/Chromium). 실제 저장 후 응답 유실만 mocked하여 동일UUID 복구·구판 충돌/입력 보존·새판 재가져오기·이전held/현재current·수정 잠금·모바일을 검증했다. 초기E2E의중첩label exact locator실패는combobox role locator로수정했고최종통과했다. 외부 수집·모델·발송0, 원격 CI·게시 전이며 전체 원안 완료가 아니다.

### 고객 기회·상품·미션과 일정 연결 (2026-09-30 · Codex)
갱신: 2026-09-30 13:07 UTC

- #280 관측은 CI4개 passed 뒤 main `6c0c54f`로 merged. #281 확정 시장자료 가져오기 `230a1a6`는 검증/커밋/푸시하고 main 기준 원격 CI 중이다. 그 검증 소스를 `codex/growth2-opportunity-board`에 통합해 [G2-07/25 연결 보드](GROWTH-2-OPPORTUNITY-BOARD.ko.md)를 구현한다.
- 기존 성장 조회의 현재 준비도를 받아 고객 기회당 상품·오퍼·미션을 묶고 각각의 기한·다음 행동·담당·보류·결과 불명을 표시한다. 일정은 기회/미션 ID당1건이며 지난 기한→오늘→예정→미확인 순서다. 매출 예측이나 자동 집행 순위로 주장하지 않는다.
- 실제 기존 기록을 여는 동작은 ID/선택 판을 고정하고 미저장 입력·저장 중·오래된 조회에서는 잠근다. 종료 미션과 기존 활성수 의미를 보존한다. 같은 대상을 다시 열어도 정확한 기록을 선택하고 명시적 변경 취소로 이동 잠금을 해제한다.
- 전체277/277 suites·16,263 assertions passed(외부 mocked). 전용 순수30·기존workspace37 passed. 최종 타입·빌드·프롬프트22 passed, lint 기존70/39 유지, staged gitleaks46KB 유출0. 독립 도메인/UI 읽기 리뷰 HIGH/MED0.
- 신규2+기존workspace4 E2E6 passed(real local D1/API/Chromium, GET실패503만 mocked): 다중 오퍼 ready/held·unknown/closed·개별 기한·미확인 일정·정확 기록/A→B→A·dirty 취소·stale·모바일 검증. 외부0, 원격 CI·게시 전이며 전체 원안은 미완료다.

### 성장2 원안 잔여 15증분 (2026-09-30 · Claude 인계)
갱신: 2026-10-01 04:40 UTC

- 대표 지시 “성장계획 2 원안 전체 중 부분구현·미연결·개발 전 카드를 끝까지 개발 완료하라.” `claude/vibrant-bohr-gzwdmw`, 기준 main `2dd2f63`, Draft PR [#285](https://github.com/roybeee/Collective/pull/285). 소유·경계는 [레인 인계](LANES.ko.md)와 [잔여 대조](GROWTH-2-NEXT-GAPS.ko.md)를 따른다.
- 구현(로컬 원장·조회·검토, 모두 `mayExecute:false`): 수요 단계↔발행 근거(G2-19/27/28), 상세페이지 수정안·수동 적용 영수증·롤백(G2-26/29/12a), 반품 원인→병목/결정/교훈(G2-30/29/31), 일반 판매 실험 사전등록·배정·SRM/오염·알파 소비(G2-08/09/10), 검증 확대 게이트→소유자 예약·대사(G2-12b/17b/11), 다SKU 번들(G2-26), 크리에이터·파트너 영수증(G2-27), CS 티켓·약속 기한(G2-30), 마케팅 후 공헌이익·현금(G2-32), 교훈 적용 계보(G2-13/31), 최적화 후보↔평가·실험(G2-15/16), 자사 데이터 신호 탐지(G2-06/07/25), 일일 자율 루프(G2-00/28), 판매처 pull cursor 어댑터(G2-04/18), 조건부 GEO·해외 파일럿·MMM 타당성(G2-20/21/22).
- 새 스위치 `growth_daily_loop`·`storefront_pull` 기본 OFF. 워커 큐 `growth_daily`·`storefront_pull`은 스위치가 켜질 때만 동작한다. G2-23/24(외부 고객 서비스)는 사업 결정 전이라 구현하지 않았다.
- 로컬 검증: 신규 route 15개 passed(real memory SQLite, 인증·외부 mocked), 신규 E2E 15 specs×모바일/데스크톱 passed(real local D1/API/Chromium), tsc·build passed, lint 기준선 70/39 유지. 전체 suite는 `graders.test.mjs` 시간 단정 1건만 failed(기준 main에서도 동일, Q 소유 파일이라 미수정).
- #285는 CI4개 passed 뒤 main `aea167d`(tree `035d3b1`)로 merged(2026-09-30 22:38 UTC). 대표 지시 “1.게시하라”로 이 세션이 게시 담당이 되어 [자동 게시](publish/aea167d.md)로 Sites82 published, 공개 `/api/version/public` tree 일치로 runtime-verified([릴리스](releases/2026-09-30-aea167d.md)). 실계정·외부 판매처 pull endpoint·실제 발행·지급·고객 응대·UCP·해외 출시·효과 검증은 not_run.
- 제안(2026-10-01, 대표 지시 "UI/UX 최고 수준 기준 평가·개선 개발 계획"): [UX 2차 평가·개발 계획](UX-PLAN.ko.md)과 [계측 기준선](observations/2026-10-01-claude-ux-baseline.md), 재현 도구 `scripts/ux-audit.mjs`. 12차원 평균 2.3/5, 성장·판매 탭 열기 GET 31·axe 대비 위반 1,249노드·44px 타깃 충족 ~5%.
- 구현(2026-10-01, 대표 지시 "모두 승인한다. 끝까지 멈추지말고 진행하라", 결정 6건 승인): Draft PR [#287](https://github.com/roybeee/Collective/pull/287)에 P1~P7 1차. 성장·판매 탭 6섹션+판매 기본 기록 맨 위+패널 지연 로딩, 전역 실행 중단 → 설정 '운영 안전', 홈 '오늘의 안건'(`/api/agenda`), 성장 요약(`/api/growth/summary`), 캠페인 탭 주소(`ctab`), 명령 팔레트, 대비·44px·건너뛰기 링크, 표시 형식·문구 사전(ko/en). 새 스위치 없음. 로컬: axe critical·serious 0, 모바일 44px 98.5%, 성장 탭 GET 31→4, 메인 청크 388→155KB gz([개선 후 계측](observations/2026-10-01-claude-ux-after.md)). 재채점 2.3→3.3, 2차 잔여 8건은 [UX 계획 13절](UX-PLAN.ko.md#13-구현-결과2026-10-01-p1p7-1차). 단위 297 suites 중 296 passed(16,654 assertions)(`graders` 시간 단정 1건은 기준 main에서도 failed, Q 소유), E2E 데스크톱 85·모바일 86 passed(real local D1/API/Chromium, 인증 mocked). 첫 CI에서 모바일 `brand-interview` 2건이 failed였다. 모바일 44px 최소 너비가 글자 탭을 눌러 이웃 탭과 겹친 회귀였고, 최소 너비를 아이콘 버튼·탭·닫기 버튼으로 좁혀 고쳤다. 같은 spec을 로컬 Chromium 경로로 돌려 2건 passed. 원격 CI 재확인·게시 전.

## 게시 대기열 (레인 A만 고침, 다른 레인은 요청 줄만 더함)
- 현재 운영: #285까지 `aea167d4c26bd8cb50c44008570f38e0537e41d7`, Sites82, tree `035d3b14027333a53748d48032afdb3422c7e8ae`. 2026-09-30 23:00 UTC merged/published/runtime-verified(대표 지시 “1.게시하라”, 자동 게시 #286). 성장2 원안 잔여 15증분 포함, 새 스위치 `growth_daily_loop`·`storefront_pull` 기본 OFF. 실제 외부 실행·정산·효과 검증 not_run. [릴리스](releases/2026-09-30-aea167d.md). 직전 #280~#284(`2dd2f63`)는 Sites81로 게시됐다.
- 성장1 필수 코드 게시 대기 0건. #216·#218·#219·#225는 통합 #244로 병합·게시했다. #206·#208·#210~#214·#217·#220·#223·#231·#235·#237과 관련 문서도 현재 제품에 포함된다.
- 기존 대기열의 미병합·404 문구는 과거 상태다. R 신규 PR #234·#241·#242·#243 및 인터뷰 게시 문서 #236·#240은 별도 소유자 작업이며 성장1 필수 잔여가 아니다.
- 요청 형식: `- #PR번호 · 레인 · 급함/보통 · 새 스위치와 기본값`

## 레인 A (Claude A 세션 — 제품 기능·게시 담당)
갱신: 2026-09-30 10:55 UTC (Codex: 3시간 집중 개발·#274 게시)
- 성장2 남은 코드 구현·검토 passed. Pixel/CAPI 내구성 큐·동의/철회, 승인된 제한 집행·부모 우선 비상 정지·정산, 불변 실험 설계·무작위 배정·관측·통계 판정·규칙 승인 및 낡은 근거 차단. [요구사항별 종료 판정](GROWTH-2-CLOSEOUT.ko.md). 새 `meta_ads_capi`·`meta_ads_execution`은 기본 OFF.
- 최종 로컬 검증 passed: 전체 227/227 suites·14,123 assertions(외부 mocked), 브라우저104 + 최종 수정 뒤 핵심8(real local Chromium/D1, 외부 mocked), 이메일 인증1(real local), 타입·빌드·프롬프트22·lint 기준선70/39. Python 워커13·설치70·맵달19 passed. 새 비즈니스 모듈10개 V8 함수 커버리지141/151=93.4%(외부 mocked; 문장/분기 커버리지 아님). 코드·보안 재검토 HIGH/CRITICAL 잔여0.
- #264 소스 병합·Sites67 게시·공개 버전 일치 검증 완료. 최종 CI verify/e2e-smoke 각각 passed(227 suites·14,123 assertions, 브라우저104+인증1). 실계정/실몰 연결·고객 전송·광고 지출·효과 검증은 not_run이며 운영 접근/동의/별도 금액·기간 승인이 필요하다. 아래 과거 증분별 미구현 문구는 해당 시점의 기록이다.
- #262 통합은 merged/published/runtime-verified, CI verify와 e2e-smoke 각각 success(214 suites·13,851 assertions, 브라우저96+인증1, 맵달19). 후속 `codex/growth2-image-provenance`: 내부 PNG 원본 해시와 Meta 업로드 영수증 연결, PAUSED 광고세트/소재/광고 단계별 생성·알려진 ID 조회 복구, 기존 후보의 불변 사전등록 추가. 실제 업로드·Meta 생성·전환 전송·지출은 not_run. [원본](META-IMAGE-UPLOAD-M4.ko.md)·[하위 생성](META-AD-CREATE-M4.ko.md)·[사전등록](META-LEARNING-M6.ko.md).
- 후속 로컬 검증: 218/218 suites·13,965 assertions passed(외부 mocked), 브라우저100 passed(real local Chromium/D1, 외부 mocked), 타입·빌드·프롬프트22 passed, lint 기존70 errors/39 warnings 유지. 코드·보안 검토 passed; 연결 갱신 뒤 미송신 준비 재사용과 알려진 ID 읽기 복구 회귀 수정 포함. 원격 CI 결과는 확인 후 별도 기록한다.
- 진행: `codex/growth2-remaining`, #261 캠페인 선택 원본 통합 + M2 전환 준비·맵달 주문 어댑터 + M4 외부 구성 읽기 검증 + M5 로컬 예약 + M6 다음 실험 후보. 모바일 인터뷰 입력 유실 회귀 수정. 로컬 214/214 suites·13,851 assertions passed(외부 mocked), 타입/빌드/lint gate70·39/프롬프트22 passed. 전체 브라우저96 passed(real local Chromium/D1, 인증/외부 mocked), 이메일 인증1 passed(real local), 맵달 어댑터19 passed(real SQLite, mocked PG/HTTP). 마지막 보고 캐시 수정 뒤 전용24 assertions·타입·빌드 passed. 원격 CI/운영 게시 확인은 별도 후속.
- 첫 몰 `mapdal.kr` 확정. 원격 코드 `e7c39e7`과 공개 healthz db=pg 확인. 실제 PG 읽기·주문 전송·맵달 서버 설치 not_run. 정형 환불 근거 없는 CANCELLED/DEPOSIT_AFTER_CANCEL은 보류, 일반 MARKETING 동의를 Meta 전송 동의로 승격하지 않는다. [연결 계약](MAPDAL-INTEGRATION.ko.md).
- 이전에 미구현이던 Pixel/CAPI 전송, 실제 활성화/정지, 실험 관측·판정·규칙 승격은 이번 최종 변경에서 구현했다. 개발 검증과 실계정 운영·효과 검증은 분리한다.
- Meta M1 첫 증분 #253 merged(`e8fce70`) · Sites 56 published · 공개 tree runtime-verified. CI 199/199 suites·13,372 assertions, E2E 76+인증1 passed. [릴리스](releases/2026-09-28-e8fce70.md). 실제 계정 읽기는 토큰/계정 미제공으로 blocked이며 전체 M1 종료로 표시하지 않는다.
- M2 주문·환불 #254 merged(`27c2162`) · Sites 57 published · 공개 tree runtime-verified. CI 200/200 suites·13,404 assertions, E2E 78+인증1 passed. [릴리스](releases/2026-09-28-27c2162.md). 실몰 어댑터·웹훅·Pixel/CAPI는 후속, 외부 고객 전송 0.
- M3 소재·실험 검수 #255 merged(`8b437a0`) · Sites 58 published · 공개 tree runtime-verified. CI 201/201 suites·13,434 assertions, E2E 80+인증1 passed. [릴리스](releases/2026-09-28-8b437a0.md). 광고 생성/활성화 없음.
- M6 보고 기반 #256 merged(`991c289`) · Sites59 published · 공개 tree runtime-verified. CI 202/202 suites·13,464 assertions, E2E82+인증1 passed. [릴리스](releases/2026-09-28-991c289.md). 전체 M6 종료/효과 검증이 아니다.
- M1 수집 복구 #257 merged(`8d76730`) · Sites60 published · 공개 tree runtime-verified. CI 202/202 suites·13,476 assertions, E2E82+인증1 passed. [릴리스](releases/2026-09-28-8d76730.md). 시도/실패 지속·정상 자료 보존·같은 값의 새 수집 시각 확인, 자동 재시도 없음. 실제 계정 검증 blocked.
- M4 캠페인 첫 증분 #258 merged(`3f7adbe`) · Sites61 published · 공개 tree runtime-verified. CI205/205 suites·13,575 assertions, E2E84+인증1 passed. [릴리스](releases/2026-09-28-3f7adbe.md). 기본 꺼짐·별도 권한·PAUSED 캠페인 하나만, 실제 생성/지출 없음. 전체 M4 종료가 아니다.
- M5 로컬 예산 검토: 현재 계획·소재·계정 범위와 금액/기간·안전 여유를 대조하고 불변 검토/철회 기록. 지출 권한 없음. 로컬206/206 suites·13,610 assertions, 전용35·타입/lint70·39/프롬프트22/빌드 passed. PR #259 CI·E2E 검증 중, 별도 병합/게시. [계약](META-BUDGET-M5.ko.md). 초기 E2E의 M3 재조회/확인 경합을 보완했고 최신 #259 head를 이 브랜치에도 통합해 함께 검증한다. #259 병합 뒤 이 PR을 병합한다.
- M2 서명 웹훅: 소유자 연결/키 교체·기본 수신 꺼짐·명시 켜기, HMAC/시각·본문 한도·현재 연결 검증, 기존 CSV 장부 규칙 재사용. 로컬206/206 suites·13,617 assertions·전용42·기존 주문32 passed. 타입/lint70·39/프롬프트22/빌드 passed. [계약](STOREFRONT-WEBHOOKS.ko.md). CI/E2E 뒤 병합·게시. 실몰 서버 설정/운영 주문 수신 not_run.
- M1 캠페인 선택: 연결 계정의 이름/ID/상태를 50개씩 명시 조회하고 성과 조회 입력에 사용한다. 로컬206/206 suites·13,601 assertions·전용26+기존읽기82·타입/lint70·39/프롬프트22/빌드 passed. [계약](META-CAMPAIGN-PICKER.ko.md). #259·#260 통합 tree에서 최종 CI/E2E 확인 후 순서대로 병합한다. 실계정 목록 blocked.
- 다음: 외부 광고세트/소재/광고와 별도 지출 승인·예약 계약, 몰별 어댑터/전환·예약 수집.
- Meta UI/UX 개선 #250 `merged`(`8e9a1c7`) · Sites 55 `published` · 공개 운영 버전 tree `runtime-verified`. 네 단계 입력, 준비 상태/다음 할 일, 실시간 기여이익·구매 수, 미완성 저장·재조회. CI 198/198 suites·13,302 assertions, E2E 76+인증 1 passed. 데스크톱/모바일 화면 검토, 실제 Meta 연동·집행 not_run. [근거](releases/2026-09-28-8e9a1c7.md).
- 성장2 Meta 첫 증분: #247 `merged`(`5be1478`) · Sites 53 `published` · 소유자 운영 tree `runtime-verified`. [M0 구현](META-ADS-M0.ko.md): 캠페인 탭·준비도·계획 저장·버전 충돌·역할/소유자 격리·집행 차단. CI 198/198 suites·13,297 assertions, E2E 76+인증 1 passed. 운영 새 탭·v0 누락 안내·집행 비활성 확인(real, 읽기만). M0 실제 상품/계정/이벤트 계약 확정과 M1~M6는 후속, Meta 연동·지출·전환 전송·효과 검증 not_run. [게시 근거](releases/2026-09-28-5be1478.md).
- 성장2 계획 추가(2026-09-28 대표 요청): [E-M 자사몰·콘텐츠 기반 Meta 광고](GROWTH-2-META-ADS.ko.md). M0~M6(준비도→읽기 연결→전환/원장→소재 실험→비활성 초안→승인된 제한 집행→보고/학습), G0 개발/실집행/확대 분리. 계획 추가 뒤 후속 개발 지시로 위 M0를 착수했다. 계정 연결·광고 집행 not_run. 실제 소유 범위는 LANES에 기록.

- **성장1 개발 종료 passed / 운영 인수 blocked / 효과 검증 not_run**. C01~C12 통합·197/197 suites(13,261 assertions)·CI verify/E2E·Sites 52·소유자 운영 버전 확인 완료. [최종 종료 판정 및 조건부 인계](observations/2026-09-28-lane-a-growth1-closeout.md). 아래 09-27 중간 판정과 미병합/미게시 상태를 대체한다.
- 남은 것은 실제 게시·주문/POS·A8 보고, 개별 활성화 게이트와 Q의 24/72시간 감시다. 24h 09-29 10:23:54, 72h 10-01 10:23:54 KST. 자동 예약 생성은 하지 않았으며 담당·재개 조건·다음 확인일은 종료 기록에 있다.

- 진행 중: B3-2a 교정 신호 PR(교정 묶음 90일 5건·규칙별 파생 피드백·같은 사유 재발률, 스위치 `b3_playbook_signals` 기본 꺼짐, 경보가 열리면 `playbook_activate` 409, 토큰 0, [PLAYBOOK](PLAYBOOK.ko.md) B3-2a 절). B3-2b 선호 on/off 쌍 평가 PR(브랜치 `feat/b3-2b-preference-pair`, B3-2a 위): `POST /api/eval` `pair.kind: operator_preferences`, off=동결 요청에서 블록 뺌·on=고른 규칙만의 운영 주입 블록, 기존 `pairGate` 그대로, 초안 평가(D5), 프롬프트 활성화 근거 금지(409), 테스트 mocked·토큰 0, [PLAYBOOK](PLAYBOOK.ko.md) B3-2b 절. 레인 Q 파일(`lib/eval-server.ts`·`lib/eval-kinds.ts`·`lib/prompt-registry.ts`)을 레인 A가 고쳤고 29f7af가 리뷰한다. B3-2c 선호 쌍 평가 첨부(브랜치 `feat/b3-2c-attach-eval`, B3-2b 위): `playbook_attach_eval`(대표만, 스위치 꺼짐 409)이 끝난 선호 쌍 run을 평가한 규칙 버전에 `playbook_audit` `attach_eval`로만 남김(규칙 버전·상태 불변, `performance_tested` 계속 409), 화면에 규칙 버전별 최신 게이트, 4단계 종료 조건 절차는 [PLAYBOOK](PLAYBOOK.ko.md) B3-2c 절, 테스트 mocked·토큰 0. #160(최상위 `}` 보정·순서 되돌림) `merged`, 묶음 17 게시는 A1 dev 쌍 평가 `5528b2f9` 종료 뒤 → A3 4회차. B4 2부 #155·#157·#159 `merged`.
- A6 종료 조건: **passed · real**(2026-09-27 00:56 KST). 이문동점 영업시간 자료 요청 `dr-f08c16186f08`이 사실 확정으로 closed. [관찰 기록](observations/2026-09-27-lane-a-a6-end-condition.md). 운영 스위치 `a6_data_requests` 켜짐.
- A3 종료 조건 run: 5회째 **passed · real**(run `86349108`, 운영 `7851185` Sites 버전 44, 32,653토큰). 국밥 12 pass·0 fail, 수학학원 11 pass·0 fail(`copy_pack_variants` pass). 두 원문 모두 보정 없이 바로 JSON이었다(`+channels-close`는 이 run에서 쓰이지 않음). 1~4회 실패 기록과 결정은 [카피 팩](COPY-PACK.ko.md#a3-종료-조건-run-기록-4회). 스위치 `a3_copy_pack` 켜기는 대표 결정으로 따로 한다.
- B4 중단 규칙: 대표 결정(2026-09-27 "오늘 바로 진행해")으로 10-15 판정을 앞당겼다. 주문 CSV 0건 → **blocked**(L3·L4 운영 사용·KPI 주장 보류, 코드·L0·L1·개선 루프 대장 유지). 스위치 `b4_reward_lineage` 켜짐(대표 지시 D9), `b3_playbook_signals` 켜짐(B3 승인). [관찰 기록](observations/2026-09-27-lane-a-b4-stop-rule.md).
- **성장1 마감(GROWTH-1-CLOSEOUT)** 2026-09-27 13:08 UTC: 중간 판정 `개발 종료 blocked / 운영 인수 blocked / 효과 검증 not_run`([레인 A 마감 기록](observations/2026-09-27-lane-a-growth1-closeout.md)). 레인 A 몫(C02·C11·C12) 필수 결함 0. 4절 공통 검사 7종 passed(main `66c2ad4`). 개선 계획 95건 매핑 lost 0이고, unmapped `ux-12`는 #226으로 구현했다([매핑](observations/2026-09-27-lane-a-improvement-map.md)). 막힘: 레인 G #216·#217·#218·#219 미병합, 최종 묶음 미게시. 다음: 01:30 KST 게시 창에 대기열 묶음 게시 → 레인 G PR 병합 뒤 최종 묶음 → 판정 갱신.
- B3 4단계 종료 조건: 1~7단계 **passed · real**, 8단계 **passed · real**(캠페인 범위 `byRule`에 `@2`·대표 판정 1건). 규칙 `playbook:24e71fa4` 대표 승인 → active v2(경보 해제 뒤, 만료 11-26). ODA CMO 재작성 작업물 `ai-4fb50c2c3…` 끝에 규칙 v2 표기, 스냅샷 `operatorPreferences@2`, 개선 루프 후보 등록. 브랜드 범위 결함은 #189로 고쳐 Sites 버전 46에서 확인(`?brandId=oda` byRule `@2` 3/1/2). [관찰 기록](observations/2026-09-27-lane-a-b3-stage4.md). 스위치 `a3_copy_pack` 켜짐(대표 지시 09-27 "승인한다 진행하라", 04:49:06 UTC).
- 내부 표기 정규화: ODA CMO 재작성본 끝 '수정 요청 반영 위치'에 `revisionRequest`·`output_1` 등이 남던 문제(B3 규칙 '기술 표기 대신'과 어긋남)를 렌더 정규화로 고쳤다(#202, `+revision-labels`, Sites 버전 48 게시). 원 응답과 지시문은 그대로다.
- 레인 A 검토(#183 R5b-2, `docs/DATA-PROCESSING.ko.md` 3.5·4.1·DP-10): **받아들임**(2026-09-27 05:37 UTC). 대조 결과: 모델 입력 경계 금지 목록에 모집 모듈 4개가 있다(`tests/franchise-model-boundary.test.mjs:62`). `recruitment_import` 행에 칸 값·머리글·연락처가 없고 매핑은 열 번호만이다(`lib/franchise-lead-import-server.ts:219-221`). 리드 `imports`에 연락처·동의 해시가 없다(`:193`). 테스트 lead-import 171·lead-import-route 66·franchise-model-boundary 28 passed(mocked). 비차단 의견 2건(레인 R 후속): ① `recruitment_import`에 `receivedRange`(접수 시각 범위)도 저장되는데 3.5 표 행에 빠져 있다. ② 이 행은 제공처 라벨·동의 증빙 해시를 파기 없이 남긴다('구현된 파기 없음'). LR-2 회신 때 보존 기한을 정하도록 8절 열린 질문에 한 줄 더하길 권한다.
- 레인 A 검토(#194·#195 R6b·R6c, `docs/DATA-PROCESSING.ko.md` 3.5 행 2개): **받아들임**(2026-09-27 09:58 UTC). 대조 결과: 주간 보고는 1~4건 칸을 '5건 미만'으로 억제한다(`lib/franchise-report.ts` `SUPPRESS_BELOW=5`·`cell`). 리드별 증빙 묶음에 연락처·메모 값이 없고 `contactState`만 있다(`lib/franchise-report-server.ts:147`). 감사 `franchise_audit`는 365일이다(`lib/record-kinds.ts:134`). 모델 입력 경계 금지 목록에 `franchise-report*`·`app/franchise-report-panel.tsx`가 있다. 테스트 recruitment-report 56·franchise-report-ui 29·franchise-model-boundary 28 passed(mocked). 비차단 의견(레인 R 후속): 리드별 증빙 묶음은 연락처가 없어도 시스템 코드·접수 시각·제공처로 한 사람을 가리키는 가명 정보다. 3.5 행의 '외부로 가는가' 칸에 '가명 개인정보 파일이므로 내려받은 사람의 관리 책임'을 적길 권한다.
- 레인 A 검토(#200 결정 36·#203 결정 35, DATA-PROCESSING DP-10 예외·3.5 행): **받아들임**(2026-09-27 11:23 UTC). #200: 계약 칸만 `contractCell`로 억제에서 빠지고 나머지는 `cell`(1~4건 억제), `CONTRACT_SHOWN_NOTE`에 내려받은 파일 관리 책임(`lib/franchise-report.ts:23,61,179-191`). #203: 입력 칸 밖이면 `QUALIFICATION_TEXT`, 사유는 코드만, `QUALIFICATION_LIMIT` 50, 주간 보고 적격 수는 `cell` 억제(`lib/franchise-server.ts:624-636`, `lib/franchise-report.ts:170-175`). 테스트 franchise-qualification 55·recruitment-report 56·franchise-model-boundary 29 passed(mocked). **절차 어긋남**: #200은 레인 A 검토 전에 묶음 22(Sites 버전 48)로 게시됐다(대기열 요청 줄 없이 main 머리에 실려 감). 사후 검토에서 문제는 없었다. 앞으로 DATA-PROCESSING을 고친 레인 R PR은 대기열 요청 줄이 있을 때만 싣는다.
- 레인 A 리뷰(#216 레인 G B3-2 Reflector, 2026-09-27 12:12 UTC): 막을 문제 없음. 레인 A 파일은 export·import 수준이다. 인용 검사(`citedDecisions`)를 거치고 검토 메모 원문은 보내지 않으며, 경보 중에도 생성은 되고 승인만 409이고, 학습 GET은 바뀌지 않았다. PR 트리 테스트 reflector 68·playbook-signals 48·playbook-attach-eval 35 passed(mocked). 운영 ODA는 교정 3건이라 `not_eligible`이어서 real 검증은 뒤로 미룬다. 스위치 `b3_reflector`를 켜기 전에 대표의 전용 프로필 메모리 off 확인이 필요하다. 병합은 레인 G·대표 결정 경로로 한다(레인 A가 대신 병합하지 않음).
- 레인 A 검토(2026-09-27 12:33 UTC): #209(DATA-PROCESSING 3.5 `recruitment_experiment` 행) **받아들임**. 가설·변수는 `scanText`를 통과해야 저장되고(`lib/franchise-experiment.ts:88`), 모델 경계 금지 목록에 `franchise-experiment*`·`app/franchise-experiment-panel.tsx`가 있다. #197(증빙 묶음 가명 개인정보 문구, 사후) **받아들임**. #204의 `lib/workspace-metrics.ts` 변경(import·`NextTask` 합집합·선택 인자·반환 끝 펼침)은 '호출 1줄'을 넘지만 할 일 타입을 넓히는 최소 변경이라 **그대로 둔다**(레인 A 결정). 이후 이 파일에 레인 R 할 일 종류를 더하면 `lib/franchise-tasks.ts`의 `FranchiseNextTask`만 고치면 되고 이 파일은 바꾸지 않는다.
- 제안(레인 Q): 계약 읽기는 최상위 `}` 하나 누락도 '잘린 JSON'으로 거절한다(#112 방침, `tests/role-output.test.mjs:26`). 출력 한도에 못 미친 응답(`incomplete` 아님)에 한해 최상위 `}` 하나를 채워 읽을지 검토 바란다(이번 실패 1건이 운영이면 invalid_output으로 약 1.6만 토큰 폐기).
- A8: 대표 지시(2026-09-27 "B2 2단계 빼고 남은 개발을 모두 진행하라", 세션 29f7af 전달)로 A3 종료 조건을 기다리지 않고 착수했다. 설계 [CUSTOMER-REPORT](CUSTOMER-REPORT.ko.md).
- 요청(레인 R, 2026-09-27 10:51 UTC): R6d-1 PR이 레인 A 파일을 이만큼 고쳤다. 검토 바란다. `app/api/workspace/route.ts` import 1줄·호출 1줄(`...await franchiseWorkspaceTasks(who)`, 스위치가 꺼지면 키 없음). `lib/workspace-metrics.ts`는 호출 1줄을 넘는다: import 1줄, `NextTask` 합집합(`|FranchiseNextTask`), `nextTasks` 선택 인자 `franchiseTasks`, 반환 끝 `...franchiseNextTasks(data.franchiseTasks)`(기존 줄 3곳). `app/workspace.tsx` import 1줄과 다음 할 일 `map` 분기 1곳. 되돌리길 원하면 이 칸에 적어 주면 레인 R이 고친다.
- 다음: A3 run → A8-1 → A8-2 → A8-3 → B4 2부 → B3([순서](LANES.ko.md#레인-a-claude-a-세션)).

## 레인 R (Claude 트랙 R 세션 — 가맹 모집)
갱신: 2026-09-27 15:40 UTC
- R7a 공공 벤치마크 merged(#231 `36f169f`, 병렬 `lane-r-r7a` 세션): 가맹 모집 '벤치마크' 탭(V9), 사람이 버튼으로 적재·토큰 0, 키는 브랜드별 암호문(키 없음 409·외부 호출 0). 테스트 passed · mocked(187/187), 로컬 E2E 14/14. DATA-PROCESSING #232는 레인 A 검토 통과·병합(`2da58e5`). not_run: 게시, real 적재 1회(대표 키 저장 뒤), API 필드 이름·단위 실측 확인(틀리면 SCHEMA_MISMATCH로 저장 0).
- R15b 결정론 모집 템플릿: R15b-1 merged(#230 `46865e0`, 순수 모듈 `lib/franchise-qr.ts`·`lib/franchise-cards.ts`, 런타임 연결 없음, 검사 passed · mocked(franchise-qr 18, franchise-cards 48, 변이 21/22)). R15b-2(#234, 자료 유형 `card_bundle`·PNG 내려받기)는 CI 뒤 병합한다.
- 진행 중: R9a 정보성 너처링 초안. R9a-1 merged(#235 `d71d85a`): 순수 모듈이다(목적·분류·매체, 자리표시 템플릿 검사, 광고성 고정 요소, R2 판정, 허용 입력만 쓰는 모델 제출 조립, 요청당 1회 발송 기록 판정). 검사 passed · mocked(38, 변이 13/13). R9a-2(이 PR)는 HERMES 초안 1회(모델에 리드 정보 0건), 템플릿 저장·폐기, 리드 정보 요청·보낸 뒤 발송 기록(요청당 1회, 광고성 409), '너처링' 탭과 리드 상세 화면이다. 새 kind는 `franchise_message_template`·`franchise_nurture_draft`, 새 스위치는 없다(`r_franchise` 뒤). 검사 passed · mocked(franchise-nurture-route 34, 연결 변이 14/14). 로컬 E2E passed · real Chromium·로컬 D1 / mocked 인증(2/2). DATA-PROCESSING 짝 PR #238은 레인 A 검토 통과(조건: 3.5 정보 요청 행에 실제 요청만 기록·감사 확인 문장, 반영함).
- 성장1 마감(레인 R 몫, 2026-09-27): [인계 기록](observations/2026-09-27-lane-r-growth1-handoff.md). 트랙 R 전체 마감은 성장1 종료 조건이 아니다.
  - 회귀(C12): main `431e417` `node scripts/test.mjs` passed · mocked(184/184 스위트, 12,670). 레인 R PR 21개(#173~#209)의 레인 밖 파일 삭제·이름 변경 0건, 라우트·기능 삭제 0건(지운 줄은 모두 목록·문구·버전 태그를 넓혀 다시 쓴 것). 레인 R 회귀 0건.
  - 5절 Q/R 키 확대 레인 R 몫: 가맹 연락처 암호화 키와 HMAC 중복 키 모두 **not_run**(R8 발동 조건 결정 28 없음). 담당 R(코드)·대표(키 값). 재개 조건: 결정 28, 대표의 `AGENCY_ENCRYPTION_KEY` 교체 결정, OFD 실제 리드 저장 시작 중 먼저 오는 것. 다음 확인일 2026-10-05(월) KST. 영향: 키를 바꾸면 중복 경고·가져오기 병합·연락처 찾기가 오류 없이 틀리고, 옛 키를 빼면 연락처 보기·내보내기·파기가 500. 그 전까지 `AGENCY_ENCRYPTION_KEY`는 바꾸지 않는다(#211 문서와 같음).
  - check-prompts macOS 대소문자 충돌: #161에서 해소, 이번 macOS 실행 131 passed. 레인 A 칸에 줄 삭제 요청을 적었다.
- 세션: 2026-09-27부터 레인 R을 맥 로컬 Claude 세션이 이어받았다(대표 지시, 대표 외출 중). 원래 클라우드 세션의 R3c 작업은 GitHub에 없어 맥 세션이 다시 만들었다. 클라우드 세션에는 R3c 병합 뒤 최신 main에서 이어가라고 알렸다.
- 게시: 묶음 20(07:58 UTC, `1f2fac1`, 레인 A)에 #180·#182·#183·#186·#188이 실렸다. 게시 대기열에 남은 레인 R 줄은 없다.
- 운영 화면 확인: passed · real(2026-09-27 08:08~08:10 UTC, 대표 로그인 브라우저, OFD).
  - `r_franchise`를 켜고 리드 보드의 모집 귀속 필터, 유입·비용 탭, 모집 자료 탭이 뜨는 것과 앱 콘솔 오류 0건을 확인했다.
  - 운영 데이터는 만들지 않았다. `r_franchise`는 reset으로 기본값(꺼짐)으로 되돌렸다.
  - OFD는 분기 미판정이라 코드 발급·자료 승인·리드 등록이 막혀 있다(의도된 동작).
- 흐름 전체: 로컬 E2E #191(`1c6fcc7`) passed · real Chromium·로컬 D1 / mocked 인증.
  - #186: 강조, 체크 전 잠금·409, 체크 뒤 승인·내보내기.
  - #188: 코드 발급·중지, 비용 기록·무효화, 행사 비용 연결, CSV 가져오기.
  - 직원 제한: 실제 이메일 세션으로 확인했다.
- 운영 실사용 조건: OFD 분기 A 기록, LR-1 회신.
- 진행 중: R6 퍼널 측정·주간 보고·증빙 묶음(맥 세션, 대표 지시로 R15b보다 먼저). R6a→R6b→R6c→R6d로 나눈다([계획](FRANCHISE-RECRUITMENT-PLAN.ko.md#r6-퍼널-측정주간-보고증빙-묶음)).
  - R6a #193 `merged`(`823ac96`): 순수 계산 모듈 `lib/franchise-report.ts`(런타임 연결 0, 게시 불필요). 검사 passed · mocked(recruitment-metrics 74, 변이 22/22).
  - R6b #194 `merged`(`8d43b21`): 보기 `report`(모든 역할, 집계만), `report_freeze`·`report_export`·`evidence_export`(대표·관리자, 감사), 새 kind `recruitment_report`, 새 스위치 없음(`r_franchise` 뒤). 검사 passed · mocked(recruitment-report 56, 변이 20/20). 게시 대기열 요청.
  - R6c #195 `merged`(`0ee97b1`): 가맹 화면 '성과' 탭과 리드·자료 상세의 증빙 묶음 버튼. 검사 passed · mocked(franchise-report-ui 29), 로컬 E2E passed · real Chromium·로컬 D1 / mocked 인증(2/2). 운영 real not_run.
  - 대표 결정 36 #200 `merged`(`efee922`, 2026-09-27): 계약 건수와 계약당 비용은 1건부터 보고서에 보인다(n<5 억제 제외, 다른 칸 억제·n<20 비율 숨김은 그대로). `fr-report@2026-09-27.3`. 검사 passed · mocked(recruitment-metrics 83, recruitment-report 56). 운영 real not_run.
  - 대표 결정 35 #203 `merged`(`530387b`, 2026-09-27): 적격 판정 기록 `qualify_lead`. 판정은 적격·보류·거절이고 사유는 코드만 받는다. 대표·관리자는 모든 리드, 직원은 본인 담당 리드만 판정한다. 이력은 추가 전용이고 감사를 남긴다. 리드 상세에 판정 칸, 보드에 필터·열, 성과 탭에 문의 월 코호트 적격 수·적격 리드당 비용이 있다(`fr-report@2026-09-27.4`). 검사 passed · mocked(franchise-qualification 55, recruitment-metrics 91, 모델 경계 29에서 사유 코드 전송 0건). 로컬 E2E passed · real Chromium·로컬 D1 / mocked 인증(2/2). 운영 real not_run.
  - 확인 필요(레인 A): `docs/DATA-PROCESSING.ko.md`에 두 가지를 적었다. #200은 DP-10에 결정 36 예외(근거·위험)를, 3.5 주간 보고 확정본 행에 같은 예외와 내려받은 파일 관리 책임을 적었다. #203은 3.5에 적격 판정 이력 행(코드만, 모델 전송 0)을 더했다. 검토 바란다. 게시 대기열 요청 줄은 받아들인 뒤 넣는다.
  - R6d-1 #204 `merged`(`e811b0c`), 묶음 23(Sites 버전 49, 레인 A) 게시: 워크스페이스 할 일 5종(미응대·계약 가능일 3일 전·증빙 결손·변경등록 기한 30일 전·H10 재검토). `/api/workspace` `franchiseTasks`(브랜드 id·건수만, 스위치 꺼지면 키 없음), 첫 화면 '다음 할 일'에서 가맹 화면 브랜드·탭으로 이동. 새 스위치 없음(`r_franchise` 뒤). 검사 passed · mocked(franchise-workspace 50, franchise-workspace-route 33), 로컬 E2E passed · real Chromium·로컬 D1 / mocked 인증·연결 상태(2/2). 운영 real not_run.
  - R6d-2(이 PR): 소재 실험 선별. 새 kind `recruitment_experiment`, 작업 `experiment_plan`·`experiment_result`·`experiment_cancel`(대표·관리자), 보기 `experiments`, '유입·비용' 탭 아래 화면. 계획은 기간 시작 전만, 팔당 최소 표본 100, 판정은 `lib/viral-stats.ts` 무수정, 결과에 '플랫폼 보고, 원장 리드 아님', 확인 층은 코드 귀속·적격·설명회 참석 건수(20건 미만 비율 숨김). 새 스위치 없음. 검사 passed · mocked(franchise-experiment 43, franchise-experiment-route 36), 로컬 E2E passed · real Chromium·로컬 D1 / mocked 인증(2/2). 운영 real not_run.
  - 확인 필요(레인 A): R6d-2 새 kind의 `docs/DATA-PROCESSING.ko.md` 3.5 행은 별도 문서 PR #209로 냈다(병합하지 않고 레인 A 검토를 기다린다).
- 최근 병합: #191 가맹 모집 E2E `merged`(`1c6fcc7`). #188 R5c 유입·비용 탭 `merged`(`ec822e3`). #186 결정 34 모집 자료 승인·내보내기 대기기간 우회 문장 사람 확인 `merged`(`14a6278`). #185 R3c 재채점 관찰 기록·DATA-PROCESSING 의견 반영(문서) `merged`(`1117812`). #183 R5b-2 리드 CSV 가져오기 기록·API `merged`(`ae96871`).
  - 결정 32 B안: 매핑한 이름·전화·이메일 열만 결정 22 경로로 저장한다. 매핑하지 않은 열에 개인정보가 있으면 파일 전체를 거부한다.
  - 교차 파일 병합(대표 결정 '리드 1건, 집계는 파일별'): 기존 리드에 제공처 기록만 덧붙이고, 제공처별 리드 수는 파일마다 한 명으로 센다.
  - 새 kind `recruitment_import`, 작업 `lead_import_inspect`·`lead_import_preview`·`lead_import_confirm`, 보기 `imports`. 행 한도는 100이다.
  - 검사: passed · mocked(162/162, lead-import-route 66, 변이 35/35). 실제 파일 가져오기는 LR-1 회신 뒤에 한다(LR-2 범위에 '제3자 제공 연락처 대량 수령' 추가).
- 최근 병합(이어서): #182 R2 3차-b `merged`(`d66b569`, 게시 대기열 요청, 측정 전용 블라인드 3차 오기재 34→46/100). #180 R2 3차-a 절 단위 구성 판정 `merged`(`dc0b0d8`, 게시 대기열 요청, 측정 전용 블라인드 2차 오기재 42→53/100·오탐 14→6/100). R5b-1(#177, `ce4c2ff`) `merged`: 모집 코드·모집 비용 기록과 API(`code_issue`·`code_retire`·`spend_record`·`spend_void`, GET `codes`·`spend`), 리드 모집 코드 추가·제외(`add_lead_codes`·`strike_lead_code`), 보드 `code_conflict` 할 일과 `inflow` 필터, 새 kind `recruitment_code`·`recruitment_spend`. 검사 passed · mocked(160/160, recruitment-route 74, 변이 21/21), 운영 real 확인 not_run(게시 대기, 게시 뒤 대표가 `r_franchise`를 켠 다음 확인). #176 `matchView` 보이지 않는 문자 `merged`(`c0c8290`, 묶음 19 게시 완료). #175 R5a 순수 모듈 `merged`(런타임 연결 0, 게시 불필요). #173 R3c `merged`(`7851185`).
- 최근: #163 R15a-2b 가맹 화면 탭·#161 고정 문장 권장화·R2 보완 통제 `merged`(게시 대기열에 함께 요청). #151 R3c 선행 S7 콘솔 키트 `merged`. #139·#143·#145 `published`(묶음 15).
- 다음: R15b 결정론 모집 템플릿 → R9a 정보성 너처링 초안 → 조건부 에픽(R7b·R8·R9b·R10~R14) 인계 → R-2단계 종료 조건 대조. R7a는 `lane-r-r7a` 세션이 병렬로 한다. R15a-3(워크스페이스 할 일)은 R6 뒤([순서](LANES.ko.md#레인-r-claude-트랙-r-세션)).
- 대표 결정(2026-09-27): 결정 33 '14일째'는 대기기간을 채운 것으로 본다(판정 그대로, H2보다 하루 느슨해 LR-1 때 다시 확인). 결정 34 R2 다음 개선은 승인 화면의 사람 확인이고 대기기간 규칙 보강은 멈춘다.
- 대표 결정(2026-09-26): (1) 앱 밖 모집 자료에 AI 생성물 표시를 붙이지 않는다("표시하지마", 화면도 묻지 않음, 결정 17 앱 발행 캡션은 그대로). (2) 예비창업자용 고정 안내 문장(두 대기기간 안내, 수익 질문 안내)은 권장 문구다("3번"). 템플릿은 계속 채우고, 빠지면 경고만 하고 막지 않는다. 대신 대기기간을 틀리게 적은 문장은 R2 hard_block으로 막는다.
- 대표 승인(2026-09-26 16:15 UTC): R3c 선행 작업, 운영 D1 합성 S7 케이스 기대 업종 갱신(8건 `['fnb']` → `['franchise','fnb']`). 실행: passed · real(2026-09-27 00:30~00:40 UTC, 대표 소유자 콘솔. check `toChange` 8 → apply `changed` 8·`verified` 8 → 다시 check `already` 8, [관찰 기록](observations/2026-09-26-lane-r-s7-industry.md)).
- 막힌 것: 법률 검토(결정 20) 보류 중이라 모든 가맹 판정은 'COLLECTIVE 휴리스틱 · 법률 자문 아님'이다. LR-1 확인 필요 추가: 소규모 본부 적용 제외 문장을 hard_block으로 막는 것.
- 해소: #194·#195 `docs/DATA-PROCESSING.ko.md` 3.5 행 2개(주간 보고 확정본·증빙 묶음 내보내기)는 레인 A가 받아들였다(#196, 2026-09-27 09:58 UTC). 비차단 의견(리드별 증빙 묶음은 시스템 코드·접수 시각·제공처로 한 사람을 가리키는 가명 개인정보, 내려받은 사람의 관리 책임)은 3.5 행 '외부로 가는가' 칸에 반영했다. R3c 게시 뒤 운영 재채점 passed · real(2026-09-27 05:35 UTC, 대표 지시로 메인 세션이 대표 로그인 브라우저에서 실행, 토큰 0, [관찰 기록](observations/2026-09-27-lane-r-r3c-regrade.md)). dev `eab8911d` fail 10(09-25와 같은 구성, `industry_metric_leak` 0), 봉인 `284fa4be` fail 9(`industry_metric_leak` 8건은 모두 fnb, R3c 전과 같음). franchise 적중 0, 새 fail 0. #183 DATA-PROCESSING 변경은 레인 A가 받아들였다(#184, 게시 대기열 #183 줄은 레인 A가 넣음). 레인 A 비차단 의견 2건(3.5 `receivedRange` 행, 8절·LR-2 `recruitment_import` 보존 기한)은 이 문서 PR에서 반영. S7 운영 기대 업종 갱신 real(위 대표 승인 줄). #172 결정 32 R5 리드 가져오기 범위(연락처 포함 B안, 제공처 파일별 집계) 기록 `merged`. #143 게시 전 확인(운영 objective 캠페인 0건, 그 개선 회의 0건, 레인 A, passed · real). 레인 A 확인 요청(macOS `tests/check-prompts.test.mjs` 대소문자 충돌)은 #161에서 고쳤다.
- 제안(소유 레인 검토): `docs/DATA-PROCESSING.ko.md` 가맹 kind 목록에 `recruitment_asset`·`recruitment_event`를 더한다(이름·연락처 없음, 모델 입력 0).
- 해소(#206 `merged`, 다른 레인이 고침): 비식별 신호 `grading.gradersVersion`이 120자 상한에 걸려 null로 저장되던 결함(`lib/deidentified-signals.ts`).
- 관찰(레인 Q 파일): `tests/graders.test.mjs:274`(4만 자 입력 1초 검사)가 이 4코어 컨테이너에서 한계선에 있다('## x\n자료 필요'×4000 입력 0.93~1.07초, 같은 코드에서 3회 중 1~2회 실패). 채점기 코드와 무관한 부하 흔들림이다.

## 레인 G (Claude G 세션 roybee-86 — 성장 계획 잔여 개발)
갱신: 2026-09-28 01:28 UTC (대표 위임 Codex 통합 결과)
- 성장1 필수 코드 #206·#210·#211·#212·#213·#216·#217·#218·#219·#220은 모두 main에 포함, Sites 52로 게시·실행 tree 확인 완료. #216·#218·#219 충돌은 #244에서 기존 G/R 기능을 보존해 해결했다. Q #225도 함께 통합했다.
- 코드별 검사·운영 확인·꺼짐 기본값·한계는 [최종 종료 기록](observations/2026-09-28-lane-a-growth1-closeout.md)에 모았다. 필수 미병합 코드 0건이며 실제 활성화와 효과 검증을 완료로 세지 않는다.
- 조건부: Reflector 격리/데이터 전제·교정 5건, 입력 축소 쌍 평가, 실제 키 회전과 Q/R 확대, 공급자 자동 갱신·게시 ID 실응답. 담당·재개 조건·다음 확인일은 종료 기록 5절 인계 표를 따른다.

## 레인 Q (Claude 29f7af 세션 — 품질·평가·운영, 2026-09-27 대표 결정으로 Codex에서 인계)
갱신: 2026-09-28 01:28 UTC (최종 묶음 게시·감시 인계)
- 성장1 마감 레인 Q 몫: [레인 Q 성장1 마감 기록](observations/2026-09-27-lane-q-growth1-closeout.md)(C07·C08·C10·C12 행, 5절 인계, 게시 뒤 감시 기준).
- A1 `channel.offline` v4 `@a6df00903daa` **promoted · registry-active**(봉인 반복 3회 과반 통과). `channel.commerce`·`channel.shortform`은 봉인 반복 평가 진행 중, `viral.discovery`는 등록만(바이럴 분석 케이스 준비 뒤 활성화, #223 평가 경로 병합됨).
- C07 #225는 #218과 #244로 merged, Sites 52 published/runtime-verified. 입력 축소 실평가·활성화는 not_run(다음 확인 09-29). 프롬프트 active/매니페스트는 이번 게시에서 변경하지 않았다.
- 최종 묶음 감시 시작 2026-09-28 10:23:54 KST, 24h 09-29 10:23:54, 72h 10-01 10:23:54. 기존 1/20 invalid_output 기준선·3/20 중단 조건 유지. 운영 인수 감시 종료는 not_run. [현재 증거·한계·인계](observations/2026-09-28-lane-a-growth1-closeout.md).
- #131·#135는 위 마감 기록과 `docs/releases/2026-09-26-*.md`로 대체하고 닫았다(오래된 STATUS 절은 옮기지 않음).
- 요청(레인 R, 2026-09-26): `scripts/eval/specs/syn-s7-franchise.json`의 `expectations.industry`는 S7 재가져오기(기존 8건 삭제 뒤 새로 생성·가져오기)를 계획할 때 그 PR에서만 `['franchise','fnb']`로 바꾼다. 그 전에 바꾸면 specHash가 달라져 재가져오기가 409다. 운영 D1 S7 8건은 대표 승인으로 레인 R 콘솔 키트가 바꾼다(D1이 정본). 갱신 전 S7 run을 재채점하면 `caseUpdatedAfterRun` 표시가 붙고 판정은 같다([관찰 기록](observations/2026-09-26-lane-r-s7-industry.md)).
## 이전 기록 (레인 도입 전)

## HERMES 평가 실패 복구 진행 (2026-09-26 03:02 UTC)

- 기준 main `1ed5ce98b59538d67d1095ee3a5b82a532fc8fd7`, 브랜치 `fix/hermes-eval-recovery` (Codex).
- 대표가 HERMES 실행 장애 해결·재평가를 재지시했다. 기존 `pollCase`가 공급자 오류 상세를 모두 일반 실패로 버려 진단할 수 없었다.
- 소유자용 읽기 전용 `?diagnose=<eval run>`와 화면 버튼을 추가한다. 원래 호스트의 기존 실패 실행 1건만 조회하고 고정 오류 분류·상태·보고 사용량만 돌려준다. 새 실행/중지/채점/장부 수정은 하지 않는다. 입력·출력·오류 원문은 노출하지 않는다.
- 운영 실측 원인·수정·재평가 결과는 게시 후 별도 기록한다. 기존 실패 실행의 0은 미보고 사용량을 포함하지 않는다.


## 운영 API 복구 결과 (2026-09-26 02:22 UTC)

- PR #127 merged, Sites 버전 37 published, `d721017` tree `4f3b130…` runtime-verified. 품질 콘솔의 운영 상태 조회가 실제 API 호출에 성공했다.
- S8 두 run 재채점 passed(완료 출력 각 1건, 실패 0, 추가 모델 토큰 0). `channel.offline@2cbe193eacdc` 등록 성공.
- 쌍 평가 `8fcd3726-b09f-464c-b111-d1d9e20c63fc`는 완료 출력 0/4, 사용 0 토큰으로 끝나 게이트 failed. stage/promote not_run. 실패 사유를 원문 대신 정해진 분류·건수로 운영 화면에 추가한다.
- [게시·실행 근거](releases/2026-09-26-d721017.md). 봉인 요청·출력 원문은 열지 않았다.


## 게시 확인 자동화 (2026-09-26)

- 묶음 14 게시(Claude A6 세션, `published` Sites 버전 40, tree 확인): 기준 운영 `8f0fb54`(tree `98a5800`, 소유자 세션 `/api/version`으로 확인) → 목표 `8651021`(tree `1ac4369`, A3 전체·A6-1~3·`/api/version/public`). 자동 게시(`sites-publish` 라벨 PR), 지시문 `docs/publish/8651021.md`. 결과는 요청 PR 댓글과 게시 기록에 적는다. 그동안 다른 도구는 새 게시를 요청하지 않는다.
- `feat/public-version`(Claude A6 세션): 로그인 없이 `build`·`tree`만 주는 `/api/version/public`을 더한다(대표 결정 "둘 다": 공개 경로 추가 + 그 게시 전 한 번은 Chrome 확장으로 확인). 게시 뒤 개발 도구가 curl로 `runtime-verified`를 판정한다.
- `feat/a6-3-auto-collect`(Claude A6 세션): 작업물 저장 때 자료 요청 자동 수집(A6-3) 진행 중.

## 운영 관리 화면 복구 (2026-09-26)

- A1 PR #120은 `aefd4219aa335425243e41372c8ba8efa3009ee7`로 merged. CI passed, D1 이름 대조 passed. 운영 등록·쌍 평가·stage는 아직 not_run.
- `fix/owner-quality-operations`: 품질 콘솔에 소유자 전용 운영 버전 조회, 재채점, 후보 등록, 쌍 평가, 지정 캠페인 적용 폼을 추가한다. 기존 `/api/eval`, `/api/prompts`, `/api/version`과 권한·CSRF·예산·활성화 게이트를 그대로 쓴다.
- `/api/eval?view=operations`는 동결 요청·출력·기대 판정·케이스별 채점 근거를 제외한 목록·합계만 반환한다. 자동 등록·자동 재시도·자동 전체 승격은 없다.
- 게시 전 상태다. 검증·게시·운영 실행 결과는 PR과 릴리스 기록으로 구분한다.


## Codex A1 작업 재개 (2026-09-26 01:52 UTC)

- 원격 main `b16403df6ded5e67794f3d05e0939c9d22697620`을 PR #120(`feat/a1-local-channel-pack`)에 통합했다. 기존 트랙 R 변경과 게시 보류 이력은 보존한다.
- GitHub 쓰기 403은 허용 저장소 설정 변경 후 복구됐고, PR #120이 생성됐다. 후보 단위는 `channel.offline`이며 코드 폴백은 유지된다.
- 이전 후보 커밋 `2900d3e`: 전체 128/128 스위트·8,986 assertions, typecheck·lint gate·build passed. 통합 후 검증 결과는 PR 본문에 별도로 기록한다.
- 이번 재개에서도 운영 OWNER 로그인을 확인했지만 `/api/version` 직접 탐색은 `net::ERR_BLOCKED_BY_CLIENT`였다. 로그인 성공과 운영 API 실행 성공을 구분한다.
- Sites API 재조회: active, 버전 35. 새 게시·S8 재채점·후보 등록·쌍 평가·활성화는 not_run이다. 봉인 입력·출력은 열지 않았다.
- D1 이름 대조: passed · real. 소유자 화면의 브랜드 4개·지점 1개와 한글·영문 약칭·띄어쓰기 변형을 후보에 대조했다. 이름 원문은 저장하지 않는다. [후보와 수용 기준](LOCAL-CHANNEL-PACK.ko.md).


마지막 갱신: 2026-09-30 12:25 UTC (Codex A 통합: 재발주·공유 재고 Sites76)

## 현재 운영 상태

| 항목 | 값 | 근거 |
|---|---|---|
| 운영 제품 커밋 | `7e553b8eb54db50d6ba59831d082bcab65820a78` (#278) | tree `5d3aff8a4043dc8c679b6327f028ce971d496ea2`, [릴리스](releases/2026-09-30-7e553b8.md) |
| `origin/main` | 게시 제품 `7e553b8`; 자연 유입 미션 발행 연결은 개발 중 | 비제품 변경은 PUBLISH 5절 기준으로 구분 |
| Sites 게시 | `published`: 버전76, deployment `appgdep_6abcfcee20648191b3961dddcd7be244` succeeded | 2026-09-30 12:13:54 UTC |
| 실행 검증 | `runtime-verified`: 공개 `/api/version/public` tree 일치 | build `2026-09-30T12:11:48.054Z` |
| 인증 | 재발주·성장 API 익명401 | Sites76 실제 운영 HTTP, 데이터 변경 없음; 소유자 로그인 이번 재확인 not_run |
| Sites 접근 | public, 환경 revision4 유지 | 설정 변경 없음 |
| 조사 워커 | 이번 게시에서 온라인 상태 재확인 not_run | 활성화 시 서버에서 온라인 조건을 검사 |
| 제품 CI | #278 head verify·e2e-smoke 4개 passed, main과 tree diff0 | [run36711858019](https://github.com/roybeee/Collective/actions/runs/36711858019), [run36711804989](https://github.com/roybeee/Collective/actions/runs/36711804989) |
| 성장2 판정 | 전체33개 카드 개발 진행 중 / 실효과 검증 not_run | [원안 전체](GROWTH-2-PLAN.ko.md). 과거 [종료 판정](GROWTH-2-CLOSEOUT.ko.md)은 Meta M0~M6 한정 |
| 성장1 판정 | 개발 종료 passed / 운영 인수 blocked / 효과 검증 not_run | [최종 판정·조건부 인계](observations/2026-09-28-lane-a-growth1-closeout.md) |

- 테스트 흔들림(2026-09-25 관찰, 제품 동작 변경 없음):
  - CI E2E `e2e/meeting-quality.spec.ts:40`('기준 자료가 바뀐 실패 회의…')가 오늘 3번 60초 시간 초과(#86 1회, #92 첫 CI 모바일·데스크톱). 매번 같은 파일 첫 테스트 직후 두 번째 테스트 첫 줄 `page.request.get('/api/workspace')`에서 멈추고, 같은 로그에 workerd `Broken pipe`가 있다. 재실행하면 통과하고 로컬 `--repeat-each 6`은 24/24 통과(재현 안 됨). 2026-09-26에도 #124 1회, #126 2회(재실행 포함) 같은 증상이었다.
  - 원인(2026-09-26, Claude 트랙 R 세션 조사): 앱이 아니라 wrangler 4.92.0 `wrangler dev` 로컬 프록시(ProxyWorker)다. 사용자 워커로의 전달이 끊기면 전체 URL과 origin URL을 비교해 늘 "워커 재시작"으로 잘못 보고, GET을 재시도 큐에 넣기만 해서 다음 요청이 올 때까지 붙잡는다. workers:1이라 다음 요청이 없으면 60초 시간 초과다. 근거: CI 서버 로그(run 36212412068, `GET /api/workspace 200 OK (60794ms)`가 다음 테스트 첫 요청 65ms 뒤 끝남, 요청 1,585건 중 유일한 느린 요청, real), 로컬 CPU 부하 재현 1/24(real 로컬 workerd·D1·Chromium), wrangler 4.114(origin 비교)·4.130(끊긴 GET·HEAD 재시도) 수정 이력(npm tarball 대조). 운영 Workers에는 이 프록시가 없다. 끊김을 일으키는 계기(유휴 keep-alive 약 5초 경쟁 추정)는 확인하지 못했다.
  - 수정: `e2e/wrangler-proxy-fix.mjs`가 E2E 서버를 띄우기 전(`e2e/serve.mjs`)에 wrangler 4.92.0의 ProxyWorker에만 두 수정을 되돌려 넣는다(정확한 원문 일치·한 번만 적용, 다른 버전은 건너뜀). 의존성 파일은 바꾸지 않는다. 효과 확인은 CI E2E 흔들림 빈도와 `e2e/artifacts/server-default.log`의 `ProxyWorker: … retrying/recovered` 줄로 한다. wrangler를 4.130 이상으로 올리면 지운다
  - `tests/email-auth.test.mjs` '소유자가 멤버·관리자 역할을 바꾼다'가 전체 스위트 병렬 실행에서 가끔 실패(오늘 3회 중 2회, 단독 6/6 통과). 소유자는 '가장 먼저 만든 관리자(created_at, id 순)'로 정해지므로, 계정 생성 시각이 겹치면 승격한 관리자가 소유자로 읽힐 수 있는 구조다(auth 코드는 #23 이후 변경 없음).
- `AUTH_MODE` fail-closed(PR 1, `auth-2`)가 운영에 적용됐다. 운영 빌드에서 `AUTH_MODE`가 비면 모든 인증·업무 API가 503이다. Sites가 public인 동안 legacy로 되돌리지 않는다. 환경 revision 변경·복구·재게시 뒤에는 `/api/auth`가 mode=email인지, 위조 헤더 요청이 401인지 먼저 확인한다. 복구는 [이메일 로그인 복구 순서](EMAIL-AUTH.ko.md)를 따른다.
- 확인 필요: 익명 업무 API 401은 443fff4 게시 뒤 확인했다(passed · real). 위조 헤더 요청 401은 not_run이다(자동 모드 안전 검사 정책). 소유자가 직접 확인한다. 민감 작업 재인증(step-up)은 아직 구현되지 않았다(PR #23 남은 위험).
- 확인 필요: bootstrap 환경 세 항목 제거와 재게시 기록이 없다. 실제 Buffer/Instagram 게시는 not_run.

## 진행 중 작업: 병렬 레인

사용자 승인 "전체적으로 개선하라"(2026-09-23)와 대표 결정 1(병렬 레인)·4(묶음 게시). 범위·배정은 [전체 개선 계획](IMPROVEMENT-PLAN.ko.md)과 성장 계획 문서(PR #26 병합 후 `docs/GROWTH-PLAN.ko.md`)를 따른다.

- PR 0 엔지니어링 기반 `merged`(#22), PR 1 보안·인증 `merged`(#23) — 묶음 1로 게시, `runtime-verified`.
- PR 2 AI 품질 루프 `merged`(#25), PR 3 첫 게시 경로 `merged`(#28), 결정 17 게이트(#29) — 대표 승인으로 `a64aeef` 묶음 게시, `runtime-verified`(당시).
- 묶음 3 `aa999c6`(a64aeef 뒤 31커밋, F3b #57까지) — 대표 승인으로 2026-09-24 게시, Sites 버전 26, `/api/version` tree 일치. 게시 뒤 24~72시간 중단 조건 감시 중(롤백 대상 `a64aeef`). 기능 스위치는 모두 기본값(꺼짐)으로 들어갔다. 레인 A 세션(roybee-9a)이 종료돼 레인 A의 남은 작업(게시 기록·학습 경로 입력 최소화·B3-2)은 레인 B 세션이 이어받았다. 게시 기록 `merged`(#71), 조사 서버 재설치 절차서 `merged`(#72), 학습 경로 입력 최소화 `merged`(#73), 사용자 자료(업로드·직접 입력) 가림 DP-3 `merged`(#74, `2e7a4bb`). 4.4 ①②③④⑤⑦⑧이 모두 `merged`가 되고 운영 반영은 다음 묶음이다. 대표 결정(2026-09-24 11:18 UTC, 선택지 질문 답): 조사·학습으로 보내는 브랜드 정체성의 `audience`·`constraints`에도 개인정보 가림을 건다(⑤ '가림 적용', 이 PR `feat/identity-masking-research-learning`에서 적용). 바이럴 발견은 사례 게시물을 올린 공개 게시 계정만 기록한다(⑧ '공개 게시 계정만 기록', 현재 `caseAccountRule` 확정, 코드 변경 없음).
- 묶음 4 `2e7a4bb`(aa999c6 뒤 16커밋, #59~#74, D1 migration·새 필수 환경변수 없음): 대표가 2026-09-24 11:18 UTC 게시를 승인했다(선택지 질문 답 '2e7a4bb 게시 승인'). 첫 시도는 Sites 작업 사본의 GitHub fetch가 70초 시간 초과로 멈춰 커밋 생성·빌드·게시를 하지 않았다(게시 에이전트 보고, 버전·deployment 없음). 얕은 fetch·재시도 지시문의 두 번째 시도도 fetch가 25초 시간 초과를 반복해 약 32분 뒤 대표가 중지했다(Sites 작업 환경의 GitHub 연결 문제로 본다. 같은 시각 개발 환경에서 GitHub 응답 정상). 대표 결정(2026-09-24 12:0x UTC 경, '2번으로 진행하라'): 게시는 시간을 두고 다시 시도하고, 그 사이 이 PR과 설치기 점검 수정을 병합해 새 SHA로 묶음 4를 다시 승인받는다.
- 묶음 4 `df7e253`(aa999c6 뒤 18커밋, #59~#76) — 대표 재승인(2026-09-24 13:40 UTC)으로 게시, Sites 버전 27, `runtime-verified`. 4.4 입력 최소화 ①②③④⑤⑦⑧·결정 17 AI 표시 확인·설치기 CDP 점검이 운영에 들어갔다. 게시 뒤 24~72시간 중단 조건 감시 중(롤백 대상 `aa999c6`). Sites 작업 환경의 GitHub 코드 전송 문제가 풀리지 않으면 다음 게시도 파일 목록·기대 해시 방식(게시 기록 참고)으로 한다.
- 조사 서버 재설치 완료(2026-09-24 14:15 UTC, 대표 실행): 격리 확인 12줄·Real browser check·샌드박스 유지 모두 통과. 실제 심층 조사 1건(ODA Pizza, 14:18 UTC 시작, 4단계 모두 완료, 자료 38→43건)이 새 격리 브라우저·작업자로 끝까지 돌았다(real). 최종 보고서는 모델이 입력 자료 id를 재선언해 19개 항목이 빠지고 '추가 자료 필요'였다(8개는 id 하나를 다른 URL로 재사용해 연쇄 제거). 근거 보존 개선 PR 진행 중.
- 품질 우선 결정(2026-09-24 15:1x UTC, 대표 선택지 답 — '우리가 산출해낸 결과는 최고의 품질이어야만 한다'): 품질 기준선 측정(B5 서버 평가), 온라인 채점 켜기, 심층 조사 수리 턴 켜기, 조사에 의뢰 목적·시장·경쟁사를 가림 뒤 다시 보내기 — 네 가지 모두 승인. 운영 기능 스위치 `online_grading`·`a7_repair_turn`을 2026-09-24 15:13 UTC 경 켰다(소유자 세션 `POST /api/feature-flags`, 응답 200, 조회 결과 override=true). 평가 전용 HERMES 프로필 `collective-eval`로 첫 품질 기준선을 쟀다(real, 2026-09-24, 운영 `df7e253` 코드로 캡처한 dev 11케이스 — MAPDAL.kr 구매전환 8역할 + ODA 휘경 오픈 insight·strategy·cmo): 결함 0개 산출물 0/11, 적용 채점기 통과율 58/81(71.6%). 채점기 실패는 `internal_id_exposure` 11/11(입력 스키마 경로 노출), `heading_nesting` 5/11, `revisit_cohort_definition` 4/11, `unsupported_claim_term` 3/11. 규제 block 3(가짜 후기 2·광고 표기 1), warn 9. 평가 토큰 231,822(월 상한 1,500,000). 1차 run은 평가 게이트웨이의 비스트리밍 90초 무응답 기준(`HERMES_API_CALL_STALE_TIMEOUT` 기본값)에 걸려 `usage_unreported`로 멈췄고, 평가 프로필만 300초로 올려 나머지 10개를 다시 돌렸다. 운영 HERMES 기본 프로필도 이 값이 없다(기본 90초, 변경은 대표 승인 대상, not_run). [기준선 기록](observations/2026-09-24-quality-baseline-v1.md).
- 품질 우선 후속 `merged`: 심층 조사 근거 보존(#78, `7b45491` — 같은 URL 재선언은 뺀 항목이 아니라 재선언 수, 번호 충돌은 `a7_repair_turn` 번호 수리 1회), 조사에 의뢰 목적·시장·경쟁사를 개인정보 패턴을 가린 뒤 다시 보내기(#79, `e2f6142`). 둘 다 운영 반영은 다음 묶음.
- 품질 수정 v1(PR `feat/quality-fixes-v1`, 기준 `7b45491`): 기준선 결함을 다룬다. 예방(역할 지시문에서 입력 스키마 경로 대신 한국어 이름, 계약 섹션 안 제목 깊이, 재방문율 코호트, 광고 표현·가짜 후기·광고 표기·가격 규칙)을 우선하고, 사람에게 보이는 산출물의 알려진 스키마 경로 → 한국어 라벨, 계약 섹션 안 `#`·`##` → `###`는 저장·렌더 공통 경로에서 정규화한다. 사실·규제 판단은 지어내지 않고 `[확인 필요]`로 둔다(후기는 예시로도 만들지 않고 자리만 표시, 가격 미확정이면 구매 유도 문구 대신 '상품 보기' 같은 행동 유도). 정규화는 역할 실행 저장·팀 회의 결과·작업물 보기 화면에 적용하고, 라벨은 화면 이름(브리프 필드 이름, 확정 사실·후보 사실·거절된 사실·상시 지시·사실 원장)과 같다. 정규화로 가린 결함은 예방이 아니므로 서버 평가는 채점 버전 `failure-types-v1+normalized`로 사람이 보는 본문을 채점하면서 정규화 전 예방 판정(`prevention`)과 정규화 건수를 결과에 남기고, 비교(`compare`)는 `prevention`을 따로 내며, 쌍 평가 게이트는 모델 원문 기준으로 센다(`docs/EVAL.ko.md` '정규화와 예방 판정'). 운영 작업물에도 정규화 건수(`outputNormalization`)를 남긴다. 알려진 한계: 이 PR 이전에 저장된 작업물의 저장 본문·내려받기 파일은 바꾸지 않는다(화면 표시만 라벨). `price_missing` warn은 모델이 구매 유도 문구에 `[가격 확인 필요]`만 붙이면 남는다(사람 확인 항목, 사전 무변경). 역할·회의·브리프 지시 변경은 의도된 제출 바이트 변경이다 — 커밋 뒤 prompt-baseline·role-submission fixture를 재캡처하고 prompt-baseline·role-instruction·prompt-resolution 세 스위트를 함께 다시 돌린다(prompt-resolution은 prompt-baseline fixture의 cmo inputHash에 의존한다). prompt-baseline 차이에는 회의 12단계(meeting·roleMeeting)의 지시·입력 변경도 들어간다(공유 정책·회의 지시 문장, 의도된 변경). 게시 뒤 같은 11케이스로 재평가해 비교한다(예방 효과는 `prevention`으로 읽는다, 기준선 기록 9절).
- 품질 재평가(real, 2026-09-24, [기록](observations/2026-09-24-quality-after-v1.md)): 품질 수정 v1(#80, `443fff4`, Sites 버전 28) 게시 뒤 기준선과 같은 11케이스를 평가 전용 프로필 `collective-eval`로 다시 쟀다(채점 버전 `failure-types-v1+normalized`, 사전 `compliance-lexicon-2026-09-23.2`). 모델 원문의 내부 경로·제목 깊이 결함이 사라졌다(11개 산출물 전부 정규화 건수 0, 예방 판정 fail 0. 기준선은 `internal_id_exposure` 11/11·`heading_nesting` 5/11). 결함 0개 산출물은 0/11에서 7/11(MAPDAL cmo·quality·data·growth, ODA cmo·strategy·insight), 적용 채점기 통과율은 58/81(71.6%)에서 77/82(93.9%)가 됐다(통과 77·실패 5·해당없음 61). 남은 채점기 실패 5건(모두 MAPDAL — `unsupported_claim_term` 금지 목록·금지 표 문장, `revisit_cohort_definition` 정의가 아닌 문장)과 규제 block 5건(산출물 4개 — ODA cmo `fake_testimonial`·`sponsorship_undisclosed`, ODA strategy `fake_testimonial`, MAPDAL cmo·growth `sponsorship_undisclosed`)은 원문 재현 결과 모두 측정 도구 오탐이다. warn은 `price_missing` 산출물 8개·`terms_missing` 2개로 대부분 '구매·주문 CTA 보류' 같은 계획 문장 오탐이다. 재평가 토큰 242,752(MAPDAL run 178,013 · ODA run 64,739), 이번 달 평가 누적 474,574(월 상한 1,500,000). 11케이스라 통계적 개선은 주장하지 않는다(비교 통계 규칙).
- 품질 측정 도구 v2(PR `feat/quality-measure-v2`, 기준 `443fff4`): 재평가에서 드러난 측정 도구 오탐을 고치고 같은 저울 재채점을 더한다. 공유 부정 사전(`lib/graders/negation.ts`)에 절 끝 부정(긴 금지 목록)·인용 사용·금지 맥락 라벨을 더하고, `unsupported_claim_term`은 금지·보류 제목·표를 카피에서 빼며, `revisit_cohort_definition`은 정의 서술만 본다. 규제 가드레일 사전은 `compliance-lexicon-2026-09-25.1`(해소 범위를 `##` 섹션으로 — 다른 `###` 소제목은 표기 서술 문장만, 추천·보증 중단 조건 면제, 매체 광고비 집행 면제, 구매 CTA 보류 계획 면제). `regrade_run`은 끝난 run의 저장 출력을 지금 채점기·사전으로 다시 채점해(모델 호출·토큰 0, 원래 결과 불변) `?compare=<기준>,<비교>&regrade=1`로 같은 저울 비교를 한다(`docs/EVAL.ko.md` 6절). 실제 위반은 계속 잡는다(compliance 합성 violations 전부 검출·normals 오탐 0, graders 기존 기대 유지, mocked). 역할 지시·프롬프트는 바꾸지 않았다(fixture 재캡처 없음). 측정 v2 리뷰에서 재현한 미탐(뒤 절의 다른 대상 보류·부정, 금지어만 든 소제목, 부정한 표기 문장·따옴표 초안의 `#광고`, 결과가 게시인 표기 누락 조건, 같은 문장의 다른 문구 보류, 코호트 없는 콜론·`비중` 재방문율 정의)을 되돌려 HEAD가 잡던 위반을 모두 다시 잡는다(주제어 확인·단독 `보류`는 40자 안·매치 자리 기준 구매 CTA 보류). 채점 버전 `failure-types-v1+normalized+measure-v2`, 재채점 기록은 compare-and-set으로 써서 삭제와 겹치면 409, 이름만 고친 케이스는 기대 판정 변경 표시를 달지 않는다. 게시 뒤 기준선 run(1차·2차)과 재평가 run을 모두 재채점하고 기준 run마다 `?compare=<기준>,<재평가>&regrade=1`로 비교한다(결과: 게시 전이라 not_run).
- 평가 월 승인 레코드(품질 계획 v2 Q2, #86 `a6b0ee3` merged, Q1 평가 종류 골격과 같은 PR): 평가 토큰 월 상한을 UTC 월별 대표 승인(`eval_budget_approval`, 소유자 전용 `set_budget_approval`, 월당 1행·이전 승인은 `history`)에서 읽는다. 승인이 없는 달은 1,500,000이다. 건별 승인(`overBudgetApproved`) run도 제출 직전 월 누적을 보고 승인 cap을 넘으면 `monthly_cap_reached`로 멈춘다(설계 교차 검토 1-3 실패 사례). `GET /api/eval` usage에 `monthlyCap`(승인 반영)·`approval`이 나온다. 대표 사전 승인(2026-09-24, 평가 케이스 확대·토큰 상한 증액): 기준선 달만 월 2.4M, 기준선 run `tokenBudget` 2.0M, 파일럿 평균이 추정의 1.2배를 넘으면 중단·재보고(운영 규칙, 코드 강제 아님). 운영 승인 레코드는 기준선 달이 정해지면 소유자가 기록한다(not_run). 검증은 `tests/eval-budget.test.mjs`(mocked), 운영 반영은 다음 묶음([EVAL 7절](EVAL.ko.md#7-월-승인-레코드eval_budget_approval-q2)).
- Q1 확인(passed · real, 2026-09-25): 운영 평가 케이스 11개 모두 운영자 선호 블록이 없다(`GET /api/eval?case=`). Q1 뒤에도 제출 본문·promptHash가 그대로라 기준선과 바로 비교된다.
- 회의·브리프 평가 종류(품질 계획 v2 G2, #87 `5c17a9e` merged): 평가 케이스 `kind:'meeting_step'`(`capture_case {meetingId, stepId}`)·`kind:'brief'`(`capture_case {briefDraftId}`)를 운영 기록으로 캡처한다. 대상 단계 직전으로 자르고, 조립이 읽는 필드만 남기고, 운영과 같은 가림을 원자료 자리에 적용해 동결한다(`lib/eval-freeze.ts`). 캡처 때 첫 제출과의 드리프트 사유(`captureCheck`, `assembly_drift`만 경보)를 남긴다. 회의 단계 예약 100,000, 브리프는 쌍 평가 제외. 검증 mocked: 동결본 제출이 운영 첫 제출과 바이트 동일(합성 회의 12단계·교정 재시도·브리프). 실제 캡처·파일럿(R1·R2)은 not_run이다(게시 뒤, 파일럿 8건 250k 이하).
- 합성 케이스 생성기(품질 계획 v2 G4, #88 `2d3ecfe` merged): 합성 스펙 → 모의 런타임(고정 시각·결정적 uuid·스텁 HERMES)에서 운영 함수로 역할·회의 단계·브리프 요청을 만들어 `import_cases`로 가져온다. 생성 트리 = 운영 앱 트리, 케이스별 `promptHash` 재계산 일치, 전부 아니면 전무. 스펙은 개인정보 패턴·출처 없는 금지 표현·분기 체크리스트 8종 누락이면 거부된다. dev 스펙 `syn-s2-bakery`(fnb, 15케이스)·`syn-s3-coding`(education, 16케이스). 검증 mocked(두 번 생성 바이트 동일). 봉인 합성 캠페인 스펙(S1·S4·S5, 저장소 밖·다른 사람이 작성)·운영 캡처(C1·C2)·R1 저장은 not_run.
- AI 심사 보정 라벨(품질 계획 v2 J2, #89 `fc92396` merged): 품질 콘솔에 소유자 전용 'AI 심사 보정 라벨' 화면과 `/api/eval` `?labels=queue|item`·`save_label`을 더한다(record kind `judge_label`, 부모 `eval_run`, 라벨이 있는 run은 삭제 409). 블라인드(표시 id·무작위 순서, run·케이스·variant·모델 미포함), dev·active·역할 출력만. 검증 mocked(서버 34, E2E 모바일·데스크톱). 실제 라벨링(R4, 대표 주 20건 × 3주)은 게시 뒤 J3 심사 전에 한다(not_run).
- AI 심사 실행(품질 계획 v2 J3, #90 `ac7a031` merged): `start_run variant:'judge'`가 보정 라벨이 있는 평가 출력만 J1 루브릭으로 심사한다(예약 25,000, 월 예산 합산, 금지 값이 든 항목은 보내지 않음, 결과는 점수만·인용과 가린 이유는 `judge_output`). `?judge=<run>`이 기준별 보정 통계·채택 판정을 낸다. 검증 mocked(29). E1 확장(G2 회의·브리프 동결, J3 심사 재전송)은 대표가 2026-09-25에 승인했다.
- 대표 승인(2026-09-25 02시 UTC 경, 선택지 답): ① 묶음 7 `ac7a031` 게시 승인(J1·G3·Q1·Q2·G2·G4·J2·J3, 목표 tree `53492af`, D1 migration·의존성·환경변수 변경 없음) — 커넥터 방식 지시문을 대표에게 보냈다. Sites가 버전 29(`a41624d`)면 46줄, 버전 28(`443fff4`)이면 61줄 목록을 적용한다(묶음 6 게시 여부를 확인하지 못해 두 경우 모두 적었다, 두 목록 모두 목표 tree 재현 검증). ② E1 확장 승인(위). ③ 운영 HERMES 기본 프로필 무응답 한도 90초 → 300초 승인 — 대표가 2026-09-25 11:13 UTC(20:13 KST)에 실행했다(passed · real: 이전 값 없음(기본 90초), `.env` 백업 뒤 `HERMES_API_CALL_STALE_TIMEOUT=300`, `hermes-gateway.service` active). 재시작 뒤 평가 연결 점검 `check_connection` ready(11:14 UTC). 게시 결과·운영 한도 변경 결과를 받으면 runtime-verified 확인과 릴리스 기록을 남긴다.
- 같은 저울 재채점(real, 2026-09-25, 토큰 0, [관찰](observations/2026-09-25-same-scale-regrade.md)): 운영 채점기(측정 v2+G3)로 기준선 v1과 품질 수정 v1 뒤를 다시 채점했다. 채점기 실패 6→0, 원문 결함(예방 fail) 16→0, 정규화 11/11→0/11, 통과율 92.2%→100%. 수정 v1 뒤 결과에 남은 block 1·warn 9는 모두 측정 오탐이다(합성 라벨 '탈락·수정 기준' 열, 퍼널·분석 이벤트의 '장바구니', 조건·확인 표시 CTA). PR `fix/compliance-failure-label`(#95 merged, 사전 2026-09-25.2)이 고친다. 게시 뒤 재채점으로 11/11을 확인한다(not_run).
- 파일럿 1 측정 오탐(PR `fix/fact-conflict-negated-list`, 기준 `c34a277`): S2 회의 파일럿(real, run `fdceaaa7`) 합의 단계의 수용 기준 문장 '… 할인·무료·보장 표현이 없고, 후기·추천사 예시도 없다'가 거절 사실 사용(`fact_conflict`)으로 잡혔다. 표현 부재 서술(머리 명사 표현·문구·카피 등 + 없다·포함되지 않는다·들어가지 않는다)을 사용 배제로 본다(`+absent-expr`, 사전 2026-09-25.3). 꾸밈말이 붙은 광고 수사('더 이상의 표현이 없습니다')는 계속 잡는다. #97 `ba4eeb8` merged.
- 봉인 케이스 저장(R1, real, 2026-09-25): 대표와 봉인 작성 전용 에이전트 세션이 만들었다. 프롬프트 수정 세션과는 대화·파일을 공유하지 않았다. S1은 대표 세션, S4·S5는 봉인 작성 에이전트다. 세 건 모두 운영 tree `d8eacc9`(e8bd8e0) 체크아웃에서 생성해 `import_cases`로 가져왔다(S1 created 15, S4 9, S5 9, existing 0, HTTP 200). 운영 평가 케이스는 봉인 33(역할 24·회의 단계 6·브리프 3)·dev 74, 합계 107이다(세트별 건수만 확인, 14:55 UTC). 스펙·출력은 저장소 밖에 있고 프롬프트 수정 쪽은 열지 않았다. `sealed_missing`이 풀려 쌍 평가 게이트를 쓸 수 있다.
- 묶음 11 `e8bd8e0`(fa9da73 뒤 #108~#112) — 위임 승인, 대표 게시. `runtime-verified`(13:48 UTC, tree `d8eacc9`, build 13:14:48 UTC, [기록](releases/2026-09-25-e8bd8e0.md)). 운영 계약 읽기(#112), 현장 스킬 적용 조건(#111), 채점기 `+local-rerun+contract-read`, 사전 `.13`. 게시 뒤 재채점(real, 토큰 0): R3 650/12 → 652/10, warn 4 → 1(남은 1은 설계대로 남긴 경고), 예방 fail 4 → 3. 로컬 채널 재실행 64/6 → 68/2. S8 총괄·전략 재실행(real, 24,687토큰): 로컬 채널 1/4 → pass. 새 `industry_metric_leak` 2건은 배달앱 제외 줄 오탐이라 PR #113이 고친다. 봉인 케이스는 게시 전에 가져오지 않았다. 봉인 생성은 이제 e8bd8e0 체크아웃에서 한다. 9월 누적 1,935,242 / 2.4M. 롤백 대상 `fa9da73`.
- 묶음 10 `fa9da73`(121791b 뒤 #105~#107) — 위임 승인으로 게시. `runtime-verified`(11:27 UTC 경, tree `d4a6d2c`, [기록](releases/2026-09-25-fa9da73.md), 기록은 묶음 11 때 뒤늦게 적음). 1차 실행은 편집기가 삭제 한 줄을 건너뛰어 멈췄다. 그 한 줄만 `git rm`으로 적용하는 이어 가기로 게시했다.
- 묶음 9 `121791b`(64e51e8 뒤 #99~#104) — 위임 승인으로 게시, `runtime-verified`(10:21 UTC 경, tree `888f41b`, [기록](releases/2026-09-25-121791b.md)). 사이에 트랙 R #101(`73147a9`)이 08:21 UTC에 tree `unknown`으로 게시돼 있었고, 이번 게시가 그 상태에서 목록 C로 이어 맞췄다. 게시 뒤 R3 재채점(real, 토큰 0): 통과/실패 627/35→650/12(남은 12는 실제 결함), block 2→0, warn 15→9(대부분 오탐, #107). 브리프 3케이스 재실행(real, 26,446토큰): 브리프 실패 3→0(n=3). 롤백 대상 `64e51e8`.
- 묶음 8 `64e51e8`(ac7a031 뒤 #91~#98, 제품 변경은 `lib/graders/`뿐) — 대표 승인(2026-09-25)으로 게시, Sites 버전 30, `runtime-verified`(05:39 UTC 경, [기록](releases/2026-09-25-64e51e8.md)). 롤백 대상 `ac7a031`. 1차 게시 실행은 파일 1개가 빈 파일로 바뀌어 write-tree 불일치로 멈췄고, 그 파일만 다시 받아 게시했다. 게시 뒤 같은 저울 재채점(real, 토큰 0): 수정 v1 뒤 결함 0개 산출물 11/11(통과 81/0, block 0, warn 4 — 모두 오탐, PR `fix/compliance-online-sales-cta` 사전 `.5`가 고침), 파일럿 1 회의 52/0, 기준선 v1 71/6·예방 fail 16·0/11.
- 골든셋 v2 dev 확대(2026-09-25): G0(real, 토큰 0) 결과 운영에는 ODA 역할 3·실패 회의 1(완료 단계 4), MAPDAL 역할 8·완료 회의 1(13단계)이 있고 브리프 초안은 0건이다. 운영 회의 단계 8건을 dev로 캡처했다(real, 평가 케이스 쓰기: MAPDAL 6·ODA 2, 모두 `code_changed`, ODA 2건 `frozenIdentical:false`). C1이 3역할뿐이라 설계대로 합성 dev S6·S7에 S8을 더했다(PR `feat/golden-dev-s6-s8`: S6 무인 보관함 locker, S7 분식 자판기 가맹 B2B fnb, S8 필라테스 체험 education, 각 역할 8). 운영 트리(64e51e8, tree `449a677`) 체크아웃에서 생성해 `import_cases`로 가져왔다(real, 24건, 2026-09-25 06:1x UTC). 운영 평가 케이스는 dev 74건(역할 51·회의 단계 20·브리프 3)이다(설계 72, 브리프 3건 부족을 역할·회의가 메운다). 봉인 S1·S4·S5는 프롬프트를 고치는 레인이 아닌 사람이 만든다(대기).
- 브리프 품질 수정 v2(PR `fix/brief-paths-protected`): 파일럿 R2 S2 브리프의 실제 결함 2건을 고친다. 보호 키(learning 등)를 허용 키에서 빼고 이름으로 밝히며, 입력 JSON 경로 금지 규칙을 더하고, 운영 초안 결과의 경로를 한국어 라벨로 바꾼다. 브리프 지시문 바이트가 바뀌어 G1 기준 fixture의 지시문 digest를 갱신했다(이전 값·사유 기록, 입력·가림 기록은 그대로). 게시는 R3 기준선이 끝난 뒤.
- 회의 단계 정규화 채점(PR `feat/meeting-normalized-grading`, `+meeting-normalized`): 회의 단계를 운영처럼 정규화본(`scrubMeetingOutput`)으로 채점하고 원문 경로 노출은 `prevention`으로 둔다. R3에서 MAPDAL 재검토 원문의 `evidence.facts.confirmed`가 화면에는 라벨로 바뀌는데도 채점기 fail로 잡혔다(역할과 기준 불일치).
- 계약 읽기(#112 merged `e8bd8e0`, 묶음 11로 게시, `+contract-read`): R3 기준선의 `contract_json` 2건은 운영에서도 작업물 거절(`invalid_output`)이 되는 결함이었다. S8 총괄은 완결된 JSON 뒤에 '}'가 하나 더 붙었다. 끝의 '}'·']'를 최대 8자까지 떼고 읽는다. `contract_json` 채점은 원문 그대로 계속 fail로 센다. MAPDAL 크리에이티브는 추천안 섹션의 '… 과업이 확인되지 않은 상태에서 … 단정할 수 없습니다'가 재질문으로 오판됐다. '없다'는 작업·요청·과업이 바로 주어일 때만 본다. 같은 케이스의 `heading_nesting`은 그 연쇄 결과다. 변이 12개 모두 잡힘. 게시 뒤 두 케이스 재채점(토큰 0)으로 확인한다.
- 로컬 채널 재실행 후속(#111 merged `b027004`, 묶음 11로 게시, 사전 2026-09-25.13, `+local-rerun`, [관찰](observations/2026-09-25-local-channel-rerun.md)): #105 게시 뒤 재실행에서 S8 총괄·전략 2건이 여전히 `local_channel_coverage` 1/4였다. 체험 수업 예약 캠페인이라 현장 스킬 적용 낱말이 없어 지시가 붙지 않았다. 현장 스킬을 지점 연결 캠페인(`storeId`, 운영 채점의 점포 조건)과 네이버 플레이스 캠페인에도 붙이고 결정 조건에 방문 예약을 더한다(기준 fixture `43a019a` 재캡처). 같은 run의 채점 fail 4건·규제 warn 2건은 모두 측정 오탐이라 원문 재현 RED 테스트로 고쳤다(쓰려는 조건, '사용 여부', 인용 조사 '고', '포기하는 것' 칸, 인용 CTA 나열 뒤 확인 뒤 추가). 변이 44개 모두 잡힘. 게시는 봉인 케이스 가져오기 뒤, 게시 뒤 S8 2건 재실행(약 25,000)과 재채점(토큰 0).
- 서술형 CTA 측정 오탐(#110 merged `eb96132`, 사전 2026-09-25.12): fa9da73 게시 뒤 R3 재채점 warn 4건 중 3건(판매처, '주문하기 어려움', 검수의 지적·확인 뒤 삽입)을 고친다. 남는 1건은 조건 없는 '[가격 확인 필요]' CTA(설계대로 경고).
- 장바구니·조건부 CTA 측정 오탐(PR `fix/cart-cta-conditions`, 사전 2026-09-25.11): 121791b 게시 뒤 R3 재채점에 남은 warn 9건 중 MAPDAL·ODA의 퍼널 단계 명사 '장바구니', 확인 뒤 검토·결정하는 CTA를 고친다. 조건 없는 '[가격 확인 필요]' CTA 경고는 설계대로 남는다.
- 로컬 채널 결정(품질 수정 v2, #105 merged `41b9fbf`): R3에서 점포 목표 합성 캠페인(S2·S6·S8)의 총괄·전략 6건이 모두 `local_channel_coverage` 1/4였다. 현장 스킬(`channel.offline`, 코드 상수와 `prompts/` 정본)에 로컬 채널 4개군(네이버 플레이스·당근·배달앱·카카오)을 한 줄씩 채택·후순위·제외로 결정하게 했다. 역할 제출 바이트가 점포 캠페인에서 바뀌어 기준 fixture를 `73a90ed`에서 재캡처했다. fa9da73 게시 뒤 6케이스 재실행(real, run `e788c058`, 77,936토큰, 2026-09-25 11:28~11:41 UTC): S2·S6 총괄·전략 4건은 통과, S8 2건은 1/4로 남았다(위 후속 PR). 9월 누적 1,910,555 / 2.4M.
- R3 dev 기준선(real, 완료): 대표 결정(2026-09-25)으로 기준선 달을 9월로 확정하고 9월 월 승인 2.4M을 기록했다. run `eab8911d`(dev 74케이스, tokenBudget 1.8M)가 06:58~09:20 UTC에 74/74 완료, 1,227,228토큰(추정 1.45M의 0.85배), 오류 0, 최장 단계 151초. 채점 실패·규제 판정은 원문을 모두 재현했고, 측정 오탐은 PR `fix/r3-measure-early`(`+r3-measure`, 사전 2026-09-25.10)가 고친다. 실제 결함(로컬 채널 검토 누락 S2·S6, 계약 형식 MAPDAL 크리에이티브·S8 총괄, 브리프 경로·보호 키·허용 밖 키)은 기준선 결과로 남긴다. 회의 단계 `input_budget` 상한은 실측(최대 52,268)으로 64,000을 정했다. 게시 뒤 재채점(토큰 0)과 관찰 기록이 다음이다. A/A 10건(약 0.22M)은 10월 기본 한도로 돌린다.
- 파일럿 R2(real, 2026-09-25, [관찰](observations/2026-09-25-pilot-r2.md)): S2 회의 6단계(run `fdceaaa7`, 87,119토큰)와 S2·S3 브리프(run `0938a0ca`, 17,252토큰). 8건 104,371토큰(건당 13,046)으로 추정 25,000의 0.52배, 최장 97초, 회의 입력 최대 17,455토큰. 회의 채점 실패 5건은 모두 측정 오탐이다. #97과 PR `fix/pilot1-critique-negation`(`+critique-clause`, 사전 2026-09-25.4: 다른 지표 산식·'재방문율이 아니라'·'계산할 수 없다'는 재방문율 정의가 아님, '-지는 않' 부정)이 고친다. S2 브리프에 실제 결함 2건(제안 값의 스키마 경로 노출, 보호 항목 `learning` 제안 — 파서가 버려 화면엔 없음)이 있어 R3 기준선 뒤 품질 수정 후보로 둔다. 9월 누적 578,945 / 1.5M.
- 심층 조사 보고서 근거 보존(PR `fix/deep-report-evidence`, 기준 `df7e253`): 운영 실측(aa999c6, 2026-09-24 심층 조사 4단계 완료, 최종 보고서에서 19개 항목을 빼 `needs_data`)의 두 원인을 다룬다. (1) 이미 보관된 입력 자료를 같은 URL로 다시 적은 11건은 이제 뺀 항목이 아니라 재선언 수로만 센다(기본 동작, 스위치 무관, 화면 ‘기존 자료 재선언 N건(인용 유지)’). (2) 입력 자료 번호 하나를 다른 URL로 다시 써서 접근 기록·고객 관찰·핵심 주장·진단 근거·실험 과제 등 8개가 연쇄로 빠진 문제는 `a7_repair_turn`이 켜져 있을 때 번호 수리 1회로 되찾는다(서버가 원래 응답과 대조해 번호 바꾸기만 받고, 충돌 번호에 남은 인용은 계속 뺀다. 모든 구간에서 원래보다 적지 않을 때만 채택). 스위치가 꺼져 있으면 사유 문구만 원인을 말한다. 운영 `a7_repair_turn`은 대표 승인(품질 우선 결정)으로 2026-09-24 15:13 UTC 경 켜 두었다 — 이 PR이 게시돼야 번호 수리가 동작한다(지금 운영은 뼈대 오류 수리만). 켜진 상태에서는 뼈대 오류·번호 충돌 때 조사당 1회 유료 토큰을 쓴다(예산 가드 적용, 입력 60k 토큰 상한).
- 묶음 5 `443fff4`(df7e253 뒤 #77~#80) — 대표 승인(2026-09-24 18:29 UTC)으로 게시, Sites 버전 28, `runtime-verified`. 심층 조사 근거 보존·조사 의뢰 정보 가림·품질 수정 v1이 운영에 들어갔다. 롤백 대상 `df7e253`. 같은 평가 케이스 11개로 품질 재평가 중.
- 품질 계획 v2([품질 로드맵](QUALITY-ROADMAP.ko.md)): 측정 v2 병합 뒤 평가 공통 골격(Q1·Q2) → 골든셋 v2(9캠페인 105케이스) → 대표 라벨로 보정한 AI 심사(J1~J4), PR 10개. 대표 승인(2026-09-24): 사람 보정 라벨링 참여, 기준선 달만 평가 월 상한 1.5M→2.4M·기준선 run tokenBudget 2.0M·파일럿 평균이 추정 1.2배를 넘으면 중단·재보고(적용은 그 달의 `set_budget_approval` 기록이고, 기록 전에는 1.5M이다. `docs/EVAL.ko.md` 7절). merged: 측정 v2(#83), G1 조립 공개(#82), J1 AI 심사 루브릭·보정 통계(#84, 모델 호출 0, [AI 심사](JUDGE.ko.md)), G3 회의·브리프 채점기(#85). 진행: Q1·Q2(`feat/eval-kinds-skeleton`) 다음 G2 회의·브리프 평가 종류.
- 트랙 R(가맹점 모집 마케팅 솔루션, [계획](FRANCHISE-RECRUITMENT-PLAN.ko.md)): 대표 요청(2026-09-24)으로 계획을 세우고 1차 대상을 OFD 첫 가맹으로 정했다(결정 19). OFD 운영 사실·계약 내용·모집 자료 개정본·법률 미팅 자료·계약서 검토서는 저장소 밖에 둔다(공개 저장소 경계). 저장소에는 건수만 적는다: 모집 자료 개정 초안 2건과 브랜드 소개판 1건, 법률 미팅 자료 5건, 가맹계약서 검토 1건(필수 기재 13개 호 중 충족 9·미흡 3·누락 1, 위험 30건, 2차 검토 유지 71·기각 1). 대표 결정(2026-09-25): 결정 20 법률 검토 보류(LR-1·LR-2 `blocked`, 게이트는 휴리스틱 표시), 결정 22 리드 이름·연락처 저장. R4a·R1a·R4b(리드 원장, 스위치 `r_franchise` 기본 꺼짐)는 #101로 `merged`이고 121791b부터 운영에 있다(`runtime-verified`, 스위치 꺼짐). #117로 `merged`(`41ea80d`): R1b 모집 팩트시트(가맹 사실 36항목·정보공개서 버전 근거·각주·수익 항목 광고 금지), R2 모집 광고 가드레일(사전 범주 `franchise_recruit`, 사전 `.14`, 해제 불가 8종, 소비자 캡션은 모집 문구가 있을 때만 차단), 설정 기능표의 소유자 전용 가맹 모집 켜기·끄기 버튼. R2 새 합성 문장 최종 측정(passed · mocked): 소비자 캡션 150건 해제 불가 0·차단 5, 정상 모집 60건 오탐 0, 현실적 모집 위반 120건 중 62%가 차단 또는 경고로 드러나고 38%는 놓친다(대기기간 우회·단체 조건·본사 연계 자문이 약하다, 승인 체크리스트로 보완 예정). 실제 브라우저·법률 적합성은 `not_run`. 게시 전 점검(4개 관점 검토)에서 비가맹 브랜드의 원장 점검 약화 1건을 찾아 이 PR에서 고쳤다([계획 R1 기록](FRANCHISE-RECRUITMENT-PLAN.ko.md#r1-모집-팩트시트)). 게시 전 점검 수정은 #118로 `merged`(`b0ef304`). 운영 반영(묶음 13)은 대표 결정으로 보류 중이다. 대표 결정(2026-09-25 23:36 UTC, "둘다 그렇게 하라"): 결정 26(objective 하나·대표·관리자 설정·새 채널 단위 6개는 코드 PR과 묶음 게시, A1 '게시 없이 반영'은 기존 단위 본문만)과 결정 31(R-1 창업 게시는 앱 밖 창업 계정에 수동)을 권고대로 정했다. R3은 A1 PR(#120)과 파일이 겹쳐 R3a(objective·적용 범위, 이 PR)·R3b(새 채널 단위 6개, #120 뒤)·R3c(업종 채점·재채점)로 나눴다. R3a: 캠페인 가맹 모집 목적(`franchise_recruitment`, 대표·관리자 지정·해제, 스위치 꺼짐 지정 409·해제 허용, 지점·브랜드 변경·제작 기록 보호), 모집 캠페인의 소비자 채널 스킬(offline·search·commerce) 끄기, 가맹 근거 정책, 발행 캡션 모집 범위 판정(가맹 프로필 없어도), 브리프 초안 목적 이어받기. 목적 없는 캠페인의 제출 바이트는 기준 fixture 재캡처 없이 같다(passed · mocked). 스위치가 꺼져 있는 동안 가맹 기능은 운영 동작에 들어가지 않는다. R3a는 #124로 `merged`(`b16403d`)이고 운영에 있다(버전 37 이후, 스위치 꺼짐). R15a(모집 자료 키트·내보내기 게이트)는 R15a-1(순수 판정 모듈 `lib/franchise-assets.ts`, 테스트 223개 passed · mocked, 런타임 연결 없음)과 R15a-2(기록·API·화면)로 나눴다([계획 R15](FRANCHISE-RECRUITMENT-PLAN.ko.md#r15-모집-자료-키트설명회-운영-r15a-자료-키트내보내기-게이트--r15b-결정론-모집-템플릿)). R15a-1의 대표 결정 대기 2건(AI 생성물 표시, 고정 안내 문장)은 권장값으로 진행한다.
- 성장 계획 `docs/GROWTH-PLAN.ko.md`(#26)가 병합됐다. 레인 배정·공유 파일 병합 순서·묶음 게시 절차는 그 문서가 정본이다.
- 레인 A(공통 기반·교정, 세션 roybee-9a): F1a·A2 순수 함수 `merged`(#27), F4a kind 레지스트리·결정 7 삭제 정책 `merged`(#32), F1b-1 역할 지시 순수 함수 연결 `merged`(#35, 스냅샷 `tests/fixtures/role-submission-fc8eb5c.json`), F1b-2 서버 평가 실행 `merged`(#39, `/api/eval` 소유자 전용, 평가 작업 소유자당 1개). F2a 실행 신원·기능 스위치 `merged`(#43: `lib/feature-flags.ts` 기본 꺼짐 — online_grading·b1_reason_required·a4_auto_attribution·a2_downgrade, 소유자만 변경 / 사용량 원장 조인 키 / 보고 모델 변경 경보 / 사용량 내보내기). F2b 게이트웨이 스냅샷·온라인 채점 `merged`(#45: 워커 tick에서 소유자당 하루 1회 스냅샷, `online_grading` 스위치가 켜질 때만 저장 뒤 채점). B1 검토 결정 로그 `merged`(#51: 대표 결정 8 (a) — quality 5기준 + compliance·voice·fact_error·question_only·format 사유 코드, 추가 전용 `review_decision`(메모 원문 없이 길이만, 행위자 id·역할만), 사람이 고친 AI 작업물은 origin `ai_edited`, `b1_reason_required` 스위치(기본 꺼짐)를 켜면 수정 요청 사유 필수, 문서 `docs/REVIEW-DECISIONS.ko.md`). F3a 프롬프트 레지스트리 `merged`(#55: 결정 2·3 — git `prompts/` 16단위 정본, 스킬만 레지스트리, 비면 코드 상수로 폴백해 제출 바이트 동일, CI 'Prompt registry sources' 검사, 상태 어휘 `registry-active`, 사용량 promptVersion은 레지스트리면 'unit@sha12' 연결·코드면 '<skillVersion>:<sha12>'/'inline:<hash>'). 다음은 F3b 활성화 게이트(쌍 비교 평가·대표 승인). HERMES 평가 전용 프로필(메모리 off)은 대표 승인으로 서버에 생성됨(운영 게이트웨이 무변경).
- 레인 B(실측·비용, 이 세션): B4 1부 바이럴 판정 통계 `merged`(#30). A4 점포 실측·PR 4a 비용 가드·PR 6 앱 측은 F2(기능 스위치·`lib/hermes.ts`·`lib/research-worker.ts` 순서) 뒤. 그 사이 PR 5 중 공유 파일에 걸리지 않는 부분을 진행한다: PR 5a 내비게이션·로딩 상태·대시보드 숫자 `merged`(#37), PR 5b 삭제 대화상자(결정 7·건수 API)·보존 규칙 표시·E2E route.fetch 제거 `merged`(#40), 동결 요약 표시 `merged`(#41). PR 4b-1(loop-6 검증 채널 분리·loop-7 점포 회고 규칙 승격 미리보기·loop-9 측정 기간 롤링·arm별 초안·loop-11 만료 임박 규칙 알림·연장 조건·exec-loop-10 발행 횟수 한도) 이 PR. PR 4b-1 `merged`(#44). A4-1 점포 실측(추적 코드·POS CSV 가져오기·`a4_auto_attribution` 스위치 기반 자동 귀속·코드/팔/캠페인/출처별 집계·주 단위 완전성 검사·incrementality-lite) `merged`(#46). 발행 캡션의 추적 코드 연결은 A4-2. PR 6 앱 측(security-ops-4·7·1: 워커 토큰 만료·온라인 회전·재발급 10분 유예·거부 기록·앱 gate 확인·조사 도구 위험 등급) `merged`(#47) — 만료·회전은 `RESEARCH_WORKER_TOKEN_EXPIRY=enforce`, 앱 gate 차단은 `RESEARCH_WORKER_APP_GATE=enforce`, 위험 도구 차단은 `RESEARCH_TOOL_POLICY=block`일 때만 켜지고 기본은 기록·경고만 한다. PR 4a 비용 가드(loop-4 토큰 예산: 기본 미설정·경고만, 소유자가 월 워크스페이스·캠페인 상한을 정하면 HERMES 제출 전 409 / loop-5 별칭 단가 선언 재추정 / security-ops-11 커넥터 응답 200KB 제한·조사 처리 오류 고정 문구) `merged`(#48). A4-2 게시 단위 귀속(발행 캡션의 게시별 쿠폰·POS 태그 코드 줄, 게시 상태·예약일 관문, 점포 귀속 보고서의 게시별 집계, 소재 제목) `merged`(#49). A4-3 추적 코드 직접 입력(주문 기록 창·장부 양식 CSV `trackingCode` 열의 코드 조회·게시 관문, 앱 게시 기록 없는 소재의 수동 귀속 경고 — 차단 없음, 코드 열이 든 장부 CSV는 관리자만) `merged`(#50). A2 런타임 하향(`a2_downgrade` 스위치, 기본 꺼짐: 켜면 차단 등급 규제 위반 작업물에 '규제 점검 차단' 표시, 품질 검수 판정·캠페인 상태를 수정 필요로만 낮춤, `lib/online-grading.ts` 안에서 처리 — 레인 A 확인) `merged`(#52). PR 4b-2(loop-3 잔여: 캠페인 상세 성과 탭의 주문 장부 귀속 집계 — 주 단위·지점·소재·게시·귀속 방식별, '귀속≠증분', 확인 뒤 schemaVersion 2 metric 스냅샷(어제까지) / 네이버 검색광고 수집 광고비를 관리자 확인 뒤 비용 장부로 이관·누적 재수집 갱신) `merged`(#53). loop-3 잔여는 학습 규칙 연결(B3·B4 2부)만 남는다. A7 조사 투자 회수 `merged`(#56) — 부분 구제(기본 동작, 추가 비용 없음: 심층 조사 결과에서 잘못된 항목만 사유와 함께 빼고 유효 출처는 candidate로 저장, 뺀 항목이 근거·진단에 걸리면 품질 판정 needs_data), security-ops-11 잔여(null 원소 → 구제 또는 422, 점포 진단은 422), 수리 턴 1회(`a7_repair_turn` 스위치, 기본 꺼짐: 뼈대 오류일 때만 예산 가드를 거쳐 1회, 원래 응답에 없던 출처는 뺌). PR 5d `merged`(#58) — data-truth-8 파생 캠페인 상태(응답에 derivedStatus·statusReason만 추가, 저장 status와 그것을 쓰는 서버 로직 불변, 새 표시 상태 '진행 막힘'·'발행 진행', 대시보드 수치도 파생 상태 기준) + ux-9 캠페인 보관(archivedAt, 목록·대시보드에서 숨김·보관함 필터·해제, 산출물이 있으면 삭제 대화상자 기본이 보관, 보관 중 새 AI 실행·회의·초안·연속 실행·발행 승인 409, 진행 중 작업·예약 발행이 있으면 보관 거절). B2 1단계 품질 콘솔 이 PR — LLM 없이 역할×스킬 버전×promptVersion(레지스트리 'unit@sha'면 그 값, 코드 상수면 스킬 버전으로 접음)×보고 모델별 1차 승인율(B1 정의 재사용)·사람 판정 사유 분포·폐기 토큰(미연결 따로)·회의 완주율·온라인 채점·규제 보류, 기준별 κ(사람 라벨 20건 미만이면 보정 불가), 주간 다이제스트(`GET /api/quality-console?format=digest`와 로컬 `scripts/quality-digest.mjs`, 네트워크 없음), 소유자·관리자 전용 화면. 워커 큐·Slack 전달은 B2 2단계. 다음은 PR 4a-2 실행 가드(보관 검사 잠금 안·OpenAI 직접 경로 예산 가드·복구 중 예산 초과 표시·수리 예약 분리, 구현 중), 그 뒤 PR 5c 화면·권한. F4b는 대표 결정 12(국외 기반 모델 데이터 처리 기준) 대기. PNG 코드는 A4-4 또는 소재 템플릿 작업(공개 미디어 경로 변경 필요), 캠페인 성과 탭 자동 집계는 PR 4b. A7·F4b는 레인 A의 B1 뒤. PR 4a 비용 가드는 A4 다음, `lib/role-execution.ts`는 F3 뒤라 HERMES 제출 지점(`lib/hermes.ts`)에서만 다룬다.
- PR 6 서버 측 `merged`(#33): 조사 서버 브라우저 격리(CDP 연결 구조로 변경)·설치기 권한 축소·워커 백오프. 앱 측 PR에서 설치기 워커 유닛에 `ReadWritePaths=/etc/collective-research`(설정 폴더만 쓰기 허용)를 더했다. 온라인 토큰 회전은 이 설치기로 재설치한 워커만 저장할 수 있다. **공유 서버 재설치는 대표 승인 뒤**. 대표 결정: 게시 뒤 대표가 직접 재설치한다. 실행 순서는 [조사 서버 재설치 절차서](RESEARCH-SERVER-REINSTALL.ko.md). 1차 재설치(2026-09-24 11:3x UTC, 대표 실행)는 3/6단계 설치 점검에서 멈췄고 설치기가 되돌렸다(HERMES 설정 무변경). 대표와 함께 한 진단(real): 샌드박스·AppArmor·방화벽은 정상이고 Chrome for Testing 154에서 `--dump-dom` 점검이 끝나지 않았다. 설치기 점검을 CDP 방식으로 바꿨다(이 PR). 재설치는 이미 받은 설치 파일에 이 PR의 설치기 코드를 적용해 다시 한다. 그때까지 서버 조사는 멈춰 있다(새 자격증명 발급으로 이전 워커 토큰 거부). 실서버 검증 not_run.
- E2E 간헐 실패: 회의 테스트의 응답 폐기 경합은 수정(#34). workerd 크래시는 원인 미확정(blocked) — 다음 발생 때 `[serve]` 로그로 사유 확인.
- 새 records kind는 `lib/record-kinds.ts` 등록 필수(#32, `tests/record-kinds.test.mjs`). 역할 지시는 `lib/role-instruction.ts` 한 곳에서 만든다(#35). `lib/practice.ts`·`campaign-policy.ts`·`ai-context.ts`·`role-instruction.ts`를 바꾸면 `scripts/eval/capture-role-submission.mjs`로 스냅샷 재캡처.
- E2E 규칙: 테스트 route 처리기에서 `route.fetch()`는 부하 중 응답이 멈출 수 있어(화면 폴링이 끝나지 않은 reload에 막힘) 미리 받은 응답을 `route.fulfill`로 돌려준다(#37, PR 5b에서 기존 스펙 정리).
- 결정 17(AI 생성물 표시) 미결: AI 카피 캡션은 `AI_COPY_CAPTIONS=enabled`가 아니면 꺼져 있다(#29).
- `docs/STATUS.md`·`prompt_plan.md`는 여러 레인이 함께 쓰므로 병합 순서대로 rebase해 갱신한다.
- A3-1 카피 팩 v2(브랜치 `feat/a3-copy-pack-v2`, Claude Code, 기준 `b0ef304`): 콘텐츠 역할 출력 계약 `role-output-v2`(채널당 3~5안 카피·숏폼 장면 배열·제안 실험)와 채점기 `copy_pack_variants`(`+copy-pack`)를 더한다. 스위치 `a3_copy_pack`(기본 꺼짐)이 켜진 소유자의 콘텐츠 단독 실행만 쓰고, 꺼져 있으면 제출 바이트 동일하다. 게시 보류 중이라 운영 반영은 다음 묶음이다. [카피 팩](COPY-PACK.ko.md)
- A3-2 브랜드 말투(브랜치 `feat/a3-brand-voice`, Claude Code, A3-1 `feat/a3-copy-pack-v2`(#121, 미병합) 위): records kind `brand_voice`(관리자 초안·대표·관리자 확정·철회, CAS 409, 직원 403)와 채점기 `brand_voice_avoid_term`(`+voice-avoid`, 15종)을 더한다. 스위치 `a3_brand_voice`(기본 꺼짐)가 켜지고 확정본이 있을 때만 크리에이티브·콘텐츠 입력에 `brandVoice`가 실리고, 아니면 제출 바이트 동일하다. #121 병합 뒤 rebase한다. [카피 팩 A3-2](COPY-PACK.ko.md)
- A3-3a 작업물 제안 실험(브랜치 `feat/a3-artifact-experiment`, Claude Code, A3-2 `feat/a3-brand-voice`(#122, 미병합) 위): 학습 action `create_experiment_from_artifact`로 승인된 콘텐츠 작업물의 카피 팩 제안 실험을 draft 바이럴 실험(`source.kind:'artifact'`, 사례 id 빈 값, 두 안의 실제 문안)으로 옮긴다. 미승인·낡은 브리프·낡은 팩·팩 오류·팩 없음·범위 밖은 409, 같은 작업물·판·제안은 멱등이다. 별도 스위치 없음(팩은 `a3_copy_pack`이 켜졌을 때만 생긴다). 캡션 소스 전환은 A3-3b로 트랙 R R3 뒤로 미뤘다. #121·#122 병합 뒤 rebase한다. [카피 팩 A3-3](COPY-PACK.ko.md)
- A3-4 회의 개선본 카피 팩·골든 v2(브랜치 `feat/a3-meeting-copy-pack`, Claude Code, A3-3a(#123, 미병합) 위): 회의 시작 때 `a3_copy_pack`이 켜져 있으면 스냅샷에 프로필을 고정하고 콘텐츠 개선본만 카피 팩을 내 새 판에 묶는다(soft). 합성 dev 스펙 `syn-s9-fnb-insta`·`syn-s9-edu-reels`(스위치·확정 말투로 `outputProfile`·`brandVoice` 동결), 기대 계약 채점(`+expected-contract`, v2 요청 + v1 원문 → `contract_json` fail). 꺼짐·프로필 없음은 회의 제출 바이트 동일. 종료 조건 run(골든 v2 dev 2건, 예약 100,000·실측 약 30,000 예상)은 게시 뒤다. #121~#123 병합 뒤 rebase한다. [카피 팩 A3-4](COPY-PACK.ko.md)
- A6-1 자료 요청(브랜치 `feat/a6-data-requests`, Claude Code, A3-1~A3-4 스택(#121~#125, 미병합) 위): 작업물의 '자료 필요' 표지(`[자료 필요: 담당/항목]`·`자료 필요:` 줄·`## 자료 필요` 목록·`[X 확인 필요]`·현재 판 카피 팩 `needsCheck`)를 결정론으로 모아 records kind `data_request`(열림)로 만들고, 같은 항목의 유효 사실이 확정되면 `/api/brand-facts` 저장 뒤 자동으로 닫는다(`fact_confirmed`, 실패하면 `closedRequests:null`과 멱등 `reconcile`). 스위치 `a6_data_requests`(기본 꺼짐)가 꺼져 있으면 쓰기 409, 사실 저장 응답 바이트 동일. 모델 호출 0, 실행기 불변. [자료 요청](DATA-REQUESTS.ko.md)
- A6-2 플레이스 정보 대조(브랜치 `feat/a6-2-place-check`, Claude Code, A6-1 `feat/a6-1-data-requests`(#130, 미병합) 위, 진행 중): 관리자가 지점 네이버 플레이스 정보(주소·영업시간·휴무·전화·메뉴 가격)를 수동 스냅샷(records kind `place_snapshot`, 최근 10판)으로 입력하면 `effectiveBrandFacts`와 결정론으로 대조한다. conflict·place_missing은 점포 할 일(`place:<지점>:<플랫폼>:<항목>`), fact_missing은 `a6_data_requests`가 켜져 있을 때 지점 자료 요청(origin `place_check`), 다시 일치하면(재입력·사실 저장 뒤 재대조) 할 일 자동 완료. 스위치 `a6_place_check`(기본 꺼짐) 꺼짐이면 쓰기 409, `/api/stores` GET·사실 저장 응답 바이트 동일. 모델 호출·스크래핑·URL fetch 0. [플레이스 대조](PLACE-CHECK.ko.md)
- A6-3 자료 요청 자동 수집(브랜치 `feat/a6-3-auto-collect`, Claude Code, `origin/main` `d59b97d` 기준, 진행 중): 역할 작업물·회의 개선본·브리프 초안·점포 진단 보고서 저장 직후 실행기 한 줄(`collectOnSave`·`collectBriefOnSave`·`collectStoreReportOnSave`, 스위치는 `lib/data-requests-server.ts`만 읽음)로 자료 요청을 모은다. 원천 확장: 품질 검수 `needs_data` 지적(항목 key 없음), `StoreReport.questions`, `BriefResult.questions`. 재개: 철회·만료 사실로 닫힌 `fact_confirmed` 요청은 다음 수집 때 다시 연다(`reopenedAt`·`previousResolution`), `answered`·`dismissed`는 그대로. 스위치 꺼짐이면 제출·저장·응답 바이트 동일, 수집 실패는 저장을 막지 않음, 모델 호출 0. A6 종료 조건 real 절차는 [자료 요청](DATA-REQUESTS.ko.md)

## 이력

아래는 각 시점의 기록이다. "운영 미적용", "Sites 접근은 변경하지 않았다", "runtime-verified는 blocked", "제품 소스 a67a318"처럼 현재형으로 적힌 서술은 모두 그 시점의 상태다. 현재 상태는 위 "현재 운영 상태" 표를 따른다.

### 2026-09-24 08:48 UTC 기록 — 묶음 3 게시 (aa999c6, Sites 버전 26)

- 직전 운영은 `a64aeef`(Sites 버전 25, 2026-09-23 15:34 UTC 경 `runtime-verified`)였다.
- 대표가 레인 A 세션에 승인한 `aa999c6`(tree `6c4f155…`)을 대표가 휴대폰에서 Sites 편집기에 지시문을 넣어 게시했다. 버전 26, deployment `appgdep_6ab4e35785208191be56f75d057c0c0f` succeeded, 약 5분. 운영 `/api/version` tree가 aa999c6 tree와 같다(real). [게시 기록](releases/2026-09-24-aa999c6.md).

### 2026-09-23 12:48 UTC 기록 — 보안·인증 게시 (d156dfd)

- PR 0(#22)의 미게시 제품 변경과 PR 1(#23)을 함께 게시했다. 운영 `/api/version` tree가 `6a1881b…`로 d156dfd tree와 같아 `runtime-verified` · real.
- 게시는 대표가 Sites 편집기에서 직접 실행했다. Sites 버전·deployment ID·migration 0003 적용 결과는 기록 없음. [게시 기록](releases/2026-09-23-d156dfd.md).
- PR #19는 이미 `CLOSED`다(이전 STATUS의 "닫을 예정"은 해소).

### 2026-09-23 07:48 UTC 기록 — 실행 연결 첫 단계 배포 (dbf94a5, Sites 버전23)

- 이 절의 runtime-verified blocked는 2026-09-23 07:58 UTC 경 관리자 이메일 세션 확인으로 해소됐다(위 표).
- 제품 `dbf94a5138df0ea0765919abaa4fa955511d49a2` / PR #20 merged.
- Sites 버전23 published: `appgdep_6ab383ddc9408191a9cb0e12916d5cd5`, succeeded, 2026-09-23 07:46:46 UTC. 기존 public 접근과 환경 revision4를 유지했다.
- 제품/Sites 투영 tree `281ea84a47227a5eec82c0b2b7c0cde6c5889c90` 일치. runtime-verified는 blocked: 운영 브라우저에 이메일 로그인 세션이 없어 `/api/version`의 인증 후 값을 확인하지 못했다. 실제 새 로그인 화면까지 확인했으며 내부 기능 정상 작동으로 확대 해석하지 않는다.
- 전체27/27 suites·849 assertions, TypeScript, lint gate, build, 기본 E2E12와 이메일 E2E1 passed. main CI `35831544401`도 재실행 후 verify/e2e-smoke 모두 passed. 최초 이메일 검사 실패는 Miniflare `Network connection lost` HTTP500으로 확인했고 제품 코드는 바꾸지 않았다.
- 실제 Buffer/Instagram 게시 not_run(계정·공개 이미지 호스트 미연결). [배포 근거](releases/2026-09-23-dbf94a5.md).
- 아래 이전 배포 기록은 당시 근거로 보존한다. 후속 문서 전용 커밋은 별도 게시하지 않는다.

### 브랜드 사실·제작·발행·주문 연결 — 개발 검증 (PR #20 병합 전 기록)

- 기준 main `1ecd72e`의 이메일 로그인 변경을 보존해 통합했다. [기능·운영 경계](EXECUTION-LOOP.ko.md), [승인 범위](EXECUTION-LOOP-PLAN.ko.md).
- 사실 버전/출처/유효기한, 실제 PNG 제작·저장, 계정·소재·예정 비용 승인, Buffer Instagram 어댑터, 주문의 캠페인·소재 귀속을 구현했다.
- 새 통합 회귀: 실행49, 이메일 권한10, 사실31, 주문귀속22 passed. real SQLite / mocked Buffer·HTTP·R2.
- 브라우저: 기본 Playwright12 passed(real Chromium Canvas·로컬 D1/R2, mocked 로그인 헤더), 이메일 인증1 passed(real 로컬 쿠키 세션).
- TypeScript passed; lint gate passed(107 errors/108 기준선, 44 warnings/44 기준선). 기존 lint 오류를 0으로 보고하지 않는다.
- 코드·보안 리뷰의 게시 결과 유실, 예약 캠페인 삭제, 잘못된 PNG, 승인 계정 경합, 업로드/요청 한도 문제를 보완했다. 수정 한도에서도 사실 확인 철회가 가능하다.
- 실제 Buffer 계정 검증·외부 호스팅·SNS 게시: not_run(연결 계정·호스트 미제공). 실제 광고비/모델 비용의 하드캡, 자동 CRM, GEO 모니터링은 후속 범위다. 커버리지 비율: not_run.
- 소스 병합/게시/runtime-verified는 이 구현 테스트 결과와 별도로 후속 배포 기록에 남긴다.

### 2026-09-23 07:09 UTC 기록 — 이메일 로그인 게시와 공개 전환 (PR #18, 1ecd72e)

PR #19(`docs/email-auth-release`, 커밋 aa06574·b242019)가 기록했으나 `main`에 병합되지 않은 내용을 옮겼다. 당시 "관리자 초기 설정 대기"였고, 이후 관리자 계정 설정과 runtime-verified는 위 표에 있다.

- PR #18 merged: `1ecd72e94101e5e3d3a098eb1e86804d70f9d03c`. Sites published: `appgdep_6ab378faf33c81919101aff6ff1aef8a`, 환경 revision4. 사용자 지정 이메일을 초기 관리자 secret으로 설정하고 기존 owner에 연결했다. 비밀번호·초기 토큰 원문은 저장소에 저장하지 않았다.
- 실제 운영 검사 passed: `/api/auth` 200(mode=email/user=null), 익명·위조 GPT 헤더 업무 조회401, native scrypt를 실행하는 미등록 계정 로그인401. 운영 자료 조회와 `/api/version` tree 검증은 관리자 비밀번호 설정 전이므로 not_run; 전체 runtime-verified는 아직 아니었다.
- 사용자 명시 승인으로 Sites 접근을 public(revision2)으로 전환했다. 무자격 GET `/`200(GPT 게이트/리다이렉트 없음), `/api/auth`200(email/null), 업무 API 익명·위조헤더401, 계정 API401 확인. 초기 등록 링크는 사용자에게 전달했으며 본인이 비밀번호를 설정한 뒤 bootstrap 환경 제거와 운영 자료/tree 확인을 이어가기로 했다.
- CI: verify 모두 passed. 동일 최종 소스 push 실행35829036803은 기존10+이메일1 브라우저 passed. PR 실행35829042093은 테스트 서버 종료 뒤 연결 거부로 failed(원인 미확정). 공개/운영 인증 성공과 이 비차단 검사 실패를 혼동하지 않는다.
- [게시 기록](releases/2026-09-23-1ecd72e.md), [운영 설정·전환·복구 및 검증 근거](EMAIL-AUTH.ko.md).

### 2026-09-23 06:34 UTC 기록 — 이메일 로그인 구현 및 로컬 검증 (당시 운영 미적용)

- 사용자가 이메일+비밀번호 및 관리자 초대 방식을 승인했다. 기준 `d96a6cae30076dd429ccaae21074216d33075264`, 별도 `feat/email-auth` 브랜치.
- 기존 owner 연결 보존, 초대·재설정 일회 링크, 30일 세션, 관리자 권한 제한을 구현했다. GPT 헤더는 이메일 모드에서 인증에 사용하지 않는다.
- tests passed 23/23 suites, runner 집계737 assertions와 별도 node:test 인증20개. SQLite/native crypto real, Cloudflare 환경 adapter/모델응답 mocked.
- build/typecheck passed. 기존 브라우저10/10 및 이메일 브라우저1/1 passed. 이메일 여정은 real HTTPS Chromium/local workerd/D1/native scrypt로 실행했다.
- lint 기준선 gate passed, errors106/108·warnings44/44(0 errors 의미 아님). 독립 코드·DB·보안 검토 CRITICAL/HIGH 0, pending 초대 재발급 UI와 요청한도 소진 시 로그아웃 차단 지적 수정. 만료 인증 레코드 정리는 후속 운영 과제로 기록했다. 운영 게시·운영 CPU 한도·실제 Android 이메일 로그인은 not_run.
- 남은 입력: 최초 관리자 이메일. 사이트 진입 화면 공개 전환은 사용자 명시 승인 후 진행하며 자체 업무 API 보호를 먼저 검증한다. 운영 데이터와 Sites 접근은 변경하지 않았다.
- [운영 설정·전환·복구 및 검증 근거](EMAIL-AUTH.ko.md).

### 소스와 배포 — a67a318, Sites 버전21 (당시 기록)

- 제품 소스: `a67a318abd024880389f5dde5e8923bc2ca60657` (PR #15 merged, main CI passed).
- Sites 버전 21 published, 환경 revision 3 유지. 배포 `appgdep_6ab36c7589b881919fb9302d31532b86` succeeded.
- runtime-verified: 로그인한 운영 브라우저의 `/api/version`가 tree `b57380bb9ade2e2aea7a1ee5fc8fcff92ace6b7f`를 반환해 제품 소스와 일치했다.
- 이 상태 기록의 후속 문서 커밋은 별도 게시하지 않는다. 운영 기준은 위 제품 커밋이며 문서 전용 main 후속 커밋과 구분한다. [게시 증거](releases/2026-09-23-a67a318.md).

### ODA 실사용 후속 보완 — 운영 적용 (a67a318 당시)

사용자가 실제 ODA 오류 분석 뒤 구현을 승인했다. 역할별 결과 계약·재작성/후속 무효화, 회의 실패 단계 재작성, 서버 단일 진행, 업종·측정 규칙, 사용량 진단을 보완해 PR #15로 병합·게시했다. [상세](ODA-EXECUTION-FIXES.ko.md).

- 테스트: passed, 21/21 suites (real SQLite/핸들러, mocked 모델 공급자).
- Playwright: passed, 10/10 (real Chromium/로컬 D1, mocked 인증; 새 회의 검사는 응답/작업자 상태도 mocked).
- TypeScript 및 build: passed, exit 0. lint gate: passed, errors106/기준108, warnings44/기준44.
- 코드 검토의 후속 작업물 무효화와 재작성 UI 지적을 수정했다.
- 커버리지 비율: not_run. 구조 검증을 사실 정확성 검증으로 해석하지 않는다.
- 운영 화면에서 기존 Insight 재질문을 보완 필요로 차단하고 재작성 버튼을 제공하는 것을 확인했다. 실제 재작성 1건도 성공했다(23,216 tokens, 비용 미확인). 근거 구분과 30일 성숙 코호트 정의를 원문에서 확인했으며, 전체 캠페인 완료를 의미하지 않는다. [게시 기록](releases/2026-09-23-a67a318.md).

### 이전 버전 20의 보완

1. 역할·바이럴 접수의 원자 저장, 멱등 복구, 활성 실행 전체 조회.
2. 실패·취소·형식 오류를 포함한 사용량 원장, 수동 가격 버전과 nullable 비용, 설정 UI.
3. machine worker의 역할·회의·바이럴·초안 진행, 캠페인 연속 실행 동의/중단, 조사·측정 공정 순환.
4. 캠페인 상세 및 이전 원문 비교, 출처·기간·범위와 미확인 비용 보존, stale 수정 거부.
5. 요청/외부 응답 스트림 제한, 설치 파일 관리자 제한, 읽기 전용 운영 인증 probe.

상세와 적용 조건: [실행·사용량·작업물 보완](RELIABILITY.ko.md), [보안 경계](SECURITY-BOUNDARIES.ko.md).

### 이전 버전 20의 검증 기록

| 검사 | 상태 | 근거 |
|---|---|---|
| `node scripts/test.mjs` | passed · 16/16 suites, 646 assertions | real SQLite·핸들러 / mocked 외부 공급자 |
| `node node_modules/typescript/bin/tsc --noEmit` | passed · exit 0 | real 정적 검사 |
| `node scripts/lint-gate.mjs` | passed · errors 106/108, warnings 42/44 | real 정적 검사, lint zero가 아님 |
| `node scripts/run-framework.mjs build` | passed · exit 0 | real 로컬 빌드 |
| `node node_modules/@playwright/test/cli.js test` | passed · 8/8, 18.0초 | real Chromium·로컬 D1 / mocked 인증 헤더 |
| `python3 tests/research_worker_test.py` | passed · 4/4 | mocked gateway / real 로컬 HTTP |
| 운영 익명·위조·중복 인증 헤더 GET | passed · 각 HTTP 401 | real, 기존 운영 사이트 읽기 요청 3건 |
| 원본 Worker 직접 접근·로그인 사용자 간 운영 격리 | not_run | 직접 origin 및 두 사용자 세션 미제공 |
| Sites 게시 및 runtime tree | passed · real | 버전 20, 제품 tree 일치 |
| 운영 워커·설치 관리자 | passed · real | registered/activated/online/canInstall true, systemd active/running |
| 새 유료 모델·커넥터 호출 | not_run | 게시 검증은 읽기 전용, 실호출 비용 미발생 |

복구·공정 큐·terminal 오류·원장 후속 실패·기존 성과 버전 전환은 회귀 실패를 먼저 확인한 뒤 수정했다. 코드·보안 교차 리뷰에서 발견한 HIGH/MEDIUM은 보완했다. 커버리지 백분율은 측정하지 않았다.

### 운영 적용과 남은 경계 (버전20 게시 당시)

- `RESEARCH_WORKER_ADMIN_IDS`에 기존 운영 워커의 실제 소유자 ID를 secret으로 설정하고 게시했다. 로그인 사용자 canInstall=true를 확인했다.
- 기존 worker tick 자격증명은 유지했다. 게시 이후 heartbeat 및 systemd active/running, queue idle을 확인했다. 기존 Python 프로토콜과 호환하므로 재설치·재발급·재시작하지 않았다.
- 새 사용량 UI와 기존 워크스페이스 데이터 조회를 운영 브라우저에서 확인했다. 단가는 미등록이며 임의 가격을 넣지 않았다.
- gateway의 도구 강제 읽기 전용 권한·직접 origin·실사용자 간 격리는 추가 운영 검증 대상이다. 설치 파일의 공통 gate는 여전히 신뢰된 관리자에게 제공된다.
- workspace 전체 본문 전송은 호환을 위해 유지한다. 페이지네이션 최적화와 고객별 협업 권한은 이번 변경에 포함하지 않았다.

### 과거 실제 실행

[2026-09-23 관측 기록](observations/2026-09-23-live-run.md)에 실제 8역할·회의·브랜드 조사 및 바이럴 조사 결과가 있다. 모의 테스트 통과와 과거 실호출은 별개의 근거다. 해당 문서의 총 18건 표에는 실패 1건이 포함되므로 모두 완료한 18건으로 해석하지 않는다. 강화된 품질 게이트 이후의 실호출 및 원문 경로 개선의 운영 게시 여부는 별도 확인한다.


## 레인 I (Codex — 브랜드 인터뷰 신규 제품 기능)
갱신: 2026-09-28 02:35 UTC
- 대표 신규 지시로 `feat/brand-interview-studio` 개발. 기준 `431e4175a9d8d581533979b4aa378bbcd8ff908d`. [범위·운영 인수](BRAND-INTERVIEW.ko.md).
- 구현: 필수 8섹션/추가 24질문, 수기 저장, 파일 드롭·원본 보관, 브라우저 녹음, HERMES 섹션 후보 정리·원문 인용 검증·선택 반영, 관리자 확정 후 기존 캠페인 근거 연결.
- 음성 전사: 로컬 STT 서비스 코드와 웹 어댑터 포함. 공유 HERMES 서버 설치 및 실제 음성 검증 `not_run`. Plaud MCP 직접 조회 미구현, Plaud TXT 첨부 가능.
- 게시 `not_run`: LANES의 레인 A 단독 게시를 유지. 이 작업은 성장1 종료 범위에 추가하지 않는다.
- 검사: 전체 185/185 스위트 12,701 assertions passed·mocked, 전사 큐 7 passed·mocked, typecheck/lint/build passed. 브라우저 E2E blocked(Chromium 다운로드 네트워크 실패). 다음: 브라우저 E2E·공유 서버 전사 설치 검증 → 레인 A 통합/게시 판단.

- 레인 I 후속: 업종별 질문지 11종+공통 선택·저장, 답변 보존, 추천/자동 정리 업종 반영. 이전 인터뷰 스튜디오는 #233 merged 및 Sites 50 runtime-verified(별도 기록 PR #236). 이번 업종 기능은 typecheck/lint/build 및 인터뷰 40 checks passed(mocked). 전체 검사와 모바일·데스크톱 E2E는 CI에서 확인 후 게시.

- 레인 I 캠페인 의사결정형 질문지: 대표의 실무 정보·질문 이유 요청으로 120질문 개정, 이유·캠페인 활용·근거 안내·가상 예시 표시. 기존 답변 보존. 타입/전용 검사 및 CI 확인 후 게시 예정.

### 주문·품목 운영 확인 목록 (2026-09-30 13:16 UTC)

- [운영 확인 계약](GROWTH-2-OPERATION-REVIEW.ko.md): 재대사·미출고·취소/환불 후 할당·공유 재고 미확인/부족을 현재 캠페인에 모으고 정확한 기존 폼으로 이동한다. 원안 G2-30/32 부분 구현, 외부 실행0.
- 도메인32/기존 운영API49, 타입·빌드·E2E4 passed. real local D1/API/Chromium이며 인증 및 실패 응답만 mocked. 독립 리뷰 HIGH/MED0, lint 기존70/39 기준선 passed. 전체278/278 suites·16,295 assertions passed(외부 mocked). 추가 전체 브라우저142개(모바일71+데스크톱71) passed, 6.8분·실패0. 실제 Chromium/로컬 D1 및 기존 Meta·보고서·오류 명시 mock 혼합. #283 HEAD7583f2f pushed·CI 진행 중.
- #280은 main6c0c54f로 merged, Sites78 published/runtime-verified([증거](releases/2026-09-30-6c0c54f.md)). #281은 main15f3639로 merged, Sites79 published/runtime-verified([증거](releases/2026-09-30-15f3639.md)). #282 기회·일정 보드는 CI 진행 중. 원안 전체는 미완료.

### 반품·환불 원인 근거 (2026-09-30 13:31 UTC)

- [사건별 원인 계약](GROWTH-2-RETURN-REASONS.ko.md): 기존 return/refund 사건에 운영자 확인 원인·내부 증빙을 연결한다. unknown을 유지하며 고객 원문·환불 실행·재고 변경을 추가하지 않는다. 정확 사건/품목/재고/범위·판과 실제 필드 digest를 확인하고 현재/이력/멱등 요청을 원자 저장한다.
- 도메인12/API33·종류 정책54 passed(real pure/memory SQL, 인증/runtime mocked·외부0). 타입 passed, 독립 code/security 리뷰 HIGH/MED0. 빌드·신규2/기존운영2 E2E4 passed(real local D1/API/Chromium; 응답 유실/GET503만 mocked), 프롬프트22·lint70/39 기준선 passed. 최종 전체280/280 suites·16,341 assertions passed(외부 mocked). 아직 merged/published가 아니다.
- 앞선 운영 확인 목록 #283은 전체278/16,295·전체 브라우저142 passed 후 CI 중. #282는 원격 E2E1회 ECONNRESET(139pass/1fail) 뒤 해당 job 재실행 passed, 최종 CI4 passed 후 main71f6a65로 merged했다. 검증 head와 main tree diff0. 실패 기록은 삭제하지 않는다.
