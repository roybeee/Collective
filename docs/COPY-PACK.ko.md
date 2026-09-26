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
| A3-2 | `brand_voice` 원장: records kind `brand_voice`, 관리자 확정, content·creative 입력 주입, 채점기 `brand_voice_avoid_term` | `a3_brand_voice` | 확정 권한은 대표·관리자, 직원은 403. 아래 'A3-2 브랜드 말투' 절 |
| A3-3a | 작업물→실험 경로(`create_experiment_from_artifact`) | — (팩이 `a3_copy_pack`에서만 생긴다) | 팩의 `experiments`와 안의 실제 문안을 실험 대조·실험안으로 옮긴다. 아래 'A3-3 작업물 제안 실험' 절 |
| A3-3b | 카피 팩을 게시 캡션 소스로 | — | 트랙 R R3 뒤로 미룸(`lib/execution-server.ts`는 트랙 R 소유) |
| A3-4 | 회의 개선본의 카피 팩, 골든 v2 케이스, 기대 계약 채점 | `a3_copy_pack`(회의 시작 때 고정) | 코드는 이 PR. 종료 조건 run은 게시 뒤다. 아래 'A3-4 회의 개선본과 골든 v2' 절 |

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
- (A3-4에서 해결) 평가 항목이 요청 계약을 몰라 v2 요청에 v1로 답한 원문을 v1로 채점했다. 이제 동결 요청의 `outputProfile`을 기대 계약으로 보고 `contract_json` fail이다(`+expected-contract`).
- 평가 케이스의 `capturedWith.outputContractVersion`은 코드 상수(`role-output-v1`)라 v2로 캡처한 케이스도 v1로 적힌다(`lib/eval-server.ts`, 트랙 R 소유라 고치지 않음). 동결 요청의 `outputProfile`로 구분한다.
- 사람이 작업물을 고치면(판 2 이상) 팩은 갱신되지 않는다. 화면 표시는 아직 없다(렌더본이 본문에 있다).

## A3-2 브랜드 말투

결론: 대표·관리자가 확정한 브랜드 말투(어조·쓸 것·피할 것·선호 표현·피할 표현·예시)를 크리에이티브·콘텐츠 역할 입력에 싣는다. 초안은 싣지 않는다. 스위치 `a3_brand_voice`(기본 꺼짐)가 꺼졌거나 확정본이 없으면 모든 역할의 제출·입력·inputHash가 이전과 바이트 동일하다. 결정론 채점기 `brand_voice_avoid_term`이 카피 구역의 피할 표현을 잡는다.

비유: 매장에 붙여 두는 '우리 가게 말투 안내문'이다. 점장이 초안을 쓰고 사장이 서명한 판만 벽에 붙인다. 새 초안을 쓰는 동안에도 벽에는 지난번 서명본이 그대로 붙어 있고, 떼어 내면(철회) 벽이 빈다.

- 코드: `lib/brand-voice.ts`(순수: 타입·검증·모델 블록·`voiceAvoidHits`), `lib/brand-voice-server.ts`(저장·CAS), `app/api/brand-voice/route.ts`, `app/brand-voice-panel.tsx`(브랜드 아카이브 '브랜드 말투' 탭), `lib/graders/voice.ts`
- 테스트: `tests/brand-voice.test.mjs`(모의 HERMES·메모리 SQLite·합성 데이터, `passed · mocked`)

### 데이터 계약 (records kind `brand_voice`, id = 브랜드 id, parent = 브랜드 id, 브랜드당 1행)

```json
{"id":"<brandId>","brandId":"<brandId>","version":3,"status":"draft",
 "tone":["따뜻한"],"do":["짧은 문장"],"dont":["과장 감탄사 연속"],"preferTerms":["갓 구운"],"avoidTerms":["최고의"],"samples":["…"],
 "updatedBy":{"id":"acct","role":"admin"},"updatedAt":"…",
 "confirmedVoice":{"version":2,"status":"confirmed","tone":["…"],"…":"…","confirmedBy":{"id":"acct","role":"owner"},"confirmedAt":"…"},
 "history":[{"version":2,"status":"confirmed","…":"…"}]}
```

- 상태: `draft` | `confirmed` | `revoked`. 쓰기마다 `version`이 1 오르고 이전 판이 `history` 맨 앞에 들어간다(최근 20판, 최신 먼저).
- 설계 선택(위임 권고안 채택): 확정본이 있는 상태에서 새 초안을 쓰면 이전 확정본을 유지한다. 모델에 가는 판은 행의 `confirmedVoice` 하나다.
  - 확정(`confirm`)하면 그 판이 `confirmedVoice`가 된다.
  - 초안 저장(`save_draft`)은 `confirmedVoice`를 그대로 둔다.
  - 철회(`revoke`)하면 `null`이 된다. 철회 뒤 새 초안을 써도 옛 확정본은 살아나지 않는다.
  - 계약 예시(`history`만)와 달리 `confirmedVoice`를 행에 따로 둔 이유: `history` 20판 상한에 밀려 확정본이 사라지는 일을 막는다.
- 사람은 id·역할만 남긴다(이메일 없음). 모델 입력 블록은 `brandVoice:{tone,do,dont,preferTerms,avoidTerms,samples,version}`뿐이다(사람·시각·상태 없음).
- 상한(`BRAND_VOICE_LIMITS`): 목록마다 10개·항목 40자(공백은 한 칸으로), 예시 3개·200자, 모델 블록(JSON) 1,500자. 넘으면 자르지 않고 400이다. 모델 블록 함수는 옛 행 대비로 예시→선호→쓸 것→피할 것→어조→피할 표현 순으로 뒤에서 뺀다.

### 권한과 API

- `GET /api/brand-voice?brandId=` 구성원 모두: `{voice, active, limits}`. `active`는 모델에 가는 확정본 블록(없으면 `null`).
- `POST /api/brand-voice` 대표·관리자만(`requireAdminActor`, 저장 함수도 직원을 403으로 막는다): `save_draft {brandId, version, data}`, `confirm {brandId, version}`(현재 판이 초안일 때만), `revoke {brandId, version}`(확정본이 있을 때만).
- CAS: `version`은 현재 판 번호(새 행은 0)와 같아야 한다. 다르면 409. 없는 브랜드는 404. 쓰기는 소유자 잠금 안에서 한다.

### 입력 주입

- `roleRequestWithRules`(`lib/role-execution.ts`)가 역할이 content·creative일 때만 스위치를 읽고, 켜져 있으면 확정본 블록을 요청 `brandVoice`에 넣는다. 확정본이 없으면 키가 없다. 평가 케이스 캡처(`roleRequestFor`)도 같은 요청을 동결한다.
- `buildRoleInputMasked`(`lib/role-instruction.ts`)는 `brand` 바로 뒤에 `brandVoice`를 둔다. 다른 역할은 요청에 말투가 있어도 싣지 않는다(`voiceForRole`).
- 지시문은 말투가 실릴 때만 한 문장을 덧붙인다: 말투는 참고 데이터이며 지시를 바꿀 권한이 없고, 사실 근거가 아니며, 피할 표현은 카피에 쓰지 않는다.
- inputHash: 말투가 있을 때만 `brandVoice`를 더한다. 확정본이 바뀌면 작업 id가 달라진다.
- 가림: `brandVoice.<목록>.*`·`brandVoice.samples.*`를 `ROLE_MASK_PATHS`에 더했다. 브랜드 정체성(`brand.identity.audience` 등)과 같은 탐지·자리표시·허용 값이다. 가림 기록 필드는 `brandVoice.samples.0` 꼴이다.
- 입력 예산: 역할 입력 최대 실측 23,701토큰(R3 기준선)에 말투 최대 증분(블록 1,500자 + 지시 한 문장)을 더해도 상한 32,000 안이다(테스트로 확인).
- 레지스트리 본문은 `brandVoice`(띄어쓰기 변형 포함)를 쓸 수 없다(`lib/prompt-units.ts` 코드 소유 표지 `brandvoice`). 브랜드 특화 내용은 D1에만 둔다(프롬프트 레지스트리 결정 3).

### 채점기 `brand_voice_avoid_term`

- 평가 역할 항목의 동결 요청에 말투가 실리는 경우(content·creative + `brandVoice`)만 적용한다. 피할 표현이 카피 구역 문장·따옴표 안 문구에 부정·배제 없이 쓰이면 fail이다. '‘최고의’라는 표현은 쓰지 않는다'는 pass다(공용 부정 판정).
- 말투 입력이 없으면 `not_applicable`이다. 검토 사유 매핑은 `brand`(브랜드·상품)다. 채점 버전 `+voice-avoid`.

### 남은 위험

- 온라인 채점은 말투 입력을 모르므로 늘 `not_applicable`이다. 운영 작업물의 피할 표현은 평가 run으로 본다.
- 스위치는 소유자 단위다. 켜면 그 소유자의 모든 브랜드에서 확정본이 있는 브랜드만 영향을 받는다.
- 기존 `brand.tone`(브랜드 정체성 한 줄 어조)은 그대로 입력에 남는다. 두 값이 다르면 모델이 둘 다 본다. 정리 여부는 사용 뒤 정한다.
- 확정본이 바뀌면 작업 id(inputHash)가 달라진다. 이미 만든 작업물을 자동으로 outdated로 바꾸지는 않으므로, 새 말투로 다시 쓰려면 기존 절차(수정 요청·브리프 변경)를 거친다.

## A3-3 작업물 제안 실험

결론: A3-3을 둘로 나눴다. 이 PR(A3-3a)은 승인된 콘텐츠 작업물의 카피 팩 제안 실험(`copyPack.experiments[index]`)을 draft 바이럴 실험으로 옮기는 경로 `create_experiment_from_artifact`만 더한다. 카피 팩을 게시 캡션 소스로 바꾸는 일(A3-3b)은 `lib/execution-server.ts`를 트랙 R가 갖고 있어 R3 뒤로 미뤘다. 기존 사례 기반 실험(`create_experiment`)의 경로·검사·저장 형식은 바이트 동일하다.

비유: 지금까지 실험 노트는 남의 가게 사례를 분석한 페이지에서만 뜯어 쓸 수 있었다. 이제 우리 문안 주문서(카피 팩)의 '제안 실험' 칸에서도 뜯어 쓸 수 있다. 다만 사장이 서명한(승인) 이번 판 주문서여야 하고, 주문서 칸이 틀렸거나(오류) 편지를 고쳐 쓴 뒤라 주문서가 옛 판이면 뜯어 쓸 수 없다.

- 코드: `lib/artifact-experiment.ts`(순수: 판정·문안·화면 목록, 서버와 화면이 같이 씀), `lib/learning-server.ts`(`create_experiment_from_artifact`, 계획 검사 `experimentPlan` 공용), `lib/learning.ts`(`ExperimentSource`, `ViralExperiment.source?`), `lib/record-kinds.ts`(동결 요약 `source.kind`), `app/learning-panel.tsx`(콘텐츠 실험 탭 '작업물 제안 실험' 목록·만들기, 실험 카드 출처 줄)
- 라우트: `POST /api/learning`(기존 `app/api/learning/route.ts`가 `learningAction`으로 넘긴다. 라우트 파일 변경 없음)
- 테스트: `tests/artifact-experiment.test.mjs`(메모리 SQLite·헤더 세션·합성 데이터, 모델·외부 호출 0회, `passed · mocked`)

### 요청과 저장

```json
{"action":"create_experiment_from_artifact","campaignId":"c-…","artifactId":"ai-…","artifactVersion":1,"index":0,
 "data":{"minSample":200,"minHours":72,"minLift":10,"verifyChannel":"Instagram","title":"(선택)","conditions":"(선택)"}}
```

- `data`의 `minSample`·`minHours`·`minLift`는 `create_experiment`와 같은 이름·검사다(최소 표본 100 이상 정수, 관찰 1~2160시간, 개선율 0 초과~1000%, 어기면 400).
- 사례 기반과 다른 점: `hypothesis`·`variable`·`control`·`treatment`·`metric`은 받지 않고 팩에서 가져온다. `title`을 비우면 팩 실험 제목, `conditions`를 비우면 팩의 `fixed`(`고정: …`, 없으면 표준 문장)다. `verifyChannel`을 비우면 팩 채널 이름을 학습 채널 별칭으로 읽은 값(읽지 못하면 Instagram)이며, 사례 채널 예외가 없어 학습 채널만 고를 수 있다.
- 저장: `viral_experiment` id `artifact:<작업물 id>:<판>:<제안 번호>`(멱등 키), `caseId:''`, `analysisId:''`, `caseChannel` 없음, `source:{kind:'artifact',artifactId,artifactVersion,index}`, `status:'draft'`. `control`·`treatment`는 안 id가 아니라 그 채널 안의 실제 문안이다(`안 A · 각도` / `훅:` / `본문:` / `CTA:` / 있으면 `확인 필요:` 줄). 지표는 팩 지표(바이럴 3지표)다. 캠페인 이벤트 1건을 남긴다.

### 판정 (`artifactExperimentProblem`)

| 조건 | 어기면 |
|---|---|
| `campaignId`가 작업물의 캠페인 | 400 |
| `index`가 0 이상 정수 | 400 |
| 작업물이 있음 | 404 |
| `artifactVersion` = 저장된 작업물 판 | 409 |
| 콘텐츠 역할, 승인(`approved`), 현재 브리프 판(`artifactUsable`) | 409 |
| `copyPack`이 있고 `copyPackArtifactVersion` = 작업물 판(사람 수정·회의 개선으로 낡지 않음) | 409 |
| `copyPackIssues`에 error 없음(warn은 통과) | 409 |
| `experiments[index]`가 있고 지표가 바이럴 3지표, 대조·실험안이 팩 채널의 안 | 409 |

- 같은 작업물·판·제안 번호 재요청은 판정을 다시 통과하면 새로 만들지 않고 `{id, duplicate:true}`로 기존 실험을 돌려준다.
- 권한: `create_experiment`와 같다(직원도 초안을 만든다). 별도 기능 스위치는 없다. 팩은 `a3_copy_pack`이 켜졌을 때만 생기므로 스위치가 꺼진 소유자는 팩이 없어 409다.

### 사례 없는 실험이 지나는 기존 경로

- 시작·결과 판정·사후확률 요약·규칙 채택(`adopt_rule`)은 그대로다. 채택 규칙은 `caseId:''`, `caseChannel`은 검증 채널, 30일 시험 규칙이다. 재검증(`retest_rule`)은 원 실험을 복제하므로 `source`가 따라간다.
- 캠페인 삭제(결정 7): 규칙은 retired로 보존되고 원천 실험 동결 요약에는 `source:{kind:'artifact'}`만 남는다. 작업물 id·판·카피 문안(대조·실험안)은 싣지 않는다. 동결 요약의 `experimentId`는 실험 id라 작업물 id(해시·UUID 꼴)를 담는다.
- 화면: 콘텐츠 실험 탭 위에 '작업물 제안 실험' 목록을 둔다(워크스페이스 작업물 중 선택 브랜드 캠페인의 카피 팩 있는 콘텐츠 작업물). 만들 수 없는 제안은 서버와 같은 사유 문구를, 이미 만든 제안은 '실험 있음'을 보인다. 실험 카드에는 `작업물 제안 실험 · 작업물 v1 · 제안 1` 줄이 붙는다.

### 남은 위험

- 동결 요약 표시(`lib/learning-view.ts` `frozenSummaryLines`)는 출처 종류를 아직 보이지 않는다(그 파일은 이 PR 범위 밖).
- 사람이 작업물을 고치면 팩 필드가 사라져(`save_artifact`가 새 객체를 쓴다) 그 판에서는 실험을 만들 수 없다. 이미 만든 실험은 옛 판 문안을 그대로 가진다.
- 화면 목록은 워크스페이스 응답의 작업물(`copyPack` 포함)을 쓴다. 작업물 승인 직후 워크스페이스를 새로 불러오기 전에는 목록이 옛 상태일 수 있고, 서버 판정이 최종이다.

## A3-4 회의 개선본과 골든 v2

결론: 이 PR은 A3-4의 코드 부분이다. (1) 회의 시작 때 스위치 `a3_copy_pack`이 켜져 있으면 회의 스냅샷에 출력 프로필을 고정하고, 그 회의의 콘텐츠 개선본만 카피 팩을 함께 낸다. (2) 합성 dev 스펙 2건이 v2 콘텐츠 케이스를 만든다. (3) 평가가 동결 요청의 프로필을 기대 계약으로 보고 v1 원문을 fail로 센다. 종료 조건 run은 게시 뒤에 한다(아래 절차). 스위치가 꺼졌거나 스냅샷에 프로필이 없으면 회의 제출·저장이 이전과 바이트 동일하다.

비유: 회의 시작 때 '이번 회의는 주문서 동봉' 도장을 회의록 표지에 찍는다. 회의 중에 사장이 규칙을 바꿔도 이미 시작한 회의는 표지 도장대로 간다. 도장이 있으면 콘텐츠 담당의 개선본에만 주문서가 붙고, 다른 담당은 늘 쓰던 편지만 쓴다.

- 코드: `lib/meetings.ts`(`meetingCopyPack`·개선 지시·`packedRevision`·`withoutCopyPack`), `lib/meeting-execution.ts`(시작 스냅샷·작업물 저장), `lib/meeting-input.ts`(지시 선택·뒤 단계 입력), `lib/eval-freeze.ts`(동결), `lib/eval-kinds.ts`·`lib/graders/types.ts`·`lib/graders/structure.ts`(기대 계약), `scripts/eval/synthesize.mjs`(스위치·말투 레코드), `scripts/eval/specs/syn-s9-*.json`
- 테스트: `tests/meeting-copy-pack.test.mjs`(모의 HERMES·메모리 SQLite·합성 데이터, 모델·외부 호출 0회, `passed · mocked`). `tests/eval-synthesize.test.mjs`가 새 스펙 2건도 생성한다.

### 회의 경로

- 시작(`executeMeeting` start): `isEnabled(owner,'a3_copy_pack')`를 한 번 읽어 켜져 있으면 `snapshot.outputProfile:'copy-pack-v2'`를 둔다. 꺼져 있으면 키가 없다. 프로필은 모델 입력에 싣지 않는다.
- 판정 `meetingCopyPack(m,s)`: 스냅샷 프로필 + 개선 단계 + 콘텐츠 담당. 발언·합의·재검토와 다른 역할 개선본은 늘 false라 지시·입력이 바이트 동일하다.
- 지시: 개선 형식 `{"title","content","changes"}` 뒤에 `copyPack` 스키마(`copyPackSchema`)를, 끝에 팩 규칙(`meetingCopyPackInstruction`)을 붙인다. 규칙은 A3-1 규칙 문장에서 계약 섹션 안내를 'content 앞에 렌더본을 붙이니 content에는 팩 문안을 반복하지 말라'로 바꾼 것이다.
- 파싱(`packedRevision`, soft): `parseCopyPack`으로 읽고 렌더본(채널별 카피 안·장면표·실험)을 content 앞에 넣는다. 팩이 없거나 규칙을 어겨도 개선본은 통과하고 `copyPackIssues`만 남는다. 실질 분량과 40,000자 저장 한도는 렌더본을 합친 본문으로 본다(역할 경로와 같다). 단계 출력에는 `copyPack`·`copyPackIssues`가 남아 저장 응답 재시도(`storedStepOutput`)도 같은 결과를 낸다.
- 저장(`finish`): 콘텐츠 개선 작업물 새 판에 `copyPack`, `copyPackArtifactVersion`(= 새 판 번호), 문제가 있으면 `copyPackIssues`(파싱 문제 + 브리프 채널 누락 경고)를 둔다. error 문제가 있으면 캠페인 이벤트 1건을 남긴다. 다른 역할 작업물과 재검토 작업물에는 팩 필드가 없다. 사람 수정·이전 판의 팩은 새 작업물 객체로 바뀌며 사라진다.
- 뒤 단계 입력: `completedRevisions`는 팩 필드를 빼고 싣는다(렌더본은 content에 있다). 재검토 후보(`candidateArtifacts`)는 원래 허용 목록이라 팩 필드가 없다.
- 평가 동결(`freezeMeetingRequest`): 프로필은 남기고(콘텐츠 개선 지시를 바꾸므로), 단계 출력의 팩 필드는 저장하지 않는다(조립이 읽지 않는다). 동결본 조립은 운영 제출과 바이트 동일하다(테스트).

### 기대 계약 (`+expected-contract`)

- `gradeRole`이 동결 요청의 `outputProfile`을 `GradeContext.outputProfile`로 넘긴다(A3-2 `brandVoice`와 같은 방식).
- `contract_json`은 프로필이 있으면 `roleOutputContract(role,{copyPack:true})`로 원문을 읽는다. v2 요청 + v1 원문은 운영과 같은 계약 버전 불일치로 fail, v2 원문은 이전과 같다. 프로필이 없으면 원문의 계약 버전으로 고른다(이전과 같다). 판정 위치는 `contract_json` 한 곳이고 `copy_pack_variants`는 바꾸지 않았다.

### 골든 v2 합성 스펙

| 스펙 | 업종·채널 | 케이스 | 말투 피할 표현 | 금지 표현 |
|---|---|---|---|---|
| `syn-s9-fnb-insta.json` | fnb, Instagram 피드·네이버 플레이스 | content 1 | 대박·역대급 | 최저가·무한 리필 |
| `syn-s9-edu-reels.json` | education, Instagram 릴스·네이버 블로그 | content 1 | 무조건·완벽 대비 | 성적 향상 보장·1등 강사 |

- 두 스펙 모두 `feature_flag` 레코드 `a3_copy_pack`·`a3_brand_voice`(켜짐)와 확정 `brand_voice` 레코드(판 2)가 있다. 생성기 모의 DB에서 운영과 같은 `roleRequestFor`가 요청에 `outputProfile:'copy-pack-v2'`와 `brandVoice`를 넣고 동결한다. 분기 체크리스트 8종을 콘텐츠 요청 하나로 채운다(수정 요청·검토 메모·이전 회의·운영자 선호·지점 허용 값·주의 규칙·사람 수정본·발췌 잘림).
- 상류 크리에이티브 초안에 금지 표현을 심었다(운영처럼 결함 있는 입력).
- 평가 run은 동결 요청으로 제출하므로 운영 소유자의 스위치 상태와 무관하다.

### 종료 조건 run (게시 뒤, 아직 안 함)

이 PR은 실제 생성·가져오기(`import_cases`)·모델 호출을 하지 않았다. 게시 뒤 아래 순서로 한다.

1. 이 PR이 든 제품 커밋이 `published`·`runtime-verified`인지 확인한다(`/api/version` `tree`). 가져오기는 생성 트리가 운영 트리와 같아야 한다.
2. 그 커밋을 체크아웃한 깨끗한 작업 트리에서 스펙마다 생성한다: `node --experimental-vm-modules scripts/eval/synthesize-cases.mjs --spec scripts/eval/specs/syn-s9-fnb-insta.json --out scripts/eval/outputs/syn-s9-fnb-insta.json`(edu도 같다).
3. 소유자 세션 브라우저로 `POST /api/eval {action:'import_cases', …출력}` 두 번. `created` 1건씩을 확인한다.
4. `POST /api/eval {action:'start_run', label:'A3-4 골든 v2', variant:'active', caseIds:[두 케이스], tokenBudget:100000}`.
   - 예산: 역할 케이스 예약 50,000 × 2 = 100,000(두 번째 케이스까지 예약이 들어가야 `not_run`이 되지 않는다). 실측 예상은 약 30,000(역할 1회 7,343~13,997토큰 실측에 팩 출력 증가분).
5. 종료 조건(두 케이스 모두): `contract_json` pass(v2 원문), `copy_pack_variants` pass, `brand_voice_avoid_term` pass, 출력이 잘리지 않음(출력 토큰이 콘텐츠 `maxTokens` 10,000 미만). 결과는 `docs/releases/` 또는 이 절에 run id와 함께 적는다.
6. 출력 토큰이 상한에 닿으면 `lib/role-execution.ts`에서 v2일 때만 상한을 올리는 PR을 따로 낸다(A3-1 남은 위험).

### 남은 위험

- 평가 케이스 `capturedWith.outputContractVersion`은 여전히 코드 상수 `role-output-v1`이다(`lib/eval-server.ts`, 이 PR 범위 밖 파일). v2 케이스는 동결 요청의 `outputProfile`로 구분한다.
- 회의 단계 평가(`meeting_step`)의 콘텐츠 개선본 채점은 모델 원문의 content만 본다. 운영 저장본처럼 팩 렌더본을 앞에 붙여 채점하지 않고, 팩 형식도 채점하지 않는다. 회의 골든 v2 케이스가 필요해지면 따로 더한다.
- 회의 입력 상한(64,000)은 그대로다. 팩 렌더본이 든 콘텐츠 개선본이 뒤 단계(그로스·데이터 개선, 재검토) 입력에 들어가 입력이 렌더본 크기만큼 는다. 실측은 종료 조건 run 뒤 회의 run에서 본다.
- 온라인 채점은 동결 요청이 없어 기대 계약·말투 판정을 하지 않는다.
