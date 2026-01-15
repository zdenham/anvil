# Plan: Simplified Task Color Coding with Read/Unread States

## Overview

Simplify the task list color coding to three clear states that better reflect user interaction needs:

1. **Grey dot** - Read/Complete tasks (all threads opened and task complete)
2. **Flashing green dot** - Running tasks (thread actively executing)
3. **Blue dot** - Unread threads (task has new activity not yet viewed)

## Current State Analysis

### Existing Task Status System
- **7 statuses**: draft, backlog, todo, in-progress, in-review, done, cancelled
- **Status-only coloring**: Each status has a fixed color regardless of user interaction
- **Complex color scheme**: Multiple colors (zinc, amber, green, blue, emerald, red)

### New Thread Unread System
- **Clean foundation**: Simple thread-level read/unread tracking
- **User interaction tracking**: System knows when user has viewed thread output
- **Activity-based**: Focuses on whether user has seen the latest thread results

### Current Threading
- **Thread statuses**: idle, running, completed, error, paused, cancelled
- **Thread-task relationship**: Every thread belongs to a task (`threadId → taskId`)
- **Real-time status**: Threads update status as agents work

## Proposed Solution

### New Color Logic

Replace status-based coloring with interaction-based coloring:

```typescript
function getTaskDotColor(task: TaskMetadata, threads: ThreadMetadata[]): {
  color: string;
  animation?: string;
} {
  const taskThreads = threads.filter(t => t.taskId === task.id);

  // 1. Running - flashing green dot (duller green)
  const hasRunningThread = taskThreads.some(t => t.status === 'running');
  if (hasRunningThread) {
    return {
      color: "bg-green-400", // Duller than current bg-green-500
      animation: "animate-pulse"
    };
  }

  // 2. Unread threads - blue dot (has unread thread activity)
  const hasUnreadThreads = taskThreads.some(t => !t.isRead);

  if (hasUnreadThreads) {
    return { color: "bg-blue-500" };
  }

  // 3. Read/complete - grey dot (all threads read and viewed)
  return { color: "bg-zinc-400" };
}
```

### Thread-Based Read/Unread System

The unread state is derived from thread execution and user interaction:

#### Thread Unread Rules
1. **When thread completes execution** → Mark thread as unread
2. **When user opens/views thread output** → Mark thread as read
3. **Task unread status** → Task is unread if any of its threads are unread

#### Implementation Strategy
- **Thread-level tracking**: Add `isRead: boolean` to ThreadMetadata
- **Automatic unread marking**: Set `isRead = false` when thread completes (status becomes 'completed', 'error', etc.)
- **User interaction tracking**: Set `isRead = true` when user views thread output/details
- **Task-level derivation**: Task is unread if any of its threads are unread

```typescript
// Thread becomes unread when execution completes
function onThreadStatusChange(threadId: string, newStatus: ThreadStatus) {
  if (['completed', 'error', 'cancelled'].includes(newStatus)) {
    updateThread(threadId, { isRead: false });
  }
}

// Task unread count derived from threads
function getTaskUnreadCount(task: TaskMetadata, threads: ThreadMetadata[]): number {
  return threads.filter(t => t.taskId === task.id && !t.isRead).length;
}
```

## Implementation Plan

### Phase 1: Thread Read/Unread Tracking
**Files to modify:**
1. `src/types/thread.ts` - Add `isRead: boolean` to ThreadMetadata
2. `src/stores/thread-store.ts` - Add thread read state management
3. `src/hooks/use-task-threads.ts` - Include read state in thread queries

**Changes:**
- Extend ThreadMetadata with `isRead` property (defaults to `true`)
- Add thread read state persistence and updates
- Implement automatic unread marking when threads start running

### Phase 2: Thread Status Event Handling
**Files to modify:**
1. `src/stores/thread-store.ts` - Add status change listener
2. `src/components/workspace/` - Add thread view tracking

**Changes:**
- Hook into thread status changes to set `isRead = false` when status becomes 'running'
- Track when user views thread output/details to set `isRead = true`
- Ensure thread read state updates are persisted

### Phase 3: Color Logic Update
**Files to modify:**
1. `src/components/tasks-panel/tasks-panel.tsx` - Update StatusDot component (lines 201-217)
2. `src/components/tasks/task-card.tsx` - Update STATUS_CONFIG (lines 10-18)
3. `src/components/tasks/task-row.tsx` - Update STATUS_DOT_COLORS (lines 7-15)

**Changes:**
- Replace status-based color mapping with thread-aware interaction logic
- Implement unread thread checking as the primary attention indicator
- Filter threads by task ID for accurate unread counts

### Phase 4: Thread Integration Enhancement
**Files to modify:**
1. `src/hooks/use-task-threads.ts` - Enhance to provide unread counts per task
2. `src/components/tasks-panel/tasks-panel.tsx` - Use thread unread state

**Changes:**
- Add helper functions for task unread thread counts
- Ensure components have access to all thread read states
- Add real-time updates when thread read status changes

### Phase 5: Animation Implementation
**Files to modify:**
1. Add CSS for duller green pulsing animation
2. Update StatusDot component to handle animation classes

**Changes:**
- Implement smooth pulse animation for running state
- Ensure animation respects user motion preferences

## Technical Details

### Color Specifications
- **Running**: `bg-green-400` with `animate-pulse` (duller than current green)
- **Needs attention**: `bg-blue-500` (current blue)
- **Read/complete**: `bg-zinc-400` (muted grey)

### State Determination Logic
```typescript
// Get threads for this specific task
const taskThreads = threads.filter(t => t.taskId === task.id);

// Running: Any thread with status 'running'
const isRunning = taskThreads.some(t => t.status === 'running');

// Unread threads: Any thread marked as unread
const hasUnreadThreads = taskThreads.some(t => !t.isRead);

// Read/complete: All threads read and no threads running
const isReadComplete = !isRunning && !hasUnreadThreads;
```

### Thread Read State Management
```typescript
// ThreadMetadata extension
interface ThreadMetadata {
  id: string;
  taskId: string;
  status: ThreadStatus;
  isRead: boolean; // New property - defaults to true for new threads
  // ... existing properties
}

// Auto-mark unread when thread completes
function onThreadStatusUpdate(threadId: string, newStatus: ThreadStatus) {
  if (['completed', 'error', 'cancelled'].includes(newStatus)) {
    updateThreadReadState(threadId, false);
  }
}

// Mark read when user views thread
function markThreadAsRead(threadId: string) {
  updateThreadReadState(threadId, true);
}

// Task unread count helper
function getTaskUnreadCount(taskId: string, threads: ThreadMetadata[]): number {
  return threads.filter(t => t.taskId === taskId && !t.isRead).length;
}
```

### Animation Requirements
- **Pulse animation**: Smooth, not distracting
- **Performance**: Use CSS animations, not JavaScript
- **Accessibility**: Respect user's motion preferences

## Migration Strategy

1. **Backward compatibility**: Keep existing status display in tooltips/details
2. **Gradual rollout**: Update tasks panel first, then other components
3. **User feedback**: Monitor usage patterns to validate simplification
4. **Documentation**: Update any user-facing docs about task states

## Benefits

1. **Simplified mental model**: 3 states vs 7 statuses
2. **Activity-oriented**: Colors indicate thread activity and user interaction
3. **Better attention management**: Clear visual hierarchy for new content
4. **Clean architecture**: Simple thread-based unread system
5. **Real-time updates**: Running and unread states reflect actual thread activity

## Risks and Mitigations

1. **Lost status information**: Mitigate with tooltips showing full status
2. **User confusion during transition**: Provide clear communication about changes
3. **Edge cases**: Thoroughly test with various task/thread combinations
4. **Performance**: Ensure thread status checking doesn't impact UI responsiveness

## Success Criteria

1. **Visual clarity**: Users can quickly identify tasks with unread thread activity
2. **Performance**: No noticeable lag in task list updates
3. **Consistency**: All task display components use unified thread-based color logic
4. **User satisfaction**: Positive feedback on simplified, activity-focused interface