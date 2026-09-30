# 성장2 수요 단계 ↔ 자체 발행 근거 연결

대상 카드: G2-19(수요 캠페인 실행 연결)·G2-27(단계별 근거)·G2-28(발행별 계보)·G2-11(검토 근거). [원안](GROWTH-2-PLAN.ko.md), [다음 증분 권고 1](GROWTH-2-NEXT-GAPS.ko.md#1-수요-시퀀스-단계--기존-발행관측-근거-연결-우선).

## 무엇을 하는가

- 수요 시퀀스의 정확한 단계(`sequenceId`/`stepId`, 시퀀스 판)와 기존 성장 발행 연결(`growth_publication_link`, 연결 판)을 관리자가 1:1로 잇는다. 한 발행 연결은 한 단계에만 붙는다(기록 id = 발행 연결 id). 다른 단계로 옮기면 같은 기록의 새 판이 된다.
- 연결 조건: 같은 owner/브랜드/캠페인/지점, 발행 실행 준비(intent)의 미션 = 시퀀스 미션, 발행 당시 오퍼 id·판 = 시퀀스 오퍼 id·판, 자연 유입(organic) 미션.
- 단계는 `channel=organic`·`placement=owned`일 때만 연결한다. 크리에이터·파트너·광고 단계는 자체 계정 발행 영수증으로 대체하지 않는다(각자의 공급자 근거가 필요).
- 조회 때 서버가 기존 발행 관측(`growthPublicationObservation`)의 게시 상태·측정·귀속 주문을 그대로 읽는다. 수치를 복사해 저장하지 않는다. 운영자 성과 메모(`performanceNote`)와 `source`를 나눠 보여준다.

## 판정

| 상황 | 결과 |
|---|---|
| 단계의 계획 내용(메시지·대상·권리·URL 등) 변경 | `held` — 근거 수치 숨김, 다시 연결 필요 |
| 운영자 성과 메모만 변경 | 연결 유지(단계 digest에서 제외) |
| 시퀀스 오퍼/미션 변경, 발행 연결 승인 내용 digest 변경, intent 미션 불일치 | `held` |
| 공급자 접수(`accepted`) | `게시 완료 전` — 게시로 세지 않음 |
| 게시 완료 + 측정 수집 전 | `collecting` |
| 게시 완료 + 측정 observed/historical 또는 귀속 주문 observed | `observed` |
| 모든 경우 | `causalStatus: not_measured`. 귀속 주문은 인과 효과가 아님 |

## 저장

- `growth_demand_evidence`(현재 판), `growth_demand_evidence_history`(추가 전용), `growth_demand_evidence_request`(UUID 멱등). 캠페인 삭제 시 보존(`retain`), 삭제 요약은 '성장 발행 연결' 묶음.
- 연결·해제는 캠페인 판·시퀀스 판·발행 연결 판·현재 기록 판 CAS와 UUID 멱등, 현재/이력/요청의 원자 batch. 같은 UUID 다른 내용은 409.
- 보관 캠페인에는 새 연결 불가(해제는 가능). 전역 중단 중에도 연결은 실행이 아니므로 허용.
- `mayExecute:false`. 외부 게시·지출·수집·오퍼 자동 수정은 없다.

## 검증 (2026-09-30, 이 브랜치)

- `tests/growth-demand-evidence-route.test.mjs` 38 passed(real 메모리 SQLite, 인증 mocked, 외부 호출 0): 인증·CSRF·캠페인/시퀀스/발행 CAS, 크리에이터 차단, 다른 미션·구판 오퍼·타 지점 거부, 원자 rollback, UUID 재생/충돌, accepted≠published, 메모 변경 유지·계획 변경 보류·발행 digest/오퍼 변경 보류, 귀속 주문 observed(인과 미측정), 해제·이력, 보관 캠페인, owner 격리.
- `e2e/growth-demand-evidence.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1, 시퀀스·intent·발행은 로컬 fixture, 응답 유실 1회만 mocked): 크리에이터 단계 버튼 잠금, 같은 UUID 재시도, 구판 409 입력 보존 → 최신 판 채택 → 재연결, 해제 이력, 가로 넘침 없음.

## 남은 것

- 크리에이터·파트너 단계의 실제 협업 영수증(G2-27 후속), Meta 광고 단계의 광고 단위 근거 연결.
- 단계 근거를 오퍼/메시지 개정 결정(G2-11)에 스냅샷으로 넣는 연결은 결정 기록 쪽 후속이다.
- 실제 계정 게시·도달·주문은 not_run.
