# 같은 저울 재채점 — 품질 기준선 v1 vs 품질 수정 v1 뒤 (2026-09-25)

결론: 운영 채점기(측정 v2 + G3)로 두 평가를 다시 채점하면 품질 수정 v1의 효과는 분명하다.

| 항목 | 기준선 v1 | 품질 수정 v1 뒤 |
|---|---|---|
| 채점기 실패 | 6건 | 0건 |
| 정규화 전 원문 결함(예방 판정 fail) | 16건 | 0건 |
| 출력 정규화가 고친 곳 | 11케이스 모두 | 0 |

품질 수정 v1 뒤 결과에 남은 규제 block 1건과 warn 9건은 원문을 재현해 보니 모두 **측정 도구 오탐**이었다. 이 오탐은 PR `fix/compliance-failure-label`(사전 `compliance-lexicon-2026-09-25.2`, `+compound-labels`)이 고친다. 게시 뒤 다시 재채점하면 수정 v1 뒤 결과는 결함 0개 산출물 11/11이 될 것으로 예상하며, 아직 확인하지 않았다(not_run).

- 근거: real. 운영 `ac7a031`(Sites 버전 29)에서 소유자 세션 `POST /api/eval {action:'regrade_run'}`를 네 run에 실행했다. 모델·HERMES 호출은 0회, 토큰은 0이다.
- 저울: `failure-types-v1+normalized+measure-v2+g3` / `compliance-lexicon-2026-09-25.1`(운영 코드).
- run
  - 기준선 v1: `d8da14f1…`(1차, 11케이스 중 1건 완료)과 `3e63007b…`(2차, 나머지 10건). 원래 저울은 `failure-types-v1` / 사전 `2026-09-23.2`다.
  - 수정 v1 뒤: `5e212bfc…`(MAPDAL 8)와 `12a84ee5…`(ODA 3). 원래 저울은 `failure-types-v1+normalized` / 사전 `2026-09-23.2`다.
- 케이스 11개는 모두 운영자 선호 블록이 없다(`GET /api/eval?case=`로 확인, real). 그래서 Q1 뒤에도 제출 본문·promptHash가 그대로이고 기준선과 바로 비교된다.

## 합계

| 항목 | 기준선 v1 | 품질 수정 v1 뒤 |
|---|---|---|
| 적용 채점기 통과율(pass/(pass+fail)) | 92.2% (71/77) | **100% (81/81)** |
| 채점기 실패 | 6 (모두 `internal_id_exposure`) | **0** |
| 예방 판정 fail(정규화 전 모델 원문) | 16 (`internal_id_exposure` 11, `heading_nesting` 5) | **0** |
| 정규화가 고친 케이스(스키마 경로/제목) | 11/11 | **0/11** |
| 규제 block | 1 (ODA cmo `fake_testimonial`) | 1 (ODA strategy `fake_testimonial`, 오탐) |
| 규제 warn | 9 | 9 (모두 오탐) |
| 결함 0개 산출물(채점기·예방 fail 0, block 0) | 0/11 | 10/11 (남은 1건은 오탐 block) |

- 원래 저울 수치(참고): 기준선 0/11·71.6%, 수정 v1 뒤 7/11·93.9%([수정 v1 뒤 기록](2026-09-24-quality-after-v1.md)). 같은 저울로 다시 재면 기준선 통과율이 92.2%로 오른다. 측정 v2가 오탐을 고쳤고, 채점기가 사람이 보는 정규화 렌더본을 보기 때문이다. 그래서 기준선의 실제 결함은 정규화 전 원문 판정(예방 16건)과 정규화 건수로 드러난다.

## 케이스별 (통과/실패, 실패 채점기, 예방 판정 fail, 정규화 스키마 경로/제목, 규제)

| 케이스 | 기준선 v1 | 품질 수정 v1 뒤 |
|---|---|---|
| MAPDAL insight | 7/0, 예방 id, 7/0, warn price | 7/0, 0/0, warn price |
| MAPDAL strategy | 7/0, 예방 hd+id, 7/19, warn price+terms | 8/0, 0/0, warn price |
| MAPDAL creative | 7/0, 예방 id, 6/0, warn ai+price | 8/0, 0/0, warn price |
| MAPDAL content | 7/0, 예방 hd+id, 3/4, warn price | 8/0, 0/0, warn price+terms |
| MAPDAL growth | 6/1(id), 예방 id, 9/0, warn price | 8/0, 0/0, warn price |
| MAPDAL data | 7/0, 예방 hd+id, 18/20, warn price | 7/0, 0/0, warn price |
| MAPDAL quality | 3/1(id), 예방 id, 11/0 | 4/0, 0/0 |
| MAPDAL cmo | 6/1(id), 예방 id, 23/0, warn price | 7/0, 0/0, warn price |
| ODA insight | 7/1(id), 예방 id, 7/0 | 8/0, 0/0 |
| ODA strategy | 7/1(id), 예방 hd+id, 10/4 | 8/0, 0/0, **block fake(오탐)** |
| ODA cmo | 7/1(id), 예방 hd+id, 22/3, block fake | 8/0, 0/0 |

(id = `internal_id_exposure`, hd = `heading_nesting`, price·terms = `price_missing`·`terms_missing`, ai = `ai_generated_unlabeled`, fake = `fake_testimonial`)

## 남은 규제 판정의 원문 재현 (모두 오탐)

- **ODA strategy block `fake_testimonial`**: 산출물의 '크리에이티브 평가 기준' 표 열이 '탈락·수정 기준'이고, 그 칸에 "과장, 가짜 후기, 숨은 광고, 확인 전 가격·메뉴 포함"이 규칙으로 적혀 있다.
  - 측정 v2는 '실패 기준'·'탈락 기준' 같은 한 낱말 라벨만 규칙 칸으로 봤다. 그래서 가운뎃점 합성 라벨은 비우지 못했다.
  - 같은 산출물의 "위장 후기 … 추천 조작, 대량 홍보는 제안하지 않습니다"는 이미 면제된다(로컬 재현).
- **MAPDAL warn 9건 `price_missing`·`terms_missing`**: 구매 유도 문구가 아니었다. 재현한 문장은 다음과 같고 모두 로컬 재현으로 확인했다.
  - 퍼널 단계: '상품 상세→장바구니, 장바구니→결제 시작 … 단계별 이탈', '장바구니→결제 시작률'.
  - 분석 이벤트 표: `add_to_cart`·`begin_checkout` 행(세션 ID).
  - 측정 정의: '조회수, QR 조회, 광고 클릭, 길찾기, 장바구니는 유료 주문과 구분한다'.
  - 조건을 앞에 둔 CTA: '가격과 판매 조건이 확인된 경우 “상품 선택하기” 또는 “구매하기”'.
  - 확인 표시 CTA: '… 정상 작동한 뒤: “구매하기” [가격 확인 필요]'.
  - '온라인 판매 실적에 합산하지 않는다'(판매 범위)와 '가격 확정 전에는 “구매하기” … 쓰지 않는다'(부정 규칙)는 이미 면제된다.
- 고침(PR `fix/compliance-failure-label`)
  - 합성 판정 라벨을 인식한다. 모든 판정어가 실패 판정이거나 곁말(수정·반려·보완·재작업·보류)이고 실패 판정이 하나 이상일 때만 규칙 칸으로 본다. '합격·수정 기준'과 '수정 기준' 단독은 계속 잡는다.
  - 측정 면제에 퍼널 화살표, 단계별 이탈, snake_case 이벤트, 세션 ID, 조회수, '유료 주문과 구분'을 더한다.
  - 조건을 앞에 둔 CTA 면제를 더한다('확인된 경우', '정상 작동한 뒤'). '확정된 가격으로 지금 구매'처럼 조건이 아닌 수식은 면제하지 않는다. 조건 없이 `[가격 확인 필요]` 표시만 붙인 구매 문구는 품질 수정 v1 결정대로 경고를 남긴다.
  - 진짜 구매 유도는 계속 잡는다(합성 위반 5종 추가): 카피 안 화살표, '오픈 이벤트! 지금 구매하세요', 블로그, 다른 문장의 조건, '확정된 가격으로'.
  - 규제 테스트는 위반 102/102를 잡고 정상 66건에서 오탐 0이다(mocked).

## 다음

1. 측정 수정 PR 병합 → 다음 묶음 게시 뒤 네 run을 다시 `regrade_run`한다(토큰 0). 수정 v1 뒤 결함 0개 산출물 11/11을 확인한다.
2. 품질 계획 v2 R 단계: 합성 dev 케이스 가져오기(S2·S3)와 파일럿 8건(250k 이하)을 한다. 봉인 케이스(R1)는 프롬프트를 고치는 레인이 아닌 사람이 만든다.
