# 운영 규칙 후보의 정확한 동결과 평가 계약

`operating_rule`은 기존 `learning_rule`의 운영자 선호 규칙을 참조한다. `targetRef`는 규칙 ID이며 `proposal`은 규칙 guidance와 정확히 같아야 한다. 새 규칙 생성이나 활성화는 기존 운영자 선호 레인의 승인 경로에서 수행한다.

동결에는 전체 규칙(버전·상태·브랜드·점포·역할·채널·만료 포함), Q `preferencePairRules`의 정확한 off/on block과 hash, 케이스 전체 digest, 캠페인 범위가 포함된다. 규칙 적용 범위에 드는 역할 케이스만 허용하며 봉인 케이스와 토큰 예약량도 확인한다. 규칙/케이스/캠페인 변경 후에는 새 후보가 필요하다.

무료 `validate_evaluation`은 현재 정확성을 검사해 validation만 기록한다. 단계는 frozen이며 오프라인 통과나 Q 실행으로 표시하지 않는다. 모든 후보 종류의 새 유료 Q 시작은 원화 실지출 상한을 강제하는 공급자 계약이 연결될 때까지 409로 차단한다. 미지원 확인 체크박스, 양수 예산, 소유자 권한으로 이 제한을 해제할 수 없다. 가격 버전·최대 토큰·재시도/도구 비용을 포함한 원자 원화 예약과 공급자 hard-cap/최종 영수증 계약이 후속 필수 사항이다.

기존 수락된 실행의 회수는 계속 지원한다. 운영 규칙은 Q 공개 `operator_preferences` pair만 받으며 정확한 intent label, 시작자/시각, 케이스 쌍, 예산, 규칙 참조, full block/hash를 확인하고 서버 pairReport로 판정한다. 다른 프롬프트의 pair 결과를 연결할 수 없다. 이 변경에서는 새 규칙 Q intent를 생성하지 않는다.

판매 연결은 사전등록한 publication_link의 정확한 판 → 게시 카피의 최초 AI artifact v1 → `roleArtifactId(learning_snapshot.id)` → 실제 주입된 active 규칙 전체 스냅샷을 대조한다. 학습 스냅샷에 artifactVersion이 없으므로 편집된 v2 이상 작업물은 지원하지 않는다. 동결 후 규칙 활성화로 판이 바뀌어도 새 후보가 필요하다. 채택 직전에도 현재 대상과 주입 계보를 확인한다.

검증은 합성 SQLite와 공개 Q API의 설정 차단 상태로 수행하며 외부 호출은 0회다. 실제 공급자 비용 강제·Q 실행·규칙 활성화·판매 게시를 완료했다고 주장하지 않는다.
