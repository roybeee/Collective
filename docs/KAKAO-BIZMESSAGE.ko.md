# 카카오 비즈메시지 어댑터 (C6)

알림톡(정보성)·브랜드 메시지(광고성)를 **공식 딜러사 API**로 보내는 어댑터, 광고성 전송 **컴플라이언스 엔진**, **수신동의 원장**, 카카오톡 채널 **친구 관계 동기화**. 기능 스위치 `kakao_bizmessage`는 기본 꺼짐이며, 켜도 사람이 승인한 메시지만 간다. 이 문서는 법률 자문이 아니다.

- 계획 출처: [GLOBAL-PLAN C6](GLOBAL-PLAN.ko.md)
- 코드: `lib/kakao/types.ts`(딜러 무관 계약) · `lib/kakao/dealer-generic.ts`(참고 구현) · `lib/kakao/dealer-mock.ts`(테스트) · `lib/kakao/compliance.ts`(규칙 엔진, 순수) · `lib/kakao/consent.ts`·`consent-server.ts`(수신동의 원장) · `lib/kakao/channel-sync.ts`(친구 관계) · `lib/kakao/send-server.ts`(전송 파이프라인) · `lib/kakao/credential-server.ts`(딜러 자격증명) · `app/api/kakao/route.ts`(API) · `lib/kakao/registry-descriptor.ts`(커넥터 서술자)
- 검증: `tests/kakao-compliance.test.mjs`(순수·계약 하네스), `tests/kakao-send.test.mjs`(서버·API, mocked)
- 화면: 이 판에는 없다. API만 있다.

## 1. 사실 전제 (2026-11-09 조사, 딜러 계약 전 가정)

| 항목 | 내용 | 코드 반영 |
|---|---|---|
| 전송 경로 | 카카오 비즈메시지는 카카오 공개 API로 보낼 수 없다. 공식 딜러사(NHN Cloud, Kakao i Connect Message, SOLAPI형 집계사 등) API에 **발신프로필(sender key)** + **비즈니스 인증 채널**이 있어야 한다 | `BizMessageProvider` 계약을 딜러 무관으로 두고 딜러별 매핑만 바꾼다 |
| 알림톡 | 정보성 전용. 사전 **검수(심사)된 템플릿**만 보낼 수 있다 | `type:'alimtalk'`은 `templateCode`+`variables`를 보내고, 본문이 광고성이면 `kakao.alimtalk.informational_only`로 막는다 |
| 브랜드 메시지 | 광고성. **마케팅 수신동의** 대상에게만. 친구톡은 2025-12-31 종료(호환 발송 2026-12-31까지) | `type:'brand'`, `adFlag:true` 상수. 친구톡 유형은 두지 않는다 |
| 전송 시간 | 딜러가 **20:50~08:00** 광고성 전송을 막는다(법은 21~08시 별도 동의) | `kakao.night_window`: KST 20:50~08:00은 야간 동의(`nightConsent`)가 있는 수신자에게만 |
| 정보통신망법 §50 | 명시적 사전 동의, 전송자 명칭·수신거부 방법 표기, "(광고)" 머리말, 080 무료 수신거부, **2년마다 수신동의 재확인**(시행령 §62조의3) | `kakao.consent.required`·`brand.ad_label`·`brand.sender_name`·`brand.optout_080`·`consent.expired`(24개월)·`consent.renewal_due`(23개월 경고) |
| 카카오톡 채널 API | 친구 관계(ADDED/BLOCKED/NONE) 조회·고객 파일 업로드만 가능, **메시지 전송 불가** | `lib/kakao/channel-sync.ts`(Admin 키, 조회만) |

출처(확인 필요 시): kakaobusiness.gitbook.io/main/ad/infotalk, business.kakao.com/info/brandmessage, 국가법령정보센터 정보통신망법 §50·시행령 §61·§62조의3. 조문 번호가 바뀌면 `lib/kakao/compliance.ts KAKAO_RULES`의 `basis`와 이 표를 함께 고친다.

## 2. 딜러 온보딩 (대표가 직접)

1. **카카오톡 채널 비즈니스 인증**: 사업자 정보로 채널을 인증한다(카카오 비즈니스 센터).
2. **딜러사 계약**: 딜러사 1곳과 계약하고 **발신프로필 키(senderKey)** 를 발급받는다. 발신프로필은 인증 채널에 묶인다.
3. **알림톡 템플릿 검수**: 딜러 콘솔에서 템플릿을 등록하고 카카오 검수를 받는다(정보성만 통과한다. 변수는 `#{이름}` 형식, 광고 문구·할인 등은 반려). 승인된 **템플릿 코드**를 초안의 `templateCode`로 쓴다.
4. **080 무료 수신거부 번호**: 080 서비스를 가입해 번호를 받는다. 브랜드 메시지 마지막 줄에 `무료 수신거부 080-XXX-XXXX`로 들어간다.
5. **COLLECTIVE 연결**: `POST /api/kakao {action:'connect', dealer:'generic', baseUrl, apiKey, senderKey, senderName, optoutNumber, adminKey?}` (소유자만). 저장 전에 딜러 `verify()`(발신프로필 조회)를 통과해야 하고, 실패하면 저장하지 않는다. 자격증명은 `channel_credential` kind에 암호화 저장되며 응답·로그에 비밀값이 없다.
6. **딜러별 매핑**: 참고 구현 `lib/kakao/dealer-generic.ts`는 "일반 REST 모양"(`POST {baseUrl}/v1/brand/messages`, `X-Api-Key`, `Idempotency-Key`)을 가정한다(`GENERIC_SHAPE.note = 'dealer-specific mapping needed'`). 계약한 딜러에 맞춰 경로·필드·상태 문자열(`resultStatus`)만 바꾸고 `parseDealerInput`의 `dealer` 값을 추가한다. 계약(`BizMessageProvider`)·규율은 바꾸지 않는다.
7. (선택) **친구 관계 동기화**: 카카오 개발자 앱의 Admin 키를 `adminKey`로 함께 등록하면 `friend_sync`로 수신자별 ADDED/BLOCKED/NONE을 기록한다. 카카오 사용자 id는 저장하지 않는다.

딜러 계약·키 신청은 대표가 해야 하며, 그 전에는 mocked 계약 테스트(`tests/kakao-compliance.test.mjs` 5 시나리오)까지만 진행한다(GLOBAL-PLAN 실행 규칙).

## 3. 계약 (`lib/kakao/types.ts`)

```
BizMessageProvider {
 sendAlimtalk({senderKey, templateCode, to, variables, idempotencyKey}) → SendResult
 sendBrandMessage({senderKey, to, text, buttons?, adFlag:true, idempotencyKey}) → SendResult
 getResult(messageId) → {status: delivered|failed|pending|unknown, costKrw}
 verify() → {ok, account}
}
SendResult.outcome = success | failed | unknown
```

- `unknown`: 보낸 뒤 타임아웃·5xx·연결 끊김(상대에 도달했을 수 있음). **절대 자동 재전송하지 않는다**(`lib/connectors/rate-queue.ts` 규율, 서술자 `retryUnknown:false`). 사람이 딜러 콘솔에서 멱등 키로 대조한다.
- 429는 `Retry-After`·지터 백오프로 최대 3회 재시도한다. 4xx는 `failed`(새 초안 필요).
- 커넥터 서술자 `kakao_bizmessage`(`lib/kakao/registry-descriptor.ts`): `alimtalk.send`·`brand.send`는 **T4**(고객에게 보이는 유료 전송), `result.read`·`friend.read`는 T1. 모두 `defaultOff`, 스위치 `kakao_bizmessage`.

## 4. 컴플라이언스 엔진 (`lib/kakao/compliance.ts`, 순수)

`checkKakaoCompliance({type, text, senderName, now, consent, optedOut, adSentToday, dailyCap?}) → {ok, classification, reasons[], warnings[], kst}`

| 규칙 id | 적용 | 판정 | 근거 |
|---|---|---|---|
| `kakao.alimtalk.informational_only` | 알림톡 | 본문에 (광고) 표기·판촉 어휘(`AD_KEYWORDS`)가 있으면 차단 | 카카오 알림톡 심사 가이드 |
| `kakao.brand.ad_label` | 브랜드 | 첫 줄이 `(광고)`로 시작해야 한다. `[광고]`·`(광/고)`·`(AD)` 변형 불가 | 정보통신망법 §50④, 시행령 §61 |
| `kakao.brand.sender_name` | 브랜드 | 전송자 명칭(발신프로필 이름)이 본문에 있어야 한다 | §50④ |
| `kakao.brand.optout_080` | 브랜드 | `수신거부` 문구와 `080-XXX-XXXX`가 같은 줄에 있어야 한다 | §50④, 시행령 §61 |
| `kakao.night_window` | 광고성 | KST **20:50~08:00**은 `nightConsent:true` 수신자만 | §50③(21~08시 별도 동의), 딜러 정책 20:50 |
| `kakao.consent.required` / `.revoked` / `.expired` | 광고성 | 동의 기록 없음·철회·**24개월 경과("재동의 필요")** 차단 | §50①·②·⑧, 시행령 §62조의3 |
| `kakao.consent.renewal_due` | 광고성 | 23개월 경과는 경고(전송은 됨) | 운영 기준 |
| `kakao.optout` | 광고성 | 수신거부 목록에 있으면 차단 | §50② |
| `kakao.daily_cap` | 광고성 | 수신자별 하루(KST) 광고성 기본 1건 | COLLECTIVE 운영 기준(법령 아님) |

분류(`classifyMessage`)는 `(광고)` 표기 또는 판촉 어휘로 광고성을 가른다. `'무료 수신거부'` 줄은 판촉이 아니다. 브랜드 메시지는 유형 자체가 광고성이라 분류와 무관하게 광고성 규칙을 모두 적용한다. 정보성 알림톡은 동의·시간대·상한을 보지 않는다(정보성 전송은 §50 적용 대상이 아니다). 사유 문구는 한국어이며 `[규칙 id]`를 붙인다. 어휘 중 `(광고)` 해소 정규식은 `lib/graders/compliance-lexicon.ts` ad_message 규칙을 그대로 쓴다.

## 5. 수신동의 원장 (`lib/kakao/consent.ts`, `consent-server.ts`)

- **번호는 저장하지 않는다.** 정규화(01X + 7~8자리, +82 → 0) 뒤 `SHA-256("collective:kakao-recipient:v1\n{owner}\n{번호}")` 소문자 hex 64자를 수신자 키로 쓴다. 오류 문구·로그·응답에도 번호가 없다(테스트가 DB 전체를 검색한다). 가맹 리드 연락처(`lib/franchise-crypto.ts`)는 되돌려 읽어야 해서 AES·HMAC을 쓰지만, 여기는 되돌릴 일이 없다. 딜러에 보낼 번호는 **전송 요청 때 사람이 넣고** 해시 대조 뒤 딜러에게만 넘어간다.
- kind(모두 `parent_id = brandId`, 캠페인 무관): `marketing_consent`(해시당 1행: `consentedAt`·`source`·`nightConsent`·`revokedAt`) · `marketing_optout`(수신거부) · `kakao_friend_relation`(ADDED/BLOCKED/NONE) · `kakao_reconsent_notice`(재동의 안내) · `bizmessage_send`(전송 기록).
- **CSV 가져오기**(`consent_import`): 머리글 `phone,consentedAt[,source,nightConsent]`, 5,000행 이내, 날짜는 ISO 또는 `YYYY-MM-DD`(KST 00:00), 미래 불가. **오류가 하나라도 있으면 저장하지 않고** 줄 번호만 돌려준다. 같은 수신자의 더 늦은 동의는 갱신(철회 해제), 더 이른 동의는 무시.
- **수신거부**(`optout`): 수신거부 레코드와 동의의 `revokedAt`을 같은 묶음으로 쓴다.
- **재동의 안내**(`reconsent`): 23개월 경과(활성)·24개월 만료 수신자를 모아 브랜드·KST 날짜당 1건의 `kakao_reconsent_notice`를 만든다. 모양은 `growth_detected_signal`과 같다(`status:'new'`, `detection:{title, detail, dueBy, recipientHashes}`). 오늘의 안건(`lib/agenda-server.ts`)은 캠페인에 묶인 kind만 읽으므로, 이 안내를 안건에 올리려면 agenda 쪽에 kind 한 줄을 더하는 별도 PR이 필요하다(이 판은 레코드·API까지).

## 6. 전송 파이프라인 (`lib/kakao/send-server.ts`)

```
draft ──판정 저장──▶ approve(사람, assertAutonomy('customer_send')) ──▶ send(스위치·승인·번호 해시 대조·판정 재확인·'sending' 영속·딜러 호출) ──▶ sent | failed | unknown ──▶ result(폴링)
```

- `draft`: 판정이 막혀도 초안은 남긴다(사유 포함). 스위치 무관.
- `approve`: 소유자·관리자만. `customer_send`는 T3 고위험이라 자율성 규칙에서 **auto가 될 수 없고**(`lib/autonomy.ts`), `never`면 403. 승인 시점에 판정을 다시 해 막히면 409. 승인자·시각·모드를 기록한다.
- `send`: 스위치 꺼짐 **409**. 승인되지 않은 초안 409. 입력한 번호의 해시가 기록과 다르면 400. 전송 직전 판정 재확인(시간대·상한이 바뀔 수 있다). 보내기 전에 `status:'sending'`과 KST 날짜를 영속하고(저널), 결과를 `sent`·`failed`·`unknown`으로 저장한다. 멱등 키는 `kakao:{owner}:{id}`로 딜러 헤더에 실린다.
- **같은 기록을 다시 보내면** 저장된 레코드를 그대로 돌려준다(`executed:false`). `unknown`·`sending`·`sent`는 다시 보내지 않고, `failed`는 409(새 초안).
- `result`: `sent`·`unknown` 기록의 딜러 메시지 id로 결과를 읽는다. 메시지 id가 없는 `unknown`은 409(딜러 콘솔에서 대조).
- 하루 상한은 `bizmessage_send`에서 같은 수신자·광고성·`sending|sent|unknown`·오늘(KST) 건수를 센다.

## 7. API (`app/api/kakao/route.ts`, 소유자·관리자)

| 호출 | 하는 일 |
|---|---|
| `GET /api/kakao[?brandId=]` | 스위치·딜러 연결 상태(비밀값 없음)·규칙 근거. 브랜드를 주면 수신동의 요약(상태별 수·수신거부 수·재동의 대상)·재동의 안내·최근 전송 200건 |
| `POST {action:'connect', …}` / `'disconnect'` | 소유자만. 딜러 검증 뒤 암호화 저장 / 해제 |
| `'verify'` | 발신프로필 재확인 |
| `'check', brandId, type, text, phone|recipientHash[, templateCode, senderName]` | 판정 미리보기(저장 없음) |
| `'draft'` … `'approve', id[, version]` … `'send', id, phone` … `'result', id` | 6절 파이프라인 |
| `'consent_import', brandId, csv` / `'optout', brandId, phone|recipientHash[, source]` / `'reconsent', brandId` | 5절 원장 |
| `'friend_sync', brandId, channelPublicId, recipients:[{recipientHash, appUserId}]` | Admin 키로 친구 관계 조회·기록(500명 이내) |

공통: 직원 403, 비로그인 401, 다른 출처 403, 소유자 잠금·분당 60회 빈도 제한(`execution_rate` 범위 `kakao_bizmessage`). 응답 어디에도 전화번호·API 키·Admin 키가 없다.

## 8. 법적 체크리스트 (대표용, 법률 자문 아님)

- [ ] 광고성 메시지 수신자 전원의 **명시적 사전 동의** 기록(일시·출처)이 원장에 있다 — 정보통신망법 §50①
- [ ] 첫 줄 `(광고)`, 전송자 명칭, `무료 수신거부 080-…` 표기 — §50④, 시행령 §61
- [ ] 21~08시(딜러는 20:50~08:00) 전송은 **야간 별도 동의** 수신자만 — §50③
- [ ] 수신거부·동의 철회 즉시 전송 중단, 처리 결과 통지 — §50②·⑦
- [ ] **2년마다** 수신동의 여부 확인(재동의 안내) — §50⑧, 시행령 §62조의3
- [ ] 알림톡은 정보성 템플릿만, 검수 승인 코드로만 전송 — 카카오 알림톡 심사 가이드
- [ ] 수신자 번호는 해시로만 보관, 전송 요청 때만 입력 — 개인정보 최소수집(AGENTS.md 도메인 원칙)
- [ ] 결과 `unknown` 건은 딜러 콘솔에서 멱등 키로 대조해 닫는다(자동 재전송 없음)

## 9. 절대 자동으로 하지 않는 것

- 메시지 **전송**: 사람이 `approve`를 누른 기록만, `send`도 사람이 번호를 넣어 호출한다. 워커·예약 실행에서 부르지 않는다.
- `unknown` 재전송, `failed` 재전송.
- 수신동의 생성·연장(가져오기는 사람이 CSV로, 재동의는 사람이 받아 다시 가져온다).
- 딜러 자격증명 연결(소유자만, 검증 통과 때만).
- 스위치 `kakao_bizmessage` 켜기(소유자).

## 10. 검증 (2026-11-09, 기준 `integrate/wave1` 6af820d)

- `node node_modules/typescript/bin/tsc --noEmit` — passed
- `node --experimental-vm-modules tests/kakao-compliance.test.mjs` — passed · 순수(59): 분류·형식·야간·동의·수신거부·상한·CSV 해시·재동의·서술자·계약 하네스 5 시나리오·참고 딜러 분류
- `node --experimental-vm-modules tests/kakao-send.test.mjs` — passed · mocked(63): 권한·딜러 연결·CSV 가져오기(번호 미저장)·초안→승인→전송·스위치 꺼짐 409·unknown 비재전송·멱등 재전송·결과 폴링·하루 상한·수신거부·친구 동기화·재동의 안내
- 실제 딜러·카카오 API 호출: not_run(딜러 계약 전, 대표 직접)
