# COLLECTIVE Sites 게시 지시문: 0ee97b1 → bccc845

아래 지시를 순서대로 실행하고, 각 단계 결과를 그대로 보고하세요. 한 단계라도 기대값과 다르면 **게시하지 말고 멈추고** 차이를 보고하세요. 환경변수, 접근 설정(public 유지), D1 데이터는 바꾸지 마세요.

## 고정값
- GitHub 저장소: https://github.com/roybeee/Collective (public)
- 기준(현재 운영) tree: `d1cab93a9e185d5dda6d14204419571c5bf52fe2` (Sites 버전 47, 기준 커밋 `0ee97b1fc9cc41af5212fd7948ac4898da35c286`)
- 목표 커밋: `bccc845409c256a5461c62207f31090490b1cc5b` / **목표 tree `1ebc76f38bf9a3830ebcde0c8137459a189a0620`**
- 변경 파일 21개: 추가 2 · 수정 19 · 삭제 0. D1 migration 파일 0개, 의존성 파일 변경 0개.

## 1. 사전 확인
1. Sites 작업 사본이 깨끗한지 확인: `git status --porcelain` 결과가 비어 있어야 합니다.
2. 현재 tree가 기준 tree인지 확인: `git rev-parse HEAD^{tree}` = `d1cab93a9e185d5dda6d14204419571c5bf52fe2`. 이미 목표 tree `1ebc76f38bf9a3830ebcde0c8137459a189a0620`이면 **이미 게시된 것**이니 아무것도 바꾸지 말고 그 사실과 현재 Sites 버전을 보고하세요. 둘 다 아니면 멈추고 현재 tree와 최근 커밋 3개를 보고하세요.

## 2. 파일 적용
- 추가·수정 파일은 GitHub 원본을 **파일로 바로** 받습니다(붙여 넣기 금지): `curl -fsSL -o <경로> https://raw.githubusercontent.com/roybeee/Collective/bccc845409c256a5461c62207f31090490b1cc5b/<경로>` (상위 폴더가 없으면 `mkdir -p`). curl을 못 쓰면 GitHub 커넥터로 같은 커밋의 원문을 받아 파일로 저장하세요.
- 삭제 파일은 `git rm -q <경로>`.
- 파일마다 저장 직후 `git hash-object <경로>`가 표의 기대 해시와 같아야 합니다. 다르면 그 파일만 curl로 다시 받고 재확인하세요.

| 상태 | 경로 | 기대 blob 해시 |
|---|---|---|
| M | `app/franchise-report-panel.tsx` | `00c85ea077e27961d89bfd7c61dca1743b39086a` |
| M | `docs/DATA-PROCESSING.ko.md` | `bbc782b5ecc21daa48fdb885528599f5a933fff4` |
| M | `docs/EVAL.ko.md` | `6697c7412a283f543c52946741ffe0d15272ce36` |
| M | `docs/FRANCHISE-RECRUITMENT-PLAN.ko.md` | `61466f6c2c5bafb0c1c0eabeed5da646d80ebbb4` |
| M | `docs/LANES.ko.md` | `fffd342b65f49251b8a5ebcc9209417c48d6b236` |
| M | `docs/STATUS.md` | `bea9f5622780c3c03f8200653a3ee403622ecb73` |
| A | `docs/publish/0ee97b1.md` | `7116e3a049b8796e5420e21d9a91af87221a944c` |
| A | `docs/releases/2026-09-27-0ee97b1.md` | `ef91568d4058478b0838bd235eee37a65db526af` |
| M | `lib/franchise-report.ts` | `81697cb5a86f2bf3c831e5c3c4ea8cb7ff039f6d` |
| M | `lib/graders/index.ts` | `1372db5a95a60f5039c8db19c69f8d6d7f7ba3e5` |
| M | `lib/output-normalize.ts` | `b1768dd26fa9001eb2edc057d751ddba23591b88` |
| M | `lib/role-output.ts` | `449aa81e65575a94ad2ee7809cdd553a624c0473` |
| M | `tests/brand-voice.test.mjs` | `6b4b0ac3d6d2558c84f109334d0ed72efdcbdaa6` |
| M | `tests/copy-pack.test.mjs` | `e199e68d55fd772ef539134ee9a20fc8a4283768` |
| M | `tests/eval-server.test.mjs` | `af78ed9c3c97157b947704ccb1f7bc43638ca1e5` |
| M | `tests/graders-meeting-brief.test.mjs` | `b1357f7059c2995c17f3e8b0cae3528d7567c6cd` |
| M | `tests/meeting-copy-pack.test.mjs` | `d6872f7d0d429e25261b5f26d5884ba4338d0910` |
| M | `tests/output-normalize.test.mjs` | `6de570681fed1829a1438b4d50b8a1a2bb801363` |
| M | `tests/r3c-franchise-industry.test.mjs` | `816d9746e936c1e70c1e7cca4583d0ca1917b45f` |
| M | `tests/recruitment-metrics.test.mjs` | `9c8737cb8f6ea57f8f31917ab3e2ace30db710be` |
| M | `tests/recruitment-report.test.mjs` | `b893c82801220357f2fb1df7e67e433ff9aa9ee5` |

## 3. 트리 검증 (write-tree 직전 전체 재검증)
1. 위 표의 **모든** 추가·수정 파일에 대해 `git hash-object`를 다시 계산해 기대값과 모두 같은지 확인하고, 불일치 수(0이어야 함)를 보고하세요.
2. `git add -A` 뒤 `git write-tree` 결과가 목표 tree `1ebc76f38bf9a3830ebcde0c8137459a189a0620`와 같아야 합니다. 다르면 게시하지 말고 멈추세요.
3. 같으면 커밋: `git commit -q -m "publish: roybeee/Collective bccc845"`

## 4. 설치·빌드 (tree 신원을 빌드에 확실히 넣기)
같은 셸에서 한 번에 실행하세요. 중간에 멈추면 게시하지 마세요.
```bash
pnpm install --frozen-lockfile
test -z "$(git status --porcelain)" || { echo DIRTY; exit 1; }
T=$(git rev-parse HEAD^{tree})
test "$T" = "1ebc76f38bf9a3830ebcde0c8137459a189a0620" || { echo TREE_MISMATCH $T; exit 1; }
COLLECTIVE_SOURCE_TREE="$T" node scripts/run-framework.mjs build
grep -rlq "$T" dist/server && echo TREE_EMBEDDED || { echo TREE_NOT_EMBEDDED; exit 1; }
```
- 마지막 줄이 `TREE_EMBEDDED`여야 합니다. `TREE_NOT_EMBEDDED`·`DIRTY`·`TREE_MISMATCH`면 게시하지 말고 보고하세요.
- 빌드 뒤 `git status --porcelain`이 비어 있고 `git rev-parse HEAD^{tree}`가 여전히 `1ebc76f38bf9a3830ebcde0c8137459a189a0620`인지 확인하세요(빌드 뒤 tree 재확인).
- 게시에는 **방금 이 폴더에서 만든 빌드 결과**를 쓰세요. 다른 폴더나 이전 빌드 결과를 쓰지 마세요.

## 5. 게시
- 이 사이트는 공개(public)입니다. `save_site_version`으로 방금 만든 빌드의 버전을 저장한 뒤, 그 버전을 `deploy_site_version`으로 배포하세요. `save_version_and_deploy_private` 같은 비공개 전용 게시 도구나 접근 설정을 바꾸는 도구는 쓰지 마세요.
- 저장한 Sites 버전 번호, deployment ID, 배포 상태, Sites 커밋 SHA를 보고하세요.
- 대표 게시 승인: 2026-09-26 "원스탑으로 다 진행하라"(병합·게시 위임), 2026-09-27 "B2 2단계 빼고 남은 개발을 모두 진행하라"(세션 29f7af 전달), 2026-09-27 "진행하라"(내부 표기 정규화). 게시 SHA 선택은 2026-09-25 위임. 목표 커밋은 위 고정값입니다.

## 6. 게시 뒤 확인 (로그인한 소유자 브라우저 콘솔)
```js
await (await fetch('/api/version', {credentials: 'same-origin', cache: 'no-store'})).json()
```
- 응답 `tree`가 `1ebc76f38bf9a3830ebcde0c8137459a189a0620`이면 성공입니다. 응답 전체를 그대로 보고하세요.
