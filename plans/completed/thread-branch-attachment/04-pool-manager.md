# Plan 04: WorktreePoolManager Service

**Phase:** 2 (Service Classes)
**Depends on:** `01-types-and-schema.md`
**Parallelizable with:** `03-branch-manager.md`, `05-settings-migration.md`
**Blocks:** `06-allocation-service-refactor.md`

## Objective

Create a new `WorktreePoolManager` service class that handles worktree pool management, selection, and claims (locking). This extracts the complex claim logic from `AllocationService` into a focused, testable service.

## Files to Create

| File | Purpose |
|------|---------|
| `core/services/worktree/worktree-pool-manager.ts` | WorktreePoolManager class |
| `core/services/worktree/worktree-pool-manager.test.ts` | Unit tests |

## Implementation

### 1. Create WorktreePoolManager Class

**File:** `core/services/worktree/worktree-pool-manager.ts`

```typescript
import { WorktreeState, RepositorySettings } from '../../../src/entities/repositories/types';
import { GitAdapter } from '../../adapters/types';

/**
 * Manages the worktree pool: selection, claiming, and lifecycle.
 *
 * Responsibilities:
 * - Selection: Find worktrees by task, thread, or affinity
 * - Claims (Locking): Track which threads are using which worktrees
 * - Pool: Create new worktrees when needed
 */
export class WorktreePoolManager {
  constructor(
    private git: GitAdapter,
    private basePath: string
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Selection
  // ─────────────────────────────────────────────────────────────

  /**
   * Find worktree currently claimed by a specific task.
   */
  findByTask(settings: RepositorySettings, taskId: string): WorktreeState | undefined {
    return settings.worktrees.find((w) => w.claim?.taskId === taskId);
  }

  /**
   * Find worktree currently claimed by a specific thread.
   */
  findByThread(settings: RepositorySettings, threadId: string): WorktreeState | undefined {
    return settings.worktrees.find((w) => w.claim?.threadIds.includes(threadId));
  }

  /**
   * Find unclaimed worktree with affinity for a specific task.
   * Used when a task is resumed - prefer the same worktree it used before.
   */
  selectByAffinity(settings: RepositorySettings, taskId: string): WorktreeState | undefined {
    return settings.worktrees.find((w) => !w.claim && w.lastTaskId === taskId);
  }

  /**
   * Get available (unclaimed) worktrees sorted by LRU (oldest released first).
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
   * Multiple threads on the same task can share a worktree.
   */
  addThreadToClaim(worktree: WorktreeState, threadId: string): void {
    if (!worktree.claim) {
      throw new Error('Cannot add thread to unclaimed worktree');
    }
    if (!worktree.claim.threadIds.includes(threadId)) {
      worktree.claim.threadIds.push(threadId);
    }
  }

  /**
   * Create a new claim on a worktree.
   */
  claim(worktree: WorktreeState, taskId: string, threadId: string): void {
    if (worktree.claim) {
      throw new Error('Worktree is already claimed');
    }
    worktree.claim = {
      taskId,
      threadIds: [threadId],
      claimedAt: Date.now(),
    };
  }

  /**
   * Release a thread from a claim.
   * @returns true if worktree is now fully released (no more threads)
   */
  releaseThread(worktree: WorktreeState, threadId: string): boolean {
    if (!worktree.claim) {
      return false;
    }

    worktree.claim.threadIds = worktree.claim.threadIds.filter((id) => id !== threadId);

    if (worktree.claim.threadIds.length === 0) {
      // Last thread released - free the worktree
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
    return `${this.basePath}/repositories/${repoName}/${repoName}-${index}`;
  }
}
```

### 2. Add Unit Tests

**File:** `core/services/worktree/worktree-pool-manager.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorktreePoolManager } from './worktree-pool-manager';
import { WorktreeState, RepositorySettings } from '../../../src/entities/repositories/types';
import { GitAdapter } from '../../adapters/types';

describe('WorktreePoolManager', () => {
  let manager: WorktreePoolManager;
  let mockGit: jest.Mocked<GitAdapter>;
  let settings: RepositorySettings;

  beforeEach(() => {
    mockGit = {
      createWorktree: vi.fn(),
    } as unknown as jest.Mocked<GitAdapter>;

    manager = new WorktreePoolManager(mockGit, '/home/user/.anvil-dev');

    settings = {
      sourcePath: '/path/to/source',
      defaultBranch: 'main',
      worktrees: [],
    } as RepositorySettings;
  });

  describe('findByTask', () => {
    it('returns worktree claimed by task', () => {
      settings.worktrees = [
        { path: '/wt-1', claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 } },
        { path: '/wt-2', claim: null },
      ] as WorktreeState[];

      const result = manager.findByTask(settings, 'task-A');
      expect(result?.path).toBe('/wt-1');
    });

    it('returns undefined when no match', () => {
      settings.worktrees = [
        { path: '/wt-1', claim: { taskId: 'task-B', threadIds: ['t1'], claimedAt: 1000 } },
      ] as WorktreeState[];

      expect(manager.findByTask(settings, 'task-A')).toBeUndefined();
    });
  });

  describe('findByThread', () => {
    it('returns worktree containing thread', () => {
      settings.worktrees = [
        { path: '/wt-1', claim: { taskId: 'task-A', threadIds: ['t1', 't2'], claimedAt: 1000 } },
      ] as WorktreeState[];

      const result = manager.findByThread(settings, 't2');
      expect(result?.path).toBe('/wt-1');
    });
  });

  describe('selectByAffinity', () => {
    it('returns unclaimed worktree with matching lastTaskId', () => {
      settings.worktrees = [
        { path: '/wt-1', claim: null, lastTaskId: 'task-A', lastReleasedAt: 1000 },
        { path: '/wt-2', claim: null, lastTaskId: 'task-B', lastReleasedAt: 2000 },
      ] as WorktreeState[];

      const result = manager.selectByAffinity(settings, 'task-A');
      expect(result?.path).toBe('/wt-1');
    });

    it('ignores claimed worktrees', () => {
      settings.worktrees = [
        { path: '/wt-1', claim: { taskId: 'task-X', threadIds: ['t1'], claimedAt: 1000 }, lastTaskId: 'task-A' },
      ] as WorktreeState[];

      expect(manager.selectByAffinity(settings, 'task-A')).toBeUndefined();
    });
  });

  describe('getAvailable', () => {
    it('returns unclaimed worktrees sorted by LRU', () => {
      settings.worktrees = [
        { path: '/wt-1', claim: null, lastReleasedAt: 3000 },
        { path: '/wt-2', claim: null, lastReleasedAt: 1000 }, // oldest
        { path: '/wt-3', claim: { taskId: 'x', threadIds: ['t1'], claimedAt: 1000 } }, // claimed
        { path: '/wt-4', claim: null, lastReleasedAt: 2000 },
      ] as WorktreeState[];

      const result = manager.getAvailable(settings);
      expect(result.map((w) => w.path)).toEqual(['/wt-2', '/wt-4', '/wt-1']);
    });
  });

  describe('addThreadToClaim', () => {
    it('adds thread to existing claim', () => {
      const worktree = {
        path: '/wt-1',
        claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 },
      } as WorktreeState;

      manager.addThreadToClaim(worktree, 't2');

      expect(worktree.claim?.threadIds).toEqual(['t1', 't2']);
    });

    it('does not add duplicate thread', () => {
      const worktree = {
        path: '/wt-1',
        claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 },
      } as WorktreeState;

      manager.addThreadToClaim(worktree, 't1');

      expect(worktree.claim?.threadIds).toEqual(['t1']);
    });

    it('throws when worktree is not claimed', () => {
      const worktree = { path: '/wt-1', claim: null } as WorktreeState;

      expect(() => manager.addThreadToClaim(worktree, 't1')).toThrow();
    });
  });

  describe('claim', () => {
    it('creates new claim', () => {
      const worktree = { path: '/wt-1', claim: null } as WorktreeState;

      manager.claim(worktree, 'task-A', 't1');

      expect(worktree.claim).toEqual({
        taskId: 'task-A',
        threadIds: ['t1'],
        claimedAt: expect.any(Number),
      });
    });

    it('throws when already claimed', () => {
      const worktree = {
        path: '/wt-1',
        claim: { taskId: 'task-B', threadIds: ['t2'], claimedAt: 1000 },
      } as WorktreeState;

      expect(() => manager.claim(worktree, 'task-A', 't1')).toThrow();
    });
  });

  describe('releaseThread', () => {
    it('removes thread from claim, keeps worktree claimed', () => {
      const worktree = {
        path: '/wt-1',
        claim: { taskId: 'task-A', threadIds: ['t1', 't2'], claimedAt: 1000 },
      } as WorktreeState;

      const fullyReleased = manager.releaseThread(worktree, 't1');

      expect(fullyReleased).toBe(false);
      expect(worktree.claim?.threadIds).toEqual(['t2']);
      expect(worktree.lastReleasedAt).toBeUndefined();
    });

    it('releases worktree when last thread exits', () => {
      const worktree = {
        path: '/wt-1',
        claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 },
      } as WorktreeState;

      const fullyReleased = manager.releaseThread(worktree, 't1');

      expect(fullyReleased).toBe(true);
      expect(worktree.claim).toBeNull();
      expect(worktree.lastTaskId).toBe('task-A');
      expect(worktree.lastReleasedAt).toBeDefined();
    });

    it('returns false for unclaimed worktree', () => {
      const worktree = { path: '/wt-1', claim: null } as WorktreeState;

      expect(manager.releaseThread(worktree, 't1')).toBe(false);
    });
  });

  describe('create', () => {
    it('creates worktree and adds to settings', () => {
      settings.worktrees = [{ path: '/existing' } as WorktreeState];

      const result = manager.create('my-repo', settings);

      expect(mockGit.createWorktree).toHaveBeenCalledWith(
        settings.sourcePath,
        '/home/user/.anvil-dev/repositories/my-repo/my-repo-2'
      );
      expect(result.path).toBe('/home/user/.anvil-dev/repositories/my-repo/my-repo-2');
      expect(settings.worktrees).toHaveLength(2);
    });
  });
});
```

## Verification

```bash
# TypeScript compilation
pnpm typecheck

# Run pool manager tests
pnpm test core/services/worktree/worktree-pool-manager.test.ts
```

## Design Decisions

1. **Multi-thread claims**: `threadIds[]` allows concurrent access to same worktree by threads on same task
2. **Task affinity**: `lastTaskId` remembers previous usage for better worktree reuse
3. **LRU selection**: Available worktrees sorted by `lastReleasedAt` to spread wear
4. **Explicit errors**: Throw on invalid operations (double-claim, add to unclaimed) rather than silent no-op
5. **No file locking**: This class operates on in-memory settings; caller handles persistence and file locking

## Notes

- Depends on types from `01-types-and-schema.md`
- Will be injected into AllocationService in `06-allocation-service-refactor.md`
- The `basePath` constructor parameter allows for testability and different environments
