# M4 검수 원본 PNG 업로드

`meta_ads_image_upload` 기본 꺼짐. 소유자·관리자는 현재 검수한 1080×1080 PNG를 내부 BUCKET에서 읽어 PNG 구조/픽셀 및 SHA256을 확인하고 별도 Meta 쓰기 연결의 광고 계정으로 전송한다. 멤버는 조회만 가능하다. 클라이언트 파일·URL·임의 bytes는 받지 않는다.

공식 [Meta SDK AdAccount.create_ad_image](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)는 `bytes` 문자열을 받는 POST `/act_{id}/adimages` 계약이다. [AdImageMixin](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/helpers/adimagemixin.py)의 `images` 응답에서 단일 `hash`를 읽는다. 코드에서는 원본 PNG를 base64로 보낸다. 기존 고정 Graph API 버전을 사용하며 redirect는 허용하지 않는다.

준비 작업 ID는 캠페인·브랜드·소재ID·원본SHA256·계정으로 고정한다. 검수/소재/읽기·쓰기 연결은 별도 근거 fingerprint에 고정한다. 전송 전에 CAS로 `sending`을 영구 저장한다. 동시 요청·중복 전송은 거부한다. 응답 유실·시간초과·형식 오류·성공 영수증 저장 실패는 `unknown`, unknown 저장까지 실패하면 기존 `sending`으로 남는다. 두 상태 모두 재업로드할 수 없다. `uploaded` 영수증을 수정·재확정하는 API는 없다. 미전송 prepared만 CAS로 현재 검수·연결 범위를 갱신할 수 있다. sending/unknown은 범위 변경으로 재전송을 우회할 수 없다. 완료된 영수증은 변경하지 않는다. 같은 소재판·원본해시·계정의 완료된 원본 전송 증거는 토큰 갱신 뒤에도 재사용하며, 광고 구성의 현재 검수/연결 fingerprint와 실제 Graph 조회를 다시 통과해야 한다.

원본 해시와 실제 보낸 bytes의 동일성이 확인되고 Meta 응답이 영구 저장된 경우만 `sourceBytesVerified:true`다. `displayBytesVerified:false`는 항상 유지한다. Meta 이미지 hash는 SHA256이 아니고 Meta가 변형한 CDN 표시 파일의 byte 동일성은 검증하지 않는다. 광고 구성의 `imageUploadReceiptId`는 현재 검수·계정과 일치하는 영수증 및 수동 `expectedMetaImageHash`를 함께 대조한다. `assetBytesVerified:false`와 실제 활성화 차단은 유지된다.

업로드 기록은 캠페인 삭제를 막고 보존한다. unknown 복구/수동 확정은 이번 범위에 없으며 운영자가 외부 계정을 대조해야 한다. 기본 꺼짐 상태에서 실제 Meta 업로드·자격증명 사용은 실행하지 않았다. 전용 테스트는 합성 PNG, SQLite/BUCKET 및 Meta 응답 mocked다.

검사: `node --experimental-vm-modules tests/meta-image-upload.test.mjs`, `node --experimental-vm-modules tests/meta-image-upload-route.test.mjs`, TypeScript, 기존 lint gate, build. 기존 bundle 계약도 함께 검사한다.
