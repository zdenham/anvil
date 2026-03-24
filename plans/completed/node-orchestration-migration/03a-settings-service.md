# Phase 3a: Repository Settings Service

## Goal

Create a single-responsibility service for loading and saving repository settings.json files.

## Prerequisites

- [02a-fs-adapter.md](./02a-fs-adapter.md) complete

## Parallel With

- [03b-merge-base-service.md](./03b-merge-base-service.md)
- [03c-task-services.md](./03c-task-services.md)
- [03d-thread-service.md](./03d-thread-service.md)
- [03e-branch-service.md](./03e-branch-service.md)

## Files to Create

- `core/services/repository/settings-service.ts`
- `core/services/repository/settings-service.test.ts`

## Types

**IMPORTANT**: Import types from `src/entities/repositories/types.ts` - these are the canonical definitions.

```typescript
// From src/entities/repositories/types.ts

interface TaskBranchInfo {
  /** Branch name, e.g., "anvil/task-abc123" */
  branch: string;
  /** Base branch this was created from, e.g., "main" or "anvil/task-parent" */
  baseBranch: string;
  /** Commit hash at branch creation - used for accurate diffs */
  mergeBase: string;
  /** For subtasks, the parent task ID */
  parentTaskId?: string;
  /** Timestamp of branch creation */
  createdAt: number;
}

interface WorktreeClaim {
  /** The thread ID holding the claim */
  threadId: string;
  /** The task this thread belongs to (null during routing) */
  taskId: string | null;
  /** When the claim was made */
  claimedAt: number;
}

interface WorktreeState {
  /** Absolute path to the worktree directory */
  path: string;
  /** Version number (for compatibility/migration) */
  version: number;
  /** Currently checked out branch, or null */
  currentBranch: string | null;
  /** Active claim, or null if available */
  claim: WorktreeClaim | null;
}

interface RepositorySettings {
  /** Schema version for migrations */
  schemaVersion: 1;
  /** Repository name */
  name: string;
  /** Original remote URL if cloned, null if local */
  originalUrl: string | null;
  /** Path to source repository */
  sourcePath: string;
  /** Whether worktrees are enabled for this repo */
  useWorktrees: boolean;
  /** When this repo was added to anvil */
  createdAt: number;
  /** Pool of available worktrees */
  worktrees: WorktreeState[];
  /** Task branch tracking, keyed by task ID */
  taskBranches: Record<string, TaskBranchInfo>;
  /** Last modification timestamp */
  lastUpdated: number;
}
```

## Implementation

```typescript
// core/services/repository/settings-service.ts
import * as path from 'path';
import type { FileSystemAdapter } from '@core/adapters/types';
import type { RepositorySettings } from '@/entities/repositories/types';

export class RepositorySettingsService {
  constructor(
    private anvilDir: string,
    private fs: FileSystemAdapter
  ) {}

  load(repoName: string): RepositorySettings {
    const settingsPath = this.getSettingsPath(repoName);
    const content = this.fs.readFile(settingsPath);
    return JSON.parse(content);
  }

  save(repoName: string, settings: RepositorySettings): void {
    // Update lastUpdated timestamp on save
    settings.lastUpdated = Date.now();
    const settingsPath = this.getSettingsPath(repoName);
    this.fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }

  exists(repoName: string): boolean {
    return this.fs.exists(this.getSettingsPath(repoName));
  }

  private getSettingsPath(repoName: string): string {
    return path.join(this.anvilDir, 'repositories', repoName, 'settings.json');
  }
}
```

## Tasks

1. Import RepositorySettings types from `src/entities/repositories/types.ts`
2. Implement RepositorySettingsService class
3. Keep it simple - just load/save, no business logic
4. Update `lastUpdated` on save
5. Write unit tests with mock FileSystemAdapter

## Test Cases

- Load existing settings file
- Save settings file (creates/overwrites)
- Save updates lastUpdated timestamp
- Check if settings exist
- Handle malformed JSON (throw)

## Single Responsibility

This service ONLY:
- Reads settings from disk
- Writes settings to disk
- Returns path to settings file

It does NOT:
- Validate settings
- Manage worktrees
- Handle locking

## Verification

- [ ] All tests pass
- [ ] No async/await used
- [ ] Service has single responsibility
- [ ] **Types imported from canonical source (src/entities/repositories/types.ts)**
