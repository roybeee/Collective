# 글로벌 도약 6차 통합 독립 재평가 (2026-11-15)

- 평가자: 독립 QA 세션(Claude). 최근 기능을 만들지 않았고, 실행한 결과로만 판단한다.
- 대상: `integrate/wave6-work` `4b0248f`(2026-11-09 평가 대상 `integrate/wave4` `5c1a253` 이후 22커밋). 빌드 `node scripts/run-framework.mjs build` 종료 코드 0.
- 환경: 로컬 E2E 서버(`E2E_PORT=8873 node e2e/serve.mjs`, wrangler --local, 빈 로컬 D1), mocked 인증 헤더, macOS 실제 Chromium, axe-core 4.11.4. 운영 D1·외부 계정에는 접속하지 않았다.
- 감사 소유자에게 `/api/feature-flags`로 등록된 스위치 53개를 모두 켰다(53개 모두 200, 11-09보다 `compliance_fixes` 1개 늘었다).

## 1. 결론

**12차원 평균은 4.33에서 4.50으로 돌아온다(+0.17).** 11-09에 4점 조건을 깨뜨린 접근성·모바일 결함(D1~D6)이 모두 고쳐졌다.

- **axe는 11개 조합 220화면 전부에서 critical·serious·moderate·minor 0이다.** 11-09에는 light 조합마다 serious 17·critical 1이 있었다.
- **가로 넘침도 0이다.** 9개 너비 조합(390·1280 × ko·en × light·dark, 640×400 확대)과 이번에 처음 잰 320px 22화면 모두 해당한다.
- **⑧ 모바일·⑨ 접근성을 3.5에서 4.5로 올렸다.**
  - D9(키보드 과업 3 실패)는 앱 결함이 아니다. macOS Chromium의 기본 select가 ArrowDown에 값을 바꾸지 않는 플랫폼 동작임을 재현으로 확인했다.
  - 같은 과업은 Linux CI(`43617154956`)에서 모바일·데스크톱 모두 통과했다.
- **D8은 실제 경로에서 고쳐졌지만 다른 원인의 400이 남는다.**
  - 실제 API로 만든 자료(UUID id)로는 성장·판매 탭에 4xx가 0이다(데스크톱·모바일).
  - 시장 자료 1건의 id에 13자리 숫자가 있으면 개인정보 검사기가 카드번호로 오인한다. 그러면 `GET /api/growth/signal-sources`가 목록 전체를 400으로 돌린다.
  - 이 id 모양은 저장소의 `e2e/trust-ui.spec.ts` 시드와 같다. 화면에는 사실과 다른 "접근 권한을 확인" 안내가 뜬다(N3).
- **패턴은 있음 14 · 부분 1(P5)이다.** 11-09에는 있음 10 · 부분 5였다. 글로벌 12기능은 있음 7 · 부분 5로 변화가 없다.
- **영어·일본어는 셸·홈·캠페인 탭·제작·발행·설정이 번역됐다.** 남은 곳은 세 가지다.
  - 작업물 대화상자의 신뢰 UI(규정 점검·근거 표시·AI 작성 배지)
  - 서버가 만드는 안건 제목
  - 점검 시각 형식('11. 15. 오전 02:27')
  - 그래서 D7은 '부분 해결'이다. ja 홈의 한글 비율은 43.7%, ja 작업물 대화상자는 43.3%다.
- **새 결함 중 눈에 띄는 것은 두 가지다.**
  - 모바일 머리 띠 경로가 글자 중간에서 끊긴다: 'MEALZ IP', '워크스페 이스', 320px에서는 'ME/AL/ZI/P'. 4언어 공통이다(N1).
  - 일반 광고 문안의 '업계 최고 … 보장합니다'가 규정 점검을 통과한다. 최상급 규칙이 가맹 모집 분류에만 있다(N7).

## 2. 자동 접근성·배치 감사

### 2.1 범위와 방법(11-09와 같게 맞춘 것, 바꾼 것)

- 스크립트는 `scripts/ux-audit.mjs`를 워크트리의 git 무시 폴더(`e2e/artifacts/qa2/audit.mjs`)에 확장해 돌렸다. 커밋하지 않았다.
  - 11-09 스크립트는 워크트리와 함께 지워져서 같은 화면 목록과 계측 항목으로 다시 썼다.
- 화면은 11-09와 같은 22개다.
  - 홈, 캠페인 목록, 캠페인 상세 9탭, 작업물 대화상자
  - 설정 6탭
  - 점포 마케팅, 상품 리서치, 가맹 모집, 바이럴 학습
- 조합:
  - 11-09와 같은 8개: ko·en × light·dark × 데스크톱 1280×800·모바일 390×844
  - 200% 확대: 640×400, ko·light
  - 이번에 더한 것: ja·light 데스크톱·모바일(홈 + 캠페인 상세 9탭 + 작업물 대화상자 = 11화면), 320×568 ko·light 22화면
- 합성 데이터(한 소유자, 스위치 53개 켬):
  - 지점 캠페인, 상품·오퍼·미션·시장 근거·니즈, 확정 사실
  - 약속 기한이 지난 고객 문의, 최근 7일 주문 35건과 신호 감지
  - 수동 작업물 1건
  - AI 작업물 1건: 브랜드 자료 ref·확정 사실 ref, '영수증 리뷰 이벤트' 차단 문장, 실행 기록 2건
  - 발행 승인 대기 1건, 끝난 회의 1건(확인할 사실 질문), 자료 요청 1건
  - 안건 응답 9건: 기한 초과 1, 결정 4(발행·작업물 2·자료 요청), 질문 1, 신호 3. 결정·질문·알림 탭이 모두 찬다.
- 바꾼 계측: 자체 대비는 색을 canvas로 sRGB로 바꿔 계산한다.
  - 11-09 계측기는 dark 토큰(`lab()`·`oklch()`)을 읽지 못했다. 이번에는 dark도 잰다.
  - 흰 글자/흰 배경 버튼 1:1, `#999` 12px, dark의 `oklch(0.3 0 0)` 글자를 주입해 light·dark에서 실패로 잡히는지 먼저 확인했다(`e2e/artifacts/qa2/sanity2.mjs`).
  - axe는 1:1 대비를 'incomplete'로만 내므로 D1 같은 결함은 자체 계측기로만 잡힌다.

### 2.2 axe 위반 노드 수(조합별 합계)

| 조합 | 화면 | critical | serious | moderate | minor | 11-09 (c/s/m/mi) |
|---|---|---|---|---|---|---|
| ko · light · 데스크톱 | 22 | 0 | 0 | 0 | 0 | 1/17/0/1 |
| ko · light · 모바일 | 22 | 0 | 0 | 0 | 0 | 1/17/0/1 |
| ko · dark · 데스크톱 | 22 | 0 | 0 | 0 | 0 | 1/2/0/1 |
| ko · dark · 모바일 | 22 | 0 | 0 | 0 | 0 | 1/2/0/1 |
| en · light · 데스크톱 | 22 | 0 | 0 | 0 | 0 | 1/17/0/1 |
| en · light · 모바일 | 22 | 0 | 0 | 0 | 0 | 1/17/0/1 |
| en · dark · 데스크톱 | 22 | 0 | 0 | 0 | 0 | 1/2/0/1 |
| en · dark · 모바일 | 22 | 0 | 0 | 0 | 0 | 1/2/0/1 |
| ko · light · 640×400(200%) | 22 | 0 | 0 | 0 | 0 | 측정 안 함 |
| ko · light · 320×568 | 22 | 0 | 0 | 0 | 0 | 측정 안 함 |
| ja · light · 데스크톱 | 11 | 0 | 0 | 0 | 0 | 측정 안 함 |
| ja · light · 모바일 | 11 | 0 | 0 | 0 | 0 | 측정 안 함 |

axe가 실제로 위반을 잡는지 같은 화면에 위반을 주입해 확인했다(`e2e/artifacts/qa2/sanity.mjs`). 결과는 image-alt critical·listitem serious·aria-allowed-role minor·color-contrast serious(#999)였다.

### 2.3 대비·터치·넘침·확대

| 항목 | 결과 | 판정 |
|---|---|---|
| 자체 대비 실패 light | 0/3,028(ko 데스크톱), 0/2,325(ko 모바일), en 0/3,025·0/2,320 | 충족(11-09: 17건, 1.00:1 승인 버튼 포함) |
| 자체 대비 실패 dark | 0/3,028(ko 데스크톱), 0/2,325(ko 모바일), en 동일 | 이번에 처음 측정, 충족 |
| 모바일 44px 미만, 프로젝트 예산 규칙(`e2e/ux-budget.spec.ts:16`, 체크박스·라디오 제외) | 8/805(99.0%), ja 8/453(98.2%) | 4점 조건 98% 충족 |
| 모바일 44px 미만, 모든 컨트롤 포함 | 17/814(97.9%) | 98%에 0.1%p 미달. 미달 17개 중 9개는 22×22 선택 체크박스다(감싼 label은 30×44) |
| 모바일 미달 목록 | 인박스·제작·상품 리서치 체크박스 22×22 ×9, 회의 발언 '접기' 36×44 ×5(새 P2 화면), 대화상자 버튼 32×44, 인용 pill 43×44, '원본 PNG 내려받기' 119×19 | N4 |
| 데스크톱 24px 미만 | 17/1,198(ko), 18/1,199(en) | 11-09의 68개에서 줄었다(D11 대부분 해결). 남은 것은 아래 |
| 데스크톱 24px 미만 목록 | 인박스 체크박스 18×18(label 26×18), 대화상자 닫기 16×16, 인용 pill 높이 22, '자세히' 30×22, 원본 PNG 링크 높이 19 | axe `target-size`는 간격 예외로 통과. N4 |
| 모바일 390 가로 넘침 | 0/22, 4조합 모두(홈 문서 폭 390) | 충족(11-09: 홈 489px) |
| 320px 가로 넘침 | 0/22 | 5점 조건 충족 |
| 200% 확대(640×400) 넘침 | 0/22 | 충족 |
| 헤딩 건너뜀 | 0(모든 조합) | 충족 |
| 응답 ≥400 | 220화면 중 `GET /api/execution/asset?id=qa2-creative` 404 1건(조합마다) | 내 시드가 R2 파일 없이 소재 기록만 넣은 탓이다. 앱 결함 아님 |
| 콘솔 오류 | 위 404 1건뿐 | 성장·판매 탭 오류 0(UUID 자료) |

### 2.4 번역 범위(같은 화면의 한글 글자 비율, 데스크톱 light)

합성 데이터(캠페인·작업물 제목, 브랜드 이름)가 한국어라 0이 될 수는 없다.

| 화면 | ko | en(11-09 → 이번) | ja(한글 / 가나·한자) |
|---|---|---|---|
| 홈 | 75.8% | 29.6 → 33.3% | 43.7% / 33.8% |
| 캠페인 목록 | 57.1% | 20.5 → 16.9% | – |
| 캠페인 브리프 | 84.3% | – → 16.8% | 27.6% / 58.0% |
| AI 팀 | 90.1% | 77.4 → 27.8% | 42.8% / 48.2% |
| 작업물 탭 | 80.2% | – → 10.6% | 18.8% / 64.0% |
| 작업물 대화상자 | 90.2% | 70.6 → 28.1% | 43.3% / 47.9% |
| 제작·발행 | 81.2% | 76.3 → 9.0% | 16.3% / 67.3% |
| 성장·판매 | 90.4% | – → 60.2% | 72.2% / 18.5% |
| Meta 광고 준비 | 91.2% | 78.9 → 65.7% | 76.0% / 15.4% |
| 설정 · 팀·권한 | 74.0% | 3.9 → 3.9% | – |

- 많이 나아졌다. 캠페인 탭 머리·작업물 탭·제작·발행·설정 채널은 en/ja에서 화면 문구가 거의 번역된다.
- 남은 한국어 문구:
  - 작업물 대화상자 신뢰 UI:
    - `components/app/compliance-panel.tsx`: `useT` 없음, `aria-label="규정 점검"` `:25`, '다시 점검', '통과·주의·차단', '법령 근거'
    - `components/app/confidence-label.tsx:10`: '근거 있는 문장 2/5', '확정 사실 인용 1건'
    - 인용 pill '자료 1'·'사실 주소', '근거 없음', 'AI 작성' 배지, '직접 등록'
  - 점검 시각이 en/ja에서도 '11. 15. 오전 02:27'(ko 형식)이다.
  - 홈 안건 행 제목('발행 승인 대기', '브랜드 전략 작업물 검토 대기', '고객 문의 약속 기한 초과')은 서버가 한국어로 만든다(`lib/agenda-sources.ts:18`·`:28`).
  - 사이드바 바닥의 '워크스페이스 소유자 / 대표'가 한국어로 남는다.
  - 성장·판매·Meta 광고 준비·상품 리서치·가맹 모집 탭은 대부분 한국어다(가맹 탭 이름 `app/franchise-panel.tsx:78`). GLOBAL-PLAN G6 1차 범위(셸·홈·캠페인·작업물·설정) 밖일 수 있어 따로 적었다.

## 3. 이전 결함 D1~D14

| ID | 11-09 심각도 | 상태 | 근거(이번 측정) |
|---|---|---|---|
| D1 | critical | **해결** | 홈 결정 행 '승인'이 검은 바탕 흰 글자로 보인다. 자체 대비 실패 0/3,028(light)·0/3,028(dark). `ko-light-desktop-01-home.png`, `ko-dark-desktop-01-home.png` |
| D2 | high | **해결** | 390px 홈 문서 폭 390(11-09: 489). 체크박스·행 카드·버튼이 두 줄로 정돈된다. `ko-light-mobile-01-home.png` |
| D3 | high | **해결** | '검토 대기' 배지가 있는 12화면에서 axe color-contrast 0(light·dark) |
| D4 | high | **해결** | 가맹 모집 axe critical 0. `app/franchise-panel.tsx:79`에서 탭 내용을 `TabsContent`로 감쌌다 |
| D5 | medium | **해결** | `components/app/run-timeline.tsx:26`이 `div role="log"` 안에 `ol`을 둔다. listitem·aria-allowed-role 0. 타임라인 '완료 브랜드 전략 / 완료 콘텐츠 스튜디오' 관측(`ko-light-desktop-12b-team-timeline.png`) |
| D6 | medium | **해결** | dark AI 팀 탭 axe serious 0, 자체 대비 실패 0 |
| D7 | high | **부분 해결** | 2.4절. 셸·홈·캠페인 탭·제작·발행·설정은 번역됐다. 신뢰 UI·안건 제목·시각 형식은 그대로다(`en-light-desktop-20-artifact-dialog.png`, `ja-light-desktop-20-artifact-dialog.png`) |
| D8 | medium | **해결(실제 경로) / 다른 원인 잔존** | 4절 |
| D9 | medium | **앱 결함 아님으로 확정** | macOS 순수 HTML `<select>`에서도 ArrowDown 뒤 값 'respond' 유지, 글자 입력('reso')으로는 'resolve'(`e2e/artifacts/qa2/select.mjs`). Linux CI 실행 `43617154956`(e2e-smoke)에서 과업 3 모바일·데스크톱 통과(373 passed). 이번 macOS 실행은 여전히 2 실패. 테스트 이식성은 N6 |
| D10 | medium | **해결** | `e2e/ux-budget.spec.ts:139-145`가 스위치를 모두 켜고 검토 대기 작업물(긴 제목)·플레이스 초안을 시드한다. 이번 실행 6 통과·2 건너뜀(명세상 모바일 제외) |
| D11 | low | **대부분 해결** | 데스크톱 24px 미만 68 → 17. 인박스 체크박스 `.ui-check` 18×18(`app/globals.css:351`, label 26×18), 대화상자 닫기 16×16, 인용 pill 높이 22는 남았다 |
| D12 | low | **부분 해결** | '수정 제안'과 '선택한 수정 적용'이 생겼다(`components/app/compliance-fixes.tsx:23`, 스위치 `compliance_fixes`). 영수증 리뷰 규칙은 '직접 고쳐야 합니다'로 나온다. 준수율 %는 여전히 없다 |
| D13 | low | **해결** | 계획 카드 '약 38크레딧, 약 420원' + 환산 안내(`components/app/plan-card.tsx:18`) |
| D14 | low | **해결** | en 사이드바가 'MEALZIP / Marketing'으로 줄고 브랜드 목록이 가려지지 않는다(`en-light-desktop-01-home.png`) |

## 4. D8 재시험(성장·판매 탭, 모든 스위치 켬)

스크립트는 `e2e/artifacts/qa2/d8.mjs`(커밋 안 함)다. 새 소유자로 시드를 넣고 탭을 데스크톱·모바일에서 연 뒤 `/api/` 응답 ≥400을 본문과 함께 모두 기록했다.

- 시드: 스위치 53개 켬, 지점 캠페인, 상품 1개, `POST /api/archive add_source`로 만든 시장 자료 1건(id는 서버 `uid()` UUID).

| 단계 | 데스크톱 | 모바일 |
|---|---|---|
| 실제 API 자료(UUID id)만 | ≥400 응답 0, '확정 시장자료 가져오기' 영역 보임 | ≥400 응답 0 |
| 같은 소유자에 id `d8-src-1794677180051`(13자리 숫자 포함) 시장 자료 1건 추가 | `400 GET /api/growth/signal-sources?campaignId=1ff41d83-c9b7-4fd4-8330-f839e07614de` 본문 `{"error":"내부 식별자에 식별정보와 인증정보를 넣을 수 없습니다."}` | 같음 |

- 캠페인 기록 형태(로컬, 가림 없음)는 `{id:'1ff41d83-c9b7-4fd4-8330-f839e07614de', brandId:'ofd', storeId:'277380dd-c368-40c1-a182-606c64121781', title:'D8 재현', goal:'매운 세트 300개 판매', status:'draft', version:1, budget:null, startDate:'', endDate:'', plan:{…}, derivedStatus:'draft'}`이다. 요청 URL의 `campaignId`는 정상 UUID다. 11-09의 원인('캠페인 입력을 확인해 주세요', 빈 id)과 다르다.
- 서버가 400을 내는 이유는 다음과 같다.
  - `lib/growth-signal-source-server.ts:22`가 브랜드 시장 자료마다 `executionId(s.id)`를 부른다.
  - `executionId`(`lib/growth-execution.ts:14`) → `executionSafeText`(`:8-12`) → `scanText`(`lib/pii-scan.ts:126`)가 13자리 숫자를 `payment`(카드번호)로 판정한다.
  - 그러면 `GrowthExecutionError`가 나고 라우트가 400으로 바꾼다(`app/api/growth/signal-sources/route.ts`).
  - tsx로 확인한 판정: `qa2-src-1763220145000`과 `trust-src-desktop-1763220145000`은 `[{"kind":"payment","count":1}]`이고, 무작위 UUID는 20,000개 중 0개가 걸렸다.
  - 앱 코드에 임시 로그를 넣지 않고 이 경로를 직접 호출해 확인했다.
- 화면은 영역 안에 "자료 목록을 불러오지 못했습니다. 접근 권한을 확인한 뒤 다시 조회하세요."를 보인다. 실제 원인(자료 1건의 id 모양)과 다른 안내다(`d8-plus-13digit-id-desktop.png`).
- 판정:
  - D8(11-09 증상)은 실제 경로에서 해결됐다. 서버가 만드는 자료 id는 UUID거나 조사 단계 id + 번호(`lib/archive-research.ts:65`)라 보통은 걸리지 않는다.
  - 다만 자료 한 건 때문에 목록 전체가 막히는 구조와 틀린 안내는 결함으로 새로 적는다(N3).
  - 저장소의 신뢰 UI E2E 시드(`e2e/trust-ui.spec.ts`의 `trust-src-…-${Date.now()}`)를 성장 탭과 함께 쓰면 그대로 재현된다. 11-09 감사의 '모든 조합 400'도 이 시드 영향을 받았을 수 있으나 원문 메시지가 달라 확정하지 못했다.

## 5. 패턴·기능 재판정

판정은 모든 스위치를 켠 상태 기준이다. '관측'은 이번 감사 스크린샷이나 이번에 돌린 E2E다.

### 5.1 에이전트 UX 15패턴

| # | 패턴 | 11-09 | 이번 | 근거 | 남은 것 |
|---|---|---|---|---|---|
| P1 | 실행 타임라인 | 있음 | 있음 | `components/app/run-timeline.tsx:26`, 타임라인 '완료 브랜드 전략·완료 콘텐츠 스튜디오' 관측. 구조 결함(D5) 해결 | 단계 상세 접기 없음 |
| P2 | 팀 회의 뷰 | 부분 | **있음** | 참석자 열(상태 점+글자) `components/app/meeting-board.tsx:23`, 결정 카드 `:38`, A/B 선택 문장 `:37`, 발언 접기. 시드 회의에서 '1번째 발언(총괄 파트너) 접기' 등 관측. `e2e/ux-patterns-complete.spec.ts` 6/6 통과 | 진행 중 회의 실물은 mocked 응답으로만 확인 |
| P3 | 계획 먼저 승인 | 있음 | 있음 | `components/app/plan-card.tsx`, '약 38크레딧, 약 420원' 관측. `ux-plan-card` 6/6 | 없음 |
| P4 | 승인 카드 | 있음 | 있음 | `components/app/confirm-dialog.tsx`, `ux-inbox` 4/4 | 없음 |
| P5 | 리뷰·게시 승인 흐름 | 부분 | 부분 | 진행 단계 `components/app/lifecycle-stepper.tsx:11`(초안→검토 중↔수정 요청→승인→발행 예약→발행됨), 카드·대화상자 모두 관측 | 다단계 승인자·마감일·승인 뒤 수정 시 재승인 없음 |
| P6 | 버전 비교 | 있음 | 있음 | `components/app/version-diff.tsx`, `version-diff` 2/2 | 없음 |
| P7 | 인용 | 있음 | 있음 | `components/app/citation-pill.tsx`, '자료 1'·'사실 주소'·'근거 없음' 관측, `trust-ui` 2/2 | en/ja 미번역(D7) |
| P8 | AI 생성 라벨 | 있음 | 있음 | `components/app/ai-origin-badge.tsx`, `lib/ai-disclosure-image.ts` | C2PA 없음(`lib`·`components`·`app`에 c2pa 0건) |
| P9 | 신뢰도 표시 | 있음 | 있음 | `components/app/confidence-label.tsx:10`, '근거 부족 근거 있는 문장 2/5' 관측 | en/ja 미번역 |
| P10 | 브랜드·규정 점검 | 부분 | **있음** | 분류별 통과·주의·차단 + 규칙 근거 링크 + 수정 제안 적용(`components/app/compliance-fixes.tsx:23`) + 카드 배지(`components/app/compliance-count-badge.tsx:11`, '규정 차단 1' 관측). `compliance-fixes` 2/2 | 준수율 % 없음. 최상급 규칙이 가맹 분류에만 있다(N7) |
| P11 | 비용·사용량 미터 | 부분 | **있음** | 캠페인 머리 사용량 미터(`components/app/usage-meter.tsx:15`, role=meter, 80%·100% 상태), 계획 카드 크레딧·원화 | 전역 머리 띠·홈에는 없음(홈 JS 예산 때문에 의도). 완료 뒤 '실제 크레딧' 표시는 관측 못 함 |
| P12 | 결정 인박스 | 있음(결함) | 있음 | 결정·질문·알림 탭과 요약, 일괄 선택 체크박스, 승인·수정 요청·미루기 관측. D1·D2 해결, `ux-inbox` 4/4 | 체크박스 hit 영역 작음(N4), 행 제목 미번역 |
| P13 | 첫 캠페인 온보딩 | 있음 | 있음 | `components/app/onboarding-url-entry.tsx`, `brand-autolearn` 2/2 | 첫 미션 시간은 사람 측정 not_run |
| P14 | 중단·인계 | 부분 | **있음** | 단일 실행 '취소' 즉시(`app/panels.tsx:182`), 회의 '회의 중지'·'지시 추가'(`app/meeting-panel.tsx:116-117`, `components/app/add-instruction.tsx:13`), 연속 실행 지시 추가 | Esc 단축 중지 없음. 회의 중지는 서버가 멈출 때까지 대기 |
| P15 | 미리보기 → 편집기 | 있음 | 있음 | `app/execution-panel.tsx`, `channel-preview` 2/2 | 3열 상세 배치 아님 |

합계: **있음 14 · 부분 1 · 없음 0**(11-09: 있음 10 · 부분 5).

### 5.2 글로벌 공통 12기능

| # | 기능 | 이번 | 근거 | 남은 격차 |
|---|---|---|---|---|
| 1 | 브랜드 컨텍스트 자동 학습 | 있음 | `lib/brand-learn-server.ts`, `brand-autolearn` 2/2 | 실제 외부 사이트 읽기 not_run |
| 2 | 이유 있는 규정 점검 | 부분 | 규칙·이유·법령 근거·수정 제안(`lib/graders/compliance-fixes.ts`) | 정의의 '준수율(%)' 없음 |
| 3 | 다단계 승인·역할·AI 신뢰 통제 | 부분 | 범위 역할, `lib/pii-scan.ts`, 외부 검토자 링크(`share-links` 4/4) | 다단계 승인 체인·허용 모델 통제 없음 |
| 4 | 계획 먼저·자율성 조절 | 있음 | `components/app/plan-card.tsx`, `lib/autonomy.ts` | 없음 |
| 5 | 인용·근거 추적 | 있음 | `components/app/citation-pill.tsx`, `app/api/artifact-sources` | 없음 |
| 6 | AI 생성물 공개·자격증명 | 부분 | `lib/ai-disclosure-image.ts` | C2PA 없음 |
| 7 | 안전장치 있는 크로스채널 집행 | 부분 | Instagram 캐러셀·릴스, 직접 게시 대조, 카카오 전송 화면, 당근 전환 이벤트(`fc26780`) | 모두 mocked. 실계정 not_run |
| 8 | 성과 → 학습 폐루프 | 부분 | 작업물↔발행↔관측 연결, 보정표 재계산(`lib/creative-publication-link-server.ts`) | 학습 규칙 자동 승격 없음(의도) |
| 9 | 소재 예측 점수 | 있음 | `lib/creative-score.ts` + 게시 후 자동 보정 연결 | 실측 데이터 없음 |
| 10 | 실험·귀속·증분·공유 보고서 | 있음 | `lib/incrementality.ts`, `lib/share-links.ts` | 실제 POS not_run |
| 11 | AI 검색 가시성 | 있음 | `lib/geo-run-server.ts` | HERMES 실측 not_run |
| 12 | MCP·예약 실행 | 있음 | `lib/mcp/server.ts`(보존 정리·IP 빈도 제한 추가), `lib/scheduled-runs.ts` | 일일 요약 메일은 여전히 기록만 하는 스텁(`lib/feature-flags.ts:43`) |

합계: **있음 7 · 부분 5 · 없음 0**(변화 없음).

## 6. 12차원 재채점

규칙은 UX-PLAN-3 1절 그대로다.

- 4점 조건을 모두 충족하면 4점, 5점 조건을 절반 이상 충족하면 4.5점, 모두 충족하면 5점이다.
- 4점 조건이 하나라도 깨지면 3.5점으로 적는다.

| # | 차원 | 11-09 | 이번 | 변화 | 근거 |
|---|---|---|---|---|---|
| ① | 정보구조·내비게이션 | 4.5 | 4.5 | 0 | `ux-reach` 18/18(3클릭), `ux-shell` 2/2(명령 팔레트). '길 잃음'은 사람 측정 not_run |
| ② | 핵심 작업 흐름 | 4.5 | 4.5 | 0 | `ux-tasks` 16/16(8과제 클릭 수 −40% 유지). 성공률 90%는 not_run |
| ③ | 시각 체계·일관성 | 4.5 | 4.5 | 0 | 정적 예산 `tests/ux-budget.test.mjs` 통과(인라인 스타일 0, 임의 색 38 ≤ 40, 미디어쿼리 폭 4). 원시 버튼 2개는 11-09와 같다. D1 해결. N1(머리 띠 글자 끊김)은 조건표 항목이 아니라 감점하지 않았다. 다음 회차까지 남으면 감점 후보 |
| ④ | 콘텐츠·UX 라이팅 | 4.5 | 4.5 | 0 | 정적 예산(가운뎃점 0·안전 문장 3) 통과만 확인. 한국어 문구는 재측정하지 않았다 |
| ⑤ | 피드백·상태 | 4.5 | 4.5 | 0 | `ux-undo` 24/24 |
| ⑥ | 폼·입력 | 4.5 | 4.5 | 0 | `ux-form-errors` 2/2(11-09 not_run → 이번 실행) |
| ⑦ | 데이터 표현 | 4.5 | 4.5 | 0 | 정적 예산(가운뎃점 0, 파이프 0) 통과 |
| ⑧ | 모바일·반응형 | 3.5 | **4.5** | +1.0 | 4점 조건: 가로 넘침 0(390 4조합·640×400), 44px 99.0%(프로젝트 예산 규칙; 모든 컨트롤 포함이면 97.9%). 5점: 320px 넘침 0 충족, 모바일 과업 성공률 not_run → 절반 |
| ⑨ | 접근성(WCAG 2.2 AA) | 3.5 | **4.5** | +1.0 | serious 0·moderate 0(11개 조합 220화면). 키보드 8과제는 macOS에서 7/8, Linux CI에서 8/8(과업 3 실패는 플랫폼 동작으로 증명, D9). 5점: 200% 확대 넘침 0 충족, 대화상자·페이지 포커스 E2E(`trust-ui`의 Esc 뒤 포커스 복귀, `ux-shell`) 통과 → 절반 이상. 5점 만점은 아님(화면 낭독기 청취 not_run) |
| ⑩ | 성능·체감 속도 | 5.0 | 5.0 | 0 | `ux-budget` 6 통과(홈 JS ≤165KB gz, 성장 탭 요청 ≤2, LCP 2.5초·INP 200ms, 스위치 전부 켬 시드), 2 건너뜀(명세상 모바일) |
| ⑪ | 신뢰·안전·권한 | 4.5 | 4.5 | 0 | `trust-ui` 2/2, `ux-history` 2/2, `share-links` 4/4 |
| ⑫ | 온보딩·학습 곡선 | 4.0 | 4.0 | 0 | `brand-autolearn` 2/2. 5점 조건(첫 미션 10분·안내 완료율)은 사람 측정 not_run |
| | **평균** | **4.33** | **4.50** | **+0.17** | 52 / 12 → 54 / 12 |

⑧·⑨를 올린 근거는 둘 다 '모든 스위치 켬 + 실제 결정 인박스·검토 대기 작업물·실행 기록' 시드에서 잰 것이다. 11-09에 문제였던 시드 공백(D10)은 런타임 예산 E2E에도 반영됐다.

## 7. 새 결함

| ID | 심각도 | 화면 | 재현 | 원인·근거 | 고칠 곳 |
|---|---|---|---|---|---|
| N1 | medium | 머리 띠 경로(모바일, 4언어) | 390px에서 아무 화면을 연다 | 'MEALZ IP / 워크스페 이스', en 'MEA LZIP / Works pace', 320px에서는 'ME/AL/ZI/P', '캠/페/인'으로 세로로 끊긴다. 원인 후보는 `.topbar>div` flex 항목의 축소와 body `overflow-wrap:anywhere`(`app/globals.css:154`)다(`ko-light-mobile-01-home.png`, `en-light-mobile-01-home.png`, `ko-light-w320-02-campaigns.png`) | UI(레인 X): 워크스페이스 이름을 모바일에서 숨기거나 `white-space:nowrap`+말줄임 |
| N2 | high(글로벌) | 작업물 대화상자·홈 안건·사이드바(en·ja) | English/日本語를 고르고 작업물 대화상자를 연다 | D7 잔여(2.4절). `compliance-panel.tsx`에 `useT` 없음, `confidence-label.tsx:10` 고정 문장, 서버 안건 제목(`lib/agenda-sources.ts:18`·`:28`), 점검 시각 ko 형식 | UI(레인 G·X) + 서버(안건 제목을 키로) |
| N3 | low | 캠페인 · 성장·판매 · 확정 시장자료 가져오기 | 브랜드 시장 자료 id에 13자리 숫자가 있으면(예: `e2e/trust-ui.spec.ts` 시드) 탭을 연다 | 4절. 자료 1건이 목록 전체를 400으로 막는다(`lib/growth-signal-source-server.ts:22`). 화면 안내가 '접근 권한을 확인'으로 원인과 다르다 | 서버(성장 레인): 형식이 맞지 않는 행은 '검토 필요'로 건너뛴다. UI: 400 본문을 그대로 보인다 |
| N4 | low | 홈 인박스·제작·상품 리서치·작업물 대화상자 | 감사 스크립트 계수 | 선택 체크박스 18×18(`app/globals.css:351` `.ui-check`, label 26×18) 데스크톱, 22×22(label 30×44) 모바일. 대화상자 닫기 16×16, 회의 발언 '접기' 36×44(새 P2 화면). D11 커밋은 '체크박스 24px 이상(components 층)'이라 했지만 `components/app/inbox-row.tsx:35`의 `CheckInput`에는 적용되지 않았다 | UI(레인 X) |
| N5 | low | 캠페인 탭 줄(en, 1280) | English로 캠페인 상세를 연다 | 9개 탭 중 'History'가 'Histo'로 잘려 가로 스크롤 뒤에 숨는다(`en-light-desktop-14-camp-growth.png`) | UI: 넘침 표시나 더보기 |
| N6 | low | 테스트 하네스 | macOS에서 `e2e/ux-keyboard-tasks.spec.ts` 실행 | `choose()`(`:69`)가 닫힌 select에서 ArrowDown으로 값이 바뀐다고 가정한다. macOS Chromium은 그렇지 않다(D9 근거). 로컬 macOS 검증이 늘 2건 실패한다 | 테스트 담당: 글자 입력(typeahead)으로 값을 고르게 바꾼다 |
| N7 | low | 작업물 규정 점검 | 일반 캠페인 작업물에 '업계 최고 매운맛을 보장합니다'를 넣는다 | 통과로 나온다. 최상급 규칙 `kr.fr.superlative_claims`가 `franchise_recruit` 분류에만 있다(`lib/graders/compliance-lexicon.ts:253`). 일반 광고(표시광고법) 분류에는 같은 검사가 없다. 법률 판단이 아니라 휴리스틱 범위 격차로 적는다 | 규정 레인(C) |

## 8. 실행한 검증

| 명령 | 결과 |
|---|---|
| `node scripts/run-framework.mjs build` | 종료 코드 0 |
| 확장 감사 `E2E_PORT=8873 node e2e/artifacts/qa2/audit.mjs`(커밋 안 함) | 11개 조합 220화면 + 320px 22화면 계측 완료, 종료 코드 0 |
| D8 재현 `node e2e/artifacts/qa2/d8.mjs` | 4절 표 |
| 계측기 확인 `sanity.mjs`·`sanity2.mjs`·`select.mjs` | 주입 위반 검출, macOS select 동작 재현 |
| `node --experimental-vm-modules --test tests/ux-budget.test.mjs tests/ux-tasks-budget.test.mjs` | 2/2 통과(정적 예산 7항목) |
| `node --experimental-vm-modules --test tests/i18n-coverage.test.mjs tests/i18n.test.mjs tests/ux-patterns-complete.test.mjs tests/compliance-fixes.test.mjs` | 4/4 통과 |
| E2E 20개 명세(ux-keyboard-tasks·ux-budget·growth-signal-source·ux-patterns-complete·compliance-fixes·i18n·trust-ui·ux-inbox·ux-tasks·ux-reach·ux-undo·ux-shell·ux-history·ux-form-errors·ux-theme·version-diff·ux-plan-card·channel-preview·brand-autolearn·share-links), 모바일·데스크톱, `E2E_PORT=8873` | **126 통과 · 2 실패 · 2 건너뜀**(6.3분). 실패는 ux-keyboard-tasks 과업 3(두 프로젝트, N6). 건너뜀은 ux-budget 모바일 2건(명세상) |
| CI 확인 `gh run view 43617154956`(perf/home-headroom, 이 통합의 마지막 병합 대상) | e2e-smoke 성공 373 passed, 키보드 과업 3 모바일·데스크톱 ✓ |

## 9. 확인하지 못한 것(not_run)

- 사람 사용성 테스트(SUS·과업 성공률·첫 미션 10분·'길 잃음'·'모르는 말'): not_run. ①·②·④·⑧·⑫의 5점 조건은 이 때문에 절반까지만 인정했다.
- 실제 외부 계정(Meta·Instagram·Threads·네이버 검색광고·당근·카카오 딜러사·토스플레이스·토스페이먼츠·Buffer·HERMES): not_run. mocked 경로만 확인했다.
- 운영 D1·운영 Sites 게시본: not_run. 로컬 빌드만 평가했다.
- 진행 중 회의·AI 연결이 있어야 그려지는 화면: 로컬 실물 not_run. 끝난 회의는 fixture로, 진행 중 회의는 E2E의 mocked 응답으로만 봤다.
- 실제 화면 낭독기(VoiceOver·NVDA) 청취: not_run.
- ja는 홈·캠페인 상세·작업물 대화상자 11화면, light만 쟀다. dark·설정·기타 화면 not_run.
- 이번 macOS 실행에서 키보드 과업 3은 실패했다. Linux 통과는 CI 로그로만 확인했고 직접 Linux에서 돌리지 않았다.
- 화면 캡처는 뷰포트만 찍었다(전체 페이지 아님). 계측(axe·대비·넘침)은 문서 전체가 대상이다.

## 10. 스크린샷

`docs/observations/2026-11-15-qa-global-eval/`에 25장(합계 약 2.6MB, 가로 960px 이하)을 두었다.

- D1·D2 해결: `ko-light-desktop-01-home.png`, `ko-dark-desktop-01-home.png`, `ko-light-mobile-01-home.png`
- 머리 띠 끊김(N1): `en-light-mobile-01-home.png`, `ko-light-w320-01-home.png`, `ko-light-w320-02-campaigns.png`
- 번역 범위(D7·N2): `en-light-desktop-01-home.png`, `en-light-desktop-20-artifact-dialog.png`, `ja-light-desktop-01-home.png`, `ja-light-mobile-01-home.png`, `ja-light-desktop-20-artifact-dialog.png`, `ja-light-desktop-10-camp-brief.png`, `en-light-desktop-34-settings-team.png`, `en-light-desktop-14-camp-growth.png`(N5 탭 잘림 포함)
- 신뢰 UI·패턴(P2·P5·P9·P10·P11): `ko-light-desktop-20-artifact-dialog.png`, `ko-light-desktop-20b-artifact-dialog-fixes.png`, `ko-light-desktop-13b-outputs-cards.png`, `ko-light-desktop-11-camp-meeting.png`, `ko-light-desktop-12b-team-timeline.png`, `ko-dark-desktop-12-camp-team.png`
- D4: `ko-light-desktop-42-franchise.png`
- D8·N3: `d8-api-source-uuid-desktop.png`, `d8-plus-13digit-id-desktop.png`, `d8-plus-13digit-id-mobile.png`
- 200% 확대: `ko-light-zoom200-01-home.png`
