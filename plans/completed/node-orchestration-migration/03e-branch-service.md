# Phase 3e: Branch Service

## Goal

Create a single-responsibility service for creating and deleting git branches.

## Prerequisites

- [02b-git-adapter.md](./02b-git-adapter.md) complete

## Parallel With

- [03a-settings-service.md](./03a-settings-service.md)
- [03b-merge-base-service.md](./03b-merge-base-service.md)
- [03c-task-services.md](./03c-task-services.md)
- [03d-thread-service.md](./03d-thread-service.md)

## Files to Create

- `core/services/git/branch-service.ts`
- `core/services/git/branch-service.test.ts`

## Security Requirements

**Input Validation**: Branch names MUST be validated before any git operations to prevent:
- Command injection attacks
- Invalid git ref names that could cause unexpected behavior

**Command Execution**: Use `spawnSync` with array arguments, never `execSync` with string interpolation.

## Implementation

```typescript
// core/services/git/branch-service.ts
import { spawnSync, SpawnSyncReturns } from 'child_process';
import type { GitAdapter } from '@core/adapters/types';

export class BranchService {
  constructor(private git: GitAdapter) {}

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
```

## Tasks

1. Implement BranchService class
2. Support create, delete, exists, list operations
3. Add input validation for branch names
4. Write integration tests with real git repo

## Test Cases

- Create branch at HEAD
- Create branch at specific commit
- Delete merged branch
- Force delete unmerged branch
- exists returns true for existing branch
- exists returns false for non-existent branch
- list returns all local branches
- **Reject invalid branch names (empty, with .., with spaces, etc.)**
- **Reject branch names with command injection attempts**

## Single Responsibility

This service ONLY:
- Creates git branches
- Deletes git branches
- Checks branch existence
- Lists branches
- Validates branch names

It does NOT:
- Checkout branches
- Manage worktrees
- Handle remote branches

## Notes

- Uses `spawnSync` with array arguments to prevent command injection
- Branch names are validated internally using `validateBranchName()` before any git operations
- Force delete (`-D`) required for unmerged branches

## Verification

- [ ] All tests pass with real git operations
- [ ] No async/await used
- [ ] Service has single responsibility
- [ ] All git commands use spawnSync with array arguments (security)
- [ ] All methods validate branch names before git operations (security)
