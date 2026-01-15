# TaskBoard Reactivity Implementation Plan

## Focus: Main Task Window Event Subscriptions

The main task board window requires manual refresh to show task changes. This plan focuses specifically on implementing reactive event subscriptions for task created, deleted, and thread read/unread status changes in the TaskBoard view.

## IMPORTANT NOTE

Ensure when setting up subscriptions we don't create any echoing events.

## Current State Analysis

### TaskBoardPage Status

**File**: `/components/tasks/task-board-page.tsx`

- ❌ **No event subscriptions** - relies entirely on manual refresh button
- ✅ **Store integration** - reads from `useTaskBoard` hook → `useTaskStore.tasks`
- ✅ **Underlying reactivity** - entity listeners automatically update stores

### Key Missing Events

1. **Task Lifecycle**: `task:created`, `task:deleted`, `task:updated`
2. **Thread Status**: `thread:created`, `thread:updated`, `thread:status-changed`
3. **Read/Unread State**: Thread read status changes

### Store Infrastructure (Already Working)

- ✅ Entity listeners in `/entities/tasks/listeners.ts` and `/entities/threads/listeners.ts`
- ✅ Event bridge for cross-window communication
- ✅ Zustand store subscriptions for automatic re-renders

## Implementation Plan

### Step 1: TaskBoardPage Event Subscriptions

**File**: `/components/tasks/task-board-page.tsx`
**Priority**: Critical - This is the main task view requiring reactivity

**Current Issue**: Manual refresh button required for all updates

**Implementation**:

```typescript
import { eventBus } from "../lib/event-bus";
import { useEffect, useCallback } from "react";

// Add event listeners for automatic updates
useEffect(() => {
  // Handle task lifecycle events
  const handleTaskEvent = useCallback((data: { taskId: string }) => {
    // Store will automatically update via entity listeners
    // Optional: Add visual feedback (toast, animation)
    console.log("Task updated:", data.taskId);
  }, []);

  // Handle thread events that affect task status
  const handleThreadEvent = useCallback(
    (data: { threadId: string; taskId?: string }) => {
      // Thread changes can affect task read/unread status
      // Store will automatically update, UI will re-render
    },
    []
  );

  // Subscribe to events
  eventBus.on("task:created", handleTaskEvent);
  eventBus.on("task:updated", handleTaskEvent);
  eventBus.on("task:deleted", handleTaskEvent);
  eventBus.on("thread:created", handleThreadEvent);
  eventBus.on("thread:updated", handleThreadEvent);
  eventBus.on("thread:status-changed", handleThreadEvent);

  // Cleanup
  return () => {
    eventBus.off("task:created", handleTaskEvent);
    eventBus.off("task:updated", handleTaskEvent);
    eventBus.off("task:deleted", handleTaskEvent);
    eventBus.off("thread:created", handleThreadEvent);
    eventBus.off("thread:updated", handleThreadEvent);
    eventBus.off("thread:status-changed", handleThreadEvent);
  };
}, []);

// Remove manual refresh button entirely (or keep as fallback)
```

### Step 2: Thread Read/Unread Status Reactivity

**Priority**: High - Critical for showing accurate thread status

**Investigation Needed**:

1. How is read/unread status currently tracked in stores?
2. What events trigger read/unread status changes?
3. Does the TaskBoard UI show read/unread indicators?

**Implementation**:

- Identify the specific events that change read/unread status
- Ensure TaskBoard subscribes to these events
- Update UI indicators (badges, colors) when status changes

### Step 3: Remove Manual Refresh Dependency

**Goal**: Make manual refresh button optional, not required

**Approach**:

- Test that store subscriptions work correctly
- Verify event listeners trigger store updates
- Remove manual refresh or keep as backup/force-refresh option

### Step 4: Cross-Window Synchronization Testing

**Validation**: Ensure changes in one window appear immediately in others

**Test Cases**:

1. Create task in Window A → appears in Window B
2. Delete task in Window A → removed from Window B
3. Update thread in Window A → status updates in Window B
4. Mark thread read/unread → badge updates across windows

## Event Flow Verification

### Current Events (Already Working)

```typescript
// These are handled by entity listeners and update stores automatically
'task:created'     → Updates task store
'task:updated'     → Refreshes specific task
'task:deleted'     → Removes from store
'task:status-changed' → Updates task status
'thread:created'   → Adds to thread store
'thread:updated'   → Refreshes specific thread
'thread:status-changed' → Updates thread status
```

### Missing UI Connection

The stores update automatically, but TaskBoard components don't know to refresh their visual indicators. Adding event listeners creates the connection between store updates and UI feedback.

## Success Criteria

### Phase 1 (Core Fix)

- [ ] TaskBoardPage shows new tasks without manual refresh
- [ ] Task deletions remove items from view immediately
- [ ] Thread status changes update task indicators
- [ ] Cross-window synchronization works reliably

### Phase 2 (Polish)

- [ ] Visual feedback for updates (subtle animations/notifications)
- [ ] Manual refresh button becomes truly optional
- [ ] Performance remains smooth with many tasks/threads

## Implementation Notes

### Why This Approach Works

1. **Store infrastructure exists**: Entity listeners already handle events
2. **Store subscriptions work**: Components already re-render on store changes
3. **Missing link**: Components need to know _when_ to check for updates
4. **Simple solution**: Add event listeners for awareness, not data manipulation

### Risk Mitigation

- Keep manual refresh as fallback during transition
- Test thoroughly with multiple windows
- Monitor performance with many event listeners
- Use `useCallback` to prevent unnecessary re-renders

## Next Steps

1. Examine current TaskBoardPage implementation
2. Identify exactly which events affect task read/unread status
3. Implement event subscriptions
4. Test cross-window behavior
5. Remove manual refresh dependency
