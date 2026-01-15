# Plan 03: BranchManager Service

**Phase:** 2 (Service Classes)
**Depends on:** `02-git-adapter-extensions.md`
**Parallelizable with:** `04-pool-manager.md`, `05-settings-migration.md`
**Blocks:** `06-allocation-service-refactor.md`

## Objective

Create a new `BranchManager` service class that handles branch checkout and creation logic. This follows the single-responsibility principle by extracting branch operations from the monolithic `AllocationService`.

## Files to Create

| File | Purpose |
|------|---------|
| `core/services/worktree/branch-manager.ts` | BranchManager class |
| `core/services/worktree/branch-manager.test.ts` | Unit tests |

## Implementation

### 1. Create BranchManager Class

**File:** `core/services/worktree/branch-manager.ts`

```typescript
import { GitAdapter } from '../../adapters/types';

/**
 * Manages branch checkout and creation for worktrees.
 * Single responsibility: ensure worktree is on the correct branch.
 */
export class BranchManager {
  constructor(private git: GitAdapter) {}

  /**
   * Check if worktree is already on the target branch.
   */
  isOnBranch(worktreePath: string, branch: string): boolean {
    const currentBranch = this.git.getCurrentBranch(worktreePath);
    return currentBranch === branch;
  }

  /**
   * Ensure worktree is on the specified branch, creating it if needed.
   *
   * Flow:
   * 1. If already on target branch, no-op (optimization)
   * 2. Checkout merge base (clean starting point)
   * 3. Create branch if it doesn't exist
   * 4. Checkout the branch (attach HEAD)
   *
   * @param worktreePath - Path to the worktree
   * @param branch - Target branch name
   * @param sourcePath - Path to source repo (for checking branch existence)
   * @param mergeBase - Commit to checkout before creating branch
   */
  ensureBranch(
    worktreePath: string,
    branch: string,
    sourcePath: string,
    mergeBase: string
  ): void {
    // Optimization: skip if already on target branch
    if (this.isOnBranch(worktreePath, branch)) {
      return;
    }

    // Checkout merge base first (clean state)
    this.git.checkoutCommit(worktreePath, mergeBase);

    // Create branch if it doesn't exist
    if (!this.git.branchExists(sourcePath, branch)) {
      this.git.createBranch(worktreePath, branch);
    }

    // Checkout the branch (attach HEAD)
    this.git.checkoutBranch(worktreePath, branch);
  }
}
```

### 2. Add Unit Tests

**File:** `core/services/worktree/branch-manager.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BranchManager } from './branch-manager';
import { GitAdapter } from '../../adapters/types';

describe('BranchManager', () => {
  let manager: BranchManager;
  let mockGit: jest.Mocked<GitAdapter>;

  const worktreePath = '/path/to/worktree';
  const sourcePath = '/path/to/source';
  const mergeBase = 'abc123';

  beforeEach(() => {
    mockGit = {
      getCurrentBranch: vi.fn(),
      checkoutCommit: vi.fn(),
      branchExists: vi.fn(),
      createBranch: vi.fn(),
      checkoutBranch: vi.fn(),
      // ... other methods
    } as unknown as jest.Mocked<GitAdapter>;

    manager = new BranchManager(mockGit);
  });

  describe('isOnBranch', () => {
    it('returns true when on target branch', () => {
      mockGit.getCurrentBranch.mockReturnValue('task/foo');
      expect(manager.isOnBranch(worktreePath, 'task/foo')).toBe(true);
    });

    it('returns false when on different branch', () => {
      mockGit.getCurrentBranch.mockReturnValue('task/other');
      expect(manager.isOnBranch(worktreePath, 'task/foo')).toBe(false);
    });

    it('returns false when in detached HEAD', () => {
      mockGit.getCurrentBranch.mockReturnValue(null);
      expect(manager.isOnBranch(worktreePath, 'task/foo')).toBe(false);
    });
  });

  describe('ensureBranch', () => {
    it('skips all operations when already on target branch', () => {
      mockGit.getCurrentBranch.mockReturnValue('task/foo');

      manager.ensureBranch(worktreePath, 'task/foo', sourcePath, mergeBase);

      expect(mockGit.checkoutCommit).not.toHaveBeenCalled();
      expect(mockGit.branchExists).not.toHaveBeenCalled();
      expect(mockGit.createBranch).not.toHaveBeenCalled();
      expect(mockGit.checkoutBranch).not.toHaveBeenCalled();
    });

    it('creates and checks out new branch when it does not exist', () => {
      mockGit.getCurrentBranch.mockReturnValue(null); // detached HEAD
      mockGit.branchExists.mockReturnValue(false);

      manager.ensureBranch(worktreePath, 'task/foo', sourcePath, mergeBase);

      expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, mergeBase);
      expect(mockGit.branchExists).toHaveBeenCalledWith(sourcePath, 'task/foo');
      expect(mockGit.createBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
    });

    it('checks out existing branch without creating', () => {
      mockGit.getCurrentBranch.mockReturnValue('task/other');
      mockGit.branchExists.mockReturnValue(true);

      manager.ensureBranch(worktreePath, 'task/foo', sourcePath, mergeBase);

      expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, mergeBase);
      expect(mockGit.branchExists).toHaveBeenCalledWith(sourcePath, 'task/foo');
      expect(mockGit.createBranch).not.toHaveBeenCalled();
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
    });

    it('handles transition from detached HEAD to branch', () => {
      mockGit.getCurrentBranch.mockReturnValue(null);
      mockGit.branchExists.mockReturnValue(true);

      manager.ensureBranch(worktreePath, 'task/foo', sourcePath, mergeBase);

      expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, mergeBase);
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
    });
  });
});
```

## Verification

```bash
# TypeScript compilation
pnpm typecheck

# Run branch manager tests
pnpm test core/services/worktree/branch-manager.test.ts
```

## Design Decisions

1. **Optimization first**: Check if already on branch before any git operations
2. **Clean state**: Always checkout merge base before branch operations to ensure predictable state
3. **Source repo for existence check**: Branch existence is checked in source repo since branches are shared across worktrees
4. **Create then checkout**: Separate `createBranch` and `checkoutBranch` for clarity (vs `git checkout -b`)

## Notes

- This class is deliberately minimal - single responsibility
- It depends on GitAdapter methods from `02-git-adapter-extensions.md`
- Will be injected into AllocationService in `06-allocation-service-refactor.md`
