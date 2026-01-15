import { spawnSync, SpawnSyncReturns } from 'child_process';

/**
 * Service for creating and deleting git branches.
 * Uses spawnSync with array arguments to prevent command injection attacks.
 */
export class BranchService {
  /**
   * Validates a git branch name according to git-check-ref-format rules.
   * Throws an error if the name is invalid.
   */
  private validateBranchName(name: string): void {
    if (!name) {
      throw new Error('Branch name cannot be empty');
    }
    if (name.includes('..')) {
      throw new Error(`Invalid branch name: ${name} (contains '..')`);
    }
    if (name.includes('~')) {
      throw new Error(`Invalid branch name: ${name} (contains '~')`);
    }
    if (name.includes('^')) {
      throw new Error(`Invalid branch name: ${name} (contains '^')`);
    }
    if (name.includes(':')) {
      throw new Error(`Invalid branch name: ${name} (contains ':')`);
    }
    if (name.includes('\\')) {
      throw new Error(`Invalid branch name: ${name} (contains '\\')`);
    }
    if (name.startsWith('-')) {
      throw new Error(`Invalid branch name: ${name} (starts with '-')`);
    }
    if (name.endsWith('.lock')) {
      throw new Error(`Invalid branch name: ${name} (ends with '.lock')`);
    }
    if (name.includes('@{')) {
      throw new Error(`Invalid branch name: ${name} (contains '@{')`);
    }
    if (name.includes(' ')) {
      throw new Error(`Invalid branch name: ${name} (contains spaces)`);
    }
    if (/[\x00-\x1f\x7f]/.test(name)) {
      throw new Error(`Invalid branch name: ${name} (contains control characters)`);
    }
  }

  /**
   * Execute a git command safely using spawnSync with array arguments.
   */
  private exec(args: string[], cwd: string): string {
    const result: SpawnSyncReturns<string> = spawnSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`git ${args[0]} failed: ${result.stderr || 'Unknown error'}`);
    }

    return result.stdout.trim();
  }

  /**
   * Creates a new branch at the specified base commit.
   */
  create(repoPath: string, branchName: string, base: string): void {
    this.validateBranchName(branchName);
    this.exec(['branch', branchName, base], repoPath);
  }

  /**
   * Deletes a branch. Use force=true to delete unmerged branches.
   */
  delete(repoPath: string, branchName: string, options?: { force?: boolean }): void {
    this.validateBranchName(branchName);
    const flag = options?.force ? '-D' : '-d';
    this.exec(['branch', flag, branchName], repoPath);
  }

  /**
   * Checks if a branch exists.
   */
  exists(repoPath: string, branchName: string): boolean {
    this.validateBranchName(branchName);
    try {
      this.exec(['rev-parse', '--verify', `refs/heads/${branchName}`], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists all local branches.
   */
  list(repoPath: string): string[] {
    const output = this.exec(['branch', '--format=%(refname:short)'], repoPath);
    return output.trim().split('\n').filter(Boolean);
  }
}
