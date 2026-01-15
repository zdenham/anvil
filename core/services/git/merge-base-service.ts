import type { GitAdapter } from '@core/adapters/types';

/**
 * Service for computing git merge-base commits.
 * Wraps GitAdapter.getMergeBase with clearer semantics.
 *
 * Single Responsibility: This service ONLY computes merge-base commits.
 * It does NOT: checkout commits, manage branches, or cache results.
 */
export class MergeBaseService {
  constructor(private git: GitAdapter) {}

  /**
   * Computes the merge base between HEAD and the specified branch.
   * This is the commit where the current work should be based.
   * @param repoPath - Path to the repository
   * @param baseBranch - The branch to compute merge base against (e.g., "main")
   * @returns Commit SHA of the merge base
   * @throws If merge base cannot be found (e.g., refs share no history)
   */
  compute(repoPath: string, baseBranch: string): string {
    return this.git.getMergeBase(repoPath, 'HEAD', baseBranch);
  }

  /**
   * Computes merge base between two arbitrary refs.
   * @param repoPath - Path to the repository
   * @param ref1 - First ref (branch, tag, or commit)
   * @param ref2 - Second ref (branch, tag, or commit)
   * @returns Commit SHA of the merge base
   * @throws If merge base cannot be found (e.g., refs share no history)
   */
  computeBetween(repoPath: string, ref1: string, ref2: string): string {
    return this.git.getMergeBase(repoPath, ref1, ref2);
  }
}
