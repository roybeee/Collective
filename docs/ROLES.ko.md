# 브랜드·점포 범위 역할 (G7)

에이전시(워크스페이스) → 고객사(브랜드) → 매장(지점) 3계층 위에 역할 범위를 얹는다. 데이터 소유는 바꾸지 않는다. 모든 업무 자료는 지금처럼 `records.owner = 워크스페이스`에 있고, 레코드 이관이나 D1 migration은 없다. 범위 역할은 그 위에서 무엇을 보고 무엇을 할 수 있는지만 정한다.

- 권한 표(정본): `lib/access.ts` `ROLE_MATRIX`, 판단 함수 `can(principal, action, resource)`
- 서버 가드: `lib/server-access.ts` `requireAccess(req, action, resource)`
- 배정 API: `app/api/accounts` `invite`(범위 역할)·`set_access`, 구현 `lib/access-accounts.ts`
- 기능 스위치: `scoped_roles`(기본 꺼짐)

## 저장 방식: 새 테이블 대신 records kind

`auth_memberships` 테이블 대신 `records` kind `membership`(행 id `<워크스페이스>:membership:<계정 id>`, 계정당 1행)으로 저장한다. 이유는 아래와 같다.

1. 저장소 관례: 새 저장은 records kind로 하고 D1 migration은 0건으로 둔다(`docs/GROWTH-PLAN.ko.md`, 각 기능 문서). migration `0003`까지는 인증 테이블과 인덱스만 추가했다.
2. 게시 경로: Sites 게시 작업은 D1을 바꾸지 않는다(`docs/PUBLISH.ko.md` 게시 작업 항목). 운영 D1 migration 리허설은 Phase 3 과제로 남아 있다. 테이블을 추가하면 게시와 별도로 운영 D1 적용 절차가 필요해진다.
3. 세션 모양 유지: 계정의 저장 역할(`auth_users.role`)은 `admin|member`만 쓰고, 세션 계산(`lib/auth-session.ts`)은 바꾸지 않는다. 범위 역할 계정은 저장 역할이 직원(`member`)이고 멤버십 행이 범위를 얹는다.

배정·변경·해제 기록은 `records` kind `access_change`에 남는다(대상 계정·이전/이후 역할과 브랜드·지점·변경한 사람·시각). 두 kind 모두 캠페인과 무관하다(`lib/record-kinds.ts`).

## 역할

| 역할 | 저장 역할 | 범위 | 요약 |
|---|---|---|---|
| 대표(owner) | admin(가장 먼저 만든 관리자) | 전체 | 기존 그대로 |
| 관리자(admin) | admin | 전체 | 기존 그대로(기능 스위치는 대표만) |
| 직원(member) | member, 멤버십 없음 | 전체 브랜드 | 기존 그대로(최종 승인·발행 403) |
| 브랜드 매니저(brand_manager) | member + 멤버십 | 배정 브랜드 | 본사 브랜드 담당. 배정 브랜드 안에서만 작성·AI 실행·승인·발행 |
| 점포 매니저(store_manager) | member + 멤버십 | 배정 지점(브랜드는 지점에서 정함) | 점주. 배정 지점 단위의 초안·승인·제출 표시·성과 기록 |
| 검토자(reviewer) | member + 멤버십 | 배정 브랜드 | 외부 검토자. 읽기와 작업물 검토 결정(승인·수정 요청)만 |

## 권한 표

범위: 전체 = 범위 없이 허용 · 브랜드 = 자원의 브랜드가 배정 브랜드 안 · 지점 = 자원의 지점이 배정 지점 안 · 브랜드+지점 = 배정 브랜드 안이고 지점 캠페인이면 배정 지점 · - = 거절.

| 작업(`action`) | 대표 | 관리자 | 직원 | 브랜드 매니저 | 점포 매니저 | 검토자 |
|---|---|---|---|---|---|---|
| `read_campaign` 캠페인·작업물 보기 | 전체 | 전체 | 전체 | 브랜드 | 브랜드+지점 | 브랜드 |
| `edit_campaign` 캠페인·작업물·성과 기록 | 전체 | 전체 | 전체 | 브랜드 | 지점 | - |
| `run_ai` 역할 실행·팀 회의 시작 | 전체 | 전체 | 전체 | 브랜드 | - | - |
| `approve_artifact` 작업물 최종 승인 | 전체 | 전체 | - | 브랜드 | 지점 | 브랜드 |
| `publish` 발행 승인·전송, 플레이스 초안 작업 | 전체 | 전체 | - | 브랜드 | 지점 | - |
| `spend` 광고 반영·활성화 | 전체 | 전체 | - | - | - | - |
| `send_customer` 카카오 승인·전송 | 전체 | 전체 | - | - | - | - |
| `manage_connections` 연결·화면 매핑 | 전체 | 전체 | - | - | - | - |
| `manage_flags` 기능 스위치 | 전체 | - | - | - | - | - |
| `manage_accounts` 계정·범위 배정 | 전체 | 전체 | - | - | - | - |
| `view_usage` 사용량 보기 | 전체 | 전체 | 전체 | - | - | - |
| `export_data` 내보내기 | 전체 | 전체 | - | - | - | - |

표는 각 역할이 가질 수 있는 최대치다. 경로의 기존 검사가 더 엄격하면 그대로 남는다. 예: Meta 광고 활성화(`/api/meta-ads/execution`)는 지금처럼 대표만, 카카오 연결·해제는 대표만이다. 관리자의 `spend`가 전체여도 이 경로들은 관리자에게 403이다. 대표·관리자·직원의 실제 경로별 권한은 `docs/SECURITY-BOUNDARIES.ko.md` 표가 정본이고, 이 변경으로 바뀐 칸은 없다.

## 가드를 단 경로

범위 없는 역할(대표·관리자·직원·legacy 헤더 사용자)은 자원을 읽지 않고 역할만으로 판단한다. 거절 문구도 기존(`관리자만 변경할 수 있습니다.`)과 같아 상태·순서·문구가 바뀌지 않는다. 범위 역할은 자원(캠페인·작업물·지점·플레이스 초안)을 읽어 브랜드·지점을 확인하고, 범위 밖이거나 없는 항목이면 `403 배정된 브랜드·지점 밖이거나 이 역할로 할 수 없는 작업입니다.`다(다른 브랜드 항목의 존재를 404로 드러내지 않는다).

| 경로 | 동작 | 작업 |
|---|---|---|
| `/api/workspace` GET | 브랜드·캠페인·작업물·성과·이벤트·실행·회의·발행·브리프 초안 목록 거르기, `access` 필드 추가, 가맹 모집 할 일 제외 | `read_campaign` |
| `/api/action` | `review_artifact` 승인 / 수정 요청 | `approve_artifact` / `read_campaign` |
| `/api/action` | `save_campaign`(새 브랜드와 기존 캠페인 브랜드 모두), `save_artifact`, `save_metric` | `edit_campaign` |
| `/api/execution` | `approve`·`execute` / GET | `publish` / `read_campaign` |
| `/api/meta-ads/execution` | POST(기존 대표 전용 뒤) / GET | `spend` / `read_campaign` |
| `/api/ads-proposals` | `approve` / `apply`(기존 관리자 전용 뒤) | `publish` / `spend` |
| `/api/kakao` | `approve`·`send` / `connect`·`disconnect`(기존 검사 뒤) | `send_customer` / `manage_connections` |
| `/api/place-drafts` | GET·초안 작업 / `declare_mapping`·`revoke_mapping` | `publish` / `manage_connections` |
| `/api/run` | `start`·`start_sequence` | `run_ai` |
| `/api/meetings` | `start` | `run_ai` |

플레이스 초안은 기존 서버 모듈(`lib/place-drafts-server.ts`)이 관리자 역할을 검사한다. 범위 검사를 통과한 범위 역할은 그 요청에 한해 관리자 단계로 넘긴다(기록에는 실제 계정 id가 남는다).

## 배정 방법

1. 대표가 기능 스위치에서 `scoped_roles`를 켠다(연결 및 설정 → 기능 스위치).
2. 팀 계정 관리에서 초대할 이메일과 역할(브랜드 매니저·점포 매니저·검토자)을 고르고, 담당 브랜드(점포 매니저는 담당 지점)를 체크한 뒤 초대 링크를 만든다. 계정은 직원으로 초대되고 같은 저장 묶음에서 멤버십과 변경 기록이 남는다.
3. 이미 있는 직원 계정은 목록의 `범위 역할 지정`으로 바꾼다. `범위 해제(직원으로)`는 범위를 지우고 모든 브랜드를 보는 직원으로 되돌린다.
4. 대표·관리자 모두 직원 계정의 범위를 배정할 수 있다(관리자 계정의 관리는 기존처럼 대표만). 관리자 계정에는 범위 역할을 줄 수 없고(409), 직원을 관리자로 올리면 멤버십이 지워진다.

API 예: `POST /api/accounts {"action":"invite","email":"hq@brand.example","role":"brand_manager","brandIds":["ofd"]}`, `{"action":"set_access","userId":"…","role":"store_manager","storeIds":["s1"]}`, 해제 `{"action":"set_access","userId":"…","role":"member"}`. 브랜드·지점은 최대 50개, 없는 브랜드·지점은 404, 빈 배정은 400, 같은 배정은 409다.

## 예시

- 본사 브랜드 매니저: OFD 본사 마케터에게 `brand_manager`·브랜드 OFD를 준다. OFD 캠페인만 보이고 OFD 작업물 승인과 발행 승인·전송을 한다. ODA 캠페인은 목록에 없고, 직접 요청해도 403이다. 광고 활성화·카카오 전송·연결은 대표·관리자가 한다.
- 점주: OFD 성수점 점주에게 `store_manager`·지점 성수점을 준다. OFD의 브랜드 단위 캠페인과 성수점 캠페인만 보이고, 다른 지점 캠페인은 안 보인다. 성수점 플레이스 초안 작성·승인·제출 표시와 성수점 캠페인의 작업물 승인·성과 기록을 한다. AI 실행은 하지 않는다.
- 외부 검토자: 고객사 검수 담당에게 `reviewer`·브랜드 ODA를 준다. ODA 캠페인과 작업물을 읽고 승인·수정 요청만 남긴다. 실행·발행·작성은 403이다. 로그인 없이 한 판만 보여 줄 때는 공유 링크(`docs/SHARE-LINKS.ko.md`)를 쓴다.

## 워크스페이스 전체로 남는 것

요금·사용량(`view_usage`), 기능 스위치, 연결(HERMES·Buffer·광고 계정·카카오 딜러), 계정 관리, 내보내기, 지출, 고객 발송은 브랜드로 나누지 않는다. 범위 역할에는 모두 없다.

## 스위치

`scoped_roles`가 꺼지면 새 범위 역할 초대·배정이 409다. 범위 해제와 이미 배정된 범위의 적용은 계속된다(스위치를 꺼서 범위가 풀려 권한이 넓어지지 않게). 스위치가 꺼져 있고 멤버십이 없으면 계정 관리 응답은 이전과 같다.

## 아직 범위를 걸지 않은 곳

이번 판은 위 표의 고위험 경로만 가드한다. 그 밖의 캠페인 단위 조회 API(예: 캠페인 상세·자료 요청·고객 보고서·브랜드 사실·아카이브 GET)는 범위 역할에게 아직 거르지 않는다. 캠페인 id를 알면 읽을 수 있으므로, 범위 역할을 운영에서 쓰기 전에 다음 판에서 같은 `requireAccess`로 가드한다. 화면의 승인 버튼은 아직 저장 역할(직원) 기준으로 그려져, 브랜드 매니저에게는 비활성으로 보인다(서버는 허용).

## 경로별 범위 가드

위 '아직 범위를 걸지 않은 곳'의 조회 경로를 전수 분류해 가드했다(app 아래 GET 처리기 118개). 가드는 `lib/server-access.ts`의 조회 도우미(`requireCampaignRead`·`requireArtifactRead`·`requireBrandRead`·`requireLinkedCampaignRead`·`requireLinkedBrandRead`·`requireStoreRead`·`denyScoped`)와 목록 거르기(`readableCampaignIds`·`readableCampaigns`·`scopedPrincipal`·`scopeByBrandStore`·`scopeStores`)다. 모두 범위 없는 역할(대표·관리자·직원·legacy 헤더)에는 자원을 읽지 않고 통과하므로(`roleOnly`) 그 역할들의 상태·응답·오류 순서는 이전과 같다. 범위 역할은 배정 밖이거나 없는 항목이면 `403 SCOPE_DENIED`(존재 여부를 404로 드러내지 않음), 목록은 볼 수 있는 항목만 남는다. 회귀: `tests/scoped-roles-reads.test.mjs`.

지점 운영 자료 규칙(`canReadStore`): 브랜드 매니저는 배정 브랜드의 모든 지점, 점포 매니저는 배정 지점만, 검토자는 지점을 따로 배정받았을 때만 읽는다(검토자는 작업물 검토용이라 장부·주문·점검은 기본으로 보지 않는다). 브랜드·지점을 함께 가진 목록(사실·자료 요청·조사 작업)도 지점 항목은 이 규칙을 따른다.

| 분류 | 경로(GET) | 범위 역할 동작 |
|---|---|---|
| 캠페인 단위(새 가드 32) | `/api/campaigns/[id]`, `/api/meetings`, `/api/directives`, `/api/campaign-attribution`, `/api/measurements`, `/api/artifact-sources`(`artifact`·`campaign`), `/api/execution/asset`(소재·코드 넣은 PNG의 캠페인), `/api/creative-score`(`artifactId`·`brandId`), `/api/meta-ads` 와 `assets`·`budget`·`bundle`·`conversions`·`create`·`creative`·`experiments`·`insights`·`learning`·`paused`·`report`·`reservations`, `/api/growth` 와 `authority`·`decisions`·`demand`·`execution`·`journey`·`operations`·`profit`·`provider-catalog`·`publication-observation`·`summary` | `read_campaign`(캠페인의 브랜드·지점) 밖이면 403 |
| 브랜드 단위(새 가드 9) | `/api/archive`, `/api/archive/file`(자료의 브랜드), `/api/archive/interview`, `/api/brand-facts`(브랜드·지점, 목록은 거름), `/api/brand-voice`, `/api/brand-learn`, `/api/reflector`, `/api/data-requests`(캠페인·브랜드, 목록은 거름), `/api/channels`(`brandId`·`storeId`를 줄 때) | 배정 브랜드 밖 403 |
| 지점 단위(새 가드 6) | `/api/stores`(목록 거름·`storeId` 상세 가드), `/api/store-operations`, `/api/place-checks`, `/api/store-browser`, `/api/storefront-orders`, `/api/storefront-webhooks` | `canReadStore` 밖 403 |
| 목록 거르기(새 가드 5) | `/api/search`(볼 수 있는 캠페인의 기록만, 20건), `/api/agenda`(볼 수 있는 캠페인만 모아 개수도 다시 셈, `lib/agenda-server.ts` 선택 인자 `visible`), `/api/run`(최근 실행), `/api/share`(작업물 링크는 볼 수 있는 캠페인의 것만, 고객 보고서 링크는 403), `/api/archive/research?jobs=active`(조사 작업) | 범위 밖 항목 제외 |
| 워크스페이스 전체(새 가드 5) | `/api/learning`(브랜드를 가로지르는 학습 집계), `/api/scheduled-runs`(모든 캠페인 목록 포함), `/api/franchise`(가맹 모집, 워크스페이스 화면의 `franchiseTasks` 제외와 같은 판단), `/api/billing`·`/api/usage`(`view_usage`, 단 `/api/usage?grading=`은 캠페인 단위) | 403 |
| 이미 가드(G7, 4) | `/api/workspace`, `/api/execution`, `/api/meta-ads/execution`, `/api/place-drafts` | 기존 그대로 |
| 관리자·대표 전용(43) | `/api/accounts`, `/api/api-keys`, `/api/context-replay`, `/api/customer-reports`, `/api/daangn-ads`, `/api/eval`, `/api/geo`, `/api/kakao`, `/api/ads-proposals`, `/api/pos/tossplace`, `/api/product-research`(·`retention`·`validation`), `/api/prompts`, `/api/quality-console`, `/api/reward-lineage`, `/api/storefront-pulls`, `/api/usage/export`, `/api/campaigns/[id]/deletion`, `/api/growth`의 관리자 전용 조회 24개(`bundle-fulfillment`·`bundles`·`cash`·`cause-links`·`collaborations`·`conditional`·`consumer-delivery`·`consumer`·`cs-source`·`cs`·`daily`·`demand-evidence`·`detections`·`expansion`·`experiments`·`landing`·`lesson-applications`·`optimization`·`publication`·`reorder`·`return-reasons`·`signal-sources`·`sourcing`·`targets`) | 범위 역할은 저장 역할이 직원이라 기존 403 |
| 워크스페이스 공통·브랜드 자료 없음(10) | `/api/autonomy`, `/api/feature-flags`, `/api/growth/stop`, `/api/research-worker/setup`, `/api/rewrite`, `/api/version`, `/api/version/public`, `/api/brand-learn/sample`(테스트 고정물), `/api/auth`, `/api/auth/signup` (`/api/archive/research`의 도구 점검도 연결 단위) | 그대로 읽음 |
| 별도 인증(4) | `/api/share/[token]`(공유 토큰), `/media/[file]`(승인된 발행의 공개 해시), `/api/mcp`(API 키), `/api/store-browser/worker/asset`(작업자 인증) | 해당 없음 |

API 키(`lib/api-keys-server.ts` `resolveApiKey`): 이메일 모드에서는 키를 만든 계정이 지금도 그 워크스페이스의 활성 관리자(`auth_users.role='admin' AND status='active'`)여야 한다. 접근 해제(disabled)·직원 강등·다른 워크스페이스면 키가 남아 있어도 MCP는 다른 실패와 같은 401이다(관리자 역할을 되찾으면 다시 쓴다). legacy 모드는 계정 표가 없어 검사하지 않는다.

남은 위험(이번 판 밖):
- 쓰기 경로 중 G7 표에 없는 것(예: `/api/archive` POST, `/api/archive/interview` POST, `/api/brief`, `/api/data-requests` POST, `/api/stores` POST, `/api/store-browser` POST, `/api/campaign-attribution` POST, `/api/directives` POST)은 범위 역할에게 아직 `edit_campaign` 가드가 없다. 응답이 쓰기 결과라 조회 누출은 아니지만 배정 밖 쓰기가 가능하다.
- 점포 매니저는 브랜드 단위 자료(아카이브·브랜드 보이스·학습 실행)를 배정 지점의 브랜드 범위로 읽는다. 아카이브 응답의 조사 목록에는 다른 지점의 조사가 섞일 수 있다.
- `/api/share` GET은 코드 주석과 달리 직원에게도 링크 목록을 준다(이번 판은 직원 동작을 바꾸지 않음).
