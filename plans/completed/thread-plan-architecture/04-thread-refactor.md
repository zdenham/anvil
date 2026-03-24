# 04: Thread Entity Refactor

**Dependencies:** 01-core-types.md, 02-storage-layer.md
**Can run parallel with:** 05-plan-entity.md, 09-tauri-backend.md

## Goal

Update the thread entity to work with the new architecture (no tasks, repo/worktree scoped).

## Tasks

### 1. Update thread store

Update `src/entities/threads/store.ts`:

**Keep existing patterns:**
- Keep `Record<string, ThreadMetadata>` (not Map)
- Keep `_applyCreate`, `_applyUpdate`, `_applyDelete` methods with rollback functions
- Services remain the only writers to stores (per entity-stores pattern)

**Changes to selectors:**

```typescript
// Remove these task-based selectors:
// - getThreadsByTask(taskId: string)
// - getUnreadThreadsByTask(taskId: string)

// Add these repo/worktree-based selectors:
getThreadsByRepo: (repoId: string) => ThreadMetadata[]
getThreadsByWorktree: (worktreeId: string) => ThreadMetadata[]
getRunningThreads: () => ThreadMetadata[]
getUnreadThreads: () => ThreadMetadata[]
```

### 2. Update thread service

Update `src/entities/threads/service.ts`:

**Per decision #6:** Use the existing `persistence` layer directly. Do NOT create new `*StorageService` classes.

**Key changes:**
- Remove all task-related logic (taskId index, task slug resolution, task-scoped paths)
- Add `repoId` and `worktreeId` parameters (both required per decision #12)
- Update path resolution to use new top-level thread storage path: `~/.anvil/threads/{threadId}/`
- Working directory is derived from repo/worktree lookup, not stored on ThreadMetadata

**Updated create method signature:**

```typescript
async create(params: {
  repoId: string       // Required - UUID of repository
  worktreeId: string   // Required - UUID of worktree (main repo is also a worktree)
  git?: { branch: string; commitHash: string }
}): Promise<ThreadMetadata>
```

**Note:** The main repository counts as a worktree, so every thread has both `repoId` and `worktreeId`.

**Remove:**
- `threadTaskIndex` and all task-based indexing
- `getTaskSlug()` helper
- `getByTask()` method
- `refreshByTask()` method
- Task-based path resolution

**Add:**
- `getByRepo(repoId: string)` method
- `getByWorktree(worktreeId: string)` method

**Path resolution changes:**
```typescript
// Old path (task-scoped):
// ~/.anvil/tasks/{taskSlug}/threads/{agentType}-{threadId}/

// New path (top-level):
// ~/.anvil/threads/{threadId}/
function getThreadPath(threadId: string): string {
  return `threads/${threadId}`;
}
```

### 3. Update thread listeners

Update `src/entities/threads/listeners.ts`:

- Remove task-related event listeners
- Add listeners for new thread events that trigger disk re-reads (per disk-as-truth pattern):
  - `THREAD_CREATED` → refresh thread from disk
  - `THREAD_UPDATED` → refresh thread from disk
  - `THREAD_STATUS_CHANGED` → refresh thread from disk
  - `THREAD_ARCHIVED` → remove thread from store or move to archived

### 4. Rename task-changes to thread-changes

Rename `src/components/workspace/task-changes.tsx` → `thread-changes.tsx`:

- Update component name from `TaskChanges` to `ThreadChanges`
- Remove any task references
- Update imports throughout codebase

**Note:** This component has no actual task-specific logic - it just renders a `DiffViewer`. The rename is primarily a naming change, not a functional refactor.

### 5. Update thread-related hooks

Update `src/hooks/use-navigate-to-next-task.ts` → `use-navigate-to-next-thread.ts`:

- Rename file and hook
- Update logic to work with threads only (no task grouping)

### 6. Update working directory derivation

Create utility for deriving working directory from repo/worktree:

```typescript
// src/entities/threads/utils.ts
import type { RepositorySettings, WorktreeState } from '@core/types/repositories';

export function deriveWorkingDirectory(
  thread: ThreadMetadata,
  repoSettings: RepositorySettings
): string {
  // Find the worktree by matching worktreeId
  // Note: WorktreeState uses path/name, not id. The worktreeId on ThreadMetadata
  // will need to reference worktrees by path or name (to be determined in 01-core-types.md)
  const worktree = repoSettings.worktrees.find(
    wt => wt.path === thread.worktreeId || wt.name === thread.worktreeId
  );

  if (worktree) {
    return worktree.path;
  }

  // Fallback to main repo source path
  return repoSettings.sourcePath;
}
```

**Note:** The current `WorktreeState` type doesn't have an `id` field - only `path`, `name`, `lastAccessedAt`, `currentBranch`. Plan 01-core-types.md should add a worktree ID field to `WorktreeStateSchema`, or this plan should document how worktree lookup works (by path or name).

### 7. Update metadata/state separation

Ensure clear separation:

**metadata.json** (small, always loaded):
- id, repoId, worktreeId, status, turns, git, isRead, pid, timestamps

**state.json** (large, loaded on demand):
- messages, fileChanges, toolStates

**Note on type changes from 01-core-types.md:**
- `taskId` removed
- `agentType` removed
- `workingDirectory` removed (now derived)
- `repoId` added (required)
- `worktreeId` added (required)
- `title` NOT added (per decision #4 - display last user message instead)
- `planId` NOT added (per decision #1 - use relations table)
- Timestamps remain as `number` (Unix milliseconds, per decision #5)

## Dependency Notes

**Consumes from 01-core-types.md:**
- Updated ThreadMetadata type (no taskId, no agentType, no workingDirectory, required repoId/worktreeId)

**Consumes from 02-storage-layer.md:**
- Thread path resolution (`~/.anvil/threads/{threadId}/`)
- Archive support
- Updated hydrate methods

**Forward compatibility:**
- 06-relations.md will add `getRelatedPlans()` method to query thread-plan relationships
- This plan's changes should not block that addition - thread service interface is extensible

## Acceptance Criteria

- [ ] ThreadMetadata no longer has taskId
- [ ] ThreadMetadata has repoId (required) and worktreeId (required)
- [ ] Thread store has `getThreadsByRepo()` and `getThreadsByWorktree()` selectors
- [ ] Thread store keeps `Record<string, ThreadMetadata>` and `_apply*` methods with rollback functions
- [ ] Thread service uses existing `persistence` layer directly (no new storage service classes)
- [ ] Thread paths are top-level: `~/.anvil/threads/{threadId}/`
- [ ] Working directory is derived from repo/worktree lookup, not stored
- [ ] task-changes.tsx renamed to thread-changes.tsx
- [ ] use-navigate-to-next-task.ts renamed and updated
- [ ] All imports updated
- [ ] Event listeners follow disk-as-truth pattern
- [ ] TypeScript compiles

## Programmatic Testing Plan

The implementation agent must write and pass all of the following tests before considering this plan complete. All tests should be automated unit/integration tests.

### Thread Store Tests (`src/entities/threads/__tests__/store.test.ts`)

1. **Selector tests:**
   - `getThreadsByRepo(repoId)` returns only threads matching the given repoId
   - `getThreadsByRepo(repoId)` returns empty array when no threads match
   - `getThreadsByWorktree(worktreeId)` returns only threads matching the given worktreeId
   - `getThreadsByWorktree(worktreeId)` returns empty array when no threads match
   - `getRunningThreads()` returns only threads with `status === 'running'`
   - `getUnreadThreads()` returns only threads with `isRead === false`

2. **Store mutation tests:**
   - `_applyCreate` adds thread to store and returns working rollback function
   - `_applyUpdate` modifies thread in store and returns working rollback function
   - `_applyDelete` removes thread from store and returns working rollback function
   - Rollback functions restore previous state correctly

3. **Removal verification tests:**
   - Store does NOT have `getThreadsByTask` selector (should error or not exist)
   - Store does NOT have `getUnreadThreadsByTask` selector (should error or not exist)

### Thread Service Tests (`src/entities/threads/__tests__/service.test.ts`)

1. **Create method tests:**
   - `create({ repoId, worktreeId })` creates thread with both IDs set
   - `create({ repoId, worktreeId, git })` creates thread with git info attached
   - Created thread is persisted to `~/.anvil/threads/{threadId}/metadata.json`
   - Created thread metadata does NOT contain `taskId`, `agentType`, or `workingDirectory` fields

2. **Query method tests:**
   - `getByRepo(repoId)` returns all threads for that repo
   - `getByWorktree(worktreeId)` returns all threads for that worktree
   - Both methods return empty arrays when no matches exist

3. **Path resolution tests:**
   - Thread path resolves to `threads/{threadId}` (not task-scoped path)
   - Thread metadata is read from correct top-level location
   - Thread state is read from correct top-level location

4. **Removal verification tests:**
   - Service does NOT have `getByTask` method
   - Service does NOT have `refreshByTask` method
   - Service does NOT maintain `threadTaskIndex`

### Thread Listeners Tests (`src/entities/threads/__tests__/listeners.test.ts`)

1. **Disk-as-truth pattern tests:**
   - `THREAD_CREATED` event triggers refresh of thread from disk
   - `THREAD_UPDATED` event triggers refresh of thread from disk
   - `THREAD_STATUS_CHANGED` event triggers refresh of thread from disk
   - `THREAD_ARCHIVED` event removes thread from store (or moves to archived)

2. **Removal verification tests:**
   - No listeners reference task-related events

### Working Directory Utility Tests (`src/entities/threads/__tests__/utils.test.ts`)

1. **deriveWorkingDirectory tests:**
   - Returns worktree path when thread.worktreeId matches a worktree
   - Returns main repo sourcePath as fallback when worktree not found
   - Handles empty worktrees array by returning sourcePath

### Component/Hook Rename Tests

1. **Import verification tests (can be snapshot or static analysis):**
   - No imports of `task-changes.tsx` exist in codebase
   - No imports of `use-navigate-to-next-task.ts` exist in codebase
   - `thread-changes.tsx` exports `ThreadChanges` component (not `TaskChanges`)
   - `use-navigate-to-next-thread.ts` exports correctly named hook

### Integration Tests

1. **Full thread lifecycle test:**
   - Create a thread with repoId and worktreeId
   - Verify it appears in `getThreadsByRepo(repoId)` results
   - Verify it appears in `getThreadsByWorktree(worktreeId)` results
   - Update thread status to 'running'
   - Verify it appears in `getRunningThreads()` results
   - Archive the thread
   - Verify it no longer appears in active thread queries

2. **TypeScript compilation test:**
   - `tsc --noEmit` passes with no errors
   - No type errors related to removed fields (taskId, agentType, workingDirectory)
