import type { GitService } from '../../types.js';
import { NodeGitAdapter } from '../../../adapters/node/git-adapter.js';

/**
 * Creates a GitService that wraps NodeGitAdapter with async interface.
 *
 * Design notes:
 * - Delegates to NodeGitAdapter for all git operations (DRY)
 * - NodeGitAdapter uses spawnSync with array args (prevents command injection)
 * - Wraps synchronous adapter methods in Promises for SDK's async API
 */
export function createGitService(): GitService {
  const adapter = new NodeGitAdapter();

  return {
    async getCurrentBranch(worktreePath: string): Promise<string | null> {
      return adapter.getCurrentBranch(worktreePath);
    },

    async getDefaultBranch(repoPath: string): Promise<string> {
      return adapter.getDefaultBranch(repoPath);
    },

    async getHeadCommit(repoPath: string): Promise<string> {
      return adapter.getHeadCommit(repoPath);
    },

    async branchExists(repoPath: string, branch: string): Promise<boolean> {
      return adapter.branchExists(repoPath, branch);
    },

    async listBranches(repoPath: string): Promise<string[]> {
      return adapter.listBranches(repoPath);
    },

    async getDiff(repoPath: string, baseCommit: string): Promise<string> {
      return adapter.getDiff(repoPath, baseCommit);
    },
  };
}
