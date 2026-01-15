# Phase 2b: Node Git Adapter

## Goal

Implement the GitAdapter interface for Node.js using `spawnSync` for git commands.

## Prerequisites

- [01-adapter-interfaces.md](./01-adapter-interfaces.md) complete

## Parallel With

- [02a-fs-adapter.md](./02a-fs-adapter.md)
- [02c-path-lock.md](./02c-path-lock.md)

## Files to Create

- `core/adapters/node/git-adapter.ts`
- `core/adapters/node/git-adapter.test.ts`

## Security Requirements

**CRITICAL**: All git commands MUST use `spawnSync` with array arguments to prevent command injection attacks. Never use `execSync` with string interpolation for user-provided values (branch names, commits, paths, etc.).

```typescript
// VULNERABLE - DO NOT USE
execSync(`git rev-parse ${branch}`, { cwd: repoPath });  // Injection via branch name

// SECURE - USE THIS PATTERN
spawnSync('git', ['rev-parse', branch], { cwd: repoPath });  // Arguments are escaped
```

## Implementation

```typescript
// core/adapters/node/git-adapter.ts
import { spawnSync, SpawnSyncReturns } from 'child_process';
import type { GitAdapter, WorktreeInfo } from '../types';

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

  createWorktree(repoPath: string, worktreePath: string, options?: { branch?: string; commit?: string }): void {
    const args = ['worktree', 'add', worktreePath];
    if (options?.commit) {
      args.push(options.commit);
    } else if (options?.branch) {
      args.push('-b', options.branch);
    }
    this.exec(args, repoPath);
  }

  removeWorktree(repoPath: string, worktreePath: string, options?: { force?: boolean }): void {
    const args = ['worktree', 'remove', worktreePath];
    if (options?.force) {
      args.push('--force');
    }
    this.exec(args, repoPath);
  }

  listWorktrees(repoPath: string): WorktreeInfo[] {
    const output = this.exec(['worktree', 'list', '--porcelain'], repoPath);
    // Parse porcelain output
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

  private parseWorktreeList(output: string): WorktreeInfo[] {
    // Parse git worktree list --porcelain output
    // Format: worktree <path>\nHEAD <sha>\nbranch <ref>\n\n
    const worktrees: WorktreeInfo[] = [];
    const blocks = output.split('\n\n').filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n');
      const info: Partial<WorktreeInfo> = { bare: false };

      for (const line of lines) {
        if (line.startsWith('worktree ')) info.path = line.slice(9);
        if (line.startsWith('HEAD ')) info.commit = line.slice(5);
        if (line.startsWith('branch ')) info.branch = line.slice(7).replace('refs/heads/', '');
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
```

## Tasks

1. Implement `NodeGitAdapter` class
2. Parse `git worktree list --porcelain` output correctly
3. Handle edge cases (detached HEAD, bare repos)
4. Write integration tests with real git repos

## Test Cases

- Create worktree at specific commit
- Remove worktree (normal and force)
- List worktrees and parse output
- Get default branch (origin/HEAD, main, master fallbacks)
- Get branch commit SHA
- Checkout commit (detached HEAD)
- Checkout branch
- Get merge base between two refs

## Notes

- Use `spawnSync` with array arguments for all git commands (prevents command injection)
- All methods throw on git errors (no error swallowing)
- Parse porcelain format for reliable parsing

## Verification

- [ ] All tests pass with real git operations
- [ ] Class implements GitAdapter interface
- [ ] Handles detached HEAD and bare worktrees
- [ ] All git commands use spawnSync with array arguments (security)
