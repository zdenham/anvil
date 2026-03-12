# Auto-Expand Parent Sidebar Item on REPL Child Spawn

## Problem

When a REPL child agent is spawned, the parent thread's sidebar item should automatically expand to reveal the new child. This differs from the regular sub-agent tool where children appear but the parent stays collapsed. REPL agents should be more visible since they're programmatically orchestrated.

## Current Flow

1. `ChildSpawner.spawn()` creates thread metadata on disk with `parentThreadId` set to the REPL parent's thread ID
2. It emits `THREAD_CREATED` via `emitEvent()` with source `"mort-repl:child-spawn"`
3. Frontend `thread/listeners.ts` handles `THREAD_CREATED` → calls `threadService.refreshById(threadId)` (loads metadata from disk into store)
4. Frontend `tree-menu/listeners.ts` handles `THREAD_CREATED` → calls `treeMenuService.refreshFromDisk()` (refreshes expansion state)
5. `use-tree-data.ts` rebuilds the tree — the child thread gets `parentId = thread.visualSettings?.parentId ?? thread.worktreeId`
6. The child appears under its parent thread in the tree, but the parent is only visible if already expanded

**Key insight**: The child's `visualSettings.parentId` is set to `this.context.threadId` (the REPL parent) in `child-spawner.ts:104`. So the child correctly nests under the parent. The problem is the parent thread isn't auto-expanded.

## Approach

The cleanest approach is to handle this in the existing `THREAD_CREATED` listener in `src/entities/threads/listeners.ts`. After refreshing the new thread from disk, check if it has a `parentThreadId` and was spawned by the REPL (distinguishable by source or metadata), then call `treeMenuService.expandSection()` on the parent.

**How to detect REPL children**: The `THREAD_CREATED` event payload currently only has `{ threadId, repoId, worktreeId }`. We can't distinguish REPL from sub-agent tool at the event level. Two options:

- **Option A (simpler)**: After `refreshById()`, read the thread metadata from the store. If `parentThreadId` is set, always auto-expand the parent for any sub-agent. This is simpler but changes behavior for Agent tool sub-agents too.
- **Option B (targeted)**: Add a `source` field to the `THREAD_CREATED` event payload so the frontend can check `source === "mort-repl:child-spawn"`. The source is already passed to `emitEvent()` in child-spawner.ts but isn't included in the event payload — it's metadata for the hub/socket layer only.

**Recommendation**: Option B — add `source` to the event payload. This is surgical and only changes REPL behavior as requested.

## Phases

- [x] Add optional `source` field to `THREAD_CREATED` event payload in `core/types/events.ts`

- [x] Pass `source` through in `child-spawner.ts` emitEvent call (verify it flows to the frontend)

- [x] Add auto-expand logic in `src/entities/threads/listeners.ts` `handleCreated` handler

- [x] Add test coverage for the new auto-expand behavior

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Implementation Details

### Phase 1: Add `source` to THREAD_CREATED payload

**File**: `core/types/events.ts`

Add optional `source` to the `THREAD_CREATED` payload:

```ts
[EventName.THREAD_CREATED]: { threadId: string; repoId: string; worktreeId: string; source?: string };
```

### Phase 2: Verify source flows through

The `emitEvent` in `child-spawner.ts:129-138` already passes `"mort-repl:child-spawn"` as the third arg to `emitEvent`. Need to verify how `emitEvent` is wired — check if the source parameter makes it into the event payload or if it's separate metadata.

**File**: `agents/src/lib/events.ts` — check how `emitEvent` serializes source into the event payload. If source is currently discarded, include it in the payload object.

### Phase 3: Auto-expand in thread listener

**File**: `src/entities/threads/listeners.ts`

In `handleCreated`, after `threadService.refreshById(threadId)`:

```ts
const handleCreated = async ({ threadId, source }: EventPayloads[typeof EventName.THREAD_CREATED]) => {
  try {
    await threadService.refreshById(threadId);

    // Auto-expand parent when REPL spawns a child
    if (source === "mort-repl:child-spawn") {
      const thread = threadService.get(threadId);
      if (thread?.parentThreadId) {
        await treeMenuService.expandSection(`thread:${thread.parentThreadId}`);
      }
    }
  } catch (e) {
    logger.error(`[ThreadListener] Failed to refresh created thread ${threadId}:`, e);
  }
};
```

The expand key format is `thread:{parentThreadId}` — this matches the pattern used in `use-tree-data.ts:expandKey()` where threads use `${node.type}:${node.id}`.

### Phase 4: Tests

- Unit test in `tree-menu/listeners` or `threads/listeners` that verifies `expandSection` is called when a REPL-sourced `THREAD_CREATED` event fires
- Verify existing child-spawner tests still pass (source field is additive, shouldn't break)

## Files Modified

| File | Change |
| --- | --- |
| `core/types/events.ts` | Add `source?: string` to THREAD_CREATED payload |
| `agents/src/lib/events.ts` | Ensure source flows into event payload (if not already) |
| `agents/src/lib/mort-repl/child-spawner.ts` | May need to include source in payload object |
| `src/entities/threads/listeners.ts` | Add auto-expand logic in handleCreated |
| Test files | New test for auto-expand behavior |

## Risks & Edge Cases

- **Multiple REPL children spawned in parallel**: Each spawn fires its own THREAD_CREATED → expandSection is idempotent (no-op if already expanded), so this is safe
- **Parent thread already expanded**: `expandSection` short-circuits with early return if already expanded
- **Parent thread doesn't exist in tree**: `expandSection` writes to disk + store regardless — the expand state will be ready when the tree rebuilds
- **Cross-window**: The event bridge broadcasts THREAD_CREATED to all windows, so the expand will happen in all windows (correct behavior)