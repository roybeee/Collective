# MAPDAL 상세페이지 bridge 계약

구현 상태: Collective 클라이언트와 설치 가능한 WSGI 계약, 합성 상품을 사용하는 실제 SQLite 기준 구현. **MAPDAL 운영 상품 어댑터 설치·운영 배포·실상품 수정은 하지 않았다.** `SQLiteLandingStore`는 테스트용 독립 상품 저장소이며 운영 상품에 반영된 것처럼 연결하면 안 된다.

## Collective 계약

`lib/growth-provider.ts`의 `createGrowthProviderClient({baseUrl,tenantId,storeId,secret})`는 `read(productId)`, `apply(input)`, `receipt(requestId)`, `rollback(input)`을 제공한다. 키는 서버의 암호화된 자격증명에서만 전달하며 브라우저·로그·레코드 공개 뷰에 포함하지 않는다. 주소는 코드가 허용한 `https://mapdal.kr`, `https://www.mapdal.kr` origin으로 고정한다. 다른 호스트, 포트, 사용자정보, 경로, query, fragment는 거절한다. DNS/네트워크 경계에서도 해당 운영 호스트만 연결을 허용한다.

요청은 모두 POST이며 경로는 `/collective/v1/landing/read`, `/apply`, `/receipt`, `/rollback`이다. 원문 JSON에 `tenantId`, `storeId`가 필수다. 그 외 필드는 아래만 허용한다.

| 작업 | 필드 | 응답 |
|---|---|---|
| read | productId | productId, version, fields, digest |
| apply | requestId(UUID), productId, expectedDigest, approvalDigest, fields | 변경 영수증 |
| receipt | requestId(UUID) | 변경 영수증 또는 null |
| rollback | requestId(UUID), originalRequestId, expectedDigest, approvalDigest | 복구 영수증 |

`fields`는 `{description:string}` 하나다. 텍스트는 1~8,000자, HTML 태그 구분자·제어문자·잘못된 Unicode는 금지한다. 가격·재고·주문·배송 정책·외부 URL은 이 계약에서 변경하지 않는다. Collective의 승인된 섹션을 임의 HTML이나 전체 상품 객체로 전파하면 안 된다. 현지 상품 어댑터는 plain text를 그대로 저장하고 화면에서 escape 해야 한다.

digest는 SHA-256(UTF-8 canonical JSON `{"fields":{"description":"원본"},"version":1}`)이다. JSON은 정렬 키, 공백 없음, Unicode 그대로이고 양의 정수 version이 포함된다. 같은 텍스트로 돌아와도 version이 달라져 이전 승인의 덮어쓰기를 막는다. 영수증은 requestId/productId/beforeDigest/afterDigest/approvalDigest/operation/at/status로 구성되고 rollback만 originalRequestId를 추가한다. status=`applied`는 해당 어댑터 저장소의 트랜잭션 완료를 뜻한다.

MAPDAL 실제 상품 ID `mpd::123`를 그대로 지원한다. 상품 ID만 영문·숫자·밑줄·하이픈·콜론 1~100자이며 tenant/store/위임 ID 규칙은 넓히지 않는다. 공개 페이지 `/p/mpd::123`와 `/p/mpd%3A%3A123`는 동일 상품으로 대조한다. 다른 origin, 슬래시 삽입, 이중 인코딩, 다른 상품 ID는 거절한다. 실제 페이지가 없는 별칭을 상품 ID 대신 연결하지 않는다.

## 서명·scope

HMAC-SHA256 키는 최소 32바이트이며 환경별·tenant/store별로 분리한다. header는 `x-collective-timestamp`(Unix초), `x-collective-nonce`(UUID), `x-collective-signature`(소문자 hex)다. 서명 원문은 아래 문자열 뒤에 **전송한 그대로의 UTF-8 JSON bytes**를 붙인다.

```
timestamp + "\n" + nonce + "\n" + "POST" + "\n" + path + "\n" + rawBody
```

허용 시각 차이는 ±300초다. method/path/body가 달라지면 서명이 달라진다. scope는 키 설정의 정확한 tenant/store에 고정되고 read/receipt는 `landing:read`, apply/rollback은 `landing:write`가 필요하다. nonce는 데이터베이스 unique 제약으로 영구 중복 차단한다. 재시도는 새 nonce를 사용하고 같은 business requestId를 유지한다. 키를 교체해도 기존 receipt/nonce를 임의 삭제하지 않는다.

기준 구현은 서버 시각 기준 tenant/store당 분당 120회를 SQLite 트랜잭션으로 제한한다. ingress에도 요청 크기 32KiB, TLS, 읽기 timeout, 연결 수 제한을 설정한다. WSGI에서는 Content-Length가 없거나 초과, JSON이 아닌 Content-Type, query가 있는 요청을 거절한다. 애플리케이션 본문과 응답은 각각 32KiB 제한, Collective fetch는 10초 timeout 및 redirect:error다.

## 현지 저장소 설치 요건

`scripts/mapdal/bridge.py`의 `LandingStore` Protocol을 실제 MAPDAL 저장소에 구현하고 `LandingBridge(store, secret, tenant, shop, scopes)` WSGI를 등록한다. 실제 상품 테이블 schema와 텍스트 렌더링 방식을 검토한 뒤 연결한다. 관리자 세션 쿠키나 기존 범용 product update API를 우회 자격증명으로 사용하지 않는다.

저장소는 다음을 한 트랜잭션에서 보장해야 한다.

- tenant/store/product 조회와 현재 revision+fields digest CAS.
- 같은 requestId/같은 본문은 최초 영수증 반환, 다른 본문은 409. apply와 rollback 사이에도 requestId 공간을 공유한다.
- 원본·변경후 snapshot 및 영수증은 수정·삭제 불가능한 이력으로 보존한다.
- 상품 변경과 영수증 저장의 원자성. 둘 중 하나만 commit하면 안 된다.
- rollback은 원래 apply 영수증의 afterDigest와 현재 상품 digest가 모두 일치할 때만 원본 텍스트 복원. 새 revision과 별도 영수증을 만든다.
- signature nonce를 재시작·동시 워커에서도 영구 중복 차단한다.

DB와 다른 원격 시스템을 변경하는 어댑터는 단순한 GET→POST→receipt insert로 대체할 수 없다. 원격 멱등키/조회 가능한 outbox 계약부터 필요하다. 어댑터 예외는 원격 commit 이후일 수 있으므로 오류 형식이 ValueError여도 503/unknown으로 처리한다.

## 결과불명 복구

Collective 클라이언트는 외부 쓰기를 자동 반복하지 않는다. timeout/통신 실패/408/429/5xx/잘못된 응답/다른 요청의 영수증은 `GrowthProviderError.outcome='unknown'`이다. 표준 거절 JSON을 갖춘 허용 4xx만 `rejected`이고 읽기 실패는 `unavailable`이다. provider 오류 원문이나 키는 예외에 노출하지 않는다.

요청 의도·requestId·승인 digest를 외부 호출 **이전에** 로컬에 저장하고, 결과불명 시 같은 requestId로 receipt를 조회한다. `null`은 현재 조회에 영수증이 없다는 의미이며 미접수의 최종 증거가 아니다. 운영자는 결과를 대사해야 하고 새 requestId로 무조건 다시 적용하지 않는다. provider verified 영수증과 기존 manual attested 영수증을 구분한다.

## 검증

`node --experimental-vm-modules tests/growth-provider.test.mjs`는 client WebCrypto/응답 검증, TypeScript→Python 실제 HMAC 계약, 한국어 digest 일치 및 Python bridge 스위트를 포함한다. `python3 tests/mapdal_bridge_test.py`는 실제 임시 SQLite에서 동시 CAS, 재시작 멱등, immutable 이력, nonce, scope, 속도 제한, rollback 충돌, DB 실패 원자성, commit 이후 응답 유실을 검증한다. HTTP는 mocked, 외부 운영 호출은 0이다.

고객 동의 feed/철회 suppression, CS 최소필드 bridge, 실제 발송 provider는 이 landing 계약에 포함하지 않는다. 연락처·메시지·실제 고객 데이터는 전송하지 않는다.

## Collective 화면·실행 원장 연결

`/api/growth/landing`과 상세페이지 수정안 화면에 연결 설정→원본 연결→승인→실제 적용→결과 조회→원본 복원을 추가했다. 운영 서버로 호출하지 않았으며, 아래 경로는 HTTP mocked 통합 테스트로 검증했다.

1. 소유자가 MAPDAL 주소, tenant/store ID와 서명키를 저장한다. 키는 기존 `channel_credential` 암호화 경로에만 저장하고 GET/이력/UI에 반환하지 않는다. 저장은 항상 disabled다. 실제 상품 저장소 어댑터 설치 근거와 명시 확인 후 별도로 켠다.
2. 판매 위임에서 `accountId=mapdal:{Collective storeId}`, `channel=storefront`, T2 `publish`, 유효기간과 비용·손실 한도를 승인한다. 실제 description 교체는 추가 지출 0인 게시 작업만 허용한다.
3. 구매 이유 단일 구역의 `before`를 상품 description 전체, `after`를 변경할 전체 텍스트로 작성한다. 오퍼 URL이 정확히 `{허용 origin}/p/{productId}`여야 한다. 초안에서 상품 read 결과와 위임판을 연결하고, 그 binding까지 포함한 digest를 소유자가 승인한다. 연결 후 초안을 수정하면 provider binding은 제거되므로 재연결해야 한다.
4. 실제 적용 버튼은 승인판·원천 상품/오퍼/사실/병목·근거 만료·현재 위임·전역 중단·연결판을 재검사한다. 요청 ID와 `provider.attempt.status=unknown`을 기존 landing revision/history/request 원장에 먼저 원자 저장하고 한 번만 외부 호출한다. 같은 요청 재시도는 접수 결과만 반환하고, 다른 요청 ID로 결과불명을 우회할 수 없다.
5. 공급자 영수증의 요청/상품/승인/before digest 및 현재 상품의 after digest·정확한 version·텍스트가 모두 같을 때만 `provider_verified` 적용 확인으로 바뀐다. readback 404도 이미 접수된 변경을 rejected로 바꾸지 않는다. 결과 조회는 읽기만 수행하고 null 영수증은 unknown을 유지한다. 연결 비활성화·전역 중단 중에도 동일 연결 범위의 조회 복구는 가능하다.
6. 복원은 원래 apply 영수증과 현재 정확한 after digest에 고정하고 사유·소유자 확인을 다시 기록한다. 동시 편집이 있으면 provider CAS가 거절한다. provider 실행 이력이 있으면 수동 영수증으로 결과를 덮어쓸 수 없다. 명시 거절된 적용은 새 초안으로 재검토한다.

결과불명 동안에는 연결 주소/키 교체가 차단되고 연결 끄기는 허용된다. 미해결 intent가 있으면 캠페인 삭제도 차단해야 한다. 기존 landing 레코드는 삭제 보존 정책을 유지한다. 운영자 수동 영수증과 provider verified 영수증을 화면에서 구분하며, 어느 쪽도 인과 효과 검증 완료를 뜻하지 않는다.

집중 검증: `node --experimental-vm-modules tests/growth-landing-provider.test.mjs`(실제 SQLite/crypto/HTTP route 권한, mocked 판매처), 기존 manual 회귀 `tests/growth-landing-route.test.mjs`. 운영 MAPDAL 설치·키 연결·실상품 smoke 검증은 별도 남아 있다.

### 보관 한도와 원본 복원 재승인

일반 새 작업은 history 2,000건/request 5,000건에서 차단한다. 이미 전송된 요청의 결과 대사와 원본 복구는 이 일반쓰기 한도를 적용하지 않는다. 고정 여유칸은 적용 확인·재승인·복원 시도·복원 확인이 누적되면 다시 소진될 수 있기 때문이다. 대신 결과불명 조회는 상태가 확정되지 않는 한 version/history/request를 전혀 늘리지 않고, 동일 연결판·위임판의 복원 재승인도 추가 저장하지 않는다. 실제 unknown→최종확인, 변경된 복원 권한 재승인, 복원 intent와 그 최종 결과만 이 예외로 추가 기록한다. 물리 저장소 오류는 여전히 오류이며 기존 unknown intent를 보존한다.

이력이 2,000건을 넘어도 GET은 최신 2,000건과 `historyHasMore=true`를 반환하므로 운영 화면과 복구에 접근할 수 있다. 이전 이력은 삭제하지 않는다. 복구 여유가 적용과 복원 각각의 최종 결과를 처리할 수 있도록 cap 도달 후 두 단계 대사를 테스트한다.

연결을 껐다 켜면 connectionVersion이 달라진다. 기존 apply의 상품·원본·승인 digest를 수정하지 않고 `provider_approve_recovery`로 별도 복원 승인을 만든다. 정확히 같은 provider origin/tenant/store/product, 현재 afterDigest와 version, 최신 scope 위임을 확인하고 소유자 확인을 기록한다. 원본 복원 실행은 이 재승인의 연결판·위임판·digest를 다시 검사한다. 다른 매장 연결, 상품 동시 편집, 철회된 위임은 거절한다. 재승인은 읽기와 내부 승인만 수행하므로 전역 신규 실행 중단 중에도 가능하지만 실제 외부 복원 실행에는 기존 중단 검사를 유지한다.
