# 카피 팩 v2 (A3)

결론: 콘텐츠 역할이 게시 카피를 문단 대신 구조화한 팩으로 낸다. 채널당 서로 다른 카피 3~5안, 숏폼 장면 배열, 제안 실험이다. A3-1은 이 출력 계약(`role-output-v2`)과 결정론 채점기 `copy_pack_variants`를 더한다. 기능 스위치 `a3_copy_pack`(기본 꺼짐)이 켜진 소유자의 콘텐츠 역할 단독 실행만 v2 계약을 쓴다. 스위치가 꺼져 있으면 모든 역할의 제출·입력·inputHash·저장이 이전과 바이트 동일하다.

비유: 지금 콘텐츠 담당은 광고 문안을 편지 한 통으로 보낸다. 편지 안에서 안 A·B·C를 찾아 오려 쓰는 일은 받는 쪽 몫이었다. 카피 팩은 같은 편지에 칸이 나뉜 주문서를 동봉하는 것이다. 편지(섹션 본문)는 그대로 읽을 수 있고, 주문서(팩)는 기계가 칸마다 바로 읽는다. 주문서 칸이 틀려도 편지는 받아 두고 틀린 칸만 표시한다.

- 코드: `lib/copy-pack.ts`(순수: 검증·렌더·지시 문장), `lib/role-output.ts`(v2 계약·소프트 검증·렌더), `lib/role-instruction.ts`(`outputProfile`), `lib/role-execution.ts`(스위치·저장), `lib/graders/copy-pack.ts`(채점기)
- 테스트: `tests/copy-pack.test.mjs`(순수), `tests/copy-pack-runtime.test.mjs`(모의 HERMES). 모두 합성 데이터, `passed · mocked`
- 채점 정의: [평가 하네스](EVAL.ko.md) 정의표의 `copy_pack_variants`, 채점 버전 `+copy-pack`

## A3 계획 (PR 4개)

| PR | 범위 | 스위치 | 비고 |
|---|---|---|---|
| A3-1 | 카피 팩 v2 출력 계약·소프트 검증·작업물 저장, 채점기 `copy_pack_variants` | `a3_copy_pack` | 이 문서. 게시 보류 중이라 운영 반영은 다음 묶음이다 |
| A3-2 | `brand_voice` 원장: records kind `brand_voice`, 관리자 확정, content·creative 입력 주입 | `a3_brand_voice` | 확정 권한은 대표·관리자, 직원은 403 |
| A3-3 | 작업물→실험 경로(`create_experiment_from_artifact`), 카피 팩을 게시 캡션 소스로 | — | 팩의 `experiments`·안 id를 실험 대조·실험안으로 옮긴다 |
| A3-4 | 회의 개선본의 카피 팩, 골든 v2 케이스, 종료 조건 run | — | 게시 뒤 평가 run으로 종료 조건을 잰다 |

## 적용한 대표 결정 (위임 권고안)

1. A3-1·A3-2는 트랙 R R3보다 먼저 병합해도 된다. 공유 줄(`GRADERS_VERSION`·`docs/STATUS.md` 등)은 뒤에 병합하는 쪽이 rebase해 이어 붙인다.
2. `brand_voice` 확정 권한은 대표·관리자다. 직원은 403이다(A3-2).
3. 보이스는 content·creative 입력에 주입한다(A3-2).
4. 채널은 1~4개, 채널당 카피는 3~5안이다.
5. 팩 형식 오류는 soft다. 작업물은 저장하고 문제만 표시한다.
6. 게시 묶음은 게시가 다시 열린 뒤 정한다.
7. 실험 지표는 바이럴 3지표(`share_rate`·`completion_rate`·`click_rate`)만 쓴다.

## A3-1 데이터 계약

모델 원문(v2):

```json
{"contractVersion": "role-output-v2", "role": "content",
 "sections": [{"id": "output_1", "content": "채널별 용도·선택 이유"}, {"id": "output_2", "content": "편집 메모"},
              {"id": "output_3", "content": "랜딩 문안"}, {"id": "output_4", "content": "실험 선택 이유"}],
 "copyPack": {"version": "copy-pack-v2",
  "channels": [{"channel": "Instagram 피드", "purpose": "첫 방문 유도", "destination": "네이버 플레이스", "variants": [
    {"id": "A", "angle": "…", "hook": "…", "body": "…", "cta": "…", "needsCheck": ["가격"]}, {"id": "B"}, {"id": "C"}]}],
  "shortform": {"channel": "Instagram 릴스", "durationSec": 15,
   "scenes": [{"start": 0, "end": 3, "visual": "…", "line": "…", "caption": "…", "sound": "…", "transition": "컷"}]},
  "experiments": [{"title": "…", "channel": "Instagram 피드", "hypothesis": "…", "variable": "훅", "control": "A", "treatment": "B",
   "fixed": "본문·CTA·게시 시각", "metric": "click_rate"}]}}
```

- 섹션 4개와 제목은 v1과 같다(`lib/practice.ts` content `outputs`, 코드 소유). 섹션 검사도 v1과 같아서 섹션 누락·빈 섹션·재질문·계약 버전 불일치는 지금처럼 `invalid_output`이다.
- `needsCheck`는 선택 필드다. A6(자료 요청)가 읽을 자리다.
- 계약: `roleOutputContract('content',{copyPack:true})` → `{version:'role-output-v2', role, sections, copyPack:'copy-pack-v2'}`. 다른 역할이나 `copyPack` 없이 부르면 v1 계약이며 키 순서까지 이전과 같다.
- 지시: `RoleRequest.outputProfile='copy-pack-v2'`일 때만 JSON 형식에 팩 스키마를, 계약 지시 끝에 팩 규칙 문장(`copyPackInstruction`)을 덧붙인다. 규칙 문장은 섹션 본문을 짧게 쓰라고 한다(아래 '남은 위험'의 출력 상한).
- 레지스트리 본문은 `copyPack`(띄어쓰기 변형 포함)을 쓸 수 없다(`lib/prompt-units.ts` 코드 소유 표지 `copypack`).

## 검증 규칙 (`parseCopyPack`, soft)

| 대상 | 규칙 | 위반 코드 |
|---|---|---|
| 팩 | 객체이고 `version`이 `copy-pack-v2` | `copy_pack_missing`, `copy_pack_version` |
| 채널 | 1~4개, 이름이 있음 | `channel_count`, `channel_name` |
| 안 | 채널당 서로 다른 안 3~5개. 훅+본문을 NFKC·소문자로 바꾸고 공백·문장부호·기호를 뺀 값이 같으면 1안 | `variants_too_few`, `variants_too_many` |
| 안 id | 채널 안에서 비어 있지 않고 겹치지 않음 | `variant_id_duplicate` |
| 길이 | 훅 1~120자, 본문 1~1,200자, CTA 1~60자 | `hook_length`, `body_length`, `cta_length` |
| CTA | 하나(줄바꿈 없음) | `cta_single` |
| 숏폼 | 있음, `durationSec` 6~60 정수, 장면 3~10개 | `shortform_missing`, `shortform_duration`, `scene_count` |
| 장면 타임라인 | 0초에 시작, 앞 장면 끝 = 다음 장면 시작(빈틈·겹침 없음), 시작 < 끝, 마지막 끝 = `durationSec` | `scene_timeline` |
| 실험 | 1~3개, 제목·가설·바꿀 요소가 있음, 채널이 팩 채널, 대조·실험안이 그 채널의 서로 다른 안 id, 지표가 `learningMetrics` 키 | `experiment_count`, `experiment_fields`, `experiment_channel`, `experiment_arm`, `experiment_metric` |
| 브리프 채널 | 브리프 채널(쉼표·빗금·가운뎃점·줄바꿈으로 나눔)이 팩 채널 이름에 있음 | `brief_channel_missing`(경고) |

- 위 규칙 위반은 level `error`, 브리프 채널 누락만 `warn`이다. 매장 안내처럼 카피 팩 밖 채널도 있어서다.
- 읽을 수 있으면 규칙을 어겨도 팩을 돌려준다. 알려진 필드만 새 객체로 옮기고(입력 불변), 목록은 12개·문자열은 2,000자로 자른다(위반은 자르기 전에 센다).

## 렌더와 저장

- 렌더: 팩 렌더본을 계약 섹션 본문 앞에 넣는다. output_1에는 채널별 `### 채널 · 용도 · 목적지`와 안마다 `#### 카피 안 A · 각도 · 확인 필요: …` 제목, 그 아래 목록 줄(훅·본문·CTA)을 넣는다. output_2에는 장면표(구간·화면·대사·자막·소리·전환), output_4에는 제안 실험 목록을 넣는다. output_3(랜딩)은 팩이 없다.
- 그래서 게시 캡션 후보(`lib/execution.ts` `copyBlocks`)가 안마다 한 덩어리가 되고, 확인 필요 항목은 제목에만 있어 캡션에 섞이지 않는다. 사실·규제 채점기와 `unverifiedClaims`도 팩 문장을 그대로 본다(라벨 '카피'가 카피 구역이다).
- 저장(`lib/role-execution.ts` poll): v2 계약이면 작업물에 `copyPack`, `copyPackArtifactVersion: 1`, 문제가 있으면 `copyPackIssues`(level·code·message)를 남긴다. error 문제가 있으면 캠페인 이벤트를 하나 남긴다. 작업물은 저장하고 사용량 결과는 `completed`다(`invalid_output` 아님).
- `copyPackArtifactVersion`은 팩을 만든 작업물 판이다. 사람이 고친 판(2 이상)과 다르면 팩은 옛 판의 것이다. A3-3이 캡션 소스로 쓸 때 이 값을 대조한다.
- 타입: `lib/agency.ts`의 `Artifact`는 바꾸지 않았다. `CopyPackArtifact = Artifact & {copyPack?, copyPackArtifactVersion?, copyPackIssues?}`(`lib/copy-pack.ts`)를 쓴다.

## 스위치와 요청 경로

- `roleRequestWithRules`(`lib/role-execution.ts`)가 콘텐츠 역할일 때만 스위치를 읽고, 켜져 있으면 요청에 `outputProfile:'copy-pack-v2'`를 넣는다. 꺼져 있으면 키가 없다.
- 운영 start 분기, 평가 케이스 캡처(`lib/eval-server.ts` `roleRequestFor`), 합성 생성기(`scripts/eval/synthesize.mjs`)가 같은 경로를 쓴다. 스위치가 켜진 소유자가 캡처한 콘텐츠 케이스는 `outputProfile`을 동결하고 v2로 제출된다. 생성기의 모의 DB는 스위치가 꺼져 있어 생성 결과가 그대로다.
- inputHash의 `outputContractVersion`은 요청 계약의 버전이다. 스위치를 켜면 콘텐츠 작업 id가 달라지고, 꺼져 있으면 `role-output-v1`로 이전과 같다.
- 뒤 역할(그로스·데이터·품질)은 스위치와 무관하게 v1 계약이다. 입력의 앞선 콘텐츠 작업물 본문에는 팩 렌더본이 들어 있다.

## 채점기 `copy_pack_variants`

- 원문 JSON이 `role-output-v2`일 때만 적용한다. 팩이 없거나 형식 오류, error 문제가 있으면 fail, 아니면 pass(상세: 채널·안·장면·실험 수)다. v1 원문과 저장 본문만 있는 항목은 `not_applicable`이다.
- 내용 채점기라 `question_only` fail이면 `not_applicable`이다. 검토 사유 매핑은 `execution`(제작·실행)이다.
- 채점기는 원문의 계약 버전으로 렌더한다(`rawOutputContract`). v2 원문은 운영과 같은 팩 렌더본으로 나머지 13종도 채점한다.

## 남은 위험

- 출력 상한: 콘텐츠 `maxTokens`는 10,000이다(`lib/practice.ts`, 이 PR은 바꾸지 않음). 팩까지 쓰면 잘릴 수 있다. 지시는 섹션 본문을 짧게 쓰게 한다. 상한 조정은 실측(A3-4 run) 뒤 정한다. 조정하면 `lib/role-execution.ts`에서 v2일 때만 올린다.
- 온라인 채점(`lib/online-grading.ts`)은 저장 본문만 보므로 `copy_pack_variants`가 늘 `not_applicable`이다. 운영의 팩 문제는 작업물 `copyPackIssues`로 본다.
- 평가 항목은 요청 계약을 모른다. v2로 요청했는데 모델이 v1로 답하면 운영은 거부하지만 채점기는 v1로 채점한다. A3-4 골든 v2 케이스에서 기대 계약을 둔다.
- 평가 케이스의 `capturedWith.outputContractVersion`은 코드 상수(`role-output-v1`)라 v2로 캡처한 케이스도 v1로 적힌다(`lib/eval-server.ts`, 트랙 R 소유라 고치지 않음). 동결 요청의 `outputProfile`로 구분한다.
- 사람이 작업물을 고치면(판 2 이상) 팩은 갱신되지 않는다. 화면 표시는 아직 없다(렌더본이 본문에 있다).
