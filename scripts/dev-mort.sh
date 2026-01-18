#!/bin/bash
set -e

PRESET=${1:-prod}

# Source preset if it exists
if [ -f "scripts/env-presets/${PRESET}.sh" ]; then
  source "scripts/env-presets/${PRESET}.sh"
fi

echo "Starting Mort with:"
echo "  MORT_APP_SUFFIX=${MORT_APP_SUFFIX:-<production>}"
echo "  MORT_VITE_PORT=${MORT_VITE_PORT:-1420}"
if [ -n "$MORT_SKIP_MAIN_WINDOW" ]; then
  echo "  MORT_SKIP_MAIN_WINDOW=1 (main window hidden on startup)"
fi

# Set TAURI_ARGS for non-production presets
if [ "$PRESET" != "prod" ] && [ -n "$PRESET" ]; then
  export TAURI_ARGS="--config src-tauri/tauri.conf.${PRESET}.json"
fi

if [ "$MORT_DISABLE_HMR" = "true" ]; then
  echo "  MORT_DISABLE_HMR=true (manual refresh mode)"
  pnpm dev:run:no-hmr
else
  pnpm dev:run
fi
