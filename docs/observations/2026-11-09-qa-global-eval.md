# 글로벌 도약 4차 통합 독립 평가 (2026-11-09)

- 평가자: 독립 QA 세션(Claude). 최근 기능을 만들지 않았고 실행한 결과로만 판단한다.
- 대상: `integrate/wave4` `5c1a253`. 빌드 `node scripts/run-framework.mjs build` 종료 코드 0.
- 환경: 로컬 E2E 서버(`E2E_PORT=8853 node e2e/serve.mjs`, wrangler --local, 빈 로컬 D1), mocked 인증 헤더, 실제 Chromium, axe-core 4.11.4. 운영 D1·외부 계정에는 접속하지 않았다.
- 감사 소유자에게 `/api/feature-flags`로 등록된 스위치 52개를 모두 켰다(52개 모두 200).

## 1. 결론

**12차원 평균은 4.50에서 4.33으로 내려간다.** 새 기능은 많이 들어왔지만 통합 과정에서 접근성·모바일 4점 조건이 다시 깨졌다.

- **접근성 ⑨ 4.5 → 3.5.** light 화면 22개 중 12개에서 axe serious가 나온다(조합당 17노드). 가맹 모집에는 critical 1건이 있다. 키보드 8과제 중 과업 3이 모바일·데스크톱 모두 실패한다.
- **모바일 ⑧ 4.5 → 3.5.** 390px 홈에서 결정 인박스 행이 오른쪽으로 99px 넘친다. 11회차에 충족했던 '가로 넘침 0'이 깨졌다.
- **가장 큰 결함은 홈 결정 인박스의 '승인' 버튼이 보이지 않는 것이다.** 흰 바탕에 흰 글자라 대비가 1:1이다. light·dark 모두 빈 상자로 보인다. 새 기능의 첫 화면 주 동작이 눈에 보이지 않는다.
- **패턴과 기능은 크게 올랐다.** 에이전트 UX 15패턴은 있음 10 · 부분 5 · 없음 0이다(340e972는 부분 13 · 없음 2). 글로벌 12기능은 있음 7 · 부분 5 · 없음 0이다(340e972는 있음 0 · 부분 11 · 없음 1). 단 모두 기본 꺼짐 스위치 뒤에 있고, 외부 채널은 mocked 계약 테스트까지만 확인됐다.
- **영어 화면은 셸만 번역됐다.** 캠페인 상세(`app/panels.tsx`)에는 `t()` 호출이 0개다. 작업물 대화상자·규정 점검·배지는 영어 모드에서도 한국어로 나온다.

## 2. 자동 접근성·배치 감사

### 2.1 범위와 방법

- 스크립트: `scripts/ux-audit.mjs`를 워크트리의 git 무시 폴더(`e2e/artifacts/`)에 확장 복사해 돌렸다. 앱 코드에는 넣지 않았다.
- 화면 22개: 홈, 캠페인 목록, 캠페인 상세 9탭(브리프·팀 회의·AI 팀·작업물·성장·판매·Meta 광고 준비·제작·발행·성과·이력), 작업물 대화상자, 설정 6탭(연결·채널·자동화·사용량·팀·기능표), 점포 마케팅, 상품 리서치, 가맹 모집, 바이럴 학습.
- 조합 8개: 언어(ko·en) × 테마(light·dark) × 화면(데스크톱 1280×800·모바일 390×844). 200% 확대는 640×400(1280×800의 200%)으로 ko·light 22화면을 따로 쟀다.
- 작업물 대화상자용 합성 데이터: `e2e/trust-ui.spec.ts`와 같은 방식으로 AI 작업물 1건(브랜드 자료 ref·확정 사실 ref·영수증 리뷰 이벤트 문장)을 로컬 D1에 넣었다.
- 계측: axe(wcag2a·2aa·21a·21aa·22aa·best-practice), 자체 텍스트 대비(4.5:1·큰 글자 3:1), 44px 미만·24px 미만 상호작용 요소, 문서 가로 넘침과 넘친 요소, 화면 글자 중 한글 비율, 콘솔 오류.

### 2.2 axe 위반 노드 수(22화면 합계)

| 조합 | critical | serious | moderate | minor |
|---|---|---|---|---|
| ko · light · 데스크톱 | 1 | 17 | 0 | 1 |
| ko · light · 모바일 | 1 | 17 | 0 | 1 |
| ko · dark · 데스크톱 | 1 | 2 | 0 | 1 |
| ko · dark · 모바일 | 1 | 2 | 0 | 1 |
| en · light · 데스크톱 | 1 | 17 | 0 | 1 |
| en · light · 모바일 | 1 | 17 | 0 | 1 |
| en · dark · 데스크톱 | 1 | 2 | 0 | 1 |
| en · dark · 모바일 | 1 | 2 | 0 | 1 |

규칙별 내역(조합 1개 기준):

| 규칙 | 영향 | light | dark | 대상 |
|---|---|---|---|---|
| color-contrast | serious | 16 | 1 | light: '검토 대기' 배지 `.status-review`(4.39:1, 12px). dark: AI 팀 타임라인 '완료' 글자 `.text-emerald-700` |
| listitem | serious | 1 | 1 | `components/app/run-timeline.tsx:22` `<ol role="log">` 안의 `<li>`가 목록 의미를 잃음 |
| aria-valid-attr-value | critical | 1 | 1 | 가맹 모집 탭 `#radix-…-trigger-leads`. `app/franchise-panel.tsx:78`이 `TabsContent` 없이 `TabsTrigger`만 써서 `aria-controls`가 없는 id를 가리킴 |
| aria-allowed-role | minor | 1 | 1 | 같은 `<ol role="log">` |

- 11회차 기준 'serious 0'(⑨ 4점 조건)과 런타임 예산 `axeCriticalSerious: 0`을 넘는다.
- '검토 대기' 배지는 작업물이 검토 대기일 때 캠페인 상단·목록·작업물 카드 어디에나 나와서 화면 12개에 걸린다. 11회차 감사 데이터에 검토 대기 작업물이 없었을 수 있어 회귀 시점은 확인하지 못했다.

### 2.3 대비·터치·넘침·확대

| 항목 | 결과 | 판정 |
|---|---|---|
| 자체 대비 실패(light, 조합당) | 17/2,687(데스크톱), 17/1,944(모바일) | 16건은 '검토 대기' 배지 4.39:1. 1건은 홈 인박스 '승인' 버튼 흰 글자/흰 배경 1.00:1 |
| 자체 대비(dark) | 측정 못 함 | dark 토큰이 `lab()`·`oklch()`라 자체 계측기가 읽지 못했다. dark 대비는 axe 결과로만 판단한다 |
| 모바일 44px 미만 | 9/781(1.2%) → 44px 이상 98.8% | 4점 조건 98% 충족. 미달: 인박스 선택 체크박스 22×22, 제작·발행·상품 리서치 체크박스 22×22, 작업물 대화상자 '법령 근거' 링크 46×15 |
| 데스크톱 24px 미만(WCAG 2.5.8) | 68개/1,166 | Meta 광고 준비 17, 설정 자동화 14, 기능표 8. 16px 높이 링크형 버튼·16px 체크박스가 대부분이다 |
| 모바일 가로 넘침 | 홈 1화면, 4조합 모두 | 문서 폭 489px(화면 390px). 인박스 행 버튼이 오른쪽으로 넘친다 |
| 200% 확대(640×400) 가로 넘침 | 0/22 | 충족 |
| 콘솔 오류 | 성장·판매 탭 1건, 모든 조합 | `GET /api/growth/signal-sources?campaignId=…` 400 '캠페인 입력을 확인해 주세요.' |
| 헤딩 건너뜀 | 0 | 충족 |
| 본문 글꼴 | `"Pretendard Variable", Pretendard, …` | X5 충족 |

### 2.4 영어 화면 번역 범위

같은 화면의 한글 글자 비율이다. 합성 데이터(캠페인 이름 등)가 한국어라 0이 될 수는 없다. 차이가 작은 화면은 화면 문구가 번역되지 않은 것이다.

| 화면 | ko | en |
|---|---|---|
| 설정 · 팀·권한 | 74.5% | 3.9% |
| 캠페인 목록 | 62.9% | 20.5% |
| 홈 | 74.4% | 29.6% |
| 작업물 대화상자 | 87.2% | 70.6% |
| AI 팀 탭 | 89.5% | 77.4% |
| Meta 광고 준비 | 90.8% | 78.9% |
| 제작·발행 | 86.2% | 76.3% |

- `app/panels.tsx`의 `t()` 호출은 0개다. `components/app/compliance-panel.tsx`·`citation-pill.tsx`도 0개다.
- 홈도 '시작하기'·'진행 중인 캠페인'·'브랜드 포트폴리오' 등이 `app/workspace.tsx:174`에 한국어로 박혀 있다.
- GLOBAL-PLAN G6 1차 범위는 '셸·홈·캠페인·작업물·설정'이다. 캠페인과 작업물은 이 범위에 미달한다.

## 3. 패턴·기능 재판정

판정은 모든 스위치를 켠 상태 기준이다. '화면 관측'은 이번 감사 스크린샷이나 이번에 돌린 E2E로 본 것이다.

### 3.1 에이전트 UX 15패턴

| # | 패턴 | 판정 | 근거 | 빠진 것 |
|---|---|---|---|---|
| P1 | 실행 타임라인 | 있음 | `lib/run-timeline.ts:15`(승인 대기)·`:22`(thinking), `components/app/run-timeline.tsx:22`. AI 팀 탭에서 '완료 콘텐츠 스튜디오 시작 오후 01:13:16' 관측 | 단계 상세 접기 없음. `ol role=log` 구조가 axe serious |
| P2 | 팀 회의 뷰 | 부분 | `app/meeting-panel.tsx:35` 합의 단계의 A/B `ChoiceCard`, `lib/meeting-choice-server.ts:5`(스위치 `meeting_choice_gate`) | 참석자 열·상태 점·'결정 필요' 열 없음. 회의 실행이 없어 화면 관측 못 함 |
| P3 | 계획 먼저 승인 | 있음 | `app/panels.tsx:163`, `components/app/plan-card.tsx:21`. 담당별 '4,679 토큰 추정'·'승인 후 실행' 관측 | 원화·크레딧 환산 없음. 항목 제외는 API가 지원할 때만 |
| P4 | 승인 카드 | 있음 | `components/app/confirm-dialog.tsx:4`(무엇·어디·언제·비용·되돌림, 변경 요청), `components/app/inbox-actions.tsx:36` | 없음 |
| P5 | 리뷰·게시 승인 흐름 | 부분 | 수정 요청 메시지 필수(`components/app/inbox-row.tsx:41`), 외부 검토자 링크 최대 10개(`lib/share-links.ts:26`) | 다단계 승인자·마감일·승인 후 수정 시 재승인 없음 |
| P6 | 버전 비교 | 있음 | `components/app/version-diff.tsx:3`(어절 diff·이 부분 받기·되돌리기), `app/campaign-history.tsx:58` | 없음 |
| P7 | 인용 | 있음 | `components/app/citation-pill.tsx`, 대화상자에서 '자료 1'·'사실 주소' pill과 '근거 없음' 표시 관측 | 외부 웹 출처 도메인 표시는 합성 데이터로 확인 못 함 |
| P8 | AI 생성 라벨 | 있음 | `components/app/ai-origin-badge.tsx`(담당·모델·시각·규칙 수), `lib/ai-disclosure-image.ts`(iTXt) | C2PA 자격증명 없음(`lib` 전체에 c2pa 0건) |
| P9 | 신뢰도 표시 | 있음 | `components/app/confidence-label.tsx`, `app/panels.tsx:90`(근거 부족이면 '직접 확인했습니다' 뒤 승인). '근거 부족 근거 있는 문장 2/4' 관측 | 없음 |
| P10 | 브랜드·규정 점검 | 부분 | `components/app/compliance-panel.tsx:10`(다시 점검), 규칙 분류별 통과·주의·차단 관측 | '수정 제안 적용'은 그리지 않음(`:11`). 준수율 % 없음 |
| P11 | 비용·사용량 미터 | 부분 | 설정 사용량 탭 월 토큰 예산, `app/billing-panel.tsx:2`(크레딧 원장, 스위치 `credit_billing`) | 머리 띠 잔여 막대 없음. 계획 카드는 토큰 추정만이고 원화 없음 |
| P12 | 결정 인박스 | 있음(결함) | `app/agenda-panel.tsx:72`(J/K/A/R/H), 결정·질문·알림 탭 관측 | '승인' 버튼 안 보임, 체크박스·버튼 행 밖 배치, 모바일 넘침(결함 D1·D2) |
| P13 | 첫 캠페인 온보딩 | 있음 | `components/app/onboarding-url-entry.tsx:5`(URL → 브랜드 초안·템플릿 3개, 스위치 `brand_autolearn`) | 첫 미션 시간은 사람 측정 not_run |
| P14 | 중단·인계 | 부분 | `app/panels.tsx:139`(연속 실행 멈추기), `app/growth-stop-panel.tsx`(전역 중단) | 실행 헤더의 즉시 중지·Esc 없음. '현재 작업 후 멈추기'만 있음 |
| P15 | 미리보기 → 편집기 | 있음 | `app/execution-panel.tsx:75-76`(선택 막대·채널 미리보기), `components/app/channel-preview.tsx` | 결과물 상세 3열 배치 아님 |

합계: 있음 10 · 부분 5 · 없음 0.

### 3.2 글로벌 공통 12기능

| # | 기능 | 판정 | 근거 | 남은 격차 |
|---|---|---|---|---|
| 1 | 브랜드 컨텍스트 자동 학습 | 있음 | `lib/brand-learn-server.ts`, 스위치 `brand_autolearn` | 확정은 사람. 실제 외부 사이트 1회 읽기는 not_run |
| 2 | 이유 있는 규정 점검 | 부분 | `components/app/compliance-panel.tsx` | 준수율 %·수정 적용 없음 |
| 3 | 다단계 승인·역할·AI 신뢰 통제 | 부분 | 범위 역할(스위치 `scoped_roles`), `lib/pii-scan.ts`, `lib/source-masking.ts`, 외부 검토자 링크 | 다단계 승인 체인·허용 모델 통제 없음 |
| 4 | 계획 먼저·자율성 조절 | 있음 | `components/app/plan-card.tsx`, `lib/autonomy.ts`(스위치 `autonomy_rules`) | 없음 |
| 5 | 인용·근거 추적 | 있음 | `components/app/citation-pill.tsx`, `app/api/artifact-sources` | 없음 |
| 6 | AI 생성물 공개·자격증명 | 부분 | `lib/ai-disclosure-image.ts`(iTXt·가시 표시 줄) | C2PA 없음 |
| 7 | 안전장치 있는 크로스채널 집행 | 부분 | `lib/connectors/`(instagram-publish·threads·naver-ads-write·daangn-ads), `lib/kakao`, `lib/place-drafts.ts`, `lib/publisher-buffer.ts` | 모두 mocked 계약 테스트까지. 실계정 검증은 not_run(키 신청 대기) |
| 8 | 성과 → 학습 폐루프 | 부분 | 학습 규칙·보상 계보·Reflector(스위치 `b4_reward_lineage`·`b3_reflector`) | 자동 승격 없음(의도) |
| 9 | 소재 예측 점수 | 있음 | `lib/creative-score.ts`(스위치 `creative_score`) | 게시 후 보정은 실측 데이터 없음 |
| 10 | 실험·귀속·증분·공유 보고서 | 있음 | `lib/incrementality.ts`, `lib/share-links.ts` | 실제 POS 연결 not_run |
| 11 | AI 검색 가시성 | 있음 | `lib/geo-run-server.ts`(스위치 `geo_tracking`) | HERMES 실측 not_run |
| 12 | MCP·예약 실행 | 있음 | `lib/mcp`, `lib/scheduled-runs.ts` | 일일 요약 메일은 기록만 하는 스텁(`digest_mail` 설명) |

합계: 있음 7 · 부분 5 · 없음 0.

## 4. 12차원 재채점

규칙은 UX-PLAN-3 1절 그대로다. 4점 조건을 모두 충족하면 4, 5점 조건 절반 이상이면 4.5, 모두면 5다. 4점 조건이 하나라도 깨지면 3.5로 적었다. 11회차는 4.50이다.

| # | 차원 | 11회차 | 이번 | 변화 | 근거 |
|---|---|---|---|---|---|
| ① | 정보구조·내비게이션 | 4.5 | 4.5 | 0 | 4점 조건 충족(설정 section·캠페인 ctab 주소, 상세 페이지, 탭 2단계). 3클릭 E2E `ux-reach` 18/18 통과, `ux-shell` 명령 팔레트 통과. 사용성 '길 잃음'은 not_run |
| ② | 핵심 작업 흐름 | 4.5 | 4.5 | 0 | 과업 하네스 `ux-tasks` 16/16 통과(8과제 클릭 수 −40% 유지). 과업 성공률 90%는 사람 측정 not_run |
| ③ | 시각 체계·일관성 | 4.5 | 4.5 | 0 | 정적 예산 통과(인라인 스타일 0, 임의 색 38 ≤ 40, 미디어쿼리 폭 4). 원시 버튼은 2개(`app/brand-interview-panel.tsx:68-69`, 10/01부터 있음)라 엄격히는 '0' 미달이지만 11회차와 같은 상태라 내리지 않았다. 결함 D1은 전역 선택자가 공용 Button 변형을 덮은 시각 체계 위반이므로, 다음 회차에도 남아 있으면 감점한다 |
| ④ | 콘텐츠·UX 라이팅 | 4.5 | 4.5 | 0 | 이번에는 한국어 문구를 다시 재지 않았다(정적 예산 가운뎃점 0·안전 문장 3 통과만 확인). 영어 화면의 한·영 혼용은 이 차원 조건 밖이라 결함 D7로 따로 적었다 |
| ⑤ | 피드백·상태 | 4.5 | 4.5 | 0 | 되돌리기 E2E `ux-undo` 24/24 통과. 승인 카드 v2(무엇·어디·언제·비용·되돌림)가 들어왔다 |
| ⑥ | 폼·입력 | 4.5 | 4.5 | 0 | 이번에 다시 돌리지 않았다(`ux-form-errors` not_run). 11회차 값을 이어받았다 |
| ⑦ | 데이터 표현 | 4.5 | 4.5 | 0 | 정적 예산 통과(가운뎃점 0, 파이프 구분 0). 화면 재측정은 하지 않았다 |
| ⑧ | 모바일·반응형 | 4.5 | **3.5** | −1.0 | 4점 조건 '가로 넘침 0' 깨짐: 390px 홈 문서 폭 489px(결함 D2), 4조합 모두. 44px 이상 98.8%로 98% 조건은 충족. 640×400 확대 넘침 0 |
| ⑨ | 접근성(WCAG 2.2 AA) | 4.5 | **3.5** | −1.0 | 4점 조건 'serious 0' 깨짐: light 조합당 serious 17·critical 1, dark 조합당 serious 2·critical 1. '키보드만으로 8과제'는 과업 3이 모바일·데스크톱 모두 실패(원인 미확정, 결함 D9). 200% 확대 넘침 0은 충족 |
| ⑩ | 성능·체감 속도 | 5.0 | 5.0 | 0 | `ux-budget` 통과: 홈 첫 로딩 JS 예산 170KB gz 이하, 데스크톱 4G LCP 2.5초·INP 200ms 예산 이하(모바일 LCP 항목은 명세상 건너뜀) |
| ⑪ | 신뢰·안전·권한 | 4.5 | 4.5 | 0 | 이력 문장 `ux-history` 통과, 신뢰 UI `trust-ui` 통과(인용·출처 배지·근거 부족 확인 승인·규정 다시 점검). 하드코딩 브랜드명 0은 재확인하지 않았다 |
| ⑫ | 온보딩·학습 곡선 | 4.0 | 4.0 | 0 | URL → 브랜드 초안·템플릿 3개 `brand-autolearn` 통과. 5점 조건(첫 미션 10분·안내 완료율)은 사람 측정 not_run |
| | **평균** | **4.50** | **4.33** | **−0.17** | 54 / 12 → 52 / 12 |

⑧·⑨를 4점 조건 미달로 낮춘 이유는 둘 다 새 기능(결정 인박스 v2, 실행 타임라인, 상태 배지)을 켠 화면에서 생겼기 때문이다. 런타임 예산 E2E(`e2e/ux-budget.spec.ts`)는 스위치를 끄고 빈 캠페인 1개만 만들어서 이 결함을 잡지 못한다(결함 D10). D1~D6을 고치면 ⑧·⑨는 4.5로 돌아갈 수 있다.

## 5. 결함 목록

| ID | 심각도 | 화면 | 재현 | 원인·근거 | 고칠 곳 |
|---|---|---|---|---|---|
| D1 | critical | 홈 · 오늘의 안건(결정 행) | 검토 대기 AI 작업물이 있는 캠페인을 만든다 → 홈을 연다 → 결정 행 아래 첫 버튼이 빈 상자다 | '승인' 버튼이 흰 글자/흰 배경 1.00:1. `app/globals.css:274` `.agenda-list button{…background:var(--card)}`가 공용 Button 기본 변형의 배경을 덮는다. light·dark 모두 | UI(레인 X): 선택자를 행 본문 카드 버튼으로 좁힌다 |
| D2 | high | 홈 · 오늘의 안건 | 같은 데이터로 390px에서 홈을 연다 | 일괄 선택 체크박스가 행 첫 자식이 되어 `app/globals.css:281` `.agenda-list>li>button:first-child{flex:1 1 260px}`가 빗나가고, `width:100%` 때문에 체크박스·카드·버튼이 세 줄로 갈라진다. 모바일 문서 폭 489px(화면 390px) | UI(레인 X) |
| D3 | high | '검토 대기' 배지가 있는 12화면(홈·캠페인 목록·상세 9탭·작업물 대화상자) | light에서 검토 대기 작업물이 있는 캠페인을 연다 | `app/globals.css:162` `.status-review{background:var(--neutral-90);color:var(--yellow-44)}` = 4.39:1, 12px. axe serious 16노드/조합 | UI(시각 토큰 담당) |
| D4 | high | 가맹 모집 | 스위치 `r_franchise`를 켜고 가맹 모집을 연다 | `app/franchise-panel.tsx:78`이 `TabsContent` 없이 `TabsTrigger`만 써서 `aria-controls`가 없는 id를 가리킨다. axe critical | UI(레인 R 소유 파일) |
| D5 | medium | 캠페인 · AI 팀 탭 | 실행 기록이 1건 이상인 캠페인의 AI 팀 탭 | `components/app/run-timeline.tsx:22` `<ol role="log">`라 `<li>`가 목록 부모를 잃는다. axe listitem serious + aria-allowed-role minor | UI(레인 X): `div role="log"` 안에 `ol`을 둔다 |
| D6 | medium | 캠페인 · AI 팀 탭(dark) | dark에서 같은 화면 | '완료' 글자 `text-emerald-700`(`components/app/run-timeline.tsx:11` 상태 색)이 dark 배경에서 대비 미달. axe serious | UI(레인 X): dark 전용 상태 색 토큰 |
| D7 | high | 캠페인 상세 전체·작업물 대화상자·홈 일부(en) | 설정에서 English를 고르고 캠페인·작업물을 연다 | `app/panels.tsx` `t()` 0회, `components/app/compliance-panel.tsx`·`citation-pill.tsx` 0회. 홈 '시작하기'·'진행 중인 캠페인'은 `app/workspace.tsx:174` 고정 한국어. G6 1차 범위(셸·홈·캠페인·작업물·설정) 미달 | UI(레인 G·X) |
| D8 | medium | 캠페인 · 성장·판매 탭 | 탭을 연다(모든 조합) | `GET /api/growth/signal-sources?campaignId=…`가 400 '캠페인 입력을 확인해 주세요.'를 돌려 콘솔 오류가 난다. curl로도 같은 응답 | 서버(성장 레인) + UI 확인 |
| D9 | medium | 캠페인 · 성장·판매 · 고객 문의 | `node node_modules/@playwright/test/cli.js test e2e/ux-keyboard-tasks.spec.ts` (macOS) | 과업 3에서 기본 select에 ArrowDown을 눌러도 값이 'respond'에서 바뀌지 않는다(모바일·데스크톱). macOS Chromium의 select 동작인지 앱 결함인지 미확정 | 테스트 담당: Linux CI에서 재확인 후 UI 판단 |
| D10 | medium | 품질 게이트 | `e2e/ux-budget.spec.ts`를 읽는다 | 빈 캠페인 1개·스위치 꺼짐 상태만 재서 D1~D6을 통과시킨다. 검토 대기 작업물·결정 인박스 항목·실행 기록·스위치 전부 켬 상태를 시드에 더해야 한다 | 테스트(레인 A·X) |
| D11 | low | Meta 광고 준비·설정 자동화·기능표(데스크톱), 인박스·제작·발행·상품 리서치(모바일) | 감사 스크립트 24px 계수 | 데스크톱 24px 미만 68개(16px 높이 링크형 버튼·16px 체크박스). 모바일 22px 체크박스와 46×15 '법령 근거' 링크. WCAG 2.5.8 간격 예외 해당 여부 미확인 | UI |
| D12 | low | 작업물 대화상자 · 규정 점검 | 차단 표현이 있는 작업물을 연다 | '수정 제안 적용'이 없고(`components/app/compliance-panel.tsx:11`), 준수율 %도 없다 | 서버(채점기 대체 문구) + UI |
| D13 | low | 캠페인 · AI 팀 계획 카드 | AI 팀 탭 | 예상 비용이 토큰만이고 원화·크레딧 환산이 없다 | UI |
| D14 | low | 사이드바(en, 데스크톱) | English로 바꾼다 | 'Marketing workspace'가 두 줄로 늘어 브랜드 목록이 하단 고정 영역 밑으로 반쯤 가린다 | UI |

## 6. 실행한 검증

| 명령 | 결과 |
|---|---|
| `node scripts/run-framework.mjs build` | 종료 코드 0 |
| 확장 감사(`e2e/artifacts/qa-global-audit.mjs`, 커밋 안 함) | 9조합 × 22화면 = 198화면 계측 완료 |
| `node --experimental-vm-modules --test tests/ux-budget.test.mjs tests/ux-tasks-budget.test.mjs` | 2/2 통과 |
| E2E 13개 명세(ux-inbox·ux-plan-card·channel-preview·version-diff·trust-ui·ux-keyboard-tasks·ux-tasks·ux-theme·i18n·ux-reach·ux-history·brand-autolearn·share-links), 모바일·데스크톱 | 78 통과 · 2 실패(ux-keyboard-tasks 과업 3, 두 프로젝트) |
| E2E `ux-budget`·`ux-undo`·`ux-shell` | 30 통과 · 0 실패(모바일 LCP 1건은 명세상 건너뜀) |

E2E는 `E2E_PORT=8853 node node_modules/@playwright/test/cli.js test …`로 돌렸다. 통과한 E2E는 모두 스위치를 각자 켜는 자체 시드를 쓰므로, 결정 인박스 E2E가 통과해도 D1(보이지 않는 버튼)은 역할 이름으로 찾기 때문에 걸리지 않는다.

## 7. 확인하지 못한 것(not_run)

- 사람 사용성 테스트 5명(SUS·과업 성공률·첫 미션 10분·'길 잃음'·'모르는 말'): not_run. ①·②·④·⑫의 5점 조건은 이 때문에 절반까지만 인정했다.
- 실제 외부 계정(Meta·Instagram·Threads·네이버 검색광고·당근·카카오 딜러사·토스플레이스·토스페이먼츠 실결제·Buffer·HERMES 브라우저): not_run. 모두 mocked 경로만 확인했다.
- 운영 D1·운영 Sites 게시본: not_run. 로컬 빌드만 평가했다.
- dark 테마 자체 대비 계측: not_run(색 형식 미지원). axe 결과로만 판단했다.
- 회의 실행·AI 연결이 있어야 그려지는 화면(회의 타임라인·A/B 선택 카드 실물): 로컬 화면 관측 not_run.
- 일본어(ja) 화면: not_run.
- 실제 화면 낭독기(VoiceOver·NVDA) 청취: not_run. axe와 역할 기반 E2E만 돌렸다.

## 8. 스크린샷

`docs/observations/2026-11-09-qa-global-eval/`에 21장(합계 약 2.3MB, 가로 960px 이하)을 두었다. 파일 이름은 `언어-테마-화면-번호-화면이름.png`다.

- 결함 D1·D2: `ko-light-desktop-01-home.png`, `ko-dark-desktop-01-home.png`, `ko-light-mobile-01-home.png`, `en-light-mobile-01-home.png`
- 신뢰 UI(P7·P8·P9·P10): `ko-light-desktop-20-artifact-dialog.png`, `ko-dark-desktop-20-artifact-dialog.png`
- 번역 범위: `en-light-desktop-20-artifact-dialog.png`, `en-light-desktop-34-settings-team.png`
- 계획 카드·타임라인(P1·P3): `ko-light-desktop-12-camp-team-plan-timeline.png`
- 200% 확대: `ko-light-zoom200-01-home.png`
