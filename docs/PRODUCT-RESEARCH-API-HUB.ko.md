# NAVER API HUB 연결

신규 데이터랩 키는 상품 리서치 → 출처/연결 → **NAVER API HUB**에 입력한다. 검색어트렌드와 쇼핑인사이트를 모두 등록한 같은 Application의 Client ID/Client Secret이 필요하다. 기존 개발자센터 키는 기존 연결 카드에 별도로 보존한다.

## 저장과 실행

- 저장 전에 검색어 트렌드와 쇼핑 분야 조회를 각각 1회 호출한다. 둘 다 성공해야 암호화 저장한다. 둘째 검증이 실패하면 신규 연결을 저장하지 않고, 이미 저장된 키도 교체하지 않는다. 이미 소비한 호출은 쿼터에 남는다.
- HUB 연결이 있으면 데이터랩 두 출처에서 우선 사용한다. 복호화 또는 인증 오류가 나도 기존 개발자센터 키로 자동 우회하지 않는다. HUB 연결을 해제하면 남아 있는 기존 연결을 사용할 수 있다.
- HUB 키는 `naverapihub.apigw.ntruss.com`의 고정 경로에만 전달한다. 기존 개발자센터는 `openapi.naver.com`과 기존 헤더를 사용한다. 신규 스냅샷에는 비밀이 아닌 공급자 종류를 남긴다.
- 검증 호출과 수집 호출은 같은 일일 원장을 쓴다. 앱 상한은 검색900회, 쇼핑50회다. 같은 키를 다른 서비스에서 함께 사용하면 그 사용량은 이 앱이 통제하지 못하므로 NCP Application의 한도도 확인한다.
- 네이버 쇼핑 검색은 서비스 종료로 신규 계획, 잔존 재시도, 직접 호출에서 차단한다. 과거 수집 기록은 유지한다.

## 운영 판정

키 발급, 앱 연결, 실제 응답 검증, 자동 수집 스위치, 공급자 정책 준수는 각각 별도 상태다. 현재 대표 승인으로 자동 수집은 일시 정지했다. 연결 시험은 자동 수집을 켜지 않고 수행한다. YouTube의 보존·분석 정책 검토와 실제 블라인드 평가·출시 성과는 이 변경만으로 완료되지 않는다.

## 공식 규격

- [검색어 트렌드](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend): `/search-trend/v1/search`
- [쇼핑 분야](https://api.ncloud-docs.com/docs/naver-api-hub-shopping-insight-categories): `/shopping/v1/categories`
- [쇼핑 분야 내 키워드](https://api.ncloud-docs.com/docs/naver-api-hub-shopping-insight-keywords): `/shopping/v1/category/keywords`
- [Application 관리](https://guide.ncloud-docs.com/docs/apihub-application)
- [쇼핑 검색 등 종료 공지](https://developers.naver.com/notice/article/32564)

HUB 헤더는 `X-NCP-APIGW-API-KEY-ID`와 `X-NCP-APIGW-API-KEY`다. 키 원문은 문서·Git·브라우저 캡처에 남기지 않는다.
