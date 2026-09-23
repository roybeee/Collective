# Unattended brand research

The Sites D1 database is the durable queue and archive. The Hetzner systemd worker
polls a dedicated machine endpoint every 15 seconds, advancing one due research
job per tick. It needs neither an open application tab nor the personal Mac.
This worker advances **brand research and archive classification**, not campaign
meetings or all AI-team tasks.

## Installation

1. Finish or cancel active AI jobs before restarting the default HERMES gateway.
2. In COLLECTIVE **연결 및 설정 → Mac 없이 브랜드 조사**, download the installer.
3. Copy it to the existing Ubuntu x86_64 server as a sudo-capable user (not a
   direct root login) and run it with sudo. Replace `<서버 접속 주소>` with that
   `user@host`:

   ```sh
   scp ~/Downloads/install-collective-server.py <서버 접속 주소>:~/
   ssh -t <서버 접속 주소> 'sudo python3 ~/install-collective-server.py'
   ```

   When the optional `RESEARCH_WORKER_SSH_TARGET` environment variable is set
   (for example `deploy@research.example.com`), Settings shows it in place of the
   placeholder, only to users who may download the installer. Do not publish the
   real server address in this repository. Disable direct root SSH login on the
   server and use key authentication.

4. Wait for the worker heartbeat in Settings. Start a new brand investigation.
5. 설치가 성공하면 설치기가 서버에 올린 자기 파일을 `os.unlink`로 지운다. 지우지 못하면
   경고만 내고 설치 결과는 유지하므로 그때는 직접 지운다. Mac의 `~/Downloads` 사본은
   직접 지운다. 설치 파일에는 비공개 연결 자격증명이 들어 있다. 커밋하거나 공유하지 않는다.

설치기는 HERMES를 업그레이드하지 않고 Mac 브라우저 프로필도 복사하지 않는다.
`https://example.com` 제목을 실제 브라우저로 확인한다. 기본 프로필의 API 도구셋은
`browser`, `web`, `no_mcp`가 된다. 전역 Aside MCP 설정은 Slack 등 다른 플랫폼에서
그대로 쓸 수 있다. 설정과 dotenv 백업은 원본 옆에 시각을 붙여 남긴다. 다른 HERMES
프로필은 고치지 않는다.

## 브라우저 격리와 설치 권한

신뢰할 수 없는 웹을 여는 Chromium을 HERMES 비밀·작업자 자격증명과 같은 계정에서
떼어 낸다. 계정은 다섯으로 나뉜다.

| 계정 | 하는 일 | 못 하는 일 |
|---|---|---|
| root (`sudo`) | apt 패키지 설치, 전용 계정 생성, 설치 결과를 root 소유 경로로 복사, AppArmor 프로필, nftables 규칙, Chrome 정책, systemd 유닛·서비스, HERMES 설정 백업·변경, 격리 점검 | 서드파티 코드(npm 패키지·agent-browser·Chromium)를 root로 실행하지 않는다 |
| `collective-npm` | `npm ci --ignore-scripts`로 agent-browser 설치, `agent-browser install`로 Chromium 내려받기 | 결과는 root가 `/opt/collective-browser`로 복사하므로 설치 뒤에는 고칠 수 없다. 다운로드가 끝나면 설치기가 이 계정의 남은 프로세스를 모두 끝낸다. 격리 브라우저의 CDP 포트에 붙지 못한다 |
| `collective-browser` | Chromium 실행(`collective-browser.service`, 헤드리스, 루프백 9333 포트의 CDP) | `~hermes/.hermes`와 `/etc/collective-research/worker.json` 읽기, 루프백·사설망·서버 자신의 주소·브로드캐스트·멀티캐스트로 새 연결, `file://`·`chrome://` 열기 |
| `collective-worker` | 큐 워커(`collective-research-worker.service`), `/etc/collective-research/worker.json`(0600) 읽기 | `~hermes/.hermes` 읽기. 브라우저·HERMES 도구를 쓰지 않는다 |
| `hermes` | HERMES 게이트웨이, agent-browser CLI(격리 브라우저에 CDP로 연결) | 브라우저를 직접 띄우지 않는다(`/opt/collective-browser/chromium`은 브라우저 계정만 실행). `worker.json`을 읽지 못한다. `browser_cdp`·`browser_dialog` 호출은 훅이 막는다 |

- **샌드박스 유지**: `--no-sandbox`를 쓰지 않는다. Ubuntu 24.04처럼
  `kernel.apparmor_restrict_unprivileged_userns=1`이면
  `/etc/apparmor.d/collective-chromium` 프로필(경로 `/opt/collective-browser/chromium/chrome`에만
  `userns` 허용)을 적용한다. 프로필 적용이나 샌드박스 시작이 실패하면 이유를 출력하고
  설치를 멈춘다. HERMES 설정은 그대로다. 예외가 꼭 필요할 때만 이유를 기록하고
  `sudo python3 ~/install-collective-server.py --allow-no-sandbox`로 실행한다. 이때도
  전용 계정·방화벽·Chrome 정책은 그대로 적용된다.
- **네트워크**: `collective-browser-firewall.service`가 nftables `inet collective_browser`
  테이블만 교체한다(다른 방화벽 규칙은 건드리지 않음). 브라우저 계정 소켓이 새로 여는
  연결 중 이 네트워크(0/8)·10/8·CGNAT(100.64/10)·루프백(127/8)·링크로컬(169.254/16)·172.16/12·
  192.168/16과 IPv6 `::`·`::1`·`fc00::/7`·`fe80::/10`, 그리고 `fib daddr type { local, broadcast,
  multicast }`(서버 자신의 공인 주소 포함, lo로 전달돼 클라우드 방화벽을 거치지 않는 경로)를 거부한다.
  예외는 둘이다. 이미 성립된 연결(HERMES가 연 CDP 연결의 응답)과, `/etc/resolv.conf`의 네임서버가
  차단 대역 안일 때(systemd-resolved 루프백 스텁 등) 그 주소의 53번 포트다. 같은 테이블이 루프백
  9333 포트(인증 없는 CDP)로의 새 연결을 root와 hermes 계정에만 허용한다. 브라우저 서비스는 방화벽
  서비스를 `BindsTo=`로 묶어 방화벽 없이 뜨지 않고, 방화벽 유닛은 `nftables.service`를 다시 읽거나
  재시작할 때(`flush ruleset`) 이 테이블을 다시 넣는다.
- **Chrome 정책**: `URLBlocklist`로 `file://*`·`chrome://*`(about: 별칭 포함)·`chrome-untrusted://*`를
  막는다. `about:blank`·`data:`·`blob:`은 새 탭과 일반 웹이 쓰므로 막지 않는다. 정책 파일은
  `/etc/opt/chrome_for_testing`·`/etc/chromium`·`/etc/opt/chrome` 아래 `policies/managed/collective-browser.json`에
  쓰므로 서버의 다른 Chrome for Testing·Chromium·Chrome에도 적용된다.
- **HERMES 연결 방식**: HERMES는 로컬에서 Chromium을 띄우지 않고 `browser.cdp_url`과
  `BROWSER_CDP_URL`(루프백 9333 포트)로 격리 브라우저에 붙는다. `AGENT_BROWSER_ARGS`를
  `--disable-dev-shm-usage`로 채워 HERMES가 userns 제한 환경에서 `--no-sandbox`를 스스로 넣는
  경로를 막는다. 설치된 HERMES 브라우저 소스에 `cdp_url`·`BROWSER_CDP_URL`이 없거나 셸 훅
  소스(`agent/shell_hooks.py`의 `pre_tool_call`·`fail_closed`·승인 목록, `gateway/run.py`의 등록)가
  없으면 설정을 바꾸기 전에 멈춘다. 이전 설치가 dotenv에 남긴 `--no-sandbox` 줄과
  `AGENT_BROWSER_EXECUTABLE_PATH`(hermes 소유 Chromium)는 새 블록이 뒤에서 덮고, 게이트웨이
  드롭인은 `AGENT_BROWSER_EXECUTABLE_PATH`를 지운다.
- **설치 점검(음성 테스트 포함)**: 샌드박스를 켠 채 `data:` 페이지를 읽을 수 있어야 하고(양성),
  브라우저 계정이 읽을 수 있는 `file://` 페이지는 정책으로 막혀야 한다. `file://` 결과에 마커가 없다는
  것만으로는 시간 초과·비정상 종료와 구분되지 않으므로 직후 `data:` 페이지를 다시 읽어야 통과다.
  root로 CDP 포트가 열렸는지 확인하고(양성 대조군), 알려 준 WebSocket 주소가 루프백 9333이며 그
  포트를 LISTEN하는 소켓이 모두 브라우저 계정 소유인지(포트 선점 확인) 본다. 그다음 브라우저 계정의
  루프백 CDP 포트 접속, `collective-npm` 계정의 CDP 포트 접속, 브라우저 계정의 서버 자신의 주소(root가
  연 임시 포트, root 접속이 양성 대조군) 접속이 모두 실패해야 한다. 실제 브라우저 점검은 HERMES와
  같게 `--cdp`만 넘기고(`--session`을 함께 쓰면 agent-browser가 `--cdp`를 무시하고 로컬 브라우저를
  띄운다), 연 페이지가 root가 읽는 격리 브라우저의 CDP 대상 목록(`/json/list`)에 있어야 통과다.
  HERMES 설정 뒤에는 hermes 계정으로 `hermes hooks list`·`hermes hooks test`를 실행해 차단 훅이
  승인됐고 `browser_cdp`는 막히고 `browser_navigate`는 걸리지 않는지 확인한다. 작업자 설치 뒤에는
  브라우저 계정의 `worker.json`·`config.yaml`·`.env` 읽기와 hermes 계정의 `worker.json` 읽기가
  실패해야 하고, `collective-worker`의 `worker.json` 읽기는 성공해야 한다(양성 대조군). 격리 점검이
  하나라도 실패하면 격리 브라우저 서비스를 항상 끈다. 기능 점검(실제 브라우저·게이트웨이 재시작·훅
  확인)이 실패하면 브라우저 서비스는 설치 전 상태로 두고, 어느 쪽이든 HERMES 설정 뒤 실패면 HERMES
  설정을 백업으로 되돌리고 작업자 서비스를 끄고 비활성화한다. `~hermes/.hermes`에 다른 사용자 권한
  비트가 있으면 지운다.
- **npm 공급망**: 설치기가 `package.json`과 integrity가 든 `package-lock.json`
  (lockfileVersion 3, `agent-browser@0.26.0`, 의존성 없음)을 만들어 `npm ci --ignore-scripts
  --no-audit --no-fund`로 설치한다. lockfile이 없으면(`AGENT_BROWSER_INTEGRITY`가 빈 값)
  `npm install --ignore-scripts --save-exact`로 설치한다. lifecycle 스크립트는 돌리지 않는다.
  이 패키지의 postinstall은 포함된 리눅스 실행 파일에 실행 권한을 주고 없을 때만 내려받으므로,
  설치기가 root 소유 사본에 실행 권한을 직접 준다. Chromium 실행 라이브러리도
  `agent-browser install --with-deps`(서드파티 코드)를 root로 돌리지 않고 설치기가 apt로
  직접 설치한다(Ubuntu 24.04의 `t64` 이름 우선).
- **root의 파일 작업과 심볼릭 링크**: `collective-npm`이 쓰는 폴더를 root가 다룰 때 링크를 따라가지
  않는다. 시작 전과 다운로드 뒤에 이 계정의 남은 프로세스를 모두 끝내고(`pkill -KILL -u`), `stage`는
  매번 링크 자체를 지운 뒤 root가 새로 만든다. 복사 원본(`stage/node_modules`, Chromium 폴더)은 계정
  홈부터 어느 단계도 링크가 아니어야 하고, 복사한 뒤 실행 권한을 줄 agent-browser 실행 파일과
  `chrome`은 일반 파일이어야 한다. 설치기가 쓰는 파일은 임시 파일의 파일 기술자로 소유자·권한을
  바꾼 뒤 이름을 바꾼다. `file://` 점검 페이지는 root 소유 폴더(`/opt/collective-browser/policy-check`)에
  둔다. `/opt/collective-browser/chromium`은 `root:collective-browser` 0750이라 다른 계정은 AppArmor
  `userns` 예외가 붙은 이 Chromium을 실행하지 못한다.

### lockfile 생성 절차 (agent-browser 버전을 바꿀 때)

설치기는 레지스트리에 접속하지 않고 lockfile을 만들 수 없으므로 개발 머신에서 만든다.
현재 integrity는 로컬 npm 캐시의 `agent-browser-0.26.0.tgz` SHA-512와 대조했다(2026-09-23).

```sh
mkdir /tmp/ab-lock && cd /tmp/ab-lock
npm init -y >/dev/null
npm install --package-lock-only --ignore-scripts --save-exact agent-browser@<버전>
node -e "const p=require('./package-lock.json').packages['node_modules/agent-browser'];console.log(p.version,p.integrity,Object.keys(p.dependencies||{}))"
```

출력한 버전과 integrity를 `install.py`의 `AGENT_BROWSER_VERSION`·`AGENT_BROWSER_INTEGRITY`에
넣는다. 세 번째 값(의존성)이 비어 있지 않으면 `npm_files`가 의존성 항목도 lockfile에
넣도록 고쳐야 한다. 그다음 `python3 tests/research_install_test.py`를 실행하고, 가능하면
`npm ci --offline --ignore-scripts`로 새 lockfile을 한 번 설치해 본다.

### 원시 브라우저 제어 도구 차단(pre_tool_call 훅)

HERMES의 `browser_cdp`(임의 CDP 명령)·`browser_dialog`(대화상자 승인)는 CDP 주소
(`BROWSER_CDP_URL`·`browser.cdp_url`)가 있을 때만 켜진다. 이 설치기는 격리 브라우저에 CDP로
연결하므로 두 도구가 켜진다. api_server 도구셋(`browser`, `web`, `no_mcp`)에는 두 도구만 빼는
설정이 없어서, 설치기가 HERMES `pre_tool_call` 셸 훅으로 호출을 막는다.

- root 소유 0755 스크립트 `/opt/collective-browser/hooks/deny-raw-browser.sh`가 사유를 stderr에 쓰고
  exit 2로 끝난다(HERMES는 exit 2를 차단으로 처리한다).
- `config.yaml`의 `hooks.pre_tool_call`에 `matcher: '^(browser_cdp|browser_dialog)$'`, `timeout: 5`,
  `fail_closed: true` 항목을 넣는다. 다른 훅은 그대로 둔다. `fail_closed`라 스크립트가 없거나
  시간이 넘어도 호출은 막힌다.
- `hooks_auto_accept`는 켜지 않는다. `~hermes/.hermes/shell-hooks-allowlist.json`의 `approvals`에
  이 훅의 `{event, command}`만 추가한다(기존 승인은 유지, 롤백 때 원래 파일로 되돌림).
- 게이트웨이를 다시 띄운 뒤 hermes 계정으로 `hermes hooks list`(승인 표시)와
  `hermes hooks test pre_tool_call --for-tool browser_cdp`(차단), `--for-tool browser_navigate`(훅
  없음)를 확인한다. 하나라도 어긋나면 HERMES 설정을 되돌린다.

두 도구는 도구 목록(`GET /v1/toolsets`, 앱의 조사 권한 점검)에는 계속 보이고 호출만 막힌다.
도구 목록으로 위험 도구를 판정하는 앱 쪽 작업(PR 4a)은 이 점을 전제로 해야 한다.
`browser_console`의 `expression`(페이지 안 JavaScript 실행)과 클릭·입력 같은 상호작용 도구는
막지 않는다. 그 영향은 위의 브라우저 계정 권한·방화벽·Chrome 정책 안으로 제한된다.

### 롤백

재설치는 대표 확인 뒤에 한다. 되돌릴 때는 서버에서 아래를 실행한다. `<시각>`은 설치기가
출력한 `Backup:` 파일 이름의 시각이다.

```sh
sudo systemctl disable --now collective-browser.service collective-browser-firewall.service
sudo -u hermes cp ~hermes/.hermes/config.yaml.before-collective-server-<시각> ~hermes/.hermes/config.yaml
sudo -u hermes cp ~hermes/.hermes/.env.before-collective-server-<시각> ~hermes/.hermes/.env
sudo apparmor_parser -R /etc/apparmor.d/collective-chromium && sudo rm /etc/apparmor.d/collective-chromium
sudo rm /etc/opt/chrome_for_testing/policies/managed/collective-browser.json /etc/chromium/policies/managed/collective-browser.json /etc/opt/chrome/policies/managed/collective-browser.json
```

`config.yaml`을 백업으로 되돌리면 차단 훅 항목도 빠진다. 승인 목록에 남은 이 훅의 항목은
hermes 계정으로 `hermes hooks revoke /opt/collective-browser/hooks/deny-raw-browser.sh`를 실행해 지운다.
작업자 서비스(`collective-worker` 계정)는 HERMES 설정과 무관하므로 롤백 대상이 아니다.
`.env` 백업이 없으면(첫 설치) 새로 생긴 `.env`를 지운다. 게이트웨이 드롭인
(`~hermes/.config/systemd/user/hermes-gateway.service.d/collective-browser.conf`)은 같은 폴더의
`.before-<시각>` 사본으로 되돌리거나, 사본이 없으면 지운다. 그다음 hermes 계정으로
`systemctl --user daemon-reload`와 `systemctl --user restart hermes-gateway.service`를 실행한다.
이전 방식(hermes 계정이 샌드박스 없이 Chromium 실행)으로 돌아가므로 롤백은 임시 조치로만 쓴다.

## Authentication and recovery

Production runtime requires `RESEARCH_WORKER_SITE_ORIGIN` and the secret
`RESEARCH_WORKER_GATE_TOKEN` (the Sites-issued machine gate bearer token).
The installer receives an additional random, owner-scoped credential. Only its
SHA-256 hash is stored in D1. Machine requests use the Sites gate header and
scoped Authorization credential; they never assert a browser user identity.
The endpoint accepts no caller-specified job actions or arbitrary destinations.
Redirects are not followed with credentials.

Reissuing the installer rotates the credential. Revoking it stops future ticks;
an already accepted HERMES run can still execute and can be cancelled from the
application. HTTP 401/403을 받으면 워커는 멈추지 않고 `worker_rejected`를 기록한 뒤
30분부터 최대 6시간 간격으로 다시 확인한다. 권한 문제는 설치 파일을 다시 발급해
재설치해야 풀린다. Temporary errors use backoff. A heartbeat means the
queue worker reached the app, not that every target website is accessible.

New server-mode investigations have four durable steps. Each completed initial
step stores validated sources; the final step stores the detailed report and
diagnosis. Existing submissions retain their request body and idempotency key.
Lost acknowledgements are recovered with the same request. Retries, UI polling,
and process restarts use per-job leases; inactive or completed jobs are not rerun.
Malformed results remain visible in research records for recovery.

```sh
systemctl status collective-research-worker.service --no-pager
journalctl -u collective-research-worker.service -n 30 --no-pager
```

Authenticated social accounts need a separate server login process. Access blocks,
missing credentials, and unavailable observations must be recorded as limitations.
No CAPTCHA bypass or invented metrics are part of this implementation.

## Verification boundary

Local tests cover queue completion without UI calls, intermediate persistence,
lost acknowledgements, credential isolation/rotation/revocation, fairness,
redirect rejection, and existing archive validation. They use simulated HERMES
responses. Actual server browser installation and an end-to-end production brand
investigation must be checked on the user's Hetzner server after installation.

설치기의 순수 함수(nftables 규칙, 브라우저·방화벽·작업자 유닛, AppArmor 프로필, Chrome 정책,
HERMES 환경값, 원시 도구 차단 훅·승인 목록·훅 확인 판정, npm 명령과 lockfile, 심볼릭 링크 방어,
격리 점검 명령, 설치 파일 자기 삭제)는 `python3 tests/research_install_test.py`로 검사한다(mocked,
root·네트워크 없음). CI verify 잡도 이 명령을 실행한다. 실제 서버에서 AppArmor 프로필 적용,
nftables 차단(`fib` 규칙 포함), Chrome 정책 적용, HERMES의 CDP 연결과 셸 훅 등록은 아직 실행하지
않았다(not_run). 공유 서버 재설치는 대표 확인 뒤에 하고, 그때 설치기의 점검 출력을 기록한다.

Official implementation references:

- https://hermes-agent.nousresearch.com/docs/user-guide/features/browser/
- https://github.com/NousResearch/hermes-agent/blob/main/tools/browser_tool_install.py
- https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/env_loader.py
- https://github.com/vercel-labs/agent-browser/tree/v0.26.0
