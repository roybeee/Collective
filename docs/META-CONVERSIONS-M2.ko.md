# M2 구매 전환 · Pixel/CAPI 전송

주문 준비·동의 철회부터 암호화된 전송 대장, Meta 서버 요청, 제한 재시도와 Pixel 계약까지 구현했다. `meta_ads_capi` 기본값은 꺼짐이다. 실제 맵달 고객 전송·데이터셋 연결·Meta 수신 및 중복 제거 운영 검증은 수행하지 않았다.

- `GET/POST /api/meta-ads/conversions`: 조회는 구성원, 변경은 소유자와 동일 출처 검증. `prepare/revoke/configure/disconnect/queue/advance/pixel` 작업을 제공한다. 철회 이외 변경은 워크스페이스당 분당 60회로 제한한다. 준비·연결·예약은 owner lock, 전송 워커도 같은 lock을 사용한다. 이미 진행한 전송은 동의 철회로 취소되지 않는다.
- 기존 `meta_conversion_event/audit`는 실제 자사몰 연결 장부 주문을 참조한다. 동의 증빙 `consent-*`, 별도 측정 동의, 한국 주문일과 일치하는 구매 시각을 보존한다. 원시 주문번호나 고객 이름은 저장하지 않는다.
- `eventId = purchase_ + SHA256([meta-purchase-v1, owner, brand, store, order])`. Pixel `eventID`와 CAPI `event_id`는 동일하고 이름은 Purchase다. 캠페인 교체·재시도로 새 ID를 만들지 않는다.
- `meta_capi_connection`은 지점별 데이터셋, HTTPS 자사몰 원본 주소, 전환 전용 토큰을 보존한다. 토큰은 위치 AAD를 포함하는 암호문이다. 연결 해제는 토큰을 파기하고 버전은 보존한다. 토큰 교체는 같은 데이터셋·원본 주소 계약만 기존 구매의 전송에 사용할 수 있다.
- 예약은 전송 스위치와 필드별 동의 확인이 필요하다. 허용 필드는 정규화 후 SHA-256 이메일, 실제 구매 브라우저 User-Agent, 쿼리/fragment 없는 구매 페이지 URL, Purchase 금액·통화·시각이다. 원시 이메일 입력은 허용하지 않는다. 해시도 개인정보로 취급한다. 증빙 번호·필드 목록·목적·시각을 감사 이력에 보존한다.
- `meta_capi_outbox`는 개인정보 매칭 필드를 암호화하고 `queued → sending → accepted/unknown/rejected/blocked`를 기록한다. 네트워크 전에 sending을 영속화한다. `advanceMetaConversionWork(owner)`는 한 번에 최대 3건, 요청당 15초다. 응답 미확인/프로세스 중단은 원래 ID와 시각을 그대로 유지하여 5분 후 최대 3회까지 시도한다. 4xx(429 제외)는 자동 재시도하지 않는다. 한도 도달 상태도 unknown으로 보존하며 Meta 확인이 필요하다.
- 매 시도마다 최신 주문 버전·결제 상태·환불·별도 동의·브랜드/지점/캠페인·연결을 다시 확인한다. 철회·취소·환불·주문 변경·7일 초과는 전송하지 않는다. 수신 확인/거부/차단/시도 한도 후 매칭 암호문을 파기한다. 감사와 비식별 이벤트 식별자는 재전송 방지를 위해 보존한다.
- `events_received: 1` 응답만 accepted로 처리한다. UI는 시도 횟수와 Meta 수신 확인 횟수를 구분한다. accepted는 광고 귀속·매칭 품질·Pixel 중복 제거 성공을 보증하지 않는다. 응답 내용·토큰·매칭 필드는 로그나 조회 응답에 노출하지 않는다.

## 구매자 브라우저 연결

자사몰 서버가 소유자 인증으로 `pixel` 작업의 5분 유효 계약을 가져와 해당 구매자에게만 전달한다. COLLECTIVE 인증 정보는 브라우저에 전달하지 않는다. 브라우저는 자체 동의 관리자가 광고 측정 동의를 확인한 뒤 `dispatchMetaPurchasePixel(envelope, fbq, consent)`를 실행한다. 함수는 `trackSingle(datasetId, Purchase, {value,currency}, {eventID})`를 사용한다. 관리자 화면은 계약만 보여주고 Pixel을 실행하지 않는다. 실제 맵달 코드에 삽입하고 동의 수집·철회를 자동 연결하는 운영 설치는 별도다.

운영 인수: 대표가 데이터셋/토큰과 자사몰 고객 동의 수집·철회 경로를 확정하고, 테스트 데이터로 Meta Test Events 수신/Pixel 중복 제거를 확인한 후 스위치와 실제 구매 전송을 승인한다. 테스트 코드가 기능 스위치를 켜는 것은 합성 워크스페이스 안에서만이다.

공식 근거: [Meta 공식 샘플](https://github.com/fbsamples/lead-ads-webhook-sample/blob/main/postman/FB%20Conversions%20API%20%28Part%201%20-%20online%29.postman_collection.json)의 website action_source, user agent, source URL 계약을 확인했다. [API 문서](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/)와 [중복 제거 문서](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/) 직접 조회는 429였다. 따라서 현재 계정에 대한 실제 공급자 계약 검증은 운영 인수 항목으로 남긴다.

검증: `tests/meta-conversion.test.mjs`(36 assertions), `tests/meta-capi.test.mjs`(42 assertions), `e2e/meta-conversion.spec.ts`(Pixel 합성 브라우저 호출, 준비/철회). API 테스트는 로컬 SQLite와 mocked Meta이며, 브라우저 테스트도 외부 Meta 스크립트를 로드하지 않는다.
