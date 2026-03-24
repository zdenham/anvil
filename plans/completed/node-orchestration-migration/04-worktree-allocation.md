# Phase 4: Worktree Allocation Service

## Goal

Create the worktree allocation service that claims/releases worktrees for agent threads.

## Prerequisites

- [03a-settings-service.md](./03a-settings-service.md) complete
- [03b-merge-base-service.md](./03b-merge-base-service.md) complete
- [02b-git-adapter.md](./02b-git-adapter.md) complete
- [02c-path-lock.md](./02c-path-lock.md) complete

## Files to Create

- `core/services/worktree/allocation-service.ts`
- `core/services/worktree/allocation-service.test.ts`

## Types

```typescript
interface WorktreeAllocation {
  worktree: WorktreeState;
  mergeBase: string;
}
```

## Implementation

```typescript
// core/services/worktree/allocation-service.ts
import * as path from 'path';
import type { GitAdapter, PathLock, AcquireOptions } from '@core/adapters/types';
import type { RepositorySettingsService } from '../repository/settings-service';
import type { MergeBaseService } from '../git/merge-base-service';

// Default retry options for lock acquisition
const DEFAULT_LOCK_OPTIONS: AcquireOptions = {
  maxRetries: 5,
  retryDelayMs: 100,
};

export class WorktreeAllocationService {
  constructor(
    private anvilDir: string,
    private settingsService: RepositorySettingsService,
    private mergeBaseService: MergeBaseService,
    private git: GitAdapter,
    private pathLock: PathLock
  ) {}

  /**
   * Allocate a worktree for a thread.
   *
   * Concurrency behavior:
   * - Acquires repository-level lock with retry and exponential backoff
   * - Multiple concurrent allocations will queue via lock retry
   * - Claim is rolled back if checkout fails
   *
   * @throws Error if lock cannot be acquired after retries
   * @throws Error if checkout fails (claim is rolled back)
   */
  allocate(repoName: string, threadId: string): WorktreeAllocation {
    const lockPath = this.getLockPath(repoName);

    return this.withLock(lockPath, () => {
      const worktree = this.claimOrCreateWorktree(repoName, threadId);

      try {
        // Checkout at merge base - this can fail
        const settings = this.settingsService.load(repoName);
        const mergeBase = this.mergeBaseService.compute(
          settings.sourcePath,
          settings.defaultBranch
        );
        this.git.checkoutCommit(worktree.path, mergeBase);

        return { worktree, mergeBase };
      } catch (err) {
        // Rollback the claim on checkout failure
        this.releaseWorktreeClaim(repoName, threadId);
        throw err;
      }
    });
  }

  /**
   * Claim an existing worktree or create a new one.
   * Saves the claim to settings immediately.
   */
  private claimOrCreateWorktree(repoName: string, threadId: string): WorktreeState {
    const settings = this.settingsService.load(repoName);

    // Find available worktree or create new one
    let worktree = settings.worktrees.find(w => !w.claim);
    if (!worktree) {
      worktree = this.createWorktree(repoName, settings);
    }

    // Claim the worktree
    worktree.claim = {
      threadId,
      taskId: null,
      claimedAt: Date.now(),
    };
    this.settingsService.save(repoName, settings);

    return worktree;
  }

  /**
   * Release a worktree claim (used for rollback and normal release).
   * Safe to call even if no claim exists.
   */
  private releaseWorktreeClaim(repoName: string, threadId: string): void {
    const settings = this.settingsService.load(repoName);
    const worktree = settings.worktrees.find(w => w.claim?.threadId === threadId);

    if (worktree) {
      worktree.claim = null;
      this.settingsService.save(repoName, settings);
    }
  }

  /**
   * Release a worktree from a thread.
   *
   * Concurrency behavior:
   * - Acquires repository-level lock with retry
   * - Safe to call multiple times (idempotent)
   */
  release(repoName: string, threadId: string): void {
    const lockPath = this.getLockPath(repoName);

    this.withLock(lockPath, () => {
      this.releaseWorktreeClaim(repoName, threadId);
    });
  }

  /**
   * Get the worktree allocated to a specific thread.
   * Does not require lock - read-only operation on settings.
   */
  getForThread(repoName: string, threadId: string): WorktreeState | null {
    const settings = this.settingsService.load(repoName);
    return settings.worktrees.find(w => w.claim?.threadId === threadId) ?? null;
  }

  private createWorktree(repoName: string, settings: RepositorySettings): WorktreeState {
    const worktreeName = `worktree-${settings.worktrees.length + 1}`;
    const worktreePath = path.join(
      this.anvilDir,
      'repositories',
      repoName,
      'worktrees',
      worktreeName
    );

    // Create git worktree at detached HEAD
    const commit = this.git.getBranchCommit(settings.sourcePath, settings.defaultBranch);
    this.git.createWorktree(settings.sourcePath, worktreePath, { commit });

    // Add to settings
    const worktree: WorktreeState = {
      name: worktreeName,
      path: worktreePath,
      claim: null,
    };
    settings.worktrees.push(worktree);

    return worktree;
  }

  private getLockPath(repoName: string): string {
    return path.join(this.anvilDir, 'repositories', repoName, '.lock');
  }

  /**
   * Execute a function while holding a lock.
   * Uses retry with exponential backoff for lock acquisition.
   */
  private withLock<T>(lockPath: string, fn: () => T): T {
    this.pathLock.acquire(lockPath, DEFAULT_LOCK_OPTIONS);
    try {
      return fn();
    } finally {
      this.pathLock.release(lockPath);
    }
  }
}
```

## Error Handling and Rollback

### Claim Rollback Pattern

The allocation process has two phases that can fail:
1. Claiming a worktree (persists to settings)
2. Checking out at merge base (git operation)

If checkout fails after claim is persisted, we must rollback:

```
allocate():
  1. Acquire lock
  2. Claim worktree (saved to settings)
  3. Try checkout
     - Success: return allocation
     - Failure: rollback claim, re-throw error
  4. Release lock
```

This prevents orphaned claims when checkout fails due to:
- Network errors (fetching remote)
- Invalid merge base
- Corrupted git state
- Disk full

### Concurrent Allocation

Multiple agents may request allocation simultaneously:

```
Agent A                      Agent B
-------                      -------
acquire lock (success)
                             acquire lock (blocked, retrying)
claim worktree
checkout
release lock
                             acquire lock (success)
                             claim worktree
                             checkout
                             release lock
```

The retry-enabled PathLock ensures:
- No immediate failures on contention
- Exponential backoff prevents thundering herd
- Configurable timeout via options

## Tasks

1. Implement WorktreeAllocationService class
2. Compose with RepositorySettingsService, MergeBaseService, GitAdapter, PathLock
3. Implement allocate, release, getForThread methods
4. **Implement rollback pattern for failed checkout**
5. **Use retry-enabled lock acquisition**
6. Create new worktrees on-demand when none available
7. Write unit tests with mocked dependencies
8. Write integration tests with real git repo

## Test Cases

### Unit Tests (mocked dependencies)
- allocate claims existing available worktree
- allocate creates new worktree when none available
- allocate checks out at merge base
- **allocate rolls back claim if checkout fails**
- release unclaims worktree
- release handles non-existent claim gracefully
- getForThread returns claimed worktree
- getForThread returns null when not found
- Lock is acquired before and released after operations
- **Lock retry succeeds when holder releases**

### Integration Tests
- Full allocate/release cycle with real git
- Concurrent allocation attempts (lock contention)
- Multiple worktrees created as needed
- **Rollback on checkout failure leaves no orphaned claim**

## Locking Strategy

- File-based lock at `~/.anvil/repositories/{repoName}/.lock`
- 30-second stale TTL
- **Retry with exponential backoff (5 attempts, 100ms base delay)**
- Lock acquired for both allocate and release
- Prevents race conditions when multiple agents start

## Single Responsibility

This service ONLY:
- Allocates worktrees to threads
- Releases worktrees from threads
- Creates new worktrees when needed
- Looks up worktrees by thread
- **Handles rollback on allocation failure**

It does NOT:
- Manage task metadata
- Create thread entities
- Handle agent orchestration

## Verification

- [ ] All tests pass
- [ ] No async/await used
- [ ] Locking prevents race conditions
- [ ] **Lock retry handles concurrent access**
- [ ] **Rollback prevents orphaned claims on failure**
- [ ] Service composes single-responsibility services
