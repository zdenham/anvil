# Bug: TaskWorkspace Not Showing After Spotlight Submission

## Summary

After submitting a prompt in spotlight, the old ThreadWindow UI is displayed instead of the new TaskWorkspace UI.

## Root Cause

The current architecture conditionally renders based on `taskId`:

```tsx
// thread-main.tsx
if (resolvedTaskId) {
  return <TaskWorkspace taskId={resolvedTaskId} initialThreadId={threadId} />;
}
return <ThreadWindow threadId={threadId} />;
```

But `taskId` is null when the window opens because:
1. Spotlight calls `openThread(threadId, prompt, repoName)` — no taskId exists yet
2. The agent creates/associates the task later via `/route` skill
3. By then, ThreadWindow already rendered

## Solution: Task-Centric with Draft Lifecycle

**Each spotlight invocation creates a task immediately in "draft" state.**

The draft task:
- Exists from window open → no conditional switching needed
- Captures user intent (prompt) before routing happens
- Can be promoted to active, routed to existing task, or discarded

### Key Insights

1. **Each spotlight prompt IS a task** — semantically, the user is starting work
2. **Thread:Task is many:one** — many threads can serve one task (debugging, follow-ups), stored as `thread.taskId`
3. **Draft state handles uncertainty** — don't know yet if this becomes a real task
4. **Discard path for ephemeral work** — investigations that don't need persistence

### New Mental Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      TASK LIFECYCLE                             │
│                                                                 │
│  Spotlight prompt                                               │
│       ↓                                                         │
│  CREATE DRAFT TASK (immediate)                                  │
│       ↓                                                         │
│  Open window with taskId + threadId                             │
│       ↓                                                         │
│  Agent runs /route skill                                        │
│       ↓                                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ NEW standalone task:   Promote draft → active           │    │
│  │ Related to existing:   Promote draft → active (as child)│    │
│  │ Quick investigation:   Keep draft, mark "investigate"   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  DISCARD CONDITIONS:                                            │
│  - Spotlight reopened while draft still has no work             │
│  - Explicit discard action                                      │
│  - Background cleanup after TTL (e.g., 1 hour)                  │
└─────────────────────────────────────────────────────────────────┘
```

### Task States

Add "draft" to `WorkspaceStatus`:

```typescript
// src/entities/tasks/types.ts
export type WorkspaceStatus =
  | "draft"       // NEW: Created at spotlight, not yet committed
  | "pending"     // Committed but no work started
  | "in_progress" // Agent actively working
  | "paused"      // Work paused, can resume
  | "completed"   // Work done, awaiting review
  | "merged"      // PR merged, ready for cleanup
  | "cancelled";  // Abandoned
```

### Why This Works

1. **Task exists at user intent** — not discovered later
2. **No conditional switching** — TaskWorkspace always has a taskId
3. **Clean ephemeral handling** — drafts can be silently discarded
4. **Routing still works** — agent can promote, redirect, or keep draft

---

## Implementation

### Step 1: Add "draft" to TaskStatus

```typescript
// src/entities/tasks/types.ts
export type WorkspaceStatus =
  | "draft"       // NEW
  | "pending"
  | "in_progress"
  | "paused"
  | "completed"
  | "merged"
  | "cancelled";
```

### Step 2: Add Draft Task Creation to taskService

Uses the existing optimistic update pattern for consistency:

```typescript
// src/entities/tasks/service.ts

interface CreateDraftInput {
  prompt: string;           // Original user prompt
  repositoryName: string;
  threadId: string;         // Pre-associated thread
}

async createDraft(input: CreateDraftInput): Promise<TaskMetadata> {
  const now = Date.now();
  const taskId = generateTaskId();

  // Truncate prompt for temporary title (first line, max 50 chars)
  const firstLine = input.prompt.split('\n')[0];
  const title = firstLine.length > 50
    ? firstLine.slice(0, 47) + '...'
    : firstLine;

  const metadata: TaskMetadata = {
    id: taskId,
    slug: `draft-${taskId}`,           // Temporary slug, updated on promote
    title,
    description: input.prompt,
    branchName: "",                     // No branch yet
    type: "work",
    subtasks: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
    parentId: null,
    threadIds: [input.threadId],
    tags: [],
    sortOrder: now,
    repositoryName: input.repositoryName,
  };

  // Use optimistic pattern like other methods
  await optimistic(
    metadata,
    (task) => useTaskStore.getState()._applyCreate(task),
    (task) => persistence.writeJson(`${TASKS_DIR}/${task.id}.json`, task)
  );

  return metadata;
}
```

### Step 3: Add Draft Filtering to Task Queries

Drafts should NOT appear in the main task board by default:

```typescript
// src/entities/tasks/service.ts

/**
 * Lists tasks, optionally filtered by repository.
 * Excludes drafts by default.
 */
listTasks(options?: {
  repositoryName?: string;
  includeDrafts?: boolean;
}): TaskMetadata[] {
  const allTasks = Object.values(useTaskStore.getState().tasks);

  let filtered = allTasks;

  // Exclude drafts unless explicitly requested
  if (!options?.includeDrafts) {
    filtered = filtered.filter((t) => t.status !== "draft");
  }

  // Filter by repository if specified
  if (options?.repositoryName) {
    filtered = filtered.filter((t) => t.repositoryName === options.repositoryName);
  }

  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Gets all draft tasks (for cleanup purposes).
 */
getDrafts(): TaskMetadata[] {
  return Object.values(useTaskStore.getState().tasks)
    .filter((t) => t.status === "draft");
}
```

### Step 4: Update Spotlight to Create Draft Task

```typescript
// src/components/spotlight/spotlight.tsx - createTask method

async createTask(content: string, repo?: Repository): Promise<void> {
  // ... existing repo selection logic ...

  // Generate thread ID upfront for optimistic UI
  const threadId = crypto.randomUUID();

  // ═══════════════════════════════════════════════════════════════
  // CREATE DRAFT TASK IMMEDIATELY (before opening window)
  // ═══════════════════════════════════════════════════════════════
  const draftTask = await taskService.createDraft({
    prompt: content,
    repositoryName: selectedRepo.name,
    threadId,
  });

  // Set up thread-ready listener (existing code)
  const readyPromise = new Promise<void>((resolve) => { /* ... */ });

  // Open thread window with BOTH IDs
  // Note: Keep existing parameter order for minimal changes
  await openThread(threadId, content, selectedRepo.name, draftTask.id);

  // ... rest of existing code, but now prepareAgent gets taskId ...
  const prepared = await prepareAgent({
    agentType: "main",
    workingDirectory: allocation.worktree.path,
    prompt: content,
    taskId: draftTask.id,  // No longer null!
    mergeBase: allocation.mergeBase,
    threadId,
  }, { /* callbacks */ });
}
```

### Step 5: Update openThread Signature (Minimal Change)

Keep existing parameter order, just make `taskId` required for new calls:

```typescript
// src/lib/hotkey-service.ts

/**
 * Opens the thread panel and displays a specific thread.
 * @param threadId - The thread to display
 * @param prompt - Optional prompt for optimistic UI
 * @param repoName - Optional repository name
 * @param taskId - Task ID (required for new threads from spotlight)
 */
export const openThread = async (
  threadId: string,
  prompt?: string,
  repoName?: string,
  taskId?: string  // Still optional for backwards compat with existing threads
): Promise<void> => {
  await invoke("open_thread", { threadId, prompt, repoName, taskId });
};
```

### Step 6: Simplify thread-main.tsx

```tsx
// src/thread-main.tsx

function ThreadPanel() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  // ... existing state ...

  // Get taskId from thread if not provided directly (for existing threads)
  const thread = useThreadStore((state) =>
    threadId ? state.threads[threadId] : null
  );
  const resolvedTaskId = taskId ?? thread?.taskId ?? null;

  // ... existing setup code ...

  if (!threadId) {
    return <div>Waiting for thread...</div>;
  }

  // TaskWorkspace handles both cases:
  // - New threads: taskId provided directly (draft)
  // - Existing threads: taskId resolved from thread entity
  if (resolvedTaskId) {
    return <TaskWorkspace taskId={resolvedTaskId} initialThreadId={threadId} />;
  }

  // Fallback for legacy threads without taskId (temporary)
  // TODO: Remove after migration
  return <ThreadWindow threadId={threadId} />;
}
```

### Step 7: Update TaskWorkspace Header for Draft State

```tsx
// src/components/workspace/task-header.tsx

function TaskHeader({ task }: { task: TaskMetadata }) {
  const isDraft = task.status === "draft";

  return (
    <header className="...">
      {isDraft ? (
        <>
          <span className="text-slate-400 truncate">{task.title}</span>
          <Badge variant="secondary">
            <Loader2 className="w-3 h-3 animate-spin mr-1" />
            Routing…
          </Badge>
        </>
      ) : (
        <>
          <span className="font-medium">{task.title}</span>
          <Badge>{task.type}</Badge>
          {task.branchName && <BranchLink branch={task.branchName} />}
        </>
      )}
    </header>
  );
}
```

### Step 8: Agent Task Update IPC

The agent needs to update task status. Add a Tauri command:

```rust
// src-tauri/src/anvil_commands.rs

#[tauri::command]
pub async fn update_task(
    app: AppHandle,
    task_id: String,
    updates: serde_json::Value,
) -> Result<(), String> {
    // Emit event to frontend for taskService to handle
    app.emit("task:update-from-agent", serde_json::json!({
        "taskId": task_id,
        "updates": updates,
    })).map_err(|e| e.to_string())?;
    Ok(())
}
```

```typescript
// src/lib/event-bridge.ts - add listener

listen<{ taskId: string; updates: UpdateTaskInput }>("task:update-from-agent", async (event) => {
  const { taskId, updates } = event.payload;
  await taskService.update(taskId, updates);
});
```

Agent's `/route` skill calls the command:

```typescript
// In agent's route skill (runs in subprocess)
await invoke("update_task", {
  taskId: draftTaskId,
  updates: {
    status: "in_progress",
    title: taskInfo.title,
    branchName: taskInfo.branchName,
    type: taskInfo.type,
    slug: slugify(taskInfo.title),
    parentId: parentTaskId,  // If routing to existing task
  },
});
```

### Step 9: Draft Garbage Collection

Triggered on spotlight open (not window close, since panel is reused):

```typescript
// src/components/spotlight/spotlight.tsx

async initialize(): Promise<void> {
  // Clean up stale drafts on spotlight open
  await this.cleanupStaleDrafts();
}

private async cleanupStaleDrafts(): Promise<void> {
  const drafts = taskService.getDrafts();
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();

  for (const draft of drafts) {
    const age = now - draft.createdAt;

    // Delete drafts older than 1 hour with no meaningful work
    if (age > ONE_HOUR) {
      const hasMeaningfulWork = await this.checkMeaningfulWork(draft);
      if (!hasMeaningfulWork) {
        await taskService.delete(draft.id);
      }
    }
  }
}

private async checkMeaningfulWork(draft: TaskMetadata): Promise<boolean> {
  // Check if any associated threads have tool calls or file changes
  for (const threadId of draft.threadIds) {
    const thread = threadService.get(threadId);
    if (!thread) continue;

    // Check for turns with completions (indicates agent did work)
    const hasCompletedTurns = thread.turns.some(t => t.completedAt !== null);
    if (hasCompletedTurns) return true;
  }

  return false;
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/entities/tasks/types.ts` | Add "draft" to `WorkspaceStatus` |
| `src/entities/tasks/service.ts` | Add `createDraft()`, `getDrafts()`, update `listTasks()` with filter |
| `src/components/spotlight/spotlight.tsx` | Create draft task before opening window, add cleanup |
| `src/lib/hotkey-service.ts` | Document `taskId` parameter (signature unchanged) |
| `src/thread-main.tsx` | Keep fallback for now, remove after migration |
| `src/components/workspace/task-header.tsx` | Handle draft state display |
| `src/lib/agent-service.ts` | Pass taskId to agent (no longer null) |
| `src-tauri/src/anvil_commands.rs` | Add `update_task` command |
| `src/lib/event-bridge.ts` | Add listener for `task:update-from-agent` |

## Files to Delete (Later)

| File | Reason |
|------|--------|
| `src/components/thread/thread-window.tsx` | Replaced by TaskWorkspace (after migration period) |

---

## Edge Cases

### Opening Existing Thread (from Main Window)

When user clicks on existing thread from main window:
1. Thread entity has `taskId` field → use it directly
2. Call `openThread(threadId, undefined, undefined, thread.taskId)`
3. TaskWorkspace renders with existing task

### Opening Thread Without Task (Legacy)

For threads created before this change:
1. `thread.taskId` is null
2. `thread-main.tsx` falls back to ThreadWindow
3. Gradually migrate or create tasks for orphan threads

### Routing to Related Task

If agent determines work is related to an existing task:
1. Draft is promoted to active with `parentId` set
2. Window continues showing the same task (now a child)
3. Parent task's subtree expands in task board
4. User can navigate parent ↔ child relationship

### Multiple Rapid Submissions

If user submits multiple prompts quickly:
1. Each creates its own draft task
2. Each opens in sequence (panel reused)
3. Cleanup handles abandoned drafts

---

## Testing Checklist

- [ ] Spotlight submission creates draft task immediately
- [ ] TaskWorkspace shows "Routing…" for draft state
- [ ] Agent `/route` skill promotes draft to active
- [ ] Draft tasks don't appear in main task board
- [ ] Existing threads without taskId still work (fallback)
- [ ] Stale drafts cleaned up on spotlight open
- [ ] Task updates from agent propagate to UI
