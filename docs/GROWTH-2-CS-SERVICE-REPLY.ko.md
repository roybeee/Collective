# 성장2 판매처 서비스 답변 연결

본인 문의의 서비스 답변을 기존 소비자 발송 outbox에 연결합니다. `service_reply`는 문의에 응답할 서비스 목적이며 구매 후 관리/마케팅 동의를 확장하거나 대신하지 않습니다. 서비스 답변 위임의 channel은 별도 `cs_service_reply`, T2/publish, 비용 0입니다. 환불·취소·재고·포인트 변경은 하지 않습니다.

## 실제 완료 의미

이 어댑터의 delivered는 MAPDAL `member_inquiries.answer`, `status='답변완료'`, `answered_at`, `answered_by`에 승인된 고정 템플릿이 게시되고 같은 트랜잭션에 영수증이 저장되었다는 뜻입니다. SMS/이메일 전송이나 고객이 읽었다는 뜻이 아닙니다. `member_requests`, `member_pqna`에 자동 처리를 적용하지 않습니다.

## 접수와 판 검사

- 서명된 `/collective/v1/cs/inbox` 조회는 문의 UUID, 제공자 가명 고객 UUID, sourceKey, MD 형식 주문 ID, 원본 판 digest, 접수 시각, 최소 유형·상태만 반환합니다. title/body/연락처/답변 원문을 Collective로 보내지 않습니다.
- 제공자는 현재 `customer_profiles.status='ACTIVE'`, withdrawn_at 없음, 문의와 주문의 customer_id/member_id 일치부터 확인합니다. 최초 UUID 매핑은 제공자 DB에서 생성합니다. 로컬 사용자가 임의 UUID로 본인 문의를 주장할 수 없습니다.
- Collective는 원래 tenant/store, 브랜드/캠페인/지점과 `storefront_order_link`의 정확한 sourceKey/externalId/orderId/revision 및 주문 현재 판을 결합합니다. 주문이 환불되었더라도 본인 서비스 문의는 처리할 수 있습니다. 마케팅 목적의 결제·환불 조건을 서비스 문의에 가져오지 않습니다.
- 접수 조회는 50개씩 UUID cursor로 진행합니다. 기존 판·동일 요청은 중복 생성하지 않습니다. 최초 source가 기존 수동 CS ticket ID를 덮어쓰는 것도 거부합니다.
- 승인은 sourceDigest, 현재 고객 판, 티켓 판, 정확한 주문 판, 불변 템플릿 UUID/digest, 만료, 서비스 전용 위임을 고정합니다. 접수 변경·철회가 동기화되면 미실행 답변을 억제하고 진행 중 답변을 취소 대기 처리합니다.
- 제공자 게시 직전 Collective의 signed authorize 콜백과 제공자 자체의 고객/주문/문의/템플릿 판을 재검사합니다. 최신 관리자가 이미 답변한 문의를 덮어쓰지 않습니다. scope row와 실제 inquiry/order/customer 행을 잠그고 답변+receipt를 같은 트랜잭션에 기록합니다.

## 원장과 개인정보

`growth_cs_source`, `growth_cs_source_history`, `growth_cs_source_request`는 캠페인 보존 원장입니다. 고객 삭제는 source current/history의 customerId, externalOrderId, sourceDigest, order를 null로 지우고 withdrawn/erased로 남깁니다. inquiry UUID는 발송 영수증 감사 연결만 유지합니다. 소비자 outbox 삭제·억제·자동 취소 drain과 동일한 경로를 사용합니다.

제공자 delivered 영수증만 기존 CS 티켓의 respond 이벤트를 자동으로 만듭니다. 승인한 티켓 판이 수동 작업으로 바뀌었다면 덮어쓰지 않고 `csResponseHeld`로 보류합니다. 그 경우 관리자가 영수증을 확인해 CS 처리 이력을 수동 대사합니다. 응답 완료를 환불 완료로 바꾸지 않습니다.

## 설치 예시

아래는 설치 계약 예시이며 이 개발 작업에서 운영에 적용하지 않았습니다. 비밀값은 환경 변수로 주입합니다. 실제 템플릿 텍스트는 제공자에서만 보관합니다.

```python
import os
from consumer_bridge import CollectiveAuthorizationClient
from cs_storage_adapter import MapdalCsStore
from cs_bridge import CsBridge
from cs_asgi_adapter import CsASGI

# app.db / app.IS_PG는 MAPDAL의 실제 Cx 트랜잭션 래퍼입니다.
secret = os.environ['COLLECTIVE_CS_SIGNING_SECRET']
origin = os.environ['COLLECTIVE_SITE_ORIGIN']
callback = CollectiveAuthorizationClient(
    origin, os.environ['COLLECTIVE_WORKSPACE_OWNER'],
    os.environ['COLLECTIVE_CAMPAIGN_ID'], secret,
    {os.environ['COLLECTIVE_SITE_HOST']},
)
store = MapdalCsStore(
    app.db, app.IS_PG, os.environ['COLLECTIVE_TENANT_ID'],
    os.environ['COLLECTIVE_PROVIDER_STORE_ID'], 'mapdal',
    approved_template_uuid_to_text, authorize=callback,
)
# migrate()는 명시 설치 단계에서 한 번 실행합니다. 원본 테이블을 만들거나 수정하지 않습니다.
store.migrate()
gateway = CsBridge(store, secret, store.tenant, store.shop, enabled=False)
app.app.mount('/collective/v1/cs', CsASGI(gateway))
```

설치 검증 후 제공자 gateway와 Collective 연결을 각각 활성화합니다. 제공자의 스케줄러가 `store.deliver_pending(limit=10)`을 호출해야 accepted 답변이 실제 게시로 진행됩니다. 이는 실제 게시 작업이므로 설치 후 운영 승인 범위에서 실행해야 합니다. callback 미설정/실패는 게시 허용이 아닙니다. Collective의 소비자 회수 워커는 기존 cancellation outbox를 계속 처리합니다.

템플릿 digest는 `sha256(template_text.encode('utf-8')).hexdigest()`입니다. 문의별 자유 변수나 연락처 치환을 지원하지 않습니다. source inbox 정렬은 opaque UUID이며 nextCursor를 받은 경우 다음 페이지를 계속 동기화합니다. 2,000개 원본 문의를 초과하면 `intakeHeld`로 신규 UUID 등록을 보류합니다. 이미 연결된 문의의 변경·철회·삭제는 계속 동기화하며, 신규 수집 완전성을 주장하지 않습니다. 원본 문의 삭제나 주문 연결 변경은 기존 주문 참조를 유지한 withdrawn tombstone으로 회수합니다. 고객 삭제 후 Collective의 지운 source는 재수집해도 다시 연결하지 않습니다.

## 검증 상태

`tests/growth-cs-delivery.test.mjs`는 실제 SQLite와 모의 제공자로 source import, 서비스와 마케팅 위임 분리, 정확한 주문 연결, 응답 영수증, source cap에서 기존 종료 동기화, CSRF/owner scope, 고객 삭제 scrub을 확인합니다.

`tests/mapdal_cs_adapter_test.py`는 임시 SQLite에 실제 `member_inquiries`, `orders`, `customer_profiles` 열을 만들고 답변/receipt 동일 트랜잭션, 관리자의 새 답변/고객 철회/타인 주문 재귀속/임의 UUID 차단과 signed gateway를 확인합니다. 실제 운영 문의 게시·고객 연락은 0회입니다. PostgreSQL 설치·라이브 MAPDAL·배포 확인은 별도입니다.
