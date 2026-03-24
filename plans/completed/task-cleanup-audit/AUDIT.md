# Task Cleanup Audit

## Overview

This document provides a comprehensive audit of remaining "task" references in the codebase after the Thread + Plan architecture refactor. The goal is to remove all vestiges of the deprecated Task entity.

## Summary

| Category | Files Affected | Priority |
|----------|---------------|----------|
| Breaking (runtime errors) | 2 | HIGH |
| Type/Schema Renames | 4 | MEDIUM |
| Test Helpers (unused) | 3 | MEDIUM |
| UI Naming (cosmetic) | 5 | LOW |
| Comments Only | ~10 | LOW |

---

## HIGH PRIORITY: Breaking Issues

### 1. CLI Task Commands

**File:** `agents/src/cli/anvil.ts`

The CLI still has placeholder task commands that throw errors. These should be removed entirely.

**Lines 8-21:** Placeholder type definitions
```typescript
// TODO: Task functionality has been removed from the codebase.
type TaskStatus = "draft" | "backlog" | "todo" | "in-progress" | "in-review" | "done" | "cancelled";
interface TaskMetadata { ... }
```

**Action:** Delete the entire task CLI section:
- Remove placeholder types (lines 8-21)
- Remove `validateStatus()` function
- Remove `formatTaskLine()` and `formatTaskDetails()` functions
- Remove task help text and `showTasksHelp()` function
- Remove `tasksList`, `tasksCreate`, `tasksRename`, `tasksUpdate`, `tasksGet` functions
- Remove command routing for `tasks` subcommand

### 2. Legacy openTask Tauri Command

**File:** `src/lib/hotkey-service.ts` (lines 94-101)

```typescript
export const openTask = async (
  threadId: string,
  taskId: string,  // <-- This parameter is legacy
  prompt?: string,
  repoName?: string
): Promise<void> => {
  await invoke("open_task", { threadId, taskId, prompt, repoName });
};
```

**Action:**
- Verify this function is not called anywhere
- Delete `openTask` function
- Remove corresponding Tauri command `open_task` from Rust backend

---

## MEDIUM PRIORITY: Type/Schema Renames

### 1. TaskBranchInfo → ThreadBranchInfo

**File:** `core/types/repositories.ts`

```typescript
// Current (lines 8-24)
export const TaskBranchInfoSchema = z.object({
  branch: z.string(),
  baseBranch: z.string(),
  mergeBase: z.string(),
  parentTaskId: z.string().optional(),  // <-- Also rename this field
  createdAt: z.number(),
});
export type TaskBranchInfo = z.infer<typeof TaskBranchInfoSchema>;
```

**Action:** Rename to `ThreadBranchInfoSchema` / `ThreadBranchInfo`, and rename `parentTaskId` to `parentThreadId`.

**Affected files:**
- `core/types/repositories.ts`
- `src/entities/repositories/service.ts`
- `src/entities/repositories/types.ts`
- `src/lib/persistence.ts`
- `core/services/repository/settings-service.test.ts`
- `core/services/worktree/worktree-service.test.ts`
- `agents/src/testing/services/test-anvil-directory.ts`
- `core/types/__tests__/thread-plan-types.test.ts`
- `src/entities/threads/__tests__/utils.test.ts`

### 2. taskBranches → threadBranches

**File:** `core/types/repositories.ts` (line 71)

```typescript
// Current
taskBranches: z.record(z.string(), TaskBranchInfoSchema),

// Should be
threadBranches: z.record(z.string(), ThreadBranchInfoSchema),
```

**Action:** Rename field in schema and all usages.

### 3. Deprecated Git Functions

**File:** `agents/src/git.ts`

```typescript
// Lines 99-149 - marked @deprecated but still used
export function createTaskBranch(...) { ... }
export function generateTaskDiff(...) { ... }
```

**Action:** Either:
- Rename to `createThreadBranch` / `generateThreadDiff`, or
- Remove if truly unused and workspace service provides equivalent functionality

---

## MEDIUM PRIORITY: Test Helpers (Unused)

### 1. Task Test IDs

**File:** `src/test/helpers/queries.ts` (lines 20-25)

```typescript
export const testIds = {
  // Task List - DELETE THESE
  taskList: "task-list",
  taskItem: (id: string) => `task-item-${id}`,
  taskTitle: (id: string) => `task-title-${id}`,
  taskStatus: (id: string) => `task-status-${id}`,
  taskActions: (id: string) => `task-actions-${id}`,
  // ... keep the rest
};
```

**Action:** Remove task-related test IDs.

### 2. Task Query Helpers

**File:** `src/test/helpers/queries.ts` (lines 83-99)

```typescript
// DELETE THESE FUNCTIONS
export function getTaskItem(taskId: string): HTMLElement { ... }
export function queryTaskItem(taskId: string): HTMLElement | null { ... }
export function getTaskStatus(taskId: string): HTMLElement { ... }
```

**Action:** Delete unused task query helpers.

### 3. Task Assertion Helpers

**File:** `src/test/helpers/queries.ts` (lines 193-210, likely)

```typescript
// DELETE THESE IF THEY EXIST
export function expectTaskExists(...) { ... }
export function expectTaskNotExists(...) { ... }
export function expectTaskHasStatus(...) { ... }
```

**Action:** Delete unused task assertion helpers.

### 4. Re-exports

**File:** `src/test/helpers/index.ts`

**Action:** Remove task helper exports.

---

## LOW PRIORITY: UI Naming (Cosmetic)

### 1. Spotlight Types

**File:** `src/components/spotlight/types.ts`

```typescript
// Rename TaskResult → ThreadCreationResult (lines 18-25)
export interface TaskResult {
  query: string;
  selectedWorktree?: { path: string; name: string; };
}

// Rename OpenTasksResult → OpenThreadsResult (lines 37-40)
export interface OpenTasksResult {
  action: "open-tasks";
}

// Update ActionResult union (line 48)
export type ActionResult = OpenRepoResult | OpenAnvilResult | OpenTasksResult | RefreshResult;

// Update SpotlightResult union (line 67)
| { type: "task"; data: TaskResult }
```

**Action:** Rename types and update discriminant values:
- `TaskResult` → `ThreadCreationResult`
- `OpenTasksResult` → `OpenThreadsResult` (or remove if unused)
- `{ type: "task" }` → `{ type: "thread" }`

### 2. Navigation Banner Store

**File:** `src/stores/navigation-banner-store.ts`

```typescript
// Rename nextTaskMessage → nextItemMessage (lines 6, 14, 16, 25)
interface NavigationBannerState {
  nextTaskMessage: string;  // → nextItemMessage
  showBanner: (completionMessage: string, nextTaskMessage: string) => void;
}
```

**Action:** Rename `nextTaskMessage` to `nextItemMessage` or `nextThreadMessage`.

### 3. Quick Actions Store

**File:** `src/stores/quick-actions-store.ts`

```typescript
// Rename action types (lines 4, 21, 26)
export type ActionType = "markUnread" | "archive" | "respond" | "nextTask" | "closeTask" | "followUp";
//                                                               ^^^^^^^^    ^^^^^^^^^
// Should be: "nextItem" | "closePanel" (or "next" | "close")
```

**Action:** Rename `nextTask` → `nextItem` and `closeTask` → `closePanel`.

### 4. History Result Comment

**File:** `src/components/spotlight/types.ts` (line 60)

```typescript
isDraft: boolean;      // Whether this is a draft (no taskId)
//                                                   ^^^^^^
```

**Action:** Update comment to remove taskId reference.

---

## LOW PRIORITY: Comments Only

These files have comments mentioning "task" that should be updated for consistency:

| File | Lines | Description |
|------|-------|-------------|
| `src/lib/optimistic.ts` | 18, 22-23 | Comments about task optimistic updates |
| `src/entities/settings/types.ts` | 14, 20, 26 | Settings type comments |
| `src/test/helpers/render.tsx` | 71-108 | Test render helper comments |
| `agents/src/runner.ts` | 78 | Runner comment |
| `src/components/spotlight/spotlight.tsx` | Multiple | Various task-related comments |

---

## Cleanup Order

### Phase 1: Breaking Changes (Do First)
1. Remove CLI task commands from `agents/src/cli/anvil.ts`
2. Verify and remove `openTask` from hotkey-service.ts
3. Remove corresponding Rust commands if needed

### Phase 2: Schema Migration
1. Rename `TaskBranchInfo` → `ThreadBranchInfo` in `core/types/repositories.ts`
2. Rename `taskBranches` → `threadBranches`
3. Update all affected files (grep for usages)
4. Update or remove deprecated git functions in `agents/src/git.ts`

### Phase 3: Test Cleanup
1. Remove task test IDs from `src/test/helpers/queries.ts`
2. Remove task query/assertion helpers
3. Update index exports

### Phase 4: UI Naming
1. Rename spotlight types
2. Rename store fields
3. Update action type names

### Phase 5: Comments
1. Search and replace task-related comments
2. Update documentation strings

---

## Verification

After cleanup, run these commands to verify no task references remain:

```bash
# Search for "task" in TypeScript/JavaScript (case-insensitive)
rg -i "task" --type ts --type tsx -g '!node_modules' -g '!dist'

# Search for "Task" (PascalCase - likely type names)
rg "Task" --type ts -g '!node_modules' -g '!dist'

# Search in Rust code
rg -i "task" --type rust

# Ensure tests pass
pnpm test

# Ensure build succeeds
pnpm build
```

---

## Files Safe to Ignore

These mentions of "task" are likely intentional or external:

- References to background tasks (OS-level, not our Task entity)
- References to Tauri task APIs
- Third-party library references
- Generic programming concepts (e.g., "async task")
