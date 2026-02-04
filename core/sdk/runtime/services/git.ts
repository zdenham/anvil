import { exec } from 'child_process';
import { promisify } from 'util';
import type { GitService } from '../../types.js';

const execAsync = promisify(exec);

export function createGitService(): GitService {
  return {
    async getCurrentBranch(worktreePath: string): Promise<string | null> {
      try {
        const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: worktreePath });
        const branch = stdout.trim();
        return branch === 'HEAD' ? null : branch;
      } catch {
        return null;
      }
    },

    async getDefaultBranch(repoPath: string): Promise<string> {
      try {
        const { stdout } = await execAsync(
          'git symbolic-ref refs/remotes/origin/HEAD --short',
          { cwd: repoPath }
        );
        return stdout.trim().replace('origin/', '');
      } catch {
        // Fallback: check if main or master exists
        try {
          await execAsync('git rev-parse --verify main', { cwd: repoPath });
          return 'main';
        } catch {
          return 'master';
        }
      }
    },

    async getHeadCommit(repoPath: string): Promise<string> {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
      return stdout.trim();
    },

    async branchExists(repoPath: string, branch: string): Promise<boolean> {
      try {
        await execAsync(`git rev-parse --verify ${branch}`, { cwd: repoPath });
        return true;
      } catch {
        return false;
      }
    },

    async listBranches(repoPath: string): Promise<string[]> {
      const { stdout } = await execAsync('git branch --format="%(refname:short)"', { cwd: repoPath });
      return stdout.trim().split('\n').filter(Boolean);
    },

    async getDiff(repoPath: string, baseCommit: string): Promise<string> {
      const { stdout } = await execAsync(`git diff ${baseCommit}..HEAD`, { cwd: repoPath });
      return stdout;
    },
  };
}
