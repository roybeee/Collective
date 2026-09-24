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

Sites 도구의 `save_version_and_deploy_private`로 게시한다. 결과로 받은 버전 번호와 deployment ID를 기록한다.

## 5. 실행 검증

앱 페이지(로그인 상태)의 브라우저 콘솔에서:

```js
await (await fetch('/api/version', {credentials: 'same-origin', cache: 'no-store'})).json()
```

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
