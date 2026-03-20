# Progress 010

## Done

- Fixed all frontend event listeners that were still using dead WS `listen` from `@/lib/events` for events that now arrive via Tauri IPC (`app.emit()`):
  - `main-window-layout.tsx`: "navigate" and "set-content-pane-view" switched to `eventBus` (already bridged by event-bridge from Tauri IPC).
  - `terminal-sessions/listeners.ts`, `terminal-content.tsx`: "terminal:output/exit/killed" switched to `@tauri-apps/api/event` (tauriListen).
  - `file-watcher-client.ts`: "file-watcher:changed" switched to `@tauri-apps/api/event`.
  - `logs/service.ts`: "log-event" switched to `@tauri-apps/api/event`.
- Added "navigate" and "set-content-pane-view" types to `LocalEvents` in `entities/events.ts`.
- Removed unused `Manager` imports from `clipboard.rs` and `logging/mod.rs` — cargo check now 0 warnings.
- **Full** `pnpm tauri build` **passes** — production DMG bundle builds successfully. First time verified in this breadcrumb series.
- All verification checks pass: cargo check (0 warnings), tsc --noEmit, pnpm web:build, sidecar tests (4/4), pnpm tauri build.

## Remaining

- `scripts/verify-web-build.sh` is missing (referenced by `pnpm verify:web` but file doesn't exist). Was either never committed or lost between iterations.
- Only 2 files still use WS `listen` from `@/lib/events`: `agent-service.ts` (agent events from sidecar) and `event-bridge.ts` (broadcast events). Both are correct — these events flow through sidecar WS.
- Terminal/file-watcher features won't work in **web-only mode** (no Tauri) since sidecar has no PTY/watcher support. `@tauri-apps/api/event` resolves to no-op shim in web mode. This is pre-existing and by design — terminal/watcher are Tauri-native features.

## Context

- `@tauri-apps/api/event` has the same `listen<T>(event, callback) → Promise<UnlistenFn>` API shape as `@/lib/events`, with compatible `{ payload: T }` callback pattern. The migration was a one-line import swap per file.
- `eventBus` (mitt) for main-window-layout required adding event types to `LocalEvents` and changing from `event.payload` to direct payload parameter (mitt passes payload directly, not wrapped in event object).