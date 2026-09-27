# 2026-09-27 레인 A: 성장1 종료 판정 기록 (중간)

기준: [공통 종료 기준](../GROWTH-1-CLOSEOUT.ko.md). 레인 A가 판정을 모은다(8절 5항). **이 기록은 중간 판정이다.** 레인 G의 필수 PR이 병합되고, 최종 묶음이 게시되고, 레인 G·Q 근거가 모이면 같은 파일을 갱신한다.

비유: 공사 준공 검사표다. 우리 공정(레인 A)은 도장까지 찍었다. 다른 공정(레인 G)의 배관 몇 곳은 아직 시공 중이라 준공 도장은 보류한다. 입주 뒤 확인할 것(실제 주문·효과)은 별도 칸에 담당과 날짜를 적었다.

## 0. 판정 시각과 기준 상태

- 판정 시각: 2026-09-27 21:51 KST (12:51 UTC)
- 최종 main: `66c2ad4` (docs #222까지)
- 게시 제품: `b64bc06` / tree `0d426125eff1f3e926537daf29dcd5ef9418f8af`, Sites 버전 49([기록](../releases/2026-09-27-b64bc06.md)). 운영 `/api/version` tree 일치(소유자 Chrome, real)
- 미게시 제품 변경(main에 있고 운영에 없음): #208(레인 R), #210·#211·#213·#214·#220(레인 G). 그래서 main 기준 `runtime-verified`가 아니다. 운영 `/api/context-replay`가 404인 것이 이 차이 때문이다(#220 미게시)
- 레지스트리(별도): promptManifest `41dc8d632bf9`, A1 `channel.offline@a6df00903daa` promote 뒤 `registry-active`(레인 Q 기록). 열린 경보 0

## 1. 세 가지 판정 (중간)

| 판정 | 결과 | 사유 |
|---|---|---|
| 개발 종료 | **blocked** | 레인 G 필수 PR 미병합: #216(C06), #217(C05), #218(C07), #219(C03 loop-2). 레인 Q C07 평가 연결 PR은 #218 뒤. 최종 묶음 미게시(main에 미게시 제품 변경 #208·#210·#211·#212·#213·#220·#223, 레인 A #226 병합 대기). 게시 뒤 감시(레인 Q)는 게시 시각부터 시작 |
| 운영 인수 | **blocked** | 실제 주문 0건(주문 CSV·추적 코드·POS 합계 0, 2026-09-27 real). 첫 실게시 `not_run`(결정 16). A8 실제 보고서 `not_run`(입력 없음, 스위치 꺼짐) |
| 효과 검증 | **not_run** | 관측 기간 미충족. 개선 루프 전후 14일 비교는 2026-10-11부터 닫을 수 있음. 주간 다이제스트 2회 미생성(C05 미병합) |

레인 A 소유 필수 결함 수: **0**(C02·C11·C12 중 레인 A 몫). 미처리로 확인된 `ux-12`는 #226으로 구현했다(병합·게시 대기). 레인 G의 미병합 필수 PR 4개(#216·#217·#218·#219)는 개발 종료를 막는 미완료다. 레인 Q 몫은 [레인 Q 기록](2026-09-27-lane-q-growth1-closeout.md)에 있다.

## 2. 4절 공통 검사 (최종 main `66c2ad4`, 2026-09-27 21:4x KST, 로컬)

| 명령 | 결과 |
|---|---|
| `node scripts/test.mjs` | passed · mocked (179/179 스위트, 12,458 assertions) |
| `node node_modules/typescript/bin/tsc --noEmit` | passed (exit 0) |
| `node scripts/lint-gate.mjs` | passed (errors 70·warnings 39, 기준선과 같음) |
| `node scripts/check-prompts.mjs` | passed (exit 0) |
| `node scripts/run-framework.mjs build` | passed (exit 0) |
| `python3 tests/research_worker_test.py` | passed · mocked (13 tests) |
| `python3 tests/research_install_test.py` | passed · mocked (70 tests) |

- `e2e-smoke`는 CI에서 비차단이다. 레인 A 변경의 E2E는 PR별로 적는다: #202에서 A8 모바일 E2E 1건이 일시 실패했고 재실행 run `36313651979`에서 passed였다(변경과 무관, 서버 Broken pipe).

## 3. 레인 A 기능별 행 (8절 4항 서식)

| C-ID/기능 | 담당 | PR·최종 소스 SHA | 검사 결과·증거(real/mocked) | published/runtime-verified/registry-active 근거 | 현재 스위치·사용 범위 | blocked/not_run·이유·다음 확인일 | 후속 소유자/재개 조건 |
|---|---|---|---|---|---|---|---|
| C02 A3 카피 팩 v2 | A | #121·#129·#148·#160·#170, main `66c2ad4` | 단위 `copy-pack`·`copy-pack-runtime`·`meeting-copy-pack`·`artifact-experiment` passed · mocked. 종료 조건 5회째 run `86349108` passed · real(Sites 44, 국밥 12/0·수학학원 11/0) | #170까지 Sites 44 published·runtime-verified. 이후 #202(렌더 표기)는 Sites 48 | `a3_copy_pack` 기본 꺼짐 → **운영 켜짐**(2026-09-27 04:49 UTC, 대표 지시) | `+channels-close` 보정은 5회째에서 쓰이지 않음(두 원문 모두 바로 JSON) — 결함 아님 | A. 재실패 시 COPY-PACK 절차 |
| C02 A3 브랜드 말투 | A | #129 | `brand-voice` passed · mocked | Sites 40 이후 게시 | `a3_brand_voice` 기본 꺼짐·운영 꺼짐 | 실제 말투 확정·실행 `not_run`: 대표가 확정 말투를 입력하지 않음. 다음 확인일 2026-10-04 | A. 대표 말투 확정 뒤 스위치 결정 |
| C02 A6 자료 요청 | A | #130·#137 | `data-requests` passed · mocked. 종료 조건 passed · real(2026-09-27 00:56 KST, `dr-f08c16186f08` 사실 확정으로 closed) | Sites 40 이후 | `a6_data_requests` 운영 켜짐 | — | A |
| C02 A6 플레이스 점검 | A | #133 | `place-check` passed · mocked | Sites 40 이후 | `a6_place_check` 기본·운영 꺼짐 | real `not_run`: 켜기 결정 없음. 다음 확인일 2026-10-04 | A. 대표 켜기 결정 |
| C02 B3 교정·주입·평가 계보 | A | #162·#165·#166·#167·#189, #202 | `playbook-signals`·`eval-preference-pair`·`playbook-attach-eval` passed · mocked. 4단계 종료 조건 1~8단계 passed · real([기록](2026-09-27-lane-a-b3-stage4.md)): 규칙 `playbook:24e71fa4` active v2, 쌍 평가 `3fb5122b` 게이트 통과·봉인 회귀 0, ODA CMO 재작성 주입, `byRule` 캠페인·브랜드 범위 확인 | Sites 43(B3)·46(#189)·48(#202) published·runtime-verified | `b3_playbook_signals` 운영 켜짐. 규칙 1건 active(ODA, 만료 2026-11-26) | — | A. 규칙 만료 전 재확인 2026-11-19 |
| C11 B4 1·2부 보상 계보 | A | #155·#157·#159·#189 | `reward-lineage*`·`improvement-loops*` passed · mocked. 브랜드 범위 판정 결함 real 발견·수정(#189) 뒤 Sites 46에서 `?brandId=oda` byRule 확인 real | Sites 42·43·46 | `b4_reward_lineage` 운영 켜짐(대표 지시 D9) | L3·L4 **blocked**: 실제 주문 0건(중단 규칙 앞당긴 판정, [기록](2026-09-27-lane-a-b4-stop-rule.md)). 개선 루프 1건 open, 닫기 가능일 2026-10-11 | A. 실제 주문 CSV 1건 이상 → 4단계 해제 |
| C11 A8 고객 보고서·사실 팩 | A | #150·#152·#153 | `customer-report`·`customer-report-server`·`fact-pack` passed · mocked. E2E `e2e/customer-report.spec.ts` passed(CI) | Sites 42 이후 | `a8_customer_report` 기본·운영 꺼짐(운영 GET 409 안내 real 확인) | 실제 보고서 `not_run`: 끝난 주의 실제 주문·POS 합계 없음. 다음 확인일 2026-10-04 | A·운영 담당. 실제 주문 입력 뒤 6절 실행 |
| C12 최종 diff 삭제 대조(레인 A 몫) | A | main `66c2ad4` | 2026-09-20 이후 main 파일 삭제 4건 대조: #65 맥락 리플레이 9파일(사고, #220 복원, 미게시), #63 `app/channel-panel.tsx`(`app/panels.tsx`로 이동, 의도), #80·#35 테스트 픽스처 교체(의도). 레인 A 라우트 8·테스트 19 main 존재 확인 | — | — | #220 게시 전 운영 `/api/context-replay` 404 | G(C08). 다음 묶음 게시 |
| C01 공통 기반(레인 A 몫) | A·Q | main `66c2ad4` | 2절 공통 검사 passed. 개선 계획 매핑 lost 0, unmapped 1건은 #226으로 닫음(4절) | Sites 49 | 운영 스위치 목록(아래 5절) | #226 병합·게시 필요 | A |

## 3-G. 레인 G 기능별 행 (레인 G 제출, 2026-09-27 22:1x KST)

레인 G가 보낸 행이다. 검사는 레인 G 보고다(fetch 스텁·메모리 SQLite는 mocked, E2E는 real Chromium·mocked 인증). published 칸은 레인 A가 게시 뒤 채운다. 기본 다음 확인일은 게시 창 다음 날 2026-09-28이다.

| C-ID/기능 | 담당 | PR·최종 소스 SHA | 검사 결과·증거 | published/runtime-verified | 현재 스위치·사용 범위 | blocked/not_run·이유·다음 확인일 | 후속 소유자/재개 조건 |
|---|---|---|---|---|---|---|---|
| C03a loop-1·security-ops-5 | G | #213 `877e874` | test 169/169, measurement-status 52·UI 16, 학습 E2E 2/2, 새 서버 테스트 RED 확인 | 미게시 | `collect_guard` 꺼짐(실패 분류·카드 경고·알림은 항상), collect는 대표·관리자(직원 403) | not_run: 실제 네이버·Instagram 인증 오류 응답, Instagram 토큰 자동 갱신(앱 비밀값·교환 흐름 없음). 2026-09-28 게시 뒤 수집 버튼 운영 확인 | G / 커넥터 실계정 연결 뒤 |
| C03b loop-2 | G | #219 미병합 | test 181/181(병합 전), publication-link 35·UI 7, 실패 사례 9종 | 미병합 | `publication_auto_link` 꺼짐(꺼지면 Buffer 조회 0), 대표·관리자 | not_run: Buffer 게시 ID 자동 취득(응답 필드 미확인 → 수동 입력 기본), 실 Buffer·Instagram. 병합 뒤 2026-09-28 | G / 첫 실게시(결정 16) 뒤 |
| C04 A4-4 PNG | G | #212 `da7983d`(merged) | test 176/176, png-code 50, 변이 8, E2E execution 2/2 real Canvas | 미게시 | `a4_png_code` 꺼짐 | 한계: 서버는 파생 이미지 내용 검증 불가(크기·구조·코드 일치, 사람 확인 체크), QR 없음. 운영 not_run, 2026-09-28 | G / 점포 게시 코드 실사용 시 |
| C05 B2 2단계 | G | #217 미병합(`cd68be2`, CI 대기) | test 182/182, digest-queue 47·usage-table 15, 변이 11, E2E 2/2 | 미병합 | `b2_digest_queue` 꺼짐, 품질 표 대표·관리자 | not_run: 운영 D1 창 함수·json_each, 실제 처리 시간. κ는 라벨 0이라 insufficient. 2026-09-28 | G(코드)·Q(κ 라벨) / 라벨 20건 |
| C06 Reflector | G, A 인터페이스 검토 | #216 미병합(`cbbb96e`) | test 168/168, reflector 76, 차단 5종 변이. 레인 A 리뷰 막을 문제 없음(#216 댓글) | 미병합 | `b3_reflector` 꺼짐, 대표·관리자 | blocked(실호출): DATA-PROCESSING 7절 사람 확인(메모리 off·법률), 격리 프로필 미등록, ODA 교정 3건 not_eligible. 2026-10-11 | 대표(격리·법률) → G 실검증 / 교정 5건 + 격리 확인 |
| C07 입력 축소 | G(코드)·Q(평가) | #218 미병합(`59ab865`) | test 168/168, input-diet 128, 꺼짐 바이트 동일(prompt-baseline 등) | 미병합 | `input_diet` 꺼짐 | not_run: on/off 쌍 평가 연결(레인 Q 작업 중), eval-capture 드리프트 수정 필요. 켜기 금지 | Q / 쌍 평가 비회귀 |
| C08 B5 리플레이 복원 | G | #220 `a2b8b48` | test 172/172, 복원 테스트 167·43·52 | 미게시(운영 404) | 스위치 없음, `/api/context-replay` 대표·관리자, 통계만 | not_run: 운영 GET(게시 뒤), 2026-09-28 | G |
| C09 키 버전·회전 | G | #211 `97da209` | test 168/168, credential-crypto 53(실 WebCrypto), 변이 3. 레인 A 하위 호환 확인(옛 형식 읽기·꺼짐 무변경) | 미게시 | `crypto_v1_write` 꺼짐, 선택 env `AGENCY_ENCRYPTION_KEYS` | not_run: 운영 키 회전. 범위 밖: 평가 연결(Q)·가맹 연락처(R)·Reflector 연결은 옛 형식이라 `AGENCY_ENCRYPTION_KEY` 회전 불가 | 대표(키·스위치)·Q·R(확대) / 게시 안정 뒤 |
| C10 커머스·감사 콘텐츠 | G(콘텐츠)·Q(평가) | #210 `acb7b00`, #214 `3ef5df1` | #210 계약 26건, #214 specs 20건·봉인 업종 없음 검사 | 미게시(#214는 비제품) | 레지스트리 미활성(코드 상수 운영) | 한계: '자사몰'·'팬덤 플랫폼' 문구로는 commerce가 켜지지 않음(코드 PR 필요). viral.discovery는 pairPrompts 거부로 활성화 불가(5절). 레인 Q 봉인 반복 진행 중 | Q / 봉인 3회 과반 |
| C12 비식별 채점기 버전 | G | #206 `1a9421d` | test 167/167, 신호 89, RED 확인 | published · runtime-verified(Sites 49, `b64bc06`) | 스위치 없음 | not_run: 이미 null로 저장된 건수(운영 D1 조회), 2026-09-28 | G / 소유자 세션 |

- 레인 G 몫 5절 인계: Reflector 실호출(대표 → G, 교정 5건 + 격리 프로필·메모리 off, 2026-10-11), 실제 키 회전·Q/R 확대(대표 + Q·R, 게시 안정 뒤, 2026-09-28), 공급자별 자동 갱신·게시 ID 취득(G, Instagram 앱 비밀값·Buffer 응답 필드, 첫 실게시 직후).
- #131·#135(오래된 운영 기록, C12)는 레인 Q 소유다. 레인 Q 처리 결과를 받아 적는다.

## 3-R. 레인 R 인계 (레인 R 제출)

- 기록: [레인 R 성장1 인계](2026-09-27-lane-r-growth1-handoff.md)(#228 `5daa73f`). 트랙 R 전체 종료는 성장1 종료 조건이 아니다(1절 3항).
- C12 레인 R 몫: main `431e417`에서 `node scripts/test.mjs` passed · mocked(184/184), 레인 R PR 21개(#173~#209)에서 레인 밖 파일 삭제·라우트 유실 0건(레인 R 보고).
- 5절 Q/R 키 확대 레인 R 몫: 가맹 연락처 암호화 키·HMAC 중복 키 회전 `not_run`(R8 발동 조건인 결정 28 없음). 다음 확인일 2026-10-05, 그 전까지 `AGENCY_ENCRYPTION_KEY` 불변.
- 이미 해소된 항목: `tests/check-prompts.test.mjs` macOS 대소문자 충돌은 #161에서 해소됐다(레인 A가 macOS에서 다시 실행해 passed). STATUS 레인 A 칸의 해당 줄은 지웠다.

## 4. 개선 계획 배정 90건 매핑

전체 표: [개선 계획 매핑](2026-09-27-lane-a-improvement-map.md)(95행, ID와 저장소 경로만, 감사 원문 없음). 기준 main `11c3839`.

| 판정 | 건수 |
|---|---|
| present(병합 PR + 최신 main 코드·테스트 존재) | 85 |
| absorbed(`eng-hygiene-12` → `ux-5`, #61) | 1 |
| open-pr | 3 |
| lost | **0** |
| unmapped → 레인 A가 닫음 | 1 |
| excluded | 4 |
| refuted(`data-truth-6`) | 1 |

- open-pr 3건은 레인 G PR에 걸려 있다: `loop-2`(#219), `loop-10`·`ai-quality-9`(#218). C03b·C07 행과 같다.
- `ux-12`(unmapped)는 공개 계획 PR 5 범위 중 대응이 없는 '재실행 영향 설명'이다. 레인 A가 #226으로 구현했다(다시 작성 전 영향받는 작업물 표시). ID↔항목 대응은 비공개 감사 원문으로만 확정된다.
- 근거가 약한 present(범위 표기로만 인용된 `auth-11`·`ai-quality-3`·`-5`·`-11`·`-12`·`data-truth-5`·`exec-loop-5`·`eng-hygiene-1`·`-2`·`-4`)는 결함이 확인된 것이 아니어서 다시 구현하지 않는다(3절 '새 전수 재개발 아님'). 문서에 부분 해결로 적힌 `auth-1`·`auth-10`(민감 작업 재인증)·`auth-3`(Turnstile·기기 쿠키)은 기존 결정대로 후속이다.
- 3절이 5절 인계를 요구한 누락분: `security-ops-5` ③ Instagram 토큰 자동 갱신(#213 제외), `security-ops-6` 운영 키 회전(#211 not_run). 둘 다 3-G 절 레인 G 인계 행에 있다.

## 4-Q. 레인 Q 몫과 게시 뒤 감시

- 레인 Q 기록: [2026-09-27 레인 Q 성장1 마감](2026-09-27-lane-q-growth1-closeout.md)(#224). C01 과반 게이트(#178), C07 평가 연결(진행 중, 다음 확인 2026-09-29), C08 #220 인터페이스 확인 passed · mocked, C10(`channel.offline` promoted · registry-active, commerce·shortform 봉인 반복 중, `viral.discovery` 등록만), C12 #131·#135 대체 기록.
- 5절 레인 Q 행: R4 대표 라벨(2026-10-04), A/A(2026-10-01), R5(2026-10-04), J4(R5 뒤), 입력 축소 활성화(2026-09-29), `viral.discovery`(2026-09-30), commerce·shortform(2026-09-28).
- 게시 뒤 감시(4절 7항): 레인 Q가 인수한다. 기준선은 운영 HERMES 직전 20건 중 invalid_output 1건(5%, real)이다. 중단 조건은 게시 뒤 20건 중 3건 이상이다. 기간은 마지막 제품 묶음 게시 시각부터 72시간이다.
  - Sites의 5xx·Workers CPU 지표는 레인 Q와 레인 A 모두 볼 경로가 없다(Sites 관리 화면은 대표 ChatGPT 계정 안에 있다). 대표 캡처 전까지 이 두 지표는 `blocked`이다. 공개·소유자 `/api/version` 응답으로 가용성만 대체 확인한다.

## 5. 운영 기본 상태 (4절 6항, 2026-09-27 21:4x KST, 소유자 Chrome, real, 읽기만)

- 소유자 세션: `/api/version` 200, `/api/workspace` 200(브랜드 4·캠페인 3·작업물 22).
- HERMES 연결: configured, `HERMES · hermes-agent`, 다시 등록 필요 표시 없음.
- 조사 워커: registered·activated·online, blocked 0.
- 역할·회의: ODA 캠페인 회의 목록 200(1건). 역할 작업물 목록 정상.
- 주문·보고 조회: `/api/stores` 200(1지점), 지점 측정 목록 조회 가능. 고객 보고서 409(스위치 꺼짐 안내, 의도). 보상 계보 200(enabled).
- 새 API 상태: `/api/context-replay` 404(#220 미게시). Reflector·digest·PNG는 미병합이라 운영에 없음.
- 운영 스위치(`*` = 운영 override): `online_grading=on*`, `a7_repair_turn=on*`, `a3_copy_pack=on*`, `a6_data_requests=on*`, `b4_reward_lineage=on*`, `b3_playbook_signals=on*`. 나머지(`b1_reason_required`·`a4_auto_attribution`·`a2_downgrade`·`r_franchise`·`a3_brand_voice`·`a6_place_check`·`a8_customer_report`)는 꺼짐.

## 6. 조건부 인계 (5절, 레인 A 담당 행)

| 항목 | 상태 | 원인 | 이미 된 것 | 담당 | 재개 조건 | 다음 확인일(KST) | 한도·권한 | 영향 기능 | 후속 기록 |
|---|---|---|---|---|---|---|---|---|---|
| A5 재방문 CRM | not_run | 실제 주문·고객 식별/동의·철회·데이터 처리 조건 미충족 | 없음(성장1에서 만들지 않음) | A | 실제 주문과 동의 경로, DATA-PROCESSING DP-8 충족 | 2026-10-15 | 새 착수는 대표 승인 | 재방문 지표 | STATUS 레인 A |
| B5 GEPA·B4 3부 | not_run | 원안의 표본·평가·비용·데이터 조건 미충족 | B4 1·2부 코드·운영 켜짐, B5 리플레이는 C08(#220)로 별도 | A·Q | 원안 발동 조건 확인 | 2026-10-15 | 평가 토큰은 건별 승인 | 자동 프롬프트 개선 | STATUS 레인 A·Q |
| 실제 게시·주문/POS·A8 검토 | blocked | 실제 게시 계정·승인, 실제 주문·POS 합계 없음 | 코드·화면·권한 passed · mocked, 중단 규칙 판정 real | A·운영 담당 | 허용된 실제 게시 1건, 실제 주문 1건 이상 기록, 끝난 주 POS 합계 | 2026-10-04 | 게시·지출·고객 발송은 대표 승인 | L2·L3·L4, A8 | 6절 운영 인수 행 |
| 승인율·폐기율·귀속률·누적 개선 루프 | not_run | 관측 기간·표본 미충족 | 보상 계보 켜짐, 개선 루프 1건 open | A·Q | 원안 표본·기간 | 2026-10-11(개선 루프 닫기 가능일) | 가짜 주문·시험 데이터 제외 | 효과 검증 | 이 파일 갱신 |

## 7. 운영 인수 (6절, 레인 A 관점 중간)

| 항목 | 결과 | 근거 |
|---|---|---|
| 산출물·교정·자료 요청 | passed · real | ODA CMO 사유 있는 반려 → 재작성 → 승인 규칙 주입(v2) → 대표 승인(2026-09-27). 자료 요청 → 사실 확정으로 닫힘(A6, 2026-09-27) |
| 게시·성과 수집 | not_run | 첫 실게시 없음(결정 16). #213 수집 경로 미게시, #219 미병합 |
| 주문·비용 | blocked | 실제 주문 0건 |
| 보고서 | not_run | A8 스위치 꺼짐·실제 입력 없음 |
| 품질·비용·복구 | 대기 | 최종 묶음 게시 뒤 레인 Q 24~72시간 감시 인수 필요 |

## 8. 성장2가 재사용할 것과 아직 쓸 수 없는 것 (중간)

- 재사용 가능(운영 켜짐·real 확인): 카피 팩 v2, 자료 요청, 운영자 선호 규칙(교정 신호·쌍 평가·첨부), 보상 계보(L0·L1, 브랜드·캠페인 범위), 프롬프트 레지스트리 과반 게이트.
- 아직 못 씀: 실주문 기반 L3·L4, A8 실제 보고서, 성과 자동 수집(#213 미게시·#219 미병합), Reflector·digest·PNG 추적 코드·입력 축소(미병합).
- 첫 허용 작업(7절): 성장1 마감 중에는 시장·고객 조사, 판매 가능 상품·원가 확인, 첫 오퍼 준비, 데이터·인터페이스 설계까지만.
