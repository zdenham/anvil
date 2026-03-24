# Plan Entity Implementation - Sub-Plans

This directory contains the broken-down implementation plan for the Plan Entity feature.

## Design Decisions Summary

These decisions were made during plan review and apply across all sub-plans:

### Architecture
- **Storage Location**: Plans stored in `plans/{id}/metadata.json` within `.anvil` data directory
- **Persistence Pattern**: Use `persistence.readJson/writeJson/glob` (NOT `window.api`)
- **Store Pattern**: Plain Zustand without immer middleware
- **UUID Generation**: Use native `crypto.randomUUID()`
- **Hydration Order**: Parallel hydration via `Promise.all` (plans alongside other entities)
- **Navigation**: Use Tauri IPC (`openSimpleTask()`, `switchSimpleTaskClientSide()`) - NOT router

### Detection
- **Scope**: Only detect `plans/*.md` files (case-sensitive)
- **Read Tool**: Does NOT trigger association
- **Write/Edit Tools**: DOES trigger association
- **Human Message**: Mentioning plan path DOES trigger association
- **Cardinality**: One plan per thread (may expand to many-to-many later)

### Types & Data
- **UUID Validation**: Use `z.string().uuid()` for stricter validation
- **isRead Default**: `false` - new plans are unread
- **Read Status on Update**: Any creation/update marks plan as unread
- **Null for Unsetting**: Use `null` to explicitly unset associations

### UI/UX
- **View Switching**: Three-way icon toggle (thread → changes → plan → thread)
- **Plan Button**: Always visible with empty state (not hidden when no plan)
- **Mark As Read**: Slight delay before marking (matches thread behavior)
- **Navigation Priority**: Unread thread > unread plan for same task

## Execution Order

```
                    ┌─────────────────────┐
                    │   01-core-types     │
                    │   (must be first)   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
    │ 02-store-service│ │03-detection │ │ 04-entity-rels  │
    │   (parallel)    │ │ (parallel)  │ │   (parallel)    │
    └────────┬────────┘ └──────┬──────┘ └────────┬────────┘
             │                 │                 │
             └────────────────┬┴─────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   05-hydration      │
                    │ (after 01-04 done)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
          ┌─────────────────┐   ┌─────────────────┐
          │    06-ui        │   │ 07-navigation   │
          │   (parallel)    │   │   (parallel)    │
          └─────────────────┘   └─────────────────┘
```

## Sub-Plans

| File | Description | Dependencies | Parallelizable With |
|------|-------------|--------------|---------------------|
| `01-core-types.md` | Plan types and schemas | None | - |
| `02-store-service.md` | Zustand store and service | 01 | 03, 04 |
| `03-detection.md` | Plan detection logic | 01 | 02, 04 |
| `04-entity-relationships.md` | Task/thread planId fields | 01 | 02, 03 |
| `05-hydration.md` | Bootstrap integration | 01, 02, 03, 04 | - |
| `06-ui.md` | PlanTab and UI components | 05 | 07 |
| `07-navigation.md` | Unified navigation + read status | 05 | 06 |

## Estimated Complexity

- **01-core-types**: Small (~30 lines)
- **02-store-service**: Medium (~200 lines)
- **03-detection**: Small (~80 lines)
- **04-entity-relationships**: Small (~20 lines, mostly type changes)
- **05-hydration**: Small (~30 lines)
- **06-ui**: Medium (~150 lines)
- **07-navigation**: Medium (~100 lines)

## Quick Start

1. Start with `01-core-types.md`
2. Once complete, run `02`, `03`, `04` in parallel
3. After all complete, run `05-hydration.md`
4. Finally, run `06` and `07` in parallel

## Key Implementation Notes

### Critical Patterns to Follow

1. **Persistence** (see `src/lib/persistence.ts`):
   ```typescript
   import { persistence } from "@/lib/persistence";
   await persistence.writeJson("plans/{id}/metadata.json", plan);
   const data = await persistence.readJson("plans/{id}/metadata.json");
   ```

2. **Repository Name Resolution** (threads don't have repositoryName):
   ```typescript
   const task = useTaskStore.getState().tasks[thread.taskId];
   const repositoryName = task?.repositoryName;
   ```

3. **AGENT_STATE Event Structure**:
   ```typescript
   eventBus.on(EventName.AGENT_STATE, async ({ threadId, state }) => {
     // fileChanges is inside state, not at top level
     if (state.fileChanges && state.fileChanges.length > 0) { ... }
   });
   ```

4. **FileChange Type** (from `@core/types/events`):
   ```typescript
   interface FileChange {
     path: string;
     operation: "create" | "modify" | "delete" | "rename";
     oldPath?: string;
     diff: string;
   }
   ```
