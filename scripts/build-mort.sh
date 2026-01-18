#!/bin/bash
set -e

# Prevent DMG from auto-opening in Finder after build
export CI=true

PRESET=${1:-prod}

# Source preset if it exists
if [ -f "scripts/env-presets/${PRESET}.sh" ]; then
  source "scripts/env-presets/${PRESET}.sh"
fi

echo "Building Mort with:"
echo "  MORT_APP_SUFFIX=${MORT_APP_SUFFIX:-<production>}"
echo "  MORT_SPOTLIGHT_HOTKEY=${MORT_SPOTLIGHT_HOTKEY:-Command+Space}"
echo "  MORT_CLIPBOARD_HOTKEY=${MORT_CLIPBOARD_HOTKEY:-Command+Option+C}"

pnpm build:frontend

if [ "$PRESET" = "prod" ] || [ -z "$PRESET" ]; then
  tauri build
else
  tauri build --config "src-tauri/tauri.conf.${PRESET}.json"
fi

echo "Build complete: src-tauri/target/release/bundle/macos/"
