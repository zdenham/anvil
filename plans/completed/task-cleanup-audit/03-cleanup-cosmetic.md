# 03 - Cleanup & Cosmetic

**Priority:** LOW
**Dependencies:** 01-breaking-changes, 02-schema-migration
**Estimated Files:** 15-20

## Overview

Remove unused test helpers, rename UI types/stores, and clean up comments. These are cosmetic changes that don't affect runtime behavior.

---

## Part A: Test Helper Cleanup

### 1. Remove Task Test IDs

**File:** `src/test/helpers/queries.ts` (lines 20-25)

```typescript
export const testIds = {
  // DELETE THESE
  taskList: "task-list",
  taskItem: (id: string) => `task-item-${id}`,
  taskTitle: (id: string) => `task-title-${id}`,
  taskStatus: (id: string) => `task-status-${id}`,
  taskActions: (id: string) => `task-actions-${id}`,
  // ... keep the rest
};
```

- [ ] Remove task-related test IDs

### 2. Remove Task Query Helpers

**File:** `src/test/helpers/queries.ts` (lines 83-99)

- [ ] Delete `getTaskItem(taskId: string)`
- [ ] Delete `queryTaskItem(taskId: string)`
- [ ] Delete `getTaskStatus(taskId: string)`

### 3. Remove Task Assertion Helpers

**File:** `src/test/helpers/queries.ts`

- [ ] Delete `expectTaskExists()` if present
- [ ] Delete `expectTaskNotExists()` if present
- [ ] Delete `expectTaskHasStatus()` if present

### 4. Update Index Exports

**File:** `src/test/helpers/index.ts`

- [ ] Remove any task helper exports

---

## Part B: UI Type Renames

### 1. Spotlight Types

**File:** `src/components/spotlight/types.ts`

| Current | New |
|---------|-----|
| `TaskResult` | `ThreadCreationResult` |
| `OpenTasksResult` | `OpenThreadsResult` (or delete if unused) |
| `{ type: "task" }` | `{ type: "thread" }` |

- [ ] Rename `TaskResult` → `ThreadCreationResult`
- [ ] Rename `OpenTasksResult` → `OpenThreadsResult`
- [ ] Update discriminant `type: "task"` → `type: "thread"`
- [ ] Update `ActionResult` union
- [ ] Update `SpotlightResult` union

### 2. Navigation Banner Store

**File:** `src/stores/navigation-banner-store.ts`

```typescript
// Before
interface NavigationBannerState {
  nextTaskMessage: string;
  showBanner: (completionMessage: string, nextTaskMessage: string) => void;
}

// After
interface NavigationBannerState {
  nextItemMessage: string;
  showBanner: (completionMessage: string, nextItemMessage: string) => void;
}
```

- [ ] Rename `nextTaskMessage` → `nextItemMessage`

### 3. Quick Actions Store

**File:** `src/stores/quick-actions-store.ts`

```typescript
// Before
export type ActionType = "markUnread" | "archive" | "respond" | "nextTask" | "closeTask" | "followUp";

// After
export type ActionType = "markUnread" | "archive" | "respond" | "nextItem" | "closePanel" | "followUp";
```

- [ ] Rename `nextTask` → `nextItem`
- [ ] Rename `closeTask` → `closePanel`

---

## Part C: Comment Cleanup

Update comments mentioning "task" in these files:

| File | Description |
|------|-------------|
| `src/lib/optimistic.ts` | Comments about task optimistic updates |
| `src/entities/settings/types.ts` | Settings type comments |
| `src/test/helpers/render.tsx` | Test render helper comments |
| `agents/src/runner.ts` | Runner comment |
| `src/components/spotlight/spotlight.tsx` | Various task-related comments |
| `src/components/spotlight/types.ts` | `isDraft` comment references taskId |

- [ ] Search for "task" in comments
- [ ] Update to appropriate terminology (thread, item, panel)
- [ ] Don't change comments referring to generic OS/async tasks

---

## Verification

```bash
# Final comprehensive search
rg -i "task" --type ts -g '!node_modules' -g '!dist' | grep -v "// ignore: generic task"

# Check for broken imports
pnpm typecheck

# Run all tests
pnpm test
```

## Success Criteria

- [ ] No task test IDs in queries.ts
- [ ] No task query/assertion helpers
- [ ] Spotlight types use Thread naming
- [ ] Store fields renamed
- [ ] Comments updated
- [ ] All tests pass
- [ ] Build succeeds
