# Track C: Tree Menu Cleanup

**Parent:** [unified-right-panel-tabs.md](../unified-right-panel-tabs.md)
**Parallel:** Yes — tree menu changes are independent of right panel construction

## Goal

Remove commit/uncommitted children from the "Changes" tree item (flatten it to a leaf node) and remove the `files` tree item type entirely. File browsing moves to the right panel; commit history moves to the Changelog tab.

## Phases

- [x] Remove `files` tree item type from tree builder and renderer
- [x] Remove commit/uncommitted children from Changes node (flatten to leaf)
- [x] Simplify `ChangesItem` component (remove expand/collapse)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remove `files` tree item type

### `src/hooks/tree-node-builders.ts`
- Delete `buildFilesNode()` function entirely

### `src/hooks/use-tree-data.ts`
- Remove the `allNodes.push(buildFilesNode(...))` call in Step 1b (~line 210)
- Remove `buildFilesNode` from the import

### `src/stores/tree-menu/types.ts`
- Remove `"files"` from the `TreeItemType` union
- Remove `files: 0` from `TYPE_SORT_PRIORITY` in `use-tree-data.ts`

### `src/components/tree-menu/tree-item-renderer.tsx`
- Remove the `case "files":` branch and `FilesItem` import
- Remove `onOpenFiles` and `isFileBrowserOpen` from `TreeItemRendererProps`

### `src/components/tree-menu/files-item.tsx`
- Delete the file entirely

### `src/components/tree-menu/tree-menu.tsx`
- Remove `onOpenFiles` and `fileBrowserWorktreeId` props (they move to the layout's right panel wiring)
- Remove these props from `TreeItemRenderer` calls

**Note:** The `onOpenFiles` callback from `MainWindowLayout` → `TreeMenu` can be removed now. Track D will handle wiring the tree menu "Files" action to the right panel's `openFileBrowser()` instead — but that's optional since the Files tab auto-derives context. If we still want a tree menu shortcut, Track D can add it back as a simpler action.

## Phase 2: Remove commit/uncommitted children from Changes

### `src/hooks/tree-node-builders.ts`
- Simplify `buildChangesNodes()` to return only the Changes node (no uncommitted/commit children)
- Rename to `buildChangesNode()` (singular) since it returns one node
- The Changes node should have `isFolder: false` (no longer expandable)

Before:
```typescript
export function buildChangesNodes(worktreeId: string): TreeItemNode[] {
  const nodes = [];
  nodes.push({ type: "changes", id: `changes:${worktreeId}`, isFolder: true, ... });
  nodes.push({ type: "uncommitted", parentId: changesItemId, ... });
  for (const commit of commits.slice(0, 5)) {
    nodes.push({ type: "commit", parentId: changesItemId, ... });
  }
  return nodes;
}
```

After:
```typescript
export function buildChangesNode(worktreeId: string): TreeItemNode {
  return {
    type: "changes",
    id: `changes:${worktreeId}`,
    title: "Changes",
    status: "read",
    updatedAt: 0,
    createdAt: 0,
    depth: 0,
    isFolder: false,
    isExpanded: false,
    worktreeId,
    parentId: worktreeId,
  };
}
```

### `src/hooks/use-tree-data.ts`
- Update import: `buildChangesNodes` → `buildChangesNode`
- Update call: `allNodes.push(...buildChangesNodes(wt.worktreeId))` → `allNodes.push(buildChangesNode(wt.worktreeId))`
- Remove `useCommitStore` import and subscription (no longer needed for tree building)
- Remove `commitsByWorktree` from the `useMemo` dependency array

### `src/stores/tree-menu/types.ts`
- Remove `"uncommitted"` and `"commit"` from `TreeItemType` union
- Remove commit-specific fields from `TreeItemNode` if they're no longer used anywhere (check Track B first — it may use `GitCommit` type directly instead)

### `src/components/tree-menu/tree-item-renderer.tsx`
- Remove `case "uncommitted":` and `case "commit":` branches
- Remove `UncommittedItem` and `CommitItem` imports
- Remove `onCommitClick` and `onUncommittedClick` from props

## Phase 3: Simplify `ChangesItem`

### `src/components/tree-menu/changes-item.tsx`

Changes becomes a simple leaf node — clicking navigates to the worktree diff view, no expand/collapse.

Remove:
- Chevron toggle logic (`handleChevronToggle`)
- `aria-expanded` attribute
- Conditional chevron vs icon rendering
- `isExpanded` references

Simplify to:
```tsx
export function ChangesItem({ item, isSelected, onNavigate }: ChangesItemProps) {
  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      data-tree-item-id={item.id}
      tabIndex={-1}
      onClick={onNavigate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(); } }}
      style={{ paddingLeft: `${getTreeIndentPx(item.depth)}px` }}
      className={cn(/* same styling without expanded state */)}
    >
      <GitCompare size={11} className="flex-shrink-0 w-3" />
      <span className="truncate">Changes</span>
    </div>
  );
}
```

### Files to delete

| File | Reason |
| --- | --- |
| `src/components/tree-menu/files-item.tsx` | Files browsing moves to right panel |
| `src/components/tree-menu/uncommitted-item.tsx` | Uncommitted changes accessible via Changes click |
| `src/components/tree-menu/commit-item.tsx` | Commits move to Changelog tab in right panel |

**Note:** `commit-item.tsx` styling is referenced by Track B for the changelog panel. Track B should copy the relevant styles directly — it doesn't import the component.

## Files Changed

| File | Change |
| --- | --- |
| `src/hooks/tree-node-builders.ts` | Remove `buildFilesNode`, simplify `buildChangesNodes` → `buildChangesNode` |
| `src/hooks/use-tree-data.ts` | Remove files/commit node building, remove `useCommitStore` subscription |
| `src/stores/tree-menu/types.ts` | Remove `files`, `uncommitted`, `commit` from `TreeItemType` |
| `src/components/tree-menu/tree-item-renderer.tsx` | Remove files/uncommitted/commit cases and related props |
| `src/components/tree-menu/changes-item.tsx` | Simplify to leaf node (no expand/collapse) |
| `src/components/tree-menu/tree-menu.tsx` | Remove `onOpenFiles`, `fileBrowserWorktreeId` props |
| `src/components/tree-menu/files-item.tsx` | **Delete** |
| `src/components/tree-menu/uncommitted-item.tsx` | **Delete** |
| `src/components/tree-menu/commit-item.tsx` | **Delete** |
