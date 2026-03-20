# Test Dev Build Script

## Problem

There's no script to build the full Mort Dev binary and smoke-test it. The existing `scripts/build-mort.sh dev` builds the binary but doesn't verify the result — you have to manually open the `.app` and check it.

The dev build already has visual differentiation:

- Sidebar header shows "MORT DEV" (via `tree-panel-header.tsx` using `app_suffix` from Tauri)
- `BuildModeIndicator` component shows a colored badge
- Spotlight has suffix-based styling
- Window title / dock icon says "Mort Dev" (from `tauri.conf.dev.json`)
- Uses `icons-dev/` icon set, `~/.mort-dev` data dir, different hotkeys and ports

## Goal

Create a **test-dev-build script** that builds the dev variant and runs basic smoke tests to verify the build output is correct without manual inspection.

## Phases

- [x] Remove dead `IS_ALTERNATE_BUILD` constant

- [x] Create `scripts/test-dev-build.sh` script

- [x] Verify the script works end-to-end

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Remove dead suffix constants from frontend

`APP_SUFFIX`, `IS_ALTERNATE_BUILD`, and the `__MORT_APP_SUFFIX__` declare in `src/lib/constants.ts` are all dead code — nothing imports them. All UI components fetch the suffix at runtime via Tauri's `get_paths_info` command instead.

**File:** `src/lib/constants.ts`

- Delete lines 1-3 (the `declare`, `APP_SUFFIX` export, and `IS_ALTERNATE_BUILD` export)
- Keep `GATEWAY_BASE_URL` and anything else in the file

The `__MORT_APP_SUFFIX__` Vite define in `vite.config.ts` / `vite.config.web.ts` / `vitest.config.ts` / `vitest.config.ui.ts` can be left alone (harmless, and the env var is still used by the Tauri backend).

## Phase 2: Create `scripts/test-dev-build.sh`

A script that:

1. **Builds** the dev variant (calls `./scripts/build-mort.sh dev`)
2. **Locates** the built `.app` bundle (should be at `src-tauri/target/release/bundle/macos/Mort Dev.app`)
3. **Verifies** the binary exists and has the expected name ("Mort Dev")
4. **Checks** the app's `Info.plist` for correct bundle identifier (`com.getmort.app.dev`)
5. **Checks** the binary's embedded strings for `MORT_APP_SUFFIX=dev` (using `strings` command)
6. **Optionally launches** the app with `open` and waits for the user to confirm it works (interactive mode)

```bash
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
if strings "$APP_PATH/Contents/MacOS/Mort Dev" | grep -q "mort-dev"; then
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
```

**Usage:**

- `./scripts/test-dev-build.sh` — build + verify
- `./scripts/test-dev-build.sh --launch` — build + verify + open the app

## Phase 3: Verify the script works end-to-end

- Run the script and confirm all checks pass
- Launch the app and verify the dev indicator appears in the sidebar
- Confirm the app uses `~/.mort-dev` for data

## Notes

- The build takes a while (Rust compilation). This script is for periodic manual verification, not CI.
- Could later extend with automated Playwright tests against the built app, but that's out of scope here.