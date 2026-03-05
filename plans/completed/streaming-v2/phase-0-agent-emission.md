# Phase 0: Agent-Side Cleanup

Parent: [readme.md](./readme.md) | Full design: [streaming-architecture-v2.md](../streaming-architecture-v2.md)

## Goal

Delete redundant complexity from the agent. Chain tracking (`lastEventId`, `previousEventId`) is redundant with HubClient's monotonic `seq`. `ReconnectQueue` is redundant with disk-as-truth + seq gap detection. Remove both. Add `StoredMessage` type with stable IDs for later React keying.

This phase is **prep work** for Phase 1. It strips the agent down so Phase 1 can cleanly introduce the shared reducer and action-based emission model. Phase 0 deliberately does NOT rewrite `emitState()` or remove `emitViaSocket` — Phase 1 replaces the entire emission pipeline.

## Phases

- [x] Delete `ReconnectQueue` — remove class, strip from HubClient, simplify `send()` to drop when not connected
- [x] Simplify `StreamAccumulator` — remove chain tracking, capture `message_start` message ID
- [x] Remove chain tracking from `output.ts` — delete `lastEventId`, `lastLoggedConnectionState`, strip `id`/`previousEventId` from `sendStateEvent` calls
- [x] Simplify `StateEvent` / `stream_delta` types — drop `id` and `previousEventId`
- [x] Add `StoredMessage` type — preserve API message IDs, generate IDs for user messages
- [x] Wire `StoredMessage` through call sites — message-handler.ts, runner.ts, shared.ts, output.ts signatures
- [ ] Update tests for simplified emission (partial — types compile, but missing behavioral assertions for ID capture/backfill/stripped chain IDs)
- [ ] Run full test suite, verify no regressions

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## What Gets Removed

| Thing | Why it existed | Why we don't need it |
|-------|---------------|---------------------|
| `lastEventId` in output.ts | Link events into chain for gap detection | `seq` on SocketMessage already does this |
| `lastLoggedConnectionState` in output.ts | Avoid spamming disconnect logs | No longer checking connection state in output.ts |
| `lastEventId` in StreamAccumulator | Chain linking for stream deltas | `seq` handles ordering |
| `id` / `previousEventId` on StateEvent | Application-level chain | Redundant with `seq` |
| `id` / `previousEventId` on stream_delta | Application-level chain | Redundant with `seq` |
| `ReconnectQueue` class + file | Buffer messages during reconnect | Disk is truth — client detects seq gaps and reads from disk |
| `flushReconnectQueue()` in HubClient | Replay queued messages after reconnect | No queue, nothing to flush |
| Reconnect queueing in `HubClient.send()` | Route to queue when reconnecting | Silently drop — client recovers from disk |

## What This Does NOT Touch (Deferred to Phase 1)

| Thing | Why it's deferred |
|-------|------------------|
| `emitViaSocket()` wrapper in output.ts | Phase 1 replaces entire emission pipeline with `dispatch()` |
| `emitState()` rewrite | Phase 1 replaces patch-based emission with action-based emission |
| `previousEmittedState` / JSON Patch diffing | Phase 1 eliminates patches — actions ARE the wire format |
| Mutation function bodies | Phase 1 replaces with reducer dispatch |

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/lib/hub/reconnect-queue.ts` | **Delete entire file** |
| `agents/src/lib/hub/client.ts` | Remove ReconnectQueue import/usage, `send()` drops when not connected |
| `agents/src/lib/hub/index.ts` | Remove `ReconnectQueue` re-export |
| `agents/src/lib/hub/types.ts` | Remove `id`, `previousEventId` from `StateEvent` / `StateEventMessage` |
| `agents/src/lib/stream-accumulator.ts` | Remove `lastEventId`, drop chain IDs from emissions, capture `messageId` |
| `agents/src/output.ts` | Remove `lastEventId`, `lastLoggedConnectionState` vars. Strip chain IDs from `sendStateEvent` call. Update `appendAssistantMessage`/`appendUserMessage` for StoredMessage. |
| `core/types/events.ts` | Add `StoredMessage` type |
| `agents/src/runners/message-handler.ts` | Pass `msg.message.id` at call sites |
| `agents/src/runners/shared.ts` | Update `PriorState.messages` to `StoredMessage[]` |
| `agents/src/runner.ts` | Backfill missing IDs on messages loaded from disk |

---

## Change 1: Delete `ReconnectQueue` + Simplify HubClient

### Delete `agents/src/lib/hub/reconnect-queue.ts`

Entire file removed. Zero test coverage, zero consumers outside HubClient.

### Strip from HubClient (`agents/src/lib/hub/client.ts`)

```ts
// DELETE import:
import { ReconnectQueue } from "./reconnect-queue.js";

// DELETE property:
private reconnectQueue = new ReconnectQueue();

// In send() — change from queue-when-reconnecting to drop-when-not-connected:
// BEFORE:
if (this.connectionState === "reconnecting") {
  this.reconnectQueue.push(fullMsg);
  this.trackQueueDepth(this.reconnectQueue.depth);
  return;
}
// AFTER:
if (this.connectionState !== "connected") {
  return; // silently drop — client recovers from disk on seq gap
}

// DELETE flushReconnectQueue() method
// DELETE this.flushReconnectQueue() call in reconnect()
// DELETE trackQueueDepth() if it only served the queue
```

### Strip from barrel export (`agents/src/lib/hub/index.ts`)

```ts
// DELETE:
export { ReconnectQueue } from "./reconnect-queue.js";
```

---

## Change 2: Simplify `StreamAccumulator`

Remove chain tracking. Add message ID capture from `message_start` event.

### Remove chain tracking

```ts
// DELETE property:
private lastEventId: string | null = null;

// DELETE from reset():
this.lastEventId = null;
```

### Capture message ID

```ts
// ADD property:
private messageId: string | null = null;

// ADD to handleDelta():
if (event.type === "message_start") {
  this.messageId = event.message.id;
  return;
}

// ADD to reset():
this.messageId = null;
```

### Simplify `emitSnapshot()`

Remove `id`/`previousEventId` from emissions. Add `messageId`. Keep delta computation and throttling unchanged.

```ts
private emitSnapshot(): void {
  this.dirty = false;
  const blocks = this.blocks.filter(Boolean);

  if (!this.hubClient.isConnected) {
    return;
  }

  const deltas: Array<{ index: number; type: "text" | "thinking"; append: string }> = [];
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
      messageId: this.messageId,
      deltas,
    });
    this.lastEmittedLengths = blocks.map((b) => b.content.length);
  }
}
```

---

## Change 3: Remove Chain Tracking from `output.ts` (Minimal)

Surgical removal of chain tracking only. Does NOT rewrite `emitState()` or remove `emitViaSocket` — Phase 1 replaces those entirely.

### Delete variables

```ts
// DELETE:
let lastEventId: string | null = null;
let lastLoggedConnectionState: string | null = null;

// KEEP — still needed for JSON Patch diffs until Phase 1 eliminates patches:
let previousEmittedState: ThreadState | null = null;
```

### Strip chain IDs from `initState()`

```ts
// DELETE:
lastEventId = null;

// KEEP:
previousEmittedState = null;
```

### Strip chain IDs from `emitState()`

Remove `eventId` generation, `previousEventId`, and `lastEventId` tracking. Keep the rest of `emitState()` intact — Phase 1 replaces it.

```ts
// In emitState(), change the sendStateEvent calls:

// BEFORE:
const eventId = nanoid();
hubClient.sendStateEvent({ id: eventId, previousEventId: lastEventId, patches });
lastEventId = eventId;

// AFTER:
hubClient.sendStateEvent({ patches });
// (no lastEventId tracking)

// Same for the full-state branch:
// BEFORE:
const eventId = nanoid();
hubClient.sendStateEvent({ id: eventId, previousEventId: null, patches: [], full: snapshot });
lastEventId = eventId;

// AFTER:
hubClient.sendStateEvent({ patches: [], full: snapshot });
```

The `emitViaSocket` wrapper, `previousEmittedState` tracking, and JSON Patch diffing all remain. Phase 1 eliminates them when switching to action-based emission.

---

## Change 4: Simplify Types

### `agents/src/lib/hub/types.ts`

```ts
// BEFORE:
export interface StateEvent {
  id: string;
  previousEventId: string | null;
  patches: Operation[];
  full?: unknown;
}

// AFTER:
export interface StateEvent {
  patches: Operation[];
  full?: unknown;
}
```

Same for `StateEventMessage` — drop `id` and `previousEventId`.

`stream_delta` type (inline in StreamAccumulator) becomes `{ type, threadId, messageId, deltas }` — no `id`/`previousEventId`.

---

## Change 5: StoredMessage

### 5a. Add type (`core/types/events.ts`)

```ts
/**
 * A message stored in thread state. Extends SDK MessageParam with
 * a stable ID for identification.
 *
 * Assistant messages use the API-assigned ID (e.g. msg_013Zva...).
 * User messages use a generated nanoid.
 */
export type StoredMessage = MessageParam & { id: string };
```

### 5b. Update output.ts signatures

`appendAssistantMessage` takes `StoredMessage` (caller provides `id`):

```ts
export async function appendAssistantMessage(message: StoredMessage): Promise<void> {
  state.messages.push(message);
  await emitState();
}
```

`appendUserMessage` generates an ID:

```ts
export async function appendUserMessage(content: string): Promise<void> {
  state.messages.push({ role: "user", content, id: nanoid() });
  await emitState();
}
```

Update `initState` param type from `MessageParam[]` to `StoredMessage[]`.

### 5c. Preserve `msg.message.id` at call sites

**File: `agents/src/runners/message-handler.ts`**

In `handleAssistant` and `handleForChildThread`, include `id: msg.message.id`.

### 5d. Backfill IDs on resume

**File: `agents/src/runner.ts`** — backfill missing IDs via `nanoid()` when loading state from disk.

### 5e. Update `PriorState` type

**File: `agents/src/runners/shared.ts`** — `messages: StoredMessage[]`

---

## Tests

- Verify `sendStateEvent` receives `{ patches, full? }` (no `id`/`previousEventId`)
- Verify StreamAccumulator deltas emit without chain IDs, include `messageId`
- Verify `appendAssistantMessage` stores provided `id`
- Verify `appendUserMessage` generates `id` via `nanoid()`
- Verify `loadPriorState` backfills missing IDs
- Delete ReconnectQueue tests if any exist

## Verification

- `cd agents && pnpm test` — all tests pass
- No regressions in existing test suite
