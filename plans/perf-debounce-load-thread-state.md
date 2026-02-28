# Debounce/Coalesce loadThreadState During Streaming

Extracted from `memory-and-perf-from-timeline.md` Phase 2.

## Phases

- [ ] Add per-threadId debounced wrapper around loadThreadState
- [ ] Replace direct loadThreadState calls in AGENT_STATE listener with debounced version
- [ ] Ensure AGENT_COMPLETED bypasses debounce for immediate load

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Problem

Each AGENT_STATE event triggers a **cascade of 3-4 Zustand store updates**:

1. `refreshById(threadId)` — updates `threads[threadId]` metadata
2. `loadThreadState(threadId)` — reads **entire thread state from disk** into `threadStates[threadId]`
3. `clearStream(threadId)` — clears streaming store
4. `refreshById(parentThreadId)` — refreshes parent metadata (if exists)

During 10s of streaming: 4 `loadThreadState` cycles, each reading `metadata.json` (12 reads), `state.json` (4 reads), `tree-menu.json` (5 reads), and listing `plan-thread-edges/` (5 reads, 310KB each = 1.5MB total). Plus 50 AGENT_STATE events → 59 selector evaluations → 28 full ThreadContent renders.

**Why this is wrong**: Stream state is already in a separate store (`streaming-store`). AGENT_STATE events during streaming should NOT be loading the full state from disk every time — the streaming store already has the latest content for display. The disk-based state load should happen infrequently to sync metadata/usage, not on every agent persist.

## Implementation

### `src/entities/threads/service.ts`

Add a per-threadId debounced wrapper:

```ts
// Map of threadId → debounced loadThreadState
const debouncedLoaders = new Map<string, () => void>();

function getDebouncedLoader(threadId: string): () => void {
  let loader = debouncedLoaders.get(threadId);
  if (!loader) {
    loader = debounce(() => threadService.loadThreadState(threadId), 200, {
      leading: true,  // First call for a newly-active thread is immediate
      trailing: true, // Last call in a burst still fires
    });
    debouncedLoaders.set(threadId, loader);
  }
  return loader;
}

// Export for use in listeners
export function loadThreadStateDebounced(threadId: string): void {
  getDebouncedLoader(threadId)();
}

// Clean up when thread becomes inactive
export function clearDebouncedLoader(threadId: string): void {
  debouncedLoaders.delete(threadId);
}
```

### `src/entities/threads/listeners.ts`

In the AGENT_STATE handler (~line 108), replace:
```ts
await threadService.loadThreadState(threadId);
```
with:
```ts
loadThreadStateDebounced(threadId);
```

Keep AGENT_COMPLETED using the direct `threadService.loadThreadState(threadId)` call (no debounce).

## Constraints

- AGENT_COMPLETED must trigger immediate (non-debounced) load
- First call for a newly-active thread should be immediate (leading edge)
- Debounce is per-threadId so different threads don't interfere
- Clean up debounce timers when threads become inactive

## Broader Concern: Stream vs State Separation

The deeper issue is that AGENT_STATE events during streaming trigger a full disk reload when the UI should be rendering from the streaming store. A future improvement would be to **skip `loadThreadState` entirely during active streaming** and only sync from disk when:
- The agent completes (AGENT_COMPLETED)
- The user navigates to a thread that isn't currently streaming
- A periodic background sync (e.g. every 5s) for metadata like usage/cost

The debounce is the immediate fix; the architectural separation is the long-term goal.
