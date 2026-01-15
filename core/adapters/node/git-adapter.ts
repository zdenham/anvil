import { spawnSync, SpawnSyncReturns } from 'child_process';
import type { GitAdapter, WorktreeInfo } from '../types';

/**
 * Node.js implementation of GitAdapter using spawnSync for git commands.
 * All commands use array arguments to prevent command injection attacks.
 */
export class NodeGitAdapter implements GitAdapter {
  /**
   * Execute a git command safely using spawnSync with array arguments.
   * This prevents command injection attacks by ensuring arguments are properly escaped.
   */
  private exec(args: string[], cwd?: string): string {
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

  createWorktree(
    repoPath: string,
    worktreePath: string,
    options?: { branch?: string; commit?: string }
  ): void {
    const args = ['worktree', 'add', worktreePath];
    if (options?.commit) {
      args.push(options.commit);
    } else if (options?.branch) {
      args.push('-b', options.branch);
    }
    this.exec(args, repoPath);
  }

  removeWorktree(
    repoPath: string,
    worktreePath: string,
    options?: { force?: boolean }
  ): void {
    const args = ['worktree', 'remove', worktreePath];
    if (options?.force) {
      args.push('--force');
    }
    this.exec(args, repoPath);
  }

  listWorktrees(repoPath: string): WorktreeInfo[] {
    const output = this.exec(['worktree', 'list', '--porcelain'], repoPath);
    return this.parseWorktreeList(output);
  }

  getDefaultBranch(repoPath: string): string {
    // Try to get from remote HEAD, fall back to common defaults
    try {
      const ref = this.exec(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoPath);
      return ref.replace('refs/remotes/origin/', '');
    } catch {
      // Check if main or master exists
      try {
        this.exec(['rev-parse', '--verify', 'main'], repoPath);
        return 'main';
      } catch {
        return 'master';
      }
    }
  }

  getBranchCommit(repoPath: string, branch: string): string {
    return this.exec(['rev-parse', branch], repoPath);
  }

  checkoutCommit(worktreePath: string, commit: string): void {
    this.exec(['checkout', '--detach', commit], worktreePath);
  }

  checkoutBranch(worktreePath: string, branch: string): void {
    this.exec(['checkout', branch], worktreePath);
  }

  getMergeBase(repoPath: string, ref1: string, ref2: string): string {
    return this.exec(['merge-base', ref1, ref2], repoPath);
  }

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

  getCurrentBranch(worktreePath: string): string | null {
    try {
      const result = this.exec(['symbolic-ref', '--short', 'HEAD'], worktreePath);
      return result.trim();
    } catch {
      // Detached HEAD state
      return null;
    }
  }

  /**
   * Parse git worktree list --porcelain output.
   * Format: worktree <path>\nHEAD <sha>\nbranch <ref>\n\n
   */
  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const blocks = output.split('\n\n').filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n');
      const info: Partial<WorktreeInfo> = { bare: false };

      for (const line of lines) {
        if (line.startsWith('worktree ')) info.path = line.slice(9);
        if (line.startsWith('HEAD ')) info.commit = line.slice(5);
        if (line.startsWith('branch ')) {
          info.branch = line.slice(7).replace('refs/heads/', '');
        }
        if (line === 'bare') info.bare = true;
        if (line === 'detached') info.branch = null;
      }

      if (info.path && info.commit !== undefined) {
        worktrees.push(info as WorktreeInfo);
      }
    }

    return worktrees;
  }
}
