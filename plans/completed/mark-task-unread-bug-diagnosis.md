# Mark Task as Unread Bug Diagnosis

## Issue Summary

When users click "Mark unread" on a task, they expect:
1. The task data to be updated on disk
2. The blue dot indicator to appear, showing the task has unread content

**Current Behavior**: Only the task's `sortOrder` is updated on disk. The blue dot does not appear because the underlying threads are not marked as unread.

**Root Cause**: There is a **fundamental mismatch** between what "Mark unread" does (changes task sort order) and what the blue dot indicator shows (thread read status).

---

## Technical Analysis

### What "Mark Task as Unread" Currently Does

**File**: `src/entities/tasks/mark-unread-service.ts`

```typescript
export async function markTaskUnread(taskId: string): Promise<void> {
  // 1. Calculate new sort order (higher = lower priority)
  const newSortOrder = maxSortOrder + 1000;

  // 2. Update ONLY the sortOrder field
  await taskService.update(taskId, {
    sortOrder: newSortOrder,
    // DO NOT update status or pendingReviews - keep task unread
  });

  // 3. Emit TASK_MARKED_UNREAD event
  eventBus.emit(EventName.TASK_MARKED_UNREAD, { taskId });
}
```

**What it actually does**:
- ✅ Updates task metadata on disk (changes `sortOrder`)
- ✅ Emits event for cross-window notification
- ❌ **Does NOT mark any threads as unread**
- ❌ **Does NOT affect blue dot visibility**

### What the Blue Dot Indicator Actually Shows

**File**: `src/utils/task-colors.ts:22-46`

```typescript
export function getTaskDotColor(task: TaskMetadata, threads: ThreadMetadata[]): TaskDotColor {
  const taskThreads = threads.filter((t) => t.taskId === task.id);

  // Priority order:
  // 1. Running threads = green pulsing dot
  if (taskThreads.some((t) => t.status === "running")) {
    return { color: "bg-green-400", animation: "animate-pulse" };
  }

  // 2. Unread threads = blue solid dot
  if (taskThreads.some((t) => !t.isRead)) {
    return { color: "bg-blue-500" };
  }

  // 3. All threads read = grey dot
  return { color: "bg-zinc-400" };
}
```

**The blue dot appears when**: `taskThreads.some((t) => !t.isRead)`
**The blue dot is controlled by**: Thread `isRead` field, NOT task status or sort order

---

## The Disconnection

| User Action | What Happens | What Should Happen |
|-------------|--------------|-------------------|
| Click "Mark unread" | Task `sortOrder` changes | Task `sortOrder` changes AND task threads marked as `isRead: false` |
| Expected Result | Blue dot appears | Blue dot appears |
| Actual Result | **No blue dot** (threads still `isRead: true`) | Blue dot appears |

### Why This Happens

1. **"Mark unread" only affects task metadata**: Changes `sortOrder` field in task's `metadata.json`
2. **Blue dot only cares about thread metadata**: Checks `isRead` field in each thread's `metadata.json`
3. **No connection between the two**: `markTaskUnread()` never calls `markThreadAsUnread()`

---

## Thread Read Status Management

### When Threads Are Marked as Unread

**File**: `src/entities/threads/listeners.ts`

Threads are automatically marked as unread in these scenarios:
1. **When thread starts running** (line 34): `markThreadAsUnread(threadId)`
2. **When agent completes** (line 62): `markThreadAsUnread(threadId)`

### When Threads Are Marked as Read

**File**: `src/hooks/use-mark-thread-as-read.ts`

Threads are marked as read:
1. **When user views the thread** (automatic via hook)
2. **Manual calls to** `useThreadStore.getState().markThreadAsRead(threadId)`

### Thread Read Status Persistence

**File**: `src/entities/threads/store.ts:146-173`

```typescript
markThreadAsRead: (threadId) => {
  // 1. Update in-memory state
  set((state) => ({
    threads: { ...state.threads, [threadId]: { ...thread, isRead: true } }
  }));

  // 2. Emit cross-window event
  eventBus.emit(EventName.THREAD_UPDATED, { threadId, taskId: thread.taskId });

  // 3. Persist to disk asynchronously
  setTimeout(async () => {
    await threadService.update(threadId, { isRead: true });
  }, 0);
}
```

**Persistence**: ✅ Thread `isRead` status IS properly saved to disk
**Cross-window sync**: ✅ Other windows are properly notified via events

---

## Data Flow Analysis

### Current Flow (Broken)

```
User clicks "Mark unread"
    ↓
simple-task-window.tsx:261 → markTaskUnread(taskId)
    ↓
mark-unread-service.ts:30 → taskService.update(taskId, { sortOrder })
    ↓
Task metadata.json updated on disk ✅
    ↓
TASK_MARKED_UNREAD event emitted ✅
    ↓
Task listeners refresh task from disk ✅
    ↓
UI re-renders with updated task
    ↓
getTaskDotColor() called with (task, allThreads)
    ↓
Checks threads: taskThreads.some((t) => !t.isRead)
    ↓
❌ THREADS STILL MARKED AS READ (isRead: true)
    ↓
❌ Returns grey dot instead of blue dot
```

### Expected Flow (What Should Happen)

```
User clicks "Mark unread"
    ↓
markTaskUnread(taskId) should:
  ├─ Update task sortOrder ✅
  └─ Mark all task threads as unread ❌ MISSING
    ↓
Both task AND thread metadata updated on disk
    ↓
Events emitted for both task and threads
    ↓
UI re-renders
    ↓
getTaskDotColor() finds threads with isRead: false
    ↓
✅ Returns blue dot
```

---

## Missing Logic

The `markTaskUnread` function is missing this critical step:

```typescript
// MISSING: Mark all task threads as unread
const taskThreads = threadService.getByTask(taskId);
for (const thread of taskThreads) {
  useThreadStore.getState().markThreadAsUnread(thread.id);
}
```

---

## Files Involved in Fix

### Primary Files to Modify
1. **`src/entities/tasks/mark-unread-service.ts`**: Add thread marking logic
2. **`src/entities/threads/service.ts`**: May need `getByTask()` method if not present

### Files That Should Work Correctly (Don't Touch)
1. **`src/entities/threads/store.ts`**: `markThreadAsUnread()` already works ✅
2. **`src/utils/task-colors.ts`**: `getTaskDotColor()` logic is correct ✅
3. **`src/components/tasks/task-card.tsx`**: Properly calls `getTaskDotColor()` ✅
4. **`src/components/tasks/task-row.tsx`**: Properly calls `getTaskDotColor()` ✅

### Event System Status
- **Task events**: Working correctly ✅
- **Thread events**: Working correctly ✅
- **Cross-window sync**: Working correctly ✅

---

## Solution Summary

**The fix requires ONE change**: When `markTaskUnread()` is called, it must also mark all threads belonging to that task as unread.

**Impact**:
- ✅ Task sort order will still be updated (existing behavior preserved)
- ✅ Thread `isRead` flags will be set to `false` (new behavior)
- ✅ Blue dot will appear immediately (user expectation met)
- ✅ All persistence and cross-window sync will work automatically

**Complexity**: Low - leverages existing, working thread marking infrastructure

---

## Alternative Approaches Considered

### Option 1: Change Blue Dot Logic (NOT RECOMMENDED)
Make blue dot show based on task status instead of thread status.

**Problems**:
- Breaks consistency with other thread-based indicators
- Thread read status becomes meaningless
- Running/completed thread states would be lost

### Option 2: Separate Task and Thread Unread Status (COMPLEX)
Maintain both task-level and thread-level unread flags.

**Problems**:
- Increases complexity significantly
- Potential for inconsistent states
- User confusion about which "unread" they're seeing

### Option 3: Fix markTaskUnread() (RECOMMENDED)
Update `markTaskUnread()` to also mark threads as unread.

**Benefits**:
- ✅ Simple, targeted fix
- ✅ Leverages existing working infrastructure
- ✅ Maintains consistency in blue dot logic
- ✅ User expectations are met immediately

---

## Verification Steps

After implementing the fix, verify:

1. **Blue dot appears**: Click "Mark unread" → blue dot shows immediately
2. **Persistence works**: Close/reopen app → blue dot still visible
3. **Cross-window sync**: Mark unread in one window → blue dot appears in other windows
4. **Reading works**: View thread → blue dot disappears appropriately
5. **Running threads**: Start agent → green pulsing dot takes priority
6. **Sort order**: Task moves to bottom of list (existing behavior preserved)

---

## Implementation Priority

**Priority**: High
**Risk**: Low (targeted fix using existing, tested infrastructure)
**User Impact**: High (core workflow currently broken)