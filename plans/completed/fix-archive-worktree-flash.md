# Fix: Archive Worktree "repo/main" Flash & Duplicate

## Problem

When archiving a worktree, users see a brief flash where the section shows "repo/main" and sometimes two "main" worktrees appear.

## Root Cause

Race condition between optimistic worktree removal and entity archiving.

In `main-window-layout.tsx` `handleArchiveWorktree` (line 591):

1. **Synchronous:** `removeOptimisticWorktree(repoId, worktreeId)` — removes worktree from lookup store
2. **Synchronous:** `closeTabsByWorktree(...)` — closes tabs
3. **Synchronous:** `treeMenuService.hydrate()` — triggers re-render
4. **Background (fire-and-forget):** Archives threads/plans/terminals, then deletes worktree

Between steps 3 and 4, the tree re-renders with:
- Worktree **gone** from `useRepoWorktreeLookupStore`
- Threads/plans **still in** their entity stores, referencing the removed worktreeId

In `use-tree-data.ts` `buildTreeFromEntities` (line 390), orphaned threads call `ensureSection(thread.repoId, thread.worktreeId)`, which calls `getWorktreeName()`. Since the worktree no longer exists in the lookup store, it falls back to `"main"` (line 112 of `repo-worktree-lookup-store.ts`):

```typescript
getWorktreeName: (repoId, worktreeId) => {
  return repo?.worktrees.get(worktreeId)?.name ?? "main";  // ← fallback
}
```

This creates a ghost section labeled "repo/main" with the orphaned threads. If a real "main" worktree exists, you get two "main" entries.

## Phases

- [x] Optimistically remove entities from in-memory stores before the fire-and-forget
- [x] Verify no duplicate "main" sections can appear

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

In `handleArchiveWorktree`, remove threads/plans/terminals from their in-memory stores **immediately** (before the fire-and-forget), then do disk archiving in background.

### Current flow:
```
sync:  removeOptimisticWorktree → closeTabsByWorktree → treeMenuService.hydrate
async: archiveEntities (removes from stores + moves on disk) → deleteWorktree → sync
```

### Fixed flow:
```
sync:  removeOptimisticWorktree → removeEntitiesFromStores → closeTabsByWorktree → treeMenuService.hydrate
async: archiveEntitiesToDisk (disk-only) → deleteWorktree → sync
```

Specifically in `main-window-layout.tsx`:

1. After `removeOptimisticWorktree`, immediately call `_applyDelete` on each thread, plan, terminal, and PR in their respective stores — this removes them from the reactive arrays that `useTreeData` subscribes to
2. Store the rollback functions
3. In the background async, only do the disk operations (move to archive dir, delete originals)
4. On error, execute the rollbacks

This is the most targeted fix — the stores already support optimistic deletion with rollback. We just need to pull the store removal out of the background async and into the synchronous path.

### Alternative (simpler but less complete)

In `buildTreeFromEntities`, skip entities whose `worktreeId` doesn't exist in the known worktrees set. This prevents ghost sections from appearing regardless of archiving timing. This is a more defensive approach and could be done as an additional safeguard.

### Recommended

Do both: the immediate store removal (primary fix) AND the defensive filter in `buildTreeFromEntities` (belt-and-suspenders).
