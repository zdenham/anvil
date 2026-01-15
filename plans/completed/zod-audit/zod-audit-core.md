# Zod Migration Audit: `/core/` Directory

Audit based on the principles in `/docs/patterns/zod-boundaries.md`:
- Use Zod ONLY at trust boundaries (disk, network, IPC, user input)
- Do NOT use Zod for internal types, interfaces with methods, React props, etc.
- Define schema first, then derive type with `z.infer<typeof Schema>` (no duplicate types)

## Summary

**Current State**: The `core/` directory currently has **no Zod usage**. All types are plain TypeScript interfaces.

**Key Finding**: Several services read JSON from disk using `JSON.parse()` without runtime validation. These are trust boundary crossings that **should** use Zod schemas.

### Breakdown

| Category | Count | Status |
|----------|-------|--------|
| Types that SHOULD use Zod (disk reads without validation) | 4 | **Needs migration** |
| Types correctly NOT using Zod (internal interfaces) | 10+ | Correct |
| Types already using Zod | 0 | N/A |

---

## Files That Need Changes

### 1. `/core/types/tasks.ts`

**Current State**: Plain TypeScript interfaces for `TaskMetadata`, `Subtask`, `PendingReview`

**Issue**: `TaskMetadata` is read from disk in:
- `core/services/task/metadata-service.ts` (line ~27: `JSON.parse(content)`)
- `core/services/resolution-service.ts` (lines ~52, ~67: `JSON.parse(...)`)

**Recommended Action**: Add Zod schemas for persisted types. Delete the duplicate interface definitions and use `z.infer<>` instead.

```typescript
// BEFORE: Duplicate type definition (remove this)
export interface TaskMetadata {
  id: string;
  slug: string;
  title: string;
  // ...
}

// AFTER: Schema is source of truth, type is derived
import { z } from 'zod';

const SubtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});

const PendingReviewSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  markdown: z.string(),
  defaultResponse: z.string(),
  requestedAt: z.number(),
  onApprove: z.string(),
  onFeedback: z.string(),
  isAddressed: z.boolean(),
});

export const TaskMetadataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  branchName: z.string(),
  type: z.enum(["work", "investigate", "simple"]),
  subtasks: z.array(SubtaskSchema),
  status: z.enum(["draft", "backlog", "todo", "in-progress", "in-review", "done", "cancelled"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  parentId: z.string().nullable(),
  tags: z.array(z.string()),
  sortOrder: z.number(),
  repositoryName: z.string().optional(),
  pendingReviews: z.array(PendingReviewSchema),
  reviewApproved: z.boolean().optional(),
  prUrl: z.string().optional(),
});

// Type derived from schema - NOT a separate interface
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type PendingReview = z.infer<typeof PendingReviewSchema>;

// Keep input types as plain interfaces (function parameters, not persisted)
export interface CreateTaskInput { ... }
export interface UpdateTaskInput { ... }
```

---

### 2. `/core/services/task/metadata-service.ts`

**Current State**: Uses `JSON.parse(content)` directly without validation (line ~27)

**Recommended Action**: Validate with schema after parsing.

```typescript
// BEFORE
get(taskSlug: string): TaskMetadata {
  const metadataPath = this.getMetadataPath(taskSlug);
  const content = this.fs.readFile(metadataPath);
  return JSON.parse(content);  // No validation!
}

// AFTER
import { TaskMetadataSchema } from '@core/types/tasks';

get(taskSlug: string): TaskMetadata {
  const metadataPath = this.getMetadataPath(taskSlug);
  const content = this.fs.readFile(metadataPath);
  return TaskMetadataSchema.parse(JSON.parse(content));
}
```

---

### 3. `/core/services/thread/thread-service.ts`

**Current State**: Uses `JSON.parse(content)` directly without validation (line ~84)

**Issue**: `ThreadMetadata` is loaded from disk at trust boundary.

**Note**: The type `ThreadMetadata` is defined in `src/entities/threads/types.ts` (outside core). The schema should be added there and imported.

**Recommended Action**: Add schema to `src/entities/threads/types.ts`, derive type from schema, and validate in service.

```typescript
// In src/entities/threads/types.ts - replace interfaces with schemas

import { z } from 'zod';

// Schema is source of truth
export const ThreadTurnSchema = z.object({
  index: z.number(),
  prompt: z.string(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  exitCode: z.number().optional(),
  costUsd: z.number().optional(),
});

export const ThreadMetadataSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentType: z.string(),
  workingDirectory: z.string(),
  status: z.enum(["idle", "running", "completed", "error", "paused"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  ttlMs: z.number().optional(),
  git: z.object({
    branch: z.string(),
    commitHash: z.string().optional(),
  }).optional(),
  turns: z.array(ThreadTurnSchema),
});

// Types derived from schemas - NOT separate interfaces
export type ThreadTurn = z.infer<typeof ThreadTurnSchema>;
export type ThreadMetadata = z.infer<typeof ThreadMetadataSchema>;

// Keep input types as plain interfaces (function parameters)
export interface CreateThreadInput { ... }
export interface UpdateThreadInput { ... }
```

```typescript
// In core/services/thread/thread-service.ts
import { ThreadMetadataSchema } from '@/entities/threads/types';

get(taskSlug: string, folderName: string): ThreadMetadata {
  const metadataPath = this.getMetadataPath(taskSlug, folderName);
  const content = this.fs.readFile(metadataPath);
  return ThreadMetadataSchema.parse(JSON.parse(content));
}
```

---

### 4. `/core/services/repository/settings-service.ts`

**Current State**: Uses `JSON.parse(content)` and a manual `migrateSettings()` function (lines ~73-92, ~124)

**Issue**: `RepositorySettings` is loaded from disk. The `migrateSettings()` and `migrateWorktreeClaim()` functions do manual type-unsafe validation/migration.

**Note**: The type `RepositorySettings` is defined in `src/entities/repositories/types.ts` (outside core).

**Recommended Action**: Add schemas to `src/entities/repositories/types.ts`, derive types from schemas, and replace manual migration with Zod schema + transforms.

```typescript
// In src/entities/repositories/types.ts - replace interfaces with schemas

import { z } from 'zod';

// Schemas are source of truth
export const TaskBranchInfoSchema = z.object({
  branch: z.string(),
  baseBranch: z.string(),
  mergeBase: z.string(),
  parentTaskId: z.string().optional(),
  createdAt: z.number(),
});

export const WorktreeClaimSchema = z.object({
  taskId: z.string(),
  threadIds: z.array(z.string()),
  claimedAt: z.number(),
});

export const WorktreeStateSchema = z.object({
  path: z.string(),
  version: z.number(),
  currentBranch: z.string().nullable(),
  claim: WorktreeClaimSchema.nullable(),
  lastReleasedAt: z.number().optional(),
  lastTaskId: z.string().optional(),
});

export const RepositorySettingsSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  originalUrl: z.string().nullable(),
  sourcePath: z.string(),
  useWorktrees: z.boolean(),
  defaultBranch: z.string(),
  createdAt: z.number(),
  worktrees: z.array(WorktreeStateSchema),
  taskBranches: z.record(z.string(), TaskBranchInfoSchema),
  lastUpdated: z.number(),
});

// Types derived from schemas - NOT separate interfaces
export type TaskBranchInfo = z.infer<typeof TaskBranchInfoSchema>;
export type WorktreeClaim = z.infer<typeof WorktreeClaimSchema>;
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;
export type RepositorySettings = z.infer<typeof RepositorySettingsSchema>;
```

**Migration handling**: The current `migrateSettings()` function handles old data formats. With Zod, you can use `.transform()` and `.preprocess()` for migrations:

```typescript
// Migration for old WorktreeClaim format (threadId -> threadIds)
const WorktreeClaimSchema = z.preprocess(
  (data: unknown) => {
    if (data && typeof data === 'object' && 'threadId' in data) {
      // Old format: { threadId: string }
      const old = data as { threadId: string; taskId: string; claimedAt?: number };
      return {
        taskId: old.taskId,
        threadIds: [old.threadId],
        claimedAt: old.claimedAt ?? Date.now(),
      };
    }
    return data;
  },
  z.object({
    taskId: z.string(),
    threadIds: z.array(z.string()),
    claimedAt: z.number(),
  })
);

// Add defaultBranch if missing
const RepositorySettingsSchema = z.object({
  // ... other fields
  defaultBranch: z.string().default('main'),
  worktrees: z.array(WorktreeStateSchema).default([]),
  // ...
});
```

---

### 5. `/core/services/resolution-service.ts`

**Current State**: Multiple `JSON.parse()` calls without validation (lines ~52, ~67, ~93)

**Recommended Action**: Use schemas for validation. This service reads both `TaskMetadata` and `ThreadMetadata` from disk.

```typescript
// BEFORE
const meta = JSON.parse(await this.fs.readFile(metaPath));
if (meta.id === threadId) { ... }

// AFTER
import { ThreadMetadataSchema } from '@/entities/threads/types';
import { TaskMetadataSchema } from '@core/types/tasks';

const raw = JSON.parse(await this.fs.readFile(metaPath));
const meta = ThreadMetadataSchema.parse(raw);
if (meta.id === threadId) { ... }
```

---

## Types Correctly NOT Using Zod

These are internal interfaces that describe code structure, not data from external sources:

### `/core/adapters/types.ts`
- `FileSystemAdapter` - Interface with methods (cannot validate)
- `GitAdapter` - Interface with methods (cannot validate)
- `PathLock` - Interface with methods (cannot validate)
- `Logger` - Interface with methods (cannot validate)
- `WorktreeInfo` - Return type from git commands (internal, created by our code)
- `LockInfo` - Internal struct used by `PathLock` (see note below)
- `AcquireOptions` - Function parameter options

**Note on `LockInfo`**: While `path-lock.ts` does `JSON.parse()` on lock files, these files are written by the same process moments before. The lock file format is entirely controlled by our code and not a trust boundary crossing - if it's corrupted, the process that wrote it is already broken. This is correctly left as a plain interface.

### `/core/types/index.ts`
- `TaskId`, `ThreadId`, `RepoPath` - Simple type aliases (nothing to validate)
- `THREADS_DIR`, `TASKS_DIR`, `STATE_FILE` - Constants

### `/core/types/resolution.ts`
- `TaskResolution` - Internal result type (created by our code, never persisted)
- `ThreadResolution` - Internal result type (created by our code, never persisted)

### `/core/types/events.ts`

These types describe data that crosses IPC boundaries (agent stdout to Tauri). However, the **validation should happen at the consumer** (Tauri frontend when parsing agent stdout), not in the type definitions within core.

Current internal types that remain correctly as plain interfaces:
- `EventPayloads` - Internal type mapping for compile-time safety
- `AgentEventMessage`, `AgentStateMessage`, `AgentLogMessage` - Internal types
- `ThreadState`, `FileChange`, `ResultMetrics`, `ToolExecutionState` - Internal types

**Future consideration**: A schema for parsing agent stdout should exist where agent output is consumed (likely in `src/` or frontend code). This is out of scope for the `/core/` audit but noted for a future `src/` audit.

### `/core/services/task/draft-service.ts`
- `CreateDraftOptions` - Function parameter interface

### `/core/services/worktree/allocation-service.ts`
- `AllocateOptions` - Function parameter interface
- `BranchResolution` - Internal result type
- `WorktreeAllocation` - Internal result type

### `/core/services/fs-adapter.ts`
- `FSAdapter` - Interface with async methods (cannot validate)

---

## Migration Priority

1. **High Priority** - Task metadata (most commonly read, most likely to have schema drift)
   - Add `TaskMetadataSchema` to `core/types/tasks.ts`
   - **Remove duplicate `TaskMetadata` interface** - use `z.infer<>` instead
   - Update `metadata-service.ts` to validate

2. **High Priority** - Repository settings (already has manual migration logic that should be replaced)
   - Add schemas to `src/entities/repositories/types.ts`
   - **Remove duplicate interfaces** - use `z.infer<>` instead
   - Replace `migrateSettings()` with Zod preprocess/transform
   - Update `settings-service.ts` to use schema

3. **Medium Priority** - Thread metadata
   - Add `ThreadMetadataSchema` to `src/entities/threads/types.ts`
   - **Remove duplicate `ThreadMetadata` interface** - use `z.infer<>` instead
   - Update `thread-service.ts` to validate

4. **Medium Priority** - Resolution service
   - Update to use schemas when parsing metadata
   - This will automatically work once schemas are added to the type files

---

## Implementation Checklist

For each type that needs migration:

- [ ] **1. TaskMetadata** (`core/types/tasks.ts`)
  - [ ] Add `SubtaskSchema`, `PendingReviewSchema`, `TaskMetadataSchema`
  - [ ] Remove duplicate `interface Subtask`, `interface PendingReview`, `interface TaskMetadata`
  - [ ] Add `type X = z.infer<typeof XSchema>` exports
  - [ ] Keep `CreateTaskInput`, `UpdateTaskInput` as plain interfaces
  - [ ] Update `metadata-service.ts` to call `.parse()` after `JSON.parse()`
  - [ ] Update `resolution-service.ts` to call `.parse()` after `JSON.parse()`

- [ ] **2. ThreadMetadata** (`src/entities/threads/types.ts`)
  - [ ] Add `ThreadTurnSchema`, `ThreadMetadataSchema`
  - [ ] Remove duplicate `interface ThreadTurn`, `interface ThreadMetadata`
  - [ ] Add `type X = z.infer<typeof XSchema>` exports
  - [ ] Keep `CreateThreadInput`, `UpdateThreadInput` as plain interfaces
  - [ ] Update `thread-service.ts` to call `.parse()` after `JSON.parse()`

- [ ] **3. RepositorySettings** (`src/entities/repositories/types.ts`)
  - [ ] Add all schemas with migration transforms (handle `threadId` -> `threadIds`)
  - [ ] Remove duplicate interfaces
  - [ ] Add `type X = z.infer<typeof XSchema>` exports
  - [ ] Keep `CreateRepositoryInput`, `UpdateRepositoryInput` as plain interfaces
  - [ ] Update `settings-service.ts` to use schema (remove manual `migrateSettings()`)

---

## Notes

- Schemas live alongside their types per the pattern doc
- Input types (`CreateTaskInput`, `UpdateTaskInput`, etc.) remain plain interfaces - they're function parameters validated at compile time
- **Key principle**: Each persisted type should have ONE source of truth (the schema), with the type derived via `z.infer<>`
- The migration can be done incrementally - each service can be updated independently
- Consider adding `.safeParse()` variants for cases where graceful failure handling is needed
- Run existing tests after each migration to catch regressions
