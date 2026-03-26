# Dev build preset
export ANVIL_APP_SUFFIX=dev
export ANVIL_VITE_PORT=1421
export ANVIL_WS_PORT=9601
export ANVIL_SPOTLIGHT_HOTKEY="Command+Shift+Space"
export ANVIL_CLIPBOARD_HOTKEY="Command+Shift+Option+C"
# Override ANVIL_DATA_DIR — it may be inherited from a running prod Anvil.app
export ANVIL_DATA_DIR="$HOME/.anvil-dev"
# Only skip main window if explicitly set (allows override with ANVIL_SKIP_MAIN_WINDOW=1 pnpm dev)
export ANVIL_SKIP_MAIN_WINDOW=${ANVIL_SKIP_MAIN_WINDOW-}
