# 플레이스 정보 대조 (A6-2)

결론: 관리자가 지점별 네이버 플레이스 정보(주소·영업시간·휴무·전화·메뉴 가격)를 직접 옮겨 적은 수동 스냅샷(records kind `place_snapshot`)을 확정 사실과 결정론으로 대조한다. 다르거나 비어 있는 항목은 점포 할 일로 열고, 다시 대조해 일치하면 자동으로 완료한다. 확정 사실이 없는 항목은 A6-1 자료 요청으로 넘긴다. 기능 스위치 `a6_place_check`(기본 꺼짐, 소유자 단위)로 켠다. 모델 호출, 스크래핑, URL fetch는 없다.

비유: 가게 앞 간판(플레이스)과 사장님 장부(확정 사실)를 나란히 놓고 한 줄씩 맞춰 보는 일이다. 간판에 적힌 영업시간이 장부와 다르면 "간판 고치기" 쪽지를 붙인다. 간판을 고치든 장부를 고치든 둘이 다시 맞으면 쪽지는 저절로 떨어진다. 간판 사진은 사람이 찍어 오고, 시스템은 가게에 가 보지 않는다.

- 코드: `lib/place-check.ts`(순수: URL 검증·항목별 대조·할 일 계획·이력), `lib/place-check-server.ts`(저장·권한·스위치 읽기·사실 저장 뒤 재대조), `app/api/place-checks/route.ts`, `app/place-check-panel.tsx`(점포 마케팅 '채널 점검' 탭 아래)
- 연결: `lib/data-requests-server.ts` `afterFactSaved`가 사실 저장 뒤 `placeTasksAfterFact`를 부르고, `placeCheckRequests`가 fact_missing을 자료 요청으로 만든다. `lib/brand-facts-server.ts`·`app/api/stores/route.ts`는 바꾸지 않았다.
- 테스트: `tests/place-check.test.mjs`(메모리 SQLite·합성 데이터·fetch 스텁, 외부 호출 0, `passed · mocked`)
- 근거: `lib/connectors.ts`(네이버 플레이스는 공식 통계 API가 없어 수동 입력), `lib/archive-research.ts` `officialHosts`(place.naver.com·map.naver.com), [성장 계획](GROWTH-PLAN.ko.md) A6

## 데이터 계약

스냅샷(kind `place_snapshot`, parent 지점 id, id `<지점>:<플랫폼>`):

```json
{"id":"s1:naver_place","storeId":"s1","brandId":"b1","platform":"naver_place","url":"https://map.naver.com/p/entry/place/123",
 "checkedAt":"2027-02-01","checkedBy":{"id":"acct","role":"admin"},
 "fields":{"address":"…","hours":"매일 11:00-21:00","closed_days":"월","phone":"02-000-0000","menu_price":"떡볶이 5,000원"},
 "result":[{"field":"hours","state":"conflict","placeValue":"…","factId":"f1","factVersion":2,"factValue":"…"},
           {"field":"phone","state":"fact_missing"}],
 "version":3,"updatedAt":"…","history":[]}
```

- `result`는 다섯 항목 모두를 고정 순서(주소·영업시간·휴무·전화·메뉴 가격)로 담는다.
- `history`는 이전 판(이력 제외)을 최근 10판까지 담는다. 사람은 id와 역할만 남기고 이메일은 담지 않는다.
- 입력 상한: 항목은 다섯 개뿐이다(모르는 항목 400). 글자 수는 주소 200, 영업시간 300, 휴무 100, 전화 40, 메뉴 가격 1000, URL 500자까지다.

점포 할 일(kind `store_task`, 기존 kind에 선택 필드 `source`만 더함):

```json
{"id":"place:s1:naver_place:hours","storeId":"s1","reportId":"","title":"네이버 플레이스 영업시간이 확정 사실과 다릅니다","channel":"naver_place",
 "status":"open","evidence":"","source":{"kind":"place_check","platform":"naver_place","field":"hours","snapshotVersion":3,
 "factId":"f1","factVersion":2,"placeValue":"…","factValue":"…"},"version":1,"updatedAt":"…"}
```

- id는 `place:<지점>:<플랫폼>:<항목>`으로 고정이다. 같은 항목은 스냅샷을 다시 넣어도 할 일이 하나다.
- `reportId`가 `''`이라 보고서 할 일(`<보고서 id>-<순번>`)과 겹치지 않는다. 기존 진단 화면은 보고서 id로만 찾으므로 플레이스 할 일을 보이지 않는다.

## 상태와 처리

| 상태 | 뜻 | 처리 |
|---|---|---|
| `match` | 플레이스 값과 확정 사실이 일치 | 열린 할 일을 `done`으로 닫고 근거 `재대조 일치(스냅샷 vN)` |
| `conflict` | 둘 다 있는데 다름 | 할 일을 연다(있으면 새 판으로 갱신, 끝난 할 일은 다시 연다) |
| `place_missing` | 확정 사실은 있는데 플레이스 칸이 빔 | 할 일을 연다(`네이버 플레이스에 … 정보가 비어 있습니다`) |
| `fact_missing` | 플레이스 값은 있는데 확정 사실이 없음 | `a6_data_requests`가 켜져 있으면 지점 자료 요청(origin `place_check`). 할 일은 만들지 않는다 |
| `both_missing` | 둘 다 없음 | 아무것도 하지 않는다 |

- 유효 사실은 `effectiveBrandFacts(facts, brandId, storeId)`를 그대로 쓴다(확정·근거·확인 시점 ≤ 지금 < 유효 기한·지점 사실 우선). 지점 사실을 앞에 둔다.
- 정본은 확정 사실이다. 플레이스를 고쳐 다시 넣든 사실을 고치든, 다시 대조해 일치하면 닫는다.
- 자료 요청 id는 수동 지점 요청과 같은 씨앗(`|지점|항목`)이다. 같은 항목이 열려 있으면 출처만 합친다. 닫힌(답변·필요 없음) 요청은 다시 열지 않는다. 사실이 확정되면 A6-1 경로가 요청을 닫는다.

## 대조 규칙 (결정론)

| 항목 | 규칙 | 예 |
|---|---|---|
| 영업시간 | 시각 구간만 뽑아 `HH:MM-HH:MM` 집합으로 비교. 요일·구분자 표기는 보지 않는다. `11:00`, `11시`, `11시 30분`, `오전/오후`, `~`·`-`·`부터…까지`를 읽는다 | `매일 11:00-21:00` = `11시~21시 (연중무휴)` |
| 휴무 | 요일 집합 비교. `평일`=월~금, `주말`=토·일, `연중무휴`·`휴무 없음`=빈 집합. 낱말 안의 글자(`매월`·`공휴일`)는 요일이 아니다 | `월` = `매주 월요일` |
| 전화 | 번호마다 숫자만 남긴 집합 비교. 국가 번호 82는 0으로 | `+82 2-000-0000` = `02-000-0000` |
| 주소 | 낱말로 나눠(기호·한글과 숫자 경계) 짧은 쪽이 긴 쪽에 연속으로 들어 있으면 일치. `서울특별시`→`서울` 같은 시·도 접미사는 뗀다. 짧은 쪽에 번호(숫자)가 없으면 일치가 아니다 | `서울 동대문구 휘경로 12` = `서울특별시 동대문구 휘경로 12 (휘경동)` |
| 메뉴 가격 | 플레이스 금액 집합(`krwAmounts`, `lib/graders/ledger.ts`)이 확정 금액(여러 사실의 합집합)의 부분집합. 금액이 없으면 플레이스에 없음으로 본다 | `떡볶이 5천원` ⊆ `떡볶이 5,000원, 순대 4,000원` |

- 영업시간·휴무·전화에서 한쪽이라도 구간·요일·번호를 읽지 못하면 공백·기호를 뺀 원문이 같을 때만 일치다.
- 메뉴 이름은 대조하지 않는다. 금액만 본다.

## 사실 저장 뒤 재대조

- `/api/brand-facts` `save_fact`가 사실을 저장한 뒤 `afterFactSaved`(A6-1 훅)가 `placeTasksAfterFact`를 부른다. 지점 사실이면 그 지점, 브랜드 공통 사실이면 브랜드의 모든 지점 스냅샷을 다시 대조한다.
  - 스위치 꺼짐(또는 읽기 실패): `{}`. 응답 바이트가 이전과 같다. `a6_data_requests`도 꺼져 있으면 키가 하나도 늘지 않는다.
  - 스위치 켜짐: 일치한 열린 할 일을 닫고 `closedPlaceTasks`(닫은 수)를 응답 끝에 싣는다(`closedRequests` 뒤). 근거는 `재대조 일치(스냅샷 vN) · 사실 <id> v<판> 저장 뒤`다. 확정 사실이 아니면 0이다.
  - 재대조는 닫기만 한다. 할 일을 새로 열거나 끝난 할 일을 다시 열지 않는다. 스냅샷 자체도 바꾸지 않는다.
  - 닫기가 실패하면 사실 저장은 유지하고 `closedPlaceTasks:null`이다. 다음 스냅샷 입력이나 사실 저장 때 다시 닫힌다.

## API와 권한

| 작업 | 호출 | 대표·관리자 | 직원 |
|---|---|---|---|
| 조회 | GET `/api/place-checks?storeId=` → `{enabled, snapshots, tasks}` | 허용 | 허용 |
| 스냅샷 입력 | POST `save_snapshot` `{storeId, platform:'naver_place', url, checkedAt, fields, version?}` | 허용 | 403 |
| 플레이스 할 일 처리 | POST `save_task` `{storeId, id, version, status, evidence}` | 허용 | 허용 |

- 쓰기는 `secureMutation`, 소유자 변경 잠금(`acquireLock`), 호출 빈도 제한(`place_checks`, 분당 60)을 거친다.
- 판정 순서: 모르는 작업 400 → 권한 403 → 스위치 꺼짐 409 → 지점(없음 404·보관 409) → 입력 400(플랫폼·URL·확인일·항목) → 판 409.
- URL은 `https`이고 호스트가 `place.naver.com`·`map.naver.com`(또는 하위 호스트)일 때만 받는다. 서버는 URL을 열지 않는다. 화면의 링크는 사람이 새 창으로 연다.
- 확인일은 `YYYY-MM-DD`이고 오늘(한국 시간)까지다.
- 첫 입력은 `version`을 비우고, 다음부터는 지금 판을 보낸다. 다르면 409다.
- `save_snapshot` 응답은 `{snapshot, tasks(바뀐 할 일)}`이다. `a6_data_requests`가 켜져 있으면 `dataRequests`(새 요청 수, 실패 시 null)가 붙는다.
- 할 일 처리는 기존 점포 할 일(`/api/stores` `save_task`)과 같은 권한·규칙이다. 완료는 근거가 필요하고, 보고서 할 일 id를 주면 400이다.

## 스위치

- `a6_place_check`(기본 꺼짐)는 `lib/place-check-server.ts`에서만 읽는다. 실행기는 스위치를 import하지 않는다(`tests/franchise-objective.test.mjs` 6).
- 꺼져 있으면 쓰기는 409이고, `/api/stores` GET과 기존 보고서 할 일, `/api/brand-facts` 응답은 바이트 동일하다. 조회는 계속된다.
- 켜기·끄기는 소유자만 한다(`/api/feature-flags`). 설정 기능표에 '플레이스 정보 대조' 행이 있다.

## 남은 위험

- 대조는 표기 규칙에 기대는 결정론이다. `11시-9시`처럼 오후를 생략한 표기는 `11:00-09:00`으로 읽혀 다르다고 나온다. 사람이 할 일에서 확인한다.
- 휴무의 격주·특정 주차(`둘째 월요일`)는 요일만 비교한다. `매월 첫째 월요일`과 `매주 월요일`이 일치로 나온다.
- 메뉴 가격은 금액만 본다. 다른 메뉴의 같은 금액이 있으면 일치로 나온다.
- 주소 시·도 약칭은 일부(특별시·광역시·특별자치시·경기·강원·제주)만 맞춘다. `충청북도`와 `충북`은 다르다고 나온다.
- 사실이 나중에 만료되거나 거절돼도 끝난 할 일은 다시 열리지 않는다. 다음 스냅샷 입력 때 다시 대조된다.
- 스냅샷은 사람이 옮겨 적은 값이다. 플레이스 화면과 실제로 같은지는 확인일·URL로만 추적한다.
