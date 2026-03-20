# Progress 008

## Done

- Removed unused sidecar dependencies (`chokidar`, `proper-lockfile`) from `sidecar/package.json` — neither was imported anywhere in sidecar source.

## Remaining

- **EventBroadcaster is dead AND panel events are broken**: `broadcast.rs` uses a tokio broadcast channel with zero subscribers (since `subscribe()` was removed). All `broadcaster.broadcast()` calls in [panels.rs](http://panels.rs), [tray.rs](http://tray.rs), [clipboard.rs](http://clipboard.rs), [terminal.rs](http://terminal.rs), file_watcher.rs, logging/mod.rs are no-ops. The frontend listens for these events via WS (`src/lib/events.ts`), but they never arrive. This means panel events (`panel-hidden`, `spotlight-shown`, `open-control-panel`, `clipboard-entry-added`, `navigate`, `set-content-pane-view`, `show-error`) are silently broken in the Tauri app.
- **Fix approach (designed, not implemented)**: Delete `broadcast.rs`. Replace all `broadcaster.broadcast(event, payload)` calls with Tauri's native `app.emit(event, payload)`. Then update `event-bridge.ts` to listen for `RUST_PANEL_EVENTS` via `@tauri-apps/api/event` (real Tauri IPC in Tauri mode, no-op shim in web mode) instead of the WS-only `@/lib/events`. Files to change: `broadcast.rs` (delete), `panels.rs`, `tray.rs`, `clipboard.rs`, `terminal.rs`, `file_watcher.rs`, `logging/mod.rs`, `lib.rs` (remove managed state), `event-bridge.ts`.
- Full `pnpm tauri build` not tested.
- Sidecar bundling already works — tsup produces single 46KB `dist/server.js` with express/ws/mime-types bundled. Previous concern about `node_modules` not being bundled is resolved.

## Context

- `src/lib/events.ts` is WS-only (replaced `@tauri-apps/api/event`). All event listening goes through WS push events from sidecar. Rust `app.emit()` would use Tauri IPC which the frontend doesn't currently listen on for these events.
- In Tauri mode, `@tauri-apps/api/event` resolves to real Tauri package. In web mode (`vite.config.web.ts`), it's aliased to `src/lib/tauri-shims/api-event.ts` (no-op). So importing from `@tauri-apps/api/event` directly in `event-bridge.ts` for panel events is safe for both modes.
- `cargo check` passes with 0 warnings. All previous dead code already cleaned up.