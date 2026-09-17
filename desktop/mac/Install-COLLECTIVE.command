#!/bin/bash
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
cd "$(dirname "$0")"
SOURCE_DIR="$PWD"
VERSION=44.4.1
DESTINATION="$HOME/Applications/COLLECTIVE.app"
TEMP_DIR=''
BACKUP=''
fail() { printf '\n설치 실패: %s\n' "$1" >&2; exit 1; }
cleanup() {
  result=$?
  if [ "$result" -ne 0 ] && [ -n "$BACKUP" ] && [ -d "$BACKUP" ] && [ ! -e "$DESTINATION" ]; then
    /bin/mv "$BACKUP" "$DESTINATION" || true
  fi
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then /bin/rm -rf "$TEMP_DIR"; fi
  if [ "$result" -ne 0 ]; then
    printf '\n설치가 완료되지 않았습니다. 위 오류를 확인해 주세요. Enter 키로 종료합니다.\n'
    read -r ignored || true
  fi
}
trap cleanup EXIT
[ "$(uname -s)" = Darwin ] || fail '이 설치 파일은 Mac 전용입니다.'
[ -f payload/main.cjs ] && [ -f payload/policy.cjs ] && [ -f payload/package.json ] || fail 'ZIP 전체를 압축 해제한 후 실행해 주세요.'
OS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
[ "$OS_MAJOR" -ge 12 ] || fail 'macOS 12 Monterey 이상이 필요합니다.'
ARCH=x64
if [ "$(uname -m)" = arm64 ] || [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then ARCH=arm64; fi
printf '\nCOLLECTIVE Mac 설치 · %s\n설치 위치: %s\n' "$ARCH" "$DESTINATION"
printf '공식 Electron 실행 엔진을 내려받습니다. 인터넷 연결이 필요합니다.\n'
if [ -e "$DESTINATION" ]; then
  CURRENT_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DESTINATION/Contents/Info.plist" 2>/dev/null || true)
  [ "$CURRENT_ID" = co.mealzip.collective ] || fail '같은 이름의 다른 앱이 있습니다. 먼저 설치 위치를 확인해 주세요.'
  printf '\n기존 COLLECTIVE를 완전히 종료한 뒤 Enter 키를 누르면 앱을 교체합니다. 로그인 정보와 서버 데이터는 유지됩니다.\n'
  read -r ignored
  if /bin/ps -axo command= | /usr/bin/grep -F "$DESTINATION/Contents/MacOS/Electron" | /usr/bin/grep -v grep >/dev/null; then
    fail 'COLLECTIVE가 실행 중입니다. Cmd+Q로 종료한 후 다시 설치해 주세요.'
  fi
fi
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/collective-install.XXXXXX")"
ARCHIVE="electron-v${VERSION}-darwin-${ARCH}.zip"
BASE="https://github.com/electron/electron/releases/download/v${VERSION}"
/usr/bin/curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 30 --max-time 1200 "$BASE/$ARCHIVE" -o "$TEMP_DIR/$ARCHIVE"
/usr/bin/curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 30 --max-time 120 "$BASE/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"
EXPECTED="$(awk -v file="$ARCHIVE" '$2 == file || $2 == "*"file {print $1}' "$TEMP_DIR/SHASUMS256.txt")"
[[ "$EXPECTED" =~ ^[[:xdigit:]]{64}$ ]] || fail '공식 체크섬을 찾지 못했습니다.'
ACTUAL="$(shasum -a 256 "$TEMP_DIR/$ARCHIVE" | awk '{print $1}')"
[ "$EXPECTED" = "$ACTUAL" ] || fail '다운로드 검증에 실패했습니다. 다시 설치해 주세요.'
printf '\n다운로드 검증 완료. 앱을 구성합니다.\n'
/usr/bin/ditto -x -k "$TEMP_DIR/$ARCHIVE" "$TEMP_DIR/runtime"
BUNDLE="$TEMP_DIR/runtime/Electron.app"
[ -x "$BUNDLE/Contents/MacOS/Electron" ] || fail '실행 파일이 없습니다.'
/bin/mkdir -p "$BUNDLE/Contents/Resources/app"
/usr/bin/ditto "$SOURCE_DIR/payload" "$BUNDLE/Contents/Resources/app"
/bin/rm -f "$BUNDLE/Contents/Resources/default_app.asar"
PLIST="$BUNDLE/Contents/Info.plist"
RUNTIME_MIN=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$PLIST" 2>/dev/null || printf '12.0')
RUNTIME_MAJOR="${RUNTIME_MIN%%.*}"
[ "$OS_MAJOR" -ge "$RUNTIME_MAJOR" ] || fail "이 실행 엔진에는 macOS $RUNTIME_MIN 이상이 필요합니다."
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier co.mealzip.collective' "$PLIST"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName COLLECTIVE' "$PLIST"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName COLLECTIVE' "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c 'Add :CFBundleDisplayName string COLLECTIVE' "$PLIST"
/usr/libexec/PlistBuddy -c 'Set :CFBundleShortVersionString 1.0.0' "$PLIST"
/usr/libexec/PlistBuddy -c 'Set :CFBundleVersion 1.0.0' "$PLIST"
/usr/bin/codesign --force --deep --sign - --preserve-metadata=entitlements "$BUNDLE"
/usr/bin/codesign --verify --deep --strict "$BUNDLE"
/bin/mkdir -p "$HOME/Applications"
if [ -e "$DESTINATION" ]; then
  BACKUP="$HOME/Applications/COLLECTIVE-backup-$(date +%Y%m%d-%H%M%S)-$$.app"
  /bin/mv "$DESTINATION" "$BACKUP"
fi
# Stage on the destination filesystem, then rename into place.
STAGED="$(mktemp -d "$HOME/Applications/.collective-stage.XXXXXX")"
if ! /usr/bin/ditto "$BUNDLE" "$STAGED/COLLECTIVE.app"; then
  /bin/rm -rf "$STAGED"; fail '앱 복사에 실패했습니다.'
fi
if ! /bin/mv "$STAGED/COLLECTIVE.app" "$DESTINATION"; then
  /bin/rm -rf "$STAGED"; fail '설치 위치에 앱을 이동하지 못했습니다.'
fi
/bin/rmdir "$STAGED"
printf '\n설치 완료: %s\n' "$DESTINATION"
if [ -n "$BACKUP" ]; then printf '이전 앱 백업: %s\n' "$BACKUP"; fi
printf '앱을 열어 기존 계정으로 로그인해 주세요.\n'
/usr/bin/open "$DESTINATION" || printf 'Finder에서 앱을 직접 열어 주세요.\n'
