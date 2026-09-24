# 캠페인 상태: 저장값과 파생 상태

화면의 캠페인 상태는 저장된 `campaign.status`가 아니라 서버가 계산한 **파생 상태**(`derivedStatus`)다. 저장값은 바꾸지 않고 쓰기 기록(캐시)으로 남긴다. 계산은 순수 함수 `deriveCampaignStatus`(`lib/campaign-status.ts`)가 하고, 전이표는 `tests/campaign-status.test.mjs`가 고정한다.

## 왜 파생하는가 (data-truth-8)

저장 `status`는 여러 경로가 마지막에 쓴 값이다. 그래서 실제 진행과 어긋난다.

- 역할 실행·회의·작업물 저장·검토 판정·지점 동기화가 각자 규칙으로 덮어쓴다(`lib/role-execution.ts`, `lib/meeting-execution.ts`, `app/api/action/route.ts`, `app/api/stores/route.ts`).
- 회의가 실패하면 상태를 갱신하지 않는다(완료할 때만 쓴다).
- `ready`·`measuring`은 어디에서도 쓰지 않는다. 발행하거나 성과를 기록해도 상태가 그대로다.
- 운영 관찰: ODA는 회의 `failed`, 연속 실행 `paused`인데 저장값은 `review`였다.

## 상태 정의

| 키 | 라벨 | 조건 |
| --- | --- | --- |
| `running` | AI 작업 중 | 이 캠페인의 AI 작업(역할·회의)이 `starting`·`queued`·`in_progress`·`uncertain`이거나, 회의 기록이 `running`·`uncertain`이다. |
| `blocked` | 진행 막힘 | 현재 브리프 버전의 가장 최근 회의가 `failed`이거나 연속 실행이 `blocked`이고, 그 뒤로 작업물이 새로 작성·판정되지 않았다. |
| `executing` | 발행 진행 | 현재 브리프 버전의 발행이 `accepted`(예약 접수) 또는 `published`(게시 확인)다. |
| `measuring` | 성과 기록 | 성과 기록(`metric`)이 있다. |
| `approved` | 기획 승인 | 현재 작업물(`outdated` 제외)이 모두 `approved`이고 품질 검수 작업물을 포함한다. 저장값을 `approved`로 쓰는 승인 흐름과 같은 규칙이다. |
| `revision` | 수정 요청 | 보완 필요 작업물이 있거나(수정 요청 + 쓸 수 없는 검토 대기: 재질문·빈 본문·이전 브리프 버전), 쓸 수 있는 품질 검수 판정이 `ready_for_review`가 아니다. |
| `review` | 검토 대기 | 검토 필요 작업물(쓸 수 있는 `review`)이 있다. |
| `ready` | 실행 준비 | 검토할 것이 없다. 작업물이 없으면 브리프 빈칸(예산 상한·시작일·종료일)이 없고, 작업물이 있으면 남은 담당자 실행이나 품질 검수를 기다린다. |
| `draft` | 브리프 작성 | 작업물이 없고 브리프에 빈칸이 있다. |

검토 필요·보완 필요는 대시보드와 같은 정의다(data-truth-9, `lib/workspace-metrics.ts`의 `reviewArtifacts`·`needsWorkArtifacts`). 새 어휘는 `blocked`·`executing` 두 개뿐이고 라벨은 `lib/agency.ts` `statuses`에 있다.

보관(ux-9 권고 2, `archivedAt`)은 파생 상태가 아니다. 진행 단계와 따로 표시한다. 보관 캠페인도 위 표대로 진행 단계를 계산한다. 그래서 보관 중에 AI 작업이 돌면 `running`(AI 작업 중)으로 보인다. 보관 여부는 `isArchivedCampaign`(`lib/workspace-metrics.ts`)이 `archivedAt`만 보고 판단한다.

## 우선순위

위에서부터 먼저 맞는 상태가 이긴다.

1. `running`
2. `blocked`
3. `executing` 또는 `measuring`: 둘 다 해당하면 **더 최근 기록**이 이긴다. 발행 → 성과 기록 → 다음 발행 순서를 따르기 위해서다. 같은 시각이면 `measuring`이다.
4. `approved`
5. `revision`
6. `review`
7. `ready`
8. `draft`

### 오래된 기록이 상태를 붙잡지 않게 하는 규칙

- **현재 작업물**은 이 캠페인의 `outdated`가 아닌 작업물이다. **작업물의 마지막 변화**는 현재 작업물의 작성 시각(`createdAt`)과 검토 판정 시각(`reviewedAt`) 중 가장 늦은 값이다.
- 회의 실패·연속 실행 막힘은 마지막 변화보다 **뒤**일 때만 `blocked`다. 실패 뒤에 작업물을 새로 만들거나 판정했으면 사용자가 이어서 진행한 것으로 본다. 이후 회의가 완료되거나 취소돼도 풀린다.
- 발행 접수·성과 기록은 마지막 변화와 **같거나 뒤**일 때만 단계로 본다. 성과를 기록한 뒤 새 작업물이 생기면 새 기획 주기(`review` 등)로 돌아간다.
- 회의·연속 실행·발행은 **현재 브리프 버전**의 기록만 본다. 버전이 없는 이전 기록은 현재 버전으로 본다. 브리프를 고치면(버전 증가) 이전 버전의 실패·발행은 상태에 쓰지 않는다.
- 발행 시각은 `attemptedAt`, 없으면 `updatedAt`·`createdAt` 순이다. 성과 시각은 `updatedAt`이다. `updatedAt`이 없는 이전 성과 기록은 작업물이 없을 때만 `measuring`이 된다.

## 저장값과의 관계

- **저장 `status`와 그 쓰기 경로는 바꾸지 않았다.** 역할 실행·회의 완료·작업물 저장·검토 판정·지점 동기화가 예전처럼 쓴다.
- **서버 로직은 저장값을 그대로 읽는다.** 발행 승인 게이트(`lib/execution.ts` `campaignGateIssues`의 `approved` 검사), 역할 실행 중단 시 되돌릴 값(`stoppedStatus`), 샘플 캠페인 판정(`isSampleCampaign`: 저장 `draft`·v1)은 파생 상태를 쓰지 않는다. 연속 실행·A2 CAS·실행 게이트·승인 흐름도 같다.
- **파생 상태는 저장하지 않는다.** 응답에만 싣고, 읽기만 한다. 두 GET 라우트는 쓰기를 하지 않는다(`tests/campaign-status.test.mjs`가 호출 전후 `records`·`jobs`를 비교한다).
- 파생 상태가 저장값과 다르면 사유 끝에 `(저장값: 검토 대기)`처럼 저장값 라벨을 남긴다.

## API 응답

| 응답 | 추가 필드 | 비고 |
| --- | --- | --- |
| `GET /api/workspace` | `campaigns[].derivedStatus`, `campaigns[].statusReason` | `campaigns[].status`는 저장값 그대로(기존 클라이언트 호환). 보관 표시(`archivedAt`·`archivedBy`)는 레코드 필드 그대로 실린다. |
| `GET /api/campaigns/[id]` | `campaign.derivedStatus`, `campaign.statusReason` | 워크스페이스 응답과 같은 계산(`withDerivedStatus`). |

회의·발행은 `records.data`에서 필요한 필드만 읽는다(`statusRecordsQuery`). 회의 스냅샷 같은 큰 본문은 풀지 않는다. 스키마 migration은 없다.

## 화면

- 상태 배지: `CampaignStatus`(`app/panels.tsx`)가 `derivedStatus`를 보이고 사유를 툴팁(`title`)으로 붙인다. 캠페인 상세 시트와 캠페인 표(`app/workspace.tsx` `CampaignTable`: 대시보드 '진행 중인 캠페인' 표와 캠페인 목록) 모두 이 배지를 쓴다. 응답에 파생 상태가 없으면 저장값을 쓴다(`campaignStatus`, `lib/workspace-metrics.ts`). 보관 캠페인은 진행 배지 옆에 '보관됨' 배지를 함께 보인다.
- WebMCP 캠페인 조회 도구(`list_campaigns`)도 `derivedStatus`를 돌려준다(없으면 저장값).
- 대시보드 수치·상태별 수·진행 중 캠페인: `lib/workspace-metrics.ts`가 화면 상태(`campaignStatus`) 기준으로 센다. 진행 중에서 빼는 종료 상태는 `approved`·`executing`·`measuring`이다. `blocked`는 진행 중이다.
- 보관 캠페인은 전체 수·진행 중 수·상태별 수·검토 필요/보완 필요 수·다음 할 일에서 빠지고 `archivedCampaigns`로만 센다. 작업물 목록과 브랜드 카드의 캠페인 수도 보관 캠페인을 뺀다(사이드바 '작업물' 수와 같은 기준).

## 알려진 한계

- 역할 실행 실패만으로는 `blocked`가 아니다. 연속 실행 중이면 연속 실행이 막혀 `blocked`가 되고, 아니면 대시보드 ‘다음 할 일’의 실패한 실행으로 보인다.
- 회의 완료 때의 `invalidatedRoles`는 보지 않는다. 품질 검수 판정이 `ready_for_review`가 아니면 `revision`이 되는 규칙으로 대부분 같은 결과가 된다.
- `blocked`·`executing` 배지 전용 색은 없다(`app/globals.css` 기본 `.status` 색).
- 보관 중 새 AI 실행 차단(역할 실행 `POST /api/run` start, 팀 회의 `POST /api/meetings` start·retry_failed, 캠페인 HERMES 초안 `POST /api/brief` start + `campaignId`)은 라우트의 **잠금 밖 사전 검사**다(`assertCampaignNotArchived`, `lib/campaign-archive.ts`). 보관 요청과 동시에 들어온 시작 1건은 검사를 통과한 뒤 보관된 캠페인에서 작업을 만들 수 있다. 보관은 잠금 안에서 진행 중 작업을 확인하지만, 그 시점에는 아직 작업이 없기 때문이다. 이렇게 되면 파생 상태는 `running`(AI 작업 중)으로 보이지만 보관 캠페인이라 대시보드에서는 빠진다. 완전한 차단에는 `lib/role-execution.ts` start 분기, `lib/meeting-execution.ts` start·retry_failed 분기, `lib/brief-execution.ts` start(`campaignId`) 분기의 잠금 안(캠페인을 읽은 직후)에 `assertNotArchived(c)` 한 줄이 필요하다. 이 파일들은 다른 레인 소유라 이번 PR에서 고치지 않았다(후속 과제).
- 연속 실행 시작·진행과 발행 승인·접수의 보관 검사는 잠금 안에서 한다(`lib/campaign-sequence.ts`, `lib/execution-server.ts`). 이 경로에는 위 경합이 없다.
