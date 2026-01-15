# Plan 01: Types and Schema Changes

**Phase:** 1 (Foundation)
**Parallelizable with:** `02-git-adapter-extensions.md`
**Blocks:** `03-branch-manager.md`, `04-pool-manager.md`, `05-settings-migration.md`

## Objective

Update type definitions to support:
1. `defaultBranch` in repository settings (for fresh merge base computation)
2. Multi-thread claims (`threadIds[]` instead of `threadId`)
3. Task affinity tracking (`lastTaskId` on worktree state)

## Files to Modify

| File | Changes |
|------|---------|
| `src/entities/repositories/types.ts` | Add/modify types |

## Implementation

### 1. Add `defaultBranch` to `RepositorySettings`

```typescript
export interface RepositorySettings {
  // ... existing fields ...

  /** Default branch name (e.g., "main", "master") */
  defaultBranch: string;
}
```

### 2. Change `WorktreeClaim` to Support Multiple Threads

**Before:**
```typescript
export interface WorktreeClaim {
  threadId: string;
  taskId: string;
  claimedAt: number;
}
```

**After:**
```typescript
/**
 * Active claim on a worktree.
 * Multiple threads on the same task can share a worktree concurrently.
 */
export interface WorktreeClaim {
  /** The task ID holding the claim */
  taskId: string;

  /** All thread IDs actively using this worktree */
  threadIds: string[];

  /** When the claim was first made */
  claimedAt: number;
}
```

### 3. Add `lastTaskId` to `WorktreeState`

```typescript
export interface WorktreeState {
  path: string;
  version: number;
  currentBranch: string | null;
  claim: WorktreeClaim | null;
  lastReleasedAt?: number;

  /** Last task that used this worktree (for task affinity) */
  lastTaskId?: string;
}
```

## Verification

```bash
# TypeScript compilation should pass
pnpm typecheck

# Existing tests should fail (expected - schema changed)
# This is intentional - other plans will update the tests
```

## Notes

- This is a **breaking change** to the schema
- Plan `05-settings-migration.md` handles migration of existing `settings.json` files
- Do NOT update any service code in this plan - that's handled by other plans
