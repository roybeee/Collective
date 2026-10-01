# COLLECTIVE Sites 게시 지시문: 27e6afa → bac93da

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `244dfc50043954f1ce93ae2997dbad6a04fc952d` (기준 커밋 `27e6afaeb83e7b499a25496db341a75b62dd4e3c`, 2026-10-01 `/api/version/public`에서 확인, Sites86)
- 목표 커밋: `bac93da5fbda34b853c39dbd266fec9dd4afa816` / **목표 tree `ac69cfdc4d6737aa69fba2e55253d6d380e56af1`**
- 변경 파일 29개: 추가 8 · 수정 21 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.
- 포함: #296 게시 기록(문서), #297 서버 검증 오류를 모든 폼의 해당 칸에 표시, #298 독립 평가 2회차 반영(한국어 줄바꿈·비활성/권한 이유·확인창 문장·빈 상태 행동·용어 도움말 30개·브랜드 검색), #299 캠페인 상세를 겹침 시트에서 본문 페이지로 전환(저장 안 한 입력 보호, 홈 JS 예산 유지). 새 기능 스위치 없음. API 변경 없음.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `244dfc50043954f1ce93ae2997dbad6a04fc952d`. 이미 목표 tree `ac69cfdc4d6737aa69fba2e55253d6d380e56af1`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/bac93da5fbda34b853c39dbd266fec9dd4afa816/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`:
- 없음
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.
- 대안(권장, 결과 동일): `git fetch https://github.com/roybeee/Collective.git bac93da5fbda34b853c39dbd266fec9dd4afa816` 뒤 `git read-tree -u --reset ac69cfdc4d6737aa69fba2e55253d6d380e56af1`로 목표 tree를 정확히 투영해도 됩니다. 이 경우에도 3단계 검증을 모두 수행하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| A | `app/assets-grid.tsx` | `15a2b2b7a4f56316f547580254e6bef301a2c887` |
| M | `app/campaign-detail-panel.tsx` | `afccd796345d064481df7c54b47f414e5d8f608f` |
| M | `app/command-palette-dialog.tsx` | `29541911590ada14c591b8f6996538d6c2ebf311` |
| M | `app/command-palette.tsx` | `12bcd81d829b12194a9ef7cc18af01bac01b611a` |
| M | `app/directives-panel.tsx` | `c151e0d07789afdeaf56b6312558e597edc6ad8c` |
| M | `app/globals.css` | `93c3973cfed6e2e5acb177d6fe428038e1568fbc` |
| M | `app/growth-panel.module.css` | `f9ac87d8536b8e478cde167304b539af85fcd21b` |
| M | `app/growth-signal-source-panel.tsx` | `bb95efa670810eb70c46178a745e79931167e067` |
| M | `app/learning-panel.tsx` | `0ae9e4c16f996db18bd67af027fc367cb3638dcf` |
| M | `app/meta-ads-panel.tsx` | `fa076098fba72893710036645b0d5d2c2c471038` |
| M | `app/meta-creative-panel.tsx` | `21516d1b55b069cc202f667049cfd3ffa97e43f7` |
| M | `app/panels.tsx` | `20d820b605c5c12b941afc19b29d6a23f4e89aa1` |
| M | `app/storefront-webhook-panel.tsx` | `c95154d7234c31aca5007144793ea887f947e4a5` |
| M | `app/workspace.tsx` | `a3c4e532b40eee5ae0f648a52b4e44c4bee09e12` |
| A | `components/app/field-error-bridge.tsx` | `19bcdbb10ec13faee210f823f7f3b560aa81672b` |
| M | `docs/STATUS.md` | `7bad8531b3ad03540c9c5668aa0b4d620ac806cb` |
| M | `docs/UX-PLAN-3.ko.md` | `adfb271de888d2888f45b5e2b4ab8e8cc593bfd0` |
| A | `docs/publish/27e6afa.md` | `23159d95508a52485c8c5f18feba4b26ced1e7c6` |
| A | `docs/releases/2026-10-01-27e6afa.md` | `18fb8573c2078474fbd38f251b52fb86c851e1cb` |
| M | `e2e/execution.spec.ts` | `58000ccf22eae11370870aac3876e4c71d696ff3` |
| M | `e2e/navigation.spec.ts` | `6d30edb7d4c95cd96f01625a4816e01344d0d617` |
| A | `e2e/ux-form-errors.spec.ts` | `658a018fdda17e3e880a98b50cc6f5cac143171e` |
| M | `e2e/ux-shell.spec.ts` | `fd740cc3cfdcdb0a8487513505d9f2e02bdf4109` |
| M | `lib/field-error.ts` | `7c4ef0bf35e1eaafe9a7a05636f0b352f7ba14dc` |
| A | `lib/glossary.ts` | `4309366c3eddd9ed86168502a3528996b5342826` |
| A | `lib/ui/field-errors.ts` | `94ad342512c690eaaa346f2c0f3829c19e54b599` |
| A | `lib/ui/why-disabled.ts` | `dd15e99a531456957c44d018bcd660f6dccce003` |
| M | `tests/field-error.test.mjs` | `9667aa401292f8b3842cb475eb60d404d4f1b548` |
| M | `tests/workspace-wiring.test.mjs` | `fb14bf6e4f9c4d423cc117f2685232916e4d3d20` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `ac69cfdc4d6737aa69fba2e55253d6d380e56af1`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective bac93da"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "ac69cfdc4d6737aa69fba2e55253d6d380e56af1" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `ac69cfdc4d6737aa69fba2e55253d6d380e56af1`인지 확인하세요.
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-10-01 "모두 진행하라. 최고의 퍼포먼스, 사람 개입 최소화, 쉬운 사용"(Claude 세션, UX 3차 구현·단계별 게시 위임). 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인
```bash
curl -fsS "https://mealzip-agency.hflameb.chatgpt.site/api/version/public?release=bac93da"
```
- 응답 `tree`가 `ac69cfdc4d6737aa69fba2e55253d6d380e56af1`이면 성공입니다. 응답 전체를 그대로 보고하세요.
