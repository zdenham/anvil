# Move Usage / Cumulative Usage to Thread Metadata

## Problem

Usage data (`lastCallUsage`, `cumulativeUsage`) currently lives in `state.json`, which is:
- **Large** (~10-100KB per thread, contains full message history)
- **Lazily loaded** (only the active thread's state is in memory)
- **Invisible for inactive threads** (cost can't be read without loading full state)

This means aggregate cost calculations (e.g., total spend across all threads, parent + children cost) require loading every thread's full state — expensive and impractical. The frontend currently only shows cost for the active thread.

## Goal

Move `cumulativeUsage` (and optionally `lastCallUsage`) to `metadata.json` so that:
1. Usage is available for **all threads** at hydration time (metadata is always loaded)
2. Aggregate cost calculations across threads become trivial (iterate metadata in memory)
3. Parent threads can sum their own cost + all descendant costs without loading state files
4. When a child thread updates, the parent's metadata can be reloaded to reflect new totals

## Phases

- [x] Add usage fields to thread metadata schema and agent write paths
- [x] Update frontend to read usage from metadata instead of state
- [x] Add cascading metadata refresh on child thread updates
- [x] Clean up: remove usage from state schema (or keep as redundant for context meter)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add usage fields to thread metadata schema and agent write paths

### 1a. Update `ThreadMetadataBaseSchema` (`core/types/threads.ts`)

Add two optional fields to `ThreadMetadataBaseSchema`:

```typescript
// Token usage (written by agent SDK)
lastCallUsage: TokenUsageSchema.optional(),
cumulativeUsage: TokenUsageSchema.optional(),
```

Import `TokenUsageSchema` from `core/types/events.ts` (it's already defined there at line 227).

### 1b. Agent SDK: Write usage to metadata.json on every API call

**File: `agents/src/output.ts` — `updateUsage()`** (line 333)

After updating `state.cumulativeUsage` and `state.lastCallUsage`, also write them to `metadata.json`. The pattern already exists in other parts of the codebase (read-modify-write on metadata.json).

Approach:
- Add a `metadataPath` variable (initialized alongside `statePath` in `initState()`)
- In `updateUsage()`, after updating state, do a read-modify-write on metadata.json:
  ```
  read metadata.json → merge in lastCallUsage + cumulativeUsage → write metadata.json
  ```
- Use `threadWriter.writeMetadata()` if available (it exists at `agents/src/services/thread-writer.ts:68`), falling back to direct `writeFileSync`
- Emit `THREAD_UPDATED` event after writing so frontend refreshes metadata

**Important considerations:**
- This makes `updateUsage` slightly more expensive (extra file read+write per LLM call). Since LLM calls are slow (seconds), this overhead is negligible.
- Use the existing `threadWriter.writeMetadata()` method for resilient writes.

### 1c. Agent SDK: Write usage to metadata.json for child (sub-agent) threads

**File: `agents/src/runners/message-handler.ts` — `handleForChildThread()`** (line 363)

After accumulating `state.cumulativeUsage` for the child (line 391-397), also write to the child's `metadata.json`. The child thread path is already known from `toolUseIdToChildThreadId`.

Approach:
- In `handleForChildThread`, after computing cumulative usage, read-modify-write the child's `metadata.json` with the updated `lastCallUsage` and `cumulativeUsage`
- Emit `THREAD_UPDATED` for the child thread so frontend refreshes

### 1d. Simple runner: Write usage to metadata.json on cleanup

**File: `agents/src/runners/simple-runner-strategy.ts` — `cleanup()`** (line 452)

When the runner cleans up (thread complete/error/cancelled), read the final `cumulativeUsage` from `state.json` and merge it into `metadata.json`. This ensures the final usage snapshot persists in metadata even if per-call writes were missed.

---

## Phase 2: Update frontend to read usage from metadata instead of state

### 2a. Update `ContextMeter` component

**File: `src/components/content-pane/context-meter.tsx`**

Currently reads from `threadStates[threadId]` (state.json, lazy-loaded):
```typescript
const threadState = useThreadStore(s => s.threadStates[threadId]);
const usage = threadState?.lastCallUsage;
const cumulativeUsage = threadState?.cumulativeUsage;
```

Change to read `cumulativeUsage` from thread metadata (always available):
```typescript
const thread = useThreadStore(s => s.threads[threadId]);
const cumulativeUsage = thread?.cumulativeUsage;
```

Keep reading `lastCallUsage` from state for the context pressure bar (it still needs the per-call snapshot for context window percentage). Or, since we're now also writing `lastCallUsage` to metadata, we can read that from metadata too. The only concern is latency — metadata refresh is event-driven via `refreshById`, while state is loaded directly. In practice the difference is negligible since both are triggered by the same `AGENT_STATE` / `THREAD_UPDATED` events.

**Decision: Read both from metadata.** This simplifies the component and makes it work even when state isn't loaded.

### 2b. Add aggregate cost utility

Create a helper in `src/entities/threads/service.ts` (near `getDescendantThreadIds` at line 651):

```typescript
/**
 * Get total cumulative usage for a thread and all its descendants.
 * Since usage is now in metadata, this works without loading any state files.
 */
getAggregateUsage(threadId: string): TokenUsage | undefined {
  const thread = this.get(threadId);
  if (!thread?.cumulativeUsage) return undefined;

  const descendantIds = this.getDescendantThreadIds(threadId);
  const allUsages = [thread.cumulativeUsage];

  for (const id of descendantIds) {
    const desc = this.get(id);
    if (desc?.cumulativeUsage) allUsages.push(desc.cumulativeUsage);
  }

  return {
    inputTokens: allUsages.reduce((s, u) => s + u.inputTokens, 0),
    outputTokens: allUsages.reduce((s, u) => s + u.outputTokens, 0),
    cacheCreationTokens: allUsages.reduce((s, u) => s + u.cacheCreationTokens, 0),
    cacheReadTokens: allUsages.reduce((s, u) => s + u.cacheReadTokens, 0),
  };
}
```

This enables the ContextMeter (or any other component) to show "total cost including sub-agents" by just reading from the in-memory metadata store.

---

## Phase 3: Cascading metadata refresh on child thread updates

### 3a. Refresh parent metadata when child thread updates

**File: `src/entities/threads/listeners.ts`**

When a child thread's metadata changes (e.g., usage updated, status changed), the parent thread's metadata should also be refreshed. This ensures the UI can show accurate aggregate costs.

Add cascading refresh logic to `THREAD_UPDATED` and `AGENT_COMPLETED` listeners:

```typescript
eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }) => {
  await threadService.refreshById(threadId);

  // Cascade: if this thread has a parent, refresh the parent's metadata too
  const thread = threadService.get(threadId);
  if (thread?.parentThreadId) {
    await threadService.refreshById(thread.parentThreadId);
  }
});
```

Same for `AGENT_COMPLETED` — after refreshing the completed thread, also refresh its parent.

**Why this works:** The parent doesn't need to reload its own metadata.json (its usage hasn't changed). But since the ContextMeter calls `getAggregateUsage()` which iterates descendant metadata from the store, the parent just needs the *child's* metadata to be fresh in the store — which the first `refreshById(threadId)` already handles. So the parent refresh is actually about notifying the UI that something changed. A simpler approach: just ensure the Zustand store subscription triggers a re-render when any descendant metadata changes. Since `getAggregateUsage` reads from the store, and the child's `refreshById` updates the store, React components using aggregate usage will automatically re-render.

**Revised approach:** No explicit parent cascade needed for the metadata refresh. The `refreshById(childThreadId)` already updates the child in the Zustand store, and any component computing aggregate costs will re-derive from the updated store. The key is making sure the `THREAD_UPDATED` event fires for child threads when their usage changes (handled in Phase 1).

However — Zustand selectors only trigger re-renders when their specific slice changes. If ContextMeter selects `threads[parentThreadId]`, it won't re-render when a child updates. So we need either:

1. **Option A:** Have ContextMeter subscribe to both the parent thread AND its descendants (reactive selector)
2. **Option B:** Fire a synthetic `THREAD_UPDATED` event for the parent when a child updates, causing `refreshById` to re-read the parent's (unchanged) metadata and trigger store update

Option A is cleaner. The ContextMeter would use a selector like:
```typescript
const descendantIds = useThreadStore(s => {
  const thread = s.threads[threadId];
  return thread ? threadService.getDescendantThreadIds(threadId) : [];
});
```

But `getDescendantThreadIds` is on the service, not the store. And creating a reactive dependency on all descendants is complex.

**Final approach — Option B is simpler and more robust:**
In the `THREAD_UPDATED` listener, after refreshing the child, fire a `refreshById` for the parent. Even though the parent's `metadata.json` on disk hasn't changed, `refreshById` calls `_applyUpdate` which creates a new object reference in the store, causing Zustand subscribers to re-render.

```typescript
eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }) => {
  await threadService.refreshById(threadId);

  // Cascade: refresh ancestor chain so aggregate cost displays update
  const thread = threadService.get(threadId);
  if (thread?.parentThreadId) {
    await threadService.refreshById(thread.parentThreadId);
  }
});
```

This is lightweight — `refreshById` is just one file read + one store update. Apply the same pattern to `AGENT_STATE` and `AGENT_COMPLETED` listeners.

---

## Phase 4: Clean up

### 4a. Keep usage in state.json (don't remove)

Keep `lastCallUsage` and `cumulativeUsage` in `ThreadStateSchema` for backwards compatibility. State files on disk already contain these fields, and removing them would break parsing of existing states. The state fields become redundant but harmless.

### 4b. Update tests

- Update any tests that check for usage in state to also verify it appears in metadata
- Add test for `getAggregateUsage` utility
- Add test for cascading metadata refresh

---

## Files to modify

| File | Changes |
|------|---------|
| `core/types/threads.ts` | Add `lastCallUsage` and `cumulativeUsage` to `ThreadMetadataBaseSchema` |
| `agents/src/output.ts` | Write usage to metadata.json in `updateUsage()` and `initState()` |
| `agents/src/runners/message-handler.ts` | Write child usage to child metadata.json in `handleForChildThread()` |
| `agents/src/runners/simple-runner-strategy.ts` | Write final usage to metadata.json in `cleanup()` |
| `src/components/content-pane/context-meter.tsx` | Read from metadata instead of state; optionally show aggregate cost |
| `src/entities/threads/service.ts` | Add `getAggregateUsage()` method |
| `src/entities/threads/listeners.ts` | Add cascading refresh for parent threads |

## Risk considerations

- **Write frequency:** `updateUsage` is called once per LLM API call. Each call takes seconds, so an extra metadata.json read+write is negligible overhead.
- **Race conditions:** The agent process is the sole writer of usage fields in metadata.json. The frontend writes other fields (status, turns). The read-modify-write pattern avoids conflicts since they write to disjoint fields.
- **Backwards compat:** Existing threads without usage in metadata will simply show no cost until their next run. The fields are optional, so old metadata.json files parse fine.
