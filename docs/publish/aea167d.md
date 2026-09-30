# COLLECTIVE Sites 게시 지시문: 2dd2f63 → aea167d

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `53fa65cc090aa0032aa90bbe2d39a552fa515599` (기준 커밋 `2dd2f635a31eccf231ae59fc43c0caf2d978c2bf`, 2026-09-30 `/api/version/public`에서 확인)
- 목표 커밋: `aea167d4c26bd8cb50c44008570f38e0537e41d7` / **목표 tree `035d3b14027333a53748d48032afdb3422c7e8ae`**
- 변경 파일 119개: 추가 106 · 수정 13 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.
- 포함: #285 성장2 원안 잔여 카드(Claude 인계). 새 기능 스위치 `growth_daily_loop`·`storefront_pull`은 기본 OFF.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `53fa65cc090aa0032aa90bbe2d39a552fa515599`. 이미 목표 tree `035d3b14027333a53748d48032afdb3422c7e8ae`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/aea167d4c26bd8cb50c44008570f38e0537e41d7/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`:
- 없음
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.
- 대안(권장, 결과 동일): `git fetch https://github.com/roybeee/Collective.git aea167d4c26bd8cb50c44008570f38e0537e41d7` 뒤 `git read-tree -u --reset 035d3b14027333a53748d48032afdb3422c7e8ae`로 목표 tree를 정확히 투영해도 됩니다. 이 경우에도 3단계 검증을 모두 수행하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| A | `app/api/growth/bundles/route.ts` | `57028249e02c07fe69a68bd9714861cb5ff6d5ed` |
| A | `app/api/growth/cause-links/route.ts` | `0dbc87e9b50b4deec4dc71b9e53979607687859e` |
| A | `app/api/growth/collaborations/route.ts` | `fa5d478a9a8929103c458f151260701c93edf02f` |
| A | `app/api/growth/conditional/route.ts` | `1fab64882401bc6ba2ca421ecd62688e93fea61c` |
| A | `app/api/growth/cs/route.ts` | `13e5cc2b8d901b01b817c14688614a535f87a434` |
| A | `app/api/growth/daily/route.ts` | `10cc69b149bc42f1939f468f113b22e9dda6edf3` |
| A | `app/api/growth/demand-evidence/route.ts` | `c25f954bef0bc7215a93df5b8d33c2fa1dfb9cb8` |
| A | `app/api/growth/detections/route.ts` | `ed796f058c3767ff7a6e583c0ee217a31a2114b3` |
| A | `app/api/growth/expansion/route.ts` | `1cf54236f88f3ff1798f54b4e2e7f15558c669af` |
| A | `app/api/growth/experiments/route.ts` | `58e86105bd7ad5ea37879994c7c52e89519d55b0` |
| A | `app/api/growth/landing/route.ts` | `ed35051dbd6fb09a80c9f03e299368b06ecf442e` |
| A | `app/api/growth/lesson-applications/route.ts` | `2840d5012252e6984b48136424cd0f60f53876ee` |
| A | `app/api/growth/optimization/route.ts` | `cc490c11dd853607481a9443d704abd205cdef80` |
| A | `app/api/growth/profit/route.ts` | `ebaa005d0693a8bf13260da79ca8d6e07251578c` |
| M | `app/api/research-worker/route.ts` | `ab56b345c38abe9973b9047a6fd61cacf8886400` |
| A | `app/api/storefront-pulls/route.ts` | `a4bbb1f8fa17e86abd88ed7343c7450d4a414e37` |
| A | `app/growth-bundle-panel.tsx` | `4b52f094cb2219cba97921dea249e57507e643c7` |
| A | `app/growth-cause-links-panel.tsx` | `eabfaf3414b552dc7417f6e9053c1e27b8bbf4db` |
| A | `app/growth-collaboration-panel.tsx` | `d08e92b93c3e5930639e8d4c855ca53cd7f51835` |
| A | `app/growth-conditional-panel.tsx` | `964b72f65a72c1170fdd68132d2768b8757013e8` |
| A | `app/growth-cs-panel.tsx` | `be9d2c16c2a2eee42a27ad3bb6ba3af590886bfe` |
| A | `app/growth-daily-panel.tsx` | `3cf56912dd0d1551cd7c7d481e6f9aeb28918729` |
| A | `app/growth-demand-evidence-panel.tsx` | `bb8b19bba0a8d7b3984bb6c8eca0068e9200ab60` |
| A | `app/growth-detection-panel.tsx` | `38807888c124d8d58cb99a9f946f34f9fc928d29` |
| A | `app/growth-expansion-panel.tsx` | `99cd9d6e3f0c63da0368059deee7f8647e5e0e1f` |
| A | `app/growth-experiment-panel.tsx` | `36f1c50a94e853f3037c50e6ef439bd2711029e3` |
| A | `app/growth-landing-panel.tsx` | `4949522d7eb98cd278f18736cd83060e0491ff97` |
| A | `app/growth-lesson-applications-panel.tsx` | `37501d0e94a3650ef2187d8b0d5b3eb70e028dc1` |
| A | `app/growth-optimization-panel.tsx` | `4bae9c1d584730afab60e9eb4f58e48580731590` |
| A | `app/growth-panel-boundary.tsx` | `bea39e0cf3df4d2a939f52b0eee3e377df0fb6ef` |
| M | `app/growth-panel.tsx` | `229f5e6f6f1e9d9a5599f2d931622ff89c51c7b3` |
| A | `app/growth-profit-panel.tsx` | `013e74a85ca59d9b148822362d86906e900f9e39` |
| A | `app/storefront-pull-panel.tsx` | `e486a7cf394a745007933fac4e756a8220d3ffe4` |
| A | `docs/GROWTH-2-BUNDLES.ko.md` | `a25e4bd5334959433e5c686180829c529dc38188` |
| A | `docs/GROWTH-2-CAUSE-LINKS.ko.md` | `b4c93e0bcad1fbe1837a1d69075f8325cd7379c0` |
| A | `docs/GROWTH-2-COLLABORATION.ko.md` | `deb6732c28570666cbc35ab4cda120b34a12da09` |
| A | `docs/GROWTH-2-CONDITIONAL.ko.md` | `960c65ae417f3afe39e714ada5f6f25efb91164e` |
| A | `docs/GROWTH-2-CS.ko.md` | `e16a0bb8604a1ebe40ab0c1032943a6bcccd59dd` |
| A | `docs/GROWTH-2-DAILY-LOOP.ko.md` | `9ef3b3d1ef33d4ae0a13683ffad8b95c74c9e8d5` |
| A | `docs/GROWTH-2-DEMAND-EVIDENCE.ko.md` | `062ad8e4f1f37885fa19c8e415d3422b7224ed13` |
| A | `docs/GROWTH-2-DETECTION.ko.md` | `7d87690cf4d095abe99e3589124455434fa90ec7` |
| A | `docs/GROWTH-2-EXPANSION.ko.md` | `25b571d232f8588f613ecc15e898c3bffb806fa5` |
| A | `docs/GROWTH-2-EXPERIMENTS.ko.md` | `25e8f1c32ba3b2b024ede6a2b3f0c183abf48628` |
| A | `docs/GROWTH-2-LANDING.ko.md` | `45b38d7f50d24480df9eca81c645e74644b6c8f6` |
| A | `docs/GROWTH-2-LESSON-APPLICATIONS.ko.md` | `166f2886bd061a275299d8d1336bf748a054c171` |
| M | `docs/GROWTH-2-NEXT-GAPS.ko.md` | `d3d214b6e47a1210e2f28e914742e1fd6382663b` |
| A | `docs/GROWTH-2-OPTIMIZATION.ko.md` | `fbc0927b0c8c275f10d0e9f92bd5e06fa2040284` |
| M | `docs/GROWTH-2-PLAN.ko.md` | `37ae711b72e8487d3d84b1456cc30ac20714475d` |
| A | `docs/GROWTH-2-PROFIT.ko.md` | `0d6bd01ad37fcd12728f83d52ba0f76f2d33030f` |
| M | `docs/LANES.ko.md` | `938d91999b5657cdbb6355abab49b204901fa7b3` |
| M | `docs/STATUS.md` | `bb35d2cd0aab36a9bc92219b0b4abf0c0b95f0f6` |
| A | `docs/STOREFRONT-PULL.ko.md` | `2b6b291427e37d34227f20243dde277e2c012945` |
| A | `e2e/growth-bundle.spec.ts` | `029d69aa46515b4711e35b5b1ad783cec651e3d5` |
| A | `e2e/growth-cause-links.spec.ts` | `0d8d7b8b89a4e6309b9e1e4353960fba5149b8d5` |
| A | `e2e/growth-collaboration.spec.ts` | `14eb4dd39f1580810585485bae00d3aa7632d52e` |
| A | `e2e/growth-conditional.spec.ts` | `9e6c19b05603d263267dbffd68ca3d72a8d722fa` |
| A | `e2e/growth-cs.spec.ts` | `473473087506f8b986f33d4e2cb3eaefbbb76e1f` |
| A | `e2e/growth-daily.spec.ts` | `fe22073f9fef23c1044283274824b0a608025826` |
| A | `e2e/growth-demand-evidence.spec.ts` | `2859fa15e718e962d715f38acdd6f3d293bccff4` |
| A | `e2e/growth-detection.spec.ts` | `b503e364b0774c4d89edff7efd63bc756e498bc3` |
| A | `e2e/growth-expansion.spec.ts` | `928af375c1b7cc56282ea508a6ca460b41ba87e4` |
| A | `e2e/growth-experiment.spec.ts` | `37062f50a01d1fad7abd5da29a56613099598775` |
| A | `e2e/growth-landing.spec.ts` | `5052f4f5f5da12979ffb8cd23cb9fcd2eabb9e73` |
| A | `e2e/growth-lesson-applications.spec.ts` | `061175553a073962a8f07d963b1b50ad1158d498` |
| A | `e2e/growth-optimization.spec.ts` | `fb99ececff4fba01de3b81cdd0496f0c61426814` |
| A | `e2e/growth-profit.spec.ts` | `7e13105e80d7b736a07ff96b51e4827797a4703c` |
| A | `e2e/storefront-pull.spec.ts` | `ca7bb5e9b2080b26ebcb1a11ce1953ceab7ba69f` |
| M | `lib/deletion-summary.ts` | `0408debbf416482de2ed1180d4d9fbadba28f925` |
| M | `lib/feature-flags.ts` | `d85e4e327219e1d6bb9ce0ab3ee32b7528edb2dd` |
| M | `lib/feature-status.ts` | `0076a7529d4bf86cc98306987ea5363a85886d46` |
| A | `lib/growth-bundle-server.ts` | `8a8592437f13dc3027e9ae4520f66d0c2fdb9d66` |
| A | `lib/growth-bundle.ts` | `ef262ed7b805f7ba0f1dde75201707c0252fcae2` |
| A | `lib/growth-cause-links-server.ts` | `d9ec88593196ebbc17dcf6211af44d0b799f9aaf` |
| A | `lib/growth-cause-links.ts` | `b82e0bea3bf044ee60123a430386606e381d67fb` |
| A | `lib/growth-collaboration-server.ts` | `1a5877c4e4d602a92bc0ccf9a9a90491693bbc05` |
| A | `lib/growth-collaboration.ts` | `31153eadef75e2ccdd651a389dc19bfc64bcfb08` |
| A | `lib/growth-conditional-server.ts` | `d62e12bf009f86f9c0f773118afaec65499d508b` |
| A | `lib/growth-conditional.ts` | `396d938ae148505a3842b14f915c87097a782dcd` |
| A | `lib/growth-cs-server.ts` | `f1bb2ba1a7876d4c41788d559f7d28a9459f4272` |
| A | `lib/growth-cs.ts` | `5fe8daf8582b543a6b47d336660ae1e0096a9c3f` |
| A | `lib/growth-daily-server.ts` | `e707e2c19737212986fb2fd06744c2ac3729cddf` |
| A | `lib/growth-demand-evidence-server.ts` | `3759d84d9bca6628fee9ee2b7e06c46e0c5d286a` |
| A | `lib/growth-demand-evidence.ts` | `e9cde615db97ada7550618b986c5e2350467858a` |
| A | `lib/growth-detection-server.ts` | `197e95a9c47cfcce8ed4e230d48f1f6a9e5326c1` |
| A | `lib/growth-detection.ts` | `dcd8542f7b4368f56f7e2591c292ca991c54af5b` |
| A | `lib/growth-expansion-server.ts` | `22ef4802754b61729da4b999484be3ef71784102` |
| A | `lib/growth-expansion.ts` | `8d22e1a4e7a9e00a4d2ff6ef102c2f04bb3aed2a` |
| A | `lib/growth-experiment-server.ts` | `5c49e32b576933dcc564c3c6232c9e50e1763ed4` |
| A | `lib/growth-experiment.ts` | `88fd2c42788708da01f030072fb4779adf8c89d1` |
| A | `lib/growth-landing-server.ts` | `c54e335f92d7f0894a6d9cee82f6d9a2d43181da` |
| A | `lib/growth-landing.ts` | `30af3eab337755af5d55697950dfa073483a1188` |
| A | `lib/growth-ledger-server.ts` | `0747e4c20845faac42b26ee3058cd20364649490` |
| A | `lib/growth-lesson-applications-server.ts` | `9eb41f475009453896587f5732c53bdf035748a3` |
| A | `lib/growth-lesson-applications.ts` | `6bba3127dfae0c0675300aa3f665f4c6849094ae` |
| A | `lib/growth-optimization-server.ts` | `8903c1f723d7e2bd49e3e285de52e82729f9d6f5` |
| A | `lib/growth-optimization.ts` | `101bda23ae9470fcba32fb751b442a87d0635109` |
| A | `lib/growth-profit-server.ts` | `0ffdac750e27e5aa48c0fd991d650cb62ccf35cb` |
| A | `lib/growth-profit.ts` | `40939efe40608a7e8ee286c99da01a6f2d3257d6` |
| M | `lib/record-kinds.ts` | `bd436a063a4779fb9a51de16a3df500047649d2d` |
| M | `lib/research-worker.ts` | `44dba087a1656d6edbaa1e4723de736506510b67` |
| A | `lib/storefront-pull-server.ts` | `1a7b1bc0322ae4d8bcdd53fcfd955b07cc702553` |
| A | `lib/storefront-pull.ts` | `540602e23823af55cc634de94af1c06c393be18d` |
| M | `tests/feature-flags.test.mjs` | `301a6d004c22d19c9126439475f41f63686f5a9a` |
| M | `tests/feature-status.test.mjs` | `cfefef9f25e6feec6afa2a011b17f21f034d88c9` |
| A | `tests/growth-bundle-route.test.mjs` | `dfe3d7be19918227e2bb077c84a27ced545a79df` |
| A | `tests/growth-cause-links-route.test.mjs` | `52c67d81b6c08ffaaf61ca3cbba167251ab825ac` |
| A | `tests/growth-collaboration-route.test.mjs` | `d4f9b1f407007f548e5ea172c0ba6df8ffe9085c` |
| A | `tests/growth-conditional-route.test.mjs` | `9a22a2cbaededbdd031e5ad4d6057bd4e8a79022` |
| A | `tests/growth-cs-route.test.mjs` | `d21a9169a15a915c30415b3d564ab2691c7be9f7` |
| A | `tests/growth-daily.test.mjs` | `b87e6ff345bc56eddc774bb26741001da42b6e16` |
| A | `tests/growth-demand-evidence-route.test.mjs` | `6426fd6170174e932aae427177ed98f65b77e07b` |
| A | `tests/growth-detection-route.test.mjs` | `319583cb43bcdafc2237e8e66cd69ba8129fc38e` |
| A | `tests/growth-expansion-route.test.mjs` | `8095990fc1e01b92d34e623be2166a6dc9fd2046` |
| A | `tests/growth-experiment-route.test.mjs` | `ea33da502c05f0ee72288f46e04ab037dc9942a6` |
| A | `tests/growth-landing-route.test.mjs` | `3e78bd711194c48e6348d04fb8533e3685aba63b` |
| A | `tests/growth-lesson-applications-route.test.mjs` | `ec8adbda9c4ff006f1b02bb6625e386fd5243d72` |
| A | `tests/growth-optimization-route.test.mjs` | `787fe801ea5b7fbb17bda5a10951a5f256a3f518` |
| A | `tests/growth-profit-route.test.mjs` | `d412db855a8e2c74b3abf0d3e04e647c95fe126e` |
| A | `tests/storefront-pull.test.mjs` | `fef04f7a17a106e39d4bac0a8f44982ae9c870ce` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `035d3b14027333a53748d48032afdb3422c7e8ae`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective aea167d"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "035d3b14027333a53748d48032afdb3422c7e8ae" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `035d3b14027333a53748d48032afdb3422c7e8ae`인지 확인하세요.
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-09-30 "1.게시하라"(Claude 세션, #285 병합·게시 지시). 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인
```bash
curl -fsS "https://mealzip-agency.hflameb.chatgpt.site/api/version/public?release=aea167d"
```
- 응답 `tree`가 `035d3b14027333a53748d48032afdb3422c7e8ae`이면 성공입니다. 응답 전체를 그대로 보고하세요.
