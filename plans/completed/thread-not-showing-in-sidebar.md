# Bug Fix: Thread Not Showing in Sidebar

## Problem

When spawning a new task via spotlight, the running thread does not appear in the sidebar pane even though the taskId is correctly set on disk.

## Root Cause Analysis

The issue is a **cross-window state synchronization bug**. Here's what happens:

### Current Flow

1. **Spotlight window** calls `taskService.createDraft()` (spotlight.tsx:216)
   - Creates task with `threadIds: [threadId]` already set
   - Task is saved to disk and added to spotlight's Zustand store

2. **Spotlight window** broadcasts `emit("task:created", { taskId })` (spotlight.tsx:224)

3. **Task panel window** receives `task:created` event (entities/index.ts:83-94)
   - Calls `taskService.refreshTask(taskId)` which reads task from disk
   - Task panel's store now has task with `threadIds: [threadId]`

4. **Spotlight window** calls `prepareAgent()` (spotlight.tsx:287)
   - `threadService.create()` is called (agent-service.ts:176-182)
   - Thread entity is created in **spotlight window's thread store only**
   - Thread is saved to disk
   - **`thread:created` event is NEVER emitted**

5. **Task panel window** tries to display threads via `useTaskThreads` (use-task-threads.ts)
   - Gets `threadIds` from task store: `[threadId]` ✓
   - Maps through `threadsMap`: `threadsMap[threadId]` returns `undefined` ✗
   - Filter removes undefined values
   - **Result: Empty thread list**

### The Bug

The `thread:created` event is:
- Defined in `events.ts` ✓
- Listed in `BROADCAST_EVENTS` in `event-bridge.ts` ✓
- **Never emitted anywhere** ✗

## Solution

### Step 1: Emit `thread:created` when thread is created

In `src/entities/threads/service.ts`, after the thread is created and persisted, emit the event:

```typescript
// In create() method, after the optimistic block succeeds:
eventBus.emit("thread:created", { metadata });
```

### Step 2: Listen for `thread:created` and sync thread store

In `src/entities/index.ts`, add a listener in `setupTaskEventListeners()`:

```typescript
// Listen for thread creation broadcasts (cross-window sync)
const unlistenThreadCreated = await listen<{ metadata: ThreadMetadata }>(
  "app:thread:created",
  (event) => {
    const { metadata } = event.payload;
    // Add thread to local store if not already present
    const existing = useThreadStore.getState().threads[metadata.id];
    if (!existing) {
      useThreadStore.getState()._applyCreate(metadata);
    }
  }
);
unlisteners.push(unlistenThreadCreated);
```

### Step 3: Fix duplicate threadId issue

There's also a secondary bug - `threadService.create()` tries to link the thread to the task:

```typescript
// In threads/service.ts create() lines 105-112:
if (input.taskId) {
  const task = useTaskStore.getState().tasks[input.taskId];
  if (task) {
    await taskService.update(input.taskId, {
      threadIds: [...task.threadIds, metadata.id],
    });
  }
}
```

But `createDraft()` already sets `threadIds: [input.threadId]`, so this creates a duplicate!

**Fix**: In `threadService.create()`, check if threadId already exists before adding:

```typescript
if (input.taskId) {
  const task = useTaskStore.getState().tasks[input.taskId];
  if (task && !task.threadIds.includes(metadata.id)) {
    await taskService.update(input.taskId, {
      threadIds: [...task.threadIds, metadata.id],
    });
  }
}
```

## Files to Modify

1. `src/entities/threads/service.ts`
   - Add `eventBus.emit("thread:created", { metadata })` after thread creation
   - Fix duplicate threadId check

2. `src/entities/index.ts`
   - Add listener for `app:thread:created` event
   - Import `useThreadStore` and `ThreadMetadata` type

3. `src/task-main.tsx`
   - Add `threadService.hydrate()` to the Promise.all initialization
   - This ensures threads are loaded from disk on window refresh/reload

### Additional Issue: Missing Thread Hydration

The task panel window only hydrated the task store, not the thread store:

```typescript
// Before (task-main.tsx line 112):
taskService.hydrate(), // Only tasks!

// After:
taskService.hydrate(),
threadService.hydrate(), // Now threads are also loaded from disk
```

This caused threads to not appear:
- On window refresh/reload
- When reopening a task panel for an existing task

## Testing

1. Open spotlight and create a new task
2. Verify thread appears in sidebar immediately while agent is running
3. Verify no duplicate threadIds in task metadata on disk
4. Verify thread state updates stream correctly to the UI

## Debug Logs to Add (Optional)

For debugging, consider adding logs at these points:
- `threadService.create()`: Log when thread is created and event emitted
- `setupTaskEventListeners()`: Log when `thread:created` event is received
- `useTaskThreads`: Log threadIds vs threadsMap contents
