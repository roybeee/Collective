# 제한 평가 게이트웨이

SQLite 장부는 최초 설치 때 소유자 ID를 원자적으로 고정한다. 다른 소유자가 같은 파일을 재사용하면 시작을 거부한다. 소유자 표시 없이 이미 견적·실행이 들어 있는 이전 장부도 자동 귀속하지 않는다. 미정산 장부를 삭제하거나 새 소유자에게 넘기지 말고 원 소유자의 별도 서비스에서 먼저 대사해야 한다.

이 서비스는 Q 평가의 정확한 `{instructions,input}` 한 건을 고정 모델에 한 번 전달한다. 일반 Hermes 실행 대리 서비스가 아니다. 도구·검색·fallback·SDK retry가 없고, 최대 입력·출력과 정확한 견적을 서버가 검사한다. 구현과 합성 검증은 완료 대상이지만 실제 공급자 계약·설치·유료 호출은 수행하지 않았다.

## 과금 계약과 차단 조건

`fixed_krw / provider_fixed_krw`는 세금·수수료가 포함된 원화 상한을 실제 공급자가 계약하고, 공급자 신뢰키로 서명한 계약·개별 견적·영수증을 제공할 때만 사용한다. `SignedFixedProvider`는 설치자가 고정한 HTTPS origin·계약 ID·모델만 허용한다. 공급자는 아래 동일 API에서 요청 digest·견적·출력 제한·한 번의 과금과 GET-only 영수증 복구를 집행해야 한다. 이 원화 계약을 제공하는 실제 공급자를 설치자가 확보해야 하며, 현재 저장소에 계약된 운영 공급자나 과금 계정은 없다. HMAC은 지정 공급자의 응답임을 확인하는 수단이며 은행 청구나 법적 계약 이행 자체를 증명하지 않는다.

OpenAI 직결 adapter는 고정 snapshot `gpt-4.1-mini-2025-04-14`와 `/v1/chat/completions`를 사용하는 실행 가능한 단일 HTTP 구현이다. 실제 `max_completion_tokens`, `n=1`, `stream=false`, `store=false`를 보낸다. 이 공급자의 USD 청구를 설정 환율로 곱해 실제 원화 상한이라고 표시하지 않는다. 따라서 `openai_usd_diagnostic` 계약은 `usd_conservative_conversion / local_estimate`, `taxAndFeesIncluded=false`이며 이 게이트웨이의 유료 제출은 **409 krw_contract_required**로 차단된다. 계약 조회와 무료 견적 진단만 가능하다. 유료 Q 운영은 signed_fixed 계약이 필요하다.

모델/요청 의미의 공식 확인 출처(2026-10-04): [GPT-4.1 mini 모델](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Chat Completions API](https://developers.openai.com/api/reference/resources/chat). 문서의 최대 출력과 snapshot 명칭을 확인했으며 서비스는 출력 4,096 토큰으로 더 작게 제한한다. 가격표·환율만으로 원화 청구 계약을 추정하지 않는다.

## 설치

Python 표준 라이브러리만 사용한다. 전용 owner 하나당 별도 서비스와 영구 SQLite 파일을 배치한다. 기존 앱 DB에 임의 테이블을 만들지 않는다. 백업/복원 시 quotes·submissions를 함께 보존하고, 결과 불명 원장을 지우거나 초기화해 재전송하지 않는다.

필수 환경변수:

- `EVAL_GATEWAY_PROVIDER=signed_fixed` 또는 `openai_usd_diagnostic`
- `EVAL_GATEWAY_DB`: 전용 영구 파일의 절대 경로. 부모 폴더는 운영자가 준비한다.
- `EVAL_GATEWAY_OWNER`: Collective owner와 같은 고정 값
- `EVAL_GATEWAY_TOKEN`, `EVAL_GATEWAY_SIGNING_KEY`: 서로 다른 최소 32자 인증키/응답 HMAC 키
- `EVAL_GATEWAY_CAP_KRW`: 이 SQLite 원장의 전체 기간 실제 확정 비용+결과 불명 최대 예약액 상한(정수). 월 상한과 별개이며 Q는 owner 월 예산도 집행한다. 실행 중 원장을 삭제해 상한을 초기화하지 않는다.
- signed_fixed: `EVAL_UPSTREAM_ORIGIN`, `EVAL_UPSTREAM_TOKEN`, `EVAL_UPSTREAM_TRUST_KEY`, `EVAL_UPSTREAM_OWNER`, `EVAL_UPSTREAM_CONTRACT_ID`, `EVAL_UPSTREAM_MODEL`
- USD 진단: `OPENAI_API_KEY`
- 선택: `EVAL_GATEWAY_PORT`(기본 8798)

환경변수를 안전하게 설정한 뒤 저장소 루트에서 실행한다.

```sh
PYTHONPATH=scripts python3 -m eval_gateway.serve
```

127.0.0.1에만 바인딩한다. TLS reverse proxy·배포 비밀 저장소·방화벽은 운영자가 제공한다. Q의 `EVAL_BOUNDED_ALLOWED_HOSTS`에 정확한 공개 호스트를 등록하고 인증키·서명 신뢰키를 연결한다. 기본 로그는 HTTP 경로/본문/인증 헤더를 기록하지 않는다. DB는 실행 시 umask 077로 생성하되 기존 파일 권한도 운영자가 확인한다. 출력 결과와 비용 영수증은 DB에 보존하므로 동일한 접근 통제가 필요하다. 요청 원문은 gateway DB에 저장하지 않고 digest만 남긴다.

## HTTP와 서명

모든 경로에 `Authorization: Bearer …`, `x-collective-owner`가 필요하다. POST는 `Content-Type: application/json`과 Content-Length가 필요하다. 요청 본문 64KiB, 읽기 5초, 동시 연결 8개, 인증된 전체 요청 분당 120개, 공급자 응답 256KiB/25초, quote 누적 10,000개 상한이다. redirect·중복 보안 헤더·transfer encoding·query string은 거절한다. 운영자가 quota/보관 정책을 정리하기 전 한도에 도달하면 차단하며 실행 영수증을 자동 삭제하지 않는다.

- `GET /v1/eval-contract`: `collective.eval-cost.v1`, id/digest/provider/model/priceVersion/validUntil, billing, limits, durableIdempotency, receiptLookup.
- `POST /v1/eval-quotes`: `{request:{instructions,input},maxOutputTokens,contractDigest}`. 무료 견적이며 원장 예산을 사용하거나 모델을 호출하지 않는다. 응답 `collective.eval-quote.v1`은 quoteId/contractDigest/requestDigest/model/maxInputTokens/maxOutputTokens/maxChargeKrw/expiresAt를 고정한다.
- `POST /v1/eval-submissions`: `{requestId,quoteId,requestDigest,contractDigest,request}`. requestId는 정규 UUID다. 최초 요청만 공급자 POST를 실행한다.
- `GET /v1/eval-submissions/{requestId}`: 결과 불명 요청을 공급자 GET으로만 대사한다. 공급자에서 아직 결과를 확인할 수 없으면 unknown/reserved를 유지한다.

응답 서명은 signature를 제외한 canonical JSON(키 정렬·공백 없음·UTF-8)의 HMAC-SHA256 hex다. 서명 입력은 `collective.eval-cost.v1\nMETHOD\nPATH\nOWNER\nCANONICAL_BODY`다. contract digest는 digest/signature를 제외한 계약의 SHA256이며 requestDigest는 정확한 `{instructions,input}`의 canonical SHA256이다. 출력 영수증은 `collective.eval-receipt.v1`, 정확한 requestId/requestDigest/quoteId/contractDigest/model, status/settlement/chargeKrw/usage/output을 연결한다.

UTF-8 입력 바이트 합계+256을 보수적인 입력 토큰 상한으로 검사한다. 실제 tokenizer 계측이라고 표시하지 않으며 공급자도 계약의 maxInputTokens/maxOutputTokens를 집행해야 한다. 모의 공급자나 임의 FX 설정이 fixed_krw 계약을 생성하지 않는다.

## 결과 불명과 비용 보존

Q 실행 삭제는 Collective 로컬 생성 결과와 비용 영수증의 output을 지운다. 원래 영수증 digest·서명·비용·사용량은 감사·정산용으로 유지한다. 외부 평가 gateway의 원본 영수증·출력 삭제는 공급자 보존·삭제 정책에 따라 별도로 수행하며, Q 삭제로 외부 삭제가 완료되지는 않는다.

SQLite `BEGIN IMMEDIATE`에서 원화 예약과 immutable request identity를 먼저 저장하고 commit한 뒤 POST한다. 같은 quote를 다른 requestId에 쓰거나 같은 requestId에 내용을 바꾸는 것은 거절한다. HTTP 오류·타임아웃·프로세스 중단·잘못된 서명·상한 초과 영수증은 unknown/reserved다. 자동 POST 재시도나 공급자/모델 전환이 없으며 SQLite 재시작 뒤에도 같다.

서명된 완료 영수증에서 정확한 판·실제 비용·입출력 토큰을 대조한 뒤에만 final로 전환하고 예약 잔액을 해제한다. 공급자 서명으로 명시된 rejected/final/0원도 해제할 수 있다. 결과 불명이나 제공자 ID가 없는 OpenAI 응답 유실은 영구 미확인일 수 있으며 무과금으로 추정하지 않는다. 키/계약을 교체하기 전 미확정 건의 기존 공급자 GET 복구가 계속 가능하도록 운영해야 한다.

## 검증

`python3 tests/eval_gateway_core_test.py`, `python3 tests/eval_gateway_provider_test.py`, `python3 tests/eval_gateway_http_test.py`로 real SQLite·실제 localhost HTTP와 synthetic/mocked 공급자를 검증한다. 경합·재시작·UUID 중복·예산 원자 예약·결과 불명 보존·정확한 digest·서명·원화/출력 상한·인증·본문 제한을 검사한다. 실제 OpenAI/원화 공급자 유료 호출·배포·운영 은행 대사는 not_run이다.
