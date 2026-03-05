# Streaming Architecture v2 — Race Conditions by Design

## Problem Statement

The streaming thread experience has degraded due to architectural tensions between multiple moving parts. The core issue isn't any single bug — it's that the architecture **makes race conditions easy**. Multiple stores, multiple event chains, competing scroll mechanisms, and disk reads during streaming create a combinatorial explosion of edge cases.

## Diagnosis: Why Races Are Easy Today

### Three competing sources of truth during streaming

```
                ┌─────────────────┐
  STREAM_DELTA  │ streaming-store │  ephemeral text/thinking blocks
  ─────────────>│ (Zustand)       │──> StreamingContent ──> TrickleBlock
                └─────────────────┘
                                        ↕ RACE: which renders?
                ┌─────────────────┐
  STATE_DELTA   │  thread-store   │  persisted messages + toolStates
  ─────────────>│ (Zustand)       │──> AssistantMessage ──> ToolUseBlock
                └─────────────────┘
                        ↑
                ┌───────┴─────────┐
                │  disk (fs)      │  state.json + metadata.json
                │                 │  read on gap, completion, status change
                └─────────────────┘
```

A single logical event (agent produces text) triggers updates to **all three**, each on different timelines:

1. `STREAM_DELTA` → `streaming-store.applyDelta()` → **render #1**
2. `AGENT_STATE_DELTA` → `refreshById()` (disk read) → `thread-store.setThreadState()` → **render #2**
3. After #2: `streaming-store.clearStream()` → **render #3** (flash risk)

### Two independent chain trackers

`streaming-store.ts:26` and `listeners.ts:21` each maintain their own `lastEventId` tracking. A gap in one doesn't inform the other. They can disagree about whether the chain is intact.

### Disk reads during streaming

When a chain gap is detected, the system falls back to `loadThreadState()` — a synchronous disk read. During streaming at 20+ events/second, this causes:
- Blocking I/O on the render thread
- Potential stale data (disk lags behind events)
- Flash of empty/old content while disk read completes

### Re-render amplification

One `STREAM_DELTA` (3-5 chars) causes:
1. Streaming store update → render
2. Trickle animation → `setDisplayedLength()` at 60fps → render per frame
3. ResizeObserver fires → height cache update → VirtualList recalc
4. Auto-scroll fires → potential layout

Result: 4+ renders per delta, 60+ renders/second during streaming.

## Target Architecture: Make Races Structurally Impossible

### Principle 1 — Single state machine per thread

Streaming content and persisted messages are **the same data at different lifecycle stages**. They should not live in separate stores.

```
┌─────────────────────────────────┐
│       ThreadRenderState         │  ← single source of truth
│                                 │
│  messages: MessageParam[]       │  committed (persisted) messages
│  pendingBlocks: StreamBlock[]   │  in-flight streaming content
│  toolStates: Record<...>        │  tool execution state
│  status: AgentThreadStatus      │  running | complete | error
│  chainId: string | null         │  last applied event ID
│                                 │
│  get displayItems():            │  [...messages, ...pendingBlocks]
│    → unified render list        │  ← components see ONE list
└─────────────────────────────────┘
```

One store. One update per event. One render.

### Principle 2 — Events are truth during streaming; disk is cold-start only

| State | Source of truth | Disk role |
|-------|----------------|-----------|
| Cold start / thread switch | Disk | Hydrate the state machine |
| Streaming (status=running) | Events | Not read at all |
| Completion | Final disk read | Reconcile any gaps |
| Stream gap during streaming | Periodic full snapshots from agent | Not read |
| State gap during streaming | Tolerate — streaming content is ahead | Reconcile on completion |

#### Gap recovery without disk reads

Today, a state chain gap triggers `loadThreadState()` from disk. Without disk reads, we need different recovery paths for each chain type:

**Stream chain gaps** (missed STREAM_DELTA):
- Currently the agent only sends `full` blocks on first emission per message (`!this.lastEventId` in `StreamAccumulator`). Mid-message gaps have no recovery path without disk.
- **Solution: Periodic full snapshots.** The agent's `StreamAccumulator` sends a `full` payload every N deltas (e.g., every 20). This caps the maximum data loss from a gap at ~1 second of streaming content, and the next periodic full restores the chain automatically.
- On gap detection: clear `pendingBlocks`, reset `streamChainId`. The next periodic full arrives within ~1s and resyncs.
- Alternative considered: UI→agent resync request. Rejected because it adds bidirectional messaging complexity and the periodic approach is simpler with minimal bandwidth cost (full blocks during streaming are typically <2KB).

**State chain gaps** (missed AGENT_STATE_DELTA):
- During active streaming, the user sees `pendingBlocks` — they're always ahead of committed `messages`. A gap in the state chain is **invisible** to the user because streaming content covers the active message.
- Between messages (during tool execution), committed messages are visible. But tool use gaps are very rare because tool execution produces far fewer state deltas than streaming.
- **Solution: tolerate during streaming, reconcile on completion.** On gap: reset `chainId` to `null`, preserve all displayed content. The final disk read on `AGENT_COMPLETED` reconciles everything. If the agent sends another full state delta (which happens periodically), the chain is restored automatically without disk.
- No heartbeat/staleness polling needed during active streaming — the stream deltas themselves prove liveness.

### Principle 3 — Trickle scoped to final block only

The current trickle implementation already only animates the last block (`isLast` prop on `TrickleBlock`). The 60fps `setDisplayedLength()` calls are acceptable **as long as they only trigger re-renders of the single active TrickleBlock**, not the entire message list.

The key constraint is that `MarkdownRenderer` needs the trickled content to render correctly — it can't be bypassed with DOM manipulation since markdown parsing must happen on the progressively-revealed text.

**What to verify/ensure:**
- `TrickleBlock` is `memo`'d so non-last blocks don't re-render when the last block's content changes
- `StreamingContent` only passes changing props to the last block
- The virtual list doesn't recalculate all items when only the last item's height changes
- `findSafeBoundary()` prevents broken markdown from causing layout thrash

### Principle 4 — Single scroll coordinator

Replace the current two-effect system (`followCountChange` + `followOutput` subscriber) with one:

```ts
class ScrollCoordinator {
  private sticky = true;
  private pendingScroll: ScrollBehavior | null = null;

  // Called by: ResizeObserver, count change, user scroll
  onHeightChanged(): void { if (this.sticky) this.scheduleScroll("auto"); }
  onCountChanged(): void { if (this.sticky) this.scheduleScroll("smooth"); }
  onUserScrollUp(): void { this.sticky = false; }
  onUserNearBottom(): void { this.sticky = true; }

  // One rAF, one scroll, one frame
  private scheduleScroll(behavior: ScrollBehavior): void { ... }
}
```

Pure class, trivially testable. No React effects competing.

### Principle 5 — Testable through pure functions

Every critical piece becomes a pure function or class testable without React/DOM:

| Component | Pure extraction | Test strategy |
|-----------|----------------|---------------|
| Event processing | `applyEvent(state, event) → state` | Unit: replay event sequences, assert state |
| Gap detection | `detectGap(chainId, event) → "intact" \| "gap" \| "full-sync"` | Unit: all three paths |
| Scroll decisions | `ScrollCoordinator` class | Unit: sticky engage/disengage, competing signals |
| Trickle interpolation | `interpolate(current, target, elapsed, duration) → position` | Unit: math |
| Safe boundary | `findSafeBoundary(text, pos) → pos` | Already tested |
| Virtual list | `VirtualList` class | Already tested |
| Turn grouping | Pure function | Already tested |

**Integration test**: Record real event sequences from agent sessions, replay them through `applyEvent`, assert that:
- No content flashes (pendingBlocks never go empty then non-empty)
- Gap recovery produces same state as no-gap path
- Completion produces same state regardless of event ordering

**Visual regression**: Playwright test that simulates streaming via mock events, captures frames, asserts no layout jumps > N pixels between frames.

---

## Phases

- [ ] Audit agent-side event emission — verify StreamAccumulator and output.ts correctness, add periodic full snapshots to StreamAccumulator for gap recovery
- [ ] Design and test `ThreadStateMachine` — pure reducer with `applyEvent(state, event) → state`, covering STREAM_DELTA, AGENT_STATE_DELTA, AGENT_COMPLETED, gap detection, full-sync
- [ ] Unify streaming-store + thread-store into single store backed by `ThreadStateMachine`, remove dual chain tracking
- [ ] Eliminate disk reads during streaming — events-only while status=running, disk read on cold start and completion only
- [ ] Verify trickle scoping — ensure only the final block re-renders during streaming, memo boundaries are correct
- [ ] Consolidate scroll into `ScrollCoordinator` class — replace two-effect system with single class, add unit tests
- [ ] Add event debugger export + Playwright replay tests — record events from debugger, replay via injected WebSocket events in Playwright

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 0: Agent-Side Event Emission — Simplified Architecture

### Where the complexity comes from

The current agent emits **two independent event chains** (state_event + stream_delta) through a **shared transport** (HubClient) that has **three connection states** (connected/reconnecting/disconnected), each with different delivery semantics. That's a 2×3 matrix of behaviors, and every bug found in the audit is an edge case in that matrix:

| | `connected` | `reconnecting` | `disconnected` |
|---|---|---|---|
| **state_event** | send, advance chain | queue in ReconnectQueue, advance chain (Bug 1) | drop silently, advance chain anyway (Bug 1) |
| **stream_delta** | send, advance chain | drop silently (Bug 2) | drop silently (Bug 2) |

The `ReconnectQueue` tries to be smart about dedup during "reconnecting" — replacing queued `state_event` with the latest and forcing `previousEventId: null` — but this creates broken messages because the latest may only have `patches` without `full` (Bug 6).

### Why it's unnecessary

The "reconnecting" state's queueing logic solves a problem that doesn't need solving. During reconnection the agent keeps running and mutating state. By the time reconnection succeeds, whatever was queued is stale — the agent has newer state. Just send the current full state on reconnect.

Same for stream_delta — the `StreamAccumulator` already has accumulated content in `this.blocks`. On reconnect, just send it all.

### Simplified model: binary state + full-on-reconnect

Collapse three connection states into two for event emission purposes:

| Connection | State events (`output.ts`) | Stream deltas (`StreamAccumulator`) |
|---|---|---|
| **Connected** | Emit patches, advance chain | Emit deltas, advance chain |
| **Not connected** (any reason) | Skip, reset chain | Skip (already does this) |

Then: **on `"reconnected"` → both channels send full snapshot. Chain restarts from scratch.**

This eliminates:
- **Bug 1 + Bug 6** — chain always resets when not connected. No stale chain refs, no broken queued messages.
- **Bug 2** — StreamAccumulator gets a reconnect handler that resets its chain. Next emit is full.
- The `ReconnectQueue`'s `state_event` dedup logic — not needed when we send fresh full state on reconnect.
- The `isConnected` vs `connectionState` semantic mismatch — both channels use the same binary check.

What remains as independent improvements:
- **Bug 3** (periodic full for mid-stream recovery) — still valuable, unrelated to reconnection
- **Bug 4** (`structuredClone` cost) — perf optimization, orthogonal
- **Bug 5** (disk blocks socket) — reorder to emit socket first

### Files audited

- `agents/src/output.ts` — state event emission (`emitState()`)
- `agents/src/lib/stream-accumulator.ts` — stream delta emission
- `agents/src/lib/hub/client.ts` — socket connection and queueing
- `agents/src/lib/hub/connection.ts` — low-level socket write/read
- `agents/src/lib/hub/reconnect-queue.ts` — message queueing during reconnection
- `agents/src/runners/shared.ts` — where StreamAccumulator is created (line 1261)
- `agents/src/runners/message-handler.ts` — where StreamAccumulator is consumed

---

### Change 1: Binary `emitViaSocket` in `output.ts`

Replace the three-branch `emitViaSocket` with a binary connected/not-connected check. Reset chain on any non-delivery.

```ts
// output.ts — replace emitViaSocket + chain advancement in emitState()

function isHubConnected(): boolean {
  return hubClient?.connectionState === "connected" ?? false;
}

export async function emitState(): Promise<void> {
  state.timestamp = Date.now();

  // 1. Build event payload
  const eventId = nanoid();
  const previousEventId = lastEventId;

  let payload: StateEvent;
  if (previousEmittedState) {
    const patches = jsonpatch.compare(previousEmittedState, state);
    payload = { id: eventId, previousEventId, patches };
  } else {
    payload = { id: eventId, previousEventId: null, patches: [], full: state };
  }

  // 2. Emit via socket FIRST (non-blocking) — Bug 5 fix
  if (isHubConnected()) {
    hubClient!.sendStateEvent(payload);
    // Clone AFTER sending — still needed for correct patch computation next time
    previousEmittedState = structuredClone(state);
    lastEventId = eventId;
  } else {
    // Not connected (reconnecting OR disconnected) — reset chain
    // Next emit when connected will send full snapshot
    previousEmittedState = null;
    lastEventId = null;
  }

  // 3. Disk write last, fire-and-forget — Bug 5 fix
  const snapshot = previousEmittedState ?? structuredClone(state);
  writeStateToDisk(snapshot).catch(err => logger.warn(`[output] Disk write failed: ${err}`));
}
```

**What this eliminates:**
- The `emitViaSocket` function entirely (inline the check)
- The `lastLoggedConnectionState` tracking
- The three-way branching (connected/reconnecting/disconnected)
- Bug 1: chain never advances unless we confirmed connected delivery
- Bug 6: no messages queued during reconnection, so no broken dedup

### Change 2: Reconnect handler for `output.ts`

Wire a `"reconnected"` listener so the first emit after reconnect sends full state:

```ts
// In runner.ts or wherever setHubClient is called:
export function setHubClient(client: HubClient): void {
  hubClient = client;
  client.on("reconnected", () => {
    // Force full sync on next emitState()
    previousEmittedState = null;
    lastEventId = null;
    // Immediately emit current state as full snapshot
    emitState().catch(err => logger.warn(`[output] Failed to emit on reconnect: ${err}`));
  });
}
```

### Change 3: StreamAccumulator reconnect handler + periodic full

Two changes to `StreamAccumulator`:

**3a. Add `resetChain()` method** (clears chain, keeps accumulated content):
```ts
resetChain(): void {
  this.lastEventId = null;
  this.lastEmittedLengths = [];
  // blocks preserved — next emit sends full with all accumulated content
}
```

**3b. Add periodic full snapshots** (Bug 3 fix — independent of reconnection):
```ts
private emitCount = 0;
private fullSyncInterval = 20;

private emitSnapshot(): void {
  this.dirty = false;
  const blocks = this.blocks.filter(Boolean);
  if (!this.hubClient.isConnected) return;

  const eventId = nanoid();
  this.emitCount++;
  const needsFull = !this.lastEventId || this.emitCount % this.fullSyncInterval === 0;

  if (!this.lastEventId) {
    // First emit or post-reconnect — full only
    this.hubClient.send({
      type: "stream_delta", threadId: this.threadId,
      id: eventId, previousEventId: null, deltas: [], full: blocks,
    });
  } else {
    // Compute deltas
    const deltas = this.computeDeltas(blocks);
    if (deltas.length > 0 || needsFull) {
      this.hubClient.send({
        type: "stream_delta", threadId: this.threadId,
        id: eventId, previousEventId: this.lastEventId, deltas,
        ...(needsFull && { full: blocks }),
      });
    }
  }
  this.lastEmittedLengths = blocks.map(b => b.content.length);
  this.lastEventId = eventId;
}
```

**3c. Wire reconnect handler** in `shared.ts`:
```ts
// shared.ts — after creating accumulator
const accumulator = hubClient && context.threadId
  ? new StreamAccumulator(hubClient, context.threadId)
  : undefined;

if (accumulator && hubClient) {
  hubClient.on("reconnected", () => accumulator.resetChain());
}
```

### Change 4: Remove `state_event` dedup from ReconnectQueue

The `state_event` dedup in `ReconnectQueue` (lines 30-38) is no longer needed — `output.ts` won't send state_events during reconnection. Remove the block:

```ts
// reconnect-queue.ts — DELETE lines 30-38
// The state dedup (lines 20-27) can stay — it's still useful for other state messages
```

Other message types (`event`, `log`, `drain`, `register`) still benefit from queueing during reconnection. Only `state_event` queueing is removed.

### Change 5: Disk write reordering (Bug 5)

Already shown in Change 1. Socket emit happens first, disk write is fire-and-forget. The `structuredClone` still happens (needed for correct patch computation) but no longer blocks the socket emit.

Note: `writeStateToDisk` still falls back to `writeFileSync` in some paths (output.ts:205, 208). Converting to async-only is a separate improvement but not blocking.

---

### What about `structuredClone`? (Bug 4)

The `structuredClone` is still needed for correct `jsonpatch.compare()` — the previous state must be a frozen snapshot. The original plan's shallow-spread fix (`previousEmittedState = { ...state }`) is broken because `state.messages` is a mutable array that gets `.push()`'d. A shallow copy shares the array reference, so `compare()` sees no diff.

**Phase 0 improvement:** Move the clone after the socket emit (done in Change 1) so it doesn't block delivery.

**Phase 1+ improvement:** Switch `output.ts` to immutable state updates — each mutation creates a new array/object reference. Then `{ ...state }` works correctly and eliminates `structuredClone`. This aligns with the ThreadStateMachine's immutable pattern but is a larger refactor.

---

### Tests

```ts
// agents/src/__tests__/output-chain.test.ts

describe("emitState chain integrity", () => {
  test("sends full when connected after being disconnected", async () => {
    // 1. Connected: emitState() → full (first)
    // 2. Connected: emitState() → delta
    // 3. Disconnected: emitState() → skipped, chain reset
    // 4. Connected: emitState() → full (not delta)
  });

  test("skips emit and resets chain during reconnecting", async () => {
    // 1. Connected: emitState() → full
    // 2. Reconnecting: emitState() → skipped, chain reset
    // 3. Connected (after reconnect): emitState() → full
  });

  test("reconnect event triggers immediate full state emit", async () => {
    // 1. Connect, emit some deltas
    // 2. Fire "reconnected" event
    // 3. Verify emitState() was called and sent full
  });

  test("socket emit happens before disk write", async () => {
    // Track call order of hubClient.sendStateEvent vs writeStateToDisk
  });
});

// agents/src/lib/__tests__/stream-accumulator.test.ts

describe("StreamAccumulator", () => {
  test("first emit sends full blocks", () => { ... });
  test("subsequent emits send deltas only", () => { ... });

  test("resetChain() causes next emit to be full", () => {
    // 1. Several delta emits
    // 2. resetChain()
    // 3. Next emit → full with ALL accumulated content (blocks preserved)
  });

  test("periodic full every N deltas", () => {
    // 1. Emit 19 deltas (all incremental)
    // 2. 20th emit includes full blocks alongside deltas
  });

  test("skips emit when hub not connected, preserves blocks", () => {
    // 1. isConnected = false
    // 2. handleDelta() + flush()
    // 3. send() NOT called, blocks intact
  });
});
```

---

## Phase 1: ThreadStateMachine

The core of the new architecture. A pure class that processes events and produces render state.

```ts
// src/lib/thread-state-machine.ts

interface ThreadRenderState {
  messages: MessageParam[];
  pendingBlocks: StreamingBlock[];
  toolStates: Record<string, ToolExecutionState>;
  status: AgentThreadStatus;
  fileChanges: FileChange[];
  metrics?: ResultMetrics;
  error?: string;
}

type ThreadEvent =
  | { type: "STREAM_DELTA"; payload: StreamDeltaPayload }
  | { type: "AGENT_STATE_DELTA"; payload: AgentStateDeltaPayload }
  | { type: "AGENT_COMPLETED"; payload: { threadId: string } }
  | { type: "AGENT_CANCELLED"; payload: { threadId: string } }
  | { type: "HYDRATE"; payload: { state: ThreadState } };

class ThreadStateMachine {
  private state: ThreadRenderState;
  private chainId: string | null = null;        // unified chain tracker
  private streamChainId: string | null = null;   // stream event chain

  apply(event: ThreadEvent): ThreadRenderState {
    switch (event.type) {
      case "STREAM_DELTA":
        return this.applyStreamDelta(event.payload);
      case "AGENT_STATE_DELTA":
        return this.applyStateDelta(event.payload);
      case "AGENT_COMPLETED":
        return this.handleCompletion();
      case "AGENT_CANCELLED":
        return this.handleCancellation();
      case "HYDRATE":
        return this.hydrate(event.payload.state);
    }
  }

  private applyStreamDelta(payload: StreamDeltaPayload): ThreadRenderState {
    // Gap detection on stream chain
    if (payload.previousEventId === null || !this.streamChainId) {
      // Full sync — use full payload
      if (payload.full) {
        this.streamChainId = payload.id;
        this.state = { ...this.state, pendingBlocks: payload.full };
      }
      return this.state;
    }

    if (payload.previousEventId !== this.streamChainId) {
      // Gap — clear pending, wait for resync
      this.streamChainId = null;
      this.state = { ...this.state, pendingBlocks: [] };
      return this.state;
    }

    // Chain intact — apply deltas to pendingBlocks
    const blocks = [...this.state.pendingBlocks];
    for (const delta of payload.deltas) {
      if (blocks[delta.index]) {
        blocks[delta.index] = {
          ...blocks[delta.index],
          content: blocks[delta.index].content + delta.append,
        };
      } else {
        blocks[delta.index] = { type: delta.type, content: delta.append };
      }
    }
    this.streamChainId = payload.id;
    this.state = { ...this.state, pendingBlocks: blocks };
    return this.state;
  }

  private applyStateDelta(payload: AgentStateDeltaPayload): ThreadRenderState {
    // Gap detection on state chain
    if (payload.previousEventId === null || !this.chainId) {
      if (payload.full) {
        this.chainId = payload.id;
        this.state = {
          ...this.state,
          messages: payload.full.messages,
          toolStates: payload.full.toolStates,
          fileChanges: payload.full.fileChanges,
          status: payload.full.status,
          metrics: payload.full.metrics,
          error: payload.full.error,
          // NOTE: do NOT clear pendingBlocks here — they're ahead of persisted state
        };
      }
      return this.state;
    }

    if (payload.previousEventId !== this.chainId) {
      // Gap — reset chain, wait for next full sync
      this.chainId = null;
      // Don't clear anything — keep showing what we have
      return this.state;
    }

    // Chain intact — apply JSON patches in place, then shallow-spread for new reference
    applyPatch(this.state, payload.patches, false, /* mutate */ true);
    this.chainId = payload.id;
    // Shallow spread produces new reference for Zustand; pendingBlocks stays intact
    this.state = { ...this.state };
    return this.state;
  }

  private handleCompletion(): ThreadRenderState {
    // Merge any remaining pendingBlocks into the final state
    // (the final disk read on completion will be the true reconciliation)
    this.state = {
      ...this.state,
      pendingBlocks: [],
      status: "complete",
    };
    this.chainId = null;
    this.streamChainId = null;
    return this.state;
  }
}
```

**Key properties to test:**
- `apply(STREAM_DELTA)` appends to `pendingBlocks` without touching `messages`
- `apply(AGENT_STATE_DELTA)` patches `messages` without clearing `pendingBlocks`
- Gap in stream chain → `pendingBlocks` cleared, `messages` preserved
- Gap in state chain → nothing cleared, both preserved
- Completion → `pendingBlocks` cleared, status = "complete"
- Rapid alternating STREAM_DELTA + STATE_DELTA → no race, deterministic output

## Phase 2: Unified Store

Replace `streaming-store.ts` + the streaming parts of `thread-store` with a single Zustand store backed by `ThreadStateMachine`:

```ts
// src/stores/thread-render-store.ts

const machines = new Map<string, ThreadStateMachine>();

export const useThreadRenderStore = create<{
  states: Record<string, ThreadRenderState>;
  dispatch: (threadId: string, event: ThreadEvent) => void;
}>((set) => ({
  states: {},
  dispatch: (threadId, event) => {
    let machine = machines.get(threadId);
    if (!machine) {
      machine = new ThreadStateMachine();
      machines.set(threadId, machine);
    }
    const newState = machine.apply(event);
    set((s) => ({ states: { ...s.states, [threadId]: newState } }));
  },
}));
```

**What this eliminates:**
- `streaming-store.ts` entirely (delete)
- `lastStreamEventId` in streaming-store (moved to machine)
- `lastAppliedEventId` in listeners.ts (moved to machine)
- The `clearStream` calls scattered through listeners.ts
- The timing-sensitive "clear AFTER replacement data" pattern

**What stays:**
- `thread-store` for metadata (thread list, active thread, etc.) — not render state
- `listeners.ts` simplified to just: `dispatch(threadId, { type: "STREAM_DELTA", payload })`

## Phase 3: No Disk Reads During Streaming

The `disable-disk-refresh.md` experiment already mapped every disk-read path. This phase makes it the default for streaming threads.

**Prerequisite:** Phase 0 must be complete — periodic full snapshots from `StreamAccumulator` and correct chain reset on disconnect provide the gap recovery that replaces disk reads.

### Current disk-read paths (from `listeners.ts`)

| Path | Trigger | What to do |
|------|---------|-----------|
| `refreshById(threadId)` on every `AGENT_STATE_DELTA` (line 142) | Metadata (cost, status) | Carry metadata in event payload instead |
| `loadThreadState(threadId)` on full-sync without `full` payload (line 161) | Backwards compat | After Phase 0 fix, agent always sends `full` on `previousEventId=null` — dead path |
| `loadThreadState(threadId)` on chain gap (line 182) | Gap recovery | Replace with: reset `chainId`, wait for next `full` from agent |
| `loadThreadState(threadId)` on delta apply error (line 196) | Error recovery | Replace with: reset `chainId`, wait for next `full` from agent |
| `state-recovery.ts` heartbeat staleness polling | No heartbeat for 30s | During streaming, stream deltas prove liveness — disable staleness polling |

### Gap recovery flow (no disk)

```
Stream gap detected:
  1. Clear pendingBlocks, reset streamChainId
  2. Wait (max ~1s) for agent's periodic full snapshot
  3. Full snapshot arrives → restore pendingBlocks, resume chain

State gap detected:
  1. Reset chainId (don't clear anything — keep displaying current content)
  2. During streaming: invisible to user (pendingBlocks cover active message)
  3. On AGENT_COMPLETED: final disk read reconciles committed messages

Hub disconnects during streaming:
  1. Agent-side: output.ts resets previousEmittedState → next emit is full (Phase 0 fix)
  2. Agent-side: StreamAccumulator resets lastEventId → next emit is full (Phase 0 fix)
  3. UI-side: On reconnect, both chains receive full syncs automatically
```

### Simplified listeners.ts

```ts
eventBus.on(EventName.AGENT_STATE_DELTA, (payload) => {
  // Just dispatch to the state machine. No disk reads.
  threadRenderStore.dispatch(payload.threadId, {
    type: "AGENT_STATE_DELTA",
    payload,
  });
});

eventBus.on(EventName.AGENT_COMPLETED, async ({ threadId }) => {
  // ONE disk read to reconcile final state
  threadRenderStore.dispatch(threadId, { type: "AGENT_COMPLETED", payload: { threadId } });
  await threadService.refreshById(threadId);  // metadata
  await threadService.loadThreadState(threadId);  // final reconciliation — HYDRATE event
});
```

**Metadata in events:** The `AGENT_STATE_DELTA` full payload already contains `status`, `metrics`, `lastCallUsage`, `cumulativeUsage`. For the delta path, the JSON patches include these fields when they change. No separate `refreshById()` needed.

## Phase 4: Verify Trickle Scoping

The current trickle implementation is acceptable — MarkdownRenderer needs the trickled content for correct rendering. The goal is not to move trickle off the render path, but to **verify it's properly scoped** so only the final block re-renders.

**Audit checklist:**
- `TrickleBlock` is `memo()`'d — non-last blocks don't re-render when last block changes
- `StreamingContent` doesn't pass changing references to non-last blocks (e.g., no new object/array on every render)
- `useTrickleText` with `isLast=false` returns full content immediately, no rAF loop
- The virtual list's `ResizeObserver` only fires for the last item's height change, not all items
- `findSafeBoundary()` prevents markdown parse failures that could cause layout thrash

**If scoping is already correct:** This phase is a verification pass, not a code change. Document the render count per frame with React DevTools profiler during streaming.

**If scoping is broken:** Fix the memo boundaries. Likely issues:
- Inline object props causing memo invalidation
- `blocks` array reference changing on every delta (should use stable references for non-last blocks)
- Missing `key` props causing unnecessary unmount/remount

## Phase 5: ScrollCoordinator

Extract from `use-virtual-list.ts` into a standalone testable class:

```ts
// src/lib/scroll-coordinator.ts

export class ScrollCoordinator {
  private sticky = true;
  private rafId: number | null = null;
  private pendingBehavior: ScrollBehavior | null = null;
  private scrollElement: HTMLElement | null = null;

  constructor(private options: { onStickyChange?: (sticky: boolean) => void }) {}

  attach(el: HTMLElement): void { this.scrollElement = el; }
  detach(): void { this.scrollElement = null; this.cancel(); }

  // Signals
  onContentGrew(): void { if (this.sticky) this.schedule("auto"); }
  onItemAdded(): void { if (this.sticky) this.schedule("smooth"); }
  onUserScrolledUp(): void { this.setSticky(false); }
  onScrollPositionChanged(gap: number): void {
    if (!this.sticky && gap <= 20) this.setSticky(true);
  }

  // Single rAF-deduplicated scroll
  private schedule(behavior: ScrollBehavior): void {
    this.pendingBehavior = behavior;
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      const b = this.pendingBehavior;
      this.pendingBehavior = null;
      if (!b || !this.scrollElement) return;
      const el = this.scrollElement;
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) {
        el.scrollTo({ top: el.scrollHeight, behavior: b });
      }
    });
  }
}
```

**Tests:**
- `onContentGrew()` when sticky → schedules scroll
- `onContentGrew()` when not sticky → no scroll
- `onUserScrolledUp()` → disengages sticky
- `onScrollPositionChanged(15)` → re-engages sticky
- Multiple signals in same frame → single scroll (last behavior wins)

## Phase 6: Event Debugger Export + Playwright Replay Tests

The existing event debugger (`src/stores/event-debugger-store.ts`) already captures full event payloads in a `CapturedEvent[]` array. This phase extends it with export capabilities and builds a Playwright test harness that replays exported events to test the UI in isolation.

### Step 1: Add export to event debugger

Add an "Export" action to `event-debugger-store.ts` that serializes captured events to a JSON file:

```ts
// New action on EventDebuggerActions
exportEvents: () => {
  const { events, filters } = get();
  const filtered = applyFilters(events, filters);
  const exportData: EventRecording = {
    version: 1,
    recordedAt: new Date().toISOString(),
    threadId: filters.threadId ?? events[0]?.threadId ?? "unknown",
    events: filtered.map(e => ({
      // Strip debugger metadata (id, size), keep what the UI actually receives
      timestamp: e.timestamp,
      type: e.type,
      name: e.name,
      payload: e.payload,  // This is the original AgentSocketMessage
    })),
  };
  // Save via Tauri dialog or clipboard
  return exportData;
};
```

**Export format** (`EventRecording`):
```ts
interface EventRecording {
  version: 1;
  recordedAt: string;
  threadId: string;
  events: Array<{
    timestamp: number;
    type: string;       // "state_event", "stream_delta", "event", etc.
    name?: string;
    payload: unknown;   // The raw AgentSocketMessage as captured
  }>;
}
```

The `payload` field contains the exact `AgentSocketMessage` that would come through the Tauri `agent:message` listener. This is important — it means Playwright tests can inject these payloads directly into the same code path the real app uses.

### Step 2: Event injection bridge for Playwright

Add a dev-only injection endpoint that Playwright can call:

```ts
// src/lib/test-event-bridge.ts (only loaded in dev/test builds)

if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  (window as any).__injectAgentMessage = (msg: AgentSocketMessage) => {
    // Fire through the same code path as real Tauri events
    // This hits agent-service.ts:157's listener callback directly
    eventBus.emit(EventName.fromSocketMessage(msg), msg);
  };

  (window as any).__replayRecording = async (recording: EventRecording) => {
    for (const event of recording.events) {
      (window as any).__injectAgentMessage(event.payload);
      // Preserve relative timing between events
      const nextEvent = recording.events[recording.events.indexOf(event) + 1];
      if (nextEvent) {
        const delay = nextEvent.timestamp - event.timestamp;
        if (delay > 0) await new Promise(r => setTimeout(r, Math.min(delay, 100)));
      }
    }
  };
}
```

**Key design decision:** Events are injected at the `eventBus.emit()` level, NOT at the Tauri listener level. This means:
- We don't need to mock Tauri's `listen()` API
- The event debugger still captures injected events (useful for debugging test failures)
- The full UI pipeline from event → store → component is exercised
- The injection point is the same regardless of whether events come from Tauri, WebSocket, or test harness

### Step 3: Playwright test fixtures

```ts
// e2e/fixtures/event-recording.ts

import { test as base } from "@playwright/test";
import type { EventRecording } from "../../src/lib/test-event-bridge";

export const test = base.extend<{
  replayRecording: (recording: EventRecording) => Promise<void>;
  loadRecording: (name: string) => Promise<EventRecording>;
}>({
  replayRecording: async ({ page }, use) => {
    await use(async (recording) => {
      await page.evaluate(
        (rec) => (window as any).__replayRecording(rec),
        recording
      );
    });
  },
  loadRecording: async ({}, use) => {
    await use(async (name) => {
      const fs = await import("fs/promises");
      const path = `e2e/recordings/${name}.json`;
      return JSON.parse(await fs.readFile(path, "utf-8"));
    });
  },
});
```

### Step 4: Playwright tests using real recordings

```ts
// e2e/streaming-replay.spec.ts

import { test } from "./fixtures/event-recording";
import { expect } from "@playwright/test";

test("no content flash during normal streaming", async ({ page, loadRecording, replayRecording }) => {
  const recording = await loadRecording("normal-streaming-session");

  // Navigate to the thread view
  await page.goto(`/thread/${recording.threadId}`);

  // Track pendingBlocks visibility
  const flashDetected = await page.evaluate(() => {
    let hadContent = false;
    let flashCount = 0;
    const observer = new MutationObserver(() => {
      const streamingEl = document.querySelector("[data-testid='streaming-content']");
      const hasContent = streamingEl && streamingEl.textContent!.length > 0;
      if (hadContent && !hasContent) flashCount++;
      if (hasContent) hadContent = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    (window as any).__flashObserver = observer;
    (window as any).__flashCount = () => flashCount;
    return false;
  });

  await replayRecording(recording);
  await page.waitForTimeout(1000); // let final renders settle

  const flashes = await page.evaluate(() => (window as any).__flashCount());
  expect(flashes).toBe(0);
});

test("no layout jump > 50px during streaming", async ({ page, loadRecording, replayRecording }) => {
  const recording = await loadRecording("long-streaming-response");
  await page.goto(`/thread/${recording.threadId}`);

  // Capture scroll positions
  await page.evaluate(() => {
    const positions: number[] = [];
    const el = document.querySelector("[data-testid='message-list']")?.firstElementChild;
    if (!el) return;
    const observer = new MutationObserver(() => positions.push(el.scrollTop));
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    (window as any).__scrollPositions = () => positions;
  });

  await replayRecording(recording);
  await page.waitForTimeout(2000);

  const positions = await page.evaluate(() => (window as any).__scrollPositions());
  for (let i = 1; i < positions.length; i++) {
    expect(Math.abs(positions[i] - positions[i - 1])).toBeLessThan(50);
  }
});

test("gap recovery restores content within 2 seconds", async ({ page, loadRecording, replayRecording }) => {
  const recording = await loadRecording("streaming-with-gap");
  await page.goto(`/thread/${recording.threadId}`);

  await replayRecording(recording);
  await page.waitForTimeout(2000);

  // After replay, streaming content should be visible (not stuck empty from gap)
  const hasContent = await page.evaluate(() => {
    const el = document.querySelector("[data-testid='streaming-content']");
    return el && el.textContent!.length > 0;
  });
  expect(hasContent).toBe(true);
});
```

### Step 5: Recording workflow

1. Open event debugger (Cmd+Shift+D → Events tab)
2. Start capture (Record button)
3. Trigger the scenario you want to test (start an agent, let it stream, etc.)
4. Stop capture
5. Click "Export" → saves to `e2e/recordings/{name}.json`
6. Write a Playwright test that loads and replays the recording

**Curated recordings to maintain:**
- `normal-streaming-session.json` — typical text streaming with thinking blocks
- `long-streaming-response.json` — extended response to test scroll behavior
- `streaming-with-gap.json` — manually crafted or captured during network disruption
- `tool-use-interleaved.json` — streaming interrupted by tool calls
- `rapid-state-deltas.json` — fast state updates during tool execution

### Unit tests (ThreadStateMachine)

These don't need Playwright — they test the pure state machine directly:

```ts
// src/lib/__tests__/thread-state-machine.test.ts

function replayEvents(events: ThreadEvent[]): ThreadRenderState[] {
  const machine = new ThreadStateMachine();
  return events.map(e => machine.apply(e));
}

test("no content flash during normal streaming", () => {
  const states = replayEvents([
    streamDelta({ id: "1", previousEventId: null, full: [{ type: "text", content: "Hello" }] }),
    streamDelta({ id: "2", previousEventId: "1", deltas: [{ index: 0, append: " world" }] }),
    stateDelta({ id: "a", previousEventId: null, full: { messages: [...], ... } }),
    streamDelta({ id: "3", previousEventId: "2", deltas: [{ index: 0, append: "!" }] }),
  ]);

  for (const state of states) {
    expect(state.pendingBlocks.length).toBeGreaterThan(0);
  }
});

test("gap recovery preserves visible content", () => {
  const states = replayEvents([
    streamDelta({ id: "1", previousEventId: null, full: [{ type: "text", content: "Hello" }] }),
    streamDelta({ id: "3", previousEventId: "2", ... }), // gap!
    streamDelta({ id: "4", previousEventId: null, full: [{ type: "text", content: "Hello world" }] }),
  ]);

  expect(states[1].pendingBlocks).toEqual([]);
  expect(states[2].pendingBlocks[0].content).toBe("Hello world");
});
```

---

## Migration Strategy

This is not a big-bang rewrite. Each phase is independently shippable:

0. **Phase 0** (agent audit) — fix agent-side emission bugs first. Without this, Phases 1-3 build on a broken foundation. Changes are in `agents/` only, no UI impact.
1. **Phase 1** (ThreadStateMachine) — new code, no existing code changes. Write + test the pure class.
2. **Phase 2** (unified store) — wire the new machine into the event pipeline alongside existing stores. Feature-flag it. Remove old stores once validated.
3. **Phase 3** (no disk reads) — depends on Phase 0 (periodic full snapshots provide gap recovery). Make events-only the default for streaming threads.
4. **Phase 4** (trickle verification) — audit only, no code changes if scoping is correct. Can be done any time.
5. **Phase 5** (scroll) — can be done independently. Extract, test, swap.
6. **Phase 6** (event debugger replay tests) — can start immediately with export feature. Playwright tests build on Phases 0-3 once the event pipeline is stable.

**Dependency graph:**
```
Phase 0 (agent fixes) ──→ Phase 3 (no disk reads)
Phase 1 (state machine) ──→ Phase 2 (unified store) ──→ Phase 3
Phase 4 (trickle) — independent
Phase 5 (scroll) — independent
Phase 6 (tests) — can start immediately, full value after Phase 3
```

## What This Eliminates

| Current problem | How it's eliminated |
|----------------|-------------------|
| Chain advances on dropped/queued messages (Bugs 1, 6) | Phase 0: binary connected check — only advance chain on confirmed delivery |
| ReconnectQueue creates broken state_events (Bug 6) | Phase 0: don't queue state_events at all — send fresh full on reconnect |
| StreamAccumulator has no reconnect handler (Bug 2) | Phase 0: wire `"reconnected"` → `resetChain()`, next emit is full |
| No stream gap recovery mid-message (Bug 3) | Phase 0: periodic full snapshots every ~20 deltas |
| Disk write blocks socket emit (Bug 5) | Phase 0: socket first, disk fire-and-forget |
| Two-store race (streaming vs thread) | Phase 2: single state machine |
| Two chain trackers disagreeing | Phase 2: one chain tracker per event type in one machine |
| Disk reads during streaming | Phase 3: events-only while running |
| Content flash on gap recovery | Phase 1: pending preserved, only cleared on gap in *stream* chain |
| Competing scroll effects | Phase 5: single ScrollCoordinator |
| Timing-sensitive "clear AFTER load" | Phase 2: no clearing needed — one store |
| No UI integration tests for streaming | Phase 6: event replay from debugger recordings |
| `structuredClone` on every state emit (Bug 4) | Phase 0: moved after socket emit. Phase 1+: immutable state updates eliminate it |

## What This Preserves

- "Disk as truth" for cold start and completion (pattern still valid at rest)
- Virtual list engine (already well-tested, works great)
- Trickle visual effect on React render path (only final block re-renders, MarkdownRenderer needs the content)
- Sticky scroll UX (intent-based engage/disengage)
- Event bridge pattern (events still signal, just no disk reads during streaming)
- Event debugger for real-time inspection (now extended with export for test automation)
