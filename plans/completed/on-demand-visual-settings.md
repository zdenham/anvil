# On-Demand Visual Settings Backfill

## Problem

The deleted migration (`002-visual-settings-backfill.ts`) was a startup batch operation that scanned all entities on disk and backfilled `visualSettings.parentId` for entities created before the visual settings system existed. This approach is fragile — it runs once, at a specific migration version, and can't handle entities that later lose their `visualSettings` for any reason.

We want an **on-demand** approach: when building the tree, if an entity is missing `visualSettings`, compute and persist the correct defaults idempotently. This is more resilient and self-healing.

## Current State

**New entities are fine.** All creation paths already seed `visualSettings`:
- `threadService.create()` → `{ parentId: worktreeId }` (`service.ts:212`)
- Sub-agent creation in `shared.ts:797` → `{ parentId: context.threadId }`
- `simple-runner-strategy.ts:409` → `{ parentId: parentThreadId ?? worktreeId }`
- `planService.create()` → `{ parentId: domainParentId ?? worktreeId }` (`plans/service.ts:207`)
- `prService.create()` → `{ parentId: worktreeId }` (`pull-requests/service.ts:77`)
- `terminalService` → `{ parentId: worktreeId }` (`terminal-sessions/service.ts:105`)

**Old entities may lack `visualSettings`.** Entities created before the visual settings system was introduced will have `visualSettings: undefined`. The tree-node-builders handle this gracefully at render time (`thread.visualSettings?.parentId ?? thread.worktreeId`), but this means their computed parentId is never persisted — they'll never participate correctly in DnD, cascade archive, or other operations that read persisted `visualSettings`.

## Design

### `ensureVisualSettings(entityType, entity) → VisualSettings`

A pure function that **only runs when `entity.visualSettings` is `undefined`**. The caller gates on this before calling — the function itself should also guard (`if (entity.visualSettings) return entity.visualSettings`) as a safety net. It computes default `visualSettings` from the entity's domain fields, encoding the same rules the deleted migration used:

| Entity Type | Rule |
|---|---|
| Thread with `parentThreadId` | `{ parentId: parentThreadId }` |
| Thread without `parentThreadId` | `{ parentId: worktreeId }` |
| Plan with domain `parentId` | `{ parentId: parentId }` |
| Plan without domain `parentId` | `{ parentId: worktreeId }` |
| PR | `{ parentId: worktreeId }` |
| Terminal | `{ parentId: worktreeId }` |
| Folder (no `visualSettings`) | `{ parentId: worktreeId }` |

**Strict skip-if-exists**: if `entity.visualSettings` is defined (any truthy value), **return it as-is — never overwrite, merge, or "fix" existing settings**. This function only runs for entities where `visualSettings` is `undefined`. We intentionally do NOT inspect the contents of existing `visualSettings` (e.g., checking for a missing `parentId` inside an existing object). If a user or other code path has set `visualSettings` to *anything*, we respect it unconditionally. This avoids double-write bugs and ensures user-initiated changes (DnD reparenting, etc.) are never clobbered.

### Call site: `buildUnifiedTree()`

In `use-tree-data.ts`, `buildUnifiedTree()` is the single point where all entities are assembled into tree nodes. Before converting entities to nodes, run the backfill check:

```typescript
// In buildUnifiedTree, before the node-building loops:
for (const thread of threads) {
  // SKIP if visualSettings already exists — never overwrite
  if (thread.visualSettings) continue;

  thread.visualSettings = ensureVisualSettings("thread", thread);
  // Fire-and-forget persist — don't await in the render path
  void persistVisualSettings("thread", thread.id, thread.visualSettings);
}
// Same pattern for plans, terminals, PRs, folders — always skip if visualSettings exists
```

### Persist function

A lightweight fire-and-forget writer that calls the existing `updateVisualSettings()` from `src/lib/visual-settings.ts`. This reuses the existing per-entity-type update logic. Wrap in a dedup guard so we never persist the same entity twice per session:

```typescript
const persisted = new Set<string>();

function persistVisualSettings(
  entityType: VisualEntityType,
  entityId: string,
  settings: VisualSettings,
): void {
  const key = `${entityType}:${entityId}`;
  if (persisted.has(key)) return;
  persisted.add(key);
  void updateVisualSettings(entityType, entityId, settings);
}
```

### File placement

Put `ensureVisualSettings` and the persist helper in `src/lib/visual-settings.ts` alongside the existing `updateVisualSettings`. This keeps all visual-settings logic in one place.

### Why not hydration time?

Running the backfill during hydration (e.g., in `threadService.hydrate()`) would also work, but:
1. It couples entity services to visual-settings logic
2. Hydration runs for each entity type separately — harder to coordinate
3. The tree builder already has all entities assembled, making it the natural convergence point

### Why not a standalone pass?

A separate "backfill pass" after hydration (like the deleted migration but at app startup) would work, but:
1. It's another lifecycle step to maintain
2. It duplicates the entity-scanning logic already present in `buildUnifiedTree`
3. The on-demand approach is self-healing — if an entity somehow loses `visualSettings` later, it gets fixed automatically

## Phases

- [x] Add `ensureVisualSettings()` function and `persistVisualSettings()` helper to `src/lib/visual-settings.ts`
- [x] Integrate the on-demand backfill into `buildUnifiedTree()` in `src/hooks/use-tree-data.ts`
- [x] Add tests: unit test `ensureVisualSettings` with various entity shapes (with/without visualSettings, with/without parentThreadId, etc.)
- [x] Remove the deleted migration's entry from `migrations/src/migrations/index.ts` if still referenced

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Edge Cases

**Entity with `visualSettings` but no `parentId`**: e.g., `{ sortKey: "abc" }`. We intentionally **do NOT** try to "fix" this case. If `visualSettings` exists in any form, we skip it entirely. Attempting to merge or patch partially-initialized settings risks overwriting user-initiated changes and introduces double-write bugs. If this turns out to be a real problem, it should be handled as a separate, explicit migration — not silently in the tree builder.

**Concurrent tree builds**: The `persisted` set prevents duplicate writes. Since React may re-render `buildUnifiedTree` many times, the dedup guard ensures each entity is only written once per app session.

**Store mutations during persist**: `updateVisualSettings` calls `service.update()` which updates the Zustand store. This will trigger a re-render of `useTreeData`, but the second render will see `visualSettings` already set and skip the backfill — no infinite loop.
