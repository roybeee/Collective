# 자율성 규칙·예약 실행·일일 요약 (에픽 G3)

새 스위치 세 개(`autonomy_rules`·`scheduled_runs`·`digest_mail`)는 모두 기본 꺼짐이다. 꺼진 상태에서는 기존 동작이 바뀌지 않는다: 규칙·예약은 조회·편집만 되고, 모든 행동은 사람이 누른다.

## 1. 자율성 규칙 (`lib/autonomy.ts`, `lib/autonomy-server.ts`, `GET/PUT /api/autonomy`)

행동 10개에 각각 `auto`(사람 확인 없이 진행) · `ask`(사람이 누른다, 기본) · `never`(차단)를 정한다. 등급 어휘는 `lib/growth-authority.ts`의 `AuthorityTier`(T0~T4)를 그대로 쓴다.

| 행동 | 등급 | 허용 모드 | 적용 지점 |
|---|---|---|---|
| `research_run` 브랜드 조사 | T0 | auto·ask·never | (이번 PR 미적용) |
| `data_collect` 자료 수집 | T0 | auto·ask·never | (이번 PR 미적용) |
| `role_run` 역할 실행(단독·연속) | T1 | auto·ask·never | `POST /api/run` `start`·`start_sequence` |
| `meeting_start` 팀 회의 시작 | T1 | auto·ask·never | `POST /api/meetings` `start`, 예약 실행의 회의 안건 초안 |
| `brief_draft` 브리프 초안 | T1 | auto·ask·never | (이번 PR 미적용) |
| `publish_submit` 발행 접수 | T3 | ask·never | `POST /api/execution` `approve`·`execute` |
| `ad_activate` 광고 활성화 | T3 | ask·never | `POST /api/meta-ads/execution` `activate` |
| `budget_change` 예산 변경 | T3 | ask·never | (이번 PR 미적용) |
| `customer_send` 고객 발송 | T3 | ask·never | (이번 PR 미적용) |
| `policy_change` 정책·규칙 변경 | T4 | ask·never | (이번 PR 미적용) |

- 고위험(T3·T4) 행동에 `auto`를 저장하려 하면 400과 한국어 사유다. 저장된 값이 손상돼 고위험 `auto`가 읽히면 `ask`로 평가한다.
- 적용 규칙: `never` → 403(사유 그대로). `ask` → 기존 동작. `auto`(저등급만) → 기존 동작 그대로 두고 성공 JSON 응답에 `autonomy:'auto'`만 덧붙인다(`markAutonomy`). 화면은 표시만 한다.
- 스위치 `autonomy_rules`가 꺼져 있으면 `evaluateAutonomy`는 무엇이든 `ask`를 돌려준다. 읽기·쓰기 API는 스위치와 무관하다.
- 저장: records kind `autonomy_settings`(id `current`, 소유자당 1행, version·updatedBy). 읽기는 로그인한 모든 역할(변경자는 소유자·관리자만), 쓰기는 소유자·관리자(직원 403, 비로그인 401, 다른 출처 403). `expectedVersion`이 다르면 409.
- 가드는 각 라우트에서 캠페인 읽기·잠금 전에 한 줄로 들어간다. 라우트 구조는 바꾸지 않았다.

## 2. 예약 실행 (`lib/scheduled-runs.ts`, `lib/scheduled-runs-server.ts`, `GET/POST /api/scheduled-runs`)

- 예약(records kind `scheduled_run`, parent=캠페인): `kind` `weekly_performance_summary`|`daily_signal_review`, `action` `create_meeting_draft`|`create_agenda_item`, `brandId`·`campaignId`, `spec {weekdays:0~6[], hour:0~23}`(KST), `title`(선택), `enabled`.
- 실행: 워커 tick의 `scheduled_runs` 큐. 스위치 `scheduled_runs`가 켜진 소유자에게만 `scheduledRunsQueue`가 콜백을 넘기므로 꺼진 소유자의 순환에는 큐 이름이 나타나지 않는다. KST 오늘 요일이 맞고 정한 시각이 지난 예약마다 (예약 id, KST 날짜) 실행 기록 1행(`scheduled_run_execution`)을 남긴다. 이미 있으면 읽기만 한다(멱등). tick당 최대 5건.
- `create_meeting_draft`: 캠페인의 `metric` 중 최근 7일(KST) 기록을 규칙으로 합산(매출·광고비·변동비·주문, 없으면 미확인)해 `meeting_agenda_draft` 1행을 쓴다. HERMES 호출 없음. 회의 시작은 사람이 한다. 자율성 규칙 `meeting_start`가 `never`면 `skipped`와 사유를 남기고 초안을 만들지 않는다.
- `create_agenda_item`: `growth_detected_signal`(status `new`, detection.kind `scheduled_review`, detectedBy `scheduled_run`) 1행을 써서 홈 '오늘의 안건'(`lib/agenda-server.ts`)의 새 신호로 보인다. 담당·기한 지정은 기존 감지 화면에서 한다.
- 전역 중단(`lib/growth-stop.ts`) 중이면 실행하지 않고 `skipped` 사유를 기록한다. 캠페인 보관·브랜드 불일치는 저장 때 409/400.
- 하지 않는 것: 게시·지출·발주·고객 발송·프롬프트 승격·외부 호출.
- 파이썬 워커(`server/research-worker/worker.py`)는 큐 이름을 모르고 응답 `status`(`idle`|`processed`|`retry`)만 검사하므로 바뀐 것이 없다.

## 3. 일일 요약 (`lib/digest.ts`, `lib/digest-server.ts`)

- `buildDigest(input)`는 오늘의 결정 대기 수(기한 초과·새 신호·다가오는 기한), 기한이 있는 안건 5건, 예약 실행 결과, AI 사용량 비용(`provider_usage` 당일 합계, 금액 미확인 건수)을 한 화면 한국어 문장으로 만든다.
- `sendDailyDigest(owner)`는 예약 실행 큐가 매 tick 부른다. 스위치 `digest_mail` 꺼짐 → idle. 어댑터 미설정 → idle. 같은 KST 날짜의 `digest_sent`가 있으면 idle. 그 밖에는 어댑터에 넘기고 `digest_sent` 1행(어댑터 이름·가린 대상·제목·본문·결과)을 쓴다.
- 이 PR의 `mail` 어댑터는 스텁이다: 환경변수 `DIGEST_MAIL_TO`가 있으면 설정된 것으로 보고, 네트워크 없이 `recorded`를 돌려준다. 실제 발송은 없다.

### 전송 어댑터 계약 (알림톡 등 후속)

```ts
type DigestTransport={
 name:'mail'|'alimtalk';
 configured:boolean;          // false면 보내지 않고 idle(unconfigured)
 target:string|null;          // 기록에 남길 가린 수신자(원문 전화번호·이메일 금지)
 deliver(digest:{subject:string;text:string;lines:string[]}):Promise<{status:'recorded'|'skipped';reason?:string}>;
};
```

- `deliver`는 외부 결과 불명을 예외로 던지지 않고 `skipped`+사유로 돌려준다. 호출자는 결과를 그대로 `digest_sent`에 기록하며 같은 날 재전송하지 않는다.
- 알림톡 어댑터는 템플릿 승인·수신 동의·발송 시간대 제한을 `configured` 판정에 포함하고, 본문은 `text`를 템플릿 변수로 잘라 넣는다. 토큰·전화번호 원문은 기록·로그에 남기지 않는다.

## 4. 화면 (`app/autonomy-panel.tsx`)

`AutonomyPanel`을 내보낸다. 규칙 카드(행동·등급 표지·3단 선택, 고위험의 '자동'은 비활성과 이유)와 예약 카드(목록·켜기/끄기·삭제·추가 폼·최근 실행)다. `components/app`·`components/ui` 부품만 쓰고 원시 button/input·인라인 스타일·hex 색이 없다. 설정 화면 연결은 레인 소유자가 `app/panels.tsx`에서 한다(이 PR은 연결하지 않음).

## 5. 검증 (2026-11-09)

- `tests/autonomy.test.mjs` 37 passed — mocked(메모리 SQLite, 헤더·세션 인증, fetch 스텁): 10×3 행렬·고위험 auto 거부, 스위치 꺼짐=ask, GET/PUT 권한·검증·출처, 4개 라우트 never→403, auto 표시.
- `tests/scheduled-runs.test.mjs` 41 passed — mocked: 입력 검증·KST 판정·기간별 멱등·전역 중단·회의 금지 건너뜀·안건 초안·신호·워커 순환(스위치 켜진 소유자만)·요약 문장·전송 기록.
- 운영 스위치를 켜고 실제 워커 tick으로 도는지, 실제 메일·알림톡 발송은 이 PR에 없다(not_run).
