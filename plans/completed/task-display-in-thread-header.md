# Plan: Display Associated Task in Thread View Header

## Overview

When viewing a thread, display the associated task in the header area with the ability to navigate/link to the task. This provides context about what the agent is working on and enables quick task access.

## Current State

- **Thread header**: Located at `src/components/thread/thread-window.tsx:243-245`, currently shows only "Chat" text
- **Thread-Task relationship**: `ThreadMetadata.taskId` links to `TaskMetadata` (see `src/entities/threads/types.ts:14`)
- **Task properties**: Title, status, tags, repositoryName available (see `src/entities/tasks/types.ts:22-35`)
- **Navigation**: Event-based via Tauri IPC, no direct task navigation exists yet

## Design

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [Task Icon] Task Title                            [status badge]│
│ repo-name · tag1 · tag2                           [open button] │
├─────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────┐ ┌───────────────────────────┐ │
│ │ Changes                  [3] │ │ Chat                      │ │
│ │ ...                          │ │ ...                       │ │
│ └───────────────────────────────┘ └───────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

The task header spans the full width above the existing split panes, containing:
- Task title (primary text)
- Status badge (colored by status type)
- Repository name
- Tags (if any)
- Action button to open task (future: links to task detail view)

## Implementation Steps

### Step 1: Create TaskHeaderBadge Component

**File**: `src/components/thread/task-header-badge.tsx`

Create a reusable badge component for task status:

```typescript
import type { TaskStatus } from "@/entities/tasks/types";

interface TaskHeaderBadgeProps {
  status: TaskStatus;
}

const statusConfig: Record<TaskStatus, { label: string; className: string }> = {
  "backlog": { label: "Backlog", className: "bg-slate-600 text-slate-200" },
  "todo": { label: "To Do", className: "bg-slate-500 text-white" },
  "in-progress": { label: "In Progress", className: "bg-blue-500 text-white" },
  "done": { label: "Done", className: "bg-green-500 text-white" },
  "pending": { label: "Pending", className: "bg-yellow-500 text-black" },
  "in_progress": { label: "Working", className: "bg-blue-500 text-white" },
  "paused": { label: "Paused", className: "bg-orange-500 text-white" },
  "completed": { label: "Completed", className: "bg-green-500 text-white" },
  "merged": { label: "Merged", className: "bg-purple-500 text-white" },
  "cancelled": { label: "Cancelled", className: "bg-red-500 text-white" },
};

export function TaskHeaderBadge({ status }: TaskHeaderBadgeProps) {
  const config = statusConfig[status] ?? statusConfig["pending"];
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
```

### Step 2: Create TaskHeader Component

**File**: `src/components/thread/task-header.tsx`

Create the main task header component:

```typescript
import { useTaskStore } from "@/entities";
import { TaskHeaderBadge } from "./task-header-badge";
import { ClipboardList, ExternalLink } from "lucide-react";

interface TaskHeaderProps {
  taskId: string;
  onOpenTask?: () => void;
}

export function TaskHeader({ taskId, onOpenTask }: TaskHeaderProps) {
  const task = useTaskStore((state) => state.tasks[taskId]);

  if (!task) {
    return null; // Task not loaded yet or doesn't exist
  }

  return (
    <div className="px-4 py-3 border-b border-slate-700/50 bg-slate-800/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <ClipboardList className="h-4 w-4 text-slate-400 flex-shrink-0" />
          <h1 className="text-sm font-medium text-slate-200 truncate">
            {task.title}
          </h1>
          <TaskHeaderBadge status={task.status} />
        </div>
        {onOpenTask && (
          <button
            onClick={onOpenTask}
            className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            aria-label="Open task details"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>
      {/* Secondary info row */}
      {(task.repositoryName || task.tags.length > 0) && (
        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
          {task.repositoryName && (
            <span className="flex items-center gap-1">
              {task.repositoryName}
            </span>
          )}
          {task.repositoryName && task.tags.length > 0 && (
            <span className="text-slate-600">·</span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-700/50">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Step 3: Create Hook to Get Task from Thread

**File**: `src/hooks/use-thread-task.ts`

Create a hook that gets the associated task for a thread:

```typescript
import { useThreadStore, useTaskStore } from "@/entities";
import type { TaskMetadata } from "@/entities/tasks/types";

/**
 * Gets the task associated with a thread.
 * Returns undefined if thread or task not found.
 */
export function useThreadTask(threadId: string): TaskMetadata | undefined {
  const thread = useThreadStore((state) => state.threads[threadId]);
  const task = useTaskStore((state) =>
    thread?.taskId ? state.tasks[thread.taskId] : undefined
  );
  return task;
}
```

### Step 4: Integrate TaskHeader into ThreadWindow

**File**: `src/components/thread/thread-window.tsx`

Modify the thread window to include the task header:

1. Import the new components and hook:
```typescript
import { TaskHeader } from "./task-header";
import { useThreadStore } from "@/entities";
```

2. Get the thread metadata to access taskId:
```typescript
const thread = useThreadStore((state) => state.threads[threadId]);
const taskId = thread?.taskId;
```

3. Add the TaskHeader above the split panes (after line 212, before the flex container):
```typescript
return (
  <div className="h-full flex flex-col bg-gradient-to-br from-slate-900 to-slate-800">
    {/* Task header - spans full width */}
    {taskId && (
      <TaskHeader
        taskId={taskId}
        onOpenTask={() => {
          // Future: Navigate to task detail view
          logger.log("[ThreadWindow] Open task:", taskId);
        }}
      />
    )}

    {/* Existing split pane layout */}
    <div className="flex-1 flex min-h-0">
      {/* Left pane: File changes */}
      ...
      {/* Right pane: Chat */}
      ...
    </div>
  </div>
);
```

### Step 5: Add Task Navigation (Future Enhancement)

**File**: `src/lib/hotkey-service.ts`

Add a function to navigate to task details (placeholder for future task detail view):

```typescript
/**
 * Opens the task detail view for a specific task.
 * Currently shows main window - future: dedicated task view.
 */
export const openTask = async (taskId: string): Promise<void> => {
  // For now, just show main window
  // Future: invoke("open_task", { taskId });
  await invoke("show_main_window");
};
```

Update TaskHeader to use this:
```typescript
import { showMainWindow } from "@/lib/hotkey-service";

// In onOpenTask handler:
onOpenTask={() => showMainWindow()}
```

## Files to Create

1. `src/components/thread/task-header-badge.tsx` - Status badge component
2. `src/components/thread/task-header.tsx` - Main task header component
3. `src/hooks/use-thread-task.ts` - Hook to get task from thread (optional, can inline)

## Files to Modify

1. `src/components/thread/thread-window.tsx` - Integrate TaskHeader component

## Testing

1. Create a new task via spotlight
2. Verify task header appears at top of thread window
3. Verify task title displays correctly
4. Verify status badge shows correct status and color
5. Verify repository name displays when present
6. Verify tags display when present
7. Verify "open task" button is functional (shows main window for now)
8. Test with a thread that has no associated task (header should not render)
9. Test responsive behavior with long task titles (should truncate)

## Future Enhancements

- **Task Detail View**: Implement dedicated task panel/view with full task info
- **Task Actions**: Add quick actions (change status, add tags) in header
- **Thread Siblings**: Show count of other threads on same task
- **Task Progress**: Show subtask completion progress
- **Keyboard Navigation**: Add shortcut to jump between task and thread views
