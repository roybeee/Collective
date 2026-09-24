# 조사 서버 재설치 절차서 (대표 실행용)

PR 6 서버 보안 강화를 운영 조사 서버에 적용하는 순서다. 대표가 직접 실행하고, 결과 출력을 Claude에게 넘기면 Claude가 기록한다. 설계와 점검 항목의 정본은 [조사 워커 README](../server/research-worker/README.md)와 [보안 경계](SECURITY-BOUNDARIES.ko.md)의 '운영 적용 절차'다. 이 문서는 그 절차를 실행 순서로만 옮긴 것이다.

- 설치 파일은 운영 앱이 내려준다. 운영 `aa999c6`(Sites 버전 26, 2026-09-24 게시)에 이 설치기가 들어 있다. 저장소의 `server/research-worker/install.py`·`worker.py`는 aa999c6 뒤 바뀌지 않았다.
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
- 서버에 키 인증으로 접속하는 sudo 계정(root 직접 로그인이 아닌 계정)
- 조사·AI 작업이 없는 시간. 진행 중인 AI 작업이 있으면 설치 파일 발급이 막힌다.

## 순서

1. **진행 중 작업 정리.** COLLECTIVE에서 진행 중인 조사·AI 작업을 끝내거나 취소한다.
2. **설치 파일 받기.** 연결 및 설정 → Mac 없이 브랜드 조사 → '서버 설치 파일 받기'(이미 설치돼 있으면 '설치 파일 다시 발급'). '가동 중 워커는 10분 안에 새 설치가 필요합니다…' 확인 창이 뜨면 계속한다. 여기서부터 10분 안에 3단계를 끝내는 것이 좋다. 넘겨도 워커가 멈출 뿐 설치가 끝나면 다시 이어진다.
3. **서버에서 실행.** Mac 터미널에서 `<서버 접속 주소>`를 실제 `user@host`로 바꿔 실행한다.

   ```sh
   scp ~/Downloads/install-collective-server.py <서버 접속 주소>:~/
   ssh -t <서버 접속 주소> 'sudo python3 ~/install-collective-server.py'
   ```

   `--allow-no-sandbox`는 붙이지 않는다. 샌드박스 문제로 설치가 멈추면 그 출력을 Claude에게 넘기고 결정한다.
4. **출력 확인.** 끝에 아래가 모두 보여야 성공이다.
   - `격리 확인:`으로 시작하는 줄들: `file://` 열기 거부(직후 data: 재확인 통과), 루프백 접속 거부, CDP 포트 접속 거부(collective-npm 계정), 서버 자신의 주소 접속 거부(주소마다 한 줄), `browser_cdp·browser_dialog 호출을 막음`, 작업자 자격증명·HERMES 설정·HERMES 비밀 읽기 거부(브라우저 계정), 작업자 자격증명 읽기 거부(hermes 계정)
   - `Real browser check passed: Example Domain`
   - `Services started. Check COLLECTIVE settings for the worker heartbeat.`
   - `Backup: …`(롤백 때 쓰는 백업 시각)
   - `브라우저 계정: collective-browser (Chromium 샌드박스 유지)`

   중간에 멈추면 설치기가 스스로 되돌린다(격리 점검 실패면 브라우저 서비스를 끄고, HERMES 설정 뒤 실패면 HERMES 설정을 백업으로 되돌리고 작업자 서비스를 끈다). 오류 줄을 그대로 복사해 Claude에게 넘긴다.
5. **앱에서 확인.** 연결 및 설정 화면에서 작업자 '마지막 응답'이 갱신되는지 본다. gate 표시가 '최근 작업자 요청의 사이트 gate 헤더를 앱에서도 확인했습니다'인지도 본다. 토큰 안내 줄에 '작업자는 새 토큰을 저장할 수 있다고 알렸습니다.'가 붙어야 한다(설정 폴더 쓰기 가능. 만료가 꺼진 지금은 이 문장이 없어도 경고는 따로 뜨지 않는다).
6. **실제 조사 1건.** 새 브랜드 조사를 하나 시작해 끝까지 가는지 본다.
7. **설치 파일 지우기.** 설치 파일에는 비공개 자격증명이 들어 있다. 서버 사본은 성공 시 설치기가 지운다(지우지 못하면 경고가 나오므로 그때 직접 지운다). Mac의 `~/Downloads/install-collective-server.py`는 직접 지운다.

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
