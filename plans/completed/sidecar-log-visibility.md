# Sidecar Log Visibility

Surface sidecar (Node.js WebSocket server) logs in the app's Logs tab, and log startup health status from Rust.

## Context

The sidecar uses raw `console.log`/`console.error` (5 calls across 2 files). These go to stdout/stderr of the child process, which Tauri pipes but never reads — so they're invisible unless running from a terminal.

Meanwhile, the sidecar already has a `logBuffer` + `EventBroadcaster` that powers the Logs tab via `web_log` commands. The sidecar just needs to use its own infrastructure to surface its own logs.

## Phases

- [x] Create sidecar logger utility
- [x] Replace console calls with logger
- [x] Log sidecar startup health from Rust

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create sidecar logger utility

Create `sidecar/src/lib/logger.ts` — a thin wrapper that:

1. Accepts a `State` reference (for access to `logBuffer` and `broadcaster`)
2. Exposes `info(message)`, `warn(message)`, `error(message)` methods
3. Each method:
   - Builds a `RawLogEntry` with `target: "sidecar"`, current timestamp, appropriate level
   - Pushes to `state.logBuffer`
   - Broadcasts `"log-event"` to all connected WS clients
   - Also calls `console.log`/`console.error` as fallback (useful in dev, and before WS clients connect)
4. Export a `createLogger(state: State)` function

Keep it simple — no log levels filtering, no formatting. Reuse the existing `toRawLogEntry` helper from `dispatch-misc.ts` (may need to extract it to a shared location, or just inline the construction since it's trivial).

**Note**: At server startup, the broadcaster has no subscribers yet, so early logs (like "listening on...") will only go to console + logBuffer. That's fine — the frontend fetches `get_buffered_logs` on init, so they'll appear when the Logs tab opens.

## Phase 2: Replace console calls with logger

**server.ts** (4 console.log calls):
- Create logger after `createState()`: `const log = createLogger(state)`
- Replace the 3 startup messages with a single `log.info(...)` — e.g. `listening on http://127.0.0.1:${PORT} (ws, ws/agent)`
- Replace the shutdown message: `log.info(\`${signal} received, shutting down\`)`

**ws-handler.ts** (1 console.error call):
- The handler receives `state` — create or pass a logger
- Replace `console.error` with `log.error`

## Phase 3: Log sidecar startup health from Rust

In `spawn_sidecar()` (`src-tauri/src/lib.rs:168-232`), the health check loop already exists. Adjust logging:

- **Already running** (line 177): Keep existing `tracing::info!` — good as-is
- **Health check passes** (line 223): Keep existing `tracing::info!` — good as-is
- **Health check times out** (line 230): Already `tracing::warn!` — good as-is

This is already handled well. The only change: after the health check passes, log the response body if it contains useful info (the `/health` endpoint returns `{status: "ok", port}`) — but this is low value. **Skip unless the existing logs feel insufficient during testing.**

No changes needed here unless we want to add structured fields. The current logging is appropriately quiet.
