# 네이버 검색광고 쓰기 — 제안→승인→반영 (C4)

> 상태 어휘는 AGENTS.md를 따른다. 이 문서의 검증은 모두 `mocked`(fetch 스텁)다. 실계정 검증은 아래 8절의 칸이 비어 있는 한 `not_run`이다.

## 1. 한 줄 요약

규칙이 **제안**을 만들고(라벨 `추정·규칙 기반, 자동 적용 없음`), **소유자·관리자가 승인**하면, 승인된 제안 하나당 **서명한 POST/PUT 1회**로 네이버 검색광고에 반영하고, 반영 직후 **GET으로 다시 읽어** `verified`/`mismatch`를 판정한다. 자동 입찰·자동 적용은 없다. 기능 스위치 `naver_ads_write`는 기본 꺼짐이다.

## 2. 파일

| 파일 | 역할 |
|---|---|
| `lib/connectors/naver-ads.ts` | 서명(`sign`·`signedHeaders`·`signedRequest`)과 기존 GET 수집(`collect`·`verify`, 동작 불변). `call`은 읽기 대조에도 쓴다. |
| `lib/connectors/naver-ads-write.ts` | 작업 → 요청 빌더(`buildWriteRequest`), 한도 큐·백오프 실행(`executeWrite`), 읽기 대조(`readBack`·`verifyReadBack`), 계약 하네스용 커넥터. |
| `lib/connectors/registry.ts` | 능력 `naver_ads.ncc.write`(T3, 기본 꺼짐, 스위치 `naver_ads_write`, 지점 단위 자격증명). |
| `lib/ads-proposals.ts` | 제안 모델(순수): 규칙 3개, 위험 등급, 상태 전이, 중복 제거, 14일 창. |
| `lib/ads-proposals-server.ts` | 저장(records kind `ads_proposal`), 생성·승인·반려·반영·대조. 스위치·권한·자율성 규칙 적용. |
| `app/api/ads-proposals/route.ts` | GET 목록(campaignId·storeId), POST `generate`·`create`·`approve`·`reject`·`apply`·`reconcile`. |
| `tests/naver-ads-write.test.mjs` · `tests/ads-proposals.test.mjs` | 서명 벡터, 요청 빌더, 429 백오프, unknown 규율, 계약 5 시나리오, 규칙 고정 통계, API 권한·스위치·대조. |

## 3. 소유자 준비(실제 계정)

1. 광고시스템 → 도구 → **API 사용 관리**에서 액세스 라이선스(API 키)와 비밀키를 만든다. 비밀키는 제3자에게 넘길 수 없다(API 이용약관 5조). COLLECTIVE는 **권한을 위임받은 계정**의 키를 써야 한다(FAQ).
2. **Customer ID**(숫자)는 광고 계정 번호다.
3. 연결 및 설정 → 성과 수집 채널에서 `naver_ads` 자격증명을 **지점 단위**(브랜드·지점)로 저장한다. 저장 때 `GET /ncc/campaigns`로 검증한다(2xx여야 저장). 조회 우선순위는 지점 > 브랜드 > 워크스페이스 기본이다(`docs/CONNECTORS.ko.md` 4절).
4. 기능 스위치 `naver_ads_write`는 **제안 생성·조회·반려·미확인 대조에는 필요 없다**. 승인·반영을 하려면 소유자가 켠다.
5. 자율성 규칙(`autonomy_rules`가 켜져 있을 때) `budget_change`가 `never`면 승인·반영은 403이다. `ask`(기본)만 진행된다. `auto`는 고를 수 없다(T3).

## 4. 절대 자동으로 하지 않는 것

- 입찰가·중지·재개·키워드·캠페인·소재의 **어떤 쓰기도 사람이 승인하지 않으면 보내지 않는다**. 워커·예약 실행에서 쓰기를 부르지 않는다.
- 제안은 **읽기(GET /ncc/adgroups·/ncc/keywords·/stats)만**으로 만든다. 제안 생성이 외부 상태를 바꾸는 일은 없다(테스트가 GET만 썼는지 확인한다).
- 결과를 모르는 쓰기(타임아웃·연결 끊김·5xx)는 **다시 보내지 않는다**(아래 7절).
- 삭제(DELETE)는 어떤 경로에도 없다. 캠페인·그룹·키워드·소재를 지우는 작업은 만들지 않았다.
- 한 제안 = 한 쓰기. 승인 뒤 다시 승인하거나(400), 보낸 뒤 다시 반영(409)할 수 없다.

## 5. 규칙(제안 생성)

입력은 캠페인(네이버 `nccCampaignId`)의 광고그룹(최대 10) → 키워드 → `/stats` 14일 합계(`impCnt`·`clkCnt`·`salesAmt`·`ccnt`·`convAmt`·`avgRnk`, `ids` 100개씩)다. 창은 **어제(UTC)까지 14일**이며 오늘은 집계 지연 때문에 넣지 않는다.

| 규칙 id | 조건 | 제안 | 등급 |
|---|---|---|---|
| `zero_clicks_14d` | 노출 > 0, 클릭 0, 아직 중지 아님 | 키워드 중지(`userLock:true`) | T2 |
| `cpa_above_target` | 목표 CPA 입력, 전환 ≥ 1, CPA > 목표×1.2 | 입찰가 10% 인하(10원 단위) | T2(≤20%) |
| `rank_low_efficient` | 평균 순위 > 3, 클릭 ≥ 10, (ROAS ≥ 목표 ROAS(기본 3) 또는 CPA ≤ 목표 CPA) | 입찰가 10% 인상 | T2(≤20%) |

키워드마다 최대 1건(우선순위 중지 > 인하 > 인상). 같은 대상·규칙의 **열린** 제안(draft·approved·unknown·applied)이 있으면 다시 만들지 않는다. 모든 제안 본문에는 `추정·규칙 기반, 자동 적용 없음`과 근거(규칙 id·창·지표)가 들어간다. "ROAS"는 `/stats`의 `convAmt`(전환 매출)÷`salesAmt`로 계산하며, `convAmt`가 없으면 CPA만 본다.

사람이 직접 쓰는 제안(`action:'create'`): `create_keywords`·`create_campaign`·`resume`. 모두 **새 지출이라 T3**이며 입력은 반영 때와 같은 빌더(`buildWriteRequest`)를 먼저 통과해야 저장된다. 입찰가 변경 >20%도 T3이다.

## 6. 상태와 전이

```
draft → approved → applied → verified | mismatch
      → rejected            → failed
                 → unknown  → applied(→verified) | failed      ※ unknown 뒤는 읽기 대조(reconcile)로만
```

- `approve`: 관리자 + 스위치 켜짐 + `budget_change` ≠ never. 꺼져 있으면 **409 `쓰기 스위치 꺼짐`**.
- `apply`: 같은 조건. 보내기 **전에** `write.state='sent'`를 저장하고(저널), 결과로 `done`·`unknown`·`failed`를 적는다. `done`이면 바로 읽기 대조 → `verified`/`mismatch`.
- `reconcile`: `unknown`(또는 `sent`로 멈춘) 제안만. GET으로 다시 읽어 기대 상태와 같으면 `applied→verified`, 아니면 `failed`(반영되지 않음). 스위치와 무관(쓰기 없음).
- `reject`: 관리자, 스위치 무관.

## 7. 429·타임아웃·결과 미확인

- FAQ(2026-11-04 판): 호출량 제한은 없고 **광고주(Customer ID)별 호출 속도 제한**이 있다. 숫자는 비공개이며 초 단위 이하에서 측정하고, 초과하면 **HTTP 429**다.
- 큐(`lib/connectors/rate-queue.ts`)는 Customer ID 키마다 `perSecond 5 · perMinute 120 · perDay 3000`(보수적 초깃값) 안에서 보낸다. 429를 받으면 `Retry-After`가 있으면 그 시간, 없으면 500ms·2ⁿ 지터(0.5~1.5배) 백오프로 최대 3회 시도한다. 3회 모두 429면 `rate_limited`로 끝나고 제안은 `failed`가 된다(다시 승인·반영 가능).
- **보낸 뒤 결과를 모르는 경우**(응답 대기 중 타임아웃, 연결 끊김, 5xx) 결과는 `unknown`이며 **자동 재시도하지 않는다**. 워커 환경은 '연결 전 실패'와 '보낸 뒤 끊김'을 구분하지 못하므로 쓰기는 fetch 예외를 모두 `unknown`으로 본다. 판정은 `reconcile`(읽기)로만 한다.
- 4xx는 재시도 없이 `failed`이며 네이버 오류 본문의 `code·title·detail`만 사유로 남긴다(키·토큰 없음).
- `X-Timestamp`는 호출 직전에 만든다(FAQ 'Invalid Timestamp' 403). 시계가 어긋나면 서버 NTP를 확인한다.

## 8. 실계정 검증 기록(비어 있음 = not_run)

이 판은 **실계정으로 한 번도 보내지 않았다**. 아래 칸을 채운 뒤에만 운영에서 켠다.

| 항목 | 상태 | 날짜 | 기록 |
|---|---|---|---|
| 파워링크 키워드 입찰가 PUT(`/ncc/keywords?fields=bidAmt`) → 읽기 대조 | not_run | | |
| 키워드 중지·재개 PUT(`fields=userLock`) | not_run | | |
| 키워드 추가 POST(`/ncc/keywords?nccAdgroupId=`) ≤100건 | not_run | | |
| **PLACE 캠페인 생성**(`campaignTp:'PLACE'`) | not_run | | ads.naver.com FAQ는 API가 파워링크 중심이라고 안내한다. FAQ 위키는 PLACE 캠페인에 PLACE·LOCAL_AD 그룹 유형과 PLACE 사업 채널만 허용한다고 적지만 **API로 생성이 허용되는지는 미확인**이다. |
| **LOCAL_AD 광고그룹 생성**(`adgroupType:'LOCAL_AD'`) | not_run | | 그룹 생성 본문의 `adgroupType` 필드 이름은 가정이다. |
| **플레이스 소재**(`type:'LOCAL_AD'` 또는 `PLACE_AD`) 생성 | not_run | | 소재 유형 이름은 FAQ 응답 JSON 설명에서 가져왔다. 생성 본문 형태(설명·이미지)는 가정이다. 2026-09-16 릴리스 노트의 `ADVOOST_PLACE_AD`는 **확인하지 못해 쓰지 않았다**. |
| 429 실제 수신과 Retry-After 유무 | not_run | | |
| 캠페인·광고그룹 `userLock` 단건 PUT | not_run | | 공식 python 샘플이 보여 주는 단건 경로만 쓴다. 목록 PUT은 미확인이라 만들지 않았다. |

## 9. 확인한 근거와 가정

- **확인**: 서명 식 `base64(HMAC-SHA256(secret, "{timestamp}.{method}.{uri}"))`, 헤더 `X-Timestamp`·`X-API-KEY`·`X-Customer`·`X-Signature` — `github.com/naver/searchad-apidoc` python-sample `signaturehelper.py`·`ad_management_sample.py`(2026-11-09 조회). 테스트는 고정 벡터와 `node:crypto` 독립 계산으로 대조한다.
- **확인**: `POST /ncc/adgroups`, `PUT /ncc/adgroups/{id}?fields=userLock`, `POST /ncc/keywords?nccAdgroupId=` 배열, `PUT /ncc/keywords?fields=userLock|bidAmt` 배열, `GET /stats?ids=…&fields=[…]&timeRange={since,until}` — 같은 샘플.
- **확인**: 속도 제한·429 안내, 캠페인 유형별 그룹 유형 표, 소재 유형(`TEXT_45`·`LOCAL_AD`·`PLACE_AD`) — 위키 FAQ(2026-11-04 수정판).
- **가정**: 캠페인 생성 본문 `{name, campaignTp, customerId, useDailyBudget, dailyBudget}`, 그룹 `adgroupType`, 플레이스 소재 본문, 429 `Retry-After` 헤더 유무, 한도 숫자. 실계정 검증(8절)으로 교정한다.
- `https://naver.github.io/searchad-apidoc`는 자바스크립트로만 렌더되어 이 세션에서는 본문을 읽지 못했다.

## 10. 범위 밖(이 판)

- 화면(제안 카드)은 없다. API만 완전하다. 다음 레인이 카드를 붙인다.
- 삭제, 예산(`dailyBudget`) 변경, 확장소재, 타게팅 쓰기는 없다.
- 학습 규칙(`lib/learning*.ts`) 연결은 `rationale.evidence.learningRuleIds`(빈 배열) 자리만 두었다.
- 워커 자동 제안 생성은 없다(사람이 `generate`를 누른다).

## 11. 제안 주간 자동 생성 (레인 C 마감)

- 워커 큐 `ads_proposal_auto`(`lib/ads-proposals-auto-server.ts`)는 스위치 `scheduled_runs`와 채널 스위치(`naver_ads_write`·`daangn_ads`)가 함께 켜진 채널만 돈다. 둘 중 하나라도 꺼지면 순환에 큐 이름이 나타나지 않는다.
- 연결된 광고 계정(`channel_credential`의 지점·브랜드·워크스페이스 단위)마다 KST 주(월요일 날짜) 1회, 캠페인 목록 GET에서 최대 5개 캠페인에 5절 규칙(당근은 DAANGN-ADS 3절)을 돌려 **초안 제안만** 만든다. 승인·반영은 하지 않고 외부 호출은 읽기뿐이다. 한 tick에 계정 최대 3개.
- 만든 초안은 기존 출처(`lib/agenda-workspace-sources.ts adsProposalItem`)로 오늘의 안건 '결정' 탭에 승인 대기로 보인다. 같은 대상·규칙의 열린 제안은 다시 만들지 않는다(`dedupeAgainst`).
- 실행 기록 kind `ads_proposal_auto_run`(id `채널:브랜드:지점:주`)이 멱등 키다. 오류는 기록에 남기고 다음 주에 다시 돈다.
