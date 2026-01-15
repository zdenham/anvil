import type { WorktreeState, RepositorySettings } from '@core/types/repositories.js';
import type { GitAdapter } from '@core/adapters/types';

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
