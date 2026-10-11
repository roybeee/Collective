# 점포 성장 운영 검증 결과

2026-10-11 사용자 승인 범위의 개발 준비도는 독립 코드 리뷰 **95/100 = 4.75/5, APPROVE**이다. [구현 전 고정 평가표](STORE-GROWTH-PLAN.ko.md)를 유지했다. 실제 추가 매출·추가 이익·시간 절감 입증 점수와 구분한다.

## 구현 결과

- 기존 점포 정보를 사전 채우고 컨셉·병목·지역·고객·시간대·비용·계획 노동시간·수용량을 저장한다.
- 공식 출처 후보 6개와 실제 점포 심층조사의 공개 협업 모집 후보를 비교한다. 발굴 후보는 인용 원문의 이름·주소·지역·업종·모집 표현·관측일을 검증하고 보고서와 같은 원자 배치로 저장한다.
- 후보의 최근 사례·반례, 견적 근거, 사용권 범위·기간, 방문 조건, 광고 표시, 구매 추적과 비용 회수 가능성을 확인한다. 견적·도달·원가는 임의 생성하지 않는다.
- 선택 후보의 브리프·실행 과제를 만들고 완료 근거를 기록한다. 기존 캠페인·실험·추적 코드·협업과 연결하며 다른 owner/점포 참조를 거절한다.
- 초기 설정·반복 노동시간, 직전 기록 재확인, 중복 반영 여부를 기록한다. 완료된 측정 기간의 비용을 대사하며 측정·시간·단가가 바뀌면 비교 결론을 보류한다.
- 기존 실험의 회고와 다음 행동을 표시하고 최대 3개 우선 과제를 제시한다. 귀속 실적·전후 변화·인과 효과를 구분한다.

## 독립 평가

| 항목 | 점수 |
|---|---:|
| 점포 기준·병목·컨셉 | 12/12 |
| 손익·수용량·결측 | 14/14 |
| 실제 후보·출처·신선도 | 15/16 |
| 매칭·제외·설명 | 12/12 |
| 기존 실행 인계 | 13/14 |
| 시간·비용·주간 결론 | 11/12 |
| 학습 반영 | 7/8 |
| 점주 흐름·입력 부담 | 5/6 |
| 보안·회귀·빌드·리뷰 | 6/6 |
| 합계 | **95/100 (4.75/5)** |

신규 변경의 미해소 CRITICAL/HIGH/MEDIUM 0개. 감점은 실제 지역 운영 미검증, 수기 실행 식별자 연결, 시간 확인 부담, 학습의 추천 반영 범위, 후보 JSON 일괄 입력 사용성 때문이다.

## 실행 증거

| 검사 | 상태 | 범위 |
|---|---|---|
| 전체 회귀 | passed: 371/371 suites, 19,867 assertions | 실제 순수 로직·메모리 SQL, 공급자/인증 mocked |
| 최종 보안 수정 뒤 경로 | passed: 43 | 실제 메모리 SQL, 인증 mocked, 외부 호출 0 |
| 최종 보안 수정 뒤 기존 점포 | passed: 141 | HERMES mocked |
| 후보 발굴 | passed: 28 | 실제 메모리 SQL, 공급자 not_run |
| 도메인 | passed: 58 | 순수 로직, 실제 외부 지표 not_run |
| 화면 회귀 | passed: 12 | SSR·fetch mocked |
| 타입·최종 빌드 | passed: exit 0 | 실제 로컬 TypeScript/vinext |
| lint gate | passed: 70 errors / 39 warnings | 기존 기준선 유지, 청정 lint 주장 아님 |
| 모바일·데스크톱 E2E | passed: 2 (8.4초) | 실제 로컬 HTTP·D1·Chromium, 인증만 mocked |
| 독립 개인정보·인증정보 우회 | passed: 8 | 합성 입력, 외부 호출 0 |
| 실제 외부 후보 조사·섭외·광고·매출 효과 | not_run | 운영 계정·예산·측정 기간이 필요한 별도 운영 검증 |

전체 회귀 후 보안 재검토에서 JSON 따옴표 키 우회를 발견했다. RED 실패를 확인한 뒤 보완했고 경로·발굴·기존 점포·타입·lint·빌드·E2E를 다시 통과했다. 과제 생성 후 화면 참조 오류 역시 실제 E2E RED→GREEN으로 확인했다.

로컬 증거: `/tmp/collective-store-growth-tests.log`, `/tmp/collective-store-growth-final-stores.log`, `/tmp/collective-store-growth-type.log`, `/tmp/collective-store-growth-lint.log`, `/tmp/collective-store-growth-final-build.log`, `/tmp/collective-store-growth-final-e2e.log`. HTML 보고서는 `/Users/roybee/Collective-research-20261011/store-growth-final-playwright-report/index.html`이다.

기존 manifest/lock의 의존성 감사에는 critical 1/high 30 등이 남아 있다. 이번 변경은 의존성을 추가·변경하지 않았으며 의존성 청정 판정은 하지 않았다. 운영 게시 전 별도 의존성 정비가 필요하다.

상태: **구현·로컬 검증 완료**, merged/published/runtime-verified는 별도 상태다.
