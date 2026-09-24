# 조사 서버 재설치 절차서 (대표 실행용)

PR 6 서버 보안 강화를 운영 조사 서버에 적용하는 순서다. 대표가 직접 실행하고, 결과 출력을 Claude에게 넘기면 Claude가 기록한다. 설계와 점검 항목의 정본은 [조사 워커 README](../server/research-worker/README.md)와 [보안 경계](SECURITY-BOUNDARIES.ko.md)의 '운영 적용 절차'다. 이 문서는 그 절차를 실행 순서로만 옮긴 것이다.

- 설치 파일은 운영 앱이 내려준다. 운영 `aa999c6`(Sites 버전 26, 2026-09-24 게시)의 설치기는 3/6단계 샌드박스 점검을 `--dump-dom`으로 해서 Chrome for Testing 154에서 멈춘다(아래 '설치가 멈췄을 때'). CDP 점검으로 바꾼 `server/research-worker/install.py`는 운영에 게시된 뒤 받은 설치 파일부터 들어 있다. `worker.py`는 aa999c6 뒤 바뀌지 않았다.
- 재설치 전 운영 서버는 이전 방식이다(hermes 계정이 샌드박스 없이 Chromium 실행, 워커도 hermes 계정).
- 소요 시간은 측정한 적이 없다. 처음 실행할 때 기록한다.

## 무엇이 바뀌나 (영향)

- 기본 HERMES 게이트웨이를 재시작한다. 같은 게이트웨이를 쓰는 작업은 잠시 끊긴다. 다른 HERMES 프로필은 고치지 않는다.
- 서버 브라우저를 전용 계정(`collective-browser`)이 샌드박스를 켠 채 띄우고, HERMES는 CDP(루프백 9333)로 붙는다. 브라우저 계정은 내부망·서버 자신의 주소·`file://`에 접근하지 못한다.
- HERMES의 `browser_cdp`·`browser_dialog` 호출을 훅으로 막는다.
- 조사 워커를 전용 계정(`collective-worker`)으로 옮기고, 설정 폴더(`/etc/collective-research`)만 쓸 수 있게 한다. 이 재설치 뒤에야 토큰 자동 교체를 저장할 수 있다.
- 설치 파일을 새로 받으면 새 작업자 자격증명이 발급된다. 지금 가동 중인 워커의 토큰은 10분 동안만 함께 받고 그 뒤 거부된다.

## 준비

- COLLECTIVE 소유자 로그인(설치 파일은 지정된 관리자만 받을 수 있다)
- 서버에 키 인증으로 접속하는 sudo 계정(root 직접 로그인이 아닌 계정). 계정에 sudo가 없으면 root 비밀번호가 필요하다(3단계).
- 조사·AI 작업이 없는 시간. 진행 중인 AI 작업이 있으면 설치 파일 발급이 막힌다.
- CDP 점검 설치기여야 한다. 운영에 CDP 점검 변경이 게시된 뒤 받은 설치 파일이거나, Claude가 이미 받은 설치 파일에 같은 코드를 적용해 준 파일이다(자격증명은 받은 파일 그대로). 어느 쪽이든 2단계 끝의 확인 명령으로 판정한다. aa999c6 설치기는 3/6단계에서 멈춘다.

## 순서

1. **진행 중 작업 정리.** COLLECTIVE에서 진행 중인 조사·AI 작업을 끝내거나 취소한다.
2. **설치 파일 받기.** 연결 및 설정 → Mac 없이 브랜드 조사 → '서버 설치 파일 받기'(이미 설치돼 있으면 '설치 파일 다시 발급'). '가동 중 워커는 10분 안에 새 설치가 필요합니다…' 확인 창이 뜨면 계속한다. 여기서부터 10분 안에 3단계를 끝내는 것이 좋다. 넘겨도 워커가 멈출 뿐 설치가 끝나면 다시 이어진다.

   받은 파일(또는 Claude가 적용해 준 파일)이 CDP 점검 설치기인지 Mac 터미널에서 확인한다. 파일 이름이 다르면 명령의 경로를 그 이름으로 바꾼다. 개수만 세므로 자격증명은 출력되지 않는다. 첫 줄은 `0`, 둘째 줄은 `1` 이상이어야 한다. 아니면 이전 설치기이므로 실행하지 않고 Claude에게 알린다.

   ```sh
   grep -c -- '--dump-dom' ~/Downloads/install-collective-server.py
   grep -c PROBE_PORT ~/Downloads/install-collective-server.py
   ```
3. **서버에서 실행.** Mac 터미널에서 `<서버 접속 주소>`를 실제 `user@host`로 바꿔 실행한다.

   ```sh
   scp ~/Downloads/install-collective-server.py <서버 접속 주소>:~/
   ssh -t <서버 접속 주소> 'sudo python3 ~/install-collective-server.py'
   ```

   ssh 계정에 sudo가 없고 root 비밀번호로 권한을 올리는 서버는 scp는 같게 하고, 접속한 뒤 root로 바꿔 실행한다. `<ssh 계정>`은 scp로 올린 계정 이름이다.

   ```sh
   ssh -t <서버 접속 주소>
   su -
   python3 ~<ssh 계정>/install-collective-server.py
   ```

   - 브라우저가 같은 이름의 파일을 이미 받아 두었으면 새 파일은 `install-collective-server (1).py`처럼 저장된다. `ls -t ~/Downloads/install-collective-server*.py`로 가장 최근 파일 이름을 확인하고, 공백이 든 이름은 따옴표로 감싸 서버에는 원래 이름으로 올린다. 예: `scp ~/Downloads/"install-collective-server (1).py" <서버 접속 주소>:~/install-collective-server.py`
   - `<서버 접속 주소>`는 꺾쇠까지 지우고 바꾼다. 그대로 붙이면 zsh가 `<`·`>`를 입력·출력 기호로 해석해 실패한다(`no such file or directory: 서버`).

   `--allow-no-sandbox`는 붙이지 않는다. 샌드박스 문제로 설치가 멈추면 아래 '설치가 멈췄을 때'를 보고, 그 출력을 Claude에게 넘기고 결정한다.
4. **출력 확인.** 끝에 아래가 모두 보여야 성공이다.
   - `격리 확인:`으로 시작하는 줄들: CDP 점검 포트 접속 거부(collective-npm 계정), `file://` 열기 거부(직후 data: 재확인 통과), 루프백 접속 거부, CDP 포트 접속 거부(collective-npm 계정), 서버 자신의 주소 접속 거부(주소마다 한 줄), `browser_cdp·browser_dialog 호출을 막음`, 작업자 자격증명·HERMES 설정·HERMES 비밀 읽기 거부(브라우저 계정), 작업자 자격증명 읽기 거부(hermes 계정)
   - `Real browser check passed: Example Domain`
   - `Services started. Check COLLECTIVE settings for the worker heartbeat.`
   - `Backup: …`(롤백 때 쓰는 백업 시각)
   - `브라우저 계정: collective-browser (Chromium 샌드박스 유지)`

   중간에 멈추면 설치기가 스스로 되돌린다(격리 점검 실패면 브라우저 서비스를 끄고, HERMES 설정 뒤 실패면 HERMES 설정을 백업으로 되돌리고 작업자 서비스를 끈다). 오류 줄을 그대로 복사해 Claude에게 넘긴다.
5. **앱에서 확인.** 연결 및 설정 화면에서 작업자 '마지막 응답'이 갱신되는지 본다. gate 표시가 '최근 작업자 요청의 사이트 gate 헤더를 앱에서도 확인했습니다'인지도 본다. 토큰 안내 줄에 '작업자는 새 토큰을 저장할 수 있다고 알렸습니다.'가 붙어야 한다(설정 폴더 쓰기 가능. 만료가 꺼진 지금은 이 문장이 없어도 경고는 따로 뜨지 않는다).
6. **실제 조사 1건.** 새 브랜드 조사를 하나 시작해 끝까지 가는지 본다.
7. **설치 파일 지우기.** 설치 파일에는 비공개 자격증명이 들어 있다. 서버 사본은 성공 시 설치기가 지운다(지우지 못하면 경고가 나오므로 그때 직접 지운다). Mac의 `~/Downloads`에 받은 설치 파일은 이전에 받은 것까지 모두 직접 지운다(`rm ~/Downloads/install-collective-server*.py`).

## 설치가 멈췄을 때

- 3/6단계 샌드박스 점검이 실패하면(`샌드박스를 켠 채로 Chromium을 시작하지 못해…`) 설치기는 격리 브라우저 서비스를 끄고 비활성화한 뒤 멈춘다. HERMES 설정은 이 단계 전에는 바꾸지 않으므로 그대로다. 오류 줄에 점검 Chromium 로그의 마지막 몇 줄이 사유로 들어간다.
- 설치 파일은 성공했을 때만 지워지므로 서버 사본이 남아 있다.
- `--allow-no-sandbox`로 다시 실행하지 않는다. 원인을 가르려면 Claude와 함께 서버의 root 셸(`sudo -i`)에서 아래를 실행한다. Chromium은 브라우저 계정으로만 띄우고(샌드박스 켬) root는 CDP 요청만 보낸다. root로 Chromium을 띄우지 않는다(인증 없는 CDP 포트에 샌드박스 없는 root 브라우저가 열린다). 임시 포트(예: 9556, 9333·9334가 아닌 포트)는 방화벽의 계정 제한 밖이라 다른 로컬 계정도 붙을 수 있다. 그래서 `timeout 30`으로 짧게 띄우고, 끝나면 진단 브라우저를 끝낸 뒤 진단 프로필과 로그를 지운다.

  ```sh
  (timeout 30 runuser -u collective-browser -- env -i HOME=/var/lib/collective-browser PATH=/usr/bin:/bin /opt/collective-browser/chromium/chrome --headless=new --disable-dev-shm-usage --no-first-run --remote-debugging-port=9556 --user-data-dir=/var/lib/collective-browser/diag-cdp about:blank >/tmp/cb-diag.log 2>&1 &); sleep 8
  curl -s -m 5 -X PUT 'http://127.0.0.1:9556/json/new?data:text/html,%3Ctitle%3Esandbox-ok%3C%2Ftitle%3E' >/dev/null; sleep 3
  curl -s -m 5 http://127.0.0.1:9556/json/list | grep -o '"title": "[^"]*"'
  grep -i -E 'sandbox|namespace|fatal' /tmp/cb-diag.log | head -5
  pkill -KILL -u collective-browser -f diag-cdp; sleep 1; rm -rf /var/lib/collective-browser/diag-cdp /tmp/cb-diag.log
  ```

  - `/json/list`에 제목 `"sandbox-ok"`가 보이면 샌드박스 안의 렌더러가 페이지를 연 것이다. 샌드박스는 정상이고 설치기 점검 쪽 문제다(2026-09-24 첫 설치가 이 경우였다). `/json/version` 응답만으로는 판정하지 않는다. 브라우저 프로세스와 CDP 서버가 떴다는 것만 보여 주고, 샌드박스 안에서 페이지를 여는지는 알 수 없다.
  - 보이지 않으면 첫 줄에 `--no-sandbox`를 붙여 브라우저 계정으로 한 번 더 같은 순서로 확인한다. 그때만 보이면 샌드박스·AppArmor 쪽을 의심하고 `journalctl -k`의 AppArmor 거부를 본다. 둘 다 보이지 않으면 로그 줄을 Claude에게 넘긴다.
- 출력을 넘길 때 서버 주소·IP는 가린다.

## Claude에게 넘길 것

- 4단계 출력 중 `격리 확인:` 줄 전부, `Real browser check passed`, `브라우저 계정:` 줄, 성공·실패 여부, 실행 시각
- 5·6단계 결과(마지막 응답 갱신, gate 표시, 새 토큰 저장 가능 문장, 조사 1건 결과)
- 서버 주소·IP·자격증명·설치 파일 내용은 넘기지 않는다. 출력에 서버 주소가 보이면 가린다.

Claude는 받은 내용을 [보안 경계](SECURITY-BOUNDARIES.ko.md)의 운영 관측 기록과 `docs/STATUS.md`에 남긴다.

## 되돌리기

[README 롤백](../server/research-worker/README.md#롤백) 절차를 따른다. `<시각>`은 4단계 `Backup:` 줄의 시각이다. 롤백하면 이전 방식(hermes 계정, 샌드박스 없음)으로 돌아가므로 임시 조치로만 쓴다.

## 재설치 뒤 결정할 것 (선택)

아래 환경 스위치는 각각 배포 환경변수 추가와 게시가 필요하다. 켜는 순서와 되돌리기는 [보안 경계](SECURITY-BOUNDARIES.ko.md)에 있다. 재설치 전에는 켜지 않는다.

- `RESEARCH_WORKER_TOKEN_EXPIRY=enforce`: 작업자 토큰 90일 만료와 자동 교체. 켠 뒤 설치 파일을 다시 발급해 재설치해야 새 토큰에 만료가 붙는다.
- `RESEARCH_WORKER_APP_GATE=enforce`: 5단계 gate 표시가 '앱에서도 확인했습니다'일 때만 켠다.
- `RESEARCH_TOOL_POLICY=block`: 위험 도구가 보이거나 도구 목록을 못 읽으면 조사 시작을 막는다.
