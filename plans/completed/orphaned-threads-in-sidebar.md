# Orphaned Threads Appearing Without Parent Worktree

## Problem

Thread `483ec393-c07f-4e17-b15f-2d4a818c2444` (and potentially others) appears in the sidebar at root level without any parent worktree. This should be impossible since every thread requires a `worktreeId` at creation.

## Root Cause Analysis

The fallback logic in `buildChildrenMap()` (`src/hooks/use-tree-data.ts:82-86`) is responsible:

```typescript
let parentKey = node.parentId ?? ROOT;
// If parentId references a non-existent node, fall back to ROOT
if (parentKey !== ROOT && !nodeById.has(parentKey)) {
  parentKey = ROOT;
}
```

When a thread's `parentId` (derived from `visualSettings.parentId ?? worktreeId` in `tree-node-builders.ts:96`) references a node that doesn't exist in the tree, the thread renders at ROOT level — floating without a parent.

### How threads become orphaned

**Scenario A — Worktree sync removes a worktree**: `worktreeService.sync()` (Rust-side) "removes worktrees from settings that no longer exist on disk." If a git worktree is deleted externally (e.g., `git worktree remove` in terminal), sync removes it from `settings.json`, but **no cascade cleanup runs for the orphaned threads/plans**. On next hydration, threads load from `~/.anvil-dev/threads/` with a `worktreeId` that no longer maps to any worktree node.

**Scenario B — Worktree archive race conditions**: `handleArchiveWorktree` (`main-window-layout.tsx:571-654`) archives entities before deleting the worktree. It queries `threadService.getByWorktree(worktreeId)` at the *start* of the handler, then deletes the worktree and syncs. If a thread arrives between the query and the sync (e.g., a sub-agent just finished writing metadata), it gets orphaned.

**Scenario C — Stale visualSettings.parentId**: A sub-agent thread has `visualSettings.parentId: parentThreadId` (`shared.ts:798`). If the parent thread is archived, the cascade should catch the sub-agent, but `cascadeArchive` builds its children map from the Zustand store — if the store hasn't been updated yet (e.g., on a different window), the sub-agent may not appear as a child of the parent.

**Most likely**: Scenario A — an external worktree deletion followed by `worktreeService.sync()`.

## Relevant Files

| File | Role |
| --- | --- |
| `src/hooks/use-tree-data.ts:82-86` | `buildChildrenMap` — the fallback-to-ROOT logic |
| `src/hooks/tree-node-builders.ts:96` | `threadToNode` — `parentId = visualSettings?.parentId ?? worktreeId` |
| `src/stores/repo-worktree-lookup-store.ts` | Worktree discovery from `settings.json` |
| `src/entities/threads/service.ts:82-107` | Thread hydration — loads ALL threads from disk regardless of worktree validity |
| `src/entities/worktrees/service.ts:50-52` | `worktreeService.sync()` — removes stale worktrees, no entity cleanup |
| `src/components/main-window/main-window-layout.tsx:571-654` | `handleArchiveWorktree` — entity cleanup before worktree delete |
| `src/lib/cascade-archive.ts` | Visual cascade archive for tree children |

## Investigation Results (Phase 1)

**Thread** `483ec393` and 2 siblings (`d26db8f5`, `b1ee9980`) are all orphaned from the same cause:

| Field | Value |
| --- | --- |
| `repoId` | `3631f90e` → `shortcut` **repo** (not `anvil`) |
| `worktreeId` | `739e9568` → **does not exist** in any repo's worktree list |
| `visualSettings.parentId` | `739e9568` (same as worktreeId) |

**Current worktrees**:

- `shortcut` repo: `['43cb2af8']` — only 1 worktree, `739e9568` is gone
- `anvil` repo: `['4e6d4a15', 'da1e4394']`

**Confirmed: Scenario A.** Worktree `739e9568` was removed from the `shortcut` repo (via sync or archive), but no entity cleanup ran for its 3 threads.

**Additional finding — no repo scoping in tree**: `useTreeData()` (line 204) pulls `_threadsArray` from the global store without filtering by repoId. These `shortcut` repo threads render in the `anvil` sidebar because there's no repo boundary. The tree builder receives ALL threads across ALL repos.

**Bug path**: `hydrate()` loads all threads → `useTreeData()` passes all to `buildUnifiedTree()` → `threadToNode()` sets `parentId = 739e9568` → `buildChildrenMap()` can't find `739e9568` in nodeById → falls back to ROOT → thread renders at root level in wrong repo's sidebar.

## Phases

- [x] Investigate the specific thread to confirm which scenario caused it

- [x] Filter orphaned threads out of tree building so they don't render in the sidebar

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Design Notes

### Scope decision

Auto-archiving orphans (on hydration or during worktree sync) is deferred — there's a real race condition risk where worktrees haven't fully loaded yet and we'd incorrectly archive active threads. The UI filter is safe: orphaned threads simply don't render. They remain on disk and will reappear if their worktree is re-added.

### Phase 2: Filter orphaned threads from tree building

Two changes needed:

**1. Exclude threads with unknown worktreeIds** — in `useTreeData` (or `buildUnifiedTree`), filter threads before they enter the tree:

```typescript
const knownWorktreeIds = new Set(worktrees.map(w => w.worktreeId));
const validThreads = threads.filter(t => knownWorktreeIds.has(t.worktreeId));
```

This handles the main bug: threads from deleted worktrees (including cross-repo orphans) are excluded entirely rather than falling back to ROOT.

**2. Improve fallback for sub-agent orphans** — in `buildChildrenMap`, when a node's `parentId` references a missing node but its `worktreeId` still exists, fall back to the worktree node instead of ROOT:

```typescript
if (parentKey !== ROOT && !nodeById.has(parentKey)) {
  if (node.worktreeId && nodeById.has(node.worktreeId)) {
    parentKey = node.worktreeId;
  }
  // If worktreeId also missing, node was already filtered out above
}
```

This covers Scenario C (archived parent thread, worktree still exists) — the sub-agent thread renders under its worktree instead of floating at root.

### Future work (deferred)

- **Orphan cleanup on hydration**: Auto-archive threads whose worktreeId doesn't exist. Requires careful ordering to ensure worktree discovery completes first.
- **Sync gap fix**: When `worktreeService.sync()` removes a worktree, cascade-archive its entities. Needs the same ordering guarantees.