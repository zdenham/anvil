import * as path from 'path';
import type {
  GitAdapter,
  PathLock,
  AcquireOptions,
  Logger,
} from '@core/adapters/types';
import type { RepositorySettingsService } from '../repository/settings-service';
import type { MergeBaseService } from '../git/merge-base-service';
import type { RepositorySettings, WorktreeState } from '@core/types/repositories.js';
import type { BranchManager } from './branch-manager';
import type { WorktreePoolManager } from './worktree-pool-manager';

/**
 * Options for allocating a worktree.
 */
export interface AllocateOptions {
  /** Task ID for worktree affinity */
  taskId?: string;

  /** Desired branch name to checkout/create (may be modified if collision) */
  taskBranch?: string;
}

/**
 * Result of resolving a branch name for a task.
 */
interface BranchResolution {
  /** The actual branch name to use (may differ from desired if collision) */
  branch: string;

  /** Whether this is resuming an existing task branch */
  isResume: boolean;
}

/**
 * Result of a successful worktree allocation.
 */
export interface WorktreeAllocation {
  worktree: WorktreeState;
  mergeBase: string;

  /** The actual branch name used (may differ from requested if collision) */
  branch: string;

  /** Whether this is resuming an existing task branch */
  isResume: boolean;
}

// Default retry options for lock acquisition
const DEFAULT_LOCK_OPTIONS: AcquireOptions = {
  maxRetries: 5,
  retryDelayMs: 100,
};

/**
 * Service for allocating and releasing worktrees to agent threads.
 *
 * Concurrency: Uses file-based locking with retry and exponential backoff
 * to handle concurrent allocation requests safely.
 *
 * This is a thin orchestration layer that delegates to:
 * - WorktreePoolManager: worktree selection, claiming, and lifecycle
 * - BranchManager: branch checkout and creation
 * - SettingsService: persistence
 */
export class WorktreeAllocationService {
  constructor(
    private mortDir: string,
    private settingsService: RepositorySettingsService,
    private mergeBaseService: MergeBaseService,
    private git: GitAdapter,
    private pathLock: PathLock,
    private branchManager: BranchManager,
    private poolManager: WorktreePoolManager,
    private logger: Logger
  ) {}

  /**
   * Allocate a worktree for a thread.
   *
   * Concurrency behavior:
   * - Acquires repository-level lock with retry and exponential backoff
   * - Multiple concurrent allocations will queue via lock retry
   * - Claim is rolled back if checkout fails
   *
   * @param repoName - The repository name (slug)
   * @param threadId - The thread ID to allocate for
   * @param options - Optional allocation options (taskId, taskBranch)
   * @returns The allocated worktree and merge base commit
   * @throws Error if lock cannot be acquired after retries
   * @throws Error if checkout fails (claim is rolled back)
   */
  allocate(
    repoName: string,
    threadId: string,
    options?: AllocateOptions
  ): WorktreeAllocation {
    const lockPath = this.getLockPath(repoName);

    return this.withLock(lockPath, () => {
      const settings = this.settingsService.load(repoName);

      // 1. Get or claim a worktree
      const worktree = this.claimWorktree(
        repoName,
        settings,
        threadId,
        options?.taskId
      );

      try {
        // 2. Fetch latest refs (non-fatal)
        this.safeFetch(settings.sourcePath);

        // 3. Compute merge base against origin's default branch
        // FIX: Use origin/{defaultBranch} instead of HEAD
        const remoteBranch = `origin/${settings.defaultBranch}`;
        const mergeBase = this.mergeBaseService.compute(
          settings.sourcePath,
          remoteBranch
        );

        this.logger.info('[AllocationService] Computed merge base', {
          sourcePath: settings.sourcePath,
          remoteBranch,
          mergeBase,
          worktreePath: worktree.path,
          taskBranch: options?.taskBranch,
        });

        // 4. Handle branch attachment
        let resolvedBranch: string | undefined;
        let isResume = false;

        this.logger.info('[AllocationService] Branch attachment check', {
          hasTaskBranch: !!options?.taskBranch,
          hasTaskId: !!options?.taskId,
          taskBranch: options?.taskBranch,
          taskId: options?.taskId,
        });

        if (options?.taskBranch && options?.taskId) {
          // Resolve branch name (handles collisions and resume detection)
          const resolution = this.resolveBranchName(
            options.taskId,
            options.taskBranch,
            settings
          );
          resolvedBranch = resolution.branch;
          isResume = resolution.isResume;

          this.logger.info('[AllocationService] Branch resolution', {
            taskId: options.taskId,
            desiredBranch: options.taskBranch,
            resolvedBranch,
            isResume,
          });

          this.branchManager.ensureBranch(
            worktree.path,
            resolvedBranch,
            settings.sourcePath,
            mergeBase,
            isResume
          );

          // Register branch in taskBranches if new (not resume)
          if (!isResume) {
            settings.taskBranches[options.taskId] = {
              branch: resolvedBranch,
              baseBranch: settings.defaultBranch,
              mergeBase,
              createdAt: Date.now(),
            };
          }
        } else if (options?.taskBranch) {
          // No task ID - just use the branch name directly (legacy behavior)
          this.logger.warn('[AllocationService] No taskId provided, using legacy branch handling', {
            taskBranch: options.taskBranch,
          });
          resolvedBranch = options.taskBranch;
          this.branchManager.ensureBranch(
            worktree.path,
            resolvedBranch,
            settings.sourcePath,
            mergeBase,
            false
          );
        } else {
          // No branch specified - checkout at merge base (detached HEAD)
          this.logger.info('[AllocationService] No branch specified, checking out merge base only', {
            mergeBase,
          });
          this.git.checkoutCommit(worktree.path, mergeBase);
        }

        this.settingsService.save(repoName, settings);
        return {
          worktree,
          mergeBase,
          branch: resolvedBranch ?? '',
          isResume,
        };
      } catch (err) {
        // Rollback claim on failure
        this.release(repoName, threadId);
        throw err;
      }
    });
  }

  /**
   * Release a worktree from a thread.
   *
   * Concurrency behavior:
   * - Acquires repository-level lock with retry
   * - Safe to call multiple times (idempotent)
   *
   * @param repoName - The repository name (slug)
   * @param threadId - The thread ID to release
   */
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

  /**
   * Get the worktree allocated to a specific thread.
   * Does not require lock - read-only operation on settings.
   *
   * @param repoName - The repository name (slug)
   * @param threadId - The thread ID to look up
   * @returns The worktree if found, null otherwise
   */
  getForThread(repoName: string, threadId: string): WorktreeState | null {
    const settings = this.settingsService.load(repoName);
    return this.poolManager.findByThread(settings, threadId) ?? null;
  }

  /**
   * Claim an existing worktree or create a new one.
   *
   * Priority order:
   * 1. Add to existing task claim (concurrent access)
   * 2. Unclaimed worktree with task affinity
   * 3. LRU available worktree
   * 4. Create new worktree
   */
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
      // Create new worktree if none available
      worktree = this.poolManager.create(repoName, settings);
    }

    this.poolManager.claim(worktree, taskId ?? 'unknown', threadId);
    return worktree;
  }

  /**
   * Resolve the branch name for a task, handling collisions.
   *
   * Priority:
   * 1. If task already has a branch registered in taskBranches, use it (resume)
   * 2. If desired branch name is available, use it (new)
   * 3. If collision, find unique name: branch-2, branch-3, etc.
   */
  private resolveBranchName(
    taskId: string,
    desiredBranch: string,
    settings: RepositorySettings
  ): BranchResolution {
    // 1. Check if this task already has a branch registered
    const existingInfo = settings.taskBranches[taskId];
    if (existingInfo) {
      this.logger.info('[AllocationService] Found existing branch for task', {
        taskId,
        branch: existingInfo.branch,
      });
      return { branch: existingInfo.branch, isResume: true };
    }

    // 2. Check if desired branch name is taken
    const isTaken = (name: string): boolean => {
      // Check if branch exists in git
      if (this.git.branchExists(settings.sourcePath, name)) {
        return true;
      }
      // Check if branch is registered to another task
      return Object.values(settings.taskBranches).some(
        (info) => info.branch === name
      );
    };

    if (!isTaken(desiredBranch)) {
      return { branch: desiredBranch, isResume: false };
    }

    // 3. Collision - find unique name
    this.logger.warn('[AllocationService] Branch name collision, finding unique name', {
      desiredBranch,
      taskId,
    });

    let suffix = 2;
    let uniqueName = `${desiredBranch}-${suffix}`;
    while (isTaken(uniqueName)) {
      suffix++;
      uniqueName = `${desiredBranch}-${suffix}`;
    }

    this.logger.info('[AllocationService] Resolved collision with unique name', {
      desiredBranch,
      uniqueName,
      taskId,
    });

    return { branch: uniqueName, isResume: false };
  }

  /**
   * Fetch from origin, logging but not throwing on failure.
   */
  private safeFetch(sourcePath: string): void {
    try {
      this.git.fetch(sourcePath);
    } catch (err) {
      this.logger.warn('Failed to fetch from origin, using local refs', {
        error: err,
      });
    }
  }

  private getLockPath(repoName: string): string {
    return path.join(this.mortDir, 'repositories', repoName, '.lock');
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
