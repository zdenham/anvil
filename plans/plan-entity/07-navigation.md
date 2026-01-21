# 07 - Unified Navigation

**Dependencies:** 05-hydration
**Parallelizable with:** 06-ui

## Design Decisions

- **Navigation Pattern**: Use Tauri IPC (`openSimpleTask()`, `switchSimpleTaskClientSide()`) - NOT router.push()
- **Plan Tab Auto-Open**: When navigating to a task with unread plan (but thread is read), auto-open plan tab
- **Priority**: Always prioritize unread thread over unread plan for the same task
- **Unassociated Plans**: Plans not associated with any task have lowest priority (-1)

## Overview

Extend the existing task navigation to include unread plans, creating a unified "next item" navigation experience. Navigation in this app uses Tauri IPC commands, not client-side routing.

## Implementation Steps

### 1. Update useSimpleTaskNavigation Hook

**File:** `src/hooks/use-simple-task-navigation.ts`

Add plan awareness to the existing navigation hook:

```typescript
import { useCallback, useMemo } from "react";
import { useTaskStore } from "@/entities/tasks";
import { useThreadStore } from "@/entities/threads";
import { usePlanStore } from "@/entities/plans";

interface NavigableTask {
  taskId: string;
  priority: number;
  hasUnreadThread: boolean;
  hasUnreadPlan: boolean;
}

export function useSimpleTaskNavigation() {
  const tasks = useTaskStore((state) => state.getAll());
  const threads = useThreadStore((state) => state.getAll());
  const plans = usePlanStore((state) => state.getAll());

  /**
   * Check if a task has any unread threads
   */
  const isTaskUnread = useCallback(
    (taskId: string): boolean => {
      const taskThreads = threads.filter((t) => t.taskId === taskId);
      return taskThreads.some((t) => !t.isRead);
    },
    [threads]
  );

  /**
   * Check if a task has an unread plan
   */
  const hasUnreadPlan = useCallback(
    (taskId: string): boolean => {
      const taskThreads = threads.filter((t) => t.taskId === taskId);
      const task = tasks.find((t) => t.id === taskId);

      // Check thread-level plan associations
      for (const thread of taskThreads) {
        if (thread.planId) {
          const plan = plans.find((p) => p.id === thread.planId);
          if (plan && !plan.isRead) return true;
        }
      }

      // Check task-level plan association
      if (task?.planId) {
        const plan = plans.find((p) => p.id === task.planId);
        if (plan && !plan.isRead) return true;
      }

      return false;
    },
    [tasks, threads, plans]
  );

  /**
   * Get all navigable tasks with unread content (threads or plans)
   */
  const getNavigableTasks = useMemo((): NavigableTask[] => {
    const navigable: NavigableTask[] = [];

    for (const task of tasks) {
      const unreadThread = isTaskUnread(task.id);
      const unreadPlan = hasUnreadPlan(task.id);

      if (unreadThread || unreadPlan) {
        navigable.push({
          taskId: task.id,
          priority: task.priority ?? 0,
          hasUnreadThread: unreadThread,
          hasUnreadPlan: unreadPlan,
        });
      }
    }

    // Sort by priority (higher first)
    return navigable.sort((a, b) => b.priority - a.priority);
  }, [tasks, isTaskUnread, hasUnreadPlan]);

  /**
   * Get the next unread task ID
   * Returns task ID and whether to open plan tab
   */
  const getNextUnreadTaskId = useCallback(
    (
      currentTaskId?: string
    ): { taskId: string; openPlanTab: boolean } | null => {
      if (getNavigableTasks.length === 0) return null;

      // Find current index
      const currentIndex = currentTaskId
        ? getNavigableTasks.findIndex((t) => t.taskId === currentTaskId)
        : -1;

      // Get next task (or first if not found / at end)
      const nextIndex =
        currentIndex === -1 || currentIndex >= getNavigableTasks.length - 1
          ? 0
          : currentIndex + 1;

      const nextTask = getNavigableTasks[nextIndex];
      if (!nextTask) return null;

      // Determine whether to open plan tab:
      // - If thread is unread, open thread view (default)
      // - If thread is read but plan is unread, open plan view
      const openPlanTab = !nextTask.hasUnreadThread && nextTask.hasUnreadPlan;

      return {
        taskId: nextTask.taskId,
        openPlanTab,
      };
    },
    [getNavigableTasks]
  );

  /**
   * Check if there are any unread items
   */
  const hasUnreadItems = getNavigableTasks.length > 0;

  /**
   * Get count of unread items
   */
  const unreadCount = getNavigableTasks.length;

  return {
    getNavigableTasks,
    getNextUnreadTaskId,
    isTaskUnread,
    hasUnreadPlan,
    hasUnreadItems,
    unreadCount,
  };
}
```

### 2. Update useNavigateToNextTask Hook

**File:** `src/hooks/use-navigate-to-next-task.ts`

Update to handle plan tab opening:

```typescript
import { useCallback } from "react";
import { useSimpleTaskNavigation } from "./use-simple-task-navigation";

interface UseNavigateToNextTaskOptions {
  currentTaskId?: string;
  onNavigate?: (taskId: string, openPlanTab: boolean) => void;
}

export function useNavigateToNextTask(
  options: UseNavigateToNextTaskOptions = {}
) {
  const { currentTaskId, onNavigate } = options;
  const { getNextUnreadTaskId, hasUnreadItems, unreadCount } =
    useSimpleTaskNavigation();

  const navigateToNext = useCallback(async () => {
    const next = getNextUnreadTaskId(currentTaskId);
    if (!next) return null;

    // Use Tauri IPC for navigation (NOT router.push)
    // The openPlanTab flag should be passed to the window to set initial view
    if (onNavigate) {
      onNavigate(next.taskId, next.openPlanTab);
    } else {
      // Default navigation via Tauri
      const { invoke } = await import("@tauri-apps/api/core");

      // Switch to the task, optionally opening plan tab
      await invoke("switch_simple_task", {
        taskId: next.taskId,
        initialView: next.openPlanTab ? "plan" : "thread",
      });
    }

    return next;
  }, [currentTaskId, getNextUnreadTaskId, onNavigate]);

  return {
    navigateToNext,
    hasUnreadItems,
    unreadCount,
  };
}
```

### 3. Update Quick Actions Store

**File:** `src/stores/quick-actions-store.ts`

Update copy to be neutral:

```typescript
// Update the streamingActions or relevant action definitions
export const streamingActions: QuickAction[] = [
  {
    type: "nextTask", // Keep action type for backwards compatibility
    label: "Next unread", // Changed from "Go to next task"
    description: "Navigate to the next unread item",
    // ... other properties
  },
  // ... other actions
];

// Update any other references:
// "No unread tasks" → "All caught up"
// "X unread tasks" → "X unread"
```

### 4. Update SuggestedActionsPanel (if needed)

**File:** `src/components/simple-task/suggested-actions-panel.tsx`

The component should use the updated hook:

```typescript
import { useNavigateToNextTask } from "@/hooks/use-navigate-to-next-task";

export function SuggestedActionsPanel({ taskId }: { taskId?: string }) {
  const { navigateToNext, hasUnreadItems, unreadCount } = useNavigateToNextTask({
    currentTaskId: taskId,
  });

  const handleNavigateNext = useCallback(async () => {
    await navigateToNext();
  }, [navigateToNext]);

  return (
    <div>
      {hasUnreadItems && (
        <Button onClick={handleNavigateNext}>
          Next unread ({unreadCount})
        </Button>
      )}

      {!hasUnreadItems && (
        <span className="text-muted-foreground">All caught up</span>
      )}

      {/* Other suggested actions */}
    </div>
  );
}
```

### 5. Update SimpleTaskWindow to Accept Initial View

**File:** `src/components/simple-task/simple-task-window.tsx`

Accept initial view parameter from navigation:

```typescript
interface SimpleTaskWindowProps {
  taskId: string;
  threadId?: string;
  initialView?: SimpleTaskView; // New prop for navigation
}

export function SimpleTaskWindow({
  taskId,
  threadId,
  initialView = "thread",
}: SimpleTaskWindowProps) {
  const [activeView, setActiveView] = useState<SimpleTaskView>(initialView);

  // ... rest of component
}
```

### 6. Add Keyboard Shortcut (Optional Enhancement)

**File:** `src/components/simple-task/simple-task-window.tsx`

Add 'n' key shortcut within SimpleTaskWindow:

```typescript
import { useNavigateToNextTask } from "@/hooks/use-navigate-to-next-task";

export function SimpleTaskWindow({ taskId, threadId, initialView }: Props) {
  const { navigateToNext, hasUnreadItems } = useNavigateToNextTask({
    currentTaskId: taskId,
  });

  // Keyboard shortcut for 'n' key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "n" && hasUnreadItems) {
        e.preventDefault();
        navigateToNext();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigateToNext, hasUnreadItems]);

  // ... rest of component
}
```

## Plan Read Status Integration

The navigation automatically respects read status:
- Plans marked as read (via PlanTab viewing) are excluded from navigation
- When plan is marked read, `getNavigableTasks` updates reactively
- Navigation skips to next unread item
- Thread unread status takes priority over plan unread status

## Validation Criteria

- [ ] `useSimpleTaskNavigation` returns tasks with unread threads OR unread plans
- [ ] Tasks are sorted by priority correctly
- [ ] Navigation prioritizes unread threads over unread plans for same task
- [ ] When thread is read but plan is unread, `openPlanTab` is true
- [ ] Navigation uses Tauri IPC (NOT router.push)
- [ ] Read status changes update navigation immediately
- [ ] UI copy is neutral ("Next unread" not "Next task")
- [ ] SimpleTaskWindow accepts `initialView` prop
- [ ] 'n' keyboard shortcut works (optional)
- [ ] TypeScript compiles without errors
