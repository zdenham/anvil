# Dev build preset
export MORT_APP_SUFFIX=dev
export MORT_VITE_PORT=1421
export MORT_WS_PORT=9601
export MORT_SPOTLIGHT_HOTKEY="Command+Shift+Space"
export MORT_CLIPBOARD_HOTKEY="Command+Shift+Option+C"
# Only skip main window if not explicitly set (allows override with MORT_SKIP_MAIN_WINDOW= pnpm dev)
export MORT_SKIP_MAIN_WINDOW=${MORT_SKIP_MAIN_WINDOW-1}
