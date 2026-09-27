# COLLECTIVE Sites 게시 지시문: f56909d → 1f2fac1

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `2ff1fad57c1f9d6032632de40d8317da066585b6` (Sites 버전 45, 기준 커밋 `f56909d8f79766810ff50da919544b277b4d2808`)
- 목표 커밋: `1f2fac109fbfd8efc445d1ab8a0a4b75f684aa24` / **목표 tree `d8b77630a1aff611fd6bf76ebc0ca0007f4c1d28`**
- 변경 파일 53개: 추가 16 · 수정 37 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `2ff1fad57c1f9d6032632de40d8317da066585b6`. 이미 목표 tree `d8b77630a1aff611fd6bf76ebc0ca0007f4c1d28`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/1f2fac109fbfd8efc445d1ab8a0a4b75f684aa24/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`.
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| M | `app/franchise-assets-panel.tsx` | `f489d0f708c1d9e2cec9a3fed8b4db4bd077f885` |
| M | `app/franchise-common.tsx` | `dd5b0f2e0fc57ef0c08930133eab9f2fc6265577` |
| M | `app/franchise-events-panel.tsx` | `4e4bd6f798f4aad5dcc77b1df3b0d525a45cb9e4` |
| A | `app/franchise-import-panel.tsx` | `3babbb7b40190890b257a51f53afe225d63346a5` |
| A | `app/franchise-inflow-panel.tsx` | `57c9f4926913938ddfd32d3d140e78e07ab05379` |
| M | `app/franchise-lead-detail.tsx` | `3450fcfb75aaa99a1860526998a4dd27d34a91f5` |
| M | `app/franchise-panel.tsx` | `af2b666aea9a5fa0d0a83162245f8a568b6d3211` |
| M | `docs/DATA-PROCESSING.ko.md` | `622c1c62f50b1f4f625238581d07cc5dc9182818` |
| M | `docs/FRANCHISE-R5-SPEC.ko.md` | `53efc1e48d01c5d9f82360ceb6fbaa0be62f4935` |
| M | `docs/FRANCHISE-RECRUITMENT-PLAN.ko.md` | `da5adf0bec75ad00b3965493540ebf15ac753af6` |
| M | `docs/REWARD-LINEAGE.ko.md` | `6ad3582b5aac73c050d7f3b566fa53f81c8ae274` |
| M | `docs/SECURITY-BOUNDARIES.ko.md` | `774f23d6a04d105f7646bce49fd147265adfe23a` |
| M | `docs/STATUS.md` | `3ac4728efc7407329baacb5e7c5201487719e946` |
| A | `docs/observations/2026-09-27-lane-a-b3-stage4.md` | `c87c652eccd566e6b968195a2231350ab5cba929` |
| A | `docs/observations/2026-09-27-lane-r-r3c-regrade.md` | `29cee781ff57d16882886cba06a20acd97c46780` |
| A | `docs/publish/7851185.md` | `2833842794d3d2763273b44bbe7c090689db0e3c` |
| A | `docs/publish/f56909d.md` | `98e553d87f5a223943c7a2bb07f68d442bd492f7` |
| A | `docs/releases/2026-09-27-7851185.md` | `dd0a20bec54945e97c3b2a621367b82fe3db33e7` |
| A | `docs/releases/2026-09-27-f56909d.md` | `73614155bfd76c50f2d673df332993c74712efd8` |
| M | `lib/franchise-assets-server.ts` | `8fb7165b8123d202f31f72b6cfc2d24b2fbadb3a` |
| M | `lib/franchise-assets.ts` | `1985d8eb041ecda6bc9a4dd958c0606fcdbbed28` |
| M | `lib/franchise-compliance.ts` | `225aa99a10cfd73a31d904f0ce15576980481d51` |
| A | `lib/franchise-lead-import-server.ts` | `baa6e28f45ee8545554177eb92f3d59f1a39b306` |
| M | `lib/franchise-lead-import.ts` | `8fb98899d194fbfa30aff896dd6edd16e9fa9837` |
| M | `lib/franchise-recruitment-server.ts` | `b2297a959c937da9491c5126d4c4b6444f7c9bb1` |
| M | `lib/franchise-recruitment.ts` | `57eeb79552bc53e64ce7abab79d1d535fef047a0` |
| M | `lib/franchise-rules.ts` | `2d8b8389d652dccd1f42a12e75768fdf8aeac6d1` |
| M | `lib/franchise-server.ts` | `d55218c680d720cf78f3f2485c18de5e9da7dfdf` |
| A | `lib/franchise-wait-clause.ts` | `2fe7c32559ae828aa6b5e24d88892c5e41a44ed6` |
| A | `lib/franchise-wait-review.ts` | `102a5f5dd49113997c67779b4d3303a19e4cc563` |
| M | `lib/franchise.ts` | `1a26fe68c156f05ad007c05d3e0d9bb6abeb4922` |
| M | `lib/nav-state.ts` | `66f281f50b2afe44051a446fb0487f2083951afc` |
| M | `lib/record-kinds.ts` | `4a3cae767c961e7c0a7f4a8497d401d3719d7515` |
| M | `lib/reward-lineage-server.ts` | `04708a0c1af961934953ba9d3c9142b143a6171a` |
| A | `tests/fixtures/r2-wait-blind-1.json` | `10e49407a3ab9af40069912e7e509fa044e025c8` |
| A | `tests/fixtures/r2-wait-blind-2.json` | `3440e3cae3c08caf2b95d0e5da5281c09960b5b8` |
| A | `tests/fixtures/r2-wait-blind-3.json` | `afc8669e28d7efa7d7ed33fca2eca6ae885631cb` |
| M | `tests/franchise-assets-route.test.mjs` | `b1434c0d984459bedc523333c031733ccef82812` |
| M | `tests/franchise-assets.test.mjs` | `4fce195642c7af5d3c9f968a3ede8f047541192c` |
| M | `tests/franchise-compliance.test.mjs` | `972bf6f4dfb24576307e8fe61fb8ef80106f182a` |
| A | `tests/franchise-inflow-ui.test.mjs` | `694f704042d7804ec64c7e7ee08889005265ff92` |
| M | `tests/franchise-lib.test.mjs` | `55f51d08fa0d57ddf9f132f5fda30acda204e51e` |
| M | `tests/franchise-model-boundary.test.mjs` | `42191e5cd02d7d890c1d000e9f43a2d0ce5fdc03` |
| M | `tests/franchise-recruit-ui.test.mjs` | `716ace94501f4d7baced4fa0467a2eff7417d4e4` |
| M | `tests/franchise-rules.test.mjs` | `035a9855a7fb1f9ee93a6bd8b8fdcebc1836a2d7` |
| M | `tests/franchise-ui-render.test.mjs` | `0deee4683525216fe0c794e5821ed894858b2309` |
| M | `tests/franchise-ui.test.mjs` | `907ea0efb40d1e4e04ed4880b38ab0d21bcb7099` |
| A | `tests/lead-import-route.test.mjs` | `3991a8c120766e0c05e4dfbffdfd4bee1f67a956` |
| M | `tests/lead-import.test.mjs` | `9c561b157352a7ec0f552aa11712e50092ef4e65` |
| M | `tests/nav-state.test.mjs` | `c9764009f3a0ecbd303f1e9a6fa0241f7c97012c` |
| M | `tests/record-kinds.test.mjs` | `642e71a3699afed9b4f253f26326098fcb219cb2` |
| M | `tests/recruitment-codes.test.mjs` | `e5f6adf6431a35c8bcd07ab6499b1c5b9f36a244` |
| M | `tests/reward-lineage-server.test.mjs` | `8e7e41f3fc1bde548cb9348f3f8149e977a97712` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `d8b77630a1aff611fd6bf76ebc0ca0007f4c1d28`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective 1f2fac1"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "d8b77630a1aff611fd6bf76ebc0ca0007f4c1d28" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `d8b77630a1aff611fd6bf76ebc0ca0007f4c1d28`인지 확인하세요(빌드 뒤 tree 재확인).
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요. 다른 폴더나 이전 빌드 결과를 쓰지 마세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. `save_version_and_deploy_private` 같은 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-09-26 "원스탑으로 다 진행하라"(병합·게시 위임), 2026-09-27 "B2 2단계 빼고 남은 개발을 모두 진행하라"(세션 29f7af 전달), 2026-09-27 "진행하라"(보상 계보 수정 포함). 게시 SHA 선택은 2026-09-25 위임. 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인 (로그인한 소유자 브라우저 콘솔)
```js
await (await fetch('/api/version', {credentials: 'same-origin', cache: 'no-store'})).json()
```
- 응답 `tree`가 `d8b77630a1aff611fd6bf76ebc0ca0007f4c1d28`이면 성공입니다. 응답 전체를 그대로 보고하세요.
