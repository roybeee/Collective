# 플레이스 리뷰 답글·소식 초안 (C5)

네이버 스마트플레이스 리뷰 답글과 소식을 초안 → 승인 → 제출 → 확인 순서로 다룬다. **네이버 스마트플레이스에는 공개 쓰기 API가 없다.** COLLECTIVE는 자동 제출하지 않으며, 사람이 승인한 문안만 (a) 복사·제출 지원 또는 (b) 다시 승인한 점포 브라우저 작업으로 넘긴다. 기능 스위치 `place_drafts`(기본 꺼짐).

## 1. 흐름

1. 대표·관리자가 지점을 골라 초안을 만든다.
   - 리뷰 답글(`review_reply`): 리뷰 원문을 붙여 넣는다(별점·리뷰 메모 선택). 저장 전에 개인정보 패턴(전화·이메일·주소 등)을 가리고 가린 종류·건수만 남긴다. 리뷰어 이름은 받지 않고 답글에 리뷰 원문을 다시 쓰지 않는다.
   - 소식(`news_post`): 종류(`notice`·`promotion`·`menu`), 제목, 조건·본문, 기간.
2. 초안은 결정론 템플릿이다(모델 호출 없음, HERMES 다듬기 없음). 템플릿에 넣는 사실은 지점·브랜드 확정 사실(`lib/brand-facts.ts`, 유효기간·출처 통과)뿐이다. 부정 리뷰에는 확정된 전화번호가 있을 때만 연락 안내를 붙이고, 소식에는 확정된 영업시간·주소만 덧붙인다. 확정 말투의 어조에 '친근·편안' 등이 있으면 ~요체, 아니면 ~습니다체를 쓴다.
3. 규정 점검(`checkPlaceDraft`): 공통 표시·광고 사전(`lib/graders/compliance.ts`, 확정·거절 사실 원장) + 플레이스 규칙.
   - 프로모션 소식은 첫 줄에 `[광고]`(또는 `(광고)`) 표기가 있어야 한다 — 없으면 막음.
   - 운영자 자유 문구(제목·조건·본문, 답글은 문안 전체)의 금액·할인율·혜택·최상급·보장 표현이 확정 사실 값에 없으면 막음(가짜 주장 금지). 만료된 사실은 근거가 되지 않는다.
   - 길이(답글 1,000자·소식 2,000자, 입력칸 실제 상한은 미관찰 가정), 빈 문안은 막음. 확정 말투의 피할 표현은 경고.
4. 승인(`approve`): 대표·관리자, 자율성 규칙 `publish_submit`(T3, never → 403). 승인 순간의 확정 사실로 다시 점검하고 막는 항목이 있으면 409. 승인 문안의 SHA-256을 고정한다. 승인 뒤 문안이 바뀌면 제출·장치 작업은 409다(다시 만들어 승인).
5. 제출
   - (a) **복사·제출 지원**: 승인 문안 + 공식 관리 진입 주소(`https://new.smartplace.naver.com/`) + 메뉴 경로(리뷰 → 답글 쓰기 / 소식 → 새 소식 쓰기)와, 점포 브라우저 연결이 있으면 관찰한 관리 주소를 돌려준다. 리뷰·소식 화면의 정확한 주소는 관찰하지 못했다. 사람이 등록한 뒤 `mark_submitted`(수동)를 누르고, 게시 화면을 확인하면 `mark_verified`.
   - (b) **점포 브라우저 작업**: `store_browser_execution`이 켜져 있고, 지점 연결(장치·관리 주소)이 있고, 관리자가 그 장치의 로컬 설정에 리뷰 답글·소식 화면 매핑(`registered_dom`)을 관찰해 등록했다고 확인(`declare_mapping`, 연결 판·장치·프로필에 묶임)했을 때만 `store_browser_job`(`reply_review`·`post_news`, 상태 `draft`)을 만든다. 이 작업은 점포 브라우저 화면에서 **다시 승인**(`approve_job`, 24시간 유효 digest)해야 장치가 접수한다. `sync_device`가 작업 상태를 초안에 옮긴다(저장 시작 이후 → 제출 표시(장치), 관리 화면 재조회 확인 → 게시 확인(장치)).
6. 상태: `draft → approved → submitted(manual|device) → verified`, `draft·approved → cancelled`.

## 2. 장치 실행기의 현재 한계

- `lib/store-browser.ts`에 작업 유형 `reply_review`·`post_news`와 승인 문안 필드 `placeDraft`를 덧붙였다. 서버·장치 실행기(`scripts/store-browser-worker.mjs`, `scripts/lib/store-browser-*.mjs`)는 바꾸지 않았다.
- 현재 실행기는 영업시간·사진 외 쓰기 작업을 저장 전에 사람에게 인계한다(`waiting_human`). 따라서 이번 판에서 장치 작업은 **저장하지 않고 인계로 끝난다.** 답글·소식 입력칸 매핑을 실행기에 붙이는 일은 실제 관리 화면 관찰 뒤 별도 작업이다.
- `naver_smartplace`(native) 어댑터는 조회 전용 그대로다.
- 장치로 리뷰 원문을 읽어 오는 경로(`store_browser_read`)는 없다. 원문은 운영자가 붙여 넣는다.
- 점포 브라우저 패널(app/store-browser-panel.tsx)은 새 유형을 '영업시간 변경'으로 표시한다. 화면 문구는 이번 판 범위 밖이다(레인 X-F).

## 3. 저장

- `place_draft`(parent=지점): 원문(가림 처리)·소식 입력·초안(템플릿 id·분위기·문체·사용 사실 {id, version}·말투 판)·규정 점검·승인(시각·승인자·문안 해시)·제출·확인·장치 작업 id·이력(최근 30).
- `place_draft_mapping`(id=지점, parent=지점): 매핑 확인(연결 판·장치·프로필·작업 유형·확인자·메모). 선택자는 장치 로컬 설정에만 있다.
- 둘 다 캠페인과 무관(`not_campaign_scoped`).

## 4. API — `/api/place-drafts`

대표·관리자만(직원 403, 비로그인 401, 다른 출처 403). 쓰기는 소유자 변경 잠금 안에서 한다. 스위치가 꺼지면 쓰기는 409이고 조회·취소·매핑 해제·`sync_device`는 계속된다.

| 메서드 | 작업 | 입력 |
| --- | --- | --- |
| GET | 목록 | `?storeId` → `{enabled, storeBrowserEnabled, drafts, mapping, notice}` |
| POST | `create` | `kind`, `storeId`, 답글: `sourceText`, `rating?`, `reviewRef?` / 소식: `news{topic,title,condition?,body?,period?}` |
| POST | `edit` | `id`, `expectedVersion`, `text`(초안 상태만, 점검 다시 실행) |
| POST | `approve` | `id` → `{draft, submitHelp, autonomy}` |
| POST | `submit_help` | `id` → 승인 문안·관리 주소·메뉴 경로 |
| POST | `mark_submitted` | `id`, `note?` (수동 제출 표시) |
| POST | `mark_verified` | `id`, `note?` |
| POST | `cancel` | `id`, `note?` |
| POST | `declare_mapping` | `storeId`, `taskTypes`(`reply_review`·`post_news`), `note?` |
| POST | `revoke_mapping` | `storeId` |
| POST | `create_device_task` | `id` |
| POST | `sync_device` | `id` |

화면 카드는 이번 판에 없다(레인 X-F가 설정·점포 카드를 만든다). 카드는 '쓰기 API 없음·자동 제출 없음'을 함께 보여야 한다.
