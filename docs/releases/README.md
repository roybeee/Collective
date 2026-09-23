# 게시 기록

Sites 게시 1회마다 파일 하나: `<YYYY-MM-DD>-<sha7>.md` (`sha7` = 게시한 GitHub `main` 커밋 앞 7자리).
절차는 `docs/PUBLISH.ko.md`, 용어는 `AGENTS.md`의 상태 어휘를 따른다.

## 형식

```markdown
# <YYYY-MM-DD> <sha7>

- GitHub 커밋: <40자 SHA> (`merged`)
- 소스 트리: <git rev-parse <sha>^{tree}>
- 게시자/도구:
- 사전 점검: 크레딧 <전> → <후>, 주간 한도 <값>, 겹치는 HERMES 예약·유료 작업 <없음/있음>
- 소요 시간:

## 결과
| 단계 | 결과 | 근거 | 증거 |
|---|---|---|---|
| 설치 `pnpm install --frozen-lockfile` | passed/failed/blocked/not_run | real | |
| 빌드 `node scripts/run-framework.mjs build` | | real | |
| 게시 save_version_and_deploy_private | | real | Sites 버전, deployment ID |
| `/api/version` tree 비교 | | real | 응답 tree, 기대 tree |

- 배포 상태: `published` / `runtime-verified`
- 남은 문제:
```
