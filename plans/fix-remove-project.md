# Fix: Remove Project doesn't clean up child entities

## Problem

`handleRemoveRepo` (main-window-layout.tsx:664-683) only calls `repoService.remove(repoId)` which deletes `~/.anvil/repositories/{slug}` and removes the repo from the store. It does **not**:

1. **Close open tabs** for threads/plans/terminals/files in that repo's worktrees
2. **Archive threads** belonging to the repo's worktrees (they become orphans in `~/.anvil/threads/`)
3. **Archive plans** belonging to the repo's worktrees (orphans in `~/.anvil/plans/`)
4. **Kill & archive terminal sessions** (orphaned PTYs may keep running)
5. **Archive pull requests** for the repo's worktrees
6. **Archive folders** for the repo's worktrees
7. **Clean up gateway channels** for the repo

After removal, on next hydration the orphaned threads/plans/terminals still reference the deleted repo's worktreeIds, likely causing the repo to "come back" or leaving ghost state.

### Constraint from user

Worktrees should **NOT** be hard-deleted from disk when removing a project. Only Anvil's internal state (metadata in `~/.anvil/`) should be cleaned up. The actual git worktree directories remain on the filesystem.

## Solution

Model `handleRemoveRepo` after the existing `handleArchiveWorktree` pattern (lines 694-777), but iterate over **all worktrees** in the repo. The key difference: skip `worktreeService.delete()` — we don't touch the git worktree on disk.

## Phases

- [x] Phase 1: Update `handleRemoveRepo` with cascading cleanup

- [x] Phase 2: Add tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Update `handleRemoveRepo`

**File:** `src/components/main-window/main-window-layout.tsx`

Replace the current `handleRemoveRepo` (lines 664-683) with logic that:

### 1. Gather all entities across all worktrees in the repo

Use the lookup store to get all worktreeIds for the repo, then collect entities:

```typescript
const handleRemoveRepo = useCallback(async (repoId: string, repoName: string) => {
  const confirmed = await confirm(
    `Remove "${repoName}" from Anvil? This won't delete files on disk.`,
    { title: "Remove project", kind: "warning" },
  );
  if (!confirmed) return;

  try {
    // Gather all worktrees for this repo
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const repo = lookupStore.repos.get(repoId);
    const worktreeIds = repo ? Array.from(repo.worktrees.keys()) : [];

    // Gather all entities across all worktrees
    const allThreads = worktreeIds.flatMap(wtId => threadService.getByWorktree(wtId));
    const allPlans = worktreeIds.flatMap(wtId => planService.getByWorktree(wtId));
    const allTerminals = worktreeIds.flatMap(wtId => terminalSessionService.getByWorktree(wtId));

    // ── Optimistic UI: close tabs first ──
    for (const wtId of worktreeIds) {
      const threads = threadService.getByWorktree(wtId);
      const plans = planService.getByWorktree(wtId);
      const terminals = terminalSessionService.getByWorktree(wtId);
      await closeTabsByWorktree({
        worktreeId: wtId,
        threadIds: new Set(threads.map(t => t.id)),
        planIds: new Set(plans.map(p => p.id)),
        terminalIds: new Set(terminals.map(t => t.id)),
      });
    }

    // ── Remove repo metadata (deletes ~/.anvil/repositories/{slug}) ──
    await repoService.remove(repoId);

    // ── Background: archive all child entities ──
    (async () => {
      try {
        await Promise.all([
          ...worktreeIds.map(wtId => terminalSessionService.archiveByWorktree(wtId)),
          ...allThreads.map(t => threadService.archive(t.id)),
          ...allPlans.map(p => planService.archive(p.id)),
          ...worktreeIds.map(wtId => pullRequestService.archiveByWorktree(wtId)),
        ]);
        // NOTE: Do NOT call worktreeService.delete() — leave worktree dirs on disk
      } catch (error) {
        logger.error(`[MainWindowLayout] Failed to archive entities for removed repo:`, error);
      }
    })();

    // Hydrate stores to reflect removal
    await repoService.hydrate();
    await useRepoWorktreeLookupStore.getState().hydrate();
    await treeMenuService.hydrate();

    logger.info(`[MainWindowLayout] Removed repo "${repoName}" with ${allThreads.length} threads, ${allPlans.length} plans, ${allTerminals.length} terminals`);
  } catch (err) {
    logger.error(`[MainWindowLayout] Failed to remove repo:`, err);
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    toast.error(`Failed to remove "${repoName}": ${errorMsg}`);
  }
}, []);
```

### Key ordering considerations

1. **Close tabs first** (synchronous UI cleanup) — prevents flicker of orphaned tabs
2. **Remove repo metadata** — so hydration won't re-discover the repo
3. **Archive entities in background** — fire-and-forget since repo is already gone from state. Archiving moves metadata to `~/.anvil/archive/` so it's not re-discovered on next hydrate
4. **Hydrate stores** — reconcile all stores with new disk state
5. **No** `worktreeService.delete()` — per user requirement, leave git worktree directories intact

### Edge case: entities gathered before repo removal

The entity lists (threads, plans, terminals) must be gathered **before** `repoService.remove()` since the lookup store maps worktreeIds to repoIds. After removal, the mapping is gone.

## Phase 2: Tests

Add a test in `src/components/main-window/__tests__/` (or an existing test file) that verifies:

1. Removing a repo archives all threads across all its worktrees
2. Removing a repo archives all plans across all its worktrees
3. Removing a repo archives all terminal sessions
4. Removing a repo archives all pull requests
5. Removing a repo does NOT call `worktreeService.delete()`
6. Open tabs for the repo's entities are closed
7. Stores are hydrated after removal