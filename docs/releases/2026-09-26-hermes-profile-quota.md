# HERMES 평가 프로필 한도 오판 수정

기록 시각: 2026-09-26 04:00 UTC. Collective 기준 main `18365e9e9f3a53f8873b011bbf498ec054379623`, 브랜치 `fix/hermes-profile-quota-reporting`.

## 실제 원인

Codex 인증 풀은 `exhausted`, `last_error_code=429`, `last_error_reset_at=1790472786`을 기록하고 있었다. 기본 프로필은 `logged_in=true`, `rate_limited=true`, `error_code=codex_rate_limited`를 반환했지만 평가 프로필은 `logged_in=false`로 오판했다. 이는 공급자 한도 소진이며 GitHub 저장소 권한이나 운영 OWNER 로그인 실패가 아니다.

평가 프로필은 기존 지원 기능으로 전역 credential pool을 상속한다. `_codex_pool_rate_limit_status()`만 프로필 로컬 파일을 직접 읽어 상속된 한도 정보를 놓쳤다. 이 함수를 기존 `read_credential_pool("openai-codex")`로 통일했다. 로컬 설정 우선, 토큰 존재 확인, 한도 상태·해제 시각 검사는 유지했다. 인증 값·모델·사용량·한도 값은 변경하지 않았다.

## 서버 반영과 검증

- 별도 Hermes 작업 사본과 브랜치 `fix/collective-profile-quota`에서 수정했다. 기준 Hermes HEAD `4db2300592`, 수정 커밋 `4754494e3e09837c6a0160ed3f11287081831e2f`.
- 원본 runtime의 `hermes_cli/auth.py`가 테스트 기준 원본과 바이트 단위로 같은지 확인했다. 원본 백업 후 검증한 파일만 원자적으로 교체하고 소유자·모드를 유지했다. 서버의 다른 미커밋 변경은 건드리지 않았다.
- runtime에 pytest가 없어 작업 사본 전용 venv에 검사 도구를 설치했다. 운영 Python 의존성은 변경하지 않았다.
- `scripts/run_tests.sh tests/hermes_cli/test_codex_profile_quota_recovery.py`: 수정 전 1 failed · mocked(상속된 한도를 None으로 반환), 수정 후 passed · mocked.
- 같은 공식 wrapper로 신규 검사와 `test_auth_codex_provider.py`, `test_auth_codex_self_heal.py`, `test_auth_codex_quota_probe.py`를 실행: **4 files, 17 tests passed, 0 failed · mocked**.
- 실제 평가 프로필의 `get_codex_auth_status()` 허용 필드만 조회: `logged_in=true`, `rate_limited=true`, `error_code=codex_rate_limited`, `reset_at=1790472786` — passed · real. 토큰은 출력하지 않았다.
- 진행 중 평가가 없음을 운영 목록에서 확인한 후 `hermes-gateway-collective-eval.service`만 재시작했다. systemd `active` 확인 passed · real.
- 재시작 후 운영 품질 콘솔의 기존 실행 진단 GET 성공(checkedAt `2026-09-26T03:58:23.280Z`) — passed · real. 새 모델 실행은 하지 않았다. 기존 실행의 저장된 인증 오류는 과거 기록이므로 소급 수정하지 않았다.

서버의 패치 커밋은 서버 Git에 보존돼 있다. 이 Collective PR은 패치 재현 스크립트·회귀 검사·운영 근거를 보관한다. Hermes 원격 upstream에 병합됐다는 뜻이 아니다. Collective 제품 코드는 바꾸지 않으며 별도 Sites 게시가 필요한 변경도 아니다.

## 완료된 운영 작업과 남은 게이트

- S8 두 실행 재채점은 완료 출력 각 1건, 실패 0으로 통과했다. `channel.offline@2cbe193eacdc` 등록 완료.
- 쌍 평가 `8fcd3726-b09f-464c-b111-d1d9e20c63fc`: 완료 출력 0/4, gate failed. 공급자 실행 `run_26c10cf48609415f8e98db06f1b948c5`의 보고 사용량은 input/output/total 모두 null이다. 표시 0을 실제 소비 0으로 해석하지 않는다.
- 공급자 reset: **2026-09-27 01:33:06 UTC / 10:33:06 KST**. 현재 쌍 평가 blocked, stage/promote not_run. registry-active 미완료.
- 해제 시각 이후 실제 quota 상태를 먼저 조회하고, 기존 예산과 평가 전용 연결 조건을 재확인해 같은 모델로 쌍 평가한다. 두 쪽 완료·모델 일치·채점 게이트를 모두 통과한 뒤 승인된 적용 범위에서 stage/promote와 운영 매니페스트를 확인한다.
- 자동 재개 작업은 예약하지 않았다. 추가 유료 용량 구매나 다른 공급자 전환도 수행하지 않았다.

## 재현 파일

`scripts/ops/repair_hermes_profile_quota.py <Hermes checkout>`는 검토된 원본 블록이 정확히 한 번 존재할 때만 코드 파일을 수정한다. 인증 파일을 수정하지 않는다. 사용 전 별도 브랜치를 만들고 Hermes 원본 변경 여부를 확인한다.

`scripts/ops/test_codex_profile_quota_recovery.py`를 Hermes의 `tests/hermes_cli/`에 복사하고 공식 `scripts/run_tests.sh`로 실행한다. 실제 인증 정보 대신 합성 값을 사용하며 프로필 우선순위·만료된 한도·빈 토큰도 확인한다.
