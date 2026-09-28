# 세션별 레인과 개발 순서

결론: COLLECTIVE는 A·R·Q·G 네 레인으로 개발한다. 이 문서는 누가 무엇을 만들고, 어떤 파일을 고치고, 누가 게시하는지를 정한다. 같은 일을 두 세션이 하지 않게 하려는 문서이고, 다른 문서와 충돌하면 이 문서가 이긴다.

비유: 한 부엌에 여러 요리사가 있다. 각자 맡은 메뉴(레인)가 있고, 음식 내보내기(게시)는 한 사람만 한다. 주문판(STATUS)은 칸을 나눠 자기 칸에만 적는다.

- 결정: 대표 지시(2026-09-26 "계속 뭔가 앞서가있어서 중복업무를 하고있어보이는데 바로잡고 세션별 개발순서를 정리해서 중복업무를 없애").
- 작성: Claude A 세션. 레인을 바꾸려면 대표 확인을 받고 이 문서를 고친다.

### 레인 A: M5 예산 검토 첫 증분 (2026-09-28)
- `feat/meta-spend-approval`: lib/meta-budget-review.ts, app/api/meta-ads/budget, app/meta-budget-panel.tsx, Meta 탭 연결, 전용 tests/e2e, 레코드/삭제 목록 및 문서.
- 현재 계획·소재·계정·기간의 로컬 예산 검토/철회만 기록한다. 지출 승인·예약·외부 예산 변환·활성화는 제공하지 않는다. 실제 집행은 전체 외부 자산을 포함한 별도 승인 필요.

## 2026-09-28 M4 비활성 캠페인 공급자·전송 기록 경계

- 연속 개발 지시에 따른 후속. `feat/meta-paused-provider`, 기준 `8b437a0`, 게시 전 최신 main 통합.
- 소유: `lib/meta-paused-*`, `lib/meta-write-connection.ts`, 비활성 API/화면·전용 검사·문서. 공유 변경은 Meta 탭, feature-flags/회귀, record-kinds/삭제 표시·server 삭제 차단 1개 조건, M3 검수 공유 모듈 분리, 레인 A 상태다.
- PAUSED 판매 캠페인 1개 생성 경로까지. 새 meta_ads_paused_write 기본 꺼짐, 소유자 별도 쓰기 연결·현재 검수·전송 확인 필수. 이번 작업에서 운영 스위치를 켜거나 실계정 호출을 하지 않는다. 광고세트/광고·예산 활성화는 후속이다.

## 2026-09-28 Meta 수집 복구 보완

- 연속 개발 지시의 M1 후속. `feat/meta-sync-recovery`, 기준 `27c2162`에서 분리하고 게시 전 최신 main을 통합한다.
- 소유: Meta insights API/화면/전용 검사, `lib/meta-sync-state.ts`, 관련 문서. 공유 변경은 record-kinds/삭제 표시와 A 상태·릴리스 기록이다.
- 실패 상태 지속·같은 성과 재수집 시각 갱신까지. 자동 재시도/스케줄러·쓰기 권한·실광고 집행은 포함하지 않는다.

## 2026-09-28 M6 성과 대조 기반 증분

- 연속 개발 지시에 따라 M1/M2 자료를 먼저 대조한다. `feat/meta-performance-report`, 기준 `27c2162`. M3 CI 중 별도 작업 트리에서 시작했으며 병합 전 최신 main을 통합한다.
- 소유: `lib/meta-performance-report.ts`, `app/api/meta-ads/report/`, 보고 화면·검사·문서. 공유 변경은 Meta 탭, record-kinds/삭제 표시, A 운영/릴리스 기록이다.
- 기존 campaignAttribution·store_order를 재사용하고 Meta 보고·장부·캠페인 귀속·증분을 분리한다. 실제 집행/자동 확대나 전체 M6 종료를 주장하지 않는다.

## 2026-09-28 M3 소재·실험 검수 증분

- 같은 연속 개발 지시에 따른 후속. `feat/meta-creative-review`, M1 기준에서 시작해 M2 병합 `27c2162`를 통합했다.
- 소유: `lib/meta-creative-review.ts`, `app/api/meta-ads/creative/`, 전용 화면·검사·문서. 공유 변경은 Meta 탭 연결, record-kinds/삭제 표시 등록, A 운영/릴리스 기록이다.
- 기존 소재·확정 사실·실험을 연결하고 검토 판을 보존한다. 기존 실험 원장을 복제하거나 광고 생성/활성화를 수행하지 않는다.

## 2026-09-28 M2 주문/환불 증분

- 같은 연속 개발 지시에 따른 후속. `feat/storefront-order-ledger`, 최초 기준 `5a5ea8c`에서 시작해 M1 병합 `e8fce70`을 통합한다.
- 소유: `lib/storefront-orders.ts`, `app/api/storefront-orders/`, 전용 주문 대조 화면·CSS·검사·문서. 공유 변경은 Meta 탭 연결과 record-kinds 등록, A 운영/릴리스 기록이다. 기존 점포 장부 구조와 귀속 코드는 변경하지 않는다.
- 외부 개정에 따른 기존 store_order 반영·환불/중복/역순 검증까지, 외부 고객 전환 전송·몰 계정 생성은 수행하지 않는다.

## 2026-09-28 성장2 잔여 개발 연속 진행

- 대표의 “남아있는 개발사항 내가 멈추라고할때까지 계속 진행하라” 지시로 기존 Meta 담당 Codex가 M1~M6 코드·검증·통합·게시를 순차 진행한다. 기존 공개 저장소·병합·운영 배포 승인을 유지한다.
- 첫 증분 기준 `5a5ea8c`, 브랜치 `feat/meta-ads-insights`. 소유: Meta 전용 모듈·API·화면·검사·문서. 공유 변경은 암호화 자격증명 재사용, 삭제 정책 등록, 레인 A 상태 기록으로 한정한다.
- 실제 광고비 집행·고객 전환 전송은 개발 승인과 구분하며 기본 비활성이다. 실계정 자료가 없으면 실서비스 검증을 blocked로 기록하고 다음 구현을 진행한다. 기존 R/Q/G/I 작업은 가져오지 않는다.

## 2026-09-28 Meta 준비 UI/UX 개선

- 대표의 “계속 진행하라”와 베타 UI/UX 개선 지시로 기존 Meta M0 담당 Codex가 화면 개선·검증·게시를 이어간다.
- 기준 `3ac2c46`, 브랜치 `feat/meta-ads-guided-workspace`. 소유: `app/meta-ads-panel.tsx`, 전용 CSS 모듈, `e2e/meta-ads.spec.ts`, Meta 문서와 레인 A 상태. 인터뷰 PR #248 및 다른 레인의 공유 화면은 변경하지 않는다.
- 판매 목표 → 상품과 수익 → 예산과 일정 → 준비 점검, 입력 기준 실시간 요약, 미완성 저장과 재조회가 수용 범위다. 기존 API 권한·버전 충돌·집행 차단은 유지한다.

## 2026-09-28 성장2 Meta M0 착수

- 대표의 “개발 진행하라” 지시로 이번 Codex 세션이 성장2 E-M M0 구현·통합·게시를 담당한다. 이전 공개 저장소 업로드·PR 병합·운영 배포 승인 범위다.
- 기준 `9ac45ed`, 브랜치 `feat/growth2-meta-readiness`. 소유: `lib/meta-ads.ts`, `app/api/meta-ads/`, `app/meta-ads-panel.tsx`, 전용 검사·문서. 공유 파일은 `app/panels.tsx` 탭 연결, `lib/record-kinds.ts`·`lib/deletion-summary.ts` 삭제 정책·표시 등록만 한다. 기존 R/Q/G 진행 작업은 가져오지 않는다.
- M0 로컬 계획 저장·준비도·버전 충돌·역할/캠페인 격리·집행 차단을 이번 수용 범위로 한다. M1~M6와 실제 계정 연결·광고비 집행·전환 전송은 별도 후속이며 이번 저장은 승인으로 쓰지 않는다.

## 성장계획1 마감의 공통 기준 (2026-09-27)

### 2026-09-28 최종 통합 담당 인계

- 대표 지시(2026-09-28 09:48 KST, ChatGPT): “너가 이거 최종 마무리까지 진행해줘.” 직전 보고의 필수 #216·#218·#219·#225 통합, 검사, 운영 배포, 종료 기록을 이번 Codex 세션이 맡는다. 이 범위에서 A의 통합·게시·마감 역할과 필요한 G/Q 충돌 수정을 인계한다.
- 브랜치 `codex/growth1-final-closeout`, 시작 main `ea5b9314e0771c322854cf9c53c458f1a353620c`. 원 PR 커밋을 부모로 보존해 하나의 통합 PR로 검증·병합하며, 기존 변경을 강제 푸시하거나 덮어쓰지 않는다. 최신 main에 맞춘 최종 SHA 선택과 묶음 게시도 위 지시 범위다.
- 이 마감 중 다른 세션은 동일 네 PR의 병합·게시를 중복 실행하지 않는다. 트랙 R 신규 기능, 인터뷰 전사 설치, 외부 SNS 게시·광고 집행·고객 발송, 새 기능 활성화 게이트 완화는 이 인계 범위가 아니다.
- 개발 종료 기준은 그대로다. 소유자 운영 확인이 막히면 `blocked`와 실제 원인을 남기며, 실제 주문·사람 라벨·기간 관측은 기존 담당과 재개 조건으로 인계한다.

- 대표 요청 “성장1 개발을 어디까지 진행시키고 클로즈하면 될지 모든 세션이 공통적으로 파악할수있도록 기준을 잡아줘”에 따라 [성장1 공통 종료 기준](GROWTH-1-CLOSEOUT.ko.md)을 적용한다.
- 종료 범위·필수 C01~C12·개발 종료/운영 인수/효과 검증·성장2 전환은 그 문서가 정한다. 담당·파일 소유·게시 권한은 이 문서를 그대로 따른다.
- G는 승인된 잔여 코드와 B5 리플레이 복원을 마감하고, Q는 평가 연결·활성화 판정/보류·운영 감시를, A는 통합·게시·실사용 인수와 최종 종료 기록을 맡는다. R 전체 마감은 성장1 종료 조건에 추가하지 않는다.
- 진행 중 세션도 다음 PR/병합 전에 공통 기준을 대조한다. 공유 파일에서 성장2 기능을 별도로 중복 개발하지 않는다. 실제 주문/라벨/관측 기간 대기는 담당·재개 조건·다음 확인일로 인계한다.

## 왜 바꾸나 (2026-09-26 관찰)
- 최근 PR 25개 중 24개가 `docs/STATUS.md`를 고쳤다. 대부분 같은 줄(`마지막 갱신`, 운영 표)이다. 그래서 병합할 때마다 충돌이 나고 CI를 다시 돌렸다(#129·#130·#133 등).
- 게시를 세 곳이 했다. 버전 36은 트랙 R, 37~39는 Codex, 40은 Claude A가 했다. 운영 기록도 세 곳이 따로 적었다(#131, #135, STATUS 운영 표).
- STATUS와 HANDOFF에 같은 절이 복사돼 있다(HERMES 평가 실패 복구, 운영 API 복구 등).
- HANDOFF의 '다음 작업'이 세 레인을 한 목록에 섞어서, 누가 할 일인지 분명하지 않았다.

## 레인

| 레인 | 세션 | 맡는 일 | 게시 |
|---|---|---|---|
| **A** 제품 기능 | Claude A 세션 | 성장 계획 A·B 트랙 제품 기능(`docs/GROWTH-PLAN.ko.md`). A3·A6 마무리, A8, B4 2부, B3, 조건부 A5 | **게시 담당(단독)** |
| **R** 가맹 모집 | Claude 트랙 R 세션 | 트랙 R 전체(`docs/FRANCHISE-RECRUITMENT-PLAN.ko.md`) | 하지 않음. 게시 대기열에 적는다 |
| **Q** 품질·평가·운영 | Codex 세션 | 품질 계획 v2 잔여(R4·A/A·R5·J4), 평가 하네스·HERMES·품질 콘솔, 프롬프트 레지스트리 운영(A1 `channel.offline` 쌍 평가·활성화), 게시 뒤 운영 감시 | 하지 않음. 게시 대기열에 적는다 |
| **G** 성장 계획 잔여 개발 | Claude G 세션(roybee-86) | 대표 지시(2026-09-27 "코드 쪽 남은 것 전부 개발·배포·게시까지")로 맡은 성장 계획 잔여 코드: B3-2 Reflector, PR 4b 잔여(`loop-1`·`loop-2`·`loop-10`·`security-ops-5`·`-6`·`ai-quality-9`), B2 2단계, A4-4, A1 커머스·감사 묶음 콘텐츠, 비식별 신호 채점기 버전 결함 | 하지 않음. 게시 대기열에 적는다 |

- 레인에 없는 새 일이 생기면, 먼저 발견한 세션이 STATUS의 자기 레인 칸에 "제안"으로 적고 대표 확인을 받은 뒤 이 표에 더한다.
- 다른 레인의 PR을 대신 병합하거나 고치지 않는다. 막히면 그 레인 칸의 '막힌 것'에 적는다.

## 레인 I — 브랜드 인터뷰 (2026-09-27 대표 신규 지시)

- 담당: 이번 Codex 세션. 대표의 브랜드 인터뷰·파일 드롭·녹음·자동 정리 개발 지시로 승인된 독립 작업이다. 기존 A/R/Q/G 업무를 가져오지 않는다.
- 브랜치: `feat/brand-interview-studio`. 소유: `lib/brand-interview*`, `app/brand-interview-panel.tsx`, `app/api/archive/interview/`, `server/interview-transcriber/`, 전용 검사·문서.
- 기존 파일 최소 연결: `app/brand-archive.tsx` 인터뷰 탭, `app/api/archive/file/route.ts` 음성 형식, `app/globals.css` 전용 스타일.
- 게시는 하지 않는다. 음성 서비스 설치/실제 검증 뒤 레인 A가 검토하여 묶음에 포함한다. 성장1 마감 조건에 추가하지 않는다.

## 레인별 개발 순서

### 레인 A (Claude A 세션)
1. A3·A6 종료 조건 run. 묶음 14(Sites 버전 40)에 실렸다.
   - A6: 점포 브랜드 자료 요청 1건이 사실 확정으로 닫힘(real, 토큰 0). 사실 확정은 대표가 한다.
   - A3: 골든 v2 dev 2건(예약 100k, 실측 약 30k). 스위치를 켜는 것은 대표 확인 뒤에 한다.
2. A8 고객 보고서·사실 지식 팩(LLM 0). 선행 A4·B2·F2는 `merged`다. 화면은 PR 5 범위다.
3. B4 2부 보상 계보. 결정 16(첫 실게시)을 먼저 확인한다.
4. B3 교정 플레이북. `lib/learning.ts`와 역할 입력을 고친다. 레인 R의 R3b가 병합된 뒤 시작한다(아래 공유 파일 순서).
5. 조건부 A5, B5 GEPA, B4 3부. W24 발동 조건을 확인한 뒤 착수하거나 `not_run`을 기록한다.

### 레인 G (Claude G 세션, roybee-86)
- 결정: 대표 지시(2026-09-27). B2 2단계는 같은 날 오전 "B2 2단계 빼고" 지시를 대표가 다시 확인해 포함했다("포함해서 개발").
- 한 작업 = 한 PR, base는 항상 `main`, 새 런타임 동작은 기본 꺼짐 스위치 뒤에 둔다. 병합 뒤 게시 대기열에 요청 줄을 넣고 게시는 레인 A가 묶음으로 한다.
1. 병렬(파일이 겹치지 않음): `security-ops-6` 키 회전, B2 2단계, B3-2 Reflector, A4-4, A1 커머스·감사 콘텐츠, `ai-quality-9`+`loop-10` 입력 축소, 채점기 버전 결함(#206).
2. `loop-1`+`security-ops-5`(성과 수집 화면·실패 표시) → 병합 뒤 `loop-2`(게시물과 실험 arm 연결). 같은 파일(`lib/measurement-collection.ts`, 학습 화면)을 쓰므로 순서대로 한다.
- 레인 Q로 넘기는 것: A1 새 묶음의 등록·봉인 쌍 평가·stage·promote(세션 29f7af), 입력 축소 스위치를 켜기 전 on/off 쌍 평가.
- 레인 A와 겹치는 파일: `lib/learning-server.ts`는 레인 A 소유라 Reflector는 새 모듈(`lib/playbook-reflector*`)에 두고 호출 1줄만 더한다. 설계는 PR로 레인 A에 공유한다.
- 조건부 A5·B5 GEPA·B4 3부는 위 레인 A 5번 그대로 둔다(W24 판단).

### 레인 R (Claude 트랙 R 세션)
1. R3b 새 채널 단위 6개. `prompts/channel.*`, `lib/prompt-units.ts`, `lib/role-instruction.ts`, `lib/meetings.ts`를 고친다.
2. R15a-2 모집 자료 키트 기록·API·화면. `lib/record-kinds.ts`를 고친다.
3. 그 뒤는 트랙 R 계획 순서를 따른다(R3c `lib/graders/industry.ts`, R5 등).

### 레인 Q (Claude 29f7af 세션)
- 결정: 대표 지시(2026-09-27 "이 세션이 모두 맡기"). Codex 세션이 맡던 레인 Q를 Claude 29f7af 세션이 인계받았다.
1. 평가 연결·활성화 판정/보류: A1 새 묶음(`channel.commerce`·`channel.shortform`)의 봉인 반복 3회 과반 평가 → 대표 stage 선택 → promote, 입력 축소(C07) on/off 쌍 평가 연결과 판정, `viral.discovery`는 바이럴 분석 케이스 준비 뒤 activate.
2. 사람 라벨 R4(주 20건)·A/A 10건(10월)·R5 채택 판정 → J4 게이트. 채택 전 AI judge는 차단 게이트로 쓰지 않는다.
3. 게시 뒤 24~72시간 운영 감시(`invalid_output` 비율, 5xx, Workers CPU). 기준과 결과는 [레인 Q 성장1 마감 기록](observations/2026-09-27-lane-q-growth1-closeout.md)과 자기 레인 칸에 적는다.
- #131·#135(Codex 기록)는 대체 기록으로 옮기고 닫았다.
## 게시 (레인 A 단독)
- 게시는 레인 A만 요청한다. 방식은 자동 게시(`docs/PUBLISH.ko.md` 8절)다. 다른 레인은 Sites 편집기 붙여 넣기도, 게시 요청 PR도 만들지 않는다.
- 다른 레인이 게시가 필요하면 STATUS의 **게시 대기열**에 한 줄을 적는다(병합된 PR 번호, 급한 정도, 스위치 기본값).
- 레인 A는 대기열을 모아 묶음으로 게시한다. 급한 수정은 바로 게시한다.
- 게시 뒤 운영 확인(`runtime-verified`)은 `/api/version/public` curl과 소유자 `/api/version`으로 하고, 게시 기록(`docs/releases/`)은 레인 A가 쓴다.
- 롤백은 운영 장애 때 어느 레인이든 대표 확인을 받고 할 수 있다. 한 뒤에는 레인 A 칸에 알린다.

## 공유 문서 규칙
- **`docs/STATUS.md`**
  - 각 레인은 자기 칸(`## 레인 A`·`## 레인 R`·`## 레인 Q`·`## 레인 G`)만 고친다.
  - 칸마다 첫 줄이 그 레인의 `갱신:` 시각(UTC)이다. 파일 전체의 `마지막 갱신` 줄과 `현재 운영 상태` 표, `게시 대기열`은 게시 담당(레인 A)만 고친다.
  - 다른 레인 칸이나 공용 표가 틀렸으면 고치지 말고, 자기 칸에 "확인 필요: …"로 적는다.
- **`docs/HANDOFF.ko.md`**
  - '일하는 방법'(검증 명령, 평가 run 방법, 함정)만 둔다. 상태·결과 절은 STATUS에만 적고 HANDOFF에 복사하지 않는다.
  - '다음 작업'은 이 문서의 레인별 개발 순서를 가리킨다.
- **게시 기록 `docs/releases/`**: 레인 A만 쓴다.
- **관찰 기록 `docs/observations/`**: 만든 레인이 쓴다. 파일 이름에 레인이 드러나게 한다.

## 공유 코드 파일 순서
두 레인 이상이 고치는 파일은 아래 순서로 병합한다. 먼저 병합된 쪽이 이기고, 뒤에 오는 쪽은 최신 `origin/main`을 merge한 뒤(강제 푸시 금지) 이어 붙인다.

| 파일 | 소유(먼저) | 뒤에 오는 레인 | 규칙 |
|---|---|---|---|
| `lib/graders/index.ts` `GRADERS_VERSION`, `lib/graders/compliance-lexicon.ts` | Q | A, R | 채점기·사전 추가는 태그를 이어 붙인다. Q의 채점 기준 변경 PR이 열려 있으면 그 뒤에 병합한다 |
| `prompts/`, `lib/prompt-units.ts`, `lib/role-instruction.ts`, `lib/meetings.ts` | R(R3b) | A(B3) | R3b 병합 뒤 B3 착수 |
| `lib/role-execution.ts`, `lib/meeting-execution.ts`, `lib/brief-execution.ts`, `lib/execution-server.ts` | 먼저 연 PR | 나머지 | 호출 1줄 수준만 더한다. 스위치는 `*-server.ts` 보조 모듈에서 읽는다(구조 규칙 `tests/franchise-objective.test.mjs` 6) |
| `lib/record-kinds.ts`, `lib/feature-flags.ts`, `lib/feature-status.ts` | 먼저 연 PR | 나머지 | 끝 고정 묶음 앞에 자기 레인 항목을 붙인다. 고정 목록 테스트는 자기 항목만 더한다 |
| `lib/learning.ts`, `lib/learning-server.ts` | A | — | B3·B4 2부 |
| `lib/franchise-*`, `app/api/franchise*` | R | — | |
| `app/api/workspace/route.ts`, `lib/workspace-metrics.ts` | A | R | 레인 R 기능(워크스페이스 할 일 등)은 `lib/franchise-*` 순수·서버 모듈에 두고, 이 파일에는 호출 1줄 수준만 더한다. 스위치(`r_franchise`)는 `lib/franchise-*-server.ts`에서 읽는다. 1줄로 안 되면 레인 A에 요청한다(2026-09-27, R6d) |
| `lib/eval-*`, `lib/online-grading.ts`, `lib/prompt-registry.ts`, `scripts/eval/` | Q | — | A·R가 고쳐야 하면 Q 칸에 요청한다 |

## 세션 시작 점검 (모든 레인)
1. 이 문서와 [성장1 공통 종료 기준](GROWTH-1-CLOSEOUT.ko.md), STATUS의 자기 레인 칸, 게시 대기열을 읽는다.
2. `gh pr list`로 다른 레인의 열린 PR이 고치는 파일을 보고, 위 표의 순서를 지킨다.
3. 다음 일은 자기 레인 개발 순서의 맨 위에서 고른다. 다른 레인 목록의 일은 하지 않는다.
