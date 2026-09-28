# M4 비활성 판매 캠페인 — 첫 증분

Meta 작업의 **비활성 초안** 탭에서 현재 계획·소재 검수·별도 쓰기 연결을 확인하고, 예산 없는 PAUSED 판매 캠페인 하나를 만든다. 광고세트·소재·광고 객체와 활성화/예산 변경은 후속이다. 전체 M4 종료가 아니다.

## 기본값과 권한

- `meta_ads_paused_write` 기본 꺼짐. 이번 게시에서 운영 스위치를 켜지 않는다. 소유자가 기능 설정에서 켜야 연결/준비/생성을 할 수 있다. 꺼도 연결 해제와 기존 작업의 GET 재대조는 가능하다.
- 쓰기 연결/준비/외부 생성/상태 대조는 워크스페이스 소유자만 가능하다. 관리자·직원은 읽기 전용이다. CSRF·소유자/브랜드/캠페인 범위를 확인한다.
- 같은 브랜드의 M1 읽기 연결과 동일한 광고 계정이어야 한다. 쓰기 토큰은 별도 `channel_credential` 키 `meta_ads_write:<brand>`에 암호화한다. 기존 키 회전 경로를 재사용한다. 읽기 토큰을 쓰기 토큰으로 자동 승격하지 않는다.
- 토큰을 전송하기 전에 암호화 가능 여부를 확인하고, 계정 원화/서울 시간·읽기 probe·`/me/permissions`의 ads_management granted를 확인한다. 이 조회가 지원되지 않는 토큰은 연결을 거부한다. 실제 계정 권한은 외부 생성 시 다시 거부될 수 있다.

## 준비·전송·확인

- M0 필수 계획 항목, 판매 목표, M3 현재 검토 기록을 다시 검사한다. M3 근거/실험/파일/판 검사 로직을 공유 서버 모듈로 옮겼으며 기존 API 동작은 유지한다.
- 현재 캠페인/계획/검토/쓰기 연결 판을 묶은 fingerprint가 조회 후 바뀌면 준비/전송을 거절한다. 특별 광고 범주 비해당의 명시적 검토가 필요하다. 대상 여부가 불명확하거나 특별 범주이면 이 경로를 쓰지 않는다.
- 준비 기록은 로컬 DB만 쓴다. 같은 입력과 근거는 같은 작업으로 돌아간다. 전송은 별도 버튼과 명시 확인을 거친다.
- Journal.begin은 준비 상태를 CAS로 비교하고 sending을 영속 기록한다. 동시 요청 중 하나만 예약한다. 캠페인 판/브랜드/보관 조건도 UPDATE의 EXISTS로 대조한다. 승인/검수 검사와 함께 호출하는 운영 라우트는 소유자 mutation lock을 잡는다.
- POST campaigns는 1회, status PAUSED / objective OUTCOME_SALES / special_ad_categories [] / 예산 공유 false다. 예산·타겟팅·임의 status 입력은 허용하지 않는다. 토큰은 Authorization 헤더, 호스트는 고정 Graph HTTPS, 리다이렉트 미추적, 응답 바이트/시간 제한.
- 생성 행위자·전송 시각·최종 변경 행위자를 기록하고, 외부 ID를 먼저 저장한 뒤 별도 GET에서 ID·계정·상관 식별자 이름·목적·configured_status/effective_status PAUSED를 확인한다. 과거 확인 시각을 표시하며 현재까지 상태가 유지됨을 보증하지 않는다. 운영자가 다시 조회할 수 있다.
- 타임아웃·리다이렉트·오류·응답 이상·조회 실패는 결과 미확인이다. 자동 재전송하지 않는다. 미해결 작업이 있거나 이미 연결한 캠페인이 있으면 이름/토큰 변경으로 새 생성 작업을 우회하지 못한다.
- ID가 없으면 Meta에서 상관 식별자가 붙은 캠페인을 찾아 ID를 직접 입력한다. 같은 계정·상관 식별자·PAUSED를 조회한 뒤에만 연결한다. 찾지 못한 결과 미확인 작업의 자동 초기화/재전송은 제공하지 않는다. 이름만으로 Meta 네이티브 중복 방지가 보장된다고 주장하지 않는다.
- 생성 준비·전송 기록이 있으면 캠페인 삭제를 거부하며 보관을 안내한다(외부 객체 대조 이력 유지). 원문 토큰/고객 정보는 없다. 외부 객체 삭제·확정 거절/부재 증빙에 따른 재개 처리는 후속이다.

## 근거와 검사

2026-09-28 공식 SDK 원문 대조:
- [AdAccount create_campaign](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py): POST campaigns의 필드.
- [Campaign](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/campaign.py): OUTCOME_SALES, PAUSED, account_id, name, configured_status, effective_status.
- [User permissions](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/user.py): GET permissions, Permission의 permission/status 모델.

공급자 모의 44 assertions: 기본 disabled·입력 차단·PAUSED·예산 미포함·영속 예약·동시 요청·결과불명·원문 비밀값 미노출·GET 대조·생성 뒤 DB 실패. D1 journal18 assertions: 소유자 격리·중복 준비·CAS·외부 ID 불변·확정 상태/캠페인 판. 운영 API 모의36 assertions: 기본 꺼짐·소유자 권한·CSRF·별도 암호화 토큰·권한/계정 확인·현재 검수·준비/생성 분리·중복/새 키 우회 거부·꺼진 상태 GET 대조. 기존 M3 모의30 회귀와 기능 스위치/삭제 정책 검사도 수행한다.

모바일·데스크톱 E2E는 기본 꺼짐과 읽기 연결 없는 쓰기 요청 거절, 입력 보존, 탭/본문 너비를 검증한다. 외부 Meta 응답은 단위/API 검사에서만 모의했다. 실제 계정 생성/PAUSED 실검증은 권한·승인 자산 미제공으로 blocked, 실제 광고비·고객 전환 전송0.

후속: 실계정 비활성 생성 검증, 계정별 예산 단위/픽셀/랜딩·표시·권리 계약, 광고세트·소재·광고 객체, 외부 변경 감시·중단, 별도 M5 승인 예산/제한 집행. 공식 SDK 필드를 읽었다는 이유로 실제 호환성·권한 심사 통과를 주장하지 않는다.
