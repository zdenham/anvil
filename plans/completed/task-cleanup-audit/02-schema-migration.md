# 02 - Schema Migration

**Priority:** MEDIUM
**Dependencies:** 01-breaking-changes
**Estimated Files:** 8-10

## Overview

Rename Task-related types and fields to Thread equivalents throughout the codebase.

## Tasks

### 1. Rename TaskBranchInfo Schema

**File:** `core/types/repositories.ts`

```typescript
// Before
export const TaskBranchInfoSchema = z.object({
  branch: z.string(),
  baseBranch: z.string(),
  mergeBase: z.string(),
  parentTaskId: z.string().optional(),
  createdAt: z.number(),
});
export type TaskBranchInfo = z.infer<typeof TaskBranchInfoSchema>;

// After
export const ThreadBranchInfoSchema = z.object({
  branch: z.string(),
  baseBranch: z.string(),
  mergeBase: z.string(),
  parentThreadId: z.string().optional(),
  createdAt: z.number(),
});
export type ThreadBranchInfo = z.infer<typeof ThreadBranchInfoSchema>;
```

- [ ] Rename `TaskBranchInfoSchema` → `ThreadBranchInfoSchema`
- [ ] Rename `TaskBranchInfo` → `ThreadBranchInfo`
- [ ] Rename field `parentTaskId` → `parentThreadId`

### 2. Rename taskBranches Field

**File:** `core/types/repositories.ts` (line 71)

```typescript
// Before
taskBranches: z.record(z.string(), TaskBranchInfoSchema),

// After
threadBranches: z.record(z.string(), ThreadBranchInfoSchema),
```

- [ ] Rename `taskBranches` → `threadBranches` in schema
- [ ] Update all usages

### 3. Update Affected Files

Search and update all files that reference the renamed types:

- [ ] `core/types/repositories.ts` - Primary changes
- [ ] `src/entities/repositories/service.ts`
- [ ] `src/entities/repositories/types.ts`
- [ ] `src/lib/persistence.ts`
- [ ] `core/services/repository/settings-service.test.ts`
- [ ] `core/services/worktree/worktree-service.test.ts`
- [ ] `agents/src/testing/services/test-anvil-directory.ts`
- [ ] `core/types/__tests__/thread-plan-types.test.ts`
- [ ] `src/entities/threads/__tests__/utils.test.ts`

### 4. Handle Deprecated Git Functions

**File:** `agents/src/git.ts` (lines 99-149)

```typescript
// Currently marked @deprecated
export function createTaskBranch(...) { ... }
export function generateTaskDiff(...) { ... }
```

- [ ] Check if these functions are actually used
- [ ] If used: rename to `createThreadBranch` / `generateThreadDiff`
- [ ] If unused: delete entirely

## Verification

```bash
# Search for old names
rg "TaskBranchInfo|taskBranches|parentTaskId" --type ts

# Ensure no type errors
pnpm typecheck

# Run tests
pnpm test
```

## Migration Notes

**Data Migration:** If there's persisted data using `taskBranches`, you may need a migration. Check:
- [ ] Is `taskBranches` persisted to disk?
- [ ] If yes, add backward-compatible reading or migration logic

## Success Criteria

- [ ] No references to `TaskBranchInfo` or `TaskBranchInfoSchema`
- [ ] No references to `taskBranches` field
- [ ] No references to `parentTaskId`
- [ ] Git functions renamed or removed
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
