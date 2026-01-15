# Task Refresh and Delete Features

## Overview

Implement two features for the task system:
1. **Refresh tasks from disk** - Allow users to manually reload all tasks from the filesystem
2. **Delete tasks via UI** - Add delete functionality to task cards with confirmation

## Current State

### What Exists
- `taskService.delete(id)` - Full delete implementation with:
  - Recursive subtask deletion
  - Optimistic updates with rollback
  - File cleanup (both `.json` and `.md`)
- `taskService.hydrate()` - Loads all tasks from disk at startup
- Zustand store with reactive updates
- Task cards and rows without delete buttons

### What's Missing
- No UI delete button on task cards
- No delete confirmation dialog
- No manual refresh trigger
- No refresh button in toolbar
- No loading states for these operations

---

## Implementation Plan

### Phase 1: Refresh Tasks from Disk

#### 1.1 Add refresh method to taskService

**File:** `src/entities/tasks/service.ts`

Add a `refresh()` method that reloads all tasks from disk:

```typescript
async refresh(): Promise<void> {
  const files = await persistence.listDir("tasks");
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  const tasks: Record<string, TaskMetadata> = {};
  for (const file of jsonFiles) {
    const task = await persistence.readJson<TaskMetadata>(`tasks/${file}`);
    if (task) {
      tasks[task.id] = task;
    }
  }

  // Replace entire store state
  useTaskStore.setState({ tasks, _hydrated: true });
}
```

This differs from `hydrate()` in that:
- It can be called at any time (not just startup)
- It replaces the entire task state (picking up external changes)
- It doesn't need the initial `_hydrated` check

#### 1.2 Add refresh button to TaskToolbar

**File:** `src/components/tasks/task-toolbar.tsx`

Add a refresh button with icon:
- Icon: `RefreshCw` from lucide-react
- Position: Right side of toolbar, before view toggle
- Behavior: Calls `taskService.refresh()`
- Loading state: Spinning icon while refreshing

Props to add:
```typescript
onRefresh?: () => Promise<void>;
isRefreshing?: boolean;
```

#### 1.3 Wire up refresh in TaskBoardPage

**File:** `src/components/tasks/task-board-page.tsx`

- Add `isRefreshing` state
- Add `handleRefresh` callback that:
  1. Sets loading state
  2. Calls `taskService.refresh()`
  3. Clears loading state
- Pass to TaskToolbar

---

### Phase 2: Delete Tasks via UI

#### 2.1 Add delete handler hook

**File:** `src/hooks/use-delete-task.ts` (new file)

Create a hook for delete operations:

```typescript
export function useDeleteTask() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<TaskMetadata | null>(null);

  const requestDelete = (task: TaskMetadata) => {
    setTaskToDelete(task);
  };

  const confirmDelete = async () => {
    if (!taskToDelete) return;
    setIsDeleting(true);
    try {
      await taskService.delete(taskToDelete.id);
    } finally {
      setIsDeleting(false);
      setTaskToDelete(null);
    }
  };

  const cancelDelete = () => {
    setTaskToDelete(null);
  };

  return {
    taskToDelete,
    isDeleting,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
```

#### 2.2 Create delete confirmation dialog

**File:** `src/components/tasks/delete-task-dialog.tsx` (new file)

Create a confirmation dialog component:
- Shows task title being deleted
- Warning about subtask deletion (if task has subtasks)
- Warning about thread unlinking
- Cancel and Delete buttons
- Delete button is destructive (red)
- Loading state on delete button

Props:
```typescript
interface DeleteTaskDialogProps {
  task: TaskMetadata | null;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
```

Use existing dialog patterns from the codebase.

#### 2.3 Add delete button to TaskCard

**File:** `src/components/tasks/task-card.tsx`

Add delete button:
- Icon: `Trash2` from lucide-react
- Position: Top-right corner, visible on hover
- Size: Small icon button
- Color: Muted by default, red on hover
- Click handler: `onDelete(task)`

Props to add:
```typescript
onDelete?: (task: TaskMetadata) => void;
```

#### 2.4 Add delete button to TaskRow

**File:** `src/components/tasks/task-row.tsx`

Same pattern as TaskCard:
- Delete icon button on right side
- Visible on hover
- Calls `onDelete(task)`

#### 2.5 Wire up delete in TaskBoardPage

**File:** `src/components/tasks/task-board-page.tsx`

- Import and use `useDeleteTask` hook
- Render `DeleteTaskDialog` with hook state
- Pass `onDelete` callback to:
  - `KanbanBoard` → `KanbanColumn` → `TaskCard`
  - `TaskListView` → `TaskRow`

#### 2.6 Propagate onDelete through components

Update component props:

**KanbanBoard:**
```typescript
onDeleteTask?: (task: TaskMetadata) => void;
```

**KanbanColumn:**
```typescript
onDeleteTask?: (task: TaskMetadata) => void;
```

**TaskListView:**
```typescript
onDeleteTask?: (task: TaskMetadata) => void;
```

---

### Phase 3: Polish and Edge Cases

#### 3.1 Handle active task deletion

If the deleted task is currently selected/active:
- Clear the selection
- Navigate back to task board

Check in `TaskBoardPage` or wherever task selection state lives.

#### 3.2 Handle workspace branch cleanup

When deleting a task that has an associated branch:
- Call `workspaceService.deleteTaskBranch()` if branch exists
- Handle gracefully if branch deletion fails (task still gets deleted)

#### 3.3 Keyboard shortcuts

Consider adding:
- `Delete` or `Backspace` key when task is focused
- Would need focus management in task cards

---

## File Changes Summary

| File | Change Type |
|------|-------------|
| `src/entities/tasks/service.ts` | Modify - add `refresh()` |
| `src/components/tasks/task-toolbar.tsx` | Modify - add refresh button |
| `src/components/tasks/task-board-page.tsx` | Modify - wire up refresh and delete |
| `src/hooks/use-delete-task.ts` | Create - delete hook |
| `src/components/tasks/delete-task-dialog.tsx` | Create - confirmation dialog |
| `src/components/tasks/task-card.tsx` | Modify - add delete button |
| `src/components/tasks/task-row.tsx` | Modify - add delete button |
| `src/components/tasks/kanban-board.tsx` | Modify - pass onDelete prop |
| `src/components/tasks/kanban-column.tsx` | Modify - pass onDelete prop |
| `src/components/tasks/task-list-view.tsx` | Modify - pass onDelete prop |
| `src/hooks/index.ts` | Modify - export useDeleteTask |

---

## UI Mockup

### Toolbar with Refresh
```
[Search...] [Tags ▼] [🔄 Refresh] [Kanban | List]
```

### Task Card with Delete
```
┌─────────────────────────────┐
│ Task Title              [🗑] │  ← delete icon on hover
│ #tag1 #tag2                 │
│ 2/5 subtasks                │
└─────────────────────────────┘
```

### Delete Confirmation Dialog
```
┌─────────────────────────────────┐
│ Delete Task?                    │
├─────────────────────────────────┤
│ Are you sure you want to delete │
│ "Task Title"?                   │
│                                 │
│ ⚠ This will also delete 3      │
│   subtasks                      │
│                                 │
│         [Cancel] [Delete]       │
└─────────────────────────────────┘
```

---

## Testing Considerations

1. **Refresh:**
   - Add task via external tool, verify refresh picks it up
   - Modify task externally, verify refresh updates it
   - Delete task externally, verify refresh removes it

2. **Delete:**
   - Delete task with no subtasks
   - Delete task with subtasks (verify cascade)
   - Delete task with linked threads (verify unlinks)
   - Cancel delete confirmation
   - Delete currently active task
