# Event Broadcasting Audit & Plan for Task Deletion and Mark Unread

## Executive Summary

After conducting a comprehensive audit of the event broadcasting system for task deletion and mark unread functionality, I identified several critical gaps in cross-window communication. While the event infrastructure is well-designed, the implementation has missing event emissions that prevent proper synchronization across windows.

## Current State Analysis

### ✅ What's Working Well

**Event Broadcasting Infrastructure:**
- Robust hybrid event system combining Tauri IPC + mitt EventBus
- Proper echo prevention with `_source` field
- Comprehensive event listeners setup in `setupTaskListeners()` and `setupThreadListeners()`
- Well-defined event types in `core/types/events.ts`

**Task Deletion Listener:**
- `TASK_DELETED` event listener properly implemented in `src/entities/tasks/listeners.ts:34`
- Correctly calls `useTaskStore.getState()._applyDelete(taskId)` on event

**Mark Unread Infrastructure:**
- `markThreadAsUnread()` properly emits `THREAD_UPDATED` events (line 191 in thread store)
- Thread event listeners handle status changes correctly

### ❌ Critical Gaps Identified

**1. Task Deletion Event Not Emitted**
```typescript
// src/entities/tasks/service.ts:435 - delete() method
async delete(id: string): Promise<void> {
  // ... deletion logic ...
  // ❌ MISSING: eventBus.emit(EventName.TASK_DELETED, { taskId: id });
}
```

**2. Task Mark Unread Has No Direct Event**
```typescript
// src/entities/tasks/mark-unread-service.ts:12
export async function markTaskUnread(taskId: string): Promise<void> {
  await taskService.update(taskId, { sortOrder: newSortOrder });
  // ❌ MISSING: Event emission for task unread action
}
```

**3. Agent-Initiated Events Only Available**
- Events only emitted from agent CLI (`agents/src/lib/events.ts`)
- Frontend service methods don't emit events to other windows

## Impact Assessment

### Components Affected by Missing Events

**Task Deletion:**
- `TasksPanel` - Won't remove deleted tasks until manual refresh
- `TaskBoardPage` - Won't update task counts or remove tasks from Kanban/List view
- `TaskCard`/`TaskRow` - Will show stale deleted tasks
- `SimpleTaskWindow` - May try to load deleted tasks
- `Spotlight` - May reference deleted tasks in search

**Mark Unread:**
- `TasksPanel` - Won't update status dots or unread counts
- `TaskCard`/`TaskRow` - Won't refresh visual indicators
- `StatusDot` components - Will show stale read/unread state

### Cross-Window Scenarios

1. **Task Panel + Simple Task Window:** Delete task in Simple Task window → Task Panel still shows it
2. **Multiple Task Board Windows:** Delete task in one → Others don't update
3. **Task Panel + Main Window:** Mark unread in panel → Main window doesn't refresh indicators

## Comprehensive Solution Plan

### Phase 1: Fix Task Deletion Event Broadcasting

**1.1 Add Event Emission to Task Service Delete Method**

```typescript
// src/entities/tasks/service.ts:435
async delete(id: string): Promise<void> {
  // ... existing deletion logic ...

  // After successful deletion, emit event for cross-window sync
  eventBus.emit(EventName.TASK_DELETED, { taskId: id });
}
```

**1.2 Add Event Emission to Archive Service**

```typescript
// src/entities/tasks/archive-service.ts
export async function archiveTaskAndGetNext(taskId: string, getNextTaskIdFn) {
  // ... get next task ...
  await taskService.delete(taskId); // This will now emit TASK_DELETED
  // ... return navigation info ...
}
```

**1.3 Test Cross-Window Deletion**
- Open TasksPanel and TaskBoardPage simultaneously
- Delete task in TasksPanel → Verify TaskBoardPage updates
- Delete task in Simple Task window → Verify TasksPanel updates

### Phase 2: Enhance Mark Unread Event Broadcasting

**2.1 Add Specific Task Unread Event Type**

```typescript
// core/types/events.ts - Add new event type
export const EventName = {
  // ... existing events ...
  TASK_MARKED_UNREAD: "task:marked-unread",
} as const;

// Add to EventPayloads type
export interface EventPayloads {
  // ... existing payloads ...
  [EventName.TASK_MARKED_UNREAD]: { taskId: string };
}
```

**2.2 Emit Event from Mark Unread Service**

```typescript
// src/entities/tasks/mark-unread-service.ts:12
export async function markTaskUnread(taskId: string): Promise<void> {
  // ... existing logic ...
  await taskService.update(taskId, { sortOrder: newSortOrder });

  // Emit event for cross-window notification
  eventBus.emit(EventName.TASK_MARKED_UNREAD, { taskId });
}
```

**2.3 Add Listener for Task Unread Events**

```typescript
// src/entities/tasks/listeners.ts - Add new listener
eventBus.on(EventName.TASK_MARKED_UNREAD, async ({ taskId }) => {
  logger.log(`[TaskListener] TASK_MARKED_UNREAD event received for ${taskId}`);
  try {
    // Refresh task to get updated sortOrder and trigger UI updates
    await taskService.refreshTask(taskId);
    logger.log(`[TaskListener] Successfully refreshed unread task ${taskId}`);
  } catch (e) {
    logger.error(`[TaskListener] Failed to refresh unread task ${taskId}:`, e);
  }
});
```

### Phase 3: Thread Read State Event Improvements

**3.1 Verify Thread Event Emissions**
The thread store already properly emits `THREAD_UPDATED` events when marking threads as read/unread. Verify this works correctly across windows.

**3.2 Enhance Thread Event Handling**
```typescript
// src/entities/threads/listeners.ts - Ensure robust thread updates
eventBus.on(EventName.THREAD_UPDATED, async ({ threadId, taskId }) => {
  // Refresh specific thread instead of full task refresh
  await threadService.refreshThread(threadId);

  // Trigger task UI refresh for status dot updates
  const task = useTaskStore.getState().tasks[taskId];
  if (task) {
    // Force re-render of task components by emitting task updated
    eventBus.emit(EventName.TASK_UPDATED, { taskId });
  }
});
```

### Phase 4: Verification & Testing

**4.1 Cross-Window Test Scenarios**

| Action | Window A | Window B | Expected Behavior |
|--------|----------|----------|-------------------|
| Delete Task | TasksPanel | TaskBoardPage | Task disappears from board immediately |
| Delete Task | SimpleTaskWindow | TasksPanel | Task disappears from panel immediately |
| Mark Task Unread | SimpleTaskWindow | TasksPanel | Status dot updates to show unread |
| Mark Thread Read | SimpleTaskWindow | TasksPanel | Unread count decreases |
| Archive Task | SuggestedActionsPanel | TaskBoardPage | Task moves to done column |

**4.2 Component Update Verification**

For each component, verify it properly updates when receiving events:
- StatusDot components refresh unread counts
- TaskCard/TaskRow components update visual indicators
- Task lists remove deleted tasks
- Kanban columns update task counts
- Navigation respects updated sort orders

**4.3 Event Flow Testing**

```typescript
// Test event emission timing
console.time('task-delete-event');
await taskService.delete(taskId);
// Should see TASK_DELETED event emitted within 100ms
console.timeEnd('task-delete-event');

// Test cross-window propagation
window.eventBus.on(EventName.TASK_DELETED, ({ taskId }) => {
  console.log('Received TASK_DELETED in window B:', taskId);
});
```

### Phase 5: Performance & Edge Case Handling

**5.1 Debounce Rapid Events**
```typescript
// Prevent event spam from rapid mark unread actions
const markUnreadDebounced = debounce(markTaskUnread, 300);
```

**5.2 Handle Stale Event Scenarios**
```typescript
// In task listeners, handle cases where task doesn't exist
eventBus.on(EventName.TASK_DELETED, async ({ taskId }) => {
  const exists = useTaskStore.getState().tasks[taskId];
  if (!exists) {
    logger.debug(`Received TASK_DELETED for non-existent task: ${taskId}`);
    return; // Already deleted, ignore
  }
  useTaskStore.getState()._applyDelete(taskId);
});
```

**5.3 Event Source Tracking**
```typescript
// Add source tracking to prevent infinite loops
eventBus.emit(EventName.TASK_DELETED, {
  taskId,
  _source: window.location.hash // Identify source window
});
```

## Implementation Priority

### 🔥 High Priority (Immediate)
1. **Fix task deletion event emission** - Critical for cross-window consistency
2. **Add task mark unread events** - Essential for status synchronization

### 🟡 Medium Priority (Next Sprint)
3. **Enhanced thread event handling** - Improves responsiveness
4. **Cross-window testing suite** - Prevents regressions

### 🟢 Low Priority (Future)
5. **Event debouncing and optimization** - Performance improvements
6. **Advanced edge case handling** - Robustness enhancements

## Detailed Component Analysis

Based on the audit, here are all 18 task-displaying components that should react to these events:

### Primary Task Display Components

1. **TasksPanel** (`/src/components/tasks-panel/tasks-panel.tsx`)
   - Shows task title, repository, status dot with unread count
   - Currently subscribes to task store but needs live event updates
   - **Gap:** Won't remove deleted tasks until panel refresh

2. **TaskBoardPage** (`/src/components/tasks/task-board-page.tsx`)
   - Main task board with Kanban/List views, already has some event subscriptions
   - **Gap:** Delete events not properly handled for cross-window sync

3. **KanbanBoard + KanbanColumn** (`/src/components/tasks/kanban-*.tsx`)
   - Drag-and-drop task management
   - **Gap:** Stale tasks remain visible after deletion in other windows

4. **TaskListView + TaskCard + TaskRow** (`/src/components/tasks/task-*.tsx`)
   - List view with individual task items
   - **Gap:** Status indicators won't update for mark unread actions

### Simple Task Components

5. **SimpleTaskWindow** (`/src/components/simple-task/simple-task-window.tsx`)
   - Individual task editor that calls deletion
   - **Action:** Needs to emit deletion events after successful delete

6. **SimpleTaskHeader** (`/src/components/simple-task/simple-task-header.tsx`)
   - Header with delete button and status indicators
   - **Gap:** Delete button calls service but doesn't notify other windows

7. **SuggestedActionsPanel** (`/src/components/simple-task/suggested-actions-panel.tsx`)
   - Quick actions including "Mark unread"
   - **Action:** Needs to emit unread events after action

### Main Window Components

8. **TasksPage** (`/src/components/main-window/tasks-page.tsx`)
   - Page wrapper that needs to respond to task changes
   - **Gap:** Won't update when tasks deleted in other windows

9. **MainWindowLayout** (`/src/components/main-window/main-window-layout.tsx`)
   - Root layout that may cache task-related state
   - **Gap:** Potential stale navigation state

### Workspace Components

10. **TaskWorkspace** (`/src/components/workspace/task-workspace.tsx`)
    - Full workspace for complex tasks
    - **Gap:** May show deleted tasks until refresh

11. **LeftMenu + ThreadsList** (`/src/components/workspace/left-menu.tsx`, `threads-list.tsx`)
    - Navigation showing task threads
    - **Gap:** Thread status indicators won't update for mark unread

### Thread/Message Display

12. **ThreadView + MessageList** (`/src/components/thread/thread-*.tsx`)
    - Conversation display that needs read/unread status
    - **Gap:** Read status changes won't propagate to other windows

### Global Components

13. **Spotlight** (`/src/components/spotlight/spotlight.tsx`)
    - Global search that may reference tasks
    - **Gap:** May show deleted tasks in search results

### Status Display Components

14. **StatusDot** (in various task components)
    - Visual status indicators throughout the app
    - **Gap:** Won't update unread counts when thread status changes

## Event Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Event Flow Architecture                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Window A (Task Panel)          Window B (Simple Task)          │
│  ┌──────────────────┐          ┌──────────────────┐             │
│  │  setupOutgoing   │          │  setupOutgoing   │             │
│  │  setupIncoming   │          │  setupIncoming   │             │
│  └────────┬─────────┘          └────────┬─────────┘             │
│           │                             │                        │
│           └──────────────┬──────────────┘                        │
│                          │                                       │
│                    ┌─────▼──────┐                               │
│                    │   Tauri    │                               │
│                    │   Events   │                               │
│                    │  (app:*)   │                               │
│                    └────────────┘                               │
│                          │                                       │
│           ┌──────────────┴──────────────┐                       │
│           │                             │                        │
│  ┌────────▼────────┐          ┌────────▼────────┐              │
│  │  mitt eventBus  │          │  mitt eventBus  │              │
│  │  (setupIncoming)│          │  (setupIncoming)│              │
│  └────────┬────────┘          └────────┬────────┘              │
│           │                             │                        │
│  ┌────────▼──────────────────────────────────┐                 │
│  │  Entity Listeners                          │                 │
│  │  - setupTaskListeners()                    │                 │
│  │  - setupThreadListeners()                  │                 │
│  │  - setupRepositoryListeners()              │                 │
│  │  - setupPermissionListeners()              │                 │
│  └────────┬──────────────────────────────────┘                 │
│           │                                                     │
│  ┌────────▼──────────────────────────────────┐                 │
│  │  Store Updates (Zustand)                   │                 │
│  │  - useTaskStore._applyDelete()             │                 │
│  │  - useThreadStore.markThreadAsUnread()     │                 │
│  │  - useTaskStore._applyUpdate()             │                 │
│  └────────┬──────────────────────────────────┘                 │
│           │                                                     │
│  ┌────────▼──────────────────────────────────┐                 │
│  │  UI Re-render                              │                 │
│  │  - Components subscribed to stores update  │                 │
│  └────────────────────────────────────────────┘                 │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Conclusion

The event broadcasting infrastructure is solid, but critical event emissions are missing from the frontend service methods. Implementing the task deletion and mark unread event emissions will ensure proper cross-window synchronization and provide a seamless user experience across all task management interfaces.

The proposed solution maintains the existing architecture while filling the identified gaps, ensuring that all 18 task-displaying components stay synchronized regardless of which window initiates the action.

**Next Steps:**
1. Implement Phase 1 (task deletion events) immediately
2. Add Phase 2 (mark unread events) in same PR
3. Test cross-window scenarios thoroughly
4. Deploy with monitoring for event propagation issues

This plan addresses the specific audit request while leveraging the well-designed existing event infrastructure.