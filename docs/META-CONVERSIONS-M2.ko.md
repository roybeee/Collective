# M2 구매 전환 준비 대장

현재 범위는 실제 장부 주문을 참조하는 준비 기록과 동의 철회다. Pixel 삽입·CAPI 네트워크 요청·고객 식별자 수집은 구현하지 않았다. 외부 전송은 항상 0건이며 준비 기록을 실제 수신 성공으로 표시하지 않는다.

- `GET/POST /api/meta-ads/conversions`: 캠페인 지점의 자사몰 연결 주문만 대상. 조회는 구성원, 기록/철회는 소유자. 동일 출처 검증, 워크스페이스 락, 주문/이벤트 버전 CAS 적용.
- `meta_conversion_event`, `meta_conversion_audit`: 지점 `parent_id`, 브랜드/주문 참조. 이벤트와 불변 감사 버전을 한 DB 배치로 저장한다.
- `eventId = purchase_ + SHA256([meta-purchase-v1, owner, brand, store, order])`. 캠페인/주문 수정 버전/환불/수신 순서로 새 Purchase를 만들지 않는다. 향후 Pixel `eventID`와 CAPI `event_id`는 이 값을 공유하고 이름은 Purchase로 고정해야 한다.
- 결제 완료·양수 결제·환불 없음·자사몰 연결 확인 후, 실제 주문 확인과 별도 광고 측정 동의, 비식별 `consent-*` 증빙 참조, 한국 주문일과 일치하는 과거 구매 시각이 필요하다. 주문일을 임의의 결제 시각으로 변환하지 않는다.
- 준비 이후 장부 변경·환불·취소는 조회 시 즉시 부적격으로 표시한다. 원래 결제액과 시각은 보존하며 새 Purchase를 만들지 않는다. 철회는 주문 변경 이후에도 가능하고, 철회된 기록은 이 API로 재동의할 수 없다.
- 이 대장은 운영자의 증빙 확인 기록이다. 고객 동의 수집이나 해당 증빙의 진위 검증을 대신하지 않는다. 테스트 주문 여부도 운영자 명시 확인에 의존한다. 자사몰에서 서명된 동의/테스트 여부를 전달할 계약은 후속 작업이다.

외부 활성화 조건: 대상 데이터셋, 동의 수집·철회 연동, 허용 식별자/보존 정책, 실제 테스트 수신, Pixel/CAPI 중복 제거 검증, 별도 활성화 승인. 현재 API에는 활성화 작업이 없고 클라이언트 플래그로 우회할 수 없다.

공식 문서 확인 시도: [Meta 중복 제거](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/), [서버 이벤트 매개변수](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/). 이번 작업에서는 429 응답으로 내용을 재검증하지 못했다. 따라서 실제 외부 송신 페이로드·보존기간·송신 가능 시간 창은 확정하지 않는다.

검증: `node --experimental-vm-modules tests/meta-conversion.test.mjs`. 합성 주문·모의 외부 gateway 기반이며 외부 fetch는 호출 시 즉시 실패하도록 구성한다. 실제 Meta 연동 검증이 아니다.
