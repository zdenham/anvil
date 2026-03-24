# Task Status Validation

## Problem

Task metadata can contain invalid status values (e.g., `"complete"` instead of `"done"`). This causes tasks to not appear in the UI since the task board filters by valid status columns.

**Root cause**: A previous migration from old status values (`"complete"`, `"in_progress"`) to new values (`"done"`, `"in-progress"`) removed the `migrateStatus()` function without adding validation, allowing invalid statuses to persist.

## Valid Task Statuses

From `core/types/tasks.ts`:
```typescript
export type TaskStatus =
  | "draft"        // Created at spotlight, not yet committed
  | "backlog"      // Ideas, not yet prioritized
  | "todo"         // Prioritized, ready to work on
  | "in-progress"  // Agent actively working
  | "in-review"    // Work done, under review
  | "done"         // Merged and complete
  | "cancelled";   // Abandoned

export const TASK_STATUSES: readonly TaskStatus[] = [
  "draft", "backlog", "todo", "in-progress", "in-review", "done"
];
```

## Implementation Plan

### 1. Add validation helper function

**File**: `agents/src/core/persistence.ts`

```typescript
import { TASK_STATUSES, type TaskStatus } from "./types.js";

/**
 * Validate that a status is a valid TaskStatus.
 * Throws if invalid.
 */
function validateTaskStatus(status: string): TaskStatus {
  if (!TASK_STATUSES.includes(status as TaskStatus) && status !== "cancelled") {
    throw new Error(
      `Invalid task status "${status}". Valid values: ${[...TASK_STATUSES, "cancelled"].join(", ")}`
    );
  }
  return status as TaskStatus;
}
```

### 2. Add validation to `createTask`

**File**: `agents/src/core/persistence.ts` - `createTask()` method

```typescript
async createTask(input: CreateTaskInput): Promise<TaskMetadata> {
  // Validate status if provided
  const status = input.status
    ? validateTaskStatus(input.status)
    : "todo";

  // ... rest of method
  const task: TaskMetadata = {
    // ...
    status,  // Use validated status
    // ...
  };
}
```

### 3. Add validation to `updateTask`

**File**: `agents/src/core/persistence.ts` - `updateTask()` method

```typescript
async updateTask(id: string, updates: UpdateTaskInput): Promise<TaskMetadata> {
  // Validate status if provided
  if (updates.status) {
    validateTaskStatus(updates.status);
  }

  // ... rest of method
}
```

### 4. Add migration in `normalizeTask` for reading from disk

**File**: `agents/src/core/persistence.ts` - `normalizeTask()` method

Add migration for legacy status values when reading from disk:

```typescript
private normalizeTask(task: TaskMetadata): TaskMetadata {
  // Migrate legacy status values
  let status = task.status;
  const legacyStatusMap: Record<string, TaskStatus> = {
    "complete": "done",
    "completed": "done",
    "in_progress": "in-progress",
    "in_review": "in-review",
    "pending": "todo",
    "paused": "todo",
    "merged": "done",
  };

  if (status in legacyStatusMap) {
    logger.warn(
      `[persistence] Migrating legacy status "${status}" -> "${legacyStatusMap[status]}" for task ${task.id}`
    );
    status = legacyStatusMap[status];
  }

  // Validate final status
  if (!TASK_STATUSES.includes(status as TaskStatus) && status !== "cancelled") {
    logger.error(
      `[persistence] Invalid task status "${status}" for task ${task.id}, defaulting to "todo"`
    );
    status = "todo";
  }

  // ... rest of normalization
  return {
    ...task,
    status,
    tags: task.tags ?? [],
    subtasks: task.subtasks ?? [],
    pendingReviews,
  };
}
```

### 5. Add validation to CLI

The CLI already validates via `validateStatus()` in `agents/src/cli/anvil.ts:77`. No changes needed there.

## Files to Modify

1. `agents/src/core/persistence.ts`
   - Add `validateTaskStatus()` helper
   - Update `createTask()` to validate status
   - Update `updateTask()` to validate status
   - Update `normalizeTask()` to migrate legacy statuses

2. `agents/src/core/types.ts`
   - Ensure `TASK_STATUSES` is exported (already is)

## Testing

1. Create a task with invalid status via persistence directly - should throw
2. Update a task with invalid status - should throw
3. Load a task with legacy `"complete"` status - should migrate to `"done"`
4. Load a task with unknown status - should default to `"todo"` with warning

## Migration Script (Optional)

For existing tasks with invalid statuses, run a one-time migration:

```bash
# Find tasks with invalid statuses
find ~/.anvil-dev/tasks -name "metadata.json" -exec grep -l '"status": "complete"' {} \;

# Or fix via anvil CLI after validation is added:
anvil tasks update --id=<task-id> --status=done
```
