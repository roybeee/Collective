# 품질 계획 v2 로드맵

비유: 시험 문제를 늘리고, 새 채점관에게는 대표와 눈높이가 맞은 과목만 맡깁니다.

- 기준: `origin/main` `7b897c9`. 케이스 확대 설계, AI 심사 설계, 두 설계의 교차 검토를 한 장으로 합친 계획이다.
- 정본 나누기: 현재 상태는 [현재 상태](STATUS.md), 평가 하네스·채점기는 [평가 하네스](EVAL.ko.md), AI 심사 루브릭·보정 절차는 [AI 심사](JUDGE.ko.md), 설계 원칙·결정 5(평가 예산)는 [성장 계획](GROWTH-PLAN.ko.md)이 정본이다. 이 문서는 PR 순서·실행 단계·대표 승인만 적는다.
- 아래 PR 상태는 이 문서를 쓴 시점(2026-09-24 UTC)의 값이다. 바뀌면 STATUS.md를 먼저 고친다.

## 결론

측정 v2를 병합한 뒤 평가 공통 골격(종류별 처리·예약량·월 승인)부터 깝니다. 이어서 골든셋 v2(9캠페인 105케이스: dev 72, 봉인 33)를 합성 생성기로 만듭니다. AI 심사는 표본이 30건을 넘는 3기준만 대표 라벨로 보정하고, 막는 용도로만 씁니다.

- PR은 10개이고 주 1.5개 속도(성장 계획 원칙 11)로 약 7주 걸립니다.
- R1~R5는 PR이 아니라 실행입니다. 결과는 `docs/observations/`에 남깁니다.

## 흐름

0. 전제: 측정 v2 병합(`feat/quality-measure-v2`, `origin/main` `7b897c9`에 아직 없음). G0에서 운영 화면으로 ODA 역할·완료 회의·브리프 초안이 있는지 확인합니다(토큰 0). C1이 3역할뿐이면 합성 dev S6·S7에 S8을 더합니다.
1. 기반: Q1 → Q2. G1·J1·G3은 병렬로 진행합니다.
2. 케이스: G2 → G4 → R1 → R2 → R3.
3. 심사: J2 → J3 → R4 → R5 → J4.

## PR 10개

수용 항목과 실패 사례는 모두 필수 자동 테스트다. 소유 파일은 PR마다 소유자 1명이고, 특히 `lib/eval-server.ts`는 소유자를 1명으로 둔다.

| PR | 목표 | 소유 파일 | 의존 | 상태 |
|---|---|---|---|---|
| Q1 | 평가 종류 골격: kind별 build·grade·reserveOf, 역할 평가도 운영과 같은 조립(선호 규칙까지 동결), externalKey 멱등 | `lib/eval-kinds.ts`(신규), `lib/eval-server.ts`, `lib/role-execution.ts` | 측정 v2 | 미착수 |
| Q2 | 월 승인 레코드 `eval_budget_approval{month,cap,reason,by}`로 월 상한을 코드에서 강제 | `lib/eval-budget-server.ts`(신규), `lib/record-kinds.ts` | Q1 | 미착수 |
| G1 | 조립 공개: 회의 `context()`·`MEETING_MASK_PATHS` export, `briefRequestFor`(contextDate 인자) 신설 | `lib/meeting-execution.ts`, `lib/brief-execution.ts`, `lib/brief-input.ts`(신규) | 없음 | 진행 중(`feat/eval-assembly-export`) |
| J1 | AI 심사 루브릭·보정 통계(모델 호출 없음): 7기준 루브릭·도구 금지 지시, 인용 파서, 가중 κ·Spearman·부트스트랩 하한, 채택 판정 | `lib/judge-rubric.ts`, `lib/judge-kappa.ts`, `docs/JUDGE.ko.md`, 이 문서 | 없음 | 진행 중(`feat/judge-rubric-kappa`) |
| G3 | 채점기 추가와 업종 배열(주 업종+허용 업종), `GRADERS_VERSION` 올림 | `lib/graders/*`, `docs/EVAL.ko.md` | 측정 v2 | 미착수 |
| G2 | 회의·브리프 kind: kind별 frozenRequest·채점, 운영과 같은 가림 뒤 capture | `lib/eval-kinds.ts`, `lib/eval-server.ts` | Q1, G1, G3 | 미착수 |
| G4 | 합성 케이스 생성기·가져오기(결정 런타임, `import_cases`) | `scripts/eval/synthesize-cases.mjs`, 결정 런타임, 샘플 스펙 1개, `/api/eval` `import_cases` | G2 | 미착수 |
| J2 | 보정 라벨: `judge_label`(parent eval_run), `/api/eval` 라벨 액션, 소유자 전용 탭 | `lib/record-kinds.ts`, `lib/judge-labels-server.ts`, `app/api/eval`, `app/quality-console-panel.tsx` | Q1 | 미착수 |
| J3 | 심사 실행: `eval_run` variant `judge`(월 합산에 그대로 들어감), 인용·이유는 `judge_output`에 | `lib/eval-judge-server.ts` | Q2, J1 | 미착수 |
| J4 | 게이트: 채택된 기준만 `judge_regression`으로 막고, 평가 게이트웨이 해시가 바뀌면 자동 강등 | `lib/eval-stats.ts`, `lib/prompt-registry.ts`, `lib/quality-digest.ts` | J3, R5 | 미착수 |

### PR별 수용·실패 사례

| PR | 수용·실패 사례(필수 자동 테스트) |
|---|---|
| Q1 | 기존 11건의 promptHash가 바뀌지 않는다. 선호 규칙이 있는 케이스 1건이 운영 제출과 바이트까지 같다. 같은 externalKey에 다른 specHash가 오면 409다. `budgetOf`·`stopReason`·`monthlyCapReached`가 모두 `reserveOf`를 쓴다. |
| Q2 | 실패 사례: 지금은 `overBudgetApproved`에 `monthly_cap`이 있으면 월 누적을 보지 않는다. 앞으로는 승인 cap을 넘는 제출이 `monthly_cap_reached`로 멈춰야 한다. |
| G1 | 회의 단계 5종, 교정 재시도, 날짜를 고정한 브리프가 운영과 바이트까지 같다. 지시문은 기존 `meetingInstructions`를 재사용한다. |
| J1 | 실패 사례: 없는 인용, 적용표 밖 점수, 입력에 expectations나 모델명이 있으면 무효다. AB·BA 쌍 판정은 뺀다. |
| G3 | 추가 채점기: `meeting_step_contract`, `revision_repeat`, `seeded_defect_detection`, `brief_contract`, `brief_instruction_violation`, `brand_intro_as_fact`(원장 구역). 기존 11건의 재채점 차이를 기록한다(0을 요구하지 않음). MAPDAL에서 음식 용어 때문에 새 fail이 나지 않는다. |
| G2 | 두 번 가린 결과가 한 번 가린 결과와 같다. `pairCases`는 `meeting.snapshot.campaign`을 쓴다. 브리프는 쌍 평가에서 뺀다. `byteIdentical`은 attempt 0의 지시문·입력만 비교하고 `assembly_drift`만 경보한다. |
| G4 | 두 번 실행한 결과가 바이트까지 같고 네트워크 호출은 0회다. 거부 조건: 분기 체크리스트 누락, pii-scan 탐지, 입력에 없는 prohibitedTerms, 생성 커밋과 app-version 불일치. 합성 id는 `syn-` 접두사, 봉인 스펙·출력은 저장소 밖에 둔다. 업로드는 소유자, 캠페인당 1MB 이하. |
| J2 | 실패 사례: 관리자가 쓰려 하면 403이다. 화면(DOM)에 run id나 variant가 보이면 실패다. 표시 id와 순서는 무작위이고, 라벨을 저장하기 전에는 심사 점수를 숨긴다. 라벨이 있는 run은 `delete_run`을 거부한다. |
| J3 | 목록 GET에 인용이 없다. compare는 judge run을 거부한다. 입력은 `buildJudgePrompt`로 만든 가림 렌더본, 브리프 요약(목표·타깃·KPI·채널·예산 확정 여부, 금지 표현은 골든 라벨이 아니라 constraints 원문), 확정·거절 사실, 가린 aiBrand, 상류 발췌다. run이 보고한 모델 id·별칭, 평가 연결 model, promptVersion·promptHash, variant 이름을 `denyTerms`로 넘긴다. `judge_output`에 저장하기 전에 `reason`을 가린다. |
| J4 | pairRunId·judgeRunId로 같은 rubricVersion, 같은 평가 게이트웨이 해시, 봉인 양쪽 심사 완료를 확인한다. 임계값은 A/A 잡음의 95% 분위로 정하고, 2점 하락은 재심사 1회로 확인한 뒤 막는다. |

## 실행 단계 R1~R5

| 단계 | 내용 | 토큰(추정) | 선행 |
|---|---|---|---|
| G0 | 운영 화면으로 ODA 역할·완료 회의·브리프 초안 유무 확인 | 0 | 없음 |
| R1 | 봉인 케이스 저장. `sealed_missing`을 푼다(지금 11건이 모두 dev라 쌍 게이트가 늘 막힌다) | 0 | G4 |
| R2 | 파일럿 8건. 250k 이하 run 2회로 단계별 입력 토큰과 300초 무응답 한도를 실측한다 | 0.2M | R1 |
| R3 | dev 기준선(단일 run, tokenBudget 2.0M)과 A/A 10건(같은 active를 두 번 돌려 잡음 바닥을 잰다) | 1.6M + 0.21M | R2, Q2 |
| R4 | 대표 라벨. 라벨을 저장한 출력만 심사한다 | 심사 달 약 1.04M | J2, J3 |
| R5 | 채택 판정([AI 심사](JUDGE.ko.md) 채택 조건) | 0 | R4 |

- 기준선 달(10월 예정) 합계: 파일럿 0.2M + 기준선 1.6M + A/A 0.21M = 2.0M, S8을 더하면 2.2M이다. 이 달만 월 상한을 2.4M으로 올리는 승인을 요청했다(대기, 아래). 승인 전에는 R3을 돌리지 않는다.
- 심사를 하는 달은 약 1.04M이라 기본 월 상한 1.5M 안이다.
- 파일럿 평균이 추정의 1.2배를 넘으면 멈추고 다시 보고한다.

## 대표 승인 기록

| 날짜 | 결정 원문 | 내용 | 반영 |
|---|---|---|---|
| 2026-09-24 | '판정 라벨링 …' → '오케이' | 대표가 사람 보정 라벨링에 참여한다. 측정 42건, 앵커 맞춤 10건(κ 제외), 2주 뒤 재라벨 10건, 주 20건씩 3주 | J2·R4·R5, [AI 심사](JUDGE.ko.md) 사람 보정 |

### 승인 요청(대기)

| 요청 | 내용 | 반영 |
|---|---|---|
| 평가 토큰 상한 증액 | 기준선을 돌리는 달(10월 예정)만 월 상한 1.5M → 2.4M. 기준선 run 1회 tokenBudget 2.0M. 파일럿 평균이 추정의 1.2배를 넘으면 중단하고 다시 보고한다 | 승인되면 Q2 월 승인 레코드로 강제, R2·R3 |

- 이 요청은 케이스 확대 설계와 AI 심사 설계가 각자 내던 증액 요청을 한 장으로 합친 것이다. 두 설계의 개별 요청 문안은 쓰지 않는다.
- 승인 원문(시각·문구)을 확인하면 이 행을 위 승인 기록으로 옮긴다. 그 전까지 이 증액을 예산 근거로 쓰지 않는다.
- 결정 5(월 1.5M, 스모크 1회 250k, 초과는 건별 승인)는 그대로다. 증액이 승인돼도 기준선 달 한 달에만 적용한다.
- Q2가 병합되기 전 코드는 월 상한이 상수(`EVAL_MONTHLY_TOKEN_CAP`)이고 승인 run은 월 누적을 보지 않는다. 그래서 R3은 Q2 병합 뒤에 돌린다.

### 아직 결정하지 않은 것

- 활성화 쌍 평가: 결정 5에 따라 건별로 승인받는다.
- 관리자 이중 라벨(20건 이상): 관리자 권한 확대를 결정한 뒤에 한다. 그 전까지 라벨은 대표 단독이다.
- [데이터 처리](DATA-PROCESSING.ko.md) E1 행 확장(회의·브리프 요청 동결, 평가 출력 재전송). 평가 출력을 심사로 다시 보내는 것은 지금 E1 행에 없는 새 전송이라, J3가 보내기 전에 갱신해야 한다.
- 선택: 다른 기반 모델을 쓰는 심사 전용 프로필.

## 위험과 완화

| 위험 | 완화 |
|---|---|
| 합성 입력이 운영보다 깨끗하면 품질이 부풀려진다 | 분기 체크리스트를 강제한다. 합성 케이스와 C1·C2 capture의 채점기별 fail률·출력 길이를 나란히 보고한다 |
| 회의 입력이 32k 토큰을 넘으면 `input_budget`이 게이트를 막는다 | R2 파일럿으로 실측한 뒤 kind별 적용 여부를 정한다 |
| 봉인 세트가 샐 수 있다 | 프롬프트를 고치는 레인이 아닌 사람이 생성한다. 봉인 스펙·출력은 저장소 밖에 둔다 |
| 심사 κ가 낙관적으로 나올 수 있다 | 봉인 출력과 결함을 심은 출력은 κ 계산에서 분리한다. 앵커 맞춤 10건은 κ에서 뺀다 |
| `lib/eval-server.ts`에서 충돌이 난다 | 이 파일의 소유자를 1명으로 둔다 |
| 증액 승인이 코드로 지켜지지 않는다 | Q2 월 승인 레코드가 병합된 뒤에 R3을 돌린다 |
