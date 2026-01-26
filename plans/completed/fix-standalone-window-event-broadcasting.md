# Fix Event Broadcasting from Standalone Control Panel Windows

## Problem Statement

Events (like `THREAD_UPDATED` when marking a thread as read) are not being properly broadcast from standalone popped-out control panel windows (`control-panel-window-{uuid}`) to other windows. The main window and NSPanel do not receive these events.

## Root Cause Analysis

After investigating the codebase, I've identified the issue:

### The Event Flow Works Correctly

The event bridge architecture is sound:
1. `markThreadAsRead()` in `src/entities/threads/store.ts:169` emits `eventBus.emit(EventName.THREAD_UPDATED, { threadId })`
2. `setupOutgoingBridge()` in `src/lib/event-bridge.ts:241-293` listens for this event and broadcasts via Tauri's `emit()` to all windows
3. `setupIncomingBridge()` in `src/lib/event-bridge.ts:342-464` receives the event and forwards to local mitt
4. `setupThreadListeners()` in `src/entities/threads/listeners.ts:19-25` handles `THREAD_UPDATED` by calling `threadService.refreshById(threadId)`

### The Actual Problem: Module-Level State and HMR Cleanup

The issue is in `src/lib/event-bridge.ts` with the module-level state:

```typescript
let bridgeInitialized = false;      // Line 140
let previousCleanup: UnlistenFn[] = [];  // Line 141
```

These are **module-level singletons**. When a standalone window is created:
1. It loads a fresh instance of the `event-bridge.ts` module
2. `bridgeInitialized` is `false` for this new window
3. `previousCleanup` is empty

This is **correct** and should work. However, there's a subtle issue with the **window label caching**:

```typescript
let currentWindowLabel: string | null = null;  // Line 147

function getWindowLabel(): string {
  if (currentWindowLabel === null) {
    currentWindowLabel = getCurrentWindow().label;
  }
  return currentWindowLabel;
}
```

### The Real Bug: Echo Prevention with Mismatched Labels

The echo prevention logic relies on `_source` matching:

**Outgoing (line 261):**
```typescript
const outgoingPayload: BroadcastPayload = { ...payload as object, _source: sourceLabel };
```

**Incoming (line 389):**
```typescript
if (payload._source === currentLabel) {
  return; // Skip echo
}
```

**The bug**: When a standalone window emits an event, the `_source` is set to its label (e.g., `control-panel-window-abc123`). When other windows receive this event, they correctly process it because `payload._source !== currentLabel`.

**However**, the issue is that the **listener handler in `setupThreadListeners` calls `threadService.refreshById()`**, which reads from disk. If the disk write from the originating window hasn't completed yet, the refresh gets stale data.

### Timing Issue Confirmed

In `store.ts:172-179`:
```typescript
// Persist to disk - import threadService here to avoid circular dependency
setTimeout(async () => {
  try {
    const { threadService } = await import("./service");
    await threadService.update(threadId, { isRead: true });
  } catch (error) {
    logger.warn(`Failed to persist isRead flag for thread ${threadId}:`, error);
  }
}, 0);
```

The event is emitted **immediately** (line 169), but the disk write happens in a `setTimeout(..., 0)`. This creates a race condition:

1. Window A marks thread as read
2. Window A updates local state
3. Window A emits `THREAD_UPDATED` event ← **happens immediately**
4. Window A schedules disk write ← **happens later (setTimeout)**
5. Window B receives `THREAD_UPDATED`
6. Window B calls `threadService.refreshById()` which reads from disk
7. **Disk still has old state** → Window B gets stale data

### Why This Affects Standalone Windows More

The NSPanel might not exhibit this issue as noticeably because:
1. The NSPanel often shares the same JavaScript context timing with the main window
2. The standalone window runs in a completely separate WebView process with different timing characteristics
3. The race condition window is more pronounced with separate processes

## Proposed Fix

### Option A: Include Full Data in Event Payload (Recommended)

Instead of just emitting `{ threadId }`, include the updated `isRead` state in the payload so receivers can update without disk read:

**In `src/entities/threads/store.ts`:**

```typescript
markThreadAsRead: (threadId) => {
  const thread = get().threads[threadId];
  if (!thread) return;

  const updatedThread = { ...thread, isRead: true, markedUnreadAt: undefined };

  set((state) => {
    const newThreads = {
      ...state.threads,
      [threadId]: updatedThread,
    };
    return {
      threads: newThreads,
      _threadsArray: Object.values(newThreads),
    };
  });

  // Emit event with full thread data so receivers can update without disk read
  eventBus.emit(EventName.THREAD_UPDATED, {
    threadId,
    thread: updatedThread  // <-- Include the updated state
  });

  // Persist to disk asynchronously
  setTimeout(async () => {
    try {
      const { threadService } = await import("./service");
      await threadService.update(threadId, { isRead: true });
    } catch (error) {
      logger.warn(`Failed to persist isRead flag for thread ${threadId}:`, error);
    }
  }, 0);
},
```

**In `src/entities/threads/listeners.ts`:**

```typescript
eventBus.on(EventName.THREAD_UPDATED, async ({ threadId, thread }: EventPayloads[typeof EventName.THREAD_UPDATED]) => {
  try {
    if (thread) {
      // Use the provided thread data directly (from cross-window broadcast)
      useThreadStore.getState()._applyOptimistic(thread);
    } else {
      // Fallback to disk refresh (for legacy events or local-only events)
      await threadService.refreshById(threadId);
    }
  } catch (e) {
    logger.error(`[ThreadListener] Failed to refresh updated thread ${threadId}:`, e);
  }
});
```

**Update `core/types/events.ts`:**

```typescript
[EventName.THREAD_UPDATED]: {
  threadId: string;
  thread?: ThreadMetadata;  // Optional for backwards compatibility
};
```

### Option B: Await Disk Write Before Emitting Event

Move the event emission after the disk write completes:

```typescript
markThreadAsRead: async (threadId) => {  // Make async
  const thread = get().threads[threadId];
  if (!thread) return;

  set((state) => {
    // ... same as before
  });

  // Persist to disk FIRST
  try {
    const { threadService } = await import("./service");
    await threadService.update(threadId, { isRead: true });
  } catch (error) {
    logger.warn(`Failed to persist isRead flag for thread ${threadId}:`, error);
  }

  // THEN emit event
  eventBus.emit(EventName.THREAD_UPDATED, { threadId });
},
```

**Downside**: This makes `markThreadAsRead` async, which may require changes to all call sites.

### Option C: Add Retry/Delay in Listener

Add a small delay in the listener before refreshing:

```typescript
eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }) => {
  // Small delay to allow disk write to complete
  await new Promise(resolve => setTimeout(resolve, 50));
  await threadService.refreshById(threadId);
});
```

**Downside**: Adds latency, doesn't guarantee success, is a hack.

## Recommendation

**Option A** is the cleanest solution because:
1. No race conditions - data travels with the event
2. No additional async complexity
3. No artificial delays
4. Backwards compatible (optional `thread` field)
5. More efficient - avoids disk read when data is already available

## Files to Modify

1. `core/types/events.ts` - Add optional `thread` field to `THREAD_UPDATED` payload
2. `src/entities/threads/store.ts` - Include thread data in `markThreadAsRead` event
3. `src/entities/threads/listeners.ts` - Handle thread data in event payload
4. Optionally: Apply same pattern to `markThreadAsUnread` and other similar operations

## Testing

1. Open main window with thread list
2. Pop out a control panel window for a thread
3. Mark thread as read in the standalone window
4. Verify main window immediately shows thread as read
5. Close standalone window, reopen from tray - verify state persisted correctly
