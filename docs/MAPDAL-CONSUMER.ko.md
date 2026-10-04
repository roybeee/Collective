# 판매처 목적별 소비자 동의·발송 SDK

이 문서는 설치 코드와 호스트 연결 계약이다. 운영 서버 설치·실제 고객 동의·실제 발송을 완료했다는 기록이 아니다. 운영 DB를 자동 변경하거나 기존 `MARKETING` 동의를 다른 목적으로 변환하지 않는다.

## 목적별 동의 화면

`consumer_consent.py`의 `consumer_consent_factory(db, is_pg, resolve_session, notices)`는 별도 ASGI 앱을 반환한다. 생성 시 DB 쓰기나 마이그레이션이 없다. `/collective/consumer-consents/`에 마운트한다.

- GET: 인증된 현재 고객의 목적별 상태와 운영자가 설정한 공개 고지문·버전·기간을 반환한다. 고객/회원/주문 식별자는 반환하지 않는다.
- POST: `{purpose, granted, version}`만 받는다. `granted`는 명시적 boolean이며 목적은 `post_purchase` 또는 `marketing_reorder`다. 고객 식별자, 주문번호, 연락처, 임의 동의 종류를 받지 않는다.
- 두 메서드 모두 현재 로그인, 정확한 서버 선택 주문의 고객/회원 소유권, `Host: mapdal.kr`, same-origin Fetch Metadata, 세션 CSRF를 확인한다. POST에는 `Origin: https://mapdal.kr`도 필수다. GET은 브라우저가 Origin을 생략할 수 있지만 다른 Origin은 거부한다.
- body 1 KiB, 처리 제한 5초, 고객별 30회/분, 최대 4,096개 활성 rate bucket. 프록시에서도 전체 연결·요청 제한 및 DB 쿼리 제한을 설정한다. 스레드로 시작한 DB 트랜잭션은 HTTP timeout 이후 완료될 수 있으므로 화면은 실패를 저장 확정 실패로 취급하지 않고 재조회한다.
- 고객 탈퇴/철회 상태와 주문 재귀속을 실제 DB 트랜잭션에서 재검사한다. PostgreSQL은 고객/신원/주문 행 잠금, 실제 호스트 SQLite `db()`는 `BEGIN IMMEDIATE`를 사용한다.
- `consent_history`에 `COLLECTIVE_POST_PURCHASE` 또는 `COLLECTIVE_MARKETING_REORDER`, `source=ACCOUNT`, 선택한 고지 버전, 실제 선택값만 추가한다. `customer_profiles.marketing_ok`와 기존 `MARKETING` 기록은 변경하지 않는다.

`marketing_reorder` 실제 발송은 기존 마케팅 수신 허용과 새 목적별 동의가 **함께** 있어야 한다. 기존 마케팅 수신이 꺼진 고객의 새 목적 선택은 기존 프로필 값을 자동으로 켜지 않는다. 운영 고지 화면에서 이 조건을 명확히 알려야 한다.

## 운영 고지 설정

법률 고지 문구·유효기간은 운영자가 검토한 값을 제공해야 한다. SDK는 고지 문구를 작성하거나 적법성을 판정하지 않는다. 다음은 설정 구조이며 실제 고지 문구 예시가 아니다.

```python
from consumer_consent import notice_version

# 파일은 운영자가 검토한 두 고지와 각 유효기간을 포함해야 한다.
reviewed = load_operator_reviewed_notices()
notices = {
    purpose: {
        'text': reviewed[purpose]['text'],
        'maxAgeSeconds': reviewed[purpose]['maxAgeSeconds'],
        'version': notice_version(
            purpose, reviewed[purpose]['text'],
            reviewed[purpose]['maxAgeSeconds']),
    }
    for purpose in ('post_purchase', 'marketing_reorder')
}
```

`version`은 정렬한 UTF-8 JSON `{purpose,text,maxAgeSeconds}`의 SHA-256이다. 내용/기간 변경 후 이전 버전을 재사용하면 앱 구성이 실패한다. 내용 변경은 새 판으로 인식되어 이전 동의가 현재 동의로 인정되지 않는다. 기간은 1초~365일 범위이며 정당한 실제 값은 운영자가 정한다.

같은 `notices`로 발송 어댑터 정책을 구성해야 한다. 별도 값으로 중복 관리하지 않는다.

```python
from consumer_storage_adapter import TYPES
policies = {
    p: {'consentType': TYPES[p], 'policyVersion': n['version'],
        'maxAgeSeconds': n['maxAgeSeconds']}
    for p, n in notices.items()
}
```

## 실제 MAPDAL 로그인 연결 예시

확인한 호스트는 `admin_v2.member_required(Request)`로 `mp_member` 세션을 인증하며, `app.db`의 `Cx.exec/one/all`을 사용한다. 호스트의 현재 목적 동의 endpoint는 TERMS/PRIVACY/MARKETING만 지원한다. 새 SDK는 이 기존 endpoint를 우회해 임의 grant를 만들지 않는다.

아래 예시는 기존 로그인 확인을 재사용한다. 동의 화면은 서버가 선택한 현재 주문에 묶는다. 예시는 로그인 고객의 마지막 주문을 선택한다. 다른 주문 선택 UX를 사용한다면 호스트의 인증된 서버 세션에 보관된 주문만 읽고 동일 소유권 검사를 유지한다.

```python
import asyncio, hashlib, hmac, os
from starlette.requests import Request
from admin_v2 import member_required
from app import db, IS_PG
from consumer_consent import consumer_consent_factory

csrf_key = os.environ['COLLECTIVE_CONSENT_CSRF_SECRET'].encode()
if len(csrf_key) < 32:
    raise ValueError('Separate CSRF secret required')

def trusted_context(scope):
    request = Request(scope)
    member = member_required(request)  # 검증 실패 시 예외, 브라우저 ID 사용 금지
    customer_id = member.get('customer_id')
    with db() as cx:
        order = cx.one(
            'SELECT order_id FROM orders WHERE customer_id=? AND member_id=? '
            'ORDER BY order_id DESC LIMIT 1', (customer_id, member['id']))
    if not customer_id or not order:
        return None
    # 서명은 로그인 쿠키/현재 고객/서버 선택 주문에 묶인다.
    # 이 토큰만 인증된 HTML에 안전한 JSON serializer로 전달한다.
    material = '\n'.join([request.cookies.get('mp_member', ''),
                           customer_id, member['id'], order['order_id']])
    csrf = hmac.new(csrf_key, material.encode(), hashlib.sha256).hexdigest()
    return {'customerId': customer_id, 'memberId': member['id'],
            'orderId': order['order_id'], 'csrfToken': csrf}

async def resolve_session(scope):
    return await asyncio.to_thread(trusted_context, scope)

consent_app = consumer_consent_factory(db, IS_PG, resolve_session, notices)
# 모든 경로를 받는 fallback 라우트보다 먼저 등록한다.
app.mount('/collective/consumer-consents', consent_app)
```

인증된 HTML 렌더링에서도 같은 `trusted_context(request.scope)`의 `csrfToken`을 사용한다. 비밀키·로그인 쿠키·고객/주문 ID를 자바스크립트 설정에 넣지 않는다. SDK는 `resolve_session`이 호스트의 실제 세션 인증을 수행한다는 계약에 의존한다. body, query, 임의 header에서 해당 ID를 그대로 복사하는 resolver는 계약 위반이다.

## 브라우저 연결

`consumer-consent-browser.js`를 판매처 same-origin 정적 자원으로 설치한다. 다음 코드는 인증된 페이지에서만 실행한다.

```javascript
import {createConsumerConsent, mountConsumerConsent} from '/static/consumer-consent-browser.js';
const api = createConsumerConsent({csrfToken: serverRenderedCsrfToken});
const unsubscribe = mountConsumerConsent(document.querySelector('#purpose-consent'), api);
await api.load();
// 페이지 컴포넌트 제거 시 unsubscribe().
```

처음 표시되는 두 체크박스는 모두 해제되어 있다. 이미 저장된 상태는 별도 문장으로 보여 주며 체크박스를 대신 선택하지 않는다. 각 목적의 고지를 읽고 선택한 뒤 그 목적의 저장 버튼을 누른다. 철회는 별도 명시적 버튼이다. 최초 로딩, 재조회, 체크박스 선택만으로 POST하지 않는다. 제출 중 중복 클릭을 막고, 통신 실패 시 재조회 전 추가 변경을 막는다. 고지와 결과는 `textContent`로 표시한다. HTML 고지 실행을 허용하지 않는다.

## 발송·삭제 연결 및 남은 설치 조건

`consumer_storage_adapter.consumer_factory(db,is_pg,config,env,transport=...)`는 설치 프레임워크의 `Capability(app,check,migrate)`를 반환한다. `migrate`는 기존 고객/동의/주문/템플릿 테이블을 수정하지 않고 보조 범위·수신자·nonce·outbox·cursor 테이블만 명시적으로 만든다. 실제 운영 실행은 설치 승인이 별도로 필요하다.

- 서버 로그인 확인 이후에만 `store.bind_authenticated(customer,member,order,now)`를 호출하여 무작위 recipient UUID를 얻는다. 브라우저가 지정한 customer/member/order로 호출하지 않는다.
- 승인한 실제 `notify_templates`의 본문 digest, 목적, 최대 원화 비용을 고정한다. 본문이 바뀌면 발송을 거부한다. 연락처는 Collective로 전달하지 않는다.
- 호스트 탈퇴/삭제 처리에 `store.erase_customer(customer,now)`를 연결한다. pending 발송을 억제하고 매핑의 직접 식별자와 payload를 제거한다. HMAC tombstone/요청 UUID/영수증 감사 정보만 보존한다.
- 목적 철회는 위 SDK가 기록한다. 발송 직전 현재 목적 동의와 Collective의 현재 승인을 다시 조회하므로 대기 건은 억제된다. 외부 발송이 이미 시작된 건은 되돌릴 수 있다고 주장하지 않으며 unknown 비용은 조회로만 확정한다.
- `transport.check/send/lookup` 설치가 필수다. `send(requestUUID, providerLocalContext)`는 UUID 멱등성·고정 최대 원화비용을 지키고 `{status:'delivered'|'failed',costKrw}`를 반환해야 한다. `lookup(UUID)`는 GET 성격의 영수증 조회이며 재발송하면 안 된다. timeout/불명확 결과는 unknown을 유지한다.
- 현재 호스트 SOLAPI 직접 전송 함수에는 이 UUID·정확 비용 영수증 계약이 확인되지 않았다. 그 함수를 안전한 transport로 간주하지 않는다. 미설치 상태의 `check()`는 `delivery_transport_not_installed`로 차단된다.
- 명시적으로 설치한 호스트 작업자가 `capability.app.work_once()`를 호출한다. tick마다 새 발송 하나와 unknown 조회 하나를 처리하며 미해결 선두 항목에 갇히지 않도록 cursor를 영속한다.

현재 검증은 로컬 SQLite 실제 스키마 fixture와 mocked transport/브라우저 응답이다. 실제 PostgreSQL·실제 로그인 세션·운영 고지·발송 사업자 설치·실제 고객 발송은 별도의 runtime 검증 대상이다.
