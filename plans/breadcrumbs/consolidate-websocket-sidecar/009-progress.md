# Progress 009

## Done

- Deleted `broadcast.rs` — removed dead `EventBroadcaster` (tokio broadcast channel with zero subscribers).
- Replaced all `broadcaster.broadcast(event, payload)` calls with Tauri-native `app.emit(event, payload)` in: `panels.rs`, `tray.rs`, `clipboard.rs`, `terminal.rs`, `file_watcher.rs`, `logging/mod.rs`, `lib.rs`.
- Removed `EventBroadcaster` managed state from `lib.rs` and `mod broadcast` declaration.
- Changed `file_watcher.rs::start_watch_inner` signature from `&EventBroadcaster` to `&AppHandle`.
- Removed `broadcaster` field from `logging/mod.rs::LogBuffer`, now uses existing `app_handle` field with `app.emit()`.
- Updated `event-bridge.ts`: imported `listen as tauriListen` from `@tauri-apps/api/event`, used it in `registerTauriToMitt` so LOCAL_EVENTS arrive via Tauri IPC instead of dead WS path.
- Added "navigate" and "set-content-pane-view" to `RUST_PANEL_EVENTS` in event-bridge.ts.

## Remaining

- `cargo check` not yet run — changes compile-checked by reading but not verified.
- `main-window-layout.tsx` still uses `listen` from `@/lib/events` (WS) for "navigate" and "set-content-pane-view" — should be changed to `@tauri-apps/api/event` or use eventBus since these now arrive via Tauri IPC, not WS. The event-bridge forwards them to eventBus, but the component doesn't use eventBus for these.
- Terminal and file-watcher events: Rust now emits via `app.emit()`, but frontend listeners (`terminal-sessions/listeners.ts`, `file-watcher-client.ts`) still use WS `listen`. These features may be broken in current architecture since commands route to sidecar which lacks PTY/watcher.
- Full `pnpm tauri build` not tested.

## Context

- `@tauri-apps/api/event` resolves to real Tauri package in Tauri mode, no-op shim (`src/lib/tauri-shims/api-event.ts`) in web mode. Safe for both.
- Tauri `app.emit(event, payload)` requires `use tauri::Emitter;` — added in each file that calls it.
- Sidecar is fully independent Node.js — has no terminal PTY or file watcher. Terminal/file-watcher Tauri commands are not in `NATIVE_COMMANDS` set in `invoke.ts`, so they route to sidecar which can't handle them. This is a pre-existing issue.