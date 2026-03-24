# 02: Storage Layer Updates

**Dependencies:** 01-core-types.md
**Can run parallel with:** 08-control-panel.md (after 01 complete)

## Goal

Update existing entity services and stores to support the new thread-plan relationship model. This follows our established patterns: entity stores, disk-as-truth, event-driven refresh, and optimistic updates.

## Important: Existing Patterns to Follow

This codebase already has a mature storage architecture. **Do not create duplicate infrastructure.** Instead, update existing services:

| Existing Component | Location | What It Does |
|-------------------|----------|--------------|
| `persistence` | `src/lib/persistence.ts` | Single unified disk I/O layer |
| `threadService` | `src/entities/threads/service.ts` | Thread CRUD + disk operations |
| `planService` | `src/entities/plans/service.ts` | Plan CRUD + disk operations |
| Entity stores | `src/entities/*/store.ts` | Zustand stores with `_apply*` methods |
| Entity listeners | `src/entities/*/listeners.ts` | Event → disk refresh wiring |

### Key Patterns

1. **Disk as Truth** (see `docs/patterns/disk-as-truth.md`):
   - Events trigger disk re-reads, not in-memory mutations
   - Read-modify-write for shared files
   - Stale-while-revalidate for UX

2. **Entity Store Pattern** (see `docs/patterns/entity-stores.md`):
   - Single store per entity type
   - `hydrate()` called once at app start
   - `_applyCreate/Update/Delete` return rollback functions
   - Services are the only writers to stores

3. **Listeners Pattern**:
   - `listeners.ts` bridges events to service.refresh() calls
   - Setup once in `src/entities/index.ts`

## Current vs New Directory Structure

### Current Structure (threads nested under tasks)
```
~/.anvil/
  ├── tasks/{taskSlug}/
  │   ├── metadata.json
  │   └── threads/{agentType}-{threadId}/
  │       ├── metadata.json
  │       └── state.json
  └── plans/{planId}/
      └── metadata.json
```

### New Structure (threads at top level, relations in separate table)
```
~/.anvil/
  ├── threads/{threadId}/
  │   ├── metadata.json      # ThreadMetadata (no planId - use relations table)
  │   └── state.json
  ├── plans/{planId}/
  │   └── metadata.json      # PlanMetadata
  ├── plan-thread-edges/
  │   └── {planId}-{threadId}.json  # PlanThreadRelation
  └── archive/
      └── threads/           # Archived threads
```

## Tasks

### 1. ThreadMetadata type changes

**Per decision #1:** Thread-plan relationships are stored exclusively in the relations table (`~/.anvil/plan-thread-edges/`). There is NO `planId` or `planIds` field on ThreadMetadata.

The ThreadMetadata type will be updated per 01-core-types.md:
- Remove `taskId`, `agentType`, `workingDirectory`
- Add `repoId`, `worktreeId` (both required)
- No `planId` field - use relations table for thread-plan associations

### 2. Update threadService path resolution

In `src/entities/threads/service.ts`:

**Update path helpers** to support new top-level thread storage:

```typescript
const THREADS_DIR = "threads";  // New: top-level threads

// New path helper for standalone threads
function getStandaloneThreadPath(threadId: string): string {
  return `${THREADS_DIR}/${threadId}`;
}

// Keep existing task-based path for migration/backwards compat
function getLegacyThreadPath(taskId: string, agentType: string, threadId: string): string {
  // ... existing implementation
}
```

**Update `findThreadPath()`** to check both locations:

```typescript
async function findThreadPath(threadId: string): Promise<string | undefined> {
  // Check new location first
  const newPath = `${THREADS_DIR}/${threadId}/metadata.json`;
  if (await persistence.exists(newPath)) {
    return `${THREADS_DIR}/${threadId}`;
  }

  // Fall back to legacy task-nested location
  const legacyPattern = `tasks/*/threads/*-${threadId}/metadata.json`;
  const matches = await persistence.glob(legacyPattern);
  if (matches.length > 0) {
    return matches[0].replace(/\/metadata\.json$/, "");
  }

  return undefined;
}
```

**Update `create()`** to write to new top-level location:

```typescript
async create(input: CreateThreadInput): Promise<ThreadMetadata> {
  // All threads go to new top-level structure
  const threadPath = getStandaloneThreadPath(metadata.id);

  // ... rest of implementation unchanged (uses optimistic())
}
```

**Note:** Thread-plan associations are NOT stored on ThreadMetadata. Use the relations service (06-relations.md) to manage thread-plan relationships via the `~/.anvil/plan-thread-edges/` directory.

### 3. Update threadService.hydrate() for new structure

```typescript
async hydrate(): Promise<void> {
  const threads: Record<string, ThreadMetadata> = {};

  // Load from new top-level structure
  const newPattern = `${THREADS_DIR}/*/metadata.json`;
  const newFiles = await persistence.glob(newPattern);

  // Load from legacy task-nested structure (backwards compat during transition)
  const legacyPattern = `tasks/*/threads/*/metadata.json`;
  const legacyFiles = await persistence.glob(legacyPattern);

  const allFiles = [...newFiles, ...legacyFiles];

  await Promise.all(
    allFiles.map(async (filePath) => {
      const raw = await persistence.readJson(filePath);
      const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
      if (result?.success) {
        threads[result.data.id] = result.data;
      }
    })
  );

  useThreadStore.getState().hydrate(threads);
}
```

### 4. Add archive support to threadService

```typescript
async archive(threadId: string): Promise<void> {
  const thread = this.get(threadId);
  if (!thread) return;

  const sourcePath = await findThreadPath(threadId);
  if (!sourcePath) return;

  const archivePath = `archive/threads/${threadId}`;

  // Move to archive (copy then delete)
  const rollback = useThreadStore.getState()._applyDelete(threadId);
  try {
    await persistence.ensureDir('archive/threads');
    // Copy metadata and state
    const metadata = await persistence.readJson(`${sourcePath}/metadata.json`);
    const state = await persistence.readJson(`${sourcePath}/state.json`);

    await persistence.ensureDir(archivePath);
    if (metadata) await persistence.writeJson(`${archivePath}/metadata.json`, metadata);
    if (state) await persistence.writeJson(`${archivePath}/state.json`, state);

    // Remove original
    await persistence.removeDir(sourcePath);

    // Emit event so relation service can archive associated relations
    eventBus.emit(EventName.THREAD_ARCHIVED, { threadId });
  } catch (error) {
    rollback();
    throw error;
  }
}

async listArchived(): Promise<ThreadMetadata[]> {
  const pattern = `archive/threads/*/metadata.json`;
  const files = await persistence.glob(pattern);
  const threads: ThreadMetadata[] = [];

  for (const filePath of files) {
    const raw = await persistence.readJson(filePath);
    const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
    if (result?.success) {
      threads.push(result.data);
    }
  }

  return threads;
}
```

### 5. Update useThreadStore

**Note:** Per decision #1, there is no `planId` on ThreadMetadata. Thread-plan queries should use the relations service instead:

```typescript
// Use relations service to get threads for a plan:
const relations = await relationService.getByPlan(planId);
const threadIds = relations.map(r => r.threadId);
const threads = threadIds.map(id => useThreadStore.getState().get(id)).filter(Boolean);
```

No `getThreadsByPlan` selector is needed on the thread store.

### 6. Update thread listeners for plan events

**Per decision #9:** Plans are archived, not deleted. There is no `PLAN_DELETED` event.

When a plan is archived, the relation service (06-relations.md) handles archiving the associated relations. No thread listener changes needed for plan events.

### 7. Events

**Per decision #9:** The following canonical events are relevant to this plan:

**Thread events (emitted by threadService):**
- `THREAD_CREATED` - when a thread is created
- `THREAD_UPDATED` - when a thread is updated
- `THREAD_STATUS_CHANGED` - when thread status changes
- `THREAD_ARCHIVED` - when a thread is archived

**Plan events (for reference - defined in 05-plan-entity.md):**
- `PLAN_CREATED` - when a plan is created
- `PLAN_UPDATED` - when a plan is updated
- `PLAN_ARCHIVED` - when a plan is archived (no `PLAN_DELETED` event)

The threadService.archive() method must emit `THREAD_ARCHIVED` so the relation service can archive associated relations.

## Migration Notes

- Existing threads under `tasks/*/threads/` continue to work (hydrate loads both locations)
- New plan-linked threads go to `threads/{id}/`
- No immediate migration of existing data required
- Legacy path resolution remains as fallback

## Acceptance Criteria

- [ ] ThreadMetadata does NOT have `planId` field (use relations table instead)
- [ ] threadService.hydrate() loads from both `threads/` and legacy `tasks/*/threads/` locations
- [ ] threadService.create() writes to new `threads/{threadId}/` location
- [ ] threadService.findThreadPath() checks new location first, falls back to legacy
- [ ] threadService.archive() moves threads to `archive/threads/` directory
- [ ] threadService.archive() emits `THREAD_ARCHIVED` event after successful archive
- [ ] threadService.listArchived() returns archived threads
- [ ] All operations use existing `persistence` layer (no new storage utilities)
- [ ] All operations follow optimistic update pattern with rollback
- [ ] Unit tests for hydrate(), create(), archive(), listArchived(), findThreadPath()

## Programmatic Testing Plan

The implementation agent must write and pass all of the following tests before this plan is considered complete. Tests should be placed in `src/entities/threads/__tests__/` following existing test patterns.

### Test File: `service.test.ts`

#### Path Resolution Tests

1. **`getStandaloneThreadPath returns correct path`**
   - Input: `threadId = "abc123"`
   - Expected output: `"threads/abc123"`

2. **`findThreadPath returns new location when thread exists there`**
   - Setup: Create mock file at `threads/abc123/metadata.json`
   - Input: `threadId = "abc123"`
   - Expected: Returns `"threads/abc123"`

3. **`findThreadPath falls back to legacy location`**
   - Setup: Create mock file at `tasks/my-task/threads/agent-abc123/metadata.json` (no file in new location)
   - Input: `threadId = "abc123"`
   - Expected: Returns the legacy path `"tasks/my-task/threads/agent-abc123"`

4. **`findThreadPath returns undefined when thread not found`**
   - Setup: No mock files
   - Input: `threadId = "nonexistent"`
   - Expected: Returns `undefined`

5. **`findThreadPath prefers new location over legacy`**
   - Setup: Create mock files at BOTH `threads/abc123/metadata.json` AND `tasks/my-task/threads/agent-abc123/metadata.json`
   - Input: `threadId = "abc123"`
   - Expected: Returns `"threads/abc123"` (new location takes precedence)

#### Hydrate Tests

6. **`hydrate loads threads from new top-level structure`**
   - Setup: Create mock threads in `threads/thread1/metadata.json` and `threads/thread2/metadata.json` with valid ThreadMetadata
   - Action: Call `threadService.hydrate()`
   - Assert: `useThreadStore.getState().get("thread1")` and `useThreadStore.getState().get("thread2")` return the correct metadata

7. **`hydrate loads threads from legacy task-nested structure`**
   - Setup: Create mock thread at `tasks/task1/threads/agent-thread3/metadata.json` with valid ThreadMetadata
   - Action: Call `threadService.hydrate()`
   - Assert: `useThreadStore.getState().get("thread3")` returns the correct metadata

8. **`hydrate loads threads from both locations simultaneously`**
   - Setup: Create mock threads in BOTH new (`threads/thread1/`) AND legacy (`tasks/task1/threads/agent-thread2/`) locations
   - Action: Call `threadService.hydrate()`
   - Assert: Both threads are present in the store

9. **`hydrate skips invalid metadata files`**
   - Setup: Create one valid thread and one file with invalid JSON/schema
   - Action: Call `threadService.hydrate()`
   - Assert: Valid thread is loaded, invalid one is skipped (no crash)

#### Create Tests

10. **`create writes to new top-level location`**
    - Input: Valid CreateThreadInput
    - Action: Call `threadService.create(input)`
    - Assert: `persistence.writeJson` was called with path `"threads/{threadId}/metadata.json"`
    - Assert: Returns created ThreadMetadata

11. **`create applies optimistic update to store`**
    - Action: Call `threadService.create(input)`
    - Assert: Thread appears in store immediately (before disk write completes in test)

12. **`create rolls back on persistence failure`**
    - Setup: Mock `persistence.writeJson` to throw an error
    - Action: Call `threadService.create(input)`
    - Assert: Thread is NOT in the store after error
    - Assert: Error is propagated

#### Archive Tests

13. **`archive moves thread to archive directory`**
    - Setup: Create mock thread at `threads/abc123/metadata.json` and `threads/abc123/state.json`
    - Action: Call `threadService.archive("abc123")`
    - Assert: Files exist at `archive/threads/abc123/metadata.json` and `archive/threads/abc123/state.json`
    - Assert: Original directory `threads/abc123/` is removed

14. **`archive emits THREAD_ARCHIVED event`**
    - Setup: Create mock thread, subscribe to eventBus for `THREAD_ARCHIVED`
    - Action: Call `threadService.archive("abc123")`
    - Assert: Event was emitted with `{ threadId: "abc123" }`

15. **`archive removes thread from store`**
    - Setup: Create mock thread and ensure it's in the store
    - Action: Call `threadService.archive("abc123")`
    - Assert: `useThreadStore.getState().get("abc123")` returns `undefined`

16. **`archive rolls back on failure`**
    - Setup: Create mock thread, mock `persistence.removeDir` to throw error
    - Action: Call `threadService.archive("abc123")`
    - Assert: Thread is still in the store (rollback applied)
    - Assert: Error is propagated

17. **`archive handles non-existent thread gracefully`**
    - Action: Call `threadService.archive("nonexistent")`
    - Assert: No error thrown, function returns early

18. **`archive works for threads in legacy location`**
    - Setup: Create mock thread at legacy path `tasks/task1/threads/agent-abc123/`
    - Action: Call `threadService.archive("abc123")`
    - Assert: Thread is moved to `archive/threads/abc123/`

#### ListArchived Tests

19. **`listArchived returns all archived threads`**
    - Setup: Create mock archived threads at `archive/threads/thread1/metadata.json` and `archive/threads/thread2/metadata.json`
    - Action: Call `threadService.listArchived()`
    - Assert: Returns array with both ThreadMetadata objects

20. **`listArchived returns empty array when no archived threads`**
    - Setup: No files in archive directory
    - Action: Call `threadService.listArchived()`
    - Assert: Returns empty array `[]`

21. **`listArchived skips invalid metadata files`**
    - Setup: Create one valid and one invalid archived thread metadata
    - Action: Call `threadService.listArchived()`
    - Assert: Returns only the valid thread, no crash

### Test File: `store.test.ts`

22. **`store.hydrate populates threads correctly`**
    - Action: Call `useThreadStore.getState().hydrate({ thread1: metadata1, thread2: metadata2 })`
    - Assert: `get("thread1")` and `get("thread2")` return correct data

23. **`_applyCreate adds thread to store and returns rollback`**
    - Action: Call `useThreadStore.getState()._applyCreate(metadata)`
    - Assert: Thread is in store
    - Action: Call returned rollback function
    - Assert: Thread is no longer in store

24. **`_applyDelete removes thread from store and returns rollback`**
    - Setup: Add thread to store
    - Action: Call `useThreadStore.getState()._applyDelete(threadId)`
    - Assert: Thread is NOT in store
    - Action: Call returned rollback function
    - Assert: Thread is back in store

### Test File: `schema.test.ts`

25. **`ThreadMetadata schema does NOT accept planId field`**
    - Input: Valid ThreadMetadata object WITH a `planId` field added
    - Action: Parse with `ThreadMetadataSchema.safeParse()`
    - Assert: Either the result strips the `planId` field OR fails validation (depending on strict mode)
    - Note: Verify `planId` is NOT part of the type definition

26. **`ThreadMetadata schema requires repoId and worktreeId`**
    - Input: ThreadMetadata missing `repoId`
    - Assert: Schema validation fails
    - Input: ThreadMetadata missing `worktreeId`
    - Assert: Schema validation fails

27. **`ThreadMetadata schema rejects taskId, agentType, workingDirectory`**
    - Input: Objects with legacy fields
    - Assert: Schema either strips these fields or fails validation

### Integration Test File: `integration.test.ts`

28. **`full lifecycle: create, archive, listArchived`**
    - Action: Create a thread via `threadService.create()`
    - Assert: Thread exists in store
    - Action: Archive the thread via `threadService.archive()`
    - Assert: Thread NOT in store, IS in `listArchived()` results
    - Assert: `THREAD_ARCHIVED` event was emitted

29. **`hydrate after archive does not load archived threads into main store`**
    - Setup: Create and archive a thread
    - Action: Clear store and call `threadService.hydrate()`
    - Assert: Archived thread is NOT in main store
    - Assert: Archived thread IS returned by `listArchived()`

## What NOT to Do

- Do NOT create new storage service classes (ThreadStorageService, etc.)
- Do NOT create separate path utility files
- Do NOT duplicate Zod schemas (they live in `*/types.ts`)
- Do NOT bypass the persistence layer
- Do NOT skip the listeners pattern for event handling
- Do NOT write directly to stores from outside services
- Do NOT add `planId` to ThreadMetadata - use the relations table instead
