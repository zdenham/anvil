#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "=== Building Mort Dev ==="
./scripts/build-mort.sh dev

APP_PATH="src-tauri/target/release/bundle/macos/Mort Dev.app"

echo ""
echo "=== Verifying build output ==="

# 1. Check .app exists
if [ ! -d "$APP_PATH" ]; then
  echo "FAIL: $APP_PATH not found"
  exit 1
fi
echo "PASS: App bundle exists at $APP_PATH"

# 2. Check bundle identifier
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP_PATH/Contents/Info.plist")
if [ "$BUNDLE_ID" = "com.getmort.app.dev" ]; then
  echo "PASS: Bundle identifier is $BUNDLE_ID"
else
  echo "FAIL: Expected com.getmort.app.dev, got $BUNDLE_ID"
  exit 1
fi

# 3. Check product name
BUNDLE_NAME=$(/usr/libexec/PlistBuddy -c "Print :CFBundleName" "$APP_PATH/Contents/Info.plist")
if [ "$BUNDLE_NAME" = "Mort Dev" ]; then
  echo "PASS: Bundle name is $BUNDLE_NAME"
else
  echo "FAIL: Expected 'Mort Dev', got '$BUNDLE_NAME'"
  exit 1
fi

# 4. Check binary has dev suffix baked in
BINARY_NAME=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$APP_PATH/Contents/Info.plist")
if strings "$APP_PATH/Contents/MacOS/$BINARY_NAME" | grep -q "mort-dev"; then
  echo "PASS: Binary contains 'mort-dev' string (data dir reference)"
else
  echo "WARN: Could not find 'mort-dev' string in binary (may be optimized out)"
fi

echo ""
echo "=== All checks passed ==="

# 5. Optional: launch the app
if [ "$1" = "--launch" ]; then
  echo ""
  echo "Launching Mort Dev..."
  open "$APP_PATH"
fi
