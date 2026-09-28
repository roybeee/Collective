# M4 PAUSED 하위 광고 단계별 생성

`meta_ads_child_create` 기본 꺼짐, 소유자만 준비·생성·복구 조회. 현재 검수·원본 업로드 영수증·같은 브랜드/계정·확인된 PAUSED 부모 캠페인이 있어야 준비할 수 있다. 원본 `sourceBytesVerified`가 필수이고 CDN 표시 파일 동일성/실제 매출/지출 안전성은 보증하지 않는다.

지원 범위: 대한민국 성인 연령, WEBSITE/PURCHASE, OFFSITE_CONVERSIONS/IMPRESSIONS, LOWEST_COST_WITHOUT_CAP, 광고세트 일 예산, 단일 이미지 링크, LEARN_MORE/SHOP_NOW. Graph 일 예산 정수는 원화와 별도 입력/대조 근거를 저장한다. 자동 환산 없음. 광고세트와 광고는 `status=PAUSED` 고정이다. 소재 객체에는 독립 게재 활성화 상태를 요청하지 않는다. ACTIVE 요청·활성화 API 없음.

생성은 광고세트 → 소재 → 광고 순서다. 각 POST 전 계정의 KRW/Asia-Seoul/정상 상태, 부모 캠페인의 계정·이름·판매 목적·PAUSED·캠페인 예산 없음, 앞 단계 객체를 GET으로 다시 확인한다. 전송 직전 서버는 현재 검수·토큰 범위와 CAS를 재확인하고 `sending`을 영구 기록한다. 성공 응답 ID는 먼저 `unknown`으로 저장한 뒤 GET으로 이름·계정·부모·상태·정확한 구성과 대조한다. 검증된 단계만 다음 단계로 진행한다.

캠페인당 작업 한 개다. 어떤 단계라도 전송되면 구성/토큰/검수 변경으로 새 작업 키를 만들 수 없다. 미전송 준비만 교체 가능하다. 시간초과·응답 유실·성공 저장 실패·구성 불일치는 `unknown` 또는 내구 저장된 `sending`으로 남고 재POST·다음 단계 진행을 막는다. 알려진 ID가 있으면 저장한 범위 그대로 GET 복구만 가능하다. ID 유실 시 임의 ID를 받지 않으며 운영자가 Meta에서 대조해야 한다.

토큰 교체 또는 기능 OFF 뒤에도 소유자는 같은 브랜드/계정의 현재 쓰기 권한 토큰으로 알려진 ID를 읽기 복구할 수 있다. 과거 범위 확인이지 현재 계획 승인 갱신이 아니다. 생성은 계속 현재 fingerprint/기능 ON을 요구한다. 복구 결과로 새로운 생성 권한을 부여하지 않는다.

영수증은 캠페인 삭제를 막고 보존한다. 완료한 ID는 광고 구성 탭에서 원본 영수증과 함께 다시 대조한다. 실제 Meta 호출은 수행하지 않았고 계정별 필수 필드·권한·예산 단위 운영 검증은 미실행이다. 공급자가 지원하지 않는 구성은 오류/미확정으로 닫히며 자동 변경·자동 재시도하지 않는다.

공식 계약: [Meta SDK AdAccount](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)의 `create_ad_set`, `create_ad_creative`, `create_ad`: `/adsets`, `/adcreatives`, `/ads` POST 및 status/object_story_spec/creative 필드. GET 필드는 같은 SDK의 [AdSet](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py), [AdCreative](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py), [Ad](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py)에 따른다.

검증: `tests/meta-ad-create.test.mjs`, `tests/meta-ad-create-route.test.mjs`는 합성 Graph 응답과 로컬 SQLite(mocked); `e2e/meta-ad-create.spec.ts`는 실제 브라우저+API 모의. 실제 자격증명/Meta 생성/활성화 테스트가 아니다.
