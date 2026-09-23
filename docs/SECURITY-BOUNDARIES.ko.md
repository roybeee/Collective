# 보안 경계와 검증 범위

애플리케이션은 Sites 디스패처가 인증한 `oai-authenticated-user-id`를 신뢰한다. 입력 길이 검사나 로컬 모의 인증 테스트는 디스패처의 헤더 위조 방지를 증명하지 않는다.

## 설치 파일 배포 권한

`RESEARCH_WORKER_ADMIN_IDS`에 설치 파일을 받을 수 있는 **인증된 사용자 ID**를 쉼표로 구분해 설정한다. 이메일, 표시 이름, 접두어, 와일드카드는 사용하지 않는다. 목록이 없거나 사용자가 포함되지 않으면 설치 파일 다운로드는 403으로 거부되고 `canInstall`은 false다.

이 변경은 의도적으로 fail-closed다. 기존 설치 파일 다운로드를 유지하려면 게시 전에 운영 담당자가 허용할 실제 ID를 확인해 배포 환경변수에 등록해야 한다. 이 문서나 소스 변경은 운영 환경변수를 바꾸지 않는다. 기존 작업자 heartbeat 및 사용자 자신의 작업자 폐기는 관리자 목록과 무관하게 계속 동작한다.

설치 파일에는 owner 전용 토큰 외에 **사이트 공통 gate 비밀값이 여전히 포함**된다. 지정 관리자는 이 공통 비밀값을 취급하는 신뢰 주체다. 관리자 제한은 일반 사용자에게 공통 비밀값이 배포되는 것을 막으며, gate 자체를 owner 전용 자격증명으로 바꾸지는 않는다. 파일은 no-store 첨부로 반환되며 설치 후 사본을 제거해야 한다. 장기 개선은 기계 접근 프록시에서 공통 gate를 보관하고 owner·경로·만료가 제한된 자격증명만 설치 파일로 전달하는 것이다.

## 입력과 공급자 응답

`lib/http-limits.ts`는 Content-Length뿐 아니라 **수신 중 실제 바이트**를 세고 한도 초과 시 스트림을 취소한다. JSON 요청은 200,000 UTF-8 바이트와 객체 루트만 허용한다. 기존 문자 수 제한과 달라 한글 등 멀티바이트 대형 요청은 더 일찍 거부된다. 파일 업로드에는 기존 별도의 8MB 파일/10MB 전송 제한이 유지된다.

외부 공급자 응답을 읽는 코드는 명시적 응답 바이트 한도와 fetch timeout을 함께 사용해야 한다. 크기 제한은 공급자 응답의 스키마 검증, 과금 예산 제한, 도구 실행 권한 제한을 대신하지 않는다.

## 운영 디스패처 읽기 전용 점검

명시적으로 승인받은 운영 origin에만 실행한다. 아래 명령은 GET `/api/channels`만 요청하며, 리다이렉트를 따라가지 않고 응답 본문이나 비밀값을 출력하지 않는다. `COLLECTIVE_PROBE_DIRECT_ORIGIN`은 운영 담당자가 알려준 실제 Worker 직접 접근 주소가 있을 때만 지정한다.

```sh
COLLECTIVE_PROBE_ORIGIN=https://your-authorized-site.example \
COLLECTIVE_PROBE_DIRECT_ORIGIN=https://your-authorized-worker.example \
node scripts/probe-dispatcher-auth.mjs
```

검사 대상은 익명 요청, 위조 사용자 헤더, 중복 사용자 헤더다. 401/403 또는 같은 origin의 명시적 로그인 경로로 가는 리다이렉트만 거부 성공으로 인정한다. 200 HTML 인증 화면이나 다른 리다이렉트는 수동 확인 전 성공으로 판정하지 않는다. 실제 디스패처의 로그인 경로가 다르면 도메인과 경로를 확인한 뒤 검사 조건을 조정한다.

출력의 `passed`는 해당 익명 요청이 거부됐다는 뜻이다. 다음 항목까지 통과한 것은 아니다.

- 정상 로그인한 사용자 A가 B의 헤더를 보냈을 때 A로 강제되는지 또는 거부되는지.
- 두 사용자에 서로 다른 채널/파일 fixture가 있을 때 다른 사용자 자료를 읽을 수 없는지.
- 사이트 공통 gate를 가진 기계 요청이 브라우저 identity를 주장할 수 없는지.
- 공개 도메인 외의 origin이나 대체 라우트가 차단되는지.

이 네 항목은 별도의 승인된 세션·fixture와 디스패처 운영 설정으로 확인해야 한다. 로그에는 cookie, bearer, 실제 계정 자료를 남기지 않는다. 운영본이 검토 브랜치와 다른 경우 검사 결과는 그때 실행 중인 운영본에만 해당한다. `/api/version`의 tree와 검토 tree를 별도로 기록해야 한다.

### 운영 관측 기록

2026-09-23 검증 담당자가 `COLLECTIVE_PROBE_ORIGIN=https://mealzip-agency.hflameb.chatgpt.site node scripts/probe-dispatcher-auth.mjs`를 실행했다. 익명·위조 identity·중복 identity 세 요청은 모두 **passed · real — HTTP 401**이었다. 응답 본문은 기록하지 않았다. 기록 시각은 시스템 시계 기준 2026-09-23 13:08:57 KST다.

Worker 직접 origin 및 로그인된 사용자 간 격리는 **not_run**이다. 이 관측은 당시 운영본에 대한 것이며, 아직 게시하지 않은 작업 브랜치의 배포·런타임 검증을 뜻하지 않는다.

## 에이전트 권한의 남은 경계

게시·메시지·결제 금지 프롬프트와 capabilities 조회는 기술적 read-only enforcement가 아니다. HERMES gateway의 실제 도구 allowlist, 격리된 브라우저 사용자, 중요 행동 승인 정책을 별도로 검증해야 한다. 공개 형태 hostname 검사 또한 DNS/IP 수준 SSRF 차단을 증명하지 않는다. 브라우저 sandbox 및 공통 gate의 경로별 권한은 저장소 밖 운영 경계다.
