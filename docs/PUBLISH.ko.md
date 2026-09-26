# Sites 게시 체크리스트

이 저장소에는 게시 스크립트가 없다. 게시는 ChatGPT Sites 편집기 대화 또는 Codex가 수행한다.
GitHub 병합(`merged`)은 배포가 아니다. 게시(`published`)와 실행 검증(`runtime-verified`)을 각각 기록한다. 용어는 `AGENTS.md`의 상태 어휘를 따른다.

## 0. 사전 점검 (필수, 하나라도 아니면 게시하지 않는다)

게시는 비싸다. 2026-09-23 게시 1회에 약 18분이 걸렸고 ChatGPT Work 크레딧이 179 → 0으로 소진됐으며 주간 한도도 함께 줄었다. 같은 계정을 HERMES와 Codex가 쓴다.

- [ ] ChatGPT Work 남은 크레딧과 주간 한도를 확인해 기록했다. 게시 1회(위 수치)를 감당하고도 남는다.
- [ ] 크레딧 자동 충전 설정 여부를 확인해 기록했다. 크레딧이 0이고 자동 충전이 켜져 있으면 한도를 넘는 순간 유료 충전이 일어날 수 있다는 점을 기록에 남겼다.
- [ ] 앞으로 몇 시간 안에 이 한도가 필요한 HERMES 예약 실행이나 유료 모델 작업이 없다(있으면 그 뒤로 미룬다).
- [ ] 게시는 다른 개발·조사 작업과 분리해 단독으로 진행한다. 같은 대화·세션에서 코드 수정을 섞지 않는다.
- [ ] 게시할 GitHub 리비전이 `origin/main`이고 CI `verify`가 passed다.

## 1. 기준 리비전 고정

```bash
git fetch origin --prune
git rev-parse origin/main                 # 게시할 커밋 SHA
git ls-remote origin refs/heads/main      # 위와 같아야 한다
git rev-parse 'origin/main^{tree}'        # 게시할 제품 커밋의 트리. 게시 뒤 비교 기준이며 기록에 남긴다
```

## 2. 정확한 트리 투영

Sites 프로젝트의 git 이력은 GitHub와 다르다. 파일을 손으로 복사하지 않고, GitHub `main`의 트리를 그대로 가진 커밋을 Sites 쪽 현재 헤드 위에 만든다. 그래야 두 커밋의 트리 해시가 같아 `/api/version`으로 검증할 수 있다.

```bash
# Sites 작업 사본에서
git fetch https://github.com/roybeee/Collective.git main
TREE=$(git rev-parse 'FETCH_HEAD^{tree}')   # 1단계의 트리와 같아야 한다
git fetch <sites-remote> <sites-branch>      # FETCH_HEAD = Sites 쪽 현재 헤드
COMMIT=$(git commit-tree "$TREE" -p FETCH_HEAD -m "publish: roybeee/Collective <sha7>")
git checkout --detach "$COMMIT"
git status --porcelain                       # 비어 있어야 한다(아니면 빌드가 dirty로 표시된다)
```

`<sites-remote>`·`<sites-branch>`는 게시 환경마다 다르다. 게시자가 실제 값을 기록에 남긴다.

## 3. 설치와 빌드

```bash
pnpm install --frozen-lockfile      # pnpm 11.25.0 (package.json packageManager)
node scripts/run-framework.mjs build
```

`pnpm run <script>`는 이 저장소에서 `packages field missing or empty`로 실패하므로 node로 직접 실행한다.

## 4. 게시

Sites 접근 설정에 맞는 게시 도구를 쓴다. 공개(public) 사이트는 `save_site_version`으로 버전을 저장한 뒤 `deploy_site_version`으로 배포한다. 비공개 사이트는 `save_version_and_deploy_private`다. 접근 설정은 바꾸지 않는다. 결과로 받은 버전 번호와 deployment ID를 기록한다. COLLECTIVE는 2026-09-23부터 public이다(STATUS 'Sites 접근').

## 5. 실행 검증

앱 페이지(로그인 상태)의 브라우저 콘솔에서:

```js
await (await fetch('/api/version', {credentials: 'same-origin', cache: 'no-store'})).json()
```

- 로그인 없이 확인하는 공개 경로도 있다(2026-09-26 대표 결정): `curl -fsS https://mealzip-agency.hflameb.chatgpt.site/api/version/public`는 `{build, tree}`만 돌려준다. `tree` 판정은 위와 같다. 레지스트리 상태(`promptManifest`)는 소유자 경로에서만 본다.
- 아래를 모두 만족하면 `runtime-verified`: `tree`가 마지막으로 게시한 제품 커밋(1단계 SHA)의 tree와 같다. 그 커밋이 `origin/main`의 조상이다(`git merge-base --is-ancestor <sha> origin/main`). 그 뒤 `main` 변경이 아래 비제품 경로뿐이다(아래 명령 결과 없음). 그 뒤 제품 코드가 병합됐지만 아직 게시하지 않았다면 `runtime-verified`가 아니다.
- 비제품 경로(배포 산출물에 들어가지 않는 파일)는 여기에서만 정의한다. 문서, 테스트, E2E, CI, lint 설정·기준선, 테스트 실행기, 평가 스크립트(`scripts/eval/`, 빌드에 쓰이지 않음), 프롬프트 정본(`prompts/`, 앱 빌드가 import하지 않으며 `scripts/check-prompts.mjs`가 막는다. 운영 반영은 게시가 아니라 레지스트리 등록·활성화이고 7절에 기록한다)이다. 빌드에 쓰이는 파일(예: `scripts/run-framework.mjs`, `vite.config.ts`)은 넣지 않는다.

```bash
git diff --name-only <sha> origin/main -- . ':!docs' ':!*.md' ':!tests' ':!e2e' ':!.github' ':!eslint.config.mjs' ':!playwright.config.ts' ':!playwright.auth.config.ts' ':!scripts/lint-baseline.json' ':!scripts/lint-gate.mjs' ':!scripts/test.mjs' ':!scripts/eval' ':!prompts'
```

- `unknown`·`dirty`이거나 다르면 검증 실패. `published`에서 멈추고 원인을 기록한다.

## 6. 기록

`docs/releases/<YYYY-MM-DD>-<sha7>.md`를 만들고(형식은 `docs/releases/README.md`), `docs/STATUS.md`의 "현재 운영 상태" 표를 갱신하는 PR을 연다.

## 7. registry-active 기록 (프롬프트 레지스트리)

프롬프트 레지스트리(`docs/PROMPT-REGISTRY.ko.md`)의 활성화·롤백은 게시가 아니다. 코드 tree는 그대로이므로 `runtime-verified`에 영향이 없고, 레지스트리 상태는 `registry-active`로 따로 기록한다(`AGENTS.md` 상태 어휘).

- `registry-active` 조건: 대상 단위의 `prompt_release.active`가 기록한 버전 id이고, 운영 `/api/version`의 `promptManifest`가 기록한 매니페스트 해시와 같다. 롤백으로 active가 없어진 단위는 코드 상수 실행이며 `promptManifest`로 확인한다(전 단위가 비면 null).
- 활성화(F3b)·롤백마다 한 번씩 `docs/releases/<YYYY-MM-DD>-registry-<단위>.md`(또는 같은 날 게시 기록의 절)와 `docs/STATUS.md`에 남긴다.
  - 단위, 이전 active → 새 active 버전 id(롤백은 null 가능), 버전의 `sourceSha`
  - 활성화: `evalRunId`, 승인자·승인 문구·시각, `stagedCampaignIds`(지정 캠페인)
  - 롤백: 사유, 영향 범위(`GET /api/prompts?impact=<id>`의 작업물·발행물 수), 재확인 표시한 작업물 수
  - 조작 전·후 `/api/version`의 `promptManifest`
- 등록(`register`)만으로는 `registry-active`가 아니다. `blocked`로 끝난 등록은 원인(연결 실패·HTTP 상태)을 같이 기록한다.

## 묶음 게시 승인

2026-09-23 대표 결정 4에 따라 게시는 묶음 단위로 승인한다. 보안 수정은 병합 즉시 게시하고, 나머지는 단계당 1회 묶음으로 게시한다([성장 계획](GROWTH-PLAN.ko.md#로드맵)). 단계당 비보안 회귀 핫픽스 예비 1회를 둔다.

1. 게시 직전(1단계로 리비전을 고정한 뒤, 4단계 게시 전)에 대표가 대상 SHA와 묶음 구성(포함 PR·에픽 목록)을 명시 승인한다. 승인 문구와 시각을 기록에 남긴다. 승인 없이 4단계로 가지 않는다.
2. 승인한 SHA와 1단계에서 고정한 SHA가 다르면 게시하지 않고 다시 승인받는다.
3. 게시 뒤 24~72시간 동안 아래 중단 조건을 감시한다. 비교 기준은 게시 전 값이다.
   - `invalid_output` 비율 급증(예: 게시 전 직전 20건의 비율 대비 2배)
   - 5xx 응답 증가(게시 전 같은 길이 기간 대비)
   - Workers CPU 한도 초과
4. 중단 조건을 넘으면 원인을 기록한다. 기능 스위치가 있는 동작(성장 계획 F2 이후)은 먼저 스위치로 끈다. 코드 문제면 롤백한다.
5. 롤백은 직전에 `runtime-verified`였던 제품 커밋을 이 체크리스트 1~5단계로 다시 게시하는 것이다. 게시 1회와 같은 시간·크레딧이 들므로 0단계 사전 점검도 다시 한다. 롤백 게시는 `published`와 `/api/version` tree 일치 여부를 기록한다. `main`에는 게시되지 않은 제품 변경이 남으므로 정의상 `runtime-verified`가 아니다. 원인 수정이 병합·게시될 때까지 그 상태를 기록에 남긴다.

## 8. 자동 게시 (ChatGPT 예약 작업)

Sites는 ChatGPT 웹·데스크톱 안에서만 저장·게시되고 외부 API·CLI·웹훅이 없다([Sites 문서](https://learn.chatgpt.com/docs/sites)). 그래서 개발 도구가 게시를 직접 누르지 못한다. 대신 대표가 2026-09-25 ChatGPT 웹의 COLLECTIVE Sites 대화에 예약 작업 `COLLECTIVE 자동 게시`를 만들어 활성화했다. GitHub PR 활동을 트리거로 쓴다([예약 작업 문서](https://learn.chatgpt.com/docs/automations?surface=app)).

- 게시 요청: 개발 도구가 PR 하나를 연다.
  - 본문에 `PUBLISH-TARGET: <40자 SHA>`와 `PUBLISH-INSTRUCTION: docs/publish/<sha7>.md` 두 줄을 넣는다.
  - 지시문은 이 체크리스트의 파일 목록·기대 해시 방식이다. 보내기 전에 임시 `GIT_INDEX_FILE`로 목표 tree 재현을 확인한다.
  - 승인 문구는 지시문과 PR 본문에 적는다.
- 실행 순서: 라벨 `sites-publish`를 먼저 붙이고, 그다음 지시문 파일 커밋을 push한다. 라벨을 붙이는 것만으로는 실행되지 않는다(작업 생성 때 편집기 보고). push가 PR 활동을 만든다.
- 작업이 확인하는 것: PR이 열려 있고 라벨이 있는지, 지시문의 목표 커밋 = `PUBLISH-TARGET`인지, 그 커밋이 main에 들어 있는지, 그 커밋의 CI가 success인지. 하나라도 아니면 게시하지 않는다.
- 작업이 하는 것: 지시문을 실행한다. 환경변수·접근 설정·D1·R2는 바꾸지 않는다. 결과(단계별 결과·해시 불일치 수·`TREE_EMBEDDED`·Sites 버전·deployment ID·Sites 커밋)를 PR 댓글로 남긴다. 라벨은 `sites-published` 또는 `sites-publish-blocked`로 바꾼다. 코드 push·병합·PR 닫기는 하지 않는다.
- 라벨이 `sites-publish`로 남아 있는 동안에는 그 PR에 push·댓글을 더하지 않는다. 더하면 작업이 다시 실행된다. 결과 댓글을 받은 뒤 게시 기록(6절)을 같은 PR에 더하고 병합한다.
- `sites-publish` 라벨 PR은 한 번에 하나만 둔다.
- 0단계 사전 점검(크레딧)은 자동 게시에서 기록되지 않는다. 게시 1회 크레딧은 붙여 넣기 방식과 같다.
- `runtime-verified`는 5단계 판정이다. 공개 경로 `/api/version/public`이 게시된 뒤에는 개발 도구가 curl로 직접 확인한다. 그 전 게시는 소유자 세션의 `/api/version`이 필요하다.
- 첫 실행(2026-09-25 22:36 UTC, #119 push): GitHub 트리거가 동작했다(real). 작업은 PR 본문 파싱, main 포함(compare `identical`), CI success, Sites 작업 사본 tree·접근 설정 읽기까지 하고 멈췄다. 지시문 5단계가 비공개 전용 도구(`save_version_and_deploy_private`)를 적어서, public 사이트의 접근 설정 유지 조건과 맞지 않았기 때문이다(blocked, 파일 적용·빌드·게시 미실행). 결과 댓글과 라벨 교체(`sites-publish-blocked`)도 동작했다. 지시문 생성기는 4단계의 공개 사이트 도구를 적도록 고쳤다. 다시 요청할 때는 라벨을 `sites-publish`로 되돌린 뒤 고친 지시문 커밋을 push한다.
- 첫 실행이 멈추면 대표가 같은 지시문을 편집기에 붙여 넣는 방식으로 돌아간다. 예약 작업 안에서 Sites 저장·배포 도구가 동작하는지는 두 번째 실행에서 확인한다.
- 두 번째 요청(2026-09-25 22:46 UTC 라벨 복구 → 22:47 UTC push): 23:20 UTC까지 결과 댓글·라벨 변화가 없었다(not_run 추정, 원인 미확인). 작업 설정의 이벤트는 '풀 리퀘스트, 리뷰, PR 및 리뷰 댓글 및 커밋 업데이트'였다. 문서는 가까이 들어온 이벤트를 한 실행으로 묶을 수 있다고 적는다. 작업 화면의 '지금 실행(Run now)'으로 대기 이벤트를 처리할 수 있다. 대표 결정으로 묶음 13 게시는 보류했다. 저장·배포 도구가 예약 작업 안에서 동작하는지는 아직 확인하지 못했다.
- 세 번째 요청(2026-09-26, 대표 결정 "Gpt복구되었으니 지금까지 개발한것들 한번 게하고 다음진행하자"): 대상은 `b16403d`(tree `68bfa40`, #124까지)이고 지시문은 `docs/publish/b16403d.md`다. 보류했던 `b0ef304`는 이 대상에 포함된다. 같은 순서(라벨 → 지시문 커밋 push)로 요청한다. 결과는 요청 PR 댓글과 게시 기록에 적는다.
- 세 번째 요청 결과(2026-09-26 02:05:56 UTC push → 02:14 UTC 결과 댓글): `published`(real). 예약 작업 안에서 파일 적용·빌드·`save_site_version` → `deploy_site_version`이 모두 동작했다(Sites 버전 36, [게시 기록](releases/2026-09-26-b16403d.md)). 자동 게시의 첫 성공이다. 작업은 `sites-published`를 붙였지만 `sites-publish`를 떼지 않았다. 그래서 결과 댓글을 받으면 개발 도구가 먼저 `sites-publish`를 떼고(남아 있으면 다음 push가 작업을 다시 실행한다), 그다음 게시 기록을 push한다.
