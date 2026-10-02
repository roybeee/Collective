# COLLECTIVE Sites 게시 지시문: e91282e → 69de0fd

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `d5da020422da139ac09cf6e15e2e7b7116349959` (기준 커밋 `e91282e942c591a8909f415db29053af642b9a10`, 2026-10-02 `/api/version/public`에서 확인, Sites92)
- 목표 커밋: `69de0fdcfc1a7495fea1a2948fefda84e828aef2` / **목표 tree `b8cfeb9b1af93a6630132b6faa096269741186fa`**
- 변경 파일 35개: 추가 10 · 수정 25 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.
- 포함: #312 게시 기록(문서), #313 과업 하네스 8과제·클릭 −40%(안건 행이 패널·기록을 바로 열기, 판매 기본 기록 빈 첫 단계·미리 연결·'저장하고 다음', Meta 준비 한 화면), 성장 기록 검색(GET /api/search, 읽기 전용 신설), 날짜·숫자 입력 보조, 주문 장부 탭 주소, 성과 기간별 표·추세. 새 기능 스위치 없음. D1 변경 없음.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `d5da020422da139ac09cf6e15e2e7b7116349959`. 이미 목표 tree `b8cfeb9b1af93a6630132b6faa096269741186fa`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/69de0fdcfc1a7495fea1a2948fefda84e828aef2/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`:
- 없음
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.
- 대안(권장, 결과 동일): `git fetch https://github.com/roybeee/Collective.git 69de0fdcfc1a7495fea1a2948fefda84e828aef2` 뒤 `git read-tree -u --reset b8cfeb9b1af93a6630132b6faa096269741186fa`로 목표 tree를 정확히 투영해도 됩니다. 이 경우에도 3단계 검증을 모두 수행하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| A | `app/api/search/route.ts` | `f6c22eca55f355e8fa87ebfb1bfb537bb95a879c` |
| M | `app/campaign-metrics.tsx` | `ade89f25311d67c22b4e01393311eb8cf4ff4555` |
| M | `app/command-palette-dialog.tsx` | `2704f2f5bed66d35a04858d59a4f16b41099aa40` |
| M | `app/command-palette.tsx` | `3984cd0c0333960c4ab9bc5616473f6bfce6afd4` |
| M | `app/globals.css` | `a50068b4ce61be66af441461ec38a90e85af7eff` |
| M | `app/growth-cs-panel.tsx` | `30fb822a131e4d8d704f07dcdb95567a1f7d1102` |
| M | `app/growth-expansion-panel.tsx` | `c3cc483c7b89f7435da1b0124ae135e4277f6f95` |
| M | `app/growth-panel.tsx` | `386045ffef625542bd331e099b18580f4906748d` |
| M | `app/meta-ads-panel.module.css` | `599f64bdabbea355c025e8a1bf6ba51fc99acf22` |
| M | `app/meta-ads-panel.tsx` | `de772fdae0d202d38c40ed2f06f84468ecd54243` |
| M | `app/panels.tsx` | `2a8b5ab0481df7e1ecc0fb39778aa3464e4ed1d7` |
| M | `app/store-operations-panel.tsx` | `8fc61c560ae333e063950ad7f1cebb6bc6ccde27` |
| M | `app/workspace.tsx` | `fc35a171131d3150dcf4aaa852d0c6f1f2b88a67` |
| M | `components/app/lazy-panel.tsx` | `d75d40572a220b0578b5dbfb71f8c279318874e8` |
| M | `components/ui/input.tsx` | `dcffee5409c529032b0b95a135bd8d6db3e23829` |
| M | `components/ui/sidebar.tsx` | `f93942ceda0c15da60aa164ae3e543fe8109f6ea` |
| M | `docs/STATUS.md` | `0aa3718800aa7f2881467448354933646750c931` |
| M | `docs/UX-PLAN-3.ko.md` | `c83aee4b3655e69f74ec97ed5013f57389c02222` |
| A | `docs/publish/e91282e.md` | `ec89c5cb077bb37bbb1ebf9e400d1d68eac79296` |
| A | `docs/releases/2026-10-02-e91282e.md` | `7d0762d0073776e8a52755c940b947cb4b953301` |
| A | `e2e/baseline/ux-tasks-9b60796.ts` | `03d0ea2327a62f58e0736a187c470dc59fa38c6b` |
| M | `e2e/growth-expansion.spec.ts` | `efec28253ac054ef8c8cf7d1b9333f3bfad1b994` |
| M | `e2e/growth-signal-source.spec.ts` | `26070abe44a1b55d66638c193539d6c8abfc090e` |
| M | `e2e/growth-workspace.spec.ts` | `c0c3214d89e922d2c2e2ac0889d89afc751baf55` |
| M | `e2e/ux-address.spec.ts` | `35c1f12cebcae5c5d0c0c21606036db907954cea` |
| A | `e2e/ux-results.spec.ts` | `d45110a45f1882e592112653b84a61ec902b4c79` |
| M | `e2e/ux-shell.spec.ts` | `0969cd3b700993acb447933656439bcc1f179e23` |
| A | `e2e/ux-tasks.spec.ts` | `41e81094e339ae83bf05e128fee85231eb96d464` |
| M | `lib/agenda-server.ts` | `10b69cf7cd6f7ab1a1bbd785fab3858d7f3a3add` |
| A | `lib/record-search-server.ts` | `bc5506054b6af453d7a556527e6298a9c0c86e81` |
| M | `lib/ui/pending-section.ts` | `6e989f526fc4d725a18f7b0557e2d65b3c0caac8` |
| A | `tests/record-search-route.test.mjs` | `e2dd0f22e2415414182e7f48a51580687f602776` |
| M | `tests/ux-agenda-summary-route.test.mjs` | `f19275426b30e1b0e77a2e0db4d0fa17a2390e78` |
| A | `tests/ux-tasks-budget.test.mjs` | `8d5af06b3467954a530dc696865d0b9c1f5c3e35` |
| A | `tests/ux-tasks.json` | `05dcaf1ca3ad89493b54978178eac7c685281209` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `b8cfeb9b1af93a6630132b6faa096269741186fa`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective 69de0fd"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "b8cfeb9b1af93a6630132b6faa096269741186fa" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `b8cfeb9b1af93a6630132b6faa096269741186fa`인지 확인하세요.
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-10-01 "모두 진행하라. 최고의 퍼포먼스, 사람 개입 최소화, 쉬운 사용"(Claude 세션, UX 3차 구현·단계별 게시 위임). 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인
```bash
curl -fsS "https://mealzip-agency.hflameb.chatgpt.site/api/version/public?release=69de0fd"
```
- 응답 `tree`가 `b8cfeb9b1af93a6630132b6faa096269741186fa`이면 성공입니다. 응답 전체를 그대로 보고하세요.
