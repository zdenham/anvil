#!/bin/bash
set -e

# Prevent DMG from auto-opening in Finder after build
export CI=true

PRESET=${1:-prod}

# Source preset if it exists
if [ -f "scripts/env-presets/${PRESET}.sh" ]; then
  source "scripts/env-presets/${PRESET}.sh"
fi

echo "Building Anvil with:"
echo "  ANVIL_APP_SUFFIX=${ANVIL_APP_SUFFIX:-<production>}"
echo "  ANVIL_SPOTLIGHT_HOTKEY=${ANVIL_SPOTLIGHT_HOTKEY:-Command+Space}"
echo "  ANVIL_CLIPBOARD_HOTKEY=${ANVIL_CLIPBOARD_HOTKEY:-Command+Option+C}"

pnpm build:frontend

if [ "$PRESET" = "prod" ] || [ -z "$PRESET" ]; then
  pnpm tauri build
else
  pnpm tauri build --config "src-tauri/tauri.conf.${PRESET}.json"
fi

echo "Build complete: src-tauri/target/release/bundle/macos/"
