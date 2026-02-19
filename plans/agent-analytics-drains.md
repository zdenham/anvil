# Agent Analytics & Drains System

## Summary

Structured analytics for agent runs using **SQLite EAV** — a minimal `drain_events` table (event name + timestamp + thread ID) and an `event_properties` table for everything else. Agents emit drain events over the existing hub socket; the Tauri process writes them to SQLite via a new `tracing` layer. No new dependencies — `rusqlite` (bundled) is already used for `clipboard_db`.

## Phases

- [ ] Define drain event Zod schemas in `core/types/drain-events.ts`
- [ ] Build Rust `SQLiteLayer` + background worker (same pattern as existing `LogServerLayer`)
- [ ] Extend hub socket: add `"drain"` message type, bridge to `tracing` with `target: "drain::*"`
- [ ] Build TypeScript `DrainManager`: serialize events, send over hub socket
- [ ] Instrument hooks and `runAgentLoop` to emit drain events
- [ ] Expose drain query API for CLI/UI

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## How It Reuses Existing Infrastructure

| What exists | How drains use it |
|-------------|-------------------|
| `tracing_subscriber` registry with 5 layers (`mod.rs:381-432`) | Add `SQLiteLayer` as layer 6 — same pattern as `LogServerLayer` |
| `LogServerLayer` background worker (`log_server.rs`) | Clone the `mpsc::channel` → background `std::thread` → batch flush pattern |
| Hub socket protocol (`agents/src/lib/hub/`) | Add `"drain"` message type alongside existing `"log"`, `"event"`, `"state"` |
| `HubClient.sendLog()` / `sendEvent()` | Add `sendDrain(event, props)` — same fire-and-forget pattern |
| `rusqlite` in `clipboard_db.rs` | Same dependency, same `Mutex<Connection>` + `OnceLock` pattern |
| `agent_hub.rs` message routing | Route `"drain"` messages to `tracing::info!(target: "drain::*")` |

No new npm packages. No new Rust crates. Zero binary size overhead.

---

## SQLite Schema

Minimal base table — the EAV properties table handles everything beyond identity and time.

```sql
CREATE TABLE IF NOT EXISTS drain_events (
  event_id   TEXT PRIMARY KEY NOT NULL,  -- UUID v4 (generated in Rust)
  event      TEXT NOT NULL,              -- 'tool:started', 'api:call', etc.
  ts         INTEGER NOT NULL,           -- Unix ms
  thread_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_properties (
  event_id      TEXT NOT NULL,           -- FK → drain_events.event_id
  key           TEXT NOT NULL,
  value_string  TEXT,
  value_number  REAL,
  value_bool    INTEGER,                 -- 0/1 (SQLite has no native bool)
  FOREIGN KEY (event_id) REFERENCES drain_events(event_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_drain_thread ON drain_events(thread_id);
CREATE INDEX IF NOT EXISTS idx_drain_thread_event ON drain_events(thread_id, event);
CREATE INDEX IF NOT EXISTS idx_drain_ts ON drain_events(ts);
CREATE INDEX IF NOT EXISTS idx_props_event_id ON event_properties(event_id);
CREATE INDEX IF NOT EXISTS idx_props_key ON event_properties(key);
CREATE INDEX IF NOT EXISTS idx_props_event_key ON event_properties(event_id, key);
```

Write pattern: one `drain_events` row + N `event_properties` rows per event, batched in a single transaction.

---

## Event Catalog

### TypeScript Base

```typescript
interface DrainEvent {
  event: string;        // Event name from catalog below
  threadId: string;
  properties: Record<string, string | number | boolean>;
}
```

All fields beyond `event` and `threadId` go into `properties`. Timestamp is added server-side (Rust layer).

### Events and Properties

| Event | When | Properties |
|-------|------|------------|
| `tool:started` | PreToolUse hook, tool call begins | `toolUseId`, `toolName`, `toolInput` (sanitized JSON string), `permissionDecision` (allow/deny/ask), `permissionReason`, `contextTokensBefore` |
| `tool:completed` | PostToolUse hook, tool succeeds | `toolUseId`, `toolName`, `durationMs`, `resultLength`, `resultTruncated`, `contextTokensAfter`, `contextDelta`, `filesModified` (JSON array string) |
| `tool:failed` | PostToolUseFailure hook | `toolUseId`, `toolName`, `durationMs`, `error`, `errorType` (permission_denied/execution_error/timeout/unknown) |
| `tool:denied` | PreToolUse permission blocks call | `toolUseId`, `toolName`, `reason`, `deniedBy` (rule/user/global_override) |
| `api:call` | Assistant message received (one per LLM turn) | `turnIndex`, `model`, `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `cacheHitRate`, `contextUtilization`, `stopReason`, `toolUseCount`, `thinkingBlockCount`, `textBlockCount` |
| `thread:lifecycle` | Thread status transitions | `transition` (started/completed/errored/cancelled), `durationMs`, `totalCostUsd`, `numTurns`, `totalToolCalls`, `totalTokensIn`, `totalTokensOut`, `exitCode`, `error` |
| `context:pressure` | Context utilization crosses 50/75/90/95% | `utilization`, `threshold`, `inputTokens`, `contextWindow`, `turnIndex` |
| `subagent:spawned` | Sub-agent launched | `childThreadId`, `agentType`, `toolUseId`, `promptLength` |
| `subagent:completed` | Sub-agent finished | `childThreadId`, `agentType`, `durationMs`, `resultLength`, `inputTokens`, `outputTokens` |
| `permission:decided` | Every permission evaluation | `toolName`, `toolUseId`, `decision` (allow/deny/ask), `reason`, `modeId`, `evaluationTimeMs`, `waitTimeMs`, `userDecision` |
| `context:compacted` | PreCompact hook / CompactBoundary message | `trigger` (manual/auto), `preTokens`, `postTokens`, `tokensSaved`, `turnIndex` |
| `session:resumed` | Thread resumed from prior state | `priorMessageCount`, `priorToolStateCount`, `priorTokensIn`, `priorTokensOut` |

---

## Data Flow

```
Agent (Node.js)                        Tauri (Rust)
┌──────────────────┐                  ┌───────────────────────────────┐
│ DrainManager     │                  │ tracing_subscriber::registry  │
│   .emit(event)   │──hub socket───▶  │   .with(SQLiteLayer)    [NEW] │
│                  │  "drain" msg     │   .with(LogServerLayer)       │
│                  │                  │   .with(BufferLayer)          │
│                  │                  │   .with(console_layer)        │
│                  │                  │   .with(json_layer)           │
└──────────────────┘                  └───────────────────────────────┘
```

The `SQLiteLayer` filters on `target.starts_with("drain::")`. System logs (`mort::*`, `web`, etc.) are unaffected.

---

## Instrumentation Points

| Hook / location | Emits | Key data captured |
|-----------------|-------|-------------------|
| PreToolUse hook | `tool:started` or `tool:denied` | Start timestamp stored in `Map<toolUseId, number>` for duration calc |
| PostToolUse hook | `tool:completed` | Duration from start map, result size, context delta |
| PostToolUseFailure hook | `tool:failed` | Duration, error message, error classification |
| `MessageHandler.handleAssistant` | `api:call`, `context:pressure` | Token usage from SDK response, utilization thresholds |
| `runAgentLoop` entry/exit | `thread:lifecycle` | Started/completed/errored transitions, summary stats on exit |
| Sub-agent spawn/complete | `subagent:spawned/completed` | Child thread ID, agent type, duration, token usage |

---

## Implementation Files

### New

| File | Purpose |
|------|---------|
| `core/types/drain-events.ts` | Zod schemas + TS types for drain events |
| `agents/src/lib/drain-manager.ts` | Serializes drain events, sends over hub socket |
| `src-tauri/src/logging/sqlite_layer.rs` | Tracing layer — filters `drain::*`, decomposes into EAV rows |
| `src-tauri/src/logging/sqlite_worker.rs` | Background worker — owns `Connection`, batch inserts, WAL mode |

### Modified

| File | Changes |
|------|---------|
| `agents/src/runners/shared.ts` | Instrument hooks to emit drain events, capture tool start timestamps |
| `agents/src/runners/message-handler.ts` | Emit `api:call` and `context:pressure` events |
| `agents/src/lib/hub/types.ts` | Add `DrainMessage` type |
| `agents/src/lib/hub/client.ts` | Add `sendDrain()` method |
| `src-tauri/src/logging/mod.rs` | Register `SQLiteLayer` in subscriber |
| `src-tauri/src/agent_hub.rs` | Route `"drain"` messages to `tracing` |

---

## Flush Strategy

Same pattern as `LogServerLayer` (`log_server.rs:237-292`):

- `mpsc::channel` sender in `SQLiteLayer`, receiver in background thread
- Flush on 50 events or 5 second interval
- Transaction-wrapped prepared statement batch inserts (both tables)
- WAL mode for concurrent reads
- Drain remaining buffer on channel disconnect (app shutdown)

---

## Query Examples

```sql
-- Tool duration by name (last 24h)
SELECT p_name.value_string AS tool, COUNT(*) AS calls,
       AVG(p_dur.value_number) AS avg_ms, MAX(p_dur.value_number) AS max_ms
FROM drain_events e
JOIN event_properties p_name ON e.event_id = p_name.event_id AND p_name.key = 'toolName'
JOIN event_properties p_dur ON e.event_id = p_dur.event_id AND p_dur.key = 'durationMs'
WHERE e.event = 'tool:completed'
  AND e.ts > (strftime('%s','now') * 1000 - 86400000)
GROUP BY 1 ORDER BY avg_ms DESC;

-- Thread summary (replaces stats.json)
SELECT e.thread_id,
  datetime(MIN(e.ts)/1000, 'unixepoch') AS started,
  datetime(MAX(e.ts)/1000, 'unixepoch') AS ended,
  COUNT(CASE WHEN e.event LIKE 'tool:%' THEN 1 END) AS tool_events,
  COUNT(CASE WHEN e.event = 'tool:failed' THEN 1 END) AS failures
FROM drain_events e WHERE e.thread_id = ? GROUP BY 1;

-- Permission denial patterns
SELECT p_tool.value_string AS tool, p_reason.value_string AS reason, COUNT(*) AS denials
FROM drain_events e
JOIN event_properties p_tool ON e.event_id = p_tool.event_id AND p_tool.key = 'toolName'
JOIN event_properties p_reason ON e.event_id = p_reason.event_id AND p_reason.key = 'reason'
WHERE e.event = 'tool:denied'
GROUP BY 1, 2 ORDER BY denials DESC;
```
