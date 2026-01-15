# Task Navigation Hotkeys

## Overview

Implement keyboard shortcuts to quickly navigate between simple tasks while in the simple task viewer window. Tasks should be navigated in priority order (by `sortOrder`), with Shift+Up taking the user to the highest priority non-running task.

## Proposed Hotkeys

- **Shift + Right Arrow**: Go to next task
- **Shift + Left Arrow**: Go to previous task
- **Shift + Up Arrow**: Go to highest priority task that is UNREAD (needs attention)

## Navigation Order

Tasks are navigated by `sortOrder` (ascending), which represents priority:
- Lower `sortOrder` = higher priority (appears first)
- Tasks are filtered to `type === "simple"` only

## Implementation Plan

### 1. Create Shared Sorting Utility

**New file**: `src/entities/tasks/sort-tasks.ts`

Utility for sorting simple tasks by priority:

```typescript
import { TaskMetadata } from "./types";

/**
 * Sort simple tasks by sortOrder (ascending = higher priority first).
 */
export function sortTasksByPriority(tasks: TaskMetadata[]): TaskMetadata[] {
  return [...tasks]
    .filter(t => t.type === "simple")
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
```

### 2. Create Navigation Hook

**New file**: `src/hooks/use-simple-task-navigation.ts`

This hook will:
- Accept the current task ID
- Get all simple tasks from the store
- Sort them by priority
- Determine unread/needs-attention state (unaddressed reviews OR incomplete status)
- Provide navigation functions

```typescript
import { useMemo, useCallback } from "react";
import { useTaskStore } from "@/entities/tasks/store";
import { threadService } from "@/entities/threads/service";
import { sortTasksByPriority } from "@/entities/tasks/sort-tasks";

interface NavigationResult {
  taskId: string | null;
  threadId: string | null;
  wrapped: boolean;
}

export function useSimpleTaskNavigation(currentTaskId: string) {
  const tasks = useTaskStore((s) => s.tasks);

  // Get sorted simple tasks
  const sortedTasks = useMemo(() => {
    return sortTasksByPriority(Object.values(tasks));
  }, [tasks]);

  // Helper to get thread for a task
  const getThreadForTask = useCallback((taskId: string): string | null => {
    const taskThreads = threadService.getByTask(taskId);
    return taskThreads[0]?.id ?? null;
  }, []);

  // Check if a task needs attention (unread - has unaddressed reviews OR incomplete status)
  const isTaskUnread = useCallback((taskId: string): boolean => {
    const task = tasks[taskId];
    if (!task) return false;

    // Has unaddressed pending reviews
    const hasUnaddressedReviews = task.pendingReviews?.some(r => !r.isAddressed) ?? false;

    // Has incomplete status
    const isIncomplete = !['done', 'cancelled'].includes(task.status);

    return hasUnaddressedReviews || isIncomplete;
  }, [tasks]);

  const getNextTaskId = useCallback((currentId: string): NavigationResult => {
    const currentIndex = sortedTasks.findIndex(t => t.id === currentId);
    if (currentIndex === -1 || sortedTasks.length === 0) {
      return { taskId: null, threadId: null, wrapped: false };
    }

    const nextIndex = (currentIndex + 1) % sortedTasks.length;
    const task = sortedTasks[nextIndex];
    return {
      taskId: task?.id ?? null,
      threadId: getThreadForTask(task?.id ?? ""),
      wrapped: nextIndex === 0,
    };
  }, [sortedTasks, getThreadForTask]);

  const getPrevTaskId = useCallback((currentId: string): NavigationResult => {
    const currentIndex = sortedTasks.findIndex(t => t.id === currentId);
    if (currentIndex === -1 || sortedTasks.length === 0) {
      return { taskId: null, threadId: null, wrapped: false };
    }

    const prevIndex = currentIndex === 0 ? sortedTasks.length - 1 : currentIndex - 1;
    const task = sortedTasks[prevIndex];
    return {
      taskId: task?.id ?? null,
      threadId: getThreadForTask(task?.id ?? ""),
      wrapped: currentIndex === 0,
    };
  }, [sortedTasks, getThreadForTask]);

  // Get highest priority task that needs attention (unread)
  const getFirstUnreadTaskId = useCallback((): NavigationResult => {
    const firstUnread = sortedTasks.find(t => isTaskUnread(t.id));
    if (!firstUnread) {
      return { taskId: null, threadId: null, wrapped: false };
    }
    return {
      taskId: firstUnread.id,
      threadId: getThreadForTask(firstUnread.id),
      wrapped: false,
    };
  }, [sortedTasks, isTaskUnread, getThreadForTask]);

  return {
    getNextTaskId,
    getPrevTaskId,
    getFirstUnreadTaskId,
    sortedTasks,
    isTaskUnread,
  };
}
```

### 3. Create Keyboard Handler Hook

**New file**: `src/hooks/use-simple-task-keyboard.ts`

Handles keyboard events in the simple task window:

```typescript
import { useEffect } from "react";
import { useSimpleTaskNavigation } from "./use-simple-task-navigation";
import { openSimpleTask } from "@/lib/hotkey-service";

export function useSimpleTaskKeyboard(taskId: string) {
  const { getNextTaskId, getPrevTaskId, getFirstUnreadTaskId } =
    useSimpleTaskNavigation(taskId);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focused on input, textarea, or contentEditable
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (e.target.isContentEditable) return;
      }

      if (e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        const result = getNextTaskId(taskId);
        if (result.taskId && result.threadId) {
          openSimpleTask(result.threadId, result.taskId);
        }
      }

      if (e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        const result = getPrevTaskId(taskId);
        if (result.taskId && result.threadId) {
          openSimpleTask(result.threadId, result.taskId);
        }
      }

      if (e.shiftKey && e.key === "ArrowUp") {
        e.preventDefault();
        const result = getFirstUnreadTaskId();
        if (result.taskId && result.threadId && result.taskId !== taskId) {
          openSimpleTask(result.threadId, result.taskId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [taskId, getNextTaskId, getPrevTaskId, getFirstUnreadTaskId]);
}
```

### 4. Integrate with Simple Task Window

**Modify**: `src/components/simple-task/simple-task-window.tsx`

Add the keyboard hook to `SimpleTaskWindowContent`:

```typescript
import { useSimpleTaskKeyboard } from "@/hooks/use-simple-task-keyboard";

function SimpleTaskWindowContent({
  taskId,
  threadId,
  prompt,
}: SimpleTaskWindowContentProps) {
  // Enable keyboard navigation
  useSimpleTaskKeyboard(taskId);

  // ... rest of existing component
}
```

### 5. Add Task Sorting Controls to Tasks Panel (Optional Enhancement)

**Context**: The tasks panel should allow users to reorder tasks, which affects navigation priority.

This is already partially implemented via drag-and-drop in the kanban board. To ensure simple tasks can be prioritized:

1. Simple tasks should appear in their own section or be clearly marked
2. Drag-and-drop reordering updates `sortOrder`, which determines navigation priority
3. Lower `sortOrder` = higher priority = navigated to first with Shift+Up

**Note**: If a dedicated simple tasks panel doesn't exist, consider adding a filter or view mode.

## Files to Modify

| File | Change |
|------|--------|
| `src/entities/tasks/sort-tasks.ts` | **NEW** - Shared task sorting utility |
| `src/hooks/use-simple-task-navigation.ts` | **NEW** - Task ordering and navigation logic |
| `src/hooks/use-simple-task-keyboard.ts` | **NEW** - Keyboard event handling |
| `src/components/simple-task/simple-task-window.tsx` | Add keyboard hook |

## Behavior Decisions

- **Wrap around**: Yes - last task → first task, first task → last task (for left/right navigation)
- **Shift+Up behavior**: Jump to highest priority (lowest `sortOrder`) unread task
- **Unread detection**: A task is "unread" if it has unaddressed pending reviews OR incomplete status (following simplified-task-color-coding.md logic)
- **Task filtering**: Only simple tasks (`type === "simple"`) are included in navigation

## Edge Cases

1. **All tasks read**: Shift+Up does nothing (no valid target)
2. **Single task**: Left/right navigation wraps to same task (no-op)
3. **Current task is highest priority unread**: Shift+Up is a no-op
4. **No threads for task**: Navigation skips that task (or falls back to using taskId as threadId)
5. **Input focus**: Don't navigate when typing in inputs, textareas, or contentEditable elements

## Implementation Notes

- **Thread lookup**: The simple task window already uses `threadService` - reuse this for getting threads by task
- **Store access**: Both `useTaskStore` is already available in the simple task context (note: `useThreadStore` dependency removed since we're focusing on task state)
- **IPC navigation**: Use `openSimpleTask` from hotkey-service to navigate - this handles window focus and param passing
- **Unread logic**: Follows the exact same logic as simplified-task-color-coding.md to ensure consistency

## Alternatives Considered

- **Kanban order**: Original plan used kanban column order, but simple tasks don't fit cleanly into kanban workflow
- **Priority field**: Could add explicit `priority` field, but `sortOrder` already serves this purpose
- **Target non-running tasks**: Original plan targeted non-running tasks, but "unread" is more actionable - focuses on tasks that specifically need user attention rather than just tasks that aren't currently executing
