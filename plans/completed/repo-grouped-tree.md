# Repo-Grouped Tree + Fix Worktree DnD Reactivity

## Problem

Two issues:

### 1. Worktree DnD doesn't visually update

When dropping a worktree into a folder, logs confirm the drop is processed (`saveSettings` writes to disk), but the tree doesn't re-render. **Root cause:** `updateVisualSettings` for worktree type (`visual-settings.ts:114-136`) writes the new `parentId`/`sortKey` to the repo's `settings.json` on disk, but **never updates the in-memory Zustand store** (`useRepoWorktreeLookupStore`). Since `useTreeData` derives worktree nodes from the store (not disk), the old `visualSettings` (no `parentId`) persists, and `worktreeToNode()` keeps the worktree at root level.

### 2. Tree should be grouped by repo

Currently, all worktrees render at the same root level as flat nodes. When you have multiple repos, it's unclear which worktrees belong to which repo. The desired hierarchy:

```
Repo A                    ← repo header (collapsible)
  ├── main                ← worktree
  │   ├── Files
  │   ├── Changes
  │   ├── thread 1
  │   └── plan 1
  ├── feature-branch      ← worktree
  │   └── thread 2
  └── My Folder           ← folder scoped to repo
Repo B                    ← repo header
  └── main
```

## Phases

- [x] Fix worktree DnD reactivity (store not updating after visual settings save)

- [x] Introduce repo-level grouping in tree builder

- [x] Add repo header component + update rendering

- [x] Update DnD validation for repo boundaries

- [x] Update worktree display to drop repo name prefix

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Fix worktree DnD reactivity

**The bug:** `updateVisualSettings("worktree", ...)` in `src/lib/visual-settings.ts:114-136` calls `saveSettings()` which writes to disk but doesn't update `useRepoWorktreeLookupStore`. The store's `repos` Map still has stale `visualSettings` on each `WorktreeLookupInfo`, so `worktreeToNode()` builds nodes with the old (missing) `parentId`.

**Fix:** After `saveSettings()` completes in the worktree case, call `useRepoWorktreeLookupStore.getState().hydrate()` to re-read the store from disk. This is a simple one-line addition.

Alternatively (more efficient), add an `updateWorktreeVisualSettings(repoId, worktreeId, patch)` method to `useRepoWorktreeLookupStore` that directly mutates the in-memory Map without a full re-hydrate. But the repoId isn't available in the current `updateVisualSettings` call site since it only receives `entityId` (worktreeId). The hydrate approach is simpler and sufficient — worktree DnD is infrequent.

**File:** `src/lib/visual-settings.ts` — worktree case (\~line 133), add:

```ts
const { useRepoWorktreeLookupStore } = await import("@/stores/repo-worktree-lookup-store");
await useRepoWorktreeLookupStore.getState().hydrate();
```

## Phase 2: Introduce repo-level grouping in tree builder

**Goal:** Add a `"repo"` node type and group worktrees under their repo.

### 2a. Add `"repo"` to `TreeItemType`

**File:** `src/stores/tree-menu/types.ts`

Add `"repo"` to the `TreeItemType` union. Add repo-specific fields to `TreeItemNode` if needed (though `repoId` and `repoName` already exist).

### 2b. Create `repoToNode()` builder

**File:** `src/hooks/tree-node-builders.ts`

Add a new function:

```ts
export function repoToNode(repoId: string, repoName: string): TreeItemNode {
  return {
    type: "repo",
    id: repoId,
    title: repoName,
    status: "read",
    updatedAt: 0,
    createdAt: 0,
    depth: 0,
    isFolder: true,
    isExpanded: true,
    repoId,
    repoName,
  };
}
```

### 2c. Update `buildUnifiedTree()` to create repo nodes

**File:** `src/hooks/use-tree-data.ts`

In Step 1, before creating worktree nodes, create one repo node per unique `repoId`. Then set each worktree's `parentId` to its `repoId` (unless it already has a `visualSettings.parentId` — which means it was moved to a folder).

Key logic:

```ts
// Create repo group nodes
const repoIds = new Set(worktrees.map(w => w.repoId));
for (const repoId of repoIds) {
  const repoName = worktrees.find(w => w.repoId === repoId)!.repoName;
  allNodes.push(repoToNode(repoId, repoName));
}

// When building worktree nodes, default parentId to repoId
for (const wt of worktrees) {
  const node = worktreeToNode(wt);
  if (!node.parentId) {
    node.parentId = wt.repoId;
  }
  allNodes.push(node);
}
```

### 2d. Handle single-repo case (optional simplification)

If there's only one repo, we could skip the repo grouping node to avoid an unnecessary nesting level. This is a UX decision — recommend showing it always for consistency.

### 2e. Expansion state

Repo nodes default to expanded. Use `expandKey` pattern: repo nodes use their `repoId` as the key (same as worktrees currently do, but distinct since repoId !== worktreeId).

## Phase 3: Add repo header component + update rendering

### 3a. Create `RepoItem` component

**File:** `src/components/tree-menu/repo-item.tsx` (new)

Simple collapsible header showing the repo name. Styling: similar to worktree headers but differentiated (bolder, no branch name). Context menu with: "New worktree", "New repo", "Collapse/Expand all".

### 3b. Update `TreeItemRenderer`

**File:** `src/components/tree-menu/tree-item-renderer.tsx`

Add `case "repo":` that renders `<RepoItem>`. Pass through relevant callbacks (`onNewWorktree`, `onNewRepo`, etc.).

### 3c. Update divider logic

**File:** `src/components/tree-menu/tree-menu.tsx`

The divider currently shows between root-level worktrees/folders. Update to show between repo nodes instead (or remove entirely since repos are natural visual separators).

## Phase 4: Update DnD validation for repo boundaries

**File:** `src/lib/dnd-validation.ts`

- Add `"repo"` to `SYNTHETIC_TYPES` or create a new set — repo nodes should NOT be draggable (repos are fixed).
- Worktrees can be reordered within a repo but not dragged between repos.
- Existing worktree boundary enforcement should still work since `worktreeId` scoping is preserved.
- Folders at root level (no `worktreeId`) should still be able to exist at root or under a repo.

Key changes:

- Repo nodes cannot be dragged
- Items cannot be dropped "inside" a repo directly (they go inside worktrees)
- Worktrees can only be reordered within their repo or moved to root-level folders

## Phase 5: Update worktree display

**File:** `src/components/tree-menu/worktree-item.tsx`

Since the repo name is now shown on the parent repo header, the worktree title should just show the branch/worktree name (e.g., `main` instead of `shortcut / main`). Update `worktreeToNode()` in `tree-node-builders.ts` to set `title: wt.worktreeName` instead of the current `${wt.repoName} / ${wt.worktreeName}` format.

The `WorktreeHeader` component (worktree-item.tsx:159) currently renders `{item.repoName} / {worktreeName}` — simplify to just `{worktreeName}`.

---

## Files touched (summary)

| File | Change |
| --- | --- |
| `src/lib/visual-settings.ts` | Re-hydrate store after worktree settings save |
| `src/stores/tree-menu/types.ts` | Add `"repo"` to TreeItemType |
| `src/hooks/tree-node-builders.ts` | Add `repoToNode()`, simplify worktree title |
| `src/hooks/use-tree-data.ts` | Create repo group nodes, set worktree parentId |
| `src/components/tree-menu/repo-item.tsx` | New component for repo headers |
| `src/components/tree-menu/tree-item-renderer.tsx` | Add repo case |
| `src/components/tree-menu/tree-menu.tsx` | Update divider logic |
| `src/components/tree-menu/worktree-item.tsx` | Drop repo name from display |
| `src/lib/dnd-validation.ts` | Repo boundary rules |
| `src/hooks/__tests__/use-tree-data.test.ts` | Update tests for repo grouping |
| `src/lib/__tests__/dnd-validation.test.ts` | Update tests for repo rules |
