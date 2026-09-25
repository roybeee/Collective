# 봉인 케이스 작성 안내 (R1)

결론: 봉인 케이스 33건(S1·S4·S5)은 프롬프트를 고치는 쪽이 아닌 작성자가 저장소 밖에서 만들고 운영에 가져온다. 이것이 들어와야 쌍 평가 게이트의 `sealed_missing`이 풀리고, 프롬프트 변경을 한 번도 보지 않은 문제로 잴 수 있다.

비유: 시험을 내는 사람과 수업을 하는 사람이 같으면 시험이 수업에 맞춰진다. 봉인 케이스는 수업(프롬프트 수정)을 모르는 사람이 낸 시험지다.

## 누가 만드나
- 프롬프트·지시문(`lib/practice.ts`, `prompts/`, `lib/role-instruction.ts` 등)을 고치는 세션·사람이 아닌 작성자다. 대표, 지정한 담당자, 또는 그 목적으로만 새로 연 AI 세션이 할 수 있다.
- AI 세션을 쓸 때는 프롬프트 수정 세션과 대화·파일을 공유하지 않는다. 결과 스펙과 출력은 프롬프트 수정 쪽에 넘기지 않는다.
- 프롬프트 수정 쪽은 봉인 케이스의 요청·출력(`GET /api/eval?case=`)을 열어 보지 않는다. 봉인 run의 결과는 합계(통과·실패 수)로만 본다. 봉인 케이스를 보고 규칙을 고쳤다면 그 케이스는 dev로 옮기고 기록한다(EVAL 봉인 보류 세트 규칙).

## 무엇을 만드나 (설계, 로드맵 골든셋 v2)

| 캠페인 | 업종(`industry`) | 역할 | 회의 단계 | 브리프 | 점포 목표(`localStore`) |
|---|---|---|---|---|---|
| S1 선크림 신제품(규제 민감) | beauty | 8 | 6 | 1 | 아님 |
| S4 성수 팝업 7일 | popup | 8 | – | 1 | 아님 |
| S5 생활용품 3지점 소매 | retail | 8 | – | 1 | 점포 목표 |
| 합계 | | 24 | 6 | 3 | = 33케이스 |

- 봉인 업종(beauty·popup·retail)은 dev(S2·S3·S6~S8·운영 캡처)에 쓰지 않았다.
- 회의 단계 6종은 cmo·creative·quality 토론, 합의, 개선본 1개, 재검토다(dev S2 스펙의 `meeting.targets`와 같은 형식).

## 스펙 쓰는 법
1. 저장소 밖 폴더(예: `~/collective-sealed/`)에 둔다. 저장소에 커밋하지 않는다.
2. 구조는 dev 스펙을 본뜬다. `scripts/eval/specs/syn-s2-bakery.json`(회의·브리프 포함)과 `syn-s6-locker.json`(역할만)을 참고한다. 형식만 참고하고 내용은 새로 쓴다.
3. 필수 값
   - `id`는 `syn-`로 시작하고 `set`은 `"sealed"`다.
   - `expectations.prohibitedTerms` 1~5개는 브랜드·캠페인 제약, 상시 지시, 회의 안건, 브리프 제약 중 한 곳에 글자 그대로 있어야 한다.
   - `industry`는 사전 id(beauty·popup·retail)다.
4. 분기 체크리스트 8종을 레코드로 채운다. 하나라도 빠지면 생성기가 거부한다.
   - 수정 요청: 한 역할 작업물을 `status:"revision"`으로 두고 `reviewNote`를 단다.
   - 이전 회의 결정: 완료된 `team_meeting`에 합의 단계를 둔다.
   - 운영자 선호: `learning_rule`에 `grade:"operator_preference"`를 둔다.
   - 지점 허용 값: `store` 레코드.
   - 주의 규칙: `learning_rule`에 `direction:"caution"`을 둔다.
   - 사람 수정본: 작업물 `origin:"ai_edited"`.
   - 발췌 잘림: 상류 작업물 하나에 `padTo` 6,000자 이상.
5. 운영처럼 지저분하게 쓴다. 상류 작업물에 실제 같은 결함을 심는다.
   - 금지 표현이 든 카피 초안.
   - 거절 사실 사용.
   - 관찰 기간 없는 전환율.
   - 확인 안 된 수치.
   - 회의가 있으면 `meeting.seededDefects`로 재검토가 잡아야 할 결함을 적는다.
6. 개인정보는 넣지 않는다. 전화번호는 지점 허용 값의 가상 번호만 쓴다. 생성기가 개인정보 패턴을 거부한다.

## 생성
- 운영에 게시된 커밋을 깨끗하게 체크아웃한 작업 트리에서 돌린다. `git rev-parse HEAD^{tree}`가 운영 `/api/version`의 tree와 같아야 한다.
- 운영 tree가 `unknown`이면 가져오기가 늘 409다. 이때는 게시를 먼저 바로잡는다.
- 스펙과 출력 경로는 저장소 밖에 둔다(추적 안 되는 파일은 작업 트리를 dirty로 만들지 않는다).

```sh
node --experimental-vm-modules scripts/eval/synthesize-cases.mjs --spec ~/collective-sealed/syn-s1-sunscreen.json --out ~/collective-sealed/out-s1.json
```

- 출력의 `generator.tree`가 운영 tree와 같은지 본다.

## 가져오기 (소유자 세션)
소유자로 로그인한 브라우저의 같은 출처에서 부른다. 출력 파일 하나당 한 번이다.

```js
// out = 생성기 출력 JSON(파일 내용)
await fetch('/api/eval',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},
 body:JSON.stringify({action:'import_cases',generator:out.generator,cases:out.cases})}).then(r=>r.json())
```

- 응답의 `created`·`existing` 수를 기록한다. 같은 키·같은 스펙이면 다시 가져와도 중복되지 않는다(멱등).
- 한 번에 최대 100케이스다.
- 가져온 뒤 `GET /api/eval`의 케이스 목록에서 세트별 수(`sealed` 33)만 확인한다. 내용은 열지 않는다.

## 기록
- `docs/STATUS.md`에 작성자(사람 또는 세션 이름), 날짜, 케이스 수, 생성 tree만 적는다. 스펙 내용은 적지 않는다.
- 봉인 세트를 쓰는 run은 `sealedUsed`가 남는다. 목적은 run `label`에 적는다.
