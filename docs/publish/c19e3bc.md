# COLLECTIVE Sites 게시 지시문: 3ffc444 → c19e3bc

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `e5757e36d9e8e82c3b0cea107a918097875953aa` (기준 커밋 `3ffc444d3607f2ed34f9f28ebbe648f3bdc95033`, 2026-10-02 `/api/version/public`에서 확인, Sites96)
- 목표 커밋: `c19e3bcacfc50d4ae9de60665ba24a666d552fa0` / **목표 tree `e5b0a2283bb110291a61660b076cbc2e4a89fcb8`**
- 변경 파일 31개: 추가 3 · 수정 28 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.
- 포함: #324 게시 기록(문서), #325 독립 평가 10회차 반영(4G LCP 3회 중앙값 판정·예산 2500, 기록 9유형 도달 3클릭 하네스, 1280×800 사이드바 바닥 묶음 고정·브랜드 목록만 스크롤, 머리 띠 '검색' 버튼, 작업물 카드는 작업물 탭으로, 성장 기본 폼·확인창 입력 공용 Input, 홈 자리표시 선택 브랜드, MetaLine 구분선 매달림 해소, 공헌이익·브랜드 아카이브 용어 통일). 새 기능 스위치 없음. API·D1 변경 없음.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `e5757e36d9e8e82c3b0cea107a918097875953aa`. 이미 목표 tree `e5b0a2283bb110291a61660b076cbc2e4a89fcb8`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/c19e3bcacfc50d4ae9de60665ba24a666d552fa0/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`:
- 없음
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.
- 대안(권장, 결과 동일): `git fetch https://github.com/roybeee/Collective.git c19e3bcacfc50d4ae9de60665ba24a666d552fa0` 뒤 `git read-tree -u --reset e5b0a2283bb110291a61660b076cbc2e4a89fcb8`로 목표 tree를 정확히 투영해도 됩니다. 이 경우에도 3단계 검증을 모두 수행하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| M | `app/campaign-metrics.tsx` | `a12d391e765a74dbf2ee88c954577f8164257baa` |
| M | `app/command-palette.tsx` | `c31296aba6633223eff0728831f92c71cfa74063` |
| M | `app/globals.css` | `2a6f707f8cadb00a08510d2900d09b88059f8a87` |
| M | `app/growth-panel.tsx` | `1998e4054d09d7e4f3cfba3a8476b275f86210c8` |
| M | `app/growth-profit-panel.tsx` | `3cb894aa2e055157fc607d453b27a3f59ce1fce5` |
| M | `app/growth-signal-source-panel.tsx` | `b530af6511e1aabd57dee720c7db13faa9e5200f` |
| M | `app/meta-ads-panel.tsx` | `83dea72448688a9e292890a00a9ffd50e4b5d93d` |
| M | `app/meta-experiment-panel.tsx` | `393bde13c72b49e473e6dea7c0da2ce1c34aa9bc` |
| M | `app/meta-learning-panel.tsx` | `52f89f3bca913c45b003f22a219d39545cd02aca` |
| M | `app/store-operations-panel.tsx` | `d310f4c3f2fd0bade7552cfdc4c57276a36be2f3` |
| M | `app/workspace-views.tsx` | `3ee1e1a066c78716f6fa6867250d30a5aa7c1728` |
| M | `app/workspace.tsx` | `c380a6ced95cfaa070b0f5d9311495b461e50fbc` |
| M | `components/app/confirm-view.tsx` | `3deb8881a5d3e4d12bfb02656ee6fcbcd7e779ba` |
| M | `components/app/meta-line.tsx` | `c5139d39056b68762e5cc3d3382e572fd1c2da88` |
| M | `docs/STATUS.md` | `92c657da1e21dc47be39c28d668346821c46e446` |
| M | `docs/UX-PLAN-3.ko.md` | `398c9124c98ffa2beaf3a7af9c83c7a13d3c08da` |
| A | `docs/publish/3ffc444.md` | `caa8c98e8538dda9f536ac0db8529a0dcf13ff1b` |
| A | `docs/releases/2026-10-02-3ffc444.md` | `7b53915219fb989bbe2287aa4a7863447ca1f1c5` |
| M | `e2e/growth-signal-source.spec.ts` | `6d5fe87cb36d475b7b59fc99ee2f9e6c57ebca5f` |
| M | `e2e/ux-budget.spec.ts` | `a19fcfb5282f5e9286e75f28a9c29eec043bf630` |
| A | `e2e/ux-reach.spec.ts` | `2d618e39242301be47a8243cdc2585683266ca9b` |
| M | `lib/archive.ts` | `635bc9ef26f2b10b4c7b0933099b0dd199f324e5` |
| M | `lib/glossary.ts` | `50ca8a61a874e9c33c3372eda7f114b4ea92cffe` |
| M | `lib/growth-decisions-server.ts` | `db5b07e0724a9103cc291c88f8a8bb75e42c00e5` |
| M | `lib/growth-journey.ts` | `6e3d431f03e567b0ffdb11bb2575bde5599b5e2f` |
| M | `lib/growth-profit.ts` | `41f32894eef980e5edc2c6162b812e54bb25714e` |
| M | `lib/store-marketing.ts` | `2e10c6ea6ccb5c416e2be56286d0e35ca2bb7575` |
| M | `tests/growth-signal-source-route.test.mjs` | `0109221575c5095d3e5e3e8c946825033ad58f34` |
| M | `tests/stores.test.mjs` | `8db2e9d6aa9e06b30ef4d0e5086338ba3e1ae710` |
| M | `tests/ux-budget.json` | `1dd4675604648f8f83acd9b11e7289bbd0966935` |
| M | `tests/ux-budget.test.mjs` | `0f0f2c128df48027f89d40d7ea8211dd99d50369` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `e5b0a2283bb110291a61660b076cbc2e4a89fcb8`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective c19e3bc"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "e5b0a2283bb110291a61660b076cbc2e4a89fcb8" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `e5b0a2283bb110291a61660b076cbc2e4a89fcb8`인지 확인하세요.
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-10-01 "모두 진행하라. 최고의 퍼포먼스, 사람 개입 최소화, 쉬운 사용"(Claude 세션, UX 3차 구현·단계별 게시 위임). 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인
```bash
curl -fsS "https://mealzip-agency.hflameb.chatgpt.site/api/version/public?release=c19e3bc"
```
- 응답 `tree`가 `e5b0a2283bb110291a61660b076cbc2e4a89fcb8`이면 성공입니다. 응답 전체를 그대로 보고하세요.
