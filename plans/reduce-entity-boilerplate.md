# Reduce Entity Boilerplate

Eliminate repeated mechanical code across entities without introducing leaky abstractions. Each helper does one thing, is fully transparent, and never hides domain logic.

## Problem

The entity system has three categories of repetition:

1. **Type re-export files** — 6 of 10 `types.ts` files are pure re-exports from `@core/types` with zero added value
2. **Listener ceremony** — the try/catch + logger.error wrapper is copy-pasted in every single event handler across 10 listener files
3. **Store optimistic CRUD** — `_applyCreate`, `_applyUpdate`, `_applyDelete` + `_array` cache maintenance is mechanically identical in 8 stores

What we are NOT doing:
- No entity factory / code generation
- No merging of model/view/service layers
- Not changing the file structure (`types.ts`, `store.ts`, `service.ts`, `listeners.ts`)
- Not abstracting domain-specific listener logic or store selectors

## Phases

- [ ] Delete pure re-export type files and update imports
- [ ] Create `onEvent` listener helper
- [ ] Create `createRecordActions` store helper
- [ ] Update all listener files to use `onEvent`
- [ ] Update all store files to use `createRecordActions`
- [ ] Run tests, verify nothing is broken

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Delete pure re-export type files

These 6 files re-export from `@core/types` with no additions:

- `src/entities/threads/types.ts` — pure re-export
- `src/entities/plans/types.ts` — pure re-export
- `src/entities/permissions/types.ts` — pure re-export
- `src/entities/quick-actions/types.ts` — pure re-export
- `src/entities/repositories/types.ts` — pure re-export
- `src/entities/skills/types.ts` — pure re-export

**Keep these** (they define their own schemas):
- `drafts/types.ts` — `DraftsFileSchema`
- `logs/types.ts` — `RawLogEntrySchema`, `normalizeLogEntry()`
- `settings/types.ts` — `WorkspaceSettingsSchema`
- `terminal-sessions/types.ts` — `TerminalSessionSchema`

For each deleted file:
1. Find all imports from `@/entities/{name}/types` or `./types`
2. Replace with direct imports from `@core/types/{name}.js`
3. Delete the file
4. Remove the re-export from `index.ts` if it re-exports types

## Phase 2: Create `onEvent` listener helper

**File:** `src/entities/on-event.ts` (~20 lines)

The pattern being replaced:

```ts
eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }) => {
  try {
    await threadService.refreshById(threadId);
  } catch (e) {
    logger.error(`[ThreadListener] Failed to refresh updated thread ${threadId}:`, e);
  }
});
```

The helper:

```ts
import { eventBus } from "./events";
import { logger } from "@/lib/logger-client";
import type { EventName, EventPayloads } from "@core/types/events.js";

/**
 * Subscribe to an event with automatic try/catch + error logging.
 * The handler receives the typed payload directly.
 */
export function onEvent<E extends EventName>(
  event: E,
  tag: string,
  handler: (payload: EventPayloads[E]) => void | Promise<void>,
): void {
  eventBus.on(event, async (payload: EventPayloads[E]) => {
    try {
      await handler(payload);
    } catch (e) {
      logger.error(`[${tag}] ${event} handler failed:`, e);
    }
  });
}
```

This is NOT a declarative config or event registry. It's just `eventBus.on` with the error handling you'd always write anyway. The handler body is still inline — all domain logic stays visible at the call site.

What it eliminates per handler: try/catch block, logger.error call, manual error message formatting.

## Phase 3: Create `createRecordActions` store helper

**File:** `src/entities/record-actions.ts` (~50 lines)

The pattern being replaced (identical in 8 stores):

```ts
_applyCreate: (entity: T): Rollback => {
  set((state) => {
    const newEntities = { ...state.entities, [entity.id]: entity };
    return { entities: newEntities, _array: Object.values(newEntities) };
  });
  return () => set((state) => {
    const { [entity.id]: _, ...rest } = state.entities;
    return { entities: rest, _array: Object.values(rest) };
  });
},
_applyUpdate: (id: string, entity: T): Rollback => { /* same spread + Object.values pattern */ },
_applyDelete: (id: string): Rollback => { /* same spread + Object.values pattern */ },
```

The helper:

```ts
import type { Rollback } from "@/lib/optimistic";

interface RecordActions<T> {
  _applyCreate: (entity: T) => Rollback;
  _applyUpdate: (id: string, entity: T) => Rollback;
  _applyDelete: (id: string) => Rollback;
}

/**
 * Creates the standard optimistic CRUD actions for a Record<string, T> store.
 *
 * @param set - Zustand set function
 * @param get - Zustand get function
 * @param field - The state field name holding the Record (e.g., "threads")
 * @param arrayField - Optional cached array field name (e.g., "_threadsArray")
 * @param getId - Extract ID from entity (default: (e) => e.id)
 */
export function createRecordActions<T, S>(
  set: (fn: (state: S) => Partial<S>) => void,
  get: () => S,
  field: keyof S & string,
  arrayField?: keyof S & string,
  getId: (entity: T) => string = (e: any) => e.id,
): RecordActions<T> {
  function applyRecord(record: Record<string, T>): Partial<S> {
    const result: Partial<S> = { [field]: record } as any;
    if (arrayField) {
      (result as any)[arrayField] = Object.values(record);
    }
    return result;
  }

  return {
    _applyCreate: (entity: T): Rollback => {
      const id = getId(entity);
      set((state) => applyRecord({ ...(state[field] as any), [id]: entity }));
      return () => set((state) => {
        const { [id]: _, ...rest } = state[field] as any;
        return applyRecord(rest);
      });
    },
    _applyUpdate: (id: string, entity: T): Rollback => {
      const prev = (get()[field] as any)[id];
      set((state) => applyRecord({ ...(state[field] as any), [id]: entity }));
      return () => set((state) => {
        const restored = prev
          ? { ...(state[field] as any), [id]: prev }
          : (state[field] as any);
        return applyRecord(restored);
      });
    },
    _applyDelete: (id: string): Rollback => {
      const prev = (get()[field] as any)[id];
      set((state) => {
        const { [id]: _, ...rest } = state[field] as any;
        return applyRecord(rest);
      });
      return () => set((state) => {
        const restored = prev
          ? { ...(state[field] as any), [id]: prev }
          : (state[field] as any);
        return applyRecord(restored);
      });
    },
  };
}
```

Usage in a store:

```ts
// Before (25+ lines of identical boilerplate per store)
_applyCreate: (thread: ThreadMetadata): Rollback => { ... },
_applyUpdate: (id: string, thread: ThreadMetadata): Rollback => { ... },
_applyDelete: (id: string): Rollback => { ... },

// After (1 line, spread into store)
...createRecordActions<ThreadMetadata, ThreadStoreState>(set, get, "threads", "_threadsArray"),
```

The function signatures, rollback behavior, and Zustand integration are identical. You can still override individual methods by defining them after the spread.

**What it does NOT abstract:** hydration, selectors, domain-specific actions (markAsRead, focus management, etc.). Those stay explicit in each store.

## Phase 4: Update listener files

Each listener file replaces its try/catch blocks with `onEvent`. The handler body stays the same. Example for `repositories/listeners.ts`:

```ts
// Before
eventBus.on(EventName.REPOSITORY_UPDATED, async ({ name }) => {
  try {
    await repoService.refresh(name);
  } catch (e) {
    logger.error(`[RepositoryListener] Failed to refresh updated repository ${name}:`, e);
  }
});

// After
onEvent(EventName.REPOSITORY_UPDATED, "RepositoryListener", async ({ name }) => {
  await repoService.refresh(name);
});
```

**Exceptions that stay untouched:**
- `terminal-sessions/listeners.ts` — uses Tauri `listen()`, not eventBus. Different API entirely.
- `quick-actions/listeners.ts` — uses string event names, not EventName enum. Would need separate typing work.
- Any handler with logic beyond just try/catch (e.g., conditional cascade in relations) — the `onEvent` wrapper still works, the handler body just stays complex.

## Phase 5: Update store files

Stores that use the standard `_applyCreate/_applyUpdate/_applyDelete` pattern spread in `createRecordActions`. Applicable stores:

- `threads/store.ts` — field: `"threads"`, array: `"_threadsArray"`
- `plans/store.ts` — field: `"plans"`, array: `"_plansArray"`
- `relations/store.ts` — field: `"relations"`, array: `"_relationsArray"`, getId: `makeKey()`
- `repositories/store.ts` — field: `"repositories"` (no array)
- `permissions/store.ts` — skip if CRUD pattern differs (request-based)
- `terminal-sessions/store.ts` — field: `"sessions"`, array: `"_sessionsArray"`
- `quick-actions/store.ts` — field: `"actions"`, array: `"_actionsArray"`

**Not touched:** Logs (array-based, not record), Drafts (no CRUD), Skills (no CRUD), Settings (single object).

## Expected savings

| Change | Files affected | Lines saved (est.) |
|--------|---------------:|-------------------:|
| Delete 6 re-export type files | 6 deleted + import updates | ~90 |
| `onEvent` helper + listener updates | 1 new + ~7 updated | ~120 |
| `createRecordActions` + store updates | 1 new + ~7 updated | ~200 |
| **Total** | | **~410** |

Not massive. The point isn't line count — it's that the next entity someone adds doesn't require copy-pasting 60 lines of mechanical code they have to get exactly right.
