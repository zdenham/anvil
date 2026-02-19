# Event Heartbeat & Dropped Event Diagnostics

## Problem

The UI sometimes stops receiving events from the agent while the agent is still running. There is no heartbeat system, no sequence numbering, and no way to detect or recover from dropped events. The user sees a frozen UI with no indication that something went wrong.

## Root Cause Analysis

The event pipeline has **5 stages** where events can be lost:

```
Agent (Node.js) → Socket Write → AgentHub (Rust) → Tauri emit → Frontend listener
     [1]              [2]              [3]              [4]            [5]
```

### Stage 1: Agent fails to emit
- `hubClient?.isConnected` check in `output.ts:140` silently drops state if socket disconnected
- Same pattern in `stream-accumulator.ts:83` — streaming silently stops
- No reconnection attempt — once disconnected, all further events are lost

### Stage 2: Socket write backpressure / EPIPE
- `connection.ts:64-91` has a write queue with backpressure handling
- If socket is destroyed, `write()` returns `false` silently (line 65-67)
- No logging, no error propagation — events vanish without a trace
- `gracefulClose()` has a 1-second timeout (line 131) — queued messages may be dropped

### Stage 3: Rust AgentHub message forwarding
- `agent_hub.rs:275` — `app_handle.emit()` failure only logs a warning, doesn't retry
- `serde_json::from_str` parse failures (line 279-284) silently drop the message
- BufReader blocking read (line 213) means if the connection dies mid-line, that partial message is lost
- **No backpressure**: Tauri's event system is fire-and-forget from the Rust side

### Stage 4: Tauri event delivery
- Tauri's `emit()` is async and non-blocking — if the webview is busy/frozen, events may be queued or dropped
- No delivery guarantee from Tauri's event system
- If the frontend listener hasn't been initialized yet (race at startup), early events are lost

### Stage 5: Frontend event processing
- Event bridge cross-window broadcast (`event-bridge.ts`) adds another hop where events can be lost
- mitt eventBus is synchronous — a slow listener blocks all subsequent events
- No error boundaries around event handlers — an exception in one handler could break the chain

## Phases

- [ ] Add heartbeat emission from agent process (Node.js side)
- [ ] Add heartbeat handling in Rust AgentHub (passthrough to Tauri)
- [ ] Add heartbeat monitoring in frontend with stale detection
- [ ] Add event sequence numbers for gap detection
- [ ] Add diagnostic UI for connection health
- [ ] Add disk-based state recovery when events are missed

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### 1. Heartbeat: Agent → Hub → UI

**Agent side** (`agents/src/lib/hub/client.ts`):
- New method `startHeartbeat(intervalMs = 5000)` on `HubClient`
- Sends `{ type: "heartbeat", timestamp: Date.now(), seq: N }` at regular intervals
- Heartbeat includes a monotonically increasing sequence number
- Heartbeat interval timer is cleaned up on `disconnect()` / `gracefulDisconnect()`
- If `write()` returns `false`, log a warning (first sign of trouble)

**Rust AgentHub** (`src-tauri/src/agent_hub.rs`):
- Heartbeat messages treated like any other non-register, non-relay message
- Forwarded to frontend via `app_handle.emit("agent:message", &msg)` — **no code change needed** for basic passthrough
- Optional: track last heartbeat time per agent for Rust-side stale detection (future)

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
  - `> 15s` → stale (likely disconnected)
- On transition to `stale`, trigger disk-based state recovery (read `state.json`)
- On transition to `degraded`, show subtle UI indicator
- Clean up heartbeat tracking when `AGENT_COMPLETED` or `AGENT_CANCELLED` fires

### 2. Event Sequence Numbers

**Agent side** (`agents/src/lib/hub/client.ts`):
- Add `private seq = 0` counter to `HubClient`
- Every `send()` call attaches `seq: ++this.seq` to the outgoing message
- This covers state, event, heartbeat, and optimistic_stream messages

**Frontend** (`src/lib/agent-service.ts`):
- Track `lastSeq` per `threadId` in heartbeat store
- On each `agent:message`, check if `msg.seq === expected`:
  - If `msg.seq > expected + 1` → gap detected, log warning with gap size
  - If gap detected, trigger immediate disk-based state refresh
- Sequence numbers reset to 0 when a new agent registers (tracked via AGENT_SPAWNED)

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

### 4. Diagnostic UI

**Status indicator** (in thread header or status bar):
- Small dot next to agent status that reflects heartbeat health
- Green (healthy), Yellow (degraded), Red (stale)
- Tooltip shows: last heartbeat time, sequence number, missed count
- Only visible when agent is running (status === "running")

**Optional: Connection debug panel** (dev-only or behind setting):
- Show per-thread: heartbeat status, last seq, gaps detected, recovery count
- Show AgentHub connected agents list (via existing `list_connected_agents` invoke)

### 5. Agent-Side Improvements

**Better disconnect detection** (`agents/src/lib/hub/connection.ts`):
- Add `error` event handler that logs connection failures
- Track consecutive write failures — after N failures, mark as disconnected
- Emit a `connection:degraded` event that the runner can listen to

**Reconnection** (stretch goal, not in initial phases):
- If socket disconnects, attempt reconnect with exponential backoff
- Re-register with hub after reconnect
- Resume heartbeat with new sequence numbers

## Files to Create/Modify

### New Files
- `agents/src/lib/hub/heartbeat.ts` — heartbeat timer logic
- `src/stores/heartbeat-store.ts` — frontend heartbeat state tracking
- `src/lib/state-recovery.ts` — disk-based recovery logic

### Modified Files
- `agents/src/lib/hub/client.ts` — add seq counter, heartbeat start/stop
- `agents/src/runner.ts` — start heartbeat after hub connection
- `src-tauri/src/agent_hub.rs` — no changes needed for basic heartbeat (passthrough works)
- `src/lib/agent-service.ts` — add heartbeat case to message listener, seq tracking
- `src/entities/threads/listeners.ts` — trigger recovery on staleness
- `src/components/thread/working-indicator.tsx` — show heartbeat status (optional)

## Key Decisions

1. **5-second heartbeat interval**: Balances between responsiveness and overhead. At ~200 bytes per heartbeat message, this is negligible.
2. **Sequence numbers on all messages** (not just heartbeats): Enables gap detection for any message type. Heartbeats alone can't tell you that a state update was dropped.
3. **Disk recovery as primary recovery mechanism**: Leverages existing "disk as truth" architecture. No need for message replay or complex retry logic.
4. **Frontend-side monitoring** (not Rust-side): The frontend is the consumer that cares about freshness. Rust hub is a dumb pipe — keep it that way.
5. **Heartbeat is opt-in per agent process**: Sub-agents spawned via Task tool may not need heartbeats (parent handles their state). Only root-level agents start heartbeat.
