# M4 비활성 실행 패키지

`meta_ads_bundle` 기본 꺼짐. 소유자만 로컬 준비·검토·외부 GET 검증을 실행한다. 외부 POST·활성화·지출 없음.

기존 검수 및 PAUSED 생성 영수증과 같은 계정/브랜드/캠페인의 광고세트·소재·광고 ID를 기록한다. 지원 구성은 대한민국 성인 연령 타깃, WEBSITE/PURCHASE, OFFSITE_CONVERSIONS/IMPRESSIONS, 광고세트 일 예산, 단일 이미지 링크 소재다. 광고세트와 광고 configured_status는 PAUSED만 허용하고 부모로 인한 CAMPAIGN_PAUSED/ADSET_PAUSED effective_status도 허용한다. 캠페인은 PAUSED를 다시 확인한다.

검증은 광고 계정, 캠페인, 광고세트, 소재, 광고를 고정 Graph 호스트에서 GET한다. 계정·부모·소재 ID·페이지·픽셀·랜딩·기간·예산·타깃 및 검수된 hook/body를 대조한다. 확장 타깃·동적 소재·기존 게시물·캐러셀·URL 태그·자동 소재 변형은 지원하지 않아 거부한다. story/link/CTA는 허용 필드만 통과하며 CTA는 검토한 LEARN_MORE 또는 SHOP_NOW와 정확한 랜딩을 대조한다. `expectedMetaImageHash`는 실제 Meta `image_hash`와 정확히 비교한다. 이미지는 Meta hash와 원본 PNG hash가 같은 체계가 아니므로 소유자가 화면에서 검수 원본과 대조하고 검토 확인을 남겨야 한다. `assetBytesVerified:false`는 scope와 digest에 포함되며 실제 활성화의 미충족 조건이다.

`dailyBudgetKrw`는 준비 계획 일별 목표와 같다. `graphDailyBudget`는 Graph 응답과 비교할 별도 원문 정수다. 자동 환산·동등성 추정 없음. `budgetUnitEvidence`에 실제 대조 근거를 적는다. 이 패키지는 금액 환산 또는 지출 권한을 보증하지 않는다.

`viewMetaAdBundle(owner,c)`와 `requireVerifiedMetaAdBundle(owner,c)`가 M5에 검증된 전체 ID와 `scopeDigest`를 제공한다. digest는 전체 구성, 계획/소재 검수, 부모 영수증, 읽기·쓰기 연결 판에 묶인다. 조회 결과는 15분 이내만 유효하며 과거 스냅샷이다. 현재 PAUSED 상태의 지속 보증이 아니다. 검증 재시도 전에 기존 검증을 영구 무효화하므로 실패/시간초과/프로세스 중단 뒤 과거 확인으로 진행하지 못한다.

검수 PNG의 전송 계보는 별도 [원본 업로드](META-IMAGE-UPLOAD-M4.ko.md) 영수증으로 연결할 수 있다. 그 경우 `sourceBytesVerified:true`와 원본 hash를 scope에 고정하며 입력한 Meta hash와 영수증이 다르면 거부한다. 외부 표시 이미지의 바이트 동일성은 계속 보증하지 않는다.

신규 광고세트·소재·광고 POST는 별도 [PAUSED 하위 생성](META-AD-CREATE-M4.ko.md) 기능에 있다. 이 검증 API 자체는 GET만 실행한다. 실제 계정 권한, 이미지 업로드·버튼/타깃 정책, 통화 단위, 계정별 필수 필드와 중복 생성 방지 계약의 운영 검증은 미실행이다.

공식 필드 출처: [Meta SDK AdSet](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py), [AdCreative](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py), [Ad](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py). Graph API 버전은 기존 META_READ_API_VERSION을 따른다.

검증은 합성 Graph 응답과 로컬 SQLite로 실행한다. `node --experimental-vm-modules tests/meta-ad-bundle.test.mjs`, `node --experimental-vm-modules tests/meta-ad-bundle-route.test.mjs`로 입력/계보/권한/CSRF/CAS/ACTIVE/불일치/시간초과/검수변경/연결재등록/확인만료를 검사한다. 실제 Meta 계정 검증은 별도이며 미실행이다.
