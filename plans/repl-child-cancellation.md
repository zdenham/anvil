# REPL Child Cancellation Propagation

## Problem

When the user cancels a parent thread, child threads spawned by anvil-repl remain in "running" status in the UI. The cancel signal (SIGTERM) reaches the children via process group signaling, so the child processes do die — but no one reliably emits `THREAD_STATUS_CHANGED` or `AGENT_COMPLETED` events to update the frontend.

### Root Cause

Three gaps in the cancellation flow:

1. **Hub disconnects before exit handler**: In `runner.ts`, `cleanup()` calls `hub.disconnect()` on line 428, then `process.exit(130)` fires the `process.on("exit")` handler in `ChildSpawner` which kills children — but the hub is already dead, so no events can be emitted for the children.

2. `waitForResult` **events may never fire**: In the normal (non-cancel) path, the parent emits `THREAD_STATUS_CHANGED` + `AGENT_COMPLETED` for children after they exit (`child-spawner.ts:244-253`). During cancellation, if the SDK interrupts the hook via the abort signal, `waitForResult` never completes its emit calls.

3. **No frontend listener catches child death**: The frontend only has close listeners for processes spawned via `agent_spawn` Tauri command. Children spawned by Node's `child_process.spawn()` in ChildSpawner have no such listener — but this is fine as long as the agent writes cancelled status to disk (Phase 1) and the frontend does an optimistic store update (Phase 2).

## Phases

- [x] Add cancellation propagation to ChildSpawner (emit status events for active children before hub disconnect)

- [x] Add optimistic UI update for child threads on parent cancellation

- [x] Add test coverage for the cancellation propagation path

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add cancellation propagation to ChildSpawner

Children are spawned with `detached: false`, so SIGTERM propagates to them automatically via process group signaling — no explicit killing needed. The problem is purely that **no one writes the cancelled status to disk or emits events** before the hub disconnects.

The ChildSpawner needs a `cancelAll()` method that, for each active child:

1. Writes "cancelled" status to metadata.json on disk (source of truth)
2. Emits `THREAD_STATUS_CHANGED` (status: "cancelled") and `AGENT_COMPLETED` (exitCode: 130)

This must be called **before** the hub disconnects. The best integration point is in the abort handler in `runner.ts`, before `cleanup()` is called.

### Changes

`agents/src/hooks/repl-hook.ts`

- The ChildSpawner is currently created per-hook-invocation (ephemeral). We need to make it accessible to the runner for cancellation cleanup.
- Option: The repl hook factory should expose a `cancelAll()` method that delegates to the ChildSpawner.

`agents/src/lib/anvil-repl/child-spawner.ts`

- Add a `cancelAll()` method that, for each active child:
  - Writes "cancelled" status to metadata.json on disk first (source of truth)
  - Then emits status events to the frontend
  - No explicit SIGTERM needed — process group signaling handles that
- Need to also track `childThreadId` → `threadPath` (not just PIDs) so we can write disk + emit events per child thread.

`agents/src/runners/shared.ts`

- `runAgentLoop` needs to capture a reference to the repl hook's cancel function
- Pass it back to the caller (or stash it) so the abort handler can call it

`agents/src/runner.ts`

- In the abort catch block, call the repl cancellation cleanup **before** `cleanup()` (which disconnects the hub)

### Design Sketch

```typescript
// child-spawner.ts
class ChildSpawner {
  // Change activePids from Set<number> to Map<number, string> (pid → childThreadId)
  private activeChildren = new Map<number, { threadId: string; threadPath: string }>();

  // No SIGTERM needed — children inherit process group, OS propagates the signal.
  // This method persists cancelled state and notifies the frontend before hub disconnect.
  cancelAll(): void {
    for (const [_, { threadId, threadPath }] of this.activeChildren) {
      // Write cancelled status to disk first (source of truth)
      this.writeMetadataStatus(threadPath, "cancelled");

      // Then emit events so frontend updates
      this.emitEvent(EventName.THREAD_STATUS_CHANGED, { threadId, status: "cancelled" });
      this.emitEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 130 });
    }
    this.activeChildren.clear();
  }
}
```

```typescript
// runner.ts abort handler
if (isAbort) {
  // Cancel REPL children BEFORE hub disconnect
  replCancelFn?.();

  await cancelled();
  await strategy.cleanup(context, "cancelled");
  cleanup(); // hub disconnect happens here
  process.exit(130);
}
```

## Phase 2: Optimistic UI cascade in existing `handleStatusChanged`

The agent owns the disk write (Phase 1). The frontend just needs to cascade the cancellation to children in the store so the UI updates immediately. This belongs in the existing `handleStatusChanged` listener — it's just another status transition rule, not a separate handler.

On next app refresh, the frontend reads from disk and gets the correct state from Phase 1's `metadata.json` write. No frontend disk write needed.

### Changes

`src/entities/threads/listeners.ts`

- In `handleStatusChanged` (line 119), after the existing `refreshById` call:
  - If the thread's new status is "cancelled", find running children via `parentThreadId` and optimistically mark them cancelled in the store using `_applyOptimistic`
  - No disk write — the agent already wrote `metadata.json` in Phase 1
  - No new handler or event subscription needed

### Design Sketch

```typescript
// listeners.ts — inside handleStatusChanged, after refreshById
const handleStatusChanged = async ({ threadId }: EventPayloads[typeof EventName.THREAD_STATUS_CHANGED]) => {
  try {
    await threadService.refreshById(threadId);

    const thread = threadService.get(threadId);

    // Cascade: when parent is cancelled, optimistically cancel running children
    if (thread?.status === "cancelled") {
      const store = useThreadStore.getState();
      const runningChildren = store._threadsArray
        .filter(t => t.parentThreadId === threadId && t.status === "running");
      for (const child of runningChildren) {
        store._applyOptimistic({ ...child, status: "cancelled" });
      }
    }

    // Mark thread as unread when it transitions to running status
    if (thread?.status === "running") {
      await useThreadStore.getState().markThreadAsUnread(threadId);
      logger.info(`[ThreadListener] Marked thread ${threadId} as unread (status: running)`);
    }
  } catch (e) {
    logger.error(`[ThreadListener] Failed to refresh thread status ${threadId}:`, e);
  }
};
```

## Phase 3: Test coverage

`agents/src/lib/anvil-repl/__tests__/child-spawner.test.ts`

- Add test for `cancelAll()` method: verifies SIGTERM sent, events emitted, metadata written
- Verify `cancelAll()` clears `activeChildren` map

**Integration test consideration:**

- The existing `anvil-repl.integration.test.ts` could be extended to test the cancellation path, but this requires live API calls. A unit test for `cancelAll()` with mocked emitEvent is sufficient.