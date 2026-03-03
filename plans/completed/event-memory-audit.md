# Event Memory Pressure Audit

Audit of all Tauri/hub events ranked by memory consumption risk.

## Phases

- [x] Research event types, payloads, and forwarding architecture
- [x] Analyze per-event memory characteristics
- [ ] Implement mitigations (separate plan per item)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Power Ranking: Events by Memory Pressure

### 1. `agent:state` (type: "state") — CRITICAL

**Estimated size:** 100KB–5MB per emission, unbounded growth
**Frequency:** Every state mutation (tool start, tool complete, message append, file change)
**Source:** `agents/src/output.ts` → `emitState()` → HubClient → Rust hub → all windows

**Why it's #1:**
- Carries **full `ThreadState` snapshot** on every emission — not a delta
- `messages: MessageParam[]` array grows **indefinitely** with conversation length
- `toolStates` includes full tool result strings (bash output can be 100KB+)
- Emitted on *every* state change: `appendUserMessage()`, `appendAssistantMessage()`, `markToolRunning()`, `markToolComplete()`, `updateFileChange()`
- **Triple serialization**: JSON over socket → Tauri IPC to frontend → frontend *ignores the payload* and re-reads `state.json` from disk
- At turn 50 with large tool outputs: easily 1–5MB *per event*, emitted multiple times per turn

**Scale model:**
| Turns | Typical size | Emissions/turn | Total serialized/turn |
|-------|-------------|----------------|----------------------|
| 5     | 50KB        | 3–6            | 150–300KB            |
| 20    | 200KB       | 3–6            | 600KB–1.2MB          |
| 50    | 500KB–2MB   | 3–6            | 1.5–12MB             |

---

### 2. Event debugger capture buffer — HIGH

**Estimated size:** Up to 150MB+ in pathological cases
**Location:** `src/stores/event-debugger-store.ts`

**Why it's #2:**
- Captures **500 events** with **full payloads** (including `agent:state`)
- `computeSize()` calls `JSON.stringify(msg)` on every captured event — allocates a throwaway string just to measure
- If 500 `agent:state` events averaging 300KB each are captured: **150MB retained in the store**
- Even when debug panel is closed, the store still captures if initialized
- Each captured event holds: raw payload + computed size + metadata

---

### 3. `optimistic:stream` (type: "optimistic_stream") — HIGH

**Estimated size:** 10–100KB+ per flush
**Frequency:** Every 50ms during active streaming (20 events/sec)
**Source:** `agents/src/stream-accumulator.ts` → HubClient → frontend

**Why it's #3:**
- Sends **full accumulated content snapshot**, not a delta
- During a long assistant response, content grows continuously — each flush re-sends everything accumulated so far
- At 20 flushes/sec for 30 seconds of streaming: 600 events, with the last ones being the largest
- Content blocks can include `thinking` blocks which can be very long
- Serialized to JSON over socket + Tauri IPC for every flush

**Scale model:**
| Stream duration | Final block size | Total serialized |
|----------------|-----------------|-----------------|
| 5s             | 10KB            | ~500KB          |
| 30s            | 60KB            | ~18MB           |
| 60s            | 120KB+          | ~72MB+          |

---

### 4. `terminal:output` — MODERATE-HIGH

**Estimated size:** Up to 4KB per event, 400–600KB accumulated per terminal
**Frequency:** Hundreds/sec during heavy output (`cat`, build logs, etc.)
**Source:** Rust PTY reader (4096-byte chunks) → Tauri event → frontend listener

**Why it's #4:**
- Per-event size capped at 4KB, but high frequency creates pressure
- Payload is `{ id: number, data: number[] }` — byte array serialized as JSON numbers (4KB binary = ~16KB JSON)
- Output buffer accumulates in `Map<string, string>` outside Zustand (good), trimmed at 5000 lines
- **No byte-size limit** — only line-based trimming. A single 1MB line is stored indefinitely
- Multiple terminals multiply linearly
- Each event triggers synchronous `TextDecoder.decode()` → `appendOutput()` → xterm `terminal.write()`

**Mitigating factors:** Not routed through event bridge broadcast system. Direct Tauri events, single consumer.

---

### 5. Event bridge broadcast re-serialization — MODERATE

**Location:** `src/lib/event-bridge.ts`
**Amplification factor:** N windows × full payload

**Why it's #5:**
- All `BROADCAST_EVENTS` (agent lifecycle, thread lifecycle, permissions, plans, etc.) are re-serialized and emitted as `app:{eventName}` Tauri events
- Each window receives and deserializes independently
- For `agent:state`, this means the already-large payload gets serialized *again* with `_source` metadata added
- Multi-window setups amplify: 3 windows = 3x the IPC traffic for every broadcast event
- Outgoing bridge logs message counts for `AGENT_STATE` but still forwards the full payload

---

### 6. `permission:request` / `question:request` — LOW-MODERATE

**Estimated size:** 500B–50KB per event
**Frequency:** Once per tool use requiring permission

**Why it's #6:**
- `toolInput: Record<string, unknown>` can contain file paths, code snippets, or other content the tool was called with
- Bash tool inputs can be large commands; Write tool inputs include full file content
- Not a sustained pressure source — only fires when permission is needed
- Can spike if a burst of permission requests queue up

---

### 7. `gateway:event` (webhook payloads) — LOW-MODERATE

**Estimated size:** Variable, typically 5–50KB, up to 1MB+
**Frequency:** On external webhook events (PR comments, issue updates, etc.)

**Why it's #7:**
- Payload is opaque `Record<string, unknown>` from external webhooks
- GitHub webhook payloads for PRs with large diffs can be very large
- No size validation or truncation at the gateway level
- Low frequency in practice — only fires on external events

---

### 8. `action-requested` — LOW

**Estimated size:** 1–10KB typically
**Frequency:** Rare, only on user action prompts

- `markdown` field can contain substantial rendered content
- One-shot events, not sustained pressure

---

### 9. Drain events (type: "drain") — NEGLIGIBLE

**Estimated size:** 200–500 bytes each
**Frequency:** Multiple per turn (tool events, API calls)

- Flat key-value properties only
- Routed to SQLite worker, not to event bus
- Separate from broadcast pipeline
- Well-designed for minimal overhead

---

### 10. Heartbeat / registration / log messages — NEGLIGIBLE

**Estimated size:** 50–200 bytes
**Frequency:** Every 5–10s (heartbeat), once (register), occasional (log)

- Minimal payloads, no accumulated state

---

## Non-Issues (Good Design Decisions)

**Diff/changes data**: Diffs are generated on-demand by the frontend from git — never serialized into events. Only file change *metadata* (`{ path, operation }`) travels through events. This was an explicit design decision (noted in `core/types/events.ts` comments).

**Thread disk reads**: While the frontend re-reads `state.json` from disk on every `AGENT_STATE` event (redundant with the payload), this is bounded by file size and doesn't create IPC amplification.

---

## Top Mitigation Opportunities

| # | Target | Approach | Estimated savings |
|---|--------|----------|-------------------|
| 1 | `agent:state` full snapshots | Implement patch-based diffs (plan exists: `event-driven-state-sync.md`) | ~90% per-event reduction |
| 2 | `agent:state` payload ignored | Stop sending state in event payload — just send `{ threadId }` as notification, let frontend read from disk (already does this) | Eliminate socket+IPC serialization of full state |
| 3 | Event debugger buffer | Don't store full payloads — store summary + size only. Lazy-load full payload on click | 100x reduction in debugger memory |
| 4 | `optimistic:stream` | Switch to delta-based streaming (send only new content since last flush) | ~80% reduction in stream traffic |
| 5 | Terminal JSON encoding | Send binary data as base64 instead of `number[]` JSON array | ~4x reduction per terminal event |
| 6 | Event bridge broadcast | Skip broadcasting `agent:state` payload — broadcast notification only | Eliminate N-window amplification |
