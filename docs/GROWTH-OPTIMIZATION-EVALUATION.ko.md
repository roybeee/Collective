# 성장2 최적화 후보 평가 연결

현재 프롬프트 후보는 등록된 정확한 pair 본문·케이스 동결과 기존 수락된 실행의 회수·판매 개입 계보를 지원한다. 상세 문구·오퍼는 무료 원문 코드 검사, 운영 규칙은 무료 정확성 검증과 정확 Q preference pair 회수 계약을 지원한다. 프롬프트/규칙 등록·활성화, 채점기·봉인 변경은 이 레인에서 수행하지 않는다.

## 비용 계약

모든 후보의 신규 `start_evaluation`은 현재 409다. Q 공개 인터페이스에는 원화 가격 예약·실지출 hard cap이 없으며 토큰 예약량도 한 공급자 호출의 청구 상한은 아니다. `confirmed`, `krwCapNotEnforced`, 소유자 권한으로 차단을 해제할 수 없다. 무료 동결·검증과 이미 수락된 실행의 회수는 가능하다. 원화 예약/정산 및 공급자 상한 계약은 후속 필수 사항이다.

## 프롬프트 동결·기존 실행 회수

`freeze.evaluation={candidateVersionId,caseIds}`는 공개 pairPrompts의 기준/후보 본문과 판, 모든 케이스 digest, 봉인 포함 여부, 단위 범위와 토큰 예약량을 확인한다. 후보 전체 동결 digest도 검증한다.

기존 durable intent가 있는 실행만 공개 evalRead에서 고유 label로 조회한다. 정확히 한 run, 후보/기준 전체 본문, 결과의 각 케이스 active/candidate 쌍, 예산, 실행자/시각을 대조하고 완료 결과만 서버 pairReport로 판정한다. 임의 verdict, 다른 후보·프롬프트 run, 미확인 응답의 blind retry는 허용하지 않는다. 새 유료 의도 생성은 비용 계약 연결까지 대기한다.

판매 연결은 동결 후 사전등록한 확증 실험의 digest와 refs를 검증하고 published publication_link의 정확 판 → artifact ID/판 → promptVersion의 동결 후보 ID를 대조한다.

## 다른 후보 종류

- `landing_copy`/`offer_message`: growth-optimization-content-server의 정확한 원문·상품·오퍼·사실 snapshot과 현재 readiness/compliance를 무료 코드로 검사한다. Q 생성 품질이나 매출 개선의 평가가 아니다. record_offline 결과는 deterministic_content로 구분한다. 판매 연결/채택 때 현재 판·근거·준비 상태를 다시 검사한다. provider 적용 등으로 대상 판이 바뀌면 새 후보가 필요하다.
- `operating_rule`: [운영 규칙 계약](GROWTH-OPTIMIZATION-RULE.ko.md). exact rule/full block/case scope를 동결한다. 무료 validate_evaluation은 stage=frozen을 유지하고 Q 통과로 승격하지 않는다. 기존 정확한 Q operator_preferences pair만 회수하며 판매는 원본 AI 작업물의 실제 규칙 주입 snapshot에 연결한다.

## 검증 범위

합성 SQLite·공개 Q 함수와 legacy accepted-intent fixture로 검증한다. 외부 공급자 요청은 금지한다. 새 유료 실행 차단, 동결 변경, 타 후보/쌍 바꿔치기, 예산 초과, 기존 응답 유실 회수, 서버 판정, 정확 판매 개입 계보를 검사한다. 실제 Q 유료 집행·원화 상한·운영 판매는 검증하지 않았다.
