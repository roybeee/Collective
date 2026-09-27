# 인터뷰 음성 전사 연결 (설치 전)

이 디렉터리는 **COLLECTIVE 전용 확장**이다. Hermes 표준 API에 이미 있는 기능이 아니다. 웹 앱을 게시하는 것만으로 설치되지 않는다. 현재 세션에서 공유 서버 설치·실제 음성 전사는 검증하지 않았다.

## 동작

- 원본: 기존 비공개 R2 아카이브(파일당 8MB). 참여자 동의 체크 뒤 서버 간 multipart로만 전송한다. 공개 URL·base64 프롬프트를 만들지 않는다.
- 전사: HERMES 서버의 로컬 CPU에서 faster-whisper `small`, int8, 한국어. 별도 모델 API 호출은 없다. 최초 모델 다운로드와 CPU/메모리가 필요하다.
- 후처리: 기존 HERMES 실행·사용량·토큰 예산 경로로 텍스트를 8개 섹션의 후보로 정리한다.
- 작업 큐: SQLite에 요청 ID와 파일 해시를 저장한다. 같은 요청은 다시 보내도 중복 접수하지 않고 다른 바이트는 409. 16개 대기 상한. 재시작 시 실행 중 작업을 재개한다(로컬 추론은 다시 실행할 수 있다).
- 원음은 전사 성공/실패 즉시 제거. 결과는 24시간 후 제거하며 멱등 tombstone(해시·상태)은 남는다. R2의 원본·앱에 가져온 전사문은 기존 아카이브 보존 정책을 따른다. 별도 인터뷰 삭제 정책은 아직 추가하지 않았다.
- 녹음 한 구간은 20분 이하. 앱은 약 15분마다 나누도록 안내하고 7MB에서 녹음을 멈춘다. 브라우저가 늦게 마지막 청크를 전달해 8MB를 넘으면 다운로드로 원본을 보전하고 분할 업로드한다.

## 설치 담당자 절차

공유 HERMES 서버 운영자만 실행한다. 기존 서비스·프록시를 덮어쓰는 설치 스크립트는 제공하지 않는다.

1. 별도 서비스 계정과 상태 디렉터리를 만든다. `requirements.txt`로 Python venv를 설치하고 `INTERVIEW_STT_MODEL` 모델을 사전 다운로드한다. faster-whisper 공식 사용법: https://github.com/SYSTRAN/faster-whisper
2. 환경변수 설정(암호를 명령행·Git·PR에 기록하지 않는다):
   - `INTERVIEW_GATEWAY_KEY`: 현재 HERMES gateway Bearer와 동일한 강한 키(20자 이상)
   - `HERMES_LOCAL_UPSTREAM`: 기존 gateway의 loopback 주소, 기본 `http://127.0.0.1:8642`
   - `INTERVIEW_STT_STATE`: 서비스 계정만 읽는 영속 경로, 기본 `/var/lib/collective-interview`
   - `INTERVIEW_STT_PORT`: 기본 `8643`, loopback 전용
   - `INTERVIEW_STT_MODEL`: 기본 `small` 또는 사전 다운로드한 로컬 모델 경로
3. `python service.py`를 서비스 관리자 아래에서 실행한다. CPU 2개, 충분한 RAM, 재시작 정책을 설정한다. 다른 Hermes 작업의 성능을 확인한다.
4. 기존 HTTPS origin의 **두 경로만** loopback `8643`으로 연결한다: `GET /v1/capabilities`, `POST /v1/audio/transcriptions`. 그 밖의 경로는 기존 HERMES gateway를 유지한다. 프록시 업로드 상한 9MB, 헤더 전달, 요청 제한을 설정한다. 공개 접근·앱 로그인 정책을 바꾸지 않는다.
5. 익명 capabilities 401, 올바른 Bearer capabilities의 기존 필드 유지 및 `features.audio_transcription.protocol=collective-multipart-v1` 확인. 잘못된 파일/과대 입력/동일 키 다른 바이트 거부를 확인한다.
6. 앱에서 합성·동의된 한국어 짧은 녹음 → 보관 → 음성 전사 → 진행 중(202) → 같은 버튼으로 결과 확인(200) → 자동 정리 → 섹션 반영을 실제 확인한다. 파일을 청취하여 누락·환각을 검토한다. 이 결과 전에는 음성 경로를 `real passed`로 보고하지 않는다.

롤백: 위 두 프록시 경로를 기존 gateway로 복구하고 이 서비스만 정지한다. 앱은 기능 미지원 안내로 돌아가고 R2 원본과 수기/텍스트 인터뷰는 유지된다.

## HTTP 계약

- 능력 광고가 없으면 앱은 음성을 보내지 않는다.
- POST에는 `Authorization`, 서버 생성 `Idempotency-Key: interview-audio-<source id>`, `file` multipart, `language=ko`가 필요하다.
- 202 `{status:"queued"|"running"}`: 같은 파일·키로 나중에 확인.
- 200 `{text:"..."}`: 전체 전사문(80,000자 이하).
- 409: 같은 키 다른 바이트. 413: 용량. 422: 전사 실패/만료. 429: 대기열 가득 참.
- 실패 상태는 같은 키로 새 추론을 자동 실행하지 않는다. 원인 해결 후 원본을 새 자료로 올려 새 요청을 만든다.

## 검사

`python3 tests/interview_transcriber_test.py`(저장소 루트): 큐·재시작·멱등·보존·multipart 검사. 모델은 호출하지 않는다. 실제 전사 정확도, CPU 소요 시간, reverse proxy는 별도 운영 인수 조건이다.
