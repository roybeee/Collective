# 성장2 Meta 성과 읽기 — M1 첫 증분

## 제공 범위

- 캠페인 → Meta 광고 준비 → 광고 성과. 준비 계획과 성과 작업을 탭으로 분리한다.
- 브랜드별 광고 계정의 `ads_read` 토큰을 명시적으로 연결한다. 기본은 연결 없음/외부 읽기 꺼짐이다. 워크스페이스·다른 브랜드 연결로 대체하지 않으며 같은 계정을 다른 브랜드에 중복 연결하지 않는다.
- 기존 `channel_credential` 암호화·키 회전 체계를 재사용한다. 연결 응답·성과·이력에는 토큰 원문이 없고 Meta 요청은 고정 호스트의 GET만 사용한다. 광고 생성·활성화·예산 변경·전환 전송 코드는 없다.
- 원화·서울 시간 계정, 캠페인 ID 1개, 최대 31일·500행·6페이지, 광고별 일별 성과. 계정과 캠페인 소유 관계를 외부에서 대조한다. 페이지의 임의 URL을 따라가지 않는다.
- Meta 조회 불가 시 동일 열의 CSV로 미리보기→저장한다. 토큰이나 고객 정보를 CSV로 받지 않는다. 파일 최대 150KB이며 추가 열·다른 계정/캠페인·기간 밖 행·중복 일자/광고를 거부한다.
- 최신 조회 범위의 스냅샷 1개를 보존한다. 다른 범위·API·CSV 결과를 더하지 않는다. 같은 CSV 재전송은 중복 기록하지 않으며 변경된 파일은 버전 확인 후 교체한다. 캠페인 삭제 시 함께 삭제한다.
- 광고비는 1/100원 정수로 계산한다. 구매·구매 금액의 빈 값은 미확인이다. Meta 보고값, 실제 주문 매출, 증분 매출을 분리한다. 실패·권한 오류·만료·페이지 일부 실패는 이전 스냅샷을 유지한다.

## API 계약 및 근거

- Graph API `v26.0`: [Meta 공식 SDK 설정](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py), 2026-09-28 확인.
- [Meta 공식 AdAccount SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)와 [Ad SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py)의 insights GET 계약을 사용한다.
- `time_range`, `time_increment=1`, `level=ad`, `action_report_time=impression`, 지정한 `action_attribution_windows`. 구매는 `omni_purchase` 한 종류만 사용해 플랫폼별 하위 구매를 중복 합산하지 않는다. 반환되지 않은 전환은 0으로 추정하지 않는다.
- 공식 Insights 문서 직접 조회는 429였으며 SDK 소스를 근거로 구현했다. 실계정 호출 검증을 대체하지 않는다.

## 검증과 남은 범위

- 전용 검사: `node --experimental-vm-modules tests/meta-insights.test.mjs` — passed · mocked, 70 assertions. 외부 쓰기 0, 고정 호스트·헤더 토큰·브랜드 격리·암호화 실패 시 전송 0·만료/권한/한도/타임아웃·중복·부분 페이지·수동 가져오기·권한·버전 충돌을 확인한다.
- 타입 검사·빌드·프롬프트 22개 — passed. lint 기준선 70 errors / 39 warnings 증가 없음. 전체 회귀 검사는 진행 중이며 병합 전 결과를 PR에 기록한다.
- 실제 Meta 계정 읽기 1회: blocked · real, 승인된 테스트 계정/읽기 토큰 미제공. 임의 토큰이나 운영 계정을 선택하지 않는다.
- 이번 증분은 수동 ID 입력과 버튼 수집이다. OAuth 셀프서비스, 계정/캠페인 선택 목록, 예약 수집·지속적인 상태 감시·호출 한도에 따른 자동 재시도는 후속이다. 토큰 만료 시 재연결 안내를 제공하며 만료 시각을 추정하지 않는다.
- M2: 기존 `store_order` 원장을 재사용하는 주문·환불·외부 버전/중복 계약과 실제 매출 대조. M3~M6: 소재/실험, PAUSED 초안, 승인 예산/중단, 순이익·증분 보고 순서로 이어간다.

개발 승인과 실광고 집행 승인은 별개다. 실제 지출·고객 전환 전송은 이 증분에서 수행하지 않는다.
