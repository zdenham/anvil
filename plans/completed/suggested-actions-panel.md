# Suggested Actions Panel Implementation!

## Overview

Implement a "suggested actions" panel positioned directly above the input in the simple thread view. The panel provides quick access to **Snooze** and **Delete** actions, with both actions automatically navigating to the next priority task according to the simplified task color coding system.

## Visual Layout Changes

### Current Simple Task Window Layout

```
┌─────────────────────────────────┐
│ SimpleTaskHeader                │
├─────────────────────────────────┤
│                                 │
│ ThreadView (flex-1)             │
│                                 │
├─────────────────────────────────┤
│ QueuedMessagesBanner            │
├─────────────────────────────────┤
│ ThreadInput (bg-surface-800)    │
└─────────────────────────────────┘
```

### Proposed Layout with Suggested Actions Panel

```
┌─────────────────────────────────┐
│ SimpleTaskHeader                │
├─────────────────────────────────┤
│                                 │
│ ThreadView (flex-1)             │
│                                 │
├─────────────────────────────────┤
│ QueuedMessagesBanner            │
├─────────────────────────────────┤
│ SuggestedActionsPanel           │ ← NEW
├─────────────────────────────────┤
│ ThreadInput (bg-surface-800)    │
└─────────────────────────────────┘
```

### Panel Dimensions Adjustment

- **Current NSPanel**: 750x750 pixels
- **Proposed**: Increase height to **850px**, potentially decrease width to **700px** (taller and thinner)
- **Suggested Actions Panel**: Height ~40px (similar to ThreadInput)

## Component Design

### SuggestedActionsPanel Component

**New file**: `src/components/simple-task/suggested-actions-panel.tsx`

```typescript
interface SuggestedActionsPanelProps {
  taskId: string;
  threadId: string;
  onAction: (action: "snooze" | "delete") => Promise<void>;
  disabled?: boolean; // Disable during agent execution
}

export function SuggestedActionsPanel({
  taskId,
  threadId,
  onAction,
  disabled = false,
}: SuggestedActionsPanelProps) {
  const [isProcessing, setIsProcessing] = useState<"snooze" | "delete" | null>(
    null
  );

  const handleSnooze = async () => {
    if (disabled || isProcessing) return;
    setIsProcessing("snooze");
    try {
      await onAction("snooze");
    } finally {
      setIsProcessing(null);
    }
  };

  const handleDelete = async () => {
    if (disabled || isProcessing) return;
    setIsProcessing("delete");
    try {
      await onAction("delete");
    } finally {
      setIsProcessing(null);
    }
  };

  return (
    <div className="flex gap-3 px-4 py-2 bg-surface-800 border-t border-surface-700">
      <button
        onClick={handleSnooze}
        disabled={disabled || isProcessing !== null}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
      >
        {isProcessing === "snooze" ? (
          <LoadingSpinner size="xs" />
        ) : (
          <ClockIcon className="w-4 h-4" />
        )}
        Snooze
      </button>

      <button
        onClick={handleDelete}
        disabled={disabled || isProcessing !== null}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
      >
        {isProcessing === "delete" ? (
          <LoadingSpinner size="xs" />
        ) : (
          <TrashIcon className="w-4 h-4" />
        )}
        Delete
      </button>
    </div>
  );
}
```

## Core Functionality Implementation

### 1. Snooze Functionality

**New file**: `src/entities/tasks/snooze-service.ts`

Since snooze functionality doesn't exist, implement it as a `sortOrder` manipulation:

```typescript
import { taskService } from "./service";
import { useTaskStore } from "./store";

/**
 * Move a task to the bottom of the priority list (below other unread/running tasks).
 * Task remains unread - only sortOrder is updated.
 */
export async function snoozeTask(taskId: string): Promise<void> {
  const tasks = useTaskStore.getState().tasks;
  const allTasks = Object.values(tasks).filter((t) => t.type === "simple");

  // Find the highest sortOrder among unread/running tasks
  // (higher sortOrder = lower priority = appears later in navigation)
  const maxSortOrder = Math.max(
    ...allTasks
      .filter((t) => isTaskUnread(t) || isTaskRunning(t))
      .map((t) => t.sortOrder)
  );

  // Set sortOrder to be higher than current max (lower priority)
  const newSortOrder = maxSortOrder + 1000; // Add buffer for future insertions

  await taskService.update(taskId, {
    sortOrder: newSortOrder,
    // DO NOT update status or pendingReviews - keep task unread
  });
}

/**
 * Check if a task needs attention (unread).
 * Same logic as simplified-task-color-coding.md and task-navigation-hotkeys.md
 */
function isTaskUnread(task: TaskMetadata): boolean {
  const hasUnaddressedReviews =
    task.pendingReviews?.some((r) => !r.isAddressed) ?? false;
  const isIncomplete = !["done", "cancelled"].includes(task.status);
  return hasUnaddressedReviews || isIncomplete;
}

/**
 * Check if a task has running threads.
 */
function isTaskRunning(task: TaskMetadata): boolean {
  const threads = threadService.getByTask(task.id);
  return threads.some((t) => t.status === "running");
}
```

### 2. Enhanced Delete Functionality

**Extend existing**: `src/entities/tasks/service.ts`

The delete functionality already exists, but needs to support cancellation signals and navigation:

```typescript
// Add to existing service
export async function deleteTaskAndNavigate(
  taskId: string
): Promise<string | null> {
  // Get next task before deletion
  const { getNextTaskId } = useSimpleTaskNavigation(taskId);
  const nextTask = getNextTaskId(taskId);

  // Issue cancellation signal for any running threads
  const threads = threadService.getByTask(taskId);
  for (const thread of threads) {
    if (thread.status === "running") {
      await threadService.cancel(thread.id);
    }
  }

  // Delete the task (this also cleans up threads)
  await taskService.delete(taskId);

  // Return next task info for navigation
  return nextTask.taskId;
}
```

### 3. Navigation Integration

**Integrate with existing**: `src/hooks/use-simple-task-navigation.ts`

The navigation hook from task-navigation-hotkeys.md already implements the priority-based navigation logic. Suggested actions will use the same navigation patterns:

```typescript
// Use existing getNextTaskId from navigation hook
export function useNavigateToNextTask(currentTaskId: string) {
  const { getNextTaskId } = useSimpleTaskNavigation(currentTaskId);

  const navigateToNext = useCallback(async () => {
    const result = getNextTaskId(currentTaskId);

    if (result.taskId && result.threadId) {
      // Use existing openSimpleTask from hotkey-service
      await openSimpleTask(result.threadId, result.taskId);
      return true; // Navigation successful
    }

    return false; // No next task available
  }, [currentTaskId, getNextTaskId]);

  return { navigateToNext };
}
```

## Integration with Simple Task Window

**Modify**: `src/components/simple-task/simple-task-window.tsx`

### Add Suggested Actions to Layout

```typescript
// Add imports
import { SuggestedActionsPanel } from "./suggested-actions-panel";
import { snoozeTask } from "@/entities/tasks/snooze-service";
import { deleteTaskAndNavigate } from "@/entities/tasks/service";
import { useNavigateToNextTask } from "@/hooks/use-simple-task-navigation";
import { getCurrentWindow } from "@tauri-apps/api/window";

function SimpleTaskWindowContent({
  taskId,
  threadId,
  prompt,
}: SimpleTaskWindowContentProps) {
  // ... existing code ...

  const { navigateToNext } = useNavigateToNextTask(taskId);

  const handleSuggestedAction = useCallback(
    async (action: "snooze" | "delete") => {
      try {
        if (action === "snooze") {
          await snoozeTask(taskId);

          // Navigate to next task
          const navigated = await navigateToNext();
          if (!navigated) {
            // No next task available, close window
            getCurrentWindow().close();
          }
        } else if (action === "delete") {
          const nextTaskId = await deleteTaskAndNavigate(taskId);

          if (nextTaskId) {
            // Navigation handled by deleteTaskAndNavigate
          } else {
            // No next task available, close window
            getCurrentWindow().close();
          }
        }
      } catch (error) {
        logger.error(`[SimpleTaskWindow] Failed to ${action} task`, {
          error,
          taskId,
        });
        // TODO: Show error toast
      }
    },
    [taskId, navigateToNext]
  );

  return (
    <div className="flex flex-col h-screen bg-surface-900 text-surface-50">
      <SimpleTaskHeader
        taskId={taskId}
        threadId={threadId}
        status={viewStatus}
      />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ThreadView
          messages={messages}
          isStreaming={isStreaming}
          status={viewStatus}
          toolStates={toolStates}
          onToolResponse={handleToolResponse}
        />
      </div>
      <QueuedMessagesBanner messages={queuedMessages} />
      <SuggestedActionsPanel
        taskId={taskId}
        threadId={threadId}
        onAction={handleSuggestedAction}
        disabled={isStreaming} // Disable during agent execution
      />
      <ThreadInput
        threadId={threadId}
        onSubmit={handleSubmit}
        disabled={false}
        workingDirectory={workingDirectory}
        placeholder={canQueueMessages ? "Queue a message..." : undefined}
      />
    </div>
  );
}
```

## Panel Dimension Updates

**Modify**: `src-tauri/src/panels.rs`

Update the simple task panel dimensions to accommodate the new suggested actions panel:

```rust
// Current configuration:
// simple_task_panel.set_content_size(LogicalSize::new(750.0, 750.0))?;

// Proposed configuration:
simple_task_panel.set_content_size(LogicalSize::new(700.0, 850.0))?;
```

## Task Navigation Integration

The suggested actions panel leverages the existing task navigation system:

1. **Priority-based ordering**: Uses `sortOrder` field from TaskMetadata
2. **Simplified color coding**: Follows unread/running/read logic from simplified-task-color-coding.md
3. **Navigation hooks**: Reuses navigation logic from task-navigation-hotkeys.md
4. **Consistent behavior**: Both hotkeys and suggested actions use same navigation patterns

### Navigation Priority Logic

```typescript
// Tasks are sorted by sortOrder (ascending = higher priority first)
// Navigation moves to next task in priority order
// Snooze moves task to bottom of priority list (higher sortOrder)
// Delete removes task and navigates to next in current order
```

## Behavioral Specifications

### Snooze Behavior

- **Action**: Increases task's `sortOrder` to move it to bottom of priority list
- **Task state**: Remains **unread** (no status changes, no pending review changes)
- **Navigation**: Moves to next priority task according to simplified color coding
- **Visual feedback**: Blue dot remains (still needs attention)

### Delete Behavior

- **Action**: Issues cancellation signal to any running threads, then permanently deletes task and all associated data
- **Cancellation**: Gracefully stops any active agent execution before deletion
- **Navigation**: Moves to next priority task according to simplified color coding
- **Window handling**: Closes simple task window if no more tasks available

### Navigation Fallbacks

- **No next task**: Close simple task window
- **Last task**: Wrap to first task (consistent with hotkey navigation)
- **Single task**: Close window after action (nothing to navigate to)

### Action Availability

- **Disable during agent execution**: Both actions disabled when `isStreaming === true`
- **Loading states**: Show spinner and disable other action during processing
- **Error handling**: Log errors and show user feedback (TODO: implement toast system)

## Implementation Files

| File                                                     | Change Type | Description                                   |
| -------------------------------------------------------- | ----------- | --------------------------------------------- |
| `src/components/simple-task/suggested-actions-panel.tsx` | **NEW**     | Main suggested actions panel component        |
| `src/entities/tasks/snooze-service.ts`                   | **NEW**     | Snooze functionality (sortOrder manipulation) |
| `src/components/simple-task/simple-task-window.tsx`      | **MODIFY**  | Integrate suggested actions panel into layout |
| `src/hooks/use-simple-task-navigation.ts`                | **EXTEND**  | Add useNavigateToNextTask hook                |
| `src/entities/tasks/service.ts`                          | **EXTEND**  | Add deleteTaskAndNavigate function            |
| `src-tauri/src/panels.rs`                                | **MODIFY**  | Update simple task panel dimensions           |

## Dependencies on Existing Plans

### Required First

1. **task-navigation-hotkeys.md**: Provides navigation infrastructure (useSimpleTaskNavigation hook)
2. **simplified-task-color-coding.md**: Defines unread/running/read logic for navigation priority

### Optional Integration

1. **permissions-toggle-improvements.md**: May affect panel layout or action availability
2. **task-drag-and-drop-reordering.md**: Could impact sortOrder manipulation in snooze functionality

## Testing Considerations

1. **Navigation edge cases**: Test with single task, no next task, all tasks read
2. **Snooze ordering**: Verify snoozed tasks move to correct position in priority list
3. **Delete navigation**: Ensure proper cleanup and next task selection
4. **Delete cancellation**: Verify running threads are properly cancelled before deletion
5. **Agent execution**: Confirm actions are properly disabled during streaming
6. **Panel dimensions**: Verify layout works with taller, thinner window
7. **State consistency**: Ensure task store updates propagate correctly
8. **Window management**: Test window closing behavior when no tasks remain
9. **Cancellation handling**: Test delete action with various thread states (running, idle, completed)

## Future Enhancements

1. **Keyboard shortcuts**: Add Ctrl+D for delete, Ctrl+S for snooze
2. **Custom snooze duration**: Allow user to specify how long to snooze
3. **Undo functionality**: Allow reversing snooze/delete actions
4. **Bulk actions**: Support selecting multiple tasks for snooze/delete
5. **Smart suggestions**: Show/hide actions based on task state
6. **Animation**: Add smooth transitions for action feedback
