# Agent Analytics & Drains System

## Summary

Introduce a structured analytics system for agent runs backed by a single **DuckDB event log** (`drains.duckdb`). The system captures tool call timing, token usage deltas, permission decisions, context window pressure, and thread lifecycle events. All analytics are derived from DuckDB queries — no separate `stats.json` or per-thread disk writes for analytics purposes.

## Phases

- [ ] Define drain event types and Zod schemas in `core/types/drain-events.ts`
- [ ] Build drain infrastructure: `DrainWriter` interface, DuckDB adapter
- [ ] Instrument hook layer: capture tool timing, permission decisions, context snapshots
- [ ] Wire drains into `runAgentLoop` and `MessageHandler`
- [ ] Add scheduled drain handlers (flush intervals, rotation)
- [ ] Expose drain query API for CLI/UI consumption

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture

### Design Principles

1. **Zero-impact on hot path** — drain writes are fire-and-forget, never block tool execution or SDK message processing
2. **DuckDB is the single analytics store** — no per-thread `stats.json`; aggregates are derived via SQL queries on demand
3. **Typed at the boundary** — all drain events validated with Zod schemas before write
4. **Drains are composable** — a `Drain` is any `(event: DrainEvent) => void`; DuckDB is the primary implementation, but the interface supports additional drains (e.g., future remote sink)
5. **Typed columns for hot fields, JSON for the tail** — fields we filter/aggregate on (tool name, duration, tokens) are native columns; variable payload data stays in a JSON column

### Storage Topology

```
~/.mort/
├── drains.duckdb                 # Shared DuckDB instance (all threads)
├── threads/{threadId}/
│   ├── state.json                # Existing — unchanged
│   └── metadata.json             # Existing — unchanged
```

### Drain Concept

A **drain** is an event sink that receives typed analytics events. Drains can be:

- **Programmatic** — called inline from hooks/handlers (e.g., DuckDB append, stats accumulator)
- **Scheduled** — flushed on interval or batch size threshold (e.g., buffer → DuckDB batch insert)

```typescript
interface Drain {
  name: string;
  write(event: DrainEvent): void;       // Non-blocking, fire-and-forget
  flush?(): Promise<void>;               // Flush buffered events
  close?(): Promise<void>;               // Cleanup on shutdown
}

class DrainManager {
  private drains: Drain[] = [];

  register(drain: Drain): void;
  emit(event: DrainEvent): void;         // Fan-out to all drains
  flushAll(): Promise<void>;             // Called on shutdown
  closeAll(): Promise<void>;
}
```

---

## Drain Event Type System

### Event Hierarchy

All drain events share a base envelope:

```typescript
// core/types/drain-events.ts

interface DrainEventBase {
  timestamp: number;          // Unix ms
  threadId: string;
  parentThreadId?: string;    // Set for sub-agents
  agentType?: string;         // "general-purpose", "Explore", "Plan", etc.
  // Hot fields (mapped to typed DuckDB columns when present)
  toolName?: string;          // Set for tool:* events
  toolUseId?: string;         // Set for tool:* events
  durationMs?: number;        // Set when timing is available
  inputTokens?: number;       // Set for api:call events
  outputTokens?: number;      // Set for api:call events
}
```

### Event Catalog

#### 1. `tool:started`
Emitted in PreToolUse hook when a tool call begins.

```typescript
interface ToolStartedEvent extends DrainEventBase {
  event: "tool:started";
  payload: {
    toolUseId: string;
    toolName: string;
    toolInput: Record<string, unknown>;   // Sanitized (no file contents)
    permissionDecision: "allow" | "deny" | "ask";
    permissionReason: string;
    contextTokensBefore: number;          // Input tokens at time of call
  };
}
```

#### 2. `tool:completed`
Emitted in PostToolUse hook when a tool call succeeds.

```typescript
interface ToolCompletedEvent extends DrainEventBase {
  event: "tool:completed";
  payload: {
    toolUseId: string;
    toolName: string;
    durationMs: number;                   // Wall-clock time from started → completed
    resultLength: number;                 // Character count of tool result
    resultTruncated: boolean;             // Whether result was truncated by SDK
    contextTokensAfter: number;           // Input tokens after tool result ingested
    contextDelta: number;                 // Change in context tokens
    filesModified?: string[];             // Paths for file-modifying tools
  };
}
```

#### 3. `tool:failed`
Emitted in PostToolUseFailure hook.

```typescript
interface ToolFailedEvent extends DrainEventBase {
  event: "tool:failed";
  payload: {
    toolUseId: string;
    toolName: string;
    durationMs: number;
    error: string;                        // Truncated error message
    errorType: "permission_denied" | "execution_error" | "timeout" | "unknown";
  };
}
```

#### 4. `tool:denied`
Emitted when PreToolUse permission hook blocks a tool call.

```typescript
interface ToolDeniedEvent extends DrainEventBase {
  event: "tool:denied";
  payload: {
    toolUseId: string;
    toolName: string;
    reason: string;
    deniedBy: "rule" | "user" | "global_override";
  };
}
```

#### 5. `api:call`
Emitted when we receive an assistant message (one per LLM round-trip).

```typescript
interface ApiCallEvent extends DrainEventBase {
  event: "api:call";
  payload: {
    turnIndex: number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cacheHitRate: number;                 // cacheRead / (input + cacheCreation + cacheRead)
    contextUtilization: number;           // total input / contextWindow (0..1)
    stopReason: string | null;
    toolUseCount: number;                 // Number of tool_use blocks in response
    thinkingBlockCount: number;           // Number of thinking blocks
    textBlockCount: number;               // Number of text blocks
  };
}
```

#### 6. `thread:lifecycle`
Emitted on thread status transitions.

```typescript
interface ThreadLifecycleEvent extends DrainEventBase {
  event: "thread:lifecycle";
  payload: {
    transition: "started" | "completed" | "errored" | "cancelled";
    durationMs?: number;                  // Total wall-clock time (on completion)
    totalCostUsd?: number;
    numTurns?: number;
    totalToolCalls?: number;
    totalTokensIn?: number;
    totalTokensOut?: number;
    exitCode?: number;
    error?: string;
  };
}
```

#### 7. `context:pressure`
Emitted when context window utilization crosses thresholds (50%, 75%, 90%, 95%).

```typescript
interface ContextPressureEvent extends DrainEventBase {
  event: "context:pressure";
  payload: {
    utilization: number;                  // 0..1
    threshold: number;                    // Which threshold was crossed
    inputTokens: number;
    contextWindow: number;
    turnIndex: number;
  };
}
```

#### 8. `subagent:spawned` / `subagent:completed`
Emitted for sub-agent lifecycle.

```typescript
interface SubagentSpawnedEvent extends DrainEventBase {
  event: "subagent:spawned";
  payload: {
    childThreadId: string;
    agentType: string;
    toolUseId: string;
    promptLength: number;
  };
}

interface SubagentCompletedEvent extends DrainEventBase {
  event: "subagent:completed";
  payload: {
    childThreadId: string;
    agentType: string;
    durationMs: number;
    resultLength: number;
    tokenUsage?: TokenUsage;
  };
}
```

#### 9. `permission:decided`
Emitted for every permission evaluation (even allows — useful for understanding access patterns).

```typescript
interface PermissionDecidedEvent extends DrainEventBase {
  event: "permission:decided";
  payload: {
    toolName: string;
    toolUseId: string;
    decision: "allow" | "deny" | "ask";
    reason: string;
    modeId: string;                       // "plan" | "implement" | "approve"
    evaluationTimeMs: number;             // Time spent in evaluator
    waitTimeMs?: number;                  // Time waiting for user response (ask only)
    userDecision?: "approve" | "deny";    // Final user decision (ask only)
  };
}
```

#### 10. `session:resumed`
Emitted when a thread is resumed from prior state.

```typescript
interface SessionResumedEvent extends DrainEventBase {
  event: "session:resumed";
  payload: {
    priorMessageCount: number;
    priorToolStateCount: number;
    priorTokensIn: number;
    priorTokensOut: number;
  };
}
```

### Union Type

```typescript
type DrainEvent =
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | ToolDeniedEvent
  | ApiCallEvent
  | ThreadLifecycleEvent
  | ContextPressureEvent
  | SubagentSpawnedEvent
  | SubagentCompletedEvent
  | PermissionDecidedEvent
  | SessionResumedEvent;
```

---

## DuckDB Schema

### Column Strategy: Typed Hot Fields + JSON Tail

DuckDB stores JSON as VARCHAR internally — every query on a JSON field requires runtime parsing. For fields we filter, group, or aggregate on constantly, this overhead adds up. Our approach:

- **Promote to typed columns**: fields that appear in `WHERE`, `GROUP BY`, or aggregate expressions in >50% of expected queries
- **Keep in JSON `payload`**: variable/event-specific fields that are only accessed in targeted queries

This gives us DuckDB's full columnar vectorization on the hot path while keeping the schema simple and extensible.

### Table Definition

Single table, append-only:

```sql
CREATE TABLE IF NOT EXISTS drain_events (
  -- Envelope (typed — always filtered/grouped)
  id              UUID DEFAULT gen_random_uuid(),
  ts              TIMESTAMP NOT NULL,
  event           VARCHAR NOT NULL,         -- 'tool:started', 'api:call', etc.
  thread_id       VARCHAR NOT NULL,
  parent_thread_id VARCHAR,
  agent_type      VARCHAR,

  -- Hot fields (typed — frequently filtered/aggregated)
  tool_name       VARCHAR,                  -- NULL for non-tool events
  tool_use_id     VARCHAR,                  -- NULL for non-tool events
  duration_ms     DOUBLE,                   -- NULL when not applicable
  input_tokens    INTEGER,                  -- NULL for non-api events
  output_tokens   INTEGER,                  -- NULL for non-api events

  -- Everything else
  payload         JSON,                     -- Event-specific fields (nullable — some events are fully described by typed cols)

  -- Partition key
  event_date      DATE GENERATED ALWAYS AS (CAST(ts AS DATE))
);

-- Indexes: only for selective point lookups (zonemaps handle analytical scans)
CREATE INDEX IF NOT EXISTS idx_drain_thread ON drain_events(thread_id);
CREATE INDEX IF NOT EXISTS idx_drain_thread_event ON drain_events(thread_id, event);
```

### Why These Typed Columns

| Column | Justification |
|--------|--------------|
| `event` | Every query filters by event type |
| `thread_id` | Every query scopes to a thread or aggregates across threads |
| `parent_thread_id` | Sub-agent analysis joins parent ↔ child |
| `agent_type` | Group-by in sub-agent and cost queries |
| `tool_name` | Most common GROUP BY for tool analytics |
| `tool_use_id` | Join started→completed events for duration pairing |
| `duration_ms` | AVG/MAX/P95 aggregations — too expensive to parse from JSON every time |
| `input_tokens` / `output_tokens` | SUM/AVG for cost and utilization queries |

### What Stays in `payload`

Event-specific fields that are only accessed in narrow, targeted queries:

- `permissionDecision`, `permissionReason`, `deniedBy` (permission analysis)
- `resultLength`, `resultTruncated`, `contextDelta`, `filesModified` (tool detail)
- `cacheCreationTokens`, `cacheReadTokens`, `cacheHitRate` (cache analysis)
- `contextUtilization`, `stopReason`, `toolUseCount` (API call detail)
- `transition`, `totalCostUsd`, `numTurns`, `error` (lifecycle detail)
- `utilization`, `threshold`, `contextWindow` (pressure events)

### Dropped Columns (vs. previous design)

| Removed | Reason |
|---------|--------|
| `repo_id` | Derivable from thread metadata when needed; rarely queried directly |
| `worktree_id` | Same — join to thread metadata |
| `session_id` | Rarely queried; available in payload if needed |

### Why DuckDB over ClickHouse for local analytics

- **Zero infrastructure** — embedded, single-file database, no server process
- **Perfect for analytics** — columnar storage, excellent for aggregation queries
- **Complements ClickHouse** — ClickHouse remains the remote/cloud log sink; DuckDB is the local fast-query layer
- **Tiny footprint** — `duckdb` npm package, ~20MB

---

## Implementation Files

### New Files

| File | Package | Purpose |
|------|---------|---------|
| `core/types/drain-events.ts` | core | Zod schemas + TypeScript types for all drain events |
| `agents/src/lib/drain-manager.ts` | agents | `DrainManager` class — fan-out, lifecycle management |
| `agents/src/lib/drains/duckdb-drain.ts` | agents | DuckDB append drain with batch buffering |
| `agents/src/lib/drains/types.ts` | agents | `Drain` interface, `DrainConfig` |

### Modified Files

| File | Changes |
|------|---------|
| `agents/src/runners/shared.ts` | Initialize `DrainManager`, instrument PreToolUse/PostToolUse/PostToolUseFailure hooks to emit drain events, capture tool start timestamps |
| `agents/src/runners/message-handler.ts` | Emit `api:call` events on assistant messages, `context:pressure` on threshold crossings |
| `agents/src/runner.ts` | Create and configure `DrainManager`, register drains, flush on shutdown |
| `agents/package.json` | Add `duckdb` dependency |

---

## Instrumentation Points

### PreToolUse Hook (existing)

```
Before:  Permission evaluation → return decision
After:   Permission evaluation → emit tool:started / tool:denied → record startTime → return decision
```

The tool start timestamp is stored in an in-memory `Map<toolUseId, number>` within the hook closure, shared with PostToolUse via closure scope.

### PostToolUse Hook (existing)

```
Before:  markToolComplete → relay events → track files
After:   markToolComplete → compute duration from startTime map → emit tool:completed → relay events → track files
```

### PostToolUseFailure Hook (existing)

```
Before:  markToolComplete(error) → log
After:   markToolComplete(error) → compute duration → emit tool:failed → log
```

### MessageHandler.handleAssistant (existing)

```
Before:  Mark tools running → update usage → append message
After:   Mark tools running → update usage → emit api:call event → check context:pressure → append message
```

### runAgentLoop entry/exit (existing)

```
Before:  initState → query loop → complete/error
After:   initState → emit thread:lifecycle(started) → query loop → emit thread:lifecycle(completed/errored) → flush drains
```

---

## Additional Metrics Worth Tracking

Beyond the core events above, these would provide valuable operational insights:

### Conversation Quality Signals
- **Thinking-to-output ratio** — proportion of thinking tokens vs. output tokens per turn (captured in `api:call`)
- **Tool retry rate** — how often the same tool is called on the same file within a turn (derivable from `tool:started` events)
- **Context compression events** — when the SDK compresses context (detectable from large input token drops between turns)

### Performance Baselines
- **Time-to-first-token** — latency from prompt submission to first stream event (requires `stream_event` timing)
- **Tool queue depth** — number of concurrent tool calls in flight (derivable from started/completed event timestamps)
- **Hot file detection** — files modified more than N times in a single thread (derivable from `tool:completed.filesModified`)

### Cost Optimization
- **Cache efficiency trend** — cache hit rate over time within a session (are we getting better or worse?)
- **Wasted tokens on denied tools** — output tokens spent generating tool calls that get denied
- **Sub-agent cost allocation** — cost breakdown by sub-agent type

### Reliability
- **Orphaned tool rate** — tools marked running at thread completion (already tracked, now queryable)
- **SDK error frequency** — `error_during_execution` events from the result handler
- **Resume success rate** — how often resumed sessions succeed vs. error

---

## Query Examples

Once populated, the DuckDB drain enables queries like. Note how the hot fields use typed columns (no JSON parsing) while detail fields use `payload->>` extraction:

```sql
-- Average tool duration by tool name (last 24h)
-- Uses typed columns only — fully vectorized, no JSON parsing
SELECT
  tool_name,
  COUNT(*) as calls,
  AVG(duration_ms) as avg_ms,
  MAX(duration_ms) as max_ms
FROM drain_events
WHERE event = 'tool:completed' AND ts > now() - INTERVAL 1 DAY
GROUP BY 1 ORDER BY avg_ms DESC;

-- Context utilization over time for a specific thread
-- input_tokens is typed; contextUtilization is in payload (accessed less often)
SELECT
  ts,
  CAST(payload->>'contextUtilization' AS DOUBLE) as util,
  input_tokens
FROM drain_events
WHERE thread_id = ? AND event = 'api:call'
ORDER BY ts;

-- Tool failure hot spots
-- tool_name is typed; errorType is payload-only (rare query)
SELECT
  tool_name,
  payload->>'errorType' as error_type,
  COUNT(*) as failures
FROM drain_events
WHERE event = 'tool:failed' AND event_date >= CURRENT_DATE - 7
GROUP BY 1, 2 ORDER BY failures DESC;

-- Sub-agent cost breakdown
SELECT
  agent_type,
  COUNT(*) as spawns,
  AVG(duration_ms) as avg_duration_ms
FROM drain_events
WHERE event = 'subagent:completed'
GROUP BY 1;

-- Permission denial patterns
-- tool_name is typed; reason/deniedBy are in payload
SELECT
  tool_name,
  payload->>'reason' as reason,
  COUNT(*) as denials
FROM drain_events
WHERE event = 'tool:denied'
GROUP BY 1, 2 ORDER BY denials DESC;

-- Thread summary (replaces stats.json)
-- All derived from typed columns — no JSON parsing needed
SELECT
  thread_id,
  MIN(ts) as started_at,
  MAX(ts) as ended_at,
  SUM(CASE WHEN event = 'api:call' THEN input_tokens END) as total_input_tokens,
  SUM(CASE WHEN event = 'api:call' THEN output_tokens END) as total_output_tokens,
  COUNT(CASE WHEN event LIKE 'tool:%' THEN 1 END) as total_tool_events,
  COUNT(CASE WHEN event = 'tool:failed' THEN 1 END) as tool_failures,
  COUNT(CASE WHEN event = 'tool:denied' THEN 1 END) as tool_denials
FROM drain_events
WHERE thread_id = ?
GROUP BY 1;
```

---

## Flush & Rotation Strategy

### DuckDB Drain
- **Buffer size**: 50 events
- **Flush interval**: 5 seconds
- **Guaranteed flush**: on `DrainManager.flushAll()` (called during shutdown in `runner.ts`)
- **WAL mode**: enabled for crash safety

### Database Rotation
- **Optional**: DuckDB files can grow large. Consider `VACUUM` or date-based partitioning for long-running installations.
- **Export**: `COPY drain_events TO 'export.parquet' (FORMAT PARQUET)` for archival or ClickHouse ingest.

---

## Security & Privacy

- **Tool inputs are sanitized** — file contents stripped, only metadata (path, operation) retained in drain events
- **No PII in drain events** — prompts and assistant responses are NOT logged to drains (already in `state.json`)
- **DuckDB file permissions** — created with 0600 (user-only read/write)
- **No network emission** — all drain data stays local. ClickHouse integration (if desired) is a separate, opt-in export step
