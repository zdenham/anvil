# Optimistic Worktree Deletion

## Problem

Archiving a worktree is slow and provides no visual feedback. The current flow in `main-window-layout.tsx:592-650` is fully sequential:

1. Confirmation dialog
2. `await terminalSessionService.archiveByWorktree()`
3. Sequential `await threadService.archive()` per thread
4. Sequential `await planService.archive()` per plan
5. `await worktreeService.delete()` (git worktree remove — blocking)
6. `await worktreeService.sync()`
7. `await hydrate()` + `await treeMenuService.hydrate()`

The user stares at nothing for potentially seconds while this completes.

## Approach

Mirror the optimistic creation pattern (`handleNewWorktree` at lines 439-515): remove the worktree from UI immediately after confirmation, then run the slow work in the background with rollback on failure.

## Phases

- [x] Add `removeOptimisticWorktreeByRealId` to lookup store
- [x] Close open tabs belonging to the worktree being archived
- [x] Refactor `handleArchiveWorktree` to be optimistic
- [x] Parallelize the background archive operations

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `removeOptimisticWorktreeByRealId` to lookup store

**File:** `src/stores/repo-worktree-lookup-store.ts`

The existing `removeOptimisticWorktree(repoId, tempWorktreeId)` works for creation rollback (removes a temp UUID entry). For deletion, we need to remove a **real** worktree entry by its actual ID.

The method signature is identical — `removeOptimisticWorktree` already takes any ID and deletes it from the worktree map. **We can reuse it directly** for deletion since it just does `worktrees.delete(id)`. No new method needed.

However, we do need a **restore** method for rollback. If the background delete fails, we need to put the worktree back:

Add `restoreWorktree(repoId: string, worktreeId: string, info: WorktreeLookupInfo)`:
- Inserts the given worktree entry back into the repo's worktree map
- Used as rollback if the backend delete fails

## Phase 2: Close open tabs belonging to the archived worktree

**File:** `src/stores/pane-layout/service.ts`

Before removing the worktree from the sidebar, close any open tabs that reference content in that worktree. Currently there's no bulk close method.

Add `closeTabsByWorktree(worktreeId: string)` to `paneLayoutService`:
- Iterate all groups, find tabs whose view references the worktreeId
- Tab views that can reference a worktree: `thread` (via threadService lookup), `terminal` (via terminalSessionService lookup), `plan` (via planService lookup), `changes` (has `worktreeId` directly), `file` (has optional `worktreeId`)
- Close each matching tab via `closeTab()`
- Must also handle the case where closing all tabs in a group triggers group removal

The simplest initial approach: collect thread IDs and plan IDs for the worktree (already computed in the handler), terminal IDs, then close tabs matching those IDs plus any `changes`/`file` views with matching `worktreeId`.

## Phase 3: Refactor `handleArchiveWorktree` to be optimistic

**File:** `src/components/main-window/main-window-layout.tsx`

Restructure the handler:

```
1. Show confirmation dialog (unchanged)
2. Gather worktree info for rollback (name, path, currentBranch)
3. OPTIMISTIC: Remove worktree from lookup store immediately
4. OPTIMISTIC: Close tabs belonging to this worktree
5. OPTIMISTIC: Collapse/remove the tree menu section
6. BACKGROUND (fire-and-forget try/catch):
   a. Archive terminals, threads, plans
   b. Delete worktree via backend
   c. Sync + hydrate to reconcile
   d. On error: restore worktree to lookup store, re-hydrate
```

Add `archivingSectionIds` state (mirroring `creatingSectionIds`) — this could be used to show a brief "archiving..." indicator if the worktree reappears due to rollback, but the primary UX is instant disappearance.

Track which section IDs are mid-archive to prevent double-archive and to support rollback UI if needed.

## Phase 4: Parallelize the background archive operations

Currently threads and plans are archived sequentially with individual `await` calls. Change to:

```typescript
await Promise.all([
  terminalSessionService.archiveByWorktree(worktreeId),
  ...threads.map(t => threadService.archive(t.id)),
  ...plans.map(p => planService.archive(p.id)),
]);
```

This can be done inside the background portion of the optimistic handler. The `worktreeService.delete()` call should still come after these complete (it removes the git worktree which the terminals may still reference).

## Key Design Decisions

1. **Confirmation dialog stays synchronous** — user safety requires explicit confirmation before anything happens. The "optimistic" part starts after confirmation.

2. **Rollback = re-hydrate** — if the backend delete fails, we restore the worktree entry to the store and re-hydrate from disk. Since disk is truth, this will restore the full correct state.

3. **Tab closure is immediate** — tabs for threads/terminals in the archived worktree close instantly as part of the optimistic removal. If rollback occurs, the user would need to re-open them manually (acceptable trade-off for the rare failure case).

4. **No toast/notification needed initially** — the worktree just disappears from the sidebar. Could add a success toast later if desired.
