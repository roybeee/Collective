# 성장2 최적화 후보 샌드박스

대상 카드: G2-15(B5 최적화 후보 샌드박스: 실제 실패 원인 연결·예산 제한·권한/검정기/봉인 변경 금지)·G2-16(후보 동결·독립 평가·제한 캠페인 검증, offline_pass와 매출 개선 분리, rollback).

레인 Q 소유 파일(`lib/eval-*`, `lib/prompt-registry.ts`)은 **읽기만** 한다. 이 화면은 성장 쪽 계보 기록이며 프롬프트 등록·활성화·승격·채점기·봉인을 바꾸지 않는다(`mayPromote:false`, `mayChangeGraders:false`).

- **후보**: 실제 실패 근거에서만 만든다 — 실험 결과(`rejected/invalid/inconclusive/insufficient/aa_failed`), 실패·무효로 회수된 교훈 적용, 구매 병목, 원인 연결, 고객 문의(현재 캠페인·판 일치). 후보 종류(프롬프트 단위·상세 문구·오퍼 메시지·운영 규칙), 대상 참조, 개선 제안, 토큰 예산(≤200,000)·비용 예산(≤300,000원).
- **동결**: 초안 → 동결(내용 digest). 동결 뒤 수정 불가.
- **오프라인 평가**: 동결 이후 시작해 완료된 기존 평가 실행(`eval_run`)만 연결하고, 실행 토큰 예산·사용량이 후보 예산 이하여야 한다. 판정(pass/fail)은 운영자가 기록한다.
- **판매 검증**: 오프라인 통과 후보만, 동결 이후에 사전등록한 확증(비 A/A) [판매 실험](GROWTH-2-EXPERIMENTS.ko.md)에 연결한다. 판매 상태는 그 실험의 최신 분석(`supported/rejected/그 외`)에서 읽는다. **오프라인 통과만으로는 판매 개선이 아니다.**
- **채택**: 오프라인 통과 + 판매 개선 근거가 모두 있을 때 소유자만(관리자 403), 기존 승인 경로(예: 레인 Q의 stage/promote)의 반영 기록 ID를 참조로 남긴다. 실제 반영은 그 경로에서 한다.
- **되돌림·폐기**: 채택 뒤 사유·증빙과 함께 되돌림, 채택 전 폐기.

저장: `growth_optimization`·`_history`·`_request`. 캠페인 삭제 시 보존.

검증(2026-09-30): `tests/growth-optimization-route.test.mjs` 28 passed(real 메모리 SQLite, 인증 mocked; 프롬프트 레코드 쓰기 0 확인), `e2e/growth-optimization.spec.ts` 모바일·데스크톱 2 passed(real Chromium/local D1, 실패 결과만 fixture).
