# Event Heartbeat & Dropped Event Diagnostics

## Problem

The UI sometimes stops receiving events from the agent while the agent is still running. The agent continues working in the background (producing output, making API calls), but the UI appears frozen. There is no heartbeat system, no sequence numbering, and no way to detect or recover from this state.

## Root Cause Analysis

**Critical observation**: The agent has NOT disconnected from the socket. We know this because `runner.ts:231-240` calls `process.exit(1)` on socket disconnect — if the socket had died, the agent process would have died too. Since the agent keeps running, the socket connection is alive. This means **the problem is downstream of the socket write**.

The event pipeline has **5 stages**:

```
Agent (Node.js) → Socket Write → AgentHub (Rust) → Tauri emit → Frontend listener
     [1]              [2]              [3]              [4]            [5]
```

**Stages 1-2 are likely NOT the problem** — the agent is still running, which means the socket is connected and the agent is still writing to it. The most likely culprits are stages 3-5.

### Stage 3: Rust AgentHub message forwarding (LIKELY)
- `agent_hub.rs:275` — `app_handle.emit("agent:message", &msg)` is fire-and-forget
- If `emit()` fails, only a `tracing::warn` is logged — no retry, no feedback to the agent
- The Rust reader thread (line 213, `reader.lines()`) is blocking — if JSON parsing fails on one line (`serde_json::from_str`, line 217-284), that message is silently dropped and reading continues
- **Key question**: Can `app_handle.emit()` silently fail or buffer indefinitely? Tauri's emit is async under the hood — if the webview's IPC channel is backed up, messages may queue in Rust memory with no bound

### Stage 4: Tauri event delivery to webview (MOST LIKELY)
- Tauri's `emit()` sends events to **all webview windows** via IPC
- This app has multiple windows: spotlight, clipboard, error panel, control panel, plus the main window
- If any webview is frozen, sleeping, or slow to process its event queue, it could create backpressure in Tauri's IPC layer
- **Webview busy loop**: If the main window's JS thread is blocked (heavy render, synchronous operation), incoming Tauri events queue up. If the queue gets too large or the blockage lasts too long, events may be silently dropped
- **No delivery confirmation**: Tauri `emit()` returns `Result` but only for serialization errors, not delivery failures

### Stage 5: Frontend event processing (POSSIBLE)
- The `agent:message` listener (`agent-service.ts:79`) processes events synchronously
- The event bridge (`event-bridge.ts`) re-broadcasts to all windows via `emit(app:eventName, payload)` — another Tauri `emit()` for cross-window sync
- This creates a **double-emit pattern**: Rust emits `agent:message` → frontend receives → frontend re-broadcasts via `app:agent:state` → other windows receive. If one window is slow, this amplifies the problem
- mitt eventBus handlers are synchronous — an exception in one handler breaks the chain for all subsequent handlers of that event
- No error boundaries around event processing

### Stage 1-2: Agent / Socket (UNLIKELY given agent is alive, but worth instrumenting)
- `output.ts:140`: `hubClient?.isConnected` check silently drops state if somehow `isConnected` returns false while socket is still alive (e.g., Node.js socket object in weird state)
- `connection.ts:79-82`: Backpressure handling — if `socket.write()` returns false, messages queue. If drain never fires, queue grows unbounded
- `stream-accumulator.ts:83`: Same `isConnected` check — streaming silently stops

## Phases

- [ ] Add pipeline stage tracking with string enum stamps at every hop (agent, Rust, frontend) with opt-in diagnostic logging
- [ ] Add heartbeat emission from agent process (Node.js side)
- [ ] Add heartbeat monitoring in frontend with stale detection and diagnostic logging
- [ ] Add disk-based state recovery when heartbeat staleness or sequence gaps detected
- [ ] Add diagnostic UI for connection health with pipeline tracing toggle
- [ ] Add agent-side disconnect awareness and connection health tracking
- [ ] Add socket reconnection with re-registration (separate concern from the drop bug)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Cross-Cutting: Diagnostic Logging Strategy

All pipeline diagnostic logging is **opt-in** and controlled by per-module settings. Rather than a single boolean, diagnostic logging uses a **module map** — each subsystem can be independently toggled. This prevents noisy logs during normal operation while letting you enable exactly the diagnostic data you need.

**Global setting**: `~/.mort/settings/diagnosticLogging.json`
- Value: `DiagnosticLoggingConfig` object (see below)
- Persisted via existing `SettingsStoreClient` pattern (one JSON file per setting key)

```typescript
// core/types/diagnostic-logging.ts
export interface DiagnosticLoggingConfig {
  pipeline: boolean;      // Per-message pipeline stage stamps at every hop (agent→hub→frontend)
  heartbeat: boolean;     // Heartbeat timing details: jitter, latency between agent timestamp and receipt
  sequenceGaps: boolean;  // Detailed sequence gap context (beyond the always-on gap warnings)
  socketHealth: boolean;  // Write failures, backpressure stats, connection state details
}

export const DEFAULT_DIAGNOSTIC_LOGGING: DiagnosticLoggingConfig = {
  pipeline: false,
  heartbeat: false,
  sequenceGaps: false,
  socketHealth: false,
};

/** Helper: true if any module is enabled */
export function isDiagnosticEnabled(config: DiagnosticLoggingConfig): boolean {
  return Object.values(config).some(Boolean);
}
```

**Readable from all three layers**:
- **Frontend**: `settingsStoreClient.getOrDefault("diagnosticLogging", DEFAULT_DIAGNOSTIC_LOGGING)` — modules checked individually (`config.pipeline`, `config.heartbeat`, etc.)
- **Agent (Node.js)**: Env var `MORT_DIAGNOSTIC_LOGGING` set to JSON string on spawn (e.g., `'{"pipeline":true,"heartbeat":false,...}'`). Parsed once at agent startup into a `DiagnosticLoggingConfig`. If env var is absent or invalid, all modules default to `false`.
- **Rust AgentHub**: Read env var `MORT_DIAGNOSTIC_LOGGING` (same JSON string) at init. Store parsed config in Tauri managed state. Individual module checks via helper methods.

**Auto-enable on heartbeat drop detection**: When the frontend heartbeat monitor transitions a thread to `stale` status:
1. Automatically enable **all modules** via `settingsStoreClient.set("diagnosticLogging", { pipeline: true, heartbeat: true, sequenceGaps: true, socketHealth: true })`
2. Notify connected agents via a new `diagnostic:config` relay message through the hub with the full config (so in-flight agents update their module flags without restart)
3. Update Rust-side managed state via Tauri command so the hub starts logging immediately
4. Log a single `logger.warn("[diagnostics] Auto-enabled all diagnostic modules due to heartbeat staleness")` so it's visible in the log panel

**Manual toggle**: The diagnostic UI panel (Phase 5) exposes **per-module toggles** so you can:
- Enable just `pipeline` to trace message flow without heartbeat noise
- Enable just `socketHealth` to investigate write failures
- Enable all modules for full investigation
- Disable individual modules after narrowing down the issue

**What each module logs when enabled**:
- `pipeline` — Every pipeline stage stamp on every message (agent:sent, hub:received, hub:emitted, frontend:received with timestamps and latency between hops)
- `heartbeat` — Heartbeat timing details: jitter between expected and actual interval, round-trip latency from agent timestamp to frontend receipt
- `sequenceGaps` — Detailed gap context: full pipeline trail of the message after the gap, expected vs actual seq, estimated number of dropped messages
- `socketHealth` — Agent-side: per-write success/failure with seq, backpressure events (socket.write returning false + drain timing), write queue depth, periodic stats summary every 30s (`totalSent`, `writeFailures`, `backpressureEvents`, `queueDepth`). Rust-side: per-agent connection stats. This module confirms the agent is actively pushing data even when the frontend isn't receiving it.

**What always logs regardless of module settings** (low-volume, high-signal):
- Heartbeat status transitions (`healthy → degraded → stale`) — rare, actionable events
- Sequence gap warnings at any pipeline stage — always surfaced because gaps indicate data loss
- Agent-side session summary on completion — one line: `totalSent`, `writeFailures`, `backpressureEvents`, `maxQueueDepth` (confirms agent was healthy even if UI froze)
- Connection state changes (`connected → reconnecting → disconnected`)
- Errors (write failures, emit failures) — always `logger.warn` or `logger.error`

### 1. Pipeline Stage Tracking (Diagnostic First)

The most important thing is to **find where events are being dropped**. Rather than opaque numeric sequence IDs, every message gets stamped with a **pipeline stage enum** at each hop, plus a monotonic sequence number. The stage enum makes logs immediately readable — you see `"agent:sent"`, `"hub:received"`, `"hub:emitted"`, `"frontend:received"` instead of comparing numbers across three log sources.

**Pipeline stage enum** (shared type in `core/types/`):
```typescript
// core/types/pipeline.ts
export type PipelineStage =
  | "agent:sent"        // Agent wrote message to socket
  | "hub:received"      // Rust hub parsed the message from socket
  | "hub:emitted"       // Rust hub called app_handle.emit()
  | "frontend:received" // Frontend agent:message listener fired

export interface PipelineStamp {
  stage: PipelineStage;
  seq: number;          // Monotonic per-agent sequence number
  ts: number;           // Timestamp at this stage (ms since epoch)
}
```

Each layer adds its stamp to a `pipeline` array on the message. By the time the frontend receives a message, it has a full trail: `[agent:sent@seq=42@t=1000, hub:received@seq=42@t=1002, hub:emitted@seq=42@t=1003]` and the frontend adds `frontend:received@seq=42@t=1010`. Gaps in `seq` at any stage immediately tell you where events were lost.

**Agent side** (`agents/src/lib/hub/client.ts` + `agents/src/lib/hub/connection.ts`):
- Add `private seq = 0` counter to `HubClient`
- Every `send()` call attaches `pipeline: [{ stage: "agent:sent", seq: ++this.seq, ts: Date.now() }]` to the outgoing message
- This covers state, event, heartbeat, and optimistic_stream messages
- Track `totalSent`, `totalWriteFailures`, `totalBackpressureEvents` counters on `HubClient`
- **When `diagnosticConfig.pipeline` is enabled**: `logger.debug` each message's seq and type (e.g., `[hub] sent seq=42 type=state`)
- **When `diagnosticConfig.socketHealth` is enabled**:
  - Log every `write()` result — success with seq, or failure with seq + queue depth + `isConnected` state
  - Log backpressure events: when `socket.write()` returns `false` (draining starts), when `drain` fires (draining ends), and the queue depth at both points
  - Log periodic stats every 30s: `[hub] stats: sent=142, writeFailures=0, backpressure=1, queueDepth=0`
- **When disabled**: No per-message logging. Seq counter still increments (needed for gap detection). Counters still increment (needed for always-on summary at completion)
- **Always-on**: Log a summary when agent completes or errors: `[hub] session summary: totalSent=847, writeFailures=0, backpressureEvents=3, maxQueueDepth=12`. This is one line per agent lifecycle — negligible noise, high value if something went wrong

**Rust AgentHub** (`src-tauri/src/agent_hub.rs`):
- On receipt of each message from an agent, append `{ stage: "hub:received", seq: <from msg>, ts: <now> }` to the `pipeline` array in the JSON
- Track `last_seq` per agent in the handler — if gap detected, always log a `tracing::warn` (gaps are rare enough to always surface)
- After successful `app_handle.emit()`, append `{ stage: "hub:emitted", seq: <from msg>, ts: <now> }` to the pipeline array
- If `emit()` returns Err, always log `tracing::warn` with the seq that was dropped
- **When `pipeline` module is enabled** (from `MORT_DIAGNOSTIC_LOGGING` env var): `tracing::debug` every message's seq and type at both receive and emit points
- **When disabled**: Only gap warnings and emit errors are logged

**Frontend** (`src/lib/agent-service.ts`):
- On each incoming `agent:message`, add `{ stage: "frontend:received", seq: msg.pipeline[0].seq, ts: Date.now() }` to the pipeline array
- Track `lastSeq` per `threadId` in heartbeat store
- Check for gaps: if `msg.pipeline[0].seq > lastSeq + 1` → always log warning with exact gap range and pipeline trail
  - Example: `"[agent-service] SEQ GAP: expected 42, got 47 — 5 events dropped. Last seen stages: hub:emitted@seq=41"`
  - This pinpoints drops to **Stage 4** (Tauri emit → webview) if Rust logs show it emitted seq 42-46 but frontend only sees 47
- **When `diagnosticConfig.pipeline` is enabled**: Log every message's full pipeline trail (all stages with timestamps, showing latency between hops)
- **When disabled**: Only gap warnings are logged
- Accumulate gap stats per thread for the summary log on agent completion

**Why this is Phase 1**: Without pipeline stage tracking, heartbeats only tell us "something stopped" — they can't tell us WHERE in the pipeline events are being lost. The stage enum at all four checkpoints (agent:sent, hub:received, hub:emitted, frontend:received) triangulates the exact failure point. And because the detailed per-message logging is opt-in, this has zero noise cost in normal operation.

### 2. Heartbeat: Agent → Hub → UI

**Agent side** (`agents/src/lib/hub/client.ts`):
- New method `startHeartbeat(intervalMs = 5000)` on `HubClient`
- Sends `{ type: "heartbeat", timestamp: Date.now(), pipeline: [{ stage: "agent:sent", seq: N, ts: Date.now() }] }` at regular intervals
- Heartbeat includes the same monotonically increasing sequence number as all other messages (via the pipeline stamp)
- Heartbeat interval timer is cleaned up on `disconnect()` / `gracefulDisconnect()`
- If `write()` returns `false`, always log a warning (first sign of trouble — rare enough to always surface)
- **When `diagnosticConfig.heartbeat` enabled**: Log heartbeat send with seq and timestamp

**Rust AgentHub** (`src-tauri/src/agent_hub.rs`):
- Heartbeat messages are forwarded to frontend via `app_handle.emit("agent:message", &msg)` — same as any other non-register, non-relay message, **no special handling needed**
- The seq tracking from Phase 1 automatically covers heartbeats too

**Frontend** (`src/lib/agent-service.ts` + new `src/stores/heartbeat-store.ts`):
- New `heartbeat` case in the `agent:message` listener switch statement
- New `heartbeat-store.ts` (Zustand):
  ```typescript
  interface HeartbeatState {
    // threadId → last heartbeat info
    heartbeats: Record<string, {
      lastTimestamp: number;     // agent-side timestamp
      lastReceivedAt: number;    // local receipt time
      lastSeq: number;           // sequence number
      missedCount: number;       // consecutive missed heartbeats
      status: 'healthy' | 'degraded' | 'stale';
    }>;
  }
  ```
- Monitoring interval (every 3s) checks `Date.now() - lastReceivedAt`:
  - `< 8s` → healthy (allows for 1 missed heartbeat + jitter)
  - `8-15s` → degraded (2-3 missed heartbeats)
  - `> 15s` → stale (event pipeline broken)
- On transition to `stale`:
  - Trigger disk-based state recovery (read `state.json`)
  - **Auto-enable all diagnostic modules** if not already fully enabled (see Cross-Cutting section above)
  - This means all subsequent messages from the still-running agent will be fully traced
- On transition to `degraded`, show subtle UI indicator
- On transition back to `healthy` from `stale`: do NOT auto-disable diagnostic logging (leave it on so the developer can review the captured data; manual disable via UI)
- Clean up heartbeat tracking when `AGENT_COMPLETED` or `AGENT_CANCELLED` fires

### 3. Disk-Based State Recovery

When the frontend detects missed events (via heartbeat staleness or sequence gaps):
- Read `~/.mort/threads/{threadId}/state.json` directly from disk
- Compare disk state timestamp with last received state timestamp
- If disk is newer, emit a synthetic `AGENT_STATE` event with the disk state
- This is the existing "disk as truth" pattern — heartbeat just triggers the recovery

**Implementation** (`src/entities/threads/listeners.ts` or new `src/lib/state-recovery.ts`):
```typescript
async function recoverStateFromDisk(threadId: string): Promise<void> {
  const state = await threadService.loadThreadState(threadId);
  if (state) {
    eventBus.emit(EventName.AGENT_STATE, { threadId, state });
  }
}
```

**Polling fallback**: If heartbeats go stale, start polling `state.json` from disk every 3 seconds until the agent completes. This ensures the UI always catches up even if the event pipeline is completely broken. Stop polling when heartbeats resume or agent completes.

### 4. Diagnostic UI

**Status indicator** (in thread header or status bar):
- Small dot next to agent status that reflects heartbeat health
- Green (healthy), Yellow (degraded), Red (stale)
- Tooltip shows: last heartbeat time, sequence number, missed count, gaps detected
- Only visible when agent is running (status === "running")

**Optional: Connection debug panel** (dev-only or behind setting):
- Show per-thread: heartbeat status, last seq, total gaps detected, recovery count
- Show AgentHub connected agents list (via existing `list_connected_agents` invoke)
- Show last N sequence gaps with timestamps (helps correlate with what the agent was doing when drops happened)
- **Diagnostic logging toggles**: Per-module switches for `pipeline`, `heartbeat`, `sequenceGaps`, `socketHealth`. Each shows current state (on/off) and whether it was auto-enabled by staleness detection. An "Enable All" / "Disable All" shortcut at the top. Shows a badge if any modules were auto-enabled.

### 5. Agent-Side Disconnect Awareness

> **NOTE**: This phase and the next (reconnection) address a separate issue from the main dropped-events bug. The agent currently stays connected while events are being lost. However, disconnect handling is still broken and worth fixing — if the socket ever does disconnect, the agent dies immediately (`process.exit(1)`) which wastes in-flight API calls.

**Current behavior** is dangerously binary — the agent has no concept of degraded connectivity:
- `runner.ts:231-240`: On socket `disconnect` event → `process.exit(1)` after 100ms delay
- `connection.ts:65-67`: `write()` returns `false` silently if socket is destroyed
- `output.ts:140`: `hubClient?.isConnected` silently drops state, logs nothing useful
- Every `isConnected` check across the codebase (12+ callsites) silently swallows the failure

The agent should know when its connection is unhealthy and surface that information, both for its own decision-making and for diagnostics.

**Connection health tracking** (`agents/src/lib/hub/connection.ts`):
- Add `private consecutiveWriteFailures = 0` counter
- On successful `write()`, reset counter to 0
- On failed `write()` (returns false or throws), increment counter and log a warning
- Emit `connection:write-failure` event with failure count
- After `maxConsecutiveFailures` (default 3), emit `connection:unhealthy`
- New getter: `get connectionHealth(): 'healthy' | 'degraded' | 'disconnected'`

**Runner-level awareness** (`agents/src/runner.ts`):
- Listen to `connection:unhealthy` — log prominently, but don't exit yet
- Change the disconnect handler: instead of immediate `process.exit(1)`, first attempt reconnection (see below)
- New state on HubClient: `connectionState: 'connected' | 'reconnecting' | 'disconnected'`
- Expose `connectionState` so `output.ts` and `stream-accumulator.ts` can make smarter decisions:
  - If `reconnecting` → queue writes (bounded buffer, say 100 messages)
  - If `disconnected` → log once, then silently drop (current behavior, but now intentional)

### 6. Socket Reconnection

**Why this matters**: The current `disconnect → exit(1)` behavior means the agent process dies and the UI shows a cryptic error. The Anthropic API call may still be in-flight, wasting the response. A reconnect lets the agent keep running and resume sending state to the UI.

**When reconnection makes sense**:
- Tauri app restarts/reloads (HMR in dev, or frontend crash + reload in prod)
- AgentHub socket is briefly unavailable (unlikely but possible during Tauri lifecycle)
- macOS sleep/wake causes socket interruption

**When reconnection does NOT make sense**:
- Agent is intentionally shutting down (cancel, completion, SIGTERM)
- Tauri app fully quit (socket file removed)

**Implementation** (`agents/src/lib/hub/client.ts`):
```typescript
private async reconnect(): Promise<boolean> {
  if (this.connectionState === 'reconnecting') return false; // already trying
  this.connectionState = 'reconnecting';

  // Stop heartbeat during reconnect (avoids writes to dead socket)
  this.stopHeartbeat();

  // Destroy old connection
  this.connection.destroy();
  this.connection = new HubConnection();
  // Re-wire event handlers
  this.connection.on("message", (msg) => this.emit("message", msg));
  this.connection.on("disconnect", () => this.handleDisconnect());
  this.connection.on("error", (err) => this.emit("error", err));

  // Attempt reconnect with existing retry logic
  try {
    await withRetry(
      () => this.connection.connect(this.socketPath),
      { maxRetries: 5, baseDelayMs: 500 } // ~500ms, 1s, 2s, 4s, 8s
    );

    // Re-register with hub (agent needs to re-identify itself)
    this.send({
      type: "register",
      ...(this.parentId && { parentId: this.parentId }),
    });

    this.connectionState = 'connected';

    // Resume heartbeat with continued sequence numbers
    this.startHeartbeat();

    // Flush any queued messages from the reconnecting period
    this.flushReconnectQueue();

    logger.info("[hub] Reconnected to AgentHub successfully");
    this.emit("reconnected");
    return true;
  } catch {
    this.connectionState = 'disconnected';
    logger.error("[hub] Failed to reconnect to AgentHub after retries");
    this.emit("disconnect"); // now truly disconnected
    return false;
  }
}
```

**Runner integration** (`agents/src/runner.ts`):
- Replace the current `hub.on("disconnect", () => process.exit(1))` with:
  ```typescript
  hub.on("disconnect", () => {
    if (isShuttingDown) return;
    logger.warn("[runner] Hub disconnected — agent will continue, state written to disk only");
    // Don't exit — the agent can continue working, disk-as-truth still applies
    // Frontend will detect staleness via missing heartbeats and recover from disk
  });

  hub.on("reconnected", () => {
    logger.info("[runner] Hub reconnected — resuming live state emission");
    // Emit current state immediately so UI catches up
    emitState();
  });
  ```
- **Critical change**: disconnect no longer kills the process. The agent keeps running, keeps writing to disk. If reconnection succeeds, the UI catches up. If it doesn't, the agent still completes its work and the user can see the result on next load.

**Reconnect queue** (bounded buffer during reconnection):
- New `reconnectQueue: SocketMessage[]` in `HubClient`, max 50 messages
- During `connectionState === 'reconnecting'`, `send()` pushes to queue instead of writing
- On successful reconnect, flush queue in order
- If queue is full, drop oldest messages (state snapshots are full snapshots, so only the latest matters)
- Smart queue: only keep the latest `state` message per threadId, but keep all `event` messages

**Socket file existence check**:
- Before attempting reconnect, check if `~/.mort/agent-hub.sock` still exists
- If socket file is gone → Tauri app quit, skip reconnect, proceed to graceful exit
- This avoids wasting retry time when the app is genuinely gone

## Files to Create/Modify

### New Files
- `core/types/pipeline.ts` — shared `PipelineStage` enum and `PipelineStamp` type
- `core/types/diagnostic-logging.ts` — `DiagnosticLoggingConfig` interface, defaults, and `isDiagnosticEnabled` helper
- `agents/src/lib/hub/heartbeat.ts` — heartbeat timer logic
- `src/stores/heartbeat-store.ts` — frontend heartbeat state tracking + seq gap tracking
- `src/lib/state-recovery.ts` — disk-based recovery logic + polling fallback

### Modified Files
- `agents/src/lib/hub/client.ts` — add seq counter + pipeline stamping, heartbeat start/stop, reconnection logic, connectionState, diagnostic logging relay handler
- `agents/src/lib/hub/connection.ts` — write failure tracking, connectionHealth getter
- `agents/src/runner.ts` — start heartbeat after hub connection, replace exit-on-disconnect with reconnect, add reconnected handler
- `agents/src/output.ts` — check connectionState for smarter logging (log once on transition, not every write)
- `src-tauri/src/agent_hub.rs` — add per-agent seq tracking and gap detection logging on the Rust side
- `src/lib/agent-service.ts` — add heartbeat case to message listener, pipeline stage tracking + gap detection
- `src/entities/threads/listeners.ts` — trigger recovery on staleness, auto-enable diagnostic logging
- `src/components/thread/working-indicator.tsx` — show heartbeat status (optional)

## Key Decisions

1. **Pipeline stage tracking is Phase 1** (not heartbeats): We don't know where events are being dropped. The agent socket is alive, so the problem is downstream. Pipeline stage stamps at every hop (agent → Rust → frontend) triangulate the exact failure point before we invest in recovery mechanisms.
2. **String enum pipeline stages, not opaque numbers**: Stages are `"agent:sent"`, `"hub:received"`, `"hub:emitted"`, `"frontend:received"` — human-readable in logs without cross-referencing. Each stamp also carries the seq number and timestamp, so you get both readability and precision.
3. **Diagnostic logging is per-module, not a single boolean**: Four independent modules (`pipeline`, `heartbeat`, `sequenceGaps`, `socketHealth`) can be toggled separately. This lets you enable just the subsystem you're investigating without drowning in noise from other modules. Stored as a single `DiagnosticLoggingConfig` object in the existing `SettingsStoreClient`. Status transitions, gap summaries, and errors always log regardless — they're rare and actionable.
4. **Auto-enable diagnostics on heartbeat staleness**: When the frontend detects a stale heartbeat, it programmatically enables **all** diagnostic modules. This means full tracing kicks in exactly when the problem is happening. Individual modules can be selectively disabled via UI after the auto-enable if you want to narrow the investigation. The setting stays on after recovery so captured data can be reviewed.
5. **5-second heartbeat interval**: Balances between responsiveness and overhead. At ~200 bytes per heartbeat message, this is negligible.
6. **Pipeline stamps on all messages** (not just heartbeats): Enables gap detection for any message type. Heartbeats alone can't tell you that a state update was dropped.
7. **Disk recovery as primary recovery mechanism**: Leverages existing "disk as truth" architecture. No need for message replay or complex retry logic. When heartbeats go stale, fall back to polling state.json.
8. **Frontend-side monitoring** (not Rust-side): The frontend is the consumer that cares about freshness. Rust hub is a dumb pipe — keep it that way. But Rust does get pipeline stage stamps for diagnostic logging.
9. **Heartbeat is opt-in per agent process**: Sub-agents spawned via Task tool may not need heartbeats (parent handles their state). Only root-level agents start heartbeat.
10. **Disconnect no longer kills the agent** (Phase 6-7): The agent keeps running and writing to disk. Reconnection is attempted, but even if it fails, the agent completes its work. This is a major behavior change from the current `process.exit(1)` — justified because the API call is expensive and the disk-as-truth pattern means no work is lost. Note: this is a separate concern from the main dropped-events bug.
11. **Reconnection has a bounded retry**: 5 attempts with exponential backoff (~15s total). If the Tauri app restarted, the socket should be back within seconds. If it's gone for good, we stop trying quickly.
12. **Smart reconnect queue**: During reconnection, buffer up to 50 messages. State messages are deduplicated (only latest per thread). This prevents a flood of stale state on reconnect while preserving event ordering.
13. **Three-tier logging approach**: (a) Always-on: status transitions, gaps, errors — low volume, high signal. (b) Per-module opt-in diagnostic: each of the 4 modules independently toggled for targeted investigation. (c) Agent-side `DEBUG` env var: existing pattern for agent-internal debug, orthogonal to pipeline diagnostics.
14. **Module config as JSON env var**: Rather than 4 separate env vars, agents receive the full `DiagnosticLoggingConfig` as a JSON string in `MORT_DIAGNOSTIC_LOGGING`. Parsed once at startup. This keeps the interface clean and makes it easy to add new modules later without changing the env var contract.
