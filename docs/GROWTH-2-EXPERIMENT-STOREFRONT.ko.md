# 판매처 실험 계측 설치

이 패키지는 서버가 인정한 실험 배정을 화면 변형에 연결하고, 렌더링 성공 뒤 노출을 기록합니다. 운영 사이트에 설치하거나 이벤트를 전송한 상태는 아닙니다. 고객 DB 스키마·동의 상태·주문을 자동으로 바꾸지 않습니다.

## 구성과 신뢰 경계

- `experiment_client.py`: 별도 SQLite 파일의 불변 설계/UUID 사건 outbox와 고정 Collective 주소 HMAC 전송. 현재 서버 동의를 매 시도 다시 읽고, 철회 사건을 먼저 처리합니다.
- `experiment_asgi.py`: `https://mapdal.kr` same-origin POST 전용. 브라우저 본문은 `{ "action": "assign" | "exposure" | "withdraw" }`만 받습니다. unit UUID, arm, 주문, 금액, 동의를 브라우저에서 받지 않습니다.
- `experiment-browser.js`: 서버의 배정 ACK가 있어야 renderer를 호출합니다. `await render(...)` 성공 뒤에만 exposure를 보냅니다. 할당 대기는 최대 6회, 요청 제한은 5초입니다. 페이지 종료/탭 닫힘으로 tracking_close를 만들지 않습니다.

ASGI는 256바이트 본문, 중복 보안 헤더/JSON 필드 거절, 5초 읽기·현재 세션 조회 제한, 세션 UUID별 분당 30회/프로세스당 최대 4,096개 활성 rate 항목을 적용합니다. 철회는 일반 계측 rate 소진으로 막지 않습니다. 다중 프로세스 배포는 기존 판매처 reverse proxy의 전역 요청 제한도 적용해야 합니다. 응답에는 arm과 작은 상태 enum만 있고 식별자·서명 키·상세 오류는 없습니다. 로컬 SQLite 작업은 별도 thread에서 수행합니다. 제한 시간이 지난 뒤에도 이미 시작한 로컬 저장이 끝날 수 있으므로 408은 저장 실패 확정이 아닙니다. 같은 세션 action을 다시 요청하면 outbox의 기존 사건 UUID로 복구합니다.

## FastAPI 연결 예제

다음은 설치 지점 예제입니다. `session_store`와 `measurement_consents`는 판매처의 **실제 서버 저장소 어댑터를 구현해서 주입해야 하는 인터페이스**이며 이 저장소는 임의로 만들거나 기존 마케팅 동의를 대신 사용하지 않습니다. 본문·쿠키에서 UUID/동의 값을 그대로 복사하는 구현은 금지합니다.

```python
import asyncio
import os
from experiment_client import ExperimentOutbox, SignedTransport
from experiment_asgi import ExperimentASGI

# frozen_design은 Collective에서 사전등록한 현재 설계를 운영자가 고정한 값.
# campaignId, designId, designVersion, registrationDigest, startAt, endAt만 포함.
box = ExperimentOutbox(os.environ['EXPERIMENT_OUTBOX_PATH'], frozen_design)
transport = SignedTransport(os.environ['EXPERIMENT_CONNECTION_ID'],
                            os.environ['EXPERIMENT_SIGNING_SECRET'])

async def resolve_context(scope):
    # 이미 인증된/서명 검증된 세션을 서버 저장소에서 찾는다.
    # measurement_unit_id는 서버가 최초 고지·동의 때 uuid.uuid4()로 만들고 저장한
    # 실험 전용 임의값. 회원 ID, 이메일 해시, 주문 ID를 재사용하지 않는다.
    session = await session_store.current(scope)
    consent = await measurement_consents.current(session.measurement_unit_id)
    return {'unitId': session.measurement_unit_id,
            'csrfToken': session.csrf_token,
            'consent': consent}  # granted(bool), noticeVersion, observedAt(UTC ISO)

app.mount('/collective/experiment', ExperimentASGI(box, resolve_context))

# 기존 제공자 worker에 설치. 브라우저 요청이 직접 외부 전송을 실행하지 않는다.
# current_sync는 사건의 임의 unit ID로 현재 저장된 측정 동의를 읽는 동기 함수.
# 조회 불가 -> None, 명시 철회 -> granted=False. 조회 실패를 동의로 간주하지 않는다.
def worker_tick():
    return box.deliver_one(transport, measurement_consents.current_sync)
```

worker_tick은 기존 서버 스케줄러가 짧은 주기로 호출합니다. 한 번에 최대 한 사건을 처리하고 실패 재시도에는 SDK의 backoff가 적용됩니다. 실제 앱 DB와 별도의 영속 디스크 경로를 지정해야 재시작 후 동일 UUID로 복구됩니다. SDK 파일 자체에는 스케줄러 등록이나 네트워크 전송 자동 실행이 없습니다.

## 고지·동의 및 화면 연결

측정 고지에는 실험 목적, 수집 범위(임의 세션·배정·노출·서버에서 확인된 주문 연결), 관측 기간과 철회 경로를 표시합니다. 동의 관리 UI는 **서버 저장소에 명시 동의를 저장한 뒤** start를 호출합니다. consent observedAt은 서버 확인 시각이며 noticeVersion은 실제 고지 판입니다. 고지 판이 달라지면 기존 단위를 철회하고, 기존 UUID를 다시 켜지 않습니다.

JS 파일만 기존 정적 파일 경로에 복사해 같은 origin에서 제공합니다. Python·SQLite·환경 파일을 정적 디렉터리에 노출하지 않습니다. 예제 csrfToken은 서버 템플릿의 안전한 JSON 인코딩 값으로 전달하며 서명 비밀 키와는 다릅니다.

```javascript
import {createExperiment} from '/static/experiment-browser.js';
const experiment = createExperiment({
  csrfToken: pageSession.csrfToken,
  async render(arm, {signal}) {
    // arm은 오직 서버 ACK의 control/treatment. URL·브라우저 임의값으로 덮어쓰지 않는다.
    // 실험의 사전등록 대상만 변경한다. 실패하면 throw하고 기존 화면으로 복원한다.
    await renderRegisteredVariant(arm, {signal});
  }
});
// 서버에 현재 측정 동의가 이미 저장된 사용자만 실행한다.
const result = await experiment.start();
```

renderer는 DOM 변경이 실제로 완료됐을 때 resolve해야 합니다. signal이 취소되면 진행 중 렌더를 멈추고 기존 화면으로 복원합니다. 이는 클라이언트의 렌더 성공 보고이며 사람이 화면을 봤다는 증명은 아닙니다. 시작 결과가 pending이면 기본 화면을 유지하고, worker가 배정을 수신한 뒤 명시적으로 start를 다시 호출할 수 있습니다. 자동 무한 polling은 없습니다.

철회는 동의 관리 화면에서 서버의 측정 동의를 먼저 false로 저장하고 `await experiment.withdraw()`를 호출합니다. 로컬에서는 즉시 추가 계측을 중단합니다. withdrawal_pending이면 온라인 복구 시 withdraw만 재시도합니다. 서버 worker 역시 현재 동의를 재확인하므로 브라우저가 닫혀도 이미 큐에 있는 계측을 계속 허용하지 않습니다. 검사 직후와 외부 요청 사이의 동시 철회는 네트워크와 DB를 하나의 원자적 작업으로 묶을 수 없으므로, 지속 저장된 철회 사건으로 수신 측 철회 상태를 복구합니다.

## 비구매 포함 관측 완료

`close_from_reconciliation`은 브라우저에 노출하지 않는 서버 작업 전용 함수입니다. 서버가 전체 주문 대사를 끝냈고 실험 관측 기간이 완료됐다는 두 조건이 모두 true일 때만 close를 큐에 저장합니다. 근거가 없거나 부분 조회이면 false를 반환하고 완료 사건을 만들지 않습니다.

```python
from experiment_asgi import close_from_reconciliation
complete = close_from_reconciliation(box, trusted_session_unit_id, {
    'orders': canonical_order_references,  # [{'externalId':'MD-YYYYMMDD-ABCDEF','revision':1}]
    'trackingThrough': reconciled_through_utc,
    'orderReconciliationComplete': reconciliation.all_pages_and_orders_verified,
    'observationWindowComplete': reconciliation.window_finished,
    'contaminated': reconciliation.contaminated,
})
```

주문은 이미 수신·대사한 원본 주문 ID/판만 연결합니다. 매출·원가·arm을 브라우저 값으로 채우지 않습니다. 이벤트 API의 현재 원본 주문 판 검사와 관측 종료 검사도 통과해야 수신 완료가 됩니다. 서버 작업은 trusted session→order 연결의 완전성을 직접 증명해야 하며 이 패키지가 전체 주문 DB 대사를 대신 수행했다고 주장하지 않습니다.

## 로컬 검증

`python3 tests/mapdal_experiment_asgi_test.py`, `node tests/mapdal-experiment-browser.test.mjs`는 실제 임시 SQLite/합성 ASGI 요청과 mock fetch로 검증합니다. 실판매처 세션 저장소, 다중 프로세스 proxy 제한, 실제 DOM 렌더, 설치 worker와 운영 수신 연결은 설치 후 별도 검증 대상입니다.
