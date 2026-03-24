# Sidecar Crash Resilience

Harden the sidecar WebSocket server against unhandled errors and add persistent crash logging so we can diagnose failures after the fact.

## Context

- The sidecar process has **no `uncaughtException` or `unhandledRejection` handlers** — any unhandled async error kills the process silently
- **Logs are in-memory only** (`state.logBuffer`) and broadcast over WebSocket — all lost on crash
- Tauri pipes sidecar stdout/stderr but **never reads them** — crash output is discarded
- `agent-hub.ts` message handlers are not try-caught — a throw in `forwardToFrontend`, `handleRelay`, or `sendToAgent` becomes an uncaught exception
- `agent-hub.ts` uses raw `console.warn` for seq gaps instead of the sidecar logger
- No `error` event listeners on `wss` or `wssAgent` WebSocket server instances
- The logger uses `target: "sidecar"` — we'll keep that as the target and use prefixed messages like `[ws]`, `[agent-hub]`, etc. for subsystem identification

## Phases

- [x] Add process-level error handlers and persistent crash log
- [x] Wrap agent-hub message handlers in try-catch
- [x] Add error listeners on WebSocket server instances
- [x] Route agent-hub logging through sidecar logger

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Process-level error handlers + persistent crash log

**Files:** `sidecar/src/server.ts`, `sidecar/src/logger.ts`

### Persistent log file

Add a `writeToLogFile(entry: LogEntry)` function in `logger.ts` that appends JSON lines to `~/.anvil/logs/sidecar.log` (or `$ANVIL_DATA_DIR/logs/sidecar.log`). Use `appendFileSync` for crash-safety — async writes may not flush before exit.

- Create the directory on first write if it doesn't exist
- Each line is a JSON-serialized `LogEntry`
- Keep it simple — no rotation for now (can add later if files get large)

Update `createLogger` to call `writeToLogFile` for every log entry alongside the existing buffer push and broadcast.

### Process error handlers in `server.ts`

Add these handlers after the existing `SIGTERM`/`SIGINT` block:

```ts
process.on("uncaughtException", (err) => {
  log.error(`[fatal] uncaughtException: ${err.stack ?? err.message}`);
  // flush is sync so this is safe
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  log.error(`[fatal] unhandledRejection: ${msg}`);
  // Don't exit — log and let the process continue
  // (rejection may be non-critical, e.g. a dropped socket write)
});
```

Key decisions:
- `uncaughtException` → log + exit (process is in undefined state)
- `unhandledRejection` → log but **don't exit** (many rejections are non-fatal, e.g. writing to a closed socket)

## Phase 2: Wrap agent-hub message handlers

**File:** `sidecar/src/managers/agent-hub.ts`

The `socket.on("message")` callback calls `forwardToFrontend` and `handleRelay` without try-catch. If either throws, it's an uncaught exception.

Wrap the message handler body:

```ts
socket.on("message", (data) => {
  try {
    // ... existing parse + dispatch logic
  } catch (err) {
    // log via a logger instance (see Phase 4)
    // don't rethrow — keep the connection alive
  }
});
```

Also: `sendToAgent` currently throws on missing/closed agent. The caller (`ws-handler` dispatch) does catch this, so it's fine — but add a log line before throwing so we have visibility.

## Phase 3: Add error listeners on WebSocket server instances

**File:** `sidecar/src/server.ts`

Add error handlers on both WebSocket server instances:

```ts
wss.on("error", (err) => {
  log.error(`[ws] server error: ${err.message}`);
});

wssAgent.on("error", (err) => {
  log.error(`[ws/agent] server error: ${err.message}`);
});
```

These catch errors at the server level (e.g. failed upgrades, EMFILE). Without these, Node emits `uncaughtException` for unhandled `error` events on EventEmitters.

## Phase 4: Route agent-hub logging through sidecar logger

**File:** `sidecar/src/managers/agent-hub.ts`

Currently `AgentHub` has no access to the logger — it uses raw `console.warn` for seq gaps and has no logging for other events.

Options:
1. Pass `SidecarLogger` into the `AgentHub` constructor (alongside `broadcaster`)
2. Have `AgentHub` accept a log function

Go with option 1 — pass the logger. Then:
- Replace `console.warn` seq gap log with `this.log.warn("[agent-hub] seq gap: ...")`
- Add `this.log.info("[agent-hub] agent registered: <threadId>")` in `register()`
- Add `this.log.warn("[agent-hub] ...")` in the Phase 2 catch block
- Add `this.log.info("[agent-hub] agent disconnected: <threadId>")` in socket close handler

This means `AgentHub` construction in `state.ts` needs to change — the logger must be created first, then passed to `AgentHub`. Since `createLogger` needs `SidecarState` (for the buffer/broadcaster), we'll need to create the broadcaster and logBuffer first, then the logger, then `AgentHub`.
