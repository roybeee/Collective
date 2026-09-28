# 연결 계정의 Meta 캠페인 선택

광고 성과에서 **연결 계정의 캠페인 찾기**를 눌러 이름·ID·상태를 확인하고 조회 입력에 사용할 캠페인을 선택한다. ID 직접 입력과 CSV 가져오기도 유지한다. 선택 자체는 성과 저장/수집·광고 생성/변경을 실행하지 않는다.

- 대표/관리자가 명시 버튼을 누를 때만 기존 브랜드 읽기 자격증명으로 고정 Graph v26.0 GET을 한다. 소유자/브랜드/캠페인 범위를 재확인한다. 브라우저가 광고 계정을 바꿔 요청할 수 없다.
- 현재 연결 version/updatedAt이 조회 전후 일치해야 한다. 조회 중 해제·교체·브랜드 변경·보관되면 결과를 선택 대상으로 반환하지 않는다.
- 계정 ID·KRW·Asia/Seoul 확인 후 campaigns edge에서 1페이지 최대50개. 반환 항목의 account_id/중복 ID/필드 길이·형식을 검사한다. 원문 공급자 오류/토큰을 반환하지 않는다.
- cursor만 고정 HTTPS URL의 after 값으로 넣는다. 공급자 paging.next URL은 따라가지 않고 반환하지 않는다. 자동 전체 조회 없이 다음50개도 명시 버튼, 동일 cursor 루프 거부, 응답300KB/35초 한도와 리다이렉트 차단은 기존 읽기 클라이언트를 사용한다.
- UI는 현재 페이지를 교체한다. 오류 시 이전 항목 선택을 막고 입력값은 유지한다. 연결이 바뀌면 목록 상태를 초기화한다. 캠페인 이름은 텍스트로만 표시한다.

공식 [Meta Python SDK AdAccount.get_campaigns](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)의 GET campaigns와 [Campaign 필드](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/campaign.py)를 2026-09-28 대조했다. 실제 계정 목록은 연결 자료 미제공으로 blocked. SDK 대조를 실서비스 검증으로 간주하지 않는다.

전용26 assertions와 기존 Meta 읽기82 assertions passed·mocked: 고정 GET/헤더/페이지 한도, 타 계정/중복/형식/리다이렉트/시간 초과/원문 오류 차단, cursor 처리, 권한/CSRF/연결 판/보관·성과 미저장. 타입/lint70·39/프롬프트22/빌드 passed. 브라우저는 실제 로컬 UI/D1, 연결 조회/Meta 목록 응답은 합성으로 모의해 페이지 선택·ID 입력·오류 후 선택 차단·모바일 너비를 확인한다.

전체 M1 종료가 아니다. OAuth·계정 목록·예약 수집·실계정 인수는 후속이다. 광고비·Meta 쓰기·고객 이벤트 전송0.
