# 자료 요청 (A6-1)

결론: 저장된 작업물의 '자료 필요' 표지를 결정론으로 뽑아 자료 요청(records kind `data_request`, 열림)으로 모은다. 관리자가 같은 항목의 사실을 확정해 유효 사실이 되면 요청이 자동으로 닫힌다(resolution `fact_confirmed`, 사실 id·판). 기능 스위치 `a6_data_requests`(기본 꺼짐, 소유자 단위)로 켠다. 모델 호출은 없고 실행기(역할·회의·브리프·발행)는 바꾸지 않는다.

비유: 작업물 여백에 적힌 "점주에게 영업시간 물어볼 것" 메모를 떼어 할 일 게시판에 붙이는 일이다. 사장이 영업시간을 사실 원장에 확정하면 그 메모는 저절로 '끝남' 칸으로 옮겨진다. 메모 원문은 작업물에 그대로 있다.

- 코드: `lib/data-requests.ts`(순수: 추출·항목 매핑·중복 제거·닫힘 판정), `lib/data-requests-server.ts`(수집·생성·닫기·필요 없음·다시 대조·`afterFactSaved`, 스위치 읽기), `app/api/data-requests/route.ts`, `app/data-requests-panel.tsx`(캠페인 상세 '작업물' 탭 끝)
- 사실 확정 경로: `app/api/brand-facts/route.ts`가 `save_fact` 저장 뒤 `afterFactSaved`를 부른다. `lib/brand-facts-server.ts` `saveBrandFact`는 바꾸지 않았다.
- 테스트: `tests/data-requests.test.mjs`(메모리 SQLite·합성 데이터·fetch 스텁, 외부 호출 0, `passed · mocked`)
- 근거: 개선 계획 `exec-loop-1`(게시 전 `자료 필요` 차단)·`data-truth-3`(지점 범위), [성장 계획](GROWTH-PLAN.ko.md) A6

## 데이터 계약 (kind `data_request`)

```json
{"id":"dr-3f9a1c2b7e10","brandId":"b1","storeId":"s1","campaignId":"c1","status":"open",
 "factKey":"hours","label":"영업시간","text":"[자료 필요: 점주/영업시간]","assignee":"점주",
 "origins":[{"kind":"artifact_marker","artifactId":"ai-…","artifactVersion":2,"role":"content","excerpt":"표지가 있는 줄 200자"},
            {"kind":"copy_pack","artifactId":"ai-…","artifactVersion":1,"channel":"Instagram 피드","variantId":"A"}],
 "createdBy":{"id":"acct","role":"member"},"createdAt":"…",
 "resolution":{"kind":"fact_confirmed","factId":"f1","factVersion":3,"by":{"id":"acct","role":"owner"},"at":"…"},
 "version":2,"updatedAt":"…"}
```

- parent는 브랜드 id다. 캠페인 요청은 `campaignId`를 가지고 캠페인 삭제 때 함께 지운다(links `data_campaign`, 삭제 대화상자 라벨 '자료 요청'). 캠페인 없이 만든 브랜드 요청은 남는다.
- id: `'dr-' + sha256(campaignId|storeId|factKey ?? 정규화 문구 60자)` 앞 12자. 같은 캠페인·지점·항목은 같은 id라서 다시 모으면 출처(origins)만 합친다(최근 10개).
- 상태: `open` | `closed`. 닫힘 근거는 `fact_confirmed`(사실 id·판) 또는 수동 `answered`·`dismissed`(메모 500자)다. 사람은 id와 역할만 남기고 이메일은 담지 않는다.
- `scopeWarning:'store_link_needed'`: 지점 없는 캠페인이 지점마다 다른 항목(카탈로그 `storeScoped`)을 요청한 경우다. 브랜드 범위로 만들고 화면에 '지점 연결 필요'를 보인다(data-truth-3).
- 상한: 수집 1회 새 요청 20건, 캠페인당 열린 요청 30건, 요청당 출처 10개.

## 추출 규칙 (`extractMarkers`·`extractCopyPackNeeds`)

| 대상 | 예 | 결과 |
|---|---|---|
| 항목이 적힌 `[자료 필요: 담당/항목]` | `[자료 필요: 점장/주차, 휴무일]` | 담당 '점장', 항목 '주차'·'휴무일' 두 건 |
| `자료 필요:`로 시작하는 줄 | `자료 필요: 매장 담당/전화번호` | 항목 '전화번호' |
| `## 자료 필요` 섹션(또는 굵은 제목)의 목록 | `- 좌석 수: 점장 확인` | 쌍점 앞 '좌석 수'. 다음 제목에서 섹션이 끝난다 |
| `[X 확인 필요]`의 X | `[가격 확인 필요]`, `[판매 조건(배송·교환·환불) 확인 필요]` | 항목 '가격', '판매 조건(배송·교환·환불)' |
| 카피 팩 `needsCheck` | 안 A의 `needsCheck:["가격"]` | `copyPackArtifactVersion === version`일 때만. 출처에 채널·안 id |

뽑지 않는 것:
- 맨 `[확인 필요]`. 광고 표현 신호(`unverifiedClaims`)다.
- X에 쌍점이 있는 `[… 확인 필요]`(예: `[가설: … 확인 필요]`).
- 금지·삭제를 말하는 줄(`lib/campaign-policy.ts` `unverifiedClaims`와 같은 기준: 쓰지 않·금지·제외·삭제).
- 지시문 틀을 되풀이한 항목('항목', '확인 담당' 등).
- 지금 브리프 판에서 쓸 수 없는 작업물. `artifactUsable`(검토·승인 상태, 현재 브리프 판, 재질문 아님)을 그대로 쓴다. outdated 작업물은 모으지 않는다.
- 사람이 고친 판의 카피 팩(`copyPackArtifactVersion`이 지금 판과 다름).

담당·항목 나누기: 빗금 앞이 담당, 뒤가 항목이다. 빗금이 없으면 모두 항목이다. 항목은 쉼표·세미콜론으로 나눈다. 가운뎃점은 '배달·포장' 같은 한 항목이라 나누지 않는다.

## 항목 매핑 (`factKeyOf`)

- 사실 카탈로그(`lib/fact-catalog.ts`)의 라벨·key·별칭(`canonicalFactKey`·`factCatalogItem`), 가맹 항목(`franchiseFactKey`)을 쓴다.
- 괄호 설명, 앞의 범위 말('매장·지점·점포·가게·우리·정확한·최신·현재'), 끝의 '확인·정보·자료·여부·수집·내용'을 뗀 나머지 전체가 카탈로그 항목일 때만 key다. 예: '매장 영업시간 확인' → `hours`.
- 낱말 하나만 맞는 경우는 고르지 않는다. 예: '포장 용기 규격'은 '포장'(배달·포장 별칭)이 있어도 `null`이다.
- key가 `null`인 요청은 자동으로 닫히지 않는다. 관리자가 수동으로 닫는다.

## 닫힘 판정 (`closingFact`)

- 유효 사실은 `effectiveBrandFacts`(`lib/brand-facts.ts`)를 그대로 쓴다. 확정, 근거 있음, 확인 시점 ≤ 지금 < 유효 기한, 범위, 지점 우선.
- 지점 요청은 그 지점 사실과 브랜드 공통 사실로 닫힌다.
- 브랜드 범위 요청은 브랜드 공통 사실로만 닫힌다. 지점 사실로는 닫히지 않는다.
- 후보·거절·만료·미래 확인일·근거 없는 사실로는 닫히지 않는다.
- 이미 유효 사실이 있는 항목은 모을 때 새로 만들지 않는다(`skipped.confirmed`). 닫힌 요청은 다시 모아도 열지 않는다(`skipped.closed`). 수동으로 같은 항목을 만들면 다시 연다.

## 사실 확정과 자동 닫기

- `/api/brand-facts` `save_fact`(관리자 확정 경로, `saveBrandFact` 불변)가 사실을 저장한 뒤 `afterFactSaved`를 부른다.
  - 스위치 꺼짐(또는 스위치 읽기 실패): `{}`를 돌려준다. 응답은 이전과 바이트 동일하다(`closedRequests` 키 없음).
  - 스위치 켜짐: 저장한 사실과 같은 항목의 열린 요청을 대조해 닫고 `closedRequests`(닫은 수)를 응답 끝에 싣는다. 확정 사실이 아니면 0이다.
  - 닫기가 실패하면 사실 저장은 유지하고 `closedRequests:null`이다(`flagPublicationsForFactChange`의 `reviewPublications:null` 선례와 같다).
- 사실 저장과 요청 닫기는 원자적이지 않다. 그래서 멱등 `reconcile`이 브랜드의 열린 요청을 지금 유효 사실과 다시 대조해 닫는다.
- `rebase_facts`(가맹 사실 옮기기)와 `import_candidates`(후보 가져오기)는 부르지 않는다. 필요하면 `reconcile`로 닫는다.
- 화면의 '사실 후보로 제안'은 기존 `/api/brand-facts` `save_fact`(candidate)를 그대로 부른다(exec-loop-1 확장). 직원도 제안할 수 있고, 관리자가 브랜드 아카이브에서 확정하면 요청이 닫힌다.

## API와 권한

| 작업 | 호출 | 대표·관리자 | 직원 |
|---|---|---|---|
| 조회 | GET `/api/data-requests?campaignId=` 또는 `?brandId=` | 허용 | 허용 |
| 모으기 | POST `collect` `{campaignId}` | 허용 | 허용 |
| 만들기 | POST `create` `{campaignId}` 또는 `{brandId, storeId?}`, `text`(120자), `assignee?`(40자) | 허용 | 허용 |
| 답변 완료로 닫기 | POST `close` `{id, version, note?}` | 허용 | 403 |
| 필요 없음 | POST `dismiss` `{id, version, note?}` | 허용 | 403 |
| 확정 사실과 다시 대조 | POST `reconcile` `{brandId}` 또는 `{campaignId}` | 허용 | 403 |

- 쓰기는 `secureMutation`, 소유자 변경 잠금(`acquireLock`), 호출 빈도 제한(`data_requests`, 분당 60)을 거친다.
- 판정 순서: 모르는 작업 400 → 권한 403 → 스위치 꺼짐 409. 수동 닫기는 `version` 비교(CAS)로 409, 이미 닫힌 요청 409, 같은 항목이 열려 있으면 만들기 409, 캠페인 열린 요청 30건이면 만들기 409다.
- 조회는 스위치와 무관하다. 응답의 `enabled`로 상태를 알린다.

## 스위치

- `a6_data_requests`(기본 꺼짐). 스위치는 `lib/data-requests-server.ts`에서만 읽는다. 실행기는 스위치를 직접 import하지 않는다(`tests/franchise-objective.test.mjs` 6).
- 켜기·끄기는 소유자만 한다(`/api/feature-flags`). 설정 기능표에 '자료 요청' 행이 있다.

## 남은 위험

- 추출은 표지 형식에 기대는 결정론이다. 모델이 다른 표기('추가 확인 요망' 등)를 쓰면 모으지 못한다. 형식 밖 표기는 수동 만들기로 보완한다.
- 섹션 목록의 '담당: 항목' 순서('점장: 좌석')는 담당을 항목으로 읽는다. 항목 key가 없어 자동으로 닫히지 않을 뿐 잘못 닫지는 않는다.
- 닫힌 요청은 사실이 나중에 만료되거나 철회돼도 다시 열리지 않는다. 게시 전 차단(`exec-loop-1`)은 계속 작업물 본문의 표지를 직접 본다.
- 발행 캡션 후보 판정과 플레이스 정보 대조(A6 후반부)는 이 PR 범위 밖이다.
