# Sites 게시 체크리스트

이 저장소에는 게시 스크립트가 없다. 게시는 ChatGPT Sites 편집기 대화 또는 Codex가 수행한다.
GitHub 병합(`merged`)은 배포가 아니다. 게시(`published`)와 실행 검증(`runtime-verified`)을 각각 기록한다. 용어는 `AGENTS.md`의 상태 어휘를 따른다.

## 0. 사전 점검 (필수, 하나라도 아니면 게시하지 않는다)

게시는 비싸다. 2026-09-23 게시 1회에 약 18분이 걸렸고 ChatGPT Work 크레딧이 179 → 0으로 소진됐으며 주간 한도도 함께 줄었다. 같은 계정을 HERMES와 Codex가 쓴다.

- [ ] ChatGPT Work 남은 크레딧과 주간 한도를 확인해 기록했다. 게시 1회(위 수치)를 감당하고도 남는다.
- [ ] 앞으로 몇 시간 안에 이 한도가 필요한 HERMES 예약 실행이나 유료 모델 작업이 없다(있으면 그 뒤로 미룬다).
- [ ] 게시는 다른 개발·조사 작업과 분리해 단독으로 진행한다. 같은 대화·세션에서 코드 수정을 섞지 않는다.
- [ ] 게시할 GitHub 리비전이 `origin/main`이고 CI `verify`가 passed다.

## 1. 기준 리비전 고정

```bash
git fetch origin --prune
git rev-parse origin/main                 # 게시할 커밋 SHA
git ls-remote origin refs/heads/main      # 위와 같아야 한다
git rev-parse 'origin/main^{tree}'        # 게시 뒤 비교할 트리 해시
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

- `tree`가 1단계의 `git rev-parse 'origin/main^{tree}'`와 같으면 `runtime-verified`.
- `unknown`·`dirty`이거나 다르면 검증 실패. `published`에서 멈추고 원인을 기록한다.

## 6. 기록

`docs/releases/<YYYY-MM-DD>-<sha7>.md`를 만들고(형식은 `docs/releases/README.md`), `docs/STATUS.md`의 "마지막 운영 배포"를 갱신하는 PR을 연다.
