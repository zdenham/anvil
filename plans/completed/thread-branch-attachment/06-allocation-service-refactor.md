# Plan 06: AllocationService Refactor

**Phase:** 3 (Integration)
**Depends on:** `01-types-and-schema.md`, `02-git-adapter-extensions.md`, `03-branch-manager.md`, `04-pool-manager.md`, `05-settings-migration.md`
**Blocks:** `07-orchestration-integration.md`

## Objective

Refactor `AllocationService` from a monolithic class into a thin orchestration layer that delegates to the newly created service classes. Fix the merge base computation bug (using `origin/{defaultBranch}` instead of `HEAD`).

## Files to Modify

| File | Changes |
|------|---------|
| `core/services/worktree/allocation-service.ts` | Refactor to use injected services |
| `core/services/worktree/allocation-service.test.ts` | Update tests for new behavior |

## Implementation

### 1. Update AllocateOptions Interface

```typescript
export interface AllocateOptions {
  /** Task ID for worktree affinity */
  taskId?: string;

  /** Branch to checkout/create */
  taskBranch?: string;
}

export interface WorktreeAllocation {
  worktree: WorktreeState;
  mergeBase: string;
}
```

### 2. Update Constructor

```typescript
import { BranchManager } from './branch-manager';
import { WorktreePoolManager } from './worktree-pool-manager';

export class AllocationService {
  constructor(
    private git: GitAdapter,
    private settingsService: SettingsService,
    private mergeBaseService: MergeBaseService,
    private branchManager: BranchManager,
    private poolManager: WorktreePoolManager,
    private logger: Logger
  ) {}

  // ... methods
}
```

### 3. Refactor `allocate()` Method

```typescript
allocate(repoName: string, threadId: string, options?: AllocateOptions): WorktreeAllocation {
  const lockPath = this.getLockPath(repoName);

  return this.withLock(lockPath, () => {
    const settings = this.settingsService.load(repoName);

    // 1. Get or claim a worktree
    const worktree = this.claimWorktree(settings, threadId, options?.taskId);

    try {
      // 2. Fetch latest refs (non-fatal)
      this.safeFetch(settings.sourcePath);

      // 3. Compute merge base against origin's default branch
      // FIX: Use origin/{defaultBranch} instead of HEAD
      const remoteBranch = `origin/${settings.defaultBranch}`;
      const mergeBase = this.mergeBaseService.compute(settings.sourcePath, remoteBranch);

      // 4. Handle branch attachment
      if (options?.taskBranch) {
        this.branchManager.ensureBranch(
          worktree.path,
          options.taskBranch,
          settings.sourcePath,
          mergeBase
        );
      } else {
        // No branch specified - checkout at merge base (detached HEAD)
        this.git.checkoutCommit(worktree.path, mergeBase);
      }

      this.settingsService.save(repoName, settings);
      return { worktree, mergeBase };
    } catch (err) {
      // Rollback claim on failure
      this.release(repoName, threadId);
      throw err;
    }
  });
}
```

### 4. Refactor `claimWorktree()` Method

```typescript
private claimWorktree(
  settings: RepositorySettings,
  threadId: string,
  taskId?: string
): WorktreeState {
  // Priority 1: Add to existing task claim (concurrent access)
  if (taskId) {
    const taskWorktree = this.poolManager.findByTask(settings, taskId);
    if (taskWorktree) {
      this.poolManager.addThreadToClaim(taskWorktree, threadId);
      return taskWorktree;
    }
  }

  // Priority 2: Unclaimed worktree with task affinity
  if (taskId) {
    const affinityWorktree = this.poolManager.selectByAffinity(settings, taskId);
    if (affinityWorktree) {
      this.poolManager.claim(affinityWorktree, taskId, threadId);
      return affinityWorktree;
    }
  }

  // Priority 3: LRU available worktree (for new tasks)
  const available = this.poolManager.getAvailable(settings);
  let worktree = available[0];

  if (!worktree) {
    // Create new worktree if none available
    worktree = this.poolManager.create(repoName, settings);
  }

  this.poolManager.claim(worktree, taskId ?? 'unknown', threadId);
  return worktree;
}
```

### 5. Refactor `release()` Method

```typescript
release(repoName: string, threadId: string): void {
  const lockPath = this.getLockPath(repoName);

  this.withLock(lockPath, () => {
    const settings = this.settingsService.load(repoName);
    const worktree = this.poolManager.findByThread(settings, threadId);

    if (worktree) {
      this.poolManager.releaseThread(worktree, threadId);
      this.settingsService.save(repoName, settings);
    }
  });
}
```

### 6. Add `safeFetch()` Helper

```typescript
private safeFetch(sourcePath: string): void {
  try {
    this.git.fetch(sourcePath);
  } catch (err) {
    this.logger.warn('Failed to fetch from origin, using local refs', { error: err });
  }
}
```

### 7. Update Tests

**File:** `core/services/worktree/allocation-service.test.ts`

```typescript
describe('allocate', () => {
  describe('merge base computation', () => {
    it('fetches from origin before computing merge base', () => {
      service.allocate('repo', 'thread-1', { taskId: 'task-1' });

      expect(mockGit.fetch).toHaveBeenCalledWith(sourcePath);
      expect(mockMergeBaseService.compute).toHaveBeenCalledWith(
        sourcePath,
        'origin/main' // NOT 'HEAD'!
      );
    });

    it('uses defaultBranch from settings', () => {
      mockSettings.defaultBranch = 'master';

      service.allocate('repo', 'thread-1', { taskId: 'task-1' });

      expect(mockMergeBaseService.compute).toHaveBeenCalledWith(
        sourcePath,
        'origin/master'
      );
    });

    it('continues with local refs when fetch fails', () => {
      mockGit.fetch.mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = service.allocate('repo', 'thread-1', { taskId: 'task-1' });

      expect(result.worktree).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch from origin, using local refs',
        expect.anything()
      );
    });
  });

  describe('branch attachment', () => {
    it('calls branchManager.ensureBranch when taskBranch provided', () => {
      service.allocate('repo', 'thread-1', {
        taskId: 'task-1',
        taskBranch: 'task/foo',
      });

      expect(mockBranchManager.ensureBranch).toHaveBeenCalledWith(
        worktreePath,
        'task/foo',
        sourcePath,
        mergeBase
      );
    });

    it('checkouts merge base when no taskBranch', () => {
      service.allocate('repo', 'thread-1', { taskId: 'task-1' });

      expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, mergeBase);
      expect(mockBranchManager.ensureBranch).not.toHaveBeenCalled();
    });
  });

  describe('worktree claiming', () => {
    it('adds thread to existing task claim (concurrent access)', () => {
      mockPoolManager.findByTask.mockReturnValue(existingWorktree);

      service.allocate('repo', 'thread-2', { taskId: 'task-A' });

      expect(mockPoolManager.addThreadToClaim).toHaveBeenCalledWith(
        existingWorktree,
        'thread-2'
      );
      expect(mockPoolManager.claim).not.toHaveBeenCalled();
    });

    it('uses affinity worktree for resumed task', () => {
      mockPoolManager.findByTask.mockReturnValue(undefined);
      mockPoolManager.selectByAffinity.mockReturnValue(affinityWorktree);

      service.allocate('repo', 'thread-1', { taskId: 'task-A' });

      expect(mockPoolManager.claim).toHaveBeenCalledWith(
        affinityWorktree,
        'task-A',
        'thread-1'
      );
    });

    it('uses LRU worktree for new task', () => {
      mockPoolManager.findByTask.mockReturnValue(undefined);
      mockPoolManager.selectByAffinity.mockReturnValue(undefined);
      mockPoolManager.getAvailable.mockReturnValue([lruWorktree]);

      service.allocate('repo', 'thread-1', { taskId: 'task-NEW' });

      expect(mockPoolManager.claim).toHaveBeenCalledWith(
        lruWorktree,
        'task-NEW',
        'thread-1'
      );
    });

    it('creates worktree when none available', () => {
      mockPoolManager.findByTask.mockReturnValue(undefined);
      mockPoolManager.selectByAffinity.mockReturnValue(undefined);
      mockPoolManager.getAvailable.mockReturnValue([]);
      mockPoolManager.create.mockReturnValue(newWorktree);

      service.allocate('repo', 'thread-1', { taskId: 'task-1' });

      expect(mockPoolManager.create).toHaveBeenCalled();
      expect(mockPoolManager.claim).toHaveBeenCalledWith(
        newWorktree,
        'task-1',
        'thread-1'
      );
    });
  });

  describe('error handling', () => {
    it('releases claim on failure', () => {
      mockBranchManager.ensureBranch.mockImplementation(() => {
        throw new Error('Checkout failed');
      });

      expect(() =>
        service.allocate('repo', 'thread-1', {
          taskId: 'task-1',
          taskBranch: 'task/foo',
        })
      ).toThrow('Checkout failed');

      expect(mockPoolManager.releaseThread).toHaveBeenCalled();
    });
  });
});

describe('release', () => {
  it('delegates to poolManager.releaseThread', () => {
    mockPoolManager.findByThread.mockReturnValue(worktree);

    service.release('repo', 'thread-1');

    expect(mockPoolManager.releaseThread).toHaveBeenCalledWith(worktree, 'thread-1');
    expect(mockSettingsService.save).toHaveBeenCalled();
  });

  it('no-ops when thread not found', () => {
    mockPoolManager.findByThread.mockReturnValue(undefined);

    service.release('repo', 'thread-unknown');

    expect(mockPoolManager.releaseThread).not.toHaveBeenCalled();
  });
});
```

## Verification

```bash
# TypeScript compilation
pnpm typecheck

# Run all worktree service tests
pnpm test core/services/worktree/
```

## Key Changes Summary

| Before | After |
|--------|-------|
| Merge base computed against `HEAD` | Merge base computed against `origin/{defaultBranch}` |
| Single `threadId` in claim | Array of `threadIds` in claim |
| Monolithic claiming logic | Delegated to `WorktreePoolManager` |
| Inline branch operations | Delegated to `BranchManager` |
| No task affinity | Task affinity via `lastTaskId` |

## Architecture After Refactor

```
AllocationService (thin orchestration)
    │
    ├── claimWorktree() ───► WorktreePoolManager
    │                           ├── findByTask()
    │                           ├── selectByAffinity()
    │                           ├── getAvailable()
    │                           ├── claim()
    │                           └── releaseThread()
    │
    ├── ensureBranch() ────► BranchManager
    │                           ├── isOnBranch()
    │                           └── ensureBranch()
    │
    └── persistence ───────► SettingsService
                               ├── load() + migration
                               └── save()
```

## Notes

- This is the integration point - all previous plans must be complete
- The refactor makes AllocationService much more testable
- Each delegated service can be mocked independently
- The fix for merge base computation is in the `allocate()` method
