# Plan 02: GitAdapter Extensions

**Phase:** 1 (Foundation)
**Parallelizable with:** `01-types-and-schema.md`
**Blocks:** `03-branch-manager.md`, `06-allocation-service-refactor.md`

## Objective

Add new git operations to the GitAdapter interface and implementation:
- `fetch()` - Update refs from remote
- `branchExists()` - Check if branch exists
- `createBranch()` - Create a new branch
- `checkoutBranch()` - Checkout an existing branch (attached HEAD)
- `getCurrentBranch()` - Get current branch name or null if detached

## Files to Modify

| File | Changes |
|------|---------|
| `core/adapters/types.ts` | Add methods to `GitAdapter` interface |
| `core/adapters/node/git-adapter.ts` | Implement new methods |
| `core/adapters/node/git-adapter.test.ts` | Add unit tests |

## Implementation

### 1. Update `GitAdapter` Interface

**File:** `core/adapters/types.ts`

Add to `GitAdapter` interface:

```typescript
/**
 * Fetch from a remote to update refs.
 * @param repoPath - Path to the repository
 * @param remote - Remote name (default: "origin")
 */
fetch(repoPath: string, remote?: string): void;

/**
 * Check if a branch exists in the repository.
 * @param repoPath - Path to the repository
 * @param branch - Branch name to check
 * @returns true if branch exists, false otherwise
 */
branchExists(repoPath: string, branch: string): boolean;

/**
 * Create a new branch at the current HEAD or specified commit.
 * @param worktreePath - Path to the worktree
 * @param branch - Branch name to create
 * @param startPoint - Optional commit/branch to start from (defaults to HEAD)
 * @throws If branch already exists or creation fails
 */
createBranch(worktreePath: string, branch: string, startPoint?: string): void;

/**
 * Checkout a branch (attaches HEAD to the branch).
 * @param worktreePath - Path to the worktree
 * @param branch - Branch name to checkout
 * @throws If branch doesn't exist or checkout fails
 */
checkoutBranch(worktreePath: string, branch: string): void;

/**
 * Get the current branch name, or null if in detached HEAD state.
 * @param worktreePath - Path to the worktree
 * @returns Branch name or null if detached
 */
getCurrentBranch(worktreePath: string): string | null;
```

### 2. Implement in Node Adapter

**File:** `core/adapters/node/git-adapter.ts`

```typescript
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

checkoutBranch(worktreePath: string, branch: string): void {
  this.exec(['checkout', branch], worktreePath);
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
```

### 3. Add Unit Tests

**File:** `core/adapters/node/git-adapter.test.ts`

```typescript
describe('fetch', () => {
  it('fetches from origin by default', () => {
    adapter.fetch(repoPath);
    expect(execSpy).toHaveBeenCalledWith('git', ['fetch', 'origin'], expect.anything());
  });

  it('fetches from specified remote', () => {
    adapter.fetch(repoPath, 'upstream');
    expect(execSpy).toHaveBeenCalledWith('git', ['fetch', 'upstream'], expect.anything());
  });
});

describe('branchExists', () => {
  it('returns true for existing branch', () => {
    execSpy.mockReturnValue({ status: 0, stdout: 'abc123' });
    expect(adapter.branchExists(repoPath, 'main')).toBe(true);
  });

  it('returns false for non-existent branch', () => {
    execSpy.mockImplementation(() => { throw new Error('not found'); });
    expect(adapter.branchExists(repoPath, 'nonexistent')).toBe(false);
  });
});

describe('createBranch', () => {
  it('creates branch at HEAD', () => {
    adapter.createBranch(worktreePath, 'feature/foo');
    expect(execSpy).toHaveBeenCalledWith('git', ['branch', 'feature/foo'], expect.anything());
  });

  it('creates branch at specified commit', () => {
    adapter.createBranch(worktreePath, 'feature/foo', 'abc123');
    expect(execSpy).toHaveBeenCalledWith('git', ['branch', 'feature/foo', 'abc123'], expect.anything());
  });
});

describe('checkoutBranch', () => {
  it('checks out the specified branch', () => {
    adapter.checkoutBranch(worktreePath, 'feature/foo');
    expect(execSpy).toHaveBeenCalledWith('git', ['checkout', 'feature/foo'], expect.anything());
  });
});

describe('getCurrentBranch', () => {
  it('returns branch name when on a branch', () => {
    execSpy.mockReturnValue({ status: 0, stdout: 'main\n' });
    expect(adapter.getCurrentBranch(worktreePath)).toBe('main');
  });

  it('returns null when in detached HEAD state', () => {
    execSpy.mockImplementation(() => {
      throw new Error('fatal: ref HEAD is not a symbolic ref');
    });
    expect(adapter.getCurrentBranch(worktreePath)).toBeNull();
  });
});
```

## Verification

```bash
# TypeScript compilation
pnpm typecheck

# Run git adapter tests
pnpm test core/adapters/node/git-adapter.test.ts
```

## Notes

- `fetch()` is used to ensure we have the latest refs from origin before computing merge base
- `branchExists()` checks the source repo (not worktree) since branches are shared
- `checkoutBranch()` differs from existing `checkoutCommit()` - it attaches HEAD to a branch
- `getCurrentBranch()` returns null for detached HEAD, making it easy to check attachment status
