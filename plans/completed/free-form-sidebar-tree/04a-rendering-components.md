# 04a — Rendering Components

**Layer 3 — parallel with 04b. Depends on 03.**

## Summary

Update all tree-menu rendering components to handle the flat node model produced by 03's `buildUnifiedTree()`. The `TreeMenu` component iterates a flat `TreeItemNode[]` (no longer `RepoWorktreeSection[]`), dispatching each item by `type` to the correct component. A new `WorktreeItem` replaces the section header rendering from `repo-worktree-section.tsx`. A new `FolderItem` renders user-created folders. All existing item components drop `sectionId` usage and rely on `item.depth` for indentation (already the case). The `RepoWorktreeSection` component and `SectionDivider` component are deleted.

## Dependencies

- **03-unified-tree-model** — `useTreeData()` returns `TreeItemNode[]`, `RepoWorktreeSection` type removed, `TreeItemNode.type` includes `"worktree"` and `"folder"`, new fields (`icon`, `repoName`, `worktreeName`, `worktreePath`, `repoId`, `worktreeId`) on `TreeItemNode`

## Assumptions from 03

After 03 completes, the following will be true:
- `useTreeData()` returns `TreeItemNode[]` (flat list with `depth`)
- `RepoWorktreeSection` type and `TreeNode` union are removed from `src/stores/tree-menu/types.ts`
- `TreeItemNode.type` includes `"worktree"` and `"folder"`
- `TreeItemNode` has new optional fields: `icon?: string`, `repoName?: string`, `worktreeName?: string`, `worktreePath?: string`, `repoId?: string`, `worktreeId?: string`
- `buildChangesItems()` in `use-tree-data.ts` now produces items as children of worktree nodes (with appropriate depth) rather than as a separate `changesItems` array
- `useTreeSections()`, `useSectionItems()`, and `useSelectedTreeItem()` are updated to work with the flat model (or removed if unused -- they have zero consumers in `.tsx` files currently)
- Pin/hide state uses worktree node IDs instead of `"repoId:worktreeId"` section IDs
- `expandedSections` key for worktree expand/collapse uses the worktree node ID directly (not `"repoId:worktreeId"`)

## Key Files

| File | Change |
|------|--------|
| `src/components/tree-menu/tree-menu.tsx` | **Rewrite** — iterate flat `TreeItemNode[]` with type-based dispatch |
| `src/components/tree-menu/repo-worktree-section.tsx` | **Delete** |
| `src/components/tree-menu/section-divider.tsx` | **Delete** |
| `src/components/tree-menu/worktree-item.tsx` | **New** — renders worktree nodes (replaces section header) |
| `src/components/tree-menu/folder-item.tsx` | **New** — renders folder nodes with custom icon |
| `src/components/tree-menu/index.ts` | Remove `RepoWorktreeSection` and `SectionDivider` exports; add `WorktreeItem` and `FolderItem` exports |
| `src/hooks/index.ts` | Remove `useTreeSections`, `useSectionItems`, `buildTreeFromEntities` exports (dead code after 03) |
| `src/components/main-window/main-window-layout.tsx` | Update `TreeMenu` props and callbacks to match new interface |
| `src/components/tree-menu/use-tree-keyboard-nav.ts` | Update to handle all container types (worktree, folder, thread, plan) |
| `src/components/tree-menu/files-item.tsx` | Add optional `depth` prop for correct indentation under nested worktrees |
| `src/components/tree-menu/changes-item.tsx` | Use `item.depth` instead of hardcoded `TREE_INDENT_BASE` |
| `src/components/tree-menu/uncommitted-item.tsx` | Use `item.depth` instead of hardcoded indent |
| `src/components/tree-menu/commit-item.tsx` | Use `item.depth` instead of hardcoded indent |

## Implementation

### Phase 1: Create `WorktreeItem` component

**File: `src/components/tree-menu/worktree-item.tsx`** (new, ~220 lines)

Extract worktree header rendering from `repo-worktree-section.tsx` into a standalone `TreeItemNode`-based component. This is the largest single piece of work because `repo-worktree-section.tsx` (807 lines) contains all the plus menu, context menu, rename, and delegation logic.

#### Props interface

```typescript
interface WorktreeItemProps {
  item: TreeItemNode;
  /** Number of direct children (for the count badge) */
  childCount: number;
  isSelected: boolean;
  /** Index in the flat list for keyboard navigation */
  itemIndex: number;
  /** All items in the flat list for keyboard nav */
  allItems: TreeItemNode[];
  onItemSelect: (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => void;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewWorktree?: (repoName: string) => void;
  onNewRepo?: () => void;
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  onRefresh?: () => void;
  isCreatingWorktree?: boolean;
  onPinToggle?: (worktreeId: string) => void;
  isPinned?: boolean;
  onOpenFiles?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  isFileBrowserOpen?: boolean;
}
```

#### Key differences from current `RepoWorktreeSection`

1. **Reads worktree data from `item`** — `item.repoName`, `item.worktreeName`, `item.worktreePath`, `item.repoId`, `item.worktreeId` (set by 03's tree builder on worktree-type nodes). No more `section.repoId`, etc.
2. **Indentation** — uses `getTreeIndentPx(item.depth)` from `@/lib/tree-indent`. When at depth 0 (root), looks identical to current section headers. When nested inside a folder, indents correctly.
3. **No child rendering** — `WorktreeItem` only renders the header row (toggle, title, count, pin, plus button) plus `FilesItem` when expanded. Children are rendered by `TreeMenu`'s flat iteration. The component does NOT render `<ChangesItem>`, `<ThreadItem>`, `<PlanItem>`, etc.
4. **Toggle expand/collapse** — calls `treeMenuService.toggleSection(item.id)` using the worktree node ID (same as current behavior for sections, but now the key is the worktree UUID rather than `"repoId:worktreeId"`).
5. **Plus menu** — identical to current (new thread, new terminal, create PR, new worktree, new repo). Uses portal for popup. Reads `item.repoId!`, `item.worktreeId!`, `item.worktreePath!` from the item.
6. **Context menu** — identical to current (open in Cursor, pin, new thread, new terminal, create PR, new worktree, new repo, rename, archive). Reads from `item` fields.
7. **Rename** — identical to current. Uses `worktreeService.rename(item.repoName!, item.worktreeName!, trimmedName)`.
8. **`childCount`** — passed from `TreeMenu` (pre-computed). Displayed as badge: `<span className="ml-auto text-xs text-surface-500 font-normal">{childCount}</span>`.

#### What to extract vs. rewrite

- **Copy over from `repo-worktree-section.tsx`**: plus menu JSX (lines 457-532), context menu JSX (lines 538-684), rename logic (lines 271-321), open-in-Cursor logic (lines 247-268). These are verbatim copies with `section.` replaced by `item.`.
- **Drop**: `FilesItem` rendering in the children block, `changesItems` mapping, per-type item iteration (terminals, PRs, threads, plans loops at lines 739-803). All of that now happens in `TreeMenu`'s flat iteration.
- **Drop**: commit fetching `useEffect` (lines 344-356). Moves to `TreeMenu`.

#### Rendering structure (JSX)

The row layout is nearly identical to the current section header in `repo-worktree-section.tsx` lines 370-535:

```tsx
<div
  role="treeitem"
  aria-expanded={item.isExpanded}
  tabIndex={-1}
  style={{ paddingLeft: `${getTreeIndentPx(item.depth)}px` }}
  className={cn(
    "group flex items-center gap-1.5 pr-1 py-2.5 cursor-pointer select-none",
    item.depth === 0 && "pt-3.5", // Extra top padding for root worktrees
    "text-[13px] font-semibold text-surface-200",
    "transition-colors duration-75"
  )}
  onClick={handleToggle}
  onKeyDown={handleKeyDown}
  onContextMenu={handleContextMenu}
>
  {/* Chevron toggle */}
  <button type="button" className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400" ...>
    {item.isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
  </button>

  {/* Title: "repoName / worktreeName" (or rename input) */}
  <span className={cn("truncate font-mono", isCreatingWorktree && "text-surface-400")}>
    {item.repoName} / {isRenaming ? <input ... /> : item.worktreeName}
  </span>

  {isCreatingWorktree && <Loader2 size={12} className="flex-shrink-0 animate-spin text-surface-400" />}

  {/* Count badge */}
  <span className="ml-auto text-xs text-surface-500 font-normal">{childCount}</span>

  {/* Pin indicator */}
  {isPinned && <span className="text-accent-400 flex items-center justify-center w-5 h-5"><Pin size={12} /></span>}

  {/* Plus button + portal menu (copy from repo-worktree-section.tsx lines 438-533) */}
  ...
</div>
{/* Context menu portal (copy from repo-worktree-section.tsx lines 538-684) */}
...
{/* FilesItem rendered inline when worktree is expanded */}
{item.isExpanded && onOpenFiles && item.repoId && item.worktreeId && item.worktreePath && (
  <FilesItem
    repoId={item.repoId}
    worktreeId={item.worktreeId}
    worktreePath={item.worktreePath}
    isActive={isFileBrowserOpen ?? false}
    onOpenFiles={onOpenFiles}
    depth={item.depth + 1}
  />
)}
```

**Note about dividers:** The current `showDivider` prop renders `<div className="border-t border-dashed border-surface-700/50 mx-2 my-1" />` between sections. In the new model, this divider is rendered by `TreeMenu` before root-level worktree items (depth 0) when they are not the first item. No divider for worktrees nested inside folders.

### Phase 2: Create `FolderItem` component

**File: `src/components/tree-menu/folder-item.tsx`** (new, ~120 lines)

#### Props interface

```typescript
interface FolderItemProps {
  item: TreeItemNode;
  /** Number of direct children (for the count badge) */
  childCount: number;
  isSelected: boolean;
  /** Index in the flat list for keyboard navigation */
  itemIndex: number;
  /** All items in the flat list for keyboard nav */
  allItems: TreeItemNode[];
  onItemSelect: (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => void;
}
```

#### Icon rendering

For v1, use `Folder` icon from lucide-react for all folders. When `item.icon` is set, support dynamic lookup:

```typescript
import { Folder, type LucideIcon } from "lucide-react";
import { icons } from "lucide-react";

function getLucideIcon(name: string | undefined): LucideIcon {
  if (!name) return Folder;
  const icon = icons[name as keyof typeof icons];
  return icon ?? Folder;
}
```

#### Rendering structure

```tsx
<div
  role="treeitem"
  aria-selected={isSelected}
  aria-expanded={item.isExpanded}
  aria-level={item.depth + 1}
  data-testid={`folder-item-${item.id}`}
  data-tree-item-index={itemIndex}
  tabIndex={-1}
  onClick={handleClick}
  onKeyDown={handleKeyDown}
  style={{ paddingLeft: `${getTreeIndentPx(item.depth)}px` }}
  className={cn(
    "group flex items-center gap-1.5 py-0.5 pr-1 cursor-pointer",
    "text-[13px] leading-[22px]",
    "transition-colors duration-75",
    "outline-none focus:bg-accent-500/10",
    isSelected
      ? "bg-accent-500/20 text-surface-100"
      : "text-surface-300 hover:bg-accent-500/10"
  )}
>
  {/* Chevron toggle (always shown for folders since they are always containers) */}
  <button
    type="button"
    className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400"
    onClick={handleChevronToggle}
    aria-label={item.isExpanded ? "Collapse folder" : "Expand folder"}
  >
    <ChevronRight
      size={12}
      className={cn(
        "tree-chevron transition-transform duration-150",
        item.isExpanded && "rotate-90"
      )}
    />
  </button>

  {/* Folder icon */}
  <span className="flex-shrink-0 w-3 flex items-center justify-center">
    <FolderIcon size={11} className="text-surface-400" />
  </span>

  {/* Folder name */}
  <span className={cn("truncate flex-1", isSelected ? "" : "text-surface-300")} title={item.title}>
    {item.title}
  </span>

  {/* Child count badge */}
  <span className="text-xs text-surface-500 font-normal">{childCount}</span>
</div>
```

#### Click behavior

- Click on folder: if already selected, toggle expand/collapse via `treeMenuService.toggleSection(`folder:${item.id}`)`. Otherwise, select it via `treeMenuService.setSelectedItem(item.id)`.
- Chevron click: always toggles expand/collapse.
- Keyboard: ArrowRight expands / ArrowLeft collapses (handled by updated `use-tree-keyboard-nav.ts`).

**Note:** Folders don't navigate to a content pane. Clicking selects them in the tree (for context menu, DnD, etc.) but the center panel stays on whatever was previously shown. The `onItemSelect` callback is NOT called for folders -- only `treeMenuService.setSelectedItem()` is called.

### Phase 3: Rewrite `TreeMenu` to iterate flat `TreeItemNode[]`

**File: `src/components/tree-menu/tree-menu.tsx`** (rewrite, ~180 lines)

#### New `TreeMenuProps` interface

```typescript
interface TreeMenuProps {
  onItemSelect: (itemId: string, itemType: "thread" | "plan" | "terminal" | "pull-request", event?: React.MouseEvent) => void;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewWorktree?: (repoName: string) => void;
  onNewRepo?: () => void;
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  /** Set of worktree IDs currently being created */
  creatingWorktreeIds?: Set<string>;
  onPinToggle?: (worktreeId: string) => void;
  /** ID of currently pinned worktree, or null */
  pinnedWorktreeId?: string | null;
  onOpenFiles?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  fileBrowserWorktreeId?: string | null;
  className?: string;
}
```

**Key changes from current props:**
- `creatingSectionIds` (Set of `"repoId:worktreeId"`) becomes `creatingWorktreeIds` (Set of worktree UUIDs)
- `pinnedSectionId` becomes `pinnedWorktreeId`
- `onHide` removed (per parent plan -- users organize via folders + DnD)

#### Pre-computed child counts

```typescript
const childCountMap = useMemo(() => {
  const counts = new Map<string, number>();
  const parentStack: string[] = []; // parentStack[depth] = parent ID at that depth
  for (const item of items) {
    parentStack.length = item.depth;
    if (item.depth > 0 && parentStack[item.depth - 1]) {
      const parentId = parentStack[item.depth - 1];
      counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
    }
    if (item.isFolder) {
      parentStack[item.depth] = item.id;
    }
  }
  return counts;
}, [items]);
```

#### Changes/Uncommitted/Commit navigation helpers

These handlers need `repoId` and `worktreeId` to call `navigationService.navigateToChanges()`. Use the `worktreeId` field on the item (set by 03's tree builder):

```typescript
const handleChangesClick = useCallback(async (item: TreeItemNode) => {
  if (!item.worktreeId) return;
  const worktreeNode = items.find(i => i.type === "worktree" && i.id === item.worktreeId);
  if (worktreeNode?.repoId) {
    await navigationService.navigateToChanges(worktreeNode.repoId, item.worktreeId, {
      treeItemId: item.id,
    });
  }
}, [items]);

const handleUncommittedClick = useCallback(async (item: TreeItemNode) => {
  if (!item.worktreeId) return;
  const worktreeNode = items.find(i => i.type === "worktree" && i.id === item.worktreeId);
  if (worktreeNode?.repoId) {
    await navigationService.navigateToChanges(worktreeNode.repoId, item.worktreeId, {
      uncommittedOnly: true,
      treeItemId: item.id,
    });
  }
}, [items]);

const handleCommitClick = useCallback(async (item: TreeItemNode) => {
  if (!item.worktreeId) return;
  const worktreeNode = items.find(i => i.type === "worktree" && i.id === item.worktreeId);
  if (worktreeNode?.repoId) {
    await navigationService.navigateToChanges(worktreeNode.repoId, item.worktreeId, {
      commitHash: item.commitHash!,
      treeItemId: item.id,
    });
  }
}, [items]);
```

#### Commit fetching

Moved from `repo-worktree-section.tsx`. When any `type === "changes"` item has `isExpanded === true`, trigger the fetch:

```typescript
useEffect(() => {
  for (const item of items) {
    if (item.type === "changes" && item.isExpanded && item.worktreeId) {
      const worktreeNode = items.find(i => i.type === "worktree" && i.id === item.worktreeId);
      if (worktreeNode?.worktreePath) {
        useCommitStore.getState().fetchCommits(
          item.worktreeId,
          worktreeNode.worktreePath,
          worktreeNode.worktreeName ?? "",
        );
      }
    }
  }
}, [items]);
```

**Note:** The `fetchCommits` call currently uses `section.id` as the key. After 03, the key should be `item.worktreeId` (or whatever 03 uses as the key in `commitsBySection`). Coordinate with 03's implementation.

#### Flat iteration rendering

```tsx
return (
  <div ref={containerRef} role="tree" aria-label="Threads and Plans" data-testid="tree-menu" tabIndex={0} onKeyDown={handleKeyDown} className={`flex-1 overflow-auto focus:outline-none pl-2 ${className ?? ""}`}>
    {items.map((item, index) => {
      const showDivider = item.type === "worktree" && item.depth === 0 && index > 0;
      return (
        <React.Fragment key={item.id}>
          {showDivider && (
            <div className="border-t border-dashed border-surface-700/50 mx-2 my-1" role="separator" aria-orientation="horizontal" />
          )}
          <TreeItemRenderer
            item={item}
            index={index}
            allItems={items}
            childCount={childCountMap.get(item.id) ?? 0}
            selectedItemId={selectedItemId}
            onItemSelect={handleItemSelect}
            onChangesClick={handleChangesClick}
            onUncommittedClick={handleUncommittedClick}
            onCommitClick={handleCommitClick}
            onNewThread={onNewThread}
            onNewTerminal={onNewTerminal}
            onCreatePr={onCreatePr}
            onNewWorktree={onNewWorktree}
            onNewRepo={onNewRepo}
            onArchiveWorktree={onArchiveWorktree}
            onRefresh={handleRefreshTreeMenu}
            isCreatingWorktree={item.type === "worktree" && (creatingWorktreeIds?.has(item.id) ?? false)}
            onPinToggle={onPinToggle}
            isPinned={item.type === "worktree" && pinnedWorktreeId === item.id}
            onOpenFiles={onOpenFiles}
            isFileBrowserOpen={item.type === "worktree" && fileBrowserWorktreeId === item.worktreeId}
          />
        </React.Fragment>
      );
    })}
  </div>
);
```

#### `TreeItemRenderer` component

A simple dispatcher (inline in tree-menu.tsx or a separate function):

```tsx
function TreeItemRenderer({ item, index, allItems, childCount, selectedItemId, onItemSelect, ... }: TreeItemRendererProps) {
  const isSelected = selectedItemId === item.id;

  switch (item.type) {
    case "worktree":
      return <WorktreeItem item={item} childCount={childCount} isSelected={isSelected} itemIndex={index} allItems={allItems} onItemSelect={onItemSelect} onNewThread={onNewThread} onNewTerminal={onNewTerminal} onCreatePr={onCreatePr} onNewWorktree={onNewWorktree} onNewRepo={onNewRepo} onArchiveWorktree={onArchiveWorktree} onRefresh={onRefresh} isCreatingWorktree={isCreatingWorktree} onPinToggle={onPinToggle} isPinned={isPinned} onOpenFiles={onOpenFiles} isFileBrowserOpen={isFileBrowserOpen} />;
    case "folder":
      return <FolderItem item={item} childCount={childCount} isSelected={isSelected} itemIndex={index} allItems={allItems} onItemSelect={onItemSelect} />;
    case "thread":
      return <ThreadItem item={item} isSelected={isSelected} onSelect={onItemSelect} itemIndex={index} allItems={allItems} />;
    case "plan":
      return <PlanItem item={item} isSelected={isSelected} onSelect={onItemSelect} itemIndex={index} allItems={allItems} />;
    case "terminal":
      return <TerminalItem item={item} isSelected={isSelected} onSelect={onItemSelect} itemIndex={index} />;
    case "pull-request":
      return <PullRequestItem item={item} isSelected={isSelected} onSelect={onItemSelect} itemIndex={index} />;
    case "changes":
      return <ChangesItem item={item} isSelected={isSelected} onNavigate={() => onChangesClick(item)} />;
    case "uncommitted":
      return <UncommittedItem item={item} isSelected={isSelected} onNavigate={() => onUncommittedClick(item)} />;
    case "commit":
      return <CommitItem item={item} isSelected={isSelected} onNavigate={() => onCommitClick(item)} />;
    default:
      return null;
  }
}
```

### Phase 4: Update existing item components for depth-based indentation

Existing item components (`ThreadItem`, `PlanItem`, `TerminalItem`, `PullRequestItem`) already use `item.depth` with `TREE_INDENT_BASE + item.depth * TREE_INDENT_STEP` for indentation. After 03, `item.depth` accounts for the full tree hierarchy (worktree > folder > item), so **no indentation changes are needed in these components**.

The `sectionId` field on `TreeItemNode` is removed in 03. No component reads `item.sectionId` (verified by grep -- zero usages in `.tsx` files), so no code changes needed for removal.

The following components use hardcoded indentation and need updating:

**File: `src/components/tree-menu/changes-item.tsx`** (modify)

Replace:
```tsx
import { TREE_INDENT_BASE } from "@/lib/tree-indent";
// ...
style={{ paddingLeft: `${TREE_INDENT_BASE}px` }}
```
With:
```tsx
import { getTreeIndentPx } from "@/lib/tree-indent";
// ...
style={{ paddingLeft: `${getTreeIndentPx(item.depth)}px` }}
```

**File: `src/components/tree-menu/uncommitted-item.tsx`** (modify)

Replace:
```tsx
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
// ...
const indentPx = TREE_INDENT_BASE + TREE_INDENT_STEP;
```
With:
```tsx
import { getTreeIndentPx } from "@/lib/tree-indent";
// ...
const indentPx = getTreeIndentPx(item.depth);
```

**File: `src/components/tree-menu/commit-item.tsx`** (modify)

Replace:
```tsx
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
// ...
const indentPx = TREE_INDENT_BASE + TREE_INDENT_STEP;
```
With:
```tsx
import { getTreeIndentPx } from "@/lib/tree-indent";
// ...
const indentPx = getTreeIndentPx(item.depth);
```

**File: `src/components/tree-menu/files-item.tsx`** (modify)

Add optional `depth` prop for correct indentation under nested worktrees:

```typescript
interface FilesItemProps {
  repoId: string;
  worktreeId: string;
  worktreePath: string;
  isActive: boolean;
  onOpenFiles: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Indentation depth (defaults to 0) */
  depth?: number;
}
```

Replace:
```tsx
import { TREE_INDENT_BASE } from "@/lib/tree-indent";
// ...
style={{ paddingLeft: `${TREE_INDENT_BASE}px` }}
```
With:
```tsx
import { getTreeIndentPx } from "@/lib/tree-indent";
// ...
style={{ paddingLeft: `${getTreeIndentPx(depth ?? 0)}px` }}
```

### Phase 5: Update keyboard navigation

**File: `src/components/tree-menu/use-tree-keyboard-nav.ts`** (modify)

The current `useTreeKeyboardNav` hook only handles `plan` and `thread` type folders for ArrowRight/ArrowLeft. Update to handle all container types: `worktree`, `folder`, `thread`, `plan`.

In `useTreeKeyboardNav` function, change:
```typescript
if (currentItem.type === "plan" && currentItem.isFolder) {
```
to:
```typescript
if (currentItem.isFolder) {
```

This appears in two places in the function: the ArrowRight handler (line 50) and the ArrowLeft handler (line 75).

Similarly in `useTreeItemKeyboardNav` function, change:
```typescript
if (item.type === "plan" && item.isFolder) {
```
to:
```typescript
if (item.isFolder) {
```

This appears twice in that function as well: ArrowRight handler (line 142) and ArrowLeft handler (line 162).

Also update the expand/collapse key to use a helper function that matches 03's key convention:

```typescript
function getExpandKey(item: TreeItemNode): string {
  switch (item.type) {
    case "worktree": return item.id;
    case "folder": return `folder:${item.id}`;
    case "thread": return `thread:${item.id}`;
    case "plan": return `plan:${item.id}`;
    case "changes": return item.id;
    default: return item.id;
  }
}
```

Replace all `treeMenuService.expandSection(`plan:${currentItem.id}`)` and `treeMenuService.collapseSection(`plan:${currentItem.id}`)` calls with `treeMenuService.expandSection(getExpandKey(currentItem))` / `treeMenuService.collapseSection(getExpandKey(currentItem))`.

**Note:** Coordinate the `getExpandKey` convention with 03's implementation. The key used here must match what the tree builder reads from `expandedSections`.

The container `TreeMenu` keyboard handler should also be simplified. Replace the current `focusableItems` computation (which iterates sections and their items) with use of the flat `items` list directly. Since the flat list from `useTreeData()` only contains visible items (collapsed children are excluded by the tree builder), every item in the list is focusable.

### Phase 6: Delete `repo-worktree-section.tsx`, `section-divider.tsx`, update exports

**File: `src/components/tree-menu/repo-worktree-section.tsx`** -- DELETE

**File: `src/components/tree-menu/section-divider.tsx`** -- DELETE (divider logic is inlined in `TreeMenu` as a simple conditional `<div>`)

**File: `src/components/tree-menu/index.ts`** -- Rewrite:

```typescript
export { TreeMenu } from "./tree-menu";
export { TreePanelHeader } from "./tree-panel-header";
export { WorktreeItem } from "./worktree-item";
export { FolderItem } from "./folder-item";
export { ThreadItem } from "./thread-item";
export { PlanItem } from "./plan-item";
export { ChangesItem } from "./changes-item";
export { UncommittedItem } from "./uncommitted-item";
export { CommitItem } from "./commit-item";
export { useTreeKeyboardNav, useTreeItemKeyboardNav } from "./use-tree-keyboard-nav";
```

Removed: `RepoWorktreeSection`, `SectionDivider`.

**File: `src/hooks/index.ts`** -- Update the tree data exports:

```typescript
export {
  useTreeData,
  useExpandedSections,
} from "./use-tree-data";
```

Removed: `useTreeSections` (unused), `useSelectedTreeItem` (unused in .tsx), `useSectionItems` (unused in .tsx), `buildTreeFromEntities` (replaced by `buildUnifiedTree` in 03).

### Phase 7: Update `main-window-layout.tsx` for new TreeMenu props

**File: `src/components/main-window/main-window-layout.tsx`** (modify)

#### State changes

1. Rename `creatingSectionIds` to `creatingWorktreeIds`:

   Line 105 -- change:
   ```typescript
   const [creatingSectionIds, setCreatingSectionIds] = useState<Set<string>>(new Set());
   ```
   To:
   ```typescript
   const [creatingWorktreeIds, setCreatingWorktreeIds] = useState<Set<string>>(new Set());
   ```

2. `pinnedSectionId` becomes `pinnedWorktreeId` (from `useTreeMenuStore` -- 03 renames this in the store):

   Line 93 -- change:
   ```typescript
   const pinnedSectionId = useTreeMenuStore((state) => state.pinnedSectionId);
   ```
   To:
   ```typescript
   const pinnedWorktreeId = useTreeMenuStore((state) => state.pinnedWorktreeId);
   ```

3. Remove `hiddenSectionIds` usage (line 94):
   ```typescript
   // DELETE: const hiddenSectionIds = useTreeMenuStore((state) => state.hiddenSectionIds);
   ```

4. Remove `handleHideSection` callback (lines 562-580) entirely.

#### `useTreeData` usage changes (Command+N / Command+T)

After 03, `useTreeData()` returns `TreeItemNode[]`. The Command+N handler (lines 162-232) and Command+T handler (lines 384-436) currently read `section.repoId`, `section.worktreeId`, `section.worktreePath`, `section.worktreeName`.

Rename `treeSections` to `treeItems` (line 90):
```typescript
const treeItems = useTreeData({ skipFiltering: true });
```

Update `treeSectionsRef` to `treeItemsRef` (lines 97-98):
```typescript
const treeItemsRef = useRef(treeItems);
treeItemsRef.current = treeItems;
```

In Command+N handler, update the worktree-finding logic (lines 178-211):

```typescript
// Finding worktree for selected item (replaces section lookup):
const worktreeNode = treeItemsRef.current.find(
  i => i.type === "worktree" && i.repoId === repoId && (i.worktreeId === worktreeId || i.id === worktreeId)
);
worktreeName = worktreeNode?.worktreeName ?? "unknown";

// Fallback to most recent worktree (replaces sections[0]):
const allItems = treeItemsRef.current;
const worktrees = allItems.filter(i => i.type === "worktree");
if (worktrees.length === 0) return;
const mostRecent = worktrees[0];
repoId = mostRecent.repoId!;
worktreeId = mostRecent.worktreeId ?? mostRecent.id;
```

Same pattern for Command+T handler.

#### `handleNewWorktree` changes (lines 438-514)

The optimistic insert currently creates `sectionId = \`${repoId}:${tempWorktreeId}\``. Change to use worktree UUID directly:

Line 459 -- change:
```typescript
const sectionId = `${repoId}:${tempWorktreeId}`;
```
To:
```typescript
// No sectionId needed -- use tempWorktreeId directly
```

Lines 461-464 -- change:
```typescript
setCreatingSectionIds((prev) => new Set([...prev, sectionId]));
await treeMenuService.expandSection(sectionId);
```
To:
```typescript
setCreatingWorktreeIds((prev) => new Set([...prev, tempWorktreeId]));
await treeMenuService.expandSection(tempWorktreeId);
```

In the finally block (lines 508-512) -- change:
```typescript
setCreatingSectionIds((prev) => {
  const next = new Set(prev);
  next.delete(sectionId);
  return next;
});
```
To:
```typescript
setCreatingWorktreeIds((prev) => {
  const next = new Set(prev);
  next.delete(tempWorktreeId);
  return next;
});
```

#### `handleHideSection` -- DELETE

Remove the entire `handleHideSection` callback (lines 562-580).

#### `handlePinToggle` -- no changes

The callback signature stays the same (takes a string ID). After 03, the ID is the worktree UUID.

#### TreeMenu JSX props update (lines 762-777)

Change:
```tsx
<TreeMenu
  onItemSelect={handleItemSelect}
  onNewThread={handleNewThread}
  onCreatePr={handleCreatePrCallback}
  onNewTerminal={handleNewTerminal}
  onNewWorktree={handleNewWorktree}
  onNewRepo={handleNewRepo}
  onArchiveWorktree={handleArchiveWorktree}
  creatingSectionIds={creatingSectionIds}
  onPinToggle={handlePinToggle}
  onHide={handleHideSection}
  pinnedSectionId={pinnedSectionId}
  onOpenFiles={rightPanel.openFileBrowser}
  fileBrowserWorktreeId={rightPanel.fileBrowserWorktreeId}
  className="flex-1 min-h-0"
/>
```
To:
```tsx
<TreeMenu
  onItemSelect={handleItemSelect}
  onNewThread={handleNewThread}
  onCreatePr={handleCreatePrCallback}
  onNewTerminal={handleNewTerminal}
  onNewWorktree={handleNewWorktree}
  onNewRepo={handleNewRepo}
  onArchiveWorktree={handleArchiveWorktree}
  creatingWorktreeIds={creatingWorktreeIds}
  onPinToggle={handlePinToggle}
  pinnedWorktreeId={pinnedWorktreeId}
  onOpenFiles={rightPanel.openFileBrowser}
  fileBrowserWorktreeId={rightPanel.fileBrowserWorktreeId}
  className="flex-1 min-h-0"
/>
```

Removed: `onHide`, `pinnedSectionId`, `creatingSectionIds`.

#### TreePanelHeader props update (lines 756-761)

Keep existing props but only check `pinnedWorktreeId`:
```tsx
<TreePanelHeader
  onSettingsClick={handleSettingsClick}
  onArchiveClick={handleArchiveClick}
  onUnhideAll={handleUnhideAll}
  hasHiddenOrPinned={pinnedWorktreeId !== null}
/>
```

## Acceptance Criteria

- [ ] `TreeMenu` renders from flat `TreeItemNode[]` -- no `RepoWorktreeSection` usage
- [ ] Worktree nodes render identically to current section headers (bold "repoName / worktreeName", chevron, count badge, pin indicator, plus button)
- [ ] Worktree nodes indent correctly when nested inside folders (depth > 0)
- [ ] Folder nodes render with chevron toggle, folder icon, name, and child count badge
- [ ] All existing item types render correctly with proper depth-based indentation
- [ ] Dividers render between root-level worktree items (depth 0), not between nested ones
- [ ] `FilesItem` renders as first child of expanded worktree items
- [ ] Changes/Uncommitted/Commit items navigate correctly (find ancestor worktree for repoId/worktreeId)
- [ ] Commit fetching triggers when Changes folder is expanded
- [ ] Keyboard navigation works: ArrowUp/Down moves through flat list, ArrowLeft/Right expands/collapses all container types
- [ ] Context menus on worktree items work (new thread, terminal, PR, worktree, repo, rename, archive, open in Cursor, pin)
- [ ] Plus menu on worktree items works (same actions as context menu)
- [ ] `repo-worktree-section.tsx` and `section-divider.tsx` are deleted
- [ ] `main-window-layout.tsx` updated for new prop names and flat list model
- [ ] `pnpm tsc --noEmit` passes
- [ ] Existing tests pass: `pnpm test`

## Phases

- [x] Create `WorktreeItem` component (extract from `repo-worktree-section.tsx`)
- [x] Create `FolderItem` component
- [x] Rewrite `TreeMenu` to iterate flat `TreeItemNode[]` with type-based dispatch
- [x] Update `ChangesItem`, `UncommittedItem`, `CommitItem` for depth-based indentation; update `FilesItem` for optional depth
- [x] Update `use-tree-keyboard-nav.ts` for all container types
- [x] Delete `repo-worktree-section.tsx` and `section-divider.tsx`; update `index.ts` exports; update `src/hooks/index.ts` exports
- [x] Update `main-window-layout.tsx` for new TreeMenu props and flat list model

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
