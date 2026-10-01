# COLLECTIVE Sites 게시 지시문: 9ef5e42 → 27e6afa

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `5dcd815de2aacbdb1c3a58f1aad746fa659a1355` (기준 커밋 `9ef5e42ac5703a91a7a7bce4bf9abd90f498a111`, 2026-10-01 `/api/version/public`에서 확인, Sites85)
- 목표 커밋: `27e6afaeb83e7b499a25496db341a75b62dd4e3c` / **목표 tree `244dfc50043954f1ce93ae2997dbad6a04fc952d`**
- 변경 파일 23개: 추가 4 · 수정 19 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.
- 포함: #294 게시 기록(문서), #295 캠페인 단계 주소화(csub)·캠페인 상세 1120px·탭 줄 고정·이동 경로·서버 400을 입력 칸 오류로 표시·보기 전용 이유·CSS 색 정리(487→146, 눈으로 구분 어려운 차이만)·겹침 자동 검사·CI e2e 시간 제한 30분. 새 기능 스위치 없음. API 변경 없음.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `5dcd815de2aacbdb1c3a58f1aad746fa659a1355`. 이미 목표 tree `244dfc50043954f1ce93ae2997dbad6a04fc952d`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/27e6afaeb83e7b499a25496db341a75b62dd4e3c/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`:
- 없음
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.
- 대안(권장, 결과 동일): `git fetch https://github.com/roybeee/Collective.git 27e6afaeb83e7b499a25496db341a75b62dd4e3c` 뒤 `git read-tree -u --reset 244dfc50043954f1ce93ae2997dbad6a04fc952d`로 목표 tree를 정확히 투영해도 됩니다. 이 경우에도 3단계 검증을 모두 수행하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| M | `.github/workflows/ci.yml` | `d4e9e25c71a0965d97583d417846abd660895452` |
| M | `app/auth.css` | `c91ff2b7e634d0488201564026f3d0359deba247` |
| M | `app/globals.css` | `7e62a6fee6e5c6e0f9a0ee38a62fb9526a535d37` |
| M | `app/growth-panel.module.css` | `e507e7b34b09a056e20493968b9d95e221d8dc34` |
| M | `app/growth-panel.tsx` | `da0fb2a44a456e38a3618657005b4485788f7abf` |
| M | `app/meta-ads-panel.module.css` | `531c97ed922569f138afdd0b4d065a4c7c4a9679` |
| M | `app/meta-ads-panel.tsx` | `dad8d93caf7601bed512faaee5721585df265b7a` |
| M | `app/meta-insights-panel.module.css` | `dfce886f81d7feefae046fcafbd6ef5133b8883a` |
| M | `app/panels.tsx` | `7f9124510725f915e71dd5cf3b8e2e6200194dc9` |
| M | `app/storefront-orders-panel.module.css` | `dfc4baa1f5d7006ef1485ff8989d878234430182` |
| M | `app/workspace.tsx` | `f47bd3227f614fd074da217ca819705624e2d53d` |
| M | `docs/STATUS.md` | `10c94fe424fc53ef8eb77a45a25ea5f51ce447b1` |
| M | `docs/UX-PLAN-3.ko.md` | `0796536fc847d9e3ea575b1627cdc36e05848a58` |
| A | `docs/publish/9ef5e42.md` | `c5ba7e5c10242df898b805cbedffd312714e8610` |
| A | `docs/releases/2026-10-01-9ef5e42.md` | `11835c65765c93566dff47e780e52cffb294de7f` |
| M | `e2e/ux-budget.spec.ts` | `32b9f10706ad16f3354012c5db50bc23493e9e3f` |
| M | `e2e/ux-ease.spec.ts` | `6e72262625c5fe1e6fa2813eb3d1007be0a3a6aa` |
| M | `e2e/ux-shell.spec.ts` | `f8529c106f6c33dbb6d31bfca366714f326b7e14` |
| A | `lib/field-error.ts` | `a3330b5428bc6fac93de56c9f218361d04576c61` |
| M | `lib/nav-state.ts` | `24822f0faff3722eecda2f6ba1cf200183478db7` |
| A | `tests/field-error.test.mjs` | `2759f08143f097ec6da302ddbae3d4e8fc709081` |
| M | `tests/nav-state.test.mjs` | `7b6e147d29423d66ef1850b199be1e325efbdc0e` |
| M | `tests/ux-budget.json` | `503f141e525a8c65dcc2bf156f1019b4e095307a` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `244dfc50043954f1ce93ae2997dbad6a04fc952d`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective 27e6afa"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "244dfc50043954f1ce93ae2997dbad6a04fc952d" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `244dfc50043954f1ce93ae2997dbad6a04fc952d`인지 확인하세요.
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-10-01 "모두 진행하라. 최고의 퍼포먼스, 사람 개입 최소화, 쉬운 사용"(Claude 세션, UX 3차 구현·단계별 게시 위임). 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인
```bash
curl -fsS "https://mealzip-agency.hflameb.chatgpt.site/api/version/public?release=27e6afa"
```
- 응답 `tree`가 `244dfc50043954f1ce93ae2997dbad6a04fc952d`이면 성공입니다. 응답 전체를 그대로 보고하세요.
