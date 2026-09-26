# COLLECTIVE Sites 게시 지시문: 98f2283 → a8edf10

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `d11b2e1d0db931188eb6f5eb0fa12b29d58adbdc` (Sites 버전 41, 98f2283 — /api/version/public로 2026-09-27 확인, 기준 커밋 `98f22833a32cd6e60bd000bdc752e1a6812ca349`)
- 목표 커밋: `a8edf1043e3dc29129b6c9895911fd170dd93f83` / **목표 tree `5705e55c1b16c62cedfa02b49772c66216398db0`**
- 변경 파일 35개: 추가 17 · 수정 18 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `d11b2e1d0db931188eb6f5eb0fa12b29d58adbdc`. 이미 목표 tree `5705e55c1b16c62cedfa02b49772c66216398db0`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/a8edf1043e3dc29129b6c9895911fd170dd93f83/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`.
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| A | `app/api/customer-reports/route.ts` | `8dacbc7e4752c85b9f14ef6186d047e21290c3f6` |
| M | `app/brand-facts-panel.tsx` | `f6d47c8329fa2275261f6cfad6191960d327f832` |
| A | `app/customer-report-panel.tsx` | `f24cb5a829b6b84e7c51a1b9c1601ecce583fba3` |
| M | `app/store-marketing-panel.tsx` | `6bed355b3d66ca7bac663058d541600926e48666` |
| M | `docs/CUSTOMER-REPORT.ko.md` | `532db7f8b2d5892a9421e9129daa8d1c24004a64` |
| M | `docs/FRANCHISE-RECRUITMENT-PLAN.ko.md` | `0e17d3a675b389b60ff70bc6311a60689778d9a5` |
| M | `docs/GROWTH-PLAN.ko.md` | `7e21f5b41f6e5367d4125b3e2b52a6c8f2a3b5bd` |
| A | `docs/REWARD-LINEAGE.ko.md` | `47129b4025ec12c0cb63973dbb4ed1a7a0042f1a` |
| M | `docs/SECURITY-BOUNDARIES.ko.md` | `8dc5dca615388328e4dfa5922cbfc5001c3c284d` |
| M | `docs/STATUS.md` | `97b75b208d775dc89c033b82445ec7d4ac9ebba5` |
| A | `docs/observations/2026-09-26-lane-r-s7-industry.md` | `0d81c256b569399968d9d945c14e9f4205a0cbc3` |
| A | `docs/publish/98f2283.md` | `a31d416be55f7839a2c42965dbf70b9e1aa3b785` |
| A | `docs/releases/2026-09-27-98f2283.md` | `f092fa615b0d3c17362823d677528a9ffcff35ec` |
| A | `e2e/customer-report.spec.ts` | `49bd31c6620bdc800eef8595cbcfb47915da3c48` |
| M | `lib/copy-pack.ts` | `10725164e6a8e0e25721f1ddefc0251ff8d0a80f` |
| A | `lib/customer-report-server.ts` | `8755f4ff1df4e119b2da7712c358b7020321edd7` |
| A | `lib/customer-report.ts` | `7bc78dbc3e541332b37656ef234a10fd863cbe9c` |
| A | `lib/fact-pack.ts` | `e99d592b4b3cd48cc6933bae009e31017e7d69ab` |
| M | `lib/feature-flags.ts` | `9e96e06bbbd0c5ec8836bceb345a4cc924d13bd0` |
| M | `lib/feature-status.ts` | `84d2b9a0944b0a9af8f6ec93b5e013d17c1c6969` |
| M | `lib/nav-state.ts` | `08385eed7c4a85ee2adc8bd38077e4ee1bc567c9` |
| M | `lib/record-kinds.ts` | `9ad2009a76a6e80d53ab1a30d66324a211f9af0b` |
| A | `lib/reward-lineage.ts` | `17a4d93ed0ea0798068e806293f647ea220dfb71` |
| M | `lib/store-operations-server.ts` | `92406ab10833d5df29d1b21e0191b4088d077ebb` |
| M | `tests/copy-pack.test.mjs` | `5360171498632bf89a7961da6200fd46c57747f0` |
| A | `tests/customer-report-server.test.mjs` | `87b52a5ab1c84277df8e4c09b974c3ad6440e457` |
| A | `tests/customer-report-ui.test.mjs` | `081c6fe486e1d6bbe004a069a8d01f9cc8e23d75` |
| A | `tests/customer-report.test.mjs` | `fb666d0b2004b531f777f0ce37bd81a0d4a4a787` |
| A | `tests/fact-pack.test.mjs` | `0558d0c658501d02475a344eb48439dbda74da2d` |
| M | `tests/feature-flags.test.mjs` | `6ea6fa2e5c94b05e639a2194e32266af642f29c7` |
| M | `tests/feature-status.test.mjs` | `0edbba8a2bda78bfffb889c107648f95ec3a41ec` |
| M | `tests/nav-state.test.mjs` | `eec3d89b9fd6a403c0dae7ba887c47348934cd87` |
| M | `tests/place-check.test.mjs` | `465cb4d4b3a8c7708b9dada4b5f6b7f8d2b86193` |
| A | `tests/r3c-s7-industry.test.mjs` | `1a58552ee2b6237a5dec4e1d6e9a0f8d267c0a85` |
| A | `tests/reward-lineage.test.mjs` | `69fae347a0515103ce8e0fa5cb876a8833fb6da3` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `5705e55c1b16c62cedfa02b49772c66216398db0`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective a8edf10"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "5705e55c1b16c62cedfa02b49772c66216398db0" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `5705e55c1b16c62cedfa02b49772c66216398db0`인지 확인하세요(빌드 뒤 tree 재확인).
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요. 다른 폴더나 이전 빌드 결과를 쓰지 마세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. `save_version_and_deploy_private` 같은 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-09-26 "원스탑으로 다 진행하라"(병합·게시 위임), 2026-09-27 "B2 2단계 빼고 남은 개발을 모두 진행하라"(세션 29f7af 전달). 게시 SHA 선택은 2026-09-25 위임. 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인 (로그인한 소유자 브라우저 콘솔)
```js
await (await fetch('/api/version', {credentials: 'same-origin', cache: 'no-store'})).json()
```
- 응답 `tree`가 `5705e55c1b16c62cedfa02b49772c66216398db0`이면 성공입니다. 응답 전체를 그대로 보고하세요.
