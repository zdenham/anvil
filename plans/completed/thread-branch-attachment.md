# Plan: Thread Branch Attachment on Initialization

## Problem Statement

When a thread is spawned, the worktree is checked out at a **detached HEAD** (merge base). The execution agent commits on this detached HEAD, but never updates the task branch. When the merge agent later runs, it finds no new commits on the task branch because the work was orphaned on a detached HEAD.

### Evidence from Bug Investigation

```
mortician-3: b202ed9 (detached HEAD)  <-- Has the commit!
mortician-5: d409588 (detached HEAD)  <-- Merge agent couldn't find it
task branch: 7c4a7f1                  <-- Never updated
```

The commit `b202ed9` was made on detached HEAD in `mortician-3` but the task branch was never updated to point to it.

### Additional Bug: Stale Merge Base

The current merge base computation is broken:

```typescript
// Current code - WRONG!
const mergeBase = this.mergeBaseService.compute(settings.sourcePath, 'HEAD');
// This calls: getMergeBase('HEAD', 'HEAD') → just returns HEAD, not a merge base!
```

**Two issues:**
1. Computing `getMergeBase(HEAD, HEAD)` returns HEAD itself - not useful
2. Even if fixed to use "main", the local main branch might be behind `origin/main`

## Desired Behavior

On thread spawn, **programmatically** (not agent-instructed):

1. **Fresh merge base:** Compute merge base against `origin/{defaultBranch}` to ensure we start from the latest remote state

2. **Task-level worktree affinity:** All threads for the same task should prefer the same worktree
   - Only **new tasks** get round-robin worktree allocation
   - Subsequent threads reuse the task's established worktree

3. **Non-exclusive claiming:** Multiple threads on the same task can work in the same worktree concurrently
   - Claims track **all** active threads, not just one
   - Worktree is only "available" when ALL threads have released it

4. **If task branch does NOT exist:**
   - Fetch from origin to get latest refs
   - Compute merge base against `origin/{defaultBranch}`
   - Checkout at merge base (detached HEAD)
   - Create the task branch at current HEAD

5. **If task branch DOES exist:**
   - Checkout the task branch (not detached HEAD)

This ensures:
- All commits go onto the branch, not orphaned on detached HEAD
- Multiple threads for the same task work in the same worktree (see each other's changes)
- Merge base is always up-to-date with the remote
- Avoids "branch already checked out in another worktree" errors

---

## Current Flow

```
orchestrate()
  └─ allocationService.allocate(repoName, threadId)
       └─ claimOrCreateWorktree()
       └─ checkoutCommit(worktree.path, mergeBase)  // Always detached HEAD!
```

**File:** `core/services/worktree/allocation-service.ts:71-78`

```typescript
const mergeBase = this.mergeBaseService.compute(settings.sourcePath, 'HEAD');
// BUG: This computes getMergeBase(HEAD, HEAD) → returns HEAD itself!
this.git.checkoutCommit(worktree.path, mergeBase);  // <-- Always detached HEAD
```

---

## Implementation Plan

### Step 0: Add `defaultBranch` to RepositorySettings

**File:** `src/entities/repositories/types.ts`

Add to `RepositorySettings`:

```typescript
export interface RepositorySettings {
  // ... existing fields ...

  /** Default branch name (e.g., "main", "master") */
  defaultBranch: string;
}
```

**Detection logic** (when repository is registered):

```typescript
function detectDefaultBranch(repoPath: string): string {
  try {
    // Try to get the default branch from origin
    const result = this.exec(
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      repoPath
    );
    // Returns "origin/main" or "origin/master" - extract branch name
    return result.trim().replace('origin/', '');
  } catch {
    // Fallback: check if common branches exist
    for (const branch of ['main', 'master']) {
      try {
        this.exec(['rev-parse', '--verify', `refs/heads/${branch}`], repoPath);
        return branch;
      } catch {
        continue;
      }
    }
    // Ultimate fallback
    return 'main';
  }
}
```

This should be called when a repository is registered, storing the detected branch in settings.

### Step 1: Add Git Methods to GitAdapter

**File:** `core/adapters/types.ts`

Add to `GitAdapter` interface:

```typescript
/**
 * Fetch from a remote to update refs.
 * @param repoPath - Path to the repository
 * @param remote - Remote name (default: "origin")
 */
fetch(repoPath: string, remote?: string): void;

/**
 * Check if a branch exists in the repository.
 * @param repoPath - Path to the repository
 * @param branch - Branch name to check
 * @returns true if branch exists, false otherwise
 */
branchExists(repoPath: string, branch: string): boolean;

/**
 * Create a new branch at the current HEAD or specified commit.
 * @param worktreePath - Path to the worktree
 * @param branch - Branch name to create
 * @param startPoint - Optional commit/branch to start from (defaults to HEAD)
 * @throws If branch already exists or creation fails
 */
createBranch(worktreePath: string, branch: string, startPoint?: string): void;

/**
 * Checkout a branch (attaches HEAD to the branch).
 * @param worktreePath - Path to the worktree
 * @param branch - Branch name to checkout
 * @throws If branch doesn't exist or checkout fails
 */
checkoutBranch(worktreePath: string, branch: string): void;

/**
 * Get the current branch name, or null if in detached HEAD state.
 * @param worktreePath - Path to the worktree
 * @returns Branch name or null if detached
 */
getCurrentBranch(worktreePath: string): string | null;
```

**File:** `core/adapters/node/git-adapter.ts`

```typescript
fetch(repoPath: string, remote: string = 'origin'): void {
  this.exec(['fetch', remote], repoPath);
}

branchExists(repoPath: string, branch: string): boolean {
  try {
    this.exec(['rev-parse', '--verify', `refs/heads/${branch}`], repoPath);
    return true;
  } catch {
    return false;
  }
}

createBranch(worktreePath: string, branch: string, startPoint?: string): void {
  const args = ['branch', branch];
  if (startPoint) {
    args.push(startPoint);
  }
  this.exec(args, worktreePath);
}

checkoutBranch(worktreePath: string, branch: string): void {
  this.exec(['checkout', branch], worktreePath);
}

getCurrentBranch(worktreePath: string): string | null {
  try {
    const result = this.exec(['symbolic-ref', '--short', 'HEAD'], worktreePath);
    return result.trim();
  } catch {
    // Detached HEAD state
    return null;
  }
}
```

### Step 2: Change `WorktreeClaim` to Support Multiple Threads

**File:** `src/entities/repositories/types.ts`

Change `WorktreeClaim` to track multiple threads:

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

And add `lastTaskId` to `WorktreeState`:

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

**Key change:** `threadIds: string[]` instead of `threadId: string` - multiple threads can share.

This allows us to:
- Remember which task last used a worktree (for affinity)
- Allow multiple threads on the same task to work concurrently in the same worktree

#### Migration Strategy

The schema change from `threadId: string` to `threadIds: string[]` requires migration of existing `settings.json` files.

**File:** `core/services/worktree/settings-service.ts` (or migration utility)

```typescript
function migrateWorktreeClaim(claim: unknown): WorktreeClaim | null {
  if (!claim || typeof claim !== 'object') {
    return null;
  }

  const c = claim as Record<string, unknown>;

  // Already migrated (has threadIds array)
  if (Array.isArray(c.threadIds)) {
    return claim as WorktreeClaim;
  }

  // Old format (has threadId string) - migrate
  if (typeof c.threadId === 'string') {
    return {
      taskId: c.taskId as string,
      threadIds: [c.threadId],
      claimedAt: c.claimedAt as number,
    };
  }

  return null;
}

function migrateSettings(settings: unknown): RepositorySettings {
  const s = settings as RepositorySettings;

  // Migrate each worktree's claim
  for (const worktree of s.worktrees) {
    worktree.claim = migrateWorktreeClaim(worktree.claim);
  }

  // Add defaultBranch if missing
  if (!s.defaultBranch) {
    s.defaultBranch = 'main'; // Will be properly detected on next registration
  }

  return s;
}
```

Call `migrateSettings()` in the `load()` method of the settings service before returning.

### Step 3: Extract Service Classes and Refactor Allocation

This step creates the single-responsibility service classes and refactors `AllocationService` to be a thin orchestration layer.

#### 3a: Create `BranchManager`

**File:** `core/services/worktree/branch-manager.ts`

Handles branch checkout and creation:

```typescript
import { GitAdapter } from '../../adapters/types';

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
    // Skip if already on target branch
    if (this.isOnBranch(worktreePath, branch)) {
      return;
    }

    // Checkout merge base first (clean state)
    this.git.checkoutCommit(worktreePath, mergeBase);

    // Create or checkout branch
    if (this.git.branchExists(sourcePath, branch)) {
      this.git.checkoutBranch(worktreePath, branch);
    } else {
      this.git.createBranch(worktreePath, branch);
      this.git.checkoutBranch(worktreePath, branch);
    }
  }
}
```

#### 3b: Create `WorktreePoolManager`

**File:** `core/services/worktree/worktree-pool-manager.ts`

Handles worktree pool management, selection, and claims (locking):

```typescript
import { WorktreeState, RepositorySettings } from '../../../src/entities/repositories/types';
import { GitAdapter } from '../../adapters/types';

export class WorktreePoolManager {
  constructor(private git: GitAdapter) {}

  // ─────────────────────────────────────────────────────────────
  // Selection
  // ─────────────────────────────────────────────────────────────

  /**
   * Find worktree claimed by a specific task.
   */
  findByTask(settings: RepositorySettings, taskId: string): WorktreeState | undefined {
    return settings.worktrees.find((w) => w.claim?.taskId === taskId);
  }

  /**
   * Find worktree claimed by a specific thread.
   */
  findByThread(settings: RepositorySettings, threadId: string): WorktreeState | undefined {
    return settings.worktrees.find((w) => w.claim?.threadIds.includes(threadId));
  }

  /**
   * Find unclaimed worktree with affinity for a specific task.
   */
  selectByAffinity(settings: RepositorySettings, taskId: string): WorktreeState | undefined {
    return settings.worktrees.find((w) => !w.claim && w.lastTaskId === taskId);
  }

  /**
   * Get available worktrees sorted by LRU (oldest released first).
   */
  getAvailable(settings: RepositorySettings): WorktreeState[] {
    return settings.worktrees
      .filter((w) => !w.claim)
      .sort((a, b) => (a.lastReleasedAt ?? 0) - (b.lastReleasedAt ?? 0));
  }

  // ─────────────────────────────────────────────────────────────
  // Claims (Locking)
  // ─────────────────────────────────────────────────────────────

  /**
   * Add a thread to an existing claim (for concurrent access).
   */
  addThreadToClaim(worktree: WorktreeState, threadId: string): void {
    if (worktree.claim && !worktree.claim.threadIds.includes(threadId)) {
      worktree.claim.threadIds.push(threadId);
    }
  }

  /**
   * Create a new claim on a worktree.
   */
  claim(worktree: WorktreeState, taskId: string, threadId: string): void {
    worktree.claim = {
      taskId,
      threadIds: [threadId],
      claimedAt: Date.now(),
    };
  }

  /**
   * Release a thread from a claim. Returns true if worktree is now fully released.
   */
  releaseThread(worktree: WorktreeState, threadId: string): boolean {
    if (!worktree.claim) return false;

    worktree.claim.threadIds = worktree.claim.threadIds.filter((id) => id !== threadId);

    if (worktree.claim.threadIds.length === 0) {
      worktree.lastTaskId = worktree.claim.taskId;
      worktree.claim = null;
      worktree.lastReleasedAt = Date.now();
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // Pool Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new worktree and add it to settings.
   */
  create(repoName: string, settings: RepositorySettings): WorktreeState {
    const index = settings.worktrees.length + 1;
    const worktreePath = this.getWorktreePath(repoName, index);

    this.git.createWorktree(settings.sourcePath, worktreePath);

    const worktree: WorktreeState = {
      path: worktreePath,
      version: 1,
      currentBranch: null,
      claim: null,
    };

    settings.worktrees.push(worktree);
    return worktree;
  }

  private getWorktreePath(repoName: string, index: number): string {
    // Implementation depends on your path conventions
    return `${process.env.HOME}/.mort-dev/repositories/${repoName}/worktrees/worktree-${index}`;
  }
}
```

#### 3c: Refactor `AllocationService`

**File:** `core/services/worktree/allocation-service.ts`

Refactor to thin orchestration layer:

```typescript
import { BranchManager } from './branch-manager';
import { WorktreePoolManager } from './worktree-pool-manager';

export interface AllocateOptions {
  taskId?: string;
  taskBranch?: string;
}

export class AllocationService {
  constructor(
    private git: GitAdapter,
    private settingsService: SettingsService,
    private mergeBaseService: MergeBaseService,
    private branchManager: BranchManager,
    private poolManager: WorktreePoolManager,
    private logger: Logger
  ) {}

  allocate(repoName: string, threadId: string, options?: AllocateOptions): WorktreeAllocation {
    const lockPath = this.getLockPath(repoName);

    return this.withLock(lockPath, () => {
      const settings = this.settingsService.load(repoName);

      // 1. Get or claim a worktree
      const worktree = this.claimWorktree(repoName, settings, threadId, options?.taskId);

      try {
        // 2. Fetch latest refs (non-fatal)
        this.safeFetch(settings.sourcePath);

        // 3. Compute merge base against origin's default branch
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
          this.git.checkoutCommit(worktree.path, mergeBase);
        }

        this.settingsService.save(repoName, settings);
        return { worktree, mergeBase };
      } catch (err) {
        this.release(repoName, threadId);
        throw err;
      }
    });
  }

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

  private claimWorktree(
    repoName: string,
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
      worktree = this.poolManager.create(repoName, settings);
    }

    this.poolManager.claim(worktree, taskId ?? 'unknown', threadId);
    return worktree;
  }

  private safeFetch(sourcePath: string): void {
    try {
      this.git.fetch(sourcePath);
    } catch (err) {
      this.logger.warn('Failed to fetch from origin, using local refs', { error: err });
    }
  }
}
```

**Key changes:**
- `AllocationService` is now a thin coordinator
- Pool management and claims handled by `WorktreePoolManager`
- Branch logic delegated to `BranchManager`
- Merge base computed against `origin/{defaultBranch}` (not `HEAD`)

---

### Step 4: Update Orchestration to Pass Task Info

**File:** `agents/src/orchestration.ts`

```typescript
// Read task metadata - frontend already created draft on disk
const taskMeta = taskMetadataService.get(args.taskSlug);
const repoName = taskMeta.repositoryName;

if (!repoName) {
  throw new Error(`Task ${args.taskSlug} has no repositoryName`);
}

// Allocate worktree with task affinity and branch attachment
const allocation = allocationService.allocate(repoName, args.threadId, {
  taskId: taskMeta.id,              // <-- For worktree affinity
  taskBranch: taskMeta.branchName,  // <-- For branch checkout/creation
});
```

### Step 5: Update Tests

**File:** `core/services/worktree/allocation-service.test.ts`

Add test cases for fresh merge base:

```typescript
describe('merge base computation', () => {
  it('fetches from origin before computing merge base', () => {
    service.allocate('repo', 'thread-1', { taskId: 'task-1' });

    expect(mockGit.fetch).toHaveBeenCalledWith(sourcePath);
    expect(mockMergeBaseService.compute).toHaveBeenCalledWith(
      sourcePath,
      'origin/main'  // NOT 'HEAD'!
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

    // Should not throw - fetch failure is non-fatal
    const result = service.allocate('repo', 'thread-1', { taskId: 'task-1' });

    expect(result.worktree).toBeDefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to fetch from origin, using local refs',
      expect.anything()
    );
  });
});

describe('checkout optimization', () => {
  it('skips checkout when already on target branch', () => {
    // Worktree is already claimed by same task and on the branch
    mockSettings.worktrees = [
      { path: '/wt-1', claim: { taskId: 'task-A', threadIds: ['thread-1'], claimedAt: 1000 } },
    ];
    mockGit.getCurrentBranch.mockReturnValue('task/foo');

    service.allocate('repo', 'thread-2', { taskId: 'task-A', taskBranch: 'task/foo' });

    // Should NOT call checkoutCommit or checkoutBranch
    expect(mockGit.checkoutCommit).not.toHaveBeenCalled();
    expect(mockGit.checkoutBranch).not.toHaveBeenCalled();
    expect(mockGit.createBranch).not.toHaveBeenCalled();
  });

  it('performs checkout when on different branch', () => {
    mockGit.getCurrentBranch.mockReturnValue('task/other');
    mockGit.branchExists.mockReturnValue(true);

    service.allocate('repo', 'thread-1', { taskId: 'task-1', taskBranch: 'task/foo' });

    expect(mockGit.checkoutCommit).toHaveBeenCalled();
    expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
  });

  it('performs checkout when in detached HEAD', () => {
    mockGit.getCurrentBranch.mockReturnValue(null); // detached HEAD
    mockGit.branchExists.mockReturnValue(true);

    service.allocate('repo', 'thread-1', { taskId: 'task-1', taskBranch: 'task/foo' });

    expect(mockGit.checkoutCommit).toHaveBeenCalled();
    expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
  });
});
```

Add test cases for task affinity with multi-thread claims:

```typescript
describe('task affinity', () => {
  it('adds thread to existing task claim (concurrent access)', () => {
    // Setup: worktree-1 is claimed by task-A with thread-1
    mockSettings.worktrees = [
      { path: '/wt-1', claim: { taskId: 'task-A', threadIds: ['thread-1'], claimedAt: 1000 } },
      { path: '/wt-2', claim: null },
    ];

    // Allocate for task-A, thread-2
    service.allocate('repo', 'thread-2', { taskId: 'task-A' });

    // Should ADD thread-2 to existing claim, not replace
    expect(mockSettings.worktrees[0].claim?.threadIds).toEqual(['thread-1', 'thread-2']);
    expect(mockSettings.worktrees[0].claim?.taskId).toBe('task-A');
  });

  it('prefers worktree last used by same task', () => {
    // Setup: worktree-1 was last used by task-A
    mockSettings.worktrees = [
      { path: '/wt-1', claim: null, lastTaskId: 'task-A', lastReleasedAt: 1000 },
      { path: '/wt-2', claim: null, lastReleasedAt: 2000 },  // More recent but different task
    ];

    service.allocate('repo', 'thread-1', { taskId: 'task-A' });

    // Should prefer wt-1 due to task affinity
    expect(mockSettings.worktrees[0].claim?.threadIds).toEqual(['thread-1']);
  });

  it('falls back to LRU for new tasks', () => {
    mockSettings.worktrees = [
      { path: '/wt-1', claim: null, lastTaskId: 'task-A', lastReleasedAt: 2000 },
      { path: '/wt-2', claim: null, lastTaskId: 'task-B', lastReleasedAt: 1000 },  // Older
    ];

    service.allocate('repo', 'thread-1', { taskId: 'task-NEW' });

    // Should use LRU (wt-2) since no affinity match
    expect(mockSettings.worktrees[1].claim?.threadIds).toEqual(['thread-1']);
  });
});
```

Add test cases for multi-thread release:

```typescript
describe('multi-thread release', () => {
  it('removes thread from claim but keeps worktree claimed', () => {
    mockSettings.worktrees = [
      { path: '/wt-1', claim: { taskId: 'task-A', threadIds: ['thread-1', 'thread-2'], claimedAt: 1000 } },
    ];

    service.release('repo', 'thread-1');

    // Claim should remain with just thread-2
    expect(mockSettings.worktrees[0].claim?.threadIds).toEqual(['thread-2']);
    expect(mockSettings.worktrees[0].claim?.taskId).toBe('task-A');
    expect(mockSettings.worktrees[0].lastReleasedAt).toBeUndefined();
  });

  it('releases worktree when last thread exits', () => {
    mockSettings.worktrees = [
      { path: '/wt-1', claim: { taskId: 'task-A', threadIds: ['thread-1'], claimedAt: 1000 } },
    ];

    service.release('repo', 'thread-1');

    expect(mockSettings.worktrees[0].claim).toBeNull();
    expect(mockSettings.worktrees[0].lastTaskId).toBe('task-A');
    expect(mockSettings.worktrees[0].lastReleasedAt).toBeDefined();
  });
});
```

Add test cases for branch attachment:

```typescript
describe('branch attachment', () => {
  it('creates branch if it does not exist', () => {
    mockGit.branchExists.mockReturnValue(false);

    service.allocate('repo', 'thread-1', { taskId: 'task-1', taskBranch: 'task/foo' });

    expect(mockGit.fetch).toHaveBeenCalledWith(sourcePath);
    expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, 'abc123');
    expect(mockGit.branchExists).toHaveBeenCalledWith(sourcePath, 'task/foo');
    expect(mockGit.createBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
    expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
  });

  it('checks out existing branch', () => {
    mockGit.branchExists.mockReturnValue(true);

    service.allocate('repo', 'thread-1', { taskId: 'task-1', taskBranch: 'task/foo' });

    expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, 'abc123');
    expect(mockGit.branchExists).toHaveBeenCalledWith(sourcePath, 'task/foo');
    expect(mockGit.createBranch).not.toHaveBeenCalled();
    expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
  });

  it('works without taskBranch (detached HEAD)', () => {
    service.allocate('repo', 'thread-1', { taskId: 'task-1' });

    expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, 'abc123');
    expect(mockGit.branchExists).not.toHaveBeenCalled();
    expect(mockGit.createBranch).not.toHaveBeenCalled();
    expect(mockGit.checkoutBranch).not.toHaveBeenCalled();
  });
});
```

**File:** `core/adapters/node/git-adapter.test.ts`

Add test cases for new methods:

```typescript
describe('fetch', () => {
  it('fetches from origin by default', () => {
    adapter.fetch(repoPath);
    expect(execSpy).toHaveBeenCalledWith('git', ['fetch', 'origin'], expect.anything());
  });

  it('fetches from specified remote', () => {
    adapter.fetch(repoPath, 'upstream');
    expect(execSpy).toHaveBeenCalledWith('git', ['fetch', 'upstream'], expect.anything());
  });
});

describe('branchExists', () => {
  it('returns true for existing branch', () => {
    execSpy.mockReturnValue({ status: 0, stdout: 'abc123' });
    expect(adapter.branchExists(repoPath, 'main')).toBe(true);
  });

  it('returns false for non-existent branch', () => {
    execSpy.mockImplementation(() => { throw new Error('not found'); });
    expect(adapter.branchExists(repoPath, 'nonexistent')).toBe(false);
  });
});

describe('createBranch', () => {
  it('creates branch at HEAD', () => {
    adapter.createBranch(worktreePath, 'feature/foo');
    expect(execSpy).toHaveBeenCalledWith('git', ['branch', 'feature/foo'], expect.anything());
  });

  it('creates branch at specified commit', () => {
    adapter.createBranch(worktreePath, 'feature/foo', 'abc123');
    expect(execSpy).toHaveBeenCalledWith('git', ['branch', 'feature/foo', 'abc123'], expect.anything());
  });
});

describe('checkoutBranch', () => {
  it('checks out the specified branch', () => {
    adapter.checkoutBranch(worktreePath, 'feature/foo');
    expect(execSpy).toHaveBeenCalledWith('git', ['checkout', 'feature/foo'], expect.anything());
  });
});

describe('getCurrentBranch', () => {
  it('returns branch name when on a branch', () => {
    execSpy.mockReturnValue({ status: 0, stdout: 'main\n' });
    expect(adapter.getCurrentBranch(worktreePath)).toBe('main');
  });

  it('returns null when in detached HEAD state', () => {
    execSpy.mockImplementation(() => {
      throw new Error('fatal: ref HEAD is not a symbolic ref');
    });
    expect(adapter.getCurrentBranch(worktreePath)).toBeNull();
  });
});
```

---

## Architecture: Single Responsibility Classes

The allocation service has grown complex and must be refactored into focused, single-responsibility classes:

### Current Structure (Monolithic)

```
AllocationService
  ├── claimOrCreateWorktree()    // Worktree claiming logic
  ├── releaseWorktreeClaim()     // Worktree release logic
  ├── createWorktree()           // Worktree creation
  ├── allocate()                 // Orchestration + git operations
  └── withLock()                 // File locking
```

### Proposed Structure (Single Responsibility)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AllocationService                                │
│  Orchestrates worktree allocation. Thin coordination layer.              │
│  - allocate(repoName, threadId, options): WorktreeAllocation            │
│  - release(repoName, threadId): void                                    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ delegates to
                ┌───────────────┴───────────────┐
                ▼                               ▼
┌───────────────────────────────┐  ┌───────────────────────────────────────┐
│       BranchManager           │  │       WorktreePoolManager             │
│                               │  │                                       │
│ Handles branch checkout/      │  │ Manages worktree pool + claims        │
│ creation                      │  │ (selection & locking)                 │
│                               │  │                                       │
│ - ensureBranch()              │  │ Selection:                            │
│ - isOnBranch()                │  │ - findByTask(), findByThread()        │
│                               │  │ - selectByAffinity(), getAvailable()  │
│                               │  │                                       │
│                               │  │ Claims (Locking):                     │
│                               │  │ - claim(), releaseThread()            │
│                               │  │ - addThreadToClaim()                  │
│                               │  │                                       │
│                               │  │ Pool:                                 │
│                               │  │ - create()                            │
└───────────────────────────────┘  └───────────────────────────────────────┘
```

### Class Responsibilities

| Class | Responsibility | Methods |
|-------|----------------|---------|
| **AllocationService** | Orchestrates allocation workflow | `allocate()`, `release()` |
| **BranchManager** | Ensures worktree is on correct branch | `ensureBranch()`, `isOnBranch()` |
| **WorktreePoolManager** | Manages pool + claims (locking) | `findByTask()`, `findByThread()`, `selectByAffinity()`, `getAvailable()`, `claim()`, `releaseThread()`, `addThreadToClaim()`, `create()` |
| **SettingsService** | Persists repository settings | `load()`, `save()`, `migrate()` |
| **GitAdapter** | Low-level git operations | `fetch()`, `checkoutBranch()`, `createBranch()`, etc. |

### Refactored `allocate()` Flow

```typescript
// AllocationService - thin orchestration layer
allocate(repoName: string, threadId: string, options?: AllocateOptions): WorktreeAllocation {
  return this.withLock(repoName, () => {
    const settings = this.settingsService.load(repoName);

    // 1. Get or claim a worktree (poolManager handles selection + locking)
    const worktree = this.claimWorktree(repoName, settings, threadId, options?.taskId);

    // 2. Fetch latest refs (non-fatal)
    this.safeFetch(settings.sourcePath);

    // 3. Compute merge base
    const mergeBase = this.mergeBaseService.compute(
      settings.sourcePath,
      `origin/${settings.defaultBranch}`
    );

    // 4. Ensure correct branch
    if (options?.taskBranch) {
      this.branchManager.ensureBranch(worktree.path, options.taskBranch, settings.sourcePath, mergeBase);
    } else {
      this.git.checkoutCommit(worktree.path, mergeBase);
    }

    this.settingsService.save(repoName, settings);
    return { worktree, mergeBase };
  });
}
```

### Implementation Note

This refactoring is **required** as part of this task. The single-responsibility structure improves testability, makes the code easier to reason about, and prevents the allocation service from becoming a monolithic "god class" as more features are added.

The implementation steps should create these classes as part of the work, not as a follow-up.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/entities/repositories/types.ts` | Add `defaultBranch` to `RepositorySettings`, change `WorktreeClaim` to use `threadIds[]`, add `lastTaskId` to `WorktreeState` |
| `core/adapters/types.ts` | Add `fetch`, `branchExists`, `createBranch`, `checkoutBranch`, `getCurrentBranch` to `GitAdapter` interface |
| `core/adapters/node/git-adapter.ts` | Implement `fetch`, `branchExists`, `createBranch`, `checkoutBranch`, `getCurrentBranch` |
| `core/services/worktree/allocation-service.ts` | Refactor to thin orchestration layer that delegates to the new service classes below |
| `core/services/worktree/branch-manager.ts` | **NEW:** Extract branch logic - `ensureBranch()`, `isOnBranch()` |
| `core/services/worktree/worktree-pool-manager.ts` | **NEW:** Extract pool + claim logic - `getAvailable()`, `create()`, `selectByAffinity()`, `claim()`, `releaseThread()`, `findByTask()`, `findByThread()` |
| `core/services/worktree/settings-service.ts` | Add migration for `threadId` → `threadIds[]` schema change |
| `agents/src/orchestration.ts` | Pass `taskId` and `taskBranch` to `allocate()` |
| `core/adapters/node/git-adapter.test.ts` | Add tests for `fetch`, `branchExists`, `createBranch`, `checkoutBranch`, `getCurrentBranch` |
| `core/services/worktree/allocation-service.test.ts` | Update tests to work with refactored service |
| `core/services/worktree/branch-manager.test.ts` | **NEW:** Tests for branch logic - creation, checkout, optimization |
| `core/services/worktree/worktree-pool-manager.test.ts` | **NEW:** Tests for pool + claim logic - LRU selection, affinity matching, multi-thread claims |

---

## Edge Cases

1. **Fetch failures**: If `git fetch` fails (network issues, no remote):
   - The allocation should still proceed using local refs
   - Log a warning but don't fail the allocation
   - Consider: should we fall back to local `{defaultBranch}` instead of `origin/{defaultBranch}`?

2. **Branch name collisions**: If the task branch exists but points to a different history, the checkout will work (git will checkout the existing branch). This is correct behavior - subsequent threads should continue from where the previous left off.

3. **Multiple threads on same task (concurrent access)**: With the new multi-thread claim system:
   - Thread 2 allocating for the same task **adds** its ID to `threadIds[]`
   - Both threads work in the same worktree on the same branch
   - They may conflict on file writes (acceptable - agents should handle this gracefully)
   - Worktree is only released when **all** threads have released (array is empty)

4. **Resume flow**: When resuming a thread, the branch will already exist. The allocation will checkout the existing branch, preserving prior work.

5. **Task completion / worktree reuse**: When a task completes and its worktree is released:
   - `lastTaskId` is set to remember the affinity
   - If the task is reopened, it will prefer the same worktree
   - If a new task needs a worktree, LRU allocation picks the oldest released one

6. **Stale local refs**: By fetching from origin and computing merge base against `origin/{defaultBranch}`:
   - We always get the latest remote state
   - Even if local `main` is behind, we start from the right place

7. **Missing `defaultBranch` in settings**: During migration:
   - Default to "main" if not present
   - Consider auto-detecting from remote (e.g., `git remote show origin | grep 'HEAD branch'`)

8. **Thread crashes without release**: If a thread crashes:
   - Its ID remains in `threadIds[]`
   - Consider: add a TTL/heartbeat mechanism to clean up stale thread IDs?
   - For now: manual cleanup or release-all-for-task API

---

## Sequence Diagram

```
orchestrate()
    │
    ├─► taskMetadataService.get(taskSlug)
    │       └─► returns { id: "task-123", branchName: "task/add-hello-world" }
    │
    └─► allocationService.allocate(repoName, threadId, { taskId, taskBranch })
            │
            ├─► claimOrCreateWorktree(repoName, threadId, settings, taskId)
            │       │
            │       ├─► Priority 1: worktree claimed by same taskId?
            │       │       └─► YES: ADD threadId to claim.threadIds[], return
            │       │
            │       ├─► Priority 2: unclaimed worktree with lastTaskId match?
            │       │       └─► YES: create new claim with threadIds: [threadId], return
            │       │
            │       └─► Priority 3: LRU unclaimed worktree (for new tasks)
            │               └─► create new claim with threadIds: [threadId]
            │
            ├─► git.fetch(origin)  // Get latest refs from remote
            │
            ├─► mergeBase = compute(sourcePath, "origin/main")  // Fresh base!
            │
            ├─► checkoutCommit(mergeBase)  // Clean starting point at latest main
            │
            ├─► branchExists("task/add-hello-world")?
            │       │
            │       ├─► YES: checkoutBranch("task/add-hello-world")
            │       │
            │       └─► NO: createBranch("task/add-hello-world")
            │               checkoutBranch("task/add-hello-world")
            │
            └─► return { worktree, mergeBase }
```

### Release Flow

```
releaseWorktreeClaim(repoName, threadId)
    │
    ├─► Find worktree where claim.threadIds includes threadId
    │
    ├─► Remove threadId from claim.threadIds[]
    │
    └─► threadIds.length === 0?
            │
            ├─► YES: Release worktree
            │       ├─► worktree.lastTaskId = claim.taskId
            │       ├─► worktree.claim = null
            │       └─► worktree.lastReleasedAt = now
            │
            └─► NO: Keep worktree claimed (other threads still using it)
```

---

## Logic Flow Diagrams

### Complete Allocation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         allocate(repoName, threadId, options)               │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │   Acquire file lock on repo   │
                        └───────────────────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │  Load repository settings     │
                        └───────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     claimOrCreateWorktree(repoName, threadId, taskId)       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │   ┌─────────────────────────────────────────────────────────────┐     │  │
│  │   │  Priority 1: Existing claim for same task?                  │     │  │
│  │   │  worktrees.find(w => w.claim?.taskId === taskId)            │     │  │
│  │   └─────────────────────────────────────────────────────────────┘     │  │
│  │                          │                                            │  │
│  │            ┌─────────────┴─────────────┐                              │  │
│  │            ▼                           ▼                              │  │
│  │       [FOUND]                      [NOT FOUND]                        │  │
│  │            │                           │                              │  │
│  │            ▼                           ▼                              │  │
│  │   ┌─────────────────┐     ┌─────────────────────────────────────┐     │  │
│  │   │ ADD threadId to │     │  Priority 2: Unclaimed worktree     │     │  │
│  │   │ claim.threadIds │     │  with lastTaskId === taskId?        │     │  │
│  │   │ (concurrent     │     └─────────────────────────────────────┘     │  │
│  │   │  access)        │                    │                            │  │
│  │   └────────┬────────┘      ┌─────────────┴─────────────┐              │  │
│  │            │               ▼                           ▼              │  │
│  │            │          [FOUND]                      [NOT FOUND]        │  │
│  │            │               │                           │              │  │
│  │            │               ▼                           ▼              │  │
│  │            │      ┌─────────────────┐     ┌─────────────────────────┐ │  │
│  │            │      │ Create claim:   │     │  Priority 3: LRU        │ │  │
│  │            │      │ taskId: taskId  │     │  unclaimed worktree     │ │  │
│  │            │      │ threadIds:      │     │  (for NEW tasks)        │ │  │
│  │            │      │   [threadId]    │     └─────────────────────────┘ │  │
│  │            │      └────────┬────────┘                 │               │  │
│  │            │               │               ┌──────────┴──────────┐    │  │
│  │            │               │               ▼                     ▼    │  │
│  │            │               │          [FOUND]              [NOT FOUND]│  │
│  │            │               │               │                     │    │  │
│  │            │               │               │                     ▼    │  │
│  │            │               │               │       ┌─────────────────┐│  │
│  │            │               │               │       │ createWorktree()││  │
│  │            │               │               │       │ (add to pool)   ││  │
│  │            │               │               │       └────────┬────────┘│  │
│  │            │               │               │                │         │  │
│  │            │               │               ▼                ▼         │  │
│  │            │               │          ┌──────────────────────────┐    │  │
│  │            │               │          │ Create claim:            │    │  │
│  │            │               │          │ taskId: taskId ?? unknown│    │  │
│  │            │               │          │ threadIds: [threadId]    │    │  │
│  │            │               │          └────────────┬─────────────┘    │  │
│  │            │               │                       │                  │  │
│  │            ▼               ▼                       ▼                  │  │
│  │   ┌───────────────────────────────────────────────────────────────┐   │  │
│  │   │               Save settings & return worktree                 │   │  │
│  │   └───────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │    git.fetch(sourcePath)      │
                        │    (get latest remote refs)   │
                        └───────────────────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │  mergeBase = compute(         │
                        │    sourcePath,                │
                        │    "origin/{defaultBranch}"   │
                        │  )                            │
                        │  // FIX: Not "HEAD" anymore!  │
                        └───────────────────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │  checkoutCommit(worktree,     │
                        │                 mergeBase)    │
                        │  // Clean starting point      │
                        └───────────────────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │   options.taskBranch          │
                        │   provided?                   │
                        └───────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
                [YES]                                     [NO]
                    │                                       │
                    ▼                                       │
        ┌───────────────────────────┐                       │
        │  branchExists(taskBranch)?│                       │
        └───────────────────────────┘                       │
                    │                                       │
        ┌───────────┴───────────┐                           │
        ▼                       ▼                           │
    [EXISTS]               [NOT EXISTS]                     │
        │                       │                           │
        │                       ▼                           │
        │           ┌───────────────────────┐               │
        │           │ createBranch(         │               │
        │           │   worktree,           │               │
        │           │   taskBranch)         │               │
        │           │ // at current HEAD    │               │
        │           │ // (which is mergeBase│               │
        │           └───────────┬───────────┘               │
        │                       │                           │
        ▼                       ▼                           │
        ┌───────────────────────────────────┐               │
        │  checkoutBranch(worktree,         │               │
        │                 taskBranch)       │               │
        │  // Now on branch, not detached!  │               │
        └───────────────────┬───────────────┘               │
                            │                               │
                            ▼                               ▼
                        ┌───────────────────────────────────────┐
                        │  return { worktree, mergeBase }       │
                        │  // Worktree is ready for work        │
                        └───────────────────────────────────────┘
```

### Release Flow (Multi-Thread Aware)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   releaseWorktreeClaim(repoName, threadId)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │  Find worktree where          │
                        │  claim.threadIds.includes(    │
                        │    threadId                   │
                        │  )                            │
                        └───────────────────────────────┘
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
                    [FOUND]                        [NOT FOUND]
                        │                               │
                        ▼                               ▼
        ┌───────────────────────────────┐        ┌─────────────┐
        │  Remove threadId from         │        │   (no-op)   │
        │  claim.threadIds[]            │        └─────────────┘
        └───────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │  claim.threadIds.length === 0?│
        │  (all threads done?)          │
        └───────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
        [YES: LAST]            [NO: OTHERS]
            │                       │
            ▼                       ▼
┌───────────────────────────┐  ┌───────────────────────────┐
│  RELEASE WORKTREE:        │  │  KEEP CLAIMED:            │
│  • lastTaskId = taskId    │  │  • Save settings          │
│  • claim = null           │  │  • Worktree still in use  │
│  • lastReleasedAt = now   │  │    by other thread(s)     │
│  • Save settings          │  │                           │
└───────────────────────────┘  └───────────────────────────┘
```

### Before vs After: Commit Flow

```
BEFORE (Bug):
═══════════════════════════════════════════════════════════════════════

    main ──●──●──●──●                    task/foo branch (never updated)
                   │                              │
                   └── merge base ◄───────────────┘
                          │
                          ▼
            ┌─────────────────────────────┐
            │  Worktree: detached HEAD    │
            │  at merge base              │
            └─────────────────────────────┘
                          │
                          │ (agent commits)
                          ▼
                         ●──●──● ORPHANED COMMITS!
                                 (not on any branch)


AFTER (Fixed):
═══════════════════════════════════════════════════════════════════════

    origin/main ──●──●──●──●
                          │
                          └── merge base (from origin/main, not stale local)
                                 │
                                 ▼
            ┌─────────────────────────────┐
            │  1. Checkout merge base     │
            │  2. Create branch task/foo  │
            │  3. Checkout task/foo       │
            └─────────────────────────────┘
                          │
                          │ (agent commits)
                          ▼
    task/foo ──────────────●──●──● ON BRANCH!
                                  (merge agent can find these)
```

### State Transitions: WorktreeClaim

```
                              NEW TASK
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UNCLAIMED                                      │
│   claim: null                                                               │
│   lastTaskId: <previous task or undefined>                                  │
│   lastReleasedAt: <timestamp>                                               │
└─────────────────────────────────────────────────────────────────────────────┘
         │                                              ▲
         │ Thread-1 allocates                           │ Last thread releases
         │ for task-A                                   │ (threadIds becomes [])
         ▼                                              │
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLAIMED BY ONE THREAD                               │
│   claim: {                                                                  │
│     taskId: "task-A",                                                       │
│     threadIds: ["thread-1"],                                                │
│     claimedAt: 1704300000000                                                │
│   }                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
         │                                              ▲
         │ Thread-2 allocates                           │ Thread-2 releases
         │ for same task-A                              │ (removed from array)
         ▼                                              │
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLAIMED BY MULTIPLE THREADS                           │
│   claim: {                                                                  │
│     taskId: "task-A",                                                       │
│     threadIds: ["thread-1", "thread-2"],  ◄── Both working concurrently    │
│     claimedAt: 1704300000000                                                │
│   }                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Verification

After implementation, verify with:

```bash
# 1. Verify fresh merge base from origin/main
# Before: Check origin/main is ahead of local main
git -C /path/to/source/repo fetch origin
git log --oneline main..origin/main  # Shows commits we're missing locally

# Create a task and spawn thread
mort tasks create "test task" --slug test-branch-attach

# The worktree should be at origin/main, not stale local HEAD
git -C ~/.mort-dev/repositories/mortician/worktrees/worktree-1 log -1 --oneline
# Should match origin/main, not local main

# 2. Check the worktree is on the branch (not detached HEAD)
git -C ~/.mort-dev/repositories/mortician/worktrees/worktree-1 status
# Should show: On branch task/test-branch-attach

# Make a commit via the agent, verify it's on the branch
git -C ~/.mort-dev/repositories/mortician log --oneline task/test-branch-attach
# Should show the new commit

# 3. Test multi-thread concurrent access
# Spawn two threads for the same task
# Both should be added to the same claim's threadIds[]
cat ~/.mort-dev/repositories/mortician/settings.json | jq '.worktrees[] | select(.claim.taskId != null)'
# Should show claim.threadIds: ["thread-1", "thread-2"]

# 4. Test partial release (one thread exits, worktree stays claimed)
# After thread-1 exits:
cat ~/.mort-dev/repositories/mortician/settings.json | jq '.worktrees[0].claim.threadIds'
# Should show ["thread-2"] (not null)

# 5. Test full release (last thread exits)
# After thread-2 exits:
cat ~/.mort-dev/repositories/mortician/settings.json | jq '.worktrees[0]'
# claim should be null, lastTaskId should be set

# 6. Test task affinity on re-open
# Spawn new thread for same task
# Should reuse the same worktree due to lastTaskId match
```
