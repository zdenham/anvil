# Plan 05: Settings Migration

**Phase:** 2 (Service Classes)
**Depends on:** `01-types-and-schema.md`
**Parallelizable with:** `03-branch-manager.md`, `04-pool-manager.md`
**Blocks:** `06-allocation-service-refactor.md`

## Objective

Add migration logic to handle the schema change from `threadId: string` to `threadIds: string[]` in `WorktreeClaim`, and add default values for new fields (`defaultBranch`, `lastTaskId`).

## Files to Modify

| File | Changes |
|------|---------|
| `core/services/worktree/settings-service.ts` | Add migration in `load()` method |

## Implementation

### 1. Add Migration Functions

**File:** `core/services/worktree/settings-service.ts`

Add migration helpers:

```typescript
/**
 * Migrate a single WorktreeClaim from old format to new format.
 * Old: { threadId: string, taskId: string, claimedAt: number }
 * New: { threadIds: string[], taskId: string, claimedAt: number }
 */
function migrateWorktreeClaim(claim: unknown): WorktreeClaim | null {
  if (!claim || typeof claim !== 'object') {
    return null;
  }

  const c = claim as Record<string, unknown>;

  // Already migrated (has threadIds array)
  if (Array.isArray(c.threadIds)) {
    return claim as WorktreeClaim;
  }

  // Old format (has threadId string) - migrate
  if (typeof c.threadId === 'string' && typeof c.taskId === 'string') {
    return {
      taskId: c.taskId,
      threadIds: [c.threadId],
      claimedAt: (c.claimedAt as number) ?? Date.now(),
    };
  }

  // Invalid format
  return null;
}

/**
 * Migrate settings from any older format to current format.
 */
function migrateSettings(settings: unknown): RepositorySettings {
  const s = settings as RepositorySettings;

  // Ensure worktrees array exists
  if (!Array.isArray(s.worktrees)) {
    s.worktrees = [];
  }

  // Migrate each worktree's claim
  for (const worktree of s.worktrees) {
    worktree.claim = migrateWorktreeClaim(worktree.claim);

    // Ensure lastTaskId exists (can be undefined)
    // No action needed - field is optional
  }

  // Add defaultBranch if missing
  if (!s.defaultBranch) {
    s.defaultBranch = detectDefaultBranch(s.sourcePath) ?? 'main';
  }

  return s;
}

/**
 * Detect the default branch for a repository.
 * Tries: origin/HEAD symbolic ref, then common branch names.
 */
function detectDefaultBranch(sourcePath: string): string | null {
  // This would use GitAdapter, but for migration we do inline detection
  try {
    const { execSync } = require('child_process');

    // Try to get default branch from origin
    const result = execSync(
      'git symbolic-ref refs/remotes/origin/HEAD --short',
      { cwd: sourcePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Returns "origin/main" or "origin/master" - extract branch name
    return result.trim().replace('origin/', '');
  } catch {
    // Fallback: check if common branches exist
    try {
      const { execSync } = require('child_process');
      for (const branch of ['main', 'master']) {
        try {
          execSync(`git rev-parse --verify refs/heads/${branch}`, {
            cwd: sourcePath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          return branch;
        } catch {
          continue;
        }
      }
    } catch {
      // Ignore errors
    }
  }
  return null;
}
```

### 2. Update `load()` Method

In the `SettingsService.load()` method, call migration after reading from disk:

```typescript
load(repoName: string): RepositorySettings {
  const settingsPath = this.getSettingsPath(repoName);

  if (!this.fs.exists(settingsPath)) {
    throw new Error(`Settings not found for repository: ${repoName}`);
  }

  const content = this.fs.readFile(settingsPath);
  const rawSettings = JSON.parse(content);

  // Migrate to current schema
  const settings = migrateSettings(rawSettings);

  return settings;
}
```

### 3. Add Tests

**File:** `core/services/worktree/settings-service.test.ts`

Add migration tests:

```typescript
describe('migrateWorktreeClaim', () => {
  it('returns null for null/undefined', () => {
    expect(migrateWorktreeClaim(null)).toBeNull();
    expect(migrateWorktreeClaim(undefined)).toBeNull();
  });

  it('preserves already-migrated claims (threadIds array)', () => {
    const claim = { taskId: 'task-1', threadIds: ['t1', 't2'], claimedAt: 1000 };
    expect(migrateWorktreeClaim(claim)).toEqual(claim);
  });

  it('migrates old format (threadId string) to new format', () => {
    const oldClaim = { taskId: 'task-1', threadId: 't1', claimedAt: 1000 };
    const result = migrateWorktreeClaim(oldClaim);

    expect(result).toEqual({
      taskId: 'task-1',
      threadIds: ['t1'],
      claimedAt: 1000,
    });
  });

  it('returns null for invalid format', () => {
    expect(migrateWorktreeClaim({ foo: 'bar' })).toBeNull();
    expect(migrateWorktreeClaim('string')).toBeNull();
  });
});

describe('migrateSettings', () => {
  it('migrates worktree claims', () => {
    const oldSettings = {
      sourcePath: '/path/to/repo',
      worktrees: [
        { path: '/wt-1', claim: { taskId: 'task-1', threadId: 't1', claimedAt: 1000 } },
        { path: '/wt-2', claim: null },
      ],
    };

    const result = migrateSettings(oldSettings);

    expect(result.worktrees[0].claim).toEqual({
      taskId: 'task-1',
      threadIds: ['t1'],
      claimedAt: 1000,
    });
    expect(result.worktrees[1].claim).toBeNull();
  });

  it('adds defaultBranch if missing', () => {
    const oldSettings = {
      sourcePath: '/path/to/repo',
      worktrees: [],
    };

    const result = migrateSettings(oldSettings);

    expect(result.defaultBranch).toBeDefined();
  });

  it('preserves existing defaultBranch', () => {
    const settings = {
      sourcePath: '/path/to/repo',
      defaultBranch: 'develop',
      worktrees: [],
    };

    const result = migrateSettings(settings);

    expect(result.defaultBranch).toBe('develop');
  });

  it('initializes empty worktrees array if missing', () => {
    const settings = { sourcePath: '/path/to/repo' };

    const result = migrateSettings(settings as any);

    expect(result.worktrees).toEqual([]);
  });
});

describe('SettingsService.load with migration', () => {
  it('migrates old settings on load', () => {
    const oldSettings = JSON.stringify({
      sourcePath: '/path/to/repo',
      worktrees: [
        { path: '/wt-1', claim: { taskId: 'task-1', threadId: 't1', claimedAt: 1000 } },
      ],
    });

    mockFs.readFile.mockReturnValue(oldSettings);
    mockFs.exists.mockReturnValue(true);

    const result = service.load('my-repo');

    expect(result.worktrees[0].claim?.threadIds).toEqual(['t1']);
    expect(result.defaultBranch).toBeDefined();
  });
});
```

## Verification

```bash
# TypeScript compilation
pnpm typecheck

# Run settings service tests
pnpm test core/services/worktree/settings-service.test.ts
```

## Migration Strategy

1. **Read-time migration**: Migration happens in `load()`, not as a separate script
2. **Backwards compatible read**: Can read both old and new formats
3. **Write in new format**: `save()` always writes new format (no changes needed)
4. **No data loss**: Old `threadId` becomes `threadIds: [threadId]`
5. **Auto-detection**: `defaultBranch` auto-detected from git if missing

## Edge Cases

1. **Partially migrated files**: Some worktrees migrated, some not - handle per-worktree
2. **Invalid claim data**: Return null (treated as unclaimed)
3. **Missing sourcePath for detection**: Fall back to 'main' for defaultBranch
4. **Network issues during detection**: Fall back to local branch detection

## Notes

- Depends on types from `01-types-and-schema.md`
- Migration is idempotent - safe to run multiple times
- Consider adding a `schemaVersion` field for future migrations
