# 판매처 주문 조회 어댑터(커서·재시도)

대상 카드: G2-04(공식 상품/주문 읽기 adapter 1개, cursor 복구, 승인 CSV 병행)·G2-18(추가 판매채널 adapter 기반). 기존 [서명 웹훅](STOREFRONT-WEBHOOKS.ko.md)(판매처→COLLECTIVE 전송)과 [mapdal 어댑터](MAPDAL-INTEGRATION.ko.md)를 보완하는 **COLLECTIVE→판매처 읽기** 경로다.

## 조회 계약

`GET {주문 조회 URL}?cursor=<불투명 값>&limit=100`, `Authorization: Bearer <토큰>`, 리디렉션 금지, 10초 제한, 응답 256KB 이하.

```json
{"orders":[{"order_id":"MD-20260928-AABB01","revision":1,"order_date":"2026-09-28","status":"paid","mode":"delivery","paid_amount":12000,"refund_amount":0}],"nextCursor":"c1","hasMore":true}
```

- 응답 최상위는 `orders`·`nextCursor`·`hasMore`만, 주문 행은 웹훅과 같은 7개 필드만 받는다. 고객 정보·추가 필드가 있으면 전체 거부(`invalid_response`).
- `hasMore:true`면 `nextCursor`가 필요하다. 커서는 `[A-Za-z0-9_.:=-]{1,200}`.

## 동작

- 연결은 소유자만 만든다: 지점, 판매처 키, 공개 HTTPS URL(쿼리·인증정보·사설 주소 금지), 토큰(16~500자, 암호화 저장·재표시 없음, 기존 전체 재암호화 대상), 조회 간격 15~1440분. 만들면 **꺼짐**.
- 한 번 조회 = 한 페이지. 가져온 주문은 기존 `prepareStorefrontImport`(주문 revision 기준 멱등)로 장부에 반영하고, **같은 D1 batch에서** 커서·마지막 결과를 갱신한다. batch가 실패하면 주문도 커서도 바뀌지 않는다. 다시 받은 주문은 중복으로만 센다.
- 실패(인증 거부·HTTP 오류·네트워크/시간 초과·크기 초과·형식 거부·주문 거부·지점 비활성)는 커서를 그대로 두고 `failures`를 늘려 간격×2ⁿ⁻¹(최대 24시간) 뒤 재시도한다. 성공하면 초기화. 추가 페이지가 있으면 다음 tick에 바로 이어 읽는다.
- 자동 조회: 기능 스위치 `storefront_pull`(기본 꺼짐)이 켜져 있을 때 조사 작업자 tick의 `storefront_pull` 큐가 기한이 된 켜진 연결을 tick당 최대 3개 읽는다. 소유자는 “지금 조회”로 수동 1페이지 조회를 할 수 있다.
- URL·판매처 키를 바꾸면 커서를 처음으로 돌린다. “커서 초기화”도 있다(중복은 장부에서 한 번만 셈).
- 판매처에 쓰기 요청은 없다(`externalWrites:0`).

## mapdal.kr 적용

mapdal은 현재 COLLECTIVE로 보내는(push) 어댑터가 있다. 이 조회 계약을 쓰려면 mapdal 쪽에 위 형식의 읽기 엔드포인트와 토큰 발급이 필요하다(별도 저장소 작업, 실계정 not_run).

## 검증 (2026-09-30)

- `tests/storefront-pull.test.mjs` 29 passed(fetch mocked, 메모리 SQLite real): http·사설 주소·쿼리·약한 토큰 거부, 토큰 비저장·비노출, 꺼짐 무호출, 첫 페이지 GET·Bearer·커서 없음, 커서 전진·다음 페이지 커서 사용·중복 비가산, 간격 대기, 고객 필드·추가 필드 거부와 커서 유지, 백오프 증가·상한, 401·네트워크·크기 초과, batch 실패 원자성·다음 시도 복구, 스위치 꺼짐 무동작·켜짐 기한 도래 조회, 설정 CAS·출처 변경 시 커서 초기화, 다른 소유자 차단.
- `e2e/storefront-pull.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1; 연결 생성·켜기/끄기만, 외부 요청 0).
