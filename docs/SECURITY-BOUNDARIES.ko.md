# 보안 경계와 검증 범위

운영은 `AUTH_MODE=email`이고 Sites 접근은 public이다(2026-09-23 전환, [게시 기록](releases/2026-09-23-1ecd72e.md)). 앱은 자체 세션 쿠키로 사용자를 확인하고 그 계정의 `workspace_owner`를 소유자로 쓰며, `oai-authenticated-user-id` 헤더는 인증에 쓰지 않는다. 이 헤더를 신뢰하는 legacy 모드는 로컬 개발·E2E용이다. 운영에서는 Sites 접근을 owner-only로 되돌린 뒤의 복구 절차([EMAIL-AUTH.ko.md 복구](EMAIL-AUTH.ko.md))에서만 쓰며, Sites public 상태에서는 절대 쓰지 않는다. PR 1(`auth-2`)부터 운영 빌드는 `AUTH_MODE`가 비어 있을 때 legacy로 열리지 않는다(fail-closed, `lib/auth-session.ts` `authMode`). legacy를 쓰려면 `AUTH_MODE=legacy`를 명시해야 한다. 환경 revision 변경·복구·재게시 뒤에는 `/api/auth`가 mode=email을 반환하는지, 위조 헤더 요청이 401인지 먼저 확인한다. 역할별 권한은 아래 표를 따르고, 설치 파일 허용 목록은 PR 1부터 개인 사용자 단위로 판정한다. 입력 길이 검사나 로컬 모의 인증 테스트는 운영 인증 경계를 증명하지 않는다.

## 역할별 권한 (이메일 모드)

마지막 갱신: 2026-09-24 KST (F4a: 캠페인 삭제 영향 조회 행·결정 7 규칙 보존 추가)

같은 워크스페이스의 계정은 대표(owner)·관리자(admin)·직원(member) 중 하나다. 대표는 DB에 따로 저장하지 않고 같은 워크스페이스에서 가장 먼저 만든 관리자 계정으로 계산한다(`lib/auth-session.ts` `roleSql`). 판정은 서버 API가 하며, 화면에서 버튼을 숨기는 것은 보조 수단이다. 직원이 관리자 전용 작업을 요청하면 403이다. legacy 모드(로컬 개발·E2E)의 헤더 사용자는 모든 권한을 가진다.

| 작업 | API | 대표 | 관리자 | 직원 |
|---|---|---|---|---|
| 캠페인 작성·브리프 수정 | `/api/action` `save_campaign` | 허용 | 허용 | 허용 |
| AI 실행·브리프 초안 | `/api/run`, `/api/brief`, `/api/meetings` | 허용 | 허용 | 허용 |
| 작업물 등록·수정 | `/api/action` `save_artifact` | 허용 | 허용 | 허용 |
| 작업물 수정 요청 | `/api/action` `review_artifact` (`revision`) | 허용 | 허용 | 허용 |
| 작업물 최종 승인 | `/api/action` `review_artifact` (`approved`) | 허용 | 허용 | 403 |
| 성과 기록 | `/api/action` `save_metric` | 허용 | 허용 | 허용 |
| 캠페인 삭제 | `/api/action` `delete_campaign` | 허용 | 허용 | 403 |
| 캠페인 삭제 영향 조회(kind별 삭제·보존 건수) | `/api/campaigns/[id]/deletion` GET | 허용 | 허용 | 403 |
| 브랜드 지식 수정 | `/api/action` `save_brand` | 허용 | 허용 | 403 |
| 브랜드 사실 후보 제안·후보 수정 | `/api/brand-facts` `save_fact` (`candidate`) | 허용 | 허용 | 허용 |
| 브랜드 사실 확정·거절, 확정·거절된 사실 수정 | `/api/brand-facts` `save_fact` | 허용 | 허용 | 403 |
| 아카이브 자료 추가·후보로 되돌리기 | `/api/archive` `add_source`, `review_source`·`review_sources` (모든 항목이 `candidate`) | 허용 | 허용 | 허용 |
| 아카이브 자료 확정·사용 제외(일괄 포함), 진단 채택, 의뢰 정보 수정 | `/api/archive` `review_source`·`review_sources` (`confirmed`·`excluded`가 하나라도 있으면), `confirm_diagnosis`, `save_intake` | 허용 | 허용 | 403 |
| 캠페인 상시 지시 추가 | `/api/directives` `add` | 허용 | 허용 | 허용 |
| 캠페인 상시 지시 삭제 | `/api/directives` `remove` | 허용 | 허용 | 본인 역할(직원)이 남긴 지시만. 관리자·대표가 남긴 지시는 403 |
| HERMES·OpenAI 연결 저장·해제 | `/api/action` `save_hermes`·`save_connection`·`disconnect` | 허용 | 허용 | 403 |
| HERMES 연결 주소 조회 | `/api/workspace` `connection.endpoint` | 포함 | 포함 | 응답에서 제외 |
| 채널 연결 변경 | `/api/channels` POST | 허용 | 허용 | 403 |
| 사용량 단가 변경 | `/api/usage` POST | 허용 | 허용 | 403 |
| 발행 설정·승인·실행·취소 | `/api/execution` `connect_buffer`·`save_limits`·`approve`·`execute`·`cancel` | 허용 | 허용 | 403 |
| 서버 설치 파일 발급 | `/api/research-worker/setup` `download` | 아래 목록 판정 | 아래 목록 판정 | 403 |
| 서버 작업자 연결 해제 | `/api/research-worker/setup` `revoke` | 허용 | 허용 | 403 |

계정 초대·역할 변경·세션 종료 권한은 [EMAIL-AUTH.ko.md](EMAIL-AUTH.ko.md)를 따른다. 표에 없는 업무 API(아카이브의 위 두 줄 밖 작업·조사·지점·주문·학습 등)는 같은 워크스페이스의 로그인 사용자면 역할과 관계없이 허용한다. 확정 자료와 채택 진단은 AI 제작 맥락에 '확인된 근거'로 들어가므로(`lib/archive-server.ts` `brandArchiveContext`) 브랜드 사실과 같은 등급으로 관리자 전용이다. 상시 지시는 직원도 남길 수 있으므로 '확인된 근거'가 아니다. 저장할 때 작성자 역할(`createdBy.role`)을 남기고, AI 입력에는 `{text, author: 관리자|직원}`으로 전달하며, 역할·회의·브리프 지시문은 상시 지시가 사실을 확정하거나 거절 사실(`evidence.facts.prohibited`)·광고 표현 규칙을 무효화하지 못한다고 명시한다(`lib/campaign-policy.ts` `directivePolicy`). 앱 화면은 직원에게 관리자 전용 버튼을 그리지 않고 '관리자에게 요청하세요'를 안내한다(`useCanManage`). 사이드바 프로필은 로그인 계정을 보여 주지만 상단 계정 바(이메일·팀 계정 관리·비밀번호 변경·로그아웃)와 하나로 합치는 일은 이번 범위에서 뺐다.

행위자 기록: `/api/action`이 남기는 캠페인 이력 이벤트에는 요청한 사용자(`id`, `email`)를 함께 저장한다. 브랜드 사실을 확정·거절하면 `confirmedBy`(`id`, `email`)와 `confirmedAt`을 저장하고 사실 화면에 표시한다. 이 필드가 생기기 전에 저장된 사실에는 값이 없으며, 없는 사실도 기존처럼 제작 맥락에 쓰인다. 캠페인 삭제 기록(tombstone)에는 `deletedBy`(`id`, `email`)를 남긴다. 대표 결정 7(b)에 따라 캠페인 삭제는 바이럴 출처 학습 규칙을 지우지 않고 `status: retired`와 `sourceCampaignDeleted`(`at`, `by`)로 남기며, 원천 바이럴 실험은 원문(대조안·실험안·조건·메모·수치 출처)을 뺀 요약(kind `viral_experiment_summary`)만 동결한다. 남는 규칙에서도 원천 실험에서 복사된 원문(적용 범위 `scope`, `sourceAssessment`의 유지 조건·결과 메모·판정 사유)은 비우고, 규칙 제목·문구(`guidance`)·연장 기록·수치 판정만 둔다(`lib/record-kinds.ts` `retireRuleOfDeletedCampaign`). 다른 캠페인이 실행 시점에 받은 학습 규칙 사본(kind `learning_snapshot`)은 그 캠페인의 기록이라 원문을 포함한 채 남는다. 점포 출처 규칙·점포 실험은 그대로 둔다. kind별 삭제 정책은 `lib/record-kinds.ts`가 정본이다. 서버 설치 파일 발급·작업자 연결 해제는 같은 batch에서 `records`(kind `worker_event`)에 작업·행위자·시각을 남기고, 설정 화면은 대표·관리자에게 마지막 발급자와 해제자를 보여 준다. 학습·지점·AI 실행·회의 요청이 남기는 이벤트의 행위자 범위는 [EMAIL-AUTH.ko.md](EMAIL-AUTH.ko.md)의 '업무 이벤트'를 따른다.

## 설치 파일 배포 권한

`RESEARCH_WORKER_ADMIN_IDS`에 설치 파일을 받을 수 있는 사용자를 쉼표로 구분해 설정한다. 이메일, 표시 이름, 접두어, 와일드카드는 사용하지 않는다. 판정 단위는 **개인 사용자**다(`app/api/research-worker/setup/route.ts`).

| 요청자 (이메일 모드) | 허용 조건 |
|---|---|
| 대표(owner) | 목록에 본인 사용자 ID(`auth_users.id`) 또는 워크스페이스 owner ID가 있을 때. 워크스페이스 owner ID는 기존 운영 설정과의 호환용이다. |
| 관리자(admin) | 목록에 본인 사용자 ID가 있을 때만. 워크스페이스 owner ID가 목록에 있어도 같은 워크스페이스의 다른 관리자는 403이다. |
| 직원(member) | 목록과 관계없이 403. |

legacy 모드에서는 헤더의 사용자 ID가 곧 워크스페이스 owner이므로 기존처럼 그 ID가 목록에 있어야 한다. 목록이 없거나 조건에 맞지 않으면 설치 파일 다운로드는 403으로 거부되고 `canInstall`은 false다.

이 판정은 의도적으로 fail-closed다. 기존 운영 설정(워크스페이스 owner ID)은 대표 계정에만 계속 통한다. 다른 관리자에게 설치를 맡기려면 운영 담당자가 그 사람의 사용자 ID를 배포 환경변수에 추가해야 한다. 이 문서나 소스 변경은 운영 환경변수를 바꾸지 않는다. 기존 작업자 heartbeat는 관리자 목록과 무관하게 계속 동작한다. 작업자 연결 해제(`revoke`) API는 목록과 무관하게 대표·관리자에게 허용한다(상태 응답의 `canRevoke`). 설치 담당자가 없거나 설치 환경(`RESEARCH_WORKER_GATE_TOKEN`·`RESEARCH_WORKER_SITE_ORIGIN`)이 빠져 `canInstall`이 모두 false일 때도 가동 중인 작업자를 멈추는 수단이다.

설정 화면은 `canInstall`이 false인 사용자에게 설치 명령과 설치 파일 받기·다시 발급 버튼을 렌더링하지 않는다. 작업자 연결 해제 버튼은 `canRevoke`(대표·관리자)일 때 보인다. 연결 상태·마지막 응답 같은 상태 표시는 모든 로그인 사용자에게 보인다. 설치 명령의 접속 대상은 선택 환경변수 `RESEARCH_WORKER_SSH_TARGET`(`사용자@호스트`, 예: `deploy@research.example.com`)에서 읽어 `canInstall` 사용자에게만 내려준다. 값이 없거나 형식이 맞지 않으면 화면과 [README](../server/research-worker/README.md)는 `<서버 접속 주소>` 자리표시자를 보여 준다. 명령은 root 직접 로그인이 아니라 sudo 권한이 있는 계정으로 접속해 `sudo python3`로 설치 파일을 실행하는 기준이다. 실제 서버 주소는 저장소에 적지 않는다. 관측 기록의 HERMES 연결 주소도 `<HERMES 연결 주소>` 자리표시자로 바꿨다. `tests/security-boundaries.test.mjs`는 루트 문서와 app·lib·server·scripts·docs·e2e 파일에서 점 표기 IPv4(루프백과 RFC 5737 예시 대역 제외), 대시 표기 sslip.io·nip.io 호스트명, root 계정 접속 표기(`root` 뒤에 `@`)를 찾으면 실패한다. gitleaks에 IPv4 규칙을 추가하는 일은 이번 범위에서 뺐다. gitleaks 규칙은 경고가 아니라 커밋 차단이라 테스트 코드의 예시 IP까지 막기 때문이다. 과거 git 이력의 노출은 지울 수 없다. 서버의 root SSH 로그인 차단·키 인증·방화벽 허용목록은 저장소 밖 설정이며 이 PR에서 확인하지 않았다(not_run). 후속 운영 확인 항목으로 유지한다.

설치 파일에는 owner 전용 토큰 외에 **사이트 공통 gate 비밀값이 여전히 포함**된다. 지정 관리자는 이 공통 비밀값을 취급하는 신뢰 주체다. 관리자 제한은 일반 사용자에게 공통 비밀값이 배포되는 것을 막으며, gate 자체를 owner 전용 자격증명으로 바꾸지는 않는다. 파일은 no-store 첨부로 반환되며 설치 후 사본을 제거해야 한다. 장기 개선은 기계 접근 프록시에서 공통 gate를 보관하고 owner·경로·만료가 제한된 자격증명만 설치 파일로 전달하는 것이다([개선 계획](IMPROVEMENT-PLAN.ko.md) PR 6).

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
