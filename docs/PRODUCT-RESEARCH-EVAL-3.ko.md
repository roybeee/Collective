# 상품 리서치·MD 에이전트 독립 평가 3회차와 반영 기록

- 평가 대상: main `2c100e6`(#333까지, Sites99 게시 판). 루브릭은 [계획](PRODUCT-RESEARCH-PLAN.ko.md)의 12차원(목표 평균 4.7, 모든 차원 4.5 이상).
- 평가 방식: 독립 평가자(읽기 전용, 외부 호출 없음)가 코드·테스트를 읽고 2회차 결함 수정 여부를 재현 스크립트로 다시 깨뜨려 본 뒤 점수를 매겼다.
- 점수 추이: 1회차 3.67 → 2회차 4.13 → **3회차 4.29**.
- 이 문서의 반영분은 인계 PR(브랜치 `claude/product-research-eval3-fixes`)에 있다. 병합·Sites100 게시·4회차 평가는 아직이다.

## 1. 3회차 12차원 점수

| # | 차원 | 점수 | 근거(평가자) |
|---|---|---|---|
| ① | 데이터 커버리지 | 4.4 | 공식 API 4종, 랭킹 3종 가져오기, 자사 판매 결합. 데이터랩 쇼핑인사이트가 수집 계획에 없음 |
| ② | 신선도·신뢰성 | 4.5 | 저장 실패를 성공률에서 뺌, 관측 한 점 단위 격리, 상대값은 두 번째 출처 대조 뒤에만 격리. 30일 실측 필요 |
| ③ | 수요 측정 | 4.3 | 묶음 실측 합 기준점과 보정 보고. 실측 없는 묶음 키워드가 합에서 빠져 수요가 낮게 나옴 |
| ④ | 트렌드 예측력 | 4.0 | 백테스트 하네스·기준선 있음. 소급 이력으로 후보가 되는 생존 편향 재현(정밀도@10 = 1.0) |
| ⑤ | 경쟁·시장 구조 | 4.3 | 신규 진입을 목록 이력·순위 기반으로 고침. 진입 난이도와의 순위 상관 미측정 |
| ⑥ | 수익성 | 4.3 | 소싱 견적·손익 시뮬레이터 연결. 출시 결과와 예측 공헌이익 비교 없음 |
| ⑦ | 리스크·규제 | 4.4 | 리스크 관문 우회 고침. 위험 확인 사유가 '광고' 한 낱말로 통과 |
| ⑧ | 브랜드 적합성 | 4.0 | 아카이브 대조 힌트·사람 판정. 블라인드 일치율 실측 필요 |
| ⑨ | 설명 가능성·근거 | 4.3 | 결정형 메모는 정확. 모델 메모 채점기가 금지어 목록 방식이라 우회가 남음 |
| ⑩ | 의사결정 연결 | 4.2 | 넘기기 때 신호·고객 기회·소싱 초안(조건부). 카탈로그·오퍼 초안 없음, 출시 결과가 가중치로 돌아가지 않음 |
| ⑪ | 자동화·운영 | 4.4 | 일일 계획·재시도·쿼터 원장·주간 리포트·90초 상한. 재계산 중 잠금 미갱신 |
| ⑫ | 컴플라이언스 | 4.4 | 출처 레지스트리·자동 수집 금지 검사·스위치·전역 중단 E2E. 법무 검토 미완료 |
| | **평균** | **4.29** | 51.5 / 12 |

## 2. 2회차 결함 판정(3회차 평가자)

| 결함 | 판정 | 비고 |
|---|---|---|
| H1 리스크 관문 우회 | 고침 | 서버가 점수표에서 필수 항목을 만들고 모르는 ruleId는 400 |
| H2 인용 채점기 우회 | 일부 | 지적 사례는 막혔으나 '베스트셀러'·'꺾였다'·'열두 곳'·'HACCP 획득'·이름 가림 세탁 등으로 다시 뚫림 |
| H3 백테스트 생존 편향 | 일부 | 처음 수집 시각 필터는 들어갔으나 소급 이력으로 후보가 되는 경로가 남음 |
| H4 스냅샷 3,000개 상한 | 고침 | 출처별 읽기 계획 |
| M1 격리 단위 | 고침 | |
| M2 신규 진입 비율 | 고침 | historyStart가 가장 이른 목록 기준이라 늦게 시작한 범위에서 부풀 수 있음(낮음) |
| M3 보정 기준점·보고 | 일부 | 실측 없는 키워드가 합에서 빠짐 |
| M4 잠금 만료 경쟁 | 일부 | 재계산 중 잠금 미갱신 |
| M5 출시 결과 연결 | 고침(표시까지) | 가중치 보정으로는 안 이어짐 |
| M6 소싱 초안 | 일부 | 카탈로그 상품이 정확히 1개일 때만, 화면은 catalogId를 보내지 않음 |
| M7 저자료 '관찰' 부풀림 | 고침 | |
| 낮음 항목 | 고침 | |

## 3. 3회차 결함과 이 PR의 반영

| 결함(심각도) | 반영 | 주요 위치 |
|---|---|---|
| H-1 이름 가림 세탁(높음) | 가림은 숫자 읽기에만 쓴다. 금지·방향·권고·'1위' 검사는 원문에 하고, 예외 이름은 고른 상품 자체 이름뿐(그 이름에 금지어가 없을 때) | `analytics/citation-check.ts`(`unsafeName`, `wordingMask`, `checkClaim`), `server-brief.ts`(`ownNames`) |
| H-3 금지어 목록 방식(높음) | 선정 메모 v4: 모델은 `{productId,row,kind,compareRow?}`만 내고 서버가 정해진 틀로 문장을 만든다(숫자·단위·방향이 구조상 정확). 모델 자유 글(요약 300자, 리스크 6줄)은 허용 어휘 약 200개로만 통과. 권고는 구조화 칸에만 있고 점수표 판정 이하 | `analytics/brief.ts`(`renderClaim`, `gradeClaims`, `scorecardRisks`), `server-brief.ts`(`observationTable`, `parseModelOutput`, `gradeModelOutput`), `citation-check.ts`(`FREE_TEXT_WORDS`, `checkFreeText`), `md-prompt.ts`(판 `pr-md-brief-v4`) |
| 이름 없는 권고 문장(중간) | 자유 글에서 권고 동사 자체를 금지(권고는 구조화 칸만) | `citation-check.ts` |
| 'A에서 B로'·화살표, 단위 불일치(중간) | 앞 값=이전 행, 뒤 값=나중 행일 때만 통과. 요약 숫자는 단위까지 대조 | `citation-check.ts` |
| 위험 확인 사유 낱말 하나 통과(낮음) | 흔한 말('광고'·'표현'·'리스크'·'위험')만으로는 불통과. 규칙마다 그 규칙의 말 또는 서버 사유 문장, 공백 빼고 10자 이상. 화면도 같은 함수(`reviewApprovalError`)로 막음 | `analytics/score.ts`, `ui-detail.ts`(`approvalWhy`) |
| H-2 백테스트 소급 이력(높음) | 후보 자격·특징은 기준 시점까지 **수집한** 스냅샷만. 소급 이력은 결과 채점에만 쓴다. 소급 비중 30% 이상이면 정밀도·순위 상관·기준선을 null과 사유로 | `server-pipeline.ts`(`asOfCut`, `BACKFILL_SHARE_MAX`) |
| M3 '< 10' 키워드 누락(중간) | '< 10'은 0~9 범위(대표값 5)로, 실측이 하나도 없는 키워드가 있으면 그 묶음은 보정하지 않고 사유를 남김. 보고에 행별 사유·범위·누락 | `analytics/calibrate.ts`(`groupAnchors`), `analytics/score.ts` 보정 구간, `server-pipeline.ts`(`calibrationReport`) |
| M4 재계산 잠금(중간) | 재계산 쓰기 단계마다 잠금 갱신, 잃으면 저장하지 않음(화면 작업은 409) | `server-ops.ts`(`refreshScores`), `server-pipeline.ts`, `server-collect.ts`, `server.ts` |
| M6 카탈로그 고르기(중간) | 화면 응답에 `campaignCatalogs`, 넘기기 상자에 카탈로그 선택(1개면 자동, 없으면 이유와 함께 비활성) | `server.ts`, `app/product-research-shared.tsx`, `api.ts` |
| ⑩ 오퍼 초안 | 넘기기 때 성장2 오퍼 초안(가격 없음·가격 미승인·랜딩 주소 없음)을 `growth-catalog.ts`의 검사 함수로 만든다. 사람이 가격을 정해 승인하기 전까지 준비 점검에서 막힘 | `server.ts` |
| ⑩ 가중치 재보정 제안 | 8주 판매 결과가 8건 이상이면 하위 점수별 순위 상관으로 w2 가중치를 **제안만** 한다(자동 적용 없음). 리포트 탭에 표·주의 사항 | `analytics/backtest.ts`(`proposeWeights`), `server-ops.ts`(`weightsCandidate`), `app/product-research-report.tsx` |
| ① 쇼핑인사이트 | 수집 계획에 데이터랩 쇼핑인사이트(하루 4회, 5개 키워드씩, 월~일 주 단위). 앱 하루 상한 50회(공급자 한도 1,000) | `server-collect.ts`, `collectors/quota.ts`, `collectors/naver-datalab.ts` |
| M2 historyStart(낮음) | 목록 범위별 시작 시각(`historyStartByScope`) | `analytics/competition.ts` |
| 출시 결과 집계 한도(낮음) | `ORDER BY sku,id`, 잘리면 해당 SKU 값은 null과 '집계 한도 초과' | `server-ops.ts` |

## 4. 변경 파일(`2c100e6..` 커밋 3개 + 이 문서)

- 커밋: `선정 메모 v4`(구조 주장·서버 틀 문장·자유 글 허용 어휘), `평가 3회차 서버·백테스트`(소급 이력·보정·잠금·카탈로그·오퍼 초안·재보정 후보·쇼핑인사이트), `화면 승인 관문을 서버 리스크 확인 규칙에 맞춤`.
- 화면: `app/product-research-report.tsx`, `app/product-research-shared.tsx`, `app/product-research-sources.tsx`
- 분석: `lib/product-research/analytics/{backtest,brief,calibrate,citation-check,competition,score}.ts`
- 서버·수집: `lib/product-research/{api,md-prompt,server,server-brief,server-collect,server-ops,server-pipeline,server-store,ui-detail}.ts`, `lib/product-research/collectors/{naver-datalab,quota}.ts`
- 테스트: `tests/product-research-{analytics,backtest,brief,server,server-backtest,server-ops,server-round2,ui-detail}.test.mjs`, 새 `tests/product-research-server-round3.test.mjs`, `e2e/product-research.spec.ts`
- 문서: `docs/PRODUCT-RESEARCH.ko.md`, 이 문서
- 합계 31개 파일(+1,159 / −242, 이 문서 제외). D1 migration 0, 의존성 0, 새 기능 스위치 0. 스위치는 기본 꺼짐 그대로다.

## 5. 실제 실행한 검사(2026-10-03, 이 컨테이너, 커밋 3개를 합친 트리)

| 명령 | 결과 | 근거 | 비고 |
|---|---|---|---|
| `npx tsc --noEmit -p .` | passed | real | 화면 관문 수정 뒤 |
| `node scripts/test.mjs` | passed | real | 315/315 suites, 18,405 assertions |
| `node scripts/lint-gate.mjs` | passed | real | errors 70 / warnings 39(기준선 그대로) |
| `tests/ux-budget.test.mjs` | passed | real | 64, 예산 올림 없음 |
| `tests/record-kinds.test.mjs` | passed | real | 54 |
| `tests/product-research-ui-detail.test.mjs` | passed | mocked | 60(화면 관문 = 서버 관문, '광고 확인 완료' 등 거절 사례 포함) |
| `node scripts/run-framework.mjs build` | passed | real | |
| E2E 1차(`product-research`·`ux-reach`·`ux-budget`·`ux-keyboard-tasks`·`execution`, 로컬 chromium·로컬 D1, 로그인 mocked) | failed 2 / passed 42 / skipped 2 | real | 실패 2건은 상품 리서치 승인 시나리오(모바일·데스크톱): 화면 막힘 문구를 서버 문장으로 바꿨는데 E2E가 옛 문장 '사유에 확인한 위험을 적으세요'를 찾음 |
| E2E 2차(`product-research`, 문구 기대값을 두 서버 문장의 공통 부분 '확인한 위험'으로 고친 뒤) | passed 4 | real | 모바일·데스크톱. 나머지 스펙은 1차에서 통과, 2차에서 다시 돌리지 않음 |

작업자 보고(각 작업 사본에서 실행, 이 컨테이너 결과와 별도):
- 선정 메모 v4: 우회 28가지 모델 출력 경로 사례가 이전 코드에서 23건 통과 → 0건, 올바른 메모는 통과. brief 256, analytics 243 assertions.
- 서버·백테스트: 새 `server-round3` 42 assertions. 소급 이력 재현(30개 중 늦게 추적한 15개만 후보, 정밀도@10 = 1.0)을 먼저 재현한 뒤 차단. E2E(`product-research`·`ux-reach`·`ux-budget`) 26 passed, 2 skipped. 4G LCP 예산이 전체 테스트와 동시 실행 중 한 번 2,516ms(기준 2,500ms)로 넘었고 단독 재실행에서 통과.

## 6. 남은 위험·인계 사항

- 레인 Q가 프롬프트 레지스트리에 `pr-md-brief-v4`를 등록해야 한다(이 레인은 레지스트리를 고치지 않는다).
- `server-brief.ts`의 `legacyToStructured`는 판 올림 전에 걸린 모델 작업만 받는 이행 경로다. `tests/product-research-server.test.mjs`의 모의 응답을 새 형식으로 바꾸면 지울 수 있다.
- 쇼핑인사이트 카테고리 코드는 네이버쇼핑 대분류로 넣었고 실제 키로 확인하지 않았다(not_run).
- 오퍼 초안은 성장 오퍼에 상태 칸이 없어 '가격 없음·가격 미승인'으로 초안을 표현한다.
- 4G LCP 예산은 동시 부하에서 한 번 넘었다(단독 통과). CI에서 다시 볼 것.
- 코드만으로의 상한은 평가자 추정 약 4.47. ④(12주 실데이터·정답셋 50건)·⑧(블라인드 평가자) 등은 실제 입력 없이는 4.5를 넘지 못한다.
- 이 PR은 병합·게시·기능 스위치 켜기·API 키 연결을 하지 않았다.
