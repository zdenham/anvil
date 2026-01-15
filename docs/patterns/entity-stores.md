# Entity Stores Pattern

## Overview

Entity stores provide a normalized, single-source-of-truth approach for managing domain objects in React. Each entity type (tasks, threads, repositories) has ONE Zustand store containing exactly ONE copy of each entity.

**When to use:** Any domain object shared across multiple components or updated via events.

## Single-Copy Principle

Every entity exists in exactly one location:

```typescript
// store.ts - entities keyed by unique ID
interface TaskState {
  tasks: Record<string, TaskMetadata>;  // ONE copy per task
}
```

Components select from this single source:

```typescript
const task = useTaskStore((state) => state.tasks[taskId]);
```

**Why:** No stale data, no sync bugs, predictable updates.

## File Structure

Each entity follows this structure in `src/entities/{name}/`:

```
types.ts      # Type definitions
store.ts      # Zustand store (state container only)
service.ts    # Business logic + disk I/O
listeners.ts  # Event subscriptions
```

## The listeners.ts Pattern

Listeners bridge events to store updates via services:

```typescript
// listeners.ts
export function setupTaskListeners(): void {
  eventBus.on(EventName.TASK_CREATED, async ({ taskId }) => {
    await taskService.refreshTask(taskId);  // Read disk, update store
  });

  eventBus.on(EventName.TASK_DELETED, async ({ taskId }) => {
    useTaskStore.getState()._applyDelete(taskId);
  });
}
```

**Data flow:**
```
Event -> listeners.ts -> service.refresh() -> read disk -> update store -> UI re-renders
```

## Service as Store Writer

Only services write to stores:

```typescript
// service.ts
async refreshTask(taskId: string): Promise<void> {
  const metadata = await persistence.readJson<TaskMetadata>(...);
  if (metadata) {
    useTaskStore.getState()._applyUpdate(taskId, metadata);
  } else {
    useTaskStore.getState()._applyDelete(taskId);
  }
}
```

## Do / Don't

### DO

```typescript
// Single store per entity type
export const useTaskStore = create<TaskState & TaskActions>(...);

// Key by stable ID (not slug - slugs can change!)
tasks: Record<string, TaskMetadata>  // taskId -> task

// Listeners call services, services update stores
eventBus.on(EventName.TASK_UPDATED, async ({ taskId }) => {
  await taskService.refreshTask(taskId);
});

// Select specific state in components
const task = useTaskStore((state) => state.tasks[taskId]);
```

### DON'T

```typescript
// Multiple stores for same entity
const useTaskStore = create(...);
const useTaskListStore = create(...);  // Duplicate state!

// Event subscriptions in React components
useEffect(() => {
  eventBus.on("task:updated", ...);  // Use listeners.ts instead!
}, []);

// Write to stores from components
const handleClick = () => {
  useTaskStore.setState({ tasks: newTasks });  // Bypasses service!
};

// Select entire state (causes excess re-renders)
const { tasks, taskContent } = useTaskStore();
```

## Initialization

All listeners are set up once at app startup via `src/entities/index.ts`:

```typescript
export function setupEntityListeners(): void {
  setupTaskListeners();
  setupThreadListeners();
  setupRepositoryListeners();
}
```

## Optimistic Updates

Stores expose `_apply*` methods returning rollback functions:

```typescript
// store.ts
_applyCreate: (task: TaskMetadata): Rollback => {
  set((state) => ({ tasks: { ...state.tasks, [task.id]: task } }));
  return () => set((state) => {
    const { [task.id]: _, ...rest } = state.tasks;
    return { tasks: rest };
  });
}

// service.ts
await optimistic(
  metadata,
  (task) => useTaskStore.getState()._applyCreate(task),
  async (task) => persistence.writeJson(`tasks/${task.slug}/metadata.json`, task)
);
```
