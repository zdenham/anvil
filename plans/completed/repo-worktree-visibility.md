# Repo & Worktree Visibility + Repo Removal

Bring back the ability to hide worktrees, add the ability to hide repos, and add a "Remove from Mort" action for repos (leaves source on disk).

## Context

**Current state:**

- **Pin worktree** exists: pins a single worktree, filtering the tree to show only it. "Show all workspaces" in the menu dropdown unpins.
- **Hide worktree** was removed during a prior migration — the old `hiddenSectionIds` array was dropped in favor of the simpler pin model.
- **Hide repo** never existed.
- **Remove repo** backend exists (`repoService.remove()`) but has no UI surface — only `repoService.delete()` (which nukes everything) is accessible from settings.
- `RepoItem` has no context menu at all — just a collapse toggle.

**What we want:**

1. **Hide worktree** — right-click context menu action. Hidden worktrees disappear from the tree until "Show all" is clicked.
2. **Hide repo** — right-click context menu on repo header. Hides the entire repo and all its worktrees.
3. **Remove repo** — right-click context menu on repo header. Calls `repoService.remove()` (deletes `~/.mort/repositories/{slug}` only, source code untouched). Needs confirmation dialog.

## Phases

- [x] Phase 1: Add `hiddenWorktreeIds` and `hiddenRepoIds` to tree-menu persisted state

- [x] Phase 2: Add `RepoContextMenu` with Hide and Remove actions

- [x] Phase 3: Add "Hide workspace" action to worktree context menu

- [x] Phase 4: Wire up filtering in `useTreeData` and "Show all" in menu dropdown

- [ ] Phase 5: Manual smoke test checklist

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add `hiddenWorktreeIds` and `hiddenRepoIds` to tree-menu persisted state

### Files to change

`src/stores/tree-menu/types.ts`

- Add `hiddenWorktreeIds: z.array(z.string()).optional()` and `hiddenRepoIds: z.array(z.string()).optional()` to `TreeMenuPersistedStateSchema`

`src/stores/tree-menu/store.ts`

- Add `hiddenWorktreeIds: string[]` and `hiddenRepoIds: string[]` to `TreeMenuState`
- Add `_applySetHiddenWorktrees` and `_applySetHiddenRepos` optimistic apply methods
- Hydrate them from persisted state (default to `[]`)

`src/stores/tree-menu/service.ts`

- Add `hideWorktree(worktreeId)`, `hideRepo(repoId)`, `unhideAll()` methods
- `unhideAll` clears both arrays AND unpins
- Include both arrays in `getPersistedState()`
- Migration: old format already handled — new fields just default to `[]`

## Phase 2: Add `RepoContextMenu` with Hide and Remove actions

### Files to change

`src/components/tree-menu/repo-item.tsx`

- Add right-click handler (`onContextMenu`) that shows a context menu
- Context menu items:
  - **Hide project** (EyeOff icon) — calls `onHideRepo(repoId)`
  - Separator
  - **Remove from Mort** (Trash2 icon, red text) — calls `onRemoveRepo(repoId, repoName)`

`src/components/tree-menu/repo-item.tsx` (updated props)

- Add `onHideRepo?: (repoId: string) => void`
- Add `onRemoveRepo?: (repoId: string, repoName: string) => void`

`src/components/main-window/main-window-layout.tsx`

- Add `handleHideRepo` callback — calls `treeMenuService.hideRepo(repoId)`
- Add `handleRemoveRepo` callback — shows Tauri `confirm()` dialog, then calls `repoService.remove(repoName)` + hydrates lookup store
- Pass both to `TreeMenu` → `RepoItem`

`src/components/tree-menu/tree-item-renderer.tsx`

- Thread new `onHideRepo` and `onRemoveRepo` props through to `RepoItem`

## Phase 3: Add "Hide workspace" action to worktree context menu

### Files to change

`src/components/tree-menu/worktree-menus.tsx`

- Add `onHideWorktree?: (worktreeId: string) => void` prop to `WorktreeContextMenu`
- Add "Hide workspace" menu item (EyeOff icon) after the Pin toggle section

`src/components/tree-menu/worktree-item.tsx`

- Thread `onHideWorktree` prop through to `WorktreeContextMenu`

`src/components/main-window/main-window-layout.tsx`

- Add `handleHideWorktree` callback — calls `treeMenuService.hideWorktree(worktreeId)`
- Pass to worktree item via tree menu

## Phase 4: Wire up filtering in `useTreeData` and "Show all" in menu dropdown

### Files to change

`src/hooks/use-tree-data.ts`

- Subscribe to `hiddenWorktreeIds` and `hiddenRepoIds` from `useTreeMenuStore`
- After external worktree filtering and before pin filtering:
  - Filter out worktrees whose `worktreeId` is in `hiddenWorktreeIds`
  - Filter out worktrees whose `repoId` is in `hiddenRepoIds`
  - Filter out repo nodes whose `repoId` is in `hiddenRepoIds`

`src/components/main-window/main-window-layout.tsx`

- Update `handleUnhideAll` to call `treeMenuService.unhideAll()` (which clears hidden IDs + unpins)
- Update `hasHiddenOrPinned` computation to also check `hiddenWorktreeIds.length > 0 || hiddenRepoIds.length > 0`

## Phase 5: Manual smoke test checklist

- Right-click repo header → "Hide project" → repo and its worktrees disappear
- Right-click repo header → "Remove from Mort" → confirmation dialog → repo gone, source on disk untouched
- Right-click worktree → "Hide workspace" → worktree disappears, repo header stays if other worktrees visible
- "Show all workspaces" in menu dropdown → all hidden items reappear
- Pin + hide combo: pin a worktree, then unhide all → both pin cleared and hidden items restored
- Restart app → hidden state persists correctly