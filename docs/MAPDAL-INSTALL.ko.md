# MAPDAL 통합 어댑터 설치

`integration.py`는 기존 상품 설명·판매 가능 재고·주문 outbox 어댑터를 하나의 ASGI 진입점으로 연결합니다. 생성 시 DB 변경과 외부 요청은 없습니다. `install.py migrate --confirm-additive-migrations`만 부가 테이블을 설치합니다. 기존 상품·가격·재고 값은 설치 과정에서 바뀌지 않습니다.

현재 문서의 검증은 합성 SQLite와 ASGI 호출입니다. 운영 서버 설치·실제 키 연결·실제 고객 발송·유료 호출은 별도이며 이 구현 검증에서 실행하지 않았습니다.

## 1. 파일과 구성

`scripts/mapdal` 디렉터리 전체를 같은 버전으로 서버에 배치하고 Python 모듈 경로에 추가합니다. 일부 파일만 이전 버전으로 유지하면 계약이 달라질 수 있습니다. 기존 `app.db`는 SQLite/PostgreSQL 차이를 처리하는 Cx 객체를 반환해야 합니다.

구성 예시는 아래와 같습니다. 실제 상품 ID를 명시하고, 공개 ID와 저장소 ID를 동일하게 유지합니다. `mpd::123`처럼 콜론이 있는 실제 ID를 사용할 수 있습니다. manifest에는 비밀 값 대신 환경변수 이름만 넣습니다.

```json
{
  "version": 1,
  "tenantId": "approved-tenant",
  "storeId": "approved-store",
  "products": ["mpd::123"],
  "readinessTokenEnv": "COLLECTIVE_READINESS_TOKEN",
  "landing": {
    "enabled": true,
    "secretEnv": "COLLECTIVE_LANDING_SECRET",
    "writeEnabled": false
  },
  "catalog": {
    "enabled": true,
    "secretEnv": "COLLECTIVE_CATALOG_SECRET"
  },
  "orders": {
    "enabled": false
  },
  "cs": {"enabled": false},
  "consumer": {"enabled": false},
  "experiment": {"enabled": false}
}
```

각 키는 공백 없는 32바이트 이상의 독립 키로 서버의 비밀 환경변수에 주입합니다. 랜딩과 재고 키는 Collective의 해당 판매처 설정과 정확하게 일치시킵니다. 준비 상태 확인 토큰은 운영 확인용이며 수집·쓰기 키와 분리합니다. 파일·명령 인수·로그·Git에 실제 값을 넣지 않습니다.

주문을 켤 때는 `tokenEnv`와 영속 볼륨의 절대 경로 `outbox`를 함께 지정합니다. 주문 수집기는 기존 `adapter.py`의 제한된 가져오기 절차로 이 outbox를 채웁니다. HTTP 조회 자체는 실제 주문 DB에 접속하지 않습니다. 최초 migration은 비어 있고 귀속 이력이 없는 outbox에만 `tenantId`/`storeId`를 영구 기록합니다. 다른 점포에 귀속된 outbox, 기존 주문/hold가 있는 미귀속 outbox, endpoint만 저장된 과거 outbox는 자동으로 귀속하지 않고 설치를 중단합니다. 기존 outbox는 보존하고, 승인된 원점 자료로 새 전용 outbox를 채우는 절차를 사용합니다. readiness와 실제 주문 조회 트랜잭션에서 이 귀속을 각각 재검사합니다. outbox의 미해결 취소 hold는 기존 계약대로 조회를 중단시킵니다.

## 2. ASGI 연결과 정적 파일 우선순위

MAPDAL의 기존 `app.mount('/', StaticFiles(...))` 뒤에 새 경로를 추가하면 정적 파일 mount가 먼저 요청을 가져갈 수 있습니다. 원래 앱을 감싸는 진입점을 사용하면 기존 앱의 라우트와 lifespan을 보존하면서 어댑터를 먼저 검사합니다.

서버 프로젝트에 다음과 같이 `collective_entry.py`를 준비합니다.

```python
import app as shop
from install import load_manifest
from integration import create_integration

MANIFEST = '/etc/mapdal/collective-adapters.json'

def create(manifest):
    return create_integration(
        shop.app, shop.db, manifest,
        is_pg=shop.IS_PG,
        ready=lambda: shop.DB_READY,
    )

application = create(load_manifest(MANIFEST))
```

진입점은 `uvicorn collective_entry:application --host 0.0.0.0 --port "$PORT"`입니다. 설치 순서는 기존 앱 스키마 준비 → 명시적 어댑터 migration → 새 진입점 재시작 → 인증된 준비 상태 확인입니다. 원래 앱의 `/healthz`는 liveness 용도로 유지합니다. 고객 트래픽을 전환하기 전에 아래 `verify`가 통과해야 합니다.

어댑터 경로는 `/collective/v1/landing/`, `/collective/v1/catalog/read`, `/collective/v1/orders`, `/collective/v1/cs/`, `/collective/v1/consumer/`입니다. 실험 SDK는 기존 `/collective/experiment/` 경로를 유지합니다. 설정되지 않은 어댑터와 알 수 없는 `/collective/v1/` 경로는 404이며 정적 파일로 넘기지 않습니다. 그 밖의 요청과 lifespan은 원래 앱에 전달합니다.

원래 앱의 호스트·Origin 보호는 일반 앱 요청에 그대로 적용됩니다. 어댑터의 기계 요청은 각 HMAC/Bearer 검증을 거치고, 실험 요청은 기존 ASGI 어댑터에서 동일 Origin·세션·CSRF를 검사합니다.

## 3. 설치·검사 명령

```sh
# 파일만 검증. DB/키/서버 모듈 접근 및 네트워크 없음.
python scripts/mapdal/install.py plan --manifest /etc/mapdal/collective-adapters.json

# 신뢰할 수 있는 로컬 factory를 명시적으로 로드하고 스키마를 읽어서 검사.
PYTHONPATH=scripts/mapdal:. python scripts/mapdal/install.py check \
  --manifest /etc/mapdal/collective-adapters.json --factory collective_entry:create

# 명시적인 부가 테이블 설치. 기존 앱 스키마를 먼저 준비해야 함.
PYTHONPATH=scripts/mapdal:. python scripts/mapdal/install.py migrate \
  --manifest /etc/mapdal/collective-adapters.json --factory collective_entry:create \
  --confirm-additive-migrations

# 운영 서버에 GET 1회. 실제 기능 발송/상품 변경은 발생하지 않음.
python scripts/mapdal/install.py verify --manifest /etc/mapdal/collective-adapters.json \
  --origin https://mapdal.kr
```

`check`는 별도 CLI 프로세스라 lifespan의 `DB_READY` 대신 실제 스키마를 검사합니다. 실행 중인 서버의 readiness는 `DB_READY`와 스키마를 모두 검사합니다. `migrate`는 반복 실행할 수 있는 부가 설치이며 여러 어댑터 전체를 한 트랜잭션으로 묶지는 않습니다. 중간 실패 시 원인을 서버에서 확인하고 같은 명령으로 재개합니다.

`verify`는 `https://mapdal.kr` 및 `https://www.mapdal.kr`만 허용하고 리디렉션을 차단합니다. 10초 제한, 16 KiB 응답 제한, 구성에 명시한 enabled/disabled 기능의 정확한 일치를 검사합니다. 응답과 CLI 출력은 기능별 `ready`/`unavailable`/`disabled`만 포함하며 상품 ID·고객 정보·키·DSN·예외 원문을 내보내지 않습니다.

## 4. 고객 메시지·CS·실험 연결

이 세 기능은 실제 호스트의 현재 동의/권한/세션을 아는 생산용 factory가 필요합니다. `enabled: true`인데 factory가 없으면 앱 생성 자체가 실패합니다. 합성 `SQLiteConsumerStore`를 자동으로 연결하지 않습니다.

공통 계약은 다음과 같습니다.

```python
from integration import Capability

def production_factory(db, is_pg, config, env):
    # config의 tenantId/storeId는 통합 manifest의 고정 scope이다.
    # 실제 저장소/ASGI 인스턴스 생성만 수행하며 여기서 migrate/발송 금지.
    return Capability(app=asgi_app, check=read_only_check, migrate=explicit_migrate)
```

각 factory를 `create_integration(..., cs_factory=..., consumer_factory=..., experiment_factory=...)`에 전달합니다. 생산용 고객 메시지 factory는 `consumer_storage_adapter.consumer_factory`이며 실제 transport를 연결하지 않으면 준비 상태 검사를 통과하지 못합니다. 실제 호스트 동의는 `COLLECTIVE_POST_PURCHASE`와 `COLLECTIVE_MARKETING_REORDER`를 별도로 확인하며 기존 포괄적 `MARKETING` 동의를 자동으로 확대하지 않습니다. 고객 메시지의 `config`는 `secretEnv`, `mappingKeyEnv`, `policies`, `templates`, `authorization`을 명시하며 상위 manifest에서 `tenantId`/`storeId`가 주입됩니다. 실제 발송기는 호스트가 다음처럼 고정 주입합니다.

```python
from consumer_storage_adapter import consumer_factory

def configured_consumer(db, is_pg, config, env):
    return consumer_factory(db, is_pg, config, env, transport=approved_transport)
```

`approved_transport`는 해당 서버에서 설치한 `check/send/lookup` 계약 구현입니다. factory의 기본값은 `None`이며 이를 두고 기능을 활성화하면 readiness가 실패합니다. section의 `config`는 factory가 엄격하게 검증합니다. `check()`는 호스트 필수 열/부가 테이블·설정 조건을 읽어서 확인하고, `migrate()`만 부가 저장소를 준비합니다. 고객 발송과 실험 이벤트 전달 worker는 이 설치 명령에서 실행하지 않습니다.

- CS는 실제 문의·주문·고객 연결과 현재 답변 권한을 재검사하는 `MapdalCsStore`를 사용합니다.
- 고객 메시지는 현재 목적별 동의와 수신처를 확인하는 실제 저장소 및 승인된 발송 transport가 필요합니다. 동의 철회와 unknown receipt의 대사 계약을 유지해야 합니다.
- 실험 factory는 호스트 세션에서 measurement unit/현재 동의/CSRF를 해석해야 합니다. 브라우저가 보낸 고객 ID를 신뢰하지 않습니다. outbox와 서버 worker는 동의 재검사를 유지합니다.

## 5. 전환과 복구

먼저 합성 상품·합성 수신자 staging에서 기존 앱 페이지, signed read, unknown 조회 복구, 권한 거절을 확인합니다. 운영 설치는 키·scope·상품 매핑·동의 정책·배포 권한을 확인한 별도 작업입니다. 실제 랜딩 쓰기에는 `writeEnabled`와 Collective 승인 모두가 필요합니다.

문제가 발생하면 이전 서버 진입점으로 복원합니다. 부가 nonce/영수증/outbox 테이블은 삭제하지 않습니다. 특히 unknown 발송·변경 요청의 영수증을 보존하고 조회로 대사해야 합니다. 단순 재시작이나 재설치가 unknown 요청을 다시 보내는 근거가 되지 않습니다.
