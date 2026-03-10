# Tree Menu Refinements

Several UX refinements to the sidebar tree menu: make repos act as flat section headers rather than nesting tree nodes, make worktrees selectable, and prevent archiving root-level folders.

## Current Behavior

- **Repo nodes** render as tree nodes at depth 0 with a left-aligned chevron and a child count badge on the right. Children (worktrees) render at depth 1, indented 16px.
- **Worktree nodes** toggle expand/collapse on click but are **not selectable/highlightable** — the `isSelected` prop is received but never applied to styling or click handling.
- **Root-level folders** (no `worktreeId`) show the "Archive" option in their context menu, same as worktree-scoped folders.
- **Indentation**: `paddingLeft = 8 + depth * 8` px via `getTreeIndentPx()`.

## Changes

### 1. Repo nodes: right-justify chevron, remove count badge

**Files:** `src/components/tree-menu/repo-item.tsx`

- Move the chevron button from before the title to after it, using `ml-auto` positioning
- Remove the `<span>{childCount}</span>` badge entirely
- Remove `childCount` from `RepoItemProps` since it's no longer displayed

### 2. Flatten repo children to same visual level

**Files:** `src/hooks/use-tree-data.ts` (buildUnifiedTree), `src/components/tree-menu/repo-item.tsx`

The repo node itself is at depth 0. Its direct children (worktrees, root-level folders) currently render at depth 1. The user wants them at the same visual level as the repo.

Approach: In `addNodeAndChildren()`, when the parent is a `repo` node, pass the **same depth** (not `depth + 1`) to children. This makes worktrees and root folders under a repo appear at depth 0, so they're flush with the repo header.

```
function addNodeAndChildren(node: TreeItemNode, depth: number): void {
  node.depth = depth;
  result.push(node);
  if (!node.isFolder || !node.isExpanded) return;
  const children = childrenMap.get(node.id);
  if (!children) return;
  const childDepth = node.type === "repo" ? depth : depth + 1;
  for (const child of children) {
    addNodeAndChildren(child, childDepth);
  }
}
```

This cascades: items inside a worktree that used to be at depth 2 will now be at depth 1, etc. The entire tree shifts one level left under repos.

### 3. Make worktree nodes selectable and highlightable

**Files:** `src/components/tree-menu/worktree-item.tsx`

Currently `WorktreeHeader` only calls `treeMenuService.toggleSection()` on click. Need to:

- Add selection styling matching folder-item's pattern: `isSelected ? "bg-accent-500/20 text-surface-100" : "hover:bg-accent-500/10"`
- Change click behavior: first click selects the worktree (calls `treeMenuService.setSelectedItem(item.id)`), second click (when already selected) toggles expand/collapse — same pattern as folder-item
- Wire up `onItemSelect` callback so the main panel can respond to worktree selection

### 4. Prevent archiving root-level folders (above worktree level)

**Files:** `src/components/tree-menu/folder-context-menu.tsx`, `src/components/tree-menu/folder-item.tsx`

Root-level folders have no `worktreeId`. These act as organizational containers for worktrees and should not be archiveable.

- Add an `isRootLevel` (or `canArchive`) prop to `FolderContextMenuItems`
- When `!item.worktreeId`, hide the archive menu item (or the entire archive section)
- In `FolderItem`, pass `item.worktreeId` presence to the context menu

## Phases

- [x] Repo node: right-justify chevron, remove count badge

- [x] Flatten repo children depth (same visual level as repo)

- [x] Make worktree nodes selectable/highlightable

- [x] Prevent archiving root-level folders

- [x] Verify existing tests pass, update if needed

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Notes

- `TreeItemRenderer` passes `childCount` to `RepoItem` — after removing the badge, the prop plumbing can be cleaned up or left as-is (it's cheap to compute).
- The depth flattening in phase 2 will affect indentation for the entire subtree under each repo. Items that were at depth 2 (e.g., threads inside a worktree) will now be at depth 1. This is the desired behavior — everything shifts one level left.
- Worktree selection (phase 3) follows the same UX pattern as folder-item: click to select, click again to toggle. The chevron button remains a direct toggle shortcut.