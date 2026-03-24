# Threads Within Tasks Directory Structure

## Overview

Restructure the storage layout so threads live inside their parent task directories, with folder names prefixed by agent type.

**Current structure:**
```
.anvil/
├── tasks/{taskId}/
│   ├── metadata.json
│   └── content.md
└── threads/{uuid}/
    ├── metadata.json
    └── state.json
```

**New structure:**
```
.anvil/tasks/{taskId}/
├── metadata.json
├── content.md
└── threads/
    ├── entrypoint-{uuid}/
    │   ├── metadata.json
    │   └── state.json
    ├── execution-{uuid}/
    │   ├── metadata.json
    │   └── state.json
    └── review-{uuid}/
        ├── metadata.json
        └── state.json
```

## Key Changes

### 1. Thread Folder Naming Convention

Format: `{agentType}-{uuid}`

Examples:
- `entrypoint-550e8400-e29b-41d4-a716-446655440000`
- `execution-6ba7b810-9dad-11d1-80b4-00c04fd430c8`
- `review-6ba7b811-9dad-11d1-80b4-00c04fd430c8`
- `merge-6ba7b812-9dad-11d1-80b4-00c04fd430c8`

### 2. Thread Lifecycle Invariants

**Invariant 1: Every thread must belong to a task.**

This means:
- `taskId` is non-nullable in `ThreadMetadata`
- Thread creation fails without a valid `taskId`
- The draft task must be created *before* spawning the thread
- **Routing mode is deprecated** - spotlight creates a draft task first, then spawns the thread

**Invariant 2: Deleting a task deletes all its threads.**

This means:
- Threads have no independent existence outside their task
- Task deletion is a cascading delete - all threads in `tasks/{taskId}/threads/` are removed
- No confirmation or special handling needed - threads are considered part of the task

**Invariant 3: Thread lookup by UUID uses grep-based discovery.**

This means:
- No persistent UUID→path mapping required
- When we only have a threadId, grep scans `tasks/*/threads/*-{uuid}/` pattern
- Results can be cached in-memory, refreshed liberally on cache miss
- Hydration rebuilds the index; any lookup miss triggers a re-scan

These invariants simplify the architecture significantly - no orphan threads, no moving threads between locations, no null checks on task association, and clear ownership semantics.

### 3. Thread Identity

Thread identity becomes: `{taskId}/{agentType}-{uuid}`

But we still need a globally unique identifier for:
- Event subscriptions
- IPC communication
- Quick lookups without knowing task

**Solution:** Keep UUID as primary identifier, but:
- `taskId` is stored in thread metadata (non-nullable)
- Thread service maintains in-memory index: `uuid → taskId`
- Index rebuilt on hydration
- Cache misses trigger grep-based discovery and index update

### 4. Deprecate Routing Mode

**Current flow (deprecated):**
1. Spotlight spawns entrypoint thread with `taskId: null`
2. Agent determines task context
3. Agent creates task
4. Thread is associated with task via `associateWithTask()`

**New flow:**
1. Spotlight creates a **draft task** first
2. Spotlight spawns thread with the draft task's `taskId`
3. Agent refines the draft task (updates title, description, etc.)
4. No association step needed - thread already belongs to task

---

## Implementation Steps

### Phase 1: Update Type Definitions

**File:** `src/entities/threads/types.ts`

1. Make `taskId` non-nullable in `ThreadMetadata`:
```ts
export interface ThreadMetadata {
  id: string;
  agentType: AgentType;
  taskId: string;  // CHANGED - now required, every thread belongs to a task
  // ... rest unchanged
}
```

2. Update `CreateThreadInput` to require `taskId`:
```ts
export interface CreateThreadInput {
  id?: string;
  taskId: string;  // CHANGED - now required
  agentType: string;
  // ... rest unchanged
}
```

3. Create helpers for folder name:
```ts
export function getThreadFolderName(agentType: AgentType, id: string): string {
  return `${agentType}-${id}`;
}

export function parseThreadFolderName(folderName: string): { agentType: AgentType; id: string } | null {
  const match = folderName.match(/^(entrypoint|execution|review|merge)-(.+)$/);
  if (!match) return null;
  return { agentType: match[1] as AgentType, id: match[2] };
}
```

### Phase 2: Update Thread Service (Frontend)

**File:** `src/entities/threads/service.ts`

1. **Add path helpers:**
```ts
const TASKS_DIR = "tasks";

function getThreadPath(taskId: string, agentType: AgentType, id: string): string {
  const folderName = getThreadFolderName(agentType, id);
  return `${TASKS_DIR}/${taskId}/threads/${folderName}`;
}

/**
 * Find thread path by UUID using grep-based discovery.
 * Scans tasks/*/threads/ for folder containing the UUID.
 * Used when we only have threadId and need the full path.
 */
async function findThreadPath(threadId: string): Promise<string | null> {
  // Use persistence.glob or similar to find: tasks/*/threads/*-{threadId}/metadata.json
  const pattern = `${TASKS_DIR}/*/threads/*-${threadId}/metadata.json`;
  const matches = await persistence.glob(pattern);
  if (matches.length === 0) return null;
  // Return the directory (strip /metadata.json)
  return matches[0].replace(/\/metadata\.json$/, '');
}
```

2. **Add in-memory index:**
```ts
// In-memory cache: uuid → taskId
// Rebuilt on hydration, updated on create, refreshed on cache miss
let threadTaskIndex: Map<string, string> = new Map();

function getTaskIdForThread(threadId: string): string | undefined {
  return threadTaskIndex.get(threadId);
}

async function refreshThreadIndex(threadId: string): Promise<string | null> {
  const path = await findThreadPath(threadId);
  if (!path) return null;
  // Extract taskId from path: tasks/{taskId}/threads/...
  const match = path.match(/^tasks\/([^/]+)\/threads\//);
  if (match) {
    threadTaskIndex.set(threadId, match[1]);
    return match[1];
  }
  return null;
}
```

3. **Update `hydrate()`:**
   - Scan all `tasks/*/threads/*/metadata.json`
   - Parse folder names to extract agent type and UUID
   - Build UUID → taskId index

```ts
async hydrate(): Promise<void> {
  const pattern = `${TASKS_DIR}/*/threads/*/metadata.json`;
  const metadataFiles = await persistence.glob(pattern);
  const threads: Record<string, ThreadMetadata> = {};
  threadTaskIndex.clear();

  await Promise.all(
    metadataFiles.map(async (filePath) => {
      const metadata = await persistence.readJson<ThreadMetadata>(filePath);
      if (metadata) {
        threads[metadata.id] = metadata;
        threadTaskIndex.set(metadata.id, metadata.taskId);
      }
    })
  );

  useThreadStore.getState().hydrate(threads);
}
```

4. **Update `create()`:**
   - Require `taskId` parameter (throws if not provided)
   - Create thread directly in task's threads folder
   - Update index on creation

```ts
async create(input: CreateThreadInput): Promise<ThreadMetadata> {
  if (!input.taskId) {
    throw new Error("taskId is required - every thread must belong to a task");
  }

  const metadata: ThreadMetadata = {
    id: input.id ?? crypto.randomUUID(),
    taskId: input.taskId,  // Now guaranteed non-null
    // ... rest
  };

  const threadPath = getThreadPath(input.taskId, metadata.agentType, metadata.id);

  await optimistic(
    metadata,
    (thread) => useThreadStore.getState()._applyCreate(thread),
    async (thread) => {
      await persistence.ensureDir(threadPath);
      await persistence.writeJson(`${threadPath}/metadata.json`, thread);
    }
  );

  // Update index
  threadTaskIndex.set(metadata.id, input.taskId);

  // Emit for cross-window sync
  eventBus.emit("thread:created", { metadata });

  // No longer need to update task.threadIds - threads are discovered by scanning
  return metadata;
}
```

5. **Remove `associateWithTask()`:**
   - Delete this method entirely - no longer needed

6. **Update `update()`, `delete()`, and other methods:**
   - Use `getTaskIdForThread()` or `refreshThreadIndex()` to find paths
   - Fall back to grep-based discovery on cache miss

7. **Update `get()` to load from new path:**
```ts
async getFromDisk(id: string): Promise<ThreadMetadata | null> {
  let taskId = getTaskIdForThread(id);
  if (!taskId) {
    taskId = await refreshThreadIndex(id);
  }
  if (!taskId) return null;

  const thread = useThreadStore.getState().threads[id];
  if (!thread) return null;

  const path = getThreadPath(taskId, thread.agentType, id);
  return persistence.readJson<ThreadMetadata>(`${path}/metadata.json`);
}
```

### Phase 3: Update Task Service (Frontend)

**File:** `src/entities/tasks/service.ts`

1. **Update `create()`:**
   - Also create empty `threads/` subdirectory

```ts
async create(input: CreateTaskInput): Promise<TaskMetadata> {
  // ... existing creation logic

  await persistence.ensureDir(`${TASKS_DIR}/${metadata.id}`);
  await persistence.ensureDir(`${TASKS_DIR}/${metadata.id}/threads`);  // NEW
  await persistence.writeJson(`${TASKS_DIR}/${metadata.id}/metadata.json`, metadata);
  // ...
}
```

2. **Add `getThreads(taskId)`:**
```ts
async getThreads(taskId: string): Promise<ThreadMetadata[]> {
  const threadsDir = `${TASKS_DIR}/${taskId}/threads`;
  const entries = await persistence.listDirEntries(threadsDir);
  const threads: ThreadMetadata[] = [];

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory)
      .map(async (entry) => {
        const metadata = await persistence.readJson<ThreadMetadata>(
          `${threadsDir}/${entry.name}/metadata.json`
        );
        if (metadata) threads.push(metadata);
      })
  );

  return threads.sort((a, b) => b.createdAt - a.createdAt);
}
```

3. **Update `delete()`:**
   - Already recursive, will delete threads automatically
   - Clear thread index entries for deleted threads

4. **Remove `threadIds` handling:**
   - Remove all code that updates `task.threadIds`
   - Remove from `update()` input handling

### Phase 4: Update Task Types

**File:** `src/entities/tasks/types.ts`

1. Remove `threadIds` from `TaskMetadata` interface:
```ts
export interface TaskMetadata {
  id: string;
  slug: string;
  title: string;
  // ... other fields
  // threadIds: string[];  // REMOVED
}
```

2. Remove `threadIds` from `UpdateTaskInput`:
```ts
export interface UpdateTaskInput {
  // threadIds?: string[];  // REMOVED
  // ... rest unchanged
}
```

### Phase 5: Update Runner

**File:** `agents/src/runner.ts`

1. **Make `--task-id` required:**
```ts
interface Args {
  agentType: string;
  cwd: string;
  prompt: string;
  threadId: string;
  taskId: string;  // CHANGED - now required, not nullable
  anvilDir: string;
  // ... rest unchanged
}

function parseArgs(argv: string[]): Args {
  // ...
  if (!args.taskId) {
    throw new Error("--task-id is required - every thread must belong to a task");
  }
  // ...
}
```

2. **Update thread path resolution:**
```ts
// Use task-based path structure
const threadFolderName = `${args.agentType}-${args.threadId}`;
const threadPath = join(args.anvilDir, "tasks", args.taskId, "threads", threadFolderName);
const metadataPath = join(threadPath, "metadata.json");
```

**File:** `agents/src/output.ts`

3. **Update `initState()` call site:**
   - No changes needed to output.ts itself - it receives `threadPath` from runner
   - Runner is responsible for computing the correct path

### Phase 6: Update Agent Service (Frontend)

**File:** `src/lib/agent-service.ts`

1. **Make `taskId` required in `StartAgentOptions`:**
```ts
export interface StartAgentOptions {
  agentType: string;
  workingDirectory: string;
  prompt: string;
  taskId: string;  // CHANGED - now required
  // ... rest unchanged
}
```

2. **Update `prepareAgent()`:**
   - Remove null check for taskId, always pass it
   - `--task-id` is now always included in command args

```ts
// Remove the conditional - always pass task-id
commandArgs.push("--task-id", options.taskId);
```

3. **Update `resumeAgent()`:**
```ts
export async function resumeAgent(
  threadId: string,
  prompt: string,
  callbacks: AgentStreamCallbacks
): Promise<void> {
  // ...

  const thread = threadService.get(threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  // Use new path structure - thread.taskId is now guaranteed non-null
  const threadFolderName = `${thread.agentType}-${threadId}`;
  const stateFilePath = fs.joinPath(
    anvilDir,
    "tasks",
    thread.taskId,
    "threads",
    threadFolderName,
    "state.json"
  );

  // ... rest of resume logic, always include --task-id
  commandArgs.push("--task-id", thread.taskId);
  // ...
}
```

### Phase 7: Update Thread Messages Hook

**File:** `src/hooks/use-thread-messages.ts`

1. **Update path resolution:**
```ts
export function useThreadMessages(threadId: string | null) {
  // ...

  const loadMessages = async () => {
    if (!threadId) return;

    const thread = threadService.get(threadId);
    if (!thread) return;

    // Use new path structure
    const threadFolderName = `${thread.agentType}-${threadId}`;
    const statePath = await fs.joinPath(
      dataDir,
      "tasks",
      thread.taskId,
      "threads",
      threadFolderName,
      "state.json"
    );

    // ... rest of loading logic
  };

  // ...
}
```

### Phase 8: Update Spotlight Flow

**File:** `src/components/spotlight/spotlight.tsx`

1. **Create draft task before spawning thread:**
```ts
// OLD FLOW (deprecated):
// const threadId = crypto.randomUUID();
// prepareAgent({ taskId: null, threadId, ... });

// NEW FLOW:
const handleSubmit = async () => {
  // 1. Create draft task first
  const draftTask = await taskService.create({
    title: prompt.substring(0, 50) + "...",  // Placeholder title
    status: "draft",
    repositoryName: selectedRepo,
  });

  // 2. Pre-generate thread ID for optimistic UI
  const threadId = crypto.randomUUID();

  // 3. Spawn thread with the draft task's ID
  const prepared = await prepareAgent({
    taskId: draftTask.id,  // Now guaranteed non-null
    threadId,
    agentType: "entrypoint",
    prompt,
    // ...
  });

  // 4. Agent will refine the draft task (update title, description, etc.)
  await prepared.spawn();
};
```

### Phase 9: Update Zustand Stores

**File:** `src/entities/threads/store.ts`

1. No major changes needed - store holds ThreadMetadata which now has non-nullable taskId

**File:** `src/entities/tasks/store.ts`

1. Remove `threadIds` from task state handling
2. Add selector to get threads for a task (calls service):
```ts
// Add to store or as a hook
export function useTaskThreads(taskId: string): ThreadMetadata[] {
  // Either filter from thread store by taskId, or call taskService.getThreads()
  return useThreadStore((state) =>
    Object.values(state.threads).filter(t => t.taskId === taskId)
  );
}
```

### Phase 10: Update UI Components

**File:** `src/components/workspace/task-workspace.tsx`

1. Fetch threads by taskId instead of using `task.threadIds`:
```ts
// OLD:
// const threads = task.threadIds.map(id => threadService.get(id));

// NEW:
const threads = useTaskThreads(task.id);
// Or: const threads = await taskService.getThreads(task.id);
```

**File:** `src/components/tasks/delete-task-dialog.tsx`

1. Update thread count display (now derived from scanning, not threadIds array)

---

## Files to Modify

### Frontend (src/)
- `src/entities/threads/types.ts` - Make taskId non-nullable, add folder name helpers
- `src/entities/threads/service.ts` - Path logic, hydration, grep-based lookup, remove associateWithTask
- `src/entities/tasks/types.ts` - Remove threadIds
- `src/entities/tasks/service.ts` - Remove threadIds handling, add getThreads, create threads/ dir
- `src/entities/threads/store.ts` - Update for new structure
- `src/entities/tasks/store.ts` - Remove threadIds, add thread fetching
- `src/lib/agent-service.ts` - Make taskId required, update prepareAgent and resumeAgent paths
- `src/hooks/use-thread-messages.ts` - Update path resolution
- `src/components/spotlight/spotlight.tsx` - Create draft task before spawning thread
- `src/components/workspace/task-workspace.tsx` - Fetch threads by taskId
- `src/components/tasks/delete-task-dialog.tsx` - Update thread count derivation
- Any other components using `task.threadIds`

### Runner (agents/)
- `agents/src/runner.ts` - Make --task-id required, update path resolution
- `agents/src/output.ts` - No changes (receives threadPath from runner)

---

## Migration Strategy

Since we're not worried about backwards compatibility:

1. Delete existing `.anvil/threads/` directory
2. Delete existing `.anvil/tasks/` directory (or keep task content, regenerate)
3. Start fresh with new structure

Or for a cleaner dev experience:
1. Change data directory from `.anvil` to `.anvil-v2` temporarily
2. All new data uses new structure
3. No migration code needed

---

## Edge Cases

### Task deleted with threads
- Recursive delete handles this
- Threads are deleted with task
- Thread index entries are cleared

### Multiple threads with same agent type per task
- UUID ensures uniqueness
- `execution-uuid1`, `execution-uuid2` both valid in same task

### Thread lookup when index is stale
- `getTaskIdForThread()` returns undefined
- Falls back to `refreshThreadIndex()` which uses grep
- Index is updated with discovered mapping
- Liberal refresh policy - any miss triggers re-scan

### Resume with only threadId
- Thread metadata is loaded from store (has taskId)
- Path is computed from taskId + agentType + threadId
- If not in store, grep-based discovery finds it

---

## Testing Checklist

- [ ] Thread creation requires taskId (fails without it)
- [ ] Thread created in correct task folder with agent-type prefix
- [ ] Hydration finds all threads across all tasks
- [ ] Task deletion removes all its threads
- [ ] Runner can write to correct paths with required --task-id
- [ ] UI displays threads correctly per task
- [ ] Multiple threads of same agent type work correctly
- [ ] Resume agent works with new path structure
- [ ] Spotlight creates draft task before spawning thread
- [ ] Grep-based thread lookup works on cache miss
- [ ] Thread index is refreshed correctly
- [ ] `associateWithTask` is removed and not called anywhere
