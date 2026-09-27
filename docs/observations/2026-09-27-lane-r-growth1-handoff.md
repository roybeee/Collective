# 레인 R 성장1 마감 인계 기록 (맥 세션)

- 기준: [성장1 공통 종료 기준](../GROWTH-1-CLOSEOUT.ko.md) 1절 3항(공유 변경 회귀는 소유 레인이 해결), 3절 C09·C12, 5절 '실제 키 회전·Q/R 키 확대' 행, 8절 4항 서식. 레인 A가 최종 판정 기록에 이 파일을 링크한다.
- 범위: 트랙 R 전체 마감은 성장1 종료 조건이 아니다(기준 1절 3항). 이 기록은 레인 R이 성장1 마감에 지는 의무(회귀 대조, 5절 공동 담당 행)만 다룬다. 기준 문서 자체는 고치지 않았다.
- 작성: 2026-09-27 22:55 KST (13:55 UTC), Claude 레인 R 맥 세션(대표 지시 "R 라인은 계획되어있는거 계속 개발해서 마무리하라"). 기준 main `431e417`(#227).
- 상태 어휘는 AGENTS.md를 따른다. 모든 가맹 판정은 'COLLECTIVE 휴리스틱 · 법률 자문 아님'이다.

## 1. 회귀 확인 (C12 레인 R 몫)

### 1.1 최신 main 전체 테스트

- 명령: `node scripts/test.mjs`(main `431e417`, macOS 대소문자 무시 파일 시스템, `core.ignorecase=true`).
- 결과: **passed · mocked**. 184/184 스위트, 12,670 assertions, 실패 0.

### 1.2 레인 R PR의 레인 밖 변경 대조 (#173~#209)

- 대상: 레인 R이 병합한 21개 PR. #173·#175·#176·#177·#180·#182·#183·#185·#186·#188·#191·#192·#193·#194·#195·#197·#200·#203·#204·#208·#209. 그 사이 번호(#174·#178·#179·#181·#184·#187·#189·#190·#196·#198·#199·#201·#202·#205·#206·#207)는 다른 레인 PR이라 뺐다.
- 방법: 각 병합 커밋의 `git show --name-status`와 `--numstat`에서 레인 R 소유 경로(`lib/franchise*`·`app/franchise*`·`app/api/franchise`·`tests/franchise*`·`tests/recruitment*`·`tests/lead-import*`·`e2e/franchise*`·`docs/FRANCHISE*`·`docs/observations/*lane-r*`·`tests/fixtures/r2-*`) 밖의 파일을 모으고, 지운 줄을 하나씩 읽었다.
- 결과: **삭제·이름 바꾼 파일 0건. 레인 밖 라우트·기능 삭제 0건.** 레인 밖에서 지운 줄은 모두 같은 줄을 넓혀 다시 쓴 것이다(목록에 항목 추가, 문구 연장, 버전 태그 이어 붙이기).

| 레인 밖 파일 | PR | 바뀐 것 | 판정 |
|---|---|---|---|
| `lib/graders/index.ts`, `lib/graders/industry.ts`(Q 소유) | #173 R3c | `GRADERS_VERSION`에 `+franchise-industry` 태그를 이어 붙임, 업종 사전에 franchise 3줄 추가 | LANES 공유 파일 규칙대로(태그 이어 붙이기). 태그 뒤에 다른 레인 태그(`+revision-labels+viral-analysis`)가 이어졌고 지금도 남아 있다 |
| `tests/brand-voice`·`copy-pack`·`eval-server`·`graders-meeting-brief`·`meeting-copy-pack`·`r3c-s7-industry` | #173 | 기대 `GRADERS_VERSION` 문자열 교체 | 버전 문자열만 |
| `lib/feature-status.ts` | #177 | `r_franchise` 행의 사유 문구에 '유입 코드·모집 비용' 추가 | 문구 연장 |
| `lib/record-kinds.ts`·`tests/record-kinds.test.mjs` | #177·#183·#194·#208 | 가맹 kind 추가 | 추가만 |
| `lib/nav-state.ts`·`tests/nav-state.test.mjs` | #188·#195 | 가맹 탭 목록에 `inflow`·`report` 추가 | 추가만 |
| `app/api/workspace/route.ts`·`lib/workspace-metrics.ts`·`app/workspace.tsx`(A 소유) | #204 R6d-1 | 호출 1줄, `NextTask` 합집합, 선택 인자, 반환 끝 펼침, 다음 할 일 `map` 분기 | 레인 A가 '그대로 둔다'로 결정(2026-09-27 12:33 UTC). 스위치 꺼지면 `franchiseTasks` 키 없음 |
| `e2e/serve.mjs`·`e2e/email-auth.spec.ts` | #191 | 로컬 E2E 기본 설정에 테스트 전용 고정 `AGENCY_ENCRYPTION_KEY`, 직원 화면 제한 검사 추가 | 로컬 D1 합성 데이터 전용. 운영 무관 |
| `docs/STATUS.md`·`docs/DATA-PROCESSING.ko.md`·`docs/SECURITY-BOUNDARIES.ko.md`·`docs/E2E.ko.md`·`docs/EVAL.ko.md` | 여러 PR | 레인 R 칸·행 추가 | DATA-PROCESSING 변경은 모두 레인 A가 받아들였다(#184·#196·STATUS 레인 A 칸 11:23·12:33 UTC) |

- 반대 방향 확인: #209 이후 다른 레인이 레인 R 소유 파일을 바꾸지 않았다(`git diff --stat 1b715ca 431e417 -- lib/franchise* app/franchise* app/api/franchise tests/franchise* tests/recruitment* tests/lead-import* e2e/franchise*` 결과 0줄). 레인 R 연결 지점(`app/api/workspace/route.ts:23` `franchiseWorkspaceTasks`, `lib/workspace-metrics.ts:68` `franchiseNextTasks`, `lib/nav-state.ts:15` 가맹 탭 7개)이 main에 그대로 있다.
- 결론: 레인 R 변경이 만든 회귀는 **0건**이다. 고칠 것이 없다.

### 1.3 STATUS '확인 필요(레인 R): check-prompts macOS 대소문자 충돌' 줄

- 레인 A 칸 30행의 이 줄은 **이미 해소됐다**.
- 근거: #161(`8fbc406`)이 `tests/check-prompts.test.mjs`의 잘못된 단위 id 예에서 정본 `channel.leadad.json`과 대소문자만 다른 `channel.leadAd`를 `channel.leadForm`으로 바꿨다. 같은 PR이 '잘못된 id 예가 정본 파일과 대소문자만 다르지 않다'는 검사를 더했다.
- 재확인: 위 1.1 실행(macOS, `core.ignorecase=true`)에서 `check-prompts.test.mjs` 131 passed · mocked.
- 처리: 레인 A 칸은 레인 R이 고치지 않는다. 레인 A 칸에 이 줄을 지워도 된다는 '요청' 줄만 더했다.

## 2. 5절 '실제 키 회전·Q/R 키 확대' 행의 레인 R 몫

### 2.1 현재 사실 (main `431e417`)

- 가맹 리드 연락처 필드(`lib/franchise-crypto.ts:9` `sealField`)는 `encrypt(value)`를 AAD 없이 부른다. 그래서 #211 뒤에도 옛 형식(`iv.data`)을 `AGENCY_ENCRYPTION_KEY`로 쓰고 앞에 `v1.`을 붙인다. 이 `v1.`은 레인 R의 자체 접두다. #211의 `v1:<키 ID>:` 형식과 이름만 비슷하고 다르다.
- 읽기(`openField`)는 `decrypt`를 거쳐 #211 키 목록을 쓴다. 옛 형식은 `AGENCY_ENCRYPTION_KEY`부터, 그다음 `AGENCY_ENCRYPTION_KEYS` 순서로 시도한다(`lib/credential-crypto.ts` `openSecret`). 옛 키가 목록에 남아 있는 동안은 읽힌다.
- 중복 키 HMAC(`lib/franchise-crypto.ts:19-36` `leadKeyHmac`)은 `AGENCY_ENCRYPTION_KEY` 원 바이트에서 HKDF(info `collective:franchise-lead-key:v1`)로 파생한다. 키 목록을 보지 않는다.
- #211 문서(`docs/SECURITY-BOUNDARIES.ko.md` 187절 '범위 밖')가 이미 가맹 연락처와 HMAC을 회전 범위 밖으로 두고, `AGENCY_ENCRYPTION_KEY`는 값을 바꾸거나 지우지 않는다고 적었다. 레인 R 코드도 이 전제와 맞는다.

### 2.2 `AGENCY_ENCRYPTION_KEY`를 바꾸면 깨지는 것 (영향 기능)

1. **중복 키가 조용히 바뀐다.** 저장된 `franchise_lead_key` 행은 옛 HMAC이다. 새 키로 만든 HMAC은 다르다. 그래서 같은 전화·이메일 리드를 새로 만들 때 409 중복 경고가 나지 않는다. 리드 CSV 가져오기(결정 32)의 교차 파일 병합은 기존 리드를 못 찾고 새 리드를 만든다. '연락처로 리드 찾기'도 기존 리드를 못 찾는다. 오류 없이 결과만 틀린다.
2. **옛 키를 목록에서 빼면 연락처를 못 읽는다.** 리드 상세 원문 보기, 연락처 내보내기, 정보주체 요청 처리, H11 180일 파기 판정이 500('연락처를 읽지 못했습니다')이 된다. 가맹 연락처는 `reseal_credentials` 대상이 아니라 재암호화 경로가 없다.
3. 영향 받지 않는 것: 가맹 판정(R2·R4 게이트), 주간 보고(R6, 연락처 없음), 모집 자료·행사(R15a), 모집 코드·비용(R5b-1). 모두 연락처 복호화나 HMAC을 쓰지 않는다.

### 2.3 인계 행 (기준 8절 4항 서식)

| C-ID/기능 | 담당 | PR·최종 소스 SHA | 검사 결과·증거(real/mocked) | published/runtime-verified/registry-active 근거 | 현재 스위치·사용 범위 | blocked/not_run·이유·다음 확인일 | 후속 소유자/재개 조건 |
|---|---|---|---|---|---|---|---|
| C09 확대: 가맹 연락처 암호화 키(레인 R) | R(코드)·대표(키 값·게시) | 현행 `lib/franchise-crypto.ts`(R4b), main `431e417`. 확대 PR 없음 | 현행 경로: `node scripts/test.mjs` 184/184 passed · mocked(main `431e417`). 그중 `franchise-contacts` 122(연락처 `v1.` 암호화·평문 부재·가림·열람 감사·키 없음 503). 확대 코드는 없음 | 현행 경로는 운영에 게시됨(R4b). 확대는 해당 없음 | `r_franchise` 기본 꺼짐. 운영 리드 등록은 막혀 있음(OFD 분기 미판정, STATUS 레인 R 칸). 연락처는 옛 형식 + `v1.` 접두, AAD 없음 | **not_run**. 이유: R8(키 회전 절차)의 발동 조건인 결정 28이 없다. 운영 리드 등록이 막혀 있어 재암호화할 연락처가 쌓이지 않는다. 다음 확인일 **2026-10-05(월) KST** | R. 재개 조건(먼저 오는 것): ① 결정 28 기록, ② 대표가 `AGENCY_ENCRYPTION_KEY` 값을 바꾸기로 결정, ③ OFD 분기 A로 실제 리드 저장 시작. 할 일: 연락처 필드(`franchise_lead`의 이름·전화·이메일·메모)를 `sealRecordSecret`·`openRecordSecret`(`lib/credential-crypto-server.ts:16,33`, AAD는 행 id 규칙 `<owner>:<kind>:<id>`)로 옮기고, 옛 암호문 지연 재암호화와 대표 전용 전체 재암호화를 `reseal_credentials` 방식으로 더한다 |
| C09 확대: 가맹 리드 중복 키 HMAC(레인 R) | R(코드)·대표(키 값) | 현행 `lib/franchise-crypto.ts:19-36`, main `431e417`. 확대 PR 없음 | 현행 경로: 같은 실행의 `franchise-contacts` 122(HMAC 중복 409, 키 행 64자 hex)·`lead-import` 171·`lead-import-route` 66(교차 파일 병합) passed · mocked | 위와 같음 | 파생 키가 `AGENCY_ENCRYPTION_KEY` 원 바이트에 묶여 있음. 키 목록을 보지 않음 | **not_run**. 위와 같은 이유. 다음 확인일 **2026-10-05(월) KST** | R. 재개 조건은 위와 같다. 할 일: HMAC 파생 원천을 암호화 키와 떼어 놓는다(키 버전 태그를 `franchise_lead_key` 행에 기록). 키가 바뀌면 모든 리드 연락처를 복호화해 새 HMAC 행을 만들고 옛 행을 지우는 재색인 작업(대표만, 건수만 응답)을 둔다. 재색인이 끝나기 전에는 새 리드 저장을 409로 막아 중복을 조용히 놓치지 않게 한다 |

### 2.4 5절 필수 칸 (원인·권한·기록 위치)

- 원인: #211은 AI 연결·채널·Buffer 자격증명만 회전 대상으로 만들었다. 가맹 연락처와 HMAC은 레인 R 파일이라 #211 범위 밖으로 남겼다(`docs/SECURITY-BOUNDARIES.ko.md` 187절). 가맹 키 회전은 트랙 R 계획에서 R8(조건부, 결정 28)에 속한다.
- 이미 된 코드/검사: 연락처 필드 암호화, 키 없으면 503(평문 저장 0), 목록 가림, 열람마다 감사, HMAC 중복 키, 모델 전송 0건(R4b, passed · mocked). #211 키 목록으로도 연락처를 읽을 수 있다(옛 형식 읽기 경로 공유).
- 실행 한도/권한: 키 값 생성·Sites 환경변수 입력·게시는 대표만 한다. 레인 R은 키 값을 보거나 저장하지 않는다. 재암호화·재색인 작업이 생기면 대표만 부를 수 있게 하고, 응답은 건수만 싣는다.
- 지금 지켜야 할 제한: **`AGENCY_ENCRYPTION_KEY` 값을 바꾸거나 지우지 않는다.** #211 회전 순서는 `AGENCY_ENCRYPTION_KEYS`만 바꾸므로 이 제한과 충돌하지 않는다. 기존 키를 지워야만 종료되는 것으로 해석하지 않는다(기준 5절).
- 복구: 지금은 회전을 하지 않으므로 복구 절차가 필요 없다. 확대 PR은 스위치를 끄는 것만으로 돌아오지 않는 변경(재암호화·재색인)이 생기므로, 그 PR에 되돌릴 버전과 옛 키 보관 기간을 함께 적는다(기준 4절 7항).
- 후속 기록 위치: 이 파일, STATUS 레인 R 칸, 트랙 R 계획 R8 절.
