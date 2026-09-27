# 역할·회의·브리프 입력 축소 (PR 4b · `ai-quality-9`·`loop-10`)

결론: 스위치 `input_diet`(기본 꺼짐)가 켜진 워크스페이스는 역할·회의·브리프 입력에서 반복 전송되는 데이터를 줄인다. 캠페인 메타 제거, 선행 작업물 섹션별 예산(모든 섹션 포함), 회의 단계별 작업물 축소, 브랜드 자료 역할별 요약(digest), 입력 상한이다. 지시문과 확정 사실·근거 규율·출력 계약은 그대로다. 꺼져 있으면 제출 바이트가 이전과 같다. 켜기 전에 레인 Q의 쌍 평가(봉인 포함)가 필요하다.

비유: 매 회의마다 두꺼운 서류철 전체를 다시 복사해 돌리던 것을, 요약본과 해당 담당에게 필요한 장만 넣은 얇은 철로 바꾼다. 확정된 계약서(확정 사실)와 업무 규칙(지시문)은 빼지 않는다. 철이 너무 두꺼우면 참고 자료부터 빼고 "몇 장 뺐음"을 표지에 적는다.

- 감사 원문: `ai-quality-9`(실행당 약 20k 입력 토큰 대부분이 데이터 재전송) 권고 ①~④, `loop-10`(아카이브 digest·역할별 카테고리·입력 상한).
- 설계 근거: B5 맥락 정책 리플레이(#64). 정책 P1 메타 제거·P2 섹션별 예산·P3 회의 단계별 축소·P4 아카이브 카테고리 선택을 운영 조립에 옮겼다. B5 문서와 코드(`docs/CONTEXT-REPLAY.ko.md`, `lib/context-policies.ts`)는 #65 병합 때 main에서 빠졌다. `git show 1fc49be:docs/CONTEXT-REPLAY.ko.md`로 읽는다.

## 무엇이 바뀌나 (켜짐만)

| 권고 | 경로 | 변경 | 구현 |
|---|---|---|---|
| ② 캠페인 메타 | 역할·회의 `campaign` | `draftMeta`(plan 사본·가정·질문·사용 맥락)·`status`·`derivedStatus`·`statusReason`·`createdAt`·`updatedAt`·`budgetConfirmedAt`을 뺀다. 예산 표시(`budget`·`budgetStatus`)는 원 레코드로 계산해 그대로다 | `lib/input-diet.ts` `dietCampaign` |
| ② 중복 | 역할 `task.deliverable` | 지시문의 '담당 결과물'과 같은 문장이라 뺀다 | `lib/role-instruction.ts` |
| ③ 선행 작업물 | 역할 `previous`(6,000자, 품질 24,000자) | 앞부분 절단 대신 같은 총량을 섹션에 나눈다(물 채우기: 짧은 섹션은 그대로, 남은 예산을 긴 섹션에 고르게, 섹션당 최소 300자). 모든 섹션 제목과 마지막 섹션(추가 자료 요청·산식·적용 규칙)까지 실린다. `excerpt`·`contextTruncated` 판정은 같다 | `sectionExcerpt`, `lib/role-output.ts` `upstreamContext`의 `excerptOf` 인자 |
| ④ 회의 의견 교환 | `originalArtifacts` | 첫 본문 섹션(요약, 1,000자)과 역할 계약의 인계 섹션(cmo·insight `output_3`, data `output_4`, 1,500자)만 본문을 남기고 나머지 섹션은 제목 줄만 | `discussionDigest` |
| ④ 회의 합의·개선 | `originalArtifacts` | 8,000자 앞부분 절단 대신 섹션별 예산 | `meetingOriginal` |
| ④ 회의 품질 재검토 | `originalArtifacts`·`completedRevisions`·`candidateArtifacts` | 원본은 `{ref,id,role,version,length}`만, 개선본 본문은 `candidateArtifacts`에만(`completedRevisions`는 제목·변경 위치만). 같은 본문이 두 번 들어가지 않는다. 후보 본문 24,000자 한도도 섹션별 예산 | `meetingOriginal`, `lib/meeting-input.ts` |
| loop-10 digest | 세 경로 `brandArchive` | 확정 자료 본문을 앞 800자 요약(문장 경계, `excerpt:true`)으로 바꾸고, 역할(회의는 단계 역할)에 필요한 카테고리만 싣는다(B5 표, 미분류는 모든 역할, 품질은 전체). 채널·성과 카테고리가 없는 역할은 채널 관찰을 뺀다. 뺀 수는 `omittedSources`·`omittedObservations`에 더한다. 브리프는 카테고리를 거르지 않는다 | `archiveDigest` |
| loop-10 상한 | 세 경로 | 조립 뒤 추정 토큰(`estimateInputTokens`와 같은 식)이 역할·브리프 32,000, 회의 64,000(`lib/graders/ledger.ts`와 같은 값)을 넘으면 브랜드 자료를 뒤에서부터, 그다음 채널 관찰을 빼고 `brandArchive.inputCapOmitted:{sources,observations}`로 표시한다. 사실·과제·작업물은 빼지 않는다. 다 빼도 넘으면 그대로 보낸다 | `capInput` |

바꾸지 않는 것: 지시문 전체(근거 규율·사실 정책·출력 계약·품질 계약), `evidence`(확정·거절·후보 사실, 상시 지시), `factPolicy`, `learning`·운영자 선호 블록, 가림 경로와 허용 값(`docs/INPUT-MINIMIZATION.ko.md`. 축소는 가림 전에 하고 가림은 그대로 적용한다), 지점 맥락(`storeMarketing`).

## 스위치와 조립 인자

- 스위치 읽기: `lib/input-diet-server.ts` `inputDietEnabled`(읽기 실패는 꺼짐). 실행기는 feature-flags를 직접 import하지 않는다(구조 규칙).
- 역할: `roleSubmission(request, {inputDiet})`·`buildRoleInputMasked(r, {inputDiet})`. 운영 start가 스위치 상태를 넘긴다. 역할 `inputHash`에 켜짐일 때만 `inputDiet` 버전이 들어간다(꺼짐은 이전과 같다).
- 회의: 시작 때 스위치를 한 번 읽어 `snapshot.inputDiet`에 고정한다. 단계 제출은 `buildMeetingSubmission(m, stepId, storeAllow, {inputDiet: !!m.snapshot.inputDiet})`. 회의 중간에 스위치를 바꿔도 그 회의는 같은 조립을 쓴다.
- 브리프: `buildBriefSubmission(request, {inputDiet})`. 운영 start가 스위치 상태를 넘긴다.
- 평가(레인 Q): 평가 파일(`lib/eval-*`)은 고치지 않았다. 세 조립 함수는 인자를 넘기지 않으면 꺼짐이라 평가는 지금처럼 꺼짐으로 돈다. on/off 쌍 평가는 같은 동결 요청에 `{inputDiet:false}`·`{inputDiet:true}`를 넘겨 두 본문을 만든다(운영자 선호 쌍과 같은 방식). 켜진 워크스페이스에서 캡처(`lib/eval-capture.ts`)의 드리프트 판정은 저장 제출(켜짐)과 기본 조립(꺼짐)을 비교하므로 `assembly_drift`로 나온다. 활성화 전에 레인 Q가 캡처에 스위치 상태를 넘기도록 고쳐야 한다.

## 기록

- `inputChars`(①, 스위치와 무관하게 항상): 역할 `role_output_contract.inputChars`, 회의 `team_meeting.steps[].inputChars`, 브리프 `brief_draft.inputChars`. `{total, instructions, byKey}` — 제출 입력 JSON 최상위 키마다 `"키":값` 조각의 문자 수다. 숫자와 형식 검사를 통과한 키 이름만 담고 원문은 없다. 기본 켜짐인 이유: 제출 본문·inputHash·job id를 바꾸지 않고 이미 있는 실행 기록에 숫자만 더한다(전후 비교의 기준선이 켜기 전부터 쌓여야 한다). 회의·브리프는 화면 응답에도 숫자로 보인다.
- `inputDiet`(켜짐만): 같은 세 곳에 `{version:'input-diet-v1', archive:{revision, sources, sourcesOmitted, observations, observationsOmitted, summarized}, cap:{cap, sources, observations}}`.
- 새 records kind 없음. digest는 저장하지 않는다: 가림이 끝난 아카이브(`brandArchiveInput`)에서 조립 때마다 결정론으로 만든다. 같은 revision·같은 자료면 같은 digest이고, revision이나 자료가 바뀌면 새 값으로 만들어 옛 digest를 쓸 수 없다. 소유자 범위 읽기에서 만들므로 다른 소유자 자료가 섞이지 않는다. 저장 캐시를 두면 가림 허용 값(확정 사실)이 revision 없이 바뀌는 경우까지 무효화해야 하고, 계산은 요약 문자열 자르기뿐이라 얻는 것이 없다.

## 합성 캠페인 측정 (mocked)

`tests/input-diet.test.mjs`(합성 브랜드 자료 5건·채널 관찰 1건, 역할마다 6,000자를 넘는 계약 모양 선행 작업물, 초안 메타가 있는 캠페인)를 `INPUT_DIET_TABLE=1`로 돌린 값이다. 같은 요청을 꺼짐·켜짐으로 조립했다. 운영 분포를 대표하지 않는다.

| 역할 | 꺼짐 입력 문자 | 켜짐 입력 문자 | 감소 | 꺼짐 brandArchive | 켜짐 brandArchive | 꺼짐 previous | 켜짐 previous |
|---|---:|---:|---:|---:|---:|---:|---:|
| cmo | 14,063 | 6,664 | 52.6% | 11,709 | 4,665 | 13 | 13 |
| insight | 20,221 | 11,426 | 43.5% | 11,709 | 3,307 | 6,130 | 6,142 |
| strategy | 26,298 | 18,930 | 28.0% | 11,709 | 4,657 | 12,257 | 12,279 |
| creative | 32,455 | 24,074 | 25.8% | 11,709 | 3,657 | 18,385 | 18,417 |
| content | 38,629 | 29,228 | 24.3% | 11,709 | 2,631 | 24,513 | 24,556 |
| growth | 44,740 | 36,419 | 18.6% | 11,709 | 3,673 | 30,642 | 30,704 |
| data | 50,872 | 41,525 | 18.4% | 11,709 | 2,647 | 36,769 | 36,851 |
| quality | 83,833 | 72,054 | 14.1% | 11,709 | 325 | 69,728 | 69,728 |

- `previous`는 총량을 유지하고(섹션 경계·표시 문자만큼 늘어난다) 대신 마지막 섹션까지 싣는다. 줄어드는 몫은 브랜드 자료·캠페인 메타·중복 문장이다.
- 품질 담당은 선행 작업물 7개로 역할 상한을 넘어 입력 상한이 브랜드 자료 5건을 모두 뺐다(`inputCapOmitted.sources: 5`). 꺼짐에서도 같은 입력은 grade 모드 `input_budget`에 걸리는 크기다. 품질 검수에서 자료 요약이 빠지는 영향은 레인 Q 평가로 본다.

## 남은 위험

- 품질 영향은 재지 않았다(`not_run`). 역할별 카테고리 선택(P4)은 자료 분류가 틀리면 필요한 자료를 뺀다. 의견 교환 요약은 인계 섹션이 없는 역할(strategy·creative·content·growth)에서 요약만 남는다. 활성화 전 레인 Q 쌍 평가(봉인 케이스 포함)가 필요하다.
- 운영 입력 문자 수와 절약률은 운영 `inputChars` 기록이 쌓인 뒤 다시 잰다(합성 수치는 계산이 동작함을 보일 뿐이다).
- 추정 토큰은 input만 센다. HERMES 에이전트 자체 지시·도구 호출은 빠진다.
