# COLLECTIVE Android

기존 COLLECTIVE 사이트와 ChatGPT 로그인·서버 데이터를 사용하는 설치형 앱이다.
Android 6.0(API 23) 이상을 대상으로 하며 앱 ID는 `kr.mealzip.collective`이다.
Chrome 등 Custom Tabs 지원 브라우저와 인터넷 연결이 필요하다.

## 실행 방식

- 앱 아이콘을 누르면 `https://mealzip-agency.hflameb.chatgpt.site/`를 연다.
- 사이트와 APK의 Digital Asset Links 검증에 성공하면 TWA 전체 화면으로 열린다.
- 검증에 실패하면 브라우저 상단 바가 표시되는 Custom Tabs로 열린다.
- 현재 사이트의 `/.well-known/assetlinks.json` 익명 요청은 HTTP 401이다. 따라서 현재 제공 방식은 상단 바가 있는 폴백이다.
- 로그인과 업로드/다운로드는 브라우저가 처리한다. 앱에서 인증 헤더나 토큰을 만들거나 저장하지 않는다.
- 외부 앱이 전달한 URL·추가 데이터·파일 접근 권한은 실행 주소에 반영하지 않는다.

## 빌드

JDK 17, Android SDK platform 36이 필요하다. AGP는 build-tools 35.0.0을 사용하고 이번 릴리스 서명 검사는 36.0.0으로 실행했다. SDK는 공식 Google 약관 동의 후 설치한다.
Gradle wrapper는 버전 8.13과 배포 파일 SHA-256을 고정한다.

```sh
export JAVA_HOME=/path/to/jdk/Contents/Home
export ANDROID_HOME=/path/to/Android/sdk
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleRelease
```

서명 전 APK: `android/app/build/outputs/apk/release/app-release-unsigned.apk`.
이번 전달 파일은 `/Users/roybee/Downloads/COLLECTIVE/COLLECTIVE-1.0.0.apk`이며 전용 릴리스 키로 서명했다. 디버그 모드는 꺼져 있다.
Play Store 등록이나 공개 배포를 의미하지 않는다.
업데이트 설치에는 동일한 서명 키가 필요하다. 이 Mac의 전용 키와 비밀번호 파일은 Git 밖의 `~/.local/share/collective-android/signing/`에 권한 600으로 보관한다. 해당 폴더는 별도로 안전하게 백업해야 한다.
키·비밀번호·`local.properties`·SDK·빌드 산출물은 Git에 넣지 않는다.

```sh
# 기존 릴리스 키로 서명. 비밀번호 자체를 명령줄에 쓰지 않는다.
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign \
  --ks "$COLLECTIVE_KEYSTORE" --ks-key-alias collective \
  --ks-pass "file:$COLLECTIVE_PASSWORD_FILE" \
  --out COLLECTIVE-1.0.0.apk app/build/outputs/apk/release/app-release-unsigned.apk
adb install -r COLLECTIVE-1.0.0.apk
adb shell am start -n kr.mealzip.collective/.CollectiveLauncherActivity
```

휴대폰으로 APK를 옮겨 실행할 때는 해당 파일을 여는 앱의 '알 수 없는 앱 설치' 권한이 필요할 수 있다.

## 전체 화면 전환 조건

운영 사이트가 `/.well-known/assetlinks.json`을 로그인·리다이렉트 없이 HTTPS 200 JSON으로 제공해야 한다.
JSON에는 앱 ID와 실제 배포 APK 서명 인증서의 SHA-256을 연결한다. 임의 인증서 지문이나 사용자 인증 우회는 사용하지 않는다.
현재 Sites 인증 경계에서 이 경로가 공개되지 않아 웹사이트 설정 변경 전에는 전체 화면을 보장하지 않는다.
운영 사이트 변경·재게시 및 Play Store 등록은 별도 작업이다.

## 모바일 동작의 현재 경계

기존 모바일 웹 smoke는 실제 Chromium 390×844와 로컬 D1을 사용하며 로그인만 테스트 헤더로 대체한다.
이는 Android의 실제 로그인·파일 선택·다운로드 검증을 대체하지 않는다.
모바일 메뉴는 선택 후 바깥 영역을 눌러 닫아야 한다.
업무 화면 이동은 React 상태로 처리되어 Android 뒤로가기가 이전 업무 화면을 복원하지 않을 수 있다.
현재 APK는 운영 웹 화면을 그대로 사용한다. 웹 동작 개선을 반영하려면 웹 변경과 게시가 필요하다.

## 출처

- [Android Browser Helper](https://github.com/GoogleChrome/android-browser-helper)
- [TWA 연결 안내](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide)
- [Android Custom Tabs](https://developer.android.com/develop/ui/views/layout/webapps/overview-of-android-custom-tabs)

실행한 검사와 미검증 사항은 `docs/STATUS.md` 및 `docs/releases/2026-09-23-android-1.0.0.md`에 기록한다.
