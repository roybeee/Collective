# 성장2 소비자 발송 원장

소비자 탭의 발송 원장은 고객 가명 UUID, 목적, 불변 템플릿 UUID·SHA-256, 최대 발송비, 만료, 현재 위임 판을 저장합니다. 연락처·메시지 원문·자유 템플릿 변수는 받지 않습니다. `growth_customer.id`가 제공자에 미리 연결된 수신자 UUID여야 합니다. 임의의 다른 수신자 ID로 바꿀 수 없습니다.

## 운영 흐름

1. 목적별 동의와 동일인 주문 연결을 기록합니다. 현재 캠페인 매장의 현재 주문 판, 정상 결제, 환불 없음, 동의 만료·철회 및 재구매 대기일을 확인합니다.
2. 대기를 저장합니다. 제공자 연결이 없어도 대기 초안을 보관할 수 있습니다.
3. 소유자가 현재 동의·주문·연결·캠페인·위임 판과 불변 템플릿을 승인합니다. 변경되면 다시 승인해야 합니다.
4. 관리자 이상이 승인 내용의 발송을 요청합니다. 비용 0은 T2/publish, 비용 발생은 T3/spend 위임이 필요합니다. 계정의 전체 약정 원장을 읽어 총액·일·주·손실 상한과 전역 중단을 확인합니다.
5. 제공자 호출 **전에** unknown intent와 최대 비용 예약을 같은 DB 트랜잭션에 저장합니다. 동일 UUID 재요청과 새로운 키의 재전송 모두 이미 발송을 시작한 행에는 새 send를 만들지 않습니다.
6. 접수와 전달을 구분합니다. 타임아웃·5xx·유실·잘못된 영수증은 unknown입니다. `/receipt`의 null도 실패 증거가 아니므로 예약을 유지합니다. 영수증 조회만 허용합니다.
7. 전달/실패가 확정되어도 실제 비용이 null이면 비용 대사를 계속합니다. 현재 상태를 뒤집지 않고 같은 전달 결과의 비용이 확인될 때 예약을 실제 비용으로 정산합니다. 이 비용 정보는 은행 지급 증빙이나 현금 원장을 대신하지 않습니다.

UI에서 대기 저장 응답이 유실되면 원래 행 ID와 요청 UUID를 보존해 같은 요청을 재시도합니다. 최신 원장에서 해당 행을 찾으면 저장 완료로 복구합니다.

## 철회·삭제·취소

기존 동의 철회/고객 삭제 트랜잭션에 대기 억제가 포함됩니다. 목적별 철회는 해당 목적, 동일인 연결 철회·삭제는 모든 목적을 억제합니다. queued는 실패/억제 처리합니다. unknown/accepted는 외부 취소 확인 대기로 남기며 실제 취소 여부를 추정하지 않습니다.

삭제 시 현재·이력의 고객 UUID, input, approval, provider payload를 null로 지우고 요청의 입력 digest도 제거합니다. 발송 ID·원래 제공자 범위·payloadDigest·상태·영수증·예산 약정은 감사와 기존 제공자 취소/대사를 위해 보존합니다. 수신자 연결정보를 다시 만들지 않습니다. 제공자에서 이미 실행 중인 작업은 로컬 삭제만으로 취소되었다고 표시하지 않습니다.

미확정 발송, 취소 대기, 전달 확정이지만 비용 미확인인 행이 있으면 원래 tenant/store/signing key를 교체할 수 없습니다. 같은 연결의 비활성화는 허용합니다. 캠페인 매장이 이후 변경되어도 기존 제공자 범위의 대사는 가능합니다.

## 연결과 계약

- 연결: `channel_credential`, channel `growth_consumer_delivery`, ID `growth_consumer_delivery:<campaignId>`. 브랜드 parent. 기존 landing 연결과 분리합니다.
- 소유자 전용, 기존 credential 암호화/AAD/keyring 사용. GET에는 비밀값이 없습니다. 최초 저장은 disabled이고 활성화는 별도 명시 변경입니다.
- 고정 주소: `https://mapdal.kr/collective/v1/consumer/{send,receipt,cancel}`. 리다이렉트 차단, 10초 timeout, JSON 응답 32 KiB 제한.
- HMAC-SHA256: `timestamp + "\n" + nonce + "\nPOST\n" + path + "\n" + body`. timestamp는 Unix 초, nonce는 UUIDv4. 헤더는 `x-collective-timestamp`, `x-collective-nonce`, `x-collective-signature`.
- envelope: tenantId, storeId, requestId, payloadDigest. send만 payload 포함. payloadDigest는 전송 payload의 `JSON.stringify` 바이트 SHA-256입니다(키 정렬하지 않음).
- 영수증: requestId, payloadDigest, status(accepted/delivered/failed), costKrw(null 또는 0~승인상한), receiptId(UUIDv4), at(UTC), code(null/cancelled/rejected/expired). 원래 요청과 digest를 대조합니다.
- 제공자는 현재 동의/수신 거부, 수신자 UUID 매핑, 템플릿 목적·digest·현재 비용·만료를 실제 전달 직전에 재검사해야 합니다. 실제 외부 transport도 requestId 멱등성 및 receipt 조회를 지원해야 합니다.

## 독립 참조 게이트웨이

`scripts/mapdal/consumer_bridge.py`는 별도 WSGI 계약/SQLite 참조입니다. landing `bridge.py`를 변경하지 않습니다. 기본 disabled, 서명·범위·nonce replay·분당 요청 한도를 검사합니다. accepted outbox와 transport claim을 분리하고 claim을 먼저 영속화합니다. claim 후 오류/프로세스 종료는 unknown으로 남으며 claim을 다시 발급하지 않습니다. trusted transport 영수증만 `finish()`에 입력해야 합니다.

참조 구현에는 실제 SMS·메일 발송, 운영 MAPDAL 고객 데이터, 연락처 저장, 운영 provider 설치가 포함되지 않습니다. 운영 adapter가 `recipient/template/claim/finish` 계약을 실제 고객·수신거부·메시징 시스템과 연결해야 합니다. unknown 취소는 provider transport 취소 영수증으로 마무리해야 하며 자동으로 성공 처리하지 않습니다.

## 검증과 범위

- `tests/growth-consumer-delivery.test.mjs`: 실제 SQLite, 합성 세션 및 mock provider. scope/CSRF/owner-only/CAS/UUID replay/동의·주문·위임·중단/예산/삭제/불확실 상태/비용 대사를 검증합니다.
- `tests/mapdal_consumer_bridge_test.py`: 임시 SQLite, 합성 UUID·템플릿. 실제 메시지 0건.
- `e2e/growth-consumer-delivery.spec.ts`: 로컬 API 저장 후 502 응답 유실을 주입, 같은 대기 요청 복구 및 취소·새로고침 영속성을 확인합니다.
- 라이브 provider 연결/실발송은 실행하지 않았습니다. 배포·runtime 검증은 별도 상태입니다.

본인 문의 서비스 답변은 별도 `service_reply` 목적과 CS 접수 근거를 사용합니다. 원문·연락처 없이 현재 티켓·본인 주문 판, 고정 템플릿과 전용 `cs_service_reply` T2 위임을 검증합니다. 실제 `member_inquiries` 답변 저장 어댑터와 영수증 연결은 [CS 수신 계약](GROWTH-2-CS-SERVICE-REPLY.ko.md)을 따릅니다. 운영 판매처 설치와 실제 답변은 별도 검증 상태입니다.

## 건별 승인한 자동 실행

소유자가 **자동 실행 승인**을 명시 선택한 행만 `approval.autoDispatch=true`로 고정합니다. 기존 승인·일반 소유자 승인은 수동 실행으로 유지하며, 다시 일반 승인하면 자동 실행 권한이 해제됩니다. 자동 승인도 수신자·템플릿·비용·만료·현재 동의·주문·위임의 정확한 판에 한정합니다.

연구 워커의 소비자 큐는 취소 회수를 먼저 처리하고, 실행 가능한 취소가 없을 때 자동 승인 발송 또는 영수증 회수를 한 번에 1건 진행합니다. 기존 API와 같은 소유자 잠금 안에서 직전 조건을 재검사하고 intent·예약부터 저장합니다. unknown/accepted·비용 미확정은 영수증 조회만 하며 재전송하지 않습니다. 이 회수는 일일 안건 스위치·전역 신규 실행 중단과 독립입니다.

시도와 재시도 시각을 의존 레코드 조회 전에 저장합니다. 없는 캠페인 등 개별 오류는 다음 작업을 막지 않으며, 30초부터 최대 1시간까지 간격을 늘립니다. 승인 근거가 변경된 대기는 자동 승인을 해제하고 명시 재승인을 요구합니다. 이미 발생한 의무의 취소는 이력 보관 한도를 넘어도 감사 이력을 추가할 수 있으며 신규 등록·승인은 일반 한도를 유지합니다.

`tests/growth-consumer-execution-worker.test.mjs`는 과거 승인 격리·1건 처리·동의 철회·중단·unknown 조회·고아 취소 공정성·이력 한도 취소를 실제 SQLite와 모의 공급자로 검증합니다. 실제 고객 메시지를 발송하지 않습니다.

## 철회 폐쇄 루프 보완

로컬 철회·삭제·취소는 durable `cancelPending` outbox를 만든 뒤 응답 후 작업으로 즉시 `drainConsumerCancellations(owner, limit)`를 예약합니다. 네트워크 실패는 성공으로 바꾸지 않고 `cancelAttempts`와 `cancelRetryAt`를 영속화합니다. 재시도는 30초 지수 증가, 최대 1시간입니다. 연결 disabled와 전역 중단은 새 발송을 막는 것이므로 기존 취소 회수를 막지 않습니다. 프로세스 종료나 응답 후 작업 유실은 연구 워커의 독립 취소 회수 큐가 보완합니다. drain은 cancel/receipt만 사용하며 send를 호출하지 않습니다.

제공자가 취소 통지를 받기 전에도 발송 직전 현재 Collective 상태를 확인합니다. 새 엔드포인트는 `POST /api/growth/consumer-delivery/authorize`이며 body는 `{owner,campaignId,requestId,payloadDigest,tenantId,storeId}`입니다. owner/campaign은 연결을 검색하는 namespace일 뿐, 인증을 대신하지 않습니다. 기존 서명 키의 HMAC, 고정 path, ±60초 timestamp, 영속 UUID nonce 재사용 차단, tenant/store 일치를 확인합니다. owner lock 아래 현재 동의·삭제·정산 예약의 범위·주문·위임·승인판·전역 중단을 다시 검사합니다. 응답에는 연락처·고객 UUID가 없으며 `{allowed,requestId,payloadDigest,nonce,checkedAt}`만 담습니다. `x-collective-signature`는 HMAC-SHA256(`nonce + "\n" + raw response body`)입니다.

Python `CollectiveAuthorizationClient`에는 운영자가 Collective HTTPS origin, allowlist host, owner namespace, campaign ID, 서명 키를 별도로 설정합니다. 메시지 payload에서 callback 주소를 받지 않습니다. 리다이렉트 차단, 5초 timeout, 응답 4 KiB 한도, 서명·요청·nonce·5초 freshness를 검사합니다. 허용 결과를 캐시하지 않습니다. 미설정·네트워크 실패·잘못된 서명은 허용이 아닙니다.

`SQLiteConsumerStore(..., authorize=client)`의 `claim()`은 해당 callback 없이는 payload를 발급하지 않습니다. 현재 명시 거절은 비용 0으로 억제하고, 조회 실패는 accepted 상태에서 기다립니다. 운영 transport worker는 payload를 보관해 나중에 보내는 대신 **`deliver()`**를 호출해야 합니다. 이 메서드는 durable claim 직후 새 authorization을 한 번 더 확인하고 곧바로 transport를 호출합니다. claim과 호출 사이 철회도 이 두 번째 확인에서 차단합니다. transport 예외는 unknown이고 다시 호출하지 않습니다.

보장 시점은 마지막 authorization 확인입니다. 그 확인과 외부 transport 실행은 서로 다른 시스템이므로 전역 원자 트랜잭션이 아닙니다. 확인 이후 이미 전송 중인 메시지는 취소 영수증을 받을 때까지 중단됐다고 단정하지 않습니다. 실제 transport adapter도 제공자 측 수신 거부를 실행 직전에 적용해야 합니다. 두 번째 확인이 불확실해 transport를 호출하지 못한 durable claim도 unknown으로 보존하며 신뢰할 수 있는 제공자 조사·영수증으로 종료해야 합니다.

폐쇄 루프 회귀는 `tests/growth-consumer-delivery-authorization.test.mjs`와 Python suite에 있습니다. 실제 고객 삭제 API → 응답 후 자동 취소 예약 → 실패·backoff 보존 → 자동 재시도 성공, 취소 도착 전 최신 동의 거절, claim 직후 철회로 transport 0회, transport timeout 후 1회 제한을 합성 환경에서 검증합니다.
