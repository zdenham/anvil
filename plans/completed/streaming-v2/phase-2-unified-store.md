# Phase 2: Deprecate Streaming Store

Parent: [readme.md](./readme.md) | Full design: [streaming-architecture-v2.md](../streaming-architecture-v2.md#phase-2-unified-store)

## Goal

Delete `streaming-store.ts`. Stream deltas write directly into `threadStates` via the `ThreadStateMachine`, with `isStreaming: true` on in-flight blocks. No separate store, no `pendingBlocks` — streaming content appears as regular messages with streaming-flagged blocks.

## Design Decisions

**No separate store.** `threadStates` already lives in thread-store. With stable IDs, the machine writes streaming content directly into the messages array. Components keep reading from `useThreadStore(s => s.threadStates[threadId])` — zero migration for committed-state consumers.

**No `pendingBlocks`.** With stable IDs, every streaming block maps 1:1 to its final committed block. The machine inserts a work-in-progress assistant message into `messages` on first stream delta, appends to its blocks on subsequent deltas, and marks each block `isStreaming: true`. When the committed action (APPEND_ASSISTANT_MESSAGE) arrives, the reducer replaces the WIP content and `isStreaming` disappears. Components just check `block.isStreaming` to decide whether to use TrickleText.

**`isStreaming` on the block, not a separate tracking structure.** Simplest possible API for components. The flag is optional on the block type — disk state never has it, committed state never has it, it only exists transiently during streaming.

## Impact on Phase 1

Phase 1's `ThreadStateMachine.getState()` should return a `ThreadRenderState` where streaming blocks are **merged into `messages`** with `isStreaming: true`, not exposed as a separate `pendingBlocks` array. Internally the machine can track streaming state however it wants, but the output is a flat messages array.

Update Phase 1's `ThreadRenderState`:
```ts
// BEFORE (original plan):
interface ThreadRenderState {
  messages: StoredMessage[];
  pendingBlocks: StreamingBlock[];  // ← DELETE
  // ...
}

// AFTER:
interface ThreadRenderState {
  messages: StoredMessage[];  // includes WIP message with isStreaming blocks
  // ...
}
```

And add `isStreaming?: boolean` to the content block type used by `StoredMessage`.

## Dependencies

- **Phase 1** must be complete (provides `ThreadStateMachine` at `src/lib/thread-state-machine.ts`)

## Phases

- [x] Add `isStreaming?: boolean` to content block type (in `core/types/`)
- [x] Add `dispatch()` action to thread-store that delegates to `ThreadStateMachine`
- [x] Rewrite `src/entities/threads/listeners.ts` to dispatch through thread-store
- [x] Migrate streaming consumers (2 files) to read from thread-store
- [x] Delete `src/stores/streaming-store.ts`
- [x] Update tests
- [x] Run full test suite, fix regressions

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Block Type Change (`core/types/`)

Add optional `isStreaming` to content blocks:

```ts
interface TextBlock {
  type: "text";
  text: string;
  isStreaming?: boolean;  // client-only, never persisted to disk
}

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  isStreaming?: boolean;
}
```

This is safe because:
- The field is optional — existing disk state validates fine
- The agent never sets it — only `ThreadStateMachine` on the client
- It disappears when committed state replaces the WIP message

---

## Thread Store Changes (`src/entities/threads/store.ts`)

### New state + actions

```ts
import { ThreadStateMachine } from "@/lib/thread-state-machine";
import type { TransportEvent } from "@/lib/thread-state-machine";

/** Machine instances live outside Zustand to avoid serialization issues. */
const machines = new Map<string, ThreadStateMachine>();

// Add to existing ThreadStoreActions:
interface ThreadStoreActions {
  // ... existing actions stay ...

  /** Dispatch a transport event to the thread's state machine. */
  dispatch: (threadId: string, event: TransportEvent) => void;
}
```

### `dispatch` implementation

```ts
dispatch: (threadId, event) => {
  let machine = machines.get(threadId);
  if (!machine) {
    machine = new ThreadStateMachine();
    machines.set(threadId, machine);
  }
  const renderState = machine.apply(event);
  set((s) => ({
    threadStates: { ...s.threadStates, [threadId]: renderState },
  }));
},
```

### `setThreadState` update

The existing `setThreadState` (used by `loadThreadState` for disk hydration) should also go through the machine:

```ts
setThreadState: (threadId, state) => {
  if (!state) {
    machines.delete(threadId);
    set((s) => {
      const { [threadId]: _, ...rest } = s.threadStates;
      return { threadStates: rest };
    });
    return;
  }
  // Hydrate through machine so it tracks chain state
  let machine = machines.get(threadId);
  if (!machine) {
    machine = new ThreadStateMachine();
    machines.set(threadId, machine);
  }
  const renderState = machine.apply({ type: "HYDRATE", state });
  set((s) => ({
    threadStates: { ...s.threadStates, [threadId]: renderState },
  }));
},
```

### Type change

```diff
- threadStates: Record<string, DiskThreadState>;
+ threadStates: Record<string, ThreadRenderState>;
```

`ThreadRenderState` is what `ThreadStateMachine.getState()` returns — same shape as `DiskThreadState` but blocks can have `isStreaming: true`. All existing selectors work unchanged since it's a superset.

### Panel hide cleanup

```ts
// When panel hides, destroy the machine so next activation triggers full HYDRATE
export function clearMachineState(threadId: string): void {
  machines.delete(threadId);
}
```

---

## Listeners Changes (`src/entities/threads/listeners.ts`)

### `AGENT_STATE_DELTA` handler

**Before:** 40 lines — manual chain tracking, `lastAppliedEventId`, `applyPatch`, `clearStream()`

**After:**
```ts
eventBus.on(EventName.AGENT_STATE_DELTA, async (payload) => {
  const { threadId } = payload;
  await threadService.refreshById(threadId);

  store.dispatch(threadId, {
    type: "THREAD_ACTION",
    action: payload.action,  // Phase 1: actions instead of patches
    seq: payload.seq,
  });

  // Cascade parent refresh (unchanged)
  const thread = threadService.get(threadId);
  if (thread?.parentThreadId) {
    await threadService.refreshById(thread.parentThreadId);
  }
});
```

### `STREAM_DELTA` handler (moved from streaming-store)

```ts
eventBus.on(EventName.STREAM_DELTA, (payload) => {
  store.dispatch(payload.threadId, {
    type: "STREAM_DELTA",
    payload,
  });
});
```

### `OPTIMISTIC_STREAM` handler (moved from streaming-store)

```ts
eventBus.on(EventName.OPTIMISTIC_STREAM, (payload) => {
  store.dispatch(payload.threadId, {
    type: "STREAM_DELTA",
    payload: { ...payload, id: crypto.randomUUID(), previousEventId: null, deltas: [], full: payload.blocks },
  });
});
```

### `AGENT_COMPLETED` / `AGENT_CANCELLED`

**Before:** `clearStream()` after `loadThreadState()`

**After:** No `clearStream` needed. `loadThreadState()` hydrates through the machine, which clears streaming state automatically.

### Removed from listeners.ts

- `lastAppliedEventId` record — chain tracking moves to machine
- `clearChainState()` — replaced by `clearMachineState()`
- All `useStreamingStore` imports

---

## Component Migration (2 files)

### `src/components/thread/streaming-content.tsx`

**Before:**
```tsx
const stream = useStreamingStore((s) => s.activeStreams[threadId]);
// renders stream.blocks
```

**After:** This component renders streaming blocks inline. With `isStreaming` on blocks in the regular messages array, this component either:
- Becomes a simple check: find blocks with `isStreaming` in the last message and render with TrickleText
- Or gets absorbed into the normal message rendering path (Phase 4 trickle audit)

Minimal change for Phase 2:
```tsx
const lastMessage = useThreadStore(
  useCallback((s) => {
    const state = s.threadStates[threadId];
    if (!state?.messages.length) return null;
    return state.messages[state.messages.length - 1];
  }, [threadId])
);
const streamingBlocks = lastMessage?.content?.filter(b => b.isStreaming) ?? [];
// render streamingBlocks with TrickleText (same JSX as before)
```

### `src/components/thread/message-list.tsx`

**Before:**
```tsx
const hasStreamingContent = useStreamingStore(
  (s) => !!s.activeStreams[threadId]?.blocks.length
);
```

**After:**
```tsx
const hasStreamingContent = useThreadStore(
  useCallback((s) => {
    const state = s.threadStates[threadId];
    if (!state?.messages.length) return false;
    const last = state.messages[state.messages.length - 1];
    return last?.content?.some(b => b.isStreaming) ?? false;
  }, [threadId])
);
```

---

## Files Changed

| File | Action | What changes |
|------|--------|-------------|
| `core/types/` (block types) | MODIFY | Add `isStreaming?: boolean` to content block types |
| `src/entities/threads/store.ts` | MODIFY | Add `dispatch()`, update `setThreadState()` to use machine, widen `threadStates` type |
| `src/entities/threads/listeners.ts` | MODIFY | Dispatch through store, absorb streaming listeners, remove `lastAppliedEventId` |
| `src/components/thread/streaming-content.tsx` | MODIFY | Read from threadStates instead of streaming-store |
| `src/components/thread/message-list.tsx` | MODIFY | Check `isStreaming` on blocks instead of streaming-store |
| `src/stores/streaming-store.ts` | DELETE | Fully replaced |
| `src/entities/index.ts` | MODIFY | Remove `setupStreamingListeners()` call |
| `src/test/helpers/stores.ts` | MODIFY | Remove streaming-store from test helpers |

## What This Eliminates

| Removed | Replaced by |
|---------|-------------|
| `streaming-store.ts` (105 lines) | `isStreaming` flag on blocks in threadStates |
| `pendingBlocks` concept | Streaming blocks in messages array |
| `lastStreamEventId` record | `ThreadStateMachine` internal chain tracking |
| `lastAppliedEventId` record | `ThreadStateMachine` internal seq tracking |
| `clearStream()` calls (4 sites) | Machine auto-clears on HYDRATE/committed actions |
| `clearChainState()` | `clearMachineState()` (deletes machine instance) |
| `setupStreamingListeners()` | Absorbed into `setupThreadListeners()` |
| Dual store reads in components | Single `threadStates` read |

## What Stays Unchanged

- All `threadStates` consumers (6 files) — same selector, same data shape (superset)
- Thread metadata: `threads`, `activeThreadId`, selectors, read state, optimistic applies
- `threadService.loadThreadState()` — still reads from disk, just routes through machine
- `activeThreadLoading`, `threadErrors` — stay in thread-store as-is

## Verification

- [ ] Components render correctly during streaming — blocks show TrickleText when `isStreaming`
- [ ] No content flash during streaming → committed transition
- [ ] `streaming-store.ts` deleted, zero remaining imports
- [ ] All existing tests pass
- [ ] New test: dispatch STREAM_DELTA, verify `isStreaming` blocks appear in messages
- [ ] New test: dispatch THREAD_ACTION after streaming, verify `isStreaming` cleared
- [ ] New test: HYDRATE clears all streaming state
