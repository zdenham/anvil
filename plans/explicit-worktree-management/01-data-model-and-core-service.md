# Sub-Plan 1: Data Model and Core WorktreeService

## Prerequisites
- **Sub-Plan 0 (Dead Code Deletion)** must be complete

## Parallel Execution
Can run **in parallel with Sub-Plan 2** (Tauri commands) after Sub-Plan 0 completes.

## Overview
Update the data model to support explicit worktree management and create the core WorktreeService with simple CRUD operations.

---

## Part A: Data Model Updates

### File: `core/types/repositories.ts`

Ensure `WorktreeStateSchema` is simplified (should already be done in Sub-Plan 0):

```typescript
export const WorktreeStateSchema = z.object({
  path: z.string(),
  name: z.string(),
  lastAccessedAt: z.number().optional(),
  currentBranch: z.string().nullable().optional(),
});

export type WorktreeState = z.infer<typeof WorktreeStateSchema>;
```

### File: `core/types/tasks.ts`

Add `worktreePath` to task metadata schema:

```typescript
// Add to TaskMetadataSchema or equivalent
worktreePath: z.string().optional(),
```

### File: `core/types/threads.ts`

Add `worktreePath` to thread metadata schema:

```typescript
// Add to ThreadMetadataSchema or equivalent
worktreePath: z.string().optional(),
```

---

## Part B: Data Migration

### File: `core/services/repository/settings-service.ts` (or appropriate migration location)

Add migration function for existing worktrees:

```typescript
function migrateWorktreeState(data: unknown): unknown {
  if (data && typeof data === 'object') {
    const { claim, version, lastTaskId, lastReleasedAt, ...rest } = data as Record<string, unknown>;
    return {
      ...rest,
      // Convert lastReleasedAt to lastAccessedAt if present
      lastAccessedAt: rest.lastAccessedAt ?? lastReleasedAt ?? Date.now(),
      // Generate name from path if not present
      name: rest.name ?? `worktree-${(rest.path as string)?.split('/').pop() ?? 'unknown'}`,
    };
  }
  return data;
}

// Apply during settings load
```

---

## Part C: WorktreeService

### New File: `core/services/worktree/worktree-service.ts`

```typescript
import type { GitAdapter, PathLock, Logger } from '@core/adapters/types';
import type { RepositorySettingsService } from '../repository/settings-service';
import type { WorktreeState } from '@core/types/repositories.js';

/**
 * Simple worktree CRUD service.
 * No pooling, no allocation, no claiming - just create/delete/list.
 */
export class WorktreeService {
  constructor(
    private mortDir: string,
    private settingsService: RepositorySettingsService,
    private git: GitAdapter,
    private pathLock: PathLock,
    private logger: Logger
  ) {}

  /**
   * Create a new named worktree.
   */
  create(repoName: string, name: string): WorktreeState {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);

      // Validate name uniqueness
      if (settings.worktrees.some(w => w.name === name)) {
        throw new Error(`Worktree "${name}" already exists`);
      }

      // Validate name format
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error('Name can only contain letters, numbers, dashes, and underscores');
      }

      const worktreePath = `${this.mortDir}/repositories/${repoName}/${name}`;
      this.git.createWorktree(settings.sourcePath, worktreePath);

      const worktree: WorktreeState = {
        path: worktreePath,
        name,
        lastAccessedAt: Date.now(),
        currentBranch: null,
      };

      settings.worktrees.push(worktree);
      this.settingsService.save(repoName, settings);
      return worktree;
    });
  }

  /**
   * Delete a worktree by name.
   */
  delete(repoName: string, name: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const index = settings.worktrees.findIndex(w => w.name === name);

      if (index === -1) {
        throw new Error(`Worktree "${name}" not found`);
      }

      const worktree = settings.worktrees[index];
      this.git.removeWorktree(worktree.path);
      settings.worktrees.splice(index, 1);
      this.settingsService.save(repoName, settings);
    });
  }

  /**
   * Rename a worktree (metadata only, not the directory).
   */
  rename(repoName: string, oldName: string, newName: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const worktree = settings.worktrees.find(w => w.name === oldName);

      if (!worktree) {
        throw new Error(`Worktree "${oldName}" not found`);
      }
      if (settings.worktrees.some(w => w.name === newName)) {
        throw new Error(`Worktree "${newName}" already exists`);
      }

      worktree.name = newName;
      this.settingsService.save(repoName, settings);
    });
  }

  /**
   * List all worktrees, sorted by most recently accessed.
   */
  list(repoName: string): WorktreeState[] {
    const settings = this.settingsService.load(repoName);
    return [...settings.worktrees].sort(
      (a, b) => (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0)
    );
  }

  /**
   * Get a worktree by path.
   */
  getByPath(repoName: string, path: string): WorktreeState | null {
    const settings = this.settingsService.load(repoName);
    return settings.worktrees.find(w => w.path === path) ?? null;
  }

  /**
   * Get a worktree by name.
   */
  getByName(repoName: string, name: string): WorktreeState | null {
    const settings = this.settingsService.load(repoName);
    return settings.worktrees.find(w => w.name === name) ?? null;
  }

  /**
   * Update lastAccessedAt timestamp.
   */
  touch(repoName: string, worktreePath: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const worktree = settings.worktrees.find(w => w.path === worktreePath);
      if (worktree) {
        worktree.lastAccessedAt = Date.now();
        this.settingsService.save(repoName, settings);
      }
    });
  }

  private withLock<T>(repoName: string, fn: () => T): T {
    const lockPath = `${this.mortDir}/repositories/${repoName}/.lock`;
    this.pathLock.acquire(lockPath);
    try {
      return fn();
    } finally {
      this.pathLock.release(lockPath);
    }
  }
}
```

---

## Part D: Unit Tests

### New File: `core/services/worktree/worktree-service.test.ts`

Test cases:

1. **create()**
   - Creates git worktree on disk
   - Adds to settings with correct name
   - Sets lastAccessedAt timestamp
   - Rejects duplicate names
   - Rejects invalid characters in name

2. **delete()**
   - Removes git worktree
   - Removes from settings
   - Fails if worktree not found

3. **rename()**
   - Updates name in settings
   - Rejects duplicate names
   - Fails if source worktree not found

4. **list()**
   - Returns all worktrees
   - Sorted by lastAccessedAt desc

5. **getByPath() / getByName()**
   - Returns matching worktree
   - Returns null if not found

6. **touch()**
   - Updates timestamp
   - Handles missing worktree gracefully

---

## Verification Steps

1. Update `core/types/tasks.ts` - add `worktreePath`
2. Update `core/types/threads.ts` - add `worktreePath`
3. Add migration function for existing worktrees
4. Create `core/services/worktree/worktree-service.ts`
5. Create `core/services/worktree/worktree-service.test.ts`
6. Run tests: `pnpm test`
7. TypeScript compile: `pnpm tsc --noEmit`

## Success Criteria
- `worktreePath` field exists on task and thread metadata types
- `WorktreeService` class implements all CRUD methods
- Unit tests pass for all CRUD operations
- Existing worktrees can be migrated (no name → generated name)
