#!/bin/bash
set -e

PRESET=${1:-prod}

# Source preset if it exists
if [ -f "scripts/env-presets/${PRESET}.sh" ]; then
  source "scripts/env-presets/${PRESET}.sh"
fi

echo "Starting Anvil with:"
echo "  ANVIL_APP_SUFFIX=${ANVIL_APP_SUFFIX:-<production>}"
echo "  ANVIL_VITE_PORT=${ANVIL_VITE_PORT:-1420}"
if [ -n "$ANVIL_SKIP_MAIN_WINDOW" ]; then
  echo "  ANVIL_SKIP_MAIN_WINDOW=1 (main window hidden on startup)"
fi

# Set TAURI_ARGS for non-production presets
if [ "$PRESET" != "prod" ] && [ -n "$PRESET" ]; then
  export TAURI_ARGS="--config src-tauri/tauri.conf.${PRESET}.json"
fi

# Build SDK runner (similar to how agents are built)
echo "Building SDK runner..."
pnpm build:sdk

if [ "$ANVIL_DISABLE_HMR" = "true" ]; then
  echo "  ANVIL_DISABLE_HMR=true (manual refresh mode)"
  pnpm dev:run:no-hmr
else
  pnpm dev:run
fi
