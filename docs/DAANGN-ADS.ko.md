# 당근 광고 OpenAPI (C8)

광고주별 당근 광고 OpenAPI 키로 캠페인·광고그룹·소재와 기간 성과를 읽고, 규칙 기반 제안을 사람이 승인하면 한 번 반영한 뒤 다시 읽어 확인한다. 자동 적용·자동 예산 변경은 없다. 기능 스위치 `daangn_ads`(기본 꺼짐).

## 1. 근거와 가정

2026-11-09 조사 요약(원문 페이지는 이번 작업에서 열지 않았다. 아래 '가정'은 실계정으로 확인해야 한다).

| 항목 | 내용 | 상태 |
| --- | --- | --- |
| 공개 범위 | 2026-10-16부터 공개 베타 (business.daangn.com/notice/detail/420) | 조사 결과 |
| 문서 | ads-openapi.kr.karrotmarket.com | 조사 결과 |
| 읽기 | 캠페인·광고그룹·소재, 기간 성과 | 조사 결과 |
| 쓰기 | 캠페인·광고그룹·소재 등록·수정, 전환 이벤트 전송 | 조사 결과 |
| 키 | 광고주별로 온라인 문의로 발급, 재발급하면 이전 키는 폐기 | 조사 결과 |
| 대행사 | `v1/agency/business-rights` | 조사 결과 |
| 한도 | 광고 관리·성과 분당 60회(광고 계정 단위), 이벤트 전송 초당 100회, 초과 시 429 | 조사 결과 |
| 인증 헤더 | 기본 `x-api-key: <키>`, 선택 `Authorization: Bearer <키>` | **가정** (연결 때 `authHeader`로 고른다) |
| API 호스트 | `https://ads-openapi.kr.karrotmarket.com` | **가정** |
| 경로·필드 | `lib/connectors/daangn-ads.ts`의 `DAANGN_PATHS`, `PERF_KEYS`, `ID_KEYS` | **가정** — 실제 문서와 다르면 이 표만 고친다 |
| 예산 단위 | 원, 정수, 100원 단위, 1,000원~1억 원 | **가정** |
| 생성 상태 | 캠페인·광고그룹·소재는 항상 `PAUSED`로 만든다 | COLLECTIVE 규칙 |

## 2. 구조

- `lib/connectors/daangn-ads.ts`: 요청 빌더(`buildDaangnRequest`·`buildEventsRequest`), 읽기 클라이언트(`daangnReader`), 쓰기(`executeDaangnWrite`), 전환 이벤트(`sendConversionEvents`), 성과(`performanceByDay`·`collectPerformance`), 읽기 대조(`readBackDaangn`·`verifyDaangnReadBack`), 계약 하네스 커넥터.
- 모든 호출은 `lib/connectors/rate-queue.ts`를 지난다. 큐 키는 `daangn_ads:<광고 계정>:mgmt`(분당 60회, 읽기·쓰기 공용)와 `daangn_ads:<광고 계정>:events`(초당 100회)다. 429는 Retry-After를 따르고 없으면 지터 지수 백오프다.
- 보낸 뒤 결과를 모르는 쓰기(타임아웃·연결 끊김·5xx)는 `unknown`이며 자동 재시도하지 않는다. 읽기 대조(reconcile)로만 판정한다.
- 레지스트리(`lib/connectors/registry.ts`): `daangn_ads.management.read` T1, `daangn_ads.management.write` T3, `daangn_ads.conversion.send` T4. 요청서는 이벤트를 T2로 적었지만 레지스트리 규칙상 외부 쓰기는 T3 이상이고, `lib/connectors/types.ts`가 '전환 전송'을 T4로 정의해 T4로 두었다.
- 자격증명: `lib/channel-credentials.ts` 외부 채널 경로(`ExternalChannel`에 `daangn_ads` 추가). 지점 > 브랜드 > 워크스페이스 기본 순서로 찾고 암호문으로만 저장한다. 응답·로그·제안 레코드에 키 원문은 없다.

## 3. 제안·승인·반영 (C4 모델 재사용)

같은 kind `ads_proposal`에 `channel: 'daangn_ads'`로 저장한다(`lib/ads-proposals.ts`의 `DaangnAdsProposal`, 규칙은 `lib/ads-proposals-daangn.ts`, 서버는 `lib/ads-proposals-daangn-server.ts`). 14일 창(어제까지), 단위(캠페인·광고그룹)마다 최대 1건, 우선순위 중지 > 인하 > 인상.

| 규칙 | 조건 | 제안 | 등급 |
| --- | --- | --- | --- |
| `daangn_zero_clicks_14d` | 노출 > 0, 클릭 0 | 상태 `PAUSED` | T2 |
| `daangn_cpa_above_target` | 전환당 비용 > 목표 CPA | 일 예산 10% 인하 | T3(예산 변경) |
| `daangn_roas_good` | ROAS ≥ 목표(기본 3), 클릭 ≥ 10 | 일 예산 10% 인상 | T3(예산 변경) |

캠페인을 중지 제안하면 그 아래 광고그룹 제안은 만들지 않는다. 사람이 직접 적는 제안(T3): `resume`(상태 `ACTIVE`), `create_campaign`·`create_adgroup`·`create_creative`(모두 `PAUSED`), `update_creative`.

- 승인·반영: 소유자·관리자만, 자율성 규칙 `budget_change`(never → 403), 스위치 `daangn_ads` 꺼짐 → 409. 네이버 스위치 `naver_ads_write`와는 독립이다.
- 반영: 제안 하나당 쓰기 1회. 보내기 전에 저널 `sent`를 저장하고 결과를 모르면 `unknown`으로 남긴다. 성공하면 GET으로 다시 읽어 `verified`/`mismatch`.
- 대조(reconcile): 스위치와 무관(읽기만). 기대 상태면 `applied → verified`, 아니면 `failed`.

## 4. 성과 수집

`collect`가 대상 하나(캠페인·광고그룹)의 일별 성과를 합쳐 `lib/connectors/types.ts`의 `Collected` 모양으로 kind `daangn_ads_performance`(parent=지점)에 저장한다. 노출=분모, 클릭=분자, 광고비=spend, 전환=conversions. 모르는 값은 null(0과 구분)이고 한계(집계 지연·필드 가정)를 함께 남긴다.

기존 측정 초안(`lib/measurement-collection.ts`의 `measurement_draft`)에는 잇지 않았다. 그 경로는 커넥터 키 `ConnectorKey = 'naver_ads' | 'instagram'`(lib/channels.ts)과 `connectors` 맵·채널 연결 상태·기능 상태 행에 묶여 있어, 키를 늘리면 덧붙이기가 아니라 여러 공유 파일 변경이 된다. 실계정 필드 확인 뒤 별도 작업으로 잇는다.

## 5. API

`/api/daangn-ads` (소유자·관리자, 직원 403, 비로그인 401, 다른 출처 403)

| 메서드 | 작업 | 스위치 꺼짐 |
| --- | --- | --- |
| GET `?brandId&storeId` | 연결 상태(비밀값 없음)·저장된 성과 | 동작 |
| POST `connect` | `apiKey`, `adAccountId`, `authHeader?`(`x-api-key`·`bearer`), `agency?`, `brandId?`, `storeId?` — GET campaigns로 확인 뒤 저장. `agency: true`면 business-rights에 계정이 있어야 한다 | 409 |
| POST `verify` | 저장된 키로 다시 확인 | 409 |
| POST `revoke` | 저장된 키 삭제(당근 쪽 폐기는 광고주 재발급) | 동작 |
| POST `collect` | `level`(`campaign`·`adgroup`), `targetId`, `from?`, `to?`(기본 어제까지 14일) | 409 |

제안은 `/api/ads-proposals`에 `channel: 'daangn_ads'`를 붙인다(GET `?channel=daangn_ads`). `generate`(`campaignId`, `targetCpa?`, `targetRoas?`), `create`, `approve`, `reject`, `apply`, `reconcile`. 응답의 `enabledByChannel`이 채널별 스위치 상태다. 화면 카드는 이번 판에 없다(레인 X-F).

## 6. 하지 않은 것

- 실제 당근 광고 계정 호출(모든 검증은 fetch 스텁, mocked).
- 전환 이벤트를 주문 장부에서 만들어 보내는 경로(동의·식별자 해시 정책 포함). 커넥터 함수만 있다.
- 소재 이미지 업로드, 입찰 자동 조정, 예약 실행.
