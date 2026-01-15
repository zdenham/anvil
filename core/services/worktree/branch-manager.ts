import type { GitAdapter, Logger } from '../../adapters/types';

/**
 * Manages branch checkout and creation for worktrees.
 * Single responsibility: ensure worktree is on the correct branch.
 */
export class BranchManager {
  constructor(
    private git: GitAdapter,
    private logger?: Logger
  ) {}

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
   * Flow for NEW branch (isResume=false):
   * 1. Checkout merge base (clean starting point)
   * 2. Create branch at merge base
   * 3. Checkout the branch (attach HEAD)
   *
   * Flow for RESUME (isResume=true):
   * 1. Just checkout the existing branch (preserves existing commits)
   *
   * @param worktreePath - Path to the worktree
   * @param branch - Target branch name
   * @param sourcePath - Path to source repo (for checking branch existence)
   * @param mergeBase - Commit to checkout before creating branch (used for new branches)
   * @param isResume - Whether this is resuming an existing task branch
   */
  ensureBranch(
    worktreePath: string,
    branch: string,
    sourcePath: string,
    mergeBase: string,
    isResume: boolean = false
  ): void {
    this.logger?.info('[BranchManager] ensureBranch called', {
      worktreePath,
      branch,
      sourcePath,
      mergeBase,
      isResume,
    });

    // Optimization: skip if already on target branch
    if (this.isOnBranch(worktreePath, branch)) {
      this.logger?.info('[BranchManager] Already on target branch, skipping', { branch });
      return;
    }

    if (isResume) {
      // RESUME: Just checkout the existing branch (preserves commits)
      this.logger?.info('[BranchManager] Resuming existing branch', { branch });
      this.git.checkoutBranch(worktreePath, branch);
      return;
    }

    // NEW BRANCH: Checkout merge base first, then create branch
    this.logger?.info('[BranchManager] Step 1: Checking out merge base', { branch, mergeBase });
    this.git.checkoutCommit(worktreePath, mergeBase);

    this.logger?.info('[BranchManager] Step 2: Creating branch', { branch });
    this.git.createBranch(worktreePath, branch);

    this.logger?.info('[BranchManager] Step 3: Checking out branch', { branch });
    this.git.checkoutBranch(worktreePath, branch);

    this.logger?.info('[BranchManager] Branch creation complete', { branch });
  }
}
