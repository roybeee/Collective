# MAPDAL 상품 설명 어댑터 설치

`scripts/mapdal/storage_adapter.py`는 MAPDAL의 실제 `products.descr` 열과 실행 영수증을 같은 데이터베이스 트랜잭션에서 저장한다. `detail_html` 본문·가격·재고는 바꾸지 않는다. 확인한 판매처 소스는 `mapdal-live/app.py`의 `db()`/`Cx`와 `admin_v2.py`의 `/p/{pid:path}` 화면이다. 페이지는 `descr`를 HTML escape하여 상품 소개와 검색 설명으로 표시한다. 따라서 Collective의 구매 이유 변경은 이 짧은 소개 영역에 적용된다.

이 파일을 만든 것은 운영 설치 완료를 뜻하지 않는다. 운영 데이터베이스·사이트에는 이번 개발에서 접근하거나 마이그레이션하지 않았다.

## 설치 구성

1. `bridge.py`, `storage_adapter.py`, `asgi_adapter.py`를 판매처 코드의 동일한 모듈 디렉터리에 포함한다.
2. `COLLECTIVE_LANDING_KEY`는 32바이트 이상 서버 환경변수로 설정한다. Collective 연결에도 동일한 키를 등록한다. 키를 코드·로그·명령 인자에 넣지 않는다.
3. 앱의 기존 스키마 준비가 끝난 뒤 별도 설치 단계에서 `store.migrate()`를 한 번 실행한다. 생성하는 테이블은 `collective_landing_*` 다섯 개이며 기존 상품을 만들거나 seed하지 않는다. PostgreSQL과 SQLite의 기존 `db()` 트랜잭션 컨텍스트를 사용한다.
4. 실제 판매처의 상품 ID만 명시적으로 허용한다. 임의 상품 검색이나 다른 지점 접근은 제공하지 않는다. 같은 상품을 여러 alias로 등록하지 않는다.
5. FastAPI 앱에 아래처럼 mount한다. mount는 서버 프로세스가 시작할 때 한 번 등록하고 요청마다 마이그레이션하지 않는다.

```python
import os
from bridge import LandingBridge
from storage_adapter import MapdalLandingStore
from asgi_adapter import LandingASGI

# app, db, IS_PG는 MAPDAL app.py의 기존 객체를 사용한다.
store = MapdalLandingStore(db, IS_PG, "configured-tenant", "configured-store", {
    "actual-product-id": "actual-product-id",
})
bridge = LandingBridge(store, os.environ["COLLECTIVE_LANDING_KEY"],
                       "configured-tenant", "configured-store",
                       {"landing:read", "landing:write"})
app.mount("/collective/v1/landing", LandingASGI(bridge))
```

판매처의 기존 로그인 미들웨어가 이 네 경로를 로그인 HTML로 바꾸면 안 된다. 이 경로만 bridge HMAC 인증으로 처리하고 기존 관리자 화면의 인증은 유지한다. TLS 종단 뒤에서만 제공하며 프록시도 본문 크기·동시 요청 수를 제한한다. ASGI 어댑터는 본문 32KiB·전체 수신 10초, 중복 인증 헤더·쿼리 거부를 적용한다. [Starlette의 ASGI mount 구조](https://www.starlette.io/routing/)를 사용하며 WSGI 변환 패키지는 추가하지 않는다.

## 동시 수정과 복구

- PostgreSQL은 scope와 실제 상품 행에 `FOR UPDATE`, SQLite는 기존 `BEGIN IMMEDIATE`로 직렬화한다.
- 판매처 관리자가 `descr`를 수정하면 다음 읽기에서 digest와 판이 바뀐다. 이전 승인으로 덮어쓰지 않는다. 이 판은 bridge가 관측한 변경의 판이며 모든 관리자 편집 사건을 추적하는 감사 로그가 아니다.
- 실제 상품 수정·sidecar 판·불변 실행 영수증은 같은 트랜잭션이다. 영수증 저장 실패는 실제 상품 수정도 rollback한다.
- 결과 불명은 동일 request ID의 receipt 조회로 확인한다. 원래 요청을 새 ID로 재전송하지 않는다.
- 복원은 원래 적용의 after digest가 현재 상품과 같을 때만 가능하다. 그 사이 수동 수정이 있으면 새 검토가 필요하다.
- 제품 매핑은 이미 사용한 ID의 실제 상품을 바꾸면 거부한다. 새로운 상품은 새 ID를 사용한다.

## 검증 범위

`python3 tests/mapdal_storage_adapter_test.py`: 실제 임시 SQLite에 MAPDAL 열 구조를 구성하여 상품 변경·원자 rollback·동시 수정 감지·복원·범위·nonce·재시작을 검사한다. `python3 tests/mapdal_asgi_adapter_test.py`: ASGI 수신·경로·크기·중복 헤더 경계 검사. PostgreSQL 서버 실행, 실제 FastAPI 배포 및 실제 판매처 HTTP 검증은 **not_run**이다. 설치 후 staging PostgreSQL과 실제 렌더 페이지를 검증해야 운영 연결을 완료로 표시할 수 있다.
