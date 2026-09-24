# COLLECTIVE 개발 및 공동작업 규칙

## 정본
- GitHub 저장소 `roybeee/Collective`의 `main`이 제품 소스 정본이다.
- ChatGPT/Codex, Claude, 로컬 개발 환경, HERMES 에이전트는 같은 규칙을 따른다.
- 작업 시작 전 `git fetch origin --prune` 후 `origin/main`의 최신 SHA를 확인한다.
- 배포된 사이트는 실행 결과이며 개발 정본이 아니다. GitHub 소스와 배포 상태를 별도로 검증한다.
- 토큰, 비밀번호, 쿠키, 개인정보, `.env` 파일은 커밋하지 않는다.

## 현재 상태 (`docs/STATUS.md`)
- 작업을 시작할 때 `docs/STATUS.md`를 먼저 읽는다.
- 적힌 내용을 믿지 말고 실제 원격 상태(`git ls-remote origin refs/heads/main`, `gh pr list -R roybeee/Collective`, `/api/version`)와 대조한다. 다르면 원격이 맞고 STATUS.md를 고친다.
- 단계, 검증 결과, 막힌 것, 진행 중 작업, 다음 행동이 바뀌면 같은 PR에서 STATUS.md와 마지막 갱신 시각(UTC)을 갱신한다.

## 개발 루프
1. 원격 `main`과 현재 작업 기준 SHA를 확인한다.
2. 새 작업은 최신 `origin/main`에서 별도 브랜치로 시작한다.
3. 한 작업은 한 브랜치와 한 PR로 유지한다.
4. 기존 사용자 변경을 덮어쓰거나 강제 푸시하지 않는다.
5. PR에는 목적, 변경 파일, 기준 SHA, 검증 명령, 배포 여부를 기록한다.
6. 병합 뒤 원격 `main` SHA와 운영 배포 상태를 각각 확인한다.

## 품질 기준
- 프로젝트의 lint, typecheck, test, build를 실행한다.
- HERMES/ASIDE/브라우저 연동은 성공, 실패, 타임아웃, 재시작, 중복 실행을 검증한다.
- 조사 데이터는 출처 URL, 수집 시각, 신뢰도, 계정 조건을 보존한다.
- 모의 응답 통과와 실제 브라우저 조사 성공을 구분한다.
- 검증하지 않은 매장 정보와 광고 성과를 사실처럼 표시하지 않는다.

## 도메인 원칙
- 브랜드 아카이브는 원자료와 근거를 보존한다.
- 백그라운드 조사는 진행 상태, 마지막 활동, 실패 원인, 재시도 횟수를 표시한다.
- 에이전트 회의 결과는 결정, 근거, 반대 의견, 후속 작업으로 구조화한다.
- 공식 플랫폼 정책과 COLLECTIVE의 실험 제안을 분리한다.
- 고객 데이터와 로그인 정보는 최소 수집하고 로그에 원문 토큰을 남기지 않는다.

## 상태 어휘
보고, PR, `docs/STATUS.md`, `docs/releases/`는 아래 단어만 쓴다. 단계를 섞어 "완료"라고 쓰지 않는다.
- 소스: `merged` — PR이 GitHub `main`에 병합됐다. 배포됐다는 뜻이 아니다.
- 배포: `published` — Sites 게시(save_version_and_deploy_private)가 성공했다.
- 배포: `runtime-verified` — 실행 중인 앱의 `/api/version` `tree`가 마지막으로 게시한 제품 커밋의 tree와 같고, 그 커밋이 `origin/main`의 조상이며 이후 `main` 변경이 비제품 경로(문서·테스트·CI 등, 목록과 판정 명령은 `docs/PUBLISH.ko.md` 5단계)뿐이다. `unknown`·`dirty`는 검증 실패다.
- 레지스트리: `registry-active` — 프롬프트 레지스트리의 단위별 active 포인터가 기록한 버전 id로 바뀌었고(활성화·롤백), 운영 `/api/version`의 `promptManifest`가 기록한 매니페스트 해시와 같다(`docs/PUBLISH.ko.md` 7절). `runtime-verified`는 코드 tree 기준으로만 판정하며 레지스트리 상태와 섞지 않는다.
- 검사 결과: `passed` | `failed` | `blocked`(실행하려 했으나 막힘, 원인 기록) | `not_run`(실행하지 않음, 이유 기록).
- 검사 근거: `real`(실제 서비스·실제 브라우저·실제 D1) | `mocked`(fetch 스텁, 모의 HERMES, 로컬 인증 헤더 주입 등). 한 검사가 둘 다면 부분별로 나눠 적는다.
- 예: `node scripts/test.mjs` — passed · mocked (11/11 스위트, HERMES fetch 스텁).

## 위임 계약
HERMES, Codex, Claude 등 다른 에이전트에게 맡기는 작업은 아래를 모두 적어서 넘긴다. 빠진 항목이 있으면 위임하지 않는다.
1. 목표와 관측 가능한 수용 기준 — 성공 조건뿐 아니라 실패 사례(거부돼야 하는 입력, 권한 없는 접근, 타임아웃 등)를 포함한다.
2. 소유 파일·인터페이스 — 바꿔도 되는 파일과 API. 그 밖은 읽기만 한다.
3. 브랜치·워크트리 — 최신 `origin/main` 기준 SHA와 작업 브랜치 이름.
4. 시간 예산 — 초과하면 멈추고 보고한다. 재위임은 최대 1회, 그래도 안 되면 소유자에게 올린다.
5. 허용된 품질 게이트 — 위임자가 지정한 검사만 쓴다. 위임받은 에이전트는 새 게이트를 추가하지 않는다(필요하면 제안만 한다).
6. 필수 테스트 — 반드시 실행하고 결과를 상태 어휘로 보고할 명령.
7. 결과 반환 경로 — 커밋 SHA(또는 PR URL)와 증거(명령, 출력 수치, real/mocked 구분).

## Claude와 Codex 인계
- `HANDOFF.md` 또는 PR 본문에 기준 SHA, 변경 파일, 검증 결과, 남은 위험, 다음 작업을 기록한다.
- Claude가 만든 변경도 동일한 PR 및 검증 절차를 따른다.
- 완료는 GitHub 반영, 테스트 통과, 운영 배포 검증을 각각 구분해 보고한다.

## 금지
- 비밀값 커밋
- 검증 없는 운영 DB, 광고 예산, 고객 메시지 변경
- `git reset --hard`, 강제 푸시, 무단 브랜치 삭제
- 소스가 없는 상태에서 배포 파일을 제품 정본으로 복사
