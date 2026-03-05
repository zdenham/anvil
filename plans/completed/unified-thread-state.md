# Unified Thread State: Remove Committed/WIP Split & JSON Patches

## Context

The current frontend maintains a two-tier state model: "committed" state (from agent actions/patches) and "WIP" state (ephemeral streaming overlay). This split causes duplicate thinking blocks, stale state races, and complex gap-detection machinery. Meanwhile, JSON patches (`fast-json-patch`) add another layer of indirection that's redundant now that the agent sends explicit `ThreadAction` reducer actions.

The agent side already has the right architecture: `dispatch(action) → threadReducer → disk → socket`. The frontend should mirror this: receive actions, reduce them into a single state. No overlay, no patches, no chain tracking.

**Key user requirements:**
- One state reduced by events, written to disk (by agent)
- Remove `fast-json-patch` — explicit reducer pattern only
- Stable IDs: mapping from Anthropic message IDs → proprietary UUIDs

---

## Phases

- [x] Extend ThreadAction with STREAM_START and STREAM_DELTA
- [x] Add anthropicId → UUID mapping to ThreadState
- [x] Rewrite ThreadStateMachine to single-state reducer
- [x] Rewrite listeners.ts to route thread_action directly (remove patches/chain)
- [x] Update agent-service.ts routing (thread_action → THREAD_ACTION, stream_delta → STREAM_DELTA)
- [x] Remove fast-json-patch dependency and dead code
- [x] Update tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Extend ThreadAction with streaming actions

**File: `core/lib/thread-reducer.ts`**

Add two new action types:

```typescript
export type ThreadAction =
  // ... existing actions ...
  | { type: "STREAM_START"; payload: { anthropicMessageId: string } }
  | { type: "STREAM_DELTA"; payload: { anthropicMessageId: string; deltas: BlockDelta[] } }
```

**STREAM_START**: Creates a new assistant message in `messages[]` with `isStreaming: true` on an empty content block. Generates a UUID for the message, stores the mapping in `idMap`.

**STREAM_DELTA**: Finds the message by `anthropicMessageId` (via `idMap`), applies deltas to its content blocks. If no message exists yet, implicitly does STREAM_START first.

**APPEND_ASSISTANT_MESSAGE change**: Instead of always appending, check `idMap` for an existing streaming message with matching `anthropicMessageId`. If found, **replace** that message in-place. If not found, append as before.

### ID Mapping

Add to ThreadState:

```typescript
export interface ThreadState {
  // ... existing fields ...
  /** Maps Anthropic SDK message IDs to our stable UUIDs */
  idMap?: Record<string, string>; // anthropicId → uuid
}
```

The reducer uses `idMap` to correlate stream deltas with their messages. When `APPEND_ASSISTANT_MESSAGE` arrives, it looks up the anthropicId (from `message.anthropicId` field on StoredMessage), finds the streaming message's UUID, and replaces it.

### StoredMessage extension

```typescript
export interface StoredMessage {
  id: string;           // Our stable UUID
  anthropicId?: string; // SDK message ID (e.g., msg_013Zva...)
  role: string;
  content: unknown;
  [key: string]: unknown;
}
```

Agent-side change in `output.ts:appendAssistantMessage`: Set `anthropicId` on the message from the SDK's message ID, generate a UUID for `id`.

---

## Phase 2: Rewrite ThreadStateMachine → single state

**File: `src/lib/thread-state-machine.ts`**

Remove:
- `wipMessage` field
- `getCommittedState()` method
- `applyStreamDelta()` private method (overlay logic)
- `lastSeq` / `hasGap` / `needsHydration` (gap detection for patches)

The machine becomes a thin wrapper around `threadReducer`:

```typescript
export class ThreadStateMachine {
  private state: ThreadState;

  constructor(initial?: ThreadState) {
    this.state = initial ?? defaultThreadState();
  }

  getState(): ThreadState {
    return this.state;
  }

  apply(event: TransportEvent): ThreadState {
    switch (event.type) {
      case "THREAD_ACTION":
        this.state = threadReducer(this.state, event.action);
        return this.state;
      case "HYDRATE":
        this.state = { ...event.state };
        return this.state;
    }
  }
}
```

`TransportEvent` simplifies to:
```typescript
export type TransportEvent =
  | { type: "THREAD_ACTION"; action: ThreadAction }
  | { type: "HYDRATE"; state: ThreadState };
```

Removed: `STREAM_DELTA` transport event (now a `ThreadAction` routed through `THREAD_ACTION`).

---

## Phase 3: Rewrite listeners.ts

**File: `src/entities/threads/listeners.ts`**

Remove:
- `lastAppliedEventId` tracking
- `clearChainState()` — simplify to just destroy machine
- `getCommittedState()` import and all callers
- `applyPatch` import from `fast-json-patch`
- `diskReadStats` usage
- `AGENT_STATE` listener (deprecated)
- `AGENT_STATE_DELTA` listener (replaced by THREAD_ACTION)
- `OPTIMISTIC_STREAM` listener (deprecated)

Add new `THREAD_ACTION` listener:
```typescript
eventBus.on(EventName.THREAD_ACTION, ({ threadId, action }) => {
  const store = useThreadStore.getState();
  store.dispatch(threadId, { type: "THREAD_ACTION", action });
  syncUsageFromState(threadId, useThreadStore.getState());
});
```

Update `STREAM_DELTA` listener to dispatch as a ThreadAction:
```typescript
eventBus.on(EventName.STREAM_DELTA, (payload) => {
  const store = useThreadStore.getState();
  const anthropicMessageId = payload.messageId ?? `wip-${payload.threadId}`;
  store.dispatch(payload.threadId, {
    type: "THREAD_ACTION",
    action: { type: "STREAM_DELTA", payload: { anthropicMessageId, deltas: payload.deltas } },
  });
});
```

---

## Phase 4: Update agent-service.ts routing

**File: `src/lib/agent-service.ts`**

`thread_action` case: Forward the action directly.
```typescript
case "thread_action":
  if (msg.action) {
    eventBus.emit(EventName.THREAD_ACTION, {
      threadId: msg.threadId,
      action: msg.action,
    });
  }
  break;
```

Remove `state_event` case entirely.
Remove `state` case (deprecated).
Remove `optimistic_stream` case (deprecated).
Keep `stream_delta` case as-is (emits STREAM_DELTA).

Add new event to `core/types/events.ts`:
```typescript
[EventName.THREAD_ACTION]: {
  threadId: string;
  action: ThreadAction;
};
```

Remove `AGENT_STATE_DELTA` from EventPayloads (and EventName if unused).
Remove `Operation` import from `fast-json-patch`.

---

## Phase 5: Update store.ts

**File: `src/entities/threads/store.ts`**

Remove:
- `getCommittedState()` export
- `clearMachineState()` can stay (destroys machine on panel hide)

`setThreadState` stays as-is (HYDRATE path for cold start / reconnect / agent completion).

---

## Phase 6: Agent-side ID mapping

**File: `agents/src/output.ts`**

In `appendAssistantMessage()`:
- Generate a UUID via `nanoid()` for the message's `id`
- Preserve the SDK message ID as `anthropicId` on the StoredMessage
- Currently the SDK message already has an `id` — rename to `anthropicId`, assign new UUID to `id`

In `initState()`:
- Initialize `idMap: {}` in the state

**File: `agents/src/runners/message-handler.ts`**
- When constructing StoredMessage from SDK response, set `anthropicId` from SDK's message ID

**File: `agents/src/lib/stream-accumulator.ts`**
- Already sends `messageId` (SDK ID) — no change needed
- Fix `filter(Boolean)` index misalignment (iterate with `continue` instead)

---

## Phase 7: Cleanup

Remove:
- `fast-json-patch` from `package.json` and `agents/package.json`
- `Operation` import in `core/types/events.ts`
- `AGENT_STATE_DELTA` and `AGENT_STATE` from EventName/EventPayloads
- `OPTIMISTIC_STREAM` from EventName/EventPayloads
- `OptimisticStreamPayload`, `StreamDeltaPayload` (if fields absorbed)
- `diskReadStats` store (`src/stores/disk-read-stats.ts`) if only used for patch gap tracking
- `previousEventId` / `id` fields from StreamDeltaPayload
- `state_event` handling in agent-service.ts
- `StateEvent` type from hub types

Keep:
- `STREAM_DELTA` event (transport from socket, converted to action in listener)
- `BlockDelta` type (used by both transport and reducer)
- `heartbeat` monitoring (orthogonal)

---

## Files to Change

| File | Change |
|------|--------|
| `core/lib/thread-reducer.ts` | Add STREAM_START, STREAM_DELTA actions; modify APPEND_ASSISTANT_MESSAGE for replace-by-anthropicId |
| `core/types/events.ts` | Add THREAD_ACTION event; add idMap/anthropicId to types; remove AGENT_STATE_DELTA, AGENT_STATE, OPTIMISTIC_STREAM, Operation import |
| `src/lib/thread-state-machine.ts` | Remove wipMessage, getCommittedState, gap detection; simplify to single-state reducer wrapper |
| `src/entities/threads/listeners.ts` | Replace AGENT_STATE_DELTA with THREAD_ACTION; remove patch/chain logic; simplify STREAM_DELTA to dispatch through reducer |
| `src/entities/threads/store.ts` | Remove getCommittedState export; keep dispatch/setThreadState |
| `src/lib/agent-service.ts` | Route thread_action directly; remove state_event/state/optimistic_stream cases |
| `agents/src/output.ts` | Generate UUID for message id, preserve SDK id as anthropicId |
| `agents/src/runners/message-handler.ts` | Set anthropicId on StoredMessage |
| `agents/src/lib/stream-accumulator.ts` | Fix filter(Boolean) index bug |
| `package.json` | Remove fast-json-patch |
| `agents/package.json` | Remove fast-json-patch |

---

## Verification

1. `cd agents && pnpm test` — agent-side tests pass
2. `pnpm test` — frontend tests pass
3. Manual: start a thread, verify streaming text appears incrementally
4. Manual: verify APPEND_ASSISTANT_MESSAGE replaces streaming content (no duplicates)
5. Manual: verify tool states update in real-time (MARK_TOOL_RUNNING/COMPLETE)
6. Manual: disconnect/reconnect — HYDRATE recovers state from disk
7. Grep for `fast-json-patch` — zero results
8. Grep for `getCommittedState` — zero results
9. Grep for `previousEventId` — zero results (in frontend code)
