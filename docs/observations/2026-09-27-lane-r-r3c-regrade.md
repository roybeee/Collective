# 2026-09-27 레인 R: R3c 게시 뒤 운영 재채점

결론: R3c(`franchise` 업종 사전, `GRADERS_VERSION +franchise-industry`, #173)의 수용 기준 "게시 뒤 운영 dev·봉인 골든 재채점에서 새 fail 0건"은 **passed · real**이다. 두 기준선 모두 R3c 전과 fail 구성이 같다. `franchise` 사전의 적중은 0건이다.

비유: 새 검사 항목을 저울에 더한 뒤 지난번에 달았던 물건들을 다시 올려 본 것이다. 새 항목 때문에 불합격으로 바뀐 물건은 하나도 없었다.

## 실행
- 누가·어디서: 대표 지시로 메인 세션이 대표 로그인 브라우저에서 실행했다(real). 레인 R 세션은 운영 평가 데이터 쓰기가 권한 분류기에 막혀 직접 하지 않았다.
- 언제: 2026-09-27 05:35 UTC.
- 무엇을: `POST /api/eval` `regrade_run`으로 끝난 run을 새 저울로 다시 채점했다. 모델 호출은 없고 토큰은 0이다.
- 운영: R3c가 게시된 판(묶음 18, 04:04 UTC, tree `9cef246`).

## 결과
### dev 기준선 `eab8911d`
- 재채점 id: `7d46b1db-13cc-477f-b810-9e72f20926b5`.
- 74케이스(S7 합성 가맹 8건 포함). 채점기 판 `…+channels-close+franchise-industry`, 규제 사전 `.14`.
- fail 10건:

  | 채점기 | 건수 |
  |---|---|
  | `local_channel_coverage` | 6 |
  | `internal_id_exposure` | 1 |
  | `brief_contract` | 1 |
  | `brief_instruction_violation` | 1 |
  | `contract_json` | 1 |

- 09-25 재채점과 구성이 같다. `industry_metric_leak`은 0건이고, `franchise` 사전 적중도 0건이다.
- S7 8건은 R3c 선행 작업(운영 D1 기대 업종 `['franchise','fnb']`, [관찰 기록](2026-09-26-lane-r-s7-industry.md))으로 가맹 표현이 허용 업종이 됐다. 새 fail이 없다.

### 봉인 골든 `284fa4be`
- 재채점 id: `27acd8b0-0032-481b-a6f2-349ea39b1063`.
- 32케이스. fail 9건: `fact_conflict` 1, `industry_metric_leak` 8.
- `industry_metric_leak` 8건은 모두 `fnb` 적중이다. 원래 채점(R3c 전)에서도 8건으로 같다. `franchise` 적중은 0건이다.
- 봉인 요청·출력 원문은 열지 않았다. 합계와 채점기별 건수만 봤다(SEALED-CASES 규칙).

## 판정
- R3c 수용 기준 "새 fail 0건": passed · real.
- 남은 fail(dev 10, 봉인 9)은 R3c 전부터 있던 것이고, 레인 R이 고칠 대상이 아니다. 해당 채점기의 소유 레인이 다룬다.
- 확인하지 않은 것: 온라인 채점(`lib/online-grading.ts`)은 업종을 비워 두어 이 사전의 영향을 받지 않는다. 이번 재채점 범위 밖이다.
