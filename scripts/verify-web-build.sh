#!/usr/bin/env bash
# Verifies the web build output is structurally valid (FR6 verification).
#
# Checks:
# 1. dist-web/ exists with expected structure
# 2. HTML entry point references real asset files
# 3. Main JS bundle does not contain raw @tauri-apps imports (shims worked)
# 4. Core app modules are present in the bundle (routes, navigation, stores)
#
# Usage: scripts/verify-web-build.sh [--build]
#   --build  Run pnpm web:build first (default: verify existing output)

set -euo pipefail

DIST="dist-web"
ERRORS=0

error() { echo "FAIL: $1" >&2; ERRORS=$((ERRORS + 1)); }
ok()    { echo "  OK: $1"; }

# Optionally rebuild first
if [[ "${1:-}" == "--build" ]]; then
  echo "Building web output..."
  pnpm web:build
  echo ""
fi

echo "=== Verifying web build output ==="

# 1. Check dist-web/ structure
if [[ ! -d "$DIST" ]]; then
  error "$DIST/ directory does not exist — run 'pnpm web:build' first"
  exit 1
fi
ok "$DIST/ exists"

if [[ ! -f "$DIST/web.html" ]]; then
  error "web.html entry point missing"
else
  ok "web.html entry point exists"
fi

if [[ ! -d "$DIST/assets" ]]; then
  error "assets/ directory missing"
else
  ok "assets/ directory exists"
fi

# 2. Verify HTML references real asset files
JS_REF=$(sed -n 's/.*src="\(\/assets\/[^"]*\.js\)".*/\1/p' "$DIST/web.html" | head -1)
CSS_REF=$(sed -n 's/.*href="\(\/assets\/[^"]*\.css\)".*/\1/p' "$DIST/web.html" | head -1)

if [[ -z "$JS_REF" ]]; then
  error "No JS asset reference found in web.html"
elif [[ ! -f "$DIST$JS_REF" ]]; then
  error "Referenced JS asset does not exist: $DIST$JS_REF"
else
  ok "JS asset exists: $JS_REF"
fi

if [[ -z "$CSS_REF" ]]; then
  error "No CSS asset reference found in web.html"
elif [[ ! -f "$DIST$CSS_REF" ]]; then
  error "Referenced CSS asset does not exist: $DIST$CSS_REF"
else
  ok "CSS asset exists: $CSS_REF"
fi

# 3. Verify no raw @tauri-apps imports leaked through (shims must handle them)
MAIN_JS="$DIST$JS_REF"
if [[ -n "$JS_REF" && -f "$MAIN_JS" ]]; then
  # Look for require("@tauri-apps/...) or from "@tauri-apps/... in the bundle
  # Shims should have replaced all of these at build time
  TAURI_LEAKS=$(grep -c '@tauri-apps/' "$MAIN_JS" 2>/dev/null || true)
  if [[ "$TAURI_LEAKS" -gt 0 ]]; then
    error "Found $TAURI_LEAKS raw @tauri-apps/ references in main bundle — shims may be incomplete"
  else
    ok "No raw @tauri-apps/ imports in main bundle (shims working)"
  fi
fi

# 4. Verify core app code is present in the bundle
if [[ -n "$JS_REF" && -f "$MAIN_JS" ]]; then
  for marker in "MainWindowLayout" "navigateToThread" "useThreadStore" "createRoot"; do
    if grep -q "$marker" "$MAIN_JS" 2>/dev/null; then
      ok "Core module present: $marker"
    else
      error "Core module missing from bundle: $marker"
    fi
  done
fi

# 5. Check bundle size is reasonable (not empty, not suspiciously small)
if [[ -n "$JS_REF" && -f "$MAIN_JS" ]]; then
  SIZE=$(wc -c < "$MAIN_JS")
  if [[ "$SIZE" -lt 100000 ]]; then
    error "Main JS bundle suspiciously small (${SIZE} bytes) — may be incomplete"
  else
    SIZE_KB=$((SIZE / 1024))
    ok "Main JS bundle size: ${SIZE_KB}KB"
  fi
fi

echo ""
if [[ "$ERRORS" -gt 0 ]]; then
  echo "FAILED: $ERRORS check(s) failed"
  exit 1
else
  echo "PASSED: All web build checks passed"
fi
