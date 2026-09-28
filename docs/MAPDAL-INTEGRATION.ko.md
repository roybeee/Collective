# mapdal.kr 주문 어댑터

맵달 소스 `e7c39e7`의 `app.py` 주문 생성/결제 처리 및 `admin_v2.py` 배송·취소 처리를 읽어 대조했다. 공개 `/healthz`에서 `db:pg`를 확인했으므로 운영 연결 경로는 PostgreSQL이다. 실제 주문 DB, 환경 파일, 고객 정보는 읽지 않았다. 맵달 저장소 변경·배포·외부 송신도 수행하지 않았다.

## 확인된 원본 계약

| 원본 | 수신 필드 | 처리 |
|---|---|---|
| `order_id` | `order_id` | 생성 코드의 `MD-YYYYMMDD-HEX6` 형식만 허용 |
| `created` | `order_date` | `kst_iso()`의 한국시간 naive 날짜를 유지. UTC로 재해석하지 않음 |
| `amount` | `paid_amount` | 배송비 포함 원화 정수. bool/문자열/소수 거부 |
| `status=PAID` | `status=paid` | 결제 완료만 반영 |
| `ship_method=standard/pickup` | `mode=delivery/pickup` | 나머지 보류 |
| 별도 구조화 환불 증빙 | `refund_amount` | 누적 환불액 확인. 원본 CANCELLED만으로 환불 추정 금지 |
| outbox의 단조 번호 | `revision` | 최초 1, 새로운 유효 금액 상태마다 증가 |

`WAITING_DEPOSIT/PENDING/FAILED`는 건너뛴다. `CANCELLED/DEPOSIT_AFTER_CANCEL`과 알 수 없는 상태는 보류한다. 배송 `SHIPPED/DONE`은 별도 `fulfill` 필드이며 결제 상태 PAID를 바꾸지 않는다. CANCELLED는 전액 환불 증빙이 있을 때만 `refunded`로 변환한다. PAID에서 증빙된 부분 환불은 `paid`와 누적 환불액으로 반영한다.

전송 본문은 `orders` 배열과 주문당 정확히 7개 필드만 갖는다. buyer/items/payment_key/contact_phone_norm, 결제 토큰, 고객 ID, 분석 쿠키, 동의 추정값은 포함하지 않는다. Meta 이벤트나 동의는 생성하지 않는다.

## 합성 파일로 확인

파일 예시(실고객 데이터 금지):

```json
{"synthetic":true,"orders":[{"order_id":"MD-20260928-AABBCC","created":"2026-09-28T00:01:02","status":"PAID","amount":12000,"ship_method":"standard"}],"refunds":{}}
```

```sh
python3 scripts/mapdal/adapter.py --input synthetic-orders.json
python3 scripts/mapdal/adapter.py --input synthetic-orders.json --enqueue --outbox mapdal-test.sqlite
python3 -m unittest discover -s tests -p mapdal_adapter_test.py
```

기본 실행은 메모리 dry-run이며 파일 저장·외부 전송이 없다. `--enqueue`를 명시해야 별도 SQLite outbox에 저장한다. 승인된 실제 내보내기 파일을 읽으려면 `--allow-live-input`이 필요하다. 파일 최대 2MB, 한 번에 주문 최대 100개다. 출력은 건수 요약만 남긴다.

## SQLite 원본의 명시적 읽기

`--source-db`는 `--input`과 상호 배타적이다. 경로를 자동 탐색하거나 환경 변수에서 추정하지 않는다. `--allow-live-input`과 1~31일의 한국 날짜 범위를 함께 지정해야 하며, `mode=ro` URI로 연다. 다음은 경로 자리표시자를 사용한 명령이며 실제 실행하지 않았다.

```sh
python3 scripts/mapdal/adapter.py --source-db /PATH/TO/SOURCE.sqlite --date-from YYYY-MM-DD --date-to YYYY-MM-DD --allow-live-input
python3 scripts/mapdal/adapter.py --source-db /PATH/TO/SOURCE.sqlite --date-from YYYY-MM-DD --date-to YYYY-MM-DD --allow-live-input --enqueue --outbox /SEPARATE/PATH/OUTBOX.sqlite
```

조회는 `order_id,created,status,amount,ship_method` 다섯 필드의 명시적 SELECT만 사용한다. buyer·전화·items·payment_key는 조회하지 않는다. 원본에 INSERT/UPDATE/DELETE/마이그레이션을 실행하지 않으며, outbox와 원본이 같은 파일(심볼릭 링크·하드 링크 포함)이면 거부한다. 스키마 불일치도 원문 없는 오류 요약으로 종료한다. 읽기 대상은 SQLite의 실제 `orders` 테이블이어야 하며 PostgreSQL URL이나 view는 지원하지 않는다.

SQL의 날짜 조건·LIMIT 101로 한 번에 최대 100건만 허용한다. 101건이면 잘라서 성공 처리하지 않고 저장 전에 실패한다. 날짜를 좁히거나 개인정보 없는 100건 이하의 내보내기 파일로 나누어 재개한다. 인덱스가 없는 파일도 과도하게 읽지 않도록 SQL 실행을 약 2초로 제한한다. 취소·환불을 다시 관측하려면 과거 주문일 범위도 재조회해야 한다. DB 모드는 환불을 추정하지 않으며 별도 증빙은 기존 `--input` 방식으로 반영한다. SQLite 옵션은 로컬 SQLite 원본용이며 운영 PostgreSQL에는 아래 옵션을 사용한다.

추가 테스트는 임시 합성 SQLite만 사용해 읽기 전후 원본 바이트 동일, SELECT 필드 제한, live gate, 날짜/100건 제한, 잘못된 스키마, 별도 outbox 조건을 검증한다. 실몰 DB에는 접근하지 않았다.

## 운영 PostgreSQL 읽기 경로

`--source-postgres`를 명시해야 PostgreSQL 드라이버를 읽는다. `--input`, `--source-db`와 상호 배타적이다. 연결 URI는 `MAPDAL_SOURCE_DATABASE_URL` 환경 변수에서만 받으며 CLI 인자·출력·오류 원문에 노출하지 않는다. 이 작업에서는 실제 URI를 읽거나 DB에 접속하지 않았다.

```sh
python3 scripts/mapdal/adapter.py --source-postgres --date-from YYYY-MM-DD --date-to YYYY-MM-DD --allow-live-input
python3 scripts/mapdal/adapter.py --source-postgres --date-from YYYY-MM-DD --date-to YYYY-MM-DD --allow-live-input --enqueue --outbox /SEPARATE/PATH/OUTBOX.sqlite
```

실행 환경에 선택 의존성 `psycopg` 3이 필요하다. 없으면 안전한 오류 요약으로 종료한다. `autocommit=False`, `SET TRANSACTION READ ONLY`, `SET LOCAL statement_timeout = '2s'`를 적용한 뒤 위 다섯 필드만 `%s` 매개변수로 조회한다. KST naive 날짜 문자열 범위와 LIMIT 101을 사용한다. 성공·실패 모두 rollback 후 연결을 닫는다. outbox는 별도 로컬 SQLite에만 저장한다.

SSL은 기본 `require`이며 URI에 명시한 `verify-ca`·`verify-full`은 유지한다. `disable/allow/prefer`는 거부하고 실패 후 비암호화 연결로 재시도하지 않는다. TLS를 지원하지 않는 내부 주소이면 검증 가능한 TLS 주소와 읽기 전용 DB 계정을 설정해야 한다. 연결 timeout도 2초다.

검증 상태: PostgreSQL 경로는 **passed(mocked)** — 드라이버 mock으로 읽기 전용 설정·시간 제한·매개변수·조회 필드·행 제한·실패 후 close·SSL 하향 금지를 확인했다. **실제 PostgreSQL 연결은 not_run**이며 운영 계정/권한/스키마/성능 검증은 아직 남아 있다. API 사용은 [psycopg 연결 공식 문서](https://www.psycopg.org/psycopg3/docs/api/connections.html)와 [dict_row 공식 문서](https://www.psycopg.org/psycopg3/docs/api/rows.html)를 대조했다.

환불 파일의 선택적 `refunds`는 주문 ID를 키로 사용하며 값은 다음 네 필드만 허용한다. 이 증빙은 운영자가 실제 결제·환불 정본과 대조해야 하며, 코드가 결제사 진위를 확인하지 않는다.

```json
{"confirmed":true,"reference":"refund-001","paid_amount":12000,"refund_amount":3000}
```

## 재시도·보류

개인정보를 제거한 수신 상태를 SHA-256으로 요약한다. outbox는 `(order_id,digest)` 중복을 막고 `BEGIN IMMEDIATE`로 revision을 배정한다. 같은 과거 상태의 재등장은 과거 revision/body를 재사용하며 새 revision으로 되돌리지 않는다. 신규 상태의 누적 환불 감소, 최초 결제액·날짜·배송 방식 변경은 보류한다.

확정되지 않은 취소를 관측하면 기존 결제 대장을 덮지 않고 해당 주문의 미송신 outbox도 보류한다. 뒤늦은 PAID 관측으로 이 보류를 해제하지 않는다. 전액 환불 증빙으로 정리한 뒤에만 송신 대상이 된다. 운영자가 취소 보류를 별도 판단으로 해제하는 UI는 아직 없다.

송신 중 실패하면 미확인 항목을 남긴다. 다음 실행은 동일한 저장 body/revision을 보내고 서명 timestamp만 갱신한다. 서버는 revision으로 중복·역순을 처리한다. 응답이 200이고 생성/갱신/중복/이전상태 건수의 합이 1인 경우에만 확인 완료로 표시한다. outbox를 지우거나 다른 몰/연결에 재사용하면 revision 정합성을 잃으므로 보존해야 한다.

## 실제 연결 전 필요한 설정

COLLECTIVE의 해당 브랜드/지점에서 몰 식별자 `mapdal`의 서명 수신 연결을 만들고, 수신을 명시적으로 활성화한 뒤에만 실제 연결할 수 있다. 이 작업에서는 생성·활성화하지 않았다.

- `COLLECTIVE_WEBHOOK_URL`: `https://mealzip-agency.hflameb.chatgpt.site/api/storefront-webhooks/<연결 UUID>`
- `COLLECTIVE_WEBHOOK_SECRET`: 해당 연결의 서명 키. 환경 변수에서만 읽으며 CLI 인자/로그로 받지 않는다.
- 송신 실행에는 `--enqueue --allow-live-input --send` 세 옵션이 필요하다.

허용 호스트·HTTPS·443·고정 경로만 사용하고 사용자 정보/쿼리/fragment/리다이렉트/환경 프록시를 거부한다. 최초 송신의 URL을 outbox에 고정하여 다른 지점 연결로 바꿔 보내지 못한다. HMAC-SHA256은 수신 코드와 동일한 `timestamp + '.' + rawBody`를 사용한다. 네트워크 제한시간은 20초다.

테스트는 합성 주문·로컬 SQLite·모의 HTTP를 사용했다. 실몰 주문/취소/부분환불 대조, 운영 웹훅 송수신, 실제 Meta 전환 수신은 아직 검증하지 않았다.
