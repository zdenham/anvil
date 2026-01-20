# Sub-Plan 0: Dead Code Deletion

## Prerequisites
None - this is the first step and unblocks everything else.

## Parallel Execution
Can run **standalone** - must complete before any other sub-plans start.

## Overview
Delete all pooling/allocation code. This is critical cleanup that must happen first to avoid building on deprecated abstractions.

## Files to DELETE

```bash
rm core/services/worktree/worktree-pool-manager.ts      # ~400 lines
rm core/services/worktree/worktree-pool-manager.test.ts # ~300 lines
rm core/services/worktree/allocation-service.ts         # ~350 lines
rm core/services/worktree/allocation-service.test.ts    # ~250 lines
rm core/services/worktree/branch-manager.ts             # ~200 lines
rm core/services/worktree/branch-manager.test.ts        # ~150 lines
```

## Types to DELETE from `core/types/repositories.ts`

1. Delete `WorktreeClaimSchema` entirely
2. Delete `WorktreeClaim` type entirely
3. Delete `RepositoryVersionSchema` if unused elsewhere
4. From `WorktreeStateSchema`: remove `claim`, `version`, `lastTaskId`, `lastReleasedAt`

Keep only:
```typescript
export const WorktreeStateSchema = z.object({
  path: z.string(),
  name: z.string(),
  lastAccessedAt: z.number().optional(),
  currentBranch: z.string().nullable().optional(),
});
```

## Code to DELETE from Other Files

### `agents/src/runners/task-runner-strategy.ts`
- All `WorktreeAllocationService` imports and usage
- All worktree claiming/releasing logic
- Auto-worktree creation fallbacks

### `agents/src/orchestration.ts`
- All `WorktreePoolManager` imports and usage
- All `WorktreeAllocationService` imports and usage

### `core/services/repository/settings-service.ts`
- Any pooling/claiming helper methods

### `src/entities/repositories/types.ts`
- `WorktreeClaim` type if duplicated here

### `src/lib/agent-service.ts`
- Error handling for "No available worktrees"
- `no_worktrees_available` error type

### `src/components/spotlight/spotlight.tsx`
- `no_worktrees_available` error type and handling

## Verification Steps

1. Delete the 6 files listed above
2. Remove the types from `core/types/repositories.ts`
3. Run TypeScript compiler: `pnpm tsc --noEmit`
4. Fix all import/compilation errors by removing dead references
5. Run tests: `pnpm test`
6. Delete tests for deleted code, fix any remaining test failures
7. Build: `pnpm build`

## Estimated Impact

| Category | Lines Removed |
|----------|---------------|
| Files deleted entirely | ~1,500 |
| Types removed | ~100 |
| Code removed from existing files | ~300 |
| Test code deleted | ~800 |
| **Total** | **~2,700 lines** |

## Success Criteria
- No references to `WorktreePoolManager`, `WorktreeAllocationService`, `BranchManager`
- No references to `WorktreeClaim` or claiming logic
- TypeScript compiles without errors
- Tests pass (after deleting dead test files)
- Build succeeds
