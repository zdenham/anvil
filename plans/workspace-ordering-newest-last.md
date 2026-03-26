# Workspace Ordering: Newest at Bottom

## Problem

When a new workspace is created, it jumps to the top of the sidebar list. This is visually jarring because the "create workspace" button is at the bottom — you click at the bottom but the result appears at the top.

**Root cause:** `worktreeSync` in `sidecar/src/dispatch/dispatch-worktree.ts:275-277` sorts worktrees by `createdAt` descending (newest first). After workspace creation, the flow calls `worktreeService.sync()` → `hydrate()`, which rebuilds the store from this sorted order.

## Phases

- [ ] Reverse the worktree sort order in the sidecar sync function

- [ ] Propagate `createdAt` to frontend tree nodes for correct sort fallback

- [ ] Verify MRU / spotlight ordering is unaffected

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Reverse the sort order in `worktreeSync`

**File:** `sidecar/src/dispatch/dispatch-worktree.ts:275-277`

Change the sort from newest-first to oldest-first:

```ts
// Before (newest first — workspace jumps to top)
filtered.sort(
  (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
);

// After (oldest first — new workspace stays at bottom)
filtered.sort(
  (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
);
```

This is the primary fix. The settings.json array order determines the Map insertion order in the lookup store, which determines sidebar order.

## Phase 2: Propagate `createdAt` to frontend tree nodes

**File:** `src/hooks/tree-node-builders.ts:60-79`

Currently `worktreeToNode` hardcodes `createdAt: 0` for all worktree nodes. This means the tree sort in `use-tree-data.ts:231-232` (`b.createdAt - a.createdAt`) always ties and falls back to Map insertion order. While Phase 1 fixes the Map order, we should also flow through the real `createdAt` for robustness.

1. Add `createdAt` to the `WorktreeInfo` interface in `src/hooks/use-tree-data.ts` (currently has: `worktreeId`, `repoId`, `repoName`, `worktreeName`, `worktreePath`, `visualSettings`, `isExternal`)

2. Populate it when building `WorktreeInfo` from the lookup store (line \~304). The `WorktreeLookupInfo` in `repo-worktree-lookup-store.ts` doesn't currently store `createdAt` — it will need to be added there too, sourced from the settings.json during hydrate.

3. Use it in `worktreeToNode` instead of hardcoded `0`.

4. **Also flip the tree sort for worktree-type nodes** in `use-tree-data.ts:231-232`. Currently it's `b.createdAt - a.createdAt` (newest first). For worktrees specifically, we want oldest first. One approach: only apply the desc sort to non-worktree nodes, or sort worktrees by `createdAt` ascending.

**Note:** Threads/PRs/other children should still sort newest-first within their worktree parent. The ascending sort should only apply to worktree nodes themselves (children of repo nodes).

## Phase 3: Verify MRU / spotlight is unaffected

The MRU store (`src/stores/mru-worktree-store.ts`) independently tracks `lastAccessedAt` timestamps and sorts by most-recent-first for spotlight results. This is correct behavior for spotlight and should not be changed. Verify:

- `getMRUWorktrees()` still returns most-recently-accessed first (used by spotlight)
- The sidebar tree uses creation order (oldest first), not MRU order
- Drag-and-drop reordering (`sortKey`) still takes precedence over `createdAt` in the tree sort