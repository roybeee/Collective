# COLLECTIVE Sites 게시 지시문: c59983a → 4ec6da6

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `e4e19042f8bda6d1ae1ffa3dcb8b3b3fe0058c23` (기준 커밋 `c59983afc9a925f779c2f5051663c28165971f34`, 2026-10-02 `/api/version/public`에서 확인, Sites90)
- 목표 커밋: `4ec6da62164b2dd10cbb86b2cf51d6d678283613` / **목표 tree `2865645871226df806bfef0de40bbfc73a2291e8`**
- 변경 파일 96개: 추가 5 · 수정 91 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.
- 포함: #308 게시 기록(문서), #309 막힌 버튼 이유 전면 적용·인라인 스타일 0·빈 상태 100%·독립 평가 6회차 반영(권한 숨김 별칭, 모바일 44px, 브랜드 아카이브 탭 주소, 보관 되돌리기). 새 기능 스위치 없음. API 변경 없음.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `e4e19042f8bda6d1ae1ffa3dcb8b3b3fe0058c23`. 이미 목표 tree `2865645871226df806bfef0de40bbfc73a2291e8`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/4ec6da62164b2dd10cbb86b2cf51d6d678283613/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`:
- 없음
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.
- 대안(권장, 결과 동일): `git fetch https://github.com/roybeee/Collective.git 4ec6da62164b2dd10cbb86b2cf51d6d678283613` 뒤 `git read-tree -u --reset 2865645871226df806bfef0de40bbfc73a2291e8`로 목표 tree를 정확히 투영해도 됩니다. 이 경우에도 3단계 검증을 모두 수행하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| M | `app/assets-grid.tsx` | `bd844f9ed445d386dccb95023e381619b969aee0` |
| M | `app/brand-archive.tsx` | `c20cf91adb3f9bc27e4ae066ea8f39d62fb7a910` |
| M | `app/brand-facts-panel.tsx` | `15546d2f24a862fcc3f9c3ba78bb858ad6774a2f` |
| M | `app/brand-voice-panel.tsx` | `5d085ee705d69a3e80529b76c322ee34e4c06dcb` |
| M | `app/campaign-brief.tsx` | `915454f3c17ffa21815ef042e5e22d6b9d40681d` |
| M | `app/campaign-history.tsx` | `0479ecbc3a4388dfdcb8b85989354c807214882e` |
| M | `app/campaign-metrics.tsx` | `6767be9b2642324aaf09ad9d75bea26cf93f4dc0` |
| M | `app/data-requests-panel.tsx` | `9e1bf216f37426aa0d9c46f49a76b9728febc43c` |
| M | `app/delete-campaign-dialog.tsx` | `775c7d1d24cf704301dd1d2436fd5d33e0cf60dd` |
| M | `app/directives-panel.tsx` | `f1e5d694ebb5f3d6b2c09668132078cb315e189f` |
| M | `app/execution-panel.tsx` | `918a70bc53bac8e416656aa75f5c70e589d05ee7` |
| M | `app/globals.css` | `a5bf93aa32155533dd65809cb5f9e95bdfb7d97a` |
| M | `app/growth-authority-panel.tsx` | `b80d6356068dec75a9ac1e07c0b75808826ff794` |
| M | `app/growth-bundle-panel.tsx` | `bb9a11b7d89ba45e42a5ced6285faef021576bda` |
| M | `app/growth-cause-links-panel.tsx` | `40d5ca88aef4509f2929332dfca087546848f155` |
| M | `app/growth-collaboration-panel.tsx` | `8169cd32c7afe5b8afd2edbbccef930bf5e4ad14` |
| M | `app/growth-conditional-panel.tsx` | `82e352ea85d95a72b44c351c9ba01759326fab17` |
| M | `app/growth-consumer-panel.tsx` | `e52d26035006010aa81cff0b29f9cb41c5aca6ca` |
| M | `app/growth-cs-panel.tsx` | `ff47db69239acde0cec4a0b947bec83c72d61a6b` |
| M | `app/growth-daily-panel.tsx` | `0017af0bc6ca97dceaa91d0b64a6b7f9d565a3c7` |
| M | `app/growth-decisions-panel.tsx` | `3b7117dd7445c66be167d33c32c591fa2e57ef11` |
| M | `app/growth-demand-evidence-panel.tsx` | `ff609623c970ef1fdf60681ec9dadd874b86419e` |
| M | `app/growth-demand-panel.tsx` | `300ed78b103fa10a253bcb43d5781ab2a04d9796` |
| M | `app/growth-detection-panel.tsx` | `4a8f74f2a9a47c2f13d844e0c68fa396c737c123` |
| M | `app/growth-execution-panel.tsx` | `bd57ca2b3bd15c7a7a8b4b308a5e45e079e2d2c8` |
| M | `app/growth-expansion-panel.tsx` | `70045f57e972f6d0168718f3b4770bc384eb76d9` |
| M | `app/growth-experiment-panel.tsx` | `a2cb27a40bbebd44740bd99f67049841fd6b40b0` |
| M | `app/growth-journey-panel.tsx` | `87afa75d73007d725604743823629632e1a54ada` |
| M | `app/growth-landing-panel.tsx` | `aac9620c4ecf98ec4351d5723392912aa7698bc0` |
| M | `app/growth-lesson-applications-panel.tsx` | `eb6934d94187cd3f6196e3eb0c6a49340c55a3dc` |
| M | `app/growth-operation-review.tsx` | `03d5cb81ead570978ab49ed51b634e46e2161519` |
| M | `app/growth-operations-panel.tsx` | `91620eabc517b8eda0edd610f3365bb22ef06ef2` |
| M | `app/growth-opportunity-board.tsx` | `a836e1b9145c4af37ec47bf1e5224ac2d04e5128` |
| M | `app/growth-optimization-panel.tsx` | `0e3eb817efadf5f554b0037a7e0bd5a785f8967a` |
| M | `app/growth-panel.tsx` | `f3c3eab599dd663869e6d0630ebe409569cd8d70` |
| M | `app/growth-publication-observation-panel.tsx` | `a69f3182645caf194e2d68580d71a568d1f0622d` |
| M | `app/growth-publication-panel.tsx` | `209b53ae597e3d02309a5c50dc56de26f94921ff` |
| M | `app/growth-reconciliation-panel.tsx` | `0443a17563c53ccd63eb344e1310aeb7574d836d` |
| M | `app/growth-reorder-panel.tsx` | `ec0891f8f25071ff1e545ca9427f5dedfa6ad1ea` |
| M | `app/growth-return-reasons-panel.tsx` | `0ea19798ba8dae921ffe21287fb8e0d6ce977d75` |
| M | `app/growth-settlement-panel.tsx` | `0c0a841a937881381522ca8a6d8bca85faef6f0f` |
| M | `app/growth-signal-source-panel.tsx` | `35cef411b12b41cd7c5a7d4302856ff8d32b21f6` |
| M | `app/growth-sourcing-panel.tsx` | `3198916af4335acc0e3477187edd74661676a39b` |
| M | `app/growth-stop-panel.tsx` | `499614ca643f9bebff3831d7c2f8406b8bd0fc59` |
| M | `app/growth-targets-panel.tsx` | `ea9e0ca199c388c2b4e7d8172e500b327913d1a4` |
| M | `app/judge-label-panel.tsx` | `6ec0dc79a5848fa4c34786bbb6ce7e3433333d0b` |
| M | `app/learning-panel.tsx` | `d8ce0d562ee4195905bd593dbe73718aec775dbc` |
| M | `app/measurement-collect.tsx` | `712b3b4979652c404cb2b603e8f4e83fd05b847e` |
| M | `app/meeting-panel.tsx` | `21b12b6e914c762cb39f14e7aaecbf08a5e0a8d0` |
| M | `app/meta-ad-bundle-panel.tsx` | `a38340f165705cbc8f94d0d42d2d860ebce91ba9` |
| M | `app/meta-ad-create-panel.tsx` | `a66a880173b92441c8ead73215693bd2ae15831d` |
| M | `app/meta-budget-panel.tsx` | `7f1ac355e7947cbca8620818abebce3b082717b2` |
| M | `app/meta-campaign-picker.tsx` | `49215b8116e3ab72b7742383b377af48e93a5329` |
| M | `app/meta-capi-panel.tsx` | `65e07bd1a99e201728049b665b39fd4787899c28` |
| M | `app/meta-conversion-panel.tsx` | `2fa1ef5b27626f8e28785f3299c462ff7bec03c3` |
| M | `app/meta-creative-panel.tsx` | `effa78d2c9d5f2d95ea2a6f3b5858c22cda21ca4` |
| M | `app/meta-execution-panel.tsx` | `9fc89e9ef5a97f82434fc065656d9880c9444db9` |
| M | `app/meta-experiment-panel.tsx` | `0020ee441be5b59b7db75971f5372cc530e07cb9` |
| M | `app/meta-image-upload-panel.tsx` | `76c781cd2025b96f167b9dab0cfc952a9bbaa366` |
| M | `app/meta-insights-panel.tsx` | `a504c61ecf05703dd85ce0b1f6f62d0da8754b00` |
| M | `app/meta-learning-panel.tsx` | `ddb719cd17cefc9a69e9574cc09c35990be32c41` |
| M | `app/meta-paused-panel.tsx` | `2b877e7744c059f1a897d2968a68177d02789a05` |
| M | `app/meta-report-panel.tsx` | `17888f30f79e5127fcea3f1e71e2ad90084913f9` |
| M | `app/meta-reservation-panel.tsx` | `9023b8fb3ae255e1427bc86c3bb39fb938e0b4a4` |
| M | `app/panels.tsx` | `af687070c8c4c67451219fef3b39af1ee2a82ea7` |
| M | `app/place-check-panel.tsx` | `ad7e0c9119b1de00412a070e2340d4917cce7bd1` |
| M | `app/publication-experiment.tsx` | `1b86f86e33fc5b65247fa5a1c2c48b1514791f08` |
| M | `app/research-worker-panel.tsx` | `9158818752e1f4d16aa5649c04428c7c66c96a87` |
| M | `app/reward-lineage-section.tsx` | `f32cc4bc111f83ffe28afb1309f816221d2e3405` |
| M | `app/role-detail-dialog.tsx` | `6eca0491dd1cfa0e4cd41be009f7c3a94c334a3d` |
| M | `app/store-marketing-panel.tsx` | `45204a26e1e41f609592892be17bb9a5beebb00e` |
| M | `app/store-operations-panel.tsx` | `ea9caa80c87c1ae98a3cbd006238b54981ab7fa5` |
| M | `app/storefront-orders-panel.tsx` | `5103bbafa52ba2c8e48f130bd55ba6a0b34b300e` |
| M | `app/storefront-pull-panel.tsx` | `cd8dcdf21ce3a449c0e93024765e00a352b684f1` |
| M | `app/storefront-webhook-panel.tsx` | `91c6e7fef958a4fd448a3ae3a6038061f767a8b0` |
| M | `app/workspace-views.tsx` | `0207e1ddb4005c047e3d410c81a7ee27444ad20d` |
| M | `app/workspace.tsx` | `ade323f45f33ee4c3d1b31f5538e4236f54ff861` |
| M | `components/app/empty-line.tsx` | `1ce9aba9db6e2c5dcee3271623c658fe7a79706f` |
| M | `docs/STATUS.md` | `941ec3c3ba6f9d2b6e931dddbd0d76869f98cf97` |
| M | `docs/UX-PLAN-3.ko.md` | `13959b1d77d5302f3c4226e050ba5af7384205b3` |
| A | `docs/publish/c59983a.md` | `e0ceacc3635897474056c4d18016bfd5012e8800` |
| A | `docs/releases/2026-10-02-c59983a.md` | `79e043f02d1ef383a8f0fa382e61d618bbef1eed` |
| M | `e2e/growth-publication-observation.spec.ts` | `329bd851a43d5c2d04d69e8917bc852a1fa28696` |
| M | `e2e/store-measurement.spec.ts` | `8e62fbeea04230f18139c3c41f7b136464f1cf63` |
| M | `e2e/storefront-orders.spec.ts` | `c454fd8bcb14744b1ce50de4c722ec087034678b` |
| A | `e2e/ux-address.spec.ts` | `8fb42458a7cd2f59c8ce81d31b9d6e9280cf1fbb` |
| M | `e2e/ux-empty.spec.ts` | `6e508f8d78cf7599c16688575deb6d1447f323a5` |
| A | `e2e/ux-undo.spec.ts` | `7c6614decad5b2564bd211712b023d9990e63338` |
| M | `lib/nav-state.ts` | `3be6f03f544567e4aaa1f14c72a4971ef25a1676` |
| A | `lib/ui/css-vars.ts` | `c52ddf60e510e4f77c862f8770c94676725d5441` |
| M | `tests/execution-store-links.test.mjs` | `060c0813edbeb7b6de6366758c09c3f57c71912e` |
| M | `tests/feature-status.test.mjs` | `f40e8870ce9158fab6ebbfa534f882c761ef1b7f` |
| M | `tests/nav-state.test.mjs` | `6ca8bb03cdb35772ca600769c3003483c67ec34e` |
| M | `tests/store-operations-view.test.mjs` | `45de1c7b9b8a30ce7f0ca2701ed7404d7db0c261` |
| M | `tests/ux-budget.json` | `5240e369c7f5cda6ad4fd35b15168f491528ffff` |
| M | `tests/ux-budget.test.mjs` | `50a7fa3eb747aced37b25a99b438167ecaa00171` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `2865645871226df806bfef0de40bbfc73a2291e8`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective 4ec6da6"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "2865645871226df806bfef0de40bbfc73a2291e8" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `2865645871226df806bfef0de40bbfc73a2291e8`인지 확인하세요.
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-10-01 "모두 진행하라. 최고의 퍼포먼스, 사람 개입 최소화, 쉬운 사용"(Claude 세션, UX 3차 구현·단계별 게시 위임). 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인
```bash
curl -fsS "https://mealzip-agency.hflameb.chatgpt.site/api/version/public?release=4ec6da6"
```
- 응답 `tree`가 `2865645871226df806bfef0de40bbfc73a2291e8`이면 성공입니다. 응답 전체를 그대로 보고하세요.
