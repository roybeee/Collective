# 커넥터 프레임워크 v2 (C1)

외부 시스템을 읽거나 쓰는 모든 경로를 **능력 서술자**로 적고, 호출 한도·429 백오프·결과 미확인 규율·자격증명 단위·계약 테스트를 한곳에서 정한다. 이 문서와 `lib/connectors/registry.ts`가 정본이다. 기존 커넥터(`instagram`·`naver_ads`)의 동작은 바꾸지 않았다. 서술자는 지금 코드가 하는 일을 적은 것이며, 한도 숫자는 운영 관측으로 조정하는 초깃값이다(공식 플랫폼 한도 자체가 아니다).

- 계획 출처: [GLOBAL-PLAN C1](GLOBAL-PLAN.ko.md)
- 코드: `lib/connectors/types.ts`(서술자 형식), `lib/connectors/registry.ts`(목록·규칙 검사), `lib/connectors/rate-queue.ts`(한도 큐·백오프·결과 분류), `lib/connectors/contract-test.ts`(계약 테스트 하네스·저널·모의 커넥터), `lib/channel-credentials.ts`(자격증명 단위, F5)
- 검증: `tests/connector-contract.test.mjs`

## 1. 능력 서술자

`ConnectorCapability = {key, reads, writes, riskTier, rateLimit, credentialScope, defaultOff:true, flag, retryUnknown:false}`

| 필드 | 뜻 |
|---|---|
| `key` | `<커넥터>.<자원>.<동작>` (예 `buffer.post.publish`). 중복 불가. |
| `reads` / `writes` | 읽는 자원·바꾸는 자원 이름. 둘 중 하나는 있어야 한다. |
| `riskTier` | **T1** 읽기(지표 조회) · **T2** 내부 상태 변경(장부·연결) · **T3** 외부에 보이는 쓰기(게시·이미지 업로드·PAUSED 생성·점포 정보 변경) · **T4** 돈·노출이 움직이는 쓰기(ACTIVE 광고, 전환 이벤트 전송). 쓰기가 있으면 T3 이상, 읽기만이면 T1·T2다. |
| `rateLimit` | 계정 키마다 적용하는 상한 `{perSecond?, perMinute?, perDay?}`. 하나 이상 필요. |
| `credentialScope` | 자격증명을 둘 수 있는 가장 좁은 단위 `workspace`·`brand`·`store`. |
| `defaultOff` | 상수 `true`. 모든 능력은 기능 스위치가 기본 꺼짐이다. |
| `flag` | 능력을 켜는 `lib/feature-flags.ts` 스위치 이름. 스위치 없이 늘 켜진 읽기(기존 성과 수집)는 `null`. |
| `retryUnknown` | 상수 `false`. 결과를 모르는 쓰기는 자동 재시도하지 않는다(3절). |

`describeViolations()`가 레지스트리 전체를 위 규칙으로 검사하고 테스트가 0건을 확인한다.

### 현재 등록(요약)

| 커넥터 | 능력 | 등급 | 스위치 |
|---|---|---|---|
| instagram | `instagram.insights.read` | T1 | 없음(수집) |
| naver_ads | `naver_ads.stats.read` | T1 | 없음(수집) |
| ftc_franchise | `ftc_franchise.stats.read` | T1 | `r_franchise` |
| buffer | `buffer.channels.read` / `buffer.post.publish` | T1 / T3 | 없음(발행 승인 게이트가 막는다) |
| meta_ads | `insights.read` / `image.upload` / `campaign.paused_write` / `child.create` | T1 / T3 / T3 / T3 | `meta_ads_bundle` / `meta_ads_image_upload` / `meta_ads_paused_write` / `meta_ads_child_create` |
| meta_ads | `campaign.execution` / `conversion.capi` | T4 / T4 | `meta_ads_execution` / `meta_ads_capi` |
| store_browser | `hours.read` / `hours.write` | T1 / T3 | `store_browser_execution` |

## 2. 한도 큐 (`lib/connectors/rate-queue.ts`)

- **순수**: fetch·D1·시계를 모른다. `now`·`random`·`sleep`을 받고 상태는 새 객체로 돌려준다(입력 불변).
- `reserve(state, key, limit, now)`: 계정 키마다 초·분·일 고정 창을 세고, 상한에 닿으면 `allowed:false`와 창이 열릴 때까지의 `waitMs`를 준다.
- `classifyOutcome(result, write)`: 2xx `success` · 429 `rate_limited` · 5xx/408 읽기 `retryable`, **쓰기 `unknown`** · 그 밖 4xx `fatal` · 보낸 뒤 타임아웃/끊김(`sent:true`) 쓰기 `unknown`, 읽기 `retryable` · 보내기 전 실패(`sent:false`) `retryable`.
- `retryAfterMs(header, now)`: `Retry-After` 초 또는 HTTP 날짜. 해석 불가면 `null`.
- `nextDelayMs({attempt, policy, retryAfterMs, random})`: Retry-After가 있으면 그 값(상한 안), 없으면 `base·2^(attempt-1)`에 0.5~1.5 지터, `maxDelayMs` 상한.
- `retryDecision(...)`: `success`·`fatal` 멈춤, **`unknown` 절대 재시도 없음**, `retryable`·`rate_limited`는 `maxAttempts`까지.
- `runWithBackoff(input, deps)`: 예약 → (쓰기면 `onBeforeSend`로 저널 '보냄' 기록) → 전송 → 분류 → 판단을 돈다.

## 3. 결과 미확인(unknown) 규율

쓰기를 보낸 뒤 결과를 모르면(타임아웃·연결 끊김·5xx) 그 작업은 `unknown`으로 남기고 **자동으로 다시 보내지 않는다**. 사람이 외부 계정에서 대조해 닫는다. 이는 `lib/meta-image-upload.ts`·`lib/meta-execution*.ts`·점포 브라우저가 이미 지키는 규율을 공통 큐·하네스에 옮긴 것이다. 읽기는 결과를 모르면 다시 읽어도 된다.

## 4. 자격증명 단위 (`lib/channel-credentials.ts`)

브랜드·지점 단위 자격증명은 **F5에서 이미 추가 방식으로 구현돼 있다**. 이번 PR은 저장 형식을 바꾸지 않았다.

- 레코드 id: `<owner>:channel_credential:<channel>[:<brandId>[:<storeId>]]`. 기존 소유자 단위 레코드(브랜드·지점 없음)는 그대로 워크스페이스 기본이다.
- 조회 우선순위: 지점 > 브랜드 > 워크스페이스 기본(`loadCredential` → `resolvedScope`). 다른 브랜드의 레코드는 후보가 되지 않는다.
- 서술자의 `credentialScope`는 그 능력이 쓸 수 있는 가장 좁은 단위다. `instagram`·`naver_ads`·`store_browser`는 `store`, Buffer·Meta는 브랜드 단위 연결(`publisher_credential`·Meta 연결 레코드)이다. Meta·Buffer 연결을 지점 단위로 나누려면 각 모듈의 레코드 id에 지점을 더하는 별도 PR이 필요하다(이번 범위 밖).

## 5. 계약 테스트 하네스 (`lib/connectors/contract-test.ts`)

AGENTS.md 품질 기준의 다섯 시나리오를 서술자를 구현한 어떤 커넥터에도 돌릴 수 있다.

```js
const results=await runContractScenarios(scriptedConnector(capabilities),{read:'x.items.read',write:'x.items.write'});
// results: [{scenario:'success'|'failure'|'timeout'|'restart_resume'|'duplicate_idempotent',passed,details}]
```

| 시나리오 | 기대 |
|---|---|
| success | 쓰기 1회 → 저널 `sent`→`done`, 결과 보존 |
| failure | 4xx 쓰기 → `fatal`, 재시도 없음 · 5xx 읽기 → 재시도해 성공 |
| timeout | 보낸 뒤 타임아웃 쓰기 → `unknown`, 재시도 없음 · 읽기 타임아웃 → 재시도 · 보내기 전 연결 실패 쓰기 → 재시도 |
| restart_resume | 저널에 `sent`/`unknown`으로 남은 쓰기 → 다시 보내지 않고 `unknown` · `pending` 읽기 → 다시 실행 |
| duplicate_idempotent | 같은 작업 id 두 번 → 한 번만 실행, 두 번째는 저장 결과(`cached`) |

- `ContractConnector`는 `capabilities`와 `execute(op, attempt) → AttemptResult`만 구현한다(네트워크 대신 결과 객체). 실제 커넥터는 fetch 응답을 `AttemptResult`로 옮기는 얇은 어댑터를 쓴다.
- `Journal`은 기본 메모리(`memoryJournal`)이며 D1 저널(기존 `meta_ads_image_upload` 같은 레코드)로 바꿔 끼운다. 쓰기는 보내기 **전에** `sent`를 적는다.
- 하네스가 규율 위반을 잡는지도 테스트한다(타임아웃을 5xx로 바꿔 숨기는 나쁜 커넥터는 timeout 시나리오에서 실패).

## 6. 새 커넥터 추가 순서

1. `lib/connectors/registry.ts`에 서술자를 더한다(`describeViolations()` 0건).
2. `AttemptResult`를 돌려주는 어댑터로 `runWithBackoff`(또는 `submit`)를 쓴다. 쓰기는 저널을 먼저 쓴다.
3. `tests/connector-contract.test.mjs`처럼 모의 커넥터로 `runContractScenarios`를 돌려 5 시나리오를 통과시킨다.
4. 능력을 켜는 기능 스위치(기본 꺼짐)와 `lib/feature-status.ts` 행을 더한다.

## 7. 범위 밖·미해결

- 기존 커넥터(`instagram`·`naver_ads`·Buffer·Meta·점포 브라우저)를 공통 큐·저널로 **옮기지 않았다**. 서술자만 적었고 각 모듈의 자체 재시도·저널은 그대로다.
- 서술자의 한도 숫자는 초깃값이다. 플랫폼 공식 한도와 운영 관측으로 조정한다.
- Buffer·Meta 연결의 지점 단위 분리(4절).
