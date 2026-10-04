# MAPDAL 상품·판매 가능 재고 조회

이 연결은 외부 가격·재고를 수정하지 않는다. 실제 MAPDAL `products(id,name,price,soldout,stock)`를 읽는다. MAPDAL은 주문 생성 때 stock을 차감하므로 이 값은 판매 가능 수량이며 물리 onHand가 아니다. Collective의 기존 재고·예약·주문 이벤트를 보존하고 `max(0, min(local.available, provider.sellable - local.reserved))`을 신규 실행 준비 상한으로 사용한다.

현재 로컬 미이행 예약 전체를 판매 가능 수량에서 차감한다. 공급자가 이미 차감한 예약과 동일하다는 증거가 없으므로 중복 차감해 가용량이 보수적으로 줄 수 있다. 새 예약은 다음 조회를 기다리지 않고 상한을 소비한다. 예약 수량 미확인은 보류이며 기존 예약 자체는 수정하지 않는다. 조회 전후 물리 사건(stocktake/receive/ship/return) 전체와 장부 원본의 digest가 같아야 근거를 저장한다. 이후 출고·입고·실사·반품이 생기면 신규 준비를 보류하고 재조회·재승인을 요구한다. 입고와 출고로 onHand가 같은 값으로 돌아와도 사건 계보가 달라 보류한다. 기존 주문 이행·환불·안전한 해제 경로는 유지한다.

## 설치 계약

`scripts/mapdal/catalog_adapter.py`의 `MapdalCatalogStore(app.db, tenant, shop, ['mpd::123', ...])`에 실제 상품 ID 최대 500개를 명시한다. 가져올 상품 목록과 tenant/shop은 설치자가 고정한다. `migrate()`는 실제 products 필수 열을 확인하고 nonce 전용 보조 테이블/인덱스만 추가한다. products에는 INSERT/UPDATE/DELETE가 없다. 설치·운영 호출은 별도이며 이 개발에서는 수행하지 않았다.

`CatalogBridge(store, signing_secret, tenant, shop)`를 만들고 `CatalogASGI(bridge)`를 정확한 `/collective/v1/catalog/read` 경로의 ASGI 엔드포인트로 연결한다. 라우터가 scope.path를 전체 경로로 유지해야 한다. 서명키는 기존 Collective MAPDAL 연결의 암호화 키와 같은 설치 범위를 사용하고 환경변수에서 읽는다. 공개 URL 임의 변경은 불가하며 mapdal.kr/www.mapdal.kr HTTPS만 사용한다.

요청은 POST `{tenantId,storeId,productId}`이며 기존 timestamp/nonce/method/path/rawBody HMAC을 사용한다. 요청은 32KiB·10초 제한, nonce 영구 중복 차단과 분당 120개 한도다. 응답은 `{snapshot,snapshotJson,signature}`이고 서명 문자열은 `timestamp\nnonce\n200\n/collective/v1/catalog/read\nsnapshotJson`이다. snapshotJson은 Python canonical JSON이며 수신자는 그대로 서명 검증 후 snapshot과 비교한다. 응답은 `{tenantId,storeId,productId,state,title,price,sellable,unit:'piece',observedAt}`를 포함한다.

stock NULL/비정상 또는 상품 필드 미확인은 unknown이며 무제한/0으로 추정하지 않는다. 명시 목록의 실제 DB 행 부재만 deleted다. soldout=1은 판매 가능 0이다. 지원 수량 단위는 piece이며 pack 자동 환산은 없다. 상품 판 열이 없으므로 관측 시각을 제외한 전체 canonical snapshot digest와 서명된 observedAt를 계약으로 사용한다.

## Collective 운영

성장2의 ‘판매처 상품·재고 연결’에서 소유자가 현재 로컬 상품 판·재고 판·동일 SKU를 MAPDAL 상품 ID에 연결한다. 연결 저장부터 해당 SKU는 검토 대기이며, 조회 후 정확한 sourceVersion/digest와 로컬 가격을 대조하고 승인해야 한다. 현재 상품 가격이 다르면 기존 상품 편집 경로로 대사한 뒤 새 연결 판을 저장한다. API는 `/api/growth/provider-catalog`, 액션은 bind/pull/review다.

연결 없는 기존 로컬 SKU는 그대로 동작한다. 새 상품 근거의 내용이 변경되면 다시 검토해야 한다. 15분 만료·서명 오류·미확인·삭제·연결 설정 변경은 해당 SKU만 held로 만든다. 조회 실패는 source.status=failed로 보이고 이력을 남긴다. 실패를 다른 상품의 0재고 또는 전체 삭제로 해석하지 않는다. 이후 정상 조회와 재승인으로 복구한다. 기존 물리 재고와 예약은 자동 수정·삭제·해제하지 않는다.

조회는 화면에서 상품 한 건씩 실행하거나 아래 읽기 전용 주기 조회 작업자를 사용한다. 상품/재고 승인·관측/실패 및 요청 멱등 기록은 동일 DB batch로 저장한다. 이력에는 당시 원본 snapshot을 보존하며 비밀키는 UI/이력에 투영하지 않는다.

## 검증

합성 SQLite의 실제 MAPDAL 열과 mocked HTTP로 검증했다. 실제 운영 DB 설치·MAPDAL 조회/수정은 0회다. 내부 재고 예약 보존, 최소값 상한, 연결 없는 SKU 무변경, 서명 실패, 원본 판 CAS, 삭제/unknown/stale, nonce 재전송 및 응답 서명을 검사한다.

## 읽기 전용 주기 조회 작업자

`runProviderCatalogWorker(owner, now?)`는 명시적으로 연결된 binding과 활성화된 동일 판 공급자 연결만 읽는다. 연구 작업자 통합 콜백은 이 함수를 호출하며 한 tick에서 한 상품만 처리한다. 같은 상품의 조회 간격은 최소 5분이고 화면에서 실행한 최근 pull의 checkedAt도 존중한다. 대기 중 가장 오래된 due 항목부터 읽으며 전체 캠페인의 첫 페이지를 반복 스캔하지 않는다.

기존 owner mutation lease를 공유하여 수동 연결/승인/조회와 동시 쓰기를 막는다. HTTP 전에 최소 재시도 시각을 내구성 상태로 저장하므로 프로세스 중단이나 최종 체크포인트 실패가 즉시 재조회 반복을 만들지 않는다. 정상 응답은 5분 뒤, 실패는 5분부터 지수 backoff하며 최대 6시간이다. 잘못된 서명/미확인 source는 성공으로 보고하지 않는다. 보관·삭제된 캠페인, 고아 연결, 비활성/판이 변경된 공급자 연결은 해당 항목만 보류하여 다음 상품이 진행할 수 있다.

상태 kind는 `growth_provider_catalog_worker`, parent는 storeId이다. 연결이 공유 점포 단위이므로 캠페인 삭제로 재시도 간격을 초기화하지 않는다. 반환 status는 idle/processed/retry/skipped이며 reason·id·nextAt으로 작업 결과를 구분한다. 손상된 binding JSON은 원장 메타데이터로 재시도 시각을 기록해 격리하고, worker/source JSON 손상도 SQL 조회 단계에서 전체 대기열을 중단시키지 않는다. 실제 payload는 기존 `saveProviderCatalog`의 pull 경로를 사용한다. 자동 bind/review·가격 수정·물리 재고 변경·외부 쓰기는 하지 않는다. 새 가격/재고 digest와 물리 이동 근거가 바뀌면 기존 승인 유효성 검사에 의해 보류되며 운영자가 최신 근거를 다시 승인해야 한다.

전용 회귀는 실제 SQLite와 서명된 mocked HTTP로 owner 격리·최소 간격·수동 조회 존중·실패 backoff·고아/보관/비활성 격리·동시 tick·변경 근거·최종 체크포인트 실패 복구를 검증한다. 운영 credential 사용·실제 공급자 요청은 0회이며 worker 설치/운영 결과는 별도 인수 대상이다.
