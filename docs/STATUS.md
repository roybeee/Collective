# COLLECTIVE 현재 상태

## 운영 API 복구 결과 (2026-09-26 02:22 UTC)

- PR #127 merged, Sites 버전 37 published, `d721017` tree `4f3b130…` runtime-verified. 품질 콘솔의 운영 상태 조회가 실제 API 호출에 성공했다.
- S8 두 run 재채점 passed(완료 출력 각 1건, 실패 0, 추가 모델 토큰 0). `channel.offline@2cbe193eacdc` 등록 성공.
- 쌍 평가 `8fcd3726-b09f-464c-b111-d1d9e20c63fc`는 완료 출력 0/4, 사용 0 토큰으로 끝나 게이트 failed. stage/promote not_run. 실패 사유를 원문 대신 정해진 분류·건수로 운영 화면에 추가한다.
- [게시·실행 근거](releases/2026-09-26-d721017.md). 봉인 요청·출력 원문은 열지 않았다.


## 운영 관리 화면 복구 (2026-09-26)

- A1 PR #120은 `aefd4219aa335425243e41372c8ba8efa3009ee7`로 merged. CI passed, D1 이름 대조 passed. 운영 등록·쌍 평가·stage는 아직 not_run.
- `fix/owner-quality-operations`: 품질 콘솔에 소유자 전용 운영 버전 조회, 재채점, 후보 등록, 쌍 평가, 지정 캠페인 적용 폼을 추가한다. 기존 `/api/eval`, `/api/prompts`, `/api/version`과 권한·CSRF·예산·활성화 게이트를 그대로 쓴다.
- `/api/eval?view=operations`는 동결 요청·출력·기대 판정·케이스별 채점 근거를 제외한 목록·합계만 반환한다. 자동 등록·자동 재시도·자동 전체 승격은 없다.
- 게시 전 상태다. 검증·게시·운영 실행 결과는 PR과 릴리스 기록으로 구분한다.


## Codex A1 작업 재개 (2026-09-26 01:52 UTC)

- 원격 main `b16403df6ded5e67794f3d05e0939c9d22697620`을 PR #120(`feat/a1-local-channel-pack`)에 통합했다. 기존 트랙 R 변경과 게시 보류 이력은 보존한다.
- GitHub 쓰기 403은 허용 저장소 설정 변경 후 복구됐고, PR #120이 생성됐다. 후보 단위는 `channel.offline`이며 코드 폴백은 유지된다.
- 이전 후보 커밋 `2900d3e`: 전체 128/128 스위트·8,986 assertions, typecheck·lint gate·build passed. 통합 후 검증 결과는 PR 본문에 별도로 기록한다.
- 이번 재개에서도 운영 OWNER 로그인을 확인했지만 `/api/version` 직접 탐색은 `net::ERR_BLOCKED_BY_CLIENT`였다. 로그인 성공과 운영 API 실행 성공을 구분한다.
- Sites API 재조회: active, 버전 35. 새 게시·S8 재채점·후보 등록·쌍 평가·활성화는 not_run이다. 봉인 입력·출력은 열지 않았다.
- D1 이름 대조: passed · real. 소유자 화면의 브랜드 4개·지점 1개와 한글·영문 약칭·띄어쓰기 변형을 후보에 대조했다. 이름 원문은 저장하지 않는다. [후보와 수용 기준](LOCAL-CHANNEL-PACK.ko.md).


마지막 갱신: 2026-09-26 01:17 UTC (Claude 트랙 R 세션: R3a 캠페인 가맹 모집 목적 PR(교차 검토 반영), 결정 26·31 대표 결정)

## 현재 운영 상태

| 항목 | 값 | 근거 |
|---|---|---|
| 운영 제품 커밋 | `8c22f0e8738653698dd4350cd2063e3755340c83` (#115 `merged`, 묶음 12: e8bd8e0 뒤 #113~#115, 제품 변경은 #113 채점 도구뿐) | 제품 tree `02260ba4d4bf50dbd617fd4f6dc2709c5e067cf2` |
| `origin/main` | `16981dd` (#119, 문서만) | 8c22f0e 뒤 #116(문서)·#117(트랙 R R1b·R2)·#118(게시 전 점검 수정)·#119(묶음 13 게시 지시문·보류 기록). 묶음 13 게시 대상은 제품 커밋 `b0ef304`(#118)이고 #119는 비제품 경로다. 묶음 13 `b0ef304`(tree `cb16d6b`, 38줄) 게시 요청 #119(자동 게시, `docs/PUBLISH.ko.md` 8절)는 1차 실행(22:36 UTC)이 트리거·조건 확인까지 동작했으나 지시문의 게시 도구가 비공개 전용이라 blocked(게시 안 함)였다. 공개 사이트 도구로 고친 지시문으로 22:47 UTC에 재요청했지만 23:20 UTC까지 결과 댓글이 없었다(작업 설정의 이벤트에 '커밋 업데이트'는 포함). 대표 결정(2026-09-25 23:2x UTC, "gpt쪽 문제가있는것같으니 우선 스킵하고 다음 단계로 진행"): 묶음 13 게시는 보류하고 라벨을 뗐다. 재개할 때는 `docs/publish/b0ef304.md`(main)를 편집기에 붙여 넣거나 새 요청 PR을 연다. 그동안 다른 도구는 새 게시를 요청하지 않는다. 그동안 다른 도구는 새 게시를 요청하지 않는다 |
| Sites 게시 | `published`: Sites 버전 35, deployment `appgdep_6ab68fba…` succeeded, Sites 작업 사본 tree `02260ba…` = 8c22f0e tree | [게시 기록](releases/2026-09-25-8c22f0e.md)(편집기 보고, 2026-09-25 21:3x UTC 경). 그 앞: e8bd8e0(묶음 11) [기록](releases/2026-09-25-e8bd8e0.md), 트랙 R 단독 게시 73147a9(Sites 버전 31, tree `unknown`) [기록](releases/2026-09-25-73147a9.md) |
| 실행 검증 | 8c22f0e: `/api/version` not_run. 마지막 `runtime-verified`는 e8bd8e0(2026-09-25 13:48 UTC) | 소유자 세션 `/api/version` tree `d8eacc9…` = e8bd8e0 tree(그 게시 기록) |
| 인증 | `AUTH_MODE=email`, 계정 1개(소유자) | 운영 `/api/auth` mode=email, role=owner (2026-09-25 03:30 UTC 경) |
| Sites 접근 | public(사용자 명시 승인, 접근 설정 revision2). 이번 게시도 기존 접근 설정 유지 | 게시 에이전트 보고 "기존 공개 접근 설정을 유지". 게시 뒤 접근 설정 재확인은 not_run |
| 조사 워커 | online(lastSeen 2026-09-25 03:29 UTC, blocked 0, rotationReady true). 2026-09-24 14:15 UTC 새 설치기로 재설치(격리 점검 전부 통과) | `/api/research-worker/setup` 조회(real). gate 표시 `missing`이라 `RESEARCH_WORKER_APP_GATE=enforce`는 켜지 않는다 |
| 열린 PR | #16 Android(draft, 제외), #120 A1 로컬 채널 스킬 팩(draft, 다른 도구), #121 A3-1 카피 팩 v2·#122 A3-2 브랜드 말투 원장(다른 도구), 트랙 R R3a 캠페인 가맹 모집 목적 PR(브랜치 `claude/franchise-recruitment-marketing-u8cpo2`, 이 갱신과 같은 PR) | GitHub 열린 PR 목록(GitHub MCP), 2026-09-26 01:17 UTC |
| main CI | `b0ef304`·`41ea80d`·`8ed30d0` passed | GitHub Actions main 실행(run 36196792023 success, API 조회), 2026-09-25 22:36 UTC |

- 테스트 흔들림(2026-09-25 관찰, 제품 동작 변경 없음, 원인 조사는 별도 작업):
  - CI E2E `e2e/meeting-quality.spec.ts:40`('기준 자료가 바뀐 실패 회의…')가 오늘 3번 60초 시간 초과(#86 1회, #92 첫 CI 모바일·데스크톱). 매번 같은 파일 첫 테스트 직후 두 번째 테스트 첫 줄 `page.request.get('/api/workspace')`에서 멈추고, 같은 로그에 workerd `Broken pipe`가 있다. 재실행하면 통과하고 로컬 `--repeat-each 6`은 24/24 통과(재현 안 됨).
  - `tests/email-auth.test.mjs` '소유자가 멤버·관리자 역할을 바꾼다'가 전체 스위트 병렬 실행에서 가끔 실패(오늘 3회 중 2회, 단독 6/6 통과). 소유자는 '가장 먼저 만든 관리자(created_at, id 순)'로 정해지므로, 계정 생성 시각이 겹치면 승격한 관리자가 소유자로 읽힐 수 있는 구조다(auth 코드는 #23 이후 변경 없음).
- `AUTH_MODE` fail-closed(PR 1, `auth-2`)가 운영에 적용됐다. 운영 빌드에서 `AUTH_MODE`가 비면 모든 인증·업무 API가 503이다. Sites가 public인 동안 legacy로 되돌리지 않는다. 환경 revision 변경·복구·재게시 뒤에는 `/api/auth`가 mode=email인지, 위조 헤더 요청이 401인지 먼저 확인한다. 복구는 [이메일 로그인 복구 순서](EMAIL-AUTH.ko.md)를 따른다.
- 확인 필요: 익명 업무 API 401은 443fff4 게시 뒤 확인했다(passed · real). 위조 헤더 요청 401은 not_run이다(자동 모드 안전 검사 정책). 소유자가 직접 확인한다. 민감 작업 재인증(step-up)은 아직 구현되지 않았다(PR #23 남은 위험).
- 확인 필요: bootstrap 환경 세 항목 제거와 재게시 기록이 없다. 실제 Buffer/Instagram 게시는 not_run.

## 진행 중 작업: 병렬 레인

사용자 승인 "전체적으로 개선하라"(2026-09-23)와 대표 결정 1(병렬 레인)·4(묶음 게시). 범위·배정은 [전체 개선 계획](IMPROVEMENT-PLAN.ko.md)과 성장 계획 문서(PR #26 병합 후 `docs/GROWTH-PLAN.ko.md`)를 따른다.

- PR 0 엔지니어링 기반 `merged`(#22), PR 1 보안·인증 `merged`(#23) — 묶음 1로 게시, `runtime-verified`.
- PR 2 AI 품질 루프 `merged`(#25), PR 3 첫 게시 경로 `merged`(#28), 결정 17 게이트(#29) — 대표 승인으로 `a64aeef` 묶음 게시, `runtime-verified`(당시).
- 묶음 3 `aa999c6`(a64aeef 뒤 31커밋, F3b #57까지) — 대표 승인으로 2026-09-24 게시, Sites 버전 26, `/api/version` tree 일치. 게시 뒤 24~72시간 중단 조건 감시 중(롤백 대상 `a64aeef`). 기능 스위치는 모두 기본값(꺼짐)으로 들어갔다. 레인 A 세션(roybee-9a)이 종료돼 레인 A의 남은 작업(게시 기록·학습 경로 입력 최소화·B3-2)은 레인 B 세션이 이어받았다. 게시 기록 `merged`(#71), 조사 서버 재설치 절차서 `merged`(#72), 학습 경로 입력 최소화 `merged`(#73), 사용자 자료(업로드·직접 입력) 가림 DP-3 `merged`(#74, `2e7a4bb`). 4.4 ①②③④⑤⑦⑧이 모두 `merged`가 되고 운영 반영은 다음 묶음이다. 대표 결정(2026-09-24 11:18 UTC, 선택지 질문 답): 조사·학습으로 보내는 브랜드 정체성의 `audience`·`constraints`에도 개인정보 가림을 건다(⑤ '가림 적용', 이 PR `feat/identity-masking-research-learning`에서 적용). 바이럴 발견은 사례 게시물을 올린 공개 게시 계정만 기록한다(⑧ '공개 게시 계정만 기록', 현재 `caseAccountRule` 확정, 코드 변경 없음).
- 묶음 4 `2e7a4bb`(aa999c6 뒤 16커밋, #59~#74, D1 migration·새 필수 환경변수 없음): 대표가 2026-09-24 11:18 UTC 게시를 승인했다(선택지 질문 답 '2e7a4bb 게시 승인'). 첫 시도는 Sites 작업 사본의 GitHub fetch가 70초 시간 초과로 멈춰 커밋 생성·빌드·게시를 하지 않았다(게시 에이전트 보고, 버전·deployment 없음). 얕은 fetch·재시도 지시문의 두 번째 시도도 fetch가 25초 시간 초과를 반복해 약 32분 뒤 대표가 중지했다(Sites 작업 환경의 GitHub 연결 문제로 본다. 같은 시각 개발 환경에서 GitHub 응답 정상). 대표 결정(2026-09-24 12:0x UTC 경, '2번으로 진행하라'): 게시는 시간을 두고 다시 시도하고, 그 사이 이 PR과 설치기 점검 수정을 병합해 새 SHA로 묶음 4를 다시 승인받는다.
- 묶음 4 `df7e253`(aa999c6 뒤 18커밋, #59~#76) — 대표 재승인(2026-09-24 13:40 UTC)으로 게시, Sites 버전 27, `runtime-verified`. 4.4 입력 최소화 ①②③④⑤⑦⑧·결정 17 AI 표시 확인·설치기 CDP 점검이 운영에 들어갔다. 게시 뒤 24~72시간 중단 조건 감시 중(롤백 대상 `aa999c6`). Sites 작업 환경의 GitHub 코드 전송 문제가 풀리지 않으면 다음 게시도 파일 목록·기대 해시 방식(게시 기록 참고)으로 한다.
- 조사 서버 재설치 완료(2026-09-24 14:15 UTC, 대표 실행): 격리 확인 12줄·Real browser check·샌드박스 유지 모두 통과. 실제 심층 조사 1건(ODA Pizza, 14:18 UTC 시작, 4단계 모두 완료, 자료 38→43건)이 새 격리 브라우저·작업자로 끝까지 돌았다(real). 최종 보고서는 모델이 입력 자료 id를 재선언해 19개 항목이 빠지고 '추가 자료 필요'였다(8개는 id 하나를 다른 URL로 재사용해 연쇄 제거). 근거 보존 개선 PR 진행 중.
- 품질 우선 결정(2026-09-24 15:1x UTC, 대표 선택지 답 — '우리가 산출해낸 결과는 최고의 품질이어야만 한다'): 품질 기준선 측정(B5 서버 평가), 온라인 채점 켜기, 심층 조사 수리 턴 켜기, 조사에 의뢰 목적·시장·경쟁사를 가림 뒤 다시 보내기 — 네 가지 모두 승인. 운영 기능 스위치 `online_grading`·`a7_repair_turn`을 2026-09-24 15:13 UTC 경 켰다(소유자 세션 `POST /api/feature-flags`, 응답 200, 조회 결과 override=true). 평가 전용 HERMES 프로필 `collective-eval`로 첫 품질 기준선을 쟀다(real, 2026-09-24, 운영 `df7e253` 코드로 캡처한 dev 11케이스 — MAPDAL.kr 구매전환 8역할 + ODA 휘경 오픈 insight·strategy·cmo): 결함 0개 산출물 0/11, 적용 채점기 통과율 58/81(71.6%). 채점기 실패는 `internal_id_exposure` 11/11(입력 스키마 경로 노출), `heading_nesting` 5/11, `revisit_cohort_definition` 4/11, `unsupported_claim_term` 3/11. 규제 block 3(가짜 후기 2·광고 표기 1), warn 9. 평가 토큰 231,822(월 상한 1,500,000). 1차 run은 평가 게이트웨이의 비스트리밍 90초 무응답 기준(`HERMES_API_CALL_STALE_TIMEOUT` 기본값)에 걸려 `usage_unreported`로 멈췄고, 평가 프로필만 300초로 올려 나머지 10개를 다시 돌렸다. 운영 HERMES 기본 프로필도 이 값이 없다(기본 90초, 변경은 대표 승인 대상, not_run). [기준선 기록](observations/2026-09-24-quality-baseline-v1.md).
- 품질 우선 후속 `merged`: 심층 조사 근거 보존(#78, `7b45491` — 같은 URL 재선언은 뺀 항목이 아니라 재선언 수, 번호 충돌은 `a7_repair_turn` 번호 수리 1회), 조사에 의뢰 목적·시장·경쟁사를 개인정보 패턴을 가린 뒤 다시 보내기(#79, `e2f6142`). 둘 다 운영 반영은 다음 묶음.
- 품질 수정 v1(PR `feat/quality-fixes-v1`, 기준 `7b45491`): 기준선 결함을 다룬다. 예방(역할 지시문에서 입력 스키마 경로 대신 한국어 이름, 계약 섹션 안 제목 깊이, 재방문율 코호트, 광고 표현·가짜 후기·광고 표기·가격 규칙)을 우선하고, 사람에게 보이는 산출물의 알려진 스키마 경로 → 한국어 라벨, 계약 섹션 안 `#`·`##` → `###`는 저장·렌더 공통 경로에서 정규화한다. 사실·규제 판단은 지어내지 않고 `[확인 필요]`로 둔다(후기는 예시로도 만들지 않고 자리만 표시, 가격 미확정이면 구매 유도 문구 대신 '상품 보기' 같은 행동 유도). 정규화는 역할 실행 저장·팀 회의 결과·작업물 보기 화면에 적용하고, 라벨은 화면 이름(브리프 필드 이름, 확정 사실·후보 사실·거절된 사실·상시 지시·사실 원장)과 같다. 정규화로 가린 결함은 예방이 아니므로 서버 평가는 채점 버전 `failure-types-v1+normalized`로 사람이 보는 본문을 채점하면서 정규화 전 예방 판정(`prevention`)과 정규화 건수를 결과에 남기고, 비교(`compare`)는 `prevention`을 따로 내며, 쌍 평가 게이트는 모델 원문 기준으로 센다(`docs/EVAL.ko.md` '정규화와 예방 판정'). 운영 작업물에도 정규화 건수(`outputNormalization`)를 남긴다. 알려진 한계: 이 PR 이전에 저장된 작업물의 저장 본문·내려받기 파일은 바꾸지 않는다(화면 표시만 라벨). `price_missing` warn은 모델이 구매 유도 문구에 `[가격 확인 필요]`만 붙이면 남는다(사람 확인 항목, 사전 무변경). 역할·회의·브리프 지시 변경은 의도된 제출 바이트 변경이다 — 커밋 뒤 prompt-baseline·role-submission fixture를 재캡처하고 prompt-baseline·role-instruction·prompt-resolution 세 스위트를 함께 다시 돌린다(prompt-resolution은 prompt-baseline fixture의 cmo inputHash에 의존한다). prompt-baseline 차이에는 회의 12단계(meeting·roleMeeting)의 지시·입력 변경도 들어간다(공유 정책·회의 지시 문장, 의도된 변경). 게시 뒤 같은 11케이스로 재평가해 비교한다(예방 효과는 `prevention`으로 읽는다, 기준선 기록 9절).
- 품질 재평가(real, 2026-09-24, [기록](observations/2026-09-24-quality-after-v1.md)): 품질 수정 v1(#80, `443fff4`, Sites 버전 28) 게시 뒤 기준선과 같은 11케이스를 평가 전용 프로필 `collective-eval`로 다시 쟀다(채점 버전 `failure-types-v1+normalized`, 사전 `compliance-lexicon-2026-09-23.2`). 모델 원문의 내부 경로·제목 깊이 결함이 사라졌다(11개 산출물 전부 정규화 건수 0, 예방 판정 fail 0. 기준선은 `internal_id_exposure` 11/11·`heading_nesting` 5/11). 결함 0개 산출물은 0/11에서 7/11(MAPDAL cmo·quality·data·growth, ODA cmo·strategy·insight), 적용 채점기 통과율은 58/81(71.6%)에서 77/82(93.9%)가 됐다(통과 77·실패 5·해당없음 61). 남은 채점기 실패 5건(모두 MAPDAL — `unsupported_claim_term` 금지 목록·금지 표 문장, `revisit_cohort_definition` 정의가 아닌 문장)과 규제 block 5건(산출물 4개 — ODA cmo `fake_testimonial`·`sponsorship_undisclosed`, ODA strategy `fake_testimonial`, MAPDAL cmo·growth `sponsorship_undisclosed`)은 원문 재현 결과 모두 측정 도구 오탐이다. warn은 `price_missing` 산출물 8개·`terms_missing` 2개로 대부분 '구매·주문 CTA 보류' 같은 계획 문장 오탐이다. 재평가 토큰 242,752(MAPDAL run 178,013 · ODA run 64,739), 이번 달 평가 누적 474,574(월 상한 1,500,000). 11케이스라 통계적 개선은 주장하지 않는다(비교 통계 규칙).
- 품질 측정 도구 v2(PR `feat/quality-measure-v2`, 기준 `443fff4`): 재평가에서 드러난 측정 도구 오탐을 고치고 같은 저울 재채점을 더한다. 공유 부정 사전(`lib/graders/negation.ts`)에 절 끝 부정(긴 금지 목록)·인용 사용·금지 맥락 라벨을 더하고, `unsupported_claim_term`은 금지·보류 제목·표를 카피에서 빼며, `revisit_cohort_definition`은 정의 서술만 본다. 규제 가드레일 사전은 `compliance-lexicon-2026-09-25.1`(해소 범위를 `##` 섹션으로 — 다른 `###` 소제목은 표기 서술 문장만, 추천·보증 중단 조건 면제, 매체 광고비 집행 면제, 구매 CTA 보류 계획 면제). `regrade_run`은 끝난 run의 저장 출력을 지금 채점기·사전으로 다시 채점해(모델 호출·토큰 0, 원래 결과 불변) `?compare=<기준>,<비교>&regrade=1`로 같은 저울 비교를 한다(`docs/EVAL.ko.md` 6절). 실제 위반은 계속 잡는다(compliance 합성 violations 전부 검출·normals 오탐 0, graders 기존 기대 유지, mocked). 역할 지시·프롬프트는 바꾸지 않았다(fixture 재캡처 없음). 측정 v2 리뷰에서 재현한 미탐(뒤 절의 다른 대상 보류·부정, 금지어만 든 소제목, 부정한 표기 문장·따옴표 초안의 `#광고`, 결과가 게시인 표기 누락 조건, 같은 문장의 다른 문구 보류, 코호트 없는 콜론·`비중` 재방문율 정의)을 되돌려 HEAD가 잡던 위반을 모두 다시 잡는다(주제어 확인·단독 `보류`는 40자 안·매치 자리 기준 구매 CTA 보류). 채점 버전 `failure-types-v1+normalized+measure-v2`, 재채점 기록은 compare-and-set으로 써서 삭제와 겹치면 409, 이름만 고친 케이스는 기대 판정 변경 표시를 달지 않는다. 게시 뒤 기준선 run(1차·2차)과 재평가 run을 모두 재채점하고 기준 run마다 `?compare=<기준>,<재평가>&regrade=1`로 비교한다(결과: 게시 전이라 not_run).
- 평가 월 승인 레코드(품질 계획 v2 Q2, #86 `a6b0ee3` merged, Q1 평가 종류 골격과 같은 PR): 평가 토큰 월 상한을 UTC 월별 대표 승인(`eval_budget_approval`, 소유자 전용 `set_budget_approval`, 월당 1행·이전 승인은 `history`)에서 읽는다. 승인이 없는 달은 1,500,000이다. 건별 승인(`overBudgetApproved`) run도 제출 직전 월 누적을 보고 승인 cap을 넘으면 `monthly_cap_reached`로 멈춘다(설계 교차 검토 1-3 실패 사례). `GET /api/eval` usage에 `monthlyCap`(승인 반영)·`approval`이 나온다. 대표 사전 승인(2026-09-24, 평가 케이스 확대·토큰 상한 증액): 기준선 달만 월 2.4M, 기준선 run `tokenBudget` 2.0M, 파일럿 평균이 추정의 1.2배를 넘으면 중단·재보고(운영 규칙, 코드 강제 아님). 운영 승인 레코드는 기준선 달이 정해지면 소유자가 기록한다(not_run). 검증은 `tests/eval-budget.test.mjs`(mocked), 운영 반영은 다음 묶음([EVAL 7절](EVAL.ko.md#7-월-승인-레코드eval_budget_approval-q2)).
- Q1 확인(passed · real, 2026-09-25): 운영 평가 케이스 11개 모두 운영자 선호 블록이 없다(`GET /api/eval?case=`). Q1 뒤에도 제출 본문·promptHash가 그대로라 기준선과 바로 비교된다.
- 회의·브리프 평가 종류(품질 계획 v2 G2, #87 `5c17a9e` merged): 평가 케이스 `kind:'meeting_step'`(`capture_case {meetingId, stepId}`)·`kind:'brief'`(`capture_case {briefDraftId}`)를 운영 기록으로 캡처한다. 대상 단계 직전으로 자르고, 조립이 읽는 필드만 남기고, 운영과 같은 가림을 원자료 자리에 적용해 동결한다(`lib/eval-freeze.ts`). 캡처 때 첫 제출과의 드리프트 사유(`captureCheck`, `assembly_drift`만 경보)를 남긴다. 회의 단계 예약 100,000, 브리프는 쌍 평가 제외. 검증 mocked: 동결본 제출이 운영 첫 제출과 바이트 동일(합성 회의 12단계·교정 재시도·브리프). 실제 캡처·파일럿(R1·R2)은 not_run이다(게시 뒤, 파일럿 8건 250k 이하).
- 합성 케이스 생성기(품질 계획 v2 G4, #88 `2d3ecfe` merged): 합성 스펙 → 모의 런타임(고정 시각·결정적 uuid·스텁 HERMES)에서 운영 함수로 역할·회의 단계·브리프 요청을 만들어 `import_cases`로 가져온다. 생성 트리 = 운영 앱 트리, 케이스별 `promptHash` 재계산 일치, 전부 아니면 전무. 스펙은 개인정보 패턴·출처 없는 금지 표현·분기 체크리스트 8종 누락이면 거부된다. dev 스펙 `syn-s2-bakery`(fnb, 15케이스)·`syn-s3-coding`(education, 16케이스). 검증 mocked(두 번 생성 바이트 동일). 봉인 합성 캠페인 스펙(S1·S4·S5, 저장소 밖·다른 사람이 작성)·운영 캡처(C1·C2)·R1 저장은 not_run.
- AI 심사 보정 라벨(품질 계획 v2 J2, #89 `fc92396` merged): 품질 콘솔에 소유자 전용 'AI 심사 보정 라벨' 화면과 `/api/eval` `?labels=queue|item`·`save_label`을 더한다(record kind `judge_label`, 부모 `eval_run`, 라벨이 있는 run은 삭제 409). 블라인드(표시 id·무작위 순서, run·케이스·variant·모델 미포함), dev·active·역할 출력만. 검증 mocked(서버 34, E2E 모바일·데스크톱). 실제 라벨링(R4, 대표 주 20건 × 3주)은 게시 뒤 J3 심사 전에 한다(not_run).
- AI 심사 실행(품질 계획 v2 J3, #90 `ac7a031` merged): `start_run variant:'judge'`가 보정 라벨이 있는 평가 출력만 J1 루브릭으로 심사한다(예약 25,000, 월 예산 합산, 금지 값이 든 항목은 보내지 않음, 결과는 점수만·인용과 가린 이유는 `judge_output`). `?judge=<run>`이 기준별 보정 통계·채택 판정을 낸다. 검증 mocked(29). E1 확장(G2 회의·브리프 동결, J3 심사 재전송)은 대표가 2026-09-25에 승인했다.
- 대표 승인(2026-09-25 02시 UTC 경, 선택지 답): ① 묶음 7 `ac7a031` 게시 승인(J1·G3·Q1·Q2·G2·G4·J2·J3, 목표 tree `53492af`, D1 migration·의존성·환경변수 변경 없음) — 커넥터 방식 지시문을 대표에게 보냈다. Sites가 버전 29(`a41624d`)면 46줄, 버전 28(`443fff4`)이면 61줄 목록을 적용한다(묶음 6 게시 여부를 확인하지 못해 두 경우 모두 적었다, 두 목록 모두 목표 tree 재현 검증). ② E1 확장 승인(위). ③ 운영 HERMES 기본 프로필 무응답 한도 90초 → 300초 승인 — 대표가 2026-09-25 11:13 UTC(20:13 KST)에 실행했다(passed · real: 이전 값 없음(기본 90초), `.env` 백업 뒤 `HERMES_API_CALL_STALE_TIMEOUT=300`, `hermes-gateway.service` active). 재시작 뒤 평가 연결 점검 `check_connection` ready(11:14 UTC). 게시 결과·운영 한도 변경 결과를 받으면 runtime-verified 확인과 릴리스 기록을 남긴다.
- 같은 저울 재채점(real, 2026-09-25, 토큰 0, [관찰](observations/2026-09-25-same-scale-regrade.md)): 운영 채점기(측정 v2+G3)로 기준선 v1과 품질 수정 v1 뒤를 다시 채점했다. 채점기 실패 6→0, 원문 결함(예방 fail) 16→0, 정규화 11/11→0/11, 통과율 92.2%→100%. 수정 v1 뒤 결과에 남은 block 1·warn 9는 모두 측정 오탐이다(합성 라벨 '탈락·수정 기준' 열, 퍼널·분석 이벤트의 '장바구니', 조건·확인 표시 CTA). PR `fix/compliance-failure-label`(#95 merged, 사전 2026-09-25.2)이 고친다. 게시 뒤 재채점으로 11/11을 확인한다(not_run).
- 파일럿 1 측정 오탐(PR `fix/fact-conflict-negated-list`, 기준 `c34a277`): S2 회의 파일럿(real, run `fdceaaa7`) 합의 단계의 수용 기준 문장 '… 할인·무료·보장 표현이 없고, 후기·추천사 예시도 없다'가 거절 사실 사용(`fact_conflict`)으로 잡혔다. 표현 부재 서술(머리 명사 표현·문구·카피 등 + 없다·포함되지 않는다·들어가지 않는다)을 사용 배제로 본다(`+absent-expr`, 사전 2026-09-25.3). 꾸밈말이 붙은 광고 수사('더 이상의 표현이 없습니다')는 계속 잡는다. #97 `ba4eeb8` merged.
- 봉인 케이스 저장(R1, real, 2026-09-25): 대표와 봉인 작성 전용 에이전트 세션이 만들었다. 프롬프트 수정 세션과는 대화·파일을 공유하지 않았다. S1은 대표 세션, S4·S5는 봉인 작성 에이전트다. 세 건 모두 운영 tree `d8eacc9`(e8bd8e0) 체크아웃에서 생성해 `import_cases`로 가져왔다(S1 created 15, S4 9, S5 9, existing 0, HTTP 200). 운영 평가 케이스는 봉인 33(역할 24·회의 단계 6·브리프 3)·dev 74, 합계 107이다(세트별 건수만 확인, 14:55 UTC). 스펙·출력은 저장소 밖에 있고 프롬프트 수정 쪽은 열지 않았다. `sealed_missing`이 풀려 쌍 평가 게이트를 쓸 수 있다.
- 묶음 11 `e8bd8e0`(fa9da73 뒤 #108~#112) — 위임 승인, 대표 게시. `runtime-verified`(13:48 UTC, tree `d8eacc9`, build 13:14:48 UTC, [기록](releases/2026-09-25-e8bd8e0.md)). 운영 계약 읽기(#112), 현장 스킬 적용 조건(#111), 채점기 `+local-rerun+contract-read`, 사전 `.13`. 게시 뒤 재채점(real, 토큰 0): R3 650/12 → 652/10, warn 4 → 1(남은 1은 설계대로 남긴 경고), 예방 fail 4 → 3. 로컬 채널 재실행 64/6 → 68/2. S8 총괄·전략 재실행(real, 24,687토큰): 로컬 채널 1/4 → pass. 새 `industry_metric_leak` 2건은 배달앱 제외 줄 오탐이라 PR #113이 고친다. 봉인 케이스는 게시 전에 가져오지 않았다. 봉인 생성은 이제 e8bd8e0 체크아웃에서 한다. 9월 누적 1,935,242 / 2.4M. 롤백 대상 `fa9da73`.
- 묶음 10 `fa9da73`(121791b 뒤 #105~#107) — 위임 승인으로 게시. `runtime-verified`(11:27 UTC 경, tree `d4a6d2c`, [기록](releases/2026-09-25-fa9da73.md), 기록은 묶음 11 때 뒤늦게 적음). 1차 실행은 편집기가 삭제 한 줄을 건너뛰어 멈췄다. 그 한 줄만 `git rm`으로 적용하는 이어 가기로 게시했다.
- 묶음 9 `121791b`(64e51e8 뒤 #99~#104) — 위임 승인으로 게시, `runtime-verified`(10:21 UTC 경, tree `888f41b`, [기록](releases/2026-09-25-121791b.md)). 사이에 트랙 R #101(`73147a9`)이 08:21 UTC에 tree `unknown`으로 게시돼 있었고, 이번 게시가 그 상태에서 목록 C로 이어 맞췄다. 게시 뒤 R3 재채점(real, 토큰 0): 통과/실패 627/35→650/12(남은 12는 실제 결함), block 2→0, warn 15→9(대부분 오탐, #107). 브리프 3케이스 재실행(real, 26,446토큰): 브리프 실패 3→0(n=3). 롤백 대상 `64e51e8`.
- 묶음 8 `64e51e8`(ac7a031 뒤 #91~#98, 제품 변경은 `lib/graders/`뿐) — 대표 승인(2026-09-25)으로 게시, Sites 버전 30, `runtime-verified`(05:39 UTC 경, [기록](releases/2026-09-25-64e51e8.md)). 롤백 대상 `ac7a031`. 1차 게시 실행은 파일 1개가 빈 파일로 바뀌어 write-tree 불일치로 멈췄고, 그 파일만 다시 받아 게시했다. 게시 뒤 같은 저울 재채점(real, 토큰 0): 수정 v1 뒤 결함 0개 산출물 11/11(통과 81/0, block 0, warn 4 — 모두 오탐, PR `fix/compliance-online-sales-cta` 사전 `.5`가 고침), 파일럿 1 회의 52/0, 기준선 v1 71/6·예방 fail 16·0/11.
- 골든셋 v2 dev 확대(2026-09-25): G0(real, 토큰 0) 결과 운영에는 ODA 역할 3·실패 회의 1(완료 단계 4), MAPDAL 역할 8·완료 회의 1(13단계)이 있고 브리프 초안은 0건이다. 운영 회의 단계 8건을 dev로 캡처했다(real, 평가 케이스 쓰기: MAPDAL 6·ODA 2, 모두 `code_changed`, ODA 2건 `frozenIdentical:false`). C1이 3역할뿐이라 설계대로 합성 dev S6·S7에 S8을 더했다(PR `feat/golden-dev-s6-s8`: S6 무인 보관함 locker, S7 분식 자판기 가맹 B2B fnb, S8 필라테스 체험 education, 각 역할 8). 운영 트리(64e51e8, tree `449a677`) 체크아웃에서 생성해 `import_cases`로 가져왔다(real, 24건, 2026-09-25 06:1x UTC). 운영 평가 케이스는 dev 74건(역할 51·회의 단계 20·브리프 3)이다(설계 72, 브리프 3건 부족을 역할·회의가 메운다). 봉인 S1·S4·S5는 프롬프트를 고치는 레인이 아닌 사람이 만든다(대기).
- 브리프 품질 수정 v2(PR `fix/brief-paths-protected`): 파일럿 R2 S2 브리프의 실제 결함 2건을 고친다. 보호 키(learning 등)를 허용 키에서 빼고 이름으로 밝히며, 입력 JSON 경로 금지 규칙을 더하고, 운영 초안 결과의 경로를 한국어 라벨로 바꾼다. 브리프 지시문 바이트가 바뀌어 G1 기준 fixture의 지시문 digest를 갱신했다(이전 값·사유 기록, 입력·가림 기록은 그대로). 게시는 R3 기준선이 끝난 뒤.
- 회의 단계 정규화 채점(PR `feat/meeting-normalized-grading`, `+meeting-normalized`): 회의 단계를 운영처럼 정규화본(`scrubMeetingOutput`)으로 채점하고 원문 경로 노출은 `prevention`으로 둔다. R3에서 MAPDAL 재검토 원문의 `evidence.facts.confirmed`가 화면에는 라벨로 바뀌는데도 채점기 fail로 잡혔다(역할과 기준 불일치).
- 계약 읽기(#112 merged `e8bd8e0`, 묶음 11로 게시, `+contract-read`): R3 기준선의 `contract_json` 2건은 운영에서도 작업물 거절(`invalid_output`)이 되는 결함이었다. S8 총괄은 완결된 JSON 뒤에 '}'가 하나 더 붙었다. 끝의 '}'·']'를 최대 8자까지 떼고 읽는다. `contract_json` 채점은 원문 그대로 계속 fail로 센다. MAPDAL 크리에이티브는 추천안 섹션의 '… 과업이 확인되지 않은 상태에서 … 단정할 수 없습니다'가 재질문으로 오판됐다. '없다'는 작업·요청·과업이 바로 주어일 때만 본다. 같은 케이스의 `heading_nesting`은 그 연쇄 결과다. 변이 12개 모두 잡힘. 게시 뒤 두 케이스 재채점(토큰 0)으로 확인한다.
- 로컬 채널 재실행 후속(#111 merged `b027004`, 묶음 11로 게시, 사전 2026-09-25.13, `+local-rerun`, [관찰](observations/2026-09-25-local-channel-rerun.md)): #105 게시 뒤 재실행에서 S8 총괄·전략 2건이 여전히 `local_channel_coverage` 1/4였다. 체험 수업 예약 캠페인이라 현장 스킬 적용 낱말이 없어 지시가 붙지 않았다. 현장 스킬을 지점 연결 캠페인(`storeId`, 운영 채점의 점포 조건)과 네이버 플레이스 캠페인에도 붙이고 결정 조건에 방문 예약을 더한다(기준 fixture `43a019a` 재캡처). 같은 run의 채점 fail 4건·규제 warn 2건은 모두 측정 오탐이라 원문 재현 RED 테스트로 고쳤다(쓰려는 조건, '사용 여부', 인용 조사 '고', '포기하는 것' 칸, 인용 CTA 나열 뒤 확인 뒤 추가). 변이 44개 모두 잡힘. 게시는 봉인 케이스 가져오기 뒤, 게시 뒤 S8 2건 재실행(약 25,000)과 재채점(토큰 0).
- 서술형 CTA 측정 오탐(#110 merged `eb96132`, 사전 2026-09-25.12): fa9da73 게시 뒤 R3 재채점 warn 4건 중 3건(판매처, '주문하기 어려움', 검수의 지적·확인 뒤 삽입)을 고친다. 남는 1건은 조건 없는 '[가격 확인 필요]' CTA(설계대로 경고).
- 장바구니·조건부 CTA 측정 오탐(PR `fix/cart-cta-conditions`, 사전 2026-09-25.11): 121791b 게시 뒤 R3 재채점에 남은 warn 9건 중 MAPDAL·ODA의 퍼널 단계 명사 '장바구니', 확인 뒤 검토·결정하는 CTA를 고친다. 조건 없는 '[가격 확인 필요]' CTA 경고는 설계대로 남는다.
- 로컬 채널 결정(품질 수정 v2, #105 merged `41b9fbf`): R3에서 점포 목표 합성 캠페인(S2·S6·S8)의 총괄·전략 6건이 모두 `local_channel_coverage` 1/4였다. 현장 스킬(`channel.offline`, 코드 상수와 `prompts/` 정본)에 로컬 채널 4개군(네이버 플레이스·당근·배달앱·카카오)을 한 줄씩 채택·후순위·제외로 결정하게 했다. 역할 제출 바이트가 점포 캠페인에서 바뀌어 기준 fixture를 `73a90ed`에서 재캡처했다. fa9da73 게시 뒤 6케이스 재실행(real, run `e788c058`, 77,936토큰, 2026-09-25 11:28~11:41 UTC): S2·S6 총괄·전략 4건은 통과, S8 2건은 1/4로 남았다(위 후속 PR). 9월 누적 1,910,555 / 2.4M.
- R3 dev 기준선(real, 완료): 대표 결정(2026-09-25)으로 기준선 달을 9월로 확정하고 9월 월 승인 2.4M을 기록했다. run `eab8911d`(dev 74케이스, tokenBudget 1.8M)가 06:58~09:20 UTC에 74/74 완료, 1,227,228토큰(추정 1.45M의 0.85배), 오류 0, 최장 단계 151초. 채점 실패·규제 판정은 원문을 모두 재현했고, 측정 오탐은 PR `fix/r3-measure-early`(`+r3-measure`, 사전 2026-09-25.10)가 고친다. 실제 결함(로컬 채널 검토 누락 S2·S6, 계약 형식 MAPDAL 크리에이티브·S8 총괄, 브리프 경로·보호 키·허용 밖 키)은 기준선 결과로 남긴다. 회의 단계 `input_budget` 상한은 실측(최대 52,268)으로 64,000을 정했다. 게시 뒤 재채점(토큰 0)과 관찰 기록이 다음이다. A/A 10건(약 0.22M)은 10월 기본 한도로 돌린다.
- 파일럿 R2(real, 2026-09-25, [관찰](observations/2026-09-25-pilot-r2.md)): S2 회의 6단계(run `fdceaaa7`, 87,119토큰)와 S2·S3 브리프(run `0938a0ca`, 17,252토큰). 8건 104,371토큰(건당 13,046)으로 추정 25,000의 0.52배, 최장 97초, 회의 입력 최대 17,455토큰. 회의 채점 실패 5건은 모두 측정 오탐이다. #97과 PR `fix/pilot1-critique-negation`(`+critique-clause`, 사전 2026-09-25.4: 다른 지표 산식·'재방문율이 아니라'·'계산할 수 없다'는 재방문율 정의가 아님, '-지는 않' 부정)이 고친다. S2 브리프에 실제 결함 2건(제안 값의 스키마 경로 노출, 보호 항목 `learning` 제안 — 파서가 버려 화면엔 없음)이 있어 R3 기준선 뒤 품질 수정 후보로 둔다. 9월 누적 578,945 / 1.5M.
- 심층 조사 보고서 근거 보존(PR `fix/deep-report-evidence`, 기준 `df7e253`): 운영 실측(aa999c6, 2026-09-24 심층 조사 4단계 완료, 최종 보고서에서 19개 항목을 빼 `needs_data`)의 두 원인을 다룬다. (1) 이미 보관된 입력 자료를 같은 URL로 다시 적은 11건은 이제 뺀 항목이 아니라 재선언 수로만 센다(기본 동작, 스위치 무관, 화면 ‘기존 자료 재선언 N건(인용 유지)’). (2) 입력 자료 번호 하나를 다른 URL로 다시 써서 접근 기록·고객 관찰·핵심 주장·진단 근거·실험 과제 등 8개가 연쇄로 빠진 문제는 `a7_repair_turn`이 켜져 있을 때 번호 수리 1회로 되찾는다(서버가 원래 응답과 대조해 번호 바꾸기만 받고, 충돌 번호에 남은 인용은 계속 뺀다. 모든 구간에서 원래보다 적지 않을 때만 채택). 스위치가 꺼져 있으면 사유 문구만 원인을 말한다. 운영 `a7_repair_turn`은 대표 승인(품질 우선 결정)으로 2026-09-24 15:13 UTC 경 켜 두었다 — 이 PR이 게시돼야 번호 수리가 동작한다(지금 운영은 뼈대 오류 수리만). 켜진 상태에서는 뼈대 오류·번호 충돌 때 조사당 1회 유료 토큰을 쓴다(예산 가드 적용, 입력 60k 토큰 상한).
- 묶음 5 `443fff4`(df7e253 뒤 #77~#80) — 대표 승인(2026-09-24 18:29 UTC)으로 게시, Sites 버전 28, `runtime-verified`. 심층 조사 근거 보존·조사 의뢰 정보 가림·품질 수정 v1이 운영에 들어갔다. 롤백 대상 `df7e253`. 같은 평가 케이스 11개로 품질 재평가 중.
- 품질 계획 v2([품질 로드맵](QUALITY-ROADMAP.ko.md)): 측정 v2 병합 뒤 평가 공통 골격(Q1·Q2) → 골든셋 v2(9캠페인 105케이스) → 대표 라벨로 보정한 AI 심사(J1~J4), PR 10개. 대표 승인(2026-09-24): 사람 보정 라벨링 참여, 기준선 달만 평가 월 상한 1.5M→2.4M·기준선 run tokenBudget 2.0M·파일럿 평균이 추정 1.2배를 넘으면 중단·재보고(적용은 그 달의 `set_budget_approval` 기록이고, 기록 전에는 1.5M이다. `docs/EVAL.ko.md` 7절). merged: 측정 v2(#83), G1 조립 공개(#82), J1 AI 심사 루브릭·보정 통계(#84, 모델 호출 0, [AI 심사](JUDGE.ko.md)), G3 회의·브리프 채점기(#85). 진행: Q1·Q2(`feat/eval-kinds-skeleton`) 다음 G2 회의·브리프 평가 종류.
- 트랙 R(가맹점 모집 마케팅 솔루션, [계획](FRANCHISE-RECRUITMENT-PLAN.ko.md)): 대표 요청(2026-09-24)으로 계획을 세우고 1차 대상을 OFD 첫 가맹으로 정했다(결정 19). OFD 운영 사실·계약 내용·모집 자료 개정본·법률 미팅 자료·계약서 검토서는 저장소 밖에 둔다(공개 저장소 경계). 저장소에는 건수만 적는다: 모집 자료 개정 초안 2건과 브랜드 소개판 1건, 법률 미팅 자료 5건, 가맹계약서 검토 1건(필수 기재 13개 호 중 충족 9·미흡 3·누락 1, 위험 30건, 2차 검토 유지 71·기각 1). 대표 결정(2026-09-25): 결정 20 법률 검토 보류(LR-1·LR-2 `blocked`, 게이트는 휴리스틱 표시), 결정 22 리드 이름·연락처 저장. R4a·R1a·R4b(리드 원장, 스위치 `r_franchise` 기본 꺼짐)는 #101로 `merged`이고 121791b부터 운영에 있다(`runtime-verified`, 스위치 꺼짐). #117로 `merged`(`41ea80d`): R1b 모집 팩트시트(가맹 사실 36항목·정보공개서 버전 근거·각주·수익 항목 광고 금지), R2 모집 광고 가드레일(사전 범주 `franchise_recruit`, 사전 `.14`, 해제 불가 8종, 소비자 캡션은 모집 문구가 있을 때만 차단), 설정 기능표의 소유자 전용 가맹 모집 켜기·끄기 버튼. R2 새 합성 문장 최종 측정(passed · mocked): 소비자 캡션 150건 해제 불가 0·차단 5, 정상 모집 60건 오탐 0, 현실적 모집 위반 120건 중 62%가 차단 또는 경고로 드러나고 38%는 놓친다(대기기간 우회·단체 조건·본사 연계 자문이 약하다, 승인 체크리스트로 보완 예정). 실제 브라우저·법률 적합성은 `not_run`. 게시 전 점검(4개 관점 검토)에서 비가맹 브랜드의 원장 점검 약화 1건을 찾아 이 PR에서 고쳤다([계획 R1 기록](FRANCHISE-RECRUITMENT-PLAN.ko.md#r1-모집-팩트시트)). 게시 전 점검 수정은 #118로 `merged`(`b0ef304`). 운영 반영(묶음 13)은 대표 결정으로 보류 중이다. 대표 결정(2026-09-25 23:36 UTC, "둘다 그렇게 하라"): 결정 26(objective 하나·대표·관리자 설정·새 채널 단위 6개는 코드 PR과 묶음 게시, A1 '게시 없이 반영'은 기존 단위 본문만)과 결정 31(R-1 창업 게시는 앱 밖 창업 계정에 수동)을 권고대로 정했다. R3은 A1 PR(#120)과 파일이 겹쳐 R3a(objective·적용 범위, 이 PR)·R3b(새 채널 단위 6개, #120 뒤)·R3c(업종 채점·재채점)로 나눴다. R3a: 캠페인 가맹 모집 목적(`franchise_recruitment`, 대표·관리자 지정·해제, 스위치 꺼짐 지정 409·해제 허용, 지점·브랜드 변경·제작 기록 보호), 모집 캠페인의 소비자 채널 스킬(offline·search·commerce) 끄기, 가맹 근거 정책, 발행 캡션 모집 범위 판정(가맹 프로필 없어도), 브리프 초안 목적 이어받기. 목적 없는 캠페인의 제출 바이트는 기준 fixture 재캡처 없이 같다(passed · mocked). 스위치가 꺼져 있는 동안 가맹 기능은 운영 동작에 들어가지 않는다.
- 성장 계획 `docs/GROWTH-PLAN.ko.md`(#26)가 병합됐다. 레인 배정·공유 파일 병합 순서·묶음 게시 절차는 그 문서가 정본이다.
- 레인 A(공통 기반·교정, 세션 roybee-9a): F1a·A2 순수 함수 `merged`(#27), F4a kind 레지스트리·결정 7 삭제 정책 `merged`(#32), F1b-1 역할 지시 순수 함수 연결 `merged`(#35, 스냅샷 `tests/fixtures/role-submission-fc8eb5c.json`), F1b-2 서버 평가 실행 `merged`(#39, `/api/eval` 소유자 전용, 평가 작업 소유자당 1개). F2a 실행 신원·기능 스위치 `merged`(#43: `lib/feature-flags.ts` 기본 꺼짐 — online_grading·b1_reason_required·a4_auto_attribution·a2_downgrade, 소유자만 변경 / 사용량 원장 조인 키 / 보고 모델 변경 경보 / 사용량 내보내기). F2b 게이트웨이 스냅샷·온라인 채점 `merged`(#45: 워커 tick에서 소유자당 하루 1회 스냅샷, `online_grading` 스위치가 켜질 때만 저장 뒤 채점). B1 검토 결정 로그 `merged`(#51: 대표 결정 8 (a) — quality 5기준 + compliance·voice·fact_error·question_only·format 사유 코드, 추가 전용 `review_decision`(메모 원문 없이 길이만, 행위자 id·역할만), 사람이 고친 AI 작업물은 origin `ai_edited`, `b1_reason_required` 스위치(기본 꺼짐)를 켜면 수정 요청 사유 필수, 문서 `docs/REVIEW-DECISIONS.ko.md`). F3a 프롬프트 레지스트리 `merged`(#55: 결정 2·3 — git `prompts/` 16단위 정본, 스킬만 레지스트리, 비면 코드 상수로 폴백해 제출 바이트 동일, CI 'Prompt registry sources' 검사, 상태 어휘 `registry-active`, 사용량 promptVersion은 레지스트리면 'unit@sha12' 연결·코드면 '<skillVersion>:<sha12>'/'inline:<hash>'). 다음은 F3b 활성화 게이트(쌍 비교 평가·대표 승인). HERMES 평가 전용 프로필(메모리 off)은 대표 승인으로 서버에 생성됨(운영 게이트웨이 무변경).
- 레인 B(실측·비용, 이 세션): B4 1부 바이럴 판정 통계 `merged`(#30). A4 점포 실측·PR 4a 비용 가드·PR 6 앱 측은 F2(기능 스위치·`lib/hermes.ts`·`lib/research-worker.ts` 순서) 뒤. 그 사이 PR 5 중 공유 파일에 걸리지 않는 부분을 진행한다: PR 5a 내비게이션·로딩 상태·대시보드 숫자 `merged`(#37), PR 5b 삭제 대화상자(결정 7·건수 API)·보존 규칙 표시·E2E route.fetch 제거 `merged`(#40), 동결 요약 표시 `merged`(#41). PR 4b-1(loop-6 검증 채널 분리·loop-7 점포 회고 규칙 승격 미리보기·loop-9 측정 기간 롤링·arm별 초안·loop-11 만료 임박 규칙 알림·연장 조건·exec-loop-10 발행 횟수 한도) 이 PR. PR 4b-1 `merged`(#44). A4-1 점포 실측(추적 코드·POS CSV 가져오기·`a4_auto_attribution` 스위치 기반 자동 귀속·코드/팔/캠페인/출처별 집계·주 단위 완전성 검사·incrementality-lite) `merged`(#46). 발행 캡션의 추적 코드 연결은 A4-2. PR 6 앱 측(security-ops-4·7·1: 워커 토큰 만료·온라인 회전·재발급 10분 유예·거부 기록·앱 gate 확인·조사 도구 위험 등급) `merged`(#47) — 만료·회전은 `RESEARCH_WORKER_TOKEN_EXPIRY=enforce`, 앱 gate 차단은 `RESEARCH_WORKER_APP_GATE=enforce`, 위험 도구 차단은 `RESEARCH_TOOL_POLICY=block`일 때만 켜지고 기본은 기록·경고만 한다. PR 4a 비용 가드(loop-4 토큰 예산: 기본 미설정·경고만, 소유자가 월 워크스페이스·캠페인 상한을 정하면 HERMES 제출 전 409 / loop-5 별칭 단가 선언 재추정 / security-ops-11 커넥터 응답 200KB 제한·조사 처리 오류 고정 문구) `merged`(#48). A4-2 게시 단위 귀속(발행 캡션의 게시별 쿠폰·POS 태그 코드 줄, 게시 상태·예약일 관문, 점포 귀속 보고서의 게시별 집계, 소재 제목) `merged`(#49). A4-3 추적 코드 직접 입력(주문 기록 창·장부 양식 CSV `trackingCode` 열의 코드 조회·게시 관문, 앱 게시 기록 없는 소재의 수동 귀속 경고 — 차단 없음, 코드 열이 든 장부 CSV는 관리자만) `merged`(#50). A2 런타임 하향(`a2_downgrade` 스위치, 기본 꺼짐: 켜면 차단 등급 규제 위반 작업물에 '규제 점검 차단' 표시, 품질 검수 판정·캠페인 상태를 수정 필요로만 낮춤, `lib/online-grading.ts` 안에서 처리 — 레인 A 확인) `merged`(#52). PR 4b-2(loop-3 잔여: 캠페인 상세 성과 탭의 주문 장부 귀속 집계 — 주 단위·지점·소재·게시·귀속 방식별, '귀속≠증분', 확인 뒤 schemaVersion 2 metric 스냅샷(어제까지) / 네이버 검색광고 수집 광고비를 관리자 확인 뒤 비용 장부로 이관·누적 재수집 갱신) `merged`(#53). loop-3 잔여는 학습 규칙 연결(B3·B4 2부)만 남는다. A7 조사 투자 회수 `merged`(#56) — 부분 구제(기본 동작, 추가 비용 없음: 심층 조사 결과에서 잘못된 항목만 사유와 함께 빼고 유효 출처는 candidate로 저장, 뺀 항목이 근거·진단에 걸리면 품질 판정 needs_data), security-ops-11 잔여(null 원소 → 구제 또는 422, 점포 진단은 422), 수리 턴 1회(`a7_repair_turn` 스위치, 기본 꺼짐: 뼈대 오류일 때만 예산 가드를 거쳐 1회, 원래 응답에 없던 출처는 뺌). PR 5d `merged`(#58) — data-truth-8 파생 캠페인 상태(응답에 derivedStatus·statusReason만 추가, 저장 status와 그것을 쓰는 서버 로직 불변, 새 표시 상태 '진행 막힘'·'발행 진행', 대시보드 수치도 파생 상태 기준) + ux-9 캠페인 보관(archivedAt, 목록·대시보드에서 숨김·보관함 필터·해제, 산출물이 있으면 삭제 대화상자 기본이 보관, 보관 중 새 AI 실행·회의·초안·연속 실행·발행 승인 409, 진행 중 작업·예약 발행이 있으면 보관 거절). B2 1단계 품질 콘솔 이 PR — LLM 없이 역할×스킬 버전×promptVersion(레지스트리 'unit@sha'면 그 값, 코드 상수면 스킬 버전으로 접음)×보고 모델별 1차 승인율(B1 정의 재사용)·사람 판정 사유 분포·폐기 토큰(미연결 따로)·회의 완주율·온라인 채점·규제 보류, 기준별 κ(사람 라벨 20건 미만이면 보정 불가), 주간 다이제스트(`GET /api/quality-console?format=digest`와 로컬 `scripts/quality-digest.mjs`, 네트워크 없음), 소유자·관리자 전용 화면. 워커 큐·Slack 전달은 B2 2단계. 다음은 PR 4a-2 실행 가드(보관 검사 잠금 안·OpenAI 직접 경로 예산 가드·복구 중 예산 초과 표시·수리 예약 분리, 구현 중), 그 뒤 PR 5c 화면·권한. F4b는 대표 결정 12(국외 기반 모델 데이터 처리 기준) 대기. PNG 코드는 A4-4 또는 소재 템플릿 작업(공개 미디어 경로 변경 필요), 캠페인 성과 탭 자동 집계는 PR 4b. A7·F4b는 레인 A의 B1 뒤. PR 4a 비용 가드는 A4 다음, `lib/role-execution.ts`는 F3 뒤라 HERMES 제출 지점(`lib/hermes.ts`)에서만 다룬다.
- PR 6 서버 측 `merged`(#33): 조사 서버 브라우저 격리(CDP 연결 구조로 변경)·설치기 권한 축소·워커 백오프. 앱 측 PR에서 설치기 워커 유닛에 `ReadWritePaths=/etc/collective-research`(설정 폴더만 쓰기 허용)를 더했다. 온라인 토큰 회전은 이 설치기로 재설치한 워커만 저장할 수 있다. **공유 서버 재설치는 대표 승인 뒤**. 대표 결정: 게시 뒤 대표가 직접 재설치한다. 실행 순서는 [조사 서버 재설치 절차서](RESEARCH-SERVER-REINSTALL.ko.md). 1차 재설치(2026-09-24 11:3x UTC, 대표 실행)는 3/6단계 설치 점검에서 멈췄고 설치기가 되돌렸다(HERMES 설정 무변경). 대표와 함께 한 진단(real): 샌드박스·AppArmor·방화벽은 정상이고 Chrome for Testing 154에서 `--dump-dom` 점검이 끝나지 않았다. 설치기 점검을 CDP 방식으로 바꿨다(이 PR). 재설치는 이미 받은 설치 파일에 이 PR의 설치기 코드를 적용해 다시 한다. 그때까지 서버 조사는 멈춰 있다(새 자격증명 발급으로 이전 워커 토큰 거부). 실서버 검증 not_run.
- E2E 간헐 실패: 회의 테스트의 응답 폐기 경합은 수정(#34). workerd 크래시는 원인 미확정(blocked) — 다음 발생 때 `[serve]` 로그로 사유 확인.
- 새 records kind는 `lib/record-kinds.ts` 등록 필수(#32, `tests/record-kinds.test.mjs`). 역할 지시는 `lib/role-instruction.ts` 한 곳에서 만든다(#35). `lib/practice.ts`·`campaign-policy.ts`·`ai-context.ts`·`role-instruction.ts`를 바꾸면 `scripts/eval/capture-role-submission.mjs`로 스냅샷 재캡처.
- E2E 규칙: 테스트 route 처리기에서 `route.fetch()`는 부하 중 응답이 멈출 수 있어(화면 폴링이 끝나지 않은 reload에 막힘) 미리 받은 응답을 `route.fulfill`로 돌려준다(#37, PR 5b에서 기존 스펙 정리).
- 결정 17(AI 생성물 표시) 미결: AI 카피 캡션은 `AI_COPY_CAPTIONS=enabled`가 아니면 꺼져 있다(#29).
- `docs/STATUS.md`·`prompt_plan.md`는 여러 레인이 함께 쓰므로 병합 순서대로 rebase해 갱신한다.

## 이력

아래는 각 시점의 기록이다. "운영 미적용", "Sites 접근은 변경하지 않았다", "runtime-verified는 blocked", "제품 소스 a67a318"처럼 현재형으로 적힌 서술은 모두 그 시점의 상태다. 현재 상태는 위 "현재 운영 상태" 표를 따른다.

### 2026-09-24 08:48 UTC 기록 — 묶음 3 게시 (aa999c6, Sites 버전 26)

- 직전 운영은 `a64aeef`(Sites 버전 25, 2026-09-23 15:34 UTC 경 `runtime-verified`)였다.
- 대표가 레인 A 세션에 승인한 `aa999c6`(tree `6c4f155…`)을 대표가 휴대폰에서 Sites 편집기에 지시문을 넣어 게시했다. 버전 26, deployment `appgdep_6ab4e35785208191be56f75d057c0c0f` succeeded, 약 5분. 운영 `/api/version` tree가 aa999c6 tree와 같다(real). [게시 기록](releases/2026-09-24-aa999c6.md).

### 2026-09-23 12:48 UTC 기록 — 보안·인증 게시 (d156dfd)

- PR 0(#22)의 미게시 제품 변경과 PR 1(#23)을 함께 게시했다. 운영 `/api/version` tree가 `6a1881b…`로 d156dfd tree와 같아 `runtime-verified` · real.
- 게시는 대표가 Sites 편집기에서 직접 실행했다. Sites 버전·deployment ID·migration 0003 적용 결과는 기록 없음. [게시 기록](releases/2026-09-23-d156dfd.md).
- PR #19는 이미 `CLOSED`다(이전 STATUS의 "닫을 예정"은 해소).

### 2026-09-23 07:48 UTC 기록 — 실행 연결 첫 단계 배포 (dbf94a5, Sites 버전23)

- 이 절의 runtime-verified blocked는 2026-09-23 07:58 UTC 경 관리자 이메일 세션 확인으로 해소됐다(위 표).
- 제품 `dbf94a5138df0ea0765919abaa4fa955511d49a2` / PR #20 merged.
- Sites 버전23 published: `appgdep_6ab383ddc9408191a9cb0e12916d5cd5`, succeeded, 2026-09-23 07:46:46 UTC. 기존 public 접근과 환경 revision4를 유지했다.
- 제품/Sites 투영 tree `281ea84a47227a5eec82c0b2b7c0cde6c5889c90` 일치. runtime-verified는 blocked: 운영 브라우저에 이메일 로그인 세션이 없어 `/api/version`의 인증 후 값을 확인하지 못했다. 실제 새 로그인 화면까지 확인했으며 내부 기능 정상 작동으로 확대 해석하지 않는다.
- 전체27/27 suites·849 assertions, TypeScript, lint gate, build, 기본 E2E12와 이메일 E2E1 passed. main CI `35831544401`도 재실행 후 verify/e2e-smoke 모두 passed. 최초 이메일 검사 실패는 Miniflare `Network connection lost` HTTP500으로 확인했고 제품 코드는 바꾸지 않았다.
- 실제 Buffer/Instagram 게시 not_run(계정·공개 이미지 호스트 미연결). [배포 근거](releases/2026-09-23-dbf94a5.md).
- 아래 이전 배포 기록은 당시 근거로 보존한다. 후속 문서 전용 커밋은 별도 게시하지 않는다.

### 브랜드 사실·제작·발행·주문 연결 — 개발 검증 (PR #20 병합 전 기록)

- 기준 main `1ecd72e`의 이메일 로그인 변경을 보존해 통합했다. [기능·운영 경계](EXECUTION-LOOP.ko.md), [승인 범위](EXECUTION-LOOP-PLAN.ko.md).
- 사실 버전/출처/유효기한, 실제 PNG 제작·저장, 계정·소재·예정 비용 승인, Buffer Instagram 어댑터, 주문의 캠페인·소재 귀속을 구현했다.
- 새 통합 회귀: 실행49, 이메일 권한10, 사실31, 주문귀속22 passed. real SQLite / mocked Buffer·HTTP·R2.
- 브라우저: 기본 Playwright12 passed(real Chromium Canvas·로컬 D1/R2, mocked 로그인 헤더), 이메일 인증1 passed(real 로컬 쿠키 세션).
- TypeScript passed; lint gate passed(107 errors/108 기준선, 44 warnings/44 기준선). 기존 lint 오류를 0으로 보고하지 않는다.
- 코드·보안 리뷰의 게시 결과 유실, 예약 캠페인 삭제, 잘못된 PNG, 승인 계정 경합, 업로드/요청 한도 문제를 보완했다. 수정 한도에서도 사실 확인 철회가 가능하다.
- 실제 Buffer 계정 검증·외부 호스팅·SNS 게시: not_run(연결 계정·호스트 미제공). 실제 광고비/모델 비용의 하드캡, 자동 CRM, GEO 모니터링은 후속 범위다. 커버리지 비율: not_run.
- 소스 병합/게시/runtime-verified는 이 구현 테스트 결과와 별도로 후속 배포 기록에 남긴다.

### 2026-09-23 07:09 UTC 기록 — 이메일 로그인 게시와 공개 전환 (PR #18, 1ecd72e)

PR #19(`docs/email-auth-release`, 커밋 aa06574·b242019)가 기록했으나 `main`에 병합되지 않은 내용을 옮겼다. 당시 "관리자 초기 설정 대기"였고, 이후 관리자 계정 설정과 runtime-verified는 위 표에 있다.

- PR #18 merged: `1ecd72e94101e5e3d3a098eb1e86804d70f9d03c`. Sites published: `appgdep_6ab378faf33c81919101aff6ff1aef8a`, 환경 revision4. 사용자 지정 이메일을 초기 관리자 secret으로 설정하고 기존 owner에 연결했다. 비밀번호·초기 토큰 원문은 저장소에 저장하지 않았다.
- 실제 운영 검사 passed: `/api/auth` 200(mode=email/user=null), 익명·위조 GPT 헤더 업무 조회401, native scrypt를 실행하는 미등록 계정 로그인401. 운영 자료 조회와 `/api/version` tree 검증은 관리자 비밀번호 설정 전이므로 not_run; 전체 runtime-verified는 아직 아니었다.
- 사용자 명시 승인으로 Sites 접근을 public(revision2)으로 전환했다. 무자격 GET `/`200(GPT 게이트/리다이렉트 없음), `/api/auth`200(email/null), 업무 API 익명·위조헤더401, 계정 API401 확인. 초기 등록 링크는 사용자에게 전달했으며 본인이 비밀번호를 설정한 뒤 bootstrap 환경 제거와 운영 자료/tree 확인을 이어가기로 했다.
- CI: verify 모두 passed. 동일 최종 소스 push 실행35829036803은 기존10+이메일1 브라우저 passed. PR 실행35829042093은 테스트 서버 종료 뒤 연결 거부로 failed(원인 미확정). 공개/운영 인증 성공과 이 비차단 검사 실패를 혼동하지 않는다.
- [게시 기록](releases/2026-09-23-1ecd72e.md), [운영 설정·전환·복구 및 검증 근거](EMAIL-AUTH.ko.md).

### 2026-09-23 06:34 UTC 기록 — 이메일 로그인 구현 및 로컬 검증 (당시 운영 미적용)

- 사용자가 이메일+비밀번호 및 관리자 초대 방식을 승인했다. 기준 `d96a6cae30076dd429ccaae21074216d33075264`, 별도 `feat/email-auth` 브랜치.
- 기존 owner 연결 보존, 초대·재설정 일회 링크, 30일 세션, 관리자 권한 제한을 구현했다. GPT 헤더는 이메일 모드에서 인증에 사용하지 않는다.
- tests passed 23/23 suites, runner 집계737 assertions와 별도 node:test 인증20개. SQLite/native crypto real, Cloudflare 환경 adapter/모델응답 mocked.
- build/typecheck passed. 기존 브라우저10/10 및 이메일 브라우저1/1 passed. 이메일 여정은 real HTTPS Chromium/local workerd/D1/native scrypt로 실행했다.
- lint 기준선 gate passed, errors106/108·warnings44/44(0 errors 의미 아님). 독립 코드·DB·보안 검토 CRITICAL/HIGH 0, pending 초대 재발급 UI와 요청한도 소진 시 로그아웃 차단 지적 수정. 만료 인증 레코드 정리는 후속 운영 과제로 기록했다. 운영 게시·운영 CPU 한도·실제 Android 이메일 로그인은 not_run.
- 남은 입력: 최초 관리자 이메일. 사이트 진입 화면 공개 전환은 사용자 명시 승인 후 진행하며 자체 업무 API 보호를 먼저 검증한다. 운영 데이터와 Sites 접근은 변경하지 않았다.
- [운영 설정·전환·복구 및 검증 근거](EMAIL-AUTH.ko.md).

### 소스와 배포 — a67a318, Sites 버전21 (당시 기록)

- 제품 소스: `a67a318abd024880389f5dde5e8923bc2ca60657` (PR #15 merged, main CI passed).
- Sites 버전 21 published, 환경 revision 3 유지. 배포 `appgdep_6ab36c7589b881919fb9302d31532b86` succeeded.
- runtime-verified: 로그인한 운영 브라우저의 `/api/version`가 tree `b57380bb9ade2e2aea7a1ee5fc8fcff92ace6b7f`를 반환해 제품 소스와 일치했다.
- 이 상태 기록의 후속 문서 커밋은 별도 게시하지 않는다. 운영 기준은 위 제품 커밋이며 문서 전용 main 후속 커밋과 구분한다. [게시 증거](releases/2026-09-23-a67a318.md).

### ODA 실사용 후속 보완 — 운영 적용 (a67a318 당시)

사용자가 실제 ODA 오류 분석 뒤 구현을 승인했다. 역할별 결과 계약·재작성/후속 무효화, 회의 실패 단계 재작성, 서버 단일 진행, 업종·측정 규칙, 사용량 진단을 보완해 PR #15로 병합·게시했다. [상세](ODA-EXECUTION-FIXES.ko.md).

- 테스트: passed, 21/21 suites (real SQLite/핸들러, mocked 모델 공급자).
- Playwright: passed, 10/10 (real Chromium/로컬 D1, mocked 인증; 새 회의 검사는 응답/작업자 상태도 mocked).
- TypeScript 및 build: passed, exit 0. lint gate: passed, errors106/기준108, warnings44/기준44.
- 코드 검토의 후속 작업물 무효화와 재작성 UI 지적을 수정했다.
- 커버리지 비율: not_run. 구조 검증을 사실 정확성 검증으로 해석하지 않는다.
- 운영 화면에서 기존 Insight 재질문을 보완 필요로 차단하고 재작성 버튼을 제공하는 것을 확인했다. 실제 재작성 1건도 성공했다(23,216 tokens, 비용 미확인). 근거 구분과 30일 성숙 코호트 정의를 원문에서 확인했으며, 전체 캠페인 완료를 의미하지 않는다. [게시 기록](releases/2026-09-23-a67a318.md).

### 이전 버전 20의 보완

1. 역할·바이럴 접수의 원자 저장, 멱등 복구, 활성 실행 전체 조회.
2. 실패·취소·형식 오류를 포함한 사용량 원장, 수동 가격 버전과 nullable 비용, 설정 UI.
3. machine worker의 역할·회의·바이럴·초안 진행, 캠페인 연속 실행 동의/중단, 조사·측정 공정 순환.
4. 캠페인 상세 및 이전 원문 비교, 출처·기간·범위와 미확인 비용 보존, stale 수정 거부.
5. 요청/외부 응답 스트림 제한, 설치 파일 관리자 제한, 읽기 전용 운영 인증 probe.

상세와 적용 조건: [실행·사용량·작업물 보완](RELIABILITY.ko.md), [보안 경계](SECURITY-BOUNDARIES.ko.md).

### 이전 버전 20의 검증 기록

| 검사 | 상태 | 근거 |
|---|---|---|
| `node scripts/test.mjs` | passed · 16/16 suites, 646 assertions | real SQLite·핸들러 / mocked 외부 공급자 |
| `node node_modules/typescript/bin/tsc --noEmit` | passed · exit 0 | real 정적 검사 |
| `node scripts/lint-gate.mjs` | passed · errors 106/108, warnings 42/44 | real 정적 검사, lint zero가 아님 |
| `node scripts/run-framework.mjs build` | passed · exit 0 | real 로컬 빌드 |
| `node node_modules/@playwright/test/cli.js test` | passed · 8/8, 18.0초 | real Chromium·로컬 D1 / mocked 인증 헤더 |
| `python3 tests/research_worker_test.py` | passed · 4/4 | mocked gateway / real 로컬 HTTP |
| 운영 익명·위조·중복 인증 헤더 GET | passed · 각 HTTP 401 | real, 기존 운영 사이트 읽기 요청 3건 |
| 원본 Worker 직접 접근·로그인 사용자 간 운영 격리 | not_run | 직접 origin 및 두 사용자 세션 미제공 |
| Sites 게시 및 runtime tree | passed · real | 버전 20, 제품 tree 일치 |
| 운영 워커·설치 관리자 | passed · real | registered/activated/online/canInstall true, systemd active/running |
| 새 유료 모델·커넥터 호출 | not_run | 게시 검증은 읽기 전용, 실호출 비용 미발생 |

복구·공정 큐·terminal 오류·원장 후속 실패·기존 성과 버전 전환은 회귀 실패를 먼저 확인한 뒤 수정했다. 코드·보안 교차 리뷰에서 발견한 HIGH/MEDIUM은 보완했다. 커버리지 백분율은 측정하지 않았다.

### 운영 적용과 남은 경계 (버전20 게시 당시)

- `RESEARCH_WORKER_ADMIN_IDS`에 기존 운영 워커의 실제 소유자 ID를 secret으로 설정하고 게시했다. 로그인 사용자 canInstall=true를 확인했다.
- 기존 worker tick 자격증명은 유지했다. 게시 이후 heartbeat 및 systemd active/running, queue idle을 확인했다. 기존 Python 프로토콜과 호환하므로 재설치·재발급·재시작하지 않았다.
- 새 사용량 UI와 기존 워크스페이스 데이터 조회를 운영 브라우저에서 확인했다. 단가는 미등록이며 임의 가격을 넣지 않았다.
- gateway의 도구 강제 읽기 전용 권한·직접 origin·실사용자 간 격리는 추가 운영 검증 대상이다. 설치 파일의 공통 gate는 여전히 신뢰된 관리자에게 제공된다.
- workspace 전체 본문 전송은 호환을 위해 유지한다. 페이지네이션 최적화와 고객별 협업 권한은 이번 변경에 포함하지 않았다.

### 과거 실제 실행

[2026-09-23 관측 기록](observations/2026-09-23-live-run.md)에 실제 8역할·회의·브랜드 조사 및 바이럴 조사 결과가 있다. 모의 테스트 통과와 과거 실호출은 별개의 근거다. 해당 문서의 총 18건 표에는 실패 1건이 포함되므로 모두 완료한 18건으로 해석하지 않는다. 강화된 품질 게이트 이후의 실호출 및 원문 경로 개선의 운영 게시 여부는 별도 확인한다.
