# 01: Agent-Side Pipeline, Heartbeat, Connection Health & Reconnection

**Depends on**: 00-shared-types
**Parallel with**: 02-rust-hub, 03-frontend
**Blocks**: 04-integration

## Overview

Instrument the Node.js agent process to:
1. Stamp every outgoing message with pipeline metadata and a monotonic sequence number
2. Emit periodic heartbeats so the frontend can detect staleness
3. Track connection health (write failures, backpressure)
4. Reconnect to the hub on disconnect instead of dying via `process.exit(1)`

All per-message diagnostic logging is opt-in via `MORT_DIAGNOSTIC_LOGGING` env var (JSON-encoded `DiagnosticLoggingConfig`). Always-on logging is limited to status transitions, errors, and a one-line session summary on completion.

## Phases

- [x] Add sequence counter and pipeline stamping to HubClient `send()`
- [x] Add diagnostic config parsing from `MORT_DIAGNOSTIC_LOGGING` env var
- [x] Add socket health diagnostic logging (write failures, backpressure, periodic stats)
- [x] Create heartbeat module and integrate with HubClient
- [x] Add connection health tracking to HubConnection (write failure counter, health getter)
- [x] Add reconnection logic to HubClient with bounded queue
- [x] Update runner.ts: start heartbeat, replace exit-on-disconnect with reconnect + reconnected handler
- [x] Update output.ts: check connectionState for smarter logging (log once on transition, not every write)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Pipeline Stamping (`agents/src/lib/hub/client.ts`)

- Add `private seq = 0` counter to `HubClient`
- Every `send()` call attaches `pipeline: [{ stage: "agent:sent", seq: ++this.seq, ts: Date.now() }]` to the outgoing message
- Covers state, event, heartbeat, and optimistic_stream messages
- Track `totalSent`, `totalWriteFailures`, `totalBackpressureEvents` counters
- **When `diagnosticConfig.pipeline` enabled**: `logger.debug` each message's seq and type
- **When disabled**: No per-message logging. Seq counter still increments (needed for gap detection)
- **Always-on**: Log session summary on completion/error: `[hub] session summary: totalSent=847, writeFailures=0, backpressureEvents=3, maxQueueDepth=12`

### Diagnostic Config Parsing

- Parse `process.env.MORT_DIAGNOSTIC_LOGGING` at HubClient construction (or a shared init point)
- Use Zod schema from `core/types/diagnostic-logging.ts` for safe parsing
- If env var absent or invalid JSON, default all modules to `false`
- Store parsed config as `private diagnosticConfig: DiagnosticLoggingConfig`
- Add handler for `diagnostic:config` relay message from hub — updates `diagnosticConfig` at runtime (auto-enable on staleness)

### Socket Health Logging (`agents/src/lib/hub/connection.ts` + `client.ts`)

- **When `diagnosticConfig.socketHealth` enabled**:
  - Log every `write()` result — success with seq, failure with seq + queue depth + `isConnected` state
  - Log backpressure events: when `socket.write()` returns `false` (draining starts), when `drain` fires (draining ends), and queue depth at both points
  - Log periodic stats every 30s: `[hub] stats: sent=142, writeFailures=0, backpressure=1, queueDepth=0`
- **When disabled**: Counters still increment (needed for always-on summary)

### Heartbeat (`agents/src/lib/hub/heartbeat.ts`)

New file, keeps heartbeat timer logic separate from HubClient:

```typescript
// agents/src/lib/hub/heartbeat.ts
export class HeartbeatEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private sendFn: (msg: { type: string; timestamp: number }) => void,
    private intervalMs = 5000,
  ) {}

  start(): void { /* setInterval calling sendFn */ }
  stop(): void { /* clearInterval */ }
}
```

- HubClient creates `HeartbeatEmitter`, passing `this.send.bind(this)` as `sendFn`
- Heartbeat message: `{ type: "heartbeat", timestamp: Date.now() }` — pipeline stamp added automatically by `send()`
- Timer cleaned up on `disconnect()` / `gracefulDisconnect()`
- If `write()` returns `false` during heartbeat, always log warning (first sign of trouble)
- **When `diagnosticConfig.heartbeat` enabled**: Log heartbeat send with seq and timestamp

### Connection Health Tracking (`agents/src/lib/hub/connection.ts`)

- Add `private consecutiveWriteFailures = 0` counter
- On successful `write()`, reset counter to 0
- On failed `write()` (returns false or throws), increment counter and always log warning
- Emit `connection:write-failure` event with failure count
- After `maxConsecutiveFailures` (default 3), emit `connection:unhealthy`
- New getter: `get connectionHealth(): 'healthy' | 'degraded' | 'disconnected'`

### Reconnection (`agents/src/lib/hub/client.ts`)

```typescript
private async reconnect(): Promise<boolean> {
  if (this.connectionState === 'reconnecting') return false;
  this.connectionState = 'reconnecting';
  this.stopHeartbeat();
  this.connection.destroy();
  this.connection = new HubConnection();
  // Re-wire event handlers...

  try {
    await withRetry(
      () => this.connection.connect(this.socketPath),
      { maxRetries: 5, baseDelayMs: 500 } // ~500ms, 1s, 2s, 4s, 8s
    );
    this.send({ type: "register", ...(this.parentId && { parentId: this.parentId }) });
    this.connectionState = 'connected';
    this.startHeartbeat();
    this.flushReconnectQueue();
    this.emit("reconnected");
    return true;
  } catch {
    this.connectionState = 'disconnected';
    this.emit("disconnect");
    return false;
  }
}
```

- New `connectionState: 'connected' | 'reconnecting' | 'disconnected'` on HubClient
- **Reconnect queue**: `reconnectQueue: SocketMessage[]`, max 50 messages. During `reconnecting`, `send()` pushes to queue. Smart dedup: only keep latest `state` message per threadId, but keep all `event` messages.
- **Socket file check**: Before reconnect, check if `~/.mort/agent-hub.sock` exists. If gone, skip reconnect (app quit).

### Runner Integration (`agents/src/runner.ts`)

Replace current disconnect handler:
```typescript
// Before: hub.on("disconnect", () => process.exit(1))
// After:
hub.on("disconnect", () => {
  if (isShuttingDown) return;
  logger.warn("[runner] Hub disconnected — agent will continue, state written to disk only");
});
hub.on("reconnected", () => {
  logger.info("[runner] Hub reconnected — resuming live state emission");
  emitState(); // Emit current state immediately so UI catches up
});
```

Start heartbeat after hub connection:
```typescript
await hub.connect();
hub.startHeartbeat(); // Only for root-level agents, not sub-agents via Task tool
```

### Output Awareness (`agents/src/output.ts`)

- Check `hub.connectionState` instead of just `hub.isConnected`
- If `reconnecting` → queue writes (bounded buffer, 100 messages)
- If `disconnected` → log once on transition, then silently drop
- Avoids the current pattern of logging "not connected" on every single write attempt

## Key Decisions

- **Heartbeat is opt-in per agent**: Only root-level agents call `startHeartbeat()`. Sub-agents spawned via Task tool don't need heartbeats (parent handles their state).
- **Disconnect no longer kills the agent**: The API call may be in-flight and expensive. Agent keeps running, keeps writing to disk. Frontend detects staleness via missing heartbeats and recovers from disk.
- **Bounded reconnect retry**: 5 attempts, exponential backoff (~15s total). Quick enough to catch a Tauri restart, fast enough to give up if the app is truly gone.
- **Smart reconnect queue**: State messages deduplicated (only latest per thread), event messages preserved. Prevents stale state flood on reconnect.
- **Diagnostic config hot-reload**: Runtime update via `diagnostic:config` relay message, so auto-enable-on-staleness works for already-running agents.

## Files

| Action | File | Description |
|--------|------|-------------|
| Modify | `agents/src/lib/hub/client.ts` | Seq counter, pipeline stamping, heartbeat start/stop, reconnection, connectionState, diagnostic config relay |
| Modify | `agents/src/lib/hub/connection.ts` | Write failure tracking, connectionHealth getter, backpressure events |
| Create | `agents/src/lib/hub/heartbeat.ts` | HeartbeatEmitter class (timer logic) |
| Modify | `agents/src/runner.ts` | Start heartbeat, replace exit-on-disconnect, add reconnected handler |
| Modify | `agents/src/output.ts` | Check connectionState for smarter logging |
