# 공유 링크 (G4) — 보고서 읽기 전용 링크 · 외부 검토자 승인 링크

마지막 갱신: 2026-11-09 KST. 레인 G. 전체 계획 `docs/GLOBAL-PLAN.ko.md` 에픽 G4. 고객 보고서 설계의 결정 D1("공유 링크는 만들지 않는다")을 기능 스위치 `share_links` 뒤에서 대체한다. 스위치가 꺼진 기본 상태는 D1과 같다.

## 1. 무엇을 공유하는가

| 링크 종류 | 대상 | 보이는 것 | 할 수 있는 일 |
|---|---|---|---|
| 보고서 링크 (`customer_report`) | 동결한 주간 고객 보고서의 **한 판**(`store|brand:<id>:<YYYY-Www>` + version) | 이름(지점·브랜드 이름), 보고 주·기간, 장부 집계(지표 사전 키), POS 대조(최근 4주), north-star, 채널 단위경제, 광고비 경고 문구, 예약 발행 건수, 할 일 **건수**, 안내문 | 읽기만 |
| 검토자 링크 (`artifact`) | 작업물의 **한 판**(artifact id + version) | 제목, 담당 역할 이름, 판 번호, 작성 출처 라벨(직접 작성·AI 작성·AI 작성 후 사람 수정), AI 표시 안내, 본문(내부 식별자는 `scrubInternalIds`로 가림) | 승인 / 수정 요청(메시지 필수) |

공개 화면에 **없는 것**: 지점·브랜드·캠페인·작업물의 내부 id, 워크스페이스 소유자, 주소, 사업장 전화, 자료 요청 라벨, 가림 기록의 필드 경로, 만든 사람의 id·이메일, 세션 쿠키 값. 공개 보기는 `lib/share-links.ts` `publicReportView`·`publicArtifactView`가 허용 목록으로 새 객체를 조립한다(원문 payload를 넘기지 않는다).

## 2. 주소와 API

- 공개 화면: `GET /share/<token>` (HTML). 폼 `POST /share/<token>`은 검토자 결정이다.
- 공개 JSON: `GET /api/share/<token>`, `POST /api/share/<token>` `{decision:'approved'|'revision',note?}`.
- 소유자 쪽(세션, 대표·관리자): `GET /api/share?kind=customer_report|artifact&id=`, `POST /api/share` `{action:'create',scope:{kind,id},label,days?}` · `{action:'revoke',id}`.
- 토큰: 암호학적 난수 32바이트(16진 64자). 응답에 **만들 때 한 번만** 온다. 저장은 SHA-256 해시만 하고(`records` kind `share_link`, 행 id `share_link:<해시>`), 어떤 로그에도 토큰을 쓰지 않는다.
- 화면: 점포 마케팅 → 지점 → 고객 보고서 탭 → 동결본 카드마다 '공유 링크'(`components/app/share-links-card.tsx`). 작업물 검토자 링크는 작업물 대화상자(`app/panels.tsx` → `app/artifact-reviewer-links.tsx`, 대표·관리자, 스위치가 꺼져 있고 링크가 없으면 숨김)에서 만들고 취소한다(레인 X-G). 같은 판 사용 중 수(최대 10개)를 보이고, 취소는 확인 대화상자(무엇·어디·되돌림)를 거친다.

## 3. 한도와 기본값

| 항목 | 값 |
|---|---|
| 만료 | 기본 14일, 1~90일 |
| 라벨(받는 사람) | 1~60자, 필수 |
| 검토자 링크 수 | 같은 작업물 **같은 판**에 살아 있는(취소·만료 아닌) 링크 10개 |
| 수정 요청 메시지 | 필수, 2,000자 이하. 저장은 길이만(`noteLength`), 본문은 캠페인 이벤트 문구에만 남는다 |
| 공개 요청 빈도 | 토큰당 60회/15분, 주소(`cf-connecting-ip`)당 240회/15분(`auth_rate_limits`, 기존 정리 주기와 같다) |
| 소유자 쓰기 빈도 | `execution_rate` `share_links` 60회/분, 소유자 변경 잠금 |
| 결정 멱등 | 같은 (링크, 결정)은 한 번만 기록. 다시 보내면 `repeated:true` |

## 4. 취소·만료·무효화

- 취소: 소유자 쪽 '○○ 링크 취소' 또는 `revoke`. 즉시 `revokedAt`이 적히고 다음 요청부터 404다. 스위치가 꺼져 있어도 취소·목록은 된다.
- 만료: `expiresAt`이 지나면 404. 행은 남아 조회 수·결정 시각을 볼 수 있다.
- 판 고정: 보고서 링크는 만든 때의 동결 판을 가리킨다. 다시 동결해도 그 판(이전 판 5개 안)을 계속 보이고, 판이 이력에서 밀려나면 404다. 작업물 링크는 작업물이 새 판이 되거나 `outdated`가 되면 404다(GET·POST 모두).
- 스위치 `share_links`를 끄면 모든 공개 주소가 404다. 만들기는 409.
- 캠페인 삭제: 작업물 링크는 `data.campaignId`로 캠페인과 함께 지운다. 보고서 링크는 캠페인과 무관하다.

## 5. 위협 모델과 대응

| 위협 | 대응 |
|---|---|
| 토큰 추측 | 256비트 난수. 모르는·만료·취소·꺼짐·판 바뀜은 모두 같은 404(구분 없음). 주소당 240회/15분 뒤 429 |
| DB 유출 | 해시만 저장. 해시로 주소를 만들 수 없다 |
| 로그 유출 | 토큰은 console·이벤트·판정 로그에 쓰지 않는다(`tests/share-links.test.mjs`가 소스를 검사) |
| 해시 비교 시간 차 | PK 조회 뒤 `sameHash`(같은 길이 XOR 누적)로 다시 비교 |
| XSS | 서버가 HTML을 문자열로 만들고 모든 글자를 `escapeHtml`로 지운다. CSP `default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'`, 인라인 스크립트 0, 스타일은 `/share.css` 하나 |
| 클릭재킹·캐시·검색 노출 | `X-Frame-Options: DENY`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `<meta name=robots>`, `Referrer-Policy: no-referrer` |
| CSRF로 결정 위조 | 공개 POST는 같은 출처만(Origin이 있으면 요청 출처와 같아야 하고, 없으면 `Sec-Fetch-Site`가 cross-site가 아니어야 한다). 폼의 숨은 token은 경로와 같아야 한다 |
| 권한 상승 | 외부 결정은 `review_decision`(행위자 `external:<라벨>`, 역할 `external`)과 캠페인 이벤트만 남긴다. 작업물·캠페인 상태는 바꾸지 않는다. 최종 승인은 대표·관리자가 앱에서 한다 |
| 세션 혼입 | 공개 경로는 세션 쿠키를 읽지 않고(`actor()` 미호출) 쿠키를 쓰지 않는다 |
| 다른 워크스페이스 | 만들기·취소는 소유자 범위 조회만 쓴다. 다른 워크스페이스의 보고서·작업물·링크는 404 |

## 6. 대표가 보는 것

- 링크 목록: 라벨, 상태(사용 중·만료·취소함), 만료 시각, 조회 수, 마지막 조회, 외부 승인·수정 요청 시각.
- 캠페인 이력: '외부 검토자 ○○가 10월 2일 오후 3:10에 「제목」 v2를 승인했습니다.' / '…v2의 수정을 요청했습니다.'(메시지는 덧붙임). `lib/history-labels.ts` `eventLine`.
- 판정 로그(`review_decision`): `actor.id` `external:<라벨>`, `reasonCodes []`, `noteLength`. 1차 승인율 등 기존 집계는 역할과 무관하게 작업물 첫 판정을 보므로 외부 결정도 들어간다(필요하면 역할 `external`로 걸러낸다).

## 7. 검증

- `tests/share-links.test.mjs` 67건 — passed · mocked(메모리 SQLite, 로컬 인증 헤더, fetch 스텁). 만들기 → 공개 GET(JSON·HTML) → 취소 → 404, 만료 404, 꺼짐 404/409, 다른 워크스페이스 404, 검토자 승인·수정 요청(메시지 필수·멱등·외부 행위자·이벤트 문장), 새 판 무효화, 10개 상한, 토큰·주소 빈도 제한 429, 토큰 미저장·미기록, 공개 응답에 내부 id·주소·전화 없음, 이스케이프·CSP·noindex.
- `e2e/share-links.spec.ts` — 실제 Chromium·로컬 D1, 인증 헤더 mocked. 대표가 동결본에서 링크 만들기 → 헤더 없는 새 문맥에서 공개 화면 읽기(`/api/workspace` 401) → 취소 → 404. 검토자 링크에서 메시지 없는 수정 요청 거부 → 메시지 전달 → 대표 캠페인 이력 이벤트.

## 8. 남은 일

- 보고서 외 '보고서형' 기록(가맹 모집 성과 확정 판 등)으로 범위 확장. `ShareScope`에 kind를 더하고 `scopeOf`·`targetView`에 분기를 추가한다.
- 운영 스위치 켜기 전: 외부 고객 게이트(설계 원칙 13)와 `docs/DATA-PROCESSING.ko.md`의 외부 고객 데이터 검토를 거친다.
