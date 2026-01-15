# Phase 1: Unified Status System

**Dependencies:** None
**Parallel Group:** A

## Goal

Replace the dual status system (KanbanStatus/WorkspaceStatus) with a single unified `TaskStatus` type.

---

## 1.1 New Status Types

**File:** `src/entities/tasks/types.ts`

```typescript
/**
 * Unified task status used across kanban and workspace views.
 * This is the ONLY status type - no more KanbanStatus vs WorkspaceStatus.
 */
export type TaskStatus =
  | "backlog"      // Ideas, not yet prioritized
  | "todo"         // Prioritized, ready to work on
  | "in_progress"  // Agent actively working (execution phase)
  | "in_review"    // Work done, under review OR being merged
  | "complete"     // Merged and done
  | "cancelled";   // Abandoned

/** Task statuses in display order (left to right in kanban) */
export const TASK_STATUSES: readonly TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "complete",
];

/** Statuses that represent active work (agent can be spawned) */
export const ACTIVE_STATUSES: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "in_review",
];
```

**Remove:**
- `KanbanStatus` type
- `WorkspaceStatus` type
- `KANBAN_STATUSES` constant

---

## 1.2 Status Migration

Existing tasks need migration:

| Old Status | New Status |
|------------|------------|
| `draft` | `backlog` |
| `pending` | `todo` |
| `in_progress` | `in_progress` |
| `paused` | `todo` |
| `completed` | `in_review` |
| `merged` | `complete` |

---

## 1.3 Update All Status References

Search and update all files that reference the old status types:
- Components using `KanbanStatus` or `WorkspaceStatus`
- State machine functions
- Task service and store
- Any status-based filtering or display logic

---

## Checklist

- [ ] Define new `TaskStatus` type in `src/entities/tasks/types.ts`
- [ ] Add `TASK_STATUSES` and `ACTIVE_STATUSES` constants
- [ ] Remove `KanbanStatus`, `WorkspaceStatus`, `KANBAN_STATUSES`
- [ ] Update `TaskMetadata` interface to use `TaskStatus`
- [ ] Create migration logic for existing task data
- [ ] Update all component imports and usages
- [ ] Update task store selectors/filters
- [ ] Run type check to find remaining references
