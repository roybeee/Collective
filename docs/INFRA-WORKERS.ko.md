# Cloudflare Workers 직접 배포 (I1)

ChatGPT Sites 게시와 **나란히** 대표의 Cloudflare 계정 Workers로 직접 배포하는 경로다. Sites 게시(`docs/PUBLISH.ko.md`)는 바뀌지 않는다. 이 문서와 도구는 준비·로컬 검증까지만 다루며, 원격 배포·리소스 생성·데이터 이동은 아래 절차대로 **대표가 직접** 실행한다.

비유하면 지금 가게(Sites)를 그대로 열어 둔 채, 같은 설계도로 옆 건물(Workers)을 지어 열쇠만 확인해 둔 상태다. 손님(DNS)을 옮기는 일, 창고 짐(D1·R2)을 옮기는 일은 아직 하지 않았다.

## 무엇이 들어 있나

| 파일 | 역할 |
|---|---|
| `deploy/wrangler.workers.jsonc` | Workers 설정 템플릿. 계정 ID·DB ID·비밀값 없음. `${NAME}`·`${NAME:-기본값}` 자리표시자 |
| `deploy/workers-config.mjs` | 템플릿 채우기·형식 검사(AUTH_MODE=email 고정, https origin, D1 UUID, cron 5필드) |
| `deploy/worker-entry.ts` | Workers 진입점. `fetch`는 vinext 기본 핸들러에 위임, `scheduled`는 예약 tick |
| `deploy/workers-runtime.mjs` | 요청 경계(위조 가능한 GPT 헤더 제거, email 아니면 503)와 예약 tick 순환 |
| `scripts/deploy-workers.mjs` | `check`·`preview`·`promote`·`rollback`·`migrate`. 기본 dry-run |
| `vite.config.ts` | `DEPLOY_TARGET=sites|workers`(기본 sites) |

### 빌드 대상

- `DEPLOY_TARGET` 미설정 또는 `sites`: 기존과 같다. Sites 로그인 플러그인(`build/sites-vite-plugin.ts`) 포함, `dist/.openai` 생성, 바인딩 자리 값 그대로. 브랜치 전후 Sites 빌드를 같은 빌드 시각·트리 값으로 비교해 파일 732개의 크기와 `dist/server/wrangler.json`·`dist/.openai`가 같음을 확인했다(vinext가 빌드마다 임의 UUID를 넣어 청크 해시 이름은 원래 코드끼리도 달라진다).
- `workers`: Sites 플러그인을 빼고(`/signin-with-chatgpt` 없음, `dist/.openai` 없음) 템플릿을 채운 설정으로 빌드한다. 결과 `dist/server/wrangler.json`이 배포 설정이다(`main`은 번들 `index.js`).

### 요청 경계

Workers 직접 배포에는 Sites 로그인 앞단이 없어서 `oai-authenticated-user-*` 헤더는 누구나 보낼 수 있다. 진입점이 이 헤더를 항상 지우고, `AUTH_MODE`가 `email`이 아니면(대시보드에서 `legacy`로 바꾼 경우 포함) 모든 요청을 503으로 닫는다. 작업자 gate 헤더(`oai-sites-authorization`)는 지우지 않는다(앱이 `RESEARCH_WORKER_GATE_TOKEN`과 직접 비교한다).

## 환경값

빌드할 때 넣는 값(비밀 아님, 커밋하지 않음):

| 이름 | 필수 | 설명 |
|---|---|---|
| `CF_D1_DATABASE_ID` | 예 | 대표 계정 D1 UUID |
| `CF_R2_BUCKET` | 예 | 대표 계정 R2 버킷 이름 |
| `AUTH_ORIGIN` | 예 | 정확한 https origin, 끝 `/` 없음(예: 사용자 도메인) |
| `CF_WORKER_NAME` | 아니오 | 기본 `collective` |
| `CF_D1_DATABASE_NAME` | 아니오 | 기본 `collective` |
| `INTERNAL_CRON` | 아니오 | `1`이면 예약 tick 동작, 기본 `0` |
| `CF_CRON` | 아니오 | 기본 `*/5 * * * *` |

wrangler 실행 환경: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`(또는 `wrangler login`). 값은 저장소·채팅에 남기지 않는다.

비밀값(`wrangler secret put <이름> --config dist/server/wrangler.json`, 값은 대표가 입력):

| 이름 | 구분 | 비고 |
|---|---|---|
| `AGENCY_ENCRYPTION_KEY` | 필수(`secrets.required`) | Sites와 **같은 키**여야 옮긴 연결 자격증명을 풀 수 있다 |
| `OPENAI_API_KEY` | 필수(`secrets.required`) | 모델 호출 |
| `AGENCY_ENCRYPTION_KEYS` | 선택 | 키 회전 중일 때만 |
| `RESEARCH_WORKER_GATE_TOKEN`, `RESEARCH_WORKER_SITE_ORIGIN`(var), `RESEARCH_WORKER_ADMIN_IDS`, `RESEARCH_WORKER_SSH_TARGET`, `RESEARCH_WORKER_APP_GATE`, `RESEARCH_WORKER_TOKEN_EXPIRY`, `RESEARCH_TOOL_POLICY` | 선택 | 조사 서버를 붙일 때(아래 6단계) |
| `AUTH_BOOTSTRAP_EMAIL`, `AUTH_BOOTSTRAP_OWNER`, `AUTH_BOOTSTRAP_TOKEN_HASH` | 일회 | 새 D1에서 첫 관리자 등록 때만, 등록 뒤 삭제 |
| `EVAL_BOUNDED_ALLOWED_HOSTS`, `AI_COPY_CAPTIONS`, `DIGEST_MAIL_TO` | 선택 | 현재 Sites 환경에 있으면 같은 값 |

`secrets.required`가 배포(`versions upload`) 때 빠진 비밀값을 막는지는 확인하지 않았다(로컬 `wrangler dev`는 경고만 낸다). 첫 미리보기 전에 비밀값을 먼저 넣는다. 현재 Sites 환경의 전체 목록은 Sites 환경 화면에서 대조한다.

## 도구

```sh
DEPLOY_TARGET=workers CF_D1_DATABASE_ID=… CF_R2_BUCKET=… AUTH_ORIGIN=https://… node scripts/run-framework.mjs build
node scripts/deploy-workers.mjs check            # 소유자 값까지 엄격 점검(없으면 실패)
node scripts/deploy-workers.mjs check --dry-run  # CI용: 소유자 값 없음은 경고, 구조 문제만 실패
node scripts/deploy-workers.mjs preview --tag <sha7> [--alias staging]           # 명령만 출력
node scripts/deploy-workers.mjs preview --tag <sha7> --execute                   # 실제 업로드(트래픽 0%)
node scripts/deploy-workers.mjs promote <version-id> --execute                   # versions deploy <id>@100%
node scripts/deploy-workers.mjs rollback [version-id] --message "사유" --execute # wrangler rollback
node scripts/deploy-workers.mjs migrate --execute --yes-i-understand             # d1 migrations apply DB --remote
```

- 모든 원격 명령은 정확한 명령을 먼저 출력하고, `--execute`가 없으면 실행하지 않는다. `migrate`는 `--yes-i-understand`도 필요하다.
- 실행 전 막는 조건: 빌드 설정이 없거나 Workers 빌드가 아님, D1 ID가 로컬 자리 값이거나 현재 `CF_D1_DATABASE_ID`와 다름, `AUTH_ORIGIN` 없음, `CLOUDFLARE_ACCOUNT_ID` 없음.
- `check`는 로컬 번들 검사(`wrangler versions upload --dry-run`, 업로드 없음)를 실행하고 원격 마이그레이션 비교 명령(`d1 migrations list DB --remote`)을 출력한다. `check --execute`일 때만 그 비교를 실행한다.
- 미리보기 URL의 한계: `AUTH_ORIGIN`은 버전마다 고정된 var라서, 버전별 미리보기 URL(`<버전>-collective.<계정>.workers.dev`)에서는 로그인이 403이다. 미리보기에서는 공개 경로(`/api/version/public` 200, 업무 API 401)만 확인한다. 로그인까지 보려면 `--alias staging`으로 고정 별칭을 정하고 `AUTH_ORIGIN=https://staging-<worker>.<계정>.workers.dev`로 **따로 빌드한** 버전을 올린다. 운영으로 승격할 버전은 운영 origin으로 빌드한 버전이어야 한다.
- 로컬 측정(2026-11-09, macOS): workers 빌드 8초, 번들 검사 1초, 업로드 크기 7003.92 KiB / gzip 2081.16 KiB. Workers 요금제별 스크립트 크기 한도는 현재 Cloudflare 문서로 확인한다.

## 예약 tick (선택, `INTERNAL_CRON=1`)

- 진입점의 `scheduled`가 `auth_users`의 활성 `workspace_owner`(최대 50)마다 파이썬 워커 tick과 **같은 잠금**(`owner:research-worker`)을 잡고, 아래 큐를 고정 순서로 한 번씩 부른다. 함수와 인자는 `app/api/research-worker/route.ts`와 같다: `scheduled_runs`(`scheduledRunsQueue`, 스위치가 꺼진 소유자는 빠짐), `digest`, `storefront_pull`, `pos_pull`, `measurement`, `growth_daily`.
- 잠금이 잡혀 있으면(워커 tick 진행 중) 그 소유자는 건너뛴다. 큐 하나가 실패해도 다음 큐는 돈다. 20초가 지나면 남은 소유자는 다음 실행으로 미룬다(잠금 만료 120초보다 짧게).
- `worker_state`(작업자 마지막 응답)는 쓰지 않는다. 화면의 작업자 상태는 여전히 파이썬 워커만 나타낸다. 로그에는 소유자 id 없이 상태만 남긴다(`internal_cron`).
- 파이썬 워커는 계속 필요하다: `research`(HERMES 조사·브라우저), `execution`, `meta_execution`, `meta_conversion`, `product_research`, `consumer_recovery`, `provider_catalog`는 cron에 넣지 않았다. 워커도 같은 6개 큐를 계속 돌리므로 cron은 처리 간격을 줄일 뿐이며, 두 경로는 잠금으로 겹치지 않는다.
- 로컬 확인 방법: `wrangler dev --test-scheduled` 뒤 `/cdn-cgi/handler/scheduled`. 정적 자산 라우터가 앞에 있는 빌드 설정에서는 로컬 dev가 scheduled를 사용자 Worker로 넘기지 않아 `exception`이 난다. `assets`를 뺀 설정 사본으로 확인했다(운영 cron은 Worker에 직접 들어간다고 보지만 이 환경에서 원격 확인은 하지 않았다).

## 전환 절차 (대표 실행)

각 단계 결과를 기록하고, 막히면 멈춘다. Sites는 끝까지 그대로 둔다.

1. **리소스 만들기.** 대표 계정에서 D1 1개, R2 버킷 1개를 만든다(`wrangler d1 create collective`, `wrangler r2 bucket create <이름>`). 나온 D1 UUID와 버킷 이름을 빌드 환경값으로 쓴다.
2. **비밀값 넣기.** 위 표의 필수 비밀값을 먼저 넣는다. `AGENCY_ENCRYPTION_KEY`는 Sites와 같은 값이다.
3. **스키마.** 빈 D1이면 `migrate --execute --yes-i-understand`로 `drizzle/` 4개를 적용하고 `check --execute`로 원격 목록이 로컬과 같은지 본다. 데이터를 SQL 덤프로 들여올 계획이면 덤프에 스키마가 있는지 먼저 보고, 스키마가 있으면 마이그레이션 대신 덤프를 쓴다(둘 다 쓰면 테이블 충돌).
4. **데이터 옮기기 — 현재 막힘.** Sites의 D1·R2는 Sites 플랫폼 소유라 `wrangler d1 export`(대표 계정 자격증명)로 꺼낼 수 없다. 저장소 문서에는 Sites D1 전체 내보내기 경로 기록이 없다. 앱 안의 내보내기는 부분뿐이다: 사용량 CSV·캠페인 HERMES 제출 원문 JSON(`/api/usage/export`, 소유자), 가맹 리드 CSV·증빙 묶음(`/api/franchise`), 고객 보고서 다운로드. records 전체·설정·인증 계정·R2 원본 파일(아카이브·미디어)을 통째로 옮기는 경로는 없다. 선택지:
   - (가) Sites 쪽에서 D1 덤프·R2 내보내기를 받을 수 있는지 Sites 커넥터/지원으로 확인한다(대표 확인 필요).
   - (나) 소유자 전용 전체 내보내기·가져오기 API를 새로 만든다(별도 PR, 이 레인 범위 밖). D1 행은 그대로, R2는 객체 목록과 원본을 묶어 옮기고 해시로 대조한다.
   - (다) 새로 시작한다: 빈 D1에서 이메일 bootstrap(5단계)으로 계정을 만들고 브랜드·연결을 다시 등록한다. 이전 이력·학습 기록·업로드 원본은 Sites에 남는다.
   옮기지 못하는 것(어느 경우든): 로그인 세션(쿠키가 origin마다 달라 모두 다시 로그인), 작업자 자격증명의 사이트 주소(설치 파일에 origin이 박혀 재설치 필요), Sites 접근 설정·Sites 버전 이력.
5. **이메일 로그인.** 데이터를 옮겼으면 계정과 비밀번호 해시가 함께 오므로 bootstrap 없이 새 origin에서 다시 로그인한다. 새 D1이면 `docs/EMAIL-AUTH.ko.md` '운영 전환 순서' 2~6단계를 따르되, Sites 환경 대신 `wrangler secret put`으로 `AUTH_BOOTSTRAP_*` 세 값을 넣고, 등록 뒤 `wrangler secret delete`로 지운다. `/api/auth`가 `mode=email`인지 먼저 본다.
6. **조사 서버 다시 연결.** `RESEARCH_WORKER_SITE_ORIGIN`을 새 origin으로, `RESEARCH_WORKER_GATE_TOKEN`을 새 난수로 넣는다. Workers에는 Sites gate 앞단이 없어 gate 헤더 확인은 앱만 하므로 `RESEARCH_WORKER_APP_GATE=enforce`를 권한다. 새 origin에서 설치 파일을 다시 받아 `docs/RESEARCH-SERVER-REINSTALL.ko.md` 순서대로 재설치한다. 그 전까지 Sites 쪽 워커는 Sites를 계속 바라본다.
7. **미리보기 확인.** `preview --tag <sha7> --execute` → 출력된 미리보기 URL에서 `/api/version/public` 200(tree가 게시할 커밋 tree), `/api/workspace` 401, 위조 GPT 헤더 401을 확인한다. 로그인 확인이 필요하면 위 별칭 방식.
8. **승격.** `promote <version-id> --execute`. workers.dev 주소에서 로그인·자료 접근을 본다.
9. **도메인.** Cloudflare에 사용자 도메인을 붙인다(대시보드 Custom Domains 또는 설정 `routes`). `AUTH_ORIGIN`은 그 도메인이어야 하므로, 도메인을 정한 뒤 그 값으로 다시 빌드·미리보기·승격한다. 기존 Sites 주소(`*.chatgpt.site`)는 대표 계정 DNS가 아니어서 옮길 수 없다. Android 앱이 Sites 주소를 열고 있으면 앱 URL 변경이 필요하다(별도 확인).
10. **Sites로 되돌리기.** Sites는 그대로 게시돼 있으므로 사용자를 원래 Sites 주소로 다시 안내하면 된다(사용자 도메인을 썼다면 DNS를 되돌린다). Workers 쪽에서 새로 쓴 데이터는 Sites D1로 돌아가지 않는다. 전환 초기에는 한쪽만 쓰도록 사용 기간을 나누고, Workers 안에서의 되돌리기는 `rollback`(이전 버전으로 즉시 전환, D1 스키마는 되돌리지 않음)을 쓴다.

## 비용 (정성 비교)

- Sites: 게시 1회가 약 15~18분, 2026-09-23 기록에서 ChatGPT Work 크레딧 179 → 0(같은 계정의 HERMES·Codex와 공유, `docs/PUBLISH.ko.md`).
- Workers: 게시는 대표 Cloudflare 계정의 요금(Workers 요청·CPU 시간, D1 행 읽기/쓰기·저장, R2 저장·작업)으로 청구되고 ChatGPT 크레딧을 쓰지 않는다. 구체 금액은 이 환경에서 확인하지 않았다. Cloudflare 요금 페이지와 현재 Sites D1·R2 사용량을 대조해 대표가 정한다.

## 게시 5분 목표 측정

- 측정 구간: `git rev-parse origin/main` 확정 → `DEPLOY_TARGET=workers` 빌드 → `preview --execute` 완료(버전 ID 출력) → `promote --execute` 완료 → `/api/version/public`의 tree가 그 커밋 tree와 같아질 때까지.
- 방법: 각 명령 앞뒤에 `date -u +%s`를 남기고 합계를 기록한다. 마지막 단계는 `curl -fsS <origin>/api/version/public`을 5초 간격으로 반복해 tree가 맞는 첫 시각을 쓴다. 3회 측정해 최댓값이 5분 이하이면 목표 통과로 본다.
- 현재 로컬 근거: 빌드 8초, 번들 검사 1초. 업로드·전파 시간은 원격 실행 전이라 `not_run`.

## CI

`.github/workflows/ci.yml`의 `workers-build` 잡(비차단, `continue-on-error: true`): `DEPLOY_TARGET=workers` 빌드 → `check --dry-run`(번들 검사 포함, 업로드 없음). 비밀값·계정 값을 쓰지 않는다.

## 남은 결정 (대표)

- 데이터 이동 방식(4단계 가·나·다)과 Sites D1·R2 내보내기 가능 여부.
- 사용자 도메인과 `AUTH_ORIGIN` 값, Android 앱 URL 처리.
- `INTERNAL_CRON`을 켤지, cron 간격.
- Workers 요금제(스크립트 크기·CPU 한도)와 비용 상한.
