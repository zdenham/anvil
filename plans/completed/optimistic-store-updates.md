# Optimistic Store Updates

## Overview

Implement a pattern for optimistic updates on store writes that:
1. Stores a copy of the existing state
2. Updates state optimistically (immediate UI update)
3. Persists to disk
4. Rolls back on failure

The pattern should be minimal boilerplate and explicit writes should update state directly (not via events).

## Current Pattern

```
Service.update() → persistence.writeJson() → eventBus.emit() → Store._handler()
```

**Problems:**
- UI doesn't update until disk write completes
- Event indirection adds complexity
- No rollback on failure
- Write-then-emit means events can be out of sync with actual state

## Proposed Pattern

```
Service.update() → Store.optimisticUpdate() → persistence.writeJson()
                   ↳ immediate UI update      ↳ rollback on failure
```

**Key changes:**
- Direct store updates (no events for writes)
- Optimistic: UI updates before disk write
- Automatic rollback on persistence failure
- Events only for cross-concern notifications (e.g., status changes for other components)

---

## Implementation

### 1. Create Type-Safe `optimistic` Helper Utility

**`src/lib/optimistic.ts`**

A type-safe utility that ensures the applied value matches what's persisted:

```typescript
/**
 * Rollback function returned by apply operations.
 */
export type Rollback = () => void;

/**
 * Executes an optimistic update with automatic rollback on failure.
 * Type parameter ensures the applied data matches what's persisted.
 *
 * @param apply - Function that applies the update and returns a rollback function
 * @param persist - Async function that persists the change
 * @returns Promise that resolves when persistence completes
 * @throws Re-throws persistence errors after rollback
 */
export async function optimistic<T>(
  apply: (data: T) => Rollback,
  data: T,
  persist: (data: T) => Promise<void>
): Promise<void> {
  const rollback = apply(data);
  try {
    await persist(data);
  } catch (error) {
    rollback();
    throw error;
  }
}
```

**Why this signature?**
- `data: T` is passed explicitly, ensuring `apply` and `persist` operate on the same typed value
- Compiler enforces that the store update and disk write use the same data
- No way to accidentally persist different data than what was applied

**Usage in service:**

```typescript
const updated: TaskMetadata = { ...existing, ...updates, updatedAt: Date.now() };

await optimistic(
  (task) => useTaskStore.getState()._applyUpdate(id, task),
  updated,
  (task) => persistence.writeJson(`${TASKS_DIR}/${id}.json`, task)
);
```

### Alternative: Simpler Signature (if data is always the same)

If the pattern is always "apply same data, persist same data", we can simplify:

```typescript
export async function optimistic<T>(
  data: T,
  apply: (data: T) => Rollback,
  persist: (data: T) => Promise<void>
): Promise<void> {
  const rollback = apply(data);
  try {
    await persist(data);
  } catch (error) {
    rollback();
    throw error;
  }
}

// Usage - data first, then operations
await optimistic(
  updated,
  (task) => useTaskStore.getState()._applyUpdate(id, task),
  (task) => persistence.writeJson(path, task)
);
```

### 2. Add Type-Safe Store Methods

Each store gets typed `_apply*` methods that return `Rollback` functions.

**`src/lib/optimistic.ts`** - Add shared type:

```typescript
import type { Rollback } from "./optimistic";
```

**Type-safe store interface pattern:**

```typescript
import type { Rollback } from "@/lib/optimistic";

interface TaskActions {
  // ... existing actions

  /** Optimistic apply methods - return rollback functions */
  _applyCreate: (task: TaskMetadata) => Rollback;
  _applyUpdate: (id: string, task: TaskMetadata) => Rollback;
  _applyDelete: (id: string) => Rollback;
}
```

**Full typed implementation for TaskStore:**

```typescript
import type { Rollback } from "@/lib/optimistic";

// ... in store definition

_applyCreate: (task: TaskMetadata): Rollback => {
  set((state) => ({
    tasks: { ...state.tasks, [task.id]: task },
  }));
  return () =>
    set((state) => {
      const { [task.id]: _, ...rest } = state.tasks;
      return { tasks: rest };
    });
},

_applyUpdate: (id: string, task: TaskMetadata): Rollback => {
  const prev = get().tasks[id];
  set((state) => ({
    tasks: { ...state.tasks, [id]: task },
  }));
  return () =>
    set((state) => ({
      tasks: { ...state.tasks, [id]: prev },
    }));
},

_applyDelete: (id: string): Rollback => {
  const prev = get().tasks[id];
  set((state) => {
    const { [id]: _, ...rest } = state.tasks;
    return { tasks: rest };
  });
  return () =>
    set((state) => ({
      tasks: { ...state.tasks, [id]: prev },
    }));
},
```

**Type safety guarantees:**
- `_applyCreate(task: TaskMetadata)` - must receive full `TaskMetadata`
- `_applyUpdate(id, task: TaskMetadata)` - must receive full updated entity
- Return type `Rollback` enforced by interface
- Compiler catches mismatched types between service and store

### 3. Generic Store Factory (Optional - Advanced)

For DRY stores, create a typed factory:

```typescript
// src/lib/store-helpers.ts
import type { Rollback } from "./optimistic";

/**
 * Creates type-safe optimistic apply methods for record-based stores.
 *
 * @param get - Zustand get function
 * @param set - Zustand set function
 * @param key - The state key holding the record (e.g., "tasks", "conversations")
 */
export function createRecordAppliers<
  TEntity extends { id: string },
  TState extends Record<string, Record<string, TEntity>>
>(
  get: () => TState,
  set: (partial: Partial<TState>) => void,
  key: keyof TState & string
) {
  return {
    _applyCreate: (entity: TEntity): Rollback => {
      set({ [key]: { ...get()[key], [entity.id]: entity } } as Partial<TState>);
      return () => {
        const { [entity.id]: _, ...rest } = get()[key];
        set({ [key]: rest } as Partial<TState>);
      };
    },

    _applyUpdate: (id: string, entity: TEntity): Rollback => {
      const prev = get()[key][id];
      set({ [key]: { ...get()[key], [id]: entity } } as Partial<TState>);
      return () => {
        set({ [key]: { ...get()[key], [id]: prev } } as Partial<TState>);
      };
    },

    _applyDelete: (id: string): Rollback => {
      const prev = get()[key][id];
      const { [id]: _, ...rest } = get()[key];
      set({ [key]: rest } as Partial<TState>);
      return () => {
        set({ [key]: { ...get()[key], [id]: prev } } as Partial<TState>);
      };
    },
  };
}
```

**Usage in store:**

```typescript
export const useTaskStore = create<TaskState & TaskActions>((set, get) => {
  const appliers = createRecordAppliers<TaskMetadata, TaskState>(
    get as () => TaskState,
    set,
    "tasks"
  );

  return {
    tasks: {},
    _hydrated: false,

    ...appliers,  // Spreads _applyCreate, _applyUpdate, _applyDelete

    // ... other methods
  };
});
```

**Trade-off:** The factory adds complexity but eliminates boilerplate for stores with similar shapes. Recommend starting with explicit implementations and refactoring to factory if pattern repeats cleanly.

### 4. Update Services to Use Optimistic Pattern

**Before (current):**

```typescript
async update(id: string, updates: UpdateTaskInput): Promise<TaskMetadata> {
  const existing = useTaskStore.getState().tasks[id];
  if (!existing) throw new Error(`Task not found: ${id}`);

  const updated: TaskMetadata = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };

  await persistence.writeJson(`${TASKS_DIR}/${id}.json`, updated);
  eventBus.emit("task:updated", { id, updates: updated });

  return updated;
}
```

**After (optimistic, type-safe):**

```typescript
import { optimistic } from "@/lib/optimistic";

async update(id: string, updates: UpdateTaskInput): Promise<TaskMetadata> {
  const existing = useTaskStore.getState().tasks[id];
  if (!existing) throw new Error(`Task not found: ${id}`);

  const updated: TaskMetadata = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };

  // Type-safe: updated is TaskMetadata, both apply and persist receive same type
  await optimistic(
    updated,
    (task) => useTaskStore.getState()._applyUpdate(id, task),
    (task) => persistence.writeJson(`${TASKS_DIR}/${id}.json`, task)
  );

  // Only emit for cross-concern notifications
  if (updates.status && updates.status !== existing.status) {
    eventBus.emit("task:status-changed", { id, status: updates.status });
  }

  return updated;
}
```

**Type safety in action:**
- `updated` is typed as `TaskMetadata`
- `_applyUpdate(id, task: TaskMetadata)` enforces the type
- `persistence.writeJson<TaskMetadata>()` persists the same type
- If you accidentally pass wrong data, TypeScript errors

### 5. Important: Full Entity vs Partial Updates

**Current pattern** (conversation store):
```typescript
_handleUpdated: (id: string, updates: Partial<ConversationMetadata>) => void;
// Merges inside the store
```

**New pattern** (for optimistic updates):
```typescript
_applyUpdate: (id: string, entity: ConversationMetadata) => Rollback;
// Receives full entity, just sets it
```

**Why full entity?**
1. **Type safety**: Can't accidentally pass mismatched types
2. **Safe rollback**: Captures complete previous state, not partial
3. **No race conditions**: Concurrent partial updates can't conflict
4. **Predictable**: What you persist is exactly what you applied

**ConversationStore example:**

```typescript
import type { Rollback } from "@/lib/optimistic";
import type { ConversationMetadata } from "./types";

interface ConversationActions {
  // ... existing selectors

  /** Optimistic apply methods */
  _applyCreate: (conv: ConversationMetadata) => Rollback;
  _applyUpdate: (id: string, conv: ConversationMetadata) => Rollback;
  _applyDelete: (id: string) => Rollback;
}

// Implementation
_applyCreate: (conv: ConversationMetadata): Rollback => {
  set((state) => ({
    conversations: { ...state.conversations, [conv.id]: conv },
  }));
  return () =>
    set((state) => {
      const { [conv.id]: _, ...rest } = state.conversations;
      return { conversations: rest };
    });
},

_applyUpdate: (id: string, conv: ConversationMetadata): Rollback => {
  const prev = get().conversations[id];
  set((state) => ({
    conversations: { ...state.conversations, [id]: conv },
  }));
  return () =>
    set((state) => ({
      conversations: { ...state.conversations, [id]: prev },
    }));
},

_applyDelete: (id: string): Rollback => {
  const prev = get().conversations[id];
  set((state) => {
    const { [id]: _, ...rest } = state.conversations;
    return { conversations: rest };
  });
  return () =>
    set((state) => ({
      conversations: { ...state.conversations, [id]: prev },
    }));
},
```

**Service usage:**

```typescript
async update(id: string, updates: UpdateConversationInput): Promise<ConversationMetadata> {
  const existing = useConversationStore.getState().conversations[id];
  if (!existing) throw new Error(`Conversation not found: ${id}`);

  // Merge happens in service, producing full entity
  const updated: ConversationMetadata = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };

  await optimistic(
    updated,
    (conv) => useConversationStore.getState()._applyUpdate(id, conv),
    (conv) => persistence.writeJson(`${CONVERSATIONS_DIR}/${id}.json`, conv)
  );

  if (updates.status && updates.status !== existing.status) {
    eventBus.emit("conversation:status-changed", { id, status: updates.status });
  }

  return updated;
}
```

### 6. Remove Event Subscriptions for Direct Updates

Since writes now update stores directly, remove the event subscriptions that were used for writes:

**Remove from TaskStore:**
```typescript
// DELETE these subscriptions
eventBus.on("task:created", ...);
eventBus.on("task:updated", ...);
```

**Remove from ConversationStore:**
```typescript
// DELETE these subscriptions
eventBus.on("conversation:created", ...);
eventBus.on("conversation:updated", ...);
```

**Keep:** Event subscriptions for IPC/cross-process events (e.g., agent events from Tauri backend).

### 7. Simplify Store Reducers

The `_handle*` reducers can be simplified or removed since they're now only used for external events (like IPC from Tauri).

Rename to clarify purpose:
- `_handleUpdated` → `_applyUpdate` (direct use by service)
- Keep `_handleExternalUpdate` if needed for IPC events

---

## File Changes

### New Files

| Path | Description |
|------|-------------|
| `src/lib/optimistic.ts` | Optimistic update utility function |

### Modified Files

| Path | Change |
|------|--------|
| `src/entities/tasks/store.ts` | Add `_apply*` methods, remove event-driven `_handle*` |
| `src/entities/tasks/service.ts` | Use `optimistic()` wrapper |
| `src/entities/conversations/store.ts` | Add `_apply*` methods |
| `src/entities/conversations/service.ts` | Use `optimistic()` wrapper |
| `src/entities/repositories/store.ts` | Add `_apply*` methods |
| `src/entities/repositories/service.ts` | Use `optimistic()` wrapper |
| `src/entities/settings/store.ts` | Add `_apply*` method |
| `src/entities/settings/service.ts` | Use `optimistic()` wrapper |

---

## API Design

### Option A: Minimal Helper (Recommended)

```typescript
// src/lib/optimistic.ts
export async function optimistic<T>(
  apply: () => () => void,
  persist: () => Promise<T>
): Promise<T>;
```

**Pros:** Simple, flexible, explicit
**Cons:** Requires manual rollback function creation

### Option B: Store-Integrated Helper

```typescript
// Usage
await useTaskStore.getState().optimisticUpdate(
  id,
  updates,
  () => persistence.writeJson(path, data)
);
```

**Pros:** Less boilerplate per call
**Cons:** Couples store to persistence pattern, less flexible

### Recommendation: Option A

Option A is simpler and more composable. The rollback function is explicit and can handle complex scenarios (e.g., updates that affect multiple state slices).

---

## Migration Strategy

1. Add `src/lib/optimistic.ts` utility
2. Add `_apply*` methods to each store (can coexist with `_handle*`)
3. Update one service at a time to use optimistic pattern
4. Remove unused `_handle*` methods and event subscriptions
5. Clean up event types that are no longer emitted

---

## Events After Migration

**Keep these events:**
- `agent:*` - IPC from Tauri backend
- `task:status-changed` - Cross-concern (other components may care)
- `conversation:status-changed` - Cross-concern
- `task:deleted` - May need for cleanup in other parts

**Remove these events:**
- `task:created` - Direct store update
- `task:updated` - Direct store update (status-changed covers the cross-concern)
- `conversation:created` - Direct store update
- `conversation:updated` - Direct store update
- `settings:updated` - Direct store update
- `repository:created` - Direct store update
- `repository:updated` - Direct store update

---

## Example: Full Task Update Flow (Type-Safe)

```typescript
import { optimistic } from "@/lib/optimistic";
import { persistence } from "@/lib/persistence";
import { useTaskStore } from "./store";
import type { TaskMetadata, UpdateTaskInput } from "./types";

const TASKS_DIR = "tasks";

// taskService.update()
async update(id: string, updates: UpdateTaskInput): Promise<TaskMetadata> {
  const existing = useTaskStore.getState().tasks[id];
  if (!existing) throw new Error(`Task not found: ${id}`);

  const updated: TaskMetadata = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };

  // Type-safe: all three params agree on TaskMetadata
  await optimistic(
    updated,
    (task) => useTaskStore.getState()._applyUpdate(id, task),
    (task) => persistence.writeJson(`${TASKS_DIR}/${id}.json`, task)
  );

  // Cross-concern notification only
  if (updates.status && updates.status !== existing.status) {
    eventBus.emit("task:status-changed", { id, status: updates.status });
  }

  return updated;
}
```

**Type safety chain:**
```
UpdateTaskInput → merge with existing → TaskMetadata → optimistic<TaskMetadata>()
                                              ↓
                              _applyUpdate(id, task: TaskMetadata)
                              persistence.writeJson<TaskMetadata>()
```

**Runtime flow:**
1. Get existing state (typed `TaskMetadata | undefined`)
2. Merge to create `updated: TaskMetadata`
3. `optimistic()` called with `updated`:
   - `_applyUpdate(id, task)` updates store immediately → UI reflects change
   - `_applyUpdate` returns typed `Rollback` function
   - `persistence.writeJson(path, task)` writes to disk
   - If write fails, `Rollback` restores previous state
4. Emit status-changed event if applicable
5. Return `updated: TaskMetadata`

---

## Testing

### Unit Tests for `optimistic()`

```typescript
test("applies change and persists successfully", async () => {
  let state = "initial";
  await optimistic(
    () => { state = "updated"; return () => { state = "initial"; }; },
    () => Promise.resolve()
  );
  expect(state).toBe("updated");
});

test("rolls back on persistence failure", async () => {
  let state = "initial";
  await expect(optimistic(
    () => { state = "updated"; return () => { state = "initial"; }; },
    () => Promise.reject(new Error("disk full"))
  )).rejects.toThrow("disk full");
  expect(state).toBe("initial");
});
```

### Integration Tests

- Test that UI updates immediately on write
- Test that rollback restores UI state on failure
- Test that cross-concern events still fire

---

## Implementation Order

1. [ ] Create `src/lib/optimistic.ts`
2. [ ] Add `_apply*` methods to `TaskStore`
3. [ ] Update `taskService` to use optimistic pattern
4. [ ] Repeat for `ConversationStore/Service`
5. [ ] Repeat for `RepoStore/Service`
6. [ ] Repeat for `SettingsStore/Service`
7. [ ] Remove unused event subscriptions
8. [ ] Clean up event types
9. [ ] Add tests
