# Event-Driven State Sync

Replace full-state disk reads and full-snapshot streaming with patch-based IPC. The agent sends diffs over the socket; the frontend applies them to in-memory state. A linked-list event chain (`previousEventId`) detects gaps and triggers resync. Applies to both persisted thread state and ephemeral streaming content.

## Phases

- [ ] Phase 1: Event chain + patch-based state emission
- [ ] Phase 2: Frontend patch application + gap detection
- [ ] Phase 3: Delta-based streaming (replace full-snapshot `OPTIMISTIC_STREAM`)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## The Problem

The frontend re-reads `state.json` from disk on every `AGENT_STATE` event, even though the event payload already contains the full state:

```
Agent → disk write → socket send (full state) → Hub → Tauri event (full state)
                                                       ↓
                                         listeners.ts: ignores state payload
                                                       ↓
                                         loadThreadState() reads from disk ← redundant
```

As `state.json` grows (the `messages` array is unbounded), this becomes increasingly expensive — both the disk reads and the full-state serialization over IPC.

The same problem applies to `OPTIMISTIC_STREAM`. The `StreamAccumulator` sends full accumulated block snapshots every 50ms. As the response grows during generation, every emission carries all accumulated text — a 10k-token response means the last snapshot serializes and sends ~10k tokens of content, even though only a few tokens were appended since the previous emission. At 50ms intervals over a long response, this is a lot of redundant bytes through the socket → Rust hub → Tauri emit → event bridge pipeline.

## The Approach

Single-writer simplification: only the agent runner writes `state.json`. No multi-writer conflict detection needed. Instead:

1. Agent tracks previous state, computes JSON Patch diffs
2. Each emission gets a unique ID and a pointer to the previous emission's ID
3. Frontend applies patches to in-memory state
4. If `previousEventId` doesn't match → gap detected → resync from disk

The event chain is a linked list. Each event says "I come after event X." If the client's last applied event isn't X, the chain is broken and it falls back to a full disk read.

---

## Phase 1: Event Chain + Patch-Based State Emission

### Event shape

```ts
interface StateEvent {
  id: string;                    // nanoid() — unique per emission
  previousEventId: string | null; // null on first emit or process restart
  threadId: string;
  patches: Operation[];          // RFC 6902 JSON Patch (from fast-json-patch)
  full?: ThreadState;            // Included when previousEventId is null (full sync)
}
```

When `previousEventId` is null, the event carries the full state in `full` — this handles first emission after process start, or if the agent explicitly wants to force a resync.

### Agent side changes

#### `agents/src/output.ts` — `emitState()`

Track previous state and event ID. Compute patches. Emit the event chain.

```ts
import { compare } from 'fast-json-patch';
import { nanoid } from 'nanoid';

let previousEmittedState: ThreadState | null = null;
let lastEventId: string | null = null;

export async function emitState(): Promise<void> {
  state.timestamp = Date.now();
  const snapshot = structuredClone(state);

  // Disk write — still full state (disk-as-truth preserved)
  await writeStateToDisk(snapshot);

  // Build event
  const eventId = nanoid();
  const previousEventId = lastEventId;

  if (previousEmittedState) {
    const patches = compare(previousEmittedState, snapshot);
    emitViaSocket(() => hubClient?.sendStateEvent({
      id: eventId,
      previousEventId,
      threadId,
      patches,
    }));
  } else {
    // First emit or after reset — send full state
    emitViaSocket(() => hubClient?.sendStateEvent({
      id: eventId,
      previousEventId: null,
      threadId,
      patches: [],
      full: snapshot,
    }));
  }

  previousEmittedState = snapshot;
  lastEventId = eventId;
}
```

On `initState()`, reset `previousEmittedState` and `lastEventId` to null so the first emission sends a full snapshot.

#### `HubClient` — replace `sendState()` with `sendStateEvent()`

Replace the existing `sendState()` method. Sends the `StateEvent` as a `"state_event"` message type through the socket. The existing pipeline stamping (`seq`, `stage: "agent:sent"`) still applies at the socket level — the event chain is a separate, higher-level concern. Remove the old `"state"` message type entirely.

#### Reconnect handling

During reconnect, the `ReconnectQueue` already deduplicates state messages. For state events, the queue should collapse to the latest event and mark it as `previousEventId: null` (since the client may have missed intermediate events). This forces a full resync after reconnect — safe and simple.

### New dependency

```json
{ "fast-json-patch": "^3.1.1" }
```

Added to `agents/package.json`. Only the agent process computes diffs. The frontend uses `applyPatch` from the same library.

Also `nanoid` — check if already available (common in Node projects).

---

## Phase 2: Frontend Patch Application + Gap Detection

### Event type changes

#### `core/types/events.ts`

Replace `AGENT_STATE` with `AGENT_STATE_DELTA`:

```ts
AGENT_STATE_DELTA: "agent:state:delta",

[EventName.AGENT_STATE_DELTA]: {
  id: string;
  previousEventId: string | null;
  threadId: string;
  patches: Operation[];
  full?: ThreadState;
};
```

Remove the old `AGENT_STATE` event type. The existing `AGENT_STATE` listener in `listeners.ts` is replaced by the new `AGENT_STATE_DELTA` handler — no dual path.

### Frontend side changes

#### `src/entities/threads/listeners.ts` — new handler

```ts
let lastAppliedEventId: Record<string, string> = {}; // threadId → last applied event ID

eventBus.on(EventName.AGENT_STATE_DELTA, async ({ id, previousEventId, threadId, patches, full }) => {
  try {
    await threadService.refreshById(threadId);

    const store = useThreadStore.getState();
    if (store.activeThreadId !== threadId) return;

    if (previousEventId === null || !lastAppliedEventId[threadId]) {
      // Full sync: first event, process restart, or we have no base state
      if (full) {
        store.setThreadState(threadId, full);
        lastAppliedEventId[threadId] = id;
      } else {
        // Shouldn't happen (previousEventId=null should include full), but safe fallback
        await threadService.loadThreadState(threadId);
      }
    } else if (previousEventId === lastAppliedEventId[threadId]) {
      // Chain intact — apply patches
      const currentState = store.threadStates[threadId];
      if (currentState && patches.length > 0) {
        const patched = applyPatch(structuredClone(currentState), patches);
        store.setThreadState(threadId, patched.newDocument);
      }
      lastAppliedEventId[threadId] = id;
    } else {
      // Chain broken — gap detected, full resync
      await threadService.loadThreadState(threadId);
      lastAppliedEventId[threadId] = id;
    }

    useStreamingStore.getState().clearStream(threadId);

    const thread = threadService.get(threadId);
    if (thread?.parentThreadId) {
      await threadService.refreshById(thread.parentThreadId);
    }
  } catch (e) {
    logger.error(`[ThreadListener] Failed to apply state delta for ${threadId}:`, e);
    // On any error, fall back to disk read
    await threadService.loadThreadState(threadId);
  }
});
```

#### Clearing chain state

When a thread is deactivated or the user switches threads, clear `lastAppliedEventId[threadId]`. This ensures the next activation triggers a full sync rather than trying to resume a stale chain.

### Rust hub changes

#### `src-tauri/src/agent_hub.rs`

Replace the `"state"` → `"app:agent:state"` mapping with `"state_event"` → `"app:agent:state:delta"`. Remove the old `"state"` message type handler.

### Event bridge changes

#### `src/lib/event-bridge.ts`

Replace the `"app:agent:state"` → `AGENT_STATE` bridge with `"app:agent:state:delta"` → `AGENT_STATE_DELTA`. Remove the old bridge entry.

---

## Phase 3: Delta-Based Streaming

### The streaming problem

`StreamAccumulator` currently sends full block snapshots every 50ms:

```
Emission 1: [{ type: "text", content: "Hello" }]                    — 5 chars
Emission 2: [{ type: "text", content: "Hello world" }]              — 11 chars
Emission 3: [{ type: "text", content: "Hello world, here is..." }]  — grows unbounded
```

Every emission re-serializes and transmits everything accumulated so far. The fix: send only what changed since the last emission.

### Event shape

```ts
interface StreamDeltaEvent {
  id: string;
  previousEventId: string | null;
  threadId: string;
  deltas: BlockDelta[];
  full?: StreamBlock[];  // Included when previousEventId is null
}

interface BlockDelta {
  index: number;         // Which block changed
  type: "text" | "thinking";
  append: string;        // Text appended since last emission
}
```

Streaming content is append-only during generation — blocks grow but never shrink or reorder. So deltas are just `{ index, append }` pairs. No need for full JSON Patch here; the simpler format is cheaper to produce and apply.

When `previousEventId` is null (first emission, or after `reset()`), include the full `blocks` array in `full`.

### Agent side changes

#### `agents/src/lib/stream-accumulator.ts`

Track the last-emitted content lengths per block. On each flush, compute the appended text per block and emit deltas.

```ts
private lastEmittedLengths: number[] = [];
private lastEventId: string | null = null;

private emitSnapshot(): void {
  this.dirty = false;
  const blocks = this.blocks.filter(Boolean);

  if (!this.hubClient.isConnected) return;

  const eventId = nanoid();

  if (!this.lastEventId) {
    // First emission — send full blocks
    this.hubClient.send({
      type: "stream_delta",
      threadId: this.threadId,
      id: eventId,
      previousEventId: null,
      deltas: [],
      full: blocks,
    });
    this.lastEmittedLengths = blocks.map(b => b.content.length);
  } else {
    // Compute deltas
    const deltas: BlockDelta[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const prevLen = this.lastEmittedLengths[i] ?? 0;
      const currentLen = blocks[i].content.length;
      if (currentLen > prevLen) {
        deltas.push({
          index: i,
          type: blocks[i].type,
          append: blocks[i].content.slice(prevLen),
        });
      }
    }
    if (deltas.length > 0) {
      this.hubClient.send({
        type: "stream_delta",
        threadId: this.threadId,
        id: eventId,
        previousEventId: this.lastEventId,
        deltas,
      });
      this.lastEmittedLengths = blocks.map(b => b.content.length);
    }
  }

  this.lastEventId = eventId;
}
```

On `reset()`, clear `lastEmittedLengths` and `lastEventId` so the next emission sends a full snapshot.

#### `HubClient`

No new method needed — uses existing `send()`. The `type: "stream_delta"` message flows through the same socket pipeline.

### Event type changes

#### `core/types/events.ts`

Replace `OPTIMISTIC_STREAM` with `STREAM_DELTA`:

```ts
STREAM_DELTA: "stream:delta",

[EventName.STREAM_DELTA]: {
  id: string;
  previousEventId: string | null;
  threadId: string;
  deltas: BlockDelta[];
  full?: StreamBlock[];
};
```

Remove the old `OPTIMISTIC_STREAM` event type.

### Frontend side changes

#### `src/stores/streaming-store.ts`

Add delta application logic:

```ts
let lastStreamEventId: Record<string, string> = {}; // threadId → last applied event ID

applyDelta: ({ id, previousEventId, threadId, deltas, full }) => set((state) => {
  if (previousEventId === null || !lastStreamEventId[threadId]) {
    // Full sync
    if (full) {
      lastStreamEventId[threadId] = id;
      return { activeStreams: { ...state.activeStreams, [threadId]: { blocks: full } } };
    }
    return state; // Shouldn't happen, but safe
  }

  if (previousEventId !== lastStreamEventId[threadId]) {
    // Gap — can't recover without full snapshot. Clear stream; next emission
    // with previousEventId: null (after accumulator reset) will resync.
    delete lastStreamEventId[threadId];
    const { [threadId]: _, ...rest } = state.activeStreams;
    return { activeStreams: rest };
  }

  // Chain intact — apply appends
  const existing = state.activeStreams[threadId];
  if (!existing) return state;

  const blocks = [...existing.blocks];
  for (const delta of deltas) {
    if (blocks[delta.index]) {
      blocks[delta.index] = {
        ...blocks[delta.index],
        content: blocks[delta.index].content + delta.append,
      };
    } else {
      // New block appeared
      blocks[delta.index] = { type: delta.type, content: delta.append };
    }
  }

  lastStreamEventId[threadId] = id;
  return { activeStreams: { ...state.activeStreams, [threadId]: { blocks } } };
}),
```

Clear `lastStreamEventId[threadId]` in `clearStream()`.

#### Streaming listener setup

Replace the `OPTIMISTIC_STREAM` listener with:

```ts
eventBus.on(EventName.STREAM_DELTA, (payload) => {
  useStreamingStore.getState().applyDelta(payload);
});
```

### Rust hub + event bridge changes

Same pattern as Phase 2: map `"stream_delta"` → `"app:stream:delta"` in the Rust hub, and `"app:stream:delta"` → `STREAM_DELTA` in the event bridge. Remove the old `"optimistic_stream"` mappings.

### Why this is simpler than thread state

| Aspect | Thread state (Phase 1–2) | Streaming (Phase 3) |
|---|---|---|
| Persistence | Disk write + IPC | IPC only (ephemeral) |
| Mutation pattern | Arbitrary (add/remove/edit messages) | Append-only (text grows) |
| Diff format | JSON Patch (RFC 6902) | Simple `{ index, append }` pairs |
| Gap recovery | Disk read | Wait for next full snapshot (accumulator reset) |
| State lifetime | Long-lived (thread history) | Short-lived (single generation) |

---

## What This Does NOT Change

- **Disk-as-truth pattern** — agents still write full `state.json` to disk on every emit
- **AGENT_COMPLETED** — always reads from disk for final integrity
- **Metadata reads** — `refreshById()` continues reading `metadata.json` from disk
- **`AGENT_STATE` event** — removed and fully replaced by `AGENT_STATE_DELTA`
- **`OPTIMISTIC_STREAM` event** — removed and fully replaced by `STREAM_DELTA`
- **TrickleBlock rendering** — character-by-character reveal animation unchanged, just fed by delta-applied store instead of full snapshots

## What Could Go Wrong

| Scenario | What happens |
|---|---|
| Agent crashes mid-stream | Client stops receiving events. On next agent start, `previousEventId: null` triggers full sync. |
| Patches applied out of order | `previousEventId` won't match → gap detected → disk fallback. |
| `structuredClone` + `applyPatch` fails | Caught by try/catch → disk fallback. |
| Thread switch during streaming | `lastAppliedEventId` cleared on deactivation → next activation loads from disk. |
| Reconnect after socket drop | Queue collapses to latest event with `previousEventId: null` → full resync. |
| `fast-json-patch` `compare()` bug | Worst case: bad patches. Client detects on next event (chain still valid but state diverges). Mitigated by `AGENT_COMPLETED` always reading from disk as final checkpoint. |
| Stream delta gap during generation | `previousEventId` mismatch → stream cleared. Next `reset()` + first emission sends full snapshot. Brief visual flicker at worst. |
| Stream delta arrives for wrong block index | Store applies to existing blocks or creates new entry. Worst case: garbled text for one emission cycle, corrected on next full snapshot after `reset()`. |
| Rapid block creation (thinking → text transitions) | New blocks appear as deltas with `append` = full content (prevLen = 0). No special handling needed. |

## Migration Strategy

All three phases ship together. Phase 1–2 (thread state) and Phase 3 (streaming) are independent in implementation but share the same event chain pattern, so they belong in the same release. This is a clean cutover: `AGENT_STATE` → `AGENT_STATE_DELTA` and `OPTIMISTIC_STREAM` → `STREAM_DELTA` across the full pipeline (agent → hub → event bridge → listeners/store). No dual path, no incremental migration.
