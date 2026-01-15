# Next Task Navigation Consolidation Plan

## Overview

This plan consolidates the "go to next task" logic across three different actions that currently have similar but slightly different implementations:

1. **Mark as Unread** - After marking a task unread, navigate to next unread task
2. **Go to Next Task (Quick Action)** - During streaming, quickly jump to next task
3. **Archive Task** - After archiving, navigate to next unread task

## Current State Analysis

### Existing Implementation Locations

#### 1. Mark as Unread Navigation
- **File:** `src/components/simple-task/simple-task-window.tsx:261-267`
- **Logic:** Calls `navigateToNextUnread()`, falls back to `showTasksPanel()`
- **Service:** `src/entities/tasks/mark-unread-service.ts`

#### 2. Stream Quick Action Navigation
- **File:** `src/components/simple-task/suggested-actions-panel.tsx:192-201`
- **Logic:** Calls `navigateToNextUnread()`, no explicit fallback
- **Hook:** Uses `useNavigateToNextTask()` hook

#### 3. Archive Task Navigation
- **File:** `src/components/simple-task/simple-task-window.tsx:272-283`
- **Logic:** Uses `getNextUnreadTaskForAction()` callback, explicit fallback to `showTasksPanel()`
- **Service:** `src/entities/tasks/archive-service.ts`

### Core Navigation Infrastructure (Already Good)

#### Existing Hooks
- **`src/hooks/use-navigate-to-next-task.ts`**
  - `navigateToNextUnread()` - Main navigation wrapper
  - Returns boolean success indicator

- **`src/hooks/use-simple-task-navigation.ts`**
  - `getNextUnreadTaskId()` - Core algorithm for finding next task
  - `isTaskUnread()` - Consistent unread detection logic

#### Current Logic Flow
```
getNextUnreadTaskId(currentId)
  -> sortTasksByPriority()
  -> Find next unread task (not running)
  -> Return { taskId, threadId, wrapped }

navigateToNextUnread()
  -> getNextUnreadTaskId()
  -> openSimpleTask() if found
  -> Return success boolean
```

## Problem Areas

### 1. Inconsistent Fallback Behavior
- **Mark Unread & Archive:** Explicitly show tasks panel when no next task
- **Quick Action:** No fallback handling - just fails silently

### 2. Different API Patterns
- **Mark Unread & Quick Action:** Use `navigateToNextUnread()` hook
- **Archive:** Uses custom callback `getNextUnreadTaskForAction()`

### 3. Duplicate Logic
- Archive service duplicates the "get next task" logic instead of reusing hooks
- Each action handles fallback differently

## Consolidation Strategy

### 1. Create Unified Navigation Helper

**New File:** `src/hooks/use-navigate-to-next-task.ts` (extend existing)

```typescript
// Enhanced hook with consistent fallback behavior
export function useNavigateToNextTask(currentTaskId: string) {
  const navigateToNextUnread = useNavigateToNextUnread();
  const { showTasksPanel } = useTasksPanel();

  /**
   * Navigate to next unread task with consistent fallback behavior.
   * If no unread tasks available, navigates to tasks panel.
   *
   * @param options.fallbackToTasksPanel - Whether to show tasks panel if no next task (default: true)
   * @returns Promise<boolean> - true if navigated to next task, false if fell back to tasks panel
   */
  const navigateToNextTaskOrFallback = useCallback(async (options: { fallbackToTasksPanel?: boolean } = {}) => {
    const { fallbackToTasksPanel = true } = options;

    const success = await navigateToNextUnread();

    if (!success && fallbackToTasksPanel) {
      showTasksPanel();
      return false;
    }

    return success;
  }, [navigateToNextUnread, showTasksPanel]);

  return {
    navigateToNextUnread, // Keep existing for backward compatibility
    navigateToNextTaskOrFallback, // New unified method
  };
}
```

### 2. Update Each Action to Use Unified Helper

#### A. Mark as Unread Action
**File:** `src/components/simple-task/simple-task-window.tsx`

**Before (lines 261-267):**
```typescript
if (actionKey === 'markUnread') {
  await markTaskUnread(taskId);

  const navigated = await navigateToNextUnread();
  if (!navigated) {
    showTasksPanel();
  }
}
```

**After:**
```typescript
if (actionKey === 'markUnread') {
  await markTaskUnread(taskId);
  await navigateToNextTaskOrFallback();
}
```

#### B. Stream Quick Action
**File:** `src/components/simple-task/suggested-actions-panel.tsx`

**Before (lines 192-201):**
```typescript
const handleGoToNextTask = useCallback(async () => {
  await navigateToNextUnread();
}, [navigateToNextUnread]);
```

**After:**
```typescript
const handleGoToNextTask = useCallback(async () => {
  await navigateToNextTaskOrFallback();
}, [navigateToNextTaskOrFallback]);
```

#### C. Archive Task Action
**File:** `src/components/simple-task/simple-task-window.tsx`

**Before (lines 272-283):**
```typescript
if (actionKey === 'archive') {
  const nextTaskResult = await archiveTaskAndGetNext(taskId, getNextUnreadTaskForAction);

  if (nextTaskResult?.taskId) {
    await openSimpleTask(nextTaskResult.taskId, { threadId: nextTaskResult.threadId });
  } else {
    showTasksPanel();
  }
}
```

**After:**
```typescript
if (actionKey === 'archive') {
  await archiveTask(taskId); // Simplified archive service (see below)
  await navigateToNextTaskOrFallback();
}
```

### 3. Simplify Archive Service

**File:** `src/entities/tasks/archive-service.ts`

**Current:** Service handles both archiving AND navigation logic
**Proposed:** Service only handles archiving, navigation handled by unified helper

**Remove from archive service:**
- `getNextTaskIdFn` parameter
- Next task finding logic
- Return value with next task info

**New simplified signature:**
```typescript
export async function archiveTask(taskId: string): Promise<void> {
  // Cancel any running threads for this task
  const task = await taskService.get(taskId);
  if (task?.threads) {
    for (const thread of task.threads) {
      if (thread.status === 'running') {
        cancellationService.cancel(thread.id, 'user_archived_task');
      }
    }
  }

  // Delete the task
  await taskService.delete(taskId);

  // Emit archived event if needed
  eventEmitter.emit('TASK_ARCHIVED', { taskId });
}
```

## Implementation Steps

### Phase 1: Create Unified Helper
- [ ] Extend `src/hooks/use-navigate-to-next-task.ts` with `navigateToNextTaskOrFallback()`
- [ ] Add comprehensive JSDoc documentation
- [ ] Add unit tests for the new helper

### Phase 2: Update Mark Unread Action
- [ ] Update `src/components/simple-task/simple-task-window.tsx` mark unread handler
- [ ] Remove duplicate fallback logic
- [ ] Test mark unread → next task navigation

### Phase 3: Update Stream Quick Action
- [ ] Update `src/components/simple-task/suggested-actions-panel.tsx`
- [ ] Use new helper with fallback behavior
- [ ] Test quick action during streaming

### Phase 4: Simplify Archive Service
- [ ] Simplify `src/entities/tasks/archive-service.ts` to only handle archiving
- [ ] Update archive action handler in `simple-task-window.tsx`
- [ ] Remove `getNextUnreadTaskForAction` callback logic
- [ ] Test archive → next task navigation

### Phase 5: Cleanup & Testing
- [ ] Remove unused functions/callbacks
- [ ] Update any remaining references
- [ ] Add integration tests for all three navigation scenarios
- [ ] Verify consistent behavior across all actions

## Expected Benefits

### 1. Consistency
- All three actions will have identical navigation behavior
- Consistent fallback to tasks panel when no next task available
- Same error handling and edge case behavior

### 2. Maintainability
- Single source of truth for "go to next task" logic
- Changes to navigation behavior only need to be made in one place
- Easier to add new features (e.g., keyboard shortcuts, preferences)

### 3. Testability
- Centralized logic easier to unit test
- Integration tests can verify consistent behavior
- Reduced code duplication makes testing more reliable

### 4. User Experience
- Predictable navigation behavior across different actions
- Consistent fallback behavior improves user confidence
- Easier to document behavior for users

## Risk Assessment

### Low Risk
- Navigation hooks already well-established
- Changes are mostly refactoring existing working code
- Fallback behavior is simple and well-understood

### Mitigation
- Implement changes incrementally (one action at a time)
- Keep existing hook methods for backward compatibility
- Comprehensive testing before deploying
- Monitor for any regression issues

## Success Metrics

### Technical
- [ ] All three actions use the same navigation helper
- [ ] Zero code duplication in navigation logic
- [ ] Consistent API patterns across actions
- [ ] Comprehensive test coverage

### User Experience
- [ ] Identical navigation behavior for all three actions
- [ ] Consistent fallback to tasks panel
- [ ] No regression in existing functionality
- [ ] Smooth navigation experience maintained