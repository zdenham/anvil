# Live Usage Updates & Aggregate Parent Cost

## Problem

Two issues with thread usage display:

### Issue 1: Sub-thread usage doesn't update live

**Root cause: Missing `THREAD_UPDATED` event emission after writing usage to metadata.**

The previous plan (`usage-to-metadata.md`) was marked complete but missed a critical step. The agent SDK writes usage to `metadata.json` in two places, but **neither emits a `THREAD_UPDATED` event** to notify the frontend:

1. **`agents/src/output.ts:349`** — `updateUsage()` calls `writeUsageToMetadata()` for the parent thread. No event emitted.
2. **`agents/src/runners/message-handler.ts:410-413`** — `handleForChildThread()` calls `writeUsageToMetadata()` for child threads. No event emitted.

The `emitState()` call in `updateUsage()` does send state via socket for the *parent* thread, which triggers `AGENT_STATE` on the frontend. This means the **parent thread's** usage updates live (the `AGENT_STATE` listener calls `refreshById` which re-reads metadata). But for **child threads**, `emitChildThreadState()` only writes `state.json` to disk — it doesn't send via socket (no hub connection for child threads) and no event is emitted. The child's metadata.json gets written, but nobody tells the frontend.

**The fix:** After `writeUsageToMetadata()` for child threads, emit a `THREAD_UPDATED` event via the parent's hub connection.

### Issue 2: Parent threads don't show aggregate cost (self + descendants)

**Root cause: `ContextMeter` only shows the thread's own `cumulativeUsage`, not the aggregate.**

The `getAggregateUsage()` utility exists in `threadService` (line 668) but the `ContextMeter` component doesn't use it. It reads `thread?.cumulativeUsage` directly, which is only the parent thread's own usage — not including sub-agents.

**The fix:** Have `ContextMeter` use `getAggregateUsage()` for the cost display, while keeping the context pressure bar using the thread's own `lastCallUsage` (context window fullness is per-conversation, not aggregate).

## Phases

- [x] Emit THREAD_UPDATED events for child thread usage updates (agents/src/runners/message-handler.ts)
- [x] Use aggregate usage in ContextMeter for parent threads (src/components/content-pane/context-meter.tsx)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

**Note:** Phase 1 and Phase 2 are independent — Phase 1 is backend (agent SDK), Phase 2 is frontend (React). They can be implemented in parallel.

---

## Phase 1: Emit THREAD_UPDATED events for child thread usage updates

### 1a. `emitChildThreadState` should emit `THREAD_UPDATED` for child threads

**File: `agents/src/runners/message-handler.ts`**

`emitChildThreadState()` (line 354) currently only writes `state.json` to disk. It has no socket connection for child threads (child threads don't have their own hub connection — they share the parent's).

After writing child state.json, also emit a `THREAD_UPDATED` event via the parent's hub connection so the frontend knows to refresh the child's metadata:

```typescript
private async emitChildThreadState(childThreadId: string, state: ThreadState): Promise<void> {
  state.timestamp = Date.now();
  const statePath = join(this.anvilDir!, "threads", childThreadId, "state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Emit THREAD_UPDATED so frontend refreshes this child's metadata
  emitEvent(EventName.THREAD_UPDATED, { threadId: childThreadId });
}
```

Import `EventName` from `@core/types/events.js` and `emitEvent` is already imported from `./shared.js`.

**Why this works:**
- `emitEvent` uses the parent's hub connection (set globally via `setHubClient`)
- The frontend's `THREAD_UPDATED` listener calls `threadService.refreshById(childThreadId)` which re-reads the child's `metadata.json` (now containing updated usage)
- The cascading refresh then calls `refreshById(parentThreadId)` which triggers a Zustand store update for the parent, causing any component showing aggregate cost to re-render

**Throttling consideration:** `emitChildThreadState` is called for every SDK message (assistant messages with usage, tool results, etc.). The `THREAD_UPDATED` event will fire frequently during sub-agent runs. But the frontend listener is already async and idempotent (`refreshById` just reads a file), so this is fine. If performance becomes an issue, we could debounce — but LLM API calls are slow enough that this shouldn't be needed.

### 1b. Remove redundant `writeUsageToMetadata` call in `handleForChildThread`

Currently `handleForChildThread` calls both `emitChildThreadState` (writes state.json) and `writeUsageToMetadata` (writes metadata.json). Since `emitChildThreadState` now emits `THREAD_UPDATED`, and `writeUsageToMetadata` already handles the metadata write, these remain as-is. No change needed here — the `writeUsageToMetadata` call at line 412 is correct and necessary (it writes usage to metadata.json). The new event emission in `emitChildThreadState` just adds the notification.

---

## Phase 2: Use aggregate usage in ContextMeter for parent threads

### 2a. Show aggregate cost for threads with children

**File: `src/components/content-pane/context-meter.tsx`**

The `TooltipContent` currently receives `cumulativeUsage` from the thread's own metadata. For parent threads, we want to show the aggregate cost (self + all descendants).

Update the `ContextMeter` component to compute aggregate cost:

```typescript
export function ContextMeter({ threadId }: ContextMeterProps) {
  const thread = useThreadStore(
    useCallback((s) => s.threads[threadId], [threadId]),
  );
  const threadState = useThreadStore(
    useCallback((s) => s.threadStates[threadId], [threadId]),
  );

  // For aggregate cost, subscribe to all descendant threads too
  // so the component re-renders when any descendant's usage changes
  const descendantIds = threadService.getDescendantThreadIds(threadId);
  const descendants = useThreadStore(
    useCallback(
      (s) => descendantIds.map(id => s.threads[id]),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [descendantIds.join(",")]
    ),
  );

  const usage = thread?.lastCallUsage;
  if (!usage) return null;

  // Compute aggregate cost: this thread + all descendants
  const aggregateUsage = threadService.getAggregateUsage(threadId);

  // ... rest of component uses `aggregateUsage` for cost display
```

**Key detail:** We need the component to subscribe to descendant threads in the Zustand store so it re-renders when their usage changes. The `descendants` selector achieves this — even though we don't use the variable directly, the subscription ensures re-renders. However, this selector approach is fragile (the dependency array trick with `join(",")` is not ideal).

**Simpler alternative — use the `threads` map broadly:**

Instead of subscribing to individual descendants, we can use a more coarse-grained selector that watches the entire `threads` map. But this would cause too many re-renders.

**Best approach — use `useMemo` with explicit dependency on descendant usage:**

```typescript
const allThreads = useThreadStore(useCallback((s) => s.threads, []));
const aggregateUsage = useMemo(() => {
  return threadService.getAggregateUsage(threadId);
}, [allThreads, threadId]);
```

This subscribes to the entire threads map. Since `_applyUpdate` creates a new reference per thread, the `threads` reference changes on every update. This is fine for ContextMeter (one instance per active thread, not a list).

### 2b. Update TooltipContent to show both thread cost and total cost

When a thread has descendants, show both:
- "thread cost" — the thread's own `cumulativeUsage`
- "total cost" — aggregate of thread + all descendants

When no descendants exist, show just "thread cost" as before.

```tsx
{cumulativeUsage && (
  <div className="flex justify-between gap-4 mt-0.5">
    <span className="text-surface-400">
      {hasDescendants ? "own cost" : "thread cost"}
    </span>
    <span className="text-surface-300">
      {formatCost(calculateCost(cumulativeUsage))}
    </span>
  </div>
)}
{aggregateUsage && hasDescendants && (
  <div className="flex justify-between gap-4 mt-0.5">
    <span className="text-surface-400">total cost</span>
    <span className="text-surface-300">
      {formatCost(calculateCost(aggregateUsage))}
    </span>
  </div>
)}
```

---

## Phase 3: Add tests

### 3a. Test `emitChildThreadState` emits THREAD_UPDATED

Verify that when `handleForChildThread` processes an assistant message with usage, a `THREAD_UPDATED` event is emitted with the child's thread ID.

### 3b. Test aggregate usage in ContextMeter

Verify that when viewing a parent thread, the tooltip shows "total cost" that sums the parent + all descendant thread costs.

### 3c. Test cascading refresh

Verify that when a child thread's usage updates, the parent thread's ContextMeter re-renders with updated aggregate cost.

---

## Files to modify

| File | Changes |
|------|---------|
| `agents/src/runners/message-handler.ts` | Add `THREAD_UPDATED` event emission in `emitChildThreadState()` |
| `src/components/content-pane/context-meter.tsx` | Use `getAggregateUsage()` for cost display, show "own cost" vs "total cost" |

## Risk considerations

- **Event frequency:** `THREAD_UPDATED` will fire on every child thread message (including tool results). This is manageable since the frontend handler is async and idempotent. Each invocation is one file read + store update.
- **Selector granularity:** Subscribing to `allThreads` in ContextMeter is slightly over-broad (re-renders on any thread change). Since there's only one ContextMeter per active view, this is negligible. Can be optimized later with a more targeted selector if needed.
- **No schema changes needed:** The `ThreadMetadataBaseSchema` already has `lastCallUsage` and `cumulativeUsage` fields, and `getAggregateUsage()` already exists in the service.
