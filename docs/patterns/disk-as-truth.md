# Disk as Truth

The filesystem (and git state) is the single source of truth. In-memory stores are treated as caches that can become stale at any time.

## Why This Matters

Our architecture has multiple writers: the Tauri UI process and Node agent processes can both modify files on disk without direct coordination. Rather than building complex synchronization, we:

1. **Minimize caching** - Read from disk when freshness matters
2. **Refresh liberally** - Events trigger disk re-reads, not just in-memory updates
3. **Validate cached paths** - Before using cached data, verify it still exists on disk

## The Pattern

### Event-Driven Refresh

When an event arrives (task updated, thread created, etc.), always re-read from disk rather than trusting event payloads for state:

```typescript
// listeners.ts - Good: refresh from disk on events
eventBus.on(EventName.TASK_UPDATED, async ({ taskId }) => {
  await taskService.refreshTask(taskId);  // Re-reads metadata.json
});

eventBus.on(EventName.THREAD_STATUS_CHANGED, async ({ threadId }) => {
  await threadService.refreshById(threadId);  // Re-reads from disk
});
```

### Stale Cache Detection

When cached paths might be invalid (e.g., after renames), validate against disk before using:

```typescript
// taskService.resolveSlug - validates cached slugs against disk
async resolveSlug(taskId: string): Promise<string | null> {
  const cachedTask = useTaskStore.getState().tasks[taskId];

  if (cachedTask) {
    // Verify the cached path still exists
    const metadataExists = await persistence.exists(
      `tasks/${cachedTask.slug}/metadata.json`
    );
    if (metadataExists) {
      return cachedTask.slug;  // Cache hit - path is valid
    }
    // Cached slug is stale - fall through to scan
  }

  // Scan disk to find the current location
  const entries = await persistence.listDirEntries(TASKS_DIR);
  // ... find task by ID and update cache
}
```

### Read-Modify-Write for Shared Files

When multiple processes write to the same file, read the current disk state before writing:

```typescript
// threadService.update - preserves fields written by the runner
async (thread) => {
  const metadataPath = `${threadPath}/metadata.json`;
  const diskState = await persistence.readJson<ThreadMetadata>(metadataPath);
  const merged = diskState
    ? { ...diskState, ...thread, updatedAt: Date.now() }
    : thread;
  await persistence.writeJson(metadataPath, merged);
}
```

### Stale-While-Revalidate for UX

Show cached data immediately while refreshing from disk in the background:

```typescript
// threadService.loadThreadState
const hasCachedState = !!store.threadStates[threadId];

// Only show loading spinner if we have nothing to show
if (!hasCachedState) {
  store.setActiveThreadLoading(true);
}

// Always refresh from disk
const stateJson = await persistence.readJson<ThreadState>(statePath);
store.setThreadState(threadId, stateJson);
```

## Writer Contract: Disk Before Event

Events signal that data changed on disk. Writers must complete disk writes before emitting events.

```typescript
// Good: await disk write, then emit
await persistence.writeJson(path, data);
eventBus.emit(EventName.TASK_UPDATED, { taskId });

// Bad: event before write completes (reader sees stale data)
persistence.writeJson(path, data);  // Not awaited!
eventBus.emit(EventName.TASK_UPDATED, { taskId });
```

If an event fires before the write completes, listeners read stale data from disk—even if the event payload contains correct data (which they correctly ignore per disk-as-truth).

## Anti-Patterns

### Trusting In-Memory State Without Validation

```typescript
// Bad: assumes cached slug is current
const task = useTaskStore.getState().tasks[taskId];
const path = `tasks/${task.slug}/metadata.json`;  // May not exist if renamed

// Good: validate first
const slug = await taskService.resolveSlug(taskId);  // Checks disk
if (!slug) return;  // Handle missing task
```

### Updating Store Without Disk Refresh

```typescript
// Bad: event handler updates store directly
eventBus.on(EventName.TASK_UPDATED, ({ taskId, updates }) => {
  useTaskStore.getState()._applyUpdate(taskId, updates);  // Stale if agent also modified
});

// Good: refresh from disk
eventBus.on(EventName.TASK_UPDATED, async ({ taskId }) => {
  await taskService.refreshTask(taskId);  // Gets complete current state
});
```

### Long-Lived Caches

Avoid caching mutable data indefinitely. Acceptable only for truly immutable data or caches with short TTLs.

## Optimistic Updates

Optimistic updates are compatible with disk-as-truth. The pattern:

1. Apply change to store immediately (for responsive UI)
2. Persist to disk
3. Rollback store if disk write fails
4. Event listeners refresh from disk anyway, ensuring eventual consistency

```typescript
await optimistic(
  updated,
  (task) => useTaskStore.getState()._applyUpdate(id, task),  // Instant UI
  (task) => persistence.writeJson(`tasks/${task.slug}/metadata.json`, task)
);
// Other windows will refresh from disk via events
```

## Summary

- **Events trigger disk reads**, not in-memory mutations
- **Validate cached paths** before using them
- **Read-modify-write** for files shared between processes
- **Stale-while-revalidate** for good UX without blocking on disk
- **Optimistic updates** are fine - disk refresh ensures consistency
