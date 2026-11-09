# MCP 서버·API 키 (G9)

마지막 갱신: 2026-11-09 KST. 레인 G. 전체 계획 `docs/GLOBAL-PLAN.ko.md` 에픽 G9. 기능 스위치 `mcp_server`(기본 꺼짐) 뒤에 있다. 꺼진 기본 상태에서는 엔드포인트가 모두 404이고 키를 만들 수 없다.

비유하면 API 키는 "열람실 출입증"이다. 출입증을 가진 AI 도구는 서류(브랜드·캠페인·작업물·성과)를 읽고, 초안 범위 출입증이면 검토함에 초안을 넣을 수 있다. 결재 도장(승인)·발송·지출은 출입증으로 할 수 없고, 사람이 COLLECTIVE 화면에서 한다.

## 1. 구성

| 부분 | 파일 | 역할 |
|---|---|---|
| 엔드포인트 | `app/api/mcp/route.ts` → `lib/mcp/server.ts` | MCP Streamable HTTP 단일 엔드포인트. POST JSON-RPC 2.0 → `Content-Type: application/json` 응답(SSE·세션 없음) |
| 도구 | `lib/mcp/tools.ts`, `lib/mcp/read-tools.ts`, `lib/mcp/draft-tools.ts`, `lib/mcp/schema.ts` | 도구 목록·인자 검증·실행 |
| 키 | `lib/api-keys.ts`(순수), `lib/api-keys-server.ts`(저장·확인·빈도 제한·감사), `app/api/api-keys/route.ts` | 만들기·목록·취소(대표·관리자, 세션) |
| 화면 | `app/api-keys-card.tsx` `ApiKeysCard` | 만들기(이름·범위·기간)·한 번 보이는 키와 복사·목록(마지막 사용)·취소(확인 대화상자) |

### 화면 연결(마운트 메모)

`ApiKeysCard`는 내보내기만 했다. 설정 화면(`app/panels.tsx`)은 다른 레인이 재구성 중이라 이 PR에서 붙이지 않았다. 설정 화면 담당 레인이 '연결 및 설정' 안에 아래처럼 붙인다.

```tsx
import {ApiKeysCard} from './api-keys-card';
// 대표·관리자 여부(canManage)는 기존 설정 화면이 쓰는 관리자 판정을 그대로 넘긴다.
<div id="settings-api-keys"><ApiKeysCard canManage={isAdmin}/></div>
```

붙이기 전에는 키를 `POST /api/api-keys`(같은 출처, 세션)로 만든다. 기능표(`lib/feature-status.ts`) 'MCP 서버·API 키' 줄은 스위치 상태를 따른다.

## 2. 연결 방법

엔드포인트: `https://<호스트>/api/mcp`. 인증: `Authorization: Bearer ck_…`.

### Claude Code

```bash
claude mcp add --transport http collective https://<호스트>/api/mcp --header "Authorization: Bearer ck_..."
```

### Claude Desktop

설정 → 개발자 → 구성 편집(`claude_desktop_config.json`)에 원격 서버를 넣는다. 헤더를 직접 넣는 원격 연결을 지원하지 않는 판은 `mcp-remote`를 쓴다.

```json
{"mcpServers":{"collective":{"command":"npx","args":["mcp-remote","https://<호스트>/api/mcp","--header","Authorization: Bearer ${COLLECTIVE_KEY}"],"env":{"COLLECTIVE_KEY":"ck_..."}}}}
```

### ChatGPT 커넥터

ChatGPT 설정 → 커넥터(개발자 모드) → 사용자 지정 커넥터 추가에 서버 주소 `https://<호스트>/api/mcp`를 넣고, 인증을 'API 키/Bearer'로 골라 `ck_…`를 넣는다. OAuth는 이 판에서 제공하지 않는다(커넥터가 OAuth만 받는 계정은 연결할 수 없다).

### 배포 경로 주의

운영 사이트가 로그인 디스패처(Sites) 뒤에 있으면 외부 AI 도구의 요청이 앱에 닿기 전에 막힐 수 있다. 이 PR은 앱 쪽만 구현했다. 실제 외부 연결(Claude/ChatGPT에서 real 1건)은 게시 담당이 스위치를 켜고 경로를 확인한 뒤 한다.

## 3. 프로토콜

| 항목 | 동작 |
|---|---|
| 메서드 | `initialize`(protocolVersion `2025-06-18`, 요청한 판이 `2025-03-26`·`2024-11-05`면 그 판으로 답함, serverInfo `{name:'collective', version:<APP_BUILD>}`, capabilities `{tools:{listChanged:false}}`), `ping`, `tools/list`, `tools/call` |
| 알림 | id 없는 요청(`notifications/initialized` 등)과 클라이언트 응답은 202 빈 본문 |
| GET·DELETE 등 | 405 `Allow: POST`(SSE 스트림·세션 종료 없음) |
| 묶음(batch) | 배열 요청은 -32600(HTTP 400) |
| `MCP-Protocol-Version` 헤더 | 없으면 받는다. 있으면 위 세 판 중 하나여야 하고 아니면 400 |
| Origin | 다른 출처의 브라우저 Origin은 403(DNS 리바인딩 방지). Origin 없는 서버 간 호출은 받는다 |
| 본문 | 1MB 초과 413 |
| 오류 코드 | -32700 JSON 아님 · -32600 잘못된 요청 · -32601 모르는 메서드 · -32602 모르는 도구·인자 오류 · -32603 내부 오류(내부 정보 없음) · -32001 인증(401) · -32029 빈도 제한(429) |
| 도구 업무 오류 | 결과 `isError:true` + 한국어 문장(없음·충돌·자율성 금지·범위 밖) |

## 4. 도구

모든 도구는 키를 만든 워크스페이스(소유자) 범위만 읽고 쓴다. 결과는 `content:[{type:'text',text:<JSON>}]`와 같은 값의 `structuredContent`다.

| 도구 | 범위 | 하는 일 |
|---|---|---|
| `list_brands` | read | 브랜드 id·이름·업종·소개 |
| `list_campaigns` | read | 캠페인 목록(`status` draft·review·revision·approved, `brandId`, `includeArchived`) |
| `get_campaign` | read | 브리프 요약(목표·대상·채널·상품·제약·기간·예산)·상태·현재 작업물 제목/상태·이전 판 수 |
| `list_artifacts` | read | 캠페인의 작업물(담당·제목·상태·판·작성 출처), `includeOutdated` |
| `get_artifact` | read | 작업물 본문(4만 자까지) + 작성 출처 라벨(직접 등록·AI 작성·AI 작성 · 사람 수정) + AI 표시 안내 |
| `get_performance` | read | 기록된 기간별 성과(매출·광고비·주문·공헌이익·순이익·ROAS·CPA)와 합계, 홀드아웃 증분 결과(관찰 비교이며 인과 증명이 아님) |
| `get_agenda` | read | 오늘의 안건 건수(종류·탭)와 항목 제목(최대 50개) |
| `list_learning_rules` | read | 활성·만료 전 학습 규칙(`brandId`) |
| `create_campaign_draft` | draft | 브랜드·제목·목표로 캠페인 초안(status draft, v1) 저장. 자율성 규칙 `brief_draft`가 금지면 거부 |
| `add_artifact_draft` | draft | 캠페인에 작업물 초안을 검토 대기(`review`, origin `manual` = '직접 등록', `via:'api'`)로 등록 |

초안 도구는 기존 저장 경로(`save_campaign` 새 캠페인, `save_artifact` 새 작업물)와 같은 모양으로 저장하고 같은 이벤트 문구를 남긴다(행위자 `api_key:<키 id>`). 진행 중인 AI 작업이 있는 캠페인에는 등록하지 않는다(409). AI 실행은 시작하지 않는다.

## 5. API로 절대 할 수 없는 것

승인(작업물·발행·광고), 발행 접수·게시, 광고 활성화·예산 변경·지출, 고객 메시지 발송, AI 팀 실행·회의 시작·조사 실행, 브랜드·기존 캠페인·기존 작업물 수정·삭제, 연결 설정·기능 스위치·자율성 규칙 변경, 키 만들기·취소. 이 도구들은 목록에 없고, 이름을 불러도 -32602(모르는 도구)다.

## 6. 키·범위·한도

| 항목 | 값 |
|---|---|
| 형식 | `ck_` + 16진 64자(난수 32바이트). 만들 때 한 번만 응답에 온다 |
| 저장 | `records` kind `api_key`, 행 id `api_key:<SHA-256>`. 라벨·범위·접두어 `ck_`·끝 4자·만든 사람 id와 역할·만료·취소·마지막 사용 시각만. 원문은 어디에도 저장·기록하지 않는다 |
| 확인 | 모양 검사 → 해시 PK 조회 → 저장 id와 상수 시간 비교 → 만료·취소. 실패는 모두 같은 401 |
| 범위 | `read`(읽기 도구 8개) · `draft`(읽기 + 초안 도구 2개). read 키가 초안 도구를 부르면 `isError:true` |
| 만료 | 기본 90일, 1~365일(화면 선택 30·90·180·365일) |
| 개수 | 사용 중인 키 소유자당 20개 |
| 빈도 | 키당 1분 60회(`auth_rate_limits`). 넘으면 429 `Retry-After: 60` |
| 만들기 쓰기 빈도 | `execution_rate` `api_keys` 60회/분, 소유자 변경 잠금 |
| 권한 | 대표·관리자만 목록·만들기·취소(직원 403). 키는 만든 사람의 역할로 오늘의 안건을 읽는다 |
| 마지막 사용 | 1분에 한 번만 갱신 |

## 7. 취소·스위치

- 취소: 카드의 '○○ 키 취소'(확인 대화상자) 또는 `POST /api/api-keys {action:'revoke',id}`. 다음 요청부터 401이다. 스위치가 꺼져 있어도 취소·목록은 된다.
- 스위치 `mcp_server`를 끄면 그 소유자의 키로 오는 모든 요청이 404다(키 없는 요청은 소유자를 알 수 없어 401). 만들기는 409다.
- 만든 사람이 계정에서 빠져도 키는 남는다. 사람을 내보낼 때 그 사람이 만든 키를 함께 취소한다.

## 8. 감사

`tools/call`마다 `records` kind `api_call` 1행: `id`·`keyId`·`tool`·`ok`·`error`(tool_error·scope_denied·invalid_params·unknown_tool·internal)·`at`. 입력 인자와 결과 본문은 남기지 않는다. `initialize`·`ping`·`tools/list`는 남기지 않는다. 이 판은 감사 행 보존 기간 정리를 하지 않는다(후속).

## 9. 검증

- `node --experimental-vm-modules tests/api-keys.test.mjs`, `tests/mcp-server.test.mjs` — 메모리 SQLite·로컬 인증 헤더(mocked).
- 로컬 서버(`E2E_PORT=8835 node e2e/serve.mjs`)에서 스위치를 켜고 키를 만든 뒤 curl로 `initialize`·`tools/list`·`tools/call list_brands`를 확인했다(실제 로컬 wrangler·로컬 D1, 인증 헤더 모의). Claude·ChatGPT에서의 real 연결은 아직이다.
