# Instagram 직접 게시(Graph API)·Threads 게시 (C3)

Buffer를 거치지 않고 Instagram Graph API·Threads API로 승인된 발행을 보내는 경로다. **기본은 꺼져 있다.** 스위치를 켜고 브랜드에 장수명 토큰을 연결해도, 기존과 똑같이 사람이 발행을 **승인(approve)** 하고 **실행(execute)** 을 눌렀을 때만 전송된다. 그 밖의 어떤 경로도 자동으로 게시하지 않는다.

- 계획 출처: [GLOBAL-PLAN C3](GLOBAL-PLAN.ko.md) · 프레임워크: [CONNECTORS.ko.md](CONNECTORS.ko.md) · 발행 생애주기: [EXECUTION-LOOP.ko.md](EXECUTION-LOOP.ko.md)
- 코드: `lib/connectors/instagram-publish.ts`(Instagram), `lib/connectors/threads.ts`(Threads), `lib/connectors/publish-core.ts`(두 단계 저널·HTTP 분류·한도 해석), `lib/execution-publisher-server.ts`(공급자 선택·전송·댓글 수집), `lib/channel-credentials.ts`(연결 저장, `*PublisherCredential`), `app/api/channels/route.ts`(`connect_publisher`·`verify_publisher`·`revoke_publisher`), `app/api/execution/route.ts`(`execute` 분기·`collect_comments`)
- 검증: `tests/instagram-direct.test.mjs` — passed · mocked(fetch 스텁·메모리 SQLite). 실제 Meta 계정으로의 게시는 이 PR에서 하지 않았다.

## 1. 소유자 설정 순서

1. **Meta 앱 만들기** — [developers.facebook.com](https://developers.facebook.com) 에서 앱을 만들고 Instagram 제품을 추가한다. 두 로그인 방식 중 하나를 고른다.
   - *Instagram API with Instagram Login*: 호스트 `graph.instagram.com`. 연결 때 `login: "instagram"`.
   - *Facebook Login for Business*: Facebook 페이지에 연결된 Instagram 프로페셔널 계정. 호스트 `graph.facebook.com`. 연결 때 `login: "facebook"`(기본).
2. **앱 검수 권한** — 게시에는 `instagram_business_basic`(또는 `instagram_basic`)과 **`instagram_business_content_publish`**(또는 `instagram_content_publish`), 댓글 수집에는 `instagram_business_manage_comments`(또는 `instagram_manage_comments`), 인사이트 수집에는 `instagram_manage_insights`가 필요하다. Threads는 **`threads_basic`·`threads_content_publish`**, 답글 수집은 `threads_manage_replies`, 인사이트는 `threads_manage_insights`. 개발 모드에서는 앱 역할(테스터)인 계정만 쓸 수 있고, 라이브 모드는 앱 검수를 통과해야 한다.
3. **장수명 토큰 발급** — 단기 토큰을 장수명 토큰(60일)으로 교환한다. 만료일을 적어 둔다(토큰에서 읽을 수 없어 사용자가 입력한 값을 보관하고 7일 전 경고에 쓴다).
4. **연결 저장** — `POST /api/channels` `{"action":"connect_publisher","channel":"instagram_direct","brandId":"<브랜드>","data":{"accessToken":"...","userId":"<IG 비즈니스 계정 ID(숫자)>","expiresAt":"2027-01-08T00:00:00Z","login":"facebook"}}`. 저장 전에 `/me`를 불러 토큰이 그 계정의 것인지 확인하고, 다르거나 무효(코드 190)면 저장하지 않는다. 토큰은 `channel_credential`(브랜드 단위, 암호문)에 저장되며 어떤 응답에도 원문이 나오지 않는다. Threads는 `"channel":"threads"`, `userId`는 Threads 사용자 ID.
5. **스위치 켜기** — 소유자가 `/api/feature-flags`에서 `instagram_direct_publish`(또는 `threads_publish`)를 켠다. 꺼져 있으면 연결이 있어도 Buffer 경로 그대로다.
6. **확인** — `GET /api/channels?brandId=<브랜드>`의 `publishers`에서 연결·만료 상태를, `GET /api/execution?campaignId=…`의 `publisher.channelId`가 `instagram_direct:<계정ID>`(또는 `threads:<ID>`)로 바뀌었는지 본다. `{"action":"verify_publisher",...}`로 저장된 토큰이 지금도 유효한지 다시 확인할 수 있다.

## 2. 공급자 선택 규칙

같은 브랜드에서 우선순위: **Instagram 직접 게시**(스위치 켜짐 + 연결) → **Threads**(스위치 켜짐 + 연결) → **Buffer**(기존). 선택된 계정은 발행 화면·승인 게이트·접수가 모두 같은 함수로 읽는다. 승인 때 화면에 보인 계정(`channelId`·`credentialVersion`)과 다르면 409로 막고, 실행 직전에 스위치·연결이 바뀌었으면 보내지 않고 실패로 닫는다. 이 판에는 캠페인별 채널 선택 UI가 없다(소유자가 API로 연결·스위치를 조정한다).

## 3. 전송 절차(실행 때)

1. `prepare` — 캡션 길이(Instagram 2,200자·해시태그 30개, Threads 500자)와 공개 이미지 주소 HEAD(로그인 없이 `image/*`로 응답해야 함)를 검사한다. 걸리면 **보내지 않고** 실패.
2. `limit` — `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config`(Threads는 `threads_publishing_limit`)를 읽어 남은 수가 0이면 보내지 않는다. 안내 문서의 한도는 Instagram 100건/24시간(참조 문서는 `quota_total` 50으로 적힌 판도 있다), Threads 250건/24시간이며 **실제 상한은 응답의 `quota_total`이 정한다**(코드는 하드코딩하지 않는다).
3. `submit` — 두 단계. (a) 컨테이너 `POST /{ig-user-id}/media`(`image_url`·`caption`) → (b) `POST /{ig-user-id}/media_publish`(`creation_id`). Threads는 `POST /{id}/threads`(`TEXT` 또는 `IMAGE`) → `POST /{id}/threads_publish`. 발행 id당 저널 1행(`publication_container`)에 단계를 적는다.
   - 컨테이너를 만든 뒤 프로세스가 죽으면 다음 실행은 **컨테이너를 새로 만들지 않고** 저장된 컨테이너로 게시만 한다.
   - 게시 요청을 보낸 뒤 응답을 못 받으면(타임아웃·연결 끊김·5xx) `unknown`으로 남기고 **절대 자동 재전송하지 않는다**. 발행은 `접수 여부 미확인(uncertain)`이 되고 소유자가 계정에서 게시 여부를 확인한다. 컨테이너 생성 단계의 타임아웃은 게시물이 생기지 않으므로 재시도한다.
   - 429는 `Retry-After`를 따르고(없으면 지터 지수 백오프), 최대 3회 뒤 실패로 닫는다. 4xx는 바로 실패(Graph 오류 코드를 사유에 남긴다).
4. 결과 — 성공은 `게시 확인(published)`에 미디어 ID(`providerId`)를 적는다. Buffer와 달리 **예약이 아니라 실행 즉시 게시**된다(Graph API에 예약 게시가 없다). 예약 시각은 캠페인 기간·승인 조건 검사에만 쓰이므로, 원하는 시각에 사람이 실행을 눌러야 한다.

캡션은 저장된 최종 캡션 그대로 보낸다 — AI 생성물 표시 줄·가상인물 표시 줄(결정 17, C2)·게시 코드 줄이 포함된 `composeCaption` 결과다. 이미지는 승인 때 만든 공개 사본(`/media/<sha256>.png` 또는 외부 호스트)이며, AI 출처 소재의 기계판독 표시(iTXt)는 소재 저장 때 해시 계산 전에 이미 들어가 있으므로 전송되는 바이트가 표시된 바이트다.

## 4. 댓글 수집(학습 실험실)

`POST /api/execution {"action":"collect_comments","campaignId":…,"id":<발행>,"version":…}`(관리자). 직접 게시로 `published`된 발행만 대상이며 `GET /{media-id}/comments`(Threads `replies`)를 읽어 `publication_comment`(id `<발행>:<댓글>`, 추가만)에 넣는다. **자동 답글·좋아요·삭제는 없다.** 성과 수집은 기존 Instagram 인사이트 커넥터를 그대로 쓴다(`collect`).

## 5. 자동으로 하지 않는 일

- 승인·실행 버튼 없이 게시하지 않는다. 워커·예약 실행·일일 루프는 이 경로를 부르지 않는다.
- 결과를 모르는 게시(unknown)를 다시 보내지 않는다. 사람이 `접수 확인`에서 닫는다.
- 토큰을 자동 갱신하지 않는다. 만료 7일 전부터 상태에 경고가 붙고, 소유자가 새 장수명 토큰으로 다시 연결한다(`connect_publisher`를 다시 호출하면 version이 올라가고 기존 승인은 '발행 계정' 드리프트로 재확인 대상이 된다).
- 댓글에 답하지 않는다. 캐러셀 자식 컨테이너·릴스 영상 업로드는 공급자 코드에 있지만 실행 경로는 단일 이미지만 보낸다.
- `refresh`·`resolve_uncertain`·`disconnect_buffer`는 Buffer 전용이다. 직접 게시 발행의 미확인 건은 `providerStatus`의 컨테이너 id와 계정의 게시물로 대조한 뒤 `resolve_uncertain`의 `notFound`(실패로 닫기)만 쓴다. 게시 ID로 확정하는 길은 후속 PR.

## 6. 가정(공식 문서 미확인 항목)

- 2026-11-09 조사 기준. 공식 레퍼런스의 `quota_total` 표기(50)와 가이드의 100건/24시간이 다르다 — 코드는 응답값을 따른다.
- Threads 본문 500자 제한은 3자 요약에서 확인했고 Meta 문서 원문은 직접 확인하지 못했다(코드 상수 `THREADS_TEXT_MAX`).
- `Authorization: Bearer` 헤더 인증은 기존 `lib/connectors/instagram.ts`와 같은 방식이다. Threads API가 쿼리 `access_token`만 받는 것으로 확인되면 `publish-core.ts attempt()` 한 곳만 고친다.
- Instagram Login 호스트의 인사이트·댓글 필드는 Facebook Login 호스트와 같다고 가정했다.
