# Plan 02: Service Refresh Method

## Dependencies

None - can run in parallel with Plan 01.

## Goal

Add `refreshThreadState()` method to thread service that reads `state.json` from disk and updates `ThreadUIStore`.

## Files to Modify

| File | Action |
|------|--------|
| `src/entities/threads/service.ts` | Add `refreshThreadState()` method |

## Implementation

### Add `refreshThreadState` to Thread Service

```typescript
// src/entities/threads/service.ts

async refreshThreadState(threadId: string): Promise<void> {
  const thread = this.get(threadId);
  if (!thread) return;

  const task = taskService.get(thread.taskId);
  if (!task) return;

  // Read state.json from disk
  const dataDir = await fs.getDataDir();
  const threadFolderName = `${thread.agentType}-${threadId}`;
  const statePath = fs.joinPath(
    dataDir,
    "tasks",
    task.slug,
    "threads",
    threadFolderName,
    "state.json"
  );

  if (!(await fs.exists(statePath))) return;

  const content = await fs.readFile(statePath);
  const state = JSON.parse(content) as ThreadState;

  // Update ThreadUIStore
  const fileChanges = new Map<string, FileChange>();
  for (const change of state.fileChanges ?? []) {
    fileChanges.set(change.path, change);
  }

  useThreadUIStore.getState().setThread(threadId, {
    messages: state.messages,
    fileChanges,
    metadata: thread,
  });

  // Update status based on state
  const uiStatus = state.status === "complete" ? "completed" : state.status;
  useThreadUIStore.getState().setStatus(uiStatus);
}
```

## Notes

- Uses existing fs adapter pattern
- Updates `ThreadUIStore` directly (services are the only store writers)
- Handles missing state.json gracefully (early return)

## Validation

- Calling `threadService.refreshThreadState(id)` updates store with disk contents
- Store updates trigger UI re-renders
- Method is idempotent (can call multiple times safely)
